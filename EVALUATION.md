# EVALUATION.md — Fleet Evaluation Doctrine (v1, 2026-09-01)

Synthesized from the four research tracks:
`research/eval-literature.md` (prior art + metric registry),
`research/eval-methodology.md` (statistics for a noisy live world),
`research/eval-instrumentation.md` (telemetry audit + ledger spec + token measurement),
`research/eval-benchmarks.md` (on-server benchmark suite + ALGO.md).
This file is the DOCTRINE — the binding decisions. The research reports remain the
rationale and the detail; where this file and a report disagree, this file wins.
Adopted at engine v15. Owner of the file: team lead. Amendments are dated appends.

---

## 0. The five laws (everything else derives from these)

1. **Verifier or it didn't happen.** No metric may be sourced from the system under
   test. Arrival = harness position read after an 800 ms settle; builds = independent
   `blockAt` sweep; yield = inventory delta. The engine's own verdict is recorded only
   to compute false-success. Target FSR = 0, always; a false success scores worse than
   an honest failure everywhere in this doctrine.
2. **Deterministic assertions before statistics.** Almost every real regression in this
   stack is a binary breakage, not a distributional shift. One N=1 reproduction of the
   torch wedge outranks a 60-trip gauntlet. The Tier-0 fixture suite indexed to
   FEEDBACK.md is the highest-ROI evaluation asset and is built first.
3. **The unit of statistical independence is the ROUTE (cluster), not the trip.**
   Repeats within a route are ≈ one observation. Every interval and p-value is computed
   over clusters (cluster bootstrap); a campaign with R < 6 routes cannot claim
   significance (sign-test p-floor = 2^(1−R)).
4. **Cost per outcome is co-primary with success rate.** Every A/B and every gate
   reports (cost, SR) pairs, never SR alone. `think_share` is the direct falsifiable
   test of "the LLM thinks once; code runs forever".
5. **Engine evaluation and driver evaluation are separate pipelines.** Engine metrics
   are machine-written (JSONL ledger + bench harness, not driver-editable). Driver
   metrics may cite engine metrics; never the reverse. A driver-visible score must
   never influence an engine A/B.

---

## 1. Outcome taxonomy (the contract everything rests on)

Every task attempt gets exactly one `outcome` from the closed 16-value enum of
eval-instrumentation §4.5, evaluated top-down, first match wins:

```
death > disconnected > timeout > wedge > kit_missing > no_tool > reach_violation >
low_health > inv_full > no_path > not_found > cancelled > bad_input > error >
false_success > ok
```

Rules:
- `ok` requires `task.done === true` AND every per-skill assertion in the `ASSERTS`
  table passed. `false_success` = done-claimed + assertion failed (goto empty-path,
  staircase 96/1, craft under-production classes).
- `bad_input` (bad_args / unknown_skill / busy / queue_full) is excluded from every
  algorithm KPI — operator error is not an engine property.
- The enum is closed and permanent; new failure kinds live in `code` until promoted
  with a schema-version bump.
- Rollup mapping to the literature's 6-label taxonomy (for reports): `ok` →
  verified_success; `false_success` → false_success; typed codes (no_tool, no_path,
  kit_missing, timeout…) → diagnosed_failure; `wedge` → silent_failure;
  `disconnected`/`error` → crash; `death` → death. DFR (diagnosed fraction of
  failures) is a tracked quality-of-failure metric: engine work that converts silent
  failures into typed early errors shows up as DFR↑ even at flat SR.

**ASSERTS table** (per-skill false-success assertions + continuous `yield` =
achieved/requested) lives in skills.js next to the registry, SEPARATE from each
skill's `fn` — the assertion must be independent of the code that might be lying.
Full table: eval-instrumentation §4.6. Conservation invariants (craft mass balance,
inventory-over-relog, odometer ≥ euclidean displacement, |Δy| ≈ steps, torch economy)
are ~5-line verifiers each and are part of the same table.

---

## 2. Metric set per algorithm class (formulas frozen)

Notation: N = task_end records excluding `bad_input`; G = goto spans; verifier-graded
throughout.

### 2.1 Universal (every skill)

