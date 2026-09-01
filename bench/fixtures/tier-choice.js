// bench/fixtures/tier-choice.js — which tool tier does the bot decide it can pay for?
//
// This exists because the alternative cost a soak run. A bot holding oak_planks:1 +
// acacia_planks:2 was told a WOODEN pickaxe was payable — the plank stock was summed across
// wood types, but a tool head needs three of ONE — so the craft yielded nothing and it never
// fell through to the stone pickaxe it could have made instantly from 297 carried
// cobblestone. Terminal deadlock, zero pickaxes, mineLane refused forever.
//
// Hermetic: `__skills.tierFor(need, items, tableInReach)` decides from a SYNTHETIC inventory,
// so these cases do not depend on what the bot is carrying and change nothing.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/tier-choice.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { engine: S.version, cases: [] };
if (typeof S.tierFor !== 'function') { out.skipped = 'no __skills.tierFor — engine predates the hook'; return out; }

const I = (o) => Object.entries(o).map(([name, count]) => ({ name, count }));
const T = (label, items, expect, tableInReach = true) => {
  let got = null, err = null;
  try { got = S.tierFor('pickaxe', I(items), tableInReach); } catch (e) { err = String(e.message || e); }
  out.cases.push({ label, got, expect, err, PASS: !err && got === expect });
};

// THE REGRESSION: mixed woods are not fungible for one head, and cobblestone is the way out.
T('mixed planks (1 oak + 2 acacia) + cobble -> falls through to STONE',
  { oak_planks: 1, acacia_planks: 2, cobblestone: 297, stick: 8 }, 'stone_pickaxe');
// ...and mixed woods with NO cobble are not payable at all, rather than a wooden lie
T('mixed planks, no cobble -> nothing payable (not a false wooden)',
  { oak_planks: 1, acacia_planks: 2, stick: 8 }, null);
// one species with enough of it is genuinely payable
T('3 of ONE species, no cobble -> wooden',
  { oak_planks: 3, stick: 8 }, 'wooden_pickaxe');
// logs count, per species, at four planks each
T('1 oak log (=4 planks), no cobble -> wooden',
  { oak_log: 1, stick: 8 }, 'wooden_pickaxe');
T('1 oak log + 1 birch log, no cobble -> wooden (4 of one species is enough)',
  { oak_log: 1, birch_log: 1, stick: 8 }, 'wooden_pickaxe');
// DURABLE-FIRST: with both affordable, stone wins — wood is the scarce material underground
// and cobblestone is a kit floor the bot already carries
T('plenty of BOTH wood and cobble -> STONE, not the cheaper wooden',
  { oak_planks: 16, cobblestone: 32, stick: 8 }, 'stone_pickaxe');
// on the surface with no cobble, wooden is still the right answer
T('lots of wood, no cobble -> wooden',
  { oak_planks: 16, stick: 8 }, 'wooden_pickaxe');
// the table is part of the bill when none is in reach: 3 head + 2 sticks + 4 table = 9
T('no table in reach raises the wooden bill (3 planks is not enough)',
  { oak_planks: 3, stick: 8 }, null, false);
T('no table in reach, but stone only needs the table planks',
  { oak_planks: 4, cobblestone: 32, stick: 8 }, 'stone_pickaxe', false);
// sticks are part of the bill too
T('no sticks -> two more planks needed for them',
  { oak_planks: 3 }, null);
T('no sticks but 5 planks covers head+sticks',
  { oak_planks: 5 }, 'wooden_pickaxe');

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}${c.err ? ' (' + c.err + ')' : ''}`);
return out;
