# Research: human-looking building (TODO 1, aesthetics track)

Date: 2026-09-01. Researcher: aesthetics research agent (web + repo + local engine reading only).
Scope: (a) schematic sources, (b) procedural generation, (c) build-order best practices,
(d) concrete plans for house_1 and path_1. Calibrated against the ACTUAL engine as of
skills.js v7 + runner.js blueprint layer (read 2026-09-01).

---

## 0. Engine ground truth this report is calibrated to

Verified by reading `/home/felix/minecraft/bots/skills.js` and `runner.js`:

- Placement model: `{name:'oak_planks', pos:[x,y,z]}` world-anchored. `POST /blueprint/load`
  parses `.schem` via prismarine-schematic 1.3.0, stores `props` (block state properties)
  on each placement **but the builder ignores them** — every block is placed with whatever
  state the server derives from placement context (bot look direction, clicked face).
- Caps: `BUILD_MAX = 4096` inline, `BLUEPRINT_MAX_BLOCKS = 4096` (runner.js:86).
- Order: bottom-up row-major sort `(y, z, x)` — support always exists before a block needs it.
- Verify: `bot.blockAt(cell).name === placement.name` — **name only, states never checked**,
  so a wrong-facing stair "verifies" fine but looks wrong.
- Already solid: resume-aware (prepaid cells skipped), chest restock loop, PROTECTED /
  NUISANCE block sets, pathfinder guard (scafoldingBlocks=[], exclusionAreasBreak over the
  build's own cells), `itemForBlock` mapping (wall_torch→torch, water→water_bucket, ...),
  GRAVITY warning, `validatePlacements` rejects blocks with no placeable item.

**The single most important consequence:** orientation-critical blocks (stairs, doors,
trapdoors, beds, ladders-on-specific-face, horizontal logs) are unreliable today. Blocks
that are state-safe under naive placement: all full cubes, torches (face auto-derived),
fences/walls/glass panes (auto-connect), vertical logs (top-face placement gives axis=y),
bottom slabs (top-face placement gives type=bottom — side-face placement is a coin flip).
Every design below is built from the state-safe palette first, with stairs/doors flagged
as a v1.1 upgrade.

---

## (a) Schematic sources for small survival houses

### Format reality check (verified against the installed library)

prismarine-schematic **1.3.0** (latest on npm, MIT) supports exactly:

| Format | Support | Notes (from `lib/spongeSchematic.js` / `lib/mceditSchematic.js` in node_modules) |
|---|---|---|
| Sponge `.schem` **v1/v2** | read + write | reads top-level `Palette`/`BlockData`; palette parsed by name via minecraft-data for `bot.version` |
| Sponge `.schem` **v3** | **NOT supported** | v3 nests `Blocks:{Palette,Data}` — 1.3.0 crashes/empties on it. Upstream PR [#61](https://github.com/PrismarineJS/prismarine-schematic/pull/61) unmerged. **WorldEdit 7.3+ saves v3 by default** ([Maddy Miller's 7.3 notes](https://madelinemiller.dev/blog/introducing-worldedit-7-3/)); WE users can force v2 with `//schem save <name> sponge.2` |
| MCEdit `.schematic` (pre-1.13) | read-only | legacy id:data → modern names via minecraft-data legacy map, unknown → `stone` fallback. Works, but pre-1.13 builds use old palettes (double stone slabs etc.) — expect off-palette results on a 1.21 server |
| `.litematic` (Litematica) | **NOT supported** | needs conversion first |

Repo: [PrismarineJS/prismarine-schematic](https://github.com/PrismarineJS/prismarine-schematic) (MIT).

**Engineering follow-up #1 — Sponge v3 shim (small, high value):** in runner.js
`/blueprint/load`, before `Schematic.read`, sniff the parsed NBT: if root is a `Schematic`
compound with `Version:3`, remap in place — `Schematic.Blocks.Palette → Palette`,
`Schematic.Blocks.Data → BlockData`, hoist `Width/Height/Length/DataVersion/Offset`,
drop `Biomes`/`Entities` — then feed the v2-shaped NBT to the existing reader. ~30 lines
with prismarine-nbt (already a transitive dep of mineflayer). Without this, a large share
of freshly-exported 2024+ `.schem` downloads will fail to parse.

**Engineering follow-up #2 — litematic ingestion (no Java on this box!):** Java 21 is not
installed (TODO 2 blocker), so Java converters (SchemConvert, GrabcraftLitematic mod) are
out. Java-free options:
- Node: [`litematic-parser`](https://libraries.io/npm/litematic-parser) or
  [`@kleppe/litematic-reader`](https://www.npmjs.com/package/@kleppe/litematic-reader) —
  parse `.litematic` directly, emit our placement JSON (skip .schem entirely: POST the
  placements inline or add a `/blueprint/load` `placements` variant).
- Python: [litemapy](https://pypi.org/project/litemapy/) (read .litematic) — a one-shot
  `blueprints/tools/litematic2placements.py` script is ~60 lines.
The Node route fits the stack better; parse offline, never in-bot.

### Source sites (verified 2026-09-01)

1. **Abfielder** — https://abfielder.com/ — the best direct-`.schem` source found.
   Free, no login for downloads; blocks generic fetchers (403) but plain `curl -A "Mozilla/5.0..."`
   works (verified: product page id=6143 returns 200 with download link
   `/Products/ProductDownloadThankYou.php?productId=6143&file=5276`). Offers both `.schem`
   and `.litematic` per build. Verified survival-scale candidates:
   - [Compact Starter House by Dreamy](https://abfielder.com/Products/ProductDetails.php?id=6143) — explicitly "`.schem` for WorldEdit", 1.20+
   - [Small Starter House by UnikSpider](https://abfielder.com/Products/ProductDetails.php?id=3227)
   - [Small Wooden Survival House by KubaRM](https://abfielder.com/Products/ProductDetails.php?id=10089) — 1.21.10-era, litematic
   - [minecraft starting survival house by vaxiro](https://abfielder.com/Products/ProductDetails.php?id=12284)
2. **MineSchematic** — https://mineschematic.com/c/houses — 116+ house/base builds, 3D
   preview, exports `.litematic`, `.schem` AND `.nbt`, "free to download ... no account
   required" (their FAQ). Has explicit "starter house" and "compact" categories. Newer
   exports are likely Sponge v3 → needs follow-up #1.
3. **Planet Minecraft** — [projects tagged survivalhouse with schematic downloads](https://www.planetminecraft.com/projects/tag/survivalhouse/?share=schematic) —
   huge catalog, mixed formats/quality; per-project license line shown on each page (many
   are "All Rights Reserved" — check per item).
4. **minecraft-schematics.com** — legacy MCEdit `.schematic` catalog; readable by our lib
   read-only, but pre-1.13 palettes translate imperfectly. Use only if 1+2 lack something.
5. **GrabCraft** — https://www.grabcraft.com/ — **skip**. Uses a proprietary RenderObject
   JSON format, no schematic downloads; converters are a Java mod
   ([gbl/GrabcraftLitematic](https://github.com/gbl/GrabcraftLitematic), blocked: no Java)
   or Python→litematic ([RandomGamingDev/grabcraft-to-schema](https://github.com/RandomGamingDev/grabcraft-to-schema)),
   i.e. a two-hop conversion for builds no better than Abfielder's. Not worth the pipeline.
6. Honourable mentions: [Schemat.io](https://schemat.io/schematics),
   [BuiltByBit free schematics](https://builtbybit.com/resources/free-small-starter-house-schematic.119271/) — smaller catalogs, same caveats.

**Licensing:** none of the schematic sites grant a real redistribution license; uploads
are user content (MineSchematic/Abfielder say "free to download", Planet Minecraft shows
per-item licenses, often ARR). Using them to build on our private offline server is
uncontroversial; **do not commit downloaded .schem files to any public repo** and record
the source URL per file. Everything code-level cited here (prismarine-schematic, gdpc,
WFC ports, MGAIA) is MIT.

### Vetting checklist before a schematic enters `blueprints/`

Run at load time (the `/blueprint/load` response already returns most of this):
1. `blocks <= 4096` non-air (hard cap) — small houses are typically 300–1500.
2. **State-risk %**: count placements whose `props` differ from default (the load response
   already warns with `nonDefaultState`). Rule of thumb: >15% stairs/doors/trapdoors =
   will look broken with today's builder — reject or strip to the shell.
3. No blocks failing `validatePlacements` (no placeable item — e.g. `dirt_path`, crops).
4. Bill must be survival-affordable in OUR economy (oak/birch logs, planks, cobble, glass
   only after a sand run; no quartz/terracotta/copper fantasy palettes).
5. Gravity blocks over air (load warns) and water/lava cells (bucket logistics).
6. Footprint fits the site + 1-block working perimeter.

Keep a `blueprints/MANIFEST.md`: file, source URL, author, size, bill summary,
state-risk %, vetted-by, live-tested date. (`hut5.schem` — 213 bytes, engine smoke test —
is the first row.)

---

## (b) Procedural generation of small houses/bases

### What the field actually does (and what ports to our placement-list model)

Researched: the GDMC settlement-generation literature and winning entries, WFC, shape
grammars. Honest ranking **for our scale** (one 6x6–9x9 hut at a time, 4096-block cap,
survival economy, LLM-driven fleet):

1. **Template + palette + jitter — RECOMMENDED NOW.** This is what practical Minecraft
   house generators actually ship, including the official
   [GDPC "Building a house" tutorial](https://gdpc.readthedocs.io/en/stable/getting-started/tutorial-house.html)
   ([gdpc framework, MIT](https://github.com/avdstaaij/gdpc)). Verified techniques worth
   porting verbatim to a `genHouse` generator next to `genFrame`:
   - **Weighted random palettes**: pass a list instead of one material and sample per
     block — e.g. floor `[stone_bricks, cracked_stone_bricks, cobblestone]`. In our model:
     `material: [{name, weight}]`, sampled with a **seeded PRNG** (seed = structure id) so
     a resumed/rebuilt structure re-generates the identical placement list (buildCore's
     prepaid-cell resume depends on determinism!).
   - **Randomized dimensions** within clamps (their example: height 3–7, depth 3–10) so
     two houses are never identical.
   - **Foundation piles**: extend the floor/base course downward until solid ground
     (~up to 5 blocks) so houses sit ON terrain instead of floating over dips — the
     single cheapest "a human built this" trick on sloped ground.
   - Stair roofs with facing/half properties — **defer** until props support (v1.1).
2. **Room grammar / BSP splits — LATER, for base v2 multi-room buildings.** Classic
   approach (CGA shape grammars, Müller et al. 2006; roguelike BSP): recursively split a
   rectangle into 2–4 rooms, share walls, connect with doorway gaps, one entrance. Ports
   trivially to placements (it is just nested genFrame calls with shared-wall dedup).
   Not needed for a 6x6 hut.
3. **Wave Function Collapse — ONLY at module granularity, offline.** The Leiden MGAIA
   GDMC entry ([ScholliYT/MGAIA-Minecraft-GDMC](https://github.com/ScholliYT/MGAIA-Minecraft-GDMC),
   MIT, Python) is the proven pattern: WFC over **hand-scanned room modules** (their house
   = 5x2x5 grid of structure building blocks), not over individual blocks. Block-level 3D
   WFC produces mush and is token/compute-expensive for zero aesthetic gain at hut scale.
   If we ever want WFC variety, run it OFFLINE in Node with
   [`wavefunctioncollapse`](https://www.npmjs.com/package/wavefunctioncollapse) (npm 2.1.0,
   MIT, [kchapelier's port](https://github.com/kchapelier/wavefunctioncollapse) of
   [mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)) to emit a
   placement list — never in-bot, never per-build. Matches the token-efficiency doctrine.
4. Background reading: [GDMC competition paper (Salge et al., arXiv:1803.09853)](https://arxiv.org/abs/1803.09853),
   [gendesignmc.engineering.nyu.edu](https://gendesignmc.engineering.nyu.edu/) — judging
   criteria (adaptability to terrain, functionality, narrative) are a decent aesthetics
   rubric for our fleet too.

### Implementation-ready spec: `genHouse(spec)` (skills.js v8, sits beside genWall/genFloor/genFrame)

Pure function → sorted placement list, reusing `sortPlacements`/`bpNum`/`bpMat`:

```
spec = {
  origin: {x,y,z},            // floor level, min corner (like genFrame)
  width: 5..9, depth: 5..9,   // clamp; default random-in-range from seed
  wallHeight: 3..4,
  seed: 'house_1',            // REQUIRED: deterministic PRNG (mulberry32 over a string hash)
  palette: {
    floor:  [{name:'cobblestone',w:1}],
    base:   [{name:'cobblestone',w:1}],            // course at wall y+0, grounds the build
    corner: [{name:'oak_log',w:1}],                // continuous posts, floor..top
    wall:   [{name:'oak_planks',w:.85},{name:'stripped_oak_log',w:.15}],  // subtle texture
    roof:   [{name:'birch_planks',w:1}],
    trim:   [{name:'oak_fence',w:1}],              // optional under-eave detail
  },
  doorway: 'north'|'south'|'east'|'west',          // ALWAYS faces the path/plaza
  windows: true,               // rule: on every wall segment >=5 wide, 1x1 gaps at
                               // wall y+2, spaced 2 apart, never adjacent to a corner,
                               // symmetric about the wall centre; emitted as SKIP cells
                               // now, glass_pane placements once glass exists (panes
                               // auto-connect — state-safe)
  roof: 'hip'|'flat-eave',     // both state-safe, see below
  foundation: 5,               // extend base course down <=N blocks where ground is air
  torches: 'auto',             // 2 interior wall torches on back wall + 1 outside each
                               // side of the door (torch item auto-faces — state-safe)
}
```

State-safe roofs (no stairs until props land):
- **`hip` (recommended, reads most human):** stepped pyramid of full blocks. Course 0 at
  wallTop+1 covering footprint **+1 overhang all around** (eave — overhang blocks attach
  to the side faces of the inner course, full cubes are orientation-free); each next
  course insets 1 per side, +1 y, until <=2 wide. 6x6 house → 8x8 / 6x6 / 4x4 / 2x2.
- **`flat-eave` (cheapest):** one course at wallTop+1, footprint+1 overhang. Optional slab
  version halves material but side-face slab placement can flip top/bottom — live-test
  before trusting (placeBlockAt cursor control is the fix; see v1.1 roadmap).

Placement-order guarantee: emit floor → foundation piles → base course → corners →
walls → roof inner-before-overhang per course; the existing `(y,z,x)` sort already
yields this except **roof overhang cells**, which sit at the same y as inner cells but
have no support below — emit them and rely on buildCore's defer-and-retry (it already
defers unreachable/no-support placements), or tag the generator to append them last
within their y (sort key tweak: `(y, hasSupportBelow?0:1, z, x)` — 1-line change).

Props roadmap (v1.1, unblocks stair roofs + real doors + downloaded schematics at full
fidelity): placements already carry `p.props` from the loader. Support the three cheap
ones first — `axis` for logs (choose clicked face: top face → y, side face → horizontal),
`half` for slabs (cursor y within face), `facing` for stairs/doors via pre-placement
`bot.lookAt` toward the desired facing before `placeBlock` (server derives facing from
look). Verify pass then compares stateId, not name, for cells with props.

---

## (c) Build-order best practices for survival bots

What Baritone (the reference survival builder) does, plus field-verified rules:

1. **Bottom-up, layer-complete.** Baritone's `buildInLayers` + `layerOrder=false`
   (bottom→top) is the survival default ([settings](https://baritone.leijurv.com/baritone/api/Settings.html));
   our `(y,z,x)` sort is exactly this. Keep it.
2. **Scaffold-free by design, not by cleverness.** A bot standing on ground level places
   reliably ~4 blocks above its feet. Wall height <=4 + roof at +5 is reachable from
   ground + from standing on the floor inside — a 6x6x4 hut needs ZERO scaffolding.
   Anything taller: build a `buildStaircase` dirt ramp and remove it after (never
   pathfinder self-towering — scafoldingBlocks=[] already enforces that), or design
   multi-storey so each storey's floor is the work platform for the next.
3. **Work from outside the shell; door gap is the exit.** Wall courses are placed
   circling the OUTSIDE perimeter (placements reachable from outside stand cells);
   the doorway gap stays open until last so the bot is never entombed. buildCore's
   defer/retry handles the odd unreachable cell — do not fight it, order for it.
4. **Roof: inner cells first, then eaves** (support/attachment exists), standing on the
   top wall course or the just-placed roof — with `maxDropDown=3` the walk-off is safe.
5. **The site is part of the build.** Human-looking = no bot damage AROUND the structure:
   clearSite digs produce drops → `collectDrops` sweep at the end (no-drops rule);
   backfill any access cuts with the surface's own block type (PLAYBOOK rule already);
   torch the workspace during the build (universal torch preflight, FEEDBACK item).
6. **Restock rhythm:** bill the whole structure up front (buildCore does), stage materials
   in depot chest B, set `chest:` so mid-build restocks are automatic; 4096-block builds
   at ~1–2s/block = 1–2h — queue as ONE task, drivers poll, never per-block LLM.
7. **Palette doctrine that reads "human"** (distilled from GDMC judging criteria + the
   GDPC tutorial + builder-community consensus):
   - **Three-material rule**: frame (logs) + infill (planks) + grounding (stone family).
     One material = shed; five = clown house.
   - **Base course in stone** where walls meet ground — buildings "grow" out of terrain.
   - **Continuous corner posts**, floor to roofline (genFrame does this; keep posts
     unbroken through the base course too).
   - **Window rhythm**: symmetric, at eye height (wall y+2), never in corners. Gaps read
     fine until glass exists; glass_pane retrofit is state-safe.
   - **Roof overhang of 1** — the strongest single "not a bot" signal on small builds.
   - **Texture in moderation**: 10–20% accent blocks in walls (stripped logs), sampled
     with the seeded PRNG — GDPC's palette-list trick.
   - **Doors face the approach**; a path meets the door; a torch flanks it either side.
   - **Fence-post + torch** as the standard exterior light fixture (matches the existing
     torch_posts_1 "brand" — visual continuity across the base).
8. **Verify then register**: buildCore's verify pass, then flip BASE.md `planned→built`
   and announce — already the convention; blueprints just make the "straight walls,
   symmetric layout" part free.

(Reference on why we roll our own: [PrismarineJS/mineflayer-builder](https://github.com/PrismarineJS/mineflayer-builder)
is officially "Work in progress ... not an usable package yet", flat-world/creative/op
oriented — our buildCore is already ahead of it for survival. Nothing to adopt there.)

---

## (d) Concrete recommendations: house_1 and path_1

### house_1 (planned: 6x6 at x=-8..-3, z=10..15, floor y110, walls y111..114, door north)

Keep the registered footprint and orientation (door on z=10 faces the plaza). Upgrade the
planned "cobble roof, flat" to the state-safe hip roof and the three-material palette:

| Stage | Cells | Material | Count |
|---|---|---|---|
| 1. floor y110 | 6x6 | cobblestone | 36 (some prepaid from terrain) |
| 2. base course y111 perimeter | 20 minus 4 corners minus door | cobblestone | 15 |
| 3. corner posts y111–114 | 4 × 4 | oak_log (places axis=y naturally) | 16 |
| 4. walls y112–114 | 16 cols × 3 minus door-top minus 6 windows | oak_planks (+ ~15% stripped_oak_log accents) | 41 |
| 5. roof y115 hip course 0 | 8x8 (1-block eave) | birch_planks (two-tone: pale roof over oak) | 64 |
| 6. roof y116/117/118 | 6x6 / 4x4 / 2x2 | birch_planks | 56 |
| 7. torches | 2 interior back wall + 2 flanking door outside | torch | 4 |

Bill: ~51 cobble, 16 oak_log, ~41 oak_planks (11 logs), ~120 birch_planks (30 logs).
Fits banked stock (47 oak_log + 103 birch_log + 33 oak_planks in chest A, cobble trivially
minable) with margin. Windows: 2 gaps each on east/west walls at y113, 1 on south, 1 north
beside the door — leave open now, retrofit glass_pane after a sand→furnace run (panes are
state-safe). Door: leave the 1x2 gap this iteration; attempt one `oak_door` place as a
live experiment (server derives facing/hinge from placement context — if it looks wrong,
dig it, keep the gap, park doors for props v1.1).

Execution: stage materials in depot chest B → single `buildSchematic`-style queued task
(inline placements from genHouse, or generate once and `/blueprint/load` them) with
`chest: {depot B}`, `clearSite: true` → collectDrops sweep → verify → BASE.md flip +
`BASE +house_1` announce. No scaffolding needed anywhere (max place height y118 reached
standing on the y115/116 roof courses).

### path_1 — the CAVECREW friendship road

Route: plaza SE corner (2,110,9) → CAVECREW camp at (11,89,55). ~47 blocks of ground
distance, 21 blocks of descent — a genuine hillside road. **Hard stop >=10 blocks from
their depot chest (11,89,55)** per BASE.md section 8: terminate around (8..10, ~92, 44)
with a terminus post + sign facing their camp ("→ CAVECREW", oak_sign; `wall_sign→sign`
item mapping already exists; sign text via bot.updateSign is a live-test item).

Design spec (state-safe throughout):
- **Width 2**, surface-following. Palette: cobblestone ~80% / gravel ~20% seeded-random
  (21 gravel banked; gravity block — only place where support below is solid, the
  generator checks). Two materials make it read as a laid road, not a bot trail.
  (`dirt_path` would be ideal but has no placeable item — engine can't shovel-till yet;
  possible future primitive.)
- **Grade rule: max 1 y-step per cell.** Where terrain drops faster, CUT into the slope
  (dig headroom, 3 air above each path cell) rather than building up; bridge dips <=2
  deep with cobble supports under the path cells. Backfill cut faces with the local
  surface block.
- **Lighting fixture every 8 blocks, alternating sides:** 1 oak_log post + torch on top —
  the torch_posts_1 fixture at path scale (visual continuity, ~6 posts + 6 torches).
- Bill estimate: ~95 path blocks (80 cobble / 15 gravel) + ~10 support cobble + 6 log +
  7 torches + 1 sign. Cobble from the quarry, everything else banked.

**Do NOT pre-generate this from remote blockAt data** — the stale-chunk quirk
(LEARNING_HANDOFF) makes a remote heightmap survey untrustworthy. Correct pattern, and
the rule-of-twice skill this justifies:

`buildPath(waypoints, {width, palette, torchEvery, maxGrade})` — walks the route leg by
leg; per leg (~16 blocks): read live surface heights, generate that leg's placements
(path cells at ground level replacing grass/dirt via clearMismatch, headroom digs,
supports, torch posts), place, sweep drops, advance. Interpolates between sparse
waypoints so a driver specifies ~4 points for the whole road. This is roads as a
CAPABILITY (base↔pen, base↔quarry next), not a one-off — exactly the engine-goal shape.

### Suggested engine work queue for engine-dev (smallest first)

1. Sponge v3→v2 NBT shim in `/blueprint/load` (~30 lines; unblocks most 2024+ .schem files).
2. `genHouse` generator + seeded palette sampling + `hasSupportBelow` sort-key tweak
   (roof eaves defer cleanly).
3. `buildPath` skill (leg-wise live generation; kills the stale-chunk survey trap).
4. blueprints/MANIFEST.md + vetting script (load-time report is already 90% of it).
5. litematic→placements converter (Node `litematic-parser`), opening MineSchematic/
   Litematica-only catalogs.
6. Props v1.1 (axis/half/facing via look+cursor control) → stair roofs, real doors,
   full-fidelity downloaded schematics; verify by stateId for prop-carrying cells.

---

## Sources

- prismarine-schematic: https://github.com/PrismarineJS/prismarine-schematic (MIT); Sponge v3 PR: https://github.com/PrismarineJS/prismarine-schematic/pull/61 ; installed 1.3.0 lib source read locally (`lib/spongeSchematic.js`, `lib/mceditSchematic.js`)
- Sponge spec: https://github.com/SpongePowered/Schematic-Specification ; WorldEdit 7.3 v3 default: https://madelinemiller.dev/blog/introducing-worldedit-7-3/
- Abfielder: https://abfielder.com/ (+ product pages 6143, 3227, 10089, 12284 — download flow verified via curl 2026-09-01)
- MineSchematic: https://mineschematic.com/c/houses ; Planet Minecraft schematic tag: https://www.planetminecraft.com/projects/tag/survivalhouse/?share=schematic ; Schemat.io: https://schemat.io/schematics ; BuiltByBit: https://builtbybit.com/resources/free-small-starter-house-schematic.119271/
- GrabCraft converters: https://github.com/gbl/GrabcraftLitematic , https://github.com/RandomGamingDev/grabcraft-to-schema , https://github.com/PiTheGuy/SchemConvert (Java — blocked here)
- litematic parsing: https://libraries.io/npm/litematic-parser , https://www.npmjs.com/package/@kleppe/litematic-reader , https://pypi.org/project/litemapy/
- GDPC framework + house tutorial: https://github.com/avdstaaij/gdpc , https://gdpc.readthedocs.io/en/stable/getting-started/tutorial-house.html
- GDMC: https://gendesignmc.engineering.nyu.edu/ , paper https://arxiv.org/abs/1803.09853 ; module-WFC entry: https://github.com/ScholliYT/MGAIA-Minecraft-GDMC (MIT)
- WFC: https://github.com/mxgmn/WaveFunctionCollapse (MIT) , JS port https://github.com/kchapelier/wavefunctioncollapse / npm `wavefunctioncollapse` 2.1.0
- Baritone builder settings (layer doctrine): https://baritone.leijurv.com/baritone/api/Settings.html
- mineflayer-builder status: https://github.com/PrismarineJS/mineflayer-builder ("not an usable package yet")
