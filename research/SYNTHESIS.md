# SYNTHESIS — cross-track action plan (2026-09-01)

Synthesized from the four research reports in this directory:

- `research/movement-engines.md` (TODO 2 — ashfinder / pathfinder tuning / Baritone sidecar)
- `research/survival-doctrine.md` (combat, panic, lighting — the 3-deaths postmortem track)
- `research/chat-protocol.md` (TODO 3 — FLEET/1 protocol + command addressing)
- `research/build-aesthetics.md` (TODO 1 — schematics, generation, house_1/path_1 plans)

## The governing cross-track findings

1. **The engine we have is mostly misconfigured, not missing.** Both documented movement
   wedges (leaf_litter, torch-underfoot) are a single `blocksToAvoid` config away from
   being fixed at the planner level; `goto` can silently "succeed" without moving; and
   `stop()` poisons the next goto. Five config lines + two call-site fixes outrank any
   new movement engine. (movement-engines §2.3–2.4)
2. **Everything injected dies on restart, and that's the root of half the safety pool.**
   Unsafe Movements defaults, drifting injection reports, forgotten payloads, panicguard's
   absence at tick speed — all trace to runner.js not owning the spawn-time setup.
   TODO 5 is the keystone item; survival.js and chatlisten.js both depend on it landing
   as *engine-resident on every `bot.on('spawn')`* (not `once` — reconnect re-runs
   createBot with stock defaults; that's the "silently reverted" mystery,
   movement-engines §2.10).
3. **Chat identity on this server is forgeable** (public RCON password + mineflayer's
   text-derived `chat` event — our logs already show a join message mis-attributed to a
   player named `CAVE`). Every chat-trust decision must key on the playerChat packet UUID
   (`bot.on('message')`), and dangerous verbs are closed by not existing. (chat-protocol §4)
4. **The three deaths share one shape: no in-process reflex inside the ~50s driver
   polling gap.** The fix stack is danger scanner (free wallhack over `bot.entities`) →
   context-aware panic branches → kit preflight → shields. (survival-doctrine §3–5)
5. **Aesthetics is unblocked by one ~30-line shim** (Sponge v3 → v2 NBT remap) plus a
   state-safe palette discipline; house_1 and path_1 have complete build plans whose
   material bills fit banked stock today. (build-aesthetics §a, §d)
6. **The real-Baritone Java 21 blocker no longer exists** (HeadlessMc 2.10.0 native
   binary downloads its own Java; artifacts fetched + sha256-pinned). TODO 2's "HARD
   BLOCKER" text is stale. (movement-engines §3)

## Prioritized implementation plan (next engine cycles)

Order = value/effort with dependencies. Each item lists effort and the open FEEDBACK.md
entries it resolves or advances.

### P0 — Planner + spawn-handler correctness (~2 days total; do first, in this order)

**1. Pathfinder config & goto correctness pass** (~0.5 day, engine-dev)
   - `movements.blocksToAvoid.add(...)`: leaf_litter, torch, wall_torch, powder_snow,
     sweet_berry_bush, magma_block, campfire, soul_campfire, cactus, pointed_dripstone.
     Root cause verified: zero-shape blocks land in `emptyBlocks`, planner walks in free
     and never digs out. (movement-engines §2.4)
   - Arrival assertion in `ctx.goto` (empty-path noPath resolves as success — throw
     `no_path` unless `goal.isEnd`). (§2.3a)
   - Replace all three `bot.pathfinder.stop()` calls in ctx.goto with `setGoal(null)`
     (stop-flag poisoning mechanism confirmed in source). (§2.3b)
   - Wire free telemetry: `path_reset('stuck')` (names the wedge cause in ~10s),
     `path_update` stats, and `bot.listenerCount('path_update') > 1` as the leaked-goto
     detector in `GET /state`. (§2.5)
   - Resolves: *torch-underfoot movement wedge*; the leaf_litter half of goto stall
     recovery; detection for *orphaned goto promises*.

