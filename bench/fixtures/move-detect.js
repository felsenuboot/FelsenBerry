// bench/fixtures/move-detect.js — the movement DETECTION layer (#53).
//
// The blind spot this exists to keep closed: the old watchdog asked "am I MOVING", resetting
// its timer on 0.4 blocks of displacement. A bot thrashing in place satisfies that forever, so
// it only ever caught FROZEN bots. The field signature it missed is on record — `pf:{partial:
// 416}` with zero successes, ~17 blocks moved, going nowhere, ten times in a row. The bot was
// moving the entire time. The rule is now "am I getting CLOSER": a new best distance to the
// goal. A thrashing bot never sets one and neither does a frozen one, so one rule catches both.
//
// Hermetic: replays synthetic position series against synthetic goals through
// `__skills.moveDetect`. Stages no wedge, moves nothing, needs no world — which is the whole
// point, because a detector that can only be tested by reproducing a wedge does not stay tested.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/move-detect.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { engine: S.version, cases: [] };
if (!S.moveDetect) { out.skipped = 'no __skills.moveDetect — engine predates #53'; return out; }
const M = S.moveDetect;

const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });

// --- the watchdog: progress, not movement ---
// a series walking steadily toward the goal is healthy however long it runs
const approach = [];
for (let i = 0; i <= 20; i++) approach.push({ t: i * 1000, x: 20 - i, y: 64, z: 0 });
T('steady approach -> not stalled', M.progress({ x: 0, y: 64, z: 0 }, approach).stalled, false);

// THE REGRESSION: oscillating in place. Moves constantly, never gets closer.
const thrash = [];
for (let i = 0; i <= 30; i++) thrash.push({ t: i * 1000, x: 20 + (i % 2), y: 64, z: 0 });
const thr = M.progress({ x: 0, y: 64, z: 0 }, thrash);
T('THRASHING in place -> STALLED (the old rule missed this)', thr.stalled, true);
T('...classified as no_progress, not frozen', thr.reason, 'no_progress');
T('...and it really was moving the whole time', thr.totalMoved > 15, true);

// frozen: the case the old rule did catch, which must keep working
const frozen = [];
for (let i = 0; i <= 20; i++) frozen.push({ t: i * 1000, x: 20, y: 64, z: 0 });
T('frozen -> stalled', M.progress({ x: 0, y: 64, z: 0 }, frozen).stalled, true);
T('...classified as frozen', M.progress({ x: 0, y: 64, z: 0 }, frozen).reason, 'frozen');

// creeping toward the goal below the epsilon is NOT progress
const creep = [];
for (let i = 0; i <= 30; i++) creep.push({ t: i * 1000, x: 20 - i * 0.05, y: 64, z: 0 });
T('sub-epsilon creep -> stalled', M.progress({ x: 0, y: 64, z: 0 }, creep).stalled, true);

// approaching then wedging: stalls from the wedge, not from the start
const mixed = [];
for (let i = 0; i <= 10; i++) mixed.push({ t: i * 1000, x: 20 - i, y: 64, z: 0 });
for (let i = 1; i <= 10; i++) mixed.push({ t: (10 + i) * 1000, x: 10, y: 64, z: 0 });
const mx = M.progress({ x: 0, y: 64, z: 0 }, mixed);
T('approach then wedge -> stalled', mx.stalled, true);
T('...stall measured from the wedge (~10s), not the run', mx.frozenMs === 10000, true);

// THE FALSE-POSITIVE GUARD: a legitimate detour AROUND an obstacle moves AWAY from the goal
// for a while. It must not be called stuck — which is why no-progress gets a generous window
// and frozen keeps the tight one. A single 6s timer on goal-distance would fail this case.
const detour = [];
for (let i = 0; i <= 13; i++) detour.push({ t: i * 1000, x: 20, y: 64, z: i });      // sideways 13s
for (let i = 1; i <= 8; i++) detour.push({ t: (13 + i) * 1000, x: 20 - i, y: 64, z: 13 });
T('13s detour around an obstacle -> NOT stalled', M.progress({ x: 0, y: 64, z: 0 }, detour).stalled, false);

// a goal with no y (GoalXZ/GoalNearXZ) must be measured in the PLANE it cares about, or a
// legitimately-high bot reads as "far" and a descent reads as progress it did not make
const highXZ = [];
for (let i = 0; i <= 20; i++) highXZ.push({ t: i * 1000, x: 20 - i, y: 200, z: 0 });
T('XZ goal ignores y -> approach at altitude is progress',
  M.progress({ x: 0, z: 0 }, highXZ).stalled, false);
T('XZ goal is measured in the plane', M.progress({ x: 0, z: 0 }, highXZ).measuredBy, 'goal-distance');

// no readable position -> fall back to displacement (strictly the old behaviour), never invent one
T('goal with no coords -> falls back to displacement', M.progress({}, approach).measuredBy, 'displacement');
T('...and a displacing bot is not stalled there', M.progress({}, approach).stalled, false);

// --- _unstick: a property test, not a hardcoded list ---
T('leaf_litter (the original specimen) -> cleared',
  M.wouldClear({ name: 'leaf_litter', diggable: true, boundingBox: 'empty' }), true);
T('cobweb -> cleared, though no list ever named it',
  M.wouldClear({ name: 'cobweb', diggable: true, boundingBox: 'empty' }), true);
T('snow layer -> cleared', M.wouldClear({ name: 'snow', diggable: true, boundingBox: 'empty' }), true);
T('STONE -> never (a stall is not a licence to tunnel)',
  M.wouldClear({ name: 'stone', diggable: true, boundingBox: 'block' }), false);
T('air -> nothing to dig', M.wouldClear({ name: 'air', diggable: true, boundingBox: 'empty' }), false);
T('bedrock -> not diggable', M.wouldClear({ name: 'bedrock', diggable: false, boundingBox: 'block' }), false);

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
return out;
