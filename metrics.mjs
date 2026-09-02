#!/usr/bin/env node
/*
 * metrics.mjs — the aggregator over telemetry.js's JSONL ledger (EVALUATION.md E5).
 *
 *   node metrics.mjs                          # all bots, all runs
 *   node metrics.mjs --bot LokalLothar        # one bot
 *   node metrics.mjs --since 2026-09-01       # from a date
 *   node metrics.mjs --by skill|role|rung|class
 *   node metrics.mjs --goto                   # movement table (SPL, wedge rate, route class)
 *   node metrics.mjs --gate skills-v26        # ship-gate verdict, scoped to the latest run
 *   node metrics.mjs --gate X --all           # ...or judged over all history
 *   node metrics.mjs --baseline write|compare # freeze / diff against bench/baseline.json
 *   node metrics.mjs --ab runA runB           # compare two run ids
 *   node metrics.mjs --json                   # machine-readable
 *
 * Two rules from the anti-Goodhart register are enforced here rather than left to
 * discipline, because a metric that can be gamed WILL be:
 *   - `bad_input` (driver typos) is excluded from every rate. A malformed call is not an
 *     engine failure, and pooling it with `wedge` corrupts the denominator.
 *   - cells with n < MIN_N are SUPPRESSED, not printed with a wide interval. A 1/1 = 100%
 *     success rate is noise that reads like triumph.
 * Rates carry Wilson intervals, never Wald — at these sample sizes Wald is simply wrong.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LOGS = path.join(DIR, 'logs');
const MIN_N = 5;

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const has = (n) => argv.includes('--' + n);

// ---------- load ----------
function roster() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'roster.json'), 'utf8')).roles || {}; }
  catch { return {}; }
}
function load() {
  const recs = [];
  const gaps = [];
  let files = [];
  try { files = fs.readdirSync(LOGS).filter((f) => /^metrics-.*\.jsonl$/.test(f)); } catch { /* no logs yet */ }
  const botFilter = flag('bot');
  const since = flag('since') ? Date.parse(flag('since')) : null;
  for (const f of files) {
    const bot = f.replace(/^metrics-|\.jsonl$/g, '');
    if (botFilter && bot !== botFilter) continue;
    const lastSeq = new Map();
    for (const line of fs.readFileSync(path.join(LOGS, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (since && r.t < since) continue;
      // A gap in seq means a dropped write. Report it — silently under-counting is exactly
      // the kind of quiet corruption that makes a whole table untrustworthy.
      const k = r.bot + '/' + r.run;
      const prev = lastSeq.get(k);
      if (prev != null && r.seq > prev + 1) gaps.push({ run: k, from: prev, to: r.seq, lost: r.seq - prev - 1 });
      lastSeq.set(k, r.seq);
      recs.push(r);
    }
  }
  return { recs, gaps };
}

// ---------- stats ----------
// Wilson score interval. Wald is wrong at small n (and can produce bounds outside [0,1]),
// and every cell here is small n.
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const pct = (x) => (x * 100).toFixed(1) + '%';
const rate = (k, n) => {
  if (n < MIN_N) return `n=${n} (suppressed)`;
  const [lo, hi] = wilson(k, n);
  return `${pct(k / n)} [${pct(lo)}–${pct(hi)}] n=${n}`;
};

// ---------- universal (2.1) ----------
const TYPED = new Set(['timeout', 'wedge', 'kit_missing', 'no_tool', 'reach_violation', 'low_health',
  'inv_full', 'no_path', 'not_found', 'death', 'disconnected']);

function universal(ends) {
  const N = ends.filter((e) => e.outcome !== 'bad_input');       // denominator rule
  const ok = N.filter((e) => e.outcome === 'ok');
  const fs_ = N.filter((e) => e.outcome === 'false_success');
  const naive = N.filter((e) => e.outcome === 'ok' || e.outcome === 'false_success');
  const fails = N.filter((e) => e.outcome !== 'ok' && e.outcome !== 'false_success');
  const typed = fails.filter((e) => TYPED.has(e.outcome));
  const yields = N.filter((e) => typeof e.yield === 'number');
  const under = yields.filter((e) => e.outcome === 'ok' && e.yield < 1);
  return {
    n: N.length,
    SR: { k: ok.length, n: N.length },
    FSR: { k: fs_.length, n: N.length },
    naive_SR: { k: naive.length, n: N.length },
    trust_gap: N.length ? (naive.length - ok.length) / N.length : 0,
    DFR: { k: typed.length, n: fails.length },
    under_prod: { k: under.length, n: N.length },
    excluded_bad_input: ends.length - N.length,
    // assertion coverage, computable only on v>=2 records (see the SCHEMA_V note)
    gradableN: N.filter((e) => (e.v || 1) >= 2).length,
    gradedN: N.filter((e) => (e.v || 1) >= 2 && e.assert).length,
    byOutcome: ends.reduce((o, e) => (o[e.outcome] = (o[e.outcome] || 0) + 1, o), {}),
  };
}

function printUniversal(label, u) {
  console.log(`\n── ${label} ──`);
  if (!u.n) { console.log('  (no task_end records)'); return; }
  console.log(`  SR (verified)   ${rate(u.SR.k, u.SR.n)}`);
  console.log(`  naive SR        ${rate(u.naive_SR.k, u.naive_SR.n)}   <- counts done===true, unverified`);
  console.log(`  trust gap       ${pct(u.trust_gap)}   <- naive minus verified; the integrity number`);
  const fsr = u.FSR.k / (u.FSR.n || 1);
  console.log(`  FSR             ${rate(u.FSR.k, u.FSR.n)}${u.FSR.k > 0 ? '   *** ALARM: target is 0 ***' : ''}`);
  console.log(`  DFR             ${u.DFR.n ? rate(u.DFR.k, u.DFR.n) : 'n=0'}   <- typed share of failures (higher = better diagnosis)`);
  console.log(`  under-produced  ${rate(u.under_prod.k, u.under_prod.n)}   <- ok but yield<1`);
  if (u.excluded_bad_input) console.log(`  excluded        ${u.excluded_bad_input} bad_input (operator error, never an engine rate)`);
  console.log(`  outcomes        ${Object.entries(u.byOutcome).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  if (u.gradedN != null) {
    // Coverage is its own signal: a low graded share means FSR's 0 is thin rather than
    // earned — nothing was checked, so nothing could fail.
    console.log(`  assert coverage ${u.gradedN}/${u.gradableN} graded${u.gradableN && u.gradedN / u.gradableN < 0.5 ? '   <- thin: a 0% FSR here is mostly UNCHECKED, not verified' : ''}`);
  }
}

// ---------- movement (2.2) ----------
function movement(gotos) {
  const byClass = {};
  for (const g of gotos) {
    const c = g.class || 'UNKNOWN';
    (byClass[c] = byClass[c] || []).push(g);
  }
  const rows = [];
  for (const [cls, list] of Object.entries(byClass)) {
    const arrived = list.filter((g) => g.res === 'arrived');
    // SPL uses crow/max(odometer,crow): both are stated lower bounds, so this ranks
    // honestly but is NOT an absolute efficiency percentage. Never present it as one.
    const spl = arrived.length
      ? arrived.reduce((a, g) => a + (g.crow / Math.max(g.moved || g.crow, g.crow || 1)), 0) / arrived.length : null;
    const wedged = list.filter((g) => (g.unsticks || 0) > 0 || g.res === 'stuck' || ((g.resets || {}).stuck || 0) >= 3);
    rows.push({ cls, n: list.length, arrived: arrived.length, spl,
      wedgeRate: list.length ? wedged.length / list.length : 0,
      medianMs: median(list.map((g) => g.ms).filter(Number.isFinite)),
      assertFails: list.filter((g) => g.assert_fail).length });
  }
  return rows.sort((a, b) => b.n - a.n);
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function printMovement(rows) {
  console.log('\n── movement (per route class; never pooled) ──');
  if (!rows.length) { console.log('  (no goto spans)'); return; }
  console.log('  class                n  arrived   SPL    wedge%  medMs  assertFail');
  for (const r of rows) {
    const supp = r.n < MIN_N;
    console.log(`  ${r.cls.padEnd(18)} ${String(r.n).padStart(3)}  ${String(r.arrived).padStart(7)}  ` +
      `${supp ? '  n/a' : (r.spl == null ? '  n/a' : r.spl.toFixed(2))}  ` +
      `${supp ? '   n/a' : (r.wedgeRate * 100).toFixed(0).padStart(5) + '%'}  ` +
      `${String(r.medianMs ?? '-').padStart(5)}  ${String(r.assertFails).padStart(6)}` +
      (supp ? '   (n<5, suppressed)' : ''));
  }
}

// ---------- grouping ----------
function groupKey(e, by, roles) {
  if (by === 'skill') return e.skill || '?';
  if (by === 'role') return roles[e.bot] || 'unknown';
  if (by === 'bot') return e.bot;
  return 'all';
}

// ---------- main ----------
const { recs, gaps } = load();
const roles = roster();
let ends = recs.filter((r) => r.ev === 'task_end');
let gotos = recs.filter((r) => r.ev === 'goto');

if (has('json')) {
  const by = flag('by', 'skill');
  const groups = {};
  for (const e of ends) (groups[groupKey(e, by, roles)] = groups[groupKey(e, by, roles)] || []).push(e);
  console.log(JSON.stringify({
    overall: universal(ends), byGroup: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, universal(v)])),
    movement: movement(gotos), gaps, records: recs.length,
  }, null, 2));
  process.exit(0);
}

console.log(`metrics.mjs — ${recs.length} records, ${ends.length} task_end, ${gotos.length} goto spans`);
// Version attribution per run (#41). Without this a row cannot say what produced it, and a
// cross-version comparison is guesswork dressed as measurement.
const versionsByRun = new Map();
for (const r of recs) if (r.ev === 'versions') versionsByRun.set(r.run, r);
if (versionsByRun.size) {
  console.log('\n── versions by run ──');
  for (const [run, v] of versionsByRun) {
    const parts = ['skills', 'agenda', 'digguard', 'survival', 'toolguard', 'dangerscan', 'idleguard']
      .filter((k) => v[k] != null).map((k) => `${k}:${v[k]}`);
    console.log(`  ${run}  ${parts.join(' ')}${v.role ? '  role:' + v.role : ''}`);
  }
} else if (recs.length) {
  console.log('  (no `versions` records — runs predate #41, so rows cannot be attributed to a payload set)');
}
const schemaVersions = [...new Set(recs.map((r) => r.v || 1))].sort();
if (schemaVersions.length > 1) {
  console.log(`  !! ledger mixes schema versions ${schemaVersions.join(' and ')} — \`assert\` means`);
  console.log('     different things across them (v1: rule-on-failure-only, v2: tri-state).');
  console.log('     Assertion coverage below is computed from v>=2 records only.');
}
if (gaps.length) {
  const lost = gaps.reduce((a, g) => a + g.lost, 0);
  console.log(`  !! ${lost} DROPPED WRITES across ${gaps.length} gap(s) — counts below are under-reported`);
}
if (!ends.length && !gotos.length) {
  console.log('\nNo task records yet. Run some tasks on an instrumented bot, then re-run.');
  process.exit(0);
}

printUniversal('overall', universal(ends));

const by = flag('by');
if (by) {
  const groups = {};
  for (const e of ends) (groups[groupKey(e, by, roles)] = groups[groupKey(e, by, roles)] || []).push(e);
  for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    printUniversal(`${by}=${k}`, universal(v));
  }
}
if (has('goto') || !by) printMovement(movement(gotos));

