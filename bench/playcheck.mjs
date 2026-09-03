#!/usr/bin/env node
/*
 * bench/playcheck.mjs — "does this bot look like a person playing, or is it standing
 * around?" A node reader over telemetry.js's existing JSONL ledger. Nothing new is
 * instrumented; this is a summarizer, not a scorer.
 *
 *   node bench/playcheck.mjs                       # all bots, last 30 minutes
 *   node bench/playcheck.mjs --bot LokalLothar      # one bot
 *   node bench/playcheck.mjs --since 2h             # relative window ("30m", "2h", "1d")
 *   node bench/playcheck.mjs --since 2026-09-01     # or an absolute date (Date.parse)
 *   node bench/playcheck.mjs --json                 # machine-readable
 *   node bench/playcheck.mjs --dir ../bots/logs      # point at a different logs dir
 *                                                    # (e.g. running from a worktree)
 *   node bench/playcheck.mjs --until <ISO>           # pin the window's END for a RETROACTIVE
 *                                                    # grade (default: Date.now(), i.e. "live").
 *                                                    # Without this, stationaryPct/productive-
 *                                                    # ActionsPer10Min silently stretch to
 *                                                    # (real-now - since) even when the caller
 *                                                    # (e.g. humanbar.mjs) only wants a bounded
 *                                                    # hour graded some time after it closed.
 *
 * WHY THIS EXISTS: every metric this project has (FSR, assertTask verdicts, rung
 * counters) is internal — none of it says what a human WATCHING the bot would
 * conclude. A bot can pass every assertTask and still look dead on screen (see: the
 * chopTrees-kit_missing / collectDrops-picked:0 loop this file's own dry run caught
 * live on the first try). This reads ONLY observable behavior: things a person
 * standing next to the bot could see it do. Internal success/fail verdicts never
 * enter the verdict line below.
 *
 * DESIGN CONSTRAINT, deliberately kept: this is a reader + summarizer over the
 * EXISTING ledger (telemetry.js schema v2), not a new metrics pipeline. Where an
 * observable needs something the ledger doesn't carry, that is reported as a
 * GAP line, not faked with a new instrument. See the "chat" section below for the
 * one place this reads outside the JSONL ledger (the plain-text runner log), and
 * why that's a read of EXISTING data rather than new instrumentation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { attributeStalls } from './lib/stall-attribution.mjs';
import { summarizeChestEvents, computePositionTrace } from './lib/ledger-gaps.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const has = (n) => argv.includes('--' + n);

// --dir overrides the logs directory — needed when running from a git worktree, where
// runtime data (logs/, untracked) doesn't exist locally; the bots write it wherever
// runner.js actually runs from. Defaults to <script>/../logs, same convention as metrics.mjs.
const LOGS = flag('dir') ? path.resolve(flag('dir')) : path.join(ROOT, 'logs');

// ---------- window ----------
// "30m" / "2h" / "1d" convenience on top of metrics.mjs's existing Date.parse support —
// a live dry-run wants "how has it been for the last half hour", not an ISO timestamp.
function parseSince(s) {
  if (!s) return Date.now() - 30 * 60 * 1000; // default: last 30 minutes
  const m = /^(\d+)(m|h|d)$/.exec(String(s).trim());
  if (m) {
    const n = Number(m[1]);
    const mult = { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
    return Date.now() - n * mult;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now() - 30 * 60 * 1000;
}
const SINCE = parseSince(flag('since'));
// NOW anchors the window's END for stationaryPct/productiveActionsPer10Min's own denominator.
// Defaults to the real clock (live "how's it doing right now" usage); --until pins it for a
// retroactive grade, so a delayed run doesn't silently stretch the window past the bot's actual
// graded hour (see the humanbar.mjs usage note above -- this is exactly the bug it hit).
const untilFlag = flag('until');
const untilParsed = untilFlag ? Date.parse(untilFlag) : NaN;
const NOW = Number.isFinite(untilParsed) ? untilParsed : Date.now();
const WINDOW_MS = Math.max(1, NOW - SINCE);

// ---------- load one bot's ledger, filtered to the window ----------
function loadBot(botName) {
  const file = path.join(LOGS, `metrics-${botName}.jsonl`);
  const recs = [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return recs; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.t < SINCE) continue;
    recs.push(r);
  }
  return recs;
}

function listBots() {
  let files = [];
  try { files = fs.readdirSync(LOGS).filter((f) => /^metrics-.*\.jsonl$/.test(f)); } catch { /* none yet */ }
  return files.map((f) => f.replace(/^metrics-|\.jsonl$/g, '')).sort();
}

