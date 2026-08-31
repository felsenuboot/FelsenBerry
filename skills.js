// skills.js — injectable Baritone-style skill library (BODY of a POST /eval call).
// In scope: bot, mineflayer, pathfinder, goals, Vec3  (see runner.js /eval).
// Installs globalThis.__skills. Inject with ./inject.sh <port>; drive with ./task.sh.
//
// DESIGN INVARIANTS
//  - Never stores a long-lived `bot` outside a running task (runner.js replaces the
//    bot object on reconnect). Every entrypoint takes the fresh `bot` from /eval scope.
//  - One task at a time; terminal state persists until the next start().
//  - Cancellation is a flag checked at ctx.step() boundaries — never mid-dig.
//  - Every mineflayer await is raced against a wall-clock timeout (bot.dig can hang
//    forever on a rejected dig; openBlock/goto have no internal timeouts).
//  - goals.GoalBreakBlock is BROKEN in pathfinder 2.4.5 — GoalLookAtBlock(pos, bot.world)
//    is used instead.
//  - House rules baked into the primitives: best tool equipped before every dig
//    (+ canHarvest gate so bot.dig can't hang), drops collected after digs/kills,
//    narration per PHASE (throttled, English), players are never attack targets.
//  - Re-injection is idempotent: replaces the engine cleanly, stopping a running task.

const G = globalThis;

// ---------- idempotent replace: kill the old engine's QUEUE + timers first ----------
// The queue is deliberately NOT carried across re-injection (the old engine stops its
// running task mid-flight; resurrecting a half-finished batch is worse than a warn line
// telling the driver exactly what to re-enqueue). Killing timers + bumping the orphan
// epoch here stops an old fallback timer from starting tasks under the new engine.
if (G.__skills) {
  try {
    const _oq = Array.isArray(G.__skills.queue) ? G.__skills.queue : [];
    if (_oq.length && Array.isArray(G.__skills.log)) {
      G.__skills._seq = (G.__skills._seq || 0) + 1;
      G.__skills.log.push({ seq: G.__skills._seq, lvl: 'warn',
        msg: `queue dropped by re-inject (${_oq.length}): ${_oq.map((i) => i.name).join(', ').slice(0, 150)}` });
    }
    if (typeof G.__skills._killTimers === 'function') G.__skills._killTimers();
    if (typeof G.__skills._queueGen === 'number') G.__skills._queueGen++;
    if (Array.isArray(G.__skills.queue)) G.__skills.queue.length = 0;
    G.__skills.onEmptySpec = null;
    G.__skills.queueState = 'stopped';
  } catch (_) {}
}

// ---------- idempotent replace: stop any task from a previous install ----------
if (G.__skills && G.__skills.currentTask && G.__skills.currentTask.running) {
  try { G.__skills.stop('reinstall'); } catch (_) {}
  try { bot.pathfinder.setGoal(null); } catch (_) {}
  try { bot.stopDigging(); } catch (_) {}
  const t0 = Date.now();
  while (G.__skills.currentTask && G.__skills.currentTask.running && Date.now() - t0 < 8000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (G.__skills.currentTask && G.__skills.currentTask.running) {
    // orphan the old detached loop: its own cancel flag is set, it dies at its next step
    G.__skills.currentTask.running = false;
    G.__skills.currentTask.cancelled = true;
    G.__skills.currentTask.phase = 'orphaned';
  }
}

const ENGINE_VERSION = 9;
const LOG_MAX = 100;
const LOG_SLICE = 20;

// ---------- task-queue tunables (v6) ----------
const QUEUE_MAX = 16;        // pending items
const THRASH_N = 12;         // advances ...
const THRASH_MS = 10000;     // ... within this window -> queue_thrash halt
const HISTORY_MAX = 6;       // queueInfo().history ring
// Failure codes that ALWAYS halt a batch, even under onError:'continue'.
const HALT_ALWAYS = new Set(['low_health', 'inv_full', 'disconnected', 'timeout',
  'unknown_skill', 'queue_thrash', 'bug']);

const S = {
  version: ENGINE_VERSION,
  registry: Object.create(null),
  currentTask: null,
  log: [],
  _seq: 0,
  _cancel: false,
  _chatAt: 0,

  // ---- queue state ----
  queue: [],                 // [{qid, name, args}]
  queueOpts: { onError: 'halt' },
  onEmptySpec: null,         // {name, args, everyMs, maxRuns, runs}
  queueState: 'idle',        // idle | running | draining | halted | paused | stopped
  queuePausedBecause: null,
  queueHalt: null,           // {code, message, task, pending}
  runId: null,
  queueDone: 0,
  queueTotal: 0,
  queueCollected: {},
  _queueGen: 0,              // orphan-timer epoch
  _timers: new Set(),
  _lastBot: null,            // refreshed at EVERY entrypoint; never used without botAlive()
  _endBoundBot: null,
  _advTimes: [],
  _cancelIntent: 'stop',     // 'stop' | 'skip'
  _fallbackRuns: 0,
  _fallbackErrBackoff: 0,
  _lastEndedAt: 0,
  _history: [],
  _qid: 0,
};
if (G.__skills && Array.isArray(G.__skills.log)) {
  S.log = G.__skills.log.slice(-LOG_MAX);
  S._seq = G.__skills._seq || 0;
}

// ---------- constant tables (verified against minecraft-data 1.21.11) ----------
const AIR = new Set(['air', 'cave_air', 'void_air']);
const CONCRETE_POWDER = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => c + '_concrete_powder');
const GRAVITY = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel',
  'anvil', 'chipped_anvil', 'damaged_anvil', ...CONCRETE_POWDER]);
const HAZARD = new Set(['lava', 'fire', 'soul_fire', 'magma_block', 'powder_snow', 'sweet_berry_bush',
  'campfire', 'soul_campfire', 'cactus', 'wither_rose', 'pointed_dripstone']);
const SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium',
  'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots', 'farmland']);
const SPECIES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove'];
const SAPLING = (sp) => (sp === 'mangrove' ? 'mangrove_propagule' : sp + '_sapling');
// mcData .drops is unreliable (most leaves report []) — hard-coded drop table:
const DROPS = {
  stone: ['cobblestone'], deepslate: ['cobbled_deepslate'], grass_block: ['dirt'], podzol: ['dirt'],
  mycelium: ['dirt'], farmland: ['dirt'], iron_ore: ['raw_iron'], deepslate_iron_ore: ['raw_iron'],
  gold_ore: ['raw_gold'], deepslate_gold_ore: ['raw_gold'], copper_ore: ['raw_copper'],
  deepslate_copper_ore: ['raw_copper'], coal_ore: ['coal'], deepslate_coal_ore: ['coal'],
  diamond_ore: ['diamond'], deepslate_diamond_ore: ['diamond'], emerald_ore: ['emerald'],
  deepslate_emerald_ore: ['emerald'], lapis_ore: ['lapis_lazuli'], deepslate_lapis_ore: ['lapis_lazuli'],
  redstone_ore: ['redstone'], deepslate_redstone_ore: ['redstone'], nether_quartz_ore: ['quartz'],
  ancient_debris: ['ancient_debris'],
};
const ORE_ALIASES = {
  iron_ore: ['iron_ore', 'deepslate_iron_ore'], gold_ore: ['gold_ore', 'deepslate_gold_ore'],
  copper_ore: ['copper_ore', 'deepslate_copper_ore'], coal_ore: ['coal_ore', 'deepslate_coal_ore'],
  diamond_ore: ['diamond_ore', 'deepslate_diamond_ore'], emerald_ore: ['emerald_ore', 'deepslate_emerald_ore'],
  lapis_ore: ['lapis_ore', 'deepslate_lapis_ore'], redstone_ore: ['redstone_ore', 'deepslate_redstone_ore'],
};
const UBIQUITOUS = new Set(['stone', 'deepslate', 'dirt', 'netherrack', 'cobblestone', 'grass_block', 'sand', 'gravel']);
const CONTAINERS = new Set(['chest', 'trapped_chest', 'barrel']);
// blueprint skills refuse to bulldoze anyone's infrastructure to clear a build cell.
const PROTECTED = new Set(['chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
  'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'bed', 'loom', 'anvil', 'brewing_stand']);
// no-collision clutter: never an obstruction, always dug out of a build cell.
const NUISANCE = new Set(['leaf_litter', 'short_grass', 'tall_grass', 'fern', 'large_fern',
  'dead_bush', 'snow', 'moss_carpet', 'pale_moss_carpet', 'pink_petals', 'wildflowers',
  'vine', 'glow_lichen', 'sculk_vein', 'seagrass', 'tall_seagrass', 'torchflower', 'dandelion',
  'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley']);
// v7 blueprint building: block name -> the ITEM you place to get it. Only entries that
// actually differ belong here; itemForBlock() falls through to the block name otherwise.
const PLACE_ITEM = {
  wall_torch: 'torch', soul_wall_torch: 'soul_torch', redstone_wall_torch: 'redstone_torch',
  redstone_wire: 'redstone', cocoa: 'cocoa_beans', tripwire: 'string', carrots: 'carrot',
  potatoes: 'potato', beetroots: 'beetroot_seeds', melon_stem: 'melon_seeds',
  pumpkin_stem: 'pumpkin_seeds', bamboo_sapling: 'bamboo', water: 'water_bucket',
  lava: 'lava_bucket', powder_snow: 'powder_snow_bucket',
};
function itemForBlock(name) {
  if (PLACE_ITEM[name]) return PLACE_ITEM[name];
  return String(name).replace(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|pale_oak|mangrove|bamboo|crimson|warped)_wall_sign$/, '$1_sign');
}
// Right-clicking one of these opens a UI instead of placing — sneak first (v7).
const INTERACTIVE_EXACT = new Set(['chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
  'furnace', 'blast_furnace', 'smoker', 'crafting_table', 'crafter', 'anvil', 'chipped_anvil',
  'damaged_anvil', 'lever', 'note_block', 'jukebox', 'lectern', 'loom', 'smithing_table',
  'cartography_table', 'stonecutter', 'grindstone', 'enchanting_table', 'brewing_stand',
  'beacon', 'hopper', 'dispenser', 'dropper', 'composter', 'cake', 'respawn_anchor',
  'bell', 'daylight_detector', 'comparator', 'repeater', 'flower_pot', 'decorated_pot']);
function isInteractive(name) {
  if (!name) return false;
  if (INTERACTIVE_EXACT.has(name)) return true;
  return /(_button|_door|_trapdoor|_fence_gate|_bed|_sign|_hanging_sign|_shulker_box|_candle_cake)$/.test(name);
}

// ---------- small helpers ----------
function pushLog(lvl, msg) {
  S._seq++;
  S.log.push({ seq: S._seq, lvl, msg: String(msg).slice(0, 200) });
  if (S.log.length > LOG_MAX) S.log.splice(0, S.log.length - LOG_MAX);
}

class Cancelled extends Error {
  constructor() { super('cancelled'); this.cancelled = true; }
}

function fatal(code, message, hint) {
  const e = new Error(message);
  e.code = code;
  if (hint) e.hint = hint;
  e.fatal = true;
  return e;
}

function withTimeout(promise, ms, code) {
  let timer;
  promise.catch(() => {}); // a losing promise's late rejection must not hit unhandledRejection
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error(code + ` after ${ms}ms`), { code })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Throttled chat: >=1.3s apart, <=140 chars. The ONLY chat path.
// v6: `quiet` tasks (repeat onEmpty fallback runs) log instead of chatting, and a
// 12s backlog cap stops back-to-back queued tasks from queueing chat minutes ahead.
// force=true = engine-level line (enqueue/drain/halt): bypasses quiet, not the cap.
function say(b, msg, force) {
  if (!force && S.currentTask && S.currentTask.quiet) { pushLog('chat', String(msg).slice(0, 120)); return; }
  msg = String(msg).slice(0, 140);
  const now = Date.now();
  const at = Math.max(now, S._chatAt + 1300);
  if (at - now > 12000) { pushLog('warn', 'chat dropped (backlog): ' + msg.slice(0, 80)); return; } // do NOT advance _chatAt
  S._chatAt = at;
  setTimeout(() => { try { b.chat(msg); } catch (_) {} }, at - now);
}

function invSnapshot(b) {
  const m = {};
  try { for (const it of b.inventory.items()) m[it.name] = (m[it.name] || 0) + it.count; } catch (_) {}
  return m;
}
function invGains(before, after) {
  const d = {};
  for (const k of Object.keys(after)) {
    const delta = after[k] - (before[k] || 0);
    if (delta > 0) d[k] = delta;
  }
  return d;
}
function countItems(b, names) {
  const s = new Set(names);
  let n = 0;
  try { for (const it of b.inventory.items()) if (s.has(it.name)) n += it.count; } catch (_) {}
  return n;
}
function blockIds(b, names) {
  return names.map((n) => b.registry.blocksByName[n]).filter(Boolean).map((d) => d.id);
}
function expectedDrops(b, blockName) {
  return DROPS[blockName] || (b.registry.itemsByName[blockName] ? [blockName] : []);
}
function key(p) { return p.x + ',' + p.y + ',' + p.z; }

// ---------- queue helpers (v6) ----------
// runner.js hands out a NEW bot object on reconnect: never path with a dead one.
function botAlive(b) {
  try {
    if (!b || !b.entity || !b.entity.position || typeof b.health !== 'number') return false;
    if (b._client && (b._client.ended === true || (b._client.socket && b._client.socket.destroyed))) return false;
    return true;
  } catch (_) { return false; }
}

// Every queue timer is epoch- AND identity-guarded (same defense as idleguard's
// orphan killer): a superseded engine or a cleared queue can never fire work.
function later(ms, fn) {
  const gen = S._queueGen;
  const t = setTimeout(() => {
    S._timers.delete(t);
    if (G.__skills !== S || gen !== S._queueGen) return;
    try { fn(); } catch (e) { pushLog('error', 'queue timer: ' + e.message); }
  }, ms);
  S._timers.add(t);
  return t;
}
function killTimers() {
  for (const t of S._timers) { try { clearTimeout(t); } catch (_) {} }
  S._timers.clear();
}
S._killTimers = killTimers;

// Handover protection: the guard reads a task-to-task gap as driver silence.
function pauseIdleGuard(ms) {
  try { if (G.__idleguard && typeof G.__idleguard.pause === 'function') G.__idleguard.pause(ms || 20000); } catch (_) {}
}

// One 'end' listener per bot OBJECT, max (start() binds its own per task).
function _bindEnd(bot) {
  if (!bot || S._endBoundBot === bot) return;
  S._endBoundBot = bot;
  try {
    bot.once('end', () => {
      if (G.__skills !== S) return;
      if (S._endBoundBot === bot) S._endBoundBot = null;
      killTimers();
      if (S.queue.length || S.onEmptySpec) {
        S.queueState = 'paused';
        S.queuePausedBecause = 'disconnected';
        pushLog('warn', 'queue paused: disconnected (resumes on the next status/enqueue)');
      }
    });
  } catch (_) {}
}

function normalizeItem(bot, raw, idx) {
  if (typeof raw === 'string') raw = { name: raw, args: {} };
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') {
    return { error: { code: 'bad_args', index: idx, message: 'each item needs {name, args}' } };
  }
  const skill = S.registry[raw.name];
  if (!skill) return { error: { code: 'unknown_skill', index: idx, name: raw.name, known: Object.keys(S.registry) } };
  let args;
  // deep copy: a caller mutating its array later can't reach a pending item
  try { args = raw.args ? JSON.parse(JSON.stringify(raw.args)) : {}; }
  catch (_) { return { error: { code: 'bad_args', index: idx, name: raw.name, message: 'args must be JSON-serializable' } }; }
  let bad = null;
  try { bad = skill.validate ? skill.validate(args, bot) : null; }
  catch (e) { bad = 'validate threw: ' + e.message; }
  if (bad) return { error: { code: 'bad_args', index: idx, name: raw.name, message: bad, params: skill.params } };
  return { item: { qid: 'i' + (++S._qid).toString(36), name: raw.name, args } };
}