// ---------- ladder coverage (#52/M1) ----------
// Fraction of ticks resolved by a FIRING rung vs IDLE fall-through, from the agenda's own
// periodic `note` stream (emitted on every rung transition -- `agenda.js:685`). Not a true
// per-tick count (notes are transition-sampled, not one-per-tick), but every transition IS
// captured, so this reads as "share of the run's active TIME spent on a firing rung vs
// idling" -- the practical form of the metric or a driverless run has no ticks to compare
// against. n<5 is suppressed same as every other cell in this doctrine (a 1/1 reads like
// triumph).
const notes = recs.filter((r) => r.ev === 'note');
if (notes.length) {
  const firing = notes.filter((r) => r.agenda && r.agenda !== 'IDLE').length;
  console.log('\n── ladder coverage (share of rung-transitions that were a firing rung, not IDLE) ──');
  if (notes.length < 5) console.log(`  n=${notes.length} (suppressed)`);
  else console.log(`  ${rate(firing, notes.length)}   <- IDLE-only share is the complement`);
  const byRung = {};
  for (const r of notes) byRung[r.agenda] = (byRung[r.agenda] || 0) + 1;
  console.log(`  by rung: ${Object.entries(byRung).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
} else {
  console.log('\n── ladder coverage ── (no `note` events — this ledger predates the agenda, or the bot never ran it)');
}

// ---------- direction (idle-as-a-number, IDLE_TRIGGER_SPEC / Direction Episodes) ----------
// Version note: the spec was written as agenda v20->v21, but engine-dev-3 landed the ESCAPE
// rung (#89 digOut) as v21 first (unrelated to this), so Direction Episodes ships as v22
// instead -- a number, not a functional change. Nothing below keys off a version number;
// only `A._directionCheck`'s existence (checked live, not inferred from `agenda` in /state).
// Direction Episodes: "needs direction" is latched, level-triggered engine state
// (research/IDLE_TRIGGER_SPEC.md). An episode opens on a deterministic ladder edge
// (project_done/project_blocked/no_tool) or level (unproductive_idle/project_stalled) and
// closes on anything that fills the project slot -- a driver, the fleet decider, a
// promoted queued-next, or deterministic self-recovery. `latency_ms` is stamped by the
// engine at close time, not recomputed here. Pairing is by `eid`, exactly like the
// recovery-ladder section pairs by `gid` above.
const dirRecs = recs.filter((r) => r.ev === 'direction');
const undirectedFractionByBot = {};   // stashed for the contradiction alarm below
if (dirRecs.length) {
  console.log('\n── direction (idle-as-a-number) ──');
  const byBot = {};
  for (const r of dirRecs) (byBot[r.bot] = byBot[r.bot] || []).push(r);
  // session wall clock proxy: this bot's own full observed record span (first to last `t`
  // in its ledger), same pragmatic span-from-records approach the rest of this file uses
  // rather than requiring a clean connect/disconnect pair.
  const allByBot = {};
  for (const r of recs) (allByBot[r.bot] = allByBot[r.bot] || []).push(r.t);

  const rows = [];
  for (const [bot, list] of Object.entries(byBot)) {
    const opens = list.filter((r) => r.op === 'open');
    const closes = list.filter((r) => r.op === 'close');
    const promotes = list.filter((r) => r.op === 'promote');
    const opensByEid = new Map(opens.map((o) => [o.eid, o]));
    const closesByEid = new Map(closes.map((c) => [c.eid, c]));

    const byWhy = {};
    for (const o of opens) byWhy[o.why] = (byWhy[o.why] || 0) + 1;

    const latencies = closes.map((c) => c.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
    const pct90 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(0.9 * latencies.length) - 1)] : null;
    const med = median(latencies);

    const closedByCounts = {};
    for (const c of closes) closedByCounts[c.closedBy] = (closedByCounts[c.closedBy] || 0) + 1;

    // undirected time: closed episodes contribute close.t - open.t; STILL-OPEN episodes
    // (no matching close in this ledger window) contribute up to the bot's last-seen record
    // -- this is also the open-unclosed / dead-consumer detector, not a separate pass.
    const allT = allByBot[bot] || list.map((r) => r.t);
    const lastSeen = Math.max(...allT), firstSeen = Math.min(...allT);
    const sessionMs = Math.max(1, lastSeen - firstSeen);
    let undirectedMs = 0;
    const unclosed = [];
    for (const o of opens) {
      const c = closesByEid.get(o.eid);
      if (c) undirectedMs += Math.max(0, c.t - o.t);
      else { undirectedMs += Math.max(0, lastSeen - o.t); unclosed.push(o); }
    }
    const hours = sessionMs / 3600000;
    undirectedFractionByBot[bot] = { opened: opens.length, fraction: undirectedMs / sessionMs };

    rows.push({ bot, opens: opens.length, closes: closes.length, promotes: promotes.length,
      byWhy, med, pct90, closedByCounts, undirectedFrac: undirectedMs / sessionMs,
      perHr: hours > 0 ? opens.length / hours : null, unclosed, lastSeen });
  }
  rows.sort((a, b) => b.opens - a.opens);

  console.log('  bot              opened closed promoted  latency(med/p90)  undirected%  ep/hr');
  for (const r of rows) {
    const lat = r.med != null ? `${Math.round(r.med / 1000)}s/${Math.round((r.pct90 ?? r.med) / 1000)}s` : 'n/a';
    console.log(`  ${r.bot.padEnd(16)} ${String(r.opens).padStart(6)} ${String(r.closes).padStart(6)} ${String(r.promotes).padStart(8)}  ${lat.padStart(16)}  ${pct(r.undirectedFrac).padStart(10)}  ${r.perHr != null ? r.perHr.toFixed(1) : 'n/a'}`);
    console.log(`    by why: ${Object.entries(r.byWhy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none)'}`);
    const cbTotal = Object.values(r.closedByCounts).reduce((a, b) => a + b, 0) || 1;
    console.log(`    closedBy: ${Object.entries(r.closedByCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}(${pct(v / cbTotal)})`).join(' ') || '(none closed)'}   <- promoted = never touched an LLM, self_recovered = deterministic floor worked`);
    if (r.unclosed.length) {
      for (const o of r.unclosed) {
        const ageMin = Math.round((r.lastSeen - o.t) / 60000);
        const tag = ageMin >= 30 ? '  *** DEAD-CONSUMER: open >30min, nothing ever answered it ***' : '';
        console.log(`    OPEN, unclosed: eid=${o.eid} why=${o.why} age=${ageMin}min${tag}`);
      }
    }
  }
  // fleet aggregate
  const totalOpen = rows.reduce((a, r) => a + r.opens, 0);
  const totalClose = rows.reduce((a, r) => a + r.closes, 0);
  const totalPromote = rows.reduce((a, r) => a + r.promotes, 0);
  const allLat = dirRecs.filter((r) => r.op === 'close' && Number.isFinite(r.latency_ms)).map((r) => r.latency_ms).sort((a, b) => a - b);
  const fleetMed = median(allLat);
  const fleetP90 = allLat.length ? allLat[Math.min(allLat.length - 1, Math.ceil(0.9 * allLat.length) - 1)] : null;
  const fleetUndirected = rows.length ? rows.reduce((a, r) => a + r.undirectedFrac, 0) / rows.length : 0;
  console.log(`  fleet: ${totalOpen} opened, ${totalClose} closed, ${totalPromote} promoted, undirected-time ${pct(fleetUndirected)} (avg across bots)` +
    (fleetP90 != null ? `, latency p50 ${Math.round(fleetMed / 1000)}s / p90 ${Math.round(fleetP90 / 1000)}s${fleetP90 >= 120000 ? '  <- target is p90<120s driverless, MISSED' : ''}` : ''));

  // promote cross-check: the true completion->start gap is the NEXT task_start's gap_ms,
  // not a self-reported latency -- two independent instruments on the same fact (spec §1.1g).
  const promoteRecs = dirRecs.filter((r) => r.op === 'promote');
  if (promoteRecs.length) {
    const gaps = [];
    for (const p of promoteRecs) {
      const after = recs.filter((r) => r.ev === 'task_start' && r.bot === p.bot && r.t > p.t && r.gap_ms != null).sort((a, b) => a.t - b.t)[0];
      if (after) gaps.push(after.gap_ms);
    }
    const gmed = median(gaps);
    console.log(`  promote cross-check: median next-task gap_ms ${gmed != null ? Math.round(gmed) + 'ms' : 'n/a'} over ${gaps.length}/${promoteRecs.length} promotes matched` +
      (gmed != null && gmed > 2500 ? '  *** expected <=2500ms, exceeded ***' : ''));
  }

} else {
  console.log('\n── direction ── (no `direction` events — this ledger predates Direction Episodes, or the bot never ran it)');
}
// contradiction alarm (queue-ahead graft, spec §4.2): a dead trigger with a live ladder-note
// stream prints as IDLE-heavy while direction records are ZERO -- an optional-guarded emit
// into nothing is indistinguishable from a rung that never runs (#38/#54-R2 lesson) unless
// something is watching for exactly this shape. Silence while idle is reported as the
// failure it is, not swallowed.
//
// MUST be checked PER-BOT, not just pooled fleet-wide: during a staged v21 rollout (the
// live shape right now) a healthy already-upgraded bot's direction records make the FLEET
// total nonzero, which would silently hide a genuinely dead/pre-v21 bot sitting right next
// to it in the same run -- caught live testing this against a synthetic mixed-version
// ledger, not theoretical.
{
  const notesByBot = {}, dirByBot = {};
  for (const r of notes) (notesByBot[r.bot] = notesByBot[r.bot] || []).push(r);
  for (const r of dirRecs) (dirByBot[r.bot] = dirByBot[r.bot] || []).push(r);
  for (const [bot, list] of Object.entries(notesByBot)) {
    if (list.length < 5 || (dirByBot[bot] || []).length) continue;
    const idleShare = 1 - (list.filter((r) => r.agenda && r.agenda !== 'IDLE').length / list.length);
    if (idleShare > 0.5) {
      console.log(`\n  *** CONTRADICTION (${bot}): ladder coverage shows ${pct(idleShare)} IDLE-transition share but ZERO \`direction\` records exist ***`);
      console.log('      Either Direction Episodes is not on this bot yet, or the trigger is dead while the ledger is live -- these two numbers can never honestly disagree once it is running.');
    }
  }
}

