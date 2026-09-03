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
// #97: a threat dangerscan can SEE (raycast LOS, no obstruction) but that cannot actually
// PATH to the bot (e.g. a zombie 3+ blocks straight down from an isolated platform, unable to
// climb) keeps danger.state pinned at 'panic' forever -- dangerscan's score is LOS-based, not
// reachability-based, by design (a cheap "wallhack" scanner, not a pathfinding oracle). If
// survival.js never engages for it (correctly -- there is nothing productive to physically do
// about a threat that cannot land a hit), REFLEX still fires purely on the raw panic state and
// yields every tick without ever accomplishing anything, deadlocking the WHOLE ladder (live:
// ~19 consecutive dead minutes, felcrew-mcp#97). Fixed conservatively, not by touching
// dangerscan's scoring (risk of ever missing a genuine threat) but by requiring TWO
// independent, corroborating signals before REFLEX (a safety:true rung) ever stands down on a
// still-panicking read: survival.js has not engaged AT ALL for a sustained window, AND health
// has not dropped even once during that same window (positive evidence nothing is landing
// hits, not just elapsed time). Either signal alone resets the window immediately.
const PANIC_STALE_MS = 20000;
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
// Skills whose work ACCUMULATES across a preemption. A lane that RESTOCK paused for a torch
// refill and the ladder then resumed is PROGRESS, not a cancel — but `count` is per
// invocation, so each resume restarted from zero and a high count never completed. Measured:
// count:150 produced ZERO completions across ~275 blocks genuinely mined, while count:24
// completed cleanly. The bot was working perfectly; only the bookkeeping said otherwise.
// The fix lives HERE and not in the skill: a skill invocation is stateless by design and
// cannot know about prior attempts, whereas the agenda owns the project and is the thing
// that preempted its own task. Restarting with the REMAINING count also keeps
// `mineLane.banked` graded against the count it was actually given, where making the skill
// accumulate internally would push banked past count and quietly break its own assertion.
const RESUMABLE = {
  mineLane: {
    total: (a) => (a && a.count) || 8,
    done: (r) => (r && r.banked) || 0,
    remaining: (a, left) => Object.assign({}, a, { count: left }),
  },
};
const resumable = (skill) => RESUMABLE[skill] || null;
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
  version: 30, enabled: true,
  owner: null, ownerSince: 0, busy: false, busySince: 0, busyStuck: 0,
  project: null, activeTaskId: null, pendingPreempt: null,
  lastSense: null, blocked: null, calmSince: 0,
  // #97: unbroken "panic, survival.js not engaging" streak tracking (see PANIC_STALE_MS)
  _panicIdleSince: 0, _panicIdleDamaged: false, _panicIdleLastHp: null,
  standDown: {}, standDownCount: {}, unproductive: {},
  // the produce-fallback's memory: what the depot could not supply (item names — the COUNTS
  // are deliberately not trusted, they go stale the moment anything is consumed), when that
  // was learned, and which resources produce has just failed to make.
  _restockShort: null, _restockShortAt: 0, _restockShortTtl: 0, _restockNeeds: null, _produceCooldown: {},
  activeTaskRung: null, activeTaskName: null,
  // 5c: same-remedy-repeats-across-positions escalation (TODO 5c, soak #4). remedyClass ->
  // {n, firstAt, escalatedAt}. See the REMEDY rung + remedyFail/remedyOk below.
  remedy: {},
  // TODO 5g (#116): spawn-camp span tracking lives on `bot._spawnCamp`, NOT here — see the
  // `bot.on('death', ...)` block below for why (same reasoning as `_respawnedNeedsDirection`/
  // `_deathTimes`: a death re-injects this whole file, wiping every field on `A`, including
  // this one, mid-streak — live-caught testing THIS exact feature: two spurious `spawn_camp`
  // "open" ledger events for what was really one continuous streak, because `A.spawnCamp.active`
  // kept resetting to `false` on every re-injection).
  metrics: { ticks: 0, transitions: 0, acts: 0, errors: 0, byRung: {} },
  log: [],
  // Direction Episodes (research/IDLE_TRIGGER_SPEC.md, agenda v21->v22 — #68's trigger half).
  // "Needs direction" as latched, level-triggered state: at most ONE open episode, opened by
  // deterministic edges off ladder state (never raw movement, so a long haul can never
  // false-fire), held until something fills the project slot. See directionCheck/openEpisode/
  // closeEpisode/markProductive below for the mechanism.
  direction: {
    state: 'ok',                 // 'ok' | 'needs_direction' | 'cooldown'
    episode: null,               // {id, why, openedAt, detail}
    prevLvl: 'none',             // central edge detector's last composite level
    lastProductiveAt: 0,         // set to now() at install (reinjection grace)
    reopenAt: {}, reopenCount: {},   // per-why escalating reopen backoff
    opened: 0, closed: 0, promoted: 0, byWhy: {},   // UNCONDITIONAL counters (#38 witness 1)
  },
  nextProject: null,             // 1-deep queue: {skill,args,tool,restockFloor,repeat,stagedAt}
};
globalThis.__agenda = A;

// #103: death/respawn should open a needs_direction episode immediately, not wait out
// unproductive_idle's 120s window. Genuinely tricky wiring, not a bare event-to-openEpisode
// call: runner.js's OWN 'spawn' handler re-runs applyPayloadStack on every spawn "including
// death-respawn" (its own comment) — which re-injects agenda.js ITSELF, fresh, wiping this
// entire module's state (a brand new `A`, `direction.episode:null`) in the SAME breath a
// 'death' listener would fire. Opening the episode directly from a 'death' handler would be
// destroyed by that same-tick re-injection before the decider/driver could ever see it.
// So 'death' only sets a flag on the BOT object, not on `A` — the one piece of state that
// SURVIVES a same-session re-injection (re-injection re-runs this file against the SAME bot
// object; only an actual reconnect creates a fresh one, per runner.js's own comment, which is
// exactly why this correctly never fires for a plain reconnect/kick, only a real death).
//
// Deliberately NOT snapshotted into a local variable at module-init time — live-caught
// testing this: a fresh reconnect immediately followed by a real death can fire TWO 'spawn'
// events close enough together that applyPayloadStack re-injects this whole file TWICE in a
// row, a few hundred ms apart. The first re-injection would correctly read and consume the
// flag into a local one-shot var, but the SECOND re-injection creates an entirely new module
// instance (a fresh `A`, a fresh closure) that knows nothing about the first one's local
// state — it would silently re-read `bot._respawnedNeedsDirection` (already false by then)
// and lose the episode. directionCheck instead reads the BOT-level flag directly, every
// tick, and clears it only at the moment it actually opens the episode — whichever
// injection's tick() loop is the one still running (old ones stop their own timer on
// idempotent replace) sees and consumes the real, current flag, immune to how many times
// re-injection happened in between.
// TODO 5g (#116), live-caught building this very feature: `bot.on('death', ...)` runs at
// module top-level, which re-executes on EVERY re-injection (this whole file's own doctrine,
// documented right above) — and nothing ever removed the OLD listener, so listeners
// accumulated 1-for-1 with death count (`MaxListenersExceededWarning: 11 death listeners`,
// observed live after a handful of deaths). The pre-5g `_respawnedNeedsDirection` handler
// happened to be harmless under that bug (setting the same boolean true twice is a no-op) —
// but a COUNTING handler is not idempotent: N accumulated listeners means one real death
// pushes N timestamps, inflating `s.recentDeaths` and firing spawnCamped on far fewer real
// deaths than SPAWN_CAMP_N actually asks for. Fixed at the root, for both handlers: install
// exactly once per real bot object (the flag itself is the same "survives re-injection, bot-
// level not A-level" state everything else on this line already relies on).
if (!bot._deathHandlersInstalled) {
  bot._deathHandlersInstalled = true;
  bot.on('death', () => { bot._respawnedNeedsDirection = true; });
  // TODO 5g (#116): spawn-camp death streak, same bot-level-not-A-level reasoning as
  // `_respawnedNeedsDirection` right above (a death re-injects this whole file, wiping any
  // A-level state, but never replaces the bot object) — pruned to the rolling window inside
  // sense() itself, not here, so a fresh injection sees the SAME real history immediately
  // rather than an empty array until its own first death.
  bot.on('death', () => { bot._deathTimes = (bot._deathTimes || []).concat(Date.now()); });
}
// TODO 5g (#116): the OPEN SPAN itself (active/openedAt/deaths) — same bot-level home, and for
// the identical reason: `openedAt` anchors the hard-cap release path, so it must NOT reset on
// every death within the same still-open streak (a death is exactly when a re-injection
// happens). `|| {...}` only initializes it once per real bot connection, never on re-injection.
bot._spawnCamp = bot._spawnCamp || { active: false, openedAt: 0, deaths: 0 };

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

// Direction Episodes constants (IDLE_TRIGGER_SPEC.md §1.1b).
const DIRECTION_IDLE_WINDOW_MS = 120000;   // E2: undirected-idle window
const DIRECTION_STALL_MS       = 180000;   // E3a: stalled-project window
const DIRECTION_BARREN_RUNS    = 3;        // E3b: consecutive zero-yield repeat runs
const DIRECTION_REOPEN_MS      = [30000, 60000, 120000, 300000];  // same shape as STAND_DOWN_MS

// TODO 5g (#116): spawn-camp constants. From test-driver's own incident (run #6, FEEDBACK
// ~09:40Z): 3 deaths in 63s, each respawn drawing hostile fire again within seconds — faster
// than SHELTER's proactive dig-in could win the race, and faster than any driver could
// meaningfully steer. SPAWN_CAMP_WINDOW_MS/N cover that exact shape with margin. The three
// release paths (see sense()'s own spawn-camp block and tick()'s transition-close call) are a
// hard requirement, not a nicety: NOTHING that can suppress ordinary dispatch may be allowed
// to suppress it forever, or a chronic condition (not just a real camp) could deadlock the
// bot's own autonomy — composition-rot doctrine, "zero defense must be unrepresentable"
// extends to "zero recovery must be unrepresentable" too.
const SPAWN_CAMP_WINDOW_MS = 90000;     // rolling window a death streak is measured over
const SPAWN_CAMP_N = 3;                 // deaths within the window that count as "camped"
const SPAWN_CAMP_STABLE_MS = 60000;     // dawn + this long since the last death -> early release
const SPAWN_CAMP_HARD_CAP_MS = 600000;  // absolute ceiling regardless of ongoing deaths
const RESPAWN_GRACE_MS = 20000;         // "just respawned" window — SHELTER's early-trigger grace

// Pure: the spawn-camp release math, factored out of sense() so a fixture can drive it with
// SYNTHETIC timestamps (no real wall-clock waiting for a 90s window or a 10-minute hard cap —
// same discipline as A._idleWorkOutcome/A._promoteCheck below). `deathTimes` is expected
// already-pruned-or-not (this function only READS it, filtering internally); `openedAt` is
// bot._spawnCamp.openedAt (0 if no streak is currently open — the hard cap is then vacuously
// false, matching "not currently camped" with nothing to cap).
const spawnCampCheck = (deathTimes, nowMs, openedAt, isDay) => {
  const recent = (deathTimes || []).filter((t) => nowMs - t < SPAWN_CAMP_WINDOW_MS);
  const recentDeaths = recent.length;
  const lastDeathAt = recentDeaths ? recent[recent.length - 1] : 0;
  const rawSpawnCamped = recentDeaths >= SPAWN_CAMP_N;
  // early release: dawn AND stable (no death) for SPAWN_CAMP_STABLE_MS — lets the bot resume
  // BEFORE the raw death-count would otherwise have aged out of the window on its own.
  const stableAtDawn = isDay === true && Boolean(lastDeathAt) && (nowMs - lastDeathAt) > SPAWN_CAMP_STABLE_MS;
  // hard ceiling: measured from when THIS streak first opened — a circuit breaker independent
  // of whether deaths keep resetting the rolling window, so a chronic condition can never
  // suppress dispatch forever.
  const hardCapped = Boolean(openedAt) && (nowMs - openedAt) > SPAWN_CAMP_HARD_CAP_MS;
  return { recentDeaths, lastDeathAt, rawSpawnCamped, stableAtDawn, hardCapped,
    spawnCamped: rawSpawnCamped && !stableAtDawn && !hardCapped };
};

