// bench/fixtures/agenda-idlework.js — IDLE must do the ROLE'S WORK, not stand still (#no-idle).
//
// The bug: the IDLE rung was a NULL IDLE. With no project set it only swept for drops, so a
// bot nobody had assigned anything simply stopped — Felix found five sitting at 2500+ ticks
// doing nothing visible. A good human player with no orders works their trade.
//
// Stubs __skills.start, so nothing runs and nothing moves. Restores what it touches.
const A = globalThis.__agenda, S = globalThis.__skills;
const out = { agenda: A.version, cases: [] };
const R = A.rung('IDLE');
const saved = { project: A.project, idleAt: A._idleAt, owner: A.owner };
const realStart = S.start;
let started = [];
S.start = (b, name, args) => { started.push(name); return { ok: true, taskId: 'stub' }; };
A.busy = true;
const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });
const fire = (role) => { started = []; A._idleAt = 0; R.act({ now: Date.now(), task: null, role }); return started[0] || null; };

try {
  A.project = null;
  T('miner idles by MINING, not sweeping', fire('miner'), 'mineLane');
  T('lumberjack chops', fire('lumberjack'), 'chopTrees');
  T('hunter hunts', fire('hunter'), 'huntAnimals');
  T('farmer harvests (farmCycle needs a field, so not that)', fire('farmer'), 'harvestGrass');
  T('builder gathers', fire('builder'), 'chopTrees');
  T('NO role -> falls back to the drop sweep', fire(null), 'collectDrops');
  T('unknown role -> sweep rather than crash', fire('astronaut'), 'collectDrops');

  // refused role work must fall through, not leave the bot doing nothing
  // NB: this replacement stub must still RECORD, or the assertions below see nothing and the
  // fixture reports a failure the code does not have.
  S.start = (b, name) => {
    started.push(name);
    return name === 'collectDrops' ? { ok: true, taskId: 'stub' } : { ok: false, error: { code: 'kit_missing' } };
  };
  started = []; A._idleAt = 0;
  R.act({ now: Date.now(), task: null, role: 'miner' });
  T('role work REFUSED -> still sweeps rather than idling', started.includes('collectDrops'), true);
  T('...and it did try the work first', started[0], 'mineLane');

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
  return out;
} finally {
  S.start = realStart; A.project = saved.project; A._idleAt = saved.idleAt; A.owner = saved.owner; A.busy = false;
}
