# PRIOR ART — Evaluating embodied/game agents, and what transfers to our engine

Track: literature. Date: 2026-09-01. Status: research report (no code changed).
Scope per brief: (a) embodied-navigation metrics, (b) Minecraft agent benchmarks,
(c) LLM-agent evaluation practice, (d) game-AI/robotics regression practice —
extracting ONLY what transfers, with precise formulas and implementation-ready
schemas keyed to our actual surfaces (`__skills.status` contract, runner.js HTTP
endpoints, task result objects, driver token spend).

Executive summary of the whole field in one line: **nobody publishes a
mineflayer-level micro-benchmark for skills like `goto`/`mineLane` — the
academic world evaluates whole agents on task suites; the metric machinery we
need exists, but assembling it at the skill level for a persistent live server
is our own work.** Our field-failure taxonomy (wedges, false success, silent
tool breakage, craft under-production) is *ahead* of published Minecraft
evaluation practice, which mostly assumes the action layer works.

---

## 1. Embodied-AI navigation metrics (a)

The canonical set comes from Anderson et al. 2018, "On Evaluation of Embodied
Navigation Agents" (the paper that standardized SPL), plus the Habitat
challenge line of work and VLN (vision-language navigation).

### 1.1 Success Rate (SR)

```
SR = (1/N) · Σᵢ sᵢ          sᵢ ∈ {0,1}
```

The entire value of SR hinges on **who computes sᵢ**. The field's rule: the
success predicate is computed by the *evaluator* from ground-truth state, never
by the agent's own claim. Standard predicate for point-goal navigation:
`d(final_pos, goal) ≤ r` at episode end (r typically 2·agent-radius; for us
r = 2 blocks matches skills.js arrival semantics).

**Transfer: this is the single most important import.** Tonight's field data
(goto resolving "success" on an empty path; safeDescend reporting 96 steps for
1 level of actual descent; craftSafe under-producing) is exactly the
self-reported-success failure the literature guards against. Every eval trial
needs a **verifier separate from the skill**: an `/eval`-side check of
`bot.entity.position` vs goal, inventory delta vs bill, y-level delta vs steps
claimed. The skill never grades itself.

### 1.2 SPL — Success weighted by Path Length (Anderson et al. 2018)

```
SPL = (1/N) · Σᵢ  sᵢ · lᵢ / max(pᵢ, lᵢ)
```

- `lᵢ` = shortest-path length from start to goal (geodesic in simulators)
- `pᵢ` = path length the agent actually traveled
- Range [0,1]; 1.0 = always succeeds via the optimal path. A success achieved
  by wandering 3× the optimal distance scores 0.33 for that episode.

**Transfer with one substitution.** We have no oracle geodesic on a live
server. Three usable stand-ins, in increasing fidelity:

1. `lᵢ = euclidean3D(start, goal)` — admissible lower bound, always available,
   makes SPL a slight *under*-estimate (fine for regression comparison; wrong
   for absolute claims).
2. `lᵢ = best pᵢ ever recorded on this scenario` (best-known-path). This is
   what CARLA/robotics practice does when no oracle exists; it makes SPL a
   *relative* metric that tightens as the fleet improves. Store per-scenario in
   the scenario file (`baseline.l`).
3. `lᵢ = offline A* on a world snapshot` — only worth it if we ever dump chunks.

`pᵢ` requires an **odometer the engine currently lacks**: accumulate
`Σ |Δposition|` per tick (or per 250ms sample) inside the skills context during
a task and expose it as `task.result.odometerBlocks`. This is ~5 lines in
skills.js and unlocks SPL, MDBI (§4.4), and the tunneling detector (a goto
whose odometer ≫ euclidean distance is wandering or digging).

### 1.3 SoftSPL (Habitat) — partial credit for progress

```
SoftSPL = (1/N) · Σᵢ  (1 − d_Tᵢ/d_0ᵢ) · lᵢ / max(pᵢ, lᵢ)
```

- `d_Tᵢ` = distance-to-goal at episode end, `d_0ᵢ` = distance-to-goal at start.
- Replaces the binary gate with progress fraction, so a run that gets 90% of
  the way there scores 0.9-ish instead of 0.