// ---------- decider (#68 LLM economics) ----------
// decisions.jsonl is decider.js's own append-only log, one shared file for the whole fleet
// (ONE daemon, IDLE_TRIGGER_SPEC §3b) -- not a per-bot ledger, so this reads independently of
// --bot/--since and is NOT gated by whether direction records exist (a soak's economic story
// is worth reading even mid-run, before any episode has closed). Same treatment as the
// DIRECTION section: real numbers against the spec's own targets, not a demo.
{
  const src = flag('decisions', path.join(DIR, 'logs', 'decisions.jsonl'));
  const exists = typeof src === 'string' && fs.existsSync(src);
  console.log('\n── decider (LLM economics, #68) ──');
  if (!exists) {
    console.log(`  (no decisions.jsonl at '${src}' -- decider.js not running yet, or pass --decisions <path>)`);
  } else {
    // same --since/--bot scoping as everything else in this file, applied here explicitly
    // since decisions.jsonl is read outside load()'s own filtering -- a soak's grading window
    // needs this (engine-dev-3's own sign-off left one pre-soak synthetic record in the file;
    // `--since <daemon start>` is how a gate run excludes it without editing the file).
    const botFilter = flag('bot');
    const sinceMs = flag('since') ? Date.parse(flag('since')) : null;
    let decisions = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (sinceMs) decisions = decisions.filter((d) => d.t >= sinceMs);
    if (botFilter) decisions = decisions.filter((d) => d.bot === botFilter);
    if (!decisions.length) {
      console.log('  decisions.jsonl exists but is empty (or nothing in this --since/--bot window) -- decider running, nothing decided yet');
    } else {
      const byHour = (Math.max(...decisions.map((d) => d.t)) - Math.min(...decisions.map((d) => d.t))) / 3600000;
      const ruleHits = decisions.filter((d) => d.src === 'rule');
      const llmCalls = decisions.filter((d) => d.src === 'llm');
      const skipped = decisions.filter((d) => d.src === 'skipped_cap');
      const LLM_CAP_PER_HR = 30;   // IDLE_TRIGGER_SPEC §7's hard ceiling
      const llmPerHr = byHour > 0 ? llmCalls.length / byHour : null;
      // "rule-hit" vs "LLM-consulted" (a rule miss, not an LLM miss -- that's a different,
      // narrower thing since the Andy/Ollama switch, see below) is the top-level decision
      // ROUTE. Whether the LLM leg actually produced something usable is a separate number.
      console.log(`  ${decisions.length} decisions${byHour > 0 ? ` over ${byHour.toFixed(2)}h` : ''}: ${rate(ruleHits.length, decisions.length)} rule-hit, ${rate(llmCalls.length, decisions.length)} LLM-consulted`);
      // Andy-4-micro (local Ollama, zero-cost) does not reliably stay inside the command
      // menu the prompt offers -- decision:null on a src:'llm' record is a genuine miss (an
      // unmapped/unparsed reply), NOT the same thing as "a rule miss routed to the LLM"
      // above. Up to LLM_MISS_RETRY_LIMIT=2 records per (bot,eid) is the NORMAL shape of a
      // retry-once-then-give-up sequence, not an anomaly (see the dedup check below).
      const llmMisses = llmCalls.filter((d) => d.decision == null);
      if (llmCalls.length) {
        console.log(`  Andy reply usability: ${rate(llmCalls.length - llmMisses.length, llmCalls.length)} produced a usable/mappable decision (${llmMisses.length} unmapped-or-unparsed miss(es))`);
      }
      console.log(`  LLM calls/hr: ${llmPerHr != null ? llmPerHr.toFixed(1) : 'n/a'} vs the ${LLM_CAP_PER_HR}/hr cap` +
        (llmPerHr != null && llmPerHr > LLM_CAP_PER_HR ? '   *** OVER CAP -- the persisted rate gate should have prevented this, investigate decider-state.json ***' : ''));
      console.log(`  skipped_cap: ${skipped.length}${skipped.length > 0 ? '   <- overflow correctly logged, not spent (this IS the cap working, not a failure)' : ''}`);
      // dispatchOk/dispatchError only exist on rule/llm records (decider.js appends
      // skipped_cap BEFORE attempting dispatch, so those lines are structurally shorter --
      // 'in d' below, not a truthiness check, so a real `dispatchOk:false` isn't mistaken
      // for "field absent"). A false here has TWO distinct causes, not one: an llm-miss
      // record (decision:null) never had anything to dispatch at all (dispatchError
      // 'unmapped_or_unparsed', already counted above as an Andy reply-usability miss --
      // excluded here so it isn't double-counted as a "race"); a REAL decision that still
      // failed to dispatch is the genuine eid-CAS race (a driver answered first,
      // IDLE_TRIGGER_SPEC §1.1j) -- normal, worth counting, not alarming on.
      const attemptedDispatch = decisions.filter((d) => 'dispatchOk' in d && d.decision != null);
      const raceFailed = attemptedDispatch.filter((d) => d.dispatchOk === false);
      if (attemptedDispatch.length) {
        console.log(`  dispatch races (driver answered first, a real decision existed): ${rate(raceFailed.length, attemptedDispatch.length)}${raceFailed.length ? '  <- normal eid-CAS behavior, not a decider bug; see dispatchError for the stale reason' : ''}`);
      }
      // decider-state.json's dedup is by (bot,eid), marked handled regardless of outcome. As
      // of the Andy/Ollama switch, though, UP TO 2 records for the same (bot,eid) is the
      // NORMAL shape of a retry-once-then-give-up sequence (LLM_MISS_RETRY_LIMIT=2) -- only
      // >2 records, or a MIX of src types for one pair (a rule and an llm record sharing an
      // eid, which the rule-first/llm-fallback design should never produce), are genuine
      // dedup-health signals worth surfacing.
      const byBotEid = {};
      for (const d of decisions) { const k = `${d.bot}|${d.eid}`; (byBotEid[k] = byBotEid[k] || []).push(d.src); }
      const dupes = Object.entries(byBotEid).filter(([, srcs]) => srcs.length > 2 || new Set(srcs).size > 1);
      if (dupes.length) {
        console.log(`  *** ${dupes.length} (bot,eid) pair(s) look wrong -- either >2 records or mixed src types (not the normal <=2-llm-retries shape): ${dupes.slice(0, 5).map(([k, srcs]) => `${k}:[${srcs.join(',')}]`).join(' ')} ***`);
      }
      // rule-of-twice candidates (§3b step 7): a (key -> decision) pair the LLM answered the
      // SAME way two or more times is exactly what graduates into rules.json. Grouping by key
      // and comparing decision payloads by value (not by object identity) is the whole point
      // of this table -- it is #68's promised token trajectory ("shrink monotonically"), made
      // checkable rather than asserted. Excludes decision:null (an Andy reply-usability miss,
      // not a repeatable decision -- "seen null twice" is not a rule candidate).
      const byKey = {};
      for (const d of llmCalls) {
        if (d.decision == null) continue;
        const k = d.key || '(no key)';
        (byKey[k] = byKey[k] || []).push(JSON.stringify(d.decision));
      }
      const candidates = [];
      for (const [key, decs] of Object.entries(byKey)) {
        const counts = {};
        for (const d of decs) counts[d] = (counts[d] || 0) + 1;
        for (const [dec, n] of Object.entries(counts)) if (n >= 2) candidates.push({ key, decision: dec, n });
      }
      candidates.sort((a, b) => b.n - a.n);
      if (candidates.length) {
        console.log(`  rule-of-twice candidates (same key -> same LLM decision, seen >=2x, not yet in rules.json):`);
        for (const c of candidates.slice(0, 10)) console.log(`    ${String(c.n).padStart(2)}x  ${c.key}  ->  ${c.decision}`);
        if (candidates.length > 10) console.log(`    ... and ${candidates.length - 10} more`);
      } else if (llmCalls.length >= 2) {
        console.log('  rule-of-twice candidates: none yet (every LLM-answered key so far is either unique or already inconsistent across repeats)');
      }
    }
  }
}

