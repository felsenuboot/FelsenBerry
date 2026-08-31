'use strict';
/* eslint-disable no-empty */
/**
 * goto2.patch.js — OPT-IN second movement engine (ashfinder) behind POST /goto2.
 * ============================================================================
 *
 * STATUS: standalone, NOT wired in. runner.js is owned by another workflow; this file
 * is written so a future engineer can merge it in three small edits (see "MERGE
 * INSTRUCTIONS" below). Nothing here runs until someone calls install().
 *
 * Package: @miner-org/mineflayer-baritone 4.6.2 ("ashfinder"), installed --save-exact
 * on 2026-09-01. Every claim in these comments was verified by reading the INSTALLED
 * source at node_modules/@miner-org/mineflayer-baritone/src/, not the README (the
 * README is wrong about several things — see GOTCHA 8).
 *
 * DOCTRINE (AUTONOMY_PLAN.md, research/movement-engines.md §4.3):
 *   - mineflayer-pathfinder stays the DEFAULT engine. mineflayer-pvp and
 *     mineflayer-collectblock are hard-welded to bot.pathfinder; ashfinder can never
 *     be the default without breaking them.
 *   - ashfinder is an escape hatch for terrain pathfinder cannot solve: water
 *     crossings, ladder/vine shafts, parkour gaps. Drivers call /goto2 deliberately.
 *   - Failure mode must be a no-op: if ashfinder is missing or broken, /goto2 returns
 *     501/503 and /goto keeps working.
 *
 *
 * ############################################################################
 * # GOTCHA 0 — THE LOAD-BEFORE-SPAWN CAVEAT. READ THIS FIRST. IT IS FATAL.   #
 * ############################################################################
 *
 * AshFinderPlugin's constructor does NOT build its path executor. It builds it inside
 * its own `bot.on("spawn", ...)` handler:
 *
 *     // src/AshFinder.js:37-41
 *     bot.on("spawn", () => {
 *       this.#pathExecutor = new PathExecutor(bot, this);
 *       this.waypointPlanner = new SmartWaypointPlanner(bot, this);
 *       this._visitedChunks = new Set();
 *     });
 *
 * If you loadPlugin() into an ALREADY-SPAWNED bot — which is exactly what our
 * ./inject.sh + POST /eval payload pattern does — `bot.ashfinder` exists and looks
 * healthy, but `#pathExecutor` stays null forever (until the next respawn) and the
 * first goto dies with:
 *
 *     TypeError: Cannot read properties of null (reading 'setPath')
 *
 * Upstream issue #10, reported against 4.5.1, still present in 4.6.2.
 *
 *   ==> loadAshfinder(bot) MUST be called inside runner.js createBot(), next to
 *   ==> bot.loadPlugin(pathfinder), BEFORE the bot spawns.
 *   ==> NEVER load ashfinder through /eval, ./inject.sh, or any payload.
 *
 * `#pathExecutor` is a JS private field, so we cannot probe it from outside — but
 * `waypointPlanner` is assigned in the SAME spawn handler and IS public. So
 * `bot.ashfinder.waypointPlanner == null` is a reliable public proxy for "the spawn
 * handler never ran, the executor is null, every goto will throw". isEngineReady()
 * below uses exactly that, and /goto2 returns 503 with an explanatory message instead
 * of a mystery TypeError.
 *
 *
 * ############################################################################
 * # THE REST OF THE GOTCHA CATALOG (all re-verified against installed 4.6.2)  #
 * ############################################################################
 *
 * GOTCHA 1 — goto() never throws on failure, it RETURNS a status.
 *   `AshFinder.js goto()` wraps everything in try/catch and returns
 *   `{status:'success'}` or `{status:'failed', error}`. The ONLY throw is
 *   "Already navigating." So `await bot.ashfinder.goto(g)` with no return check
 *   swallows every failure. gotoSmart() can additionally return
 *   `{status:'partial'}` and `{status:'failed'}` from the waypoint planner.
 *
 * GOTCHA 2 — `status:'success'` DOES NOT MEAN YOU ARRIVED.
 *   `executor.js _onPathEnd()` calls `_resolveCompletion()` on BOTH the normal branch
 *   and the "partial path exhausted with no continuation" branch (lines 300-330). An
 *   unreachable goal therefore resolves as success. Upstream issue #7.
 *   ==> ALWAYS assert arrival by real position. assertArrival() below does it, with a
 *       settle window, because physics lags the executor by a tick or two.
 *
 * GOTCHA 3 — a stuck bot that cannot replan also reports success.
 *   `executor.js handleStuck()` has `if (!newPath.success === false)`, which parses as
 *   `(!newPath.success) === false`. For the failure object `{success:false}` this is
 *   `true === false` → false, so the guard does not fire and `setPath(undefined)` runs.
 *   Next tick sees `!this.path` → `_onPathEnd()` → resolve → "success". Covered by the
 *   same arrival assertion as GOTCHA 2.
 *
 * GOTCHA 4 — stop() DURING an in-flight goto leaves that await PENDING FOREVER.
 *   `executor.stop()` (line 1593) sets `executing=false`, clears controls, and rejects
 *   `rejectCurrentPromise` (a per-move promise) — but it never touches
 *   `completionPromise` / `resolveCompletion` / `rejectCompletion`, which is the
 *   promise `goto()` is awaiting. It is never settled and never cleared.
 *   ==> Never `await` the library promise after cancelling. Race it, and ABANDON it.
 *
 * GOTCHA 5 — the zombie promise contaminates the NEXT run. (New; not in the docs.)
 *   Because stop() leaves `completionPromise` set, the next `setPath()` hits
 *   `_startCompletionPromiseIfNeeded()`, sees it truthy, and REUSES the stale promise
 *   object with the stale resolve fn. So when run N+1 finishes, it resolves the
 *   abandoned run N as well — and run N's `finally` block then executes MID-FLIGHT of
 *   run N+1, setting `this.stopped = true` and restoring `config.thinkTimeout`.
 *   Consequences, all handled below:
 *     (a) `bot.ashfinder.stopped` is NOT a trustworthy busy flag. Keep our own
 *         single-flight mutex (state.inFlight) — see GOTCHA 6.
 *     (b) `config.thinkTimeout` must be re-asserted at the START of every run, not
 *         configured once at spawn.
 *
 * GOTCHA 6 — thinkTimeout is silently clamped to 1000 ms for unloaded goal chunks.
 *   `goto()` lines 180-190: `if (bot.blockAt(goal.getPosition()) === null)` it sets
 *   `config.thinkTimeout = 1000` and restores the old value in `finally`. Any long
 *   haul targets an unloaded chunk, so a direct `goto()` over distance gets a ONE
 *   SECOND search budget, not 30 s. And if the run is abandoned (GOTCHA 4) the
 *   `finally` never runs, so 1000 ms sticks for every later call.
 *   ==> Re-assert config.thinkTimeout before every run (applyRunConfig()), and prefer
 *       smart:true for long hauls so each waypoint leg targets a nearer, loaded chunk.
 *
 * GOTCHA 7 — gotoSmart() IS NOT CANCELLABLE. (New; not in the docs. Important.)
 *   `waypoints.js navigateWithSmartWaypoints()` loops over waypoints calling
 *   `this.ashfinder.goto(waypointGoal)` and has NO stop/abort check anywhere in the
 *   loop (verified, lines 292-435). `bot.ashfinder.stop()` sets `stopped = true`,
 *   which is precisely the state the next `goto()` requires — so stopping mid-haul
 *   just lets the loop start the NEXT leg. One stop() call does not stop a smart haul.
 *   ==> cancelAsh() below calls stop() REPEATEDLY on a 200 ms poll for ~3 s, which
 *       kills each freshly-started leg until the loop runs out of waypoints or the
 *       generation token makes us stop caring.
 *
 * GOTCHA 8 — the documented events do not exist. Only two do.
 *   Grep for `.emit(` across src/: exactly three call sites, two event names —
 *   `"stopped"` and `"pathStarted"`. The README's `goal-reach`,
 *   `goal-reach-partial` and `waypoint-reached` are fiction, as is
 *   `goals.GoalLookAtBlock` (defined in src/goal.js, NOT exported by index.js).
 *   index.js exports exactly 9 goals: GoalAvoid, GoalComposite, GoalExact, GoalInvert,
 *   GoalNear, GoalRegion, GoalXZ, GoalXZNear, GoalYLevel. All take a Vec3 — unlike
 *   mineflayer-pathfinder's goals, which take (x, y, z).
 *
 * GOTCHA 9 — ashfinder's dig BYPASSES digguard.js. (New; a real FLEET LAW hole.)
 *   `executor.js:833` breaks blocks with `bot.ashDig(block, {autoTool:false})`, and
 *   `utils/ashDig.js` writes raw `block_dig` packets straight to `bot._client`.
 *   digguard.js only wraps `bot.dig` (digguard.js:96), so it sees NOTHING of this.
 *   With `breakBlocks` enabled, ashfinder can therefore chew through the plaza, the
 *   depot, the trading post — every protected structure — with no guard firing.
 *   ==> `dig` is OFF by default here. When it is requested, this module (a) refuses
 *       routes whose start→goal corridor passes near a protected region, and (b) wraps
 *       `bot.ashDig` for the duration of the run so every single break is checked and
 *       counted. A future engineer should move (b) into digguard.js permanently — it
 *       is the correct home for it.
 *
 * GOTCHA 10 — never pass `useCustomPhysics: true`.
 *   loader.js would then swap `@miner-org/mineflayer-physics-reworked` in for the
 *   whole bot, under mineflayer-pathfinder's feet. Also note loader.js destructures
 *   its second arg with no default, so a bare `loader(bot)` throws; always go through
 *   `bot.loadPlugin(loader)`, which passes mineflayer's options object.
 *
 * GOTCHA 11 — one leaked 50 Hz timer per respawn.
 *   `PathExecutor._startLoop()` self-schedules `setTimeout(loop, 20)` while
 *   `this.running`, and `stop()` never sets `running = false`. A fresh PathExecutor is
 *   built on EVERY spawn event, so every death leaks one immortal no-op loop plus its
 *   captured bot reference. Harmless for a handful of deaths; watch it on a bot that
 *   dies dozens of times in one process lifetime.
 *
 * GOTCHA 12 — the two engines fight over the body.
 *   Both call `bot.setControlState` / `bot.clearControlStates` (ashfinder: 55 sites in
 *   executor.js; pathfinder: fullStop()/resetPath()). Worse, pvp and collectblock set
 *   pathfinder goals directly, so a hunt or a collect firing during a /goto2 puts both
 *   engines on one body — the #1 operational risk in AUTONOMY_PLAN.
 *   ==> handoff order, both directions, is in takeBody()/releaseBody() below. Note
 *       `bot.pathfinder.setGoal(null)`, NEVER `bot.pathfinder.stop()` — pathfinder's
 *       stop() only sets a `stopPathing` flag that survives until the next reset and
 *       then poisons the following goto with a spurious PathStopped rejection
 *       (movement-engines.md §2.3b).
 *   ==> A watchdog also re-clears any pathfinder goal that appears mid-run and reports
 *       it as `pfInterference` in the response, so cross-engine collisions show up in
 *       the A/B numbers instead of as mystery jitter.
 *
 *
 * ############################################################################
 * # MERGE INSTRUCTIONS for runner.js (three edits, all additive)             #
 * ############################################################################
 *
 *   // (1) module top, next to the other requires
 *   const goto2 = require('./goto2.patch.js');
 *
 *   // (2) inside createBot(), IMMEDIATELY AFTER `bot.loadPlugin(pathfinder);`
 *   //     — this is the load-before-spawn requirement, GOTCHA 0.
 *   goto2.loadAshfinder(bot, log);
 *
 *   // (3) after the http server's `send` helper exists, once per bot instance
 *   //     (e.g. at the end of createBot()):
 *   const ash = goto2.install(bot, null, {
 *     log, announce, send,
 *     getTask: () => currentTask,
 *     setTask: (t) => { currentTask = t; },
 *   });
 *   bot._goto2 = ash;   // so the request handler can reach it
 *
 *   // (4) inside the POST dispatcher, next to the `/goto` block:
 *   if (url.pathname === '/goto2') {
 *     return bot._goto2.handle(req, res, body, url);
 *   }
 *
 *   // (5) optional but recommended, in GET /state:
 *   ash: bot && bot.ashfinder ? (bot.ashfinder.waypointPlanner ? 'ready' : 'load-after-spawn') : false,
 *
 * If `app` is an express-style object with `.post`, install() registers the route
 * itself and step (4) is unnecessary. runner.js uses a raw http.createServer with
 * `url.pathname` dispatch, so pass `app = null` there and use `.handle`.
 *
 *
 * ############################################################################
 * # API                                                                      #
 * ############################################################################
 *
 *   loadAshfinder(bot, log)         -> boolean   MUST run pre-spawn, in createBot()
 *   install(bot, app, opts)         -> { handle, goto2, cancel, isEngineReady, state }
 *   ASH_SAFE_CONFIG                              the config we apply on every run
 *
 * POST /goto2  { x, y, z, range?, timeoutMs?, smart?, dig?, exact? }
 *   range      default 1     GoalNear radius; 0 (or exact:true) means GoalExact
 *   timeoutMs  default 90000 hard wall-clock ceiling on the whole trip
 *   smart      default auto  true past 75 blocks (gotoSmart waypoints), else direct
 *   dig        default false enable block breaking (see GOTCHA 9 — guarded, audited)
 * 200 -> { ok:true, engine:'ashfinder', ms, dist, arrived:true, ...metrics }
 * 4xx/5xx -> { ok:false, error, ...metrics }   metrics are the A/B instrument, they
 *                                              are returned on failure too.
 */

