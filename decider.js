#!/usr/bin/env node
// decider.js — the ONE shared fleet-wide "needs direction" decision daemon
// (research/IDLE_TRIGGER_SPEC.md §1.6/§3b, Direction Episodes Phase 3).
//
// Never a payload: no LLM code runs inside any bot process — this is a standalone daemon,
// same pattern as graybridge.js. Start: setsid nohup node decider.js >> logs/decider.log 2>&1 &
// Stop: kill the pid in pids/decider.pid (or just SIGTERM/SIGINT it — the pidfile is cleaned
// up on exit either way).
//
// Flow per POLL_MS cycle, for every bot discovered via pids/*.port (+ pids/*.meta for owner
// and, since #95's soak-hygiene fix, DECIDER_EXCLUDE=1 spawn-time exclusion -- a throwaway
// verification bot spawned alongside a formal soak/race is structurally invisible to this
// daemon's polling/budget/LLM path, never just a naming-convention hint):
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
//      from /state (+ the live skill registry, fetched via /eval) -> ONE Andy-via-Ollama call
//      -> map Andy's native !command(args) dialect onto the REAL registry (deterministic,
//      closed vocabulary -- see mapAndyCommand) -> dispatch. Felix's ruling (2026-09-02)
//      supersedes the original Anthropic-API-key plan: Andy (sweaterdog/andy-4:micro-q8_0,
//      served CPU-pinned via local Ollama as andy-cpu:latest) is zero-marginal-cost and was
//      always the intended long-term backend (memory: minecraft-llm-backend-plan). Andy is
//      fine-tuned on mindcraft-ce's own command dialect and ignores a bare-JSON format
//      constraint (smoke test: asked for JSON, replied `!searchForBlock("oak_log", 32)`), so
//      the prompt offers that dialect back rather than fighting the model's own distribution --
//      registry validation + retry-once-then-skip stays the backstop, same as the Haiku design.
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
const FLEET_CAP_PER_HOUR = 30;             // CPU contention is the new budget, not dollars -- cap stays (Felix's ruling)
// #95 soak-hygiene round 2 (2026-09-02, argued in FEEDBACK.md before building): the shared
// fleet cap above means a CONCURRENT bot's own LLM calls (a live race, say) compete with a
// formal soak's bot for the same 30/hr budget -- if the race consumes it, the soak bot's own
// calls can get skipped_cap'd, directly inflating its measured direction-latency for a reason
// that has nothing to do with the engine under test. DECIDER_EXCLUDE (spawn.sh's 4th meta
// field, see discoverBots() below) solves the DIFFERENT problem of a throwaway bot that
// shouldn't be fleet work at all -- a real fleet bot like a race entry is supposed to have
// decider support, excluding it would just move the contamination the other direction.
// SOAK_BOT names the ONE bot under formal measurement for this decider PROCESS's lifetime
// (set at launch, not a standing config) -- its own calls never count against the shared cap
// and the shared cap never blocks it, fully symmetric; everyone else keeps sharing the
// ordinary cap exactly as before. Still bound by PER_BOT_MIN_GAP_MS -- this is cap isolation,
// not a runaway-LLM exemption.
const SOAK_BOT = process.env.SOAK_BOT || null;
const HANDLED_TTL_MS = 86400000;          // prune decider-state.json's dedup map after 24h
const LLM_MISS_RETRY_LIMIT = 2;           // retry-once-then-skip: 2 unusable Andy replies gives up on that episode
const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || '11434', 10);
const ANDY_MODEL = process.env.ANDY_MODEL || 'andy-cpu:latest';   // andy8-cpu:latest is the bigger sibling if micro proves too dumb

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
// (owner|server|purpose|decider_exclude, the fleet-awareness convention) ----
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
    // #95 soak-hygiene fix (2026-09-02): a throwaway/verification bot spawned alongside a
    // formal soak or race used to draw from the SAME shared fleet-wide LLM budget/rate gates
    // as the bot actually being measured, silently -- soak #2 was contaminated exactly this
    // way (SchlonzSchorsch, spawned mid-window for an unrelated fix's regression check).
    // DECIDER_EXCLUDE=1 at spawn time (spawn.sh's 4th meta field) makes a bot structurally
    // invisible to this daemon -- not a "(throwaway)" note in freeform PURPOSE text, which
    // existed before and enforced nothing. Excluded bots still run their own engine-side
    // agenda ladder exactly as always; only decider.js's polling/budget/LLM path skips them.
    let excluded = false;
    try {
      const meta = fs.readFileSync(path.join(PIDS_DIR, name + '.meta'), 'utf8').trim();
      const fields = meta.split('|');
      // spawn.sh writes the literal string "unowned" (not an empty field) when no OWNER is
      // given -- treat that sentinel as no owner, or every driverless bot would wait out the
      // 60s driver grace this daemon's own header comment promises it never gets.
      const rawOwner = (fields[0] || '').trim();
      owner = (rawOwner && rawOwner !== 'unowned') ? rawOwner : null;
      excluded = Boolean((fields[3] || '').trim());
    } catch (e) {}
    if (excluded) continue;
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

