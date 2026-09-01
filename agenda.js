// agenda v1 payload (inject via POST /eval, idempotent) — THE AUTONOMOUS AGENDA.
//
// The deterministic "brain" that makes a bot self-sufficient with no driver in the loop.
// Architecture A (priority ladder) per research/AGENDA-DESIGN.md, with D's test-hook graft.
//
// The whole thesis, and the determinism codicil made concrete: the LLM sets ONLY the
// project, once, via __agenda.setProject(). After that the ladder runs it at ZERO tokens
// per cycle. A pure state->action function decides what to do next; no LLM, no HTTP poll,
// no remote blockAt (the stale-chunk quirk makes remote reads a lie).
//
// TEN FIXED RUNGS, evaluated top-down, first fire() wins:
//   P0a REFLEX  yield to survival.js        P1c EAT        food<=17
//   P0b POSTURE danger 'alert'              P1d TOOL       missing or dur<=15%
//   P1a EAT_CRITICAL food<=6                P1e RESTOCK    below the departure floor
//   P1b DEPOSIT freeSlots<=2                P1f LIGHT      dark and carrying torches
//   P2  PROJECT the assigned goal           P3  IDLE       the floor, never clears
//
// Three arbitration rules, and nothing else:
//   1. Higher always preempts (REFLEX/POSTURE instantly; others after a 2-tick debounce
//      that absorbs sensor noise).
//   2. The owner LATCHES until its clear() holds — this, plus per-rung dual thresholds, is
//      what stops eat/mine/eat oscillation. fire() and clear() are deliberately different
//      thresholds on every rung; that gap IS the hysteresis.
//   3. Lower never steals. IDLE runs only when literally nothing above it fires.
//
// SUBSUMES idleguard: exactly ONE deliberative loop may exist. Two of them fight over goals
// and produce the GoalChanged loops and false physics-freezes that dominate our field
// reports. Install stops idleguard (v8+ goes inert in place, so the dig-guard stack above
// it survives — verified).
//
// Test hooks (mandatory, the soak benchmark cannot score without them):
//   __agenda.step(snapshot?)  -> {rung, action} chosen WITHOUT executing (deterministic replay)
//   __agenda.sense(inject?)   -> the snapshot; accepts a synthetic world
//   __agenda.rung(id)         -> the rung object, so fire/clear/act are individually callable
//
// Remove: __agenda.stop()
if (globalThis.__agenda && globalThis.__agenda.stop) { try { globalThis.__agenda.stop(); } catch (e) {} }

const TICK_MS = 2000;              // deliberative only — safety never depends on this
const MIN_SWITCH_MS = 1500;        // anti-flap floor (safety rungs exempt)
const PREEMPT_DEBOUNCE = 2;        // ticks a non-safety rung must hold to preempt a running task
const POSTURE_DWELL_MS = 3000;
// A single act() that never settles freezes the WHOLE ladder: tick() returns early on
// A.busy, so one hung await silently ends autonomy. Found live — a TOOL act stalled and the
// brain sat at busy:true with zero ticks for minutes, owner null, timer alive, looking
// perfectly healthy from outside. For a bot meant to run driverless for hours that is the
// worst failure shape there is, so every act is raced against a cap and the loop always
// gets its `busy` flag back. ensureTool can legitimately travel and craft, hence 180s.
const ACT_TIMEOUT_MS = 180000;

const A = {
  version: 1, enabled: true,
  owner: null, ownerSince: 0, busy: false, busySince: 0, busyStuck: 0,
  project: null, activeTaskId: null, pendingPreempt: null,
  lastSense: null, blocked: null, calmSince: 0,
  standDown: {}, standDownCount: {},
  metrics: { ticks: 0, transitions: 0, acts: 0, errors: 0, byRung: {} },
  log: [],
};
globalThis.__agenda = A;

const now = () => Date.now();
const note = (msg) => {
  A.log.push({ t: now(), msg: String(msg).slice(0, 160) });
  if (A.log.length > 60) A.log.splice(0, A.log.length - 60);
  try {
    const S = globalThis.__skills;
    if (S && Array.isArray(S.log)) { S._seq = (S._seq || 0) + 1; S.log.push({ seq: S._seq, lvl: 'info', msg: 'agenda: ' + msg }); }
  } catch (e) {}
};
const M = () => { try { return globalThis.__metrics; } catch (e) { return null; } };