// instant-failure thrash guard (a queue of tasks that all fail in <100ms)
function _rateOk() {
  const now = Date.now();
  S._advTimes = S._advTimes.filter((t) => now - t < THRASH_MS);
  S._advTimes.push(now);
  return S._advTimes.length <= THRASH_N;
}

// ---------- per-task context handed to skill fns ----------
function makeCtx(bot, task) {
  const ctx = {
    bot,
    args: task.args,
    goals,
    Vec3,

    // Cancellation + low-health checkpoint. Call between steps — NEVER mid-dig.
    step() {
      if (S._cancel) throw new Cancelled();
      if (typeof bot.health === 'number' && bot.health <= (task.args.minHealth ?? 6)) {
        throw fatal('low_health', `health ${bot.health.toFixed(1)} <= guard`, 'let the bot heal/eat or retreat, then restart the task');
      }
    },

    async sleep(ms) { ctx.step(); await new Promise((r) => setTimeout(r, ms)); ctx.step(); },

    say(msg) { say(bot, msg); },

    // Exactly one chat per phase transition (house rule: per phase, not per block).
    setPhase(phase, sayText) {
      ctx.step();
      task.phase = phase;
      task.phases.push(phase);
      pushLog('phase', phase);
      if (sayText) say(bot, sayText);
    },

    progress(done, total, unit) {
      task.progress.done = done;
      if (total != null) task.progress.total = total;
      if (unit != null) task.progress.unit = unit;
    },

    log(msg) { pushLog('info', msg); },

    async retry(label, fn, tries = 3) {
      let lastErr;
      for (let i = 1; i <= tries; i++) {
        ctx.step();
        try { return await fn(); }
        catch (e) {
          if (e instanceof Cancelled || e.fatal) throw e;
          lastErr = e;
          pushLog('retry', `${label} ${i}/${tries}: ${e.message}`);
          if (i < tries) await ctx.sleep(500 * Math.pow(3, i - 1));
        }
      }
      const e = new Error(`${label} failed after ${tries} attempts: ${lastErr.message}`);
      e.code = lastErr.code || 'retries_exhausted';
      e.hint = lastErr.hint;
      throw e;
    },

    // goto with a wall-clock timeout (pathfinder.goto has none) AND a stall
    // watchdog: pathfinder can hold a "success" path while physics is wedged —
    // SEEN LIVE on 1.21.11: leaf_litter at the feet leaves onGround=false forever,
    // jump never fires, the bot stands still until the timeout. After 6s without
    // movement we dig the nuisance block(s) at the feet and hop; 3 failed
    // unsticks -> error code 'stuck'. Goal is always cleared on exit.
    async goto(goal, timeoutMs = 30000) {
      ctx.step();
      const t0 = Date.now();
      const gotoP = bot.pathfinder.goto(goal);
      const settled = gotoP.then(() => ({ done: true }), (err) => ({ err }));
      let lastPos = bot.entity.position.clone();
      let lastMove = Date.now();
      let unsticks = 0;
      try {
        while (true) {
          const r = await Promise.race([settled, new Promise((res) => setTimeout(() => res(null), 1000))]);
          if (r) {
            if (r.err) {
              const e = new Error(String(r.err.message || r.err));
              e.code = r.err.name === 'NoPath' ? 'no_path' : 'path_' + (r.err.name || 'error');
              throw e;
            }
            // arrival assertion (movement-engines §2.3a): astar.js can resolve an
            // empty path as SUCCESS from a boxed-in start (bestNode = start node,
            // reconstructPath = []). Verify we're actually at the goal before
            // trusting the resolve — a silent no-op becomes an honest no_path.
            const p = bot.entity.position.floored();
            let arrived = true;
            try {
              if (typeof goal.isEnd === 'function') arrived = Boolean(goal.isEnd(p) || goal.isEnd(p.offset(0, 1, 0)));
            } catch (_) { arrived = true; } // goal type we can't introspect — don't break it
            if (!arrived) {
              const e = new Error('goto resolved without reaching the goal (empty-path noPath)');
              e.code = 'no_path';
              throw e;
            }
            return;
          }
          try { ctx.step(); }
          catch (e) { try { bot.pathfinder.setGoal(null); } catch (_) {} throw e; }
          if (Date.now() - t0 > timeoutMs) {
            try { bot.pathfinder.setGoal(null); } catch (_) {}
            const e = new Error(`path_timeout after ${timeoutMs}ms`);
            e.code = 'path_timeout';
            throw e;
          }
          const p = bot.entity.position;
          if (p.distanceTo(lastPos) > 0.4) { lastPos = p.clone(); lastMove = Date.now(); }
          else if (Date.now() - lastMove > 6000) {
            if (unsticks >= 3) {
              try { bot.pathfinder.setGoal(null); } catch (_) {}
              const e = new Error('stuck: no movement despite an active path');
              e.code = 'stuck';
              throw e;
            }
            unsticks++;
            await ctx._unstick();
            lastMove = Date.now();
          }
        }
      } finally {
        try { bot.pathfinder.setGoal(null); } catch (_) {}
      }
    },

    // Physics-wedge recovery: dig no-collision nuisance blocks overlapping the
    // bot's AABB (leaf_litter is the live-confirmed offender) and hop backwards.
    async _unstick() {
      pushLog('info', 'movement stalled — unsticking (nuisance dig + hop)');
      const base = bot.entity.position;
      const cols = new Set();
      for (const ox of [-0.31, 0.31]) for (const oz of [-0.31, 0.31]) {
        cols.add(key(base.offset(ox, 0, oz).floored()));
      }
      for (const k of cols) {
        const [x, y, z] = k.split(',').map(Number);
        for (const dy of [0, 1]) {
          const b = bot.blockAt(new Vec3(x, y + dy, z));
          if (b && NUISANCE.has(b.name) && b.diggable) {
            try { await ctx.equipBestTool(b); } catch (_) {}
            try {
              const dp = bot.dig(b, true);
              dp.catch(() => {});
              await withTimeout(dp, 3000, 'dig_timeout');
            } catch (_) { try { bot.stopDigging(); } catch (_) {} }
          }
        }
      }
      try {
        bot.setControlState('jump', true);
        bot.setControlState('back', true);
        await new Promise((r) => setTimeout(r, 350));
      } catch (_) {}
      try { bot.setControlState('jump', false); bot.setControlState('back', false); } catch (_) {}
    },
    async gotoNear(p, range = 1, timeoutMs = 30000) {
      return ctx.goto(new goals.GoalNear(p.x, p.y, p.z, range), timeoutMs);
    },
    // NEVER goals.GoalBreakBlock — broken in pathfinder 2.4.5 (bad ctor args + isEnd).
    async gotoSee(p, timeoutMs = 20000) {
      return ctx.goto(new goals.GoalLookAtBlock(new Vec3(p.x, p.y, p.z), bot.world, { reach: 4.0 }), timeoutMs);
    },

    // House rule: best tool before every dig. Returns harvestability (Boolean —
    // canHarvest returns true | undefined | null).
    async equipBestTool(block) {
      let tool = null;
      try { tool = bot.pathfinder.bestHarvestTool(block); } catch (_) {}
      if (tool && (!bot.heldItem || bot.heldItem.type !== tool.type)) {
        try { await withTimeout(bot.equip(tool, 'hand'), 5000, 'equip_timeout'); } catch (_) {}
      }
      const held = bot.heldItem ? bot.heldItem.type : null;
      return { tool: bot.heldItem ? bot.heldItem.name : null, canHarvest: Boolean(block.canHarvest(held)) };
    },

    // THE dig primitive. bot.dig() can hang forever on a dig the server rejects
    // (wrong tool / protected / out of reach), so: harvest gate + wall-clock race.
    // Returns {ok:true[,already]} or {ok:false, reason} — throws only fatal inv_full.
    async digBlock(pos, digTimeoutMs = 60000) {
      ctx.step();
      let b = bot.blockAt(pos);
      if (!b || AIR.has(b.name)) return { ok: true, already: true };
      if (!b.diggable) return { ok: false, reason: 'undiggable', block: b.name };
      if (bot.inventory.emptySlotCount() === 0) {
        throw fatal('inv_full', 'inventory is full', 'deposit items (depositToChest), then restart');
      }
      const eye = () => bot.entity.position.offset(0, 1.6, 0);
      if (b.position.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.0) {
        try { await ctx.gotoSee(b.position, 20000); }
        catch (e1) {
          try { await ctx.gotoNear(b.position, 2, 15000); }
          catch (e2) { return { ok: false, reason: 'unreachable', error: e2.message }; }
        }
        b = bot.blockAt(pos);
        if (!b || AIR.has(b.name)) return { ok: true, already: true };
        if (b.position.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.6) return { ok: false, reason: 'unreachable' };
      }
      const eq = await ctx.equipBestTool(b);
      if (!eq.canHarvest) return { ok: false, reason: 'no_tool', block: b.name };
      const est = bot.digTime(b);
      if (!isFinite(est)) return { ok: false, reason: 'infinite_digtime', block: b.name };
      const budget = Math.min(digTimeoutMs, Math.max(2500, est * 3 + 1500));
      if (bot.targetDigBlock) { try { bot.stopDigging(); } catch (_) {} }
      let timer;
      try {
        const digP = bot.dig(b, true);
        digP.catch(() => {});
        await Promise.race([
          digP,
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('dig timeout')), budget); }),
        ]);
      } catch (e) {
        try { bot.stopDigging(); } catch (_) {}
        const now = bot.blockAt(pos);
        if (!now || AIR.has(now.name)) return { ok: true, viaTimeout: true };
        return { ok: false, reason: 'dig_failed', error: e.message, block: b.name };
      } finally { clearTimeout(timer); }
      return { ok: true, block: b.name, tool: eq.tool };
    },

    // House rule: never leave drops behind. Best-effort sweep of item entities;
    // an unreachable drop never fails the task. Vanilla pickup: stand within ~1 block.
    async collectDrops(radius = 12, timeoutMs = 20000, only = null) {
      const t0 = Date.now();
      let picked = 0, unreachable = 0;
      const attempts = new Map();
      await new Promise((r) => setTimeout(r, 600)); // let drops pop out and settle
      while (Date.now() - t0 < timeoutMs) {
        ctx.step();
        if (bot.inventory.emptySlotCount() === 0) break;
        const me = bot.entity.position;
        const cands = Object.values(bot.entities).filter((e) => {
          if (!e || e.name !== 'item' || !e.position) return false;
          if (e.isValid === false) return false;
          if (e.position.distanceTo(me) > radius) return false;
          if ((attempts.get(e.id) || 0) >= 2) return false;
          if (only) {
            let it = null;
            try { it = e.getDroppedItem(); } catch (_) { return true; } // metadata not in yet: assume collectable
            if (it && !only.includes(it.name)) return false;
          }
          return true;
        }).sort((a, b2) => a.position.distanceTo(me) - b2.position.distanceTo(me));
        if (!cands.length) break;
        const e = cands[0];
        const p = e.position.floored();
        try { await ctx.gotoNear(p, 1, 12000); }
        catch (_) {
          attempts.set(e.id, (attempts.get(e.id) || 0) + 1);
          if (attempts.get(e.id) >= 2) unreachable++;
          continue;
        }
        await new Promise((r) => setTimeout(r, 500));
        if (!bot.entities[e.id]) picked++;
        else attempts.set(e.id, (attempts.get(e.id) || 0) + 1);
      }
      return { picked, unreachable };
    },

    // House rule (2b): torch discipline. Call once per unit of progress (a dug
    // block, a descend step, ...) with a per-task `state` object the caller owns
    // (`{}` at task start — carries sinceTorch/warnedNoTorches across calls).
    // Places a torch every `every` calls OR immediately if the current block's
    // light level is low (mob-spawn risk), whichever comes first. Tries the floor
    // first, then the four side walls, so it works in both shafts and open rooms.
    // Never throws; returns {placed:false, reason:'no_torches'|'no_reference'} on
    // a miss. 'no_torches' is logged ONCE per task (not spammed every check) so
    // drivers see a clear restock signal in status/log without chat noise.
    async autoTorch(state, every = 7) {
      state.sinceTorch = (state.sinceTorch || 0) + 1;
      const here = bot.entity.position.floored();
      let lowLight = false;
      try {
        const hb = bot.blockAt(here);
        lowLight = hb && typeof hb.light === 'number' && hb.light < 8;
      } catch (_) {}
      if (state.sinceTorch < every && !lowLight) return { placed: false };
      const torch = bot.inventory.items().find((i) => ['torch', 'copper_torch', 'soul_torch'].includes(i.name));
      if (!torch) {
        if (!state.warnedNoTorches) {
          state.warnedNoTorches = true;
          pushLog('warn', 'no_torches: out of torches, restock from depot chest B (64 banked)');
        }
        return { placed: false, reason: 'no_torches' };
      }
      const spot = bot.blockAt(here);
      if (!spot || !AIR.has(spot.name)) return { placed: false, reason: 'no_reference' };
      const candidates = [
        [here.offset(0, -1, 0), new Vec3(0, 1, 0)],
        [here.offset(1, 0, 0), new Vec3(-1, 0, 0)],
        [here.offset(-1, 0, 0), new Vec3(1, 0, 0)],
        [here.offset(0, 0, 1), new Vec3(0, 0, -1)],
        [here.offset(0, 0, -1), new Vec3(0, 0, 1)],
      ];
      for (const [refPos, face] of candidates) {
        const ref = bot.blockAt(refPos);
        if (!ref || ref.boundingBox !== 'block') continue;
        try {
          await withTimeout(bot.equip(torch, 'hand'), 5000, 'equip_timeout');
          await bot.placeBlock(ref, face);
          state.sinceTorch = 0;
          return { placed: true };
        } catch (_) { /* try next face */ }
      }
      return { placed: false, reason: 'no_reference' };
    },

    // THE place primitive (v7 hardened; the v5/v6 contract is unchanged — same
    // {ok,already,reason} shape, same default "clear a wrong block first" behavior).
    // Idempotent (already-correct block = no-op), never bulldozes PROTECTED
    // infrastructure, and defends every placement quirk found live:
    //   - unloaded chunk           -> travel first, then 'unloaded'
    //   - plant clutter in the cell-> always dug (leaf_litter wedge)
    //   - the bot's OWN hitbox     -> step aside and retry (seen in chopTrees replant)
    //   - out of reach             -> gotoNear -> gotoSee ladder (GoalNear recalc quirk)
    //   - interactive reference    -> sneak-place (right-click would open its UI)
    //   - bot.placeBlock hanging   -> 5s race + blockAt post-verify (bot.dig quirk class)
    // opts: {clearMismatch (default TRUE — v5 behavior), protect: Set of key(pos)}
    // Never throws except Cancelled / fatal from ctx.step().
    async placeBlockAt(pos, blockName, opts = {}) {
      ctx.step();
      const clearMismatch = opts.clearMismatch !== false;
      const itemName = itemForBlock(blockName);
      let target = bot.blockAt(pos);
      if (!target) { // chunk not loaded — blockAt lies at distance (catalog quirk)
        try { await ctx.gotoNear(pos, 3, 20000); } catch (_) {}
        target = bot.blockAt(pos);
        if (!target) return { ok: false, reason: 'unloaded' };
      }
      if (target.name === blockName) return { ok: true, already: true };
      if (!AIR.has(target.name)) {
        if (PROTECTED.has(target.name)) return { ok: false, reason: 'protected_block', block: target.name };
        if (!NUISANCE.has(target.name) && !clearMismatch) return { ok: false, reason: 'occupied', block: target.name };
        if (!target.diggable) return { ok: false, reason: 'undiggable_obstruction', block: target.name };
        const dr = await ctx.digBlock(pos);
        if (!dr.ok) return { ok: false, reason: 'clear_failed', detail: dr.reason, block: target.name };
      }
      // own-hitbox check: a block cannot be placed into the cell the bot occupies
      const overlaps = () => { // bot AABB (0.6 wide, 1.8 tall) vs the 1x1x1 target cell
        const p = bot.entity.position;
        return (p.x - 0.3 < pos.x + 1) && (p.x + 0.3 > pos.x)
          && (p.z - 0.3 < pos.z + 1) && (p.z + 0.3 > pos.z)
          && (p.y < pos.y + 1) && (p.y + 1.8 > pos.y);
      };
      if (overlaps()) {
        for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          try { await ctx.gotoNear(pos.offset(dx, 0, dz), 1, 8000); } catch (_) { continue; }
          if (!overlaps()) break;
        }
        if (overlaps()) return { ok: false, reason: 'self_occupied' };
      }
      // material: SUM across every stack (never .find-count — unstackable counting bug)
      const stacks = bot.inventory.items().filter((i) => i.name === itemName);
      if (!stacks.length) return { ok: false, reason: 'no_material', material: itemName };
      const eye = () => bot.entity.position.offset(0, 1.6, 0);
      if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.0) {
        try { await ctx.gotoNear(pos, 3, 20000); }
        catch (_) {
          try { await ctx.gotoSee(pos, 15000); }
          catch (_) { return { ok: false, reason: 'unreachable' }; }
        }
        if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.6) return { ok: false, reason: 'unreachable' };
        if (overlaps()) return { ok: false, reason: 'self_occupied' };
        const again = bot.blockAt(pos);
        if (again && again.name === blockName) return { ok: true, already: true };
      }
      const FACES = [ // below, the 4 sides, then above — floor-first covers most builds
        [[0, -1, 0], [0, 1, 0]],
        [[1, 0, 0], [-1, 0, 0]], [[-1, 0, 0], [1, 0, 0]],
        [[0, 0, 1], [0, 0, -1]], [[0, 0, -1], [0, 0, 1]],
        [[0, 1, 0], [0, -1, 0]],
      ];
      const refs = [];
      for (const [off, face] of FACES) {
        const ref = bot.blockAt(pos.offset(off[0], off[1], off[2]));
        if (!ref || ref.boundingBox !== 'block') continue;
        refs.push({ ref, face: new Vec3(face[0], face[1], face[2]), ui: isInteractive(ref.name) });
      }
      if (!refs.length) return { ok: false, reason: 'no_reference' };
      refs.sort((a, b2) => (a.ui ? 1 : 0) - (b2.ui ? 1 : 0)); // non-interactive faces first
      let lastErr = null;
      for (const cand of refs) {
        ctx.step();
        const stack = bot.inventory.items().find((i) => i.name === itemName);
        if (!stack) return { ok: false, reason: 'no_material', material: itemName };
        try { await withTimeout(bot.equip(stack, 'hand'), 5000, 'equip_timeout'); }
        catch (e) { lastErr = e.message; continue; }
        let sneaked = false;
        try {
          if (cand.ui) { bot.setControlState('sneak', true); sneaked = true; }
          const pp = bot.placeBlock(cand.ref, cand.face);
          pp.catch(() => {}); // placeBlock awaits a blockUpdate and can hang — always raced
          await withTimeout(pp, 5000, 'place_timeout');
          const now = bot.blockAt(pos);
          if (now && now.name === blockName) return { ok: true };
          if (now && !AIR.has(now.name)) return { ok: true, offSpec: now.name }; // placed, wrong variant
          lastErr = 'server rejected the placement';
        } catch (e) {
          lastErr = e.message;
          const now = bot.blockAt(pos);
          if (now && now.name === blockName) return { ok: true, viaTimeout: true };
        } finally {
          if (sneaked) { try { bot.setControlState('sneak', false); } catch (_) {} }
        }
      }
      return { ok: false, reason: 'place_failed', error: lastErr };
    },

    // Movements guard for placement skills (peter-driver, confirmed root cause,
    // 2026-09-01): bot.pathfinder.movements.canDig defaults true, and short per-block
    // GoalNear hops inside a confined structure can make the planner prefer DIGGING
    // through a nearby wall/floor/corner block over walking the slightly longer way
    // around — even though the target was reachable without digging. Silently ate a
    // finished floor (23/40 tiles) and later a patched wall, in both cases from ordinary
    // placement-loop travel, not a bug in placeBlockAt itself. Confirmed fix: canDig=false
    // for the whole build. Call at the top of any skill that loops placeBlockAt over a
    // structure; ALWAYS call the returned restore() in a finally, even on throw/cancel.
    enterBuildSafe() {
      let prev = null;
      try {
        prev = bot.pathfinder.movements || null;
        const mv = (G.__movementProfiles && typeof G.__movementProfiles.WORK === 'function')
          ? G.__movementProfiles.WORK(bot) // runner.js v-P0.3: safety+wedge+infra knobs included
          : new pathfinder.Movements(bot); // older runner.js process — bare fallback
        mv.canDig = false;
        if (Array.isArray(mv.scafoldingBlocks)) mv.scafoldingBlocks = [];
        bot.pathfinder.setMovements(mv);
      } catch (e) { pushLog('warn', 'enterBuildSafe: movements not applied: ' + e.message); }
      return () => { try { if (prev) bot.pathfinder.setMovements(prev); } catch (_) {} };
    },

    // Movements guard for pure travel (FEEDBACK: "travel tasks need a dig-free movement
    // profile" — long come/goto hauls were silently tunnelling through hills, eating
    // held-tool durability and leaving ugly tunnels = an aesthetics violation). Switches
    // to runner.js's HAUL profile (digCost 15 — walking around beats digging through;
    // sprinting on; wide search radius) for the call's duration, restoring afterward. A
    // no-op fallback (does nothing, keeps current movements) on an older runner.js
    // process without globalThis.__movementProfiles — travel still works, just without
    // the dig-averse tuning. ALWAYS call the returned restore() in a finally.
    enterHaul() {
      let prev = null;
      try {
        if (G.__movementProfiles && typeof G.__movementProfiles.HAUL === 'function') {
          prev = bot.pathfinder.movements || null;
          bot.pathfinder.setMovements(G.__movementProfiles.HAUL(bot));
        }
      } catch (e) { pushLog('warn', 'enterHaul: movements not applied: ' + e.message); }
      return () => { try { if (prev) bot.pathfinder.setMovements(prev); } catch (_) {} };
    },

    // Withdraw a shopping list from a chest/barrel. needs = {itemName: count}.
    // Returns {got:{}, short:{}} — never throws except Cancelled/fatal(not_found).
    // Every quirk guard from depositToChest applies: GoalNear->GoalLookAtBlock travel
    // ladder, an 8s race on openContainer (which has NO internal timeout), and an
    // EXPLICIT count on every withdraw (count:null moves 1 item, not the stack).
    async withdrawFromChest(chestPos, needs) {
      const wanted = Object.entries(needs || {}).filter(([, n]) => n > 0);
      if (!wanted.length) return { got: {}, short: {} };
      const cp = new Vec3(Math.floor(chestPos.x), Math.floor(chestPos.y), Math.floor(chestPos.z));
      try { await ctx.gotoNear(cp, 2, 25000); }
      catch (_) { await ctx.retry('walk to supply chest', () => ctx.gotoSee(cp, 25000), 2); }
      const chest = bot.blockAt(cp);
      if (!chest || !CONTAINERS.has(chest.name)) {
        throw fatal('not_found', `no chest at ${cp.x},${cp.y},${cp.z} (found ${chest ? chest.name : 'unloaded'})`,
          'check the chest coordinates (BASE.md / DEPOT.md) and restart');
      }
      const eyeDist = cp.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.6, 0));
      if (eyeDist > 4.5) throw fatal('unreachable', 'cannot get within reach of the supply chest', 'clear the approach or pick another chest');
      const got = {}, short = {};
      const win = await withTimeout(bot.openContainer(chest), 8000, 'chest_open_timeout');
      try {
        for (const [name, want] of wanted) {
          ctx.step();
          let taken = 0;
          const budget = Math.max(0, bot.inventory.emptySlotCount() - 1) * 64;
          const cap = Math.min(want, budget || want);
          for (const it of win.containerItems().filter((i) => i.name === name)) {
            if (taken >= cap) break;
            const k = Math.min(it.count, cap - taken);
            if (k <= 0) break;
            try { await win.withdraw(it.type, null, k); taken += k; } // count REQUIRED: null means 1
            catch (e) { pushLog('warn', `withdraw ${name} x${k}: ${e.message}`); break; }
            await new Promise((r) => setTimeout(r, 80));
          }
          if (taken > 0) got[name] = taken;
          if (taken < want) short[name] = want - taken;
        }
      } finally { try { win.close(); } catch (_) {} }
      return { got, short };
    },
  };
  return ctx;
}

