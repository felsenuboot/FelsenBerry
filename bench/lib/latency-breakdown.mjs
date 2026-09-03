// bench/lib/latency-breakdown.mjs — metrics.mjs --direction-gate's latency attribution (task 2,
// 2026-09-03, engine-dev/QA lane). The single open->close `latency_ms` metrics.mjs already
// grades is exactly why soak #4's own attribution (driver-grace bug vs Andy slowness) had to be
// done by hand, reading AGENDA_EVENT lines against decisions.jsonl. This joins each CLOSED
// episode's direction open/close ledger records to every decisions.jsonl record sharing its eid
// (there can be more than one — a same-eid llm-miss retry, or a skipped_frozen_repeat/
// skipped_cap attempt before the winning one) and splits the total into buckets a future soak's
// p50/p90 can be attributed against directly, instead of hand-reading logs:
//
//   - timeToFirstAttemptMs: open -> the FIRST decisions.jsonl record for this eid, of ANY src
//     including skips. Captures driver-grace + poll-interval + per-bot-gap waits BEFORE the
//     decider ever looked at this episode — exactly soak #4's own p50 bug's shape (re-run on
//     soak #4's real data: timeToFirstAttempt p50 == the graded latency_p50_ms EXACTLY, 76456ms
//     — the entire p50 floor was structural wait-before-first-attempt, zero decider compute).
//   - deciderComputeMs: sum of every attempt's own `latency_ms` (0 for a rule hit, the real
//     Ollama call duration for an llm attempt) — pure decision-making time, already in the
//     existing decisions.jsonl schema, no new field needed.
//   - interAttemptGapMs: wall-clock time between attempts NOT accounted for by any attempt's
//     own recorded busy time (compute + dispatch) — the rate-gate retry wait soak #4's own p90
//     was actually made of (PER_BOT_MIN_GAP_MS, before TODO 4b's fix). Computed directly from
//     consecutive attempt timestamps; no new field needed.
//   - dispatchMs / standDownCarryoverMs: landed 2026-09-03 (decider.js commit 872aa07 times its
//     own dirDispatch call; agenda.js's open-event dirEmit reports an inherited standDown,
//     TODO 5d / test-driver's run-#6 finding: a 128665ms "latency" that was standdown
//     carryover, not decider slowness) — both were coordinated with engine-dev-3 before this
//     file relied on either. Still report `null` — not 0 — on any record/episode from BEFORE
//     that commit, or on a `src` that never reaches the dispatch step (dedup/rate-gate/
//     frozen_repeat/driver-grace skips): a missing field is not a verified zero, this
//     codebase's own doctrine, and it also means 5d's own fix (A.setProject resets the
//     standdown the moment a fresh redirect lands) should make standDownCarryoverMs mostly
//     read null/0 going forward — a non-null value now specifically flags 5d's OLD failure
//     mode recurring, not a permanent feature of every open (per eng-3's own note).
//   - selfRecoveredStallMs: an episode that closes `closedBy:'self_recovered'` with ZERO
//     decisions.jsonl attempts was never touched by the decider at all — the agenda LADDER
//     recovered on its own (markProductive()). That is not automatically "fine": task 3's own
//     live find (#117, FEEDBACK.md "EAT/EAT_CRITICAL can permanently deadlock...") is exactly
//     this shape — a rung latches on a dead end (fire() false, clear() also false) and NOTHING
//     resolves it until an unrelated event (there: SHELTER's nightfall trigger) knocks it
//     loose, at which point the stuck rung finally releases and whatever was actually needed
//     (there: FOOD) runs and closes the episode self_recovered — 146113ms after it opened, not
//     because of decider slowness (the decider was never involved) or a PROJECT standdown
//     (different rung entirely), but because the LADDER itself was wedged. Computed as
//     whatever standDownCarryoverMs doesn't already explain on a no-attempts self_recovered
//     close — re-homed OUT of unattributedMs (which reads 0 for that episode) rather than left
//     generic, so a future soak's grader can name this specific, previously-diagnosed failure
//     mode instead of re-discovering it by hand every time it recurs.
//   - unattributedMs: whatever NONE of the above buckets cover, so the breakdown is always
//     honest about what it genuinely can't yet explain rather than silently absorbing it into
//     a bucket that happens to still be computable.
//
// Pure functions, no fs/network — bench/fixtures/latency-breakdown.mjs tests this hermetically
// with synthetic open/close/decisions records; metrics.mjs imports the same code for real runs.

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// open: {eid,t,standDown?:{rung,until}} | close: {eid,t,why,closedBy,latency_ms}
// attempts: decisions.jsonl records sharing this eid, ANY order (sorted internally):
//   {t, latency_ms?, dispatch_ms?}
export function computeEpisodeBreakdown(open, close, attempts) {
  const sorted = (attempts || []).slice().sort((a, b) => a.t - b.t);
  const first = sorted[0] || null;
  const timeToFirstAttemptMs = first ? Math.max(0, first.t - open.t) : null;
  const deciderComputeMs = sorted.length
    ? sorted.reduce((n, a) => n + (Number.isFinite(a.latency_ms) ? a.latency_ms : 0), 0) : null;
  const dispatchAttempts = sorted.filter((a) => Number.isFinite(a.dispatch_ms));
  const dispatchMs = dispatchAttempts.length ? dispatchAttempts.reduce((n, a) => n + a.dispatch_ms, 0) : null;
  let interAttemptGapMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevBusyMs = (Number.isFinite(sorted[i - 1].latency_ms) ? sorted[i - 1].latency_ms : 0)
      + (Number.isFinite(sorted[i - 1].dispatch_ms) ? sorted[i - 1].dispatch_ms : 0);
    interAttemptGapMs += Math.max(0, (sorted[i].t - sorted[i - 1].t) - prevBusyMs);
  }
  const standDownCarryoverMs = (open.standDown && Number.isFinite(open.standDown.until))
    ? Math.max(0, Math.min(open.standDown.until, close.t) - open.t) : null;
  const accountedMs = [timeToFirstAttemptMs, deciderComputeMs, dispatchMs, interAttemptGapMs, standDownCarryoverMs]
    .filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const leftoverMs = Number.isFinite(close.latency_ms) ? Math.max(0, close.latency_ms - accountedMs) : null;
  // self_recovered + zero decider attempts = the decider never touched this episode; the
  // ladder recovered on its own. Whatever standDownCarryover doesn't already explain gets
  // named selfRecoveredStallMs instead of falling into the generic unattributed bucket -- see
  // this file's own header comment for why (#117's EAT/EAT_CRITICAL dead-end, task 3).
  const isSelfRecoveredDeadEnd = close.closedBy === 'self_recovered' && sorted.length === 0 && leftoverMs != null;
  const selfRecoveredStallMs = isSelfRecoveredDeadEnd ? Math.round(leftoverMs) : null;
  return {
    eid: close.eid, why: close.why, closedBy: close.closedBy, attempts: sorted.length, totalLatencyMs: close.latency_ms,
    timeToFirstAttemptMs, deciderComputeMs, dispatchMs, interAttemptGapMs, standDownCarryoverMs, selfRecoveredStallMs,
    unattributedMs: leftoverMs == null ? null : Math.round(isSelfRecoveredDeadEnd ? 0 : leftoverMs),
  };
}

