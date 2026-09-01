# North Star (set by Felix, 2026-09-01; refined same day)

**Refinement (Felix, via /goal):** the bot should BEHAVE LIKE A GOOD HUMAN
PLAYER — tidy builds, honest chat manners, fair play, no scars, respected
claims — and cooperate with others both ALONE and in BIG COORDINATED EFFORTS
(multi-bot joint projects like the perimeter wall; cross-crew projects with
allied fleets). Coordination at scale is a first-class capability, not a
side effect.

**Phasing (Felix, 2026-09-01):** PHASE 1 — get ONE fully self-sufficient player
that can do everything a good human player needs, ALONE, engine-driven (may use
parallel development). PHASE 2 — only once phase 1 is solid, make players
interact/cooperate. Cooperation-heavy work (FLEET/1 chatlisten, CLAIM interop)
is deferred to phase 2; single-player completeness is the current fire.
Phase-1 acceptance = a DRIVERLESS bot (pure injected engine) surviving and
staying productive for hours on the autonomy-soak benchmark. Capstone missing
piece: an AUTONOMOUS AGENDA / needs-selector (deterministic priority ladder —
survival > self-maintenance > project advance > idle fallback; LLM sets only the
project, the ladder runs it). Proving ground: the local server + SoloSauhund.

**Determinism codicil (Felix, via /goal):** use deterministic algorithms
wherever possible. When something HAS to go through an LLM, do it — but then
ask whether and how it can become deterministic, and file that as the follow-up.
(Operationalized as: the rule-of-twice, the laws→gates conversion audit, and
the FEEDBACK doctrine "propose the engine gate, not the driver rule.")

**A fully autonomous Minecraft bot that can socially interact and cooperate —
with other bots from the same framework, with bots from other frameworks, and
with human players — and that can build bases, trading stations, farming,
mining shafts, claims (respected, never destroyed), food production, hunting,
mining, and more.**

The bot fleet on Felix's server is the continuous field test; the ENGINE is the
product. Every feature below should work autonomously — LLM drivers set goals
and handle surprises, deterministic engine code does everything routine.

## Pillars → current status (2026-09-01, engine v14)

| Pillar | Status | Carried by |
|---|---|---|
| Social: same-framework cooperation | WORKING (chat ledger, leases, BASE registry, peer messaging, depot economy) | protocols in DEPOT/BASE.md |
| Social: cross-framework cooperation | PROVEN IN FIELD (CAVECREW alliance: shared RCON, trading post, ledger interop) — needs FLEET/1 protocol shipped for bot-parseable safety (UUID identity!) | research/chat-protocol.md → chatlisten.js (P3) |
| Social: human players | PARTIAL (bots narrate + obey drivers; no direct player-command parsing yet) | same FLEET/1 chat-listener, tiered trust |
| Base building | WORKING (plaza, hall, house, torch posts, path — v7/v8 blueprint skills) | skills.js buildWall/buildSchematic etc. |
| Trading stations | WORKING (joint CAVECREW trading post, TRADE ledger, first stock placed) | TRADE spec in cavecrew-stack-analysis.md |
| Farming / food production | WORKING, surplus (26-tile wheat farm, bread pipeline, pond) | farm skills; tillFarmland pending |
| Claims / non-destruction | PARTIAL (digguard v2 guards protected.json at BOTH bot.dig and the pathfinder planner, hot-reloading within ~10s; every Movements profile inherits it from birth; ctx.isProtected keeps skills from even targeting structure) — needs formal CLAIM protocol interop | protected.json; FLEET/1 CLAIM lines |
| Mining / shafts | WORKING (safeDescend staircases, mineLane, torch discipline, 8/8 diamond run) — Baritone sidecar in progress | skills.js; baritone/ workflow |
| Hunting | WORKING where fauna exists (region depleted; pen_2 ready for husbandry) | huntAnimals; animal acquisition role |
| Survival / self-preservation | WORKING, two branches unproven (survival.js v1 replaces panicguard with 5 context-aware branches; dangerscan v2 = 4Hz through-walls threat scan + durability + geometry-backed sky exposure; kit preflight gates departure on torches/picks/filler/armor). CREEPER + BREAK_LOS have not met a live mob — QA staged with engine-dev | survival.js, dangerscan.js, skills.js kitCheck (P1 shipped) |
| Autonomy floor (no idle, no babysitting) | WORKING (task queue, idle-guard v6, usefulness gating, auto-inject of the whole stack on every spawn AND reconnect with zero manual step; /state reports real per-payload versions plus stalePayloads, so "is my bot current" is one poll) | SYNTHESIS P0.2 shipped |

Roadmap authority: research/SYNTHESIS.md (P0–P4) + FEEDBACK.md (field findings).
Everything ships engine-first: behavior rules are stopgaps, engine enforcement is
the standard.

## Engine status detail (kept current by engine-dev-2)

Live versions: `skills.js` **v16** · `dangerscan.js` v2 · `survival.js` v2 · `digguard.js` v4
· `toolguard.js` v2 · `idleguard.js` v8 · `graychat.js` v3 · `reachguard.js` v1.
`panicguard.js` is RETIRED (superseded by survival.js). `GET /state.payloads` reports these
numbers live, and `stalePayloads[]` names any payload bound to a bot object a reconnect
replaced — presence has never implied liveness, and that has now bitten us three separate
ways (reconnect swap, patch-stack teardown, stale light packets).

**Phase-1 self-sufficiency — what the engine can now do with no driver and no depot.**
Verified on the local server from a completely empty inventory on a fresh world:
`__skills.ensureTool(bot,'axe')` tried the depot, found none, gathered wood by hand,
crafted planks, crafted AND placed its own crafting table, crafted a wooden_axe and
equipped it — 33 seconds, fully deterministic. Paired with toolguard at the `bot.dig`
choke point (which equips before it rejects), "right tool always, acquire if missing" is
now an engine gate rather than a driver habit.

Known honest gaps, so nothing here reads as more finished than it is:
- survival.js CREEPER retreat is now confirmed working live (engine-dev measured a real
  10.9-block gain via GoalInvert); BREAK_LOS's arrow-shadow WALL path has still never run,
  because corner-step keeps succeeding first in ordinary terrain.
- safeDescend's `no_descent` tripwire is arithmetic-verified but not force-tested.
- Shield doctrine: both engine prerequisites shipped, but no bot carries a shield yet —
  needs iron and a craft.
- ensureTool's DEPOT withdrawal branch has only been exercised as a miss (no depot exists
  on the local world). The craft branch is fully verified; the withdrawal path needs one
  run against the real base.
- The autonomous agenda / needs-selector — the phase-1 capstone — is not started.
