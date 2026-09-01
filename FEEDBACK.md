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
status: shipped(dangerscan v1) — engine-dev 2026-09-01. `__skills.status().bot.held = {name, count, dur%}` plus a one-shot `tool_low` warn log under 15%. Shipped as the dangerscan.js payload (it grafts the fields onto status), NOT yet inside skills.js — fold it in during the P0.4 native pass. Live-verified on SchisserSiegbert/3108.
what: Both pickaxes broke silently mid-descent (twice this shift), stranding the bot at depth with zero tools; drivers can't see durability without a manual eval.
fix: __skills.status bot block gains heldItem name + durability%; log line "tool_low" under 15%.
triage: (2026-09-01 synthesis) ship in the SAME status change as the 4Hz danger score + skyLight flag — spec in research/survival-doctrine.md §3; plan P0.4 in research/SYNTHESIS.md.

### 2026-09-01 marcel-driver — harvestGrass skill (rule-of-twice)
type: rule-of-twice
status: open
what: Grass/seed harvesting hand-driven via raw eval twice in one shift.
fix: skills.js harvestGrass(radius, target): find short_grass/tall_grass, goto+dig+collect, gated like huntAnimals, never digs terrain blocks.

### 2026-09-01 team-lead — task-queue onEmpty fallback spams
type: bug
status: shipped(v13) — engine-dev 2026-09-01. Both halves of the requested fix. (1) The onEmpty interval floor went from 3s to 30s (and the default from 20s to 30s), so a background sweep can no longer run seconds apart. (2) Fallback runs are now ALWAYS quiet — the old code announced the first run up front regardless of outcome; narration moved to _onTaskEnd and only fires when the sweep actually collected something ('Picked up N stray items while waiting'). Verified live: 3 fallback runs over 100s produced ZERO chat lines, and the only lines in the window came from the explicitly-queued task, which should still report.
what: KloputzKarl looped "checking for stray drops / picked up 0" every ~1.3s in chat — noisy and useless.
fix: onEmpty cooldown ≥30s between runs; narrate only when something was actually found.

### 2026-08-31 friedrich-driver — chopTrees fells placed structure logs
type: safety
status: open
what: Torch-post pillars harvested twice; placed logs indistinguishable from trees. Interim: injected digguard protects 8 plaza columns only.
fix: chopTrees only fells log columns with leaf canopy attached (blockAt check); optional BASE.md-registered-coords skip. See TODO item 4.
seen-again: 2026-09-01 kevin-driver — CORRECTION, retracting my own initial attribution below: what I found is NOT a new chopTrees incident. I found 4/8 torch_posts_1 columns completely gone — (-3,9), (-8,9), (2,9), (2,4), full air y=111-114 — during a post-restart inspection and first assumed this bug (chopTrees felling structure logs). But peter-driver's separate entry a few rows down ("no spawn-proofing, explosion damage keeps re-hitting rebuilt base structures") already found "6 of 8 torch posts partially or fully destroyed" from what he diagnosed as creeper explosion (not chopTrees — digguard only blocks bot digging, not explosions). My 4-fully-gone/4-intact snapshot is consistent with his 6-partial-or-full snapshot taken at a different point (some columns likely got repaired in between). Same underlying incident, wrong bug filed against — see peter-driver's entry for the real fix needed (spawnProof sweep / structure re-verification). Not bumping this chopTrees entry's priority after all; leaving this note only so nobody double-counts it as a third chopTrees incident.

### 2026-09-01 marcel-driver — pathfinder Movements spawn with unsafe defaults
type: safety
status: shipped(v8) — engine-dev, verified live on NudelNorbert/3109: bot.on('spawn') (not once) applies baseMovements() every spawn; GET /state confirmed parkour:false, towers:false, maxDropDown:3 on a fresh connect with no runtime patch
what: runner.js:160 `new Movements(bot)` = parkour on, 4-block drops, 1x1 towers, self-scaffolding → one fall death, dirt-pillar and dirt-bridge terrain scars. Runtime-patched fleet-wide this shift; patch dies on restart.
fix: runner.js spawn handler applies safe profile (allowParkour=false, maxDropDown=3, allow1by1towers=false, allowSprinting=false, infiniteLiquidDropdownDistance=false, scafoldingBlocks=[]) on every spawn event. See TODO item 5.
triage: (2026-09-01 synthesis) root cause of the "silent revert" found: reconnect re-runs createBot with stock `new Movements(bot)` — handler must be bot.on('spawn'), not once. Full profile set (HAUL/WORK/CAVE, digCost/entitiesToAvoid/blocksToAvoid) copy-paste ready in research/movement-engines.md §2.2/§2.10; note research recommends allowSprinting=true in HAUL only (fall death was parkour+drops, not sprint — verify on ridge route).

### 2026-09-01 team-lead — auto-inject payload stack on spawn
type: feature-request
status: shipped(v8) — engine-dev, verified live: skills/digguard/graychat/panicguard all auto-installed on NudelNorbert's first spawn with zero manual injection; idleguard needs a --role CLI arg to auto-inject (role-templated, opt-in) — spawn.sh/drivers don't pass one yet, so idleguard still needs manual ./inject-style handling until that's wired through
what: skills/idleguard/graychat/digguard/panicguard all die on bot restart; manual re-injection is always forgotten at least once.
fix: runner.js injects the full payload stack from files on every spawn; GET /state reports which payloads are installed.
triage: (2026-09-01 synthesis) keystone item — survival.js (survival-doctrine §4) and chatlisten.js (chat-protocol §5.1) both require engine-resident auto-inject; /state should also expose live Movements profile fields + fleetchat/ash flags. Plan P0.2 in research/SYNTHESIS.md.

