# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 6 (agenda/telemetry/farm-skills
shipment wave). This file is the machine-readable/at-a-glance companion to
`gh issue list`; FEEDBACK.md stays the raw findings pool, GitHub issues stay
the tracked work, this file is the rollup + burndown. Updated every triage
cycle. All closes below are verified against actual commits/source before
acting, never taken on a report alone.

## Tracker health

**felsenuboot/felcrew-mcp**: 27 open, 13 closed (40 total). The queue is
genuinely burning down — this cycle alone closed 6 issues on real shipped
work (#4, #5, #23, #35, plus #3/#21 closed directly by team-lead) and filed
3 new ones (#37 phase-1-high, #38, #40).
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all 4 filed BY us; no reply
yet. Team-lead's call: no further nudge for now.

Closed to date, all with cited evidence:
| # | Title | Evidence |
|---|---|---|
| #7 | task completion must be unmissable | commit `90c11a9` |
| #9 | graychat v3 chat diet | commit `90c11a9` |
| #11 | idle-guard stomps driver goals | commit `a2f0302` |
| #18 | surfaceExposed false-negative | commit `e99d273` |
| #30 | TOOLGUARD + ensureTool | commit `1bcab7b`, 33s empty-inventory-to-equipped-axe live test |
| #36 | idleguard.stop() stripped every dig guard | shipped idleguard v8 + digguard v4, filed+closed together |
| #5 | farmCycle | commit `8b285cb`, live-verified harvest/replant/bake/deposit |
| #4 | spawnProof + BASE-vs-reality diff | commit `271896e`, live-verified both halves |
| #3 | idleguard role-per-port map | roster.json + runner.js fallback, closed by team-lead directly |
| #21 | Telemetry layer E1-E6 | E1-E5 verified live (real false-success caught), E6 gate-report artifacts confirmed on disk (`bench/gates/skills-v23.json`, `-v26.json`); closed by team-lead |
| #23 | `__survival.drill(branch)` hook | commit (survival v4), live-verified, immediately found a real bug (#38) |
| #35 | harvestGrass + ctx.stripLog + ctx.settle | commit `c860899`, all 3 primitives live-verified |
| #39 | agenda RESTOCK hysteresis violation | commit `726d7b6` (agenda v3), dry-run verified — filed+closed, cross-verify success story |

## Three-engineer routing

| Owner | Lane |
|---|---|
| **engine-dev-2** | CORE — movement/pathfinding, protocol-level engine bugs, telemetry infra, agenda.js (the phase-1 capstone) |
| **engine-dev-3** | SKILLS + PAYLOADS — standalone skills, primitives, payload-level safety fixes |
| **engine-dev** | CURATOR — fixtures/benchmarks/docs/QA + issue-manager's GitHub co-lane |

Ownership tracked via `owner-*` label + a one-line comment on each issue +
this table (GitHub `assignee` can't represent non-GitHub teammates —
confirmed with team-lead, keeping this system, not inventing accounts).

## Burndown table — every open issue

| # | Title | Phase | Priority | Owner | Status |
|---|---|---|---|---|---|
| 28 | AUTONOMOUS AGENDA — Phase 1 capstone | 1 | **TOP** | engine-dev-2 | agenda v1-v3 shipped, live-verified extensively (3 real defects found+fixed by live-running); acceptance test NOT yet run, deliberately opt-in until it is |
| 37 | Self-sufficiency: RESTOCK produce-fallback | 1 | high | engine-dev-2 (+engine-dev-3 for skills) | new this cycle, phase-1-high per team-lead; torches are the remaining blocker for an un-fixtured soak |
| 22 | Benchmark harness + baseline suite (C1-C3) | 1 | high | engine-dev | producing real Tier-0 results (`bench/results/`) |
| 32 | survival.js live-mob QA gap | 1 | high | engine-dev | CREEPER confirmed live; #38 (BREAK_LOS hang) cross-referenced as a related finding |
| 19 | placeBlock hitbox no-op | 1 | high | engine-dev-3 | briefed, mostly already fixed (2 call sites left), blocked behind engine-dev-2's active skills.js work |
| 2 | reconnect backoff | 1 | medium | engine-dev-2 | confirmed live bug |
| 20 | frozen-entity / corrupt chunk (auto-relog) | 1 | medium | engine-dev-2 | root-caused, incident resolved |
| 24 | queue loop/onEmpty re-seed | 1 | medium | engine-dev-2 | workaround OK, not blocking |
| 31 | ctx.gotoFar multi-leg waypointing | 1 | medium | engine-dev-2 | picked up |
| 33 | Generation counter (movement promises) | 1 | medium | engine-dev-2 | briefed |
| 34 | 3-signal stall watchdog | 1 | medium | engine-dev-2 | briefed |
| 25 | runner.js goto response logging | 1 | low | engine-dev-2 | small, independent |
| 26 | Baritone: 6 findings remaining | 1 | medium | engine-dev-3 | item 1 (safety) SHIPPED `fbae83c`, digguard v5; items 2-7 are adapter-already-handles-it porting + 2 docs fixes |
| 10 | openContainer furnace gap | 1 | medium | engine-dev-3 | |
| 12 | collectDrops/huntAnimals hazard blind spot | 1 | medium | engine-dev-3 | |
| 13 | tillFarmland — bug half only (revert root cause) | 1 | medium | engine-dev-3 | skill half shipped `8b285cb`; root cause still unexplained, farmCycle re-tills as mitigation |
| 14 | autoTorch consumption vs. interval | 1 | medium | engine-dev-3 | |
| 15 | dirt/leaf_litter depot bloat | 1 | medium | engine-dev-3 | |
| 27 | disconnect-mid-loop false success | 1 | medium | engine-dev-3 | |
| 38 | survival.js: BREAK_LOS drill hung 90s | 1 | medium | engine-dev | found via #23's drill hook; not reproduced on retry; feeds #32 |
| 16 | cave-mapping/sealing skill | 1 | low | engine-dev-3 | |
| 17 | torch light zone bug | 1 | low | engine-dev (tracking only) | likely external — cavecrew-mcp#2 |
| 29 | Kevin MCP reconnect visibility | 1 | low | engine-dev (investigate first) | |
| 40 | Bench bot underground damage, unclear if #20 | 1 | low | engine-dev | reporter's own honest uncertainty preserved; watch-for-recurrence item |
| 6 | FLEET/1 protocol | 2 | low | engine-dev-2 | deprioritized, spec-ready for Phase 2 |
| 8 | CLAIM interop | 2 | low | engine-dev-2 | deprioritized, spec-ready for Phase 2 |
| 1 | Alliance direct line | 2 | low | kevin-driver/team-lead | standing channel, n/a |

**Staleness rule**: any phase-1 issue with 2+ cycles of zero activity gets a
direct owner ping. Everything above got fresh activity this cycle or last.

## Owner load

engine-dev-2: 9 active (#28 top-priority + actively shipping — v1/v2/v3 all
landed this session; #37 new; rest steady). Extremely high shipped-output
cycle: agenda.js, telemetry E1-E5, RESTOCK skill + 2 fixes, roster.json.
engine-dev-3: 8 active (#4, #5, #23-adjacent work, #35 all closed this
cycle; #26 dropped to medium with item 1 shipped; #19 remaining
priority-high, currently blocked behind engine-dev-2's active skills.js
file).
engine-dev: 8 (curator lane — QA findings #38/#40 both landed here this
cycle; producing real bench artifacts now).

## Notable this cycle

- **agenda.js (the phase-1 capstone) went from unblocked to substantially
  shipped in one session** — v1 through v3, with 3 real defects found and
  fixed by live-running (a never-settling `act()` freezing the entire
  ladder for minutes was the worst of them) plus a cross-verify catch
  (RESTOCK's hysteresis violation, #39). The acceptance test itself hasn't
  run yet — that's the real remaining gate before Phase 2 can open.
- **Telemetry's E5 aggregator caught a REAL false-success on its first
  run** (SR 75.2% verified vs 80.0% naive, a 4.8% trust gap) — the doctrine
  working exactly as designed, and the fix was a genuine unit correction,
  not a loosened alarm threshold.
- **The cross-verify convention (read the file, don't just run it) has now
  paid for itself repeatedly this session** — digguard's accidental
  level-2 slice, RESTOCK's hysteresis gap, and (partially) the
  ensureTool plank-bill undercounting.
- **Torches are now THE named remaining blocker** for phase-1's real
  done-signal (an un-fixtured soak demonstrating from-nothing
  self-sufficiency) — tracked as #37, phase-1-high, split ownership already
  agreed between engine-dev-2 and engine-dev-3.

## Alliance watch

No new CAVECREW activity this cycle. Read-only watch continues.
