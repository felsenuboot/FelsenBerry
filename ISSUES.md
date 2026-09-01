# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 10. This file is the
machine-readable/at-a-glance companion to `gh issue list`; FEEDBACK.md
stays the raw findings pool, GitHub issues stay the tracked work, this
file is the rollup + burndown. Updated every triage cycle. All closes
verified against actual commits/source before acting.

## Tracker health

**felsenuboot/felcrew-mcp**: 44 open, 20 closed (64 total). A structured
**roadmap** (Arc A/B, milestones M0-M7, issues #51-64) landed this cycle —
team-lead's planning pass toward the phase-1 acceptance soak — alongside
the routine field-finding flow this file already tracked.
**ZetOmega/cavecrew-mcp moved to `monkeorg/cavecrew-mcp`** (old URLs
redirect, `gh` commands against the old path still resolve). 5 open issues
there now (they've built their own parallel label taxonomy —
phase-1/priority/owner-* — independently, same evolution we've had).

Closed to date (20): #3 #4 #5 #7 #9 #11 #18 #21 #23 #24 #25 #30 #35 #36
#37 #39 #41 #42, plus this cycle's #51 (roadmap M0, capability freeze
declared) and **#53** (movement detection layer — verified commits
`d7d5c0d`/`4955805`, 75-case pre-flight green fleet-wide; see the close
comment for the "watchdog was answering the wrong question" finding worth
remembering).

## Three-engineer routing (unchanged)

engine-dev-2 = CORE (movement/pathfinding/protocol/telemetry/agenda.js).
engine-dev-3 = SKILLS + PAYLOADS. engine-dev = CURATOR (fixtures/
benchmarks/docs/QA + this GitHub co-lane).

## The roadmap (Arc A = robustness/movement, Arc B = completeness) —
new structure this cycle, #51-64

| # | Milestone | Status | Owner |
|---|---|---|---|
| 51 | M0: capability freeze rules | **CLOSED** | — |
| 53 | Movement detection layer | **CLOSED** | engine-dev-2 |
| 52 | M1: instrument integrity (soak-invalidating measurement bugs) | open, high | engine-dev |
| 54 | M2: movement recovery ladder (ordered escalation) | deliberately not started — waits on #57's empirical distribution | engine-dev-2 |
| 55 | Consolidate 3 bot.dig guard-wrappers into one chain | open, high | engine-dev-3 |
| 56 | M3: induced-stress QA fixtures (criteria #3, #5) | open, high | engine-dev |
| 57 | Shakeout run + empirical recovery tuning | **BLOCKED** — test bot 3106 not running, local server closed, raised with team-lead | engine-dev-2 |
| 58 | M4: freeze + phase-1 acceptance soak (the gate) | open, high — the actual finish line | engine-dev |
| 59 | M5: furnace smelting state-machine + producer path | open, medium | engine-dev-3 |
| 60 | M6: time/night model + shelter/bed rung | open, medium | engine-dev-3 |
| 61 | M7: real food-produce path, retires the food carve-out | open, medium — cross-refs #45 (prereq gate bug) + #13 (farmland revert) as sub-items | engine-dev-3 |
| 62 | Death-recovery: respawn -> corpse -> item recovery | open, medium | engine-dev-3 |
| 63 | Deterministic recipe-DAG planner | **DE-COMMITTED** until the soak ranks it as needed — phase-1.5, blocked | engine-dev-2 |
| 64 | Roadmap umbrella: CONTINUE decision | open, high — the parent tracking issue | — |

**Sequencing note** (so nobody re-derives it): #53 (detection) had to ship
before #57 (shakeout) can run, which has to run before #54 (recovery
ladder) can be scoped — pre-speccing escalation rungs against zero
occurrence data was explicitly rejected as violating the rule-of-twice.
#57 is now the actual bottleneck, and it's environment-blocked, not
engineering-blocked.

## Pre-roadmap open issues (routine field-finding flow, still tracked
individually)

| # | Title | Phase | Priority | Owner |
|---|---|---|---|---|
| 45 | Food bootstrap paradox | 1 | high | engine-dev-3 | consumed as a sub-item of #61 too |
| 19 | placeBlock hitbox no-op (2 call sites) | 1 | high | engine-dev-3 |
| 22 | Benchmark harness C1-C3 | 1 | high | engine-dev |
| 28 | Agenda capstone | 1 | high | engine-dev-2 | acceptance soak = #58 now |
| 32 | survival.js live-mob QA | 1 | high | engine-dev |
| 49 | Bots spam chat with no-op narration | 1 | high | engine-dev-2 | **regression** against #9 |
| 2,20,31,33,34 | reconnect/gotoFar/gen-counter/watchdog/frozen-chunk | 1 | medium | engine-dev-2 |
| 10,12,13,14,15,26,27 | furnace/hazard/tillFarmland-bug/autoTorch/depot-bloat/Baritone-rest/disconnect | 1 | medium | engine-dev-3 |
| 38,40,44 | BREAK_LOS hang / bench-bot damage / ASSERTS audit | 1 | medium-low | engine-dev |
| 16,17,29 | cave-map skill / #17 light bug (external) / Kevin MCP visibility | 1 | low | engine-dev-3 / engine-dev |
| 43,46,47 | deep-toolless / mineLane-ore / reason-code-plausibility | **1.5** | low | engine-dev-3 / engine-dev-2 |
| 1,6,8 | alliance channel / FLEET-1 / CLAIM interop | **2** | low | — / engine-dev-2 |
| 48 | CAVECREW chat spam (alliance half handled; robustness half theirs) | 2 | medium | engine-dev-2 (robustness half) |
| 50 | CAVECREW org-merge proposal | *unlabeled — awaiting Felix's call, not decided here* | | |

**Staleness rule**: any phase-1 issue with 2+ cycles of zero activity gets
a direct owner ping — with 44 open issues this needs to actually run next
cycle, not just exist as a rule.

## Notable this cycle

- **The roadmap arrived.** #51-64 is a structured plan toward the phase-1
  acceptance soak (M0-M7), replacing ad-hoc "what's next" guessing with a
  sequenced arc. #53 (detection layer) shipped same-day it was scoped.
- **#57 is the real bottleneck**: engineering is ahead of the environment
  right now — the shakeout run needs test bot 3106, which isn't up.
- **CAVECREW moved orgs** (monkeorg) and proposed going further (shared
  repo, per-crew branches) — a real organizational decision, flagged to
  Felix rather than answered here. Also re-engaged fully: pact v2 accepted
  and closed out, their chunk-regen ruling cross-referenced onto our #17/
  #20, and a chat-volume courtesy ask sent their way for #48.
- **#49 is a regression** against #9 (chat diet, closed) — worth checking
  whether agenda.js's IDLE rung narration has its own path around
  graychat's tiering.

## Alliance watch

CAVECREW fully re-engaged this cycle: pact v2 resolved and accepted,
chunk-regen ruling in, org move to monkeorg, and a same-repo collaboration
proposal now pending Felix's decision (#50). Routine read-only watch
resumes; #50 is the one open thread needing a human call.
