#!/usr/bin/env bash
# Fixture: chop-canopy
# FEEDBACK (friedrich-driver, "chopTrees fells placed structure logs" + the later
# root-cause correction "chopTrees permanently wedges near digguard v2 protected
# regions"): torch posts and structure corners are valid trunk-base candidates to
# chopTrees' own heuristic (a log with non-log below), so it targeted them like trees --
# and once digguard's rejection made them undiggable, it burned a full goto+stall-recovery
# ladder per protected log instead of skipping them at selection time. Shipped fix
# (engine-dev-2, v10): ctx.isProtected(pos) filters protected blocks at TARGET SELECTION
# (consulting the same protected.json digguard reads), plus a per-log skip so a tree
# growing against a build still gets felled.
# test: place an isolated log at a real registered torch_posts_1 column coordinate
# (read-only against protected.json, same approach as digguard-protected) alongside a
# genuine small planted tree elsewhere, run chopTrees, and assert the protected log
# survives untouched while the real tree gets felled.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# torch_posts_1 column [-8,-1], yMin 109 -- a real registered protected column.
# IMPORTANT: the "real tree" must be placed within chopTrees' maxDist of the protected
# log (and the bot must actually visit/load that chunk) -- a first version of this
# fixture placed the tree 300+ blocks away, so chopTrees never even considered the
# protected log as a candidate, AND the assertion's own bot.blockAt read hit an
# unloaded chunk (returns null -- the well-documented stale/unloaded-chunk quirk) and
# misread that as "gone", producing a false failure. Keep everything within ~20 blocks.
#
# SECOND root cause (found live): protected.json also defines harvestExclusion
# "plaza_treescape", a 25-block-radius AESTHETIC cylinder around home [-3,111,4],
# appliesTo chopTrees -- a totally separate gate from ctx.isProtected(). torch_posts_1
# sits ~7 blocks from that center, so any "real tree" close enough to be within
# maxDist of it also landed INSIDE the aesthetic cylinder and got silently excluded by
# harvestAllowed() before isProtected() ever mattered -- not_found on every run,
# regardless of whether the protection-skip logic works. protected.json is the SAME
# file the live main-server fleet reads (verified: 6 runner.js processes on other
# ports were up against it) so mutating it for the test is not an option. Fix: keep
# the protected log at its real torch_posts_1 coordinate, but place the "real tree"
# ~28 blocks out from home along the same bearing -- outside the 25-radius aesthetic
# zone, while the bot (parked near the log) stays within maxDist:32 of both.
#
# THIRD root cause (found live): two small, disconnected build_platform islands ~23
# blocks apart left nothing but this world's unpredictable cave/void terrain in
# between -- digBlock's gotoSee/gotoNear approach both failed across the gap, chopTrees
# logged "tree ... unreachable -- blacklisted" and then genuinely found nothing else,
# so it still surfaced as not_found. Fix: one single large platform spanning both
# points, guaranteeing a solid connected floor the whole way (deterministic RCON fill,
# no reliance on natural terrain or pathfinder cleverness).
PLX=-8; PLY=110; PLZ=-1
PX=$((PLX-2)); PY=$PLY; PZ=$((PLZ+2))

TREE_X=-23; TREE_Z=-16

# bounding rect for [log platform] union [tree platform] union a few blocks of margin
CPX=-28; CPZ=-21
build_platform "$CPX" "$PY" "$CPZ" 31

curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null
stop_idleguard

rcon "setblock $PLX $PLY $PLZ minecraft:oak_log" >/dev/null
rcon "setblock $TREE_X $PY $TREE_Z minecraft:oak_log" >/dev/null
rcon "setblock $TREE_X $((PY+1)) $TREE_Z minecraft:oak_log" >/dev/null
rcon "setblock $TREE_X $((PY+2)) $TREE_Z minecraft:oak_log" >/dev/null
rcon "fill $((TREE_X-2)) $((PY+3)) $((TREE_Z-2)) $((TREE_X+2)) $((PY+3)) $((TREE_Z+2)) minecraft:oak_leaves" >/dev/null

tp_bot "$((PX+1))" "$PY" "$((PZ+1))"
sleep 0.5
stop_idleguard

# settle-verify: on a repeated/back-to-back run, the freshly-placed tree can still be
# invisible to the bot's world cache for a moment (chunk-update packet lag) -- confirm
# it's actually there before starting chopTrees, instead of a fixed sleep guess.
seen="false"
for i in 1 2 3 4 5 6; do
  chk=$(eval_js "const b = bot.blockAt(new Vec3($TREE_X, $PY, $TREE_Z)); return b && b.name;")
  if [[ "$(jget "$chk" '.result')" == "oak_log" ]]; then seen="true"; break; fi
  sleep 0.5
done
cleanup() {
  rcon "setblock $PLX $PLY $PLZ minecraft:air" >/dev/null
  # clear the whole causeway footprint, including the leaf layer at y+3 (one above
  # what clear_platform's own y..y+2 range covers).
  rcon "fill $CPX $((PY-1)) $CPZ $((CPX+30)) $((PY+4)) $((CPZ+30)) minecraft:air" >/dev/null
}

if [[ "$seen" != "true" ]]; then
  cleanup
  fail "setup: placed tree never became visible to the bot's world cache within 3s"
fi

r=$(start_skill chopTrees "{\"types\":\"oak\",\"count\":1,\"maxDist\":32,\"replant\":false,\"force\":true}")
[[ "$(jget "$r" '.result.ok')" == "true" ]] || { cleanup; fail "start_skill rejected: $r"; }
final=$(wait_task 60)

protectedGone=$(eval_js "const b = bot.blockAt(new Vec3($PLX, $PLY, $PLZ)); return !b || b.name === 'air';")
protectedGoneVal=$(jget "$protectedGone" '.result')
treeFelled=$(eval_js "const b = bot.blockAt(new Vec3($TREE_X, $PY, $TREE_Z)); return !b || b.name === 'air';")
treeFelledVal=$(jget "$treeFelled" '.result')

cleanup

felled=$(jget "$final" '.result.task.result.treesFelled')
errCode=$(jget "$final" '.result.task.error.code')

if [[ "$protectedGoneVal" == "true" ]]; then
  fail "the registered-protected log at torch_posts_1's column was FELLED -- isProtected() target filter regressed"
fi
assert_eq "$treeFelledVal" "true" "the real planted tree was NOT felled (treesFelled=$felled, errCode=$errCode) -- chopTrees is over-avoiding, not just protecting structures"
pass
