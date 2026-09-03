// bench/fixtures/ledger-gaps.mjs — bench/lib/ledger-gaps.mjs (#69's chest/position-trace reads,
// 2026-09-03). PURE NODE, hermetic: synthetic ev:'chest'/ev:'pos' ledger records in, real
// numbers out. No ledger, no live bot — same doctrine as this directory's other lib fixtures.
//
// Run:  node bench/fixtures/ledger-gaps.mjs
import { summarizeChestEvents, computePositionTrace } from '../lib/ledger-gaps.mjs';

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const S = 1000, t0 = 1_800_000_000_000;

// ---- summarizeChestEvents ----
{
  const r = summarizeChestEvents([
    { kind: 'deposit', moved: { cobblestone: 20 } },
    { kind: 'withdraw', moved: { torch: 8, bread: 4 } },
    { kind: 'deposit', moved: { cobblestone: 5, dirt: 3 } },
  ]);
  T('deposited sums across records and item names', r.deposited, 28);
  T('withdrawn sums across item names within one record', r.withdrawn, 12);
  T('depositedByName tracks each item separately', r.depositedByName, { cobblestone: 25, dirt: 3 });
  T('withdrawnByName tracks each item separately', r.withdrawnByName, { torch: 8, bread: 4 });
  T('events count matches input length', r.events, 3);
}
T('no records -> all zero, not a crash', summarizeChestEvents([]).deposited, 0);
T('a record with no moved object is skipped, not counted as 0 items wrongly merged', summarizeChestEvents([{ kind: 'deposit' }, { kind: 'deposit', moved: { dirt: 1 } }]).deposited, 1);

// ---- computePositionTrace ----
// soak-5-ish shape: mostly stationary (heartbeat-only samples, same position), one real move.
{
  const posRecords = [
    { t: t0, pos: [0, 80, 0] },
    { t: t0 + 30 * S, pos: [0, 80, 0] },   // heartbeat, no movement -> stationary
    { t: t0 + 60 * S, pos: [0, 80, 0] },   // heartbeat, no movement -> stationary
    { t: t0 + 65 * S, pos: [10, 80, 0] },  // real displacement (>=6 blocks) -> moving
    { t: t0 + 95 * S, pos: [10, 80, 0] },  // heartbeat again -> stationary
  ];
  const r = computePositionTrace(posRecords, t0, t0 + 100 * S);
  T('stationary gaps: (0->30) + (30->60) + (65->95) = 90s', r.stationaryMs, 90 * S);
  T('moving gap: (60->65) = 5s, the only interval where position actually changed', r.movingMs, 5 * S);
  T('unknown: before first sample (0) + after last sample (100-95=5s)', r.unknownMs, 5 * S);
  T('samples count matches input length (all inside the window)', r.samples, 5);
}

// ---- the exact gap #69 names: "wedged inside a task" reads as active by task-coverage alone,
// but the REAL position trace shows zero displacement the whole time -- this is what closes it.
{
  const posRecords = [
    { t: t0, pos: [5, 64, 5] },
    { t: t0 + 30 * S, pos: [5, 64, 5] },
    { t: t0 + 60 * S, pos: [5, 64, 5] },
    { t: t0 + 89 * S, pos: [5, 64, 5] },
  ];
  const r = computePositionTrace(posRecords, t0, t0 + 90 * S);
  T('a bot "in a task" the whole window but never actually moving reads 100% real-stationary', r.movingMs, 0);
  T('...specifically, the whole window minus the unknown tail is stationary', r.stationaryMs, 89 * S);
}

// ---- edges: no samples in window at all, and a window that starts before any data ----
{
  const r = computePositionTrace([], t0, t0 + 60 * S);
  T('zero samples -> the whole window is unknown, not a false 0% or 100% stationary claim', r.unknownMs, 60 * S);
}
{
  const posRecords = [{ t: t0 + 40 * S, pos: [0, 70, 0] }];
  const r = computePositionTrace(posRecords, t0, t0 + 60 * S);
  T('a single sample mid-window: everything before it and after it is unknown, not guessed either way',
    [r.stationaryMs, r.movingMs, r.unknownMs], [0, 0, 60 * S]);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