const cfg = (() => {
  try {
    const fs = process.mainModule.require('fs');
    const np = process.mainModule.require('path');
    return JSON.parse(fs.readFileSync(np.join(np.dirname(process.mainModule.filename), 'protected.json'), 'utf8'));
  } catch (e) { return {}; }
})();
const HOME = Array.isArray(cfg.home) ? { x: cfg.home[0], y: cfg.home[1], z: cfg.home[2] } : { x: -3, y: 111, z: 4 };
const DEPOT = (cfg.depot || {});

const FOODS = new Set(['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'apple', 'carrot', 'beetroot',
  'melon_slice', 'cookie', 'pumpkin_pie', 'mushroom_stew', 'beetroot_soup', 'rabbit_stew', 'dried_kelp']);
const FILLERS = new Set(['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite', 'granite']);
const ROLE_TOOL = { miner: 'pickaxe', lumberjack: 'axe', hunter: 'sword', builder: null, farmer: 'hoe' };
const ROLE_FLOOR = { miner: { torches: 16, food: 4, filler: 16 }, lumberjack: { torches: 8, food: 2 },
  hunter: { torches: 8, food: 4 }, builder: { torches: 8, food: 2 }, farmer: { food: 2 } };

// ---------------- sense(): ONE pure snapshot per tick, injectable for tests ----------------
const sense = (inject) => {
  if (inject) return Object.assign({ injected: true, now: now() }, inject);
  const s = { now: now(), injected: false, alive: false };
  try {
    s.alive = Boolean(bot && bot.entity && typeof bot.health === 'number' && bot.health > 0);
    if (!s.alive) return s;
    const p = bot.entity.position;
    s.pos = { x: p.x, y: p.y, z: p.z };
    s.hp = bot.health; s.food = bot.food;
    s.dHome = Math.sqrt((p.x - HOME.x) ** 2 + (p.y - HOME.y) ** 2 + (p.z - HOME.z) ** 2);

    const items = bot.inventory.items();
    s.freeSlots = bot.inventory.emptySlotCount();
    const total = (pred) => items.filter(pred).reduce((a, i) => a + i.count, 0);
    s.torches = total((i) => i.name === 'torch' || i.name === 'soul_torch');
    s.foodCount = total((i) => FOODS.has(i.name));
    s.filler = total((i) => FILLERS.has(i.name));

    // best tool per class, with durability — P1d's input
    s.tools = {};
    for (const it of items) {
      const m = /_(pickaxe|axe|shovel|hoe|sword)$/.exec(it.name);
      if (!m) continue;
      const cls = m[1];
      const max = it.maxDurability || 0;
      const dur = max ? Math.round(((max - (it.durabilityUsed || 0)) / max) * 100) : 100;
      if (!s.tools[cls] || dur > s.tools[cls].dur) s.tools[cls] = { name: it.name, dur };
    }

    const d = globalThis.__danger;
    s.dangerState = d ? d.state : 'calm';
    s.dangerScore = d ? d.score : 0;
    s.light = d ? d.light : null;
    s.surfaceExposed = d ? d.surfaceExposed : null;
    s.threat = d && d.nearest ? d.nearest : null;

    const sv = globalThis.__survival;
    s.survivalActive = Boolean(sv && sv.active);

    const S = globalThis.__skills;
    s.task = S && S.currentTask ? {
      id: S.currentTask.id, name: S.currentTask.name, running: S.currentTask.running,
      done: S.currentTask.done, error: S.currentTask.error,
    } : null;
    s.role = (globalThis.__idleguard && globalThis.__idleguard.role) || A.role || null;
  } catch (e) { A.metrics.errors++; }
  return s;
};

// ---------------- helpers ----------------
const activeClass = (s) => {
  if (A.project && A.project.tool) return A.project.tool;
  return ROLE_TOOL[s.role] || null;
};
const activeFloors = (s) => {
  if (A.project && A.project.restockFloor) return A.project.restockFloor;
  return ROLE_FLOOR[s.role] || null;
};
const skillRunning = (s) => Boolean(s.task && s.task.running);
const oursRunning = (s) => Boolean(s.task && s.task.running && s.task.id === A.activeTaskId);

