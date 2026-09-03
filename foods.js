// foods.js — the ONE shared "is this item food" answer (TODO 5e, #113).
//
// skills.js's excursion-kit preflight gate (S.start, foodItems check) and agenda.js's FOOD
// rung (s.foodCount, feeding its fire()) each carried their OWN, independently-maintained
// FOODS set — textually near-identical but not the same object. They drifted: #108 added the
// raw meats a real hunt actually produces (huntAnimals never cooks anything) to agenda.js's
// copy only, so a hunted porkchop satisfied the FOOD rung's "stop starving" check but could
// NOT satisfy skills.js's kit gate — a role-less racer that hunted successfully still refused
// to depart "half-kitted: food 0/2" with a raw porkchop sitting in its own inventory
// (test-driver, run #6 live, FEEDBACK ~09:28Z). Two allowlists, one bug class, one fix landed
// on one of the two copies. This file is the fix: ONE Set, required by both.
//
// Plain CommonJS module — NOT itself a payload, never injected/eval'd via runner.js's
// AsyncFunction-from-source-text mechanism (that mechanism has no `require` binding at all,
// which is why agenda.js/skills.js already read protected.json via
// `process.mainModule.require('fs')` rather than a bare `require('fs')` — the same idiom
// this file is loaded through from both, see their own `readCfg()`/`cfg` init). A real
// `require()`, with Node's own module cache, is exactly right for a small constants file that
// changes rarely — the same caching behavior `fs`/`path`/`vec3` already get via that idiom.
//
// Union of both prior copies, nothing dropped: skills.js's kit-gate copy additionally
// recognized golden_apple/enchanted_golden_apple/sweet_berries/glow_berries that agenda.js's
// FOOD-rung copy never had; agenda.js's copy additionally recognized the #108 raw meats
// (beef, porkchop, mutton, rabbit) skills.js's copy never had. Deliberately NOT raw_chicken —
// #108's own argued call (real Hunger-effect risk eaten raw), unchanged here.
const FOODS = new Set([
  'bread',
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_rabbit',
  'cooked_cod', 'cooked_salmon',
  'baked_potato', 'apple', 'golden_apple', 'enchanted_golden_apple',
  'carrot', 'beetroot', 'melon_slice', 'sweet_berries', 'glow_berries',
  'cookie', 'pumpkin_pie', 'mushroom_stew', 'beetroot_soup', 'rabbit_stew', 'dried_kelp',
  'beef', 'porkchop', 'mutton', 'rabbit',
]);
module.exports = { FOODS };