// ---- context ----
async function buildContext(b, st) {
  let skills = [];
  try {
    const r = await evalOn(b.port, 'return Object.keys(globalThis.__skills.registry);');
    skills = (r && r.result) || [];
  } catch (e) { log(`${b.name}: could not fetch skill registry: ${e.message}`); }
  return { state: st, skills };
}

// ---- Andy's native dialect -> our skill registry ----
// Standalone copies of the engine's own vocabulary (decider.js is never a payload, no
// cross-process import -- same discipline farmskills.js documents for its own copies).
const SPECIES_LIST = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove'];
const ORE_ALIASES_LIST = {
  iron_ore: ['iron_ore', 'deepslate_iron_ore'], gold_ore: ['gold_ore', 'deepslate_gold_ore'],
  copper_ore: ['copper_ore', 'deepslate_copper_ore'], coal_ore: ['coal_ore', 'deepslate_coal_ore'],
  diamond_ore: ['diamond_ore', 'deepslate_diamond_ore'], emerald_ore: ['emerald_ore', 'deepslate_emerald_ore'],
  lapis_ore: ['lapis_ore', 'deepslate_lapis_ore'], redstone_ore: ['redstone_ore', 'deepslate_redstone_ore'],
};
const UBIQUITOUS_LIST = ['stone', 'deepslate', 'dirt', 'netherrack', 'cobblestone', 'grass_block', 'sand', 'gravel'];
const PRODUCE_RESOURCES = new Set(['torch', 'cobblestone', 'coal', 'stick', 'crafting_table']);

