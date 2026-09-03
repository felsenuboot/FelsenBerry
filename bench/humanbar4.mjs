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
if (!BOT || !SINCE || !INSPECTOR_PORT) {
  console.error('usage: node bench/humanbar4.mjs --bot <name> --since <ISO> [--until <ISO>] --inspector-port <port> [--label <label>]');
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
const c3 = deaths.length === 0 && humanInterventions.length === 0;

// ---------------- report ----------------
const overall = c1 && c2 && c3 && c4;
console.log(`humanbar4 ${LABEL}: ${overall ? 'PASS — all four human-bar criteria met' : 'FAIL'}`);
console.log(`  1. playcheck PLAYING:        ${c1 ? 'PASS' : 'FAIL'}  (${hb.playcheck ? hb.playcheck.verdict : 'no data'}${hb.playcheck && hb.playcheck.stationaryPct != null ? `, ${hb.playcheck.stationaryPct}% stationary, ${hb.playcheck.productiveActionsPer10Min}/10min` : ''})`);
console.log(`  2. --direction-gate PASS:    ${c2 ? 'PASS' : 'FAIL'}  (opened ${hb.direction ? hb.direction.opened : '?'}, closed ${hb.direction ? hb.direction.closed : '?'}, unclosed ${hb.direction ? hb.direction.unclosed : '?'}, latency p50 ${hb.direction ? hb.direction.latency_p50_ms : '?'}ms)`);
console.log(`  3. survives unaided:         ${c3 ? 'PASS' : 'FAIL'}  (deaths ${deaths.length}, non-decider interventions ${humanInterventions.length}${interventions.length ? ` [decider:${deciderCalls.length} total:${interventions.length}]` : ''})`);
if (humanInterventions.length) {
  console.log('     non-decider interventions (cross-check against known induction timestamps before calling this a real fail):');
  for (const r of humanInterventions.slice(0, 10)) console.log(`       ${new Date(r.t).toISOString()}  ${r.route}  ${(r.preview || '').slice(0, 80)}`);
}
const sitesNote = trail ? ` [${trail.findings.sitesChecked} site(s) checked — chop clusters seen ${trail.sitesSeen.chopClusters}, dig clusters seen ${trail.sitesSeen.digClusters}${!trail.findings.sitesChecked ? ', NOTHING TO INSPECT — this PASS is vacuous, not a confirmed-clean trail' : ''}]` : '';
console.log(`  4. human-looking trail:      ${c4 ? 'PASS' : (trail ? trail.verdict : 'NO DATA')}  ${trail ? `(${trail.reasons.length ? trail.reasons.join('; ') : 'clean'})${sitesNote}` : '(trail.mjs did not produce a gate file)'}`);
console.log(`  artifacts: ${humanbarGatePath}${trail ? `, ${trailGatePath}` : ''}`);

const out = {
  label: LABEL, bot: BOT, since: SINCE, until: UNTIL || new Date(untilMs).toISOString(), at: new Date().toISOString(),
  pass: overall,
  criteria: {
    playcheck: { pass: c1, verdict: hb.playcheck ? hb.playcheck.verdict : null },
    directionGate: { pass: c2, opened: hb.direction ? hb.direction.opened : null, closed: hb.direction ? hb.direction.closed : null, unclosed: hb.direction ? hb.direction.unclosed : null },
    survivesUnaided: { pass: c3, deaths: deaths.length, humanInterventions: humanInterventions.length, deciderInterventions: deciderCalls.length,
      humanInterventionDetail: humanInterventions.map((r) => ({ t: new Date(r.t).toISOString(), route: r.route, preview: (r.preview || '').slice(0, 200) })) },
    trail: { pass: c4, verdict: trail ? trail.verdict : null, reasons: trail ? trail.reasons : ['trail.mjs produced no gate file'],
      sitesChecked: trail ? trail.findings.sitesChecked : 0, sitesSeen: trail ? trail.sitesSeen : null,
      vacuous: Boolean(trail && !trail.findings.sitesChecked) },
  },
  artifacts: { humanbar: humanbarGatePath, trail: fs.existsSync(trailGatePath) ? trailGatePath : null },
};
fs.mkdirSync(path.join(ROOT, 'bench', 'gates'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench', 'gates', `humanbar4-${LABEL}.json`), JSON.stringify(out, null, 2));
process.exit(overall ? 0 : 1);
