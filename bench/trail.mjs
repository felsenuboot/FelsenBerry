#!/usr/bin/env node
/*
 * bench/trail.mjs — the human-bar's criterion 4, as an instrument: "does this bot leave a
 * human-looking trail, or scars?" (GOAL.md: "no half-felled trees, no stranded drops, no
 * naked scars"). Until now this was a manual walk to the bot's work sites; this automates it.
 *
 * Two data sources, deliberately not conflated:
 *  1. The LEDGER (telemetry.js's existing JSONL) — finds WHERE the bot worked and pulls
 *     whatever the engine already self-reports there (chopTrees' own `result.stranded`,
 *     torch counts). Cheap, exact, but self-reported — the engine grading its own homework.
 *  2. The WORLD, read live through an already-running, already-connected inspector bot —
 *     confirms a bounded sample of ledger-flagged sites (and a spread of unflagged ones)
 *     by actually looking: floating logs, item entities on the ground, open shafts. This is
 *     the "verify, don't just trust the self-report" step (this project's own standing
 *     doctrine — see FEEDBACK.md's "unverified deferral" class of finding).
 *
 * Usage:
 *   node bench/trail.mjs --bot <name> --since <ISO> [--until <ISO>] --inspector-port <port>
 *   node bench/trail.mjs --bot <name> --since 1h --inspector-port 3160 --max-sites 15 --json
 *
 * --inspector-port must point at an ALREADY CONNECTED, DECIDER_EXCLUDE'd, --agenda-less bot
 * on the SAME server the ledger bot worked on (spawn.sh, no --agenda; this script disarms its
 * survival.js reflex itself, see stopSurvival() below — same doctrine as bench/lib/common.sh's
 * stop_idleguard(), extended after #106's fixture found a bare QA bot can die/respawn mid-
 * inspection otherwise). This script TELEPORTS that bot via RCON to each site in turn — it
 * does not walk there, and it never digs, places, or otherwise touches the world; read-only
 * by construction (no bot.dig/bot.placeBlock call anywhere below).
 *
 * Thresholds (argued in FEEDBACK.md, 2026-09-03, "criterion-4 trail inspector" — not
 * hard-coded folklore): see VERDICT below. Writes bench/gates/trail-<label>.json, same
 * convention as every other soak gate file in this tree.
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
const has = (n) => argv.includes('--' + n);

const BOT = flag('bot');
const INSPECTOR_PORT = flag('inspector-port');
const LABEL = flag('label', BOT || 'trail');
const MAX_SITES = parseInt(flag('max-sites', '15'), 10);
const RCON_HOST = flag('rcon-host', '127.0.0.1');
const RCON_PORT = flag('rcon-port', '25598');
const RCON_PASS = flag('rcon-pass', 'fellocal123');
if (!BOT || !INSPECTOR_PORT) {
  console.error('usage: node bench/trail.mjs --bot <name> --since <ISO> [--until <ISO>] --inspector-port <port> [--max-sites N] [--json]');
  process.exit(2);
}

// same relative/absolute window parsing convention as playcheck.mjs
function parseSince(s) {
  if (!s) return Date.now() - 3600e3;
  const m = /^(\d+)(m|h|d)$/.exec(String(s).trim());
  if (m) return Date.now() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now() - 3600e3;
}
const SINCE = parseSince(flag('since'));
const UNTIL = flag('until') ? Date.parse(flag('until')) : Date.now();

// ---------------- RCON + inspector-bot HTTP helpers ----------------
function rcon(cmd) {
  try {
    return execFileSync(process.execPath, [path.join(ROOT, 'bench', 'lib', 'rcon.mjs'), RCON_HOST, RCON_PORT, RCON_PASS, cmd],
      { encoding: 'utf8', timeout: 8000 }).trim();
  } catch (e) { return 'err:' + e.message; }
}
async function evalJs(code) {
  const r = await fetch(`http://127.0.0.1:${INSPECTOR_PORT}/eval`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error('eval failed: ' + (j.error || 'unknown'));
  return j.result;
}
// stop the inspector bot's own reflex before ever teleporting it anywhere — #106's own
// fixture found this the hard way (a bare QA bot died to a real mob mid-setup and silently
// respawned elsewhere). Re-armed on every reconnect by the auto-inject stack, so call again
// after any relog; this script never relogs the inspector, so once is enough here.
async function stopSurvival() {
  try { await evalJs("if (globalThis.__survival) { globalThis.__survival.enabled = false; }"); } catch (e) {}
}
async function botName() {
  const r = await fetch(`http://127.0.0.1:${INSPECTOR_PORT}/state`);
  const j = await r.json();
  return j.name;
}
async function tpInspector(x, y, z) {
  const name = await botName();
  rcon(`tp ${name} ${x} ${y} ${z}`);
  // give the chunk a moment to load client-side before reading it
  await new Promise((r) => setTimeout(r, 1200));
}

// ---------------- 1. ledger: find work sites + self-reported signals ----------------
function loadLedger() {
  const file = path.join(LOGS, `metrics-${BOT}.jsonl`);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const recs = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r.t >= SINCE && r.t <= UNTIL) recs.push(r); } catch {}
  }
  return recs;
}

const CHOP_SKILLS = new Set(['chopTrees']);
const DIG_SKILLS = new Set(['safeDescend', 'mineLane', 'produce']);

function extractSites(recs) {
  const chopSites = [];   // {pos, stranded, want, got, t}
  const digSites = [];    // {pos, digs, t, skill}
  let torchSurfacePlaced = 0, surfaceTaskCount = 0;
  let lastTorchCount = null, lastRun = null;

  for (const r of recs) {
    if (r.run !== lastRun) { lastRun = r.run; lastTorchCount = null; }
    if (r.ev !== 'task_end' || !Array.isArray(r.pos)) continue;

    if (CHOP_SKILLS.has(r.skill)) {
      const stranded = (r.result && typeof r.result.stranded === 'number') ? r.result.stranded : 0;
      chopSites.push({ pos: r.pos, stranded, want: r.want, got: r.got, t: r.t });
    }
    if (DIG_SKILLS.has(r.skill) && (r.digs || 0) > 0) {
      digSites.push({ pos: r.pos, digs: r.digs, t: r.t, skill: r.skill });
    }
    // torch density (#106's own reuse: same run-scoped, sanity-capped delta tracking) —
    // scoped here to SURFACE tasks only ("sky":true at task_start is a different record;
    // task_end doesn't carry it, so this counts torches consumed across ANY task ending
    // with the bot surface-exposed per dangerscan's own field if present on the record —
    // most task_end records don't carry `sky` at all in this ledger schema, so this falls
    // back to counting every torch-consuming task_end and reports it plainly as
    // "torches consumed, fleet-wide window" rather than overclaiming a surface-only split
    // the ledger schema can't actually support without the same task_start cross-reference
    // #106 already used — see FEEDBACK for why that reuse doesn't fit cleanly here.
    const heldTorch = (r.held && r.held.name === 'torch') ? r.held.count : null;
    if (heldTorch != null) {
      if (lastTorchCount != null && heldTorch < lastTorchCount) {
        const used = lastTorchCount - heldTorch;
        if (used <= (r.digs || 0) + 8) torchSurfacePlaced += used;   // same sanity cap as #106
      }
      lastTorchCount = heldTorch;
    }
    surfaceTaskCount++;
  }
  return { chopSites, digSites, torchSurfacePlaced, surfaceTaskCount };
}

// ---------------- 2. cluster sites so nearby task_ends don't get inspected twice ----------------
function cluster(sites, radius) {
  const out = [];
  for (const s of sites) {
    const near = out.find((o) => Math.abs(o.pos[0] - s.pos[0]) <= radius && Math.abs(o.pos[1] - s.pos[1]) <= radius * 2 && Math.abs(o.pos[2] - s.pos[2]) <= radius);
    if (near) { near.members.push(s); if ((s.stranded || 0) > (near.stranded || 0)) near.stranded = s.stranded; near.digs = (near.digs || 0) + (s.digs || 0); }
    else out.push({ ...s, members: [s] });
  }
  return out;
}

// ---------------- 3. live inspection ----------------
// (a) floating logs near a chop site: a log block with air directly beneath it (and the
// cell below THAT also air) is disconnected from the ground -- the exact half-felled-tree
// signature (upper trunk/canopy left standing after the lower trunk was removed).
async function inspectFloatingLogs(site) {
  await tpInspector(site.pos[0], site.pos[1] + 1, site.pos[2]);
  return await evalJs(`
    const center = new Vec3(${site.pos[0]}, ${site.pos[1]}, ${site.pos[2]});
    const found = [];
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -2; dy <= 12; dy++) {
      const p = center.offset(dx, dy, dz);
      const b = bot.blockAt(p);
      if (!b || !/_log$/.test(b.name)) continue;
      const below1 = bot.blockAt(p.offset(0, -1, 0));
      const below2 = bot.blockAt(p.offset(0, -2, 0));
      const air1 = !below1 || below1.name === 'air';
      const air2 = !below2 || below2.name === 'air';
      if (air1 && air2) found.push({ pos: [p.x, p.y, p.z], name: b.name });
    }
    return found.slice(0, 20);
  `);
}
// (b) item entities (stranded drops) near a chop site
async function inspectDrops(site) {
  return await evalJs(`
    const center = new Vec3(${site.pos[0]}, ${site.pos[1]}, ${site.pos[2]});
    const items = Object.values(bot.entities).filter((e) => e && e.name === 'item')
      .filter((e) => e.position && e.position.distanceTo(center) <= 10)
      .map((e) => ({ pos: [Math.round(e.position.x), Math.round(e.position.y), Math.round(e.position.z)] }));
    return items.slice(0, 20);
  `);
}
// (c) naked open shaft near a dig site: walk UP from the site to find where solid ground
// gives way to open sky-ish air (a rough "surface" heuristic -- 4+ consecutive air cells
// above a solid cell), then check whether that column, read back DOWN from there, is a
// bare >=3-deep 1-wide hole with no ladder in it. Deliberately conservative: only flags a
// hole that is genuinely open at the top (a real surface scar), not an internal cave void.
async function inspectShaft(site) {
  return await evalJs(`
    const base = new Vec3(${site.pos[0]}, ${site.pos[1]}, ${site.pos[2]});
    let surfaceY = null;
    for (let y = base.y; y <= base.y + 60; y++) {
      const b = bot.blockAt(new Vec3(base.x, y, base.z));
      if (!b) break;
      if (b.name !== 'air') continue;
      let clearAbove = true;
      for (let k = 1; k <= 4; k++) { const bb = bot.blockAt(new Vec3(base.x, y + k, base.z)); if (bb && bb.name !== 'air') { clearAbove = false; break; } }
      if (clearAbove) { surfaceY = y; break; }
    }
    if (surfaceY == null) return { open: false, reason: 'no_surface_found' };
    let depth = 0, hasLadder = false;
    for (let y = surfaceY; y >= surfaceY - 10; y--) {
      const b = bot.blockAt(new Vec3(base.x, y, base.z));
      if (!b) break;
      if (b.name === 'ladder' || b.name === 'scaffolding') hasLadder = true;
      if (b.name === 'air' || b.name === 'cave_air') { depth++; continue; }
      break;
    }
    return { open: depth >= 3 && !hasLadder, depth, hasLadder, surfaceY };
  `);
}

// ---------------- 4. run it ----------------
const recs = loadLedger();
if (!recs.length) { console.error(`trail: no ledger records for ${BOT} in this window`); process.exit(1); }
await stopSurvival();

const { chopSites: rawChop, digSites: rawDig, torchSurfacePlaced, surfaceTaskCount } = extractSites(recs);
const chopClusters = cluster(rawChop, 6).sort((a, b) => (b.stranded || 0) - (a.stranded || 0));
const digClusters = cluster(rawDig, 6).sort((a, b) => (b.digs || 0) - (a.digs || 0));

// prioritize ledger-flagged sites (stranded>0) first, then a spread sample of the rest,
// bounded to MAX_SITES total across BOTH categories (roughly half each) -- a real-time
// budget, not a claim every site was checked.
const chopBudget = Math.ceil(MAX_SITES / 2), digBudget = MAX_SITES - chopBudget;
const chopToCheck = chopClusters.slice(0, chopBudget);
const digToCheck = digClusters.slice(0, digBudget);

const findings = { floatingLogs: [], strandedDrops: [], nakedShafts: [], sitesChecked: 0 };
for (const site of chopToCheck) {
  try {
    const logs = await inspectFloatingLogs(site);
    const drops = await inspectDrops(site);
    findings.sitesChecked++;
    if (logs.length) findings.floatingLogs.push({ site: site.pos, ledgerStranded: site.stranded, logs });
    if (drops.length) findings.strandedDrops.push({ site: site.pos, ledgerStranded: site.stranded, drops });
  } catch (e) { console.error(`trail: chop site ${site.pos} inspection failed: ${e.message}`); }
}
for (const site of digToCheck) {
  try {
    const shaft = await inspectShaft(site);
    findings.sitesChecked++;
    if (shaft.open) findings.nakedShafts.push({ site: site.pos, ...shaft });
  } catch (e) { console.error(`trail: dig site ${site.pos} inspection failed: ${e.message}`); }
}

// ---------------- 5. verdict ----------------
// Thresholds argued in FEEDBACK.md, 2026-09-03 ("criterion-4 trail inspector"): a human
// player leaves ZERO of these as a matter of course (nobody walks away from a half-chopped
// tree or an open pit on purpose), so PASS is reserved for zero found. WARN acknowledges a
// live-inspection sample is bounded (MAX_SITES) and a single incident could be an honest
// one-off; FAIL is reserved for either a genuine multi-site pattern or anything at the
// tightest tolerance (an open shaft — the single most visually obvious scar of the four).
const ledgerStrandedTotal = rawChop.reduce((n, s) => n + (s.stranded || 0), 0);
const torchRate = surfaceTaskCount ? torchSurfacePlaced / Math.max(1, rawDig.reduce((n, s) => n + (s.digs || 0), 0)) : null;

const reasons = [];
let verdict = 'PASS';
const worsen = (v) => { if (v === 'FAIL' || verdict === 'FAIL') verdict = 'FAIL'; else if (v === 'WARN') verdict = 'WARN'; };

if (findings.floatingLogs.length >= 3) { worsen('FAIL'); reasons.push(`${findings.floatingLogs.length} sites with floating (half-felled) logs`); }
else if (findings.floatingLogs.length >= 1) { worsen('WARN'); reasons.push(`${findings.floatingLogs.length} site(s) with a floating log — spot-checked, not exhaustive`); }

if (ledgerStrandedTotal >= 6 || findings.strandedDrops.length >= 3) { worsen('FAIL'); reasons.push(`${ledgerStrandedTotal} stranded drops reported by the engine itself across the window (${findings.strandedDrops.length} confirmed live)`); }
else if (ledgerStrandedTotal >= 1) { worsen('WARN'); reasons.push(`${ledgerStrandedTotal} stranded drop(s) reported, ${findings.strandedDrops.length} confirmed live`); }

if (findings.nakedShafts.length >= 2) { worsen('FAIL'); reasons.push(`${findings.nakedShafts.length} open, uncapped shafts found — the most visually obvious scar of the four`); }
else if (findings.nakedShafts.length >= 1) { worsen('WARN'); reasons.push(`1 open shaft found (tight tolerance — a single one is already a real scar, not failing outright only because a bounded sample can't claim it's a pattern)`); }

if (torchRate != null) {
  if (torchRate >= 0.30) { worsen('WARN'); reasons.push(`torch rate ${torchRate.toFixed(3)}/dig vs the ~0.125 (1-per-8) design target — real over-placement (see #106)`); }
}

console.log(`trail ${LABEL}: ${verdict}${reasons.length ? '\n  ' + reasons.join('\n  ') : ' (clean — no half-felled trees, stranded drops, or open shafts found in the sample)'}`);
console.log(`  sites checked: ${findings.sitesChecked} (chop clusters seen: ${chopClusters.length}, dig clusters seen: ${digClusters.length}, budget: ${MAX_SITES})`);
if (torchRate != null) console.log(`  torch rate: ${torchRate.toFixed(3)}/dig (ledger-wide, not live-confirmed)`);

const out = {
  label: LABEL, bot: BOT, since: new Date(SINCE).toISOString(), until: new Date(UNTIL).toISOString(),
  at: new Date().toISOString(), verdict, reasons,
  findings, ledgerStrandedTotal, torchRate,
  sitesSeen: { chopClusters: chopClusters.length, digClusters: digClusters.length },
};
fs.mkdirSync(path.join(ROOT, 'bench', 'gates'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench', 'gates', `trail-${LABEL}.json`), JSON.stringify(out, null, 2));
if (has('json')) console.log(JSON.stringify(out, null, 2));
process.exit(verdict === 'FAIL' ? 1 : 0);
