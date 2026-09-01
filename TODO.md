# Fleet TODO (user-requested, 2026-08-31)

## 0-FINAL. Breaking point (2026-08-31 ~23:00) — FULL TEARDOWN EXECUTED
All four bot processes STOPPED (fleet offline, left the server); both remaining
driver agents aborted mid-shift. Restart any bot: `./spawn.sh <Name> <port>`
(FurzFriedrich 3101, MettMarcel 3102, BuddelBernd 3103, PflasterPeter 3105 —
inventories persist server-side per name), then `./inject.sh <port>` (skills) and
inject idleguard.js (role-templated) — injections do NOT survive restarts.

Aborted mid-action, resume from world state not memory:
- **Marcel's driver died un-sticking a hung furnace putFuel with the window open**:
  furnace_2 (-3,111,2) may contain raw meat and/or fuel; Marcel's inventory carries
  the rest of the herd meat (herd was culled, breeding pair + pen status UNKNOWN —
  verify at (-35,94,48)). Chest C food stock: still likely EMPTY. M3 remains the
  fleet bottleneck.
- **Peter's driver died re-checking the quarry lane**: plaza reportedly west-half
  done, lane partially paved — verify via blockAt sampling against BASE.md specs
  (plaza_1: x=-8..2, z=-1..9 floor y110; quarry_lane_1: x=-5..2, y110, z=5..7);
  furnace_2 exists (Marcel USING'd it); torch_posts_1 unbuilt (64 torches in chest
  B); flip BASE.md rows only after verifying blocks.

