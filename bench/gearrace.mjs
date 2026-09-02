#!/usr/bin/env node
/*
 * bench/gearrace.mjs — the Engine Gear-Race benchmark harness.
 *
 * Concept (Felix, via team-lead, 2026-09-02): a completely empty character + the engine + a
 * steering LLM race through the pickaxe gear tiers. Score = wall-clock from first spawn to
 * FIRST possession of wooden_pickaxe / stone_pickaxe / iron_pickaxe / diamond_pickaxe.
 * Steering-call count is a secondary autonomy score: the steering LLM may ONLY call
 * __agenda.setProject (via POST /eval) and read GET /state — fewer calls is MORE autonomous,
 * not less measured. Iron/diamond DNFs are an EXPECTED, informative roadmap signal today,
 * not a harness failure.
 *
 *   node bench/gearrace.mjs --bot <name> [--server-dir <path>] [--cap-min 90]
 *                           [--append-scoreboard] [--json]
 *
 * GROUND TRUTH, in the priority order team-lead specified (log primary, ledger corroborating,
 * both engine-independent of the bot's own self-report):
 *   1. The LOCAL SERVER's own log (logs/latest.log) — written by the Minecraft server process,
 *      not by the bot's runner.js, so it cannot be corrupted by an engine bug. Three signal
 *      types: the join line (T0), `Tool ready: <item> (<how>)` chat lines (skills.js's
 *      ensureTool doneMsg — precise, but only fires for that one acquisition path), and
 *      vanilla advancement lines (informational corroboration only — see the ADVANCEMENT_MAP
 *      comment below on why these are NOT trusted as sole ground truth for a specific tier).
 *   2. The telemetry ledger (logs/metrics-<bot>.jsonl) — task_start/task_end's own `inv`
 *      inventory snapshots. Coarser (sampled at skill-call boundaries, not continuously) but
 *      definitionally exact: "does the bag hold >=1 of this item" is precisely what "first
 *      possession" means, independent of HOW it was acquired. Used to corroborate the log
 *      timestamp and as the sole source if a `Tool ready` line never fired (e.g. tool was
 *      acquired by a path this harness doesn't know to grep for).
 * Steering-call count comes from the SAME ledger's `intervention` events (runner.js's own
 * tokensSpent=0 tripwire, #52) — GET /state is structurally exempt from that counter already
 * (runner.js's own comment: "read-only and never counted"), so every recorded intervention IS
 * a POST that reached the bot, and for a race run that should be nothing but /eval-wrapped
 * setProject calls. This harness deliberately makes NO /eval calls of its own during
 * ground-truth collection (only log/ledger file reads + one read-only GET /state for engine
 * version stamps) specifically so running this harness can never inflate the very count it
 * is reporting.
 *
 * ADVANCEMENT_MAP is informational, not authoritative, BY DESIGN, independent of whether the
 * mapping itself is right: the assignment brief's original text mapped "Isn't It Iron Pick?"
 * to the DIAMOND pickaxe and stated "vanilla has no distinct iron-pickaxe advancement" --
 * flagged as likely wrong (real vanilla's minecraft:story/iron_tools, that exact advancement,
 * is normally about the IRON pickaxe) rather than silently resolved either way. RULING
 * (team-lead, 2026-09-02): confirmed wrong -- `story/iron_tools` ("Isn't It Iron Pick?") IS
 * the iron pickaxe; `story/mine_diamond` covers diamond acquisition. Corrected below. This
 * harness's actual design choice stands regardless of the correct mapping: it does NOT use
 * advancement titles to decide a tier's completion time at all -- only `Tool ready` lines and
 * ledger inventory (both item-name-exact, no title-guessing) ever set a tier's clock.
 * Advancement lines are reported as extra context in the output only.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(DIR, '..');

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const has = (n) => argv.includes('--' + n);

const BOT = flag('bot');
if (!BOT) {
  console.error('usage: node bench/gearrace.mjs --bot <name> [--port <controlPort>] [--server-dir <path>] [--cap-min 90] [--append-scoreboard] [--json]');
  process.exit(2);
}
const PORT = flag('port');
const SERVER_DIR = flag('server-dir', path.join(REPO, '..', 'localserver-race')); // the dedicated race track by default (SCOREBOARD.md: "the track future engine versions race against")
const CAP_MIN = Number(flag('cap-min', 90));
const LEDGER = path.join(REPO, 'logs', `metrics-${BOT}.jsonl`);

// The four tiers, in race order. `toolReady` is the exact item name ensureTool's doneMsg logs.
const TIERS = [
  { key: 'wooden_pickaxe', label: 'Wooden pickaxe' },
  { key: 'stone_pickaxe', label: 'Stone pickaxe' },
  { key: 'iron_pickaxe', label: 'Iron pickaxe' },
  { key: 'diamond_pickaxe', label: 'Diamond pickaxe' },
];

// Informational only -- see the file header on why these never decide a tier's time.
const ADVANCEMENT_MAP = {
  'Stone Age': 'wooden_pickaxe (used to mine stone)',
  'Getting an Upgrade': 'stone_pickaxe (constructed)',
  'Acquire Hardware': 'iron_ingot smelted (precursor, NOT iron_pickaxe possession)',
  "Isn't It Iron Pick?": 'iron_pickaxe (ruled 2026-09-02: real vanilla story/iron_tools, corrects the assignment brief\'s original diamond mapping)',
  'Diamonds!': 'diamond acquired (story/mine_diamond, precursor -- NOT diamond_pickaxe possession, same caveat as Acquire Hardware/iron)',
};

// ---------- server log parsing ----------
function findLogFile(serverDir) {
  const latest = path.join(serverDir, 'logs', 'latest.log');
  if (!fs.existsSync(latest)) throw new Error(`no log file at ${latest} -- pass --server-dir to point at the right server`);
  return latest;
}
const TIME_RE = /^\[(\d{2}):(\d{2}):(\d{2})\]/;
const toSec = (h, m, s) => (+h) * 3600 + (+m) * 60 + (+s);

// Parses logs/latest.log into a flat, TIME-ORDERED, elapsed-seconds-since-file-start event
// list. Day rollover (a run spanning midnight) is handled by tracking a running offset:
// whenever a line's seconds-of-day is LESS than the previous line's, the log crossed
// midnight, so 86400 is added to every subsequent line. Elapsed time (what the TTT table
// actually needs) never requires knowing the real calendar date at all.
function parseServerLog(file, bot) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const events = [];
  let dayOffset = 0, lastSec = -1;
  const nameRe = new RegExp(`^${bot}(?:\\[|\\s)`);
  const advRe = new RegExp(`^${bot} has made the advancement \\[(.+)\\]$`);
  const chatRe = new RegExp(`<${bot}> (.*)$`);
  for (const raw of lines) {
    const tm = raw.match(TIME_RE);
    if (!tm) continue;
    let sec = toSec(tm[1], tm[2], tm[3]);
    if (sec < lastSec - 5) dayOffset += 86400;   // small negative jitter isn't a rollover
    lastSec = sec;
    sec += dayOffset;
    const msg = raw.slice(raw.indexOf(']: ') + 3);
    if (nameRe.test(msg) && /logged in with entity id/.test(msg)) events.push({ t: sec, kind: 'join', line: msg });
    else if (msg === `${bot} joined the game`) events.push({ t: sec, kind: 'joined', line: msg });
    else if (msg === `${bot} left the game`) events.push({ t: sec, kind: 'left', line: msg });
    else {
      const am = msg.match(advRe);
      if (am) { events.push({ t: sec, kind: 'advancement', title: am[1], line: msg }); continue; }
      const cm = msg.match(chatRe);
      if (cm) {
        const text = cm[1];
        const tr = text.match(/^Tool ready: (\S+) \((\w+)\)\.?$/);
        if (tr) events.push({ t: sec, kind: 'tool_ready', item: tr[1], how: tr[2], line: msg });
        else events.push({ t: sec, kind: 'chat', text, line: msg });
      }
    }
  }
  return events;
}

// ---------- telemetry ledger parsing ----------
function parseLedger(file) {
  if (!fs.existsSync(file)) return { records: [], warning: `no ledger at ${file} -- telemetry.js not installed on this bot, or wrong bot name` };
  const records = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* one bad line shouldn't sink the run */ }
  }
  return { records, warning: null };
}

