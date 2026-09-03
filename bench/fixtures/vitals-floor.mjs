// bench/fixtures/vitals-floor.mjs — bench/lib/vitals-floor.mjs's detectSustainedCriticalVitals()
// (GOAL.md criterion 3's new sustained-critical-vitals floor, adopted 2026-09-03 / f4138d6).
//
// PURE NODE, hermetic — synthetic {t,hp,food} series in, verdict out. No ledger, no live bot,
// same "hermetic > staged" doctrine as telemetry-sinks.js / trail-vacuous.mjs.
//
// Run:  node bench/fixtures/vitals-floor.mjs
import { detectSustainedCriticalVitals, CRITICAL_HP, CRITICAL_SUSTAIN_MS } from '../lib/vitals-floor.mjs';

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const MIN = 60000;
const t0 = 1_800_000_000_000; // arbitrary fixed epoch, readable deltas below
const sample = (dtMin, hp, food) => ({ t: t0 + dtMin * MIN, hp, food });

T('constants match GOAL.md text (hp<=6, >10 continuous minutes)',
  [CRITICAL_HP, CRITICAL_SUSTAIN_MS], [6, 10 * MIN]);

// ---- 1. never critical at all ----
{
  const series = [sample(0, 20, 20), sample(5, 20, 18), sample(10, 20, 15)];
  const r = detectSustainedCriticalVitals(series);
  T('healthy series -> not sustained, no streaks', [r.sustained, r.streaks.length], [false, 0]);
}

// ---- 2. a short critical dip, well under 10 minutes -> NOT sustained ----
{
  const series = [sample(0, 20, 20), sample(10, 5, 20), sample(15, 5, 20), sample(20, 20, 20)];
  const r = detectSustainedCriticalVitals(series);
  T('5-minute hp<=6 dip -> not sustained', r.sustained, false);
  T('the dip IS recorded as its own streak (5 real minutes, just under the floor)', r.worst && r.worst.durationMs, 5 * MIN);
}

// ---- 3. a long, unbroken critical streak -> SUSTAINED ----
{
  const series = [sample(0, 20, 20), sample(5, 10, 0), sample(20, 10, 0), sample(40, 10, 0), sample(41, 20, 5)];
  const r = detectSustainedCriticalVitals(series);
  T('food=0 held from minute 5 to minute 40 (35 min) -> sustained', r.sustained, true);
  T('worst streak duration is exactly last-sample minus first-sample of the run', r.worst.durationMs, 35 * MIN);
}

// ---- 4. two SHORT critical dips separated by a healthy reading: streaks do NOT sum ----
// (this is the case a naive "total time spent critical" implementation would get wrong —
// GOAL.md says CONTINUOUS, so a bot that recovers and dips again twice, 6 min each, has
// never been sustained-critical even though 6+6=12 > 10)
{
  const series = [
    sample(0, 20, 20), sample(5, 5, 20), sample(11, 5, 20),   // dip 1: 6 min
    sample(12, 20, 20),                                        // recovery breaks the streak
    sample(20, 5, 20), sample(26, 5, 20),                       // dip 2: 6 min
    sample(27, 20, 20),
  ];
  const r = detectSustainedCriticalVitals(series);
  T('two 6-minute dips split by a real recovery -> NOT sustained (streaks don\'t sum across a recovery)', r.sustained, false);
  T('exactly 2 separate streaks recorded, not 1 merged one', r.streaks.length, 2);
}

// ---- 5. boundary: exactly 10 minutes is NOT "more than 10" ----
{
  const series = [sample(0, 20, 20), sample(1, 10, 0), sample(11, 10, 0), sample(12, 20, 5)];
  const r = detectSustainedCriticalVitals(series);
  T('streak duration exactly 10:00 -> not sustained (strictly MORE than 10 required)', r.sustained, false);
}
{
  const series = [sample(0, 20, 20), sample(1, 10, 0), sample(11.5, 10, 0), sample(12, 20, 5)];
  const r = detectSustainedCriticalVitals(series);
  T('streak duration 10:30 -> sustained', r.sustained, true);
}

// ---- 6. hp/food thresholds are independent ORs, and boundary-correct ----
T('hp exactly 6 is critical (<=6)', detectSustainedCriticalVitals([sample(0, 6, 20)]).streaks.length, 1);
T('hp 7 is NOT critical', detectSustainedCriticalVitals([sample(0, 7, 20)]).streaks.length, 0);
T('food exactly 0 is critical', detectSustainedCriticalVitals([sample(0, 20, 0)]).streaks.length, 1);
T('food 1 is NOT critical (only food===0 counts, not "low food")', detectSustainedCriticalVitals([sample(0, 20, 1)]).streaks.length, 0);

// ---- 7. soak #4's own real shape (see FEEDBACK.md for the exact source timestamps): food
// hits 0 at T+23:50 (07:49:42 + 23:50 ≈ 08:13:32) and stays 0 through the last logged reading
// at T+56:19 (≈08:46:01) with hp pinned at 10 the whole time (never <=6, so only food gates
// this one) -- expressed here in minutes-from-episode-start for readability.
{
  const series = [
    sample(0, 20, 20), sample(10, 20, 18), sample(20, 20, 10), sample(22, 20, 4),
    sample(23.83, 10, 0),   // ~08:13:32
    sample(30, 10, 0), sample(40, 10, 0), sample(50, 10, 0),
    sample(56.32, 10, 0),   // ~08:46:01, last logged reading in the window
  ];
  const r = detectSustainedCriticalVitals(series);
  T('soak-4 shape: sustained (food=0 held from ~T+23:50 to the last logged reading)', r.sustained, true);
  T('soak-4 shape: worst streak is ~32.5 minutes (first food=0 sample to last logged sample, NOT extrapolated to --until or the reboot)',
    Math.round(r.worst.durationMs / MIN * 10) / 10, Math.round((56.32 - 23.83) * 10) / 10);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