const path = require('path');
const fs = require('fs');
const { Vec3 } = require('vec3');

// ---------------------------------------------------------------------------
// module resolution — done ONCE, at require time, before any bot connects.
// A missing package must degrade to "501 not installed", never to a crash.
// ---------------------------------------------------------------------------
const ashModule = (() => {
  try {
    return require('@miner-org/mineflayer-baritone');
  } catch (_) {
    return null;
  }
})();

/**
 * Config we assert on EVERY run (not once at spawn) — because an abandoned run's
 * zombie `finally` can rewrite thinkTimeout behind our back (GOTCHA 5/6).
 *
 * Only the keys we deliberately diverge from DEFAULT_CONFIG on, plus the ones an
 * abandoned run can corrupt. `config.set(k, v)` validates the key name and throws on
 * a typo, which is why we use it instead of plain assignment.
 */
const ASH_SAFE_CONFIG = {
  // DEFAULT IS TRUE. Parkour jumps are how MettMarcel died off the SE hilltop.
  parkour: false,
  proParkour: false,
  // never leave scaffolding scars; also keeps disposableBlocks irrelevant.
  placeBlocks: false,
  // breaking is opt-in per request and re-disabled in finally (GOTCHA 9).
  breakBlocks: false,
  maxFallDist: 3,
  // 15 s is plenty for the leg lengths we actually use, and bounds a bad run.
  thinkTimeout: 15000,
  stuckTimeout: 5000,
  allowSprinting: true, // the fall deaths were parkour + drops, not sprint
  swimming: true, // a genuine capability gain over pathfinder — the point of /goto2
  fly: false,
  experimentalMoves: false,
};

