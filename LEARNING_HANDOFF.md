# Handoff: the "learning" approach for the Minecraft bot fleet

For a friendly independent agent joining development. Working dir: /home/felix/minecraft/bots.
Server: 100.101.197.44:25565, offline mode, MC 1.21.11, survival.

## Core principle

**The LLM thinks once; code runs forever.** Any behavior a bot performs twice gets
extracted into a deterministic in-bot algorithm. LLM agents never drive actions
step-by-step in steady state — they pick tasks, set parameters, poll cheaply, and
reason only when an algorithm surfaces a failure. This is the Baritone/Voyager
insight applied to our stack, and it's what keeps token costs near zero at scale.

## The three layers

1. **In-bot deterministic layer** (Node, mineflayer 4.38 + plugins): `runner.js` gives
   every bot an HTTP API (127.0.0.1, one port per bot) with high-level endpoints —
   /mine, /hunt, /follow, /goto, /stop, /autoeat — plus /eval as the escape hatch.
   A richer injectable task engine (`skills.js`: chopTrees, mineLane, collectDrops,
   huntAnimals, depositToChest, safeDescend, installed into RUNNING bots via /eval,
   single-poll status contract) is being built by a workflow right now.
2. **Driver layer**: one LLM agent per bot issues task calls and polls. Contract:
   escalate to manual /eval reasoning only after an algorithm fails twice; see
   DRIVER_GUIDE.md once it lands.
3. **Orchestrator**: a supervising loop re-tasks idle drivers, respawns dead bots,
   and folds every completed report back into the knowledge base.

## The learning loop (how capability accumulates)

