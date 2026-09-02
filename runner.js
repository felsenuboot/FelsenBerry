#!/usr/bin/env node
'use strict';

/*
 * runner.js — single Minecraft bot process with a local HTTP control API.
 *
 * Usage:
 *   node runner.js --name <username> --port <controlPort> [--host <mcHost>] [--mcport <mcPort>] [--version <mcVersion>]
 *
 * Defaults: --host 100.101.197.44 --mcport 25565
 * Control API binds to 127.0.0.1:<controlPort> ONLY.
 */

const http = require('http');
const util = require('util');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const pathfinderPlugin = require('mineflayer-pathfinder');
const { pathfinder, Movements, goals } = pathfinderPlugin;
const { Vec3 } = require('vec3');
// metrics ledger (EVALUATION.md E1-E2). Optional: a telemetry failure must never stop a bot.
let goto2 = null;
try { goto2 = require('./goto2.patch.js'); } catch (err) { console.log('goto2.patch.js not loaded: ' + err.message); }
let telemetry = null;
try { telemetry = require('./telemetry.js'); } catch (err) { console.log('telemetry.js not loaded: ' + err.message); }

// ---------- optional "Baritone-like" plugins ----------
// Every load is guarded: a missing/broken plugin logs a warning and its endpoint
// returns 501, but the bot always starts. Never required for the core API.
const optionalPlugins = {}; // label -> plugin function
function tryLoadPlugin(label, loader) {
  try {
    const p = loader();
    if (typeof p !== 'function') throw new Error('export is not a plugin function');
    optionalPlugins[label] = p;
  } catch (err) {
    console.log(`[${new Date().toISOString()}] [${NAME || '?'}] optional plugin '${label}' not loaded: ${err.message}`);
  }
}

// ---------- CLI args ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const NAME = args.name;
const CONTROL_PORT = parseInt(args.port, 10);
// Host/port: --host / --mcport win, then MC_HOST / MC_PORT env, then the fleet default.
// The env fallback exists so a whole shell can be pointed at a local test server
// (MC_HOST=127.0.0.1 MC_PORT=25599) without threading flags through every spawn.
const MC_HOST = args.host || process.env.MC_HOST || '100.101.197.44';
const MC_PORT = parseInt(args.mcport || process.env.MC_PORT || '25565', 10);
const MC_VERSION = args.version || undefined; // let mineflayer auto-detect unless pinned
// parseArgs consumes the NEXT token as a flag's value, so a valueless `--agenda` lands as
// undefined — presence in the object is the correct test, not its value.
const AGENDA = ('agenda' in args) || process.env.AGENDA === '1';
// Role: --role wins, else roster.json keyed by bot name. The fallback exists because
// --role is opt-in and nothing was passing it, so every rolling restart had each driver
// hand-rolling a sed substitution for idleguard's __ROLE__ template — the same workaround
// reinvented five times. Read at startup; an unknown bot simply has no role.
function rosterRole(name) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'roster.json'), 'utf8'));
    return (r.roles && r.roles[name]) || null;
  } catch (_) { return null; }
}
// optional: 'lumberjack'|'miner'|'hunter'|'builder'|'farmer' — enables the role-templated
// idleguard (and the agenda's role defaults) on spawn. --role wins; roster.json is the
// fallback so a bot always has one without anyone hand-rolling a sed substitution.
const ROLE = args.role || rosterRole(NAME);

if (!NAME || !CONTROL_PORT) {
  console.error('Usage: node runner.js --name <username> --port <controlPort> [--host h] [--mcport p] [--version v]');
  process.exit(2);
}

// mineflayer-tool must load before collectblock uses it (collectblock depends on it).
tryLoadPlugin('tool', () => require('mineflayer-tool').plugin);
tryLoadPlugin('collectblock', () => require('mineflayer-collectblock').plugin);
tryLoadPlugin('autoeat', () => require('mineflayer-auto-eat').plugin);
tryLoadPlugin('armorManager', () => {
  const m = require('mineflayer-armor-manager');
  // Upstream ranks armor materials worst->best as [...golden, iron, chainmail...], but
  // chainmail is WEAKER than iron everywhere it matters (chestplate 5 vs 6, leggings
  // 4 vs 5) — so an iron-clad bot that walks over a chainmail drop auto-equips it and
  // DOWNGRADES itself. Reorder the shared array in place at load time; patching
  // node_modules directly would not survive the next npm install.
  try {
    const mats = require('mineflayer-armor-manager/dist/data/armor.js').materials;
    const i = mats.indexOf('iron');
    const c = mats.indexOf('chainmail');
    if (i > -1 && c > -1 && c > i) { mats[i] = 'chainmail'; mats[c] = 'iron'; }
  } catch (_) { /* upstream layout changed — leave the default ranking alone */ }
  return m.default || m;
});
tryLoadPlugin('pvp', () => require('mineflayer-pvp').plugin);

