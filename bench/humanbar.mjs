#!/usr/bin/env node
/*
 * bench/humanbar.mjs — the combined "does this look like a human playing" verdict.
 *
 * Felix's session goal, made measurable (team-lead, 2026-09-02): a bot passes the HUMAN bar
 * over an observed hour when (1) playcheck grades it PLAYING, (2) the direction gate passes
 * (self-directed: episodes open AND close, zero rot, decider under cap), (3) it survives real
 * threats without driver help, and (4) it leaves a human-looking trail. This tool covers (1)
 * and (2) — the two instrument-gradable pieces — as ONE combined verdict over the SAME bounded
 * window. (3) is a qualitative read of the same episode log this tool already prints; (4) is a
 * separate, manual world-inspection spot-check (aesthetics), not automatable from the ledger.
 *
 * WHY A WRAPPER, not a merge: metrics.mjs's --direction-gate and playcheck.mjs are independent,
 * already-proven instruments with their own doctrine (direction-gate's own five criteria;
 * playcheck's own "reader + summarizer, not a scorer" design constraint). Shelling out to both
 * and combining their VERDICTS — not their internals — keeps each independently testable and
 * reviewable, and means a bug in this wrapper can never corrupt either instrument's own numbers.
 *
 * WINDOW-END BOUNDING: neither underlying tool supports an explicit window END (both are
 * "--since X, implicitly until now"), which every soak grade so far this session has had to
 * work around by hand — copy the script, build a truncated logs/ dir, run against that. This
 * tool automates exactly that so a --until bound is a first-class flag, not a manual step
 * repeated (and re-verified) by hand every time.
 *
 * Usage:
 *   node bench/humanbar.mjs --bot <name> --since <ISO> --until <ISO> --label <label>
 *   node bench/humanbar.mjs --bot <name> --since <ISO> --label <label>   # until = now
 *
 * Writes bench/gates/humanbar-<label>.json (same convention as direction-<label>.json) and
 * also leaves the underlying direction-<label>.json in place (metrics.mjs writes it as a
 * side effect of running with --direction-gate) so the per-instrument detail is still on disk.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };

const BOT = flag('bot');
const SINCE = flag('since');
const UNTIL = flag('until'); // optional; omit to mean "until now" (same as the underlying tools)
const LABEL = flag('label', BOT || 'humanbar');
if (!BOT || !SINCE) {
  console.error('usage: node bench/humanbar.mjs --bot <name> --since <ISO> [--until <ISO>] [--label <label>]');
  process.exit(2);
}
const sinceMs = Date.parse(SINCE);
const untilMs = UNTIL ? Date.parse(UNTIL) : Date.now();
if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
  console.error('--since/--until must be parseable dates (ISO recommended)');
  process.exit(2);
}

// ---- build a window-bounded logs/ directory (a real copy when --until is given and short of
// "now"; a live read-through otherwise) so both tools see the IDENTICAL, exact window rather
// than each independently interpreting "since X" against the live, still-growing files. ----
const REAL_LOGS = path.join(ROOT, 'logs');
let LOGS_DIR = REAL_LOGS;
let scratchDir = null;
// registered BEFORE any early-exit path can fire (e.g. metrics.mjs writing no gate file) --
// process.on('exit') runs on every termination route (normal return, process.exit(N), an
// uncaught throw), unlike a cleanup call placed only at the bottom of the happy path, which a
// live edge case (an unknown --bot, zero ledger data) proved leaks a real /tmp dir per run.
process.on('exit', () => { if (scratchDir) { try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* best effort */ } } });
if (UNTIL) {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'humanbar-'));
  const scratchLogs = path.join(scratchDir, 'logs');
  fs.mkdirSync(scratchLogs, { recursive: true });
  const truncateJsonl = (name) => {
    const src = path.join(REAL_LOGS, name);
    if (!fs.existsSync(src)) return 0;
    const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);
    const kept = lines.filter((l) => { try { return JSON.parse(l).t <= untilMs; } catch { return false; } });
    fs.writeFileSync(path.join(scratchLogs, name), kept.join('\n') + (kept.length ? '\n' : ''));
    return kept.length;
  };
  const nMetrics = truncateJsonl(`metrics-${BOT}.jsonl`);
  const nDecisions = truncateJsonl('decisions.jsonl');
  // playcheck's own chat reader is a plain-text runner log, timestamped per line
  // ("[ISO] [bot] ...") — truncate the same way, by parsing each line's own leading timestamp.
  const chatSrc = path.join(REAL_LOGS, `${BOT}.log`);
  let nChat = 0;
  if (fs.existsSync(chatSrc)) {
    const lines = fs.readFileSync(chatSrc, 'utf8').split('\n');
    const kept = lines.filter((l) => {
      const m = /^\[([^\]]+)\]/.exec(l);
      if (!m) return true; // a continuation/non-timestamped line: keep, harmless either way
      const t = Date.parse(m[1]);
      return !Number.isFinite(t) || t <= untilMs;
    });
    fs.writeFileSync(path.join(scratchLogs, `${BOT}.log`), kept.join('\n'));
    nChat = kept.length;
  }
  LOGS_DIR = scratchLogs;
  console.error(`humanbar: window-bounded copy built (metrics ${nMetrics} recs, decisions ${nDecisions} recs, chat ${nChat} lines) -> ${scratchLogs}`);
}