// dirEmit(op, fields): the SAME two-surface discipline as note()'s S.log mirror, so a direction
// event is never invisible on one side while claimed on the other (#38 doctrine — an emit into
// a sink that doesn't exist, or that nothing reads, is indistinguishable from one that never
// fired). (1) stdout marker for a driver's log Monitor to wake on; (2) the ledger, through the
// SAME proven-live M.emit path the rung-transition `note` already uses (see note()'s S.log
// mirror above and the emit('note',...) call in the harvest block) — never an optional guard
// into a phantom sink (the #54-R2 review's own lesson, applied here from the start).
const dirEmit = (op, fields) => {
  try { console.log(new Date().toISOString() + ' AGENDA_EVENT ' + JSON.stringify(Object.assign({ ev: 'direction', op }, fields))); } catch (e) {}
  try { const m = M(); if (m && m.emit) m.emit('direction', Object.assign({ op }, fields)); } catch (e) {}
};
// TODO 5g (#116): same two-surface discipline as dirEmit, its own event type (not folded into
// 'direction' — a spawn-camp span is not a direction episode) so soak #5's grade can count
// open/close spans and their `reason`/`deaths` independently.
const spawnCampEmit = (op, fields) => {
  try { console.log(new Date().toISOString() + ' AGENDA_EVENT ' + JSON.stringify(Object.assign({ ev: 'spawn_camp', op }, fields))); } catch (e) {}
  try { const m = M(); if (m && m.emit) m.emit('spawn_camp', Object.assign({ op }, fields)); } catch (e) {}
};

const cfg = (() => {
  try {
    const fs = process.mainModule.require('fs');
    const np = process.mainModule.require('path');
    return JSON.parse(fs.readFileSync(np.join(np.dirname(process.mainModule.filename), 'protected.json'), 'utf8'));
  } catch (e) { return {}; }
})();
const HOME = Array.isArray(cfg.home) ? { x: cfg.home[0], y: cfg.home[1], z: cfg.home[2] } : { x: -3, y: 111, z: 4 };
const DEPOT = (cfg.depot || {});