function normalizeBlockArg(raw) { return String(raw || '').trim().replace(/^["']|["']$/g, '').toLowerCase(); }
function stripLogSuffix(name) { return name.replace(/_log$/, '').replace(/_wood$/, ''); }

// Curated, deterministic, closed. Andy-4-micro is fine-tuned on mindcraft-ce's !command(args)
// syntax; the prompt below offers it a SMALL menu drawn from that same syntax (not its full
// ~30-command vocabulary) so it answers inside its own training distribution, and this maps
// that answer back onto our real skill params. Anything it says outside this menu, or whose
// args don't resolve to something recognizable, is a MISS -- returned as null, never guessed.
function mapAndyCommand(cmd, argStrs) {
  const num = (s, dflt) => { const n = parseInt(String(s || '').trim(), 10); return Number.isFinite(n) ? n : dflt; };
  if (cmd === 'goToSurface') return { skill: 'ascendToSurface', args: {} };
  if (cmd === 'searchForBlock' || cmd === 'collectBlocks') {
    const block = normalizeBlockArg(argStrs[0]);
    const n2 = num(argStrs[1], null);
    const species = stripLogSuffix(block);
    if (SPECIES_LIST.includes(species)) {
      const args = { types: [species] };
      if (cmd === 'searchForBlock') args.maxDist = n2 || 32; else args.count = n2 || 4;
      return { skill: 'chopTrees', args };
    }
    const oreKey = Object.keys(ORE_ALIASES_LIST).find((k) => ORE_ALIASES_LIST[k].includes(block)) || null;
    if (oreKey || UBIQUITOUS_LIST.includes(block)) {
      const args = { target: oreKey || block };
      if (cmd === 'searchForBlock') args.maxDist = n2 || 32; else args.count = n2 || 4;
      return { skill: 'mineLane', args };
    }
    return null;
  }
  if (cmd === 'craftRecipe') {
    const item = normalizeBlockArg(argStrs[0]);
    const n2 = num(argStrs[1], 16);
    if (PRODUCE_RESOURCES.has(item) || /_planks$/.test(item)) return { skill: 'produce', args: { resource: item, count: n2 } };
    return null;
  }
  if (cmd === 'attack') {
    const species = normalizeBlockArg(argStrs[0]);
    if (species && species !== 'player') return { skill: 'huntAnimals', args: { species: [species] } };
    return null;
  }
  return null;
}
function parseAndyResponse(raw) {
  if (!raw) return null;
  const m = /!([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)/.exec(raw);
  if (!m) return null;
  return { cmd: m[1], argStrs: m[2].trim() ? m[2].split(',').map((x) => x.trim()) : [] };
}
const SITUATIONS = {
  unproductive_idle: 'has been idle with no clear task for a while',
  project_stalled: 'has a project that stopped making progress',
  no_path: 'is stuck -- no path found to its goal',
  no_tool: 'lacks a tool it needs',
};
// A bare closed-menu instruction ("reply with exactly one of these five") did NOT reliably hold
// Andy-4-micro to the menu in smoke testing -- it answers from its own ~30-command fine-tuned
// vocabulary regardless (e.g. `!moveAway(10)`, `!goToPlayer(...)`, `!newAction(...)`, or plain
// chat with no `!command` at all). A one-shot example in its OWN dialect measurably improved
// compliance on the matching case. This is expected to stay imperfect -- misses are logged with
// raw text (not guessed into a dispatch) precisely so the mapping in mapAndyCommand can widen
// over time from what Andy actually says, per Felix's "study the dialect" instruction.
function buildAndyPrompt(ctx) {
  const s = ctx.state;
  const a = s.agenda || {};
  const d = a.direction || {};
  return [
    `You are ${s.name}, a Minecraft bot deciding your next action.`,
    `Stats: health: ${s.health}, hunger: ${s.food}`,
    'Available commands:',
    '!goToSurface() - dig upward to open sky',
    '!searchForBlock(block_name, distance) - go mine the nearest block of this type',
    '!collectBlocks(block_name, count) - mine several blocks of this type nearby',
    '!craftRecipe(item_name, count) - craft this item',
    '!attack(animal_name) - hunt this animal',
    '',
    'Example:',
    'Situation: has been idle with no clear task for a while',
    'Response: !searchForBlock("oak_log", 32)',
    '',
    `Situation: ${SITUATIONS[d.why] || d.why || 'needs a new task'}`,
    'Response:',
  ].join('\n');
}

// Guard inherited from mindcraft-ce/andy-start.sh: refuse the LLM path if Ollama has offloaded
// ANDY_MODEL onto the GPU (andy-cpu must stay CPU-pinned). Not loaded yet is NOT a failure --
// there's nothing to check until the first call loads it; a request/parse hiccup fails open
// (`ok:true`) rather than blocking the whole soak on an ops-check the real /api/chat call would
// surface anyway.
function checkCpuPinned() {
  return new Promise((resolve) => {
    const req = http.get({ host: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/ps', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const m = (j.models || []).find((mm) => mm.name === ANDY_MODEL || mm.model === ANDY_MODEL);
          if (!m) return resolve({ ok: true, loaded: false });
          resolve({ ok: (m.size_vram || 0) === 0, loaded: true, vram: m.size_vram || 0 });
        } catch (e) { resolve({ ok: true, loaded: false }); }
      });
    });
    req.on('error', () => resolve({ ok: true, loaded: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: true, loaded: false }); });
  });
}
async function askAndy(ctx) {
  const guard = await checkCpuPinned();
  if (!guard.ok) {
    log(`ABORT LLM path: ${ANDY_MODEL} size_vram=${guard.vram} (>0, on GPU) -- fix the model pin before spending another call`);
    return { decision: null, raw: null, aborted: 'gpu_pinned' };
  }
  const prompt = buildAndyPrompt(ctx);
  const body = JSON.stringify({ model: ANDY_MODEL, messages: [{ role: 'user', content: prompt }], stream: false });
  const raw = await new Promise((resolve) => {
    const req = http.request({
      host: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = JSON.parse(data); resolve((j.message && j.message.content) || null); }
        catch (e) { log('andy response parse failed: ' + e.message); resolve(null); }
      });
    });
    req.on('error', (e) => { log('andy call failed: ' + e.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); log('andy call timed out'); resolve(null); });
    req.write(body); req.end();
  });
  if (!raw) return { decision: null, raw: null };
  const parsed = parseAndyResponse(raw);
  if (!parsed) { log(`${ctx.state.name}: no !command() found in Andy's reply: ${raw.slice(0, 200)}`); return { decision: null, raw }; }
  const mapped = mapAndyCommand(parsed.cmd, parsed.argStrs);
  if (!mapped) { log(`${ctx.state.name}: Andy's '!${parsed.cmd}(...)' didn't map to a known skill -- discarding, not dispatching garbage`); return { decision: null, raw }; }
  return { decision: mapped, raw };
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

  // #97 item 3: a bot that hasn't moved AND is stalling on the exact same why+lastError as
  // its LAST dispatch attempt is very unlikely to be helped by dispatching the identical
  // thing again -- test-driver's live evidence: three identical chopTrees dispatches from a
  // frozen position, back to back, across three separate episodes. Track the signature at
  // every genuinely-new-episode attempt (this runs once per eid, gated by the dedup check
  // above) and skip the WHOLE decision -- saving an Andy call too, not just the dispatch --
  // when nothing observable about the situation has changed since last time. Closes the
  // episode via the SAME dirClose #95 already built (closedBy:'frozen_repeat') rather than
  // either blindly re-dispatching an identical failing call or leaving the episode open --
  // the exact same reopen-backoff every other close uses gives it another shot later if the
  // world (position, kit, whatever) actually changes.
  // TWO BUGS FOUND LIVE during the deferred wiring check this fixture-zero comment promised
  // (2026-09-02, both on the actual restart -- exactly why that check was deferred rather
  // than assumed):
  // 1. Without an eid in the tracked signature, this fired on the SECOND POLL OF THE SAME
  //    STILL-RETRYING EPISODE, not just across genuinely separate episodes -- every poll
  //    that passes dedup (including a mid-retry re-poll of an episode decider hasn't given
  //    up on yet) unconditionally rewrote `lastAttempt` to the identical {pos,why,lastError},
  //    so the very next poll compared it against itself and always matched, short-circuiting
  //    the 2-attempt-then-give-up Andy retry after just ONE attempt. Fixed by tracking `eid`
  //    and requiring it to DIFFER -- matching within the SAME eid is decider re-polling its
  //    own in-progress retry, not a repeat.
  // 2. `prevAttempt.eid !== eid` alone is backwards on missing data: a `lastAttempt` entry
  //    persisted by the OLD code (no `eid` field, live in decider-state.json across this
  //    exact restart) has `eid: undefined`, and `undefined !== "realEid"` is true -- so a
  //    STALE entry with no real signal read as "confirmed different episode" and false-
  //    triggered against BruzzelBruno's genuinely in-progress retry the instant this
  //    restarted, costing it one legitimate Andy attempt (not left stuck -- dirClose +
  //    reopen-backoff still applied -- but a real, avoidable false positive). `&&
  //    prevAttempt.eid` requires an ACTUAL prior eid before ever treating "different" as
  //    meaningful -- missing/ambiguous data defaults to "don't skip", not "skip", matching
  //    this codebase's own never-guess-on-missing-data doctrine everywhere else.
  const FROZEN_POS_TOLERANCE = 1.5;   // blocks -- "hasn't moved" allows for settle/jitter
  state.lastAttempt = state.lastAttempt || {};
  const prevAttempt = state.lastAttempt[b.name];
  const curPos = st.position || null;
  const lastError = (dir.detail && dir.detail.lastError) || null;
  const frozenRepeat = Boolean(prevAttempt && prevAttempt.eid && prevAttempt.eid !== eid && curPos
    && Math.abs(curPos.x - prevAttempt.pos.x) < FROZEN_POS_TOLERANCE
    && Math.abs(curPos.y - prevAttempt.pos.y) < FROZEN_POS_TOLERANCE
    && Math.abs(curPos.z - prevAttempt.pos.z) < FROZEN_POS_TOLERANCE
    && prevAttempt.why === dir.why && prevAttempt.lastError === lastError);
  if (curPos) state.lastAttempt[b.name] = { pos: curPos, why: dir.why, lastError, eid };
  if (frozenRepeat) {
    state.handled[dedupKey] = Date.now();
    appendDecision({ t: Date.now(), bot: b.name, eid, why: dir.why, key: ruleKey(dir, st.role || null),
      src: 'skipped_frozen_repeat', decision: null, latency_ms: null });
    try { await evalOn(b.port, `return __agenda.dirClose(${JSON.stringify(eid)}, 'frozen_repeat');`); }
    catch (e) { /* best-effort -- worst case, episode just stays open as it always did */ }
    log(`${b.name}: skipping an identical dispatch from a frozen position (why=${dir.why}, lastError=${lastError}) -- closed frozen_repeat so a fresh episode can reopen if the world actually changes`);
    return;
  }

  const role = st.role || null;
  const key = ruleKey(dir, role);
  const rule = rules[key];
  let decision = null, src = null, decisionLatencyMs = null, raw = null;

  if (rule) {
    decision = rule; src = 'rule'; decisionLatencyMs = 0;
  } else {
    // step 5: rate gates BEFORE spending anything
    const lastAt = (state.lastCallAt || {})[b.name] || 0;
    if (Date.now() - lastAt < PER_BOT_MIN_GAP_MS) return;   // this bot's spacing hasn't elapsed; try again next poll, not a permanent skip
    // #95 soak-hygiene: the designated SOAK_BOT bypasses the shared fleet cap entirely, both
    // directions -- unrelated fleet activity (a concurrent race, say) can never delay it, and
    // its own calls never eat into the budget everyone else shares.
    if (b.name !== SOAK_BOT && !fleetCapOk()) {
      appendDecision({ t: Date.now(), bot: b.name, eid, why: dir.why, key, src: 'skipped_cap', decision: null, latency_ms: null });
      return;   // logged, never spent -- the overflow is visible, not silent
    }
    const ctx = await buildContext(b, st);
    const t0 = Date.now();
    const { decision: mapped, raw: rawOut, aborted } = await askAndy(ctx);
    if (aborted) return;   // guard blocked before any inference ran -- no rate/cap charge, no decisions.jsonl noise; the console warning is the ops signal
    state.lastCallAt = state.lastCallAt || {}; state.lastCallAt[b.name] = Date.now();
    if (b.name !== SOAK_BOT) recordFleetCall();
    const llmLatencyMs = Date.now() - t0;
    if (!mapped || typeof mapped.skill !== 'string' || !ctx.skills.includes(mapped.skill)) {
      // logged with the RAW model output regardless of outcome (#68 Phase 3 dialect-study ask) --
      // a rule/llm miss used to vanish into a console line only; now it's in decisions.jsonl too.
      state.llmMisses = state.llmMisses || {};
      state.llmMisses[dedupKey] = (state.llmMisses[dedupKey] || 0) + 1;
      appendDecision({ t: Date.now(), bot: b.name, eid, why: dir.why, key, src: 'llm', decision: null,
        raw: (rawOut || '').slice(0, 500), latency_ms: llmLatencyMs, dispatchOk: false, dispatchError: 'unmapped_or_unparsed' });
      if (state.llmMisses[dedupKey] >= LLM_MISS_RETRY_LIMIT) {
        state.handled[dedupKey] = Date.now();   // retry-once-then-skip: give up, the IDLE floor/driver/a future rule takes it from here
        // #95: a give-up used to stop here -- "handled" only in decider-state.json, the
        // episode itself never closed, and agenda's own single-latch (openEpisode's `if
        // (d.episode) return`) then silently blocked every future stall detection for as
        // long as the underlying condition persisted (soak #2's dead-consumer: 9+ repeat
        // kit_missing failures over 30+ minutes, zero further direction-episode activity of
        // any kind). Close it explicitly via dirClose (same eid-CAS safety as dirDispatch,
        // touches nothing but the episode) so agenda's existing per-`why` reopen backoff
        // (30s->60s->120s->300s) gets a chance to open a FRESH episode later if the stall is
        // still real -- giving the decider (or a driver, or a future rule) another shot
        // instead of permanent silence. Fire-and-forget: if this fails (bot gone, network),
        // the episode just stays open as it always did -- no new failure mode introduced.
        try {
          await evalOn(b.port, `return __agenda.dirClose(${JSON.stringify(eid)}, 'decider_exhausted');`);
        } catch (e) { /* best-effort -- worst case, unchanged from today's behavior */ }
        log(`${b.name}: giving up on episode ${eid} after ${LLM_MISS_RETRY_LIMIT} unusable Andy replies -- closed decider_exhausted so a fresh episode can reopen later`);
      } else {
        log(`${b.name}: no usable decision from Andy for episode ${eid} (attempt ${state.llmMisses[dedupKey]}/${LLM_MISS_RETRY_LIMIT})`);
      }
      return;
    }
    decision = mapped; src = 'llm'; decisionLatencyMs = llmLatencyMs; raw = (rawOut || '').slice(0, 500);
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
  appendDecision({ t: Date.now(), bot: b.name, eid, why: dir.why, key, src, decision, raw, latency_ms: decisionLatencyMs, dispatchOk, dispatchError });
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

log(`decider.js starting -- poll every ${POLL_MS / 1000}s, driver grace ${DRIVER_GRACE_MS / 1000}s, fleet cap ${FLEET_CAP_PER_HOUR}/hr, model ${ANDY_MODEL} via ${OLLAMA_HOST}:${OLLAMA_PORT}${SOAK_BOT ? `, SOAK_BOT=${SOAK_BOT} (exempt from fleet cap, both directions)` : ''}`);
checkCpuPinned().then((g) => {
  if (g.loaded && !g.ok) log(`WARNING: ${ANDY_MODEL} is already loaded with size_vram=${g.vram} (on GPU) -- the LLM path will refuse to call until this is fixed; rule.json hits are unaffected`);
});
setInterval(() => { pollOnce().catch((e) => log('poll cycle error: ' + e.message)); }, POLL_MS);
pollOnce().catch((e) => log('initial poll error: ' + e.message));