// Start a skill and remember it as ours. Deliberately never throws: a rung that cannot act
// must fall through on the next tick, not take the loop down.
const runSkill = (name, args, why) => {
  try {
    const S = globalThis.__skills;
    if (!S || !S.start) return { ok: false, error: { code: 'no_engine' } };
    const r = S.start(bot, name, args || {});
    if (r && r.ok) { A.activeTaskId = r.taskId; note(`${why}: started ${name}`); A.metrics.acts++; }
    else note(`${why}: ${name} refused (${r && r.error && r.error.code})`);
    return r;
  } catch (e) { A.metrics.errors++; return { ok: false, error: { code: 'threw', message: e.message } }; }
};

const eatInline = async () => {
  try {
    if (!bot.autoEat || bot.food >= 20) return false;
    const prev = bot.autoEat.options.startAt;
    try { bot.autoEat.options.startAt = 20; await bot.autoEat.eat(); return true; }
    finally { bot.autoEat.options.startAt = prev; }
  } catch (e) { return false; }
};

const torchInline = async () => {
  try {
    const t = bot.inventory.items().find((i) => i.name === 'torch');
    if (!t) return false;
    const feet = bot.entity.position.floored();
    const ref = bot.blockAt(feet.offset(0, -1, 0));
    if (!ref || ref.boundingBox !== 'block') return false;
    await bot.equip(t, 'hand');
    await bot.placeBlock(ref, new Vec3(0, 1, 0));
    return true;
  } catch (e) { return false; }
};

