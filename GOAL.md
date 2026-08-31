# North Star (set by Felix, 2026-09-01)

**A fully autonomous Minecraft bot that can socially interact and cooperate —
with other bots from the same framework, with bots from other frameworks, and
with human players — and that can build bases, trading stations, farming,
mining shafts, claims (respected, never destroyed), food production, hunting,
mining, and more.**

The bot fleet on Felix's server is the continuous field test; the ENGINE is the
product. Every feature below should work autonomously — LLM drivers set goals
and handle surprises, deterministic engine code does everything routine.

## Pillars → current status (2026-09-01)

| Pillar | Status | Carried by |
|---|---|---|
| Social: same-framework cooperation | WORKING (chat ledger, leases, BASE registry, peer messaging, depot economy) | protocols in DEPOT/BASE.md |
| Social: cross-framework cooperation | PROVEN IN FIELD (CAVECREW alliance: shared RCON, trading post, ledger interop) — needs FLEET/1 protocol shipped for bot-parseable safety (UUID identity!) | research/chat-protocol.md → chatlisten.js (P3) |
| Social: human players | PARTIAL (bots narrate + obey drivers; no direct player-command parsing yet) | same FLEET/1 chat-listener, tiered trust |
| Base building | WORKING (plaza, hall, house, torch posts, path — v7/v8 blueprint skills) | skills.js buildWall/buildSchematic etc. |
| Trading stations | WORKING (joint CAVECREW trading post, TRADE ledger, first stock placed) | TRADE spec in cavecrew-stack-analysis.md |
| Farming / food production | WORKING, surplus (26-tile wheat farm, bread pipeline, pond) | farm skills; tillFarmland pending |
| Claims / non-destruction | PARTIAL (digguard v2 registry protection + hands-off law) — needs formal CLAIM protocol interop | protected.json; FLEET/1 CLAIM lines |
| Mining / shafts | WORKING (safeDescend staircases, mineLane, torch discipline, 8/8 diamond run) — Baritone sidecar in progress | skills.js; baritone/ workflow |
| Hunting | WORKING where fauna exists (region depleted; pen_2 ready for husbandry) | huntAnimals; animal acquisition role |
| Survival / self-preservation | PARTIAL (panic guard, light rule, deep-work kit doctrine) — survival.js + danger scanner queued | research/survival-doctrine.md (P1) |
| Autonomy floor (no idle, no babysitting) | WORKING (task queue, idle-guard v4, usefulness gating, engine v8: auto-inject on every spawn — skills/digguard/graychat/panicguard/reachguard install with zero manual step, verified live) | SYNTHESIS P0.2 shipped |

Roadmap authority: research/SYNTHESIS.md (P0–P4) + FEEDBACK.md (field findings).
Everything ships engine-first: behavior rules are stopgaps, engine enforcement is
the standard.
