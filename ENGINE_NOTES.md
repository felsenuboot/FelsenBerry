# Engine dev handoff notes (engine-dev teammate, wound down 2026-08-31 ~21:41)

Role changed: engine development moves from a single teammate to a multi-model workflow
(Opus/Sonnet/Fable agents grinding TODO.md in parallel). This file is the state dump for
whoever picks this up. Read TODO.md, LEARNING_HANDOFF.md, AUTONOMY_PLAN.md, DRIVER_GUIDE.md
and skills.js itself first — this file only covers what changed in this shift and what's
still open.

## What shipped this shift (engine v3 -> v5)

### v4: Torch discipline (TODO 2b) — DONE, live-verified
Added `ctx.autoTorch(state, every)` to skills.js's `makeCtx` (search for "autoTorch" —
sits right after `collectDrops` in the ctx object). Wired into `mineLane` (had zero torch
logic before) and `safeDescend` (refactored its old ad-hoc interval-only block to use the
shared primitive). Places a torch every ~7 units of progress, or immediately if the local
block's light reads below 8; logs a ONE-TIME `no_torches` warning (`pushLog('warn', ...)`)
per task when the bot carries none — visible in `status.log`, not spammed. Full writeup:
README.md "Torch discipline" section, TODO.md item 2b, LEARNING_HANDOFF.md quirk catalog.

Live-verified on test bot KloputzKarl (port 3106, now stopped): no_torches fired correctly
when empty (3 separate times across tasks), torches placed correctly once restocked
(safeDescend: 4/4 cleanly in a fresh dark shaft; mineLane: 9 "placements" from 8 crafted —
see the quirk below, not a bug).

**Known quirk (documented, not fixed)**: in `mineLane`'s vein-following, digging can
undermine a just-placed torch's support block later in the same task; the torch pops as a
drop, `collectDrops` sweeps it up, and it gets placed again elsewhere. This inflates the
`torches` result counter above net consumption. Harmless (no torches or light coverage
lost, no correctness issue for `no_torches`), just don't read the counter as an exact
economy log. Not worth fixing unless it starts actually costing torch supply at scale —
would need placeBlockAt-style "avoid placing against a block inside the current vein's
scan radius" logic, moderate complexity for low payoff.

**Separate quirk found while testing**: `bot.craft(recipe, N, table)` can yield more output
than `N * recipe.result.count` (saw 8 torches from a call requesting count=1 with
recipe.result.count=4). Verify actual inventory after crafting, don't trust the requested
count. Not investigated further — might be a mineflayer version quirk or a
recipesFor/recipesAll selection issue; worth a closer look if craft-heavy skills get built.

### v5: Blueprint building skills (TODO 1) — PARTIALLY verified, code-complete
Added a new shared primitive `ctx.placeBlockAt(pos, itemName)` (sits right after
`autoTorch` in makeCtx): idempotent (already-correct block = no-op), refuses to clear a
block in the new `PROTECTED` set (chests/furnaces/crafting tables/beds/anvils/brewing
stands/etc. — top of skills.js near `CONTAINERS`) rather than bulldozing someone's
infrastructure, otherwise digs a wrong block first via the existing `digBlock`, then tries
all 6 neighbour faces (floor first) to find a solid reference to place against.

Four new skills built on it, appended just before `G.__skills = S;` at the end of
skills.js:
- **`buildWall`** — straight vertical wall, bottom-up row by row. **LIVE-VERIFIED**: built
  a 3x2 cobblestone wall at (3,113,10)-(5,113,10..11) near the base, 6/6 placed, block
  contents confirmed via `bot.blockAt` after the fact. Left standing — it's harmless test
  debris about 6-8 blocks from the crafting table at (-3,111,4); fine to leave, reuse, or
  clear it, your call.
- **`buildFloor`** — flat rectangular platform, row by row. Same `placeBlockAt` primitive
  as buildWall (which works) but this specific skill was NOT individually live-run before
  wind-down. Syntax-checked only.
- **`frameStructure`** — perimeter wall shell: corner posts (cornerMaterial, e.g. oak_log)
  + infill (fillMaterial, e.g. oak_planks) on the ring only (no floor/roof — pair with
  buildFloor), with a 1-wide 2-tall door gap centered on the front (z=origin) wall. NOT
  live-run. Syntax-checked only. This is the piece that gets you "framed corners, planks
  infill" from TODO 1's aesthetics spec.
