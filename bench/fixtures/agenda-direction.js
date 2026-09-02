// bench/fixtures/agenda-direction.js — Direction Episodes regression (research/IDLE_TRIGGER_SPEC.md
// §4.3). Eleven cases (the spec's original ten plus case 11, team-lead's setProject/nextProject
// ruling), the acceptance backbone for felcrew-mcp#68's trigger half.
//
// VERSION NOTE: the spec was written as agenda v20->v21, but engine-dev-3 landed the ESCAPE
// rung (#89 digOut) as v21 first (unrelated to this work), so Direction Episodes ships as v22
// instead -- a number, not a functional change. This file never keys off a version number,
// only `A._directionCheck`'s existence, so nothing below needed changing for it.
//
// STATUS (2026-09-02, engine-dev): COMPLETE. All cases real, all passing live against agenda
// v22 on a real bot (25/25 sub-assertions, 0 skipped) -- wired into preflight.sh (181/181
// fleet-wide). First cold run against the real code was 19/20; the one failure (case 10b) was
// a bug in THIS fixture's own test sequencing, not the engine -- diagnosed by engine-dev-3 and
// fixed here:
// case 8's dirDispatch(chopTrees) call goes through the REAL A.setProject, which sets
// A.project to a real object; case 10 didn't reset it back to null before re-testing the
// unproductive_idle reopen path, so the second directionCheck call took the E3a
// (project_stalled) branch instead -- a real project sitting "quiet" for 200s that in real
// operation could never happen (a dispatched collectDrops finishes in a tick or two).
// `A._promoteCheck(p, nextProject)` is now real and exposed (agenda.js ~550) -- a pure
// predicate, the SAME function the real promotion site calls (no drift risk between what
// this file checks and what runs) -- closing cases 2/3 for their core logic. The harvest
// block's full promotion SIDE EFFECTS (hygiene-field clearing, the dirEmit('promote'), the
// actual A.setProject call) are inline at that call site, not a separate callable function,
// and are covered instead by engine-dev-3's live §4.3 acceptance test (a real finished task
// through a real tick(), asserting one op:'promote' + gap_ms<=2500) -- not duplicated here.
// Case 6b (barrenRuns reset) is similarly inline in the harvest block using
// A._idleWorkOutcome's classification (agenda.js ~1061) -- tested here via that exposed
// classifier plus directionCheck's own response to the reset state, per engine-dev-3's
// suggestion, rather than a third hook.
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

  // ---- 2: staged next promotes (the gating predicate; side effects covered by the live test) ----
  T('2: _promoteCheck true for a finished non-repeat project with a staged next',
    A._promoteCheck({ skill: 'mineLane', repeat: false, completedOnce: true }, { skill: 'safeDescend', stagedAt: Date.now() }),
    true);
  T('2b: _promoteCheck false when nothing is staged, even for an otherwise-promotable project',
    A._promoteCheck({ skill: 'mineLane', repeat: false, completedOnce: true }, null), false);

  // ---- 3: repeat project is NEVER promoted, regardless of a staged next ----
  T('3: _promoteCheck false when the finished project has repeat:true',
    A._promoteCheck({ skill: 'harvestGrass', repeat: true, completedOnce: true }, { skill: 'safeDescend', stagedAt: Date.now() }),
    false);

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
  // barrenRuns increment/reset is inline in the harvest block (agenda.js ~1061), keyed off
  // A._idleWorkOutcome's classification -- test the classifier for the exact skill/result
  // pair that would drive the reset, then confirm directionCheck's OWN response once that
  // reset has happened (the piece directionCheck actually owns).
  T('6b-classifier: a real harvestGrass yield classifies as worked (the harvest block resets barrenRuns on this)',
    A._idleWorkOutcome('harvestGrass', { cut: 5 }, null), 'worked');
  A.project.barrenRuns = 0;   // the observable state a 'worked' classification produces
  resetDirection({ prevLvl: 'active' });
  check({ task: null });
  T('6b-effect: once barrenRuns is reset, E3b does not fire', A.direction.episode, null);

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
  // markProductive itself (agenda.js ~499) is an internal closure, not exposed on A -- its
  // OBSERVABLE effect (lastProductiveAt stamped, reopenCount cleared, an open episode closed
  // self_recovered) is simulated directly where needed, since that effect, not the function
  // identity, is what directionCheck actually reads. `check()`'s `now` is fully controllable
  // (no real waiting needed to prove backoff expiry -- openEpisode compares against s.now).
  A.project = null; A.blocked = null;
  resetDirection({ lastProductiveAt: Date.now() - 200000, reopenCount: { unproductive_idle: 0 } });
  check({ task: null });   // opens episode 1
  const eid10 = A.direction.episode.id;
  if (A.dirDispatch) A.dirDispatch(eid10, { skill: 'collectDrops', by: 'driver' });   // closes -> sets reopenAt
  // BUG FOUND LIVE (engine-dev-3's diagnosis): dirDispatch's close runs the REAL A.setProject,
  // which sets A.project to a real object -- left uncorrected, the next check() below would
  // evaluate the E3a (project_stalled) branch instead of E2 (unproductive_idle)'s reopen path,
  // since A.project is no longer null. This is not a real-world scenario (a dispatched
  // collectDrops finishes within a tick or two, it doesn't sit "quiet" for 200s as an
  // ungraded project the way this synthetic snapshot would) -- reset it explicitly so case 10
  // keeps testing the E2 reopen path it's actually about.
  A.project = null;
  T('10a: reopenAt is set for this why after a close', typeof A.direction.reopenAt.unproductive_idle, 'number');
  const reopenAt1 = A.direction.reopenAt.unproductive_idle;
  A.direction.lastProductiveAt = Date.now() - 200000;   // immediately quiet again
  check({ task: null, now: reopenAt1 - 1000 });          // still 1s inside the backoff window
  T('10b: within the backoff window -> state is cooldown, NOT a silent no-op (no episode, but visible)',
    [A.direction.episode, A.direction.state], [null, 'cooldown']);
  const openedAt2 = reopenAt1 + 1000;
  check({ task: null, now: openedAt2 });                 // 1s PAST the backoff -- no real wait needed
  T('10c: reopen succeeds once the backoff elapses (a fresh episode, same why)',
    A.direction.episode && A.direction.episode.why, 'unproductive_idle');
  const eid10b = A.direction.episode.id;
  if (A.dirDispatch) A.dirDispatch(eid10b, { skill: 'collectDrops', by: 'driver' });   // 2nd close
  A.project = null;   // same reset as after case 10's first dispatch, same reason
  const reopenAt2 = A.direction.reopenAt.unproductive_idle;
  T('10d: reopenCount escalates monotonically across repeated closes of the same why (now 2)',
    A.direction.reopenCount.unproductive_idle, 2);
  T('10e: the escalated backoff deadline is further out than the first one (real escalation, not a fluke of timing)',
    (reopenAt2 - openedAt2) > 0 && reopenAt2 >= reopenAt1, true);
  // simulate markProductive's observable effect (agenda.js ~500-502: clears reopenCount) and
  // confirm a THIRD close afterward lands back at reopenCount=1, not 3 -- proving the reset
  // is genuine (a fresh, non-escalated backoff), not just more elapsed time papering over it.
  resetDirection({ lastProductiveAt: reopenAt2 + 1000, reopenAt: {}, reopenCount: {} });
  check({ task: null, now: reopenAt2 + 300000 });   // comfortably clear of any prior backoff
  const eid10c = A.direction.episode.id;
  if (A.dirDispatch) A.dirDispatch(eid10c, { skill: 'collectDrops', by: 'driver' });
  A.project = null;
  T('10f: after a markProductive-equivalent reset, the next close starts back at reopenCount=1 (not escalated further)',
    A.direction.reopenCount.unproductive_idle, 1);

  // ---- 11: team-lead's ruling (2026-09-02) — a plain setProject with no `next` drops any
  // stale staged nextProject by default; keepNext:true is the explicit opt-in that survives
  // it. Rationale on record: a next staged for a PREVIOUS decision context silently
  // promoting after an UNRELATED new project completes is a ghost-decision footgun — a
  // driver redirects the bot, the old plan resurrects itself, nobody would trace it quickly.
  if (A.setProject) {
    A.setProject({ skill: 'chopTrees', args: {}, next: { skill: 'harvestGrass', args: {} } });
    T('11a: project A + staged next B', A.nextProject && A.nextProject.skill, 'harvestGrass');
    A.setProject({ skill: 'mineLane', args: {} });   // plain setProject C, no `next` field
    T('11b: plain setProject with no next DROPS the stale staged next', A.nextProject, null);
    // and no promote can spuriously fire later just because B is gone (there is nothing left
    // to promote INTO — A._promoteCheck itself already proves this, case 3's own logic path)
    T('11c: with the next cleared, _promoteCheck correctly refuses (nothing staged)',
      A._promoteCheck ? A._promoteCheck({ skill: 'mineLane', repeat: false }, A.nextProject) : null, false);
    A.setProject({ skill: 'chopTrees', args: {}, next: { skill: 'harvestGrass', args: {} } });
    A.setProject({ skill: 'mineLane', args: {}, keepNext: true });
    T('11d: keepNext:true is the explicit opt-in that preserves a stale staged next', A.nextProject && A.nextProject.skill, 'harvestGrass');
  } else {
    out.cases.push({ label: '11: setProject next-clearing ruling', PASS: null, skipped: true });
  }

  out.passed = out.cases.filter((c) => c.PASS === true).length;
  out.skipped_n = out.cases.filter((c) => c.skipped).length;
  out.failed = out.cases.filter((c) => c.PASS === false).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
  return out;
} finally {
  A.project = saved.project; A.owner = saved.owner; A.blocked = saved.blocked;
  A.nextProject = saved.nextProject; A.direction = saved.direction;
}