// ---------- movement profiles (research/movement-engines.md §2.2, P0.2/P0.3) ----------
// baseMovements() is the SAFE DEFAULT applied on every spawn (see bot.on('spawn') below —
// 'on' not 'once', because reconnect rebuilds the bot object with stock unsafe defaults;
// that silent revert was the root cause of the "Movements silently reverted" mystery,
// see FEEDBACK.md). HAUL/WORK/CAVE are opt-in per-task profiles exposed on globalThis so
// skills.js (a self-contained /eval payload that can never require()) can reach them by
// name: globalThis.__movementProfiles.HAUL(bot) etc. Never call before bot.pathfinder
// exists (i.e. only from inside an /eval body or after 'spawn').
function baseMovements(bot) {
  const m = new Movements(bot);
  const B = bot.registry.blocksByName;
  // safety doctrine (FEEDBACK: unsafe defaults — parkour+drops+towers — killed MettMarcel)
  m.allowParkour = false;
  m.allow1by1towers = false;
  m.infiniteLiquidDropdownDistance = false;
  m.scafoldingBlocks = [];
  m.maxDropDown = 3;
  // never eat base infrastructure
  for (const n of ['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'barrel',
    'chest', 'trapped_chest', 'ender_chest', 'lodestone', 'bell',
    'enchanting_table', 'anvil', 'brewing_stand', 'loom', 'smithing_table']) {
    if (B[n]) m.blocksCantBreak.add(B[n].id);
  }
  // the wedge fix (movement-engines §2.4): leaf_litter/torch/etc have shapes:[] and the
  // planner classifies them as "air" (emptyBlocks) — it walks in and never digs them out,
  // re-planning the identical doomed path every 3.5s until our wall-clock wrapper times
  // out. blocksToAvoid flips them unsafe, so the planner digs them BEFORE stepping in.
  for (const n of ['leaf_litter', 'torch', 'wall_torch', 'powder_snow', 'sweet_berry_bush',
    'magma_block', 'campfire', 'soul_campfire', 'cactus', 'pointed_dripstone']) {
    if (B[n]) m.blocksToAvoid.add(B[n].id);
  }
  // mobs are obstacles, not scenery
  for (const e of ['creeper', 'zombie', 'skeleton', 'spider', 'witch', 'husk', 'drowned',
    'enderman', 'phantom', 'pillager']) {
    m.entitiesToAvoid.add(e);
  }
  m.entityCost = 2;
  m.liquidCost = 8;
  // Registered base infrastructure is unbreakable at the PLANNER level, not just at
  // bot.dig — otherwise pathfinder happily digs a shortcut through the plaza floor
  // (FEEDBACK: "repeated GoalNear calls can dig the floor out from under the bot").
  // digguard owns the registry (protected.json); this is a LATE-BINDING lookup so it
  // works whatever order the payload stack is injected in, and so that every profile
  // switch (HAUL/WORK/CAVE build fresh Movements objects) inherits protection from
  // birth rather than waiting up to 10s for digguard's re-wire timer to notice.
  const protectedCost = (block) => {
    try {
      const dg = globalThis.__digguard;
      return dg && typeof dg.exclusionBreak === 'function' ? dg.exclusionBreak(block) : 0;
    } catch (_) { return 0; }
  };
  protectedCost.__digguardBound = true; // digguard checks this marker to avoid double-wiring
  m.exclusionAreasBreak.push(protectedCost);
  m.exclusionAreasPlace.push(protectedCost);
  return m;
}
const MOVEMENT_PROFILES = {
  // long surface hauls: fast, lazy about digging, willing to sprint (the fall death was
  // parkour+maxDropDown, not sprinting — sprint alone saves ~30% ground speed)
  HAUL(bot) {
    const m = baseMovements(bot);
    m.allowSprinting = true; m.digCost = 15; m.maxDropDown = 3;
    bot.pathfinder.thinkTimeout = 25000; bot.pathfinder.tickTimeout = 40;
    bot.pathfinder.searchRadius = -1; bot.pathfinder.enablePathShortcut = true;
    return m;
  },
  // short moves around base: fail fast, never scar the plaza with dig-shortcuts
  WORK(bot) {
    const m = baseMovements(bot);
    m.allowSprinting = false; m.digCost = 25;
    bot.pathfinder.thinkTimeout = 5000; bot.pathfinder.tickTimeout = 25;
    bot.pathfinder.searchRadius = 64; bot.pathfinder.enablePathShortcut = false;
    return m;
  },
  // underground: conservative drops, digging IS the job so it stays cheap
  CAVE(bot) {
    const m = baseMovements(bot);
    m.allowSprinting = false; m.digCost = 1; m.maxDropDown = 2; m.liquidCost = 30;
    bot.pathfinder.thinkTimeout = 10000; bot.pathfinder.tickTimeout = 30;
    bot.pathfinder.searchRadius = 96; bot.pathfinder.enablePathShortcut = false;
    return m;
  },
};
globalThis.__movementProfiles = { base: baseMovements, ...MOVEMENT_PROFILES };

