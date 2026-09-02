#!/usr/bin/env bash
# Fixture: wedge-r2-twin-doorway (#54 R2 — the live half of the proof)
#
# engine-dev-3's bench/fixtures/gotoR-recovery.js proved findRepositionTarget's CANDIDATE
# SEARCH is correct in isolation (right cell, right priority, protection respected) but its
# own header says explicitly what it cannot prove: that walking to the chosen cell and
# re-issuing the goto actually gets a genuinely wedged bot unstuck. That needs a real
# pathfinder against real terrain. This fixture is that half — PROPOSED, NOT YET RUN (server
# was down for this whole session; see FEEDBACK.md). Coordinate with engine-dev-3 before/while
# running: the geometry below is a first attempt at a genuinely hard-but-real-server-known
# pathfinder pathology, not a proven trap, and may need tuning against actual observed
# behaviour (thinkTimeout, node budget, this server's mineflayer-pathfinder version).
#
# WHY TORCH/LEAF-LITTER WON'T DO (see wedge-torch.sh / wedge-leaf-litter.sh headers): those
# are PLANNER-RETIRED — baseMovements' blocksToAvoid digs them out before the bot ever steps
# in, so they never reach `stuck` at all any more. A genuine R2-triggering wedge needs an
# obstruction ctx._unstick's nuisance-block dig CANNOT clear (solid, not empty-boundingBox)
# and a caller timeoutMs generous enough that the internal FROZEN/NO_PROGRESS watchdog can
# actually reach `stuck` before the caller's own path_timeout fires first (the "thinkTimeout
# pre-empts stuck" trap) -- see the timing budget below.
#
# GEOMETRY (the "twin doorway" heuristic trap): a wall between the bot and the goal has two
# gaps. The BLOCKED gap sits exactly on the straight heuristic line between start and goal
# (so a distance-greedy search keeps getting drawn back to it); the OPEN gap sits 2 blocks
# off that axis -- deliberately matching _reposition's own dx/dz=2 candidate offsets, so IF
# this shape wedges the bot at all, the reposition step should land it roughly in line with
# the real doorway and the re-issued A* should find the now-obvious route. The blocked gap
# uses `minecraft:barrier` (truly indestructible -- no protected.json edit needed, and no
# digCost dependency: the planner can never route through it regardless of tier).
#
# TIMING BUDGET (worked from skills.js's own watchdog, ctx.goto): FROZEN fires at 6s of zero
# displacement; 3 escalations (unsticks 0->1->2->3) before throwing `stuck` is ~4 x 6s = 24s
# of accumulated frozen time PLUS however long each ctx._unstick() attempt itself takes.
# NO_PROGRESS uses a 15s window instead, per #53's calibration note. Either path needs
# meaningfully more than ~30s of caller budget to complete before a shorter timeoutMs would
# hit path_timeout first and never reach `stuck` (the exact failure mode this fixture must
# avoid). `come` (skills.js ~3099) calls `ctx.retry('travel', () => ctx.gotoNear(args, range,
# 60000), 2)` -- gotoNear routes through gotoR since #54 landed (f6adce8), and 60s per
# attempt (x2 retries) is comfortably inside the budget this needs.
#
# PASS = the bot reaches the goal room AND the ledger recorded at least one `recovery`
# event (rung R2) in this fixture's own time window -- i.e. it didn't just detour around
# cleanly without ever wedging (that would prove nothing about R2) or fail outright.
# A run that reaches the goal with ZERO recovery events is inconclusive, not a pass: it
# means this geometry didn't actually wedge the bot, and the trap needs to be harder
# (narrower offset margin, longer false-lead approach, or a longer wall so the heuristic
# commits more strongly to the blocked gap) -- reported as such, not silently swept into
# a false "R2 works" claim.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# ---- geometry: pick coordinates well clear of every other fixture's footprint ----
WX=300          # the dividing wall sits at this x
Z0=80           # wall spans z=Z0..Z0+10
WY=80           # wall base y (3 tall: WY, WY+1, WY+2)
BLOCKED_Z=$((Z0 + 5))   # on the straight start->goal line -- the false lead
OPEN_Z=$((Z0 + 7))      # 2 blocks off-axis -- the real route, matching _reposition's offset

START_X=$((WX - 10)); START_Z=$BLOCKED_Z
GOAL_X=$((WX + 10));  GOAL_Z=$BLOCKED_Z

