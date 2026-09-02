#!/usr/bin/env bash
# Fixture: ascend-staircase (ascendToSurface — the safeDescend mirror, filed after
# OhneHoseOtto/3140's live entombment, GEAR-RACE run #1, 2026-09-02)
#
# Seals the bot inside a large solid stone cube with a pre-built open room above it, then
# verifies ascendToSurface actually digs a 45-degree staircase UP and out — the core mechanic
# test-driver's specimen needed but this fixture never touches that bot: this stages an
# equivalent sealed-in-solid-rock scenario on the sanctioned 25599 server instead.
#
# The cube is deliberately LARGE (20x20 footprint) so the staircase reaches the open room
# above regardless of which cardinal direction the bot happens to face on spawn/teleport —
# no need to align geometry with facing. Uses toY (not open-sky detection) for this first
# pass: proving the STAIRCASE MECHANIC works is the point; the columnOpen()-based "climb until
# real sky" stop condition is a separate, simpler code path (a straight scan) not exercised
# here.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=450; PY=50; PZ=80; SIZE=20
PX2=$((PX + SIZE - 1)); PZ2=$((PZ + SIZE - 1))
CUBE_TOP=$((PY + 19))          # 20 tall solid cube: PY .. PY+19
ROOM_Y1=$((CUBE_TOP + 1)); ROOM_Y2=$((CUBE_TOP + 4))   # 4-tall open room right above it
START_X=$((PX + SIZE / 2)); START_Z=$((PZ + SIZE / 2))
TARGET_Y=$((ROOM_Y1 + 1))      # a couple steps into the open room -- proves it broke through

FL_X1=$((PX - 5)); FL_Z1=$((PZ - 5)); FL_X2=$((PX2 + 5)); FL_Z2=$((PZ2 + 5))
cleanup_geometry() {
  rcon "fill $PX $((PY - 1)) $PZ $PX2 $((ROOM_Y2 + 1)) $PZ2 minecraft:air" >/dev/null
  rcon "forceload remove $FL_X1 $FL_Z1 $FL_X2 $FL_Z2" >/dev/null
}
rcon "forceload add $FL_X1 $FL_Z1 $FL_X2 $FL_Z2"
sleep 1.0
fill_checked() {
  local resp; resp=$(rcon "fill $1")
  if [[ "$resp" == *"not loaded"* || "$resp" == *"Unknown"* || "$resp" == *"failed"* ]]; then
    cleanup_geometry
    fail "fill '$1' did not succeed: $resp"
  fi
}
fill_checked "$PX $PY $PZ $PX2 $CUBE_TOP $PZ2 minecraft:stone"
fill_checked "$PX $ROOM_Y1 $PZ $PX2 $ROOM_Y2 $PZ2 minecraft:air"
# carve just enough headroom at the seal point for the bot to stand -- everything else in the
# cube stays solid, so it's genuinely sealed, not standing in a pre-cleared pocket
fill_checked "$START_X $PY $START_Z $START_X $((PY + 1)) $START_Z minecraft:air"

stop_idleguard
tp_bot "$START_X" "$PY" "$START_Z"
sleep 2.0
tp_bot "$START_X" "$PY" "$START_Z"
sleep 0.5
settle=$(eval_js "return { y: bot.entity.position.y };")
settleY=$(jget "$settle" '.result.y')
if ! awk -v y="$settleY" -v want="$PY" 'BEGIN{exit !(sqrt((y-want)^2) < 2)}' 2>/dev/null; then
  cleanup_geometry
  fail "settle check failed: bot at y=$settleY, expected near y=$PY -- not actually sealed in the cube"
fi

# confirm it's genuinely sealed before crediting the skill for anything (the doctrine this
# whole session has been built on: verify the setup, don't trust it)
sealed=$(eval_js "
  const p = bot.entity.position.floored(); let solid = 0, total = 0;
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=2; dy++) for (let dz=-1; dz<=1; dz++) {
    if (dx===0 && dz===0 && (dy===0||dy===1)) continue; // the carved standing space itself
    total++;
    const b = bot.blockAt(p.offset(dx,dy,dz));
    if (b && b.boundingBox === 'block') solid++;
  }
  return { solid, total };
")
solidCount=$(jget "$sealed" '.result.solid')
totalCount=$(jget "$sealed" '.result.total')
if [[ "$solidCount" != "$totalCount" ]]; then
  cleanup_geometry
  fail "setup check failed: only $solidCount/$totalCount neighbour cells are solid -- not actually sealed"
fi

r=$(start_skill ascendToSurface "{\"toY\":$TARGET_Y,\"dir\":\"north\"}")
if [[ "$(jget "$r" '.result.ok')" != "true" ]]; then
  cleanup_geometry
  fail "start_skill rejected: $r"
fi
final=$(wait_task 90)
cleanup_geometry

running=$(jget "$final" '.result.task.running')
done_=$(jget "$final" '.result.task.done')
errCode=$(jget "$final" '.result.task.error.code')
resStartY=$(jget "$final" '.result.task.result.startY')
resEndY=$(jget "$final" '.result.task.result.endY')
resSteps=$(jget "$final" '.result.task.result.steps')
resDug=$(jget "$final" '.result.task.result.dug')
resWhy=$(jget "$final" '.result.task.result.stoppedBecause')

echo "final: $final" >&2
echo "startY=$resStartY endY=$resEndY steps=$resSteps dug=$resDug stoppedBecause=$resWhy" >&2

[[ "$running" != "true" ]] || fail "ascendToSurface still running after 90s"
[[ "$done_" == "true" ]] || fail "task did not complete cleanly (errCode=$errCode) -- see final dump above"
[[ "$resWhy" == "reached" ]] || fail "stopped for reason '$resWhy', not 'reached' -- did not climb out cleanly"
[[ "$resSteps" -gt 0 ]] || fail "0 steps taken -- the staircase mechanic never engaged"
[[ "$resDug" -gt 0 ]] || fail "0 blocks dug -- it 'completed' without actually excavating anything"
if ! awk -v got="$resEndY" -v want="$TARGET_Y" 'BEGIN{exit !(got >= want)}' 2>/dev/null; then
  fail "endY=$resEndY did not reach the target y=$TARGET_Y"
fi

pass "sealed in a solid stone cube at y=$PY, ascendToSurface dug a real staircase out: y=$resStartY -> y=$resEndY in $resSteps steps ($resDug blocks dug), stoppedBecause=reached"
