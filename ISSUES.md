# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, end of cycle 2 (first full triage pass +
eval-doctrine mirroring). This file is the machine-readable/at-a-glance
companion to `gh issue list`; FEEDBACK.md stays the raw findings pool,
GitHub issues stay the tracked work, this file is the rollup. Updated every
triage cycle.

## Tracker health

**felsenuboot/felcrew-mcp**: 25 open, 4 closed (29 total).
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all 4 filed BY us as courteous
work-item requests; none closed yet on their side. Checked this cycle — no
new activity from CAVECREW on the alliance channel (felcrew#1) or their own
tracker; the five outstanding yes/no items (a-e) remain unanswered.
Team-lead's call stands: no further nudge for now.

Oldest open item: **#1 "Alliance direct line: cavecrew <-> felcrew"**
(2026-08-31T22:38Z) — a standing channel, not expected to ever close.
Oldest open *actionable engine* item: **#2 "runner: exponential reconnect
backoff + duplicate_login cooldown"** (2026-08-31T23:21Z) — confirmed still
a live bug via source read (root cause: `reconnectDelay` resets to 1000ms on
every `spawn`, not just on genuine stability).

Closed to date (all verified against actual source/commits, not just
against FEEDBACK.md's claim):
| # | Title | Evidence |
|---|---|---|
| #7 | task completion must be unmissable | commit `90c11a9`; verified `skills.js:1047` (`TASK_DONE` log line) + `idleguard.js:54` ("previous task DONE") |
| #9 | graychat v3 chat diet | commit `90c11a9`; verified all 4 tiers live in `graychat.js` |
| #18 | surfaceExposed false-negative | commit `e99d273`; verified `dangerscan.js`'s 3-point sample + 24-block column-scan fallback (`skyViaColumn`) |
| #11 | idle-guard stomps driver goals | closed by team-lead pre-cycle-1, commit `a2f0302`, `idleguard v5` |

## This cycle's new activity (cycle 2)

Team-lead filed #20 (own-repo mirror of the frozen-entity bug, now resolved
+ root-caused — corrupt chunk geometry, one-time RCON rescue, remaining item
is an auto-relog detector) and #26 (7 Baritone sidecar findings from the
adapter build, 1 flagged safety-critical: ashfinder's `ashDig` bypasses
`digguard.js` entirely). Both need a look next cycle — #26 in particular
(digguard bypass) is a real gap in the claims/no-grief pillar and should get
an implementation brief.

Mirrored the EVALUATION.md eval-doctrine implementation plan (E1-E6
telemetry layer, C1-C3 benchmark harness, plus 4 standalone follow-up items)
as 5 new tracking issues, created the `regression`/`bench` labels the
doctrine's own text asked for, and filed one new issue from a fresh
FEEDBACK.md finding (#27, disconnect-mid-loop false success). Commented on
#3 cross-referencing the `roster.json` fix now planned in #21's E2 (not
closing — `roster.json` doesn't exist on disk yet, verified).

| # | Title | Labels | Notes |
|---|---|---|---|
| #21 | Telemetry layer + metrics.mjs (E1-E6) | enhancement, bench | engine-dev-2's implementation plan, one pass, 6 items |
| #22 | Benchmark harness + baseline suite (C1-C3) | enhancement, bench | curator's plan; `ALGO.md` already committed, seeded, waiting on this |
| #23 | `__survival.drill(branch)` test hook | enhancement, bench | blocks `ALGO.md`'s survival bench row |
| #24 | Queue loop/onEmpty re-seed for AS soak | enhancement, bench | workaround (soak-watch.sh) explicitly OK per the doctrine, not blocking |
| #25 | runner.js logs goto requests but never responses | bug, bench | small, independently shippable, ~10 lines |
| #27 | Disconnect-mid-loop false success (harvest/plant) | bug | same failure class as the craft-void bug (shipped v12) and #19 |

## Open issues by theme

**Alliance / cross-crew interop** (5)
- #1 Alliance direct line (standing channel — CAVECREW is actively engaged:
  traded, integrated our patches per their commit `5cabc86`, proposed a
  GitHub collab upgrade). **Five yes/no items (a-e) from our 2026-08-31 reply
  are still unanswered.** Team-lead's call: no further nudge for now — a
  second escalation (accepting CAVECREW's tailnet-mailbox offer) is queued
  if silence outlasts a few more hours.
- #8 CLAIM interop protocol — mirrors `ZetOmega/cavecrew-mcp#1`, awaiting
  their schema draft or ours. **DEPRIORITIZED to Phase 2** per the GOAL.md
  correction above (cooperation-heavy, explicitly named).
- `ZetOmega/cavecrew-mcp` #2, #3, #4 — all filed by us, all awaiting a
  CAVECREW reply. #3 (fair-play pact) is the same ask as felcrew#1 item (a);
  #2 (chunk regen) is cross-linked from felcrew#17's escalation AND #20's
  resolution note.

**Engine safety / bugs** (11)
- #2 reconnect backoff (confirmed live bug, root cause known)
- #3 idleguard role-per-port map (partial — fix now planned as #21's E2)
- #10 openContainer furnace whitelist gap (confirmed still raw
  `bot.openContainer`, no furnace routing)
