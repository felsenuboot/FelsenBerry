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
status: open
what: runner.js:160 `new Movements(bot)` = parkour on, 4-block drops, 1x1 towers, self-scaffolding → one fall death, dirt-pillar and dirt-bridge terrain scars. Runtime-patched fleet-wide this shift; patch dies on restart.
fix: runner.js spawn handler applies safe profile (allowParkour=false, maxDropDown=3, allow1by1towers=false, allowSprinting=false, infiniteLiquidDropdownDistance=false, scafoldingBlocks=[]) on every spawn event. See TODO item 5.
triage: (2026-09-01 synthesis) root cause of the "silent revert" found: reconnect re-runs createBot with stock `new Movements(bot)` — handler must be bot.on('spawn'), not once. Full profile set (HAUL/WORK/CAVE, digCost/entitiesToAvoid/blocksToAvoid) copy-paste ready in research/movement-engines.md §2.2/§2.10; note research recommends allowSprinting=true in HAUL only (fall death was parkour+drops, not sprint — verify on ridge route).

### 2026-09-01 team-lead — auto-inject payload stack on spawn
type: feature-request
status: open
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
status: open
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

### 2026-09-01 marcel-driver — __idleguard.pause() doesn't cover the stall-buster
type: bug
status: open
what: Stall-buster can clear goals during a paused window (pause only gates work-start, not the stall check).
fix: stall-buster respects pausedUntil as well.
triage: (2026-09-01 synthesis) survival.js panic entry must use __idleguard.stop() not pause() until this lands (research/survival-doctrine.md §4 entry step 2); downgrade to pause() once fixed.

### 2026-09-01 marcel-driver — orphaned goto promises poison later goals
type: quirk
status: open
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
status: open
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
status: open
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
status: open
what: User caught MettMarcel repeatedly ending up in unlit/dark spots (skyLight 0) with no torches placed, despite carrying 8-9 torches the whole time. Root cause: idleguard.js's role-default work (`mineNearest` for grass/ore/etc, `sweepDrops`) has NO skyLight check and NO torch placement anywhere in its loop — it happily gotoNear's into any patch of shade or worse while the driver isn't actively watching. This happened multiple times this shift, each one only caught because I manually checked skyLight afterward, not because the guard itself flagged anything. I stopped idle-guard on MettMarcel as an immediate mitigation (accepting reduced background productivity over unsupervised torchless wandering).
fix: idleguard.js's work loop should check `bot.blockAt(bot.entity.position).skyLight` (or block light) before/during any gotoNear, and either (a) place a torch from inventory when light<8 and continuing anyway, or (b) refuse to wander into skyLight<8 territory at all, retreating to the last known-lit spot instead. This should probably be the same shared primitive as skills.js's autoTorch (v4) rather than a separate implementation.

### 2026-09-01 research-synthesis — panicguard.js passes bot object as stop() reason
type: bug
status: open
what: panicguard.js:17 calls `__skills.stop(bot, "panic-retreat")` but the engine signature is `stop(reason, opts)` — the bot object becomes the reason string and "panic-retreat" is treated as opts. Harmless today (stop still fires) but wrong, and it garbles the stop-reason in logs. Found by the chat-protocol research track while reading payloads (research/chat-protocol.md §5.3).
fix: `__skills.stop("panic-retreat")`; moot once survival.js replaces panicguard (research/survival-doctrine.md §4), but fix the injected stopgap until then.