// ---------- recovery ladder (#54) ----------
// R2's own acceptance criterion is its own firing frequency (its sink did not exist until
// telemetry.js grew M.recovery — see FEEDBACK.md, "M.recovery emits into a sink that DOES NOT
// EXIST"). Beyond "did it fire", eng-2's review left a PREDICTION on record before this could be
// measured: the re-issued A* is where the wins come from, not the dead-reckoned reposition —
// scored here so the data can confirm or refute it, not argument. A recovery event's `gid`
// points at the FAILED goto span that triggered it (M.goto is already cleared by the time the
// rung fires — see telemetry.js's M.recovery comment); the RETRY's own outcome is simply the
// next `goto` record in the same run's seq order, because gotoR's control flow is strictly
// sequential (gotoEnd(stuck) -> recovery emit -> reposition -> next goto -> gotoEnd). No bespoke
// join key needed.
const recoveries = recs.filter((r) => r.ev === 'recovery');
if (recoveries.length) {
  console.log('\n── recovery ladder (rung firing frequency; #54) ──');
  const gotosByRun = new Map();
  for (const g of gotos) { if (!gotosByRun.has(g.run)) gotosByRun.set(g.run, []); gotosByRun.get(g.run).push(g); }
  for (const list of gotosByRun.values()) list.sort((a, b) => a.seq - b.seq);
  const byRung = {};
  for (const r of recoveries) (byRung[r.rung] = byRung[r.rung] || []).push(r);
  for (const [rung, list] of Object.entries(byRung).sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < MIN_N) { console.log(`  ${rung}   n=${list.length} (suppressed)`); continue; }
    const paired = list.map((r) => {
      const after = (gotosByRun.get(r.run) || []).find((g) => g.seq > r.seq);
      return { ...r, retryRes: after ? after.res : null };
    });
    const byRes = {};
    for (const p of paired) byRes[p.retryRes || 'unknown'] = (byRes[p.retryRes || 'unknown'] || 0) + 1;
    console.log(`  ${rung}   n=${list.length}   retry outcome: ${Object.entries(byRes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    const withDisplaced = paired.filter((p) => typeof p.displaced === 'boolean');
    if (withDisplaced.length) {
      const arrivedAfterDisplace = withDisplaced.filter((p) => p.retryRes === 'arrived' && p.displaced);
      const arrivedNoDisplace = withDisplaced.filter((p) => p.retryRes === 'arrived' && !p.displaced);
      console.log(`       displaced reported ${withDisplaced.length}/${list.length}   ` +
        `retry-arrived with displaced=true: ${arrivedAfterDisplace.length}   with displaced=false: ${arrivedNoDisplace.length}` +
        `   <- eng-2's prediction: if "false" dominates, the re-plan is doing the work, not the reposition`);
    } else {
      console.log('       (no `displaced` field on these records — rung does not report it yet, so the reposition-vs-replan split cannot be scored)');
    }
  }
} else {
  console.log('\n── recovery ladder ── (no `recovery` events — R2 has not fired, or its emit is not deployed yet)');
}

