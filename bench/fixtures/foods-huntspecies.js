// bench/fixtures/foods-huntspecies.js — TODO 5e (#113/#114): the shared FOODS allowlist
// (foods.js) and huntAnimals' anyMob species widening. Hermetic where possible (pure
// data/validate checks, nothing dispatched); the two live-caught bugs this closes (test-driver,
// run #6, FEEDBACK ~09:28Z) were: (1) skills.js's excursion-kit FOODS never got #108's raw-meat
// additions — only agenda.js's separate copy did, so a hunted porkchop could satisfy the FOOD
// rung but not the kit-departure gate; (2) huntAnimals{anyMob:true} with no species stayed
// ['cow']-only, contrary to Race book v2's documented "widen the search" fallback.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/foods-huntspecies.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const A = globalThis.__agenda;
const out = { cases: [] };
if (!S || !S._foods || !A || !A._foods) {
  out.skipped = 'S._foods/A._foods not exposed — engine predates 5e';
  return out;
}
const T = (label, cond) => out.cases.push({ label, PASS: Boolean(cond) });

// (1) ONE shared source, not two copies with the same values by coincidence.
T('agenda.js and skills.js FOODS are the SAME object (identity, not just equal values)', A._foods === S._foods);

// Union of both prior lists — nothing either copy already had should have been dropped.
T('raw porkchop recognized (was missing from skills.js pre-5e)', S._foods.has('porkchop'));
T('raw beef/mutton/rabbit recognized too (the full #108 raw-meat set)',
  S._foods.has('beef') && S._foods.has('mutton') && S._foods.has('rabbit'));
T('golden_apple recognized (was missing from agenda.js pre-5e)', A._foods.has('golden_apple'));
T('enchanted_golden_apple + berries recognized (agenda.js pre-5e gap, full set)',
  A._foods.has('enchanted_golden_apple') && A._foods.has('sweet_berries') && A._foods.has('glow_berries'));
T('bread still recognized (both copies always had it — sanity check the union did not lose it)', S._foods.has('bread') && A._foods.has('bread'));

// #108's own argued exclusion must survive the merge — raw chicken carries a real Hunger-
// effect risk eaten raw; this was a deliberate call, not an oversight to "complete" here.
T('raw_chicken deliberately still excluded (poison/Hunger-effect risk, #108\'s own call)',
  !S._foods.has('raw_chicken') && !A._foods.has('raw_chicken'));

// (2) huntAnimals anyMob species widening — validate() is pure and exposed via the registry
// (S.registry[name].validate), same discipline tier-choice.js already uses for a skill's
// pure logic. `bot` is a real object in this /eval scope (registry entity lookups need it),
// nothing about the bot's own state is read.
const hunt = S.registry && S.registry.huntAnimals;
if (hunt && typeof hunt.validate === 'function') {
  T('S._huntAnyMobDefaultSpecies is the documented widened list', JSON.stringify(S._huntAnyMobDefaultSpecies) === JSON.stringify(['cow', 'pig', 'sheep', 'chicken']));
  T('anyMob:true, no species -> validates clean (resolves to the widened default, all real animals)',
    hunt.validate({ anyMob: true }, bot) === null);
  T('no anyMob, no species -> still validates clean (narrow default unchanged, cow is an animal)',
    hunt.validate({}, bot) === null);
  T('no anyMob, explicit non-animal species -> STILL refused (widening never weakens the type gate)',
    typeof hunt.validate({ species: ['zombie'] }, bot) === 'string');
  T('anyMob:true, explicit non-animal species -> allowed (anyMob\'s own documented job, unaffected by 5e)',
    hunt.validate({ species: ['zombie'], anyMob: true }, bot) === null);
} else {
  out.cases.push({ label: 'huntAnimals not in registry', PASS: false });
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => c.label);
return out;