### 2026-09-01 team-lead — promote panicguard into engine
type: safety
status: shipped(survival.js v1) — engine-dev 2026-09-01. panicguard.js is RETIRED (removed from runner.js's auto-inject list; survival.js replaces it). Five context-aware branches per survival-doctrine ss4: ENV / CREEPER / BREAK_LOS / FLEE_HOME / WALL_OFF, 10s lockout (not 30s). Live-verified on SchisserSiegbert/3108: WALL_OFF sealed 13/13 faces on flat ground (10 placed, cap included) then dug its exit away from the threat bearing; FLEE_HOME sprinted 29 blocks home in 14s and restored the sprint setting. CREEPER/BREAK_LOS geometry is code-complete but NOT yet exercised against a live mob — flag anything odd.
what: Marcel bled 20→0 HP in ~8s inside a 50s driver polling gap (zombie, dark pocket). panicguard.js injected as stopgap (HP<8 → abort+announce+flee home).
fix: native engine feature with configurable threshold/home; consider auto-eat gapple/food hook on the way out.
triage: (2026-09-01 synthesis) full replacement spec'd as survival.js in research/survival-doctrine.md §4 (danger score entry, creeper-override/flee-home/BREAK_LOS/wall-off branches, 10s lockout — 30s is longer than time-to-die). Also: panicguard.js:17 calls __skills.stop(bot, "panic-retreat") but the signature is stop(reason, opts) — bot object passed as reason (found by chat-protocol research, see entry below).

### 2026-09-01 team-lead — universal torch preflight (user rule)
type: safety
status: shipped(v11) — engine-dev 2026-09-01. `__skills.start()` now refuses to depart half-kitted: three cumulative tiers (excursion 8 torches / underground 16 + 2 picks + 16 filler / deep 40 + armor + shield + water bucket), resolved per skill and args, returning {code:'kit_missing', tier, missing:[...]} BEFORE the task is created. `__skills.kitCheck(bot,tier)` is the pure-inspection version for drivers. Escape hatch is {"force":true}, which logs the override. Verified live: safeDescend {toY:-10} was refused for the full deep list, and passed once the kit was satisfied.
what: User rule: every bot carries ≥8 torches on ANY excursion and lights dark workspaces (~7 spacing). v4 autoTorch only covers mineLane/safeDescend.
fix: ctx preflight for any task leaving base radius: warn "no_torches" universally; auto-place on light<8 during any goto/work loop.
triage: (2026-09-01 synthesis) kit preflight tiers spec'd (excursion/underground/deep) in research/survival-doctrine.md §5; lighting math + lightSweep skill in §6 (keep every=7 — user rule, 3x spawn-proof minimum, coal is cheap). Plan P1.6.

### 2026-09-01 bernd-driver — torch-underfoot movement wedge
type: quirk
status: shipped(v8) — engine-dev, verified live: movements.blocksToAvoid now includes torch/leaf_litter/etc at spawn; forced a bot to GoalBlock directly onto a torch cell, it dug the torch out (confirmed via blockAt: air afterward) and arrived in 297ms, zero stall. ctx._unstick stays as backstop.
what: A torch occupying the bot's own tile wedges pathfinding exactly like the documented leaf_litter bug; stall-buster couldn't clear it.
fix: add torch (and other non-solid placeables) to ctx.goto's nuisance-block auto-recovery dig list.
triage: (2026-09-01 synthesis) better fix found at the PLANNER level: torch/leaf_litter have zero shapes → pathfinder classifies them as air (source-verified). `movements.blocksToAvoid.add(...)` makes the planner dig them before stepping in — retires this and the leaf_litter wedge; keep ctx recovery as backstop. research/movement-engines.md §2.4, plan P0.1.

### 2026-09-01 bernd-driver+marcel-driver — openContainer can't open furnaces
type: quirk
status: open
what: bot.openContainer throws "containerToOpen is neither a block nor an entity" on furnaces (chest-family whitelist); both drivers hit it independently.
github: felsenuboot/felcrew-mcp#10
fix: depositToChest/engine container helpers route furnace blocks to bot.openFurnace automatically.

### 2026-09-01 marcel-driver — stale chunk data poisons remote blockAt surveys
type: quirk
status: open
what: blockAt scans of chunks not physically visited recently return inconsistent/stale results (scar-hunt false positives, counts changed between identical runs).
fix: survey helpers should check chunk load state / require proximity, or tag results as untrusted beyond N blocks.
triage: (2026-09-01 synthesis) rule now baked into two new-skill designs: buildPath generates placements leg-wise from LIVE reads only (build-aesthetics §d) and lightSweep surveys only the chunk the bot stands in (survival-doctrine §6); applies to light values exactly as to blocks.
seen-again (marcel-driver): hit a variant of this even standing IN a chunk, not a remote one — `bot.blockAt(bot.entity.position).skyLight` read 0 while physically at base, well-lit (torches within 8 blocks on all sides), isDay:true, and the SAME query one block higher (y+1) read 15. Not a remote-chunk issue this time, just the bot's own occupied block giving a bad self-read. Since my whole safety doctrine (the LIGHT RULE) hinges on trusting a single skyLight read before treating a spot as safe/unsafe, this matters: a lightSweep/isSafeSurface primitive should probably sample 2-3 nearby points (self + y+1 + one adjacent) rather than trusting one single-block read, especially before triggering a retreat or refusing to work a spot.

### 2026-09-01 marcel-driver — __idleguard.pause() doesn't cover the stall-buster
type: bug
status: shipped(idleguard v5) — engine-dev 2026-09-01. The stall-buster ran BEFORE both the pause check and the idle check, so it yanked goals during paused windows exactly as reported; I reproduced it three separate times during v11/v12 work (a 240s pause still lost a crafting trip to "The goal was changed before it could be completed!"). v5 gates the stall-buster on `paused() || taskRunning()` and refreshes lastPos instead of counting stall ticks while suspended. survival.js can now be downgraded from __idleguard.stop() to pause() — I've left it on the stronger busy=true hold for this cycle since that also works on bots still running v4.
what: Stall-buster can clear goals during a paused window (pause only gates work-start, not the stall check).
fix: stall-buster respects pausedUntil as well.
triage: (2026-09-01 synthesis) survival.js panic entry must use __idleguard.stop() not pause() until this lands (research/survival-doctrine.md §4 entry step 2); downgrade to pause() once fixed.

### 2026-09-01 marcel-driver — orphaned goto promises poison later goals
type: quirk
status: picked-up(v8 partial) — engine-dev shipped the mechanism-fix half (ctx.goto's 3 stop() calls -> setGoal(null), so a stray stop() no longer poisons the next goal) and the detector (GET /state.orphanedGoto via bot.listenerCount('path_update')>1). Still open: CAVECREW steal-list item 2 (generation-token on movement promises) for the full "stale promise becomes a no-op" fix.
what: An abandoned/timed-out goto's promise can clear or override a later goal ("The goal was changed" errors).
fix: engine tracks the active goto token; stale promise callbacks become no-ops.
triage: (2026-09-01 synthesis) cheap detector found: a leaked goto never removes its listeners, so `bot.listenerCount('path_update') > 1` = orphan alive — surface in GET /state. Also replace ctx.goto's 3 pathfinder.stop() calls with setGoal(null) (stop-flag poisons the NEXT goto, mechanism confirmed in source). research/movement-engines.md §2.3/§2.5, plan P0.1.

### 2026-09-01 team-lead — panic-retreat useless at depth vs ranged attackers
type: safety
status: shipped(survival.js v1 + v11) — engine-dev 2026-09-01. BOTH halves now shipped. Branch half: BREAK_LOS (corner-step, else 2-block 'arrow shadow', then rush-if-healthy or coffin) and WALL_OFF (seal + eat to 18 + regen + exit away from threat), wall-off live-verified. Kit half: v11's preflight enforces the deep tier (40 torches / 2 picks / 8 food / armor / shield / water bucket) in S.start BEFORE departure — verified live, safeDescend {toY:-10} refused with the full missing list.
what: Bernd died to a skeleton at ~(-22,-31,-16) despite panicguard firing at HP7 — fleeing toward a base 150 blocks up a corridor is no escape from arrows; 40s of steady damage.
fix: context-aware panic: if home is far/unreachable fast, wall off line-of-sight with cobble + eat; flee only when base is near. Also: deep-work kit preflight (40+ torches, armor, 2 picks, 8+ food below y=0) as an engine check, not just doctrine.
triage: (2026-09-01 synthesis) implementation-ready: BREAK_LOS 2-cobble "arrow shadow" vs skeletons (kiting them is mechanically impossible — they hold range and fire every 3s), WALL_OFF coffin + eat-to-18, flee-home only ≤40 blocks AND melee-only threat. research/survival-doctrine.md §1 (mob mechanics), §4 (branches), §5 (kit tiers). Plan P1.5+P1.6.

### 2026-09-01 team-lead — injection reports can drift from reality
type: bug
status: shipped(v8) — engine-dev: GET /state.payloads now checks globalThis.__skills/__digguard/__graychat/__panic/__idleguard live on every poll, no cached flag
what: panicguard injection reported installed:true on 3101 but was not live when friedrich-driver verified minutes later (other payloads were). Cause unknown (respawn? eval context loss?).
fix: GET /state should enumerate actually-installed payloads (globalThis checks) so drivers verify cheaply; auto-inject-on-spawn (see earlier entry) removes the class.
triage: (2026-09-01 synthesis) likely same root as the Movements revert: reconnect (not respawn) re-runs createBot and wipes /eval'd state inside a driver polling gap — research/movement-engines.md §2.10. Auto-inject on every bot.on('spawn') removes the class; plan P0.2.

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
status: shipped(dangerscan v1) — engine-dev 2026-09-01. status().bot now carries light / skyLight / surfaceExposed, and the 4Hz danger score adds a dark-cell bonus. Verified live in exactly this failure mode: the test bot read skyLight:0 at y=111 next to the plaza (a real overhang pocket) while y alone said 'safe'.
what: The fleet's "no hunting below y≈100" rule doesn't catch shaded overhangs at a nominally-safe y — stood at y=109 (well above threshold) and found skyLight=0 (solid stone/dirt directly overhead) right next to a 70+ mob cluster. Caught it only because I manually checked skyLight out of caution.
fix: any goto/travel skill leaving base radius should sample `bot.blockAt(pos).skyLight` (or block light) periodically, not just y-coordinate, and treat skyLight<8 as "in the dark, elevate the mob-hazard scan" the same way autoTorch treats light<8 for placing torches. Consider a `isSafeSurface(pos)` primitive combining y-threshold + skyLight check for hunt/scout skills.
triage: (2026-09-01 synthesis) covered by the 4Hz danger scanner (weights hostiles from bot.entities regardless of LOS — the 70-mob cluster would have scored ALERT immediately) + dark-cell bonus + skyLight status field. block.light/skyLight verified real on this stack (unlike mindcraft's). research/survival-doctrine.md §3, plan P0.4.

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
status: shipped(v12) — engine-dev 2026-09-01. `S.craftSafe(bot, itemName, times, opts)` and `ctx.craftSafe(...)`: ONE batch per bot.craft call, 800ms settle, full inventory re-count after every single craft, abort on the first craft that yields nothing or on an ingredient loss larger than the recipe asked for. SECOND BUG FOUND while building it, and it's the reason the raw-loop pattern is unfixable by settle alone: `bot.craft(recipe, N)` does not reliably produce N batches — measured live, N=2 on a torch recipe (result.count 4) produced 4 torches, not 8. The requested count is not a promise, so craftSafe never passes N and counts what actually arrived instead. Verified live: 3 calls produced exactly 12 torches, stopped cleanly with 'ran out of ingredients' when planks hit 0, and reported a usable error for a 3x3 recipe with no table in reach.
what: Crafted oak_log→oak_planks 15x in a row with only a settle delay AFTER the loop (not between each craft). Logs were consumed correctly (34→19) but planks came out net LOWER than before crafting (37→29 instead of the expected ~97) — a straight void, not even recoverable via collectDrops (0 drops found within 10 blocks). This is the exact desync LEARNING_HANDOFF already warns about ("800ms settle + count-verify after every craft"), rediscovered because there's no craft() helper in skills.js/ctx to make the safe pattern the default — every driver has to remember and hand-roll it.
fix: add a `ctx.craftSafe(itemName, times)` primitive to skills.js (800ms settle + inventory count-verify between every single craft call, abort+report on the first unexplained loss) and have any future skill/driver code call that instead of raw bot.craft in a loop.

### 2026-09-01 friedrich-driver — come/goto silently tunnels underground toward an arbitrary y-target
type: safety
status: shipped(v9 + dangerscan v1) — engine-dev 2026-09-01. Tunneling half fixed by v9's HAUL profile (digCost 15); the SIGNAL half friedrich asked for now ships in status().bot.surfaceExposed/skyLight, which distinguishes 'dark because night/shade' from 'dark because buried in rock'.
what: Given the new user rule "stay on high sunlit ground, never below y≈100" for an escort mission, I called `come` with explicit y-targets (e.g. y=100-105) heading north leg by leg. Several stops read light:0, which I assumed was just night/shade — but a full column blockAt scan at one stop (-0,100,-192) showed solid stone from dy=2 all the way to dy=14+ above my head: the bot had tunneled through a hillside to reach the requested (x,y,z) rather than staying on the surface. The stall-buster's "dig nuisance block + hop" recovery (meant for leaf_litter etc.) will just as happily dig through stone/dirt terrain blocking a straight-line path, so a y-coordinate target that happens to intersect a hill silently becomes underground travel with zero signal to the driver — no error, no phase change, `light` alone doesn't distinguish night-outdoors from buried-in-rock.
fix: `come`/goto status should report a `surfaceExposed` or `skyLight` flag (distinct from block light) so a driver can tell "dark because night/shade" from "dark because underground"; consider capping the stall-buster's nuisance-dig depth or refusing to path through solid non-air runs longer than ~2-3 blocks without an explicit "tunneling ok" flag, since that's exactly the failure mode the new sunlit-ground safety rule is trying to prevent.
triage: (2026-09-01 synthesis) tunneling half fixed by HAUL/WORK profiles (digCost 15-25 makes walking around cheaper than digging through, research/movement-engines.md §2.2); signal half ships as the skyLight/surfaceExposed status field (P0.4); long-haul routing itself moves to ctx.gotoFar ground-snapped legs (§2.7).

### 2026-09-01 team-lead — travel tasks need a dig-free movement profile
type: safety
status: shipped(v9) — engine-dev: `come` now calls ctx.enterHaul() (switches to HAUL — digCost 15, sprint on — for the travel, restores after) verified live: mid-travel movements read digCost:15, restored to digCost:1 after. gotoFar (P2.8, multi-leg waypointing) doesn't exist yet — wire it the same way whenever it lands. Note: HAUL's surfaceExposed/skyLight signal (the other half of friedrich-driver's tunneling report) is still P0.4's job, not this entry's.
what: Extends friedrich-driver's come-tunneling finding: pathfinder Movements allow digging during TRAVEL, so long-distance come/goto silently tunnels through hills (bot ends up underground believing it's surface-scouting; also leaves ugly tunnels = aesthetics violation, and eats held-tool durability).
fix: two Movements profiles in the engine — travel mode (canDig=false or dig-cost heavily penalized, surface-preferring heuristic) vs work mode (digging allowed). come/goto default to travel mode; skills that legitimately dig (mineLane/safeDescend) opt into work mode. Plus the surface-exposed signal friedrich requested (column-above scan / canSeeSky) in status.
triage: (2026-09-01 synthesis) three copy-paste-ready profiles (HAUL digCost=15 / WORK digCost=25 searchRadius=64 / CAVE digCost=1) in research/movement-engines.md §2.2 — prefer high digCost over canDig=false (a single blocking block stays clearable). Plan P0.3; surfaceExposed flag ships with the status change (P0.4).

### 2026-09-01 bernd-driver — idle-guard stomps driver pathfinder goals (looks like a physics freeze)
type: bug
status: shipped(idleguard v5) — engine-dev 2026-09-01. Root cause was the one you named: only the guard's own patched methods counted as activity, so a task phase that went 25s without calling setGoal/dig looked like driver silence. v5 adds `taskRunning()` (checks `__skills.currentTask.running`) to externalActive() AND to the stall-buster's gate, so a running engine task now owns its goal outright — ctx.goto already has its own bounded unstick ladder, and two stall-busters fighting over one goal is worse than one. Verified: three consecutive `come` tasks completed with guard stalls=0 and runs=0, where the same call had been failing with path_GoalChanged. HONEST CAVEAT: one earlier GoalChanged failure in this session could NOT be attributed to the guard (its stall counter was already 0 at the time) and has not reproduced in the runs since — if you still see path_GoalChanged with idleguard v5 installed and `__idleguard.stalls` not incrementing, it's a different cause and worth a fresh entry.
what: idle-guard's drop-sweep fires its own goto mid-driver-task, repeatedly clearing/overriding the driver's pathfinder goal — presents as "stuck: no movement"/path_GoalChanged at the same spot and even survives a full relog (false lead). Diagnosed by bernd-driver post-respawn; workaround is __idleguard.stop() during extended manual travel, re-inject after.
github: felsenuboot/felcrew-mcp#11 (friedrich-driver independently confirmed __idleguard.stop() isn't 100% reliable at clearing it — see their message, folded into the issue)
fix: idle-guard must treat ANY active __skills task or driver-issued goal as external activity (currently only patched methods count) — e.g. also check __skills.status.running and bot.pathfinder.goal provenance before engaging; never issue gotos while a driver goal is active. Interim: drivers __idleguard.stop() around long manual travel.

### 2026-09-01 friedrich-driver — two independently-driven bots can't rendezvous by chat alone (escort mission, process learning)
type: feature-request
status: open
what: Assigned to escort marcel-driver's hunt (walk together, watch flanks). In practice both bots moved independently on separate driver turn-cadences: I'd announce a coordinate and move, Marcel's driver would process it a turn later and be somewhere else by then, we oscillated for ~10 minutes (position pings, "where are you", both retreating to base at different times) without ever actually walking side-by-side. bot.players[name].entity.position (polled via /eval) was the only reliable way to locate a peer — chat announcements ("Heading to X") were too stale by the time the other driver read them. No damage/harm resulted (team-lead eventually stood the mission down as a farm-first pivot), but real coordination time was burned.
fix: for engine support — a lightweight "where's my peer" endpoint/skill (`__skills.locate(bot, otherBotName)` wrapping the players-map lookup, since it's currently hand-rolled eval every time) would help, plus a `followPlayer`/`escort` skill (goto-near a moving player-entity in a loop, like a tighter version of `come`) so "stay near bot X" becomes one task instead of manual position-chasing. For process — two-bot jobs go better as "rendezvous at a static point first, verify both entities are within N blocks via position poll, THEN move together in lockstep (short legs, re-check peer position every leg)" rather than "announce a distant target and hope the other driver arrives at the same time." Worth writing into DRIVER_GUIDE.md as the standard two-bot-task pattern, since escort/pair-mining/pair-building will recur.

### 2026-09-01 team-lead — CAVECREW stack steal-list (see research/cavecrew-stack-analysis.md)
type: feature-request
status: open
what: Analysis of allied crew's public stack (ZetOmega/cavecrew-mcp) found 5 mechanisms superior to ours, several closing OUR open entries:
  1. safeDig/safePlace verify-on-timeout (re-check world before believing failure) — closes the placeBlock false-timeout entry. Effort S.
  2. Per-connect GENERATION COUNTER threaded through all movement promises (stale ones become no-ops) — closes the orphaned-goto entry + zombie-relog class. Effort M.
  3. EXTERNAL deterministic overseer process (polls /status, public API only, single-task mutex) instead of injected idleguard — structurally fixes the idleguard-goal-stomping bug AND the reinjection-after-restart class. Port WITHOUT their RCON-teleport (no-cheat rule). Effort M.
  4. Engine-native death protocol: target-spot poisoning 15min, deathCount/lastDeath in status, time-boxed recover skill. Effort M.
  5. 3-signal stall watchdog (moved|inventory changed|block broke → else skip/abort). Effort S-M.
fix: next engine cycle implements 1+2+5 first (small, close existing bugs), then 3 (overseer) and 4. Full details + runners-up (ensureTool chain, ashfinder gotchas, findBlock null-guard) in the report.

### 2026-09-01 team-lead — interop: scope lease/ledger lines by speaker
type: safety
status: open
what: CAVECREW uses IDENTICAL lease ids (their own "furnace_1" etc.) and DEPOT chest letters — a naive chat parser will honor THEIR "USING furnace_1" as ours and deadlock (or worse, lease-break theirs).
fix: all protocol-line parsing (engine chat-listener + drivers) must scope by speaker: only FEL-fleet names bind FEL ids; foreign crews' lines are informational. Applies to USING/FREE/LEASE-BREAK/DEPOT/BASE.

### 2026-09-01 marcel-driver — idleguard wandering has zero light/hazard awareness
type: safety
status: shipped(v4) — verified live on MettMarcel by marcel-driver: surfaceOk() gates the work loop from starting in the dark and filters drop/grass/ore wander targets to skyLight>0 positions
what: User caught MettMarcel repeatedly ending up in unlit/dark spots (skyLight 0) with no torches placed, despite carrying 8-9 torches the whole time. Root cause: idleguard.js's role-default work (`mineNearest` for grass/ore/etc, `sweepDrops`) has NO skyLight check and NO torch placement anywhere in its loop — it happily gotoNear's into any patch of shade or worse while the driver isn't actively watching. This happened multiple times this shift, each one only caught because I manually checked skyLight afterward, not because the guard itself flagged anything. I stopped idle-guard on MettMarcel as an immediate mitigation (accepting reduced background productivity over unsupervised torchless wandering).
fix: idleguard.js's work loop should check `bot.blockAt(bot.entity.position).skyLight` (or block light) before/during any gotoNear, and either (a) place a torch from inventory when light<8 and continuing anyway, or (b) refuse to wander into skyLight<8 territory at all, retreating to the last known-lit spot instead. This should probably be the same shared primitive as skills.js's autoTorch (v4) rather than a separate implementation.

### 2026-09-01 research-synthesis — panicguard.js passes bot object as stop() reason
type: bug
status: open
what: panicguard.js:17 calls `__skills.stop(bot, "panic-retreat")` but the engine signature is `stop(reason, opts)` — the bot object becomes the reason string and "panic-retreat" is treated as opts. Harmless today (stop still fires) but wrong, and it garbles the stop-reason in logs. Found by the chat-protocol research track while reading payloads (research/chat-protocol.md §5.3).
fix: `__skills.stop("panic-retreat")`; moot once survival.js replaces panicguard (research/survival-doctrine.md §4), but fix the injected stopgap until then.

### 2026-09-01 peter-driver — repeated bot.pathfinder GoalNear calls inside an enclosed floor can dig the floor out from under the bot
type: bug
status: shipped(v8) — engine-dev: buildCore now sets canDig=false unconditionally (was only a fallback when exclusionAreasBreak wasn't an array), applied to buildWall/buildFloor/frameStructure/buildSchematic; buildStaircase (which doesn't use buildCore) gets the same fix via a new ctx.enterBuildSafe() primitive, wrapped in try/finally. Not independently stress-tested against a live repro (the fix is the exact confirmed remedy from this entry's own root-cause note) — flag if it recurs.
what: Building main_hall_1's walls, I ran ~115 individual `bot.pathfinder.setGoal(new goals.GoalNear(...))` calls (one per target block, hand-rolled patch loop, ~8-10s timeout each) while standing on a freshly-built cobblestone floor inside a walled 8x5 footprint. After the batch, ~23 of the floor's ~40 tiles had silently turned to air (confirmed via blockAt, not a rendering issue — fell through and took fall damage, HP 20→9). No dig calls targeted y=110 anywhere in my script; the only plausible cause is pathfinder digging through the floor as part of its own shortest-path calculation between successive close-together goals inside a confined space, exactly matching the documented "pathfinder digs traversal blocks with the held tool" quirk but triggered by ordinary short-range GoalNear hops rather than long travel. Costly to discover: had to re-patch the whole floor plus took real fall damage.
fix: either (a) Movements profile should refuse to dig transparently-supporting floor blocks the bot is standing near/above inside a confined build site, or (b) any wall/frame-building skill that loops GoalNear per-block should track "was I already within reach" and skip re-pathing entirely for adjacent targets instead of re-issuing a fresh goal each time — most of these 115 calls were for blocks 1-3 away from the previous one and never needed a real path search.
ROOT CAUSE CONFIRMED (same shift, follow-up): it's not floor-specific — damage kept recurring in freshly-patched WALLS too, each patch pass undoing parts of a previous one, in a small enclosed structure. The actual mechanism is `bot.pathfinder.movements.canDig` defaulting true: for a GoalNear target that's technically walkable-around, the path solver still sometimes prefers digging through the nearest wall/corner/floor block over walking the longer way. Fix that worked immediately: `const mv = bot.pathfinder.movements; mv.canDig = false; bot.pathfinder.setMovements(mv);` before any fine-grained per-block placement loop near a structure — zero further collateral damage afterward. Any buildFloor/buildWall/frameStructure/buildStaircase call (and any hand-rolled placement loop using GoalNear) should force canDig=false for the duration of the build, restoring the caller's previous movements afterward.

### 2026-09-01 marcel-driver — skills.js collectDrops has the same light-blind-spot as idleguard did
type: safety
status: open
what: After idleguard v4 fixed the dark-wandering bug, I still hit a real near-miss from a DIFFERENT code path: I called the injected `__skills` `collectDrops` (radius:32) near the farm, and it chased a distant item drop far enough to leave the bot at skyLight 0 with hostiles within 47-62 blocks — no light check anywhere in the chase. This is the same class of bug as the idleguard finding (now shipped v4), just in skills.js's actual collectDrops skill instead of idleguard's sweepDrops. My workaround this shift: keep collectDrops radii tight (≤12) near known-safe zones and never call it with a large radius unless I'm prepared to end up anywhere within that radius.
github: felsenuboot/felcrew-mcp#12
fix: skills.js's collectDrops (and any other skill that does open-ended goto-to-entity-position chasing — huntAnimals's chase phase too, probably) should apply the same `surfaceOk`-style skyLight filter idleguard v4 now uses before adding a drop/target to its chase list, or at minimum should verify the destination is skyLight>0 before committing to a real goto and bail with a logged reason if not.

### 2026-09-01 marcel-driver — placeBlock(floorBlock, (0,1,0)) can place at the bot's own feet, not atop the reference
type: quirk
status: open
what: Follow-up detail on bernd-driver's "torch-underfoot movement wedge" entry — I reproduced the underlying cause while placing a torch to fix a dark spot the user caught me standing in: `bot.placeBlock(floorBlockBelowMe, new Vec3(0,1,0))` while standing directly on/adjacent to that floor block placed the torch at the BOT'S OWN CURRENT TILE (confirmed via blockAt at dx=dy=dz=0 from bot position) rather than one block above the reference as the face vector should imply. Immediate light-level read after came back 0 too (possibly just chunk-light-update lag, but worth noting).
fix: any auto-torch/light-a-spot primitive should reference an ADJACENT (not directly-underfoot) support block when the bot needs to light its own standing position — e.g. a wall block or a block 1 step away — rather than placing straight down at (0,1,0) from directly overhead, to avoid the self-wedge risk bernd-driver already documented.

### 2026-09-01 marcel-driver — shared farmland can revert (dry out) even when pond-adjacent, likely from bot traffic
type: quirk
status: open
what: Multiple farmland tiles at y=110 next to pond_1 (confirmed moisture 7/7 right after tilling) reverted to plain dirt or grass_block later in the same shift with no action from me on those specific tiles — once mid-crop (a live wheat plant vanished along with the farmland conversion), once just the empty farmland. Farm_1 is now a shared build (me + karl-driver both working it), so my best guess is trampling: any entity jumping/landing on farmland has a chance to convert it back to dirt in vanilla, and a second bot's pathfinder routing across the field (rather than around it) would do this repeatedly without either driver noticing until a harvest comes up empty.
github: felsenuboot/felcrew-mcp#13 (combined with karl-driver's tillFarmland + farmland-reverting entry below)
fix: worth a `protectFarmland`-style Movements exclusion (treat farmland the way scaffoldingBlocks/blocksCantBreak already protects player structures) so pathfinder routes around tilled tiles instead of across them — increasingly relevant as multi-bot shared farms become a fleet pattern.

### 2026-09-01 karl-driver — hoe tilling needs activateBlock, not activateItem
type: quirk
status: open
what: LEARNING_HANDOFF's bucket fix (`bot.activateBlock` silently no-ops, use `bot.activateItem()` instead) does NOT generalize to hoe tilling. Equipping a wooden_hoe, `bot.lookAt(block, true)` then plain `bot.activateItem()` never converted grass_block/dirt to farmland (tried on ~13 cells, 0 successes) — it's a no-op the same way activateBlock was for buckets, just the other tool. What worked 100% of the time: `bot.equip(hoe,'hand'); await bot.lookAt(pos.offset(0.5,1,0.5), true); await bot.activateBlock(block, new Vec3(0,1,0))` — the explicit up-face vector mattered; omitting it (bare `activateBlock(block)`) also failed once in a spot-check.
fix: skills.js should special-case bucket fill/empty as the activateItem exception and use activateBlock(block, faceVector) as the default for all other right-click-on-block interactions (till, bonemeal, door, bucket-place-non-water, etc.) — document both in LEARNING_HANDOFF rather than letting the bucket fix read as a universal rule.

### 2026-09-01 karl-driver — blockAt reads right after place/dig are unreliable in BOTH directions
type: quirk
status: open
what: Reading `bot.blockAt(pos)` within ~150-300ms of a place/dig gave wrong answers both ways during the farm_1 build: (a) false negative — `bot.placeBlock` threw `Event blockUpdate:(x,y,z) did not fire within timeout of 5000ms` on several calls that had, per a later re-check, actually succeeded server-side; (b) false positive — a scripted till loop logged `"after":"grass_block"` (looked like success) for 12 cells that were still untilled moments later on a fresh read. Both directions bit the same session; a fixed 150-400ms settle was not enough on a loaded eval batch.
fix: don't trust the immediate return value of a place/dig call or an immediate re-read for logging/branching; either raise the settle to ~700-1000ms before the confirming blockAt, or (better) do a real verify pass in a SEPARATE eval call after the whole batch finishes and re-fix only what's actually still wrong — which is what ended up working here.

### 2026-09-01 karl-driver — farmland/dirt reverting to grass_block unexpectedly fast
type: bug
status: open
what: 6 of 26 freshly-tilled farmland cells in the farm_1 expansion had reverted to `grass_block` (not `dirt`, which is the normal dry-out/trample target) within roughly 10-15 minutes of in-game/wall-clock time, all otherwise identical neighbors on the same pond's hydration footprint stayed farmland fine. Also saw an untilled dirt block at one non-farmland cell flip to grass_block with no player action nearby. Might be an interaction between the frozen daylight cycle (random-tick-driven grass spread apparently still running, per BASE.md) and farmland's own random-tick dry check landing on the wrong branch, or something else entirely — not root-caused this session, just re-tilled and moved on.
fix: needs an engine-side look (or a `/eval` random-tick probe) — if confirmed, a farm-tending skill (periodic re-till sweep) is the practical workaround regardless of root cause; flagging since it'll quietly shrink any wheat plot over time if nobody re-checks it.

### 2026-09-01 karl-driver — tillFarmland skill (rule-of-twice)
type: rule-of-twice
status: open
what: Hand-drove hoe-tilling via raw /eval well past twice this session (32 cells: 23 new + 6 re-tills + 4 seed-plants at farm_1) — same goto+equip+lookAt+activateBlock pattern every time.
fix: skills.js `tillFarmland(cells|rect, {plant:seedName})`: for each target cell, clear a solid block one above if present (never dig a `wheat`/crop block — treat any mature crop as protected, matching the chopTrees natural-tree lesson), fill an air floor with dirt if needed, hoe-till via `activateBlock(block, [0,1,0])` (see the activateItem/activateBlock entry above), optionally plant a seed item the same way. Gate like huntAnimals/harvestGrass; house-rule drop collection applies.
github: felsenuboot/felcrew-mcp#13 (combined with marcel-driver's farmland-reverting entry above)

### 2026-09-01 bernd-driver — autoTorch light-trigger burns supply far faster than the 7-step interval implies
type: bug
status: open
what: Carried 73 torches into a redescend of the diamond staircase (well above the new 40+ doctrine floor) and hit `no_torches` again after only ~95 combined safeDescend steps with torchEvery:7 — interval alone predicts ~14 placements, not 73+. The shaft runs through genuinely pitch-black natural cave pockets, and ctx.autoTorch's "place immediately if local light < 8" branch appears to fire on nearly every step in those stretches, not just the interval one, so total placements scale with darkness exposure, not step count.
fix: either (a) cap total torches-per-task or add a cooldown between light-triggered placements distinct from the interval counter, or (b) surface actual consumption rate to the driver (e.g. include `torchesPlacedThisTask` + a running "torches/step" ratio in status) so a driver can size the up-front carry correctly instead of guessing from step count alone. Doctrine kit sizing (40 torches) assumed interval-only consumption and was wrong for this route.
github: felsenuboot/felcrew-mcp#14

### 2026-09-01 friedrich-driver — chopTrees permanently wedges near digguard v2 protected regions (hypothesis)
type: bug
status: shipped(v10) — engine-dev 2026-09-01. ROOT CAUSE CONFIRMED, but it is NOT the pathfinder-exclusion mechanism the hypothesis proposed (_unstick only digs NUISANCE blocks, and ctx.goto caps unsticks at 3 per call, so exclusionAreasBreak cannot produce an unbounded loop). The real cause: torch posts and main_hall_1 corner posts ARE valid trunk bases for chopTrees (a log with cobblestone below), so it targeted them, and each protected log cost a full gotoSee->gotoNear ladder with up to 6 stall-recoveries before digguard's cheap rejection even mattered. Measured live at the plaza: ALL 7 logs within 24 blocks are registered structure and ZERO are trees, so the skill ground through every one with progress frozen — exactly the 19-unsticks-in-192s report. FIX: new ctx.isProtected(pos) (consults digguard's protected.json, fails OPEN when digguard is absent) filters protected blocks at TARGET SELECTION, plus a per-log skip so a tree growing against a build still gets felled (result gains protectedSkipped). Verified: same call that used to grind now returns not_found in 790ms.
what: chopTrees (via the standing task queue) sat at the exact same position for 192s straight, running the "movement stalled — unsticking" stall-recovery 19+ times in a row with zero progress (progress stayed at 1/5 trees the whole time, no error surfaced, team-lead independently observed the same "wedged, running:true, not moving" symptom on an earlier occurrence today). Bot was standing right at the plaza edge (-4.5,111,2.2) when I stopped it — inside/adjacent to protected.json's new `plaza_1_floor` region (box protecting cobblestone/dirt/grass_block/stone at y=110 across the whole plaza), which digguard v2 wires into `movements.exclusionAreasBreak` so the PATHFINDER PLANNER (not just bot.dig) treats those blocks as cost>=100/unbreakable. Old leaf_litter stalls self-resolve because the stall-buster's "dig nuisance block" recovery can actually dig leaf_litter; my hypothesis is that when a tree's only reachable path requires crossing/digging a now-protected floor block, the planner can no longer route around OR through it, and repeatedly replans into the same dead end — an unrecoverable wedge that looks identical to the old self-healing one from status() alone. Not yet confirmed with a captured goal object (I stopped the task before checking pathfinder.goal).
fix: reproduce deliberately (start chopTrees with a tree only reachable by crossing the plaza) and confirm via logging whether exclusionAreasBreak rejections correlate with stall count; if confirmed, either give the stall-buster a "protected region nearby, abort/blacklist this target" escape hatch instead of infinite retry, or have chopTrees's search route away from protected AABBs before targeting a tree. Interim driver workaround: avoid queuing chopTrees for extended runs immediately after digguard adds a new protected region near base; watch for progress-not-advancing across 2+ status polls and stop proactively rather than trusting the stall-buster to self-heal.

### 2026-09-01 peter-driver — no spawn-proofing, explosion damage keeps re-hitting rebuilt base structures
type: feature-request
status: open
what: Right after finishing main_hall_1, a routine aesthetic sweep of the already-completed plaza/torch_posts_1 found fresh damage that hadn't been there at last verification: 7 new holes in the plaza floor and 6 of 8 torch posts partially or fully destroyed (some down to bare air). No hostiles were nearby when I checked, so whatever did it had already moved on/despawned/died — pattern (full block+log loss, not floor scoops) matches a creeper explosion, consistent with the separate pen_1 creeper-destruction incident (HAZARD ZONE #1) team-lead flagged this shift. This is the second time a base structure has taken mob damage this session; right now the only response is manual re-detection + hand-repair after the fact, and digguard only stops BOTS from digging protected blocks, not explosions.
fix: a `spawnProof` sweep skill: walk the base perimeter, flag any block-face with skyLight<8/blockLight<8 (mob spawn condition) within N blocks of registered BASE.md structures, and auto-torch it; separately, a periodic (every orchestrator cycle?) re-verification pass against BASE.md's registered coords/materials — diff actual blockAt state vs. the row's spec and surface a `structure_damaged` alert instead of relying on a driver noticing during an unrelated task.

### 2026-09-01 karl-driver — oak_fence_gate has no craftable recipe via bot.recipesFor/recipesAll
type: bug
status: open
what: Building pen_2, tried to craft an `oak_fence_gate` (4 oak_planks + 2 stick, standard shaped recipe) at crafting_table_1 with plenty of both ingredients on hand (up to 8 planks / 2-16 sticks tried). `bot.recipesFor(itemsByName.oak_fence_gate.id, null, 1, table)` returned `[]` every time, and `bot.recipesAll(id, null, null)` (which ignores affordability) ALSO returned `[]` — even though `bot.registry.recipes[821]` shows the raw shaped recipe data is present and looks well-formed (`[[stickId,plankId,stickId],[stickId,plankId,stickId]]` — note: my first read of the ingredient ids was backwards, corrected here). Did not repro-test other gate types (spruce/birch/etc) or plain oak_door. Worked around by using a swap-in plain oak_fence block as the pen entrance (dig+replace) instead of a real gate.
fix: needs an engine-side repro — likely a prismarine-recipe / minecraft-data parsing gap specific to fence_gate's recipe shape on this version (1.21.11), not an ingredients problem. Worth checking whether other multi-row shaped recipes (not just 3-wide ones like fence) have the same silent-empty issue.

### 2026-09-01 team-lead (USER-CRITICAL) — bots act beyond survival reach
type: safety
status: shipped(v8, reachguard.js) — engine-dev: rejects an out-of-range dig/placeBlock/activateBlock/attack with an immediate {code:'reach_violation'} error instead of the silent hang, verified live (15m dig cleanly rejected, normal in-range work unaffected). Deliberately does NOT auto-approach (that would call pathfinder from a bare monkey-patch with no task context — risks the documented goal-stomping class). "fold into skills.js ctx primitives properly" is still open — ctx.digBlock/placeBlockAt already approach-then-act safely inside their own task, that's the natural home for it. Only live on bots that have process-restarted onto the new runner.js (see version-matrix audit, 2026-09-01) — most of the fleet still needs the rolling restart.
what: User observation (critical): bots attempt interactions far beyond survival
reach — "sometimes they try hitting things way too far away" — likely because
mineflayer defaults assume creative-like range. Survival limits: ~4.5 blocks for
block interact (dig/place/activate), ~3.0 for entity attacks. Out-of-range
attempts fail silently/hang server-side and plausibly EXPLAIN several open
quirks: bot.dig never resolving, /mine buried-target hangs, placeBlock false
blockUpdate timeouts, hunt swings missing.
fix: reach-guard in the engine — wrap bot.dig / placeBlock / activateBlock /
attack with a distance gate (conservative: 4.0 blocks / 2.5 entities): if out of
range, auto-approach (GoalNear r2-3) first, then act; log a "reach_violation"
counter per call site so we learn which skills over-reach. Ship as reachguard.js
payload first (fast rollout), fold into skills.js ctx primitives properly in P0.1.

### 2026-09-01 friedrich-driver — digguard version drift caused real confirmed damage (seen-again, concrete evidence)
type: safety
status: shipped(v10, part 1 of 3) — engine-dev 2026-09-01. GET /state.payloads now reports each payload's ACTUAL version by reading its global (skills:10, dangerscan:1, survival:1, digguard:2, reachguard:1) instead of booleans, so 'did my bot get digguard v2' is one cheap poll. Ask (2) inject-all.sh with role templating and (3) the DRIVER_GUIDE 'file changed = re-inject now' convention are still open.
what: Bumps team-lead's earlier "injection reports can drift from reality" entry from hypothesis to confirmed harm. My bot ran digguard v1 (8-column-only) for a whole multi-hour session while v2 (protected.json, 10 regions covering house_1/main_hall_1/farm_1/pond_1/pen_1) existed on disk and was already injected on other bots. I saw a file-change notification when v2 shipped, read the source, and judged it informational — nothing told me MY running bot hadn't picked it up, since there's no diff between "v2 exists" and "v2 is live on port 3101" visible without manually eval'ing `__digguard.version`. Consequence: chopping loops I ran inside the old blind spot caused real damage — main_hall_1 audited at 21 missing edge blocks (corner posts, walls) after the fact. Separately caught myself re-injecting idleguard.js RAW once (it's role-templated via `__ROLE__`, substituted at inject time) — no signal there either, a bot would just run with a role string that matches no branch.
fix: (1) GET /state (or a cheap __skills.status add-on) should report every payload's actual installed version by reading each global (`__digguard.version`, `__idleguard.version`, etc.) so "did my bot get the update" is a one-line check instead of tribal knowledge; (2) a single inject-all.sh that handles templating (role substitution) for every payload and prints back the version numbers it just confirmed, replacing the current hand-rolled `jq -Rs '{code:.}' file | curl ...` per payload that both the version-drift and the raw-template mistake stem from; (3) consider: when a watched file (skills.js/digguard.js/idleguard.js/etc.) changes on disk and a driver's tool result flags it, the driver-facing convention should be "verify + re-inject now," not "read for awareness" — worth calling out explicitly in DRIVER_GUIDE.md since the current phrasing reads as informational-only.
triage (2026-09-01, rollout-manager): partially addressed structurally by v8's auto-inject-per-spawn (the parent "injection reports can drift from reality" entry, shipped v8) — a bot on the NEW runner.js process re-reads every payload from disk on every spawn/reconnect, so drift can't persist past the next reconnect. Does NOT fix the visibility gap this entry is about (still only skills.js reports its own version in GET /state; digguard/graychat/panicguard/idleguard are booleans only) — that's still open, flagged to engine-dev-2. Live version-matrix audit (2026-09-01) confirms the concrete harm: 4 of 5 production bots were STILL on the pre-v8 runner.js process at audit time (including yours, 3101) — auto-inject doesn't help until a bot actually restarts onto it. Rolling restart in progress.

### 2026-09-01 friedrich-driver — panicguard vanishes mid-session with no restart/reconnect (2nd occurrence) — ROOT CAUSE FOUND
type: safety
status: shipped(v10) — engine-dev 2026-09-01, WITH A CORRECTION to the diagnosis (details appended as a new entry below: the other payloads did NOT survive the reconnect intact, they only LOOK like they did, and __panicguard was the wrong global name to check). Moot for panicguard itself: it is retired in favour of survival.js, which is auto-injected on every spawn AND marks itself stale if its bot is swapped out from under it.
what: Injected panicguard successfully earlier this session, confirmed `installed:true`. Many actions later, checked again during a routine payload audit — `typeof globalThis.__panicguard` came back "undefined". Re-injected. Team-lead independently flagged a prior instance too. ROOT CAUSE (confirmed, not hypothesis): a server restart happened right after (Rcon-announced, ~60s), my bot auto-reconnected (same runner.js process, control API never went down). Checked ALL payloads right after reconnect: skills v9, digguard v2, idleguard, graychat all survived intact. panicguard ALONE was gone again. So panicguard specifically does not survive a reconnect, while the others do — same failure class as the Movements-profile bug already fixed in v8 (reconnect re-runs createBot with a fresh object, and anything bound to the OLD bot/emitter instance via `.on()` listener gets orphaned). skills/digguard/idleguard/graychat apparently patch at a level (prototype/globalThis) that survives the swap; panicguard's `bot.on("health", onHealth)` listener does not.
fix: same shape as the Movements fix — rebind panicguard's health listener on every 'spawn' event, not just at inject time. Or fold it into the native engine work already planned (see the existing "promote panicguard into engine" entry) so it's not a removable eval global at all. Until fixed: worth a driver-facing note in DRIVER_GUIDE.md — re-verify/re-inject panicguard after ANY reconnect (kick, server restart, network blip), not just after a bot process restart.
triage (2026-09-01, rollout-manager): should be STRUCTURALLY fixed as a side effect of v8's auto-inject-per-spawn (applyPayloadStack runs on bot.on('spawn'), which fires on every reconnect, not just first connect — panicguard.js gets a fresh bot.on('health',...) bind every time). NOT yet verified live against a real reconnect on the new runner.js (your bot, 3101, was still on the old process at last audit) — worth a deliberate re-test once you restart to v9: force a reconnect (or wait for the next server blip) and confirm __panic survives without a manual re-inject. Flagging as a good verification task for whoever's testing v8/v9 live.
CORRECTION (2026-09-01, rollout-manager, likely closes this as a non-bug): this entry's own repro text checks `typeof globalThis.__panicguard` — but panicguard.js's actual source (line 8) sets `globalThis.__panic = g`, never `__panicguard`. That's a plain variable-name mismatch in the diagnostic, not a payload-survival bug: `__panicguard` would read "undefined" on every check regardless of whether the real payload (`__panic`) is installed and working. Asked friedrich-driver to re-check with the correct name (`typeof globalThis.__panic`) right after a genuine reconnect before this gets treated as a confirmed reconnect-survival bug — if `__panic` also comes back undefined, there IS a real bug and this note is wrong; if not, this whole "ROOT CAUSE FOUND" writeup was chasing a phantom. Don't build the rebind-on-spawn fix off this entry until that's confirmed either way.

### 2026-09-01 team-lead (from marcel-driver's idle gap) — farmCycle skill (rule-of-many)
type: rule-of-twice
status: open
what: The farm's harvest→sweep→replant→bake cycle is the most-repeated hand-driven
sequence in the fleet (dozens of cycles tonight) and stops dead whenever the
driver ends a turn without queuing the next pass — idle-guard's generic work
can't run it. Marcel's discipline fix (always end mid-task/queued) helps, but
this is an engine job.
fix: skills.js farmCycle({field, replant: true, bakeAt: N, depositTo}) — scan
field tiles for age-7 crops, harvest + immediate collect, replant from inventory,
optional bread-craft at a threshold + deposit; queueable + onEmpty-compatible so
the farm literally never sleeps. Uses existing tillFarmland request as a sub-step.

### 2026-09-01 team-lead (USER OBSERVATION) — task completion is invisible; idle-guard masks it
type: bug
status: shipped(v15 + idleguard v7) — see the duplicate "user observation" entry near the bottom of this file for the verified fix; closes github felsenuboot/felcrew-mcp#7 (issue-manager sync, 2026-09-01, verified against skills.js:1047 TASK_DONE + idleguard.js:54 "previous task DONE", commit 90c11a9)
what: User observed drivers not noticing their task finished — root cause: when a
task completes, idle-guard takes over with its own work, so the bot LOOKS busy
(moves, chats) and drivers watching movement/logs conclude the task is still
running and keep waiting. Fits the recurring "Still running — I'll wait" driver
wait-loops.
fix: make completion unmissable: (a) every __skills task completion emits a
distinct chat line "! done: <task> <result summary>" + a "TASK_DONE <name>" log
line Monitors can watch; (b) idle-guard's takeover announcement must state
"previous task DONE" explicitly; (c) driver doctrine (distribute): poll
status.task.done as the only truth — never infer task state from bot movement,
the guard makes idle bots look busy.

### 2026-09-01 peter-driver (via rollout-manager) — auto-inject needs a per-port role map for idleguard
type: bug
status: open
what: Confirmed during the fleet v9/v10 rolling restart (2026-09-01): idleguard.js is the one payload in the auto-inject stack that reliably comes up `false` (see the earlier "auto-inject payload stack" entry, shipped v8 — this was already known as a design gap, `--role` is opt-in and nothing passes it yet, but this entry captures the concrete operational cost now that a real rollout happened). Every one of the 5 restarted bots needed a manual driver step: read the role, `sed 's/__ROLE__/<role>/g' idleguard.js`, inject. Two of five drivers independently discovered the sed-substitution workaround themselves rather than being told — works, but it's tribal knowledge being reinvented per-driver instead of automated once.
fix: runner.js should own a small `roles.json` (or inline map) of `{portOrName: role}`, read at startup (or accept `--role` as spawn.sh already threads through) — applyPayloadStack's idleguard step already has the template-substitution code (it just needs a role value that isn't always null). Concretely: spawn.sh already CAN pass `--role`, the gap is that nobody's calling it with one yet — either update spawn.sh's own usage docs to make `--role` mandatory-by-convention for production bots, or have runner.js fall back to a lookup keyed by --name when --role is omitted, so a driver never has to hand-roll the sed substitution again.

### 2026-09-01 team-lead — reconnect backoff is flat 2s (thrash amplifier)
type: bug
status: open
what: During the server-restart storm every bot got into a duplicate_login kick
war with its own ghost session — flat 2s reconnect meant 150-330 connection
events per bot in 3 minutes, self-perpetuating until a full process stop + 35s
cooldown + sequential respawn cleared it.
fix: runner.js reconnect uses exponential backoff (2s→4s→8s→…max 60s, reset on
stable connection >2min); on duplicate_login specifically, wait ≥20s before the
next attempt (the ghost needs time to die). Optional: sequential jitter so the
whole fleet doesn't reconnect in the same second after a server restart.

### 2026-09-01 engine-dev — CORRECTION: payloads do NOT survive a reconnect; they only look like they do
type: bug
status: shipped(v10) — `__payloads` staleness registry + GET /state.stalePayloads
what: Measured directly on a test bot across a real server-restart reconnect, because friedrich-driver's panicguard entry concluded "skills/digguard/idleguard/graychat all survived intact, panicguard alone was gone". Both halves of that are wrong, and the true picture is worse. (1) `typeof globalThis.__panicguard` was always "undefined" — panicguard.js sets `globalThis.__panic`. That check could never have passed, reconnect or not. (2) The other payloads did NOT survive. Their globals did, because globalThis lives in the runner PROCESS, but a reconnect makes createBot build a FRESH bot object (runner.js:319), so everything bound to the old one is orphaned: measured after reconnect, `bot.dig` no longer had digguard's wrapper, `bot.chat` no longer had graychat's, `bot.pathfinder.setGoal` no longer had idleguard's, movements were back to stock (parkour on, maxDropDown 4, scaffolding restored, exclusionAreasBreak emptied). Every presence check still returned true. So "installed:true" has been reporting phantoms this whole time — this is the mechanism behind the entire "injection reports drift" class, and it is silent by construction. Worst case observed in principle: dangerscan's 4Hz loop keeps scanning the DEAD bot's stale world and reports a comfortable "calm" forever.
fix: SHIPPED. (a) Payloads register in `globalThis.__payloads[name] = {version, boundAt, stale}` and subscribe to their OWN bot's 'end' event, setting stale:true and stopping their timers — a payload now tells you it is dead instead of pretending. dangerscan/survival/digguard do this; graychat/idleguard/reachguard/panicguard still need the same 6 lines. (b) GET /state gains `stalePayloads: [...]`, and status().payloads (via dangerscan's status graft) shows "v2 STALE". (c) The structural fix is already in place from v8 — auto-inject on every spawn — so staleness should now be a transient that heals itself within one spawn event; the registry exists to catch the case where it does not.

### 2026-09-01 engine-dev — placement helpers must test boundingBox, not "is it air"
type: quirk
status: shipped(survival.js v1) — fixed in survival.js's placeAt; flagged because it is a whole CLASS
what: Found by live-testing survival.js's wall-off branch: the coffin sealed only 2 of 9 faces and still reported sealed. Cause: the placement helper skipped any cell whose block was not air, so a cell containing `leaf_litter` counted as "already occupied" — but leaf_litter, short_grass, torch, snow and friends all have an EMPTY bounding box and stop neither arrows nor mobs. The bot walled itself into a coffin with holes in it and believed it was safe. This is the same zero-shape-block trap as the documented leaf_litter/torch pathfinder wedges (blocks that are visually present but geometrically absent), just in the placement path instead of the movement path.
fix: the test is `block.boundingBox === 'block'`, never `!AIR.has(block.name)`. Non-air non-solid blocks must be DUG first, then placed into. Applied in survival.js (placeAt, the corner-step walkability check, and the exit-dig check) and the seal is now verified by re-reading the world rather than trusting a running tally. skills.js's ctx.placeBlockAt already handles this correctly via its NUISANCE set — but any NEW hand-rolled placement loop is going to hit this, so it is worth knowing before writing one.

### 2026-09-01 engine-dev — a coffin's roof cell has no reference block to place against
type: quirk
status: shipped(survival.js v1)
what: Second defect from the same live wall-off test. Sealing a 1x2 standing space needs a cap at feet+2, but on open ground that cell's only orthogonal neighbour below is the bot's own head space (air), so there is nothing to place against and the cap silently fails every time — the coffin stays open to the sky, which is precisely where skeletons shoot from.
fix: lay the four SIDE cells at feet+2 first (each has the head-ring block directly beneath it as a reference), which then gives the cap four solid neighbours. Costs 4 extra blocks on open ground and nothing underground, where those cells are already stone. Verified: 13/13 faces solid, sealed:true. Generally — any "place a block above my head in open air" needs a lateral reference laid first.

### 2026-09-01 team-lead (USER FEATURE) — chat diet: logs out of Minecraft chat
type: feature-request
status: shipped(graychat v3 + graybridge Discord sink) — see the duplicate "THE CHAT DIET" entry near the bottom of this file for the verified fix; closes github felsenuboot/felcrew-mcp#9 (issue-manager sync, 2026-09-01, verified against graychat.js's four tiers, commit 90c11a9)
what: User directive: routine LOG narration ("Heading to X", "Arrived", "Drop
sweep done: 0", idle-guard chore lines) must STOP appearing in Minecraft chat —
only INTERACTION (social messages to players/bots), PROTOCOL ledger lines, and
IMPORTANT announcements belong in-game. Current chore spam (~30 msg/min across
both fleets) drowns the channel.
fix: three-tier routing in graychat v3: default bot.chat() = LOG tier → bot log
file only (suppressed from game chat entirely); "@"-prefixed = INTERACTION →
gray via bridge, stays in chat ("@" stripped); "!"-prefixed = IMPORTANT → plain
white (existing); PROTOCOL regex lines unchanged (white, parseable). skills.js
ctx.say/idle-guard narration automatically becomes log-tier — no skill changes
needed. Drivers use "@" for conversational sends. Rollout fleet-wide after
verify; propose the same convention to CAVECREW (their spam is worse).

### 2026-09-01 friedrich-driver — dirt/leaf_litter accumulate unbounded in depot chests fleet-wide
type: quirk
status: open
what: Multiple times this shift I've found chest A/B/C stuffed with maxed-out stacks of dirt and leaf_litter (peaked at 270+ dirt, 143 leaf_litter in chest B alone) — these are zero-value items every bot's collectDrops sweeps pick up indiscriminately and then deposit alongside real loot. I manually withdrew-and-tossed them twice, but tossing near the depot just gets them re-picked-up by the next collectDrops pass through the same spot, so it's a losing battle by hand. Given every bot does this, it's clearly systemic, not a me-specific habit.
fix: either (a) collectDrops gets an optional/default ignore-list (dirt, leaf_litter, and other zero-value blocks) so sweeps don't hoover them in the first place, or (b) depositToChest silently discards known-junk items instead of banking them (with a `discarded` field in its result so it's not silent to the driver), or (c) both — the depot has finite chest slots and junk crowding out real materials is a real cost, not just aesthetics.
github: felsenuboot/felcrew-mcp#15

### 2026-09-01 karl-driver — plaza floor has a dark patch under open sky, light not propagating from new torches
type: bug
status: open
what: During the spawn-proofing sweep, found a ~3x11 strip of plaza_1's own floor (x=0..2, z=-1..9 — no roof registered anywhere over it) reading skyLight 0 / light 0 / surfaceExposed:false with the bot physically standing there (ruled out the known stale-remote-chunk-read quirk — this was a live, in-person read). Placed 11 torches spread across the strip as a direct fix; a follow-up scan showed most CELLS ADJACENT to a freshly-placed torch still read effective light 0, which shouldn't happen — torch block light should propagate outward regardless of skyLight. No hostiles were ever observed there (checked repeatedly), so this reads as a lighting-calculation bug rather than confirmed active danger, but it means "place a torch" isn't a reliable fix verification method right now — the status/light readback can't be trusted to confirm a torch actually resolved a dark spot.
fix: needs an engine or server-side look — possibly this world's frozen-daylight hack broke normal skylight/blocklight recalculation ticks for parts of the map, or there's a mineflayer lighting-cache staleness issue distinct from the already-known stale-remote-chunk quirk (this was NOT remote, bot was standing in the cell). Worth a repro: place a torch on ground in full daylight, immediately vs. after a delay, and check whether `blockAt(...).light` on the adjacent cell ever updates. If confirmed a world/server bug, drivers need a different way to verify "is this actually spawn-safe now" than reading `.light`/`.skyLight` (e.g., spawn a hostile mob to test, or just trust visual/structural torch placement over the light readback).
github: felsenuboot/felcrew-mcp#17
seen-again: (2026-09-01, karl-driver) ran team-lead's diagnostic — placed+immediately broke a cobblestone at (1,111,4) inside the strip to force a real block-update/light-recalc. Light stayed 0/0 before AND after; a control spot outside the strip correctly read skyLight 15, so the test methodology is sound — this is confirmed a genuine SERVER-SIDE bug, not stale client-side lighting cache. ESCALATION (CORRECTED, see below): this isn't lighting-only — a `bot.placeBlock` (chest) inside the same x=0..2,z=-1..9 zone at (0,111,9) failed repeatedly with `Event blockUpdate did not fire within timeout of 5000ms` and genuinely did not place (re-checked after settling); the identical action 6 blocks west at (-6,111,8) worked instantly, no error. So the zone appears to have broken block-UPDATE EVENTS generally, not just broken light propagation — that's a bigger issue than a cosmetic lighting bug (could affect any bot trying to dig/build/plant in that exact patch) and raises the priority of the ZetOmega/ops escalation team-lead queued up. Recommend nobody build/dig in x=0..2,z=-1..9 until diagnosed.
correction: (2026-09-01, karl-driver, per team-lead + PflasterPeter) the PLACEMENT-failure half of the escalation above was wrong — not a zone-wide block-update bug. Peter properly diagnosed it and then successfully placed/slabbed 30 cells IN the strip: `placeBlock` silently no-ops/times out when the bot's own hitbox overlaps the target cell (~1.5 blocks) — `GoalNear` doesn't prevent this (pathfinder considers itself "close enough"), a literal step-back (`setControlState`) does. My "6 blocks west worked" data point was the reposition fixing it, not leaving a bad zone — I just hadn't isolated the real variable. Retracting the "broken block-update events generally" claim and the build/dig avoidance recommendation for the strip. The LIGHTING half of this entry (skyLight 0/light 0 in open sky, confirmed via the place+break test) is UNCHANGED and still stands as a real bug — see #17. Spawn threat in the strip is now closed by Peter's slab work regardless of the lighting bug's root cause.

### 2026-09-01 karl-driver — sub-plaza cave is much larger than documented, no dedicated cave-mapping/sealing skill
type: rule-of-twice
status: open
what: BASE.md section 7 describes the cave under the plaza as a small "west-centre" pocket; it's actually a connected void spanning roughly x=-9..0, z=-2..9, y=105..109 (measured live). Also: quarry_ladder_1's registered column (-4,4) is actually solid/filled, not the open shaft the registry implies — had to dig a fresh 2-block entry from OUTSIDE the plaza at (-9,108-109,1) instead. Hand-placed ~20 torches across it via raw /eval loops (goto + multi-face placeBlock fallback) since there's no cave-lighting/mapping skill; also manually sealed a 5-block vertical shaft directly under crafting_table_1 with cobblestone the same way.
fix: (1) correct/expand the section 7 description of the cave extent and the quarry_ladder_1 status once someone maps it properly. (2) a `lightSweep`/`sealVoid` skill (mentioned as planned in an earlier engine triage note) would have made this whole job far more reliable than my hand-rolled multi-face placeBlock loop — this is exactly the kind of repetitive, error-prone-by-hand task the skill library is for.
github: felsenuboot/felcrew-mcp#16

### 2026-09-01 engine-dev — profile switches opened a 10s hole in dig protection
type: safety
status: shipped(v11)
what: Found while auditing P0.3's movement profiles against digguard v2. digguard wires its exclusionAreasBreak hook into `bot.pathfinder.movements` and re-wires on a 10s timer — but HAUL/WORK/CAVE each build a FRESH Movements object via setMovements(), which has never heard of digguard. So for up to 10 seconds after every profile switch (i.e. at the start of every travel task and every build task) the pathfinder planner was free to dig through the plaza floor, house walls and torch posts again. Nothing failed loudly; it just silently re-opened the exact hole the planner-level protection was added to close.
fix: SHIPPED. runner.js's baseMovements() now installs a LATE-BINDING hook (`globalThis.__digguard` looked up per call, tagged `__digguardBound`) so every profile inherits protection from birth regardless of payload injection order, and digguard's own wireMovements() checks for that marker so nothing gets double-wired. Verified: current/HAUL/WORK/CAVE each carry exactly one hook, all four return cost 100 for a protected block and 0 for a free one.

### 2026-09-01 engine-dev — shield doctrine prerequisites (P1.7 groundwork)
type: safety
status: shipped(v11) — the two engine-side blockers; the in-game half is still open
what: research/survival-doctrine.md ss1-2 flagged two stack-level problems that would break shields before anyone crafted one. Both confirmed present on this box and both now fixed at spawn. (1) mineflayer-auto-eat 3.3.6 defaults `offhand: true`, so it eats from slot 45 — the same slot the shield needs; they would have fought over it every meal. (2) mineflayer-armor-manager ranks materials worst-to-best as [leather, golden, iron, chainmail, ...], but chainmail is weaker than iron everywhere it matters (chestplate 5 vs 6, leggings 4 vs 5) — an iron-clad bot walking over a chainmail drop would auto-equip it and DOWNGRADE.
fix: SHIPPED. autoEat.options.offhand is set false in the spawn payload stack (visible as `autoEat: "offhand=false"` in the payload-stack log line). The armor ranking is reordered in place at plugin-load time to [leather, golden, chainmail, iron, turtle, diamond, netherite] — done at runtime rather than by editing node_modules, so it survives npm install. Verified live on both counts.
STILL OPEN (in-game, needs a driver with iron): craft 4 shields (6 planks + 1 iron ingot each — the single highest-value survival ingot we have) and `bot.equip(shield, 'off-hand')` as part of kit-up. Once a shield is in the off-hand, mineflayer-pvp handles the rest for free: it lowers the shield 100ms before each swing, re-raises 150ms after, and raises it for 2s when its target is a primed creeper. A shield blocks 100% of creeper blast damage. survival.js already uses a shield in CREEPER/BREAK_LOS/FLEE_HOME when one is present, and the deep kit tier already requires one.

### 2026-09-01 bernd-driver — CRITICAL: entity movement fully frozen server-side, survives relog AND full process restart
type: bug
status: open (instance resolved via one-time RCON rescue; engine auto-detect/auto-relog still unbuilt — see RESOLUTION note below)
what: BuddelBernd got completely stuck at (-11.063464664282362, 70, -2.3) mid-return-trip from the diamond run (8 diamonds banked in inventory, not at risk since server-side inventory persists). Symptoms: 'come'/goto fails with alternating "stuck: no movement despite an active path" and "path_GoalChanged"; bot.entity.position is BIT-FOR-BIT IDENTICAL across many seconds of raw `bot.setControlState('forward'/'jump', true)` calls — not just pathfinder failing to plan, the physics tick itself produces zero position delta, confirmed with jump (pure vertical, no obstruction — I'd already dug the ceiling clear) also producing zero y movement. onGround stays true, isCollidedHorizontally false, no effects/vehicle/nearby entities. Escalation attempted: (1) bot.quit()+auto-reconnect (worked ONCE earlier this session at a different stuck spot, documented in LEARNING_HANDOFF, but did NOT fix this occurrence — one hop succeeded then it re-froze at a nearby coord); (2) full process restart (./stop.sh + ./spawn.sh, ~20s gap for "server session cleanup") — bot reconnected with the EXACT SAME frozen position and is still stuck. Since a full process restart (brand new mineflayer Bot object, brand new TCP connection, brand new physics engine instance) reproduces the identical freeze at the identical coordinate, this cannot be a client-side bug — the SERVER's own entity/session state for this player is pinned at this position.
fix: needs server-side investigation (this is beyond anything a driver or the mineflayer client stack can fix — no combination of relog/reconnect/process-restart touches server state). Possible causes worth checking server-side: a stuck/duplicate player session for BuddelBernd's UUID that the server thinks still owns movement authority (note: "duplicate_login" kicks were also observed on this bot during the same general timeframe, see the server-instability report — may be related, a session zombie holding the real movement channel while our reconnects get a read-only view), a chunk/region the server has stopped ticking, or an anti-cheat/movement-validation rule silently rejecting all packets from this session. Until fixed: bot is unable to leave (-11,70,-2) and the fleet's only miner is stranded ~150 blocks underground holding 8 diamonds. No client-side workaround found after extensive attempts (~10+ relog/hop cycles, manual bot.dig to clear obstructions, tried multiple target directions/distances).
github: felsenuboot/felcrew-mcp#20 (also cited as supporting evidence in ZetOmega/cavecrew-mcp#2, the joint chunk-regen request)
github: ZetOmega/cavecrew-mcp#2 (issue-manager sync, 2026-09-01 — filed cross-repo as an ops/chunk-regen request, since this reads as world/chunk state rather than an engine bug; groups with UngaBunga's suffocation death and the plaza lighting anomaly as one 3-chunk incident, chunks (0,-1)(0,0)(-1,-1)); felsenuboot/felcrew-mcp#20 (own-repo mirror, tracks the remaining actionable item — auto-relog on the air/air/air-below+onGround:true signature — now that the resolution/root-cause is confirmed)
RESOLUTION (bernd-driver, 2026-09-01 23:5x): root cause confirmed by team-lead's direct
block diagnostic — CORRUPT CHUNK GEOMETRY, not the earlier "stuck at one exact coord"
symptom I chased first. The DETECTABLE PRECONDITION/signature: `bot.blockAt` reads AIR
at feet, head, AND the block below feet, while `bot.entity.onGround` still reports
`true` (plus a tiny negative y-velocity) — the client is floating on ground the server
no longer has. This state survives bot.quit()+reconnect AND a full ./stop.sh+./spawn.sh
process restart identically (both were tried and both failed, consistent with my
original report above) because neither touches server-side chunk state. Correcting my
own earlier account for the record: I initially believed repeated retries "resolved it
on their own" — they did not. Team-lead diagnosed the signature directly and extracted
the bot via a one-time, publicly-disclosed rcon rescue teleport at 23:36:45 (chat log:
`[FEL ops] Last-resort rescue tp: BuddelBernd was trapped in corrupt chunk geometry at
y70...`). Engine suggestion (team-lead's, seconding it): detect the
air/air/air-below + onGround:true + near-zero-negative-yVelocity signature in the
engine's own status/health checks and auto-relog on it — a relog IS sufficient once the
bot has moved off the corrupt geometry (confirmed working post-rescue), it's staying
pinned to the SAME corrupt block that defeats relog/restart on their own. Also: avoid
chunk (-1,-1) below roughly y~100 until this is fixed server-side.

### 2026-09-01 marcel-driver — surfaceExposed (v10 overhang fix) can also give a false negative
type: quirk
status: shipped(dangerscan v2) — rollout-manager sync: GitHub #18 was already closed by engine-dev-2, commit e99d273 ("dangerscan v2: settle sky exposure by geometry, not a single stale light read"). lightInfo() now samples three points (feet/head/head+1, max) and, only when still disputed, falls back to a 24-block column scan for a real solid block, returning skyViaColumn. Verified against the exact reported coordinates (beside pond_1): v1 would have wrongly reported surfaceExposed:false + 0.5 danger; v2 correctly reports surfaceExposed:true, viaColumn:true, score 0. Flipping this entry's status to match — it was still marked open despite the issue being closed.
github: https://github.com/felsenuboot/felcrew-mcp/issues/18
what: Standing in the middle of farm_1 (1.5,110.9,12.5), `__skills.status().bot` reported `light:0, skyLight:0, surfaceExposed:false` with `danger.score:0.5` — but a manual column scan straight up from that exact spot (y=111 through y=125) showed nothing but air the whole way, and there were zero hostiles nearby. So the new v10 fix (shipped this session for my original "self-position skyLight glitch" finding) inherited the same underlying issue: a bad self-read at the bot's own occupied block, this time propagating all the way into `surfaceExposed` and nudging `danger.score` up from a false signal. Earlier in the session the same bug showed as self=0/y+1=15 (so a neighbor check caught it); this time both self AND y+1 read 0 with a confirmed-open sky above, so a simple "check one block higher" workaround wouldn't have caught this instance either.
fix: `surfaceExposed`/`skyLight` in status should probably be computed from a small sample (self + 2-3 nearby/above points, majority or max) rather than a single block read, especially since it's now feeding `danger.score` directly — a driver treating a false surfaceExposed:false as gospel would abort/flee a perfectly safe farm tile. Cross-ref: the original entry above ("stale chunk data poisons remote blockAt surveys" / its seen-again note) — this is the same class of bug now visible through the new v10 API surface.

### 2026-09-01 friedrich-driver — hand-rolled place+strip+dig loses items unless equip AND every action gets its own settle tick
type: bug
status: open
what: Manually stripping oak_log (place → equip axe → bot.activateBlock(placed) → dig, no skill for this yet) to build karl-driver's wall posts. First batch: 15 attempts with only 4-tick gaps between place/activate/dig → 8 of 15 lost (block visibly showed `stripped_oak_log` right before the dig, but only 7 landed in inventory — matches the documented crafting-void pattern). Doubled the gaps to 16 ticks between place/activate/dig (matching the "800ms settle" crafting rule) — got WORSE, 17 of 20 failed, but differently: `blockAt` after activateBlock still read plain `oak_log`, meaning the strip itself silently didn't register at all (not a collection-drop issue this time). Swapped to `lookAt`+`activateItem()` per the bucket-fill quirk's fix pattern — same failure, block stayed `oak_log`. Finally isolated it with per-step diagnostics: the actual fix was adding a short settle (~5 ticks) AFTER EVERY `bot.equip()` call too, not just between place/activate/dig — once equip(log)→wait, place→wait, equip(axe)→wait, activateBlock→wait, dig→wait was the full pattern, 6/6 then 1/1 succeeded with zero further loss. Net cost of the diagnostic process: ~30 oak_log consumed for only 17 stripped_oak_log banked.
fix: the general "settle after every state-changing action, not just craft" rule needs to explicitly include `bot.equip()` — an immediately-following action (place/activate/dig) can race the equip and act with the PREVIOUS held item or an inconsistent inventory view server-side, even though `bot.heldItem` client-side already reports the new item. Given this is now three data points (craft, and two flavors of this), worth a `ctx.settle()` primitive in skills.js (a single named wait-and-verify helper) that every hand-rolled loop and future skill calls after equip/place/dig/craft, rather than every driver rediscovering the exact tick count by trial and error. Also: a `ctx.stripLog(pos)` or similar primitive belongs in skills.js given this is now a documented recurring need (Peter's torch_posts_1 rebuild used it too) — rule of twice.

### 2026-09-01 peter-driver — bot.placeBlock silently no-ops when the bot's own hitbox overlaps the target cell
type: quirk
status: open
github: felsenuboot/felcrew-mcp#19
what: Hit this repeatedly this session (plaza floor holes, path_1 gaps, and again placing cobblestone_slab over the dark strip): when the bot is standing within ~0.7-1.5 blocks of the exact target position — close enough that its collision box overlaps the target block's space — bot.placeBlock either throws a blockUpdate timeout or silently does nothing, even with a perfectly valid reference block and a held item. The fix that reliably works every time: force real physical movement away first (`bot.setControlState('back', true)` for ~0.5-0.8s, or a GoalNear to a waypoint 2+ blocks off) before attempting the placement — a GoalNear call alone often doesn't help since the pathfinder considers itself "already close enough" and never actually moves the bot. This cost real time across the session — every hand-rolled placement loop had to rediscover the workaround independently.
fix: buildFloor/buildWall/frameStructure/buildStaircase and any future placement primitive should check `bot.entity.position.distanceTo(targetPos) < ~1.5` before calling placeBlock and, if so, step back first (control state, not a goto) before placing. Alternatively wrap placeBlock itself in the engine to retry-with-backoff once on a timeout/no-op.

### 2026-09-01 friedrich-driver — charcoal pipeline: standing solution for the torch/coal shortage
type: feature-request
status: shipped (manual, live-verified) — not yet a skill
what: v11's kit-preflight rule (8+ torches per excursion) drained chest B to 0 coal / 0 torch fleet-wide within the same session it shipped. Stood up a renewable alternative: log-rich, coal-poor is the fleet's actual resource profile (300+ logs banked vs. near-zero coal most of this shift), and any log smelts into charcoal (coal-equivalent for torches, not for iron). Ran both furnace_1 and furnace_2 in parallel — 64 oak_log/64 birch_log as input, oak_planks as bootstrap fuel to get the first batch cooking, then fed a portion of the resulting charcoal back into each furnace's own fuel slot so the smelt is now self-sustaining (each batch cooks the next). First delivery: 90 torches crafted and banked to chest B from one round of collected charcoal, furnaces still running unattended for more. Heartbeat both leases per protocol (`USING furnace_1`/`USING furnace_2`) since this is a long-running lease, same as any furnace job.
fix (for the engine, this being a "rule of twice" candidate now that it's a documented pattern): a `smeltLoop` or `charcoalPipeline` skill — load N logs as input + a bootstrap fuel stack, poll until output appears, auto-feed a configurable fraction of output back as fuel, repeat until input exhausted, return total produced — would remove the current fully-manual openFurnace/putInput/putFuel/takeOutput cycle (which itself needs care: `putFuel` silently no-ops if called with a stale item reference right after `takeOutput()` shifts inventory — re-fetch the item from `bot.inventory.items()` immediately before every put call, don't reuse a variable captured earlier in the same eval). Standing doctrine going forward: reserve real coal for iron smelting, use charcoal for torches by default.

### 2026-09-01 marcel-driver — surfaceExposed false negative from stale light reads (issue #18)
type: bug
status: shipped(dangerscan v2) — engine-dev 2026-09-01
what: Reported by marcel-driver against the v10 overhang fix: standing in the middle of farm_1 at (1.5,110.9,12.5), status reported skyLight:0 / surfaceExposed:false / danger.score:0.5, but a manual column scan showed open air all the way up and no hostiles. Both the self AND y+1 samples read 0, so a neighbour-check workaround would not have caught it — the server's sky-light packets simply go stale, and v1 trusted a single read.
fix: SHIPPED. Light is now a hint and GEOMETRY is the authority. lightInfo() samples three points (feet, head, head+1) and takes the max; only when that still claims darkness does it settle the question by scanning the column for a real solid block (24 blocks, `boundingBox === 'block'`), returning true/false/null where null means "unloaded chunk, unknown" — never a guess. The scan runs ONLY in the disputed case, so the 4Hz cost is unchanged on the surface (skyLight > 0 short-circuits). The spawnable-dark danger bonus now also requires `surfaceExposed === false`, so a stale zero can no longer inflate the score. Status gains `skyViaColumn` so a driver can see which path answered.
REPRODUCED AND VERIFIED live at (2.7,109,11.7) beside pond_1: raw head skyLight 0, light 0, zero solid blocks in the 20 above — v1 would have said surfaceExposed:false + 0.5 danger; v2 reports surfaceExposed:true, viaColumn:true, score 0.

github: felsenuboot/felcrew-mcp#18 (issue-manager sync, 2026-09-01, closed)

### 2026-09-01 team-lead (from research/cavecrew-delta-2.md) — 3D-maxDistance fall-death + safeDescend zero-descent
type: safety
status: shipped(v14 + idleguard v6) — engine-dev-2 2026-09-01
shipped: (1) Δy gate at all three scan sites. skills.js gains `MAX_BELOW = 5`; mineLane's scan skips targets more than 5 under the bot's CURRENT feet (re-measured each rescan, so legitimate descent still works) unless `laneY` or the new `allowDeep:true` opts out; chopTrees gets the same filter for symmetry; idleguard v6 applies it UNCONDITIONALLY to both mineNearest and the drop sweep, because idle work should never descend and a drop that fell into a ravine is not worth climbing down for. Measured live at y=111 with a 64-block radius: the 3D sphere offered 818 targets more than 5 below the bot (41% of all candidates, reaching 12 down) — every one of them now filtered. Full happy-path re-verified after: mineLane banked 5 cobblestone, 0 lost, and its maximum descent over the whole task was 3 blocks.
(2) safeDescend net-descent assertion: feet-Y is compared against the previous step, and 3 consecutive steps with no depth gained abort with `stoppedBecause:'no_descent'` rather than looping (pathfinder's false "reached" plus digBlock returning `already` on air is exactly the 96-steps-for-1-level fiasco). NOT force-tested live — the failure needs a pathfinder false-reached to reproduce and I would not fake it; the assertion is pure arithmetic on feet-Y with a 3-strike counter, and normal descent runs were unaffected.
what: Two bug shapes we share with CAVECREW, both of which already cost them a bot. (1) findBlocks' maxDistance is a 3D SPHERE, so an idle-fired or laneY-less scan can select ore far BELOW the bot and walk it down a ravine — their Grog went y89->y26 and lost a full kit. Our mineLane's only Y filter is the optional laneY arg, idleguard's mineNearest filters on skyLight>0 which a ravine floor passes, and chopTrees has no Y filter either. Our safe Movements (maxDropDown 3, no parkour) prevent the lethal FALL but not the "descends legitimately, then is stranded and mobbed at the bottom" death, which is exactly how theirs died with safety movements already on. (2) safeDescend counts a step as done once the walk-down goto succeeds, but pathfinder can return a false "reached" with zero position change — their staircase ran 96 steps for 1 level of descent, ate the only pickaxe and sealed the bot in a pocket. Our step body would loop the same way (digBlock returns `already` on air, no progress, no abort).
fix: (1) default Δy gate at all three scan sites — skip targets more than ~5 below feet, overridable on mineLane via laneY/allowDeep and UNCONDITIONAL for idle work, which should never descend. (2) assert feet-Y actually decreased after each safeDescend step; N consecutive no-descent iterations abort with `no_descent`.

### 2026-09-01 team-lead (USER-CRITICAL) — right tool always; acquire before acting
type: safety
status: shipped(toolguard v2 + skills v16) — engine-dev-2 2026-09-01, verified on the local test server
shipped: (a) toolguard.js at the bot.dig choke point. It EQUIPS BEFORE IT REJECTS — a guard that only refuses would break every internal dig that happens to be holding the wrong thing, whereas equipping first actually delivers "right tool always". Resolution is grounded in minecraft-data (verified live): block.harvestTools present = a tool is REQUIRED for any drop, block.material names the class. Two severities on purpose — an unsatisfiable REQUIREMENT rejects (bare-handed stone yields nothing), a CLASS mismatch rejects for axe/pickaxe work (the visible "punching trees" case) but is ADVISORY for shovel/hoe, because dirt by hand is legitimate and gating it would break placeBlockAt's clear-a-block path and the stall-buster's nuisance digs. Per-call-site telemetry (bySite) shows which skills over-reach. Verified live: holding dirt next to a log, it swapped in the axe and dug (equipped +1); stone at 2.2m with no pickaxe rejected with `tool_missing: stone needs wooden_pickaxe (have dirt)`.
(b) __skills.ensureTool(bot, spec) + ctx.ensureTool — equip -> depot withdrawal (chest coords now in protected.json, DEPOT ledger line emitted) -> craft chain -> acquisition_failed. VERIFIED END TO END on a fresh world from a COMPLETELY EMPTY inventory with no depot in existence: tried both chests, gathered wood by hand, crafted planks, crafted and placed its own crafting table, crafted a wooden_axe and equipped it — 33s, `{ok:true, how:'crafted', item:'wooden_axe'}`.
(c) per-skill tool specs: chopTrees->axe, huntAnimals->sword, mineLane/safeDescend->pickaxe. Preflight WARNS rather than blocks, because the skill can now acquire what it lacks — blocking would refuse work the engine can fix itself.
(d) chopTrees and mineLane call ctx.ensureTool up front and fail with a clear tool_missing fatal if acquisition fails.
THREE bugs found by building it, all fixed: the acquisition chain hung forever on a raw pathfinder.goto with no timeout; it computed its material bill by guessing a fixed number of log conversions (a wooden tool costs FIVE planks — 3 head + 2 for sticks — not 3); and toolguard would have deadlocked the bootstrap, since logs drop by hand and you need wood to make the axe you'd need to get wood, so the craft chain's gather digs pass {force:true}.
github: felsenuboot/felcrew-mcp#30 (issue-manager sync, 2026-09-01 — phase-1, priority-high)
what: User escalation: bots MUST use the correct tool for every job — and if the
right tool is missing, ACQUIRE it first (depot withdrawal or craft chain), never
proceed with fist/wrong-tier/wrong-type tools. Current coverage is partial
(equipBestTool best-effort, idleguard harvestability gate, kit-tier pick counts)
— nothing REFUSES a dig/chop with a wrong tool, and nothing auto-acquires.
fix: (a) TOOLGUARD at the bot.dig choke point: resolve the correct tool class +
minimum tier for the target block; if absent from inventory → reject with
tool_missing {need} (catchable, like reach_violation); wrong-but-workable (hand
on log) also rejects unless force. (b) ensureTool(need) skill/primitive — the
CAVECREW steal-list item made ours: try equip → else depot chest B withdrawal
(DEPOT ledger line) → else craft chain via craftSafe (planks→sticks→tool at
crafting_table_1) → else return acquisition_failed so drivers/LLM escalate.
(c) kit preflight gains per-skill tool specs (chopTrees→axe, mineLane/safeDescend
→pick tier, shovel for bulk dirt). (d) __skills tasks call ensureTool up front.

### 2026-09-01 team-lead-workflow — Baritone has NO geofence; adapter is the only fence
type: safety
status: open
what: Dumped all ~300 Baritone settings: no exclusion-area/protected-region
  concept exists. minYLevelWhileMining=150 was IGNORED live (#mine selected
  targets at y86-94). #mine walks to the nearest CACHED ore — if that were under
  the plaza, it would dig there. Only adapter.mjs (127.0.0.1:3109) enforces the
  150-block mine fence / 60-block break-goto fence / allowBreak-false default.
fix: Never drive the sidecar raw for break-enabled jobs; keep all driving through
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)
  the adapter. Long-term: consider a server-side region plugin or adapter-side
  position watchdog that #stops on fence breach mid-job.

### 2026-09-01 team-lead-workflow — ashfinder ashDig bypasses digguard.js
type: safety
status: open
what: digguard wraps bot.dig (digguard.js:96) but ashfinder's executor calls
  bot.ashDig with raw block_dig packets — with breakBlocks on it can chew
  through BASE.md structures with no guard firing. goto2.patch.js closes it
  locally (corridor pre-check + ashDig wrapper) but that only protects /goto2.
fix: Move the ashDig wrapper into digguard.js permanently so ANY future
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)
  ashfinder use is covered, before wider adoption.

### 2026-09-01 team-lead-workflow — "No process in control" fires on give-up same as arrival
type: quirk
status: open
what: Baritone prints NOTHING on arrival; polling #proc is the only completion
  edge, but it reads identically when Baritone GIVES UP (observed: state "done"
  in 15s, bot never moved one block — underground, allowBreak=false, no legal
  path). Adapter now grades every /goto against real position (arrived:false,
  distanceToGoal). Anyone else polling #proc raw has this bug.
fix: Always verify position after any Baritone job; trust adapter `arrived`,
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)
  never `state:"done"`.

### 2026-09-01 team-lead-workflow — HMC stdin turn-stealing worse than parity; bcmd.sh 6 tries not enough
type: bug
status: open
what: SMOKE.md's strict-parity model is wrong: the launcher context swallowed
  SIX consecutive lines of `msg #set allowBreak true`. bcmd.sh TRIES=6 can lose
  a command completely — including a safety-critical #set, silently leaving
  digging enabled. Adapter fixed (14 tries escalating + #set confirmed against
  "Successfully set", throws otherwise).
fix: Port the adapter's retry+confirm logic into bcmd.sh.
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)

### 2026-09-01 team-lead-workflow — never drive Baritone with `.#`, only `msg #`
type: quirk
status: open
what: `.` (DotMessageCommand) runs on the HeadlessMc-CommandLine thread; #mine
  dies there with "IllegalStateException: BlockStateInterface must be
  constructed on the main thread". `msg` is a ScheduledCommand on the MC main
  thread and is safe. `.#goto` only survives by accident.
fix: Documented in BARITONE.md/DRIVER_GUIDE.md; adapter uses msg exclusively.
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)

### 2026-09-01 team-lead-workflow — movement-engines.md documents fictional ashfinder API
type: bug
status: open
what: §1.3 repeats README events (goal-reach, goal-reach-partial,
  waypoint-reached) that DO NOT EXIST in installed 4.6.2 — only `stopped` and
  `pathStarted` are emitted. Also §3.6's "no programmatic inventory access" for
  the sidecar is partially wrong: `gui` works under -lwjgl (slot-by-slot dump).
fix: Correct both sections so future engineers don't build on fake events.
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)