// ---------- chat: the ONE place this reads outside the JSONL ledger ----------
// telemetry.js has no chat event at all — chat only ever reaches the runner's plain-text
// stdout log (logs/<bot>.log). That is EXISTING data (the runner already writes it for
// every bot, every line, unconditionally) — reading it is not new instrumentation, it's
// reading a different file this project already produces. A shared Minecraft world means
// one bot's log also contains OTHER bots' chat (verified live this session: ShakeoutShorty's
// lines showed up inside ZitterZorro's own log) — filtered out below by requiring the
// bracketed `[botName]` prefix AND (for <chat> lines specifically) the speaker name to match,
// since <say> is always the bot's own narration but <chat> echoes the whole server.
const CHAT_LINE = /^\[(\S+)\]\s+\[(\S+)\]\s+<(say|chat)>\s*(?:<(\S+)>\s*)?(.*)$/;
function readChat(botName) {
  let raw;
  try { raw = fs.readFileSync(path.join(LOGS, `${botName}.log`), 'utf8'); } catch { return { lines: [], gap: true }; }
  const lines = [];
  for (const line of raw.split('\n')) {
    const m = CHAT_LINE.exec(line);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (!Number.isFinite(t) || t < SINCE) continue;
    const kind = m[3], speaker = m[4], text = m[5];
    if (kind === 'chat' && speaker && speaker !== botName) continue; // another bot's line, shared world chat
    lines.push({ t, text });
  }
  return { lines, gap: false };
}

// ---------- per-bot aggregation ----------
const LOG_ITEM = /_log$/;