**Transfer: yes, as the secondary nav metric.** Multi-leg hauls that time out
one leg short are common for us; SoftSPL separates "almost worked" from "went
backwards", which pure SR cannot. Both numerator terms come free once the
odometer + final-position verifier exist.

### 1.4 SCT — Success weighted by Completion Time (Yokoyama et al. 2021)

```
SCT = (1/N) · Σᵢ  sᵢ · T*ᵢ / max(Tᵢ, T*ᵢ)
```

`T*ᵢ` = best-achievable completion time, `Tᵢ` = actual. Same shape as SPL but
in time, so it punishes stall-recovery loops and wedge-thrash even when the
path length is fine. **Transfer: use with `T*ᵢ` = best-known time per scenario
(store as `baseline.tStar`).** `Tᵢ` already exists: `task.elapsedS` in the
status contract. For a bot fleet, wall-time is the honest currency — a goto
that arrives after 6 stall-buster cycles is a worse goto.

### 1.5 Navigation Error, Oracle Success

```
NE  = d(final_pos, goal)                       (report the raw number)
OSR = (1/N) · Σᵢ 1[ min_t d(pos_t, goal) ≤ r ]  (was it EVER within r?)
```

**OSR is a diagnostic gem for us:** OSR=1 with SR=0 means "the bot reached the
goal and then left / got yanked away" — the idleguard-goal-stomping signature
and the arrival-then-wander bug class, distinguishable from "never got there"
without reading logs. Needs a 1Hz position sampler during eval trials only
(poller-side, zero engine change: sample `GET /status` bot.pos).

### 1.6 nDTW / SDTW (path-fidelity, VLN)

```
nDTW = exp( − DTW(P, R) / (|R| · d_th) )        SDTW = s · nDTW
```

Measures adherence to a *reference path* R, not just goal arrival. **Transfer:
optional, only for route-following scenarios** (patrol roads, path_1 walking,
"stay on the road not through the wheat farm"). Not a core metric; note it and
move on.

### 1.7 Collision / intervention counts

Habitat and robotics report collisions-per-episode and success-with-collision
separately. Our physics doesn't "collide" — the analog events are already in
the engine's telemetry vocabulary:

```
wedge_rate      = wedge events        / 100 blocks traveled
stall_rate      = stall-buster fires  / 100 blocks traveled
reset_rate      = path_reset events   / task
recovery_rate   = wedges self-cleared / wedges total     (guard efficacy)
```

The P0.1 plan already wires `path_reset('stuck')` reasons — counting them per
task turns tonight's anecdotes (leaf_litter/torch/chest-gap) into a tracked
distribution. **A wedge the engine clears itself is a collision; a wedge that
needs the driver is an intervention (§3.4) — keep the two ledgers separate.**

---

## 2. Minecraft agent benchmarks (b)

### 2.1 MineRL / ObtainDiamond — milestone-weighted partial credit

The MineRL competition's ObtainDiamond task scores a run as the sum of rewards
for the *first* acquisition of each tech-tree milestone (per the competition's
reward schedule): log 1, planks 2, stick 4, crafting_table 4, wooden_pickaxe 8,
cobblestone 16, furnace 32, stone_pickaxe 32, iron_ore 64, iron_ingot 128,
iron_pickaxe 256, diamond 1024. Roughly doubling per rung, so deep progress
dominates but shallow progress still separates agents.

**Transfer: the *shape* (geometric milestone ladder, first-acquisition only) is
the right way to score any long-horizon scenario with a natural progression** —
e.g. an "iron kit from zero" golden scenario: logs → planks → table → wooden
pick → cobble → furnace → iron ingots → iron pick, each rung worth 2× the
last. It gives partial credit without inviting grinding (only firsts count).

### 2.2 MineRL BASALT — fuzzy tasks need human/pairwise judging

