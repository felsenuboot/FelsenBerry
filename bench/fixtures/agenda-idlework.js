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
const saved = { project: A.project, idleAt: A._idleAt, owner: A.owner,
  barren: A._barren, backoff: A._relocateBackoff, wander: A._wander, lastIdle: A._lastIdleWork,
  baseChoreLit: A._baseChoreLit, baseChoreAt: A._baseChoreCheckedAt };
const realStart = S.start;
let started = [];
S.start = (b, name, args) => { started.push(name); return { ok: true, taskId: 'stub' }; };
A.busy = true;
const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });
const fire = (role, extra) => { started = []; A._idleAt = 0; R.act(Object.assign({ now: Date.now(), task: null, role, pos: { x: 0, y: 40, z: 0 }, torches: 0 }, extra)); return started[0] || null; };

try {
  A.project = null;
  T('miner UNDERGROUND mines a lane', fire('miner', { pos: { x: 0, y: 40, z: 0 } }), 'mineLane');
  T('miner on the SURFACE descends first', fire('miner', { pos: { x: 0, y: 70, z: 0 } }), 'safeDescend');
  T('lumberjack chops', fire('lumberjack'), 'chopTrees');
  // #45 landed (huntAnimals' kit is 'hunt': {torches, weapon:true} — no foodItems at all), and
  // ROLE_WORK.hunter was updated to match (2026-09-02, the gear-race food-deadlock fix) — a
  // foodless hunter is no longer refused, since the gate never asked for food to begin with.
  // This case used to assert the OLD stopgap (harvestGrass); it now asserts the real fix.
  T('hunter hunts (kit is weapon-gated, not food-gated, since #45)', fire('hunter'), 'huntAnimals');
  T('farmer harvests (farmCycle needs a field, so not that)', fire('farmer'), 'harvestGrass');
  T('builder with torches lights the base', fire('builder', { torches: 8 }), 'spawnProof');
  T('builder without torches gathers wood', fire('builder', { torches: 0 }), 'chopTrees');
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

  // ---- #67b: base-barren detection + relocate trigger ----
  // Restore the recording stub (the refused-work case above swapped it for a rejecting one).
  S.start = (b, name, args) => { started.push(name); return { ok: true, taskId: 'stub' }; };
  const O = A._idleWorkOutcome;
  // classifier — the load-bearing pure function. barren means "nothing of this kind here".
  T('chopTrees not_found -> barren', O('chopTrees', null, { code: 'not_found' }), 'barren');
  T('chopTrees felled>0 -> worked', O('chopTrees', { treesFelled: 2 }, null), 'worked');
  T('chopTrees felled 0 -> barren', O('chopTrees', { treesFelled: 0 }, null), 'barren');
  T('safeDescend no net descent -> barren', O('safeDescend', { startY: 70, endY: 70 }, null), 'barren');
  T('safeDescend descended -> worked', O('safeDescend', { startY: 70, endY: 45 }, null), 'worked');
  T('harvestGrass cut 0 -> barren', O('harvestGrass', { cut: 0 }, null), 'barren');
  T('harvestGrass cut>0 -> worked', O('harvestGrass', { cut: 5 }, null), 'worked');
  T('mineLane dug 0 -> barren', O('mineLane', { dug: 0 }, null), 'barren');
  T('mineLane dug>0 -> worked', O('mineLane', { dug: 16 }, null), 'worked');
  T('kit_missing is OTHER, never barren', O('chopTrees', null, { code: 'kit_missing' }), 'other');
  T('relocate that moved -> worked', O('relocateToWork', { relocated: true }, null), 'worked');
  T('relocate found nothing -> barren', O('relocateToWork', { relocated: false }, null), 'barren');
  T('unknown skill defaults to worked (never relocate blindly)', O('astronaut', {}, null), 'worked');

  const done = (id, result, error, extra) => Object.assign({ id, running: false, error: error || null, _raw: { result: result || null } }, extra);

  // a barren no-op increments the counter (backoff gates the relocate so we read the raw count)
  A._barren = 0; A._relocateBackoff = Date.now() + 1e9; A._wander = 0;
  A._lastIdleWork = { id: 't1', skill: 'chopTrees' }; started = []; A._idleAt = 0;
  R.act({ now: Date.now(), task: done('t1', null, { code: 'not_found' }), role: 'lumberjack' });
  T('barren no-op increments barren', A._barren, 1);

  // a productive run clears the count
  A._barren = 3; A._relocateBackoff = Date.now() + 1e9;
  A._lastIdleWork = { id: 't2', skill: 'chopTrees' }; started = []; A._idleAt = 0;
  R.act({ now: Date.now(), task: done('t2', { treesFelled: 2 }), role: 'lumberjack' });
  T('a productive run clears the barren count', A._barren, 0);

  // a cancelled run is NOT counted barren
  A._barren = 0; A._relocateBackoff = Date.now() + 1e9;
  A._lastIdleWork = { id: 't4', skill: 'chopTrees' }; started = []; A._idleAt = 0;
  R.act({ now: Date.now(), task: { id: 't4', running: false, error: null, _raw: { cancelled: true, result: null } }, role: 'lumberjack' });
  T('a cancelled run is not counted as barren', A._barren, 0);

  const relFire = (role, extra) => { A._lastIdleWork = null; started = []; A._idleAt = 0; R.act(Object.assign({ now: Date.now(), task: null, role, pos: { x: 0, y: 40, z: 0 }, torches: 0 }, extra)); return started[0] || null; };

  // barren + a RELOCATABLE trade -> walk to fresh terrain instead of re-scanning empty ground
  A._barren = 1; A._relocateBackoff = 0; A._wander = 0;
  T('barren lumberjack relocates', relFire('lumberjack'), 'relocateToWork');
  A._barren = 1; A._relocateBackoff = 0;
  T('barren miner on surface relocates (safeDescend is relocatable)', relFire('miner', { pos: { x: 0, y: 70, z: 0 } }), 'relocateToWork');
  A._barren = 1; A._relocateBackoff = 0;
  T('barren miner underground relocates (mineLane is relocatable)', relFire('miner', { pos: { x: 0, y: 40, z: 0 } }), 'relocateToWork');

  // an inherently-LOCAL job never relocates, however barren
  A._barren = 5; A._relocateBackoff = 0;
  T('barren builder still lights the base (spawnProof not relocatable)', relFire('builder', { torches: 8 }), 'spawnProof');

  // relocate is BACKOFF-gated: while parked it must not fire, the trade runs instead
  A._barren = 3; A._relocateBackoff = Date.now() + 1e9; A._wander = 0;
  T('relocate is gated by backoff, trade runs meanwhile', relFire('lumberjack'), 'chopTrees');

  // a relocate that found nowhere sets that backoff (so the bot stops pacing)
  A._barren = 1; A._relocateBackoff = 0; A._wander = 0;
  A._lastIdleWork = { id: 't5', skill: 'relocateToWork' }; started = []; A._idleAt = 0;
  const before = Date.now();
  R.act({ now: before, task: done('t5', { relocated: false, reason: 'no_reachable_spot' }), role: 'lumberjack' });
  T('relocate that found nowhere sets a backoff', A._relocateBackoff > before, true);

  // ---- #72: builder base-chore latch (don't re-scan an already-lit base) ----
  T('spawnProof placed>0 -> worked', A._idleWorkOutcome('spawnProof', { placed: 3 }, null), 'worked');
  T('spawnProof placed 0 -> barren (base already lit)', A._idleWorkOutcome('spawnProof', { placed: 0 }, null), 'barren');

  // builder with a FRESH "base lit" latch gathers instead of re-scanning
  A._baseChoreLit = true; A._baseChoreCheckedAt = Date.now();
  T('builder gathers once base is proven lit', fire('builder', { torches: 8 }), 'chopTrees');
  // ...but a STALE latch (>10min) re-checks lighting for new dark spots
  A._baseChoreLit = true; A._baseChoreCheckedAt = Date.now() - 11 * 60000;
  T('builder re-checks lighting after ~10min', fire('builder', { torches: 8 }), 'spawnProof');
  A._baseChoreLit = false; A._baseChoreCheckedAt = 0;

  // gradeIdleWork: a spawnProof no-op SETS the latch and does not disturb the barren counter
  A._baseChoreLit = false; A._barren = 2; A._relocateBackoff = Date.now() + 1e9;   // gate relocate to isolate the grade
  A._lastIdleWork = { id: 's1', skill: 'spawnProof' }; started = []; A._idleAt = 0;
  R.act({ now: Date.now(), task: done('s1', { placed: 0 }), role: 'builder', torches: 8 });
  T('spawnProof no-op sets the base-lit latch', A._baseChoreLit === true, true);
  T('...and does NOT touch the barren/relocate counter', A._barren, 2);
  // a productive spawnProof clears the latch (base had dark spots -> keep proofing next cycle)
  A._baseChoreLit = true;
  A._lastIdleWork = { id: 's2', skill: 'spawnProof' }; started = []; A._idleAt = 0;
  R.act({ now: Date.now(), task: done('s2', { placed: 2 }), role: 'builder', torches: 8 });
  T('a productive spawnProof clears the latch', A._baseChoreLit === false, true);

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
  return out;
} finally {
  S.start = realStart; A.project = saved.project; A._idleAt = saved.idleAt; A.owner = saved.owner; A.busy = false;
  A._barren = saved.barren; A._relocateBackoff = saved.backoff; A._wander = saved.wander; A._lastIdleWork = saved.lastIdle;
  A._baseChoreLit = saved.baseChoreLit; A._baseChoreCheckedAt = saved.baseChoreAt;
}