// 5e (#113): FOODS is now the ONE shared allowlist (foods.js), required the same way this
// file already reads protected.json above — see foods.js's own header for why this used to
// be two independently-drifting copies (skills.js's kit gate never got #108's raw-meat
// additions) and why `process.mainModule.require` is the right loading idiom here, not a bare
// `require` (this file has no `require` binding — runner.js's injectPayload constructs it via
// `new AsyncFunction(...)` from source text, no module system in scope). Inline fallback set
// (the pre-5e list) covers the pathological case foods.js itself can't be read at all, so a
// missing/corrupt shared file degrades to the old behavior rather than crashing agenda.js.
const FOODS = (() => {
  try {
    const np = process.mainModule.require('path');
    return process.mainModule.require(np.join(np.dirname(process.mainModule.filename), 'foods.js')).FOODS;
  } catch (e) {
    return new Set(['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
      'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'apple', 'carrot', 'beetroot',
      'melon_slice', 'cookie', 'pumpkin_pie', 'mushroom_stew', 'beetroot_soup', 'rabbit_stew', 'dried_kelp',
      'beef', 'porkchop', 'mutton', 'rabbit']);
  }
})();
A._foods = FOODS;   // exposed for bench/fixtures/foods-huntspecies.js — same object as S._foods when foods.js loaded
const FILLERS = new Set(['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite', 'granite']);
const ROLE_TOOL = { miner: 'pickaxe', lumberjack: 'axe', hunter: 'sword', builder: null, farmer: 'hoe' };
// What a bot DOES when nobody has given it a project. A good human player with no assignment
// finds useful work — chops, mines, tidies — and never stands frozen; our IDLE rung was a null
// idle that only swept for drops, so a bot with no explicit project simply stopped. Felix saw
// five of them sitting at 2500+ ticks doing nothing. This is the "no idle" law and the
// determinism codicil in the same place: the engine defaults to useful role work rather than
// needing the LLM to hand-set every project.
// Bounded counts on purpose — each run completes and repeats, so the ladder keeps its
// interrupt points and nothing here becomes an un-preemptable marathon.
// Values may be a static {skill,args} or a FUNCTION (s) => ({skill,args}) that picks work the
// bot can actually run right now — sense() already carries the state it needs (pos.y,
// torches, toolCounts). engine-dev-3's improvement, and it fixes a real gap: a miner standing
// on the surface asked for a stone lane there is asking for work its own kit gate and the
// terrain will refuse.
const ROLE_WORK = {
  // descend THEN mine: get underground first, then a bounded lane
  miner: (s) => ((s.pos && s.pos.y > 55)
    ? { skill: 'safeDescend', args: { toY: 45, maxSteps: 40 } }
    : { skill: 'mineLane', args: { target: 'stone', count: 16, maxDist: 24 } }),
  lumberjack: { skill: 'chopTrees', args: { count: 2 } },
  // #45 landed (huntAnimals' kit is 'hunt': {torches, weapon:true} — no foodItems at all, see
  // KIT_TIERS in skills.js), which is exactly the revisit this comment used to ask for. Before
  // that, a foodless hunter was refused forever by huntAnimals' own gate, so this pointed at
  // harvestGrass as the honest fallback. That premise is gone: a hunter role now has a real,
  // weapon-gated path to PRODUCE food instead of a seeds-only stopgap. This also closes the
  // live gear-race food deadlock for a role:'hunter' bot on its own, without any new code —
  // effectiveKit's roleWorkKit fallback (#84) now resolves 'hunt' for RESTOCK/TOOL too, so an
  // idle hunter's floor stops demanding food:4 it has no produce path for (ROLE_FLOOR.hunter's
  // food requirement is now superseded here, not removed — a bot WITH a project still uses
  // that project's own floor) and TOOL provisions the sword huntAnimals needs before it runs.
  hunter: { skill: 'huntAnimals', args: {} },
  // farmCycle needs a registered field box, so it cannot be a zero-config default; harvesting
  // grass for seeds is the honest farmer-with-no-field job.
  farmer: { skill: 'harvestGrass', args: {} },
  // Light the base as a periodic chore, then GATHER like a player who's finished it — don't
  // re-scan an already-lit base forever (#72). A._baseChoreLit is set when spawnProof finds
  // nothing dark; it expires after ~10min (read-time) so new dark spots still get caught.
  builder: (s) => {
    if ((s.torches || 0) < 4) return { skill: 'chopTrees', args: { count: 2 } };   // gather wood to light later
    const lit = A._baseChoreLit && (s.now - (A._baseChoreCheckedAt || 0) <= 600000);
    return lit ? { skill: 'chopTrees', args: { count: 2 } } : { skill: 'spawnProof', args: { radius: 12 } };
  },
};
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
    //
    // #107 follow-up, live-caught: "best" used to mean highest RAW DURABILITY, tier ignored
    // entirely — so a freshly-crafted 100%-durability wooden tool consistently outranked an
    // already-used stone one of the SAME class. The gear-progression drive's own s.upgrades
    // reads s.tools[cls].name to decide "already upgraded?", so this made it report the OLD
    // wooden tool as still-held even right after a successful stone craft, firing again —
    // measured live: it crafted three redundant stone_pickaxes in a row (never discarding the
    // now-obsolete wooden ones) before running the shared stick supply to zero, which starved
    // the SWORD upgrade of the sticks it needed and never reached — a bot that let a
    // durability tie silently define "best" not only wasted materials, it broke the
    // multi-class ordering this whole follow-up exists to deliver. Tier now wins first,
    // durability only breaks a tie within the same tier — TOOL_TIER_RANK is a small, local
    // copy of skills.js's own TIER_RANK (that file's internal, not exported); keep them in
    // sync if either changes.
    const TOOL_TIER_RANK = { netherite: 6, diamond: 5, iron: 4, stone: 3, copper: 2.5, golden: 2, wooden: 1 };
    const toolTierRank = (name) => TOOL_TIER_RANK[String(name || '').split('_')[0]] || 0;
    s.toolCounts = {};
    for (const it of items) {
      const m = /_(pickaxe|axe|shovel|hoe|sword)$/.exec(it.name);
      if (!m) continue;
      const cls = m[1];
      const max = it.maxDurability || 0;
      const dur = max ? Math.round(((max - (it.durabilityUsed || 0)) / max) * 100) : 100;
      const cur = s.tools[cls];
      const itTier = toolTierRank(it.name);
      if (!cur || itTier > toolTierRank(cur.name) || (itTier === toolTierRank(cur.name) && dur > cur.dur)) {
        s.tools[cls] = { name: it.name, dur };
      }
      s.toolCounts[cls] = (s.toolCounts[cls] || 0) + 1;
    }

    // Gear-progression drive (team-lead's re-eval, argued in FEEDBACK): a working LOWER-tier
    // tool never asked "could I afford better" — S.ensureTool's bestOwned() short-circuits the
    // moment ANYTHING satisfies the class. tierFor (S.tierFor, already durable-first-correct)
    // is bot-state-independent for a plain class string, so it's safe to call here and belongs
    // here, not in TOOL's fire()/clear() — same "every predicate input comes through the
    // snapshot" rule s.tools/s.toolCounts already follow. Bounded to wooden->stone on purpose:
    // that's tierFor's own bootstrappable boundary (iron/diamond need a furnace/ore chain
    // craftToolChain doesn't cover).
    //
    // #107 follow-up: sword and axe joined pickaxe here — a human upgrades every tool they
    // carry, not just the one their role happens to name. `s.upgrades` is a map (class ->
    // {cls,to}), not a single class, because a bot can have more than one pending upgrade at
    // once (e.g. a lumberjack's own axe AND a separately-carried wooden sword) — TOOL's act()
    // picks which one to pursue this tick; the ladder naturally works through the rest on
    // later ticks since an addressed class simply stops appearing in this map next sense().
    s.upgrades = {};
    {
      const S = globalThis.__skills;
      if (S && typeof S.tierFor === 'function') {
        let tableInReach = false;
        try {
          tableInReach = items.some((i) => i.name === 'crafting_table')
            || Boolean(bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 }));
        } catch (e) {}
        const classes = new Set([activeClass(s), 'sword', 'axe'].filter(Boolean));
        for (const c of classes) {
          let payable = null;
          try { payable = S.tierFor(c, items, tableInReach); } catch (e) {}
          const heldName = s.tools[c] && s.tools[c].name;
          // UPGRADE means "already holds a working wooden tool of this class" — NOT missing
          // (that's classBroken's/weaponMissing's own job, a genuine need, already gated
          // above this in fire()/act()). Live-caught before it ever shipped: the original
          // pickaxe-only version accepted a missing tool here too (`!heldName`), which was
          // harmless there ONLY because a missing active-class pickaxe is always intercepted
          // by classBroken first, at higher priority, before this branch is ever reached.
          // Sword/axe have no equivalent intercept for "this ONE class is missing" (only
          // weaponMissing, which fires solely when BOTH are absent) — so the same `!heldName`
          // check here would manufacture a brand-new axe or sword from scratch for any bot
          // with spare materials, even one that never held or needed that class at all. That
          // is acquisition, not upgrade, and out of this feature's scope.
          if (payable === `stone_${c}` && heldName && heldName.startsWith('wooden_')) s.upgrades[c] = { cls: c, to: payable };
        }
      }
    }

    const d = globalThis.__danger;
    s.dangerState = d ? d.state : 'calm';
    s.dangerScore = d ? d.score : 0;
    s.light = d ? d.light : null;
    s.surfaceExposed = d ? d.surfaceExposed : null;
    s.threat = d && d.nearest ? d.nearest : null;

    const sv = globalThis.__survival;
    s.survivalActive = Boolean(sv && sv.active);
    // #105/SHELTER rung: __survival.shelter.should()/status() are pure predicates over live
    // bot state, but reading them straight from a rung's fire()/clear() would break the same
    // "every predicate input comes through the snapshot" rule s.tools/s.upgrade already
    // follow — bench/fixtures/agenda-ladder.js's dry-run injection cannot inject "what
    // survival.js's own g.shelter object currently contains", only fields on s itself.
    s.shelterShould = false; s.shelterActive = false; s.isDay = null;
    if (sv && sv.shelter) {
      try { s.shelterShould = Boolean(sv.shelter.should()); } catch (e) {}
      // ONE status() call, both fields read off it — isDay is TODO 5g's (below), reusing
      // survival.js's own isDaylight() rather than a second, independently-drifting copy of
      // day/night logic in this file (the exact bug class #113's shared FOODS fix just closed).
      try { const st = sv.shelter.status(); s.shelterActive = Boolean(st.active); s.isDay = st.isDay; } catch (e) {}
    }
    // TODO 5g (#116): spawn-camp detection. Pruned to the rolling window every real tick (dry
    // run skips this whole function body, see sense()'s own early `if (inject) return ...`).
    bot._deathTimes = (bot._deathTimes || []).filter((t) => s.now - t < SPAWN_CAMP_WINDOW_MS);
    const camp = spawnCampCheck(bot._deathTimes, s.now, bot._spawnCamp.openedAt, s.isDay);
    s.recentDeaths = camp.recentDeaths;
    s.justRespawned = Boolean(camp.lastDeathAt) && (s.now - camp.lastDeathAt) < RESPAWN_GRACE_MS;
    s.hostileNear = Boolean(s.threat && s.threat.d <= 16);
    s.spawnCamped = camp.spawnCamped;
    // #97: track an unbroken "panic, but survival.js isn't engaging" streak, plus whether any
    // damage landed during it. Either signal breaking (state leaves panic, survival engages,
    // or a hit lands) resets the streak immediately -- see PANIC_STALE_MS's own comment.
    if (s.dangerState === 'panic' && !s.survivalActive) {
      if (!A._panicIdleSince) { A._panicIdleSince = s.now; A._panicIdleDamaged = false; }
      else if (typeof A._panicIdleLastHp === 'number' && s.hp < A._panicIdleLastHp) A._panicIdleDamaged = true;
      A._panicIdleLastHp = s.hp;
    } else {
      A._panicIdleSince = 0; A._panicIdleDamaged = false; A._panicIdleLastHp = null;
    }
    s.panicStale = Boolean(A._panicIdleSince) && !A._panicIdleDamaged && (s.now - A._panicIdleSince) > PANIC_STALE_MS;
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
// Gear-progression drive (#107 follow-up): which pending upgrade (if any) TOOL should pursue
// next, out of possibly several in s.upgrades. Priority: the active class (what the bot's
// CURRENT work actually depends on) first, then sword, then axe — see the ordering argument
// in FEEDBACK.md. Pure function of the snapshot, safe for fire()/clear()/act() alike.
const nextUpgrade = (s) => {
  if (!s.upgrades) return null;
  const active = activeClass(s);
  for (const c of [active, 'sword', 'axe']) {
    if (c && s.upgrades[c]) return s.upgrades[c];
  }
  return null;
};
// Does the departure gate want a weapon we do not have? kitCheck accepts a sword OR an axe,
// so this must too, or TOOL would keep acquiring a sword for a bot already carrying an axe.
const weaponMissing = (s) => {
  const k = effectiveKit(s);
  if (!k || !k.weapon) return false;
  const t = s.tools || {};
  return !(t.sword || t.axe);
};
// Is the gate short of PICKAXES? This has to be asked independently of the project's own tool
// class, which is the bug engine-dev-3's sustained-loop verify caught. TOOL used to reach the
// pick requirement only through activeClass, so a project with no explicit `tool` on a bot
// whose role maps to no tool (builder -> null, or a role-less bot) left `picks: 2` aimed at by
// nothing at all: fire() false, clear() TRUE, kitCheck still saying "pickaxes 1/2", mineLane
// refused forever. Exactly the same shape as the weapon gap, one requirement over — a kit
// demand is a demand whether or not the project happens to name that tool.
const kitPickShort = (s) => {
  const k = effectiveKit(s);
  if (!k || !k.picks) return false;
  return ((s.toolCounts || {}).pickaxe || 0) < k.picks;
};
// Floors come from the KIT GATE when a project is set, because that gate is what will
// actually refuse the departure. Using the role default instead let a project sit blocked on
// a requirement no rung was aiming at.
const activeFloors = (s) => {
  if (A.project && A.project.restockFloor) return A.project.restockFloor;
  const k = effectiveKit(s);          // s, not bot: this feeds RESTOCK's fire/clear
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
// Shared by projectKit/roleWorkKit below: resolve a skill's kit tier for a given (skill, args),
// honouring the position-only-shim contract above.
const resolveKit = (s, skillName, args) => {
  const S = globalThis.__skills;
  if (!S || !S.kitTiers || !S.registry) return null;
  const spec = S.registry[skillName];
  if (!spec || !spec.kit) return null;
  const src = (s && s.injected && s.pos) ? { entity: { position: s.pos } } : bot;
  const tier = typeof spec.kit === 'function' ? spec.kit(args || {}, src) : spec.kit;
  return tier ? (S.kitTiers()[tier] || null) : null;
};
const projectKit = (s) => {
  try {
    if (!A.project) return null;
    return resolveKit(s, A.project.skill, A.project.args);
  } catch (e) { return null; }
};
A.projectKit = projectKit;
// #84: the kit tier idle ROLE-WORK is about to need, when there is no project. TOOL/RESTOCK
// used to consult projectKit ONLY, so a bot with no project (base worked out, #67) had its
// departure-kit shortfall aimed at by nothing — while S.start's OWN kit preflight was actively
// refusing IDLE's role-work with kit_missing every ~30s cycle, from a kit spec (the role-work
// SKILL's, e.g. mineLane's underground/deep) that TOOL/RESTOCK never looked at. Two different
// rungs reading two different sources of "what kit is relevant" is exactly how a bot ends up
// stuck repeating "Not setting off half-kitted" while the rungs that could fix it stay dark.
// Same shim/determinism contract as projectKit: ROLE_WORK entries only ever read s.pos/s.now/
// s.torches (verified by inspection), so this stays replay-safe.
const roleWorkKit = (s) => {
  try {
    const w = ROLE_WORK[s.role];
    const work = typeof w === 'function' ? w(s) : w;
    if (!work) return null;
    return resolveKit(s, work.skill, work.args);
  } catch (e) { return null; }
};
// The kit tier TOOL/RESTOCK should aim at right now: the active project's when one is set —
// a real project's requirement is never softened by what idle role-work would have wanted —
// else the tier idle role-work needs. This is deliberately NOT a new rung and NOT a relaxed
// floor (see FEEDBACK.md #84): the existing TOOL/RESTOCK machinery already knows how to
// complete a kit, it was just blind to idle's own kit source.
const effectiveKit = (s) => projectKit(s) || roleWorkKit(s);
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

// ---------------- #67b: base-barren detection + relocate trigger ----------------
// IDLE role-work can no-op: at a worked-out or protected base, chopTrees/mineLane throw
// not_found and safeDescend/harvestGrass return a zero-yield result. Standing there re-running
// the same empty scan is the "five bots frozen" bug one level up. So we GRADE each finished
// IDLE work run, count consecutive barren outcomes, and once the ground is proven empty walk the
// bot to fresh terrain (the relocateToWork skill) before letting it try its trade again.
const RELOCATABLE = new Set(['chopTrees', 'harvestGrass', 'mineLane', 'safeDescend']);
const BARREN_ERRS = new Set(['not_found', 'no_target', 'none']);   // "nothing of the kind here"
// #89: a project's own error code, once p.blocked (PROJECT's act(), 3 failed attempts),
// that means "cannot get there" rather than "nothing to find" or "missing kit/tool" — the
// ESCAPE rung's trigger for a bot that may have dug itself into a sealed pocket.
const PATH_BLOCKED = new Set(['no_path', 'unreachable', 'stuck']);
// worked | barren | other. 'other' (kit_missing, no_tool, busy) is NOT barren — RESTOCK/TOOL own
// it — so it must never trip a relocate. Unknown skills default to 'worked' so a bot making
// progress we cannot read is never marched off its work.
const idleWorkOutcome = (skill, result, error) => {
  if (error) return BARREN_ERRS.has(error.code) ? 'barren' : 'other';
  const r = result || {};
  const did = ({
    chopTrees:      () => (r.treesFelled || 0) > 0,
    harvestGrass:   () => (r.cut || 0) > 0,
    mineLane:       () => (r.dug || 0) > 0,
    safeDescend:    () => (r.endY != null && r.startY != null) ? r.endY < r.startY : true,
    spawnProof:     () => (r.placed || 0) > 0,   // #72: 0 placed = base already lit (barren base-chore)
    relocateToWork: () => Boolean(r.relocated),
  }[skill] || (() => true))();
  return did ? 'worked' : 'barren';
};
A._idleWorkOutcome = idleWorkOutcome;   // exposed for bench/fixtures/agenda-idlework.js
A._spawnCampCheck = spawnCampCheck;     // exposed for bench/fixtures/agenda-ladder.js (TODO 5g)

// ---------------- 5c: same-remedy-repeats-across-positions escalation ----------------
// Soak #4 (2026-09-03): a repeated remedy kept getting redispatched from a fresh position
// every time it failed, forever. Two separate live specimens, R2-diagnosed on the persisted
// world (bench/decider-latency-replay.js's sibling investigation, see FEEDBACK.md):
//  (1) RESTOCK's own depot withdrawal failed 3x in a row (physics wedge x2, reached:0 a
//      third time — "the depot is unreachable from here, not empty", restock's own words)
//      while the ladder's GENERIC standDown() backoff (30s->60s->120s->300s CEILING, then
//      repeats forever at the ceiling) kept retrying the identical "walk to the depot chest"
//      remedy from wherever RESTOCK's own retry cadence happened to place the bot next — the
//      depot itself never got any closer or more reachable.
//  (2) A decider-dispatched chopTrees PROJECT resets `p.attempts` to 0 on every fresh
//      dirDispatch (A.setProject always builds a brand-new project object — see its own
//      comment), so the EXISTING 3-strikes project_blocked escalation (below, in the harvest
//      block) never accumulates across the direction-episode boundary the decider reopens
//      after each single failure. TOOL's ensureTool hit the identical wall trying to gather
//      wood for a sword (`gather:wood(0/11 reached)`, repeated many times, no escalation).
// Neither is a position-keyed repeat decider.js's frozen_repeat dedup (or a bespoke local
// fix) could have caught: RESTOCK isn't decider-driven at all, and the PROJECT case's
// dispatch positions genuinely differ tick to tick. The shared invariant across BOTH: the
// SAME remedy, tried again and again, never succeeding, regardless of exactly where the bot
// stood when it tried. So failures are tracked by REMEDY CLASS (what the bot was actually
// trying to accomplish), not by rung id or task name — restock's depot walk, TOOL's wood
// search and a decider-dispatched chopTrees project are three different callers, but at most
// two remedy classes below, and each of the three counts against its class's shared total,
// not its own (team-lead's note: "else the three callers each get their own N").
const REMEDY_ESCALATE_N = 2;        // 2nd same-class failure -> tier 1; 3rd+ -> tier 2
const REMEDY_FAIL_WINDOW_MS = 20 * 60000;   // stale failures don't stack against an unrelated later problem
const REMEDY_HOP_BIG = 64;          // relocateToWork's own cap — bigger than its 40-block default
const REMEDY_FIND_RADIUS = 128;     // tier 2's wide findBlocks scan for a REAL, currently-visible target
// depot_reach has no "block to walk toward" (the depot IS the target and RESTOCK is already
// aimed at it) — only classes with an actual searchable block get a tier-2 directed move;
// everything else's tier 2 is tier 1 again, just re-tried (still counts, still logged).
const REMEDY_TARGET_BLOCKS = {
  wood_gather: ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'pale_oak_log', 'mangrove_log'],
};
const REMEDY_RELOCATE_SKILL = { wood_gather: 'chopTrees', ore_gather: 'mineLane' };   // relocateToWork's own 'skill' param picks wood/dig/ground terrain
// Static, not content-sniffed: chopTrees/harvestGrass ARE the wood remedy by definition.
// ensureTool/restock report their OWN class from what they were actually trying to do (see
// the three call sites below) since one task name covers many different underlying needs.
const REMEDY_CLASS_OF_SKILL = { chopTrees: 'wood_gather', harvestGrass: 'wood_gather', mineLane: 'ore_gather' };
const remedyEmit = (fields) => {
  try { console.log(new Date().toISOString() + ' AGENDA_EVENT ' + JSON.stringify(Object.assign({ ev: 'remedy' }, fields))); } catch (e) {}
  try { const m = M(); if (m && m.emit) m.emit('remedy_escalate', fields); } catch (e) {}
};
const remedyFail = (cls, s) => {
  if (!cls) return;
  const r = A.remedy[cls] || { n: 0, firstAt: s.now, escalatedAt: 0 };
  if (s.now - r.firstAt > REMEDY_FAIL_WINDOW_MS) { r.n = 0; r.firstAt = s.now; r.escalatedAt = 0; }
  r.n += 1;
  A.remedy[cls] = r;
  if (r.n >= REMEDY_ESCALATE_N) remedyEmit({ op: 'fail', cls, n: r.n, pos: (s.pos && [Math.round(s.pos.x), Math.round(s.pos.y), Math.round(s.pos.z)]) || null });
};
const remedyOk = (cls) => { if (cls) delete A.remedy[cls]; };
// The one class currently escalatable, deterministic by insertion order (Object.keys order
// for string keys is insertion order in JS — no separate priority list needed here; there
// are at most two classes today and neither out-ranks the other).
const pendingRemedyClass = () => {
  for (const [cls, r] of Object.entries(A.remedy)) {
    if (r.n >= REMEDY_ESCALATE_N && r.escalatedAt !== r.n) return cls;
  }
  return null;
};

