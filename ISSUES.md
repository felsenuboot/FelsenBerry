# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 3 (assignment pass + burndown
tracking, per Felix's directive via team-lead: don't let issues pile up —
every open issue gets an owner + priority + phase, and PHASE-1 drives to
zero while PHASE-2 waits). This file is the machine-readable/at-a-glance
companion to `gh issue list`; FEEDBACK.md stays the raw findings pool,
GitHub issues stay the tracked work, this file is the rollup + burndown.
Updated every triage cycle.

## Tracker health

**felsenuboot/felcrew-mcp**: 28 open, 4 closed (32 total).
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all 4 filed BY us; no reply
yet. The five outstanding yes/no items (a-e) on felcrew#1 remain
unanswered; team-lead's call is no further nudge for now.

Closed to date, all with cited evidence:
| # | Title | Evidence |
|---|---|---|
| #7 | task completion must be unmissable | commit `90c11a9` |
| #9 | graychat v3 chat diet | commit `90c11a9` |
| #11 | idle-guard stomps driver goals | commit `a2f0302` |
| #18 | surfaceExposed false-negative | commit `e99d273` |

## PHASE labels (GOAL.md directive, Felix via `/goal`, 2026-09-01)

**PHASE-1 — single-player completeness (the current fire).** A DRIVERLESS
bot surviving and staying productive for hours, unattended, on the
autonomy-soak benchmark. **26 of 28 open issues are phase-1.**

**PHASE-2 — cooperation (deprioritized, waits for Phase 1).** #1 (alliance
channel — standing, not really closeable), #6 (FLEET/1), #8 (CLAIM interop).
Both #6 and #8 keep their implementation-ready briefs/specs for whenever
Phase 2 starts; nothing here needs re-research later, just re-prioritizing.

## Burndown table — every open issue, owner + phase + priority

Labels are the source of truth on GitHub (`phase-1`/`phase-2`,
`priority-high`/`-medium`/`-low`); this table adds the owner (GitHub
`assignee` can't represent non-GitHub teammates — only `felsenuboot` is a
valid repo collaborator — so ownership is tracked via label + a one-line
`**Assigned**:` comment on each issue instead) and a cycle-staleness count
for the 2-cycle ping rule.