## 0. Unfinished from session end (2026-08-31 ~23:00)
- **Plugin ecosystem survey ABORTED mid-run** — resume in a future session with:
  `Workflow({scriptPath: ".claude/.../plugin-ecosystem-survey-wf_1a7e2a50-eef.js", resumeFromRunId: "wf_1a7e2a50-eef"})`
  (completed research tracks replay from cache). Segments: building/visual
  (mineflayer-builder + prismarine-schematic + headless prismarine-viewer
  screenshots), combat/movement/ops, long-tail npm discovery. Checked already:
  TheDudeFromCI plugin list = only collectblock/statemachine/pathfinder, all known.
  User-supplied source for the survey: **https://npms.io/** — search "mineflayer"
  there (surfaces e.g. mineflayer-auto-tool ("autotool") and many more small
  plugins); have the long-tail researcher sweep npms.io search results by score
  and recency in addition to npmjs.com/GitHub.
  Already adopted (don't re-evaluate): github.com/PrismarineJS/mineflayer-tool —
  installed as mineflayer-tool 1.2.0, powering /mine's auto-equip and the skill
  engine's equipBestTool.
- **Sync-point driver migration NOT executed** (persistent doc-onboarded drivers
  replacing per-shift agents) — the skill engine (skills.js v3) is delivered,
  live-tested, and injected on 3101/3103; inject remaining bots via ./inject.sh
  and follow DRIVER_GUIDE.md. Final shift reports from Kevin/Marcel/Peter drivers
  may be in this session's transcript only — treat chests/BASE.md/DEPOT.md as
  ground truth.
- Bot processes are detached and SURVIVE the session (idle-guard v3 keeps them
  lightly productive); KackboonKevin (MCP) disconnects when the session closes.
- **~41 IRON INGOTS ARE SITTING IN furnace_1 at (-3,111,3)** — Kevin's final two
  mailbox batches (20 + 21 smelted) were never collected because the fleet drivers
  had wound down. FIRST JOB next session: a framework bot openContainer's furnace_1,
  banks them to chest B ("DEPOT +41 iron_ingot"). That funds all four iron kits (M2).
- New quirk (Kevin's last find, also in LEARNING_HANDOFF): pathfinder traversal digs
  with the HELD tool and eats its durability (killed an iron pickaxe in ~220 blocks
  of travel digging) — equip a cheap stone tool before long moves.

## 1. Human-looking building & mining (aesthetics pass)
Structures and mining sites should look like a tidy human built them, not bot damage:
- Buildings: straight walls, symmetric layouts, consistent materials (no dirt patches
  in cobble walls), framed corners (logs as pillars, planks infill), lit properly,
  doors/openings where a human would put them.
- Mining: no naked 1x1 holes or surface scars — staircase entrances with ladders or
  steps, torch spacing every 7 blocks, backfill exploratory holes, close shafts with
  a marker block. Quarries get clean rectangular walls and ramp access.
- Implementation idea: add "blueprint" skills to the skill library (buildWall,
  buildFloor, staircaseDown with rails/torches, frameStructure) that take dimensions
  + material and place blocks in structured order; drivers stop free-handing.

**BUILDING HALF: DONE (engine v7, verified live 2026-09-01, HuettenHorst on 3107).**
`prismarine-schematic` 1.3.0 adopted as the file layer: `POST /blueprint/load` (runner.js)
parses a `.schem` into an ordered placement list on `globalThis.__blueprints`, and
`buildSchematic` builds it — with restocking from a `chest:{x,y,z}` arg, `clearSite`,
deferred retries for cells with no reference face, and a block-by-block `verified` pass.
buildWall/buildFloor/frameStructure were rewritten onto the same builder core (args and
result keys stay backward compatible) and now also generate their placement lists through
pure `__skills.blueprints.{wall,floor,frame}` generators, so they still work with no
schematic library present. frameStructure delivers the TODO-1 aesthetic directly: log
corner posts + plank infill + a real 1x2 doorway on any named side, optional flat roof and
interior floor. Live results: frameStructure 46/46 verified, buildSchematic (5x4x5 hut)
62/62 verified with 1 restock trip, buildWall 12/12 from an empty inventory via one restock.
`mineflayer-schem` 1.5.2 trialed and rejected (legacy mcedit/pre-flattening only — see
LEARNING_HANDOFF.md). Docs: README.md "Blueprint building", DRIVER_GUIDE.md "BLUEPRINT
BUILDING". STILL OPEN in this item: (a) the MINING half (no naked 1x1 holes, backfill,
shaft markers, ramp access for quarries); (b) `buildStaircase` is the one build skill never
live-run; (c) schematic block STATES are ignored — stairs/doors/torches in a third-party
`.schem` get default facing and show up as `verified.mismatched` (v7.1 work); (d) a
`levelSite`/terrain-flattening helper, because finding a naturally flat 5x5 in this world
is harder than building on it.

## 2. Baritone pathfinding + mining functions
Two tracks (research already done, see AUTONOMY_PLAN.md):
- **ashfinder now**: add `@miner-org/mineflayer-baritone` 4.6.2 as an OPT-IN second
  movement engine (`bot.ashfinder`) behind a new `/goto2` route, keeping
  mineflayer-pathfinder as default (mineflayer-pvp/collectblock are hard-wired to
  bot.pathfinder). Compare /goto vs /goto2 on the routes that currently 60s-timeout
  (e.g. depot → NW forest detour) and adopt the winner per route class. Evaluate its
  mining helpers vs our mineLane skill.
- **Real Baritone later**: feasible on MC 1.21.11 via MeteorDevelopment's Baritone
  fork + HeadlessMc 2.10.0 (verified artifacts + offline-auth config documented in
  AUTONOMY_PLAN.md). HARD BLOCKER: Java 21 not installed — needs
  `sudo pacman -S --needed jdk21-openjdk` (Felix must run this, root). Once Java
  exists: sidecar JVM bot for long-haul travel + Baritone's #mine/#goto quality,
  ~1.5-2GB RAM, driven via HeadlessMc CLI `msg "#goto x y z"`.

## 2b. Torch discipline while mining (user rule) — DONE (engine v4, verified live 2026-08-31)
Implemented as a shared `ctx.autoTorch(state, every)` primitive in skills.js, wired
into both mineLane (previously had none) and safeDescend (previously ad-hoc/interval
only): places a torch every ~7 blocks/steps (covers junctions and working faces since
it fires on every real dig in mineLane) OR immediately if local light < 8; logs a
one-time `no_torches` warning per task when the bot is out (no spam). Verified live on
test bot KloputzKarl (port 3106, since stopped): no_torches fired correctly when empty,
torches placed correctly once restocked (mineLane: 9 placements/8 crafted — some
re-placement of undermined torches during vein-following, documented as a known quirk
in README.md; safeDescend: 4/4 placed cleanly in a fresh dark shaft). Drivers: re-inject
via ./inject.sh (idempotent) to pick up engine v4 — no other driver-side change needed.

## 3. Open chat coordination (bots ↔ players ↔ foreign bots)
Make the fleet coordinate through in-game chat with EVERYONE, not just our own
drivers: (a) a chat-listener module in the skill engine — parse addressed commands
("FurzFriedrich: chop 10 trees", "all: status") from players and foreign bots, map
them to __skills.start calls behind an allowlist + rate limit, reply conversationally
in character; (b) formalize the ledger lines already in use (DEPOT +N, USING/FREE,
CLAIM x y z r) into a documented FLEET protocol other bot operators (zetbots!) can
implement — HELLO/ROLE/TASK/OFFER lines so mixed fleets can assign each other roles;
(c) safety: players can task bots but never make them attack players, grief builds,
or drain the depot; unknown senders get read-only responses. Post-migration job for
the persistent drivers + one engine extension.

## Standing (from earlier)
- Migrate drivers to persistent doc-onboarded agents at the sync point (in progress).
- Retire PflasterPeter after base v1; stop the 3104 skill-library test bot after verification.
- Relocate depot chests out of zetbot2's r16 claim sphere once base v1 stands.
- Fix runner backlog: /mine buried-target hang, /goto fixed 60s timeout, packet
  hardening + strict task mutex per AUTONOMY_PLAN.md.

## 4. chopTrees natural-tree guard (incident 2026-08-31: Friedrich harvested Peter's house pillars)
Engine fix needed in skills.js chopTrees: placed structure logs are indistinguishable
from trees. Guard (user-refined 2026-08-31): the ONE discriminator is the leaf
canopy — only fell log columns with leaves adjacent to their upper blocks (natural-
tree check via blockAt). No blanket distance exclusion: trees right next to the
plaza are fair game, bare placed pillars (torch posts, frames) are never touched.
Optional hardening: skip logs at coords listed in BASE.md rows; prefer stripped logs
for structural builds (immune to the matcher). Interim driver rule is live, engine
fix should land next engine work cycle.

## 5. Persist runtime guards in runner.js (currently injection-only, lost on restart)
Root causes found 2026-08-31/09-01 in the field:
- runner.js:160 `new Movements(bot)` = UNSAFE defaults (parkour, 4-block drops,
  1x1 towers, self-scaffolding) → caused MettMarcel's fall death + the dirt
  pillars/bridge scars. Fix in runner.js spawn handler: allowParkour=false,
  maxDropDown=3, allow1by1towers=false, allowSprinting=false,
  infiniteLiquidDropdownDistance=false, scafoldingBlocks=[] — must survive
  reconnects (re-apply on every spawn event).
- Auto-inject the payload stack (skills.js, idleguard.js role-templated,
  graychat.js, digguard.js, panicguard.js) from runner.js on spawn instead of
  manual ./inject.sh — injections currently die with every restart and someone
  always forgets one.
- Promote panicguard into the engine proper (HP<8 → abort + announce + flee home
  at game speed; exists because Marcel bled 20→0 inside a 50s driver polling gap,
  2nd death 2026-09-01). Armor doctrine: field bots wear iron armor
  (armor-manager auto-equips) — kits lost to deaths cost more than armor.
- digguard.js pillar coords are hardcoded — generalize to read protected columns
  from BASE.md (or a protected.json the registry writes).

## 6. Field feedback for the engine (2026-09-01 shift)
- __skills.status should surface TOOL DURABILITY (Bernd went from iron pick to
  zero tools mid-descent, silently, twice this session) — add heldItem +
  durability% to the status bot block, and a "tool_low" log line under 15%.
- New skill per rule-of-twice: harvestGrass(radius, target) — Marcel hand-drove
  grass/seed harvesting twice (gated like huntAnimals, no terrain digging).
- Task-queue onEmpty fallback needs a COOLDOWN + quiet mode: KloputzKarl looped
  "checking for stray drops / picked up 0" every ~1.3s in chat (spam + useless).
  Suggest: min 30s between onEmpty runs, narrate only when something was found.
- Chunk-staleness rule (Marcel, in LEARNING_HANDOFF): blockAt surveys of chunks
  not recently visited return stale/inconsistent data — travel there before
  trusting scans.
- Torch-underfoot movement wedge (Bernd, in LEARNING_HANDOFF): like leaf_litter,
  a torch in the bot's own tile wedges pathfinding — add to ctx.goto auto-recovery
  nuisance-block list.
- Standing kit rule (user, 2026-09-01, after catching Marcel torchless in a dark
  grotto): EVERY bot carries >=8 torches on ANY excursion from base and lights
  dark workspaces (~7-block spacing) — not just mining. Engine idea: preflight
  check in ctx for any task leaving base radius — warn "no_torches" like v4 does
  in mineLane/safeDescend, but universally.

## Research findings 2026-09-01 (4 tracks done — synthesis: research/SYNTHESIS.md)
Reports: research/movement-engines.md, research/survival-doctrine.md,
research/chat-protocol.md, research/build-aesthetics.md. Top actionable items, in order:
1. **Pathfinder config fixes beat any new engine** (movement §2.3-2.4, ~0.5 day):
   add leaf_litter/torch/wall_torch/powder_snow/etc to `movements.blocksToAvoid`
   (verified root cause of BOTH wedges — zero-shape blocks classify as air); arrival
   assertion in ctx.goto (empty-path noPath resolves as SUCCESS); replace all 3
   `pathfinder.stop()` calls with `setGoal(null)` (stop-flag poisons next goto);
   wire path_reset('stuck')/path_update telemetry + listenerCount leak check.
2. **TODO 5 is the keystone** (movement §2.10): "Movements silently reverted" root
   cause = reconnect re-runs createBot with stock defaults ('spawn' handler must be
   `on`, not `once`). Safe profile + auto-inject + /state payload enumeration first;
   survival.js and chatlisten.js both depend on it.
3. **HAUL/WORK/CAVE Movements profiles** (movement §2.2, copy-paste ready): digCost 15
   on hauls (dirt-scar + tunneling fix), entitiesToAvoid, searchRadius 64 base moves,
   sprint on hauls only; exclusionAreas fed from BASE.md replaces hardcoded digguard.
4. **Survival stack** (survival §3-6): 4Hz danger scanner over bot.entities (free
   wallhack) + heldItem/durability/skyLight in status → survival.js panic branches
   (creeper-override / flee-home≤40 / BREAK_LOS vs skeletons / wall-off+eat) → kit
   preflight tiers → 4 shields (set autoEat offhand=false FIRST, patch armor-manager
   chainmail rank). Cavity-breach entity scan = the exact Marcel-death counter.
5. **ctx.gotoFar multi-leg waypointing** (movement §2.7): the actual long-haul fix
   (~80-block ground-snapped legs); retires the standing /goto-60s-timeout item.
6. **FLEET/1 chat is implementation-ready** (chat-protocol, full spec): build
   chatlisten.js on `bot.on('message')` UUIDs ONLY (chat identity is forgeable —
   RCON password is public); tier table; no withdraw/attack/build verbs exist;
   namespaced chest refs (FEL:B/CAVE:A) fix the live CAVECREW chest-B collision;
   spoof-rejection test is the gate. Implements TODO 3.
7. **Aesthetics unblocked** (build-aesthetics): ~30-line Sponge v3→v2 NBT shim in
   /blueprint/load (else most 2024+ .schem fail); genHouse seeded-palette generator;
   house_1 + path_1 have complete state-safe plans, bills fit banked stock; buildPath
   skill leg-wise LIVE generation (stale-chunk safe). Skip mineflayer-builder + WFC.
8. **TODO 2 update — real-Baritone Java blocker is GONE** (movement §3): HeadlessMc
   2.10.0 native binary downloads its own Java; hmc-specifics needs no fabric-api;
   jar sha256-pinned; ~40 min smoke tests remain. ashfinder = opt-in /goto2 fallback
   ONLY (loaded in createBot, never inject; assert arrival — it lies about success).

## Baritone status (2026-09-01, team-lead-workflow — full handoff in BARITONE.md)
Sidecar WORKS end to end: HeadlessMC 2.10.0 native (no system Java), Baritone
1.21.11 standalone (no Meteor), joined as GrubenGuenther, #goto/#mine/#stop all
verified, RAM 1.6-1.8GB under the 2G cap, clean shutdown, slot freed. Driven via
guarded HTTP adapter on 127.0.0.1:3109 (adapter.mjs + baritone.sh in
/home/felix/minecraft/baritone/). ashfinder 4.6.2 installed + goto2.patch.js
written, NOT merged, NOT A/B-tested. Next steps, in order:
1. Lead: add BASE.md rows for FEL-BT-1 (x75..85,z0..10, smoke-test only) and
   DIGTEST_1 (x=-100..-90,z=-60..-50); designate a PRODUCTION mining zone ≥150
   blocks from every anchor edge (FEL-BT-1 at 83 blocks does NOT clear the fence).
2. Run first production #mine job in that zone via the adapter; validate the
   untested allowOnlyExposedOres + backfill behavior (tunnel shape, refill).
3. Run the ashfinder A/B (research/goto2-ab-plan.md, 60 trips, 6 route classes);
   adopt /goto2 only on +20pp arrival with zero deaths/protected-breaks/falseSuccess.
4. Merge goto2.patch.js into runner.js once the runner-owning workflow finishes
   (5 edits in the patch header; MUST load in createBot pre-spawn) and move its
   bot.ashDig guard into digguard.js permanently.
5. Fix bcmd.sh: 14-try escalating backoff + confirm #set via "Successfully set"
   (6 tries proven insufficient — launcher swallowed 6 consecutive lines).
6. Cleanup: delete baritone/loopback-proxy.js (dead weight); correct
   movement-engines.md §1.3 (ashfinder events are fiction: only stopped/
   pathStarted exist) and §3.6 (gui DOES dump inventory under -lwjgl).
7. Optional: wire drivers to the adapter for >150-block hauls (allowBreak=false
   navigation is verified zero-impact); keep pathfinder for everything near base.