BASALT tasks ("make a waterfall and photograph it", "build a house in the
style of the village") have no programmatic success predicate; evaluation is
pairwise human comparison of trajectory videos, aggregated with **TrueSkill**,
on held-out world seeds (BEDD dataset, NeurIPS 2023).

**Transfer: small but real — aesthetics.** Our TODO "human-looking builds"
is a BASALT-class fuzzy objective. Don't invent a formula for it; the
literature's verdict is that pairwise comparison ("which of these two house_1
builds looks more human?") aggregated by even an informal Elo/TrueSkill beats
any hand-rolled scoring. Felix eyeballing two screenshots is a valid
evaluation instrument; a rubric pretending to be a formula is not. Everything
else we do has a programmatic predicate — keep it that way as long as possible.

### 2.3 MineDojo — the programmatic/creative split

MineDojo's benchmark has thousands of tasks in two families: **programmatic**
tasks (survival / harvest / tech-tree / combat) with coded ground-truth checks
over inventory and world state, and **creative** tasks scored by MineCLIP
(video-text similarity — a learned judge). The lesson the field took from it:
coded checks scale and are trustworthy; learned judges are for the residue.

**Transfer: taxonomy discipline.** Every scenario we write must declare which
family it's in. Our verifier types (arrival / inventory-delta / structure-diff
/ survival-window) are the programmatic family and cover ~all engine work.

### 2.4 Voyager — the eval that matches our thesis

Voyager (Wang et al. 2023) measured: **unique items discovered per prompting
iteration** (63 items in 160 iterations; 3.3× baselines), **tech-tree milestone
unlock speed in prompting iterations** (up to 15.3× faster to iron/diamond),
and **map coverage** (2.3× distance traveled). Baselines: ReAct, Reflexion,
AutoGPT.

**Transfer: Voyager's x-axis is the insight.** It measures progress per *LLM
call*, not per wall-clock hour — exactly our "token cost per outcome is a
first-class metric" thesis, in the literature since 2023. Import directly:

```
milestone_cost   = driver tokens spent / milestone unlocked
items_per_call   = unique item types acquired / driver LLM call
coverage         = area of visited 16×16 chunk set   (breadth of operation)
```

Note Voyager also validates the architecture claim: its skill library (GPT-4
writes a JS skill once, the skill runs forever) is our skills.js pattern; its
eval was designed to show exactly that amortization. Cite it when justifying
the metric set.

### 2.5 mindcraft / MineCollab — the closest thing to prior art for our stack

mindcraft (kolbytn / mindcraft-bots — same mineflayer substrate as us) ships
MineCollab (arXiv 2504.17950): cooking / crafting / construction task suites,
procedurally generated, multi-agent with communication constraints. Mechanics
worth copying outright:

- **Task file = JSON** with `goal`, `initial_inventory` (per-agent),
  `agent_count`, `target`, `number_of_target`, `type`, `timeout` (typically
  300s), `blocked_actions`, `requires_ctable`, recipe `depth`.
- **Binary scoring for crafting/cooking** (inventory-state validator);
  **edit-distance partial credit for construction** (built structure vs
  blueprint, block-by-block).
- **Harness**: an evaluation script that launches a throwaway server + agents
  headlessly, writes `results.txt` per experiment, supports parallel worlds.

**Transfer: the construction metric and the harness shape.** For
buildSchematic we already count placed/verified — formalize it as the
literature does:

```
build_accuracy = |{cells: built(cell) == blueprint(cell)}| / |blueprint cells|
```

(our v7 "62/62 placed + 62/62 verified" is this metric at 1.0). And their
harness answers our determinism problem (§4.1): they get reproducibility by
**spawning a fresh local server per eval run** — not by trying to make a live
world deterministic.

### 2.6 Published mineflayer bot benchmarking

Searched; effectively none below the whole-agent level. mindcraft/MineCollab
is the only maintained mineflayer eval harness; no one publishes SR/SPL for
pathfinder-level primitives. Two consequences: (1) our goto/mineLane golden
suite would be genuinely novel infrastructure, worth keeping clean; (2) there
is no external baseline to import — `baseline.l` / `baseline.tStar` must be
self-recorded (best-known values), which the robotics field considers normal.