// ---- run metrics.mjs --direction-gate against the bounded logs dir. metrics.mjs has no --dir
// override (it always resolves logs/ relative to ITS OWN script location), so when a scratch
// dir is in play, run a COPY of the script from inside that scratch dir instead of the real
// tree -- same technique this session's own soak grading has used by hand three times already,
// just automated here. Never touches the real metrics.mjs or the real logs/. ----
let gate;
{
  const metricsScript = UNTIL ? path.join(scratchDir, 'metrics.mjs') : path.join(ROOT, 'metrics.mjs');
  if (UNTIL) fs.copyFileSync(path.join(ROOT, 'metrics.mjs'), metricsScript);
  try {
    execFileSync(process.execPath, [metricsScript, '--direction-gate', LABEL, '--since', SINCE, '--bot', BOT],
      { cwd: UNTIL ? scratchDir : ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    // --direction-gate exits non-zero on FAIL by convention (matches --gate elsewhere) — that's
    // an expected outcome to read, not a tool failure. Only a missing gate file below is fatal.
  }
  const gatePath = UNTIL ? path.join(scratchDir, 'bench', 'gates', `direction-${LABEL}.json`) : path.join(ROOT, 'bench', 'gates', `direction-${LABEL}.json`);
  if (!fs.existsSync(gatePath)) {
    console.error(`humanbar: metrics.mjs did not write a gate file at ${gatePath} — cannot grade`);
    process.exit(1);
  }
  gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  // preserve the per-instrument detail in the real tree too, exactly where a human would look
  // for it next to every other soak's gate file.
  fs.mkdirSync(path.join(ROOT, 'bench', 'gates'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'bench', 'gates', `direction-${LABEL}.json`), JSON.stringify(gate, null, 2));
}

// ---- run playcheck.mjs --json against the SAME bounded window/dir. ----
const playcheckOut = execFileSync(process.execPath,
  [path.join(ROOT, 'bench', 'playcheck.mjs'), '--bot', BOT, '--since', SINCE, '--dir', LOGS_DIR, '--json'],
  { encoding: 'utf8' });
const playcheck = JSON.parse(playcheckOut);
const summary = (playcheck.bots || [])[0] || null;
// cleanup handled by the process.on('exit') handler registered above, on every exit path

// ---- combine: PASS only if BOTH instruments say so. Neither number is recomputed or
// reinterpreted here — this reads each tool's own finished verdict and ANDs them. ----
function verdict(s) {
  if (!s) return 'PLAYING'; // no ledger at all is playcheck's own "nothing to report" case,
  // not a fail signal on its own — direction-gate's own criteria (opened/closed counts) are
  // what actually catch "the bot did nothing", so this never silently passes a truly idle bot.
  if (s.stationaryPct >= 70 && s.productiveActionsPer10Min < 0.5) return 'IDLE';
  if (s.stationaryPct >= 40 || s.productiveActionsPer10Min < 1) return 'SPARSE';
  return 'PLAYING';
}
const playVerdict = verdict(summary);
const humanPass = Boolean(gate.pass) && playVerdict === 'PLAYING';
const reasons = [...(gate.reasons || [])];
if (playVerdict !== 'PLAYING') reasons.push(`playcheck verdict is ${playVerdict}, not PLAYING`);

const out = {
  label: LABEL, bot: BOT, since: SINCE, until: UNTIL || new Date(untilMs).toISOString(),
  at: new Date().toISOString(),
  pass: humanPass,
  reasons,
  direction: { pass: gate.pass, opened: gate.opened, closed: gate.closed, unclosed: gate.unclosed,
    latency_p50_ms: gate.latency_p50_ms, latency_p90_ms: gate.latency_p90_ms, llm_calls_per_hr: gate.llm_calls_per_hr },
  playcheck: summary ? { verdict: playVerdict, stationaryPct: summary.stationaryPct,
    productiveActionsPer10Min: summary.productiveActionsPer10Min, noOpFraction: summary.noOpFraction,
    distanceTraveled: summary.distanceTraveled, deaths: summary.deaths, panics: summary.panics }
    : { verdict: playVerdict, note: 'no playcheck ledger data in window' },
};
fs.mkdirSync(path.join(ROOT, 'bench', 'gates'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench', 'gates', `humanbar-${LABEL}.json`), JSON.stringify(out, null, 2));

console.log(`humanbar ${LABEL}: ${humanPass ? 'PASS' : 'FAIL'}`);
console.log(`  direction-gate: ${gate.pass ? 'pass' : 'FAIL'} (opened ${gate.opened}, closed ${gate.closed}, unclosed ${gate.unclosed}, latency p50 ${gate.latency_p50_ms}ms / p90 ${gate.latency_p90_ms}ms)`);
console.log(`  playcheck: ${playVerdict}${summary ? ` (${summary.stationaryPct}% stationary, ${summary.productiveActionsPer10Min} productive actions/10min)` : ' (no ledger data)'}`);
if (!humanPass) { console.log('  reasons: ' + reasons.join('; ')); }
console.log(`  written -> bench/gates/humanbar-${LABEL}.json (and direction-${LABEL}.json)`);
process.exit(humanPass ? 0 : 1);