// ---------- task runner ----------
// _q is ENGINE-INTERNAL ({qid,runId} for a queued item, {fallback,quiet} for an
// onEmpty sweep). Drivers, task.sh and DRIVER_GUIDE never pass it.
S.start = function (bot, name, args = {}, _q = null) {
  S._lastBot = bot; _bindEnd(bot);
  if (S.currentTask && S.currentTask.running) {
    return { ok: false, error: { code: 'busy', task: S.currentTask.name, phase: S.currentTask.phase,
      queued: S.queue.length, hint: '__skills.stop() first, or __skills.enqueue(bot,[…]) to append' } };
  }
  const skill = S.registry[name];
  if (!skill) return { ok: false, error: { code: 'unknown_skill', known: Object.keys(S.registry) } };
  let bad = null;
  try { bad = skill.validate ? skill.validate(args, bot) : null; }
  catch (e) { bad = 'validate threw: ' + e.message; }
  if (bad) return { ok: false, error: { code: 'bad_args', message: bad, params: skill.params } };

  S._cancel = false;
  const task = S.currentTask = {
    id: 't' + Date.now().toString(36),
    name,
    args,
    phase: 'starting',
    phases: [],
    progress: { done: 0, total: null, unit: null },
    running: true, done: false, cancelled: false,
    error: null,
    result: null,
    startedAt: Date.now(),
    endedAt: null,
    collected: {},
    q: _q && _q.qid ? { qid: _q.qid, runId: _q.runId } : null,
    fallback: Boolean(_q && _q.fallback),
    quiet: Boolean(_q && _q.quiet),
    _gapMs: S._lastEndedAt ? Date.now() - S._lastEndedAt : null,
    _invBefore: invSnapshot(bot),
    _bot: bot,
  };
  if (!task.fallback) S._fallbackRuns = 0; // real work re-arms the fallback announcement
  pushLog('task', `start ${name} ${JSON.stringify(args).slice(0, 120)}`);

  const onEnd = () => { S._cancel = true; task._disconnected = true; };
  bot.once('end', onEnd);
  const capMs = Math.min(args.timeoutMs || 10 * 60 * 1000, 30 * 60 * 1000);
  const watchdog = setTimeout(() => { S._cancel = true; task._timedOut = true; }, capMs);

  (async () => {
    try {
      const r = await skill.fn(makeCtx(bot, task));
      task.result = (r && typeof r === 'object') ? r : null;
      task.phase = 'done';
      task.collected = invGains(task._invBefore, invSnapshot(bot));
      say(bot, String(skill.doneMsg ? skill.doneMsg(task) : `Task ${name} complete.`));
    } catch (e) {
      task.collected = invGains(task._invBefore, invSnapshot(bot));
      if (e instanceof Cancelled) {
        task.cancelled = true;
        if (task._timedOut) {
          task.phase = 'error';
          task.error = { code: 'timeout', message: `task exceeded ${Math.round(capMs / 1000)}s cap`, phase: task.phases[task.phases.length - 1] || 'starting' };
        } else if (task._disconnected) {
          task.phase = 'error';
          task.error = { code: 'disconnected', message: 'bot lost connection mid-task', phase: task.phases[task.phases.length - 1] || 'starting', hint: 'runner auto-reconnects; poll status then restart the task' };
        } else {
          task.phase = 'stopped';
        }
      } else {
        task.error = { code: e.code || 'error', message: e.message, phase: task.phase, hint: e.hint || null };
        task.phase = 'error';
        say(bot, `Task ${name} hit a wall: ${e.message}`);
      }
      pushLog(task.error ? 'error' : 'task', task.error ? `${task.error.code}: ${task.error.message}` : 'stopped by request');
    } finally {
      clearTimeout(watchdog);
      try { bot.removeListener('end', onEnd); } catch (_) {}
      try { bot.pathfinder.setGoal(null); } catch (_) {}
      try { bot.stopDigging(); } catch (_) {}
      task.running = false;
      task.done = !task.error && !task.cancelled;
      task.endedAt = Date.now();
      task._bot = null;
    }
    // THE INSTANT ADVANCE. The finally block above is fully synchronous, and
    // _onTaskEnd/_pump contain no await — so terminal state and the next start()
    // land in ONE uninterrupted continuation: no poll can ever observe
    // running:false while queue.n > 0.
    try { S._onTaskEnd(bot, task); } catch (e) { pushLog('error', 'queue advance: ' + e.message); }
  })();

  return { ok: true, taskId: task.id, poll: 'return __skills.status(bot,0)' };
};

// status(bot, since) — THE one-call poll: bot vitals + task + new log lines.
S.status = function (bot, since = 0) {
  S._lastBot = bot; _bindEnd(bot);          // keeps the fallback timer's bot reference fresh
  // pull-based reconnect recovery: the first poll carrying a live bot resumes the queue
  if (S.queueState === 'paused' && botAlive(bot) && !(S.currentTask && S.currentTask.running)) {
    try { S.resume(bot); } catch (_) {}
  }
  const t = S.currentTask;
  const alive = bot && bot.entity && typeof bot.health === 'number';
  return {
    v: ENGINE_VERSION,
    seq: S._seq,
    bot: alive ? {
      pos: [Math.round(bot.entity.position.x), Math.round(bot.entity.position.y), Math.round(bot.entity.position.z)],
      hp: Math.round(bot.health * 10) / 10,
      food: bot.food,
      dim: bot.game && bot.game.dimension,
    } : { disconnected: true },
    task: t ? {
      id: t.id, name: t.name, args: t.args, phase: t.phase,
      progress: t.progress,
      running: t.running, done: t.done, cancelled: t.cancelled,
      error: t.error,
      result: t.result,
      collected: t.running ? invGains(t._invBefore, invSnapshot(t._bot || bot)) : t.collected,
      elapsedS: Math.round(((t.endedAt || Date.now()) - t.startedAt) / 1000),
      ...(t.q ? { queued: true } : {}),
      ...(t.fallback ? { fallback: true } : {}),
    } : null,
    // null while the queue is unused -> a plain-start driver's poll keeps its v5 size.
    // Full args / per-task history / gapMs live in queueInfo(), not in the hot poll.
    queue: (S.queue.length || S.onEmptySpec || S.queueState !== 'idle') ? {
      state: S.queueState,
      n: S.queue.length,
      next: S.queue.length ? S.queue[0].name : null,
      pending: S.queue.slice(0, 8).map((i) => i.name),
      done: S.queueDone, total: S.queueTotal,
      runId: S.runId,
      onEmpty: S.onEmptySpec ? S.onEmptySpec.name : null,
      halted: S.queueHalt,
    } : null,
    log: S.log.filter((e) => e.seq > since).slice(-LOG_SLICE).map((e) => [e.seq, e.lvl, e.msg]),
  };
};

