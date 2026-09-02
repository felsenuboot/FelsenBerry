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

const ENGINE_VERSION = 57;
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
  queueLoop: null,           // {items:[{name,args}], maxLoops, loops} — re-seeds the ORIGINAL
                              // item list when it drains, distinct from onEmpty's single
                              // repeating fallback task (issue #24)
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
// Kit preflight (P1.6, research/survival-doctrine.md ss5). Three CUMULATIVE tiers: a task
// that leaves base radius needs `excursion`, anything underground adds `underground`,
// anything below y=0 adds `deep`. Enforced in S.start so a half-kitted bot never departs
// — two of this fleet's three deaths were kit failures discovered at depth, and the user
// rule "8+ torches on ANY excursion" is mechanical here rather than doctrine.
const FOODS = new Set(['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'apple', 'golden_apple',
  'enchanted_golden_apple', 'carrot', 'beetroot', 'melon_slice', 'sweet_berries', 'glow_berries',
  'cookie', 'pumpkin_pie', 'mushroom_stew', 'beetroot_soup', 'rabbit_stew', 'dried_kelp']);
const FILLERS = new Set(['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite',
  'granite', 'deepslate', 'tuff', 'netherrack']);
const KIT_TIERS = {
  excursion: { torches: 8, foodItems: 2, weapon: true },
  // hunt (#45): gate on a WEAPON, not on food. huntAnimals used `excursion`, whose foodItems:2
  // made a foodless bot unable to hunt FOR food — the bootstrap paradox (food is the OUTPUT of
  // hunting, so requiring it first is circular). An ARMED hunter can hunt and thereby feed itself.
  // Torches stay for night-mob safety on the excursion — they are producible and carry no paradox.
  hunt: { torches: 8, weapon: true },
  // sticks + table: the makings of an in-place tool re-craft, carried rather than hoped for
  // (#43 item 1, promoted to phase-1). They are only meaningful where wood is not reachable,
  // so the surface `excursion` tier does not ask for them. The spare pickaxe stays: these
  // ADD a recovery path, they do not buy out a safety requirement.
  //
  // 16 sticks, because sticks are the ONLY scarce input to torch production at depth —
  // produce mines its own coal, but a stick needs wood and there is none down there. The
  // whole point is that a bounded deep-mine is self-sufficient from a CARRIED buffer rather
  // than surface trips: a bot that walks up for wood mid-project is a bot that stops mining,
  // which is precisely how the first sustained run rotted (y51 -> y106, chasing trees,
  // never returning). 16 sticks is 64 torches, and the buffered restock target of 24 is 96,
  // on top of the 2 a tool re-craft costs. It costs 8 planks — two logs — to carry, gathered
  // once at the surface where wood is abundant. Since v38 the tool tier is stone-first, so
  // re-crafts spend cobblestone rather than competing for this.
  underground: { torches: 16, foodItems: 4, weapon: true, picks: 2, filler: 16, sticks: 16, table: 1 },
  deep: { torches: 40, foodItems: 8, weapon: true, picks: 2, filler: 16, sticks: 16, table: 1, armor: true, shield: true, water: true },
};
const TOOL_LOW_PCT = 20; // preflight durability gate (status warns at 15% mid-task)
// findBlocks' maxDistance is a 3D SPHERE, so an unconstrained scan happily selects ore
// far BELOW the bot and walks it down a ravine. That is how CAVECREW lost Grog (y89->y26,
// full kit) WITH safe movements already applied — maxDropDown stops the lethal fall, not
// the 'descended legitimately, then stranded and mobbed at the bottom' death.
// (research/cavecrew-delta-2.md ss3.2)
const MAX_BELOW = 5;   // default: never select a target more than this far under our feet
// ...and the same bound has to exist ABOVE. MAX_BELOW alone is one-sided, which reads as
// "don't chase it down a ravine" and silently means "any height is fine". Measured: a bot at
// y73 inside a cave, needing wood for a pickaxe, passed twelve trees at y113 through the
// filter, spent 36s failing to path to each in turn, and reported "no wood in reach" — a
// reachability failure wearing a supply failure's name. A canopy or a hillside is worth a
// look; the surface seen from inside a cave is a different journey, and one the caller must
// decide on deliberately rather than discover by timeout.
const MAX_ABOVE = 10;
// --- movement DETECTION layer (#53) ---
// A new best distance-to-goal is what "progress" means; anything less is thrashing.
const PROGRESS_EPS = 0.5;
// how far past a goal's own range still counts as arrived. Generous on purpose: this is a
// backstop against "resolved 40 blocks away", not a second opinion on the goal's geometry.
const ARRIVE_SLACK = 2.5;
// Generous enough for a real detour, tight enough to be worth having. Calibration: the
// observed wedges ran ~21s and a goto timeout is 20-30s, so a 20s window would fire barely
// before the timeout and buy nothing. At 15s the recovery ladder gets a real window to act
// in. Against that, a legitimate detour has to go 15s — roughly 60 blocks of sprinting —
// without ONCE coming 0.5m closer than its previous best, which a path around a structure
// essentially never does.
const NO_PROGRESS_MS = 15000;
// Where is this goal, in blocks? mineflayer's goal types are plain objects with x/y/z on
// most variants, so read defensively and return null when there is nothing to measure —
// a watchdog that invents a position would be worse than one that abstains.
function goalPos(goal) {
  try {
    if (!goal || typeof goal.x !== 'number' || typeof goal.z !== 'number') return null;
    // GoalXZ / GoalNearXZ have no y; measure in the plane the goal actually cares about by
    // borrowing the bot's own y, so a legitimately-high bot is not scored as "far".
    const y = typeof goal.y === 'number' ? goal.y : null;
    return { x: goal.x, y, z: goal.z };
  } catch (_) { return null; }
}
// distance from a position to a goal, in the GOAL'S OWN metric (ignore y when the goal does)
function goalDistance(pos, gp) {
  const dx = pos.x - gp.x, dz = pos.z - gp.z;
  if (gp.y == null) return Math.sqrt(dx * dx + dz * dz);
  const dy = pos.y - gp.y;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
// R2 (#54) recovery-candidate search, pure. Same discipline as the moveDetect hooks (#53):
// "a rule testable only by staging the bug does not stay tested" — this is the piece of
// _reposition that decides WHERE to go, extracted so a fixture can replay it against a
// synthetic grid instead of needing a genuinely wedged live bot. Order matters (first match
// wins) and is exposed as REPOSITION_OFFSETS so a fixture can assert the actual priority,
// not just that SOME candidate was found.
const REPOSITION_OFFSETS = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]];
function findRepositionTarget(bx, by, bz, blockAt, isProtectedFn) {
  for (const [dx, dz] of REPOSITION_OFFSETS) {
    for (let y = by + 1; y >= by - 3; y--) {
      const below = blockAt(bx + dx, y - 1, bz + dz);
      const feet = blockAt(bx + dx, y, bz + dz);
      const head = blockAt(bx + dx, y + 1, bz + dz);
      if (below && below.boundingBox === 'block' && feet && feet.boundingBox === 'empty'
          && head && head.boundingBox === 'empty' && !isProtectedFn(below.position, below.name)) {
        return { dx, dz, y, x: bx + dx + 0.5, z: bz + dz + 0.5 };
      }
    }
  }
  return null;
}
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
// #10: mineflayer's generic bot.openContainer only understands the chest FAMILY — calling it
// on a furnace throws "containerToOpen is neither a block nor an entity" (furnaces open
// through the separate bot.openFurnace). Every engine skill already gates its own chest access
// behind CONTAINERS.has(), so none of them hit this — the two live reports (bernd-driver,
// marcel-driver) both came from hand-rolled /eval scripts calling bot.openContainer directly
// on a furnace, with no engine helper to route it correctly. This is that helper, for any
// future skill or driver script (smelting, #59) that needs to open EITHER family generically.
const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);
async function openContainerAuto(bot, block) {
  return FURNACES.has(block.name) ? bot.openFurnace(block) : bot.openContainer(block);
}
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

    // Settle after a state-changing action (equip / place / dig / activate / craft) before the
    // next action or a verifying blockAt read. NOT just cosmetic latency: bot.heldItem updates
    // client-side the instant an equip resolves, but the SERVER has not necessarily applied it,
    // so an action fired immediately after can race the equip and act with the PREVIOUS held
    // item or a stale inventory view. friedrich-driver lost ~30 oak_log rediscovering this the
    // hard way — a place/activate/dig right after equip silently no-op'd or voided the item, and
    // the fix that finally held was a short settle after EVERY such action, EQUIP INCLUDED (not
    // only between place/activate/dig, and not the crafting-only 800ms rule). Default ~2-3 ticks;
    // pass more (300-800ms) before trusting a confirming read (blockAt right after place/dig is
    // unreliable in both directions — karl-driver). Never bring it up as a manual driver step;
    // skills and hand-rolled loops call this so the discipline is the default, not tribal lore.
    async settle(ms = 120) { ctx.step(); await new Promise((r) => setTimeout(r, ms)); ctx.step(); },

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
          try { const m = MET(); if (m && m.retry) m.retry(); } catch (_) {}
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
      const _m = MET();
      if (_m && _m.gotoStart) _m.gotoStart(goal, timeoutMs);
      let _res = 'error', _afail = false;
      ctx.step();
      const t0 = Date.now();
      const gotoP = bot.pathfinder.goto(goal);
      const settled = gotoP.then(() => ({ done: true }), (err) => ({ err }));
      // PROGRESS watchdog (#53), not a MOVEMENT watchdog. The old rule reset its timer
      // whenever the bot displaced 0.4 blocks, which a bot thrashing in place does
      // continuously — so it only ever caught FROZEN bots, never oscillating ones. The
      // field signature it missed is on record: `pf:{partial:416}` with zero successes,
      // ~17 blocks moved, going nowhere, ten times in a row. That bot was moving the whole
      // time. So the question is not "am I moving" but "am I getting closer", and the
      // answer is a new BEST distance to the goal: a thrashing bot never sets one, and
      // neither does a frozen one, so one rule catches both.
      // Falls back to raw displacement only when the goal exposes no position to measure
      // against (some goal types do not), which is strictly the old behaviour.
      let lastPos = bot.entity.position.clone();
      let lastMove = Date.now();
      let lastProgress = Date.now();
      let dBest = Infinity;
      const gp = goalPos(goal);
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
            } catch (_) { arrived = true; } // unreadable goal — the distance check below decides
            // Second, independent check on the same claim: how far are we actually from
            // the goal, in the goal's own metric? isEnd is the goal's DEFINITION of arrival
            // and stays primary — but it is introspected from a library object, and when it
            // cannot be read at all the old code defaulted to "arrived", i.e. it trusted a
            // bare promise resolve. That is the false-success shape this codebase keeps
            // finding one layer at a time. So when isEnd is unreadable, distance decides;
            // and when both are readable, a wildly-off distance overrides an isEnd yes.
            let dEnd = null;
            if (gp) dEnd = Math.round(goalDistance(bot.entity.position, gp) * 100) / 100;
            const tol = (typeof goal.range === 'number' ? goal.range
              : (typeof goal.rangeSq === 'number' ? Math.sqrt(goal.rangeSq) : 1)) + ARRIVE_SLACK;
            if (dEnd != null && dEnd > tol) arrived = false;
            if (!arrived) {
              _res = 'no_path'; _afail = true;    // the empty-path false success, caught
              const e = new Error(dEnd == null
                ? 'goto resolved without reaching the goal (empty-path noPath)'
                : `goto resolved ${dEnd} from the goal (tolerance ${Math.round(tol * 100) / 100})`);
              e.code = 'no_path';
              throw e;
            }
            _res = 'arrived';
            return;
          }
          try { ctx.step(); }
          catch (e) { try { bot.pathfinder.setGoal(null); } catch (_) {} throw e; }
          if (Date.now() - t0 > timeoutMs) {
            try { bot.pathfinder.setGoal(null); } catch (_) {}
            _res = 'path_timeout';
            const e = new Error(`path_timeout after ${timeoutMs}ms`);
            e.code = 'path_timeout';
            throw e;
          }
          // TWO independent timers, because there are two failure modes with different
          // honest thresholds — collapsing them into one is how you either miss thrashing
          // or false-alarm on a detour.
          //   FROZEN    — not displacing at all. 6s is plenty; nothing legitimate stands
          //               still that long mid-path.
          //   NO PROGRESS — displacing but never getting closer. This one needs a GENEROUS
          //               window, because routing around a wall or down a spiral staircase
          //               legitimately increases goal distance for a while. 20s is longer
          //               than any real detour here and still well inside the goto timeout,
          //               and it comfortably catches the observed wedge (~21s, going nowhere).
          const p = bot.entity.position;
          const nowMs = Date.now();
          if (p.distanceTo(lastPos) > 0.4) { lastPos = p.clone(); lastMove = nowMs; }
          if (gp) {
            const d = goalDistance(p, gp);
            if (d < dBest - PROGRESS_EPS) { dBest = d; lastProgress = nowMs; }
          } else { lastProgress = lastMove; }   // no measurable goal: displacement is all we have
          const frozenMs = nowMs - lastMove;
          const noProgressMs = nowMs - lastProgress;
          if (frozenMs > 6000 || noProgressMs > NO_PROGRESS_MS) {
            if (unsticks >= 3) {
              try { bot.pathfinder.setGoal(null); } catch (_) {}
              _res = 'stuck';
              // self-describing: "no progress" and "no movement" are different worlds and
              // the recovery ladder (#54) will want to tell them apart.
              const moved = Math.round(bot.entity.position.distanceTo(lastPos) * 10) / 10;
              const e = new Error(frozenMs > 6000
                ? `stuck: no movement for ${Math.round(frozenMs / 1000)}s despite an active path`
                : `stuck: moving but no closer to goal for ${Math.round(noProgressMs / 1000)}s (best ${Math.round(dBest * 10) / 10}, moved ${moved} meanwhile)`);
              e.code = 'stuck';
              throw e;
            }
            unsticks++;
            await ctx._unstick(frozenMs > 6000 ? 'frozen' : 'no_progress');
            lastMove = Date.now(); lastProgress = Date.now();
          }
        }
      } finally {
        try { bot.pathfinder.setGoal(null); } catch (_) {}
        // every exit path (return, throw, Cancelled) runs through here — one span, always closed
        try { const m = MET(); if (m && m.gotoEnd) m.gotoEnd(_res, _afail); } catch (_) {}
      }
    },

    // Physics-wedge recovery: dig no-collision nuisance blocks overlapping the
    // bot's AABB (leaf_litter is the live-confirmed offender) and hop backwards.
    // `why` is the CLASSIFICATION from the watchdog ('frozen' | 'no_progress'), passed to
    // the ledger so the shakeout (#57) can rank the real distribution instead of counting
    // undifferentiated wedges — which is precisely what the recovery ladder (#54) needs to
    // be ordered by. Defaults kept for any caller that does not classify.
    async _unstick(why = 'nuisance') {
      pushLog('info', `movement stalled (${why}) — unsticking (clear the AABB + hop)`);
      try { const m = MET(); if (m && m.unstick) m.unstick(why); } catch (_) {}
      const base = bot.entity.position;
      const cols = new Set();
      for (const ox of [-0.31, 0.31]) for (const oz of [-0.31, 0.31]) {
        cols.add(key(base.offset(ox, 0, oz).floored()));
      }
      for (const k of cols) {
        const [x, y, z] = k.split(',').map(Number);
        for (const dy of [0, 1]) {
          const b = bot.blockAt(new Vec3(x, y + dy, z));
          // ANY diggable no-collision block, not a hardcoded nuisance list (#53). The list
          // was written from one specimen (leaf_litter) and every new offender needed a code
          // change to be recognised — cobwebs, snow layers, fire, sculk vein, powder snow,
          // whatever 1.22 adds next. The property that actually matters is the one that
          // makes a block able to wedge you: it occupies your AABB while not being solid
          // enough to stand on. boundingBox === 'empty' IS that property, so test it
          // directly instead of enumerating its instances.
          // Deliberately NOT digging solid blocks: this fires on a stall, and a stall is not
          // a licence to tunnel through terrain. digguard still vetoes protected positions.
          if (b && b.diggable && b.boundingBox === 'empty' && b.name !== 'air'
              && b.name !== 'cave_air' && b.name !== 'void_air' && !ctx.isProtected(b.position, b.name)) {
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

    // R2 (#54): break off the EXACT wedge cell toward a nearby safe standing cell, so a re-issued
    // path starts from somewhere new. Dead-reckoning on purpose — NOT a sub-goto — so it can never
    // recurse into this same recovery, and bounded to ~1.5s. A safe cell is: a solid floor with
    // two empty cells above (standable), within a couple blocks, not a protected structure.
    // digguard still vetoes any dig; this only walks, it never breaks.
    //
    // Returns {displaced, candidateFound, base, candidate} rather than a bare boolean (engine-dev,
    // FEEDBACK.md #54 2ab0202): a single `displaced:false` was conflating two mechanically distinct
    // failures a natural firing on FrischFriedhelm actually hit (9 identical-looking retries before
    // one finally worked) — findRepositionTarget returning nothing (candidateFound:false, a real
    // geometry dead end) vs a candidate existing but the dead-reckoning walk not covering enough
    // ground in 1.5s (candidateFound:true, displaced:false). `base`/`candidate` carry FULL float
    // precision (not floored) so a run of "identical" wedge attempts can be checked for the third
    // hypothesis — residual sub-block drift from _unstick's own hop-backward meaning consecutive
    // attempts searched from slightly different actual origins despite floor()ing to the same cell.
    async _reposition() {
      const base = bot.entity.position.clone();
      const bx = Math.floor(base.x), by = Math.floor(base.y), bz = Math.floor(base.z);
      const cand = findRepositionTarget(bx, by, bz,
        (x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)); } catch (_) { return null; } },
        (pos, name) => ctx.isProtected(pos, name));
      const baseOut = { x: base.x, y: base.y, z: base.z };
      if (!cand) return { displaced: false, candidateFound: false, base: baseOut, candidate: null };
      const target = new Vec3(cand.x, cand.y, cand.z);
      try {
        await bot.lookAt(target.offset(0, 1.0, 0), true);
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        const t0 = Date.now();
        while (Date.now() - t0 < 1500 && bot.entity.position.distanceTo(target) > 1.2) {
          ctx.step();
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (e) {
        // #54-R2 review fix: everything but Cancelled is swallowed on purpose (this is
        // best-effort dead-reckoning) — but Cancelled is ctx.step()'s preemption sentinel, and
        // eating it here would let a dying reposition finish its 1.5s walk (clearing
        // forward/jump in the finally below only at the END of that walk) instead of yielding
        // immediately to whatever just preempted it, e.g. a survival flee. Same shape as #27.
        if (e && e.cancelled) throw e;
      } finally {
        try { bot.setControlState('forward', false); bot.setControlState('jump', false); } catch (_) {}
      }
      const displaced = bot.entity.position.distanceTo(base) > 1.0;
      return { displaced, candidateFound: true, base: baseOut, candidate: { x: cand.x, y: cand.y, z: cand.z } };
    },

    // gotoR (#54): the ordered recovery WRAPPER around goto. goto already runs R0 (re-verify
    // arrival) and R1 (_unstick x3) internally; when those exhaust it throws `stuck`. gotoR adds
    // R2: reposition off the wedge cell and RE-ISSUE the goto from there, capped. Strictly
    // additive — a non-`stuck` failure (no_path, timeout, Cancelled) re-throws unchanged, and once
    // R2 is exhausted it throws the same `stuck` goto already would have. R6 relog / R7 tp are the
    // agenda+runner rungs above this and are not this function's job.
    //
    // CRITICAL (eng-2's #53-author review point): the TOTAL wall-clock is bounded to timeoutMs, so
    // R2's retries fit INSIDE the caller's budget rather than multiplying it. Without this, each
    // retry resets #53's watchdog timers and time-to-give-up becomes ~3x the window + 3x the goto
    // timeout — a 30s caller sitting 90s+, which would overrun caps sized for the old behaviour
    // (the agenda's 180s ACT_TIMEOUT force-releasing an act mid-flight; restock's HAUL legs). It
    // also stops multiplying #53's CALIBRATED-not-proven no-progress window by the retry count. So
    // R2 gets its retries only when the budget has room; it NEVER stretches the contract.
    async gotoR(goal, timeoutMs = 30000, r2Max = 2) {
      const deadline = Date.now() + timeoutMs;
      for (let attempt = 0; ; attempt++) {
        const remaining = deadline - Date.now();
        try {
          // TEST-ONLY fault injection (#54 R2 live proof). Staging a genuine wedge on synthetic
          // geometry was tried and documented as falsified five separate ways (FEEDBACK.md,
          // 2026-09-02) — the engine will not wedge on invented terrain, which says the
          // recovery ladder is sound, not that it's proven. Team-lead's re-scoped standard:
          // inject only the TRIGGER, keep the RESOLUTION entirely real. Armed externally via
          // `globalThis.__r2Fault = {armed:true}` (a /eval call, before starting a goto-driving
          // skill); consumed one-shot the instant it's read, so a bug that re-enters this
          // branch on a later attempt shows up as a SECOND real episode, not silent reuse.
          // Guarded on a global nothing production-facing ever sets — zero behaviour change
          // unless a fixture deliberately arms it.
          //
          // #38 DOCTRINE, load-bearing: the last test hook of this exact shape (survival.js's
          // `drill()`, a `pickOverride` parameter) was silently broken for its ENTIRE LIFE — it
          // was captured but never called, so every historical claim built on it (including
          // #38's own original bug report) was unknowingly exercising unrelated live
          // conditions. A hook that cannot prove it fired manufactures false confidence, which
          // is worse than no hook. So this one writes `globalThis.__r2FaultProof` as the
          // episode unfolds — armed/fired/reposition/retry, each with its own timestamp and
          // real outcome — and a fixture MUST read that back and assert on it, not trust that
          // arming succeeded because the code looks right.
          if (attempt === 0 && G.__r2Fault && G.__r2Fault.armed) {
            const p = bot.entity.position;
            G.__r2Fault = null;   // one-shot: consumed before the throw, not after
            G.__r2FaultProof = { firedAt: Date.now(), attempt,
              posAtFire: { x: p.x, y: p.y, z: p.z }, goal: goalPos(goal),
              reposition: null, retry: null };
            const e = new Error('R2 fault-injection: forced stuck (test-only, #54 proof)');
            e.code = 'stuck'; e.injected = true;
            throw e;
          }
          const r = await ctx.goto(goal, Math.max(1, remaining));
          if (G.__r2FaultProof && G.__r2FaultProof.retry == null && attempt > 0) {
            G.__r2FaultProof.retry = { ok: true, arrivedAt: Date.now() };
          }
          return r;
        }
        catch (e) {
          // propagate unchanged on a non-stuck failure, exhausted retries, or too little budget
          // left for a meaningful retry (a fresh attempt needs room to reach `stuck` again).
          if ((e && e.code) !== 'stuck' || attempt >= r2Max || (deadline - Date.now()) < 4000) {
            if (G.__r2FaultProof && G.__r2FaultProof.retry == null && attempt > 0) {
              G.__r2FaultProof.retry = { ok: false, code: e && e.code, message: e && e.message, at: Date.now() };
            }
            throw e;
          }
          // best-effort; retry the goto regardless (a fresh A* from here may route even if we
          // barely moved). Reposition BEFORE logging/emitting so `displaced` reports what
          // actually happened, not what was about to be attempted — lets metrics.mjs score
          // eng-2's #54-review prediction (the re-issued A*, not the reposition, is the win)
          // by splitting retry outcomes on displaced=true vs false.
          const rep = await ctx._reposition();
          const { displaced, candidateFound, base: repBase, candidate: repCandidate } = rep;
          if (G.__r2FaultProof && G.__r2FaultProof.reposition == null) {
            const p = bot.entity.position;
            G.__r2FaultProof.reposition = { displaced, candidateFound, at: Date.now(), posAfter: { x: p.x, y: p.y, z: p.z } };
          }
          const why = displaced ? '' : (candidateFound ? ' (candidate found, walk fell short)' : ' (no candidate found)');
          pushLog('info', `recovery R2 (attempt ${attempt + 1}/${r2Max}): reposition${why} + re-issue (${Math.round((deadline - Date.now()) / 1000)}s budget left)`);
          try {
            const m = MET();
            if (m && m.recovery) {
              const fields = { displaced, candidateFound, base: repBase, candidate: repCandidate };
              m.recovery('R2', attempt + 1, Boolean(e && e.injected) ? Object.assign(fields, { injected: true }) : fields);
            }
          } catch (_) {}
        }
      }
    },
    // Long-haul travel (movement-engines ss2.7). One A* over 200+ blocks of broken terrain
    // does not finish inside the think budget, and the far chunks are not loaded so the
    // geometry is literally unknown — that, not the movement engine, is why long hauls fail.
    // So: walk it in ~80-block legs. Each leg is a small fully-loaded search that finishes
    // in well under a second, and the NEXT waypoint is re-snapped after every leg because
    // by then its chunks have loaded.
    //
    // Ground-snapping refuses to guess: blockAt returns null past loaded chunks, and a
    // waypoint invented inside solid rock or over a ravine is worse than none. When the snap
    // fails we hand the leg to GoalNearXZ and let Y sort itself out on arrival.
    async gotoFar(target, opts = {}) {
      const legLength = Math.max(16, Math.min(opts.legLength || 80, 128));
      const range = opts.range == null ? 1 : opts.range;
      const timeoutMs = opts.timeoutMs || 240000;
      const legTimeout = opts.legTimeoutMs || 45000;
      const tgt = new Vec3(Math.floor(target.x), Math.floor(target.y), Math.floor(target.z));
      const dXZ = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
      const t0 = Date.now();
      const legs = [];

      // first standable y at (x,z): solid floor, two empty cells above, nothing nasty
      const snap = (x, z, fromY) => {
        for (let y = fromY + 8; y >= fromY - 20; y--) {
          const below = bot.blockAt(new Vec3(x, y - 1, z));
          const feet = bot.blockAt(new Vec3(x, y, z));
          const head = bot.blockAt(new Vec3(x, y + 1, z));
          if (!below || !feet || !head) continue;              // unloaded — never guess
          if (below.boundingBox !== 'block') continue;
          if (feet.boundingBox !== 'empty' || head.boundingBox !== 'empty') continue;
          if (HAZARD.has(below.name) || HAZARD.has(feet.name) || HAZARD.has(head.name)) continue;
          return y;
        }
        return null;
      };

      if (dXZ(bot.entity.position, tgt) <= legLength) {
        await ctx.gotoNear(tgt, range, Math.min(timeoutMs, 60000));
        return { legs: 0, direct: true };
      }
      const restore = ctx.enterHaul();
      try {
        let poor = 0, guard = 0;
        while (guard++ < 64) {
          ctx.step();
          const here = bot.entity.position;
          const remain = dXZ(here, tgt);
          if (remain <= legLength) break;
          if (Date.now() - t0 > timeoutMs) {
            throw fatal('path_timeout', `gotoFar exceeded ${Math.round(timeoutMs / 1000)}s with ${Math.round(remain)} blocks to go`,
              'raise timeoutMs, or break the trip into explicit waypoints');
          }
          const f = legLength / remain;
          const wx = Math.floor(here.x + (tgt.x - here.x) * f);
          const wz = Math.floor(here.z + (tgt.z - here.z) * f);
          const wy = snap(wx, wz, Math.floor(here.y));
          const before = remain;
          let how = wy == null ? 'xz' : 'ground';
          try {
            if (wy == null) await ctx.goto(new goals.GoalNearXZ(wx, wz, 6), legTimeout);
            else await ctx.goto(new goals.GoalNear(wx, wy, wz, 2), legTimeout);
          } catch (e) { how += ':' + (e.code || 'err'); }
          const gained = before - dXZ(bot.entity.position, tgt);
          legs.push({ to: [wx, wy, wz], how, gained: Math.round(gained) });
          // two legs in a row that barely move = wedged or walled off; stop burning time
          if (gained < 10) {
            if (++poor >= 2) {
              throw fatal('no_progress', `two consecutive legs gained under 10 blocks (${Math.round(dXZ(bot.entity.position, tgt))} still to go)`,
                'the route is blocked — reposition the bot or pick an intermediate waypoint by hand');
            }
          } else poor = 0;
        }
        // Final approach. The caller's Y is usually a guess — a long haul is aimed at an XZ
        // and whatever ground is there. A GoalNear to a Y that turns out to be inside rock
        // or hanging in air makes pathfinder search exhaustively and time out: measured, a
        // 223-block haul walked 207 blocks cleanly and then died with path_Timeout at 21
        // blocks out purely because the target Y was wrong. So re-snap the destination now
        // that its chunks are loaded, and if even that fails, settle for the right XZ.
        const left = Math.max(20000, timeoutMs - (Date.now() - t0));
        const finalTimeout = Math.min(left, 90000);
        const snappedY = snap(tgt.x, tgt.z, Math.floor(bot.entity.position.y));
        const dest = snappedY == null ? tgt : new Vec3(tgt.x, snappedY, tgt.z);
        let arrived = true;
        try {
          await ctx.gotoNear(dest, range, finalTimeout);
        } catch (e) {
          arrived = false;
          try {
            await ctx.goto(new goals.GoalNearXZ(tgt.x, tgt.z, Math.max(range, 3)), Math.min(45000, finalTimeout));
            arrived = true;
          } catch (e2) {
            throw fatal(e.code || 'no_path', `final approach failed ${Math.round(dXZ(bot.entity.position, tgt))} blocks out: ${e.message}`,
              'the destination may not be standable — aim at reachable ground, or raise range');
          }
        }
        return { legs: legs.length, detail: legs.slice(-8), snappedFinalY: snappedY,
          finalVia: arrived && snappedY != null ? 'ground' : 'xz',
          distXZ: Math.round(dXZ(bot.entity.position, tgt)),
          elapsedS: Math.round((Date.now() - t0) / 1000) };
      } finally { try { restore(); } catch (_) {} }
    },

    async gotoNear(p, range = 1, timeoutMs = 30000) {
      return ctx.gotoR(new goals.GoalNear(p.x, p.y, p.z, range), timeoutMs);   // #54: R0-R2 recovery
    },
    // NEVER goals.GoalBreakBlock — broken in pathfinder 2.4.5 (bad ctor args + isEnd).
    async gotoSee(p, timeoutMs = 20000) {
      return ctx.gotoR(new goals.GoalLookAtBlock(new Vec3(p.x, p.y, p.z), bot.world, { reach: 4.0 }), timeoutMs);   // #54: R0-R2 recovery
    },
    // #70: is `p` actually pathable-to RIGHT NOW — by the SAME planner the real goto will use? A
    // getPathTo probe (a path SEARCH, no movement) so a skill/relocate can DROP a target it has no
    // route to BEFORE committing a goto (the no_path churn: MettMarcel's harvestGrass + relocate,
    // BuddelBernd's mineLane, all gotoNear-ing across a barrier).
    //
    // TWO things the reconnect-#2 diagnostic forced, both "the checker must match the executor":
    //  1. STRICT success only. A getPathTo 'partial' means gotoNear CANNOT reach the goal (only part
    //     way), and a gotoNear to a partial-only GoalNear throws no_path — so a partial is NOT
    //     reachable for anything we intend to walk to. Accepting partials (the old minPartial=12) is
    //     exactly what made relocateToWork issue 4 no_path gotos while reporting ok.
    //  2. Probe with ctx.goto's WORK profile, NOT the ambient bot.pathfinder.movements. The executor
    //     swaps WORK in (protection-aware exclusions + dig knobs) for the actual path; probing the
    //     ambient profile could plan through camp/base blocks WORK excludes and pass a target the
    //     real goto then no_paths. Cached per task (protected regions don't move mid-task).
    // getPathTo IS a real search, so callers MUST bound how many they probe (nearest-few, not a scan).
    reachable(p, range = 2, timeoutMs = 2000) {
      try {
        if (!ctx._reachMoves) {
          ctx._reachMoves = (G.__movementProfiles && typeof G.__movementProfiles.WORK === 'function')
            ? G.__movementProfiles.WORK(bot) : bot.pathfinder.movements;
        }
        return bot.pathfinder.getPathTo(ctx._reachMoves, new goals.GoalNear(p.x, p.y, p.z, range), timeoutMs).status === 'success';
      } catch (_) { return false; }
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
    // Is this block registered as protected base infrastructure (protected.json, via the
    // digguard payload)? Target SELECTION must consult this, not just bot.dig: digguard
    // rejects the dig cheaply, but a skill that keeps picking a protected block still
    // burns a full goto + stall-recovery ladder per attempt (the chopTrees-vs-torch_posts
    // grind — posts are logs on cobblestone, i.e. valid trunk bases). Fails OPEN (false)
    // when digguard is not installed, so behavior is unchanged without it.
    isProtected(pos, blockName) {
      try {
        const dg = globalThis.__digguard;
        if (!dg || typeof dg.hit !== 'function') return false;
        const name = blockName || (bot.blockAt(pos) || {}).name;
        return Boolean(dg.hit(pos, name));
      } catch (_) { return false; }
    },

    // Is harvesting allowed at this position? (aesthetic geofence, protected.json)
    harvestAllowed(pos, kind = 'chopTrees') { return S.harvestAllowed(pos, kind); },

    // Acquire the right tool before working: equip -> depot -> craft. Skills call this up
    // front so a task never starts wrong-handed; toolguard enforces the same rule at the
    // dig itself for anything that bypasses a skill.
    async ensureTool(spec, opts = {}) {
      ctx.step();
      const r = await S.ensureTool(bot, spec, opts);
      if (r.ok) { if (r.how !== 'held') ctx.log(`tool ${r.how}: ${r.item}`); }
      else ctx.log(`tool acquisition failed for ${r.need && r.need.want}: ${(r.steps || []).join(' | ')}`);
      return r;
    },

    // one batch per call, settle + count-verify between each — see S.craftSafe
    async craftSafe(itemName, times = 1, opts = {}) {
      ctx.step();
      const r = await S.craftSafe(bot, itemName, times, opts);
      if (r.made) ctx.log(`crafted ${r.made} ${itemName} in ${r.calls} batch${r.calls === 1 ? '' : 'es'}`);
      if (!r.ok || r.reason) ctx.log(`craftSafe ${itemName}: ${r.reason || 'ok'}`);
      return r;
    },

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
      // #D: PERSISTENT across sweeps. A drop embedded in terrain is unreachable every sweep, and the
      // per-call attempts map reset each time — so collectDrops re-chased it forever (BuddelBernd:
      // 34 no_path gotos to a stray item at ~[11,91,67], never reaching mineLane). Blacklist the
      // unroutable CELL (position is stable; entity ids churn) for a while so later sweeps skip it.
      const bl = (S._dropBlacklist = S._dropBlacklist || new Map());
      const blKey = (pos) => `${pos.x},${pos.y},${pos.z}`;
      for (const [k, exp] of bl) if (exp < t0) bl.delete(k);   // expire stale entries (terrain may change)
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
          if (bl.has(blKey(e.position.floored()))) return false;   // #D: known-unreachable cell
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
        // #D: probe reachability BEFORE the goto — never emit a no_path goto to an embedded drop.
        if (p.offset(0.5, 0.5, 0.5).distanceTo(me.offset(0, 1.6, 0)) > 3 && !ctx.reachable(p, 1)) {
          bl.set(blKey(p), Date.now() + 5 * 60000); attempts.set(e.id, 2); unreachable++; continue;
        }
        try { await ctx.gotoNear(p, 1, 12000); }
        catch (_) {
          attempts.set(e.id, (attempts.get(e.id) || 0) + 1);
          if (attempts.get(e.id) >= 2) { bl.set(blKey(p), Date.now() + 5 * 60000); unreachable++; }
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
    // The profile functions also mutate PLANNER SCALARS on bot.pathfinder itself
    // (thinkTimeout / tickTimeout / searchRadius / enablePathShortcut) — those live on the
    // pathfinder, not on the Movements object, so swapping movements back does NOT restore
    // them. Measured: after a restock the bot kept thinkTimeout 25000 and searchRadius -1
    // permanently, meaning every later WORK/CAVE task inherited HAUL's unlimited search
    // instead of WORK's deliberate 64-block "fail fast and honestly" budget. Snapshot and
    // restore them alongside the movements.
    enterHaul() {
      let prev = null;
      const pf = bot.pathfinder;
      const scalars = pf ? { thinkTimeout: pf.thinkTimeout, tickTimeout: pf.tickTimeout,
        searchRadius: pf.searchRadius, enablePathShortcut: pf.enablePathShortcut } : null;
      try {
        if (G.__movementProfiles && typeof G.__movementProfiles.HAUL === 'function') {
          prev = bot.pathfinder.movements || null;
          bot.pathfinder.setMovements(G.__movementProfiles.HAUL(bot));
        }
      } catch (e) { pushLog('warn', 'enterHaul: movements not applied: ' + e.message); }
      return () => {
        try { if (prev) bot.pathfinder.setMovements(prev); } catch (_) {}
        try { if (scalars) Object.assign(bot.pathfinder, scalars); } catch (_) {}
      };
    },

    // #10: open a furnace OR a chest-family block correctly (see openContainerAuto above —
    // mineflayer's bot.openContainer throws on furnaces). Skills built on this ctx (e.g. a
    // future smelting skill, #59) should call this instead of bot.openContainer directly.
    openContainerAuto(block) { return openContainerAuto(bot, block); },

    // Withdraw a shopping list from a chest/barrel. needs = {itemName: count}.
    // Returns {got:{}, short:{}} — never throws except Cancelled/fatal(not_found).
    // Every quirk guard from depositToChest applies: GoalNear->GoalLookAtBlock travel
    // ladder, an 8s race on openContainer (which has NO internal timeout), and an
    // EXPLICIT count on every withdraw (count:null moves 1 item, not the stack).
    async withdrawFromChest(chestPos, needs) {
      const wanted = Object.entries(needs || {}).filter(([, n]) => n > 0);
      if (!wanted.length) return { got: {}, short: {} };
      let cp = new Vec3(Math.floor(chestPos.x), Math.floor(chestPos.y), Math.floor(chestPos.z));
      try { await ctx.gotoNear(cp, 2, 25000); }
      catch (_) { await ctx.retry('walk to supply chest', () => ctx.gotoSee(cp, 25000), 2); }
      let chest = bot.blockAt(cp);
      if (!chest || !CONTAINERS.has(chest.name)) {
        // stale coord — Felix may have nudged the depot chest. Re-find nearby (deterministic
        // scan), walk to it, and use that instead of throwing not_found. (#76)
        const moved = resolveContainer(bot, cp, { types: CONTAINERS, reach: true });
        if (moved && !moved.equals(cp)) {
          ctx.log(`depot chest at ${cp.x},${cp.y},${cp.z} is stale — re-resolved to ${moved.x},${moved.y},${moved.z}`);
          cp = moved;
          try { await ctx.gotoNear(cp, 2, 25000); }
          catch (_) { await ctx.retry('walk to moved supply chest', () => ctx.gotoSee(cp, 25000), 2); }
          chest = bot.blockAt(cp);
        }
      }
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
      // #69 gap 1: log the visit even when nothing came back (a chest that had none of what
      // was asked is still a real transaction attempt, same doctrine as craft/taskRejected
      // never dropping the zero case).
      try { const m = MET(); if (m && m.chest) m.chest('withdraw', [cp.x, cp.y, cp.z], got); } catch (_) {}
      return { got, short };
    },
  };
  return ctx;
}


// ---------- false-success assertions (EVALUATION.md ss4.6) ----------
// These live HERE, next to the registry and away from every skill's fn, on purpose: an
// assertion that lives inside the code it judges is worthless the moment that code is the
// thing that's lying. Each is a pure function of (task, bot) run once after task.done is
// set. `yield` is continuous so partial credit is measurable without a binary verdict.
// A skill with no entry yields null and is simply excluded from yield KPIs.
const ASSERTS = {
  come: (task, bot) => {
    const a = task.args || {};
    if (typeof a.x !== 'number') return null;
    const p = bot.entity && bot.entity.position;
    if (!p) return null;
    // Compare BLOCK to BLOCK, the same way GoalNear defines arrival. A bot standing on
    // block y has an entity position of y+1 (the top surface), so measuring the float
    // position against an integer block target charged ~1.0 of phantom distance to every
    // call and could fail a bot that was standing exactly where it was asked to. That is a
    // unit mismatch, not a miss — and the fix keeps genuine misses failing: the specimens
    // that produced this were 2.8 and 3.4 blocks out, which still exceed the limit.
    const f = p.floored();
    const d = Math.sqrt((f.x - a.x) ** 2 + (f.y - a.y) ** 2 + (f.z - a.z) ** 2);
    const limit = (a.range == null ? 1 : a.range) + 1.5;
    // `come` returns no result object, so final position is the ONLY ground truth —
    // which is exactly how ctx.goto's empty-path noPath used to report success.
    //
    // The rule string carries the numbers because the ledger deliberately does NOT store
    // call coordinates (SALIENT.come keeps only `range`), which left the first five
    // real specimens undiagnosable: "come.arrived failed" with no way to tell a genuine
    // non-arrival from an over-tight tolerance. Note what is NOT done here — the limit is
    // not loosened to make the alarm quieter. Widening a verifier until it stops
    // complaining is how a false-success metric becomes decorative.
    const r2 = Math.round(d * 100) / 100;
    return { rule: `come.arrived(d=${r2},limit=${limit})`, fail: d > limit,
      want: 1, got: d <= limit ? 1 : 0, yield: d <= limit ? 1 : 0 };
  },
  safeDescend: (task) => {
    const r = task.result; if (!r) return null;
    const want = Math.max(1, (r.startY || 0) - (task.args && task.args.toY != null ? task.args.toY : r.endY || 0));
    const got = (r.startY || 0) - (r.endY || 0);
    // the documented 96-steps-for-one-level staircase
    return { rule: 'safeDescend.netDescent', fail: got < 2 && (r.steps || 0) > 8, want, got, yield: want > 0 ? Math.min(1, got / want) : null };
  },
  buildStaircase: (task) => ASSERTS.safeDescend(task),
  mineLane: (task) => {
    const r = task.result; if (!r) return null;
    const want = (task.args && task.args.count) || 8;
    const got = r.banked || 0;
    return { rule: 'mineLane.banked', fail: got === 0 && (r.dug || 0) > 0, want, got, yield: want > 0 ? Math.min(1, got / want) : null };
  },
  chopTrees: (task) => {
    const r = task.result; if (!r) return null;
    const want = (task.args && task.args.count) || 1;
    const got = r.treesFelled || 0;
    return { rule: 'chopTrees.felled', fail: got === 0 && (r.logsDug || 0) > 0, want, got, yield: want > 0 ? Math.min(1, got / want) : null };
  },
  relocateToWork: (task) => {
    const r = task.result; if (!r) return null;
    // #C: a relocate that moved NOWHERE is not a success — grade it a miss so the ledger/playcheck
    // don't read a 0m boxed relocate as productive (the outcome:ok-despite-relocated-0m false success).
    return { rule: 'relocateToWork.moved', fail: !r.relocated, want: 1, got: r.relocated ? 1 : 0, yield: r.relocated ? 1 : 0 };
  },
  huntAnimals: (task) => {
    const r = task.result; if (!r) return null;
    const want = (task.args && task.args.count) || 1;
    const got = r.killed || 0;
    return { rule: 'huntAnimals.killed', fail: got === 0 && (r.swings || 0) > 3, want, got, yield: want > 0 ? Math.min(1, got / want) : null };
  },
  collectDrops: (task) => {
    const r = task.result; if (!r) return null;
    // best-effort by contract — never punish an honest sweep that found nothing
    const want = (r.picked || 0) + (r.unreachable || 0);
    return { rule: 'collectDrops.bestEffort', fail: false, want, got: r.picked || 0, yield: want > 0 ? (r.picked || 0) / want : null };
  },
  // #85: `want` read `r.offered`, which no version of this skill has ever set (git history
  // confirms it — the ONE hit for "offered" was this reader), so `want` was always null and
  // every depositToChest task has been silently ungraded since this rule was written. Also
  // `got` read `r.moved`, the PER-ITEM breakdown object, not a count — `got === 0` and
  // `got / want` both misbehave against `{}`. Fixed on both sides: the skill now returns
  // `offered` (what the deposit had a chance to move), and `got` reads `r.totalMoved` (the
  // count already sitting on the result, same one `produce`/`huntAnimals` use in this table).
  depositToChest: (task) => {
    const r = task.result; if (!r) return null;
    const want = r.offered != null ? r.offered : null;
    const got = r.totalMoved != null ? r.totalMoved : null;
    if (want == null || got == null) return null;
    return { rule: 'depositToChest.moved', fail: got === 0 && want > 0, want, got, yield: want > 0 ? Math.min(1, got / want) : null };
  },
  // produce (producer.js) is graded here because this table is the one place a verdict is
  // reached by something that did not do the work. It matters more than most: the agenda's
  // whole self-sufficiency claim rests on produce, and RESTOCK currently believes it on the
  // strength of `made > 0` alone.
  //
  // `made` is produce's OWN before/after arithmetic, so re-reading it would just be taking
  // the skill's word twice. The independent facts are what the bot is holding NOW, and the
  // contract itself:
  //   - a claim to have made N must be backed by N in the bag (a full inventory that ate the
  //     drops, or a miscount, both surface here);
  //   - ok:true with made:0 contradicts produce's stated contract (ok means made > 0), and a
  //     contract that quietly stops holding is exactly the kind of rot this table exists for.
  // A partial (made < count) is NOT a failure — produce is documented as partial-success and
  // the ladder acts on the progress — so it lands in `yield`, which is where an honest
  // shortfall belongs.
  produce: (task, bot) => {
    const r = task.result; if (!r) return null;
    const want = (task.args && task.args.count) || null;
    const made = r.made || 0;
    const name = task.args && task.args.resource;
    let held = null;
    try {
      if (bot && name) held = bot.inventory.items().filter((i) => i.name === name).reduce((a, i) => a + i.count, 0);
    } catch (_) {}
    const unbacked = held != null && made > 0 && held < made;
    const contradiction = Boolean(r.ok) && made <= 0;
    return { rule: `produce.made(${name || '?'},made=${made}${held == null ? '' : ',held=' + held})`,
      fail: unbacked || contradiction, want, got: made,
      yield: want > 0 ? Math.min(1, made / want) : null };
  },
};
const buildAssert = (task) => {
  const r = task.result; if (!r || r.blocks == null) return null;
  const ok = r.verified && r.verified.ok != null ? r.verified.ok : null;
  if (ok == null) return null;
  // the build skills already verify with blockAt — free ground truth, so use it
  return { rule: 'build.verified', fail: ok < r.blocks, want: r.blocks, got: ok, yield: r.blocks > 0 ? ok / r.blocks : null };
};
for (const k of ['buildWall', 'buildFloor', 'frameStructure', 'buildSchematic']) ASSERTS[k] = buildAssert;

// Exported so the AGENDA judges project completion with the SAME verifier the telemetry
// ledger uses. Two independent notions of "done" would drift, and the whole point of the
// ASSERTS table is that success is graded by something other than the code being graded.
S.assertTask = (task, b) => runAssert(task, b || S._lastBot);

// Test hooks for the movement DETECTION layer (#53). Pure functions over plain objects, so
// the wedge cases can be replayed against synthetic goals and positions instead of staging a
// genuinely stuck bot — which is the only reason the previous watchdog's blind spot survived
// so long: it could only be exercised by reproducing a wedge in the world.
S.moveDetect = {
  goalPos, goalDistance, PROGRESS_EPS, ARRIVE_SLACK, NO_PROGRESS_MS,
  // would the watchdog call this a stall? Replays a position series against a goal and
  // returns the moment progress stopped, exactly as ctx.goto scores it.
  progress(goal, samples) {
    const gp = goalPos(goal);
    let dBest = Infinity, lastMove = 0, lastProgress = 0, lastPos = null, moved = 0;
    for (const smp of samples) {
      const p = { x: smp.x, y: smp.y, z: smp.z };
      const step = lastPos ? Math.hypot(p.x - lastPos.x, p.y - lastPos.y, p.z - lastPos.z) : 0;
      if (step > 0.4) lastMove = smp.t;
      if (gp) {
        const d = goalDistance(p, gp);
        if (d < dBest - PROGRESS_EPS) { dBest = d; lastProgress = smp.t; }
      } else { lastProgress = lastMove; }
      moved += step;
      lastPos = p;
    }
    const last = samples.length ? samples[samples.length - 1].t : 0;
    const frozenMs = last - lastMove, noProgressMs = last - lastProgress;
    return { measuredBy: gp ? 'goal-distance' : 'displacement',
      dBest: dBest === Infinity ? null : Math.round(dBest * 100) / 100,
      frozenMs, noProgressMs, stalledMs: Math.max(frozenMs, noProgressMs),
      totalMoved: Math.round(moved * 10) / 10,
      reason: frozenMs > 6000 ? 'frozen' : (noProgressMs > NO_PROGRESS_MS ? 'no_progress' : null),
      stalled: frozenMs > 6000 || noProgressMs > NO_PROGRESS_MS };
  },
  // would _unstick dig this block? The property test, without a world.
  wouldClear(block) {
    return Boolean(block && block.diggable && block.boundingBox === 'empty'
      && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air');
  },
};

// Test hooks for the movement RECOVERY layer (#54, R2). Same discipline as moveDetect above:
// findRepositionTarget is pure (an accessor function stands in for bot.blockAt), so a fixture
// can replay _reposition's cell-selection against a synthetic local grid — proving the search
// picks the right cell in the right priority order — without a live bot or a genuinely wedged
// world. It proves the CANDIDATE SEARCH is correct; it does not and cannot prove that walking
// to that cell actually resolves a real pathfinder wedge, which needs a live bot (see FEEDBACK).
S.recoveryDetect = {
  offsets: REPOSITION_OFFSETS.map((o) => o.slice()),
  findRepositionTarget,
};

// #10: exposed for driver hand-eval scripts (both live reports came from those, not from an
// engine skill) — `__skills.openContainerAuto(bot, block)` opens a furnace OR a chest-family
// block correctly instead of a raw bot.openContainer that throws on the former.
S.openContainerAuto = openContainerAuto;

// The kit tier table, exported so the AGENDA can aim its maintenance rungs at the SAME
// requirement the departure gate enforces. Without this the ladder's idea of "I have a
// pickaxe" (one, working) silently disagreed with the gate's ("two, underground"), and a
// project could be refused forever by a shortfall no rung was trying to fix.
S.kitTiers = () => JSON.parse(JSON.stringify(KIT_TIERS));

function runAssert(task, bot) {
  try {
    const f = ASSERTS[task.name];
    if (typeof f !== 'function') return null;
    const r = f(task, bot);
    if (!r) return null;
    return { rule: r.rule, fail: Boolean(r.fail), want: r.want == null ? null : r.want,
      got: r.got == null ? null : r.got, yield: r.yield == null ? null : Math.round(r.yield * 1000) / 1000 };
  } catch (_) { return null; }        // a broken assertion must never fail a real task
}
const MET = () => { try { return globalThis.__metrics; } catch (_) { return null; } };

// ---------- task runner ----------
// _q is ENGINE-INTERNAL ({qid,runId} for a queued item, {fallback,quiet} for an
// onEmpty sweep). Drivers, task.sh and DRIVER_GUIDE never pass it.
// craftSafe(bot, itemName, times, opts) -> {ok, made, calls, reason, table}
// THE crafting primitive. Never call bot.craft in a loop directly:
//   - bot.craft(recipe, N) does NOT reliably produce N batches. Measured live: a call with
//     N=2 on a torch recipe (result.count 4) produced 4 torches, not 8. The requested
//     count is not a promise, so this crafts ONE batch per call and counts what arrived.
//   - crafting back-to-back without a settle desyncs the window and VOIDS items — a driver
//     lost 15 batches of planks that way and collectDrops found nothing to recover.
// So: one batch per call, 800ms settle, inventory re-count after every single craft, and
// abort the moment a craft produces nothing or an ingredient loss doesn't add up.
// opts: {table: Vec3|null (default: search 4 blocks), settleMs (default 800)}
// ---------- right tool, always: resolution + acquisition ----------
// toolguard.js enforces at the bot.dig choke point; this is the other half — GETTING the
// tool. Deliberately not inside toolguard: acquisition needs travel, chests and a crafting
// table, and a bare monkey-patch must never call pathfinder (same reasoning that keeps
// reachguard from auto-approaching).
const TIER_RANK = { netherite: 6, diamond: 5, iron: 4, stone: 3, copper: 2.5, golden: 2, wooden: 1 };
const TOOL_CLASS_RE = /_(pickaxe|axe|shovel|hoe|sword)$/;
const toolClassOf = (n) => { const m = TOOL_CLASS_RE.exec(n || ''); return m ? m[1] : null; };
const toolTierOf = (n) => TIER_RANK[String(n || '').split('_')[0]] || 0;

// Resolve what a block (or a bare class name) demands. Prefers toolguard's resolver when
// it's installed so the two halves can never disagree about what "the right tool" means.
function needSpec(bot, spec) {
  try {
    if (!spec) return null;
    if (typeof spec === 'object' && spec.cls) return { cls: spec.cls, required: spec.required ? new Set(spec.required) : null };
    const s = String(spec);
    if (/^(pickaxe|axe|shovel|hoe|sword)$/.test(s)) return { cls: s, required: null };
    const tg = globalThis.__toolguard;
    if (tg && typeof tg.need === 'function') {
      const n = tg.need(s);
      return n ? { cls: n.cls, required: n.required ? new Set(n.required) : null } : null;
    }
    const def = bot.registry.blocksByName[s];
    if (!def || def.hardness === 0) return null;
    let required = null;
    if (def.harvestTools) {
      required = new Set(Object.keys(def.harvestTools).map((id) => (bot.registry.items[id] || {}).name).filter(Boolean));
      if (!required.size) required = null;
    }
    const m = /^mineable\/(\w+)$/.exec(def.material || '');
    const cls = m ? m[1] : (required ? toolClassOf([...required][0]) : null);
    return (cls || required) ? { cls, required } : null;
  } catch (_) { return null; }
}
const satisfiesNeed = (name, need) => {
  if (!name) return false;
  if (need.required) return need.required.has(name);
  return need.cls ? toolClassOf(name) === need.cls : true;
};
function bestOwned(bot, need) {
  let best = null, score = -1;
  for (const it of bot.inventory.items()) {
    if (!satisfiesNeed(it.name, need)) continue;
    const s = toolTierOf(it.name) + (toolClassOf(it.name) === need.cls ? 10 : 0);
    if (s > score) { best = it; score = s; }
  }
  return best;
}
// cheapest craftable tool that satisfies the need — never craft iron for a job wood can do
function cheapestSatisfying(need) {
  const tiers = ['wooden', 'stone', 'iron', 'diamond'];
  for (const t of tiers) {
    const name = `${t}_${need.cls}`;
    if (satisfiesNeed(name, need)) return name;
  }
  return need.cls ? `stone_${need.cls}` : null;
}
// The tier the bot can pay for RIGHT NOW, out of what it is already carrying.
//
// cheapestSatisfying chooses by price, so it always answers "wooden" and then goes looking
// for wood. Underground that is exactly backwards: wood is the expensive material down
// there, and the cobblestone the kit already requires is sitting in the bag. Measured: a bot
// at y73 in a cave, no pickaxe, 58 cobblestone held, spent 36s failing to reach surface
// trees and gave up — while carrying twenty pickaxe heads' worth of stone.
//
// So: before falling back to price, check whether a tier's whole bill (head + sticks +
// table) is already payable from carried stock. If one is, no trip is needed at all. If none
// is, nothing changes and the old behaviour stands. Only wooden and stone are bootstrappable
// (craftToolChain's own constraint), and the tiers stay in cheap-first order so a bot that
// can afford both still spends the cheaper material.
// Pure form: decides from an ITEM LIST, so the choice can be replayed against a synthetic
// inventory instead of whatever the bot happens to be holding. This bug cost a soak run, and
// a rule that cannot be tested without staging a live bot will not stay tested.
function tierFrom(items, need, tableInReach) {
  const count = (n) => items.filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
  // Planks of DIFFERENT WOODS do not combine into one tool head. Summing them across types
  // is how the soak deadlocked: a bot holding oak_planks:1 + acacia_planks:2 scored a plank
  // stock of 3, was told a wooden pickaxe was affordable, crafted ZERO, and never fell
  // through to the stone pickaxe it could have made instantly from 297 carried cobblestone.
  // So affordability is measured in the LARGEST SINGLE TYPE, which is what a recipe can
  // actually consume. Logs are counted per-species for the same reason.
  // (Found by engine-dev-3, from the run's terminal inventory.)
  const bySpecies = {};
  for (const it of items) {
    const p = /^(.*)_planks$/.exec(it.name);
    if (p) { bySpecies[p[1]] = (bySpecies[p[1]] || 0) + it.count; continue; }
    const l = /^(.*)_log$/.exec(it.name);
    if (l) bySpecies[l[1]] = (bySpecies[l[1]] || 0) + it.count * 4;
  }
  const plankStock = Object.values(bySpecies).reduce((m, n) => Math.max(m, n), 0);
  // a 3x3 tool recipe needs a table; without one in reach it costs 4 more planks to make
  const tableCost = tableInReach ? 0 : 4;
  const stickCost = count('stick') >= 2 ? 0 : 2;          // 2 planks -> 4 sticks
  // MOST DURABLE affordable tier, not cheapest. Cheapest-first is the wrong economy for a
  // bot that works underground: wood is the scarce material down there and cobblestone is a
  // KIT FLOOR it already carries, so a wooden pickaxe both wastes the scarce resource and
  // wears out in 59 blocks, sending the bot back to the surface for more wood. That surface
  // treadmill is what stopped the soak sustaining. Stone costs material the bot is standing
  // on and lasts more than twice as long. If stone is not affordable the loop still falls
  // back to wooden, which is the right answer on the surface with no cobblestone.
  const affordable = [];
  for (const t of ['stone', 'wooden']) {
    const name = `${t}_${need.cls}`;
    if (!satisfiesNeed(name, need)) continue;
    const headPlanks = t === 'wooden' ? 3 : 0;
    if (t === 'stone' && count('cobblestone') < 3) continue;
    if (plankStock >= headPlanks + stickCost + tableCost) affordable.push(name);
  }
  return affordable[0] || null;
}
function payableTier(bot, need) {
  let inReach = false;
  try {
    inReach = bot.inventory.items().some((i) => i.name === 'crafting_table')
      || Boolean(bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 }));
  } catch (_) {}
  return tierFrom(bot.inventory.items(), need, inReach);
}
// Test hook, mirroring the agenda's injectable-snapshot rule: every input the decision reads
// comes in as an argument, so a fixture can hand it a synthetic inventory. Pure, no side
// effects. `items` are {name, count} objects; `need` is {cls} or a spec string.
S.tierFor = (need, items, tableInReach) =>
  tierFrom(items || [], needSpec(S._lastBot, need) || { cls: String(need), required: null }, Boolean(tableInReach));
// Every bootstrappable tier this bot could pay for right now, most durable first — so a
// craft that yields nothing can fall through to the next one instead of giving up. Same
// deadlock: the answer was in the bag the whole time, one tier down the list.
function payableTiers(bot, need) {
  const out = [];
  const seen = new Set();
  let n = payableTier(bot, need);
  while (n && !seen.has(n)) { out.push(n); seen.add(n); n = payableTierExcluding(bot, need, seen); }
  return out;
}
function payableTierExcluding(bot, need, exclude) {
  const count = (n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
  for (const t of ['stone', 'wooden']) {
    const name = `${t}_${need.cls}`;
    if (exclude.has(name) || !satisfiesNeed(name, need)) continue;
    if (t === 'stone' && count('cobblestone') < 3) continue;
    return name;                 // affordability of the head is re-checked by the craft itself
  }
  return null;
}

// Bounded goto for the acquisition path. A raw bot.pathfinder.goto() never times out —
// the first live ensureTool run hung indefinitely on one, stalling the whole chain with
// two logs in the bag. Always clear the goal on the way out so the loser can't poison the
// next call (same reasoning as ctx.goto's owned-token handling).
async function gotoT(bot, x, y, z, range = 2, ms = 20000) {
  let timer;
  try {
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('goto_timeout')), ms); }),
    ]);
    return true;
  } catch (e) {
    try { bot.pathfinder.setGoal(null); } catch (_) {}
    return false;
  } finally { clearTimeout(timer); }
}

