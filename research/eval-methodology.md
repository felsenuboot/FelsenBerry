# Evaluation Methodology for a Noisy, Non-Resettable Live World

**Track:** statistical + experimental method (research track, 2026-09-01)
**Scope:** how to compare engine versions and movement engines fairly; how to build
benchmark courses on a persistent shared server; when passive telemetry suffices; what
should gate a rollout; and the specific biases this fleet is already generating.
**Status:** research report. No engine code changed, no bot commanded.
**Companion docs:** `research/SYNTHESIS.md`, `research/goto2-ab-plan.md`,
`research/movement-engines.md`, `FEEDBACK.md`, `SCOREBOARD.md`, `DRIVER_GUIDE.md`.

---

## 0. Executive summary — the eight findings that change what you should do

1. **The live world cannot power a statistical A/B, and it never will.** With one spare
   player slot (cap 8, fleet at 7), a trip costing 30–180 s, and terrain variance
   dominating engine variance, the achievable sample size on the live server detects only
   ~35–50 percentage-point differences. Every design decision below follows from accepting
   that constraint rather than fighting it. §4.

2. **The unit of statistical independence is the ROUTE, not the trip.** Five repeats of one
   route are ≈ one observation, not five: if a route deterministically decides both engines'
   fates, all five pairs are concordant and carry *zero* information. `goto2-ab-plan.md`'s
   6 routes × 5 runs allocation is inverted. The fix is **more routes, fewer repeats**:
   ≥ 8 routes per class at 2 trips each. With R routes the cluster-level sign test has a
   p-value floor of 2^(1−R) — at R = 5 you literally cannot reach p < 0.05 no matter how
   clean the result. §4.3.

3. **Generate routes from a seed; don't curate them.** A hand-picked route list is a
   cherry-picking bias and cannot be enlarged cheaply. A seeded random sampler (`R` targets
   at distance d ± 10 % from a fixed anchor, rejecting protected regions) gives exchangeable
   draws, valid cluster inference, reproducibility, and as many routes as you can afford.
   Curated wedge routes belong in the *deterministic smoke tier*, not the statistical tier —
   they answer a different question (worst case, not average case). §7.2.

4. **The highest-value evaluation asset here is not statistics — it is a deterministic
   assertion suite indexed to `FEEDBACK.md`.** Almost every real regression in this stack is
   a *binary breakage* (payload not injected, `blocksToAvoid` missing, `stop()` poisoning,
   digguard bypassed), not a distributional shift. One N=1 reproduction of the
   torch-underfoot wedge is worth more than a 60-trip gauntlet, costs 20 s, and never
   produces a false alarm. Every entry flipped to `status: shipped(vN)` should ship with a
   reproduction test. §9.1, §11.

5. **A gauntlet cannot gate small regressions — stop pretending otherwise.** Detecting a
   5 pp drop in goto success at 90 % baseline needs ~444 trips per arm. The gate ladder must
   therefore be *staged by detectable effect size*: Tier 0 deterministic smoke (catches
   breakage, N=1, blocking), Tier 1 gauntlet (catches ≥ 25–35 pp, blocking), Tier 2 canary
   with SPC (catches ~10–15 pp over an hour), Tier 3 fleet telemetry with CUSUM + auto-
   rollback (catches ~5 pp over a day). Each tier is sized to what it can actually see. §9.

6. **You cannot A/B safety on deaths.** At the observed rate (3 deaths / ~42 bot-hours ≈
   0.07 per bot-hour), detecting a *halving* needs ~65 total deaths ≈ 900 bot-hours ≈ 130
   nights of the current fleet. Safety must be evaluated on **high-frequency near-miss
   surrogates** — HP-drop events, seconds-with-hostile-within-8, fall-distance-over-3 events,
   seconds in skyLight 0, panic entries per hour — with the surrogate–death correlation
   validated once against the historical logs. §5.4.

7. **Field telemetry is already survivorship-biased in three measurable ways, and two of
   them are informative missingness.** `S.log` is a 100-entry in-memory ring returned 20 at a
   time and destroyed on restart, so the *busiest and most broken* periods lose the most log
   lines. `say()` drops narration scheduled > 12 s out, so the busiest periods also lose the
   most chat-derived records. And dead/wedged/restarted bots stop emitting entirely — a
   version that kills bots produces *fewer* bad records, not more. The fix is a **durable
   append-only JSONL event sink written at task START, not only at end**, plus per-exposure-
   hour denominators. §8.2, §10.1.

8. **`SCOREBOARD.md` is a Goodhart machine as currently specified.** `score = (100 − 10·rank)
   − 25·deaths + 5·shipped_findings`, with `deaths` sourced from *driver self-reports* and
   `shipped_findings` counted per entry. That rewards finding-splitting, punishes risk-taking
   (deep mining, night ops, hard routes — exactly the work that produces engine learning),
   and makes the penalty term self-audited. Concrete repairs in §10.2 — most importantly:
   source deaths from the `<death>` log lines, credit root-cause *clusters* not entries, and
   never let a driver-visible score touch an engine A/B.

**The one structural recommendation that dominates everything else:** stand up a **staging
world** — a local server, fixed seed, snapshot/restore between runs, no player cap, no fleet,
`doDaylightCycle false` / `doMobSpawning false` / `randomTickSpeed 0` as needed. That converts
"non-resettable" into "resettable" for everything except external-validity checks, and buys
roughly an order of magnitude in sample size and two orders in variance. Prerequisite: a JRE
(none installed — `java not found`; the HeadlessMc 2.10.0 bundled runtime already pinned in
`movement-engines.md §3` solves this without a system install). §1.3.

---

## 1. The constraint set (why standard A/B practice does not transfer)

### 1.1 What is actually varying between two trips

| Source of variance | Magnitude | Controllable? | How |
|---|---|---|---|
| Route geometry / terrain | **Dominant** — decides success outright | Yes, by **pairing** (same route both arms) | §3.1 |
| Chunk load state (cold vs warm) | Large on first traversal | Yes, by warm-up laps + a `firstVisit` flag | §3.4 |
| Server tick health (fleet activity, mob load) | Medium on duration, small on success | Partly, by **blocking in time** + covariate | §1.2, §8.1 |
| Mob encounters | Medium; occasionally fatal | No. Randomise, don't exclude | §10.4 |
| Concurrent fleet interference (a bot pathing through, idle-guard stomping goals) | Medium; occasionally total | Partly: pre-state assertions + `nearbyBots` | §3.5 |
| Terrain contamination (bots digging/building the course) | Cumulative, one-directional | Yes: dig-off, protected zones, fingerprinting | §7.4 |
| Bot state (hunger, durability, inventory fill, armour) | Small–medium | Yes: pre-trip preconditions | §3.5 |
| Daylight / time of day | Small (daylight cycle appears frozen) | Verify, then ignore or block on it | §3.3 |
| Client-side physics jitter | Small | No | — |

The ordering matters: **pairing kills the dominant term.** Everything else is second-order.
A design that pairs correctly and then gets sloppy about hunger is far better than one that
controls hunger meticulously and compares different routes.

### 1.2 A free confounder measurement you do not currently take: server tick rate

Nothing in `runner.js`, `skills.js`, `dangerscan.js`, `survival.js` or `idleguard.js` measures
server health (grepped: no `time.age`, no `tps`, no tick counters). Duration metrics are
therefore contaminated by an unobserved, fleet-activity-correlated variable.

Cheap client-side proxy — the server sends `time_update` every 20 ticks, so world age
advances at 20 ticks per real second on a healthy server:

```js
// sample over >= 60s; shorter windows are dominated by packet jitter
const a0 = bot.time.age, t0 = Date.now();
// ... later ...
const tps = (bot.time.age - a0) / ((Date.now() - t0) / 1000);   // ~20.0 healthy
```

Record `tpsBefore` on every benchmark trip and every telemetry epoch. Use it three ways:
(a) as a **pre-treatment exclusion** (`tps < 18` → void the trip, §10.5); (b) as a CUPED-style
covariate (§6.4); (c) as an SPC channel of its own — a fleet that drives TPS down is a finding.

If CAVECREW's Carpet mod is reachable via RCON, `/tick health` gives the authoritative number;
the client proxy is the fallback that always works.

### 1.3 The staging world — the single highest-leverage change

Everything in §4 is depressing *because the live world is scarce*. It does not have to be the
only world.

```
minecraft/bench-server/          # fabric or paper, MC 1.21.11, fixed seed
  world/                         # snapshot source of truth
  snapshots/base.tar.zst         # restore = stop, untar, start (~seconds for a small world)
  server.properties              # max-players=20, online-mode=false, view-distance=10
```

Gamerules per benchmark family:

| Benchmark | `doMobSpawning` | `doDaylightCycle` | `randomTickSpeed` | `keepInventory` |
|---|---|---|---|---|
| Movement / goto gauntlet | `false` | `false` (`time set noon`) | `0` | `true` |
| Mining plot | `false` | `false` | `0` | `true` |
| Build pad | `false` | `false` | `0` | `true` |
| Survival / danger reflexes | `true` | `true` | default | `false` |

What this buys, quantified:

- **Sample size**: no player cap → run 4–8 test clients in parallel → 5–8× trips per hour.
- **Variance**: mobs off + daylight frozen + no fleet removes three of the seven variance
  sources in §1.1 outright. Expect ~3–5× reduction in duration SD, which is ~10× in N.
- **True repeatability**: `snapshot restore` gives byte-identical terrain, so contamination
  (§7.4) stops being a threat and courses stop needing fingerprints.
- **Destructive tests become legal**: dig-enabled pathing, cave-breach tests, explosion
  spawn-proofing, the whole class currently blocked by "don't damage the base".

What it does **not** buy — state this in every report so nobody over-claims:

- **Not determinism.** Server thread scheduling, entity iteration order, and mineflayer's
  real-time-clocked 20 Hz physics all remain nondeterministic. Expect reduced variance, not
  zero. Repeats are still required.
- **Not external validity.** The live server has CAVECREW, chunk corruption, real chat, real
  rivals, a real economy. Staging answers *"did the engine change work"*; the live fleet
  answers *"does it survive contact"*. Both are needed; they are not substitutes.

**Prerequisite:** no JRE is installed (`java not found`). Either `pacman -S jdk21-openjdk`
(user decision) or reuse the HeadlessMc 2.10.0 native binary already sha256-pinned in
`movement-engines.md §3`, which downloads its own runtime. 392 GB free disk, 13 GB available
RAM, 16 cores — a 2 GB Paper server plus 8 mineflayer clients fits comfortably.

---

## 2. Metric definitions (exact, and why each is defined that way)

