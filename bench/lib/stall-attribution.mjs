// bench/lib/stall-attribution.mjs — criterion 1's own latency-breakdown equivalent (soak #5
// follow-up, 2026-09-03, engine-dev/QA lane). playcheck.mjs's SPARSE/IDLE verdict answers "is
// this bot playing" with a single number (stationaryPct) — exactly why soak #5's own attribution
// (7 of 13 episodes stuck on the SAME `project_stalled|none|kit_missing|0` key, closed
// `frozen_repeat`) had to be read by hand out of decisions.jsonl. This does for criterion 1 what
// bench/lib/latency-breakdown.mjs already does for criterion 2: turn "the number was bad" into
// "here is WHY, from the ledger, without re-reading decisions.jsonl by hand".
//
// Two independent, DELIBERATELY NOT MERGED signal sources — same "two witnesses, not one forced
// timeline" doctrine bench/fixtures/induced-stress-sequencing.sh already uses (its own
// panic_recovered-line + rung-sequence pattern): direction episodes and rung-ownership are
// different clocks measuring different things (a direction episode is "the ladder asked for
// outside help"; a rung interval is "who owned the body"), and forcing them into one merged
// stationary-time timeline would double-count or silently drop time neither signal actually
// explains. Reported side by side instead:
//
//   - episodeCauses: each CLOSED direction episode in the window, classified by cause and
//     summed by total duration (latency_ms). Priority order (checked top to bottom, first
//     match wins — an episode can only be ONE thing here, same as latency-breakdown's own
//     bucket priority): standdownCarryover (open.standDown present — #112's own shape, the
//     rung was inherited-cooling-down before this episode even started) > kitMissing
//     (open.detail.lastError === 'kit_missing' — soak #5's actual finding) > frozenRepeat
//     (closedBy:'frozen_repeat' — decider.js's own #95/#97 dedup correctly refusing to
//     re-dispatch an identical failing instruction; a SYMPTOM of some other stall repeating,
//     not a root cause on its own, which is why it's checked last) > other (whatever `why`
//     this episode closed for, not one of the above — reported by name, not silently dropped).
//   - rungOwnership: reconstructed from agenda.js's own `note` ledger events (`ev:'note',
//     agenda:<rungId>`, emitted on every rung transition) — a timeline of which rung owned the
//     body, clipped to the window. SHELTER and IDLE get their own named buckets (the lead's own
//     "shelter-night" / "genuine idle" asks) since both are legitimate, non-failure reasons for
//     low playcheck output (SHELTER is the proactive night-safety primitive working as
//     designed; IDLE is the floor rung with genuinely nothing queued) — everything else
//     (PROJECT, RESTOCK, TOOL, FOOD, ...) rolls into `directed` (the ladder WAS actively working
//     something, even if playcheck's own observable-output check still called that task a
//     no-op — a separate, already-measured signal, not this file's job to re-derive).
//
// Pure functions, no fs/network — bench/fixtures/stall-attribution.mjs tests this hermetically.

// open: {eid,t,why,detail?,standDown?:{rung,until}} | close: {eid,t,why,closedBy,latency_ms}
export function classifyEpisode(open, close) {
  let cause = 'other';
  if (open.standDown && Number.isFinite(open.standDown.until)) cause = 'standdownCarryover';
  else if (open.detail && open.detail.lastError === 'kit_missing') cause = 'kitMissing';
  else if (close.closedBy === 'frozen_repeat') cause = 'frozenRepeat';
  return { eid: close.eid, why: close.why, closedBy: close.closedBy, cause, durationMs: close.latency_ms };
}

// opens/closes: direction ledger records (matched by eid, same shape as latency-breakdown.mjs).
export function attributeEpisodeCauses(opens, closes) {
  const perEpisode = closes
    .map((c) => {
      const open = opens.find((o) => o.eid === c.eid);
      if (!open || !Number.isFinite(c.latency_ms)) return null;
      return classifyEpisode(open, c);
    })
    .filter(Boolean);
  const buckets = { standdownCarryover: { ms: 0, n: 0 }, kitMissing: { ms: 0, n: 0 }, frozenRepeat: { ms: 0, n: 0 }, other: { ms: 0, n: 0 } };
  for (const e of perEpisode) { buckets[e.cause].ms += e.durationMs; buckets[e.cause].n++; }
  return { perEpisode, buckets };
}

// notes: {t, agenda}[] (ev:'note' ledger records) -- ANY order, sorted internally. Returns
// rung-ownership duration for the [sinceMs, untilMs) window: the interval BEFORE the first note
// inside the window (or the whole window, if there are no notes at all) is 'unknown' -- no rung
// data yet, never guessed. Each note's OWN `agenda` value owns the body until the NEXT note (or
// untilMs for the last one).
export function attributeRungOwnership(notes, sinceMs, untilMs) {
  const sorted = (notes || []).filter((n) => n && Number.isFinite(n.t) && n.agenda).sort((a, b) => a.t - b.t);
  const buckets = { SHELTER: 0, IDLE: 0, directed: 0, unknown: 0 };
  const bucketOf = (rung) => (rung === 'SHELTER' ? 'SHELTER' : rung === 'IDLE' ? 'IDLE' : 'directed');

  let cursor = sinceMs;
  const inWindow = sorted.filter((n) => n.t >= sinceMs && n.t < untilMs);
  if (!inWindow.length) { buckets.unknown = Math.max(0, untilMs - sinceMs); return { buckets, intervals: [] };}

  const intervals = [];
  // before the first in-window note: no known rung yet.
  const firstGap = inWindow[0].t - cursor;
  if (firstGap > 0) { buckets.unknown += firstGap; intervals.push({ start: cursor, end: inWindow[0].t, rung: null }); }
  cursor = inWindow[0].t;
  for (let i = 0; i < inWindow.length; i++) {
    const rung = inWindow[i].agenda;
    const end = i + 1 < inWindow.length ? inWindow[i + 1].t : untilMs;
    const dur = Math.max(0, end - cursor);
    buckets[bucketOf(rung)] += dur;
    intervals.push({ start: cursor, end, rung });
    cursor = end;
  }
  return { buckets, intervals };
}

export function attributeStalls({ opens, closes, notes, sinceMs, untilMs }) {
  const episodeCauses = attributeEpisodeCauses(opens || [], closes || []);
  const rungOwnership = attributeRungOwnership(notes || [], sinceMs, untilMs);
  const totalEpisodeMs = episodeCauses.perEpisode.reduce((n, e) => n + (e.durationMs || 0), 0);
  return {
    windowMs: Math.max(0, untilMs - sinceMs),
    episodeCauses: {
      standdownCarryover: episodeCauses.buckets.standdownCarryover,
      kitMissing: episodeCauses.buckets.kitMissing,
      frozenRepeat: episodeCauses.buckets.frozenRepeat,
      other: episodeCauses.buckets.other,
      totalMs: totalEpisodeMs, n: episodeCauses.perEpisode.length,
    },
    rungOwnership: rungOwnership.buckets,
    perEpisode: episodeCauses.perEpisode,
  };
}
