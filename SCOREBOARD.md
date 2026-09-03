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
autonomy metric. Run cap 90 min.

**Codified ruling on `/eval` (team-lead, 2026-09-02, closes the self-flag/ruling thread above):**
STEERING is `setProject` only. OBSERVATION is `GET /state` plus any read-only `/eval` that
provably mutates nothing (e.g. reading `globalThis.__agenda`'s own fields — `project`, `blocked`,
`role` — to understand ladder state GET /state doesn't expose). The restriction's actual purpose
is that the LLM never steers the body or alters bot state; a pure state read does neither, so it
is legal, not a violation to be tolerated. Enforcement is `gearrace.mjs`'s ledger audit: any
`/eval` call it flags gets content-verified by whoever reviews the run, and a call that DOES
mutate anything (not just setProject) is disqualifying for that run. Self-flagging a borderline
call before the audit finds it is the expected behavior, not an admission of a violation.

**Fresh world per race run, same seed (Felix's law, added 2026-09-02):** running run #2 on
run #1's already-played world would inherit scars — Otto's tunnels and NacktNorbert's grass
harvesting have already contaminated `world-race` near spawn on the shared-seed track, the exact
same comparability problem that forced 25599 to be abandoned in the first place. So: before EACH
race run, edit `localserver-race/server.properties`'s `level-name` to a fresh, never-used value
(`world-race2`, then `world-race3`, ...) and restart that server (~60-90s regeneration cost). Same
seed = literally identical terrain generation every run = perfect comparability. Old world
directories stay on disk as archives, never deleted. **Exception, standing until lifted**: the
CURRENT world (`world-race`) must NOT be swapped away or have its server restarted while
OhneHoseOtto is live there as engine-dev-3's `digOut` specimen — confirm with them that the
specimen is no longer needed live before touching `level-name` or restarting 25600.

Advancement lines used as ground truth where available: `Stone
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

**UPDATE 13:31-13:36 — killed by Felsenuboot (RCON), respawned, recovering.** Both this bot and
run #1 went silently idle for ~15-20 min on the food-item kit gate (`food 0/4`, full hunger but
zero food items carried — see FEEDBACK.md, this is GOAL.md's documented gap confirmed live, later
refined per run #1's hunt-gate test: the gate itself is clean, it's a routing gap). First tried
`harvestGrass{radius:24,count:16}` WITHOUT repeat (call 3, 13:31:56, same batch call as run #1's —
see that section's call-count correction for why this one went unnumbered in the moment: it
completed once and fell to IDLE, per the non-resumable-skill footgun in FEEDBACK.md). Felix
manually killed NacktNorbert, KlemmKuno and EngineDreckDave via RCON at 13:34:37 after noticing
the stall visually — death cleared the project (engine v53/graychat v5 picked up on respawn —
versions keep moving live). Re-armed with `harvestGrass{radius:24,repeat:true}` (call 4, 13:36:06)
— **this time WITH repeat, after discovering harvestGrass isn't in agenda's `resumable()`
registry and silently completes after one pass without it**. Respawned near the surface, so grass
was in reach: real yield confirmed (`Cut 4 grass`, chat-verified). Steering calls: 4. Deaths: 1.

Still SHAKEDOWN/non-comparable — this update is field intelligence on the food/kit/idle-detection
gaps, not a time record.

**CONCLUDED 13:48:50 — `./stop.sh NacktNorbert` (no-loiter law, team-lead ruling 2026-09-02).**
Shakedown complete; findings extracted (wood-search transient-then-recovered, plank-churn evidence
at v48, the food/kit deadlock corroboration, the harvestGrass repeat:true footgun). Right up to the
stop it was productively harvesting (`Cut 32 grass` at 13:48:06, `Cut 26 grass` at 13:45:54) — this
bot never hit a genuine dead end, it was stopped on purpose because its purpose was served, not
because it failed. Final tally: reached wooden pickaxe only (v48, contaminated track — not
comparable to run #1's clean 1m00s); stone/iron/diamond never reached. **Steering calls: 5**
(corrected from an earlier "3" — my real-time hand tally missed both the 13:31:56 unnumbered
harvestGrass call, same gap engine-dev's gearrace.mjs audit caught on run #1, AND a second re-arm
at 13:43:25 after the second kill-spree settled that was never logged as a numbered call at all:
1) mineLane 12:52:03, 2) re-arm 13:01:05, 3) harvestGrass-no-repeat 13:31:56, 4) harvestGrass-repeat
13:36:06, 5) harvestGrass-repeat re-arm 13:43:25). Also 2 read-only `/eval` diagnostic calls
during the 13:41 kill-spree investigation (checking `A.project`/`A.blocked`/`A.role` state — NOT
setProject, NOT hand-driving, but technically outside the letter of "setProject or GET /state
only"; self-flagging this since gearrace.mjs's ledger audit surfaces it as "2 other /eval" and it
should be owned, not left for someone else to notice). **Deaths: 5**, corrected from an earlier
"2" — I had narratively collapsed a rapid RCON kill cluster into "one kill spree" and lost the
actual count; `grep -c "NacktNorbert was killed" localserver/logs/latest.log` gives the true
number: 13:34:37, then 13:41:09/13:41:12/13:41:14/13:41:55 (the last four within 46 seconds).
**Mystery resolved (team-lead, 2026-09-02): all 5 are generic RCON-kill signatures, all Felix,
all non-organic — the 13:41 cluster is exactly the "NacktNorbert 3x in 5 seconds" kill-spree I
reported in an interim message at the time, plus one more at 13:41:55. Engine exonerated on
every one; no bug, no combat/fall/drown cause, nothing for the ladder to have prevented.**

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

**Run #1 was HANDED OFF as a live specimen** (team-lead + engine-dev-3, 2026-09-02): OhneHoseOtto
stayed entombed, untouched, process left running — port 3140, race server 127.0.0.1:25600, position
(2.51, 89, 12.43). Ownership transferred to engine-dev-3 to develop/test the missing
`ascendToSurface`/`digOut` skill against a naturally-occurring stuck bot. Race rules (setProject-only,
no /eval action code) lifted on this bot as of the handoff — full FEEDBACK.md writeup below.

**RESOLVED, same day.** engine-dev-3 root-caused it via read-only `/eval` forensics (my own
WALL_OFF speculation was wrong — zero panic events ever fired; the real cause was `producer.js`'s
cobblestone-search wandering unboundedly horizontally, fixed as producer v7), built
`ascendToSurface` (skills v55) and a new ESCAPE agenda rung (v21) that auto-routes a path-blocked
underground project to it, then live-verified by actually walking Otto out: y=89 -> y=102 in ~65s,
independently block-scan-confirmed as real open sky. Otto is free, healthy, and no longer a
specimen — full writeup in FEEDBACK.md, github felsenuboot/felcrew-mcp#89 (CLOSED). This run's DNF
record above is UNCHANGED (already finalized before the fix landed) — the resolution doesn't touch
the measurement, only frees the bot.

Steering calls: 2 so far — (1) initial `setProject` at 12:59:29; (2) re-arm at 13:02:05 after a
process restart to move the bot from port 3110 to 3130->3140 (port collision, same infra-fix
class as run #0's restart, not a driver decision — footnoted separately). Deaths: 0.

**UPDATE 13:31-13:41 — HARD DEAD END, likely permanent DNF.** Hit the same food-item kit gate as
run #0 (see above / FEEDBACK.md) while mining toward stone, having descended to y89 (14 blocks
below its own y103 surface spawn) chasing the target. First tried `harvestGrass{radius:24,
count:16}` **without `repeat`** (call 3, 13:31:56) — this is the call this section originally
left unnumbered; engine-dev's ledger-verified ` gearrace.mjs` count (7) caught the gap against my
hand tally (6), traced and confirmed below. It ran once and, per the same non-resumable-skill
footgun documented in FEEDBACK.md, would have completed-forever with nothing to show for it. Only
once I noticed that same footgun (from NacktNorbert's parallel run) did I re-arm with
`harvestGrass{repeat:true}` (call 4, 13:36:06) — correctly found ZERO grass at y89 and kept
retrying without falsely completing this time. Tried routing to the surface with `come` twice —
its exact spawn coords (call 5, 13:37:05) and straight up from its own x/z (call 6, 13:37:53) —
BOTH failed: first `No path to the goal!`, second `goto resolved 14.02 from the goal (tolerance
4.5)` resolving in ~1.3s with position UNCHANGED to the decimal on every retry since. That reads
as zero viable steps in any direction, not a partial/interrupted climb. **No skill in the
registry (`./task.sh list`) ascends or digs a bot out of a sealed pocket** — every avenue
available through `setProject` alone is now exhausted. This bot is very likely stuck until
someone with `/eval` or RCON access frees it manually; see FEEDBACK.md for the full writeup and a
proposed `ascendToSurface`/`digOut` skill. Steering calls: 6.

**CORRECTION 13:42-13:43, team-lead-directed empirical test — reclassify the cause.** Set
`huntAnimals` (call 7, 13:42:38) specifically to test whether it demands food (per team-lead: test,
don't trust the doc). It started immediately with NO `kit_missing` at all — `Hunting 2x
cow/chicken/pig/sheep. Nothing personal.` — and failed only on `no cow/chicken/pig/sheep within 32
blocks`. **#45 (huntAnimals gated on weapon, not food) is verified live on v50 — the food/hunt
catch-22 is CLOSED as a gate problem.** Correct classification for this run's DNF is therefore
**"sealed underground, no path to ANY food source (grass or fauna) — a reachability dead end, not
a kit-gate deadlock."** The food gate itself is clean; Otto just can't physically reach anything
that would satisfy it. Steering calls: 7.

**CALL-COUNT CORRECTION, 2026-09-02, engine-dev via gearrace.mjs ledger audit:** my real-time hand
tally undercounted by exactly one — the 13:31:56 `harvestGrass{count:16}` call above went
unnumbered in the moment (I called the very next call, 13:36:06, "call 3" instead of "call 4").
Renumbered above to match the ledger's 7, which I re-verified by re-reading my own tool-call
history line by line rather than just accepting the corrected number: 1) mineLane 12:59:29, 2)
mineLane re-arm 13:02:05, 3) harvestGrass-no-repeat 13:31:56, 4) harvestGrass-repeat 13:36:06, 5)
come#1 13:37:05, 6) come#2 13:37:53, 7) huntAnimals 13:42:38. Lesson, worth carrying into run #2:
hand-tracking a call counter in real time while also diagnosing and driving is exactly the kind
of bookkeeping an instrument should own — `gearrace.mjs`'s ledger-based count is now the
authoritative source for this metric, my inline numbering is a convenience annotation only.

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
- **Zero-defense combination — filler low + melee threat present** (added for run #4, team-lead
  advisory 2026-09-02, `#96` field-confirmed fatal — this is exactly what killed RotzRudi 3x in run
  #3): `WALL_OFF` needs filler blocks (cobble/dirt) to actually seal; without them it can only run,
  not defend. A design fix is in progress but will **NOT** be aboard this racer. Treat "filler
  count low (check via a read-only kit/inventory glance when HP drops or a melee mob is reported in
  status) + a melee threat present" as an EARLY WARNING, before HP gates close — a legal
  `setProject` toward disengagement (`come` toward home/open ground, away from the threat) beats any
  reaction after HP is already critical. If the racer dies to this exact chain anyway, the
  attribution is pre-written (see run #3's writeup) and the run still measures everything else —
  don't let one melee death read as a mystery.

**Green-light criteria for run #2 (updated per team-lead 2026-09-02):** the gate itself (`#45`)
is already fine and does NOT need to be part of the gate. What run #2 actually needs landed first:
(1) a **food-ROUTING fix** — some agenda rung (RESTOCK, or a new one) that automatically sets
`huntAnimals`/`harvestGrass` when a project is refused on a food shortfall, instead of requiring a
driver to notice and branch manually; (2) the **`digOut`/`ascendToSurface` skill** landing and
being verified against the OhneHoseOtto specimen. Both, not either — run #2 measures the delta
against run #1's diagnosed failure modes, so both root causes should be closed before it launches.

**Prep-for-green-light checklist (team-lead, 2026-09-02) — my job, in order, before team-lead
flips the light:**
1. Confirm with engine-dev-3 that `digOut` has landed AND that the OhneHoseOtto specimen is no
   longer needed live (do not touch `world-race`/25600 before this — see the fresh-world-per-run
   exception above).
2. Swap `localserver-race/server.properties`'s `level-name` to `world-race2` (fresh, never-used)
   and restart the 25600 server (~60-90s regen).
3. Spawn with a fresh never-used name, `OWNER=test-driver PURPOSE="..."` env vars, `./list.sh`
   run first to confirm the roster, race book branches already armed (this file, above), and
   `gearrace.mjs` as the recorder of record from the start rather than a post-hoc cross-check.

Then team-lead flips the light. Nothing on this list is done yet — standing by on step 1.

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

### Run (auto) — 2026-09-02 11:52 — NacktNorbert, /home/felix/minecraft/localserver

Generated by `bench/gearrace.mjs`. Engine versions: engine version unknown (bot not reachable for GET /state). Run may still be in progress at generation time.

| Tier | Time from join | Source |
|---|---|---|
| Wooden pickaxe | 6m19s | log:Tool ready |
| Stone pickaxe | DNF | DNF -- see notes below |
| Iron pickaxe | DNF | DNF |
| Diamond pickaxe | DNF | DNF |

Steering calls: 7 (5 setProject, 2 other /eval). Deaths: 5.

DNF context (stone_pickaxe): `[+1415s] [Not Secure] <NacktNorbert> Produced 4 stick (crafted).`; `[+1452s] [Not Secure] <NacktNorbert> Produced 8 torch (crafted).`; `[+2752s] [Not Secure] <NacktNorbert> Cut 4 grass.`; `[+3205s] [Not Secure] <NacktNorbert> Cut 32 grass.`; `[+3330s] [Not Secure] <NacktNorbert> Cut 26 grass.`; `[+3462s] [Not Secure] <NacktNorbert> Cut 32 grass.`

### Run #2 — FrischFriedhelm, 127.0.0.1:25600 (`world-race2`, fresh, same seed) — LIVE, official, run per the pre-planned race book

Prep-for-green-light checklist completed in order: (1) engine-dev-3 confirmed `digOut` shipped
(producer v7, `ascendToSurface`, ESCAPE rung v21) and the OhneHoseOtto specimen freed/no longer
needed live (see run #1's resolution note and FEEDBACK.md's "digOut CLOSED" entry) — verified via
their own report, not assumed; (2) RCON `stop` on the old `world-race` process (only occupant was
Otto, confirmed via `list` first), `level-name` swapped to `world-race2` in server.properties,
server relaunched — fresh world confirmed generated (`Preparing level "world-race2"`, "Done" in
2.064s); (3) fresh never-used name `FrischFriedhelm` (checked against pids/ and both usercaches),
spawned with `OWNER=test-driver PURPOSE="gear-race run #2..."` env vars (now native to `spawn.sh`
per the new law), `./list.sh` run before AND after spawn to confirm the roster.

**One honest footnote on "virgin":** OhneHoseOtto's runner.js auto-reconnected to the new world for
~10 seconds (14:29:12-14:29:23, entity id 39 -> a fresh spawn since world-race2 had no prior data
for that name) before I caught it and stopped the process — it only logged a single idle
`Checking for stray drops around me` filler line, no project was set, no blocks were touched. Not
a meaningful contamination, but recorded rather than silently omitted, per this file's own
measurement-honesty standard.

Engine versions at run start: skills **v55**, agenda **v22**, producer **v7**, dangerscan v4,
survival v5, digguard v5, digchain v1, graychat v5, toolguard v2, reachguard v1 (idleguard off,
subsumed by agenda) — includes `ascendToSurface` and the ESCAPE rung for the first time in any
race run. Bot confirmed empty/never-used before spawn.

| Tier | Time from join | Notes |
|---|---|---|
| Join | T+0 (14:30:14) | fresh spawn, empty inventory confirmed, position (8.5, 94, -0.5) |
| Wooden pickaxe | pending | — |
| Stone pickaxe | pending | — |
| Iron pickaxe | pending | — |
| Diamond pickaxe | pending | — |

Steering calls: 1 — (1) initial `setProject(mineLane,{target:'stone',count:16})` at 14:30:25.
Deaths: 0. Race book branches armed (food-shortfall -> huntAnimals-with-repeat manual branch,
barren-search reposition, DEAD RACE = DEAD STOP backstop at 5 dead minutes — though the ESCAPE
rung should now make the sealed-pocket branch a non-issue for the first time).

**EPISODE 14:35-14:43 — food-routing gap, `#88` live (team-lead diagnosis, not a bug hunt).**
Self-provisioning went well at first: torches/sticks/filler kit items were being gathered (kit
refusal at 14:35:23 listed multiple missing items, narrowing naturally as each was produced). But
by 14:38:37 the ONLY remaining blocker was `food 0/4`, and it stayed exactly there — repeated
identical refusals at 14:38:37/14:39:37/14:41:37 while position froze completely from ~14:39:13
onward. **Diagnosis (team-lead): NOT a v20 regression — `#88` live.** The food-routing fix routes
food acquisition via `ROLE_WORK.hunter`; this racer has `role:null` (no `--role` at spawn, by
race-format design), so a role-less bot has no automatic food-acquisition path — deliberately
deferred to the not-yet-built Direction Episodes work, not an oversight in the current commit.
The `#45` gate fix (huntAnimals demands no food) was necessary but not sufficient on its own;
nothing routes a food shortfall TO huntAnimals for a role-less bot.

**Detection gap on MY side, also worth recording honestly:** my monitor's position-based stall
alarm never fired meaningfully on this because the bot kept MOVING via drop-sweep busywork while
repeatedly refusing to depart — the exact "busywork masks a stalled ladder" class from run #1,
just with position moving instead of frozen. Team-lead's own manual pulse-check caught it faster
than my instrumentation did. Fixed the monitor immediately: it now alarms on 2+ identical refusal
lines within 300s AND on `rung=IDLE` streaks while a project is set, neither of which depend on
position at all.

**Action + cost:** `setProject(huntAnimals,{...},repeat:true)` at 14:43:19 (steering call 2; one
earlier attempt at 14:43:06 hit a JSON syntax error and never reached `setProject` — 0 effect on
the bot, not counted as a real steering decision, footnoted here for an honest total of 3 `/eval`
calls / 2 real ones). **Minutes lost to the deferred-design gap: ~4m42s** (14:38:37, first
pure-food refusal, to 14:43:19, the fix) — or ~7m56s counting the earlier legitimate kit-assembly
phase from 14:35:23. This is the measured cost of `#88`'s deferred scope, recorded as data, not
as a fault against the engine's current commit.

**EPISODE 14:47-15:17 — hunt escalation ladder + a second, driver-side idle-gap.** Radius 32 and
64 both came back with benign no-fauna failures repeatedly (fauna was outside both radii near
this spawn — see the fauna-barren-spawn finding below). A read-only `/eval` scan of `bot.entities`
found the nearest huntable species (pig) at ~57-66 blocks — inside the radius:64 search that was
still failing, an unresolved discrepancy worth a FEEDBACK.md flag (raw entity-list distance vs.
whatever `huntAnimals`'s own search actually filters on). Steered directly at the pig cluster with
`come{x:-55,y:115,z:-17}` (call 4, 15:04:12) rather than guess further. Arrival ("Arrived.") logged
at 15:13:56 (UTC/server-log time — 13:13:56 in that clock), but the huntAnimals re-arm did not
fire automatically and the bot sat in IDLE drop-checks. **This idle gap is mine, not the engine's**:
my own stall-detection DID fire correctly (IDLE-STREAK-ALARM at both the 90s and ~3min marks,
exactly as redesigned after the earlier episode), but I was mid-analysis on the search-radius
finding when the arrival happened and didn't act on the alarm until team-lead's direct nudge.
Re-armed `huntAnimals{radius:32,repeat:true}` (call 5) at 15:16:54 local — **idle gap: 2m58s**
from arrival to re-arm. First kill confirmed immediately after: "Hunting 1x..." (15:16:56) ->
"1 of 1 down. Grabbing the drops." (15:17:01), food recovering (6 -> 9 within 30s of the kill).

**Finding: this seed's spawn region (both `world-race` and `world-race2`, same seed) is fauna-poor
near spawn.** Two independent runs (Otto on `world-race`, this bot on `world-race2`) both needed a
50+ block directed search/relocation before finding huntable animals. Affects future run
comparability on this seed — a driver should expect to budget for a hunt-relocation phase, not
assume fauna is available near spawn just because the terrain/tree generation is confirmed clean.

**EPISODE 15:22-END — skeleton burst -> WALL_OFF heal-deadlock -> OFFICIAL DNF.** While travelling
toward the 2nd pig target (`come{-84.6,112,-28.9}`, call 6), a skeleton engaged mid-path. Full
damage timeline (UTC): 13:23:16 hp=17 -> 13:23:22 hp=14 -> 13:23:26 hp=11.5 -> 13:23:29 hp=8.5 ->
13:23:40 hp=6.0 (`skeleton shooting from 8 - breaking line of sight`, BREAK_LOS engaging) ->
13:23:41.834 `Cobble wall up - that is my arrow shadow` -> 13:23:41.840 `Walling myself in to
patch up. Back shortly.` (escalating to WALL_OFF) -> 13:23:43.788 hp=3.0. **Survival worked**:
both BREAK_LOS and WALL_OFF fired live in one incident, arguably the first clean live observation
of the BREAK_LOS arrow-shadow path (this codebase's own history notes it had never fired before —
corner-step always won first). The bot did not die.

**But survival then imprisoned what it saved.** First `Stable again (BREAK_LOS, HP 3/20). Awaiting
orders.` at 13:24:45.858, transitioning to `Stable again (WALL_OFF, HP 3/20)` at 13:25:47.506 and
repeating on a ~62s cadence CONTINUOUSLY for **26 cycles over 25m44s** (13:24:45 -> 13:50:29, the
last observed before this record was closed) with zero self-exit. Root cause: natural HP
regeneration requires hunger >=18; the bot ate its one porkchop from the earlier kill and food is
stuck at 9 with no path to more (REFLEX owns the ladder — `setProject` cannot penetrate it, so
even the food-routing fix from the earlier episode is moot here). At 13:49:28.310 a second
downstream lock surfaced: `failed: collectDrops — health 3.0 <= guard` — the health guard that
normally protects a bot from digging into danger now blocks EVEN THE HARMLESS drop-sweep, because
nothing distinguishes "too hurt to fight" from "too hurt to bend down." Team-lead's timeboxed
ruling (give it until ~13:48 UTC for a self-exit) was honored — a background wait confirmed no
change through 13:50:29, and the deadline was called.

**OFFICIAL RESULT: Run #2 concludes as DNF.** Cause chain: fauna-scarce spawn (seed-level finding,
above) -> directed relocation put the bot in the open for longer than a fauna-rich spawn would ->
skeleton burst -> WALL_OFF heal-deadlock (no food -> regen impossible -> exit condition
unreachable). Reached: wooden pickaxe (1m00s) and wooden sword only; stone/iron/diamond never
reached — this run never got past the tool-bootstrap tier before landing in the deadlock.
**Total steering calls: 6** (1: mineLane init, 2: huntAnimals r32, 3: huntAnimals r64, 4: come to
pig cluster #1, 5: huntAnimals re-arm at cluster #1 (the 2m58s idle-gap call), 6: come to pig
cluster #2, where the skeleton found it). Deaths: 0 — survival kept it alive; the deadlock is a
worse outcome than a clean death would have been for measurement purposes, since a dead bot at
least frees the world for a fresh run.

**Four distinct engine findings from this one run** (team-lead's framing, and accurate): (1) `#88`
food-routing gap, confirmed live, gate itself exonerated via direct test; (2) `harvestGrass`/
non-resumable-skill one-shot-completion footgun; (3) fauna-scarce spawn on this seed, affecting
future run comparability; (4) WALL_OFF heal-deadlock — survival.js has no can-I-actually-heal
check and no low-HP-but-threat-cleared exit condition, plus the 60s re-announce churn and the
collectDrops health-guard cascade as contributing symptoms. **Filed to GitHub, engine-dev's lane
per survival.js ownership — see FEEDBACK.md for the full technical writeup.**

**Post-conclusion housekeeping**: `FrischFriedhelm` process stopped. `world-race2` is ARCHIVED,
NOT deleted (per the fresh-world-per-run law) — it now carries BOTH engine-dev's staked R2 wedge
geometry (2,101,2) and this run's wall-off site (-77.5,112,-21.5), valuable for diagnosis on both
fronts. `gearrace.mjs --append-scoreboard` requested from engine-dev for the auto-corroboration
block. Run #3 is on hold for team-lead's green light, pending the survival exit-condition fix and
the soak #2 verdict.

### Run (auto) — 2026-09-02 13:54 — FrischFriedhelm, /home/felix/minecraft/localserver-race

Generated by `bench/gearrace.mjs`. Engine versions: engine version unknown (bot not reachable for GET /state). Run may still be in progress at generation time.

| Tier | Time from join | Source |
|---|---|---|
| Wooden pickaxe | 2m17s | log:Tool ready |
| Stone pickaxe | DNF | DNF -- see notes below |
| Iron pickaxe | DNF | DNF |
| Diamond pickaxe | DNF | DNF |

Steering calls: 10 (7 setProject, 3 other /eval). Deaths: 0.

DNF context (stone_pickaxe): `[+4692s] [Not Secure] <FrischFriedhelm> Walling myself in to patch up. Back shortly.`; `[+4754s] [Not Secure] <FrischFriedhelm> failed: collectDrops — health 3.0 <= guard`; `[+4754s] [Not Secure] <FrischFriedhelm> Walling myself in to patch up. Back shortly.`; `[+4816s] [Not Secure] <FrischFriedhelm> Walling myself in to patch up. Back shortly.`; `[+4877s] [Not Secure] <FrischFriedhelm> Walling myself in to patch up. Back shortly.`; `[+4939s] [Not Secure] <FrischFriedhelm> Walling myself in to patch up. Back shortly.`

### Run #3 — RotzRudi, 127.0.0.1:25600 (`world-race3`, fresh, same seed) — LIVE, the Direction Episodes era

Both green-light gates cleared before launch: `#92` heal-deadlock fix (survival v6, WALL_OFF now
exits on threat-clear AND (healed OR cannot-heal)) and soak #2's formal Direction Episodes Phase-3
acceptance verdict. Prep executed in order: (1) self-verified via `./list.sh` + `server.log` +
`pids/` that `KrachKuddel` (engine-dev's `#54` walk-execution specimen) was already disconnected
(19:31:12) with no live pid/`.port` file — messaged engine-dev to confirm/object rather than
blocking on a reply, per the launch checklist's own "if not, verify and message them" branch; (2)
graceful `SIGTERM` on the `world-race2` java process (level.dat saved 19:32, confirmed clean),
`level-name` swapped to `world-race3` in `server.properties`, relaunched — fresh world regenerated
in 2.151s, seed re-verified unchanged (`felcrewtest`); `world-race2` stays on disk as an ARCHIVE,
never deleted (still carries engine-dev's staked `#54` wedge geometry (2,101,2) and run #2's
WALL_OFF site (-77.5,112,-21.5)); (3) fresh never-used name `RotzRudi` (checked against every
`pids/*.meta`, both usercaches, and `logs/*.log` before spawn), spawned with
`OWNER=test-driver PURPOSE="gear-race run #3, world-race3, Direction-Episodes era"` env vars,
`./list.sh` run before and after to confirm the roster.

**Format note for this era**: the fleet decider daemon (`decider.js`, rules.json first,
Andy/Ollama on a miss) is running and serves this racer too — intended, not a violation of the
role-less design; per team-lead, `#88` (role:null food-routing gap) formally closes when a race
proves the decider feeds a role-less bot end to end. Any dispatch the decider makes (visible in
`logs/decider.log` as `RotzRudi: rule|llm decision for '<trigger>' -> <skill>`) is ENGINE
attribution, not a driver steering call; only my own `setProject` calls count against the
autonomy metric.

Engine versions at run start: skills **v58**, agenda **v24** (one point newer than the v23
expected in the launch brief — live engine motion, not a concern), dangerscan v5, survival **v6**
(carries the `#92` fix for the first time in any race run), digguard v5, toolguard v2, producer
v7, digchain v1, graychat v5, reachguard v1 (idleguard off, panicguard off — both subsumed).
Bot confirmed empty/never-used before spawn.

| Tier | Time from join | Notes |
|---|---|---|
| Join | T+0 (19:33:36) | fresh spawn, empty inventory confirmed, position (7.5, 96, 2.5), health 20/20, food 20/20, role:null (race-format default) |
| Wooden pickaxe | T+3m42s (19:37:18) | `Tool ready: wooden_pickaxe (crafted)` — clean, no failed attempts logged. Slower than run #1's 1m00s but well inside normal variance (run #0 took 6m19s under a contaminated track). Bot healthy (20/20 hp+food) moving into RESTOCK for the underground kit tier. |
| Stone pickaxe | pending | — |
| Iron pickaxe | pending | — |
| Diamond pickaxe | pending | — |

Steering calls: 1 — (1) initial `setProject({skill:'mineLane',args:{target:'stone',count:16}})` at
19:33:58 (one earlier call at 19:33:5x used the wrong call shape, `setProject(bot, spec)` instead
of `setProject(spec)`, and returned a clean validation error with zero effect on the bot — not
counted as a real steering decision, footnoted here for an honest tally). Deaths: 0. Race book
branches armed (food-shortfall -> huntAnimals-with-repeat if the decider hasn't already routed it,
barren-search reposition, DEAD RACE = DEAD STOP backstop at 5 dead minutes). Monitor armed: 15s
`/state` poll for IDLE-while-project-set, `direction.state==='needs_direction'`, kit `blocked`,
and low-HP, plus a real-time `server.log` tail for every RotzRudi chat/death/advancement line.
Baselines to beat: run #1 (v50) wood 1m00s/DNF-stone, run #2 (v55) wood-only/DNF heal-deadlock (6
calls). Watching for: fauna-scarce spawn on this seed (measured twice already), and whether the
decider closes `#88` for real this time.

### Run (auto) — 2026-09-02 18:03 — RotzRudi, /home/felix/minecraft/localserver-race

Generated by `bench/gearrace.mjs`. Engine versions: engine version unknown (bot not reachable for GET /state). Run may still be in progress at generation time.

| Tier | Time from join | Source |
|---|---|---|
| Wooden pickaxe | 3m42s | log:Tool ready |
| Stone pickaxe | DNF | DNF -- see notes below |
| Iron pickaxe | DNF | DNF |
| Diamond pickaxe | DNF | DNF |

Steering calls: 19 (4 setProject, 15 other /eval). Deaths: 3.

DNF context (stone_pickaxe): `[+790s] [Not Secure] <RotzRudi> HP 20/20 - breaking off, running for base.`; `[+797s] [Not Secure] <RotzRudi> No cobble to wall in with. Kit rule broken - heading out the way I came.`; `[+800s] [Not Secure] <RotzRudi> HP 20/20 - breaking off, running for base.`; `[+807s] [Not Secure] <RotzRudi> No cobble to wall in with. Kit rule broken - heading out the way I came.`; `[+809s] [Not Secure] <RotzRudi> failed: collectDrops — health 0.7 <= guard`; `[+812s] [Not Secure] <RotzRudi> HP 20/20 - breaking off, running for base.`

**OFFICIAL CONCLUSION — DEAD RACE = DEAD STOP invoked by test-driver, 2026-09-02 ~20:02, no
lead approval sought per the law's own terms.** Position and inventory were both completely flat
for ~19 minutes (19:42:51 last yield to ~20:02 conclusion), a diagnosed cause was in hand, and no
legal (`setProject`-only) recovery path existed — all three preconditions met.

**Cause chain (a NEW wedge, distinct from OhneHoseOtto's underground sealed-pocket case):**
(1) During the kit self-provisioning phase the bot's own chopping/mining near spawn evidently
disturbed the ground at the true world-spawn coordinate (the original join point, (7.5,96,2.5)).
(2) A skeleton/zombie burst at 19:46:23 dropped HP to 9, triggered `WALL_OFF`, which immediately
hit `kit_violation: no filler blocks for wall-off` (zero cobblestone carried despite 24 having
been mined earlier — see open question below) and could only flee, not seal. Three deaths to
Zombie followed within 28 seconds (19:46:37/54, 19:47:05) — **vanilla drops the full inventory on
death, so each of the 3 deaths stripped tools/torches/sticks/cobblestone; by the 3rd death the bag
was completely empty and stayed that way for the rest of the run** (confirmed via
`bot.inventory.items()`, a read-only `/eval`). (3) Because the original spawn was seemingly no
longer valid, the server relocated the respawn point to (-2.5,109,{2.5→4.4)) — **a single isolated
`acacia_leaves` block floating in open air**, confirmed via a read-only vertical `blockAt` scan:
air for 5 blocks straight down to the nearest ground (short_grass at y≈103). The fleet's default
pathfinder `Movements` caps a single drop at `maxDropDown:3`; a bare 5-6 block fall with nothing to
land on partway and zero inventory to bridge/tower with is **outside every legal skill's reach** —
`chopTrees`, `mineLane`, and a driver-issued `come{x:0,y:103,z:4}` all confirmed unable to move the
bot one block from this spot. (4) The spot is also permanently dark (`light:0` despite
`skyLight:14` — no torches, ever) and evidently mob-attractive: `__skills.status`'s log showed a
chain of zombie/creeper `panic_enter` events at this exact position, and at the moment of
conclusion a **creeper sitting 3.3-3.5 blocks away (unable to path up onto the platform, but
visible to `dangerscan` through the gap) kept `danger.state` pinned at `"panic"` continuously**,
which appears to hold `REFLEX` from ever handing control back to `PROJECT` — every project set
after the 3rd death (`chopTrees` x3 via decider, `mineLane` and `come` via me) sat with `task:null`
indefinitely rather than actually attempting a move.

**Decider behavior, separately worth noting (not the root cause, but a real gap):** the decider
answered every `project_stalled`/`unproductive_idle` episode promptly (not the `#95` give-up
pattern — no unmapped-Andy-reply strikes, no rot) but re-dispatched the **identical**
`chopTrees{types:['oak'],maxDist:32}` three times in a row from a position that never moved,
rather than repositioning after the first repeat failure — exactly the "barren search, reposition
before re-trying" branch the race book reserves for a driver, because nothing in the decider's
current logic seems to check "did my last dispatch of this exact skill+args also fail from this
exact position." Filed as a proposed engine gate below, distinct from `#95`.

**Self-flagged call accounting (per the standing `/eval` ruling — self-flagging before the audit
finds it):** of the 15 non-`setProject` `/eval` calls the ledger recorded, **5 are mine**, all
pure reads with zero mutation: `bot.inventory.items()` enumeration, two `bot.blockAt` terrain
scans (6-direction + vertical column), one read of `__agenda`'s own `{rung,project,blocked,role}`
fields, and one no-op snapshot probe that returned `null`. **The remaining ~9-10 are the decider's
own `dirDispatch`/registry-check calls**, which hit this bot's port over HTTP the same way a
driver's would and so land in the same ledger — ENGINE attribution per this run's accounting
rules, not steering. My real steering tally: **4 setProject calls** (1: opening `mineLane`, 2:
re-arm `mineLane` after the full inventory wipe, 3: `come` reposition attempt) — plus the
footnoted call-1 shape error from the opening, which also contains the substring `setProject` and
so is counted in the ledger's "4" but had zero effect on the bot.

**Final table: wooden pickaxe only, T+3m42s (19:37:18). Stone/iron/diamond pickaxe: DNF —
stranded-on-an-elevated-isolated-platform, not resource-scarcity or heal-deadlock.** Deaths: 3.
Total run time to conclusion: ~28m30s of the 90-min cap (of which ~19 consecutive minutes were
provably dead). Baselines: beats run #2 on deaths avoided at the fatal moment (0 additional deaths
after my intervention attempts, since none of my 4 setProject calls put the bot back in harm's
way) but is a clear regression on wall-clock vs run #1's DNF-at-stone (that run reached 40+ minutes
of real mining before its dead end; this run lost the back half of its life to a spawn-relocation
accident within the first 15 minutes).

**Proposed engine work (FEEDBACK.md + GitHub, engine-dev/-3 lanes):**
1. A generic "stuck with no legal path, not necessarily underground" detector/recovery — the
   existing ESCAPE rung (v21) is scoped to underground sealed pockets; this case is a surface/
   elevated isolated-platform trap the same rung doesn't currently catch. Possible shape: if N
   consecutive project attempts across ANY skill produce zero position delta and zero task start,
   promote to ESCAPE regardless of y-level or `surfaceExposed`.
2. Decider retry logic should track "did this exact skill+args already fail from this exact
   position" and reposition (or escalate to a driver/needs_direction with a distinct `why`) rather
   than re-issuing an identical dispatch a 2nd/3rd time.
3. `danger.state` staying pinned at `"panic"` against a threat that cannot path to the bot (the
   creeper 3+ blocks below an isolated platform) blocks `REFLEX` from releasing control
   indefinitely — worth a reachability check before a live-but-unreachable threat holds the ladder
   hostage. Possibly related: `danger.state` read `"panic"` at score 2.59, below the documented
   `>=5` panic threshold in DRIVER_GUIDE.md — worth reconciling live behavior against the doc.
4. **Open question, not yet answered**: why did the bot have zero cobblestone for WALL_OFF at
   19:46:34 when 24 cobblestone had been mined at 19:42:09 and no `Produced`/craft/deposit line
   consumed it in between? Either it was spent on something not logged, or there's a separate
   inventory-accounting gap. Flagging rather than guessing.

`RotzRudi` process left running (not stopped) — offered to engine-dev-3 as a live specimen for
building the missing surface/elevated-platform escape capability, the same pattern used for
OhneHoseOtto's underground case. World-race3 stays up; no new race run starts on this server until
that's resolved or declined.

## Cross-run retrospective (runs #0-#4 comparable, run #5 suspended, test-driver, 2026-09-02)

Written at team-lead's request, originally on the ruling that held run #4 for three gates (#97's
paralysis fix, survival v7 aboard, the cobble-vanish mystery explained) — all three cleared (the
paralysis gate amended to the REFLEX-release half alone) and run #4 launched, then concluded in
~7 minutes on a new, more severe bug. Updated in place rather than left stale. Purpose: give Felix
one place to judge the whole benchmark program, not just the latest run.

**Run-count note (added after run #5's operator wind-down)**: run #5 (BruzzelBruno, `world-race5`)
is deliberately EXCLUDED from the comparison table and tally below — it was suspended by an
operator wind-down mid-run, not concluded by a diagnosed cause, so it carries no DNF cause and no
real survival-time to compare against runs #1-#4. Its full state-at-stop is recorded as a footnote
at the end of the run log above (reached wooden pickaxe T+7m25s, first live confirmation that both
the `#96` zero-defense floor and `#97`'s frozen-repeat dedup fix work as designed, one organic
combat death). The wall tally below still reads **0 of 4**, not 5 — run #5 neither broke the wall
nor extended the failure catalog, it was stopped before either could happen.

### Comparison table

| | Run #0 (shakedown) | Run #1 (baseline) | Run #2 | Run #3 | Run #4 |
|---|---|---|---|---|---|
| Bot / world | NacktNorbert / shared `localserver` (contaminated) | OhneHoseOtto / `world-race` | FrischFriedhelm / `world-race2` | RotzRudi / `world-race3` | SabberSepp / `world-race4` |
| Engine at start | skills v48→v50 mid-run, agenda v19 | skills v50, agenda v19 | skills v55, agenda v22, producer v7 | skills v58, agenda v24, survival v6, producer v7, decider.js live (1st race) | skills v59, agenda v25, **survival v8** (carries `#94` + `#97` finding-3 fixes) |
| Wooden pickaxe | T+6m19s (contaminated track — 2 failed searches) | **T+1m00s** (clean) | T+2m17s (clean) | T+3m42s (clean) | **T+59s** (clean — fastest ever, tied with run #1) |
| Stone/iron/diamond | not reached (stopped on purpose, still working) | DNF — never reached | DNF — never reached | DNF — never reached | DNF — never reached |
| DNF cause | n/a (no-loiter stop, not a dead end) | food-routing gap + terminal entombment (sealed pocket, y89) | WALL_OFF heal-deadlock (`#92`, 26 cycles/25m44s at 3 HP) | elevated isolated-platform stranding + REFLEX pinned by unreachable threat (`#97`) | **threat-independent panic thrash** — standalone HP<8 entry re-fires forever with zero mob involvement (`#99`, new, no freak geometry needed) |
| Real time to conclusion | 58m26s (deliberately stopped, not dead) | ~43 min | **~80 min** (longest-lived) | ~28.5 min | **~7 min** (shortest-lived by far) |
| Steering calls (ledger) | 5 setProject + 2 read-only (hand-tally corrected twice) | 7 setProject, 0 other (hand-tally undercounted by 1, corrected) | 7 setProject + 3 other = 10 total (hand-tally said "6," never reconciled until this retro) | 4 setProject + 15 other = 19 total (self-flagged live) | **2 setProject + 5 other = 7 total**, both setProject calls objectively correct, neither able to outrun the bug |
| Deaths | 5 (all RCON, non-organic, exonerated) | 0 | 0 (survival kept it alive — arguably worse, see below) | 3 (all organic, Zombie) | 1 (Zombie, T+29s — the trigger, not the cause) |
| Findings logged | 5 | 5 | 5 | 4 | 1 (but a severe one) |
| Live specimen handed off | no | **yes — OhneHoseOtto, resolved same day** (`#89` closed) | no | **yes — RotzRudi**, `#97` finding 3 fixed+verified same day, wound down clean | **yes — SabberSepp, still live and thrashing**, handed to engine-dev (lane-corrected from an initial eng-3 offer) as the entry-gate half of their in-progress `#96` fix |
| GitHub issue | (pre-dates per-run issue filing) | `#89` | `#92`, `#94` | `#97` | `#99` |

### What each run's DNF forced the engine to build

- **Run #0 → #1 window**: nothing shipped from #0 alone (it was a shakedown), but it independently
  corroborated the food/kit deadlock and the `harvestGrass` non-resumable-skill footgun that run #1
  hit again for real — first sighting, not first fix.
- **Run #1 → #2 window** (same-day turnaround): `producer.js` v7 fixed the unbounded horizontal
  cobblestone-search wander that actually caused Otto's entombment (my own WALL_OFF theory was
  wrong — eng-3's `/eval` forensics found the real cause). `ascendToSurface` (skills v55) + the
  ESCAPE agenda rung (v21) were built from nothing and live-verified by walking Otto out
  (y89→y102, ~65s) — a capability the engine simply did not have before this run manufactured the
  specimen to build it against. `#89` closed same day.
- **Run #2 → #3 window**: survival v6 shipped fixing `#92` (WALL_OFF now exits on threat-clear AND
  (healed OR cannot-heal), instead of looping forever at low HP with no food path) — soak-tested
  and formally accepted (Direction Episodes Phase-3) before the green light. The decider daemon
  (`decider.js`) went live fleet-wide for the first time, feeding a role-less racer for the first
  time (the `#88` closing condition).
- **Run #3 → #4 window**: all three of team-lead's gates cleared, though the paralysis gate was
  explicitly amended down to its REFLEX-release half — eng-3 shipped and live-verified a fix
  requiring a sustained idle-panic window AND zero health loss before `REFLEX` stands down, while
  the generalized surface-stranding escape (finding 1) was deliberately left open as ongoing
  engineering rather than a race gate, on team-lead's reasoning that holding races hostage to every
  open issue inverts the benchmark's purpose. Survival v8 (carrying both `#94`'s corner-step fix and
  the `#97` finding-3 fix) landed in time for run #4's spawn. The cobble-vanish mystery got its named
  cause: ~2 real `WALL_OFF` seal attempts earlier in the same run #3 encounter legitimately consumed
  it, confirmed independently by two engineers from the ledger — no inventory leak, race records
  stay trustworthy.
- **Run #4 → #5 window (in progress)**: run #4 surfaced `#99`, a NEW bug worse in scope than `#97` —
  survival's standalone `HP < 8` entry condition re-fires indefinitely with zero mob involvement
  once food drops below the 18-point regen floor and no cobblestone is on hand, and because
  `panic_enter` cancels the active task every cycle, not even the objectively-correct driver
  response (`huntAnimals`) could survive long enough to fix the trigger. Team-lead redirected the
  fix to engine-dev (not eng-3 — survival.js is engine-dev's lane), since `#96` (the zero-defense
  routing gap `#97` first exposed in run #3) and `#99` turn out to be the same code region: `#99` is
  the entry-gate half of the combined fix engine-dev is now building. Run #5 holds for that combined
  fix to land.

### The recurring measurement bug, across three separate runs

The exact same mistake — a real-time hand tally of `setProject` calls undercounting the ledger's
true count by one — happened in **run #0** (corrected 3→…→5), **run #1** (corrected 6→7, caught by
engine-dev's ledger audit), and **run #2** (hand-tally recorded "6," and `bench/gearrace.mjs`'s own
auto-generated block four lines below it in this very file shows 7 setProject + 3 other = 10 —
**a discrepancy this retrospective is the first to point out; run #2's record was never
reconciled**). Only in **run #3** was the ledger treated as ground truth from the start, with the
driver's own contribution stated as a self-flagged subset (4 of 19 calls) rather than a competing
count. That is a genuine, measurable improvement in this program's own discipline, independent of
anything the bots did — three strikes were needed before the lesson ("hand-counting while also
driving and diagnosing is exactly the kind of bookkeeping an instrument should own," first written
after run #1) actually stuck in practice.

### The honest trend line

**Tier progress is flat, not declining: 0 of 4 comparable runs have ever reached the stone
pickaxe.** Every run stalls at the exact same structural transition — leaving the safety of the
initial wood/tool bootstrap for the first excursion or underground project, where kit gates,
threat response, and inventory interact in ways the wood-tier bootstrap never exercises. Each run
has found a **genuinely different** way to die there: an unroutable food shortfall compounded by a
sealed pocket (run #1), a heal-deadlock with no can-I-actually-heal check (run #2), a death cascade
into a respawn-point relocation accident with no legal recovery skill (run #3), and now a
threat-independent internal panic loop that no legal driver action could outrun (run #4). That is
"dying differently," not "dying deeper" — the tier needle has not moved, but the failure catalog
keeps growing, and every entry in it has shipped (or is actively shipping) a real, tested fix.
**Survival time to the fatal event is not trending either — it is noisy and scenario-dependent**
(43 min, then 80 min, then 28.5 min, then **7 min** for run #4) — run #4's near-instant DNF isn't a
regression in engine quality, it's a bug that happens to strike earlier the closer to spawn a bot
takes any damage at all, which is structurally almost immediate.

**The one clean, unambiguous bright number, and team-lead's framing for it**: wood-tier bootstrap
keeps getting FASTER even as survival's edge cases keep getting caught earlier and earlier — run #4
hit the wooden pickaxe in **59 seconds**, tying run #1's clean baseline and beating every run in
between (2m17s, 3m42s). The engine's core acquisition plumbing (gather → craft → equip, from a
stone-cold empty inventory) is not just solid, it is still improving. **That contrast — the
plumbing getting faster while survival's edge cases keep killing racers — is this program's current
story**, not a simple pass/fail on tier progress. What IS trending cleanly on the process side:
**driver steering calls that represent genuine indecision are dropping** (run #1 needed a human to
manually invent the food→hunt branch from scratch; run #2 closed the same branch in under 5 minutes
once known; run #3's decider closed 4 of 5 stall episodes with zero driver involvement; run #4 took
exactly 2 steering calls total, both objectively correct for their moment — the ceiling on "how good
can the decision be" was reached, and the run still died, because the bug lived below the layer any
`setProject` call can reach) and **the fix-and-close loop is unbroken**: every DNF has produced a
GitHub issue, and twice now (of two opportunities) a live specimen handoff has produced a new,
load-bearing engine capability rather than just a bug report, with a third (`#99`/`#96`, engine-dev's
combined fix) in progress right now. The benchmark is doing exactly what a good one should: it has
never yet produced a diamond pickaxe, and it has never once failed to teach the engine something it
didn't know before the run started — run #4 taught it something the other three hadn't even
suggested was possible.



### Run #4 — SabberSepp, 127.0.0.1:25600 (`world-race4`, fresh, same seed) — LIVE, green-lit after all three gates cleared

Gates cleared per team-lead's ruling (amended same day): (a) REFLEX-release fix shipped and
live-verified by engine-dev-3 (`#97` finding 3 — REFLEX now requires a sustained idle-panic window
AND zero health loss during it before standing down; amended to satisfy the gate alone, the
generalized surface-stranding escape stays open as ongoing engineering, not a race gate); (b)
survival v8 aboard at spawn (carries `#94`'s corner-step fix, confirmed in payload versions below);
(c) the cobble-vanish mystery traced and named — ~2 real WALL_OFF seal attempts earlier in the same
encounter legitimately consumed it, independently confirmed by both engineers from the ledger, no
inventory leak. Prep: `world-race3` server SIGTERM'd cleanly, `level-name` swapped to `world-race4`,
restarted — fresh world in 2.376s, seed unchanged (`felcrewtest`); `world-race3` archived,
never deleted. Fresh never-used name `SabberSepp` (checked against `pids/*.meta`, both usercaches,
`logs/*.log`), spawned `OWNER=test-driver PURPOSE="gear-race run #4, world-race4, full current
stack"`, `./list.sh` run before and after.

**Known advisory going in, added to the race book same day**: `#96` field-confirmed fatal — melee
attacker + HP<6 + no filler blocks = zero-defense routing gap (exactly what killed RotzRudi 3x in
run #3). Fix in progress, NOT aboard this racer. Branch: treat low filler + melee threat present as
an early warning and disengage proactively; if it kills this racer anyway, attribution is
pre-written and the run still measures everything else.

Engine versions at run start: skills **v59**, agenda **v25**, survival **v8** (carries `#94`
corner-step fix and `#97` finding-3 REFLEX-release fix — first race run with both), dangerscan v5,
digguard v5, toolguard v2, producer v7, digchain v1, graychat v5, reachguard v1 (idleguard off,
panicguard off — both subsumed) — all exactly matching the expected v59/v25/v8 stack. Bot confirmed
empty/never-used before spawn.

| Tier | Time from join | Notes |
|---|---|---|
| Join | T+0 (20:29:34) | fresh spawn, empty inventory confirmed, position (-4.5, 105, -8.5), health 20/20, food 20/20, role:null |
| Wooden pickaxe | T+59s (20:30:33) | `Tool ready: wooden_pickaxe (crafted)` — fastest bootstrap of any race run yet, DESPITE a zombie death at T+29s (20:30:03) mid-bootstrap. Kit was still empty at that point (`No cobble to wall in with` fired twice, 20:29:53 and 20:30:20) — exactly the `#96` zero-defense pattern, but this time survival's `#97`-fixed REFLEX held a clean recovery instead of chaining into repeat deaths. One death so far, HP stable at 7.67/20 post-respawn (food 17, one below the natural-regen threshold, so no change expected without eating), position holding — reads as the designed post-death REFLEX hold, not yet a stall (no direction episode opened, ticks climbing normally). Watching before considering any intervention; role this run is reduced by design. |
| Stone pickaxe | pending | — |
| Iron pickaxe | pending | — |
| Diamond pickaxe | pending | — |

Steering calls: 1 — (1) initial `setProject({skill:'mineLane',args:{target:'stone',count:16}})` at
20:29:45, clean on the first attempt (no shape error this time). Deaths: 1 so far (Zombie, T+29s,
kit-empty — the `#96` pattern firing before any tool even existed, earliest possible onset).
Monitor armed: same 15s `/state` poll (IDLE-while-project-set, `needs_direction`, kit `blocked`,
low-HP) plus real-time `server.log` tail for SabberSepp. Baselines to beat: run #1 (v50) wood
1m00s/DNF-stone, run #2 (v55) wood-only/DNF heal-deadlock, run #3 (v58) wood 3m42s/DNF
elevated-platform-stranding. Watching for: whether `#97`'s REFLEX fix holds up under a REAL early
zombie encounter (not a stubbed test), and whether the `#96` zero-defense gap claims this racer too.

### Run (auto) — 2026-09-02 18:36 — SabberSepp, /home/felix/minecraft/localserver-race

Generated by `bench/gearrace.mjs`. Engine versions: engine version unknown (bot not reachable for GET /state). Run may still be in progress at generation time.

| Tier | Time from join | Source |
|---|---|---|
| Wooden pickaxe | 0m59s | log:Tool ready |
| Stone pickaxe | DNF | DNF -- see notes below |
| Iron pickaxe | DNF | DNF |
| Diamond pickaxe | DNF | DNF |

Steering calls: 7 (2 setProject, 5 other /eval). Deaths: 1.

DNF context (stone_pickaxe): `[+107s] [Not Secure] <SabberSepp> No cobble to wall in with. Kit rule broken - heading out the way I came.`; `[+167s] [Not Secure] <SabberSepp> No cobble to wall in with. Kit rule broken - heading out the way I came.`; `[+227s] [Not Secure] <SabberSepp> No cobble to wall in with. Kit rule broken - heading out the way I came.`; `[+229s] [Not Secure] <SabberSepp> failed: ensureTool — could not acquire sword: tier:payable:wooden_sword | depot:minerals:none | depot:wood:none | planks:3 | craft:no craft`; `[+287s] [Not Secure] <SabberSepp> No cobble to wall in with. Kit rule broken - heading out the way I came.`; `[+347s] [Not Secure] <SabberSepp> No cobble to wall in with. Kit rule broken - heading out the way I came.`


**OFFICIAL CONCLUSION — DEAD RACE = DEAD STOP invoked by test-driver, 2026-09-02 ~20:36, no
lead approval sought per the law's own terms.** Escalated to team-lead/engine-dev-3 as an urgent
finding before formally concluding, since this appeared live-diagnosable and possibly fleet-wide
in scope — not held back for the full 5-minute confirmation window once the cause was airtight.

**Cause chain (new, more severe than run #3's `#97`, filed as `#97`'s neighbor `#99`):** (1) an
early Zombie death at T+29s (20:30:03), before any kit existed at all — the earliest possible onset
of the `#96` zero-defense pattern team-lead flagged going into this run. (2) Post-respawn, HP
settled at 7.67/20 with food at 17 — one point below the 18 needed for natural regeneration — and
zero cobblestone for `WALL_OFF`'s filler requirement. (3) From that point, `survival.js`'s
standalone `HP < 8` panic-entry condition re-fired **continuously and indefinitely, with no mob
involved at all** — confirmed directly from the log: `danger.score` 0, `danger.state` `"calm"`,
`threats:[]`, and the line `"danger panic (0): no visible threat"` immediately followed by
`"panic_enter (danger) hp=8 threat=no visible threat"`, repeating. `survival.fires` measured 395 at
one check and 1107 roughly three minutes later — accelerating, not stabilizing. (4) Because
`panic_enter` calls `stop()` on the active task at this frequency, **no task could ever run long
enough to complete** — including the correct fix. I diagnosed this within the 60s SLO and issued
`setProject(huntAnimals,{anyMob:true,radius:32,repeat:true})` — the textbook race-book response —
and it DID work partially: `ensureTool` crafted a wooden sword and the bot moved for the first time
since the loop began. But the hunt itself never completed a kill; every attempt got cancelled by
the panic loop before it could finish, so food was never acquired and the trigger condition never
cleared. **This is a genuine catch-22 with no legal `setProject`-only recovery**: the fix for the
trigger (food, to eventually let hunger clear 18 and HP regen past 8) requires uninterrupted task
time that the trigger itself continuously denies.

**Final table: wooden pickaxe only, T+59s (20:30:33) — the fastest bootstrap of any race run yet,
completed only moments after the death that triggered this entire incident.** Stone/iron/diamond:
DNF. Deaths: 1. Total run time to conclusion: **~7 minutes** of the 90-min cap — by far the
shortest-lived race yet, and unlike runs #1-#3 the DNF here has nothing to do with resource
scarcity, geometry, or an unresolved combat encounter: it is a pure engine-internal loop that a
perfectly-diagnosed, perfectly-timed, textbook-correct driver response could not outrun. **Steering
calls: 2 (ledger-verified via `gearrace.mjs`)** — (1) opening `mineLane{target:stone,count:16}` at
20:29:45, clean; (2) `huntAnimals{anyMob:true,radius:32,repeat:true}` redirect at ~20:33:41 the
moment the `unproductive_idle` episode + my own diagnosis converged. Both calls were the objectively
correct call for their moment; neither could have prevented or escaped the underlying bug. Ledger
also recorded 5 non-`setProject` `/eval` calls — **2 are mine** (`task.sh status` reads, both purely
diagnostic, zero mutation), the remainder attributable to the decider's own dispatch/registry-check
traffic (it briefly tried `chopTrees` as its default idle-filler mid-incident, which — like
`huntAnimals` — could never have completed either, for the same reason).

**Filed as `felsenuboot/felcrew-mcp#99`**, distinct from but more severe in scope than `#97`: this
bug needs no freak respawn geometry and no persistent attacker, only one early sub-8-HP hit with no
food/cobble on hand, which is close to guaranteed at the very start of ANY fresh spawn — race bot or
otherwise. Proposed fixes center on extending `#92`'s "cannot-heal" concept to also suppress
**re-entry** into panic (not just enable exit), since this run never hung in one continuous
`WALL_OFF` — it exited cleanly on every single cycle and immediately re-entered — plus a cooldown on
`panic_enter` when the preceding diagnosis is unchanged, and a grace window for an already-legitimate
in-flight recovery task (like a driver-issued `huntAnimals`) to actually finish.

`SabberSepp` process left running (not stopped) — still actively thrashing at the moment of writing,
offered to engine-dev-3 as a live, real-time-reproducing specimen (arguably a better diagnostic
target than a quiet stranded bot, since the bug is happening continuously rather than needing to be
provoked again). World-race4 stays up; no new race run starts on this server until `#99` is
addressed or a considered decision is made to race around it.

### Run #5 — BruzzelBruno, 127.0.0.1:25600 (`world-race5`, fresh, same seed) — LIVE, post-#96/#99 zero-defense floor

Green-lit after the combined `#96`+`#99` fix landed and was confirmed live: survival **v9**
(commit 5999820, "zero defense is no longer representable in pick()'s routing") — eng-3 diagnosed
and fixed `#99`'s specific mechanism (WALL_OFF's no-filler bail never armed standdown), engine-dev
shipped the combined fix folding both `#96` and `#99` into one change, and both were confirmed via
git diff/grep plus live organic recovery on the `#99` specimen (SabberSepp: HP climbed off its
7.67 floor back to double digits, food climbing, back to normal RESTOCK/chopTrees, no driver
action). `SabberSepp` then stopped as part of this run's pre-launch `./list.sh` sweep — specimen
duty done, no-loiter. Prep: `world-race4` server SIGTERM'd cleanly, `level-name` swapped to
`world-race5`, restarted — fresh world in 3.852s, seed unchanged (`felcrewtest`); `world-race4`
archived, never deleted. Fresh never-used name `BruzzelBruno` (checked against `pids/*.meta`, both
usercaches, `logs/*.log`), spawned `OWNER=test-driver PURPOSE="gear-race run #5, world-race5,
post-#96/#99-fix zero-defense floor"`, `./list.sh` run before and after.

**Race book notes for this era (team-lead, 2026-09-02)**: the zero-defense floor is now real —
`FIGHT_BACK` kills things, `FLEE_AWAY` is always available — so the panic-thrash (`#99`) and
heal-deadlock (`#92`) failure classes should both be dead. One known noise pattern to NOT
mistake for a new thrash: **`#100`**, post-victory `WALL_OFF` chat spam while HP regens after a
fight is won — annoying, not lethal, self-resolves as HP climbs.

**The wall to beat: no run has ever crafted a stone pickaxe.** Five predecessors (runs #1-#4) died
at the wood→stone transition to five different causes, all five now fixed. If run #5 breaks the
wall, it makes history; if it doesn't, the next cause gets a name (`#101`+).

Engine versions at run start: skills **v59**, agenda **v25**, survival **v9** (first race run with
the combined `#96`/`#99` fix), dangerscan v5, digguard v5, toolguard v2, producer v7, digchain v1,
graychat v5, reachguard v1 (idleguard off, panicguard off — both subsumed) — all exactly matching
the expected stack, no surprises. Bot confirmed empty/never-used before spawn.

| Tier | Time from join | Notes |
|---|---|---|
| Join | T+0 (20:56:30) | fresh spawn, empty inventory confirmed, position (9.5, 90, -3.5), health 20/20, food 20/20, role:null |
| Wooden pickaxe | pending | — |
| Stone pickaxe | pending — **the wall** | — |
| Iron pickaxe | pending | — |
| Diamond pickaxe | pending | — |

Steering calls: 1 — (1) initial `setProject({skill:'mineLane',args:{target:'stone',count:16}})` at
20:56:42, clean on the first attempt. Deaths: 0 so far. Monitor armed: same 15s `/state` poll
(IDLE-while-project-set, `needs_direction`, kit `blocked`, low-HP) plus real-time `server.log` tail
for BruzzelBruno, tuned to not mistake `#100`'s post-victory WALL_OFF chatter for a new thrash.
Baselines to beat: run #1 (v50) wood 1m00s, run #2 (v55) wood-only, run #3 (v58) wood 3m42s, run #4
(v59/survival v8) wood **T+59s** (the fastest-ever bar to match or beat) — all four DNF before
stone. Watching for: whether the zero-defense floor actually holds under a real combat encounter,
and whether this is the run that finally crosses the wood→stone wall.

### Run (auto) — 2026-09-02 19:11 — BruzzelBruno, /home/felix/minecraft/localserver-race

Generated by `bench/gearrace.mjs`. Engine versions: engine version unknown (bot not reachable for GET /state). Run may still be in progress at generation time.

| Tier | Time from join | Source |
|---|---|---|
| Wooden pickaxe | 7m25s | log:Tool ready |
| Stone pickaxe | DNF | DNF -- see notes below |
| Iron pickaxe | DNF | DNF |
| Diamond pickaxe | DNF | DNF |

Steering calls: 4 (1 setProject, 3 other /eval). Deaths: 1.

DNF context (stone_pickaxe): `[+640s] [Not Secure] <BruzzelBruno> Drop sweep done: picked up 5 drops.`; `[+661s] [Not Secure] <BruzzelBruno> Produced 16 stick (crafted).`; `[+747s] [Not Secure] <BruzzelBruno> No wall, no room to run clean - fighting back.`; `[+750s] [Not Secure] <BruzzelBruno> Nothing left to fight or wall off with - running for it.`; `[+767s] BruzzelBruno has made the advancement [Stone Age]`; `[+768s] [Not Secure] <BruzzelBruno> Walling myself in to patch up. Back shortly.`


**OFFICIAL CONCLUSION — SUSPENDED, operator wind-down (Felix, via team-lead), 2026-09-02 ~21:11.
NOT A DNF: no cause-of-death, no dead-end, no engine failure diagnosed — the run was still
progressing normally when it was stopped from outside the race.** Recorded factually, state-at-stop
only, per team-lead's explicit instruction that a suspended run is not comparable data and must
never be read as a sixth entry in the wood→stone wall tally.

**State at stop**: wooden pickaxe reached T+7m25s (21:03:55, clean, `Tool ready` log-confirmed and
ledger-corroborated); wooden sword T+9m09s (21:05:39); kit self-provisioning underway (16 sticks
produced, drop sweep clean) when a real combat encounter hit at ~T+12m27s (21:08:57) — the new
`#96` zero-defense floor engaged for the first time in any race run: `FIGHT_BACK` (`"No wall, no
room to run clean - fighting back."`), then `FLEE_AWAY` (`"Nothing left to fight or wall off with -
running for it."`), then `WALL_OFF` (`"Walling myself in to patch up. Back shortly."`) — a full,
working escalation ladder, not a single dead-end branch. **The bot still died** (Zombie, 21:09:21,
one death total) despite every rung of the new floor firing correctly — worth recording plainly:
the fix makes zero-defense representable and gives the bot real options, it does not make the bot
unkillable, and this run's one death is a genuine, undiagnosed-as-a-bug combat loss, not evidence
against `#96`. `Stone Age` advancement fired at 21:09:17 (wooden pickaxe used to mine stone,
confirming real progress toward the stone tier moments before the fatal encounter). Post-death:
clean respawn, HP/food full, agenda cleared to `IDLE`/no-project (same "death clears project"
pattern as every prior run) and sat there — no re-arm was issued before the wind-down order arrived.
**Notable engine moment, unprompted**: `#97`'s frozen-repeat dedup fix (the decider restart eng-3
announced mid-run) fired for real for the first time — episode `dmtkgov381` (`project_stalled` on
the opening `mineLane`, frozen at one position for 85+ seconds) closed via `dirClose(...,
'frozen_repeat')` rather than repeating forever, and the project recovered and resumed making
progress immediately after. Pure upside, exactly as advertised.

**Ledger-verified (`gearrace.mjs`, labeled DNF by the tool's own vocabulary — read as SUSPENDED per
the note above, not as a sixth wall attempt): wooden pickaxe 7m25s, stone/iron/diamond not reached
at time of stop. Steering calls: 4 total, 1 `setProject`** (the opening `mineLane`) **+ 3 other
`/eval`** — of these, likely **0-1 are mine** (a single read-only inventory check made right at
wind-down time, which may or may not fall inside this snapshot's window) and the rest are the
decider's own registry-check + the `dirClose` frozen-repeat fix described above — ENGINE
attribution, not driver steering, per this era's accounting rules. **Deaths: 1** (Zombie, organic,
zero-defense floor engaged correctly but did not prevent the loss).

`BruzzelBruno` process stopped cleanly (confirmed via disconnect log + `/state` unreachable).
World-race5 left as-is (not deleted, per the standing archive law) but the server itself was not
separately torn down as part of this specific instruction — team-lead's wind-down covers the
fleet broadly; flagging in case the race server also needs a stop as part of the wider order.

**Retrospective note**: this run does NOT get a column in the runs #0-#4 comparison table above —
a suspended run with no cause-of-death is not comparable data and would corrupt the DNF-cause /
survival-time trend analysis. It is recorded here, in full, as a footnote to the program's history
(and specifically as the first live confirmation that both the `#96` zero-defense floor and `#97`'s
dedup fix work as designed), but the "0 of N runs have ever reached stone pickaxe" tally in the
retrospective still reads **0 of 4** (runs #1-#4), not 5 — run #5 neither passed nor failed that
test, it was called before the test could finish.

### Race book v2 (test-driver, night shift, 2026-09-02) — supersedes v1 for run #6 onward

Written during the night-shift hold, before run #6's green light, per team-lead's instruction to fold
run #5's learnings in and sharpen the branch plans while there is time to think rather than react.
v1 (above) stays intact as history — every past run's record still refers to what v1 said at the time
it raced. v2 changes because the ground under it changed: two of v1's failure classes (`#96`
zero-defense, `#100` post-victory spam) are now **proven fixed, live**, not just shipped; a third
class (frozen-repeat dedup) turned out to need zero driver branch at all; and two NEW failure classes
surfaced in soak #3 that neither v1 nor any prior race run ever saw, because they live in the exact
kit-assembly phase every past run either sailed through cleanly or never got back to. This book is
written for a run #6 that launches onto an ENGINE where both of tonight's incoming fixes have landed
(the standing hold, unchanged) — the branches below are the fallback if a fix is incomplete or a
same-shaped wedge slips past it, not an assumption that today's wall-causes are still fully open.

**What run #5 actually proved, stated plainly:**
- The `#96` zero-defense floor is a real, working escalation ladder under live combat, not a paper
  fix: `FIGHT_BACK` → `FLEE_AWAY` → `WALL_OFF` all fired in sequence against a genuine zombie, each
  handing off to the next rather than dead-ending. **The bot still died.** That is not a regression
  or a hole in `#96` — it is the honest ceiling of "the bot can now always try something," which is a
  different guarantee from "the bot now always survives." Run #6's branch plans below assume the
  floor works and do not need a proactive-disengagement branch for it anymore (v1's old "filler low +
  melee threat" early-warning branch is RETIRED, not deleted — see below).
- `#100`'s predicate-keyed standdown (survival v10, landed and fixture-verified THIS session, after
  run #5 concluded) should make the post-victory `WALL_OFF` chat-spam signature disappear entirely.
  v1/run #5's framing of it as "noise to not mistake for a new thrash" is now the WRONG framing for
  run #6 — if that spam reappears, treat it as a regression finding, not expected texture.
- The decider's frozen-repeat dedup closed a genuinely frozen `mineLane` episode (`dmtkgov381`, 85+s
  at one position) via `dirClose(..., 'frozen_repeat')` with **zero driver involvement**, and the
  project resumed making progress right after. This needed no branch in v1 and needs none in v2 —
  recorded here only so its absence from the branch list below isn't mistaken for an oversight.
- New timing datum worth tracking going forward: wooden sword crafted at **T+9m09s**, about 3m18s
  after the fatal encounter's zombie first engaged relative to... actually, precisely: sword at
  T+9m09s (21:05:39), fatal encounter at T+12m27s (21:08:57) — roughly 3m18s of combat-readiness
  before the test came. Not enough data points yet to say whether earlier sword acquisition
  correlates with surviving the first real encounter, but run #6 should log this same timestamp so a
  trend becomes checkable after 2-3 more comparable runs.
- Suspended-run bookkeeping pattern (worth repeating if tonight ends the same way): state-at-stop
  recorded in full, ledger numbers cross-checked against the driver's own tally, explicit "does NOT
  get a column in the comparison table" footnote, tally language stays "0 of N" over the comparable
  runs only. If run #6 is ever suspended rather than concluded, follow this exact shape again.

**Trigger table** (unchanged in mechanics from v1 — reproduced here so v2 is a complete, standalone
reference and a driver never has to flip back to v1 mid-race):

| Trigger | Project to set | Notes |
|---|---|---|
| Spawn | `mineLane{target:'stone',count:16}` | bootstraps the wooden pickaxe from nothing; fastest-ever bar is run #4's T+59s |
| Wooden pickaxe confirmed | no change — let it keep mining | stone pickaxe follows automatically once kit + cobblestone stack up; do not re-issue |
| Stone pickaxe confirmed | `mineLane{target:'iron_ore',maxDist:48}` (safeDescend to y30 first if `not_found`) | never yet reached live — this row is still theoretical for this program |
| Iron pickaxe confirmed | `safeDescend{toY:-30}` then `mineLane{target:'diamond_ore',maxDist:48}` | crosses into `deep` kit tier; expect a `kit_missing` pause while RESTOCK self-provisions |
| Diamond pickaxe OR 90-min cap | STOP, record final table | `Tool ready: diamond_pickaxe` only — the `Isn't It Iron Pick?` mapping dispute is still unresolved, don't use it to call this |

**Known-failure branch plans for run #6, in the order a driver is likely to meet them:**

- **Food/kit refusal** — unchanged from v1, now largely a backstop rather than the primary path: the
  decider handles this via `rules.json`/Andy for a role-less racer as of run #3 onward (closing
  `#88`). Keep the manual fallback armed anyway — `setProject(huntAnimals{anyMob:true,radius:32,
  repeat:true})`, falling back to `harvestGrass{repeat:true}` only if genuinely no fauna — in case
  the decider is down or its dispatch is refused for this specific bot.
- **Barren search** (2 identical `gather:X(0/N reached)`/`not_found` in a row) — unchanged: reposition
  30-50 blocks before re-trying the same target, per the 60s SLO.
- **Sealed pocket / no path** — unchanged: the ESCAPE rung (v21+) should auto-route an underground
  path-blocked project to `ascendToSurface` now; two manual `come` attempts max before treating as
  exhausted, same as v1.
- **Tool breaking** — unchanged: no action, TOOL rung reacquires automatically.
- **IDLE rung while a project exists and tiers remain** — unchanged: always an alarm, check
  `agenda.blocked` and the log tail immediately.
- **DEAD RACE = DEAD STOP** — unchanged, the universal backstop: 5 straight dead minutes (position
  flat AND inventory flat AND no yield), diagnosed cause, no legal recovery path = conclude
  immediately, no lead approval needed.
- **Zero-defense combination (v1's melee-threat early-warning branch) — RETIRED for run #6.** `#96`
  and `#100` are both proven live (run #5, this session's v10 fixture pass). A racer with low filler
  and a melee threat present now has a real, working escalation ladder on its own; proactively
  steering the bot away pre-empts survival's own designed response rather than complementing it. Do
  not treat low-filler-plus-melee as an alarm requiring a driver `come` anymore — only intervene if
  the ladder demonstrably fails to progress (WALL_OFF looping with no exit — itself now a `#100`
  regression signal, see above) rather than on the mere combination existing.

- **NEW — Combat-loss-at-night branch (argued, the team-lead's specific ask).** Run #5 died once,
  organically, to a zombie, with the full `#96` ladder firing correctly and still losing. Post-death,
  the record shows a real, load-bearing gap: clean respawn, HP/food full, but `agenda` cleared to
  `IDLE`/no-project and **sat there** — nothing in the engine re-arms a project after death, and
  vanilla drops the bot's full inventory on death (confirmed independently in run #3: three deaths,
  three inventory wipes). A `/state` snapshot of a bot that died and was never re-armed looks
  identical, at a glance, to one that is calmly waiting between two legitimate task phases — both
  show `task:null`, `hp:20/20`, calm. That ambiguity is the actual danger, more than the death itself.
  Argued response, in order:
  1. **Detect the death precisely, don't infer it.** The server-log death line
     (`<Bot> was slain by/shot by/blown up by ...`) is the primary, unambiguous signal — cross-check
     against `/state` showing health/food freshly reset to 20/20 within the following ~5-10s (vanilla
     respawn is near-instant), not the mere absence of a project, which is also the post-victory-calm
     state and would false-positive constantly if used alone.
  2. **Do not blindly re-issue the pre-death project.** Death likely erased the tool tier that
     project assumed. Take one read-only inventory check (`list-inventory`, or `/state`'s inventory
     summary if it carries one) to establish the ACTUAL current tier before deciding what to set.
  3. **Default action: re-arm from the bottom**, exactly like a fresh spawn —
     `mineLane{target:'stone',count:16}` — since the TOOL rung bootstraps wood regardless of what tier
     the bot held a moment ago, and the inventory check will almost always show empty-handed after a
     real death. Do not try to "resume" a stone/iron project the bot no longer has the tools to
     pursue; that just re-triggers the same kit-gate refusals runs #1-#2 already catalogued.
  4. **A corpse-recovery detour is a judgment call only, not the default.** Vanilla drops persist
     briefly (5 min default) at the death coordinates. No skill in the registry today walks back to a
     bot's own death location to loot it, and improvising one via a driver `come` costs race time for
     an unconfirmed payoff (the drops may already be gone, or off the direct path back into the
     bootstrap anyway). Only worth trying if the death coordinates are provably close (rough rule of
     thumb: under ~15-20 blocks) to wherever the bot will naturally end up re-bootstrapping regardless
     — otherwise, skip it and re-arm per step 3 immediately.
  5. **Log the death-to-re-arm gap as its own timed interval**, the same discipline already applied to
     idle-gaps and episode latencies elsewhere in this file — this makes post-death recovery latency a
     real, comparable number across future runs instead of an unrecorded artifact buried in a death
     count.
  6. **Flag the underlying gap, don't just patch around it every time.** Unlike food-routing (`#88`,
     closed via the decider) or frozen-repeat (closed via `dirClose`), there is no engine-side
     auto-recovery today for "agenda went IDLE with no project shortly after a death line." **Filed as
     `felsenuboot/felcrew-mcp#103`** (test-driver, night shift): a death/respawn is the purest possible
     `needs_direction` moment there is (the payload-stack re-run on respawn — `runner.js`'s own
     `bot.on('spawn')`/`bot.on('death')` hooks — already clears the project directly, not inferred),
     so the proposed fix is a new episode `why` (e.g. `respawned`) opened right from that hook,
     alongside `project_done`/`project_blocked`/`no_tool`/`unproductive_idle`/`project_stalled`, rather
     than waiting for the slow generic idle window to eventually notice. Same fix shape as `#88`,
     applied to death instead of hunger. Owner: agenda.js lane (engine-dev-3), later — this manual
     branch stays armed for run #6 regardless of when it lands.

- **NEW — Wood→stone transition plan against the wall (argued).** The wall (0 of 4 comparable runs
  have ever reached stone) has never been broken by resource scarcity, heal-deadlock, or
  threat-independent panic anymore — every previously-named cause at this exact transition is fixed
  (`#88`, `#92`, `#96`, `#97` partial, `#99`, `#100`). Two NEW candidate causes are live as of
  tonight's soak #3 (1.5% success rate, `wedge:89` of 271 outcomes, in precisely this kit-assembly
  phase) and are what tonight's fix wave targets before run #6 launches:
  1. **Standard open, unchanged**: `mineLane{target:'stone',count:16}` at spawn; let RESTOCK/TOOL
     self-provision without interference. Normal `kit_missing` narrowing, spare-pickaxe crafts, and
     torch production are the SAME early phase every prior run passed cleanly — not a trigger.
  2. **WATCH signature — table-placement wedge (`#101` shape).** Log/status text matching `craft:no
     crafting table in reach and could not place one (already holding one — not re-crafting)`,
     repeating more than twice from an UNCHANGED position, is a placement problem, not a search
     problem — no `setProject` retries the identical action differently. Legal lever: `come` 20-30
     blocks off in any open direction, forcing RESTOCK to re-enter from new terrain and giving
     `placeCarriedTable`'s candidate search (already confirmed clean by read-only replay in
     FEEDBACK.md) a genuinely different floor to try. **If tonight's fix is aboard at launch, this
     signature should not appear at all** — if it does anyway, flag it to engine-dev immediately as a
     fix-didn't-cover-it finding, not a routine branch execution.
  3. **WATCH signature — frozen movement wedge (R2 shape).** Position genuinely flat (zero net
     displacement, not "retrying near a point") for 60-90+ seconds while `agenda` still reports a live
     project (not `IDLE`) is the early tell — this is what soak #3's `recoveries:0`-for-an-hour looks
     like from `/state` alone. Do not wait for the 5-minute DEAD RACE threshold to act: one `come` to
     a coordinate 15-25 blocks off, in an open, previously-unvisited direction, is a cheap, legal first
     attempt. The historical natural firing (documented in FEEDBACK.md) shows genuine displacement,
     however small, is what let a fresh A* finally find a route after 9+ minutes of in-place failures
     — a driver-forced reposition may substitute for R2's own internal retries faster than waiting them
     out. If position stays flat even after the driver's own `come`, that meets DEAD RACE = DEAD
     STOP's diagnosed-cause bar — cite the R2 wedge by name; it is a documented, named failure mode
     now, not a mystery requiring a fresh investigation before concluding.
  4. **Tier-cross confirmation**: `Tool ready: stone_pickaxe` or `Getting an Upgrade` is the
     tier-clearing signal, unchanged from v1. The moment either fires is the first stone pickaxe in
     this program's history — record the exact timestamp, full engine version stamp, and steering-call
     tally to that point as its own headline entry before continuing toward iron, regardless of how
     the rest of the run goes.

**Pre-launch checklist for run #6 (unchanged shape from v1, gates updated):** (1) confirm with
engine-dev-3 that the R2-wedge fix has landed and been verified, not just committed; (2) confirm with
engine-dev that `#101`'s craftToolChain fix has landed; (3) confirm soak #4's verdict is non-catastrophic
(or that team-lead has explicitly waived it) — do not launch into an un-soaked engine without that
explicit sign-off; (4) swap `localserver-race/server.properties`'s `level-name` to `world-race6`
(fresh, never-used) and restart 25600 (~60-90s regen), leaving `world-race5` on disk as an archive per
the standing law; (5) fresh never-used bot name, `OWNER=test-driver PURPOSE=...` env vars, `./list.sh`
before and after spawn, `gearrace.mjs` as recorder of record from the start. Nothing on this list is
done yet — standing by for team-lead's green light.

### Run #6 — GammelGerhard, 127.0.0.1:25600 (`world-race6`, fresh, same seed) — PREP, HOLD for green light

Prep done during the post-wind-down respawn (test-driver, 2026-09-02), ahead of soak #4's verdict
per team-lead's queue order (soak #4 first, run #6 launches after unless told otherwise). Flying
**Race book v2** (this file, immediately above) — v1 is superseded for this run.

Fresh never-used crude name reserved: **GammelGerhard** (checked against `pids/*.meta`, both
`usercache.json`s at `~/minecraft/localserver` and `~/minecraft/localserver-race`, and `logs/*.log` — clean on all
three). **Renamed 2026-09-03 from the original reservation `MuffelManfred`** — team-lead ruling: two
`*Manfred`s live at once (soak #4's `MampfManfred` on 3160/25599, run #6's on 3161/25600) is exactly
the shared-log misread risk it looks like, and names are free to change before spawn. `GammelGerhard`
differs from `MampfManfred` in both first letter and ending, no phonetic overlap; re-verified clean
against the same three sources at rename time.

Race server `127.0.0.1:25600` confirmed DOWN at prep time (2026-09-02, post-wind-down check) — will
be brought up at launch time per the standing recipe (`level-name` swapped to `world-race6`, fresh
regen, `world-race5` left on disk as archive, never touched).

Pre-launch checklist status (v2's list, corrected per team-lead ruling 2026-09-02 — v2's text above
predates two closures): (1) R2-wedge fix gate — **MOOT, not a gate**. R2 was EXONERATED (FEEDBACK
`edeb3e3`): it did its one job correctly every firing; the stall was destination-unreachability one
level up, already covered by `#95` + `#97`-item-3, both field-confirmed. Nothing to wait for here.
(2) `#101` craftToolChain fix — **LANDED and lead-ACCEPTED** (`cd30f4c`, fixture 10/10 at the real
pillar geometry, preflight 203/203). Live confirmation already in hand, no further engine-dev
sign-off needed. (3) soak #4 verdict non-catastrophic or explicitly waived — **the only remaining
gate as of 2026-09-03** (the food-acquisition gate that briefly stood alongside it, see below, is
now closed), PENDING, soak #4 not yet concluded. (4) world-race6 swap/regen — NOT DONE YET (do at
launch); (5) fresh name reserved
(`GammelGerhard`), `OWNER=test-driver PURPOSE=...` ready to set, `./list.sh` discipline and
`gearrace.mjs` as recorder of record — ready to execute at green light.

**2026-09-03 gate added (team-lead)**: soak #4 surfaced that a role-less bot has NO food-acquisition
path — `rules.json` has no food rule, hunter routing doesn't apply to `role:null`, and the decider
doesn't supply one either — the bot went starvation-pinned at T+30 (food 0, HP 10), the same killer
class that ended runs #1 and #2. Run #6 briefly gated on TWO things (soak #4's verdict AND the
food-acquisition drive landing) — **the food-drive half is now CLOSED: `#108` landed (agenda ~v30)**,
a FOOD rung firing on `foodCount==0 && hunger<=12` regardless of role/project, hunts with widening
radius, falls back to harvest, live-verified against a real cow with food actually counted. **Run #6
now waits on soak #4's verdict ONLY (~08:55Z).** My race book v2 manual food branch
(`setProject(huntAnimals{anyMob:true,radius:32,repeat:true})`, `harvestGrass{repeat:true}` fallback,
see "Known-failure branch plans" above) stays armed regardless, as my override if `#108` underperforms
live — record actual agenda version at spawn, don't assume v30 exactly.

Also carrying forward per team-lead: if eng-3 lands `#102` (chopTrees fell-complete) before soak #4
concludes, the run #6 stack will include it — record actual versions read from `/state` at spawn as
always, don't assume the wind-down numbers below still hold.

**2026-09-03 update (team-lead)**: soak #4 went live 07:49:42Z on 25599, verdict expected ~08:55Z;
run #6's green light follows that verdict (or an explicit waiver). Expected stack for run #6 is now
the full move-set: skills **v62+** (gear-progression drive, fell-complete), agenda **~v30**
(SHELTER rung + **FOOD rung** `#108` + sword/axe upgrades), survival **v11**, dangerscan **v6** —
supersedes the v60/v10/v25/v5 wind-down numbers above and the earlier v62/v27 estimate. Still
TBD-at-spawn per the standing rule (read `/state` fresh, don't assume).

Launch is prepped to be instant on green light:
- **World bring-up** (`~/minecraft/localserver-race`, absolute path — ghq move means no more
  `../localserver-race` sibling shortcut): `cd ~/minecraft/localserver-race && sed -i
  's/^level-name=.*/level-name=world-race6/' server.properties && setsid nohup java -Xmx1536M
  -Xms512M -jar server.jar nogui > server.log 2>&1 &` — then wait for `Done` in `server.log`.
- **Control port**: `3161` reserved (checked via `ss -ltn`; only `3160` is currently in use, by
  soak #4's `MampfManfred` on 25599). Name resolved: original reservation `MuffelManfred` was one
  syllable off `MampfManfred` (soak #4, 3160/25599) and team-lead ruled to rename before spawn rather
  than run two look-alike `*Manfred`s across two ports/servers at once — `GammelGerhard`
  (3161/25600) has no phonetic overlap with `MampfManfred`.
- **Spawn line**: `OWNER=test-driver PURPOSE="gear-race run #6, world-race6, Race book v2, full
  move-set (skills v62+/agenda ~v30 SHELTER+FOOD/survival v11/dangerscan v6)" MC_HOST=127.0.0.1
  MC_PORT=25600 ./spawn.sh GammelGerhard 3161 --agenda` (role-less racer, no `DECIDER_EXCLUDE` — this
  bot is meant to be seen by the decider's shared budget like any real racer, and per `#108` its
  food-acquisition now works role-less by design so this matters more than ever).
- `./list.sh` before and after, `/state` read immediately post-spawn to lock in actual versions,
  `gearrace.mjs` as recorder of record from the start.

**LAUNCHED 2026-09-03 08:58:28Z** (test-driver, respawned post-reboot session — new context, repo
is ground truth). Green light confirmed per TODO §1 item 6 / SCOREBOARD "SOAK #4" verdict
(non-catastrophic, run #6 GREEN-LIT). World bring-up: `level-name` swapped to `world-race6`
(fresh, never-used), server relaunched, "Done (2.252s)" — `world-race5` left on disk as archive,
untouched. `./list.sh` clean before spawn (only `Trail4Insp2`, team-lead's soak-4 inspector on
25599, decider-excluded — no collision).

Engine versions at run start (read from `/state` immediately post-spawn, ACTUALS, matching
team-lead's expected stack exactly): skills **v62**, agenda **v30**, survival **v11**, dangerscan
**v6**, digguard v5, toolguard v2, digchain v1, producer v7, graychat v5, reachguard v1 (idleguard
false — no `--role` at spawn, panicguard false — subsumed). `role:null` (role-less racer, by
design, so `#108`'s FOOD rung is exercised as intended).

| Tier | Time from join | Notes |
|---|---|---|
| Join | **T+0 (08:58:28Z / entity id 35)** | fresh spawn, position (3.5, 101, 3.5), hp 20/20, food 20/20, empty inventory confirmed via `/state` |
| Wooden pickaxe | **T+1m15s (08:59:43Z)** | `Tool ready: wooden_pickaxe (crafted)`, log-confirmed on `world-race6` server.log — 2nd-fastest ever behind run #4's T+59s, well ahead of run #5's T+7m25s. No re-issue needed (per trigger table); RESTOCK now self-provisioning kit (torch/bread/cobblestone/stick) toward the stone attempt. |
| Stone pickaxe | pending — **the wall** | 0 of 4 comparable runs (#1-#4) have ever reached this; run #5 suspended mid-kit-assembly, excluded |
| Iron pickaxe | pending | never yet reached live by this program |
| Diamond pickaxe | pending | never yet reached live by this program |

Steering calls: 1 — (1) initial `setProject({skill:'mineLane',args:{target:'stone',count:16}})` at
08:58:53.698Z (T+25s), clean on first attempt, per Race book v2's trigger table. Deaths: 0 so far.
Monitor: armed — 15s `/state` poll (IDLE-while-project-set, `needs_direction`, kit `blocked`,
low-HP) plus real-time `server.log`/`logs/GammelGerhard.log` tail, per Race book v2's trigger table
and branch plans (combat-loss-at-night re-arm branch and the wood→stone wedge watches both armed
from spawn).

Decider daemon: was NOT running at prep time; coordinating restart with engine-dev-3 (concurrently
on TODO 4b, decider.js latency fix) before starting it, per the lead's brief. Commit hash at
whatever point it comes up will be recorded here.

**STATUS: LIVE, racing.**

## SOAK #4 — first formal HUMAN-BAR attempt: **FAIL (3 of 4)** (team-lead, graded 2026-09-03 08:53Z)

Bot `MampfManfred` (3160/25599, --agenda, agenda v27 / skills v61 / survival v11, SOAK_BOT on the decider, Andy-4 local).
Window 07:49:42.327Z → 08:49:42.327Z as pre-registered. **The host was rebooted (clean systemd reboot) at 08:46:12Z, T+56:30** —
bot, inspector and lead session all died; ledger's last record 08:46:06Z. Graded POST-HOC per the pre-registered fallback
("the ledger persists — grade with those exact bounds"): server restarted from its saved world, fresh inspector `Trail4Insp2`
(3171, DECIDER_EXCLUDE, no --agenda), exact staged command:
`node bench/humanbar4.mjs --bot MampfManfred --since 2026-09-03T07:49:42.327Z --until 2026-09-03T08:49:42.327Z --inspector-port 3171 --exclude-zones "-3,5,30" --label soak4`
(exclusion zone = Respawn103 contamination, 07:53Z–08:01Z, box x −9…18 z −7…8; it excluded 0 of the bot's own sites).

| # | criterion | verdict | number |
|---|---|---|---|
| 1 | playcheck PLAYING | **PASS** | 12.1% stationary, 5.5 productive actions/10min |
| 2 | direction-gate | **FAIL** | opened 10 / closed 10 / unclosed 0, **latency p50 76s (≤60 required), p90 215s (<120 required)**, LLM 9.4 calls/hr |
| 3 | survives unaided | PASS (caveat) | deaths 0, non-decider interventions 0 of 18; last vitals hp 10/20 food 0/20 — pinned, not safe |
| 4 | human trail | PASS (thin) | 1 site checked (1 dig cluster, **0 chop clusters** — the bot never completed a chop), 0 floating logs / stranded drops / naked shafts |

Gate files: bench/gates/humanbar4-soak4.json, humanbar-soak4.json, direction-soak4.json, trail-soak4.json.

**Why criterion 2 failed — attributed from decisions.jsonl + the ledger's `direction` records, NOT the LLM:**
- Andy's own call latency was 1–6.3s on every LLM decision. The episode latency is structural: every episode closed at a
  ~68–85s floor — including the zero-millisecond RULE decision (eid dmtl87qib1: 77s) and the three `frozen_repeat`
  closes (68–73s). `decider.js` has `DRIVER_GRACE_MS = 60000` gated on `b.owner` (pids/*.meta OWNER field), and since the
  OWNER/PURPOSE spawn law every bot HAS an owner — so the driverless soak bot was made to wait a driver grace it can never
  use, plus up to one `POLL_MS` (20s). That is the p50.
- The p90 (215s, 221s) = the two episodes where Andy's reply was `unmapped_or_unparsed`; the retry is spaced by
  `PER_BOT_MIN_GAP_MS = 120000`, so a miss costs a further 2+ minutes before the second attempt (one then dispatched,
  one closed `decider_exhausted`).
- Fix shape (eng-3, decider lane): driver grace must key on an actual driver (explicit meta flag / driver-registered
  signal), not on the fleet-awareness OWNER label; a parse-miss retry should ride the next poll, not the 120s gap.
  Both are timing constants — no bot-behaviour change. Re-grade of the SAME ledger cannot change (latency is what it was);
  the fix is validated by the next soak.

**Verdict for the run #6 gate: NON-CATASTROPHIC** — playcheck PLAYING, zero deaths, zero human help, clean trail; the
single miss is decider plumbing timing. Run #6 is GREEN-LIT. The human bar itself is NOT met: soak #5 (after the decider
fix + #108 FOOD + 5c escalation) is the next attempt. Also on record: the bot never held a tool all hour (every
wood-gather froze, TODO 5c), so criterion 4 passed on a vacuously thin trail and criterion 3 passed while starving —
both are honest PASSes by the instrument's definition and both are called out here so nobody reads 3/4 as "nearly human".
