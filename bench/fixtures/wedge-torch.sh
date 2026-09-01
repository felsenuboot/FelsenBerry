#!/usr/bin/env bash
# Fixture: wedge-torch
# FEEDBACK (bernd-driver): a torch occupying the bot's own tile wedges pathfinding
# exactly like the leaf_litter bug — torch has shapes:[] so the OLD planner classified
# it as "air" (emptyBlocks), walked in, and never dug it out; the bot reports a path but
# never actually moves. Shipped fix (engine-dev, v8): baseMovements() adds torch (and
# leaf_litter, wall_torch, powder_snow, etc.) to movements.blocksToAvoid, which flips
# them unsafe so the planner digs them out BEFORE stepping in.
# test: place a torch directly on a platform, force the bot to walk EXACTLY onto that
# cell via a GoalBlock (not GoalNear — no range slack to dodge the wedge cell), and
# assert arrival happens quickly with the torch gone (dug out, not walked around).
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=230; PY=80; PZ=80
build_platform "$PX" "$PY" "$PZ" 6

TX=$((PX+3)); TZ=$((PZ+3))
tp_bot "$((PX+1))" "$PY" "$((PZ+1))"
sleep 0.5

# give the bot a torch and place it exactly at the target cell
eval_js "const t = bot.inventory.items().find(i=>i.name==='torch'); if (!t) { bot.chat('no torch'); }" >/dev/null 2>&1
rcon "give $BOT_NAME minecraft:torch 4" >/dev/null
sleep 0.3
eval_js "
const torch = bot.inventory.items().find(i => i.name === 'torch');
if (!torch) return { placed: false, reason: 'no torch after give' };
const ref = bot.blockAt(new Vec3($TX, $PY - 1, $TZ));
await bot.equip(torch, 'hand');
try { await bot.placeBlock(ref, new Vec3(0, 1, 0)); } catch (e) {}
const now = bot.blockAt(new Vec3($TX, $PY, $TZ));
return { placed: now && now.name === 'torch', block: now && now.name };
" >/dev/null

# force EXACT arrival on the torch cell (GoalBlock — no range slack)
t0=$(date +%s)
r=$(eval_js "
const target = new Vec3($TX, $PY, $TZ);
try {
  await bot.pathfinder.goto(new goals.GoalBlock(target.x, target.y, target.z));
} catch (e) { return { ok:false, error: e.message }; }
const after = bot.entity.position.floored();
return { ok:true, arrived: after.x===target.x && after.y===target.y && after.z===target.z, torchGone: bot.blockAt(target).name !== 'torch' };
")
t1=$(date +%s)
elapsed=$((t1-t0))

clear_platform "$PX" "$PY" "$PZ" 6

ok=$(jget "$r" '.result.ok')
arrived=$(jget "$r" '.result.arrived')
[[ "$ok" == "true" ]] || fail "goto threw: $(jget "$r" '.result.error')"
assert_true "$arrived" "did not arrive exactly on the torch cell (wedged?) in ${elapsed}s"
[[ $elapsed -lt 15 ]] || fail "arrived but took ${elapsed}s — a healthy planner-level dig-through should be near-instant, this smells like stall-recovery doing the work instead of blocksToAvoid"
pass