| # | Title | Phase | Priority | Owner | Cycles w/o progress |
|---|---|---|---|---|---|
| 28 | AUTONOMOUS AGENDA / needs-selector — Phase 1 capstone | 1 | **high** | engine-dev-2 | 0 (filed this cycle) |
| 30 | TOOLGUARD + ensureTool | 1 | **high** | engine-dev-2 | 0 (filed this cycle; code substantially done, needs commit+verify) |
| 21 | Telemetry layer + metrics.mjs (E1-E6) | 1 | **high** | engine-dev-2 | 0 |
| 22 | Benchmark harness + baseline suite (C1-C3) | 1 | **high** | engine-dev | 0 |
| 32 | survival.js CREEPER+BREAK_LOS live-mob QA | 1 | **high** | engine-dev | 0 (filed this cycle) |
| 5 | farmCycle | 1 | **high** | engine-dev-2 | 0 |
| 13 | tillFarmland + reverting bug | 1 | **high** | engine-dev-2 | 0 (briefed) |
| 19 | placeBlock hitbox no-op | 1 | **high** | engine-dev-2 | 0 (briefed, mostly already fixed) |
| 26 | Baritone: 7 findings, 1 safety-critical | 1 | **high** | engine-dev-2 | 0 (item 1 briefed) |
| 4 | spawnProof + BASE-vs-reality diff | 1 | **high** | engine-dev-2 | 0 (briefed) |
| 31 | ctx.gotoFar multi-leg waypointing | 1 | medium | engine-dev-2 | 0 (filed this cycle) |
| 2 | reconnect backoff | 1 | medium | engine-dev-2 | 0 |
| 3 | idleguard role-per-port map | 1 | medium | engine-dev-2 | 0 (fix planned in #21's E2) |
| 10 | openContainer furnace gap | 1 | medium | engine-dev-2 | 0 |
| 12 | collectDrops/huntAnimals hazard blind spot | 1 | medium | engine-dev-2 | 0 |
| 14 | autoTorch consumption vs. interval | 1 | medium | engine-dev-2 | 0 |
| 15 | dirt/leaf_litter depot bloat | 1 | medium | engine-dev-2 | 0 |
| 20 | frozen-entity / corrupt chunk (auto-relog) | 1 | medium | engine-dev-2 | 0 (root-caused, incident resolved) |
| 23 | `__survival.drill(branch)` hook | 1 | medium | engine-dev | 0 |
| 24 | queue loop/onEmpty re-seed | 1 | medium | engine-dev-2 | 0 |
| 27 | disconnect-mid-loop false success | 1 | medium | engine-dev-2 | 0 (filed this cycle) |
| 16 | cave-mapping/sealing skill | 1 | low | engine-dev-2 | 0 |
| 17 | torch light zone bug | 1 | low | engine-dev (tracking only) | 0 (likely external — cavecrew-mcp#2) |
| 25 | runner.js goto response logging | 1 | low | engine-dev-2 | 0 |
| 29 | Kevin MCP reconnect visibility | 1 | low | engine-dev (investigate first) | 0 (filed this cycle) |
| 6 | FLEET/1 protocol | 2 | low | engine-dev-2 | 0 (deprioritized this cycle) |
| 8 | CLAIM interop | 2 | low | engine-dev-2 | 0 (deprioritized this cycle) |
| 1 | Alliance direct line | 2 | low | kevin-driver/team-lead | n/a (standing channel) |

**Staleness rule**: every future cycle, re-check this table; any PHASE-1
issue with 2+ cycles of zero label/status/comment activity gets a direct
ping to its owner. All rows read 0 this cycle since the assignment pass
just happened — next cycle is when staleness tracking actually starts
biting.

## Phase-1 queue shape (what "trending to zero" means here)

10 high-priority phase-1 issues, 11 medium, 4 low = 26 total. Of the 10
high-priority items, **6 already have implementation-ready briefs on file**
(#4, #13, #19, #21≈E1-E6, #22≈C1-C3, #26 item 1) and **2 are substantially
already-written code sitting uncommitted** (#30 toolguard/ensureTool; #21's
E1-E5 telemetry track is unstarted design-wise but has a full skeleton
spec). The remaining 2 high-priority items (#28 the capstone itself, #32
live-mob QA) are the ones actually needing fresh design/field work — #28
explicitly has no brief yet per this lane's own earlier note (GOAL.md states
the concept, not the trigger conditions per ladder rung).

## Implementation briefs on file (ready for engine-dev-2/engine-dev, no
re-research needed)

1. **#4 spawnProof** — builds on the already-spec'd `lightSweep` primitive
   (`research/survival-doctrine.md` §6); diff half reuses `protected.json`'s
   existing `match` regexes.
2. **#13 tillFarmland** — exact interaction call pattern (top-face
   `activateBlock`, NOT `activateItem`), settle/verify discipline,
   protected-crop guard, hydration check.
3. **#19 placeBlock hitbox** — mostly ALREADY FIXED (`ctx.placeBlockAt`);
   remaining work is 2 named call sites (`autoTorch`, `chopTrees` replant).
4. **#26 item 1 (digguard/ashDig bypass, safety-critical)** — working
   reference implementation already sits in `goto2.patch.js:554-579`; port
   into `digguard.js` reusing its own `g.hit()` region lookup.
5. **#21/#30**: not briefs so much as "go read the working tree" — both have
   substantial code already written (uncommitted) that needs verification
   and landing more than fresh design.

**Not yet briefed, needs real design work**: #28 (the capstone — GOAL.md
gives the concept, not the ladder's trigger conditions) and #32 (live-mob QA
— staging a real creeper/skeleton encounter reliably is inherently less
predictable than code work; may need a driver's field judgment more than an
engineer's).

## Alliance watch

CAVECREW (`ZetOmega/cavecrew-mcp`) technically capable (parallel-evolved
near-identical fixes to ours multiple times) but slow on the five
diplomacy yes/no items. Read-only watch continues each cycle; no new
activity since the last check. Outbound diplomacy stays with
team-lead/curator/kevin-driver.
