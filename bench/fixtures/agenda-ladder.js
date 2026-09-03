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

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.rung}`);
  return out;
} finally {
  A.project = savedProject; A.owner = savedOwner; A.blocked = savedBlocked;
  A.standDown = savedSD; A._restockShort = savedShort; A._restockShortAt = savedAt;
  A.remedy = savedRemedy;
}