function bucketStats(perEpisode, key) {
  const vals = perEpisode.map((e) => e[key]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return { n: 0, p50_ms: null, p90_ms: null };
  return { n: vals.length, p50_ms: median(vals), p90_ms: vals[Math.min(vals.length - 1, Math.ceil(0.9 * vals.length) - 1)] };
}

// opens/closes: direction ledger records (any order — matched by eid). decisions: the
// full decisions.jsonl array (any bots/eids — filtered here by eid membership in closes).
export function aggregateLatencyBreakdown(opens, closes, decisions) {
  const decisionsByEid = new Map();
  for (const d of decisions || []) {
    if (!decisionsByEid.has(d.eid)) decisionsByEid.set(d.eid, []);
    decisionsByEid.get(d.eid).push(d);
  }
  const perEpisode = closes
    .map((c) => {
      const open = opens.find((o) => o.eid === c.eid);
      if (!open || !Number.isFinite(c.latency_ms)) return null;
      return computeEpisodeBreakdown(open, c, decisionsByEid.get(c.eid) || []);
    })
    .filter(Boolean);
  return {
    perEpisode,
    aggregate: {
      timeToFirstAttempt: bucketStats(perEpisode, 'timeToFirstAttemptMs'),
      deciderCompute: bucketStats(perEpisode, 'deciderComputeMs'),
      dispatch: bucketStats(perEpisode, 'dispatchMs'),
      interAttemptGap: bucketStats(perEpisode, 'interAttemptGapMs'),
      standDownCarryover: bucketStats(perEpisode, 'standDownCarryoverMs'),
      selfRecoveredStall: bucketStats(perEpisode, 'selfRecoveredStallMs'),
      unattributed: bucketStats(perEpisode, 'unattributedMs'),
    },
    pendingFields: {
      dispatch_ms: 'landed 2026-09-03 (decider.js commit 872aa07) -- null on records from before that commit, or on a src that never reaches the dispatch step (dedup/rate-gate/frozen_repeat/driver-grace skips)',
      standDown: 'landed 2026-09-03 (agenda.js commit 872aa07) -- null on episodes opened before that commit, or (increasingly, post-5d) whenever nothing was actually inherited',
    },
  };
}