---

## 3. LLM-agent evaluation practice (c)

### 3.1 pass@k vs pass^k — reliability is the product metric

Chen et al.'s unbiased pass@k estimator (n trials, c successes):

```
pass@k  = 1 − C(n−c, k) / C(n, k)          "at least one of k succeeds"
```

τ-bench (Yao et al. 2024) inverts it for agents that must not fail:

```
pass^k  = C(c, k) / C(n, k)                "all k of k trials succeed"
         (for true per-trial success p:  pass^k = pᵏ — exponential decay)
```

Headline from τ-bench: a ~90% pass@1 agent has <60% pass^8 — SOTA function
callers are wildly inconsistent across reruns of the *same* task.

**Transfer: pass^k is THE regression gate metric for skills.** A skill run in
an unattended fleet is a pass^k consumer: a nightly `goto` executed 50× at 95%
per-trial success wedges ~2.6 bots a night. Policy proposal, direct from the
literature: **a skill "counts as shipped" at pass^5 ≥ 0.9 on its golden
scenarios** (≈ per-trial ≥ 0.98), and a release is blocked if pass^5 drops.
Report per-trial SR with a Wilson interval when n is small (§4.5).

### 3.2 Cost-controlled evaluation (Kapoor et al., "AI Agents That Matter", 2024)

Core claims that map onto us verbatim: accuracy-only leaderboards produce
needlessly costly agents; results must be reported as a **(cost, accuracy)
Pareto frontier**; joint optimization of the two finds cheaper designs at
equal accuracy. Follow-on work (HAL leaderboards) made cost a first-class
column.

**Transfer — our headline fleet metric, precisely defined:**

```
CPS (cost per success)      = Σ driver tokens (or $) over window / Σ verified successes
TPB (tokens per banked unit)= Σ driver tokens / Σ items banked to depot
autonomy_ratio              = engine-executed actions / total actions   (→ 1.0)
```

Attribution rule (needed for honesty): a driver session's tokens are charged
to the tasks it issued in that window; idle-guard work is charged zero driver
tokens — which is exactly why autonomy_ratio and CPS reward pushing behavior
into the engine. Every A/B (e.g. pathfinder-tuned vs ashfinder `/goto2`, or
Sonnet vs cheaper driver models) must be plotted as (CPS, SR) pairs, not SR
alone — this is the paper's whole point.

### 3.3 Autonomy curves — METR's time-horizon method

METR ("Measuring AI Ability to Complete Long Tasks", 2025): for each agent,
fit a logistic curve of success probability vs **log task length** (task
length = time a human needs); report the **50% time horizon** t₅₀ where the
curve crosses 0.5.

```
P(success | task of human-length t) = σ(a − b·ln t)      t₅₀ = exp(a/b)
```

**Transfer, adapted:** our task-length axis is "minutes of unattended
operation required". The fleet analog:

```
autonomy half-life T₅₀ = the unattended duration a bot survives-and-works
                          with P=0.5 without an L2+ intervention (§3.4)
```

Estimable two ways: (cheap) MTBI directly, assuming exponential survival,
T₅₀ = MTBI·ln2; (better, later) logistic fit over scenarios of graded length
(5-min chop → 30-min mine → 3-h shift). Track T₅₀ per engine version — the
engine's whole purpose is to move this number up; it's the one-number answer
to "is the engine getting better?".

### 3.4 Intervention taxonomy + success taxonomy

Synthesized from robotics disengagement practice (§4.4) and LLM-agent papers;
this is the schema our logs already almost speak:

**Intervention levels** (count each separately; only L2+ breaks "autonomy"):

| Level | Definition | Our concrete form |
|---|---|---|
| L0 | telemetry read, no state change | `GET /status` poll |
| L1 | re-parameterization via public API | new task/queue via task.sh, profile switch |
| L2 | manual reasoning / privileged surgery | hand-written `/eval`, `__idleguard.stop()` debugging, relog-to-fix |
| L3 | human intervention | Felix says something |

**Outcome taxonomy per task** (every trial gets exactly one label):