- #12 collectDrops/huntAnimals chase phases have no light/hazard filter
- #14 autoTorch consumption far exceeds interval-only prediction
- #15 dirt/leaf_litter unbounded depot accumulation (confirmed no
  ignore-list/discard logic exists)
- #17 torch light + broken block-update events in one zone — **re-triaged**:
  likely server-side chunk corruption, cross-linked to
  `ZetOmega/cavecrew-mcp#2`. No engine fix expected. **Update**: karl-driver's
  own follow-up correction narrowed this — the placement-failure half was
  actually the #19 hitbox-overlap bug (Peter re-diagnosed it live, placed 30
  cells successfully once he stepped back first), NOT a zone-wide
  block-update bug. Only the LIGHTING half (skyLight 0 in open sky) remains
  a confirmed, unexplained bug.
- #19 placeBlock hitbox no-op — **briefed**: the real fix
  (`ctx.placeBlockAt`'s sidestep ladder) already shipped and covers all 4
  build skills; only `autoTorch` and `chopTrees`' replant step still bypass
  it. Effort S, two call sites, named exactly.
- #20 frozen-entity / corrupt-chunk-geometry — resolved+root-caused by
  team-lead; kept open for the auto-relog detector (the actionable engine
  item).
- #26 Baritone: 7 findings, 1 safety-critical (digguard bypass via
  `ashDig`) — needs a look next cycle.
- #27 disconnect-mid-loop false success — new this cycle.

**Engine features / roadmap** (6)
- **#28 autonomous agenda / needs-selector — NEW TOP PRIORITY (Phase 1
  capstone, see correction above).** No brief yet, needs design work first.
- #4 spawnProof sweep + BASE-vs-reality diff (safety, no dependencies) —
  briefed, and arguably Phase-1-relevant too (self-maintenance rung of #28's
  ladder needs to know a structure is damaged before it can react)