```
SR         = |ok| / N                              (verified success rate — THE rate)
FSR        = |false_success| / N                   (target 0; any nonzero = alarm)
naive_SR   = |done===true| / N
trust_gap  = naive_SR − SR                         (headline integrity metric)
DFR        = |typed-error failures| / |all failures|
yield      = per-skill achieved/requested (ASSERTS); under_prod_rate = |yield<1 ∧ ok| / N
pass^k     = C(c,k)/C(n,k) over n golden-scenario trials; ship gate pass^5 ≥ 0.9
Wilson CI on every small-n rate; never Wald. Suppress cells with n < 5.
```

### 2.2 Movement (goto / come / movement profiles)  [bench: GG]

```
arrived      = dist3D(final, target) ≤ goalRange + tolerance, 800 ms settle
SPL          = (1/N) Σ sᵢ · lᵢ/max(pᵢ, lᵢ)     l = crow-flies (stated lower bound),
                                                p = odometer (2 Hz sampler, stated lower bound)
                                                → valid for RANKING, never as absolute %
SoftSPL      = (1/N) Σ (1 − d_T/d_0) · l/max(p,l)   (partial credit; secondary)
SCT          = (1/N) Σ sᵢ · T*/max(T, T*)       T* = best-known per scenario (baseline.tStar)
OSR          = ever-within-r rate (arrived-then-lost vs never-arrived diagnostic)
WR_goto      = 100·|{g: unsticks>0 ∨ res=stuck ∨ resets.stuck≥3}| / |G|
WR_task      = 100·|wedge outcomes| / N ;  WR_task/WR_goto = unstick-ladder failure rate
Durations: analyse ln(ms); timeouts are CENSORED, never imputed; report RMTT@τ
(τ = shortest common ceiling) or KM median. Utility scalar (secondary, pre-committed):
arrived +1, honest_fail 0, timeout −0.2, false_success −3, death −50.
Route classes: SHORT/MEDIUM/LONG × OPEN/ENCLOSED/DESCENT (auto-assigned from crow, Δy,
skyLight). SPL/durations reported per class, never pooled.
```

### 2.3 Mining (mineLane / safeDescend)  [bench: MP]

Measure what the engine controls, not what the world contains (`blocksMinedPerMinute`
is a statement about the engine; `diamondsPerLane` is a statement about the world):

```
blocks/min, secPerBlock, yieldPct = banked/dug, stall events per 100 blocks,
durability per 100 blocks, digs_per_break (unwarned breaks = HARD trigger),
torch compliance: maxTorchGap ≤ 7 AND minLight ≥ 8 over the walked lane,
dropsLeft = 0 (law), descent honesty |Δy| ≈ steps (ASSERTS).
```

### 2.4 Building (buildSchematic / buildCore / frameStructure)  [bench: BP]

```
build_accuracy = verifiedHarness / blueprint cells   (harness blockAt count, not the skill's)
wastePct = (consumed − bill)/bill ; reclaimPct = recovered/consumed
placeTimeouts (trend KPI), scaffoldPlacements = 0, protectedViolations = 0 (law)
Partial credit for long-horizon scenarios: MineRL-style geometric milestone ladder,
first-acquisition only. Aesthetics: pairwise human judgment (BASALT/TrueSkill) only —
never a hand-rolled formula.
```

### 2.5 Survival / guards (dangerscan + survival.js + guard stack)  [bench: SD + drills]

Deaths are statistically untestable (0.07/bot-hour ⇒ ~900 bot-hours to detect a
halving). **Gate on high-frequency near-miss surrogates**; track raw deaths as an
unpowered monitoring channel; never claim "reduced deaths" from surrogates — claim
"reduced near-miss exposure":

```
hpDropEvents (≥2 HP), hostileExposureS, darkExposureS, fallEvents, panicEntries,
lowHpMinutes  — tens-to-hundreds/hour ⇒ ~100× statistical throughput.
Fault-injection drills (chaos engineering): MTTR = mean(t_recovered − t_fault);
recovery_rate = recovered-without-L2 / injected. Drills: tool-loss mid-mine, wedge
block at feet, bot.quit() mid-task, staged mob, food void. Shipping gate for the
guard stack.
detectMs ≤ 1000 (median), branch match ≥ 8/10, handback = 1 whenever death = 0.
hp_per_100m = exposure-normalized damage (the fair hauler-vs-miner comparison).
```