// ---- harvest geofence (laws -> gates) ----
// Replaces the behavioural "gather >= 25 blocks from the plaza" rule with an engine gate,
// per the determinism codicil: a per-action check must never live in a driver's habits.
// Purely AESTHETIC — keeping the base's treescape intact. The safety half (never fell a
// structure's logs) is ctx.isProtected's job and is unrelated. Horizontal distance only,
// so mining under the base is unaffected, and appliesTo scopes it so a deliberate
// driver-issued mineLane at quarry_lane_1 is not gated.
let _hxCache = { at: 0, zones: [] };
function harvestZones() {
  if (Date.now() - _hxCache.at < 10000) return _hxCache.zones;      // cheap: config, not world
  const cfg = readCfg();
  _hxCache = { at: Date.now(), zones: Array.isArray(cfg.harvestExclusion) ? cfg.harvestExclusion : [] };
  return _hxCache.zones;
}
S.harvestAllowed = function (pos, kind = 'chopTrees') {
  try {
    for (const z of harvestZones()) {
      if (Array.isArray(z.appliesTo) && !z.appliesTo.includes(kind)) continue;
      if (z.kind === 'cylinder') {
        const dx = pos.x - z.center[0], dz = pos.z - z.center[2];
        if (dx * dx + dz * dz <= z.radius * z.radius) return false;
      } else if (z.kind === 'box') {
        if (pos.x >= z.min[0] && pos.x <= z.max[0] && pos.y >= z.min[1]
          && pos.y <= z.max[1] && pos.z >= z.min[2] && pos.z <= z.max[2]) return false;
      }
    }
  } catch (_) {}
  return true;                                                       // fail OPEN
};