### 2026-09-01 team-lead-workflow — Baritone waypoint position reads return stale coords
type: quirk
status: open
what: home.mp4 accumulates records across sessions, unordered; a per-run tag
  counter collides with earlier runs — one read came back 50 blocks wrong.
  Adapter fixed (per-process tag prefix, newest-wins, reject records older than
  request). Anyone else parsing waypoint files inherits this.
fix: Reuse the adapter's parsing; never trust name-only waypoint lookups.
github: felsenuboot/felcrew-mcp#26 (consolidated Baritone sidecar findings)

### 2026-09-01 team-lead (user feature) — THE CHAT DIET + Discord sink
type: feature-request
status: shipped(graychat v3 + graybridge Discord sink) — engine-dev-2 2026-09-01
github: felsenuboot/felcrew-mcp#9 (issue-manager sync, 2026-09-01, closed)
what: User request — routine log narration should leave Minecraft chat entirely, and the LOG tier should feed a Discord activity feed rather than vanishing into files.
fix: SHIPPED. graychat v3 sorts every bot.chat() by prefix: unprefixed = LOG (local log + Discord, NOT chat), "@" = INTERACTION (gray bridge chat, @ stripped), "!" = IMPORTANT (white chat, ! stripped), PROTOCOL regex and "/" unchanged. skills' ctx.say and idle-guard chatter became log-tier with zero skill changes, exactly as the design intended. graybridge gains POST /log {name,text}: buffers and flushes ONE combined markdown message per 5s (webhooks rate-limit ~30/min, so never one post per line), drop-oldest past 200 queued, 429 backoff, and the webhook URL read from bots/.discord (gitignored) with a ~5s mtime re-read so it can be dropped in without a restart. Until that file exists it runs in MOCK mode and logs the exact payload it would have posted.
verified live: 4 separate POSTs flushed as a single batched message; on the test bot, 2 unprefixed lines went to the local log + bridge and NOT to chat, "@" reached gray chat, "!" reached white chat, counters matched exactly (sent 1 / logged 2 / passthrough 1).

