# Engine Feedback Pool (append-only)

The common pool where EVERY driver/teammate/lead immediately logs field findings
so engineers can improve the engine everyone runs on. This is the ENGINEERS'
INBOX — every engine work cycle (workflow or agent) MUST read the open entries
here first and ship fixes for as many as feasible, flipping their status.

Division of labor between the knowledge files:
- **FEEDBACK.md (this file)**: what should be FIXED/BUILT in the engine — raw,
  append-only, low ceremony. Write the entry the moment you discover the issue.
- **LEARNING_HANDOFF.md**: how to WORK AROUND it today (driver-facing quirk
  catalog). Cross-reference, don't duplicate prose.
- **TODO.md**: the curated roadmap the lead triages big items into.

Entry format (append at the bottom, one block per finding):

```
### YYYY-MM-DD <reporter> — <short title>
type: quirk | bug | feature-request | rule-of-twice | safety
status: open | picked-up | shipped(vN) | wontfix
what: <one-3 lines: observed behavior / need>
fix: <suggested engine change, concrete if possible>
```

Rules: never edit someone else's entry except its `status:` line; engineers flip
status when they pick up / ship; the lead may add `triage:` notes. Discovering
the same issue twice? Bump the existing entry with a `seen-again:` line — repeat
findings raise priority.

---

### 2026-09-01 bernd-driver — tool durability invisible in status
type: feature-request
status: open
what: Both pickaxes broke silently mid-descent (twice this shift), stranding the bot at depth with zero tools; drivers can't see durability without a manual eval.
fix: __skills.status bot block gains heldItem name + durability%; log line "tool_low" under 15%.

### 2026-09-01 marcel-driver — harvestGrass skill (rule-of-twice)
type: rule-of-twice
status: open
what: Grass/seed harvesting hand-driven via raw eval twice in one shift.
fix: skills.js harvestGrass(radius, target): find short_grass/tall_grass, goto+dig+collect, gated like huntAnimals, never digs terrain blocks.

### 2026-09-01 team-lead — task-queue onEmpty fallback spams
type: bug
status: open
what: KloputzKarl looped "checking for stray drops / picked up 0" every ~1.3s in chat — noisy and useless.
fix: onEmpty cooldown ≥30s between runs; narrate only when something was actually found.

### 2026-08-31 friedrich-driver — chopTrees fells placed structure logs
type: safety
status: open
what: Torch-post pillars harvested twice; placed logs indistinguishable from trees. Interim: injected digguard protects 8 plaza columns only.
fix: chopTrees only fells log columns with leaf canopy attached (blockAt check); optional BASE.md-registered-coords skip. See TODO item 4.

### 2026-09-01 marcel-driver — pathfinder Movements spawn with unsafe defaults
type: safety
status: open
what: runner.js:160 `new Movements(bot)` = parkour on, 4-block drops, 1x1 towers, self-scaffolding → one fall death, dirt-pillar and dirt-bridge terrain scars. Runtime-patched fleet-wide this shift; patch dies on restart.
fix: runner.js spawn handler applies safe profile (allowParkour=false, maxDropDown=3, allow1by1towers=false, allowSprinting=false, infiniteLiquidDropdownDistance=false, scafoldingBlocks=[]) on every spawn event. See TODO item 5.

### 2026-09-01 team-lead — auto-inject payload stack on spawn
type: feature-request
status: open
what: skills/idleguard/graychat/digguard/panicguard all die on bot restart; manual re-injection is always forgotten at least once.
fix: runner.js injects the full payload stack from files on every spawn; GET /state reports which payloads are installed.

### 2026-09-01 team-lead — promote panicguard into engine
type: safety
status: open
what: Marcel bled 20→0 HP in ~8s inside a 50s driver polling gap (zombie, dark pocket). panicguard.js injected as stopgap (HP<8 → abort+announce+flee home).
fix: native engine feature with configurable threshold/home; consider auto-eat gapple/food hook on the way out.

### 2026-09-01 team-lead — universal torch preflight (user rule)
type: safety
status: open
what: User rule: every bot carries ≥8 torches on ANY excursion and lights dark workspaces (~7 spacing). v4 autoTorch only covers mineLane/safeDescend.
fix: ctx preflight for any task leaving base radius: warn "no_torches" universally; auto-place on light<8 during any goto/work loop.

### 2026-09-01 bernd-driver — torch-underfoot movement wedge
type: quirk
status: open
what: A torch occupying the bot's own tile wedges pathfinding exactly like the documented leaf_litter bug; stall-buster couldn't clear it.
fix: add torch (and other non-solid placeables) to ctx.goto's nuisance-block auto-recovery dig list.