- **Rule of twice**: hand-driven twice → becomes a skills.js algorithm.
- **Field quirks become code**: every bug a driver discovers gets baked into the
  algorithms + docs, not re-discovered. Current list: pathfinder `stop()` poisons the
  next goto (use `setGoal(null)`); MCP equip doesn't persist between digs (re-equip
  per batch); drops must be collected immediately (rival bots snipe within seconds);
  entity/inventory desync is fixed by relog (`bot.quit()` + auto-reconnect built in);
  /mine hangs on drops needing a missing tool AND on fully-buried targets
  (collectblock never equips the pick — use a manual eval loop for buried blocks);
  long /goto times out at 60s (loop it, multi-leg); tools BREAK silently and bots
  punch on at half speed — verify the role tool every ~20 uses, replacing a broken
  tool outranks the job (tool-maintenance rule); an idle-guard (idleguard.js, v3)
  is injected per bot so idle time auto-converts to role-default work — it must be
  re-injected after every process restart. v3 fixes: driver-silence dormancy,
  instant yield on external bot commands (setGoal/goto/dig/equip/craft/
  openContainer/activateBlock are all activity signals), stall-buster (clears any
  goal producing no movement ~15s), harvestability gate (never digs what drops
  nothing), orphan-timer killer + sticky stop (zombie re-arms impossible), and
  `__idleguard.pause(ms)` — CALL THIS at the start of any long monitoring /eval,
  or the guard reads your in-flight eval as silence and takes over;
  crafting desync voids items in rapid bot.craft loops — 800ms settle +
  count-verify after every craft, then sweep ground drops (Bernd + Kevin both hit
  this); CHECK the chat ledger for an open USING before announcing your own lease
  (a lease collision happened — no losses, but don't rely on luck).
  `bot.openContainer(block)` can NEVER open a furnace — mineflayer's chest.js plugin
  only allows chest-family window types (generic/chest/dispenser/shulker_box/
  hopper/etc); `furnace` isn't in that allowlist, so it always throws
  "containerToOpen is neither a block nor an entity". Use `bot.openFurnace(block)`
  for furnace mailboxes instead (BuddelBernd, 2026-08-31, furnace_1 collection).
  A placed TORCH occupying the exact block the bot is standing/walking onto wedges
  movement the same way `leaf_litter` does — onGround stays true, no horizontal
  collision reported, but the bot is frozen in place (goto/come reports "stuck: no
  movement despite an active path", and the stall-buster's own nuisance-dig+hop
  recovery can also fail to clear it). This bites specifically on a bot's OWN
  auto-placed torches inside a narrow 1-wide staircase corridor: walking back over
  a spot you just torched can wedge you. Fix: `bot.blockAt(feet)` check for
  `name==='torch'`, `bot.dig(block)` (torches break instantly, any tool/none works),
  then retry pathing. Consider having safeDescend/mineLane's stall-buster check for
  a torch at the bot's own feet, not just leaf_litter (BuddelBernd, 2026-08-31).
  Tools break with NO warning mid-task — a long safeDescend run silently exhausted
  both the iron_pickaxe AND the fallback wooden_pickaxe (durability wasn't tracked
  by the driver), then failed with `no_tool` deep in a shaft with zero replacement
  tool in inventory. Requires a full round trip back to base to craft a new one.
  Recommendation: track/report held-tool durability in status output, or have the
  engine auto-warn (like the existing `no_torches` line) when a role tool drops
  below ~20 durability so the driver can bank/replace it before it breaks mid-job,
  not after (BuddelBernd, 2026-08-31).
  Standing wedged directly between two adjacent chests (e.g. depot chest A and
  chest B, 2 blocks apart with the bot in the 1-wide gap) can produce a HARD
  movement freeze that survives `setGoal(null)`, `clearControlStates()`, and even
  raw `setControlState('forward',true)` — position reads bit-for-bit identical
  across many physics ticks, not just a slow pathfinder retry loop. This is worse
  than the leaf_litter/torch wedges (those clear with a dig+hop; this didn't).
  Fix that worked: `bot.quit()` to force the runner's auto-reconnect (fresh bot
  object + fresh physics engine), then re-inject skills.js AND idleguard.js (role
  substituted) before doing anything else — reconnect wipes both, per the existing
  hard reconnect rule. A few `path_GoalChanged` errors on the first travel attempt
  after reconnect are normal transient noise; `setGoal(null)` + retry once clears
  them (BuddelBernd, 2026-08-31). Root cause undetermined — block-name checks on
  all 8 neighbors showed nothing solid, so this may be a chest-hitbox / narrow-gap
  physics edge case worth a closer look if it recurs.
  CORRECTION/real root cause found later same session: persistent `path_GoalChanged`
  loops (retry after retry, "stuck" even on a fresh reconnected bot, manual
  `setControlState('forward',true)` also producing zero position change) were
  actually **idle-guard fighting the driver for `bot.pathfinder`'s goal** — its
  drop-sweep behavior was firing its own goto mid-task and stomping the driver's
  goal every few seconds, which reads exactly like a physics freeze if you only
  check position deltas over a couple seconds. `__idleguard.pause(ms)` is NOT
  enough if your diagnostic/manual work runs longer than the pause window (the
  guard resumes and re-fires); the reliable fix is `__idleguard.stop()` for the
  duration of any extended manual travel troubleshooting, then re-inject
  idleguard.js afterward to bring it back (there is no `start()` — re-injection is
  idempotent and restores it). The `bot.quit()` relog in the entry above likely
  "worked" only because a fresh guard's idle timer resets and buys a few quiet
  seconds, not because reconnecting fixes anything — don't reach for relog first;
  reach for `__idleguard.stop()` first when you see repeated GoalChanged/stuck
  errors that survive `setGoal(null)` (BuddelBernd, 2026-08-31).
- **skills.js field quirks (verified live 2026-08-31, baked into the library)**:
  `leaf_litter` physics wedge — a bot standing in leaf_litter gets onGround=false
  forever, never jumps, and pathfinder holds a "success" path while the bot stands
  still (skills.js ctx.goto auto-recovers: 6s stall detector → dig the nuisance
  block + hop); `goals.GoalBreakBlock` is broken in pathfinder 2.4.5 (bad ctor args
  + isEnd) — use `GoalLookAtBlock(pos, bot.world)`; `bot.dig` on a block the held
  tool can't harvest NEVER resolves — gate with `Boolean(block.canHarvest(heldType))`
  and race every dig with a timeout; `GoalNear` near cluttered spots (the depot) can
  recalc partial paths forever without rejecting; `window.deposit(type,null,count)`
  with count null moves 1 item, not all; `bot.openContainer` has no timeout (blocked
  chest = hung /eval); runner's POST /stop does NOT cancel __skills tasks (only
  clears the pathfinder goal) — use `./task.sh <port> stop`.
