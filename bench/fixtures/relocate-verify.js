// bench/fixtures/relocate-verify.js — TODO 7a (#74): relocateToWork's success check is now
// verifier-backed against the REQUESTED hop, not a fixed absolute floor. `S._relocateVerified`
// is the pure predicate (module-level in skills.js, same discipline as S.tierFor/
// S._huntAnyMobDefaultSpecies) — driven here with SYNTHETIC (dist, hop) pairs, no need to
// actually walk a bot to test the threshold math. The live displacement itself (does a real
// relocateToWork actually move the bot the reported distance) is verified separately, live,
// on 25599 — see FEEDBACK.md.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/relocate-verify.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { engine: S.version, cases: [] };
if (typeof S._relocateVerified !== 'function') { out.skipped = 'no __skills._relocateVerified — engine predates #74'; return out; }

const T = (label, dist, hop, expect) => {
  const got = S._relocateVerified(dist, hop);
  out.cases.push({ label, dist, hop, expect, got, PASS: got === expect });
};

// The old, replaced behaviour: a fixed 3-block absolute floor regardless of hop size.
T('64-block hop, landed only 4 blocks away -> FAILS (old fixed-3 floor would have let this pass)', 4, 64, false);
T('64-block hop, landed only 10 blocks away -> still FAILS (nowhere near "significantly further")', 10, 64, false);
// The new floor, exercised at its own boundary.
T('64-block hop, landed exactly at 50% (32) -> PASSES (the boundary itself counts)', 32, 64, true);
T('64-block hop, landed at 31 (just under 50%) -> FAILS (one block short of the bar)', 31, 64, false);
T('64-block hop, landed near the requested ring (60) -> PASSES (the ordinary, expected case)', 60, 64, true);
// The clamp's own minimum hop (16) still gets a real, non-trivial bar (8 blocks), not the old flat 3.
T('minimum-clamped 16-block hop, landed 5 blocks away -> FAILS (5 < 8 = 16*0.5, stricter than the old fixed-3)', 5, 16, false);
T('minimum-clamped 16-block hop, landed 9 blocks away -> PASSES', 9, 16, true);
// Zero/negative displacement (the literal #74 "0m moved" report) must always fail, at any hop.
T('0m moved on any hop -> FAILS (the literal false-success case #74 was filed for)', 0, 40, false);

// Documents the argued threshold itself, so a future change to it shows up as a diff here,
// not a silent drift between this file's own comments and the real constant.
out.cases.push({ label: 'argued threshold is exactly 50% of the requested hop',
  PASS: S._minRelocateFraction === 0.5 });

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => c.label);
return out;