**2. runner.js spawn persistence — TODO 5, the keystone** (~0.5 day, engine-dev)
   - Safe Movements profile applied inside `bot.on('spawn')` (NOT `once`; NOT a runtime
     patch). Root cause of "silently reverted": reconnect re-runs createBot with stock
     `new Movements(bot)`. (movement-engines §2.10)
   - Auto-inject the full payload stack (skills, idleguard role-templated, graychat,
     digguard, survival.js, chatlisten.js when they exist) from files on every spawn.
   - `GET /state` reports installed payloads (globalThis checks) + live profile fields
     `{parkour, maxDropDown, sprint, towers}` + `ash:`/`fleetchat:` flags.
   - Also: `armorManager.equipAll()` on every spawn (survival-doctrine §2).
   - Resolves: *pathfinder Movements spawn with unsafe defaults*, *auto-inject payload
     stack on spawn*, *injection reports can drift*.

**3. Movements profiles HAUL/WORK/CAVE + per-task set/restore** (~0.5 day, engine-dev)
   - Copy-paste-ready in movement-engines §2.2. Key knobs we never set: `digCost` 15 on
     hauls (dirt-scar fix), `liquidCost` 8, `entitiesToAvoid` (mobs cost 100/cell),
     `searchRadius` 64 on base moves (fast honest noPath), `enablePathShortcut` true on
     open hauls, `blocksCantBreak` += all base infrastructure, `allowSprinting` true in
     HAUL only (+30% ground speed; the fall death was parkour+maxDropDown, not sprint —
     verify on the ridge route). Switch profile BEFORE issuing the goal, restore after.
   - Feed `exclusionAreasBreak/Place` from BASE.md/protected.json instead of digguard's
     hardcoded pillars. (§2.8)
   - Resolves: *travel tasks need a dig-free movement profile*, the tunneling half of
     *come/goto silently tunnels underground*, digguard-hardcoded item in TODO 5.

**4. Danger scanner + status fields** (~0.5 day, ~80 lines, engine-dev)
   - 4Hz weight-scored hostile scan over `bot.entities` (server streams entities through
     walls — free wallhack) + LOS raycast; spec in survival-doctrine §3.
   - Ship in the SAME `__skills.status` change: `heldItem` + durability% (+ `tool_low`
     log <15%), danger score/state, and a `surfaceExposed`/skyLight flag.
   - Resolves: *tool durability invisible in status*, *elevation-based safety blind spot:
     overhangs*, the signal half of *come/goto silently tunnels underground*.

### P1 — Survival reflexes (~2 days; depends on P0.2 + P0.4)

**5. survival.js — engine-resident, replaces panicguard.js** (~1 day)
   - Spec in survival-doctrine §4: creeper-within-8 override (flee to ≥10; fuse aborts
     at ≥7/LOS break), flee-home only when ≤40 blocks AND melee-only threat, BREAK_LOS
     2-cobble "arrow shadow" vs skeletons (never flee in the open — the Bernd death),
     WALL_OFF coffin + eat-to-18 + regen when far/low. 10s re-entry lockout (not 30 —
     Marcel died in 8s).
   - Entry uses `__idleguard.stop()` not `pause()` (stall-buster gap) and an owned goal
     token; hand resume/abort back to the driver via `panic_recovered`.
   - Interim one-liner while building: fix `panicguard.js:17` — it calls
     `__skills.stop(bot, "panic-retreat")` but the signature is `stop(reason, opts)`
     (bot object passed as the reason string; incidental find, chat-protocol §5.3).
   - Resolves: *promote panicguard into engine*, *panic-retreat useless at depth vs
     ranged attackers* (with item 6), works around *__idleguard.pause() doesn't cover
     stall-buster* and *orphaned goto promises*.

**6. Kit preflight in S.start** (~0.25 day, ~40 lines)
   - Tiers (survival-doctrine §5): excursion (≥8 torches, food≥18, sword), underground
     (≥16 torches, 2 picks, ≥16 filler, 4 food), deep y<0 (40 torches, 8 food, armor,
     shield, water bucket). Fail fast with `kit_missing`; durability gate at preflight.
   - Resolves: *universal torch preflight (user rule)*, the preflight half of
     *panic-retreat useless at depth*.