- #5 farmCycle autonomous harvest/replant/bake loop — also Phase-1-relevant
  (this IS a "project advance" rung example for #28's ladder)
- #6 chatlisten.js FLEET/1 protocol — **briefed, DEPRIORITIZED to Phase 2**
  per the correction above. Spec stays implementation-ready for when Phase 2
  starts.
- #13 tillFarmland skill + farmland-reverting bug — **briefed**: two
  deliverables (skill itself, S effort; `blocksToAvoid` routing fix for the
  likely-trampling cause, XS effort). Phase-1-relevant (food production is a
  named single-player pillar).
- #16 cave-mapping/sealing skill (rule-of-twice, no safety urgency)

## PRIORITY CORRECTION (2026-09-01, mid-cycle) — GOAL.md phasing directive

Felix issued a fresh phasing directive via `/goal`: **PHASE 1 = single-player
completeness first** (one fully self-sufficient, DRIVERLESS bot surviving
hours unattended on the autonomy-soak benchmark). **Cooperation-heavy work —
FLEET/1 chatlisten (#6) and CLAIM interop (#8) explicitly named — is
deferred to PHASE 2.** This directly reverses the priority framing given to
#6 in this same document and in the brief posted on the issue earlier this
cycle; corrected both #6 and #8 with follow-up comments (the briefs
themselves stay valid for whenever Phase 2 starts, just not next-up).

**New top priority: #28, "AUTONOMOUS AGENDA / needs-selector"** — GOAL.md's
own words call this the Phase-1 capstone: a deterministic priority ladder
(survival > self-maintenance > project advance > idle fallback; LLM sets
only the project, the ladder runs it). Nothing tracked this before; filed
fresh this cycle. No implementation brief yet — this needs real design work
first (the ladder's exact trigger conditions per rung aren't specified in
GOAL.md, unlike #6/#13/#26/#4 which had implementation-ready specs to draw
on). Flagged to team-lead as a material roadmap shift.

## Implementation briefs on file (ready for engine-dev-2, no re-research
needed)

1. **#6 FLEET/1** — exact file/line targets, skeleton location in
   `research/chat-protocol.md`, required changes outside the new payload,
   mandatory first test (spoof rejection).
2. **#19 placeBlock hitbox** — mostly ALREADY FIXED; remaining work is 2
   named call sites.
3. **#13 tillFarmland** — exact interaction call pattern, settle/verify
   discipline, protected-crop guard, hydration check.
4. **#26 item 1 (digguard/ashDig bypass, safety)** — smallest fix on file:
   `goto2.patch.js:554-579`'s `guardAshDig` is a working reference
   implementation; port it into `digguard.js` as a third wrap level reusing
   `g.hit()` (digguard's own region lookup) instead of duplicating a second
   box-matching mechanism. Effort XS.
5. **#4 spawnProof + BASE-vs-reality diff** — builds on the already-spec'd
   `lightSweep` primitive (`research/survival-doctrine.md` §6, full
   pseudocode) pointed at BASE.md's registered structures; the diff half
   reuses `protected.json`'s existing `match` regexes as the verification
   spec, no new schema needed. Effort S + XS.

Next candidates once these land: #12 (collectDrops/huntAnimals hazard
awareness — small, reuses idleguard v4's `surfaceOk`-style filter) and #14
(autoTorch consumption visibility).

## New this cycle (post priority-correction)

- **#29** filed from a fresh kevin-driver FEEDBACK.md entry: the MCP
  (Kevin) bot has zero reconnect visibility/tooling during a full server
  outage, unlike the framework fleet's documented auto-reconnect. Timely
  given the current server-down situation. Needs investigation before a fix
  shape is clear (docs-only vs. a new MCP tool) — not briefed yet.

Running total this session: 12 issues touched (3 closed with evidence, 6
new implementation briefs posted across #6/#19/#13/#26/#4, 2 priority
corrections, 8 new issues filed: #21-25, #27, #28, #29).

## Alliance watch

CAVECREW (`ZetOmega/cavecrew-mcp`) is technically capable and responsive on
code (parallel-evolved near-identical fixes to ours multiple times — the
reach-law/depth-gate/net-descent trio and the placeBlock hitbox sidestep)
but slow on the five outstanding diplomacy yes/no items in felcrew#1.
Read-only watch continues; outbound diplomacy stays with team-lead/curator/
kevin-driver per the channel-restriction rule.

## Not yet issues (below the significance bar, or process/doctrine rather
than engine work)

`harvestGrass` skill (rule-of-twice, minor — though #27 adds a third data
point to the broader "shared harvest/plant loop" need), the
two-drivers-deadlock process note, and the driver-rendezvous process note
are all process/doctrine items better suited to DRIVER_GUIDE.md than a
tracked engine issue.