/**
 * blocksToAvoid additions. ashfinder's default is only
 * ['crafting_table','chest','furnace'].
 *
 * leaf_litter / torch / wall_torch have `shapes: []` on 1.21.11, so every
 * shape-based classifier — pathfinder's Movements AND ashfinder's — treats them as
 * air, plans through them at zero cost, and never clears them. That is the mechanical
 * cause of the documented movement wedges (movement-engines.md §2.4). Listing them
 * here makes the planner route around or dig them out first.
 *
 * The base-infrastructure names are belt-and-braces: they make the PLANNER avoid
 * standing on / breaking our furniture, independently of the dig guard.
 */
const ASH_BLOCKS_TO_AVOID = [
  'crafting_table', 'chest', 'trapped_chest', 'ender_chest', 'furnace',
  'blast_furnace', 'smoker', 'barrel', 'anvil', 'enchanting_table',
  'brewing_stand', 'loom', 'smithing_table', 'bell', 'lodestone',
  'leaf_litter', 'torch', 'wall_torch', 'soul_torch',
  'powder_snow', 'sweet_berry_bush', 'magma_block', 'campfire', 'soul_campfire',
  'pointed_dripstone',
];

// ---------------------------------------------------------------------------
// protected-region loading (FLEET LAW / BASE.md). Best-effort: if protected.json is
// unreadable we fall back to the hardcoded law zones rather than failing open.
// ---------------------------------------------------------------------------

