# Movement engines: research report (TODO 2)

Research agent, 2026-09-01. Scope: (a) `@miner-org/mineflayer-baritone` ("ashfinder") 4.6.2,
(b) mineflayer-pathfinder 2.4.5 tuning we are not using, (c) real-Baritone sidecar readiness,
(d) adoption verdict per route class.

Method: read-only. Every claim below is either (i) traced in source on this box
(`/home/felix/minecraft/bots/node_modules/mineflayer-pathfinder`), (ii) traced in the ashfinder
source pulled from GitHub `main` @ 4.6.2, (iii) measured against local `minecraft-data` 3.115.0
for 1.21.11, or (iv) a live HTTP fetch of an artifact/registry (URLs + checksums given).
Nothing was installed, nothing in the engine was modified.

---

## 0. TL;DR — the verdict up front

**The biggest movement win available right now is not a new engine. It is five lines of
pathfinder configuration we never set, plus two source-level bugs in how we call `goto`.**

Three findings that change the roadmap:

1. **`leaf_litter` and `torch` are classified as `emptyBlocks` (air-equivalent) by
   pathfinder's `Movements` constructor** — measured, see §2.4. A* therefore plans *through*
   them at zero cost and never clears them, which is the mechanical cause of both documented
   wedges. The one-line fix (`movements.blocksToAvoid.add(...)`) makes the planner *dig them
   out before stepping in*, at a cost of ~1. This retires two FEEDBACK.md entries.
2. **`bot.pathfinder.goto()` can resolve as SUCCESS while the bot never moved.** Source-level:
   `lib/goto.js` checks `results.path.length === 0` *before* it checks `results.status ===
   'noPath'`, and `astar.js` returns `noPath` with `bestNode = startNode`, whose reconstructed
   path is `[]`. So an unreachable goal from a boxed-in position resolves cleanly. Every
   `goto` must be followed by an arrival assertion. `skills.js ctx.goto` currently does not do
   this (§2.3).
3. **The Java 21 blocker on the real-Baritone sidecar no longer exists.** HeadlessMc 2.5.0+
   downloads its own Java distribution, and 2.10.0 ships a GraalVM native `linux-x64`
   executable that needs no JVM at all. `sudo pacman -S jdk21-openjdk` is now optional
   convenience, not a prerequisite (§3.2). All four artifacts for a 1.21.11 sidecar were
   fetched and verified today, including a checksum (§3.1), and one of AUTONOMY_PLAN's open
   unknowns — "hmc-specifics may require fabric-api" — is **resolved: it does not** (§3.3).

Route-class verdict (detail in §4):

| Route class | Engine | Why |
|---|---|---|
| Short base moves (<40 blocks, cluttered) | **pathfinder**, `WORK` profile | Ashfinder buys nothing; pvp/collectblock need `bot.pathfinder` anyway |
| Long surface haul (>80 blocks) | **pathfinder + multi-leg waypointing**, `HAUL` profile | Fixes the real cause (5s think budget + no sprint), no new dependency |
| Deep mining / descent | **pathfinder**, `CAVE` profile | Ashfinder's parkour/swim strengths are irrelevant at depth; its dig path is a hand-rolled packet writer (§1.6) |
| Terrain pathfinder genuinely cannot solve | **ashfinder behind `/goto2`, opt-in, never default** | Real capability gap (parkour, swimming, ladders), but beta-grade |
| Fleet-scale long-haul + `#mine` quality | **real-Baritone sidecar**, now unblocked | Phase 2, one bot, ~2 GB |

**Do not make ashfinder the default for anything.** Adopt it as a *fallback* that `/goto` falls
through to after pathfinder fails, and only after the A/B in §1.9.

---

## 1. ashfinder — `@miner-org/mineflayer-baritone` 4.6.2

Repo: <https://github.com/miner-org/mineflayer-baritone> ·
npm: <https://www.npmjs.com/package/@miner-org/mineflayer-baritone>

### 1.1 Maturity signals (fetched 2026-09-01)