// ensureTool(bot, spec) -> {ok, how, item, steps[], error}
// spec: a block name ('stone'), a tool class ('axe'), or {cls, required[]}.
// Chain: hold/equip -> depot withdrawal -> craft -> acquisition_failed.
S.ensureTool = async function (bot, spec, opts = {}) {
  const steps = [];
  const need = needSpec(bot, spec);
  if (!need) return { ok: true, how: 'not_needed', steps };

  // 1. already in the bag. opts.spare skips this: the underground kit wants a BACKUP
  // pickaxe, and "you already hold one" is the wrong answer to "get me a second" — it made
  // the agenda's TOOL rung latch forever on a requirement it kept reporting as satisfied.
  const owned = opts.spare ? null : bestOwned(bot, need);
  if (owned) {
    if (!bot.heldItem || bot.heldItem.name !== owned.name) {
      try { await bot.equip(owned, 'hand'); } catch (e) { /* held is close enough */ }
      return { ok: true, how: 'equipped', item: owned.name, steps };
    }
    return { ok: true, how: 'held', item: owned.name, steps };
  }

  const cfg = readCfg();
  // what it can pay for out of the bag beats what is cheapest on paper — see payableTier
  const payable = payableTier(bot, need);
  const want = payable || cheapestSatisfying(need);
  if (payable) steps.push('tier:payable:' + payable);

  // 2. depot withdrawal — the fleet banks spares; use them before burning fresh wood
  if (opts.depot !== false && cfg.depot) {
    for (const chestKey of ['minerals', 'wood']) {
      const c = cfg.depot[chestKey];
      if (!Array.isArray(c)) continue;
      try {
        const got = await ctxlessWithdrawTool(bot, new Vec3(c[0], c[1], c[2]), need);
        steps.push(`depot:${chestKey}:${got ? got : 'none'}`);
        if (got) {
          const it = bot.inventory.items().find((i) => i.name === got);
          if (it) { try { await bot.equip(it, 'hand'); } catch (_) {} }
          say(bot, `DEPOT -1 ${got}`);
          return { ok: true, how: 'depot', item: got, steps };
        }
      } catch (e) { steps.push(`depot:${chestKey}:${String(e.message).slice(0, 40)}`); }
    }
  }

  // 3. craft it — trying EVERY tier this bot can pay for, most durable first, not just the
  // one that looked best up front. A craft can yield nothing for reasons the affordability
  // check cannot see (the mixed-plank case that deadlocked the soak was exactly this: the
  // bill said yes, the recipe said no), and giving up then strands a bot that is carrying
  // the materials for the next tier down. One attempt per tier — this escalates, it does
  // not retry, so a genuinely unmakeable tool still fails fast.
  if (opts.craft !== false && want) {
    const tiers = [want, ...payableTiers(bot, need).filter((t) => t !== want)];
    for (const tier of tiers) {
      try {
        const r = await craftToolChain(bot, tier, cfg, steps);
        if (r.ok) {
          const it = bot.inventory.items().find((i) => i.name === tier);
          if (it) { try { await bot.equip(it, 'hand'); } catch (_) {} }
          return { ok: true, how: 'crafted', item: tier, steps };
        }
        steps.push('craft:' + r.reason);
      } catch (e) { steps.push('craft:' + String(e.message).slice(0, 60)); }
      if (tiers.length > 1) steps.push('escalate:' + tier + '->next');
    }
  }

  pushLog('warn', `acquisition_failed: need ${want || need.cls} — ${steps.join(' | ')}`);
  return { ok: false, error: 'acquisition_failed', need: { cls: need.cls, want }, steps };
};