/** Hardcoded FLEET LAW zones — the floor, used even if protected.json is missing. */
const LAW_ZONES = [
  { id: 'base_plaza', min: [-8, 60, -1], max: [2, 130, 9] },
  { id: 'main_hall_1', min: [-7, 105, -7], max: [0, 120, -2] },
  { id: 'house_1', min: [-8, 105, 10], max: [-3, 120, 15] },
  { id: 'farm_pond', min: [-2, 105, 9], max: [4, 120, 15] },
  { id: 'cavecrew_camp', min: [3, 81, 47], max: [19, 97, 63] },
  { id: 'trading_post', min: [4, 106, 20], max: [10, 118, 24] },
];

let _protectedCache = null;
let _protectedMtime = 0;

/**
 * Read protected.json (digguard's registry) and flatten every region to an
 * axis-aligned box. `columns` and `sphere` kinds are converted to their bounding box —
 * deliberately conservative: a corridor check should over-refuse, not under-refuse.
 * Hot-reloads on mtime change, same as digguard.
 * @returns {Array<{id:string,min:number[],max:number[]}>}
 */
function loadProtectedBoxes(baseDir) {
  const file = path.join(baseDir || __dirname, 'protected.json');
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch (_) {
    return LAW_ZONES;
  }
  if (_protectedCache && mtime === _protectedMtime) return _protectedCache;

  const boxes = LAW_ZONES.slice();
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of doc.regions || []) {
      if (r.kind === 'box' && r.min && r.max) {
        boxes.push({ id: r.id, min: r.min, max: r.max });
      } else if (r.kind === 'sphere' && r.center) {
        const [cx, cy, cz] = r.center;
        const rad = r.radius || 0;
        boxes.push({
          id: r.id,
          min: [cx - rad, cy - rad, cz - rad],
          max: [cx + rad, cy + rad, cz + rad],
        });
      } else if (r.kind === 'columns' && Array.isArray(r.columns)) {
        const xs = r.columns.map((c) => c[0]);
        const zs = r.columns.map((c) => c[1]);
        boxes.push({
          id: r.id,
          min: [Math.min(...xs), r.yMin, Math.min(...zs)],
          max: [Math.max(...xs), r.yMax, Math.max(...zs)],
        });
      }
    }
  } catch (_) {
    // malformed protected.json -> keep the hardcoded law zones
  }
  _protectedCache = boxes;
  _protectedMtime = mtime;
  return boxes;
}

