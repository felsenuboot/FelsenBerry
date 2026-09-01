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
| — | — | — | — | — | — | — | — | — | — | needs queue loop/re-seed (FEEDBACK filed; watcher workaround ok) |

## Tier-0 fixture suite                          [suite: fixtures/]
| date | engine | fixtures run | passed | failed | quarantined (flaky) | verdict | notes |
|---|---|---|---|---|---|---|---|
| — | — | 0/12 | — | — | — | — | fixtures to build: wedge-torch, wedge-leaf-litter, wedge-chest-gap, false-success-emptypath, stop-poison, orphan-goto, staircase-1level, tool-break-silent, craft-void, digguard-protected, payload-persist, chop-canopy |

## MP lane ledger (harness-maintained)
| lane | z | consumed on | engine |
|---|---|---|---|
| — | — | — | — |
