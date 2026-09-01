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

## The false-success root (why law 1 exists, added 2026-09-01)

"Reporting success you haven't earned" recurs at every altitude — task, project, tool,
restock, payload-presence, goto-arrival — because each layer trusts the layer BELOW's
word for it. The fix is always the same shape: GRADE WITH SOMETHING THAT DIDN'T DO THE
WORK. That's why exporting `assertTask` (one shared verifier used by BOTH the agenda's
project-completion check and the telemetry ledger's task-level check) mattered more
than any single bug it fixed — it's the same principle applied one layer up, closing
the class rather than one instance of it. Every false-success finding logged this
session, from `come` claiming arrival it never reached to the agenda marking a project
done that a `safeDescend` never actually descended, is this one root cause recurring at
a different altitude. When auditing a NEW layer of the stack, ask first whether it's
grading itself — if so, assume it lies under exactly the conditions that matter most.

**The sharpest instance yet, and the corollary it forces (engine-dev-2, 2026-09-01):**
`assertTask` graded EXACTLY what it was handed, honestly and correctly — `mineLane`
was marked "VERIFIED done" against `produce`'s own passing assertion — and the
result was still a false success, because the defect was upstream of the verifier
itself: `A.activeTaskId` pointed at the wrong task by the time grading happened
(§9 C4's hardening note has the full sequence). **A verifier only protects the
layer it is actually pointed at.** Grading with something that didn't do the work
stops that something from lying about ITS OWN result; it does nothing to stop an
upstream defect from handing the verifier the wrong thing to look at in the first
place. Both halves are load-bearing: an honest verifier pointed at the wrong task
is exactly as false a success as a dishonest one pointed at the right task — so
auditing a new layer means checking BOTH "does this grade itself" (the original
question) AND "is what reaches the grader actually the thing that did the work"
(this one).

**Measurement isolation — the same invariant applied to the act of measuring
itself (engine-dev-2, 2026-09-01):** "one thing drives the body" isn't only a
runtime rule; it governs verification too, and violating it can MANUFACTURE a
phantom defect rather than just miss a real one. Incident: measuring
`ensureTool`'s material use by running it by hand while the agenda's `TOOL` rung
was ALSO running its own acquisition — two things driving one body — produced an
alarming number (46 cobblestone apparently vanishing), one step from a reported
item-loss bug that does not exist. Root cause: `A.busy=true` is NOT isolation —
it stops the ladder from starting NEW acts, not one already running underneath
the measurement. `__agenda.stop()` is real isolation. Re-run from a known
inventory with the ladder actually stopped: clean. **To measure or verify a
skill's behavior on a live bot, stop the ladder first (`__agenda.stop()`), never
just set a busy flag** — a second driver on the same body contaminates the
numbers before any conclusion is drawn, exactly like the wedge cluster taught
one layer down (group by cause before concluding), just applied to the
measurer's own setup instead of the engine's runtime.

**Refinement — stopping is necessary but NOT sufficient (team-lead, same day):**
the rule above answers one question and a second, DIFFERENT question needs the
opposite setup. **STOP the ladder when measuring a SKILL in isolation** — the
rule just stated. **DRIVE with the ladder when the question is what the LADDER
does** — hand-calling the skill proves the CAPABILITY exists while bypassing the
rung's `fire()`, which is the very decision under test. The case that forced
this half: engine-dev-2 hand-called `ensureTool(..., {spare:true})` twice,
watched pickaxes go 0->1->2, and reported an agenda stall as "does not
reproduce." Both observations were true and the conclusion was still wrong,
because the broken part was the CALLER (`TOOL.fire()` returning false whenever
no tool class resolved, so the kit's `picks` requirement was aimed at by
nothing) not the callee — testing the capability is not testing the caller. The
two rules compose rather than compete: pick the one that matches the question,
and STATE WHICH ONE WAS USED when reporting a result, because they answer
different questions and are not interchangeable.

**Testability is a property of the code, not of the test (engine-dev-2,
2026-09-01):**

> "A rule that can only be tested by staging a live bot will not stay tested."

The case: `payableTier` decided which tool tier the bot could afford by reading
`bot.inventory` directly, so every test of it was a live-bot staging exercise —
which meant it never got one, and it shipped a bug that summed plank stock
across wood types when a tool head needs three of ONE. A bot holding
`oak_planks:1 + acacia_planks:2` was told a wooden pickaxe was payable (3>=3
pooled), crafted zero, and never fell through to the stone pickaxe it could
have made instantly from 297 carried cobblestone — a terminal deadlock that
cost a full soak run and thirty minutes of ledger forensics to find. The fix
was not a better test, it was a purer function: `tierFrom(items, need,
tableInReach)` (`skills.js:1260`) takes its inputs as arguments; `payableTier`
is now a thin wrapper supplying them from the live bot; `S.tierFor` (line 1308)
exports the pure form. Eleven cases now run against synthetic inventories in
about a second, covering the whole class — mixed woods falling through to
stone, the honest negative (mixed woods with no cobble are payable by NOTHING
rather than by a wooden lie), per-species log counting, table/stick costs
entering the bill. Same injectable-snapshot rule `__agenda.step()` already
lives by, which is why that rule was worth having in the first place. **The
generalisable form: when a decision is hard to test, the usual cause is that it
reaches for state instead of receiving it — fix the reach, and the test becomes
trivial.**

**The three verification lessons, and the one before them, are the same shape
one layer apart** (engine-dev-2's own synthesis, worth keeping verbatim): a
verifier only protects the layer it is actually POINTED at (the false-success
root's corollary); a test that STUBS what it depends on cannot tell you it is
there (measurement isolation — stop to test a skill alone); testing the
CAPABILITY is not testing the CALLER (the drive-vs-stop refinement — drive with
the ladder to test the ladder); and now, a decision that reaches for its own
state instead of receiving it can only ever be tested by staging the world it
reaches into (testability-by-purity). Each time, the thing being checked was
fine and the thing doing the checking was aimed slightly wrong. Together these
five are the verification-hygiene set.

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

---

## 9. Phase-1 acceptance soak — pre-committed scoring rubric (2026-09-01)

Binding thresholds for the un-fixtured acceptance run (agenda v6 + skills v28 +
producer.js + telemetry SCHEMA_V=2, launched once RESTOCK's produce-fallback is
wired), committed BEFORE the run per felsenuboot/felcrew-mcp#28's five criteria —
pre-committing success is the anti-self-flattery discipline law 1 exists for, and it
is what makes pass/fail objective the moment the run ends rather than negotiable
after the numbers are in. Distinct from §4's general-purpose AS soak scenario (which
this rubric supersedes for the phase-1 acceptance question specifically, though the
harness is the same). #3 and #5 are written as deterministic procedures the soak
executes, not hand-driven steps, so the result is reproducible.

**Every criterion below is scored against a specific committed source of ground
truth, named per criterion — never the agenda's own self-report alone (law 0's
"grade with something that didn't do the work," §"The false-success root").**

**Scoring method (team-lead, hardened by two runs where trajectory lied and the
outcome enum didn't): grade off the OUTCOME ENUM, never off how the run LOOKS.**
Evidence: a 30-minute run looked healthy for its first 6 minutes, then rotted —
trajectory said "fine" long after the tally would have said otherwise. Separately,
a run that LOOKED like it was drifting to the surface (position climbing,
apparently abandoning its depth) had a `mineLane` outcome tally that said
`ok:1` — it had genuinely completed — and engine-dev-3 correctly reversed an
initial "failure" read once they checked the tally instead of the trajectory.
Both times the visual shape of the run lied and the outcome enum was honest.
Concretely: **C4 grades on the project skill's `task_end` records with
`outcome:"ok"` (§ its own section, now including the task-identity check), not
on position or apparent trajectory. C1 grades on the death signals (§ its own
section), not on how active the bot looks. C3/C5 grade on the rung-transition
and recovery OUTCOMES in the ledger/log, not on watching the bot move.** A run
that looks like it's mining but produces zero completed attempts is a fail; a
run that looks like it's wandering but the tally shows real completions is not.
Same anti-self-flattery discipline as the coverage metric (a clean-looking FSR
over thin coverage) — a compelling-looking run is not evidence, the tally is.

**Step 0 of launch (MANDATORY pre-flight, before any induced-stress procedure
below): run the dry-run regression suite** — `bench/fixtures/agenda-ladder.js`
(21 cases, includes 2 weapon cases) + `bench/fixtures/agenda-deepkit.js` (9 cases)
+ `assert-produce` (5 cases) = 35 cases total, all through `__agenda.step()`
(dry, executes nothing, safe on a live bot, ~1 second). Confirms the current
payload stack is genuinely clean before spending 3+ hours measuring it — this is
the exact class of bug ("payload drift / stale injection") that has bitten this
project four separate ways this session. All 35 must be green; a single red case
here means fix that first, not launch around it.

### C1 — Survives (hard gate)

**Pass**: zero deaths across a continuous ≥3h window on ONE stable agenda version
(no restart mid-window; a restart resets the clock).

**Difficulty (DECIDED, team-lead, revised from the original draft)**: the soak
runs on NORMAL difficulty, not Peaceful. Found live in the C3 dry-run: Peaceful
disables hunger depletion entirely (confirmed: 40s of a hunger effect plus 50+
blocks of forced real movement produced zero food change), which would make this
criterion vacuous — nothing threatens the bot, so "survives" proves nothing. Normal
makes C1 a genuine test (real mob threats, real hunger drain) and, as a bonus,
finally exercises the `survival.js` branches GOAL.md flags as unproven-live —
`CREEPER` retreat is confirmed, `BREAK_LOS` has never faced a live mob. A death to
a creeper or a fall on this run is a legitimate C1 FAIL and a real `survival.js`
finding, not a fluke to explain away. Team-lead provisions a generous food buffer
(~128 cooked) at launch so C1 isn't failed on ordinary starvation — this
deliberately isolates the tool/torch self-sufficiency axis being measured
elsewhere (food-production stays its own deferred question); if the buffer runs
low anyway despite 128, THAT is a real, separate food-production finding worth
its own report, not folded into C1's pass/fail.

**M0 cross-references (#51, frozen 2026-09-01)**: the food buffer above is the
concrete instance of M0's food carve-out — "un-fixtured" means from-nothing on
tools/torches/kit, food is explicitly excepted for Arc A (#45's huntAnimals
gate bug, retired at M7/#61), so provisioning this buffer is not a scope
violation. Duration: `>=3h` is the pass gate, `8h` the pillar bar — the "full
>=3h window" language throughout this section is the gate, not a compromise
figure. **#40 (undiagnosed ongoing environmental damage at a fixed underground
spot) is a live risk to THIS criterion specifically** — diagnose it (capture
the #20 signature if it recurs) or confirm the soak's chosen work zone avoids
those coordinates before scoring a window as a real C1 attempt.

**Ground truth, two independent signals, BOTH required — corrected after checking
telemetry.js directly rather than assuming a periodic sample would catch it**: (a)
zero standalone `ev:"death"` records for the window (`telemetry.js`'s
`bot.on('death', onDeath)` — a real mineflayer client event, fired the instant a
death happens, structurally independent of whether any task is running; this is
the primary signal, not the periodic `note` stream, which samples every ~10-40s and
could miss a death that happens and respawns between two samples); (b) zero
`outcome:"death"` `task_end` records (`classify()`'s `s.deaths > 0` branch) for
whichever task, if any, was active at the time — a corroborating secondary signal
when a task happens to be running, not the primary one. Disconnection/reconnection
during the window is NOT a violation of this criterion by itself (network/server
flakiness isn't the bot's fault) — only an actual death is.

### C2 — Zero false-success, with a coverage floor

**Pass**: FSR = 0 (inherits law 1's existing hard target — no new number invented)
AND coverage ≥ 70% AND gradable n ≥ 20. **A clean FSR over thin coverage is
explicitly NOT a pass** — 0/0 reads like triumph and means nothing (§8).

**Coverage definition (DECIDED, team-lead)**: coverage = gradedN / gradableN
where gradableN = count of `v>=2` `task_end` records **whose skill has an
ASSERTS table entry** (currently: come, safeDescend/buildStaircase, mineLane,
chopTrees, huntAnimals, collectDrops, depositToChest,
buildWall/Floor/frameStructure/buildSchematic). The ASSERTS registry IS the
definition of "gradable" — restock/ensureTool have no entry because they're
graded by their own rung's `clear()` condition instead of a task-level
assertion, so they're ungradable-BY-DESIGN, correctly excluded, not a gap.
metrics.mjs's current `gradableN` (as of commit 6513682) counts ALL v≥2
`task_end` records rather than just ASSERTS-having ones — for THIS FIRST
scoring, compute coverage BY HAND from the ledger (filter to the ASSERTS-table
skill set above, the registry is the source of truth) rather than trusting the
tool's own number, so the RESTOCK-wiring critical path isn't interrupted for a
metrics.mjs change; coordinate the automation with engine-dev-2 directly once
that wiring lands, so future scorings read it straight from the tool (same
"make the honest reading automatic" family as the wedge-grouping and n<5
suppression already built). 70%-floor and n≥20 are not new numbers either —
they mirror the `--gate` mechanism's existing SR-floor and sample-floor
exactly, for the same reason: an established, already-scrutinized bar beats a
freshly-invented one. **Numbered per #51/M0**: this 70%/n>=20 pair IS the
frozen coverage floor referenced there — stated once here in full, not
duplicated. Within it, any individually-REPORTED breakdown cell (per-skill,
per-outcome) still needs its own `n>=5` to be shown at all rather than
suppressed, same anti-Goodhart rule as everywhere else in this doctrine (a 1/1
reads like triumph). FSR=0 over 0/0, or over a suppressed cell, is not a pass.
**Separate from this scoring, tracked apart** (team-lead): a skill that
SHOULD have an assert but lacks one would be silently excluded by this filter
without anyone noticing — that's an engine-quality audit question (does every
gradable-in-principle skill actually carry one), not a soak-scoring one. See
the FEEDBACK.md entry filed alongside this rubric lock.

### C3 — Priority order under induced stress

**Induction** (deterministic RCON/eval procedure, run once against a healthy,
un-blocked bot mid-PROJECT):
1. Hunger, closed-loop (not a blind single command — vanilla's hunger drain rate
   varies, so verify rather than assume): `effect give <bot> minecraft:hunger 30 5`,
   then poll `data get entity <bot> foodLevel` every 5s; repeat the effect if still
   `>6` after 30s; stop once `foodLevel<=6` (this is `EAT_CRITICAL`'s own fire
   threshold, `agenda.js:273` — food<=6 specifically, not merely "hungry", since
   `EAT_CRITICAL` (prio 2) sits ABOVE `DEPOSIT` (prio 3) while regular `EAT` (prio 4,
   food<=17) sits below it — the induction must hit the CRITICAL threshold or the
   expected order below is wrong). **The bot must also carry food to eat**
   (`s.foodCount > 0` is a SEPARATE half of `EAT_CRITICAL`'s fire condition —
   `give <bot> minecraft:bread 4` alongside the hunger induction, or low food alone
   will never fire it). **Peaceful-difficulty caveat, found live in the dry run**:
   this mechanism does nothing on Peaceful (vanilla disables hunger depletion
   entirely there — confirmed: 40s of Hunger V plus 50+ blocks of forced real
   sprinting produced zero food/saturation change on the local bench server, which
   runs Peaceful). It is expected to work correctly on the acceptance soak's actual
   Normal-difficulty world (team-lead's launch decision, made partly BECAUSE of
   this finding — see C1). Not re-verified live on Normal yet (would require
   flipping the shared local server's difficulty ahead of team-lead's own
   deliberately-sequenced launch, so deferred rather than done unilaterally) — spot
   check this step specifically once Normal is live, before trusting a full run.
   **A faster client-side alternative exists for spot-checking the WIRING only, do
   NOT use it for the graded run**: `bot.food = 6` via `/eval` fires `EAT_CRITICAL`
   correctly (verified: `sense()` reads `bot.food` directly, `agenda.js:132`) and is
   difficulty-independent, but it is a purely client-side lie — the server's own
   `foodLevel` stays untouched (confirmed: stayed 20 throughout), so eating bread
   against it consumes the item with NO food recovery (the server thinks the player
   is already full and has nothing to restore), meaning `EAT_CRITICAL`'s CLEAR half
   of the hysteresis cycle (food climbing back to >=19 via real eating) cannot be
   observed this way. Use it only to confirm a rung's fire-condition wiring in
   isolation, matching survival.js's `runBranch`/`drill()` fabricated-input
   convention — never as a substitute for the real induction in a scored run.
2. Toolless (scoped to the active project's tool class, e.g. pickaxe for a mining
   project — that's what actually gates `TOOL`'s fire condition, `activeClass(s)`):
   `clear <bot> minecraft:wooden_pickaxe`, then repeat for stone/iron/golden/
   diamond/netherite_pickaxe (six calls, one per tier) so no fallback tier survives.
3. Full inventory, to `freeSlots<=2` (`DEPOSIT`'s exact fire threshold,
   `agenda.js:278`): `clear <bot>` (known-empty baseline), then `give <bot> <item> 1`
   for 35 DISTINCT non-stacking-together item ids (dirt, cobblestone, gravel, sand,
   andesite, diorite, granite, oak_log, birch_log, stone, sandstone, red_sand, clay,
   netherrack, ... — 35 distinct ids, not 35 calls of the same id, which would merge
   into far fewer occupied slots) — leaves exactly 1 free slot, comfortably inside
   the fire zone rather than sitting on the `<=2` boundary.
4. Dark: build a small sealed stone box via RCON `fill` near the bot's current
   position (no light source, fully enclosed — guarantees `light<8` and
   `surfaceExposed:false` deterministically, rather than assuming ambient darkness
   wherever the bot happens to be) and `tp` the bot inside.

**Pass**: the rung sequence observed in `note` events after induction is
`EAT_CRITICAL -> DEPOSIT -> EAT -> TOOL -> LIGHT` (RESTOCK is skipped in this
specific induction unless the project's floor also demands it — not forced by the
steps above) — in THIS order, each rung's own fire/clear thresholds satisfied before
the next one is allowed to own the ladder, with **no rung firing twice
non-consecutively** (the observable form of "hysteresis holds" — a genuine
oscillation would show e.g. EAT, TOOL, EAT again rather than EAT once then moving
on). Ground truth: the `note` stream's `agenda` field across the induction window,
cross-checked against the `"agenda: -> X"` transition log lines for exact fire
order.

### C4 — Project advances to a VERIFIED completion, then clean P3 fallback

**Pass**: a `task_end` record for the active project skill with `outcome:"ok"` AND
`assert` non-null (an ASSERTS rule actually graded it, not merely `task.done` —
`outcome:"ok"` already implies the grade passed, by construction of `classify()`;
`assertFail` itself is an internal variable, never an emitted ledger field, so
`outcome`+`assert` together are the correct, complete check, not a third field to
look for) — i.e. a real `assertTask` GRANT, not a naive `done` claim (the exact
distinction law 1 exists to enforce; a `done:true` with no grant is not a
pass here). Ground truth: the ledger record itself, cross-checked against the
agenda's own `"agenda: project VERIFIED done"` log line (two independent witnesses
for the same claim, matching C1's two-signal pattern). Followed within one tick by
`/state.agenda.rung` reading `IDLE` (or a genuinely new project set) — the project
must not be immediately re-picked or left dangling.

**HARDENED (team-lead, after a real cross-rung false-success engine-dev-2 caught):
a "VERIFIED done" log line is NOT sufficient evidence by itself.** Concrete
incident: the agenda logged `"project VERIFIED done (mineLane,
produce.made(cobblestone,made=24,held=28))"` — `mineLane` marked verified-done,
graded by PRODUCE's own assertion, having never actually run. Sequence: RESTOCK
started a `produce` task -> `produce` finished -> RESTOCK cleared -> PROJECT's own
`start()` was REFUSED (`kit_missing`) -> `A.activeTaskId` still pointed at
produce's already-finished task -> the next tick harvested THAT as the project's
completion, because the harvest checked task OWNER identity, not task IDENTITY.
Fixed in agenda v11: harvesting a completion now requires
`A.activeTaskRung === 'PROJECT'` AND the completed task's name equals the
project's own skill (`agenda.js:629`). **C4 must apply the same check when
scoring**: don't accept the log line alone — confirm, at the moment of the
"VERIFIED done" event, that the task actually being graded belongs to PROJECT
specifically (`activeTaskRung === 'PROJECT'`, surfaced in `/state.agenda`'s
snapshot per `agenda.js:789`) AND that its task name matches the project's own
skill (mineLane/safeDescend/etc.), not merely that SOME task with a plausible
name completed successfully nearby in time. On a v11+ run this is enforced
upstream by the engine itself; scoring it independently anyway is the same
"grade with something that didn't do the work" discipline applied to the
scoring layer, not just the engine layer.

**Project choice, revised per engine-dev-3's calibration (see C5's project
scoping note for the full reasoning)**: the soak's project must be BOUNDED and
completable within the run — e.g. `safeDescend` to a moderate, fixed depth, or a
fixed-count `mineLane` — not an unbounded deep-mine. An unbounded project risks
this criterion never resolving for a reason unrelated to the five criteria being
measured (the known phase-1.5 toolless-at-depth gap), not because anything here
failed.

### C5 — Self-recovery from an induced wedge, a forced relog, and a recoverable tool-break

**Wedge induction**: on a KNOWN-SAFE, solid, hazard-free platform (same discipline
as the Dark step above — build one via RCON `fill` rather than trusting wherever
the bot happens to be; found live in the dry run, see below), while the bot is
actively pathing (mid-`goto`/mid-skill travel), `setblock` a `minecraft:torch` at
the bot's exact current feet position (the documented torch-underfoot wedge
mechanism, LEARNING_HANDOFF.md). **Pass**: the bot's position changes again
(confirmed via `/state.position` polled every 2s) within 30s of the torch landing,
with at most ONE `"stall"`/`"wedge"`-class log line during that window (the
engine's own bounded stall-detector clearing it once, not repeating).
**Why the platform requirement is load-bearing, not cosmetic (found live)**: the
same induction, run first at an arbitrary (not pre-verified) spot, produced a
GENUINE unrecovered failure — three stall-and-unstick attempts, an outer retry,
task failure after 2 full attempts, bot never moved. Investigating why: the
nuisance-dig recovery attempts had dug into an adjacent, previously-hidden water
pocket underground, leaving the bot floating in water — a confound from the
TEST SITE, not a torch-wedge-recovery defect. Rerun immediately after on a
freshly-built, verified-solid, water-free platform: the same induction cleared
with ZERO stalls, arriving cleanly. The `at most ONE stall` threshold is correct
for a properly-controlled induction; it is NOT safe to run this step against an
unverified location, for the same reason the Dark step doesn't trust ambient
darkness.

**Relog induction**: `kick <bot> "induced acceptance-test relog"`. **Pass**: (a)
`/state.connected` reads `true` again within 30s; (b) `/state.payloads` reports
every payload installed with `stalePayloads` EMPTY (not just present — the
guard-stripping class of bug this session's doctrine work was largely about, see
DRIVER_GUIDE's SUSPENDING IDLEGUARD note); (c) `/state.agenda.ticks` is increasing
again (the ladder resumed on its own) within 60s total from the kick, with no driver
action setting a new project or restarting anything by hand.
**Pre-flight precondition, found live in the dry run (do not skip)**: `agenda.js`
auto-reinjects on reconnect ONLY for a process actually started with `--agenda`
(or `AGENDA=1`) — it is its OWN conditional block in `runner.js`, gated the same
way `idleguard` is gated behind `--role` (`runner.js:277`), not part of the
unconditional payload list. Dry-running this on a bot that had agenda injected
ad-hoc (not via the real spawn flag) reproduced `stalePayloads:["agenda"]` after
the kick — a real, reproducible symptom, but traced to the TEST bot's own spawn
config lacking `--agenda`, not a defect in the mechanism itself. **Before the
real launch, confirm via `ps`/the spawn command that the actual soak bot process
was started with `--agenda`** — otherwise this exact staleness would occur for
real on the graded run and silently fail this criterion every time.

**Recoverable tool-break induction (RE-REVISED — deep-kit provisioning, agenda
v11, makes AT-DEPTH recoverable too, so the earlier near-surface-only
restriction is lifted; see below for the reasoning and what's still excluded)**:
induce the break DURING the project, wherever the bot naturally is — likely at
depth while mining, since that's the realistic case (a mining bot breaks its
tool where it mines). Identify the currently-equipped tool (`bot.heldItem.name`)
and its `maxDurability`
(`bot.registry.items[bot.heldItem.type].maxDurability`) via `/eval`, then
`clear <bot> minecraft:<toolname>` followed by
`give <bot> minecraft:<toolname>[minecraft:damage=<maxDurability-1>] 1` — the
same damaged-item give syntax already verified in
`bench/fixtures/tool-break-silent.sh` — leaving exactly one use before it breaks,
so it breaks on the bot's own very next dig rather than requiring a long wait for
organic decay, and breaks DURING real use rather than being silently swapped.

**Pass**: `/state.agenda` shows `blocked:"no_tool"` clear again (TOOL rung's own
`clear()` condition satisfied — a working tool of the active class re-equipped)
AND `rung` returns to `PROJECT` with the SAME project held, within a generous
bound (10 minutes — a full recovery chain plus real travel time, not the 33s
empty-inventory-right-next-to-a-tree baseline on #30), via EITHER path the
location calls for: in-place recraft at depth (from carried cobble+sticks+table,
the deep-kit provisioning) or wood-gathering near the surface. This tests
whether the engine self-recovers a tool break WHEN RECOVERY IS ACTUALLY
POSSIBLE — a genuine phase-1 self-sufficiency question, now validated in its
realistic setting rather than an artificially easy one.

**Contingent on**: engine-dev-2's tool-break leg + engine-dev-3's re-verify
confirming the in-place recraft is robust. Once those pass, at-depth C5 is safe
to grade; until then, prefer the near-surface variant to avoid grading an
in-flight capability.

**What's still excluded — the pure-strand case stays phase-1.5**: the deep-kit
provisioning covers a tool breaking with MAKINGS still carried (cobble, sticks,
a table, or materials to gather them in place). It does NOT cover the case
where the makings themselves are ALSO absent (no cobble, no sticks, no reachable
wood at all) — that remains the known, expected phase-1.5 gap per
engine-dev-3's original calibration: continuous deep-mining sustainability
without any resupply is a harder, later problem. Inducing THAT specific
starvation-of-materials variant here would still wrongly sink an
otherwise-passing phase-1 run on a gap phase-1 was never scoped to close — only
the ordinary "tool breaks, bot has or can reach what it needs to recover"
scenario is in-scope now. The kit-foresight open question from FEEDBACK.md stays
open and un-speculated-on regardless; if the pure-strand scenario is ever
deliberately exercised (a separate, later phase-1.5 soak), THAT would be the
concrete failure to cite when filing the foresight rung — not this run.

**Project scoping note (applies to C4 as much as C5)**: for the same reason, the
soak's PROJECT must be BOUNDED and completable — e.g. `safeDescend` to a
moderate, fixed depth, or a fixed-count `mineLane` — not an unbounded deep-mine
that would eventually hit the toolless-at-depth wall on its own regardless of
whether this induction ever fires. An unbounded project risks C4 (verified
completion) never resolving for a reason that has nothing to do with the five
criteria being measured, and risks the SAME phase-1.5 gap intruding on the run
by accident even without a deliberate induction.

### Overall verdict

**Phase-1 "done"** requires ALL FIVE criteria MET on ONE continuous, stable-version
run. Any criterion failing is a fail for that run, not a partial credit — this
mirrors the `--gate` mechanism's own mechanical, non-negotiable rule. A run that
fails is still valuable: score it as iteration feedback (which criterion failed,
against which threshold, by how much) exactly as the earlier v3 scorecard entries
did, not discarded.

**Cross-cutting hard-pass conditions (#51/M0, frozen 2026-09-01) — apply to the
WHOLE run, checked before any of C1-C5 even matter:**
- **`tokensSpent=0`** for the entire driverless window. Any nonzero in-loop
  LLM/network spend is itself a finding to report, not averaged away. Measured
  by M1 (#52)'s new hard counter — unmeasured runs cannot claim this yet.
- **Frozen-stack integrity**: `stalePayloads=[]` for the ENTIRE window (not just
  checked once at the start) AND payload versions/checksums read identical at
  window start vs. window end — the injection model re-reads payloads from disk
  on every reconnect, so a mid-soak file touch silently breaks the freeze
  without this check. A run that can't prove the stack stayed frozen the whole
  way through didn't test one stack.
- **Infra-interruption**: a main-server drop mid-window is a VOID + full re-run,
  NOT a C1 fail (infra flakiness is not an engine-determinism finding) — the
  clock restarts, it does not resume from where it left off, since the whole
  point is one CONTINUOUS window.
- **Surprise-LLM boundary**: a single, rare, LOGGED surprise-handling LLM call
  during the window is not an automatic fail (the determinism codicil permits
  genuine judgment calls) — it counts as a real `interventions` entry, not
  silent 0, and is reported as a finding. It only becomes disqualifying if it
  recurs systematically, which is itself the thing to chase down.
- **Capability freeze**: the stack under test must not have gained a new
  capability (skill/rung/gate/produce-path) after the window started — that's
  what "one stable version" in the paragraph above actually means in practice.