/** 3D distance from a point to an AABB (0 when inside). */
function distToBox(p, box) {
  const dx = Math.max(box.min[0] - p.x, 0, p.x - box.max[0]);
  const dy = Math.max(box.min[1] - p.y, 0, p.y - box.max[1]);
  const dz = Math.max(box.min[2] - p.z, 0, p.z - box.max[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Approximate corridor check for a dig-enabled run.
 *
 * ashfinder does NOT expose its planned path before it starts moving, so we sample the
 * straight line start->goal every 4 blocks and require every sample to clear every
 * protected box by `clearance`. This is an approximation — a real path can detour off
 * the segment — which is exactly why guardAshDig() below also checks EVERY individual
 * break at the moment it happens. This check is the cheap early refusal; that one is
 * the actual enforcement.
 *
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
function checkDigCorridor(from, to, boxes, clearance) {
  const total = from.distanceTo(to);
  const steps = Math.max(2, Math.ceil(total / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = new Vec3(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t,
    );
    for (const box of boxes) {
      const d = distToBox(p, box);
      if (d < clearance) {
        return {
          ok: false,
          reason:
            `dig route passes ${d.toFixed(1)} blocks from protected region ` +
            `'${box.id}' (needs >= ${clearance}); ashfinder's dig bypasses digguard, ` +
            'so this is refused outright. Re-run without dig, or route around.',
        };
      }
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// per-bot run state (single-flight mutex + generation token)
// ---------------------------------------------------------------------------
const STATE = new WeakMap();

function stateOf(bot) {
  let s = STATE.get(bot);
  if (!s) {
    s = { inFlight: false, generation: 0, lastRun: null };
    STATE.set(bot, s);
  }
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// STEP 1 — load. Call from createBot(), pre-spawn. See GOTCHA 0.
// ---------------------------------------------------------------------------
/**
 * @param {object} bot        a freshly created, NOT YET SPAWNED mineflayer bot
 * @param {(s:string)=>void} [log]
 * @returns {boolean} true if the plugin attached
 */
function loadAshfinder(bot, log) {
  const say = typeof log === 'function' ? log : () => {};
  if (!ashModule) {
    say('[goto2] @miner-org/mineflayer-baritone not installed — /goto2 disabled');
    return false;
  }
  if (bot.entity) {
    // Loud, because this is the single failure mode that looks fine and isn't.
    say(
      '[goto2] WARNING: loadAshfinder() called on an ALREADY-SPAWNED bot. ' +
      'The path executor will stay null until the next respawn (upstream #10). ' +
      'Move this call into createBot(), next to bot.loadPlugin(pathfinder).',
    );
  }
  try {
    // bot.loadPlugin (not a bare loader(bot)) — loader.js destructures its second
    // argument with no default and would throw on undefined (GOTCHA 10).
    // No options object: useCustomPhysics MUST stay false.
    bot.loadPlugin(ashModule.loader);
    say('[goto2] ashfinder loaded (pre-spawn); /goto2 available after spawn');
    return true;
  } catch (err) {
    say(`[goto2] ashfinder failed to load: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// engine readiness + config
// ---------------------------------------------------------------------------
/**
 * @returns {{ready:boolean, reason?:string}}
 */
function isEngineReady(bot) {
  if (!ashModule) return { ready: false, reason: 'ashfinder not installed' };
  if (!bot || !bot.ashfinder) {
    return { ready: false, reason: 'ashfinder plugin not loaded on this bot' };
  }
  // GOTCHA 0: waypointPlanner is the public twin of the private #pathExecutor. Both
  // are assigned in the plugin's own spawn handler; null means it never ran.
  if (!bot.ashfinder.waypointPlanner) {
    return {
      ready: false,
      reason:
        'ashfinder was loaded AFTER spawn — its path executor is null and every goto ' +
        'would throw (upstream #10). Load it in createBot(), never via /eval. ' +
        'A respawn will also fix it.',
    };
  }
  if (!bot.entity) return { ready: false, reason: 'bot has no entity yet' };
  return { ready: true };
}

/** Assert our safe config. Runs on EVERY request — see GOTCHA 5/6. */
function applyRunConfig(bot, log) {
  const cfg = bot.ashfinder.config;
  for (const [k, v] of Object.entries(ASH_SAFE_CONFIG)) {
    try {
      cfg.set(k, v);
    } catch (err) {
      // set() throws on an unknown key — i.e. the package changed shape under us.
      if (log) log(`[goto2] config key '${k}' rejected by 4.6.2: ${err.message}`);
    }
  }
  const avoid = new Set(cfg.get('blocksToAvoid') || []);
  for (const n of ASH_BLOCKS_TO_AVOID) avoid.add(n);
  cfg.set('blocksToAvoid', [...avoid]);
}

// ---------------------------------------------------------------------------
// engine-conflict guard (GOTCHA 12)
// ---------------------------------------------------------------------------
/**
 * Hand the body to ashfinder: silence every consumer of bot.pathfinder first.
 * Order matters — pvp and collectblock SET pathfinder goals, so they must be stopped
 * before the goal is cleared, or they will just set a new one.
 */
function takeBody(bot) {
  try { if (bot.pvp) bot.pvp.forceStop(); } catch (_) {}
  try {
    if (bot.collectBlock && bot.collectBlock.cancelTask) {
      const p = bot.collectBlock.cancelTask();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (_) {}
  // setGoal(null), NEVER stop(): pathfinder's stop() sets a stopPathing flag that
  // survives until the next resetPath and then rejects the FOLLOWING goto with a
  // spurious PathStopped (movement-engines.md §2.3b).
  try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_) {}
}

/** Hand the body back to pathfinder: ashfinder must be fully stopped first. */
function releaseBody(bot) {
  try { if (bot.ashfinder) bot.ashfinder.stopFollowing(); } catch (_) {}
  try { if (bot.ashfinder) bot.ashfinder.stop(); } catch (_) {}
  try { bot.clearControlStates(); } catch (_) {}
}

/**
 * Watchdog: if anything (a hunt trigger, an idle-guard, a driver) sets a pathfinder
 * goal while ashfinder owns the body, clear it immediately and count the event.
 * Returns a stop function; the counter is read for the response metrics.
 */
function startPathfinderGuard(bot, counter) {
  const iv = setInterval(() => {
    try {
      if (bot.pathfinder && bot.pathfinder.goal) {
        bot.pathfinder.setGoal(null);
        counter.n += 1;
      }
    } catch (_) {}
  }, 500);
  if (iv.unref) iv.unref();
  return () => clearInterval(iv);
}

// ---------------------------------------------------------------------------
// dig audit + enforcement (GOTCHA 9)
// ---------------------------------------------------------------------------
/**
 * Wrap bot.ashDig for the duration of one run: count every break, and refuse any block
 * inside a protected region. This is the ONLY thing standing between ashfinder's raw
 * block_dig packets and BASE.md's structures — digguard.js cannot see them at all.
 *
 * A refusal throws inside the executor, which surfaces as a failed leg rather than a
 * destroyed chest. That is the correct trade.
 *
 * @returns {{restore:()=>void, counter:{n:number,refused:number}}}
 */
function guardAshDig(bot, boxes, counter) {
  const orig = typeof bot.ashDig === 'function' ? bot.ashDig.bind(bot) : null;
  if (!orig) return { restore: () => {}, counter };
  bot.ashDig = async (block, opts) => {
    try {
      const p = block && block.position;
      if (p) {
        for (const box of boxes) {
          if (distToBox(p, box) === 0) {
            counter.refused += 1;
            throw new Error(
              `goto2: refusing to break ${block.name} at ${p} — inside protected ` +
              `region '${box.id}' (FLEET LAW / BASE.md)`,
            );
          }
        }
      }
    } catch (err) {
      // rethrow only our own refusal; never let a probe bug block movement
      if (err && /refusing to break/.test(err.message)) throw err;
    }
    counter.n += 1;
    return orig(block, opts);
  };
  return { restore: () => { bot.ashDig = orig; }, counter };
}

// ---------------------------------------------------------------------------
// arrival assertion (GOTCHA 2 + 3)
// ---------------------------------------------------------------------------
/**
 * The library lies about arrival in three different ways. Position is the only truth.
 *
 * Settle window: the executor resolves a tick or two before physics finishes moving
 * the body, so an immediate distance read can be pessimistic by ~1 block. We poll for
 * up to `settleMs`, taking the first sample that satisfies the goal.
 */
async function assertArrival(bot, goal, target, tolerance, settleMs = 800) {
  const deadline = Date.now() + settleMs;
  let best = Infinity;
  for (;;) {
    const pos = bot.entity && bot.entity.position;
    if (pos) {
      const d = pos.distanceTo(target);
      if (d < best) best = d;
      let reached = false;
      try { reached = goal.isReached(pos); } catch (_) {}
      if (reached || d <= tolerance) return { arrived: true, dist: d };
    }
    if (Date.now() >= deadline) {
      return { arrived: false, dist: best === Infinity ? null : best };
    }
    await sleep(100);
  }
}

// ---------------------------------------------------------------------------
// cancellation (GOTCHA 4 + 7)
// ---------------------------------------------------------------------------
/**
 * stop() the engine HARD.
 *
 * One stop() is not enough for gotoSmart: its waypoint loop has no abort check, and
 * stop() sets exactly the `stopped = true` state the loop's next goto() needs in order
 * to start. So we hammer stop() on a poll long enough for the loop to give up or for
 * the caller to stop caring. The library promise is never awaited again either way —
 * executor.stop() leaves it pending forever.
 */
async function cancelAsh(bot, { pollMs = 200, forMs = 3000 } = {}) {
  const until = Date.now() + forMs;
  do {
    try { bot.ashfinder.stop(); } catch (_) {}
    await sleep(pollMs);
  } while (Date.now() < until && bot.ashfinder && bot.ashfinder.isPathing);
  try { bot.clearControlStates(); } catch (_) {}
}

// ---------------------------------------------------------------------------
// STEP 2 — install. Call once per bot instance, after the http helpers exist.
// ---------------------------------------------------------------------------
/**
 * @param {object} bot
 * @param {object|null} app  express-style app (uses .post) or null for raw http
 * @param {object} [opts]
 * @param {(s:string)=>void} [opts.log]
 * @param {(s:string)=>void} [opts.announce]   in-game chat narration (FLEET LAW)
 * @param {(res,status,obj)=>void} [opts.send] runner.js's json responder
 * @param {()=>any} [opts.getTask]             task mutex read  (409 when busy)
 * @param {(t:any)=>void} [opts.setTask]       task mutex write
 * @param {string} [opts.baseDir]              where protected.json lives
 * @param {number} [opts.digClearance]         default 24 blocks
 */
function install(bot, app, opts = {}) {
  const log = opts.log || (() => {});
  const announce = opts.announce || (() => {});
  const send =
    opts.send ||
    ((res, status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj) + '\n');
    });
  const getTask = opts.getTask || (() => null);
  const setTask = opts.setTask || (() => {});
  const baseDir = opts.baseDir || __dirname;
  const digClearance = typeof opts.digClearance === 'number' ? opts.digClearance : 24;

  /**
   * The whole trip. Returns a plain result object; never throws.
   * Every field is an A/B metric (research/goto2-ab-plan.md) and is present on
   * failures too — a failed trip is a data point, not a void.
   */
  async function goto2(params) {
    const t0 = Date.now();
    const {
      x, y, z,
      range = 1,
      timeoutMs = 90000,
      dig = false,
      exact = false,
    } = params || {};

    const metrics = {
      engine: 'ashfinder',
      ms: 0,
      dist: null,
      arrived: false,
      ashStatus: null,
      smart: null,
      blocksBroken: 0,
      digsRefused: 0,
      pfInterference: 0,
      hpDelta: 0,
      timedOut: false,
    };

    if (![x, y, z].every((n) => typeof n === 'number' && isFinite(n))) {
      return { ok: false, status: 400, error: 'need numeric {"x","y","z"}', ...metrics };
    }

    const ready = isEngineReady(bot);
    if (!ready.ready) {
      const code = ashModule ? 503 : 501;
      return { ok: false, status: code, error: ready.reason, ...metrics };
    }

    const st = stateOf(bot);
    if (st.inFlight) {
      // GOTCHA 5: bot.ashfinder.stopped is not trustworthy, so we keep our own flag.
      // Strict single-flight is also what keeps the zombie-promise contamination to a
      // harmless "run N resolves late during run N+1" instead of three-way chaos.
      return { ok: false, status: 409, error: 'goto2 already running on this bot', ...metrics };
    }
    const task = getTask();
    if (task) {
      return { ok: false, status: 409, error: `busy: ${task.type || 'task'}`, ...metrics };
    }

    const target = new Vec3(x, y, z);
    const from = bot.entity.position.clone();
    const distance = from.distanceTo(target);
    // smart:true decomposes into <=75-block legs. Beyond ~75 blocks that is strictly
    // better, because a DIRECT goto to an unloaded chunk silently gets a 1 s search
    // budget (GOTCHA 6). Under it, direct is cheaper and — crucially — cancellable
    // (GOTCHA 7), so we only pay the smart tax when the distance demands it.
    const smart = typeof params.smart === 'boolean' ? params.smart : distance > 75;
    metrics.smart = smart;

    const boxes = loadProtectedBoxes(baseDir);
    if (dig) {
      const corridor = checkDigCorridor(from, target, boxes, digClearance);
      if (!corridor.ok) {
        return { ok: false, status: 403, error: corridor.reason, ...metrics };
      }
    }

    const goal = (exact || range <= 0)
      ? new ashModule.goals.GoalExact(target)
      : new ashModule.goals.GoalNear(target, range);
    // GoalNear.isReached is a centre-distance test; allow one block of physics slop on
    // top of the requested range before we call a trip short.
    const tolerance = Math.max(range, 1) + 1.0;

    st.inFlight = true;
    const gen = ++st.generation;
    setTask({ type: 'goto2', detail: `(${x}, ${y}, ${z}) r${range}`, startedAt: new Date().toISOString() });

    const hp0 = typeof bot.health === 'number' ? bot.health : null;
    const pfCounter = { n: 0 };
    const digCounter = { n: 0, refused: 0 };
    let stopPfGuard = () => {};
    let digGuard = { restore: () => {} };
    let timer = null;

    announce(
      `Trying engine 2 (ashfinder) to (${x}, ${y}, ${z})` +
      `${smart ? ' via waypoints' : ''}${dig ? ', digging allowed' : ''}.`,
    );
    log(`<api> goto2 (${x}, ${y}, ${z}) range=${range} smart=${smart} dig=${dig} d=${distance.toFixed(1)}`);

    try {
      applyRunConfig(bot, log);
      takeBody(bot);
      stopPfGuard = startPathfinderGuard(bot, pfCounter);

      if (dig) {
        digGuard = guardAshDig(bot, boxes, digCounter);
        bot.ashfinder.enableBreaking();
      } else {
        bot.ashfinder.disableBreaking();
      }
      bot.ashfinder.disablePlacing();
      bot.ashfinder.disableParkour();

      // The library promise. NOTE: we may never see it settle (GOTCHA 4). It is
      // raced, never re-awaited, and given a no-op catch so an abandoned rejection
      // cannot become an unhandledRejection and take the process down.
      const nav = smart
        ? bot.ashfinder.gotoSmart(goal, { waypointThreshold: 75 })
        : bot.ashfinder.goto(goal);
      if (nav && typeof nav.catch === 'function') nav.catch(() => {});

      let timedOut = false;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => { timedOut = true; resolve({ __timeout: true }); }, timeoutMs);
        if (timer.unref) timer.unref();
      });

      const raced = await Promise.race([nav, timeout]);
      clearTimeout(timer);

      if (timedOut || (raced && raced.__timeout)) {
        metrics.timedOut = true;
        await cancelAsh(bot);
      } else {
        // GOTCHA 1: failure is a RETURN VALUE. goto() gives success|failed;
        // gotoSmart() can also give partial|failed from the waypoint planner.
        metrics.ashStatus = (raced && raced.status) || 'unknown';
      }

      // GOTCHA 2 + 3: the status is not evidence. Position is.
      const arrival = await assertArrival(bot, goal, target, tolerance);
      metrics.arrived = arrival.arrived;
      metrics.dist = arrival.dist;
      metrics.ms = Date.now() - t0;
      metrics.blocksBroken = digCounter.n;
      metrics.digsRefused = digCounter.refused;
      metrics.pfInterference = pfCounter.n;
      metrics.hpDelta =
        hp0 != null && typeof bot.health === 'number' ? +(bot.health - hp0).toFixed(1) : 0;

      if (gen !== st.generation) {
        return { ok: false, status: 409, error: 'superseded by a newer goto2', ...metrics };
      }

      if (!arrival.arrived) {
        const why = metrics.timedOut
          ? `timed out after ${timeoutMs}ms`
          : `engine reported '${metrics.ashStatus}'`;
        const short = metrics.dist == null ? 'unknown distance' : `${metrics.dist.toFixed(1)} blocks short`;
        announce(`Engine 2 did not get me there (${short}). Falling back to normal pathing.`);
        return { ok: false, status: 500, error: `goto2 ${why}; stopped ${short}`, ...metrics };
      }

      announce(`Arrived at (${x}, ${y}, ${z}) with engine 2 in ${(metrics.ms / 1000).toFixed(1)}s.`);
      return { ok: true, status: 200, position: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }, ...metrics };
    } catch (err) {
      // The only expected throw is "Already navigating." — which means the library's
      // own latch disagrees with ours (a zombie run, GOTCHA 5). Hammer stop() and
      // report honestly rather than leaving two engines half-owning the body.
      metrics.ms = Date.now() - t0;
      metrics.blocksBroken = digCounter.n;
      metrics.digsRefused = digCounter.refused;
      metrics.pfInterference = pfCounter.n;
      try { await cancelAsh(bot, { forMs: 1500 }); } catch (_) {}
      log(`[goto2] error: ${err.message}`);
      return { ok: false, status: 500, error: err.message, ...metrics };
    } finally {
      clearTimeout(timer);
      stopPfGuard();
      try { bot.ashfinder.disableBreaking(); } catch (_) {}
      digGuard.restore();
      releaseBody(bot);
      // Re-assert thinkTimeout: an abandoned run's zombie finally may have left the
      // 1000 ms unloaded-chunk clamp in place (GOTCHA 6).
      try { bot.ashfinder.config.set('thinkTimeout', ASH_SAFE_CONFIG.thinkTimeout); } catch (_) {}
      st.inFlight = false;
      st.lastRun = { at: new Date().toISOString(), target: { x, y, z }, ...metrics };
      setTask(null);
    }
  }

  /** Raw-http handler for runner.js's `url.pathname` dispatcher. */
  async function handle(req, res, body) {
    const r = await goto2(body || {});
    const { status, ...rest } = r;
    return send(res, status || (r.ok ? 200 : 500), rest);
  }

  // express-style registration, when an app is actually passed.
  if (app && typeof app.post === 'function') {
    app.post('/goto2', async (req, res) => {
      const r = await goto2(req.body || {});
      const { status, ...rest } = r;
      res.status(status || (r.ok ? 200 : 500)).json(rest);
    });
    log('[goto2] registered POST /goto2 on the provided app');
  }

  return {
    handle,
    goto2,
    cancel: () => cancelAsh(bot),
    isEngineReady: () => isEngineReady(bot),
    /** for GET /state */
    state: () => {
      const r = isEngineReady(bot);
      const s = stateOf(bot);
      return {
        installed: !!ashModule,
        ready: r.ready,
        reason: r.reason || null,
        inFlight: s.inFlight,
        lastRun: s.lastRun,
      };
    },
  };
}

module.exports = {
  install,
  loadAshfinder,
  isEngineReady,
  ASH_SAFE_CONFIG,
  ASH_BLOCKS_TO_AVOID,
  // exported for tests / the A/B harness
  _internal: { loadProtectedBoxes, checkDigCorridor, distToBox, assertArrival, cancelAsh },
};