// ---------------- the ten rungs ----------------
const RUNGS = [
  { id: 'REFLEX', prio: 0, safety: true,
    fire: (s) => s.survivalActive || s.dangerState === 'panic',
    clear: (s) => !s.survivalActive && s.dangerState !== 'panic',
    // Yield completely. survival.js owns the body; starting anything here would fight the
    // reflex, and the falling edge is survival's documented "driver decides" handback —
    // which is now us: we simply resume the ladder next tick.
    act: async () => { A.activeTaskId = null; return 'yield'; } },

  { id: 'POSTURE', prio: 1, safety: true,
    fire: (s) => s.dangerState === 'alert',
    clear: (s) => s.dangerState === 'calm' && (s.now - A.calmSince) > POSTURE_DWELL_MS,
    // Don't walk the project into a fight. This is the graduated step between calm and the
    // reflex, and it is what keeps panic entries and hostile exposure low.
    act: async (s) => {
      try {
        const sv = globalThis.__survival;
        const sword = bot.inventory.items().find((i) => /_sword$/.test(i.name) || /_axe$/.test(i.name));
        if (sword && (!bot.heldItem || bot.heldItem.name !== sword.name)) await bot.equip(sword, 'hand');
        if (sv && sv.shieldUp) { try { await sv.shieldUp(null); } catch (e) {} }
      } catch (e) {}
      if (oursRunning(s)) { try { globalThis.__skills.stop('agenda:posture'); } catch (e) {} A.activeTaskId = null; }
      if (s.surfaceExposed === false && (s.light == null || s.light < 8) && s.torches > 0) await torchInline();
      return 'hold';
    } },

  { id: 'EAT_CRITICAL', prio: 2,
    fire: (s) => s.food <= 6 && s.foodCount > 0,
    clear: (s) => s.food >= 19,
    act: async () => { await eatInline(); return 'ate'; } },

  { id: 'DEPOSIT', prio: 3,
    fire: (s) => s.freeSlots <= 2,
    clear: (s) => s.freeSlots >= 6,
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const pos = Array.isArray(DEPOT.minerals) ? { x: DEPOT.minerals[0], y: DEPOT.minerals[1], z: DEPOT.minerals[2] } : undefined;
      return runSkill('depositToChest', pos ? { pos } : {}, 'DEPOSIT').ok ? 'started' : 'refused';
    } },

  { id: 'EAT', prio: 4,
    fire: (s) => s.food <= 17 && s.foodCount > 0,
    clear: (s) => s.food >= 19,
    act: async () => { await eatInline(); return 'ate'; } },

  { id: 'TOOL', prio: 5,
    // "a broken tool outranks the job", made mechanical
    fire: (s) => { const c = activeClass(s); if (!c) return false; const b = s.tools[c]; return !b || b.dur <= 15; },
    clear: (s) => { const c = activeClass(s); if (!c) return true; const b = s.tools[c]; return Boolean(b && b.dur > 25); },
    act: async (s) => {
      const c = activeClass(s);
      if (!c) return 'none';
      try {
        const r = await globalThis.__skills.ensureTool(bot, c);
        if (!r.ok) {
          // genuine handback: the ladder cannot advance a tool-gated intent
          A.blocked = { why: 'no_tool', cls: c, at: now(), steps: r.steps };
          note(`tool_unavailable (${c}) — dropping to a rung that needs no tool`);
          return 'blocked';
        }
        A.blocked = null;
        return 'acquired:' + r.how;
      } catch (e) { A.metrics.errors++; return 'error'; }
    } },

  { id: 'RESTOCK', prio: 6,
    // a DEPARTURE gate, not an emergency: only fires when the active intent consumes it
    fire: (s) => {
      const f = activeFloors(s); if (!f) return false;
      if (f.torches && s.torches < f.torches) return true;
      if (f.food && s.foodCount < f.food) return true;
      if (f.filler && s.filler < f.filler) return true;
      return false;
    },
    clear: (s) => {
      const f = activeFloors(s); if (!f) return true;
      return (!f.torches || s.torches >= f.torches) && (!f.food || s.foodCount >= f.food)
        && (!f.filler || s.filler >= f.filler);
    },
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      // no withdraw-list skill exists yet; ctx.withdrawFromChest is task-scoped. Until a
      // `restock` skill lands, say so once and stand down rather than pretend.
      if (!A._restockWarned) { A._restockWarned = true; note('RESTOCK has no engine skill yet — needs a restock skill wrapping ctx.withdrawFromChest'); }
      A.blocked = { why: 'no_restock_skill', at: now() };
      return 'unimplemented';
    } },

  { id: 'LIGHT', prio: 7,
    fire: (s) => s.surfaceExposed === false && (s.light == null || s.light < 8) && s.torches > 0,
    clear: (s) => s.light != null && s.light >= 9,
    act: async () => { const p = await torchInline(); return p ? 'torched' : 'no_spot'; } },

  { id: 'PROJECT', prio: 8,
    fire: (s) => Boolean(A.project) && !projectDone(s) && !(A.blocked && A.blocked.why === 'no_tool'),
    clear: (s) => !A.project || projectDone(s),
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const p = A.project;
      if (!p || !p.skill) return 'none';
      const r = runSkill(p.skill, p.args, 'PROJECT');
      if (!r.ok) {
        p.attempts = (p.attempts || 0) + 1;
        p.lastError = r.error ? r.error.code : 'unknown';
        if (p.attempts >= 3) { p.blocked = p.lastError; note(`project blocked after 3 attempts: ${p.lastError}`); }
        return 'refused';
      }
      p.attempts = 0;
      return 'started';
    } },

  { id: 'IDLE', prio: 9,
    fire: () => true,                                   // the floor
    clear: () => false,                                 // never clears; only preemption moves us
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      if (s.now - (A._idleAt || 0) < 30000) return 'cooldown';   // don't spam the sweep
      A._idleAt = s.now;
      return runSkill('collectDrops', { radius: 16, timeoutMs: 15000 }, 'IDLE').ok ? 'sweeping' : 'refused';
    } },
];
const RUNG_BY_ID = RUNGS.reduce((o, r) => (o[r.id] = r, o), {});

function projectDone(s) {
  const p = A.project;
  if (!p) return true;
  if (p.blocked) return true;
  if (p.done) return true;
  if (p.repeat) return false;
  return Boolean(p.completedOnce);
}