- **MCP-bot (KackboonKevin) quirks**: craft-item "torch" VOIDS materials (reports
  success, output vanishes — never craft torches via MCP); smelt-item takes only the
  first output item and needs input in-inventory to interact (recover jammed furnace
  contents by breaking + re-placing it); no chest access at all — the workaround is
  the FURNACE MAILBOX: Kevin smelts with takeOutput:false and announces in chat for
  a framework bot to collect from the furnace; place-block needs a visible reference
  face (side-place + reposition on "No suitable reference block found");
  `get-block-info` takes FLAT `x`/`y`/`z` number params, not a nested
  `{"position":{x,y,z}}` object — the nested form fails validation with
  "Expected number, received nan" (found live 2026-09-01, kevin-driver).
  Connection-state error text tells you what's happening: mid-restart, any
  mcp__minecraft__* call returns "Bot is connecting to the Minecraft server.
  Please wait a moment and try again." — a plain wait-then-retry (8-20s) has
  always cleared this live (verified across two server restarts same shift).
  A full server outage instead returns "Cannot connect to Minecraft server at
  <host>:<port>" — no in-flight retry signaled. There is NO reconnect/restart
  tool exposed to the Kevin driver in the current toolset (only get/move/dig/
  place/equip/craft/smelt/chat/find/list/look/jump-type tools) — a driver
  hitting the "Cannot connect" message can only wait and periodically retry
  (not in a tight loop), never force a reconnect. Root cause of the two
  distinct messages (does the underlying yuniko MCP bot object retry on its
  own eventually, or does something external need to restart it?) not
  confirmed — worth an engine-side look if a "Cannot connect" state is ever
  seen to persist past a full server-back window (kevin-driver, 2026-09-01).