// stop = STOP: cancels the running task AND clears the queue + onEmpty fallback,
// or the bot would restart a sweep 20s later. stop(reason,{keepQueue:true}) keeps
// the pending items (resume() to continue them).
S.stop = function (reason, opts) {
  const keepQueue = Boolean(opts && opts.keepQueue);
  const cleared = keepQueue ? 0 : S.queue.length;
  S._cancelIntent = 'stop';
  if (!keepQueue) {
    S.queue.length = 0; S.onEmptySpec = null; S.queueHalt = null; S.queuePausedBecause = null;
    S.queueState = 'stopped'; S._queueGen++; killTimers(); S._fallbackRuns = 0;
  }
  if (!S.currentTask || !S.currentTask.running) return { ok: true, note: 'no task running', clearedQueue: cleared };
  S._cancel = true;
  pushLog('task', 'stop requested' + (reason ? ': ' + reason : ''));
  return { ok: true, stopping: S.currentTask.name, clearedQueue: cleared, note: 'halts at next step boundary (never mid-dig)' };
};

S.define = function (name, spec) {
  if (typeof spec.fn !== 'function') return { ok: false, error: 'spec.fn must be a function' };
  S.registry[name] = spec;
  return { ok: true, skills: Object.keys(S.registry) };
};

S.list = function () {
  const out = {};
  for (const [k, v] of Object.entries(S.registry)) out[k] = { description: v.description, params: v.params };
  return out;
};

// ====================================================================
// TASK QUEUE (v6) — kills the idle gap between tasks while a driver thinks.
//
// !!! _pump and _onTaskEnd MUST STAY STRICTLY SYNCHRONOUS — NO await, ever. !!!
// The zero-gap handover depends on the terminal-state write and the next
// S.start() happening in one uninterrupted continuation. Adding an await here
// silently degrades the advance into an observable gap and can race a driver's
// start(). The one yielding path is onError:'continue', which uses later(0)
// deliberately, to break synchronous recursion.
// ====================================================================

function _queueEngaged(task) {
  return Boolean(S.queue.length || S.onEmptySpec || (task && (task.q || task.fallback)));
}

// returns the started skill name, or null. SYNCHRONOUS.
function _pump(bot) {
  if (G.__skills !== S) return null;                       // superseded by a re-inject
  if (S.currentTask && S.currentTask.running) return null;
  if (S.queueState === 'halted' || S.queueState === 'paused' || S.queueState === 'stopped') return null;
  if (!botAlive(bot)) {
    S.queueState = 'paused'; S.queuePausedBecause = 'disconnected'; killTimers();
    return null;
  }
  if (!S.queue.length) { _onDrain(bot); return null; }
  if (!_rateOk()) { _halt('queue_thrash', `${THRASH_N}+ advances in ${THRASH_MS / 1000}s`, S.queue[0].name, bot); return null; }
  const item = S.queue.shift();
  S.queueState = 'running';
  const r = S.start(bot, item.name, item.args, { qid: item.qid, runId: S.runId });
  if (!r.ok) { S.queueDone++; _handleFailure(bot, item.name, r.error); return null; }
  return item.name;
}

function _onDrain(bot) {
  if (S.queueState === 'stopped' || S.queueState === 'halted' || S.queueState === 'paused') return;
  if (!S.onEmptySpec) {
    if (S.queueState !== 'idle') { S.queueState = 'idle'; say(bot, 'Queue empty. Standing by for orders.', true); }
    return;
  }
  const spec = S.onEmptySpec;
  if (spec.maxRuns && spec.runs >= spec.maxRuns) { S.queueState = 'idle'; return; }
  S.queueState = 'draining';
  const gap = S._fallbackRuns === 0 ? 0                        // FIRST fallback: instant, no idle gap
    : Math.max(spec.everyMs, S._fallbackErrBackoff || 0);
  later(gap, () => { const b = S._lastBot; if (botAlive(b)) _startFallback(b); });
}

function _startFallback(bot) {
  if (S.currentTask && S.currentTask.running) return;
  if (S.queue.length) { _pump(bot); return; }
  const spec = S.onEmptySpec;
  if (!spec || S.queueState === 'stopped' || S.queueState === 'halted' || S.queueState === 'paused') return;
  S._fallbackRuns++; spec.runs = (spec.runs || 0) + 1;
  const quiet = S._fallbackRuns > 1;                            // announce the first run only
  if (!quiet) say(bot, `Nothing queued — running a ${spec.name} sweep while I wait for orders.`, true);
  pauseIdleGuard(20000);
  const r = S.start(bot, spec.name, spec.args, { fallback: true, quiet });
  if (!r.ok) {
    pushLog('warn', 'fallback start failed: ' + (r.error && r.error.code));
    later(30000, () => { const b = S._lastBot; if (botAlive(b)) _startFallback(b); });
  }
}

function _halt(code, message, taskName, bot) {
  S.queueState = 'halted';
  S.queueHalt = { code, message: String(message).slice(0, 120), task: taskName || null, pending: S.queue.length };
  killTimers();
  pushLog('error', `queue halted (${code}) after ${taskName}: ${message}`);
  // deliberately NOT pausing the idle-guard here: after ~25s the guard takes over
  // with role-default work if the driver doesn't act.
  say(bot || S._lastBot, `Queue halted: ${taskName || 'task'} failed (${code}). ${S.queue.length} job(s) still pending.`, true);
}

function _handleFailure(bot, name, err) {
  const code = (err && err.code) || 'error';
  const policy = HALT_ALWAYS.has(code) ? 'halt' : S.queueOpts.onError;
  if (policy === 'continue') {
    pushLog('warn', `queue: ${name} failed (${code}) — continuing`);
    later(0, () => { const b = S._lastBot; if (botAlive(b)) _pump(b); });   // later(0) breaks sync recursion
    return;
  }
  if (policy === 'abort') S.queue.length = 0;
  _halt(code, (err && err.message) || 'failed', name, bot);
}

// Called at the very end of start()'s IIFE. SYNCHRONOUS.
S._onTaskEnd = function (bot, task) {
  if (G.__skills !== S) return;                             // an old engine must never drive the new one
  S._lastBot = bot;
  S._lastEndedAt = task.endedAt || Date.now();
  S._history.push({
    name: task.name, ok: Boolean(task.done), code: task.error ? task.error.code : null,
    ms: (task.endedAt || Date.now()) - task.startedAt,
    gapMs: task._gapMs == null ? null : task._gapMs,
    fallback: Boolean(task.fallback),
  });
  if (S._history.length > HISTORY_MAX) S._history.splice(0, S._history.length - HISTORY_MAX);
  if (task.q) {
    S.queueDone++;
    for (const [k, v] of Object.entries(task.collected || {})) S.queueCollected[k] = (S.queueCollected[k] || 0) + v;
  }
  if (!_queueEngaged(task)) {                               // plain start() driver: v5 behavior, untouched
    if (S.queueState === 'running' || S.queueState === 'draining') S.queueState = 'idle';
    return;
  }
  if (task._disconnected) {                                 // never advance onto a dead bot object
    S.queueState = 'paused'; S.queuePausedBecause = 'disconnected';
    killTimers();
    return;
  }
  const intent = S._cancelIntent; S._cancelIntent = 'stop';
  if (task.cancelled && !task.error && intent !== 'skip') return;   // stop() already cleared the queue
  if (task.error && !task.fallback) { _handleFailure(bot, task.name, task.error); return; }
  if (task.error && task.fallback) S._fallbackErrBackoff = Math.min((S._fallbackErrBackoff || 20000) * 2, 60000);
  else if (task.fallback) S._fallbackErrBackoff = 0;
  pauseIdleGuard(20000);
  _pump(bot);                                               // <- the instant advance
};

// ---------- public queue API (additive) ----------
S.enqueue = function (bot, items, opts = {}) {
  S._lastBot = bot;
  if (!Array.isArray(items)) items = items == null ? [] : [items];
  const norm = [];
  for (let i = 0; i < items.length; i++) {
    const v = normalizeItem(bot, items[i], i);
    if (v.error) return { ok: false, error: v.error };       // ATOMIC: nothing was queued
    norm.push(v.item);
  }
  if (!norm.length && !('onEmpty' in opts)) {
    return { ok: false, error: { code: 'bad_args', message: 'enqueue needs at least one {name,args} (or opts.onEmpty)' } };
  }
  if (opts.onError) {
    if (!['halt', 'continue', 'abort'].includes(opts.onError)) {
      return { ok: false, error: { code: 'bad_args', message: "onError must be 'halt'|'continue'|'abort'" } };
    }
    S.queueOpts.onError = opts.onError;
  }
  if ('onEmpty' in opts) { const r = S.setFallback(bot, opts.onEmpty); if (!r.ok) return r; }
  if (opts.mode === 'replace') { S.queue.length = 0; S.queueDone = 0; S.queueTotal = 0; S._queueGen++; killTimers(); }
  if (S.queue.length + norm.length > QUEUE_MAX) {
    return { ok: false, error: { code: 'queue_full', max: QUEUE_MAX, len: S.queue.length } };
  }
  if (!S.runId || S.queueState === 'idle' || S.queueState === 'stopped') {
    S.runId = 'q' + Date.now().toString(36);
    S.queueDone = 0; S.queueTotal = 0; S.queueCollected = {}; S._advTimes = [];
  }
  S.queueHalt = null; S.queuePausedBecause = null;
  for (const it of norm) S.queue.push(it);
  S.queueTotal += norm.length;
  S.queueState = S.queue.length ? 'running' : (S.onEmptySpec ? 'draining' : 'idle');
  _bindEnd(bot); pauseIdleGuard(20000);
  if (norm.length) {
    pushLog('task', `enqueue ${norm.length}: ${norm.map((i) => i.name).join(', ')}`);
    say(bot, `Queued ${norm.length} job${norm.length > 1 ? 's' : ''}: ${norm.map((i) => i.name).join(', ')}.`, true);
  }
  let started = null;
  if (opts.start !== false) started = _pump(bot);
  return { ok: true, queued: norm.length, runId: S.runId, started,
    pending: S.queue.map((i) => i.name), onEmpty: S.onEmptySpec ? S.onEmptySpec.name : null };
};

S.setFallback = function (bot, spec) {
  if (spec === null || spec === false || spec === undefined) {
    S.onEmptySpec = null; S._fallbackRuns = 0; S._fallbackErrBackoff = 0;
    S._queueGen++; killTimers();                       // drop any armed fallback timer now
    // back to a plain idle engine so status() returns to the compact queue:null payload
    if (S.queueState === 'draining' && !S.queue.length && !(S.currentTask && S.currentTask.running)) S.queueState = 'idle';
    return { ok: true, onEmpty: null };
  }
  if (typeof spec === 'string') spec = { name: spec, args: {} };
  const v = normalizeItem(bot, spec, 0);
  if (v.error) return { ok: false, error: v.error };
  S.onEmptySpec = {
    name: v.item.name, args: v.item.args,
    everyMs: Math.max(3000, Math.min(spec.everyMs || 20000, 300000)),
    maxRuns: spec.maxRuns || 0, runs: 0,
  };
  S._fallbackRuns = 0; S._fallbackErrBackoff = 0;
  return { ok: true, onEmpty: S.onEmptySpec.name, everyMs: S.onEmptySpec.everyMs };
};

// keeps the fallback armed; use setFallback(bot, null) to drop it
S.clearQueue = function (reason) {
  const n = S.queue.length;
  S.queue.length = 0; S._queueGen++; killTimers(); S.queueHalt = null;
  S.queueState = (S.currentTask && S.currentTask.running) ? 'running' : 'idle';
  pushLog('task', `queue cleared (${n})` + (reason ? ': ' + reason : ''));
  return { ok: true, cleared: n };
};

// abort the running task and ADVANCE to the next one (unlike stop)
S.skip = function (reason) {
  if (!S.currentTask || !S.currentTask.running) {
    const b = S._lastBot;
    return { ok: true, note: 'nothing running', started: botAlive(b) ? _pump(b) : null, pending: S.queue.length };
  }
  S._cancelIntent = 'skip'; S._cancel = true;
  pushLog('task', 'skip requested' + (reason ? ': ' + reason : ''));
  return { ok: true, skipping: S.currentTask.name, pending: S.queue.length };
};

// after a halt, or after a disconnect pause
S.resume = function (bot) {
  S._lastBot = bot; _bindEnd(bot);
  if (S.currentTask && S.currentTask.running) return { ok: true, note: 'task already running', pending: S.queue.length };
  if (!botAlive(bot)) return { ok: false, error: { code: 'disconnected', message: 'bot not in world yet' } };
  S.queueHalt = null; S.queuePausedBecause = null; S._advTimes = [];
  S.queueState = S.queue.length ? 'running' : (S.onEmptySpec ? 'draining' : 'idle');
  const started = _pump(bot);
  return { ok: true, started, pending: S.queue.length, state: S.queueState };
};

// for the (deferred) runner.js spawn hook: hand the engine a fresh bot object
S.rebind = function (bot) {
  S._lastBot = bot; _bindEnd(bot);
  if (S.queueState === 'paused') return S.resume(bot);
  return { ok: true, state: S.queueState };
};

// rich, non-polling introspection: full args, history, gapMs
S.queueInfo = function () {
  return {
    state: S.queueState, runId: S.runId, done: S.queueDone, total: S.queueTotal,
    onError: S.queueOpts.onError, halt: S.queueHalt, pausedBecause: S.queuePausedBecause,
    pending: S.queue.map((i) => ({ qid: i.qid, name: i.name, args: i.args })),
    onEmpty: S.onEmptySpec, collected: S.queueCollected, history: S._history.slice(),
  };
};

// ====================================================================
// BLUEPRINT BUILDING (v7) — TODO 1 "human-looking builds"
//
// Two front ends, ONE engine:
//   file layer  : POST /blueprint/load parses a .schem (prismarine-schematic, in
//                 runner.js) into globalThis.__blueprints[name].placements, which
//                 buildSchematic reads straight out of the shared process globals.
//   parametric  : S.blueprints.{wall,floor,frame} generate the same placement shape
//                 in pure code, so buildWall/buildFloor/frameStructure keep working
//                 with no schematic library installed at all.
// A placement is {name:'oak_planks', pos:[x,y,z]} in world coordinates.
// ====================================================================

const BUILD_MAX = 4096;

function sortPlacements(list) {
  // bottom-up, row-major: whatever a block needs to rest on is placed before it
  return list.slice().sort((a, b) => (a.pos[1] - b.pos[1]) || (a.pos[2] - b.pos[2]) || (a.pos[0] - b.pos[0]));
}
function bpNum(v, def) { return (typeof v === 'number' && isFinite(v)) ? v : def; }
function bpXYZ(o, label) {
  if (!o || !['x', 'y', 'z'].every((k) => typeof o[k] === 'number' && isFinite(o[k]))) {
    throw new Error(`${label} must be {x,y,z} numbers`);
  }
  return { x: Math.floor(o.x), y: Math.floor(o.y), z: Math.floor(o.z) };
}
function bpMat(v, label) {
  if (typeof v !== 'string' || !v.length) throw new Error(`${label} must be a block name`);
  return v;
}

