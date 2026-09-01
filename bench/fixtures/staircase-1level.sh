#!/usr/bin/env bash
# Fixture: staircase-1level
# FEEDBACK: the "96-steps-for-1-level fiasco" (shared bug class with CAVECREW, cost them
# a bot) -- safeDescend counted a step as done once the walk-down goto SUCCEEDED, but
# pathfinder can return a false "reached" with zero position change; digBlock then
# returns `already` on air (no real progress), and the loop had no abort, so it could
# grind for dozens of steps making zero net descent. Shipped fix (engine-dev, v11+): a
# net-descent assertion compares feet-Y against the previous step; 3 consecutive steps
# with no depth gained abort with stoppedBecause:'no_descent' instead of looping.
#
# HONEST SCOPE NOTE (matching the shipping engineer's own FEEDBACK entry: "NOT
# force-tested live -- the failure needs a pathfinder false-reached to reproduce and I
# would not fake it"): this fixture does not force the exact false-reached trigger
# either, for the same reason -- faking a pathfinder-internal lie doesn't test anything
# real. Instead it's a REGRESSION check that the new abort-counter arithmetic doesn't
# false-positive on genuine descent: over a real multi-level staircase dig, the step
# count should land close to the requested depth (not blow up), and stoppedBecause
# should be 'reached', not a spurious 'no_descent'.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=270; PY=85; PZ=80
build_platform "$PX" "$PY" "$PZ" 6
# solid ground under the whole descent run so safeDescend has real stone to dig through
# (descending 'north' = -Z per skills.js's DIRS map -- extend generously that way)
rcon "fill $((PX-2)) $((PY-10)) $((PZ-14)) $((PX+8)) $((PY-1)) $((PZ+8)) minecraft:stone" >/dev/null
sleep 0.3

tp_bot "$PX" "$PY" "$PZ"
sleep 0.5
rcon "give $BOT_NAME minecraft:wooden_pickaxe 1" >/dev/null
eval_js "const p = bot.inventory.items().find(i=>i.name==='wooden_pickaxe'); if (p) await bot.equip(p,'hand');" >/dev/null 2>&1
sleep 0.3

DEPTH=5
TOY=$((PY-DEPTH))
# force:true -- this fixture tests the net-descent counter, not the kit-preflight gate
# (a separate fixture's job); the bench bot doesn't carry a full deep-work kit.
r=$(start_skill safeDescend "{\"toY\":$TOY,\"dir\":\"north\",\"torchEvery\":0,\"maxSteps\":32,\"force\":true}")
[[ "$(jget "$r" '.result.ok')" == "true" ]] || { clear_platform "$PX" "$PY" "$PZ" 6; fail "start_skill rejected: $r"; }
final=$(wait_task 90)
clear_platform "$PX" "$PY" "$PZ" 6

running=$(jget "$final" '.result.task.running')
[[ "$running" != "true" ]] || fail "safeDescend still running after 90s for a $DEPTH-level descent -- inconclusive"
steps=$(jget "$final" '.result.task.result.steps')
stopped=$(jget "$final" '.result.task.result.stoppedBecause')
errCode=$(jget "$final" '.result.task.error.code')

if [[ "$stopped" == "no_descent" ]]; then
  fail "no_descent fired on a genuine open descent -- the abort-counter is false-positiving on normal progress"
fi
if [[ "$steps" != "null" && "$steps" -gt $((DEPTH * 3)) ]]; then
  fail "took $steps steps for a $DEPTH-level descent (>3x expected) -- looks like the fiasco shape even without stoppedBecause naming it"
fi
[[ "$stopped" == "reached" || "$stopped" == "null" ]] || echo "note: stoppedBecause=$stopped errCode=$errCode steps=$steps (not a hard fail if it's a legitimate stop reason, just recording it)"
pass
