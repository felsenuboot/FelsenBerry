# Driver Fitness Scoreboard (survival of the fittest — user law, 2026-09-01)

Applies to MINECRAFT DRIVER teammates only (bernd/marcel/friedrich/peter/karl/
kevin-driver). Engineers are EXEMPT. The supervisor evaluates every ~hour and
posts standings here. Selection pressure: **two consecutive bottom rankings (or
one clear degradation event) = the driver is retired and a fresh driver is
spawned for the same bot**, onboarding cold from the docs with a note on what
its predecessor did poorly. Survivors keep their accumulated context — fresh
challengers keep incumbents honest.

## Fitness criteria (weighted by judgment, not formula)
1. **Output**: resources banked, structures built, milestones advanced.
2. **Law adherence**: torch kit, distance law, LIGHT rule, ledger/lease
   discipline, rollout compliance, no-idle.
3. **Incident record**: deaths, damage caused, wedges left unreported.
4. **Learning contribution**: FEEDBACK entries filed, root causes found.
5. **Coordination**: peer messaging quality, handoffs, no wait-loops.

## Standings — evaluation #1 (2026-09-01 ~01:10)

| Rank | Driver | Notes |
|---|---|---|
| 1 | peter-driver | Colossal output (plaza, posts ×3 rebuilds, house_1, main_hall_1, path_1, TNT removal, repairs); strong findings (canDig, false-timeout). |
| 2 | bernd-driver | M4 avenged 8/8 zero-damage; exemplary incident handling (restitution, write-off calls); quirk goldmine. One death, doctrine-founding. |
| 3 | karl-driver | Outstanding first shift: farm_1 expansion, pen_2, damage repairs, 5 findings; perfect hazard discipline at pen_1. |
| 4 | marcel-driver | Farm empire from zero (37+ bread, 260+ seeds); honest mistake reporting; skyLight doctrine. Two early deaths (partly engine-caused); one idle gap owned. |
| 5 | kevin-driver | Too new for full ranking — excellent start (log-mining diplomacy recap, restart handling, GearSmith watch). |
| 6 | friedrich-driver | **ON NOTICE.** Real strengths (torch factory, retrieval, panicguard + canopy root-causes) but: chronic wait-loops all night, digguard-v1 drift caused repeat base damage, two pillar-chopping incidents. Recent queue-driven work is much improved — next evaluation decides. |

(History of retirements: none yet.)

## Live fitness display (2026-09-01)

Joined CAVECREW's shared "Tribe Fitness" scoreboard sidebar (their existing display,
internal objective id `tribes` — the human-readable "Tribe Fitness" shown by
`scoreboard objectives list` is only a display name; RCON `get`/`set` need the real id.
Found the real id via Carpet's scarpet `script run print(scoreboard())` when the quoted
display-name form kept failing command parsing) rather than standing up a competing
sidebar — posted a one-line heads-up on felsenuboot/felcrew-mcp#1. Display-only, fully
reversible (`scoreboard players reset <name> tribes`), same no-cheat fair-play line as
everything else.

**Formula (v1, manual update per fitness eval or on a death/milestone event — a daemon
can automate this later):**
```
score = (100 - 10 * rank) - 25 * deaths + 5 * shipped_findings
```
- `rank` = this driver's current position in the Standings table above (1-indexed).
- `deaths` = confirmed in-game deaths this session (from driver reports / the fitness
  notes column above).
- `shipped_findings` = count of FEEDBACK.md entries reported by this driver (as sole or
  joint reporter) currently marked `status: shipped(...)` — count via
  `awk '/^### / {t=$0; getline; getline; if ($0 ~ /^status: shipped/) print t}' FEEDBACK.md`
  and tally by reporter name.

**Scores set 2026-09-01 (eval #1 standings, deaths as noted in that table, shipped
counts as of this date):**

