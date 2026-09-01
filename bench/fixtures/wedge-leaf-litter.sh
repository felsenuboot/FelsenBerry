#!/usr/bin/env bash
# Fixture: wedge-leaf-litter
# FEEDBACK (multiple drivers, 1.21.11): leaf_litter has shapes:[] like torch, so the OLD
# planner classified it as "air" and walked in without digging it out — standing in it
# leaves onGround=false forever, jump never fires, the bot stands still while pathfinder
# holds a "success" path. Shipped fix (engine-dev, v8): baseMovements() adds leaf_litter
# to movements.blocksToAvoid alongside torch. ctx._unstick (stall-buster: dig nuisance
# blocks + hop) stays as a backstop either way, so this fixture asserts the FAST path
# (planner-level avoidance) rather than just "eventually recovers via stall-buster".
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=240; PY=80; PZ=80
build_platform "$PX" "$PY" "$PZ" 6

TX=$((PX+3)); TZ=$((PZ+3))
tp_bot "$((PX+1))" "$PY" "$((PZ+1))"
sleep 1.0
rcon "setblock $TX $PY $TZ minecraft:leaf_litter" >/dev/null
sleep 1.0
placed=$(eval_js "const b = bot.blockAt(new Vec3($TX, $PY, $TZ)); return b && b.name;")
placedName=$(jget "$placed" '.result')
if [[ "$placedName" != "leaf_litter" ]]; then
  clear_platform "$PX" "$PY" "$PZ" 6
  fail "setup failed: expected leaf_litter at target, got '$placedName' -- block may not be /setblock-able on this server version, needs a different setup"
fi

t0=$(date +%s)
r=$(eval_js "
const target = new Vec3($TX, $PY, $TZ);
try {
  await bot.pathfinder.goto(new goals.GoalBlock(target.x, target.y, target.z));
} catch (e) { return { ok:false, error: e.message }; }
const after = bot.entity.position.floored();
return { ok:true, arrived: after.x===target.x && after.y===target.y && after.z===target.z };
")
t1=$(date +%s)
elapsed=$((t1-t0))

clear_platform "$PX" "$PY" "$PZ" 6

ok=$(jget "$r" '.result.ok')
arrived=$(jget "$r" '.result.arrived')
[[ "$ok" == "true" ]] || fail "goto threw: $(jget "$r" '.result.error')"
assert_true "$arrived" "did not arrive exactly on the leaf_litter cell (wedged?) in ${elapsed}s"
[[ $elapsed -lt 15 ]] || fail "arrived but took ${elapsed}s -- smells like stall-recovery doing the work instead of blocksToAvoid"
pass
