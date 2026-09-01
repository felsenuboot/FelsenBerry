// bench/fixtures/assert-produce.js — does the produce assertion GRANT a true claim and
// REFUSE a false one? An assertion nobody has watched refuse anything is decorative, so this
// hands it a fabricated claim and a contract breach alongside the honest cases.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/assert-produce.js '{code:$c}')" | jq .result
//
// SELF-CALIBRATING: the assertion compares a claim against what the bot is actually HOLDING,
// so the honest cases pick a real item out of the current inventory rather than assuming one.
// An earlier version hard-coded torches and started failing its own honest cases the moment
// the bot spent them — a pre-flight that cries wolf is worse than no pre-flight.
// Reads inventory only; changes nothing.
const S = globalThis.__skills;
const inv = {};
for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] || 0) + i.count;
// the item it holds most of, so the honest claims are genuinely backed
const [item, held] = Object.entries(inv).sort((a, b) => b[1] - a[1])[0] || [null, 0];
const out = { engine: S.version, item, held, cases: [] };
if (!item || held < 2) {
  out.skipped = 'bot holds nothing to make a backed claim about — give it a few items and re-run';
  return out;
}

const T = (label, task, wantFail) => {
  const v = S.assertTask(task, bot);
  out.cases.push({ label, rule: v && v.rule, fail: v && v.fail, wantFail,
    yield: v && v.yield, PASS: Boolean(v) && Boolean(v.fail) === wantFail });
};

// honest: claims no more than it is holding
T('honest full success', { name: 'produce', args: { resource: item, count: held },
  result: { ok: true, made: held, how: 'crafted' } }, false);
// honest partial: real progress, and NOT a failure — produce is partial-success by contract
T('honest partial', { name: 'produce', args: { resource: item, count: held * 4 },
  result: { ok: true, made: Math.max(1, Math.floor(held / 2)), how: 'crafted', reason: 'partial' } }, false);
// FABRICATED: claims far more than the bot actually holds
T('fabricated claim', { name: 'produce', args: { resource: item, count: held + 1000 },
  result: { ok: true, made: held + 1000, how: 'crafted' } }, true);
// CONTRACT BREACH: ok true, made zero (produce's contract is ok means made > 0)
T('contract breach: ok with made 0', { name: 'produce', args: { resource: item, count: 8 },
  result: { ok: true, made: 0, how: null, reason: 'no_coal_nearby' } }, true);
// honest failure: failing to produce is not a false SUCCESS
T('honest failure (ok false, made 0)', { name: 'produce', args: { resource: 'diamond', count: 1 },
  result: { ok: false, made: 0, how: null, reason: 'unproduceable' } }, false);

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => c.label);
return out;
