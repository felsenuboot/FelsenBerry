# /goto vs /goto2 — A/B test plan (6 routes)

Prepared 2026-09-01 (ashfinder-prep). Companion to `research/movement-engines.md` §1.10 and
`goto2.patch.js`. Nothing here has been executed yet — this is the protocol to run once
`goto2.patch.js` is merged into `runner.js`.

**Purpose:** decide, per route class, whether `@miner-org/mineflayer-baritone` ("ashfinder",
`/goto2`) should become an automatic fallback for `/goto`, stay a manual escape hatch, or be
dropped. The decision variable is **arrival rate, not speed** — speed differences are
recoverable through pathfinder tuning (movement-engines.md §2), arrival on terrain pathfinder
cannot solve is not.

---

## 0. Preconditions — do NOT start before all five are true

1. **Pathfinder tuning has landed and is verified live.** `runner.js baseMovements()` already
   carries the safety profile and the `blocksToAvoid` wedge fix (`leaf_litter`, `torch`,
   `wall_torch` — movement-engines.md §2.4). Measuring stock pathfinder against ashfinder
   would flatter ashfinder and mislead the adoption call. Confirm via
   `GET /state → movements` before trip 1.
2. **`goto2.patch.js` is merged** per its MERGE INSTRUCTIONS, and `GET /state` reports
   `ash: "ready"`. If it reports `"load-after-spawn"`, ashfinder was loaded via `/eval` or
   `inject.sh` — its path executor is null and every trip will fail with a TypeError
   (goto2.patch.js GOTCHA 0). Fix the load site; do not work around it.
3. **One extra client only.** Player cap is 8 and the fleet sits at 7. Run the A/B on **one
   throwaway bot** — `GrubenGuenther`, HTTP port 3106 — and `kill` the process the moment the
   last trip finishes. Do not run a second test client "just to compare".
4. **Quiet window.** Note which fleet bots are active and where. Another bot pathing through
   the same corridor is a confound; a mob fight is a bigger one. Record `nearbyBots` per trip.
5. **`/goto2` dig tests only in the designated zone** (§2). The base plaza (x=-8..2, z=-1..9),
   the CAVECREW camp (~11,89,55), the trading post (6-8,112,22) and every BASE.md structure are
   off-limits, and ashfinder's dig **bypasses `digguard.js` entirely** (it writes raw
   `block_dig` packets, digguard only wraps `bot.dig` — goto2.patch.js GOTCHA 9). The patch's
   corridor check and per-break guard are the only protection; do not disable them.

---

## 1. Test subject

| | |
|---|---|
| Bot | `GrubenGuenther` (14 chars, FLEET LAW compliant) |
| Port | `http://127.0.0.1:3106` |
| Gear | iron pickaxe + iron axe + iron shovel, full stack of food, **no armour** (armour changes fall-damage numbers and muddies `hpDelta`) |
| Inventory | ≤ 8 slots used. A full inventory changes dig behaviour (drops fail to pick up) |
| Narration | on, as always — announce route id and engine before each trip |
| Lifetime | spawn → 60 trips → `kill` the process. Log the PID at spawn |

---

## 2. Routes

Anchors are BASE.md-registered where possible. `y` values marked **(verify)** must be
re-resolved on the day with a scout `/goto` + `GET /state` read — terrain has changed since
these coordinates were logged and a `y` that is 2 blocks off turns a fair test into a
noise generator.