### 2026-09-01 bernd-driver+marcel-driver — openContainer can't open furnaces
type: quirk
status: open
what: bot.openContainer throws "containerToOpen is neither a block nor an entity" on furnaces (chest-family whitelist); both drivers hit it independently.
fix: depositToChest/engine container helpers route furnace blocks to bot.openFurnace automatically.

### 2026-09-01 marcel-driver — stale chunk data poisons remote blockAt surveys
type: quirk
status: open
what: blockAt scans of chunks not physically visited recently return inconsistent/stale results (scar-hunt false positives, counts changed between identical runs).
fix: survey helpers should check chunk load state / require proximity, or tag results as untrusted beyond N blocks.

### 2026-09-01 marcel-driver — __idleguard.pause() doesn't cover the stall-buster
type: bug
status: open
what: Stall-buster can clear goals during a paused window (pause only gates work-start, not the stall check).
fix: stall-buster respects pausedUntil as well.

### 2026-09-01 marcel-driver — orphaned goto promises poison later goals
type: quirk
status: open
what: An abandoned/timed-out goto's promise can clear or override a later goal ("The goal was changed" errors).
fix: engine tracks the active goto token; stale promise callbacks become no-ops.

### 2026-09-01 team-lead — panic-retreat useless at depth vs ranged attackers
type: safety
status: open
what: Bernd died to a skeleton at ~(-22,-31,-16) despite panicguard firing at HP7 — fleeing toward a base 150 blocks up a corridor is no escape from arrows; 40s of steady damage.
fix: context-aware panic: if home is far/unreachable fast, wall off line-of-sight with cobble + eat; flee only when base is near. Also: deep-work kit preflight (40+ torches, armor, 2 picks, 8+ food below y=0) as an engine check, not just doctrine.

### 2026-09-01 team-lead — injection reports can drift from reality
type: bug
status: open
what: panicguard injection reported installed:true on 3101 but was not live when friedrich-driver verified minutes later (other payloads were). Cause unknown (respawn? eval context loss?).
fix: GET /state should enumerate actually-installed payloads (globalThis checks) so drivers verify cheaply; auto-inject-on-spawn (see earlier entry) removes the class.

### 2026-09-01 marcel-driver — bucket fill/empty needs activateItem, not activateBlock
type: quirk
status: open
what: `await bot.activateBlock(waterSourceBlock)` with an empty bucket equipped resolved with no error but produced no water_bucket (silent no-op). `bot.lookAt(pos, true)` followed by plain `bot.activateItem()` (no block arg) filled it correctly, and the same pattern emptied a water_bucket into a dug basin.
fix: any engine bucket-fill/place helper (pond/farm skills, safeDescend water-bucket-on-lava safety) should use activateItem() after lookAt, not activateBlock(), for liquid interaction.

### 2026-09-01 marcel-driver — hoe-till needs lookAt at the block's TOP FACE
type: quirk
status: open
what: `bot.activateBlock(dirtBlock)` after `bot.lookAt(pos.offset(0.5,0.5,0.5))` (block center) silently no-op'd for tilling, repeatedly, on multiple blocks. Same call with `lookAt(pos.offset(0.5,1,0.5))` (the top face) succeeded immediately (dirt→farmland). Also found: farmland only stays hydrated (moisture 7) when built at the SAME y-level as the adjacent water source, not one level below/above — a plot 1 block above a pond's water surface dried back to dirt repeatedly.
fix: a `tillFarmland`/farm-building skill should always lookAt the target block's top-face offset before activateBlock, and hydration-check (water within 4 blocks, same y) before planting.

### 2026-09-01 marcel-driver — elevation-based safety doctrine has a blind spot: overhangs
type: safety
status: open
what: The fleet's "no hunting below y≈100" rule doesn't catch shaded overhangs at a nominally-safe y — stood at y=109 (well above threshold) and found skyLight=0 (solid stone/dirt directly overhead) right next to a 70+ mob cluster. Caught it only because I manually checked skyLight out of caution.
fix: any goto/travel skill leaving base radius should sample `bot.blockAt(pos).skyLight` (or block light) periodically, not just y-coordinate, and treat skyLight<8 as "in the dark, elevate the mob-hazard scan" the same way autoTorch treats light<8 for placing torches. Consider a `isSafeSurface(pos)` primitive combining y-threshold + skyLight check for hunt/scout skills.

### 2026-09-01 marcel-driver — process: two drivers can deadlock waiting on each other's reply
type: feature-request
status: open
what: MettMarcel and friedrich-driver both messaged "ready, tell me where" and then sat waiting on each other's SendMessage reply for several minutes (a real rendezvous never happened; Friedrich eventually just went solo). Neither side timed out and acted.
fix: driver guidance (DRIVER_GUIDE.md or CLAUDE.md): if a peer hasn't replied within ~5 minutes of a coordination request, announce your adapted plan in chat/to the peer and act on it rather than waiting indefinitely — don't let two drivers idle-block on each other.

