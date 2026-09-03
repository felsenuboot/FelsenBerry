#!/usr/bin/env node
/*
 * bench/humanbar4.mjs — THE HUMAN BAR, all four criteria (GOAL.md), one command, one window.
 *
 *   1. playcheck verdict PLAYING           (bench/humanbar.mjs's own playcheck half)
 *   2. --direction-gate PASS               (bench/humanbar.mjs's own direction half)
 *   3. survives real night threats WITHOUT driver help
 *        = zero deaths in the window, AND zero non-decider control-plane interventions
 *          (the #52/M1 tripwire metrics.mjs already tracks: any /eval,/goto,/chat,... hit
 *          that is NOT the decider's own `__agenda.dirDispatch(...)` call is a human
 *          stepping in). Read directly from the SAME per-bot ledger, not re-derived.
 *   4. a human-looking trail                (bench/trail.mjs)
 *
 * Usage:
 *   node bench/humanbar4.mjs --bot <name> --since <ISO> [--until <ISO>] --inspector-port <port> [--label <label>]
 *
 * WHY A WRAPPER OVER A WRAPPER, not a rewrite: humanbar.mjs (criteria 1+2) and trail.mjs
 * (criterion 4) are each already independently built, tested, and live-verified — shelling
 * out to both and reading their own finished gate files keeps every number traceable to the
 * instrument that actually computed it, same doctrine humanbar.mjs itself already states for
 * why IT wraps metrics.mjs/playcheck.mjs rather than reimplementing them. Criterion 3 is the
 * only piece computed here directly, because it doesn't need a new instrument — it's two
 * fields (`death`, `intervention`) already sitting in the ledger metrics.mjs's own #52
 * tripwire already reads, just never surfaced as a pass/fail on its own.
 *
 * Writes bench/gates/humanbar4-<label>.json (all four criteria + the sub-instruments' own
 * artifact paths) alongside humanbar-<label>.json and trail-<label>.json, same convention as
 * every other gate file in this tree.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { detectSustainedCriticalVitals, CRITICAL_HP, CRITICAL_SUSTAIN_MS } from './lib/vitals-floor.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');
const LOGS = path.join(ROOT, 'logs');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };

const BOT = flag('bot');
const SINCE = flag('since');
const UNTIL = flag('until'); // optional — omit for "until now", same as humanbar.mjs
const INSPECTOR_PORT = flag('inspector-port');
const LABEL = flag('label', BOT || 'humanbar4');
// optional, explicit: the ACTUAL last instant real data exists through, when it's earlier than
// --until (a reboot, a crash — anything that ends a pre-registered window early). Deliberately
// opt-in rather than auto-detected off the ledger's own last record: a bot going quiet for a
// few minutes mid-soak is normal and would false-trigger a heuristic, whereas the true external
// cutoff (a reboot timestamp, a crash log) is something the grader KNOWS and states, the same
// way --since/--until themselves are pre-registered rather than inferred. See soak #4's audit
// (FEEDBACK.md, 2026-09-03): the host rebooted at T+56, the grade still used the pre-registered
// --until 08:49:42.327Z, and nothing on the gate file itself said the window was cut short.
const LEDGER_END = flag('ledger-end');
if (!BOT || !SINCE || !INSPECTOR_PORT) {
  console.error('usage: node bench/humanbar4.mjs --bot <name> --since <ISO> [--until <ISO>] --inspector-port <port> [--label <label>] [--exclude-zones "x,z,r;x,z,r"]');
  process.exit(2);
}
const sinceMs = Date.parse(SINCE);
const untilMs = UNTIL ? Date.parse(UNTIL) : Date.now();

// ---------------- criterion 4 FIRST: shell out to the trail inspector ----------------
// Deliberately run BEFORE anything else (team-lead's own sequencing note): item entities
// (stranded drops) despawn in 5 real minutes, and this script itself takes a real, non-trivial
// amount of wall-clock time (humanbar.mjs's own playcheck/direction-gate subprocess calls,
// plus the ledger reads below) — running trail.mjs last would burn exactly the window where
// its own live-inspection half is still meaningful. The other three criteria are ledger-only
// and don't decay with wall-clock time the way a world-state inspection does.
const trailArgs = [path.join(ROOT, 'bench', 'trail.mjs'), '--bot', BOT, '--since', SINCE, '--inspector-port', INSPECTOR_PORT, '--label', LABEL];
if (UNTIL) trailArgs.push('--until', UNTIL);
const EXCLUDE_ZONES = flag('exclude-zones'); // pass-through for a known contamination source sharing the server (see trail.mjs's own flag)
if (EXCLUDE_ZONES) trailArgs.push('--exclude-zones', EXCLUDE_ZONES);
try { execFileSync(process.execPath, trailArgs, { stdio: ['ignore', 'ignore', 'inherit'] }); }
catch (e) { /* non-zero on a genuine FAIL/no-data — expected, read the gate file below */ }
const trailGatePath = path.join(ROOT, 'bench', 'gates', `trail-${LABEL}.json`);
let trail = null, c4 = false;
if (fs.existsSync(trailGatePath)) { trail = JSON.parse(fs.readFileSync(trailGatePath, 'utf8')); c4 = trail.verdict === 'PASS'; }