### 2.6 Autonomy floor (queue + idleguard + runner)  [bench: AS soak]

```
utilization = active_ms/wall_ms (the no-idle law, measured); idlePct; uptimePct
Interventions: L0 poll / L1 re-parameterization / L2 manual eval-surgery / L3 human.
Only L2+ breaks autonomy. MTBI = autonomous time / L2+ interventions, per activity
class, never fleet-blended (cherry-picking critique).
T50 autonomy half-life = MTBI·ln2 (exponential assumption; logistic fit over graded
scenario lengths later) — THE engine headline number, tracked per engine version.
autonomy_ratio = engine-executed actions / total actions (→ 1.0).
```

### 2.7 Field task score (CARLA-shape composite, LINEAR penalties — exponential was
gamed by stopping early)

```
TaskScore = completion · 1/(1 + Σ c_j·n_j)
death 10 | protected block 5 | drops abandoned 1 | torch-law 0.5 | base-path damage 0.5
| chat-backlog spam 0.2
```

### 2.8 Token economy (per shift, per driver, per A/B arm)

Source: teammate transcripts (`~/.claude/projects/<slug>/<session>/subagents/*.jsonl`),
NEVER driver self-reports (a model cannot observe its own usage). **Dedupe rule:
group assistant rows by `message.id`, keep max `output_tokens` — summing rows
over-counts ~2.5×.** Join to tasks by ISO-interval via `roster.json`.

```
cost_amortized = shift_usd / |ok|            ← the headline; robust; cross-driver
cost_attributed(T) = Σ usd of turns inside T's interval   ← finds expensive task shapes only
think_share = overhead_usd / total_usd       ← the thesis test; should FALL as engine absorbs work
TPB = tokens / items banked ;  CPS = tokens (or $) / verified success
cache_ratio = cache_write / cache_read       ← per-driver context-hygiene index
```

Known baseline (2026-08-31 shift, measured): $287/2.6 h fleet, $0.79/attempt, 71 %
cache-read, 10.6× per-driver spread. Output tokens are 0.26 % of the bill — "poll
less" is a rounding-error optimization; context size per turn is the lever. Dollar
figures are a cost-equivalent index (subscription session), printed as such.

---

## 3. Telemetry schema (FINAL — supersedes both drafts)

**Conflict resolution:** eval-methodology proposed `logs/<bot>.events.jsonl` (~75
lines in runner.js); eval-instrumentation fully specified `telemetry.js` +
`logs/metrics-<bot>.jsonl`. **Decision: adopt the instrumentation spec verbatim**
(eval-instrumentation §3–§5) — it subsumes the methodology sink and adds spans,
counters and the classifier — **plus the four methodology requirements folded in**:
`task_start` written BEFORE kit preflight (dangling start → `unresolved` on next
launch); engine/payload versions on every `session` record; `tpsBefore`
(`bot.time.age` delta, ≥60 s window) as a field and SPC channel; `pollsPerTask` /
`evalsPerTask` counters keyed on `currentTask.id`.

Architecture (binding):
- **One writer**: `telemetry.js` (CJS) required by `runner.js` module scope, exposed
  as `globalThis.__metrics`; payloads call it optional-chained in try/catch, no-op
  when absent. Survives reconnect and re-injection (globalThis, not the bot object).
- `fs.createWriteStream` append-only; **never `appendFileSync`** (the queue advance
  at skills.js `_onTaskEnd` is strictly synchronous). Rotation at 32 MB. Flush on
  exit/SIGTERM/bot end.
- **Required same-commit fix**: runner.js `orphanedGoto` must derive its threshold
  from `__metrics.pathListeners` (a real property), or the permanent `path_update`
  listener turns the leaked-goto detector into a stuck alarm. Never hardcode `> 2`.
- Envelope: `{v, t, bot, run, seq, ev}`; `(bot,run,seq)` unique; seq gaps are
  reported, never silently absorbed.
- Event types (closed set): `session connect task_start task_end goto wedge dig_batch
  tool_break danger panic death craft chest guard note`. Full field schemas:
  eval-instrumentation §4.3–§4.10.
