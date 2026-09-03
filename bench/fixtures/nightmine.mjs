// bench/fixtures/nightmine.mjs — nightmine.js (TODO 5m's pure decision half: should
// shelterEnter() attempt a night-mining batch, and with what mineLane args). PURE NODE,
// hermetic: synthetic state in, decision out. No ledger, no live bot — same doctrine as
// stall-attribution.mjs / ledger-gaps.mjs. The other half (actually dispatching mineLane,
// polling exit conditions concurrently, stopping a live batch) can only be proven against a
// real bot — see the design report in FEEDBACK.md for the planned live/RCON-night fixture.
//
// Run:  node bench/fixtures/nightmine.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// nightmine.js is plain CommonJS at the repo root (same idiom as foods.js — a real require(),
// loaded defensively by whichever live payload consumes it; this fixture just needs the module,
// not the payload-injection mechanism).
const { shouldNightMine, nightMineTargets, nightMineArgs } = require('../../nightmine.js');

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const SEALED = { builtKind: 'digin', builtSealed: true, hasPickaxe: true, currentY: 62, freeSlots: 10, batchesUsed: 0 };

// ---- 1. shouldNightMine: the happy path ----
T('sealed digin, pickaxe held, nothing exhausted -> go',
  shouldNightMine(SEALED), { go: true, reason: null });

// ---- 2. shouldNightMine: shelterBuild's own result gates it ----
T('hut (not digin) -> refused, hut variant is untouched by 5m',
  shouldNightMine({ ...SEALED, builtKind: 'hut' }), { go: false, reason: 'not_sealed_digin' });
T('digin but NOT sealed (partial cap) -> refused, same as a build failure',
  shouldNightMine({ ...SEALED, builtSealed: false }), { go: false, reason: 'not_sealed_digin' });
T('no builtKind at all (e.g. shelterBuild refused entirely) -> refused',
  shouldNightMine({ ...SEALED, builtKind: null }), { go: false, reason: 'not_sealed_digin' });

// ---- 3. shouldNightMine: no pickaxe -> refused for the WHOLE night, not re-checked ----
T('sealed in without a pickaxe -> refused (TOOL, prio 5, never got the body before SHELTER did)',
  shouldNightMine({ ...SEALED, hasPickaxe: false }), { go: false, reason: 'no_pickaxe' });

// ---- 4. shouldNightMine: batch cap (lead's call: not a small fixed number, a generous ceiling
//    behind the REAL exits -- default 12) ----
T('11 batches used, cap 12 -> still go', shouldNightMine({ ...SEALED, batchesUsed: 11 }), { go: true, reason: null });
T('12 batches used, cap 12 -> refused', shouldNightMine({ ...SEALED, batchesUsed: 12 }), { go: false, reason: 'batch_cap' });
T('a custom (lower) batchCap is honoured', shouldNightMine({ ...SEALED, batchesUsed: 3 }, { batchCap: 3 }),
  { go: false, reason: 'batch_cap' });

// ---- 5. shouldNightMine: the y-floor -- steers clear of 'deep' (5o's still-open gap) entirely,
//    re-checked EVERY call (not a one-time gate like hasPickaxe), against the LANE (currentY-1),
//    not currentY itself ----
T('currentY 1 -> lane would be y=0, still >= minY 0 -> go', shouldNightMine({ ...SEALED, currentY: 1 }), { go: true, reason: null });
T('currentY 0 -> lane would be y=-1, below minY 0 -> refused (never touches the deep-tier gap)',
  shouldNightMine({ ...SEALED, currentY: 0 }), { go: false, reason: 'y_floor' });
T('currentY -5 (already deep, however it got there) -> refused', shouldNightMine({ ...SEALED, currentY: -5 }),
  { go: false, reason: 'y_floor' });
T('a custom minY is honoured', shouldNightMine({ ...SEALED, currentY: 10 }, { minY: 10 }), { go: false, reason: 'y_floor' });

// ---- 6. shouldNightMine: inventory -- reuses DEPOSIT's own existing freeSlots<=2 threshold ----
T('freeSlots 3 -> still go', shouldNightMine({ ...SEALED, freeSlots: 3 }), { go: true, reason: null });
T('freeSlots 2 -> refused (same floor DEPOSIT already fires on)', shouldNightMine({ ...SEALED, freeSlots: 2 }),
  { go: false, reason: 'inventory_full' });
T('freeSlots 0 -> refused', shouldNightMine({ ...SEALED, freeSlots: 0 }), { go: false, reason: 'inventory_full' });

// ---- 7. shouldNightMine: check ORDER matches priority (sealed check first, cheapest/most
//    fundamental refusal reported, not whichever happens to be checked last) ----
T('hut AND no pickaxe AND batch-capped -> reports not_sealed_digin (the most fundamental gate), not a later one',
  shouldNightMine({ builtKind: 'hut', builtSealed: false, hasPickaxe: false, currentY: -10, freeSlots: 0, batchesUsed: 99 }),
  { go: false, reason: 'not_sealed_digin' });

// ---- 8. nightMineTargets: ore preferred, stone the guaranteed catch-all, in order ----
T('ore-first, stone-last order (mineLane\'s own target param is a single string, confirmed by' +
  ' reading skills.js -- this is how "prefer ore, never chase" is implemented: try each once)',
  nightMineTargets(), ['coal_ore', 'iron_ore', 'stone']);

// ---- 9. nightMineArgs: laneY pinned to restY-1, vein disabled, tight maxDist ----
T('laneY is restY-1 (one BELOW the sealed floor, never the live/current Y -- cannot creep toward the cap)',
  nightMineArgs('stone', 60), { target: 'stone', vein: false, laneY: 59, maxDist: 8, count: 6 });
T('a negative restY still just subtracts 1 (the y-floor check in shouldNightMine is what actually gates this, not nightMineArgs)',
  nightMineArgs('coal_ore', 0), { target: 'coal_ore', vein: false, laneY: -1, maxDist: 8, count: 6 });
T('custom maxDist/count are honoured', nightMineArgs('iron_ore', 40, { maxDist: 4, count: 3 }),
  { target: 'iron_ore', vein: false, laneY: 39, maxDist: 4, count: 3 });

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
