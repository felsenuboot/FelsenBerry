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
const RESTOCK_BUFFER = 1.5;        // resupply target as a multiple of the floor (the hysteresis gap)
const RESTOCK_MINE_BATCH = 16;     // minimum produced per mining trip — never mine a 1-block gap
// WITHDRAW -> PRODUCE -> STAND DOWN. A bot that can only acquire by withdrawing is not
// self-sufficient, which is the phase-1 bar itself: on a fresh world torches cannot be
// withdrawn (no depot), cannot be mined, and `restock` does not craft — so the kit gate
// refuses every departure forever. These are the restock items the bot can MAKE instead,
// mapped to the batch to make (never the bare gap: producing the exact shortfall is the same
// no-buffer mistake as topping up to the floor, with a whole mining trip as its cost).
// Anything absent here — bread/food today — has no produce path and must stand down.
const PRODUCEABLE = {
  torch: (gap) => Math.min(Math.max(8, Math.ceil(gap / 4) * 4), 32),   // craft yields 4 per batch
  cobblestone: (gap) => Math.max(RESTOCK_MINE_BATCH, Math.min(gap, 24)),
  // The makings of ONE in-place tool re-craft, for the deep kit (#43 item 1). A stone
  // pickaxe is 3 cobblestone + 2 sticks on a table, and cobblestone is already a kit floor —
  // so a bot that also carries sticks and a table turns "pickaxe broke at y52" from a wedge
  // into a measured 2.2s recraft with no travel. They are here rather than only in the kit
  // gate because a requirement no rung can satisfy is a permanent refusal: the floor has to
  // be able to HEAL, which means RESTOCK must be able to withdraw them or make them.
  stick: (gap) => Math.min(Math.max(4, Math.ceil(gap / 4) * 4), 16),   // craft yields 4 per batch
  crafting_table: (gap) => Math.max(1, Math.min(gap, 2)),
};
// Fixed order: deterministic, and cheapest-and-most-blocking first. The table and sticks
// come before torches because they are one craft each and they are what unblocks TOOL.
const PRODUCE_ORDER = ['crafting_table', 'stick', 'torch', 'cobblestone'];
const PRODUCE_COOLDOWN_MS = 120000;   // after a produce that made NOTHING, stop asking that resource
// How long "the depot could not supply this" stays believed. It must expire: another bot may
// restock the depot, and a permanent latch would mean never withdrawing again.
const DEPOT_SHORT_TTL_MS = 600000;
// ...but "the depot was out" and "we never got to the depot" are different facts. Measured on
// a world with no depot: one withdraw attempt cost ~7 minutes of hauling toward coordinates
// it could not reach. Retrying that every 10 minutes would have a driverless bot spending
// most of a three-hour soak walking to a chest that was never there. When restock reports it
// opened NO chest at all, believe that far longer — it is a fact about the world and the
// route, not about stock levels, and it does not change because someone made a delivery.
const DEPOT_UNREACHABLE_TTL_MS = 3600000;
// A single act() that never settles freezes the WHOLE ladder: tick() returns early on
// A.busy, so one hung await silently ends autonomy. Found live — a TOOL act stalled and the
// brain sat at busy:true with zero ticks for minutes, owner null, timer alive, looking
// perfectly healthy from outside. For a bot meant to run driverless for hours that is the
// worst failure shape there is, so every act is raced against a cap and the loop always
// gets its `busy` flag back. ensureTool can legitimately travel and craft, hence 180s.
const ACT_TIMEOUT_MS = 180000;

