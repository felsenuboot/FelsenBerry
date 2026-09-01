# Laws → Gates audit (engine-dev-2, 2026-09-01, engine v18)

Per the determinism codicil: **a per-action check must never live in an LLM driver's
habits.** Behavioural laws are time-boxed stopgaps; the standard is a deterministic engine
gate. This walks every per-action rule in DRIVER_GUIDE and says what enforces it.

"RETIRE" means the gate is live and verified, so the curator can strike the behavioural
rule from DRIVER_GUIDE (or reduce it to a one-line note explaining what now enforces it).
Rules that are *judgement* rather than per-action checks are listed separately — those are
not gate candidates and should stay written down.

## Gated — safe to retire the behavioural rule

| Law | Gate | Version | Verified |
|---|---|---|---|
| ≥8 torches on any excursion; kit for depth | `S.kitCheck` + preflight in `S.start` | v11 | `safeDescend {toY:-10}` refused with the full deep list, passed once satisfied |
| Never act beyond survival reach | `reachguard.js` | v1 | rejects out-of-range dig/place/attack; observed rejecting a 4.9m dig during my own testing |
| Right tool, always; acquire if missing | `toolguard.js` (equip-before-reject) + `S.ensureTool` | toolguard v2, skills v16 | holding dirt beside a log it equipped the axe; stone at 2.2m with no pickaxe rejected `tool_missing`; full acquisition chain crafted an axe from an empty inventory in 33s |
| Don't work in the dark / check skyLight, not just y | `dangerscan` light+column geometry, `survival` ENV branch, idleguard `surfaceOk` | dangerscan v2, survival v2, idleguard v9 | reproduced marcel's farm_1 false negative and fixed it by column scan |
| Harvest ≥25 blocks from the plaza | `protected.json.harvestExclusion` + `S.harvestAllowed` in chopTrees / idle mineNearest | **v18 (this audit)** | blocked at 24 blocks, allowed at 26, `mineLane` deliberately not gated |
| Never fell a structure's logs | `ctx.isProtected` at target selection + digguard levels 1–2 | skills v10, digguard v4 | all 7 logs within 24 blocks of base are structure; chopTrees returns `not_found` in 790ms instead of grinding |
| Re-inject payloads after a restart / verify they're live | auto-inject on every spawn + `/state.payloads` versions + `stalePayloads[]` | runner v8+ | payload roster reports real versions; staleness observed correctly during a live disconnect |
| Never leave drops behind | `ctx.collectDrops`, idle sweep | v4+ | routine |
| No idle | idle-guard work loop + task queue + `onEmpty` | idleguard v9 | routine |
| Poll `task.done`, never infer completion from movement | `!`-tier completion chat line + `TASK_DONE` log + idle-guard "previous task DONE" | v15, idleguard v9 | completion observed on the important tier while narration stayed log-tier |

## Gaps — still a behavioural rule, no gate yet

| Law | Why it's still ungated | Proposed gate |
|---|---|---|
| **Heartbeat `USING` lease lines during long smelts** | Drivers re-announce by hand, which puts tokens in the hot path — exactly what the codicil forbids | Engine emits `USING <id>` on a timer for the lifetime of any task holding a lease. Natural home: `S.start`'s lifecycle, with the lease id declared on the skill spec (same shape as `kit` and `tool`). Small; I'd take it with the telemetry work since both hook the task lifecycle. |
| **Deposit excess when passing the depot** | Judgement about what counts as excess, but the *trigger* is mechanical | `onEmpty`-style rule: inventory ≥N full → enqueue `depositToChest`. Cheap once the agenda's P1 self-maintenance rung exists — it is literally one of its ladder entries, so it should land there rather than be built twice. |
| **Two-bot rendezvous pattern** | Genuinely a coordination protocol, not a per-action check | Phase 2 (FLEET/1). Leave as doctrine. |

## Not gate candidates — keep as written doctrine

These are judgement, taste, or protocol, and encoding them would make bots worse:

- Aesthetics: tidy builds, no scars, human-looking structures.
- Chat manners, honesty in ledger lines, crew etiquette.
- Hands off foreign crews' property *as judgement* — the mechanical half (CAVECREW camp
  coordinates) is already a protected region, but "don't be a bad neighbour" is not codifiable.
- When to escalate to the user, and what counts as a milestone.
- The `@` / `!` chat-tier convention: a writing decision per message, not a check.

## Note on how these gates fail

Every gate above is written to **fail open** where a false negative would be worse than the
thing it guards: `harvestAllowed` returns true if the config is unreadable, `isProtected`
returns false when digguard is absent, `kitCheck` warns rather than blocks for a declared
tool the engine can acquire. That is deliberate — a gate that bricks the fleet when a JSON
file is malformed is a worse outcome than the rule it enforces. The one exception is
`toolguard`'s required-tool branch, which rejects, because digging stone bare-handed yields
nothing and letting it through is pure waste.
