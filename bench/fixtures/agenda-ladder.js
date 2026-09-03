// bench/fixtures/agenda-ladder.js — the agenda's ladder regression, run through the
// MANDATORY dry-run hook (research/AGENDA-DESIGN.md: "__agenda.step(injectedSnapshot)
// returns the chosen rung WITHOUT executing"). Executes nothing, moves nothing, and is safe
// to run against a live bot: it saves and restores every field it touches.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/agenda-ladder.js '{code:$c}')" | jq .result
//
// Every input a rung's fire()/clear() reads MUST come through sense(), or these cases cannot
// mean anything. That is not hypothetical: TOOL's predicates once counted pickaxes straight
// out of bot.inventory, so eight of these cases returned TOOL no matter what world they were
// handed — the dry run was reading the live bot. If you add a rung, add its inputs to
// sense() and a case here.
const A = globalThis.__agenda;
const savedProject = A.project, savedOwner = A.owner, savedBlocked = A.blocked;
const savedSD = A.standDown, savedShort = A._restockShort, savedAt = A._restockShortAt;
const savedRemedy = A.remedy;
const savedSDCount = A.standDownCount, savedUnproductive = A.unproductive;
const savedLastProductiveAt = A.direction.lastProductiveAt;
const savedReflexClearSince = A.reflexClearSince;   // TODO 5q — real A state, not part of `over`
const savedSpawnCamp = bot._spawnCamp;   // TODO 5g: lives on `bot`, not `A` — see agenda.js's own comment
const out = { version: A.version, cases: [] };

// a "healthy at work" baseline; each case overrides only what it is testing
const base = {
  alive: true, hp: 20, food: 20, foodCount: 8, torches: 20, filler: 20, freeSlots: 20,
  dangerState: 'calm', survivalActive: false, light: 15, surfaceExposed: true, dHome: 30,
  // a weapon is part of every excursion tier, so a "healthy at work" bot carries one —
  // without it TOOL correctly fires and every case below would measure that instead
  tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 }, sword: { name: 'iron_sword', dur: 90 } },
  toolCounts: { pickaxe: 2, sword: 1 },
  task: null, role: 'miner',
  pos: { x: 0, y: 60, z: 0 },
  // #84: with no project, RESTOCK's floor now also considers idle role-work's own kit
  // (roleWorkKit fallback in effectiveKit) — a miner's idle work at this y resolves to
  // safeDescend/'underground', which wants sticks+a table same as any project would. A
  // "healthy at work" baseline needs to carry them too, or every no-project case below
  // measures the #84 fix firing correctly rather than the rung it's meant to test.
  counts: { stick: 20, crafting_table: 1 },
};
const T = (label, over, expect) => {
  let got = null, err = null;
  try { got = A.step(Object.assign({}, base, over)); } catch (e) { err = String(e.message || e); }
  out.cases.push({ label, expect, rung: got && got.rung, demanded: got && got.demanded,
    latched: got && got.latched, fired: got && got.fired, err,
    PASS: !err && got && got.rung === expect });
};
// direct-field assertion (5d: internal bookkeeping a rung outcome alone can't observe —
// standDown/unproductive being CLEARED, not just "PROJECT happens to fire this tick").
const TF = (label, cond) => { out.cases.push({ label, PASS: Boolean(cond) }); };

A.owner = null; A.blocked = null; A.standDown = {};
A._restockShort = null; A._restockShortAt = 0;
A.project = { skill: 'mineLane', args: {}, restockFloor: { torches: 16, food: 4, filler: 16 } };

