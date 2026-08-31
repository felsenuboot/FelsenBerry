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
triage: (2026-09-01 synthesis) ship in the SAME status change as the 4Hz danger score + skyLight flag — spec in research/survival-doctrine.md §3; plan P0.4 in research/SYNTHESIS.md.

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
status: open
what: Marcel bled 20→0 HP in ~8s inside a 50s driver polling gap (zombie, dark pocket). panicguard.js injected as stopgap (HP<8 → abort+announce+flee home).
fix: native engine feature with configurable threshold/home; consider auto-eat gapple/food hook on the way out.
triage: (2026-09-01 synthesis) full replacement spec'd as survival.js in research/survival-doctrine.md §4 (danger score entry, creeper-override/flee-home/BREAK_LOS/wall-off branches, 10s lockout — 30s is longer than time-to-die). Also: panicguard.js:17 calls __skills.stop(bot, "panic-retreat") but the signature is stop(reason, opts) — bot object passed as reason (found by chat-protocol research, see entry below).

### 2026-09-01 team-lead — universal torch preflight (user rule)
type: safety
status: open
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
status: open
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
status: open
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
status: open
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
status: open
what: Crafted oak_log→oak_planks 15x in a row with only a settle delay AFTER the loop (not between each craft). Logs were consumed correctly (34→19) but planks came out net LOWER than before crafting (37→29 instead of the expected ~97) — a straight void, not even recoverable via collectDrops (0 drops found within 10 blocks). This is the exact desync LEARNING_HANDOFF already warns about ("800ms settle + count-verify after every craft"), rediscovered because there's no craft() helper in skills.js/ctx to make the safe pattern the default — every driver has to remember and hand-roll it.
fix: add a `ctx.craftSafe(itemName, times)` primitive to skills.js (800ms settle + inventory count-verify between every single craft call, abort+report on the first unexplained loss) and have any future skill/driver code call that instead of raw bot.craft in a loop.

### 2026-09-01 friedrich-driver — come/goto silently tunnels underground toward an arbitrary y-target
type: safety
status: open
what: Given the new user rule "stay on high sunlit ground, never below y≈100" for an escort mission, I called `come` with explicit y-targets (e.g. y=100-105) heading north leg by leg. Several stops read light:0, which I assumed was just night/shade — but a full column blockAt scan at one stop (-0,100,-192) showed solid stone from dy=2 all the way to dy=14+ above my head: the bot had tunneled through a hillside to reach the requested (x,y,z) rather than staying on the surface. The stall-buster's "dig nuisance block + hop" recovery (meant for leaf_litter etc.) will just as happily dig through stone/dirt terrain blocking a straight-line path, so a y-coordinate target that happens to intersect a hill silently becomes underground travel with zero signal to the driver — no error, no phase change, `light` alone doesn't distinguish night-outdoors from buried-in-rock.
fix: `come`/goto status should report a `surfaceExposed` or `skyLight` flag (distinct from block light) so a driver can tell "dark because night/shade" from "dark because underground"; consider capping the stall-buster's nuisance-dig depth or refusing to path through solid non-air runs longer than ~2-3 blocks without an explicit "tunneling ok" flag, since that's exactly the failure mode the new sunlit-ground safety rule is trying to prevent.
triage: (2026-09-01 synthesis) tunneling half fixed by HAUL/WORK profiles (digCost 15-25 makes walking around cheaper than digging through, research/movement-engines.md §2.2); signal half ships as the skyLight/surfaceExposed status field (P0.4); long-haul routing itself moves to ctx.gotoFar ground-snapped legs (§2.7).