const RELOCATE_BACKOFF_MS = 5 * 60000;
const RELOCATE_WANDER_CAP = 5;          // hops without finding work before we settle and sweep
// Grade the IDLE work run we last started, exactly once, the tick it is found finished.
// S.currentTask persists after done until the next start, so the terminal result/error is on the
// snapshot; injected test snapshots that omit _raw simply skip, as deterministic replay wants.
// openEpisode/closeEpisode: the single latch. At most one open episode per bot — a second
// openEpisode call while one is already open, or while its per-`why` reopen backoff hasn't
// expired, is a no-op (backoff instead sets state:'cooldown', VISIBLE on /state — nothing is
// silently suppressed; see markProductive below for how reopenCount resets).
let _epSeq = 0;
const openEpisode = (why, detail, s) => {
  const d = A.direction;
  if (d.episode) return;                                         // single-latch
  if ((d.reopenAt[why] || 0) > s.now) { d.state = 'cooldown'; return; }  // deferred, not suppressed
  const eid = 'd' + Date.now().toString(36) + (++_epSeq);
  d.episode = { id: eid, why, openedAt: s.now, detail };
  d.state = 'needs_direction';
  d.opened++; d.byWhy[why] = (d.byWhy[why] || 0) + 1;
  // engine-dev's direction-gate latency-breakdown ask (task 2, metrics.mjs), ties directly to
  // 5d/test-driver's run-#6 finding: an episode can open while its own rung is STILL cooling
  // down from a PREVIOUS project's standDown (before 5d's setProject reset ever gets a chance
  // to run — an open here can precede the driver/decider redirect that eventually clears it).
  // Surfacing it on the open record itself lets the grader compute exactly how much of a
  // close's reported latency is standdown carryover, not decision time, without hand-reading
  // AGENDA_EVENT log lines the way test-driver had to.
  const ownerId = A.owner ? A.owner.id : null;
  const sd = ownerId && A.standDown[ownerId] > s.now ? { rung: ownerId, until: A.standDown[ownerId] } : null;
  dirEmit('open', { eid, why, project: A.project ? A.project.skill : null, detail, rung: ownerId, pos: s.pos || null, standDown: sd });
};
const closeEpisode = (closedBy, skill, s) => {
  const d = A.direction;
  const ep = d.episode;
  if (!ep) return;
  const latency_ms = s.now - ep.openedAt;
  d.closed++;
  const n = d.reopenCount[ep.why] || 0;
  d.reopenAt[ep.why] = s.now + DIRECTION_REOPEN_MS[Math.min(n, DIRECTION_REOPEN_MS.length - 1)];
  d.reopenCount[ep.why] = n + 1;
  dirEmit('close', { eid: ep.id, why: ep.why, closedBy, latency_ms, skill: skill || null });
  d.episode = null;
  d.state = 'ok';
};

// markProductive: the churn-proof productivity clock. Stamped ONLY by verified-outcome
// branches (never A.ownerSince — tick's NO_PROGRESS handler nulls the owner even at the
// floor, so ownerSince can never accumulate a window on a wedged bot). Resets the per-why
// reopen backoff counters (a real recovery earns a fresh, non-escalated backoff next time)
// and, if an episode happens to be open, closes it — a bot that fixed itself before anything
// answered the episode should read as self-recovered, not left open forever.
const markProductive = (s, src) => {
  A.direction.lastProductiveAt = s.now;
  A.direction.reopenCount = {};
  if (A.direction.episode) closeEpisode('self_recovered', src, s);
};

// #68 (h): the central direction-episode detector. Called once per tick, immediately after
// the harvest block closes and BEFORE choose(s) picks a rung — so an episode opened this tick
// is already visible to whichever rung consults it (today: none; ESCAPE and any future
// consumer read A.direction/A.project directly, same as everything else in this file).
// Exposed as A._directionCheck for fixtures, same discipline as A._idleWorkOutcome.
const directionCheck = (s) => {
  // #103: the respawn flag lives on `bot`, not on `A` (see its own comment at module init,
  // above — a double-injection race can otherwise lose it). Checked first — a bot that JUST
  // died is provably projectless and idle, not probably, so this doesn't wait on the
  // composite-level edges below to eventually infer the same thing.
  if (bot._respawnedNeedsDirection) {
    bot._respawnedNeedsDirection = false;
    openEpisode('respawned', {}, s);
  }
  // composite level — catches EVERY current/future mutation site of p.blocked / completedOnce
  // / A.blocked (including a driver's own /eval writes) without a per-site call at each one.
  const p = A.project;
  const lvl = !p ? 'none'
    : p.blocked ? 'blocked'
    : (A.blocked && A.blocked.why === 'no_tool') ? 'no_tool'   // its OWN arm: projectDone() never reads A.blocked
    : projectDone(s) ? 'done' : 'active';
  const prev = A.direction.prevLvl;
  A.direction.prevLvl = lvl;
  // EDGES (project lifecycle) — fire once, on the transition into the level, never while
  // already in it (so a level that stays 'blocked' for an hour opens exactly one episode).
  if (prev === 'active' && lvl === 'done') openEpisode('project_done', { skill: p.skill }, s);
  if (prev !== 'blocked' && lvl === 'blocked') openEpisode('project_blocked', { skill: p.skill, lastError: p.lastError, attempts: p.attempts }, s);
  if (prev !== 'no_tool' && lvl === 'no_tool') openEpisode('no_tool', { cls: A.blocked.cls }, s);
  // LEVELS (windows on the churn-proof productivity clock). Gated on no in-flight task so a
  // long productive run (a 200-block haul) can never false-fire — a wedged RUNNING act is
  // ACT_TIMEOUT_MS/busyStuck's jurisdiction, not this detector's.
  const running = Boolean(s.task && s.task.running);
  const quiet = s.now - A.direction.lastProductiveAt;
  if (!p && !running && quiet > DIRECTION_IDLE_WINDOW_MS) {
    openEpisode('unproductive_idle', { barren: A._barren || 0, role: A.role }, s);   // E2
  }
  if (p && !projectDone(s) && !running && quiet > DIRECTION_STALL_MS) {
    // E3a — the kit-deadlock catcher: kit_missing/no_tool reset p.attempts on every refused
    // start (the repair-not-block rule), so p.blocked never latches for a project stuck
    // behind a gate the maintenance rungs keep failing to clear. This window catches it by
    // productivity, not by attempt-counting.
    openEpisode('project_stalled', { skill: p.skill, lastError: p.lastError, blocked: A.blocked && A.blocked.why }, s);
  }
  if (p && p.repeat && (p.barrenRuns || 0) >= DIRECTION_BARREN_RUNS) {
    openEpisode('project_stalled', { skill: p.skill, barren: p.barrenRuns, repeat: true }, s);   // E3b — zero-yield repeat
  }
};
A._directionCheck = directionCheck;   // exposed for fixtures, same discipline as A._idleWorkOutcome
// #68 (g)'s own promotion condition, pure and exposed so a fixture can test cases 2/3 by
// injection (a finished non-repeat project with a staged next promotes; a repeat project
// never does) without needing to drive a real finished task through the harvest block. The
// REAL promotion site calls this SAME function, not a copy of the condition — no drift risk
// between what a fixture verifies and what actually runs.
A._promoteCheck = (p, nextProject) => Boolean(p && !p.repeat && nextProject);