// ---------------- criteria 1+2: shell out to the already-proven wrapper ----------------
const humanbarArgs = [path.join(ROOT, 'bench', 'humanbar.mjs'), '--bot', BOT, '--since', SINCE, '--label', LABEL];
if (UNTIL) humanbarArgs.push('--until', UNTIL);
try { execFileSync(process.execPath, humanbarArgs, { stdio: ['ignore', 'ignore', 'inherit'] }); }
catch (e) { /* non-zero on a genuine FAIL — expected, read the gate file below */ }
const humanbarGatePath = path.join(ROOT, 'bench', 'gates', `humanbar-${LABEL}.json`);
if (!fs.existsSync(humanbarGatePath)) { console.error(`humanbar4: humanbar.mjs did not write a gate file at ${humanbarGatePath}`); process.exit(1); }
const hb = JSON.parse(fs.readFileSync(humanbarGatePath, 'utf8'));
const c1 = hb.playcheck && hb.playcheck.verdict === 'PLAYING';
const c2 = Boolean(hb.direction && hb.direction.pass);

// ---------------- criterion 3: read directly, same ledger metrics.mjs's #52 tripwire reads ----------------
function loadBotLedger() {
  const file = path.join(LOGS, `metrics-${BOT}.jsonl`);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r.t >= sinceMs && r.t <= untilMs) out.push(r); } catch {}
  }
  return out;
}
// decisions.jsonl: the decider's own action log, cross-bot (not per-bot-file like metrics).
// Used as the SECOND, more robust decider-attribution signal below — see its own comment.
function loadDecisions() {
  let raw;
  try { raw = fs.readFileSync(path.join(LOGS, 'decisions.jsonl'), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r.bot === BOT) out.push(r); } catch {}
  }
  return out;
}
const DECIDER_CORRELATE_MS = 30000; // see the empirical calibration in this comment's neighbor below

const recs = loadBotLedger();
const deaths = recs.filter((r) => r.ev === 'death');
const interventions = recs.filter((r) => r.ev === 'intervention');
const decisions = loadDecisions();

