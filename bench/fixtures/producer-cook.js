// bench/fixtures/producer-cook.js — the cook/smelt follow-up (#113's flagged gap, TODO
// soak-hour task): does `S.produce(bot, 'cooked_meat', ...)` honestly report the two cheap,
// deterministic early-exit paths (no raw meat held; raw meat held but no fuel)? SELF-
// CALIBRATING against the bot's ACTUAL current inventory, same discipline
// assert-produce.js already uses — a case that can't be honestly set up from what the bot
// happens to be holding right now is SKIPPED, not faked.
//
// The full smelt cycle (real furnace, real wait, real cooked-item yield) is NOT exercised
// here — that needs a real furnace and 10+ real seconds per item, the same reason
// smeltCharcoal (producer.js's other furnace user) has never had a hermetic fixture either.
// Verified live instead (RCON-given raw meat + fuel, on 25599) — see FEEDBACK.md.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/producer-cook.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { engine: S.version, cases: [] };
if (typeof S.produce !== 'function') { out.skipped = 'no __skills.produce — producer.js not installed'; return out; }

const RAW_MEATS = ['beef', 'porkchop', 'mutton', 'chicken', 'rabbit'];
const invCount = (n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
const heldRawMeat = RAW_MEATS.filter((m) => invCount(m) > 0);
const heldFuel = ['coal', 'charcoal'].some((f) => invCount(f) > 0) || bot.inventory.items().some((i) => /_planks$/.test(i.name));

const out2 = [];
async function T(label, cond, fn) {
  if (!cond) { out2.push({ label, PASS: null, skipped: 'inventory precondition not met right now' }); return; }
  let got = null, err = null;
  try { got = await fn(); } catch (e) { err = String(e.message || e); }
  out2.push({ label, got, err, PASS: !err && Boolean(got) });
}

await T('no raw meat held -> honest no_raw_meat refusal, not a false success or a hang',
  heldRawMeat.length === 0,
  async () => {
    const r = await S.produce(bot, 'cooked_meat', 4);
    return r.ok === false && r.made === 0 && r.reason === 'no_raw_meat';
  });

await T('raw meat held but no coal/charcoal/planks -> honest no_fuel refusal (does not attempt a furnace trip it cannot pay for)',
  heldRawMeat.length > 0 && !heldFuel,
  async () => {
    const r = await S.produce(bot, 'cooked_meat', 4);
    return r.ok === false && r.made === 0 && r.reason === 'no_fuel';
  });

// resource is documented — a driver/decider reading the registry sees cooked_meat is a real option
out2.push({ label: 'cooked_meat listed in produce\'s own advertised resources',
  PASS: Array.isArray(globalThis.__producer && globalThis.__producer.resources)
    ? globalThis.__producer.resources.includes('cooked_meat')
    : (S.registry.produce && /cooked_meat/.test(S.registry.produce.params.resource)) });

// preflight.sh totals against len(cases)/passed — a precondition-skipped case (bot's current
// inventory can't honestly set it up) must not count as a denominator slot with no numerator,
// or a clean run reads as a false failure. Reported separately, visible, never silently lost.
out.skippedCases = out2.filter((c) => c.PASS === null).map((c) => c.label);
out.cases = out2.filter((c) => c.PASS !== null);
out.passed = out.cases.filter((c) => c.PASS === true).length;
out.failed = out.cases.filter((c) => c.PASS === false).map((c) => c.label);
return out;