A metric that is not defined to the decimal is a metric two agents will compute differently
next week. These are the canonical definitions; the harness implements exactly these.

### 2.1 The oracle-independence rule

> **No metric may be sourced from the system under test.**

This is not pedantry here — it is the single most load-bearing rule in this document, because
this stack has *documented, reproducible false success on both engines*: pathfinder's
`goto.js` checks `path.length === 0` before `status === 'noPath'` and resolves an empty path as
success; ashfinder's `handleStuck()` has a `!x === false` dead branch that reports success while
standing still. An engine that lies about arrival is worse than one that fails honestly,
because a driver builds on the lie.

Therefore: **arrival is computed by the harness from a `GET /state` position read**, never from
the engine's return value. The engine's own verdict is recorded as a *separate field* whose
only purpose is to compute `falseSuccess`.

### 2.2 Movement metrics

```
target        := the goal centre (x, y, z) from the course file
p_final       := GET /state .position, read 800 ms after the engine call returns
                 (physics settle window; a shorter read catches the bot mid-slide)
distXZ        := sqrt((p_final.x - target.x)^2 + (p_final.z - target.z)^2)
distY         := abs(p_final.y - target.y)

arrived       := (distXZ <= goalRange + 0.5) AND (distY <= 1.0)
engineSaidOk  := HTTP 200 with ok:true   (pathfinder) | patch response arrived:true (ashfinder)
falseSuccess  := engineSaidOk AND NOT arrived
honestFail    := (NOT engineSaidOk) AND NOT arrived
silentWin     := (NOT engineSaidOk) AND arrived        -- rare; log it, it means a bad assertion

ms            := t_response - t_request, measured at the harness (HTTP overhead ~1 ms, ignore)
timedOut      := ms >= ceilingMs - 500
censored      := timedOut                              -- see §6.3: NEVER impute the ceiling
hpDelta       := state.health after - state.health before
deaths        := count of `<death>` lines in logs/<bot>.log within [t_request, t_response+5s]
blocksBroken  := digguard-logged bot.dig calls in the window (pathfinder)
                 | bot.ashDig wrapper counter (ashfinder)
```

`goalRange` must be **identical across arms**. `runner.js` uses `GoalNear(x,y,z,1)`; the
`/goto2` patch takes `range`. A benchmark that compares `range:1` against `range:3` is
measuring the range parameter, not the engine.

### 2.3 The outcome is multinomial, not binary

Collapsing to `arrived ∈ {0,1}` throws away the distinction that matters most. Record the
outcome as one of five mutually exclusive states and define a **scalar utility** so a decision
rule exists:

| Outcome | Utility | Rationale for the weight |
|---|---|---|
| `arrived` | **+1** | the goal |
| `honest_fail` | **0** | the driver retries or re-plans; cost is one wasted trip |
| `timeout` | **−0.2** | an honest fail that also burned the ceiling in wall-clock |
| `false_success` | **−3** | poisons every downstream driver decision; the driver proceeds to *act* at the wrong place. Weight ≈ "costs three trips to detect and unwind" |
| `death` | **−50** | full re-kit + gear loss + travel + a driver shift; empirically ~1 h of bot-time |

`U = mean(utility)` is the **secondary** endpoint. `arrivalRate` stays primary because it is
the quantity the adoption criteria in `goto2-ab-plan.md §5` are written against and because a
utility scalar with argued-over weights is easy to dismiss. Report both; pre-commit the weights
in the course file so they cannot be tuned after seeing the data.

### 2.4 Task-level metrics (for skill v(N) vs v(N+1))

```
taskSuccess   := status.task.done === true  AND  the skill's own result assertion passed
                 (e.g. buildSchematic: verified === planned; mineLane: blocks >= 0.9*target)
taskDuration  := task.endedAt - task.startedAt          (already in skills.js)
stallEvents   := count of pushLog lines matching /stuck|stall|GoalChanged/ during the task
recoveries    := count of successful stall recoveries (dig-nuisance + hop) during the task
yieldPerMin   := sum(task.collected) / (taskDuration/60000)
durabilityPer100 := (dur% at start - dur% at end) / (blocksMined/100)
```

### 2.5 Token-cost metrics — first-class, per `GOAL.md`

"The LLM thinks once; code runs forever" is only checkable if you *measure the thinking*. An
engine version that raises success rate while tripling driver attention is a regression.

```
pollsPerTask       := count of HTTP requests to this bot's port with t in [task.startedAt, endedAt]
evalsPerTask       := count of POST /eval in the same window          <-- the expensive one:
                                                                          an /eval is an LLM
                                                                          writing code
escalationsPerTask := count of driver messages/decisions in the window (driver-side accounting)
attendedRatio      := attendedSeconds / (attendedSeconds + unattendedSeconds)
costPerOutcome     := tokens_spent / units_banked        (per shift, per driver)
```

`pollsPerTask` and `evalsPerTask` are trivially instrumentable in `runner.js` (a counter keyed
on `__skills.currentTask.id`, reset at task start) and should be **co-primary in every gate**:

> **Gate rule:** a version whose median `evalsPerTask` rises by > 25 % does not ship on a flat
> success rate. Autonomy is the product; success rate bought with driver attention is not a win.

### 2.6 Counter-metrics (anti-gaming pairing)

Every rate metric ships with the denominator it could be gamed through:

| Metric | Gameable by | Mandatory counter-metric |
|---|---|---|
| `arrivalRate` | shrinking effective goal range; failing fast on hard routes | `medianTargetDistance`, `attemptRate` (trips issued / trips in plan) |
| `taskSuccess` | narrowing the skill's own success assertion | `assertionHash` recorded per version; a changed assertion invalidates cross-version comparison |
| `blocksMinedPerMin` | mining the softest block available | `oreFraction`, `blocksBroken` in protected regions |
| `deaths` (as a driver score) | avoiding all risky work | `deepWorkHours` (bot-hours at skyLight 0), `distanceFromBase` p90 |
| `shipped_findings` | splitting one issue into three entries | `distinctRootCauses` (§10.2) |

---

## 3. Design: how to run a fair comparison here

### 3.1 Pairing is mandatory, and pairing means *same route, adjacent in time*

The estimand is the within-route difference:

```
d_r = Y_r(B) - Y_r(A)          for route r
```

Route difficulty cancels exactly. This is worth more than every other control combined, and it
is the reason a 60-trip experiment can say anything at all.

Two pairing failure modes to avoid:

- **Batching.** All A runs, then all B runs, confounds arm with world state. `goto2-ab-plan.md`
  already forbids this — good.
- **Pairing across a terrain change.** If arm A digs through the course, arm B walks a
  different world. Enforce `dig:false` on travel benchmarks and verify with `blocksBroken == 0`;
  a pair with `blocksBroken > 0` on either side is **void** (§10.5).

### 3.2 Order: use ABBA blocks, not ABAB

`goto2-ab-plan.md §4.2` specifies `A B A B A B A B A B`. Under any linear time trend — chunk
warm-up, tool durability decay, fleet activity ramping, TPS drift — ABAB assigns A mean position
2.0 and B mean position 3.0, so the trend loads entirely onto the arm difference.

**ABBA cancels a linear trend exactly**: within each block of four, A occupies positions 1 and 4
(mean 2.5) and B occupies 2 and 3 (mean 2.5).

```
route r, 8 trips:  A B B A  B A A B      <- ABBA then its mirror; cancels linear + reduces quadratic
```

Cost: zero. Benefit: removes a real, unmodelled confounder. Change this line in the plan.

### 3.3 Block on time, not just on route

Run the two arms of a pair **back to back**, never minutes apart with other work interleaved.
The tighter the temporal block, the more of the TPS/mob/fleet variance is shared and cancels.
Practical rule: **≤ 90 s between the end of arm A's trip and the start of arm B's**, and abort
the pair (void, §10.5) if a fleet event intervenes (a bot death anywhere, a server restart, a
CAVECREW build in the corridor).

Verify the daylight assumption once rather than assuming it: `bot.time.timeOfDay` sampled an
hour apart. The field notes say "frozen daylight"; if that is true, drop time-of-day from the
covariate set. If not, it is a blocking factor.

### 3.4 Warm-up laps and the `firstVisit` flag

Cold chunk loading dominates a first traversal. Two laps of every route, either arm,
unmeasured, before measurement begins — and record that they happened. Every measured trip
still carries `firstVisit: bool` so a post-hoc check can confirm warm-up worked (if measured
trips with `firstVisit:true` are systematically slower, the warm-up was insufficient).

### 3.5 Pre-state assertions — the harness must refuse to run a dirty trip

Every documented interference source in `LEARNING_HANDOFF.md` is a silent invalidator. Assert
before every trip and record the assertion vector in the row:

```
GET /state must show:
  connected: true
  task: null
  stalePayloads: []                       # a payload bound to a discarded bot object
  orphanedGoto: false                     # listenerCount('path_update') > 1 = leaked promise
  pathStuckRecent: 0
  payloads.skills == expected version     # baseline drift guard, §10.6
  movements == the pinned profile         # {parkour:false, maxDropDown:3, sprint:?, towers:false}
  health == 20, food > 14
__skills.status().bot.held.dur > 40       # a dying tool changes dig timing
__idleguard is STOPPED (not paused)       # pause() does NOT cover the stall-buster (FEEDBACK)
inventory slots used <= 8                 # a full inventory changes dig/pickup behaviour
tps >= 18
```

A failed assertion → **void the trip, record it, fix, re-run**. Voids are pre-treatment and
therefore a legitimate exclusion (§10.5). Log the void reason; a rising void rate is itself a
finding.

Note specifically: `__idleguard.pause(ms)` is **not sufficient** — the stall-buster block runs
before the `externalActive()`/pause check in the same tick and will yank the goal out from
under a slow legitimate trip. Use `__idleguard.stop()` for the whole benchmark session and
re-inject afterwards. A benchmark run with idle-guard merely paused is measuring idle-guard.

### 3.6 Validate the instrument first: run an A/A test

**Before any A/B, run the identical engine against itself, labelled as two arms.** Budget: 20
trips (one route class, ~30 min).

- If the A/A shows a "significant" difference, the harness is broken — ordering effects,
  contamination, drift, or an asymmetric measurement path.
- The A/A also *directly estimates the noise floor*: the SD of the paired differences under a
  true null is exactly the σ you need for every power calculation in §4. Nothing else gives
  you that number honestly.

This is the single cheapest, highest-value addition to `goto2-ab-plan.md`. It is not optional
overhead; it is where the σ in the sample-size formula comes from.

### 3.7 Blinding, and what is achievable instead

True blinding is impossible: `GET /state` reports `payloads.skills` version, and drivers read
the docs. The implementable substitutes:

1. **Pre-register the task list** for a canary window so task selection cannot adapt to the
   version the driver knows it is running.
2. **Arm-label the harness output** (`arm: "A"/"B"`) and keep the key in a separate file;
   whoever writes the analysis script writes it before opening the key.
3. **Pre-commit the analysis** (primary endpoint, decision rule, exclusion criteria, N) into
   the course file before the first trip. This is the actual protection against post-hoc
   rationalisation, and it costs one paragraph.

---

## 4. Power: how many trials, honestly

### 4.1 Formulas

Unpaired two-proportion, per arm:

```
n = (z_{1-α/2} + z_{1-β})^2 · [p1(1-p1) + p2(1-p2)] / (p1 - p2)^2
```

Minimum detectable effect at given n (α = 0.05 two-sided, power 80 %, so z-sum = 2.80):

```
MDE = (z_{1-α/2} + z_{1-β}) · sqrt( 2·p̄(1-p̄) / n )
```

Paired binary (McNemar), with ψ = p01 + p10 (discordance rate) and δ = p01 − p10:

```
n_pairs = ( z_{1-α/2}·sqrt(ψ) + z_{1-β}·sqrt(ψ - δ^2) )^2 / δ^2
```

or, in the cleaner discordant-pairs form with π = p01 / ψ (the fraction of discordant pairs
favouring B):

```
n_discordant = (z_{1-α/2} + z_{1-β})^2 / (2π - 1)^2
```

Paired continuous, on the log ratio (durations — always log; see §6.3):

```
n_pairs = (z_{1-α/2} + z_{1-β})^2 · σ_d^2 / (ln R)^2       σ_d = SD of ln(t_B / t_A) within pair
```

Poisson rate ratio, total events across both arms at equal exposure:

```
D_total ≈ 4·(z_{1-α/2} + z_{1-β})^2 / (ln RR)^2
```

Clustering (repeats within a route):

```
DEFF = 1 + (m - 1)·ρ            m = trials per route, ρ = intra-route correlation
n_eff = n / DEFF
```

Non-inferiority (the right frame for a rollout gate), margin Δ, per arm:

```
n = (z_{1-α} + z_{1-β})^2 · [p1(1-p1) + p2(1-p2)] / (Δ - |p1 - p2|)^2
```

### 4.2 What those numbers actually are here

**MDE table** (α = 0.05 two-sided, 80 % power, per arm, *no clustering*):

| n per arm | MDE at p̄ = 0.5 | MDE at p̄ = 0.8 |
|---|---|---|
| 10 | 63 pp | 50 pp |
| 20 | 44 pp | 35 pp |
| 30 | 36 pp | 29 pp |
| 50 | 28 pp | 22 pp |
| 100 | 20 pp | 16 pp |
| 200 | 14 pp | 11 pp |
| 400 | 10 pp | 8 pp |

**Sample sizes for the effects people actually claim:**

| Question | Effect | N required |
|---|---|---|
| ashfinder ≥ pathfinder + 30 pp (0.5 → 0.8) | 30 pp | **36 per arm** unpaired |
| ashfinder ≥ pathfinder + 20 pp (0.5 → 0.7) — the plan's stated bar | 20 pp | **91 per arm** unpaired |
| Paired, π = 0.8 (4 of 5 discordant pairs favour B) | — | **22 discordant pairs** |
| Rollout gate: "no worse than 5 pp" at 90 % baseline | Δ = 0.05 | **444 per arm** |
| Duration: 20 % faster, σ_d = 0.35 | ln 1.2 = 0.182 | **29 pairs** |
| Duration: 20 % faster, σ_d = 0.50 | ln 1.2 = 0.182 | **59 pairs** |
| Deaths halved, at 0.07 deaths/bot-hour | RR = 0.5 | **65 total deaths ≈ 900 bot-hours** |

Read the last row again. Roughly 130 nights of the current fleet, to halve the death rate with
statistical confidence. This is not a resourcing problem you can fix; it is a reason to use
surrogates (§5.4).

### 4.3 The clustering correction that inverts the current plan

`goto2-ab-plan.md` allocates 6 routes × 5 runs × 2 directions × 2 engines. Pooled naively that
is ~60 trips per engine, which the table above says detects ~26 pp — close to the plan's 20 pp
bar, so the plan looks defensible.

It is not, for two independent reasons.

**(a) Design effect.** Ten trips on one route are not ten observations. If route identity
substantially determines the outcome — which is the whole premise of route-class stratification —
then ρ is high. At ρ = 0.5 and m = 10, `DEFF = 1 + 9(0.5) = 5.5`, so `n_eff ≈ 11 per arm`, and
the MDE balloons to ~60 pp. At ρ = 0.8, `DEFF = 8.2`, `n_eff ≈ 7`.

**(b) The cluster-level p-value floor.** In a paired design the route-level differences are the
independent units. A sign test over R routes has a minimum achievable two-sided p-value of
**2^(1−R)**, attained only when every route points the same way:

| R (routes) | best achievable two-sided p |
|---|---|
| 4 | 0.125 |
| 5 | 0.0625 — **cannot reach 0.05** |
| 6 | 0.031 |
| 8 | 0.0078 |
| 10 | 0.002 |

So **6 routes is the bare minimum to reach p < 0.05 at all, and only on a unanimous result.**
Per-route-class decisions with *one route per class* — which is what the plan does — are
anecdotes, not measurements. That may still be an acceptable basis for a cheap, reversible,
opt-in decision (§4.5), but it must be labelled as such and never written up as "significant".

**The fix — reallocate the same budget:**

| | current plan | recommended |
|---|---|---|
| Routes | 6 (1 per class) | **8–12 per class of interest** |
| Trips per route per arm | 10 (5 out + 5 back) | **2 (1 out + 1 back)** |
| Classes covered per campaign | 6, shallowly | **1–2, properly** |
| Trips | ~120 | ~64 for 8 routes × 2 dir × 2 arms |
| Independent units | 6 | **8–12** |
| Can reach p < 0.05 | only if unanimous across all 6 | yes, with slack |

The general result: for a fixed trip budget T with m trips per route, `n_eff ≈ T/(1+(m−1)ρ)`,
which is maximised at **m = 1**. Keep m = 2 only because the out-and-back legs are genuinely
different routes on sloped terrain and because m = 1 gives no within-route flakiness estimate.

Phase the campaigns rather than trying to cover all six classes at once. Phase A: the class
that actually motivated the exercise (long detour-heavy haul — R2/R3 in the current plan),
8 routes. Phase B: only if Phase A gives ashfinder a reason to exist.

### 4.4 Variance reduction: CUPED buys back a factor of 3

The historical median duration for a route is a strong pre-treatment predictor of a trip's
duration. Adjust:

```
Y_adj = Y - θ·(X - E[X])          θ = Cov(Y, X) / Var(X)
Var(Y_adj) = Var(Y)·(1 - ρ_XY^2)
```

At ρ = 0.8 the variance drops 64 %, so required N drops ~2.8×. Candidate covariates, all
available pre-treatment and none post-treatment:

- historical median ms for this route (from the warm-up laps and prior campaigns)
- straight-line distance and Δy of the route
- `tpsBefore`
- `nearbyBots` at trip start

Use CUPED for **duration only**. For binary arrival, the paired design already captures nearly
all of the same signal; regression adjustment on a binary outcome with n ≈ 20 is more likely to
mislead than to help.

### 4.5 Set α and β from the cost of being wrong, not from convention

α = 0.05 is a convention imported from settings where a false positive is expensive. Here the
cost varies enormously by decision, and matching the error budget to the decision is not
sloppiness — it is the correct analysis:

| Decision | Cost of a wrong "adopt" | Recommended α, power | N implication |
|---|---|---|---|
| Enable `/goto2` as an **opt-in manual** escape hatch | ~nil (rollback = don't call it) | **decision rule only, no test** — adopt on a descriptive majority | 8–16 trips |
| Make `/goto2` an **automatic fallback for one route class** | moderate (silent behaviour change; rollback is one config line) | α = 0.10 one-sided, power 70 % | ~½ of the §4.2 numbers |
| Make ashfinder the **default engine** | high (fleet-wide, safety-relevant, documented false-success bug) | α = 0.05, power 80 %, **plus** zero deaths and zero `digsRefused` as absolute bars | full §4.2 numbers |
| Ship a skills.js version fleet-wide | high | non-inferiority gate ladder, §9 | staged |

Relaxing to α = 0.10 / power 70 % (z-sum = 1.28 + 0.52 = 1.81) at n = 20, p̄ = 0.5 gives an MDE
of 29 pp instead of 44 pp. Meaningful, and honest, as long as it is pre-registered.

---

## 5. Sequential stopping: the budget-fit decision procedure

Trips are the scarce resource. A fixed-N design spends the whole budget even when the answer
arrives after six trips. Sequential designs are strictly better here.

### 5.1 Sign test on discordant pairs — the floor

Concordant pairs carry **zero** information for a sign test. Reframe the stopping rule from
"60 trips" to "**keep going until you have accumulated k discordant pairs, or the budget ends**":

| discordant pairs, all one direction | one-sided p | two-sided p |
|---|---|---|
| 4/4 | 0.0625 | 0.125 |
| 5/5 | 0.031 | 0.0625 |
| 6/6 | 0.016 | 0.031 |
| 7/7 | 0.0078 | 0.016 |
| 8/9 | 0.0195 | 0.039 |
| 9/11 | 0.033 | 0.065 |

**Five unanimous discordant pairs is the minimum that can produce p < 0.05 one-sided.** Note the
tension with §4.3: those pairs must come from *five different routes*, or the cluster-level
floor applies instead.

### 5.2 SPRT (Wald) — stop as early as the evidence allows

Test H0: π = 0.5 vs H1: π = π₁ on discordant pairs. With α = β = 0.05 the boundaries are
`±ln(19) = ±2.944`. Each discordant pair updates the log-likelihood ratio:

```
favours B:  Λ += ln(π₁ / 0.5)
favours A:  Λ += ln((1-π₁) / 0.5)
stop, adopt B   when Λ >= +2.944
stop, reject B  when Λ <= -2.944
continue        otherwise (up to the budget cap, then report inconclusive)
```

At π₁ = 0.8: a B-pair adds +0.470, an A-pair adds −0.916. **Seven consecutive B-favouring
discordant pairs cross the boundary.** Expected sample size under H1 is roughly half a
fixed-N design's.

Hard cap the SPRT at the trip budget and report "inconclusive" on exhaustion — an
uncapped SPRT can run forever, and "inconclusive" is a perfectly good, honest result that
correctly maps to "keep it as a manual escape hatch".

### 5.3 Safety stopping rules — non-negotiable, checked after every trip

These are not statistical; they are circuit breakers. `goto2-ab-plan.md §5` already has most of
them; formalise as harness-enforced aborts:

```
ABORT WHOLE CAMPAIGN on:
  any death attributable to the engine under test
  digsRefused > 0, or any block broken inside protected.json / BASE.md footprints
  a hang surviving POST /stop
  a protected structure damaged by any means during the window
ABORT THIS ROUTE, restart the route's sequence from trip 1, on:
  a death from any cause (respawn changes gear + position + chunk state)
```

### 5.4 Safety cannot be tested directly — use validated surrogates

§4.2 showed the death-rate A/B needs ~900 bot-hours. The alternative is a surrogate battery of
high-frequency near-miss events, all already computable from `dangerscan.js` + `survival.js`
fields:

| Surrogate | Definition | Expected rate |
|---|---|---|
| `hpDropEvents` | count of health decreases ≥ 2 HP | tens/hour |
| `hostileExposureS` | seconds with `danger.score` above the flee threshold | tens/hour |
| `darkExposureS` | seconds at `skyLight == 0 && light < 8` outside a lit workspace | hundreds/hour |
| `fallEvents` | count of Δy ≤ −3 in one tick without a ladder/water below | few/hour |
| `panicEntries` | `survival.js` panic-branch entries | few/hour |
| `lowHpMinutes` | minutes at health < 8 | few/hour |

At tens-to-hundreds of events per hour, a 30 % change is detectable in a few bot-hours instead
of a few hundred — a 100× improvement in statistical throughput.

**Validate the surrogate once, then trust it conditionally.** Take the historical logs (76 k
lines across 10 bots, 4 `<death>` lines) and check whether the surrogate values in the 5 minutes
preceding each death were elevated versus matched control windows. With 4 deaths this is a
sanity check, not a validation — so the honest protocol is:

> Use surrogates as the *primary* safety signal for gating. Continue to track the raw death
> rate as an unpowered monitoring channel. Re-validate the surrogate–death link every time the
> death count doubles. Never claim a version "reduced deaths" from surrogate data alone —
> claim it "reduced near-miss exposure", which is what was measured.

---

## 6. Analysis recipes

### 6.1 One tool for everything: the cluster bootstrap over routes

Rather than a zoo of tests (McNemar here, Wilcoxon there, Newcombe intervals for paired
proportions), use one procedure that handles every metric identically and respects the
clustering that §4.3 showed is the binding constraint:

```
1. Compute the per-route paired statistic  d_r  (difference in arrival rate, difference in
   RMTT, difference in mean utility — whatever the metric is).
2. Resample ROUTES with replacement, R of them, 10 000 times.       <-- routes, not trips
3. For each resample compute the mean of d_r.
4. Report the 2.5th and 97.5th percentiles as the 95 % CI.
5. Two-sided p ≈ 2 · min( frac(boot <= 0), frac(boot >= 0) ).
```

Resampling **routes** (not trips) is what makes the interval honest. Resampling trips would
report the 6-route campaign as if it had 60 independent observations and produce intervals 2–3×
too narrow. Report R alongside every interval so the reader can apply the §4.3 floor mentally.

Sanity check the bootstrap against the closed forms once (McNemar on the pooled discordant
pairs, Wilson intervals on per-arm rates) so a coding error is visible; then use the bootstrap
for everything.

### 6.2 Per-arm rates: Wilson, never Wald

```
p̃      = (x + z²/2) / (n + z²)
half   = z/(n + z²) · sqrt( x(n-x)/n + z²/4 )
```

Wald (`p ± z√(p(1-p)/n)`) is badly wrong at the small n and extreme p this work lives at — it
produces intervals containing values above 1 and gives zero width at p = 1.0, which is exactly
the case you most need an interval for ("8/8 arrived" is *not* "100 % ± 0"; Wilson gives
[0.68, 1.00]).

### 6.3 Durations: log scale, and never impute the timeout

Trip durations are right-skewed and **right-censored at the timeout ceiling**. Two rules:

1. **Analyse `ln(ms)`**, and analyse the within-pair `ln(t_B/t_A)`. A 20 % speed difference is
   the same effect at 30 s and at 300 s on the log scale, and additive-scale statistics are
   dominated by the long routes.
2. **Never substitute the ceiling for a timed-out trip's duration.** That biases every summary
   toward the ceiling and, worse, biases it *more* for the arm that times out more — exactly
   backwards. Two valid options:
   - Report the **Kaplan–Meier median** with censoring, or
   - Report **RMTT** (restricted mean travel time): the area under the survival curve up to a
     common horizon τ, where τ = the *shortest* ceiling used by either arm. RMTT is the better
     default here because it is defined even when > 50 % of one arm censors (a KM median is
     not), and it handles the plan's current asymmetry (pathfinder hardcoded at 60 s,
     `/goto2` configurable) by construction.

The current plan's note that R3/R6 pathfinder trips are "capped at 60 s" and the comparison is
"arrival-only, not timing" is the right instinct; RMTT at τ = 60 s makes it a quantitative
comparison instead of an abandoned one.

### 6.4 Adjust for what you measured, but only pre-treatment covariates

Include `tpsBefore`, route distance, `firstVisit`, `nearbyBots` as CUPED covariates on duration
(§4.4). **Never adjust for or condition on anything measured after the arm was assigned** —
`hpDelta`, `blocksBroken`, `stallResets`, mob encounters are all *outcomes*, and conditioning on
them opens a collider path (§10.5).

### 6.5 Multiplicity: pre-register one primary endpoint

Six route classes × four primary metrics = 24 tests. At α = 0.05 each, the probability of at
least one false positive is `1 − 0.95^24 = 71 %`. With subgroup analyses on top, near-certainty.

Discipline:

- **One primary endpoint**, pre-registered: pooled arrival rate, route-stratified,
  cluster-bootstrapped. One test, α = 0.05.
- **Everything else is descriptive.** Report per-route tables with CIs and no p-values.
- If per-class *decisions* are required (they are — that is the whole design of the ashfinder
  question), apply **Holm–Bonferroni** across the class family and state clearly that a class
  with fewer than 6 routes cannot produce a class-level significance claim at all.
- Absolute bars (`deaths == 0`, `digsRefused == 0`, `falseSuccess == 0`) are **not** hypothesis
  tests and are exempt from multiplicity. They are specification compliance.

### 6.6 The report template

Every campaign produces exactly this, appended to the course's own file:

```
Campaign:  <courseId>@<version>   Arms: A=<engine/version>  B=<engine/version>
Dates:     <start> .. <end>       Bot: <name>:<port>        Harness: bench/run.js@<git-sha>
Routes:    R = <n>   Trips: <n>   Void: <n> (<reasons>)     Pre-registered: <path to plan>

Primary   arrivalRate   A: x/n (Wilson 95% CI)   B: x/n (CI)
          paired diff (cluster bootstrap over routes): +X.X pp [lo, hi]   p = 0.0XX
Absolute  deaths A/B: 0/0    digsRefused: 0    falseSuccess A/B: 0/0    protectedBreaks: 0
Secondary RMTT@60s  A: XXs [CI]  B: XXs [CI]    utility U  A: X.XX  B: X.XX
Cost      evalsPerTask median A/B: X / X        pollsPerTask median A/B: X / X
Per-route table: route | class | A arr | B arr | A ms | B ms | discordant? | notes
Decision: ADOPT(class) | MANUAL-ONLY | REJECT | INCONCLUSIVE   -- against the pre-registered rule
Deviations from the pre-registered plan: <list, or "none">
```

That last line is not ceremony. It is the difference between a result and a story.

---

## 7. Benchmark course design

### 7.1 A course is a versioned data structure, not a paragraph in a doc

```jsonc
// bench/courses/goto-haul.v1.json
{
  "courseId": "goto-haul",
  "version": 1,
  "created": "2026-09-01",
  "world": "live",                       // "live" | "bench-server"
  "class": "long-open-haul",
  "anchor":   { "x": 2,  "y": 110, "z": 5,  "label": "plaza_edge" },
  "generator": {                          // §7.2 — routes are SAMPLED, not curated
    "kind": "seeded-radial",
    "seed": 20260901,
    "n": 8,
    "distance": { "min": 250, "max": 400 },
    "reject": ["protected.json", "BASE.md:built", "cavecrew_camp_r40", "hazard_zones"],
    "requireGroundSnap": true
  },
  "routes": [                             // materialised from the generator, then FROZEN
    { "id": "H1", "target": {"x":326,"y":100,"z":38}, "goalRange": 1,
      "fingerprint": "sha256:ab12…", "fingerprintAt": "2026-09-01T02:10Z" }
  ],
  "trial": {
    "ceilingMs": 180000, "settleMs": 800, "dig": false,
    "movementsProfile": "HAUL", "directions": ["out","back"],
    "order": "ABBA", "tripsPerRoutePerArm": 2
  },
  "preconditions": [ "task:null", "stalePayloads:[]", "orphanedGoto:false",
                     "health:20", "food>14", "heldDur>40", "idleguard:stopped",
                     "invSlots<=8", "tps>=18" ],
  "analysis": {                           // PRE-REGISTERED, written before trip 1
    "primary": "arrivalRate",
    "test": "cluster-bootstrap-over-routes",
    "alpha": 0.05, "power": 0.80, "sided": 2,
    "absoluteBars": { "deaths": 0, "digsRefused": 0, "falseSuccess": 0 },
    "utilityWeights": { "arrived": 1, "honest_fail": 0, "timeout": -0.2,
                        "false_success": -3, "death": -50 },
    "stopping": { "kind": "sprt", "pi1": 0.8, "alpha": 0.05, "beta": 0.05, "capTrips": 64 },
    "decisionRule": "ADOPT if arrivalRate diff CI lower bound > +0.10 AND all absoluteBars met"
  }
}
```

Rules that make this work:

- **Never edit a course in place.** Bump `version`. A v1 result and a v2 result are not
  comparable and the file name says so.
- **Every result row carries `courseId@version` and the route's `fingerprint`.** Post-hoc, you
  can always tell whether two numbers describe the same world.
- **`analysis` is written before trip 1.** If it is written after, the campaign is exploratory
  and must be labelled exploratory in the report.

### 7.2 Generate routes from a seed; curate only for the smoke tier

Hand-curated route lists have three defects: they cannot be enlarged cheaply, they encode the
author's beliefs about what is hard (cherry-picking), and they make the "8 routes minimum"
requirement of §4.3 feel like busywork.

A seeded sampler fixes all three:

```js
// deterministic given seed; re-runnable for any future engine version
function sampleRoutes(anchor, seed, n, dMin, dMax, reject) {
  const rng = mulberry32(seed);
  const out = [];
  while (out.length < n) {
    const theta = rng() * 2 * Math.PI;
    const d = dMin + rng() * (dMax - dMin);
    const p = { x: Math.round(anchor.x + d*Math.cos(theta)), z: Math.round(anchor.z + d*Math.sin(theta)) };
    p.y = groundSnap(p);                    // <-- see the caveat below
    if (reject.some(r => r.contains(p))) continue;
    out.push(p);
  }
  return out;
}
```

**Ground-snap caveat, straight from field experience:** `bot.blockAt()` on chunks the bot is not
physically near returns stale or fabricated data — the documented incident produced 30+ phantom
"floating dirt" blocks whose count and coordinates *changed between identical scans*, and a
build attempt that walked into solid stone because a fixed-ceiling downward search reported the
ceiling as the surface. So:

- Ground-snap must be done **by a surveyor bot that walks to each candidate**, or
- Use `GoalNearXZ` and record the achieved y rather than pre-committing to one, or
- Snap remotely but **re-verify on the day** with a physical visit before freezing the route —
  this is exactly the `(verify y)` discipline `goto2-ab-plan.md` already applies by hand.

Two different courses for two different questions:

| | **Sampled course** | **Curated fixture course** |
|---|---|---|
| Purpose | average-case capability; adoption decisions | worst-case; regression detection |
| Routes | 8–12 from a seed | 3–10 hand-built known-hard cases |
| Tier | statistical (Tier 1) | deterministic assertions (Tier 0) |
| N per route | 2 | 1 |
| Contains | whatever the world gives | leaf_litter patch, torch-in-corridor, the two-chest gap, a ladder shaft, a 1-wide staircase |
| Retired when | never (re-sample with a new seed) | never — it *is* the regression suite |

### 7.3 Difficulty calibration: routes at p ≈ 0.5 carry the information

Fisher information for a Bernoulli observation is `p(1−p)`, maximised at p = 0.5 and → 0 at
p ∈ {0, 1}. A route the fleet passes 100 % of the time and a route it fails 100 % of the time
each contribute **nothing** to a discrimination comparison. Concretely, a route at p = 0.95
carries `0.0475` versus `0.25` at p = 0.5 — one-fifth of one useful observation.

Course lifecycle policy:

```
A route in the sampled course that passes 100% for 3 consecutive engine versions
    -> PROMOTE to the smoke tier (it is now a regression fixture, N=1, assertion)
    -> and re-sample a replacement from the generator with a longer distance band
A route that fails 100% for 3 consecutive versions
    -> DEMOTE to a "known-unsolved" watchlist (still run once per campaign, N=1,
       as a capability tripwire — the day it passes is a real finding)
    -> replace it in the statistical pool
```

This keeps the statistical course's mean difficulty near the fleet's ability, which is the same
principle item-response theory applies to test items, and it is why the course must be
regenerable rather than fixed forever.

### 7.4 Contamination: bots modify the course

Threats, in order of severity:

| Threat | Mechanism | Mitigation |
|---|---|---|
| **Path carving** | arm A digs a shortcut; arm B walks an easier world | `dig:false` on all travel benchmarks; `blocksBroken > 0` on either side → **void the pair**; ABBA ordering makes any residual carryover symmetric |
| **Fleet terraforming** | another bot's chopTrees/mineLane rewrites the corridor mid-campaign | fingerprint check (below); register the course region in `protected.json` and `BASE.md` so digguard defends it from *other* bots; announce the campaign window in chat |
| **Scaffolding scars** | pathfinder places dirt/cobble as scaffolding by default | `scafoldingBlocks = []` (note pathfinder's misspelling) in the benchmark movement profile; the build-guard `exclusionAreasBreak` pattern already proven in v7 |
| **Self-improvement across runs** | trampled grass, broken leaf_litter, torch placement accumulating light | fingerprint versioning; re-sample the course each campaign; on the staging world, snapshot-restore |
| **Learning contamination** | drivers memorise the course and pre-position bots | course routes generated fresh per campaign from a new seed; drivers not told the seed |

**Course fingerprinting** — detect drift rather than assume it away:

```js
// walked by a surveyor bot; NEVER a remote blockAt sweep (stale-chunk quirk)
// sample every 8th block along the straight line, plus the 3-block column at each sample
function fingerprint(route) {
  const cells = sampleCorridor(route, { stride: 8, columnHeight: 3 });
  const names = cells.map(c => `${c.x},${c.y},${c.z}:${bot.blockAt(c)?.name ?? 'null'}`);
  return sha256(names.join('|'));
}
```

Cost: one extra traversal per campaign (the surveyor lap doubles as a warm-up lap, so it is
nearly free). If the fingerprint changed since the last campaign, **bump the course version and
re-baseline** — do not compare across it.

### 7.5 The three courses

**(a) `goto-gauntlet` — movement.** As specified above. This is the one that genuinely needs
statistics, because the outcome is binary, noisy, and terrain-dominated.

**(b) `mining-plot` — resource extraction.** The hard truth: **a mining plot cannot be reused.**
You mine it once and it is gone. Two consequences:

- Plots are **random draws from a distribution**, not a fixture. Select them by a *seeded rule*
  from an unmined region (e.g. "the k-th 16×16×16 volume at y = −40 in a spiral from
  (−400, −40, −400), skipping any with a registered claim") so plots are exchangeable and
  reproducible-in-procedure even though not reproducible-in-terrain. That justifies pairing at
  the *plot-pair* level: assign adjacent plots to the two arms.
- **Choose metrics whose variance is engine-dominated, not world-dominated.** This is the
  decisive design choice:

| Metric | Variance source | Verdict |
|---|---|---|
| diamonds found per lane | almost pure terrain luck, λ ≈ 0–3 | **useless** — a 20 % rate-ratio needs ~475 events per arm ≈ 240 lanes |
| ore blocks per lane | terrain-dominated | weak |
| **blocks mined per minute** | engine-dominated, hundreds of blocks per trial, CV ≈ 0.2 | **primary** — 10 % detectable in ~35 lanes per arm |
| **stall events per 100 blocks** | engine | primary |
| **durability consumed per 100 blocks** | engine (tool selection logic) | primary |
| **torch-spacing compliance** (fraction of lane cells with light ≥ 8) | engine | primary |
| drops left behind per lane | engine (collectDrops) | primary |
| deaths / cavity breaches | rare | surrogate only (§5.4) |

The general rule, worth stating once loudly: **measure the thing the engine controls.**
`blocksMinedPerMinute` is a statement about the engine. `diamondsPerLane` is a statement about
the world.

**(c) `build-pad` — construction.** The most controllable benchmark in the whole system, because
the target is fully specified by a blueprint and the engine already runs a block-by-block verify
pass (the v7 results — 46/46 and 62/62 — are exactly this metric).

```
site:      a levelled, BASE.md-registered pad in the designated test zone
procedure: clear pad -> POST /blueprint/load -> buildSchematic -> verify -> clear pad
metrics:   placementAccuracy = verified / planned          (near-deterministic)
           retriesPerPlacement                              (the blockUpdate-timeout quirk)
           msPerBlock
           materialOverrun = consumed / bill
           scaffoldPlacements                               (should be 0)
           protectedRefusals                                (should be 0; a positive is a WIN
                                                             if the pad deliberately overlaps a
                                                             protected block — build that case in)
N:         3 runs per arm — variance is low enough that 3 suffices
tier:      mostly Tier 0 (assertions: accuracy == 1.0, scaffoldPlacements == 0)
```

Because the pad is restored to a known state between runs, this is the one benchmark that is
genuinely repeatable on the live world today.

---

## 8. Passive telemetry vs active benchmarks

### 8.1 The decision rule

| Use **field telemetry** when | Use a **controlled run** when |
|---|---|
| Monitoring a *level* over time (is goto success drifting?) | Comparing *versions* — assignment is confounded with time, bot, task, and driver |
| The change is fleet-wide and instantaneous, with ≥ 20 pre-period epochs (→ interrupted time series) | The rollout is gradual, so early adopters differ systematically from late ones |
| The effect is large (≥ 25 pp) and the outcome is frequent | The effect is small, or the outcome is rare and safety-critical |
| The field distribution of inputs *covers* the change | The change targets inputs the fleet rarely produces (you fixed water pathing; the fleet never swims) |
| You need external validity | You need internal validity |
| Cost must be zero | You can afford a spare client and an hour |

Two designs sit usefully in the middle:

**Interrupted time series (ITS).** Roll a version fleet-wide at a known instant; model level and
slope change in the outcome series. Needs ≥ 20 pre-period epochs. Its threat is *history* —
something else changed at the same moment (a server restart, a CAVECREW build, nightfall).

**Difference-in-differences via staggered rollout.** Roll to bots 1–3 at T0 and bots 4–7 at T1.
The T0 cohort's change over [T0, T1] minus the T1 cohort's change over the same window removes
any common shock. Since `runner.js` auto-injects the payload stack from files on every spawn,
staggering is *free* — it is a per-port file pointer plus a restart. This is the strongest field
design available and it costs nothing but sequencing discipline.

**Switchback**, for parameters that can be toggled per task rather than per process: randomise
the arm by 30-minute epoch across the whole fleet. The unit of analysis is the *(bot, epoch)*
cell, not the call, so N is the number of epochs — a 6-hour night at 30 min gives 12 epochs ×
7 bots = 84 cells. Analyse with epoch-clustered standard errors. This controls for time-of-day,
mob cycles, and server load by construction, at the price of carryover between adjacent epochs
(mitigate with a 5-minute washout at each boundary, discarded from analysis).

### 8.2 The telemetry sink you do not have yet

Field evaluation currently rests on three lossy channels:

1. **`S.log`** — a 100-entry in-memory ring (`LOG_MAX = 100`), returned 20 at a time
   (`LOG_SLICE = 20`) filtered by `seq > since`. A driver polling every ~50 s during a busy task
   silently loses lines, **and it loses more of them precisely when the bot is in trouble** —
   textbook informative missingness. A process restart destroys the whole ring.
2. **Chat / `logs/<bot>.log`** — rich (52 k `<chat>` lines) and durable, but `say()` **drops
   anything scheduled more than 12 s out** under backlog, and fallback/quiet tasks narrate
   nothing at all. Same bias, same direction: the busiest periods lose the most records.
3. **`logs/<bot>.log` `<api>` lines** — `runner.js` logs `<api> goto (x, y, z)` at request time
   and **logs nothing at all on the response**. So the field record contains every goto
   *attempt* and no goto *outcome*. The most-requested field metric in this document is not
   currently recoverable from the logs at any effort.

The fix is one small, well-bounded engine addition:

```jsonc
// logs/<bot>.events.jsonl — append-only, fsync-batched, one line per event, never truncated
{"t":"2026-09-01T02:14:07.412Z","bot":"BuddelBernd","ev":"task_start","id":"tlz9k2",
 "name":"mineLane","args":{"len":40},"engine":13,"payloads":{"skills":13,"dangerscan":1},
 "pos":[-4,-31,4],"hp":20,"food":18,"held":{"name":"iron_pickaxe","dur":62},
 "light":0,"skyLight":0,"tps":19.8,"nearbyBots":0,"arm":null}

{"t":"…","bot":"…","ev":"task_end","id":"tlz9k2","outcome":"error","code":"no_tool",
 "phase":"digging","ms":184203,"collected":{"cobblestone":112},"stalls":3,"recoveries":2,
 "hpDelta":-4,"polls":7,"evals":1,"deaths":0}

{"t":"…","ev":"goto","id":"g8x2","target":[326,100,38],"range":1,"engine":"pathfinder",
 "ms":60012,"engineSaidOk":false,"arrived":false,"distXZ":214.7,"timedOut":true,
 "stuckResets":4,"visitedNodes":18422,"blocksBroken":0}

{"t":"…","ev":"death","cause":"fell from a high place","pos":[-29,140,137],"engine":13}
{"t":"…","ev":"payload_stale","which":["idleguard","digguard"]}
{"t":"…","ev":"reconnect","reason":"kicked","downMs":4120}
```

Three properties are load-bearing:

- **Written at task START, not only at end.** Every start must have a matching end or an
  explicit `unresolved` (written by the next process launch when it finds a dangling start).
  Without this, wedges and crashes are simply absent from the data, and absence-of-failure is
  read as success — the core survivorship mechanism (§10.1).
- **Carries the engine/payload versions on every record.** Post-hoc version attribution is
  impossible otherwise, and versions ship several times a night here (v8 → v13 in hours).
- **Durable and append-only.** Restart-survivable, greppable, and it makes every analysis in
  this document a `jq` one-liner instead of a log-scraping project.

Estimated cost: ~60 lines in `runner.js` plus ~15 in `skills.js` (`pushLog` also emits to the
sink). This is, per unit of effort, the highest-value item in the whole report — every other
field-evaluation claim depends on it.

### 8.3 Statistical process control on the field stream

Once the sink exists, monitoring is cheap and continuous. Use **EWMA** on rates, **CUSUM** for
step-change detection:

```
EWMA:   z_t = λ·x_t + (1-λ)·z_{t-1}                        λ = 0.2
        control limits  μ0 ± L·σ·sqrt( λ/(2-λ) )           L = 3
CUSUM:  S+_t = max(0, S+_{t-1} + (x_t - μ0 - k))           k = δ/2 (δ = shift to detect, in σ)
        alarm when S+_t > h                                h = 4–5 σ  (ARL0 ≈ 350–500)
```

Channels worth charting, each with `μ0` re-baselined after every accepted version bump:

`gotoArrivalRate` · `taskSuccessRate` · `falseSuccessRate` (target 0 — any nonzero is an alarm) ·
`stallsPerTaskHour` · `deathsPerBotHour` · `evalsPerTask` · `pollsPerTask` ·
`payloadStaleEvents` · `reconnectsPerHour` · `tps` · the §5.4 safety surrogates.

CUSUM with h = 4σ and k = 0.5σ detects a 1σ shift in ~10 observations while giving an
ARL0 of several hundred — i.e. it catches a real 5–10 pp regression within an hour or two of
fleet activity, which is precisely the band Tier 1 gauntlets cannot reach (§9).

**Re-baseline `μ0` on every accepted version.** Otherwise the chart alarms on every improvement
and the fleet learns to ignore it — the same dynamic as flaky CI gates (§9.4).

---

## 9. Regression gates and the rollout process

### 9.1 The gate ladder, sized to what each tier can actually detect

| Tier | What | Cost | Detects | Blocking? | Owner |
|---|---|---|---|---|---|
| **0 — Smoke** | Deterministic assertions, N = 1 each. Payload injection, movement profile fields, curated wedge fixtures, build-pad accuracy, digguard refusal, one FEEDBACK reproduction per shipped entry | **3–5 min** | Breakage (the majority of real regressions) | **Yes, hard** | engineer, pre-bump |
| **1 — Gauntlet** | Sampled course, 8 routes × 2 dir × 2 arms ≈ 32 trips, old vs new **in the same session** | ~45 min | ≥ 25–35 pp | **Yes**, on the primary + absolute bars | engineer, pre-rollout |
| **2 — Canary** | One bot on the new version for ≥ 30 min of pre-registered normal work, SPC-monitored | ~30 min, no extra client | ~10–15 pp; crashes; interaction with real fleet | **Yes**, on any CUSUM alarm or absolute-bar breach | rollout manager |
| **3 — Fleet SPC** | Full rollout with EWMA/CUSUM on the event stream and an auto-rollback trigger | continuous, free | ~5 pp over hours–days | **Auto-rollback**, not block | rollout manager |

The gate expressions, written to be machine-checkable:

```
TIER 0  (all must pass; any failure blocks the version bump)
  payloads.skills == newVersion  AND  stalePayloads == []
  movements == {parkour:false, towers:false, maxDropDown:3, digCost:<profile>}
  every fixture in bench/courses/wedges.v*.json arrives within its per-fixture ceiling
  every FEEDBACK entry flipped to shipped(vN) this cycle has a passing reproduction test
  build-pad: placementAccuracy == 1.0  AND  scaffoldPlacements == 0
  digguard: a dig inside protected.json is refused
  no unhandled rejection in the process during the run

TIER 1  (blocks rollout)
  absolute:   deaths == 0  AND  falseSuccess == 0  AND  protectedBreaks == 0
  primary:    lower bound of the 90% cluster-bootstrap CI on (new - old) arrivalRate  >= -0.10
              i.e. NON-INFERIORITY at a 10 pp margin -- which is the ONLY margin a
              32-trip gauntlet can honestly assert (see the note below)
  cost:       median evalsPerTask(new) <= 1.25 * median evalsPerTask(old)
  If the primary CI is too wide to clear -0.10, the gate result is INCONCLUSIVE:
  it does not block, it ESCALATES to a longer Tier-2 canary. Never let an
  underpowered gate masquerade as a pass.

TIER 2  (blocks fleet rollout)
  no CUSUM alarm on any safety-surrogate channel during the canary window
  falseSuccessRate == 0
  zero deaths, zero protected damage, zero unhandled rejections
  reconnectsPerHour <= baseline
  the pre-registered task list completed (a canary that silently did less work is not a pass)

TIER 3  (auto-rollback, no human in the loop)
  CUSUM alarm on gotoArrivalRate or taskSuccessRate       -> rollback + page
  any falseSuccess event                                  -> rollback + page
  deathsPerBotHour CUSUM alarm                            -> rollback + page
  payloadStaleEvents > 0 across two consecutive spawns     -> rollback + page
```

**The honest note on Tier 1's margin.** §4.2 showed that a 5 pp non-inferiority margin at 90 %
baseline needs 444 trips per arm. A 32-trip gauntlet supports a ~10 pp margin at best, and only
with a relaxed α. That is *fine* — as long as it is stated. The design response is not to make
the gauntlet bigger; it is to accept that Tier 1 catches only large regressions and to route
small ones to Tiers 2–3, where continuous data makes them cheap to detect.

### 9.2 The FEEDBACK-indexed regression suite — the highest-ROI item

64 entries exist in `FEEDBACK.md`; many are already `status: shipped(vN)`. Nothing prevents any
of them from silently regressing. Every one of them is a *deterministic, reproducible test* — and
a deterministic test detects its own regression at N = 1 with zero false-alarm rate, which no
amount of statistics can match.

Proposed convention: each shipped entry gains a `test:` line naming a fixture.

```
### 2026-09-01 bernd-driver — torch-underfoot movement wedge
status: shipped(vN)
test: bench/fixtures/wedge-torch.json
```

```jsonc
// bench/fixtures/wedge-torch.json — Tier 0
{
  "id": "wedge-torch", "feedback": "2026-09-01 bernd-driver — torch-underfoot movement wedge",
  "zone": "DIGTEST_1",
  "setup":  ["buildCorridor(1x2x8)", "placeTorch(corridorCell(4))"],
  "action": "goto(corridorEnd)",
  "assert": { "arrived": true, "ms": "<15000", "stallResets": "<=1" },
  "teardown": ["restoreZoneSnapshot"]
}
```

Fixtures worth building first, ordered by how much pain the underlying bug caused:

| Fixture | Reproduces | Assertion |
|---|---|---|
| `wedge-torch` | torch-underfoot freeze | arrives < 15 s |
| `wedge-leaf-litter` | leaf_litter onGround=false freeze | arrives < 15 s |
| `wedge-chest-gap` | hard freeze in a 1-wide gap between two chests | arrives, or fails honestly (never hangs) |
| `false-success-emptypath` | pathfinder empty-path resolving as success | `engineSaidOk == arrived` |
| `stop-poison` | `stop()` poisoning the next goto | second goto arrives |
| `orphan-goto` | leaked promise → `path_GoalChanged` | `orphanedGoto == false` after a raced+cancelled goto |
| `staircase-1level` | safeDescend 96 steps / 1 level | Δy ≥ 0.6 × steps |
| `tool-break-silent` | tool exhaustion mid-task | `tool_low` warn fires before breakage |
| `craft-void` | batched `bot.craft` voiding materials | inventory delta == expected |
| `digguard-protected` | digging a registered structure | refused |
| `payload-persist` | payloads dying on reconnect | after forced `bot.quit()`, `stalePayloads == []` on respawn |
| `chop-canopy` | chopTrees felling placed logs | placed log 3 blocks away survives |

Each is minutes to write, seconds to run, and permanently retires a class of regression. **This
is where the evaluation budget should go first** — before the goto2 A/B, before the staging
world, before the telemetry sink.

### 9.3 Hooking into the two-engineer + rollout-manager process

`DRIVER_GUIDE.md` already has the shape: engineer live-verifies → bump version → notify drivers →
rollout manager audits. Three additions make it an evidence-gated pipeline rather than a
notification pipeline:

1. **The version bump carries a gate report.** `bench/gates/skills-v14.json` with Tier 0 and
   Tier 1 results, the harness git sha, and the pre-registered plan path. **The rollout manager
   refuses to roll a version that has no gate report** — this is the enforcement point, and it
   is one file check.
2. **Canary before fleet.** New version → the test bot (3106/3107) → ≥ 30 min of pre-registered
   work → Tier 2 gates → then fleet. Not "verified live on one bot then broadcast", which is
   what happens today; the difference is the *pre-registered task list* and the *SPC check*.
3. **Rollback must be one command.** Today the pattern is `.bak-*` copies. Make it explicit:

```
engine/
  skills.v12.js  skills.v13.js  skills.v14.js
  CURRENT -> skills.v13.js          # runner.js auto-inject reads through this pointer
```

Rollback = repoint `CURRENT` + restart the affected runners; the auto-inject-on-spawn machinery
(SYNTHESIS P0.2, shipped v8/v9) then does the rest. Record the pointer target in every
`task_start` event so post-hoc attribution never depends on remembering what was deployed when.

**Two-engineer specifics.** With `engine-dev` and `engine-dev-2` both shipping into one
`skills.js`, versions interleave and a Tier 1 comparison can silently mix two changes.

- One version number per *merged* change set; never two engineers bumping in parallel.
- The gate report names the FEEDBACK entries the version claims to close; Tier 0 must contain a
  passing fixture for each.
- If two changes must ship together, say so in the report — the gate result then attributes to
  the pair, and neither can be individually credited.
- **The engineer who wrote the change does not write its gate assertion.** The other engineer
  does, from the FEEDBACK entry text. Cheap, and it catches assertions written to pass.

### 9.4 Flaky gates are worse than no gates

A gate that fails 1 in 20 runs for no reason trains everyone to re-run until green, which is
p-hacking with extra steps and destroys the gate's credibility permanently.

```
Track a per-assertion flake rate across all runs.
  flakeRate > 5%   -> QUARANTINE the assertion (runs, reported, non-blocking) until fixed
  re-run policy    -> a failed gate may be re-run EXACTLY ONCE; BOTH results are recorded.
                      1-of-2 is a flake investigation, not a pass.
  hysteresis       -> Tier 3 auto-rollback requires 2 consecutive alarming epochs,
                      except for the zero-tolerance channels (falseSuccess, protected damage,
                      death), which fire on the first event.
```

---

## 10. Pitfalls register

### 10.1 Survivorship bias — four concrete mechanisms in this system

| Mechanism | Direction of bias | Fix |
|---|---|---|
| **Dead bots stop emitting.** A version that kills bots produces *fewer* bad records — the tasks it would have failed never happen | makes dangerous versions look **good** | per-**exposure-hour** denominators, never per-call; treat death as a terminating event (competing risks); the `death` event in the sink |
| **Wedged bots never write a `task_end`**, and a driver's relog destroys the in-memory ring entirely | makes failure-prone versions look **good** | durable `task_start` written first; a dangling start is resolved to `unresolved` by the next process launch |
| **`say()` drops narration > 12 s out; `S.log` overflows at 100 entries** — both lose most under load | makes **busy/broken periods** disappear | durable JSONL sink independent of chat and of the ring |
| **Route selection by drivers.** Drivers issue gotos they expect to succeed | inflates field goto success rate | the sampled gauntlet exists precisely to remove this selection; never quote field goto rate as a capability number |

The general antidote: **denominators must come from an independent source.** Success rate =
successes / *attempts recorded at attempt time*, never successes / *outcomes observed*.

### 10.2 Goodhart — `SCOREBOARD.md` as currently specified

```
score = (100 - 10*rank) - 25*deaths + 5*shipped_findings
```

with `deaths` taken from driver reports and `shipped_findings` counted per FEEDBACK entry, in a
system where **two consecutive bottom rankings retire the driver**. That is a strong selection
pressure pointed at a partly self-reported metric. Predicted distortions, and repairs:

| Distortion | Why the formula produces it | Repair |
|---|---|---|
| **Finding-splitting** | +5 per *entry* | credit **distinct root causes**, deduped by the reviewing engineer at triage. One incident yielding three entries scores once. A `cluster:` field on FEEDBACK entries makes this mechanical |
| **Risk aversion** | −25 per death, and deaths come from deep mining, night ops, hard routes — exactly the work that generates engine learning | add a positive term for **risk-adjusted output**: `+ f(deepWorkHours, p90 distanceFromBase)`; or evaluate deaths **per exposure-hour of hazardous work**, not per shift |
| **Death under-reporting** | the penalty term is **self-audited** | source deaths from `<death>` lines in `logs/<bot>.log` (already emitted, 4 present) — an independent instrument. A self-reported penalty is not a penalty |
| **Attribution inflation** | joint reporters both score | split credit, or count first-reporter only |
| **Novelty over correction** | new entries score; *correcting your own wrong entry* scores nothing — yet the kevin-driver chopTrees retraction was one of the highest-value contributions in the file | explicitly credit **verified corrections and root-cause identifications** at the same rate as new findings |
| **Denominator-free counting** | a driver on shift twice as long files twice as many | normalise per bot-hour |

Two structural rules, more important than any weight tuning:

> **1. Never let a driver-visible score influence an engine A/B.** If drivers know their bot is
> the canary and that their score depends on outcomes, they will change task selection — which
> is exactly the confound §3.7's pre-registered task list exists to prevent.
>
> **2. Metrics that are used for driver evaluation and metrics used for engine evaluation must
> come from different pipelines.** Engine metrics come from the JSONL sink (machine-written,
> not driver-editable). Driver metrics may cite them but never the reverse.

And the engine-side Goodhart to watch: **`arrivalRate` is gameable by failing fast on hard
routes** (raising the rate by shrinking the attempt set) and **by widening the goal range**. Hence
the mandatory counter-metrics in §2.6: `medianTargetDistance`, `attemptRate`, and a `goalRange`
recorded on every row.

### 10.3 Sample contamination from concurrent fleet activity

Beyond terrain (§7.4), the fleet contaminates *measurement*:

- **Goal stomping.** Idle-guard firing its own goto mid-task reads exactly like a physics freeze,
  and has already been misdiagnosed as one. `__idleguard.stop()` for the whole benchmark session;
  assert `orphanedGoto == false` before each trip; record `pfInterference`.
- **Server load.** Concurrent fleet work moves TPS, which moves durations. Record `tpsBefore`;
  block pairs tightly in time so TPS is shared; exclude on `tps < 18` (pre-treatment).
- **Chat backlog.** A busy fleet pushes `say()` past its 12 s drop window, so chat-derived
  timelines lose events non-randomly. Do not build timing analysis on chat.
- **The player cap.** 8 slots, fleet at 7, one spare. Benchmarking is *serialised* against fleet
  operations. Either announce a quiet window (park bots, run the campaign) or accept the
  contamination and record `nearbyBots` — but do not pretend the second is as good as the first.
  On the staging world this constraint disappears entirely.

### 10.4 Do not exclude on post-treatment variables

The most seductive mistake available here: *"exclude trips where the bot was attacked by a mob —
that's not the engine's fault."*

It is a collider. A slower or worse-pathing engine spends more time exposed and therefore gets
attacked **more**, so excluding attacked trips preferentially deletes the bad engine's bad
trips and biases the comparison toward it. The mob encounters *are* part of the treatment effect.

Legitimate exclusions are **pre-treatment only** and must be pre-registered:

| Legitimate (pre-treatment) | Illegitimate (post-treatment) |
|---|---|
| hunger < 14 at trip start | got hungry during the trip |
| another bot within 40 blocks at trip start | another bot wandered in |
| `tps < 18` at trip start | server lagged during the trip |
| tool durability < 40 % at start | tool broke during the trip |
| precondition assertion failed (§3.5) | the engine failed |
| harness/operator error before the call | mob attack, fall damage, terrain surprise |

### 10.5 Voids, and how to keep them honest

A void is a trip that never entered the comparison. Voids are legitimate *only* for
pre-treatment reasons, and only if:

1. The void reason is recorded in the row (`void: "tps=16.2"`),
2. The void rate is reported per arm — **an asymmetric void rate is itself evidence of a
   problem**, usually that the "pre-treatment" condition was not actually pre-treatment,
3. Voids are decided by the harness from the precondition vector, never by a human looking at
   the outcome.

### 10.6 Baseline drift

Engine versions ship several times a night (v8 → v13 in hours). A baseline measured three
versions ago is not a valid comparator: everything else moved too.

> **Rule: every gauntlet campaign measures BOTH arms in the same session, on the same course
> version, with the same bot.** Stored historical numbers are for SPC trend monitoring only,
> never for a gate comparison.

Corollary: the gate ladder needs the *old* version installable on demand — which is exactly what
the `engine/skills.vN.js` + `CURRENT` pointer of §9.3 provides.

### 10.7 Harness effects

The measurement apparatus perturbs the system: `POST /stop` between trips, re-injection, the
surveyor lap, `__idleguard.stop()` leaving a bot unguarded, `/eval` polling adding load. Two
protections:

- The **A/A test (§3.6)** catches harness-induced asymmetry directly — that is its main job
  beyond estimating σ.
- **Symmetry**: whatever the harness does before arm A, it does identically before arm B.
  If arm B needs an extra `setGoal(null)`, arm A gets one too.

---

## 11. Implementation backlog, in ROI order

| # | Item | Effort | Unlocks |
|---|---|---|---|
| 1 | **`bench/fixtures/*` + a Tier-0 runner**, seeded from the highest-pain FEEDBACK entries (§9.2 table) | ~0.5 day | Deterministic regression detection at N = 1. Biggest single win. |
| 2 | **`logs/<bot>.events.jsonl` durable sink** (§8.2): `task_start`/`task_end`/`goto`/`death`/`reconnect`/`payload_stale`, versions on every record, written at start | ~0.5 day, ~75 lines | Every field analysis in this document; kills three survivorship channels |
| 3 | **Log goto outcomes in `runner.js`** — currently the request is logged and the response is not | ~10 lines | The single most-wanted field metric becomes recoverable |
| 4 | **`pollsPerTask` / `evalsPerTask` counters** keyed on `currentTask.id` (§2.5) | ~20 lines | The token-cost metric `GOAL.md` calls first-class |
| 5 | **TPS proxy** (`bot.time.age` delta, §1.2) in `/state` and in every event record | ~15 lines | The missing confounder; a fleet-health SPC channel |
| 6 | **`bench/run.js` harness**: course loader, precondition asserter, ABBA sequencer, void handler, CSV/JSONL writer, safety aborts | ~1 day | Everything in §3–§6 |
| 7 | **`bench/courses/*.json` schema + the seeded route sampler** (§7.1–7.2) | ~0.5 day | Valid cluster inference; enlargeable courses |
| 8 | **A/A validation run** (20 trips, one engine, two labels) | ~0.5 h server time | The σ every power calculation needs; harness validation |
| 9 | **Gate ladder + `bench/gates/<version>.json`; rollout manager refuses ungated versions** (§9.1, §9.3) | ~0.5 day | Evidence-gated rollout |
| 10 | **`engine/skills.vN.js` + `CURRENT` pointer** | ~1 h | One-command rollback; valid same-session baselines |
| 11 | **SPC daemon**: EWMA/CUSUM over the JSONL sink, alarms to chat + the rollout manager | ~0.5 day | Tier 3; catches the small regressions gauntlets cannot |
| 12 | **`SCOREBOARD.md` v2** per §10.2 — machine-sourced deaths, root-cause clusters, risk-adjusted output, per-bot-hour normalisation | ~1 h + a user decision | Removes the current Goodhart pressure |
| 13 | **Staging world** (§1.3) — server + snapshot/restore + the four gamerule profiles | ~1 day + a JRE decision | 5–8× trips/hour, 3–5× less variance, destructive tests become legal |
| 14 | **Surrogate safety battery + one historical validation pass** (§5.4) | ~0.5 day | The only feasible way to evaluate safety changes |

Items 1–5 are engine-side and small; items 6–9 are a new `bench/` tree that touches no engine
code. That split matters for the two-engineer process: the benchmark harness can be built by a
third party in parallel without merge contention.

---

## 12. Worked example: the goto2 A/B, redesigned

`goto2-ab-plan.md` is a good plan — the metric definitions, the false-success emphasis, the
safety aborts, the pre-declared expected rejections, and the kill switch are all correct and
should be kept verbatim. Six changes make it *statistically* sound:

| # | Change | Why |
|---|---|---|
| 1 | **Run the A/A first** — 16 trips, pathfinder vs pathfinder, labelled A/B | Validates the harness; yields σ for every power calculation; ~25 min |
| 2 | **Reallocate: 8 sampled routes × 2 directions × 2 arms = 32 trips per class, one class at a time** — instead of 6 curated routes × 5 runs × 2 dir × 2 arms across all classes | R = 8 clears the cluster-level p-floor (§4.3); 5 repeats on one route are ≈ 1 observation |
| 3 | **ABBA, not ABAB** | Cancels linear drift exactly, at zero cost (§3.2) |
| 4 | **Analyse with a cluster bootstrap over routes; report RMTT@60s, not mean ms** | Correct independence unit; correct handling of censoring (§6.1, §6.3) |
| 5 | **SPRT stopping with a 32-trip cap** (π₁ = 0.8, α = β = 0.05, boundary ±2.944) | Halves expected trips under a real effect; "inconclusive" is a valid, useful outcome |
| 6 | **Move R1 (tight quarters), R5 (water), R6 (ladders) out of the statistical tier into curated Tier-0 fixtures** — N = 1 capability assertions | These ask "can it do X at all", which is a deterministic question. Statistics on them is wasted budget; the plan already predicts their outcomes, which is the signature of a non-statistical question |

Phasing:

```
Phase 0  (25 min)  A/A validation, 16 trips.                      Gate: no significant difference.
Phase 1  (10 min)  Tier-0 capability fixtures: swim, ladder,      Output: a capability matrix,
                   1-wide corridor, torch wedge, leaf_litter.     not a p-value.
Phase 2  (45 min)  Class "long detour-heavy haul", 8 sampled      Primary: paired arrival rate,
                   routes, ABBA, SPRT-capped at 32 trips.         cluster bootstrap over 8 routes.
Phase 3  (cond.)   Only if Phase 2 favours ashfinder: repeat      Same protocol, new seed.
                   for "hilly/edge-prone".
Phase 4  (cond.)   R7 dig-enabled in DIGTEST_1, unchanged.        Absolute bars only.
```

Total: ~1.5 h for a result that can actually reach significance, versus ~1 afternoon for one
that structurally cannot. And the pre-registered decision rule from §7.1's `analysis` block goes
into the course file **before Phase 0 starts**.

Everything the existing plan says about preconditions (§0), the single-test-client rule, the
designated `DIGTEST_1` zone, the guard checks, the safety aborts, and the kill switch carries
over unchanged. Those parts are not the problem; the allocation and the ordering are.

---

## 13. Formula sheet

```
z values:   α=0.05 two-sided z=1.960 | α=0.10 two-sided z=1.645 | α=0.05 one-sided z=1.645
            α=0.10 one-sided z=1.282 | power 80% z=0.842 | power 70% z=0.524 | power 90% z=1.282

Unpaired 2-prop, per arm     n = (z_{1-α/2}+z_{1-β})² [p1(1-p1)+p2(1-p2)] / (p1-p2)²
MDE at n                     δ = (z_{1-α/2}+z_{1-β}) √( 2 p̄(1-p̄) / n )
McNemar paired               n = ( z_{1-α/2}√ψ + z_{1-β}√(ψ-δ²) )² / δ²,  ψ=p01+p10, δ=p01-p10
Discordant-pair form         n_disc = (z_{1-α/2}+z_{1-β})² / (2π-1)²,     π = p01/ψ
Paired log-ratio             n = (z_{1-α/2}+z_{1-β})² σ_d² / (ln R)²
Poisson rate ratio           D_total ≈ 4 (z_{1-α/2}+z_{1-β})² / (ln RR)²
Non-inferiority, per arm     n = (z_{1-α}+z_{1-β})² [p1(1-p1)+p2(1-p2)] / (Δ-|p1-p2|)²
Design effect                DEFF = 1 + (m-1)ρ ;  n_eff = n / DEFF
Cluster sign-test p-floor    p_min(two-sided) = 2^(1-R)
Wilson interval              p̃ = (x+z²/2)/(n+z²) ;  half = z/(n+z²) √( x(n-x)/n + z²/4 )
CUPED                        Y_adj = Y - θ(X - E[X]), θ = Cov(Y,X)/Var(X) ; Var ×= (1-ρ²)
SPRT (Wald)                  boundaries ± ln((1-β)/α) ; Λ += ln(π₁/0.5) or ln((1-π₁)/0.5)
EWMA                         z_t = λ x_t + (1-λ) z_{t-1} ; limits μ0 ± L σ √(λ/(2-λ))
CUSUM                        S⁺_t = max(0, S⁺_{t-1} + (x_t - μ0 - k)) ; alarm S⁺ > h
RMTT                         ∫₀^τ Ŝ(t) dt  (area under Kaplan–Meier up to the common horizon τ)
TPS proxy                    (bot.time.age₂ - bot.time.age₁) / ((t₂-t₁)/1000)   -- window ≥ 60 s
```

Reference constants for this system, as of 2026-09-01:

```
fleet size 7 bots (player cap 8, one spare client)
observed death rate           ≈ 0.07 / bot-hour   (3 deaths / ~42 bot-hours)
S.log ring                    LOG_MAX = 100 entries, LOG_SLICE = 20 per poll
chat drop window              say() drops anything scheduled > 12 s out
goto ceiling                  60 000 ms, hardcoded in runner.js
task watchdog cap             min(args.timeoutMs || 10 min, 30 min)
engine version at writing     skills.js ENGINE_VERSION = 13
designated test zone          DIGTEST_1: x ∈ [-100,-90], z ∈ [-60,-50], all y
```

---

## 14. What this report does **not** claim

- It has not been run. Every number in §4 is a design calculation from assumed parameters
  (p̄, ρ, σ_d). **The A/A test in §3.6 is what replaces the assumptions with measurements**, and
  every sample-size figure here should be recomputed once it has run.
- ρ (intra-route correlation) is assumed at 0.5–0.8 from the structure of the problem, not
  measured. If it turns out low, §4.3's reallocation matters less — but the p-value floor
  argument (`2^(1-R)`) is structural and holds regardless of ρ.
- The surrogate–death correlation of §5.4 is *unvalidated*; 4 deaths in the logs is a sanity
  check, not evidence.
- The staging world's variance-reduction estimate (3–5× on duration SD) is an engineering
  guess from which variance sources it removes, not a measurement.
- Nothing here has been coordinated with `engine-dev`/`engine-dev-2` on merge sequencing; the
  §11 backlog is ordered by ROI, not by what is currently in flight.

---

## Sources

Domain benchmarking practice:
- [MCU: An Evaluation Framework for Open-Ended Game Agents](https://arxiv.org/html/2310.08367v3) — task decomposition and difficulty parameterisation for open-ended Minecraft agents; the source of the "span the ability range" principle in §7.3.
- [MineDojo: Building Open-Ended Embodied Agents with Internet-Scale Knowledge](https://papers.nips.cc/paper_files/paper/2022/file/74a67268c5cc5910f64938cac4526a90-Paper-Datasets_and_Benchmarks.pdf) — programmatic (auto-assessable) vs creative task split; the model for the Tier-0/Tier-1 division.
- [BEDD: The MineRL BASALT Evaluation and Demonstrations Dataset](https://arxiv.org/pdf/2312.02405) — held-out evaluation seeds and TrueSkill-based comparison; the precedent for seeded, frozen evaluation instances (§7.2).

Experimental design under interference and non-stationarity:
- [Clustered Switchback Designs for Experimentation Under Spatio-temporal Interference](https://arxiv.org/abs/2312.15574) — clustered switchback under carry-over and non-stationarity; §8.1.
- [Powerful Switchback Experiments – Or Not?](https://arxiv.org/html/2606.03012) — power limits of switchback designs.
- [Design-Aware Variance Reduction for Switchback Experiments: A Comparative Study](https://arxiv.org/html/2606.27662v1) — CUPED/CUPAC under switchback; the basis for the §4.4 caveat that covariates should capture macro-level temporal features rather than individual residuals.
- [CUPED for switchback tests](https://medium.com/@garret.oconnell/cuped-for-switchback-tests-9e5b924ce1b0) — practitioner treatment of CUPED in switchback settings.

Standard methods used without a URL (textbook / well-established): Wald's SPRT; McNemar's test
and its discordant-pair sample-size form; Wilson score intervals; the cluster bootstrap;
Kaplan–Meier and restricted mean survival time (Royston & Parmar); CUPED (Deng et al., 2013);
EWMA and CUSUM control charts; Holm–Bonferroni.

Internal sources: `GOAL.md`, `LEARNING_HANDOFF.md`, `research/SYNTHESIS.md`,
`research/goto2-ab-plan.md`, `research/movement-engines.md`, `FEEDBACK.md` (64 entries),
`SCOREBOARD.md`, `DRIVER_GUIDE.md`, and direct reads of `runner.js` (`GET /state`, `POST /goto`),
`skills.js` (`S.start`, `S.status`, `pushLog`, `LOG_MAX`/`LOG_SLICE`), `dangerscan.js`, and
`logs/*.log` (76 179 lines across 10 bots).