// ---------- payload auto-inject (P0.2, the keystone item) ----------
// skills/digguard/graychat/panicguard/idleguard all used to die on every process restart
// AND every reconnect (a relog inside a driver's polling gap looked like "no reconnect
// happened" from outside — see FEEDBACK.md "injection reports can drift from reality").
// Re-reading from disk on every spawn (not cached at startup) means a live file edit
// takes effect on the bot's next reconnect without a full process restart.
const PAYLOAD_DIR = __dirname;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function injectPayload(bot, filename, { template } = {}) {
  const full = path.join(PAYLOAD_DIR, filename);
  let code;
  try {
    code = fs.readFileSync(full, 'utf8');
  } catch (err) {
    return { ok: false, reason: `read failed: ${err.message}` };
  }
  if (template) code = template(code);
  try {
    const fn = new AsyncFunction('bot', 'mineflayer', 'pathfinder', 'goals', 'Vec3', code);
    const result = await fn(bot, mineflayer, pathfinderPlugin, goals, Vec3);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
async function applyPayloadStack(bot) {
  const report = {};
  // 1. safe default Movements profile — must be set before anything else pathfinds
  try {
    bot.pathfinder.setMovements(baseMovements(bot));
    report.movements = 'safe-default';
  } catch (err) {
    report.movements = `failed: ${err.message}`;
  }
  // 2. best armor always equipped (survival-doctrine §2)
  try {
    if (bot.armorManager && typeof bot.armorManager.equipAll === 'function') {
      bot.armorManager.equipAll();
      report.armor = 'equipAll';
    }
  } catch (err) {
    report.armor = `failed: ${err.message}`;
  }
  // 2b. auto-eat must not claim the off-hand: 3.3.6 defaults offhand:true and would
  // fight the shield over slot 45, and a shield blocks 100% of creeper blast damage.
  // Food is eaten from the main hand instead (equipOldItem restores what was held).
  try {
    if (bot.autoEat && bot.autoEat.options) {
      bot.autoEat.options.offhand = false;
      report.autoEat = 'offhand=false';
    }
  } catch (err) {
    report.autoEat = `failed: ${err.message}`;
  }
  // 3. the skill engine + guard payloads — all idempotent, none bot-specific.
  // ORDER MATTERS: dangerscan grafts its fields onto __skills.status, and survival
  // subscribes to __danger's state changes — so skills -> dangerscan -> survival.
  // survival.js REPLACES panicguard.js (context-aware branches vs flee-home-only);
  // panicguard is no longer injected.
  // farmskills.js / basekeeping.js are skill PACKS: they register skills (farmCycle/tillFarmland/
  // harvestGrass, spawnProof/structureAudit) into __skills via S.define, so they MUST come after
  // skills.js (which creates __skills). A reconnect re-runs skills.js (resetting the registry)
  // then the packs (re-registering). basekeeping.structureAudit reads __digguard.regions, so it
  // sits after digguard too. producer.js is the same shape: it attaches __skills.produce and
  // registers the `produce` skill, and its mining consults __digguard for protected regions —
  // so it too must come after both. The agenda's RESTOCK rung calls it as its produce-fallback,
  // which is the difference between a bot that can only withdraw and a self-sufficient one.
  // digchain.js is the single bot.dig wrap point (#55) and MUST come before the three guards,
  // so they have a registry to register their checks into. Ordering it FIRST rather than last
  // is deliberate and is the safe direction: at spawn it installs a passthrough over a pristine
  // bot.dig and the guards then wrap or register on top, so there is never an unguarded window.
  // The reverse (guards before coordinator) would leave a reconnecting bot briefly holding
  // guards with nothing to register into — and these bots protect a real base on a live server.
  for (const f of ['skills.js', 'dangerscan.js', 'survival.js', 'digchain.js', 'digguard.js', 'toolguard.js', 'graychat.js', 'reachguard.js', 'farmskills.js', 'basekeeping.js', 'producer.js']) {
    const r = await injectPayload(bot, f);
    report[f] = r.ok ? 'installed' : `failed: ${r.reason}`;
  }
  // 4. idleguard needs a role — only auto-inject when the bot was started with --role
  if (ROLE) {
    const r = await injectPayload(bot, 'idleguard.js', { template: (c) => c.replace(/__ROLE__/g, ROLE) });
    report['idleguard.js'] = r.ok ? `installed (role=${ROLE})` : `failed: ${r.reason}`;
  } else {
    report['idleguard.js'] = 'skipped (no --role given at spawn)';
  }
  // 5. agenda — the autonomous ladder. OPT-IN (--agenda) rather than default-on, deliberately:
  // it SUBSUMES idleguard and starts tasks on its own, so switching it on fleet-wide before
  // the phase-1 acceptance test has run would hand five driver-controlled bots a new brain
  // at once. It yields to a driver's task correctly (the engine's task mutex makes S.start
  // return `busy`, which the ladder treats as no-progress and stands down), but "correctly"
  // is a claim the acceptance test should prove, not a claim to ship on. Flip the default
  // once the soak passes.
  if (AGENDA) {
    const r = await injectPayload(bot, 'agenda.js');
    report['agenda.js'] = r.ok ? 'installed' : `failed: ${r.reason}`;
  } else {
    report['agenda.js'] = 'skipped (pass --agenda to enable)';
  }
  log(`<payload-stack> ${JSON.stringify(report)}`);
  // Version attribution for the ledger (#41). The `session` record cannot carry this: it is
  // emitted at telemetry.install() time inside createBot, which runs BEFORE the first spawn —
  // so globalThis.__skills does not exist yet and `engine` was unconditionally null. Emitting
  // here instead, after the stack has actually landed, means every run in the ledger says
  // exactly which payload versions produced it — and it re-emits on each spawn, so a
  // reconnect that picks up edited payloads from disk is recorded rather than assumed.
  try {
    const m = globalThis.__metrics;
    if (m && m.emit) {
      const ver = (g) => (typeof g !== 'undefined' && g ? (g.version || null) : null);
      m.emit('versions', {
        skills: ver(globalThis.__skills), agenda: ver(globalThis.__agenda),
        dangerscan: ver(globalThis.__danger), survival: ver(globalThis.__survival),
        digguard: ver(globalThis.__digguard), toolguard: ver(globalThis.__toolguard),
        idleguard: ver(globalThis.__idleguard), graychat: ver(globalThis.__graychat),
        // producer, because acquire-by-producing runs through it and #41's whole point was
        // that a run must be attributable to its WHOLE stack, not just skills. Omitting it
        // would leave the one payload the self-sufficiency claim depends on unattributable.
        reachguard: ver(globalThis.__reachguard), producer: ver(globalThis.__producer),
        digchain: ver(globalThis.__digchain), role: ROLE,
      });
    }
  } catch (_) {}
  return report;
}

// ---------- optional blueprint file layer (prismarine-schematic) ----------
// skills.js is a self-contained /eval payload and can never require() anything, so
// .schem PARSING lives here: POST /blueprint/load turns a file into a plain ordered
// placement array and stashes it on globalThis.__blueprints. /eval bodies run as an
// AsyncFunction inside THIS process, so __skills.buildSchematic reads the very same
// object by name — no serialization through the shell, no 1MB body limit.
// The registry survives reconnects but NOT a process restart: re-POST after ./spawn.sh.
let Schematic = null;
try {
  Schematic = require('prismarine-schematic').Schematic;
} catch (err) {
  console.log(`[${new Date().toISOString()}] [${NAME || '?'}] optional lib 'prismarine-schematic' not loaded: ${err.message}`);
}
const BLUEPRINT_ROOT = __dirname; // .schem files must live under the bots dir
const BLUEPRINT_MAX_BYTES = 5 * 1024 * 1024;
const BLUEPRINT_MAX_BLOCKS = 4096; // matches skills.js's inline placement cap
const BLUEPRINT_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
if (!globalThis.__blueprints) globalThis.__blueprints = Object.create(null);

// ---------- logging ----------
function log(...parts) {
  console.log(`[${new Date().toISOString()}] [${NAME}]`, ...parts);
}

// ---------- intervention tripwire (M0/M1, felsenuboot/felcrew-mcp#52) ----------
// tokensSpent=0 is a determinism proof: the engine has no LLM code path at all, so the
// only way a "driverless" window sees any spend is a driver reaching in. That makes this
// a TRIPWIRE, not a token meter — count every POST to a decision-making control-plane
// endpoint (the ones below reach the bot; GET /state and friends are read-only and never
// counted, structurally separate from this POST branch). A clean driverless window reads
// interventions:0; any nonzero here IS the finding, whatever produced it.
const INTERVENTION_ROUTES = new Set(['/chat', '/goto2', '/goto', '/eval', '/mine', '/follow', '/hunt', '/stop', '/autoeat', '/blueprint/load', '/blueprint/drop']);
let interventionCount = 0;
const interventionsRecent = []; // bounded ring, most-recent-last
const INTERVENTIONS_MAX = 50;
function noteIntervention(pathname, body) {
  interventionCount++;
  const preview = (() => {
    try { return JSON.stringify(body).slice(0, 160); } catch (_) { return null; }
  })();
  const rec = { t: Date.now(), route: pathname, preview };
  interventionsRecent.push(rec);
  if (interventionsRecent.length > INTERVENTIONS_MAX) interventionsRecent.shift();
  try {
    const m = globalThis.__metrics;
    if (m && m.emit) m.emit('intervention', { route: pathname, preview });
  } catch (_) {}
}

// ---------- bot lifecycle with auto-reconnect ----------
let bot = null;
let connected = false;
let reconnectDelay = 1000; // ms, doubles up to MAX
const MAX_RECONNECT_DELAY = 30000;
let reconnectTimer = null;
let shuttingDown = false;

// ---------- high-level task state (mine / follow / hunt) ----------
let currentTask = null; // { type, detail, startedAt } or null
let greeted = false; // announce once per process, not on every reconnect

function announce(msg) {
  // chat-announce what the bot is doing (English, per house rule); never throws
  try {
    if (connected && bot) bot.chat(msg);
  } catch (_) {}
  log(`<announce> ${msg}`);
}

function stopAllTasks() {
  const stopped = [];
  try {
    if (bot && bot.collectBlock && typeof bot.collectBlock.cancelTask === 'function') {
      bot.collectBlock.cancelTask().catch(() => {});
      stopped.push('collectblock');
    }
  } catch (_) {}
  try {
    if (bot && bot.pvp && typeof bot.pvp.stop === 'function') {
      bot.pvp.stop();
      stopped.push('pvp');
    }
  } catch (_) {}
  try {
    if (bot && bot.pathfinder) {
      bot.pathfinder.setGoal(null);
      stopped.push('pathfinder');
    }
  } catch (_) {}
  currentTask = null;
  return stopped;
}

function scheduleReconnect(reason) {
  if (shuttingDown) return;
  if (reconnectTimer) return; // already scheduled
  log(`reconnect scheduled in ${Math.round(reconnectDelay / 1000)}s (reason: ${reason})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    createBot();
  }, reconnectDelay);
}

function createBot() {
  log(`connecting to ${MC_HOST}:${MC_PORT} as ${NAME}` + (MC_VERSION ? ` (version ${MC_VERSION})` : ''));
  try {
    bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      username: NAME,
      auth: 'offline',
      version: MC_VERSION,
    });
  } catch (err) {
    log(`createBot threw: ${err.message}`);
    scheduleReconnect('createBot exception');
    return;
  }

  bot.loadPlugin(pathfinder);


  // ashfinder MUST load before the first spawn: its plugin builds the path executor

  // inside its own bot.on('spawn') handler, so loading it into an already-spawned bot

  // leaves PathExecutor null and every /goto2 fails. Guarded — a missing or broken

  // ashfinder must leave /goto and the rest of the bot completely untouched.

  if (goto2) { try { goto2.loadAshfinder(bot, log); } catch (err) { log('ashfinder load failed: ' + err.message); } }
  // optional plugins — each guarded so one bad plugin never breaks the bot
  for (const [label, plugin] of Object.entries(optionalPlugins)) {
    try {
      bot.loadPlugin(plugin);
    } catch (err) {
      log(`optional plugin '${label}' failed to attach: ${err.message}`);
    }
  }

  // free telemetry (movement-engines §2.5): attached once per bot INSTANCE (not inside
  // the spawn handler below, which can fire more than once per instance on death-respawn
  // — attaching there would leak a duplicate listener each time). A burst of 'stuck'
  // path_resets within 15s means the planner is re-trying the identical doomed path
  // (astar.js has no attempt counter) — surfaced in GET /state as pathStuckRecent.
  bot._pathStuckTimes = [];
  bot.on('path_reset', (reason) => {
    if (reason !== 'stuck') return;
    const now = Date.now();
    bot._pathStuckTimes.push(now);
    bot._pathStuckTimes = bot._pathStuckTimes.filter((t) => now - t < 15000);
  });

  // 'on', not 'once': reconnect calls createBot() again and builds a FRESH bot object
  // with stock unsafe Movements defaults — that silent revert (not death/respawn) is
  // the root cause FEEDBACK.md called "Movements silently reverted, cause unknown".
  // Re-running the full payload stack on every spawn (including death-respawn, which
  // orphans any in-flight __skills task anyway since it holds a reference to this exact
  // bot object) is what makes injection durable instead of a driver's runtime patch.
  bot.on('spawn', async () => {
    connected = true;
    reconnectDelay = 1000; // reset backoff on successful spawn
    log(`spawned in world. version=${bot.version} pos=${fmtPos(bot.entity && bot.entity.position)}`);
    await applyPayloadStack(bot);
    if (!greeted) {
      greeted = true;
      const powers = Object.keys(optionalPlugins).join(', ') || 'none';
      announce(`${NAME} online. Extra powers loaded: ${powers}. Ready for orders.`);
    }
  });

  // announce when a hunt finishes (mineflayer-pvp event)
  bot.on('stoppedAttacking', () => {
    if (currentTask && currentTask.type === 'hunt') {
      currentTask = null;
      announce('Hunt finished — target is down or gone.');
    }
  });

  bot.on('login', () => log('logged in to server'));

  bot.on('chat', (username, message) => {
    log(`<chat> <${username}> ${message}`);
  });

  bot.on('whisper', (username, message) => {
    log(`<whisper> <${username}> ${message}`);
  });

  bot.on('playerJoined', (player) => {
    log(`<join> ${player.username}`);
  });

  bot.on('playerLeft', (player) => {
    log(`<leave> ${player.username}`);
  });

  let lastHealth = null;
  let lastFood = null;
  bot.on('health', () => {
    if (bot.health !== lastHealth || bot.food !== lastFood) {
      lastHealth = bot.health;
      lastFood = bot.food;
      log(`<health> hp=${bot.health.toFixed(1)} food=${bot.food}`);
    }
  });

  bot.on('death', () => {
    log('<death> bot died — respawning');
  });

  bot.on('kicked', (reason) => {
    log(`<kicked> ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  });

  bot.on('error', (err) => {
    log(`<error> ${err.message}`);
    // 'end' usually follows; if not (e.g. connect ECONNREFUSED before socket opens),
    // the 'end' handler below still fires in practice, but be defensive:
    if (!connected) scheduleReconnect(`error: ${err.message}`);
  });

  // Install the metrics ledger ONCE per bot instance, here in createBot rather than on the
  // spawn event: spawn fires again on every reconnect, and re-installing would stack a fresh
  // set of listeners each time — the same leak class we spent tonight fixing in the guards.
  if (telemetry) {
    try { telemetry.install(bot, { name: NAME, role: ROLE, host: MC_HOST }); }
    catch (err) { log(`telemetry install failed: ${err.message}`); }
  }
  // /goto2's handler, once per bot instance. app=null because runner dispatches on
  // url.pathname rather than express routes, so we call ash.handle() ourselves below.
  if (goto2) {
    try {
      bot._goto2 = goto2.install(bot, null, {
        log, announce, send,
        getTask: () => currentTask,
        setTask: (t) => { currentTask = t; },
      });
    } catch (err) { log(`goto2 install failed: ${err.message}`); bot._goto2 = null; }
  }

  bot.on('end', (reason) => {
    connected = false;
    log(`<end> connection ended (${reason})`);
    scheduleReconnect(`end: ${reason}`);
  });
}

function fmtPos(p) {
  if (!p) return 'unknown';
  return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
}

// ---------- JSON-safe serialization ----------
function jsonSafe(value) {
  try {
    JSON.stringify(value);
    return value === undefined ? null : value;
  } catch (_) {
    return util.inspect(value, { depth: 3, maxArrayLength: 50 });
  }
}

// ---------- control API ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body + '\n');
}

