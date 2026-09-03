// bench/fixtures/stall-attribution.mjs — bench/lib/stall-attribution.mjs (criterion 1's own
// SPARSE/IDLE cause attribution, 2026-09-03, soak #5 follow-up). PURE NODE, hermetic: synthetic
// direction open/close + note records in, attribution out. No ledger, no live bot — same
// doctrine as trail-vacuous.mjs / vitals-floor.mjs / latency-breakdown.mjs.
//
// Run:  node bench/fixtures/stall-attribution.mjs
import { classifyEpisode, attributeEpisodeCauses, attributeRungOwnership, attributeStalls } from '../lib/stall-attribution.mjs';

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const MIN = 60000;
const t0 = 1_800_000_000_000;

// ---- 1. classifyEpisode priority order ----
{
  const base = { eid: 'e', t: t0 + 5 * MIN, why: 'project_stalled', closedBy: 'decider', latency_ms: 5 * MIN };
  T('standdownCarryover wins even when kit_missing AND frozen_repeat are also present',
    classifyEpisode({ t: t0, standDown: { rung: 'PROJECT', until: t0 + MIN }, detail: { lastError: 'kit_missing' } },
      { ...base, closedBy: 'frozen_repeat' }).cause, 'standdownCarryover');
  T('kitMissing wins over frozenRepeat when no standDown',
    classifyEpisode({ t: t0, detail: { lastError: 'kit_missing' } }, { ...base, closedBy: 'frozen_repeat' }).cause, 'kitMissing');
  T('frozenRepeat is the fallback label when closedBy says so and nothing else applies',
    classifyEpisode({ t: t0, detail: { lastError: 'no_path' } }, { ...base, closedBy: 'frozen_repeat' }).cause, 'frozenRepeat');
  T('other: none of the above -- reported, not dropped',
    classifyEpisode({ t: t0 }, { ...base, closedBy: 'decider' }).cause, 'other');
  T('a missing/empty detail object never crashes and reads as other',
    classifyEpisode({ t: t0, detail: null }, { ...base, closedBy: 'decider' }).cause, 'other');
}

// ---- 2. attributeEpisodeCauses: soak #5's own real shape (7/8 kit_missing frozen_repeat) ----
{
  const opens = [];
  const closes = [];
  // one real dispatch (kit_missing, closed by the decider itself, not yet a repeat)
  opens.push({ eid: 'e0', t: t0, detail: { lastError: 'kit_missing' } });
  closes.push({ eid: 'e0', t: t0 + 20 * 1000, why: 'project_stalled', closedBy: 'decider', latency_ms: 20000 });
  // seven subsequent episodes, same kit_missing root cause, decider correctly refuses to
  // re-dispatch (frozen_repeat) -- classifyEpisode must call these kitMissing, NOT
  // frozenRepeat, since the lastError is still visible on each one's own open event.
  for (let i = 1; i <= 7; i++) {
    const oT = t0 + i * 5 * MIN;
    opens.push({ eid: 'e' + i, t: oT, detail: { lastError: 'kit_missing' } });
    closes.push({ eid: 'e' + i, t: oT + 19 * 1000, why: 'project_stalled', closedBy: 'frozen_repeat', latency_ms: 19000 });
  }
  const r = attributeEpisodeCauses(opens, closes);
  T('soak-5 shape: 8 episodes total, all classified kitMissing (root cause visible on every open)', r.buckets.kitMissing.n, 8);
  T('soak-5 shape: zero miscounted as frozenRepeat (that label is for when the ROOT cause is invisible)', r.buckets.frozenRepeat.n, 0);
  T('soak-5 shape: kitMissing.ms sums every episode\'s own duration', r.buckets.kitMissing.ms, 20000 + 7 * 19000);
}

// ---- 3. attributeRungOwnership: SHELTER/IDLE get named buckets, everything else is "directed" ----
{
  const notes = [
    { t: t0, agenda: 'IDLE' },
    { t: t0 + 10 * MIN, agenda: 'PROJECT' },
    { t: t0 + 25 * MIN, agenda: 'SHELTER' },
    { t: t0 + 40 * MIN, agenda: 'RESTOCK' },
  ];
  const r = attributeRungOwnership(notes, t0, t0 + 60 * MIN);
  T('IDLE owned the first 10 minutes', r.buckets.IDLE, 10 * MIN);
  T('SHELTER owned 15 minutes (25->40)', r.buckets.SHELTER, 15 * MIN);
  T('PROJECT + RESTOCK both roll into "directed" (10->25 = 15min, 40->60 = 20min)', r.buckets.directed, 15 * MIN + 20 * MIN);
  T('no unknown time -- the first note is at the window start', r.buckets.unknown, 0);
}

// ---- 4. attributeRungOwnership: a gap before the first note is "unknown", never guessed ----
{
  const notes = [{ t: t0 + 5 * MIN, agenda: 'IDLE' }];
  const r = attributeRungOwnership(notes, t0, t0 + 10 * MIN);
  T('the 5 minutes before the first note are unknown, not silently folded into IDLE', r.buckets.unknown, 5 * MIN);
  T('the remaining 5 minutes are IDLE', r.buckets.IDLE, 5 * MIN);
}

// ---- 5. attributeRungOwnership: zero notes in the window at all -- the WHOLE window is unknown ----
{
  const r = attributeRungOwnership([], t0, t0 + 10 * MIN);
  T('zero notes -> the whole window is unknown, not a crash or a false directed/IDLE claim', r.buckets.unknown, 10 * MIN);
}

// ---- 6. attributeStalls: the combined entry point, both signals present side by side ----
{
  const opens = [{ eid: 'a', t: t0, detail: { lastError: 'kit_missing' } }];
  const closes = [{ eid: 'a', t: t0 + 20 * MIN, why: 'project_stalled', closedBy: 'decider', latency_ms: 20 * MIN }];
  const notes = [{ t: t0, agenda: 'IDLE' }, { t: t0 + 30 * MIN, agenda: 'SHELTER' }];
  const r = attributeStalls({ opens, closes, notes, sinceMs: t0, untilMs: t0 + 60 * MIN });
  T('combined: episodeCauses and rungOwnership are BOTH present, not merged into one timeline',
    [r.episodeCauses.kitMissing.ms, r.rungOwnership.IDLE, r.rungOwnership.SHELTER],
    [20 * MIN, 30 * MIN, 30 * MIN]);
  T('windowMs matches the caller\'s own bounds', r.windowMs, 60 * MIN);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
