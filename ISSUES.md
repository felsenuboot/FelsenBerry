# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 4 (three-engineer reassignment
pass). Per Felix's directive (via team-lead): don't let issues pile up —
every open issue gets an owner + priority + phase, and PHASE-1 drives to
zero while PHASE-2 waits. This cycle added a third engineer (engine-dev-3,
skills+payloads lane) and re-routed accordingly. This file is the
machine-readable/at-a-glance companion to `gh issue list`; FEEDBACK.md stays
the raw findings pool, GitHub issues stay the tracked work, this file is the
rollup + burndown. Updated every triage cycle.

## Tracker health

**felsenuboot/felcrew-mcp**: 31 open, 4 closed (35 total).
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all 4 filed BY us; no reply
yet. Five outstanding yes/no items on felcrew#1 remain unanswered; team-lead's
call is no further nudge for now.

Closed to date, all with cited evidence:
| # | Title | Evidence |
|---|---|---|
| #7 | task completion must be unmissable | commit `90c11a9` |
| #9 | graychat v3 chat diet | commit `90c11a9` |
| #11 | idle-guard stomps driver goals | commit `a2f0302` |
| #18 | surfaceExposed false-negative | commit `e99d273` |

**Fresh evidence this cycle** (from GOAL.md's live engine-status update,
verified against actual commits/source, not just the claim):
- `toolguard.js` v2 + `ensureTool`'s craft branch **shipped and live-verified**
  (commit `1bcab7b`) — #30 updated, kept open pending the depot-withdrawal
  branch's real-base test.
- `survival.js` v2's **CREEPER branch confirmed live** (10.9-block GoalInvert
  retreat measured) — #32 updated, narrowed to just BREAK_LOS's
  arrow-shadow-wall path (corner-step keeps succeeding first in testing).
- `digguard.js` v4 (uncommitted) has #26's fix **scaffolded but not wired** —
  handoff note posted so engine-dev-3 doesn't have to rediscover this.

## Three-engineer routing (Felix's directive via team-lead, 2026-09-01)

| Owner | Lane | Label |
|---|---|---|
| **engine-dev-2** | CORE — movement/pathfinding, protocol-level engine bugs, telemetry infra, reconnect/status machinery | `owner-engine-dev-2` |
| **engine-dev-3** | SKILLS + PAYLOADS — standalone skills, primitives, payload-level safety fixes | `owner-engine-dev-3` |
| **engine-dev** | CURATOR — fixtures/benchmarks/docs/QA + issue-manager's GitHub co-lane | `owner-engine-dev` |

GitHub `assignee` can't represent non-GitHub teammates (only `felsenuboot` is
a valid repo collaborator — checked via `gh api repos/.../assignees`), so
ownership is tracked via `owner-*` label + a one-line `**Assigned**:`/
`**Reassigned**:` comment on each issue + this table. Flagged to team-lead;
no request yet to add real GitHub accounts for the engineers.

## PHASE labels (GOAL.md directive, Felix via `/goal`, 2026-09-01)

**PHASE-1 — single-player completeness (the current fire).** 28 of 31 open
issues. **PHASE-2 — cooperation (deprioritized).** #1, #6, #8 only.

## Burndown table — every open issue, owner + phase + priority + status