- **`buildStaircase`** — the built-structure counterpart to `safeDescend` (which digs raw
  stone): places real `*_stairs` blocks descending in a chosen direction, clears headroom
  first (reuses `digBlock`, skips PROTECTED blocks), falls back to placing one support
  block (cobblestone/cobbled_deepslate/dirt/stone, whichever's held) under a step if it'd
  otherwise float over open air (e.g. a staircase down into an open quarry pit — this is
  exactly what BASE.md's planned `quarry_ladder_1` needs), optional one-side rail
  (fence-type material), and reuses `ctx.autoTorch` for lighting. NOT live-run — this is
  the most complex of the four and the most likely to have an edge-case bug (stair block
  orientation is left to Minecraft's auto-facing-the-placer behavior, untested whether
  that actually produces walkable stairs in practice vs. weird half-blocks).

**Before relying on frameStructure/buildStaircase for a real build**: live-test them on a
throwaway bot first (spawn on an unused port, e.g. 3106 is free again since KloputzKarl is
stopped). buildFloor is probably fine (same primitive as the verified buildWall, much
simpler loop) but worth one quick run too.

## NOT started (explicitly deprioritized by the role-change interrupt)

### Task queue feature (priority-inserted by team-lead mid-shift, NOT implemented)
Team-lead flagged a live field problem: bots visibly freeze between skill tasks while
their LLM driver thinks — "bots standing around" between task calls, which defeats the
point of the engine. Requested design, not yet built:
- `__skills.enqueue(bot, [{name, args}, ...])` — a queue of pending tasks.
- Auto-advance: when the current task completes, the next one in queue starts instantly
  in-process (inside the same `(async () => {...})()` IIFE that runs `skill.fn`, or a new
  wrapper around `S.start`'s completion path — look at the `finally` block in `S.start`
  around where `task.running = false` is set), with NO driver round-trip needed.
- `__skills.status` should report the queue (pending task names/args) alongside the
  current task.
- Queue must be cleared on `S.stop()` (currently only cancels the running task — extend it
  to also drop any queued items, otherwise a stop() leaves zombie work waiting to fire).
- Optional `onEmpty` fallback (e.g. auto-`collectDrops` sweep) so the bot never stands
  fully idle even with an empty queue, ahead of idleguard.js's ~25s dormancy timer taking
  over.
- This is a structural fix for driver-latency idle gaps and was called out as high-value
  ("exactly why the engine is the product") — recommend picking this up early in the new
  workflow's run, likely before going deeper on blueprint/schematic work.

### Plugin ecosystem survey verdicts (received, not yet acted on)
Full results: `/home/felix/.claude/projects/-home-felix-minecraft/ec5d947d-89e3-4dac-8104-640ea6c675d6/subagents/workflows/wf_041a4b42-8d8/journal.jsonl`
(one JSON line per research agent/track). Headline verdicts relayed by team-lead:
- **ADOPT `prismarine-schematic` 1.3.0** — fresh 2026 release, parses `.schem` files into
  ordered placement lists. Could replace the hand-rolled buildWall/frameStructure above
  with a `__skills.buildSchematic` skill that takes a `.schem` file and places it via the
  same `placeBlockAt` primitive, in the schematic's own order — likely a much better path
  to "looks human-made" than parametric procedural walls, since it can consume actual
  human-designed structures. Worth evaluating before investing further in the parametric
  blueprint skills' polish (e.g. don't over-engineer buildStaircase's stair-orientation
  logic if a schematic-based approach supersedes it soon).
- **TRIAL `mineflayer-schem` 1.5.2** — survival building + chest restocking, but 1.21.11
  compat is UNVERIFIED. Sandbox-test on a throwaway bot before trusting it.
- **ADOPT `prismarine-viewer` 1.33.0 web mode** — already an installed dependency, just not
  activated. Would let base monitoring happen via PNG screenshots (headless chromium
  against the viewer's web port) instead of manual `/eval` block-sampling. Good candidate
  for a `/viewer` toggle route in runner.js.
- **SKIP `mineflayer-builder`/`mineflayer-scaffold`** — confirmed dead/abandoned, don't use.

### Everything else still in TODO.md, untouched this shift
Chat coordination module (TODO 3), ashfinder `/goto2` (TODO 2), the runner backlog (`/mine`
buried-target hang, `/goto` 60s timeout, strict task mutex — specs already written up in
AUTONOMY_PLAN.md steps 2-3, just not implemented). All still open, priority order as listed
in TODO.md's roadmap section at the top plus AUTONOMY_PLAN.md's implementation plan.

## Process notes for whoever picks this up

- Engine version is `ENGINE_VERSION = 5` in skills.js (top of file, `const ENGINE_VERSION`).
  Bump it on every skills.js change and re-document in DRIVER_GUIDE.md's header + README.md.
- All four production bots (FurzFriedrich/3101, MettMarcel/3102, BuddelBernd/3103,
  PflasterPeter/3105) were NOT re-injected with v5 as of wind-down — only v4 (torch
  discipline) went out to drivers via SendMessage; they should have picked that up at their
  next safe moment, but confirm before assuming. v5's new build skills have NOT been
  announced to drivers yet — do that once frameStructure/buildStaircase are live-verified,
  or sooner if you want a driver to help verify them (their bots already have gear/materials
  the empty test bot doesn't).
- Test bot KloputzKarl (port 3106) is STOPPED, its process pid file cleaned up by
  `./stop.sh`. Its Minecraft-server-side inventory/position persist under that name if you
  respawn it — it was last left near the base at position ~(2,113,11) after building the
  test wall, holding some leftover materials (coal, oak_planks/logs, cobblestone, dirt,
  leaf_litter, sticks — check via `/eval` `bot.inventory.items()` after respawn, don't
  assume empty). Port 3106 is free for the next implementer's own test bot (spawn fresh
  under a NEW stupid name per the naming rule, or reuse KloputzKarl — either is fine, it's
  a test bot not tied to any driver).
- Method this shift followed (recommend continuing it): build on a throwaway test bot on an
  unused port, never touch production ports 3101/3102/3103/3105, verify each capability
  live before calling it done, bump ENGINE_VERSION + update README.md/DRIVER_GUIDE.md/
  TODO.md/LEARNING_HANDOFF.md together, then SendMessage all drivers to re-inject.