function readCfg() {
  try {
    const fs = process.mainModule.require('fs');
    const np = process.mainModule.require('path');
    return JSON.parse(fs.readFileSync(np.join(np.dirname(process.mainModule.filename), 'protected.json'), 'utf8'));
  } catch (_) { return {}; }
}

// ---------- moved-infra self-heal (#76 resolveContainer) ----------
// Felix relocates base chests/tables/furnaces in-world; the coords registered in
// protected.json (depot{}) and BASE.md then point at air or the wrong block. Crafting
// tables/furnaces already self-heal via findBlock radius scans, but every depot-chest access
// is an exact-cell bot.blockAt(coord) with no nearby search — so a nudged chest throws
// not_found, ensureTool burns fresh wood (depot:none), and the deposit/restock rungs churn.
// resolveContainer re-finds the nearest MATCHING container near a stale coord. Deterministic:
// one bounded findBlocks + taxicab filter, no LLM on any path. The HIT path (the coord still
// holds a matching block — the common case) costs zero scan: only the pre-existing blockAt.
//
// coord: [x,y,z] | Vec3 (the stale/registered coord). opts:
//   types: Set of acceptable block names (default CONTAINERS)
//   tol:   taxicab radius within which a moved block is accepted as "the same" (default 6).
//          Small on purpose — refuses to auto-reassign a chest that moved across the base.
//   reach: prefer a candidate the WORK planner can actually path to (checker == executor)
// Returns a Vec3 (resolved cell) or null (MISSING — genuinely gone / chunk not loaded).
const _infraCache = new Map();   // stale-key -> {pos:Vec3, at:ms}
const _infraLogged = new Set();  // stale-key already reported (one suggested-update line per move)
let _infraReachMoves = null;     // cached WORK Movements for the reach probe (rebuilt lazily)
function _reachOf(bot, p) {
  try {
    if (!_infraReachMoves) {
      _infraReachMoves = (G.__movementProfiles && typeof G.__movementProfiles.WORK === 'function')
        ? G.__movementProfiles.WORK(bot) : bot.pathfinder.movements;
    }
    return bot.pathfinder.getPathTo(_infraReachMoves, new goals.GoalNear(p.x, p.y, p.z, 2), 2000).status === 'success';
  } catch (_) { return false; }
}
function resolveContainer(bot, coord, opts = {}) {
  if (!coord) return null;
  const types = opts.types || CONTAINERS;
  // Base-radius rescan (supervisor directive): Felix relocates the whole base cluster, not
  // just a 1-block nudge, so tol is the tight base cluster (taxicab 8), NOT #76's anti-nudge
  // 4. Beyond it we refuse (log !infra_ambiguous) rather than reassign onto a stranger's
  // chest — CAVECREW's camp is ~60 blocks away, far outside any tol we use here.
  const tol = opts.tol == null ? 8 : opts.tol;
  const c = Array.isArray(coord) ? new Vec3(coord[0], coord[1], coord[2])
    : new Vec3(Math.floor(coord.x), Math.floor(coord.y), Math.floor(coord.z));
  // 1. HIT: the registered cell still holds a matching block — zero scan.
  const at = bot.blockAt(c);
  if (at && types.has(at.name)) return c;
  const key = `${c.x},${c.y},${c.z}`;
  // in-memory cache of a prior resolution (self-heal for the session; #77 write-back deferred)
  const cached = _infraCache.get(key);
  if (cached && Date.now() - cached.at < 30000) {
    const cb = bot.blockAt(cached.pos);
    if (cb && types.has(cb.name)) return cached.pos;
    _infraCache.delete(key);
  }
  // 2. MOVED: bounded scan for the nearest matching block within tol (needs the chunk loaded).
  let ids;
  try { ids = [...types].map((n) => (bot.registry.blocksByName[n] || {}).id).filter((v) => v != null); }
  catch (_) { return null; }
  if (!ids.length) return null;
  let found = [];
  try { found = bot.findBlocks({ point: c, matching: ids, maxDistance: Math.max(tol + 2, 4), count: 32 }); }
  catch (_) { return null; }
  const taxi = (p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) + Math.abs(p.z - c.z);
  const all = found.map((p) => (p instanceof Vec3 ? p : new Vec3(p.x, p.y, p.z))).sort((a, b) => taxi(a) - taxi(b));
  const cands = all.filter((p) => taxi(p) <= tol);
  if (!cands.length) {
    // MISSING or AMBIGUOUS: a matching block exists but only beyond tol — refuse to guess
    // (it may be a stranger's / different-category chest). Caller keeps its own fallbacks.
    if (all.length && !_infraLogged.has(key)) {
      _infraLogged.add(key);
      const n = all[0];
      pushLog('warn', `[infra] !infra_ambiguous ${key}: nearest match ${n.x},${n.y},${n.z} is ${taxi(n)}b away (>${tol}) — not auto-reassigned; update protected.json/BASE.md.`);
    }
    return null;
  }
  // Prefer a candidate the executor can actually reach, so the checker matches the executor
  // (WORK-profile getPathTo, exactly as ctx.reachable). Fail OPEN to nearest if no probe.
  let pos = cands[0];
  if (opts.reach && cands.length > 1) {
    const ok = cands.find((p) => _reachOf(bot, p));
    if (ok) pos = ok;
  }
  _infraCache.set(key, { pos, at: Date.now() });
  if (!_infraLogged.has(key)) {
    _infraLogged.add(key);
    pushLog('warn', `[infra] container registered at ${key} is stale; re-resolved to ${pos.x},${pos.y},${pos.z} `
      + `(moved <=${tol}b). Self-healed in-memory for this session — update protected.json/BASE.md to persist (#77).`);
  }
  return pos;
}