- **Crafting-void quirk, correction (verified live 2026-08-31, FurzFriedrich)**: for
  crafts of *unstackable* items (tools/weapons — pickaxe, axe, sword, all max stack
  1), a count-verify using `inventory.items().find(x=>x.name===...)` ALWAYS looks
  like a failure after the first successful craft, because each new copy lands in a
  fresh slot and `.find()` only ever returns the first (stale) stack. This looks
  identical to the voiding quirk but is a driver-side counting bug, not desync — no
  materials or items were actually lost when checked (0 ground drops, inventory
  slots showed the real items sitting there). Fix: verify unstackable crafts with a
  SUM across all matching-name stacks (`items().filter(x=>x.name===n).reduce(...)`),
  not `.find()`. This does not rule out the original desync/void quirk for
  *stackable* items (torches etc., Bernd/Kevin's reports) — keep the 800ms settle +
  sweep discipline for those; just don't mistake the tool-counting bug for it.
- **Crafting-void quirk, reproduced on stackable items (FurzFriedrich, same shift)**:
  hit it for real this time — `bot.craft(recipe, 11, null)` (batched count in one
  call, no table) silently ate 2 coal + 2 stick with 0 torches produced ("missing
  ingredient" thrown mid-batch); then two SEPARATE single-craft calls for
  `oak_planks` (also no table, `requiresTable:false`, correct recipe/ids verified)
  each ate 1 oak_log and produced 0 planks, no error thrown at all. Switching the
  exact same recipe/ingredients to `bot.craft(recipe, 1, tableBlock)` AT
  crafting_table_1 fixed it immediately and stayed 100% reliable (0 failures across
  ~16 more crafts: planks, sticks, 2x wooden_hoe). Sample is small, but this shift's
  overall tally is 12/12 success at the table (iron kit) vs 2 silent voids out of a
  handful of no-table attempts — until someone characterizes it further, driver
  rule of thumb: prefer crafting AT crafting_table_1 even for recipes that don't
  require it, and never pass a `count>1` batch to `bot.craft` — always loop
  one-at-a-time with settle+verify.
- **Torch discipline (engine v4, verified live 2026-08-31, KloputzKarl test bot)**:
  mineLane/safeDescend now auto-place torches via a shared `ctx.autoTorch` primitive
  (every ~7 blocks/steps, or sooner if local light < 8; one-time `no_torches` warning
  log when out — restock from depot chest B). Quirk found live: mineLane's
  vein-following can dig out a just-placed torch's support block later in the same
  task; the torch pops, `collectDrops` sweeps it back up, and it gets placed again
  elsewhere — inflates the `torches` result counter above net consumption (saw 9
  placements from 8 crafted torches, 1 left over); harmless, just don't read the
  counter as an exact torch-economy log. Separately: `bot.craft(recipe, N, table)`
  can yield more output than `N * recipe.result.count` (saw 8 torches from a call
  requesting count 1 with recipe.result.count 4) — verify actual inventory after
  crafting, don't trust the requested count.
- **chopTrees has no natural-tree guard — placed logs get harvested (incident,
  FurzFriedrich, 2026-08-31)**: `chopTrees`'s flood-fill treats ANY connected blob
  of log blocks as a tree, felling it bottom-up — it does not check for attached
  leaves or distinguish a wild tree from placed structure logs. Chopping near the
  plaza (-7,110,-2, well inside the ~25-block zone around x=-8..2,z=-1..9) felled
  part of Peter's torch_posts_1 log-frame pillars along with real trees (16
  oak_log collected in one run — far more than a couple of wild oaks would give).
  Peter had to spend 12 depot oak_log rebuilding; Friedrich banked 16 oak_log back
  to chest A as restitution. FIX NEEDED in skills.js: chopTrees should verify each
  candidate trunk has attached leaves within ~2 blocks (natural-tree canopy check)
  before felling, and/or skip any log within N blocks of a BASE.md `built` row.
  Until that lands, DRIVER RULE for chopping: only fell trunks with visible leaves
  attached (verify via `blockAt` before starting) AND stay >25 blocks from the
  plaza (x=-8..2, z=-1..9) or any other BASE.md-registered structure.
- **Task queue (engine v6, verified live 2026-08-31, KloputzKarl test bot)**: `__skills.enqueue`
  chains jobs and auto-advances IN-PROCESS — `S._onTaskEnd` runs in the same synchronous
  continuation as `start()`'s `finally`, so no HTTP poll can ever observe `running:false`
  while items are pending (measured `gapMs` 0 across 4- and 8-task chains; a 3-task queue
  drained over 90s with ZERO polls). Quirks found while building it: (1) bash `${3:?msg}`
  ENDS the expansion at the first `}` inside the message — a `:?` default containing
  `{name,args}` silently appended a stray `}` to the JSON argument and broke `task.sh queue`
  with "Unmatched '}'"; keep braces out of `${var:?...}` messages. (2) `${4:-\{\}}` (the
  pre-existing arg default in task.sh) expands to a LITERAL `\{\}` when piped to jq — only
  ever worked because callers always passed args; fixed to an explicit empty test. (3) The
  queue multiplies chat (phase + done per task): 8 fast jobs queued ~17 lines at the 1.3s
  throttle, pushing chat 20s+ into the future, so `say()` now DROPS anything scheduled >12s
  out (logged as `chat dropped (backlog)`) rather than replaying stale narration. (4) A
  queued `mineLane` on a bot with no pickaxe halts the batch with `no_tool` — exactly the
  desired "replacing a broken tool outranks the job" escalation, and the reason `no_tool`
  is left haltable rather than skippable. Idle-guard coexistence verified: guard `runs`
  stayed 0 through a 75s queue+fallback window and it was only paused, never disabled.
- **Blueprint building (engine v7, verified live 2026-09-01, HuettenHorst test bot on 3107)**:
  `prismarine-schematic` 1.3.0 ADOPTED and works on 1.21.11 (round-tripped a generated
  5x4x5 sponge `.schem`, `Schematic.read(buf, '1.21.11')` + `forEach` gave the exact
  bill 16 oak_log / 46 oak_planks). Parsing lives in runner.js (`POST /blueprint/load`)
  because skills.js can never `require()`; it stashes the placement list on
  `globalThis.__blueprints`, which /eval code sees because both run in the same process.
  Results: frameStructure 46/46 placed + 46/46 verified; buildSchematic 62/62 placed +
  62/62 verified with 1 chest restock; inline placements (incl. placing a chest) 2/2.
  Quirks found/confirmed while building it:
  (1) `bot.placeBlock` FAILS with "Event blockUpdate:(x,y,z) did not fire within timeout
  of 5000ms" on some placements even when the spot is legal, and can also resolve without
  the block appearing — same class as the bot.dig-never-resolves quirk. Every raw /eval
  placement must be raced AND re-checked with `bot.blockAt`; a first failure is often
  transient (a retry at the same spot succeeded).
  (2) `mineflayer-pathfinder` Movements has `exclusionAreasBreak` (2.4.5): a function
  returning >=100 makes a block un-breakable to the planner (`safeToBreak` checks
  `exclusionBreak(block) < 100`). This is a MUCH better build guard than `canDig=false`
  (which also breaks short hops inside a half-built footprint) — the builder keeps normal
  pathing but cannot chew its own structure. `scafoldingBlocks = []` (note pathfinder's
  misspelling) stops it spending build materials as scaffolding; by default it will happily
  place your dirt and cobblestone.
  (3) `mineflayer-schem` 1.5.2 TRIALED AND REJECTED for 1.21.11: its `Build` class wants a
  legacy mcedit schematic (`.width/.height/.length`) and carries a hard-coded pre-flattening
  numeric BLOCK_ID_MAP (0=air, 1=stone, 4=cobblestone…). It cannot consume a sponge
  `.schem` or 1.13+ state IDs. Installed with `--no-save`, inspected, removed. Don't retry.
  (4) A terrain "flat site" scan that starts its downward search at a fixed ceiling silently
  reports the CEILING as the surface for every column above it — a 33x33 scan produced 134
  fake "flat 5x5 plateaus at y=127" and the first build attempt walked into solid stone.
  Always search down from well above the bot AND assert the block above the hit is air.
  (5) Building on natural terrain is the real bottleneck, not the builder: across ~2000
  scanned columns of this world there was often NO uniform-height clear 5x5. Expect to level
  a site (buildFloor) or accept `clearSite:true` digging into a slope.
- **Driver anti-wedge rules**: never repeat an identical polling eval more than 3
  times (a wedged driver polling a stuck goal froze a bot for minutes); wrap every
  goto in a ~20s Promise.race timeout; batch 20-40 blocks per eval.
- **Log-mining for chat history beyond the live buffer** (found live 2026-09-01,
  kevin-driver): `read-chat`/the live chat buffer only holds ~100 messages — at this
  fleet's chat volume (idle-guard narration from our bots + CAVECREW's) that's under
  3 minutes of real history, nowhere near enough to reconstruct e.g. a diplomatic
  negotiation. Any framework bot's `logs/<name>.log` is effectively a full,
  ISO-timestamped, server-wide chat transcript going back to that bot's spawn
  (mineflayer logs every `chat` event it observes, not just its own lines) —
  `grep -h "<chat>" logs/*.log | grep -i "<keyword>"`, sorted by timestamp, recovers
  history the live buffer can't. This is Kevin's ONLY way to see chat history beyond
  the live buffer (MCP-driven, no log file of his own) but it's useful for any driver
  reconstructing something that happened more than a few minutes ago.
