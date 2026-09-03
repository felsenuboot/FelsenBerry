// bench/lib/ledger-gaps.mjs — closes the first two of #69's three telemetry ledger gaps for
// playcheck.mjs (2026-09-03, soak-hour follow-up). #69 itself (filed against an older commit)
// found: (1) `M.chest()` defined but never called, (2) no continuous position trace outside
// task/goto spans, (3) chat content not classified no-op vs meaningful. By the time this
// landed, (1) and (2) were ALREADY WIRED in telemetry.js (real `ev:'chest'` records confirmed
// live in logs/metrics-WurstBaron.jsonl; real `ev:'pos'` records confirmed live, 148 of them,
// in logs/metrics-SchnoddSchorsch.jsonl from soak #5 alone) — the actual remaining gap was that
// NO GRADER ever read either stream. This file is that read. (3) stays genuinely open: no
// chat-content ledger event exists to read, and #69's own text explicitly says a text-pattern
// guess is something this harness "deliberately avoids" — not attempted here either.
//
// Pure functions, no fs/network — bench/fixtures/ledger-gaps.mjs tests this hermetically.

// chest: {kind:'deposit'|'withdraw', moved:{itemName:count,...}}[] (ev:'chest' ledger records,
// telemetry.js's own M.chest() shape). Sums item counts per kind -- does NOT touch the older
// depositToChest task_end.collected inference; playcheck.mjs decides which source to report,
// this just does the real one's arithmetic.
export function summarizeChestEvents(chestRecords) {
  let deposited = 0, withdrawn = 0;
  const depositedByName = {}, withdrawnByName = {};
  for (const r of chestRecords || []) {
    const moved = r && r.moved;
    if (!moved || typeof moved !== 'object') continue;
    const target = r.kind === 'withdraw' ? withdrawnByName : depositedByName;
    let sum = 0;
    for (const [name, n] of Object.entries(moved)) {
      const count = Number(n) || 0;
      target[name] = (target[name] || 0) + count;
      sum += count;
    }
    if (r.kind === 'withdraw') withdrawn += sum; else deposited += sum;
  }
  return { deposited, withdrawn, depositedByName, withdrawnByName, events: (chestRecords || []).length };
}

// pos: {t, pos:[x,y,z]}[] (ev:'pos' ledger records, telemetry.js's shouldEmitPos-gated stream --
// emitted on >=6 blocks displacement OR a 30s heartbeat, whichever comes first, UNCONDITIONAL
// on task state -- exactly the "wedged inside a task" blind spot #69 gap 2 asks to close).
// Returns realStationaryMs/realMovingMs/unknownMs for [sinceMs, untilMs): a gap between two
// SAME-position samples is real stationary time (the heartbeat fired, nothing moved); a gap
// where the position genuinely differs is real moving time (a fresh sample only fires because
// >=6 blocks of displacement happened SOMEWHERE in that gap); time before the first sample or
// after the last is unknown -- never guessed either way, same doctrine as this file's siblings.
// samplePos: [x,y,z] | [x,y,z], EPS=1 (rounded ledger coords -- telemetry.js already floors
// them, so any difference at all is real movement, not float jitter).
export function computePositionTrace(posRecords, sinceMs, untilMs) {
  const sorted = (posRecords || [])
    .filter((r) => r && Number.isFinite(r.t) && Array.isArray(r.pos) && r.t >= sinceMs && r.t < untilMs)
    .sort((a, b) => a.t - b.t);
  const windowMs = Math.max(0, untilMs - sinceMs);
  if (!sorted.length) return { stationaryMs: 0, movingMs: 0, unknownMs: windowMs, samples: 0, windowMs };

  const samePos = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  let stationaryMs = 0, movingMs = 0;
  let unknownMs = sorted[0].t - sinceMs; // before the first sample: no data yet
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].t - sorted[i - 1].t;
    if (samePos(sorted[i].pos, sorted[i - 1].pos)) stationaryMs += gap; else movingMs += gap;
  }
  unknownMs += Math.max(0, untilMs - sorted[sorted.length - 1].t); // after the last sample
  return { stationaryMs, movingMs, unknownMs, samples: sorted.length, windowMs };
}