// ---------- chest transactions (#69 gap 1) ----------
// M.chest() existed in telemetry.js's public API with zero call sites for a while (the mirror
// bug of R2's: a sink that exists but nothing calls it, vs a call into a sink that did not
// exist). Once wired, this is the direct measurement playcheck was inferring from
// depositToChest's `collected` field.
const chestEvents = recs.filter((r) => r.ev === 'chest');
if (chestEvents.length) {
  console.log('\n── chest transactions (#69) ──');
  const byKind = {};
  for (const c of chestEvents) (byKind[c.kind] = byKind[c.kind] || []).push(c);
  for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
    const items = {};
    for (const c of list) for (const [name, n] of Object.entries(c.moved || {})) items[name] = (items[name] || 0) + n;
    const total = Object.values(items).reduce((a, b) => a + b, 0);
    const topItems = Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`  ${kind.padEnd(10)} n=${list.length}  total items ${total}  (${topItems})`);
  }
} else {
  console.log('\n── chest transactions ── (no `chest` events — #69 wiring not deployed yet, or no deposits/withdrawals this window)');
}

// ---------- interventions / tokensSpent=0 tripwire (#52/M1) ----------
// Consumes runner.js's intervention events (POSTs to a decision-making control-plane
// endpoint — /eval, /goto, /chat, etc.). Respects --bot/--since same as everything else
// here, so `--since <window-start>` scores a specific acceptance window rather than the
// process lifetime. A clean driverless run reads 0; this does NOT try to distinguish a
// scorer's own known induction calls from a genuine surprise here — that interpretation
// belongs at the reading, cross-referenced against the rubric's documented induction
// timestamps (EVALUATION.md sect 9), not baked into the count itself.
const interventions = recs.filter((r) => r.ev === 'intervention');
console.log('\n── interventions (tokensSpent=0 tripwire — driver-facing control-plane hits) ──');
if (!interventions.length) {
  console.log('  0   <- clean; no decision-making endpoint was hit in this window');
} else {
  console.log(`  ${interventions.length}   *** nonzero — cross-check against the rubric's known induction timestamps before calling this a fail ***`);
  const byRoute = {};
  for (const r of interventions) byRoute[r.route] = (byRoute[r.route] || 0) + 1;
  console.log(`  by route: ${Object.entries(byRoute).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  for (const r of interventions.slice(-10)) {
    console.log(`    ${new Date(r.t).toISOString()}  ${r.route}  ${(r.preview || '').slice(0, 80)}`);
  }
}

// ---------- repeat clusters ----------
// A failure counter is a SYMPTOM counter. Ten wedges from one retrying rung look like a
// broad movement problem pooled, and collapse to a single missing config line when grouped
// — that exact case cost a look-around before the ledger was read properly. So group before
// concluding, automatically, rather than leaving it to whoever reads the table to remember.
function clusters(ends) {
  const m = new Map();
  for (const e of ends) {
    if (e.outcome === 'ok' || e.outcome === 'bad_input') continue;
    const at = Array.isArray(e.pos) ? e.pos.join(',') : '?';
    const k = `${e.outcome}|${e.skill}|${at}`;
    const c = m.get(k) || { outcome: e.outcome, skill: e.skill, at, n: 0, code: e.code || null };
    c.n++;
    m.set(k, c);
  }
  return [...m.values()].filter((c) => c.n >= 3).sort((a, b) => b.n - a.n);
}
const cl = clusters(ends);
if (cl.length) {
  console.log('\n── repeat clusters (same outcome + skill + exit position, n>=3) ──');
  for (const c of cl) {
    console.log(`  ${String(c.n).padStart(3)}x  ${c.outcome.padEnd(14)} ${String(c.skill).padEnd(16)} at ${c.at}${c.code ? '  code:' + c.code : ''}`);
  }
  const worst = cl[0];
  console.log(`  -> ${worst.n} of these are ONE failure repeating, not ${worst.n} independent ones.`);
  console.log('     Fix the cluster before reading the pooled rate as a quality signal.');
}

// ---------- baseline / A-B ----------
const BASE = path.join(DIR, 'bench', 'baseline.json');
const bl = flag('baseline');
if (bl === 'write') {
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  const snap = { at: Date.now(), overall: universal(ends), movement: movement(gotos) };
  fs.writeFileSync(BASE, JSON.stringify(snap, null, 2));
  console.log(`\nbaseline written -> ${path.relative(DIR, BASE)}`);
} else if (bl === 'compare') {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch { }
  if (!prev) console.log('\nno baseline yet — run --baseline write first');
  else {
    const cur = universal(ends);
    const d = (a, b) => { const x = (a.k / (a.n || 1)) - (b.k / (b.n || 1)); return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + 'pp'; };
    console.log(`\n── vs baseline (${new Date(prev.at).toISOString().slice(0, 16)}) ──`);
    console.log(`  SR   ${d(cur.SR, prev.overall.SR)}   FSR ${d(cur.FSR, prev.overall.FSR)}   n ${prev.overall.n} -> ${cur.n}`);
    if (cur.FSR.k > 0 && prev.overall.FSR.k === 0) console.log('  *** REGRESSION: false_success appeared where the baseline had none ***');
  }
}
const ab = flag('ab');
if (ab) {
  const [a, b] = [ab, argv[argv.indexOf('--ab') + 2]];
  const ra = ends.filter((e) => e.run === a), rb = ends.filter((e) => e.run === b);
  printUniversal(`run ${a}`, universal(ra));
  printUniversal(`run ${b}`, universal(rb));
}

// ---------- gate report (E6) ----------
// A version's ship gate, frozen to a file so a rollout decision is auditable after the fact
// rather than remembered. Deliberately mechanical: FSR must be zero and SR must clear the
// floor on a large enough sample, and the report records the assertion set it was judged
// under — a changed assertion invalidates cross-version comparison, so the hash is part of
// the verdict rather than a footnote.
const gate = flag('gate');
if (gate && typeof gate === 'string') {
  // SCOPE. A rollout gate must judge the version it is gating, not all of history: the
  // pre-fix specimens in the ledger are permanent, so a cumulative FSR stays above zero
  // forever and would block every future rollout no matter what was fixed. Default to the
  // most recent process run — a smoke run IS one run, so this self-scopes with no date
  // arithmetic — and offer --all for the historical view.
  const runs = [...new Set(ends.map((e) => e.run))];
  const latest = runs.sort().pop();
  const scoped = has('all') ? ends : ends.filter((e) => e.run === latest);
  const scopedGotos = has('all') ? gotos : gotos.filter((g) => g.run === latest);
  if (!has('all')) console.log(`\n(gate scoped to run ${latest}: ${scoped.length} of ${ends.length} records — pass --all for cumulative)`);
  ends = scoped; gotos = scopedGotos;
  const u = universal(ends);
  const mv = movement(gotos);
  const fsr = u.FSR.n ? u.FSR.k / u.FSR.n : 0;
  const sr = u.SR.n ? u.SR.k / u.SR.n : 0;
  const reasons = [];
  if (u.n < 20) reasons.push(`sample too small (n=${u.n}, need 20)`);
  if (fsr > 0) reasons.push(`FSR ${pct(fsr)} — must be 0`);
  if (sr < 0.7) reasons.push(`SR ${pct(sr)} below the 70% floor`);
  const report = {
    version: gate, at: new Date().toISOString(), pass: reasons.length === 0, reasons,
    n: u.n, SR: sr, FSR: fsr, naive_SR: u.naive_SR.k / (u.naive_SR.n || 1),
    trust_gap: u.trust_gap, DFR: u.DFR.n ? u.DFR.k / u.DFR.n : null,
    outcomes: u.byOutcome, movement: mv,
    // Only v>=2 records can populate this honestly: in v1 `assert` held a rule name ONLY
    // on failure, so a set built from mixed records lists the rules that FAILED and silently
    // omits every rule that only ever passed — a provenance record that flatters itself.
    assertionSet: [...new Set(ends.filter((e) => (e.v || 1) >= 2)
      .map((e) => (e.assert || '').replace(/\(.*/, '')).filter(Boolean))].sort(),
    assertionSetFrom: ends.filter((e) => (e.v || 1) >= 2).length + '/' + ends.length + ' records (v>=2 only)',
    graded: ends.filter((e) => (e.v || 1) >= 2 && e.assert).length,
    ungraded: ends.filter((e) => (e.v || 1) >= 2 && !e.assert).length,
    droppedWrites: gaps.reduce((a, g) => a + g.lost, 0),
  };
  const out = path.join(DIR, 'bench', 'gates', `${gate}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n── gate ${gate}: ${report.pass ? 'PASS' : 'FAIL'} ──`);
  for (const r of reasons) console.log(`  - ${r}`);
  console.log(`  written -> ${path.relative(DIR, out)}`);
}

// ---------- direction gate (IDLE_TRIGGER_SPEC phase 3 acceptance, #68) ----------
// Team-lead's Phase 3/4 assignment: engine-dev GRADES the soak, engine-dev-3 is graded --
// that separation is the whole point of a mechanical, file-frozen verdict rather than a
// verbal "looks fine to me". Encodes §6 Phase 3's five criteria exactly as written, against
// whatever window --bot/--since already scoped (so `--direction-gate soak1 --since <t0>`
// grades one soak run, not all of history — same self-scoping instinct as --gate above,
// simpler here since a soak is inherently a bounded, recent window rather than a rolling
// ship gate that must exclude permanent pre-fix history).
const dgate = flag('direction-gate');
if (dgate && typeof dgate === 'string') {
  const opens = dirRecs.filter((r) => r.op === 'open');
  const closes = dirRecs.filter((r) => r.op === 'close');
  const closedEids = new Set(closes.map((c) => c.eid));
  const unclosed = opens.filter((o) => !closedEids.has(o.eid));
  const latencies = closes.map((c) => c.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const p50 = median(latencies);
  const p90 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(0.9 * latencies.length) - 1)] : null;

  // same --since/--bot scoping as the decider section above -- a gate run must be able to
  // exclude pre-soak records (e.g. a sign-off verification's synthetic eid) the same way it
  // scopes the direction/task ledgers, or a soak's own grading window silently includes them.
  const decisionsPath = flag('decisions', path.join(DIR, 'logs', 'decisions.jsonl'));
  const gateSinceMs = flag('since') ? Date.parse(flag('since')) : null;
  const gateBotFilter = flag('bot');
  let decisions = (typeof decisionsPath === 'string' && fs.existsSync(decisionsPath))
    ? fs.readFileSync(decisionsPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  if (gateSinceMs) decisions = decisions.filter((d) => d.t >= gateSinceMs);
  if (gateBotFilter) decisions = decisions.filter((d) => d.bot === gateBotFilter);
  const llmCalls = decisions.filter((d) => d.src === 'llm');
  const skippedCap = decisions.filter((d) => d.src === 'skipped_cap').length;
  const decByHour = decisions.length ? (Math.max(...decisions.map((d) => d.t)) - Math.min(...decisions.map((d) => d.t))) / 3600000 : 0;
  const llmPerHr = decByHour > 0 ? llmCalls.length / decByHour : 0;

  // #52 tripwire attribution (§6 Phase 3, §2.9): every decider dispatch must be identifiable
  // in interventions.recent by body match, reconciled against closedBy:'decider' counts.
  // interventions.recent is a bounded ring (runner.js INTERVENTIONS_MAX) so this checks the
  // full `intervention` ledger stream instead — the durable record the ring is sampled from.
  const closedByDecider = closes.filter((c) => c.closedBy === 'decider').length;
  const deciderCalls = interventions.filter((r) => /dirDispatch\(/.test(r.preview || ''));

  const reasons = [];
  if (!opens.length) reasons.push('no episodes opened -- soak produced no signal to grade');
  if (unclosed.length > 0) reasons.push(`${unclosed.length} episode(s) never closed (open-unclosed must be 0): ${unclosed.map((o) => o.eid).join(', ')}`);
  if (p50 == null || p50 > 60000) reasons.push(`latency p50 ${p50 == null ? 'n/a' : Math.round(p50 / 1000) + 's'} -- must be <=60s`);
  if (p90 == null || p90 >= 120000) reasons.push(`latency p90 ${p90 == null ? 'n/a' : Math.round(p90 / 1000) + 's'} -- must be <120s`);
  // extrapolating to a per-hour rate from a short or thin window is noise, not a measurement
  // (2 calls in 30s reads as "240/hr" and would fail a real, healthy soak) -- same MIN_N
  // instinct as rate()'s suppression elsewhere in this file, applied to a window instead of a
  // sample count. A genuine 60-min soak naturally clears this; this guard only matters for a
  // gate run against a short or early slice.
  const decWindowMs = decisions.length ? (Math.max(...decisions.map((d) => d.t)) - Math.min(...decisions.map((d) => d.t))) : 0;
  if (decWindowMs >= 600000 && llmPerHr > 30) reasons.push(`LLM calls/hr ${llmPerHr.toFixed(1)} exceeds the 30/hr cap`);
  else if (decWindowMs < 600000 && decisions.length) reasons.push(`decisions.jsonl window is only ${Math.round(decWindowMs / 1000)}s -- too short to judge the LLM calls/hr cap honestly (need >=10min); re-run the gate once the soak has run longer`);
  if (!decisions.length) reasons.push('decisions.jsonl is empty -- decider produced no record for this window');
  if (deciderCalls.length !== closedByDecider) reasons.push(`decider intervention count (${deciderCalls.length}, by dirDispatch( body match) does not match closedBy:'decider' count (${closedByDecider}) -- #52 tripwire attribution mismatch`);

  const report = {
    label: dgate, at: new Date().toISOString(), pass: reasons.length === 0, reasons,
    opened: opens.length, closed: closes.length, unclosed: unclosed.length,
    latency_p50_ms: p50, latency_p90_ms: p90,
    llm_calls: llmCalls.length, llm_calls_per_hr: Math.round(llmPerHr * 10) / 10, skipped_cap: skippedCap,
    closedBy_decider: closedByDecider, decider_interventions_matched: deciderCalls.length,
    // phase-4-relevant context, reported alongside regardless of pass/fail -- not gated on,
    // since Phase 4's own criteria are a longer soak and a SCOREBOARD entry, not a threshold
    undirected_time_fraction_by_bot: undirectedFractionByBot,
  };
  const out = path.join(DIR, 'bench', 'gates', `direction-${dgate}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n── direction gate ${dgate}: ${report.pass ? 'PASS' : 'FAIL'} ──`);
  for (const r of reasons) console.log(`  - ${r}`);
  console.log(`  written -> ${path.relative(DIR, out)}`);
}

// ---------- tokens ----------
// Deliberately NOT faked. Cost-per-outcome is co-primary with success rate, so a made-up
// number here would be worse than none: it needs per-message token counts with message.id
// dedupe (the same message is billed once but appears in many transcript rows), and that
// source is not in this ledger. Point it at a token export and it will join on bot+time.
if (has('tokens')) {
  const src = flag('tokens');
  console.log('\n── tokens ──');
  if (typeof src !== 'string' || !fs.existsSync(src)) {
    console.log('  no token source. Pass --tokens <file.jsonl> with {id, bot, t, input, output}.');
    console.log('  Dedupe on `id` before summing — the same message appears in multiple');
    console.log('  transcript rows and double-counting inflates cost_per_ok silently.');
  } else {
    const seen = new Set(); let inp = 0, outp = 0;
    for (const l of fs.readFileSync(src, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (r.id && seen.has(r.id)) continue;
      if (r.id) seen.add(r.id);
      inp += r.input || 0; outp += r.output || 0;
    }
    const u = universal(ends);
    console.log(`  input ${inp}  output ${outp}  (deduped ${seen.size} messages)`);
    if (u.SR.k >= MIN_N) console.log(`  tokens per verified ok: ${Math.round((inp + outp) / u.SR.k)}`);
    else console.log(`  tokens per ok: n=${u.SR.k} (suppressed)`);
  }
}
