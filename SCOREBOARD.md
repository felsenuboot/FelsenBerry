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