try {
  T('healthy, project set -> PROJECT', {}, 'PROJECT');
  T('reflex active -> REFLEX', { survivalActive: true }, 'REFLEX');
  // #97: panicStale is the ONLY thing that can make REFLEX stand down while raw dangerState
  // still literally says 'panic' -- the stateful tracking that COMPUTES panicStale lives in
  // sense()'s live path (never run in dry-run injection, see sense()'s own early return), so
  // this proves the RUNG WIRING consumes it correctly; bench/fixtures/reflex-panic-stale.sh
  // proves the tracking itself against a real bot over real time.
  T('panic but survival active -> REFLEX still fires regardless of panicStale', { dangerState: 'panic', survivalActive: true, panicStale: true }, 'REFLEX');
  T('panic, survival inactive, NOT yet stale -> REFLEX (unchanged safety behavior)', { dangerState: 'panic', survivalActive: false, panicStale: false }, 'REFLEX');
  T('panic, survival inactive, CONFIRMED stale -> REFLEX stands down, ladder proceeds', { dangerState: 'panic', survivalActive: false, panicStale: true }, 'PROJECT');
  T('danger alert -> POSTURE', { dangerState: 'alert' }, 'POSTURE');
  T('food 5 -> EAT_CRITICAL', { food: 5 }, 'EAT_CRITICAL');
  // #105 SHELTER rung: wiring only, same split as panicStale/s.upgrade above — sense()'s own
  // computation of shelterShould/shelterActive from __survival.shelter is a live-bot concern
  // (see the live dusk fixture), this proves fire()/clear()/priority ordering react correctly
  // to the snapshot fields.
  T('shelterShould true -> SHELTER', { shelterShould: true }, 'SHELTER');
  T('a real emergency still outranks shelter -> EAT_CRITICAL wins', { shelterShould: true, food: 5 }, 'EAT_CRITICAL');
  T('shelter outranks ordinary travel-requiring rungs (freeSlots low too)', { shelterShould: true, freeSlots: 1 }, 'SHELTER');
  // LATCHING must run on clear() (shelterActive), never on fire() staying true — should()'s
  // own g.shelter.active check makes shelterShould read false the instant enter() starts, by
  // design. If SHELTER's clear() were wrongly keyed off shelterShould, this case would fail
  // exactly the way choose()'s own doc warns against.
  A.owner = A.rung('SHELTER');
  T('owner SHELTER, shelterShould now false but shelterActive still true -> stays latched', { shelterShould: false, shelterActive: true }, 'SHELTER');
  T('owner SHELTER, shelterActive cleared -> released', { shelterShould: false, shelterActive: false }, 'PROJECT');
  A.owner = null;
  T('freeSlots 1 -> DEPOSIT', { freeSlots: 1 }, 'DEPOSIT');
  T('food 15 -> EAT', { food: 15 }, 'EAT');

  // ---- TODO 5q (#125): EAT_REFLEX_DWELL_MS — EAT/REFLEX ownership thrash ----
  // A.reflexClearSince is real A state (tick()-side, not part of `over`/`base`) — set it
  // directly as a precondition, same doctrine as A.owner/A.calmSince elsewhere in this file.
  // `now` is injected explicitly so the dwell math is deterministic rather than racing the
  // wall clock.
  A.reflexClearSince = 0;
  T('reflexClearSince 0 (never in REFLEX) -> EAT completely unaffected, same as the baseline above',
    { food: 15 }, 'EAT');
  A.reflexClearSince = 1000000;
  T('500ms after REFLEX cleared (well inside the 4000ms dwell) -> EAT gated, falls through to PROJECT',
    { food: 15, now: 1000500 }, 'PROJECT');
  T('exactly at the dwell boundary (now - reflexClearSince === EAT_REFLEX_DWELL_MS) -> fires (>=, inclusive)',
    { food: 15, now: 1004000 }, 'EAT');
  T('one ms short of the boundary -> still gated', { food: 15, now: 1003999 }, 'PROJECT');
  T('well past the dwell (10s later) -> EAT fires normally again', { food: 15, now: 1010000 }, 'EAT');
  // the gate is scoped to EAT (prio 4) only — EAT_CRITICAL (prio 2, the true emergency) must
  // never be delayed by it, per #117's "no engine-internal escape" doctrine for a starving bot.
  T('same dwell window, but food 5 (EAT_CRITICAL territory) -> fires immediately, gate does not apply',
    { food: 5, now: 1000500 }, 'EAT_CRITICAL');
  // owner-latch interaction: EAT already holding ownership from BEFORE reflexClearSince was
  // stamped must not be yanked away mid-latch by a gate that only governs fire(), not clear() —
  // choose()'s latch only re-checks safeClear(owner,s), never re-runs owner's own fire().
  A.owner = A.rung('EAT');
  T('owner already EAT when the dwell becomes active -> stays latched (fire() gate never re-checked on an existing owner)',
    { food: 15, foodCount: 3, now: 1000500 }, 'EAT');
  A.reflexClearSince = savedReflexClearSince;
  A.owner = null;
  T('pickaxe at 10% durability -> TOOL', { tools: { pickaxe: { name: 'iron_pickaxe', dur: 10 } } }, 'TOOL');
  T('only ONE pickaxe but kit wants 2 -> TOOL (spare)', { toolCounts: { pickaxe: 1, sword: 1 } }, 'TOOL');
  // ...and the same must hold when NOTHING resolves the project to a tool class. This case is
  // the one engine-dev-3's sustained-loop verify caught and this fixture missed: the base
  // snapshot's role is `miner`, which maps to pickaxe, so activeClass was never null here and
  // the case above passed for the wrong reason. A `builder` role maps to no tool at all, and
  // TOOL used to reach the pick requirement only through activeClass — so fire() went false,
  // clear() went TRUE, and the gate's `picks: 2` was aimed at by nothing.
  T('1 pickaxe, kit wants 2, and NO tool class resolves -> TOOL still fires',
    { role: 'builder', toolCounts: { pickaxe: 1, sword: 1 } }, 'TOOL');
  // the kit's WEAPON requirement had no rung aiming at it until v11: a bot could provision
  // its entire kit and then stall forever on "weapon (any sword)"
  T('kit wants a weapon, none held -> TOOL',
    { tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 } }, toolCounts: { pickaxe: 2 } }, 'TOOL');
  T('an AXE satisfies the weapon requirement too',
    { tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 }, axe: { name: 'stone_axe', dur: 80 } },
      toolCounts: { pickaxe: 2, axe: 1 } }, 'PROJECT');
  // gear-progression drive: rung WIRING only — sense()'s own computation of s.upgrades (from
  // real carried items via S.tierFor) is a live-bot concern, not something dry-run injection
  // exercises (same split as panicStale above: this proves fire()/act() react correctly to
  // the field, a live fixture proves sense() sets it correctly from a real inventory).
  T('s.upgrades has a pickaxe entry -> TOOL even with a healthy tool otherwise',
    { upgrades: { pickaxe: { cls: 'pickaxe', to: 'stone_pickaxe' } } }, 'TOOL');
  T('a mere upgrade never outranks a genuine need — hungry still wins',
    { food: 5, upgrades: { pickaxe: { cls: 'pickaxe', to: 'stone_pickaxe' } } }, 'EAT_CRITICAL');
  // #107 follow-up: sword/axe joined pickaxe. A pending upgrade in EITHER class alone must
  // fire TOOL too, not just the active (project/role) class.
  T('s.upgrades has ONLY a sword entry (no active-class upgrade pending) -> TOOL still fires',
    { upgrades: { sword: { cls: 'sword', to: 'stone_sword' } } }, 'TOOL');
  T('s.upgrades has ONLY an axe entry -> TOOL still fires',
    { upgrades: { axe: { cls: 'axe', to: 'stone_axe' } } }, 'TOOL');
  // food-acquisition drive: fires with NO project and NO role (activeFloors would be null,
  // so RESTOCK's own food floor check never triggers for this bot at all — the #88 residual
  // team-lead measured live) — proves FOOD is independent of role/project floors on purpose.
  // A.project (module state, not a snapshot field) has to be cleared for real here, same as
  // the existing "no project -> IDLE" case below — a bare `role:null` in the injected
  // snapshot does not touch it.
  A.project = null;
  T('starving (foodCount 0, food 12), no project, no role -> FOOD', { foodCount: 0, food: 12, role: null }, 'FOOD');
  T('foodCount 0 but food NOT yet low (food 15), no project -> nothing fires, floor is IDLE', { foodCount: 0, food: 15, role: null }, 'IDLE');

  // TODO 5p: the heal-deadlock band. Vanilla natural regen needs food>=18 -- a hurt bot
  // (hp<=10) with foodCount==0 sitting at food 13-17 is too full for the food<=12 branch above
  // and too empty to ever regen; nothing else in the ladder can reach it (EAT/EAT_CRITICAL both
  // need foodCount>0). Live-measured, run #7 12:28Z: hp 6.8, food 15, foodCount 0, walled in.
  T('hp low + heal-deadlock band (food 15) + foodCount 0, calm -> FOOD (the actual soak #7 shape)',
    { foodCount: 0, food: 15, hp: 6.8, role: null }, 'FOOD');
  T('band upper edge (food 17, just below the food<=17 EAT trigger point) + hp low -> FOOD',
    { foodCount: 0, food: 17, hp: 8, role: null }, 'FOOD');
  T('food 18 (the regen threshold itself) + hp low -> does NOT fire this branch -- already able to regen, floor is IDLE',
    { foodCount: 0, food: 18, hp: 6, role: null }, 'IDLE');
  T('hp exactly at the 10 boundary -> still fires', { foodCount: 0, food: 15, hp: 10, role: null }, 'FOOD');
  T('hp 11 (one above the boundary) -> does not fire this branch, floor is IDLE',
    { foodCount: 0, food: 15, hp: 11, role: null }, 'IDLE');
  T('foodCount>0 in the band -> EAT owns it (something IS held, precedence unchanged)',
    { foodCount: 1, food: 15, hp: 6, role: null }, 'EAT');
  // guard: must not pull a bot out of a defensive posture while a threat is live -- checked
  // directly in fire(), not left to the owner-latch alone (defense in depth, same doctrine as
  // #117's own comment on this file).
  T('same band, but dangerState alert (a fight is on) -> FOOD does not even ask; POSTURE owns it',
    { foodCount: 0, food: 15, hp: 6, role: null, dangerState: 'alert' }, 'POSTURE');
  T('same band, calm dangerState but a hostile is still nearby (hostileNear) -> FOOD stays quiet, floor is IDLE',
    { foodCount: 0, food: 15, hp: 6, role: null, hostileNear: true, threat: { d: 10 } }, 'IDLE');
  T('threat clears (calm, no hostileNear) -> FOOD picks it back up',
    { foodCount: 0, food: 15, hp: 6, role: null, dangerState: 'calm', hostileNear: false }, 'FOOD');

  A.project = { skill: 'mineLane', args: {}, restockFloor: { torches: 16, food: 4, filler: 16 } };
  T('food low but SOME food still held -> EAT owns it, not FOOD', { foodCount: 2, food: 10 }, 'EAT');
  T('RESTOCK still outranks a mere starving-with-no-floor state when torches are ALSO short', { foodCount: 0, food: 12, torches: 4 }, 'RESTOCK');
  T('torches 4 (below floor 16) -> RESTOCK', { torches: 4 }, 'RESTOCK');
  T('dark + carrying torches -> LIGHT', { surfaceExposed: false, light: 3 }, 'LIGHT');
  A.project = null;
  T('no project -> IDLE', {}, 'IDLE');
  A.project = { skill: 'mineLane', args: {}, restockFloor: { torches: 16, food: 4, filler: 16 } };

  // precedence: a lower need must not win over a higher one
  A.project = { skill: 'mineLane', args: {}, restockFloor: { torches: 16, food: 4, filler: 16 } };
  T('hungry AND tool worn -> EAT_CRITICAL wins', { food: 5, tools: { pickaxe: { name: 'iron_pickaxe', dur: 10 } } }, 'EAT_CRITICAL');
  T('kit tier follows the SNAPSHOT y, not the live bot', { pos: { x: 0, y: -20, z: 0 }, toolCounts: { pickaxe: 2 } }, 'PROJECT');
  T('reflex beats everything', { survivalActive: true, food: 2, freeSlots: 0, tools: {}, toolCounts: {} }, 'REFLEX');
  T('restock short AND dark -> RESTOCK (prio 6 < LIGHT 7)', { torches: 4, surfaceExposed: false, light: 3 }, 'RESTOCK');

  // hysteresis: RESTOCK must NOT clear at the bare floor, only at floor*1.5
  A.owner = A.rung('RESTOCK');
  T('owner RESTOCK, torches exactly at floor 16 -> still latched', { torches: 16, foodCount: 6, filler: 24 }, 'RESTOCK');
  T('owner RESTOCK, ALL floors at 1.5x -> released', { torches: 24, foodCount: 6, filler: 24 }, 'PROJECT');
  A.owner = null;

  // stand-down must let lower rungs through
  A.standDown = { RESTOCK: Date.now() + 60000 };
  T('RESTOCK standing down -> PROJECT gets the body', { torches: 4 }, 'PROJECT');
  A.standDown = {};

  // no_tool must not permanently block: PROJECT yields, IDLE floor still runs
  A.blocked = { why: 'no_tool', cls: 'pickaxe', at: Date.now() };
  T('blocked no_tool -> PROJECT does not fire', {}, 'IDLE');
  A.blocked = null;

  // 5c: same-remedy-repeats-across-positions escalation (TODO 5c, soak #4). REMEDY (prio
  // 4.8) reads A.remedy directly, not the injected snapshot -- same split as SHELTER's
  // latching cases above (a rung whose trigger is module state, not a sense() field).
  A.remedy = {};
  T('no remedy failures on record -> PROJECT, untouched', {}, 'PROJECT');
  A.remedy = { wood_gather: { n: 1, firstAt: Date.now(), escalatedAt: 0 } };
  T('a SINGLE wood_gather failure -> below threshold, PROJECT still runs', {}, 'PROJECT');
  A.remedy = { wood_gather: { n: 2, firstAt: Date.now(), escalatedAt: 0 } };
  T('2nd same-class failure -> REMEDY preempts TOOL/RESTOCK/PROJECT (tier 1: bigger relocate)', { torches: 4 }, 'REMEDY');
  T('a starving bot still outranks REMEDY -> EAT_CRITICAL wins', { food: 5 }, 'EAT_CRITICAL');
  T('SHELTER still outranks REMEDY -> SHELTER wins', { shelterShould: true }, 'SHELTER');
  // escalatedAt guard: once THIS failure count has been escalated (act() stamps escalatedAt
  // = n before dispatching, see the rung's own comment), REMEDY must not re-fire for the
  // SAME n every tick -- it hands the body back to the rung that was actually stuck so that
  // rung gets its retry from the new position. Only a FRESH failure (n increases again)
  // re-arms it.
  A.remedy = { wood_gather: { n: 2, firstAt: Date.now(), escalatedAt: 2 } };
  T('same failure count already escalated -> does not re-fire, PROJECT resumes', {}, 'PROJECT');
  A.remedy = { wood_gather: { n: 3, firstAt: Date.now(), escalatedAt: 2 } };
  T('a FRESH failure (n advanced past the already-escalated count) -> REMEDY fires again', {}, 'REMEDY');
  // depot_reach: RESTOCK's own remedy class, unified with TOOL/PROJECT's wood_gather under
  // the SAME rung/threshold -- proves the escalation mechanism is remedy-class-generic, not
  // wood-specific plumbing with depot_reach bolted on separately.
  A.remedy = { depot_reach: { n: 2, firstAt: Date.now(), escalatedAt: 0 } };
  T('2nd depot_reach failure -> REMEDY fires for a non-wood class too', {}, 'REMEDY');
  A.remedy = {};

  // 5d (#112, test-driver's run-#6 live finding): a setProject() redirect issued while
  // PROJECT is still cooling down from the PREVIOUS project's own failure used to sit inert
  // for the rest of that inherited cooldown, then earn a false project_stalled episode from a
  // stall-window clock that had already been ticking before the new project ever ran.
  A.owner = null;
  A.standDown = { PROJECT: Date.now() + 60000 };
  A.standDownCount = { PROJECT: 2 };
  A.unproductive = { PROJECT: 1 };
  A.direction.lastProductiveAt = Date.now() - 200000;   // older than DIRECTION_STALL_MS (180000)
  T('PROJECT standing down from a PREVIOUS project -> blocked, IDLE runs', {}, 'IDLE');
  A.setProject({ skill: 'come', args: { x: 0, y: 60, z: 0 } });
  TF('setProject clears the inherited PROJECT standDown timer', !A.standDown.PROJECT);
  TF('setProject resets standDownCount.PROJECT to 0', (A.standDownCount.PROJECT || 0) === 0);
  TF('setProject resets unproductive.PROJECT to 0', (A.unproductive.PROJECT || 0) === 0);
  TF('setProject restarts the direction stall clock (lastProductiveAt no longer stale)',
    Date.now() - A.direction.lastProductiveAt < 5000);
  T('the SAME redirect now fires PROJECT immediately, not still blocked', {}, 'PROJECT');
  A.standDown = {}; A.standDownCount = {}; A.unproductive = {};
  A.project = { skill: 'mineLane', args: {}, restockFloor: { torches: 16, food: 4, filler: 16 } };

  // 5g (#116): respawn/spawn-camp shapes (test-driver's run-#6 incident, FEEDBACK ~09:40Z —
  // 3 deaths in 63s, each respawn drawing hostile fire again within seconds). Two mechanisms:
  // (A) SHELTER's fire() gets two EARLY triggers ORed onto survival.js's own shelterShould, so
  //     it starts sooner in the pre-panic window (Death #2's shape: the dig-in fired but lost
  //     the race). (B) once genuinely spawn-camped, ordinary project/kit dispatch is
  //     suppressed entirely (Death #3/#4's shape — automates what a driver did by hand).
  bot._spawnCamp = { active: false, openedAt: 0, deaths: 0 };

  // (A) SHELTER's widened fire() — every input comes through the injected snapshot, same rule
  // as every other rung here.
  T('just respawned, surface exposed, night -> SHELTER (even with shelterShould false)',
    { justRespawned: true, surfaceExposed: true, isDay: false, shelterShould: false }, 'SHELTER');
  T('just respawned, surface exposed, DAY but a hostile is near -> SHELTER',
    { justRespawned: true, surfaceExposed: true, isDay: true, hostileNear: true, shelterShould: false }, 'SHELTER');
  T('just respawned, surface exposed, day, NO hostile near -> does not force shelter, PROJECT runs',
    { justRespawned: true, surfaceExposed: true, isDay: true, hostileNear: false, shelterShould: false }, 'PROJECT');
  T('just respawned but NOT surface-exposed (e.g. underground) -> does not force shelter',
    { justRespawned: true, surfaceExposed: false, isDay: false, hostileNear: true, shelterShould: false }, 'PROJECT');
  T('spawnCamped alone forces SHELTER regardless of night/hostile/gear', { spawnCamped: true, isDay: true, hostileNear: false }, 'SHELTER');

  // (B) suppression — SHELTER itself standing down (a real build failure) so the ladder's
  // reaction to a spawn-camped bot is actually observable, not just masked by SHELTER always
  // outranking everything below it anyway.
  A.standDown = { SHELTER: Date.now() + 60000 };
  T('spawnCamped + SHELTER down + torches low -> RESTOCK suppressed, floor IDLE (not RESTOCK)',
    { spawnCamped: true, torches: 4 }, 'IDLE');
  T('spawnCamped + SHELTER down + broken tool -> TOOL suppressed too, floor IDLE',
    { spawnCamped: true, tools: { pickaxe: { name: 'iron_pickaxe', dur: 10 } } }, 'IDLE');
  T('NOT spawnCamped, SHELTER down, torches low -> RESTOCK fires normally (suppression does not leak)',
    { spawnCamped: false, torches: 4 }, 'RESTOCK');
  A.standDown = {};

  // (C) the release math itself — A._spawnCampCheck is pure, driven by SYNTHETIC timestamps
  // (no real wall-clock wait for a 90s window or a 10-minute hard cap).
  const TC = (label, deathTimes, nowMs, openedAt, isDay, expectCamped) => {
    let got = null, err = null;
    try { got = A._spawnCampCheck(deathTimes, nowMs, openedAt, isDay); } catch (e) { err = String(e.message || e); }
    out.cases.push({ label, expect: expectCamped, got: got && got.spawnCamped, err, PASS: !err && got && got.spawnCamped === expectCamped });
  };
  const T0 = 1000000000;   // an arbitrary synthetic "now" anchor
  TC('3 deaths within the 90s window, no dawn signal -> camped',
    [T0 - 80000, T0 - 40000, T0 - 5000], T0, T0 - 5000, false, true);
  TC('only 2 deaths within the window -> below threshold, not camped',
    [T0 - 40000, T0 - 5000], T0, T0 - 5000, false, false);
  TC('3 deaths total, but the oldest has aged OUT of the 90s window -> not camped (window release)',
    [T0 - 95000, T0 - 40000, T0 - 5000], T0, T0 - 5000, false, false);
  TC('3 deaths in window, but DAY and stable (last death > 60s ago) -> not camped (dawn release)',
    [T0 - 85000, T0 - 80000, T0 - 65000], T0, T0 - 85000, true, false);
  TC('3 deaths in window, dawn but NOT yet stable (last death < 60s ago) -> still camped',
    [T0 - 85000, T0 - 40000, T0 - 5000], T0, T0 - 85000, true, true);
  TC('3 deaths in window, the OPEN span itself exceeds the 10-minute hard cap -> not camped (hard-cap release)',
    [T0 - 80000, T0 - 40000, T0 - 5000], T0, T0 - 700000, false, false);
  TC('3 deaths in window, span still well under the hard cap -> camped (sanity baseline)',
    [T0 - 80000, T0 - 40000, T0 - 5000], T0, T0 - 60000, false, true);
  bot._spawnCamp = { active: false, openedAt: 0, deaths: 0 };

  // 5h (#117): EAT/EAT_CRITICAL owner-latch dead-end release (engine-dev's live find, FEEDBACK
  // ef0fe53) — foodCount hitting 0 without reaching food>=19 is a genuine dead end (nothing
  // left to eat), not ordinary fire()/clear() hysteresis-in-progress, so it must release
  // rather than sit latched with the body inert. RESTOCK's own food floor (`activeFloors(s)`,
  // the project's `restockFloor.food:4`) ALSO reacts to foodCount:0 the moment EAT releases
  // (`s.foodCount < f.food`) and RESTOCK (prio 6) sits ahead of FOOD (6.5) in the scan order —
  // correct, intentional behaviour (RESTOCK's own cheaper depot-first attempt gets first
  // shot), but it would swallow these cases' own signal (did EAT actually RELEASE, distinct
  // from what happens to pick it up next). food:0 on THIS project's restockFloor isolates
  // that — these cases test the release, not RESTOCK/FOOD's own downstream precedence
  // (already covered by the existing RESTOCK/FOOD cases earlier in this file).
  const savedFloor = A.project.restockFloor;
  A.project.restockFloor = { torches: 16, food: 0, filler: 16 };
  A.owner = A.rung('EAT');
  T('owner EAT, foodCount hits 0 (food still low but not FOOD-rung-triggering) -> releases to PROJECT, not stuck',
    { food: 15, foodCount: 0 }, 'PROJECT');
  // TODO 5p: the SAME food:15/foodCount:0 release, but the bot is also hurt -- the heal-
  // deadlock band picks it up now where the case just above (healthy hp) correctly still does
  // not, proving the new branch is additive, not a relaxation of the old one.
  A.owner = A.rung('EAT');
  T('owner EAT, foodCount hits 0, food 15 (not the old <=12 branch) AND hp low -> releases into FOOD via the NEW heal-deadlock branch',
    { food: 15, foodCount: 0, hp: 6 }, 'FOOD');
  A.owner = A.rung('EAT');
  T('owner EAT, foodCount 0 AND food low enough to also trigger FOOD -> releases straight into FOOD picking it up',
    { food: 10, foodCount: 0 }, 'FOOD');
  A.owner = A.rung('EAT');
  T('owner EAT, still holds food, has not reached 19 yet -> stays latched (ordinary hysteresis unaffected by this fix)',
    { food: 12, foodCount: 3 }, 'EAT');
  A.owner = A.rung('EAT_CRITICAL');
  T('owner EAT_CRITICAL, foodCount hits 0 -> releases too (the higher-stakes case: only REFLEX/POSTURE could otherwise ever preempt a latched prio-2 owner) -> FOOD picks it up',
    { food: 4, foodCount: 0 }, 'FOOD');
  A.project.restockFloor = savedFloor;
  A.owner = null;

  // Cook/smelt soak-hour task (producer.js's new cookMeat/'cooked_meat', NOT wired into FOOD —
  // see FEEDBACK.md's argument). This case is the EVIDENCE for that call, not a test of a fix:
  // a post-hunt bot holding raw (uncooked) meat has foodCount>0 the instant the item lands in
  // inventory (FOODS counts raw beef/porkchop/mutton/rabbit), and EAT (prio 4) outranks FOOD
  // (prio 6.5) — choose() hands the body to EAT on the VERY NEXT tick no matter what FOOD's own
  // act() might still want to do next (like start cooking). Proves the priority-inversion a
  // "cook before eating" wire-up would need solving first, rather than just asserting it.
  A.owner = A.rung('FOOD');
  T('post-hunt: raw meat now held (foodCount>0) -> EAT already outranks FOOD, no room left to cook first',
    { food: 12, foodCount: 1 }, 'EAT');
  A.owner = null;

  // 7a (#74): relocateToWork's success check is now verifier-backed against the requested hop
  // (skills.js, S._relocateVerified — the threshold math itself is tested there, in
  // bench/fixtures/relocate-verify.js). This side of it is agenda.js's own: IDLE's barren-
  // relocate tracking (A._idleWorkOutcome) must read whatever relocateToWork HONESTLY reports
  // — a short-of-threshold "no_progress" counts as barren (keeps the relocate-backoff/wander-
  // cap machinery engaged), a genuine past-threshold "relocated:true" counts as worked. A
  // lying primitive corrupts this classifier from the consumer side exactly as much as it
  // corrupts REMEDY's telemetry — this is the other half of that same finding.
  TF('IDLE barren classifier: relocateToWork honestly reports no_progress (short of the new threshold) -> classified barren',
    A._idleWorkOutcome('relocateToWork', { relocated: false, reason: 'no_progress', dist: 10, hop: 64 }, null) === 'barren');
  TF('IDLE barren classifier: relocateToWork honestly reports relocated:true (past the new threshold) -> classified worked',
    A._idleWorkOutcome('relocateToWork', { relocated: true, dist: 40, hop: 64 }, null) === 'worked');

  // ---- TODO 5l(b) (#120): chopTrees drops its food demand on a short, sated trip ----
  // A._projectKit(s) resolves the project's own kit function (chopTrees' `kit:` in skills.js)
  // through resolveKit's position+vitals shim — this exercises that resolution path directly
  // (not the full A.step ladder), same "test the primitive, not just the rung that consumes
  // it" split as 7a's relocate-verify case just above. `s.injected`+`s.pos` must both be set
  // for the shim (not the real bot) to be used, matching resolveKit's own contract check.
  const KIT = (label, args, vitals, wantFoodItems) => {
    A.project = { skill: 'chopTrees', args };
    let k = null, err = null;
    try {
      k = A.projectKit(Object.assign({ injected: true, pos: { x: 0, y: 60, z: 0 } }, vitals));
    } catch (e) { err = String(e.message || e); }
    const got = k ? (k.foodItems || 0) : null;
    out.cases.push({ label, expect: wantFoodItems, got, err, PASS: !err && got === wantFoodItems });
  };
  KIT('sated (food 20) + close (maxDist 32) -> excursion_short, food demand dropped',
    { maxDist: 32 }, { food: 20, hp: 20 }, 0);
  KIT('exactly at both thresholds (food 14, maxDist 48) -> still dropped',
    { maxDist: 48 }, { food: 14, hp: 20 }, 0);
  KIT('one hunger point under the threshold (food 13) though close -> demand stands',
    { maxDist: 32 }, { food: 13, hp: 20 }, 2);
  KIT('sated but one block past the distance cap (maxDist 49) -> demand stands',
    { maxDist: 49 }, { food: 20, hp: 20 }, 2);
  KIT('sated + no explicit maxDist (defaults to chopTrees\' own 64, over the cap) -> demand stands',
    {}, { food: 20, hp: 20 }, 2);
  A.project = savedProject;

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.rung}`);
  return out;
} finally {
  A.project = savedProject; A.owner = savedOwner; A.blocked = savedBlocked;
  A.standDown = savedSD; A._restockShort = savedShort; A._restockShortAt = savedAt;
  A.remedy = savedRemedy;
  A.standDownCount = savedSDCount; A.unproductive = savedUnproductive;
  A.direction.lastProductiveAt = savedLastProductiveAt;
  A.reflexClearSince = savedReflexClearSince;
  bot._spawnCamp = savedSpawnCamp;
}