function summarize(botName) {
  const recs = loadBot(botName);
  if (!recs.length) return null;

  let blocksMined = 0;                 // dig_batch is the authoritative total: it flushes
                                        // every 64 digs AND at every task boundary, whether
                                        // or not a task was active, so it never double-counts
                                        // against task_end.digs (which is per-task only).
  let itemsGained = 0;
  const itemsGainedByName = {};
  // #69 gap 1 (2026-09-03): itemsDepositedFromTaskInference is the OLD, imperfect inference
  // (depositToChest task_end.collected, which #69's own text warns "may not represent the
  // same thing consistently across deposit paths") — kept for transparency/comparison, no
  // longer the authoritative number. See itemsDeposited/itemsWithdrawn below, sourced from the
  // real ev:'chest' ledger events telemetry.js has been emitting all along.
  let itemsDepositedFromTaskInference = 0;
  let logsChopped = 0;
  let structuresPlaced = 0;
  let animalsKilled = 0;
  let distanceTraveled = 0;            // sum(task_end.moved) + sum(standalone goto.moved) —
                                        // NOT both for the same movement: a goto's `moved`
                                        // is already folded into its owning task's `moved`
                                        // via the same 500ms sampler (telemetry.js:188-189),
                                        // so only goto events with tid:null (no owning task)
                                        // are added here, to avoid counting the same steps twice.
  let deaths = 0;
  let panics = 0;
  let taskCount = 0;
  let noOpTasks = 0;
  let productiveTasks = 0;
  let activeMs = 0;                    // sum of task durations — the ledger's only direct
                                        // "something was running" signal (see GAPS below)
  // soak #5 follow-up (2026-09-03): the raw material for stallAttribution() below, collected
  // here alongside everything else this loop already reads (one pass, no second ledger scan).
  const dirOpens = [], dirCloses = [], notes = [];
  // #69 gaps 1+2 (2026-09-03): both are ALREADY WIRED in telemetry.js (real ev:'chest'/ev:'pos'
  // records confirmed live) -- the actual gap was that nothing ever read them. Collected here,
  // same single pass, and summarized below via bench/lib/ledger-gaps.mjs.
  const chestRecs = [], posRecs = [];

  for (const r of recs) {
    if (r.ev === 'dig_batch') blocksMined += r.digs || 0;
    if (r.ev === 'death') deaths++;
    if (r.ev === 'panic' && r.phase === 'enter') panics++;
    if (r.ev === 'direction' && r.op === 'open') dirOpens.push(r);
    if (r.ev === 'direction' && r.op === 'close') dirCloses.push(r);
    if (r.ev === 'note' && r.agenda) notes.push(r);
    if (r.ev === 'chest') chestRecs.push(r);
    if (r.ev === 'pos') posRecs.push(r);
    if (r.ev === 'goto' && r.tid == null) distanceTraveled += r.moved || 0;
    if (r.ev === 'task_end') {
      taskCount++;
      activeMs += r.ms || 0;
      distanceTraveled += r.moved || 0;
      structuresPlaced += r.placed || 0;
      if (r.skill === 'huntAnimals' && r.outcome === 'ok') animalsKilled++;
      const collected = r.collected || {};
      let taskItems = 0;
      for (const [name, n] of Object.entries(collected)) {
        itemsGained += n; taskItems += n;
        itemsGainedByName[name] = (itemsGainedByName[name] || 0) + n;
        if (LOG_ITEM.test(name) && r.skill === 'chopTrees') logsChopped += n;
      }
      if (r.skill === 'depositToChest') itemsDepositedFromTaskInference += taskItems;
      // Soak-#4 human-bar prep: a genuine RESTOCK depot search that comes up short
      // (checked several chests, none had what was needed — `outcome:'ok', result.
      // stocked:false`) reports `moved:0, digs:0, placed:0, collected:{}` even after
      // real `gotos` (short chest-to-chest hops don't register on the same distance
      // tracker full travel does) — measured directly against real ledgers before this
      // fix: EVERY stocked:false restock record checked (10/10) showed gotos:8-9,
      // ms~2000, and all four of the OLD observable fields at zero. A person watching
      // a bot walk between three chests and come away empty-handed would call that
      // "looking for supplies", not "standing still" — `gotos>0` is a real, visible
      // travel-attempt count (never fabricated for a task that never actually moved:
      // the genuinely-stuck #101 case — ensureTool wedged in place on a table it
      // can't re-place — reports gotos:0, so this does not blur the two apart).
      const observable = (r.digs || 0) > 0 || (r.placed || 0) > 0 || (r.moved || 0) > 1
        || taskItems > 0 || (r.gotos || 0) > 0;
      if (observable) productiveTasks++; else noOpTasks++;
    }
  }

  const stationaryMs = Math.max(0, WINDOW_MS - activeMs);
  const stationaryPct = Math.round((stationaryMs / WINDOW_MS) * 1000) / 10;
  const per10 = productiveTasks / (WINDOW_MS / 600000);

  const chat = readChat(botName);
  const chatCount = chat.lines.length;

  // #69 gaps 1+2: real chest totals + a real, task-independent position trace. itemsDeposited
  // FALLS BACK to the old task-inference only when this bot's window has ZERO chest events at
  // all (an older ledger predating M.chest()'s call sites, or a genuine window where nothing
  // was ever deposited) — real events, once present, are always the authoritative source; never
  // silently summed together with the inference (that would double-count on any overlap).
  const chestSummary = summarizeChestEvents(chestRecs);
  const itemsDeposited = chestSummary.events ? chestSummary.deposited : itemsDepositedFromTaskInference;
  const posTrace = computePositionTrace(posRecs, SINCE, NOW);
  // percent of the KNOWN portion of the trace (stationary+moving, excluding the unknown tail/
  // head before the first sample or after the last) that was real, measured stationary time --
  // deliberately NOT divided by the whole window, which would let a thin sample (most of the
  // window "unknown") silently dilute toward either extreme. `coverage` reports what fraction
  // of the window the trace actually covers, so a reader can judge how much to trust the pct --
  // same "don't overclaim a thin sample" doctrine as trail.mjs's own vacuous flag.
  const knownMs = posTrace.stationaryMs + posTrace.movingMs;
  const realStationaryPct = knownMs > 0 ? Math.round((posTrace.stationaryMs / knownMs) * 1000) / 10 : null;
  const posTraceCoverage = posTrace.windowMs > 0 ? Math.round((knownMs / posTrace.windowMs) * 1000) / 10 : null;

  // soak #5 follow-up: "the gate file should attribute the stationary time by cause... so the
  // next soak's verdict names its wall without hand-reading decisions.jsonl" — computed only
  // when the verdict ISN'T PLAYING (a healthy hour has nothing to attribute, and running this
  // unconditionally would print a wall of zeros for the common case). `verdict()` is a hoisted
  // function declaration below in this same file — safe to call here.
  const v = verdict({ stationaryPct, productiveActionsPer10Min: Math.round(per10 * 10) / 10 });
  const stallAttribution = v !== 'PLAYING' ? attributeStalls({ opens: dirOpens, closes: dirCloses, notes, sinceMs: SINCE, untilMs: NOW }) : null;

  return {
    bot: botName,
    windowMs: WINDOW_MS,
    blocksMined, logsChopped, structuresPlaced, animalsKilled,
    itemsGained, itemsGainedByName, itemsDeposited,
    itemsWithdrawn: chestSummary.withdrawn,
    itemsDepositedFromTaskInference,
    chestEvents: chestSummary.events,
    distanceTraveled: Math.round(distanceTraveled * 10) / 10,
    deaths, panics,
    taskCount, productiveTasks, noOpTasks,
    noOpFraction: taskCount ? Math.round((noOpTasks / taskCount) * 1000) / 1000 : null,
    stationaryPct,
    // #69 gap 2: a REAL, task-independent position trace — closes the exact blind spot #69
    // named ("a bot technically inside a task but wedged/frozen would still count as active").
    // null when there's no position-trace data in the window at all (an older ledger, or a
    // window shorter than the trace's own sampling cadence) — never a fabricated number.
    realStationaryPct, posTraceCoverage, posTraceSamples: posTrace.samples,
    productiveActionsPer10Min: Math.round(per10 * 10) / 10,
    stallAttribution,
    chatCount,
    chatGap: chat.gap,
  };
}

