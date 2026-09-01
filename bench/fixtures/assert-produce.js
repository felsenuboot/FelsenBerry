// bench/fixtures/assert-produce.js — does the produce assertion GRANT a true claim and
// REFUSE a false one? An assertion nobody has watched refuse anything is decorative, so
// this hands it a fabricated claim and a contract breach alongside the honest cases.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/assert-produce.js '{code:$c}')" | jq .result
//
// Expected: honest-full and honest-partial pass (a shortfall is `yield`, not a failure —
// produce is partial-success by contract); the 999-torch claim and the ok-with-made-0
// contract breach both fail; an honest ok:false/made:0 passes, because failing to produce is
// not a false SUCCESS. Reads the live inventory, so it runs against a real bot and changes
// nothing.
const S = globalThis.__skills;
const inv = {};
for (const i of bot.inventory.items()) inv[i.name] = (inv[i.name] || 0) + i.count;
const heldTorch = inv.torch || 0;

const T = (label, task) => ({ label, verdict: S.assertTask(task, bot) });
const out = { engine: S.version, heldTorch, cases: [] };

// truthful: claims fewer than it is holding
out.cases.push(T('honest full success', { name: 'produce', args: { resource: 'torch', count: 8 },
  result: { ok: true, made: 8, how: 'crafted' } }));
// truthful partial: real progress, not a failure
out.cases.push(T('honest partial (made 6 of 24)', { name: 'produce', args: { resource: 'torch', count: 24 },
  result: { ok: true, made: 6, how: 'crafted', reason: 'partial' } }));
// FABRICATED: claims far more than the bot actually holds
out.cases.push(T('fabricated: claims 999 torches', { name: 'produce', args: { resource: 'torch', count: 999 },
  result: { ok: true, made: 999, how: 'crafted' } }));
// CONTRACT BREACH: ok true, made zero
out.cases.push(T('contract breach: ok with made 0', { name: 'produce', args: { resource: 'torch', count: 8 },
  result: { ok: true, made: 0, how: null, reason: 'no_coal_nearby' } }));
// honest failure: ok false, made zero -> not a false success, must NOT fail
out.cases.push(T('honest failure (ok false, made 0)', { name: 'produce', args: { resource: 'diamond', count: 1 },
  result: { ok: false, made: 0, how: null, reason: 'unproduceable' } }));
return out;