- Sampler: ONE 500 ms timer (odometer + damage; consistently biased ⇒ valid for
  comparison, absolute path length is a stated lower bound). No per-tick listener,
  no per-replan record (aggregate into the goto span), no new chat lines, no
  database. ~480 KB/bot/shift; always on, no off-switch to forget.
- Read paths: `GET /metrics` (in-memory rollups, token-cheap) + `metrics.mjs`
  offline aggregator (`--tokens --group driver`, `--ab` emits the goto2 CSV,
  `--baseline` diffs against a saved run = the field regression gate).
- `roster.json` (bot → port → role → driver) ships in the same commit; runner falls
  back to it when `--role` is absent — closes the open idleguard role-map FEEDBACK item.

Why this is urgent: today `S._history` is a 6-slot ring, `S.log` a 100-line ring,
both wiped on reconnect; runner logs goto requests and zero responses; dead/wedged
bots stop emitting — survivorship bias in the worst direction (a version that kills
bots produces FEWER bad records). Denominators must come from attempt-time records.

---

## 4. Benchmark suite (FINAL specs + cadence + thresholds)

Adopted from eval-benchmarks with two amendments from eval-methodology (below).

**Bench bot**: MesswurstManni:3110, spawned WITHOUT idleguard for measured scenarios
(idleguard `stop()`, not `pause()` — the stall-buster ignores pause), WITH the full
production stack for the AS soak. Harness = `bench/bench.sh` (bash+curl+jq, task.sh
idiom), zero LLM tokens per run. Engine code must never special-case bench
names/coords/ports (auto review reject). Survival-legal only; all facilities
BASE.md-registered (`bench_pad_1`, `bench_locker_1`, `bench_quarry_1` SE scrub y=40,
`bench_arena_1` in DIGTEST_1). Full specs: eval-benchmarks §1–§6.

