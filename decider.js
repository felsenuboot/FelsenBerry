#!/usr/bin/env node
// decider.js — the ONE shared fleet-wide "needs direction" decision daemon
// (research/IDLE_TRIGGER_SPEC.md §1.6/§3b, Direction Episodes Phase 3).
//
// Never a payload: no LLM code runs inside any bot process — this is a standalone daemon,
// same pattern as graybridge.js. Start: setsid nohup node decider.js >> logs/decider.log 2>&1 &
// Stop: kill the pid in pids/decider.pid (or just SIGTERM/SIGINT it — the pidfile is cleaned
// up on exit either way).
//
// Flow per POLL_MS cycle, for every bot discovered via pids/*.port (+ pids/*.meta for owner):
//   1. GET /state; skip unless agenda.direction.state === 'needs_direction' (see agenda.js v22
//      / runner.js's own /state.agenda.direction — Phase 1 of this same spec).
//   2. Driver grace, CONDITIONAL not flat: an OWNED bot (meta names a driver) gets
//      DRIVER_GRACE_MS before the decider answers for it — the driver wins the race by
//      default. An unowned bot is answered immediately; no free grace for the driverless fleet.
//   3. Dedup (bot,eid) against decider-state.json — one decision per episode, mechanically,
//      and it survives a decider restart (the engine's own latches do not survive reinjection,
//      this must).
//   4. rules.json FIRST (key = why|role|lastError|barrenBucket) — a hit dispatches at zero
//      tokens, the codicil's whole point.
//   5. On a miss: rate gates (per-bot >=120s, fleet 30/hr, both persisted) -> compact context
//      from /state (+ the live skill registry, fetched via /eval) -> ONE claude-haiku-4-5 call
//      -> validate the returned skill (and next.skill) against the REAL registry -> dispatch.
//   6. Dispatch: POST /eval __agenda.dirDispatch(eid, {...decision, by:'decider'}) — the eid
//      compare-and-set (agenda.js §1.1j) makes a driver's own answer win the race for free; a
//      decider dispatch against a stale/already-answered eid is a harmless no-op.
//   7. Append decisions.jsonl — the rule-of-twice input for graduating (why,role,...) keys
//      into rules.json, and ultimately into ROLE_WORK defaults.
//
// Vocabulary is CLOSED: dirDispatch/setProject specs only. This can never become a second
// deliberative loop driving the body (the idleguard-subsumption law, agenda.js's own header).
// Decider down -> graceful degradation: the IDLE role-work floor keeps bots productive exactly
// as today; unanswered episodes just accumulate as the open-unclosed alarm (metrics.mjs),
// not as silence.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SELF_DIR = __dirname;
const PIDS_DIR = path.join(SELF_DIR, 'pids');
const LOGS_DIR = path.join(SELF_DIR, 'logs');
const DECISIONS_FILE = path.join(LOGS_DIR, 'decisions.jsonl');
const STATE_FILE = path.join(SELF_DIR, 'decider-state.json');
const RULES_FILE = path.join(SELF_DIR, 'rules.json');
const PID_FILE = path.join(PIDS_DIR, 'decider.pid');

const POLL_MS = 20000;
const DRIVER_GRACE_MS = 60000;
const PER_BOT_MIN_GAP_MS = 120000;
const FLEET_CAP_PER_HOUR = 30;
const HANDLED_TTL_MS = 86400000;          // prune decider-state.json's dedup map after 24h
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// ---- persisted state: survives BOTH a decider restart and a bot's payload reinjection
// (agenda.js's own engine-side latches do not survive the latter — see spec §2.3/§2.4) ----
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { return { handled: {}, lastCallAt: {}, fleetCalls: [] }; }
}
function pruneHandled(st) {
  const cutoff = Date.now() - HANDLED_TTL_MS;
  const h = st.handled || {};
  for (const k of Object.keys(h)) if (h[k] < cutoff) delete h[k];
}
function saveState(st) {
  pruneHandled(st);
  try { fs.mkdirSync(SELF_DIR, { recursive: true }); } catch (e) {}
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st)); } catch (e) { log('state save failed: ' + e.message); }
}
let state = loadState();

function loadRules() {
  try { return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); }
  catch (e) { return {}; }
}

// ---- bot discovery: pids/*.port (control port, written by spawn.sh) + pids/*.meta
// (owner|server|purpose, the fleet-awareness convention) ----
function discoverBots() {
  let files;
  try { files = fs.readdirSync(PIDS_DIR); } catch (e) { return []; }
  const bots = [];
  for (const f of files) {
    const m = /^(.+)\.port$/.exec(f);
    if (!m) continue;
    const name = m[1];
    let port;
    try { port = parseInt(fs.readFileSync(path.join(PIDS_DIR, f), 'utf8').trim(), 10); } catch (e) { continue; }
    if (!port) continue;
    let owner = null;
    try {
      const meta = fs.readFileSync(path.join(PIDS_DIR, name + '.meta'), 'utf8').trim();
      owner = (meta.split('|')[0] || '').trim() || null;
    } catch (e) {}
    bots.push({ name, port, owner });
  }
  return bots;
}