- **Tool durability on travel**: pathfinder digs traversal blocks with the HELD tool
  — a long move can silently eat an iron pickaxe's 250 durability (happened live).
  Equip a cheap stone tool (or nothing) before long moves; save the good tool for
  the actual job. Also: smelt-item can't load fuel past an occupied fuel slot —
  recover a jammed furnace by break→scoop→re-place.
- **Research before build**: capability jumps go through multi-model research
  workflows (parallel Fable/Opus tracks → synthesis) producing specs; an implementer
  then builds and MUST verify live on the server before the capability counts as real.
  Latest synthesis: AUTONOMY_PLAN.md (mindcraft skill vendoring, packet hardening,
  strict task mutex, ashfinder second engine; real Baritone deferred — needs Java 21).
- **Durable memory**: cross-session rules live in Claude's project memory; shared
  operational state lives in these repo files so ANY agent can pick it up.
- **Movements safety profile can silently revert without a reconnect (killed
  MettMarcel, verified live 2026-08-31)**: found `bot.pathfinder.movements` running
  on stock defaults (allowParkour:true, maxDropDown:4, allow1by1towers:true,
  allowSprinting:true, infiniteLiquidDropdownDistance:true) mid-session with no
  `connected:false->true` transition in between — the bot fell off the SE hilltop
  and died ("fell from a high place") a few minutes into unsupervised hilltop travel.
  Don't trust "I verified the profile after my last reconnect" — periodically
  re-check `bot.pathfinder.movements` (cheap read) on any bot doing hilly/edge-prone
  travel, especially after a long idle-guard or driver-silence stretch, and reapply
  (`allowSprinting=false; maxDropDown=3; allowParkour=false; allow1by1towers=false;
  infiniteLiquidDropdownDistance=false; bot.pathfinder.setMovements(m)`) if it's off.
  Root cause not confirmed (something resetting it outside the tracked reconnect
  path, or the runner.js spawn-handler patch not actually persisting) — worth an
  engine-side audit.