async function ctxlessWithdrawTool(bot, chestPos, need) {
  let cp = chestPos;
  const b = bot.blockAt(cp);
  if (!b || !CONTAINERS.has(b.name)) {
    // the registered depot coord may be stale (Felix moved the chest) — re-find nearby first
    const moved = resolveContainer(bot, cp, { types: CONTAINERS });
    if (moved) cp = moved;
    if (!await gotoT(bot, cp.x, cp.y, cp.z, 2, 25000)) return null;
    // arriving loads the chunk — resolve once more in case the target read as air until then
    if (!CONTAINERS.has((bot.blockAt(cp) || {}).name)) {
      const m2 = resolveContainer(bot, cp, { types: CONTAINERS });
      if (m2) cp = m2;
    }
  }
  const blk = bot.blockAt(cp);
  if (!blk || !CONTAINERS.has(blk.name)) return null;
  if (cp.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.6, 0)) > 4.5) {
    if (!await gotoT(bot, cp.x, cp.y, cp.z, 2, 25000)) return null;
  }
  const win = await withTimeout(bot.openContainer(bot.blockAt(cp)), 8000, 'chest_open_timeout');
  try {
    const hit = win.containerItems()
      .filter((i) => satisfiesNeed(i.name, need))
      .sort((a, b2) => toolTierOf(b2.name) - toolTierOf(a.name))[0];
    if (!hit) {
      try { const m = MET(); if (m && m.chest) m.chest('withdraw', [cp.x, cp.y, cp.z], {}); } catch (_) {}
      return null;
    }
    await win.withdraw(hit.type, null, 1);
    try { const m = MET(); if (m && m.chest) m.chest('withdraw', [cp.x, cp.y, cp.z], { [hit.name]: 1 }); } catch (_) {}
    return hit.name;
  } finally { try { win.close(); } catch (_) {} }
}

// planks -> sticks -> tool, gathering wood (and cobble for stone tier) if needed.
// The bootstrap digs pass {force:true}: logs drop by hand, so toolguard would otherwise
// deadlock us — no axe means no wood means no axe.
async function craftToolChain(bot, want, cfg, steps) {
  const count = (n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
  const anyPlanks = () => bot.inventory.items().find((i) => /_planks$/.test(i.name));
  const tier = String(want).split('_')[0];
  const headMat = tier === 'wooden' ? 'planks' : tier === 'stone' ? 'cobblestone' : null;
  if (!headMat) return { ok: false, reason: `cannot craft ${want} (only wooden/stone tiers are bootstrappable)` };

  // Materials, computed from the real bill rather than guessed. A wooden tool costs 3
  // planks for the head PLUS 2 planks worth of sticks — five planks, not three. Two live
  // runs failed here: the first converted a fixed number of logs and came up short, the
  // second skipped gathering entirely because it already had *some* planks. So: work out
  // the bill, count planks AND the planks still locked up in logs, and only gather when
  // that total can't cover it.
  // Per-SPECIES, and report the largest single stack: planks of different woods do not
  // combine into one tool head, so a cross-type sum overstates what is actually craftable.
  // Same defect as payableTier's, same fix — see the note there for the soak it deadlocked.
  const speciesStock = () => {
    const by = {};
    for (const it of bot.inventory.items()) {
      const p = /^(.*)_planks$/.exec(it.name);
      if (p) { by[p[1]] = by[p[1]] || { planks: 0, logs: 0 }; by[p[1]].planks += it.count; continue; }
      const l = /^(.*)_log$/.exec(it.name);
      if (l) { by[l[1]] = by[l[1]] || { planks: 0, logs: 0 }; by[l[1]].logs += it.count; }
    }
    return by;
  };
  // The one species we will actually build from — everything downstream must agree on it,
  // or the bill is counted against one wood and the craft attempted with another.
  const bestSpecies = () => {
    let best = { name: null, planks: 0, logs: 0, total: 0 };
    for (const [name, v] of Object.entries(speciesStock())) {
      const total = v.planks + v.logs * 4;
      if (total > best.total) best = { name, planks: v.planks, logs: v.logs, total };
    }
    return best;
  };
  const countPlanks = () => bestSpecies().planks;
  const headPlanks = headMat === 'planks' ? 3 : 0;
  // A 3x3 tool recipe needs a crafting table, and if none is in reach we have to craft one —
  // which costs 4 MORE planks. Found live by the agenda's TOOL rung: a bot holding 3 planks
  // and 2 sticks could afford the pickaxe head OR the table but not both, gathered no wood
  // because the bill said it had enough, and failed at the last step. Count the table.
  const tableInReach = () => {
    try {
      if (bot.inventory.items().some((i) => i.name === 'crafting_table')) return true;
      return Boolean(bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 }));
    } catch (_) { return false; }
  };
  const tablePlanks = tableInReach() ? 0 : 4;
  const plankBill = () => headPlanks + tablePlanks + (count('stick') >= 2 ? 0 : 2);
  const plankSupply = () => bestSpecies().total;   // one log = four planks, of ONE species

  if (plankSupply() < plankBill()) {
    const logIds = SPECIES.map((sp) => bot.registry.blocksByName[sp + '_log']).filter(Boolean).map((d) => d.id);
    const myY = Math.floor(bot.entity.position.y);
    const seen = bot.findBlocks({ matching: logIds, maxDistance: 48, count: 12 });
    const found = seen.filter((p) => p.y >= myY - MAX_BELOW && p.y <= myY + MAX_ABOVE);
    if (!found.length) {
      // Say which of the two it is. "No wood in reach" when twelve trees are visible 40
      // blocks overhead sends the reader hunting for a supply bug that isn't there; the
      // caller's real problem is that it is underground and has to have brought the
      // materials with it.
      const dys = seen.map((p) => p.y - myY).sort((a, b) => Math.abs(a) - Math.abs(b));
      const why = seen.length
        ? `${seen.length} logs found but all out of vertical reach (nearest ${dys[0] > 0 ? '+' : ''}${dys[0]}, band -${MAX_BELOW}..+${MAX_ABOVE})`
        : 'no wood in reach';
      return { ok: false, reason: `need ${plankBill()} planks, have ${plankSupply()} worth, and ${why}` };
    }
    // #86 forensics (NacktNorbert/3110, live gear-race run): raw-distance candidates can
    // include ones the bot cannot actually reach (a cliff/gap it can't cross), and every
    // failed gotoT burns its FULL 20s timeout — two unreachable candidates alone cost the
    // ~90s that produced the observed "gather:wood(0/2 reached)" stall. Reuse the SAME
    // checker-matches-executor reachability probe #70 built for relocate targets (~2s
    // getPathTo search, no movement) to try the likely-reachable candidates FIRST — a
    // genuinely unreachable one then costs ~2s to skip instead of 20s to fail at. Never
    // discards a candidate: the probe can be wrong, so an unreachable-per-probe candidate is
    // still tried, just last.
    const probed = found.map((p) => ({ p, ok: _reachOf(bot, p) }));
    const ordered = [...probed.filter((x) => x.ok), ...probed.filter((x) => !x.ok)].map((x) => x.p);
    let reached = 0;
    for (const p of ordered) {
      if (plankSupply() >= plankBill()) break;
      const blk = bot.blockAt(p);
      if (!blk) continue;
      if (!await gotoT(bot, p.x, p.y, p.z, 2, 20000)) continue;
      reached++;
      // bootstrap: logs drop by hand, and toolguard would otherwise deadlock us here —
      // no axe means no wood means no axe. This is the one sanctioned hand-on-log.
      try { await bot.dig(blk, true, { force: true }); } catch (_) {}
      await new Promise((r) => setTimeout(r, 500));
    }
    // record REACHED, not merely attempted: 'gather:wood' followed by 'planks:0' left it
    // ambiguous whether the trip or the crafting was what failed.
    steps.push(`gather:wood(${reached}/${found.length} reached)`);
  }
  // logs -> planks until the bill is covered
  let guard = 0;
  while (guard++ < 10 && countPlanks() < plankBill()) {
    // convert the CHOSEN species' logs. Taking whatever log came first is what produced the
    // mixed oak+acacia stack that made the bill look payable and the recipe refuse.
    const sp = bestSpecies().name;
    const lg = bot.inventory.items().find((i) => /_log$/.test(i.name) && (!sp || i.name === sp + '_log'))
      || bot.inventory.items().find((i) => /_log$/.test(i.name));
    if (!lg) break;
    const r = await S.craftSafe(bot, lg.name.replace(/_log$/, '_planks'), 1);
    if (!r.made) break;
  }
  steps.push(`planks:${countPlanks()}`);
  if (count('stick') < 2) { await S.craftSafe(bot, 'stick', 1); steps.push(`sticks:${count('stick')}`); }
  if (headMat === 'planks' && countPlanks() < 3 + tablePlanks) {
    return { ok: false, reason: `short on planks (${countPlanks()}/${3 + tablePlanks} after sticks${tablePlanks ? ', incl. 4 for a crafting table' : ''}) — need more logs` };
  }
  // the tool itself is a 3x3 recipe: it needs a real crafting table in reach
  const tablePos = Array.isArray(cfg.craftingTable) ? cfg.craftingTable
    : (cfg.depot && Array.isArray(cfg.depot.craftingTable) ? cfg.depot.craftingTable : null);
  // Place a carried table next to us, and report whether it worked.
  //
  // This used to look only at the four lateral cells at foot level, and only ever place on
  // the TOP face of the block beneath them. That is a surface assumption, and underground is
  // where crafting in place actually matters. Measured, in the exact scenario this path
  // exists for: a bot standing in a one-wide gap at y73 had three solid neighbours (spot not
  // air, skipped) and one open neighbour over a drop (nothing beneath to place on, skipped),
  // so it reported "could not place one" while holding a crafting table. A player would have
  // set it against the wall. So: any adjacent solid FACE will do, and head level counts too.
  const FACES = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  // Where WE put a table down, so we can take it back afterwards. Only ever set by our own
  // placement — a table we found (the depot's, a player's) must never be broken.
  let ourTable = null;
  const placeCarriedTable = async () => {
    const ct = bot.inventory.items().find((i) => i.name === 'crafting_table');
    if (!ct) return false;
    const feet = bot.entity.position.floored();
    const cands = [];
    for (const dy of [0, 1]) for (const off of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cands.push(feet.offset(off[0], dy, off[1]));
    for (const at of cands) {
      const spot = bot.blockAt(at);
      if (!spot || !AIR.has(spot.name)) continue;
      for (const f of FACES) {
        const ref = bot.blockAt(at.offset(f[0], f[1], f[2]));
        if (!ref || ref.boundingBox !== 'block') continue;
        try {
          await bot.equip(ct, 'hand');
          // placeBlock puts the new block at ref + face, so the face points back at `at`
          await bot.placeBlock(ref, new Vec3(-f[0], -f[1], -f[2]));
          steps.push('place:table');
          ourTable = at.clone();
          return true;
        } catch (_) {}
      }
    }
    return false;
  };
  let table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 });
  // A table in the bag beats a table at the depot. This used to travel to the depot's table
  // FIRST, so a bot that had brought its own would still spend a 25s cross-map goto (and,
  // underground, fail it) before discovering it was carrying the answer. Same principle as
  // payableTier: spend what you already have before going to fetch.
  if (!table && await placeCarriedTable()) {
    table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 });
  }
  if (!table && tablePos) {
    // the registered table coord may be stale (Felix moved the base cluster) — re-find the
    // nearest real crafting table near it and travel there, before falling back to placing
    // our own. Covers a table moved past findBlock's r6 (the >6m base-radius case). (#76)
    const moved = resolveContainer(bot, tablePos, { types: new Set(['crafting_table']), reach: true });
    const dest = moved || new Vec3(tablePos[0], tablePos[1], tablePos[2]);
    try {
      await gotoT(bot, dest.x, dest.y, dest.z, 2, 25000);
      table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 });
    } catch (_) {}
  }
  // Live bug (2026-09-02, NacktNorbert/3110, #84 investigation): the placeCarriedTable() call
  // at line ~2052 already tried to place whatever table we're ALREADY holding, if any — so
  // reaching here means either we hold none, or we hold one and just failed to place IT. The
  // old code checked only `!table` (a PLACED block) and crafted a brand-new one unconditionally,
  // which does nothing for the second case: crafting an IDENTICAL fungible item does not change
  // the local geometry that just rejected the one we already had, so retrying placeCarriedTable()
  // right after crafting another was guaranteed to fail again for the same reason. Measured live:
  // 5 consecutive ensureTool attempts at the same spot each crafted a fresh table (4 planks each,
  // "the fluctuating plank count" that never converged), ending with 5 crafting_tables sitting
  // uselessly in inventory. Only craft when genuinely holding zero — crafting more of what you
  // can't place is not the fix; the fix is a better spot (still unbuilt, needs a live geometry
  // reproduction of the actual placement failure before designing one, not a guess).
  const alreadyHolding = () => bot.inventory.items().some((i) => i.name === 'crafting_table');
  if (!table && !alreadyHolding()) {
    // no table anywhere and none carried: craft one and place it, as a player would
    await S.craftSafe(bot, 'crafting_table', 1);
    steps.push('craft:table');
    if (await placeCarriedTable()) {
      table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 });
    }
  }
  if (!table) {
    return { ok: false, reason: `no crafting table in reach and could not place one${alreadyHolding() ? ' (already holding one — not re-crafting)' : ''}` };
  }
  const r = await S.craftSafe(bot, want, 1, { table: table.position });
  steps.push(`craft:${want}:${r.made || 0}`);
  // TAKE THE TABLE BACK. A table we placed is a tool, not litter — a player mines it up and
  // walks on with it. Skipping this had a sharp cost, found live: the deep kit REQUIRES a
  // carried crafting_table, so placing it to craft a replacement pickaxe consumed the very
  // kit item the gate checks, and the bot's next departure was refused for a table it was
  // standing next to. It also leaves a crafting table abandoned wherever a tool broke, which
  // is exactly the kind of scar the fleet is supposed not to leave.
  // Only ever the one WE placed: a table we merely found belongs to someone.
  if (ourTable) {
    try {
      const blk = bot.blockAt(ourTable);
      // same check ctx.isProtected makes, inline: craftToolChain is module-scope and has no
      // ctx. Fails OPEN (not protected) when digguard is absent, matching that helper.
      const dg = globalThis.__digguard;
      const guarded = dg && typeof dg.hit === 'function' ? Boolean(dg.hit(ourTable, 'crafting_table')) : false;
      if (blk && blk.name === 'crafting_table' && !guarded) {
        // force: a crafting table drops bare-handed, but toolguard classes it as axe-work and
        // rejects the dig when no axe is held — which is how the first attempt at this failed
        // with `tool_missing: crafting_table`. Taking back a table we just put down is the
        // same sanctioned override as the hand-on-log bootstrap, and for the same reason: the
        // guard is protecting against wrong-tool WORK, not against picking our own kit back up.
        await bot.dig(blk, true, { force: true });
        await gotoT(bot, ourTable.x, ourTable.y, ourTable.z, 1, 5000);   // step onto the drop
        // 800ms, not 400: the pickup event landed AFTER the function returned at 400, so the
        // caller saw a table it did not have yet. Same settle craftSafe uses, same reason.
        await new Promise((res) => setTimeout(res, 800));
        steps.push('take:table');
      }
    } catch (e) { steps.push('take:table:' + String(e.message || e).slice(0, 30)); }
  }
  return r.made > 0 ? { ok: true } : { ok: false, reason: r.reason || 'craft produced nothing' };
}

