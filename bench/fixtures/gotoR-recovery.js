// bench/fixtures/gotoR-recovery.js — the movement RECOVERY layer (#54, R2 rung).
//
// #54-R2 review (engine-dev-2, FEEDBACK.md) landed gotoR/_reposition as sound design with three
// required fixes (the swallowed-Cancelled bug, the telemetry sink, the branch hazard) but flagged
// that R2 has never been proven to actually RESOLVE a wedge — only to be TIME-SAFE (the total
// wall-clock bound doesn't blow the caller's budget). Same root cause as #53's original blind
// spot: _reposition's cell-selection lived only inside makeCtx's closure, so the only way to
// exercise it was to stage a genuinely wedged bot in a real world. "A rule testable only by
// staging the bug does not stay tested" (#53's own lesson) applies here too.
//
// This fixture closes HALF of that gap. findRepositionTarget (the candidate search: which
// nearby cell is safe to walk to) is now a pure function taking accessor callbacks instead of
// calling bot.blockAt/ctx.isProtected directly, so it can be replayed against a synthetic local
// grid — no world, no wedge, no bot movement. It proves the SEARCH is correct: right cell, right
// priority order, protection respected, searches downward for a dip.
//
// It does NOT and cannot prove the other half: that walking to the chosen cell and re-issuing
// the goto actually gets a genuinely wedged bot unstuck. That needs a live pathfinder against
// real terrain and is still open — see FEEDBACK.md's #54 entries for the live-fixture proposal
// (a FROZEN-class trap, not a torch/leaf-litter one — those are planner-retired, see
// bench/fixtures/wedge-torch.sh's header) and the timing analysis on why FROZEN, not
// NO_PROGRESS, is the reachable path to a `stuck` throw under real caller timeouts.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/gotoR-recovery.js '{code:$c}')" | jq .result
const S = globalThis.__skills;
const out = { engine: S.version, cases: [] };
if (!S.recoveryDetect) { out.skipped = 'no __skills.recoveryDetect — engine predates #54-R2 landing'; return out; }
const R = S.recoveryDetect;

const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const solid = { boundingBox: 'block', name: 'stone' };
const air = { boundingBox: 'empty', name: 'air' };
const noProtect = () => false;
const grid = (map) => (x, y, z) => map[`${x},${y},${z}`] || air;

// --- 1. flat ground: the FIRST offset in priority order wins ---
{
  const bx = 0, by = 64, bz = 0;
  const map = {};
  for (const [dx, dz] of R.offsets) for (let y = by - 3; y <= by + 2; y++) {
    map[`${bx + dx},${y},${bz + dz}`] = (y === by - 1) ? solid : air;
  }
  const r = R.findRepositionTarget(bx, by, bz, grid(map), noProtect);
  T('flat ground on every offset -> the first in priority order wins', r && [r.dx, r.dz, r.y], [2, 0, by]);
}

// --- 2. the best-priority offset has no floor at all -> falls through to the next ---
{
  const bx = 0, by = 64, bz = 0;
  const map = {};
  for (let y = by - 4; y <= by + 2; y++) map[`2,${y},0`] = air;   // void under [2,0]
  for (let y = by - 3; y <= by + 2; y++) map[`-2,${y},0`] = (y === by - 1) ? solid : air;
  const r = R.findRepositionTarget(bx, by, bz, grid(map), noProtect);
  T('no floor at the best offset -> falls through to the next one', r && [r.dx, r.dz, r.y], [-2, 0, by]);
}

// --- 3. a geometrically valid cell that is PROTECTED must be skipped ---
{
  const bx = 0, by = 64, bz = 0;
  const map = {};
  for (const [dx, dz] of R.offsets) for (let y = by - 3; y <= by + 2; y++) {
    map[`${bx + dx},${y},${bz + dz}`] = (y === by - 1) ? solid : air;
  }
  const blockAt = (x, y, z) => {
    const b = map[`${x},${y},${z}`] || air;
    return { ...b, position: { x, y, z } };
  };
  const isProtected = (pos) => pos.x === 2 && pos.z === 0 && pos.y === by - 1;
  const r = R.findRepositionTarget(bx, by, bz, blockAt, isProtected);
  T('protected floor at the best offset -> skipped, next candidate used', r && [r.dx, r.dz], [-2, 0]);
}

// --- 4. a one-deep dip: the search must scan DOWNWARD, not just the bot's own y ---
{
  const bx = 0, by = 64, bz = 0;
  const map = {
    [`2,${by - 2},0`]: solid, [`2,${by - 1},0`]: air, [`2,${by},0`]: air, [`2,${by + 1},0`]: air,
  };
  const r = R.findRepositionTarget(bx, by, bz, grid(map), noProtect);
  T('one-deep dip below the bot is still found', r && [r.dx, r.dz, r.y], [2, 0, by - 1]);
}

// --- 5. nowhere safe (void on every offset) -> null, not a crash / not a bad target ---
{
  const bx = 0, by = 64, bz = 0;
  const r = R.findRepositionTarget(bx, by, bz, () => air, noProtect);
  T('no standable cell anywhere in range -> null (never a bad target)', r, null);
}

// --- 6. the priority order itself is the documented one (a silent reorder is a behaviour change) ---
T('offset priority order matches the documented one', R.offsets,
  [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]);

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
return out;
