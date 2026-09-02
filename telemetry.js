'use strict';
/*
 * telemetry.js — the metrics ledger (EVALUATION.md E1, spec: research/eval-instrumentation.md).
 *
 * One JSONL file per bot, one writer, append-only: logs/metrics-<bot>.jsonl.
 * Required by runner.js and installed ONCE per bot instance (in createBot, not on spawn —
 * installing per spawn would stack listeners on every reconnect, which is the exact bug
 * class we spent tonight fixing elsewhere).
 *
 * The principle this serves is "verifier-or-it-didn't-happen": a task that CLAIMS success
 * is not counted as success until an independent assertion agrees. false_success is the
 * headline metric and its target is zero — a bot that lies about finishing is worse than
 * one that honestly fails, because the lie costs a human the time to discover it.
 *
 * Everything here is read-only with respect to gameplay. It observes; it never steers.
 * Every emit is wrapped so a telemetry bug can never take a bot down.
 */

const fs = require('fs');
const path = require('path');

// v2 (2026-09-01): `assert` changed MEANING — it now carries the graded rule name whenever
// assertTask graded the task at all (pass or fail), and null only when genuinely ungraded.
// In v1 it held a rule name ONLY on failure, so "passed" and "never graded" were both null.
// The envelope's own rule is that a field is never repurposed without a version bump, and
// this is exactly that case: the ledger is append-only, so without this marker an aggregator
// reading a mixed file cannot tell which meaning a given `assert: null` carries. Consumers
// must branch on v before drawing conclusions from that field (metrics.mjs does).
const SCHEMA_V = 2;
const SAMPLE_MS = 500;                 // odometer / vitals sampler
const GUARD_ROLLUP_MS = 60000;         // guard counters, only when something changed
const DIG_BATCH = 64;
// Continuous position trace (#69 gap 2): a `pos` event outside task/goto spans, so playcheck
// can tell "moving" from "task open but wedged in place" directly instead of inferring it from
// span coverage, and so roads-v2 has waypoints to mine for real foot traffic. Cost-gated on
// PURPOSE, not a bare timer: emit on real displacement (route shape, cheap while idle) OR a
// heartbeat ceiling (so a frozen bot still produces repeated-same-position records instead of
// silence, which a reader could otherwise mistake for "no signal" rather than "stuck here").
// Piggybacks the existing 500ms sampler tick — no second interval, no extra position read.
const POS_MOVE_EPS = 6;                // blocks of displacement before a fresh sample
const POS_HEARTBEAT_MS = 30000;        // max gap between samples even standing still

const INV_KEYS = ['torch', 'cobblestone', 'oak_log', 'oak_planks', 'bread', 'coal', 'raw_iron',
  'iron_ingot', 'diamond', 'stick', 'dirt', 'wheat', 'iron_pickaxe', 'stone_pickaxe',
  'wooden_pickaxe', 'iron_axe', 'iron_sword', 'shield', 'water_bucket'];

const SALIENT = {
  come: (a) => ({ range: a.range ?? 1 }),
  collectDrops: (a) => ({ radius: a.radius ?? 16 }),
  chopTrees: (a) => ({ types: a.types ?? 'any', count: a.count ?? 1, replant: a.replant !== false }),
  mineLane: (a) => ({ target: a.target, count: a.count ?? 8, vein: a.vein !== false }),
  huntAnimals: (a) => ({ species: a.species ?? ['cow'], count: a.count ?? 1 }),
  safeDescend: (a) => ({ toY: a.toY, torchEvery: a.torchEvery ?? 8 }),
  buildStaircase: (a) => ({ toY: a.toY, material: a.material ?? 'cobblestone_stairs' }),
  buildWall: (a) => ({ material: a.material, cells: (a.width ?? 5) * (a.height ?? 3) }),
  buildFloor: (a) => ({ material: a.material, cells: (a.width ?? 5) * (a.length ?? 5) }),
  frameStructure: (a) => ({ w: a.width, d: a.depth, h: a.height }),
  buildSchematic: (a) => ({ name: a.name }),
  depositToChest: (a) => ({ keepTools: a.keepTools !== false }),
};