S.craftSafe = async function (bot, itemName, times = 1, opts = {}) {
  const settleMs = opts.settleMs || 800;
  const want = Math.max(1, Math.min(64, times || 1));
  const def = bot.registry.itemsByName[itemName];
  if (!def) return { ok: false, made: 0, calls: 0, reason: `unknown item '${itemName}'` };
  const countOf = (n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);

  let table = null;
  if (opts.table) {
    const tp = new Vec3(opts.table.x, opts.table.y, opts.table.z);
    table = bot.blockAt(tp);
    // If the caller's table coord is stale (moved base table), re-find the nearest one. (#76)
    if (!table || table.name !== 'crafting_table') {
      const moved = resolveContainer(bot, tp, { types: new Set(['crafting_table']), reach: true });
      if (moved) table = bot.blockAt(moved);
    }
    // CRITICAL: bot.craft fires bot.activateBlock(table) WITHOUT awaiting it
    // (mineflayer craft.js:39). When the table is out of survival reach — e.g. a moved base
    // table that findBlock(r6) still "found" at ~5.8m — the server drops the packet, reachguard
    // rejects it as an UNHANDLED reach_violation, and `windowOpen` never fires so the craft
    // yields nothing (the observed depot/table churn). So APPROACH the table until it is within
    // the 4.5m block-interact reach before handing it to bot.craft.
    if (table) {
      const eye = () => bot.entity.position.offset(0, 1.6, 0);
      if (table.position.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.0) {
        try { await gotoT(bot, table.position.x, table.position.y, table.position.z, 2, 15000); } catch (_) {}
        const re = bot.blockAt(table.position);
        if (re && re.name === 'crafting_table') table = re;
      }
    }
  } else {
    const t = bot.registry.blocksByName.crafting_table;
    if (t) { const p = bot.findBlock({ matching: t.id, maxDistance: 4 }); if (p) table = p; }
  }

  let made = 0, calls = 0;
  for (let n = 0; n < want; n++) {
    // re-resolve every iteration: affordability changes as ingredients are consumed
    const recipe = bot.recipesFor(def.id, null, 1, table)[0];
    if (!recipe) {
      return { ok: made > 0, made, calls,
        reason: calls === 0
          ? `no usable recipe for ${itemName}${table ? '' : ' (no crafting table within 4 blocks — 3x3 recipes need one)'}`
          : 'ran out of ingredients',
        table: table ? [table.position.x, table.position.y, table.position.z] : null };
    }
    const before = countOf(itemName);
    const ingBefore = new Map();
    for (const d of (recipe.delta || [])) {
      const it = bot.registry.items[d.id];
      if (it) ingBefore.set(it.name, countOf(it.name));
    }
    try { await bot.craft(recipe, 1, table); }
    catch (e) { return { ok: made > 0, made, calls, reason: `craft threw: ${e.message}` }; }
    calls++;
    await new Promise((r) => setTimeout(r, settleMs));

    const gained = countOf(itemName) - before;
    if (gained <= 0) {
      pushLog('warn', `craftSafe: ${itemName} produced nothing on call ${calls} — stopping before it voids more`);
      return { ok: made > 0, made, calls, reason: 'no_output' };
    }
    made += gained;
    // the void bug shows up as an INGREDIENT dropping by more than the recipe asked for
    for (const [name, was] of ingBefore) {
      if (name === itemName) continue;
      const spent = was - countOf(name);
      const d = (recipe.delta || []).find((x) => (bot.registry.items[x.id] || {}).name === name);
      const expect = d ? Math.abs(d.count) : 0;
      if (spent > expect) {
        pushLog('warn', `craftSafe: ${name} lost ${spent}, recipe only wanted ${expect} — inventory desync, stopping`);
        return { ok: true, made, calls, reason: 'ingredient_desync', lost: { item: name, spent, expect } };
      }
    }
  }
  try { const m = MET(); if (m && m.craft) m.craft(itemName, want, made, null); } catch (_) {}
  return { ok: true, made, calls, table: table ? [table.position.x, table.position.y, table.position.z] : null };
};

// kitCheck(bot, tier) -> {ok, tier, missing:[...], warnings:[...]}
// Pure inspection, no side effects — drivers can call it directly to see what to restock
// before starting anything: __skills.kitCheck(bot, 'deep')
S.kitCheck = function (bot, tier) {
  const req = KIT_TIERS[tier];
  if (!req) return { ok: true, tier: null, missing: [], warnings: [] };
  const items = (bot && bot.inventory && bot.inventory.items()) || [];
  const total = (pred) => items.filter(pred).reduce((a, i) => a + i.count, 0);
  const missing = [], warnings = [];

  const torches = total((i) => i.name === 'torch' || i.name === 'soul_torch');
  if (torches < req.torches) missing.push(`torches ${torches}/${req.torches}`);
  const food = total((i) => FOODS.has(i.name));
  if (food < req.foodItems) missing.push(`food ${food}/${req.foodItems}`);
  if (req.weapon && !items.some((i) => /_sword$/.test(i.name) || /_axe$/.test(i.name))) missing.push('weapon (any sword)');
  if (req.picks) {
    const picks = items.filter((i) => /_pickaxe$/.test(i.name)).length;
    if (picks < req.picks) missing.push(`pickaxes ${picks}/${req.picks} (backup for the one that breaks)`);
  }
  if (req.filler) {
    const filler = total((i) => FILLERS.has(i.name));
    if (filler < req.filler) missing.push(`filler blocks ${filler}/${req.filler} (survival.js wall-off budget)`);
  }
  // The makings of ONE in-place tool re-craft (#43 item 1). A stone pickaxe is 3 cobblestone
  // and 2 sticks on a table, and the filler above is already cobblestone — so these two light
  // items are the difference between "pickaxe broke at y52" being a wedge and being a 2.2s
  // recraft where the bot stands. Measured: 36.6s and a failure without them, 2.2s and a
  // stone_pickaxe with them, same bot, same spot.
  if (req.sticks) {
    const sticks = total((i) => i.name === 'stick');
    if (sticks < req.sticks) missing.push(`sticks ${sticks}/${req.sticks} (to re-craft a tool where you stand)`);
  }
  if (req.table && !items.some((i) => i.name === 'crafting_table')) {
    missing.push('crafting_table (a tool is a 3x3 recipe; there is none underground)');
  }
  if (req.shield && !items.some((i) => i.name === 'shield')
    && !(bot.inventory.slots[45] && bot.inventory.slots[45].name === 'shield')) missing.push('shield');
  if (req.water && !items.some((i) => i.name === 'water_bucket')) missing.push('water_bucket');
  if (req.armor) {
    const worn = (bot.inventory.slots || []).slice(5, 9).filter(Boolean);
    if (!worn.some((i) => /_chestplate$/.test(i.name))) missing.push('armor (chestplate minimum)');
  }
  // durability gate — "a broken tool outranks the job", made mechanical
  for (const it of items.filter((i) => /_(pickaxe|axe|sword|shovel|hoe)$/.test(i.name))) {
    const max = it.maxDurability || (bot.registry.items[it.type] || {}).maxDurability || 0;
    if (!max) continue;
    const pct = Math.round(((max - (it.durabilityUsed || 0)) / max) * 100);
    if (pct <= TOOL_LOW_PCT) warnings.push(`tool_low: ${it.name} at ${pct}%`);
  }
  if (typeof bot.food === 'number' && bot.food < 18) warnings.push(`hunger ${bot.food}/20 — eat before departing`);
  return { ok: missing.length === 0, tier, missing, warnings };
};

// Resolve a skill's kit tier: spec.kit is a string, or a function (args, bot) -> tier|null.
function kitTierFor(skill, args, bot) {
  try {
    const k = skill.kit;
    return typeof k === 'function' ? k(args || {}, bot) : (k || null);
  } catch (_) { return null; }
}

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

  // Telemetry: the attempt is recorded BEFORE the kit gate, so a kit_missing rejection lands
  // in the denominator. Counting only tasks that got past preflight would make refusing to
  // depart invisible and flatter every success rate.
  const _met = MET();

  // KIT PREFLIGHT (P1.6) — fail BEFORE the task exists, so a half-kitted bot never departs.
  // Escape hatch: args.force = true (logged, so a shortcut is always visible after the fact).
  // declared tool: a WARNING, not a block — the skill calls ctx.ensureTool() up front and
  // will withdraw or craft one. Blocking here would refuse work the engine can fix itself.
  if (skill.tool) {
    const tn = needSpec(bot, skill.tool);
    if (tn && !bestOwned(bot, tn)) pushLog('warn', `no ${skill.tool} on hand for ${name} — will try to acquire one`);
  }
  const tier = kitTierFor(skill, args, bot);
  if (tier) {
    const kit = S.kitCheck(bot, tier);
    for (const w of kit.warnings) pushLog('warn', w);
    if (!kit.ok && !args.force) {
      pushLog('warn', `kit_missing (${tier}): ${kit.missing.join(', ')}`);
      say(bot, `Not setting off half-kitted — I still need: ${kit.missing.join(', ')}.`);
      const kitErr = { code: 'kit_missing', tier, missing: kit.missing, warnings: kit.warnings,
        hint: 'restock from the depot (chest B torches/cobble, chest C food), then restart — or pass {"force":true} to override' };
      if (_met && _met.taskRejected) _met.taskRejected(name, args, kitErr);
      return { ok: false, error: kitErr };
    }
    if (!kit.ok) pushLog('warn', `kit_missing OVERRIDDEN by force: ${kit.missing.join(', ')}`);
  }

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
  if (_met && _met.taskStart) {
    _met.taskStart(task, { src: _q && _q.qid ? 'queue' : (_q && _q.fallback ? 'fallback' : 'driver'),
      qid: _q && _q.qid ? _q.qid : null, kit: tier ? S.kitCheck(bot, tier) : null });
  }

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
      // Completion must be UNMISSABLE. Two reasons it wasn't: idle-guard takes over the
      // moment a task ends, so the bot still looks busy and drivers keep waiting; and as of
      // graychat v3 an unprefixed line is log-tier, so a plain done message would not reach
      // chat at all. The "!" prefix puts it in the IMPORTANT tier (white, in-game), and the
      // TASK_DONE log line gives Monitors something machine-greppable.
      // A doneMsg may return null to announce NOTHING — a no-op completion is not news, and
      // forcing '!' onto every one of them is what flooded public chat with "picked up 0
      // drops" from five idle bots. It may also pick its own tier by prefix; only an
      // unprefixed message defaults to IMPORTANT. (The regex also stops a doneMsg that
      // already starts with '!' becoming '!!'.)
      const dm = skill.doneMsg ? skill.doneMsg(task) : `done: ${name}`;
      if (dm != null && String(dm).trim()) {
        const line = String(dm);
        say(bot, /^[!@/]/.test(line) ? line : '!' + line);
      }
      pushLog('done', `TASK_DONE ${name} ${JSON.stringify(task.result || {}).slice(0, 140)}`);
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
        say(bot, `!failed: ${name} — ${e.message}`);   // failures are important-tier too
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
    // Emit BEFORE _onTaskEnd: that starts the next task synchronously, so emitting after it
    // would order the ledger wrongly (next task_start ahead of this task_end).
    try {
      const m = MET();
      if (m && m.taskEnd) m.taskEnd(task, runAssert(task, bot));
    } catch (e) { pushLog('error', 'telemetry taskEnd: ' + e.message); }
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
    queue: (S.queue.length || S.onEmptySpec || S.queueLoop || S.queueState !== 'idle') ? {
      state: S.queueState,
      n: S.queue.length,
      next: S.queue.length ? S.queue[0].name : null,
      pending: S.queue.slice(0, 8).map((i) => i.name),
      done: S.queueDone, total: S.queueTotal,
      runId: S.runId,
      onEmpty: S.onEmptySpec ? S.onEmptySpec.name : null,
      loop: S.queueLoop ? { n: S.queueLoop.items.length, loops: S.queueLoop.loops, maxLoops: S.queueLoop.maxLoops || null } : null,
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
    S.queue.length = 0; S.onEmptySpec = null; S.queueLoop = null; S.queueHalt = null; S.queuePausedBecause = null;
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
  // loop:true (issue #24) re-seeds the ORIGINAL item list before falling through to
  // onEmpty — distinct from onEmpty, which repeats a single fallback task instead of the
  // whole list. Checked first: a caller with BOTH loop and onEmpty wants the real work to
  // keep cycling, with onEmpty as the sweep that only ever runs between real cycles if the
  // loop itself is capped and eventually stops.
  if (S.queueLoop && S.queueLoop.items.length) {
    const lp = S.queueLoop;
    if (!lp.maxLoops || lp.loops < lp.maxLoops) {
      lp.loops++;
      for (const it of lp.items) {
        const v = normalizeItem(bot, it, 0);
        if (!v.error) S.queue.push(v.item);       // re-validated fresh each loop, never trusted stale
      }
      S.queueTotal += S.queue.length;
      pushLog('task', `queue loop ${lp.loops}${lp.maxLoops ? '/' + lp.maxLoops : ''}: re-seeded ${S.queue.length} job(s)`);
      _pump(bot);
      return;
    }
    pushLog('info', `queue loop finished after ${lp.loops} run(s) — maxLoops reached`);
  }
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
  // Every fallback run is quiet. Announcing up front produced a line per sweep whether or
  // not there was anything to sweep; _onTaskEnd speaks afterwards, and only if the run
  // actually collected something (team-lead: "narrate only when something was found").
  const quiet = true;
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
  else if (task.fallback) {
    S._fallbackErrBackoff = 0;
    // a sweep that picked something up is worth a line; one that found nothing is noise
    const got = Object.entries(task.collected || {});
    if (got.length) {
      const n = got.reduce((a, [, v]) => a + v, 0);
      say(bot, `Picked up ${n} stray item${n === 1 ? '' : 's'} while waiting (${got.map(([k, v]) => `${v} ${k}`).join(', ').slice(0, 80)}).`);
    }
  }
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
  // loop:true (issue #24) — re-seed THIS list when it drains, rather than falling straight
  // to onEmpty/idle. 'in' so loop:false explicitly clears a previously-set loop (matches
  // onEmpty's own opt-out shape); omitting it entirely leaves any existing loop untouched.
  if ('loop' in opts) {
    if (!opts.loop) { S.queueLoop = null; }
    else {
      if (!norm.length) return { ok: false, error: { code: 'bad_args', message: 'loop:true needs at least one {name,args} to re-seed' } };
      S.queueLoop = { items: norm.map((it) => ({ name: it.name, args: it.args })), maxLoops: opts.maxLoops || 0, loops: 0 };
    }
  }
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
    // floor 30s: the fallback is a background sweep, not a work loop. A shorter gap
    // produced the "checking for stray drops / picked up 0" chat spam the user complained
    // about, and a sweep that found nothing has no reason to run again seconds later.
    everyMs: Math.max(30000, Math.min(spec.everyMs || 30000, 300000)),
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
    // Anything beyond one leg goes through gotoFar: a single 60s A* over that distance
    // was the standing long-haul failure (gotoFar sets the HAUL profile itself).
    const far = Math.sqrt((args.x - ctx.bot.entity.position.x) ** 2 + (args.z - ctx.bot.entity.position.z) ** 2) > 80;
    if (far) {
      await ctx.gotoFar(args, { range: args.range || 1, timeoutMs: args.timeoutMs || 240000 });
    } else {
      const restoreMoves = ctx.enterHaul();
      try {
        await ctx.retry('travel', () => ctx.gotoNear(args, args.range || 1, 60000), 2);
      } finally { restoreMoves(); }
    }
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
  // silent when it swept nothing: an idle bot re-checking empty ground is not an event.
  // TASK_DONE still records it in the log either way.
  doneMsg: (t) => ((t.result && t.result.picked) ? `Drop sweep done: picked up ${t.result.picked} drops.` : null),
});