// ---------- assemble the race report ----------
function buildReport() {
  const logFile = findLogFile(SERVER_DIR);
  const logEvents = parseServerLog(logFile, BOT);
  const { records: ledger, warning: ledgerWarning } = parseLedger(LEDGER);

  const joinEvents = logEvents.filter((e) => e.kind === 'join');
  if (!joinEvents.length) {
    throw new Error(`no join line for '${BOT}' found in ${logFile} -- wrong bot name, wrong --server-dir, or the bot hasn't connected yet`);
  }
  const t0 = joinEvents[0].t;   // FIRST ever join -- a reconnect mid-race doesn't reset the clock
  const capSec = CAP_MIN * 60;
  const lastLogT = logEvents.length ? logEvents[logEvents.length - 1].t : t0;
  const windowEnd = Math.min(lastLogT, t0 + capSec);
  const capped = (lastLogT - t0) >= capSec;

  // ledger epoch-ms anchor: best-effort only (see file header) -- match the ledger's earliest
  // `connect`(state:spawn) record to this join, so ledger events can be placed on the SAME
  // elapsed-seconds-since-T0 axis as the log. If it's off (rare: run spans a log rotation the
  // ledger doesn't know about) ledger corroboration just silently finds no match -- the log
  // remains authoritative for the reported time either way.
  // epochAnchor IS the real epoch of t0 (the spawn record and the log's join line are the
  // same real-world moment) -- do NOT also fold t0 (already a relative-seconds value with no
  // date) into this, or every ledger-derived elapsed time comes out shifted by t0 itself.
  const spawnRecs = ledger.filter((r) => r.ev === 'connect' && r.state === 'spawn').sort((a, b) => a.t - b.t);
  const epochAnchor = spawnRecs.length ? spawnRecs[0].t : null;
  const toElapsedFromLedgerT = (epochMs) => epochAnchor == null ? null : Math.round((epochMs - epochAnchor) / 1000);

  const results = [];
  for (const tier of TIERS) {
    const toolLine = logEvents.find((e) => e.kind === 'tool_ready' && e.item === tier.key);
    const ledgerInv = ledger
      .filter((r) => (r.ev === 'task_start' || r.ev === 'task_end') && r.inv && (r.inv[tier.key] || 0) > 0)
      .sort((a, b) => a.t - b.t)[0];
    const ledgerElapsed = ledgerInv ? toElapsedFromLedgerT(ledgerInv.t) : null;

    let elapsed = null, source = null;
    if (toolLine) { elapsed = toolLine.t - t0; source = 'log:Tool ready'; }
    else if (ledgerElapsed != null) { elapsed = ledgerElapsed; source = 'ledger:inv (no Tool-ready line seen -- acquired some other way, or chat throttled)'; }

    const corroborated = toolLine && ledgerElapsed != null ? Math.abs((toolLine.t - t0) - ledgerElapsed) <= 60 : null;
    results.push({ ...tier, elapsed, source, corroborated, hasToolLine: Boolean(toolLine), hasLedgerInv: Boolean(ledgerInv) });
  }

  // DNF diagnosis: for the first unreached tier, grab the last few chat/advancement lines
  // before the cutoff as a "died here, roughly why" hint -- never invented, only quoted.
  const firstDnfIdx = results.findIndex((r) => r.elapsed == null);
  let dnfContext = null;
  if (firstDnfIdx >= 0) {
    const recent = logEvents.filter((e) => e.t <= windowEnd && (e.kind === 'chat' || e.kind === 'advancement')).slice(-6);
    dnfContext = { tier: results[firstDnfIdx].key, lastLines: recent.map((e) => `[+${e.t - t0}s] ${e.line}`) };
  }

  const advancements = logEvents.filter((e) => e.kind === 'advancement')
    .map((e) => ({ t: e.t - t0, title: e.title, note: ADVANCEMENT_MAP[e.title] || null }));

  const interventions = ledger.filter((r) => r.ev === 'intervention');
  const setProjectCalls = interventions.filter((r) => /setProject/.test(r.preview || ''));
  const otherEvalCalls = interventions.filter((r) => r.route === '/eval' && !/setProject/.test(r.preview || ''));

  const deaths = ledger.filter((r) => r.ev === 'death').length;

  return {
    bot: BOT, serverDir: SERVER_DIR, logFile, t0Line: joinEvents[0].line,
    capMin: CAP_MIN, capped, elapsedObservedSec: lastLogT - t0,
    tiers: results, dnfContext, advancements,
    steering: { total: interventions.length, setProjectCalls: setProjectCalls.length, otherEvalCalls: otherEvalCalls.length,
      note: otherEvalCalls.length ? `${otherEvalCalls.length} /eval call(s) did NOT contain "setProject" -- check these weren't hand-driving` : null },
    deaths, ledgerWarning,
  };
}

