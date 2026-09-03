// bench/lib/vitals-floor.mjs — GOAL.md criterion 3's sustained-critical-vitals floor,
// adopted 2026-09-03 (commit f4138d6) after soak #4 passed criterion 3 (zero deaths, zero
// human help) while the bot was pinned at hp10/food0 for a real, measured stretch of the
// window (see FEEDBACK.md "soak #4 criterion-3 vitals floor" for the actual duration). GOAL.md
// text: "...without driver help, and without sustained critical vitals — never hp <=6 or food
// 0 for more than 10 continuous minutes."
//
// Shared here (not inlined in humanbar4.mjs) so bench/fixtures/vitals-floor.mjs can test the
// streak-detection logic hermetically — pure data in, pure verdict out, no ledger/CLI/network.
//
// HP-anchor note, flagged as asked rather than silently resolved: survival.js does NOT have a
// single "critical HP" number to align with — it has TWO, for two different subsystems: `CRIT
// = 4` (its BREAK_LOS search-deadline shortcut) and `hpPanic: 8` (the dangerscan-absent reflex
// backstop's default trigger). GOAL.md's hp<=6 sits BETWEEN them and matches neither — it was
// anchored on humanbar4.mjs's OWN pre-existing CAVEAT threshold (this file's predecessor,
// itself apparently picked independently of survival.js), not derived from either survival.js
// number. Not resolved here: a GRADING criterion ("should this run count as safe") and an
// in-engine REFLEX trigger ("should the bot itself react right now") are legitimately allowed
// to answer at different thresholds, so exact alignment isn't obviously the correct fix either
// — this is the lead's call, reported so it's visible, not decided unilaterally.
export const CRITICAL_HP = 6;
export const CRITICAL_SUSTAIN_MS = 10 * 60 * 1000; // 10 minutes — "more than 10", strictly

// vitalsSeries: [{t, hp, food}, ...], any order. Returns {sustained, streaks, worst}:
//  - streaks: every maximal run of CONSECUTIVE vitals-bearing samples that are all critical
//    (hp<=CRITICAL_HP || food===0), each {start,end,samples,durationMs}.
//  - worst: the longest streak (or null if there were no critical samples at all).
//  - sustained: true iff worst.durationMs > CRITICAL_SUSTAIN_MS (strictly more than 10 min).
// Duration is measured strictly between a streak's FIRST and LAST sample — a lower bound,
// never extrapolated past the data (no claim about what happened between samples, before the
// first one, or after the last one even if the caller's own window end is later) — same
// "never claim more than the data shows" doctrine as humanbar4.mjs's pre-existing single-
// reading vitalsCritical caveat and trail.mjs's vacuous flag.
export function detectSustainedCriticalVitals(vitalsSeries) {
  const sorted = (vitalsSeries || [])
    .filter((r) => r && typeof r.hp === 'number' && typeof r.food === 'number' && Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  const isCritical = (r) => r.hp <= CRITICAL_HP || r.food === 0;

  const streaks = [];
  let cur = null;
  for (const r of sorted) {
    if (isCritical(r)) {
      if (!cur) cur = { start: r.t, end: r.t, samples: 1 };
      else { cur.end = r.t; cur.samples++; }
    } else if (cur) { streaks.push(cur); cur = null; }
  }
  if (cur) streaks.push(cur);

  const withDuration = streaks.map((s) => ({ ...s, durationMs: s.end - s.start }));
  const worst = withDuration.length
    ? withDuration.reduce((a, b) => (b.durationMs > a.durationMs ? b : a))
    : null;
  const sustained = Boolean(worst && worst.durationMs > CRITICAL_SUSTAIN_MS);
  return { sustained, streaks: withDuration, worst };
}
