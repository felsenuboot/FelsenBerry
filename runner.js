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
const MC_HOST = args.host || '100.101.197.44';
const MC_PORT = parseInt(args.mcport || '25565', 10);
const MC_VERSION = args.version || undefined; // let mineflayer auto-detect unless pinned

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
  return m.default || m;
});
tryLoadPlugin('pvp', () => require('mineflayer-pvp').plugin);

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

  // optional plugins — each guarded so one bad plugin never breaks the bot
  for (const [label, plugin] of Object.entries(optionalPlugins)) {
    try {
      bot.loadPlugin(plugin);
    } catch (err) {
      log(`optional plugin '${label}' failed to attach: ${err.message}`);
    }
  }

  bot.once('spawn', () => {
    connected = true;
    reconnectDelay = 1000; // reset backoff on successful spawn
    try {
      bot.pathfinder.setMovements(new Movements(bot));
    } catch (err) {
      log(`failed to set movements: ${err.message}`);
    }
    log(`spawned in world. version=${bot.version} pos=${fmtPos(bot.entity && bot.entity.position)}`);
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

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /state') {
      const pos = connected && bot && bot.entity ? bot.entity.position : null;
      return send(res, 200, {
        name: NAME,
        connected,
        position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        health: connected && bot ? bot.health : null,
        food: connected && bot ? bot.food : null,
        dimension: connected && bot ? bot.game.dimension : null,
        task: currentTask,
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

      if (url.pathname === '/chat') {
        if (typeof body.message !== 'string' || !body.message.length) {
          return send(res, 400, { ok: false, error: 'need {"message": "..."}' });
        }
        bot.chat(body.message);
        log(`<api> sent chat: ${body.message}`);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/goto') {
        const { x, y, z } = body;
        if (![x, y, z].every((n) => typeof n === 'number' && isFinite(n))) {
          return send(res, 400, { ok: false, error: 'need numeric {"x","y","z"}' });
        }
        log(`<api> goto (${x}, ${y}, ${z})`);
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
          return send(res, 200, { ok: true, position: jsonSafe({ ...bot.entity.position }) });
        } catch (err) {
          clearTimeout(timer);
          try {
            bot.pathfinder.setGoal(null); // stop pathing on timeout/failure
          } catch (_) {}
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