### 2026-09-01 team-lead (user observation) — task completion is invisible; idle-guard masks it
type: bug
status: shipped(v15 + idleguard v7) — engine-dev-2 2026-09-01
github: felsenuboot/felcrew-mcp#7 (issue-manager sync, 2026-09-01, closed)
what: Drivers kept waiting on tasks that had already ended, because idle-guard takes over the moment a task completes and the bot still LOOKS busy. The chat diet made this urgent rather than optional: an unprefixed completion message would now be log-tier and never reach chat at all.
fix: SHIPPED. Completion emits a white in-game chat line via the "!" IMPORTANT tier plus a machine-greppable `TASK_DONE <name> <result>` log line; failures use the same tier (`!failed: <task> — <reason>`); idle-guard v7's takeover line opens with "previous task DONE" so movement after a task can't be mistaken for the task still running. Verified live: a collectDrops run produced importantTier +1 (white chat), logTier +1 (quiet narration), and the log line `TASK_DONE collectDrops {"picked":0,"unreachable":0}`.

### 2026-09-01 marcel-driver — hand-rolled eval loops report false success during a mid-loop disconnect
type: bug
status: open
github: felsenuboot/felcrew-mcp#27 (issue-manager sync, 2026-09-01)
what: A raw eval harvest loop (per-tile goto+dig+collect, each step wrapped in try/catch so one bad tile doesn't abort the batch) reported `{harvested:8}`, but only 2 wheat actually landed in inventory — the rest of the loop's iterations ran during a live `client timed out after 30000ms` / `keepAliveError` disconnect (confirmed via logs/MettMarcel.log), so every `bot.dig`/goto/pickup call after the drop silently rejected with "bot not connected", got swallowed by the per-tile catch, and the loop just kept incrementing its local `harvested` counter on the digs that DID resolve before the connection actually died server-side vs. client-side noticing. A following replant loop on the same tile set then reported `{planted:0}` while the bot was fully disconnected the whole time — again no error surfaced to me, I only caught it because the numbers didn't add up and cross-checked against real inventory counts.
fix: driver-side, worth building a habit of checking `bot.entity`/connection liveness before trusting a loop's local success counter, or at least sanity-checking counter vs. actual inventory delta after any batch (which is what caught this). Engine-side: a shared harvest/plant skill (see the existing tillFarmland/harvestGrass rule-of-twice entries) should check `bot._client.socket.destroyed` or similar per-iteration and abort the whole batch immediately on disconnect rather than let 6+ iterations silently no-op inside their own try/catch.

### 2026-09-01 research-synthesis — EVALUATION DOCTRINE adopted (EVALUATION.md + ALGO.md)
type: feature-request
status: picked-up — issue-manager 2026-09-01, tracking issues filed (mirrors the E1-E6/C1-C3 plan and all 4 follow-up FEEDBACK entries; still needs the actual implementation)
github: felsenuboot/felcrew-mcp#21 (telemetry layer + metrics.mjs, E1-E6), #22 (benchmark harness + baseline suite, C1-C3), #23 (__survival.drill hook), #24 (queue loop/onEmpty re-seed), #25 (runner.js goto response logging); labels `regression`/`bench` created per the doctrine's own ask
what: Four research tracks (literature, methodology, instrumentation, benchmarks)
  synthesized into bots/EVALUATION.md — the binding eval doctrine: verifier-graded
  16-value outcome enum (FSR/trust_gap, target 0), Tier-0 FEEDBACK-indexed fixture
  suite FIRST, cluster-over-routes statistics (ABBA, A/A first, SPRT), the 4-tier
  gate ladder with ROLLOUT BLOCKED semantics, telemetry.js JSONL ledger spec
  (task_start BEFORE kit preflight; orphanedGoto companion fix mandatory), token
  economy via transcript parsing (dedupe by message.id, never self-report), and
  ALGO.md (seeded, bench-written, separate from SCOREBOARD.md).
fix: engine-dev-2 owns the telemetry layer + metrics.mjs (EVALUATION.md §7 E1–E6);
  curator owns bench facilities/harness/cadence + ALGO.md upkeep (C1–C5) and files
  the 4 follow-up FEEDBACK entries listed there (__survival.drill hook, queue loop,
  telemetry tracking entry, goto response logging). Every future shipped(vN) entry
  gains a `test:` line naming its Tier-0 fixture, written by the OTHER engineer.

### 2026-09-01 kevin-driver — no reconnect visibility/tooling for MCP bot during full server outage
type: feature-request
status: open
github: felsenuboot/felcrew-mcp#29 (issue-manager sync, 2026-09-01)
what: During tonight's full server outage, every mcp__minecraft__* call returned
  "Cannot connect to Minecraft server at <host>:<port>" — a categorically different
  message from the "Bot is connecting to the Minecraft server. Please wait a moment
  and try again." seen during the two earlier server restarts (where plain wait+retry,
  8-20s, always cleared it live). The Kevin driver's toolset has no reconnect/restart/
  status tool at all (only get/move/dig/place/equip/craft/smelt/chat/find/list/look/
  jump-type tools) — no way to tell whether the underlying yuniko MCP bot object is
  quietly retrying on its own, or whether it's given up and needs an external
  process restart, and no way to force one either way. Framework bots have
  documented auto-reconnect w/ backoff (README.md) + v10 auto-inject on reconnect;
  Kevin has neither the visibility nor the lever.
