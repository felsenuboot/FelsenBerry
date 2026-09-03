#!/usr/bin/env node
// bench/decider-latency-replay.js — TODO 4b fixture: synthetic-episode replay against the
// REAL decider.js decision logic (require()'d as a module, not reimplemented — decider.js
// exports a test-only surface for exactly this, see its own tail comment). No real bot, no
// real Ollama, no real pids/logs/decider-state.json touched: a fake bot HTTP server and a
// fake Ollama HTTP server stand in, and decider's module-scoped dedup/rate-gate state is
// reset via setState() between cases.
//
// What broke (soak #4, attributed in SCOREBOARD.md's "SOAK #4" section / decider.js's own
// header): direction-gate latency floored at 68-85s per episode close because the driver-
// grace check keyed on `b.owner` — which the OWNER/PURPOSE fleet-awareness law now sets on
// EVERY bot — instead of an actual "is someone driving this" signal, plus a parse-miss retry
// paying the full 120s PER_BOT_MIN_GAP_MS instead of riding the next ~20s poll. This replay
// proves the fix without needing a real hour-long soak:
//   1. rule-path close, owned-but-NOT-driven bot: must dispatch on the very first poll
//      (forMs=0) — proves the grace no longer keys on OWNER alone.
//   2. rule-path close, DRIVEN bot: must NOT dispatch before DRIVER_GRACE_MS elapses, and
//      must dispatch once it has — proves DRIVEN still does its actual job (the fix is not a
//      blanket "always answer immediately", it is a correctly-keyed conditional grace).
//   3. an unmapped/unparsed Andy reply retries on the very next handleBot() call (simulating
//      the next ~POLL_MS poll, no real 120s wait) — proves (b) rides the poll, not the gap —
//      and gives up (decider_exhausted) after LLM_MISS_RETRY_LIMIT misses, same as before.
//   4. a genuinely SEPARATE new episode for the same bot, arriving right after case 3's second
///     LLM call, still pays PER_BOT_MIN_GAP_MS — proves the bypass is scoped to a same-eid
//      retry only, not a blanket rate-gate removal.
//
// Run: node bench/decider-latency-replay.js
'use strict';
const http = require('http');

// Fake Ollama must be listening (env picked up at decider.js require-time) BEFORE the require.
const OLLAMA_PORT = 32111;
process.env.OLLAMA_HOST = '127.0.0.1';
process.env.OLLAMA_PORT = String(OLLAMA_PORT);

const path = require('path');
const decider = require(path.join(__dirname, '..', 'decider.js'));
const { handleBot, ruleKey, loadRules, getState, setState,
        DRIVER_GRACE_MS, PER_BOT_MIN_GAP_MS, LLM_MISS_RETRY_LIMIT, POLL_MS, mapAndyCommand } = decider;