```
verified_success   claimed ∧ verifier-pass
false_success      claimed ∧ verifier-FAIL          ← goto empty-path, staircase 96/1
diagnosed_failure  skill raised typed error (no_tool, no_path, kit_missing, timeout)
silent_failure     no error, no success (hung, wedged, drifted)
crash              task threw / disconnect mid-task
death              bot died during task
```

```
FSR  (false success rate)  = false_success / (verified_success + false_success)
DFR  (diagnosed fraction)  = diagnosed_failure / all failures
```

**FSR is the metric tonight's field data begs for.** The literature's
umbrella term is verifier-grounded evaluation: agents' self-reports are known
to inflate success 10–30% in tool-use benchmarks; τ-bench, SWE-bench, WebArena
all define success by external state checks only. Target FSR = 0: a false
success is strictly worse than a failure because drivers build plans on it.
DFR is the quality-of-failure metric — `no_tool` at minute 1 is cheap,
silent wedge at minute 40 is expensive; engine work that converts silent
failures into typed early errors shows up as DFR↑ even when SR is flat.

---

## 4. Regression practice from game AI & robotics (d)

### 4.1 Golden scenarios; determinism is a spectrum

Game-QA practice (surveys: "A Survey of Video Game Testing" 2021; industry
replay systems): record a scenario, replay it per build, diff outcomes.
Determinism requirement: same inputs → same outputs; where the engine can't
guarantee it, studios fall back to **statistical replay** (N repetitions,
compare distributions) and **tolerance bands** rather than exact diffs.

**Transfer, honestly assessed for a live anarchic server:** true deterministic
replay is unavailable (mobs, other bots, CAVECREW, weather, chunk state). The
literature's fallback stack maps cleanly:

1. **Fixed-site scenario suite on the live server** — registered test sites
   (BASE.md rows, like the existing 3106/3107 test-bot pattern): fixed start
   pos, fixed kit (kit preflight doubles as setup verifier), fixed goal.
   Variance: mobs/weather → run N=5 trials, report SR + Wilson interval, SPL
   median. Good for: nav scenarios, mining scenarios, wedge-regression checks.
2. **Throwaway local server for CI** (the mindcraft harness pattern, §2.5):
   same MC version, offline mode, fixed seed, peaceful or mob-gated — spawn,
   run the golden suite headless, tear down. This *is* near-deterministic and
   is where pass^k gates belong. One-time cost: a `spawn_test_server.sh`; the
   engine needs zero changes (runner.js already targets any host:port).