**Scenarios**: GG goto gauntlet · MP mining plot (vein:false, 32 stone, lane ledger)
· BP build pad (hut5 smoke, cabin suite, demolition/reclaim) · SD survival drill
(T1 mechanical `__survival.drill()` probes per bump; T2 live-mob weekly) · FC farm
cycle (opportunistic, becomes farmCycle's acceptance test) · AS 8 h autonomy soak
(weekly + after any queue/idleguard/runner change).

**Amendment 1 — GG allocation (conflict resolved).** eval-benchmarks specified 6
curated routes × 5 pairs; eval-methodology proved repeats within a route carry ≈ zero
information and R=5 cannot reach p<0.05. **Decision — two modes:**
- *Regression mode (default, nightly/smoke)*: the 6 curated routes from
  goto2-ab-plan run at **1–2 pairs each** as standing fixtures — they answer "did a
  known-hard case break", a deterministic question. R2's 60 s ceiling is frozen
  forever. R1/R5/R6 capability cases additionally become Tier-0 fixtures (N=1).
- *Statistical mode (`--ab`, when an adoption question is live)*: **8–12
  seeded-random routes per class × 2 trips (out+back) × 2 arms, ONE class at a
  time**, ABBA ordering (not ABAB — ABBA cancels linear drift exactly), preceded by
  a **16-trip A/A run** (validates the harness; yields the σ every power calc
  needs). Analysis: cluster bootstrap over routes; SPRT (π₁=0.8, ±ln 19) capped at
  the trip budget, INCONCLUSIVE is a valid result. Pre-registered `analysis` block
  in the course file before trip 1; voids are pre-treatment only, void rate reported
  per arm; never exclude on post-treatment variables (mob attacks are part of the
  treatment effect).

**Amendment 2 — Tier-0 fixture suite is a scenario in its own right** (the first
one built): `bench/fixtures/` with one JSON fixture per shipped FEEDBACK entry —
wedge-torch, wedge-leaf-litter, wedge-chest-gap, false-success-emptypath,
stop-poison, orphan-goto, staircase-1level, tool-break-silent, craft-void,
digguard-protected, payload-persist, chop-canopy. Convention: every entry flipped to
`shipped(vN)` gains a `test:` line naming its fixture, and **the OTHER engineer
writes the assertion** from the entry text. Runs in 3–5 min, N=1, zero false alarms.

**Cadence + gates (the ladder, sized to detectable effect):**

| Tier | What | Cost | Detects | Blocking |
|---|---|---|---|---|
| 0 Smoke | fixtures + payload/movement asserts + BP hut5 + SD-T1 + GG R1/R2/R4 ×1 | ~15–75 min | breakage | HARD block on version bump |
| 1 Gauntlet | statistical GG mode, same-session old-vs-new | ~45 min | ≥25–35 pp | blocks; reports INCONCLUSIVE when CI too wide (escalates to Tier 2, never masquerades as pass) |
| 2 Canary | one bot, ≥30 min PRE-REGISTERED work, SPC-monitored | ~30 min | ~10–15 pp | blocks fleet rollout |
| 3 Fleet SPC | EWMA (λ=0.2)/CUSUM (k=δ/2, h=4–5σ) on the ledger stream | continuous | ~5 pp over hours | auto-rollback + page; zero-tolerance channels (falseSuccess, protected damage, death) fire on first event; others need 2 consecutive alarming epochs |

Rollout mechanics: every ENGINE_VERSION bump ships `bench/gates/skills-vN.json`; the
rollout manager REFUSES an ungated version; `engine/skills.vN.js` + `CURRENT` pointer
makes rollback one command and same-session baselines possible (never gate against a
stored historical number — both arms measured in the same session, same course
version, same bot). One version number per merged change set; the engineer who wrote
a change does not write its gate assertion. Flaky gates: >5 % flake ⇒ quarantine;
a failed gate re-runs EXACTLY once and both results are recorded.

**HARD triggers** (any occurrence = REGRESS + ROLLOUT BLOCKED): deaths on a standard
course; falseSuccess > 0 anywhere; protectedViolations/digsRefused > 0; unwarned tool
break; dropsLeft > 0; kit preflight accepting a half-kit; soak staleAfterReconnect > 0.
**SOFT triggers** vs anchor: eval-benchmarks §8.2 table (arrival −10 pp/class,
−5 pp overall; accuracy/yield −3 pp; durations +25 %; wedges > anchor+2; detectMs
> 1 s; idle > +3 pp; chat lines > 2× anchor). Median `evalsPerTask` rising >25 % on
flat SR also fails the gate — autonomy is the product.

**Acceptance bars for GOAL.md pillar DONE** (two consecutive green FULL suites on two
engine versions; DONE reverts to WORKING on later REGRESS): eval-benchmarks §9 table
verbatim (goto ≥95 %/≥90 % per class + zero wedges/FS/deaths; mineLane 10 clean runs;
hut5 100 %/cabin ≥98 %, waste ≤10 %; survival T1 7/7 ×2 + T2 10 encounters 0 deaths;
soak 8 h idle ≤5 %, 0 interventions, 0 tokens). Once the staging world exists, add
**pass^5 ≥ 0.9 on the golden-scenario library** to each bar.

**Staging world** (phase 2, blocked on a JRE — none installed; HeadlessMc 2.10.0
pinned in movement-engines.md §3 bundles its own runtime): local fixed-seed server,
snapshot/restore, gamerule profiles per benchmark family. Buys ~5–8× trips/hour,
~3–5× duration-SD reduction (≈10× effective N), legal destructive tests. It buys
reduced variance, NOT determinism, and is not a substitute for live external
validity — staging answers "did the change work", the live fleet answers "does it
survive contact".

---

## 5. Statistical method (binding rules)

1. **Pair on route, block in time** (≤90 s between arms of a pair), ABBA order.
2. **Cluster bootstrap over routes** (10 000 resamples) is the one analysis tool for
   every metric; report R next to every interval. Per-arm rates: Wilson, never Wald.
3. **One pre-registered primary endpoint per campaign**; everything else descriptive
   (CIs, no p-values); Holm–Bonferroni if per-class decisions are required. Absolute
   bars (deaths=0, FS=0, protected=0) are specification compliance, exempt from
   multiplicity.
4. **Durations on the log scale; censoring honest** (RMTT@τ or KM; never impute the
   ceiling). CUPED on duration only (route history, tps, distance) — pre-treatment
   covariates only.
5. **α/β from the cost of being wrong**: opt-in escape hatch = descriptive majority,
   no test; per-class fallback = α 0.10 one-sided/70 %; fleet default or engine ship
   = α 0.05/80 % + absolute bars; rollout gates = non-inferiority at the margin the
   trip budget honestly supports (32 trips ⇒ ~10 pp; 5 pp needs 444/arm — route small
   effects to Tier 2/3 instead of inflating the gauntlet).
6. **A/A before any A/B.** 16 trips, same engine, two labels. It is where σ comes from.
7. **Sequential stopping**: SPRT capped at budget; 5 unanimous discordant pairs from
   5 different routes is the one-sided p<0.05 floor.
8. Field comparisons when a controlled run is unaffordable: interrupted time series
   (≥20 pre-epochs) or staggered rollout diff-in-diff (free — payload injection is
   per-port); switchback for per-task-toggleable parameters (30-min epochs,
   epoch-clustered SEs, 5-min washout).
9. Formula sheet: eval-methodology §13. Reference constants live there too.

---

## 6. ALGO.md scoreboard (format frozen)

`ALGO.md` (repo root, next to SCOREBOARD.md) ranks **algorithms per engine version**;
SCOREBOARD.md ranks **drivers**. Never conflate (separate selection pressures,
separate pipelines — law 5). Rows are appended ONLY by `bench/lib/algoboard.sh`;
humans edit only `notes`. One table per algorithm (goto, mineLane, buildSchematic,
survival, farmCycle, autonomy floor) + the MP lane ledger. Verdicts:

```
BASELINE  first ever full-suite row for the algo (comparison anchor)
PASS      full suite, no trigger, not better
RECORD    strictly better on ≥1 KPI, worse on 0 → becomes the new anchor
REGRESS   any HARD trigger, or any SOFT trigger vs anchor
INFO      smoke rows (smoke never moves anchors — a lucky 25-min run can't raise the bar)
```

On REGRESS, `bench/lib/regress.sh` auto-appends a deduped FEEDBACK.md entry
(reporter `bench-harness`, one per (algo, kpi, engine_v); re-observations get a
`seen-again:` line) and files a `gh issue` on felsenuboot/felcrew-mcp with labels
`regression,bench`; a SMOKE regression exits nonzero and prints ROLLOUT BLOCKED.

Column sets per table: see the seeded `ALGO.md`. Raw data stays in
`bench/results/*.csv` (append-only, committed) keyed by `(ts, engine_v)`.

**SCOREBOARD.md repairs** (both tracks agree; apply on next scoreboard revision):
deaths sourced from `<death>` log lines (independent instrument, never self-report);
credit deduped root-cause CLUSTERS, not entries (`cluster:` field at triage);
credit verified corrections/retractions at the same rate as new findings; normalise
per bot-hour; add a risk-adjusted output term (deep-work hours, p90
distance-from-base); publish the denominator next to every ratio; `cost_per_ok` and
SR are inputs to judgment, never the whole formula.

---

## 7. Implementation plan (owners + sequence)

### engine-dev-2 — telemetry layer + metrics.mjs (~750 new lines, one pass;
detailed steps: eval-instrumentation §8)