const A = {
  version: 11, enabled: true,
  owner: null, ownerSince: 0, busy: false, busySince: 0, busyStuck: 0,
  project: null, activeTaskId: null, pendingPreempt: null,
  lastSense: null, blocked: null, calmSince: 0,
  standDown: {}, standDownCount: {}, unproductive: {},
  // the produce-fallback's memory: what the depot could not supply (item names — the COUNTS
  // are deliberately not trusted, they go stale the moment anything is consumed), when that
  // was learned, and which resources produce has just failed to make.
  _restockShort: null, _restockShortAt: 0, _restockShortTtl: 0, _restockNeeds: null, _produceCooldown: {},
  activeTaskRung: null, activeTaskName: null,
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
    // Per-item counts, for the floors that name a concrete ITEM rather than a category
    // (sticks and a crafting table, the deep kit's tool-repair makings). RESTOCK's
    // predicates read these, so like everything else a predicate reads, they come through
    // the snapshot — see bench/fixtures/agenda-ladder.js for why that rule has teeth.
    s.counts = {};
    for (const it of items) s.counts[it.name] = (s.counts[it.name] || 0) + it.count;

    // best tool per class, with durability — P1d's input
    s.tools = {};
    // ...and HOW MANY of each class, because the kit gate asks for a spare. TOOL's fire()
    // and clear() used to count pickaxes straight out of bot.inventory, which made those
    // predicates read the live world instead of the snapshot they were handed — so
    // __agenda.step(injectedSnapshot) could not replay a synthetic world for the TOOL rung,
    // and the design's mandatory deterministic-replay hook was quietly leaky. Every input a
    // predicate reads has to come through sense(), or the dry run is not a dry run.
    s.toolCounts = {};
    for (const it of items) {
      const m = /_(pickaxe|axe|shovel|hoe|sword)$/.exec(it.name);
      if (!m) continue;
      const cls = m[1];
      const max = it.maxDurability || 0;
      const dur = max ? Math.round(((max - (it.durabilityUsed || 0)) / max) * 100) : 100;
      if (!s.tools[cls] || dur > s.tools[cls].dur) s.tools[cls] = { name: it.name, dur };
      s.toolCounts[cls] = (s.toolCounts[cls] || 0) + 1;
    }

    const d = globalThis.__danger;
    s.dangerState = d ? d.state : 'calm';
    s.dangerScore = d ? d.score : 0;
    s.light = d ? d.light : null;
    s.surfaceExposed = d ? d.surfaceExposed : null;
    s.threat = d && d.nearest ? d.nearest : null;

    const sv = globalThis.__survival;
    s.survivalActive = Boolean(sv && sv.active);
    // /goto2 (ashfinder) drives the body directly, outside the task engine, so the ladder
    // cannot see it as a running task and would happily issue pathfinder goals straight
    // into it. Measured: a /goto2 hop logged 35 pathfinder interferences and moved zero
    // blocks while the agenda kept working underneath it.
    try { s.externalNav = Boolean(bot._goto2 && bot._goto2.state && bot._goto2.state().inFlight); }
    catch (e) { s.externalNav = false; }

    const S = globalThis.__skills;
    s.task = S && S.currentTask ? {
      id: S.currentTask.id, name: S.currentTask.name, running: S.currentTask.running,
      done: S.currentTask.done, error: S.currentTask.error,
      // the raw task, so the harvest step can grade it with __skills.assertTask. Injected
      // test snapshots simply omit this and the grader is skipped.
      _raw: S.currentTask,
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
// Does the departure gate want a weapon we do not have? kitCheck accepts a sword OR an axe,
// so this must too, or TOOL would keep acquiring a sword for a bot already carrying an axe.
const weaponMissing = (s) => {
  const k = projectKit(s);
  if (!k || !k.weapon) return false;
  const t = s.tools || {};
  return !(t.sword || t.axe);
};
// Floors come from the KIT GATE when a project is set, because that gate is what will
// actually refuse the departure. Using the role default instead let a project sit blocked on
// a requirement no rung was aiming at.
const activeFloors = (s) => {
  if (A.project && A.project.restockFloor) return A.project.restockFloor;
  const k = projectKit(s);          // s, not bot: this feeds RESTOCK's fire/clear
  if (k) return { torches: k.torches, food: k.foodItems, filler: k.filler, sticks: k.sticks, table: k.table };
  return ROLE_FLOOR[s.role] || null;
};
// The kit requirement for the project's skill, or null.
//
// A dynamic kit spec is a function of (args, bot) and the ones we have read exactly one
// thing off that bot: `position.y` (mineLane asks "am I below zero" to pick underground vs
// deep). Handed the real bot during a DRY RUN, that reads the live world and makes the
// replay non-deterministic — the tier, and therefore the pick requirement, would depend on
// where the bot happens to be standing rather than on the snapshot under test. So when the
// snapshot is injected, pass a position-only shim built from it.
// CONTRACT, and it binds anyone adding a kit function: kit(args, bot) may read POSITION
// only. Reading anything else off that bot silently breaks deterministic replay.
const projectKit = (s) => {
  try {
    const S = globalThis.__skills;
    if (!A.project || !S || !S.kitTiers || !S.registry) return null;
    const spec = S.registry[A.project.skill];
    if (!spec || !spec.kit) return null;
    const src = (s && s.injected && s.pos) ? { entity: { position: s.pos } } : bot;
    const tier = typeof spec.kit === 'function' ? spec.kit(A.project.args || {}, src) : spec.kit;
    return tier ? (S.kitTiers()[tier] || null) : null;
  } catch (e) { return null; }
};
A.projectKit = projectKit;
const skillRunning = (s) => Boolean(s.task && s.task.running);
const oursRunning = (s) => Boolean(s.task && s.task.running && s.task.id === A.activeTaskId);

// Clearing the id alone would leave a stale rung/name behind, and those three are one fact.
const clearActiveTask = () => { A.activeTaskId = null; A.activeTaskRung = null; A.activeTaskName = null; };
// Start a skill and remember it as ours. Deliberately never throws: a rung that cannot act
// must fall through on the next tick, not take the loop down.
const runSkill = (name, args, why) => {
  try {
    const S = globalThis.__skills;
    if (!S || !S.start) return { ok: false, error: { code: 'no_engine' } };
    const r = S.start(bot, name, args || {});
    if (r && r.ok) {
      // Remember WHO started it and WHAT it is, not just the id. A task id alone cannot tell
      // the harvest step whether the thing that just finished was the project's work or some
      // other rung's — see the false-success note there.
      A.activeTaskId = r.taskId; A.activeTaskRung = String(why).split('/')[0]; A.activeTaskName = name;
      note(`${why}: started ${name}`); A.metrics.acts++;
    } else note(`${why}: ${name} refused (${r && r.error && r.error.code})`);
    // `busy` means the engine is running something else RIGHT NOW — transient, so retry on
    // the next tick rather than serving this rung a 30s backoff for a two-second condition.
    // Everything else (kit_missing, bad_args, unknown_skill) is a real refusal.
    if (r && !r.ok && r.error && r.error.code === 'busy') r._transient = true;
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
    act: async () => { clearActiveTask(); return 'yield'; } },

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
      if (oursRunning(s)) { try { globalThis.__skills.stop('agenda:posture'); } catch (e) {} clearActiveTask(); }
      if (s.surfaceExposed === false && (s.light == null || s.light < 8) && s.torches > 0) await torchInline();
      return 'hold';
    } },

  // preemptNow: skip PREEMPT_DEBOUNCE when taking over a running task. The debounce exists
  // to absorb SENSOR NOISE, and food is not a noisy signal — it is an integer that changes
  // slowly and monotonically while starving. Waiting ~4s to start eating buys nothing and
  // the rung latches to food>=19 anyway, so it cannot thrash. (engine-dev-3 flagged this as
  // a judgement call; this is the judgement.)
  { id: 'EAT_CRITICAL', prio: 2, preemptNow: true,
    fire: (s) => s.food <= 6 && s.foodCount > 0,
    clear: (s) => s.food >= 19,
    act: async () => { await eatInline(); return 'ate'; } },

  { id: 'DEPOSIT', prio: 3,
    fire: (s) => s.freeSlots <= 2,
    clear: (s) => s.freeSlots >= 6,
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const pos = Array.isArray(DEPOT.minerals) ? { x: DEPOT.minerals[0], y: DEPOT.minerals[1], z: DEPOT.minerals[2] } : undefined;
      const r = runSkill('depositToChest', pos ? { pos } : {}, 'DEPOSIT');
      return r.ok ? 'started' : (r._transient ? 'busy' : 'refused');
    } },

  { id: 'EAT', prio: 4,
    fire: (s) => s.food <= 17 && s.foodCount > 0,
    clear: (s) => s.food >= 19,
    act: async () => { await eatInline(); return 'ate'; } },

  { id: 'TOOL', prio: 5,
    // "a broken tool outranks the job", made mechanical
    fire: (s) => {
      // The kit gate wants a WEAPON on every excursion tier, and until now no rung aimed at
      // it: TOOL only ever looked at the project's own tool class. Found by stripping a bot
      // to nothing and watching the ladder provision the entire underground kit — two
      // pickaxes, a table, sticks, 24 torches, 28 cobblestone — and then stall forever on
      // `weapon (any sword)`, with fire() false on every rung and the project refused with
      // kit_missing on each attempt. That is the permanent-refusal shape, on a requirement
      // that predates all of this. An axe satisfies the gate too (see kitCheck).
      if (weaponMissing(s)) return true;
      const c = activeClass(s);
      if (!c) return false;
      const b = s.tools[c];
      if (!b || b.dur <= 15) return true;
      // the departure gate may want a BACKUP (underground wants 2 pickaxes). Holding one
      // good pickaxe satisfied this rung while the gate kept refusing — a shortfall nobody
      // was fixing. Ask the gate directly, but read the COUNT from the snapshot (see
      // s.toolCounts) so this predicate stays replayable.
      const k = projectKit(s);
      if (k && k.picks && c === 'pickaxe') {
        if (((s.toolCounts || {}).pickaxe || 0) < k.picks) return true;
      }
      return false;
    },
    clear: (s) => {
      if (weaponMissing(s)) return false;
      const c = activeClass(s);
      if (!c) return true;
      const b = s.tools[c];
      if (!(b && b.dur > 25)) return false;
      const k = projectKit(s);
      if (k && k.picks && c === 'pickaxe') {
        if (((s.toolCounts || {}).pickaxe || 0) < k.picks) return false;
      }
      return true;
    },
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const c = activeClass(s);
      if (!c) return 'none';
      // Run acquisition as a TASK, not an awaited method: a chain that gathers wood, crafts
      // planks, places a table and crafts the tool can outrun the 180s act cap, and when it
      // does the ladder force-releases while the acquisition keeps going unowned. As a task
      // the act returns immediately, oursRunning() reports 'running' each tick, and stopping
      // it is a clean step-boundary stop.
      // If we already hold a working tool and the gate wants a BACKUP, ask for a spare —
      // otherwise ensureTool answers "you have one" and the rung can never clear.
      const k = projectKit(s);
      const held = (s.toolCounts || {}).pickaxe || 0;
      const wantSpare = Boolean(k && k.picks && c === 'pickaxe' && held >= 1 && held < k.picks);
      // The project's own tool comes first — it is what the work needs — and the gate's
      // weapon is picked up once that is satisfied. Both are this rung's business; nothing
      // else was ever going to acquire the weapon.
      const classDeficient = !s.tools[c] || s.tools[c].dur <= 15 || wantSpare;
      const target = classDeficient ? c : (weaponMissing(s) ? 'sword' : c);
      const r = runSkill('ensureTool', { tool: target, spare: target === c && wantSpare }, 'TOOL');
      if (r.ok) return 'started';
      if (r._transient) return 'busy';
      // A genuine refusal is the handback point: the ladder cannot advance a tool-gated
      // intent. clear() stays false, so the unproductive detector and stand-down handle the
      // retry cadence rather than a bespoke loop here.
      A.blocked = { why: 'no_tool', cls: c, at: now() };
      note(`tool_unavailable (${c}) — dropping to a rung that needs no tool`);
      return 'blocked';
    } },

  { id: 'RESTOCK', prio: 6,
    // a DEPARTURE gate, not an emergency: only fires when the active intent consumes it
    fire: (s) => {
      const f = activeFloors(s); if (!f) return false;
      const held = (n) => (s.counts || {})[n] || 0;
      if (f.torches && s.torches < f.torches) return true;
      if (f.food && s.foodCount < f.food) return true;
      if (f.filler && s.filler < f.filler) return true;
      if (f.sticks && held('stick') < f.sticks) return true;
      if (f.table && held('crafting_table') < f.table) return true;
      return false;
    },
    // RESTOCK was the ONE rung breaking this file's own hysteresis invariant (see the header:
    // "fire() and clear() are deliberately different thresholds on every rung; that gap IS
    // the hysteresis"). fire and clear both used the bare floor, and act topped up to exactly
    // the floor — so the floor doubled as the operating level with no buffer anywhere. Against
    // a project that CONSUMES the resource, the result is a boundary bounce: safeDescend
    // places a torch, dips one below the floor, RESTOCK (prio 6) preempts the running PROJECT
    // (prio 8), tops back to exactly the floor, clears, PROJECT resumes, burns one, repeat —
    // chopping the descent every few seconds. Found by engine-dev-3 reading this file.
    // Clearing at floor*BUFFER (and restocking to it) restores the gap: resupply overshoots,
    // so ordinary consumption no longer re-crosses the trigger.
    clear: (s) => {
      const f = activeFloors(s); if (!f) return true;
      const up = (n) => Math.ceil(n * RESTOCK_BUFFER);
      const held = (n) => (s.counts || {})[n] || 0;
      return (!f.torches || s.torches >= up(f.torches)) && (!f.food || s.foodCount >= up(f.food))
        && (!f.filler || s.filler >= up(f.filler))
        // no buffer on the table: the gate wants one, one clears it
        && (!f.sticks || held('stick') >= up(f.sticks)) && (!f.table || held('crafting_table') >= f.table);
    },
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const f = activeFloors(s);
      if (!f) return 'none';
      // floors are category-level; the skill wants concrete items. bread and cobblestone are
      // the fleet's standard stand-ins for "food" and "filler" (DEPOT.md chests C and B).
      // Restock to the BUFFERED target, not the bare floor — topping up to exactly the
      // trigger level guarantees the next unit consumed re-fires this rung.
      const up = (n) => Math.ceil(n * RESTOCK_BUFFER);
      const needs = {};
      if (f.torches) needs.torch = up(f.torches);
      if (f.food) needs.bread = up(f.food);
      if (f.filler) needs.cobblestone = up(f.filler);
      // The deep kit's tool-repair makings (#43 item 1). Buffered like everything else,
      // except the table: one is one, and 1.5 tables is not a thing.
      if (f.sticks) needs.stick = up(f.sticks);
      if (f.table) needs.crafting_table = f.table;
      if (!Object.keys(needs).length) return 'none';

      // STEP 2 — PRODUCE what the depot could not supply. Reached only after a withdraw has
      // actually come back short (or errored), so the depot stays the cheap first answer and
      // producing is the fallback, not the habit.
      const shortAge = s.now - (A._restockShortAt || 0);
      const shortTtl = A._restockShortTtl || DEPOT_SHORT_TTL_MS;
      const depotShort = (A._restockShort && shortAge < shortTtl) ? A._restockShort : null;
      if (depotShort) {
        // Recompute the gap from the inventory NOW. The recorded shortfall is a signal ("the
        // depot is out of these"), never a quantity — reusing its counts would be the same
        // unit-mismatch class of bug as grading a block distance against an entity position.
        const held = (n) => (s.counts || {})[n] || 0;
        let pick = null;
        for (const r of PRODUCE_ORDER) {
          if (!(r in depotShort) || !needs[r]) continue;
          if ((A._produceCooldown[r] || 0) > s.now) continue;
          const gap = needs[r] - held(r);
          if (gap > 0) { pick = { resource: r, count: PRODUCEABLE[r](gap), gap }; break; }
        }
        if (pick) {
          note(`depot short on ${pick.resource} (gap ${pick.gap}) — making ${pick.count} instead`);
          const rp = runSkill('produce', { resource: pick.resource, count: pick.count }, 'RESTOCK/produce');
          if (rp.ok) { A._producing = pick.resource; return 'started'; }
          if (rp._transient) return 'busy';
          // no produce skill installed (producer.js missing) is a real refusal, not a silent
          // fall-through to the withdraw that just failed.
          return 'refused';
        }
        // STEP 3 — STAND DOWN. Everything still short is either unproduceable (food: no farm
        // or cook path is wired to this rung yet) or in produce cooldown. Re-running the
        // withdraw that just came back empty would be the churn this rung already fixed once,
        // so report no progress and let the backoff give the lower rungs the body. The TTL
        // above brings the withdraw probe back on its own.
        const stuck = Object.keys(depotShort).filter((n) => needs[n]).join(', ');
        if (stuck) { note(`still short ${stuck} and nothing left to try — standing down`); return 'refused'; }
      }

      // STEP 1 — WITHDRAW. Remember what we asked for: if the task ERRORS there is no
      // result.short to read, and the ask is what was not delivered.
      A._restockNeeds = needs;
      const rr = runSkill('restock', { needs }, 'RESTOCK');
      return rr.ok ? 'started' : (rr._transient ? 'busy' : 'refused');
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
      if (!r.ok && r._transient) return 'busy';
      if (!r.ok) {
        p.attempts = (p.attempts || 0) + 1;
        p.lastError = r.error ? r.error.code : 'unknown';
        const repairable = p.lastError === 'kit_missing' || p.lastError === 'no_tool';
        if (repairable) { p.attempts = 0; note(`project needs ${p.lastError} — the maintenance rungs own that, not a block`); }
        else if (p.attempts >= 3) { p.blocked = p.lastError; note(`project blocked after 3 attempts: ${p.lastError}`); }
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
      const ri = runSkill('collectDrops', { radius: 16, timeoutMs: 15000 }, 'IDLE');
      return ri.ok ? 'sweeping' : (ri._transient ? 'busy' : 'refused');
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
  // ONE thing drives the body at a time. This is the same rule that made the agenda subsume
  // idleguard; /goto2 is simply a third driver the ladder cannot see as a task.
  if (s.externalNav) {
    if (!A._yieldedToNav) {
      A._yieldedToNav = true;
      if (oursRunning(s)) { try { globalThis.__skills.stop('agenda:external-nav'); } catch (e) {} }
      clearActiveTask(); A.owner = null;
      note('yielding — /goto2 owns the body');
    }
    return;
  }
  if (A._yieldedToNav) { A._yieldedToNav = false; note('/goto2 released the body — resuming'); }
  if (s.dangerState === 'calm' && A.calmSince === 0) A.calmSince = s.now;
  if (s.dangerState !== 'calm') A.calmSince = 0;

  // harvest our finished task before deciding anything
  if (A.activeTaskId && s.task && s.task.id === A.activeTaskId && !s.task.running) {
    const p = A.project;
    // The finished task must BE the project's, not merely the last thing that finished while
    // PROJECT happened to hold the body. Found live, and it is the worst kind of bug this
    // file can have: RESTOCK started `produce`, produce finished, RESTOCK cleared, PROJECT
    // took over and its own start was REFUSED (kit_missing), which leaves activeTaskId still
    // pointing at produce's task — so the next tick graded produce's result as the project's
    // completion, `produce.made(cobblestone,...)` passed, and mineLane was marked VERIFIED
    // done without ever having run. Owner identity is not task identity. So check both the
    // rung that STARTED the task and that the task's name is the project's skill; either
    // alone would have caught this, and they are independent.
    const ours = A.activeTaskRung === 'PROJECT' && p && s.task.name === p.skill;
    if (p && ours && A.owner && A.owner.id === 'PROJECT') {
      // VERIFIED completion, not claimed completion. task.done is the engine's own word for
      // it — that is naive success, the exact thing the ledger exists to distinguish from
      // real success. Marking a project done on task.done meant a safeDescend that ran and
      // did NOT descend set completedOnce anyway, so PROJECT never fired again and the bot
      // silently abandoned a goal it had never accomplished. An agenda-level false-success.
      // So: grade with __skills.assertTask, the same independent verifier the telemetry uses.
      let verdict = null;
      const raw = s.task._raw;
      try { verdict = (raw && globalThis.__skills.assertTask) ? globalThis.__skills.assertTask(raw, bot) : null; } catch (e) {}
      const claimed = Boolean(s.task.done);
      const refuted = Boolean(verdict && verdict.fail);
      if (claimed && !refuted) {
        p.completedOnce = true; p.attempts = 0;
        note(`project VERIFIED done (${p.skill}${verdict ? ', ' + verdict.rule : ''})`);
      } else {
        p.lastError = refuted ? ('assert:' + verdict.rule) : (s.task.error ? s.task.error.code : 'no_progress');
        p.attempts = (p.attempts || 0) + 1;
        note(`project run did NOT verify (${p.lastError}) — retrying, attempt ${p.attempts}`);
        // Route it through the same stand-down-with-backoff the rungs use, so a project that
        // keeps failing yields the body to lower rungs instead of spinning or being abandoned.
        standDown('PROJECT');
        A.owner = null;
        // kit_missing and no_tool are exactly what TOOL and RESTOCK exist to repair, so they
        // must never permanently block a project — that is the ladder giving up on a problem
        // it is holding the fix for. Everything else blocks after 5 unverified runs.
        const repairable = p.lastError === 'kit_missing' || p.lastError === 'no_tool';
        if (!repairable && p.attempts >= 5) { p.blocked = p.lastError; note(`project blocked after 5 unverified runs: ${p.lastError}`); }
        else if (repairable) { p.attempts = 0; }
      }
    }
    // remember what the depot could not supply, so RESTOCK can switch to producing it
    try {
      const raw = s.task._raw;
      if (raw && raw.name === 'restock') {
        const short = (raw.result && raw.result.short) || null;
        // A restock that opened no chest tells us about the ROUTE, not about stock — and a
        // route does not improve because someone restocked the depot. Believe it far longer.
        const reached = raw.result && typeof raw.result.reached === 'number' ? raw.result.reached : 0;
        A._restockShortTtl = reached > 0 ? DEPOT_SHORT_TTL_MS : DEPOT_UNREACHABLE_TTL_MS;
        if (short && Object.keys(short).length) { A._restockShort = short; A._restockShortAt = s.now; }
        else if (raw.error) {
          // A restock that ERRORED withdrew nothing, and it carries no result to read. Judging
          // the depot only by result.short missed exactly the case the produce-fallback exists
          // for: on a world with no depot configured, restock throws not_found every time,
          // _restockShort stayed null forever, and the fallback was unreachable — the ladder
          // standing down on a need it was holding the fix for. The ask is the shortfall.
          A._restockShort = Object.assign({}, A._restockNeeds || {}); A._restockShortAt = s.now;
          note(`restock failed (${raw.error.code}) — treating the whole ask as depot-short`);
        } else { A._restockShort = null; A._restockShortAt = 0; }   // stocked: forget the signal
      }
      if (raw && raw.name === 'produce') {
        const res = (raw.args && raw.args.resource) || A._producing;
        const made = (raw.result && raw.result.made) || 0;
        if (res && made <= 0) {
          A._produceCooldown[res] = s.now + PRODUCE_COOLDOWN_MS;
          note(`produce ${res} made nothing (${(raw.result && raw.result.reason) || (raw.error && raw.error.code) || '?'}) — not asking again for ${Math.round(PRODUCE_COOLDOWN_MS / 1000)}s`);
        } else if (res) {
          delete A._produceCooldown[res];
          // The unproductive detector below judges a rung by whether its own fire() is still
          // true after the task ends — but a produce that made 6 of 24 torches DID move the
          // world, and standing RESTOCK down for real progress would strand a bot mid-resupply.
          // Progress, not completion, is the right predicate here.
          A.unproductive.RESTOCK = 0;
        }
        A._producing = null;
      }
    } catch (e) {}

    // GENERAL "completed but did not achieve" detector. A rung whose skill finishes cleanly
    // while its own fire() is still true has not moved the world — RESTOCK did exactly this,
    // starting a restock every cycle on a world with no depot and never standing down,
    // because "task completed" is not the same as "need met". Same shape as the project
    // false-success, one layer down: judge by the need, not by the task's own verdict.
    if (A.owner && !A.owner.safety && safeFire(A.owner, s)) {
      const id = A.owner.id;
      A.unproductive[id] = (A.unproductive[id] || 0) + 1;
      if (A.unproductive[id] >= 2) {
        note(`${id} completed its work twice without meeting its own condition — standing down`);
        A.unproductive[id] = 0;
        standDown(id);
        A.owner = null;
      }
    }
    clearActiveTask();
  }

  const { target } = choose(s);
  const owner = A.owner;
  if (target !== owner) {
    // a higher rung taking over a RUNNING lower task: debounce non-safety preemption so
    // sensor noise cannot chop a task in half, then stop cleanly at a step boundary
    if (owner && oursRunning(s) && target.prio < owner.prio && !target.safety && !target.preemptNow) {
      A._preemptTicks = (A._preemptTicks || 0) + 1;
      if (A._preemptTicks < PREEMPT_DEBOUNCE) return;
      try { globalThis.__skills.stop('agenda:' + target.id); } catch (e) {}
      A._preemptTicks = 0; clearActiveTask();
      return;                                   // next tick starts the target cleanly
    }
    A._preemptTicks = 0;
    // anti-flap floor, safety rungs exempt
    if (owner && !target.safety && (s.now - A.ownerSince) < MIN_SWITCH_MS && target.prio > owner.prio) return;
    if (owner) A.unproductive[owner.id] = 0;
    A.owner = target; A.ownerSince = s.now;
    A.metrics.transitions++;
    A.metrics.byRung[target.id] = (A.metrics.byRung[target.id] || 0) + 1;
    note(`-> ${target.id}`);
    try { const m = M(); if (m && m.emit) m.emit('note', { agenda: target.id, hp: s.hp, food: s.food, danger: s.dangerState }); } catch (e) {}
  }

  A.busy = true; A.busySince = s.now;
  // Promise.resolve().then(...) rather than Promise.resolve(target.act(s)): the latter
  // CALLS act synchronously, so a non-async act that threw before returning a promise would
  // escape tick() entirely and leave A.busy stuck true — the frozen-ladder shape, recovered
  // only by the busySince force-release ~210s later. Every act is async today, so this is
  // latent rather than live; deferring the call turns any future sync throw into a rejection
  // the existing .catch handles on the spot. Found by engine-dev-3's arbitration review.
  const acted = Promise.resolve().then(() => target.act(s));
  Promise.race([acted, new Promise((res) => setTimeout(() => res('act_timeout'), ACT_TIMEOUT_MS))])
    .then((r) => {
      if (r && r !== 'running' && r !== 'cooldown' && r !== 'hold' && r !== 'busy') A.lastAction = { rung: target.id, r, at: now() };
      if (r === 'act_timeout') {
        A.busyStuck++;
        note(`${target.id} act exceeded ${ACT_TIMEOUT_MS / 1000}s — releasing the loop and standing it down`);
        standDown(target.id); A.owner = null; clearActiveTask();
      } else if (r === 'busy') { /* engine occupied — retry next tick, no backoff */ }
      else if (r && NO_PROGRESS.has(r)) { standDown(target.id); A.owner = null; }
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
REG.agenda = { version: A.version, boundAt: now(), stale: false };
bot.once('end', () => { try { REG.agenda.stale = true; A.enabled = false; if (A.timer) clearInterval(A.timer); } catch (e) {} });

A.timer = setInterval(tick, TICK_MS);

return { installed: true, version: A.version, rungs: RUNGS.length, tickMs: TICK_MS,
  subsumedIdleguard: subsumed, role: A.role, home: HOME,
  api: ['setProject', 'step', 'sense', 'rung', 'snapshot', 'stop'] };
