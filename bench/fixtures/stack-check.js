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
// A reconnect builds a fresh bot object while globals survive, so a payload can be
// present-but-dead. Anything stale here is bound to a discarded bot and must be re-injected.
const stale = Object.entries(globalThis.__payloads || {}).filter(([, v]) => v && v.stale).map(([k]) => k);
need('no stale payloads', stale.length === 0, stale.length ? stale.join(', ') : 'none');

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => c.label + ' (' + c.detail + ')');
return out;