// ---------- read-only engine version stamp (GET /state -- exempt from the intervention tripwire) ----------
function getState(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(null);
    const req = http.get({ host: '127.0.0.1', port: Number(port), path: '/state', timeout: 4000 }, (res) => {
      let body = ''; res.on('data', (d) => (body += d)); res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ---------- rendering ----------
const fmtSec = (s) => s == null ? 'DNF' : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;

function printReport(report, state) {
  console.log(`gearrace — ${report.bot} on ${report.serverDir}`);
  console.log(`join: ${report.t0Line}`);
  console.log(`observed window: ${fmtSec(report.elapsedObservedSec)}${report.capped ? ` (hit the ${report.capMin}min cap)` : ' (log ends here -- run may still be in progress)'}`);
  if (report.ledgerWarning) console.log(`!! ${report.ledgerWarning}`);
  if (state) console.log(`engine (live, GET /state): skills v${state.payloads && state.payloads.skills} agenda ${state.payloads && state.payloads.agenda === false ? 'off' : 'v' + (state.payloads && state.payloads.agenda)}`);
  console.log('\n| Tier | Time from join | Source |');
  console.log('|---|---|---|');
  for (const r of report.tiers) {
    const src = r.elapsed == null ? '-' : r.source + (r.corroborated === true ? ' (ledger-corroborated)' : r.corroborated === false ? ' (LEDGER DISAGREES >60s -- check)' : '');
    console.log(`| ${r.label} | ${fmtSec(r.elapsed)} | ${src} |`);
  }
  if (report.dnfContext) {
    console.log(`\nDNF at ${report.dnfContext.tier} -- last relevant lines before the cutoff:`);
    for (const l of report.dnfContext.lastLines) console.log('  ' + l);
    if (!report.dnfContext.lastLines.length) console.log('  (no chat/advancement lines at all near the cutoff -- check the bot is actually alive and doing something)');
  }
  if (report.advancements.length) {
    console.log('\nAdvancements seen (informational, not used as ground truth -- see file header):');
    for (const a of report.advancements) console.log(`  [+${a.t}s] ${a.title}${a.note ? ' -- ' + a.note : ''}`);
  }
  console.log(`\nSteering calls: ${report.steering.total} total (${report.steering.setProjectCalls} setProject, ${report.steering.otherEvalCalls} other /eval)`);
  if (report.steering.note) console.log(`  !! ${report.steering.note}`);
  console.log(`Deaths: ${report.deaths}`);
}

function scoreboardBlock(report, state, runLabel) {
  const engineLine = state
    ? `skills v${state.payloads && state.payloads.skills}, agenda ${state.payloads && state.payloads.agenda === false ? 'off' : 'v' + (state.payloads && state.payloads.agenda)}`
    : 'engine version unknown (bot not reachable for GET /state)';
  const rows = report.tiers.map((r) => `| ${r.label} | ${fmtSec(r.elapsed)} | ${r.elapsed == null ? (report.dnfContext && report.dnfContext.tier === r.key ? 'DNF -- see notes below' : 'DNF') : r.source} |`).join('\n');
  const dnfNote = report.dnfContext
    ? `\n\nDNF context (${report.dnfContext.tier}): ${report.dnfContext.lastLines.length ? report.dnfContext.lastLines.map((l) => '`' + l + '`').join('; ') : 'no relevant log activity near the cutoff'}`
    : '';
  return `### ${runLabel} — ${report.bot}, ${report.serverDir}\n\n` +
    `Generated by \`bench/gearrace.mjs\`. Engine versions: ${engineLine}. ${report.capped ? `Hit the ${report.capMin}min cap.` : 'Run may still be in progress at generation time.'}\n\n` +
    `| Tier | Time from join | Source |\n|---|---|---|\n${rows}\n\n` +
    `Steering calls: ${report.steering.total} (${report.steering.setProjectCalls} setProject, ${report.steering.otherEvalCalls} other /eval).` +
    ` Deaths: ${report.deaths}.${dnfNote}\n`;
}

// ---------- main ----------
(async () => {
  let report;
  try { report = buildReport(); }
  catch (e) { console.error('gearrace: ' + e.message); process.exit(1); }
  let state = await getState(PORT);
  // A control port is a separate localhost namespace from which Minecraft server a bot is
  // on -- it can be reassigned to a DIFFERENT bot between runs (observed live this session:
  // a port collision during this very race). Trusting a stale --port blindly would silently
  // stamp this report with the wrong bot's engine version.
  if (state && state.name && state.name !== BOT) {
    console.error(`!! port ${PORT} answers as '${state.name}', not '${BOT}' -- ignoring its engine-version stamp (stale/reassigned port?)`);
    state = null;
  }

  if (has('json')) { console.log(JSON.stringify({ report, state }, null, 2)); return; }
  printReport(report, state);

  if (has('append-scoreboard')) {
    const SB = path.join(REPO, 'SCOREBOARD.md');
    const marker = '## Engine Gear-Race';
    let txt = fs.existsSync(SB) ? fs.readFileSync(SB, 'utf8') : '';
    if (!txt.includes(marker)) {
      console.error(`!! SCOREBOARD.md has no "${marker}" section -- appending a generated block anyway, but check the placement`);
      txt += `\n\n${marker}\n`;
    }
    const runLabel = `Run (auto) — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    txt = txt.trimEnd() + '\n\n' + scoreboardBlock(report, state, runLabel) + '\n';
    fs.writeFileSync(SB, txt);
    console.log(`\nappended to ${path.relative(REPO, SB)}`);
  }
})();