### 2026-09-01 team-lead — travel tasks need a dig-free movement profile
type: safety
status: picked-up(v8 partial) — engine-dev shipped HAUL/WORK/CAVE on globalThis.__movementProfiles (runner.js), reachable from skills.js by name. NOT yet wired as come/goto's actual default — they currently run on baseMovements() (safe, digCost unset=1) not HAUL. Next step: wire come/gotoFar to switch into HAUL before issuing the goal.
what: Extends friedrich-driver's come-tunneling finding: pathfinder Movements allow digging during TRAVEL, so long-distance come/goto silently tunnels through hills (bot ends up underground believing it's surface-scouting; also leaves ugly tunnels = aesthetics violation, and eats held-tool durability).
fix: two Movements profiles in the engine — travel mode (canDig=false or dig-cost heavily penalized, surface-preferring heuristic) vs work mode (digging allowed). come/goto default to travel mode; skills that legitimately dig (mineLane/safeDescend) opt into work mode. Plus the surface-exposed signal friedrich requested (column-above scan / canSeeSky) in status.
triage: (2026-09-01 synthesis) three copy-paste-ready profiles (HAUL digCost=15 / WORK digCost=25 searchRadius=64 / CAVE digCost=1) in research/movement-engines.md §2.2 — prefer high digCost over canDig=false (a single blocking block stays clearable). Plan P0.3; surfaceExposed flag ships with the status change (P0.4).

### 2026-09-01 bernd-driver — idle-guard stomps driver pathfinder goals (looks like a physics freeze)
type: bug
status: open
what: idle-guard's drop-sweep fires its own goto mid-driver-task, repeatedly clearing/overriding the driver's pathfinder goal — presents as "stuck: no movement"/path_GoalChanged at the same spot and even survives a full relog (false lead). Diagnosed by bernd-driver post-respawn; workaround is __idleguard.stop() during extended manual travel, re-inject after.
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

### 2026-09-01 bernd-driver — autoTorch light-trigger burns supply far faster than the 7-step interval implies
type: bug
status: open
what: Carried 73 torches into a redescend of the diamond staircase (well above the new 40+ doctrine floor) and hit `no_torches` again after only ~95 combined safeDescend steps with torchEvery:7 — interval alone predicts ~14 placements, not 73+. The shaft runs through genuinely pitch-black natural cave pockets, and ctx.autoTorch's "place immediately if local light < 8" branch appears to fire on nearly every step in those stretches, not just the interval one, so total placements scale with darkness exposure, not step count.
fix: either (a) cap total torches-per-task or add a cooldown between light-triggered placements distinct from the interval counter, or (b) surface actual consumption rate to the driver (e.g. include `torchesPlacedThisTask` + a running "torches/step" ratio in status) so a driver can size the up-front carry correctly instead of guessing from step count alone. Doctrine kit sizing (40 torches) assumed interval-only consumption and was wrong for this route.

### 2026-09-01 friedrich-driver — chopTrees permanently wedges near digguard v2 protected regions (hypothesis)
type: bug
status: open
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
status: open
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
status: open
what: Bumps team-lead's earlier "injection reports can drift from reality" entry from hypothesis to confirmed harm. My bot ran digguard v1 (8-column-only) for a whole multi-hour session while v2 (protected.json, 10 regions covering house_1/main_hall_1/farm_1/pond_1/pen_1) existed on disk and was already injected on other bots. I saw a file-change notification when v2 shipped, read the source, and judged it informational — nothing told me MY running bot hadn't picked it up, since there's no diff between "v2 exists" and "v2 is live on port 3101" visible without manually eval'ing `__digguard.version`. Consequence: chopping loops I ran inside the old blind spot caused real damage — main_hall_1 audited at 21 missing edge blocks (corner posts, walls) after the fact. Separately caught myself re-injecting idleguard.js RAW once (it's role-templated via `__ROLE__`, substituted at inject time) — no signal there either, a bot would just run with a role string that matches no branch.
fix: (1) GET /state (or a cheap __skills.status add-on) should report every payload's actual installed version by reading each global (`__digguard.version`, `__idleguard.version`, etc.) so "did my bot get the update" is a one-line check instead of tribal knowledge; (2) a single inject-all.sh that handles templating (role substitution) for every payload and prints back the version numbers it just confirmed, replacing the current hand-rolled `jq -Rs '{code:.}' file | curl ...` per payload that both the version-drift and the raw-template mistake stem from; (3) consider: when a watched file (skills.js/digguard.js/idleguard.js/etc.) changes on disk and a driver's tool result flags it, the driver-facing convention should be "verify + re-inject now," not "read for awareness" — worth calling out explicitly in DRIVER_GUIDE.md since the current phrasing reads as informational-only.
