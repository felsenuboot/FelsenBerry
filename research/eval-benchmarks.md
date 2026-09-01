# Engine Benchmark Suite + Algorithm Scoreboard — design spec (2026-09-01)

Research track: **benchmarks**. Companion to `research/SYNTHESIS.md` (P0–P4 plan),
`research/goto2-ab-plan.md` (route library, reused here), `GOAL.md` (the pillar table the
acceptance thresholds feed), and `SCOREBOARD.md` (the DRIVER fitness board — deliberately
a different file and a different question; see §7.1).

**The problem this solves:** tonight's field data is a taxonomy of silent failure — goto
"successes" with an empty path, a 96-step staircase that descended 1 level, tools that die
mid-shaft with no warning, craft calls that void materials, three deaths inside driver
polling gaps. Every one of those was discovered *by accident, in production, by an LLM
driver burning tokens*. The engine is the product; a product needs a regression suite.
This spec defines 6 repeatable on-server benchmarks, the facilities they run in, a
machine-writable algorithm scoreboard (`ALGO.md`), automated regression → FEEDBACK/issue
plumbing, and per-algorithm acceptance thresholds that gate "GOAL.md pillar DONE".

Design principles (non-negotiable, inherited from the stack's laws):

1. **The harness is code, not an LLM.** Benchmarks are driven by `bench/bench.sh`
   (bash + curl + jq against the runner HTTP API), exactly like `task.sh`. LLM
   involvement per benchmark run ≈ 0 tokens; an engineer reads the scoreboard, not the
   telemetry. Token-cost-per-outcome is itself a scored KPI (§4.6).
2. **Never trust an engine's self-report.** Every "arrived"/"built"/"done" is re-asserted
   from world state (position distance, `blockAt` verification, inventory deltas) with an
   800 ms physics settle — the same rule `goto2.patch.js:assertArrival()` already
   implements. False success is scored *worse* than honest failure, always.
3. **Survival-legal only.** ZERO ops, no `/summon`, no `/tp`, no setblock (user integrity
   law). Mob encounters are staged with dark rooms and geometry, resets are walked, and
   arenas are built by hand from banked materials.
4. **Bench never games itself.** Engine code MUST NOT special-case benchmark coordinates,
   bot names, or the bench port. Any commit that references `bench_`/`Messwurst`/3110
   inside `skills.js`/`runner.js` is an automatic review reject.
5. **Respect the world's laws**: BASE.md registration for every facility, DEPOT ledger
   for every withdrawal, ≥50-block distance law for anything destructive, hazard-zone
   r24 exclusions, CAVECREW territory untouched, narration on, drops collected.

---

## 1. The bench bot and its operating rules

| | |
|---|---|
| Name | **MesswurstManni** (14 chars, `[A-Za-z0-9_]`, appropriately stupid) |
| Port | **3110** (3101–3106 production, 3107–3109 are engine-dev's ephemeral test ports) |
| Spawn | `./spawn.sh MesswurstManni 3110` — **no `--role` argument**, so idleguard is NOT auto-injected. Idleguard's stall-buster and drop-sweeps stomp pathfinder goals mid-measurement (root-caused live 2026-08-31: reads exactly like a physics freeze). A benchmark with idleguard armed is invalid. |
| Payloads | skills / dangerscan / survival / digguard / graychat / reachguard via runner auto-inject (verify `GET /state → payloads` + `stalePayloads:[]` before every session; abort if `payloads.skills` ≠ current `ENGINE_VERSION`). |
| Movements | The spawn-handler safe profile, confirmed via `GET /state → movements` (`parkour:false, maxDropDown:3, towers:false`). Per-scenario profile overrides are listed in each scenario spec. |
| Lifetime | Spawn for a bench session → run scenarios → `./stop.sh 3110`. **Player cap is 8 and the fleet sits at 7** — MesswurstManni occupies the one spare client slot, the same slot engine-dev's test bots use. Coordinate in the team channel before spawning; never run a bench bot and an engine-dev test bot concurrently. |
| Narration | Announces every run in-game: `BENCH <scenario> <route/run> start` / `... done` (English, per chat law). Routine lines go through graychat so the fleet channel isn't spammed. |
| Kit | Drawn from **bench_locker_1** (§5), never from depot chests mid-run. Restocks from depot happen between sessions, ledgered normally (`DEPOT -N item`). Kit must satisfy `__skills.kitCheck` for the scenario's tier — benchmarks NEVER pass `force:true`; a kit_missing refusal is itself a valid (failing) data point for the preflight algorithm. |
| Death handling | Record, respawn, re-verify payloads + movements (fresh spawn = fresh injection), walk back, restart that scenario's sequence from run 1. A death is never averaged away. |

**Who runs benchmarks:** the engine team only (engine-dev / engine-dev-2, or a dedicated
`bench` teammate later). Drivers never run them and production bots never host them.
The human-facing trigger is one command: `bench/bench.sh <suite> <scenarios...>`.

**Quiet-window rule** (from goto2-ab-plan §0.4): record `nearbyBots` (fleet bots within
~40 blocks) per run; a run with another bot pathing through the course is marked
`tainted:1` and re-run. A run interrupted by a genuine survival.js panic is also
`tainted:1` for the *primary* metric but its survival telemetry is kept (free SD data).

---

## 2. Scenario overview

| id | Scenario | Algorithm(s) under test | Where | Wall-clock (full) | Cadence |
|---|---|---|---|---|---|
| **GG** | Goto Gauntlet | `ctx.goto`/`/goto`, movement profiles, wedge recovery, (optionally `/goto2`) | 6 routes across the live world (§3.1) | ~2.5 h full / ~25 min smoke | smoke per version bump; full nightly |
| **MP** | Mining Plot | `mineLane`, autoTorch, tool durability pipeline, `collectDrops` | `bench_quarry_1`, SE scrub (§3.2) | ~15 min/run | smoke ×1 per bump; full ×3 nightly |
| **BP** | Build Pad | `buildSchematic`/buildCore, `placeBlockAt`, restocking, verify pass | `bench_pad_1`, W of plaza (§3.3) | ~20 min/run | smoke hut5 ×1 per bump; suite nightly |
| **SD** | Survival Drill | dangerscan, survival.js branches, kit preflight | T1 anywhere safe; T2 `bench_arena_1` in DIGTEST_1 (§3.4) | T1 ~10 min; T2 ~30 min | T1 per bump; T2 weekly |
| **FC** | Farm Cycle | the harvest→replant→deposit loop (today driver-driven; tomorrow a `farmCycle` skill) | `farm_1` (production, shared) (§3.5) | ~10 min/cycle | opportunistic (≥20 mature tiles) |
| **AS** | Autonomy Soak | task queue, onEmpty fallback, idleguard, reconnect persistence, the whole autonomy floor | roving, anchored on a designated work zone (§3.6) | 8 h unattended | weekly; after any queue/idleguard/runner change |

Two suite levels:

- **SMOKE** (gate for every `ENGINE_VERSION` bump, BEFORE fleet rollout, ~60–75 min
  total): GG routes R1+R2+R4 ×1 out-and-back each, MP ×1, BP hut5 ×1, SD-T1. Any hard
  trigger (§8.2) blocks the rollout — the rollout protocol in DRIVER_GUIDE.md gains one
  sentence: *"no fleet rollout until the smoke suite is green on 3110."*
- **FULL** (nightly, or per engine work session): GG all 6 routes ×5 pairs, MP ×3,
  BP two-schematic suite, SD-T1 (+T2 when the arena is stocked), FC if mature.

---

## 3. Scenario specifications

### 3.1 GG — Goto Gauntlet

**Reuses the 6-route library from `research/goto2-ab-plan.md` §2 verbatim** (R1 tight
plaza quarters, R2 the historical depot→NW-forest 60 s timeout, R3 long open haul to
(326,100,38), R4 the ridge that killed Marcel, R5/R5b water, R6 quarry-shaft descent
+ return). That file remains the authority for anchors, per-route timeouts, `verify y`
duties, and the A/B alternation protocol. This spec *generalizes* it from a one-off
ashfinder adoption test into the standing movement regression gauntlet:

- **Default mode is single-engine**: pathfinder `/goto` only, 5 out-and-back pairs per
  route (10 trips/route, 60 trips full). The A/B alternation with `/goto2` is a *mode
  flag* (`--ab`) used when an ashfinder adoption/regression question is live.
- **Profiles**: HAUL for R2/R3, WORK for R1/R5, CAVE for R6, and R4 runs BOTH HAUL and
  WORK variants (the sprint-on-ridge question from SYNTHESIS P0.3 stays measurable).
  Profile is set before the goal and read back from `GET /state → movements` into the row.
- **Per-trip procedure** (identical to goto2-ab-plan §4): snapshot `/state` → issue goto
  with the route's timeout → on return, 800 ms settle → re-read `/state` → compute row →
  `POST /stop`, confirm `task:null`, HP 20 / food >14 before the next trip.
- **The R2 timeout stays 60 000 ms on every engine, forever** — it is the historical
  failure this gauntlet exists to keep dead.

**Metrics per trip** (CSV `bench/results/gg.csv`):

```
ts,engine_v,route,run,direction,profile,engine,ms,arrived,dist,falseSuccess,
timedOut,wedges,stuckResets,orphanedGoto,hpDelta,blocksBroken,deaths,
visitedNodes,tainted,nearbyBots,notes
```

Formulas (harness-computed, never engine-reported):

- `arrived := dist3d(finalPos, target) <= 2` after the settle window.
- `falseSuccess := engine_said_ok AND NOT arrived` — **counted separately and loudly**;
  the empty-path noPath bug and the ashfinder partial-path lie both land here.
- `wedges := count of stall episodes` — position delta < 0.3 blocks over ≥ 15 s while a
  goal is active. Source: `GET /state → pathStuckRecent` delta across the trip (the
  engine's own `path_reset('stuck')` telemetry from P0.1), cross-checked by the
  harness's own 5 s position sampling.
- `orphanedGoto := /state → orphanedGoto` read AFTER the post-trip stop (a leaked
  listener after cleanup = a leak the next task will trip over).
- `hpDelta := hp_before − hp_after`; `blocksBroken` from digguard's log line count
  (pathfinder) / `bot.ashDig` counter (`/goto2`).

**Route aggregate KPIs** (per gauntlet run, per route class): `arrival% = arrived/trips`,
`falseSuccess` (absolute count), `wedges` (absolute), `deaths` (absolute),
`med_ms` (median of arrived trips only), `mean_hpDelta`.

**Course maintenance**: no build needed. Anchors are re-verified (scout trip +
`GET /state` read) whenever a route's arrival% swings >20 pp in one run — terrain change
is a confound, not a regression, and the re-verified `y` is committed into the route
table in this file's changelog. R5b (real water ≥8 blocks wide) still needs siting on
the day, per the original plan.

### 3.2 MP — Mining Plot

Standardized `mineLane` run in a reserved underground field. Stone does not regenerate,
so the *blocks* can't be fixed — the **procedure and stratum** are fixed instead, which
holds yield/duration variance down because plain stone at a fixed Y is homogeneous.

**Facility `bench_quarry_1`** (§5): reserved volume **x=44..64, z=54..74, y≤95** in the
SE scrub harvest zone (distance to plaza center (-3,4): ~66 blocks — satisfies the ≥50
distance law; ~35+ blocks from the CAVECREW camp (11,89,55) and clear of the trading
post; verify surface y on siting day). One shared staircase entrance (safeDescend,
torch-lit, marker block at the head per the TODO-1 mining-aesthetics rule) from the
surface down to the **bench stratum y=40** (comfortably above deepslate transition,
below surface caves; adjust ±4 on siting day if the first descent hits a cavity —
whatever Y is chosen is then frozen into this file).

**Standard run** (one row):

1. Preflight: iron pickaxe ≥80% durability, exactly 16 torches, 16 cobblestone filler,
   food ≥18, inventory ≤8 slots used. (This *is* the `underground` kit tier — the
   preflight refusal path gets exercised for free by run 0 of each session, which
   deliberately departs with 7 torches and must be refused with `kit_missing`.)
2. Descend the shared staircase, walk to the current **lane head**. Lanes are parallel
   1×2 corridors at y=40, spaced 3 apart (standard branch-mine spacing), consumed one
   per run; the next lane head is `(x_head, 40, z_last+3)`, tracked in `ALGO.md`'s MP
   section. The reserved volume holds ~7 lanes per session-year at 20 blocks each; when
   exhausted, extend the reservation southward in BASE.md.
3. `__skills.start(bot,'mineLane',{target:'stone',count:32,laneY:40,vein:false,maxDist:24})`
   — `vein:false` for determinism (vein-following adds variance; it gets its own KPI via
   the ore variant below).
4. Poll `status` at 5 s; on `done`, harness computes the row; `collectDrops` sweep is
   part of the skill; then `depositToChest` into the bench locker on the way out
   (measures the full mine→bank loop, which is what production does).
5. **Torch-compliance audit** (the wedge between "torches placed" and "lane actually
   lit"): one eval walking the dug lane — for every 2nd cell of the corridor floor,
   `bot.blockAt(cell).light`; record `minLight` and `maxTorchGap` (max consecutive
   floor distance between placed torches, from `findBlocks({matching:torch})` along the
   lane axis). The stale-chunk rule is satisfied because the bot is physically walking it.

**Ore variant** (every 3rd full run): same procedure with
`{target:'iron_ore',count:8,vein:true}` from the same stratum — exercises deepslate
aliases, vein-following, and the wrong-tool dig gate. Scored on the same schema with
`variant:'ore'`.

**Metrics** (CSV `bench/results/mp.csv`):

```
ts,engine_v,run,variant,lane,countReq,dug,banked,lost,yieldPct,durationS,
secPerBlock,torchesPlaced,maxTorchGap,minLight,toolBreaks,toolLowWarned,
kitRefusalOk,deaths,dropsLeft,tainted,notes
```

- `yieldPct := banked/dug × 100` (from the skill result's own `banked/dug/lost`,
  cross-checked against harness inventory delta — a disagreement is itself a finding).
- `secPerBlock := durationS / dug`.
- `toolBreaks` = tools that reached 0 durability during the run; **the pass condition
  is not zero breaks, it is zero UNWARNED breaks**: every break must have been preceded
  by a `tool_low` log line in the same status stream (`toolLowWarned` = 1). This is the
  Bernd-stranded-at-depth incident, made mechanical.
- `dropsLeft` = post-run `find-entity`-style scan for item entities within 12 blocks of
  the lane (never-leave-drops law); must be 0.
- `deaths`, `kitRefusalOk` (run-0 probe refused correctly) as booleans.

### 3.3 BP — Build Pad

Standardized `buildSchematic` on a flat pad, then a full demolition that returns the
materials — the pad is reusable and the material cost per run is ~0 (minus tool wear
and blast/void losses).

**Facility `bench_pad_1`** (§5): a leveled **11×11 pad at x=-22..-12, z=28..38**
(floor y frozen at siting; the area W/SW of the plaza is open since the zetbot claim is
defunct; clear of farm_2's planned x=-17..-9,z=0..8, clear of path_1's corridor, ~30
blocks from the plaza — building near base is legal, only *harvesting* has the 50-block
law). Prepared once with `buildFloor` (cobblestone), plus **bench_locker_1** (a chest,
BASE-registered) at its NE corner holding the standing build stock: 64 oak_planks,
32 oak_log, 16 cobblestone, 8 torches, spare tools.

**Standard run**:

1. `POST /blueprint/load {file:'blueprints/hut5.schem', at:[-20,y,30]}` (62 cells,
   bill: 46 oak_planks + 16 oak_log — validated in BLUEPRINTS.md).
2. Inventory snapshot; `__skills.start(bot,'buildSchematic',{name:'hut5',
   chest:{x,y,z of bench_locker_1}, clearSite:false})` — the pad is already flat;
   `clearSite` cost is measured separately by the suite variant.
3. On `done`: harness reads the skill's own `placed/verified/mismatched` **and runs its
   own independent verify eval** (blockAt over all 62 cells vs the placement list —
   principle 2: the verify pass is itself an algorithm under test, and the one time it
   drifts from ground truth is the most important row this benchmark will ever produce;
   record both numbers).
4. Inventory snapshot + locker delta → materials consumed.
5. **Demolition pass** (also scored — it is the mining-aesthetics loop in miniature):
   dig all placed cells, collect all drops, re-deposit to the locker. `reclaimPct` =
   items recovered / items consumed.

**Suite variant** (nightly): `cabin_small_wooden.schem` (221 cells, real third-party
build with stairs/panes — exercises the known state-handling gap; its `mismatched`
count is TRACKED, not failed, until v7.1 state support ships, at which point the
threshold snaps to ≤2) and one `frameStructure` run (the generator path with no
schematic file).

**Metrics** (CSV `bench/results/bp.csv`):

```
ts,engine_v,run,schem,cells,placed,verifiedSkill,verifiedHarness,mismatched,
failed,accuracyPct,durationS,secPerBlock,restocks,consumed,bill,wastePct,
reclaimPct,protectedViolations,placeTimeouts,deaths,tainted,notes
```

- `accuracyPct := verifiedHarness / cells × 100` (the harness count, not the skill's).
- `wastePct := (consumed − bill) / bill × 100` — scaffolding spent, blocks eaten by
  placeBlock false-resolves, re-places after timeouts.
- `placeTimeouts` = count of "blockUpdate did not fire" retries (from the task log
  slice) — the known transient; its *trend* across engine versions is the KPI.
- `protectedViolations` = digguard/reachguard refusals + any BASE.md-registered block
  touched. Must be 0, always, everywhere.

### 3.4 SD — Survival Drill

Two tiers, because live mobs are neither free nor deterministic.

**T1 — mechanical branch drill (deterministic, no mobs, per version bump).**
Prerequisite (small engine addition, ~15 lines, file as FEEDBACK feature-request):
`__survival.drill(branch)` — invokes one branch function against a synthetic threat
descriptor (position = 6 blocks off at the bot's bearing 0, type per branch) with
`dryRun:false` geometry but no real entity, returning the branch's own result object.
Engine-dev already exercised WALL_OFF and FLEE_HOME this way ad hoc on
SchisserSiegbert/3108; the hook standardizes it. T1 asserts:

| probe | pass condition |
|---|---|
| `drill('WALL_OFF')` on flat ground | `sealed:true`, all faces, exit dug away from threat bearing, duration ≤ 20 s |
| `drill('FLEE_HOME')` from 30 blocks out | arrives ≤ 40 s, sprint setting restored after |
| `drill('BREAK_LOS')` beside a 2-high wall | reports `how:'corner'|'wall'`, LOS actually broken (harness raycast) |
| `drill('CREEPER')` | gains ≥ 10 blocks distance from the synthetic position |
| dangerscan tick rate | `__danger.score` updates ≥ 3 times/s over a 10 s watch (4 Hz spec) |
| kit preflight | `safeDescend {toY:-10}` with 15 torches → refused `kit_missing`; with full deep kit → accepted |
| status truth | during a drill, `status.bot.held.dur%`, `danger.state`, `surfaceExposed` all present and sane |

**T2 — live-mob encounter (weekly, the only benchmark with real risk).**
Facility `bench_arena_1` (§5) inside **DIGTEST_1 (x=-100..-90, z=-60..-50)** — the one
zone already designated for destructive testing, ~109 blocks NW of the plaza, ≥24 blocks
from every protected region, and where creeper blast scars are acceptable. Design:

- A roofed **9×9×4 dark chamber** (cobblestone from bench stock, interior light 0 —
  trivially achievable since daylight is frozen and the roof kills skyLight), with a
  1×2 doorway closed by a dirt plug, and an observation spot 30 blocks away (mob
  spawning requires ≥24 blocks from the player; despawn ceiling is 128).
- **Arming**: bot retreats to the observation spot, waits (poll `__danger.threats`
  remotely every 30 s via eval `bot.entities` scan — the free wallhack) until ≥1
  hostile has spawned inside. Frozen daylight means outdoor spawns stay rare; the
  chamber is the only local dark volume, so spawns concentrate there.
- **Drill**: bot approaches to 12 blocks, digs the plug, and *stands ground at the
  doorway* — the mob paths out toward it. Measured from the moment the mob has LOS.
  survival.js and dangerscan do the rest; the harness only watches status.
- **Reset**: after recovery, kill or wall the mob back in (pvp stack), re-plug, sweep
  drops, return to observation. 3 encounters per T2 session max — variance in mob type
  is accepted and recorded (`threat` column); zombie/skeleton/creeper each exercise a
  different branch by design.
- **Abort line**: HP < 6 at any point → harness issues `POST /stop` + manual flee-home
  order and the session ends. A benchmark is not worth a kit.

**Metrics** (CSV `bench/results/sd.csv`):

```
ts,engine_v,tier,run,threat,detectMs,stateAtDetect,branch,branchExpected,
hpStart,hpMin,hpEnd,recovered,recoveryS,handback,death,notes
```

- `detectMs` := first `danger alert|panic` log line timestamp − first-LOS timestamp
  (harness marks LOS when it dug the plug and the mob's position had a clear raycast —
  approximation is fine; the KPI budget is 1000 ms and the scan runs at 4 Hz = 250 ms
  granularity).
- `branchExpected`: creeper→CREEPER, skeleton→BREAK_LOS, zombie(≤40 from arena
  home-point)→FLEE_HOME or melee kill via pvp, else WALL_OFF. Mismatch = soft trigger.
- `handback` := a `panic_recovered` log line reached status (the driver-resume
  contract) — must be 1 whenever `death=0`.

### 3.5 FC — Farm Cycle

The one benchmark on **production infrastructure** (`farm_1`, 26 tiles, shared access —
building/farming near base is legal and the crop is the fleet's food line). It measures
the *work loop*, not crop growth (growth is random-tick RNG; the loop is what the
engine will own when `farmCycle` ships per rule-of-twice — this benchmark is written
FIRST and becomes that skill's acceptance test, which is the right order).

**Standard cycle** (runs opportunistically when a pre-scan finds ≥20 mature tiles;
announce in chat first — `BENCH farm cycle on farm_1, hands off 10 min`):

1. Pre-scan eval: count tiles with `wheat` age 7 (`blockAt(...).getProperties().age`),
   snapshot inventory (wheat, seeds).
2. Run the loop (today: the scripted eval batch drivers already use; tomorrow:
   `__skills.start(bot,'farmCycle',{plot:'farm_1'})`): harvest mature tiles only,
   collect drops, replant every harvested tile, deposit wheat + surplus seeds to
   chest C (ledgered `DEPOT +N wheat`).
3. Post-scan eval: farmland integrity — count farmland cells that reverted to dirt
   (`trampled`), unplanted harvested cells (`missedReplant`), drops left.

**Metrics** (CSV `bench/results/fc.csv`):

```
ts,engine_v,run,tilesMature,tilesHarvested,wheatGained,seedsDelta,replanted,
missedReplant,trampled,durationS,secPerTile,dropsLeft,deposited,notes
```

- `secPerTile := durationS / tilesHarvested`; `seedsDelta` must be ≥ 0 (a cycle that
  eats seed stock is a failing cycle even if wheat landed).
- `trampled` must be 0 — jumping on farmland reverts it; movement discipline inside the
  plot is exactly the kind of thing only a benchmark ever notices.

### 3.6 AS — Autonomy Soak

The pillar-level test: **N hours unattended, zero LLM in the loop, measure whether the
autonomy floor holds.** The bench bot gets a production-shaped standing order and a
watcher script; nobody touches it.

**Setup**: MesswurstManni spawned WITH a role this time (`--role miner` template so
idleguard is armed — the soak tests the real production stack, idleguard included),
full underground kit, and a seeded queue:

```
./task.sh 3110 queue '[
 {"name":"mineLane","args":{"target":"stone","count":32,"laneY":40,"vein":false}},
 {"name":"depositToChest","args":{...bench_locker_1}},
 {"name":"come","args":{...pad}},
 {"name":"collectDrops","args":{"radius":16}}
]' '{"onEmpty":"collectDrops","loop":true}'
```

(if `loop` isn't a queue feature yet, the watcher re-seeds the same 4-job batch
whenever `queue.n==0` — a 6-line addition to the watcher, zero engine change).
Work area = `bench_quarry_1`, so the soak consumes bench lanes, not fleet resources.

**Watcher** (`bench/soak-watch.sh`, local, non-LLM): every 30 s, `GET /state` +
`__skills.status` → append one sample line; every 10 min, a heartbeat row. Samples:

```
ts,connected,pos,hp,food,task,queueN,queueState,idleFlag,danger,stale
```

- `idleFlag := task==null AND queueN==0 AND dist(pos, prevPos) < 1` — the bot is
  neither tasked nor moving. (Idleguard activity shows as movement/task, so this
  measures true dead idle, which is what the no-idle law forbids.)

**Session metrics** (CSV `bench/results/as.csv`, one row per soak):

```
ts,engine_v,hours,samples,idlePct,uptimePct,tasksCompleted,taskFailures,
reconnects,staleAfterReconnect,wedges,interventions,deaths,tokensSpent,
chatLinesPerHour,notes
```

- `idlePct := idleSamples/samples × 100`; `uptimePct := connectedSamples/samples × 100`.
- `reconnects` from the runner log; `staleAfterReconnect` := samples where
  `stalePayloads` non-empty >60 s after a reconnect (the auto-inject keystone, P0.2,
  measured directly).
- `interventions` := number of times a human/LLM had to touch the bot to un-wedge it
  (the watcher pages via a log line; every page that required action counts). The
  8-hour target is **zero**.
- `tokensSpent` := LLM tokens consumed on this bot during the soak (should be 0 by
  construction; any nonzero value is itself the finding).
- `chatLinesPerHour` from `logs/MesswurstManni.log` — narration hygiene under the
  12 s-backlog drop rule (the v6 chat-spam regression, kept dead).

---

## 4. KPI definitions — the common core

Every scenario reduces to six KPI families; `ALGO.md` columns are drawn from these.

| family | definition | direction |
|---|---|---|
| **Success rate** | asserted-outcome successes / attempts (arrival%, accuracy%, yield%, drill pass rate) | higher |
| **Honesty** | falseSuccess count: engine claimed success, world says no | must be 0 |
| **Safety** | deaths, hpDelta, protectedViolations, unwarned tool breaks, trampled farmland | must be 0 / lower |
| **Efficiency** | median duration, secPerBlock/tile, wastePct, reclaimPct | lower (waste) |
| **Autonomy** | idlePct, interventions, staleAfterReconnect, handback rate | lower / handback=1 |
| **Token cost** | LLM tokens per completed outcome (0 for harness-driven runs; counted for soak escalations) | lower, ~0 |

Aggregation rule: medians for durations (timeout-censored trips excluded from `med_ms`
but counted in arrival%), absolute counts for safety/honesty (never rates — one death
in 60 trips is not "98% safe", it is one death), rates for success families.

---

## 5. Facilities — siting, registration, rebuild

All three built facilities get **BASE.md rows** (status `planned` first, per section 2's
reserve-before-build law), plus a note in a new BASE.md subsection mirroring section 10's
"engine test debris" framing: *benchmark facilities are engine infrastructure — not
community infra, no leases needed, but NOT free to demolish (unlike section-10 debris);
they are protected.json entries so pathfinder/digguard treat them as real structures.*

| id | type | coords | notes |
|---|---|---|---|
| `bench_pad_1` | leveled_pad_11x11 | x=-22..-12, z=28..38, floor y frozen at siting | build surface; kept clear between sessions |
| `bench_locker_1` | chest | NE corner of pad, exact coords at placement | bench stock only — NOT a depot chest, no DEPOT lines for internal moves; stocking trips from depot ARE ledgered |
| `bench_quarry_1` | reserved_volume | x=44..64, z=54..74, y≤95; staircase head at NW corner; stratum y=40 | SE scrub, ≥50 blocks from plaza, ≥35 from CAVECREW camp; lane ledger lives in ALGO.md |
| `bench_arena_1` | dark_chamber_9x9 | inside DIGTEST_1 (x=-100..-90, z=-60..-50) | blast damage acceptable here by prior designation; append BASE changelog line on first use per goto2-ab-plan R7 |

**Rebuild procedures** (any facility can be recreated from this section alone):

- *Pad*: `buildFloor` 11×11 cobblestone at the frozen y; re-place locker; restock from
  depot (ledgered). ~20 min.
- *Quarry*: re-run `safeDescend` to the stratum from the registered head coords; place
  marker block + torch the head. Lane ledger in ALGO.md says which lane is next; if the
  registry row is lost, scout for the torched staircase before digging a new one.
- *Arena*: 9×9 footprint, 4-high walls + full roof, cobblestone, doorway center-north
  with dirt plug, zero interior torches. Verify interior `light==0` via a walked eval.
  ~30 min including the walk.
- *Gauntlet*: nothing to rebuild; re-verify anchors per §3.1.

**Explicit siting-law compliance**: destructive scenarios (MP digging, SD blasts) sit at
66 and 109 blocks from the plaza (≥50-block law); BP is construction (near-base legal);
FC uses shared production infra with chat notice; nothing is within r24 of hazard zones
#1 (-33,117,110) or #2 (-6,109,-51); GG route R4 skirts hazard #1's r24 — the route's
existing anchors already respect it, do not "optimize" the leg.

---

## 6. Harness — `bench/` layout and behavior

```
bench/
  bench.sh            # entrypoint: bench.sh <smoke|full|soak> [GG MP BP SD FC] [--ab]
  lib/
    trip.sh           # one goto trip: snapshot, issue, settle, assert, row
    assert.sh         # arrival assertion, inventory delta, blockAt verify evals
    row.sh            # CSV append with flock; schema guards (column count)
    algoboard.sh      # ALGO.md row append + verdict computation (§7)
    regress.sh        # FEEDBACK.md + gh issue automation (§8)
  soak-watch.sh       # 30s sampler + re-seeder + pager
  results/
    gg.csv mp.csv bp.csv sd.csv fc.csv as.csv    # append-only, committed to git
  routes.json         # GG anchor table (single source, updated on re-verification)
```

Rules:

- Pure bash+curl+jq, same idiom as `task.sh` (`evalpost` helper). No node process on
  the bench side beyond what runner.js already is; every eval snippet ships as a quoted
  heredoc in `lib/assert.sh` so it is reviewable and versioned.
- Every CSV row carries `engine_v` (from `__skills.status().v`) and `ts` (ISO-8601) —
  results are join-able to git history (`git log -S 'ENGINE_VERSION = '`).
- CSVs are committed after every session (`git add bench/results && git commit`) —
  the repo is public (felsenuboot/felcrew-mcp); benchmark history is part of the
  engine's public record, same as FEEDBACK.md.
- The harness NEVER calls `/eval` with mutating code outside `lib/` snippets, never
  touches production ports, and refuses to start if `GET /state` on 3110 reports the
  wrong bot name (guard against port typos commanding a production bot — the
  never-command-another-bot's-port law, made mechanical).

---

## 7. ALGO.md — the algorithm scoreboard

### 7.1 Separation of concerns

`SCOREBOARD.md` ranks **drivers** (LLM judgment: output, law adherence, incident
record). `ALGO.md` ranks **algorithms per engine version** (deterministic KPIs from the
bench suite). A driver can score well on a bad engine and vice versa; conflating them
poisons both selection pressures. ALGO.md rows are written by `lib/algoboard.sh`, never
by hand except the `notes` column; the file lives at repo root next to SCOREBOARD.md.

### 7.2 File format (machine-appendable)

```markdown
# ALGO.md — Algorithm Scoreboard (bench-written, append-only)
One table per algorithm. Rows appended by bench/lib/algoboard.sh; humans edit only
`notes`. verdict ∈ BASELINE | PASS | RECORD | REGRESS | INFO. The row marked BASELINE
is the comparison anchor; RECORD replaces it (new accepted best). Full raw data:
bench/results/*.csv keyed by (ts, engine_v).

## goto (ctx.goto + movement profiles)          [suite: GG]
| date | engine | suite | trips | arrival% | falseSucc | wedges | deaths | med_ms R2 | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-09-02 | v13 | full | 60 | 91.7 | 0 | 2 | 0 | 41200 | BASELINE | first full gauntlet |

## mineLane                                      [suite: MP]
| date | engine | runs | yield% | s/block | maxTorchGap | minLight | unwarned toolBreaks | dropsLeft | deaths | verdict | notes |

## buildSchematic (buildCore)                    [suite: BP]
| date | engine | schem | accuracy% | s/block | waste% | reclaim% | placeTimeouts | protViol | deaths | verdict | notes |

## survival (dangerscan + survival.js)           [suite: SD]
| date | engine | tier | encounters | detect ms (med) | branch match | hpMin (worst) | handback | deaths | verdict | notes |

## farmCycle (driver loop until the skill ships) [suite: FC]
| date | engine | cycles | s/tile | seedsΔ | trampled | missedReplant | dropsLeft | verdict | notes |

## autonomy floor (queue+idleguard+runner)       [suite: AS]
| date | engine | hours | idle% | uptime% | interventions | staleAfterReconnect | deaths | tokens | verdict | notes |

## MP lane ledger (harness-maintained)
| lane | z | consumed on | engine |
```

### 7.3 Verdict computation (`lib/algoboard.sh`)

```
row      = aggregate of this session's CSV rows for the algo
base     = the current BASELINE/RECORD row
verdict:
  if any HARD trigger (§8.2)                       -> REGRESS
  elif any SOFT trigger vs base (§8.2)             -> REGRESS
  elif row strictly better on >=1 KPI, worse on 0  -> RECORD  (becomes new anchor)
  elif first ever row for the algo                 -> BASELINE
  elif suite==smoke                                -> INFO    (smoke never sets anchors)
  else                                             -> PASS
```

Smoke rows are INFO/REGRESS only — anchors move on full-suite evidence, so a lucky
25-minute smoke can never raise the bar a nightly then "regresses" from.

---

## 8. Regression → FEEDBACK.md → GitHub, automatically

### 8.1 The pipeline

On `verdict == REGRESS`, `lib/regress.sh`:

1. **Appends a FEEDBACK.md entry** (the file's exact format, reporter `bench-harness`):

   ```
   ### <date> bench-harness — REGRESSION: <algo> <kpi> <base -> now> (engine v<N>)
   type: bug
   status: open
   what: Bench <suite> run <ts>: <kpi> regressed vs anchor v<M> (<base> -> <now>);
         trigger: <hard|soft rule name>. Raw rows: bench/results/<file>.csv @ <ts>.
   fix: bisect engine v<M>..v<N>; suspect commits touching <skill file/function>.
   ```

2. **Files a GitHub issue** (repo already runs issues #10–#18; DRIVER_GUIDE has the
   issues section, open to all teammates by user law):

   ```
   gh issue create -R felsenuboot/felcrew-mcp \
     -t "bench regression: <algo> <kpi> v<M>->v<N>" \
     -l regression,bench \
     -b "<same body + CSV excerpt + link to ALGO.md row + FEEDBACK anchor>"
   ```

3. **Dedupe**: one entry+issue per (algo, kpi, engine_v) — `regress.sh` greps
   FEEDBACK.md for the exact title before writing; re-observations append a
   `seen-again:` line to the existing entry instead (the file's own convention).
4. **Rollout gate**: if the regressing suite was SMOKE for a version about to roll
   out, `bench.sh` exits nonzero and prints `ROLLOUT BLOCKED: <issues>` — the rollout
   manager's checklist keys on that exit code.

Labels to create once: `regression`, `bench` (plus optional per-algo labels `algo:goto`
etc. for filtering).

### 8.2 Triggers

**HARD** (any occurrence, regardless of baseline — these are laws, not comparisons):

| trigger | rationale |
|---|---|
| deaths > 0 in GG/MP/BP/FC, or SD death with `branchExpected` matched | a death on a standard course is an engine failure by definition |
| falseSuccess > 0 anywhere | an engine that lies is worse than one that fails (goto2-ab-plan §5, generalized) |
| protectedViolations > 0, digsRefused > 0 | the claims pillar is non-negotiable |
| unwarned toolBreak > 0 | the silent-breakage incident class |
| dropsLeft > 0 | fleet law |
| kit preflight accepted a half-kit (run-0 probe passed when it must refuse) | safety floor |
| soak: staleAfterReconnect > 0 | the P0.2 keystone must never re-open |

**SOFT** (vs the anchor row; tuned to sit above run-to-run noise):

| kpi | trigger |
|---|---|
| arrival% (per route class) | drop > 10 pp (5 pairs/route ⇒ 1 trip = 10 pp = noise; 2 trips = signal) |
| arrival% (gauntlet overall) | drop > 5 pp |
| accuracy% / yield% | drop > 3 pp |
| med duration / secPerBlock / secPerTile | +25 % |
| wastePct | +5 pp absolute |
| maxTorchGap | > 7 (the user's spacing law — really a hard rule wearing a soft coat) |
| detectMs (median) | > 1000 ms, or +250 ms vs anchor |
| wedges (gauntlet total) | > anchor + 2 |
| idlePct (soak) | > anchor + 3 pp |
| chatLinesPerHour (soak) | > 2× anchor (the spam regression class) |

---

## 9. Acceptance thresholds — when an algorithm is "GOAL.md-pillar DONE"

"DONE" = the pillar's engine carrier holds these numbers on **two consecutive FULL
suites on two different engine versions** (one green run proves the run, two prove the
algorithm), with zero HARD triggers in between. On acceptance, the GOAL.md pillar row
flips to DONE with a link to the ALGO.md rows; a later REGRESS on that algorithm flips
it back to WORKING — DONE is a held title, not a trophy.

| algorithm | pillar(s) carried | acceptance bar |
|---|---|---|
| **goto / movement** | supports every pillar; retires the movement-wedge failure class | gauntlet arrival ≥ 95 % overall AND ≥ 90 % per route class; falseSuccess = 0; wedges = 0 across the full 60 trips; deaths = 0; R2 completes inside its historical 60 s ceiling in ≥ 8/10 trips |
| **mineLane (+ safeDescend)** | Mining / shafts | 10 consecutive standard runs: deaths = 0, yield ≥ 95 %, maxTorchGap ≤ 7 AND minLight ≥ 8, dropsLeft = 0, every tool break pre-warned, kit refusal correct 10/10; ore variant: no wrong-tool hang (all digs resolve or timeout-race cleanly) |
| **buildSchematic / buildCore** | Base building, Trading stations | hut5 accuracy = 100 % and cabin ≥ 98 % (mismatched ≤ 2 once state support ships; tracked-not-failed until then); wastePct ≤ 10 %; reclaimPct ≥ 85 %; protectedViolations = 0; zero manual patch interventions |
| **dangerscan + survival.js** | Survival / self-preservation | T1: 7/7 probes pass on two consecutive versions; T2: 10 cumulative live encounters with deaths = 0, hpMin ≥ 6, median detect ≤ 1 s, branch match ≥ 8/10, handback = 10/10 |
| **farmCycle** | Farming / food production | 5 consecutive cycles: secPerTile ≤ 8, trampled = 0, missedReplant = 0, seedsΔ ≥ 0, dropsLeft = 0, deposit ledgered 5/5 (the loop must also EXIST as a skills.js algorithm — a driver-eval loop meeting the numbers proves the spec, not the pillar) |
| **autonomy floor** | Autonomy floor (no idle, no babysitting) | 8 h soak: uptime ≥ 99 %, idlePct ≤ 5 %, interventions = 0, deaths = 0, staleAfterReconnect = 0, tokensSpent = 0, taskFailures ≤ 2 with queue halting correctly both times |

(Deliberately absent: chat/FLEET-1 and cross-framework pillars — those need a protocol
conformance suite, a different instrument; note for a future bench track once
chatlisten.js ships. The spoof-rejection test in SYNTHESIS P3 is its seed.)

---

## 10. Runbook + cadence summary

| when | what | operator | duration |
|---|---|---|---|
| every `ENGINE_VERSION` bump, pre-rollout | SMOKE (GG R1/R2/R4 ×1 pair, MP ×1, BP hut5 ×1, SD-T1) | the engineer shipping the bump | ~60–75 min |
| nightly (or per engine work session) | FULL (GG ×5 pairs/route, MP ×3 + ore every 3rd, BP suite, SD-T1, FC if ≥20 mature) | engine team | ~4 h wall clock, unattended between scenario starts |
| weekly + after any queue/idleguard/runner change | AS 8 h soak; SD-T2 (3 encounters) | engine team (starts it, walks away) | 8 h + 30 min |
| on anchor drift (route arrival swing >20 pp) | re-verify GG anchors, commit routes.json | whoever noticed | 20 min |

**Bootstrap order** (first session, ~one evening):
1. BASE.md `planned` rows for the four facilities; build pad + locker (+stock, ledgered);
   site + freeze quarry stratum; arena deferred to the first T2 week.
2. Write `bench/` harness (lib snippets are mostly existing eval idioms from
   DRIVER_GUIDE/goto2-ab-plan, relocated).
3. Run one FULL suite on the current engine → every algorithm gets its BASELINE row in
   a fresh ALGO.md.
4. Wire `regress.sh` (FEEDBACK append + `gh issue create`), create the two labels.
5. Add the one-sentence rollout gate to DRIVER_GUIDE.md's rollout protocol.

**Known risks / open decisions:**
- **Client-slot contention** (cap 8, fleet 7): bench sessions and engine-dev test bots
  share one slot; CAVECREW growth could squeeze it to zero. Mitigation: bench sessions
  are scheduled, short-lived, and the SMOKE suite can run on an engine-dev test bot
  that is already up (same payload stack) if slot-starved — noted in the row's `notes`.
- **World drift**: routes and strata age (terrain edits, CAVECREW construction). The
  anchor re-verification rule and the frozen-Y convention absorb most of it; a route
  that becomes unrecognizable is retired and replaced with a same-class successor,
  never silently edited (comparability beats continuity).
- **SD-T2 spawn variance**: frozen daylight makes the arena the dominant local spawn
  volume, but spawn *type* is RNG — the per-threat branch table and 10-cumulative-
  encounter acceptance window are sized for that.
- **mineLane at y=40 may strike a cave/lava pocket**: the stratum-freeze + lane-ledger
  design makes that a one-time siting cost, not a per-run confound; a breached lane is
  marked `tainted` and the next lane offset used.