// ---- args digest: groups identical CALL SHAPES without storing driver coordinates ----
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object')
    ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {})
    : v;
function adg(args) {                                  // FNV-1a 32-bit, 8 hex
  let s;
  try { s = JSON.stringify(canon(args ?? {})); } catch (_) { s = '{}'; }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---- continuous position trace gate (#69 gap 2): pure, so the heartbeat path is testable
// without waiting real seconds for it — same discipline as #53's moveDetect and #54's
// findRepositionTarget extractions ("a rule testable only by staging the bug does not stay
// tested"). `from`/`to` are {x,y,z}; `lastEmitAt`/`now` are epoch ms. `from`/`lastEmitAt` of
// null are "never emitted yet" and always fire (Infinity distance/elapsed).
function shouldEmitPos(from, to, lastEmitAt, now) {
  const d = from ? Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2 + (to.z - from.z) ** 2) : Infinity;
  const since = lastEmitAt ? now - lastEmitAt : Infinity;
  return d >= POS_MOVE_EPS || since >= POS_HEARTBEAT_MS;
}

// ---- route classes (4.8): distance band x vertical character ----
function routeClass(from, to) {
  try {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    const band = flat < 16 ? 'SHORT' : flat < 64 ? 'MEDIUM' : flat < 160 ? 'LONG' : 'HAUL';
    const vert = dy <= -12 ? 'DESCENT' : dy >= 12 ? 'ASCENT' : 'LEVEL';
    return band + '_' + vert;
  } catch (_) { return 'UNKNOWN'; }
}

// ---- the closed outcome enum (4.5). Top-down, FIRST MATCH WINS. ----
// Deliberately a pure function of (task, span, flags) so it can be unit-tested and so the
// classification can never depend on the code whose honesty it is judging.
const TIMEOUT_CODES = new Set(['timeout', 'path_timeout', 'chest_open_timeout', 'dig_timeout', 'equip_timeout']);
const NOT_FOUND_CODES = new Set(['not_found', 'unreachable']);
const BAD_INPUT_CODES = new Set(['bad_args', 'unknown_skill', 'busy', 'queue_full']);
function classify(task, span) {
  const code = task && task.error ? task.error.code : null;
  const s = span || {};
  if (s.deaths > 0) return 'death';
  if ((task && task._disconnected) || code === 'disconnected') return 'disconnected';
  if (code && TIMEOUT_CODES.has(code) && !(s.unsticks > 0)) {
    // path_timeout with no movement is a wedge, not a timeout — checked below
    if (!(code === 'path_timeout' && s.moved < 2)) return 'timeout';
  }
  if (code === 'stuck' || s.unsticks >= 1 || (code === 'path_timeout' && s.moved < 2)) return 'wedge';
  if (code === 'kit_missing') return 'kit_missing';
  if (code === 'no_tool' || s.toolBreaks > 0) return 'no_tool';
  if (code === 'reach_violation' || (s.reach_viol > 0 && !(task && task.done))) return 'reach_violation';
  if (code === 'low_health') return 'low_health';
  if (code === 'inv_full') return 'inv_full';
  if (code === 'no_path') return 'no_path';
  if (code && NOT_FOUND_CODES.has(code)) return 'not_found';
  if (task && task.cancelled && !task.error) return 'cancelled';
  if (code && BAD_INPUT_CODES.has(code)) return 'bad_input';
  if (code) return 'error';
  if (task && task.done) return s.assertFail ? 'false_success' : 'ok';
  return 'error';
}

function install(bot, opts = {}) {
  const name = opts.name || (bot && bot.username) || 'unknown';
  const dir = opts.dir || path.join(__dirname, 'logs');
  const run = 'r' + Math.floor(Date.now() / 1000);
  let seq = 0;
  let stream = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    stream = fs.createWriteStream(path.join(dir, `metrics-${name}.jsonl`), { flags: 'a' });
    stream.on('error', () => { M.writeErrors++; });
  } catch (_) { stream = null; }

  const M = {
    v: SCHEMA_V, run, bot: name, enabled: true,
    written: 0, writeErrors: 0, dropped: 0,
    pathListeners: 0,          // how many path_* listeners WE own — runner's orphan detector
                               // subtracts this, otherwise instrumenting movement would make
                               // every bot permanently look like it has a leaked goto.
    task: null,                // current task span
    goto: null,                // current goto span
    _lastGotoGid: null,        // most recently CLOSED goto span's id (see M.recovery)
    lastSample: 0,
    odometer: 0,
    _lastPos: null,
    _lastHp: null,
    _digs: 0, _digsSinceBatch: 0, _placed: 0,
    _toolSeen: null,
    _guardPrev: {},
    _posEmitPos: null, _posEmitAt: 0,     // continuous position trace gate (#69 gap 2)
  };

  const emit = (ev, fields) => {
    try {
      if (!M.enabled || !stream) { M.dropped++; return; }
      const rec = Object.assign({ v: SCHEMA_V, t: Date.now(), bot: name, run, seq: ++seq, ev }, fields || {});
      stream.write(JSON.stringify(rec) + '\n');
      M.written++;
    } catch (_) { M.writeErrors++; }
  };
  M.emit = emit;

  // ---------- small readers, all defensive: telemetry must never throw into gameplay ----------
  const pos3 = () => { try { const p = bot.entity.position; return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]; } catch (_) { return null; } };
  const invSnap = () => {
    const out = {};
    try { for (const it of bot.inventory.items()) if (INV_KEYS.includes(it.name)) out[it.name] = (out[it.name] || 0) + it.count; } catch (_) {}
    return out;
  };
  const heldInfo = () => { try { const d = globalThis.__danger; return d && d.held ? d.held : null; } catch (_) { return null; } };
  const dangerInfo = () => { try { const d = globalThis.__danger; return d ? { score: d.score, state: d.state } : null; } catch (_) { return null; } };
  const skyInfo = () => { try { const d = globalThis.__danger; return d ? d.surfaceExposed : null; } catch (_) { return null; } };
  const profName = () => {
    try {
      const mv = bot.pathfinder && bot.pathfinder.movements;
      if (!mv) return 'unknown';
      if (mv.digCost === 15) return 'HAUL';
      if (mv.digCost === 25) return 'WORK';
      if (mv.digCost === 1 && mv.maxDropDown === 2) return 'CAVE';
      return 'base';
    } catch (_) { return 'unknown'; }
  };
  const guardCounts = () => {
    const g = {};
    try { if (globalThis.__reachguard) g.reach_viol = globalThis.__reachguard.violations || globalThis.__reachguard.rejected || 0; } catch (_) {}
    try { if (globalThis.__digguard) g.dig_blocked = globalThis.__digguard.blocked || 0; } catch (_) {}
    try { if (globalThis.__toolguard) { const s = globalThis.__toolguard; g.tool_rejected = s.rejected || 0; g.tool_equipped = s.equipped || 0; } } catch (_) {}
    try { if (globalThis.__idleguard) g.idle_runs = globalThis.__idleguard.runs || 0; } catch (_) {}
    try { if (globalThis.__survival) g.panics = globalThis.__survival.fires || 0; } catch (_) {}
    return g;
  };
  M.guardCounts = guardCounts;

  // ---------- 500 ms sampler: odometer, damage, tool wear ----------
  // The odometer exists because straight-line displacement systematically understates travel
  // and would flatter every path-efficiency number. SPL needs real distance walked.
  const sampler = setInterval(() => {
    try {
      if (!bot.entity || !bot.entity.position) return;
      const p = bot.entity.position;
      if (M._lastPos) {
        const d = Math.sqrt((p.x - M._lastPos.x) ** 2 + (p.y - M._lastPos.y) ** 2 + (p.z - M._lastPos.z) ** 2);
        if (d > 0.05 && d < 40) {            // >40 in 500ms is a teleport/respawn, not travel
          M.odometer += d;
          if (M.task) M.task.moved += d;
          if (M.goto) M.goto.moved += d;
        }
      }
      M._lastPos = { x: p.x, y: p.y, z: p.z };
      // continuous position trace (#69 gap 2): distance-or-heartbeat gated, see shouldEmitPos.
      try {
        const now = Date.now();
        if (shouldEmitPos(M._posEmitPos, p, M._posEmitAt, now)) {
          emit('pos', { tid: M.task ? M.task.tid : null, gid: M.goto ? M.goto.gid : null, pos: [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)], hp: bot.health });
          M._posEmitPos = { x: p.x, y: p.y, z: p.z };
          M._posEmitAt = now;
        }
      } catch (_) {}
      if (typeof bot.health === 'number') {
        if (M._lastHp != null && bot.health < M._lastHp) {
          const dmg = M._lastHp - bot.health;
          if (M.task) M.task.dmg += dmg;
        }
        M._lastHp = bot.health;
      }
      // tool-break watcher: durability that resets or an item that vanishes from the hand
      try {
        const h = bot.heldItem;
        if (h) {
          const max = h.maxDurability || 0;
          const left = max ? max - (h.durabilityUsed || 0) : null;
          if (M._toolSeen && M._toolSeen.name === h.name && left != null && M._toolSeen.left != null
            && left > M._toolSeen.left + 5) { /* replaced, not broken */ }
          M._toolSeen = { name: h.name, left };
        } else if (M._toolSeen && M._toolSeen.left != null && M._toolSeen.left <= 2) {
          emit('tool_break', { tool: M._toolSeen.name, tid: M.task ? M.task.tid : null, digs: M._digs });
          if (M.task) M.task.toolBreaks++;
          M._toolSeen = null;
        } else if (!h) M._toolSeen = null;
      } catch (_) {}
      M.lastSample = Date.now();
    } catch (_) {}
  }, SAMPLE_MS);
  if (sampler.unref) sampler.unref();

  // ---------- guard rollup: only when a counter actually moved ----------
  const rollup = setInterval(() => {
    try {
      const now = guardCounts();
      const diff = {};
      let changed = false;
      for (const [k, v] of Object.entries(now)) {
        const prev = M._guardPrev[k] || 0;
        if (v !== prev) { diff[k] = v - prev; changed = true; }
      }
      M._guardPrev = now;
      if (changed) emit('guard', { d: diff });
    } catch (_) {}
  }, GUARD_ROLLUP_MS);
  if (rollup.unref) rollup.unref();

  // ---------- listeners ----------
  const onSpawn = () => { M._lastPos = null; emit('connect', { state: 'spawn', pos: pos3() }); };
  const onEnd = (reason) => emit('connect', { state: 'end', reason: String(reason || '').slice(0, 60) });
  const onDeath = () => {
    if (M.task) M.task.deaths++;
    emit('death', { tid: M.task ? M.task.tid : null, pos: pos3() });
  };
  const onDig = () => {
    M._digs++; M._digsSinceBatch++;
    if (M.task) M.task.digs++;
    if (M._digsSinceBatch >= DIG_BATCH) {
      emit('dig_batch', { tid: M.task ? M.task.tid : null, digs: M._digsSinceBatch, held: heldInfo() });
      M._digsSinceBatch = 0;
    }
  };
  // pathfinder's own telemetry, aggregated per goto span rather than one record per replan
  const onPathUpdate = (r) => {
    try {
      if (!M.goto) return;
      M.goto.replans++;
      const st = r && r.status ? String(r.status) : 'unknown';
      M.goto.pf[st] = (M.goto.pf[st] || 0) + 1;
      if (r) {
        M.goto.nodes.visited += r.visitedNodes || 0;
        M.goto.nodes.generated += r.generatedNodes || 0;
        M.goto.nodes.ms += r.time || 0;
      }
    } catch (_) {}
  };
  const onPathReset = (reason) => {
    try {
      if (!M.goto) return;
      const k = String(reason || 'unknown');
      M.goto.resets[k] = (M.goto.resets[k] || 0) + 1;
    } catch (_) {}
  };
  bot.on('spawn', onSpawn);
  bot.on('end', onEnd);
  bot.on('death', onDeath);
  bot.on('diggingCompleted', onDig);
  bot.on('path_update', onPathUpdate);
  bot.on('path_reset', onPathReset);
  M.pathListeners = 1;                      // exactly one path_update listener is ours

  // ---------- public API used by skills.js (a payload; it cannot require()) ----------
  M.taskStart = (task, extra = {}) => {
    try {
      const kit = extra.kit || null;
      M.task = {
        tid: task.id, skill: task.name, adg: adg(task.args), t0: Date.now(),
        moved: 0, dmg: 0, digs: 0, placed: 0, deaths: 0, gotos: 0, wedges: 0,
        unsticks: 0, retries: 0, recoveries: 0, toolBreaks: 0, crow: 0, assert: null,
        guard0: guardCounts(),
      };
      let akey = null;
      try { akey = SALIENT[task.name] ? SALIENT[task.name](task.args || {}) : null; } catch (_) {}
      emit('task_start', {
        tid: task.id, skill: task.name, adg: M.task.adg, akey,
        src: extra.src || 'driver', qid: extra.qid || null,
        gap_ms: task._gapMs == null ? null : task._gapMs,
        pos: pos3(), hp: bot.health, food: bot.food,
        kit, inv: invSnap(), held: heldInfo(), danger: dangerInfo(), sky: skyInfo(),
        prof: profName(),
      });
    } catch (_) {}
  };

  // A kit rejection never creates a task, but it MUST still appear in the denominator —
  // otherwise refusing to depart looks like it never happened and success rates flatter.
  M.taskRejected = (skill, args, error) => {
    try {
      const tid = 'rej' + Date.now().toString(36);
      const a = adg(args);
      emit('task_start', { tid, skill, adg: a, akey: null, src: 'driver', pos: pos3(), hp: bot.health, food: bot.food, prof: profName() });
      emit('task_end', {
        tid, skill, adg: a, outcome: error && error.code === 'kit_missing' ? 'kit_missing' : 'bad_input',
        code: error ? error.code : null, msg: error && error.message ? String(error.message).slice(0, 160) : null,
        phase: 'preflight', phases: [], assert: null, yield: null, want: null, got: null,
        ms: 0, digs: 0, moved: 0, pos: pos3(), hp: bot.health, food: bot.food,
        kit_missing: error && error.missing ? error.missing : null,
      });
    } catch (_) {}
  };

  M.taskEnd = (task, assertResult) => {
    try {
      const sp = M.task && M.task.tid === task.id ? M.task : { moved: 0, dmg: 0, digs: 0, deaths: 0, gotos: 0, wedges: 0, unsticks: 0, retries: 0, recoveries: 0, toolBreaks: 0, crow: 0, guard0: {} };
      // Tri-state, not boolean-in-disguise: assert is the graded RULE NAME whenever
      // assertTask actually graded this task (pass or fail alike), and null ONLY when
      // genuinely ungraded (assertResult absent — no ASSERTS entry, or not enough result
      // data to grade). Previously this held the rule on failure only, so a PASS and
      // "never graded" both wrote null — indistinguishable from the ledger alone, which
      // meant FSR read as a hollow 0/0 whenever nothing had ever failed, and the E6 gate's
      // assertionSet (built from this same field) silently missed every rule that only
      // ever passed. classify() below must NOT infer pass/fail from assert's truthiness
      // any more (that assumption is exactly what this fix breaks) — assertFail carries
      // pass/fail explicitly now, and assert is purely "was this graded, and by what."
      sp.assert = assertResult ? assertResult.rule : null;
      sp.assertFail = Boolean(assertResult && assertResult.fail);
      const outcome = classify(task, sp);
      const g1 = guardCounts();
      const gd = (k) => Math.max(0, (g1[k] || 0) - ((sp.guard0 || {})[k] || 0));
      const moved = Math.round(sp.moved * 10) / 10;
      const crow = Math.round(sp.crow * 10) / 10;
      emit('task_end', {
        tid: task.id, skill: task.name, adg: sp.adg || adg(task.args),
        outcome, code: task.error ? task.error.code : null,
        msg: task.error && task.error.message ? String(task.error.message).slice(0, 160) : null,
        phase: (task.error && task.error.phase) || task.phase || null,
        phases: (task.phases || []).slice(0, 12),
        assert: sp.assert,
        yield: assertResult && assertResult.yield != null ? assertResult.yield : null,
        want: assertResult ? assertResult.want : null, got: assertResult ? assertResult.got : null,
        collected: task.collected || {},
        result: task.result || null,
        ms: (task.endedAt || Date.now()) - task.startedAt,
        digs: sp.digs, placed: sp.placed, moved, crow,
        spl: outcome === 'ok' && moved > 0 ? Math.round((crow / Math.max(moved, crow)) * 1000) / 1000 : null,
        dmg: Math.round(sp.dmg * 10) / 10, deaths: sp.deaths,
        gotos: sp.gotos, wedges: sp.wedges, unsticks: sp.unsticks, retries: sp.retries, recoveries: sp.recoveries,
        panics: gd('panics'), reach_viol: gd('reach_viol'), dig_blocked: gd('dig_blocked'),
        pos: pos3(), hp: bot.health, food: bot.food,
        held: heldInfo(), danger: dangerInfo(),
      });
      if (M._digsSinceBatch > 0) { emit('dig_batch', { tid: task.id, digs: M._digsSinceBatch, held: heldInfo() }); M._digsSinceBatch = 0; }
    } catch (_) {}
    M.task = null;
  };

  M.gotoStart = (goal, timeoutMs) => {
    try {
      const from = pos3();
      let to = null, range = null;
      try {
        if (goal && typeof goal.x === 'number') to = [goal.x, goal.y == null ? (from ? from[1] : 0) : goal.y, goal.z];
        if (goal && typeof goal.range === 'number') range = goal.range;
      } catch (_) {}
      const crow = (from && to) ? Math.sqrt((to[0] - from[0]) ** 2 + (to[1] - from[1]) ** 2 + (to[2] - from[2]) ** 2) : 0;
      M.goto = {
        gid: 'g' + Date.now().toString(36), t0: Date.now(), from, to, range, crow,
        moved: 0, unsticks: 0, replans: 0, pf: {}, nodes: { visited: 0, generated: 0, ms: 0 }, resets: {},
        tmo: timeoutMs || null, goal: goal && goal.constructor ? goal.constructor.name : 'unknown',
      };
      if (M.task) { M.task.gotos++; M.task.crow += crow; }
      return M.goto.gid;
    } catch (_) { return null; }
  };
  M.gotoEnd = (res, assertFail) => {
    try {
      const s = M.goto;
      if (!s) return;
      M._lastGotoGid = s.gid;    // recovery() fires from the caller's catch, after this span
                                 // has already closed — this is how it links back to the
                                 // FAILED span rather than reporting gid:null.
      M.goto = null;
      if (s.unsticks > 0 && M.task) M.task.wedges++;
      emit('goto', {
        tid: M.task ? M.task.tid : null, gid: s.gid, goal: s.goal, range: s.range,
        from: s.from, to: s.to, crow: Math.round(s.crow * 10) / 10,
        moved: Math.round(s.moved * 10) / 10, ms: Date.now() - s.t0, tmo: s.tmo,
        res: res || 'error', assert_fail: Boolean(assertFail), unsticks: s.unsticks,
        prof: profName(), class: (s.from && s.to) ? routeClass({ x: s.from[0], y: s.from[1], z: s.from[2] }, { x: s.to[0], y: s.to[1], z: s.to[2] }) : 'UNKNOWN',
        replans: s.replans, pf: s.pf, nodes: s.nodes, resets: s.resets,
      });
    } catch (_) {}
  };
  M.unstick = (why) => {
    try {
      if (M.goto) M.goto.unsticks++;
      if (M.task) M.task.unsticks++;
      emit('wedge', { tid: M.task ? M.task.tid : null, gid: M.goto ? M.goto.gid : null, why: why || 'nuisance', pos: pos3() });
    } catch (_) {}
  };
  M.retry = () => { try { if (M.task) M.task.retries++; } catch (_) {} };
  // R2+ recovery-ladder rung fired mid-goto (#54: gotoR/_reposition). `attempt` is the rung's
  // own 1-based retry counter within its caller. `extra` is optional and rung-specific (e.g.
  // R2: {displaced}) — kept loose so a future rung (R3 dig-escalation, movement-scarring's
  // proposal) needs no telemetry.js change, only a new `rung` value plus whatever it reports.
  // `gid` is the FAILED goto span's id, not the current one: gotoEnd's `finally` always runs
  // before the caller's `catch`, so M.goto is already null here (see `_lastGotoGid`). A reader
  // pairs this record with the goto immediately before it (the failure) and the goto
  // immediately after it on the same tid (the retry's own outcome) — which is how the
  // DISPLACEMENT term and the RE-PLAN term get scored separately without a bespoke join key,
  // per eng-2's #54-review prediction that the re-issued A*, not the reposition, is the win.
  M.recovery = (rung, attempt, extra) => {
    try {
      if (M.task) M.task.recoveries = (M.task.recoveries || 0) + 1;
      emit('recovery', { tid: M.task ? M.task.tid : null, gid: M._lastGotoGid || null, rung, attempt, ...(extra || {}), pos: pos3() });
    } catch (_) {}
  };
  M.placed = () => { try { M._placed++; if (M.task) M.task.placed++; } catch (_) {} };
  M.craft = (item, times, made, reason) => emit('craft', { tid: M.task ? M.task.tid : null, item, want: times, got: made, reason: reason || null });
  M.chest = (kind, at, moved) => emit('chest', { tid: M.task ? M.task.tid : null, kind, at, moved });
  M.danger = (state, prev, score, threat) => emit('danger', { state, prev, score, threat: threat || null, pos: pos3() });
  M.panic = (phase, branch, hp) => emit('panic', { phase, branch, hp, pos: pos3() });

  M.snapshot = () => ({
    run, written: M.written, dropped: M.dropped, writeErrors: M.writeErrors,
    odometer: Math.round(M.odometer), digs: M._digs, pathListeners: M.pathListeners,
    task: M.task ? { tid: M.task.tid, skill: M.task.skill, moved: Math.round(M.task.moved) } : null,
    goto: M.goto ? { gid: M.goto.gid, replans: M.goto.replans } : null,
  });

  M.close = () => {
    M.enabled = false;
    try { clearInterval(sampler); clearInterval(rollup); } catch (_) {}
    for (const [e, fn] of [['spawn', onSpawn], ['end', onEnd], ['death', onDeath],
      ['diggingCompleted', onDig], ['path_update', onPathUpdate], ['path_reset', onPathReset]]) {
      try { bot.removeListener(e, fn); } catch (_) {}
    }
    M.pathListeners = 0;
    try { if (stream) stream.end(); } catch (_) {}
  };

  globalThis.__metrics = M;
  // No `engine` field here on purpose. install() runs inside createBot, BEFORE the first
  // spawn injects the payload stack, so globalThis.__skills does not exist yet and this
  // could only ever have written null — a field that is structurally always empty looks
  // like data and isn't. Version attribution is emitted as its own `versions` record by
  // applyPayloadStack once the stack has actually landed, where it can be truthful, and
  // re-emitted on every spawn so a reconnect picking up edited payloads is recorded.
  emit('session', { role: opts.role || null, mcHost: opts.host || null, node: process.version });
  return M;
}

module.exports = { install, classify, adg, routeClass, SALIENT, INV_KEYS, SCHEMA_V, shouldEmitPos, POS_MOVE_EPS, POS_HEARTBEAT_MS };
