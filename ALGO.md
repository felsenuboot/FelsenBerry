# ALGO.md — Algorithm Scoreboard (bench-written, append-only)

Ranks ALGORITHMS per engine version from deterministic bench-suite KPIs.
(SCOREBOARD.md ranks DRIVERS — different question, different pipeline; never mix.)
Rows are appended by `bench/lib/algoboard.sh`, never by hand except the `notes`
column. Doctrine: `EVALUATION.md` §6. Raw data: `bench/results/*.csv` keyed by
`(ts, engine_v)`. Verdicts: BASELINE (first full-suite anchor) | PASS | RECORD
(new anchor) | REGRESS (auto-files FEEDBACK + gh issue, labels regression,bench)
| INFO (smoke — never moves anchors). Hard triggers regardless of anchor: any
death on-course, falseSuccess > 0, protected violation, unwarned tool break,
dropsLeft > 0, half-kit accepted, staleAfterReconnect > 0.

## goto (ctx.goto + movement profiles)          [suite: GG]
| date | engine | suite | trips | arrival% | falseSucc | wedges | deaths | med_ms R2 | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | awaiting first full gauntlet |

## mineLane (+ safeDescend)                      [suite: MP]
| date | engine | runs | yield% | s/block | maxTorchGap | minLight | unwarned toolBreaks | dropsLeft | deaths | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | awaiting bench_quarry_1 siting |

## buildSchematic (buildCore)                    [suite: BP]
| date | engine | schem | accuracy% | s/block | waste% | reclaim% | placeTimeouts | protViol | deaths | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | awaiting bench_pad_1 build |

## survival (dangerscan + survival.js)           [suite: SD]
| date | engine | tier | encounters | detect ms (med) | branch match | hpMin (worst) | handback | deaths | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | T1 needs __survival.drill() hook (FEEDBACK filed) |

## farmCycle (driver loop until the skill ships) [suite: FC]
| date | engine | cycles | s/tile | seedsΔ | trampled | missedReplant | dropsLeft | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | opportunistic: ≥20 mature tiles on farm_1 |