// AsyncFunction is defined earlier (module top, used by applyPayloadStack too).

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /metrics') {
      const m = globalThis.__metrics;
      if (!m) return send(res, 501, { ok: false, error: 'telemetry not installed' });
      return send(res, 200, { ok: true, ...m.snapshot(), guards: m.guardCounts ? m.guardCounts() : null });
    }

    if (route === 'GET /state') {
      const pos = connected && bot && bot.entity ? bot.entity.position : null;
      // payload presence checked LIVE via globalThis, not a cached injection-time report —
      // FEEDBACK.md: "injection reports can drift from reality" (a report can say
      // installed:true while a later relog silently discarded it). __skills also reports
      // its own engine version so a driver can spot a stale re-injection at a glance.
      // Report the VERSION each global actually carries, not just presence — a driver
      // asking "did my bot get digguard v2" should not have to /eval for it
      // (FEEDBACK: "digguard version drift caused real confirmed damage").
      const ver = (g) => (typeof g !== 'undefined' && g ? (g.version || true) : false);
      const payloads = {
        skills: ver(globalThis.__skills),
        dangerscan: ver(globalThis.__danger),
        survival: ver(globalThis.__survival),
        digguard: ver(globalThis.__digguard),
        toolguard: ver(globalThis.__toolguard),
        agenda: ver(globalThis.__agenda),
        digchain: ver(globalThis.__digchain),
        // producer carries __skills.produce and the `produce` skill, which the agenda's
        // RESTOCK rung depends on for acquire-by-producing. It was auto-injected but not
        // REPORTED, so "is produce installed" needed an /eval — exactly the gap this map
        // exists to close.
        producer: ver(globalThis.__producer),
        graychat: ver(globalThis.__graychat),
        idleguard: ver(globalThis.__idleguard),
        reachguard: ver(globalThis.__reachguard),
        panicguard: typeof globalThis.__panic !== 'undefined', // legacy, superseded by survival
      };
      // A reconnect builds a FRESH bot object while globalThis survives, so a payload can
      // be present-but-dead: its bot.dig/bot.chat patches and listeners are bound to the
      // discarded bot. Payloads that register in __payloads mark themselves stale on
      // their own bot's 'end'. Non-empty here = re-inject those (or restart the process).
      let stalePayloads = [];
      try {
        stalePayloads = Object.entries(globalThis.__payloads || {})
          .filter(([, v]) => v && v.stale).map(([k]) => k);
      } catch (_) {}
      let movements = null;
      try {
        const m = connected && bot && bot.pathfinder && bot.pathfinder.movements;
        if (m) movements = { parkour: m.allowParkour, maxDropDown: m.maxDropDown, sprint: m.allowSprinting, towers: m.allow1by1towers, digCost: m.digCost };
      } catch (_) {}
      // leaked-goto detector (movement-engines §2.5): goto.js attaches 4 listeners per
      // call and removes them in cleanup(); an orphaned goto never cleans up, so a
      // path_update listener count > 1 means a stale promise is still alive somewhere.
      let orphanedGoto = null;
      let pathStuckRecent = null;
      try {
        if (connected && bot && typeof bot.listenerCount === 'function') {
          // goto.js attaches its listeners per call and removes them in cleanup(), so a
          // surviving path_update listener means a stale promise is still alive. telemetry
          // owns one of these permanently, so subtract what it declares — without this the
          // detector reports a leak on every instrumented bot forever.
          const ownedByMetrics = (globalThis.__metrics && globalThis.__metrics.pathListeners) || 0;
          orphanedGoto = bot.listenerCount('path_update') > 1 + ownedByMetrics;
          pathStuckRecent = (bot._pathStuckTimes || []).length;
        }
      } catch (_) {}
      return send(res, 200, {
        name: NAME,
        connected,
        position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        health: connected && bot ? bot.health : null,
        food: connected && bot ? bot.food : null,
        dimension: connected && bot ? bot.game.dimension : null,
        task: currentTask,
        agenda: (() => {
          try {
            const a = globalThis.__agenda;
            if (!a) return null;
            return { rung: a.owner ? a.owner.id : null, project: a.project ? a.project.skill : null,
              blocked: a.blocked ? a.blocked.why : null, ticks: a.metrics.ticks, errors: a.metrics.errors,
              // #68 Direction Episodes: a driver's normal /state poll turns "guess from
              // rung/project" into an explicit contract — see research/IDLE_TRIGGER_SPEC.md §1.3.
              direction: a.direction ? {
                state: a.direction.state,
                why:  a.direction.episode ? a.direction.episode.why : null,
                eid:  a.direction.episode ? a.direction.episode.id  : null,
                forMs: a.direction.episode ? (Date.now() - a.direction.episode.openedAt) : null,
                opened: a.direction.opened, closed: a.direction.closed, promoted: a.direction.promoted,
              } : null,
              next: a.nextProject ? a.nextProject.skill : null };
          } catch (_) { return null; }
        })(),
        payloads,
        stalePayloads,
        // tripwire for the tokensSpent=0 determinism proof (#52) -- count since process
        // start, not scoped to any window; a scorer filters `recent` by the window's own
        // start/end timestamps. 0 for the process lifetime is the clean-run signature.
        interventions: { count: interventionCount, recent: interventionsRecent },
        // 'load-after-spawn' means the plugin was attached too late and its executor is
        // null — the GOTCHA-0 failure, worth seeing in /state rather than as a run error.
        ash: (() => {
          try {
            if (!bot || !bot.ashfinder) return false;
            return bot.ashfinder.waypointPlanner ? 'ready' : 'load-after-spawn';
          } catch (_) { return false; }
        })(),
        movements,
        orphanedGoto,
        pathStuckRecent,
        role: ROLE,
      });
    }

    // ---------- blueprint registry (in-process; feeds __skills.buildSchematic) ----------
    if (route === 'GET /blueprint/list') {
      const out = {};
      for (const [name, bp] of Object.entries(globalThis.__blueprints)) {
        out[name] = { blocks: bp.placements.length, bill: bp.bill, size: bp.size, loadedAt: bp.loadedAt, warnings: bp.warnings };
      }
      return send(res, 200, { ok: true, schematicSupport: Boolean(Schematic), blueprints: out });
    }

    if (req.method === 'POST') {
      let body = {};
      const raw = await readBody(req);
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (_) {
          return send(res, 400, { ok: false, error: 'invalid JSON body' });
        }
      }

      if (!connected || !bot) {
        return send(res, 503, { ok: false, error: 'bot not connected' });
      }

      if (INTERVENTION_ROUTES.has(url.pathname)) noteIntervention(url.pathname, body);

      if (url.pathname === '/chat') {
        if (typeof body.message !== 'string' || !body.message.length) {
          return send(res, 400, { ok: false, error: 'need {"message": "..."}' });
        }
        bot.chat(body.message);
        log(`<api> sent chat: ${body.message}`);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/goto2') {
        // Opt-in second movement engine (ashfinder). pathfinder stays the default —
        // pvp and collectblock are hard-welded to bot.pathfinder and would break.
        if (!bot._goto2) return send(res, 501, { ok: false, error: 'goto2 not available (ashfinder missing or failed to load)' });
        return bot._goto2.handle(req, res, body, url);
      }

      if (url.pathname === '/goto') {
        const { x, y, z } = body;
        if (![x, y, z].every((n) => typeof n === 'number' && isFinite(n))) {
          return send(res, 400, { ok: false, error: 'need numeric {"x","y","z"}' });
        }
        // #25: the request used to be the only line logged, so goto latency/outcome could
        // never be reconstructed from runner.js's own log alone. rid correlates the two.
        const rid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const t0 = Date.now();
        log(`<api> goto ${rid} request (${x}, ${y}, ${z})`);
        const goal = new goals.GoalNear(x, y, z, 1);
        let timer;
        try {
          await Promise.race([
            bot.pathfinder.goto(goal),
            new Promise((_, rej) => {
              timer = setTimeout(() => rej(new Error('goto timed out after 60s')), 60000);
            }),
          ]);
          clearTimeout(timer);
          const position = jsonSafe({ ...bot.entity.position });
          log(`<api> goto ${rid} resolved ok in ${Date.now() - t0}ms`);
          return send(res, 200, { ok: true, position });
        } catch (err) {
          clearTimeout(timer);
          try {
            bot.pathfinder.setGoal(null); // stop pathing on timeout/failure
          } catch (_) {}
          log(`<api> goto ${rid} resolved error in ${Date.now() - t0}ms: ${err.message}`);
          return send(res, 500, { ok: false, error: err.message });
        }
      }

      if (url.pathname === '/eval') {
        if (typeof body.code !== 'string') {
          return send(res, 400, { ok: false, error: 'need {"code": "..."}' });
        }
        log(`<api> eval: ${body.code.slice(0, 200).replace(/\n/g, ' ')}`);
        try {
          const fn = new AsyncFunction('bot', 'mineflayer', 'pathfinder', 'goals', 'Vec3', body.code);
          const result = await fn(bot, mineflayer, pathfinderPlugin, goals, Vec3);
          return send(res, 200, { ok: true, result: jsonSafe(result) });
        } catch (err) {
          return send(res, 200, { ok: false, error: err.message });
        }
      }

      // ---------- Baritone-like endpoints (all additive; 501 if plugin missing) ----------

      if (url.pathname === '/mine') {
        if (!bot.collectBlock) {
          return send(res, 501, { ok: false, error: 'mineflayer-collectblock plugin not loaded' });
        }
        const blockName = body.block;
        if (typeof blockName !== 'string' || !blockName.length) {
          return send(res, 400, { ok: false, error: 'need {"block":"oak_log", "count":2}' });
        }
        const count = Math.max(1, Math.min(32, parseInt(body.count || 1, 10) || 1));
        const maxDistance = Math.max(4, Math.min(128, parseInt(body.maxDistance || 64, 10) || 64));
        const blockDef = bot.registry.blocksByName[blockName];
        if (!blockDef) {
          return send(res, 400, { ok: false, error: `unknown block name: ${blockName}` });
        }
        const positions = bot.findBlocks({ matching: blockDef.id, maxDistance, count });
        const blocks = positions.map((p) => bot.blockAt(p)).filter(Boolean);
        if (!blocks.length) {
          return send(res, 404, { ok: false, error: `no ${blockName} found within ${maxDistance} blocks` });
        }
        log(`<api> mine ${blocks.length}x ${blockName}`);
        currentTask = { type: 'mine', detail: `${blocks.length}x ${blockName}`, startedAt: new Date().toISOString() };
        announce(`Mining ${blocks.length}x ${blockName} — off I go.`);
        const timeoutMs = Math.min(300000, parseInt(body.timeoutMs || 120000, 10) || 120000);
        let timer;
        try {
          await Promise.race([
            bot.collectBlock.collect(blocks),
            new Promise((_, rej) => {
              timer = setTimeout(() => rej(new Error(`mine timed out after ${timeoutMs / 1000}s`)), timeoutMs);
            }),
          ]);
          clearTimeout(timer);
          currentTask = null;
          announce(`Done mining ${blocks.length}x ${blockName}.`);
          return send(res, 200, { ok: true, mined: blocks.length, block: blockName });
        } catch (err) {
          clearTimeout(timer);
          stopAllTasks();
          announce(`Mining ${blockName} failed: ${err.message}`);
          return send(res, 500, { ok: false, error: err.message });
        }
      }

      if (url.pathname === '/follow') {
        const playerName = body.player;
        if (typeof playerName !== 'string' || !playerName.length) {
          return send(res, 400, { ok: false, error: 'need {"player":"SomeName"}' });
        }
        const record = bot.players[playerName];
        if (!record) {
          return send(res, 404, { ok: false, error: `player '${playerName}' is not online` });
        }
        if (!record.entity) {
          return send(res, 404, { ok: false, error: `player '${playerName}' is online but out of render distance` });
        }
        const range = Math.max(1, Math.min(10, parseInt(body.range || 3, 10) || 3));
        log(`<api> follow ${playerName} (range ${range})`);
        bot.pathfinder.setGoal(new goals.GoalFollow(record.entity, range), true); // dynamic goal
        currentTask = { type: 'follow', detail: playerName, startedAt: new Date().toISOString() };
        announce(`Now following ${playerName}. Use /stop to release me.`);
        return send(res, 200, { ok: true, following: playerName, range });
      }

      if (url.pathname === '/hunt') {
        if (!bot.pvp) {
          return send(res, 501, { ok: false, error: 'mineflayer-pvp plugin not loaded' });
        }
        const entityName = body.entity;
        if (typeof entityName !== 'string' || !entityName.length) {
          return send(res, 400, { ok: false, error: 'need {"entity":"cow"} (entity type or player name)' });
        }
        const target = bot.nearestEntity(
          (e) => e !== bot.entity && (e.name === entityName || e.username === entityName)
        );
        if (!target) {
          return send(res, 404, { ok: false, error: `no entity '${entityName}' in sight` });
        }
        log(`<api> hunt ${entityName} (entity id ${target.id})`);
        currentTask = { type: 'hunt', detail: entityName, startedAt: new Date().toISOString() };
        announce(`Hunting the nearest ${entityName}. Nothing personal.`);
        bot.pvp.attack(target);
        return send(res, 200, {
          ok: true,
          hunting: entityName,
          target: { id: target.id, position: jsonSafe({ ...target.position }) },
        });
      }

      if (url.pathname === '/stop') {
        log('<api> stop — clearing all tasks');
        const stopped = stopAllTasks();
        announce('Stopping all tasks. Standing by.');
        return send(res, 200, { ok: true, stopped });
      }

      if (url.pathname === '/autoeat') {
        if (!bot.autoEat) {
          return send(res, 501, { ok: false, error: 'mineflayer-auto-eat plugin not loaded' });
        }
        let enabled;
        if (typeof body.enabled === 'boolean') {
          enabled = body.enabled;
        } else {
          enabled = bot.autoEat.disabled === true; // toggle
        }
        if (enabled) bot.autoEat.enable();
        else bot.autoEat.disable();
        log(`<api> autoeat ${enabled ? 'enabled' : 'disabled'}`);
        announce(`Auto-eat is now ${enabled ? 'ON — I will snack when hungry' : 'OFF'}.`);
        return send(res, 200, { ok: true, autoeat: enabled });
      }

      // ---------- blueprint file layer ----------
      // POST /blueprint/load {name, path|base64, at:{x,y,z}}
      // Parses a .schem (sponge or mcedit) into an ordered, world-anchored placement
      // list and registers it as globalThis.__blueprints[name]; then:
      //   ./task.sh <port> start buildSchematic '{"blueprint":"<name>"}'
      if (url.pathname === '/blueprint/load') {
        if (!Schematic) {
          return send(res, 501, { ok: false, error: "prismarine-schematic not installed (npm i --save-exact prismarine-schematic@1.3.0)" });
        }
        const name = body.name;
        if (typeof name !== 'string' || !BLUEPRINT_NAME_RE.test(name)) {
          return send(res, 400, { ok: false, error: 'need {"name":"[A-Za-z0-9_-]{1,32}"}' });
        }
        const at = body.at;
        if (!at || !['x', 'y', 'z'].every((k) => typeof at[k] === 'number' && isFinite(at[k]))) {
          return send(res, 400, { ok: false, error: 'need {"at":{"x":..,"y":..,"z":..}} — the world min-corner to anchor the schematic at' });
        }
        const hasPath = typeof body.path === 'string' && body.path.length;
        const hasB64 = typeof body.base64 === 'string' && body.base64.length;
        if (hasPath === hasB64) {
          return send(res, 400, { ok: false, error: 'pass exactly one of "path" (under ' + BLUEPRINT_ROOT + ') or "base64"' });
        }
        let buf;
        try {
          if (hasPath) {
            const resolved = path.resolve(body.path);
            if (resolved !== BLUEPRINT_ROOT && !resolved.startsWith(BLUEPRINT_ROOT + path.sep)) {
              return send(res, 400, { ok: false, error: `path must resolve under ${BLUEPRINT_ROOT}` });
            }
            const st = fs.statSync(resolved);
            if (!st.isFile()) return send(res, 400, { ok: false, error: 'path is not a file' });
            if (st.size > BLUEPRINT_MAX_BYTES) return send(res, 400, { ok: false, error: `file too large (${st.size} > ${BLUEPRINT_MAX_BYTES})` });
            buf = fs.readFileSync(resolved);
          } else {
            buf = Buffer.from(body.base64, 'base64');
            if (!buf.length) return send(res, 400, { ok: false, error: 'base64 decoded to 0 bytes' });
            if (buf.length > BLUEPRINT_MAX_BYTES) return send(res, 400, { ok: false, error: 'base64 payload too large' });
          }
        } catch (err) {
          return send(res, 400, { ok: false, error: `cannot read schematic: ${err.message}` });
        }

        let schem;
        try {
          schem = await Schematic.read(buf, bot.version);
        } catch (err) {
          return send(res, 400, { ok: false, error: `schematic parse failed: ${err.message}` });
        }

        const base = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
        const placements = [];
        const bill = {};
        const unknown = {};
        let nonDefaultState = 0;
        let tooBig = false;
        try {
          const origin = schem.start(); // offset-based; forEach walks start()..end()
          await schem.forEach((block, pos) => {
            if (tooBig) return;
            if (!block || !block.name || /(^|_)air$/.test(block.name)) return;
            const def = bot.registry.blocksByName[block.name];
            if (!def) { unknown[block.name] = (unknown[block.name] || 0) + 1; return; }
            if (typeof block.stateId === 'number' && block.stateId !== def.defaultState) nonDefaultState++;
            const p = { name: block.name, pos: [base.x + (pos.x - origin.x), base.y + (pos.y - origin.y), base.z + (pos.z - origin.z)] };
            let props = null;
            try { props = block.getProperties ? block.getProperties() : null; } catch (_) {}
            if (props && Object.keys(props).length) p.props = props; // stored for v1.1; the builder ignores them
            placements.push(p);
            bill[block.name] = (bill[block.name] || 0) + 1;
            if (placements.length > BLUEPRINT_MAX_BLOCKS) tooBig = true;
          });
        } catch (err) {
          return send(res, 400, { ok: false, error: `schematic walk failed: ${err.message}` });
        }
        if (tooBig) {
          return send(res, 400, { ok: false, error: 'too_large', hint: `more than ${BLUEPRINT_MAX_BLOCKS} non-air blocks — split the schematic` });
        }
        if (!placements.length) {
          return send(res, 400, { ok: false, error: 'schematic contains no placeable (non-air) blocks' });
        }
        // bottom-up, row-major: every block has support underneath by the time it is placed
        placements.sort((a, b) => (a.pos[1] - b.pos[1]) || (a.pos[2] - b.pos[2]) || (a.pos[0] - b.pos[0]));

        const warnings = [];
        if (nonDefaultState) warnings.push(`${nonDefaultState} block(s) carry non-default states (facing/half/axis) — the builder places default states, they will verify as off-spec`);
        if (Object.keys(unknown).length) warnings.push(`skipped unknown blocks: ${Object.keys(unknown).join(', ').slice(0, 120)}`);

        globalThis.__blueprints[name] = {
          placements, bill, warnings,
          size: { x: schem.size.x, y: schem.size.y, z: schem.size.z },
          at: base,
          loadedAt: Date.now(),
        };
        log(`<api> blueprint '${name}' loaded: ${placements.length} blocks at ${base.x},${base.y},${base.z}`);
        return send(res, 200, {
          ok: true, name, blocks: placements.length, bill, warnings,
          size: globalThis.__blueprints[name].size, at: base,
          hint: `./task.sh <port> start buildSchematic '{"blueprint":"${name}"}'`,
        });
      }

      if (url.pathname === '/blueprint/drop') {
        const name = body.name;
        if (typeof name !== 'string') return send(res, 400, { ok: false, error: 'need {"name":"..."}' });
        const had = Object.prototype.hasOwnProperty.call(globalThis.__blueprints, name);
        delete globalThis.__blueprints[name];
        return send(res, 200, { ok: true, dropped: had, remaining: Object.keys(globalThis.__blueprints) });
      }
    }

    return send(res, 404, { ok: false, error: `no route: ${route}` });
  } catch (err) {
    try {
      send(res, 500, { ok: false, error: err.message });
    } catch (_) {}
    log(`<api-error> ${err.message}`);
  }
});

server.listen(CONTROL_PORT, '127.0.0.1', () => {
  log(`control API listening on 127.0.0.1:${CONTROL_PORT}`);
});
server.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] [${NAME}] control API failed: ${err.message}`);
  process.exit(1);
});

// never die from stray async errors (an /eval must not kill the process)
process.on('uncaughtException', (err) => {
  log(`<uncaught> ${err.stack || err.message}`);
});
process.on('unhandledRejection', (err) => {
  log(`<unhandled-rejection> ${err && (err.stack || err.message || err)}`);
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  log('SIGTERM — shutting down');
  try {
    if (bot) bot.quit('shutdown');
  } catch (_) {}
  process.exit(0);
});

createBot();
