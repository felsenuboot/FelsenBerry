# Changelog

Milestones, curated. Everything else: `git log`. Engine payload versions live in the files themselves.

## Unreleased — 2026-09-03 (toward soak #4, the first human-bar attempt)
- **#107 gear-progression drive** (agenda TOOL rung): a bot now crafts the better tool tier the moment materials
  are in hand (wooden→stone pickaxe, live-verified); root cause was `bestOwned()` short-circuiting before the tier
  machinery was ever asked. Also fixed: the pre-craft depot check walking the bot away from its own materials.
- **#102 chopTrees fell-complete** (skills v61): whole trunk column, no elevated drops; real root cause was the
  pathfinder's ~2.4-block reach height cap (new `digThorough`, honest ~5-block ceiling). Fixture rebuilt on real
  bonemeal-grown trees.
- **#105 night-shelter primitives** (survival v11): dig-in-and-cap / 1×1 hut, dawn/threat/hunger/project exits —
  all four live-fired; API `__survival.shelter.*` for the SHELTER agenda rung (pending).
- **#106** raw block light is permanently 0 underground even beside a torch (never truth); composite spec in flight.
  LIGHT-rung torch-spam hypothesis disconfirmed by 435 ledger firings.
- Ops: repo renamed felcrew-mcp → FelsenBerry and moved to the ghq layout; auto-push hook; pathspec-only commits;
  keep-awake inhibitor after a 9-hour hypridle suspend (23:54→09:06).

## v0.2.0 — 2026-09-02 (the rename)
- Repo renamed felcrew-mcp → FelsenBerry; v0.1.0 spin-out archived and folded into `research/`.
- **Gear-race benchmark** (empty character → tool tiers, ledger-scored) with 5 runs recorded; no run has
  crafted a stone pickaxe yet (0-of-4 comparable) — every death is a filed, fixed issue. Race book v2.
- **Direction Episodes** (research/IDLE_TRIGGER_SPEC.md) built end to end: agenda episodes + `decider.js`
  daemon (rules first, local Andy-4 via Ollama on miss, `SOAK_BOT`/`DECIDER_EXCLUDE` hygiene).
  Soaks #1–#3 graded FAIL with every cause root-caused and fixed (canopy/LIGHT preemption, episode rot
  #95, table-placement #101). Soak #4 = first formal human-bar attempt.
- **Survival chain closed**: #92 cannot-heal exit, #94 corner-step under critical HP, #96 zero-defense
  floor (FIGHT_BACK / FLEE_AWAY), #98 flee-home reachability, #99 no-filler standdown, #100 predicate-keyed
  standdown. R2 recovery rung landed, fault-injection-proven, and later EXONERATED for soak #3.
- **Skills**: ascendToSurface + ESCAPE rung (#89), producer search anchor (#91) and the anchor sweep,
  terrain-seek table placement (#101), REFLEX release on unreachable threats (#97).
- **Instruments**: `bench/humanbar.mjs` (combined verdict), `gearrace.mjs`, `playcheck.mjs` fairness +
  `--until`, metrics DIRECTION/decider/recovery sections, fixture-suite integrity audit (#93).
- **Doctrines**: composition rot; every iterative search needs an anchor; instrument is scorekeeper;
  zero defense must be unrepresentable; assumed ≠ verified; pathspec-only commits; auto-push hook.
- **Goal formalized**: THE HUMAN BAR in `GOAL.md`; plan re-evaluation → gear-progression drive +
  night-shelter as the next structural moves.

## v0.1.0 — 2026-09-01 (spin-out, archived)
- Execution-runtime design trilogy, look-ahead planner slice (mock-proven, never live). See
  `research/felsenberry-v1-spinout/`.

## Before — 2026-08-31 → 09-01
- MCP-driven bots → self-owned mineflayer fleet with HTTP control, skill engine, idle-guard, depot/base
  protocols, agenda ladder capstone (assertTask-verified completion), acquire-by-producing (#37), cavecrew
  alliance, telemetry ledger (schema v2), playcheck.
