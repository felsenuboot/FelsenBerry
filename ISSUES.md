# ISSUES.md — tracker health (maintained by issue-manager)

Snapshot timestamp: 2026-09-01, after the first full triage pass. This file is
the machine-readable/at-a-glance companion to `gh issue list`; FEEDBACK.md
stays the raw findings pool, GitHub issues stay the tracked work, this file
is the rollup. Updated every triage cycle.

## Tracker health

**felsenuboot/felcrew-mcp**: 15 open, 4 closed (19 total).
**ZetOmega/cavecrew-mcp**: 4 open, 0 closed — all 4 filed BY us as courteous
work-item requests; none closed yet on their side.

Oldest open item: **#1 "Alliance direct line: cavecrew <-> felcrew"**
(2026-08-31T22:38Z) — a standing channel, not expected to ever close.
Oldest open *actionable engine* item: **#2 "runner: exponential reconnect
backoff + duplicate_login cooldown"** (2026-08-31T23:21Z) — confirmed still a
live bug via source read (root cause: `reconnectDelay` resets to 1000ms on
every `spawn`, not just on genuine stability).

Closed this cycle (2026-09-01, issue-manager triage, all verified against
actual source/commits, not just against FEEDBACK.md's claim):
| # | Title | Evidence |
|---|---|---|
| #7 | task completion must be unmissable | commit `90c11a9`; verified `skills.js:1047` (`TASK_DONE` log line) + `idleguard.js:54` ("previous task DONE") |
| #9 | graychat v3 chat diet | commit `90c11a9`; verified all 4 tiers live in `graychat.js` |
| #18 | surfaceExposed false-negative | commit `e99d273`; verified `dangerscan.js`'s 3-point sample + 24-block column-scan fallback (`skyViaColumn`) |

FEEDBACK.md sync performed this cycle: flipped two stale-`open` duplicate
entries to `shipped` (task-completion, chat-diet — the shipped rewrite of
each existed further down the file but the original entry was never
updated), added missing `github:` cross-ref lines to both shipped
duplicates, added a `github: ZetOmega/cavecrew-mcp#2` cross-ref to
bernd-driver's frozen-entity finding (matches cavecrew#2 Symptom 1 exactly —
same coordinates, same "survives full process restart" signature).

## Open issues by theme

**Alliance / cross-crew interop** (5)
- #1 Alliance direct line (standing channel — CAVECREW is actively engaged:
  traded, integrated our patches per their commit `5cabc86`, proposed a
  GitHub collab upgrade). **Five yes/no items (a-e) from our 2026-08-31 reply
  are still unanswered** — fair-play pact confirm, chopper-bug intel ack,
  TNT-in-plaza report, glass-row removal ask, restart-heads-up ask.
- #8 CLAIM interop protocol — mirrors `ZetOmega/cavecrew-mcp#1`, awaiting
  their schema draft or ours.
- `ZetOmega/cavecrew-mcp` #2, #3, #4 — all filed by us, all awaiting a
  CAVECREW reply. #3 (fair-play pact) is the same ask as felcrew#1 item (a);
  #2 (chunk regen) is now cross-linked from felcrew#17's escalation.

**Engine safety / bugs** (8)
- #2 reconnect backoff (confirmed live bug, root cause known, fix is a
  one-line change to when `reconnectDelay` resets)
- #3 idleguard role-per-port map (partial — `--role` flag works, the
  fallback map doesn't exist)
- #10 openContainer furnace whitelist gap (confirmed still raw
  `bot.openContainer` in `skills.js`, no furnace routing)
- #12 collectDrops/huntAnimals chase phases have no light/hazard filter
- #14 autoTorch consumption far exceeds interval-only prediction
- #15 dirt/leaf_litter unbounded depot accumulation (confirmed no
  ignore-list/discard logic exists in `depositToChest`)
- #17 torch light not propagating + confirmed-broken block-update events in
  one zone — **re-triaged this cycle**: this is a cross-repo, likely
  server-side chunk corruption issue (see `ZetOmega/cavecrew-mcp#2`), not a
  client-fixable lighting bug. No engine fix expected; tracking moved to the
  cross-repo ops escalation.
- #19 placeBlock hitbox no-op — **briefed this cycle**: the real fix
  (`ctx.placeBlockAt`'s sidestep ladder) already shipped and covers all 4
  build skills; only `autoTorch` and `chopTrees`' replant step still bypass
  it with raw `bot.placeBlock`. Effort S, two call sites.

**Engine features / roadmap** (5)
- #4 spawnProof sweep + BASE-vs-reality diff (safety, user-requested via
  peter-driver, no dependencies, could ship anytime)
- #5 farmCycle autonomous harvest/replant/bake loop
- #6 chatlisten.js FLEET/1 protocol — **briefed this cycle**: top roadmap
  priority per GOAL.md (now carries the "human players" and "CLAIM" pillars).
  Spec is fully implementation-ready (`research/chat-protocol.md`), skeleton
  code included. Gate: run the spoof-rejection test before building on top.
- #13 tillFarmland skill + farmland-reverting bug — **briefed this cycle**:
  two deliverables (the skill itself, S effort; a `blocksToAvoid` routing fix
  for the likely-trampling cause, XS effort). One sub-bug (dirt→grass_block
  flip with no nearby entity) stays genuinely unexplained.
- #16 cave-mapping/sealing skill (rule-of-twice, no safety urgency)

## Implementation briefs on file (top open engine issues, ready for
engine-dev-2 to pick up with no re-research)

1. **#6 FLEET/1** — full brief posted with exact file/line targets, skeleton
   location in `research/chat-protocol.md`, required changes outside the new
   payload (`skills.js`/`graychat.js`/`runner.js`/new `fleet.json`), and the
   mandatory first test (spoof rejection).
2. **#19 placeBlock hitbox** — brief identifies this is mostly ALREADY FIXED
   (`ctx.placeBlockAt`); remaining work is swapping 2 raw-`bot.placeBlock`
   call sites (`autoTorch`, `chopTrees` replant) to the existing primitive.
3. **#13 tillFarmland** — brief has the exact interaction call pattern
   (top-face `activateBlock`, NOT `activateItem`), the settle/verify
   discipline, the protected-crop guard, and the hydration check, all
   sourced from two drivers' independent field verification.

## Alliance watch

CAVECREW (`ZetOmega/cavecrew-mcp`) is technically capable and responsive on
code (parallel-evolved near-identical fixes to ours multiple times, e.g. the
reach-law/depth-gate/net-descent trio and the placeBlock hitbox sidestep) but
slow on the five outstanding diplomacy yes/no items in felcrew#1. Nothing
urgent blocking either side technically; the ask is just "answer the five
letters."

## Not yet issues (FEEDBACK.md entries below the significance bar, or
duplicate/superseded)

`harvestGrass` skill (rule-of-twice, minor), the two-drivers-deadlock process
note, and the driver-rendezvous process note are all process/doctrine items
better suited to DRIVER_GUIDE.md than a tracked engine issue — flagging for
awareness, not filing.
