// bench/fixtures/kit-deep-orphans.js — TODO 5o (#122): the kit-supplier audit found
// KIT_TIERS.deep demanding armor/shield/water with NO rung anywhere that could ever supply
// them (not even a withdraw attempt) — a permanent S.start() preflight deadlock on any y<0
// project. Fixed by DELETING those three fields from KIT_TIERS.deep (skills.js v65->v66)
// rather than building the supply chains (filed separately, felsenuboot/FelsenBerry#128).
// This proves the fix at the actual gate — S.kitCheck(bot,'deep') — not just by reading the
// object literal, and that every OTHER deep-tier demand (torches/food/weapon/picks/filler/
// sticks/table) is untouched. Synthetic bot object, not the live one: kitCheck only reads
// inventory.items()/inventory.slots/food/registry, all cheap to construct — matches the
// hermetic-shim doctrine agenda.js's own resolveKit() uses for the same reason (deterministic,
// doesn't depend on whatever this bot happens to be carrying right now).
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/kit-deep-orphans.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { cases: [] };
const T = (label, missing, expect) => {
  const gotSorted = [...missing].sort();
  const wantSorted = [...expect].sort();
  out.cases.push({ label, got: gotSorted, expect: wantSorted, PASS: JSON.stringify(gotSorted) === JSON.stringify(wantSorted) });
};

// A "reasonably kitted for underground, nothing extra" bot: everything `deep` shares with
// `underground` present at floor, nothing armor/shield/water-related held at all.
const makeBot = (items) => ({
  inventory: {
    items: () => items,
    slots: new Array(46).fill(null),   // no armor worn (5-8), no shield (offhand, 45)
  },
  food: 20,
  registry: { items: {} },
});

const FULLY_KITTED_UNDERGROUND = [
  { name: 'torch', count: 40 }, { name: 'bread', count: 8 },
  { name: 'iron_sword', count: 1 },
  // kitCheck's own picks count is items.filter(...).length -- an ARRAY LENGTH (real pickaxes
  // are unstackable tools, one inventory slot each), not a summed .count -- so "2 pickaxes"
  // needs two separate entries, not one entry with count:2.
  { name: 'iron_pickaxe', count: 1 }, { name: 'iron_pickaxe', count: 1 },
  { name: 'cobblestone', count: 16 },
  { name: 'stick', count: 16 },
  { name: 'crafting_table', count: 1 },
];

{
  const bot = makeBot(FULLY_KITTED_UNDERGROUND);
  const r = S.kitCheck(bot, 'deep');
  T('fully kitted for the OTHER deep demands, zero armor/shield/water held -> ok, nothing missing (the whole point of the fix)',
    r.missing, []);
  out.ok = r.ok;
}

{
  // regression: every OTHER deep demand still fires when genuinely short — the fix only
  // touched armor/shield/water, nothing else.
  const bot = makeBot([]);
  const r = S.kitCheck(bot, 'deep');
  T('nothing held at all -> still demands the real deep-tier kit (torches/food/weapon/picks/filler/sticks/table), NOT armor/shield/water',
    r.missing.map((m) => m.split(' ')[0]),
    ['torches', 'food', 'weapon', 'pickaxes', 'filler', 'sticks', 'crafting_table']);
}

{
  // underground was never affected (it never had these fields) -- same-shape sanity check.
  const bot = makeBot(FULLY_KITTED_UNDERGROUND);
  const r = S.kitCheck(bot, 'underground');
  T('underground tier: unaffected, still ok with the same loadout', r.missing, []);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
return out;
