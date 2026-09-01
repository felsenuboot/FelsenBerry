# Base Infrastructure Registry

Single source of truth for all shared infrastructure in the base area around the
crafting table at (-3, 111, 4). Companion file to DEPOT.md: what EXISTS and who may
USE it is decided here; how items move in and out of depot chests is decided there
(see section 4).

**Infrastructure** = any placed utility block or structure another bot could use:
crafting tables, furnaces (also smokers/blast furnaces), chests, beds, composters,
farms, shelters. NOT infrastructure: torches, temporary scaffolding you remove,
blocks of a purely private build.

Every driver agent MUST read section 1 before crafting or placing ANY infrastructure,
and MUST follow section 5 step by step. All chat announcements are in English.

## 1. Registry

| id               | type            | coords                      | status  | access          | added-by       | date       |
|------------------|-----------------|-----------------------------|---------|-----------------|----------------|------------|
| crafting_table_1 | crafting_table  | (-3, 111, 4)                | built   | shared          | (pre-registry) | 2026-08-31 |
| depot_chest_a    | chest           | (-5, 111, 1)                | built   | shared          | FurzFriedrich  | 2026-08-31 |
| depot_chest_b    | double_chest    | (-5, 111, 3)-(-6, 111, 3)   | built   | shared          | FurzFriedrich  | 2026-09-01 | (upgraded to double chest by BuddelBernd 2026-09-01 — the single chest hit full after the diamond-run haul; merged an extra chest onto the west face, 54 slots now)|
| depot_chest_c    | chest           | (-3, 111, 1)                | built   | shared          | FurzFriedrich  | 2026-08-31 |
| depot_chest_d    | double_chest    | (-6, 111, 8), upgrading to a double chest | planned | shared        | KloputzKarl    | 2026-09-01 | (bulk stone-class overflow chest per team-lead's depot-expansion task — chest B filled from Bernd's diamond-run haul and needed to stop absorbing cobble/deepslate/andesite/granite/diorite/gravel. Rather than place a THIRD chest in the area, upgrading the existing perimeter_wall_1 staging chest (already at this spot, already holding 192+ cobblestone for the wall) into depot_chest_d directly — it's already doing this job, just needs the second chest merged on for double-chest capacity and a DEPOT.md category-map entry (done). Redistribution pass from chest B pending server return.) |
| furnace_1        | furnace         | (-3, 111, 3)                | built   | exclusive-lease | (pre-registry) | 2026-08-31 |
| furnace_2        | furnace         | (-3, 111, 2)                | built   | exclusive-lease | PflasterPeter  | 2026-08-31 |
| plaza_1          | plaza_11x11     | x=-8..2, z=-1..9, floor 110 | built   | shared          | PflasterPeter  | 2026-08-31 |
| quarry_ladder_1  | ladder_shaft    | (-4, 108..110, 4)           | planned | shared          | PflasterPeter  | 2026-08-31 |
| quarry_lane_1    | cobble_lane_3w  | x=-5..2, y=110, z=5..7      | built   | shared          | PflasterPeter  | 2026-08-31 |
| torch_posts_1    | light_posts_x8  | (-8,-1) (-8,9) (2,-1) (2,9) (-3,-1) (-3,9) (-8,4) (2,4), y=111..113 STRIPPED oak_log + torch y114 | built | shared | PflasterPeter | 2026-09-01 |
| bed_1            | bed             | (0, 111, 1)-(0, 111, 2)     | planned | exclusive-lease | PflasterPeter  | 2026-08-31 | (dropped — daylight cycle frozen, beds useless) |
| bed_2            | bed             | (1, 111, 1)-(1, 111, 2)     | planned | exclusive-lease | (unassigned)   | 2026-08-31 | (dropped — daylight cycle frozen, beds useless) |
| pen_1            | fence_pen_7x7   | x=-32..-26, z=134..140, y134-140, gate (-29,140) | destroyed | shared        | MettMarcel     | 2026-09-01 | (RETIRED by team-lead directive 2026-09-01: only 7/~23 fence blocks survived HAZARD ZONE #1 creeper damage, see section 6 changelog; too close to a permanent 70+ mob cluster to be worth rebuilding — id retired, do not reuse. The 7 surviving fence/gate blocks + 4 torched points may be salvaged, but ONLY with backup + full kit, never solo. Superseded by pen_2 near base.) |
| pond_1           | pond_2x2        | x=1..2, y=110, z=10..11     | built   | shared          | MettMarcel     | 2026-09-01 |
| house_1          | house_6x6       | x=-8..-3, z=10..15, floor+walls y110..113, roof y114, door (-6,111-112,10), windows (-8,112,12)+(-3,112,13) | built | shared | PflasterPeter | 2026-09-01 |
| farm_1           | wheat_plot      | x=-2..3, z=10..14, y=110 (26 farmland tiles around pond_1, pond at x=1..2,z=10..11) | built | shared        | MettMarcel (expanded by KloputzKarl) | 2026-09-01 | (relocated from y=111,z=12-14 — that site was 1 block above pond_1's water level and un-hydratable, farmland kept drying back to dirt; moved to y=110 directly beside the pond, moisture confirmed 7/7. First tile planted with the bootstrap wheat_seeds from chest C. EXPANDED 2026-09-01 by KloputzKarl from 3 tiles to a full 6x5 field (26 farmland, minus the 4 pond cells), all moisture 7/7; fenced on 3 sides (oak_fence, north side left open onto plaza_1 as the entrance) at x=4 (east), z=15 (south), and a short (3,9) stub — west side is already closed by house_1's wall; 6 torches for perimeter lighting, 2 required clearing a small natural overhang that was reading skyLight 0 at x=4. See BASE.md section 6 changelog for the tiling/fencing quirks found.) |
| path_1           | trail_stepped   | plaza edge (2,110,5) toward CAVECREW camp (11,89,55), stops at (10,92,50) — 5+ blocks short of their chest | built | shared | PflasterPeter | 2026-09-01 | (post-v9-restart re-audit found 10 explosion-damaged tiles near the plaza + mid-route; 7 repaired, 3 remain: (3,112,12) and (3,112,13) now sit directly above Karl's grown wheat at farm_1 with no solid placement reference — cosmetic 1-block step, still walkable; (9,97,42) is genuinely unreachable by pathfinder, cause unknown, low priority) |
| pen_2            | fence_pen_7x7   | x=7..13, z=10..16, y=119 (fence), floor y=118, entrance gap (10,119,16) | built | shared        | KloputzKarl    | 2026-09-01 | (replaces retired pen_1 per team-lead directive — sunlit flat plateau ~8 blocks above/east of farm_1, full skyLight 15, spatially clear of path_1's low-elevation route toward (10,92,50). 23 oak_fence perimeter blocks (built with the new engine v8 buildWall skill — verified block-by-block, far more reliable than hand-placement), a 1-wide open entrance gap at (10,119,16) instead of a crafted gate — see FEEDBACK.md, oak_fence_gate has no working recipe via bot.craft on this server right now, so the entrance is a plain fence block you dig+replace to open/close. 6 torches on the corners/entrance posts. Coordinated site via chat with peter-driver/marcel-driver before building; no objections raised.) |
| main_hall_1      | hall_8x5        | x=-7..0, z=-6..-2, floor+walls y110..113, roof y114, open colonnade on the south (plaza-facing) wall between corner posts (-7,-2) and (0,-2), 3 interior torches | built | shared | PflasterPeter | 2026-09-01 | (user-requested: covers the crafting-table/depot hub where the fleet congregates) |
| farm_2           | wheat_farm_9x9  | x=-17..-9, z=0..8, y=110, single water source at (-13,110,4) | planned | shared | KloputzKarl | 2026-09-01 | (canonical vanilla 9x9-per-water-source design — 1 source block hydrates all 80 surrounding farmland tiles, the maximum footprint one water source can cover; far more water-efficient than farm_1's 2x2-pond approach. Site: flat plateau west of the plaza in the old defunct zetbot2 claim zone, clear of every registered structure. NOTE: this sits just outside perimeter_wall_1's current envelope (x=-12..15) — flagging for Bernd/team-lead in case the wall boundary should extend ~5 blocks west to include it; building a standalone fence+torch perimeter around the farm itself regardless so it isn't undefended either way.) |
| perimeter_wall_1 | wall_2high_posts | envelope x=-12..15, z=-9..18, WITH A BULGE around farm_2: x=-12 line jogs out to x=-19 between z=-1 and z=9 (two E-W connectors at z≈-1 and z≈9 from x=-12 to x=-19, plus a N-S line at x=-19 spanning z=-1..9) to clear farm_2 (x=-17..-9,z=0..8) with ~2 blocks buffer. 2-high cobblestone, stripped-log post every 6 blocks + torch per post, gate at south z=18 x≈5 (path_1). | in-progress | shared | PflasterPeter (ownership transferred from BuddelBernd 2026-09-01 by team-lead — Peter is building it, Bernd's assignments kept slipping; Bernd takes the east+south runs as sections under Peter's coordination once ready) | 2026-09-01 | (Materials needed: ~320+ cobblestone, ~81+ log posts stripped, ~30+ torches. STAGING CHEST at (-6,111,8). CONSTRUCTION NOTE: the north run at z=-9 steps down past x=4 — real 5-block cliff drop at z=-7 (past main_hall_1's north wall at z=-6), a level wall there would float. No north gate — main_hall_1's access is via its south colonnade onto the plaza. BULGE NOTE: farm_2 sits directly on the original x=-12 line (real farmland+water already placed at x=-12..-14,z=1-5, confirmed live via unreachable placement attempts, not just "planned" on paper) — team-lead's decision was to jog around it rather than force through, since a straight wall cutting through a field reads as bot damage. West run's non-bulge segments (z=-9..-1, z=9..18 at x=-12) are built; the bulge itself (z=-1..9 detour) is next.) |
| FEL-BT-1         | baritone_test_zone | x=75..85, z=0..10   | built (used) | shared      | (baritone workflow) | 2026-09-01 | (smoke-test zone used by the Baritone adapter verification workflow; registering per team-lead's request so it's not mistaken for unclaimed ground.) |
| DIGTEST_1        | baritone_test_zone | x=-100..-90, z=-60..-50 | built (used) | shared  | (baritone workflow) | 2026-09-01 | (second Baritone smoke-test zone; same purpose as FEL-BT-1, registered per team-lead's request.) |
| production_mine_1 | baritone_mine_site | center ~(-200,-150), exact footprint TBD on arrival | planned | shared | KloputzKarl | 2026-09-01 | (designated per team-lead's Baritone-adapter mining fence requirement: ≥150 blocks from every protected.json anchor EDGE and from the CAVECREW camp. Sited by calculation, not a live survey — nearest base anchor edge (main_hall_1) computes to ~241 blocks, CAVECREW camp edge ~303 blocks, comfortable margin over the 150 minimum. NOT terrain-verified: picked by geometry (far NW of the base cluster) since no census data covers this area and a live check wasn't possible with the server down. Whoever sends Baritone here first should confirm it's actually exposed stone/hillside and not, say, ocean, before industrial digging starts, and tighten this row to the real footprint once confirmed. Expect industrial digging — this is a baritone-mining-only zone, not for casual resource runs.) |

Column rules:

- **id**: stable slug, lowercase `[a-z0-9_]`, format `<type>_<N>` with N counting up
  per type (`furnace_1`, `bed_2`). Exception: depot chests use `depot_chest_<letter>`
  to match DEPOT.md's A/B/C lettering. An id is NEVER renamed and NEVER reused —
  if the block is destroyed, delete the row, announce `BASE -<id> (destroyed)` in
  chat, and retire the id forever.
- **status**: `planned` (row is a reservation — someone intends to build it, or it is
  pre-planned and unassigned) or `built` (block is placed at the stated coords).
- **access**: `shared` (any number of bots simultaneously; no announcement needed to
  use) or `exclusive-lease` (exactly one bot at a time, via the section 3 protocol).
- **added-by**: bot name, or `(unassigned)` for a pre-planned row nobody has claimed,
  or `(pre-registry)` for things that existed before this file.
- **date**: YYYY-MM-DD of the row's last status change.

Note on furnace_1 / furnace_2: these two rows ARE the base's furnace plan. furnace_1
already existed at (-3, 111, 3) before this registry (found in the 2026-08-31 survey).
furnace_2 at (-3, 111, 2) is the second and last furnace. There is no third furnace
unless section 2 permits one.

## 2. The no-duplicates rule

Before crafting or placing ANY infrastructure of type T, a driver agent MUST check
the registry above. Then:

1. **If a built instance of T with free capacity exists, use it.** Shared instances
   always have free capacity. An exclusive-lease instance has free capacity iff it
   is not currently leased (section 3).
2. **A new instance is allowed only when ALL existing instances of T (built AND
   planned) are leased or full.** A `planned` row counts as an existing instance —
   never start a duplicate of something already reserved. Exception: a planned row
   older than ~30 minutes with no `built` flip and no builder activity in chat is
   abandoned; you may take it over — edit added-by to your bot name and announce
   `BASE claiming <id> (abandoned plan)` — instead of adding a new row.
3. **Reserve before you build**: add (or claim) the `planned` row BEFORE crafting or
   gathering materials. This is what prevents two bots building the same thing at
   the same time.
4. **Register immediately after placement**: the moment the block is placed, before
   the bot does anything else, edit the row — status `planned` -> `built`, coords
   -> the actual (x, y, z), date -> today — and announce in chat:
   `BASE +<id> at (x, y, z)`.

Siting rules for anything new: within ~6 blocks of the crafting table at
(-3, 111, 4) (except registered remote infra like pens/paths); never place a solid
block directly above a chest (it would block the lid); do not box in the fronts of
the depot chests. (The old zetbot2-claim distance rule is defunct — see section 8.)

## 3. Lease protocol (exclusive-lease items)

Applies to every row whose access is `exclusive-lease` (furnaces, beds, ...).
The lease medium is server chat. Staleness is judged from timestamps: driver agents
read their bot's `logs/<name>.log` (all chat lines are ISO-timestamped) or note the
wall-clock time when polling read-chat.

Chat message formats (exact, one line each):

- `USING <id>` — acquire / heartbeat
- `FREE <id>` — release
- `LEASE-BREAK <id> (stale)` — break a stale lease

Rules:

1. **Acquire**: find the most recent `USING <id>` / `FREE <id>` / `LEASE-BREAK <id>`
   for the instance. If the latest is a `USING` by another bot less than ~5 minutes
   old, the instance is leased — pick another instance or wait. Otherwise announce
   `USING <id>` yourself, then start using it.
2. **Release**: announce `FREE <id>` immediately when done. Never log off or walk
   away holding a lease you could release.
3. **Staleness**: a `USING` older than ~5 minutes with no matching `FREE` and no
   newer heartbeat is stale. You may break it: announce `LEASE-BREAK <id> (stale)`,
   then your own `USING <id>`, then proceed.
4. **Heartbeat**: for any job that takes longer than 5 minutes, re-announce
   `USING <id>` at least every 4 minutes so your lease never looks stale.
5. **Furnaces**: each of the 2 furnaces is ONE lease covering the entire smelt —
   loading fuel and input, the wait, and collecting the output. The smelting bot
   stays owner until it has collected the output; items left cooking do NOT free
   the furnace. Smelting a batch takes long (a full stack is ~11 min), so the owner
   MUST heartbeat: `USING furnace_1` every <=4 minutes until output is collected.
   Safeguard before any furnace LEASE-BREAK: open the furnace first — if ANY slot
   (input, fuel, output) is non-empty, the lease is NOT stale no matter how quiet
   chat is; leave everything in place (the contents belong to the owner — never
   take another bot's smelt output), report in chat, and use the other furnace or
   wait.
6. **Beds**: one lease per bed covering walk-to-bed + sleep + wake. Short jobs; the
   plain 5-minute stale rule applies.
7. **Crash recovery**: if your bot died or disconnected while holding a lease,
   announce `FREE <id>` (or a fresh `USING <id>` if resuming) as soon as it is back.
   Until then, others may stale-break per rule 3 — that is correct behavior, not
   rudeness.

## 4. Relationship to DEPOT.md

- Depot chests are registered HERE (rows `depot_chest_a/b/c`): their existence,
  coords, and the no-duplicates rule for placing chests are governed by this file.
- Everything about MOVING ITEMS — chest categories, deposit/withdraw etiquette, the
  `DEPOT +N item` / `DEPOT -N item` chat ledger, the don't-drain rule, Kevin's
  no-chest-tool workaround — lives in DEPOT.md and is unchanged by this file.
- Chests are `shared`: opening a depot chest needs NO `USING`/`FREE` lease, only the
  DEPOT.md transfer announcements.
- Placing a NEW depot chest: follow section 2 here (planned row first, built row
  after) AND append the placement line to DEPOT.md's placement log. Both files,
  every time.
- Conflict rule: for item transfers and chest usage, DEPOT.md wins; for whether a
  block exists, where it is, and whether another may be built, this file wins.

## 5. For driver agents: the exact workflow

You need infrastructure of type T (a crafting table, furnace, bed, chest, ...):

1. Read section 1 of /home/felix/minecraft/bots/BASE.md. Never craft or place T
   before this read.
2. If a `built` + `shared` instance of T exists: walk there and use it. Done — no
   announcement needed (DEPOT.md announcements still apply to chest transfers).
3. If T is `exclusive-lease`: for each built instance, check chat history for its
   latest USING/FREE (section 3, rule 1). Choose a free instance, or stale-break
   one per section 3 rule 3 (furnace safeguard: open and inspect it first).
4. Announce `USING <id>`, use it (heartbeat `USING <id>` every <=4 min if the job is
   long; furnace: remain owner until you collected the output), then announce
   `FREE <id>`.
5. If every instance is leased and none is stale: wait and re-check chat about once
   a minute; only if you cannot wait, continue to step 6.
6. Reserve: add a `planned` row to section 1 with the next free id `<type>_<N>`,
   your bot name, and today's date (or claim an `(unassigned)`/abandoned planned
   row by editing added-by). Only then gather materials — depot chests first, per
   DEPOT.md rule 3.
7. Place it following the section 2 siting rules. Immediately edit your row: status
   -> `built`, coords -> the real (x, y, z), date -> today. Announce in chat:
   `BASE +<id> at (x, y, z)`.
8. If it is `exclusive-lease` and you are about to use it now, still do the full
   lease dance — `USING <id>` before, `FREE <id>` after — even though you built it.

## 6. Changelog

(append one line per status change: `YYYY-MM-DD HH:MM <id> <planned|built|destroyed> by <botname> — note`)

- 2026-08-31 22:1x registry created by the base-builder agent; seeded 5 built rows (pre-existing) and 7 planned rows from the Kevinplatz v1 design.
- 2026-08-31 22:3x pen_1 planned by MettMarcel — 7x7 fence pen around the cow/pig herd at ~(-35, 94, 48), built where the herd stands (playbook M3); 24 oak fences + 1 gate crafted.
- 2026-08-31 22:45 plaza_1 built by PflasterPeter — 11x11 levelled at floor y110: ~74 high blocks cut (grass/dirt), 11 low columns capped (7 dirt, 4 cobble); quarry shaft column (-4, 4) left open per section 7; existing chests/furnace/table untouched.
- 2026-08-31 22:46 furnace_2 built by PflasterPeter — crafted from 8 inventory cobblestone at crafting_table_1, placed at (-3, 111, 2).
- 2026-08-31 22:47 bed_1 + bed_2 dropped by PflasterPeter — daylight cycle is frozen on this server, beds are useless (finding postdates the registry); rows annotated, ids retained.
- 2026-08-31 22:5x pen_1 BUILT by MettMarcel at x=-32..-26, z=134..140 (hilltop SE of base; original herd at (-35,94,48) was gone). 23 oak fences + oak gate at (-29,140); NE corner (-26,140) is a natural spruce trunk acting as post. CAVEAT: the two surviving cows (ids 136, 134) wandered off during the build — pen is EMPTY. Population needs wheat-luring or a push-herd next shift; cows last seen at (-12,130,109) and (56,135,103). Do NOT kill these two — they are the breeding stock.
- 2026-08-31 (later) pen_1 VERIFIED by MettMarcel: fence structure intact at x=-32..-26,z=134..140 (22 fence/gate blocks found), still EMPTY. Located breeding cow id 18195 at roughly (60,140,106), ~90+ blocks from the pen — recognized it from the note above and did NOT kill it despite it entering a hunt sweep's radius. Second cow (last seen -12,130,109) not located. No wheat/hoe on hand to lure it back; long-distance leading also conflicts with the playbook's "never wheat-lead animals home" rule. Needs a dedicated hoe+wheat trip to slow-walk breeders home, or write off this founder pair and re-seed from wild cows encountered nearer the pen.
- 2026-08-31 (later) depot_chest_a marked DESTROYED by MettMarcel — went to withdraw planks and found (-5,111,1) is air, with the floor block below it (-5,111,0 at y110) also missing (small 1x1x2 pit, no lava/hazard). No item drops found within 20 blocks; contents presumed lost or already picked up by whoever/whatever broke it — cause unknown, not witnessed. Announced in chat; flagging to the fleet since chest A held the WOOD depot stock. Pit is shallow and not urgent but should be backfilled with dirt (not cobble) to match the plaza floor, and chest A re-placed by whoever has spare planks — I don't currently have dirt or planks on hand to fix it myself.
- 2026-08-31 (later) CORRECTION by MettMarcel: depot_chest_a row reverted DESTROYED -> built. Kevin verified the block in person and I re-verified myself just now — a chest is physically present at (-5,111,1) right now. Either my original read caught a stale/mid-repair moment or it was rebuilt fast; either way the destroyed report was wrong and is retracted. Correction announced in chat. (The floor-pit observation may still be worth a look if it recurs, but the chest itself is fine.)
- 2026-08-31 (resumed shift) audit by PflasterPeter found plaza_1's LEVELING complete (built, per original row) but NOT cobblestone-paved outside the lane strip — the "west half done" note from the prior shift was inaccurate/unverified. Also found 2 floor holes at (-6,110,4) and (-5,110,4) breaching into the known sub-plaza cave (section 7) — patched immediately with cobblestone (safety). quarry_lane_1 verified 20/24 paved; finished the remaining 4 tiles at (1,110,7),(2,110,5/6/7) — flipped to BUILT.
- 2026-09-01 pond_1 + farm_1 planned by MettMarcel — food unblock plan (team-lead
  directive): 2x2 pond at (1..2,111,10..11) just south of the plaza edge, wheat plot
  at (-2..2,111,12..14) adjacent to it. Filling the pond via bucket relay from the
  water source at (52,107,17) (no closer source found within 64 blocks of base).
  Seeds: 1 wheat_seeds pending from Bernd's restitution chests at (-27,94,1),
  currently being retrieved by FurzFriedrich — grabbing from depot when it lands;
  also relying on ongoing grass-harvest RNG for more.
- 2026-09-01 main_hall_1 REPAIRED by PflasterPeter after friedrich-driver's audit found 21 missing edge blocks (NW/NE corners, west/east wall gaps, roof gaps) — likely leftover damage from either my own canDig incident (before the fix landed) or a second explosion, same as the plaza/torch_posts_1 hits. Also cleared ~55 blocks of leftover overhang debris (raised grass_block + leaf_litter) sitting one level above the paved plaza floor across its east side — leftover from the original pre-registry leveling pass never having cleared the full overhang, only the floor tile itself. Found and removed a live TNT block at (-6,111,4) in the process (mined safely, no explosion, banked to chest B, DEPOT +1 tnt — never to be used without Felix's explicit approval). Full re-verification: plaza floor, all 8 torch posts, and main_hall_1's floor/walls/roof/colonnade all clean, 0 gaps.
- 2026-09-01 main_hall_1 BUILT by PflasterPeter — 8x5 hall enclosing the crafting-table/chest/furnace hub, cobblestone floor+roof, oak-log-cornered plank walls solid on 3 sides, wide open colonnade on the south (plaza-facing) side flanked by the existing torch_posts_1 pillars at (-8,-1)/(2,-1). Rocky build: repeated hand-patch loops (~115 GoalNear calls) triggered pathfinder digging THROUGH the floor and wall out from under the bot as a pathing shortcut, twice, costing real fall damage (HP 20->9) and several rebuild passes — root-caused and fixed mid-build by setting `bot.pathfinder.movements.canDig = false` before any further close-range placement work; logged in FEEDBACK.md, and digguard.js v2 (shipped same shift) now also blocks this at the planner level for any BASE.md-registered structure. Structure fully re-verified clean (floor/walls/roof, 0 gaps) before this row flipped to built.
- 2026-09-01 main_hall_1 PLANNED by PflasterPeter — user-requested main hall covering the crafting-table/chest/furnace hub where the fleet has been congregating (Friedrich, Kevin, Bernd, Ook all clustered there). 8x6 footprint x=-7..0, z=-7..-2, immediately north of and flush with the plaza's z=-1 edge — grass there cleared as part of the build. Solid walls on 3 sides, open colonnade on the south (plaza-facing) side using the existing torch_posts_1 pillars at (-8,-1) and (2,-1) as informal gateposts just outside the opening.
- 2026-09-01 path_1 BUILT by PflasterPeter — 46-tile stepped cobblestone trail from the plaza edge (2,110,5) down to (10,92,50), following the natural hillside grade (no cliffs), headroom cleared, torch every 7 steps. One tile at (8,100,39) stayed unreachable after 3 attempts (pathfinder wouldn't route there even though neighbors look solid) — small 1-block gap, not blocking; flagging for a follow-up pass, not worth further time against the user's pace directive.
- 2026-09-01 house_1 BUILT by PflasterPeter — cobblestone floor (36) + framed shell (4 oak_log corners, oak_planks infill, height 4) + cobblestone roof (36), door centered on the north wall (facing the plaza) at (-6,111-112,10), one window cut in each side wall, 2 interior torches. Note: frameStructure's origin.y is the WALL BOTTOM, not "one above the floor" as first assumed — its perimeter ring at y=110 is log/plank (doubling as both wall base and floor edge) with cobblestone only in the interior floor; noted for future callers of this skill. One frame block needed a manual patch (no_reference at (-4,111,10)); 4 roof tiles needed a manual patch (unreachable along the x=-8 edge). No drops lost.
- 2026-09-01 bridge demolition by PflasterPeter — cleared 14 blocks of stray elevated dirt/grass_block (pathfinder-scaffolded, floating over the ravine at z=-4/y=117 just north of the plaza, plus a second fragment near x=9-11,z=-6..-10) per user request; no drops left behind.
- 2026-09-01 house_1 PLANNED by PflasterPeter — 6x6 footprint at x=-8..-3, z=10..15, floor y110 (matches plaza level), walls y111..114, sited at the plaza's SW corner (adjacent, outside plaza bounds). Shifted 1 block west from the original x=-7..-2 plan once Marcel's farm_1 (x=-2..2, z=12..14) landed — now clear of it and of pond_1 (x=1..2). Framed shell: oak_log corner posts + oak_planks infill, cobblestone floor + roof, centered door gap on the z=10 (north/plaza-facing) wall, torch-lit interior.
- 2026-09-01 torch_posts_1 REBUILT (3rd time) by PflasterPeter, all 8 columns now STRIPPED oak_log — kevin-driver found 4 columns fully gone ((-3,9),(-8,9),(2,9),(2,4)) during a digguard-gap window after a fleet-wide restart; rebuilt those with stripped logs per team-lead's directive (chopTrees doesn't match stripped_oak_log). Then found 3 MORE columns hit ((-8,-1),(-8,4),(-3,-1) partial) that were still plain oak_log — confirms the theory: only the unstripped ones keep getting chopped. Converted the remaining 2 plain-log columns too ((2,-1) full, (-3,-1) partial) so all 8 are now uniformly stripped oak — used __digguard.restore() to make the legitimate edit, re-injected digguard.js immediately after to restore protection. Crafted a stone_axe on the spot (no iron_axe available) for the stripping. All 8 columns re-verified clean.
- 2026-09-01 torch_posts_1 BUILT by PflasterPeter — 8 oak-log pillars (y111-113) with a torch on top (y114) at the 4 plaza corners + 4 edge midpoints, listed coords in the row above. Survived two accidental demolitions by FurzFriedrich's chopTrees (structure logs read as trees, drops recovered, rebuilt both times) before the fleet's dig-guard went live to protect them; verified all 8 columns clean on 2026-09-01. plaza_1's floor re-verified 119/120 cobblestone (only exception: (-5,110,1), intentionally left dirt — it sits under depot_chest_a, invisible, not worth disturbing the chest). Next: bridge demolition (stray elevated dirt bridge NW of plaza), then house_1.
- 2026-08-31 (resumed shift) plaza_1 pavement COMPLETE by PflasterPeter — all 120 floor cells (minus the intentional open shaft column at (-4,4)) are now cobblestone, sourced via mineLane (42 cobble from a stone pocket near the reserved quarry_ladder_1 column) plus depot chest B withdrawals (DEPOT -35, -8). One tile at (-5,110,1) intentionally left as dirt — it sits directly under depot_chest_a and is not visible/walkable, not worth the risk of disturbing the chest. Also found and fixed a bot-trapping incident: pathfinder opened a floor hole at (2,110,4) while routing home, self-rescued and repatched. Next: torch_posts_1, then house_1 and path_1 per new user orders (see TODO/team-lead).
- 2026-09-01 farm_1 EXPANDED by KloputzKarl — grew the plot from 3 farmland tiles to
  a full 6x5 field (x=-2..3, z=10..14, y=110), 26 farmland cells after excluding
  pond_1's 4 water cells, all confirmed moisture 7/7 off the existing pond (no new
  water source needed). Leveled several natural terrain irregularities first: two
  overhang grass_block/dirt caps sitting one block above the intended floor (cleared
  before tilling), one 1-deep and one 2-deep pit (backfilled with dirt), and a
  handful of leaf_litter clutter. Fenced 3 sides with oak_fence (east x=4 z=9..15,
  south z=15 x=-2..3, a short north stub at (3,9)) — west is already closed by
  house_1's wall, north stays open onto plaza_1 as the walk-in entrance (matches
  house_1's plaza-facing door convention). 6 torches for perimeter lighting; the
  east side required clearing 1-2 blocks of a natural overhang first — it read
  skyLight 0 despite being at y=111, a real dark pocket, not just low ground.
  Replanted 4 wheat_seeds (+1 loose wheat) that turned up in inventory after the
  overhang-clearing pass, in case they were an accidentally-broken crop rather than
  a terrain drop — see FEEDBACK.md for the till/place-block quirks hit along the way.

- 2026-09-01 pen_1 DAMAGE FOUND by KloputzKarl — checked on the pen (gate/lighting
  pass per queue) and found only 7 of the ~22-23 fence/gate blocks from the last
  verification still standing (a gate at (-29,140,140) plus scattered posts near
  (-32,140,139), (-26,140,137/139) — most of the west/south perimeter is gone).
  72 hostile entities were tracked from standing at the pen (nearest ~105 blocks,
  rest further) — almost certainly the section 7 HAZARD ZONE #1 cluster
  ((-33,116..118,103..117)), and creeper splash damage is the likely cause of the
  fence loss given the pattern (missing sections, not a clean player-style removal).
  Local skyLight at the remaining posts was fine (12-14, not a spawn-in-the-dark
  issue at the pen itself). Did NOT attempt a full rebuild solo — torched the 4
  surviving fence/gate points instead (immediate area now lit) and retreated; a
  full pen rebuild needs the backup/full-kit scouting this hazard zone was already
  flagged as requiring (see section 7), not a solo pass. Row below left as `built`
  since fence remnants + gate are physically present, but treat pen_1 as NOT
  animal-ready until rebuilt.

- 2026-09-01 pen_1 RETIRED by KloputzKarl (team-lead directive) — flipped
  built->destroyed after the hazard-zone damage found earlier today (only 7/~23
  fence blocks survived). Decision: do not rebuild at this site, a pen 25 blocks
  from a permanent 70+ mob cluster loses to entropy forever. id retired for good;
  superseded by pen_2 (see below) sited adjacent to base/farm_1 instead.

- 2026-09-01 torch_posts_1 DAMAGE FOUND by KackboonKevin (kevin-driver) — a
  post-restart base inspection found HALF the structure gone: columns at
  (-3,9), (-8,9), (2,9), (2,4) are completely missing (all 4 blocks each,
  y=111..114 — 3x oak_log + 1 torch), floor beneath intact (cobblestone
  verified at -3,110,9). The other 4 columns — (-8,-1), (2,-1), (-3,-1),
  (-8,4) — verified still intact. CORRECTION after cross-checking FEEDBACK.md:
  this is NOT fresh chopTrees damage — peter-driver already logged the same
  underlying incident ("6 of 8 torch posts partially or fully destroyed",
  diagnosed as creeper explosion, digguard doesn't stop explosions). This
  snapshot (4 fully gone/4 intact) is consistent with his, likely mid-repair.
  Rebuild still needs 12 oak_log + 4 torch; see FEEDBACK.md peter-driver's
  entry for the real fix (spawnProof sweep). Row left `built`.
- 2026-09-01 spawn_proofing sweep by KloputzKarl (team-lead priority, after
  Peter found creeper-blast damage on the plaza) — found and worked on TWO
  separate hazards:
  (1) THE SUB-PLAZA CAVE (section 7) is much bigger than documented: a
  connected void spanning roughly x=-9..0, z=-2..9, y=105..109, not just
  "west-centre." Entered from OUTSIDE the plaza at (-9,108-109,1) (2-block
  dig, no plaza floor touched) rather than the nominal quarry_ladder_1 column
  at (-4,4) — that column is actually solid/filled, not open as the registry
  implies. Placed ~20 torches across the main chambers; a full 35-cell
  residual dark-pocket survey still came back after that (this cave is large
  and 3D — full coverage would need a proper mining/exploration pass, not a
  safety sweep). HIGHEST-VALUE fix: found and SEALED a 5-block-deep open
  shaft running from y105 straight up to y109 directly UNDER
  crafting_table_1 (x=-3,z=4) — only the 1-block-thick plaza floor stood
  between that void and the base's most-trafficked spot. Filled solid with
  cobblestone y105-109, floor untouched. Treat the rest of this cave as
  ongoing/unfinished — the chokepoint under the table was the priority and
  is done, the interior is partially lit but not fully mapped or sealed.
  (2) A SEPARATE, more surprising find: a ~3x11 strip of the plaza's OWN
  floor at x=0..2, z=-1..9 (open sky, no roof, right in the core) reads
  skyLight 0 / light 0 / surfaceExposed:false when the bot stands there —
  confirmed live, not a stale remote read. Placed 11 torches across the
  strip as a direct fix, but a follow-up scan showed most neighboring cells
  STILL reading effective light 0 even adjacent to a freshly-placed torch,
  which shouldn't happen if light is propagating normally. Logged as a
  probable engine/world lighting bug in FEEDBACK.md rather than something
  fixable by throwing more torches at it — worth an engine-side look. No
  hostiles were present during the whole sweep (checked repeatedly, always
  0 in tracking range), so treat this as invisible-risk hardening, not an
  active-incident response.
  A fleet-wide bot restart happened mid-sweep (external, not caused by this
  work) — engine landed a big upgrade during it: skills v10, plus new
  dangerscan/survival/reachguard payload modules and tool-durability-in-status,
  auto-injected on spawn. Re-verified/re-applied the full payload stack +
  safe Movements profile per the hard-reconnect rule before continuing.
- 2026-09-01 spawn_proofing sweep by PflasterPeter (Karl's counterpart, split by
  team-lead) — covered the NW ravine (x=-12..6, z=-12..2, y~102-111, the area
  around the demolished dirt bridge) plus general perimeter light-gap checks
  within ~30 blocks of the plaza. Live-verified light at every waypoint (not
  remote blockAt — that reads mostly stale/zero for unvisited chunks and would
  have produced ~350 false positives; walked the ground instead). Found and
  torched 26 genuine dark spots (block light 0-6 with the bot physically
  standing there), concentrated in the ravine's lower reaches (y102-109) and a
  handful of overhang pockets along the plaza's north/west edges. No hostiles
  encountered during the sweep. 30+ torches used from chest B stock; ~11 spare
  torches remain in kit. Not exhaustive — a ravine this size likely still has
  pockets beyond the patrol grid's ~3-block spacing — but every waypoint
  visited is now lit, and the highest-traffic edges (adjacent to main_hall_1,
  torch_posts_1, and the demolished-bridge crossing) are clear.
- 2026-09-01 plaza_1 dark-strip PERMANENTLY FIXED by PflasterPeter — Karl's
  confirmed server-side lighting bug at x=0..2, z=-1..9 (block-update relight
  fails, torches don't propagate light there no matter how many are placed)
  neutralized by physics instead of light: laid cobblestone_slab (bottom
  slabs) over all 30 affected floor cells (33 minus the 3 that are actually
  torch_posts_1 columns at (2,-1)/(2,4)/(2,9), left untouched) — bottom slabs
  block mob spawns regardless of light level, so this ends the issue
  permanently independent of whatever the underlying lighting bug is. Crafted
  36 cobblestone_slab from 18 cobblestone at crafting_table_1. Removed and
  collected Karl's stopgap torches from the strip (8 recovered) since they're
  scarce stock. Quirk hit repeatedly during placement: standing within ~0.7
  blocks of the target cell silently no-ops bot.placeBlock (bot's own hitbox
  overlaps the target) — fixed by forcing a step back (setControlState('back',
  true) for ~0.5-0.8s) before each placement; logged as a FEEDBACK.md
  candidate if not already there. AESTHETIC NOTE (verified in-game, not just
  assumed): there IS a real 0.5-block step at the strip's west boundary
  (x=-1/x=0 line, ~11 blocks long) — standing on the slabs reads y=111.5 vs
  y=111.0 on the rest of the floor. Left it as a plain step rather than
  building a transition ramp/border: it's a single low rise (not a trip
  hazard, no jump needed) along one straight edge, reads as an intentional
  slightly-raised dais rather than bot damage. Revisit with a border row if
  it looks wrong in a screenshot — team-lead left this as driver's call.
- 2026-09-01 depot_chest_b upgraded to double_chest by BuddelBernd — the diamond-run
  haul (8 diamonds + 424 total stone/ore items) filled the single chest solid. Merged
  a spare chest onto the west face at (-6,111,3); confirmed 90-slot window (54
  container + 36 inventory) after placement. Coords row updated to a range covering
  both halves. Announced in chat.

## 7. Site safety notes (Kevinplatz v1)

- GRAVEL-FREE RULE: never place gravel on the quarry lane or drop it into the shaft
  at (-4, 4); gravel encountered along the lane or above the shaft is mined out
  immediately — falling gravel plugs a 1x1 shaft and traps whoever is below.
- Never dig below y=110 inside the plaza (x=-8..2, z=-1..9), except inside the
  quarry shaft column at (-4, 4).
- ~~Never extend anything west of x=-8 (zetbot2 claim buffer)~~ DEFUNCT 2026-08-31:
  zetbots no longer exist — they merged into CAVECREW (user-confirmed). The r16
  claim sphere at (-9,102,2) is void; west expansion is allowed again. Only the
  section 8 CAVECREW camp zone remains off-limits.
- CAVE UNDER THE PLAZA: open air at y=108-109 under the west-centre columns; the
  plaza floor there is 1 block thick. Do not remove floor blocks there.
- **HAZARD ZONE — dense hostile mob cluster**, found live by MettMarcel 2026-08-31:
  70+ hostile mobs (zombies, skeletons, spiders, creepers, endermen, a witch)
  tracked simultaneously around (-33, 116..118, 103..117), closest individuals as
  near as 27-37 blocks from a bot standing at (-33.5, 118, 117.4). Surface-level
  (skyLight 15 at that spot, not a cave the bot was standing in), which is bizarre
  for a frozen-daylight server — almost certainly a dark cave/ravine system
  surfacing nearby, or a natural mob-farm-grade spawn chunk. Not engaged, not
  investigated further (retreated on low food). Stay-clear radius: treat r24 around
  (-33, 117, 110) as no-go for solo bots until someone scouts it properly with a
  full kit and backup; do NOT path bots through it for grass/wood/animal errands.
  This sits close to pen_1 (x=-32..-26, z=134..140) — worth factoring into any
  future pen defense/lighting work. Long-term: possible mob-farm site, parked for
  now per team-lead.
- **HAZARD ZONE #2 — second dense hostile mob cluster**, found live by MettMarcel
  2026-09-01 while en route to the escorted chicken hunt: 70+ hostiles (zombies,
  skeletons, spiders, creepers) around (-6, 109, -51), several as close as 30-40
  blocks. This one is deceptive: y=109 LOOKS like safe high ground per the
  elevation rule, but skyLight there was 0 — a stone/dirt overhang directly above
  (y=111-117 solid) put the bot in the dark despite the y-value. LESSON: check
  skyLight, not just y, before treating a spot as safe (`bot.blockAt(pos).skyLight`
  — 0 means shaded regardless of elevation). Retreated to base immediately at full
  health, no damage. Stay-clear radius: r24 around (-6, 109, -51) until scouted
  properly with full kit + backup. Not investigated further, not engaged.

## 8. Foreign territory (hands off, do not build here)

- **CAVECREW camp** (foreign Claude-bot crew: Grog, UngaBunga — friendly, speaks our
  DEPOT ledger format): depot chest at (11, 89, 55), crafting table at (12, 89, 56),
  camp on the slope SE of our base. Scouted by KackboonKevin 2026-08-31 ~23:2x.
  Rules: NEVER open their chest, never take their drops, no building within ~10
  blocks of (11, 89, 55). Chat coordination welcome — they announced their depot
  publicly and mirror our ledger lines.
- **Zetbot estate → CAVECREW** (2026-08-31, user-confirmed): all former zetbots ARE
  the CAVECREW now. The old zetbot2 claim sphere (-9,102,2) r16 from PLAYBOOK.md is
  DEFUNCT — do not route around it anymore. The underground storage near (-20,94,2)
  (2 chests + wood, accidentally breached by Bernd) — RESOLVED 2026-09-01: the
  public claim-inquiry deadline passed with no CAVECREW response, so the goods
  were treated as our stolen depot_chest_a stock. FurzFriedrich retrieved both
  chests at (-27,94,1): 47 oak_log, 103 birch_log, 33 oak_planks, 1 birch_planks,
  40 saplings (15 oak/25 birch), 21 gravel, 13 granite, 1 flint, 1 wheat_seeds —
  all banked (wood/planks/saplings → chest A, gravel/granite/flint → chest B,
  wheat_seeds → chest C for Marcel), both chests broken and kept, announced
  publicly in chat. The pocket is clear, no longer pending.

- **CAVECREW trading post** (registered 2026-09-01 by PflasterPeter, exact spec from CAVECREW's own repo): two chests at x=6-8, z=22, y=112. WEST chest (6,112,22) = CAVE shop, theirs — taking from it requires leaving fair payment in the SAME chest plus a chat line `TRADE take X, leave Y (CAVE shop)`. EAST chest (8,112,22) = FEL shop, ours to stock for them — deposit freely, no announcement required beyond normal DEPOT etiquette if pulling FROM our own stock to fill it. These two chests are the ONLY mutual-touch containers with CAVECREW; every other foreign chest/furnace stays off-limits per this section's existing rules. Foreign protocol-line scoping: CAVECREW's chat reuses OUR id vocabulary (their own furnace_1, chest A/B, USING/FREE, DEPOT lines) for THEIR infrastructure, not ours — scope every lease/DEPOT chat line by the SPEAKER's name; a line from a CAVECREW name is informational only, never a claim against our BASE.md rows or a lease we need to honor.

## 9. Changelog addendum

- 2026-08-31 (later) depot_chest_a REBUILT by FurzFriedrich — backfilled the
  missing floor block at (-5,110,1) with dirt (matches surrounding dirt, not
  cobble), crafted a fresh chest at crafting_table_1, placed it back at the
  original coords (-5,111,1), restocked with the wood haul I was carrying (43
  items). Row flipped destroyed -> built, same id/coords per MettMarcel's
  original report. Cause of the original destruction still unknown/unwitnessed;
  Bernd separately found "broken chests and a logpile" near zetbot2 territory
  while mining around the same time — possibly related, not confirmed.

- 2026-09-01 perimeter_wall_1 material supply update by FurzFriedrich — 43 of the
  ~81 needed stripped_oak_log posts banked (staged near (7,112,8), east of
  farm_1, ready for karl-driver's staging chest at (-6,111,8)). Also delivered
  the charcoal-pipeline torch restock: 90 torches banked to chest B via
  furnace_1 (oak_log) + furnace_2 (birch_log) running in parallel, fed with
  their own charcoal output as self-sustaining fuel — both furnaces still
  running for a second batch. Chest A's oak_log stock ran out mid-strip
  (furnace loads consumed most of it); remaining posts depend on further
  chopping. Note for the record: both of my stone_axes broke from the combined
  chop+strip workload during this stretch (right-tool-law gap — replaced with
  stone again in the moment since chest B had no iron at the time; craft an
  iron axe once iron is available, flagged per engine-dev's audit).

## 10. Engine test debris (NOT infrastructure — free to demolish)

Left standing by the engine v7 blueprint-building verification (2026-09-01). These are
throwaway test structures, deliberately NOT given registry ids: nobody depends on them,
nothing needs a lease, and any bot may dismantle and keep the materials. They are listed
here only so nobody mistakes them for someone's build — and so `chopTrees` drivers know
there are PLACED OAK LOGS here (chopTrees has no natural-tree guard yet and will fell
them as if they were trunks — see LEARNING_HANDOFF.md).

| what | coords | materials |
|---|---|---|
| test_hut_A (frameStructure) | (-3,104,28)–(1,106,32), doorway south | 12 oak_log corners, 34 cobblestone |
| test_hut_B (buildSchematic, hut5.schem) | (2,104,32)–(6,107,36), doorway south | 16 oak_log corners, 46 oak_planks |
| test_wall | (2,104,31)–(5,106,31) | 12 oak_log |

The test supply chest at (-2,103,34) was emptied and removed — do not look for it.
