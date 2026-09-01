# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 8. This file is the
machine-readable/at-a-glance companion to `gh issue list`; FEEDBACK.md
stays the raw findings pool, GitHub issues stay the tracked work, this
file is the rollup + burndown. Updated every triage cycle. All closes
verified against actual commits/source before acting.

## Tracker health

**felsenuboot/felcrew-mcp**: 27 open, 18 closed (45 total). Phase-1's
self-sufficiency spine is now largely proven live: TOOLGUARD/ensureTool
(#30), the agenda ladder (#28, still open pending the acceptance test),
and now produce-by-acquisition for consumables (#37, closed) all confirmed
driverless and end-to-end.
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all filed BY us; no reply.

Closed to date:
| # | Title | Evidence |
|---|---|---|
| #7 | task completion must be unmissable | commit `90c11a9` |
| #9 | graychat v3 chat diet | commit `90c11a9` |
| #11 | idle-guard stomps driver goals | commit `a2f0302` |
| #18 | surfaceExposed false-negative | commit `e99d273` |
| #30 | TOOLGUARD + ensureTool | commit `1bcab7b` |
| #36 | idleguard.stop() stripped every dig guard | idleguard v8 + digguard v4 |
| #5 | farmCycle | commit `8b285cb` |
| #4 | spawnProof + BASE-vs-reality diff | commit `271896e` |
| #3 | idleguard role-per-port map | roster.json + runner.js fallback |
| #21 | Telemetry layer E1-E6 | E1-E5 live; E6 gate artifacts confirmed |
| #23 | `__survival.drill(branch)` hook | survival v4, found #38 immediately |
| #35 | harvestGrass + ctx.stripLog + ctx.settle | commit `c860899` |
| #39 | agenda RESTOCK hysteresis violation | commit `726d7b6` |
| #24 | queue loop/onEmpty re-seed | commit `f82ab0d` |
| #25 | runner.js goto request/response logging | commit `c44d4f3` |
| #41 | telemetry session.engine always null | runner.js versions record |
| #42 | telemetry assert field conflated PASS/UNGRADED | commits `70564b3`+`6513682` |
| #37 | RESTOCK acquires by PRODUCING (torches) | commits `df64b54`/`37c7416`/`20ea942`/`0130349`, driverless end-to-end: 26 torches from nothing |

## Three-engineer routing

| Owner | Lane |
|---|---|
| **engine-dev-2** | CORE — movement/pathfinding, protocol bugs, telemetry infra, agenda.js |
| **engine-dev-3** | SKILLS + PAYLOADS — standalone skills, primitives, payload safety |
| **engine-dev** | CURATOR — fixtures/benchmarks/docs/QA + issue-manager's GitHub co-lane |

## PHASE labels

**phase-1** (current fire) · **phase-2** (cooperation, deprioritized: #1,
#6, #8) · **phase-1.5** (real gaps, not a phase-1 blocker, not phase-2 —
deferred past the acceptance soak: #43).

## Burndown table — every open issue

| # | Title | Phase | Priority | Owner | Status |
|---|---|---|---|---|---|
| 28 | AUTONOMOUS AGENDA — Phase 1 capstone | 1 | **TOP** | engine-dev-2 | agenda v1-v7 shipped, extensively live-verified; the 5-part acceptance soak itself still hasn't run — the actual remaining gate |
| 45 | Self-sufficiency: food bootstrap paradox | 1 | high | *unassigned* | new this cycle — starving bot can't hunt for food (foodItems gate), same shape as #37, needs design not just wiring |
| 22 | Benchmark harness + baseline suite (C1-C3) | 1 | high | engine-dev | producing real results |
| 32 | survival.js live-mob QA gap | 1 | high | engine-dev | CREEPER confirmed; #38 cross-referenced |
| 19 | placeBlock hitbox no-op | 1 | high | engine-dev-3 | briefed, 2 call sites, blocked behind engine-dev-2's active skills.js |
| 2 | reconnect backoff | 1 | medium | engine-dev-2 | |
| 20 | frozen-entity / corrupt chunk (auto-relog) | 1 | medium | engine-dev-2 | root-caused, incident resolved |
| 31 | ctx.gotoFar multi-leg waypointing | 1 | medium | engine-dev-2 | picked up |
| 33 | Generation counter (movement promises) | 1 | medium | engine-dev-2 | briefed |
| 34 | 3-signal stall watchdog | 1 | medium | engine-dev-2 | briefed; real physics-desync specimen logged from #37's verification run |
| 26 | Baritone: 6 findings remaining | 1 | medium | engine-dev-3 | item 1 (safety) shipped `fbae83c` |
| 10 | openContainer furnace gap | 1 | medium | engine-dev-3 | |
| 12 | collectDrops/huntAnimals hazard blind spot | 1 | medium | engine-dev-3 | |
| 13 | tillFarmland — bug half only | 1 | medium | engine-dev-3 | skill shipped; revert root cause unexplained |
| 14 | autoTorch consumption vs. interval | 1 | medium | engine-dev-3 | |
| 15 | dirt/leaf_litter depot bloat | 1 | medium | engine-dev-3 | |
| 27 | disconnect-mid-loop false success | 1 | medium | engine-dev-3 | |
| 38 | survival.js: BREAK_LOS drill hung 90s | 1 | medium | engine-dev | found via #23; feeds #32 |
| 44 | 6 skills lack an ASSERTS entry (audit) | 1 | low | engine-dev (coordinate w/ engine-dev-3) | new this cycle; 4 strong candidates, 2 need closer review |
| 16 | cave-mapping/sealing skill | 1 | low | engine-dev-3 | |
| 17 | torch light zone bug | 1 | low | engine-dev (tracking only) | likely external — cavecrew-mcp#2 |
| 29 | Kevin MCP reconnect visibility | 1 | low | engine-dev | |
| 40 | Bench bot underground damage, unclear if #20 | 1 | low | engine-dev | watch-for-recurrence |
| 43 | Toolless/resourceless at DEPTH | **1.5** | low | engine-dev-3 | FILE-ONLY, do not build — v31's tool-acquisition fixes made the reactive path faster (2.2s vs 36.6s) but did NOT build this issue's deferred capability |
| 6 | FLEET/1 protocol | 2 | low | engine-dev-2 | deprioritized, spec-ready |
| 8 | CLAIM interop | 2 | low | engine-dev-2 | deprioritized, spec-ready |
| 1 | Alliance direct line | 2 | low | kevin-driver/team-lead | standing channel |

**Staleness rule**: any phase-1 issue with 2+ cycles of zero activity gets
a direct owner ping.

## Owner load

engine-dev-2: 7 active (#28 top-priority). Shipped the full self-sufficiency
spine this session: agenda v1-v7, telemetry E1-E5+fixes, queue-loop,
goto-logging, RESTOCK produce-wiring (#37, closed).
engine-dev-3: 9 active (#19 the only active priority-high; #43 explicitly
deferred; #37's produce-side skill already shipped).
engine-dev: 9 (curator lane — #38/#40/#44 all landed here this cycle).
**Unassigned: #45** (food bootstrap paradox) — flagged to team-lead by
engine-dev-2, needs a design owner.

## Notable this cycle

- **#37 closed — acquire-by-producing is now proven, not just wired.** A
  driverless bot on a depot-less world made 26 torches from nothing (mined
  coal, chopped wood, crafted planks→sticks→torches) after its withdraw
  attempt legitimately failed. Zero LLM involvement per cycle.
- **The same verification immediately found the next floor**: food. Filed
  as #45, unassigned, needs a design pass (not just wiring like torches
  was) since `huntAnimals`' own kit gate requires food to hunt for food.
- **#43 stays correctly deferred** despite adjacent tool-acquisition bug
  fixes landing in the same commit wave — engine-dev-2 was explicit that
  none of the shipped fixes build #43's deferred capability, and this
  lane's tracking reflects that distinction rather than assuming progress.

## Alliance watch

No new CAVECREW activity this cycle. Read-only watch continues.
