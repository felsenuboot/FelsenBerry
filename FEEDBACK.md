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
status: shipped(farmskills v1) — engine-dev-3 2026-09-01. `__skills.harvestGrass({radius,count})`: findBlocks grass/fern, cut via ctx.digBlock (only ever matches grass names + skips ctx.isProtected targets, so it never touches terrain/structure), collectDrops filtered to seeds. Live-verified on the local server (cut to the count cap, seeds collected). Ships in the new `farmskills.js` module (auto-injected after skills.js), NOT the skills.js body. NOTE for #35: harvestGrass done; ctx.stripLog + ctx.settle still open (ctx.settle wants a skills.js makeCtx edit — coordinating with engine-dev-2 to avoid the shared-file collision).
github: felsenuboot/felcrew-mcp#35 (issue-manager sync, 2026-09-01 — bundled with ctx.stripLog/ctx.settle, phase-1, owner engine-dev-3)
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
status: picked-up (issue-manager sync, 2026-09-01) — items 2 and 5 filed as issues, both owned by engine-dev-2; item 1 already covered by ctx.placeBlockAt's own verify-on-timeout pattern (v7). Items 3 (external overseer) and 4 (death protocol) remain unfiled — larger structural items, next cycle.
github: felsenuboot/felcrew-mcp#33 (item 2, generation counter), #34 (item 5, 3-signal watchdog)
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
status: shipped(farmskills v1) — engine-dev-3 2026-09-01. `__skills.tillFarmland({rect|cells, plant})`: per cell equip-hoe + lookAt the TOP FACE (pos+.5,1,.5) + activateBlock(block,[0,1,0]) — the karl/marcel activateBlock-top-face fix baked in as the mechanic; clears grass/snow clutter first, skips protected/crop/water/non-soil cells, optional seed plant via placeBlock up-face with an own-hitbox step-aside. Live-verified on the local server: 15/16 plot cells tilled+planted, the water cell correctly skipped, hoe auto-acquired via ctx.ensureTool. Ships in `farmskills.js`. github #13 — this is the SKILL half; the separate farmland-reverting bug stays open (farmCycle re-tills reverted cells as a workaround, but the root-cause revert bug is unfixed).
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
status: shipped(basekeeping v1) — engine-dev-3 2026-09-01, github #4. BOTH halves. (a) `__skills.spawnProof({at|near, radius, cover, maxTorches})`: surveys standable dark cells near an anchor (a point, or a protected.json region id — "near registered structures" needs no new schema), greedily torches them. COVERAGE is torch-DISTANCE, not a light readback (this map's #17 lighting bug leaves skyLight stuck at 15 in a sealed room — verified live — so a light-readback loop would over-torch or never converge), and the darkness filter falls back to a GEOMETRIC roof check when skyLight is unreliable. Idempotent (a re-run finds existing torches as coverage and places 0 — safe as a periodic sweep) and reports unreachable cells instead of looping. (b) `__skills.structureAudit({ids?, maxDist})`: diffs protected.json regions vs the world and emits a `structure_damaged <id>(-N)` alert (chat + status.log) + structured result — PRECISE for column regions (the torch-post case), a present/air census for box/sphere. Live-verified on the local server: spawnProof torched a sealed dark room + reported walled-off cells unreachable + rerun placed 0; structureAudit reported 12/12 intact, then detected exactly the 3 cells knocked out. Ships in basekeeping.js (auto-injected after digguard, since the audit reads __digguard.regions).
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
status: shipped(farmskills v1) — engine-dev-3 2026-09-01. `__skills.farmCycle({field, crop?, replant, bakeAt, bakeTable?, depositTo})`: survey ripe crops (age-max only — immature never dug), harvest via ctx.digBlock, collectDrops (seed/product filtered so it doesn't hoover junk), replant empties AND re-till any cell that reverted to dirt/grass (self-heals the farmland-revert bug), optional craftSafe bread at a wheat threshold, optional deposit (made NON-FATAL — a blocked chest logs + returns instead of erroring the whole cycle/queue). A no-ripe-crop pass is a fast no-op, so it is safe as a queue onEmpty fallback (the farm never sleeps). Live-verified full path on the local server: harvested 4/replanted 4/baked 4/deposited 10, no-op pass clean, retill path healed a reverted farmland cell. Ships in `farmskills.js` (auto-injected after skills.js, persists across reconnects). github #5.
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
status: shipped(skills.js v26 + stripLog) — engine-dev-3 2026-09-01, commit c860899, github #35. BOTH primitives. (1) `ctx.settle(ms=120)` in makeCtx: the named wait-after-every-state-changing-action helper, with the equip-race WHY in the comment (bot.heldItem reports the new item client-side before the server has applied it, so the next action races it — the fix is a settle after EVERY action, equip included, not just the crafting 800ms rule). Skills/loops call it so the discipline is the default. (2) `__skills.stripLog({pos|cells|rect})`: strip placed logs → stripped_ variant (axe activateBlock, no dig) for aesthetic posts; acquires the axe via ctx.ensureTool, re-equips before each activate, uses ctx.settle around it, never strips protected structure or non-logs. Live-verified: stripped an oak+spruce log (stripped:2), re-run idempotent (already:2), a stone in the list skipped (not_a_log). This COMPLETES #35 (harvestGrass shipped earlier in farmskills v1). ctx.settle is now the shared primitive every future skill/loop should use after equip/place/dig/craft.
github: felsenuboot/felcrew-mcp#35 (issue-manager sync, 2026-09-01 — bundled with harvestGrass, phase-1, owner engine-dev-3)
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
status: shipped(digguard v5) — engine-dev-3 2026-09-01, commit fbae83c, github #26 item 1. Level-3 bot.ashDig wrap folded permanently into digguard, reusing g.hit (protected.json regions + match regexes + neverProtect — ONE lookup, not goto2.patch.js's parallel box list, which is now redundant). typeof-guarded (no-op on the normal fleet, live only where ashfinder loads), idempotent re-wrap on the reload timer so a /goto2 loaded AFTER digguard is covered within ~10s. Live-verified: a block in cavecrew_camp and an oak_log in house_1 refused BEFORE the real ashDig runs (chest never broken), non-matching dirt + open-field passed through, ashBlocked counted the refusals. goto2.patch.js's guardAshDig can stay as cheap defense-in-depth or be dropped — digguard is now authoritative.
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

### 2026-09-01 engine-dev-2 — ctx.gotoFar multi-leg waypointing (SYNTHESIS P2.8 / issue #31)
type: feature-request
status: shipped(v17, commit 07e0ee4) — engine-dev-2 2026-09-01, live-verified on the local server
shipped: ctx.gotoFar walks a long trip in ~80-block ground-snapped legs, re-snapping the NEXT waypoint after every leg (its chunks have loaded by then), falling back to GoalNearXZ for columns it still cannot see, on the HAUL profile, aborting after 2 consecutive legs that gain <10 blocks. `come` now routes anything over 80 blocks through it, retiring the standing "/goto 60s timeout" backlog item.
evidence: a 223-block haul walked 207 blocks in 91s across multiple legs with no wedge. It then died at 21 blocks out with path_Timeout — and that failure taught the real lesson: a long haul is aimed at an XZ and whatever ground is there, so the caller's Y is usually a GUESS, and a GoalNear to a Y that turns out to be open air makes pathfinder search exhaustively. The final approach now re-snaps the destination once its chunks are loaded, falling back to GoalNearXZ if even that fails. Verified after the fix: asked for Y=150 where the real ground was Y=72 (wrong by 78 blocks), it snapped to 72, reported finalVia:'ground', and arrived within 3 blocks in 11s.
The no_progress abort got verified too, unintentionally but usefully: the test bot ended up on a cliff ledge with solid gravel at head height to the west and drops on the other three sides, and gotoFar correctly called it blocked in 54s and 72s instead of grinding. Worth knowing for drivers — that abort firing usually means the TERRAIN is blocked, not that gotoFar is broken.
github: felsenuboot/felcrew-mcp#31 (already filed by issue-manager 2026-09-01, phase-1/priority-medium/owner-engine-dev-2 — this entry confirms it's now actively picked up)
what: Long hauls fail not because the movement engine is bad but because one A* over 200+ blocks of broken terrain can't finish inside the think budget, and the far chunks aren't loaded so the geometry is unknown. Hand-driven as "loop it, multi-leg" more than twice (rule-of-twice met).
fix: ctx.gotoFar per research/movement-engines.md ss2.7 — ground-snapped legs every ~80 blocks, GoalNearXZ fallback for unloaded columns, re-snap each leg after chunks load, HAUL profile, abort after 2 consecutive legs making <10 blocks of progress.

### 2026-09-01 engine-dev-2 — harvest-distance law converted to an engine gate (laws->gates audit)
type: feature-request
status: shipped(v18 + idleguard v9)
what: The "gather >=25 blocks from the plaza" rule was the last per-action check in DRIVER_GUIDE still living purely in driver habits, which the determinism codicil forbids. Its safety half was already gated (ctx.isProtected stops chopTrees targeting a structure's logs); the residual buffer is aesthetic — keeping the base's immediate treescape intact.
fix: SHIPPED. protected.json gains a `harvestExclusion` list (cylinder or box, with `appliesTo` scoping), consumed by `__skills.harvestAllowed(pos, kind)` at TARGET SELECTION in chopTrees and in idleguard's mineNearest. Horizontal distance only, and mineLane is deliberately NOT gated — quarry_lane_1 is at the base on purpose and a driver-issued mining task is not what the rule was written for. Verified live: blocked at 24 blocks, allowed at 26, mineLane unaffected at the plaza centre. Fails OPEN if the config is unreadable.
Full audit table in LAWS_AUDIT.md — 11 laws now gated and ready for the curator to retire, 3 genuine gaps (lease heartbeats during long smelts, deposit-excess trigger, two-bot rendezvous), and a list of rules that are judgement rather than checks and should STAY written down.

### 2026-09-01 team-lead — SOAK RESULT: driverless survival SOLID, productivity agenda-blocked
type: milestone-evidence
status: open
what: SoloSauhund (driverless, pure v16 engine, no LLM) ran 30 min on the local
server: ALIVE, HP/food 20/20, zero deaths — survival/dangerscan/kit systems work
fully autonomously. BUT productivity is nil: idle-guard's single-role default
loops "previous task DONE — sweeping drops, waiting for orders" → chopTrees fails
(no tree in range on fresh world) → come fails. The phase-1 scoreboard reads:
SURVIVAL pillar ✓ driverless-proven; SELF-DIRECTED-PRODUCTIVITY pillar ✗ —
blocked precisely on the missing agenda (#28). This is the strongest evidence yet
that the agenda is THE phase-1 capstone: a bot that survives but can't choose
useful work is not a self-sufficient player. Re-run this soak WITH agenda.js
injected = the phase-1 acceptance test (AGENDA-DESIGN.md §acceptance).
Secondary bug: "come — travel failed: Took too long to decide path to goal!"
repeats — pathfinder thinkTimeout exceeded (idle-guard issuing come to a hard/
unreachable target on fresh terrain). The agenda must fail-fast on undecidable
paths rather than retry-loop; note for gotoFar/come hardening.
fix: ship #28 (agenda) — it IS the fix. Keep SoloSauhund alive as the standing
acceptance-test bed; inject agenda.js into it the moment it's built.

### 2026-09-01 engine-dev-2 — telemetry ledger E1-E3 (EVALUATION.md / issue #21)
type: feature-request
status: shipped(telemetry v1 + runner + skills v19) — live-verified on the local server
what: The measurement foundation the autonomy-soak benchmark needs to score phase-1, built to "verifier-or-it-didn't-happen": a task that CLAIMS success is not counted as success until an independent assertion agrees, and false_success is the headline metric with a target of zero.
fix: SHIPPED, all three in one commit as required.
E1 telemetry.js — single-writer JSONL ledger at logs/metrics-<bot>.jsonl, 500ms odometer/vitals sampler, tool-break watcher, per-goto aggregation of pathfinder's own path_update/path_reset telemetry, routeClass, adg/SALIENT/INV_KEYS, and classify() implementing the closed 16-value enum with exact precedence. Verified: an idle bot writes session + connect and nothing else.
E2 runner.js — installed ONCE per bot instance in createBot, NOT on spawn (spawn fires again on every reconnect and would stack a fresh listener set each time — the same leak class as tonight's guard bugs). GET /metrics added. The non-negotiable companion fix shipped in the same commit: telemetry permanently owns a path_update listener, so the bare `listenerCount > 1` orphan detector would have reported a leak on every instrumented bot forever; it now subtracts __metrics.pathListeners. Verified: orphanedGoto still false on an idle instrumented bot.
E3 skills.js — 6 call sites, no logic changes. task_start fires BEFORE the kit preflight and a kit rejection emits its own matched task_end, so refusing to depart lands in the denominator instead of being invisible. task_end emits in the IIFE BEFORE _onTaskEnd (which starts the next task synchronously, so emitting after would order the ledger wrongly). goto spans open in ctx.goto and close in its existing finally, which already covers return/throw/Cancelled. Plus wedge on _unstick, craft under-production, and retry counting.
The ASSERTS table lives next to the registry and deliberately OUTSIDE every skill's fn — an assertion that lives inside the code it judges is worthless the moment that code is what's lying.
CAUGHT A REAL SPECIMEN ON ITS FIRST RUN: a `come` produced two goto spans (one with 3 unsticks, one no_path), classified outcome:"wedge" by the precedence table, with assert:"come.arrived" and yield:0 — the bot did not reach its target and the ledger said so independently of the skill's own reporting. That is the entire point of the design, demonstrated unprompted.
E4 SHIPPED TOO (dangerscan v3 + survival v3): danger emits on state TRANSITIONS only — a 4Hz loop would drown the ledger for no analytical gain — and survival emits panic enter/recovered with the branch. Verified live by forcing a calm->alert->calm transition through the normal code path and a real enter() panic: 4 events, correct prev/state/branch/hp, and no per-scan noise. The other guards (idleguard/digguard/reachguard/toolguard) stay read-only via the 60s diff rollup, which needs no edits to them at all.
still open: E5 roster.json + metrics.mjs aggregator, E6 version pinning + gate report.

### 2026-09-01 engine-dev-2 — agenda.js: the autonomous ladder (issue #28, phase-1 capstone)
type: feature-request
status: shipped(agenda v1 + skills v20) — engine-dev-2 2026-09-01, live-verified on the local server
what: The deterministic brain that makes a bot self-sufficient with no driver. Architecture A (priority ladder) per research/AGENDA-DESIGN.md with D's test-hook graft. The LLM sets ONLY the project, once; the ladder runs it at zero tokens per cycle.
fix: SHIPPED. Ten fixed rungs top-down (REFLEX > POSTURE > EAT_CRITICAL > DEPOSIT > EAT > TOOL > RESTOCK > LIGHT > PROJECT > IDLE), each with a dual-threshold fire/clear so the owner latches — that gap IS the hysteresis. Subsumes idleguard on install (exactly ONE deliberative loop; two of them fight over goals, our most-reported field hazard) and it is v8-safe, so the dig-guard stack layered above idleguard survives the stop(). Test hooks per the graft: __agenda.step(snapshot) dry-runs the choice WITHOUT executing, sense() accepts an injected world, and every rung is individually callable.
VERIFIED: 12 synthetic worlds each select the intended rung, and precedence holds where it matters — starving+full-inventory picks EAT_CRITICAL (eating is 2s, starvation is irreversible), and panic+starving+full+toolless picks REFLEX. Hysteresis proven directly: with EAT owning, food 18 stays EAT and only food 19 releases; TOOL latches through the 15->25 durability band. A latched owner is still preempted by REFLEX. Live: it ran a repeat project to completion repeatedly with 0 errors, and on a fresh spawn as `miner` with no pickaxe it correctly picked TOOL on its first tick.
THREE real defects found by live-running that no dry-run could catch, all fixed:
1. A rung that fires but CANNOT act latches forever and starves everything below it (RESTOCK, which has no engine skill yet, froze the whole ladder). Fixed generally, not per-rung: any act reporting no progress stands its rung down with escalating backoff (30s/60s/120s/300s) so lower rungs run; the need still re-fires later, it just stops being a deadlock.
2. A single act() that never settles freezes the ENTIRE ladder, because tick() returns early on A.busy. Observed live: busy:true, zero ticks for minutes, timer alive, owner null — perfectly healthy from outside. Every act is now raced against a 180s cap so the loop always gets its busy flag back, plus a second-line force-release. For a bot meant to run driverless for hours this was the worst failure shape available.
3. ensureTool's plank bill ignored the 4 planks a crafting table costs, so a bot with 3 planks could afford the tool head OR the table but not both, gathered no wood because the bill said it had enough, and failed at the last step. Found BY the agenda's TOOL rung. Fixed (skills v20) and verified: gathered 7 planks, crafted and placed its own table, crafted the pickaxe.
DELIBERATELY OPT-IN: runner.js injects agenda only with --agenda (or AGENDA=1), NOT by default. It subsumes idleguard and starts tasks on its own, so enabling it fleet-wide before the phase-1 acceptance test has run would hand five driver-controlled bots a new brain at once. It does yield to a driver's task correctly (the task mutex makes S.start return busy, which the ladder treats as no-progress), but that is a claim the acceptance test should prove, not one to ship on. Flip the default when the soak passes.
NOT YET RUN: the 5-part phase-1 acceptance test (3h driverless, zero deaths, zero false-success, needs met in order under induced stress, project completion, wedge+relog recovery). RESTOCK now HAS its skill (skills v21): `restock {needs:{item:target}}` takes FLOORS rather than deltas, so it is idempotent — calling it when already stocked is a no-op, verified. It routes through the depot chests from protected.json and reports what it could not find instead of pretending: on a world with no depot it returned {got:{}, short:{torch:16}, stocked:false}. The agenda's RESTOCK rung now calls it (torches->torch, food->bread, filler->cobblestone, the fleet's standard stand-ins per DEPOT.md).
Worth knowing about the interaction: with NO reachable depot the skill's travel ladder takes ~200s to exhaust, which exceeds the agenda's 180s act cap — so the ladder stands RESTOCK down mid-flight and carries on. That is the defence working as designed rather than a conflict, and on a real base with chests present the travel is short.

### 2026-09-01 engine-dev-2 — telemetry E5 aggregator + a REAL false-success it caught
type: feature-request
status: shipped(metrics.mjs + roster.json + skills v23)
what: E5 of the eval track — the aggregator over telemetry's JSONL ledger, plus the roster.json role fallback.
fix: SHIPPED. `metrics.mjs` implements the frozen formulas: SR (verified) vs naive_SR with the trust_gap between them as the headline integrity number, FSR with an explicit ALARM at any nonzero, DFR, under-production, and per-route-class movement (SPL, wedge rate, median duration). Two anti-Goodhart rules are ENFORCED rather than left to discipline: bad_input is excluded from every denominator (a driver typo is not an engine failure), and cells with n<5 are SUPPRESSED rather than printed with a wide interval, because 1/1=100% reads like triumph. Wilson intervals throughout, never Wald. `--baseline write|compare`, `--ab`, `--by skill|role|bot`, `--json`.
`--tokens` is deliberately NOT faked: cost-per-outcome is co-primary with success rate, so an invented number would be worse than none. It needs per-message counts with message.id dedupe (the same message appears in many transcript rows) and that source isn't in this ledger, so the flag explains what to feed it instead of guessing.
roster.json also closes the "per-port role map for idleguard" entry: runner.js now falls back to it when --role is omitted, so nobody hand-rolls a sed substitution again. Verified — a bot spawned with NO --role came up as role:builder with idleguard auto-injected.
THE AGGREGATOR IMMEDIATELY EARNED ITS KEEP. First run over 105 real task_end records: SR 75.2% verified vs 80.0% naive — a 4.8% TRUST GAP — with 5 false_success, all the same specimen: `come` returning done with NO error while never reaching its target. Two follow-ups came out of investigating them, and the second is the interesting one:
(a) the specimens were UNDIAGNOSABLE, because SALIENT.come deliberately stores only `range`, not coordinates. The assertion now embeds the numbers in its own rule string — `come.arrived(d=2.83,limit=1.5)` — so the next specimen explains itself.
(b) the assertion had a UNIT MISMATCH: it compared the bot's float entity position against an integer block target, and a bot standing ON block y has position y+1, so every call was charged ~1.0 of phantom distance and a bot standing exactly where it was asked could be failed. Now compares block-to-block, the same way GoalNear defines arrival.
What I did NOT do: loosen the limit to make the alarm quieter. Widening a verifier until it stops complaining is how a false-success metric becomes decorative. The fix was a unit correction with the genuine misses (2.8 and 3.4 blocks out) still failing.

### 2026-09-01 engine-dev — bench bot found taking real damage at a fixed underground spot, unclear if related to #20
type: bug
status: open
github: felsenuboot/felcrew-mcp#40 (issue-manager sync, 2026-09-01)
what: Mid-way through bench/ Tier-0 harness debugging, found the bench bot (KaputtKuno, local server 3130) pinned at a fixed underground position (233.5, 61, 83.5) with HP fluctuating non-monotonically (~11-18) — real ongoing damage, not a one-off hit. The stale ring-buffer log from around that time shows `panic_enter (hp) hp=8 threat=no visible threat` followed by `panic_recovered branch=ENV hp=20` — survival.js DID engage and recovered it once, but the position/damage pattern recurred. Rescued manually via RCON (tp to (0,150,0) + instant_health + resistance); bot was healthy afterward and none of this repro'd again once relocated.
CAVEAT — I did NOT verify the specific #20 signature (bot.blockAt reading air at feet/head/below-feet while onGround:true with near-zero negative y-velocity, i.e. genuinely frozen/unable to move). I only observed position + fluctuating HP + the panic log line, then rescued rather than diagnosing further, so I can't confirm or rule out that this is the same corrupt-chunk-geometry bug class vs. ordinary combat with an unseen mob (this local world has unpredictable cave/void terrain at arbitrary Y levels, independently confirmed all session) that had nowhere to flee to. "threat=no visible threat" is suggestive but not conclusive either way — dangerscan may just not track whatever was hitting it (e.g. a mob behind a wall, or fall/suffocation damage misattributed).
fix: not proposing a fix yet given the diagnostic gap above. If this recurs, the useful capture next time is: `bot.blockAt` at feet/head/below-feet + `entity.onGround` + `entity.velocity.y` (the actual #20 signature) BEFORE rescuing, taken while still stuck. Also worth checking separately: bench bots run with idleguard stopped (EVALUATION.md doctrine) but survival.js stays active per this log — confirm that's still true fleet-wide and that a bench run stopping idleguard never accidentally also disables survival's flee/recover path.

### 2026-09-01 team-lead + engine-dev-2 — agenda PROJECT rung never fired (agenda-level false-success)
type: bug
status: shipped(agenda v2 + skills v26) — verified on SoloSauhund/3120
what: team-lead ran the acceptance soak and found the ladder never fires PROJECT with a valid project set. Root-caused to projectDone() returning true for a project that had never actually been accomplished — an agenda-level FALSE-SUCCESS, the exact class the telemetry hunts, one layer up.
fix: FOUR defects, each found by the one before it.
1. `completedOnce` was set on `task.done` — the engine's OWN claim, i.e. naive success, the precise thing the ledger exists to distinguish from verified success. A safeDescend that ran and did not descend marked the project done and the bot silently abandoned a goal it never achieved. Now graded with `__skills.assertTask`, EXPORTED so the agenda and the telemetry use the SAME independent verifier — two notions of "done" would drift, and the ASSERTS table's whole point is that success is graded by something other than the code being graded. An unverified run stands the rung down with backoff and retries instead of being marked complete.
2. On the live bot the immediate cause was different and worse: the project was permanently `blocked:'kit_missing'`. The gate was right — 1 pickaxe and 2 filler against an underground kit needing 2 and 16 — but the ladder had GIVEN UP on a shortfall its own TOOL and RESTOCK rungs exist to repair. kit_missing and no_tool are now never permanently blocking, and `activeFloors` reads the project's actual KIT TIER (exported as `S.kitTiers`) rather than the role default, so the maintenance rungs aim at the requirement that will actually refuse the departure. Before: only IDLE fired. After: TOOL, RESTOCK and PROJECT all fire at the real shortfall.
3. TOOL then latched forever, because `ensureTool` answered "you already hold one" to a request for a BACKUP. Added `{spare:true}`, and the rung verifies the count actually moved rather than trusting the call's success. Verified live: picks 1 -> 2.
4. RESTOCK then looped forever, starting a restock every cycle on a world with no depot — its task COMPLETED cleanly each time while its own condition stayed unmet. Same "completed but did not achieve" shape as (1), one layer down. Added a general detector: any non-safety rung whose skill finishes while its own fire() is still true twice in a row stands down. Verified live — it logged "RESTOCK completed its work twice without meeting its own condition", stood down, and the ladder fell through to useful work with 0 errors.
STILL OPEN, and it blocks the soak on a fresh world: RESTOCK can only WITHDRAW, so on a world with no depot the 16-filler requirement is unmeetable and safeDescend's kit gate keeps refusing. Either fixture 16 cobblestone into the soak bot, or give RESTOCK a produce-fallback (mine cobblestone when the depot can't supply it) — the latter is real phase-1 self-sufficiency work and worth its own issue.

### 2026-09-01 engine-dev-2 — agenda: RESTOCK can PRODUCE what the depot cannot supply
type: feature-request
status: shipped(agenda v2)
what: The acceptance soak was blocked on a requirement no rung could satisfy. safeDescend's underground kit wants 16 filler; on a fresh world there is no depot, RESTOCK can only WITHDRAW, so the gate refused forever — correctly, and permanently. A bot that can only acquire by withdrawing is not self-sufficient, which is the phase-1 bar itself.
fix: SHIPPED. When a restock comes back short on filler and the bot holds a pickaxe, RESTOCK mines it instead of asking an empty chest again (mineLane on stone, with force — mineLane's own kit tier wants the very filler we are there to obtain, the same sanctioned exception as ensureTool's bootstrap wood digs; gathering stone at the surface is not the deep excursion that gate protects).
Also: `busy` from S.start is now transient rather than a failure. The engine being occupied for two seconds was earning a rung a 30s backoff, which is a real condition treated as a fault.
VERIFIED END TO END ON SoloSauhund, driverless, no LLM in the loop: the ladder repaired its own kit (TOOL acquired a spare pickaxe 1->2, filler reached 48), PROJECT then fired and the bot descended y96 -> y58 with zero errors — and at y62 the LIGHT rung correctly PREEMPTED the project to torch a dark cell. That is the priority ladder doing precisely what it exists for: a higher need interrupting a running project, then handing the body back.

### 2026-09-01 engine-dev-3 (cross-verify) — RESTOCK broke the ladder's own hysteresis invariant
type: bug
status: shipped(agenda v3)
github: felsenuboot/felcrew-mcp#39 (issue-manager sync, 2026-09-01, filed+closed)
what: engine-dev-3 root-caused the SoloSauhund RESTOCK-churn BY READING agenda.js, and it is a real bug in my code. The file header states the invariant — "fire() and clear() are deliberately different thresholds on every rung; that gap IS the hysteresis" — and RESTOCK was the one rung violating it: fire and clear both used the bare floor, and act topped up to EXACTLY the floor, so the floor doubled as the operating level with no buffer anywhere. Against a project that CONSUMES the resource the result is a boundary bounce: safeDescend places a torch, dips one below the floor, RESTOCK (prio 6) preempts the running PROJECT (prio 8), tops back to exactly the floor, clears, PROJECT resumes, burns one, repeat — chopping the descent every few seconds (PREEMPT_DEBOUNCE puts the period around 4s, matching the observed churn).
fix: SHIPPED. clear() now requires floor * 1.5 and act restocks to that buffered target, so resupply overshoots and ordinary consumption no longer re-crosses the trigger. The mine-filler path mines a BATCH (min 16) rather than the bare gap — mining an exact 1-block shortfall was the same no-buffer mistake with a whole mining trip as its cost.
verified by dry-run against synthetic worlds (miner floor 16 -> clears at 24): t15 fire/no-clear, t16 and t20 NEITHER fire nor clear (the band), t24 clear. With RESTOCK owning it holds through t17 and t23 and only releases at t24 — the bounce is structurally gone.
This is the cross-verify convention paying for itself a third time tonight: found by reading, not by running, in code that had already passed its live tests.

### 2026-09-01 engine-dev-2 + engine-dev-3 — SELF-SUFFICIENCY: acquire by PRODUCING (phase-1-high)
type: feature-request
status: open — engine-dev-3 builds the produce-side skills, engine-dev-2 wires RESTOCK's fallback to call them
github: felsenuboot/felcrew-mcp#37 (issue-manager sync, 2026-09-01, phase-1/priority-high)
what: RESTOCK can only WITHDRAW. On a world with no depot (or an empty one) any consumable it cannot withdraw is unobtainable, the kit gate refuses forever, and the bot stands down in 30s cycles instead of working. A bot that can only acquire by withdrawing is not self-sufficient — which is the phase-1 pillar itself, not a nice-to-have.
FILLER is already solved (agenda v2 mines stone when the depot is short). TORCHES are the real sustained-productivity blocker, surfaced by engine-dev-3: they cannot be withdrawn on a depot-less world, are not mineable, and restock does not craft — so safeDescend burns them (worse in dark caves, see #14), dips below the floor, and the deep descent can never complete driverless.
fix: a general produce(resource) capability. engine-dev-3 owns the produce-side SKILLS in its standalone lane (torch production from coal + sticks, mine-coal-first when coal is absent, a produce() primitive); engine-dev-2 wires RESTOCK's fallback to call them, generalising the filler case already shipped. Interface to agree between the two.
acceptance: re-run the soak WITHOUT the fixtured cobblestone — a from-nothing self-sufficiency test is the real done-signal, and the current fixtured run cannot show it.

### 2026-09-01 engine-dev — __survival.drill(branch) test hook (issue #23)
type: feature-request
status: shipped(survival v4) — live-verified on KaputtKuno/3130 — CLOSED
what: EVALUATION.md's SD-T1 bench work was blocked on a standard way to force a specific survival.js branch and get a real bench-row-shaped result, the way `__survival.runBranch('WALL_OFF')` already did for one branch informally.
fix: SHIPPED. `g.drill(name, threat)` goes through the REAL `enter()` state machine (unlike `runBranch`, which calls a branch function directly and bypasses it) — same `panic_enter`/`panic_recovered` log lines, same `g.branch`/`g.lastBranch`/`g.fires`/`g.recovered` bookkeeping, same `metrics.panic()` calls a genuine encounter produces, just with the branch forced instead of picked from live threats. Refuses a second drill while one's already active (same as a real panic), but bypasses the 10s lockoutMs re-entry cooldown since it's a deliberate manual test call, not an accidental real panic — a bench suite drilling all five branches shouldn't eat 10s per branch. Refactored the branch-name dispatch out of `runBranch` into a shared `branchFor()` helper used by both, so the two entry points can never drift.
Verified live: `drill('ENV')` and a second `drill('BREAK_LOS')` call (after giving the bot cobblestone) both produced clean `panic_enter (drill:...)` -> `panic_recovered branch=...` log pairs and correct `fires`/`recovered` increments — the mechanism works exactly as designed.
HONEST CAVEAT matching runBranch's own documented caveat: with a fabricated/default threat (no real entity, no real hazard), several branches fall through to their own WALL_OFF-style safety fallback rather than reporting their own name — e.g. `drill('BREAK_LOS')` and `drill('ENV')` both reported `branch:'WALL_OFF'` in my smoke tests, because branchBreakLOS/branchEnv legitimately couldn't act on a fake entity/hazard. This is pre-existing behavior in those branch functions, not something drill() introduced — get a real branch-matching result by following the STANDARD QA PATTERN already documented above runBranch (a real harmless entity id, e.g. a nearby bat, not `id:null`).
BONUS FINDING while smoke-testing (see the next entry, filed separately): one `drill('BREAK_LOS')` call — WITH real cobblestone in inventory, using a real (if poorly-chosen: underwater) entity id — hung for the full 90s `maxRunMs` cap and had to be force-exited, never completing. Not reproduced on a retry of the plain WALL_OFF path (which completed normally, "1 face(s) still open"). Given the drill hook's whole purpose is finding exactly this kind of thing without waiting for a live encounter, this is the tool immediately earning its keep.

### 2026-09-01 engine-dev — branchWallOff/branchBreakLOS: one real 90s hang during a drill, not yet reproduced
type: bug
status: open
github: felsenuboot/felcrew-mcp#38 (already filed by team-lead; cross-referenced onto #32 by issue-manager, 2026-09-01)
what: While live-verifying the new `__survival.drill()` hook (entry above) on KaputtKuno/3130 at (224,62,73) — an underground area, not the plaza — `drill('BREAK_LOS', {name:'skeleton', d:10, ranged:true, los:true, id:<a real squid entity>})` with 32 cobblestone in inventory never returned: `__survival.brief()` stayed at `state:'panic:deciding'` for the full `maxRunMs` (90s), then force-exited with the engine's own `panic run exceeded maxRunMs — forcing exit` log line. `g.failures` did NOT increment on this path (the timeout branch just force-sets `g.active=false`, bypassing the catch block's `g.failures++` — arguably its own small gap). A second attempt at plain WALL_OFF sealing (same bot, same general area, same cobblestone) completed normally seconds later ("wall_off: 1 face(s) still open — coffin is not arrow-tight"), so this isn't a guaranteed-every-time hang.
fix: not diagnosed — out of scope for the ~15-line drill() hook this was found while testing. Best guess, unconfirmed: the fabricated threat's entity id belonged to a squid (aquatic, underwater) at the time, and BREAK_LOS's corner-step/wall+kill logic and/or WALL_OFF's actual block-placement loop may not terminate cleanly when trying to path/place relative to an underwater or otherwise geometrically awkward real entity — genuinely different from the "no_filler" fast-bailout path both prior smoke-test calls took (no cobblestone yet). Also worth checking separately: is (224,62,73) itself a bad location (same general underground cluster as the stuck-bot-taking-real-damage finding earlier this session, though a different specific spot) — rule out location before rule out logic.
next: reproduce deliberately with a real land-based hostile-shaped entity (a real skeleton if one can be staged safely, or a land animal fabricated as ranged/los) at a few different locations, to separate "this branch can hang" from "this specific spot is bad." If reproducible, the fix path is probably a wall-clock cap inside branchWallOff's own placement loop (matching the corner-step ladder's existing bounded-retry pattern), not just relying on the outer 90s enter() cap as the only backstop — 90s is a long time for a bot to sit unresponsive mid-panic.

### 2026-09-01 engine-dev — telemetry session.engine is ALWAYS null, breaking version attribution
type: bug
status: open
what: Building the phase-1 autonomy soak scorecard (ALGO.md, team-lead's QA/metrics assignment on #28) needed to know which agenda/skills version each ledger record came from — the ledger's own `session` event carries an `engine` field for exactly this. Checked `logs/metrics-SoloSauhund.jsonl` directly: every single `session` record across both runs reads `"engine":null`. Root cause, read directly in runner.js: `telemetry.install(bot, ...)` (which emits the one-time `session` record, `telemetry.js:414-417`) runs in `createBot`, BEFORE the bot has ever spawned — but the skills.js injection loop that sets `globalThis.__skills` (and therefore `__skills.version`) runs on the `spawn` event, which fires later. So `(globalThis.__skills && globalThis.__skills.version) || null` at `telemetry.js:415` evaluates before `__skills` can possibly exist, every single time, by construction — not a race, a guaranteed miss.
Made worse by a second factor found while scoring: engine-dev-2 hot-reinjects fixes without requiring a reconnect (by design, so a bot doesn't need restarting for every small fix), so even a NON-null one-time session tag would only be correct for the code running at connect time — a single `run` id can span multiple agenda/skills versions if hot-reinjected mid-session (confirmed directly: ledger run r1788226304 spans agenda v2 through an interim fix through v3, correlated against agenda.js's own git commit timestamps since the ledger gave no help).
fix: not attempted — telemetry.js is engine-dev-2's core payload, flagging rather than touching it. Two independent things worth fixing: (1) move the `session` emit's version read to fire lazily after skills.js has actually loaded (e.g. on the bot's own `spawn` event, or read `__skills.version` at first real event rather than at install time) so it's non-null at least once; (2) since hot-reinjection can change the version mid-run regardless, consider tagging EVERY event (or at least every task_end) with the CURRENT `__skills.version`/`__agenda`-equivalent at emit time, not just once per session, if cross-version scorecards are going to keep being asked for.
impact: every soak/version-scoped scorecard until this is fixed needs the same manual cross-reference-against-git-commit-timestamps workaround I used for today's ALGO.md entry — flagging so nobody re-derives that from scratch, and so a future engineer doesn't just widen the anti-Goodhart suppression thresholds to paper over the ambiguity instead.

### 2026-09-01 engine-dev-2 — goto2/ashfinder merged into runner.js (#26 runner half)
type: feature-request
status: shipped — merged, security gap closed; ashfinder's own movement quality UNPROVEN
what: The runner half of the Baritone split (engine-dev-3 owned the digguard half). goto2.patch.js is now wired: require, loadAshfinder pre-spawn inside createBot, install() once per bot instance, the POST /goto2 route, and `ash` readiness in GET /state.
GOTCHA 0 respected and verified: ashfinder's plugin builds its PathExecutor inside its OWN bot.on('spawn'), so loading it into an already-spawned bot leaves the executor null and every run fails. It loads immediately after loadPlugin(pathfinder), and /state now reports ash:'ready' vs 'load-after-spawn' so that failure is visible rather than mysterious.
SECURITY GAP CLOSED, and not the way it was first proposed. goto2's per-run guardAshDig was DELETED rather than kept as defence-in-depth, because keeping it would have been actively dangerous on two counts we were both bitten by tonight: it restored `bot.ashDig` BY ASSIGNMENT (the same line-shape that let idleguard.stop() strip every dig guard off live bots), and it was a SECOND ashDig wrapper — digguard v5's ensureAshWrapped re-wraps whatever it doesn't recognise, so goto2-wraps -> digguard-re-wraps-over-it -> the two call each other, reproducing the 9.2M-call recursion on ashDig. digguard v5 is now the sole authority, and its g.hit() resolver is strictly better than goto2's flat box list (it honours neverProtect, per-region match regexes and carved exclude gaps). The dig audit now reads __digguard.ashBlocked, which counts refusals across every caller rather than only inside a /goto2 run.
Verified live: ash 'ready', bot.ashDig wrapped by digguard only (chain = 2 hops, one wrapper, no cycle), /goto2 returns structured results.
FOUND A REAL INTEGRATION BUG (agenda v4): /goto2 drives the body OUTSIDE the task engine, so the ladder cannot see it as a running task and kept issuing pathfinder goals straight into it — a hop logged 35 pathfinder interferences and moved zero blocks. The agenda now yields entirely while `bot._goto2.state().inFlight`, stopping its own task once on the transition. Interference dropped 35 -> 8 (the remainder is one task winding down at a step boundary) and the bot moved. Confirmed by its own log: "yielding — /goto2 owns the body" / "/goto2 released the body — resuming", 0 errors. This is the same one-thing-drives-the-body rule that made the agenda subsume idleguard; /goto2 is simply a third driver the ladder couldn't see.
HONEST GAP: ashfinder's own movement quality is UNPROVEN — a 12-block hop still timed out 7 blocks short in 60s. That is a separate question from the merge (the doctrine says /goto2 is an opt-in escape hatch for terrain pathfinder can't solve, never the default, with an A/B to come), and it should NOT be read as ashfinder being ready for real use.

### 2026-09-01 engine-dev-3 (cross-verify) — agenda arbitration: two latent findings
type: bug
status: shipped(agenda v5)
what: engine-dev-3 cross-verified the tick() arbitration core by reading it and dry-running choose() on synthetic worlds. The core passed (latch-until-clear, priority ordering, and the RESTOCK v3 hysteresis band all confirmed — including the key case: consumption INSIDE the band no longer re-triggers, so the boundary bounce is structurally gone). Two low-severity latent notes, neither a live bug.
fix: BOTH APPLIED.
1. `Promise.resolve(target.act(s))` CALLS act synchronously, so a non-async act throwing before it returns a promise would escape tick() entirely and leave A.busy stuck true — the frozen-ladder shape, recovered only by the busySince force-release ~210s later. Every act is async today so it was latent, not live. Now `Promise.resolve().then(() => target.act(s))`, which turns any future sync throw into a rejection the existing .catch handles on the spot. VERIFIED by reproducing the exact shape: injected a non-async rung act that throws synchronously — busy did NOT stick, ticks kept advancing, recovered clean, 0 errors.
2. PREEMPT_DEBOUNCE applied to EAT_CRITICAL taking over a running task. The debounce exists to absorb SENSOR NOISE, and food is not a noisy signal — an integer that changes slowly and monotonically while starving — so waiting ~4s to start eating buys nothing, and the rung latches to food>=19 so it cannot thrash. EAT_CRITICAL now preempts immediately via a `preemptNow` flag. engine-dev-3 flagged it as a judgement call; this is the judgement, with the reasoning recorded so it can be revisited rather than rediscovered.

### 2026-09-01 engine-dev-2 — long acquisitions must be TASKS, not awaited methods
type: bug
status: shipped(skills v27 + agenda v6)
what: Surfaced while specifying the produce() interface with engine-dev-3, then found in my own code. The agenda's TOOL rung AWAITED S.ensureTool inside its act. A method is the right shape for calling from another skill (ctx supplies step/cancellation) but the wrong shape for a rung act: awaiting holds the ladder's busy flag for the entire acquisition, and a chain that gathers wood, crafts planks, places a crafting table and crafts the tool can outrun the 180s ACT_TIMEOUT. When it does the failure is worse than slow — the ladder force-releases and moves on WHILE THE ACQUISITION KEEPS RUNNING UNOWNED, so two things steer the bot with neither aware of the other. Same class as the /goto2 interference, but self-inflicted.
fix: SHIPPED. `S.define('ensureTool')` is a thin skill wrapper over the method (the engine's existing pattern: craftSafe is a method used inside skills, restock is a skill wrapping ctx.withdrawFromChest). The TOOL rung now calls runSkill and returns immediately; oursRunning() reports 'running' each tick, so there is no act-cap interaction at all, plus it gains the task mutex, telemetry (task_start/task_end + outcome) and clean stop-at-a-step-boundary preemption. The bespoke inline spare-verification is gone — clear() already checks the pick count, so the existing unproductive-detector and stand-down own the retry cadence.
verified: the act returns in 2ms with ensureTool running as a task and busy:false, where it previously blocked for the whole acquisition.
NOTE FOR produce(): engine-dev-3 is building S.produce as a method and will add the same skill wrapper — a torch-from-scratch chain (chop -> planks -> sticks -> mine coal -> craft) is exactly the length that trips this.

### 2026-09-01 team-lead + engine-dev — telemetry ledger's assert field conflated PASS with UNGRADED
type: bug
status: shipped(telemetry.js, commit 70564b3) — needs a bot restart to take effect live (require()'d at process start, not eval-injected)
what: `sp.assert = assertResult && assertResult.fail ? assertResult.rule : null` wrote the same `null` for a genuinely PASSING assertion and for a task that was never graded at all — indistinguishable from the ledger alone. Surfaced by team-lead reading the night's own verified-completion milestone against the ledger: SoloSauhund's `safeDescend` was ACTUALLY graded and passed (`safeDescend.netDescent`, confirmed via the agenda's own "project VERIFIED done" log line), but the ledger shows `assert:null`, same as if nothing had graded it at all. Consequence: FSR computed from the ledger reads as a hollow 0/0 whenever nothing has ever failed (a false-success about the false-success metric itself), and the E6 gate's `assertionSet` (built from this same field) silently misses every rule that only ever passed — so `--gate`'s own report of "the assertion set it judged under" has been incomplete since it shipped.
fix: SHIPPED. `assert` now holds the graded rule name whenever `assertTask` actually graded the task, pass or fail alike, and stays `null` only when genuinely ungraded (`assertResult` absent). `classify()` can no longer infer pass/fail from `assert`'s truthiness — verified by reading the WHOLE file, not just the assignment line, since that's exactly the assumption this fix breaks — so it now reads a separate `assertFail` boolean set alongside `assert` in the same `taskEnd` call. Verified via a standalone unit test of the exported `classify()` against all three states (ungraded/passed/failed) plus a non-done control case, since telemetry.js is `require()`'d at process start rather than eval-injected — a live check needs a real restart, which is team-lead's call, not mine.
HONEST CAVEAT for anyone comparing old vs new ledger data: `assert:null` in records written BEFORE this fix could mean either "passed" or "ungraded" — that ambiguity is permanent in historical data, only records written after this commit are trustworthy for the graded/ungraded distinction. Not proposing a backfill; flagging so nobody `--baseline compare`s across the boundary and draws a false conclusion from it.
github: felsenuboot/felcrew-mcp#42

### 2026-09-01 engine-dev-2 — ledger schema bump for the assert meaning change, + assertion-coverage metric
type: bug
status: shipped(telemetry SCHEMA_V 2 + metrics.mjs)
what: engine-dev's tri-state `assert` fix (70564b3) is correct and caught a real bug of mine — v1 wrote a rule name ONLY on failure, so "graded and passed" and "never graded" were both null, and metrics.mjs built the E6 gate's assertionSet from that field, meaning a version's provenance record listed only the rules that FAILED. But it landed WITHOUT a version bump, and the ledger is append-only: two meanings for one field with nothing to tell them apart.
fix: SHIPPED both halves. telemetry.js SCHEMA_V -> 2 with the meaning change documented in the envelope (the rule "a field is never repurposed without a version bump" is the ledger's own, and it binds me as much as anyone). metrics.mjs is now schema-aware: assertionSet is computed from v>=2 records ONLY (a set built from mixed records lists the failures and silently omits every rule that only ever passed — a provenance record that flatters itself), it warns when a window mixes versions, and it reports a new ASSERTION COVERAGE number.
Coverage is worth having in its own right: a low graded share means an FSR of 0 is THIN rather than earned — nothing was checked, so nothing could fail. The printout says so explicitly when coverage is under half. Right now it reads 0/0 because every existing record predates the bump; it populates as bots restart onto the new telemetry.

### 2026-09-01 engine-dev-2 — #41 ledger version attribution (session.engine was structurally null)
type: bug
status: shipped(runner + telemetry + metrics.mjs)
what: The ledger's `session` record wrote `engine: null` on every run, so no row could say which payload set produced it and any cross-version comparison was guesswork dressed as measurement. The root cause is NOT the property name (S.version does exist, skills.js:73) — it is ORDERING: telemetry.install() runs inside createBot, which happens BEFORE the first spawn injects the payload stack, so globalThis.__skills genuinely does not exist yet. The field could only ever have been null.
fix: SHIPPED, and better than patching the one field. applyPayloadStack now emits a `versions` record AFTER the stack lands, carrying EVERY payload's live version plus the role — so a run is attributable to its whole stack, not just skills. It re-emits on each spawn, so a reconnect that picks up edited payloads from disk is recorded rather than assumed (which matters: auto-inject reads the tree, so a run's payload set is not implied by any single commit). metrics.mjs prints a "versions by run" table and says so explicitly when records predate the change instead of leaving rows silently unattributable.
`session.engine` is REMOVED rather than left null: a field that is structurally always empty looks like data and isn't.
verified on a fresh ledger: {"ev":"versions", skills:28, agenda:6, dangerscan:3, survival:4, digguard:5, toolguard:2, idleguard:9, graychat:3, reachguard:1, role:"builder"} at schema v2, and the report attributes the run.

### 2026-09-01 engine-dev — queue loop:true option (issue #24)
type: feature-request
status: shipped(skills v28) — live-verified on KaputtKuno/3130
what: The AS (autonomy-floor) soak bench's queue drains to empty rather than running unattended, so a `soak-watch.sh` workaround has to poll `queue.n==0` externally and re-seed. `onEmptySpec` already supports an indefinitely-repeating SINGLE fallback task (`maxRuns:0`), but nothing re-seeds the original, possibly-multi-item WORK list itself once it drains.
fix: SHIPPED. `enqueue(bot, items, {loop:true[, maxLoops]})` stores the original `{name,args}` list and, on drain, re-validates and re-pushes a fresh copy of it (never trusted stale across cycles) before falling through to `onEmpty`/idle — checked first in `_onDrain`, so a caller using both keeps the real work cycling with `onEmpty` as a between-cycles sweep, not a replacement for it. `maxLoops` omitted/0 loops indefinitely; `stop()` clears `queueLoop` the same way it already clears `queue`/`onEmptySpec`. Surfaced in `status().queue.loop` (`{n, loops, maxLoops}`) for observability.
Live-verified: `{loop:true, maxLoops:2}` ran exactly 3 total task instances (1 initial + 2 re-seeds), logged `"queue loop 1/2: re-seeded 1 job(s)"` / `"queue loop 2/2..."` / `"queue loop finished after 2 run(s) — maxLoops reached"`, then went idle cleanly. An indefinite loop (`maxLoops` omitted) cycled repeatedly (5 loops in ~3s on an empty sweep) until `stop()`, which confirmed `status().queue.loop` back to `null` afterward.
github: felsenuboot/felcrew-mcp#24

### 2026-09-01 engine-dev-2 — the soak's wedges root-caused: restock hauls on a 5s search budget
type: bug
status: shipped(v29) — plus a pre-existing planner-scalar leak found while verifying it (v30)
what: team-lead flagged 10+ `wedge` outcomes in the soak ledger as a real movement-quality signal. They are not noise and not random: TEN of the twelve are the SAME failure. All `restock`, all ending at the identical position [4,62,-33], all ~20.9s, all 2 unsticks, all moving ~17 blocks. The goto spans name the cause exactly — class MEDIUM_ASCENT, crow 75-78 (surface depot, deep bot), moved ~17, and `pf: {partial: 416}`: FOUR HUNDRED AND SIXTEEN partial path results with ZERO successes. The planner never completed a route; it inched, wedged, and the rung retried.
root cause: `restock` set no movement profile, so a y62->surface haul ran on the default ~5s thinkTimeout and a bounded searchRadius. That budget cannot solve a 76-block 3D route out of a mine, and "partial, 416 times" is precisely what budget exhaustion looks like from outside.
fix: SHIPPED. restock enters HAUL for its travel (thinkTimeout 25s, searchRadius unlimited, path shortcuts) — a 5x search budget, and the same treatment `come` has had since v9. Verified live: thinkTimeout 5000 -> 25000, searchRadius -> -1 during the task.
AND A PRE-EXISTING LEAK, found only because I checked that the profile RESTORED rather than assuming it: the profile functions mutate PLANNER SCALARS on bot.pathfinder itself (thinkTimeout/tickTimeout/searchRadius/enablePathShortcut), which do not live on the Movements object — so ctx.enterHaul's restore, which only swapped movements back, never restored them. Every `come` since v9 has therefore leaked HAUL's settings permanently: after one haul, later WORK/CAVE tasks inherited unlimited search instead of WORK's deliberate 64-block "fail fast and honestly" budget. enterHaul now snapshots and restores the scalars too. Verified: 5000/64 -> 25000/-1 during -> 5000/64 after.
worth noting for the wedge KPI: these ten wedges are ONE bug seen ten times, not ten movement failures. A wedge count is a symptom counter, and grouping by (skill, position, signature) before drawing conclusions matters — pooled, it reads like a broad movement problem; grouped, it is a single missing profile.

### 2026-09-01 team-lead — SoloSauhund wedged on no_tool: a real self-sufficiency gap, open question for v6
type: bug
status: open
what: Live on the soak (SoloSauhund, local world, agenda v3 at time of observation): a 22-level `safeDescend` broke its `iron_pickaxe` en route (durability confirmed dropping through the descent, `tool_low` warned at 19% before it failed outright). The agenda's TOOL rung fired to replace it and could NOT — `/state.agenda` reports `blocked:"no_tool"`, `rung:"IDLE"`, with `project:"mineLane"` still HELD (not abandoned, matching agenda v2's fix that made no_tool/kit_missing never permanently block — it's retrying with backoff, not stuck forever, but it has not yet succeeded across multiple retry cycles observed). Bot is alive and safe (hp 20/20 throughout, torch in hand, no danger) at y52 — this is a productivity gap, not a survival one.
Same family as the already-known torch-production gap (RESTOCK can withdraw but not produce; see the earlier depot-less-world entries), one layer over: a tool breaking UNDERGROUND, away from any reachable wood to bootstrap a replacement handle, with no iron ore in inventory to reforge the head either.
open question, to be tested empirically by the incoming v6 restart (skills v28 / agenda v6, which ships `ensureTool` as a proper skill rather than an awaited method — see "2026-09-01 engine-dev-2 — long acquisitions must be TASKS, not awaited methods" above): does v6's ensureTool actually SELF-RECOVER here (find/mine iron+wood from the bot's current position, craft a replacement, resume mining), or is this a deeper KIT-FORESIGHT gap — the bot should carry spare tool materials (or a literal spare tool) on any excursion past a certain depth, or turn back toward wood/a crafting table BEFORE the equipped tool's durability runs out, rather than reactively trying to recover after it's already broken with nothing on hand. The restart will answer the first half directly; if TOOL still can't clear this after the restart, that is a strong data point for the foresight gap being the real fix needed, not another self-recovery patch.
fix: not proposed yet — deliberately deferred pending the v6 restart's empirical answer, per the open question above. Revisit after the restart's TOOL-rung behavior against this exact scenario is observed.
UPDATE (engine-dev, watching the still-live v3 run): got the concrete answer for v3 before the un-fixtured v6 run even launched. TOOL rung DID attempt full bootstrap-from-scratch (gather wood -> craft planks -> table -> tool, the same chain verified in 33s on issue #30) — it just fell short THIS time: `"acquisition_failed: need wooden_pickaxe — depot:minerals:none | depot:wood:none | gather:wood | planks:5 | craft:short on planks (5/7 after sticks, incl. 4 for a crafting table) — need more logs"`. It gathered enough wood for 5 planks but needed 7 (4 for a table + enough for sticks and the tool), came up 2 short, and stood down for the 300s backoff rather than looking for a second tree. This is a SOLVABLE near-miss, not genuine exhaustion (there's a real distinction: raw_copper/iron genuinely aren't in inventory, but wood specifically was almost enough) — the gap isn't "no wood anywhere," it's "gave up after one tree's worth instead of persisting until the actual requirement is met." Useful precision for the v6/produce() comparison: watch specifically whether the SAME near-miss shape (short by a small margin, one gathering pass) recurs, or whether produce()/v6 persists to the real requirement.
type: feature-request
status: shipped(runner.js, commit c44d4f3) — live-verified on KaputtKuno/3130
what: `/goto`'s handler logged the request line but never its resolution, so goto latency and success/failure could never be reconstructed from `runner.js`'s own log alone — the acceptance test EVALUATION.md filed this from wanted request+response correlated in the log.
fix: SHIPPED. A short request id is generated per call and logged on both the request line and the resolution line (`resolved ok in Nms` or `resolved error in Nms: <message>`), surviving other log traffic interleaving between them.
Required a real process restart to verify (`runner.js` is the entrypoint, not hot-reloadable) — used KaputtKuno/3130 (my own bench bot, not the fleet's live bots or the soak bot) rather than waiting. Verified both paths live: a real successful goto logged matching ids 2158ms apart; a goto onto a target sealed under a placed-then-removed bedrock ceiling logged matching ids with the real pathfinder timeout message, 12058ms apart — with an unrelated chat line interleaved between request and response in BOTH cases, confirming the correlation id (not just log adjacency) is what makes this reliable.
github: felsenuboot/felcrew-mcp#25

### 2026-09-01 engine-dev-3 (via team-lead) — toolless/resourceless at DEPTH: no self-recovery (phase-1.5)
type: feature-request
status: open
github: felsenuboot/felcrew-mcp#43
what: A bot that breaks its LAST pickaxe deep underground cannot self-recover. Concrete: SoloSauhund wedged blocked:no_tool at y52 on agenda v3 (zero pickaxes, no iron, only raw_copper+cobble+iron_sword). ensureTool/produce bootstrap tools+torches ONLY when WOOD is reachable (chop->planks->sticks->craft) — there is no wood at depth (findBlocks logs empty) — so the bot can't mine (no pickaxe), can't craft one (no wood), can't ascend (movement needs a pickaxe). Deadlock. produce() (shipped) closes the TORCH-exhaustion boundary near surface wood; this deep-toolless-strand is a DISTINCT gap it doesn't cover.
scope: PHASE-1.5, NOT a phase-1 blocker (team-lead call). The acceptance soak needs a BOUNDED project (advance to completion then P3 fallback), which completes within a reasonable tool budget where produce bootstraps near the start with wood reachable — so this strand isn't triggered by the acceptance test. Continuous multi-hour deep-mining is the separate harder capability this belongs to. DO NOT BUILD YET.
fix (deferred, foresight-FIRST per team-lead): (1) PRIMARY — a deep-kit rule sizing the departure tool/material budget to the PLANNED depth (carry spares proportional to depth), enforced at the kit gate. (2) SAFETY NET — reactive ascend-to-resupply: toolless/resourceless at depth + no wood reachable -> path UP to nearest wood/base, restock/craft, resume. Owner engine-dev-3 for the recovery skill; the kit-sizing rule coordinates with the kit gate + agenda.

### 2026-09-01 engine-dev — engine-quality audit: 4-6 registered skills lack an ASSERTS entry
type: bug
status: open
what: While locking the phase-1 soak's coverage definition (EVALUATION.md §9 C2 — team-lead decided gradableN = ASSERTS-having skills only, since the ASSERTS registry IS the definition of "gradable"), audited the full skill registry against `ASSERTS`' keys. 20 skills registered total (`skills.js`: come, collectDrops, chopTrees, mineLane, huntAnimals, ensureTool, restock, depositToChest, safeDescend, buildSchematic, buildWall, buildFloor, frameStructure, buildStaircase, stripLog; `farmskills.js`/`basekeeping.js`: spawnProof, structureAudit, tillFarmland, farmCycle, harvestGrass). 12 have an ASSERTS entry (come, safeDescend/buildStaircase, mineLane, chopTrees, huntAnimals, collectDrops, depositToChest, buildWall/Floor/frameStructure/buildSchematic). Of the 8 without one: `ensureTool` and `restock` are correctly excluded by design (graded by their own rung's `clear()` condition, not a task-level assertion — team-lead confirmed this is not a gap). The other SIX are unreviewed:
- `stripLog`, `tillFarmland`, `farmCycle`, `harvestGrass` — STRONG candidates. Each already returns a clear want/got-shaped result (`stripLog`: `{cells, stripped, already, skipped}`; the farm skills have analogous tile/yield counts) matching the exact pattern `chopTrees`/`mineLane`/`huntAnimals` already use — these look like straightforward misses, not deliberate exclusions, since nothing about their result shape differs from the skills that DO have an entry.
- `spawnProof`, `structureAudit` — WEAKER candidates, lower confidence. These are audit/verification skills whose "result" is itself a report/diff, not a resource yield — a want/got framing is less obvious (though "did the audit actually run and match its own claimed scope" could still be assertable; needs a closer look before writing rules for them, not assumed).
fix: not proposed — this is an audit finding, not a fix. Whoever owns the ASSERTS table next should add entries for the four strong candidates at minimum (mirrors existing patterns closely, low effort) and assess spawnProof/structureAudit separately. Tracked apart from the soak scoring per team-lead's explicit split — this doesn't block or change the rubric, it's forward-looking engine-quality work.
github: felsenuboot/felcrew-mcp#44

### 2026-09-01 engine-dev-2 — RESTOCK now acquires by PRODUCING (#37 wired), and three defects the verification exposed
type: bug + feature
status: shipped(agenda v7 + runner auto-inject, df64b54) / shipped(skills v31, in-place tool craft) — live-verified on LokalLothar — #37 CLOSED
github: felsenuboot/felcrew-mcp#37 (closed, issue-manager 2026-09-01); the food-bootstrap-paradox this entry surfaces (STILL OPEN below) filed as felsenuboot/felcrew-mcp#45
what: RESTOCK could only WITHDRAW, so on a depot-less world the kit gate refused every departure forever (#37). It is now withdraw -> produce -> stand down, calling engine-dev-3's `produce` SKILL (not the method — a torch chain from scratch can outrun the 180s act cap, and a blocked act that outruns it gets force-released while the work keeps running unowned).
Three things it had to get right, each a bug that would otherwise have shipped:
- A restock that ERRORS carries no `result.short`. Reading only `result.short` meant that on a depot-less world — where restock throws `not_found` — the shortfall was never recorded and the produce fallback was literally unreachable. The ladder would have stood down forever on a need it was holding the fix for. The ASK is the shortfall when the task errors.
- The recorded shortfall is a SIGNAL, never a quantity. The gap is recomputed from inventory at act time. Reusing the recorded count is the same unit-mismatch class as grading a block distance against an entity position. Verified: a recorded short of 999 still produced a batch of 24, sized from what the bot actually held.
- A produce that made 6 of 24 torches DID move the world, so it resets the unproductive detector. Judging it by completion rather than progress would stand RESTOCK down mid-resupply.
verified: eight decision cases with the skill-start stubbed (withdraw / produce-torch-first / cooldown-falls-through / both-in-cooldown / unproduceable-food / TTL-expiry / gap-from-inventory / expired-cooldown), then a live driverless run — restock came back short, the shortfall was recorded, produce ran, its typed reason was logged, RESTOCK stood down 30s then 60s, and PROJECT and IDLE got the body. No churn, no wedge.

THEN the live run bottomed out on `no_pickaxe`, which exposed three separate defects in ensureTool's acquisition path. All three are fixed in skills v31, and all three are ordinary bugs in the EXISTING path — none of them is issue #43's deferred deep-recovery capability, which I have not built and am not building:
1. `cheapestSatisfying` chooses the tool tier by PRICE and never by what is in the bag. It always answers "wooden" and then goes looking for wood. Underground that is exactly backwards: wood is the expensive material down there and the cobblestone the kit already requires is sitting in the inventory. Measured: a bot at y73 in a cave, no pickaxe, 58 cobblestone held, spent 36.6s failing to reach surface trees and gave up while carrying twenty pickaxe heads' worth of stone. Fixed with `payableTier` — the cheapest tier whose WHOLE bill (head + sticks + table) is already payable from carried stock wins; if none is, nothing changes and the old price-order behaviour stands.
2. The wood scan's vertical filter was ONE-SIDED. `p.y >= floor(botY) - MAX_BELOW` reads as "don't chase it down a ravine" (correct, the Grog rule) and silently means "any height above is fine". From inside that cave, twelve trees at y113 passed the filter and the bot spent 36s failing to path to each in turn, then reported "no wood in reach" — a reachability failure wearing a supply failure's name, which is exactly the kind of misattribution that sends the next reader hunting the wrong bug. Now bounded on both sides (MAX_ABOVE = 10) and the failure reason distinguishes "no wood found" from "N logs found but all out of vertical reach (nearest +40, band -5..+10)". The gather step also records REACHED, not merely attempted.
3. The crafting-table placement search could not place a table against a WALL. It looked only at the four lateral cells at foot level and only ever placed on the TOP face of the block beneath them — a surface assumption, in the one path where crafting in place actually matters. Measured in situ: the bot stood in a one-wide gap with three solid neighbours (spot not air, skipped) and one open neighbour over a drop (nothing beneath, skipped), and reported "could not place one" while holding a crafting table. Now any adjacent solid FACE will do, and head level counts too. Also reordered: a table in the BAG is now tried before travelling to the depot's table, so a bot that brought its own no longer spends a 25s cross-map goto before discovering it was carrying the answer.
result, same bot, same spot, same fixture (4 sticks + 1 crafting_table given, 58 cobblestone already held): BEFORE — 36.6s, no movement, `ok:false`, "need more logs", still no pickaxe. AFTER — 2.2s, `ok:true`, `stone_pickaxe` crafted in place from 3 of its own cobblestone, table set against the cave wall, zero travel. Steps: `tier:payable:stone_pickaxe | depot:minerals:none | depot:wood:none | planks:0 | place:table | craft:stone_pickaxe:1`.

SCOPE NOTE, so this is not read as building deferred work: issue #43 (deep toolless strand, phase-1.5, "DO NOT BUILD YET") defers two things — a depth-sized kit rule, and a reactive ascend-to-resupply skill. I built NEITHER. What is above is three bug fixes to the existing ensureTool path that improve it at any depth (the table-placement bug bites in any tight spot, surface included). They do, however, turn the carried-materials case from impossible into a 2.2s recovery, which is the precondition that would make #43's foresight option cheap if team-lead ever un-defers it. The kit gate is UNCHANGED and stays team-lead's call.

STILL OPEN, and the un-fixtured soak needs it: the underground kit tier requires foodItems:4, produce covers no food path, and `huntAnimals`' own kit gate requires foodItems:2 — so a bot with no food cannot hunt for food. That bootstrap paradox is a second unproduceable floor and it is nobody's assignment yet.

UPDATE (engine-dev-2, same session): the produce chain is now CONFIRMED END TO END, live and driverless, on a world where torches cannot be withdrawn. Sequence, from the agenda's own log with nothing handed to the bot: `RESTOCK: started restock` -> the withdraw hauled 85 blocks to the depot coords and failed every chest (`walk to supply chest 1/2: path_timeout after 25000ms`, twice per chest, three chests — the depot does not exist on that world) -> came back short -> `depot short on torch (gap 24) — making 24 instead` -> `RESTOCK/produce: started produce` -> the bot mined coal, chopped wood, crafted planks then sticks then torches -> **26 torches**, coal and sticks fully consumed -> RESTOCK's clear() satisfied and the rung released -> PROJECT ran and verified done -> IDLE. Zero LLM involvement per cycle; the ladder did all of it.
So the answer to "can a driverless bot acquire a consumable it cannot withdraw" is now yes, measured. Two honest boundaries on that: it is ONE criterion's worth of evidence, not the five-criterion three-hour soak; and the withdraw probe costs ~150s on a depot-less world (two 25s path attempts per chest, three chests) before produce gets its turn. That cost is paid once per DEPOT_SHORT_TTL_MS (10 min), not per cycle, because the shortfall signal latches — a deliberate tradeoff, since a permanent latch would mean never withdrawing again after another bot restocks the depot.
Also worth recording as a specimen for the stall-watchdog work: during the failed depot approach the bot sat at a fixed position with `onGround:false`, zero velocity, `isMoving:true`, five pathStuck events and repeated "movement stalled — unsticking" — the physics-desync signature, on the HAUL profile (thinkTimeout 25000, searchRadius -1 confirmed active). It recovered on its own when the task moved to the next chest, so it is a slow path rather than a wedge, but it is a clean specimen.

### 2026-09-01 engine-dev-2 — deep-kit provisioning done (#43 item 1), plus two defects it uncovered
type: feature + bug
status: shipped(agenda v9/v10, skills v33/v34) — live-verified un-fixtured on LokalLothar
what: team-lead promoted #43 item (1) to phase-1 with the shape attached: SELF-HEALING, not a departure-only kit add. That qualifier is the design. A kit gate that demands what no rung can supply is a permanent refusal, not a safeguard, so the floor and the means to meet it had to land together — which is why the KIT_TIERS edit was written LAST, after engine-dev-3's produce('crafting_table') (producer v3) was live. There was never a window where the gate wanted something nothing could make.
- `underground` and `deep` now require `sticks` and a `crafting_table` alongside the filler cobblestone they already asked for. Those three ARE a stone pickaxe. The spare pickaxe requirement stays: these add a recovery path, they do not buy out a safety requirement. `excursion` is untouched, because carrying the makings only means anything where wood is out of reach.
- RESTOCK fires on the new floors, asks the depot for them by name, and produces them when the depot is out. PRODUCE_ORDER puts crafting_table and stick ahead of torches — one craft each, and they are what unblocks TOOL.
verified UN-FIXTURED, which is the whole point: LokalLothar stripped to zero sticks and no table fired RESTOCK, tried the depot, came back short, and made both itself — `depot short on crafting_table (gap 1) — making 1 instead` then `depot short on stick (gap 3) — making 4 instead`, in that order. `kitCheck('underground').missing` afterwards no longer lists either; what remains is the spare pickaxe (TOOL's job) and food (the separate gate bug).
Earlier in the same session, the payoff this exists for was measured directly: same bot, same cave at y73, pickaxe gone. WITHOUT the makings — 36.6s, no movement, "need more logs". WITH them — 2.2s and a stone_pickaxe crafted where it stood.

TWO DEFECTS FOUND ALONG THE WAY, both worth more than the feature.

1. THE DRY-RUN HOOK WAS NOT DRY, and it is the hook the acceptance benchmark scores through. AGENDA-DESIGN calls `__agenda.step(injectedSnapshot)` mandatory for deterministic replay. But TOOL's fire() and clear() counted pickaxes straight out of `bot.inventory`, and `projectKit()` handed the LIVE bot to a kit spec that reads `position.y` — so for the TOOL rung, step() was answering from the real world no matter what snapshot it was handed. I found it only because I wrote a regression and EIGHT of seventeen cases came back TOOL regardless of the world under test: the bot happened to hold one pickaxe where the kit wanted two. Fixed in agenda v8 (sense() publishes `toolCounts`; projectKit takes the snapshot and passes a position-only shim when injected) with the enabling contract stated in place: **a kit function may read POSITION only**. Anything that leans on step() for replay was, for that rung, measuring the live bot.
2. RE-WALKING TO A DEPOT THAT ISN'T THERE. On the un-fixtured run one withdraw attempt cost ~SEVEN MINUTES hauling toward coordinates the bot could not reach, and the agenda re-probed every 10 minutes — a driverless bot would spend most of a 3-hour soak walking to a chest that was never there. Root cause: `restock` reported "the depot was out" and "we never got to the depot" identically, as a bare `short`. Those are different facts with different half-lives — stock changes when someone makes a delivery, a route does not. restock now returns `reached` (chests actually opened; additive, no field repurposed) and the agenda believes an unreachable depot for an hour instead of ten minutes.

ALSO SHIPPED, because it was the one thing on the critical path with no grader: an ASSERTS entry for `produce` (skills v32). RESTOCK was believing it on `made > 0` alone, and `made` is produce's own before/after arithmetic — reading it is taking the skill's word twice. The assertion checks what produce did NOT compute: what the bot is holding now (a claim to have made N must be backed by N in the bag) and the contract itself (ok:true with made:0 contradicts produce's own ok-means-made>0). A partial is not a failure — produce is partial-success by contract — so a shortfall lands in `yield`. Watched it refuse things, because an assertion nobody has seen refuse anything is decorative: holding 26 torches, an honest 8 passes at yield 1, an honest 6-of-24 passes at yield 0.25, a fabricated 999 FAILS, ok-with-made-0 FAILS, and an honest ok:false/made:0 passes.

NEW BENCH FIXTURES, all three safe against a live bot (they execute nothing and restore every field they touch), and worth running as a pre-flight before the soak launches — they would catch payload drift or a stale injection in about a second:
- `bench/fixtures/agenda-ladder.js` — 19 cases: rung precedence, the RESTOCK hysteresis band, the stand-down handoff, the spare-tool requirement, the snapshot-derived kit tier.
- `bench/fixtures/agenda-deepkit.js` — 9 cases: the new floors fire, hold at the bare floor, clear at the buffered target, ask by the right names, and produce table→sticks→torches as cooldowns bite.
- `bench/fixtures/assert-produce.js` — 5 cases: the produce assertion grants truth and refuses fabrication.
All green on skills v34 / agenda v10 / producer v3.

### 2026-09-01 engine-dev-2 — the stripped-bare run found THREE soak blockers a fixtured run could not
type: bug
status: shipped(agenda v11, skills v36) — verified un-fixtured on LokalLothar
what: team-lead asked for a stripped-bare end-to-end as the definitive deep-kit validation. Cleared LokalLothar to nothing but fixtured bread, set an underground mineLane, and watched.
THE GOOD HALF: it provisioned the entire underground kit unaided — chopped wood, crafted a wooden pickaxe, then a second for the spare requirement, tried the depot, came back short, and produced a crafting table, sticks, 24 torches and 28 cobblestone. kit missing went 6 → 5 → 4 → 3 → 2 → 1.
Then it stalled, and the last item plus what followed were three separate blockers, none of which a FIXTURED run can surface — the fixtures were quietly papering over all three.

1. NOTHING AIMED AT THE KIT'S WEAPON. Every excursion tier requires one; TOOL only ever looked at the project's own tool class. `weapon (any sword)` was therefore a permanent refusal — fire() false on every rung, mineLane refused with kit_missing on every attempt, indefinitely. Predates all the recent work; the fixtured runs were carrying a sword. TOOL now owns the gate's weapon as well as the project's tool (project tool first, since that is what the work needs; an axe satisfies it, matching kitCheck).
2. A PROJECT WAS MARKED VERIFIED DONE ON ANOTHER RUNG'S TASK. The log line: `project VERIFIED done (mineLane, produce.made(cobblestone,made=24,held=28))` — mineLane, graded by produce's assertion, having never run. RESTOCK started produce, produce finished, RESTOCK cleared, PROJECT took over and its own start was REFUSED for kit_missing, which leaves activeTaskId still pointing at produce's finished task; the next tick harvested it as the project's completion. **Owner identity is not task identity**, and the guard only checked the owner. The agenda now records which rung started a task and what it was, and the harvest requires both that PROJECT started it and that the task's name is the project's skill.
   Worth keeping: assertTask did its job correctly and still produced a wrong answer. It graded exactly what it was handed, honestly. The defect was upstream, in handing it the wrong task — a verifier only protects the layer it is actually pointed at.
3. ensureTool ATE THE KIT ITEM IT DEPENDS ON. The deep kit requires a carried crafting_table; ensureTool placed it to craft a replacement pickaxe and walked off. The recovery consumed the very thing the gate checks, so the bot recrafted its pickaxe and was then refused its next departure for a table it was standing next to, with RESTOCK churning to make another. It also abandoned a table wherever a tool broke — three were still standing in the test world. craftToolChain now mines back the table IT placed (only that one; a found table belongs to someone, protected positions skipped). The dig needs the sanctioned force flag: toolguard classes a crafting table as axe-work and rejects it bare-handed, which is how the first attempt failed with `tool_missing: crafting_table`. That guard exists to stop wrong-tool WORK, not to stop a bot picking its own kit back up.

A METHOD NOTE, because it nearly cost a wrong conclusion. My first attempt at measuring blocker 3 was CONTAMINATED: I ran ensureTool by hand while the agenda's TOOL rung was running its own — two acquisitions on one body. The numbers looked alarming (46 cobblestone apparently vanishing) and I was one step from reporting an item-loss bug that does not exist. **`A.busy = true` is not isolation** — it stops the ladder starting NEW acts, not one already running. `__agenda.stop()` is. Re-run from a known inventory with the ladder actually stopped, the result was clean: `tier:payable:stone_pickaxe | place:table | craft:stone_pickaxe:1 | take:table`, 3 cobblestone and 2 sticks spent, table back in the bag, zero tables left in the world. Same lesson as the wedge cluster one level up: before concluding, make sure only one thing was driving.

ALSO: `bench/preflight.sh <port>` now runs all 35 cases in one command and exits non-zero on failure — team-lead has adopted it as the mandatory soak pre-flight. And assert-produce is self-calibrating now: it hard-coded torches, so the moment the bot spent them the fixture's own HONEST cases started failing. The assertion was right and the fixture was wrong, which is the worse way round — a pre-flight that cries wolf is worse than no pre-flight.

### 2026-09-01 engine-dev-2 — eng-3's 2-pickaxe stall does NOT reproduce on v36: the table was the root cause
type: bug (already fixed) + finding
status: verified — no further change needed; kit deliberately UNCHANGED
what: engine-dev-3's harder cross-verify reported a hard stall — TOOL provisions one pickaxe, mineLane's underground gate wants two, so a deep bot that loses its tools recovers ONE and then idles forever on kit_missing. team-lead flagged it as a launch blocker and offered a kit redesign (makings subsume the spare) to remove the mismatch.
It does not reproduce on v36. Ran eng-3's exact scenario with the ladder STOPPED (one thing driving the body): cobblestone 32, planks 16, sticks 8, a crafting_table, a sword, no pickaxe. Two sequential acquisitions, the second with `spare:true`:
  primary: wooden_pickaxe crafted, 16.3s, steps `... | place:table | craft:wooden_pickaxe:1 | take:table`
  spare:   wooden_pickaxe crafted, 16.2s, same shape
  picks 0 -> 1 -> 2; the crafting table stayed at 1 throughout; kit missing fell to torches only.
ROOT CAUSE was Blocker 3 (fixed in v36) seen from the other side. On v34, ensureTool PLACED the carried crafting table and walked off. That consumed the kit item the gate checks — so mineLane refused kit_missing on every attempt — AND, because the bot had moved on, the second acquisition had no table carried and none within reach, so it fell through to the ~75s futile depot trip and failed. One root cause produced BOTH of eng-3's reported issues (the "provisions only 1" stall and the compounding depot-probe slowness), which is exactly why they read as two. Their diagnosis was reasonable from outside; the count symptom pointed at the wrong requirement.
DECISION: keep `picks: 2`, no kit redesign. team-lead's subsume-the-spare design is sound and I would have taken it had the mismatch been real — but retiring a field-proven safeguard (the 2-pickaxe rule is bernd-driver's double tool loss made mechanical) to fix an already-fixed bug is the wrong trade. Belt and braces costs one slot and buys zero-interruption recovery: a spare is an equip, a recraft is a ~16s stop.
HONEST CAVEAT, raised by eng-3 and worth keeping: `agenda-ladder.js` stubs `S.start`, so it proves TOOL is CHOSEN for the spare, NOT that ensureTool COMPLETES it. The completion evidence is the live repro above, not the fixture. Encoding a 32-second real acquisition into the pre-flight was deliberately NOT done — what makes that suite safe to run on the soak bot is precisely that it mutates nothing.

### 2026-09-01 engine-dev-2 — sticks floor raised to 8 (last kit edit before launch)
type: feature
status: shipped(skills v37) — verified live
what: sticks are the ONLY scarce input to torch production at depth. produce mines its own coal, but a stick needs wood and there is none underground, so a long deep run is stick-limited. The arithmetic makes the question uninteresting: 1 log = 4 planks = 8 sticks = 32 torches, on top of the 2 a tool re-craft costs.
fix: underground and deep both go from 2/4 to 8. Verified live rather than merely set — a bot at 4 sticks fired RESTOCK, produced to the buffered target of 12, and spent 4 of its carried planks doing it, so the raised floor SELF-HEALS instead of becoming another departure-only demand. Pre-flight 35/35 on v37.

### 2026-09-01 engine-dev-2 — FOLLOW-ON (filed, not built): skip the walk to a depot already known absent
type: feature-request
status: open — phase-1 efficiency, explicitly NOT a launch blocker (team-lead's call; they handle the soak side in setup)
what: `ensureTool` and `restock` both travel to the configured depot coordinates before falling back to craft/produce. On a depot-less world that is ~75s of futile travel per attempt for ensureTool and up to ~7 minutes for restock, and it pulls a deep bot to the surface. v10 already tamed the RESTOCK re-probe frequency (restock reports `reached`, and a depot that opened NO chest is believed unreachable for an hour instead of ten minutes), and v36 removed the compounding case by keeping the crafting table so a second acquisition does not need the depot at all.
fix (proposed, unbuilt): cache "this depot was unreachable/absent from here" once, and have BOTH acquisition paths skip the walk while that belief holds, rather than each re-learning it. The belief must expire and must be position-aware — a depot unreachable from y20 may be trivially reachable from the surface — which is the part that makes this more than a one-line flag and the reason it is filed rather than dashed in before a launch.

### 2026-09-01 engine-dev-2 — cold-start check: the pre-flight would have passed a bot with NO produce
type: bug (in the test harness) + verification
status: shipped(runner /state + bench/fixtures/stack-check.js) — demonstrated, not assumed
what: The soak bot gets RESTARTED before launch, and auto-inject reads the TREE, not any commit — so "the stack is right" is a claim about a process nobody had run yet. Spawned a throwaway with the soak's exact flags (`--agenda --role miner`, local server) to check the cold path.
COLD PATH IS GOOD: a fresh process produced skills v37, agenda v11, producer v3 with both the method and the registered skill, 21 skills, farm and base packs, sticks tier 8, zero injection failures, no stale payloads.
IT ALSO FOUND TWO GAPS, both mine:
1. `/state` never reported producer. Auto-injected but invisible, so "is produce installed" needed an /eval — exactly the gap that payload map exists to close ("a driver asking 'did my bot get digguard v2' should not have to /eval for it"), and produce is load-bearing for RESTOCK now. Fixed; reaches a bot on its next spawn.
2. **THE PRE-FLIGHT WOULD HAVE PASSED GREEN ON A BOT WITH NO `produce` AT ALL.** The behavioural fixtures stub `__skills.start` — which is precisely what makes them fast, non-mutating and safe to run on the soak bot, but it means they never touch the real skill. Demonstrated rather than reasoned about: deleted produce from the throwaway and `agenda-ladder` still returned 21/21 with `agenda-deepkit` at 9/9. A half-injected stack would have cleared the launch gate and then stood down forever in the field, and the outcome would have looked like a behaviour bug.
fix: `bench/fixtures/stack-check.js` runs FIRST and checks PRESENCE before the others check behaviour — __skills, the produce method AND registered skill, ensureTool and restock, the kit tiers actually exposing the recraft makings, __agenda, __digguard, and no stale payloads (a reconnect leaves payloads present-but-dead, bound to a discarded bot). On the deliberately broken bot: 6/8, names both missing pieces, exits 1.
the general lesson, which is the same one this session keeps producing one layer up each time: a test that STUBS the thing it depends on cannot tell you the thing is there. Fast-and-safe and complete are different properties, and the fix is a second cheap check rather than making the first one slow — the behavioural suite stays non-mutating precisely so it can run on the soak bot.
Pre-flight is now 43 cases on a stocked bot. On a FRESH bot `assert-produce` SKIPS with a reason instead of false-failing (it compares claims against what the bot actually holds), so `38/38 + SKIPPED` right after a restart is a PASS — the self-calibrating fix earning its keep on the first cold bot it met.

### 2026-09-01 engine-dev-2 — arg parser: a valueless flag swallows the next flag (FOUND, deliberately NOT fixed pre-launch)
type: bug
status: open — deferred to AFTER the soak launches, on purpose
what: `parseArgs` in runner.js consumes the NEXT token as a flag's value unconditionally, so a valueless flag eats the flag after it. `--agenda --role miner` parses as `agenda: "--role"` with `miner` orphaned, and `args.role` comes out undefined. That is the soak bot's exact spawn line. The behaviour is even documented at the AGENDA constant ("parseArgs consumes the NEXT token as a flag's value, so a valueless `--agenda` lands as undefined — presence in the object is the correct test") — the consequence for the FOLLOWING flag was just never followed through.
THE SOAK IS SAFE: SoloSauhund is in roster.json as "miner" and the `rosterRole(NAME)` fallback catches it. That fallback was added for a different reason (nobody was passing --role and every rolling restart hand-rolled a sed for idleguard's __ROLE__) and it happens to cover this too. Found only because a throwaway bot NOT in the roster came up `role: null`, which also silently skipped idleguard.
consequences when it does bite: no role means `ROLE_TOOL[null]` and `ROLE_FLOOR[null]` are undefined, so with no explicit project `tool`/`restockFloor` the agenda's role-default behaviour is inert — TOOL never fires for a project tool and RESTOCK has no floors.
fix (one line, deferred): do not consume a token that starts with `--`. `AGENDA` keeps working because it tests key PRESENCE, not value.
WHY DEFERRED, since the fix is trivial: it changes argument parsing in a component that goes live on the soak restart, and it buys the soak nothing — the roster already covers the bot. Zero launch benefit against non-zero launch risk. Same trade as deferring the huntAnimals gate change. Workaround for anyone who needs it before then: put `--role X` BEFORE `--agenda`, or make sure the bot is in roster.json.

### 2026-09-01 engine-dev-2 — `versions` record omitted producer (fixed)
type: bug
status: shipped(runner.js) — cold-start verified
what: #41's point was that a run must be attributable to its WHOLE stack, not just skills. I then added producer.js to auto-inject without adding it to the `versions` record, so the soak's ledger could not have said which producer version produced it — the one payload acquire-by-producing depends on. Same omission shape as the original bug, reintroduced by the person who fixed it, one payload later.
fix: producer joins the record. Verified by cold start rather than inspection — a fresh process with the soak's flags wrote `{"ev":"versions", skills:37, agenda:11, ..., producer:3}`, and /state reports it too.

### 2026-09-01 engine-dev-2 — TOOL reached the kit's PICKAXE requirement only through activeClass (launch blocker)
type: bug
status: shipped(agenda v12) — live-verified on the exact failing shape
what: engine-dev-3's sustained-loop re-verify failed with the bot stalled at 1 pickaxe. I had previously reported this as not-reproducing, and I was wrong in a specific and instructive way: my repro exercised `S.ensureTool(bot,'pickaxe',{spare:true})` DIRECTLY and proved the ACQUISITION works — it never tested the RUNG that is supposed to ask for it. eng-3's second report named the thing I had not checked ("TOOL.fire returned FALSE at 1 pickaxe held, even though projectKit().picks=2"), and that was the bug.
measured on v11, same bot, 1 pickaxe held, kitPicks 2, both project shapes side by side:
  project WITH `tool:'pickaxe'`  -> TOOL fire true,  clear false   (correct)
  project WITHOUT a tool         -> TOOL fire FALSE, clear TRUE    (the bug)
root cause: `activeClass(s)` is `project.tool || ROLE_TOOL[role]`, and TOOL reached the gate's `picks` requirement only through it, after an early `if (!c) return false`. So a project with no explicit tool, on a bot whose role maps to no tool (`builder` -> null, or a role-less bot), left `picks: 2` aimed at by NOTHING — fire false, clear TRUE, kitCheck still saying "pickaxes 1/2", mineLane refused kit_missing forever. Exactly the WEAPON gap one requirement over.
fix: `kitPickShort()` is asked BEFORE the activeClass guard, alongside `weaponMissing()`, and the act picks a target in priority order — the project's own tool if broken, then the gate's spare pickaxe, then the gate's weapon — so all three are reachable when no tool class resolves.
NOT fixed by lowering `picks` to 1, which was the proposed fix and would have made the repro pass. With picks:1 the requirement still would not have been AIMED at; it would merely have happened to be satisfied by produce's internal ensureTool, leaving the defect latent for the next tier that wants a spare. Fixing the symptom would have hidden the cause.
verified live on the failing shape: picks 1 -> 2 via TOOL, RESTOCK then healed the table and sticks the craft consumed, kit missing -> [], PROJECT started mineLane with activeTaskRung=PROJECT.
THE FIXTURE PASSED FOR THE WRONG REASON, as eng-3 suspected when they said sense() and the injected snapshot disagreed: agenda-ladder's base role is `miner`, which maps to pickaxe, so activeClass was never null in the existing "1 pickaxe but kit wants 2" case. A `builder`-role case now pins it. 44/44.
the lesson, and it is the session's recurring one at yet another altitude: **testing the ACQUISITION is not testing the RUNG THAT ASKS FOR IT.** I proved the capability existed and reported "does not reproduce"; the caller that was supposed to invoke it was the broken part. Same family as "a verifier only protects the layer it is pointed at" and "a test that stubs what it depends on cannot tell you it is there".

### 2026-09-01 engine-dev-2 — stack-check verifies PRESENCE, not VERSION (known gap)
type: bug (test harness)
status: open — deliberately not fixed pre-launch
what: `bench/fixtures/stack-check.js` confirms payloads are installed, but not that they are the versions you intend. engine-dev-3's bot passed the pre-flight 43/43 while running skills v34, two versions behind the v36 they believed they were verifying against — so a green pre-flight did not tell them their stack was stale.
fix (deferred): assert expected versions. It needs an expected-version source of truth, which is a new mechanism on the launch path, so it is not going in before the soak. Until then the reading is: check the /state version line alongside the pass count.

### 2026-09-01 engine-dev-2 — CORRECTION to the entry above: v12 fixed a DIFFERENT bug than eng-3's stall
type: correction
status: correcting the record (FEEDBACK is append-only, so this amends rather than rewrites)
what: my entry "TOOL reached the kit's PICKAXE requirement only through activeClass" credits engine-dev-3's sustained-loop stall as the thing v12 fixes. engine-dev-3 has since read v12 and corrected me, and they are right: their stall was `mineLane` with an explicit pickaxe class, where v11 ALREADY reached the pick gate through `c === 'pickaxe'`. Their actual blocker was Blocker 3 — ensureTool eating the crafting table — on a bot still running skills v34.
So v12 fixes a REAL but SEPARATE latent bug: `activeClass` null, which is the builder-role or role-less path, where the gate's `picks` requirement was aimed at by nothing. Their report is what sent me looking; it is not what I found. Two different bugs, and conflating them would have left the record saying the pick gate was unreachable in general, which it was not.
why this matters beyond bookkeeping: team-lead reversed the keep-picks:2 decision on the understanding that eng-3's run proved the gate unreachable. It did not. Raised before making the kit change rather than after — lowering a field-proven safeguard on a retracted premise is not a change to make quietly.
evidence that picks:2 IS reachable, AGENDA-DRIVEN (project set, ladder left to tick, nothing hand-called), on the WORST case (no project tool, builder role, so activeClass is null): `TOOL: started ensureTool` at picks=1 -> picks=2 two polls later -> `PROJECT: started mineLane` with `activeTaskRung=PROJECT` and kit missing empty.

### 2026-09-01 team-lead — DOCTRINE: stopping the ladder is necessary but NOT sufficient
type: doctrine
status: adopted — refines the measurement-isolation rule from earlier today
what: the earlier rule was "`A.busy = true` is not isolation; `__agenda.stop()` is" — true, and it is what stops two things driving one body. But it is only half the discipline, and the missing half cost me a wrong "does not reproduce".
the refinement (team-lead's, and it is correct): **to test what the ladder PROVISIONS, let the ladder DRIVE.** Hand-calling the skill proves the CAPABILITY exists while bypassing the rung's `fire()` — which is the very logic that decides whether the capability is ever invoked. I hand-called `ensureTool(..., {spare:true})` twice, watched picks go 0 -> 1 -> 2, and reported the stall as not reproducing. Both halves of that were true and the conclusion was still wrong, because the broken part was the caller, not the callee.
so the two rules compose rather than compete: STOP the ladder when measuring a skill in isolation (or two things drive the body and the numbers are garbage — the phantom item-loss); DRIVE with the ladder when the question is what the ladder does (or you bypass the decision under test). Pick the one that matches the question, and say which you used when reporting, because the two answer different questions and are not interchangeable.

### 2026-09-01 engine-dev-2 — v12 verified to close the MINER case too (agenda-driven), so picks:2 stays
type: verification
status: closed — no kit change made
what: team-lead's pre-commit condition was precise and correct: if v12's `kitPickShort` only covered the activeClass=null role-less path, then engine-dev-3's miner case (activeClass='pickaxe', TOOL provisioning 1 while the kit wants 2) would still be open — and the soak bot is a miner. engine-dev-3 had inferred exactly that from my v12 comment, which emphasises the role-less case.
The inference was fair; the code is unconditional. `kitPickShort(s)` is asked BEFORE the activeClass guard and never consults activeClass. But that deserved a measurement rather than an argument, so I built the miner shape exactly: role `miner` (activeClass resolves to 'pickaxe' through the ROLE path, no explicit project tool), 1 pickaxe held, kit wanting 2. AGENDA-DRIVEN per the doctrine — project set, ladder left to tick, nothing hand-called:
  poll  1  rung=TOOL     task=ensureTool  picks=1   ("TOOL: started ensureTool")
  poll  3  rung=RESTOCK  ...              picks=2   missing=[]
  poll 13  rung=PROJECT  task=mineLane    picks=2   activeTaskRung=PROJECT / activeTaskName=mineLane
So the ladder provisions the second pickaxe itself and the project departs. v12 closes BOTH shapes.
DECISION: keep `picks: 2`; no kit change. The reachability defect was at the RUNG and is fixed there. Lowering the number would have made the repro pass while leaving the requirement unaimed — satisfied only incidentally by produce's internal ensureTool — and latent for the next tier wanting a spare. team-lead's design argument (the makings are a superior spare, since they recraft repeatedly while a physical spare covers one loss) still stands on its own merits and is a reasonable POST-soak simplification with its own verification; it is not an emergency fix during a launch hold.
process note: engine-dev-3 refused to spawn against an agenda v12 they found on disk but not in the log, which was exactly right — runner.js injects the ON-DISK file, so an uncommitted edit taints a gate result. Their message crossed my push (v12 = bb5def5, committed before they looked). Verified rather than asserted afterwards: `git status` empty, HEAD identical to origin, and agenda.js/skills.js/producer.js each byte-identical to `git show HEAD:<file>`. team-lead has added "git status clean before spawn" to the launch checklist regardless, which is the right generalisation.

### 2026-09-01 engine-dev-3 — mining soak deadlocks: payableTier mixed-plank miscount + surface-wood treadmill
type: bug
status: open
what: The v37/agenda-v12/producer-v3 driverless mineLane soak (miner, stripped to cobble40/planks20/food12 at a deep pocket y51) FAILED after ~30 min. First 6 min healthy — self-provisioned picks 0→2, sword, table, 24 torches, mineLane ran PROJECT — then a provisioning treadmill drifted it to the surface (y51→y106, chopping ACACIA) and it deadlocked at 0 pickaxes. mineLane completed 0/~20 attempts (17 cancelled, 16 kit_missing). Two coupled bugs, both in skills.js: (A) payableTier (skills.js:1253) counts `plankStock` across ALL `_planks$` types, but a tool head needs 3 of ONE type — on `oak_planks:1 + acacia_planks:2` it returned wooden_pickaxe (3≥3), the craft yielded 0 (ledger `tier:payable:wooden_pickaxe … craft:wooden_pickaxe:0`), and it NEVER fell through to stone (297 cobble + 8 sticks held, trivially craftable) → terminal deadlock, ensureTool churning ~71s/126-blocks per attempt. (B) underground provisioning depends on WOOD (sticks/wooden-picks/tables) which only exists topside, so the bot climbs out of its depth band chasing trees and mineLane then "runs" where there's no stone — the sustain failure and the source of the acacia in (A). Evidence: logs/metrics-DiggyAshHole.jsonl run r1788240609. producer.js is clean (19 produce ok, torches on demand).
fix: (A-i) count planks by MAX single type, not cross-type sum, in payableTier and craftToolChain; (A-ii) on craft-yield-0 escalate to the next affordable tier (stone) rather than acquisition_failed; (A-iii) for a pickaxe prefer the most DURABLE affordable tier when cobble is abundant — cheap-first wooden (59 dur) re-churns even when the craft succeeds. (B) provision STONE picks for a mining kit (cobble is underfoot), pre-stock/produce enough sticks so wood isn't chased mid-run, and/or anchor mineLane to its depth band so a provisioning excursion can't strand it topside; (A-iii) largely defangs (B) by killing the wooden-pick wood dependency. Owner: engine-dev-2 (skills.js). Verifier: engine-dev-3, on a full-duration watcher + wedge/churn-armed Monitor (last run's observation window only covered the first 6 min, hiding the 30-min rot).

### 2026-09-01 engine-dev-3 — ledger `digs` counter not wired to bot.dig
type: bug
status: open
what: In run r1788240609 every task_end reports `digs:0`, including produce and mineLane runs that demonstrably mined (bot accumulated 297 cobblestone + 141 dirt). So the ledger's `digs` field is not incrementing on actual bot.dig calls — a `digs=0` cannot be read as "did no mining", which nearly cost a misdiagnosis (mineLane's real failure signal is its outcome tally, not digs). Not load-bearing for the mining-deadlock finding above, but it blinds any dig-throughput metric.
fix: wire the telemetry dig counter to the actual bot 'diggingCompleted'/dig path (or wherever task instrumentation counts actions) so digs reflects blocks broken during the task. Owner: engine-dev-2 (telemetry.js / instrumentation).

### 2026-09-01 engine-dev-2 — FIXED both mining-deadlock bugs above (skills v38)
type: bug
status: shipped(skills v38, b5aadaf) — verified on engine-dev-3's exact terminal inventory
what: engine-dev-3's root cause was correct to the line, and both bugs are mine. Fixed all three of their proposed levers, because they address different layers and the third is what kills the treadmill:
(A-i) SPECIES ACCOUNTING. `payableTier` summed plank stock across ALL `_planks$` types; a tool head needs 3 of ONE. Affordability is now the largest single species, in `payableTier` AND in `craftToolChain`'s own bill — and the log->plank conversion now converts the species it COSTED rather than whatever log came first, which is what produced the mixed oak+acacia stack in the first place. That last part matters: fixing only the counting would have left the chain still able to manufacture a mixed stack on the next run.
(A-iii) DURABLE-FIRST, not cheapest. This is the treadmill fix and it is the one worth arguing for on its own merits: cheapest-first is the wrong ECONOMY underground. Wood is the scarce material down there; cobblestone is a KIT FLOOR the bot already carries. A wooden pickaxe therefore spends the scarce resource AND dies in 59 blocks, sending the bot back to the surface — which is precisely the y51->y106 drift engine-dev-3 watched. Stone costs what the bot is standing on and lasts 131. On the surface with no cobblestone it still falls back to wooden, so nothing is lost where wood is the abundant material.
(A-ii) ESCALATION as a net, not a point fix. A craft that yields nothing now tries the next affordable tier instead of returning acquisition_failed. The affordability check cannot see every reason a recipe refuses — the mixed-plank case proved that — and giving up while carrying the materials for the next tier down IS the deadlock shape. One attempt per tier, so an unmakeable tool still fails fast.
verified: on their exact terminal inventory (oak_planks 1 + acacia_planks 2, cobblestone 297, sticks 8, table, no pickaxe) v38 crafts a stone_pickaxe — 3 cobble and 2 sticks spent, mixed planks untouched, table taken back. And given 16 planks AND 32 cobble both affordable it now picks stone, keeping all 16 planks where v37 would have burned 3 on a wooden one.
(B) the depth-band anchor for mineLane is NOT done and is deliberately left open — (A-iii) removes the wood dependency that caused the drift, so the treadmill's cause is addressed; whether mineLane also needs a hard depth anchor should be decided from the NEXT run's data rather than pre-emptively, since a second mechanism aimed at a cause that is already gone is how a codebase accretes.
process note, and it landed on me this time: re-injecting skills.js resets the registry, so my own pre-flight failed 42/44 with `produce METHOD present (undefined)` until I re-injected producer.js. That is `stack-check` doing exactly the job it was added for, one commit after I added it.

### 2026-09-01 engine-dev-2 — on eng-3's `digs:0` finding: the SPAN is fine, suspect the LISTENER
type: bug
status: open — not fixed (non-blocking, and not worth a telemetry change during a launch hold)
what: partial diagnosis so whoever picks it up does not start where I did. The per-task span association is CORRECT: `taskStart` sets `tid: task.id` and `taskEnd` compares `M.task.tid === task.id`, so the zeroed-fallback branch is not the cause. The counter itself is wired (`bot.on('diggingCompleted', onDig)`), and it DOES increment — a live bot read `digs: 1` globally right after mining one block. So the shape of the bug is that `diggingCompleted` fires far less often than the bot actually digs, which makes the per-task figure read 0 rather than being lost at aggregation.
UNVERIFIED HYPOTHESIS, flagged as such: telemetry installs once against the bot object, and a RECONNECT builds a fresh bot while the listeners stay bound to the discarded one — the exact presence-is-not-liveness class this codebase has been bitten by four times (it is why `__payloads` has a staleness registry). Worth checking whether `telemetry.install` runs per connection or once per process BEFORE looking anywhere else. Also worth ruling out: pathfinder's own movement digs may never route through the event.
UPDATE (engine-dev, picking this up for #52/M1) — the reconnect half of the hypothesis is checked and does NOT hold as the sole cause, ruled out by direct counter-evidence rather than reasoning about it: `telemetry.install()` is actually called INSIDE `runner.js`'s `createBot()` (confirmed by reading the call site, `runner.js:511`), and `createBot()` genuinely IS re-invoked on every reconnect (`runner.js:438`'s own comment: "reconnect calls createBot() again and builds a FRESH bot object") — so a reconnect SHOULD rebind fresh listeners to the fresh bot, not leave stale ones. More directly: `SchrottSepp` (a bench bot I spawned fresh for an unrelated C5 dry-run, single session, zero reconnects, real `safeDescend` digging with genuine movement) still shows `digs:0` on its `task_end` records — a fresh single-session bot with no reconnect at all reproduces the bug, which a pure reconnect-orphaning explanation cannot account for. Cross-bot comparison across `logs/metrics-*.jsonl`: `mineLane`/`safeDescend` `task_end` records with real movement show `digs:0` on DiggyAshHole, LokalLothar, and SchrottSepp, but correct nonzero `digs` (12, 66) on KaputtKuno and SoloSauhund, for the SAME skill types — so it isn't skill-specific either. Local server went down (`ECONNREFUSED :25599`) before I could instrument this live further (watch `globalThis.__metrics.task`/`_digs` directly across a controlled dig), so this is as far as static/log analysis alone gets it. Next step for whoever picks it up: live-instrument `onDig`/`M.task` state directly during a single controlled dig on a bot that's shown the zero (SchrottSepp/DiggyAshHole/LokalLothar) once a server is available, rather than continuing to reason from the aggregate logs — the reconnect explanation is ruled out, the pathfinder-routing one is still open, and there may be a third cause neither hypothesis names yet.
SHARPER LEAD (engine-dev, code inspection only, server still down): checked `.v` (schema version) and `.t` (timestamp) on every `digs`-bearing `task_end` record across all bots' ledgers. The split is CLEAN: every `digs:0` record (DiggyAshHole, LokalLothar, SchrottSepp) is schema `v:2`; every correct nonzero record (KaputtKuno `digs:12`, SoloSauhund `digs:66`) is schema `v:1`. This is a real temporal/version correlation, not a coincidence across three different bots. IMPORTANT CAVEAT so this doesn't get over-read: the `SCHEMA_V` 1->2 bump commit itself (6513682) touches ONLY the `SCHEMA_V` constant in telemetry.js — nothing in `onDig`/`M.task`/the digs-counting path at all — so the schema bump is not itself the mechanism; it's a clean TIME MARKER for something else that changed in the same general window (this session had extremely rapid, concurrent iteration across telemetry.js/skills.js/agenda.js/runner.js in that exact stretch). Ruling out via reasoning alone which of those concurrent changes is the actual cause isn't reliable — the honest next step is `git bisect` on `logs/metrics-{Diggy,Lokal,Schrott}*.jsonl`'s timestamp range against telemetry.js/skills.js commit history, or the live instrumentation above, once either is available. Flagging the precise correlation now so whoever has server or bisection time doesn't have to re-derive it.
RESOLVED (engine-dev, live trace, local server reopened) — the bug does NOT reproduce on the current stack (skills v41). Live-verified twice on a fresh throwaway bot (DigsTrace): a real `safeDescend` dug 1 block, ledger `task_end` correctly showed `digs:1`; a real `mineLane` (target count 4, non-vein) dug 4, ledger correctly showed `digs:4`. Did not pin the exact fixing commit (didn't bisect — the live confirmation was decisive enough on its own and bisection wasn't needed once it stopped reproducing), but the likely candidate given the timing is the digchain work landing since — whoever picks up digchain-related follow-ups, this is worth knowing it's a probable side-fix, not confirmed causally. No further action needed on this item; #52/M1(b) can be considered closed.

### 2026-09-01 engine-dev-2 — the depth ANCHOR: half of it already exists, the other half is deferred scope
type: finding
status: open — NOT built, recommending the decision come from the next run's data
what: team-lead asked for mineLane depth-anchoring as a backstop: "if a wood trip does happen, return to the anchor — never mine where there's no stone." Splitting that in two, because the halves have very different costs:
- **"never mine where there's no stone" is ALREADY GUARANTEED.** mineLane throws `fatal('not_found', 'no <target> within <cap> blocks')` when its scan comes up empty, so a bot at the surface does not churn fruitlessly on a stone lane — it refuses immediately and honestly. mineLane also already accepts a `laneY` param ("only blocks within 2 of this Y"), so a caller that wants a band can pin one today without any new code.
- **"return to the anchor" is new travel behaviour**, and it is adjacent to #43 item 2 (reactive ascend-to-resupply-and-return), which is phase-1.5 by explicit decision. Building a return-to-work-site path during a launch hold, unverified, is the kind of change most likely to make the next run worse rather than better.
AND THE TALLY ARGUES AGAINST URGENCY. engine-dev-3's failing run was `mineLane 0/20 ok (17 cancelled, 16 kit_missing)` — dominated by attempts that never STARTED (the kit gate) or were preempted, not by attempts that ran fruitlessly at the wrong depth. The deadlock and the gate were the cause; surface-mining was a symptom of being up there at all, and v38's stone-first tier choice removes the reason the bot went up.
recommendation: let the re-verify decide. If the run still drifts topside with v38+v39, that is the evidence that earns the anchor and it should be built as a GENERAL "return to the project's work site" in the agenda rather than a mineLane special case — the drift is not mineLane's bug, it is the ladder leaving a work site and not coming back. If it does not drift, the anchor is a mechanism aimed at a cause that is gone.

### 2026-09-01 engine-dev-3 / engine-dev-2 — the depot PROBE should be ordered, not distance-bounded
type: feature-request
status: open — POST-SOAK by agreement (eng-3 flagged it explicitly as not-a-launch-hold; their fixture was unrepresentative)
what: engine-dev-3 confirmed skills v38 works (stone pickaxes at 130/131 durability, no mixed-plank deadlock, 12 planks retained, mineLane ok:1, 26 torches) and surfaced one cost: `ensureTool`'s depot-withdrawal step (`ctxlessWithdrawTool`, a 25s `gotoT`, no distance or cost bound) walked the bot the full **293 blocks** to the depot before settling — ensureTool tasks moving 185 and 170 blocks, 47-110s each. Their pocket was 293 blocks + 60y from the depot; the soak's geometry is ~40 blocks, where it is tolerable. Same class as the RESTOCK depot short-circuit already filed.
MY RECOMMENDATION, and it is deliberately NOT a distance cap: **reorder, don't bound.** A distance threshold needs tuning, is wrong either side of the boundary, and encodes a guess about geometry. The reason the depot step exists at all is that withdrawing a banked spare used to be cheaper than crafting one — and since v38 that premise is mostly gone: a tool payable from CARRIED materials is a ~2.2s in-place craft using cobblestone the kit already requires. So the rule should be the local, deterministic test rather than the geometric one: **if `payableTier` says the tool is craftable from what the bot is carrying right now, craft it and skip the depot entirely.** Fall back to the depot only when nothing is payable.
That is the same principle already applied twice in this file and both times it was right: the crafting-table lookup tries the table in the BAG before travelling to the depot's, and `payableTier` itself spends carried stock before gathering. "Spend what you already have before going to fetch" generalises; "don't walk more than N blocks" does not.
sizing note for whoever takes it: this also subsumes the RESTOCK half, since the same ordering question applies there — RESTOCK already has the `reached`/TTL machinery to avoid re-probing a depot it could not open, but nothing that skips a probe it has no NEED to make.
also worth recording from the same exchange: engine-dev-3 mis-read their own first v38 run as a drift-failure and corrected it themselves after checking the outcome tally — mineLane had in fact completed. Worth noting because the correction came from reading the TALLY rather than the trajectory, which is the same discipline that found the original bug: the shape of a run is not its result.

### 2026-09-01 engine-dev-2 — depot-less soak: the withdraw fast-fails correctly, but `depot.craftingTable` is a second travel target
type: finding
status: open — SETUP note for the depot-less soak, no code change proposed
what: team-lead is running the un-fixtured soak DEPOT-LESS by design (produce supplies everything), so I checked that configuration against the code rather than assuming — it is the exact config the run will use and it was a branch verified by reading, never by running.
CONFIRMED GOOD: with no depot coords registered, `restock` throws `fatal('not_found', 'no depot chests configured')` IMMEDIATELY, before any travel (skills.js, the `if (!chests.length)` guard). The agenda's error branch then records the whole ask as depot-short and holds it for an hour rather than ten minutes, because a restock that opened NO chest is treated as a fact about the route rather than about stock. So the ~7-minute probe and the 293-block walk simply do not arise, and it will not re-probe mid-run.
THE TRAP: `protected.json`'s depot block has FOUR keys — `minerals`, `wood`, `food`, and **`craftingTable: [-3,111,4]`**. The withdraw path reads only the first three, but `craftToolChain` has a SEPARATE fallback: with no table carried and none within 6 blocks it walks to `depot.craftingTable` on a 25s `gotoT` before giving up and crafting its own. Un-registering the three chests while leaving `craftingTable` therefore leaves the TOOL path with a travel target that the withdraw path no longer has — an unexplained ~25s stall, or a cross-map walk if it is reachable.
setup fix: remove the whole `depot` block, or at least drop `craftingTable` with the chests, so `tablePos` resolves null and the path goes straight to craft-and-place-my-own.
likelihood is LOW and that is the point: the deep kit requires a carried crafting_table and v36 mines it back after use, so the bot should always have one. This is the path for when that invariant breaks — the kind of thing a three-hour run finds and a six-minute one does not.
coverage note: making eng-3's re-verify depot-less too (correctly — matching the soak beats testing a path the soak will not have) means the withdraw-then-fall-back-to-produce SEQUENCE goes unexercised before launch. It is covered by `agenda-deepkit`'s act cases and by earlier live runs, so not worth holding for; recorded so nobody assumes the re-verify covered it.

### 2026-09-01 engine-dev-2 — protected.json is temporarily depot-less for the run; do not let it get committed
type: finding
status: open — OPERATIONAL, restore after the run
what: engine-dev-3 removed the `depot` block from `protected.json` for the depot-less re-verify (backed up, to be restored). Verified rather than taken on trust, since it is shared config that live bots read and non-destruction is a durable law: the edit is surgical — 23 deletions, the depot block only. All 11 regions, `neverProtect` (21 entries), `harvestExclusion` and `home` intact, so digguard's protections are untouched.
it also closes the `depot.craftingTable` trap filed above for free: removing the WHOLE block takes that fourth key with it, so `craftToolChain` has no travel target either. Removing the block beats removing the three chest keys, which is what the earlier entry recommended.
THE RISK, and it outlives the run: the change is UNCOMMITTED while several agents commit to this repo concurrently. Any `git add -A` bakes the depot removal in permanently, and the fleet's real depot economy depends on those coords. Keep the backup OUTSIDE the repo tree and restore at end of run, not end of session.
and a checklist interaction worth knowing: `git status` now shows ` M protected.json`, which will trip team-lead's "clean tree before spawn" item — added after the agenda-v12 incident for a real reason. The distinction that matters there is PAYLOAD files (`skills.js`, `agenda.js`, `producer.js`, `runner.js`), since those are what auto-inject actually reads; a dirty config file is a different fact from a dirty payload. Worth tightening the checklist item to name the payload set rather than the whole tree.

### 2026-09-01 engine-dev-2 — SEQUENCING: the depot restore must wait for the SOAK, not the re-verify
type: finding
status: open — OPERATIONAL, flagged to both parties
what: engine-dev-3 removed the `depot` block for their depot-less re-verify and said "backed up, will restore after". Their "after" naturally means after THEIR run. But team-lead's un-fixtured soak is ALSO depot-less by design and runs after the re-verify — so restoring on the re-verify's completion would silently put the depot back BEFORE the soak, undoing the premise the soak's design depends on.
Two people agreeing on the word "after" while meaning different events. Flagged to both so there is one ordering rather than two compatible-sounding ones: restore after the SOAK.
why it is worth a message rather than a note: the failure would not be LOUD. The withdraw would simply start succeeding, or start walking to a depot 293 blocks away, and the run would score a different scenario than the one specified — with nothing in the output announcing the premise had changed underneath it. That is the same shape as the confounds that invalidated the earlier re-verify (stale skills v34, `role:None`): the run produces numbers either way, and the numbers look like an answer.
restore mechanism, so nobody is working from a different procedure: `protected.json` is TRACKED and HEAD still carries the full depot block (all four keys, `craftingTable: [-3,111,4]` included). `git checkout -- protected.json` restores it regardless of what happens to the `.bak`, which is redundant and — sitting untracked in the repo root while several agents commit concurrently — is the artifact most likely to be swept into a `git add -A`.
THE ONE REAL RISK that outlives all of this: the MODIFIED protected.json being committed. Then the fleet's real depot coords leave the config every bot reads, and nobody notices until a withdraw fails. Recovery from history is easy; NOTICING is the hard part.

### 2026-09-01 engine-dev-2 — CORRECTION: decouple the runs, don't sequence the cleanup
type: correction
status: resolved — team-lead's shape supersedes mine
what: I flagged that engine-dev-3's "restore after" (their run) and team-lead's soak both wanted a depot-less config, and proposed holding the restore until after the SOAK. team-lead's resolution is better and I am recording why, because the reasoning generalises past this file.
My fix created a COUPLING: one run's precondition depending on another run's cleanup discipline, held together by two people remembering the same ordering — which is exactly the ambiguity ("after" meaning two different events) that I had just flagged as the hazard. It reduced the chance of the failure without removing its shape.
team-lead's version removes the coupling instead: the soak's depot-less state is a SEPARATE setup step they perform at launch — re-remove the block if it has been restored, confirm the depot is ABSENT via the bot's own readCfg, spawn, restore to HEAD after. Each run establishes its own precondition and reverts it, so no run can silently inherit a stale one and no one has to remember an ordering.
the generalisable form: when two activities need the same precondition, having each ESTABLISH AND VERIFY it beats having one leave it set up for the other. A verified precondition is a fact; an inherited one is an assumption wearing a fact's clothes — and this session has now been bitten three times by assumptions that produced numbers anyway (stale skills v34, `role:None`, and a re-verify measuring a version nobody intended).
also adopted by team-lead, and worth keeping: the "clean tree before spawn" check now names the PAYLOAD set (skills.js / agenda.js / producer.js / runner.js byte-identical to HEAD) rather than the whole tree. A dirty payload is what auto-inject bakes into a run; a dirty config file is a different fact. The original check would have false-alarmed on exactly the expected ` M protected.json` it was looking at.

### 2026-09-01 engine-dev-2 — RESOLVED: the depot config stays removed; team-lead owns the lifecycle
type: correction
status: resolved — supersedes both of my earlier entries on this
what: final arrangement, after I got the ordering wrong twice. The depot-less `protected.json` PERSISTS through engine-dev-3's re-verify AND team-lead's soak. eng-3 does nothing at the end of their run. team-lead owns all four points: the config stays removed; they VERIFY depot-absent at launch rather than trusting it; they restore with `git checkout -- protected.json` after the SOAK; and they never commit the modified file. One owner, and the session that outlives the others.
MY MISTAKE, recorded because it is the same failure I had flagged an hour earlier with me as one of the two parties. I first told eng-3 to hold the restore until after the soak (coupling one run's precondition to another run's cleanup). Then, reading team-lead's "the soak's depot-less setup is a SEPARATE step I configure at launch" as meaning they would re-remove the block themselves, I withdrew that and told eng-3 to restore normally. team-lead then stated the actual ordering — it stays removed — which matched neither. Three instructions to one engineer on one file.
the root cause was not the ordering, it was that I INFERRED it from someone's description of their own process instead of asking them to state it. "Two people agree on a word meaning different events" is exactly what I had just filed as the hazard; the fix was available the whole time and it was one question.
WHY IT COULD NOT HAVE BROKEN THE RUN, and this is the part worth generalising: team-lead's point 2 — verify depot-absent at launch rather than trust that it is still removed — makes the precondition a checked fact rather than an inherited one. So a coordination mistake between two engineers stays a coordination mistake instead of becoming a bad run. Same discipline as reading the live version line instead of assuming the stack. **A process that verifies its own preconditions is robust to the humans coordinating it being wrong** — which is a better property than everyone remembering correctly, because everyone will not.

### 2026-09-01 engine-dev-2 — my sticks floor raise is what made eng-3's produce bug fire; and what assertions structurally cannot catch
type: finding
status: producer v4 shipped by engine-dev-3 (798fe68) — cross-verified by reading; two notes recorded here
github: felsenuboot/felcrew-mcp#47 (issue-manager sync, 2026-09-01 — the reason-code-plausibility follow-on idea specifically, phase-1.5)
what: engine-dev-3 found `ensureSticks` early-returning whenever `ensurePlanks` could not reach the FULL plank target, so a deep bot holding 8 planks (16 sticks' worth) with no reachable tree got `produce('stick',24)` = `no_wood, made:0` and wedged IDLE on `sticks 3/16`. Their fix — gather what wood you can, then ALWAYS enter the craft loop — is correct and minimal: the loop is bounded three ways (guard < 24, `inv < wantSticks`, break on `!r.made`) and the return contract is unchanged, so only the craft ATTEMPT became unconditional. That is the carried-first discipline the rest of the file already had.
CAUSAL CHAIN, AND IT IS MINE. The bug was latent; MY floor raise walked it into the light. Sticks 8 -> 16 (skills v39) makes RESTOCK's buffered ask 24 instead of 12. On their failing inventory: 3 sticks held -> `stickBatches = ceil(21/4) = 6` -> `wantPlanks = 12`, against 8 planks in the bag, so ensurePlanks fails and the old code bailed. At the previous floor the ask was 12 sticks -> 3 batches -> `wantPlanks = 6`, which 8 planks already covers, so ensurePlanks returned true and the craft loop ran. The floor is still right and the fix is still correct — a partial-success contract that bails instead of partially succeeding is a bug at any ask size — but "engine-dev-2 raised a floor and producer started failing" is an adjacency that gets misattributed later, so it is written down rather than left to be inferred.
WHAT MY OWN ASSERTION STRUCTURALLY CANNOT CATCH, which is the more useful half. The `produce` ASSERTS entry treats `ok:false, made:0` as an HONEST FAILURE and passes it — correctly, because produce was not lying: it said it made nothing and it had made nothing. But it COULD have made 16, and no assertion of mine would ever have flagged that. **Assertions catch LYING, not UNDER-PERFORMING.** That is a real boundary on the verifier layer and it belongs next to the other verification doctrines rather than being rediscovered.
what actually caught it was the agenda's unproductive detector standing RESTOCK down — which is COPING, not diagnosis: it contained the damage and said nothing about why. The signal that would have NAMED it is a contradiction between the reason code and the inventory: `no_wood` reported by a bot holding 8 planks is not a coherent pair.
FOLLOW-ON IDEA, filed not built: REASON-CODE PLAUSIBILITY as a verifier class. Assert that a typed failure reason is consistent with observable state — `no_wood` against held planks/logs, `no_pickaxe` against held pickaxes, `no_coal_nearby` against a coal scan, `no_space` against `emptySlotCount`. It is cheap, it is the same "grade with something that did not do the work" discipline one layer over, and it converts "the ladder stood down" into "produce told you no_wood while carrying the wood". Worth doing after the soak.

### 2026-09-01 Felix (via team-lead) — mineLane ignores ore it exposes; a human veins it out
type: feature-request
status: open — QUEUED post-soak by team-lead, explicitly NOT a soak blocker. FILED not built: it is a skills.js change and the launch stack is frozen.
github: felsenuboot/felcrew-mcp#46 (issue-manager sync, 2026-09-01 — phase-1.5, priority-low, owner-engine-dev-2, cross-referenced to #43)
what: Felix, watching the re-verify: "he keeps ignoring ore if he finds it (like coal or copper)." mineLane mines by TARGET block type, so it veins out stone and drills straight past the coal/copper/iron it exposes, leaving it in the wall. Distinctly non-human — a real miner veins out every ore they hit — and a direct hit on the north star's "behave like a good human player". NOT a self-sufficiency failure (the bot still gets coal via produce('torch') and cobble from stone), which is why it is post-soak.
WHERE IT BELONGS: team-lead's instinct that a general "grab ore you expose" beats a mineLane special case is right — safeDescend passes ore too. The cleanest home is a shared ctx helper called at the dig site rather than a behaviour bolted into each skill.
THE HOOK ALREADY EXISTS AND IS FREE. mineLane's vein-follow (skills.js ~2969) already scans all 26 neighbours after EVERY dig, with no findBlocks — "vein follow: free". An ore sweep is one extra predicate inside a loop that is already running: if a neighbour is an ore we can harvest, queue it. Cost is a set lookup per neighbour.
FIVE CONSTRAINTS whoever builds it should not rediscover:
1. **TOOL TIER — and this is an interaction with my own v38 change.** Durable-first now makes the bot prefer STONE pickaxes. Stone harvests coal, copper, iron and lapis but NOT gold, redstone, diamond or emerald (iron+ required). So a naive "grab every ore" will churn on `tool_missing` against exactly the ore worth most. The sweep must test harvestability against the tool actually held (the machinery exists — `needSpec`/`satisfiesNeed`/`harvestTools`), and the interesting follow-on is whether exposing diamond should TRIGGER an iron-pickaxe upgrade rather than be skipped. That is the "always upgrade gear" instinct, and it is a bigger feature than the sweep.
2. **`count` SEMANTICS.** mineLane counts banked TARGET blocks toward `args.count`. Opportunistic ore must NOT inflate that or the task finishes early on a lucky vein. It also feeds my ASSERTS entry (`mineLane.banked` graded against `args.count`), so conflating the two would make the assertion misgrade — report ore separately in the result, e.g. `{banked, dug, oreGrabbed:{coal:N,...}}`.
3. **INVENTORY PRESSURE.** DEPOSIT fires at freeSlots<=2. More ore fills slots faster, so a long lane will trip DEPOSIT more often; that is correct behaviour but it changes the rhythm and should be watched in the ledger rather than assumed harmless.
4. **PROTECTION** is already handled — bot.dig goes through digguard and `ctx.isProtected` covers target selection — but the sweep must consult it at SELECTION too, or it burns a goto per protected block (the chopTrees-vs-torch_posts grind, already documented).
5. **IT IS THE SAME SHAPE AS THE DEFERRED ANCHOR.** "Leave the lane, do a bounded thing, come back" is exactly the return-to-work-site excursion. If the anchor is ever earned, these two should share one mechanism rather than growing separately.

### 2026-09-01 engine-dev-2 — WHY skills.js is clean of the fail-on-fetch class (not luck; a structural property)
type: finding
status: closed — confirms team-lead's sweep, and names where the class CAN live
what: team-lead's audit swept skills.js for the bail-instead-of-partial-craft pattern engine-dev-3 fixed in producer v4 and found zero instances. Confirmed, and worth recording WHY rather than leaving it as "we looked and found none" — the reason tells the next auditor where to look instead of re-sweeping everything.
THE CLASS CAN ONLY EXIST WHERE THE OUTPUT IS COUNTABLE. Making 16 of 24 sticks is real progress; making 0.6 of a pickaxe is not. So:
- `craftToolChain` produces INDIVISIBLE items (a pickaxe, a crafting table). Returning early when the bill cannot be met is CORRECT there, not the bug — there is no partial to deliver. The analogous protection for the indivisible case is v38's tier escalation: when a craft yields nothing, try the next affordable tier rather than giving up.
- `craftSafe` is skills.js's only COUNTABLE-output path, and it is partial-aware by construction: every exit returns `{ ok: made > 0, made, ... }`, carrying the running count rather than zeroing it. Verified by reading all six return paths.
- producer.js produces countable STACKS (sticks, torches, cobblestone) through wrapper helpers (`ensureSticks`, `ensurePlanks`) that sit ABOVE craftSafe. That wrapper layer is where the bug lived: the primitive reported its partial honestly and the wrapper threw it away.
so the shape to grep for is not "a craft that can fail" but **a wrapper above a partial-aware primitive that converts the primitive's partial into a boolean and bails on false**. skills.js has no such wrapper for countable outputs, which is why it is structurally clean rather than incidentally clean. Any future producer-style helper — a `produce('food')` cook chain, a smelting wrapper — is a candidate the moment it aggregates craftSafe calls toward a quantity.

### 2026-09-01 engine-dev-3 — GATE PASS on the depot-less v4 deep run; the ANCHOR is settled as NOT needed
type: verification
status: PASSED — closes the return-to-work-site anchor question by evidence
what: the depot-less v39/agenda-v12/producer-v4 deep run sustained. ~275 blocks mined driverless (cobblestone 40 -> 315), every torch produced LOCALLY (restock fast-failed `no depot chests configured` with zero travel, produce supplied them), zero errors, no stuck or deadlock. mineLane completed and `assertTask` verified it (`completedOnce=true`) before the ladder fell to IDLE — acceptance criterion #4. Pre-flight 55/55 before AND after, so no drift either side.
THE ANCHOR IS NOT NEEDED, and the run earned that answer the right way. The bot never climbed for wood — it held 26 sticks and stayed in the y51-74 band throughout. Durable-first tier choice (v38) + the 16-stick carried buffer (v39) + engine-dev-3's partial-craft fix (producer v4) together removed the wood dependency that caused the original y51->y106 drift. So the deferred return-to-work-site mechanism stays UNBUILT, and the reason is now evidence rather than argument: the cause is gone, so the backstop is unnecessary. This is the third time today that waiting for a run to settle a design question beat building the mechanism pre-emptively, and the only one where the answer could have gone either way.

### 2026-09-01 engine-dev-3 — mineLane's `count` resets per attempt, so a high count never completes
type: bug
status: open — POST-SOAK (engine-dev-2, skills.js/agenda). NOT a soak blocker IF the launch count is bounded — see the setup note.
what: mineLane's `count` is per-INVOCATION. RESTOCK preempts the project roughly every ~25 blocks for a torch refill, and the next PROJECT run starts mineLane FRESH with `banked` back at 0 — so progress toward a high count is discarded on every preemption. Measured: `count:150` produced ZERO completions across ~275 blocks actually mined, while `count:24` completed cleanly. The bot was working perfectly the whole time; only the bookkeeping said otherwise.
LAUNCH-SETUP CONSEQUENCE, and this is the part that matters before the soak rather than after: acceptance criterion #4 is "advances its project to COMPLETION". A soak configured with a high count would fail #4 while mining productively for three hours — a false FAIL, the mirror of the false-success class we have spent the day removing. The soak's project count must be bounded to something completable inside one torch-refill window (~24 on the observed cadence).
WHERE THE FIX BELONGS, for whoever takes it: NOT inside mineLane. A skill invocation is stateless by design and cannot know about prior attempts. The agenda owns the project and is the thing that preempted its own task, so it is the layer that can carry progress across a preemption — most simply by tracking cumulative progress on `A.project` and re-starting the skill with the REMAINING count, which needs no skill change at all. The general contract that makes it work is one skills already honour: a result reports progress toward its args (`mineLane.banked` vs `count`, `safeDescend` startY/endY vs `toY`). Note the interaction with my ASSERTS entry — `mineLane.banked` is graded against `args.count`, so if the agenda starts passing a decremented count the assertion keeps working, whereas making the SKILL accumulate internally would break it.

### 2026-09-01 Felix/team-lead — #49 idle bots flooded PUBLIC chat with no-op narration (live incident)
type: bug
status: SHIPPED + APPLIED LIVE (skills v40 + graychat v4, 302c69d) — verified quiet on all five bots
what: five freshly-redeployed FELCREW bots put 20+ identical lines into public chat on the cavecrew server, in front of players and an allied crew: "Drop sweep done: picked up 0 drops." and "Nothing to restock.", every idle cycle, from every bot.
ROOT, and it was one line: the task-completion site forced a `'!'` prefix onto EVERY doneMsg, and `'!'` is graychat's IMPORTANT tier. So a NO-OP completion went to public chat BY CONSTRUCTION. It was never a tight loop — the agenda's IDLE rung already has a 30s cooldown; five bots at 30s each simply reads as "every few seconds" from the chat window. Worth noting because the reported symptom ("tight-loop") pointed at the cadence, and the cadence was fine.
TWO FIXES, because the source and the floor are different problems and only fixing one leaves the class open:
- SOURCE (skills v40): a `doneMsg` may now return `null` to announce nothing, and may choose its own tier by prefix; only an UNPREFIXED message defaults to IMPORTANT. `collectDrops` is silent when it picked up nothing, `restock` when it withdrew nothing. Both still write TASK_DONE to the log — the event is recorded, it just stops being news. The same regex fixes a latent `'!!'` on any doneMsg that already picked a tier.
- FLOOR (graychat v4): identical text from one bot inside 60s is dropped; at most 8 chat lines per 30s whatever they say; throttled lines still go to the log tier. This is the half that matters long-term — **a chat layer that relays any repetition given to it is WHY a narration bug becomes a public incident**, so the guard belongs where it covers every future caller rather than the two we just found. Also covers #48's shape.
PROTOCOL AND COMMANDS BYPASS BOTH, deliberately: DEPOT/TRADE/CLAIM are a machine-readable ledger CAVECREW parses, and a dropped ledger line is a LOST TRANSACTION, not a quieter chat.
VERIFIED BEFORE TOUCHING THE FLEET, because every test bot happened to be down: ran graychat's real dispatcher standalone under Node with a stubbed bot — 20 identical lines -> 1 reached chat, 20 distinct -> 7 (rate cap), 6 protocol/command lines -> all 6 passed, 32 throttled lines still logged. Then staged: graychat to one bot, then the rest for immediate relief, then skills.
QUIET FOR THE RIGHT REASON — the distinction worth checking after any throttle fix. 45s after rollout, all five bots idle and healthy: `chat_sent=0`, and critically **`deduped=0`**. Nothing is even ATTEMPTING to narrate, so the source fix is doing the work and the throttle is not merely masking a continuing flood. A quiet chat with a climbing dedup counter would have meant the opposite.
OPERATIONAL FOOT-GUN for the runbook: re-injecting `skills.js` RESETS the skill registry, so `farmskills`/`basekeeping`/`producer` must be re-injected AFTER it or the fleet silently loses `produce` and the farm skills. Verified 21 skills registered on all five afterwards. (This is the same trap my own pre-flight caught me on earlier today, which is an argument for `stack-check` being part of any live hot-patch, not just a pre-soak step.)
NOT DONE, deliberately: the idle-sweep frequency (team-lead's item 3). The cadence was never the bug, and changing a timing constant on a live fleet for no benefit is not a trade worth making during an incident.

### 2026-09-01 engine-dev-2 — #53 movement DETECTION layer: the watchdog was asking the wrong question
type: bug + feature
status: SHIPPED (skills v41) — live on all five bots, pre-flight 75/75
what: the roadmap scoped #53 as "add a position-history watchdog". Building it surfaced that the existing one was not weak, it was asking the WRONG QUESTION. It reset its timer on 0.4 blocks of DISPLACEMENT, so a bot thrashing in place satisfied it forever — it could only ever catch FROZEN bots, never oscillating ones. The signature it missed was already in our own ledger and we had read it as a movement-quality problem: `pf:{partial:416}`, zero successes, ~17 blocks moved, going nowhere, ten times in a row. That bot was moving the entire time.
the rule is now **"am I getting CLOSER"** — a new BEST distance to the goal. A thrashing bot never sets one; neither does a frozen one; one question catches both.
TWO TIMERS, NOT ONE, and this is the design decision worth keeping. I nearly shipped a single progress timer and caught the false positive before rollout: a bot legitimately routing AROUND an obstacle moves AWAY from the goal and sets no new best for the length of the detour. One timer either misses thrashing (if generous) or alarms on detours (if tight), so:
- FROZEN, 6s — not displacing at all. Nothing legitimate stands still that long mid-path. This is the old rule, KEPT, because it was always correct about the case it covered.
- NO_PROGRESS, 15s — displacing but never closer. Calibrated, not guessed: observed wedges ran ~21s against a 20-30s goto timeout, so a 20s window fires barely before the timeout and buys nothing; at 15s the recovery ladder gets a real window. Against that, a legitimate detour must run 15s — ~60 blocks of sprinting — without ONCE coming 0.5m closer than its best.
distance is measured in the GOAL'S OWN metric: a y-less GoalXZ is scored in the plane, or a legitimately-high bot reads as "far" and a descent reads as progress it never made. A goal exposing no position falls back to displacement rather than inventing one.
SUCCESS-SIGNAL ASSERTION: `isEnd` stays primary — it is the goal's own definition of arrival — but when it could not be introspected the old code defaulted to `arrived`, i.e. trusted a bare promise resolve. That is this codebase's recurring false-success shape one layer further down. Distance now decides when isEnd is unreadable and overrides it when wildly off, with the numbers in the error rather than a bare verdict.
_UNSTICK generalized from the hardcoded NUISANCE list to the property that actually matters: any diggable block with `boundingBox === 'empty'` occupying the AABB. The list was written from ONE specimen (leaf_litter) and needed a code change per new offender — cobweb, snow layer, fire, powder snow, whatever 1.22 adds. Solid blocks are still never dug (a stall is not a licence to tunnel) and digguard still vetoes protected positions.
CLASSIFICATION INTO THE LEDGER: `_unstick` now takes the watchdog's verdict and telemetry's `wedge` event records `why: 'frozen' | 'no_progress'`. Without it a shakeout produces an undifferentiated wedge count, which is precisely what the recovery ladder (#54) cannot be ordered by.
TESTABILITY is why the blind spot survived: the detector could only be exercised by reproducing a wedge in the world. `bench/fixtures/move-detect.js` replays synthetic position series through pure hooks — 20 cases including the thrashing regression, frozen, the 13s detour that must NOT alarm, plane-metric goals, and the _unstick property test. Same lesson as `tierFor`: **a rule testable only by staging the bug does not stay tested.**
NOT DONE deliberately: no recovery LADDER. #54 waits on #57's shakeout to rank the real distribution — building an ordered ladder before knowing what to order it by is the accretion we avoided with the depth anchor. Detection first means the shakeout now yields CLASSIFIED stalls to rank.

### 2026-09-01 engine-dev-2 — project work now accumulates across a preemption (agenda v13)
type: bug
status: SHIPPED (agenda v13, 5a63a45) — live on all five, pre-flight 85/85
what: engine-dev-3 measured that `count:150` produced ZERO mineLane completions across ~275 blocks genuinely mined, while `count:24` completed cleanly. `count` is per-INVOCATION and RESTOCK preempts every ~25 blocks for a torch refill, so every resume restarted from zero. The bot was working perfectly; only the bookkeeping said otherwise.
THE SECOND HALF, which was not in the report and is the worse one: **the agenda never read `task.cancelled`.** Every preemption therefore fell into the FAILURE branch — attempts++, stand-down, and after five, `p.blocked`. The project was being BLOCKED for the crime of being interrupted by its own ladder. The count reset merely failed to RECORD success; this actively accumulated EVIDENCE OF FAILURE from a healthy bot, which is the more dangerous shape because it looks like a diagnosis.
fix: work banks whatever a run achieved however it ended; the project resumes with the REMAINING count; a cancelled run is a pause, not a failed attempt.
WHY IT LIVES IN THE AGENDA AND NOT THE SKILL, since the one-line version is tempting: a skill invocation is STATELESS by design and cannot know about prior attempts, whereas the agenda owns the project and is the thing that preempted its own task. There is also a verifier interaction that settles it — restarting with the remainder keeps `mineLane.banked` graded against the count it was ACTUALLY GIVEN, whereas making the skill accumulate internally would push banked past count and quietly break the assertion watching it. The fix that looks simpler would have broken its own grader.
COMPLETION STILL REQUIRES VERIFICATION. Accumulated progress is the skill's own arithmetic, so marking the project done when the numbers add up is the naive-success trap one level up from where it was already found twice today. Reaching the total is NECESSARY; assertTask grading the final run against the count it was given is what makes it SUFFICIENT.
table-driven (`RESUMABLE`) so safeDescend and others are one entry, not a second mechanism.
`bench/fixtures/agenda-resume.js` replays the real cycle against the live rung with `__skills.start` stubbed — 10 cases including the 150/125/.../25 countdown, a cancelled run banking work without accruing an attempt, and progress alone NOT marking the project done.

### 2026-09-01 engine-dev-2 — no narration bypasses graychat (checked), but bot.chat has the same restore-by-assignment shape digchain is fixing for bot.dig
type: finding
status: closed on the question asked; ONE latent hazard recorded
github: cross-referenced onto felsenuboot/felcrew-mcp#49 (issue-manager, 2026-09-01) and #55 (as a second future consumer of the ordered-registry pattern)
what: issue-manager suggested checking whether agenda.js's IDLE rung has its own narration path around graychat's tiering — a good question, since that would have left #49 half-fixed. Checked rather than assumed. It does not:
- `agenda.js` never calls `bot.chat` or `ctx.say` AT ALL. Its `note()` writes to `A.log` and `S.log` only, so the ladder is log-only by construction and the IDLE rung has no narration path of its own.
- No payload other than graychat captures `bot.chat` (`grep '= bot\.chat|bot\.chat\.bind'` over every payload). Since graychat WRAPS bot.chat, anything calling it goes through the tiering; the only possible bypass is code holding a reference captured BEFORE graychat installed, and nothing does that.
So the #49 flood came entirely through the path that was fixed at both layers: skills.js's doneMsg emit -> `say()` -> `bot.chat` -> graychat. No third path.
THE LATENT HAZARD, worth recording because it is the same class this repo has already been bitten by: graychat's `restore()` does `bot.chat = origChat` — **restore BY ASSIGNMENT**. That is precisely the pattern that caused the live outage when `idleguard.stop()` stripped the dig-guard stack: if anything ever wraps bot.chat ABOVE graychat and graychat then restores, the upper wrapper is silently stripped. It is LATENT today because graychat is the only bot.chat wrapper — but "only one wrapper today" is exactly what was true of bot.dig before it had three.
this is the same shape engine-dev-3's `digchain.js` (#55) is solving for bot.dig: a single ordered wrap point that rebuilds from a registry instead of stacking, recovering the true original by walking `__wrappedTarget`. If a second bot.chat wrapper is ever wanted, the answer is that pattern rather than a second `bot.chat = ` assignment. Not filing an issue — there is no second wrapper to coordinate — but the next person who wants one should know the shape exists and is already built next door.

### 2026-09-01 engine-dev-3/engine-dev-2 — the working tree IS production, and a digchain transition hazard
type: finding
status: runner-first ADOPTED (d575bdc); one invariant proposed to engine-dev-3 for digchain
what: engine-dev-3 established a fact I had not been treating with enough weight: **the live cavecrew fleet runs from THIS working tree.** Verified independently — the five bots' cwd is `/home/felix/minecraft/bots` and `injectPayload` does `readFileSync` (runner.js:204), so auto-inject on RECONNECT reads whatever is on disk at that moment. There is no staging step between an edit and a live bot beyond the timing of a reconnect. A half-finished edit to a payload file is one disconnect away from a real server.
IT INVERTED MY ROLLOUT CALL, and the way I was wrong is the useful part. I argued runner-LAST for #55 by analogy with holding the KIT_TIERS flip until `produce('crafting_table')` existed — but I applied that precedent BY SHAPE without re-deriving which side the danger was on. In the kit case the hazard was a gate demanding something unsatisfiable (deadlock). In this one it is inverted: a guard with no coordinator to register into is an UNGUARDED dig on a bot protecting a real base, while a coordinator with an empty registry is a harmless passthrough. Coordinator first. **A precedent transfers by its FAILURE DIRECTION, not by its shape.**
THE TRANSITION HAZARD, found while checking whether digchain could be hot-injected into the live five: `trueOriginalOf` walks `__wrappedTarget` all the way down. `digguard` (122) and `toolguard` (144) both publish it; **`reachguard` does NOT**, and reachguard wraps outermost. Confirmed live: `bot.dig` on FurzFriedrich has no `__wrappedTarget`, so the walk stops at depth 0 and a hot-injected digchain would wrap ON TOP of the intact stack. Safe — but safe BY ACCIDENT, and the refactor removes the accident. The dangerous sequence is concrete: refactor reachguard first, leave digguard/toolguard self-wrapping, and any digchain rebuild then walks past both to the pristine dig and installs an EMPTY chain — an unguarded bot.dig on the live base, the `idleguard.stop()` outage shape reached from a new direction.
proposed invariant (engine-dev-3's file, their call): **an empty registry must never replace an existing wrapper.** If the registry is empty and the current bot.dig is not already a digchain wrapper, record the true original but leave bot.dig alone. A passthrough that discards guards is strictly worse than not installing — and encoding it in the file means no ordering mistake by any of the three of us can produce the unguarded state, rather than relying on my having reasoned about the order correctly.

### 2026-09-01 engine-dev-2 — CORRECTION: my digchain empty-registry invariant was insufficient
type: correction
status: superseded — the working invariant is "never discard a wrapper you did not create"
what: I proposed to engine-dev-3 that digchain should refuse to install when its registry is EMPTY, to stop a passthrough replacing live guards. Working through the actual rollout showed that guard protects the zero case and MISSES the far likelier partial one, so it should not be implemented as stated.
the case it misses: a PARTIAL refactor in the tree — one guard converted, two still self-wrapping. Say reachguard registers while digguard and toolguard still wrap. `trueOriginalOf` walks `__wrappedTarget` from bot.dig down through toolguard's wrapper and digguard's (both publish it, toolguard.js:144, digguard.js:122) to the pristine dig, then installs a chain holding only reachguard's check. **digguard and toolguard are silently stripped** — and the registry has ONE entry, not zero, so an empty-registry guard never fires.
THE INVARIANT THAT WORKS: **rebuild must never discard a wrapper it did not create.** `trueOriginalOf` should walk only while the current function is a digchain wrapper — the marker already exists (`__digchainWrapper`, used by `__detach`). Stop at the first foreign wrapper and build above it. The partial state then resolves itself: digchain(reach) -> toolguard -> digguard -> dig, all three checks still running, converging on the single-chain end state as the remaining guards refactor.
why this beats atomicity as the safety mechanism: an atomic push is a DISCIPLINE and disciplines fail — a bad rebase, a partial cherry-pick, someone else's commit landing between. With the walk fix a partial push degrades to "one extra harmless layer" instead of "unguarded digs on a live base". Keep atomic push as the plan; stop depending on it for safety.
the general form, and it is the third time today a version of this has come up: **a safety check must be aimed at the state that actually occurs, not the cleanest state to reason about.** Empty-registry was the tidy case I could picture; partial-refactor is the one the rollout produces.

### 2026-09-01 engine-dev — survival.js BREAK_LOS: near-death against a REAL skeleton, twice, folds in #32/#38
type: bug
status: open
what: Built #56's induced-stress-sequencing fixture (criterion #3), which deliberately summons a real skeleton so the encounter also exercises #32 (CREEPER/BREAK_LOS have never faced a live mob) rather than a fabricated `__survival.drill()` threat. The RUNG SEQUENCING worked correctly both times — REFLEX/POSTURE took over from maintenance rungs cleanly, `panic_recovered branch=BREAK_LOS` fired, no thrash on the maintenance tier. But the OUTCOME was near-fatal both times: run 1 (confounded — the dark induction site let natural hostile spawning compound the one deliberate skeleton, 16 killed after, not 1) left the bot at 1.83 HP; run 2, in a purpose-built lit and roofed arena specifically to rule that confound out, STILL took the bot to 0.67 HP from what should have been a single skeleton. Two consecutive near-deaths, one of them under a genuinely controlled single-mob condition, is a real signal, not noise.
Also worth noting: "Killed 14 entities" after run 2's cleanup, despite the lit/roofed arena — meaning either the roof/lighting didn't fully suppress spawning in this exact geometry, or the bot moved outside the arena's footprint during the encounter (BREAK_LOS's own corner-step/kiting logic could plausibly carry it out of a 12x12 area while dodging). Flagging this as an open confound rather than asserting "one real skeleton alone nearly killed it" with full confidence — but even accounting for that uncertainty, correct rung SELECTION clearly is not the same claim as the branch's actual damage-avoidance TACTIC working well against a real bow-wielding mob with genuine aim, unlike the fabricated/no-real-position threats `__survival.drill()`/`runBranch()` have been validated against so far.
fix: not proposed — this needs the actual encounter re-examined (does BREAK_LOS's corner-step/2-cobble arrow-shadow logic actually find cover fast enough against a REAL skeleton's aim, or does it take several unavoidable hits before positioning helps) before guessing at a fix. Re-run #56's induced-stress-sequencing fixture with tighter position logging (log the bot's position on every hit taken, not just rung transitions) to see whether it ever actually reached cover, or was still exposed when HP bottomed out.
github: felsenuboot/felcrew-mcp#65 (to be filed alongside this entry)

### 2026-09-01 engine-dev — #65 follow-up: six real bugs found and fixed, but survival is NOT yet solved
type: bug
status: partially fixed (commit 654efc4) — real, verified improvement; goal not yet met
what: Took #65 as assigned ("make the survival branches actually work — bot ends the encounter healthy, not at 0.67 HP", folding in #32/#38). Read branchBreakLOS end to end, then live-traced many controlled single-skeleton encounters on the local test server (a throwaway bot, ZitterZorro, never SoloSauhund). Found and fixed six distinct, individually-verified bugs across three files — full detail in commit 654efc4's message:
1. BREAK_LOS's counter-attack chased a KITING skeleton across open ground with the shield down for up to 15s (the FLEE_HOME "Bernd death" lesson, run in reverse) — restricted to threat-already-at-melee-reach.
2. BREAK_LOS's corner-step search had no overall time budget — inside anything enclosed, several offsets can each burn a full 4s goto; reproduced live: `__survival.branch` stuck on `'deciding'` for 22s solid while HP went 11.6 -> dead, `g.active` blocking even the HP backstop the whole time. Now has a hard 3s search deadline.
3. The 10s re-entry lockout could gag the critical-HP backstop itself — a re-trigger landing inside the lockout window was silently dropped even below hpPanic(8). Critical HP now bypasses the lockout.
4. `branchWallOff`'s ~12-cell placement sequence ran with zero shield and zero HP check — live-traced a bot going 6 HP -> dead DURING construction, never reaching the coffin it was building. Now holds shield throughout, prioritises the threat-facing side, bails on non-essential cells past a critical HP floor.
5. The up-to-60s regen-wait loop after walling off was equally passive — a second live death happened mid-wait, HP flat-then-declining, meaning the "sealed" coffin was still leaking damage and nothing ever re-checked. Now bails to a re-seal pass plus a last-resort swing on critical-and-still-falling HP.
6. **dangerscan.js** (upstream of survival.js entirely): the linear proximity falloff let one clearly-seen skeleton at melee range score ~3.67 at full HP, UNDER the panic(5) threshold — detection only caught up once the bot was already hurt (health<10 multiplier) or the raw hpPanic(8) backstop fired. Live-traced: ~12 HP lost with ZERO defensive response before survival.js was even invoked. Added a close-range escalation so an already-adjacent threat scores over threshold immediately. This is very likely the single highest-leverage fix of the six, verified live (score jumped from a multi-second ramp to 8+ within 1-2s of a skeleton spawning adjacent).

Also fixed two real bugs in #56's own induced-stress-sequencing fixture, found while using it to verify the above: the polling loop broke as soon as the FIRST panic_recovered landed (~12s in) regardless of what happened after — both earlier live trials reported "12s elapsed" and PASSED while, per telemetry, the bot in trial 2 actually took a second hit and died 15s after the fixture had stopped watching (false-success root, same doctrine as EVALUATION.md, just found in a fixture). And once that was fixed and the fixture could watch a real multi-cycle encounter properly, its thrash-check flagged the IDLE floor rung recurring as hysteresis failure — IDLE is defined (via `__agenda.rungs()`'s own max-prio entry, not a hardcoded name) to be superseded by anything and resumed the instant nothing else needs the ladder, so it was exempted the same way safety-tier rungs already are.

WHAT IS STILL OPEN, honestly: even with all six fixes live, a single skeleton starting at true melee/point-blank range against a fresh bot could still kill it in my controlled testing (verified in a purpose-built sealed, lit 7x7 stone box, far from any other mob, single summoned skeleton, agenda paused). Detection is now fast and HP has held stable for extended stretches in trials that previously died outright — real, measured improvement — but the tactical core is not fully solved. One specific loose thread, observed but not root-caused: in at least one trial, `pick()` routed to `branchFleeHome` ("HP 20/20 - breaking off, running for base") against what should have been a BREAK_LOS-eligible ranged threat, right after a respawn — possibly a threats-list staleness/race right after the fresh payload re-injection a death causes, not yet confirmed. Flagging rather than guessing at a fix, per this file's own standing rule.

SEPARATE, TIME-SENSITIVE FINDING: the local test server currently has a large, uncontrolled natural hostile mob population near wherever the existing dig site is (60+ entities tracked at once during one check; a single untargeted `kill @e[type=minecraft:skeleton]` cleared 19-28 of that type alone, repeatedly, over the course of this session). This was silently killing ZitterZorro between supervised trials and confounded several early readings before being caught (cross-referenced against telemetry timestamps to separate contamination deaths from the trials they polluted). `gamerule doMobSpawning false` failed with a syntax error on this server for reasons not diagnosed. This may also be affecting engine-dev-2's concurrent #57 shakeout run on the SAME server (ShakeoutShorty's own chat lines were visible interleaved in ZitterZorro's log throughout this session) — worth a direct check.
fix: commit 654efc4 (survival.js v5, dangerscan.js v4, bench/fixtures/induced-stress-sequencing.sh). Next thread: root-cause the FLEE_HOME-instead-of-BREAK_LOS routing observation, and get one fully clean, uncontaminated multi-trial read (needs the mob-population issue dealt with first, or a location far enough from it to guarantee isolation for the whole trial run rather than just at t=0).
github: felsenuboot/felcrew-mcp#65 (still open — real progress, not closed), cross-reference #32 (CREEPER still never tested against a live mob — did not get to this before the investigation above consumed the session; still fully open) and #38 (underwater BREAK_LOS hang — also not attempted this session, still fully open)

### 2026-09-01 engine-dev — #65 follow-up: BREAK_LOS never verified it actually broke LOS — fixed, bot now survives
type: bug
status: fixed in isolated worktree (bots-65, branch survival-65, commit 76e2d55) — pending land decision
what: Team-lead and engine-dev-2 independently pointed at the same lead: correct rung sequencing with the chosen action still failing usually means the action's success condition was never checked, just assumed. Confirmed exactly that in branchBreakLOS's corner-step search (phase a): it computed the threat's eye position ONCE at function entry, picked a cell predicted to block that sightline, spent up to ~1.5s traveling there, then reported success (`how: 'corner'`) unconditionally on arrival — never re-verifying LOS was actually still broken from the bot's real final position against the threat's real current position. A real skeleton repositions to hold a sightline, so the prediction is often stale by the time the move lands. Corroborating evidence pulled from ShakeoutShorty's (void-for-ranking, but still real) ledger before stopping it: 49 of 54 BREAK_LOS `panic_recovered` events were followed by a new `panic_enter` within 3 seconds — a 91% rapid re-engagement rate, exactly what a false-success branch would produce.
Also found while reading the same code: phase (b)'s arrow-shadow placement reused `p`/`feet` captured BEFORE phase (a) ran at all — if phase (a) moved the bot even once (including a failed attempt), phase (b) built its wall relative to a stale position.
IMPORTANT PROCESS NOTE: this work happened in a git worktree (`/home/felix/minecraft/bots-65`, branch `survival-65`, `node_modules` symlinked from the main tree per the bots-45 pattern) rather than the live tree, specifically because my EARLIER #65 commit (654efc4, six fixes to survival.js/dangerscan.js) had already gone straight to the live tree and was confirmed to have silently contaminated engine-dev-2's concurrent #57 shakeout run (ShakeoutShorty respawned 10 times during that edit session, 4 of them mid-edit before the commit existed — see the entry above this one, and eng-2's confirmation with hard numbers: death:9, panic:2818, danger:1424, wedge:20, ~200:1 signal-to-confound ratio). #57 is now confirmed VOID for ranking. This is why any further #65 work should stay in the worktree until landed atomically.
fix: commit 76e2d55 on branch survival-65 — phase (a) now re-verifies LOS after arriving and abandons the stale search (falls through to phase b/c against the bot's real current position) rather than reporting false success; phase (b) re-reads position fresh and logs (does not silently assume) when a placed wall didn't actually block sight. Live-verified: same style of encounter that killed the bot in every prior trial on the main tree now stabilizes at ~5.3 HP and HOLDS FLAT for over a minute — no further decline, no death (hit the 90s maxRunMs cap rather than completing a clean regen because the test bot had no food, a test-setup gap, not a code gap).
Also fixed, separately: the local test server was using SNAKE_CASE gamerule names (`spawn_monsters`, `mob_griefing`, ...) not vanilla camelCase — `gamerule doMobSpawning false` was silently failing this whole session. `gamerule spawn_monsters false` works and has been applied server-wide, which should fix the uncontrolled natural-hostile-spawning confound noted in the entry above.
github: felsenuboot/felcrew-mcp#65 (still open, pending land decision from team-lead — worktree changes not yet merged to main)

### 2026-09-01 engine-dev — #65: BREAK_LOS/WALL_OFF fixes landed on main; multi-trial verification, one honest failure
type: bug
status: landed on main (commit 65d7950, merges survival-65) — real, substantial, multi-trial-verified improvement; NOT a 100% guarantee
what: Landed the worktree work from the entry above, plus two more fixes found via continued testing:
1. WALL_OFF's regen-wait critical-HP bail (from 654efc4) only checked once per 1000ms. Live-traced a bot holding stable at 7.5 HP for 33s then dropping 5.5 -> 0.8 HP in ~4s during that wait — faster than the old poll could react to. Tightened to 250ms, reordered to swing first (stopping the damage source beats rebuilding a wall around it) with re-seal as a once-per-episode secondary measure.
2. envHazard() trusted `bot.oxygenLevel <= 5` as "drowning" without confirming actual submersion. Live-traced it reading 15 (not the max 20) while `bot.entity.isInWater` was false and the bot stood on dry ground. envHazard() is checked FIRST in pick(), ahead of every combat branch — this spuriously hijacked a real skeleton encounter, sending the bot to "surface" through a solid ceiling for several seconds while the actual threat kept hitting it. Now requires real submersion before trusting the number.
RESULTS ACROSS THREE FULL TRIALS (fresh throwaway bot, real skeleton, food included, agenda paused, sealed isolated box, gear reset between trials): trial 1 (pre-tighten) held stable 33s then died in a fast late burst. Trial 2 (post-tighten) hit an identically-shaped critical burst and SURVIVED it — recovered from 3.3 HP back up to 9+ HP, encounter ended alive at the 90s maxRunMs cap. Trial 3 died from a fast INITIAL burst before either new fix had a chance to matter (this is where the drowning-hijack bug was caught). Reporting this honestly: real, measured improvement (stability periods now last much longer, and the tightened loop has demonstrably recovered a bot from a burst that killed it before), but not a proven 100% guarantee — a single point-blank encounter retains real combat randomness (accuracy/damage rolls) no purely reactive tactic fully eliminates. Test condition itself is also artificially harsh: skeleton spawned 1.5-2.5 blocks away every trial, far closer than dangerscan's real 24-block detection radius would typically allow a genuine first-contact encounter to close to before BREAK_LOS gets a chance to act.
fix: commit 65d7950 on main (merges survival-65: 76e2d55 LOS-verification, 17888a4 tightened regen-wait + drowning fix).
github: felsenuboot/felcrew-mcp#65 (still open — landed real progress, not claiming solved; did not get to #32/#38 this session)

### 2026-09-01 engine-dev — #32: CREEPER tested against real creepers for the first time — survives, but loses ~half HP per encounter
type: finding
status: open — real evidence gathered, no fix attempted (needs design thought, not a rushed patch)
what: branchCreeper had never faced a live creeper before this session (#32's original concern). Ran two controlled live trials (fresh throwaway bot, isolated 31x31 lit platform far from any base, mob_griefing false to protect terrain during testing, restored to true afterward) with a real, normal-AI creeper (`{NoAI:0b}`, i.e. AI ON):
- Trial 1: creeper already at 3.3 blocks when detected. Branch correctly said "Creeper at 3.3 blocks - backing off, do NOT touch it." and ran its retreat loop (~5.5s). Result: bot took the explosion, HP 20 -> 9.4, then reported "recovered" and naturally regenerated back to full over the next ~5s. Survived, no death.
- Trial 2: creeper summoned at a more realistic first-contact distance (7 blocks). It closed distance FAST on its own -- 7 -> 10.2 -> 8.3 -> 5.4 -> 2.8 -> 2.7 blocks in about 5 seconds of normal AI pathing, no special aggro boost -- reached point-blank and detonated before the bot's retreat could open real separation. HP 20 -> ~10.1, then recovered naturally. Survived, no death.
Both trials: no death, consistent ~10-11 HP lost (roughly half health) to one explosion. This is a meaningfully better outcome than the pre-#65-fix BREAK_LOS near-deaths, but it is not "ends the encounter healthy" either -- a creeper's fuse (~1.5s once ignited) combined with its aggressive closing speed leaves very little time for detection + branchCreeper's own reaction to open the cfg.creeperClear(10)-block gap the header doctrine calls for. Theoretical max separation at full sprint over a 1.5s fuse is roughly 6-6.5 blocks even with ZERO reaction delay, well short of 10 -- so at least SOME damage from a creeper that gets to ignite at close-to-medium range looks close to physically unavoidable with a purely reactive retreat-after-ignition strategy.
NOT attempting a fix here without more thought -- the most promising lever is probably making the ALERT tier (score>=2.5, below full panic) proactively create some distance from an approaching creeper before it's already close enough to ignite, rather than only reacting once PANIC or the 8-block creeperRadius escape hatch fires, but that's a bigger design change to dangerscan/survival's tier boundaries than I want to make without dedicated testing time.
fix: not proposed yet — flagging with real evidence per this file's own standing rule, not guessing at a patch.
github: felsenuboot/felcrew-mcp#32 (cross-reference #65)

### 2026-09-01 engine-dev — #38 RESOLVED: not an underwater hang — g.drill() never actually forced the requested branch
type: bug
status: fixed (commit 2e0f270)
what: Set out to reproduce #38's original repro (`drill('BREAK_LOS', {...a real squid entity id...})` hanging 90s) with a real squid in a real water pool. Found the actual root cause is nothing to do with underwater geometry: `enter(why, pickOverride)` captured `pickOverride` as a parameter but never called it anywhere — `out = await pick();` ran unconditionally, using `pickOverride` only as a truthy flag for the lockout-bypass check a few lines above. `g.drill()`'s entire documented premise — go through the real `enter()` state machine "just with the branch forced instead of picked from live threats" (its own comment, still in the file) — was false for as long as this code has existed. Every historical `__survival.drill()` call, including #38's own original repro, silently ran the REAL `pick()` against REAL ambient conditions instead of the branch/threat the caller specified.
This fully explains #38's original 90s hang without any underwater/entity-geometry theory: `drill('BREAK_LOS', {id:<squid>})` found no real threat via `threatsNow()`, fell through `pick()`'s own no-real-threat path into `branchWallOff(null)`, and ran WALL_OFF's regen-wait for reasons that had nothing to do with BREAK_LOS or the squid at all. Reproduced live with the bug still present, using #38's exact repro shape: took the full 60s of WALL_OFF's own wait-loop cap (not quite the original report's 90s outer maxRunMs cap, but the same underlying misrouting — the discrepancy is plausibly just which of the two caps a given run happens to hit first, both being symptoms of the same root bug).
`g.runBranch()` was NOT affected — it calls `branchFor()` directly, bypassing `enter()`/`pick()` entirely, exactly as documented.
Side note, not chased further: the fixed drill's corner-step result picked a cell 11 blocks below the bot's starting Y in real cave/water terrain, and HP had dropped to 7 by the time I checked shortly after (drill itself reported 13). Possibly fall-damage risk in corner-step target selection not accounting for the PATH to a candidate cell, only the destination's solidity — flagging as an unconfirmed observation, not a verified finding, since this is cave terrain that could have other explanations (real damage from something else nearby).
fix: commit 2e0f270 — `enter()` now calls `(pickOverride || pick)()`; also fixed the maxRunMs force-exit path not incrementing `g.failures` (a hang was previously exactly as "successful" as a clean run by that counter).
github: felsenuboot/felcrew-mcp#38 (resolved), cross-reference #65 (same session)

### 2026-09-01 engine-dev — playcheck landed on main; three ledger gaps filed as #69
type: project
status: done
what: bench/playcheck.mjs landed on main (commit 1285a34, merges branch playcheck). This is the exact committed tool used for the BEFORE baseline reported earlier today (BuddelBernd/KloputzKarl/MettMarcel/PflasterPeter all IDLE, FurzFriedrich SPARSE) — landing the identical file, not a rewrite, so the upcoming AFTER run (once eng-3's #45/#67/#54 batch reconnects) is apples-to-apples with no drift.
The three honest GAP lines playcheck prints (no continuous position trace outside task/goto spans, chest deposits uncounted, chat not classified no-op-vs-meaningful) are now filed as felsenuboot/felcrew-mcp#69, labeled phase-1/enhancement, per team-lead's scoping call — capture and track, don't fix now, don't scope-creep the harness. Notably: the chest-deposit gap is a genuine bug, not just a missing feature — telemetry.js defines `M.chest()` as part of its public API but nothing anywhere calls it.
fix: n/a — landing + documentation entry. Next actionable step is the AFTER run: `node bench/playcheck.mjs --since 1h` against the live fleet once the batch deploys.
github: felsenuboot/felcrew-mcp#69 (new, ledger gaps)

### 2026-09-01 engine-dev — playcheck AFTER run: 4/5 IDLE baseline -> 2/5 IDLE post-#67b deploy; MettMarcel's relocate flail quantified (answers #70)
type: finding
status: reported to team-lead, #70 comment posted with the goto-level data
what: `node bench/playcheck.mjs --since 20m` against the live fleet, window 2026-09-01T12:42Z -> ~13:02Z, following the #45+#67a+#67b reconnect (deploy ~12:43Z, all 5 bots came back clean on skills v43/agenda v17/survival v5).
Before (an hour earlier, same tool, same fleet): BuddelBernd/KloputzKarl/MettMarcel/PflasterPeter all IDLE, FurzFriedrich SPARSE — 4/5 flat IDLE.
After: BuddelBernd 1 block mined, 134.5m traveled, 92.9% stationary — SPARSE. KloputzKarl 1 block mined, 466.5m traveled, 74.8% stationary — SPARSE. FurzFriedrich 16.1m traveled, 97.3% stationary — SPARSE. MettMarcel 0m traveled, 98.1% stationary, 100% no-op (40/40) — IDLE. PflasterPeter 0m traveled, 99.5% stationary, 100% no-op (47/47) — IDLE. Net: 4/5 IDLE -> 2/5 IDLE, 3/5 SPARSE, real distance on two bots. Real, measured improvement from #67b, not a clean sweep.
Checked goto/wedge events directly in each bot's own ledger (not just the playcheck summary) to characterize the two still-parked bots and answer #70's open question:
- MettMarcel: 12 relocate `goto` attempts in the window, ALL 12 `res:"no_path"`, 0m moved, `unsticks:0` on every one. Target crow-distances cycle a fixed set (40/41/46.1/58.3/60.3 blocks). This IS #70's "unreachable-target flail," now real and quantified rather than speculative — consistent with the bot being boxed inside the protected CAVECREW camp sphere, picking real-but-unreachable relocate targets outside it. Precision worth flagging: the failures are `no_path` specifically, not `path_Timeout` — the two are different classify() codes, and #70's "prompt relocate-on-path_Timeout" fork option as literally scoped would NOT catch this failure mode; posted this distinction on #70 for whoever builds the fix.
- PflasterPeter: 45 `goto` events, ALL "arrived" at crow 1-1.4 blocks (trivial local hops, scanning for dark spots with nothing to light). NOT a flail — a genuine no-op task-choice loop (builder with no project falls to a base chore that has nothing to do). Distinct failure class from MettMarcel's.
- FurzFriedrich: small local gotos only, consistent with team-lead's live-log read of a RESTOCK torch-kit deadlock (can't reach 8/8 torches) — a resource-acquisition block, a third distinct failure class again, not pathing and not task-choice.
- KloputzKarl: some real path friction (12 error/2 path_timeout/4 stuck out of 34 gotos) but still landed 466.5m and 16 successful arrivals — reads as normal noise, not a structural block.
fix: n/a (measurement only) — #70's fork now resolves toward relocate-target REACHABILITY FILTERING (not R2 reposition, per #70's own reasoning: the targets have no path at all, so repositioning the search can't help). eng-3 building that per team-lead. Next before/after is queued for reconnect #2, after the relocate-reachability, RESTOCK-deadlock, and builder-no-op fixes land — watching specifically for the 2/5 IDLE -> 0/5 shift and the two SPARSE bots' under-production gap (134m/466m traveled but only ~1 block mined each) moving toward PLAYING.
github: felsenuboot/felcrew-mcp#70 (comment posted with this data), cross-reference #69 (playcheck ledger gaps), #67 (relocate primitive), #54 (R2)

### 2026-09-01 engine-dev-2 — #54 R2 review: sound design, three fixes; the branch itself is the biggest hazard
type: finding
status: reviewed, returned to eng-3 with fixes (R2 stays OFF the fleet until they land)
what: Reviewed 44d4bed (`gotoR` + `_reposition`) as the #54 author. The design is right and the total-wall-clock bound is implemented correctly — `deadline` captured once, retries fit inside the caller's budget instead of multiplying it, non-`stuck` failures re-throw unchanged, so the change is strictly additive. Routing gotoNear/gotoSee through it is the correct blast radius. Three things must change first:
1. `_reposition`'s `catch (_) {}` swallows the `Cancelled` sentinel that `ctx.step()` throws (skills.js:266-267, 416-417). Cancellation is delayed up to 1.5s AND the `finally` clears `forward`/`jump` — so a dying reposition clears control state out from under whatever just preempted it, which during a survival flee is the wrong bot to be stopping. Same shape as #27. Rethrow when `e && e.cancelled`.
2. `MET().recovery('R2', n)` emits into a sink that DOES NOT EXIST — telemetry.js has `M.unstick`/`M.retry`/`M.placed`/`M.craft`/`M.chest` but no `recovery`, so the `m && m.recovery` guard is permanently false. R2's firings are invisible to the ledger, which is precisely what #70 says must be measured post-deploy and what the recovery-ladder design named as its acceptance criterion.
3. The BRANCH is the real hazard. `main..hunt-gate-45` is four commits, but three (#45, #67a, #67b) are ALREADY on main as separate cherry-picks (f771c36, 2cb9beb, b0aa295) that git does not recognise as the same work, while `hunt-gate-45..main` is 20+ commits including #70/#71/#72 and the #73-75 batch, with the branch still on `ENGINE_VERSION = 43` against main's 46. Merging would re-apply three duplicates and resolve conflicts against a skills.js three engine versions stale — realistic failure is silently reverting the #70 reachability filter or the #71 charcoal path onto the live fleet. Cherry-pick 44d4bed, do not merge the branch.
DOCTRINE (the reusable one): an OPTIONAL-GUARDED telemetry call is indistinguishable from a rung that never fired. `if (m && m.recovery)` cannot fail, cannot warn, and produces exactly the same empty ledger as a recovery rung that is never reached — so a rung whose acceptance criterion is its own firing frequency must have its sink verified to EXIST at review time, not assumed. Sibling of the existing `M.chest()` gap in #69 (defined in the public API, called by nothing): same class, opposite direction.
DOCTRINE 2: before landing any feature branch, read `main..branch` AND `branch..main`. A branch whose commits were cherry-picked onto main looks four-commits-ahead and is actually twenty behind; only the second direction shows it.
PREDICTION on record before #70's measurement, so the data can refute it: the REPOSITION term will be low-yield and the re-issued A* is where the wins come from. `_reposition` dead-reckons `forward`+`jump` toward a cell 2 blocks away without checking whether anything is between here and there — and in the wedge case something usually is, which is why the bot is wedged. If R2 recovers wedges while displacement is usually ~0, that is the re-plan working and the rung should be simplified.
**SCORED (2026-09-02, engine-dev, first natural firing — see the 2026-09-02 "R2's FIRST NATURAL field firing" entry below for the full data): the prediction reads REFUTED by the one real sample available, not confirmed.** Ten natural firings, one resolution — and the resolution is the ONE case with real `displaced:true`; all nine `displaced:false` retries also failed. Directionally the opposite of "displacement is usually ~0 and the re-plan does the work regardless": here the re-plan only worked ONCE displacement actually happened. n=10 from a single wedge episode is not a rate, so "refuted" should be read as "the first real data point disagrees," not "settled" — but it disagrees, and the honest thing is to say so against the prediction as originally written rather than let the later entry stand alone. The rung is NOT a candidate for the "simplify away the reposition" move this prediction floated; if anything the open question is now whether `_reposition` needs to try HARDER (smarter candidates) rather than being cut.
fix: returned to eng-3; I did not edit skills.js (eng-3's live file, team-lead's standing boundary). Offered to write the telemetry sink if engine-dev/team-lead want it in my lane.
github: felsenuboot/felcrew-mcp#54 (R2), cross-reference #70 (measurement), #27 (swallowed cancellation), #69 (ledger gaps)

### 2026-09-01 engine-dev-2 — movement scarring: the bots stopped placing scaffold long ago; the trench is one unset constant
type: finding
status: characterized (code-level), no fix applied — sequenced after the discovery work per team-lead
what: Felix's two screenshots (bot-made scar vs his own cobblestone road) opened the "no scars" pillar as a workstream. Code audit before touching anything, and the popular diagnosis is half wrong:
PLACEMENT IS ALREADY OFF, ENGINE-WIDE. `baseMovements` sets `scafoldingBlocks = []` (runner.js:122), digguard re-clears it (digguard.js:157), `allow1by1towers = false`, and ashfinder/goto2 runs `placeBlocks: false`. In mineflayer-pathfinder every place-move is gated on `node.remainingBlocks`, which comes from `countScaffoldingItems()` over that same list — with the list empty the planner cannot emit a placement at all (movements.js:315-343). So "bots litter scaffold blocks as they travel" is not a live behaviour of this engine. What is in the world is dug terrain plus LEGACY scars from versions before those fixes. Scope consequence: "restore what you placed" is a one-time world CLEANUP, not an ongoing leak. The one remaining wild placement is survival.js:181's arrow-shadow filler pillar (a path GOAL.md records as never having run); the fix there is mine-it-back-after, not don't-place.
THE TRENCH GENERATOR IS `digCost` ON THE DEFAULT PROFILE. `baseMovements` never sets `digCost`, so it inherits pathfinder's default of 1, and runner.js:221 applies that profile on every spawn and reconnect. `ctx.goto` (skills.js:482) — the universal travel primitive — does NOT switch profiles; only `gotoFar` (skills.js:684) and the restock hauls call `enterHaul`. So every ordinary trip prices a dug block at `(1 + 3*digTime) * digCost` ≈ 4.4 for stone, ≈ 3.2 for dirt — three or four walked blocks. A hill five blocks thick is cheaper to tunnel than to walk twenty blocks around, every time. That is the jagged trench, and it is a runner.js-only change: no skills.js edit, no collision with eng-3's movement lane.
THE REACHABILITY TENSION RESOLVES IN OUR FAVOUR. eng-3's #70 pre-filter probes targets with the WORK profile, digCost 25 (skills.js:770-774). So the GATE is already dig-averse while the EXECUTOR is dig-cheap: the probe promises "reachable while barely digging" and the executor then digs anyway because digging is free. Aligning the executor's digCost with the probe's cannot shrink the set the probe passes — the executor plans on the same graph the probe just proved a path in. And the genuine last-resort dig does not live in the cost model at all: `_unstick` digs through `bot.dig` directly, not the planner, so a dig-averse planner cannot trap a bot that is actually wedged.
fix: proposed shape (not built) — make the tidy profile the DEFAULT and make "dig through" a RECOVERY RUNG (R3, sitting after eng-3's R2 in `gotoR`) rather than a planner default. Tidy first, dig-permissive only on retry: keeps digging available exactly when necessary, is measurable as rung-firing frequency, and lands entirely in my lane (runner.js profile + #54 routing). CAVE stays digCost 1 — underground, digging IS the job. Residual risks to TEST not assume: paths not gated by the #70 probe (depot trips, survival flight, buried targets) could fail-instead-of-dig, and a higher digCost enlarges the search against WORK's 5s thinkTimeout — both arguments for the two-stage escalation over one global constant. I will not pick the digCost number by argument; it needs a scarring metric first, and the cheap one is blocks-to-break summed per executed path (telemetry.js already owns exactly one `path_update` listener, line 278, so the hook exists).
ROADS (second half of the assignment): traffic detection from movement history is blocked — #69 lists the continuous position trace as a MISSING ledger field. Cheaper v1 needs none of it: build roads between REGISTERED endpoints (BASE.md already names base, mine, cavecrew), which is deterministic, needs no new telemetry, and covers the two routes Felix actually cares about. Traffic mining is a v2 refinement once #69's trace lands.
github: cross-reference #54 (recovery ladder / R3), #70 (reachability profile), #69 (position trace gap), TODO aesthetics note

### 2026-09-01 engine-dev-2 — #76 resolveContainer shipped (skills v47): moved-infra self-heal + reach_violation-catch; live-recovered 3 stuck bots

context: Felix relocated the whole base container cluster in-world. All 4 protected.json depot{} coords + BASE.md rows now read AIR (probed live: minerals/wood/food/craftingTable = air). Real new positions: chests @ -7,111,-2..-5 and -1,111,-4/-5; crafting_table @ -1,111,-2; furnaces @ -1,y,-2/-3. Live symptom on 3101/3103/3104 clustered at base: ensureTool axe failing `depot:minerals:none | depot:wood:none | ... | craft:stone_axe:0`, and a repeating `<unhandled-rejection> reach_violation: activate target 5.8m` every ~20s.

root cause of the UNHANDLED reach_violation: mineflayer craft.js:39 fires `bot.activateBlock(craftingTable)` FIRE-AND-FORGET (not awaited) then awaits windowOpen. craftToolChain found the MOVED table via findBlock(r6) at 5.8m (inside the r6 sphere, beyond the 4.5m interact reach), never approached, handed it to bot.craft — reachguard rejected the un-awaited activateBlock as an unhandled rejection, windowOpen never fired, craft yielded 0. craftSafe's try/catch around bot.craft can't catch it because the rejection is on a promise mineflayer never returns.

fix (skills.js v46->v47). NB: folded into skills.js rather than a new infra.js module — a newly-injected payload needs a process RESTART (runner.js applyPayloadStack's inject list is fixed at process start), and the task required deploy-via-reconnect only. skills.js is injected first, so globalThis.__infra is available to all later payloads anyway.
  1. resolveContainer(bot, coord, {types, tol=8, reach}): HIT (coord still a container -> zero scan) / MOVED (one bounded findBlocks + taxicab<=tol filter; with reach:true prefers a WORK-profile getPathTo-reachable candidate so checker==executor) / MISSING-or-AMBIGUOUS (nearest match beyond tol -> log `!infra_ambiguous`, refuse to reassign onto a stranger's chest). tol=8 = the tight base cluster per the base-radius directive (CAVECREW camp is ~60b away, never in range); #76's anti-nudge tol=4 would have left this whole-cluster move unresolved. In-memory cache + one suggested-protected.json-update log line per move. Exposed globalThis.__infra.
  2. craftSafe: APPROACH an out-of-reach opts.table (gotoT r2) before bot.craft — kills the unhandled reach_violation at the source; also resolveContainer a stale opts.table coord.
  3. Wired the miss paths: ctxlessWithdrawTool (ensureTool depot), ctx.withdrawFromChest (was throwing not_found), depositToChest(args.pos), craftToolChain tablePos fallback. restock rides withdrawFromChest.

deploy: cp worktree skills.js -> live tree, POST bot.quit('redeploy') to 3101/3103/3104 (reconnect re-runs applyPayloadStack, re-reads on-disk payloads). No process restart.

VERIFIED live (not assumed):
  - reach_violation unhandled-rejections: was ~every 20s; 0 across all 3 bots after both reconnects.
  - FurzFriedrich: `Tool ready: stone_axe (crafted)` @15:21:01 — crafted at the moved table -1,111,-2 (2.4m after approach). Now holds stone_axe + iron_pickaxe.
  - globalThis.__infra.resolveContainer against the real world: minerals[-5,111,3]->chest[-7,111,-2], wood->[-7,111,-2], food->[-7,111,-2], table[-3,111,4]->crafting_table[-1,111,-2]. All resolve.
  - v47 + __infra on all 3.

WHY #77 write-back NOT auto-persisted: all 3 depot KEYS resolve to the SAME nearest chest (-7,111,-2) — a whole-cluster move destroys the per-key category mapping and proximity can't recover it. Harmless for tool-withdraw/restock, but auto-rewriting protected.json depot{} would blindly collapse 3 categories onto 1 chest and could clobber Felix's discovery-test setup. So #76 self-heals in-memory + logs a suggested update; #77 (persist + human-confirm / category-aware mapping) stays OPEN. Recommend Felix update protected.json depot{} + BASE.md to the real new coords, or leave the discovery test running — the bots now cope either way.

SEPARATE pre-existing issue (NOT this bug, present before the change, not caused by the move): BuddelBernd/3103 + PflasterPeter/3104 sit agenda.owner=IDLE repeating "Not setting off half-kitted — need pickaxes 1/2 / weapon (any sword)" while holding ample cobblestone+sticks and a reachable table. The agenda has no rung that proactively COMPLETES the departure kit when idle — the kit is only a pre-departure gate, and nothing drives them toward a project (base full, no trees in 64), so they idle-collect-drops instead of crafting the missing spare/sword. Stable (no errors/churn) but under-productive. Follow-up candidate: an idle-time kit-completion rung, or relax the departure-kit floor when idle.

files: skills.js (ENGINE_VERSION 46->47). worktree branch: agent-a33b7ab539b2d943d.

### 2026-09-02 engine-dev — M.recovery sink built (closes #54's ledger gap); M.chest wiring specified, handed to eng-3; doctrine sweep clean
type: bug fix + finding
status: telemetry.js side SHIPPED and standalone-verified; skills.js/farmskills.js call sites specified to engine-dev-3, not yet landed (their files — skills.js was mid-edit, git status MM, presumably the 44d4bed cherry-pick, when this session started)
what: respawned onto this lane; onboarded via GOAL.md/FEEDBACK.md/ENGINE_NOTES.md/telemetry.js/#69. Two known instances of the same doctrine violation were on record — an optional-guarded telemetry emit into a sink that does or doesn't exist, in each direction:
1. **`MET().recovery('R2', n)` (skills.js:716, gotoR's catch block) emitted into a sink that DID NOT EXIST.** telemetry.js had `M.unstick`/`M.retry`/`M.placed`/`M.craft`/`M.chest`/`M.danger`/`M.panic` but no `M.recovery`, so `if (m && m.recovery)` was permanently false — R2's own acceptance criterion (its firing frequency) was invisible to the ledger. Fixed: `M.recovery(rung, attempt, extra)` added to telemetry.js, backward-compatible with the existing call (extra is optional). `gid` links back to the FAILED goto span, not the current one — `M.goto` is already null by the time a caller's `catch` block runs (`ctx.goto`'s `finally` always closes the span first), so `gotoEnd` now stashes `M._lastGotoGid` before clearing `M.goto`, and `M.recovery` reads that. Also threads a `recoveries` counter through the task span (same treatment as `retries`/`unsticks`), surfaced in `task_end`.
2. **`M.chest()` was defined and called by nothing (#69 gap 1) — the inverse direction.** Grepped every payload again to confirm the finding still holds (it does): `withdrawFromChest`/`ctxlessWithdrawTool`/`depositToChest` in skills.js and `depositItems` in farmskills.js all move real items through a chest and none of them call it. `withdrawFromChest` is the single shared primitive under BOTH the `restock` skill and buildCore's `doRestock`, so wiring it once covers both callers. Exact patches (4 call sites, all unconditional — log the chest visit even when nothing moved, matching the taskRejected/craft doctrine of never dropping the zero case) sent to engine-dev-3, since skills.js/farmskills.js are their lane (farmskills.js's own header says so explicitly: "STANDALONE injected module... engine-dev-3 lane"). Did not touch either file myself — skills.js was actively mid-edit (git status MM) when I checked, almost certainly the R2 cherry-pick landing.
METRICS.MJS grew two new sections to consume both once deployed: a "recovery ladder" table (firing frequency by rung, paired with the immediately-following `goto` record in the same run's `seq` order — that IS the retry's own outcome, because gotoR's control flow is strictly sequential: gotoEnd(stuck) -> recovery emit -> reposition -> next goto -> gotoEnd, so no bespoke join key is needed), and a "chest transactions" table (grouped by kind, item totals). Both verified end-to-end against a synthetic ledger (stubbed bot, no live server needed — same standalone-dispatcher discipline as the graychat verification), not just read for syntax.
CARRYING Eng-2's ON-RECORD PREDICTION into the design, not just the fixture: "the re-issued A* is where the wins come from, not the reposition." The `recovery` event alone (rung+attempt+gid) already answers "did R2 fire and did the retry succeed" — but scoring which TERM did the work needs one more field the current call site doesn't pass: whether `_reposition()` actually displaced the bot. Proposed a one-line, purely-additive reorder to eng-3 (call `_reposition()` first, pass its boolean as `{displaced}`) — optional, does not block landing 44d4bed, and metrics.mjs already reports the split when the field is present ("retry-arrived with displaced=true: N vs displaced=false: N") and degrades gracefully to "field not reported yet" when absent.
DOCTRINE SWEEP (task 4, eng-2's audit-worth flag): grepped every payload file for the `if (m && m.X)`-guarded-emit shape and cross-checked every hit against telemetry.js's actual public API. Two false-positive classes filtered out (array methods matching the same regex — `m.map`/`m.push`/`m.forEach`/`m.includes` — and `runner.js`'s direct `globalThis.__metrics` field reads, which aren't guarded emits). Confirmed exactly the two known instances above and no others — every other guarded call (`craft`, `danger`, `gotoStart`/`gotoEnd`, `panic`, `retry`, `taskEnd`, `unstick`) targets a sink that genuinely exists. One adjacent observation, not a doctrine instance: `agenda.js:129` defines its own `M()` accessor to `globalThis.__metrics` and never calls it — dead scaffolding, not a broken guard (nothing is silently failing; nothing is called at all). Flagging in case it's a stub for planned rung-level telemetry someone forgot to finish, not fixing since there's no bug.
fix: telemetry.js (M.recovery, M._lastGotoGid, task-span `recoveries` counter, continuous position trace — see next entry), metrics.mjs (recovery ladder + chest transactions sections). skills.js/farmskills.js patches specified to engine-dev-3, not authored by me.
github: felsenuboot/felcrew-mcp#54 (R2 — sink now exists, firing frequency and eng-2's prediction both measurable once landed), #69 (chest gap 1 — wiring specified, not yet deployed)

### 2026-09-02 engine-dev — #69 gap 2 (continuous position trace): cost assessed, built — distance-or-heartbeat gated, piggybacked on the existing sampler
type: feature
status: SHIPPED in telemetry.js, standalone-verified; not yet observed on a live bot (server down)
what: #69's second gap — no position signal exists outside task/goto spans, so playcheck infers "stationary%" from task-span COVERAGE rather than a real trace (a wedged-but-technically-running task reads as active), and eng-2's traffic-based roads v2 has no waypoints to mine at all. Assessed cost before building, per the task brief's explicit ask, because the wrong default (a bare fixed-interval sampler) is the failure mode that actually matters here: telemetry.js already runs a 500ms tick for the odometer, and a naive "emit position on every tick" would 2x the ledger's write rate unconditionally, forever, on every bot, for a signal that is redundant with the odometer over 95% of that volume (a bot standing still or moving smoothly produces the same trace whether sampled at 500ms or 30s).
DESIGN: distance-or-heartbeat gated, piggybacked on the SAME sampler tick that already reads `bot.entity.position` for the odometer — no second timer, no extra position read. Emits a `pos` event when EITHER (a) cumulative displacement since the last `pos` emission exceeds `POS_MOVE_EPS` (6 blocks) — this is what gives roads-v2 real waypoints along actual travel, dense on routes and silent while idle — OR (b) `POS_HEARTBEAT_MS` (30s) has elapsed with no such emission — this is what gives playcheck a positive "still here, still not moving" signal instead of a gap a reader could misattribute to "no data" rather than "frozen in place."
COST, worked through rather than assumed: worst case (a bot sprinting continuously, never idling) is one emit per ~1.07s (6 blocks / ~5.6 blocks/s sprint speed) ~= 3364/hour/bot; realistic mixed play (mining/crafting doesn't move much) is far lower; idle time is capped hard at 120/hour/bot by the heartbeat regardless of anything else. At a record's actual size (`{v,t,bot,run,seq,ev,tid,gid,pos,hp}`, no inventory/danger snapshot — deliberately minimal, that heavier detail already lives in task_start/task_end) this is on the order of a few hundred KB/hour/bot even at the pathological worst case, not the multi-MB/hour a naive fixed-interval sampler would have produced. Judged cheap enough to build now rather than defer, per the task's own "build if cheap" instruction.
VERIFIED (standalone, stubbed bot, no live server): drove a bot 20 blocks in one sampler tick (fires — crosses POS_MOVE_EPS) then held it near-stationary for a second tick (does not re-fire — the eps gate holds, confirming this isn't secretly a fixed-interval sampler in disguise).
NOT DONE: gap 3 (chat content classification, no-op vs meaningful) — out of scope for this task list, left open on #69 for whoever picks it up next.
fix: telemetry.js (POS_MOVE_EPS/POS_HEARTBEAT_MS constants, `pos` emit inside the existing 500ms sampler, `_posEmitPos`/`_posEmitAt` state).
github: felsenuboot/felcrew-mcp#69 (gap 2 closed; gap 1 wiring specified above; gap 3 still open)

### 2026-09-02 engine-dev — R2 wedge fixture PROPOSED, not run: bench/fixtures/wedge-r2-twin-doorway.sh (server down all session)
type: design proposal
status: written and syntax-checked, UNVERIFIED against a live bot — cannot self-report a pass/fail on the actual question, per this file's own discipline
what: while I was building the telemetry side, engine-dev-3 landed 44d4bed as f6adce8 (skills v48) and, in the same commit, built `bench/fixtures/gotoR-recovery.js` — a pure-function replay proving `findRepositionTarget`'s CANDIDATE SEARCH is correct (right cell, right priority order, protection respected). Its own header is explicit about what it does NOT prove: "that walking to the chosen cell and re-issuing the goto actually gets a genuinely wedged bot unstuck. That needs a real pathfinder against real terrain." That's the half assigned to me jointly with eng-3.
WHY THE OBVIOUS CANDIDATES DON'T WORK, confirmed by reading rather than assumed: torch/leaf_litter wedges are PLANNER-RETIRED (`baseMovements`'s blocksToAvoid digs them out before the bot ever steps in — see wedge-torch.sh/wedge-leaf-litter.sh's own headers), so they never reach `stuck` at all any more. A genuine R2-triggering wedge needs (a) an obstruction `ctx._unstick`'s nuisance-block dig cannot clear — solid, not empty-boundingBox — and (b) a caller `timeoutMs` generous enough that the internal FROZEN(6s)/NO_PROGRESS(15s) watchdog can complete 3 escalations (~24-30s+) and actually throw `stuck` before the caller's own shorter `path_timeout` preempts it first. That second constraint is the "thinkTimeout pre-empts stuck" trap noted in an earlier session and is exactly why a hasty fixture would produce `timeout`/`no_path` outcomes that never touch R2 at all, and read as a null result rather than a real one.
GEOMETRY PROPOSED (the fixture file has the full timing math and rationale): a "twin doorway" heuristic trap. A wall separates the bot from the goal with two gaps — a BLOCKED one (`minecraft:barrier`, truly indestructible, no protected.json/digCost dependency) sitting exactly on the straight heuristic line between start and goal, and the real OPEN gap 2 blocks off that axis — deliberately matching `_reposition`'s own dx/dz=2 candidate offsets, so if this geometry wedges the bot at all, the reposition step should land it roughly in line with the real doorway and the re-issued A* should find the now-obvious route. Uses the existing `come` skill (`ctx.retry('travel', () => ctx.gotoNear(...), 2)`, 60s per attempt) rather than any new test hook — `gotoNear` already routes through `gotoR` since f6adce8, so no special wiring is needed to exercise it live.
HONEST UNCERTAINTY, stated rather than hidden: whether this specific geometry actually produces FROZEN/NO_PROGRESS in mineflayer-pathfinder's real search behaviour (vs. just cleanly finding the open gap, or cleanly giving up as `no_path`) cannot be known without running it — that is exactly the kind of thing this file's own doctrine says not to guess at. The fixture's pass condition reflects that: reaching the goal with ZERO `recovery` events logged is reported as INCONCLUSIVE (this geometry didn't wedge the bot, try a harder trap), not a false pass. It also has a joint-authorship note (task assignment: "jointly with engine-dev-3") — sent to them for review/iteration once the server is back, since they own gotoR/_reposition's actual internals and are best placed to judge whether this trap shape matches real observed pathfinder pathology.
WHAT IT MEASURES ONCE IT RUNS: pass/fail on "did R2 fire and did the retry actually complete the task" (the thing #54's fixture cannot show), plus a stderr dump of the raw `recovery`/`goto` ledger records in the fixture's own time window — feeding directly into `metrics.mjs`'s new "recovery ladder" section (see the M.recovery entry above) to score eng-2's on-record prediction (displaced-vs-replan split) against a REAL firing instead of only the synthetic candidate-search replay.
fix: n/a — bench/fixtures/wedge-r2-twin-doorway.sh written, not run. Queued behind the server coming back up, per team-lead.
github: felsenuboot/felcrew-mcp#54 (R2 — the live-resolution half of the proof, still open)

### 2026-09-02 engine-dev — depositToChest's ASSERTS rule has been dead since it was written: reads r.offered, which no commit has ever set
type: bug
status: found, exact fix specified, not applied (skills.js is engine-dev-3's lane) — filed as #85
what: while continuing the doctrine sweep (task 4's spirit, one layer up from the telemetry-sink class) I re-read `ASSERTS.depositToChest` (skills.js ~1344-1349) closely enough to notice `want = r.offered != null ? r.offered : null` — and the actual `depositToChest` skill fn's return value has no `offered` field (`{chest, moved, totalMoved, skipped, chestFull, freeSlotsAfter}`). Didn't take that as a bug on sight — checked history first, per this file's own discipline: `git log -p --all -- skills.js | grep offered` shows exactly one hit, the ASSERTS reader itself, in every version of this file that has ever existed. `offered` has NEVER been set. So `want` is always null, the rule always returns null at the `if (want == null || got == null) return null;` guard, and **every depositToChest task has been silently ungraded since this table entry was written** — not failing, not passing, just invisible to assertion coverage. Exactly the kind of thin-coverage gap metrics.mjs's own line warns about ("a 0% FSR here is mostly UNCHECKED, not verified"), just one level removed from the M.chest/M.recovery class (a table reading a field the skill never populates, instead of a call into a sink that doesn't exist) — worth naming as a sibling of that same family rather than a one-off.
SECOND BUG, currently unreachable and would surface the moment the first is fixed: `got = r.moved` reads the per-item breakdown OBJECT (`{itemName: count}`), not a count — `got === 0` and `got / want` both misbehave against an object. The real number already sitting on the result is `r.totalMoved`.
fix specified (both sides — not applied, skills.js is engine-dev-3's lane): (1) `depositToChest`'s fn returns an `offered` count computed from the `plan` array it already builds (`plan.reduce((a, it) => a + it.count, 0)`, right before the deposit loop); (2) the ASSERTS rule reads `got: r.totalMoved`. With both: a deposit that moved 0 of an offered >0 fails, a partial deposit (chest went full) lands in `yield` rather than misreading as failure — same treatment the `produce`/`huntAnimals` rules in the same table already get.
github: felsenuboot/felcrew-mcp#85 (new)

### 2026-09-02 test-driver — GEAR-RACE run #0 (NacktNorbert, 25599 shared test world): wood-search transient failure then a reproducible spare-pickaxe plank-churn bug
type: bug
status: open
what: driverless GEAR-RACE benchmark (setProject-only steering, one call: `mineLane {target:stone,count:16}`). Bot joined 12:50:24, empty inventory confirmed (fresh name/uuid, never in usercache.json). TOOL rung's `ensureTool` bootstrap for the tier-1 (wooden) pickaxe failed TWICE with `gather:wood(0/2 reached)` (12:53:34, 12:55:05) while the bot visibly wandered ~20-35 blocks from spawn each attempt — no trees found in range despite real travel, not a stationary stall. A THIRD attempt succeeded: `Tool ready: wooden_pickaxe (crafted)` at 12:56:43, `Stone Age` advancement fired 3s later confirming genuine use, not just a craft-and-idle. Total tier-1 time 6m19s from join, mostly spent on the two failed wood searches. A second, independently-driven bot on the same world (SoloSauhund, 3120) hit the byte-identical failure string (`depot:wood:none | gather:wood(0/2 reached)`) repeatedly in the same time window and had been for a while before my run started (log evidence in localserver/logs/latest.log 12:39-12:50) — this is very likely the shared local test world's spawn area being deforested by ~2 days of prior test bots, not a per-run bug, though it also shows `gather` doesn't obviously widen its search radius across repeated failures (attempts 1 and 2 both reported the identical `0/2 reached`, not a growing radius).
SECOND, cleaner finding, NOT world-contamination-explainable: immediately after the tier-1 pickaxe, the kit's underground-tier spare-pickaxe requirement kicked in (`Making sure I have a pickaxe (spare)`) and never succeeded in the ~2 minutes I watched before the run was called: 4 consecutive failures, error string `ensureTool — could not acquire pickaxe: tier:payable:wooden_pickaxe | depot:minerals:none | depot:wood:none | planks:N | craft:tabl...` (truncated by the 100-char chat cap every time, so the actual blocking reason after `craft:tabl` was never visible in any log). N (the reported plank count) was NOT monotonic across attempts: 7, 7, 3, 5 — bouncing rather than converging, i.e. something is gathering/spending planks between attempts without ever completing the second craft. A wooden pickaxe only costs 3 planks + 2 sticks with a table in reach, so 3-7 planks should already be enough; the repeated failure alongside a fluctuating plank count smells like a real bug in the spare-tool branch of `ensureTool`, not a resource shortfall.
fix: (1) the wood-gather failure message should log the actual search radius tried so "did it widen on retry" is answerable without guessing; (2) the chat-truncated `craft:tabl...` reason needs to reach status.log or FEEDBACK-visible logging untruncated — a 100-char chat cap silently eating the one diagnostic field that would explain a bug is its own gap; (3) reproduce the spare-pickaxe plank-churn on a clean bot (isolate from world-contamination) and instrument what `craft:table...` is actually failing on — table missing/out of reach despite `craft_table:1` in the kit, or a race between two ensureTool invocations (initial `activeClass` pickaxe request and the `kitPickShort` spare request) double-booking the same planks.
github: not yet filed — recommend filing once reproduced clean on the 25600 baseline track (run #1) to separate the plank-churn bug from the shared-world wood scarcity.
nuance (team-lead, 2026-09-02): the SoloSauhund citation above needs a caveat — its episode was CONFOUNDED, not a clean second data point. localserver/logs/latest.log shows Felsenuboot repeatedly killing/resetting SoloSauhund in the same window (12:39, 12:44, 12:49:44, 12:50:08 `SoloSauhund was killed` / `[Felsenuboot: Killed SoloSauhund]`), each of which wipes its agenda project the same way a process restart does — so SoloSauhund's repeated identical failure string could just as easily be "project re-armed into the same wall every reset" as "search never widens." NacktNorbert's run is the clean observation: same world, zero external interference, and it DID self-recover on the 3rd in-engine retry (no restart, no reset between attempts 1/2/3) — wooden_pickaxe at 6m19s. That partially CONTRADICTS my "search never escapes a depleted area" framing above: it does eventually escape, just slowly (~2 wasted minutes per failed attempt, 3 attempts to succeed) — the honest claim is "slow/unreliable in a sparse area," not "never escapes." Confirmed independently by the contrast run: OhneHoseOtto on the virgin 25600 track (same seed, untouched trees) crafted its wooden pickaxe in 1m00s flat with zero failed `ensureTool` attempts — see SCOREBOARD.md "Engine Gear-Race" run #1.
IMPORTANT CONFOUND on the spare-pickaxe bug above (team-lead, 2026-09-02): I stopped/restarted NacktNorbert's process at 13:01:27 for an unrelated reason (port reassignment), and skills.js on disk had moved from **v48 to v50** in the meantime (engine-dev shipping live) — the restart re-injected the current tree. Right after that restart, NacktNorbert's spare-pickaxe craft succeeded (`Tool ready: wooden_pickaxe (crafted)` at 13:03:20). Do NOT read that as "the bug is fixed" or "a restart fixes it" — it's confounded two ways at once (fresh runtime state from the restart itself, AND three engine versions of fixes to exactly this code region landing between v48 and v50). All four plank-churn failure observations above (planks 7/7/3/5, `craft:tabl...` truncated) are from **v48**, confirmed by my own `/state` poll immediately after original spawn — that's the version eng-3's diagnosis should key off. The post-restart v50 success only tells us v50 doesn't OBVIOUSLY reproduce it under these conditions, not that root cause is understood or fixed. Cause NOT isolated.

### 2026-09-02 engine-dev-3 — respawn session: #54-R2 landed, #84 idle-kit fixed, #69/#85 patches applied
type: project
status: four commits on main (f6adce8, 1868e61, 38e1adc, 35bbfcd); everything bench-verified, nothing live (server down all session)
what: respawned onto the skills.js lane. Onboarded via GOAL.md, this file's last ~250 lines (engine-dev-2's #54-R2 review, the movement-scarring characterization, the #76 report), ENGINE_NOTES.md (confirmed stale, superseded), EVALUATION.md. Four pieces of work, in order:

**1. #54-R2 landed properly (f6adce8).** Cherry-picked 44d4bed onto main rather than merging `hunt-gate-45`, per eng-2's review: confirmed by reading both diff directions that 3 of the branch's 4 commits (#45/#67a/#67b) are already on main as unrecognized separate cherry-picks and the branch sits 26 commits behind at ENGINE_VERSION 43 vs main's 47 — merging would have risked silently reverting #70's reachability filter or #71's charcoal path. Clean auto-merge, no conflicts, resolved against v47.
Applied eng-2's required fix: `_reposition`'s `catch (_) {}` swallowed the `Cancelled` sentinel `ctx.step()` throws for preemption — a dying reposition would finish its full 1.5s dead-reckoning walk instead of yielding immediately to whatever just preempted it (e.g. a survival flee). Now rethrows on `e && e.cancelled`; everything else stays swallowed (this is deliberately best-effort dead-reckoning, not a hardened primitive).
Left the `MET().recovery('R2', n)` emit in place per instruction (coordinate with engine-dev, don't build the sink myself) — engine-dev landed it independently in the same session (b9ccd20, `M.recovery`), see item 3.

**2. Closed HALF of "R2 resolves a wedge is unproven" (also f6adce8).** `_reposition`'s candidate search (which nearby cell to walk to) was only ever reachable from inside `makeCtx`'s closure — the exact "testable only by staging the bug" shape #53 already solved once for the detection layer (`S.moveDetect`). Extracted it into a pure `findRepositionTarget(bx, by, bz, blockAt, isProtectedFn)`, exposed as `S.recoveryDetect` (same pattern as `S.moveDetect`), and rewired `_reposition` to call it — behavior-identical, verified against the exact extracted code with a standalone scratch harness (6 cases: priority order, fallthrough on no-floor, protection skip, downward-dip search, void-everywhere, offset-order pin) before it ever touched the tree. `bench/fixtures/gotoR-recovery.js` carries the same 6 cases against the live registry. This proves the CANDIDATE SEARCH is correct — cell choice, priority, protection — and says so plainly in both the code comment and the fixture header: it does NOT and cannot prove that walking there actually unwedges a live pathfinder, which needs a real bot.
TIMING ANALYSIS worth recording on its own, since it precisely explains "thinkTimeout pre-empts stuck" rather than leaving it as a vague hazard: `ctx.goto`'s watchdog needs `unsticks>=3` AND a frozen/no-progress window past threshold to throw `stuck` at all. Working the actual constants (FROZEN 6s, NO_PROGRESS 15s, `_unstick`'s own ~0.35s hop): a pure FROZEN wedge (zero net displacement, no AABB-diggable obstruction for `_unstick` to clear) reaches `stuck` in ~25-30s — comfortably inside `gotoNear`'s own 30s default, no long-timeout caller needed. A NO_PROGRESS wedge needs ~60-66s, which is AT OR PAST every caller's budget including the 60s-timeout ones (mineLane's travel-to-site, restock's haul legs) — so NO_PROGRESS essentially never reaches `stuck` under any timeout this codebase actually uses; only FROZEN is a realistic path to R2 firing at all. This sharpens (didn't just restate) the standing finding that torch/leaf-litter wedges are planner-retired (`baseMovements`'s `blocksToAvoid` digs them out before the bot steps in, per `wedge-torch.sh`/`wedge-leaf-litter.sh`'s own headers) — a genuine R2 trigger needs a SOLID obstruction (not an AABB-overlap nuisance block `_unstick` would clear) that produces true FROZEN, not thrashing.

**3. Converged independently with engine-dev on the same timing analysis** (their b9ccd20, same session) — they built the missing `M.recovery` telemetry sink (closing the R2-review ledger gap properly this time: `gid` links back to the FAILED goto span via a new `M._lastGotoGid`, since `M.goto` is already null by the time a caller's `catch` runs), the `#69` gap-2 continuous position trace, and a proposed (NOT yet run — server down) live wedge fixture `bench/fixtures/wedge-r2-twin-doorway.sh`. Reviewed it as the gotoR/_reposition owner: the geometry (a wall with a blocked "false lead" gap on the straight heuristic line and a real gap 2 blocks off-axis, matching `_reposition`'s own offset) and honest INCONCLUSIVE-vs-pass/fail trichotomy are sound design, and it correctly routes through `come`'s near-branch (`ctx.gotoNear(...,60000)`, which chains through `gotoR` since f6adce8) rather than inventing a new call path. One open question worth flagging before it runs: `mineflayer-pathfinder`'s A* is a real graph search, not local hill-climbing — it is not obvious that a solved, reachable open gap 2 blocks off a blocked one would make the SEARCH itself thrash toward the blocked gap (as opposed to just finding the open one cleanly on the first plan, in which case the fixture reports INCONCLUSIVE exactly as designed, which is the safe failure mode). Not a blocker — the fixture already treats this as an open empirical question rather than assuming the trap works, which is the right posture until a server exists to test it on.
Picked up the two exact patches engine-dev specified as belonging to my lane (they deliberately did not touch skills.js/farmskills.js mid-edit):
- **#69 gap 1** (`M.chest()` defined, called by nothing): wired into all four real chest transactions — `ctx.withdrawFromChest` (the shared primitive under both `restock` and buildCore's `doRestock`), `ctxlessWithdrawTool` (`ensureTool`'s depot path), `depositToChest`, and farmskills.js's `depositItems` (`farmCycle`'s deposit step, needed its own `MET()` accessor since payloads don't share module scope). All four log the zero case (nothing matched what was asked) too, matching the `craft`/`taskRejected` doctrine of never dropping it, and all four log only once a chest was ACTUALLY opened — a failed approach (unreachable, stale coord, `chest_open_timeout`) is a failed approach, not a zero-item visit. (38e1adc)
- **`gotoR`'s `{displaced}` field**: reordered so `_reposition()` runs BEFORE the `pushLog`/`m.recovery` emit, so the field reports what actually happened rather than what was about to be attempted. `metrics.mjs` (engine-dev's side) already splits retry outcomes on `displaced` to score eng-2's on-record #54-review prediction that the re-issued A*, not the reposition, is where the wins come from. (38e1adc)
Also fixed a pre-existing, unrelated drift while in farmskills.js for the `depositItems` change: its own version number disagreed with itself (`globalThis.__farmskills.version: 2` vs the module's own `return {..., version: 1}`) — both now read 3.

**4. #85, engine-dev's other handoff (86fef2e): `ASSERTS.depositToChest` has been dead code since it was written.** `want = r.offered` read a field no version of the skill has ever set (confirmed via `git log -p --all -- skills.js | grep offered`: exactly one hit, the reader itself) — every `depositToChest` task has been silently ungraded, not failing or passing, invisible to assertion coverage. `got = r.moved` compounded it by reading the per-item breakdown OBJECT rather than a count. Fixed both: the skill now computes `offered` from the `plan` array it already builds and returns it; the ASSERTS rule reads `r.totalMoved`. Verified across four cases (full success, partial/`chestFull`, nothing offered, offered-but-moved-0) — a partial deposit now correctly lands in `yield` rather than misreading as pass or fail. (35bbfcd)

**5. #84 (idle kit-completion) — built, not just designed.** Confirmed the issue already existed (filed 2026-09-02, owner-engine-dev-3) before filing a duplicate. Root cause, precise rather than the issue's own "nothing drives kit completion when idle": `TOOL`/`RESTOCK`'s `weaponMissing`/`kitPickShort`/`activeFloors` all derive "what kit tier matters" from `projectKit(s)` alone, which returns `null` whenever `A.project` is unset. With no project (base worked out, #67), IDLE's own role-work (`mineLane`/`safeDescend`, kit tier `underground`/`deep`) gets refused by `S.start`'s OWN kit preflight every ~30s cycle — but `TOOL`/`RESTOCK` never look at THAT kit spec, so the shortfall it names is aimed at by nothing. Two rungs, two different ideas of "what kit is relevant right now," and the one that could fix it stayed dark.
CHOICE ARGUED (team-lead asked for this before building): neither a new idle rung nor relaxing the floor. A new rung would duplicate machinery TOOL/RESTOCK already have; relaxing the floor would just be the current bug with a different name (a real project would still hit the same `kit_missing` refusal the moment one gets set — nothing about a bot's actual departure requirements changes just because it's idle). Instead: `roleWorkKit(s)` resolves the kit tier idle role-work is about to need, the exact same way `projectKit` resolves a project's (same position-only-shim, same determinism contract — verified by inspection that every `ROLE_WORK` entry only reads `s.pos`/`s.now`/`s.torches`), and `effectiveKit(s) = projectKit(s) || roleWorkKit(s)` becomes the shared source for all three call sites. A real project's requirement always wins when set; role-work's tier is consulted ONLY as the idle fallback — verified this doesn't get inherited backwards too (a project on `excursion` tier over a miner-role bot must not suddenly demand `underground`'s sticks/table).
VERIFIED by loading `agenda.js` verbatim in a standalone Node harness (stubbed `bot`, stubbed `__skills.registry`/`kitTiers` using the real kit specs and `KIT_TIERS` values) against both v18 and v19: the three "idle, half-kitted" cases fail on v18 and pass on v19 (this is the actual live bug, reproduced, not assumed); six other cases (fully-kitted quiet, no-kit-bearing roles staying quiet, project overriding role-work) pass on both sides, so no regression. `bench/fixtures/agenda-idlekit.js` carries the same 9 cases against the live registry. (1868e61)

STILL OPEN, honestly: R2's live resolution proof (item 2/3 above — candidate search proven, real-wedge resolution not; `wedge-r2-twin-doorway.sh` written, not run, server down); `preflight.sh` was not run against a live bot for any of this (also server down, noted per the task brief rather than silently skipped). All four commits are bench/fixture-verified only.
github: felsenuboot/felcrew-mcp#54 (R2 — candidate search closed, live resolution still open), #69 (gap 1 closed, gap 2 closed by engine-dev, gap 3 still open), #84 (fixed), #85 (fixed)

**6. #10 (assigned, not in the original task list — picked up while continuing on my own backlog):** `openContainerAuto(bot, block)` added (skills v51, bd72b06), routing furnace/blast_furnace/smoker to `bot.openFurnace` and everything else to `bot.openContainer`. Both live reports (bernd-driver, marcel-driver) came from hand-rolled /eval scripts calling `bot.openContainer` on a furnace directly, bypassing the engine entirely — no existing skill actually hits this (`withdrawFromChest`/`depositToChest`/`ctxlessWithdrawTool` all gate on `CONTAINERS.has()` first), so this is new shared infrastructure for driver scripts and the future #59 smelting skill, not a patch to a live bug path. Exposed as `ctx.openContainerAuto` and `S.openContainerAuto`. Dispatch logic verified against a stubbed bot.
github: felsenuboot/felcrew-mcp#10 (fixed)

**SERVER-STATUS NOTE, mid-session:** found evidence the local server came back up while I was working — `SCOREBOARD.md` gained an uncommitted "Engine Gear-Race (2026-09-02, test-driver)" section (a live driverless benchmark, 90-min cap, steered only via `setProject`) and `bench/fixtures/wedge-r2-twin-doorway.sh` was edited in place (uncommitted) with a "LIVE-OBSERVED" note about a real chunk-load race on teleport into an unloaded chunk — someone is actively iterating it against a live bot. Did not touch either file, did not attempt to spawn/reconnect anything myself (per the standing instruction), flagged to team-lead rather than assumed. If confirmed, #54-R2's live resolution proof and #84's live verification may be unblockable sooner than "queued behind the server coming back."

### 2026-09-02 engine-dev — R2 live wedge fixture: harness works, FOUR obstruction mechanisms falsified live, wedge mechanism still unsolved
type: finding
status: harness verified live; the actual trap is open — real negative evidence recorded, not another guess
what: team-lead confirmed the local server was up and this was top of queue. Spawned a fresh test bot (KlemmKuno, port 3130 — apologies to test-driver: this collided with OhneHoseOtto's initial port reassignment, visible in SCOREBOARD.md's run #1 footnote; a control-port collision can happen across DIFFERENT Minecraft server instances since it's a separate localhost namespace, worth checking against ALL running bots next time, not just which MC server is in use) and ran `bench/fixtures/wedge-r2-twin-doorway.sh` for real, iterating on two classes of live-only bugs the design work could not have caught:
INFRASTRUCTURE BUGS IN THE HARNESS ITSELF, both fixed and now real, reusable infrastructure:
1. Teleporting a bot into a chunk its client had never loaded caused a genuine free-fall (observed: y=80 -> y=64) before the fixture's own geometry ever got a chance to matter — the position packet lands before block-state packets do. Fixed with a teleport-wait-teleport-again pattern plus an explicit settle check (`bot.entity.position.y` within 2 of the target) that fails loudly instead of silently testing on the wrong terrain.
2. Vanilla `/fill` SILENTLY NO-OPS ("That position is not loaded") on a chunk the server has never generated, and unlike a player walking in, RCON does not force generation — this script's own `>/dev/null` on every fill call was swallowing that error, so TWO consecutive real runs built literally nothing and the bot's behavior was pure noise from whatever unrelated terrain happened to exist there. Fixed with `forceload add` before building (removed again in cleanup — don't leave chunks force-loaded on a shared server) and a `fill_checked` wrapper that fails the fixture loudly on any non-success response instead of assuming success.
3. A design bug found by reasoning, not observation, before it could bite: two separate `build_platform` "islands" either side of a lone 1-thick wall column left an 8-block strip of unguaranteed natural terrain between them (`build_platform` only builds a square footprint) — exactly the pitfall its own header warns about. Fixed with one continuous floor sized to the full span.
THE ACTUAL OBSTRUCTION MECHANISM, the point of the whole fixture, is still unsolved after four falsified live attempts (full detail + mechanism explanation for each now lives in the fixture's own header, REVISIONS 1-4, so nobody re-tries the same dead end):
1. `minecraft:barrier` in the "blocked" gap: the bot reached the goal in 4s, zero recovery events. mineflayer-pathfinder's A* is a COMPLETE graph search, not local hill-climbing — a block-level-impassable edge is simply excluded from the graph, so the search finds the real gap on its first and only attempt and never "tries" the blocked one at all. There is nothing for R2 to recover from.
2. A non-marker `minecraft:armor_stand` (real hitbox, not a Marker) in the same spot, reasoning that `entitiesToAvoid` (runner.js ~139) is scoped to hostile mobs only so the search would price both gaps as open and prefer the shorter one, while the entity's hitbox should physically stop the walk. LIVE-OBSERVED (raw `bot.pathfinder.setGoal` + polling, isolated single-gap corridor, no fixture harness needed to see this): the bot's own reported position walked straight through the armor stand's exact cell with zero hesitation. Conclusion, and it generalizes past this one entity type: **mineflayer's client-side physics does not simulate entity-vs-entity collision for the bot's own movement AT ALL, only block AABBs.** No entity of any kind can obstruct a bot's own walk this way.
3&4. Went hunting for another leaf_litter-CLASS block (the exact signature that made the ORIGINAL torch/leaf_litter bug possible: empty boundingBox + `shapes:[]` + diggable, "onGround=false forever, jump never fires" per wedge-torch.sh's own header) not yet in `blocksToAvoid`. Queried the live block registry directly rather than guessing — 231 blocks match that signature and aren't blocklisted (full list on request / in the session transcript, notably: every flower/grass/fern/dead_bush/sapling, `cobweb`, `vine`, `glow_lichen`, `snow`, `sugar_cane`, every sign/banner/pressure-plate/button, all coral variants, nether flora). Tried the two most structurally similar to leaf_litter: `cobweb` (a real, intentional Minecraft movement-speed penalty) and `short_dry_grass` (a near-identical thin floor overlay, plausibly the same rendering/collision code family). LIVE-OBSERVED (same isolated corridor, 1s polling from the start): the bot walked through BOTH at full speed, no stall, no slowdown, arrived within the first poll each time. Conclusion: whatever broke onGround/auto-jump for leaf_litter/torch specifically was NOT a general property of "empty boundingBox" blocks — it was those blocks' own quirky code, since patched, and does not generalize across the registry's other 231 same-signature blocks by mere resemblance. A fifth attempt needs a genuinely different theory of the bug, not another pick from the same registry query.
WHAT THIS IS WORTH, honestly: four real, falsified hypotheses with mechanism-level explanations is a materially smaller search space for whoever tries next than "unknown, needs live iteration" was this morning — but it is NOT a proof that R2 resolves a live wedge, and team-lead's framing of this as "the gate between landed and deployable to cavecrew" should be read against that: the gate is still open. Two paths forward, neither attempted yet: (a) a genuinely new mechanism theory (a real execution-level failure the search's block-graph cannot see and `_unstick`'s dig-empty-blocks logic cannot clear — parkour/jump-timing is closed off since `allowParkour=false` removes it from the graph entirely, so it needs to be something else); (b) instrument for a NATURALLY occurring wedge during normal fleet operation (the gear-race run, a reconnect batch) and check whether `recovery` ever fires there — lower construction effort, higher fidelity, but not on-demand.
Cleaned up all test geometry, entities, and forceload tickets before moving on; KlemmKuno rescued to a safe position (took fall damage from the harness bugs above, recovered, no death).
fix: bench/fixtures/wedge-r2-twin-doorway.sh — harness fixes committed; obstruction mechanism left explicitly unsolved with full revision history in the file's own header.
github: felsenuboot/felcrew-mcp#54 (R2 — live resolution still open, now with four ruled-out mechanisms on record)

### 2026-09-02 engine-dev-3 — live-verification pass: #86 (plank-churn + wood-search forensics), preflight wired to 143/143, graychat v5, R2 coordination
type: project
status: four commits (b61f98b through 8f892fc); live-verified on a fresh bot, real server, real preflight run — the first genuinely live confirmation this session, not bench-only
what: processed team-lead's post-server-up queue in order.

**1. #86 filed and fixed: `craftToolChain` wastefully re-crafts a table it already holds and can't place (skills v52).** Traced test-driver's reported plank-churn (7,7,3,5, non-converging) straight to source via the real ledger (`logs/metrics-NacktNorbert.jsonl`): the bot ended up holding **5 crafting_tables**, one per failed spare-pickaxe attempt, and one ledger record shows **+2 crafted in a SINGLE task** (`ensureTool`'s own v38 tier-escalation loop calls `craftToolChain` once per payable tier — tier 1's failed placement leaves a table held, tier 2's call crafts a SECOND on top of it, in one invocation). Root cause: the function checked only whether a table was *findable/placed* before crafting a new one, never whether it was *already held* from a just-failed placement attempt — and a second identical, fungible table cannot change the geometry that rejected the first. Fixed: only craft when genuinely holding zero; the failure reason now says `(already holding one — not re-crafting)` instead of reading as "no table exists" when several do. Verified with a standalone simulation of the decision logic across 4 repeated attempts (only the first crafts) before it ever touched the tree.
Deliberately NOT fixed: *why* `placeCarriedTable()`'s candidate search found nothing valid at the failure position in the first place — that's a geometry question needing a live repro of the actual spot, not a guess, and is separate from the wasteful-recraft bug either way.

**2. The "un-truncate the diagnostic" ask, resolved precisely rather than by raising every cap.** The real ensureTool failure message was 185 chars — `status.log`'s own `pushLog` cap (200) already held it in full; `telemetry.js`'s ledger truncation (160) was the one clipping it, and specifically clipped the DECISIVE tail (`"...and could not place one"`), since the message is a chronological trace and truncation from the end of a "why did this fail" trace cuts the "why". Chat's own (tighter) truncation is untouched — deliberately, per the #49 chat-diet doctrine; chat should stay short, the ledger and status.log are where the full diagnosis belongs. Bumped `telemetry.js`'s new `TASK_ERR_MSG_MAX` constant 160→240.

**3. Wood-search forensics: neither hypothesized mechanism won — it was pure incidence, which sharpens rather than settles the question.** Team-lead asked which mechanism recovered NacktNorbert's ~4-minute wood-search stall (#67b relocate, or wander) before building anything. Traced the full `task_start`/`task_end` sequence: two `ensureTool` attempts failed back-to-back at the EXACT SAME position (`[2,101,-16]`), each `gather:wood(0/2 reached)` after ~90s — `relocateToWork` never fired (it's keyed on IDLE role-work's `RELOCATABLE` set, not on TOOL-rung `ensureTool` failures). What actually moved the bot was **RESTOCK's own travel while probing three registered-but-absent depot chests** — an unrelated rung's unrelated search happened to land the bot somewhere wood was reachable, and the third attempt succeeded from there. Answering the question sharpens the decision rather than closing it: a world *with* real depot chests nearby would give RESTOCK nothing to travel for, leaving the bot stuck with no escape at all. So a deliberate fix IS warranted, and this codebase already has the exact tool for it: #70's checker-matches-executor reachability probe (`_reachOf`, a ~2s `getPathTo` search under the WORK profile, no movement — already reused once in this file for `resolveContainer`'s tablePos check). Wired it into `craftToolChain`'s wood-gather loop: candidates are now tried reachable-probed-FIRST rather than in raw-distance order, never discarded outright (the probe can be wrong, so an unreachable-per-probe candidate is tried last, not dropped) — a genuinely unreachable candidate now costs ~2s to skip instead of the full 20s `gotoT` timeout to fail at. skills v53.

**4. Graychat v5: normalized digits out of the dedup key.** Team-lead's adjacent report: the exact repeating failure line above (`gather:wood(0/N reached)`, N varying) defeated graychat's exact-text dedup, since every distinct N looked like a new message. Keyed the dedup lookup on `text.replace(/\d+/g, '#')` — the ACTUAL sent/logged text is untouched, only the dedup decision ignores numbers. Confirmed scope is correct by reading every call site: `throttled()` only ever gates the `!`/`@` human-facing tiers; PROTOCOL/COMMAND lines (the DEPOT/TRADE ledger this file's own doctrine protects) bypass it entirely before reaching this code, so no risk to machine-readable transactions. Verified the exact reported collision case now shares one key.

**5. Live verification, for real this time.** Spawned `EngineDreckDave`/3150 on the now-sanctioned local server (127.0.0.1:25599), respawned across each fix to pick up v51→v53, wired `bench/fixtures/gotoR-recovery.js` and `agenda-idlekit.js` (both landed bench-only last entry) into `preflight.sh`'s fixture list so the standard gate actually exercises them. First run surfaced a REAL regression from #84's fix, not a bug in it: `agenda-ladder.js`'s shared "healthy at work" baseline never modeled carrying sticks/a table, because before #84 RESTOCK's no-project floor never looked at them (ROLE_FLOOR has no such fields). With `effectiveKit`'s `roleWorkKit` fallback, a miner's idle work at y60 correctly resolves to `safeDescend`'s `'underground'` tier, which wants sticks+table exactly like a project would — so the case correctly started asking for them, and the baseline (holding zero) had never been updated to match. Added `counts:{stick:20, crafting_table:1}` to the fixture's baseline (same pattern as the existing `tools`/`toolCounts` fully-kitted baseline, same reason) — this is the fixture catching up to the fix's intended behavior, not the fix over-firing. Final read: **143/143 across all ten fixtures, live, on a real bot, with nothing skipped** (gave it 4 cobblestone via RCON so `assert-produce` had something to grade).

**6. R2 (task queue item 2): coordinated with engine-dev directly, did not duplicate their live iteration.** They independently ran the wedge fixture live and falsified four obstruction mechanisms with real mechanism-level explanations (barrier: A* is a complete graph search and simply excludes it from the graph; armor_stand: mineflayer's client-side physics does not simulate entity-vs-entity collision for the bot's own movement AT ALL; cobweb/short_dry_grass: the leaf_litter quirk was that block's own since-patched bug, not a general empty-boundingBox property). Proposed two new EXECUTION-time-state-change theories they hadn't tried (a gravity-block cave-in that turns solid after the search commits to a route through it; a flowing-water current strong enough to cancel forward walk speed, which is a genuine FROZEN condition the graph search cannot see coming since water is priced as traversable) — sent directly to them rather than run in parallel, since they own the live iteration and a second uncoordinated experimenter on the same server risks confounding each other's trials. Offered a second bot if useful. R2 stays off cavecrew; the gate is exactly where engine-dev's entry left it.
github: felsenuboot/felcrew-mcp#86 (plank-churn — fixed; wood-search forensics — done, fix landed), #54 (R2 — still open, two new theories proposed to engine-dev), cross-reference #70 (reachability probe reused), #84 (the fixture-baseline gap this surfaced)

### 2026-09-02 engine-dev — bench/gearrace.mjs: the Engine Gear-Race automated harness
type: project
status: built, verified against the two real in-flight/completed runs (NacktNorbert run #0, OhneHoseOtto run #1), one real bug caught and fixed by that verification
what: team-lead's new assignment — automate repeatability behind test-driver's manual gear-race baseline (SCOREBOARD.md's "Engine Gear-Race" section). `node bench/gearrace.mjs --bot <name> [--port P] [--server-dir path] [--cap-min 90] [--append-scoreboard] [--json]`.
GROUND TRUTH, per the brief's own priority order: the LOCAL SERVER LOG is primary (join line for T0, `Tool ready: <item> (<how>)` chat lines from skills.js's ensureTool doneMsg for precise per-tier timestamps — written by the Minecraft server process itself, so it can't be corrupted by an engine bug), the telemetry ledger's `inv` snapshots (task_start/task_end) are the corroborating/fallback source (coarser, but definitionally exact: "does the bag hold >=1" is literally what "first possession" means, independent of acquisition path). Steering-call count comes from the ledger's own `intervention` events (runner.js's #52 tripwire) — GET /state is already structurally exempt from that counter, so this needed no new tracking, just reading what already exists. Confirmed the harness makes ZERO /eval calls of its own (only file reads + one read-only GET /state for version stamps) specifically so running the harness can never inflate the very autonomy count it reports.
A REAL BUG FOUND BY TESTING AGAINST REAL DATA, not synthetic: the first version's epoch-anchor math (converting the ledger's absolute epoch timestamps onto the log's relative-elapsed-seconds timeline) double-counted `t0`, producing a "ledger disagrees by 46759s" false alarm on the very first live test. Root cause: `epochAnchor` was computed as `spawnEpoch - t0*1000` instead of just `spawnEpoch` (the spawn record's own epoch already IS "the real moment corresponding to elapsed-zero" — subtracting t0 again shifted everything by t0's own value). Caught immediately because the harness was run against REAL in-flight data (OhneHoseOtto) rather than trusted on the strength of clean code, fixed, and reverified — the corrected run correctly reports "ledger-corroborated" for the one tier both sources have evidence for.
ADVANCEMENT-MAPPING DISCREPANCY FLAGGED AND NOW RULED (team-lead, 2026-09-02): the assignment's own text mapped `Isn't It Iron Pick?` to the DIAMOND pickaxe and stated "vanilla has no distinct iron-pickaxe advancement" — flagged as likely wrong rather than silently resolved, since real vanilla's `minecraft:story/iron_tools` (that exact advancement) is normally about the IRON pickaxe specifically. RULING: confirmed wrong — `story/iron_tools` IS the iron pickaxe; `story/mine_diamond` ("Diamonds!") covers diamond acquisition instead. `bench/gearrace.mjs`'s `ADVANCEMENT_MAP` corrected to match. The harness's actual design choice was never affected either way and stands as the authoritative approach going forward: it does not use ANY advancement title to decide a tier's completion time — only `Tool ready` lines (exact item name, no title-guessing) and ledger inventory counts ever set a tier's clock. Advancement lines are still surfaced in the output as informational context only.
telemetry.js side: `diamond_pickaxe` was missing from `INV_KEYS` (had `iron_pickaxe`/`stone_pickaxe`/`wooden_pickaxe` but not the top tier) — added, since the ledger is the harness's corroboration source for all four tiers, not three. Forward-looking only; does not retroactively backfill already-written ledger lines.
VERIFIED against real data: NacktNorbert (run #0, 25599, contaminated track) and OhneHoseOtto (run #1, 25600, official baseline, still in progress at test time) both produced correct wooden-pickaxe timings matching test-driver's own hand-recorded SCOREBOARD.md entries (1m00s for OhneHoseOtto, matching their manual "T+1m00s (13:00:19)" exactly), correctly reported DNF for the unreached tiers with real quoted context lines, and correctly counted steering calls (3 for OhneHoseOtto at the time of testing, matching the setProject re-arm history in their SCOREBOARD notes). `--append-scoreboard` tested in an isolated sandbox copy first (not the live file, since test-driver was actively editing SCOREBOARD.md's manual section for the same in-progress run) — produces a clearly-separated "### Run (auto)" block rather than touching their existing entries. Did NOT append to the real SCOREBOARD.md yet; asked team-lead/test-driver for a good checkpoint (run conclusion/DNF/cap) rather than assuming now.
Also added a defensive check (found worth adding after this session's own KlemmKuno/OhneHoseOtto port collision): if `--port` answers with a DIFFERENT bot's name than requested, the engine-version stamp is dropped with a warning rather than silently attributed to the wrong bot — a control port is a separate localhost namespace from which Minecraft server a bot is on and can be reassigned between runs.
fix: bench/gearrace.mjs (new), telemetry.js (INV_KEYS +diamond_pickaxe).
github: n/a yet — SCOREBOARD.md's Engine Gear-Race section is the tracking surface per team-lead, not a numbered issue.

### 2026-09-02 test-driver — GEAR-RACE both runs went silently idle for 15-20+ min: three distinct causes found, one is a hard dead end
type: bug
status: open
what: Felix caught both bots standing completely still (`wyd both bots are idle`) after I'd been watching agenda `rung` labels cycle (IDLE/RESTOCK/LIGHT) without noticing neither bot's POSITION had changed in 15-20 minutes — a real miss on my part; rung activity is not proof of progress, same family as this file's own "task-state truth" doctrine, just one layer up (ladder-level, not skill-level). Investigating found THREE separate causes stacked on top of each other:
(1) CONFIRMED LIVE, previously only documented as a known gap in GOAL.md: both bots hit the food-item kit gate (`Not setting off half-kitted — I still need: food 0/4`) with full hunger bars but zero food ITEMS carried. This is not hypothetical any more: it silently deadlocked two concurrent, independent driverless runs at the same tier simultaneously, each burning ~15-20 min of a 90-min race budget on it before a human (not the engine) noticed.
**AMENDMENT, same day, team-lead-directed empirical test:** the "huntAnimals' own kit gate also demands food, so a foodless bot can't hunt its way out" half of this claim is WRONG on v50 — GOAL.md's text on this point is stale. Set `huntAnimals` as OhneHoseOtto's project at 13:42:38 specifically to test this rather than trust the doc; it started immediately (`Hunting 2x cow/chicken/pig/sheep. Nothing personal.`, 13:42:39) with no `kit_missing` at all, and failed only on `no cow/chicken/pig/sheep within 32 blocks` (13:42:40) — a target-availability failure, not a gate refusal. **#45 (gate huntAnimals on a weapon, not food) is verified live on v50, not just claimed shipped.** The catch-22 as originally described (foodless -> can't hunt -> can't get food) is CLOSED. What remains open is narrower: a bot with no food AND no huntable/harvestable target in reach (e.g. sealed underground, see (3) below) still has no path to food — but that is now a reachability problem, not a gate problem, and doesn't need the huntAnimals kit gate touched again.
(2) MY OWN DRIVING MISTAKE, but worth flagging as a footgun for future drivers/engine defaults: I set `harvestGrass` as an escape project (not kit-gated) WITHOUT `repeat:true`. `harvestGrass` is not in agenda.js's `resumable()` registry, so per `projectDone()` (agenda.js:739-746), a non-resumable project is marked `completedOnce` — and therefore permanently done, PROJECT rung never fires again — the INSTANT it finishes ONE pass, regardless of yield. My `count:16` arg was silently a no-op cap on that one pass, not a target to iterate toward. Both bots ran the skill once (logged `Looking for grass to cut` -> `Gathering seeds`), then sat in IDLE's drop-sweep filler forever. Re-setting with `repeat:true` immediately fixed this for NacktNorbert (real yield: `Cut 4 grass`, first tangible progress in the whole stall window). Suggests either (a) `resumable()` should cover more skills so `count` actually means something without needing `repeat`, or (b) at minimum the driver docs (DRIVER_GUIDE.md's queue/setProject section) should say explicitly "a skill not in the resumable registry finishes after one pass no matter what `count` you pass — use `repeat:true` for an open-ended goal," since nothing today warns a driver this is happening.
(3) NEW, HARD DEAD END, only affects OhneHoseOtto: it had mined itself to y89 (14 blocks below its own y103 surface spawn) chasing the `mineLane` stone target before hitting the food gate. Once redirected via `repeat:true` harvestGrass, it found ZERO grass in reach at y89 (correctly retried forever rather than falsely completing — (2)'s fix working as intended, just with nothing to find). Tried routing it back to the surface with `come` at two different targets (its exact spawn coords, and straight up from its own x/z) — BOTH failed, the second with `goto resolved 14.02 from the goal (tolerance 4.5)` after only ~1.3s for "2 attempts" with position unchanged to the decimal, meaning the pathfinder found literally zero viable steps in any direction, not a partial/interrupted climb. **There is no listed skill (`./task.sh <port> list`) that ascends or digs a bot out of a sealed pocket — `safeDescend` is one-directional, and nothing else is shaped for "return to the surface."** Plausible root cause (unconfirmed — GET /state and setProject are my only tools, can't `/eval`-inspect further): survival.js's WALL_OFF panic branch explicitly builds a sealed pocket and is documented as not reliably digging back out; if that ever fired for this bot, this could be the wall it's trapped behind. Whether or not that's the exact mechanism, the actionable gap is the same: once a bot is sealed with no path, NOTHING in the skill registry can get it out, and a driver restricted to engine skills (not raw /eval digging) has no recovery move at all. This bot is very likely a permanent DNF for run #1 (official baseline) unless someone with /eval or RCON access frees it.
fix: (1) is engine-dev-3's known item already (GOAL.md), this just adds a second confirmed-live occurrence with full log evidence, worth bumping priority given it just cost 2 concurrent benchmark runs real time. (2) either broaden `resumable()` or add a loud one-time log line the first time a non-repeat, non-resumable project completes under-target ("project completed after one pass; it will NOT be retried without repeat:true"). (3) is the one that needs real engine work: some form of `ascendToSurface`/`digOut` skill (mirror of `safeDescend`, target = nearest open sky or a given y) so a sealed/off-course bot has a legal recovery path that doesn't require driver /eval or RCON intervention — today, one bad dig sequence plus the food gate is a life sentence.
github: not yet filed — recommend filing (3) specifically once someone with /eval access confirms whether this is WALL_OFF-caused or a plain mining dead-end, since the fix differs (fix the panic branch's dig-out step vs. build a new skill).

### 2026-09-02 engine-dev — R2 wedge, 5th attempt: perpendicular flowing water, also inconclusive (weak implementation, not a clean theoretical falsification)
type: finding
status: inconclusive, timeboxed to one attempt per plan — different caveat than the first four
what: engine-dev-3 proposed flowing water as a genuine execution-level trap (unlike the first four, water IS priced as traversable by the search — bots swim through it normally — so a real current strong enough to cancel forward walk speed would be a physical failure the block-graph literally cannot see coming). Built a perpendicular channel (a 9-wide, walled lane crossing a corridor, source line at one edge) on KlemmKuno/3130, well clear of NacktNorbert. LIVE-OBSERVED: the water only spread partway across the lane before dissipating (flow level maxed around 7 by ~7 blocks from the source, per direct registry inspection — never reached the far wall), and the bot crossed the whole lane with zero observable slowdown in 2s polling resolution.
UNLIKE THE FIRST FOUR, this is NOT a clean theoretical falsification — the mechanism (water pushes entities, unmodeled by the search) is still plausible; what's actually unconfirmed is whether MY SPECIFIC construction (channel width, source placement, HAUL profile possibly routing around/through the weakest part) produced a current strong enough to test the theory at all. Timeboxed to one attempt per the plan agreed with engine-dev-3 (they're focusing on the team-lead-assigned fault-injection approach, which is the higher-value path to closing #54 now) — flagging the caveat rather than either claiming a clean negative or spending more time tuning it solo.
fix: n/a. Cleaned up all geometry/forceload tickets, KlemmKuno rescued (healthy, 20 HP).
github: felsenuboot/felcrew-mcp#54 (cross-reference; R2 proof now primarily proceeding via team-lead's re-scoped (a) fault-injection [engine-dev-3] + (b) natural-occurrence-in-field-telemetry [monitored by engine-dev via the M.recovery sink] plan, not further synthetic geometry hunting)

### 2026-09-02 test-driver — SPECIMEN HANDOFF: OhneHoseOtto is a naturally-entombed bot, live and untouched, for digOut/ascendToSurface development
type: project
status: RESOLVED — see engine-dev-3's "digOut CLOSED" entry below for the full fix; Otto is out and free, this entry closes as intended
what: this is the actionable follow-up to my two entries above (the food/hunt-gate catch-22 and its (3) hard-dead-end finding). Team-lead's ruling: the team spent time trying to STAGE a stuck bot synthetically for R2/movement-recovery work and couldn't; GEAR-RACE run #1 produced one NATURALLY, and it should be handed over rather than fixed. Full reproduction facts, so nobody has to re-derive them from the SCOREBOARD narrative:
- **Where**: bot `OhneHoseOtto`, control port 3140, connected to `127.0.0.1:25600` (the dedicated `localserver-race` instance, NOT the shared 25599 world). Position `(2.51, 89, 12.43)` — 14 blocks below its own surface spawn at y103. Engine stack: skills v50 / agenda v19 (pinned at spawn, not upgraded since — see the "do not restart onto a newer engine mid-run" ruling elsewhere in this file's history).
- **How it got there**: driverless `mineLane{target:'stone'}` under agenda control, no manual digging involved — it mined toward a stone target and ended up sealed. I did NOT stage this on purpose; it's an organic outcome of normal engine-driven mining.
- **Symptom**: `come` (the driver-facing goto skill) fails from this position for EVERY target tried, including straight up from the bot's own x/z:
  - `come{x:0,y:103,z:3,range:2}` (its exact original spawn coords) → `failed: come — travel failed after 2 attempts: No path to the goal!`
  - `come{x:2.5,y:103,z:12.4,range:2}` (straight up, same x/z, only y differs by +14) → `failed: come — travel failed after 2 attempts: goto resolved 14.02 from the goal (tolerance 4.5)`, resolving in ~1.3 seconds with the bot's reported position UNCHANGED to the decimal place both before and after. That reads as the pathfinder finding literally zero viable first steps in any direction, not a partial/interrupted climb that ran out of budget.
  - `harvestGrass{radius:24,repeat:true}` correctly finds 0 grass every pass (no false completion) — confirms no reachable open-air/surface block within the search radius either.
  - `huntAnimals{anyMob:true,radius:32}` fails on `no cow/chicken/pig/sheep within 32 blocks` — confirms no reachable fauna either (expected, animals don't spawn underground, but rules out any lingering doubt this is a kit-gate issue rather than a geometry issue).
- **Unconfirmed root cause** (I could not investigate further — my role was `setProject`+`GET /state` only, no `/eval`): survival.js's `WALL_OFF` panic branch explicitly builds a sealed pocket ("seals a 13-face coffin... digs out away from the threat") and is documented elsewhere in this file's history as not reliably completing the dig-out step. If that branch ever fired for this bot, this is very possibly the wall it's trapped behind — but it could equally be a plain mining dead-end (dug forward, filled the tunnel behind itself with something impassable, e.g. gravel/sand collapse, or a `WALL_OFF`-style deliberate seal from `survival.js` combined with backfill/auto-torch placement). Whoever picks this up should be able to distinguish these by reading `status.log`/`survival.snapshot()` via `/eval`, which I don't have.
- **What's needed**: a skill shaped like `safeDescend`'s mirror — target = nearest reachable open sky / a given y, allowed to dig in any direction the current movements profile permits — so a sealed-or-off-course bot has a legal, driver-triggerable recovery path that doesn't require `/eval` or RCON. Today the honest answer to "bot is entombed, what skill do I set?" is "none exist."
fix: n/a from me — this IS the fix target, not a suggestion. Bot is intentionally left running, untouched, as the specimen. Ping test-driver if the process needs anything from the original race context (SCOREBOARD.md "Engine Gear-Race / Run #1" has the full timestamped narrative).
**RESOLVED, 2026-09-02 (engine-dev-3, see their "digOut CLOSED" entry below for the full writeup):**
my WALL_OFF speculation above was WRONG — the real ledger shows zero panic/danger events ever
fired for this bot, survival.js never touched it. The actual cause was `producer.js`'s
cobblestone-mining loop re-centring its search on the bot's current position every iteration with
only a vertical distance bound, no horizontal one — a genuine unbounded random walk that dug the
bot into a sealed dead end over dozens of scans. Fixed (producer v7, origin-anchored search),
`ascendToSurface` built and live-verified, and a new ESCAPE agenda rung now auto-routes a
path-blocked underground project to it going forward — closing the actual gap this handoff asked
for. Otto climbed y=89 to y=102 in ~65s, independently block-scan-verified as real open sky, not
just a task self-report. Good reminder for next time I speculate on a root cause I can't directly
inspect: label it as speculation clearly enough that it gets corrected instead of calcifying —
this one did exactly that.
github: not yet filed — recommend a fresh issue for the `ascendToSurface`/`digOut` skill itself once engine-dev-3 has examined the live specimen, since the earlier entries in this file reference it as a proposal but this is the first time a real reproducible case exists to build/test against.

### 2026-09-02 engine-dev-3 — #54 R2 LIVE PROOF: fault-injection hook fires and resolves for real, both channels agree (skills v54)
type: feature + verification
status: PASSED live, first genuine confirmation this session that isn't bench-only or falsified-and-inconclusive
what: built team-lead's re-scoped fault-injection half of the R2 gate. Design: `gotoR`'s FIRST attempt checks `globalThis.__r2Fault` (armed via /eval before starting a goto-driving skill) and, if armed, throws a synthetic `stuck` immediately instead of waiting out the real ~25-30s watchdog — consumed one-shot before the throw. Everything from that point on is completely real: `ctx._reposition()`'s dead-reckoning walk against the actual world, the re-issued A* against actual terrain, whether it actually arrives. Only the TRIGGER is synthetic.

#38 DOCTRINE drove the design, not an afterthought: the last test hook of this exact shape (survival.js's `drill()`, a `pickOverride` parameter) was silently broken for its entire life — captured but never called — so every historical claim built on it, including #38's own original bug report, was unknowingly exercising unrelated live conditions the whole time. A hook that cannot prove it fired manufactures false confidence, which is strictly worse than no hook. So this one writes `globalThis.__r2FaultProof` as the episode unfolds (fired/reposition/retry, each with a real timestamp and a real outcome), and `bench/fixtures/wedge-r2-fault-inject.sh` refuses to call it proven from either channel alone — it asserts on BOTH the in-process proof object AND the ledger's own `recovery`+`goto` records in the fixture's time window, and requires them to AGREE.

BRING-UP found two bugs, both in the fixture, not the engine — recorded so they don't get rediscovered: (1) the far-from-spawn chunk was never generated, so vanilla `/fill` silently no-op'd and the bot teleported onto unrelated natural terrain (fixed with the exact `forceload add` + `fill_checked` + teleport-wait-teleport-again + explicit Y-settle pattern engine-dev already proved on `wedge-r2-twin-doorway.sh` — reused, not reinvented); (2) the ledger's `seq` field is per-PROCESS-LIFETIME, not globally monotonic across the whole file, so a naive "next goto with seq > recovery's seq" query picked up a STALE record from an earlier bot restart during debugging and produced a false mismatch — fixed by scoping the query to the same `run` id as the matched recovery record.

LIVE RESULT (EngineDreckDave/3150, 127.0.0.1:25599, ~30 blocks real travel): fired on attempt 0 as designed; `ctx._reposition()` ran and genuinely displaced the bot (403.5,80,83.5 -> 404.6,80.5,83.5, real movement, not a stub); the re-issued goto was a genuine 29-block A* search (48 nodes visited, 154 generated, 2 replans, `res:"arrived"`) — not instant, not faked; task `done:true`. The ledger's `recovery` record independently carries `injected:true` (so `metrics.mjs` can always tell a synthetic episode from a natural one — this was a deliberate design requirement, not just a debugging convenience) and the very next `goto` record on the same `run`/`tid` shows `res:"arrived"`, matching channel 1 exactly. Full PASS, first try after the two fixture-bug fixes above.

WHAT THIS PROVES AND WHAT IT DOESN'T, stated plainly per this file's own discipline: this proves R2's RESOLUTION MECHANISM — reposition, then a fresh real A* — works correctly and completes on a live bot when actually invoked. It does NOT prove that a genuinely-organic wedge will trigger it (that's the separate, still-open field half: the first NATURALLY-occurring firing-and-resolution observed in fleet telemetry via the M.recovery sink, unrelated to this fixture). Both halves together are team-lead's deployable-to-cavecrew standard; this closes the first.
fix: skills.js (gotoR's fault-injection branch + proof-writing, skills v54), bench/fixtures/wedge-r2-fault-inject.sh (new).
github: felsenuboot/felcrew-mcp#54 (R2 — fault-injection half PROVEN live; field half still open)

### 2026-09-02 engine-dev — IDLE_TRIGGER_SPEC phase 2: DIRECTION metrics section + fixture skeleton, starting ahead of agenda v21
type: project
status: telemetry.js verified zero-diff; metrics.mjs section built and bug-caught via testing; fixture skeleton mechanically verified against a stub, real assertions blocked on v21
what: team-lead assigned research/IDLE_TRIGGER_SPEC.md's engine-dev lane (telemetry.js verify-only, metrics.mjs, bench/fixtures/agenda-direction.js), starting with the pieces that don't depend on engine-dev-3's agenda v21 landing.
TELEMETRY.JS VERIFICATION (not a code change): confirmed by reading, not assumed, that `M.emit(ev, fields)` is fully generic and already stamps `{v, t, bot, run, seq, ev}` for any event name — `agenda.js`'s own rung-transition `note` already rides this exact path (`m.emit('note', {agenda: target.id, ...})`, agenda.js:965, verified live-current not just per the spec's anchor). A `dirEmit`-driven `ev:'direction'` needs zero telemetry.js changes and SCHEMA_V correctly stays 2 — purely additive, same shape as `recovery`/`pos`/`chest` before it.
METRICS.MJS: new "direction (idle-as-a-number)" section (after ladder coverage, before recovery ladder). Per-bot AND fleet: episodes/hr by why, direction-latency median/p90 (flags a p90>=120s miss against the spec's own target), closedBy shares (promoted% = zero-LLM completions, self_recovered% = deterministic floor working), undirected-time fraction (the headline "Felix's screenshot number"), an open-episode age check that prints an explicit DEAD-CONSUMER alarm past 30min, a promote/gap_ms cross-check (two independent instruments on the same completion-gap fact, per spec §1.1g), and the contradiction alarm (ladder-coverage IDLE share high while direction records are zero — the #38 doctrine applied to this trigger specifically). `--decisions <file>` surfaces the decider's own LLM-calls/hr vs the 30/hr cap once decider.js exists.
VERIFIED, not just written: built synthetic ledgers through the REAL `telemetry.js` `M.emit` path (not hand-typed JSON) covering an open/close pair, a promote+gap_ms pair, and a >30min-old unclosed episode, plus a second synthetic bot with plenty of `note` records but zero `direction` records (the contradiction shape). Found and fixed two real bugs this way, not in review: (1) a `lastSeen` variable computed per-bot inside one loop and referenced out of scope in a later loop — would have thrown on the very first live ledger with an unclosed episode; (2) the contradiction alarm as first written pooled ALL bots' `notes`/`direction` records together, so one already-upgraded bot's records would silently mask a genuinely stale/pre-v21 bot sitting right next to it in the same fleet run — exactly the mixed-version-rollout shape happening on the live fleet at this moment, not a hypothetical. Fixed to check per-bot; re-verified both the single-bot and pooled-fleet cases pass correctly after the fix.
BENCH/FIXTURES/AGENDA-DIRECTION.JS: skeleton for the spec's 10 cases (§4.3), following the established agenda-ladder.js/agenda-idlework.js pattern (direct A.* field injection, save/restore, try/finally, run via /eval against a live bot). Cannot run for real yet — `A._directionCheck` doesn't exist until agenda v21 lands (engine-dev-3's lane). Mechanically verified anyway: wrote a stub agenda matching the spec's own §1.1h/§1.1j pseudocode and ran the real fixture file against it — 6 of 10 cases fully exercise correctly (16/16 sub-assertions pass): the active->done edge (case 1), the E2 120s-window gating including the running-task exemption (case 4), E3a's 180s stall (case 5), E3b's barren-repeat threshold (case 6a), the no_tool independent arm proving projectDone never reads A.blocked (case 7), the dirDispatch stale-eid CAS (case 8), fresh-install grace (case 9), and reopen-backoff-sets-cooldown (case 10a/b).
FOUR CASES HONESTLY LEFT AS PLACEHOLDERS, flagged rather than guessed: cases 2 (staged-next promotion), 3 (repeat never promotes), and 6b (barrenRuns resets on a worked run) all depend on the harvest-block promotion/grading logic (spec §1.1f/§1.1g), which lives OUTSIDE `directionCheck` and isn't reachable through it alone — testing these needs either a second exposed hook or driving a fuller tick()-shaped call, and I don't want to guess at an API surface engine-dev-3 hasn't written yet. Case 10c (backoff actually expiring and a fresh episode reopening) needs a fake clock or real elapsed time, not exercised in a single synchronous run. This is exactly the "agree the exact record shape with eng-3 up front so neither of you rebuilds" coordination team-lead asked for — sent to engine-dev-3 rather than assumed.
fix: metrics.mjs (DIRECTION section), bench/fixtures/agenda-direction.js (new, skeleton).
github: felsenuboot/felcrew-mcp#68 (Direction Episodes / idle-trigger — this spec IS #68 per §5)

### 2026-09-02 engine-dev-3 — ascendToSurface built: the safeDescend mirror, live-verified (skills v55)
type: feature + verification
status: shipped, live-verified — not yet run against the actual OhneHoseOtto specimen (never touched it, per the ruling)
what: picked up test-driver's SPECIMEN HANDOFF. Diagnosed OhneHoseOtto (READ-ONLY /eval only — no rescue, no action, per the ruling): a 5-block-radius block scan came back 120/124 solid (stone + coal_ore), NOT the small deliberately-shaped void a WALL_OFF seal would leave — a plain mining dead-end. Traced straight up from its exact position: 2 blocks of headroom, then 7 solid stone, then 4 dirt, then grass_block, then open air — a clean 12-block column to real open sky, with nothing hazardous (no lava/bedrock/protected) in it. `come`'s failures (`No path to the goal!` and the empty-path false-success case) both make sense now: excavating a brand-new path through solid rock is not a movement `bot.pathfinder.goto`'s graph search generates at all — it only routes through space that already exists, so "the pathfinder found zero viable steps" was literally true and not a bug in `come`.

Built `ascendToSurface` as a direct mirror of `safeDescend` rather than inventing a new mechanism — same 45-degree forward staircase, same tripwires (net-progress abort after 3 stalled steps, gravity-column settle-before-dig, lava hazard scan ahead, honest `stoppedBecause` on `no_tool`/`bedrock`/`stuck`), vertical sign flipped. Deliberately NOT a vertical shaft with pillar-jumping: there is nothing to land on climbing straight up through solid rock without placing blocks (jump velocity alone rises ~1.25 blocks and falls right back), and this codebase's #54 roadmap explicitly keeps placement-dependent self-rescue (R5: "dig-to-goal / pillar-up / bridge-gap") GATED behind `placeBlock` (#19) being hardened, which it is not. The staircase needs zero placement — the block one step ahead at floor level is left solid on purpose and becomes the stair tread, exactly what a real player does mining upward. Stop condition is either a target `toY`, or — the general case — climbing until the column overhead reads clear for 24 blocks straight (the same discipline as `dangerscan.js`'s `columnOpen`: never guess "reached" on an unloaded chunk).

LIVE-VERIFIED, not just written: `bench/fixtures/ascend-staircase.sh` sealed a fresh bot (EngineDreckDave/3150, 25599) inside a REAL 20x20x20 solid stone cube — confirmed genuinely sealed (100% solid neighbour cells) before crediting the skill for anything, matching this file's own "verify the setup, don't trust it" doctrine that's run through this whole session. Climbed y=50 -> y=71 (a pre-built open room above the cube), 21 real staircase steps, 61 blocks actually dug (collected cobblestone/gravel/flint along the way — real digging, not a stub), `stoppedBecause:'reached'`. Full PASS, first clean run.
WHAT THIS DOES NOT COVER: never touched OhneHoseOtto itself — the live fixture stages an equivalent sealed scenario on the sanctioned server instead, per the explicit "do not rescue, do not stop the process" ruling. Whether `ascendToSurface` would actually free that SPECIFIC bot (its geometry, its exact facing direction, whatever hazards might sit along whichever cardinal direction it picks) is untested — the mechanism is proven, the specimen's own resolution is not, by design.
fix: skills.js (`ascendToSurface`, skills v55), `bench/fixtures/ascend-staircase.sh` (new).
github: not yet filed — recommend filing once a decision is made on whether/how to actually apply this to OhneHoseOtto (a driver `setProject`, or leave it as a specimen for someone else's purposes); the skill itself needs no issue to justify shipping it, per team-lead's original handoff framing ("this IS the fix target").

### 2026-09-02 engine-dev — IDLE_TRIGGER_SPEC phase 2, continued: wired into preflight.sh; contradiction alarm confirmed against REAL fleet ledgers, not just synthetic
type: project + finding
status: preflight wiring verified live; contradiction alarm's real-data validation is a genuine field number, not a demo
what: two more phase-2 items, both against real bots rather than synthetic data alone.
PREFLIGHT.SH: added `agenda-direction` to the fixture list. Verified live against EngineDreckDave/3150 (v20, no direction support yet): skips cleanly with the expected reason, total tally unaffected (148/148, same as before the addition) — confirmed the SKIPPED path (already handled generically by preflight.sh's own dispatcher) doesn't break a pre-v21 bot's run. Wired in early rather than waiting for all 10 cases to be real: the moment v21 lands, the 6 already-working cases start running against a live bot with zero extra setup, and the remaining 4 (pending engine-dev-3's promotion hook, previous entry) slot in without touching preflight.sh again.
CONTRADICTION ALARM AGAINST REAL DATA: ran `metrics.mjs` (no synthetic ledger, the actual on-disk fleet history) with no `--bot` filter — every single current bot fired the contradiction (correctly: none of them have v21, so a 100% fire rate across the whole fleet today is the RIGHT answer, not a false-positive scare). This is also the strongest available proof the per-bot fix (previous entry) works on genuine mixed data, not just my synthetic construction of the failure shape. The IDLE shares themselves are worth recording on their own, independent of the alarm mechanism — this is "Felix's screenshot number" measured today, before any fix exists: BuddelBernd 60.8%, DiggyAshHole 28.7% (correctly NOT alarmed — under the 50% threshold, the negative control), EngineDreckDave 91.7%, FurzFriedrich 65.1%, KloputzKarl 81.2%, LokalLothar 55.7%, **MettMarcel 93.2%** (885+ real rung-transition samples across these bots, not a handful), PflasterPeter 68.1%, SchrottSepp 70.6%, SoloSauhund 58.8%, WedgeTest 69.5%. Whatever the fleet's undirected-time fraction turns out to be once v21's own metric is live, ladder-coverage's IDLE share (a different, coarser proxy measuring the SAME underlying problem) already puts most of the current fleet in the 55-93% range — the spec is not solving a marginal issue.
fix: bench/preflight.sh (fixture list).
github: felsenuboot/felcrew-mcp#68

### 2026-09-02 engine-dev-3 — digOut CLOSED: pocket-formation forensics (#91), ESCAPE rung wired (#89), Otto walked out of his own tomb live
type: feature + bug + verification
status: SHIPPED and LIVE-VERIFIED on the actual specimen — the acceptance criterion is met, not simulated
what: completed the three remaining halves of the digOut assignment (skill itself already landed and live-verified last entry).

**1. Pocket-formation forensics, both of test-driver's hypotheses ruled OUT by the actual ledger.** Neither WALL_OFF nor mineLane caused this. Grepped OhneHoseOtto's whole `metrics-OhneHoseOtto.jsonl`: zero `panic`/`danger` events with a non-calm state, ever — survival.js's WALL_OFF branch never fired for this bot, full stop. Every `mineLane` `task_end` from the moment it reached the eventual sealed area is `kit_missing` — mineLane never once actually ran there either. What DID move the bot through increasingly deep positions, confirmed via real `task_end` records with genuine `moved` distances, was `produce('cobblestone', ...)`. Read `producer.js`'s `mineProduct`: its scan loop re-centres `findBlocks` on the bot's CURRENT position on every one of up to 60 iterations, with only a VERTICAL bound (`MAX_MINE_BELOW`) — nothing bounds how far the whole multi-scan pass can wander chasing "nearest unmined stone" horizontally. That is a genuine unbounded random walk, and it is what dug this bot into a fully-enclosed dead end (independently confirmed by the read-only block scan in the prior entry: 120/124 solid neighbours, no lava/bedrock/protected in the escape column — a plain mining dead-end, not a deliberate seal, exactly matching the mechanism, not either guessed cause).
**Fix (producer v7):** anchor `mineProduct`'s search to where the CALL started (same `MINE_RADIUS`, now measured from a fixed origin instead of a sliding per-iteration window) — a mining pass now explores a bounded area and reports an honest partial when nothing remains within it, instead of marching progressively further with every scan. This is the "creator needs a guarantee, not just a rescuer" half team-lead asked for.

**2. ESCAPE rung wired (agenda v21) — the minimal deterministic hook.** New rung between PROJECT (prio 8) and IDLE (prio 9): fires when `A.project.blocked` is a path/reachability-class code (`no_path`/`unreachable`/`stuck` — PROJECT's own act() already sets this after 3 failed attempts) while `s.surfaceExposed` is false; starts `ascendToSurface`; clears once the surface is reached. Deliberately does NOT retry or clear the blocked project afterward — reaching the surface makes the bot SAFE, which is the point; what happens to the original project is a driver decision (or soon, Direction Episodes'), not guessed at here. Verified with a standalone harness before touching the tree (8 cases: fires only on path-class codes while underground, stays quiet on `kit_missing`/on the surface, starts the right skill, clears correctly), then live: 156/156 preflight (`bench/fixtures/agenda-escape.js`, new).

**3. Otto walked out of his own tomb, live, for real.** Reconnected OhneHoseOtto (port 3140, server 25600 — the DNF was already recorded, so this no longer taints any pending race measurement) to pick up skills v55/agenda v21/producer v7 via `bot.quit('redeploy: ...')` — runner.js's own auto-reconnect re-ran `applyPayloadStack` from disk, no process restart needed. `__agenda.setProject({skill:'ascendToSurface', args:{}})`. Watched it climb in real time via polling: y=89 -> 91 -> 94 -> 96 -> 99 -> 102, `phase:'ascending'` throughout, genuine cobblestone collected along the way (real digging, not a stub). Completed in ~65s. **Verified independently, not trusted from the task's own report**: a direct block scan straight up from the bot's final position shows 21 clean air blocks with nothing solid — real open sky, not a small room. `project.completedOnce:true`, health 20/19, fully safe. The bot that `come` could not move an inch from, in any direction, for the rest of its life, is now standing on the surface.
fix: producer.js (`mineProduct` origin-anchored search, v7), agenda.js (ESCAPE rung, v21), `bench/fixtures/agenda-escape.js` (new). Otto itself: reconnected + `setProject`, no code change needed on the specimen beyond the engine already being fixed.
github: felsenuboot/felcrew-mcp#89 (digOut — CLOSED, acceptance criterion met live), new issue recommended for the producer.js unbounded-wander class if it isn't filed as #91 already by the time this lands (cross-check issue-manager)

### 2026-09-02 engine-dev — bench/fixtures/agenda-direction.js: all 10 spec cases real and passing live (25/25), the one cold failure was my own fixture's bug
type: project
status: COMPLETE — 25/25 sub-assertions pass live against agenda v22, wired into preflight.sh, fleet-wide 181/181
what: engine-dev-3 landed Direction Episodes Phase 1 (agenda v22 — v21 went to the ESCAPE rung first, see prior entries) and ran my fixture skeleton cold against the real code: 19/20 passed on the first try, a strong result for a fixture written entirely against spec text with no real code to check against. The one failure (case 10b) was diagnosed by engine-dev-3, not guessed at by me: case 8's `dirDispatch('chopTrees', ...)` call runs through the REAL `A.setProject`, which sets `A.project` to a genuine object — case 10's own sequencing never reset it back to `null` before re-testing the `unproductive_idle` reopen path, so the next `directionCheck` call evaluated the E3a (`project_stalled`) branch instead, against a "project" sitting quiet for 200s that could never actually happen in real operation (a dispatched `collectDrops` finishes within a tick or two). Fixed by resetting `A.project = null` after every dispatch in case 10, matching the same pattern case 8 already needed.
CASES 2/3/6b, previously honest placeholders, now real: `A._promoteCheck(p, nextProject)` landed exactly as engine-dev-3 said it would — a pure predicate (`Boolean(p && !p.repeat && nextProject)`), the SAME function the real promotion call site uses (agenda.js's harvest block, `if (A._promoteCheck(p, A.nextProject)) {...}`), so testing the predicate directly carries no drift risk from what actually runs. The harvest block's full promotion SIDE EFFECTS (hygiene-field clearing, the `dirEmit('promote')`, the real `A.setProject` call) are inline at that call site rather than a separately-callable function — deliberately NOT re-tested here, since engine-dev-3's own live §4.3 acceptance test already covers exactly that path end-to-end (a real finished task through a real tick, asserting one `op:'promote'` plus `gap_ms<=2500`); duplicating it in a snapshot-injection fixture would test nothing the live test doesn't already prove more strongly. Case 6b (barrenRuns reset) is similarly inline, keyed off `A._idleWorkOutcome`'s classification (already-exposed, per `agenda-idlework.js`'s established pattern) — tested via that classifier plus `directionCheck`'s own response to the post-reset state, exactly as engine-dev-3 suggested rather than adding a third hook.
CASE 10 ALSO STRENGTHENED past the original placeholder's scope: rather than settling for "backoff exists," it now proves genuine escalation (two consecutive closes of the same `why` produce a strictly-later `reopenAt` deadline, verified by controlling `check()`'s `now` parameter directly — no real waiting needed, since `openEpisode`'s cooldown comparison is a plain timestamp compare) AND genuine reset (a markProductive-equivalent state change brings the THIRD close back to `reopenCount:1`, not a further-escalated value, proving the reset actually clears the counter rather than the assertion merely reading stale data past its old deadline).
fix: bench/fixtures/agenda-direction.js (all 10 cases real; header updated to reflect completion).
github: felsenuboot/felcrew-mcp#68 (Direction Episodes trigger half — fixture acceptance criterion (§4.3, phase 2) now fully met)

### 2026-09-02 engine-dev-3 — Direction Episodes Phase 1 SHIPPED: agenda v22 built and live-verified against §4.3's own acceptance test
type: feature + verification
status: Phase 1 (agenda.js + runner.js, my lane) complete; live-verified on a real bot, not just the standalone harness; 181/181 preflight with engine-dev's completed fixture
what: implemented `research/IDLE_TRIGGER_SPEC.md` sections 1.1(a) through (l) plus 1.3, against the spec's own must_fix resolutions (§8) rather than relitigating any of them. `A.direction`/`A.nextProject` state, `dirEmit` through the SAME proven-live `M.emit` path `note()` already uses (not a new optional-guarded sink — the #38/#54-R2 lesson applied from the start, not rediscovered), `markProductive` wired into all seven outcome-graded stamp sites named in §1.1d (including the two genuinely NEW ones: repeat-project yield grading and an `ensureTool`-finished check that didn't exist before), `openEpisode`/`closeEpisode` with escalating per-`why` reopen backoff that DEFERS rather than silently suppresses (a bot in cooldown shows `state:'cooldown'` on /state — the ledger and /state can never disagree about an open episode), the zero-gap promotion logic (with the re-arbitration hygiene copied verbatim from `bots-llm/planner.js`'s `advance()`, exactly as specified), the central `directionCheck` composite-level detector exposed as `A._directionCheck`, `setProject`/`dirDispatch`'s eid compare-and-set (a stale dispatch is a clean no-op in every mode, not just the decider's), and the snapshot/`/state` extensions.

ONE BUG CAUGHT DURING MY OWN IMPLEMENTATION, worth recording as a process note: attempted to extract the ~130-line harvest block into its own named function (`harvestTask`) for cleaner testability, made a transcription error mid-edit that silently deleted two load-bearing declarations (`const p = A.project;` and `const ours = ...`) while leaving code that referenced them, and introduced a duplicate, wrongly-placed `directionCheck`/`choose` call sequence in the process. Caught it immediately via `git diff` before it ever reached a syntax check, let alone a live bot — restored the original inline structure exactly and abandoned the extraction. The lesson generalizes past this one mistake: a large in-place code-motion edit via string-replace tooling is exactly the kind of change that benefits from reading the diff back before trusting it succeeded, especially under the time pressure of a long session. Landed a much smaller, lower-risk win instead for engine-dev's fixture need: `A._promoteCheck(p, nextProject)`, a pure extraction of JUST the promotion condition, with the REAL promotion site calling the identical function (no drift risk between what a fixture verifies and what actually runs).

LIVE-VERIFIED, both halves of §4.3's own acceptance test, on EngineDreckDave/3150 (25599) — not simulated:
1. **project_done edge + dispatch.** Set a real `chopTrees` project, let it run and genuinely verify-complete (gave the bot torches/food/an axe via RCON first — the point was testing Direction Episodes, not re-proving kit bootstrapping this session already proved extensively). All THREE proof-of-firing surfaces confirmed AT ONCE, independently: `grep AGENDA_EVENT` in the bot's own log showed the stdout marker; `/state`'s `agenda.direction.why` read `'project_done'`; the ledger carried the matching `op:'open'` record. Dispatched via `dirDispatch`; the paired `close` record shows a real, positive `latency_ms` (26780ms, my own actual response time in this manual test).
2. **Staged-next promotion.** Set a fresh `chopTrees` project WITH `next:{skill:'harvestGrass',...}` staged from the start. When `chopTrees` verified done, the ladder promoted immediately — `direction.opened` stayed at its prior count (NO new episode), only `promoted` incremented — with exactly one `op:'promote'` ledger record (`from:'chopTrees', to:'harvestGrass', queuedForMs:58658`). The independent cross-check the spec calls for: the very next `task_start` (harvestGrass) carries its own real `gap_ms:1023` — two separately-computed instruments agreeing the completion→start gap was near-zero, both comfortably under the spec's 2500ms target.

Noted, not chased: running a stateful fixture (one that manipulates `A.direction`/timestamps directly, like `agenda-direction.js`'s backoff cases) via /eval against a LIVE bot leaves a few odd negative-`latency_ms` ledger records from the fixture's own synthetic past timestamps interacting with the bot's real, concurrently-running `tick()`. Harmless (isolated to those specific records, doesn't affect the acceptance test's own clean sequence above) but worth knowing: a fixture that injects fabricated history is not fully isolated from a live-ticking process the way a pure dry-run rung `.act()` call is.

Coordinated the one fixture case that needed adjustment (10b) directly with engine-dev rather than guessing at their file — they landed the fix same-session (3f4ae59), all 10 (now 25, expanded) cases pass, wired into preflight: **181/181 green**.

ONE OPEN DESIGN QUESTION, flagged rather than resolved silently per this session's own standing rule: the spec says clearing a project (`setProject(null)`) also clears `A.nextProject`, but says nothing about a NORMAL `setProject(newSpec)` call with no `next` field — should that also drop a stale previously-staged next, or leave it (my implementation, matching the letter of the spec)? A manual/driver `setProject` with no `next` is common (test-driver's own usage pattern throughout the OhneHoseOtto incident), so a stale next surviving an unrelated manual override is a real, if narrow, scenario worth a deliberate call rather than an implied one.
fix: agenda.js (v22, the full Direction Episodes implementation), runner.js (`/state` extension). Phase 3 (decider.js + DRIVER_GUIDE.md paragraph, my lane) is next, sequenced after Phase 2's gates per the spec's own phasing — Phase 2 (engine-dev's metrics/fixture work) is itself already complete per their entries above.
github: felsenuboot/felcrew-mcp#68 (Phase 1 CLOSED — live acceptance test passed; Phase 3 not yet started)

### 2026-09-02 team-lead — doctrine worth institutionalizing: engine-dev-3 diagnosed engine-dev's OWN fixture bug instead of just reporting the failure
type: doctrine
status: noted for the record, per team-lead's explicit request
what: when bench/fixtures/agenda-direction.js's cold run against real agenda v22 came back 19/20, engine-dev-3 did not stop at "case 10b failed" — they traced the actual mechanism (case 8's `dirDispatch` sets a real `A.project` via the real `setProject`, which case 10 never reset before re-testing a different code path) and handed back a precise diagnosis plus the exact fix, in the SAME message reporting the failure. This is cross-lane review in the direction the codebase doesn't usually get it: the author of the ENGINE (agenda.js) reading and fixing a bug in the author of the FIXTURE's (metrics/telemetry lane) own test code, rather than just throwing the failing case back over the wall as "your fixture is broken, good luck." The reverse direction (a QA/fixture author finding a bug in engine code) is this file's whole normal operating mode; the fact that it ALSO ran in reverse here, cheaply, in the course of ordinary landing work, is the thing worth keeping. Compare the#38/#54-R2 doctrine (verify the sink exists, not just that the emit compiles) — this is the same "don't stop at the symptom" instinct, applied to test infrastructure instead of production code.
Worth carrying forward as a standing habit rather than a one-off nicety: whoever lands code against someone else's fixture and finds a failure is well-positioned to diagnose it (they have the freshest mental model of what just changed) and cheaper-positioned than making the fixture's author reproduce it cold. Doesn't replace the fixture author owning their own file — engine-dev-3 explicitly left the actual edit to engine-dev ("your call since it's your file") — just changes who does the diagnostic legwork when the two are in the same conversation anyway.
fix: n/a — doctrine note, per team-lead's request to institutionalize the pattern.
github: felsenuboot/felcrew-mcp#68

### 2026-09-02 engine-dev — Phase 3/4 prep: decider metrics section + --direction-gate soak grader, built ahead of decider.js
type: project
status: both built and verified against synthetic data; ready for the real soak whenever it happens
what: team-lead's forward assignment for Phase 3/4 (decider.js lands, engine-dev grades the soaks — grader/graded separation kept deliberate) — prepped both pieces now rather than waiting idle, per the spec.
DECIDER SECTION: promoted decisions.jsonl reporting out of a small nested block inside DIRECTION into its own top-level "decider (LLM economics, #68)" metrics.mjs section — decisions.jsonl is decider.js's own single shared fleet-wide file (one daemon, not per-bot), so this reads independently of `--bot`/`--since` and isn't gated on direction records existing. Reports rule-hit vs LLM-miss share (Wilson-interval, same `rate()` discipline as the rest of the file), LLM calls/hr against the spec's 30/hr cap with an explicit OVER-CAP alarm, `skipped_cap` count (framed as the cap correctly working, not a failure), and — the piece that makes #68's own economic argument checkable rather than asserted — rule-of-twice candidates: `(key, decision)` pairs the LLM answered identically 2+ times, which is the spec's own definition of what should graduate into rules.json.
`--direction-gate <label>`: a mechanical, file-frozen PASS/FAIL verdict (`bench/gates/direction-<label>.json`) matching the existing `--gate` pattern, encoding §6 Phase 3's five criteria exactly: zero open-unclosed episodes, latency p50<=60s / p90<120s, LLM calls/hr under cap, decisions.jsonl populated, and #52 tripwire attribution (decider `dirDispatch` calls identifiable in `interventions`, reconciled against `closedBy:'decider'` counts).
CAUGHT WHILE TESTING, not in review: naively extrapolating LLM calls/hr from a short observed window is statistically meaningless — 2 decisions 30 (synthetic) seconds apart reads as "240 calls/hr" and would false-FAIL a genuinely healthy soak. Same `MIN_N` instinct this file already applies to sample counts (`rate()`'s suppression), applied here to a time window instead: the gate now requires >=10 minutes of observed decisions.jsonl span before judging the cap criterion at all, and says so explicitly ("too short to judge honestly") rather than either lying with a noisy number or silently passing. A genuine 60-minute soak clears this trivially; the guard only matters for grading a short or early slice.
Verified both against synthetic ledgers/decisions.jsonl built through the real `telemetry.js` `M.emit` path: a clean pass (2 decider-closed episodes, matching intervention records, healthy latencies), an unclosed-episode fail, and the short-window false-cap-fail (caught, then fixed).
fix: metrics.mjs (decider section promoted to top-level, `--direction-gate` added).
github: felsenuboot/felcrew-mcp#68 (Phase 3/4 measurement tooling ready ahead of decider.js's soak)

### 2026-09-02 engine-dev-3 — Direction Episodes Phase 3 SHIPPED: decider.js daemon, live-verified except the actual Haiku call
type: feature + verification
status: built and live-verified end-to-end EXCEPT the external API call (no ANTHROPIC_API_KEY in this environment — reported honestly, not glossed over)
what: built `decider.js` per §1.6/§3b — the ONE shared fleet-wide decision daemon, standalone (graybridge.js's own pid-file-guard/`setsid nohup` pattern, never a payload). Discovers bots via `pids/*.port`+`*.meta`, polls every 20s, and per bot: skips unless `agenda.direction.state==='needs_direction'` (Phase 1's own field, landed the same session); applies CONDITIONAL driver grace (an owned bot's driver gets 60s before the decider answers for it; an unowned bot gets none); dedups `(bot,eid)` against `decider-state.json` so a decider restart can't re-answer an already-handled episode; checks `rules.json` first (key = `why|role|lastError|barrenBucket`) for a zero-token hit; on a miss, applies BOTH persisted rate gates (per-bot ≥120s, fleet ≤30/hr — a restart can't reset either ceiling) before spending anything, builds context including the bot's REAL live skill registry (fetched fresh via `/eval`, so the LLM is never working from a stale or guessed list), makes exactly one `claude-haiku-4-5` call, and VALIDATES the returned skill (and `next.skill`) against that same registry — discarding rather than dispatching a name the engine doesn't actually have. Dispatches through `dirDispatch`, never raw `setProject`, so a driver who answered first is a harmless no-op rather than a clobber. Every outcome — rule hit, LLM decision, rate-cap skip — is appended to `decisions.jsonl`, the rule-of-twice input for future promotion into `rules.json`.

HONEST BOUNDARY, stated plainly rather than assumed away: this environment has no `ANTHROPIC_API_KEY`, so the actual external Haiku call has never fired for real — `askHaiku` correctly detects the missing key, logs a clear warning, and returns null (graceful degradation, matching the spec's own "decider down" doctrine generalized one level: a *component* of the decider being unavailable degrades the same way the whole daemon being down does — rule hits keep working, misses just don't get answered until the key exists). Verified everything ELSE end-to-end, live, not synthetically: staged a real `needs_direction` episode on `EngineDreckDave/3150` (directly setting `A.direction.episode`/`state` via `/eval`, matching the shape a genuine `directionCheck` edge would produce), seeded a matching rule in `rules.json`, ran the actual daemon for a real 20s poll cycle. It discovered the bot, matched the rule (zero tokens), dispatched via `dirDispatch`, and the bot's own `/state` confirmed the episode closed — cross-checked independently against `decisions.jsonl`'s own record (`src:'rule'`, `dispatchOk:true`) and `decider-state.json`'s persisted dedup entry. Re-ran the daemon a second time: silent on the already-handled eid (dedup survives a process restart, exactly as designed) AND silent on a second, genuinely NEW episode that had opened naturally on the same bot in the meantime — because that bot is OWNED (per its own `pids/*.meta`) and the new episode was still inside its 60s driver-grace window. Both silences are the CORRECT behaviour, not the daemon failing to notice.

Also: `rules.json` reset to genuinely empty and `decider-state.json`/test artifacts cleaned up before committing (the latter added to `.gitignore` — pure runtime state, same class as `logs/`/`pids/`, already excluded). `DRIVER_GUIDE.md` gains the spec's own paragraph (wake on `AGENDA_EVENT` or `/state`, dispatch via `dirDispatch` with `next` staged, ~60s before the decider answers, plus the standing `resumable()`/`count` footgun warning from the gear-race incident).

NOT DONE, and cannot be done inside this session regardless of effort: Phase 3's own acceptance gate is a 60-MINUTE driverless soak with the real LLM path actually exercised — that duration doesn't fit in one session's turn, and exercising the real Haiku call needs a real API key this environment doesn't have. Both are reported as open work, not claimed complete. Engine-dev's `metrics.mjs --direction-gate` tooling (their entry above, landed the same session) is ready and waiting for that soak's `decisions.jsonl`/ledger the moment both preconditions are met.
fix: decider.js (new), rules.json (new, empty), `.gitignore` (+`decider-state.json`), DRIVER_GUIDE.md (new section).
github: felsenuboot/felcrew-mcp#68 (Phase 3 mechanism SHIPPED and verified short of the live-LLM soak — the spec's own phased plan (§6) is now fully built across all four phases; only the soak itself and an API key remain to formally close the acceptance gate)

### 2026-09-02 team-lead (ruling, applied by engine-dev-3) — setProject drops a stale staged nextProject by default; `keepNext:true` is the opt-in
type: correction
status: shipped (agenda v23, commit 2a12633), spec amended (`research/IDLE_TRIGGER_SPEC.md` §1.1i), fixture case 11 added
what: closes the one open design question flagged when Direction Episodes Phase 1 landed — should a plain `setProject(newSpec)` call with no `next` field also clear a stale `A.nextProject` left over from an earlier decision, or leave it? RULING: it clears, by default. Reasoning worth keeping on record because it generalizes: `setProject` expresses FRESH intent, and a `next` staged for a PREVIOUS decision silently promoting after an UNRELATED new project completes is a ghost-decision footgun — a driver redirects the bot, the old plan resurrects itself later, the bot veers off, and nobody watching would trace it quickly (the promotion is silent and zero-token BY DESIGN, which is exactly what makes a stale one dangerous rather than merely wasteful). `spec.keepNext: true` is the documented, explicit escape hatch for the rare case that genuinely wants an old plan to survive — never the implicit default.
Verified with a standalone harness before touching the tree (a staged next is dropped by a plain re-set; an explicit clear still wipes both; `keepNext:true` preserves it), then live via a new case 11 in `bench/fixtures/agenda-direction.js` (engine-dev's file — added directly since team-lead directed the fixture case at me and it's small/well-specified; flagged to them). 185/185 preflight (29/29 in the direction fixture).
DOCTRINE, restated because this is the second time this exact shape has surfaced this session (the first was #85's silently-ungraded ASSERTS entry, a different mechanism with the same root property): **a mechanism that acts silently and at zero cost is the one that most needs an explicit, deliberate policy for its edge cases — the very quality that makes it good (no noise, no token spend) is what makes a wrong default invisible until something has already gone sideways.**
fix: agenda.js (`A.setProject`, v23), `research/IDLE_TRIGGER_SPEC.md` (§1.1i amended), `bench/fixtures/agenda-direction.js` (case 11, new).
github: felsenuboot/felcrew-mcp#68

### 2026-09-02 team-lead (doctrine, from #91's forensics) — every iterative search needs an anchor, or it becomes an unbounded walk
type: doctrine
status: recorded — the class, not a new fix (the specific instance is #91, already shipped)
what: naming the general shape behind #91 (producer.js's `mineProduct` re-centring its ore search on the bot's CURRENT position every one of up to 60 iterations, with only a VERTICAL bound — the horizontal search had none, and that is what dug OhneHoseOtto into its own sealed dead end, one re-centred search at a time). The specific fix (anchor the search to where the call STARTED, not to wherever the bot has wandered to by iteration N) is already shipped; the reusable lesson is the general form: **any loop that repeatedly re-derives "the nearest candidate" from the searcher's OWN current, moving position — rather than from a fixed reference point set once at the start — has no way to know it has drifted, because each individual step looks locally reasonable.** A bound on ONE axis (here, vertical) is not a bound on the search; every axis a real search can wander along needs its own anchor or its own cap, named explicitly, not inferred from a bound on a different axis. Worth checking the same shape against any other multi-iteration `findBlocks`-then-travel loop in this codebase before it produces a second specimen the hard way.
fix: n/a — see #91 (producer v7) for the shipped instance.
github: felsenuboot/felcrew-mcp#91 (cross-reference)

### 2026-09-02 engine-dev-3 — Doctrine sweep completed: chopTrees + harvestGrass shared the #91 shape, both fixed
type: fix (sweep, following the #91 doctrine entry directly above)
status: shipped (skills.js v56, farmskills.js v4, commit 8af1e75); 185/185 preflight on EngineDreckDave/3150 post-redeploy
what: swept every `findBlocks`-in-a-loop call site in skills.js/producer.js/farmskills.js/basekeeping.js against the anchor doctrine above, before it produced a second specimen the hard way. Findings:
- `chopTrees` (skills.js): VULNERABLE, same shape as #91's `mineProduct` — re-centres on the bot's current position every iteration of up to `count` (<=16) tree-fells, nearest-first, no anchor tying it back to where the call started. Smaller in practice (fewer iterations, denser typical targets) but not a different shape. Fixed: capture `origin = bot.entity.position.clone()` before the loop, filter hits to `distanceTo(origin) <= maxDist`.
- `harvestGrass` (farmskills.js): VULNERABLE, identical shape and identical fix. Matters most for `repeat:true` harvestGrass projects (its own IDLE role-work use, and Direction Episodes' repeat-project grading), which can run the outer loop across many invocations over a long stretch of wall-clock time.
- `producer.js` `gatherLogs`, `skills.js` `craftToolChain` wood-gather: safe — single scan then fixed-batch iteration over the results already in hand, not a per-iteration re-scan from a moving position.
- `mineLane`'s `scan()` (skills.js): deliberately left UNCHANGED, not an oversight. Lane progression along the mining axis is the entire point of the skill, it already has its own rescan/probe-count caps, and a prior FEEDBACK finding already settled "anchor not needed here" from live evidence — different design intent from the "wander back toward a stale reference point" failure #91 named.
fix: skills.js (`chopTrees`, ENGINE_VERSION 55->56), farmskills.js (`harvestGrass`, version 3->4).
github: felsenuboot/felcrew-mcp#91 (sweep closes the doctrine's own follow-up ask)

### 2026-09-02 engine-dev — R2's FIRST NATURAL field firing, caught by the monitor: closes the open gate, but the honest number is 1/10, not "it works"
type: finding
status: the field half of #54's proof is closed — genuinely, not optimistically. The result is real and it is NOT a clean win.
what: the background monitor armed all session (watching every bot ledger for a `recovery` event with no `injected` flag) fired for real on FrischFriedhelm (test-driver's gear-race run #2, port 3141, 127.0.0.1:25600) — ten `recovery` records, all confirmed genuinely natural (no `injected` key present at all, not `injected:false`; every prior firing this session was engine-dev-3's fault-injection test and always carried `injected:true`). Reconstructed the full timeline from the raw ledger (goto/wedge/recovery/task_start/task_end together, not just the recovery events in isolation) rather than reporting the headline number alone.
WHAT ACTUALLY HAPPENED: `come` was trying to reach a target ~60+ blocks away with a real elevation change (from y~96-101 up to y115). Every attempt from the vicinity of (-3,96,5)/(2,101,2) went genuinely FROZEN (three `_unstick` escalations, `why=frozen`, matching #53's real trigger path) before throwing `stuck` and handing off to R2. R2 fired NINE times with `_reposition()` reporting `displaced:false` — the dead-reckoning search could not find anywhere to actually move the bot from that spot — and every one of those nine retries also ended `stuck` or `path_timeout`, moving 0-1.3 blocks each time. The bot cycled FROZEN -> stuck -> R2(no displacement) -> FROZEN again for **552 seconds (~9.2 minutes)** before the TENTH firing finally got `displaced:true` (a real 2-block shift, (2,101,2) -> (4,100,2)) — and that one fresh A* from the new cell found a completely clean 64.3-block route straight to the goal, `res:"arrived"`, on the first try.
THIS IS THE CLEANEST POSSIBLE CONFIRMATION of eng-2's #54-review prediction, but pointing the OPPOSITE direction from how it's usually been paraphrased this session: eng-2 predicted "the re-issued A* is where the wins come from, not the reposition" and asked to check whether resolutions cluster where `displaced` is false. Here they cluster overwhelmingly at `displaced:true` instead — every `displaced:false` retry failed, the one `displaced:true` retry succeeded. Read together with the mechanism (a fresh A* run from the IDENTICAL position as the failed one has no reason to find a different answer — the terrain hasn't changed), this actually argues displacement is NECESSARY for the re-plan to have a chance, not incidental to it. Both readings (eng-2's original and this one) point at the same actionable question: **why did `_reposition`'s 8-candidate search return "nowhere to go" nine times in a row at this location?** That's the real open question this data raises, not "does R2 work" — worth engine-dev-3 or whoever owns `_reposition` looking at what geometry near (2,101,2)/y=96-101 defeats all 8 offset candidates (open sky at that y range is a plausible culprit — a dead-reckoning ground search may have nothing solid within its candidate radius near a cliff edge or ledge; unconfirmed, flagging rather than guessing, and deliberately NOT queried live since FrischFriedhelm is test-driver's ACTIVE, MEASURED gear-race run right now — an /eval diagnostic query would contaminate their steering-call count exactly like #52 the tripwire is built to catch).
THE HONEST HEADLINE NUMBER, from `metrics.mjs`'s own recovery-ladder section run against this real ledger: **R2 fired 10 times, resolved (arrived) once.** A 10% natural per-firing resolution rate is not "R2 works" — it is "R2 eventually works, at real cost (9+ minutes of wall-clock churn), when displacement keeps failing." The gate this session has been chasing — "does R2 ever resolve a genuine field wedge, not just a fault-injected one" — is answered YES, for the first time, with primary evidence. Whether R2 as currently tuned is GOOD ENOUGH is a separate, still-open question this same data now makes measurable rather than assumed either way.
fix: n/a — finding, not a code change. Diagnostic follow-up (why does `_reposition` fail to displace at this geometry) recommended, not attempted live to avoid contaminating an active measured run.
github: felsenuboot/felcrew-mcp#54 (R2 — BOTH gate halves now have live evidence: engine-dev-3's fault-injection proof + this natural firing. Recommend keeping #54 open pending the `_reposition` displacement-failure follow-up rather than closing on "proven" — the mechanism works, the current hit rate at hard geometry does not yet look like it should ship silently)

### 2026-09-02 engine-dev — STAKED: the wild wedge's exact geometry, pulled from the ledger, contamination-free
type: project (asset preservation)
status: coordinates recorded now; live diagnosis queued behind run #2 concluding + world-race2 being archived (team-lead's ruling — see below)
what: team-lead's call, and it's the right one: the team spent all day failing to build a synthetic wedge that actually traps R2, and nature just handed us a real one with a ~90% reposition-failure rate at a SPECIFIC, findable location. That geometry is worth preserving as a first-class asset, not just a number in a table. Pulled every coordinate from the ledger directly (pure read — `logs/metrics-FrischFriedhelm.jsonl`, no bot contact, no interference with the still-active gear-race run), cross-referenced goto and recovery records against each other rather than trusting either alone.
**World**: `/home/felix/minecraft/localserver-race` (port 25600, rcon 25601), level-name **`world-race2`** (confirmed directly from `server.properties`; the world directory itself — `localserver-race/world-race2/` — physically exists alongside `world-race` from run #1, both on disk right now).
**The target the bot was trying to reach** (constant across every one of the 18 goto attempts in this episode): **(-55, 115, -17)**. Route class `MEDIUM_ASCENT`, profile `HAUL` throughout — the long-haul profile (25s thinkTimeout, unlimited search radius), not a short-hop one, so this isn't an artifact of a stingy search budget.
**Wedge point A** (2 firings, the episode's opening stretch): **(-3, 96, 5)**. The bot made some progress from here (later goto attempts show it having moved on) before wedging harder at point B.
**Wedge point B, the real prize** (8 of the 10 recovery firings, all `displaced:false`, all retries `stuck`/`path_timeout`): **(2, 101, 2)**. This is where `_reposition`'s 8-candidate search failed nine times running (the 9th failure at this exact point was actually the SAME position repeated after a `path_timeout` retry cycle — see the full timeline in the entry above). y=101 is worth noting on its own: high enough that open sky / a ledge or bowl-rim is a live hypothesis, not confirmed.
**The one cell that finally worked**: **(4, 100, 2)** — reached by the 10th `_reposition()` call, the only one that reported `displaced:true`. That's +2 in X, -1 in Y from wedge point B: a SMALL, subtle move (well within the documented 8-candidate offset list's own dx/dz=2 range), and it was enough to unstick a search that had failed 8 times from one block over. Whatever is special about (2,101,2) does not extend to (4,100,2) two blocks away — the trap looks local, not regional.
**PLAN, per team-lead's ruling**: (1) this entry — done, contamination-free, while run #2 is still live. (2) Once run #2 concludes, world-race2 gets ARCHIVED (not deleted — team-lead is confirming this with test-driver as an update to the fresh-world-per-run law specifically for wedge-bearing worlds). (3) Only then: take a dedicated test bot to these exact coordinates on that archived world and answer the real open question — is (2,101,2) a genuine geometry trap (bowl rim, overhang, a ledge that leaves nothing standable within the 8-candidate search radius), a bug in candidate GENERATION (the offset list not covering the actual escape direction), or a bug in candidate VALIDATION (a real standable cell exists but `_reposition`'s solid-floor/two-air/not-protected check wrongly rejects it)? The answer decides whether R2 needs smarter candidates (engine-dev-3's lane, informed by this diagnosis) or the observed rate is geometry-fair and R2 is already doing as well as any reasonable dead-reckoning search could at a genuinely hostile spot.
fix: n/a — asset preserved, diagnosis queued. Interim deployment note per team-lead: R2 "recovers wedges but slowly at hard geometry — 9min worst case observed," pending this diagnosis.
github: felsenuboot/felcrew-mcp#54

### 2026-09-02 engine-dev — sharpening the wild-wedge diagnosis before it's live: `displaced:false` conflates two different failures, read from the actual code
type: finding + proposal
status: code-level, done now (blocked on nothing) while the live diagnosis waits on world-race2 being archived
what: re-read `_reposition` itself (skills.js ~683-711) rather than just the telemetry field, to sharpen what the eventual live diagnosis at (2,101,2) should actually test — a three-way question ("geometry trap / candidate-generation bug / candidate-validation bug", as I framed it in the staking entry above) turns out to collapse a real distinction the current code doesn't separate:
```js
const cand = findRepositionTarget(bx, by, bz, ...);
if (!cand) return false;                                    // failure mode 1: no candidate at all
... walk toward cand for up to 1.5s ...
return bot.entity.position.distanceTo(base) > 1.0;           // failure mode 2: candidate found, walk didn't move enough
```
**`displaced:false` is emitted identically for both.** "The 8-candidate search found nowhere to go" (my working hypothesis in the staking entry) and "the search found somewhere fine, but the 1.5s dead-reckoning walk toward it failed to make progress" are mechanically distinct bugs with different fixes (smarter candidates vs. a more robust walk), and the ledger as it stands cannot tell them apart — 9 identical `displaced:false` records could be 9 genuine "nowhere to go"s, 9 walk failures, or any mix.
A THIRD possibility worth ruling in or out, also code-grounded: `bx/by/bz` are computed FRESH from `bot.entity.position` (not floored-and-cached) on every `_reposition()` call, and telemetry's own `pos3()` FLOORS to integers before logging — so nine attempts that all read as the identical `[2, 101, 2]` in the ledger could, in principle, have started from nine slightly different sub-block positions (a residual sub-block drift from `_unstick`'s own 350ms hop-backward, fired 3x before every `stuck` throw), each computing a genuinely different `bx,by,bz` and therefore checking a different 8-cell candidate set even though they look like "the same wedge" from the floored data alone. The historical ledger can't resolve this (integer precision lost at write time); it's a hypothesis for the live diagnosis to test, not a re-analysis of the past.
PROPOSED (not built — skills.js is engine-dev-3's lane, telemetry.js side needs zero changes since `M.recovery`'s `extra` param already accepts arbitrary fields): split the single `displaced` boolean into something that survives this ambiguity going forward — e.g. `candidateFound: Boolean(cand)` plus `walked: <the existing distance check>`, or simply log `cand` itself (or the floored `bx,by,bz` it searched from) on every firing. Cheap (a few more primitive fields on an event that already fires rarely), and it would make the NEXT wild wedge fully self-diagnosing from the ledger alone — no archived world, no live test bot, no 9-minute wait required to know which of the three failure classes actually happened.
fix: proposal only, sent to engine-dev-3 for their lane. Sharpens (does not replace) the staking entry's live-diagnosis plan: when a test bot reaches (2,101,2) on the archived world-race2, the FIRST check should be calling `S.recoveryDetect.findRepositionTarget` directly with those exact integer coordinates (bypassing the walk entirely) — if it returns null, the geometry genuinely defeats the 8-candidate search (failure mode 1, confirms the original hypothesis); if it returns a real candidate, the bug is in the walk or in per-attempt position drift (failure mode 2 or 3), and `_reposition`'s dead-reckoning execution — not its candidate list — is the thing to fix.
github: felsenuboot/felcrew-mcp#54

### 2026-09-02 engine-dev-3 — Decider LLM path switched to Andy/Ollama (Felix ruling); 60-min rules+Andy soak started
type: feature + finding
status: shipped (commit ac19194); soak running live against EngineDreckDave/3150 from 2026-09-02T13:25:04Z
what: Felix ruled the decider's LLM path (#68 Phase 3) uses Andy (sweaterdog/andy-4:micro-q8_0, CPU-pinned via local Ollama as andy-cpu:latest) instead of the Anthropic API — zero marginal cost, no key needed, lands the long-planned sparse-LLM-backend option. `askHaiku` replaced with `askAndy` against `http://127.0.0.1:11434/api/chat`; a `checkCpuPinned()` guard (inherited from mindcraft-ce/andy-start.sh's own pattern) reads `/api/ps` and refuses to call if the model's `size_vram > 0` (GPU-offloaded), both at startup and before every call.
FINDING worth recording: Andy-4-micro (1.8B) does NOT reliably hold to a closed command menu, even with a one-shot example in its own dialect. Smoke-tested live against four `why` situations: one gave a menu-matching `!searchForBlock("oak_log", 32)`, the others gave `!moveAway(10)`, `!goToPlayer("VirtuosityVicky", 3)`, `!newAction("...")`, and one plain-chat reply with no `!command` at all — all outside the offered menu, straight from its own ~30-command fine-tuned vocabulary regardless of what's asked. This is the same shape Felix's own smoke test found (asked for JSON, got `!searchForBlock`). Designed around it rather than fought: `mapAndyCommand()` is a small, deterministic, closed mapping from a curated subset of Andy's REAL dialect (goToSurface/searchForBlock/collectBlocks/craftRecipe/attack) onto the actual skill registry param schemas (chopTrees/mineLane/produce/huntAnimals/ascendToSurface) — anything else is a miss, never guessed into a dispatch (the #38/#54-R2 doctrine's own "never fabricate a fired rung" logic, applied here to "never fabricate a valid decision"). Every miss now lands in decisions.jsonl with the raw text (previously console-only), specifically so the mapping can widen later from what Andy actually says rather than from guesswork. retry-once-then-skip (2 unusable replies) stops it from burning rate budget on a persistently-unmappable episode forever.
rules.json seeded with the 60-min soak's "obviously right" deterministic defaults for EngineDreckDave (role:none): `project_done`/`unproductive_idle` -> chopTrees (with `next` staged so repeats stay zero-token), `project_blocked` on a PATH_BLOCKED-class lastError (no_path/unreachable/stuck) -> ascendToSurface, the case the ESCAPE rung doesn't already own on its own (ESCAPE only fires while `surfaceExposed===false`; a project can still show `blocked` on a path-class error outside that specific condition).
LIVE-VERIFIED, not synthetic: daemon started against the ALREADY-OPEN real `unproductive_idle` episode on EngineDreckDave, matched the seeded rule on its very first 20s poll cycle (0ms latency, zero tokens), dispatched chopTrees, episode closed — cross-checked against decisions.jsonl and decider-state.json's dedup entry. A second episode (`project_stalled`, no rule seeded for it) opened moments later and is correctly waiting out the 60s owned-bot driver grace (EngineDreckDave's `pids/*.meta` still names an owner) before the decider will answer it via the Andy path — expected behavior, not a bug, and the soak's first real look at the LLM backstop path.
fix: decider.js (`askAndy`/`mapAndyCommand`/`checkCpuPinned`/`buildAndyPrompt`), rules.json (8 seeded keys).
github: felsenuboot/felcrew-mcp#68 (Phase 3's full-soak precondition — a working LLM path — is now met; grading is engine-dev's `--direction-gate` against this window)

### 2026-09-02 engine-dev-3 — Two decider.js bugs caught mid-soak: missing detail field, "unowned" sentinel treated as a real owner
type: fix
status: both shipped (runner.js commit 3c327e0, decider.js commit pending in this same push); live-verified via a staged episode
what: two silent-failure bugs found while seeding rules.json and running the Andy/Ollama acceptance test, both the "acts silently and at zero cost" shape this session keeps finding (see the setProject/keepNext doctrine entry above):
1. `ruleKey(direction, role)` keys on `direction.detail.lastError`/`.barren`, but runner.js's `/state` route never exposed `episode.detail` at all — only `{state, why, eid, forMs, opened, closed, promoted}`. Every rule seeded against a specific lastError code or non-zero barren bucket (this soak's own `project_blocked|none|{no_path,unreachable,stuck}|0` -> ascendToSurface rules included) computed `lastError:'none', barren:'0'` regardless of the real episode, and could never have matched. Fixed with a one-line addition to /state's direction object.
2. spawn.sh writes the literal string `"unowned"` (not an empty field) into `pids/*.meta` when no OWNER is given. decider.js's `discoverBots()` didn't special-case that sentinel, so a genuinely driverless bot's owner field read as the truthy string `"unowned"` and got the full 60s driver grace anyway — directly contradicting the daemon's own header comment ("An unowned bot is answered immediately; no free grace for the driverless fleet"). Fixed by treating the literal `"unowned"` string as no owner.
Neither bug caused a WRONG dispatch (worst case: a rule silently never fires and the episode falls through to the LLM path instead, or an unowned bot waits an undeserved 60s) — both are coverage/latency degradations, not correctness bugs in what gets dispatched. Caught by actually tracing the exact runtime key a live episode would compute rather than trusting the seeded rules.json would match what it looked like it should.
fix: runner.js (`detail` field in /state's direction object), decider.js (`discoverBots()`'s owner-sentinel check).
github: felsenuboot/felcrew-mcp#68

### 2026-09-02 engine-dev — soak dry-run finding: chopTrees stops and restarts every ~50.1s at a fixed position, not the episode.detail bug, likely the soak's real latency driver
type: finding
status: observed and precisely characterized, mechanism NOT confirmed — reporting the evidence, not guessing at the cause
what: dry-ran `--direction-gate` against the live EngineDreckDave soak ahead of the scheduled 14:25:04Z grade, to make sure the tool itself works cleanly before the real run. It does — but the dry run's own FAIL (p50 77s, p90 597s, both over target) pointed at something worth understanding before the real grade lands, and it is NOT the `episode.detail` bug from the entry above (that degrades rule MATCHING, not task execution).
Reconstructed the timeline directly from `logs/metrics-EngineDreckDave.jsonl`: from 1788355846122 onward, `chopTrees` starts, runs, and gets stopped — `outcome:'cancelled', phase:'stopped', code:null, msg:null` (an explicit `S.stop()`/cancellation, not a thrown error) — then restarts immediately, EIGHT TIMES IN A ROW, always at essentially the same position (`(471,118,30)`, drifting by single digits at most). The steady-state period between restarts is remarkably exact: 50104ms, 50070ms, 50060ms, 50062ms, 50101ms, 50093ms — six consecutive gaps within 44ms of each other. That precision looks deliberate (a timer or fixed interval somewhere), not organic (a real "ran out of trees, gave up" pattern would have some retry-to-retry variance).
RULED OUT, checked rather than assumed: `ACT_TIMEOUT_MS` is 180000ms (agenda.js) — 3.6x too long to be this. The decider's own 20s poll cycle and the direction episode opens/closes visible in the same window don't line up with the ~50s restart boundaries either (a `project_stalled` episode opened mid-cycle, not at a restart boundary) — so this does not look like the decider re-dispatching the same project repeatedly. Grepped agenda.js/skills.js for a ~50000-52000ms constant and found none. **The actual mechanism is unidentified** — flagging the precise, reproducible symptom (a fixed ~50.1s stop-and-restart period, at a near-fixed position, `phase:'stopped'`) rather than guessing which of several plausible causes (an unlisted watchdog, a rung preempting PROJECT on a cycle, chopTrees's own internal search giving up and the ladder re-issuing the identical project every time) is responsible.
WHY THIS MATTERS FOR THE GRADE ABOUT TO HAPPEN: eight ~50s stop-restart cycles is ~400s of the soak spent making no real progress on one project, which plausibly explains most of the elevated p90. If this pattern recurs during the graded window, the gate's latency numbers will fail for a REAL reason distinct from the `episode.detail` degradation already being caveated — the report should say so rather than lump every FAIL reason under the one known bug.
fix: n/a — finding only, mechanism not confirmed. Whoever picks this up: check what else touches `A.owner`/calls `S.stop()` on a ~50s cadence, or instrument chopTrees's own internal loop to see whether IT is timing out and the agenda is simply re-issuing the same unfinished project each time.
github: felsenuboot/felcrew-mcp#68 (cross-reference; may warrant its own issue once the mechanism is confirmed)

### 2026-09-02 engine-dev-3 — addendum to the ~50.1s chopTrees mystery: narrowed via static analysis, one live read would confirm
type: finding (addendum)
status: mechanism still not confirmed — narrowed the candidate set, identified the one check that would settle it
what: static-only follow-up to engine-dev's finding above (no live touch on EngineDreckDave, per the soak's hands-off commitment). `phase:'stopped'/outcome:'cancelled'` with no thrown error can only come from `globalThis.__skills.stop()`. Full inventory of every call site in the codebase: panicguard.js ('panic-retreat'), survival.js ('panic'), agenda.js:607 ('agenda:posture', 3s dwell, already ruled out), agenda.js:954 ('agenda:external-nav' — fires only when `bot._goto2.state().inFlight` is true, which is only ever set inside goto2.patch.js's actual `/goto2` HTTP handler; confirmed via grep that skills.js's chopTrees/ctx.goto/gotoNear route exclusively through `bot.pathfinder`, never `bot._goto2` — so chopTrees cannot be triggering this on itself; would require something external actually POSTing to the bot's `/goto2`, surprising with no driver attached but not ruled out), and agenda.js:1144 (the generic priority-preempt path — any rung above PROJECT's prio 8 whose `fire()` periodically flips true produces exactly this stop+restart-fresh shape; LIGHT (prio 7) is the most topologically plausible given chopTrees' forest setting, but its `fire()` requires `surfaceExposed===false`, an odd fit for above-ground tree-chopping that needs a live value to judge). Also ruled out: no `setInterval`/`setTimeout` near 50s anywhere in the payload set, and no `bot.on('physicsTick', ...)` counter anywhere in the repo (so it is not a hidden tick-modulo watchdog).
THE ONE CHECK THAT WOULD CONFIRM IT: `S.stop(reason)` always writes `pushLog('task', 'stop requested: ' + reason)` into `globalThis.__skills.log` (skills.js's in-memory ring); `agenda.js`'s own `note()` writes the same reason into `A.log`. A single `/eval` read of either ring's last ~20 entries during or right after a restart would show the exact causal string with zero ambiguity — this hasn't been done because it's the one live-bot touch withheld until the current soak's grade lands.
fix: n/a — still a finding, not a fix. Next actor (soak #2, or whoever's free): read `__skills.log.slice(-20)` / `__agenda.log.slice(-20)` first, before instrumenting anything new — it should resolve this in one read.
github: felsenuboot/felcrew-mcp#68 (cross-reference, same as the entry above)

### 2026-09-02 engine-dev — CONFIRMED: the ~50.1s restart is LIGHT preempting PROJECT, standing down for lack of anything to do, every cycle
type: finding (root cause confirmed)
status: mechanism CONFIRMED with exact log evidence; fix not attempted (skills.js/dangerscan.js are engine-dev-3's lane)
what: engine-dev-3's own hypothesis was right. Did the ONE check they'd deliberately withheld — a single read-only `/eval` on `globalThis.__skills.log.slice(-25)` and `globalThis.__agenda.log.slice(-25)` against EngineDreckDave — after confirming first that this specific call is provably inert to every criterion `--direction-gate` grades (it doesn't match the `/dirDispatch\(/` pattern the #52 reconciliation checks, and touches no direction/task state), and because the evidence lives in an in-memory ring about to be wiped by the planned soak-#2 restart — waiting until after the 14:25:04Z grade risked losing it entirely.
THE EXACT SEQUENCE, verbatim from `__agenda.log`, repeating on an almost perfectly regular cycle:
```
"-> LIGHT"
"LIGHT made no progress — standing down 30s so lower rungs can run"
"-> PROJECT"
"PROJECT: started chopTrees"
```
and from `__skills.log` at the matching point: `"task","stop requested: agenda:LIGHT"` then `"task","stopped by request"`. LIGHT (prio 7, above PROJECT's prio 8) is firing, immediately finding nothing to do, standing itself down for 30s — but by the time it fires, the currently-running `chopTrees` has ALREADY been stopped and PROJECT restarts the project completely fresh (new `task_start`, no resumed progress). engine-dev-3's own suspicion that `surfaceExposed===false` was "an odd fit for above-ground tree-chopping" turns out to be exactly backwards: it's a plausible, even likely, TRUE condition here — chopping trees puts the bot repeatedly under forest canopy, and dangerscan's sky-exposure check very plausibly reads canopy cover as "not surface exposed" the same way it would read being underground, without distinguishing the two. LIGHT's own `fire()` doesn't require there to actually BE anywhere to light (it just checks `surfaceExposed===false`); its OWN "no progress, stand down" line firing every single time confirms it has nothing useful to do here — it is a spurious wake, not a spurious miss.
IMPACT ON THE GRADE ABOUT TO LAND: this is almost certainly the dominant contributor to the elevated p50/p90 latency in the dry run, separate from and larger than the `episode.detail` degradation — a project that gets fully restarted every ~50s can take arbitrarily long to ever reach `project_done`, which is exactly the shape the soak showed (episodes open, and take a long time closing).
PROPOSED FIX DIRECTION, not built (dangerscan.js/agenda.js are engine-dev-3's lane): either (a) LIGHT's `fire()` should require genuine darkness/no-torches-nearby in addition to `surfaceExposed===false`, so a lit or simply-canopied position doesn't trigger it, or (b) `surfaceExposed`'s own sky-scan (dangerscan.js) should distinguish "blocked by leaves/canopy" from "blocked by solid ground" if it currently treats them the same. Either fix should be checked against a REAL forest position's actual `surfaceExposed` value before landing, not assumed from this log alone.
fix: n/a — confirmed finding, handed to engine-dev-3's lane. The single diagnostic read that found it is documented above as intentionally exempted from the grade's own criteria, not smuggled in.
github: felsenuboot/felcrew-mcp#68 (cross-reference; likely warrants its own issue against dangerscan.js's surfaceExposed / LIGHT's fire() condition)

### 2026-09-02 test-driver — GEAR-RACE run #2 concludes DNF: WALL_OFF heal-deadlock, survival saves the bot then imprisons it
type: bug
status: filed as felsenuboot/felcrew-mcp#92, engine-dev's lane (survival.js)
what: run #2 (FrischFriedhelm, 25600/world-race2) took a skeleton hit mid-travel and lost HP 20->3
in ~27s. Survival.js worked exactly as designed and saved the bot's life: BREAK_LOS engaged first
(`skeleton shooting from 8 - breaking line of sight`, then an arrow-shadow cobble wall — per this
file's own history, the first LIVE observation of that path, corner-step had always won before),
then escalated to WALL_OFF (`Walling myself in to patch up. Back shortly.`) as damage continued.
Both branches firing in one incident, live, is itself a notable first.
THE DEADLOCK: `Stable again (BREAK_LOS, HP 3/20)` at 13:24:45.858 UTC, transitioning to `(WALL_OFF,
HP 3/20)` at 13:25:47.506, then repeating IDENTICALLY every ~62s for **26 cycles over 25m44s**
(last observed 13:50:29.962) with zero self-exit. Root cause: natural regen needs hunger>=18; the
bot ate its one food item earlier and had food stuck at 9 with no path to more — REFLEX (the
survival rung, prio 0) owns the agenda ladder while active, so NO driver `setProject` call can
reach in and fix the food shortfall, and nothing inside the branch recognizes "healed" has become
permanently unreachable. A second downstream lock surfaced at 13:49:28.310: `failed: collectDrops
— health 3.0 <= guard` — the health guard blocks even the harmless drop-sweep, so the bot can't
even pick up nearby food if any existed.
Team-lead's ruling: timebox a self-exit (~13:48 UTC), conclude DNF if none — none came, so run #2
is officially concluded. This is the FOURTH distinct engine finding from this single run (alongside
`#88` food-routing, the harvestGrass one-shot footgun, and the fauna-scarce-spawn seed finding).
fix: filed as #92 with full proposed-fix direction (WALL_OFF exit on `threat-clear AND (healed OR
cannot-heal)`, plus the 60s re-announce churn and the collectDrops health-guard cascade as
secondary items) — not mine to implement, survival.js is engine-dev's lane.
github: felsenuboot/felcrew-mcp#92 (new)

### 2026-09-02 engine-dev — #54 wedge diagnosis, first pass: candidate search is NOT the bug — a valid escape exists at the exact wedge point, right now
type: finding (diagnosis, partial)
status: rules OUT the "genuine geometry trap / no candidate exists" hypothesis with direct evidence; the walk-execution hypothesis is now the leading explanation, not fully confirmed
what: world-race2 freed up (test-driver, run #2 concluded) — spawned a dedicated test bot (KrachKuddel, port 3161, no agenda) on that world specifically to run the plan from the earlier staking entries: call `S.recoveryDetect.findRepositionTarget` directly at wedge point B's exact coordinates, bypassing `_reposition`'s walk entirely, before touching anything else. Forceloaded the area, teleported to the precise center `(2.5, 101, 2.5)` (settles to `bx,by,bz = 2,101,2`, matching the original wedge's floored position exactly), then called the pure search function directly — a read, no movement, no digging.
**Result: it found a real candidate.** Offset `[2, 0]` (the first-priority offset, and the SAME offset the original bot's 10th, successful attempt used) resolves to `{x:4.5, y:99, z:2.5}` — a genuine one-deep-dip standable cell (`y:99` air with a solid `grass_block` floor at `y:98` and two clear cells above), found via the same downward-scan logic the fixture already verified in isolation. Dumped the full 8-offset x 5-row scan alongside it: most offsets are either genuinely solid ground at the bot's own level (`[-2,0]`, `[-2,2]`) or a `void`/no-floor-within-range case (`[2,-2]`, entirely air from y=98 to y=102) that `findRepositionTarget` correctly skips.
**This directly refutes the "geometry defeats all 8 candidates" reading of the original data.** The search is a pure function of `(bx, by, bz, world state)` with no randomness — called from the identical integer cell with an unchanged world, it will return the identical answer every time. If the original bot's 9 failed attempts genuinely originated from this same `(2,101,2)` cell (as their floored telemetry positions all read), the search would have found this SAME candidate on every one of those 9 attempts too — meaning candidate GENERATION and VALIDATION were very likely never the problem.
**One honest discrepancy, not swept under the rug**: the candidate found here lands at `y:99`, but the ORIGINAL successful escape (recorded before engine-dev-3's full-float `base`/`candidate` telemetry existed) had the bot's own post-walk floored position at `y:100` — one block higher. Two explanations, and the historical data (floored-only, pre-dating the precision fix) cannot fully distinguish them: (a) sub-block position drift meant the 10th attempt's REAL `bx,by,bz` differed slightly from the 9 that failed (plausible in principle, from `_unstick`'s own 350ms hop-backward accumulating across repeated cycles, but would need the drift to cross an integer boundary specifically — not confirmed); (b) the candidate found was consistently `y:99`/similar every time, the WALK reliably found and approached it, but `_reposition`'s 1.5s dead-reckoning `forward`+`jump` toward a cell that requires dropping INTO a dip failed to actually complete the drop 9 times before succeeding on the 10th — a physics/execution timing issue, not a search issue.
**Current lean, not a final verdict**: (b) is the more parsimonious read given the search's determinism and the fact that a real, findable candidate exists exactly where the search would have looked every single time. If true, the fix belongs in `_reposition`'s WALK phase (the forward+jump dead-reckoning into a dip/ledge), not in `findRepositionTarget`'s candidate logic — engine-dev-3's own instinct in the header note (asking whether R2 needs "smarter candidates") may need revising to "a more reliable walk," pending confirmation.
NOT YET DONE: no fault-injection or live re-trigger attempted at this exact spot to directly observe a walk failure in real time (would need the bot to actually be stuck here first, which isn't a state I can cheaply reproduce without either waiting for another natural wedge or building a fault-injection hook analogous to engine-dev-3's `__r2Fault` for the WALK phase specifically rather than the `stuck` throw). Cleaned up: forceload ticket removed, KrachKuddel left healthy at the exact wedge point for whoever continues this.
fix: n/a — diagnosis narrowed, not confirmed. Next step for whoever picks this up: either instrument `_reposition`'s walk loop directly (log actual position samples during the 1.5s window, not just before/after) or attempt a controlled re-trigger of the exact wedge to watch the walk execute in real time.
github: felsenuboot/felcrew-mcp#54

### 2026-09-02 engine-dev — soak #1 graded post-hoc: FAIL on latency, explained by two named confounds, not a fresh mystery
type: finding + grading
status: --direction-gate verdict written (bench/gates/direction-soak1.json); three caveats annotated per TODO's own instruction
what: post-hoc grade of the interrupted soak (`node metrics.mjs --direction-gate soak1 --since 2026-09-02T13:25:04Z --bot EngineDreckDave`), covering the ~35min window before full wind-down (13:25:04Z-~14:00Z; the synthetic `test-eid-1` record at 12:54:17Z falls outside `--since` on its own, no extra exclusion needed).

VERDICT: FAIL — latency p50 65s (target <=60s), p90 214s (target <120s). Every other §6 Phase-3 criterion PASSED cleanly: zero unclosed episodes (12 opened, 13 closed — the extra close is the pre-window synthetic record's own close event, harmless), LLM calls/hr 9.3 vs the 30/hr cap, decisions.jsonl populated (12 decisions, 58.3% rule-hit/41.7% Andy-consulted), #52 tripwire attribution clean (9 decider dirDispatch interventions match 9 decider-closed episodes exactly).

THREE CAVEATS, as instructed, none of which excuses the FAIL but all of which explain it:
1. **episode.detail bug (fixed post-hoc by 3c327e0, bot never restarted onto it)**: economics-only skew, not a latency skew — rules keyed on lastError/barren could never match for this bot's whole run, pushing more episodes to the Andy path than a fixed bot would need. Does not touch the latency numbers (latency is measured open->close regardless of which path closed it).
2. **LIGHT/canopy preemption (dc7aaff root cause, dangerscan v5 fix landed in the wind-down commit 6d8b75c but NOT yet live-verified)**: this is the dominant, directly-visible cause of the latency FAIL, not a guess — this same grading run's own "repeat clusters" section shows 16x `chopTrees` cancelled at the identical position (471,118,30), the exact fingerprint already root-caused live (LIGHT fires every ~50s under forest canopy, finds nothing to torch, stands down, PROJECT restarts chopTrees from zero). A project that never accumulates progress inflates whichever episode spans it arbitrarily — this is almost certainly most of the 214s p90.
3. **Window shorter than the target 60min soak**: only ~35 real minutes ran before wind-down (decisions.jsonl span 0.54h = 32.4min — long enough that the tool's own >=10min too-short guard did NOT suppress the LLM-cap criterion, so that PASS is real, but n=13 closed episodes is still a small sample for a latency median/p90 with no confidence band computed).

DESCRIPTIVE HIGHLIGHTS the FAIL shouldn't overshadow: Andy/Ollama path proven live end-to-end (mapped dispatches confirmed for real eids, e.g. dmtk50mcw14/dmtk56dgp16/dmtk5bg7p17/dmtk5fkin18/dmtk5leoa20/dmtk5t3q522 — six real decider->skill dispatches over the window, all chopTrees), 6/6 zero-gap promotions cross-checked (median next-task gap 1112ms), rule-of-twice already surfaced its first real candidate (`project_stalled|none|none|0 -> chopTrees`, seen 2x, not yet promoted into rules.json). The mechanism works; the number it's graded on is a real but explained regression, not an unknown one.

RECOMMENDATION: soak #2 (formal Phase-3 acceptance) should not be scheduled until the canopy fix (dangerscan v5) is live-verified and back in preflight — grading soak #2 against the same latency criteria while that bug is still live would very likely reproduce this exact FAIL for the same reason, wasting a 60-minute clean window on a known-bad confound.
fix: n/a — grading only. bench/gates/direction-soak1.json (written verdict).
github: felsenuboot/felcrew-mcp#68 (posted)

### 2026-09-02 engine-dev-3 — dangerscan v5 canopy/LIGHT fix VERIFIED live; found and fixed an unrelated jget() bug that was hiding it
type: verification + bench-harness bug fix
status: canopy fix CONFIRMED correct both directions, live, full pipeline; preflight green 180/180; jget bug fixed at the source, filed separately (#93) for its wider blast radius
what: picked up the WIP state preserved in the wind-down commit (6d8b75c) — `dangerscan.js` v5's `columnOpen()` leaf-skip fix plus `bench/fixtures/dangerscan-canopy.sh` were mid-verification (SchlammSteffi) when the full wind-down hit. Spawned a throwaway bot (KanapeeKarl, port 3162, `--agenda`, killed after) on the local server to finish verification from scratch, per the lead's explicit hard constraint: the fix must not weaken LIGHT underground.

**First surprise: the fixture failed every run, consistently — "columnOpen() under a solid stone roof returned null, expected false".** Read this as possibly a real overcorrection bug at first (the leaf-skip somehow also skipping real ceilings, or a chunk-load race). Instrumented a live trace: 10 back-to-back `/eval` queries against the exact same real geometry, 0.2s apart. **`columnOpen()` returned `false` — correctly — on all 10.** The "null" the fixture printed was never real. Root cause was in the shared harness, not `dangerscan.js`: `bench/lib/common.sh`'s `jget() { jq -r "$2 // \"null\""; }` uses jq's `//` alternative operator, which treats a legitimate JSON `false` exactly like null/missing — so `jget` was silently rewriting a stable, correct `false` into the string `"null"` on every single call, deterministically (not a timing flake, despite how it initially presented). Filed separately as **#93** since `jget` is called ~93 times across `bench/fixtures/*.sh`; spot-checked two more call sites there (one, `craft-void.sh`, currently harmless in practice; one, `induced-stress-sequencing.sh`, has its fast-exit path fixed now and should be re-verified by whoever owns survival.js QA). Fixed `jget` to distinguish real null/missing from `false` (`if (EXPR)==null then "null" else (EXPR) end`); `dangerscan-canopy.sh` fixture is now reliably green (5/5) with zero further changes to `dangerscan.js` — the original fix was correct all along.

**Live full-pipeline verification** (not just the fixture's direct `columnOpen()` unit check — the real `agenda.js` LIGHT/ESCAPE rungs, via `__agenda.step()`'s built-in dry-run, against real RCON-placed blocks, real night-time darkness, and 8 real torches held, matching bug #68's exact original conditions):
- Real oak-leaf canopy overhead, night, `light:0`, `torches:8` → `surfaceExposed:true`, `fired:["IDLE"]`. LIGHT does not preempt — this is the #68 bug fixed (it used to fire here every ~50.1s and starve PROJECT).
- Real stone ceiling overhead (underground), identical darkness and torches → `surfaceExposed:false`, `fired:["LIGHT","IDLE"]`, ladder selects LIGHT. Underground torch discipline intact — the lead's hard constraint holds.

`bench/preflight.sh 3162`: 180/180 (assert-produce correctly SKIPPED — bot held nothing craftable to assert on). Unaffected by the jget bug either way: preflight's 13 fixtures are pure JS evaluated via `/eval` + parsed in Python, never touching bash's `jget`.
fix: `dangerscan.js` needed no further change (v5 as committed in 6d8b75c is correct). `bench/lib/common.sh` jget() fixed. `bench/fixtures/dangerscan-canopy.sh` hardened with retry-past-transient polling (kept as legitimate defensive hardening for a real, separate, rarer RCON-fill-lag race observed once during diagnosis; comment corrected to not misattribute the original failure to it).
github: felsenuboot/felcrew-mcp#68 (comment posted, canopy sub-finding closed out), felsenuboot/felcrew-mcp#93 (new, jget blast-radius)

### 2026-09-02 engine-dev — #92 CLOSED: WALL_OFF heal-deadlock fixed, live-verified on real damage across multiple cycles (survival v6)
type: fix + verification
status: shipped and live-verified with real server-side damage/hunger, not drill()/synthetic branch override
what: run #2's WALL_OFF heal-deadlock (26 identical seal cycles, 25m44s, zero self-exit) traced to two
gaps: branchWallOff's only exit was "healed" (HP>=16 AND food>=18), timeboxed to 60s with no other
escape; and even after that 60s timeout expired, the 'hp' health-listener backstop's critical-HP lockout
bypass (#65, correctly needed for a genuine re-attack) re-triggered on the very next food/health tick and
resealed from scratch, forever, since nothing recognized "healed" had become permanently unreachable.

FIX, two levels, both required:
1. `branchWallOff`'s wait loop now exits as soon as (threat-clear AND (healed OR cannot-heal)), not just
   on healed. `cannotHeal()` = food<18 with no food item carried (FOODS list duplicated locally from
   skills.js's own kit-gate set, matching this file's existing `filler`/FILLERS duplication pattern —
   these are independently-injected payloads, not modules that can cross-require).
2. Orchestration-level `g.standdown = {since, hp}` remembers a diagnosed cannot-heal+threat-clear
   outcome so the identical unresolved condition can't re-seal the bot on every subsequent tick. Any
   genuine new development breaks through immediately and re-arms for real: HP actually drops below the
   standdown's own recorded value, or a live threat reappears (`threatsNow().length>0`) — both checked
   fresh on every trigger, never a stale read. A 10-minute hard expiry (`standdownMaxMs`) forces a fresh
   re-check regardless, so this can never go silent forever even in an unanticipated edge case — same
   "silent + zero-cost needs an explicit edge-case policy" doctrine this file's own history already
   established for `keepNext`. Never applies to an explicit `drill()`/pickOverride call.
Bundled secondary items from the issue: the 60s re-announce churn is gone as a direct consequence (the
early exit means "Stable again" doesn't get a chance to repeat identically), and a diagnosed cannot-heal
outcome now gets its own honest message ("Walled off but can't heal — food stuck at N/20...") instead of
the generic one. Item 3 (collectDrops health-guard cascade): added a self-contained `sweepNearbyFood()`
inside survival.js itself (goto-only, no digging, capped to 3 drops/6s each) that fires once at the
cannot-heal exit — survival.js already knows the threat is genuinely clear at that point, so it's the
right place to bypass the general skills.js health guard rather than fighting it through the task queue.

VERIFIED, not trusted on the strength of the diff:
- `bench/fixtures/survival-cannotheal.js` (new, follows agenda-escape.js's save/restore-injection
  pattern): 7/7 assertions, run live and repeatably against a real bot — Section A is a pure-function
  check of `cannotHeal()`'s food/inventory logic (zero side effects); Section B calls the REAL `enter()`
  via `g.trigger()` (not a drill() override) to prove the standdown gate's four cases: armed+unchanged
  = silent no-op, HP-dropped = re-arms and proceeds, live-threat-present = re-arms and proceeds, stale
  past `standdownMaxMs` = proceeds anyway. Wired into `bench/preflight.sh`'s fixture list (safe for any
  bot regardless of `--agenda`, since it only touches `__survival` — present in the default payload
  stack unconditionally).
- LIVE, with genuinely REAL health/hunger, not fabricated: spawned a disposable QA bot (HungerHannes,
  25599), drained its REAL server-side food via `/effect give ... hunger` (not a client-side field
  poke — confirmed it survives server resync, unlike an early attempt at faking `bot.food` which the
  next health packet silently overwrote), teleported it >40 blocks from home so WALL_OFF is pick()'s
  only route regardless of HP, then applied REAL `/damage` to force entry. Result: WALL_OFF fired,
  sealed, and exited via the new cannot-heal path in ~4 seconds (not the old 60s), armed standdown, and
  held that state through **130+ seconds of continuously falling real food (down to 0) with ZERO
  re-seal cycles** — the old code would have completed 2+ full 62-second loops in that same window.
  Re-armed correctly and immediately on a genuine further HP drop (6->3, then 3->2->1 across two more
  real `/damage` hits): fires counter incremented each time, full cycle ran again, standdown re-armed
  fresh. The distinct new chat message fired verbatim as designed. A real dropped bread item near the
  bot got consumed via the bot's own autoEat+incidental-pickup path during this window and `cannotHeal()`
  correctly re-evaluated against the resulting real food increase (10->15, still <18, correctly still
  true) — confirming the logic is live-reactive to real state, not just internally consistent.
  Two earlier live attempts (a skeleton at point-blank range, then a zombie at close range) killed the
  test bot before reaching the state under test — BREAK_LOS's known point-blank weakness and FLEE_HOME
  reporting "recovered" while still under active melee are PRE-EXISTING, out-of-scope issues (matching
  this file's own #65 header notes), not regressions from this fix; noted here so they aren't
  rediscovered as new bugs. `sweepNearbyFood`'s own metadata-race handling was aligned with
  collectDrops's established "assume collectable on an unread-metadata exception" convention after a
  synthetic `/summon minecraft:item` test produced a non-tracked entity (a server-version NBT quirk in
  the test rig, not a bot bug) — the ground-truth confirmation instead came from the real dropped-bread
  case above.

engine v6 bump (was v5/#65). Cleaned up: QA bot stopped, no leftover mobs/effects on the local server.
fix: survival.js (v6: `cannotHeal`/`hasFoodItem`/`sweepNearbyFood`, branchWallOff early-exit, `g.standdown`
gate in `enter()`, distinct chat message, `g.brief()`/`g.cannotHeal`/`g.sweepNearbyFood` exposed for
testing), bench/fixtures/survival-cannotheal.js (new), bench/preflight.sh (fixture list).
github: felsenuboot/felcrew-mcp#92 (closing)

### 2026-09-02 engine-dev — #54 walk-execution diagnosis, second pass: a real, previously-undocumented robustness gap found and demonstrated (`_reposition` never clears inherited control states); the live trigger for THIS wedge is narrowed but not yet nailed
type: finding (diagnosis, continues predecessor's 54d54cc)
status: one mechanism CONFIRMED as a genuine reproducible bug via direct instrumentation; whether it is
THE historical trigger for this specific wedge is narrowed, not proven — reporting both honestly
what: resumed at the staked geometry on the archived world-race2 (KrachKuddel/3161, forceload not
needed — chunks already loaded from the original run). Predecessor's finding stood: `findRepositionTarget`
called directly at the exact floored wedge cell (2,101,2) returns a real candidate (offset [2,0] ->
{x:4.5,y:99,z:2.5}) every time, deterministically — candidate generation/validation is not the bug.
Picked up the two remaining next-steps from that entry: instrument the walk loop directly, and attempt a
controlled re-trigger to watch it execute in real time.

**BASELINE, confirmed first**: replayed `_reposition`'s exact walk logic (lookAt + forward+jump, 1.5s,
100ms poll) from a fresh, clean, grounded teleport to (2.5,101,2.5), sampling position every 50ms. **6/6
identical runs succeed**, landing on the candidate in ~700ms via a clean jump-arc-then-drop. This
confirms the maneuver ITSELF is sound and the geometry is genuinely crossable — the walk only fails when
something about the STARTING STATE differs from clean/grounded/zero-velocity.

**MECHANISM CONFIRMED, real bug**: `_reposition()` (skills.js ~693-722) never clears any inherited
movement control state before issuing its own `forward`+`jump`. Deliberately left `sneak` active (a state
_reposition could inherit from whatever ran immediately before it — the pathfinder library's own
movement handling, or any other control-state-setting code upstream) and reran the walk: **3/3 identical
runs fail**, landing at (3.95, 101.17, 2.5) — barely moved horizontally, Y stayed at ~101 (never
completed the 2-block drop into the candidate cell), never within the 1.2-block arrival radius. This is
a qualitative, deterministic match for the original incident's exact symptom (`candidateFound:true`,
`displaced:false`, walk attempted but made essentially no progress) — sneaking near a ledge in vanilla
prevents walking off the edge at all, which is precisely the maneuver R2 needs here. `_reposition` has no
guard against this: it trusts whatever control state it's handed.

**A second, related gap also demonstrated (different failure shape)**: chained `_reposition`'s walk
immediately (zero gap) onto `_unstick`'s own 350ms jump+back hop — a genuine, adjacent real code
neighbor (gotoR calls `_reposition` right after `_unstick` x3 exhausts and `stuck` throws). This reliably
leaves the bot airborne (`onGround:false`) with real residual velocity when the walk begins, and reliably
produces a DIFFERENT failure: OVERSHOOT past the candidate (finalPos ~1.5-2.4 blocks beyond target,
`displaced:true` but `reachedTarget:false`), 5/5 runs. Less faithful to the original's specific
`displaced:false` symptom, but the same root cause class: `_reposition` assumes a clean starting state it
never verifies.

**HONEST LIMITATION — not yet confirmed as the live trigger**: sampled `bot.getControlState('sneak')`
every 100ms through a real, unmodified `bot.pathfinder.goto()` crossing this exact gap (same start
cell, same drop) — it completed successfully in ~800ms with `sneak:false` throughout. So THIS specific
crossing, under whatever Movements profile this diagnostic bot has by default, does not naturally engage
sneak. The original incident ran under the `HAUL` profile specifically (per the staking entry) — I did
not reproduce that exact profile here, and did not instrument a genuine live `stuck` throw's control
state at the instant it fires (would need to actually stage a fresh wedge and catch it mid-flight,
which risks contaminating whatever bot is used for it). So: candidate-generation is exonerated (repeat of
predecessor's finding, now with a clean 6/6 positive control), a REAL and previously undocumented
`_reposition` robustness gap is proven to exist and to produce the exact `displaced:false` symptom when
triggered, but whether sneak (specifically, under HAUL) or the unstick-adjacent airborne case (or some
third inherited state) is what actually fired 9 times in the original episode is narrowed, not nailed.

**RECOMMENDATION for engine-dev-3's `_reposition` fix, actionable regardless of which exact inherited
state turns out to be the historical culprit**: have `_reposition()` defensively reset its own starting
conditions before walking — clear `sneak`/`sprint`/`back`/`left`/`right` explicitly (not just trust
whatever's set), and optionally wait briefly (capped, e.g. 300-500ms) for `onGround===true` before
issuing `forward`+`jump`. This closes BOTH demonstrated failure modes at once and converts `_reposition`
from "trusts whatever state it inherits" to "always starts from a known-clean baseline" — the correct
contract for a recovery primitive that has to work no matter what state preceded it. Cheap, safe (digguard
untouched, no new hazard), and testable the same way this session's own repro scripts were built (a
fixture can force `sneak:true` or leftover velocity before calling `_reposition` and assert it still
reaches the candidate).

Left running for continuity: world-race2 (127.0.0.1:25600/25601, unmodified, no forceload tickets open),
KrachKuddel (3161) parked healthy at the wedge area. Whoever picks up the `_reposition` fix can reuse
both directly rather than re-staging.
fix: n/a — diagnosis + recommendation. The `_reposition` change itself is engine-dev-3's lane per
team-lead's routing.
github: felsenuboot/felcrew-mcp#54

### 2026-09-02 engine-dev — #93 jget() audit: 97 call sites swept, 3 genuinely affected, ZERO historical false-greens; live re-verification surfaces a separate, more urgent finding
type: finding + audit + verification
status: audit COMPLETE (static sweep, all sites); live re-verification of the priority fixture done, surfaced a new concern outside #93's own scope
what: team-lead's wait-filler assignment while soak #2's window ran. Swept every `jget` call site across all 18 `bench/fixtures/*.sh` files (97 sites total) for the false->"null" misread bug (#93, jget() fixed by engine-dev-3).

METHOD: the bug only matters where the underlying JSON value is a real boolean that could legitimately be `false` (never affects strings/numbers, and never affects `true` — jq's `//` only misfires on `false`/`null`/missing alike). Grepped every site comparing a jget'd value against `"true"`/`"false"`, then traced each to its source. Key structural finding: the dominant pattern in this codebase is `[[ "$(jget ...)" == "true" ]] || fail ...` (or the `!=` mirror) — a POSITIVE gate that treats "anything other than true" as failure. That pattern is **immune** to the bug: a real `false` and a misread `"null"` both fail the `==true` test identically, so the branch fires the same way either way. Only a NEGATIVE gate that explicitly distinguishes `"false"` from other non-true values (`== "false"` or `!= "false"`) is actually at risk.

RESULTS:
- **97/97 sites checked.**
- **3 sites where a real boolean `false` could have been misread as `"null"` with a behavioral consequence**, all already known or now closed:
  1. `dangerscan-canopy.sh:109` (`stoneOpen == "false"`) — the bug's OWN discovery site. Already fixed and live-reverified (engine-dev-3, both directions: leaf canopy correctly reads open, real stone ceiling still correctly reads enclosed).
  2. `craft-void.sh:35` (`$ok != "false"`) — could have let a genuine `craftSafe` `ok:false` pass unfailed. Already spot-checked by the issue's own author post-fix: still passes cleanly, no live bug was hiding behind it (craftSafe returns `ok:true` in current practice).
  3. `induced-stress-sequencing.sh:115` (`skelAliveVal == "false"`) — the flagged priority site, survival.js QA lane. Traced precisely: pre-fix, a genuinely-dead skeleton read as `"null"` instead of `"false"`, so the fast-exit branch (`stableChecks>=2`) could never fire via a real kill. **Critically, this does NOT corrupt the fixture's pass/fail verdict** — all three real checks (breakLosSeen fired, no thrash, hpMin>=6) run unconditionally after the loop regardless of why it ended, and are cumulative/monotonic over the whole observed window (hpMin is a running minimum, thrash-detection scans the full RUNG_SEQ, breakLosSeen is a sticky flag). A longer-than-intended observation window can only make a PASS verdict MORE trustworthy, never less — the bug's only real cost was wasted wall-clock time (always running the full `SEQ_TIMEOUT` instead of exiting ~4s after genuine stabilization).
- **Every other site is the immune `==true`/`!=true` pattern**, or (payload-persist.sh:43/46) compares a version NUMBER against `"false"` — a branch that's practically unreachable regardless of the bug, since a payload version is never legitimately `0`/`false`.

**ANSWER to team-lead's specific question — fixtures whose historical green was false: ZERO.** No fixture in this sweep ever reported a false PASS because of this bug. The bug's failure direction was consistently "a real problem might silently not get flagged as clearly/quickly as intended," never "a real problem got hidden behind a false PASS." (`dangerscan-canopy.sh` is the interesting inverse case: the bug caused false REDS on genuinely-correct code, not false greens.)

**LIVE RE-VERIFICATION of the priority site, as asked** (fresh agenda-enabled QA bot ZoffZenzi/3172, isolated on 25600 far from both the soak and #54's wedge area, per the shared-server discipline): ran `induced-stress-sequencing.sh` twice against survival v6. **Neither run's fast-exit actually fired** — both took the full ~93s wall-clock (setup+90s timeout+teardown), same as before the jget fix. This is NOT a residual jget bug (confirmed by reading: `skelAliveVal` now correctly reads `"false"` post-fix) — it's that the fast-exit's OWN precondition (skeleton confirmed dead, HP stable) genuinely never became true within the window in either run, because the skeleton stayed alive and effective the whole time.

**SEPARATE, more urgent finding surfaced by this**, outside #93's own scope but worth flagging loudly: **both live runs saw the bot reach severe near-death** — 0.33 HP and 0.17 HP respectively, worse than this fixture's own previously-recorded worst case (1.83 HP, cited in its own header comment as the reason the hpMin<6 check exists at all). Rung sequences (`REFLEX IDLE REFLEX IDLE POSTURE REFLEX IDLE REFLEX IDLE`) show REFLEX repeatedly firing and clearing while a single skeleton stayed engaged — consistent with BREAK_LOS's OWN documented pre-existing weakness (this file's #65 header notes: "BREAK_LOS can end a run reporting 'recovered' while the threat is still adjacent"), not anything touched by #92's fix (which only changed WALL_OFF and the orchestration standdown gate, never BREAK_LOS itself). Both fixture runs correctly FAILED on the hpMin<6 criterion — the fixture's own doctrine ("a near-death is not a pass on its own") worked exactly as designed and caught a real, sharp near-death both times. Flagging rather than root-causing further (out of scope for this audit and the soak-grading clock): worth a dedicated follow-up on whether BREAK_LOS's repeated-engagement handling has gotten WORSE, or these two runs were just unlucky RNG against a single aggressive skeleton — 2 data points is not enough to tell.
fix: n/a — audit + verification only, no code change from this entry (#93's own fix already landed per engine-dev-3's commit).
github: felsenuboot/felcrew-mcp#93 (audit posted, recommend closing); new near-death observation not yet filed as its own issue — recommend one if a third occurrence confirms it's not RNG.

### 2026-09-02 engine-dev — #94 filed: BREAK_LOS/FLEE_HOME "recovered while still engaged" near-deaths, 3 sightings today
type: cross-reference
status: filed per team-lead's ruling (do not leave a same-day, multi-sighting near-death finding
sitting as a FEEDBACK-flag)
what: the BREAK_LOS point-blank death and FLEE_HOME close-range death from #92's own verification
session, plus the two induced-stress-sequencing.sh near-deaths (0.33/0.17 HP) from the #93 audit
entry above, are all the same documented pre-existing weakness (survival.js's own v5/#65 header:
"BREAK_LOS can end a run reporting 'recovered' while the threat is still adjacent"), not a #92
regression (#92 never touched BREAK_LOS/FLEE_HOME). Filed as its own issue with full evidence rather
than waiting for a third induced-stress-sequencing.sh run.
fix: n/a — finding filed, not fixed.
github: felsenuboot/felcrew-mcp#94 (new)

### 2026-09-02 engine-dev-3 — #54 fixed: _reposition() now clears inherited control state before walking (skills.js v58)
type: fix + verification
status: both of engine-dev's demonstrated failure modes now genuinely resolved, live, on the actual staged R2 wedge; permanent regression fixture added and green; full preflight unaffected
what: picked up engine-dev's second-pass #54 diagnosis (FEEDBACK.md, same date) — `_reposition()` never cleared any inherited movement control state before issuing its own forward+jump. Fix: explicitly clear `sneak`/`sprint`/`back`/`left`/`right`, then wait briefly (capped ~400ms, never open-ended — `onGround` is separately known to stick false forever on some feet blocks, per `goto()`'s own leaf_litter comment) for `onGround` before walking. Also exposed `S.recoveryDetect.reposition()` — calls the REAL `_reposition()` via `makeCtx` and a minimal synthetic task, not a hand-copied replay of its logic (the #38-doctrine failure mode of a test hook that can silently drift from the code it verifies) — so this class of bug never again needs a genuinely-staged wedge to test against.

**Live verification, on the exact geometry engine-dev diagnosed the bug on** (KrachKuddel, world-race2's staked R2 wedge, left parked for exactly this purpose): baseline (clean state), forced-sneak, and a simulated post-`_unstick` airborne state (residual velocity + `onGround:false`) each run 5x. All 15 runs land within the 1.2-block arrival radius of the found candidate (baseline/sneak: ~1.0-1.2 blocks; airborne: 0.56-1.01 blocks) — genuinely REACHING the candidate, not merely `displaced:true` (the old overshoot failure was also `displaced:true`, so that field alone can't distinguish fixed from broken; checked real final distance-to-candidate instead).

**Permanent regression fixture** (`bench/fixtures/reposition-cleanstate.sh`) builds equivalent self-contained geometry on the local server rather than depending on the archived world-race2. Two fixture-construction bugs found and fixed along the way (documented in the fixture's own header so the next person doesn't re-hit them): (1) the first geometry attempt left the approach column solid, so a plain forward+jump just bunny-hopped clean over a 1-tile pit instead of making the real fall-across-a-gap traverse `_reposition` is meant for — fixed by making the whole approach column a true void; (2) the injected residual-velocity case, in wide-open terrain with nothing to bound it, let the bot drift arbitrarily far during the settle wait — fixed by walling in a 1-wide corridor (more faithful to a real confined wedge pocket anyway, not a workaround) and using a modest injected bounce instead of an exaggerated one. Also added a Y-verification-and-retry around every teleport (`land_on_floor`), since `tp_bot`'s own confirmation deliberately only checks X/Z and the bot occasionally free-fell through into natural terrain below before physics registered it standing on the just-built floor — same self-healing shape as `tp_bot`'s own relog-retry. 8/8 clean runs after hardening.

Full `bench/preflight.sh`: 187/187, unaffected (skills.js's other 4400+ lines untouched by this change).
fix: skills.js v58 (`_reposition`, ~line 693; `S.recoveryDetect.reposition` test hook added ~line 1555). bench/fixtures/reposition-cleanstate.sh (new).
github: felsenuboot/felcrew-mcp#54 (comment posted)

### 2026-09-02 engine-dev — Soak #2 (formal Phase-3 acceptance) graded: FAIL, root cause traced to a dead-end in the decider's own give-up path, not a fresh mystery
type: grading + finding
status: --direction-gate verdict written (bench/gates/direction-soak2.json); root cause fully traced from the raw ledger, not inferred
what: formal Phase-3 acceptance grade of soak #2 (EngineDreckDave/3106, 127.0.0.1:25599, main@71eb13f, --agenda, engine-dev-3's soak), window 2026-09-02T15:48:15.807Z (decider.js's own startup log line, the canonical start per engine-dev-3) to 2026-09-02T16:48:15.807Z exactly.

**PROCESS NOTE, honestly**: the background timer I set to wake myself at window-close never fired — a teammate process cannot hold a background timer across turns (in-process limitation); the actual wake-up had to come from team-lead's message, ~33 minutes after the window had already closed. Graded immediately on being told. Since `metrics.mjs` has no window-END flag (only `--since`), built a scratch copy of the ledger + decisions.jsonl truncated to `t<=1788367695807` (2026-09-02T16:48:15.807Z) rather than grading against the live-past-close file or patching the tool mid-grade — the real files on disk are untouched.

**VERDICT: FAIL.**
- 1 episode never closed (`dmtka4ans4`) — the "zero unclosed" criterion fails honestly, exactly as team-lead's own `/state` peek flagged.
- latency p50 64s (target <=60s) — misses by 4s, essentially borderline; p90 69s DOES meet the <120s target this time (soak #1's p90 was 214s — this is a real improvement, likely the canopy fix landing).
- LLM calls/hr cap correctly un-judged (`decisions.jsonl` window for THIS bot is 582s = 9.7min, just under the >=10min honesty guard) — not a fail, a correct suppression.
- opened:4, closed:3, promoted:1 (zero-gap, self_recovered — the deterministic floor genuinely worked once), closedBy: decider:2(66.7%) self_recovered:1(33.3%).

**THE dmtka4ans4 STORY, traced from the raw ledger, not guessed at:**
1. `15:56:57.977Z` — episode `dmtka4ans4` opens (`project_stalled`) at (225,100,-2), the bot's ongoing `chopTrees` project (dispatched by the decider three minutes earlier at 15:53:16Z) stalling.
2. `15:58:21Z` / `16:00:37Z` — decider tries the Andy/LLM path twice (its own 2-attempt cap): `!digDown(...)` then `!moveAway(...)`, both unmappable to any real skill, both correctly discarded rather than dispatched as garbage. Decider gives up on this eid per its own designed retry-cap doctrine (avoids burning LLM budget forever on a persistently-unmappable episode) — logged verbatim: `giving up on episode dmtka4ans4 after 2 unusable Andy replies`.
3. Meanwhile the underlying `chopTrees` project (still running under its own steam, unrelated to the decider's two failed attempts) traveled far — its `maxDist:32` oak search apparently ranged wide — and landed at (-17,108,3), a ~250-block move from where the stall was first noticed.
4. From `16:00:05Z` onward, `chopTrees` fails `kit_missing` at that exact position repeatedly: 16:00:05, 16:00:37, 16:01:39, 16:03:39, then settling into a clean 5-minute cadence (16:08:39, 16:13:39, 16:18:39, 16:23:39, 16:28:39 — 9 occurrences inside the window, continuing past it per team-lead's later `/state` check).
5. The ladder's own rung sequence for every one of those 5-minute cycles is `RESTOCK -> IDLE -> PROJECT -> IDLE`, clockwork-regular, **no thrash** — RESTOCK genuinely fires every cycle and tries first, exactly as designed. It just never succeeds (can neither withdraw nor produce whatever the `excursion` kit tier needs — torches/food/weapon, unconfirmed which specifically), stands down gracefully per its own #37 doctrine (a real capability, not a bug), and PROJECT then retries the identical `chopTrees` call anyway, which immediately re-fails the identical kit gate. The LADDER is behaving exactly as designed at every individual layer; the OUTCOME is still a bot that cannot make progress.
6. Because `dmtka4ans4` never closed, agenda's own reopen-backoff (by design) never opens a fresh `project_stalled` episode on top of an already-open one for the same bot — so the 9+ repeats of the exact same kit_missing failure after the decider's give-up generated **zero further direction-episode activity of any kind**. Nothing — no rule, no LLM, no driver — ever looked at this again for the rest of the window. This is the literal mechanism behind the tool's own `*** DEAD-CONSUMER: open >30min, nothing ever answered it ***` tag.

**THIS IS A REAL, ACTIONABLE GAP, not a tuning miss**: every individual piece (RESTOCK's graceful stand-down, the decider's 2-attempt cap, agenda's reopen-backoff) is correct in isolation — the composition of all three correct pieces produces an episode that can rot open forever with nothing watching. Filed as felsenuboot/felcrew-mcp#95 (see below) rather than left as a soak footnote.

**Decider daemon health, checked directly per team-lead's second concern**: the daemon is genuinely alive, not dead — `decider-state.json`'s mtime matched the moment of my check almost to the second (still polling every ~20s as designed), and the process has run continuously since its 15:48:15.807Z startup with zero crash/restart in `ps`. The apparent "empty log" is because `decider.log` only writes a line when it makes an ACTUAL decision, not every poll cycle — nothing needed answering between 16:26:17Z (its last logged decision, for an unrelated bot) and the time of the check, which reads as silence but isn't death. Worth noting for next time: an idle decider and a dead decider look identical in the log alone; `decider-state.json`'s mtime (or a `ps`/pid check) is the actual liveness signal, not log activity.

**Fleet-context worth flagging**: `decisions.jsonl` also carries activity from a third bot, `SchlonzSchorsch` (not mine, not the soak's), serviced by the SAME shared decider daemon throughout this window. Since the decider's 30/hr LLM cap is fleet-wide, not per-bot, `SchlonzSchorsch`'s own decisions count against the identical budget EngineDreckDave draws from — worth keeping in mind when interpreting the cap headroom on any future grade run alongside other agenda-enabled bots.

**Numbers, for the record**: SR (verified) 85.7% [76.7-91.6%] n=84, FSR 0.0%, ladder coverage 58.5% [43.4-72.2%] n=41 (IDLE:17 PROJECT:12 RESTOCK:10 EAT:2 — RESTOCK's 10 firings this window is elevated, consistent with the repeated failed-restock cycle above), repeat cluster 9x kit_missing chopTrees at (-17,108,3) (matches the traced story exactly, not a separate finding).
fix: n/a — grading + diagnosis. bench/gates/direction-soak2.json (written verdict).
github: felsenuboot/felcrew-mcp#68 (posted), felsenuboot/felcrew-mcp#95 (new, the dead-consumer escalation gap)

### 2026-09-02 engine-dev-3 — #95 fixed: dirClose() closes a decider give-up instead of letting it rot open forever (agenda.js v24, decider.js)
type: fix + verification
status: the exact dead-consumer mechanism soak #2 hit is closed; full preflight green with 9 new regression cases; not yet re-verified in a live multi-hour soak (that's the next real test of this)
what: `closeEpisode` previously only ever fired through `A.setProject` (a real decision landed) or `markProductive` (self-recovery). Soak #2 traced the gap exactly: the decider tries its 2 Andy attempts, both come back unmappable, and it gives up WITHOUT ever calling `setProject` — so the episode just sits open, and `openEpisode`'s own single-latch (`if (d.episode) return`) then silently blocks every later stall detection from opening a fresh one, for as long as the condition persists (soak #2: 9+ repeat `kit_missing` failures over 30+ minutes, zero further direction-episode activity of any kind — exactly `metrics.mjs`'s own DEAD-CONSUMER alarm).

**Fix**: `A.dirClose(eid, closedBy)`, a new public API next to `dirDispatch` with the identical eid-CAS safety (a stale/already-answered eid no-ops) but a narrower effect — it closes the episode and arms the SAME per-`why` reopen backoff (30s→60s→120s→300s) every other close already uses, and does **NOT** touch `A.project`/`A.nextProject` at all. `decider.js`'s give-up branch now calls it (fire-and-forget over `/eval` — a failure just degrades to today's behavior, no new failure mode introduced). If the stall is still genuinely unresolved, `directionCheck`'s own level detector reopens a **fresh** episode once the backoff elapses, since `A.project` never changed — giving the decider (or a driver, or a future rule) another shot later instead of permanent silence. This is engine-dev's suggested direction 1 from #95 (escalate/retry rather than silently give up); directions 2 (a more specific `why` like `kit_deadlock` for repeated identical failures) and 3 (feed RESTOCK's own repeat-failure count into the direction layer) are left as follow-ups on the issue, not implemented here — this fix alone closes the specific "rots forever" bug, not the broader diagnostic-specificity question.

**Verification**: `bench/fixtures/agenda-direction.js` case 12 (9 sub-assertions, now 12 cases / 38 total in the file): stale-eid no-op, real-eid closes with the given `closedBy`, `A.project` is provably untouched (byte-identical JSON before/after, unlike `dirDispatch` which always changes it), the reopen backoff is armed, and — the part that actually proves the fix, not just the API shape — the SAME still-stalled project genuinely opens a **fresh** episode (a new id) once that backoff elapses. Also live-verified end-to-end through a real `/eval` round-trip using the EXACT code string `decider.js` constructs (`__agenda.dirClose(${JSON.stringify(eid)}, 'decider_exhausted')`), not just the pure fixture logic, to rule out any quoting/wiring bug between the two files. Full `bench/preflight.sh`: 196/196 (was 187, +9, zero regressions elsewhere).

Restarting the shared decider.js daemon to pick this up (it's a standalone process, not re-injected per-bot) — coordinated with test-driver first since it's live infrastructure serving gear-race run #3's RotzRudi concurrently; decider-state.json persists across the restart and every bot's own agenda ladder is fully independent of the daemon being up, so this should be a non-event for the race.
fix: agenda.js v24 (`A.dirClose`, ~line 1224). decider.js (give-up branch, ~line 377). bench/fixtures/agenda-direction.js (case 12, new).
github: felsenuboot/felcrew-mcp#95 (comment posted, fix landed)

### 2026-09-02 engine-dev — #94 distribution: 5/5 runs confirm a systematic BREAK_LOS near-death, not RNG
type: finding (distribution, follow-up to the #93 audit entry's 2-run observation)
status: n=5 now, pattern confirmed systematic
what: team-lead's follow-up ask — run `induced-stress-sequencing.sh` a few more times so #94's near-death
pattern has n>2 before anyone shapes a fix. Ran 3 more (fresh isolated bot KlammKlaus, 127.0.0.1:25599,
teleported 200 blocks from EngineDreckDave/eng-3's live #95 repro — needed `forceload add` first, a plain
`/tp` to an ungenerated chunk silently failed to move the client at all, matching the exact lesson #54's
own fixtures already learned the hard way). Kept exposure to the shared decider brief (stopped the bot
right after each run) per the "avoid drawing Andy calls if avoidable" ask.

**Full distribution, n=5 across both sessions**: 0.33, 0.17, 2.33, 0.33, 0.33 HP. Every single run correctly
fired BREAK_LOS against the real skeleton and showed **zero thrash** (criterion #3's own actual purpose —
correct sequencing under simultaneous stress — passes cleanly every time). Every single run also FAILED the
`hpMin<6` near-death check. This is no longer 2 data points that could be unlucky RNG: **5/5, median 0.33 HP,
is a systematic pattern.**
fix: n/a — distribution gathered, root-cause/fix work is the natural next step but not attempted here
(out of today's remaining scope).
github: felsenuboot/felcrew-mcp#94 (updated with the distribution)

### 2026-09-02 engine-dev-3 — soak-hygiene, round 2: a shared decider CAN'T just exclude the race, so it needs a soak-mode flag instead
type: design argument (per team-lead's instruction, before building)
status: argued here, then implemented (decider.js SOAK_BOT env var)
what: the DECIDER_EXCLUDE mechanism landed earlier today (spawn.sh 4th meta field, decider.js discoverBots()) solves a DIFFERENT problem than the one team-lead flagged as still soak-#3-blocking. DECIDER_EXCLUDE is for THROWAWAY bots that shouldn't be fleet work at all (the SchlonzSchorsch case) — excluding them from the decider is unambiguously correct, they contribute nothing real. Gear-race run #3's RotzRudi is not that: it's a genuine fleet bot doing genuine work, explicitly "Direction-Episodes era" — it is SUPPOSED to have decider support. Excluding it would just move the contamination the other direction (a race bot silently losing its own decider coverage instead of a soak silently losing measurement integrity), not fix anything.

**The actual risk to a formal soak's acceptance numbers, precisely**: decider.js's fleet-wide LLM cap (`fleetCapOk()`, 30/hr, ONE shared counter for every bot) means a concurrent race's own LLM calls compete with the soak bot's for the same budget. If the race consumes enough of the shared cap, the soak bot's own calls can get `skipped_cap`'d — not a measurement-accounting nuisance like the throwaway-bot case, but a DIRECT hit to the soak's primary acceptance criterion: a skipped call means the episode stays open longer, inflating direction-latency (p50/p90) for a reason that has nothing to do with the engine being measured. This is worse than SchlonzSchorsch's contamination, not just a repeat of it.

**Three options were on the table (team-lead's framing): a decider soak-mode flag, an ignore-list, or an OWNER-filter.** Argued choice: **soak-mode flag**, naming the ONE bot under formal measurement (`SOAK_BOT=<name>`), not the other two:
- **Ignore-list rejected**: would need to enumerate and maintain every OTHER bot that might compete (the race roster, any future throwaway, anything else spawned mid-window) — the wrong direction to describe a growing, open-ended set, and exactly the kind of list that silently goes stale (a new race bot spawned mid-soak wouldn't automatically be on it).
- **OWNER-filter rejected**: ownership already means something specific in this codebase (DRIVER_GRACE_MS — "does an owned bot's driver get first crack at its own episode") and reusing the same field to ALSO mean "is this bot exempt from fleet-cap contention" conflates two unrelated axes. RotzRudi is owned (by test-driver) and a future soak bot will also typically be owned (by whoever launches it) — the field can't distinguish "the one bot being measured" from "any owned bot" without inventing a second meaning for the same data.
- **Soak-mode flag (chosen)**: names the ONE bot that actually needs protection, symmetrically, in both directions — its own calls never count against the shared cap (so it can't itself contaminate an ordinary fleet run when soak mode isn't active — it's opt-in per decider-process-lifetime, not a standing state), and the shared cap never blocks it (so unrelated fleet/race activity can't inflate its measured latency). Everyone else, race included, keeps sharing the ordinary 30/hr cap exactly as before — this is surgical, not a wholesale redesign of the cap doctrine.

**Implementation**: `SOAK_BOT` env var, read once at decider.js startup. In the rate-gate step, `b.name === SOAK_BOT` bypasses `fleetCapOk()`'s check entirely and skips `recordFleetCall()` for that bot's own calls — full two-way isolation. Still bound by the existing PER_BOT_MIN_GAP_MS (≥120s between the soak bot's own calls) — this is cap isolation, not a runaway-LLM exemption. Belt-and-suspenders with team-lead's own plan to schedule soak #3 right after race #3 concludes anyway (windows shouldn't even overlap in practice) — this mechanism is what makes overlap SAFE if it ever does happen, not a reason to stop avoiding it.
fix: decider.js (SOAK_BOT env var + two isolation points in handleBot's rate-gate step).
github: felsenuboot/felcrew-mcp#95 (comment to follow once verified)

### 2026-09-02 engine-dev — #94 root cause found and argued (fix not yet built): BREAK_LOS's own critical-HP shortcut assumes a fallback that silently doesn't exist without filler blocks
type: finding + proposal (doctrine: argue before building)
status: root cause CONFIRMED from the 5 recorded runs' real telemetry, not guessed at; fix proposed below,
not yet implemented — posting for review per this file's own standing doctrine before touching survival.js
what: team-lead's #94 assignment — find WHERE the margin bleeds (reaction latency? wall-build time under
fire? re-engagement during the walk?), root-caused from the ledgers of all 5 recorded runs before staging
anything new.

**THE MEASUREMENT that broke the case open**: pulled every `panic` enter/recovered pair from both bots'
full ledgers (`ZoffZenzi`: n=217 pairs across 2 runs, `KlammKlaus`: n=376 pairs across 3 runs — every
single encounter, not a sample). **99% of ALL 593 panic cycles resolve in under 100ms** (median 31-36ms,
p90 44-46ms). That number is the whole finding: `branchBreakLOS`'s real work is never that fast — its own
corner-step phase issues an `ownedGoto` with a `Math.max(600, ...)` floor per attempt, and `placeBlock`
network round-trips run in the hundreds of ms per this codebase's own documented settle discipline. A
31ms "BREAK_LOS, recovered" cannot contain either. It can only mean every phase short-circuited on a
cheap synchronous check without ever awaiting a real action.

**THE EXACT MECHANISM, traced through the code against the timing evidence, not inferred from the number
alone**:
1. `branchBreakLOS`'s phase (a), corner-step (skills... `survival.js` line 344): `if (bot.health > 0 &&
   bot.health < g.cfg.hpPanic) break;` — checked at the TOP of the very first loop iteration, before any
   real search. Every recorded cycle in this dataset has `hp` already below `hpPanic(8)` at entry (the
   whole reason `onHealth`'s critical-HP lockout-bypass re-triggered `enter()` in the first place) — so
   phase (a) does **zero** real work on essentially every one of these 593 cycles. The `#65` comment right
   above this line says the intent plainly: "stop searching, go defend" — the corner-step search was
   deliberately made to yield FAST under critical HP on the assumption that phase (b)/(c) or the WALL_OFF
   fallback is a better, more certain use of the remaining time.
2. Phase (b), arrow-shadow, calls `placeAt()` — which itself starts with `const item = fillerItem(); if
   (!item) return 'no_filler';`, a synchronous inventory check with **no network round-trip**, returning
   near-instantly whenever the bot carries none of `g.filler` (cobblestone/cobbled_deepslate/dirt/
   stone/andesite/diorite/granite/nethernetherrack). The fixture strips pickaxe tiers but never gives
   filler, and none of my QA bots were separately supplied any — realistic for the class of bot this
   fixture is deliberately modeling ("toolless"), and #92's own forensics found the ORIGINAL run #2
   incident bot was similarly kit-deficient (out of food, no path to more), so an under-kitted bot hitting
   this exact branch is not a fixture artifact, it is the scenario this whole stress fixture exists to
   test.
3. Phase (c), counter-attack, gates on `bot.health >= g.cfg.rushHp` (12) — false on every recorded cycle
   (HP is below 8, let alone 12) — skipped.
4. The final fallback, `if (placed || bot.health < g.cfg.rushHp) { const w = await branchWallOff(t); ...
   }` — fires (health is always below rushHp here), calling into `branchWallOff`, which opens with the
   IDENTICAL `if (!fillerItem())` no-filler check (same synchronous, no-await, near-instant path) and
   returns `{sealed:false, reason:'no_filler'}` after a single chat line and an `ownedGoto` to the bot's
   OWN current position (a goal already satisfied, so it resolves in one tick).

**The assumption `#65`'s own fix made — "skip the search fast, something better is coming" — silently
stops holding the instant the bot lacks filler blocks, and NOTHING currently notices.** All three active
defenses (corner-step, arrow-shadow, counter-attack) AND the WALL_OFF fallback are simultaneously
unavailable in this state, and the reflex just re-diagnoses the identical, undefended situation every
~200-250ms (bound by dangerscan's own scan cadence and Minecraft's own damage-tick timing, not by
anything survival.js controls) while the real ranged attacker keeps landing real, completely unopposed
hits each cycle. That is the margin bleed, named precisely: **not latency at engagement start (the reflex
reacts in tens of milliseconds, which is fine), not a slow wall build under fire (there is no wall build —
it fails synchronously), but the compounding of "skip corner-step because a fallback is assumed" with "the
fallback silently degrades to a no-op without filler" — a bot with no filler blocks gets LITERALLY ZERO
seconds of active defense from the moment its HP crosses the critical threshold, for as long as the fight
lasts.**

**PROPOSED FIX** (survival.js, `branchBreakLOS`'s phase (a) — engine-dev-3's/my own survival.js lane,
posting the argument first per this file's own doctrine before touching the tree):

```js
// was: if (bot.health > 0 && bot.health < g.cfg.hpPanic) break;
if (bot.health > 0 && bot.health < g.cfg.hpPanic && fillerItem()) break;
```

Corner-step is the ONLY one of BREAK_LOS's three defenses (plus the WALL_OFF fallback) that needs **no
inventory at all** — just a nearby, genuinely safe, already-existing empty cell. The original `#65` skip
exists to prioritize a SURER, faster win (a wall/coffin) over spending the search budget — that reasoning
is sound exactly when a wall is actually buildable, and actively wrong when it isn't: skipping the one
thing that might work in order to fall through faster into two guaranteed no-ops is strictly worse than
trying it. Gating the skip on `fillerItem()` being available preserves the ORIGINAL behavior byte-for-byte
for any bot that's actually kitted (the common case — mining/hunting bots routinely carry cobblestone),
and only changes behavior for the specific, previously-invisible case this session's own telemetry proved
exists: a bot with none. Minimal, additive, one condition, no removal of any existing safety check.

**Why this doesn't regress anything already verified**: #92's WALL_OFF cannot-heal exit and standdown gate
are untouched (this edit is inside `branchBreakLOS`, several hundred lines from `branchWallOff`'s own
loop). #65's own verified branches (CREEPER, FLEE_HOME, the counter-attack sub-branch, the
`shieldUp`/`shieldDown` discipline) are untouched — this changes exactly one boolean expression's third
operand. Will re-run `bench/fixtures/survival-cannotheal.js` (7/7 today) after landing to confirm, and
re-run `induced-stress-sequencing.sh` live to see whether `hpMin` genuinely improves, not just assume it
from the code reading alone.

**What this fix does NOT claim to fix**: it does not make BREAK_LOS/WALL_OFF succeed against every
attacker — a bot with no filler AND no viable corner-step cell (fully open ground, or every safe offset
already occupied) is still defenseless, same as today; this closes the specific, measured gap ("skip a
free option because a paid one was assumed available"), not the general "no supplies = no options"
ceiling. That ceiling is a kit/logistics problem, not a reflex-logic one.
fix: proposed only in this entry — building next.
github: felsenuboot/felcrew-mcp#94 (root cause posted; fix to follow in a separate FEEDBACK entry once
built and verified)

### 2026-09-02 engine-dev — #94 fix landed and verified (survival v7): real HP improvement measured, mechanism only partly isolated, reported honestly
type: fix + verification
status: shipped, no regression, measured improvement confirmed live; one causal question left open rather
than guessed at
what: built the fix argued in the entry above (`branchBreakLOS`'s corner-step skip now requires
`fillerItem()` too, so it only defers to a fallback that can actually catch it) and verified it two ways.

**NO REGRESSION**: `bench/fixtures/survival-cannotheal.js` still 7/7 on the fresh bot post-injection (#92's
WALL_OFF logic is untouched by this change, confirmed not just assumed).

**LIVE RE-VERIFICATION, n=5 vs n=5, same fixture, same conditions**: reran `induced-stress-sequencing.sh`
five more times on a fresh isolated bot (`KaputtKord`, `DECIDER_EXCLUDE=1` per team-lead's standing
instruction, 200 blocks from both the live soak and the live race). **Post-fix distribution: 2.33, 0.33,
2.33, 2.17, 2.33 HP — median 2.33, vs the pre-fix n=5 median of 0.33 (0.33, 0.17, 2.33, 0.33, 0.33).** A
real, consistent, ~7x improvement in the worst-case margin. Every run still correctly fires BREAK_LOS with
zero thrash, and every run still fails the fixture's own `hpMin<6` criterion — this fix narrows the gap,
it does not close it (see the "what this does NOT fix" caveat in the proposal entry: a bot with no filler
AND no viable corner cell is still under-defended, same ceiling as before).

**HONEST GAP, flagged rather than papered over**: I could not fully isolate corner-step actually
succeeding as the mechanism behind the measured improvement, and I looked rather than assumed. Re-pulled
the same enter/recovered timing analysis against `KaputtKord`'s own post-fix ledger: **98% of cycles still
resolve in under 100ms** (median 27ms) — meaning corner-step's own loop still never found a QUALIFYING
offset (one where moving there would genuinely break LOS) in this specific fixture's arena, which is a
flat, roofed, cornerless platform by design (nothing to duck behind, on purpose, so wild mobs can't join).
The fix removes the SKIP; it can't manufacture geometry the arena doesn't have. So the measured HP
improvement in this exact test is real but its precise causal path isn't nailed down by this session's
evidence — plausible contributors not disentangled here: (a) the corner-step loop now genuinely running
its checks (8x blockAt+losBlocked) adds real but small wall-clock per cycle that could shift Minecraft's
own damage-tick alignment slightly, (b) run-to-run position/timing variance this fixture doesn't fully
control for, or (c) some other secondary interaction. What IS fully verified, by direct code reading (not
inferred from the aggregate number): the fix is a strict widening — it can only make corner-step MORE
likely to be attempted, never less, and changes nothing for any bot that carries filler blocks (the common
case). It is landed on that basis plus the measured, repeatable, non-regressive HP improvement, not on a
fully closed causal story for this one fixture's specific (deliberately cornerless) arena.

**Cleanup**: killed the test skeleton, removed the temporary corner-wall geometry I'd built for a separate
controlled corner-step check (inconclusive on its own — the geometry I improvised didn't actually sit
between the bot and the threat correctly; not worth further time given the fixture-level result already
stands on its own), removed the forceload ticket, stopped `KaputtKord`.

**What's still open for #94**: the fixture's own worst case (no filler, no corner-friendly geometry) still
ends every encounter under 3 HP. Closing that fully needs either giving BREAK_LOS a filler-independent
LAST resort beyond corner-step (there may not be one that's safe — pillaring up needs placement too), or
accepting that a genuinely unkitted bot facing a ranged attacker in the open is a kit/logistics failure
this reflex was never going to fully solve on its own, and leaning harder on kit-preflight (departing
half-kitted is already supposed to be blocked) to keep bots out of this state in the first place rather
than expecting the reflex to compensate for it after the fact.
fix: survival.js (v7: `branchBreakLOS`'s corner-step gate, line ~344).
github: felsenuboot/felcrew-mcp#94 (fix landed and reported; leaving open pending a maintainer call on
whether the remaining "no filler, no corners" ceiling needs its own follow-up issue)

### 2026-09-02 team-lead (doctrine, from #94's root cause) — a branch may only defer to a fallback it has VERIFIED can act; an unverified deferral is a disablement
type: doctrine
status: recorded — second sighting of this exact shape in one day, makes it a class
what: naming the general failure form behind #94 (survival.js's `branchBreakLOS` skipping its own
filler-independent corner-step search under critical HP, trusting arrow-shadow/WALL_OFF to cover the
gap — both of which silently no-op without filler blocks, leaving the bot with zero active defense) and
recognizing it as the SAME shape as #95 (the decider's own composition rot: RESTOCK's graceful
stand-down, the decider's 2-attempt give-up, and agenda's reopen-backoff are each individually correct,
and their handoff between each other silently produces an episode that rots open forever). Both are
"composition rot": every individual piece is correct in isolation, and the bug lives entirely in an
UNCHECKED assumption at the handoff between two pieces — one component defers to another without ever
confirming the other can actually act in the current state.
**The doctrine**: a branch (or rung, or daemon) may only defer to a fallback it has VERIFIED can act
right now — checking the fallback's own precondition before skipping its own cheaper/slower path, not
just assuming "something better is coming." An unverified deferral is not a shortcut, it is a
disablement wearing a shortcut's clothing. Two sightings in one day (#94, #95) is enough to call this a
class rather than two unrelated coincidences — worth a deliberate sweep of other defer/fallback
relationships in this codebase (recovery ladder rungs, kit-tier fallbacks, RESTOCK's own
withdraw-then-produce chain) the same way the #91 "every iterative search needs an anchor" doctrine
prompted a sweep of `findBlocks`-in-a-loop call sites.
fix: n/a — doctrine note. See #94 (survival v7, commit 805b657) and #95 (open, engine-dev-3's lane) for
the two shipped/diagnosed instances.
github: felsenuboot/felcrew-mcp#94, #95 (cross-reference)

### 2026-09-02 test-driver — elevated isolated-platform stranding (new wedge, distinct from #89's underground case)
type: bug
status: open
what: Gear-race run #3 (RotzRudi, world-race3): after 3 rapid deaths to Zombie (vanilla drops
full inventory on each death, and by the 3rd death the bag was permanently empty), the server
relocated the bot's respawn point to (-2.5,109,~3-4) — a single isolated `acacia_leaves` block
floating in open air, 5-6 blocks straight down to the nearest ground with nothing to land on
partway. The fleet's default pathfinder `Movements` caps a single drop at `maxDropDown:3`, and with
zero inventory to bridge/tower with, NO legal skill (`chopTrees`, `mineLane`, a direct `come` to
ground level) could move the bot even one block. The existing `ascendToSurface`/ESCAPE rung (v21,
#89) is scoped to underground sealed pockets and never triggered here (this isn't underground,
`surfaceExposed:true`). Separately, the spot was permanently dark (`light:0`, no torches ever) and
mob-attractive, and at the moment of conclusion a creeper sitting 3.3-3.5 blocks away — unable to
path up onto the platform, but visible to `dangerscan` across the gap — kept `danger.state` pinned
at `"panic"` continuously, which appears to hold `REFLEX` from ever handing control back to
`PROJECT`: every project set after the 3rd death sat with `task:null` indefinitely, never even
attempting a move. Result: DEAD RACE = DEAD STOP invoked, ~19 consecutive dead minutes, DNF at
stone_pickaxe despite a clean 3m42s wooden pickaxe earlier in the same run. Full narrative in
SCOREBOARD.md's run #3 conclusion.
Separately noted, not yet explained: 24 cobblestone was mined at 19:42:09 but WALL_OFF reported
`kit_violation: no filler blocks` at 19:46:34 with no logged consumption in between — possible
inventory-accounting gap, flagging rather than guessing.
fix: (1) generalize the "stuck, no legal path" detector so it isn't underground-scoped — e.g. if N
consecutive project attempts across ANY skill produce zero position delta and zero task start,
promote to ESCAPE (or a new rung) regardless of y-level/surfaceExposed. (2) decider retry logic
should track "did this exact skill+args already fail from this exact position" and reposition (or
escalate with a distinct `why`) instead of re-dispatching an identical failing call — this run saw
3 straight identical `chopTrees{types:oak,maxDist:32}` dispatches from a frozen position before I
intervened. (3) `danger.state` staying pinned at `"panic"` against a threat that cannot path to the
bot blocks REFLEX indefinitely — a reachability check before an unreachable-but-visible threat
holds the ladder hostage would close this. (4) consider whether vanilla's respawn-point relocation
(triggered by the bot's own mining/chopping disturbing the original spawn's safety) should be
guarded against landing on a floating/unsupported block at all.
github: felsenuboot/felcrew-mcp#97 (filed)

### 2026-09-02 engine-dev — composition-rot sweep (audit-only, per team-lead's assignment): one real finding, several handoffs confirmed clean
type: audit
status: AUDIT-ONLY, nothing built — findings enumerated, fixes to be argued separately per doctrine
what: swept every defer/fallback handoff named in the assignment for the #94/#95 "unverified deferral is
a disablement" shape — for each, asked "does A verify B can act, or assume it?"

**1. survival.js `branchBreakLOS` -> WALL_OFF fallback.** ALREADY FIXED (#94, v7): corner-step now checks
`fillerItem()` before deferring to the wall/coffin fallback. Reference case for this whole sweep.

**2. survival.js `pick()` -> `branchFleeHome` routing. REAL FINDING, not yet fixed.** `pick()` selects
FLEE_HOME purely on straight-line distance (`dHome <= fleeHomeMax`, survival.js ~700-701) — no reachability
probe of any kind before committing. `branchFleeHome`'s own `ownedGoto` has a real 30-second timeout, but
that is discovered-after-the-fact, not verified-before-choosing: a bot 35 blocks from home in a straight
line but genuinely blocked by terrain/water/a cliff will spend up to 30 seconds finding that out while
still exposed to whatever melee threat triggered the flee in the first place. This codebase already has
the exact tool for a cheap pre-check (`_reachOf`, the ~2s no-movement `getPathTo` probe reused by
`craftToolChain`'s wood-gather ordering and `resolveContainer`'s tablePos check per #70) — FLEE_HOME's
routing decision doesn't use it. Same shape as #94, not yet argued into a fix (that's the next step, per
doctrine — proposal before building).

**3. survival.js `branchCreeper`.** No deferral at all — self-contained retreat with its own live
distance-improving verification loop every 250ms. Not at risk of this shape (nothing to defer TO).

**4. agenda.js RESTOCK's own withdraw -> produce -> stand-down chain.** CLEAN. Checks the actual `.ok`/
`.short` result of each step before deciding the next one (`rr.ok`/`rp.ok`/`rp._transient`), and reports
an honest `'refused'` rather than assuming success when nothing is withdrawable or produceable. This is
the reference example of the doctrine done RIGHT.

**5. agenda.js ESCAPE rung.** CLEAN. `act()` checks `r.ok`/`r._transient` before claiming progress, and —
notably — its `clear()` condition requires `surfaceExposed !== false` (the SAME independently-verified
sky-exposure check other code paths use), not "ascendToSurface reported done." Outcome-verified, not
self-report-trusted.

**6. skills.js `ensureTool`'s depot -> craft -> acquisition_failed chain.** CLEAN. Every step
(`if (got)`, `if (r.ok)`) gates on its own real, checked result; escalates through tiers on confirmed
failure only; ends in an honest `acquisition_failed` rather than a false positive. Another reference
example.

**7. skills.js `gotoR`'s R2 reposition -> goto retry.** NOT the composition-rot shape, on inspection —
this one is a DELIBERATE, ARGUED design choice (the comment states outright: "retry the goto regardless
(a fresh A* from here may route even if we barely moved)"), and it is ALREADY instrumented specifically
to check whether that assumption holds (`displaced` is split out in the ledger precisely so this can be
measured, not trusted blind). It already had its own dedicated investigation thread — this is #54, closed
today (v58, `_reposition` now clears inherited control state and waits for `onGround`). Distinguishing
this from true composition rot matters: an assumption that is explicitly named, instrumented, and being
actively tested is a hypothesis under test, not a silent disablement.

**8. agenda.js decider give-up -> `dirClose` -> reopen-backoff -> fresh episode (post-#95).**
CLEAN, and already self-verified by its own author: `bench/fixtures/agenda-direction.js` case 12
specifically proves "the same still-stalled project genuinely opens a fresh episode once the backoff
elapses," live-verified through a real `/eval` round-trip, not just asserted from the code. This is
exactly the check team-lead asked for in this sweep, and it was already done as part of landing #95.

**Kit-tier fallbacks, broader category**: `effectiveKit`'s `roleWorkKit` fallback and `payableTier`'s
own "what can actually be paid for, not what's cheapest on paper" logic (both cross-referenced in #84's
FEEDBACK history) were the ORIGINAL instances of this exact doctrine being applied, predating #94/#95 —
re-reading them now, both already gate on real, checked affordability/ownership rather than assumed
availability. No new gap found there.

**Net result of the sweep**: 1 new, real, unfixed finding (#94's own FLEE_HOME sibling — filed separately,
see below), 6 handoffs confirmed clean by direct reading (not assumed clean), 1 deliberately-instrumented
assumption correctly distinguished from silent disablement. The sweep's value is exactly what the #91
anchor-doctrine sweep's was: knowing the boundary of the problem, not just the two instances that found it
the hard way.
fix: n/a — audit only, per assignment. FLEE_HOME's reachability gap filed as #98 (fix to be argued
separately before building, same doctrine as #94).
github: felsenuboot/felcrew-mcp#98 (new, FLEE_HOME finding), cross-reference #94, #95, #54, #91

### 2026-09-02 engine-dev — #98 fix proposed (not yet built): wire the existing _reachOf probe into FLEE_HOME's routing
type: proposal (doctrine: argue before building)
status: argued here, building next in this same session
what: #98's finding — `pick()` chooses `branchFleeHome` on straight-line distance alone
(`dHome <= fleeHomeMax`), with no check that home is actually reachable. `branchFleeHome`'s own
`ownedGoto` carries a real 30-second timeout, but that only discovers unreachability AFTER the bot has
already committed to it, exposed to whatever melee threat triggered the flee the whole time.

**Proposed fix, minimal and reusing what already exists rather than reimplementing it**: this codebase
already has the exact probe needed — `_reachOf(bot, p)` in skills.js (used today by `resolveContainer`'s
`tablePos` check and, via the `ctx.reachable` wrapper, `craftToolChain`'s wood-gather ordering per #70):
a pure `bot.pathfinder.getPathTo(WORK_movements, GoalNear(p,2), 2000ms)` search, no movement, strict
`status==='success'` only (a `'partial'` is treated as NOT reachable, matching the same "checker must
match the executor" discipline #70 established). It is currently private to skills.js. Two changes:

1. **skills.js**: expose it as `S.reachOf = _reachOf;` (zero new logic — the exact same function, made
   callable from another independently-injected payload the same way `S.recoveryDetect` already is).
   Team-lead's coordination note applies here directly: eng-3's own #97 fix (reachability-before-REFLEX-
   pins) will likely want this identical probe from a different file — exposing the ALREADY-PROVEN
   function once, rather than two independent reimplementations drifting apart over time, is the "share
   one idiom" ask made concrete. Flagging this export to eng-3 directly so they can reuse it rather than
   rebuild it.
2. **survival.js**: a `homeReachable()` wrapper that calls `S.reachOf(bot, g.home)` if `skills.js` is
   installed, and — matching this file's own established "requires: skills.js (optional)" degradation
   posture — **fails OPEN (treats home as reachable) if skills.js is absent**, since a false "unreachable"
   from a missing optional payload would silently disable FLEE_HOME entirely rather than degrade
   gracefully to today's behavior. `pick()`'s FLEE_HOME routing (both the meleeOnly-threat case and the
   "hurt, no visible threat" case) gates on this check; when it fails, `pick()` falls through to
   `branchWallOff` — the next thing it would try anyway, not a dead end.

**Why this is safe and matches the #94 pattern exactly**: additive, one new gate on an EXISTING routing
decision, zero change to any branch's own internal logic (BREAK_LOS, CREEPER, WALL_OFF, and
`branchFleeHome` itself are all untouched). For a bot whose home genuinely IS reachable — the overwhelming
common case — behavior is unchanged except for one extra ~2-second, no-movement path search before
committing, which is a clear net win against a 30-second wasted commitment when it isn't. Verification
plan: re-run `bench/fixtures/survival-cannotheal.js` (must still be 7/7, #92 untouched) and the #94 fixture
(`induced-stress-sequencing.sh`, which doesn't touch FLEE_HOME's routing but exercises the same file —
must not regress), plus a new fixture case proving both directions live: home-reachable still routes
FLEE_HOME as before, home-walled-off routes elsewhere without burning the 30s.
fix: proposed here; building next.
github: felsenuboot/felcrew-mcp#98

### 2026-09-02 engine-dev-3 — #97 (one of three findings) fixed: REFLEX no longer deadlocks forever on a threat that's visible but unreachable
type: fix + verification
status: verified three independent ways (dry-run wiring, live stateful tracking, live end-to-end through the real tick()); the other two findings in #97 (generalized stuck-detector beyond underground, decider retry-tracking of identical failing dispatches) NOT attempted here -- scoped out, see below
what: picked up test-driver's #97 handoff (RotzRudi, gear-race run #3). Live diagnosis first: by the time I looked, RotzRudi was actually already off the isolated platform (test-driver's own manual `come` intervention had already moved it onto real ground — `onGround:true`, extensive walkable terrain nearby) — so the ORIGINAL "isolated platform, no legal path" incident (finding #1 in #97) is now historical, not something I could still reproduce live to fix with confidence. What WAS still reproducing live, right now, unprompted: `danger.state:"panic"` pinned continuously (score 6.66, two zombies at d~3.2-3.4 with `los:true`) while `survivalActive:false` the whole time and health genuinely stable across repeated polls — exactly finding #3 from the issue.

**Root cause, confirmed by reading the code, not guessed**: dangerscan's panic score is LOS-based (a cheap raycast "wallhack" scanner, correct and deliberate — see its own header, "sees the zombie in the sealed cavity BEFORE the bot digs into it"), with zero reachability check. Two zombies 3+ blocks straight down across open air have unobstructed LOS but cannot climb up — dangerscan correctly can't tell the difference, by design. `REFLEX`'s old `fire()`/`clear()` (agenda.js) read raw `dangerState` alone: `fire: (s) => s.survivalActive || s.dangerState === 'panic'`. Since dangerState never left 'panic' and survival.js correctly never engaged (nothing productive to physically do about an unreachable threat), REFLEX fired every tick forever and its own `act()` just does `clearActiveTask(); return 'yield'` — accomplishing literally nothing while blocking the ENTIRE ladder from ever reaching PROJECT/IDLE/anything else. This is the precise mechanism behind test-driver's ~19 consecutive dead minutes.

**Fix, deliberately conservative** (REFLEX is `safety:true` — the risk of a "helpful" fix ever letting the ladder resume while a REAL threat is actually landing hits outweighs the cost of a slower fix): rather than touch dangerscan's scoring (any reachability heuristic risks a false negative on a genuinely climbing/pathing threat, which is strictly worse than the current bug), `sense()` now tracks an unbroken "panic AND survival not active" streak (`s.panicStale`), requiring **two independent corroborating signals** before REFLEX ever stands down on a still-panicking read: a sustained window (`PANIC_STALE_MS` = 20s) **and** zero health lost during that entire window (positive evidence nothing is landing hits, not just elapsed time papering over a slow-burn fight). Either signal breaking — state leaves panic, survival.js engages, or a hit lands — resets the streak immediately, no partial credit. While survival.js IS active, or panic is fresh, behavior is byte-identical to before.

**Verified three ways, deliberately not just one**: (1) `bench/fixtures/agenda-ladder.js` dry-run cases proving REFLEX's fire/clear correctly obey an injected `panicStale` — necessary because `sense(inject)` short-circuits before the stateful tracking runs at all (by design, a dry run must be time-independent), so this only proves the WIRING, not the tracking; (2) new `bench/fixtures/reflex-panic-stale.sh`, live, real wall-clock time: sustained idle-panic goes stale at exactly 20s (matching `PANIC_STALE_MS` precisely), while a health drop or survival engaging partway through correctly keeps it non-stale through the identical window — proving the TRACKING logic itself, not just that something downstream would honor the field; (3) a live end-to-end check through the REAL running `tick()` (not manual `sense()` calls, the actual production path): `/state.agenda.rung` showed REFLEX held continuously for the full ~20+ second window (safety behavior genuinely preserved, not rushed) then transitioned to IDLE entirely on its own once confirmed stale. Full preflight: 199/199 (was 196, +3).

**Scoped OUT of this fix, on purpose, left open on #97**: (a) the generalized "stuck, no legal path" detector beyond underground (finding #1) — the live specimen had already self-resolved by the time I looked, so I have no live case to design/verify against right now, and this is a genuinely bigger design question (what recovery action even makes sense for a bot with zero inventory on an isolated platform — a survivable-fall-damage escape needs its own reasoning, not a quick patch); (b) decider retry-tracking of identical failing dispatches (finding #2) — this is the same shape as `#95`'s two HELD follow-ups (team-lead's ruling: let soak data justify them rather than building speculatively), so I'm treating this as evidence toward that same decision rather than a separate unilateral build; (c) guarding vanilla respawn-point placement (finding #4) — out of the bot engine's control by construction, not attempted.
fix: agenda.js v25 (`sense()`'s panic-idle tracking ~line 288, `PANIC_STALE_MS` ~line 42, REFLEX rung ~line 612). bench/fixtures/agenda-ladder.js (3 new cases). bench/fixtures/reflex-panic-stale.sh (new).
github: felsenuboot/felcrew-mcp#97 (comment to follow; issue stays open for findings #1/#2/#4)

### 2026-09-02 engine-dev — #98 fix landed and verified (survival v8 / skills v59): both directions live-proven, no regression
type: fix + verification
status: shipped, no regression, both directions of the reachability gate proven live with real geometry
what: built the fix argued in the entry above — `S.reachOf = _reachOf;` exposed in skills.js (v59, zero
new logic, the exact existing probe made callable from another payload), and `pick()`'s FLEE_HOME routing
in survival.js (v8) now gates on `homeReachable()` before committing, falling through to `branchWallOff`
when it fails.

**NO REGRESSION**: full `bench/preflight.sh` 199/199 on a fresh bot post-injection (skills v59/survival
v8), including `survival-cannotheal.js` (7/7, #92 untouched) and everything else in the suite.

**BOTH DIRECTIONS LIVE-VERIFIED, not just code-reasoned**, with a new permanent fixture
(`bench/fixtures/flee-home-reachability.sh`): built two real geometries off the bot's own current
position — an open, connected platform (home genuinely reachable) and a fully sealed box at the same
straight-line distance class (home NOT reachable) — pointed `__survival.home` at the open one, fabricated
the identical melee threat both times, and triggered the REAL `enter()`/`pick()` via `g.trigger()` (not a
`drill()` override, same discipline as `survival-cannotheal.js`'s Section B).
- **Home reachable**: `FLEE_HOME` fires, ~2.1s of REAL travel (position genuinely moved toward home) —
  unchanged behavior for the common case.
- **Home sealed off, same distance class**: falls through to `WALL_OFF`, resolving in 10-48ms — no 30-
  second commitment burned finding out the hard way. 2/2 repeat runs, both clean.

**One honest note on testing conditions**: the local test server's configured `home` (from
`protected.json`, the real production fleet anchor) is literally floating air on THIS server — the actual
base/plaza only exists on the production/cavecrew server. Discovered this while setting up the positive
case (a straightforward "teleport near home" attempt kept reporting `reachable:false` even a few blocks
away, which briefly looked like a bug in the fix before I checked `bot.blockAt` on `protected.json`'s own
home coordinates and found air). Worked around it by overriding `__survival.home` to a real, built platform
for the test rather than assuming the configured value corresponds to real terrain on every server — worth
remembering for anyone else testing FLEE_HOME specifically on the local server rather than production.

**Shared idiom, coordinated per team-lead's instruction**: messaged engine-dev-3 directly that `S.reachOf`
now exists on `skills.js` (v59) specifically so their own #97 fix (reachability-before-REFLEX-pins) can
call the identical, already-proven probe rather than building a second one that could drift from this one
over time.
fix: skills.js (`S.reachOf`, v59), survival.js (`homeReachable()` + `pick()`'s FLEE_HOME gate, v8),
`bench/fixtures/flee-home-reachability.sh` (new).
github: felsenuboot/felcrew-mcp#98 (fix landed and reported)

### 2026-09-02 engine-dev-3 — #97 bonus mystery resolved: the 24 cobblestone were not leaked, they were spent as WALL_OFF filler across a rapid triple-death encounter -- but that same window shows a distinct, real pattern worth someone's attention
type: investigation (traced from the ledger, not guessed)
status: closed as "not a bug" for the accounting question; a related pattern flagged for the survival.js lane, which is already actively iterating in this exact area (#94/#98)
what: team-lead's item 4 -- 24 cobblestone mined ~17:42:09Z, zero held at WALL_OFF's `kit_violation: no filler blocks` at ~17:46:34Z, no logged consumption in between. Traced RotzRudi's own ledger (`logs/metrics-RotzRudi.jsonl`) minute-by-minute rather than guessing:
- 17:42:09Z-17:45:01Z: cobblestone genuinely climbs 24 -> 25 -> 26 (incidental drops picked up during unrelated `produce` runs) and stays flat at 26 through 17:45:33Z and 17:46:03Z -- no loss yet.
- 17:46:31Z onward: a `panic phase:'enter' branch:'hp'` at hp:7, then hp:4.5, then **three separate `death` events** at 17:46:37Z, 17:46:54Z, and 17:47:05Z (pos drifting -3,104,5 -> -2,106,5 -> -4,105,5 -- the bot kept respawning back into the same multi-zombie mess). The very first `task_start` after the FIRST death (17:46:39Z) already shows `inv:{}`, `held:null` -- completely empty, vanilla drop-on-death, exactly as expected.
- So the kit_violation logged at 17:46:34Z sits 3 SECONDS before that first death, while the bot was still alive but already critical (hp 4.5) -- meaning the cobblestone was gone from a DIFFERENT, legitimate sink before the death ever happened: `branchWallOff` (survival.js) places up to ~13 cobblestone per full seal attempt, and the SAME window shows many `panic phase:'recovered' branch:'WALL_OFF'` records firing in extremely tight succession (six within a single logged second at 17:46:53Z alone) -- consistent with roughly two wall-off attempts spending the ~24-26 held cobblestone before the third attempt found the kit genuinely empty. **Not a leak: filler is a designed consumable, and it was consumed as designed, repeatedly, until it ran out.**
- **The pattern actually worth flagging**: those "recovered" events aren't one wall-off completing normally -- they're firing in rapid enter/recovered pairs (danger re-triggers immediately after each declared recovery), each apparently bailing early at critical HP per `branchWallOff`'s own `CRIT` threshold (its comment: "bail on NON-essential remaining cells... once health crosses this floor"). The bot took THREE deaths in under 30 seconds despite WALL_OFF being its designated coffin-defense the whole time -- that's a defense mechanism cycling too fast to actually defend, not a resource-accounting bug. This is squarely survival.js's active lane (engine-dev, mid #94/#98 iteration on WALL_OFF/near-death patterns already) -- flagging rather than diagnosing further myself, since they have newer context on this exact code than I do and are already deep in it.
fix: n/a -- investigation only, no code change. The accounting question is closed; the rapid-cycling pattern is routed to engine-dev's lane, not built here.
github: felsenuboot/felcrew-mcp#97 (comment to follow)

### 2026-09-02 engine-dev-3 — #97 items 2/3: design arguments before building, per team-lead's standing instruction
type: design argument
status: item 3 argued here then built same session; item 2 argued here, DEFERRED (not built) -- explaining why below
what: team-lead's remaining #97 priority order.

**Item 3 (decider re-dispatch gap) -- building this.** test-driver's live evidence: three
identical `chopTrees{types:oak,maxDist:32}` dispatches from a frozen position. Design choice:
track, per bot, the position+why+lastError signature at the moment of the LAST dispatch
attempt (`state.lastAttempt[bot]`). Before consulting rules.json OR spending an Andy call for
a new episode, compare the CURRENT position+why+lastError against it. If all three are
unchanged (bot hasn't moved, same stall reason, same underlying error) -- nothing observable
about the situation has changed since the last attempt -- skip the decision entirely (saves
the LLM call too, not just the wasted dispatch) and close the episode via **the SAME
`dirClose` API #95 already built** (`closedBy:'frozen_repeat'`), rather than either
blindly re-dispatching an identical failing call or leaving the episode open. This reuses
existing, already-verified machinery (dirClose + reopen backoff) instead of inventing new
agenda-side taxonomy -- deliberately the NARROW fix, not #95's held items 2/3 (a more
specific `why`, RESTOCK's own repeat-count fed into direction). Test-driver's field evidence
here is real and independent of soak #3, but I'm not treating it as grounds to unilaterally
unhold those two bigger, agenda-side changes -- that's still team-lead's call once soak #3's
numbers are in, per their explicit ruling on #95. This is decider.js-only, low blast radius,
verifiable in isolation the same way SOAK_BOT was (no live bot needed to prove the tracking
logic, only the wiring into a real dispatch needs a live check).

**Item 2 (generalize stuck/ESCAPE detection beyond underground) -- deferring, not building
blind.** Two reasons, both real, not just caution theater:
1. **No live specimen anymore.** RotzRudi had already self-recovered onto real ground by the
   time I looked (test-driver's own manual `come` intervention worked before I started
   diagnosis) -- there is currently no live bot anywhere in the fleet actually stuck on an
   isolated platform to verify a fix against, the same problem #54's fix avoided by using
   KrachKuddel's preserved staged wedge. A staged fixture is buildable (I did exactly this for
   #54's `reposition-cleanstate.sh`), but this needs to happen BEFORE the fix ships, not after.
2. **Detection alone doesn't close the gap -- the missing piece is an ACTION, and that action
   is safety-critical.** `ESCAPE`'s existing act() (`ascendToSurface`) is wrong for this case
   -- the bot is already at/above the surface; going UP doesn't help. The only thing that
   COULD help with zero inventory is a controlled, deliberate fall onto real ground, accepting
   survivable damage (Minecraft fall damage is safe up to 3 blocks, then ~1 HP/block beyond
   that -- RotzRudi's actual 5-6 block drop would have cost roughly 2-3 HP, comfortably
   survivable at the health it had). But `findRepositionTarget`'s existing candidate search
   (the SAME one `_reposition`/ESCAPE already use) only scans `by+1` down to `by-3` --  a
   5-block window that would NOT have found RotzRudi's actual landing spot at all, so this
   isn't a matter of relaxing `surfaceExposed`'s gate on the EXISTING mechanism; it needs a
   genuinely new search (find the nearest edge with an ACCEPTABLE-damage drop within some
   travel radius, verify the landing isn't lava/void/a mob's melee range) and a new skill to
   execute it. A wrong fall-damage calculation, or a landing check that misses standing water
   vs. lava, is the kind of bug that KILLS the bot it's meant to save -- worth building
   carefully against a real staged repro, not shipping from reasoning alone. **Proposing, for
   whoever picks this up next (myself included, once I've staged the fixture) rather than
   building now**: a new `emergencyDescend`-class skill (survivable-fall search + execute),
   triggered by a NEW, underground-independent detection arm on ESCAPE (or a sibling rung) that
   fires when N consecutive project-start attempts across ANY skill produce zero position delta
   and zero task start -- matching test-driver's own suggested detector shape exactly, just
   without the `surfaceExposed` gate. Will stage the fixture and come back to this rather than
   leave it as a permanent gap.
fix: item 3 built this session (see the commit immediately following this entry). Item 2 is a
proposal only -- no code change yet.
github: felsenuboot/felcrew-mcp#97 (comment to follow, both items)

### 2026-09-02 engine-dev — RotzRudi's triple-death: #96's "no filler, no defense" ceiling confirmed in the field, not just a QA fixture (via a path #94 doesn't cover)
type: finding
status: root cause confirmed from the real gear-race ledger; NOT fixed here — escalating #96 with field evidence, doctrine says argue before building and this needs a real design call first
what: engine-dev-3 flagged `logs/metrics-RotzRudi.jsonl` (real gear-race run #3, ~17:46:23Z-17:47:05Z):
`panic phase:'recovered' branch:'WALL_OFF'` firing in extremely tight succession (six within one logged
second at 17:46:53Z) with `danger` re-entering panic immediately after each declared "recovered", three
real `death` events inside 30 seconds.

**Confirmed mechanism, same signature as #94's own diagnostic method applied to this new ledger**: every
one of these `enter`->`recovered` cycles resolves in 20-30ms (e.g. 17:46:53.512->17:46:53.539 = 27ms) —
exactly the same "too fast to be real construction" fingerprint #94 measured across 593 cycles. Cross-
referenced against `task_end` records: cobblestone was genuinely mined (24 at 17:42:09, +1 at 17:42:51,
+1 at 17:44:58 — 26 total, never replenished again before the death sequence at 17:46:23+). Engine-dev-3
independently confirmed via their own #97 investigation that WALL_OFF legitimately spent this filler
across ~2 real seal attempts earlier in the same encounter, not a leak. By the time we reach THIS ledger
segment, filler is exhausted, and every subsequent `branchWallOff` call hits the same synchronous
`fillerItem()` no-filler bail #94 found — zero real construction, zero protection, ~20-30ms per cycle,
while the attacking mob keeps landing real hits every cycle.

**Why #94's fix does NOT cover this case — the actually new part of this finding**: `pick()` only ever
reaches `branchBreakLOS` (where #94's corner-step fix lives) via its `ranged && los` check. RotzRudi's
attacker throughout this segment is consistent with a MELEE threat (danger's own `threats` entries in
this window carry no `ranged:true`) — `pick()` never routes a melee threat through BREAK_LOS at all. The
melee `FLEE_HOME` path requires `bot.health >= 6`; once HP crossed below that (5.33 -> 2.83 -> 0.33 across
this exact segment), that gate closes too, and `pick()` falls straight to `branchWallOff(nearest)` with
**no intermediate branch, no corner-step opportunity, nothing #94 touches**. A melee attacker against a
sub-6-HP, filler-less bot has ZERO possible active defense today, by construction — not a bug in any one
branch, but a genuine gap in the routing table itself.

**This is #96, field-confirmed, not hypothetical.** #96 (filed today, "last-resort defense for a
genuinely unkitted bot") was framed around QA-fixture evidence with an open question — "may be testing a
state well-kitted bots practically never enter." This incident answers that question: a real fleet bot,
mid-race, doing completely ordinary things (mining pickaxe upgrades, producing sticks/torches) ran its
filler down over the course of a normal encounter and hit this exact ceiling live, three times, fatally.
Updating #96 with this evidence rather than filing a duplicate — the design question it already poses
(filler-independent last resort vs. leaning harder on kit-preflight/mid-encounter resupply awareness) is
the same question, now with a body count instead of a fixture number.

**Not fixed here, deliberately**: this needs a real design decision (does corner-step's LOS-breaking
value generalize usefully to melee threats too, despite melee not caring about sightlines the way a
skeleton's arrows do? does FLEE_HOME's `health>=6` gate need an exception when the alternative is
provably zero defense? does WALL_OFF need to warn a driver/decider BEFORE filler actually runs out rather
than only reporting the violation after the fact?) rather than a narrow one-line patch like #94/#98 — per
this file's own "argue before building" doctrine, that argument belongs on #96 as a maintainer decision,
not something to rush from a teammate flag mid-soak.
fix: n/a — diagnosis only, escalating #96.
github: felsenuboot/felcrew-mcp#96 (updated with field evidence), cross-reference #94, #97

### 2026-09-02 engine-dev-3 — #97 item 3 built: decider skips an identical dispatch from a frozen position
type: fix (verified in isolation; live wiring deliberately deferred)
status: logic built and isolation-verified; NOT yet exercised against the live decider process on purpose -- soak #3 is using that shared daemon right now
what: implemented the design argued two entries up. `decider.js` now tracks `(position, why, lastError)` at every genuinely-new-episode attempt (`state.lastAttempt[bot]`, gated by the existing dedup so it only updates once per eid). If a new episode's signature matches the immediately-prior one on all three axes -- bot hasn't moved (1.5-block tolerance for settle/jitter), same stall reason, same underlying error -- the whole decision is skipped (no rules.json lookup, no Andy call) and the episode is closed via `dirClose(eid, 'frozen_repeat')` instead of either blindly re-dispatching the identical failing call or leaving it open.

Verified the tracking logic in isolation with six cases before committing: a bot's first-ever attempt never flags (nothing to compare against); an identical repeat is caught on the 2nd occurrence AND still caught on a 3rd (not just a one-shot check); real movement (>1.5 blocks) correctly clears the flag; the same position with a genuinely different `why`/`lastError` correctly does NOT false-positive (a real change in circumstance still gets a real decision); and two different bots never cross-contaminate each other's tracked history. Syntax-checked.

**Deliberately not restarting the live decider to exercise this against a real dispatch right now** -- soak #3 (formal Phase-3 acceptance) is running on the current shared decider process, and a restart to pick this up would touch its active measurement window exactly the kind of thing this whole soak-hygiene effort has been trying to prevent. Will do the live end-to-end verification (a real frozen bot, a real matching episode reopening, confirming the actual `dirClose` call fires and the fresh reopen still works afterward) at the next safe restart -- soak #3's window close -- before calling this fully proven, matching the standard the rest of today's fixes were held to.
fix: decider.js (`handleBot`'s frozen-repeat check, right after the (bot,eid) dedup).
github: felsenuboot/felcrew-mcp#97 (comment to follow)

### 2026-09-02 engine-dev — #96 design argued (not yet built): "zero defense must be unrepresentable" accepted, corner-step-for-melee refuted, two new branches proposed
type: proposal (doctrine: argue before building)
status: argued here per team-lead's steer; building next, holding only for the soak #3 grade if the timer
pings mid-work
what: team-lead's frame for #96, taken as the starting point: the composition-rot principle generalizes
to **"zero defense must be unrepresentable"** — `pick()`'s routing table must provably always reach a
branch that CAN act given the bot's actual current resources, not one that silently degrades to a no-op.
RotzRudi's triple-death is exactly a representable-zero-defense state: melee threat, HP<6 (closes
FLEE_HOME), no filler (closes WALL_OFF), nothing else in the table. Agreeing/refuting each of team-lead's
three concrete proposals in turn:

**(a) An un-gated FLEE_AWAY floor — AGREED, this is the right shape.** The key property: it needs no
inventory (unlike WALL_OFF/arrow-shadow), no specific reachable target (unlike FLEE_HOME/home,
corner-step/a qualifying cell) — the only thing it needs is that SOME direction has room to move, which is
strictly weaker than every other branch's own precondition. This codebase already has the exact proven
mechanism, just scoped to one threat type: `branchCreeper`'s retreat is `pathfinder.setGoal(GoalInvert(
GoalFollow(ent, clear+1)))` — maximize distance from a live entity, no destination, real pathfinding
handles obstacles automatically (strictly more robust than hand-rolled dead-reckoning; #54's own lesson —
trust a proven navigation primitive over a bespoke one — applies directly here). Generalizing it to
`branchFleeAway(t)` for ANY threat (not creeper-specific) rather than reimplementing is both less risk and
less code.

**(b) FIGHT_BACK as a candidate above the floor — AGREED, with one deliberate deviation from precedent.**
BREAK_LOS's own counter-attack sub-branch already proves the mechanism (mineflayer-pvp, gated on "already
at melee reach, real sword, not a creeper") — reusing that exact gate for a NEW `branchFightBack`, EXCEPT
for one field: **no minimum-health floor.** BREAK_LOS's counter-attack requires `health >= rushHp (12)`
because in that context declining to fight and holding the shield is a genuinely safe alternative. Here it
is not — the branch only fires when NOTHING else can act, so the honest alternative to fighting at HP 0.33
is not "a safer option," it is "guaranteed continued unopposed damage" (exactly what killed RotzRudi three
times). A real player facing that choice swings back; the branch should too. Falls through to
`branchFleeAway` if the fight doesn't end the threat within a bounded window, rather than repeating a
losing fight forever.

**(c) A filler-low early warning — AGREED as a valuable COMPLEMENT, explicitly NOT a substitute for (a)/
(b).** This reduces how often the zero-defense state is ever reached (a bot topped up before an encounter
starts is less likely to run out mid-fight); it does not make the state unrepresentable when it does
happen anyway (bad luck, an unusually long single encounter, several encounters back-to-back). Both layers
matter, but only (a)/(b) satisfy the actual invariant team-lead's framing demands. Also: this specific
piece crosses into agenda.js's RESTOCK/kit-floor territory (a different lane) and reacting fast enough to
help WITHIN one panic episode — survival.js suspends the whole agenda ladder while active, so RESTOCK
can't react to filler burning fast until control returns, possibly after the bot is already dead — needs
its own design pass. Recommending it as a follow-up rather than building it in this same change: the
core structural fix (a)/(b) is what actually closes #96's gap, and bundling a cross-lane RESTOCK change in
without separate review risks the exact "argue before building" doctrine this file keeps enforcing.

**Corner-step-for-melee — REFUTED, agreeing with team-lead's skepticism.** Corner-step's entire value is
breaking LINE OF SIGHT so a RANGED attack (which needs a clear line) can no longer land. A melee mob's
attack doesn't need LOS at all — it needs adjacency, and vanilla/mineflayer melee-mob pathfinding routes
around a single obstacle in normal time, not a meaningful delay. Extending corner-step to melee threats
would spend real search/travel budget on a maneuver whose core mechanism doesn't transfer, when
`branchFleeAway`'s actual distance-gaining mechanism is both simpler and directly effective against a
melee attacker (a sprinting bot is faster than a walking zombie; genuine distance is genuinely safer,
unlike ducking behind a corner it can walk around).

**Concrete routing change, `pick()`**: after the existing FLEE_HOME check, gate WALL_OFF itself on
`fillerItem()` being available BEFORE calling it (same "verify before deferring" discipline as #94/#98 —
don't call a fallback already known to no-op) — but only when a REAL threat is present (`nearest` is
non-null); the existing "hurt, no visible threat" `branchWallOff(null)` case is unaffected, since nothing
is actively landing hits during that no-op retreat today and it isn't the state #96 is about. When a real
threat is present and filler is unavailable: try `branchFightBack` if `canFightBack(nearest)` (weapon
held, already at melee reach, not a creeper), otherwise `branchFleeAway(nearest)`. `pick()` never again
reaches a state where the only representable outcome is a repeating no-op.

**Verification plan**: re-run `bench/fixtures/survival-cannotheal.js`, the #94/#98 preflight suite, and
`bench/fixtures/flee-home-reachability.sh` (must all still pass — this change touches `pick()`'s routing,
which #98 also touches, so regression risk is concentrated exactly there). New fixture proving the actual
gap closes: a real melee mob, no filler, HP forced low — assert the bot no longer sits in a
sub-100ms no-op loop, and that SOME real action (fight or flee) is attempted and has a measurable effect
(HP stabilizes, distance increases, or the mob dies) within a bounded window. Per survival doctrine (#65
precedent), this needs a real mob, not `drill()`.
fix: proposed here; building next (holding for the soak #3 grade first if it lands mid-work, per
team-lead's explicit priority order).
github: felsenuboot/felcrew-mcp#96

### 2026-09-02 test-driver — threat-independent panic thrash: HP<8 alone loops survival forever (new, more severe than #97)
type: bug
status: open
what: Gear-race run #4 (SabberSepp, world-race4): an early zombie death (T+29s, before any kit
existed) left HP at 7.7/20 with food at 17 (one below the 18 needed for natural regen) and zero
cobblestone. From that point, survival.js's standalone "HP < 8" panic-entry condition re-fired
continuously and indefinitely with NO mob involved: `danger.score` was 0, `danger.state` "calm",
`threats:[]`, and the log read `"danger panic (0): no visible threat"` immediately followed by
`"panic_enter (danger) hp=8 threat=no visible threat"`, repeating. `survival.fires` went 395 -> 1107
in ~3 minutes and was still climbing (accelerating) when the run concluded. This is MORE severe
than `#97`: it needs no freak geometry and no persistent attacker, just one early sub-8-HP hit with
no food/cobble on hand — near-guaranteed at the start of any fresh spawn. Because `panic_enter`
calls `stop()` on the running task at this frequency, NO task can ever complete — including the
correct fix (hunting for food). I set `huntAnimals{repeat:true}` as soon as diagnosed; it correctly
crafted a sword and started moving, but has never completed a kill because the hunt keeps getting
cancelled before it can finish. Genuine catch-22, no legal `setProject`-only recovery exists: the
fix for the trigger requires uninterrupted task time the trigger itself prevents.
fix: (1) survival.js's HP<8 entry should not re-fire on a fresh panic_enter when the immediately
preceding cycle already diagnosed kit_violation/cannot-heal and nothing has changed (no new threat,
no food/filler gained) — extends #92's cannot-heal concept to suppress RE-entry, not just enable
exit (this run never hung in one continuous WALL_OFF, it exited cleanly every cycle and immediately
re-entered). (2) a cooldown/backoff on panic_enter when the preceding diagnosis is unchanged, rather
than sub-second re-triggering. (3) whatever the gate, an in-flight legitimate recovery task (like a
driver-issued huntAnimals already running) needs some grace window to actually complete rather than
being aborted every single tick.
github: felsenuboot/felcrew-mcp#99 (filed)

### 2026-09-02 engine-dev-3 — #99 diagnosed and fixed live: the WALL_OFF no-filler bail never armed standdown
type: fix + verification
status: root cause confirmed via live introspection (not guessed), fixed, verified live and via preflight; fix lives inside engine-dev's active uncommitted survival.js WIP (v9, #96) pending their commit
what: picked up test-driver's urgent #99 handoff (SabberSepp, run #4, actively thrashing). Live-confirmed the exact mechanism with a single `/eval` read rather than reasoning from the log alone: `__survival.brief()` showed `branch:'WALL_OFF'`, `fires:2060, recovered:2059` (and climbing), `standdown:null`, while `__survival.cannotHeal()` independently evaluated `true` at that exact moment (food:17 < regenFood:18, no food item held). Cross-referenced against `pick()`'s current (#96 WIP) routing: with `nearest===null` (no visible threat — confirmed, `ts.length===0`), the FLEE_HOME branch is skipped (out of `fleeHomeMax` range or unreachable) and the fallback-of-last-resort `branchWallOff(nearest)` fires; inside it, `if (!fillerItem())` bails immediately with `{ branch: 'WALL_OFF', sealed: false, reason: 'no_filler' }` — **no `cannotHeal` field at all**. `enter()`'s existing #92 standdown-arming check (`out.branch==='WALL_OFF' && out.cannotHeal`) only ever sees this field set by the FULL seal-attempt path further down the same function, so it silently never fires for the no-filler bail — the exact same class of heal-deadlock #92 already fixed once, reopened through an early-return path that was never retrofitted with the same protection. Since `critical` (hp<8) deliberately bypasses `lockoutMs` (by design, for good reason — #65's point-blank-skeleton lesson), and the underlying condition (no filler, no food, hp pinned) never changes on its own, `enter('hp')` re-fires as fast as the health listener ticks, canceling whatever project is running every single time before it can make the ONE kind of progress (eating) that would actually resolve the trigger. Confirmed this specific bail path can only ever be reached with `threatsNow()` already empty (a real threat + no filler diverts to the newer `branchFightBack`/`branchFleeAway` branches before `branchWallOff` is even called under #96's routing), so no additional threat-clear guard was needed — the fix is exactly as narrow as the gap.

**Fix**: one field. `return { branch: 'WALL_OFF', sealed: false, reason: 'no_filler', cannotHeal: cannotHeal() };` — reuses the same predicate the full path already trusts, no new logic.

**Verified live**, immediately, on the actual thrashing specimen (not a synthetic reproduction): re-injected the patched file, watched `__survival.brief()` — fires/recovered locked at 49 and held perfectly steady across an 8+ second window (was climbing continuously, unbounded, before), `state:'standdown'` correctly armed with the diagnosed hp recorded. `/state` immediately after showed the agenda ladder had resumed real work (`RESTOCK`/`chopTrees`, direction episode closed 4/4, `cooldown` — not stuck). Full `bench/preflight.sh`: 199/199, no regressions.

**Process note, since this touched a teammate's live WIP file**: survival.js was engine-dev's own uncommitted v9 (#96 pick() redesign) when I found this — given the bot was actively thrashing and accelerating, and the fix was a single precise field addition that touches nothing else in the file, I applied and verified it directly rather than waiting through a full coordination round-trip, then immediately handed the exact diff to engine-dev with full disclosure rather than committing it myself under their in-progress work. Not committing this entry's fix myself for that reason — it will land as part of (or alongside) their own #96 commit.
fix: survival.js (`branchWallOff`'s no-filler early return, one field) — landing via engine-dev's own commit.
github: felsenuboot/felcrew-mcp#99 (comment to follow)

### 2026-09-02 engine-dev-3 — #99's agenda-side question, answered: there is no agenda-side lever, and here's the exact reason why
type: analysis (read-only — no code touched, per team-lead's explicit boundary)
status: answered both of team-lead's specific questions from primary-source reading (agenda.js + survival.js), not inference
what: team-lead asked, after ruling survival.js/pick() off-limits to me for #99: (1) WHY does each panic entry cancel the running task — is the suspend mechanism agenda-side, and is there a legitimate "cancel-on-entry vs cancel-on-action" hardening available there; (2) does #92 standdown's scope (branch-level vs entry-level) explain why it doesn't catch this.

**Answer to (1), correcting a premise in the question**: the task-cancellation is NOT agenda.js's code at all. `survival.js`'s `enter()` calls `__skills.stop('panic')` (plus `bot.pvp.forceStop()`, `bot.collectBlock.cancelTask()`, `bot.pathfinder.setGoal(null)`) synchronously and unconditionally at the very top of every entry — BEFORE `pick()` even runs to decide which branch, let alone what that branch will actually do. `enter()` itself is invoked directly from a health-listener callback (`if (bot.health > 0 && bot.health < g.cfg.hpPanic) enter('hp')`), completely outside agenda's own tick cycle. Agenda.js's REFLEX rung (`fire: (s) => s.survivalActive || ...`, `act: async () => { clearActiveTask(); return 'yield'; }`) only reacts on agenda's own ~2s tick, reading `s.survivalActive` AFTER survival.js has already stopped the task — and `clearActiveTask()` is pure bookkeeping (`A.activeTaskId = null; A.activeTaskRung = null; A.activeTaskName = null;`, confirmed by reading its one-line definition), it never itself calls `__skills.stop` or anything else that touches the real task. **There is consequently no "cancel-on-entry vs cancel-on-action" lever available on the agenda side** — by the time agenda's ladder becomes aware a panic is happening, the cancellation already happened, up to ~2 seconds earlier, entirely inside survival.js's own synchronous entry path. Any such hardening (deferring the stop until after `pick()` knows what branch will run, or skipping it entirely for a branch that turns out to do nothing measurable) would have to live inside `enter()`/`pick()` itself — survival.js's file, not agenda's, confirming team-lead's lane call was correct for the fix, whatever shape it takes.

**Answer to (2)**: yes, exactly, and this is the same shape as #99's already-diagnosed root cause. Standdown's GATING is entry-level — it's checked at the very top of every `enter()` call, before `pick()` runs again, so once armed it correctly blocks every subsequent entry regardless of which branch would have run. But standdown's ARMING is narrowly branch-result-level: `enter()` only sets it when `out.branch === 'WALL_OFF' && out.cannotHeal` — one specific branch's one specific return shape, not a general "the situation is genuinely unrecoverable" signal computed independently of which branch happened to handle it. #99's gap (the no-filler early bail never populating `cannotHeal`) is a narrow instance of this broader scoping choice — even with that one field now fixed, any FUTURE branch outcome that is ALSO genuinely cannot-heal (a different early return somewhere, a different branch entirely) would need its own explicit `cannotHeal` computation to arm standdown, because the check is keyed to `WALL_OFF` specifically, not to the underlying predicate. Whether to broaden the arming condition to `threatsNow().length === 0 && cannotHeal()` regardless of branch (rather than gating on `branch==='WALL_OFF'` at all) is a design call for whoever owns this file next — flagging it as the generalized version of the question, not building it.
fix: n/a — analysis only, per team-lead's explicit "touch neither survival.js nor pick()" boundary. Confirmed no unintended edits to either file from this reading pass (`git status` clean on both beyond the already-disclosed #99 patch sitting in survival.js).
github: felsenuboot/felcrew-mcp#99 (comment to follow), cross-reference #92, #96

### 2026-09-02 engine-dev — #96 fix landed and verified (survival v9): FIGHT_BACK killed a real zombie in RotzRudi's exact death shape; one adjacent noise finding flagged, not fixed here
type: fix + verification
status: shipped, no regression, PRIMARY claim (zero defense is no longer representable) proven against a
real live mob; one honest secondary finding surfaced during verification, deliberately not folded in
what: built the design argued in the entry above. `pick()` now checks `fillerItem()` before choosing
WALL_OFF when a real threat is present, falling through to a new `branchFightBack` (weapon held, threat
already adjacent, no health floor) or `branchFleeAway` (the absolute floor — generalizes `branchCreeper`'s
own proven `GoalInvert(GoalFollow(...))` retreat to any threat) instead of the guaranteed no-op that
killed RotzRudi three times.

**NO REGRESSION**: `survival-cannotheal.js` 7/7 (twice, on two different bots). Full `bench/preflight.sh`
199/199 immediately after landing the code (on an `--agenda` bot). `flee-home-reachability.sh` still PASS
— worth noting its own case 2 outcome changed from `WALL_OFF` to `FLEE_AWAY` (that fixture's fabricated
threat has no real entity id, so it exercises the routing decision correctly without exercising the new
branches' own movement/combat logic — expected, not a bug).

**PRIMARY CLAIM PROVEN LIVE, real mob, not `drill()`, matching RotzRudi's exact shape** — melee threat,
no filler, weapon held, HP crossing below 6: staged a real zombie adjacent to a bot carrying a stone sword
and zero filler. `FIGHT_BACK` fired (`"No wall, no room to run clean - fighting back."`), engaged via
`bot.pvp`, and **killed the zombie** (confirmed independently by the `rotten_flesh` drop landing in
inventory, not just the branch's own self-report) — the bot survived at 7 HP instead of RotzRudi's fate.
Separately verified `FLEE_AWAY` against a real zombie with NO weapon and no filler: it engaged
repeatedly, genuinely gained real distance each time (confirmed via position deltas, not just the branch
label), and kept the bot alive for 28+ real seconds of active fleeing — longer than RotzRudi's entire
three-death sequence combined — before an unarmed, unequipped bot facing a persistent single attacker
eventually lost anyway. That outcome is honest, not a failure: #96's own argument never claimed
`FLEE_AWAY` guarantees survival with literally nothing in hand, only that it replaces a guaranteed no-op
with a genuine, real chance.

**Secondary finding, surfaced by this exact verification, NOT fixed in this change**: once `FIGHT_BACK`
or `FLEE_AWAY` resolves a real threat (the zombie above died mid-test), HP can remain below `hpPanic (8)`
for a stretch afterward (natural regen needs food>=18 and real time). During that stretch, `onHealth`'s
critical-HP bypass keeps re-triggering `enter()` every cycle, `threatsNow()` is correctly empty (no real
threat left), and `pick()` falls through to the ORIGINAL, unguarded `branchWallOff(null)` path (the
`nearest === null` case this change deliberately left alone, since nothing is actively landing hits
there) — which hits its own no-filler fast-path and reports "No cobble to wall in... Stable again"
**every ~200-250ms** until HP climbs back above 8. Live-observed: dozens of near-identical chat lines in
a few seconds. Not lethal (confirmed: HP was climbing, 7->8, not falling, during the whole observed
window) and NOT newly introduced by this change — the exact same no-filler fast-path existed before #96
for any branch's own post-resolution trailing period (e.g. BREAK_LOS's own "wall+kill" case would hit the
identical pattern). This change just makes it easier to OBSERVE, because `FIGHT_BACK` now actually wins
fights that previously ended in death or a much longer WALL_OFF/FLEE_HOME cycle. Flagging rather than
folding a second, differently-scoped fix into this change (this is a NOISE/efficiency question, not a
"zero defense" question — #92's own `g.standdown` mechanism already solves the structurally identical
shape for the food-specific `cannotHeal` case; the natural fix is probably generalizing that same
standdown gate to cover "no filler, no threat, HP recovering on its own" too, rather than a new
mechanism) — recommend it as a fast, contained follow-up rather than building it un-argued here.
fix: survival.js (`canFightBack`/`branchFightBack`/`branchFleeAway`, `pick()`'s WALL_OFF filler gate, v9).
github: felsenuboot/felcrew-mcp#96 (fix landed and reported); recommend a small follow-up issue for the
post-resolution no-filler chat-spam pattern above, distinct from #96's own lethal-gap claim

### 2026-09-02 engine-dev — #99: confirmed already landed in #96's commit, not a v7/v8/v9 regression
type: confirmation + regression analysis
status: verified — fix is live in commit 5999820 (no separate commit needed), root cause predates #94/#96
what: engine-dev-3's #99 fix (`branchWallOff`'s no-filler early-return now sets `cannotHeal: cannotHeal()`)
landed on disk while I was mid-verification of #96 in the same uncommitted file, and got swept into my own
`git add survival.js && git commit` for #96 (5999820) without either of us realizing at the time —
confirmed by `git diff survival.js` showing zero uncommitted changes and `grep -n "no_filler" survival.js`
showing the fixed return already in place. No action needed to land it; it's live. Independently verified
the live specimen: `GET /state` on SabberSepp shows `health:10.17, food:14`, agenda back to normal
`RESTOCK/chopTrees` operation — the thrash is over, confirmed read-only (no `/eval` against a bot mid-race).

**Team-lead's regression question, answered from git history, not inference**: `git log -S"reason:
'no_filler'" -- survival.js` shows that exact early-return has existed since the ORIGINAL foundational
commit (`6b290bb`), untouched ever since — `git show 71eb13f -- survival.js | grep -A5 no_filler` (71eb13f
is #92/v6, where `cannotHeal` was first introduced) returns nothing, meaning v6 never touched this line at
all. **This is a v6-era gap in #92's own original work — I added `cannotHeal` computation and standdown-
arming to the FULL seal-attempt path's return, and never retrofitted the same field onto the pre-existing
no-filler shortcut return a few lines earlier in the same function. Neither #94 (v7) nor #98 (v8) nor #96
(v9) touched this code at all** — confirmed directly against each commit's own diff (v7 only changed
`branchBreakLOS`'s corner-step gate; v8 only changed `pick()`'s FLEE_HOME routing + added `S.reachOf`; v9
added new branches and changed `pick()`'s WALL_OFF gate, never `branchWallOff` itself). **This was not a
regression opened by my routing changes.**

Why did run #3's v6 racer (RotzRudi) never exhibit this exact threat-independent thrash, if the bug
predates it? Plausible, evidence-consistent (not proven from RotzRudi's own ledger directly) explanation:
RotzRudi's encounters were all threat-PRESENT death spirals — it died from active, ongoing damage before
ever settling into a SUSTAINED "threat gone, still hurt, no filler" resting state, so the missing-
`cannotHeal` bug never got the TIME to manifest as a visible, climbing fire-count the way SabberSepp's
threat-independent, non-lethal (HP stable at ~7-8, never dying) case did. Same latent bug, very different
observability depending on whether the surrounding state is fatal-and-fast or survivable-and-sustained.

Engine-dev-3's own follow-up analysis (their second #99 entry, same file) already correctly generalizes
this beyond the one-line patch: standdown's ARMING is branch-result-keyed (`out.branch==='WALL_OFF' &&
out.cannotHeal`), not predicate-keyed (`threatsNow().length===0 && cannotHeal()` regardless of which
branch produced the outcome) — meaning any FUTURE early-return anywhere that is also genuinely
cannot-heal would need its own explicit field to be caught. This is the same generalization #100 (filed
earlier today, the post-resolution WALL_OFF chat-spam finding) already points at — one broadening, not two
separate follow-ups.
fix: n/a — confirming already-landed work + regression analysis, no new code from this entry.
github: felsenuboot/felcrew-mcp#99 (confirmed fixed, live in commit 5999820), cross-reference #92, #96,
#100

### 2026-09-02 engine-dev — Soak #3 graded: FAIL, catastrophic — named suspect confirmed and narrowed to the exact line
type: grading + finding
status: --direction-gate verdict written (bench/gates/direction-soak3.json); named suspect traced precisely
via a real ledger and a read-only live diagnostic, filed as its own issue
what: formal grade of soak #3 (Direction Episodes Phase-3 acceptance RETRY, MatschMoritz/3106,
127.0.0.1:25599, main@current with #96/#99 landed, --agenda), window 2026-09-02T17:55:58.473Z to
18:55:58.473Z exactly, SOAK_BOT exemption confirmed noted per its own decisions.jsonl records.

**VERDICT: FAIL, and badly** — SR (verified) **1.5%** [0.6%-3.7%] n=271 (soak #1 was 85.7%, soak #2 was
85.7% too), outcomes `error:178 wedge:89 ok:4` — only 4 successful task completions in the entire hour.
1 episode never closed (`dmtkgf01i10`, `project_stalled`, only 3min old at window's last-seen timestamp —
likely still mid-decider-attempt rather than a dead-consumer like soak #2's, given the window closed right
as it opened). Latency p50 205s / p90 224s — both miss target badly (vs. soak #1/#2's ~64s/~69s), a real,
large regression in this specific metric, not a borderline miss. Decider: 17 decisions, only 5.9%
rule-hit (94.1% LLM-consulted — much higher LLM load than prior soaks, since nothing in rules.json matches
this failure's shape), Andy usability 31.3%, LLM calls/hr 17.0 (under the 30/hr cap). `closedBy`:
decider:6(66.7%) **decider_exhausted:3(33.3%)** — the #99 `dirClose` fix (landed in commit 5999820, the
same commit as #96) firing for real, three separate times, exactly as designed: episodes that would have
rotted open forever pre-#99 instead closed cleanly and (per the `interventions` list) two of the three
show a `dirDispatch`/`dirClose` pair from the decider genuinely working the ladder. **#99 is proven
functioning correctly in this exact graded soak, independent of everything else that went wrong.**

**Named suspect, confirmed exactly and more precisely than the working hypothesis**: `177x error
ensureTool at -17,111,8 code:acquisition_failed` — one position, repeating for the entire hour. Pulled
the literal `msg` field (matches Felix's own live screenshot verbatim): `"could not acquire sword:
tier:payable:wooden_sword | depot:minerals:none | depot:wood:none | planks:6 | craft:no crafting table
in reach and could not place one (already holding one — not re-crafting)"`, with `held:
{"name":"crafting_table","count":1}` on every single record. **This is NOT the stick-intermediate
checker/executor mismatch team-lead's working hypothesis named going in — it's specifically that the bot
is holding a crafting table for the entire hour and the code never re-attempts placing it.** Traced to
the exact lines (skills.js ~2189-2199, `craftToolChain`): the `alreadyHolding()` guard that correctly
prevents crafting a SECOND pointless table (a real, documented fix from an earlier NacktNorbert/#84
investigation, whose own comment already predicted this exact failure shape needed "a live geometry
reproduction... before designing" a fix — this soak IS that reproduction) also, as an unintended side
effect, prevents ever RE-ATTEMPTING placement of the table already held. One failed `placeCarriedTable()`
call, and the gate is permanently closed for as long as the bot revisits this spot.

**Read-only live diagnostic, post-window (does not touch the graded verdict)**: replayed
`placeCarriedTable`'s own exact candidate/face-filter logic against the live, still-connected bot — a
valid placement candidate genuinely exists at this position (`(-17,108,4)`, air with a solid `grass_block`
floor, no overhang/water/anything exotic). So the candidate-selection MATH isn't the bug; the likely
culprit is `bot.placeBlock()`'s own runtime reliability, which this codebase already has an open,
cross-referenced concern about (#54's roadmap: "placeBlock (#19)... the flakiest primitive in the stack").
Not confirmed by an actual placement attempt (kept this diagnosis strictly read-only). Filed as **#101**
with the full trace and three suggested directions, cross-referencing #84 (a related but mechanically
different class — that one is idle bots never trying, this is an active attempt whose one placement try
is never retried).

**RESTOCK itself also wedged 88 times at the identical position** (`wedge restock at -17,111,8`) —
consistent with the same underlying gate: RESTOCK correctly keeps trying to fix the kit shortfall (no
thrash in the ladder-coverage sense — `100% [97.9-100%]` firing-rung share, RESTOCK:90 TOOL:89 EAT:3, a
CLEAN split of effort, not oscillation), it just can never succeed because the one action that would fix
it (place the held table) never gets attempted a second time.
fix: n/a — grading + diagnosis. bench/gates/direction-soak3.json (written verdict).
github: felsenuboot/felcrew-mcp#68 (posted), felsenuboot/felcrew-mcp#101 (new, the exact bug), #99 (cross-
reference — proven working correctly in this same soak), #84 (cross-reference, related class)

### 2026-09-02 engine-dev — #100 design argued (not yet built): predicate-keyed standdown, with two safety refinements found by walking every branch
type: proposal (doctrine: argue before building)
status: argued here per team-lead's steer; building next
what: team-lead's #100 assignment — re-key standdown's ARMING from branch-result (`out.branch==='WALL_OFF'
&& out.cannotHeal`) to a predicate (`threatsNow().length===0 && cannotHeal()`, regardless of which branch
ran), covering both #99's generalization (any branch reaching a genuinely cannot-heal, calm state should
arm standdown, not just WALL_OFF) and the post-victory `WALL_OFF` chat-spam #100 itself named. Explicitly
asked to walk each branch for suppression risk before building — done below, and it surfaced two concrete
refinements to the literal predicate, not just a rubber-stamp.

**Confirmed the predicate is well-targeted, not guessed at**: re-checked the exact `#96` live-mob log
(`FaulesFelix`, `FIGHT_BACK` killing a real zombie) that first surfaced this noise pattern. Food readings
during the noisy window were `19, 18, 18, 17` — genuinely dipping BELOW `regenFood(18)` from the fight's
own sprint-exhaustion, not staying comfortably above it as I'd first assumed from memory. `cannotHeal()`
(`food<18 && no food item`) really was `true` for at least part of that window, so `team-lead`'s exact
predicate does catch the observed case — this isn't solving an imagined problem.

**Branch-by-branch walk, the actual ask**: standdown's own re-arm conditions (`stale || health dropped
further || threatsNow().length>0`, checked fresh on every `enter()` call regardless of which branch armed
it) already protect against the general case — ANY branch whose resolution leaves REAL ongoing danger will
either keep hurting the bot (health-drop clears it) or leave a threat dangerscan can see (threat-reappear
clears it). The real question is narrower: is there a branch outcome where genuine danger persists WITHOUT
tripping either signal?
- **CREEPER, BREAK_LOS, FIGHT_BACK, WALL_OFF**: no — by the time each returns, the threat is either
  handled (dead, walled off, LOS broken) or still tracked by `threatsNow()`. Safe to arm.
- **FLEE_HOME**: even on a failed/timed-out flee, the predicate's own `threatsNow().length===0` check is
  independent of whether the flee itself succeeded — if a threat is genuinely still around, it's still in
  the list regardless of `branchFleeHome`'s own result. Safe to arm.
- **ENV (lava/fire/drowning) — REFINEMENT #1, exclude it entirely.** `branchEnv` does not verify the
  hazard is actually gone before returning (no `resolved` field — it attempts mitigation and reports what
  it tried). `pick()`'s own FIRST check on every call is `envHazard()` — if a genuinely still-active hazard
  arms standdown (because `threatsNow()`/`cannotHeal()` happen to ALSO qualify at that instant) and the
  ENTRY gate then short-circuits before `pick()` ever runs again, `envHazard()` never gets re-checked at
  all until a real health-drop clears it. Fire/lava deal damage on a sub-second cadence so this window is
  narrow, but it's the ONE branch class whose own header comment says "nothing else matters" — not worth
  the risk for a noise fix. Excluding `ENV` from arming costs nothing (env hazards are rare enough that
  losing standdown's noise-suppression there is not a real cost) and removes the ambiguity entirely.
- **FLEE_AWAY — REFINEMENT #2, exclude its own `cornered:true` outcome.** This is not hypothetical: #94's
  own root-cause diagnosis (this file's own history, same day) found dangerscan's threat list can read
  empty WHILE a real melee attacker is still adjacent and dealing damage (the documented "self-blinding"
  observation from RotzRudi's ledger). `branchFleeAway` already reports exactly the signal needed —
  `cornered: gained < 3` — meaning its OWN attempt to create distance failed. Arming standdown on a
  `threatsNow().length===0` reading that could itself be a stale/self-blinded snapshot, right after the
  one branch whose own outcome says "I did not actually get away," is exactly the scenario the #94
  diagnosis warns about. Excluding this one case is cheap and directly evidenced, not a hypothetical
  worst-case.

**Final predicate**:
```js
const dangerSettled = out && out.branch !== 'ENV' && threatsNow().length === 0
  && !(out.branch === 'FLEE_AWAY' && out.cornered);
if (dangerSettled && cannotHeal()) { /* arm standdown, distinct message */ }
else { g.standdown = null; /* generic message, as today */ }
```
No change needed to standdown's own re-arm/clear logic (the entry-gate side) — it already re-checks fresh
on every call regardless of which branch originally armed it, so generalizing the ARMING side doesn't
require touching the CLEARING side at all.

**Verification plan**: `bench/fixtures/survival-cannotheal.js` (must still pass — this is the exact file
that exercises standdown's arm/clear logic, so it's the sharpest regression check available), plus the
#94/#96/#98 preflight/fixture suite, plus a NEW case in that same fixture: post-victory low-HP-but-calm
state (fabricate `threatsNow():[]`, `cannotHeal():true`, any non-ENV/non-cornered-FLEE_AWAY branch) should
arm standdown and produce zero further re-entries until a real signal — the exact shape team-lead named.
Live-verify per survival doctrine: reproduce the actual noisy sequence (real mob fight, no filler, letting
food dip below 18 mid-fight) and confirm the post-victory spam is gone.
fix: proposed here; building next.
github: felsenuboot/felcrew-mcp#100

### 2026-09-02 engine-dev — #100 fix landed and verified (survival v10): predicate-keyed standdown, all three branch-exclusion cases proven precisely via g.drill()
type: fix + verification
status: shipped, no regression, the exact predicate logic verified precisely (not just observed in the
wild) via controlled per-branch tests
what: built the design argued above. `enter()`'s standdown-arming check is now `dangerSettled =
out.branch !== 'ENV' && threatsNow().length === 0 && !(out.branch === 'FLEE_AWAY' && out.cornered)`,
armed alongside `cannotHeal()` regardless of which branch produced the outcome.

**NO REGRESSION**: full `bench/preflight.sh` 203/203 on a fresh bot post-injection (skills unchanged,
survival v10). `flee-home-reachability.sh` still PASS (home-reachable/home-sealed both correct).

**Precise verification, not just live observation**: added three new cases to
`bench/fixtures/survival-cannotheal.js` (now 11/11) using `g.drill()` — which forces a SPECIFIC branch
through the REAL `enter()` state machine, letting each of the three predicate outcomes be tested directly
rather than hoping a live encounter happens to exercise all of them:
- `ENV` (fabricated fire hazard, calm+cannotHeal otherwise satisfied): standdown stays `null` — confirmed
  the exclusion works.
- `FLEE_AWAY` with a fabricated (no-real-entity) threat, which — confirmed as a sanity check on the drill
  setup itself — genuinely reports `cornered:true` (no entity to flee from, `gained` stays 0): standdown
  stays `null` — confirmed the second exclusion works.
- `CREEPER` (a branch NOT in either exclusion), same calm+cannotHeal conditions: standdown DOES arm —
  confirmed the actual #99/#100 generalization fires for a branch other than `WALL_OFF`.

**Live-mob check**: a real zombie encounter (contaminated test terrain from a full day of prior sessions
at the same coordinates — multiple hazard types firing in sequence, not a clean single-threat repro) still
showed the mechanism working as designed: the `"Walled off but can't heal..."` standdown message fired
from a real `WALL_OFF` cannotHeal case, followed by a genuine ~20-second quiet period with zero repeated
messages — where the pre-#100 code would have spammed every ~200-250ms for that whole stretch. Messier
than a controlled repro, but consistent with, not contradicting, the fixture's precise result. The
fixture's own `g.drill()` cases are the load-bearing verification here; the live encounter is a
corroborating data point, not the primary proof, given how much accumulated test geometry sits at that
one spot after today's sessions.
fix: survival.js (`enter()`'s standdown-arming predicate, v10), `bench/fixtures/survival-cannotheal.js`
(Section C, 3 new cases).
github: felsenuboot/felcrew-mcp#100 (fix landed and reported) — closes the last open survival-lane item
from today's finds (#92, #94, #96, #98, #99, #100 all now shipped and verified)

### 2026-09-02 engine-dev — wait-filler sweep #2 (audit-only): dangerscan's own raycast-budget assumption is trusted as verified truth by pick()'s BREAK_LOS routing
type: audit
status: AUDIT-ONLY, nothing built — one real finding, filed for a maintainer decision on priority
what: per team-lead's standing wait-filler authority (composition-rot-style sweep, argued first,
audit-only unless approved), swept the independently-injected payloads NOT covered by today's earlier
sweep (`dangerscan.js`, `basekeeping.js`, `digguard.js`, `reachguard.js`, `toolguard.js`, `producer.js`,
`farmskills.js`) for the same "defer/trust a signal without verifying it" shape.

**Most files check out clean, several explicitly and well**: `reachguard.js`/`digguard.js` both carry
deliberate "No self-wrap fallback" comments (refusing a second guard layer specifically to avoid the
stacking class #55 already fixed — the doctrine applied proactively, not found lacking). `basekeeping.js`'s
own header explicitly reasons through its one approximation (torch coverage tracked in code rather than
re-reading light, because of a known server-side lighting bug) and states the worst case plainly ("a few
extra torches... a non-issue") — exactly the kind of explicit, argued trade-off #94's own "measured
hypothesis vs silent disablement" distinction calls out as NOT composition rot.

**One real finding, in `dangerscan.js`'s `scan()` (~line 162-205)**: LOS is computed via real raycasts
(`hasLOS`), but the loop bounds itself to `g.thresholds.maxRaycasts` (currently 8) per scan tick, nearest
candidate first. Once that budget is exhausted mid-scan, the comment says outright what happens: `// budget
spent: assume no LOS rather than skipping the threat` — every REMAINING candidate that tick gets `los:
false` in its own `threats[]` entry, **not because a raycast confirmed no line of sight, but because none
was ever attempted.** Nothing downstream — `survival.js`'s `pick()`, specifically the `ranged &&
los`-gated `BREAK_LOS` routing — has any way to tell an assumed-false `los` from a genuinely-verified one;
both look identical in the `threats[]` array. A real skeleton (or stray/witch/bogged) beyond the 8th-
nearest hostile within the 24-block scan radius, that genuinely HAS line of sight on the bot, would be
silently treated as not-visible and never routed to `BREAK_LOS` at all — falling through toward
`FLEE_HOME`/`WALL_OFF`/the new `FIGHT_BACK`/`FLEE_AWAY` branches instead, none of which are built for
"corner-step or arrow-shadow against a ranged attacker that's actually shooting."

**Why this is narrower than today's other findings, stated honestly**: it only manifests with MORE than 8
hostile/mob entities simultaneously within 24 blocks (a mob farm, a crowded night-surface spawn, a horde
event) — not an everyday single-attacker encounter like #94/#96/#99's dominant patterns. The scan's own
prioritization (nearest-first) means the MOST dangerous (closest) threats are always the ones that get
real raycasts; a budget-exhausted assumption only affects farther, lower-priority candidates. This softens
the severity without eliminating the shape: a distant-but-genuinely-visible ranged attacker among a crowd
is exactly the survival-doctrine's own "fleeing a ranged mob in the open is the Bernd death" scenario the
whole `BREAK_LOS` branch exists to prevent.
fix: n/a — audit only. Not building without approval, per the standing instruction. If worth fixing: the
cheapest option is probably tagging budget-exhausted entries with an explicit `losAssumed: true` field
(free — the information already exists at the point `los` is assigned, just discarded) so `pick()` or a
future refinement COULD treat "assumed false" differently from "verified false" without dangerscan itself
needing to spend more raycasts than its own budget allows.
github: felsenuboot/felcrew-mcp#104 (filed, per team-lead's ruling — the class matters even where this
instance is narrow, same family as #38's phantom instruments)

### 2026-09-02 engine-dev-3 — R2 wedge diagnosis on MatschMoritz: R2 itself works correctly here, live-confirmed both halves — the headline hypothesis ("R2's fix didn't cover this wedge class") does not hold as stated
type: analysis (live, direct, on the actual specimen) — reports what's confirmed vs. still open, does not overclaim
status: two of R2's two mechanisms independently verified working; the discrepancy with the live soak's recoveries:0 is narrowed to a specific, plausible but NOT yet directly confirmed difference between my clean test and the real automatic gotoR flow
what: team-lead's priority-1 ask was to diagnose why R2 (`_reposition`, my #54 fix, present in this exact build) failed to recover MatschMoritz's hour-long wedge (`recoveries:0` all soak #3). Traced `gotoR`'s real code (skills.js ~758): `goto()`'s own watchdog throws `code:'stuck'` after 3 `_unstick` attempts, `gotoR` catches exactly that code and calls `ctx._reposition()` (R2), retrying up to `r2Max`(2) re-issued `goto()`s — this matches the ledger's `unsticks:3, retries:2` on every wedged `restock` record exactly, confirming R2 genuinely gets invoked here, not bypassed.

**Both of R2's two mechanisms tested directly and separately at the exact wedge coordinates, both work:**
1. `S.recoveryDetect.findRepositionTarget(-17, 111, 8, ...)` (the real candidate search, called live) returns a genuine candidate: `{dx:-2, dz:0, y:109, x:-18.5, z:8.5}` — 2 blocks over, 2 down. Not "no candidate exists" — a candidate is found every time this was called.
2. `S.recoveryDetect.reposition()` (the real, #54-fixed walk) — teleported the bot to the exact wedge cell, stopped its current task cleanly first (removing agenda-tick interference during the ~1.5s window), called it: `displaced:true, candidateFound:true`, landed at `distToCandidate:0.615` — inside the 1.2 arrival radius. **Reached the target, cleanly, on the first try.**

This directly contradicts "R2's fix didn't cover this wedge class" as a standalone explanation — both the search and the walk succeed when invoked directly against this exact geometry. Something about the REAL automatic flow differs from my clean test, most likely the ONE procedural difference between them: `gotoR`'s real call chain invokes `_reposition()` immediately after `goto()` throws `stuck`, with WHATEVER control/pathfinder state the failed goto left behind — my clean test called `__skills.stop()` first, resetting that state before ever calling `_reposition()`. My #54 fix already clears sneak/sprint/back/left/right at the top of `_reposition()` itself, but if the failed `goto()` leaves something ELSE behind that #54's fix doesn't clear (residual velocity beyond what the onGround-settle wait absorbs, a stuck pathfinder movements profile, something in the same family as #54's original finding but not identical to it), that would explain succeeding in isolation while failing in the real chain. **Not confirmed** — attempting to trigger this exact automatic sequence live (via the `__r2Fault` injection hook through the real `come` skill) was blocked by the bot's own actively-running `restock` task (`busy`), and stopping that task first to force the test would reintroduce the same "clean test" confound I'm trying to rule out. Closing this precisely needs either a dedicated non-agenda specimen at this exact geometry (matching #54's own KrachKuddel precedent) or catching a REAL wedge in the act with pre-instrumented logging of the exact control/pathfinder state at the moment `_reposition()` is invoked.

**A second, independent contributing factor, also confirmed live**: watching MatschMoritz's own position over natural agenda cycles (no manual intervention), it visits BOTH the wedge coordinates (-17,111,8/9 — bare cobblestone/dirt, no tree, consistent with self-dug terrain) and the nearby good spot (-17,108,3/4) repeatedly, X coordinate identical throughout (pure Y/Z travel) — it is not randomly unlucky, RESTOCK's own resource-seeking (visible cobblestone at the wedge column) plausibly keeps routing it back to the SAME awkward spot on its own accord, independent of whatever wedges it while getting there. This means even a perfect R2 fix might not fully resolve the SOAK-level symptom by itself if the underlying task logic keeps re-visiting bad terrain for a legitimate reason (the resource actually is there) — worth keeping in mind when scoping the eventual fix's success criteria (episodes closing != the bot no longer visiting hard terrain).

**Reconciling the earlier contradictory candidate-search traces** (mine: zero candidates; engine-dev's: a valid one exists): both were right, for different reasons than either of us first assumed — mine was checking `placeCarriedTable`'s NARROW search (offset magnitude 1, dy 0-1, a completely different function/radius than R2's), not `findRepositionTarget`'s wider one (offset magnitude 2, dy -3..+1) which DOES find something. Not a position-drift artifact as guessed — an apples-to-oranges comparison of two different search functions that happen to share the same "candidate search" vocabulary. Worth being explicit about in the fix commit so this doesn't get miscited as evidence either function is broken.
fix: n/a — diagnosis only. R2 itself is not confirmed broken; the automatic-flow-vs-clean-test discrepancy and the resource-seeking-revisits-bad-terrain factor are both open, reported honestly rather than closed prematurely.
github: felcrew-mcp#54/#97 cross-reference (R2/isolated-terrain family); #101 (craftToolChain, same coordinates, independent bug) — no new issue filed for this entry alone, folding into the existing R2/#97 thread per team-lead's "don't parallel-file" instruction

### 2026-09-02 engine-dev-3 — R2 wedge diagnosis CLOSED: _reposition works correctly even in the real automatic flow — "R2's fix doesn't cover this wedge class" does not hold at all
type: analysis (conclusive, closes the open question from the entry above)
status: closed — the one gap left open above (clean-test vs. real-automatic-flow discrepancy) is now resolved with direct evidence, not just narrowed
what: built a dedicated, isolated, non-agenda specimen (PfahlPetra, port 3109, `--agenda` deliberately omitted) replicating MatschMoritz's EXACT relative wedge geometry via RCON (forceload + fill, same discipline `wedge-r2-fault-inject.sh` already documents for far-from-spawn chunks) — an isolated single-cobblestone pillar with a real candidate 2 blocks down and 2 over, identical shape to the live wedge, confirmed via `findRepositionTarget` returning the same relative offset. This removes the one variable the previous entry couldn't control for: whether the REAL automatic `gotoR` flow (which calls `_reposition()` immediately after a `stuck` throw, with whatever state the failed `goto()` left behind) behaves differently from a manually-cleaned test (`__skills.stop()` called first).

**Triggered the REAL, entirely unmodified `gotoR`/R2 code path** via the existing `__r2Fault` injection hook (armed, then started the real `come` skill — not a direct `_reposition()` call, not a manual stop first): the fault forces `stuck` on the first `goto()` attempt exactly as designed, `gotoR` catches it and invokes R2 through its own normal automatic sequence, zero manual intervention. Result, straight from `__r2FaultProof`: `reposition: {displaced:true, candidateFound:true, posAfter:{x:298.7,y:88.58,z:300.5}}` — landed almost exactly on the candidate (298.5,88,300.5), through the SAME code path the live soak's failures went through. **The one thing left unconfirmed in the previous entry is now confirmed: `_reposition` works identically whether invoked manually-and-cleanly or through the real automatic chain. There is no hidden state-leak difference between the two.**

The re-issued `goto()` immediately after DID fail (`no_path`, target 5.13 blocks short) — but the target I gave it (5 blocks away in a direction I never built any geometry toward) was never reachable from ANYWHERE in the test area, a flaw in the test's target choice, not a finding about R2. This is the expected, correct result for an unreachable goal, not evidence of a walk-execution bug.

**Revised, now-conclusive read of MatschMoritz's actual hour-long stall**: R2 almost certainly WAS successfully repositioning the bot out of the immediate pillar-wedge every time it fired (matching `unsticks:3, retries:2` on every cycle, and matching this test's own clean success) — the compounding, hour-long symptom is that the RE-ISSUED `goto()`, after a successful reposition, still could not reach RESTOCK/mineLane's actual intended destination (wherever the targeted resource genuinely is), for reasons specific to that destination's own reachability — not because R2 failed to do its one job. After `r2Max`(2) such cycles, `gotoR` correctly re-throws `stuck`, the calling skill reports `wedge`, and the agenda's own retry logic re-dispatches the SAME task shortly after — which naturally walks the bot back toward the SAME unreachable-from-here resource, recreating the identical sequence for the rest of the hour. **"R2's fix didn't cover this wedge class" is not the right framing at all: R2 covers exactly what it is scoped to (get off THIS cell), and did so correctly, every time it was asked. The actual gap is one level up — nothing currently recognizes "the destination itself, not just this cell, is unreachable" as a distinct condition warranting a different kind of intervention (abandon this specific target, pick a different resource, or escalate) rather than another local reposition-and-retry.**

That higher-level gap is exactly what #95's `dirClose`/reopen-backoff and #97's frozen-repeat check already exist to catch and mitigate — and both were independently, live-confirmed firing correctly against this SAME bot earlier today (`decider_exhausted:3` in the soak-3 grade, and the natural `frozen_repeat` skip observed live after this diagnosis began). The mitigation for the SYMPTOM (a bot that can't make progress toward an unreachable local goal eventually gets a fresh decider look) is already shipped and proven; what's still open, if anything, is whether RESTOCK/mineLane's target SELECTION should get smarter about avoiding destinations this hard to reach in the first place — a genuinely separate, lower-urgency design question, not a defect in R2 or in #54's fix.
fix: n/a — no code change; this entry CLOSES the diagnosis rather than proposing one. R2/#54 is exonerated with direct evidence, not just left unconfirmed. Superseded the "not yet directly confirmed" caveat in the entry immediately above.
github: felcrew-mcp#54 (closes the open wedge-recovery question for this class), #97 (cross-reference — the existing dirClose/frozen-repeat mitigation is the right layer for the actual remaining gap, no new build needed here)

### 2026-09-02 engine-dev — Human-bar instrument prep for soak #4: playcheck fairness fix + combined --direction-gate/playcheck verdict wrapper
type: fix + tooling + verification
status: built and verified against real ledger data ahead of soak #4's window, per team-lead's explicit
"fix the instrument BEFORE the window opens, not after" instruction
what: Felix formalized the session goal as "a Minecraft bot behaving like a human," operationalized
tonight as a combined instrument verdict: playcheck grades PLAYING AND the direction gate passes, over
the same observed window. Two pieces of prep, both done before soak #4 opens.

**1. playcheck.mjs fairness fix, found by checking real data rather than guessing.** Pulled real
`restock` `task_end` records to see whether a genuine, observable RESTOCK depot search would be counted
fairly. Two shapes exist: a SUCCESSFUL restock (`result.stocked:true`) already populates `collected`
correctly and is credited fine by playcheck's existing check. But the equally-real "checked several depot
chests, none had what was needed" outcome (`outcome:'ok', result.stocked:false`) — checked 10/10 real
occurrences across two bots' ledgers — showed `moved:0, digs:0, placed:0, collected:{}` EVERY time,
despite `gotos:8-9` (real short-range travel between chest locations) and ~2 seconds of real wall-clock
work. Every one of these would have been silently counted as a no-op task, exactly the fairness gap team-
lead named ("RESTOCK provisioning looks stationary-ish"). Fixed by adding `(r.gotos || 0) > 0` to
`playcheck.mjs`'s `observable` check — a real, human-visible travel-attempt count, never fabricated for a
task that never actually moved (verified: the genuinely-stuck `#101` case, `ensureTool` wedged trying to
re-place a table it can't, reports `gotos:0`, so this doesn't blur "searching but empty-handed" with
"stuck in one spot," which are visually different things a human watcher would tell apart).
**Verified against real ledgers, not just reasoned about**: ran playcheck fleet-wide with and without the
fix (git-stashed for the A/B) — `EngineDreckDave`'s no-op fraction shifted 85%->84% (2 tasks reclassified),
`KanapeeKarl` shifted 100%->78% (2/9 reclassified). Small in this snapshot (no bot's overall verdict
crossed a threshold in the sampled window), but real and repeatable, and the mechanism is exactly targeted
at the shape team-lead named.

**2. `bench/humanbar.mjs` (new): the combined verdict wrapper.** Shells out to both `metrics.mjs
--direction-gate` and `playcheck.mjs --json` against the IDENTICAL, exactly-bounded window and ANDs their
verdicts — deliberately a wrapper, not a merge, so each instrument stays independently testable and a bug
in the wrapper can never corrupt either one's own numbers. Automates the window-end-bounding trick this
session's own soak grading has had to do BY HAND three times already (soaks #1-#3): given `--until`, it
builds a real truncated scratch copy of the metrics ledger, `decisions.jsonl`, and the plain-text chat
log, runs a COPY of `metrics.mjs` from inside that scratch dir (the only way to redirect its otherwise-
fixed `logs/` resolution) and points `playcheck.mjs` at the same scratch dir via its own `--dir` flag.
Without `--until`, both tools read the real, live logs directly (matches today's "grade right at window
close" precedent). Writes `bench/gates/humanbar-<label>.json` (verdict, both instruments' numbers) plus
the underlying `direction-<label>.json` in the real tree, same convention as every other soak's gate file.

**Verified against real data**: re-ran soak #3's own exact window through the new wrapper and confirmed it
reproduces the manually-graded numbers exactly (opened 10, closed 9, unclosed 1, latency p50 204898ms /
p90 223926ms — byte-identical to the original hand-graded report), while ADDING the playcheck dimension
that original report never had (SPARSE, 44-45% stationary, ~9.9 productive actions/10min — soak #3 would
have failed the human-bar combined verdict on BOTH counts, not just direction-gate). Also tested the
no-`--until` (live) path, and an unknown-bot edge case — the latter caught and fixed a real bug during
verification: the scratch directory wasn't cleaned up on the early-exit "no gate file" error path (a
genuine `/tmp` leak per failed run), fixed by registering the cleanup on `process.on('exit')` instead of
only at the bottom of the happy path, so it fires on every termination route.
fix: `bench/playcheck.mjs` (`observable` check, `gotos>0`), `bench/humanbar.mjs` (new).
github: n/a — instrument prep, not a tracked engine bug. Ready for soak #4's window.

### 2026-09-02 engine-dev-3 — #101 fixed and verified: craftToolChain terrain-seek for an already-held, unplaceable table (skills.js v60)
type: fix + fixture
status: built, fixture green (10/10 standalone, holds inside the full tier0 suite too), preflight
203/203, committed cd30f4c
what: soak #3's catastrophic failure (SR 1.5%, 177/178 identical errors, MatschMoritz) traced to a real
gap paired with a correct fix: `alreadyHolding()`'s guard rightly refuses to craft a SECOND
crafting_table once one is already held and its first `placeCarriedTable()` attempt failed (that guard
is deliberate, from an earlier #86 fix — crafting an identical fungible item doesn't change the geometry
that just rejected the one already held). But nothing was ever paired with it that tries PLACING the
held table again from somewhere else. MatschMoritz had self-dug onto an isolated single-block pillar —
every cell in `placeCarriedTable`'s own narrow 8-cell/dy:0-1 search was open air, zero solid faces
anywhere, a genuinely correct "nothing here" read, not a bug — and held a table it could never place for
an entire hour.

**Fix**: `seekPlaceableSpot()` (new, skills.js), an expanding square-ring search (chebyshev rings,
dy -2..+2 per ring) bounded by `TERRAIN_SEEK_RADIUS=10` ("cheap stone-tool travel law" per team-lead's
ruling — a short walk, not a cross-map trip). It looks for genuine WALKABLE GROUND (solid below, clear
feet/head — the same standability test `findRepositionTarget` already uses one module up), NOT the
reach-based "air with any solid face" test `placeCarriedTable` applies to its own immediate candidates —
conflating the two was my first wrong draft: a cell can be air-with-a-solid-face while floating next to
a pillar with nothing beneath it, a real face by the letter of that check but nowhere a bot can actually
stand. Once a genuinely standable spot is found, `craftToolChain` walks there via `gotoT` and retries
`placeCarriedTable()` from the new position. Built as a reusable primitive per team-lead's explicit
ruling, not a one-off patch: #97 item 2's eventual generalized "no legal path" recovery wants the exact
same "find somewhere workable nearby" search, and it reuses `_reachOf` (`S.reachOf`, #70's
checker-matches-executor probe) to order ring candidates before committing to the real travel — the
exact idiom engine-dev's #98 fix (`survival.js:829`) predicted "eng-3's #97 fix is expected to want...
from a different file." That deferred-gap comment aged out exactly as its author predicted. A genuinely
marooned bot (nothing placeable within the radius) still fails HONESTLY and fast, into the existing
kit_missing/direction-episode path (post-#95, a fresh decider look on backoff, not silent rot).

**Fixture** (`bench/fixtures/craft-terrain-seek.sh`, new): proves both directions per this session's own
doctrine — a real, RCON-rebuilt isolated pillar rising from otherwise-connected ground (case 1) must
succeed via the NEW path, with `steps` showing `terrain-seek:...:placed` (not just the old narrow search
getting lucky), and a genuinely marooned pillar in a much bigger void (case 2) must fail fast and
honestly. Building it surfaced and fixed a real bug in the FIXTURE, not the code under test:
`ensureTool(bot,'sword',{})` with no options runs a real depot-withdrawal step (`ctxlessWithdrawTool`)
BEFORE ever reaching `craftToolChain` — it reads `protected.json`'s live, real depot coordinates (nowhere
near any fixture's test area) and calls a genuine `gotoT()` toward them. The pathfinder can't complete
that route, but it CAN and does make partial progress first, walking the bot off the isolated pillar and
onto the general floor mid-setup, corrupting the fixture's own precondition before `ensureTool` ever
reaches the code under test. Chased several wrong theories first (survival.js `standdown` state, a
leaked task from a preceding fixture, low carried-over health, a "teetering on a razor's-edge perch"
physics theory) — all had circumstantial partial fits but none reliably reproduced or fixed it; disabling
depot withdrawal via `ensureTool`'s own `opts.depot:false` (an existing, intended opt-out) did, 10/10.
Also fixed for genuine defensive hygiene along the way (kept even though they weren't the root cause):
`__skills.stop()` fixture-reset and a full heal before each case (matches `craft-void.sh`/
`chop-canopy.sh` convention), and `land_on_pillar()` (verifies the exact landing cell after `tp_bot`,
which only confirms X/Z and explicitly leaves Y "a terrain fact for the fixture to handle" — matters more
on a bare 1-wide target).
fix: `skills.js` (`seekPlaceableSpot`, `TERRAIN_SEEK_RADIUS`, `craftToolChain` wiring — v60),
`bench/fixtures/craft-terrain-seek.sh` (new).
github: felcrew-mcp#101 (fixes), #97 (item 2's deferred generalized recovery — this is the primitive it
will want), #98 (engine-dev's `survival.js:829` prediction confirmed), #86 (the `alreadyHolding()` guard
this pairs with), #70 (`_reachOf`/`S.reachOf` reuse).

### 2026-09-02 engine-dev — soak #4 readiness dry-run caught and fixed a real bug in the humanbar
instrument: playcheck's window math used wall-clock NOW, silently corrupting any retroactive grade
type: fix + correction (of this session's own earlier record)
status: fixed, verified against soak #3's own window, committed; humanbar.mjs is now safe to run
whenever soak #4's timer ping actually lands, not only if it lands promptly
what: respawned after the wind-down, first queue item was "dry-run humanbar.mjs on soak-3's archived
window to confirm the tool is intact post-restart." Ran exactly that: `node bench/humanbar.mjs --bot
MatschMoritz --since 2026-09-02T17:55:58.473Z --until 2026-09-02T18:55:58.473Z --label soak3-dryrun`
(soak #3's own exact window, per this file's own grading entry above). The direction-gate half came
back byte-identical to the archived `direction-soak3.json` (opened 10, closed 9, unclosed 1, latency
p50 204898ms/p90 223926ms, llm_calls_per_hr 17) — that instrument is genuinely intact. The playcheck
half did NOT match the "SPARSE, 44-45% stationary, ~9.9 productive actions/10min" figure recorded in
this file's own humanbar-prep entry: it read **72.7% stationary, 4.9 productive actions/10min**.

**Root cause, confirmed not guessed**: `playcheck.mjs`'s `WINDOW_MS = Date.now() - SINCE` — the
window's END was always the REAL wall clock at the moment playcheck runs, never the caller's intended
`--until`. `humanbar.mjs` builds a correctly window-bounded COPY of the ledger data for playcheck to
read, but never told playcheck what the window's end actually was, so `stationaryPct`/
`productiveActionsPer10Min` (both computed as a fraction of `WINDOW_MS`) silently stretch to (real-now
- since) regardless of the data's own true bound. My dry run ran ~2h05m after soak #3's `until`, so
`WINDOW_MS` was ~185min instead of the true 60min — same `activeMs` (~50.6min, confirmed identical
before/after the fix, task durations don't depend on NOW), wrong denominator. `metrics.mjs`'s own
`--direction-gate` was never affected: its `llm_calls_per_hr`/window figures are derived from the
actual min/max decision timestamps IN the bounded data, not `Date.now()` — the right pattern, and why
that half reproduced byte-identical regardless of delay.

**This bug was not introduced by the restart — it was always there.** The commit that built
`humanbar.mjs` (0dbde11) landed at 2026-09-02T19:29:28Z, ~33.5min after the graded window's own
`until` (18:55:58.473Z) — a real, if smaller, gap between "window closes" and "grading tool actually
runs." A true 60-minute window's `activeMs` (~50.6min, re-derived above) implies 15.6% stationary /
15 actions per 10min, not the 44-45%/~9.9 recorded in that entry; a ~92-minute window (`until` +
~33.5min mismatch would need closer to +32min of drift to land exactly there, consistent within
rounding) reproduces something much closer to that reading. **The original verification was itself
graded a bit after `until`, same bug, smaller inflation, never noticed because nobody had reason to
re-run it at a much longer delay until today's dry run made the effect large enough to see.**
Correction to the historical record: soak #3's TRUE playcheck read, over its exact hour, is **PLAYING
(15.6% stationary, 15 productive actions/10min)**, not SPARSE. This does not change soak #3's verdict
(direction-gate alone already failed it decisively — 1 unclosed episode, both latency criteria badly
missed) but the specific "would have failed on BOTH counts" claim in that earlier entry does not hold
— only one count did. Filed here rather than silently amended, per this file's append-only
convention.

**Fix**: `playcheck.mjs` gets a new optional `--until <ISO>` flag that pins `NOW` for the `WINDOW_MS`
calculation (default: `Date.now()`, so live "how's it doing right now" usage is untouched — verified
`--since 30m` with no `--until` still returns a sane live window after the change). `humanbar.mjs`
now passes `--until <the same ISO it truncates the ledger copy to>` whenever its own `--until` is
given. Re-verified against soak #3's window post-fix: `activeMs` implied by the new 15.6%/60min read
(~50.64min) matches the pre-fix 72.7%/185min read's implied `activeMs` (~50.6min) almost exactly —
strong internal-consistency evidence the fix changes only the denominator, not the underlying data
read, exactly as intended.

**Soak #4 readiness**: the combined instrument is now confirmed intact AND safe against grading delay.
Exact command ready for when the timer ping lands (fill in the real bot name and the two ISO
timestamps eng-3/team-lead provide): `node bench/humanbar.mjs --bot <name> --since <ISO> --until <ISO>
--label soak4`.
fix: `bench/playcheck.mjs` (`--until` flag, `NOW`/window-end override), `bench/humanbar.mjs` (passes
`--until` through to playcheck.mjs). `bench/gates/direction-soak3-dryrun.json`,
`bench/gates/humanbar-soak3-dryrun.json` (new — the corrected verification record).
github: n/a — instrument bug caught during readiness prep, not a tracked engine bug (QA tooling, not
the bot engine itself); flagging to team-lead directly since it corrects this file's own prior claim.

### 2026-09-02 engine-dev — #96-residual argued (not built): kit-preflight hardening is the wrong lever
for the failure class that motivated it; recommend closing the residual question, no build
type: proposal (doctrine: argue before building) + #104 re-check (no change)
status: argued per team-lead's wait-filler authority, audit-only, nothing built
what: #96 itself is CLOSED (survival v9: FIGHT_BACK/FLEE_AWAY, "zero defense is no longer
representable"). What's left is the residual half of its own two-direction framing, never built:
"prevent the state from ever being reached" via kit-preflight/mid-encounter resupply awareness, as an
alternative or complement to the filler-independent last resort that shipped. Assigned to re-argue with
fresh eyes and any ledger data since.

**Checked what "kit-preflight" already covers, precisely, rather than arguing from memory.** Two
mechanisms exist today, not one: `skills.js`'s `kitCheck`/`S.start` gate blocks DEPARTURE below
`underground`/`deep`'s `filler:16` floor (`skills.js:155-156,2434-2436`), and separately `agenda.js`'s
RESTOCK rung (`ROLE_FLOOR.miner.filler:16`, checked continuously via `s.filler < f.filler` at
`agenda.js:739`, not just at departure) re-triggers a restock any time filler drops below floor DURING
normal work. So "leaning harder on kit-preflight" as a phrase undersells what's already there — this
isn't a one-shot gate, it's a standing floor re-armed on every agenda cycle.

**Why that still didn't save RotzRudi, and why raising it wouldn't have either.** The #96-motivating
incident's own trace (this file, "R2 wedge diagnosis" section's neighbor, the RotzRudi WALL_OFF
finding) shows filler at 26 (well above the 16 floor — RESTOCK had no reason to fire) going to 0 across
~2 real seal attempts DURING the same encounter that then killed the bot three times. The depletion
happened inside the fight, not before it. No departure gate or periodic floor-check — no matter how
high the floor is set — can prevent a fixed store from being spent faster than it can be refilled by a
threat that is actively landing hits every cycle; raising the floor from 16 to 32 only buys a longer
fight before hitting zero, it doesn't change the shape of the failure. This is a genuinely different
class from "departed without checking" (which kit-preflight is built for and already covers) —
it's "spent it live, mid-crisis," which no pre-crisis check can see coming.

**Recommendation: no build.** The shipped fix (FIGHT_BACK/FLEE_AWAY, direction 1) is the right lever for
this exact failure class — it's what still works after the store hits zero, which is precisely where
prevention structurally cannot reach. Direction 2 (kit-preflight/resupply-awareness hardening) is not
wrong in the abstract, but there is no live evidence of the OTHER failure mode it would actually fix
(gradual, off-fight depletion arriving at a floor breach undetected) — RESTOCK's continuous floor-check
already covers that path, and no incident on file shows it failing to. Marking the #96-residual question
answered: the last-resort defense was the correct completion, kit-preflight is already proportionate to
what it can control, and further hardening there would be effort spent on a failure mode with zero
observed instances while the one with a body count (#96 itself) is already fixed.

**#104 re-check (losAssumed / dangerscan raycast budget): no new ledger data, no change.** Looked for
any live sighting of >8 simultaneous hostiles within 24 blocks since filing (the issue's own stated
"no build without one" bar) — dangerscan doesn't log threat-list size or budget exhaustion to the
ledger at all (confirmed by reading `dangerscan.js`'s `scan()`: `rays`/`threats.length` are local,
never emitted to telemetry), so this can only be checked indirectly. Fleet-wide `deaths` counters across
every `metrics-*.jsonl` show exactly 4 nonzero entries in the whole tree (BruzzelBruno, NacktNorbert,
SabberSepp, ShakeoutShorty, each `deaths:1`), none referenced anywhere in this file as a horde/mob-farm/
crowded-spawn event — no mob-farm or husbandry-pen incident logged since #104 was filed either. Still
zero live sightings. #104 stays open, `priority-low`, no build — the standing bar hasn't been met, and
nothing here should be read as new urgency.
fix: n/a — both audit/argument, no code changed.
github: felsenuboot/felcrew-mcp#96 (residual question argued, recommend no further action — comment
posted), #104 (re-checked, no new evidence, left open as-is)

### 2026-09-02 engine-dev — NIGHT-SHELTER behavior design (audit/design only, per Felix's re-set
goal + team-lead's upgraded ask): a proactive SHELTER rung, subsuming #96
type: proposal (doctrine: argue before building) — supersedes this file's own earlier #96-residual
entry above, per team-lead's direct steer
status: designed, not built. Buildable as written; placement in agenda.js is eng-3's call
(ack-before-edit on their file — nothing here touches agenda.js/skills.js/survival.js)
what: Felix re-set the session goal to "play like a human player." Team-lead's re-evaluation named
the actual gap precisely: six survival-lane fixes landed today (#92/#94/#96/#98/#99/#100) and every
one hardens a REACTION to combat already underway. A human at wood tier does not fight through the
night — at dusk they dig in or box themselves in and wait. SCOREBOARD.md's own gear-race record
confirms this isn't hypothetical: runs #1-#5, one after another, all died or came within a hit of
dying to a mob at night (`SCOREBOARD.md:924` "no run has ever crafted a stone pickaxe... died"; the
run #5 zombie deaths at T+29s and 21:09:21 happened with "every rung of the new floor firing
correctly" — the reactive ladder worked exactly as designed and the bot still fought and nearly
died, because nothing upstream of combat ever considered NOT fighting). This design subsumes #96
(closed: FIGHT_BACK/FLEE_AWAY, "zero defense unrepresentable") because #96's own answer to "unkitted
bot, no filler, in a fight" and SHELTER's answer to "unkitted bot, dusk approaching" are the same
insight one step earlier: the best defense is not needing one.

**(1) Trigger — checked what already exists before designing a new signal.** Two existing, already-
proven, geometry-backed fields do almost all of the work: `dangerscan.js`'s `surfaceExposed` (real
sky-access geometry, not a bare light read — the LIGHT RULE this project already learned the hard
way, `LEARNING_HANDOFF.md:380`) and `light`/`skyLight` (real per-tick raycast/blockAt reads). Neither
one is clock-based, which matters: confirmed by reading `CAVECREW_HANDOFF.md:5,68` and
`LEARNING_HANDOFF.md:384` that the cavecrew (live) server runs FROZEN daylight (surface light never
drops — "frozen daylight makes the SURFACE safe") while the local test servers (25599/25600) run a
real day/night cycle. A clock-based trigger (`bot.time.isDay`) would need per-server special-casing
and would silently do nothing useful on cavecrew even when it looked wired up. A light-level trigger
needs none: on cavecrew, surface light never drops, so it correctly never fires there (matches the
existing doctrine that surface is already safe there); on a cycling world, it fires for real. Recommended
trigger, reusing existing fields only:
```
fire = surfaceExposed === true && (light == null || light < 8)   // same darkness threshold LIGHT/POSTURE already use
       && gearTier(bot) < TIER.stone                              // wooden or bare — see below
       && dangerState !== 'panic'                                  // REFLEX/POSTURE already own real emergencies
```
`gearTier`: skills.js already carries a tier order (`skills.js:1669`, `['wooden','stone','iron',
'diamond']`) for ensureTool's own payable-tier logic — reusable directly as `Math.max(tierIndex(weapon),
tierIndex(armor)) < 1` (below stone). A bot in iron/diamond is combat-capable enough that fighting
through the night is a reasonable choice, not a gap.
**Optional predictive half, explicitly non-load-bearing**: where the daylight cycle is confirmed LIVE
(sampled once at runtime — exactly `research/eval-methodology.md:333`'s own "verify the daylight
assumption once rather than assuming it," two `bot.time.timeOfDay` reads a minute apart, advancing =
live), a dusk-approaching read (`timeOfDay` entering ~12000-13000, before it's actually dark) can fire
SHELTER a little EARLIER so construction finishes before light actually crosses 8 — pure optimization,
never the sole trigger, so a wrong or unverified read costs only the early start, never a false
shelter or a missed one (the light-level check above still gates the real thing either way).

**(2) The shelter primitive — pick by carried stock, reuse what already exists.** Two shapes, and
neither needs new digging/placing mechanics invented from scratch:
- **Dig-in-and-cap** (cheap, underground-adjacent): dig straight down 2 (any pickaxe; through dirt/
  grass, no tool at all), place one block overhead from inside, `torchInline()` (already exists,
  `agenda.js:444` — the exact "torch the block below my feet" primitive LIGHT/POSTURE already call)
  before capping. **The one needed block is usually free**: `survival.js:156`'s own filler set
  (`cobblestone, cobbled_deepslate, dirt, stone, andesite, diorite, granite, netherrack`) already
  covers ordinary ground, so the block just DUG is itself valid cap material — a bot with a pickaxe
  and literally empty pockets can still sink and seal itself. Needs one genuinely new primitive
  (nothing in skills.js digs straight down N and self-seals from inside today; `safeDescend` builds
  a 45-degree STAIRCASE, a different shape for a different purpose) — but the cap-placement step
  itself is a direct lift of `branchWallOff`'s own roof-cell logic (`survival.js:628-629`,
  `feet.offset(0,2,0)` placed last "skeletons shoot down shafts") at a shallower relative offset.
- **1x1 hut** (surface, needs ~10-13 filler blocks): this is not new either — `branchWallOff`'s own
  cell list (`survival.js:612-629`: 4 feet-level + 4 head-level + 4 roof-side + 1 cap = 13 cells,
  built in an existing, tested, threat-facing-aware order) already builds exactly this box, on open
  ground, from a standing position. SHELTER's surface variant is that same cell list run
  PROACTIVELY (no live threat to face first, no `shieldUp` needed) rather than reactively — a
  parameterization of existing code, not a new algorithm.
- **Pick by stock**: `filler` count (already read by `agenda.js:256`, `s.filler`) `< 2` → dig-in (the
  block from digging covers the cap even at zero carried filler); otherwise, and only where digging
  down isn't viable (bot already underground, or geometry refuses — reuse `seekPlaceableSpot`'s
  standability test, `skills.js` v60, #101, for "is there solid ground under my feet at all" before
  choosing dig-in over hut), fall back to the hut.

**(3) Exit.** Three named conditions, each backed by an existing signal — no new state needed beyond
what SHELTER itself owns:
- **Dawn**: the SAME asymmetry as the trigger — `surfaceExposed===true && light>=9` (existing LIGHT
  clear threshold) is the authoritative, both-server-safe read; the verified-live `timeOfDay` crossing
  back past dusk is again an optional early-warning, never load-bearing.
- **Hunger pressure**: specifically `food<=6 && foodCount===0` (critical AND cannot eat in place) —
  a bot that HAS food does not need to leave; SHELTER's own `act()` should just call `eatInline()`
  in place (same call `EAT`/`EAT_CRITICAL` already use) whenever `food<=17 && foodCount>0`, so routine
  eating never requires breaking cover at all. Only genuine starvation-with-nothing-to-eat forces an
  exit to go find food.
- **A project the ladder deems worth the risk**: deliberately NOT automatic — this is the same
  judgment call `A.project`/PROJECT's own attempts-based blocking already encodes (a driver/decider
  sets `A.project`; PROJECT's `fire()` already only cares whether one exists and isn't done). SHELTER
  should `clear()` when `A.project` is set AND is not itself one SHELTER would have refused to start
  in this state (e.g., a driver explicitly overriding is a signal, not a bug to guard against) — this
  needs no new mechanism, just SHELTER not fighting a rung with a genuinely lower prio number that
  fires (see placement below).

**(4) Where it lives.** Recommend prio ~2.5 — below REFLEX(0)/POSTURE(1)/EAT_CRITICAL(2) (all either
real emergencies or safely in-place actions that should still preempt), above DEPOSIT(3)/EAT(4)/
TOOL(5)/RESTOCK(6)/LIGHT(7)/PROJECT(8)/ESCAPE(8.5) — every one of which either requires TRAVEL
(DEPOSIT, TOOL's ensureTool, RESTOCK) or is the exact routine work dusk should interrupt (LIGHT,
PROJECT). This is why EAT sits at prio 4 (below the recommended SHELTER slot) but SHELTER's own
`act()` still calls `eatInline()` itself, per (3) — deliberately not relying on ladder ordering to
let EAT interrupt SHELTER; a rung latches per `choose()`'s own rule (`agenda.js:958-963`:
`demanded.prio >= owner.prio` keeps the current owner), so EAT(4)/DEPOSIT(3) firing while SHELTER(2.5)
is latched correctly does nothing on its own — SHELTER has to want to hand off, which is exactly
what (3)'s three named exits are for. This is eng-3's file and their call on the exact number; the
constraint that matters is "above every travel/exposure rung, at or below the genuine emergency
rungs," not the literal 2.5.
**Composition**: LIGHT (prio 7) and SHELTER overlap in mechanism (`torchInline`) but not in trigger —
LIGHT fires for a bot mid-task that happens to be dark and underground; SHELTER fires for a bot about
to spend the night exposed. A bot already sheltered never reaches LIGHT (SHELTER latches higher).
WALL_OFF (survival.js, reactive) stays exactly as-is and is the correct fallback if SHELTER's own
trigger is somehow too late and a real threat closes in anyway — REFLEX(0)/POSTURE(1) still sit above
SHELTER and hand off to survival.js's `pick()` the instant `dangerState` says so, same as today.
`basekeeping.js`'s spawnproofing is a different concern entirely (permanent registered structures,
not a roaming bot's own night) and is out of scope here.

**(5) Fixture plan.** A real-dusk fixture, matching this session's own "live-verify, not just
`drill()`" doctrine for anything gating survival: RCON `time set 12000` (or wait for it, on a server
confirmed live-cycling per (1)'s verification step) on an open-surface site with an unkitted bot
(below-stone gear, deliberately, matching #96's own induced-stress precedent) and confirm (a) SHELTER
fires before `light` actually crosses 8, not after; (b) the dig-in-and-cap case completes and seals
with zero carried filler (digging its own cap block) and the hut case completes with filler present;
(c) `light>=9` at dawn clears it and the bot resumes its prior project; (d) a driver-set `A.project`
mid-night correctly pulls the bot back out per (3)'s third exit. A companion frozen-daylight run on
the SAME code (any local server with `doDaylightCycle false` set, or literally the cavecrew server
if a safe supervised window exists) should confirm SHELTER never fires there — the negative case
matters as much as the positive one, per (1)'s own claim that this generalizes to both servers.

fix: n/a — design only, per AUDIT/DESIGN-ONLY instruction; awaiting build approval.
github: felsenuboot/felcrew-mcp#96 (subsumed — this is the completion of its own "prevent the state"
direction, at the right layer: before dusk, not after departure), felsenuboot/felcrew-mcp#105 (new,
this design, so it doesn't rot as a FEEDBACK-only footnote) — note: felcrew-mcp is this repo's old
name, GitHub transparently redirects it to felsenuboot/FelsenBerry; same repo, same tracker.

### 2026-09-02 engine-dev — #105 NIGHT-SHELTER primitives BUILT and live-verified (survival.js
v11): shelterDigIn()/shelterHut() both work end-to-end; live testing found and fixed 3 real bugs
the design couldn't have caught on paper
type: fix + build (team-lead's split: primitives are my half, the agenda.js SHELTER rung is eng-3's)
status: built, live-verified end-to-end on a disposable QA bot (ShltrQA, port 3150, 25599,
DECIDER_EXCLUDE=1), no regression (`bench/fixtures/survival-cannotheal.js` 11/11), committed
what: built exactly the design argued above (`shelterDigIn`, `shelterHut`, a stock-based selector,
`inShelter`/exit-predicate state, exposed as `__survival.shelter.{should,enter,exit,status}`) — but
live testing on a real server surfaced three genuine bugs the design document, written before any
code existed, had no way to catch. Reporting all three plainly rather than quietly patching around
them, because each one changes a claim the original design made.

**BUG 1 — the light-level trigger doesn't work on this server; switched to `bot.time.isDay`.** The
design's whole point (1) was "gate on real light level, not a clock, so it generalizes to
cavecrew's frozen daylight." Live-tested via RCON `time set` both directions, with fresh relogs to
rule out a stale cache: `bot.blockAt(pos).light` reads a stuck 0 in broad daylight AND at midnight
(frozen, not day/night-reactive at all — a harsher cousin of basekeeping.js's documented #17), and
`.skyLight` reads a constant 15 in open sky REGARDLESS of time of day (it is static sky-exposure
GEOMETRY, not a brightness value — a fact about this Minecraft version's lighting model I had
wrong going in, not a bug in either field). Neither field answers "is it dark right now" on this
world. `bot.time.isDay` updated correctly and immediately every time. Switched the trigger/dawn-exit
to `isDaylight()` (reads `bot.time.isDay`). **This still satisfies the original requirement**:
CAVECREW_HANDOFF.md pins that server's daylight at MORNING, so `isDay` reads a constant `true` there
and SHELTER correctly never fires — same generalization the light-based design wanted, carried by
the signal that actually worked when tested for real rather than the one that sounded more robust
on paper. `surfaceExposed` (dangerscan's geometry field) is unaffected and still gates exposure.
This is worth its own tracker item independent of #105 — LIGHT/POSTURE (agenda.js) both consume
`s.light` from the SAME dangerscan field and may be reading the same stuck value; filing separately
since it's a distinct root cause from #17 (stuck low always, not "next to a fresh torch") and
affects code outside my lane.

**BUG 2 — the cap has no reference on ANY flat ground, not just my test platform.** First live
attempt: dig 2 down, try to place the cap at `feet.offset(0,2,0)`, got `no_reference` — EVERY face
of that cell is air (below: the just-dug head space; above and all 4 sides: never touched, and on
flat ground — natural OR my artificial test platform — genuinely open air at that height, since
that is exactly the cell the bot originally stood in). This is not a test-setup artifact; it is
the same geometry `branchWallOff`'s own comment already names for its roof cell ("no orthogonal
reference on open ground") — WALL_OFF solves it by placing its 4 head-level RING cells first, each
referencing the wall block directly beneath. Dig-in had no ring (a straight shaft has no placed
wall to reference), so it needed the same trick: place one ring cell at cap height (its OWN
reference is the natural ground one level down, one column over — solid on ordinary terrain) before
the cap itself becomes placeable. Fixed by trying the cap first (cheap, some real geometry — a
ledge, a rim — already has a reference) and falling back to placing ring cells one at a time,
re-trying the cap after each, stopping as soon as one succeeds. Costs 1-2 blocks on flat ground
instead of the design's claimed "one block," still both self-supplied from the dig in the common
case (dirt/stone ground).

**BUG 3 — the hand-rolled pillar-jump exit never gained height; replaced with pathfinder's own
scaffolding-climb.** My first `pillarUp()` (jump, wait for Y to rise, then `placeBlock` a filler
block at "current feet minus one") never actually gained a single level in live testing — placing
a block at that position is placing it exactly where the bot's own hitbox already is, which
`placeBlock`'s collision handling silently refuses (empty catch, no error, no height gain — the
kind of failure that's easy to miss without a live position check, which is exactly what the fixed
version above checks for and this one skipped). Rather than re-deriving correct jump-placement
timing by hand, reused what's already proven in this codebase: `bot.pathfinder.movements.
scafoldingBlocks` is a real, already-used mineflayer-pathfinder capability (skills.js deliberately
CLEARS it during builds specifically to stop it spending materials as scaffolding — meaning it is
armed by default and does exactly this climb automatically). Replaced the custom jump/place loop
with a plain `ownedGoto(GoalBlock(...))` to the pre-dig position; pathfinder's own scaffolding move
handled the climb-out correctly on the very next try, for both the dig-in exit and the leftover-hole
recovery path. Simpler AND correct — the custom code was strictly worse on both axes.

**What's confirmed working, live, end to end**: dig-in (2 down, self-sealed via the ring-first fix,
torch placed, `sealed:true lit:true`, dawn-triggered exit climbed back to the exact start position)
and hut (13/13 cells placed via `branchWallOff`'s own cell list, `sealed:true openFaces:0`, dawn
exit dug one wall and stepped out) — both selected correctly by carried filler stock (0 filler ->
digin; 20 cobblestone -> hut), both correctly skipped for a stone-sword-equipped bot even at night
(`gearTier():3 -> should():false`), both correctly triggered/cleared on real `bot.time.isDay`
transitions via live RCON `time set` in both directions. **Not live-fired**: the `threatsNow()`
mid-shelter interrupt and the hunger-with-nothing-to-eat exit — both are straightforward reuses of
functions this file already exercises extensively elsewhere (`threatsNow()` throughout every
branch; the hunger check is the same shape as `cannotHeal()`), reviewed but not staged live this
session (a live-mob repro or a real multi-minute starve-down was more setup than this session's
remaining time budget), noted honestly rather than claimed.

**API for eng-3's agenda.js SHELTER rung** (my half is done; theirs starts here — ack-before-edit,
their file): `__survival.shelter.should()` — pure boolean predicate, safe to call every tick, ANDs
surface-exposure + confirmed night + gear-tier-below-stone + not-already-panicking + not-already-
sheltering. `__survival.shelter.enter()` — fire-and-forget (same convention as this file's own
`enter()`/`g.drill()`; do not await it directly in a rung's `act()` — poll `.status().active`
instead, same idiom as `oursRunning()` elsewhere), resolves once the bot has genuinely left
shelter with `{kind, ok, sealed, lit, exitReason}`. `__survival.shelter.exit(reason)` — call to
force an early exit (the design's third exit condition, "a project the ladder deems worth the
risk" — SHELTER itself only auto-exits on dawn/starvation/an appeared threat; anything else is the
ladder's call). `__survival.shelter.status()` — snapshot for polling/telemetry.
fix: `survival.js` (`g.shelter`, `shelterDigIn`/`shelterHut`/selector/exit state machine,
`isDaylight`/`gearTier`/`torchHere`/`digDownInto` helpers — v11).
github: felsenuboot/felcrew-mcp#105 (build lands here; design entry above stays as the argued
record, this entry supersedes its light-level-trigger and pillar-exit claims with what actually
shipped), felsenuboot/FelsenBerry#106 (new: dangerscan.js's `.light` field reads stuck/unreliable,
separate from #104's raycast-budget finding and from #17 — cross-referenced both) — flagging for
whoever owns dangerscan.js, since LIGHT/POSTURE (agenda.js) consume the same field.

### 2026-09-02 engine-dev — #106 root-caused (not fixed): dangerscan's `.light` is time-invariant
by construction, not a load bug — proposing skyLight+isDay composite, not touching dangerscan.js
type: diagnosis + proposal (doctrine: argue before building, coordinate before touching another
lane's file)
status: root cause measured and explained, not just observed; fix proposed, awaiting eng-3's
ack before any edit to dangerscan.js (their file, v5 canopy work in progress there right now)
what: team-lead's #106 assignment — determine whether LIGHT/POSTURE are reading the same stuck
value, root-cause it (mineflayer limitation vs load-order), propose the fix.

**Confirmed on a REAL fleet-stack bot, not just my QA chunk.** Read-only `/eval` against
Cnpy3102 (eng-3's live #102 bot, 2263 dangerscan scans already run — a long-lived, previously-
explored chunk, not a freshly force-loaded one): `globalThis.__danger.light: 0`,
`globalThis.__danger.skyLight: 15`, at real night (`bot.time.isDay:false`, `timeOfDay:17266`),
surface-exposed. Identical shape to #105's own finding. Rules out "only happens on brand-new
force-loaded terrain" as an explanation.

**Root cause, precise rather than "stuck":** re-read `dangerscan.js`'s own `lightInfo()`
(~line 105-160) — the exact bug class is ALREADY DOCUMENTED there, by a different name, since
issue #18 (marcel-driver): "a single light sample is NOT trustworthy... the server's light
packets simply go stale." `surfaceExposed` was hardened against exactly this (sky>0, falling
back to a real geometry column-scan when the sky read is null/stale) — but `light` itself
(`Math.max` of three raw `b.light` samples, line 148) was NEVER given the same treatment. It is
returned as-read, unconditionally, straight into `agenda.js`'s `LIGHT`/`POSTURE` thresholds.

**Why "stale packets" rather than a bug in this file's own code, precisely**: combined with
#105's own confirmed finding that raw `skyLight` is TIME-INVARIANT geometry (a fact about
Minecraft's lighting model, not a mineflayer defect — the stored per-block skyLight nibble
answers "how exposed to open sky is this column", full stop, and does not itself vary with
time of day), this means the EFFECTIVE, time-of-day-adjusted brightness a player experiences at
night is not a value the server transmits per-block at all — it's derived from skyLight +
current time + moon phase at the point something (mob spawning, rendering) needs it, computed
server-side or client-side from raw ingredients, not stored and pushed as its own packet field.
`bot.blockAt(pos).light` in mineflayer appears to reflect whatever COMBINED light value the
server last actually pushed for that block (a real, but occasional, event — chunk load, a
nearby block change) — and since a pure passage of time changes nothing about the STORED
values (skyLight doesn't change, and nothing else about that block changed either), no new
packet gets sent, so mineflayer's cached `.light` for an already-loaded, geometrically-static
block simply never updates across a day/night transition. **Best characterization: not a load-
order bug and not exactly "prismarine-world doesn't compute light" — it is asking the wrong
question of the protocol.** There is no single field that answers "how bright is it right now,
accounting for time of day" for an already-loaded chunk; one has to be composed.

**Consequence for LIGHT/POSTURE, stated as a hypothesis pending eng-3's own measurement, not a
confirmed field bug**: if `s.light` is this same time-invariant/stale-packet value fleet-wide,
`LIGHT` (`s.light < 8`) has likely been keying off whichever combined-light value happened to
be cached when each chunk first loaded — for an outdoor bot that's often near-zero-at-load
(matching what both Cnpy3102 and ShltrQA show), meaning LIGHT may be firing far more often than
real darkness warrants, independent of actual time of day. Consistent with, though not proven
to be the sole cause of, this file's own standing "torch over-placement is a non-issue" doctrine
(basekeeping.js) — this could be WHY there's more over-placement to shrug off than a purely
correct signal would produce, not just #17's narrower "next to a fresh torch" case. Framed as a
hypothesis, not a diagnosis of LIGHT/POSTURE's own code, since I did not trace their call sites
myself this session — that's the next step, and belongs with whoever owns agenda.js.

**Proposed fix (not built, not applied — dangerscan.js is eng-3's file, mid-edit right now for
#102): a skyLight + isDay composite, replacing the raw `.light` read for anything that wants
"is it dark right now."** Concretely: `effectiveLight = surfaceExposed ? (isDay ? skyLight :
0) : rawBlockLight` — on the surface, trust the reliable `skyLight` (geometry, confirmed
correct via `getSkyLight`/`.skyLight` in both this and #105's testing) gated by the reliable
`bot.time.isDay` (confirmed correct, updates immediately, #105's own fix); underground/enclosed
(`surfaceExposed:false`), skyLight is meaningless by definition (correctly near 0 whether it's
day or night down there) so fall back to the raw block-light read, which basekeeping.js's own
doctrine already treats as good enough for torch-source detection specifically (the failure
mode there is narrower and already accepted as a non-issue). This exactly mirrors #105's own
fix (same two reliable primitives, same reasoning) rather than inventing a new approach.
**Not proposing a real light re-query** (e.g. forcing a chunk re-request) — heavier, and would
still run into the same underlying fact that no server packet directly answers the composed
question; composing client-side from two already-reliable reads is cheaper and sufficient.

fix: n/a — proposal only, per team-lead's explicit instruction to coordinate with eng-3 before
touching dangerscan.js. Ack requested before this or anyone builds it.
github: felsenuboot/FelsenBerry#106 (root cause + proposed fix posted as a comment)