// ---- tiny local HTTP helpers (no dependency — matches this codebase's own hand-rolled
// style, e.g. graybridge.js's hand-rolled RCON protocol) ----
function httpGetJson(port, route, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' + route, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
function httpPostJson(port, route, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, path: '/' + route, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload); req.end();
  });
}
const evalOn = (port, code) => httpPostJson(port, 'eval', { code });

// ---- rule key + matching (spec §3b step 4) ----
function barrenBucket(n) { n = n || 0; return n === 0 ? '0' : n < 3 ? '1-2' : n < 10 ? '3-9' : '10+'; }
function ruleKey(direction, role) {
  const detail = (direction && direction.detail) || {};
  return [direction && direction.why, role || 'none', detail.lastError || 'none', barrenBucket(detail.barren)].join('|');
}

// ---- fleet-wide rate cap: persisted rolling 1h window, never engine-side-only (spec §2.3.3) ----
function fleetCapOk() {
  const cutoff = Date.now() - 3600000;
  state.fleetCalls = (state.fleetCalls || []).filter((t) => t > cutoff);
  return state.fleetCalls.length < FLEET_CAP_PER_HOUR;
}
function recordFleetCall() { state.fleetCalls = state.fleetCalls || []; state.fleetCalls.push(Date.now()); }

// ---- context + the ONE Haiku call ----
async function buildContext(b, st) {
  let skills = [];
  try {
    const r = await evalOn(b.port, 'return Object.keys(globalThis.__skills.registry);');
    skills = (r && r.result) || [];
  } catch (e) { log(`${b.name}: could not fetch skill registry: ${e.message}`); }
  return { state: st, skills };
}
function buildPrompt(ctx) {
  const s = ctx.state;
  const a = s.agenda || {};
  const d = a.direction || {};
  return [
    'You are the deterministic-first fleet decider for a Minecraft autonomous-bot engine.',
    'A bot has no direction (an "episode" is open) and needs exactly ONE new project set.',
    'The engine spends zero tokens normally; you are the metered exception for this one decision.',
    '',
    `Bot: ${s.name}  role: ${s.role || 'none'}  hp:${s.health} food:${s.food}`,
    `Position: ${JSON.stringify(s.position)}`,
    `Episode reason (why): ${d.why}`,
    `Current project: ${a.project || 'none'}  blocked: ${a.blocked || 'none'}`,
    `Available skills (choose ONLY a name from this exact list): ${ctx.skills.join(', ')}`,
    '',
    'Reply with ONLY a single JSON object, no prose, no markdown code fences:',
    '{"skill": "<one of the available skills>", "args": {...skill params...}, "repeat": <bool, optional>, "next": {"skill": "<name>", "args": {...}} (optional but recommended -- staging a next project lets the NEXT completion promote at zero tokens)}',
  ].join('\n');
}
async function askHaiku(ctx) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { log('ANTHROPIC_API_KEY not set -- cannot call Haiku, skipping this decision (graceful degradation: the IDLE floor keeps the bot productive; the episode stays open for the next poll or a driver)'); return null; }
  const prompt = buildPrompt(ctx);
  const body = JSON.stringify({ model: HAIKU_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] });
  return new Promise((resolve) => {
    const req = https.request({
      host: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body) },
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const text = j.content && j.content[0] && j.content[0].text;
          if (!text) { log('haiku call: no text in response: ' + data.slice(0, 200)); return resolve(null); }
          // strip an accidental markdown fence — the prompt asks for bare JSON, but don't
          // let a stray ```json wrapper turn a real answer into a discarded one
          const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
          resolve(JSON.parse(cleaned));
        } catch (e) { log('haiku response parse failed: ' + e.message); resolve(null); }
      });
    });
    req.on('error', (e) => { log('haiku call failed: ' + e.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); log('haiku call timed out'); resolve(null); });
    req.write(body); req.end();
  });
}

function appendDecision(rec) {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (e) {}
  try { fs.appendFileSync(DECISIONS_FILE, JSON.stringify(rec) + '\n'); } catch (e) { log('decisions.jsonl append failed: ' + e.message); }
}

