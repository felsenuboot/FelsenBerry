# Blueprint Library

Starter schematic library for the fleet. All files validated 2026-09-01 with the repo's
prismarine-schematic 1.3.0 (`Schematic.read`, mcData "1.21"): every file is gzipped NBT
(magic `1f 8b`) and **Sponge v2** — parses with the CURRENT loader, no v3 shim needed
(the v3→v2 shim from research/build-aesthetics.md stays queued for future downloads;
WorldEdit 7.3+ exports default to v3).

Footprint = X×Z ground area, height = Y. All builds are far under the 4096-block cap.

## Catalog

| File | What it is | Footprint W×L×H | Sponge | Parse (1.3.0) | Blocks | Est. materials (top) | Source | Author / license |
|---|---|---|---|---|---|---|---|---|
| hut5.schem | engine smoke-test hut | 5×5×4 | v2 | OK | 62 | oak_planks 46, oak_log 16 | (generated in-repo) | ours |
| cabin_small_wooden.schem | small log house, spruce/oak, stair roof | 7×10×8 | v2 | OK | 221 | spruce_planks 85, spruce_stairs 47, oak_log 32, oak_stairs 20, glass_pane 5, 2 chests + door | [abfielder id=3172](https://abfielder.com/Products/ProductDetails.php?id=3172) | Yero-Quad, free download¹ |
| house_little_medieval.schem | tiny medieval house, red roof | 13×7×10 | v2 | OK | 403 | red_terracotta 64, mangrove_planks 53, deepslate_tile_stairs 37, oak_log 22, stone_bricks 17 | [abfielder id=13662](https://abfielder.com/Products/ProductDetails.php?id=13662) | SpicyT, free download¹, "Survival Friendly: yes" |
| shed_mangrove.schem | storage/garden shed (Foxglove) | 11×12×9 | v2 | OK | 510 | smooth_sandstone 78, mud_bricks 68, spruce_slab 66, stripped_mangrove_wood 51, + dirt/grass skirt 132 | [abfielder id=12265](https://abfielder.com/Products/ProductDetails.php?id=12265) | Foxglove Builds, "[FREE]" ¹ |
| well_stone_brick.schem | stone-brick well (shaft goes below grade) | 9×9×16 | v2 | OK | 350 | stone_bricks 103, polished_andesite 31, smooth_stone 25, dark_oak_fence 16, water 38 | [abfielder id=13670](https://abfielder.com/Products/ProductDetails.php?id=13670) | SpicyT, free download¹, "Survival Friendly: yes" |
| fountain_small.schem | small stone fountain + lawn base | 9×9×7 | v2 | OK | 166 | stone_brick_slab 20, mossy_stone_brick_stairs 16, stone_bricks 6, water 40, grass/dirt base 56 | [abfielder id=10657](https://abfielder.com/Products/ProductDetails.php?id=10657) | jxtgaming, free download¹ |
| bridge_small.schem | cobble+spruce footbridge over a stream | 13×5×6 | v2 | OK | 202 | spruce_slab 33, cobblestone_slab 28, cobblestone_wall 4, lantern 4, + stream context (dirt 64, water 45) | [abfielder id=10656](https://abfielder.com/Products/ProductDetails.php?id=10656) | jxtgaming, free download¹ |
| gazebo_oak.schem | wooden gazebo / plaza pavilion | 11×11×7 | v2 | OK | 269 | spruce_slab 125, oak_planks 56, birch_fence 21, stripped_oak_log 18, lantern 8 | [abfielder id=2504](https://abfielder.com/Products/ProductDetails.php?id=2504) | Silex, free download¹ |
| tower_stone_9x9.schem | stone watchtower (TALL — see notes) | 9×9×27 | v2 | OK | 957 | stone 217, stone_bricks 143, polished_andesite 114, andesite 103, dark_oak accents 80 | [abfielder id=13666](https://abfielder.com/Products/ProductDetails.php?id=13666) | SpicyT, free download¹, "Survival Friendly: yes" |

¹ **Licensing**: Abfielder downloads are free, no login; site footer: "All creations
copyright of the creators." No redistribution license is granted — fine to build on our
private server, **never commit these .schem files to a public repo** (research doctrine).
Files converted from .litematic (cabin, fountain, bridge, gazebo) were converted locally
with Abfielder's own public converter logic (see tools/ below), share-back disabled.

## Vetting notes (state-risk per research/build-aesthetics.md checklist)

Orientation-critical blocks (stairs/doors/trapdoors/horizontal logs) place with WRONG
facing under today's builder (props ignored). Rule of thumb: >15% = looks broken.

| File | Orientation-critical | Verdict today |
|---|---|---|
| hut5, bridge_small | 0% | build now |
| well_stone_brick | 1% | build now |
| gazebo_oak | 2% | build now |
| fountain_small | 10% | build now |
| shed_mangrove | 12% | build now (trapdoor decor may misface) |
| tower_stone_9x9 | 14% | buildable, but H=27 needs ramp/storey doctrine — walls >+4 unreachable from ground; also over the ≤15 height law, treat as special project |
| house_little_medieval | 29% | wait for props v1.1 (stair roof) or accept rough roof |
| cabin_small_wooden | 38% | wait for props v1.1 (stair roof + door) |

Other per-file notes:
- **shed_mangrove, fountain_small, bridge_small** bake in a terrain skirt (grass/dirt,
  and stream water for the bridge). Either site them on matching terrain or strip the
  bottom 1–2 layers from the placement list before queueing.
- **Water blocks** (well 38, fountain 40, bridge 45): bucket logistics —
  `itemForBlock` maps water→water_bucket; expect refill trips or place-once + let flow.
- **house_little_medieval**: red_terracotta roof = 64 clay→smelt; economy substitute:
  bricks or spruce_planks. Contains 1 `cactus_flower` (1.21.4+ block) that mcData "1.21"
  drops to air — harmless.
- **well/tower** contain `iron_chain` (1.21.5+ rename) — drops to air under mcData
  "1.21"; substitute `chain` if it matters.
- **Mangrove/mud** (shed) and **deepslate tiles** (house, tower) are survival-obtainable
  but off our oak/cobble economy — palette-swap at load time is fair game.

## How to build one

1. `POST /blueprint/load` with the .schem path + world anchor — parses via
   prismarine-schematic, returns the placement list, material bill, and warnings
   (nonDefaultState %, gravity-over-air, no-item blocks). Vet: bill affordable, site
   fits + 1-block work perimeter.
2. Stage the bill in a depot chest (DEPOT.md protocol), then queue ONE
   `__skills.buildSchematic` task with `chest:` set for auto-restock. Placement order
   is bottom-up `(y,z,x)` — support-safe; buildCore defers unreachable cells and
   resumes prepaid ones.
3. Verify pass runs by block NAME only (facing not checked) — see vetting table above
   for which files that's acceptable on today.
4. After verify: collectDrops sweep, BASE.md flip planned→built, announce in chat.

## Shim / format status

- **Sponge v2**: fully supported by installed prismarine-schematic 1.3.0. All 9 files
  in this dir are v2 → **0 files need the shim**.
- **Sponge v3**: NOT yet readable — the ~30-line NBT remap shim in `/blueprint/load`
  is on engine-dev's queue (research report, follow-up #1). Note per future download
  which version it is (`Version` tag at NBT root, or root nested as `Schematic{}`).
- **.litematic**: convert locally with `tools/lite2schem.mjs`
  (`node tools/lite2schem.mjs in.litematic out.schem`) — a Node port of Abfielder's
  own client-side converter; emits Sponge v2. Opens the huge litematic-only catalogs
  (most Abfielder/MineSchematic uploads).
- **MineSchematic.com**: downloads are CAPTCHA-gated (API returns "CAPTCHA verification
  required") — not scriptable, browser-only. Abfielder is the automated source.