// ---------- verdict: a plain threshold on the one number a watcher would actually use.
// Deliberately not a weighted score (design constraint: reader + summarizer, not a
// tunable scorer). Stationary% is primary because it's the most direct answer to "is it
// doing anything at all"; productive actions/10min breaks the tie for a bot that moves a
// lot but produces nothing (a wedge-and-retry loop would score low-stationary here, so
// per10 catches it where stationary% alone would be fooled).
function verdict(s) {
  if (s.stationaryPct >= 70 && s.productiveActionsPer10Min < 0.5) return 'IDLE';   // also
                                                            // covers taskCount:0 (per10 is 0)
  if (s.stationaryPct >= 40 || s.productiveActionsPer10Min < 1) return 'SPARSE';
  return 'PLAYING';
}

function oneLine(s) {
  const bits = [];
  if (s.blocksMined) bits.push(`${s.blocksMined} blocks mined`);
  if (s.logsChopped) bits.push(`${s.logsChopped} logs chopped`);
  if (s.structuresPlaced) bits.push(`${s.structuresPlaced} placed`);
  if (s.animalsKilled) bits.push(`${s.animalsKilled} kills`);
  if (s.itemsGained && !s.blocksMined && !s.logsChopped) bits.push(`${s.itemsGained} items gathered`);
  bits.push(`${s.distanceTraveled}m traveled`);
  if (s.deaths) bits.push(`${s.deaths} death${s.deaths === 1 ? '' : 's'}`);
  if (s.panics) bits.push(`${s.panics} panic${s.panics === 1 ? '' : 's'}`);
  bits.push(`${s.stationaryPct}% stationary`);
  const v = verdict(s);
  return `${s.bot}: ${bits.join(', ')} — ${v}`;
}

