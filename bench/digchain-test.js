#!/usr/bin/env node
// bench/digchain-test.js — GitHub #55 regression test for the bot.dig guard chain.
// Pure Node, no Minecraft server: it runs the real digchain.js payload against a fake bot and
// proves the two historical failure modes are STRUCTURALLY impossible:
//   (1) re-injecting on reconnect never re-stacks wrappers (the 9.2M-recursion class), and
//   (2) the chain never silently drops a guard level (the accidental level-2 removal class),
// plus order, force-bypass, reject/equip semantics, and a clean restore.
//   run: node bench/digchain-test.js   (exit 0 = pass, 1 = fail)
'use strict';
const fs = require('fs');
const path = require('path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'digchain.js'), 'utf8');
const injectDigchain = new AsyncFunction('bot', 'mineflayer', 'pathfinder', 'goals', 'Vec3', SRC);

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

// A fresh pristine bot.dig, tagged so we can assert identity. Resolves with a trace string.
const makePristine = (tag) => { const f = (block) => Promise.resolve('DUG:' + tag + ':' + (block && block.name)); f.__pristineTag = tag; return f; };
const depthOf = (fn) => { let d = 0, cur = fn; while (cur && cur.__wrappedTarget && d < 100) { d++; cur = cur.__wrappedTarget; } return d; };
const trueOrig = (fn) => { let cur = fn; while (cur && cur.__wrappedTarget) cur = cur.__wrappedTarget; return cur; };

// A fake bot; equip records what was equipped.
const makeBot = (pristine) => ({ dig: pristine, equip: async (item) => { fakeBot._equipped = item; }, once: () => {} });
let fakeBot;

// Ordered call recorder + the three stub guards (stand in for reach/tool/protection).
let trace = [];
const passCheck = (name) => (block) => { trace.push(name); return null; };

async function reinject() { await injectDigchain(fakeBot, {}, {}, {}, function () {}); }
function registerAll(reachFn, toolFn, protFn) {
  globalThis.__digchain.register('protection', 2, protFn || passCheck('protection'));
  globalThis.__digchain.register('reach', 0, reachFn || passCheck('reach'));       // deliberately out of order
  globalThis.__digchain.register('tool', 1, toolFn || passCheck('tool'));          // to prove ORDER comes from the registry, not call order
}

(async () => {
  // ---- setup: fresh bot, inject, register three passing guards ----
  const p0 = makePristine('p0');
  fakeBot = makeBot(p0);
  await reinject();
  registerAll();

  ok(fakeBot.dig.__digchainWrapper === true, 'installs a single chain wrapper on bot.dig');
  ok(trueOrig(fakeBot.dig) === p0, 'wrapper.__wrappedTarget resolves to the TRUE pristine original');
  ok(depthOf(fakeBot.dig) === 1, 'exactly one wrapper layer (depth === 1)');

  // ---- order: registered out of order, must run reach -> tool -> protection ----
  trace = [];
  await fakeBot.dig({ name: 'stone' });
  ok(trace.join(',') === 'reach,tool,protection', 'runs checks in registry order reach->tool->protection, not registration order (got: ' + trace.join(',') + ')');

  // ---- FAILURE MODE 1: re-inject (reconnect) must NOT re-stack ----
  for (let i = 0; i < 100; i++) await reinject();       // 100 reconnect re-injects
  ok(depthOf(fakeBot.dig) === 1, 'after 100 re-injects, still exactly one wrapper (no re-stack) — depth=' + depthOf(fakeBot.dig));
  ok(trueOrig(fakeBot.dig) === p0, 'after 100 re-injects, true original is still the pristine dig (not a wrapper)');

  // ---- FAILURE MODE 2: re-inject must NOT drop a guard level ----
  trace = [];
  await fakeBot.dig({ name: 'stone' });
  ok(trace.join(',') === 'reach,tool,protection', 'after re-injects, all three guards still run in order (no silent drop)');

  // ---- reconnect with a genuinely NEW pristine dig: rebind, still one layer ----
  const p1 = makePristine('p1');
  fakeBot.dig = p1;                                      // runner.js builds a fresh bot on reconnect
  await reinject();
  registerAll();                                         // guards re-register on their own re-inject
  ok(trueOrig(fakeBot.dig) === p1, 'reconnect rebinds the chain to the NEW pristine dig');
  ok(depthOf(fakeBot.dig) === 1, 'reconnect keeps depth === 1 (no leak of the dead bot wrapper)');
  const r = await fakeBot.dig({ name: 'dirt' });
  ok(r === 'DUG:p1:dirt', 'a passing dig reaches the new true original and returns its result');

  // ---- force bypass: opts.force skips every guard ----
  trace = [];
  const rf = await fakeBot.dig({ name: 'stone' }, false, { force: true });
  ok(trace.length === 0 && rf === 'DUG:p1:stone', 'opts.force short-circuits all guards straight to the original');

  // ---- reject: a guard {reject} stops the chain; later guards do not run ----
  const rejErr = Object.assign(new Error('protected_structure:test'), { code: 'protected_structure' });
  trace = [];
  globalThis.__digchain.register('reach', 0, passCheck('reach'));
  globalThis.__digchain.register('tool', 1, (b) => { trace.push('tool'); return { reject: rejErr }; });
  globalThis.__digchain.register('protection', 2, passCheck('protection'));
  let rejected = null;
  try { await fakeBot.dig({ name: 'plaza' }); } catch (e) { rejected = e; }
  ok(rejected === rejErr, 'a guard {reject} rejects the dig with that error');
  ok(trace.join(',') === 'reach,tool' && !trace.includes('protection'), 'a reject stops the chain — later guards do not run');

  // ---- equip: a guard {equip} equips then continues ----
  const tool = { name: 'stone_pickaxe' };
  fakeBot._equipped = null;
  globalThis.__digchain.register('tool', 1, () => ({ equip: tool }));
  globalThis.__digchain.register('protection', 2, passCheck('protection'));
  const re = await fakeBot.dig({ name: 'stone' });
  ok(fakeBot._equipped === tool, 'a guard {equip} equips the item (equip-first)');
  ok(re === 'DUG:p1:stone', 'after equip, the chain continues to the original');

  // ---- _unstick backstop (eng-2, #55): a PROTECTED block dug with NO force must still be
  // rejected. v41's generalized _unstick digs any empty-boundingBox block and relies on the
  // protection level's rejection at bot.dig as its backstop, so this must hold through the chain. ----
  globalThis.__digchain.register('reach', 0, passCheck('reach'));
  const protErr = Object.assign(new Error('protected_structure:plaza'), { code: 'protected_structure' });
  globalThis.__digchain.register('protection', 1, () => ({ reject: protErr }));
  globalThis.__digchain.register('tool', 2, passCheck('tool'));
  let backstop = null;
  try { await fakeBot.dig({ name: 'stone' }); } catch (e) { backstop = e; }   // NO force passed
  ok(backstop === protErr, '_unstick backstop: a protected block dug with NO force is rejected by the protection level');

  // ---- a guard that THROWS a non-coded bug must never break a real dig ----
  globalThis.__digchain.register('tool', 1, () => { throw new Error('guard bug, no code'); });
  globalThis.__digchain.register('protection', 2, passCheck('protection'));
  const rb = await fakeBot.dig({ name: 'stone' });
  ok(rb === 'DUG:p1:stone', 'a non-coded guard exception is swallowed — the dig still reaches the original');

  // ---- a guard that THROWS a coded refusal must propagate ----
  globalThis.__digchain.register('tool', 1, () => { const e = new Error('tool_missing'); e.code = 'tool_missing'; throw e; });
  let coded = null;
  try { await fakeBot.dig({ name: 'stone' }); } catch (e) { coded = e; }
  ok(coded && coded.code === 'tool_missing', 'a coded guard throw (tool_missing) propagates as a real refusal');

  // ---- restore: back to the pristine original, registry cleared ----
  globalThis.__digchain.restore();
  ok(fakeBot.dig === p1, 'restore() returns bot.dig to the true pristine original');
  ok(globalThis.__digchain.guards.size === 0, 'restore() clears the guard registry');

  console.log('\nDIGCHAIN-TEST: ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST HARNESS ERROR:', e); process.exit(1); });