echo "building twin-doorway geometry at wall x=$WX, blocked gap z=$BLOCKED_Z, open gap z=$OPEN_Z" >&2

# two flat rooms (start + goal side), then carve the wall between them
build_platform "$((START_X - 4))" "$WY" "$((Z0 - 2))" 14
build_platform "$((GOAL_X - 2))" "$WY" "$((Z0 - 2))" 14
rcon "fill $WX $WY $Z0 $WX $((WY+2)) $((Z0+10)) minecraft:stone" >/dev/null
# blocked gap: indestructible, no protected.json / digguard dependency
rcon "fill $WX $WY $BLOCKED_Z $WX $((WY+1)) $BLOCKED_Z minecraft:barrier" >/dev/null
# open gap: the only real route
rcon "fill $WX $WY $OPEN_Z $WX $((WY+1)) $OPEN_Z minecraft:air" >/dev/null

stop_idleguard
tp_bot "$START_X" "$WY" "$START_Z"
sleep 0.5

# window start: only count recovery/goto records from here on
T0=$(date +%s%3N)

t0=$(date +%s)
r=$(start_skill come "{\"x\":$GOAL_X,\"y\":$WY,\"z\":$GOAL_Z,\"range\":2}")
if [[ "$(jget "$r" '.result.ok')" != "true" ]]; then
  rcon "fill $WX $((WY-1)) $Z0 $((GOAL_X+2)) $((WY+3)) $((Z0+10)) minecraft:air" >/dev/null
  fail "start_skill rejected: $r"
fi
final=$(wait_task 150)
t1=$(date +%s)
elapsed=$((t1 - t0))

# ---- ledger read: any `recovery` (rung R2) events in this window, for THIS bot ----
LOG="$SELF_DIR/../logs/metrics-$BOT_NAME.jsonl"
recoveries="[]"
if [[ -f "$LOG" ]]; then
  recoveries=$(jq -c --argjson t0 "$T0" '. as $r | select(.ev=="recovery" and .t >= $t0)' "$LOG" 2>/dev/null | jq -sc '.')
  gotos_in_window=$(jq -c --argjson t0 "$T0" '. as $r | select(.ev=="goto" and .t >= $t0)' "$LOG" 2>/dev/null | jq -sc '.')
else
  echo "WARNING: no ledger file at $LOG -- was telemetry.js installed on this bot?" >&2
  gotos_in_window="[]"
fi
n_recoveries=$(jq 'length' <<<"$recoveries")

# cleanup regardless of outcome
rcon "fill $WX $((WY-1)) $Z0 $((GOAL_X+2)) $((WY+3)) $((Z0+10)) minecraft:air" >/dev/null
rcon "fill $((START_X-4)) $((WY-1)) $((Z0-2)) $((START_X+10)) $((WY+3)) $((Z0+12)) minecraft:air" >/dev/null

running=$(jget "$final" '.result.task.running')
done_=$(jget "$final" '.result.task.done')
errCode=$(jget "$final" '.result.task.error.code')

echo "elapsed=${elapsed}s  done=$done_  errCode=$errCode  recovery_events_in_window=$n_recoveries" >&2
echo "recoveries: $recoveries" >&2
echo "gotos: $gotos_in_window" >&2

[[ "$running" != "true" ]] || fail "come still running after 150s -- neither arrived nor gave up cleanly"

if [[ "$n_recoveries" -eq 0 ]]; then
  if [[ "$done_" == "true" ]]; then
    fail "INCONCLUSIVE: reached the goal in ${elapsed}s but ZERO recovery events fired -- this geometry did not actually wedge the bot (search found the open gap directly), so it proves nothing about R2. Needs a harder trap: narrower margin, longer wall, or a longer false-lead approach."
  else
    fail "no recovery events AND did not complete (errCode=$errCode) -- either the trap is unsolvable as built (check the open gap is really clear) or something else broke; not an R2 result either way"
  fi
fi

assert_eq "$done_" "true" "R2 fired ($n_recoveries times) but the task never completed (errCode=$errCode) -- R2 recovered from the wedge without the bot actually reaching the goal, or gave up after r2Max retries. See the recoveries/gotos dump above."
pass "R2 fired $n_recoveries time(s) and the bot reached the goal in ${elapsed}s -- see stderr for the recovery/goto records to score displaced-vs-replan"