| # | Item | Notes |
|---|---|---|
| E1 | `telemetry.js` (CJS, ~280 lines): writer, 500 ms sampler/odometer, listeners, tool-break watcher, routeClass, adg/SALIENT/INV_KEYS, outcome classifier | verify: idle bot writes session+connect only |
| E2 | `runner.js` (~25 lines): install in createBot (once per instance, NOT in spawn), `GET /metrics`, tps proxy, pollsPerTask/evalsPerTask, roster.json role fallback, **orphanedGoto fix via `__metrics.pathListeners` — same commit, non-negotiable** | verify: `/state .orphanedGoto` still false on idle bot |
| E3 | `skills.js` (6 call sites, ~45 lines, no logic changes): task_start BEFORE kit preflight; kit-rejection emits task_end; ASSERTS + emit in the IIFE before `_onTaskEnd`; goto span in ctx.goto's finally; wedge in `_unstick`; craft event | verify: kit_missing appears in the denominator |
| E4 | Guard hooks: dangerscan transition emit, survival panic emit; idleguard/digguard/reachguard read-only via the 60 s diff rollup (no edits) | |
| E5 | `roster.json` + `metrics.mjs` (~380 lines): formulas §2 above, `--tokens` (message.id dedupe!), `--ab`, `--baseline` | verify: reproduces the measured $287/§6.6 table |
| E6 | `engine/skills.vN.js` + `CURRENT` pointer; gate report `bench/gates/skills-vN.json`; DRIVER_GUIDE one-liner ("no fleet rollout until smoke is green on 3110") | rollback = repoint + restart |