- **Bucket fill/empty: `bot.activateBlock(waterBlock)` silently no-ops, use
  `bot.activateItem()` instead (found live 2026-09-01, MettMarcel's pond build)**:
  equipping an empty bucket and calling `await bot.activateBlock(waterSourceBlock)`
  after `bot.lookAt` resolved with NO error but produced no `water_bucket` — item
  stayed an empty `bucket`. Swapping to `bot.lookAt(pos, true)` followed by a plain
  `bot.activateItem()` (no block argument, just uses the current look direction)
  filled the bucket immediately, and the same pattern also correctly emptied a
  `water_bucket` back into a dug-out basin. Use `activateItem()` for bucket
  fill/place specifically — this does NOT generalize to every right-click-on-block
  interaction (see the hoe-tilling entry immediately below, which needs the OPPOSITE
  call); treat activateItem-for-liquids as its own special case, not a blanket rule.
- **Correction to the entry above (2026-09-01, karl-driver, farm_1 build)**: hoe
  tilling does NOT follow the bucket pattern. `bot.lookAt(block, true)` + plain
  `bot.activateItem()` never converted grass_block/dirt to farmland (0/13 attempts).
  What worked 100% of the time: equip the hoe, `bot.lookAt(pos.offset(0.5,1,0.5), true)`
  (the block's TOP FACE, not its center), then `bot.activateBlock(block, new
  Vec3(0,1,0))` WITH an explicit up-face vector — a bare `activateBlock(block)` also
  failed once in a spot-check. So: buckets use `activateItem()`, tilling (and
  presumably other right-click-on-block interactions — bonemeal, doors, non-water
  bucket-place) use `activateBlock(block, faceVector)` with the face vector pointed
  at the actual face you're targeting. Don't assume one call generalizes to the other.
- **`bot.blockAt()` on chunks the bot isn't physically near can return stale/wrong
  data (found live 2026-08-31, MettMarcel's terrain-scar hunt)**: a remote heightmap
  scan run while the bot stood elsewhere reported 30+ "floating dirt" blocks
  scattered across a hillside, with the count and exact coordinates CHANGING between
  successive identical scans (31 -> 32, different cells) as the bot moved and
  different chunks (re)loaded. Re-running the identical scan while physically
  standing in the scanned area, chunks freshly loaded, found ZERO floating dirt in
  three separate zones that had all shown "hits" remotely. Don't trust `blockAt`
  terrain surveys of chunks you haven't walked through recently — `goto` there first
  (or walk within render distance) before treating a block scan as ground truth,
  especially for anything you're about to report as fleet-wide intel or dig up.
- **Which server a bot is on can be routed by ENV VAR, not just CLI flags — check
  both before diagnosing against a coordinate table (found live 2026-09-01, near-miss
  on a false "base wiped" alarm)**: `runner.js`'s host/port resolve as `--host`/
  `--mcport` flag, THEN `MC_HOST`/`MC_PORT` env vars, THEN the fleet default
  (`100.101.197.44:25565`, the main server). SoloSauhund's process args show neither
  flag, so a `ps aux` / process-args check alone makes it LOOK like it's on the fleet
  default (main) — but `spawn.sh` actually routes it to the local test world
  (`127.0.0.1:25599`, seed felcrewtest) via the env vars, invisible to a flag-only
  check. Diagnosing SoloSauhund's `bot.blockAt` reads against `protected.json`'s
  MAIN-server coordinates (home/depot/torch_posts_1/etc.) then looks exactly like the
  entire base was destroyed — every coordinate reads air — when the real explanation
  is just "this is a fresh world where nothing was ever built there." Confirm which
  server a bot is actually on from the bot's OWN evidence before trusting a
  process-args check: its log line ("connecting to \<host\>:\<port\>") or, more
  reliably, its `/proc/<pid>/environ` for `MC_HOST`/`MC_PORT`. **SoloSauhund:3120
  specifically is the standing LOCAL soak-test bot** (env-routed to 25599) — never
  diagnose it against main-server coordinates or state.
- **Orphaned goto promises poison later goals ("goal was changed" errors, found live
  2026-08-31)**: a manual `Promise.race([bot.pathfinder.goto(goal), timeout])` loop
  that does NOT call `bot.pathfinder.setGoal(null)` on the timeout branch leaves the
  underlying goto() alive after your code moves on — DRIVER_GUIDE says to race with
  setGoal(null) on the loser for exactly this reason. Symptom: every subsequent
  `come`/skill-engine goto fails immediately with `path_GoalChanged: travel failed
  after 2 attempts`, even minutes later and even with idle-guard fully stopped, and
  __idleguard.pause() does NOT protect against it either (that's a separate gap, see
  below). Fix: `bot.pathfinder.setGoal(null); bot.clearControlStates(); await
  sleep(3000); bot.pathfinder.setGoal(null);` then retry — the 3s settle lets the
  orphaned promise reject/die before you reissue a real goal.
- **`__idleguard.pause(ms)` does not protect against the stall-buster (v3, found live
  2026-08-31)**: the timer's stall-buster block (clears the goal after ~15s of
  <0.3-block movement) runs BEFORE the `externalActive()`/pause check in the same
  tick, so a paused guard can still yank the goal out from under a long/slow
  legitimate travel (steep terrain, cluttered pathing). Symptom: `path_GoalChanged`
  errors on `come` tasks that pause() was supposed to protect. Workaround until
  fixed: `globalThis.__idleguard.stop()` before any travel you expect to be slow or
  stuck-prone, re-inject/restart it after. Engine fix would be moving the
  externalActive() check above the stall-buster block.

## Shared knowledge files (read before acting)

README.md (API + spawn/stop/list), DEPOT.md (shared chests + chat-ledger protocol),
BASE.md (infrastructure registry: check-before-build, USING/FREE leases — appears
once the base crew finishes), AUTONOMY_PLAN.md, DRIVER_GUIDE.md (pending),
logs/<bot>.log (timestamped event history per bot). In-game chat is the runtime
coordination bus — bots announce phases (English) and DEPOT/USING/FREE ledger lines.

## Hard conventions for any new agent

1. Never command another bot's port; spawn your own (`./spawn.sh <Name> <310x>`).
2. Bot names: incredibly stupid/funny, ≤16 chars, [A-Za-z0-9_]. Check pids/ for taken.
3. Narrate every activity phase in-game, in English. Best tool always equipped.
   Every bot carries >=8 torches on ANY excursion and lights dark workspaces (user rule).
   Never leave drops. Never attack players. Never touch others' chests/builds.
4. Check BASE.md before building infrastructure (no duplicates); lease exclusive
   things via chat. Deposit excess per DEPOT.md.
5. Extend skills.js rather than hand-driving; leave every quirk you find in this file.
6. **`mcp__minecraft__*` MCP tools are kevin-driver-only** (user law, 2026-09-01). They
   appear available in every teammate's environment via project MCP config inheritance,
   but using them from anywhere except kevin-driver risks spawning a rival KackboonKevin
   connection and recreating the duplicate_login identity war that was already cured once.
   Framework bots (anything with a runner.js HTTP port) are driven exclusively via that
   port; Kevin (the one MCP-native bot) is driven exclusively by kevin-driver. If an MCP
   tool shows up as available to you and you're not kevin-driver, don't call it — spotted
   and self-policed once already by marcel-driver, credit where due.

**LIGHT RULE (supersedes the y≥100 elevation rule, 2026-09-01):** y-coordinate is
NOT a safety proxy — Marcel stood at y=109 under a solid overhang next to a 70+
mob cluster with skyLight 0. The real check: `bot.world.getSkyLight(pos)` /
skyLight > 0 (or a column-above scan) = genuinely on the surface and safe under
frozen daylight; skyLight 0 = treat as a cave regardless of y. Two hazard zones
are registered in BASE.md (clusters near (-33,117,110) and (-6,109,-51)) — check
before routing north/southeast.
