// bench/fixtures/producer-torch-fuel.js — TODO 7c (#71): produce('torch')'s coal->charcoal
// fallback must fail FAST and honestly when neither is reachable, not spend real time
// bootstrapping a pickaxe it will never get to use. SELF-CALIBRATING against the bot's
// ACTUAL current inventory and surroundings (same discipline as assert-produce.js/
// producer-cook.js) — the timing assertion only runs when the precondition (no coal ore
// findable nearby) is independently verified first, so this never asserts something the
// bot's real position can't honestly back.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/producer-torch-fuel.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { engine: S.version, cases: [] };
if (typeof S.produce !== 'function') { out.skipped = 'no __skills.produce — producer.js not installed'; return out; }

const invCount = (n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
const hasFuel = invCount('coal') > 0 || invCount('charcoal') > 0
  || bot.inventory.items().some((i) => /_planks$/.test(i.name));
const hasLogs = bot.inventory.items().some((i) => /_log$/.test(i.name));
const coalIds = ['coal_ore', 'deepslate_coal_ore']
  .map((n) => bot.registry.blocksByName[n] && bot.registry.blocksByName[n].id).filter((x) => x != null);
const coalNearby = bot.findBlocks({ matching: coalIds, maxDistance: 20, count: 1 }).length > 0;
const logNames = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove'].map((s) => s + '_log');
const logIds = logNames.map((n) => bot.registry.blocksByName[n] && bot.registry.blocksByName[n].id).filter((x) => x != null);
const logsNearby = bot.findBlocks({ matching: logIds, maxDistance: 48, count: 1 }).length > 0;

const out2 = [];
async function T(label, cond, fn) {
  if (!cond) { out2.push({ label, PASS: null, skipped: 'precondition not met right now (real terrain/inventory)' }); return; }
  let got = null, err = null;
  try { got = await fn(); } catch (e) { err = String(e.message || e); }
  out2.push({ label, got, err, PASS: !err && Boolean(got) });
}

// The live-caught bug: with NEITHER fuel held NOR coal/logs reachable, this used to spend
// ~25s bootstrapping a wooden pickaxe (S.ensureTool) before ever checking whether there was
// anything to mine with it. Fixed: a cheap existence check runs FIRST. Bounded generously
// (10s, not the fix's own measured ~0.5s) — this is a regression guard against the OLD
// multi-second cost coming back, not a tight performance assertion.
await T('no fuel held, no coal/logs reachable -> produce(torch) fails FAST and honestly (regression guard against the ~25s pre-fix cost)',
  !hasFuel && !hasLogs && !coalNearby,
  async () => {
    const t0 = Date.now();
    const r = await S.produce(bot, 'torch', 4);
    const ms = Date.now() - t0;
    return r.ok === false && r.reason === 'no_fuel' && ms < 10000;
  });

out.cases = out2.filter((c) => c.PASS !== null);
out.skippedCases = out2.filter((c) => c.PASS === null).map((c) => c.label);
out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => c.label);
return out;