Post-landing checklist: eval-instrumentation §8 (wedge a bot deliberately, kill -TERM
mid-task, etc.).

### curator — benchmark facilities, cadence, ALGO.md upkeep

| # | Item | Notes |
|---|---|---|
| C1 | BASE.md `planned` rows for bench_pad_1 / bench_locker_1 / bench_quarry_1 / bench_arena_1 (arena deferred to first SD-T2 week); then course builds VIA A DRIVER (pad + locker + stock ledgered from depot; quarry staircase + frozen stratum, siting-day y verify — walked, never remote blockAt) | protected.json entries so digguard defends them |
| C2 | `bench/` harness: bench.sh, lib/{trip,assert,row,algoboard,regress}.sh, soak-watch.sh, routes.json, fixtures/ (the 12 Tier-0 fixtures, seeded from FEEDBACK) | pure bash+curl+jq; refuses wrong bot name on 3110 |
| C3 | First FULL suite on current engine → BASELINE rows into ALGO.md; commit bench/results/ | one evening |
| C4 | Cadence running: smoke per version bump (pre-rollout), FULL nightly, AS soak + SD-T2 weekly, anchor re-verify on >20 pp swings | coordinate the one spare client slot with engine-dev |
| C5 | ALGO.md upkeep: verdicts via algoboard.sh only; lane ledger; notes column; create GitHub labels `regression`, `bench` (via issue-manager) | |

### FEEDBACK entries to file (curator files; engineers pick up)

1. feature-request: `__survival.drill(branch)` test hook (~15 lines) — standardizes
   engine-dev's ad-hoc SD-T1 probes.
2. feature-request: queue `loop`/`onEmpty` re-seed option for the AS soak
   (workaround: soak-watch re-seeds on `queue.n==0`).
3. feature-request: telemetry ledger (E1–E5 above) — the tracking entry engine-dev-2
   flips to shipped; explicitly notes the orphanedGoto companion fix and the
   `task_start`-before-preflight requirement.
4. bug: runner.js logs goto requests but never responses (10-line fix independent of
   the full ledger, in case E-track slips).
5. Flip/annotate the existing "per-port role map for idleguard" entry — closed by
   roster.json.

### GitHub (via issue-manager)

Mirror entries 1–4 as issues; create labels `regression`, `bench`; wire regress.sh's
`gh issue create` dedupe.

### Deferred (phase 2, explicit non-goals for this pass)

Staging world (needs JRE decision — HeadlessMc bundled runtime avoids a system
install); SPC daemon for Tier 3 auto-rollback (needs the ledger first); golden
pass^5 CI on the staging world; SCOREBOARD v2 (needs a user decision on the formula);
T50 headline chart (needs MTBI data to accumulate); surrogate–death validation pass
(re-run every time the death count doubles).

---

## 8. Anti-Goodhart register (carried forward, binding)

- Linear penalties only (CARLA gamed exponential by stopping early).
- MTBI/MDBI comparable only on matched activity classes.
- pass@k flatters; the fleet feels pass^k. Report both, gate on pass^k.
- `arrivalRate` is gameable by failing fast / widening goal range ⇒ mandatory
  counter-metrics: medianTargetDistance, attemptRate, goalRange on every row;
  `assertionHash` per version (a changed assertion invalidates cross-version SR).
- Denominators from attempt-time records, never observed-outcome counts.
- No metric without its denominator in the same table; n<5 cells suppressed.
- Counters that can double-count (torch re-placement) are telemetry; conservation
  invariants are the economy.
- Never adjust for or exclude on post-treatment variables (mob attacks are outcome).