// ---- generators (pure; throw a plain Error with a driver-readable message) ----
// Each accepts BOTH the v5/v6 argument shape (origin/width/...) and a from/to shape.
function genWall(spec = {}) {
  const material = bpMat(spec.material, 'material');
  const height = Math.max(1, Math.min(64, Math.floor(bpNum(spec.height, 3))));
  let ox, oy, oz, axis, width;
  if (spec.from && spec.to) {
    const f = spec.from, t = spec.to;
    for (const [p, l] of [[f, 'from'], [t, 'to']]) {
      if (!p || ![p.x, p.z].every((n) => typeof n === 'number' && isFinite(n))) throw new Error(`${l} needs numeric x,z`);
    }
    const y = bpNum(f.y, bpNum(spec.y, null));
    if (y === null) throw new Error('from needs a numeric y (or pass y)');
    const dx = Math.floor(t.x) - Math.floor(f.x);
    const dz = Math.floor(t.z) - Math.floor(f.z);
    if (dx !== 0 && dz !== 0) throw new Error('a wall from/to must share x or z (axis-aligned only)');
    axis = dx !== 0 ? 'x' : 'z';
    width = Math.abs(dx || dz) + 1;
    ox = Math.min(Math.floor(f.x), Math.floor(t.x));
    oz = Math.min(Math.floor(f.z), Math.floor(t.z));
    oy = Math.floor(y);
  } else {
    const o = bpXYZ(spec.origin || spec.at, 'origin');
    ox = o.x; oy = o.y; oz = o.z;
    axis = spec.axis || 'x';
    if (axis !== 'x' && axis !== 'z') throw new Error("axis must be 'x' or 'z'");
    width = Math.max(1, Math.min(64, Math.floor(bpNum(spec.width, 5))));
  }
  const out = [];
  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      out.push({ name: material, pos: axis === 'x' ? [ox + w, oy + h, oz] : [ox, oy + h, oz + w] });
    }
  }
  if (!out.length) throw new Error('wall generates 0 blocks');
  return sortPlacements(out);
}

function genFloor(spec = {}) {
  const material = bpMat(spec.material, 'material');
  let ox, oz, y, width, length;
  if (spec.from && spec.to) {
    const f = spec.from, t = spec.to;
    for (const [p, l] of [[f, 'from'], [t, 'to']]) {
      if (!p || ![p.x, p.z].every((n) => typeof n === 'number' && isFinite(n))) throw new Error(`${l} needs numeric x,z`);
    }
    const yy = bpNum(spec.y, bpNum(f.y, null));
    if (yy === null) throw new Error('need a numeric y for the floor');
    ox = Math.min(Math.floor(f.x), Math.floor(t.x));
    oz = Math.min(Math.floor(f.z), Math.floor(t.z));
    width = Math.abs(Math.floor(t.x) - Math.floor(f.x)) + 1;
    length = Math.abs(Math.floor(t.z) - Math.floor(f.z)) + 1;
    y = Math.floor(yy);
  } else {
    const o = bpXYZ(spec.origin || spec.at, 'origin');
    ox = o.x; oz = o.z; y = o.y;
    width = Math.max(1, Math.min(64, Math.floor(bpNum(spec.width, 5))));
    length = Math.max(1, Math.min(64, Math.floor(bpNum(spec.length ?? spec.depth, 5))));
  }
  const out = [];
  for (let x = 0; x < width; x++) for (let z = 0; z < length; z++) out.push({ name: material, pos: [ox + x, y, oz + z] });
  if (!out.length) throw new Error('floor generates 0 blocks');
  return sortPlacements(out);
}

// The TODO-1 aesthetic: log corner pillars + plank infill, a real doorway gap,
// optional flat roof and optional interior floor one block below the walls.
function genFrame(spec = {}) {
  const o = bpXYZ(spec.origin || spec.at, 'origin');
  const width = Math.max(3, Math.min(32, Math.floor(bpNum(spec.width, 5))));
  const depth = Math.max(3, Math.min(32, Math.floor(bpNum(spec.depth, 5))));
  const height = Math.max(2, Math.min(32, Math.floor(bpNum(spec.height, 4))));
  const corner = bpMat(spec.cornerMaterial || 'oak_log', 'cornerMaterial');
  const fill = bpMat(spec.fillMaterial || spec.wallMaterial || 'oak_planks', 'fillMaterial');
  const roofMat = spec.roof === true ? fill : (typeof spec.roof === 'string' ? spec.roof : null);
  const floorMat = typeof spec.floor === 'string' ? spec.floor : (typeof spec.floorMaterial === 'string' ? spec.floorMaterial : null);
  // v5/v6 called this doorGap and always cut it into the z=origin wall; 'north' keeps that.
  let doorway = spec.doorway === undefined ? (spec.doorGap === false ? null : 'north') : spec.doorway;
  if (doorway === true) doorway = 'north';
  if (doorway === false) doorway = null;
  if (doorway && !['north', 'south', 'east', 'west'].includes(doorway)) {
    throw new Error("doorway must be 'north'(z=origin) | 'south' | 'east' | 'west' | null");
  }
  const doorX = Math.floor((width - 1) / 2);
  const doorZ = Math.floor((depth - 1) / 2);
  const isDoor = (x, z, y) => {
    if (!doorway || y > 1) return false;
    if (doorway === 'north') return z === 0 && x === doorX;
    if (doorway === 'south') return z === depth - 1 && x === doorX;
    if (doorway === 'west') return x === 0 && z === doorZ;
    return x === width - 1 && z === doorZ; // east
  };
  const out = [];
  if (floorMat) {
    for (let x = 1; x < width - 1; x++) for (let z = 1; z < depth - 1; z++) out.push({ name: floorMat, pos: [o.x + x, o.y - 1, o.z + z] });
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        if (x !== 0 && x !== width - 1 && z !== 0 && z !== depth - 1) continue; // interior stays open
        if (isDoor(x, z, y)) continue;
        const isCorner = (x === 0 || x === width - 1) && (z === 0 || z === depth - 1);
        out.push({ name: isCorner ? corner : fill, pos: [o.x + x, o.y + y, o.z + z] });
      }
    }
  }
  if (roofMat) {
    for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) out.push({ name: roofMat, pos: [o.x + x, o.y + height, o.z + z] });
  }
  if (!out.length) throw new Error('frame generates 0 blocks');
  return sortPlacements(out);
}

S.blueprints = { wall: genWall, floor: genFloor, frame: genFrame };

// ---- skill args -> generator spec (keeps the v5/v6 clamps and defaults exactly) ----
function wallSpec(a) {
  const s = { material: a.material, height: Math.max(1, Math.min(16, Math.floor(bpNum(a.height, 3)))) };
  if (a.from && a.to) { s.from = a.from; s.to = a.to; s.y = a.y; }
  else { s.origin = a.origin; s.axis = a.axis || 'x'; s.width = Math.max(1, Math.min(24, Math.floor(bpNum(a.width, 5)))); }
  return s;
}
function floorSpec(a) {
  const s = { material: a.material };
  if (a.from && a.to) { s.from = a.from; s.to = a.to; s.y = a.y; }
  else {
    s.origin = a.origin;
    s.width = Math.max(1, Math.min(24, Math.floor(bpNum(a.width, 5))));
    s.length = Math.max(1, Math.min(24, Math.floor(bpNum(a.length ?? a.depth, 5))));
  }
  return s;
}
function frameSpec(a) {
  let doorway = a.doorway === undefined ? (a.doorGap === false ? null : 'north') : a.doorway;
  if (doorway === true) doorway = 'north';
  if (doorway === false) doorway = null;
  return {
    origin: a.origin || a.at,
    width: Math.max(3, Math.min(16, Math.floor(bpNum(a.width, 5)))),
    depth: Math.max(3, Math.min(16, Math.floor(bpNum(a.depth, 5)))),
    height: Math.max(2, Math.min(12, Math.floor(bpNum(a.height, 4)))),
    cornerMaterial: a.cornerMaterial || 'oak_log',
    fillMaterial: a.fillMaterial || a.wallMaterial || 'oak_planks',
    doorway, roof: a.roof, floor: a.floor || a.floorMaterial,
  };
}

// ---- validation shared by every build skill ----
function validatePlacements(list, bot) {
  if (!Array.isArray(list) || !list.length) return 'placements must be a non-empty array';
  if (list.length > BUILD_MAX) return `too many placements (${list.length} > ${BUILD_MAX}) — load it as a blueprint instead`;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p.name !== 'string') return `placements[${i}] needs a block name`;
    if (!bot.registry.blocksByName[p.name]) return `placements[${i}]: unknown block '${p.name}'`;
    if (!bot.registry.itemsByName[itemForBlock(p.name)]) return `placements[${i}]: '${p.name}' has no placeable item`;
    if (!Array.isArray(p.pos) || p.pos.length !== 3 || !p.pos.every((n) => typeof n === 'number' && isFinite(n))) {
      return `placements[${i}].pos must be [x,y,z] numbers`;
    }
  }
  return null;
}
function validateChestArg(c) {
  if (c == null) return null;
  if (![c.x, c.y, c.z].every((n) => typeof n === 'number' && isFinite(n))) return 'chest must be {x,y,z} numbers';
  return null;
}

// ---- THE builder. Every build skill funnels through this. ----
// opts: {label, chest:{x,y,z}|null, maxRestocks:int, clearSite:bool, skipMissing:bool}
async function buildCore(ctx, placements, opts = {}) {
  const bot = ctx.bot;
  const label = opts.label || 'structure';
  const chest = opts.chest ? { x: Math.floor(opts.chest.x), y: Math.floor(opts.chest.y), z: Math.floor(opts.chest.z) } : null;
  const maxRestocks = Math.max(0, Math.min(8, Math.floor(bpNum(opts.maxRestocks, 3))));
  const clearSite = Boolean(opts.clearSite);
  const failOnMissing = opts.skipMissing !== true;
  const cells = placements.map((p) => ({
    name: p.name, item: itemForBlock(p.name),
    v: new Vec3(Math.floor(p.pos[0]), Math.floor(p.pos[1]), Math.floor(p.pos[2])),
  }));
  const total = cells.length;
  const buildKeys = new Set(cells.map((c) => key(c.v)));

  // ---------- planning ----------
  ctx.setPhase('planning', `Blueprint ${label}: ${total} blocks. Counting my materials.`);
  ctx.progress(0, total, 'blocks');
  const need = {};
  let prepaid = 0;
  const gravityNames = new Set();
  for (const c of cells) {
    if (GRAVITY.has(c.name)) gravityNames.add(c.name);
    const b = bot.blockAt(c.v);
    if (b && b.name === c.name) { prepaid++; continue; }
    need[c.item] = (need[c.item] || 0) + 1;
  }
  const have = invSnapshot(bot);
  const shortfall = {};
  for (const [it, n] of Object.entries(need)) {
    const d = n - (have[it] || 0);
    if (d > 0) shortfall[it] = d;
  }
  if (prepaid) ctx.log(`${prepaid}/${total} blocks are already correct — resuming, not rebuilding`);
  if (gravityNames.size) pushLog('warn', `gravity blocks in the bill (${[...gravityNames].join(', ')}) — anything placed over air will fall`);
  if (Object.keys(shortfall).length) {
    const s = Object.entries(shortfall).map(([k, v]) => `${v} ${k}`).join(', ');
    if (chest) ctx.log(`short by ${s} — will restock from the chest at ${chest.x},${chest.y},${chest.z}`);
    else pushLog('warn', `short by ${s} and no restock chest given`);
  }

  // ---------- movements: pathfinder must not eat the build ----------
  // It digs traversal blocks with the HELD tool and places scaffolding FROM INVENTORY
  // (catalog quirks) — either would chew through the structure or its materials.
  let prevMoves = null, buildMoves = null;
  const applyBuildMoves = () => { try { if (buildMoves) bot.pathfinder.setMovements(buildMoves); } catch (_) {} };
  const restoreMoves = () => { try { if (prevMoves) bot.pathfinder.setMovements(prevMoves); } catch (_) {} };
  try {
    prevMoves = bot.pathfinder.movements || null;
    buildMoves = new pathfinder.Movements(bot);
    if (!Array.isArray(buildMoves.scafoldingBlocks)) pushLog('warn', 'pathfinder Movements has no scafoldingBlocks — build materials could be spent as scaffolding');
    else buildMoves.scafoldingBlocks = [];
    buildMoves.allow1by1towers = false;
    buildMoves.allowParkour = false;
    buildMoves.allowSprinting = false;
    buildMoves.maxDropDown = 3;
    buildMoves.infiniteLiquidDropdownDistance = false;
    // peter-driver, confirmed root cause 2026-09-01: movements.canDig defaults true, and
    // short per-block GoalNear hops inside a confined structure can make the A* planner
    // prefer DIGGING through a nearby wall/floor/corner over walking the longer way round
    // — even when the target is reachable without digging. Ate a finished floor (23/40
    // tiles) and later a patched wall, purely from ordinary build-loop travel. The
    // exclusionAreasBreak guard below protects the build's OWN cells specifically; canDig
    // false is the confirmed, unconditional fix (verified live: zero further collateral
    // damage) and does NOT block placeBlockAt's own explicit clear-a-wrong-block digBlock
    // step — that's a direct bot.dig() call, not gated by this planner-only flag.
    buildMoves.canDig = false;
    // exclusionBreak >= 100 makes a block un-breakable to the planner (movements.js
    // safeToBreak) — extra belt-and-suspenders on the build's own cells specifically.
    const guard = (block) => (block && block.position && buildKeys.has(key(block.position)) ? 100 : 0);
    if (Array.isArray(buildMoves.exclusionAreasBreak)) buildMoves.exclusionAreasBreak.push(guard);
    if (Array.isArray(buildMoves.exclusionAreasPlace)) buildMoves.exclusionAreasPlace.push(guard);
    applyBuildMoves();
  } catch (e) { pushLog('warn', 'build movements not applied: ' + e.message); buildMoves = null; }

  let placed = 0, already = 0, restocks = 0, deferredResolved = 0;
  const missing = {}, failed = [], unavailable = new Set(), noStock = {};
  let lastLayer = null;

  const remainingNeed = (from) => {
    const want = {};
    for (let j = from; j < cells.length; j++) {
      const c = cells[j];
      if (unavailable.has(c.item)) continue;
      const b = bot.blockAt(c.v);
      if (b && b.name === c.name) continue;
      want[c.item] = (want[c.item] || 0) + 1;
    }
    const inv = invSnapshot(bot);
    const out = {};
    for (const [it, n] of Object.entries(want)) { const d = n - (inv[it] || 0); if (d > 0) out[it] = d; }
    return out;
  };

  const doRestock = async (fromIdx) => {
    restocks++;
    ctx.setPhase('restocking', `Materials running dry — nipping over to the supply chest for round ${restocks}.`);
    restoreMoves(); // default movements for the trip: the site cells are behind us
    let r = { got: {}, short: {} };
    try { r = await ctx.withdrawFromChest(chest, remainingNeed(fromIdx)); }
    finally { applyBuildMoves(); }
    for (const it of Object.keys(r.short)) {
      if (!r.got[it]) {
        noStock[it] = (noStock[it] || 0) + 1;
        if (noStock[it] >= 2) { unavailable.add(it); pushLog('warn', `chest has no more ${it} — skipping those blocks`); }
      }
    }
    const gotAny = Object.keys(r.got).length > 0;
    ctx.setPhase('building');
    if (gotAny) ctx.say(`Restocked: ${Object.entries(r.got).map(([k, v]) => `${v} ${k}`).join(', ')}. Back to work.`);
    return gotAny;
  };

  try {
    // ---------- travelling (loads the site chunks before anything is measured) ----------
    ctx.setPhase('travelling', `Heading to the build site at ${cells[0].v.x}, ${cells[0].v.y}, ${cells[0].v.z}.`);
    try { await ctx.retry('travel to site', () => ctx.gotoNear(cells[0].v, 3, 60000), 2); }
    catch (e) { pushLog('warn', `could not reach the site cleanly (${e.message}) — building from where I am`); }

    // ---------- building ----------
    ctx.setPhase('building', `Building ${label}: ${total - prepaid} blocks to place.`);
    const deferred = [];
    let streakReason = null, streak = 0;
    for (let i = 0; i < cells.length; i++) {
      ctx.step();
      const c = cells[i];
      if (unavailable.has(c.item)) { missing[c.item] = (missing[c.item] || 0) + 1; continue; }
      let r = await ctx.placeBlockAt(c.v, c.name, { clearMismatch: clearSite });
      if (!r.ok && r.reason === 'no_material' && chest && restocks < maxRestocks) {
        if (await doRestock(i)) r = await ctx.placeBlockAt(c.v, c.name, { clearMismatch: clearSite });
      }
      if (r.ok) {
        if (r.already) already++; else placed++;
        streak = 0;
      } else if (r.reason === 'no_material') {
        if (failOnMissing) {
          throw fatal('no_material', `out of ${c.item} (${total - placed - already} blocks still to go)`,
            chest ? 'restock the supply chest, then restart — the build is idempotent, placed blocks are skipped'
              : 'gather more material (or pass chest:{x,y,z} to restock automatically) and restart — already-placed blocks are skipped');
        }
        unavailable.add(c.item);
        missing[c.item] = (missing[c.item] || 0) + 1;
      } else if (r.reason === 'no_reference' || r.reason === 'self_occupied' || r.reason === 'unloaded') {
        deferred.push(i); // a neighbour placed later gives it a face to attach to
      } else {
        failed.push({ pos: [c.v.x, c.v.y, c.v.z], block: c.name, reason: r.reason, detail: r.block || r.detail || r.error || null });
        streak = r.reason === streakReason ? streak + 1 : 1;
        streakReason = r.reason;
        if (streak >= 3) {
          throw fatal('build_stuck', `3 placements in a row failed with '${r.reason}'`, 'inspect the site (obstruction, protected block, or no reachable standing spot) and restart');
        }
      }
      ctx.progress(placed + already, total, 'blocks');
      if (lastLayer !== null && c.v.y !== lastLayer) ctx.say(`Layer y=${lastLayer} done, moving up.`);
      lastLayer = c.v.y;
    }

    // ---------- deferred: 2 more rounds now that neighbours exist ----------
    let round = deferred.slice();
    for (let pass = 0; pass < 2 && round.length; pass++) {
      ctx.setPhase('deferred', pass === 0 ? `Filling in ${round.length} awkward block${round.length > 1 ? 's' : ''} I had to skip.` : null);
      const next = [];
      for (const idx of round) {
        ctx.step();
        const c = cells[idx];
        if (unavailable.has(c.item)) { missing[c.item] = (missing[c.item] || 0) + 1; continue; }
        let r = await ctx.placeBlockAt(c.v, c.name, { clearMismatch: clearSite });
        if (!r.ok && r.reason === 'no_material' && chest && restocks < maxRestocks) {
          if (await doRestock(idx)) r = await ctx.placeBlockAt(c.v, c.name, { clearMismatch: clearSite });
        }
        if (r.ok) { if (r.already) already++; else { placed++; deferredResolved++; } }
        else if (pass === 1) failed.push({ pos: [c.v.x, c.v.y, c.v.z], block: c.name, reason: r.reason });
        else next.push(idx);
        ctx.progress(placed + already, total, 'blocks');
      }
      round = next;
    }

    // ---------- finishing ----------
    ctx.setPhase('finishing', 'Structure up. Sweeping the site clean.');
    await ctx.collectDrops(10, 10000);
    let ok = 0; const mismatched = [];
    for (const c of cells) {
      const b = bot.blockAt(c.v);
      if (b && b.name === c.name) ok++;
      else mismatched.push({ pos: [c.v.x, c.v.y, c.v.z], want: c.name, got: b ? b.name : 'unloaded' });
    }
    return {
      blocks: total, placed, already, deferredResolved, restocks,
      missing, failed: failed.slice(0, 10), failedCount: failed.length,
      verified: { ok, mismatched: mismatched.length, examples: mismatched.slice(0, 5) },
    };
  } finally {
    restoreMoves();
  }
}