## autonomy floor (queue+idleguard+runner)       [suite: AS]
| date | engine | hours | idle% | uptime% | interventions | staleAfterReconnect | deaths | tokens | verdict | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | queue loop:true shipped (skills v28, #24 closed) — the external soak-watch.sh re-seed workaround is no longer needed; this suite tests the queue+idleguard floor specifically (distinct from the newer agenda.js soak, scored separately below) and still awaits C1's benchmark facilities on the main server for its actual gauntlet |

## Tier-0 fixture suite                          [suite: fixtures/]
| date | engine | fixtures run | passed | failed | quarantined (flaky) | verdict | notes |
|---|---|---|---|---|---|---|---|
| — | — | 0/12 | — | — | — | — | fixtures to build: wedge-torch, wedge-leaf-litter, wedge-chest-gap, false-success-emptypath, stop-poison, orphan-goto, staircase-1level, tool-break-silent, craft-void, digguard-protected, payload-persist, chop-canopy |

## MP lane ledger (harness-maintained)
| lane | z | consumed on | engine |
|---|---|---|---|
| — | — | — | — |

## Phase-1 autonomy soak scorecard (agenda.js) — HAND-MAINTAINED, not algoboard.sh

Separate from the KPI tables above on purpose: this is iteration feedback on a fast-moving
target (agenda.js shipped v1→v3 within one session), not a stable bench-suite verdict row.
Scored by reading `logs/metrics-<bot>.jsonl` (metrics.mjs) + live `/state` against the 5
acceptance criteria in felsenuboot/felcrew-mcp#28. Do not treat any entry below as a final
PASS — it counts only once a STABLE agenda version runs a full >=3h window start-to-finish.

### 2026-09-01 — agenda v3, SoloSauhund:3120 (local world, seed felcrewtest)

**Version caveat (read first)**: `session.engine` in the telemetry ledger is always `null`
(telemetry installs before skills.js/agenda inject, so it can never populate as designed —
filed as its own FEEDBACK entry + issue). Versions below are cross-referenced from live
`/state.payloads` (read at scoring time: skills v26, agenda v3, survival v4) against
`agenda.js`'s own git commit timestamps, NOT from the ledger's own tag. One consequence: the
ledger's first `run` (r1788226304, 03:31:44-03:43:41 CEST) spans agenda v2 through an interim
fix through v3 — hot-reinjection changes the running code mid-`run` without a new session id,
so that run is NOT a clean single-version sample. The second run (r1788227021, started
03:43:41, cleanly after v3 landed at 03:41:16) is the clean v3 sample cited below.

| criterion | verdict | evidence |
|---|---|---|
| 1. Survives (deaths=0, HP history) | **MET** (for the observed window) | HP and food read 20/20 at every one of 30 rung-transition samples across the full ~14min observed window; zero `panic`-type events in the ledger (survival.js's panic branch never fired — nothing to survive, in the good sense); zero `deaths` on every task_end record. |
| 2. Zero false-success (ledger FSR) | **MET, but structurally unconfirmable for THIS run's data** | Aggregate (both runs pooled): FSR 0.0% [0.0%-11.4%] n=30. Clean v3-only window: n=3 task_end records, correctly suppressed by metrics.mjs's own anti-Goodhart n<5 rule. **Caveat (team-lead): until the assert tri-state fix (#42) is live on THIS run, FSR 0.0% means "no failures recorded," not "N successes independently verified"** — a genuine verified pass and "never graded" both wrote `assert:null` (telemetry.js:316, pre-fix), so pass-vs-ungraded was structurally indistinguishable. The fix shipped (commit 70564b3, SCHEMA_V bumped to 2 by engine-dev-2) but this run (r1788227021) has not restarted since, so its records still predate it — re-read this row once the process restarts onto the fixed telemetry. |
| 3. Needs met in priority order under stress | **MET, no thrashing observed** | Rung sequence (30 samples) cycles PROJECT(29) -> interrupted by RESTOCK(12)/LIGHT(17) as needed -> IDLE(6) only when nothing else fires. No rapid back-and-forth between two rungs (the specific failure mode agenda v2's defect fixes targeted). "Under stress" caveat: this window never actually got the bot hungry/toolless/threatened simultaneously — it's priority-order-under-NORMAL-operation evidence, not the induced-stress test the full acceptance run calls for. |
| 4. Advances project to completion, falls back to P3 | **MET — first observed GRANT** | `safeDescend` completed for real in the clean v3 window: 22/22 steps (y42->y20), `stoppedBecause:"reached"`, 66 dug, 0 deaths, 0 wedges, real materials collected (47 cobblestone, 6 granite, 2 diorite, 11 dirt). Direct log line: `"agenda: project VERIFIED done (safeDescend, safeDescend.netDescent)"` — the assertTask GRANT engine-dev-2 had only seen REFUSING before this. Ladder correctly fell through to rung IDLE afterward (confirmed live via /state, `agenda.rung:"IDLE"`), running routine `collectDrops` sweeps rather than idling invisibly. Earlier in the SAME window (pre-v3/mixed-version run), safeDescend was repeatedly `cancelled` after only ~11-33s each — whether v3's RESTOCK-hysteresis fix is what stopped the cancelling, or this is one clean sample, needs more data before calling it fixed. |
| 5. Self-recovers (wedge/relog) | **PARTIAL** | Wedge: 22 wedge events / 10 RESTOCK task_ends, each with 2-3 engine-level unstick attempts logged — the auto-recovery ladder ran, didn't fully clear the depot-less-world blocker, and the task honestly reported `outcome:"wedge"` rather than a false success (verifier-or-it-didn't-happen doctrine holding). Relog: exactly 1 reconnect occurred in the observed window (2 `connect` events total) and the bot resumed productive work afterward (the v3 run picking up cleanly) with zero driver intervention — but this was an incidental relog, not the acceptance test's deliberately INDUCED wedge+relog scenario, so it's supporting evidence, not a pass on this criterion's actual letter. |

**Overall read**: this is genuinely encouraging iteration feedback, not a final pass — v3 produced the first verified project completion and clean P3 fallback observed all session, HP/food stayed perfect throughout, and FSR is clean on what data exists (with the pass-vs-ungraded caveat above). The known, expected blocker (RESTOCK can only withdraw, stalls on torch-production on a depot-less world) is visible in the data exactly where FEEDBACK.md said it would be. Re-score once torch-production lands and a stable version runs the full >=3h window uninterrupted.

**Process gaps found while building this scorecard, both now fixed**: `session.engine` being permanently `null` (couldn't self-report which version produced a record) and the `assert` field conflating pass with ungraded (couldn't self-report which tasks were actually verified) — filed as #41 and #42, both closed with evidence. #41's fix is a `versions` record emitted on every spawn (better than my proposed fix); #42's fix tri-states `assert` and reads a new `assertFail` boolean. Neither is visible in THIS scorecard's data yet since r1788227021 hasn't restarted since either landed — future scorecards should read cleanly from the ledger without the manual git-timestamp correlation this one needed.

**2026-09-01, same run (r1788227021), later — mineLane + torch/tool depletion, still v3**: team-lead set a new project (`mineLane`, target stone) via `/eval` on the SAME running process (no restart, so still agenda:3 / skills v26 per live `/state.payloads` — the fixes above are on disk but not yet live here). Torch count fell 46 -> 37 -> 34 across the mineLane task and the IDLE-rung sweeps since, and the live kit check flagged `tool_low: iron_pickaxe at 19%` at mineLane's start. The mineLane task itself ended `outcome:"wedge"` (1 unstick, honestly reported, not a false success), and `/state.agenda` now reads `blocked:"no_tool"` with `rung:"IDLE"`, `project:"mineLane"` still held (not abandoned). This is exactly the live self-sufficiency probe team-lead flagged — the bot is hitting a real resource wall (tool durability, same family as the torch-production gap) and degrading honestly (blocked + fallback) rather than false-succeeding or hanging. Everything since the last table update remains `collectDrops ok`/occasional `wedge` on the IDLE sweeps — no deaths, no HP loss, still MET on criterion 1.