3. **Log-replay assertions** (weakest, free): logs/*.log are timestamped event
   streams; regression checks that grep for known-bad signatures
   (`path_GoalChanged` bursts, `chat dropped (backlog)`, torch-counter
   inflation) run on every night's logs with no bot time at all.

**Scenario provenance rule (AV industry practice):** every field incident
becomes a scenario. The scenario library is the fossilized failure taxonomy —
leaf_litter wedge site, torch-in-corridor staircase, chest-gap at the depot,
the ridge that killed Marcel. AV companies grow their sim libraries exactly
this way (incident → scenario → regression gate); it's the highest-value-
per-effort practice in this whole report.

### 4.2 Composite scoring — the CARLA Driving Score

CARLA Leaderboard's per-route score:

```
DS_i = R_i · P_i
R_i  = fraction of route completed                    ∈ [0,1]
P_i  = 1 / (1 + Σ_j c_j · n_{i,j})                    (linear penalty, LB 2.x)
       (older LB 1.0 used multiplicative P_i = Π_j p_j^{n_ij}, p_j ∈ (0,1))
```

with per-infraction-class coefficients (pedestrian collision 1.0, vehicle
0.7, static 0.6, …). They moved exponential→linear penalties specifically
because teams *gamed* the exponential by stopping early — a documented
Goodhart case worth remembering.

**Transfer: this is the right shape for a per-task field score**, because our
failures are rarely "didn't arrive" and often "arrived while chewing the
plaza". Proposed infraction table (coefficients tuned later; the *structure*
is the import):

```
TaskScore = completion · 1/(1 + Σ c_j·n_j)

infraction               c_j     detection source
death                    10      bot 'death' event during task
protected block broken    5      digguard/reachguard hit log
drops abandoned           1      post-task item-entity scan ≤16 blocks
torch-law violation       0.5    kit preflight / lightSweep audit
base-path damage          0.5    BASE.md structure diff
chat-backlog spam         0.2    'chat dropped (backlog)' log lines
```

This also formalizes SCOREBOARD.md's "incident record" criterion into a
number, and directly penalizes the chopTrees-felled-Peter's-pillars incident
class.

### 4.3 Chaos / fault-injection testing

Chaos engineering (Netflix lineage): define the steady-state metric, inject a
fault, assert the system returns to steady state; measure **MTTR**. Game-side:
fuzzing inputs and adversarial scenario perturbation.

```
MTTR = mean( t_recovered − t_fault )   over injected faults
recovery_rate = faults recovered without L2 intervention / faults injected
```

**Transfer — the guard stack finally gets a test harness.** Our guards
(idleguard, digguard, survival.js-to-be, stall-buster) are recovery machinery
that today only gets exercised by accidents. Injectable faults, all cheap via
`/eval` or RCON on a test bot: drop the held tool mid-mineLane (silent-breakage
drill), place leaf_litter/torch at the bot's feet (wedge drill), `bot.quit()`
mid-task (reconnect/reinject drill — verifies the P0.2 spawn-handler),
RCON-spawn a creeper at 12 blocks (survival.js drill), void the food slot
(autoeat drill). Each is a golden scenario whose verifier asserts *recovery*,
not task success. This is the only known way to regression-test the "three
deaths shared one shape" fix class before the field does it for us.

### 4.4 Disengagement metrics — MDBI / MTBI

From AV benchmarking (e.g. arXiv 2006.02518) and adopted across field
robotics (legged forestry robots etc.):

```
MTBI = autonomous operating time  / # interventions      (L2+ per §3.4)
MDBI = autonomous distance        / # interventions
```

Known critique (Starsky Robotics et al.): miles-per-disengagement is gameable
by cherry-picking easy miles — comparisons are only valid on **matched
routes/conditions**. Transfer: report MTBI per activity class (mining shift vs
haul vs build), never fleet-blended; the odometer (§1.2) provides distance.
Driver-session logs already contain the intervention events (every manual
/eval is one); counting them is a log-mining script, not engine work.

### 4.5 Small-n statistics — Wilson interval

Golden suites will run n=5..20 trials; report SR as an interval, not a point:

```
center  = (p̂ + z²/2n) / (1 + z²/n)
halfwid = z·√( p̂(1−p̂)/n + z²/4n² ) / (1 + z²/n)        z = 1.96 for 95%
```

Regression gate rule from CI practice: flag when the new build's interval and
the baseline interval *don't overlap* (cheap sequential rule; avoids both
false alarms at n=5 and death-by-variance).

### 4.6 Property-based / invariant checks (from software QA, aimed at tonight's bugs)

Metamorphic & property-based testing transfers as **conservation invariants**
checked by verifiers after any task:

```
craft mass balance:   Δinputs_consumed  == Σ recipe_inputs(outputs_produced)   ← craft-void class
inventory conservation over relog:  inv_before ≈ inv_after (± known drops)     ← desync class
odometer sanity:      odometerBlocks ≥ euclidean(start, end)                   ← teleport/rubber-band detector
descent honesty:      |Δy| ≈ steps_reported                                    ← staircase false-success
torch economy:        torches_placed ≤ torches_crafted + torches_held_before + torches_swept
```

Each invariant is ~5 lines in a verifier and each one is a bug class we
already paid for in the field. Rubber-banding/chunk-corruption specifically:
the odometer-vs-displacement invariant plus a position-jump detector
(`|Δpos| > 5 blocks in one 250ms sample` outside teleports) gives it a
signature and a count instead of an anecdote.

---

## 5. The transfer package — metric registry, schemas, adoption order

### 5.1 Metric registry (names frozen; formulas above)

| Metric | Formula ref | Level | Needs | Answers |
|---|---|---|---|---|
| SR (verified) | §1.1 | per skill/scenario | verifier | does it work? |
| FSR | §3.4 | per skill | verifier | can drivers trust `done`? |
| pass^k (k=5) | §3.1 | per golden scenario | N repeats | is it fleet-grade reliable? |
| SPL | §1.2 | goto/haul | odometer + baseline.l | is the path sane? |
| SoftSPL | §1.3 | goto/haul | same | how close did failures get? |
| SCT | §1.4 | any timed task | baseline.tStar | is it getting slower? |
| OSR | §1.5 | goto | 1Hz sampler | arrived-then-lost vs never-arrived |
| wedge/stall rate | §1.7 | nav | path_reset counters | which terrain hurts? |
| build_accuracy | §2.5 | buildSchematic | blueprint diff | placement fidelity |
| milestone ladder | §2.1 | long scenarios | milestone list | partial credit, ungameable |
| CPS / TPB | §3.2 | fleet, weekly | token ledger | thesis metric: cost per outcome |
| autonomy_ratio | §3.2 | fleet | action attribution | engine vs LLM share |
| MTBI / MDBI | §4.4 | fleet, per activity | intervention log | babysitting burden |
| T₅₀ half-life | §3.3 | fleet, per version | MTBI or fits | THE engine headline number |
| TaskScore | §4.2 | field tasks | infraction counters | success minus collateral |
| MTTR / recovery_rate | §4.3 | guard stack | fault injection | do the guards guard? |
| DFR | §3.4 | per skill | typed errors | failure quality |

### 5.2 Scenario file schema (JSON; one file per golden scenario)

```json
{
  "id": "goto_ridge_marcel_01",
  "skill": "goto",
  "args": { "x": -33, "y": 117, "z": 110, "profile": "HAUL" },
  "setup": {
    "startPos": [-8, 110, 4],
    "kit": { "torch": 8, "bread": 4, "stone_pickaxe": 1 },
    "timeOfDay": "day", "site": "BASE.md:test_site_1"
  },
  "verifier": [
    { "type": "arrival", "goal": [-33, 117, 110], "r": 2 },
    { "type": "invariant", "name": "odometer_sanity" },
    { "type": "no_infraction", "classes": ["death", "protected_block"] }
  ],
  "budget": { "timeoutS": 180, "maxBlocksDug": 0 },
  "baseline": { "l": 87.2, "tStar": 41, "engineVersion": 12 },
  "trials": 5,
  "provenance": "FEEDBACK: Marcel fall death 2026-08-31",
  "tags": ["nav", "surface", "regression:movements-profile"]
}
```

### 5.3 Trial record schema (what the eval harness writes, one per trial)

```json
{
  "scenarioId": "goto_ridge_marcel_01", "trial": 3,
  "engineVersion": 12, "bot": "TestBot3106", "startedAt": "…",
  "claimed": "done",
  "verdict": "verified_success",
  "elapsedS": 44, "odometerBlocks": 91.0,
  "finalDistToGoal": 1.2, "minDistToGoal": 1.2,
  "events": { "stalls": 1, "wedges": 0, "pathResets": 1, "digs": 0 },
  "infractions": {}, "toolDurabilityDelta": 0,
  "interventions": { "L1": 0, "L2": 0 },
  "driverTokens": 0,
  "log": ["…tail of __skills.status log slice…"]
}
```

Everything above maps to existing surfaces: `claimed` = `task.phase/done`,
`elapsedS` = `task.elapsedS`, `log` = the status log slice, events come from
the P0.1 telemetry, `odometerBlocks`/durability are the two genuinely new
engine fields (both already independently demanded by SYNTHESIS P0.4).

### 5.4 What the engine must add (small, and all dual-use)

1. **Odometer** in skills ctx → `task.result.odometerBlocks` (§1.2). ~5 lines.
2. **Counters**: stalls, wedges (by cause), pathResets, blocksDug/Placed per
   task in `task.result` (P0.1 telemetry already computes the events).
3. **Durability delta** per task (P0.4 already ships heldItem+durability%).
4. Typed errors stay typed (already true: no_tool/no_path/kit_missing/timeout)
   — DFR depends on never collapsing them into generic failure.
5. Nothing else. Verifiers, samplers, scenario runner, token ledger, and
   MTBI mining are all *harness-side* (poller scripts + log grep), not engine.

### 5.5 Adoption order (value/effort, literature-justified)

1. **Verifier discipline + outcome taxonomy (FSR)** — zero engine change,
   kills the false-success class that burned us tonight. (§1.1, §3.4)
2. **Golden scenario library seeded from FEEDBACK.md incidents**, live-site
   variant first; N=5, SR+Wilson, pass^5 gate for "shipped". (§4.1, §3.1)
3. **Odometer + counters** → unlocks SPL/SoftSPL/MDBI/tunneling detector. (§1.2)
4. **Token ledger → CPS/TPB + autonomy_ratio**, reported weekly next to
   SCOREBOARD.md; all engine A/Bs (goto2, driver models) reported as
   (cost, SR) pairs. (§3.2)
5. **Fault-injection drills for the guard stack** (MTTR) — gate for shipping
   survival.js. (§4.3)
6. **Throwaway-server CI suite** (mindcraft harness pattern) once the scenario
   library stabilizes. (§2.5, §4.1)
7. **T₅₀ autonomy half-life** per engine version once MTBI data accumulates —
   the headline chart. (§3.3)

### 5.6 Anti-Goodhart notes (each documented in the sources)

- CARLA's exponential-penalty gaming → keep penalties linear; never let a
  metric reward stopping early. (§4.2)
- Miles-per-disengagement cherry-picking → MTBI only comparable on matched
  activity classes. (§4.4)
- pass@k flatters; pass^k is what a fleet feels. Report both, gate on pass^k.
- Self-graded success inflates — verifier or it didn't happen. (§3.4)
- Voyager's torch counter lesson from our own field data: counters that can
  double-count (torch re-placement) are telemetry, not economy — invariants
  (§4.6) are the economy.

---

## Sources

- Anderson et al. 2018, On Evaluation of Embodied Navigation Agents (SPL): https://arxiv.org/abs/1807.06757 ; summary https://www.emergentmind.com/topics/success-weighted-by-path-length-spl
- Yokoyama et al., Success Weighted by Completion Time: https://arxiv.org/html/2103.08022
- VLN path-fidelity metrics (nDTW/SDTW): https://vigilworkshop.github.io/static/papers-2019/33.pdf
- Voyager (Wang et al. 2023): https://arxiv.org/abs/2305.16291 ; https://voyager.minedojo.org/
- MineCollab / mindcraft (arXiv 2504.17950): https://arxiv.org/pdf/2504.17950 ; task/harness details https://github.com/mindcraft-bots/mindcraft/blob/develop/minecollab.md
- MineRL BASALT human-eval + TrueSkill (BEDD, NeurIPS 2023): https://arxiv.org/pdf/2312.02405 ; competition retrospective https://arxiv.org/pdf/2303.13512
- τ-bench, pass^k (Yao et al. 2024): https://arxiv.org/abs/2406.12045
- Kapoor et al., AI Agents That Matter (cost-controlled eval): https://arxiv.org/abs/2407.01502
- METR time horizons: https://metr.org/time-horizons/ ; https://arxiv.org/html/2503.14499v1 ; limitations note https://metr.org/notes/2026-01-22-time-horizon-limitations/
- CARLA Leaderboard evaluation criteria (driving score, infraction penalties): https://leaderboard.carla.org/evaluation_v2_1/ ; https://leaderboard.carla.org/evaluation_v1_0/
- AV benchmarking MDBI/MTBI: https://arxiv.org/pdf/2006.02518 ; critique https://medium.com/starsky-robotics-blog/why-miles-per-disengagement-misses-the-point-as-an-autonomous-vehicle-success-metric-c3395cb0a196
- Video-game testing survey (replay/regression/fuzzing): https://arxiv.org/pdf/2103.06431
