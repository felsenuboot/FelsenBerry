// bench/fixtures/latency-breakdown.mjs — bench/lib/latency-breakdown.mjs (metrics.mjs
// --direction-gate's latency attribution, task 2, 2026-09-03). PURE NODE, hermetic: synthetic
// direction open/close records + decisions.jsonl records in, breakdown out. No ledger, no live
// bot — same doctrine as trail-vacuous.mjs / vitals-floor.mjs.
//
// Run:  node bench/fixtures/latency-breakdown.mjs
import { computeEpisodeBreakdown, aggregateLatencyBreakdown } from '../lib/latency-breakdown.mjs';

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const S = 1000; // 1 second, for readable deltas
const t0 = 1_800_000_000_000;

// ---- 1. soak #4's own real shape: a driver-grace-keyed delay (~76s) before the FIRST attempt,
// a fast rule/llm decision, and no retries -- reproduces the graded p50 EXACTLY. ----
{
  const open = { eid: 'e1', t: t0 };
  const close = { eid: 'e1', t: t0 + 76 * S + 5 * S, why: 'unproductive_idle', closedBy: 'decider', latency_ms: 76 * S + 5 * S };
  const attempts = [{ t: t0 + 76 * S, latency_ms: 5 * S }]; // one rule/llm attempt, no dispatch_ms yet
  const r = computeEpisodeBreakdown(open, close, attempts);
  T('soak-4 shape: timeToFirstAttemptMs is the whole driver-grace/poll wait', r.timeToFirstAttemptMs, 76 * S);
  T('soak-4 shape: deciderComputeMs is just the attempt\'s own latency_ms', r.deciderComputeMs, 5 * S);
  T('soak-4 shape: dispatchMs is null (field not yet emitted), not 0', r.dispatchMs, null);
  T('soak-4 shape: interAttemptGapMs is 0 (only one attempt, nothing to gap)', r.interAttemptGapMs, 0);
  T('soak-4 shape: standDownCarryoverMs is null (no open.standDown), not 0', r.standDownCarryoverMs, null);
  T('soak-4 shape: unattributedMs is 0 (first-attempt + compute fully explains the total)', r.unattributedMs, 0);
}

// ---- 2. a retry: a same-eid llm-miss attempt, then a PER_BOT_MIN_GAP_MS-shaped wait, then the
// winning attempt -- the soak-4 p90 shape (215s episodes). ----
{
  const open = { eid: 'e2', t: t0 };
  const attempt1 = { t: t0 + 20 * S, latency_ms: 2 * S }; // first attempt: llm miss, fast call
  const attempt2 = { t: t0 + 20 * S + 2 * S + 120 * S, latency_ms: 4 * S }; // retry after the 120s gap
  const close = { eid: 'e2', t: attempt2.t, why: 'unproductive_idle', closedBy: 'decider', latency_ms: attempt2.t - t0 };
  const r = computeEpisodeBreakdown(open, close, [attempt2, attempt1]); // deliberately unsorted input
  T('retry shape: timeToFirstAttemptMs is the wait to the FIRST attempt, not the winning one', r.timeToFirstAttemptMs, 20 * S);
  T('retry shape: deciderComputeMs sums BOTH attempts\' compute time', r.deciderComputeMs, 2 * S + 4 * S);
  T('retry shape: interAttemptGapMs isolates the 120s rate-gate wait between attempts', r.interAttemptGapMs, 120 * S);
  T('retry shape: attempts count is 2', r.attempts, 2);
  T('retry shape: fully accounted, nothing unattributed', r.unattributedMs, 0);
}

// ---- 3. forward-looking fields present: dispatch_ms and standDown both supplied ----
{
  const open = { eid: 'e3', t: t0, standDown: { rung: 'PROJECT', until: t0 + 30 * S } };
  const attempt = { t: t0 + 5 * S, latency_ms: 1 * S, dispatch_ms: 300 };
  const close = { eid: 'e3', t: t0 + 5 * S + 1 * S + 300 + 24.7 * S, why: 'project_stalled', closedBy: 'decider', latency_ms: t0 + 5 * S + 1 * S + 300 + 24.7 * S - t0 };
  const r = computeEpisodeBreakdown(open, close, [attempt]);
  T('with dispatch_ms supplied: dispatchMs reads it directly, no longer null', r.dispatchMs, 300);
  T('with standDown supplied: standDownCarryoverMs is min(until,close.t)-open.t (streak fully inside the episode)', r.standDownCarryoverMs, 30 * S);
}

// ---- 4. standDown.until falls AFTER close.t (the rung was still cooling down when the
// episode closed) -- carryover is capped at the episode's own span, never overstated ----
{
  const open = { eid: 'e4', t: t0, standDown: { rung: 'PROJECT', until: t0 + 1000 * S } };
  const close = { eid: 'e4', t: t0 + 10 * S, why: 'project_stalled', closedBy: 'decider', latency_ms: 10 * S };
  const r = computeEpisodeBreakdown(open, close, [{ t: t0 + 10 * S, latency_ms: 0 }]);
  T('standDown outlives the episode -> carryover capped at the episode\'s own 10s span, not the full 1000s', r.standDownCarryoverMs, 10 * S);
}

