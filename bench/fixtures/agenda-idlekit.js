// bench/fixtures/agenda-idlekit.js — #84: TOOL/RESTOCK must see the IDLE kit shortfall too,
// not only a project's.
//
// The bug this pins: TOOL and RESTOCK only ever asked projectKit(s) what kit tier is relevant,
// so a bot with NO project (base worked out, #67 — the exact live repro: BuddelBernd/3103 and
// PflasterPeter/3104) had its departure-kit shortfall aimed at by nothing. Meanwhile S.start's
// OWN kit preflight was actively refusing IDLE's role-work with kit_missing every ~30s cycle,
// from the ROLE-WORK SKILL's own kit spec (mineLane/safeDescend's underground/deep, chopTrees'
// excursion) — a source TOOL/RESTOCK never consulted. Two rungs, two different ideas of "what
// kit matters right now", and the one that could fix the shortfall stayed dark.
//
// Fixed by widening TOOL/RESTOCK's source to `effectiveKit = projectKit(s) || roleWorkKit(s)`:
// the active project always wins when set (never softened by what idle role-work would have
// wanted); role-work's own kit is consulted ONLY as the idle fallback. Deliberately NOT a new
// rung and NOT a relaxed floor (argued in FEEDBACK.md #84): the existing TOOL/RESTOCK machinery
// already knows how to complete a kit — that is its whole job for a project — it just could not
// see idle's kit source.
//
// Verified against BOTH sides of the fix before landing (a standalone harness loading agenda.js
// verbatim against agenda v18 vs v19 with stubbed bot/skills): the three "idle, half-kitted"
// cases below fail on v18 and pass on v19; the other six pass on both (no regression). This
// fixture reads TOOL/RESTOCK's real fire()/clear() against the REAL live skills.js registry/
// kitTiers (only S.start is stubbed, same discipline as agenda-deepkit.js) — the actual
// integration point, not a mock of it.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/agenda-idlekit.js '{code:$c}')" | jq .result
const A = globalThis.__agenda, S = globalThis.__skills;
const out = { agenda: A.version, cases: [] };
if (!S || !S.registry || !S.registry.mineLane || !S.registry.chopTrees) {
  out.skipped = 'engine predates mineLane/chopTrees kit specs, or __skills missing';
  return out;
}
const TOOL = A.rung('TOOL'), RESTOCK = A.rung('RESTOCK');
const realStart = S.start;
S.start = () => ({ ok: true, taskId: 'stub' });   // fire()/clear() never call this; belt+suspenders
const saved = { project: A.project };

const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });

const base = {
  now: Date.now(), alive: true, hp: 20, food: 20, foodCount: 8, torches: 24, filler: 24,
  freeSlots: 20, dangerState: 'calm', survivalActive: false, light: 15, surfaceExposed: true,
  dHome: 10, task: null, counts: { stick: 20, crafting_table: 1 },
};

try {
  A.project = null;   // the exact live condition: no project, base worked out (#67)

  // --- miner, no project, at depth (mineLane/safeDescend both resolve 'underground'):
  //     half-kitted (1 pickaxe, no weapon, short on sticks/table) -> TOOL and RESTOCK both fire.
  //     Pre-#84 both were dark here (projectKit returned null with no project).
  {
    const s = Object.assign({}, base, { role: 'miner', pos: { x: 0, y: 55, z: 0 },
      tools: { pickaxe: { name: 'stone_pickaxe', dur: 90 } }, toolCounts: { pickaxe: 1 },
      counts: { stick: 2, crafting_table: 0 } });
    T('miner idle, half-kitted (1 pick, no weapon) -> TOOL fires (was dark pre-#84)', TOOL.fire(s), true);
    T('...RESTOCK fires too (underground floor wants sticks/table)', RESTOCK.fire(s), true);
  }

  // --- miner, no project, at depth, FULLY kitted -> both rungs stay quiet. RESTOCK's clear()
  //     uses its own hysteresis buffer (floor*1.5), so sticks/table must clear 24/1, not 16/1.
  {
    const s = Object.assign({}, base, { role: 'miner', pos: { x: 0, y: 55, z: 0 },
      tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 }, sword: { name: 'iron_sword', dur: 90 } },
      toolCounts: { pickaxe: 2 }, counts: { stick: 24, crafting_table: 1 } });
    T('miner idle, fully kitted -> TOOL does not fire', TOOL.fire(s), false);
    T('...and RESTOCK clears', RESTOCK.clear(s), true);
  }

  // --- builder, no project, torches<4 (ROLE_WORK.builder -> chopTrees/'excursion': weapon
  //     only, no picks) -> TOOL fires on a missing weapon; an axe satisfies it.
  {
    const s = Object.assign({}, base, { role: 'builder', pos: { x: 0, y: 111, z: 0 },
      torches: 2, tools: {}, toolCounts: {} });
    T('builder idle (chopTrees/excursion), no weapon -> TOOL fires (was dark pre-#84)', TOOL.fire(s), true);
  }
  {
    const s = Object.assign({}, base, { role: 'builder', pos: { x: 0, y: 111, z: 0 },
      torches: 2, tools: { axe: { name: 'stone_axe', dur: 90 } }, toolCounts: {} });
    T('...an axe satisfies it (kitCheck accepts sword OR axe)', TOOL.fire(s), false);
  }

  // --- hunter, no project (harvestGrass has no .kit at all) -> effectiveKit is null, no
  //     SPURIOUS firing from the new fallback. ROLE_TOOL.hunter independently wants a sword
  //     (pre-existing, unrelated to this fix) — give it one to isolate the kit-derived path.
  {
    const s = Object.assign({}, base, { role: 'hunter', pos: { x: 0, y: 111, z: 0 },
      tools: { sword: { name: 'iron_sword', dur: 90 } }, toolCounts: {} });
    T('hunter idle, harvestGrass has no kit -> TOOL does not spuriously fire', TOOL.fire(s), false);
    T('...RESTOCK falls back to ROLE_FLOOR, does not demand sticks/table', RESTOCK.fire(s), false);
  }

  // --- a REAL project's kit always wins over idle role-work's, never softened by it: a project
  //     on 'excursion' (weapon only) must NOT let a miner-role bot's picks/sticks/table shortfall
  //     go unasked BY BEING MASKED — but it also must not force role-work's stricter tier onto a
  //     project that doesn't need it. Here it must NOT ask for sticks/table (excursion has none).
  {
    A.project = { skill: 'chopTrees', args: {}, tool: null };
    const s = Object.assign({}, base, { role: 'miner', pos: { x: 0, y: 55, z: 0 },
      tools: { pickaxe: { name: 'stone_pickaxe', dur: 90 } }, toolCounts: { pickaxe: 1 },
      counts: { stick: 2, crafting_table: 0 } });
    T('project=excursion overrides a miner role\'s underground tier -> no sticks/table demand', RESTOCK.fire(s), false);
  }

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
  return out;
} finally {
  S.start = realStart;
  A.project = saved.project;
}