| Bot | Driver | rank | deaths | shipped | score |
|---|---|---|---|---|---|
| PflasterPeter | peter-driver | 1 | 0 | 2 | 100 |
| BuddelBernd | bernd-driver | 2 | 1 | 3 | 70 |
| KloputzKarl | karl-driver | 3 | 0 | 0 | 70 |
| MettMarcel | marcel-driver | 4 | 2 | 4 | 30 |
| KackboonKevin | kevin-driver | 5 | 0 | 0 | 50 |
| FurzFriedrich | friedrich-driver | 6 | 0 | 4 | 60 |

Update via RCON at each fitness eval and on death/milestone events:
`scoreboard players set <BotName> tribes <newScore>` — then re-append a dated row (or a
new table) here rather than silently overwriting this record, so the score history stays
auditable.

## Engine Gear-Race (2026-09-02, test-driver)

Format: driverless engine, steered ONLY via `__agenda.setProject({skill,args})` (no hand-driving,
no /eval action code, no depot/RCON help). Score = wall-clock from server-log join line to FIRST
possession of each pickaxe tier (wooden/stone/iron/diamond); steering-call count is a secondary
autonomy metric. Run cap 90 min. Advancement lines used as ground truth where available: `Stone
Age` = wooden pickaxe used to mine stone, `Getting an Upgrade` = stone pickaxe constructed,
`Acquire Hardware` = iron ingot smelted (precursor, not the pickaxe itself), `Isn't It Iron Pick?`
= diamond pickaxe (vanilla has no distinct iron-pickaxe advancement — inferred from status.log /
chat `Tool ready: iron_pickaxe` lines instead). **Open dispute, not silently resolved**:
engine-dev's `bench/gearrace.mjs` writeup flags that real vanilla's `minecraft:story/iron_tools`
(exactly this advancement) is normally about the IRON pickaxe specifically, contradicting the
line above — the harness deliberately does NOT use any advancement title to time a tier (only
`Tool ready: <item>` chat lines and ledger inventory counts), so this dispute doesn't corrupt any
recorded time, but Felix/team-lead should settle which mapping is actually correct.

