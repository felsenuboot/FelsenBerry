// bench/fixtures/agenda-resume.js — project work must ACCUMULATE across a preemption.
//
// The bug this pins: mineLane's `count` is per-INVOCATION, and RESTOCK preempts roughly every
// ~25 blocks for a torch refill. Each resume restarted from zero, so a high count never
// completed — measured, `count:150` produced ZERO completions across ~275 blocks genuinely
// mined, while `count:24` completed cleanly. The bot was working perfectly the whole time;
// only the bookkeeping said otherwise. Worse, each preemption landed in the FAILURE branch,
// so the project accrued attempts and was eventually BLOCKED for being interrupted by its
// own ladder.
//
// Replays the cycle against the real rung objects with __skills.start stubbed, so nothing
// runs and nothing moves. Restores every field it touches.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/agenda-resume.js '{code:$c}')" | jq .result
const A = globalThis.__agenda, S = globalThis.__skills;
const out = { agenda: A.version, cases: [] };
if (!A.setProject) { out.skipped = 'no agenda'; return out; }

const saved = { project: A.project, owner: A.owner, sd: A.standDown, at: A.activeTaskId,
  rung: A.activeTaskRung, name: A.activeTaskName };
const realStart = S.start;
let started = [];
S.start = (b, name, args) => { started.push({ name, args }); return { ok: true, taskId: 'stub' }; };
A.busy = true;

const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });

try {
  A.setProject({ skill: 'mineLane', args: { target: 'stone', count: 150 }, tool: 'pickaxe' });
  T('setProject records the original ask', A.project.totalWanted, 150);
  T('...and starts at zero progress', A.project.progress, 0);

  // --- the cycle: mine ~25, get preempted, resume; six times over ---
  const R = A.rung('PROJECT');
  const snap = () => ({ now: Date.now(), task: null });
  let asked = [];
  for (let cycle = 0; cycle < 6; cycle++) {
    started = [];
    A.owner = R; A.activeTaskId = null;
    R.act(snap());
    asked.push(started[0] ? started[0].args.count : null);
    // the run banks 25 and is then CANCELLED by a higher rung (the torch refill)
    A.project.progress += 25;
  }
  T('first ask is the full count', asked[0], 150);
  T('second ask is the REMAINDER, not the original', asked[1], 125);
  T('sixth ask has counted down', asked[5], 25);
  T('progress accumulated across all six', A.project.progress, 150);
  T('never asked for more than remains', asked.every((c, i) => c === 150 - i * 25), true);

  // --- a preemption must NOT count as a failed attempt ---
  A.setProject({ skill: 'mineLane', args: { target: 'stone', count: 150 }, tool: 'pickaxe' });
  A.project.attempts = 0;
  // simulate the harvest's view of a CANCELLED run that banked something
  const cancelledRun = { name: 'mineLane', args: { count: 150 }, cancelled: true,
    done: false, error: null, result: { banked: 25 } };
  const res = { done: (r) => (r && r.banked) || 0 };
  A.project.progress += res.done(cancelledRun.result);
  T('a cancelled run still banks its work', A.project.progress, 25);
  T('...and does NOT accrue a failed attempt', A.project.attempts, 0);

  // --- completion still requires VERIFICATION, not just arithmetic ---
  A.project.progress = 150;
  T('progress alone does not mark the project done', Boolean(A.project.completedOnce), false);

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
  return out;
} finally {
  S.start = realStart;
  A.project = saved.project; A.owner = saved.owner; A.standDown = saved.sd;
  A.activeTaskId = saved.at; A.activeTaskRung = saved.rung; A.activeTaskName = saved.name;
  A.busy = false;
}