const gradeIdleWork = (s) => {
  const lw = A._lastIdleWork;
  if (!lw || !s.task || s.task.id !== lw.id || s.task.running) return;
  A._lastIdleWork = null;                              // terminal — grade at most once
  if (s.task._raw && s.task._raw.cancelled) return;    // preempted, not barren
  if (!s.task._raw && !s.task.error) return;           // minimal injected snapshot: nothing to read
  const out = idleWorkOutcome(lw.skill, s.task._raw && s.task._raw.result, s.task.error);
  if (lw.skill === 'relocateToWork') {
    // A relocate that MOVED gives fresh ground next cycle; one that found nowhere backs off so
    // the bot stops pacing. Too many hops without work also settles it, rather than marching off.
    if (out === 'worked') {
      A._barren = 0;
      if ((A._wander = (A._wander || 0) + 1) >= RELOCATE_WANDER_CAP) {
        A._relocateBackoff = s.now + RELOCATE_BACKOFF_MS; A._wander = 0;
        note('relocated far without finding work — settling for a bit');
      }
    } else { A._relocateBackoff = s.now + RELOCATE_BACKOFF_MS; note('relocate found nowhere new — backing off'); }
    return;
  }
  if (lw.skill === 'spawnProof') {
    // #72: base-chore latch — 0 placed means the base is already lit, so next builder cycle
    // gathers instead of re-scanning a lit base. Deliberately does NOT touch A._barren:
    // spawnProof isn't relocatable, and the builder's chopTrees fallthrough grades its own.
    A._baseChoreCheckedAt = s.now;
    A._baseChoreLit = (out === 'barren');
    if (A._baseChoreLit) note('base already lit — builder switches to gathering');
    return;
  }
  if (out === 'worked') { if (A._barren) note(`${lw.skill} progressed — area not barren after all`); A._barren = 0; A._wander = 0; markProductive(s, 'idle_work'); }
  else if (out === 'barren') { A._barren = (A._barren || 0) + 1; note(`${lw.skill} no-op — area looks barren (${A._barren})`); }
  // 'other' (kit/transient) leaves the barren count untouched; the maintenance rungs own it.
};