fix: expose a lightweight reconnect-status (and ideally manual-reconnect) tool in
  the MCP server surface, or at minimum document/confirm whether the underlying
  yuniko minecraft-mcp-server retries indefinitely on its own after a hard outage
  (if so, this is just a docs gap — update LEARNING_HANDOFF.md's MCP-bot section
  with the confirmed behavior; if not, Kevin needs an external supervisor/health-
  check akin to runner.js's reconnect loop).

### 2026-09-01 engine-dev-2 — __idleguard.stop() silently stripped EVERY dig guard
type: safety
status: shipped(idleguard v8 + digguard v4)
what: Found while testing toolguard, and it is the most serious thing I have found tonight. idleguard patched bot.dig and its stop() restored the original by assignment (`obj[key] = orig`). Other payloads — digguard, reachguard, toolguard — wrap bot.dig ON TOP of that, so restoring took all of them down at once. Measured live: after one __idleguard.stop(), `bot.dig.toString()` was `function () { [native code] }` — the raw mineflayer method — while globalThis.__digguard, __reachguard, __toolguard and __idleguard ALL still reported installed. DRIVER_GUIDE tells drivers to call __idleguard.stop() for long manual travel, so this quietly stripped base-structure protection, reach limits and tool enforcement off a working bot mid-session, with every presence check saying otherwise. Same "presence is not liveness" class as the reconnect finding, different cause: patch-stack teardown rather than a swapped bot object.
fix: SHIPPED. idleguard v8 never restores — the wrapper stays installed and goes INERT when stopped (it only timestamps activity, harmless when disabled), and re-injection REBINDS the existing wrapper to the new state object instead of stacking another layer. Verified: after __idleguard.stop(), bot.dig is still wrapped and still rejects a toolless stone dig.
WARNING FOR ANYONE ADDING A GUARD — I tried the obvious defence (a timer that re-wraps when a guard notices it is gone) and it is a TRAP. Detecting "am I still in the chain" means walking it, and every wrapper must publish what it wraps for the walk to work; reachguard, graychat and idleguard do not. Two guards each checking only "am I outermost" re-layer over each other and form a cycle: 9.2 MILLION recursive dig calls in one live test. Both self-heals were removed. Fix the source instead. If a self-heal is ever genuinely needed, first make EVERY dig wrapper publish `__wrappedTarget` (digguard and toolguard now do), then walk that.
