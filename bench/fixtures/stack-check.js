// bench/fixtures/stack-check.js — is the LADDER'S DEPENDENCIES actually present on this bot?
//
// The behavioural fixtures stub __skills.start, which is what makes them fast and safe — but
// it also means they pass on a bot where `produce` was never installed at all. That is a real
// launch risk: RESTOCK's acquire-by-producing is the difference between a self-sufficient bot
// and one that stands down forever, and a half-injected stack reports healthy from outside.
// So this checks presence and version before the others check behaviour.
//
// Reads globals only; changes nothing.
const out = { cases: [] };
const S = globalThis.__skills;
const need = (label, ok, detail) => out.cases.push({ label, detail, PASS: Boolean(ok) });

need('__skills installed', S && typeof S.define === 'function', S ? 'v' + S.version : 'MISSING');
if (S) {
  need('produce METHOD present (producer.js)', typeof S.produce === 'function', typeof S.produce);
  need('produce SKILL registered', Boolean(S.registry && S.registry.produce),
    S.registry ? Object.keys(S.registry).length + ' skills' : 'no registry');
  need('ensureTool + restock registered',
    Boolean(S.registry && S.registry.ensureTool && S.registry.restock), 'RESTOCK/TOOL depend on these');
  need('kit tiers expose the recraft makings', (() => {
    try { const k = S.kitTiers().underground; return k.sticks > 0 && k.table > 0; } catch (_) { return false; }
  })(), (() => { try { const k = S.kitTiers().underground; return 'sticks ' + k.sticks + ', table ' + k.table; } catch (_) { return '?'; } })());
}
need('__agenda installed', globalThis.__agenda && globalThis.__agenda.enabled !== undefined,
  globalThis.__agenda ? 'v' + globalThis.__agenda.version : 'MISSING');
need('__digguard installed (producer consults it)', Boolean(globalThis.__digguard),
  globalThis.__digguard ? 'v' + globalThis.__digguard.version : 'MISSING');
// The dig guards register into digchain rather than wrapping bot.dig themselves (#55), so a
// missing coordinator means they are NOT INSTALLED — silently, on bots that protect a real
// base. Each guard raises `chainMissing` when it finds no chain to register into; assert both
// that the coordinator is present and that nobody reported giving up.
const chain = globalThis.__digchain;
need('__digchain installed (the guards register into it)', Boolean(chain),
  chain ? 'v' + chain.version : 'MISSING');
if (chain) {
  need('dig guards actually registered', Boolean(chain.guards && chain.guards.size > 0),
    chain.order ? chain.order.join(' -> ') : 'registry empty');
}
const abandoned = ['__digguard', '__toolguard', '__reachguard']
  .filter((n) => globalThis[n] && globalThis[n].chainMissing).map((n) => n.slice(2));
need('no guard gave up for want of a chain', abandoned.length === 0,
  abandoned.length ? abandoned.join(', ') + ' reported chainMissing' : 'none');
// A reconnect builds a fresh bot object while globals survive, so a payload can be
// present-but-dead. Anything stale here is bound to a discarded bot and must be re-injected.
const stale = Object.entries(globalThis.__payloads || {}).filter(([, v]) => v && v.stale).map(([k]) => k);
need('no stale payloads', stale.length === 0, stale.length ? stale.join(', ') : 'none');

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => c.label + ' (' + c.detail + ')');
return out;