// ---------------- the ten rungs ----------------
const RUNGS = [
  { id: 'REFLEX', prio: 0, safety: true,
    // #97: `panicStale` (see PANIC_STALE_MS's own comment) only ever goes true after a
    // sustained window of panic with survival.js never engaging AND zero health lost during
    // it -- while survival.js IS active, or panic is fresh, this is unconditionally identical
    // to the original behavior.
    fire: (s) => s.survivalActive || (s.dangerState === 'panic' && !s.panicStale),
    clear: (s) => !s.survivalActive && (s.dangerState !== 'panic' || s.panicStale),
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
  // TODO 5h (#117): same dead-end shape and same fix as EAT below — see that rung's own
  // comment. This one matters MORE: prio 2 means only REFLEX/POSTURE (0/1, real combat) could
  // ever preempt a stuck EAT_CRITICAL, so a bot that hits this without a nearby threat has NO
  // engine-internal escape at all (confirmed live: 65+ continuous seconds, no self-recovery).
  { id: 'EAT_CRITICAL', prio: 2, preemptNow: true,
    fire: (s) => s.food <= 6 && s.foodCount > 0,
    clear: (s) => s.food >= 19 || s.foodCount === 0,
    act: async () => ((await eatInline()) ? 'ate' : 'none') },

  // #105: proactive night shelter. engine-dev's survival.js v11 owns the PRIMITIVES
  // (shelterDigIn/shelterHut, the exit state machine) and exposes should()/enter()/exit()/
  // status() for exactly this rung — this is the other half team-lead split the work into.
  // Priority ~2.5, deliberately between EAT_CRITICAL (2, a genuine emergency) and everything
  // travel-requiring below it (DEPOSIT/EAT/TOOL/RESTOCK/LIGHT/PROJECT/ESCAPE, prio 3-8.5): a
  // bot exposed at real night with no armor tier to fight it should seal up BEFORE any of
  // those get another chance to walk it into the dark, but REFLEX/POSTURE (0/1) and a real
  // food emergency still come first — SHELTER is prevention, not the reflex itself.
  //
  // fire() only asks "should I START" — should()'s own g.shelter.active check makes it
  // return false the instant enter() is under way, by design (survival.js's own doc: "nothing
  // here runs on its own timer... agenda polls should()"). LATCHING therefore has to run on
  // clear(), never on fire() staying true, which is exactly how choose()'s owner/clear logic
  // already works everywhere else in this file (see its own comment) — no special-casing
  // needed here, just don't make the mistake of gating fire() on shelterActive too.
  // TODO 5g (#116): two additional triggers, ORed onto survival.js's own shelterShould, both
  // deliberately NOT touching shouldShelter()'s `d.state==='panic'` exclusion (survival.js's
  // own doctrine there — "REFLEX/POSTURE already own this" — stays correct: REFLEX/POSTURE
  // sit at prio 0/1, ABOVE SHELTER's 2.5, so they win arbitration over SHELTER regardless of
  // what SHELTER's own fire() says the instant real panic is active; widening fire() cannot
  // preempt them and was never going to fix the "already panicking" case). What these DO fix,
  // from the exact incident (test-driver, run #6, FEEDBACK ~09:40Z): Death #2's dig-in fired
  // but lost the race to a hostile that hadn't reached full panic-range yet — `spawnCamped`
  // and the `justRespawned` grace window get SHELTER starting SOONER, in the pre-panic window,
  // rather than waiting for shouldShelter()'s own (correctly conservative) gearTier/exact-
  // night gates. `spawnCamped` alone covers a bot already mid-streak even in daylight or with
  // decent gear — the point past 3 deaths in 90s isn't "is this normally worth sheltering
  // for", it's "something is actively killing this bot, stop everything else".
  { id: 'SHELTER', prio: 2.5,
    fire: (s) => s.shelterShould || s.spawnCamped || (s.justRespawned && s.surfaceExposed && (s.isDay === false || s.hostileNear)),
    clear: (s) => !s.shelterActive,
    act: async (s) => {
      // Not a __skills task (enter() stops any running one itself, then drives the body
      // directly) — no runSkill/activeTaskId here, that machinery is for the OTHER kind of
      // work. Fire-and-forget by design (survival.js's own doc, same convention as its
      // enter()/g.drill()): awaiting a multi-hour night would freeze the whole ladder loop
      // exactly the way ACT_TIMEOUT_MS exists to prevent. Poll status().active via s.shelterActive instead.
      const sv = globalThis.__survival;
      if (!sv || !sv.shelter) { A.blocked = { why: 'no_survival_shelter', at: now() }; return 'blocked'; }
      if (s.shelterActive) return 'running';
      // Live-caught, two bugs stacked: (1) a genuine build failure (survival.js's own
      // "no_viable_primitive" — no filler for a hut AND the ground under the bot isn't deep
      // enough for dig-in) resolves g.shelter.active back to false almost immediately, well
      // inside one tick interval, so fire()/act() re-triggered enter() every tick forever with
      // nothing tracking the failure. (2) The first fix — chaining a standDown('SHELTER')
      // onto enter()'s promise — did not actually stick: returning 'started' here hits
      // tick()'s own generic "task started successfully" handler
      // (`r !== 'running' && r !== 'cooldown' -> clear standDown`), which raced my async
      // .then() and deleted the stand-down it had just set, every time. Returning 'running'
      // instead (there is no __skills task to be "started" here in the first place — the
      // whole point of this branch is that enter() is already in flight) skips that generic
      // handler entirely, same as every tick where s.shelterActive is already true above,
      // and leaves standDown as the sole authority on backoff.
      sv.shelter.enter().then((r) => { if (!r || r.ok === false) standDown('SHELTER'); }).catch(() => standDown('SHELTER'));
      note('SHELTER: entering for the night');
      return 'running';
    } },

  { id: 'DEPOSIT', prio: 3,
    fire: (s) => s.freeSlots <= 2,
    clear: (s) => s.freeSlots >= 6,
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const pos = Array.isArray(DEPOT.minerals) ? { x: DEPOT.minerals[0], y: DEPOT.minerals[1], z: DEPOT.minerals[2] } : undefined;
      const r = runSkill('depositToChest', pos ? { pos } : {}, 'DEPOSIT');
      return r.ok ? 'started' : (r._transient ? 'busy' : 'refused');
    } },

  // TODO 5h (#117): owner-latch deadlock (engine-dev, live find on 872aa07, FEEDBACK
  // ef0fe53). `choose()`'s owner-latch (`if (owner && !safeClear(owner,s) &&
  // demanded.prio>=owner.prio) return owner`) never re-checks the owner's OWN fire() — by
  // design, for hysteresis (this file's own header: "fire() and clear() are deliberately
  // different thresholds on every rung; that gap IS the hysteresis" — e.g. RESTOCK stays
  // latched between its fire floor and its clear ceiling on PURPOSE, still making real
  // progress toward clear() the whole time). EAT/EAT_CRITICAL's bug is NOT that shape: once
  // `foodCount` hits 0 (the last food item eaten without reaching food>=19 — routine, not an
  // edge case, for a bot that was genuinely starving), fire() goes false (foodCount>0 fails)
  // AND clear() stays false (food<19) — a genuine DEAD END, not hysteresis-in-progress,
  // because there is nothing left to eat and never will be until FOOD (prio 6.5, which cannot
  // preempt a latched HIGHER-priority owner) gets a turn. `clear()` widened to release the
  // instant that dead end is reached, at the SAME `safeClear(owner,s)` call site `choose()`
  // already uses for every other rung — not a blanket "re-check fire() every tick" change to
  // `choose()` itself, which would have broken hysteresis file-wide (RESTOCK's own #84
  // boundary-bounce fix depends on exactly the gap this would have erased). Audited LIGHT and
  // RESTOCK for the same shape per the lead's ask — NEITHER has it: both already report a
  // genuine resource-exhaustion honestly through act()'s own return value (`'no_spot'`/
  // `'refused'`, both in NO_PROGRESS), which tick()'s EXISTING generic handler
  // (`NO_PROGRESS.has(r) -> standDown + A.owner=null`) already releases correctly — EAT/
  // EAT_CRITICAL were the outliers because `eatInline()`'s wrapper (below) swallowed its own
  // outcome and unconditionally reported `'ate'` regardless of whether anything was eaten,
  // which is ALSO fixed here (defense in depth: if the instant clear()-release above is ever
  // bypassed for any reason, act() honesty is the second, independent release path — the same
  // NO_PROGRESS/standDown mechanism LIGHT/RESTOCK already rely on, no new machinery).
  { id: 'EAT', prio: 4,
    fire: (s) => s.food <= 17 && s.foodCount > 0,
    clear: (s) => s.food >= 19 || s.foodCount === 0,
    act: async () => ((await eatInline()) ? 'ate' : 'none') },

  // 5c: same-remedy-repeats-across-positions escalation. Prio 4.8 — above TOOL/RESTOCK/
  // PROJECT (the three callers that can accumulate a remedy-class failure, see the helpers
  // above) so it can actually preempt whichever of them is stuck, below EAT/SHELTER/DEPOSIT
  // (a starving or unsafe bot's own needs still come first). Fires AT MOST ONCE per distinct
  // failure count (escalatedAt guards it — see pendingRemedyClass), so it makes exactly one
  // move then hands the body straight back to the rung that was actually stuck, from
  // wherever that move landed. If the underlying remedy still fails, that rung's own harvest
  // branch bumps the SAME class's counter again, and this rung fires again at the next tier
  // — no bespoke retry/backoff of its own; a REMEDY move that itself accomplishes nothing
  // (relocateToWork finds no reachable spot, or 'come' can't get in range) is caught by the
  // file's own GENERIC "completed but did not achieve" unproductive detector exactly like
  // any other rung, standing REMEDY itself down rather than looping forever.
  { id: 'REMEDY', prio: 4.8,
    fire: (s) => pendingRemedyClass() !== null,
    clear: (s) => pendingRemedyClass() === null,
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const cls = pendingRemedyClass();
      if (!cls) return 'none';
      const r = A.remedy[cls];
      r.escalatedAt = r.n;   // mark THIS failure count escalated before dispatch, so a refusal can't re-fire-storm
      const tier = r.n >= REMEDY_ESCALATE_N + 1 ? 2 : 1;
      remedyEmit({ op: 'escalate', cls, n: r.n, tier, pos: (s.pos && [Math.round(s.pos.x), Math.round(s.pos.y), Math.round(s.pos.z)]) || null });
      note(`REMEDY: ${cls} failed ${r.n}x — tier ${tier} escalation`);
      if (tier >= 2 && REMEDY_TARGET_BLOCKS[cls]) {
        // A human who can SEE the trees on the far hill walks toward them — not another blind
        // relocate heading. bot.findBlock over a WIDE radius for a real, currently-visible
        // target of the right kind; only if one actually exists does this branch fire.
        try {
          const ids = REMEDY_TARGET_BLOCKS[cls].map((n) => bot.registry.blocksByName[n] && bot.registry.blocksByName[n].id).filter((x) => x != null);
          const found = ids.length ? bot.findBlock({ matching: ids, maxDistance: REMEDY_FIND_RADIUS }) : null;
          if (found) {
            const p = found.position;
            const rr = runSkill('come', { x: p.x, y: p.y, z: p.z, range: 3 }, 'REMEDY');
            if (rr.ok) return 'started';
            if (rr._transient) return 'busy';
            // refused — fall through to the tier-1 relocate below rather than giving up outright
          }
        } catch (e) {}
      }
      const rr2 = runSkill('relocateToWork', { skill: REMEDY_RELOCATE_SKILL[cls] || null, hops: REMEDY_HOP_BIG }, 'REMEDY');
      return rr2.ok ? 'started' : (rr2._transient ? 'busy' : 'refused');
    } },

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
      // Both of these are the GATE's requirements, so they are asked before the project's own
      // tool class — they hold even when that class is null.
      if (weaponMissing(s)) return true;
      if (kitPickShort(s)) return true;
      const c = activeClass(s);
      if (!c) return false;
      const b = s.tools[c];
      if (!b || b.dur <= 15) return true;
      // gear-progression drive: lowest priority of TOOL's own triggers — a broken/missing
      // tool always outranks a mere upgrade. s.upgrades is already gated to "payable tier is
      // strictly better than what's held" (sense()'s job, not this predicate's).
      if (nextUpgrade(s)) return true;
      return false;
    },
    clear: (s) => {
      if (weaponMissing(s)) return false;
      if (kitPickShort(s)) return false;
      // an upgrade in progress must not clear just because the OLD tool is still healthy —
      // clear()'s own health check below knows nothing about tiers.
      if (nextUpgrade(s)) return false;
      const c = activeClass(s);
      if (!c) return true;
      const b = s.tools[c];
      if (!(b && b.dur > 25)) return false;
      return true;
    },
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const c = activeClass(s);
      // Run acquisition as a TASK, not an awaited method: a chain that gathers wood, crafts
      // planks, places a table and crafts the tool can outrun the 180s act cap, and when it
      // does the ladder force-releases while the acquisition keeps going unowned. As a task
      // the act returns immediately, oursRunning() reports 'running' each tick, and stopping
      // it is a clean step-boundary stop.
      // If we already hold a working tool and the gate wants a BACKUP, ask for a spare —
      // otherwise ensureTool answers "you have one" and the rung can never clear.
      // Priority within the rung: the project's own tool if it is broken or missing (that is
      // what the work needs), then the gate's requirements — spare pickaxes, then a weapon.
      // The gate's two are reachable even when the project names no tool class at all, which
      // is the case that used to leave `picks` unaimed.
      const held = (s.toolCounts || {}).pickaxe || 0;
      const classBroken = Boolean(c) && (!s.tools[c] || s.tools[c].dur <= 15);
      let target = null, spare = false, skipDepot = false;
      if (classBroken) target = c;
      else if (kitPickShort(s)) { target = 'pickaxe'; spare = held >= 1; }
      else if (weaponMissing(s)) target = 'sword';
      // gear-progression drive: must come before the generic `else if (c) target = c` catch-
      // all below, which sets no `spare` and would just re-report "held" — the exact
      // short-circuit this whole feature exists to skip. skipDepot is load-bearing, found
      // live: s.upgrade's whole premise is "materials to craft it are ALREADY carried" —
      // ensureTool's normal depot-withdrawal step (opts.depot, on by default) sends the bot
      // travelling toward the real base chests FIRST regardless, which can walk it away from
      // whatever crafting table made the upgrade reachable in the first place. Measured: with
      // depot left on, a bot that could afford a stone pickaxe on the spot instead wandered
      // ~150 blocks checking empty depot chests, arrived nowhere near a table, and
      // craftToolChain fell through to bootstrapping a WORSE (wooden) tier from scratch —
      // the opposite of what this feature is for. depot:false keeps the craft where the
      // opportunity was actually detected.
      //
      // Ordering for MULTIPLE pending upgrades (#107 follow-up, argued in FEEDBACK): the
      // active class first — that is the tool the bot's CURRENT work actually depends on —
      // then sword, then axe as secondary weapon-readiness upgrades. Not "all at once": one
      // craft per act() call, same as every other TOOL branch, but this rung re-fires on
      // every tick an upgrade is still pending, so a bot with two pending upgrades addresses
      // both within a few ticks, in this stable order, not "only ever the first one found".
      else if (nextUpgrade(s)) { const u = nextUpgrade(s); target = u.cls; spare = true; skipDepot = true; }
      else if (c) target = c;
      if (!target) return 'none';
      // spare: without it ensureTool answers "you already have one" and the rung can never
      // clear a requirement for a SECOND (or, here, a strictly BETTER one — reusing the same
      // skip-bestOwned escape hatch for an upgrade, not just a backup).
      const opts = { tool: target, spare };
      if (skipDepot) opts.depot = false;
      const r = runSkill('ensureTool', opts, 'TOOL');
      if (r.ok) return 'started';
      if (r._transient) return 'busy';
      // A genuine refusal is the handback point: the ladder cannot advance a tool-gated
      // intent. clear() stays false, so the unproductive detector and stand-down handle the
      // retry cadence rather than a bespoke loop here.
      A.blocked = { why: 'no_tool', cls: target, at: now() };
      note(`tool_unavailable (${target}) — dropping to a rung that needs no tool`);
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

  // #food-acquisition drive (team-lead's priority, measured live from a starving soak-4 bot):
  // "hungry and nothing to eat -> go get food", the human reflex EAT/RESTOCK never covered.
  // EAT (prio 4) needs foodCount>0 to fire at all — it can only EAT held food, never acquire
  // more. RESTOCK (prio 6) already tries a food floor when one applies, but only WITHDRAWS or
  // (for other resources) PRODUCES — its own STEP 3 comment says outright "food: no farm or
  // cook path is wired to this rung yet", so an empty depot leaves it standing down with
  // nothing else to try. Worse for a role:null, project-less bot specifically: activeFloors(s)
  // resolves through effectiveKit (project's kit or ROLE_WORK's) or ROLE_FLOOR[s.role] — with
  // neither a project nor a role, activeFloors returns null and RESTOCK's fire() short-
  // circuits false immediately, so nothing checks food AT ALL. This is the #88 residual
  // team-lead flagged, now measured live on MampfManfred (food 0, health 10, mid-soak).
  //
  // Deliberately NOT gated on activeFloors/effectiveKit — a bot that is actually starving
  // needs food regardless of whether it has a role or project naming a floor. Priority 6.5:
  // after RESTOCK's own (cheaper, depot-first) attempt has had its chance, before LIGHT/
  // PROJECT/ESCAPE — a human eats before continuing whatever they were doing, but doesn't
  // preempt a genuine tool/restock need to do it.
  { id: 'FOOD', prio: 6.5,
    fire: (s) => s.foodCount === 0 && s.food <= 12,
    clear: (s) => s.foodCount > 0,
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      // Widening radius on repeated empty hunts (team-lead's spec), tracked via the harvest
      // block below (huntAnimals outcome -> A._foodHuntFails). After two failed hunts, fall
      // back to harvestGrass -- not real food, but real, honest progress (never a silent
      // stand-still) while whatever fauna exists is scarce; the GENERIC "completed but its
      // own condition still holds" detector (this file's own doctrine, same one RESTOCK/TOOL
      // already rely on) stands FOOD down on its own backoff once THAT stops helping too —
      // no bespoke retry-tracking needed beyond the one counter.
      // force:true — live-caught: huntAnimals' own kit ('hunt': {torches:8, weapon:true},
      // skills.js) refused to even START without 8 torches on hand, which a starving,
      // otherwise-unprovisioned bot (the exact shape this rung exists for) will often not
      // have. huntAnimals itself already degrades gracefully with no weapon at all (bare-hand
      // fallback, safe against passive animals — they never fight back), so skipping the kit
      // gate here is a deliberate, bounded escape hatch for a genuine emergency, the same
      // "escape hatch: args.force=true (logged, so a shortcut is always visible after the
      // fact)" convention skills.js's own kit check already documents — not a new pattern.
      const fails = A._foodHuntFails || 0;
      if (fails < 2) {
        const radius = Math.min(32 + fails * 16, 64);
        const r = runSkill('huntAnimals', { species: ['cow', 'pig', 'sheep', 'chicken', 'rabbit'], count: 1, radius, force: true }, 'FOOD');
        if (r.ok) return 'started';
        return r._transient ? 'busy' : 'refused';
      }
      const r2 = runSkill('harvestGrass', { radius: 24, force: true }, 'FOOD');
      if (r2.ok) return 'started';
      return r2._transient ? 'busy' : 'refused';
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
      // resume with what is LEFT, not the original ask
      const res = resumable(p.skill);
      let args = p.args;
      if (res && p.totalWanted) {
        const left = Math.max(1, p.totalWanted - (p.progress || 0));
        if (left !== p.totalWanted) note(`resuming ${p.skill}: ${p.progress}/${p.totalWanted} done, asking for ${left}`);
        args = res.remaining(p.args, left);
      }
      const r = runSkill(p.skill, args, 'PROJECT');
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

  // #89 ESCAPE (minimal deterministic hook, ahead of Direction Episodes): a project blocked
  // on a path/reachability failure while underground has no way out on its own —
  // mineLane/safeDescend/produce can all dig a bot into a fully-enclosed pocket (#91's
  // forensics: NOT a WALL_OFF seal, NOT mineLane — producer.js's own unbounded nearest-ore
  // chase did it), and until now nothing routed a sealed bot to the one skill that can dig
  // back out (ascendToSurface). Sits BELOW PROJECT (a healthy running project is never
  // interrupted for this) and ABOVE IDLE (so a sealed bot escapes before falling to generic
  // idle busywork forever). Deliberately narrow and temporary: Direction Episodes (the
  // idle-trigger spec, next up) will own this class of decision properly; this only closes
  // the immediate "no skill, no route" gap so a bot is never permanently entombed meanwhile.
  // Does not clear A.project.blocked on success — reaching the surface makes the bot SAFE,
  // which is the whole point; retrying/replacing the blocked project is a separate decision
  // left to a driver or (soon) Direction Episodes, not guessed at here.
  { id: 'ESCAPE', prio: 8.5,
    fire: (s) => Boolean(A.project && PATH_BLOCKED.has(A.project.blocked) && s.surfaceExposed === false),
    clear: (s) => !(A.project && PATH_BLOCKED.has(A.project.blocked)) || s.surfaceExposed !== false,
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      const r = runSkill('ascendToSurface', {}, 'ESCAPE');
      if (r.ok) return 'started';
      if (r._transient) return 'busy';
      return 'refused';
    } },

  { id: 'IDLE', prio: 9, floor: true,
    fire: () => true,                                   // the floor
    clear: () => false,                                 // never clears; only preemption moves us
    act: async (s) => {
      if (oursRunning(s)) return 'running';
      gradeIdleWork(s);                                          // #67b: score the finished run first
      // TODO 5g (#116): the floor still has to be reachable (SPAWN_CAMP_SUPPRESSED never
      // touches IDLE, on purpose — "zero defense must be unrepresentable"), but its NORMAL job
      // (wander off doing role-default work) is exactly what a spawn camp must not do. SHELTER
      // (prio 2.5) outranks IDLE and fires whenever spawnCamped is true, so in practice IDLE
      // only reaches this branch if SHELTER itself genuinely cannot act (no survival.js shelter
      // API, or standing down after a real build failure) — holding position is still the
      // right floor behaviour then, not marching off to chop wood mid-camp.
      if (s.spawnCamped) return 'holding';   // oursRunning(s) already false here (checked above)
      if (s.now - (A._idleAt || 0) < 30000) return 'cooldown';   // don't spam
      A._idleAt = s.now;
      // ROLE-DEFAULT WORK FIRST. The floor of the ladder is "do something useful", not "look
      // busy": a bot with no project should behave like a player with no orders, which means
      // working its trade rather than sweeping empty ground. The work skills collect their own
      // drops as they go, so the sweep is the FALLBACK rather than the default.
      const w = ROLE_WORK[s.role];
      const work = typeof w === 'function' ? w(s) : w;
      // #67b BASE-BARREN: local role-work keeps no-opping — the resource is not here. Walk to
      // fresh terrain before re-running the same empty scan. Backoff-gated so a bot that finds
      // nowhere new does not pace forever; keyed on the WORK SKILL so builder-gathering-wood
      // relocates but builder-lighting-the-base (an inherently local job) does not.
      if (work && (A._barren || 0) >= 1 && RELOCATABLE.has(work.skill) && s.now >= (A._relocateBackoff || 0)) {
        const rr = runSkill('relocateToWork', { skill: work.skill, role: s.role }, 'IDLE/relocate');
        if (rr.ok) { A._lastIdleWork = { id: rr.taskId, skill: 'relocateToWork' }; return 'relocating'; }
        if (rr._transient) return 'busy';
        // relocateToWork unavailable (older engine) — fall through to the normal work/sweep
      }
      if (work) {
        const rw = runSkill(work.skill, work.args, 'IDLE/work');
        if (rw.ok) { A._lastIdleWork = { id: rw.taskId, skill: work.skill }; return 'working'; }
        if (rw._transient) return 'busy';
        // Refused — usually a kit gate. That is not a dead end: RESTOCK and TOOL sit ABOVE
        // this rung and aim at exactly those floors (role floors apply when no project is
        // set), so the next ticks provision the bot and this rung then succeeds. Falling
        // through to the sweep keeps it doing something meanwhile rather than nothing.
        note(`idle work ${work.skill} refused (${rw.error && rw.error.code}) — sweeping instead`);
      }
      const ri = runSkill('collectDrops', { radius: 16, timeoutMs: 15000 }, 'IDLE');
      if (ri.ok) A._lastIdleWork = null;                          // a sweep is not role-work to grade
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
  // never park the floor — there is nothing below it to hand the body to
  if (RUNG_BY_ID[id] && RUNG_BY_ID[id].floor) { note(`${id} made no progress, but it is the floor — not standing it down`); return; }
  const n = A.standDownCount[id] = (A.standDownCount[id] || 0) + 1;
  const ms = STAND_DOWN_MS[Math.min(n - 1, STAND_DOWN_MS.length - 1)];
  A.standDown[id] = now() + ms;
  note(`${id} made no progress — standing down ${Math.round(ms / 1000)}s so lower rungs can run`);
};
// TODO 5g (#116): while genuinely spawn-camped, ordinary "go do project/kit work" dispatch is
// suppressed entirely — automating exactly what a driver had to do BY HAND on run #6 (holding
// every setProject call, letting survival.js's own reactive escalation run uninterrupted until
// stable). Deliberately does NOT touch REFLEX/POSTURE/EAT_CRITICAL/SHELTER/DEPOSIT/EAT/REMEDY:
// combat and shelter handling must keep running (that is the whole point), eating held food and
// dropping excess inventory are not "going out to work", and REMEDY only ever fires from an
// ALREADY-pending failure (TOOL/RESTOCK/PROJECT are suppressed below it, so nothing NEW feeds
// it during a camp) — letting it finish a relocate it already started is harmless and can only
// help. A decider/driver setProject() during suppression is NOT lost: setProject itself has no
// dependency on rung fire() — it still sets A.project and closes the direction episode exactly
// as always (see A.setProject's own header) — the project simply does not get its TURN to
// actually RUN until suppression clears, at which point its own rung's fire() re-evaluates
// true (A.project is already set) and it picks up where a normal dispatch would have. IDLE
// (the floor) gets its own spawnCamped short-circuit inline (its own act(), below) rather than
// being suppressed here — floor must always be reachable, "zero defense must be unrepresentable".
const SPAWN_CAMP_SUPPRESSED = new Set(['TOOL', 'RESTOCK', 'FOOD', 'LIGHT', 'PROJECT', 'ESCAPE']);
const safeFire = (r, s) => {
  try {
    if (s.spawnCamped && SPAWN_CAMP_SUPPRESSED.has(r.id)) return false;
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

  // TODO 5g (#116): spawn-camp span open/close, ledger-visible for soak #5's grade. Reads
  // s.spawnCamped (computed in sense(), so a dry-run fixture can inject it directly) rather
  // than re-deriving it here — one source of truth for the boolean, this block only tracks
  // the TRANSITION and stamps openedAt for the hard-cap release path sense() itself reads.
  // `bot._spawnCamp`, NOT `A.spawnCamp` — see its own init comment (bot.on('death',...) above)
  // for why: A-level state does not survive the re-injection every death itself triggers.
  if (s.spawnCamped && !bot._spawnCamp.active) {
    bot._spawnCamp.active = true; bot._spawnCamp.openedAt = s.now; bot._spawnCamp.deaths = s.recentDeaths;
    spawnCampEmit('open', { deaths: s.recentDeaths, pos: s.pos || null });
    note(`spawn-camp detected (${s.recentDeaths} deaths in ${SPAWN_CAMP_WINDOW_MS / 1000}s) — suppressing project/kit dispatch`);
  } else if (!s.spawnCamped && bot._spawnCamp.active) {
    const reason = (s.now - bot._spawnCamp.openedAt) > SPAWN_CAMP_HARD_CAP_MS ? 'hard_cap'
      : (s.isDay === true ? 'stable_dawn' : 'window_aged_out');
    spawnCampEmit('close', { deaths: bot._spawnCamp.deaths, reason, spanMs: s.now - bot._spawnCamp.openedAt });
    note(`spawn-camp cleared (${reason}) — dispatch resuming`);
    bot._spawnCamp.active = false; bot._spawnCamp.openedAt = 0; bot._spawnCamp.deaths = 0;
  }

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
      // Bank what this run actually achieved, however it ended. A run cut short by a higher
      // rung still mined what it mined.
      const res = resumable(p.skill);
      if (res) {
        const got = res.done(raw && raw.result);
        if (got > 0) {
          p.progress = (p.progress || 0) + got;
          note(`project progress ${p.progress}/${p.totalWanted} (+${got})`);
          markProductive(s, 'project_progress');
        }
      }
      // A PREEMPTION IS NOT A FAILURE. RESTOCK interrupting a lane for a torch refill used
      // to land in the failure branch below — attempts++, stand-down, and after five of them
      // the project was BLOCKED for the crime of being interrupted by its own ladder. A
      // paused-and-resumed lane is progress; only a run that ended on its own without
      // achieving anything is a failed attempt.
      const paused = Boolean(raw && raw.cancelled);
      // Completion still requires VERIFICATION — accumulated progress is the skill's own
      // arithmetic, so finishing on it alone would be the naive-success trap one level up.
      // The final run is graded by assertTask against the count it was actually given.
      const finished = claimed && !refuted && (!res || !p.totalWanted || (p.progress || 0) >= p.totalWanted);
      if (finished) {
        p.completedOnce = true; p.attempts = 0;
        remedyOk(REMEDY_CLASS_OF_SKILL[p.skill]);   // 5c: a real verified completion clears the class's fail count
        note(`project VERIFIED done (${p.skill}${verdict ? ', ' + verdict.rule : ''})`);
        markProductive(s, 'project_done');
        // #68 (g): zero-gap promotion. Runs HERE — inside the harvest block, before choose(s)
        // — not after: a post-choose promotion lets IDLE win this completion tick, start a
        // ~15s collectDrops, and eat the 2-tick preempt debounce before the promoted project
        // ever gets the body. Never promotes over a repeat project (repeat projects intend to
        // keep running; completedOnce sets for them too, but they are not "done" the way a
        // one-shot project is).
        if (A._promoteCheck(p, A.nextProject)) {
          // re-arbitration hygiene, verbatim from the prior art (bots-llm/planner.js's
          // advance()): without clearing A.owner here, the unproductive detector below reads
          // the FRESH promoted project as "completed twice without meeting its own condition"
          // (it is judging the OLD project's stale counters) and stands PROJECT down before
          // the promoted project gets a real turn. The standDown/unproductive counter reset
          // itself now lives in A.setProject (5d, #112) — every caller gets it, not just this
          // one, so it is no longer duplicated here.
          A.owner = null;
          const nx = A.nextProject; A.nextProject = null;
          dirEmit('promote', { from: p.skill, to: nx.skill, queuedForMs: now() - nx.stagedAt });
          A.direction.promoted++;
          A.setProject(Object.assign({}, nx, { by: 'promoted' }));
        }
      } else if (paused) {
        note(`project paused by a higher rung at ${p.progress || 0}/${p.totalWanted || '?'} — resuming, not retrying`);
        A.owner = null;
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
        // 5c: kit_missing/no_tool are TOOL/RESTOCK's own repair job, not a failure of THIS
        // remedy — only a genuine attempt-and-fail (stuck, no_path, not_found, timed out
        // unverified, ...) counts against the class's shared total, surviving the very
        // p.attempts reset that setProject's fresh-project-per-dispatch makes worthless as an
        // escalation signal on its own (see this rung's own header comment).
        if (!repairable) remedyFail(REMEDY_CLASS_OF_SKILL[p.skill], s);
      }
      // #68 (f): repeat-project yield grading — resolves the OhneHoseOtto class (a repeat
      // harvestGrass finding nothing forever still "completes" every pass, so `finished`
      // above is true every time and never signals the zero-yield loop it actually is).
      // Independent of the finished/paused/failed branch above: a repeat project is graded
      // on whether THIS RUN yielded anything, via the same idleWorkOutcome classifier IDLE's
      // own role-work uses, not on whether it claimed completion.
      if (p.repeat) {
        const out = idleWorkOutcome(p.skill, raw && raw.result, s.task.error);
        if (out === 'worked') { p.barrenRuns = 0; markProductive(s, 'repeat_project'); remedyOk(REMEDY_CLASS_OF_SKILL[p.skill]); }
        else if (out === 'barren') { p.barrenRuns = (p.barrenRuns || 0) + 1; remedyFail(REMEDY_CLASS_OF_SKILL[p.skill], s); }
        // 'other' (kit_missing, no_tool, busy) untouched — the maintenance rungs own it,
        // same doctrine as gradeIdleWork's own barren counter.
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
        // 5c: "reached NO chest of N" is the depot_reach remedy failing — a route problem,
        // not a stock problem (restock's own comment above this line makes exactly that
        // distinction). Any real reach, even a still-short one, is the depot walk WORKING.
        if (reached === 0) remedyFail('depot_reach', s); else remedyOk('depot_reach');
        if (short && Object.keys(short).length) { A._restockShort = short; A._restockShortAt = s.now; }
        else if (raw.error) {
          // A restock that ERRORED withdrew nothing, and it carries no result to read. Judging
          // the depot only by result.short missed exactly the case the produce-fallback exists
          // for: on a world with no depot configured, restock throws not_found every time,
          // _restockShort stayed null forever, and the fallback was unreachable — the ladder
          // standing down on a need it was holding the fix for. The ask is the shortfall.
          A._restockShort = Object.assign({}, A._restockNeeds || {}); A._restockShortAt = s.now;
          note(`restock failed (${raw.error.code}) — treating the whole ask as depot-short`);
        } else { A._restockShort = null; A._restockShortAt = 0; markProductive(s, 'restock'); }   // stocked: forget the signal
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
          markProductive(s, 'produce');
        }
        A._producing = null;
      }
      // #68 (d): TOOL repaired. Mirrors the restock/produce checks above — a finished
      // ensureTool with no error means the maintenance chain actually fixed something, which
      // is exactly the kind of progress that should reset the stall clock even though it
      // never touches p.progress (TOOL isn't the project).
      if (raw && raw.name === 'ensureTool') {
        if (!raw.error) { markProductive(s, 'ensure_tool'); remedyOk('wood_gather'); }
        // 5c: ensureTool's own acquisition_failed message embeds its internal step log
        // (skills.js: `could not acquire ${tool}: ${steps.join(' | ')}`) — 'gather:wood(0/N
        // reached)' is the SAME underlying "no wood in range" failure chopTrees hits directly,
        // just reached through the tool-acquisition chain instead. Only a GENUINE zero-reached
        // wood search counts; a short-but-nonzero gather, or a failure with no wood step at
        // all (e.g. an ore tool, or planks/sticks short with wood already in hand), is not
        // this remedy failing.
        else if (/gather:wood\(0\//.test(raw.error.message || '')) remedyFail('wood_gather', s);
      }
      // food-acquisition drive: track hunt outcome for FOOD's own widening-radius/fallback
      // logic (A._foodHuntFails). A real kill is real progress — same doctrine as produce's
      // partial-batch case above, judged by outcome, not by "did the task complete".
      if (raw && raw.name === 'huntAnimals') {
        const killed = (raw.result && raw.result.killed) || 0;
        if (killed > 0) { A._foodHuntFails = 0; markProductive(s, 'hunt'); }
        else A._foodHuntFails = (A._foodHuntFails || 0) + 1;
      }
    } catch (e) {}

    // GENERAL "completed but did not achieve" detector. A rung whose skill finishes cleanly
    // while its own fire() is still true has not moved the world — RESTOCK did exactly this,
    // starting a restock every cycle on a world with no depot and never standing down,
    // because "task completed" is not the same as "need met". Same shape as the project
    // false-success, one layer down: judge by the need, not by the task's own verdict.
    // The FLOOR is exempt. Its fire() is unconditionally true by design, so "completed while
    // its own fire() is still true" is not evidence of anything — the premise the detector
    // rests on cannot fail for it. Worse, standing the floor down means NOTHING runs: there is
    // no rung beneath it. That is how a bot doing its idle work correctly ends up frozen,
    // which is the very symptom this rung was just rewritten to cure. Seen live on MettMarcel
    // two minutes after v15 shipped.
    if (A.owner && !A.owner.safety && !A.owner.floor && safeFire(A.owner, s)) {
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

  directionCheck(s);
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
  // #68 (i): any project change answers an open episode, whatever set it — a direct
  // setProject (by a driver, a human, or this same function's own promotion call below) is
  // exactly the kind of "something filled the project slot" that closes a direction episode.
  if (A.direction.episode) closeEpisode((spec && spec.by) || (spec ? 'manual' : 'cleared'), spec && spec.skill, { now: now() });
  if (!spec) { A.project = null; A.nextProject = null; note('project cleared'); return { ok: true, project: null }; }
  if (typeof spec === 'string') spec = { skill: spec, args: {} };
  if (!spec.skill) return { ok: false, error: 'need {skill, args?, tool?, restockFloor?, repeat?}' };
  if (spec.next && !spec.next.skill) return { ok: false, error: 'next needs {skill, args?, tool?, restockFloor?, repeat?}' };
  const res = resumable(spec.skill);
  A.project = { skill: spec.skill, args: spec.args || {}, tool: spec.tool || null,
    restockFloor: spec.restockFloor || null, repeat: Boolean(spec.repeat),
    completedOnce: false, attempts: 0, blocked: null, setAt: now(),
    // cumulative work across preemptions; totalWanted is the ORIGINAL ask, since args.count
    // gets rewritten to the remainder on each resume
    totalWanted: res ? res.total(spec.args || {}) : null, progress: 0 };
  A.blocked = null;
  // 5d (TODO, #112, test-driver's run-#6 live finding): standDown/unproductive bookkeeping is
  // keyed on the RUNG id ('PROJECT'), not on which project is currently staged under it — a
  // setProject() call used to have no way to signal "this is a fresh attempt, don't count my
  // predecessor's failure against me." A driver (or decider) redirect issued while PROJECT was
  // still cooling down from the OLD project's own failure sat inert for the REST of that old
  // cooldown (a fresh `come` measured live: ~20-30s dead before it ever got to run), and once it
  // finally started, the direction layer's own stall-window clock had already been ticking since
  // before the new project ever executed a tick — earning a false `project_stalled` episode
  // whose reported latency is entirely standdown carryover, not decision time (test-driver's
  // `dmtlb2m212`, 128665ms). setProject IS "fresh intent" by this function's own header comment
  // above — every caller (driver, decider, this file's own promotion call below) means it, so
  // the reset belongs HERE, once, not duplicated at every call site (the promotion branch used
  // to inline exactly this — same three lines — only for ITS OWN call; every other setProject
  // caller had the identical problem and no fix). Never clears A.owner: an external setProject
  // can legitimately arrive while some OTHER rung (RESTOCK, TOOL) currently owns the body, and
  // forcibly nulling A.owner from here would interrupt that unrelated in-flight work — owner
  // re-arbitration happens naturally via choose() on PROJECT's own next fire().
  A.unproductive.PROJECT = 0;
  delete A.standDown.PROJECT;
  A.standDownCount.PROJECT = 0;
  // The direction layer's own E3a stall window (`quiet = now - lastProductiveAt`, gated on
  // `!running`) is exactly as vulnerable to inherited staleness: test-driver's `come` sat
  // inert (nothing running, PROJECT blocked by the OLD project's standdown) while `quiet` kept
  // accumulating from whenever the OLD project last looked productive — so by the time `come`
  // was finally ABLE to run, the window had often already crossed DIRECTION_STALL_MS, opening
  // `project_stalled` for a project that had not had one real tick yet. A fresh directive IS
  // itself evidence something just moved — same doctrine markProductive already applies to
  // every other forward-moving event — so it restarts the clock exactly like those do.
  A.direction.lastProductiveAt = now();
  // 1-deep queue, staged at decision time (the decider/driver always answers current+next —
  // no progress-threshold pre-staging). Team-lead's ruling (2026-09-02) on the open question
  // this used to flag: a plain setProject with no `next` DROPS any stale staged one by
  // default. Rationale: setProject expresses FRESH intent — a next staged for a PREVIOUS
  // decision context silently promoting after the new project completes is a ghost-decision
  // footgun (a driver redirects the bot, the old plan resurrects itself, the bot veers off,
  // and nobody would trace it quickly). `keepNext:true` is the explicit opt-in for the rare
  // case that actually wants the old staged plan to survive an unrelated project change —
  // never the default.
  if (spec.next) A.nextProject = Object.assign({}, spec.next, { stagedAt: now() });
  else if (!spec.keepNext) A.nextProject = null;
  note(`project set: ${spec.skill}`);
  return { ok: true, project: A.project };
};
// #68 (j): the race-safe dispatch entry point, mandatory in ALL modes (driver AND decider). A
// driver that answered an episode first closes it (via setProject above); the decider's later
// dispatch for the SAME episode then sees a stale/mismatched eid and no-ops rather than
// clobbering the driver's answer — no double-dispatch, in either direction, ever.
A.dirDispatch = (eid, spec) => {
  const ep = A.direction.episode;
  if (!ep || ep.id !== eid) return { ok: false, skipped: 'stale' };
  return A.setProject(Object.assign({}, spec, { by: spec.by || 'decider' }));
};
// #95: an episode the decider (or a driver) gives up on WITHOUT dispatching anything used to
// rot open forever -- closeEpisode only ever fired through setProject (a real decision) or
// markProductive's self-recovery, so a give-up with no dispatch left the episode open with
// nothing further watching it: agenda's own single-latch (openEpisode's `if (d.episode)
// return;` above) then silently blocks every subsequent stall detection from ever opening a
// fresh episode, for as long as the underlying condition persists. dirClose is the missing
// third path: same eid-CAS safety as dirDispatch (a stale/answered-elsewhere eid no-ops), but
// it does NOT touch A.project/A.nextProject -- it only closes the episode and starts the SAME
// per-`why` reopen backoff every other close already uses (30s->60s->120s->300s, §2.3 of
// research/IDLE_TRIGGER_SPEC.md). If the stall is still genuinely unresolved, directionCheck's
// own level detector re-opens a FRESH episode once quiet exceeds its window again and the
// backoff has elapsed -- giving the decider/a driver another shot later (conditions may have
// changed) instead of silence for the rest of the run. `closedBy` should name the give-up
// reason (e.g. 'decider_exhausted') so metrics/FEEDBACK can tell an escalation-driven close
// apart from a real decision.
A.dirClose = (eid, closedBy) => {
  const ep = A.direction.episode;
  if (!ep || ep.id !== eid) return { ok: false, skipped: 'stale' };
  closeEpisode(closedBy || 'decider_exhausted', null, { now: now() });
  return { ok: true };
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
  log: A.log.slice(-8),
  direction: { state: A.direction.state, why: A.direction.episode ? A.direction.episode.why : null,
    eid: A.direction.episode ? A.direction.episode.id : null,
    opened: A.direction.opened, closed: A.direction.closed, promoted: A.direction.promoted },
  next: A.nextProject ? A.nextProject.skill : null });
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

// #68: a fresh install (first spawn OR a reconnect re-running this payload) gets a full
// DIRECTION_IDLE_WINDOW_MS grace period before E2/E3 can fire, instead of instantly reading
// "quiet since epoch" as an eternity of unproductive idle.
A.direction.lastProductiveAt = now();

const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.agenda = { version: A.version, boundAt: now(), stale: false };
bot.once('end', () => { try { REG.agenda.stale = true; A.enabled = false; if (A.timer) clearInterval(A.timer); } catch (e) {} });

A.timer = setInterval(tick, TICK_MS);

return { installed: true, version: A.version, rungs: RUNGS.length, tickMs: TICK_MS,
  subsumedIdleguard: subsumed, role: A.role, home: HOME,
  api: ['setProject', 'step', 'sense', 'rung', 'snapshot', 'stop'] };