| # | Class | From | To | ~dist | `dig` | Notes |
|---|---|---|---|---|---|---|
| **R1** | Short cluttered base move | `depot_chest_b` (-5, 111, 3) | `crafting_table_1` (-3, 111, 4) then `pond_1` edge (1, 110, 10) | ~3 / ~10 | no | The plaza is dense with chests, furnaces, torch posts, fences. Tests tight-quarters quality, where ashfinder's greedy `hWeight: 1.67` is expected to *lose*. |
| **R2** | **The known 60 s timeout** | `depot_chest_b` (-5, 111, 3) | NW forest **(-78, 98, -29)** *(verify y)* | ~82 | no | The route this whole exercise exists for. Historical target from `MettMarcel.log` 2026-08-31T20:04:05Z; it sits in FurzFriedrich's declared "N/NW forest" sector. Detour-heavy, sloped, tree-dense. **Timeout: 60000 ms on BOTH engines** so the comparison is like-for-like with the documented failure. |
| **R3** | Long open surface haul | plaza edge (2, 110, 5) | **(326, 100, 38)** *(verify y)* | ~325 | no | Another real failure from the logs — Marcel issued this `goto` three times in 80 s, i.e. it never completed. Well past ashfinder's 75-block `gotoSmart` waypoint threshold, so it exercises `SmartWaypointPlanner`, the single strongest argument for adopting ashfinder. Timeout 180000 ms. |
| **R4** | Hilly / edge-prone (the route that killed Marcel) | plaza edge (2, 110, 5) | `pen_1` gate (-29, ~140, 137) *(verify y)* | ~135 | no | Ridge line with real fall exposure. **Primary safety test.** Any death here disqualifies the engine for this class outright, no matter what the timing says. Both engines run with parkour off and `maxFallDist`/`maxDropDown` = 3. |
| **R5** | Water crossing | plaza (0, 110, 6) | across `pond_1` to (3, 110, 12) | ~7 | no | Honest caveat: `pond_1` is 2×2 (x=1..2, z=10..11) — too small to be a real swim test. **Add R5b:** the nearest natural water ≥ 8 blocks wide, scouted on the day and its coordinates written into the results table. Swimming is ashfinder's clearest capability gain (pathfinder treats water as `liquidCost` terrain and drowns bots); if R5b cannot be sited, record R5 as *inconclusive* rather than pretending the pond settled it. |
| **R6** | Descent + return | plaza edge (-4, 110, 4) (`quarry_ladder_1` head) | (-4, -31, 4) at the depth `BuddelBernd` died at, then back to the shaft head | ~140 vertical | no | Travel only, no digging — the quarry shaft already exists, and this is inside base XZ where FLEET LAW forbids digging. If neither engine can descend without breaking blocks, that is the finding: record it and stop, do not enable `dig`. Ladder/vine climbing is ashfinder's second real capability gain. Timeout 120000 ms. |
| **R7** *(optional)* | Dig-enabled travel | `DIGTEST_1` corner (-100, ~72, -60) | (-90, ~72, -50) *(verify y)* | ~14 | **yes** | Only run this if R1–R6 give ashfinder a reason to exist. **Designated remote test zone `DIGTEST_1`: x = -100..-90, z = -60..-50, all y.** ~109 blocks NW of the plaza — clear of the 60-block base exclusion, clear of the NW forest working sector, and ≥ 24 blocks from every region in `protected.json`, so the patch's corridor check passes. Append a line to BASE.md's changelog the first time it is used. Purpose: measure ashfinder's hand-rolled `block_dig` path on 1.21.11 (movement-engines.md §1.6.6 rates this the most likely 1.21.x failure mode) and count terrain scars. |

Six measured route classes = R1–R6. R7 is a conditional seventh, gated on the outcome.

---

## 3. Metrics

`goto2.patch.js` returns all of these in its JSON response, on **failures as well as
successes** — a failed trip is a data point, not a void. Record the same fields for `/goto` by
reading `GET /state` before and after.

### Primary (decide adoption)

| Metric | Source | Definition |
|---|---|---|
| `arrived` | patch response / post-trip position | **True arrival**, asserted by real distance with an 800 ms physics settle window — never the engine's own status. Both engines report success while standing still (ashfinder: upstream #7 + the `handleStuck` parse bug; pathfinder: `goto.js` checks `path.length === 0` before `status === 'noPath'`). |
| `falseSuccess` | derived | Engine said success **and** `dist > 2`. **Count these separately and loudly** — an engine that lies about arrival is worse than one that fails honestly, because a driver builds on the lie. |
| `dist` | derived | Blocks from final position to target centre. |
| `deaths` | log scan | Any death on a route disqualifies that engine for that route class. Non-negotiable. |