| Signal | Value |
|---|---|
| Latest version | 4.6.2, published **2026-08-29** (two days ago) |
| Releases | 20 versions since 2025-02-09 |
| Stars / forks / watchers | 42 / 2 / 3 |
| Open issues | 3 (one real: #9; two are dependabot bumps from 2024) |
| Last push | 2026-08-29 |
| CI | none in the repo tree |
| LICENSE file | **absent** (GitHub reports `license: null`); `package.json` says ISC |
| Maintainer | single ("Ash"); commit messages are `"my dick is massive"`, `"gay"`, `"typ shi"` |
| Transitive license | `@nxg-org/mineflayer-physics-util` is **GPL-3.0** |

Read that as: a talented solo hobby project under active development, with no release
discipline and no compatibility contract. It is worth adopting as an *optional escape hatch*
and worth pinning `--save-exact`. It is not worth putting on the critical path.

Install footprint against our tree — all peer ranges already satisfied
(mineflayer 4.38.0 ≥ ^4.35.0, minecraft-data 3.115.0 ≥ ^3.94.0,
minecraft-protocol 1.68.0 ≥ ^1.57.0, Node v24.20.0):

```
npm install --save-exact @miner-org/mineflayer-baritone@4.6.2
# adds ~5 packages: the plugin, @miner-org/mineflayer-physics-reworked,
# @nxg-org/mineflayer-physics-util, @nxg-org/mineflayer-util-plugin, require-dir
```

### 1.2 Loading it — three gotchas, all source-verified

`src/loader.js`:

```js
function inject(bot, { useCustomPhysics = false }) {
  ashDig(bot)                              // adds bot.ashDig — does NOT override bot.dig
  bot.ashfinder = new AshFinderPlugin(bot)
  if (useCustomPhysics) { physicsLoader(bot); bot.ashfinder.config.usingCustomPhysics = true }
}
```

1. **The second parameter is destructured with no default.** `bot.loadPlugin(loader)` is safe
   (mineflayer passes its options object), but a bare `loader(bot)` throws
   `TypeError: Cannot destructure property 'useCustomPhysics' of 'undefined'`.
2. **Never pass `useCustomPhysics: true`.** It swaps in `@miner-org/mineflayer-physics-reworked`
   for the whole bot. Every other consumer of `bot.physics` (pathfinder's `lib/physics.js`,
   our own code) would then be running on an unrelated physics implementation. With the flag
   off, ashfinder uses mineflayer's own `bot.physics.simulatePlayer` (`src/utils.js:129`), and
   the nxg physics-util imports are commented out — good.
3. **⚠️ It MUST be loaded before spawn.** `AshFinderPlugin`'s constructor only creates the
   `PathExecutor` inside `bot.on("spawn", ...)`. If you load the plugin into an already-spawned
   bot — **which is exactly what our `./inject.sh` + `/eval` payload pattern does** — the
   executor stays `null` until the next respawn, and the first `goto` dies with
   `TypeError: Cannot read properties of null (reading 'setPath')`. This is upstream issue
   [#10](https://github.com/miner-org/mineflayer-baritone/issues/10), reported against 4.5.1,
   still present in 4.6.2. **Load ashfinder in `runner.js createBot()` next to
   `bot.loadPlugin(pathfinder)`, never via `/eval`.**

### 1.3 API surface (verified against `index.js`, `src/AshFinder.js`, `src/goal.js`)

```js
const { loader, goals } = require('@miner-org/mineflayer-baritone')
bot.loadPlugin(loader)

await bot.ashfinder.goto(goal)                  // direct A*; RETURNS a status object
await bot.ashfinder.gotoSmart(goal, opts)       // auto-waypoints past 75 blocks
await bot.ashfinder.gotoWithWaypoints(goal, 75) // legacy alias for gotoSmart
await bot.ashfinder.generatePath(goal, opts)    // plan without executing
await bot.ashfinder.gotoWithPath(result, goal)  // execute a pre-computed plan
bot.ashfinder.followEntity(entity, { distance: 2, updateInterval: 500 })
bot.ashfinder.stopFollowing()
bot.ashfinder.stop()
bot.ashfinder.enableBreaking() / disableBreaking()
bot.ashfinder.enablePlacing()  / disablePlacing()
bot.ashfinder.enableParkour()  / disableParkour()
bot.ashfinder.enableFlight()   / disableFlight()   // elytra; validates you own one, else throws
bot.ashfinder.debug = true
bot.ashfinder.stopped  // boolean
bot.ashfinder.config   // AshFinderConfig instance, .set(k,v)/.get(k) validate the key name
// events: 'pathStarted', 'goal-reach', 'goal-reach-partial', 'waypoint-reached', 'stopped'
```

**Exported goals** (`index.js`, 9 of them): `GoalExact`, `GoalNear(pos, distance)`,
`GoalYLevel`, `GoalRegion(cornerA, cornerB)`, `GoalAvoid(pos, minDist, bot)`,
`GoalComposite(goals, 'any'|'all')`, `GoalInvert(goal)`, `GoalXZ`, `GoalXZNear(pos, distance)`.
All take a `Vec3`, not `(x,y,z)` — different from mineflayer-pathfinder.

**The README lies about the goal list.** It documents `goals.GoalLookAtBlock`, which `index.js`
does **not** export. `src/goal.js` actually defines nine *more* goals that are unreachable from
the package root: `GoalDynamic`, `GoalNearXZ`, `GoalNearAvoid`, `GoalFollowEntity`,
`GoalAvoidXZ`, `GoalLookAtBlock(pos, world, {reach})`, `GoalLookAtBlockFace`,
`GoalNearBlockFace`. To get them: `require('@miner-org/mineflayer-baritone/src/goal')` — a deep
import into `src/`, acceptable only because we pin `--save-exact`.

### 1.4 Config: defaults vs our safety doctrine

Defaults from `DEFAULT_CONFIG` in `src/AshFinder.js`:

| Key | Default | Our doctrine | Action |
|---|---|---|---|
| `parkour` | **`true`** | forbidden (fall deaths) | **`bot.ashfinder.disableParkour()`** |
| `proParkour` | `false` | — | leave |
| `allowSprinting` | `true` | currently false | see §2.6 — probably re-enable for hauls |
| `maxFallDist` | `3` | 3 | matches |
| `breakBlocks` | `false` | opt-in | `enableBreaking()` only for mining routes |
| `placeBlocks` | `false` | forbidden (no scaffolding scars) | leave `false` |
| `swimming` | `true` | — | leave; it is a genuine capability gain |
| `fly` | `false` | — | leave |
| `thinkTimeout` | `30000` | — | 30 s wall-clock A*; see §1.7 |
| `stuckTimeout` | `5000` | — | its own stall detector |
| `maxPartialPaths` | `5` | — | replan chain limit |
| `hWeight` | `1.67` | — | **inadmissible/greedy heuristic**: faster searches, longer paths |
| `blocksToAvoid` | `['crafting_table','chest','furnace']` | good | add `'leaf_litter'`, `'torch'`, `'wall_torch'` |
| `blocksToStayAway` + `avoidDistance: 8` | lava/cactus/cobweb/gravel, r=8 | good | keep |
| `disposableBlocks` | dirt, cobblestone, stone, … | only used when `placeBlocks` | harmless while placing is off |
| `closeInteractables` | `true` | — | it closes doors behind itself; nice |
| `climbableBlocks` | vine, ladder, scaffolding | — | ladders/vines are a real gain over pathfinder (which has `vine` commented out of `climbables`) |

Note `hWeight: 1.67` is the fundamental difference in search character from pathfinder
(`f = g + h`, admissible, optimal). Ashfinder trades path optimality for search speed. On long
hauls that is usually the right trade; in tight quarters it produces detours.

### 1.5 Genuine capability gains over pathfinder 2.4.5

- **Swimming** with proper vertical control and water entry/exit (`src/movement/swin.js`,
  10.8 KB). pathfinder treats water as `liquidCost` terrain and drowns bots in deep water.
- **Ladder/vine climbing up *and* down** — pathfinder has `climbables` = ladder only, with
  `vine` explicitly commented out.
- **Waypoint decomposition for long hauls** (`SmartWaypointPlanner`, `src/waypoints.js`) —
  chunked legs past 75 blocks. This is the right idea; §2.7 shows how to get it on pathfinder
  without the dependency.
- **A path cache** keyed by chunk with 30 s TTL and per-block invalidation.
- **Cooperative A*** — the search `await`s a `setTimeout(0)` every 5 ms
  (`src/pathfinder.js:511`), so a 30 s think budget does *not* block the Node event loop.
  Pathfinder achieves the same thing differently (40 ms slices on `physicsTick`).
- **Door/gate handling that actually works** — pathfinder ships `canOpenDoors = false` with
  the comment `"Causes issues. Probably due to none paper servers."`

### 1.6 Source-level bugs and risks found in 4.6.2

Read these before writing any integration code.

**(1) `goto()` never throws on failure — and reports success when it fails.**
`AshFinder.js goto()` wraps everything in `try/catch` and returns
`{ status: 'success' }` or `{ status: 'failed', error }`. It only *throws* for
`"Already navigating"`. So:

```js
await bot.ashfinder.goto(goal)          // WRONG — swallows every failure
const r = await bot.ashfinder.goto(goal) // right
if (r.status !== 'success') throw ...
```

**(2) Worse: `status: 'success'` does not mean you arrived.** In `src/executor.js`,
`_onPathEnd()` calls `_resolveCompletion()` on the "partial path exhausted with no
continuation" branch too. So an unreachable goal resolves as success. This is upstream issue
[#7](https://github.com/miner-org/mineflayer-baritone/issues/7) ("It doesnt do anything and
after some time it just prints 'Goal reached'"), which the maintainer diagnosed as a logging
gap rather than fixing. **Always assert arrival by distance after `goto`.** (Same rule as
§2.3 for pathfinder — write it once, apply to both engines.)

**(3) A real logic bug in the stuck-replan path.** `src/executor.js handleStuck()`:

```js
const newPath = await this._generateNextPath();
if (!newPath.success === false) {          // parses as (!newPath.success) === false
  ...return  // dead branch for the {success:false} case
}
this.setPath(newPath.path, ...)            // called with undefined on "no path"
```

For the failure object `{success:false}`, `!false === false` → `true === false` → `false`, so
the guard does **not** fire and `setPath(undefined)` runs. The next tick sees `!this.path` and
routes to `_onPathEnd()` → resolves completion → **success**. A bot that gets stuck and cannot
replan reports a successful arrival. Mitigated entirely by rule (2)'s arrival assertion.

**(4) `PathExecutor`'s 20 ms loop is never stopped.** `_startLoop()` sets `running = true` and
self-schedules `setTimeout(loop, 20)` forever; `stop()` sets `executing = false` but **not**
`running = false`. A fresh `PathExecutor` is constructed on **every** `spawn` event — which
mineflayer fires on every respawn — so each bot death leaks one ever-running 50 Hz no-op loop plus
its captured `bot` reference. Negligible for a handful of deaths, real over a long-lived
process that dies dozens of times. Watch it if you adopt.

**(5) `bot.ashTool` is referenced but never defined.** `src/utils/ashDig.js:60` calls
`await bot.ashTool.equipBest(block)` when `autoTool` is true (the default). Nothing in the
package defines `bot.ashTool`. The executor's own dig call passes `autoTool: false`
(`executor.js:833`), so the pathing path is safe — but **never call `bot.ashDig(block)`
yourself without `{ autoTool: false }`**, it will throw.

**(6) `bot.ashDig` is a hand-rolled dig that bypasses mineflayer.** It writes raw `block_dig`
packets (status 0/2), computes its own dig time from `mcData.materials[block.material]` plus a
special case for `copper`, and sends FINISH after a `setTimeout(digTime)`. On 1.21.11, if the
material→multiplier lookup misses, `blockBreakingSpeed` falls back to `1` (bare-hands speed)
and FINISH goes out early; the server rejects the break and the executor waits on a
`blockUpdate` that never comes. This is the single most likely 1.21.x failure mode. It only
matters with `breakBlocks: true` — one more reason to leave breaking off for a first adoption.

**(7) Hardcoded 1.18.2 registry.** `src/utils.js:4`:
`const mcData = require("minecraft-data")("1.18.2")`. Used at `:365` in `getItem()` for
`mcData.itemsByName[item]`, on the scaffolding/place path. Item names are mostly stable across
versions so this probably still resolves, but it is a loud signal that nobody has audited this
package for modern versions. (The movement module does it right:
`src/movement/index.js:203` uses `require("minecraft-data")(bot.version)`.)

**(8) `stop()` calls `bot.clearControlStates()`** — and so does pathfinder's `resetPath()`.
The two engines actively clobber each other's controls. Strict mutex is mandatory, not
advisory (§1.8).

### 1.7 1.21.x compatibility evidence

**Positive:** classification is version-agnostic (`boundingBox === 'block' | 'empty'` and
`block.shapes[0][4]`, `src/movement/index.js:281-301`), so no per-version block table to rot;
`minecraft-data` is resolved from `bot.version` in the movement module; the package declares
`minecraft-data ^3.94.0` (our 3.115.0 has full 1.21.11 data, protocol 774 — verified locally);
4.6.2 was published two days ago against a current mineflayer.

**Negative:** the repo makes **no version-support claim anywhere** — no compatibility matrix in
the README, no CI, no test matrix. The only user-reported version in the issue tracker is
1.20.1 (#7). The hardcoded `1.18.2` registry (§1.6.7) and the hand-rolled dig-time model
(§1.6.6) are the two places where a 1.21.11 divergence would actually bite.

**Verdict: plausible but unproven on 1.21.11. There is no substitute for the A/B in §1.9.**

### 1.8 Coexistence with mineflayer-pathfinder

**They can be loaded together safely; they cannot be *run* together.**

Why they can coexist: ashfinder namespaces everything under `bot.ashfinder` / `bot.ashDig`,
does not monkey-patch `bot.dig`, and registers no `physicsTick` handler. Pathfinder's
`monitorMovement` runs every `physicsTick` but returns immediately when `stateGoal` is null and
`path` is empty — cheap and inert.

Why they must never run concurrently:

- Both call `bot.setControlState` / `bot.clearControlStates` (ashfinder: 55 call sites in
  `executor.js`; pathfinder: `fullStop()`, `resetPath()`). Concurrent operation = jitter,
  or a cliff walk.
- `mineflayer-pvp` and `mineflayer-collectblock` are **hard-welded to `bot.pathfinder`** —
  they set pathfinder goals directly. Any hunt or collect that fires during a `/goto2` puts
  both engines on the body at once. This is the #1 operational risk.
- Pathfinder's `blockUpdate` handler calls `resetPath(..., false)` whenever a block near
  *its* path changes — including blocks ashfinder is breaking.

**Rules for the runner:**

```js
// before ANY ashfinder call
bot.pathfinder.setGoal(null)        // NOT bot.pathfinder.stop() — see §2.3
// before ANY pathfinder call
try { bot.ashfinder.stop() } catch {}
// /stop cleanup order (AUTONOMY_PLAN step 3, extended)
try { bot.pvp.forceStop() } catch {}
await bot.collectBlock.cancelTask().catch(() => {})
bot.pathfinder.setGoal(null)
try { bot.ashfinder.stopFollowing() } catch {}   // stopFollowing() also calls stop()
```

and the strict 409-on-busy task mutex from AUTONOMY_PLAN step 3 must cover `/goto2`.

### 1.9 Implementation-ready `/goto2` route

In `runner.js`, next to `bot.loadPlugin(pathfinder)` — **not** via `/eval` (§1.2):

```js
// --- top of file
const ashfinderPlugin = (() => { try { return require('@miner-org/mineflayer-baritone') } catch { return null } })();

// --- inside createBot(), immediately after bot.loadPlugin(pathfinder)
if (ashfinderPlugin) {
  try { bot.loadPlugin(ashfinderPlugin.loader); } catch (e) { log(`ashfinder failed to load: ${e.message}`); }
}

// --- inside the spawn handler, alongside the safe Movements profile
if (bot.ashfinder) {
  bot.ashfinder.disableParkour();     // default is TRUE — fall risk
  bot.ashfinder.disablePlacing();     // no scaffolding scars (already default)
  bot.ashfinder.disableBreaking();    // opt-in per request (already default)
  bot.ashfinder.config.maxFallDist = 3;
  bot.ashfinder.config.blocksToAvoid.push('leaf_litter', 'torch', 'wall_torch');
  bot.ashfinder.config.thinkTimeout = 15000;
}

// --- route
if (url.pathname === '/goto2') {
  if (!bot.ashfinder) return json(res, 501, { error: 'ashfinder not installed' });
  if (currentTask) return json(res, 409, { error: 'busy', task: currentTask.type });
  const { x, y, z, range = 1, timeoutMs = 90000, smart = true, dig = false } = body;
  const target = new Vec3(x, y, z);
  const { goals: ag } = ashfinderPlugin;
  const goal = range > 0 ? new ag.GoalNear(target, range) : new ag.GoalExact(target);

  currentTask = { type: 'goto2' };
  bot.pathfinder.setGoal(null);                      // hand the body over cleanly
  if (dig) bot.ashfinder.enableBreaking();

  const t0 = Date.now();
  let timer;
  try {
    const nav = smart ? bot.ashfinder.gotoSmart(goal) : bot.ashfinder.goto(goal);
    const r = await Promise.race([
      nav,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`goto2 timed out after ${timeoutMs}ms`)), timeoutMs); })
    ]);
    // rule (1): goto NEVER throws on failure
    if (r && r.status && r.status !== 'success') throw new Error(`ashfinder: ${r.error?.message || r.status}`);
    // rules (2)+(3): 'success' does not mean arrived
    const d = bot.entity.position.distanceTo(target);
    if (d > Math.max(range, 1) + 1.5) throw new Error(`ashfinder reported success but stopped ${d.toFixed(1)} blocks short`);
    return json(res, 200, { ok: true, ms: Date.now() - t0, dist: d });
  } catch (err) {
    try { bot.ashfinder.stop(); } catch {}
    return json(res, 500, { error: err.message, ms: Date.now() - t0 });
  } finally {
    clearTimeout(timer);
    if (dig) bot.ashfinder.disableBreaking();
    try { bot.ashfinder.stop(); } catch {}
    currentTask = null;
  }
}
```

Also add `ash: !!bot.ashfinder` to `GET /state` so drivers can see whether the second engine
exists on a given bot.

### 1.10 A/B protocol (do this before believing anything above)

Run on **one** bot (spawn a throwaway, e.g. port 3106) with the fleet elsewhere. Six routes ×
5 runs × 2 engines = 60 trips, one afternoon:

| # | Route class | Suggested endpoints |
|---|---|---|
| R1 | Short cluttered base move | depot chest A → crafting_table_1 |
| R2 | The known 60 s timeout | depot → NW forest detour (TODO 2 names this route) |
| R3 | Long open surface haul | plaza → SE hilltop, >150 blocks |
| R4 | Hilly/edge-prone (killed Marcel) | plaza → SE hilltop ridge line |
| R5 | Water crossing | across the pond Marcel built |
| R6 | Descent + return | plaza → the y=-31 corridor Bernd died in, and back |

Record per trip: wall-clock ms, arrival distance to target, `bot.health` delta, deaths, blocks
broken (terrain scars), and for pathfinder the `path_update` telemetry
(`{status, time, visitedNodes, generatedNodes}` — free, see §2.5). Fail a trip that reports
success while >2 blocks short; both engines can do that and it is the metric that matters.

Adopt ashfinder as `/goto`'s automatic fallback only for the route classes where it wins on
**arrival rate**, not on speed. Speed differences are recoverable through §2 tuning; arrival on
terrain pathfinder cannot solve is not.

---

## 2. mineflayer-pathfinder 2.4.5 — the tuning we are missing

Upstream status: npm latest is still **2.4.5, published 2023-09-04**. `master` has moved on
(last commit 2026-04-01) but is unreleased — 309 stars, 51 open issues. This is a frozen
dependency and it is load-bearing for `pvp` and `collectblock`.

### 2.1 The complete knob surface (from source, with defaults)

`bot.pathfinder.*`, set in `index.js:39-43`:

| Knob | Default | What it does | Recommended |
|---|---|---|---|
| `thinkTimeout` | `5000` ms | **Total** A* wall-clock budget for one search. Exceeded → `status:'timeout'` → `goto` **rejects** with `Timeout`. | 5000 for base moves, **20000–30000 for hauls** |
| `tickTimeout` | `40` ms | A* compute slice per `physicsTick` (tick = 50 ms). | 40 for hauls, **20–25 while moving** so travel stays smooth |
| `searchRadius` | `-1` (unlimited) | Caps A* to `h(start) + searchRadius` cost. | **50–80 for base moves** → fast honest `noPath` instead of a 5 s blind flail |
| `enablePathShortcut` | `false` | Post-processes the path into straight-line segments where physics allows. Skipped when `exclusionAreasStep` is non-empty. | **`true` on open surface hauls** (fewer nodes = less zig-zag); leave `false` while building |
| `LOSWhenPlacingBlocks` | `true` | Only matters with scaffolding. | irrelevant (we place nothing) |

`bot.pathfinder.movements.*` (`lib/movements.js` constructor), grouped:

| Knob | Default | Ours today | Recommended |
|---|---|---|---|
| `allowParkour` | `true` | `false` | keep `false` |
| `allowSprinting` | `true` | `false` | **`true` for hauls** — see §2.6 |
| `allow1by1towers` | `true` | `false` | keep `false` |
| `maxDropDown` | `4` | `3` | `3` haul/work, **`2` cave** |
| `infiniteLiquidDropdownDistance` | `true` | `false` | keep `false` |
| `scafoldingBlocks` | `[dirt, cobblestone]` | `[]` | keep `[]` |
| `canDig` | `true` | `true` | keep `true`, but see `digCost` |
| **`digCost`** | `1` | *unset* | **`15` on surface hauls** — makes walking around cheaper than tunnelling. Direct fix for the dirt-scar problem in TODO 1 |
| **`liquidCost`** | `1` | *unset* | **`8`** — stop routing through ponds |
| **`entityCost`** | `1` | *unset* | `2` |
| **`entitiesToAvoid`** | empty `Set` | *unset* | **`add('creeper','zombie','skeleton','spider','witch')`** → cost **100** per intersecting cell (`updateCollisionIndex`), effectively routes around mobs |
| `allowEntityDetection` | `true` | — | keep `true` (required for the above) |
| **`blocksToAvoid`** | fire, cobweb, lava | *unset* | **add `leaf_litter`, `torch`, `wall_torch`, `powder_snow`, `sweet_berry_bush`, `magma_block`, `campfire`, `soul_campfire`, `cactus`** — see §2.4 |
| **`blocksCantBreak`** | non-diggables + `chest` | *unset* | add `crafting_table`, `furnace`, `blast_furnace`, `smoker`, `barrel`, every bed, `lodestone` — the pathfinder should never eat base infrastructure |
| **`exclusionAreasStep` / `Break` / `Place`** | `[]` | used only in blueprint builds | **the right home for BASE.md protection** — see §2.8 |
| `dontCreateFlow` | `true` | — | keep |
| `dontMineUnderFallingBlock` | `true` | — | keep |
| `canOpenDoors` | `false` | — | **test `true`** once the base has doors; the "causes issues" comment blames non-Paper servers and ours is Paper-family |
| `allowFreeMotion` | `false` | — | consider `true` for `/follow` only (straight-line dash when LOS is clear) |
| `climbables` | ladder only (`vine` commented out) | — | add `vine`'s id if we ever route through jungle/cliffs |

### 2.2 Four profiles — copy-paste ready

```js
const { Movements } = require('mineflayer-pathfinder')

function baseMovements (bot) {
  const m = new Movements(bot)
  const B = bot.registry.blocksByName
  // safety doctrine (FEEDBACK: unsafe defaults killed MettMarcel)
  m.allowParkour = false
  m.allow1by1towers = false
  m.infiniteLiquidDropdownDistance = false
  m.scafoldingBlocks = []
  m.maxDropDown = 3
  // never eat infrastructure
  for (const n of ['crafting_table','furnace','blast_furnace','smoker','barrel',
                   'chest','trapped_chest','ender_chest','lodestone','bell',
                   'enchanting_table','anvil','brewing_stand','loom','smithing_table'])
    if (B[n]) m.blocksCantBreak.add(B[n].id)
  // §2.4 — the wedge fix. These are shapes:[] blocks pathfinder calls "air".
  for (const n of ['leaf_litter','torch','wall_torch','powder_snow','sweet_berry_bush',
                   'magma_block','campfire','soul_campfire','cactus','pointed_dripstone'])
    if (B[n]) m.blocksToAvoid.add(B[n].id)
  // mobs are obstacles, not scenery
  for (const e of ['creeper','zombie','skeleton','spider','witch','husk','drowned',
                   'enderman','phantom','pillager'])
    m.entitiesToAvoid.add(e)
  m.entityCost = 2
  m.liquidCost = 8
  return m
}

const PROFILES = {
  // long surface hauls: fast, lazy about digging, willing to sprint
  HAUL (bot) { const m = baseMovements(bot)
    m.allowSprinting = true; m.digCost = 15; m.maxDropDown = 3
    bot.pathfinder.thinkTimeout = 25000; bot.pathfinder.tickTimeout = 40
    bot.pathfinder.searchRadius = -1; bot.pathfinder.enablePathShortcut = true
    return m },
  // short moves around base: fail fast, never scar the plaza
  WORK (bot) { const m = baseMovements(bot)
    m.allowSprinting = false; m.digCost = 25
    bot.pathfinder.thinkTimeout = 5000; bot.pathfinder.tickTimeout = 25
    bot.pathfinder.searchRadius = 64; bot.pathfinder.enablePathShortcut = false
    return m },
  // underground: conservative drops, digging is the job
  CAVE (bot) { const m = baseMovements(bot)
    m.allowSprinting = false; m.digCost = 1; m.maxDropDown = 2; m.liquidCost = 30
    bot.pathfinder.thinkTimeout = 10000; bot.pathfinder.tickTimeout = 30
    bot.pathfinder.searchRadius = 96; bot.pathfinder.enablePathShortcut = false
    return m },
  // blueprint building: skills.js already builds this one; keep it, add the base sets
  BUILD: null
}
```

`skills.js`'s existing `buildMoves` (lines 1395-1415) already applies the safety half
correctly — it should be re-expressed as `PROFILES.WORK` plus its `exclusionAreasBreak` guard,
so the block sets and mob avoidance come along for free.

**Set the profile per task, restore afterwards** (`skills.js` already has the
`prevMoves`/`restoreMoves` pattern — reuse it verbatim). And note `setMovements()` calls
`resetPath('movements_updated')`, so switching profiles mid-travel silently re-plans; switch
*before* issuing the goal, never during.

### 2.3 Three source-level `goto` quirks that explain field reports

**(a) `goto` resolves as SUCCESS when A* finds no path from a boxed-in start.**
`lib/goto.js noPathListener`:

```js
if (results.path.length === 0)        cleanup()                         // ← resolves, no error
else if (results.status === 'noPath') cleanup(error('NoPath', ...))
else if (results.status === 'timeout')cleanup(error('Timeout', ...))
```

and `lib/astar.js:121` returns `makeResult('noPath', this.bestNode)` where `bestNode` starts as
the start node, whose `reconstructPath` is `[]` (no parent). Empty path + the ordering above =
silent success. **Fix, engine-side, once:**

```js
// in ctx.goto, replace `return;` on the resolve branch with:
if (r.done) {
  const p = bot.entity.position.floored()
  if (!goal.isEnd(p) && !goal.isEnd(p.offset(0, 1, 0))) {
    const e = new Error('goto resolved without reaching the goal (empty-path noPath)')
    e.code = 'no_path'; throw e
  }
  return
}
```

This is a one-line-ish change to `skills.js ctx.goto` (currently `return;` at line ~400) and it
converts a whole class of silent no-ops into an honest `no_path` the driver can act on.

**(b) `bot.pathfinder.stop()` poisons the next goto — mechanism confirmed.**
`stop()` only sets `stopPathing = true`. The flag is consumed inside `resetPath()`
(`if (stopPathing) return stop()`), which only runs on the next reset/arrival. Call `stop()`
when no path is active and the flag survives; the *next* `setGoal(goal)` calls
`resetPath('goal_updated')`, which immediately fires `stop()` → emits `path_stop` → the brand
new `goto`'s `pathStopped` listener rejects with `PathStopped`. This is exactly the documented
quirk in LEARNING_HANDOFF. **`skills.js ctx.goto` calls `bot.pathfinder.stop()` on three
paths (timeout, stuck, ctx.step abort).** All three should be `setGoal(null)`; if you keep
`stop()`, follow it with one `setGoal(null)` to flush the flag before the next goal.

**(c) `resetPath('stuck')` replans forever and never rejects.** `monitorMovement` ends with:

```js
if (performance.now() - lastNodeTime > 3500) resetPath('stuck')
```

`resetPath` clears the path; the next tick re-plans the *identical* path; repeat. There is no
attempt counter and no rejection. **That is why "long `/goto` times out at 60s" instead of
failing fast** — the underlying promise cannot fail on a wedge, only our wall-clock wrapper
can. Which leads to:

### 2.4 The wedge: `leaf_litter` and `torch` are "air" to the planner

Measured on this box (`prismarine-registry('1.21.11')` + `prismarine-block`):

```
leaf_litter   id 1113  shapes []  boundingBox empty  diggable true
torch         id 193   shapes []  boundingBox empty  diggable true
wall_torch    id 194   shapes []  boundingBox empty  diggable true
moss_carpet   id 1110  shapes [[0,0,0,1,0.0625,1]]   boundingBox block
```

`Movements`' constructor classifies by shape:

```js
if (block.shapes.length > 0) { if (shapes[0][4] > 1) fences.add(...); if (shapes[0][4] < 0.1) carpets.add(...) }
else if (block.shapes.length === 0) this.emptyBlocks.add(block.type)
```

`leaf_litter` and `torch` have **zero** shapes, so they land in `emptyBlocks`. Then `getBlock`
sets `b.safe = (boundingBox === 'empty' || climbable || carpets.has(type)) && !blocksToAvoid.has(type)`
→ `true`, and `safeOrBreak` returns cost 0 and **never adds them to `toBreak`**. The planner
walks into them for free and never clears them. Combined with (c) above, the bot re-plans the
same doomed path every 3.5 s until our wrapper times out.

**Fix: `movements.blocksToAvoid.add(id)`.** That flips `b.safe` to `false`, which sends the
block down `safeToBreak()` — both are `diggable`, so they get pushed into `toBreak` and the
path *digs them out before stepping in*. Cost is `(1 + 3·digTime/1000)·digCost`; both break
instantly, so ≈ `digCost`. Fields of leaf litter get routed around; a single blocking one gets
cleared. **This retires two open FEEDBACK.md entries** (`torch-underfoot movement wedge`, and
the `leaf_litter` half of the ctx.goto stall recovery) at the planner level rather than the
recovery level. Keep `ctx._unstick` as a belt-and-braces backstop.

Side effect worth knowing: the bot will now break its own corridor torches when it must walk
through one. `collectDrops` sweeps them up and `autoTorch` re-places them — the same benign
"torch counter inflation" already documented in README.md. A wedge-free bot is worth it.

### 2.5 Free telemetry we are not collecting

Pathfinder emits five events; we listen to none. All are one-liners in `runner.js`:

| Event | Payload | Use |
|---|---|---|
| `path_update` | `{status, cost, time, visitedNodes, generatedNodes, path}` | A* cost per search — the A/B metric in §1.10, free |
| `path_reset` | `reason` ∈ `goal_updated, movements_updated, block_updated, chunk_loaded, goal_moved, dig_error, place_error, no_scaffolding_blocks, **stuck**` | **3× `'stuck'` inside 15 s = a wedge.** Detects it in ~10 s instead of the 6 s-of-no-movement heuristic, and tells you *why* |
| `goal_reached` | `goal` | honest arrival signal |
| `path_stop` | — | someone called `stop()` |
| `goal_updated` | `goal, dynamic` | goal churn |

Also a cheap health check for the documented "orphaned goto poisons later goals" quirk:
`lib/goto.js` attaches four listeners per call and removes them in `cleanup()`. An orphaned
goto never cleans up, so **`bot.listenerCount('path_update') > 1` means a leaked goto is still
alive** — surface it in `GET /state` and drivers get a one-glance diagnosis instead of a
mystery `path_GoalChanged`.

### 2.6 Sprinting: the cheapest long-haul speedup available

Vanilla ground speeds: walking 4.317 blocks/s, sprinting 5.612 blocks/s — **+30%**. Our safe
profile sets `allowSprinting = false`, which costs roughly a third of every long haul.

The fall death that motivated the safe profile came from `allowParkour: true` +
`maxDropDown: 4` + `allow1by1towers: true`, not from sprinting. Sprinting alone does not change
*which* blocks the planner routes over; it changes how fast the body traverses them. The one
real interaction is `physics.canSprintJump(path)` (`index.js:614`), which lets the bot
sprint-*jump* — that is the risky part, and it is gated on the physics simulation clearing the
jump.

**Recommendation:** `allowSprinting = true` in `HAUL` only, with `allowParkour = false`,
`maxDropDown = 3`, `allow1by1towers = false`. Measure it as part of R3/R4 in the §1.10 A/B —
if R4 (hilltop ridge, the route that killed Marcel) shows any health loss, revert to walking on
hilly terrain and keep sprinting for flat ground. Also note sprinting requires food > 6, so the
`HAUL` profile should preflight food the same way it preflights torches.

### 2.7 Multi-leg waypointing — long-haul fix without a new dependency

The reason long hauls fail is not the movement engine, it is that **one A* over 200+ blocks of
broken terrain does not finish inside 5 s of think time**, and the far chunks are not even
loaded so the geometry is unknown (our own documented chunk-staleness quirk). Ashfinder
solves this with `SmartWaypointPlanner` past 75 blocks. The same algorithm is ~40 lines against
pathfinder, and it is the single highest-value change in this section:

```js
// ctx.gotoFar(target, {legLength = 80, range = 1, timeoutMs = 240000})
// 1. if distance <= legLength -> plain ctx.gotoNear
// 2. else: step along the straight XZ line from bot -> target in legLength chunks
// 3. for each intermediate point, snap to ground:
//      scan y from bot.y+8 down to bot.y-20 for the first column where
//      below.boundingBox === 'block' && feet.boundingBox === 'empty' && head.boundingBox === 'empty'
//      and none of {lava, cactus, magma_block, fire, powder_snow} is involved
//    (blockAt returns null past loaded chunks — if the snap fails, DON'T guess:
//     use goals.GoalNearXZ(x, z, 6) for that leg and let Y sort itself out)
// 4. walk legs with ctx.goto(..., 45000) each, HAUL profile
// 5. after every leg, re-snap the NEXT waypoint — chunks have loaded by then
// 6. final leg: ctx.gotoNear(target, range)
// 7. abort the whole thing if two consecutive legs make < 10 blocks of progress
```

Why this beats raising `thinkTimeout` alone: each leg is a small, fully-loaded-chunk search
that finishes in well under a second; the `GoalNearXZ` fallback keeps the bot moving through
terrain it cannot see yet; and progress is monitored per leg rather than per 60 s wrapper.
Pair it with `enablePathShortcut = true` and sprinting and the long-haul complaint should
largely disappear without ashfinder.

This is a `rule-of-twice` candidate: it has now been hand-driven as "loop it, multi-leg"
(LEARNING_HANDOFF) more than twice.

### 2.8 `exclusionAreas` is the right home for BASE.md protection

`digguard.js` currently hardcodes eight plaza columns (FEEDBACK: "digguard.js pillar coords are
hardcoded"). Pathfinder has a first-class hook for exactly this, already proven in
`skills.js:1410`:

```js
// weight >= 100 makes a block unbreakable to the PLANNER (movements.js safeToBreak)
const protectedKeys = loadProtectedColumnsFromBaseMd()   // or protected.json
const guard = (block) => (block?.position && protectedKeys.has(key(block.position)) ? 100 : 0)
m.exclusionAreasBreak.push(guard)
m.exclusionAreasPlace.push(guard)
// exclusionAreasStep also exists — use it to keep bots off a finished floor
```

Applied to the *default* Movements (not just build tasks), the planner stops considering
Peter's torch posts as traversal material at all — no runtime guard needed. Caveat:
`enablePathShortcut` is disabled whenever `exclusionAreasStep` is non-empty, so only push a
`Step` guard when you actually need it.

### 2.9 `master` vs 2.4.5 — is upgrading worth it?

Diffed today. Since the 2.4.5 release (2023-09-04), `master` has:

- `Fix isEnd crashing` (2024-01-06) — `GoalBreakBlock.isEnd()` → `isEnd(node)`, forwarding the
  argument. **This does NOT fully fix `GoalBreakBlock`**: its constructor still does
  `new GoalLookAtBlock(new Vec3(x,y,z), bot, options)` where the second parameter is `world`,
  so `this.world = bot` and the goal is still broken. Our `GoalLookAtBlock(pos, bot.world)`
  workaround stays correct on both.
- `fix(movements): use blockD instead of blockC in exclusionPlace calculation` (#351) —
  only matters when placing, which we don't.
- Node 24 CI, vec3 0.1.10 → 0.2.0.

**Verdict: not worth a git-pin.** Nothing here fixes a bug we actually hit, and pinning a repo
`#master` on a dependency that `pvp` and `collectblock` both hang off is a needless risk.
Re-check when a 2.5.0 ships.

### 2.10 One more root-cause note for the "Movements silently reverted" mystery

FEEDBACK has this as cause-unknown. Two source facts narrow it:

- `runner.js:177` is `bot.once('spawn', ...)`, and what it applies is `new Movements(bot)` —
  i.e. **stock unsafe defaults**. The safe profile has only ever existed as a driver-applied
  runtime patch on top of that object.
- `once` means a death/respawn does **not** re-run it, so a respawn is not the cause. But
  `createBot()` runs the whole block again on **reconnect**, and it installs a *fresh*
  `Movements` object with unsafe defaults. If a relog happened inside a driver's polling gap,
  the driver would see no `connected:false→true` transition and correctly report "no
  reconnect" while the profile had in fact been replaced.

Either way, TODO item 5's fix is the right one — apply the safe profile *inside* the spawn
handler rather than patching at runtime — and it should use `bot.on('spawn')` (not `once`) if
the same handler is going to carry the payload auto-injection, since that must re-run after
death. Add a cheap `GET /state` field exposing
`{parkour, maxDropDown, sprint, towers}` so any driver can verify the profile in one poll
instead of an `/eval`.

---

## 3. Real-Baritone sidecar — readiness checklist

**Status change: the hard blocker is gone.** Every artifact below was fetched and inspected
today.

### 3.1 Verified artifacts

| Artifact | URL | Evidence |
|---|---|---|
| Baritone (Meteor fork), MC 1.21.11 | `https://maven.meteordev.org/snapshots/meteordevelopment/baritone/1.21.11-SNAPSHOT/baritone-1.21.11-20260103.131549-1.jar` | 1,610,665 bytes, Last-Modified 2026-01-03, `sha256 3e8c7ab86b7c0148f8711ca2e7cb608712dbc2a97253de0f131ec3db41a2bd3c` |
| HeadlessMc launcher 2.10.0 (jar) | `https://github.com/headlesshq/headlessmc/releases/download/2.10.0/headlessmc-launcher-2.10.0.jar` | 13.0 MB, released 2026-07-13 |
| HeadlessMc launcher 2.10.0 (**native, no Java needed**) | `https://github.com/headlesshq/headlessmc/releases/download/2.10.0/headlessmc-launcher-linux-x64` | 83.4 MB GraalVM native-image |
| hmc-specifics for MC 1.21.11, fabric | `https://github.com/headlesshq/hmc-specifics/releases/download/1.21.11-latest/hmc-specifics-1.21.11-fabric-latest.jar` | 5.59 MB, released 2026-04-13 |

Note the repo moved: `3arthqu4ke/headlessmc` → **`headlesshq/headlessmc`** (the old URL
redirects; the GitHub API does not follow it, use the new org).

**The `1.21.11-SNAPSHOT` line is effectively frozen, which is good news.** It has exactly one
build (2026-01-03) and Meteor has since moved to the new `26.1`/`26.2` version scheme
(`<release>26.2</release>` in the parent metadata, last updated 2026-08-13). AUTONOMY_PLAN
listed "the jar is a mutable -SNAPSHOT" as a risk — in practice this coordinate is stable and
the sha256 above pins it exactly.

### 3.2 Java: no longer a blocker

- `java` is **not** installed on this box (`which java` → not found; no `jdk` package in
  `pacman -Qs`). `jdk21-openjdk 21.0.12.1.u1-1` is available in `extra` if you want it.
- **HeadlessMc 2.5.0 (2025-01-28) added "HeadlessMc can now download Java distributions"** plus
  a GraalVM launcher, with the release note: *"this means HeadlessMc can run with 0 setup now.
  E.g. `launch fabric:1.21.4` with the GraalVM executable is all you need to do to run
  fabric-1.21.4, no java installation required."*
- The 2.10.0 release ships `headlessmc-launcher-linux-x64`, a GraalVM native binary that
  "find[s]/download[s] a suitable Java distribution and run[s] HeadlessMc on it".

So the sidecar can be stood up **without root and without `pacman`**. Installing
`jdk21-openjdk` is still the cleaner long-term option (MC 1.21.11 requires Java 21) and would
also unblock any other JVM tooling — but it is no longer on the critical path, and TODO item 2
should be updated to say so.

Host budget: 31 GB RAM total, ~15 GB available, 16 cores. A `-Xmx2G` headless client plus its
JVM overhead lands around 2.5–3 GB RSS. Affordable for **one** sidecar; do not plan a fleet of
them (that is why the mineflayer bots stay primary at ~100 MB each).

### 3.3 Resolved unknown: hmc-specifics does NOT need fabric-api

From `hmc-specifics/1_21_10/src/fabric/resources/fabric.mod.json` (the directory `ci-data.json`
maps to `mc: 1.21.11`):

```json
"depends": { "fabricloader": ">=0.14.19", "minecraft": "~1.21.10", "java": ">=8" }
```

No `fabric-api` entry. Same for Baritone's own `fabric.mod.json` inside the jar:
`"depends": { "fabricloader": ">=0.14.22", "minecraft": ["1.21.11"] }`. **Neither mod requires
fabric-api.** That closes one of AUTONOMY_PLAN's three Phase-2 unknowns. (`ci-data.json` also
confirms `java: "21"` is the build target for MC 1.21.11.)

### 3.4 Partially resolved unknown: the standalone `#` chat control

Inspected the jar's 470 entries:

- `fabric.mod.json` has **`"entrypoints": {}`** — empty. Nothing initializes Baritone as a
  normal Fabric mod.
- But `baritone/launch/mixins/MixinMinecraft.class` references
  `baritone/api/BaritoneAPI.getProvider`, `createNextProvider`, `getPrimaryBaritone`,
  `postInit`, `runTick`, `tickProvider` — Baritone **self-initializes through its mixin** at
  client init and ticks itself. No Meteor Client required for construction.
- `baritone/command/ExampleBaritoneControl.class` — the standalone chat handler — **is
  present**, with the strings `prefixControl`, `chatControl`, `chatControlAnyway`,
  `filterPrefix`, `prefix`, `#+`. That is the class that intercepts outgoing chat starting with
  `#`, cancels it, and runs it as a Baritone command.

So the `#goto` route is very likely to work standalone; the remaining unknown is only whether
`prefixControl` defaults on in this fork's `Settings`. If it does not, set it once in
`<gamedir>/baritone/settings.txt` (`prefixControl true`) or via `#set prefixControl true`.
This is a 15-minute smoke test, not a design risk.

Licensing: Baritone is **LGPL-3.0** (per its `fabric.mod.json`), hmc-specifics is MIT. Running
them as a separate process is exactly the arrangement LGPL contemplates.

### 3.5 Exact steps

```bash
# 0. (optional, cleaner) sudo pacman -S --needed jdk21-openjdk
mkdir -p /home/felix/minecraft/headless/game/mods
cd /home/felix/minecraft/headless

# 1. launcher — native, needs no Java
curl -L -o headlessmc https://github.com/headlesshq/headlessmc/releases/download/2.10.0/headlessmc-launcher-linux-x64
chmod +x headlessmc

# 2. config
mkdir -p HeadlessMC && cat > HeadlessMC/config.properties <<'EOF'
hmc.offline=true
hmc.offline.username=BaritoneBot
hmc.gamedir=/home/felix/minecraft/headless/game
hmc.assets.dummy=true
hmc.jline.enabled=false
EOF

# 3. mods (fabric loader is installed by hmc when you launch fabric:1.21.11)
cd game/mods
curl -L -O https://maven.meteordev.org/snapshots/meteordevelopment/baritone/1.21.11-SNAPSHOT/baritone-1.21.11-20260103.131549-1.jar
echo "3e8c7ab86b7c0148f8711ca2e7cb608712dbc2a97253de0f131ec3db41a2bd3c  baritone-1.21.11-20260103.131549-1.jar" | sha256sum -c
curl -L -O https://github.com/headlesshq/hmc-specifics/releases/download/1.21.11-latest/hmc-specifics-1.21.11-fabric-latest.jar

# 4. launch (first run downloads MC + fabric + a JRE; expect several minutes and ~1 GB)
cd /home/felix/minecraft/headless
./headlessmc launch fabric:1.21.11 -lwjgl -offline --jvm "-Xmx2G"
```

Then, in the HMC console: `msg "/join"`-style connection is done by the client's own
multiplayer flow — the practical route is to pass the server via game args
(`--server 100.101.197.44 --port 25565`, supported since 2.7.0's "Specify game args in launch
command") so the client auto-connects, then drive it with:

```
msg "#goto 100 64 100"
msg "#mine diamond_ore"
msg "#stop"
```

**Smoke-test order (each step gates the next):**

1. `./headlessmc launch fabric:1.21.11 -lwjgl -offline` reaches the main menu headlessly.
2. The client joins our offline server and appears in `list`.
3. `msg "#help"` produces Baritone output in chat → `prefixControl` works standalone.
4. `msg "#goto <x> <y> <z>"` moves the body.
5. Only then wire the IPC.

### 3.6 IPC pattern

`runner.js`-style sidecar supervisor, one Node `child_process`:

```js
const { spawn } = require('child_process')
const hmc = spawn('/home/felix/minecraft/headless/headlessmc',
  ['launch','fabric:1.21.11','-lwjgl','-offline','--jvm','-Xmx2G',
   '--','--server','100.101.197.44','--port','25565'],
  { cwd: '/home/felix/minecraft/headless', stdio: ['pipe','pipe','pipe'] })

// command: write a line to stdin
const cmd = (s) => hmc.stdin.write(`msg "${s.replace(/"/g,'')}"\n`)
// telemetry: the ONLY channel back is stdout text (chat + Baritone messages)
hmc.stdout.on('data', b => parseBaritoneOutput(b.toString()))
```

Design consequences to accept up front:

- **Text in, text out.** No programmatic world/inventory access — that is precisely why the
  mineflayer bots stay primary and this is a *supplement*.
- Give it its own HTTP port in the same shape as the other bots (`POST /goto` →
  `#goto x y z`, `POST /mine {block,count}` → `#mine`, `POST /stop` → `#stop`) so drivers see
  one uniform surface.
- Completion detection is by parsing Baritone's own chat output plus a wall-clock timeout;
  budget generously (Baritone is slower to *start* and much better at *finishing*).
- Distinct username (`BaritoneBot`, but per the naming rule make it something stupid — e.g.
  `BaronVonBlock`), its own BASE.md/DEPOT.md identity, and the same "never leave drops /
  never attack players" doctrine.
- Nothing in the mineflayer fleet may depend on it. If the JVM dies, the fleet is unaffected.

### 3.7 Remaining Phase-2 unknowns, and the cost to close each

| Unknown | Status | Cost to close |
|---|---|---|
| fabric-api required? | **RESOLVED: no** | done |
| Snapshot jar churn | **RESOLVED: line frozen at one 2026-01-03 build, sha256 pinned** | done |
| Java 21 missing | **RESOLVED: HMC downloads its own / GraalVM native launcher** | done |
| `#` prefix works standalone | **Likely** — `ExampleBaritoneControl` present, mixin self-init confirmed | 15 min smoke test (§3.5 step 3) |
| Auto-connect via game args | Untested | 15 min |
| Baritone settings persistence in `hmc.gamedir` | Untested | 10 min |
| RAM under sustained `#mine` | Unknown | measure during the first long job |

**Recommendation: promote Phase 2 from "deferred, blocked" to "unblocked, scheduled after the
§2 tuning lands and is measured."** It should not jump the queue — §2 is cheaper and helps all
five bots — but the TODO/AUTONOMY_PLAN entries claiming a hard Java blocker are now stale and
should be corrected.

---

## 4. Verdict: which engine, when

### 4.1 By route class

**Short base moves (<40 blocks, cluttered plaza/depot) — pathfinder, `WORK` profile.**
Ashfinder brings nothing here and its greedy `hWeight: 1.67` produces worse paths in tight
space. `searchRadius: 64` turns the documented "GoalNear near cluttered spots can recalc
partial paths forever" into a fast honest failure. `digCost: 25` keeps the plaza unscarred.

**Long surface hauls (>80 blocks) — pathfinder, `HAUL` profile + multi-leg waypointing
(§2.7).** The failure is a 5 s think budget against an unloaded, 200-block search, not the
engine. Fixing that plus sprinting (+30%) plus `enablePathShortcut` should close most of the
gap. If R2/R3 in the A/B still fail, `/goto` falls through to `/goto2` — ashfinder's
`gotoSmart` waypoint planner is a legitimately better long-haul design and is the fallback's
whole justification.

**Deep mining / descent — pathfinder, `CAVE` profile.** Ashfinder's strengths (parkour,
swimming, ladders) barely apply, and its dig path is a hand-rolled `block_dig` packet writer
with its own dig-time model (§1.6.6) — the highest-risk part of the package, at the depth where
a stranded bot costs the most. `mineLane`/`safeDescend` already own this and should keep it.
Do add `maxDropDown: 2` and `liquidCost: 30` (lava adjacency).

**Water crossings, parkour gaps, ladder shafts — ashfinder via `/goto2`, explicitly.** These
are real capability gaps in pathfinder 2.4.5. Drivers call `/goto2` deliberately; nothing calls
it automatically until the A/B says otherwise.

**Fleet-scale long-haul and `#mine`-quality mining — real Baritone sidecar, Phase 2.** One
JVM bot, unblocked (§3), scheduled after §2 ships and is measured.

### 4.2 Recommended order of work

1. **`blocksToAvoid` wedge fix + arrival assertion in `ctx.goto` + `setGoal(null)` instead of
   `stop()`** (§2.3, §2.4). Half a day. Retires three FEEDBACK entries and probably the
   majority of "the bot froze" reports. Highest value per line changed in this whole report.
2. **Persist the safe profile in `runner.js`'s spawn handler and expose it in `GET /state`**
   (TODO 5, §2.10). Already on the roadmap; §2.10 adds the reconnect mechanism and the
   `/state` check that makes it verifiable.
3. **The four profiles + per-task selection** (§2.2). `skills.js` already has the
   apply/restore plumbing.
4. **`ctx.gotoFar` multi-leg waypointing** (§2.7). This is the actual long-haul fix.
5. **Pathfinder event telemetry into the log + `/state`** (§2.5). Free, and it is the
   measurement instrument for step 6.
6. **A/B pathfinder-tuned vs ashfinder on the six routes** (§1.10). Only now is the comparison
   fair — measuring stock-tuned pathfinder against ashfinder would flatter ashfinder and
   mislead the adoption decision.
7. **`/goto2` behind the strict mutex, loaded in `createBot`, never default** (§1.9), promoted
   to automatic fallback only for route classes it wins on arrival rate.
8. **`exclusionAreas` fed from BASE.md, replacing `digguard.js`'s hardcoded columns** (§2.8).
9. **Baritone sidecar smoke test** (§3.5), then the sidecar supervisor if it passes.

### 4.3 What NOT to do

- Do not make ashfinder the default engine, or route `/goto` to it. `pvp` and `collectblock`
  are hard-wired to `bot.pathfinder`; two engines on one body is the top operational risk in
  AUTONOMY_PLAN and both call `clearControlStates` (§1.8).
- Do not load ashfinder through `./inject.sh` / `/eval` — post-spawn injection leaves the
  executor `null` (§1.2, upstream #10).
- Do not pass `useCustomPhysics: true`.
- Do not enable ashfinder's `placeBlocks` (scaffolding scars) or, initially, `breakBlocks`
  (§1.6.6).
- Do not `await bot.ashfinder.goto(goal)` and treat resolution as arrival — it lies three
  different ways (§1.6.1–3). Neither does `bot.pathfinder.goto` (§2.3a). Assert distance.
- Do not pin mineflayer-pathfinder to `#master` (§2.9).

---

## 5. Suggested FEEDBACK.md entries

Append these (engine team, not me — I am read-only):

```
### 2026-09-01 movement-research — pathfinder treats leaf_litter/torch as air
type: bug
status: open
what: Movements' constructor puts every zero-shape block (leaf_litter id 1113, torch 193,
      wall_torch 194 on 1.21.11) into emptyBlocks; getBlock then marks them b.safe=true and
      safeOrBreak returns cost 0 without adding them to toBreak. The planner walks into them
      for free and never clears them — the mechanical cause of both documented wedges.
fix:  movements.blocksToAvoid.add(id) for leaf_litter/torch/wall_torch/powder_snow/
      sweet_berry_bush/magma_block/campfire/cactus. That flips b.safe=false so the planner
      DIGS them before stepping in (cost ~= digCost). Supersedes the ctx.goto nuisance-dig
      recovery as the primary fix; keep _unstick as a backstop.
      See research/movement-engines.md §2.4.

### 2026-09-01 movement-research — pathfinder.goto resolves as success on noPath
type: bug
status: open
what: lib/goto.js checks results.path.length===0 BEFORE results.status==='noPath', and
      astar.js returns noPath with bestNode=startNode whose path is []. An unreachable goal
      from a boxed-in position resolves cleanly with no error. ctx.goto returns immediately
      on that resolve without verifying arrival.
fix:  in ctx.goto's resolve branch, assert goal.isEnd(bot.entity.position.floored()) (or the
      +1 offset) and throw code 'no_path' otherwise. See §2.3a.

### 2026-09-01 movement-research — bot.pathfinder.stop() mechanism confirmed
type: quirk
status: open
what: stop() only sets stopPathing=true; the flag is consumed inside resetPath(), so calling
      it with no active path leaves it set, and the NEXT setGoal() immediately fires stop() ->
      path_stop -> the new goto rejects with PathStopped. skills.js ctx.goto calls
      bot.pathfinder.stop() on three paths (timeout, stuck, ctx.step abort).
fix:  use setGoal(null) everywhere, or follow every stop() with one setGoal(null). §2.3b

### 2026-09-01 movement-research — no long-haul waypointing
type: feature-request
status: open
what: One A* over 200+ blocks cannot finish inside thinkTimeout=5000ms and the far chunks
      aren't loaded, so long /goto degrades to the 60s wrapper timeout. Hand-driven as
      "loop it, multi-leg" more than twice -> rule of twice.
fix:  ctx.gotoFar(target, {legLength:80}) — ground-snapped waypoints along the XZ line,
      GoalNearXZ fallback for unloaded columns, re-snap each leg after arrival, abort on two
      legs of <10 blocks progress. Plus HAUL profile (thinkTimeout 25000,
      enablePathShortcut true, allowSprinting true, digCost 15). §2.7

### 2026-09-01 movement-research — pathfinder telemetry unused
type: feature-request
status: open
what: path_update/path_reset/goal_reached/path_stop are never listened to. path_reset('stuck')
      fires every 3.5s on a wedge and is a far better stall signal than 6s-of-no-movement;
      path_update carries {time, visitedNodes, generatedNodes} for free A/B metrics. Also
      bot.listenerCount('path_update')>1 detects a leaked orphan goto in one poll.
fix:  log both, expose stuck-count + listener count in GET /state. §2.5
```

---

## Sources

**Local source read on this box**
- `/home/felix/minecraft/bots/node_modules/mineflayer-pathfinder/` @ 2.4.5 — `index.js`,
  `lib/goto.js`, `lib/astar.js`, `lib/movements.js`, `lib/goals.js`
- `/home/felix/minecraft/bots/` — `runner.js`, `skills.js`, `LEARNING_HANDOFF.md`, `TODO.md`,
  `FEEDBACK.md`, `AUTONOMY_PLAN.md`, `package.json`
- `minecraft-data` 3.115.0 / `prismarine-registry` / `prismarine-block` for 1.21.11 block shapes

**ashfinder**
- <https://github.com/miner-org/mineflayer-baritone> — `README.md`, `index.js`, `index.d.ts`,
  `src/loader.js`, `src/AshFinder.js`, `src/executor.js`, `src/pathfinder.js`, `src/goal.js`,
  `src/utils.js`, `src/utils/ashDig.js`, `src/waypoints.js`, `src/movement/index.js` (main @ 4.6.2)
- <https://www.npmjs.com/package/@miner-org/mineflayer-baritone> (registry metadata, 20 versions)
- Issues [#7](https://github.com/miner-org/mineflayer-baritone/issues/7),
  [#8](https://github.com/miner-org/mineflayer-baritone/issues/8),
  [#9](https://github.com/miner-org/mineflayer-baritone/issues/9),
  [#10](https://github.com/miner-org/mineflayer-baritone/issues/10)
- <https://deepwiki.com/miner-org/mineflayer-baritone/2.2-pathfinding-engine>
- <https://github.com/antisynth/mineflayer-baritone> (the project it credits as ancestor)

**mineflayer-pathfinder upstream**
- <https://github.com/PrismarineJS/mineflayer-pathfinder> (master, `lib/goals.js` diff)
- <https://www.npmjs.com/package/mineflayer-pathfinder>

**Baritone sidecar**
- <https://maven.meteordev.org/snapshots/meteordevelopment/baritone/maven-metadata.xml>
- <https://maven.meteordev.org/snapshots/meteordevelopment/baritone/1.21.11-SNAPSHOT/>
- <https://github.com/headlesshq/headlessmc> (README; repo moved from `3arthqu4ke/headlessmc`)
- <https://github.com/headlesshq/headlessmc/releases> (2.5.0 Java-download note, 2.7.0 GraalVM
  ARM64 + game args, 2.10.0 assets)
- <https://github.com/headlesshq/hmc-specifics> — `ci-data.json`,
  `1_21_10/src/fabric/resources/fabric.mod.json`, `1.21.11-latest` release
- <https://github.com/cabaletta/baritone> (upstream Baritone, LGPL-3.0)
