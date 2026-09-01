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

Live versions: `skills.js` **v39** · `agenda.js` v12 · `producer.js` v3 · `telemetry.js` v1 (ledger
schema v2) · `digguard.js` v5 · `survival.js` v4 · `dangerscan.js` v3 · `graychat.js` v3
· `idleguard.js` v9 · `toolguard.js` v2 · `reachguard.js` v1. `panicguard.js` is RETIRED
(superseded by survival.js).
`GET /state` reports live payload versions, `stalePayloads[]`, `agenda` (current rung), and
`ash` readiness; `GET /metrics` reports the ledger's own health.

**The capstone has its first verified completion.** SoloSauhund, driverless, descended to the
`toY:20` target and the agenda graded it with `__skills.assertTask` BEFORE setting
`completedOnce` — `safeDescend.netDescent` checks real net Δy (~31 blocks), returned a
non-null verdict, and genuinely passed. The ladder then fell to IDLE. The telemetry
corroborated it independently: `outcome:"ok"`, `want:22 got:22 yield:1`, 22 levels in 22
steps. So `assertTask` has now been observed BOTH refusing a false completion and granting a
true one — the full cycle. The RESTOCK hysteresis fix is field-confirmed too: cancelled
safeDescends fell from 15 in the churn run to 1 in the fixed run, then it completed.

**This is acceptance criterion #4 only, and the descent was FIXTURED** (torches and
cobblestone were given via RCON). It proves the ladder and verification MECHANICS. It cannot
show from-nothing self-sufficiency, and must not be read as doing so.

**THE PHASE-1 DONE-SIGNAL REMAINS THE UN-FIXTURED SOAK** — all five criteria, on a stable
version, with nothing handed to the bot.

**Acquire-by-producing has landed** (#37), which was the named gate on that run. RESTOCK is
now withdraw → produce → stand down: the depot stays the cheap first answer, `produce`
(engine-dev-3's, run as a SKILL so a from-scratch torch chain cannot outrun the 180s act cap)
is the fallback, and a shortfall that is neither withdrawable nor produceable stands the rung
down with backoff instead of churning. Verified on LokalLothar across eight decision cases
plus a live driverless run. Acquiring a TOOL was fixed in the same session and the same
spirit: `ensureTool` now picks the tier it can PAY for out of the bag rather than the one
that is cheapest on paper, so a bot at y73 with no pickaxe and 58 cobblestone crafts a stone
pickaxe in place in 2.2s where it previously failed after 36.6s and reported "need more logs".

**The deep kit now carries the makings of a tool re-craft** (#43 item 1, promoted to phase-1 by
team-lead and CLOSED). `underground` and `deep` require sticks and a crafting table alongside
the filler cobblestone — those three are a stone pickaxe — and RESTOCK can withdraw them or
make them, so the new floor SELF-HEALS rather than being a departure-only demand no rung could
satisfy. Verified un-fixtured: a bot stripped of both acquired them itself, table first, then
sticks. Item 2 (reactive ascend-to-resupply) stays phase-1.5 and unbuilt.

**Two more blockers surfaced after that, both from letting the LADDER drive rather than
hand-calling skills.** TOOL reached the kit's `picks` requirement only through `activeClass`, so
a project naming no tool — on a role that maps to none — left `picks: 2` aimed at by nothing:
fire false, clear TRUE, kitCheck still saying "pickaxes 1/2", the project refused forever. Fixed
in agenda v12 by asking the gate's requirements before the activeClass guard, verified
agenda-driven on both the role-less and the miner shape. The kit number was deliberately NOT
lowered to paper over it — that would have left the requirement unaimed and merely satisfied by
accident. The second is a doctrine rather than a defect, and it is in FEEDBACK: testing the
CAPABILITY is not testing the CALLER, and the two isolation rules compose — stop the ladder to
measure a skill, drive the ladder to test what the ladder does, and say which you used.

**A stripped-bare run found three blockers a fixtured run structurally cannot.** Cleared to
nothing but food, the ladder provisioned the whole underground kit unaided — two pickaxes, a
table, sticks, 24 torches, 28 cobblestone — and then hit, in order: nothing aimed at the kit's
`weapon` requirement (a permanent refusal predating all of this, papered over by fixtures
carrying a sword); a project marked VERIFIED DONE on another rung's task (`project VERIFIED
done (mineLane, produce.made(cobblestone,...))` — owner identity is not task identity, and
assertTask graded honestly what it was wrongly handed); and `ensureTool` placing the deep
kit's crafting table and walking away, consuming the kit item the gate checks and leaving
abandoned tables around the world. All three fixed and verified. `bench/preflight.sh <port>`
runs the 35-case regression against a live bot in one command.

Known honest gaps, so nothing here reads as more finished than it is:
- **The un-fixtured soak has not been run.** Producing torches and self-healing a kit both
  work; that is not the same claim as five criteria met for three hours.
- **Food is the one floor with no produce path**: the underground tier requires `foodItems: 4`
  and `huntAnimals`' own kit gate requires `foodItems: 2`, so a foodless bot cannot hunt for
  food. Team-lead's call: that is a GATE bug (hunting should be gated on a weapon, not on
  already having food), queued to engine-dev-3, and NOT a soak blocker — the acceptance soak
  gives food, scoping itself to the tool and torch self-sufficiency axis.
- survival.js CREEPER retreat is confirmed live; BREAK_LOS's arrow-shadow WALL path has still
  never run, because corner-step keeps succeeding first.
- ashfinder / `/goto2` is merged and its security gap closed, but its MOVEMENT QUALITY is
  unproven — a 12-block hop timed out 7 blocks short. Merged is not "works".
- Assertion COVERAGE is the metric to watch next: an FSR of 0 is only meaningful in
  proportion to how much was actually graded. metrics.mjs now reports it (0/0 until bots
  restart onto ledger schema v2) and says so outright when coverage is thin.
- The soak's 10+ `wedge` outcomes were root-caused (restock hauling on a 5s search budget,
  fixed in v29, plus a planner-scalar leak in enterHaul fixed in v30) and are no longer open.