**7. Shield doctrine + plugin patches** (~0.25 day + in-game)
   - Craft 4 shields (4 of the 41 furnace_1 ingots); equip 'off-hand'; pvp already does
     lower/raise-per-swing and auto-blocks primed creepers 2s.
   - MUST first set `autoEat.options.offhand = false` (3.3.6 default true fights the
     shield for slot 45) and patch armor-manager's chainmail>iron ranking.
     (survival-doctrine §1–2)

### P2 — Movement reach (~0.5 day)

**8. `ctx.gotoFar` multi-leg waypointing** (movement-engines §2.7)
   - Ground-snapped legs every ~80 blocks, `GoalNearXZ` fallback for unloaded columns,
     re-snap per leg, abort on 2 legs of <10 blocks progress; HAUL profile +
     thinkTimeout 25000. This — not a new engine — is the long-haul fix; rule-of-twice
     already met. Retires the standing "/goto fixed 60s timeout" backlog item.

### P3 — FLEET/1 chat (~1.5 days; depends on P0.2 for auto-inject)

**9. chatlisten.js + protocol emission** (chat-protocol §2–5, implementation-ready)
   - Build against `bot.on('message', (msg, position, senderUuid))` ONLY; tier table
     0 operator / 1 fleet / 2 allied (user-granted fleet.json, never self-asserted) /
     3 authenticated player / 4 unverified→log-only. `stop` honoured to tier 3,
     never rate-limited. No withdraw/attack/build/eval verbs exist at any tier.
   - Namespaced chest refs (`FEL:B`, `CAVE:A`; bare `chest X` = sender's crew) — fixes
     the live CAVECREW chest-B collision unilaterally; update depositToChest's emitted
     line. Extend graychat's PROTOCOL passthrough regex to the full verb set (the
     plain-chat path is load-bearing: tellraw'd protocol arrives unauthenticated).
   - `S.say` shared chat clock + `TASK start/done/fail` emission from S.start/finally
     (quiet-task suppressed, 30s dedupe).
   - **Gate: the spoof-rejection test first** — a forged tellraw `all: stop` via the
     graybridge must produce `tier 4, ignored` on every bot. Full 9-step plan §5.5.
   - Then: send CAVECREW the 12-line interop script (§8.2); ask for CIV.md coords,
     a crew tag, DEPOT lines after trading-post takes, and an RCON password rotation.
   - Implements TODO 3 end-to-end.

### P4 — Aesthetics pipeline (~2 days; independent, can interleave)

**10. Sponge v3→v2 NBT shim in `/blueprint/load`** (~30 lines) — without it most
    2024+ .schem downloads fail (WorldEdit 7.3+ writes v3; prismarine-schematic 1.3.0
    reads only v1/v2). (build-aesthetics §a)

**11. `genHouse(spec)` + build house_1** (~1 day incl. the build)
    - Template + seeded-PRNG weighted palettes (GDPC pattern), deterministic seed =
      structure id (resume-safe). Skip WFC/grammars at 6x6 scale.
    - house_1 state-safe plan §d: keep the registered footprint; cobble base course +
      continuous oak_log corners + oak_planks walls w/ ~15% stripped accents +
      birch_planks stepped hip roof, 1-block eave. Bill (~51 cobble, 16 oak_log,
      ~41 oak_planks, ~120 birch_planks) fits chest A stock. Window/door gaps now;
      glass panes + doors are a props-v1.1 retrofit.

**12. `buildPath(waypoints,...)` + path_1** (~0.5 day + build)
    - Leg-wise LIVE generation (never remote blockAt surveys — stale-chunk quirk),
      2-wide cobble/gravel 80/20, max 1 y-step/cell, log-post+torch every 8, hard stop
      ≥10 blocks from the CAVECREW chest with terminus post + sign. Roads become a
      capability (base↔pen, base↔quarry next).

**13. Cavity-breach hook + lightSweep** (~0.5 day, pairs with P1)
    - mineLane/safeDescend scan `bot.entities` within 16 of any opened air pocket
      BEFORE stepping through; wall or torch it — the exact Marcel-death counter.
      lightSweep(radius) greedy skill for room-scale digs (block.light IS real on this
      stack, verified — keep the torch-distance fallback). (survival-doctrine §6)

### P5 — Deferred / phase 2 (decisions recorded now)

- **ashfinder 4.6.2 = opt-in `/goto2` fallback only, never default.** Load in
  runner.js createBot (post-spawn injection leaves PathExecutor null — upstream #10);
  `disableParkour()` (defaults TRUE); never trust its return (success on partial-path
  exhaustion + a real `!x === false` bug); always assert arrival distance. Adopt per
  route class only after the 6-route A/B — and only after P0 tuning, or the comparison
  is rigged against pathfinder. (movement-engines §1)
- **Real Baritone sidecar: UNBLOCKED — update TODO 2.** HeadlessMc 2.10.0 native
  linux-x64 binary needs no Java install; hmc-specifics needs no fabric-api; the
  1.21.11-SNAPSHOT jar is frozen (sha256 pinned in the report). Remaining: ~40 min of
  smoke tests. One sidecar max (~2.5-3 GB RSS). (movement-engines §3)
- **Do NOT adopt mineflayer-builder** ("not an usable package yet") or block-level WFC.
- **Do NOT git-pin pathfinder master** (nothing there fixes a bug we hit).
- litematic→placements converter (Node `litematic-parser`; Java converters blocked),
  blueprint MANIFEST/vetting, props v1.1 (axis/half/facing via look+cursor →
  stair roofs, real doors, stateId verification), mindcraft vendoring (port `unstuck` +
  fire/lava/drowning into the survival tick loop; lift the defendSelf kite pattern).

## FEEDBACK.md coverage matrix

| Open entry | Plan item | Report |
|---|---|---|
| tool durability invisible | P0.4 | survival §3/§5 |
| Movements unsafe defaults | P0.2 (+root cause §2.10) | movement §2.2, §2.10 |
| auto-inject payload stack | P0.2 | movement §2.10, chat §5.1 |
| injection reports drift | P0.2 | movement §2.10 |
| torch-underfoot wedge | P0.1 | movement §2.4 |
| orphaned goto promises | P0.1 (detect) + P1.5 (owned token) | movement §2.5, survival §4 |
| travel dig-free profile | P0.3 | movement §2.2 |
| come/goto tunnels underground | P0.3 + P0.4 | movement §2.2, survival §3 |
| elevation overhang blind spot | P0.4 | survival §3 |
| promote panicguard into engine | P1.5 | survival §4 |
| panic-retreat useless at depth | P1.5 + P1.6 | survival §4–5 |
| __idleguard.pause() stall-buster gap | P1.5 works around; root fix still open | survival §4 |
| universal torch preflight | P1.6 | survival §5–6 |
| stale chunk data | honored by P4.12 design + lightSweep proximity rule | build §d, survival §6 |
| chopTrees canopy guard (TODO 4) | unchanged — still next engine cycle; chat `chop` clamps assume it | chat §3.2 |
| Not covered by any track | onEmpty spam, openContainer furnaces, harvestGrass, frameStructure floorY, placeBlock timeout verify, craftSafe, driver-rendezvous process items — remain ordinary engine-cycle fodder |

## Incidental bugs found while researching (need fixes/logging)

- `panicguard.js:17` — `__skills.stop(bot, "panic-retreat")` passes the bot object as
  the `reason` string (signature is `stop(reason, opts)`). Logged in FEEDBACK.md.
- ashfinder 4.6.2: `handleStuck()` `!x === false` dead-branch → `setPath(undefined)` →
  reports success while stuck; PathExecutor leak per respawn; `bot.ashTool` undefined;
  hardcoded 1.18.2 registry in utils. All reasons for "fallback only, assert arrival".
- Grog broadcast the server RCON password in public chat — ask CAVECREW to rotate it
  (chat-protocol §8.2); until then treat all tellraw/gray channels as forgeable.