// A rung that CANNOT make progress must not hold the body. Found live: RESTOCK fired with
// no implementation behind it, its clear() could never become true, and it latched forever —
// starving PROJECT and IDLE beneath it while the bot stood still. That is a general hazard of
// any priority ladder, not a quirk of one rung, so the fix is general: when an act reports no
// progress, stand the rung down with escalating backoff so everything below it can run. The
// need is still real and still re-fires later; it just stops being a deadlock.
const STAND_DOWN_MS = [30000, 60000, 120000, 300000];
const NO_PROGRESS = new Set(['unimplemented', 'blocked', 'refused', 'no_spot', 'none', 'error']);
const standDown = (id) => {
  const n = A.standDownCount[id] = (A.standDownCount[id] || 0) + 1;
  const ms = STAND_DOWN_MS[Math.min(n - 1, STAND_DOWN_MS.length - 1)];
  A.standDown[id] = now() + ms;
  note(`${id} made no progress — standing down ${Math.round(ms / 1000)}s so lower rungs can run`);
};
const safeFire = (r, s) => {
  try {
    if (!r.safety && A.standDown[r.id] && A.standDown[r.id] > s.now) return false;
    return Boolean(r.fire(s));
  } catch (e) { A.metrics.errors++; return false; }
};
const safeClear = (r, s) => { try { return Boolean(r.clear(s)); } catch (e) { A.metrics.errors++; return true; } };

// choose(s) is PURE: no side effects, so step() can dry-run it for deterministic replay
function choose(s) {
  const demanded = RUNGS.find((r) => safeFire(r, s)) || RUNG_BY_ID.IDLE;
  const owner = A.owner;
  if (owner && !safeClear(owner, s) && demanded.prio >= owner.prio) return { target: owner, demanded, latched: true };
  return { target: demanded, demanded, latched: false };
}

// ---------------- the tick ----------------
const tick = () => {
  if (globalThis.__agenda !== A || !A.enabled) { clearInterval(A.timer); return; }
  if (A.busy) {
    // second line of defence: if the race above ever fails to settle, don't stay frozen
    if (A.busySince && now() - A.busySince > ACT_TIMEOUT_MS + 30000) {
      A.busyStuck++; A.busy = false; A.owner = null;
      note('busy flag stuck past the act cap — force-released');
    }
    return;
  }
  A.metrics.ticks++;
  const s = sense();
  A.lastSense = s;
  if (!s.alive) return;
  if (s.dangerState === 'calm' && A.calmSince === 0) A.calmSince = s.now;
  if (s.dangerState !== 'calm') A.calmSince = 0;

  // harvest our finished task before deciding anything
  if (A.activeTaskId && s.task && s.task.id === A.activeTaskId && !s.task.running) {
    const p = A.project;
    if (p && A.owner && A.owner.id === 'PROJECT') {
      if (s.task.done) { p.completedOnce = true; note(`project task done (${p.skill})`); }
      else if (s.task.error) { p.lastError = s.task.error.code; note(`project task failed: ${p.lastError}`); }
    }
    A.activeTaskId = null;
  }

  const { target } = choose(s);
  const owner = A.owner;
  if (target !== owner) {
    // a higher rung taking over a RUNNING lower task: debounce non-safety preemption so
    // sensor noise cannot chop a task in half, then stop cleanly at a step boundary
    if (owner && oursRunning(s) && target.prio < owner.prio && !target.safety) {
      A._preemptTicks = (A._preemptTicks || 0) + 1;
      if (A._preemptTicks < PREEMPT_DEBOUNCE) return;
      try { globalThis.__skills.stop('agenda:' + target.id); } catch (e) {}
      A._preemptTicks = 0; A.activeTaskId = null;
      return;                                   // next tick starts the target cleanly
    }
    A._preemptTicks = 0;
    // anti-flap floor, safety rungs exempt
    if (owner && !target.safety && (s.now - A.ownerSince) < MIN_SWITCH_MS && target.prio > owner.prio) return;
    A.owner = target; A.ownerSince = s.now;
    A.metrics.transitions++;
    A.metrics.byRung[target.id] = (A.metrics.byRung[target.id] || 0) + 1;
    note(`-> ${target.id}`);
    try { const m = M(); if (m && m.emit) m.emit('note', { agenda: target.id, hp: s.hp, food: s.food, danger: s.dangerState }); } catch (e) {}
  }

  A.busy = true; A.busySince = s.now;
  const acted = Promise.resolve(target.act(s));
  Promise.race([acted, new Promise((res) => setTimeout(() => res('act_timeout'), ACT_TIMEOUT_MS))])
    .then((r) => {
      if (r && r !== 'running' && r !== 'cooldown' && r !== 'hold') A.lastAction = { rung: target.id, r, at: now() };
      if (r === 'act_timeout') {
        A.busyStuck++;
        note(`${target.id} act exceeded ${ACT_TIMEOUT_MS / 1000}s — releasing the loop and standing it down`);
        standDown(target.id); A.owner = null; A.activeTaskId = null;
      } else if (r && NO_PROGRESS.has(r)) { standDown(target.id); A.owner = null; }
      else if (r && r !== 'running' && r !== 'cooldown') { A.standDownCount[target.id] = 0; delete A.standDown[target.id]; }
    })
    .catch((e) => { A.metrics.errors++; note(`act ${target.id}: ${e.message}`); standDown(target.id); A.owner = null; })
    .finally(() => { A.busy = false; });
};