// ====================================================================
// SKILLS
// ====================================================================

// ---------- come ----------
S.define('come', {
  description: 'Walk to coordinates.',
  params: { x: 'number', y: 'number', z: 'number', range: 'int (default 1)' },
  validate: (a) => ([a.x, a.y, a.z].every((n) => typeof n === 'number' && isFinite(n)) ? null : 'need numeric x,y,z'),
  fn: async (ctx) => {
    const { args } = ctx;
    ctx.setPhase('travelling', `Heading to ${Math.round(args.x)}, ${Math.round(args.y)}, ${Math.round(args.z)}.`);
    const restoreMoves = ctx.enterHaul();
    try {
      await ctx.retry('travel', () => ctx.gotoNear(args, args.range || 1, 60000), 2);
    } finally { restoreMoves(); }
    ctx.setPhase('arrived');
  },
  doneMsg: () => 'Arrived.',
});

// ---------- collectDrops ----------
S.define('collectDrops', {
  description: 'Sweep every item drop within radius. Best-effort; unreachable drops are skipped.',
  params: { radius: 'int (default 16)', timeoutMs: 'int (default 30000)', only: 'optional array of item names' },
  validate: (a) => (a.radius != null && !(a.radius > 0) ? 'radius must be > 0' : null),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const radius = Math.min(args.radius || 16, 48);
    const me = bot.entity.position;
    const n = Object.values(bot.entities).filter((e) => e && e.name === 'item' && e.position && e.position.distanceTo(me) <= radius).length;
    ctx.setPhase('sweeping', n ? `Sweeping up ${n} drops nearby. Leaving nothing behind.` : 'Checking for stray drops around me.');
    const r = await ctx.collectDrops(radius, args.timeoutMs || 30000, args.only || null);
    ctx.progress(r.picked, null, 'drops');
    return r;
  },
  doneMsg: (t) => `Drop sweep done: picked up ${t.result ? t.result.picked : 0} drops.`,
});

// ---------- chopTrees ----------
S.define('chopTrees', {
  description: 'Fell whole trees (flood-filled connected logs, bottom-up), collect all drops, replant saplings when held.',
  params: { types: "'any' or array of species (oak, spruce, birch, jungle, acacia, dark_oak, cherry, pale_oak, mangrove)", count: 'trees to fell (default 1)', maxDist: 'search radius (default 64)', replant: 'bool (default true)' },
  validate: (a) => {
    let types = a.types || ['oak'];
    if (typeof types === 'string') types = types === 'any' ? SPECIES : [types];
    if (!Array.isArray(types) || !types.length) return 'types must be a species array or "any"';
    for (const t of types) if (!SPECIES.includes(t)) return `unknown species '${t}' (known: ${SPECIES.join(', ')})`;
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    let types = args.types || ['oak'];
    if (typeof types === 'string') types = types === 'any' ? SPECIES : [types];
    const count = Math.max(1, Math.min(16, args.count || 1));
    const maxDist = Math.min(args.maxDist || 64, 64);
    const replant = args.replant !== false;
    const logNames = types.flatMap((t) => [t + '_log', t + '_wood']);
    const logIds = blockIds(bot, logNames);
    const logIdSet = new Set(logIds);
    const blacklist = new Set();
    let felled = 0, logsDug = 0, stranded = 0, replanted = 0;
    ctx.progress(0, count, 'trees');
    ctx.setPhase('searching', `Off to chop ${count} tree${count > 1 ? 's' : ''} (${types.join('/')}). Timber incoming.`);

    while (felled < count) {
      ctx.step();
      // find trunk bases: a log whose block below is NOT a log (ground contact)
      const hits = bot.findBlocks({ matching: logIds, maxDistance: maxDist, count: 64 })
        .filter((p) => !blacklist.has(key(p)))
        .filter((p) => { const below = bot.blockAt(p.offset(0, -1, 0)); return below && !logIdSet.has(below.type); })
        .sort((a, b2) => a.distanceTo(bot.entity.position) - b2.distanceTo(bot.entity.position));
      if (!hits.length) {
        if (felled === 0) throw fatal('not_found', `no ${types.join('/')} tree within ${maxDist} blocks`, 'move the bot elsewhere or widen types/maxDist, then restart');
        ctx.log(`only ${felled}/${count} trees found — area exhausted`);
        break;
      }
      const base = hits[0];
      const species = (bot.blockAt(base) || {}).name ? bot.blockAt(base).name.replace(/_(log|wood)$/, '') : types[0];

      // flood-fill the connected log set (dy 0..1, 3x3 in XZ, bounded to this tree)
      const tree = [];
      const seen = new Set([key(base)]);
      const q = [base];
      while (q.length && tree.length < 200) {
        const p = q.shift();
        const b = bot.blockAt(p);
        if (!b || !logIdSet.has(b.type)) continue;
        tree.push(p);
        for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          const n = p.offset(dx, dy, dz);
          if (n.y < base.y) continue;
          if (Math.abs(n.x - base.x) > 7 || Math.abs(n.z - base.z) > 7) continue;
          const k = key(n);
          if (seen.has(k)) continue;
          seen.add(k);
          q.push(n);
        }
      }
      tree.sort((a, b2) => a.y - b2.y); // bottom-up: no tree physics in MC, the rest floats anyway

      ctx.setPhase('chopping', `Chopping tree ${felled + 1} of ${count} (${tree.length} ${species} logs).`);
      let dugThisTree = 0;
      for (const p of tree) {
        ctx.step();
        const r = await ctx.digBlock(p);
        if (r.ok && !r.already) { dugThisTree++; logsDug++; }
        else if (!r.ok) {
          if (r.reason === 'no_tool') {
            // logs are always hand-harvestable; a weird held item can break digTime — clear hand once
            try { await bot.unequip('hand'); } catch (_) {}
            const r2 = await ctx.digBlock(p);
            if (r2.ok && !r2.already) { dugThisTree++; logsDug++; } else stranded++;
          } else stranded++;
        }
      }
      if (dugThisTree === 0) { blacklist.add(key(base)); ctx.log(`tree at ${key(base)} unreachable — blacklisted`); continue; }
      felled++;
      ctx.progress(felled, count);

      ctx.setPhase('collecting', 'Tree down. Sweeping up the drops.');
      await ctx.collectDrops(12, 20000);

      if (replant) {
        const sapName = SAPLING(species);
        const sap = bot.inventory.items().find((i) => i.name === sapName);
        const ref = bot.blockAt(base.offset(0, -1, 0));
        const spot = bot.blockAt(base);
        if (sap && ref && SOIL.has(ref.name) && spot && AIR.has(spot.name)) {
          try {
            await ctx.gotoNear(base, 2, 15000);
            await withTimeout(bot.equip(sap, 'hand'), 5000, 'equip_timeout');
            try {
              await bot.placeBlock(ref, new Vec3(0, 1, 0));
              replanted++;
            } catch (_) {
              // own hitbox often blocks the spot — step aside once and retry
              try {
                await ctx.gotoNear(base.offset(2, 0, 0), 1, 10000);
                await bot.placeBlock(ref, new Vec3(0, 1, 0));
                replanted++;
              } catch (_) { ctx.log('replant failed twice — moving on'); }
            }
            if (replanted) ctx.say(`Replanted a ${sapName}. Nature restored.`);
          } catch (_) { ctx.log('replant setup failed — moving on'); }
        } else if (!sap) ctx.log(`no ${sapName} in inventory — cannot replant`);
      }
    }
    ctx.setPhase('finishing');
    await ctx.collectDrops(10, 10000);
    return { treesFelled: felled, logsDug, stranded, replanted };
  },
  doneMsg: (t) => {
    const haul = Object.entries(t.collected).map(([k, v]) => `${v} ${k}`).join(', ');
    return `Chopped ${t.result.treesFelled} tree(s), ${t.result.logsDug} logs. Haul: ${haul || 'nothing?!'}`;
  },
});

// ---------- mineLane ----------
S.define('mineLane', {
  description: 'Mine N blocks of a type (deepslate-aware ore aliases, vein following), verify drops landed in inventory.',
  params: { target: "block name, e.g. 'stone', 'iron_ore' (ore aliases include deepslate variants)", count: 'blocks to bank (default 8)', maxDist: 'search radius (default 32, capped)', vein: 'follow touching veins (default true)', laneY: 'optional: only blocks within 2 of this Y' },
  validate: (a, bot) => {
    if (!a.target) return 'need args.target';
    const names = ORE_ALIASES[a.target] || [a.target];
    if (!names.some((n) => bot.registry.blocksByName[n])) return `unknown block '${a.target}'`;
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const target = args.target;
    const count = Math.max(1, Math.min(64, args.count || 8));
    const names = ORE_ALIASES[target] || [target];
    const ids = blockIds(bot, names);
    const idSet = new Set(ids);
    const want = [...new Set(names.flatMap((n) => expectedDrops(bot, n)))];
    const cap = names.some((n) => UBIQUITOUS.has(n)) ? 16 : Math.min(args.maxDist || 32, 48);
    const blacklist = new Set();
    const visited = new Set();
    const wantStart = countItems(bot, want);
    let banked = 0, dug = 0, lost = 0, rescans = 0, torches = 0, saidTorch = false;
    const torchState = {};
    let stoppedBecause = 'complete';
    ctx.progress(0, count, want[0] || target);
    ctx.setPhase('scanning', `Mining ${count}x ${target}. Best tool out, off I go.`);

    const scan = () => bot.findBlocks({ matching: ids, maxDistance: cap, count: Math.max(count * 4, 32) })
      .filter((p) => !blacklist.has(key(p)) && !visited.has(key(p)))
      .filter((p) => args.laneY == null || Math.abs(p.y - args.laneY) <= 2);

    let queue = scan();
    if (!queue.length) throw fatal('not_found', `no ${target} within ${cap} blocks`, 'move the bot (e.g. safeDescend for stone/ores) and restart');

    // tool pre-flight: fail fast instead of hanging on an unharvestable dig
    const probe = bot.blockAt(queue[0]);
    if (probe && idSet.has(probe.type)) {
      const eq = await ctx.equipBestTool(probe);
      if (!eq.canHarvest) {
        throw fatal('no_tool', `no tool that harvests ${probe.name} (holding ${eq.tool || 'nothing'})`, 'craft or fetch the right tool tier, then restart');
      }
    }

    ctx.setPhase('mining');
    while (banked < count) {
      ctx.step();
      const pos = queue.shift();
      if (!pos) {
        if (rescans >= 5) { stoppedBecause = 'exhausted'; break; }
        rescans++;
        ctx.setPhase('rescanning', `Vein dry — scanning for more ${target}.`);
        queue = scan();
        if (!queue.length) { stoppedBecause = 'exhausted'; break; }
        ctx.setPhase('mining');
        continue;
      }
      visited.add(key(pos));
      const b = bot.blockAt(pos);
      if (!b || !idSet.has(b.type)) continue; // stale
      // safety gate: never breach into lava; never dig under a hovering gravity block
      const above = bot.blockAt(pos.offset(0, 1, 0));
      if (above && GRAVITY.has(above.name)) { blacklist.add(key(pos)); continue; }
      let unsafe = false;
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nb = bot.blockAt(pos.offset(d[0], d[1], d[2]));
        if (nb && nb.name === 'lava') { unsafe = true; break; }
      }
      if (unsafe) { blacklist.add(key(pos)); ctx.log(`lava next to ${key(pos)} — skipped`); continue; }

      const r = await ctx.digBlock(pos);
      if (!r.ok) {
        if (r.reason === 'no_tool') throw fatal('no_tool', `tool cannot harvest ${r.block} anymore`, 'tool broke? craft/fetch a replacement and restart');
        blacklist.add(key(pos));
        continue;
      }
      if (!r.already) dug++;

      // torch discipline (2b): every ~7 dug blocks, or sooner if light is low —
      // covers working faces and vein junctions since this fires on every dig.
      if (!r.already) {
        const tr = await ctx.autoTorch(torchState, 7);
        if (tr.placed) {
          torches++;
          if (!saidTorch) { saidTorch = true; ctx.say('Lighting the lane as I go.'); }
        }
      }

      // step onto the drop (vanilla pickup: stand within ~1 block), then verify by inventory delta
      try { await ctx.gotoNear(pos, 1, 10000); } catch (_) {}
      await ctx.sleep(500);
      banked = countItems(bot, want) - wantStart;
      if (banked < dug - lost) {
        await ctx.collectDrops(8, 6000, want);
        banked = countItems(bot, want) - wantStart;
        if (banked < dug - lost) { lost = dug - banked; ctx.log(`drop lost (total ${lost})`); }
      }
      ctx.progress(Math.min(banked, count), count);

      // vein follow: free (no findBlocks) — check all 26 neighbours
      if (args.vein !== false) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          const n = pos.offset(dx, dy, dz);
          const k = key(n);
          if (visited.has(k) || blacklist.has(k)) continue;
          const nb = bot.blockAt(n);
          if (nb && idSet.has(nb.type)) queue.unshift(n);
        }
      }
      if (dug % 8 === 0) await ctx.collectDrops(6, 5000);
    }
    ctx.setPhase('collecting', 'Sweeping up the last drops.');
    await ctx.collectDrops(10, 10000, null);
    banked = countItems(bot, want) - wantStart;
    ctx.progress(Math.min(banked, count), count);
    return { target, want, banked, dug, lost, rescans, torches, stoppedBecause };
  },
  doneMsg: (t) => `Mining done: ${t.result.banked}/${t.progress.total} ${t.result.want[0] || t.result.target} banked (${t.result.dug} dug, ${t.result.torches} torches placed).`,
});

