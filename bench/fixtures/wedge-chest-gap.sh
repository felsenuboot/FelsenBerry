#!/usr/bin/env bash
# Fixture: wedge-chest-gap
# LEARNING_HANDOFF/README quirk: GoalNear near a cluttered spot (like the depot, chests
# packed close together with narrow gaps) can recalc partial paths forever without ever
# rejecting -- pathfinder holds a "still searching" state near tight geometry instead of
# giving up. Shipped mitigation: depositToChest tries GoalNear(chest,2) first, and on
# failure falls back to GoalLookAtBlock (reach-based, works from any angle with line of
# sight, sidesteps the clutter-recalc problem entirely).
# test: box a chest in tightly with fence posts (narrow diagonal-only approach, the
# clutter shape that historically triggered this), give the bot an item to deposit, and
# assert depositToChest completes within a bounded time instead of hanging.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=250; PY=80; PZ=80
build_platform "$PX" "$PY" "$PZ" 8

CX=$((PX+4)); CZ=$((PZ+4))
rcon "setblock $CX $PY $CZ minecraft:chest" >/dev/null
sleep 0.5
# tight clutter: fence posts on 3 of 4 cardinal sides, leaving only a narrow diagonal gap
rcon "setblock $((CX+1)) $PY $CZ minecraft:oak_fence" >/dev/null
rcon "setblock $((CX-1)) $PY $CZ minecraft:oak_fence" >/dev/null
rcon "setblock $CX $PY $((CZ+1)) minecraft:oak_fence" >/dev/null
sleep 0.5

tp_bot "$((PX+1))" "$PY" "$((PZ+1))"
sleep 0.5
rcon "give $BOT_NAME minecraft:cobblestone 8" >/dev/null
sleep 0.3

t0=$(date +%s)
r=$(start_skill depositToChest "{\"pos\":{\"x\":$CX,\"y\":$PY,\"z\":$CZ}}")
[[ "$(jget "$r" '.result.ok')" == "true" ]] || { clear_platform "$PX" "$PY" "$PZ" 8; fail "start_skill rejected: $r"; }
final=$(wait_task 45)
t1=$(date +%s)
elapsed=$((t1-t0))

clear_platform "$PX" "$PY" "$PZ" 8

running=$(jget "$final" '.result.task.running')
done_=$(jget "$final" '.result.task.done')
errCode=$(jget "$final" '.result.task.error.code')
[[ "$running" != "true" ]] || fail "depositToChest still running after 45s near clutter -- the GoalLookAtBlock fallback may not be firing"
assert_eq "$done_" "true" "depositToChest did not complete near a tightly-clutted chest -- errCode=$errCode, elapsed=${elapsed}s"
pass