**DEAD RACE = DEAD STOP (Felix's law, added 2026-09-02, supersedes any earlier "ride it to the
90-min cap" instruction):** if ALL runners in a race show ZERO productive progress — position
flat AND inventory flat AND no task producing yield — for 5 CONSECUTIVE MINUTES, with a diagnosed
cause and no legal recovery path within the race rules, the driver CONCLUDES the run immediately,
themselves, DNF-with-cause — no lead approval needed, no riding it out. "Struggling" (retries that
still produce movement or yield, even slowly) is data and continues; "dead" (provably nothing
happening) is concluded on the spot. The 60-second detection SLO exists to feed this rule: 5 dead
minutes should never be reached without the driver already knowing why. (Case in point: run #1's
15-20 minute food-gate stall before anyone noticed is exactly the failure mode this law closes.)

### Run #0 — NacktNorbert, 127.0.0.1:25599 (shared/reused local test world) — SHAKEDOWN, NOT COMPARABLE — STOPPED 13:48:50 (no-loiter law, findings extracted)

**Track contaminated — do not compare times against run #1 or future baselines.** This world has
been in continuous use by test bots since 2026-09-01; the spawn area is measurably deforested.
Recorded anyway because the stone->iron->diamond chain behavior is free intelligence regardless
of absolute times, and it surfaced a real bug independent of the contamination (see FEEDBACK.md).

Engine versions at run start: skills **v48** (verified from my own `/state` poll immediately
after spawn, before any project was set — NOT v47), agenda v19, toolguard v2, dangerscan v4,
survival v5, digguard v5, producer v6, digchain v1, graychat v4, reachguard v1 (idleguard off,
subsumed by agenda). Bot confirmed empty/never-used (fresh uuid, absent from usercache.json)
before spawn.

**VERSION STAMP CHANGES MID-RUN (honest disclosure, shakedown run so no harm):** the process was
stopped and restarted at 13:01:27 for an unrelated port reassignment (see call-count note below).
skills.js on disk had moved from v48 to **v50** by then (engine-dev shipping live, unrelated to
this run), and the restart re-injected the then-current tree — so everything below 13:01:27 ran
under v48, everything after ran under v50. This matters for the stone-pickaxe row.

| Tier | Time from join | Notes |
|---|---|---|
| Join | T+0 (12:50:24) | fresh spawn, empty inventory confirmed |
| Wooden pickaxe | T+6m19s (12:56:43) | v48. `ensureTool` failed TWICE on wood search (`gather:wood(0/2 reached)`, 12:53:34 and 12:55:05) while the bot visibly wandered 20-35 blocks each attempt — genuinely searching, not stalled. 3rd attempt succeeded; `Stone Age` advancement confirmed genuine use 3s later (12:56:46). |
| Stone pickaxe | not reached in observed window | v48: after tier 1, the kit's SPARE-pickaxe requirement (underground tier wants 2 picks) failed 4x straight with a non-converging plank count (7,7,3,5) and a chat-truncated blocker reason — real bug, see FEEDBACK.md. **Resolved after the 13:01:27 restart+v50 re-injection — cause NOT isolated: confounded by both fresh runtime state AND three engine versions of eng-3's fixes landing in exactly this code region.** The post-restart success under v50 mainly tells us v50 doesn't OBVIOUSLY reproduce it; the pre-restart v48 evidence above is what eng-3's diagnosis should use. Run continues past this point (project re-armed, no progress lost — see call count). |
| Iron pickaxe | not reached | — |
| Diamond pickaxe | not reached | — |

Steering calls: 2 total — (1) initial `setProject(mineLane,{target:stone,count:16})` at 12:52:03;
(2) re-arm of the identical project at 13:01:05 after a process restart done for port
deconfliction with another driver's bot (KlemmKuno claimed port 3130 unannounced) — an
infrastructure fix, not a driver decision, footnoted separately from the autonomy count.

**UPDATE 13:34-13:36 — killed by Felsenuboot (RCON), respawned, recovering.** Both this bot and
run #1 went silently idle for ~15-20 min on the food-item kit gate (`food 0/4`, full hunger but
zero food items carried, huntAnimals' own kit gate needs food too — see FEEDBACK.md, this is
GOAL.md's documented gap confirmed live). Felix manually killed NacktNorbert, KlemmKuno and
EngineDreckDave via RCON at 13:34:37 after noticing the stall visually. Death cleared the project
(engine v53/graychat v5 picked up on respawn — versions keep moving live). Re-armed with
`harvestGrass{radius:24, repeat:true}` (steering call 3) at 13:36:06 — **this time WITH repeat,
after discovering harvestGrass isn't in agenda's `resumable()` registry and silently completes
after one pass without it (see FEEDBACK.md)**. Respawned near the surface, so grass was in reach:
real yield confirmed (`Cut 4 grass`, chat-verified). Steering calls: 3. Deaths: 1.

Still SHAKEDOWN/non-comparable — this update is field intelligence on the food/kit/idle-detection
gaps, not a time record.

**CONCLUDED 13:48:50 — `./stop.sh NacktNorbert` (no-loiter law, team-lead ruling 2026-09-02).**
Shakedown complete; findings extracted (wood-search transient-then-recovered, plank-churn evidence
at v48, the food/kit deadlock corroboration, the harvestGrass repeat:true footgun). Right up to the
stop it was productively harvesting (`Cut 32 grass` at 13:48:06, `Cut 26 grass` at 13:45:54) — this
bot never hit a genuine dead end, it was stopped on purpose because its purpose was served, not
because it failed. Final tally: reached wooden pickaxe only (v48, contaminated track — not
comparable to run #1's clean 1m00s); stone/iron/diamond never reached. Steering calls: 3. Deaths: 2
(13:34:37 and 13:41:xx-13:41:55, the latter part of a multi-entity RCON kill spree by Felix,
unrelated to any engine failure).

### Run #1 — OhneHoseOtto, 127.0.0.1:25600 (dedicated virgin-world race track, same seed) — OFFICIAL BASELINE — CONCLUDED: DNF-at-stone

This is the track future engine versions race against.

Engine versions at run start: skills v50, agenda v19 (bumped from the run-#0 tree mid-session —
engine-dev shipping live). Bot confirmed empty/never-used before spawn.

| Tier | Time from join | Notes |
|---|---|---|
| Join | T+0 (12:59:19) | fresh spawn, empty inventory confirmed, virgin world/same seed as the contaminated track |
| Wooden pickaxe | T+1m00s (13:00:19) | clean, uneventful — no failed `ensureTool` attempts logged, unlike run #0. Strong confirmatory contrast for the deforestation theory. |
| Stone pickaxe | **DNF — never reached** | verified by full-log search (`grep -in "stone_pickaxe\|Getting an Upgrade"` on both `logs/OhneHoseOtto.log` and `localserver-race/server.log`, zero matches). **Correcting an earlier assumption in this record's own discussion thread that stone was reached** — it was not; only `wooden_pickaxe` (13:00:19) and `wooden_sword` (13:03:14) were ever crafted. The official DNF tier is STONE, not iron. |
| Iron pickaxe | not reached (moot — DNF is earlier, at stone) | — |
| Diamond pickaxe | not reached (moot) | — |

**OFFICIAL CAUSE (team-lead ruling 2026-09-02, refined after the empirical hunt-gate test):**
(a) the foodItems kit shortfall was **UN-ACTIONABLE BY THE LADDER** — `huntAnimals`'s kit gate is
clean (verified live, `#45` confirmed: it demanded no food, only failed on no mob in range), but
NO agenda rung ever routes a food shortfall to hunting on its own — the legal escape existed in
the engine the whole time and nothing (engine or driver) took it until a human-directed manual
test 40+ minutes in. (b) **TERMINAL**: while chasing the stone target the bot mined to y89 and
became sealed in a pocket with no path to any food source (grass or fauna) or back to the
surface — two independent `come` attempts both failed (`No path to the goal!`, then `goto
resolved 14.02 from the goal (tolerance 4.5)` in ~1.3s with position unchanged to the decimal),
and no skill in the registry ascends or digs a bot out. The gate is exonerated; the routing gap
and the entombment are indicted.

**Run #1 is now HANDED OFF as a live specimen** (team-lead + engine-dev-3, 2026-09-02): OhneHoseOtto
stays entombed, untouched, process left running — port 3140, race server 127.0.0.1:25600, position
(2.51, 89, 12.43). Ownership transferred to engine-dev-3 to develop/test the missing
`ascendToSurface`/`digOut` skill against a naturally-occurring stuck bot. Race rules (setProject-only,
no /eval action code) LIFT on this bot as of the handoff — full FEEDBACK.md writeup below.

Steering calls: 2 so far — (1) initial `setProject` at 12:59:29; (2) re-arm at 13:02:05 after a
process restart to move the bot from port 3110 to 3130->3140 (port collision, same infra-fix
class as run #0's restart, not a driver decision — footnoted separately). Deaths: 0.

**UPDATE 13:31-13:41 — HARD DEAD END, likely permanent DNF.** Hit the same food-item kit gate as
run #0 (see above / FEEDBACK.md) while mining toward stone, having descended to y89 (14 blocks
below its own y103 surface spawn) chasing the target. Re-armed with `harvestGrass{repeat:true}`
(call 3, 13:36:06) per the run-#0 fix — correctly found ZERO grass at y89 and kept retrying
without falsely completing (the fix working as intended, just nothing to find at this depth).
Tried routing to the surface with `come` twice — its exact spawn coords (call 4, 13:37:05) and
straight up from its own x/z (call 5, 13:37:53) — BOTH failed: first `No path to the goal!`,
second `goto resolved 14.02 from the goal (tolerance 4.5)` resolving in ~1.3s with position
UNCHANGED to the decimal on every retry since. That reads as zero viable steps in any direction,
not a partial/interrupted climb. **No skill in the registry (`./task.sh list`) ascends or digs a
bot out of a sealed pocket** — every avenue available through `setProject` alone is now
exhausted. This bot is very likely stuck until someone with `/eval` or RCON access frees it
manually; see FEEDBACK.md for the full writeup and a proposed `ascendToSurface`/`digOut` skill.
Steering calls: 5. Deaths: 0 (never died — it's trapped, not destroyed).

**CORRECTION 13:42-13:43, team-lead-directed empirical test — reclassify the cause.** Set
`huntAnimals` (call 6, 13:42:38) specifically to test whether it demands food (per team-lead: test,
don't trust the doc). It started immediately with NO `kit_missing` at all — `Hunting 2x
cow/chicken/pig/sheep. Nothing personal.` — and failed only on `no cow/chicken/pig/sheep within 32
blocks`. **#45 (huntAnimals gated on weapon, not food) is verified live on v50 — the food/hunt
catch-22 is CLOSED as a gate problem.** Correct classification for this run's DNF is therefore
**"sealed underground, no path to ANY food source (grass or fauna) — a reachability dead end, not
a kit-gate deadlock."** The food gate itself is clean; Otto just can't physically reach anything
that would satisfy it. Steering calls: 6.

### Race book v1 (pre-planned, team-lead doctrine 2026-09-02) — for run #2 onward

Written BEFORE run #2 launches so the next `setProject` is always already decided; steering calls
still counted, but zero decision latency. Update this block, don't replace it, as tiers pass.

| Trigger | Project to set | Notes |
|---|---|---|
| Spawn | `mineLane{target:'stone',count:16}` | forces TOOL rung to bootstrap the wooden pickaxe from nothing; verified fast (60s-6m19s) across both runs #0/#1 |
| Wooden pickaxe confirmed (`Tool ready: wooden_pickaxe` or `Stone Age`) | no change — same project, let it keep mining stone/cobblestone | stone pickaxe follows automatically once kit spare-pick + cobblestone stack up; do not re-issue, that would reset `progress` |
| Stone pickaxe confirmed (`Tool ready: stone_pickaxe` or `Getting an Upgrade`) | `mineLane{target:'iron_ore',maxDist:48}` — if `not_found` within budget, `safeDescend{toY:30}` first, then retry the iron mineLane | iron ore needs a stone-tier pickaxe minimum; the TOOL rung upgrades to it automatically when this project's `activeClass` demands it |
| Iron pickaxe confirmed (`Tool ready: iron_pickaxe`) | `safeDescend{toY:-30}` (lands inside the -58..-16 diamond band) then `mineLane{target:'diamond_ore',maxDist:48}` | this crosses into `deep` kit tier (40 torches/8 food/chestplate/shield/water bucket) — expect a `kit_missing` pause while RESTOCK self-provisions; give it time before treating as blocked |
| Diamond pickaxe confirmed OR 90-min cap | STOP, record final table | `Tool ready: diamond_pickaxe` is the only reliable signal — do NOT use the `Isn't It Iron Pick?` advancement to call this (unresolved mapping dispute, see FEEDBACK.md; gearrace.mjs already excludes it from timing for this reason) |

Known-failure branch plans (act within the 60s detection SLO, don't wait for a poll to "confirm"):
- **Food/kit refusal** (`Not setting off half-kitted... food 0/4`): the GATE is clean — `#45` verified live on v50, `huntAnimals` demands no food, only fails if no mob in range. But as of run #1, NOTHING automatically routes a food shortfall to hunting — that's still a manual driver branch until eng-3's routing fix lands (green-light criterion below). The moment you see `food 0/N`, immediately `setProject(huntAnimals{anyMob:true,radius:32,repeat:true})`; fall back to `harvestGrass{repeat:true}` only if genuinely no fauna in the area. ALWAYS pass `repeat:true` on either — a single pass completes-forever with no retry (see FEEDBACK.md, this cost ~15-20 min last run because I didn't).
- **Barren search** (2 identical `gather:X(0/N reached)` or `not_found` lines in a row): that's the alarm per the new SLO — don't wait for a 3rd. Reposition first (`come` to an unexplored coordinate 30-50 blocks off) before re-trying the same mineLane/chopTrees target.
- **Sealed pocket / no path** (`come` fails with `No path to the goal!` or resolves without moving): there is NO recovery skill in the registry today (flagged in FEEDBACK.md, proposed `ascendToSurface`/`digOut`, now under development against a live specimen — see run #1's handoff). Two attempts max, then invoke **DEAD RACE = DEAD STOP** below — don't burn the run fighting an unwinnable pathing state.
- **Tool breaking** (`tool_low` warning in status/log): no action needed, TOOL rung reacquires automatically; just don't be surprised by a brief PROJECT pause.
- **IDLE rung while a project exists and tiers remain**: per team-lead's doctrine, this is ALWAYS an alarm, never "still working" — check `agenda.blocked` and the bot's log tail immediately, don't wait out a poll cycle.
- **DEAD RACE = DEAD STOP** (Felix's law, see above): position flat + inventory flat + no yield for 5 straight minutes with a diagnosed cause and no legal recovery = conclude the run yourself, immediately, DNF-with-cause. No lead approval needed. This is the backstop for the sealed-pocket branch and any other dead end the plan above didn't anticipate.

**Green-light criteria for run #2 (updated per team-lead 2026-09-02):** the gate itself (`#45`)
is already fine and does NOT need to be part of the gate. What run #2 actually needs landed first:
(1) a **food-ROUTING fix** — some agenda rung (RESTOCK, or a new one) that automatically sets
`huntAnimals`/`harvestGrass` when a project is refused on a food shortfall, instead of requiring a
driver to notice and branch manually; (2) the **`digOut`/`ascendToSurface` skill** landing and
being verified against the OhneHoseOtto specimen. Both, not either — run #2 measures the delta
against run #1's diagnosed failure modes, so both root causes should be closed before it launches.

### Run (auto) — 2026-09-02 11:49 — OhneHoseOtto, /home/felix/minecraft/localserver-race

Generated by `bench/gearrace.mjs`. Engine versions: skills v50, agenda v19. Run may still be in progress at generation time.

| Tier | Time from join | Source |
|---|---|---|
| Wooden pickaxe | 1m00s | log:Tool ready |
| Stone pickaxe | DNF | DNF -- see notes below |
| Iron pickaxe | DNF | DNF |
| Diamond pickaxe | DNF | DNF |

Steering calls: 7 (7 setProject, 0 other /eval). Deaths: 0.

DNF context (stone_pickaxe): `[+2665s] [Not Secure] <OhneHoseOtto> failed: huntAnimals — no cow/chicken/pig/sheep within 32 blocks`; `[+2729s] [Not Secure] <OhneHoseOtto> failed: huntAnimals — no cow/chicken/pig/sheep within 32 blocks`; `[+2793s] [Not Secure] <OhneHoseOtto> failed: huntAnimals — no cow/chicken/pig/sheep within 32 blocks`; `[+2857s] [Not Secure] <OhneHoseOtto> failed: huntAnimals — no cow/chicken/pig/sheep within 32 blocks`; `[+2921s] [Not Secure] <OhneHoseOtto> failed: huntAnimals — no cow/chicken/pig/sheep within 32 blocks`; `[+2987s] [Not Secure] <OhneHoseOtto> failed: huntAnimals — no cow/chicken/pig/sheep within 32 blocks`