// ---------- chopTrees ----------
S.define('chopTrees', {
  kit: 'excursion',
  tool: 'axe',
  description: 'Fell whole trees (flood-filled connected logs, bottom-up), collect all drops, replant saplings when held.',
  params: { types: "'any' or array of species (oak, spruce, birch, jungle, acacia, dark_oak, cherry, pale_oak, mangrove)", count: 'trees to fell (default 1)', maxDist: 'search radius (default 64)', replant: 'bool (default true)' },
  validate: (a) => {
    let types = a.types || 'any';   // #A: default ANY species, not oak-only (FurzFriedrich thrashed "no oak within 64" beside birch/spruce; matches what SALIENT claims)
    if (typeof types === 'string') types = types === 'any' ? SPECIES : [types];
    if (!Array.isArray(types) || !types.length) return 'types must be a species array or "any"';
    for (const t of types) if (!SPECIES.includes(t)) return `unknown species '${t}' (known: ${SPECIES.join(', ')})`;
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    let types = args.types || 'any';   // #A: default ANY species, not oak-only — see validate()
    if (typeof types === 'string') types = types === 'any' ? SPECIES : [types];
    const count = Math.max(1, Math.min(16, args.count || 1));
    const maxDist = Math.min(args.maxDist || 64, 64);
    const replant = args.replant !== false;
    const logNames = types.flatMap((t) => [t + '_log', t + '_wood']);
    const logIds = blockIds(bot, logNames);
    const logIdSet = new Set(logIds);
    const blacklist = new Set();
    let felled = 0, logsDug = 0, stranded = 0, replanted = 0, protectedSkipped = 0;
    ctx.progress(0, count, 'trees');
    ctx.setPhase('gearing', 'Making sure I have an axe before I start swinging.');
    {
      const t = await ctx.ensureTool('axe');
      if (!t.ok) throw fatal('tool_missing', 'no axe and could not acquire one', 'put an axe in depot chest B, or give the bot logs to craft from');
    }
    ctx.setPhase('searching', `Off to chop ${count} tree${count > 1 ? 's' : ''} (${types.join('/')}). Timber incoming.`);
    // #91's doctrine, applied here before it produces a second specimen: findBlocks below is
    // centred on the bot's CURRENT position on every one of up to `count` (<=16) iterations,
    // always picking the nearest-to-current-position hit (the sort just below) — the exact
    // "re-derive nearest from a moving reference point" shape that dug OhneHoseOtto into its
    // own dead end via producer.js's unbounded ore chase, just with a smaller iteration cap
    // and denser typical targets (so smaller in practice, not a different shape). Anchor to
    // where THIS CALL started so a multi-tree chop explores a bounded area instead of
    // marching progressively further from the task's own starting point with every tree.
    const origin = bot.entity.position.clone();

    while (felled < count) {
      ctx.step();
      // find trunk bases: a log whose block below is NOT a log (ground contact)
      const hits = bot.findBlocks({ matching: logIds, maxDistance: maxDist, count: 64 })
        .filter((p) => !blacklist.has(key(p)))
        // registered structure (torch posts, house frames) is not a tree — skip it at
        // SELECTION time. digguard would refuse the dig anyway, but only after a full
        // goto + up to 6 stall-recoveries per log, which reads as a hang from status().
        .filter((p) => !ctx.isProtected(p))
        // trees are surface features: a "tree" well below our feet is down a ravine
        .filter((p) => p.y >= Math.floor(bot.entity.position.y) - MAX_BELOW)
        // aesthetic geofence: don't crater the view right next to base
        .filter((p) => ctx.harvestAllowed(p, 'chopTrees'))
        .filter((p) => { const below = bot.blockAt(p.offset(0, -1, 0)); return below && !logIdSet.has(below.type); })
        .filter((p) => p.distanceTo(origin) <= maxDist)
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
        // a real tree growing against registered structure: fell the tree, leave the build
        if (ctx.isProtected(p)) { protectedSkipped++; continue; }
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
    return { treesFelled: felled, logsDug, stranded, replanted, ...(protectedSkipped ? { protectedSkipped } : {}) };
  },
  doneMsg: (t) => {
    const haul = Object.entries(t.collected).map(([k, v]) => `${v} ${k}`).join(', ');
    return `Chopped ${t.result.treesFelled} tree(s), ${t.result.logsDug} logs. Haul: ${haul || 'nothing?!'}`;
  },
});

// ---------- relocateToWork (#67b) ----------
// A base whose immediate ground is worked out or protected leaves a role bot no-opping in
// place: chopTrees throws not_found once every plaza tree is protected or felled, safeDescend
// cannot cut the protected base floor, harvestGrass finds paved ground. The agenda's IDLE rung
// detects that barren no-op and calls this to WALK the bot to fresh terrain, so the next
// role-work run scans new ground instead of the same empty patch.
//
// It is a DIRECTED WALK, not a wider scan: the work skills already sweep 64 blocks, so if they
// found nothing the resource is not in view and a bigger scan finds the same nothing — the fix
// is to load new chunks by moving. Headings rotate across calls so repeated barren cycles fan
// OUT instead of pacing one dead direction. No kit gate on purpose: a stripped bot must still
// be able to relocate, and walking needs nothing in the bag.
S.define('relocateToWork', {
  description: 'Walk to fresh, unprotected terrain when the local area is worked out, so role-default work has something to do. The agenda IDLE rung calls this on a barren no-op.',
  params: { skill: 'the role-work skill that no-opped (chopTrees|harvestGrass|mineLane|safeDescend)', role: 'fallback resource hint if skill is absent', hops: 'blocks to travel (default 40)' },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const skill = args.skill || null, role = args.role || null;
    // Resource class the destination must offer (wood/ground) or simply be clear to dig (dig).
    const kind = (skill === 'chopTrees' || role === 'lumberjack') ? 'wood'
      : (skill === 'mineLane' || skill === 'safeDescend' || role === 'miner') ? 'dig'
        : 'ground';
    const hop = Math.max(16, Math.min(64, args.hops || 40));
    const cfg = readCfg();
    const HOME = Array.isArray(cfg.home) ? new Vec3(cfg.home[0], cfg.home[1], cfg.home[2]) : null;
    const here = bot.entity.position.clone();

    // First standable landing at (x,z): scan down from a ceiling for solid floor with two air
    // cells above, skipping fluids. Returns the feet cell, or null if nothing loaded/standable.
    const standableAt = (x, z, topY) => {
      for (let y = topY; y >= topY - 24; y--) {
        const floor = bot.blockAt(new Vec3(x, y, z));
        const feet = bot.blockAt(new Vec3(x, y + 1, z));
        const head = bot.blockAt(new Vec3(x, y + 2, z));
        if (!floor || !feet || !head) continue;
        if (floor.boundingBox !== 'block' || /water|lava/.test(floor.name)) continue;
        if (feet.boundingBox !== 'empty' || head.boundingBox !== 'empty') continue;
        return new Vec3(x, y + 1, z);
      }
      return null;
    };

    // Fan the heading out across calls so consecutive barren cycles explore different ground.
    const HEADINGS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
    const n = (S._relocateN = (S._relocateN || 0) + 1);
    ctx.setPhase('relocating', `Local ${kind === 'wood' ? 'trees' : kind === 'dig' ? 'dig ground' : 'ground'} worked out — moving to fresh terrain.`);

    // #70: reachability PRE-FILTER. MettMarcel flailed 12/12 relocate gotos on res:no_path —
    // boxed inside a protected camp sphere, every candidate 40+ blocks out had NO route at all.
    // So probe each candidate with getPathTo BEFORE committing a goto: skip no_path/timeout
    // targets, and WIDEN the ring when the local fan is all-unreachable rather than re-picking the
    // same doomed set. A genuinely boxed bot then stands down cheaply instead of churning gotos.
    // A relocate candidate is worth a goto only if a full route exists — the SAME strict gate the
    // work-skills use. Accepting partials (the old minPartial=12) is what let relocateToWork commit
    // gotos to spots gotoNear could only reach part-way, then no_path (MettMarcel's 4 phantom gotos).
    const routable = (dest) => ctx.reachable(dest, 2);
    const candidateAt = (h, ring) => {
      const tx = Math.floor(here.x + h[0] * ring), tz = Math.floor(here.z + h[1] * ring);
      const topY = Math.floor(Math.max(here.y, HOME ? HOME.y : here.y)) + 4;
      const dest = standableAt(tx, tz, topY) || new Vec3(tx, Math.floor(here.y), tz);
      // Never relocate INTO protected base infrastructure — that is the ground we are leaving.
      if (ctx.isProtected(dest)) return null;
      // For wood, do not settle inside the plaza aesthetic exclusion: walk OUT of it, not around.
      if (kind === 'wood' && !ctx.harvestAllowed(dest, 'chopTrees')) return null;
      return dest;
    };

    let moved = null, tried = 0, unroutable = 0, checks = 0;
    for (const ring of [hop, hop + 20, hop + 40]) {   // widen the search ring if the local fan is boxed
      if (moved) break;
      for (let i = 0; i < HEADINGS.length && !moved && checks < 12; i++) {
        ctx.step();
        const h = HEADINGS[(n + i) % HEADINGS.length];
        const dest = candidateAt(h, ring);
        if (!dest) continue;
        tried++; checks++;
        if (!routable(dest)) { unroutable++; continue; }   // don't commit a goto to a no-path target
        try { await ctx.gotoNear(dest, 2, 30000); moved = dest; }
        catch (e) { ctx.log(`relocate to routable ${dest.x},${dest.z} still failed (${e.code || e.message}) — next`); }
      }
    }

    if (!moved) {
      // Every candidate unreachable = genuinely boxed in (protected sphere / walled terrain). A
      // distinct reason so the read is honest; the agenda stands relocate down with backoff either way.
      const boxed = tried > 0 && unroutable >= tried;
      return { relocated: false, reason: boxed ? 'boxed_in' : 'no_reachable_spot', kind, tried, unroutable };
    }
    // #C: 'relocated' must reflect ACTUAL displacement, not just that a gotoNear resolved. A goto
    // that resolves without the bot moving (a false-arrival) must NOT grade as a successful relocate
    // — that was the outcome:ok-despite-0m false success. Measure from the real final position.
    const fin = bot.entity.position;
    const dist = Math.round(Math.sqrt((fin.x - here.x) ** 2 + (fin.z - here.z) ** 2));
    if (dist < 3) return { relocated: false, reason: 'no_progress', kind, tried, unroutable };
    try { await ctx.collectDrops(8, 6000); } catch (_) {}
    return { relocated: true, kind, to: { x: Math.round(fin.x), y: Math.round(fin.y), z: Math.round(fin.z) }, dist };
  },
  // #67a: a relocate that found nowhere new to go is not news — stay silent.
  doneMsg: (t) => (t.result && t.result.relocated
    ? `Moved ${t.result.dist}m to fresh ${t.result.kind === 'wood' ? 'woods' : t.result.kind === 'dig' ? 'ground to mine' : 'ground'}.`
    : null),
});

// ---------- mineLane ----------
S.define('mineLane', {
  tool: 'pickaxe',
  // underground by definition; 'deep' once the bot is already below y=0
  kit: (a, bot) => { try { return bot.entity.position.y < 0 ? 'deep' : 'underground'; } catch (_) { return 'underground'; } },
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
    let banked = 0, dug = 0, lost = 0, rescans = 0, torches = 0, saidTorch = false, probes = 0;
    const torchState = {};
    let stoppedBecause = 'complete';
    ctx.progress(0, count, want[0] || target);
    {
      const t = await ctx.ensureTool(want[0] || target);
      if (!t.ok) throw fatal('tool_missing', `no tool that mines ${target} and could not acquire one`, 'stock a pickaxe in depot chest B, or craft one first');
    }
    ctx.setPhase('scanning', `Mining ${count}x ${target}. Best tool out, off I go.`);

    // depth gate: laneY (an explicit lane) or allowDeep:true opt out; otherwise targets more
    // than MAX_BELOW under the bot are skipped so a bare `mineLane iron_ore` cannot walk the
    // bot into a ravine. Measured from CURRENT feet each scan, so legitimate descent works.
    const scan = () => bot.findBlocks({ matching: ids, maxDistance: cap, count: Math.max(count * 4, 32) })
      .filter((p) => !blacklist.has(key(p)) && !visited.has(key(p)))
      .filter((p) => args.laneY == null || Math.abs(p.y - args.laneY) <= 2)
      .filter((p) => args.laneY != null || args.allowDeep === true
        || p.y >= Math.floor(bot.entity.position.y) - MAX_BELOW);

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

      // #70b: ore OUT OF REACH needs a goto — don't commit one to ore we have no route to
      // (BuddelBernd's 34/56 no_path was mineLane reaching for unreachable ore). In-reach ore digs
      // in place. Bound the getPathTo probes: 12 far-ore checks with no dig between = boxed, stop.
      if (pos.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.6, 0)) > 4.4) {
        if (probes >= 12) { stoppedBecause = 'exhausted'; break; }
        probes++;
        if (!ctx.reachable(pos, 2)) { blacklist.add(key(pos)); continue; }
      }
      const r = await ctx.digBlock(pos);
      if (!r.ok) {
        if (r.reason === 'no_tool') throw fatal('no_tool', `tool cannot harvest ${r.block} anymore`, 'tool broke? craft/fetch a replacement and restart');
        blacklist.add(key(pos));
        continue;
      }
      if (!r.already) { dug++; probes = 0; }   // real progress — reset the unreachable-probe streak

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
  kit: 'hunt',        // #45: weapon-gated, not food-gated — a foodless hunter can hunt FOR food
  tool: 'sword',
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

// ---------- ensureTool (skill wrapper) ----------
// S.ensureTool is a METHOD, which is the right shape for calling from inside another skill
// where ctx already supplies step/cancellation. It is the WRONG shape for the agenda: a rung
// act that awaits it holds the ladder's busy flag for the whole acquisition, and a chain that
// has to gather wood, craft planks, place a table and craft the tool can outrun the agenda's
// 180s act cap. When it does, the ladder force-releases and moves on while the acquisition
// keeps running unowned — two things steering the bot with neither aware of the other.
// As a SKILL it gets the task mutex, telemetry, and clean stop-at-a-step-boundary preemption,
// and the agenda's act returns immediately.
S.define('ensureTool', {
  description: 'Acquire a tool of the given class: equip what is owned, else withdraw from the depot, else craft one. spare:true forces acquisition even when one is already held (backup-tool kit rules).',
  params: { tool: "class name ('pickaxe'|'axe'|'shovel'|'sword'|'hoe') or a block name to resolve one from", spare: 'bool — acquire another even if one is held (default false)' },
  validate: (a) => (a.tool ? null : 'need tool: a class name or a block name'),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    ctx.setPhase('acquiring', `Making sure I have a ${args.tool}${args.spare ? ' (spare)' : ''}.`);
    const r = await S.ensureTool(bot, args.tool, { spare: Boolean(args.spare) });
    if (!r.ok) {
      throw fatal(r.error || 'acquisition_failed', `could not acquire ${args.tool}: ${(r.steps || []).join(' | ')}`,
        'stock one in the depot, or give the bot materials to craft from');
    }
    return { tool: r.item, how: r.how, steps: r.steps || [] };
  },
  doneMsg: (t) => `Tool ready: ${t.result.tool} (${t.result.how}).`,
});

