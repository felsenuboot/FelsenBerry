// bench/fixtures/trail-vacuous.js — bench/trail.mjs's `computeVerdict()`/MIN_SITES_FOR_VERDICT
// (the criterion-4 "vacuous verdict" threshold, added 2026-09-03 from the soak #4 audit:
// FEEDBACK.md "criterion-4 vacuous verdict" — soak #4 passed trail on ONE dig site and ZERO
// chop clusters, no annotation on the gate file said the sample was that thin).
//
// PURE NODE, hermetic — no live bot, no RCON, no world. computeVerdict() takes already-computed
// findings/cluster arrays and returns a plain object; same "hermetic > staged" principle as
// bench/fixtures/telemetry-sinks.js and move-detect.js. trail.mjs itself is now split so this
// import is possible: everything CLI/network-shaped lives behind `if (isMain)` at the bottom of
// that file, so importing it here for its pure exports runs no side effects.
//
// Run:  node bench/fixtures/trail-vacuous.mjs
//
// .mjs, not .js like this directory's other pure-node fixtures (telemetry-sinks.js) — that one
// uses require() against a CommonJS module; trail.mjs is ESM (top-level await, import.meta.url
// isMain guard), so this fixture needs a real `import` and the matching extension.
import { computeVerdict, MIN_SITES_FOR_VERDICT } from '../trail.mjs';

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const emptyFindings = (sitesChecked) => ({ floatingLogs: [], strandedDrops: [], nakedShafts: [], sitesChecked });
const clustersOfLen = (n) => Array.from({ length: n }, (_, i) => ({ pos: [i, 64, 0] }));

T('MIN_SITES_FOR_VERDICT is 3 (this file\'s own findings thresholds already treat n=3 as the anecdote/pattern line — reused, not reinvented)',
  MIN_SITES_FOR_VERDICT, 3);

// ---- 1. soak #4's own real shape: 1 dig site checked, 0 chop clusters, nothing found ----
{
  const r = computeVerdict({
    findings: emptyFindings(1), rawChop: [], rawDig: [{ pos: [0, 84, 0], digs: 3 }],
    chopClusters: [], digClusters: clustersOfLen(1),
    torchSurfacePlaced: 0, surfaceTaskCount: 1,
  });
  T('soak-4 shape: verdict is still an honest PASS (nothing was actually found)', r.verdict, 'PASS');
  T('soak-4 shape: PASS is flagged VACUOUS (1 site < 3-site floor)', r.vacuous, true);
  T('soak-4 shape: vacuousReasons calls out both the thin sample AND the empty chop category',
    r.vacuousReasons.length, 2);
}

// ---- 2. a clean sample AT the floor (3 sites, mixed categories) is NOT vacuous ----
{
  const r = computeVerdict({
    findings: emptyFindings(3), rawChop: [{ pos: [0, 70, 0], stranded: 0 }], rawDig: [{ pos: [0, 84, 0], digs: 3 }],
    chopClusters: clustersOfLen(1), digClusters: clustersOfLen(2),
    torchSurfacePlaced: 0, surfaceTaskCount: 3,
  });
  T('3 sites checked (the floor itself) is NOT vacuous', r.vacuous, false);
  T('3 sites checked, both categories represented -> no vacuousReasons', r.vacuousReasons.length, 0);
}

// ---- 3. a thin sample that still finds a real scar: WARN stands, vacuous flag is orthogonal ----
{
  const findings = { floatingLogs: [{ site: [0, 70, 0], ledgerStranded: 0, logs: [{ pos: [0, 71, 0], name: 'oak_log' }] }], strandedDrops: [], nakedShafts: [], sitesChecked: 1 };
  const r = computeVerdict({
    findings, rawChop: [{ pos: [0, 70, 0], stranded: 0 }], rawDig: [],
    chopClusters: clustersOfLen(1), digClusters: [],
    torchSurfacePlaced: 0, surfaceTaskCount: 1,
  });
  T('thin sample with a real floating-log finding -> verdict is WARN, not silently upgraded by the vacuous flag', r.verdict, 'WARN');
  T('vacuous is STILL true at 1 site (the flag never changes the verdict, just qualifies it)', r.vacuous, true);
  T('vacuousReasons flags the empty dig category too (0 dig clusters, chop clusters present)',
    r.vacuousReasons.some((s) => s.includes('dig clusters')), true);
}

// ---- 4. a real multi-site pattern at a healthy sample size: FAIL, not vacuous ----
{
  const findings = {
    floatingLogs: [1, 2, 3].map((i) => ({ site: [i, 70, 0], ledgerStranded: 0, logs: [{ pos: [i, 71, 0], name: 'oak_log' }] })),
    strandedDrops: [], nakedShafts: [], sitesChecked: 5,
  };
  const r = computeVerdict({
    findings, rawChop: clustersOfLen(3).map((c) => ({ ...c, stranded: 0 })), rawDig: clustersOfLen(2).map((c) => ({ ...c, digs: 2 })),
    chopClusters: clustersOfLen(3), digClusters: clustersOfLen(2),
    torchSurfacePlaced: 0, surfaceTaskCount: 5,
  });
  T('5 sites, 3 floating-log sites -> FAIL', r.verdict, 'FAIL');
  T('5 sites (>= floor), both categories represented -> not vacuous', r.vacuous, false);
}

// ---- 5. zero sites checked at all (the original, narrower "nothing to inspect" case) ----
{
  const r = computeVerdict({
    findings: emptyFindings(0), rawChop: [], rawDig: [],
    chopClusters: [], digClusters: [],
    torchSurfacePlaced: 0, surfaceTaskCount: 0,
  });
  T('0 sites -> still PASS (nothing found) but vacuous', [r.verdict, r.vacuous], ['PASS', true]);
  // both categories are empty together (no work at all that window) -- neither of the
  // category-specific callouts applies (there is no "the OTHER category had sites" asymmetry),
  // only the sample-size reason fires.
  T('0/0 chop+dig -> only the sample-size vacuousReason fires, not a spurious category callout', r.vacuousReasons.length, 1);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
