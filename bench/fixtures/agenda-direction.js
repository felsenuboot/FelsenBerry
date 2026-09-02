// bench/fixtures/agenda-direction.js — Direction Episodes regression (research/IDLE_TRIGGER_SPEC.md
// §4.3). Ten cases, the acceptance backbone for felcrew-mcp#68's trigger half.
//
// VERSION NOTE: the spec was written as agenda v20->v21, but engine-dev-3 landed the ESCAPE
// rung (#89 digOut) as v21 first (unrelated to this work), so Direction Episodes ships as v22
// instead -- a number, not a functional change. This file never keys off a version number,
// only `A._directionCheck`'s existence, so nothing below needed changing for it.
//
// STATUS (2026-09-02, engine-dev): SKELETON, written against the spec text BEFORE Direction
// Episodes landed (engine-dev-3's lane, phase 1 of the spec's phased plan). `A._directionCheck`
// and the harvest-block promotion logic do not exist on any live bot yet -- this file cannot
// be run until they do. Structure and the ten case descriptions are pinned to the spec
// verbatim; the INJECTION SHAPE (exactly which A.* fields directionCheck reads, and whether
// promotion needs its own exposed hook or must be driven through a fuller tick()-style call)
// is my best-effort reading of §1.1h/§1.1g and WILL need a pass against the real code once it
// lands -- flagged rather than guessed silently. UPDATE (2026-09-02): engine-dev-3 confirmed
// promotion gets its own hook, `A._promoteCheck`, same discipline as `_directionCheck`/
// `_idleWorkOutcome` -- exact signature to follow once section 1.1g is real code. Coordinate
// with engine-dev-3 before trusting this file's assertions; update this header once verified live.
//
// Pattern follows agenda-ladder.js (dry-run via direct A.* field injection, save/restore,
// try/finally) and agenda-idlework.js (stubbing __skills.start / calling exposed pure hooks
// directly) -- same discipline as both: every input the code under test reads must come
// through an explicit injection here, or a case can silently read the live bot instead of
// the synthetic snapshot (agenda-ladder.js's own header names exactly this failure mode).
//
// Run (once A._directionCheck exists):
//   curl -s localhost:<port>/eval -H 'content-type: application/json' \
//     --data "$(jq -Rn --rawfile c bench/fixtures/agenda-direction.js '{code:$c}')" | jq .result
const A = globalThis.__agenda;
const out = { version: A.version, cases: [] };
if (!A._directionCheck) { out.skipped = 'no __agenda._directionCheck -- engine predates Direction Episodes (IDLE_TRIGGER_SPEC)'; return out; }

const saved = {
  project: A.project, owner: A.owner, blocked: A.blocked, nextProject: A.nextProject,
  direction: JSON.parse(JSON.stringify(A.direction)),
};

const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

// resets A.direction to a clean 'ok' state with fresh counters, then runs directionCheck
// once against a synthetic per-tick context (s.now/s.task are the only fields directionCheck
// itself reads per §1.1h; A.project/A.blocked are set directly on A before calling).
function resetDirection(overrides) {
  A.direction = Object.assign({
    state: 'ok', episode: null, prevLvl: 'none', lastProductiveAt: Date.now(),
    reopenAt: {}, reopenCount: {}, opened: 0, closed: 0, promoted: 0, byWhy: {},
  }, overrides || {});
}
function check(s) { return A._directionCheck(Object.assign({ now: Date.now(), task: null }, s)); }