// ---------- restock ----------
// The departure gate the agenda's RESTOCK rung needs. Takes FLOORS (target totals), not
// amounts to withdraw, so it is idempotent: calling it twice when already stocked is a
// no-op rather than a double withdrawal. Routes each item to the depot chest that holds
// its category, and reports what it could not find rather than pretending.
S.define('restock', {
  description: 'Top inventory up to the given floors from the depot chests. Idempotent: floors are targets, not deltas.',
  params: {
    needs: "{itemName: targetTotal}, e.g. {torch:16, bread:4, cobblestone:16}",
    chests: 'optional [{x,y,z}] to try in order (default: the depot coords in protected.json)',
  },
  validate: (a) => (a.needs && typeof a.needs === 'object' && Object.keys(a.needs).length ? null : 'need {needs:{item:count}}'),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const have = (n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
    const shortfall = () => {
      const out = {};
      for (const [n, target] of Object.entries(args.needs)) {
        const gap = target - have(n);
        if (gap > 0) out[n] = gap;
      }
      return out;
    };
    let need = shortfall();
    if (!Object.keys(need).length) return { alreadyStocked: true, got: {}, short: {} };

    const cfg = readCfg();
    const depot = cfg.depot || {};
    const chests = Array.isArray(args.chests) && args.chests.length ? args.chests
      : ['minerals', 'wood', 'food'].map((k) => depot[k]).filter(Array.isArray).map((c) => ({ x: c[0], y: c[1], z: c[2] }));
    if (!chests.length) throw fatal('not_found', 'no depot chests configured', 'add a depot block to protected.json or pass chests:[{x,y,z}]');

    ctx.setPhase('restocking', `Topping up: ${Object.entries(need).map(([n, c]) => c + ' ' + n).join(', ')}.`);
    // A restock is a long haul by nature — the depot is at the surface and the bot calling
    // this is usually deep. On the default profile that route is beyond the planner's search
    // budget: the soak ledger shows a y62->surface trip returning `partial` 416 times with
    // ZERO successes, inching ~17 blocks of a 76-block ascent before wedging, and it did that
    // ten times in a row. HAUL is what that route needs (thinkTimeout 25s, unlimited
    // searchRadius, path shortcuts) and it is the same treatment `come` already gets.
    const restoreMoves = ctx.enterHaul();
    try {
    const got = {};
    // How many chests we actually OPENED. "The depot was out" and "we never got to the
    // depot" are different facts and they deserve different responses, but the result used
    // to report both as an identical `short`. That mattered once it was measured: on a world
    // where the depot does not exist, this whole call cost ~7 minutes of hauling toward
    // coordinates it could not reach, and the agenda's 10-minute retry would have had a
    // driverless bot spending most of a soak walking to a chest that was never there.
    let reached = 0;
    for (const c of chests) {
      ctx.step();
      need = shortfall();
      if (!Object.keys(need).length) break;
      let r = null;
      try { r = await ctx.withdrawFromChest(c, need); reached++; }
      catch (e) { ctx.log(`chest ${c.x},${c.y},${c.z}: ${e.message}`); continue; }
      for (const [n, k] of Object.entries(r.got || {})) got[n] = (got[n] || 0) + k;
    }
    const short = shortfall();
    if (Object.keys(short).length) {
      ctx.log(reached === 0
        ? `still short and reached NO chest of ${chests.length} — the depot is unreachable from here, not empty`
        : `still short: ${Object.entries(short).map(([n, c]) => c + ' ' + n).join(', ')} — depot is out`);
    }
    return { got, short, reached, chests: chests.length, stocked: Object.keys(short).length === 0 };
    } finally { try { restoreMoves(); } catch (_) {} }
  },
  doneMsg: (t) => {
    const g = Object.entries(t.result.got || {});
    // nothing withdrawn is a no-op, not news — log-tier only (TASK_DONE carries it)
    return g.length ? `Restocked: ${g.map(([n, c]) => '+' + c + ' ' + n).join(', ')}.` : null;
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
      const want = new Vec3(args.pos.x, args.pos.y, args.pos.z);
      chest = bot.blockAt(want);
      if (!chest || !CONTAINERS.has(chest.name)) {
        // stale coord (moved depot chest) — re-find the nearest chest near the registered
        // spot before refusing, so a nudged chest doesn't loop the DEPOSIT rung. (#76)
        const moved = resolveContainer(bot, want, { types: CONTAINERS, reach: true });
        if (moved) { chest = bot.blockAt(moved); if (chest) ctx.log(`deposit chest re-resolved to ${moved.x},${moved.y},${moved.z}`); }
      }
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
    let offered = 0;   // #85: what the deposit ACTUALLY had a chance to move, for ASSERTS
    const skipped = [];
    try {
      const plan = win.items().filter((it) => (args.items ? args.items.includes(it.name) : !keepPred(it)));
      offered = plan.reduce((a, it) => a + it.count, 0);
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
    // #69 gap 1: log every visit, zero-moved included (e.g. chestFull on the first item).
    try { const m = MET(); if (m && m.chest) m.chest('deposit', [chest.position.x, chest.position.y, chest.position.z], moved); } catch (_) {}
    return {
      chest: { x: chest.position.x, y: chest.position.y, z: chest.position.z, name: chest.name },
      moved, totalMoved: total, offered, skipped, chestFull, freeSlotsAfter: bot.inventory.emptySlotCount(),
    };
  },
  doneMsg: (t) => (t.result.chestFull
    ? `Chest is full — deposited ${t.result.totalMoved} items, the rest stays with me.`
    : `Deposited ${t.result.totalMoved} items, kept my gear.`),
});

// ---------- safeDescend ----------
S.define('safeDescend', {
  tool: 'pickaxe',
  // keyed on the TARGET depth: descending to y<0 needs the deep kit BEFORE setting off
  kit: (a) => (typeof a.toY === 'number' && a.toY < 0 ? 'deep' : 'underground'),
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
    let noDescent = 0, lastStepY = startY;   // net-descent tripwire (see the step loop)
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
      // net-descent assertion: pathfinder can report a false "reached" with zero position
      // change, and digBlock returns `already` on air — so the step body can spin forever
      // making no progress. CAVECREW's staircase ran 96 steps for ONE level of descent and
      // ate the bot's only pickaxe. Abort after 3 consecutive steps that gain no depth.
      const feetY = Math.floor(bot.entity.position.y);
      if (feetY >= lastStepY) {
        noDescent++;
        if (noDescent >= 3) {
          stoppedBecause = 'no_descent';
          ctx.log(`3 steps with no net descent (still y=${feetY}) — aborting before this eats the pickaxe`);
          break;
        }
      } else { noDescent = 0; }
      lastStepY = feetY;
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
  doneMsg: (t) => (t.result && t.result.endY < t.result.startY   // #67: no net descent (base floor protected -> dig_failed, 0 steps) is a no-op — log-only
    ? `Staircase done: y=${t.result.startY} -> y=${t.result.endY} in ${t.result.steps} steps (${t.result.stoppedBecause}).` : null),
});

// ---------- ascendToSurface ----------
// The gap test-driver named live (FEEDBACK.md, 2026-09-02): a bot sealed in a mining dead-end
// (OhneHoseOtto/3140, GEAR-RACE run #1) had `come` fail from every target tried, including
// straight up from its own x/z — `bot.pathfinder.goto` found literally zero viable first
// steps, because excavating a brand-new vertical shaft through solid rock is not a movement
// mineflayer-pathfinder's graph search generates; it only routes through space that already
// exists. Confirmed on the live specimen (read-only diagnosis, no action taken): NOT a
// WALL_OFF-style sealed coffin (that would be a small, deliberately-shaped void) — a plain
// mining dead-end, 120/124 solid cells in a 5-block radius, with a clean 12-block column of
// stone/dirt/grass straight up to open sky and nothing else (lava/bedrock/protected) in it.
// So the honest answer to "bot is entombed, what skill do I set?" used to be "none exist" —
// this is that skill, mirroring `safeDescend`'s proven staircase shape rather than inventing a
// new mechanism: same forward-and-diagonal dig, same tripwires, just the vertical sign
// flipped, and — unlike descending — no fall/void hazard because you can't fall UP.
//
// WHY A STAIRCASE, NOT A VERTICAL SHAFT WITH PILLARING: climbing straight up through solid
// rock by digging a hole and jumping does not work — there is nothing to land ON once the
// rock is gone, only the digging player's own placed blocks would give that (pillar-jumping),
// and this codebase's #54 roadmap explicitly keeps block-placement-dependent self-rescue (R5)
// gated behind placeBlock (#19) being hardened, which it is not. A 45-degree ascending
// staircase needs zero placement: the block one step ahead at the CURRENT floor level is left
// solid on purpose — it becomes the stair tread — while only the cells above it (where the
// bot's new feet/head go) and the headroom above the bot's current position (so it can jump
// without hitting its head) get dug. Real player technique, not a new invention.
S.define('ascendToSurface', {
  tool: 'pickaxe',
  description: 'Dig a 45-degree staircase UP to open sky (or a target Y) — the mirror of safeDescend, for a sealed or off-course bot with no pathfinder route to the surface. Places no blocks; stops honestly at lava, bedrock, or no net ascent.',
  params: { toY: 'optional target Y — omit to climb until the column overhead is open sky', dir: "'north'|'south'|'east'|'west' (default: facing)", torchEvery: 'steps between torches (default 8)', maxSteps: 'cap (default 128)' },
  validate: (a) => (a.toY == null || (typeof a.toY === 'number' && isFinite(a.toY)) ? null : 'toY must be numeric if given'),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const toY = typeof args.toY === 'number' ? args.toY : null;
    const maxSteps = Math.min(args.maxSteps || 128, 512);
    const torchEvery = args.torchEvery ?? 8;
    const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    let dx, dz;
    if (args.dir && DIRS[args.dir]) { [dx, dz] = DIRS[args.dir]; }
    else {
      const yaw = bot.entity.yaw;
      const vx = -Math.sin(yaw), vz = -Math.cos(yaw);
      if (Math.abs(vx) >= Math.abs(vz)) { dx = Math.sign(vx) || 1; dz = 0; } else { dx = 0; dz = Math.sign(vz) || 1; }
    }
    // "have we broken through to open sky" — same discipline as dangerscan.js's columnOpen:
    // scan the column above for a clear run with no solid block; unloaded-chunk cells return
    // false ("not open yet"), never a guess of success.
    const columnOpen = () => {
      const feet = bot.entity.position.floored();
      for (let dy = 2; dy <= 24; dy++) {
        const b = bot.blockAt(feet.offset(0, dy, 0));
        if (!b) return false;
        if (b.boundingBox === 'block') return false;
      }
      return true;
    };
    const startY = Math.floor(bot.entity.position.y);
    let steps = 0, dug = 0, torches = 0, saidTorch = false;
    let noAscent = 0, lastStepY = startY;
    const torchState = {};
    let stoppedBecause = 'reached';
    let lastSaidY = startY;
    ctx.progress(0, toY != null ? Math.max(1, toY - startY) : null, 'y-levels');
    ctx.setPhase('ascending', 'Digging a staircase up toward the surface.');

    while (steps < maxSteps) {
      ctx.step();
      const F = bot.entity.position.floored();
      if (toY != null && F.y >= toY) break;
      if (toY == null && columnOpen()) break;
      const ahead = F.offset(dx, 0, dz);       // stays SOLID on purpose — the stair tread
      const newFeet = ahead.offset(0, 1, 0);   // dig: the new standing cell
      const newHead = ahead.offset(0, 2, 0);   // dig: the new head cell
      const jumpClear = F.offset(0, 2, 0);     // dig: headroom above the CURRENT position, or the jump bonks its head

      // hazard scan ahead: lava must not be broken into blind. Water is survivable (unlike
      // descending's void/lava concerns, there is no fall-hazard going up) so it is not an
      // abort, just not specially handled either.
      let lavaSeen = false;
      for (let f = 0; f <= 2 && !lavaSeen; f++) {
        for (let s = -1; s <= 1 && !lavaSeen; s++) {
          for (let y = 1; y <= 3; y++) {
            const p = F.offset(dx * f + (dx ? 0 : s), y, dz * f + (dz ? 0 : s));
            const b = bot.blockAt(p);
            if (b && b.name === 'lava') { lavaSeen = true; break; }
          }
        }
      }
      if (lavaSeen) { stoppedBecause = 'lava'; ctx.say('Lava right above. Not digging into that.'); break; }

      // gravity column above the dig site: same discipline as safeDescend — open it first and
      // let it settle before the bot's head ends up under a sand/gravel column.
      for (const p of [newHead.offset(0, 1, 0), jumpClear.offset(0, 1, 0)]) {
        const above = bot.blockAt(p);
        if (above && GRAVITY.has(above.name)) { await ctx.digBlock(p); await ctx.sleep(700); }
      }

      let blocked = null;
      for (const p of [newFeet, newHead, jumpClear]) {
        const r = await ctx.digBlock(p);
        if (r.ok && !r.already) dug++;
        else if (!r.ok) { blocked = r.reason || 'cannot_dig'; break; }
      }
      if (blocked === 'no_tool') { stoppedBecause = 'no_tool'; break; }
      if (blocked === 'undiggable') { stoppedBecause = 'bedrock'; break; }
      if (blocked) { stoppedBecause = blocked; break; }

      try { await ctx.goto(new goals.GoalBlock(newFeet.x, newFeet.y, newFeet.z), 10000); }
      catch (_) {
        try { await ctx.goto(new goals.GoalBlock(newFeet.x, newFeet.y, newFeet.z), 8000); }
        catch (_) { stoppedBecause = 'stuck'; break; }
      }
      steps++;
      // net-ascent assertion, mirroring safeDescend's own tripwire: abort after 3 consecutive
      // steps that gain no height, rather than spinning until the pickaxe breaks.
      const feetY = Math.floor(bot.entity.position.y);
      if (feetY <= lastStepY) {
        noAscent++;
        if (noAscent >= 3) {
          stoppedBecause = 'no_ascent';
          ctx.log(`3 steps with no net ascent (still y=${feetY}) — aborting before this eats the pickaxe`);
          break;
        }
      } else { noAscent = 0; }
      lastStepY = feetY;
      ctx.progress(Math.floor(bot.entity.position.y) - startY, null);
      if (torchEvery > 0) {
        const tr = await ctx.autoTorch(torchState, torchEvery);
        if (tr.placed) {
          torches++;
          if (!saidTorch) { saidTorch = true; ctx.say('Lighting the shaft as I climb.'); }
        }
      }
      const nowY = Math.floor(bot.entity.position.y);
      if (nowY - lastSaidY >= 16) { lastSaidY = nowY; ctx.say(`Now at y=${nowY}, still climbing.`); }
      if (steps % 32 === 0) await ctx.collectDrops(6, 8000);
    }
    if (steps >= maxSteps && stoppedBecause === 'reached') stoppedBecause = 'max_steps';
    ctx.setPhase('collecting', 'Sweeping the shaft clean.');
    await ctx.collectDrops(8, 10000);
    return { startY, endY: Math.floor(bot.entity.position.y), steps, dug, torches, stoppedBecause, surfaceReached: columnOpen() };
  },
  doneMsg: (t) => (t.result && t.result.endY > t.result.startY   // no net ascent is a no-op — log-only, matching safeDescend's own #67 doctrine
    ? `Climbed out: y=${t.result.startY} -> y=${t.result.endY} in ${t.result.steps} steps (${t.result.stoppedBecause})${t.result.surfaceReached ? ', open sky reached' : ''}.` : null),
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

// ---------- stripLog (FEEDBACK #35: recurring hand-rolled place+strip for aesthetic posts) ----------
// Strip placed logs into their stripped_ variant (an axe right-click, no dig) for torch/wall
// posts. Recurring hand-driven need (friedrich's wall posts, peter's torch_posts_1 rebuild).
// Uses ctx.settle around the equip+activate — that was the actual fix for the ~30 logs friedrich
// lost — and ctx.ensureTool for the axe so it inherits acquisition instead of failing bare-handed.
S.define('stripLog', {
  description: 'Strip placed logs into their stripped_ variant (axe right-click) for aesthetic posts. Never strips protected structure or non-logs; acquires an axe if needed.',
  tool: 'axe',
  params: { pos: 'a single {x,y,z}', cells: 'or an array [{x,y,z}]', rect: 'or a box {from:{x,y,z},to:{x,y,z}} (inclusive)' },
  validate: (a) => (a.pos || (Array.isArray(a.cells) && a.cells.length) || (a.rect && a.rect.from && a.rect.to)) ? null : 'need pos:{x,y,z}, cells:[...], or rect:{from,to}',
  fn: async (ctx) => {
    const { bot, args } = ctx;
    // resolve the target cells (single pos, explicit list, or an inclusive box; capped)
    let cells = [];
    if (args.pos) cells = [args.pos];
    else if (Array.isArray(args.cells)) cells = args.cells.slice(0, 512);
    else if (args.rect) {
      const a = args.rect.from, b = args.rect.to; const CAP = 512;
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++)
        for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
          for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) { cells.push({ x, y, z }); if (cells.length >= CAP) break; }
    }
    cells = cells.filter((c) => c && [c.x, c.y, c.z].every((n) => typeof n === 'number')).map((c) => new Vec3(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)));
    if (!cells.length) return { stripped: 0, cells: 0 };

    ctx.setPhase('preparing', 'Grabbing an axe for some stripping.');
    const tr = await ctx.ensureTool('axe');
    if (!tr.ok) return { ok: false, error: { code: 'no_axe', message: 'could not acquire an axe (depot/craft failed)', steps: tr.steps } };

    const STRIPPABLE = /(_log|_wood|_stem|_hyphae)$/;
    const stripOne = async (pos) => {
      ctx.step();
      let b = bot.blockAt(pos);
      if (!b) { try { await ctx.gotoNear(pos, 3, 15000); } catch (_) {} b = bot.blockAt(pos); }
      if (!b) return { ok: false, reason: 'unloaded' };
      if (/^stripped_/.test(b.name)) return { ok: true, already: true };
      if (!STRIPPABLE.test(b.name)) return { ok: false, reason: 'not_a_log', block: b.name };
      if (ctx.isProtected(pos, b.name)) return { ok: false, reason: 'protected' };   // never strip registered structure
      const eye = () => bot.entity.position.offset(0, 1.6, 0);
      if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.0) {
        try { await ctx.gotoNear(pos, 2, 15000); } catch (_) {}
        if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.6) return { ok: false, reason: 'unreachable' };
      }
      // re-equip the axe right before acting: a gotoNear may have dug a nuisance block and
      // swapped the held item. Then settle so the server has the axe before the right-click.
      const axe = bot.inventory.items().find((i) => /_axe$/.test(i.name));
      if (!axe) return { ok: false, reason: 'no_axe' };
      try { await withTimeout(bot.equip(axe, 'hand'), 5000, 'equip_timeout'); } catch (_) {}
      await ctx.settle();
      b = bot.blockAt(pos);
      try {
        await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
        await withTimeout(bot.activateBlock(b), 4000, 'strip_timeout');
      } catch (_) { /* verify below rather than trust the call */ }
      await ctx.settle(300);
      const now = bot.blockAt(pos);
      return (now && /^stripped_/.test(now.name)) ? { ok: true, block: now.name } : { ok: false, reason: 'no_effect', block: now && now.name };
    };

    ctx.setPhase('stripping', `Stripping ${cells.length} log${cells.length === 1 ? '' : 's'}.`);
    let stripped = 0, already = 0, skipped = 0; const reasons = {};
    let i = 0;
    for (const pos of cells) {
      ctx.step();
      ctx.progress(++i, cells.length, 'logs');
      const r = await stripOne(pos);
      if (r.ok && !r.already) stripped++;
      else if (r.already) already++;
      else { skipped++; reasons[r.reason] = (reasons[r.reason] || 0) + 1; }
    }
    return { cells: cells.length, stripped, already, skipped, ...(Object.keys(reasons).length ? { reasons } : {}) };
  },
  doneMsg: (t) => `Stripped ${t.result.stripped} log${t.result.stripped === 1 ? '' : 's'}${t.result.skipped ? ` (${t.result.skipped} skipped)` : ''}.`,
});

S.resolveContainer = (bot, coord, opts) => resolveContainer(bot, coord, opts);
G.__skills = S;
G.__infra = { resolveContainer, cache: _infraCache, CONTAINERS };
return {
  ok: true, installed: `__skills v${ENGINE_VERSION}`, skills: Object.keys(S.registry),
  features: ['queue', 'fallback', 'blueprints'],
  blueprints: { generators: Object.keys(S.blueprints), loaded: G.__blueprints ? Object.keys(G.__blueprints) : [] },
};