// ---- per-bot handling ----
async function handleBot(b, rules) {
  let st;
  try { st = await httpGetJson(b.port, 'state'); } catch (e) { return; }   // unreachable -- skip silently, next poll retries
  const dir = st.agenda && st.agenda.direction;
  if (!dir || dir.state !== 'needs_direction' || !dir.eid) return;
  const eid = dir.eid;

  // step 2: conditional driver grace -- an OWNED bot's driver wins the race by default
  if (b.owner && (dir.forMs || 0) < DRIVER_GRACE_MS) return;

  // step 3: dedup (bot,eid) -- one decision per episode, mechanically, across restarts
  state.handled = state.handled || {};
  const dedupKey = b.name + ':' + eid;
  if (state.handled[dedupKey]) return;

  const role = st.role || null;
  const key = ruleKey(dir, role);
  const rule = rules[key];
  let decision = null, src = null, decisionLatencyMs = null;

  if (rule) {
    decision = rule; src = 'rule'; decisionLatencyMs = 0;
  } else {
    // step 5: rate gates BEFORE spending anything
    const lastAt = (state.lastCallAt || {})[b.name] || 0;
    if (Date.now() - lastAt < PER_BOT_MIN_GAP_MS) return;   // this bot's spacing hasn't elapsed; try again next poll, not a permanent skip
    if (!fleetCapOk()) {
      appendDecision({ t: Date.now(), bot: b.name, eid, why: dir.why, key, src: 'skipped_cap', decision: null, latency_ms: null });
      return;   // logged, never spent -- the overflow is visible, not silent
    }
    const ctx = await buildContext(b, st);
    const t0 = Date.now();
    const llm = await askHaiku(ctx);
    state.lastCallAt = state.lastCallAt || {}; state.lastCallAt[b.name] = Date.now();
    recordFleetCall();
    if (!llm || typeof llm.skill !== 'string') { log(`${b.name}: no usable decision from Haiku for episode ${eid}`); return; }
    if (!ctx.skills.includes(llm.skill)) { log(`${b.name}: Haiku picked unknown skill '${llm.skill}' -- discarding, not dispatching garbage`); return; }
    if (llm.next && (!llm.next.skill || !ctx.skills.includes(llm.next.skill))) delete llm.next;
    decision = llm; src = 'llm'; decisionLatencyMs = Date.now() - t0;
  }

  let dispatchOk = false, dispatchError = null;
  try {
    const spec = JSON.stringify(Object.assign({}, decision, { by: 'decider' }));
    const r = await evalOn(b.port, `return __agenda.dirDispatch(${JSON.stringify(eid)}, ${spec});`);
    dispatchOk = Boolean(r && r.result && r.result.ok);
    if (!dispatchOk) dispatchError = r && r.result && (r.result.error || r.result.skipped);
  } catch (e) { dispatchError = e.message; }

  // mark handled REGARDLESS of dispatch outcome: a validated decision that failed to dispatch
  // (e.g. the episode closed itself in the meantime -- a driver answered first) is still
  // "handled" for this eid; retrying would just re-derive the same stale-eid no-op forever.
  state.handled[dedupKey] = Date.now();
  appendDecision({ t: Date.now(), bot: b.name, eid, why: dir.why, key, src, decision, latency_ms: decisionLatencyMs, dispatchOk, dispatchError });
  log(`${b.name}: ${src} decision for '${dir.why}' -> ${decision.skill} (dispatch ${dispatchOk ? 'ok' : 'FAILED: ' + dispatchError})`);
}

async function pollOnce() {
  const bots = discoverBots();
  const rules = loadRules();
  for (const b of bots) {
    try { await handleBot(b, rules); } catch (e) { log(`${b.name}: poll error: ${e.message}`); }
  }
  saveState(state);
}

// ---- pid-file guard (graybridge.js's own pattern) ----
try { fs.mkdirSync(PIDS_DIR, { recursive: true }); } catch (e) {}
try {
  if (fs.existsSync(PID_FILE)) {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    let alive = false;
    try { process.kill(oldPid, 0); alive = true; } catch (e) { alive = false; }
    if (alive) { log(`refusing to start: decider already running (pid ${oldPid})`); process.exit(1); }
    log(`stale pidfile (pid ${oldPid} not running) -- taking over`);
  }
  fs.writeFileSync(PID_FILE, String(process.pid));
} catch (e) { log('pidfile guard warning (continuing anyway): ' + e.message); }
const cleanupPid = () => { try { fs.unlinkSync(PID_FILE); } catch (e) {} };
process.on('exit', cleanupPid);
process.on('SIGINT', () => { cleanupPid(); process.exit(0); });
process.on('SIGTERM', () => { cleanupPid(); process.exit(0); });

log(`decider.js starting -- poll every ${POLL_MS / 1000}s, driver grace ${DRIVER_GRACE_MS / 1000}s, fleet cap ${FLEET_CAP_PER_HOUR}/hr, model ${HAIKU_MODEL}`);
if (!process.env.ANTHROPIC_API_KEY) log('WARNING: ANTHROPIC_API_KEY is not set -- rule.json hits will still dispatch, but every rule MISS will be a no-op until it is set');
setInterval(() => { pollOnce().catch((e) => log('poll cycle error: ' + e.message)); }, POLL_MS);
pollOnce().catch((e) => log('initial poll error: ' + e.message));
