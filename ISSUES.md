# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 7. This file is the
machine-readable/at-a-glance companion to `gh issue list`; FEEDBACK.md
stays the raw findings pool, GitHub issues stay the tracked work, this file
is the rollup + burndown. Updated every triage cycle. All closes verified
against actual commits/source before acting.

## Tracker health

**felsenuboot/felcrew-mcp**: 26 open, 17 closed (43 total). The queue keeps
trending down — team-lead has been closing shipped work directly with
strong evidence (telemetry bugs #41/#42, #24/#25) in parallel with this
lane's own passes.
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all filed BY us; no reply yet.

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
| #21 | Telemetry layer E1-E6 | E1-E5 live; E6 gate artifacts confirmed on disk |
| #23 | `__survival.drill(branch)` hook | survival v4, found #38 immediately |
| #35 | harvestGrass + ctx.stripLog + ctx.settle | commit `c860899` |
| #39 | agenda RESTOCK hysteresis violation | commit `726d7b6`, cross-verify catch |
| #24 | queue loop/onEmpty re-seed | commit `f82ab0d`, matches acceptance test exactly |
| #25 | runner.js goto request/response logging | commit `c44d4f3`, matches acceptance test exactly |
| #41 | telemetry session.engine always null | runner.js versions record, live-confirmed |
| #42 | telemetry assert field conflated PASS/UNGRADED | commits `70564b3`+`6513682`, schema bump |

## Three-engineer routing

| Owner | Lane |
|---|---|
| **engine-dev-2** | CORE — movement/pathfinding, protocol-level bugs, telemetry infra, agenda.js (phase-1 capstone) |
| **engine-dev-3** | SKILLS + PAYLOADS — standalone skills, primitives, payload-level safety |
| **engine-dev** | CURATOR — fixtures/benchmarks/docs/QA + issue-manager's GitHub co-lane |

## PHASE labels

**phase-1** — single-player completeness, the current fire. **phase-2** —
cooperation, deprioritized (#1, #6, #8 only). **phase-1.5** (new this
cycle) — real gaps that are explicitly NOT phase-1 blockers (don't affect
the bounded acceptance-soak project) and NOT phase-2 cooperation; deferred
until after the acceptance soak. First member: #43.

## Burndown table — every open issue

| # | Title | Phase | Priority | Owner | Status |
|---|---|---|---|---|---|
| 28 | AUTONOMOUS AGENDA — Phase 1 capstone | 1 | **TOP** | engine-dev-2 | agenda v1-v3 shipped; acceptance test not yet run (this is the actual remaining gate) |
| 37 | Self-sufficiency: RESTOCK produce-fallback | 1 | high | engine-dev-2 (+3) | torch production is the remaining piece; engine-dev-3's produce() skill shipped, awaiting RESTOCK wiring |
| 22 | Benchmark harness + baseline suite (C1-C3) | 1 | high | engine-dev | producing real results |
| 32 | survival.js live-mob QA gap | 1 | high | engine-dev | CREEPER confirmed; #38 cross-referenced |
| 19 | placeBlock hitbox no-op | 1 | high | engine-dev-3 | briefed, 2 call sites, blocked behind engine-dev-2's active skills.js |
| 2 | reconnect backoff | 1 | medium | engine-dev-2 | |
| 20 | frozen-entity / corrupt chunk (auto-relog) | 1 | medium | engine-dev-2 | root-caused, incident resolved |
| 31 | ctx.gotoFar multi-leg waypointing | 1 | medium | engine-dev-2 | picked up |
| 33 | Generation counter (movement promises) | 1 | medium | engine-dev-2 | briefed |
| 34 | 3-signal stall watchdog | 1 | medium | engine-dev-2 | briefed |
| 26 | Baritone: 6 findings remaining | 1 | medium | engine-dev-3 | item 1 (safety) shipped `fbae83c` |
| 10 | openContainer furnace gap | 1 | medium | engine-dev-3 | |
| 12 | collectDrops/huntAnimals hazard blind spot | 1 | medium | engine-dev-3 | |
| 13 | tillFarmland — bug half only | 1 | medium | engine-dev-3 | skill shipped; revert root cause unexplained |
| 14 | autoTorch consumption vs. interval | 1 | medium | engine-dev-3 | |
| 15 | dirt/leaf_litter depot bloat | 1 | medium | engine-dev-3 | |
| 27 | disconnect-mid-loop false success | 1 | medium | engine-dev-3 | |
| 38 | survival.js: BREAK_LOS drill hung 90s | 1 | medium | engine-dev | found via #23; feeds #32 |
| 16 | cave-mapping/sealing skill | 1 | low | engine-dev-3 | |
| 17 | torch light zone bug | 1 | low | engine-dev (tracking only) | likely external — cavecrew-mcp#2 |
| 29 | Kevin MCP reconnect visibility | 1 | low | engine-dev | |
| 40 | Bench bot underground damage, unclear if #20 | 1 | low | engine-dev | watch-for-recurrence |
| 43 | Toolless/resourceless at DEPTH | **1.5** | low | engine-dev-3 | FILE-ONLY, do not build yet per team-lead — deferred past the acceptance soak |
| 6 | FLEET/1 protocol | 2 | low | engine-dev-2 | deprioritized, spec-ready |
| 8 | CLAIM interop | 2 | low | engine-dev-2 | deprioritized, spec-ready |
| 1 | Alliance direct line | 2 | low | kevin-driver/team-lead | standing channel |

**Staleness rule**: any phase-1 issue with 2+ cycles of zero activity gets
a direct owner ping. Everything above has fresh activity this cycle or
last.

## Owner load

engine-dev-2: 8 active (#28 top-priority, #37 close behind). Extremely
high shipped-output this session: agenda v1-v3, telemetry E1-E5+fixes,
queue-loop, goto-logging, RESTOCK skill+2 fixes, roster.json.
engine-dev-3: 9 active (#19 the only active priority-high, rest
medium/low; #43 explicitly deferred, #37's skill half already shipped
awaiting engine-dev-2's wiring).
engine-dev: 9 (curator lane — QA findings #38/#40 both here; producing
real bench + telemetry-fix output this cycle too, #41/#42).

## Notable this cycle

- **New `phase-1.5` label** for genuine gaps that are neither a phase-1
  blocker nor phase-2 cooperation (team-lead's framing) — #43 is the first
  member, explicitly FILE-ONLY per team-lead, not to be built yet.
- **#37's produce-side skill has already shipped** (producer.js, commits
  `37c7416`/`84dc423`) per #43's own cross-reference — engine-dev-2's
  RESTOCK-wiring half is the remaining piece before #37 can close.
- Telemetry keeps finding real bugs in itself under live load (#41 null
  session.engine, #42 PASS/UNGRADED conflation) — both closed same-night
  with schema-bump discipline where the fix touched the ledger's own
  invariants.

## Alliance watch

No new CAVECREW activity this cycle. Read-only watch continues.
