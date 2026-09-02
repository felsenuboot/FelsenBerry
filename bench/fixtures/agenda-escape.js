// bench/fixtures/agenda-escape.js — the ESCAPE rung (#89, #91): a project blocked on a
// path/reachability failure while underground had no way out until now. mineLane/safeDescend/
// produce can all dig a bot into a fully-enclosed pocket (#91's forensics on OhneHoseOtto: NOT
// a WALL_OFF seal, NOT mineLane — producer.js's own unbounded nearest-ore chase did it), and
// nothing routed a sealed bot to the one skill that can dig back out (ascendToSurface).
//
// Deliberately narrow and temporary (its own code comment says so): Direction Episodes (the
// idle-trigger spec) will own this class of decision properly. This only proves the minimal
// hook — sits below PROJECT, above IDLE, fires on PATH_BLOCKED codes while underground, starts
// ascendToSurface, clears once the surface is reached.
//
// Stubs __skills.start, same discipline as agenda-ladder.js/agenda-idlework.js: nothing runs,
// nothing moves.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/agenda-escape.js '{code:$c}')" | jq .result
const A = globalThis.__agenda, S = globalThis.__skills;
const out = { agenda: A.version, cases: [] };
const ESCAPE = A.rung('ESCAPE');
if (!ESCAPE) { out.skipped = 'no ESCAPE rung — engine predates #89'; return out; }
const PROJECT = A.rung('PROJECT');
const realStart = S.start;
let started = [];
S.start = (b, n, a) => { started.push({ name: n, args: a }); return { ok: true, taskId: 'stub' }; };
const saved = { project: A.project, activeTaskId: A.activeTaskId };

const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });
const base = { now: Date.now(), surfaceExposed: false };

try {
  A.project = null;
  T('no project -> ESCAPE does not fire', ESCAPE.fire(base), false);

  A.project = { skill: 'mineLane', blocked: 'kit_missing' };
  T('blocked on kit_missing (not path-class) -> ESCAPE stays quiet', ESCAPE.fire(base), false);

  A.project = { skill: 'mineLane', blocked: 'no_path' };
  T('blocked on no_path, underground -> ESCAPE fires', ESCAPE.fire(base), true);
  T('...and PROJECT itself yields the body (projectDone via p.blocked)', PROJECT.clear(base), true);

  T('blocked on no_path but surfaceExposed=true -> ESCAPE stays quiet (not underground)',
    ESCAPE.fire(Object.assign({}, base, { surfaceExposed: true })), false);

  started = []; A.activeTaskId = null;
  ESCAPE.act(base);
  T('ESCAPE.act() starts ascendToSurface', started.length === 1 ? started[0].name : `${started.length} calls`, 'ascendToSurface');

  T('surfaceExposed becomes true -> ESCAPE clears', ESCAPE.clear(Object.assign({}, base, { surfaceExposed: true })), true);
  T('still underground, still blocked -> ESCAPE does not clear', ESCAPE.clear(base), false);

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
  return out;
} finally {
  S.start = realStart;
  A.project = saved.project; A.activeTaskId = saved.activeTaskId;
}
