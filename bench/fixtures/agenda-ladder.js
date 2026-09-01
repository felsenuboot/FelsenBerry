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
  T('danger alert -> POSTURE', { dangerState: 'alert' }, 'POSTURE');
  T('food 5 -> EAT_CRITICAL', { food: 5 }, 'EAT_CRITICAL');
  T('freeSlots 1 -> DEPOSIT', { freeSlots: 1 }, 'DEPOSIT');
  T('food 15 -> EAT', { food: 15 }, 'EAT');
  T('pickaxe at 10% durability -> TOOL', { tools: { pickaxe: { name: 'iron_pickaxe', dur: 10 } } }, 'TOOL');
  T('only ONE pickaxe but kit wants 2 -> TOOL (spare)', { toolCounts: { pickaxe: 1, sword: 1 } }, 'TOOL');
  // the kit's WEAPON requirement had no rung aiming at it until v11: a bot could provision
  // its entire kit and then stall forever on "weapon (any sword)"
  T('kit wants a weapon, none held -> TOOL',
    { tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 } }, toolCounts: { pickaxe: 2 } }, 'TOOL');
  T('an AXE satisfies the weapon requirement too',
    { tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 }, axe: { name: 'stone_axe', dur: 80 } },
      toolCounts: { pickaxe: 2, axe: 1 } }, 'PROJECT');
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

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.rung}`);
  return out;
} finally {
  A.project = savedProject; A.owner = savedOwner; A.blocked = savedBlocked;
  A.standDown = savedSD; A._restockShort = savedShort; A._restockShortAt = savedAt;
}
