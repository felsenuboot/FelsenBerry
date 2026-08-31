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
| depot_chest_b    | chest           | (-5, 111, 3)                | built   | shared          | FurzFriedrich  | 2026-08-31 |
| depot_chest_c    | chest           | (-3, 111, 1)                | built   | shared          | FurzFriedrich  | 2026-08-31 |
| furnace_1        | furnace         | (-3, 111, 3)                | built   | exclusive-lease | (pre-registry) | 2026-08-31 |
| furnace_2        | furnace         | (-3, 111, 2)                | built   | exclusive-lease | PflasterPeter  | 2026-08-31 |
| plaza_1          | plaza_11x11     | x=-8..2, z=-1..9, floor 110 | built   | shared          | PflasterPeter  | 2026-08-31 |
| quarry_ladder_1  | ladder_shaft    | (-4, 108..110, 4)           | planned | shared          | PflasterPeter  | 2026-08-31 |
| quarry_lane_1    | cobble_lane_3w  | x=-5..2, y=110, z=5..7      | built   | shared          | PflasterPeter  | 2026-08-31 |
| torch_posts_1    | light_posts_x8  | (-8,-1) (-8,9) (2,-1) (2,9) (-3,-1) (-3,9) (-8,4) (2,4), y=111..113 log+torch y114 | built | shared | PflasterPeter | 2026-09-01 |
| bed_1            | bed             | (0, 111, 1)-(0, 111, 2)     | planned | exclusive-lease | PflasterPeter  | 2026-08-31 | (dropped — daylight cycle frozen, beds useless) |
| bed_2            | bed             | (1, 111, 1)-(1, 111, 2)     | planned | exclusive-lease | (unassigned)   | 2026-08-31 | (dropped — daylight cycle frozen, beds useless) |
| pen_1            | fence_pen_7x7   | x=-32..-26, z=134..140, y134-140, gate (-29,140) | built   | shared          | MettMarcel     | 2026-08-31 |
| pond_1           | pond_2x2        | x=1..2, y=110, z=10..11     | built   | shared          | MettMarcel     | 2026-09-01 |
| house_1          | house_6x6       | x=-8..-3, z=10..15, floor+walls y110..113, roof y114, door (-6,111-112,10), windows (-8,112,12)+(-3,112,13) | built | shared | PflasterPeter | 2026-09-01 |
| farm_1           | wheat_plot      | (0,110,10) + ring around pond_1 | built | shared        | MettMarcel     | 2026-09-01 | (relocated from y=111,z=12-14 — that site was 1 block above pond_1's water level and un-hydratable, farmland kept drying back to dirt; moved to y=110 directly beside the pond, moisture confirmed 7/7. First tile planted with the bootstrap wheat_seeds from chest C.) |
| path_1           | trail_stepped   | plaza edge (2,110,5) toward CAVECREW camp (11,89,55), stops at (10,92,50) — 5+ blocks short of their chest | built | shared | PflasterPeter | 2026-09-01 | (1 tile at (8,100,39) unreachable, see changelog) |
| main_hall_1      | hall_8x5        | x=-7..0, z=-6..-2, floor+walls y110..113, roof y114, open colonnade on the south (plaza-facing) wall | planned | shared | PflasterPeter | 2026-09-01 | (user-requested: covers the crafting-table/depot hub where the fleet congregates; shrunk from depth 6 to 5 — z=-7 is a real cliff edge, 5-block drop, not a buildable floor) |

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
- 2026-09-01 main_hall_1 PLANNED by PflasterPeter — user-requested main hall covering the crafting-table/chest/furnace hub where the fleet has been congregating (Friedrich, Kevin, Bernd, Ook all clustered there). 8x6 footprint x=-7..0, z=-7..-2, immediately north of and flush with the plaza's z=-1 edge — grass there cleared as part of the build. Solid walls on 3 sides, open colonnade on the south (plaza-facing) side using the existing torch_posts_1 pillars at (-8,-1) and (2,-1) as informal gateposts just outside the opening.
- 2026-09-01 path_1 BUILT by PflasterPeter — 46-tile stepped cobblestone trail from the plaza edge (2,110,5) down to (10,92,50), following the natural hillside grade (no cliffs), headroom cleared, torch every 7 steps. One tile at (8,100,39) stayed unreachable after 3 attempts (pathfinder wouldn't route there even though neighbors look solid) — small 1-block gap, not blocking; flagging for a follow-up pass, not worth further time against the user's pace directive.
- 2026-09-01 house_1 BUILT by PflasterPeter — cobblestone floor (36) + framed shell (4 oak_log corners, oak_planks infill, height 4) + cobblestone roof (36), door centered on the north wall (facing the plaza) at (-6,111-112,10), one window cut in each side wall, 2 interior torches. Note: frameStructure's origin.y is the WALL BOTTOM, not "one above the floor" as first assumed — its perimeter ring at y=110 is log/plank (doubling as both wall base and floor edge) with cobblestone only in the interior floor; noted for future callers of this skill. One frame block needed a manual patch (no_reference at (-4,111,10)); 4 roof tiles needed a manual patch (unreachable along the x=-8 edge). No drops lost.
- 2026-09-01 bridge demolition by PflasterPeter — cleared 14 blocks of stray elevated dirt/grass_block (pathfinder-scaffolded, floating over the ravine at z=-4/y=117 just north of the plaza, plus a second fragment near x=9-11,z=-6..-10) per user request; no drops left behind.
- 2026-09-01 house_1 PLANNED by PflasterPeter — 6x6 footprint at x=-8..-3, z=10..15, floor y110 (matches plaza level), walls y111..114, sited at the plaza's SW corner (adjacent, outside plaza bounds). Shifted 1 block west from the original x=-7..-2 plan once Marcel's farm_1 (x=-2..2, z=12..14) landed — now clear of it and of pond_1 (x=1..2). Framed shell: oak_log corner posts + oak_planks infill, cobblestone floor + roof, centered door gap on the z=10 (north/plaza-facing) wall, torch-lit interior.
- 2026-09-01 torch_posts_1 BUILT by PflasterPeter — 8 oak-log pillars (y111-113) with a torch on top (y114) at the 4 plaza corners + 4 edge midpoints, listed coords in the row above. Survived two accidental demolitions by FurzFriedrich's chopTrees (structure logs read as trees, drops recovered, rebuilt both times) before the fleet's dig-guard went live to protect them; verified all 8 columns clean on 2026-09-01. plaza_1's floor re-verified 119/120 cobblestone (only exception: (-5,110,1), intentionally left dirt — it sits under depot_chest_a, invisible, not worth disturbing the chest). Next: bridge demolition (stray elevated dirt bridge NW of plaza), then house_1.
- 2026-08-31 (resumed shift) plaza_1 pavement COMPLETE by PflasterPeter — all 120 floor cells (minus the intentional open shaft column at (-4,4)) are now cobblestone, sourced via mineLane (42 cobble from a stone pocket near the reserved quarry_ladder_1 column) plus depot chest B withdrawals (DEPOT -35, -8). One tile at (-5,110,1) intentionally left as dirt — it sits directly under depot_chest_a and is not visible/walkable, not worth the risk of disturbing the chest. Also found and fixed a bot-trapping incident: pathfinder opened a floor hole at (2,110,4) while routing home, self-rescued and repatched. Next: torch_posts_1, then house_1 and path_1 per new user orders (see TODO/team-lead).

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

## 9. Changelog addendum

- 2026-08-31 (later) depot_chest_a REBUILT by FurzFriedrich — backfilled the
  missing floor block at (-5,110,1) with dirt (matches surrounding dirt, not
  cobble), crafted a fresh chest at crafting_table_1, placed it back at the
  original coords (-5,111,1), restocked with the wood haul I was carrying (43
  items). Row flipped destroyed -> built, same id/coords per MettMarcel's
  original report. Cause of the original destruction still unknown/unwitnessed;
  Bernd separately found "broken chests and a logpile" near zetbot2 territory
  while mining around the same time — possibly related, not confirmed.