// TWO decider-attribution signals, not one — live-caught building this against soak-3's own
// archived window (2026-09-03): a naive `dirDispatch(`-only regex flagged 19/25 interventions
// as "human", but every single one turned out to be `decider.js`'s own periodic context-
// gathering read (`return Object.keys(globalThis.__skills.registry);`, decider.js:198 — a
// plain read, never a dispatch, so the narrow regex correctly doesn't match it and WRONGLY
// counts it as a human touching the bot). Confirmed genuinely decider-caused, not a human, by
// correlating each one against decisions.jsonl's own recorded decision timestamps for this
// bot: every flagged intervention sat within 21.6s of a real decision record (context-gather
// always precedes the decision it feeds), a tight, consistent cluster far short of this
// window's own decision cadence (~17 decisions/hour here, i.e. one roughly every 3-4 minutes)
// — not the kind of gap a coincidence would produce. `DECIDER_CORRELATE_MS` (30s) is set with
// margin above that observed max, not tuned to make this pass. Signal 1 (explicit
// `dirDispatch(`/`dirClose(` calls) is kept as a first, zero-ambiguity pass; signal 2 (timing
// correlation) catches everything signal 1's own narrow shape misses. Anything BOTH signals
// miss is reported as a genuine human intervention — this can still be a false positive in
// principle (a real human action coincidentally landing within 30s of an unrelated decision),
// which is exactly why the report below prints the raw list for a human to cross-check rather
// than trusting the automated verdict blindly, same caution metrics.mjs's own #52 tripwire
// comment already states.
const isDeciderCall = (r) => {
  if (/dirDispatch\(|dirClose\(/.test(r.preview || '')) return true;
  return decisions.some((d) => Math.abs(d.t - r.t) <= DECIDER_CORRELATE_MS);
};
const deciderCalls = interventions.filter(isDeciderCall);
const humanInterventions = interventions.filter((r) => !isDeciderCall(r));

// #4 (soak-4, 2026-09-03) found zero deaths + zero human help is a real but NARROW claim -- a
// bot pinned at food:0/hp10 for the whole window survived in the sense that mattered to the
// binary check, but a single real fight would have killed it, which is exactly the situation
// "survives real threats" is supposed to rule out. GOAL.md's criterion 3 gained an explicit
// sustained-critical-vitals floor over this (2026-09-03, commit f4138d6, lead-adopted from the
// soak-4 audit proposal): "...without driver help, and without sustained critical vitals --
// never hp <=6 or food 0 for more than 10 continuous minutes." THIS DOES flip the c3 boolean
// (unlike criterion 4's vacuous flag, which only annotates) -- the GOAL TEXT changed, this is
// now reading the new text correctly, not silently reinterpreting the old one. See
// bench/lib/vitals-floor.mjs for the streak-detection logic and its own note on why hp<=6
// doesn't match either of survival.js's own two "critical" numbers (CRIT=4, hpPanic=8).
const withVitals = recs.filter((r) => typeof r.hp === 'number' && typeof r.food === 'number');
const lastVitals = withVitals.length ? withVitals[withVitals.length - 1] : null;
const vitalsCritical = lastVitals && (lastVitals.food <= 6 || lastVitals.hp <= 6);
const vitalsFloor = detectSustainedCriticalVitals(withVitals);
const c3 = deaths.length === 0 && humanInterventions.length === 0 && !vitalsFloor.sustained;

// ---------------- window-truncation note ----------------
let windowTruncated = null;
if (LEDGER_END) {
  const ledgerEndMs = Date.parse(LEDGER_END);
  if (Number.isFinite(ledgerEndMs) && ledgerEndMs < untilMs) {
    windowTruncated = {
      declaredUntil: UNTIL || new Date(untilMs).toISOString(),
      ledgerEnd: LEDGER_END,
      truncatedByMs: untilMs - ledgerEndMs,
      note: `window truncated at ${LEDGER_END} — the pre-registered --until (${UNTIL || new Date(untilMs).toISOString()}) was never reached; this grade covers the actual ~${Math.round((ledgerEndMs - sinceMs) / 60000)} minutes observed, not the full pre-registered window`,
    };
  }
}

// ---------------- report ----------------
const overall = c1 && c2 && c3 && c4;
console.log(`humanbar4 ${LABEL}: ${overall ? 'PASS — all four human-bar criteria met' : 'FAIL'}`);
if (windowTruncated) console.log(`  WINDOW TRUNCATED: ${windowTruncated.note}`);
console.log(`  1. playcheck PLAYING:        ${c1 ? 'PASS' : 'FAIL'}  (${hb.playcheck ? hb.playcheck.verdict : 'no data'}${hb.playcheck && hb.playcheck.stationaryPct != null ? `, ${hb.playcheck.stationaryPct}% stationary, ${hb.playcheck.productiveActionsPer10Min}/10min` : ''})`);
console.log(`  2. --direction-gate PASS:    ${c2 ? 'PASS' : 'FAIL'}  (opened ${hb.direction ? hb.direction.opened : '?'}, closed ${hb.direction ? hb.direction.closed : '?'}, unclosed ${hb.direction ? hb.direction.unclosed : '?'}, latency p50 ${hb.direction ? hb.direction.latency_p50_ms : '?'}ms)`);
console.log(`  3. survives unaided:         ${c3 ? 'PASS' : 'FAIL'}  (deaths ${deaths.length}, non-decider interventions ${humanInterventions.length}${interventions.length ? ` [decider:${deciderCalls.length} total:${interventions.length}]` : ''}, vitals floor ${vitalsFloor.sustained ? 'FAIL' : 'ok'})`);
if (humanInterventions.length) {
  console.log('     non-decider interventions (cross-check against known induction timestamps before calling this a real fail):');
  for (const r of humanInterventions.slice(0, 10)) console.log(`       ${new Date(r.t).toISOString()}  ${r.route}  ${(r.preview || '').slice(0, 80)}`);
}
if (vitalsFloor.sustained) {
  const w = vitalsFloor.worst;
  console.log(`     VITALS FLOOR FAILED: hp<=${CRITICAL_HP} or food=0 held continuously for ${Math.round(w.durationMs / 60000 * 10) / 10} min (${new Date(w.start).toISOString()} -> ${new Date(w.end).toISOString()}), over the ${Math.round(CRITICAL_SUSTAIN_MS / 60000)}-min floor (GOAL.md criterion 3, adopted 2026-09-03). This is a REAL fail, not a caveat -- zero deaths / zero human help does not offset it.`);
} else if (vitalsCritical) {
  console.log(`     CAVEAT: last logged vitals in the window (${new Date(lastVitals.t).toISOString()}) — hp ${lastVitals.hp}/20, food ${lastVitals.food}/20. Under the ${Math.round(CRITICAL_SUSTAIN_MS / 60000)}-min sustained floor so criterion 3 still passes, but this PASS does not mean the bot was actually safe.`);
} else if (lastVitals) {
  console.log(`     last logged vitals: hp ${lastVitals.hp}/20, food ${lastVitals.food}/20 (${new Date(lastVitals.t).toISOString()})`);
}
const sitesNote = trail ? ` [${trail.findings.sitesChecked} site(s) checked — chop clusters seen ${trail.sitesSeen.chopClusters}, dig clusters seen ${trail.sitesSeen.digClusters}${trail.vacuous ? `, VACUOUS${trail.vacuousReasons && trail.vacuousReasons.length ? ' — ' + trail.vacuousReasons.join('; ') : ' — below the site-count confidence floor'}` : ''}]` : '';
console.log(`  4. human-looking trail:      ${c4 ? 'PASS' : (trail ? trail.verdict : 'NO DATA')}  ${trail ? `(${trail.reasons.length ? trail.reasons.join('; ') : 'clean'})${sitesNote}` : '(trail.mjs did not produce a gate file)'}`);
console.log(`  artifacts: ${humanbarGatePath}${trail ? `, ${trailGatePath}` : ''}`);

const out = {
  label: LABEL, bot: BOT, since: SINCE, until: UNTIL || new Date(untilMs).toISOString(), at: new Date().toISOString(),
  pass: overall,
  ...(windowTruncated ? { windowTruncated } : {}),
  criteria: {
    playcheck: { pass: c1, verdict: hb.playcheck ? hb.playcheck.verdict : null },
    directionGate: { pass: c2, opened: hb.direction ? hb.direction.opened : null, closed: hb.direction ? hb.direction.closed : null, unclosed: hb.direction ? hb.direction.unclosed : null },
    survivesUnaided: { pass: c3, deaths: deaths.length, humanInterventions: humanInterventions.length, deciderInterventions: deciderCalls.length,
      humanInterventionDetail: humanInterventions.map((r) => ({ t: new Date(r.t).toISOString(), route: r.route, preview: (r.preview || '').slice(0, 200) })),
      lastVitals: lastVitals ? { t: new Date(lastVitals.t).toISOString(), hp: lastVitals.hp, food: lastVitals.food } : null,
      vitalsCritical: Boolean(vitalsCritical),
      vitalsFloor: { pass: !vitalsFloor.sustained, criticalHp: CRITICAL_HP, sustainMs: CRITICAL_SUSTAIN_MS,
        worst: vitalsFloor.worst ? { start: new Date(vitalsFloor.worst.start).toISOString(), end: new Date(vitalsFloor.worst.end).toISOString(), durationMs: vitalsFloor.worst.durationMs, samples: vitalsFloor.worst.samples } : null,
        streakCount: vitalsFloor.streaks.length } },
    trail: { pass: c4, verdict: trail ? trail.verdict : null, reasons: trail ? trail.reasons : ['trail.mjs produced no gate file'],
      sitesChecked: trail ? trail.findings.sitesChecked : 0, sitesSeen: trail ? trail.sitesSeen : null,
      vacuous: Boolean(trail && trail.vacuous), vacuousReasons: trail ? (trail.vacuousReasons || []) : [] },
  },
  artifacts: { humanbar: humanbarGatePath, trail: fs.existsSync(trailGatePath) ? trailGatePath : null },
};
fs.mkdirSync(path.join(ROOT, 'bench', 'gates'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench', 'gates', `humanbar4-${LABEL}.json`), JSON.stringify(out, null, 2));
process.exit(overall ? 0 : 1);