try {
  // ---- 1: active->done edge opens once, no re-open next tick ----
  A.project = { skill: 'mineLane', args: {}, completedOnce: true };
  A.blocked = null;
  resetDirection({ prevLvl: 'active' });
  check({});
  T('1a: active->done edge opens a project_done episode', A.direction.episode && A.direction.episode.why, 'project_done');
  T('1b: opened counter incremented exactly once', A.direction.opened, 1);
  const epId1 = A.direction.episode && A.direction.episode.id;
  check({});   // same tick shape again -- level is already 'done', no edge, must NOT re-open
  T('1c: no re-open on the next tick (same episode id, opened still 1)',
    [A.direction.opened, A.direction.episode && A.direction.episode.id], [1, epId1]);

  // ---- 2: staged next promotes -- no episode, project swapped, all four hygiene fields cleared ----
  // NOTE: promotion lives in the harvest block (§1.1g), OUTSIDE directionCheck itself -- this
  // case cannot be driven through _directionCheck alone. Placeholder pending an exposed
  // promotion hook (or a decision to drive this through a fuller tick()-shaped call) --
  // FLAG TO ENGINE-DEV-3 rather than guess at an API that may not exist.
  out.cases.push({ label: '2: staged-next promotion (needs a promotion test hook from engine-dev-3)', PASS: null, skipped: true });

  // ---- 3: repeat project is NEVER promoted ----
  // Same dependency as case 2 -- the `!p.repeat` guard lives in the same harvest-block promote
  // condition. Placeholder pending the same hook.
  out.cases.push({ label: '3: repeat project never promotes (needs the same hook as case 2)', PASS: null, skipped: true });

  // ---- 4: E2 respects the 120s window; quiet while a task runs and after a 'worked' stamp ----
  A.project = null; A.blocked = null;
  resetDirection({ lastProductiveAt: Date.now() - 200000 });   // 200s quiet, past the 120s window
  check({ task: { running: true } });
  T('4a: no project, quiet >120s, but a task IS running -> no episode (gated on !running)',
    A.direction.episode, null);
  resetDirection({ lastProductiveAt: Date.now() - 200000 });
  check({ task: null });
  T('4b: no project, quiet >120s, nothing running -> unproductive_idle opens',
    A.direction.episode && A.direction.episode.why, 'unproductive_idle');
  resetDirection({ lastProductiveAt: Date.now() - 60000 });    // only 60s quiet
  check({ task: null });
  T('4c: quiet but under the 120s window -> stays quiet', A.direction.episode, null);

  // ---- 5: E3a fires on a refused-start loop (project set, nothing running, 180s) ----
  A.project = { skill: 'mineLane', args: {}, lastError: 'kit_missing', attempts: 3 };
  A.blocked = null;
  resetDirection({ prevLvl: 'active', lastProductiveAt: Date.now() - 200000 });   // past 180s
  check({ task: null });
  T('5: project set, unproductive >180s, no task running -> project_stalled (E3a)',
    A.direction.episode && A.direction.episode.why, 'project_stalled');

  // ---- 6: E3b fires after 3 barren repeat runs, resets on 'worked' ----
  A.project = { skill: 'harvestGrass', args: {}, repeat: true, barrenRuns: 3 };
  A.blocked = null;
  resetDirection({ prevLvl: 'active' });
  check({ task: null });
  T('6a: repeat project, barrenRuns>=3 -> project_stalled (E3b)',
    A.direction.episode && A.direction.episode.why, 'project_stalled');
  // markProductive (§1.1d) is the reset path for barrenRuns via the repeat-grading block
  // (§1.1f: `if (out === 'worked') { p.barrenRuns = 0; markProductive(s, 'repeat_project'); }`)
  // -- not directionCheck's own job, so this half is a placeholder pending that hook too.
  out.cases.push({ label: '6b: barrenRuns resets on a worked repeat run (needs the repeat-grading hook)', PASS: null, skipped: true });

  // ---- 7: no_tool edge on the A.blocked latch (proves projectDone never reads A.blocked) ----
  A.project = { skill: 'mineLane', args: {} };   // NOT blocked, NOT done -- only A.blocked says no_tool
  A.blocked = { why: 'no_tool', cls: 'pickaxe', at: Date.now() };
  resetDirection({ prevLvl: 'active' });
  check({ task: null });
  T('7: A.blocked.why===no_tool opens its own arm, independent of projectDone()',
    A.direction.episode && A.direction.episode.why, 'no_tool');

  // ---- 8: dirDispatch stale-eid -> {skipped:'stale'}, matching eid closes with closedBy ----
  A.project = null; A.blocked = null;
  resetDirection({ lastProductiveAt: Date.now() - 200000 });
  check({ task: null });
  const realEid = A.direction.episode && A.direction.episode.id;
  const staleResult = A.dirDispatch ? A.dirDispatch('not-the-real-eid', { skill: 'chopTrees', by: 'driver' }) : null;
  T('8a: dispatch with a stale/wrong eid is a no-op', staleResult && staleResult.skipped, 'stale');
  T('8b: episode is untouched by the stale dispatch', A.direction.episode && A.direction.episode.id, realEid);
  if (A.dirDispatch) A.dirDispatch(realEid, { skill: 'chopTrees', args: { count: 1 }, by: 'driver' });
  T('8c: dispatch with the REAL eid closes the episode', A.direction.episode, null);
  T('8d: closed counter incremented', A.direction.closed, 1);

  // ---- 9: fresh install stays quiet for the full grace window ----
  A.project = null; A.blocked = null;
  resetDirection({ lastProductiveAt: Date.now() });   // "just installed" -- zero quiet time
  check({ task: null });
  T('9: fresh install (lastProductiveAt=now) -> no episode, full grace window intact',
    A.direction.episode, null);

  // ---- 10: reopen backoff escalates and resets on markProductive ----
  // markProductive itself is stamped from OUTCOME-GRADED branches elsewhere in tick()
  // (§1.1d table), not directly callable here without those call sites -- exercised
  // indirectly via the reopenAt/reopenCount bookkeeping that closeEpisode (§1.1e) sets,
  // which directionCheck's own re-open path (openEpisode's cooldown guard) must respect.
  A.project = null; A.blocked = null;
  resetDirection({ lastProductiveAt: Date.now() - 200000, reopenCount: { unproductive_idle: 0 } });
  check({ task: null });   // opens episode 1
  const eid10 = A.direction.episode.id;
  if (A.dirDispatch) A.dirDispatch(eid10, { skill: 'collectDrops', by: 'driver' });   // closes -> sets reopenAt
  T('10a: reopenAt is set for this why after a close', typeof A.direction.reopenAt.unproductive_idle, 'number');
  A.direction.lastProductiveAt = Date.now() - 200000;   // immediately quiet again
  check({ task: null });
  T('10b: within the backoff window -> state is cooldown, NOT a silent no-op (no episode, but visible)',
    [A.direction.episode, A.direction.state], [null, 'cooldown']);
  out.cases.push({ label: '10c: reopen SUCCEEDS once the backoff elapses, and resets on markProductive (needs real timers or a fake clock -- not exercised here)', PASS: null, skipped: true });

  out.passed = out.cases.filter((c) => c.PASS === true).length;
  out.skipped_n = out.cases.filter((c) => c.skipped).length;
  out.failed = out.cases.filter((c) => c.PASS === false).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
  return out;
} finally {
  A.project = saved.project; A.owner = saved.owner; A.blocked = saved.blocked;
  A.nextProject = saved.nextProject; A.direction = saved.direction;
}
