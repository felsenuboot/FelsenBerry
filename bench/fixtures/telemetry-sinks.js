// bench/fixtures/telemetry-sinks.js — the new telemetry sinks (#54 M.recovery, #69 M.chest
// wiring shape, #69 gap 2 continuous position trace).
//
// Different run mode from this directory's usual /eval fixtures, deliberately: none of this
// needs a live bot, a world, or the injected __skills stack — telemetry.js is requirable in
// complete isolation (it only touches the `bot` EventEmitter it's given), so this is PURE
// NODE, hermetic, no server. Same "hermetic > staged" principle as move-detect.js and
// gotoR-recovery.js, taken one step further since there's no __skills dependency to fake.
//
// Run:  node bench/fixtures/telemetry-sinks.js
//
// Covers:
//   1. M.recovery links back to the FAILED goto span's gid (M.goto is already cleared by the
//      time a caller's catch block runs recovery() — see telemetry.js's M._lastGotoGid note)
//      and threads a `recoveries` counter through the owning task span.
//   2. M.chest's existing shape (kind/at/moved) round-trips correctly once called — the sink
//      itself was never broken, #69's bug was that nothing called it.
//   3. The position-trace GATE (shouldEmitPos), tested as a PURE function so the 30s
//      heartbeat path doesn't require an actual 30s wait: displacement fires, sub-threshold
//      movement does not, and the heartbeat fires on elapsed time alone with zero movement.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const telemetry = require('../../telemetry.js');

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

// ---- 1 & 2: install() against a stubbed bot, drive the sinks, read the ledger back ----
(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-sinks-'));
  const bot = new EventEmitter();
  bot.username = 'FixtureBot';
  bot.health = 20; bot.food = 20;
  bot.entity = { position: { x: 0, y: 64, z: 0 } };
  bot.inventory = { items: () => [] };
  const M = telemetry.install(bot, { dir: tmpDir, name: 'FixtureBot' });
  bot.emit('spawn');

  M.gotoStart({ x: 10, y: 64, z: 0 }, 30000);
  M.gotoEnd('stuck', false);                          // the failed span R2 fires from
  M.recovery('R2', 1, { displaced: true });
  await new Promise((r) => setTimeout(r, 5));         // _reposition() always takes real time
  M.gotoStart({ x: 10, y: 64, z: 0 }, 15000);
  M.gotoEnd('arrived', false);                        // the retry's own outcome

  M.taskStart({ id: 't1', name: 'restock', args: {} });
  M.chest('withdraw', { x: -7, y: 111, z: -2 }, { torch: 8 });
  M.taskEnd({ id: 't1', name: 'restock', args: {}, done: true, startedAt: Date.now() - 500, endedAt: Date.now() }, null);

  M.close();
  await new Promise((r) => setTimeout(r, 100));

  const lines = fs.readFileSync(path.join(tmpDir, 'metrics-FixtureBot.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const recoveries = lines.filter((l) => l.ev === 'recovery');
  const gotos = lines.filter((l) => l.ev === 'goto');
  const chests = lines.filter((l) => l.ev === 'chest');
  const taskEnd = lines.find((l) => l.ev === 'task_end');

  T('exactly one recovery event fired', recoveries.length, 1);
  T('recovery.gid links to the FAILED (first) goto span', recoveries[0] && recoveries[0].gid, gotos[0] && gotos[0].gid);
  T('recovery carries rung/attempt/extra through untouched', recoveries[0] && [recoveries[0].rung, recoveries[0].attempt, recoveries[0].displaced], ['R2', 1, true]);
  T('the retry (second goto) has a DIFFERENT gid and arrived', gotos[1] && gotos[1].gid !== gotos[0].gid && gotos[1].res, true && 'arrived');
  T('chest event round-trips kind/at/moved', chests[0] && [chests[0].kind, chests[0].at, chests[0].moved], ['withdraw', { x: -7, y: 111, z: -2 }, { torch: 8 }]);
  T('task_end.recoveries is 0 (the recovery fired outside this task span)', taskEnd && taskEnd.recoveries, 0);

  // ---- 3: shouldEmitPos, pure — no timers, no waiting ----
  const { shouldEmitPos, POS_MOVE_EPS, POS_HEARTBEAT_MS } = telemetry;
  const t0 = 1_000_000;
  T('never emitted yet -> always fires', shouldEmitPos(null, { x: 0, y: 64, z: 0 }, null, t0), true);
  T('displacement >= EPS fires, well within the heartbeat window',
    shouldEmitPos({ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: POS_MOVE_EPS }, t0, t0 + 100), true);
  T('displacement just under EPS, well before the heartbeat -> does not fire',
    shouldEmitPos({ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: POS_MOVE_EPS - 0.5 }, t0, t0 + 100), false);
  T('zero movement but heartbeat elapsed -> fires anyway (the frozen-bot signal)',
    shouldEmitPos({ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }, t0, t0 + POS_HEARTBEAT_MS), true);
  T('zero movement, heartbeat not yet elapsed -> does not fire',
    shouldEmitPos({ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }, t0, t0 + POS_HEARTBEAT_MS - 1), false);

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.failed.length ? 1 : 0);
})();