### Secondary (tie-breakers, and the tuning feedback loop)

| Metric | Source |
|---|---|
| `ms` | wall clock, request to response |
| `timedOut` | did the hard wall-clock ceiling fire |
| `hpDelta` | `bot.health` before/after — fall and mob damage |
| `blocksBroken` | `/goto2`: counted by the `bot.ashDig` wrapper. `/goto`: count `bot.dig` calls via digguard's log lines. **This is the "dig damage" / terrain-scar number.** |
| `digsRefused` | `/goto2` only — breaks the guard blocked inside a protected region. **Any non-zero value is a hard fail for that engine on that route**, and a FEEDBACK.md entry. |
| `pfInterference` | `/goto2` only — times the watchdog had to re-clear a pathfinder goal that appeared mid-run (a hunt/collect/idle-guard stomping on the handoff). Quantifies the two-engines-on-one-body risk. |
| `visitedNodes` / `generatedNodes` / `searchTime` | `/goto` only — pathfinder's free `path_update` telemetry (movement-engines.md §2.5). Tells you whether a pathfinder loss is a *search budget* problem (fixable by tuning) or a *representation* problem (not fixable). |
| `stuckResets` | `/goto` only — `GET /state → pathStuckRecent`, already tracked in `runner.js`. 3+ within 15 s is a wedge. |
| `smart` | `/goto2` only — did it take the `gotoSmart` waypoint path (auto past 75 blocks) or a direct `goto` |
| `firstVisit` | manual flag — was this the first traversal of the route this session (cold chunks) |
| `nearbyBots` | manual — other fleet bots within ~40 blocks |

---

## 4. Protocol

**60 trips: 6 routes × 5 runs × 2 engines.** Roughly one afternoon.

1. **Warm-up, unmeasured.** Traverse every route once, either engine, before any measurement.
   Cold chunk loading dominates a first traversal and would be scored against whichever engine
   happened to go first. Discard these results; record that they happened.
2. **Alternate engines within a route, never batch them.** `A B A B A B A B A B` for the five
   pairs, and flip which engine leads on each route (R1 leads pathfinder, R2 leads ashfinder,
   …). Batching all five pathfinder runs then all five ashfinder runs confounds the engine with
   world state — daylight, mob spawns, another bot's terraforming.
3. **Reset by walking, never by teleport.** A trip is `S → T`. Reset to `S` with a return leg
   using the **same** engine, recorded as its own data point (so R2 yields ten measurements
   per engine, five out and five back — outbound and return are genuinely different routes on
   sloped terrain). No `/tp`: survival only, no server ops.
4. **Between trips:** `POST /stop`, confirm `GET /state` shows `task: null` and
   `ash.inFlight: false`, wait 3 s. Confirm HP is back to 20 and hunger > 14 before the next
   trip, or eat first — a hungry bot cannot sprint and the timing data becomes garbage.
5. **On a death:** record it, respawn, walk back to the anchor, and **restart that route's
   sequence from run 1** for both engines. Also re-check `GET /state → ash` after any respawn:
   the plugin rebuilds its executor on every spawn, and each rebuild leaks one 50 Hz timer
   (GOTCHA 11) — note the death count so a long session's leak is attributable.
6. **On `digsRefused > 0` or an unexplained protected-block break:** stop the whole A/B
   immediately, file a FEEDBACK.md entry, and do not restart until the guard is understood.
7. **Log everything to one CSV** as you go — `research/goto2-ab-results.csv`, one row per trip:
   `route,engine,run,direction,ms,arrived,dist,falseSuccess,deaths,hpDelta,blocksBroken,digsRefused,pfInterference,timedOut,visitedNodes,stuckResets,smart,firstVisit,nearbyBots,notes`.

### Harness sketch