// ---- 5. no attempts at all, closed some OTHER way than self_recovered (e.g. decider_exhausted)
// -- the generic unattributed case, NOT the named selfRecoveredStallMs shape ----
{
  const open = { eid: 'e5', t: t0 };
  const close = { eid: 'e5', t: t0 + 3 * S, why: 'unproductive_idle', closedBy: 'decider_exhausted', latency_ms: 3 * S };
  const r = computeEpisodeBreakdown(open, close, []);
  T('decider_exhausted, no attempts recorded here -> first-attempt/compute/dispatch/gap all null',
    [r.timeToFirstAttemptMs, r.deciderComputeMs, r.dispatchMs, r.interAttemptGapMs], [null, null, null, 0]);
  T('decider_exhausted: not the self_recovered shape -> selfRecoveredStallMs stays null', r.selfRecoveredStallMs, null);
  T('decider_exhausted: the whole 3s stays generically unattributed', r.unattributedMs, 3 * S);
}

// ---- 5b. #117's own real shape: self_recovered, zero decider attempts, a long stall -- this
// IS the ladder-stuck-not-decider case task 3 found (dmtlcay1e1, 146113ms) ----
{
  const open = { eid: 'e5b', t: t0 };
  const close = { eid: 'e5b', t: t0 + 146.113 * S, why: 'unproductive_idle', closedBy: 'self_recovered', latency_ms: 146113 };
  const r = computeEpisodeBreakdown(open, close, []);
  T('#117 shape: self_recovered + zero attempts -> the whole stall is named selfRecoveredStallMs', r.selfRecoveredStallMs, 146113);
  T('#117 shape: re-homed OUT of the generic bucket -> unattributedMs reads 0, not 146113', r.unattributedMs, 0);
}

// ---- 5c. self_recovered with an inherited standDown too (5d's old failure mode STACKED with
// #117's) -- standDownCarryover is subtracted first, only the true remainder is named ----
{
  const open = { eid: 'e5c', t: t0, standDown: { rung: 'PROJECT', until: t0 + 20 * S } };
  const close = { eid: 'e5c', t: t0 + 50 * S, why: 'unproductive_idle', closedBy: 'self_recovered', latency_ms: 50 * S };
  const r = computeEpisodeBreakdown(open, close, []);
  T('standDown carryover is subtracted first (20s)', r.standDownCarryoverMs, 20 * S);
  T('only the remainder (30s) is named selfRecoveredStallMs, not the full 50s', r.selfRecoveredStallMs, 30 * S);
  T('unattributedMs still reads 0 -- both known buckets together explain the whole 50s', r.unattributedMs, 0);
}

// ---- 5d. self_recovered but the decider DID make at least one attempt -- not a ladder dead
// end (the decider was involved), so it must NOT be mistaken for #117's shape ----
{
  const open = { eid: 'e5d', t: t0 };
  const close = { eid: 'e5d', t: t0 + 40 * S, why: 'unproductive_idle', closedBy: 'self_recovered', latency_ms: 40 * S };
  const r = computeEpisodeBreakdown(open, close, [{ t: t0 + 5 * S, latency_ms: 1 * S }]);
  T('self_recovered WITH a decider attempt -> not the ladder-dead-end shape, selfRecoveredStallMs stays null', r.selfRecoveredStallMs, null);
}

// ---- 6. aggregateLatencyBreakdown: joins by eid, skips an episode with no matching open,
// computes p50/p90 per bucket, reports pendingFields ----
{
  const opens = [{ eid: 'a', t: t0 }, { eid: 'b', t: t0 }];
  const closes = [
    { eid: 'a', t: t0 + 10 * S, why: 'x', closedBy: 'decider', latency_ms: 10 * S },
    { eid: 'b', t: t0 + 30 * S, why: 'x', closedBy: 'decider', latency_ms: 30 * S },
    { eid: 'orphan-no-open', t: t0 + 5 * S, why: 'x', closedBy: 'decider', latency_ms: 5 * S },
  ];
  const decisions = [
    { eid: 'a', t: t0 + 4 * S, latency_ms: 1 * S },
    { eid: 'b', t: t0 + 20 * S, latency_ms: 2 * S },
  ];
  const agg = aggregateLatencyBreakdown(opens, closes, decisions);
  T('orphan close with no matching open is skipped, not crashed on', agg.perEpisode.length, 2);
  T('timeToFirstAttempt p50 across the two episodes (4s, 20s) is their median', agg.aggregate.timeToFirstAttempt.p50_ms, 12 * S);
  T('pendingFields documents both dispatch_ms/standDown by name (their null-before-this-commit caveat)', Object.keys(agg.pendingFields).sort(), ['dispatch_ms', 'standDown']);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