// ---------- main ----------
const botArg = flag('bot');
const bots = botArg ? [botArg] : listBots();
const results = bots.map(summarize).filter(Boolean);

if (has('json')) {
  console.log(JSON.stringify({ since: SINCE, now: NOW, windowMs: WINDOW_MS, bots: results }, null, 2));
} else {
  console.log(`playcheck :: window ${new Date(SINCE).toISOString()} -> ${untilFlag ? new Date(NOW).toISOString() : 'now'} (${Math.round(WINDOW_MS / 60000)}m)`);
  console.log('---');
  if (!results.length) {
    console.log(botArg ? `no ledger for ${botArg} in this window` : 'no bots with ledger data in this window');
  }
  for (const s of results) {
    console.log(oneLine(s));
    const detail = [];
    if (s.noOpFraction != null) detail.push(`no-op tasks: ${Math.round(s.noOpFraction * 100)}% (${s.noOpTasks}/${s.taskCount})`);
    detail.push(`productive actions/10min: ${s.productiveActionsPer10Min}`);
    detail.push(`chat lines: ${s.chatCount}${s.chatGap ? ' (log file missing — GAP)' : ''}`);
    if (s.itemsDeposited) detail.push(`deposited: ${s.itemsDeposited} items${s.chestEvents ? '' : ' (task-inference, no chest events this window)'}`);
    if (s.itemsWithdrawn) detail.push(`withdrawn: ${s.itemsWithdrawn} items`);
    if (s.realStationaryPct != null) detail.push(`real stationary: ${s.realStationaryPct}% (position trace, ${s.posTraceCoverage}% window coverage, n=${s.posTraceSamples})`);
    console.log('    ' + detail.join(' | '));
    if (s.stallAttribution) {
      const ec = s.stallAttribution.episodeCauses, ro = s.stallAttribution.rungOwnership;
      const fmtMs = (ms) => `${Math.round(ms / 60000 * 10) / 10}min`;
      console.log(`    stall attribution — episodes (n=${ec.n}, ${fmtMs(ec.totalMs)} total): standdown ${fmtMs(ec.standdownCarryover.ms)} (${ec.standdownCarryover.n}) | kit_missing ${fmtMs(ec.kitMissing.ms)} (${ec.kitMissing.n}) | frozen_repeat ${fmtMs(ec.frozenRepeat.ms)} (${ec.frozenRepeat.n}) | other ${fmtMs(ec.other.ms)} (${ec.other.n})`);
      console.log(`    stall attribution — rung ownership: SHELTER ${fmtMs(ro.SHELTER)} | IDLE ${fmtMs(ro.IDLE)} | directed ${fmtMs(ro.directed)} | unknown ${fmtMs(ro.unknown)}`);
    }
  }
  console.log('---');
  console.log('LEDGER GAPS (things this instrument could not read from the existing ledger):');
  console.log('  - #69 gaps 1+2 (chest deposits, position trace) are CLOSED as of 2026-09-03: both');
  console.log('    ev:\'chest\' and ev:\'pos\' are real, already-emitted ledger events (telemetry.js');
  console.log('    was already calling M.chest() from skills.js/farmskills.js; the actual gap was');
  console.log('    that no grader read either stream) — see itemsDeposited/itemsWithdrawn/');
  console.log('    realStationaryPct above. stationaryPct (the verdict-feeding number) is UNCHANGED');
  console.log('    on purpose, still task-coverage-based — realStationaryPct is reported alongside');
  console.log('    it, not substituted for it, so the verdict\'s own calibration isn\'t silently');
  console.log('    altered by this fix (a genuine calibration question, not this fix\'s call to make).');
  console.log('  - chat "spam" is reported as a raw line count, not classified no-op vs meaningful —');
  console.log('    that would need either a chat-content event in the ledger or a text-pattern guess');
  console.log('    this instrument deliberately avoids. noOpFraction (ledger-grounded) is the closest');
  console.log('    proxy: a high chat count alongside a high noOpFraction is the "spam" signature.');
  console.log('    STILL OPEN (#69 gap 3) — no ledger-grounded fix attempted here.');
}