```bash
BOT=http://127.0.0.1:3106
# pathfinder (default engine)
curl -s -X POST $BOT/goto  -H 'content-type: application/json' \
     -d '{"x":-78,"y":98,"z":-29}'
# ashfinder (second engine) — same target, same 60s ceiling as /goto's hardcoded one
curl -s -X POST $BOT/goto2 -H 'content-type: application/json' \
     -d '{"x":-78,"y":98,"z":-29,"range":1,"timeoutMs":60000}'
# state snapshot before/after each trip
curl -s $BOT/state | jq '{pos:.position,hp:.health,task:.task,ash:.ash,stuck:.pathStuckRecent}'
```

`/goto`'s timeout is currently hardcoded at 60 s in `runner.js`. For R3 (325 blocks) and R6
that ceiling is unfair to pathfinder — either raise it for the test or record R3/R6 pathfinder
trips as "capped at 60 s" and treat the comparison as arrival-only, not timing.

---

## 5. Adoption criteria, per route class

Evaluate each route class independently. **A win on speed is not a win.**

### Adopt ashfinder as `/goto`'s automatic fallback for a class

All four must hold:

- **Arrival:** ashfinder arrival rate ≥ pathfinder + 20 percentage points (e.g. 8/10 vs 5/10),
  **or** pathfinder < 50 % and ashfinder ≥ 80 %. A 1-trip difference over 10 is noise.
- **Safety:** zero deaths, and `hpDelta` mean no worse than pathfinder's by more than 2 HP.
- **Scars:** `blocksBroken` ≤ pathfinder's, and `digsRefused` exactly 0.
- **Cleanliness:** `falseSuccess` = 0 (the patch's arrival assertion should guarantee this;
  a non-zero count means the assertion itself is broken and must be fixed before any adoption
  decision is credible).

"Fallback" means: `/goto` tries pathfinder; on a genuine `no_path`/timeout it retries once via
the `/goto2` path — **for that route class only**, gated on distance/biome, never globally.

### Keep ashfinder as a manual-only escape hatch for a class

- Arrival rate is comparable (within 20 pp) but ashfinder solves a *specific* obstacle
  pathfinder never does (a swim, a ladder shaft), **or**
- It wins on arrival but costs measurably more HP or more broken blocks.

Drivers then call `/goto2` deliberately, as documented in DRIVER_GUIDE.md. This is the
expected outcome for **R5 (water)** and **R6 (ladders)**.

### Reject ashfinder for a class

Any one of:

- Any death attributable to the engine.
- `digsRefused > 0`, or any protected block broken.
- `pfInterference` > 2 per trip on average (the two engines cannot share the body on this
  route; the handoff is not safe to automate).
- Arrival rate below pathfinder's.

**Expected rejections, stated in advance so the result is falsifiable rather than
rationalised:** R1 (tight quarters — greedy `hWeight: 1.67` should lose) and R6-with-digging
(the hand-rolled `block_dig` path at depth is the highest-risk code in the package, at the
place where a stranded bot costs the most).

### Kill switch for the whole experiment

Drop ashfinder entirely — `npm uninstall`, delete the route — if **any** of these appear:

- A crash or hang that survives `POST /stop` (the `stop()`-leaves-the-promise-pending bug,
  GOTCHA 4, escaping the patch's mitigations).
- A protected structure damaged.
- Arrival rate below pathfinder's on 4+ of the 6 route classes.

Rollback is cheap and total by design: nothing else in the stack depends on `bot.ashfinder`.

---

## 6. Deliverables

1. `research/goto2-ab-results.csv` — 60+ rows, raw.
2. A results section appended to this file: per-route table (arrival rate, median ms, mean
   hpDelta, blocksBroken, falseSuccess), and the adoption verdict per class against §5.
3. FEEDBACK.md entries for anything the trips reveal — especially any 1.21.11-specific
   ashfinder failure, since the package makes **no version-support claim anywhere** and the
   only user-reported version in its issue tracker is 1.20.1.
4. TODO.md item 2 updated with the verdict, and DRIVER_GUIDE.md updated with the per-route-class
   guidance drivers should actually follow.
5. **Confirm `GrubenGuenther`'s process is dead** and the fleet is back to 7 clients.