let failures = 0;
let passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ok - ${msg}`); }
  else { failures++; console.log(`  FAIL - ${msg}`); }
}
function resetState() { setState({ handled: {}, lastCallAt: {}, fleetCalls: [], lastAttempt: {}, llmMisses: {} }); }

// ---- fake bot: /state (mutable per test) + /eval (records dirDispatch/dirClose calls + the
// skill-registry query buildContext() makes) ----
function makeFakeBot() {
  const calls = { dispatch: [], close: [] };
  let stateBody = null;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(stateBody));
      return;
    }
    if (req.method === 'POST' && req.url === '/eval') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let code = '';
        try { code = JSON.parse(body).code || ''; } catch (e) {}
        let result;
        if (/globalThis\.__skills\.registry/.test(code)) {
          result = ['chopTrees', 'ascendToSurface', 'mineLane', 'produce', 'huntAnimals'];
        } else if (/dirDispatch/.test(code)) {
          const m = /dirDispatch\((".*?"),\s*(\{.*\})\)/.exec(code);
          const rec = { eid: m && JSON.parse(m[1]), decision: m && JSON.parse(m[2]), t: Date.now() };
          calls.dispatch.push(rec);
          result = { ok: true };
        } else if (/dirClose/.test(code)) {
          const m = /dirClose\((".*?"),\s*'([^']*)'\)/.exec(code);
          calls.close.push({ eid: m && JSON.parse(m[1]), closedBy: m && m[2], t: Date.now() });
          result = { ok: true };
        } else {
          result = null;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return {
    server, calls,
    setState: (s) => { stateBody = s; },
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ---- fake Ollama: /api/ps (CPU-pin guard, report nothing loaded) + /api/chat (scripted reply
// sequence, one per call) ----
function makeFakeOllama(replies) {
  let i = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/ps') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const content = replies[Math.min(i, replies.length - 1)]; i++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: { content } }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return { server, listen: () => new Promise((resolve) => server.listen(OLLAMA_PORT, '127.0.0.1', resolve)),
           close: () => new Promise((resolve) => server.close(resolve)), callCount: () => i };
}

function needsDirection(forMs, why) {
  return { state: 'needs_direction', eid: 'replay-' + why + '-' + forMs, forMs, why, detail: {} };
}

async function main() {
  const rules = loadRules();
  const ruleWhy = 'unproductive_idle';
  const ruleKeyStr = ruleKey({ why: ruleWhy, detail: {} }, null);
  assert(Boolean(rules[ruleKeyStr]), `rules.json has a real entry for '${ruleKeyStr}' (using the actual rule table, not a synthetic one)`);

  const fakeOllama = makeFakeOllama(['no bang command here, just chatter']);
  await fakeOllama.listen();
  const fb = makeFakeBot();
  const port = await fb.listen();

  try {
    // ---- case 1: owned-but-not-driven bot, rule path, episode JUST opened (forMs=0) ----
    resetState();
    fb.calls.dispatch.length = 0;
    const bot1 = { name: 'ReplayBotA', port, owner: 'engine-dev-3', driven: false };
    fb.setState({ name: 'ReplayBotA', position: { x: 0, y: 64, z: 0 }, role: null, health: 20, food: 20,
      agenda: { direction: needsDirection(0, ruleWhy) } });
    const t0 = Date.now();
    await handleBot(bot1, rules);
    const latency1 = Date.now() - t0;
    assert(fb.calls.dispatch.length === 1, 'owned-but-not-driven bot with forMs=0 dispatches on the very first poll (no OWNER-keyed grace)');
    assert(latency1 < 30000, `rule-path close latency ${latency1}ms < 30000ms`);
    assert(POLL_MS < 30000, `structural bound: POLL_MS (${POLL_MS}ms) itself is < 30000ms, so even a worst-case "episode opened right after a poll" case stays under the human-bar rule-path target`);

    // ---- case 2: DRIVEN bot — grace must still hold at forMs=0, and release once elapsed ----
    resetState();
    fb.calls.dispatch.length = 0;
    const bot2 = { name: 'ReplayBotB', port, owner: 'engine-dev-3', driven: true };
    fb.setState({ name: 'ReplayBotB', position: { x: 0, y: 64, z: 0 }, role: null, health: 20, food: 20,
      agenda: { direction: needsDirection(0, ruleWhy) } });
    await handleBot(bot2, rules);
    assert(fb.calls.dispatch.length === 0, 'DRIVEN bot at forMs=0 gets the driver grace — decider stays out of the way');
    fb.setState({ name: 'ReplayBotB', position: { x: 0, y: 64, z: 0 }, role: null, health: 20, food: 20,
      agenda: { direction: needsDirection(DRIVER_GRACE_MS + 1000, ruleWhy) } });
    await handleBot(bot2, rules);
    assert(fb.calls.dispatch.length === 1, 'DRIVEN bot past DRIVER_GRACE_MS finally gets answered (grace is a delay, not a permanent skip)');

    // ---- case 3: unmapped/unparsed Andy reply retries on the NEXT handleBot() call (no real
    // 120s wait), and gives up after LLM_MISS_RETRY_LIMIT misses ----
    resetState();
    fb.calls.close.length = 0;
    const noRuleWhy = 'no_path';   // not in rules.json -> forces the LLM path
    const noRuleKey = ruleKey({ why: noRuleWhy, detail: {} }, null);
    assert(!rules[noRuleKey], `'${noRuleKey}' has no rule entry — this case genuinely exercises the LLM path, not a rule hit`);
    const bot3 = { name: 'ReplayBotC', port, owner: 'engine-dev-3', driven: false };
    const dir3 = needsDirection(0, noRuleWhy);
    fb.setState({ name: 'ReplayBotC', position: { x: 10, y: 64, z: 10 }, role: null, health: 20, food: 20, agenda: { direction: dir3 } });
    const beforeOllama = fakeOllama.callCount();
    await handleBot(bot3, rules);   // 1st miss: recorded, not exhausted, no dispatch/close
    assert(fakeOllama.callCount() === beforeOllama + 1, 'first LLM attempt actually calls Ollama once');
    assert(fb.calls.close.length === 0, 'first miss does not close the episode yet (retry-once-then-skip)');
    // Same episode (same eid), called again with NO real elapsed time — the old code would
    // block here on `Date.now() - lastCallAt < PER_BOT_MIN_GAP_MS` since lastCallAt was just
    // set milliseconds ago.
    await handleBot(bot3, rules);
    assert(fakeOllama.callCount() === beforeOllama + 2,
      `second attempt on the SAME episode rode the very next call (no real ${PER_BOT_MIN_GAP_MS}ms wait needed) — proves the retry no longer pays PER_BOT_MIN_GAP_MS`);
    assert(fb.calls.close.length === 1 && fb.calls.close[0].closedBy === 'decider_exhausted',
      `after ${LLM_MISS_RETRY_LIMIT} unusable replies the episode closes decider_exhausted, same as before`);

    // ---- case 4: a genuinely NEW episode right after case 3 still pays PER_BOT_MIN_GAP_MS —
    // the bypass must be scoped to a same-eid retry, not a blanket rate-gate removal ----
    // A different position than case 3's, deliberately: same position + same why/lastError
    // would (correctly) trip the #97 frozen_repeat detector first and never even reach the
    // rate-gate code this case exists to test — this must be a "moved, genuinely new episode"
    // scenario, not a "still stuck in the same spot" one (that is TODO 5c's territory).
    const dir4 = needsDirection(0, noRuleWhy);
    dir4.eid = 'replay-' + noRuleWhy + '-fresh';
    fb.setState({ name: 'ReplayBotC', position: { x: 50, y: 64, z: 50 }, role: null, health: 20, food: 20, agenda: { direction: dir4 } });
    const beforeOllama2 = fakeOllama.callCount();
    await handleBot(bot3, rules);
    assert(fakeOllama.callCount() === beforeOllama2,
      'a genuinely separate new episode for the same bot still respects PER_BOT_MIN_GAP_MS (no Ollama call yet) — the retry bypass did not turn into a blanket rate-gate removal');
  } finally {
    await fb.close();
    await fakeOllama.close();
  }

  // ---- TODO 7b (#73): mapAndyCommand's species mapping — pure, no fake bot/Ollama needed ----
  // Andy names exactly ONE species (mindcraft-ce's own !searchForBlock dialect always does),
  // which is a fact about its training distribution (oak is its overwhelmingly common
  // example), not a real observation of what wood is actually nearby. The old mapping
  // (`types:[species]`) treated that guess as a hard restriction and recreated soak #4's own
  // wood-freeze shape at a birch/spruce spawn. Fixed to 'any', matching skills.js's own
  // chopTrees default (its own header: "#A: default ANY species, not oak-only").
  for (const [cmd, block] of [['searchForBlock', 'oak_log'], ['collectBlocks', 'birch_log']]) {
    const mapped = mapAndyCommand(cmd, [`"${block}"`, '32']);
    assert(mapped && mapped.skill === 'chopTrees', `mapAndyCommand('${cmd}', '${block}') resolves to chopTrees`);
    assert(mapped && mapped.args && mapped.args.types === 'any',
      `mapAndyCommand('${cmd}', '${block}') maps to types:'any', NOT types:['${block.replace('_log', '')}'] — Andy's named species is a preference signal, never a hard restriction`);
  }
  // sanity: a non-species block (ore/ubiquitous) is UNAFFECTED by this change — still maps to
  // mineLane with its own real target, not accidentally swept into the 'any species' branch.
  const oreMapped = mapAndyCommand('searchForBlock', ['"iron_ore"', '32']);
  assert(oreMapped && oreMapped.skill === 'mineLane' && oreMapped.args.target === 'iron_ore',
    'a non-species block (iron_ore) still maps to mineLane with its real target, unaffected by the species-preference fix');

  console.log(`\nREPLAY: ${passed}/${passed + failures}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('replay crashed:', e); process.exit(1); });