### 2026-09-01 peter-driver — frameStructure origin.y is the wall BOTTOM, not one-above-floor
type: quirk
status: open
what: Called buildFloor then frameStructure with the same origin (same x/y/z) expecting the wall to start one block above the floor. Instead frameStructure treats origin.y as the wall's bottom course, so its perimeter ring overwrites the floor's edge tiles with corner/infill material (log/plank) instead of floor material (cobblestone). Not broken — still solid and walkable — but the floor's outer ring ends up the wrong material, and callers have to know to pass origin.y+1 to frameStructure to keep floor material clean at the edges.
fix: either document this explicitly in the skill's description/DRIVER_GUIDE, or better: frameStructure takes an optional `floorY` param and skips placing over any existing floor block at that y, so buildFloor's material wins on the shared ring.

### 2026-09-01 peter-driver — placeBlock throws a blockUpdate timeout even when the placement succeeded
type: bug
status: open
what: Repeatedly (a dozen+ times this shift, across pave/post/path building) `bot.placeBlock()` rejected with "Event blockUpdate:(x,y,z) did not fire within timeout of 5000ms" while the block had actually been placed correctly — confirmed by a follow-up blockAt check. Currently every hand-rolled placement loop has to wrap placeBlock in try/catch and re-check the target block before treating it as a real failure, which is easy to forget and wastes a retry pass every time it's forgotten.
fix: engine-side placeBlock wrapper (used by buildFloor/buildWall/frameStructure/buildStaircase and any future skill) should treat a blockUpdate timeout as "unconfirmed, verify" rather than "failed": re-check blockAt after the timeout and only report failure if the target is still not the expected block.

### 2026-09-01 peter-driver — bot.craft in a tight loop voids items (seen-again, LEARNING_HANDOFF already documents the fix)
type: bug
status: open
what: Crafted oak_log→oak_planks 15x in a row with only a settle delay AFTER the loop (not between each craft). Logs were consumed correctly (34→19) but planks came out net LOWER than before crafting (37→29 instead of the expected ~97) — a straight void, not even recoverable via collectDrops (0 drops found within 10 blocks). This is the exact desync LEARNING_HANDOFF already warns about ("800ms settle + count-verify after every craft"), rediscovered because there's no craft() helper in skills.js/ctx to make the safe pattern the default — every driver has to remember and hand-roll it.
fix: add a `ctx.craftSafe(itemName, times)` primitive to skills.js (800ms settle + inventory count-verify between every single craft call, abort+report on the first unexplained loss) and have any future skill/driver code call that instead of raw bot.craft in a loop.

### 2026-09-01 friedrich-driver — come/goto silently tunnels underground toward an arbitrary y-target
type: safety
status: open
what: Given the new user rule "stay on high sunlit ground, never below y≈100" for an escort mission, I called `come` with explicit y-targets (e.g. y=100-105) heading north leg by leg. Several stops read light:0, which I assumed was just night/shade — but a full column blockAt scan at one stop (-0,100,-192) showed solid stone from dy=2 all the way to dy=14+ above my head: the bot had tunneled through a hillside to reach the requested (x,y,z) rather than staying on the surface. The stall-buster's "dig nuisance block + hop" recovery (meant for leaf_litter etc.) will just as happily dig through stone/dirt terrain blocking a straight-line path, so a y-coordinate target that happens to intersect a hill silently becomes underground travel with zero signal to the driver — no error, no phase change, `light` alone doesn't distinguish night-outdoors from buried-in-rock.
fix: `come`/goto status should report a `surfaceExposed` or `skyLight` flag (distinct from block light) so a driver can tell "dark because night/shade" from "dark because underground"; consider capping the stall-buster's nuisance-dig depth or refusing to path through solid non-air runs longer than ~2-3 blocks without an explicit "tunneling ok" flag, since that's exactly the failure mode the new sunlit-ground safety rule is trying to prevent.

### 2026-09-01 team-lead — travel tasks need a dig-free movement profile
type: safety
status: open
what: Extends friedrich-driver's come-tunneling finding: pathfinder Movements allow digging during TRAVEL, so long-distance come/goto silently tunnels through hills (bot ends up underground believing it's surface-scouting; also leaves ugly tunnels = aesthetics violation, and eats held-tool durability).
fix: two Movements profiles in the engine — travel mode (canDig=false or dig-cost heavily penalized, surface-preferring heuristic) vs work mode (digging allowed). come/goto default to travel mode; skills that legitimately dig (mineLane/safeDescend) opt into work mode. Plus the surface-exposed signal friedrich requested (column-above scan / canSeeSky) in status.