| # | Title | Phase | Priority | Owner | Status |
|---|---|---|---|---|---|
| 28 | AUTONOMOUS AGENDA — Phase 1 capstone | 1 | high | engine-dev-2 | **BLOCKED ON DESIGN** — research/AGENDA-DESIGN.md workflow running, do not start early |
| 30 | TOOLGUARD + ensureTool | 1 | high | engine-dev-2 | craft branch shipped+verified (`1bcab7b`); depot-withdrawal branch needs a real-base test |
| 21 | Telemetry layer + metrics.mjs (E1-E6) | 1 | high | engine-dev-2 | briefed |
| 33 | Generation counter (movement promises) | 1 | medium | engine-dev-2 | briefed, new this cycle |
| 34 | 3-signal stall watchdog | 1 | medium | engine-dev-2 | briefed, new this cycle |
| 2 | reconnect backoff | 1 | medium | engine-dev-2 | confirmed live bug |
| 3 | idleguard role-per-port map | 1 | medium | engine-dev-2 | fix planned in #21's E2 |
| 20 | frozen-entity / corrupt chunk (auto-relog) | 1 | medium | engine-dev-2 | root-caused, incident resolved |
| 24 | queue loop/onEmpty re-seed | 1 | medium | engine-dev-2 | workaround OK, not blocking |
| 25 | runner.js goto response logging | 1 | low | engine-dev-2 | small, independent |
| 31 | ctx.gotoFar multi-leg waypointing | 1 | medium | engine-dev-2 | briefed |
| 26 | Baritone: 7 findings, 1 safety-critical | 1 | high | engine-dev-3 | item 1 briefed; digguard.js v4 has it SCAFFOLDED, not wired — handoff note posted |
| 4 | spawnProof + BASE-vs-reality diff | 1 | high | engine-dev-3 | briefed |
| 5 | farmCycle | 1 | high | engine-dev-3 | spec-ready |
| 13 | tillFarmland + reverting bug | 1 | high | engine-dev-3 | briefed |
| 19 | placeBlock hitbox no-op | 1 | high | engine-dev-3 | briefed, mostly already fixed (2 call sites left) |
| 10 | openContainer furnace gap | 1 | medium | engine-dev-3 | confirmed still open |
| 12 | collectDrops/huntAnimals hazard blind spot | 1 | medium | engine-dev-3 | |
| 14 | autoTorch consumption vs. interval | 1 | medium | engine-dev-3 | |
| 15 | dirt/leaf_litter depot bloat | 1 | medium | engine-dev-3 | |
| 27 | disconnect-mid-loop false success | 1 | medium | engine-dev-3 | |
| 16 | cave-mapping/sealing skill | 1 | low | engine-dev-3 | |
| 35 | harvestGrass + ctx.stripLog + ctx.settle | 1 | low | engine-dev-3 | briefed, new this cycle |
| 22 | Benchmark harness + baseline suite (C1-C3) | 1 | high | engine-dev | briefed |
| 32 | survival.js live-mob QA gap | 1 | high | engine-dev | CREEPER confirmed live; narrowed to BREAK_LOS arrow-shadow only |
| 23 | `__survival.drill(branch)` hook | 1 | medium | engine-dev | |
| 17 | torch light zone bug | 1 | low | engine-dev (tracking only) | likely external — cavecrew-mcp#2 |
| 29 | Kevin MCP reconnect visibility | 1 | low | engine-dev (investigate first) | |
| 6 | FLEET/1 protocol | 2 | low | engine-dev-2 | deprioritized, spec-ready for Phase 2 |
| 8 | CLAIM interop | 2 | low | engine-dev-2 | deprioritized, spec-ready for Phase 2 |
| 1 | Alliance direct line | 2 | low | kevin-driver/team-lead | standing channel, n/a |

**Staleness rule**: every future cycle, check for issues with 2+ cycles of
zero label/status/comment activity per owner and ping directly. All rows
reflect fresh activity this cycle (reassignment pass + evidence updates), so
the rule starts biting from next cycle.

## Owner load

engine-dev-2: 13 (2 blocked/pending-verification, rest active).
engine-dev-3: 11 (one safety-critical, four priority-high).
engine-dev: 5 (curator lane — intentionally lighter, QA/fixtures/docs scope).

## Implementation briefs on file (ready to pick up, no re-research needed)

1. **#4 spawnProof** (engine-dev-3) — builds on the already-spec'd
   `lightSweep` primitive.
2. **#13 tillFarmland** (engine-dev-3) — exact interaction call pattern,
   settle/verify discipline, protected-crop guard, hydration check.
3. **#19 placeBlock hitbox** (engine-dev-3) — mostly ALREADY FIXED; 2 named
   call sites left.
4. **#26 item 1** (engine-dev-3, SAFETY) — `digguard.js` v4 already has the
   restore-safety scaffolding; only the actual `bot.ashDig` wrapper is
   missing. Smallest fix on file.
5. **#33/#34** (engine-dev-2) — both from the CAVECREW steal-list, effort
   S-M each, clear acceptance tests specified.
6. **#35** (engine-dev-3) — three small, independently-shippable primitives
   bundled from one source FEEDBACK entry.

**Not yet briefed, needs real design/field work**: #28 (blocked on the
design workflow — do not start), #32 (needs a staged live-mob encounter,
narrowed to just BREAK_LOS's arrow-shadow-wall path now).

## Alliance watch

No new CAVECREW activity this cycle. Read-only watch continues each cycle;
outbound diplomacy stays with team-lead/curator/kevin-driver.