// ---------------- public API ----------------
// The ONLY thing an LLM sets. One call, then zero tokens per cycle.
A.setProject = (spec) => {
  if (!spec) { A.project = null; note('project cleared'); return { ok: true, project: null }; }
  if (typeof spec === 'string') spec = { skill: spec, args: {} };
  if (!spec.skill) return { ok: false, error: 'need {skill, args?, tool?, restockFloor?, repeat?}' };
  A.project = { skill: spec.skill, args: spec.args || {}, tool: spec.tool || null,
    restockFloor: spec.restockFloor || null, repeat: Boolean(spec.repeat),
    completedOnce: false, attempts: 0, blocked: null, setAt: now() };
  A.blocked = null;
  note(`project set: ${spec.skill}`);
  return { ok: true, project: A.project };
};
A.sense = sense;
A.rung = (id) => RUNG_BY_ID[id] || null;
A.rungs = () => RUNGS.map((r) => ({ id: r.id, prio: r.prio, safety: Boolean(r.safety) }));
// Dry run: what WOULD the ladder pick, given this world? Executes nothing.
A.step = (injected) => {
  const s = sense(injected);
  const { target, demanded, latched } = choose(s);
  return { rung: target.id, demanded: demanded.id, latched, owner: A.owner ? A.owner.id : null,
    fired: RUNGS.filter((r) => safeFire(r, s)).map((r) => r.id), snapshot: s };
};
A.snapshot = () => ({ version: A.version, owner: A.owner ? A.owner.id : null, busy: A.busy, busyStuck: A.busyStuck,
  standDown: Object.fromEntries(Object.entries(A.standDown).filter(([, t]) => t > now()).map(([k, t]) => [k, Math.round((t - now()) / 1000) + 's'])),
  ownerForMs: A.owner ? now() - A.ownerSince : null, project: A.project, blocked: A.blocked,
  activeTaskId: A.activeTaskId, metrics: A.metrics, lastAction: A.lastAction || null,
  log: A.log.slice(-8) });
A.stop = () => { A.enabled = false; if (A.timer) clearInterval(A.timer); note('stopped'); };

// ---------------- install ----------------
// ONE deliberative loop. idleguard's own loop must go — two of them fight over goals, which
// is the single most-reported field hazard. v8+ stop() goes inert in place, so the dig-guard
// stack layered above it survives (verified live before shipping this).
let subsumed = false;
try {
  const ig = globalThis.__idleguard;
  if (ig) { A.role = ig.role || null; if (ig.stop) { ig.stop(); subsumed = true; } }
} catch (e) {}

const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.agenda = { version: 1, boundAt: now(), stale: false };
bot.once('end', () => { try { REG.agenda.stale = true; A.enabled = false; if (A.timer) clearInterval(A.timer); } catch (e) {} });

A.timer = setInterval(tick, TICK_MS);

return { installed: true, version: 1, rungs: RUNGS.length, tickMs: TICK_MS,
  subsumedIdleguard: subsumed, role: A.role, home: HOME,
  api: ['setProject', 'step', 'sense', 'rung', 'snapshot', 'stop'] };