// ---------- huntAnimals ----------
S.define('huntAnimals', {
  description: 'Hunt N animals of given species, attack on the weapon damage cooldown, collect all drops. NEVER targets players.',
  params: { species: "array, e.g. ['cow','pig'] (default ['cow'])", count: 'kills (default 1)', radius: 'search radius (default 32)', anyMob: 'allow non-animal mobs like zombie (default false; players never allowed)' },
  validate: (a, bot) => {
    const sp = a.species || ['cow'];
    if (!Array.isArray(sp) || !sp.length) return 'species must be a non-empty array';
    for (const s of sp) {
      const d = bot.registry.entitiesByName[s];
      if (!d) return `unknown entity '${s}'`;
      if (s === 'player') return 'players are never valid targets';
      if (!a.anyMob && d.type !== 'animal') return `'${s}' is type '${d.type}', not an animal — pass anyMob:true for mobs (players stay forbidden)`;
    }
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const species = new Set(args.species || ['cow']);
    const count = Math.max(1, Math.min(16, args.count || 1));
    const radius = Math.min(args.radius || 32, 64);
    const blacklistIds = new Set();
    let killed = 0, swings = 0;

    // hard player-safety invariant, re-checked before EVERY swing
    const isTarget = (e) => Boolean(e && e.isValid !== false && !e.username && e.name !== 'player'
      && e.id !== bot.entity.id && species.has(e.name) && !blacklistIds.has(e.id));

    // weapon: best sword > best axe > bare hand; attack on the vanilla damage cooldown
    const tiers = ['netherite', 'diamond', 'iron', 'stone', 'copper', 'golden', 'wooden'];
    let weapon = null;
    for (const kind of ['_sword', '_axe']) {
      for (const t of tiers) {
        weapon = bot.inventory.items().find((i) => i.name === t + kind);
        if (weapon) break;
      }
      if (weapon) break;
    }
    if (weapon) { try { await withTimeout(bot.equip(weapon, 'hand'), 5000, 'equip_timeout'); } catch (_) {} }
    const held = bot.heldItem ? bot.heldItem.name : '';
    let speed = 4; // bare hand / everything else
    if (/sword$/.test(held)) speed = 1.6;
    else if (/_axe$/.test(held)) speed = /^(wooden|stone)/.test(held) ? 0.8 : (/^iron/.test(held) ? 0.9 : 1.0);
    else if (/pickaxe$/.test(held)) speed = 1.2;
    else if (/shovel$/.test(held)) speed = 1.0;
    const cooldownMs = Math.round(1000 / speed);

    ctx.progress(0, count, 'kills');
    ctx.setPhase('hunting', `Hunting ${count}x ${[...species].join('/')}. Nothing personal.`);
    while (killed < count) {
      ctx.step();
      const me = bot.entity.position;
      const t = Object.values(bot.entities).filter(isTarget)
        .filter((e) => e.position && e.position.distanceTo(me) <= radius)
        .sort((a, b2) => a.position.distanceTo(me) - b2.position.distanceTo(me))[0];
      if (!t) {
        if (killed === 0) throw fatal('not_found', `no ${[...species].join('/')} within ${radius} blocks`, 'move closer to animals or widen radius, then restart');
        break;
      }
      // dynamic follow goal — tracks a fleeing mob (GoalFollow never "completes"; we own the loop)
      try { bot.pathfinder.setGoal(new goals.GoalFollow(t, 2), true); } catch (_) {}
      const t0 = Date.now();
      try {
        while (bot.entities[t.id] && t.isValid !== false && Date.now() - t0 < 20000) {
          ctx.step();
          const d = t.position.distanceTo(bot.entity.position);
          if (d <= 3.2) {
            try { await bot.lookAt(t.position.offset(0, (t.height || 1) * 0.9, 0), true); } catch (_) {}
            if (isTarget(t)) { bot.attack(t); swings++; } // player-safety re-check at the swing
            await new Promise((r) => setTimeout(r, cooldownMs));
          } else {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      } finally {
        try { bot.pathfinder.setGoal(null); } catch (_) {}
      }
      if (!bot.entities[t.id] || t.isValid === false) {
        killed++;
        ctx.progress(killed, count);
        ctx.setPhase('looting', `${killed} of ${count} down. Grabbing the drops.`);
        await ctx.collectDrops(10, 12000);
        if (killed < count) ctx.setPhase('hunting');
      } else {
        blacklistIds.add(t.id); // fled/unreachable — try another
        ctx.log(`target ${t.name}#${t.id} escaped — blacklisted`);
      }
    }
    return { killed, of: count, swings, blacklisted: blacklistIds.size };
  },
  doneMsg: (t) => {
    const haul = Object.entries(t.collected).map(([k, v]) => `${v} ${k}`).join(', ');
    return `Hunt over: ${t.result.killed}/${t.result.of} kills. Haul: ${haul || 'nothing'}`;
  },
});

// ---------- depositToChest ----------
S.define('depositToChest', {
  description: 'Deposit inventory into a chest/barrel (keeps tools/armor/food by default). Announces a DEPOT ledger line.',
  params: { pos: 'optional {x,y,z} of the chest (else: nearest chest within 32)', keep: 'extra item names to keep', keepTools: 'bool (default true)', items: 'optional whitelist: deposit ONLY these item names' },
  validate: (a) => {
    if (a.pos && ![a.pos.x, a.pos.y, a.pos.z].every((n) => typeof n === 'number')) return 'pos must be {x,y,z} numbers';
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    let chest = null;
    if (args.pos) {
      chest = bot.blockAt(new Vec3(args.pos.x, args.pos.y, args.pos.z));
      if (!chest || !CONTAINERS.has(chest.name)) {
        throw fatal('not_found', `no chest at ${args.pos.x},${args.pos.y},${args.pos.z} (found ${chest ? chest.name : 'unloaded'})`, 'check the coordinates (DEPOT.md) and restart');
      }
    } else {
      chest = bot.findBlock({ matching: blockIds(bot, [...CONTAINERS]), maxDistance: 32 });
      if (!chest) throw fatal('not_found', 'no chest/barrel within 32 blocks', 'pass pos:{x,y,z} (see DEPOT.md) or place a chest');
    }
    ctx.setPhase('travelling', 'Dropping off the loot at the chest.');
    // GoalNear can stall forever in partial-path recalc when the spots around a
    // cluttered chest are unstandable — fall back to a look-at goal (seen live).
    try { await ctx.gotoNear(chest.position, 2, 25000); }
    catch (_) {
      await ctx.retry('walk to chest', () => ctx.gotoSee(chest.position, 25000), 2);
    }
    const eyeDist = chest.position.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.6, 0));
    if (eyeDist > 4.5) throw fatal('unreachable', 'cannot get within reach of the chest', 'clear the approach or pick another chest');

    const keepSet = new Set(args.keep || []);
    const keepTools = args.keepTools !== false;
    const keepPred = (it) => keepSet.has(it.name)
      || (keepTools && /(_pickaxe|_axe|_shovel|_hoe|_sword|shears|bucket|flint_and_steel|shield|elytra|totem_of_undying)$/.test(it.name))
      || (keepTools && /(_helmet|_chestplate|_leggings|_boots)$/.test(it.name))
      || (keepTools && /^(torch|copper_torch|soul_torch|crafting_table)$/.test(it.name))
      || (keepTools && /^(cooked_|bread$|golden_apple|baked_potato)/.test(it.name));

    ctx.setPhase('depositing');
    // openBlock has NO internal timeout — a blocked/protected chest would hang forever
    const win = await withTimeout(bot.openContainer(chest), 8000, 'chest_open_timeout');
    const moved = {};
    let chestFull = false;
    const skipped = [];
    try {
      const plan = win.items().filter((it) => (args.items ? args.items.includes(it.name) : !keepPred(it)));
      for (const it of plan) {
        ctx.step();
        try {
          await win.deposit(it.type, null, it.count); // count REQUIRED: null means 1, not "all"
          moved[it.name] = (moved[it.name] || 0) + it.count;
        } catch (e) {
          if (/destination full/i.test(e.message)) { chestFull = true; break; }
          if (/can't find/i.test(e.message)) { skipped.push(it.name); continue; }
          throw e;
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    } finally {
      try { win.close(); } catch (_) {}
    }
    const total = Object.values(moved).reduce((a, b2) => a + b2, 0);
    if (total > 0) {
      // DEPOT.md rule: chat is the shared ledger
      ctx.say(('DEPOT ' + Object.entries(moved).map(([k, v]) => `+${v} ${k}`).join(' ')).slice(0, 140));
    }
    return {
      chest: { x: chest.position.x, y: chest.position.y, z: chest.position.z, name: chest.name },
      moved, totalMoved: total, skipped, chestFull, freeSlotsAfter: bot.inventory.emptySlotCount(),
    };
  },
  doneMsg: (t) => (t.result.chestFull
    ? `Chest is full — deposited ${t.result.totalMoved} items, the rest stays with me.`
    : `Deposited ${t.result.totalMoved} items, kept my gear.`),
});

// ---------- safeDescend ----------
S.define('safeDescend', {
  description: 'Dig a 45-degree staircase down to a target Y. Never digs straight down; stops at lava/voids; places torches if held.',
  params: { toY: 'target Y (required)', dir: "'north'|'south'|'east'|'west' (default: facing)", torchEvery: 'steps between torches (default 8)', maxSteps: 'cap (default 128)', minY: 'hard floor (default -59)' },
  validate: (a) => (typeof a.toY === 'number' && isFinite(a.toY) ? null : 'need numeric toY'),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const toY = Math.max(args.toY, args.minY ?? -59);
    const maxSteps = Math.min(args.maxSteps || 128, 512);
    const torchEvery = args.torchEvery || 8;
    // direction: arg, or snap the facing to a cardinal (mineflayer yaw 0 = -Z)
    const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    let dx, dz;
    if (args.dir && DIRS[args.dir]) { [dx, dz] = DIRS[args.dir]; }
    else {
      const yaw = bot.entity.yaw;
      const vx = -Math.sin(yaw), vz = -Math.cos(yaw);
      if (Math.abs(vx) >= Math.abs(vz)) { dx = Math.sign(vx) || 1; dz = 0; } else { dx = 0; dz = Math.sign(vz) || 1; }
    }
    const startY = Math.floor(bot.entity.position.y);
    let steps = 0, dug = 0, torches = 0, saidTorch = false;
    const torchState = {};
    let stoppedBecause = 'reached';
    let lastSaidY = startY;
    ctx.progress(0, Math.max(1, startY - toY), 'y-levels');
    ctx.setPhase('descending', `Digging a staircase down to y=${toY}. No straight-down nonsense, promise.`);

    while (steps < maxSteps) {
      ctx.step();
      const F = bot.entity.position.floored();
      if (F.y <= toY) break;
      const ahead = F.offset(dx, 0, dz);
      const aheadHead = ahead.offset(0, 1, 0);
      const down = ahead.offset(0, -1, 0);
      const floorPos = ahead.offset(0, -2, 0);
      // straight-down assertion (geometry never produces it; keep the tripwire anyway)
      for (const p of [aheadHead, ahead, down]) {
        if (p.equals(F.offset(0, -1, 0))) throw fatal('bug', 'refusing to dig straight down', 'report this');
      }
      // hazard scan: 3 forward x 3 wide x 5 tall box
      let lavaSeen = false;
      for (let f = 1; f <= 3 && !lavaSeen; f++) {
        for (let s = -1; s <= 1 && !lavaSeen; s++) {
          for (let y = -2; y <= 2; y++) {
            const p = F.offset(dx * f + (dx ? 0 : s), y, dz * f + (dz ? 0 : s));
            const b = bot.blockAt(p);
            if (b && b.name === 'lava') { lavaSeen = true; break; }
          }
        }
      }
      if (lavaSeen) {
        stoppedBecause = 'lava';
        ctx.say(`Lava ahead near y=${F.y}. Stopping before I become a torch.`);
        break;
      }
      // gravity column above the head hole: open it first, let it settle
      const above = bot.blockAt(aheadHead.offset(0, 1, 0));
      if (above && GRAVITY.has(above.name)) {
        await ctx.digBlock(aheadHead);
        await ctx.sleep(700);
      }
      // floor check: what the bot will stand ON after the step
      const fl = bot.blockAt(floorPos);
      if (fl && (fl.name === 'lava' || HAZARD.has(fl.name))) { stoppedBecause = 'hazard_floor'; break; }
      if (fl && AIR.has(fl.name)) {
        let allAir = true;
        for (let k = 1; k <= 3; k++) {
          const b = bot.blockAt(floorPos.offset(0, -k, 0));
          if (b && !AIR.has(b.name)) { allAir = false; break; }
        }
        if (allAir) { stoppedBecause = 'void_below'; break; } // ravine/cave — do not step into it
      }
      // dig head, body, step-down (digBlock = equip best tool + harvest gate + timeout)
      let blocked = null;
      for (const p of [aheadHead, ahead, down]) {
        const r = await ctx.digBlock(p);
        if (r.ok && !r.already) dug++;
        else if (!r.ok) { blocked = r.reason || 'cannot_dig'; break; }
      }
      if (blocked === 'no_tool') { stoppedBecause = 'no_tool'; break; }
      if (blocked === 'undiggable') { stoppedBecause = 'bedrock'; break; }
      if (blocked) { stoppedBecause = blocked; break; }
      // walk down the step
      try {
        await ctx.goto(new goals.GoalBlock(down.x, down.y, down.z), 10000);
      } catch (_) {
        try { await ctx.goto(new goals.GoalBlock(down.x, down.y, down.z), 8000); }
        catch (_) { stoppedBecause = 'stuck'; break; }
      }
      steps++;
      ctx.progress(startY - Math.floor(bot.entity.position.y), null);
      // torch discipline (2b): shared primitive — floor first, wall fallback,
      // light-level trigger, one-time no_torches warning if the bot is out.
      if (torchEvery > 0) {
        const tr = await ctx.autoTorch(torchState, torchEvery);
        if (tr.placed) {
          torches++;
          if (!saidTorch) { saidTorch = true; ctx.say('Lighting the place up as I go.'); }
        }
      }
      const nowY = Math.floor(bot.entity.position.y);
      if (lastSaidY - nowY >= 16) { lastSaidY = nowY; ctx.say(`Now at y=${nowY}, still digging down.`); }
      if (steps % 32 === 0) await ctx.collectDrops(6, 8000);
    }
    if (steps >= maxSteps && stoppedBecause === 'reached') stoppedBecause = 'max_steps';
    ctx.setPhase('collecting', 'Sweeping the staircase clean.');
    await ctx.collectDrops(8, 10000);
    return { startY, endY: Math.floor(bot.entity.position.y), steps, dug, torches, stoppedBecause };
  },
  doneMsg: (t) => `Staircase done: y=${t.result.startY} -> y=${t.result.endY} in ${t.result.steps} steps (${t.result.stoppedBecause}).`,
});

// ---------- buildSchematic ----------
S.define('buildSchematic', {
  description: 'Build an ordered block placement list (a .schem loaded via POST /blueprint/load, or an inline list), bottom-up, with optional restocking from a supply chest and a block-by-block verify pass.',
  params: {
    blueprint: "name registered by POST /blueprint/load (does NOT survive a process restart — re-POST after ./spawn.sh)",
    placements: 'alternative: inline [{name:"oak_planks",pos:[x,y,z]}, ...] (max 4096)',
    chest: '{x,y,z} supply chest to restock materials from (optional)',
    maxRestocks: 'int, default 3',
    clearSite: 'bool, default false — true lets the builder dig blocks occupying build cells (never PROTECTED infrastructure)',
    skipMissing: 'bool, default false — true reports missing materials instead of failing the task',
  },
  validate: (a, bot) => {
    const hasBp = typeof a.blueprint === 'string' && a.blueprint.length;
    const hasInline = a.placements != null;
    if (hasBp === hasInline) return 'pass exactly one of blueprint (name) or placements (inline array)';
    const ce = validateChestArg(a.chest); if (ce) return ce;
    if (hasBp) {
      const reg = G.__blueprints;
      if (!reg || !reg[a.blueprint]) {
        return `unknown blueprint '${a.blueprint}' (known: ${reg ? Object.keys(reg).join(', ') || 'none' : 'none'}) — POST /blueprint/load first; the registry does NOT survive a runner process restart`;
      }
      return validatePlacements(reg[a.blueprint].placements, bot);
    }
    return validatePlacements(a.placements, bot);
  },
  fn: async (ctx) => {
    const { args } = ctx;
    const bp = args.blueprint ? G.__blueprints[args.blueprint] : null;
    const placements = bp ? bp.placements : args.placements;
    if (bp && Array.isArray(bp.warnings)) for (const w of bp.warnings) pushLog('warn', w);
    return buildCore(ctx, placements, {
      label: args.blueprint || 'inline blueprint',
      chest: args.chest || null,
      maxRestocks: args.maxRestocks,
      clearSite: args.clearSite === true,
      skipMissing: args.skipMissing === true,
    });
  },
  doneMsg: (t) => {
    const r = t.result || {};
    const v = r.verified || {};
    return `Build done: ${r.placed} placed, ${v.ok}/${r.blocks} verified${v.mismatched ? `, ${v.mismatched} off-spec` : ''}${r.restocks ? `, ${r.restocks} restock trip(s)` : ''}.`;
  },
});

// ---------- buildWall ----------
S.define('buildWall', {
  description: 'Build a straight vertical wall, bottom-up, from a corner (or from/to). Human-looking: one material, no gaps. Idempotent, verifies every block.',
  params: { origin: '{x,y,z} bottom corner', width: 'blocks along the wall (default 5, max 24)', height: 'blocks tall (default 3, max 16)', material: "block name, e.g. 'cobblestone'", axis: "'x' or 'z' — which axis the wall extends along (default 'x')", from: 'alternative to origin/width: {x,y,z} one end', to: 'alternative: {x,z} the other end (must share x or z with from)', chest: 'optional {x,y,z} supply chest to restock from', clearSite: 'bool, default true — dig blocks occupying wall cells' },
  validate: (a, bot) => {
    if (!a.material || !bot.registry.itemsByName[itemForBlock(a.material)]) return `unknown material '${a.material}'`;
    const ce = validateChestArg(a.chest); if (ce) return ce;
    try { return validatePlacements(genWall(wallSpec(a)), bot); } catch (e) { return e.message; }
  },
  fn: async (ctx) => {
    const { args } = ctx;
    const placements = genWall(wallSpec(args));
    const r = await buildCore(ctx, placements, {
      label: `${args.material} wall`, chest: args.chest || null,
      maxRestocks: args.maxRestocks, clearSite: args.clearSite !== false, skipMissing: args.skipMissing === true,
    });
    return { ...r, skipped: r.already, failed: r.failedCount, material: args.material };
  },
  doneMsg: (t) => `Wall built: ${t.result.placed} placed, ${t.result.skipped} already there, ${t.result.verified.ok}/${t.result.blocks} verified.`,
});

// ---------- buildFloor ----------
S.define('buildFloor', {
  description: 'Build a flat rectangular floor/platform from a corner (or from/to), row by row. Idempotent, verifies every block.',
  params: { origin: '{x,y,z} one corner (at floor level)', width: 'x-extent (default 5, max 24)', length: 'z-extent (default 5, max 24)', material: 'block name', from: 'alternative: {x,z} one corner', to: 'alternative: {x,z} the opposite corner', y: 'floor Y when using from/to', chest: 'optional {x,y,z} supply chest to restock from', clearSite: 'bool, default true' },
  validate: (a, bot) => {
    if (!a.material || !bot.registry.itemsByName[itemForBlock(a.material)]) return `unknown material '${a.material}'`;
    const ce = validateChestArg(a.chest); if (ce) return ce;
    try { return validatePlacements(genFloor(floorSpec(a)), bot); } catch (e) { return e.message; }
  },
  fn: async (ctx) => {
    const { args } = ctx;
    const placements = genFloor(floorSpec(args));
    const r = await buildCore(ctx, placements, {
      label: `${args.material} floor`, chest: args.chest || null,
      maxRestocks: args.maxRestocks, clearSite: args.clearSite !== false, skipMissing: args.skipMissing === true,
    });
    return { ...r, skipped: r.already, failed: r.failedCount, material: args.material };
  },
  doneMsg: (t) => `Floor laid: ${t.result.placed} placed, ${t.result.skipped} already there, ${t.result.verified.ok}/${t.result.blocks} verified.`,
});

// ---------- frameStructure ----------
S.define('frameStructure', {
  description: 'Build a framed rectangular shell — log corner posts + plank infill on the perimeter, a real doorway gap, optional flat roof and interior floor. This is the TODO-1 "looks like a human built it" primitive.',
  params: {
    origin: '{x,y,z} min corner at ground level', width: 'x-extent (default 5, min 3, max 16)', depth: 'z-extent (default 5, min 3, max 16)', height: 'wall height (default 4, max 12)',
    cornerMaterial: "post material (default 'oak_log')", fillMaterial: "wall infill (default 'oak_planks')",
    doorway: "'north'(z=origin, default) | 'south' | 'east' | 'west' | null — a 1-wide 2-tall gap centered on that wall",
    doorGap: 'legacy alias: false disables the doorway',
    roof: 'bool (fillMaterial roof) or a block name — flat roof at origin.y+height',
    floor: 'optional block name — fills the INTERIOR one block below the walls',
    chest: 'optional {x,y,z} supply chest to restock from', clearSite: 'bool, default true',
  },
  validate: (a, bot) => {
    for (const [k, def] of [['cornerMaterial', 'oak_log'], ['fillMaterial', 'oak_planks']]) {
      const m = a[k] || def;
      if (!bot.registry.itemsByName[itemForBlock(m)]) return `unknown ${k} '${m}'`;
    }
    for (const k of ['roof', 'floor']) {
      if (typeof a[k] === 'string' && !bot.registry.itemsByName[itemForBlock(a[k])]) return `unknown ${k} material '${a[k]}'`;
    }
    const ce = validateChestArg(a.chest); if (ce) return ce;
    if ((a.width || 5) < 3 || (a.depth || 5) < 3) return 'width and depth must be >= 3 (need room for corners + wall)';
    try { return validatePlacements(genFrame(frameSpec(a)), bot); } catch (e) { return e.message; }
  },
  fn: async (ctx) => {
    const { args } = ctx;
    const spec = frameSpec(args);
    const placements = genFrame(spec);
    const r = await buildCore(ctx, placements, {
      label: `${spec.width}x${spec.depth}x${spec.height} framed shell`, chest: args.chest || null,
      maxRestocks: args.maxRestocks, clearSite: args.clearSite !== false, skipMissing: args.skipMissing === true,
    });
    const gapped = spec.doorway === null || spec.doorway === false ? 0 : 2;
    return { ...r, skipped: r.already, failed: r.failedCount, gapped, width: spec.width, depth: spec.depth, height: spec.height };
  },
  doneMsg: (t) => `Frame up: ${t.result.placed} blocks placed (${t.result.gapped} left open for the door), ${t.result.verified.ok}/${t.result.blocks} verified.`,
});

// ---------- buildStaircase ----------
S.define('buildStaircase', {
  description: 'Build a human-looking staircase (real stair blocks, torches, optional side rail) descending to a target Y — the built-structure counterpart to safeDescend (which digs raw stone).',
  params: { origin: 'optional {x,y,z} start (default: current position)', toY: 'target Y, must be below start (required)', dir: "'north'|'south'|'east'|'west' (default: current facing)", material: "stairs block (default 'cobblestone_stairs')", rail: "optional fence-type material for a one-side rail, e.g. 'oak_fence'", torchEvery: 'steps between torches (default 6)', maxSteps: 'cap (default 96)' },
  validate: (a, bot) => {
    if (typeof a.toY !== 'number' || !isFinite(a.toY)) return 'need numeric toY';
    const material = a.material || 'cobblestone_stairs';
    if (!bot.registry.itemsByName[material]) return `unknown material '${material}'`;
    if (!/_stairs$/.test(material)) return 'material must be a *_stairs block';
    if (a.rail && !bot.registry.itemsByName[a.rail]) return `unknown rail material '${a.rail}'`;
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const material = args.material || 'cobblestone_stairs';
    const maxSteps = Math.min(args.maxSteps || 96, 256);
    const torchEvery = args.torchEvery || 6;
    const torchState = {};
    const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    let dx, dz;
    if (args.dir && DIRS[args.dir]) { [dx, dz] = DIRS[args.dir]; }
    else {
      const yaw = bot.entity.yaw;
      const vx = -Math.sin(yaw), vz = -Math.cos(yaw);
      if (Math.abs(vx) >= Math.abs(vz)) { dx = Math.sign(vx) || 1; dz = 0; } else { dx = 0; dz = Math.sign(vz) || 1; }
    }
    const start = args.origin
      ? new Vec3(Math.floor(args.origin.x), Math.floor(args.origin.y), Math.floor(args.origin.z))
      : bot.entity.position.floored();
    const toY = Math.min(args.toY, start.y - 1);
    let steps = 0, placedStairs = 0, placedRail = 0, torches = 0, saidTorch = false;
    let stoppedBecause = 'reached';
    ctx.progress(0, Math.max(1, start.y - toY), 'y-levels');
    ctx.setPhase('building', `Building a staircase down to y=${toY}. Nice and tidy, real stairs this time.`);

    // peter-driver's confirmed floor/wall-eating bug (see buildCore) applies equally
    // here — the single-step ctx.goto below is a short GoalBlock hop right next to a
    // structure the bot is actively placing. canDig=false for the duration; headroom
    // clearing above still works fine since that's an explicit digBlock call, not
    // pathfinder-driven digging.
    const restoreMoves = ctx.enterBuildSafe();
    let pos = start.clone();
    try {
      while (pos.y > toY && steps < maxSteps) {
        ctx.step();
        const stepPos = pos.offset(dx, -1, dz);
        // headroom: clear a 1x2 walkway above the step so the bot (and anyone else) can use it
        for (const clearPos of [pos.offset(dx, 0, dz), pos.offset(dx, 1, dz)]) {
          const b = bot.blockAt(clearPos);
          if (b && !AIR.has(b.name) && b.diggable && !PROTECTED.has(b.name)) await ctx.digBlock(clearPos);
        }
        let r = await ctx.placeBlockAt(stepPos, material);
        if (!r.ok && r.reason === 'no_reference') {
          // likely floating over open air (e.g. into a quarry pit) — lay one support
          // block first so the stair has something solid to attach to, then retry.
          const supportPos = stepPos.offset(0, -1, 0);
          const sb = bot.blockAt(supportPos);
          if (sb && AIR.has(sb.name)) {
            const filler = bot.inventory.items().find((i) => ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone'].includes(i.name));
            if (filler) {
              const sr = await ctx.placeBlockAt(supportPos, filler.name);
              if (sr.ok) r = await ctx.placeBlockAt(stepPos, material);
            }
          }
        }
        if (r.ok && !r.already) placedStairs++;
        else if (!r.ok) {
          stoppedBecause = r.reason === 'no_material' ? 'no_material' : (r.reason || 'blocked');
          break;
        }
        if (args.rail) {
          const railPos = stepPos.offset(dz !== 0 ? 1 : 0, 1, dx !== 0 ? 1 : 0);
          const rr = await ctx.placeBlockAt(railPos, args.rail);
          if (rr.ok && !rr.already) placedRail++;
        }
        try { await ctx.goto(new goals.GoalBlock(stepPos.x, stepPos.y + 1, stepPos.z), 10000); }
        catch (_) { stoppedBecause = 'stuck'; break; }
        pos = stepPos.offset(0, 1, 0);
        steps++;
        ctx.progress(start.y - pos.y, null);
        const tr = await ctx.autoTorch(torchState, torchEvery);
        if (tr.placed) { torches++; if (!saidTorch) { saidTorch = true; ctx.say('Lighting the stairs as I go.'); } }
        if (steps % 16 === 0) await ctx.collectDrops(6, 8000);
      }
    } finally { restoreMoves(); }
    if (steps >= maxSteps && stoppedBecause === 'reached') stoppedBecause = 'max_steps';
    ctx.setPhase('collecting', 'Sweeping the staircase clean.');
    await ctx.collectDrops(8, 10000);
    return { startY: start.y, endY: pos.y, steps, placedStairs, placedRail, torches, stoppedBecause };
  },
  doneMsg: (t) => `Staircase built: y=${t.result.startY} -> y=${t.result.endY} in ${t.result.steps} steps (${t.result.stoppedBecause}), ${t.result.torches} torches.`,
});

G.__skills = S;
return {
  ok: true, installed: `__skills v${ENGINE_VERSION}`, skills: Object.keys(S.registry),
  features: ['queue', 'fallback', 'blueprints'],
  blueprints: { generators: Object.keys(S.blueprints), loaded: G.__blueprints ? Object.keys(G.__blueprints) : [] },
};
