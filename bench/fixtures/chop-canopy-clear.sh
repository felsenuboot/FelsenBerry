#!/usr/bin/env bash
# Fixture: chop-canopy-clear (#102, skills.js v61)
#
# Live root cause (Felix, live screenshot, 2026-09-02): chopTrees flood-fills and fells the
# connected LOG column only -- it never touches the leaf canopy above, relying on Minecraft's
# own random-ticked leaf decay to eventually clear it. That decay can take a long time (or,
# per Felix's screenshot, hasn't happened yet at all), leaving a half-felled tree: trunk gone,
# canopy still floating with nothing beneath it -- the literal thing the project's own
# aesthetics law names as "don't do this." Worse, chopTrees' own collectDrops sweep runs
# once, right after felling, so anything that DOES eventually drop from later leaf decay is
# never collected at all: violates never-leave-drops on top of the aesthetics miss.
#
# Fix: after felling a tree's logs, flood-fill the connected leaves of that tree's species
# (seeded from the felled log positions) and clear them too, BEFORE the existing collectDrops
# sweep -- so the canopy never outlives the trunk, and any sapling/apple drops land in the
# same collection pass as the logs.
#
# Deliberately isolated, far from home base / any registered protected structure / any other
# bot's live work area (#101's own fixture-writing hunted a similar lesson the hard way:
# reusing real production coordinates, or coordinates another live bot is actively working
# near, produces flaky, uninterpretable results that have nothing to do with the code under
# test). This fixture builds its own tiny tree from scratch at a coordinate nothing else uses.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

TX=280; TY=90; TZ=280

rcon "forceload add $((TX-10)) $((TZ-10)) $((TX+10)) $((TZ+10))" >/dev/null
rcon "fill $((TX-8)) $((TY-2)) $((TZ-8)) $((TX+8)) $((TY+8)) $((TZ+8)) minecraft:air" >/dev/null
rcon "fill $((TX-6)) $((TY-1)) $((TZ-6)) $((TX+6)) $((TY-1)) $((TZ+6)) minecraft:dirt" >/dev/null

# a small, deterministic oak tree: 3-log trunk, one 3x3 leaf layer sitting directly on top of
# it (9 leaves, all adjacent to the top log so the canopy flood-fill's seeding step is
# guaranteed to find them) -- exact shape chosen so every leaf cell's final state is known and
# assertable, not a "probably cleared" guess.
rcon "setblock $TX $TY $TZ minecraft:oak_log" >/dev/null
rcon "setblock $TX $((TY+1)) $TZ minecraft:oak_log" >/dev/null
rcon "setblock $TX $((TY+2)) $TZ minecraft:oak_log" >/dev/null
rcon "fill $((TX-1)) $((TY+3)) $((TZ-1)) $((TX+1)) $((TY+3)) $((TZ+1)) minecraft:oak_leaves" >/dev/null

curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null
stop_idleguard
rcon "clear $BOT_NAME" >/dev/null
rcon "give $BOT_NAME minecraft:wooden_axe 1" >/dev/null

tp_bot "$((TX+3))" "$TY" "$TZ"
sleep 1.0
stop_idleguard

r=$(start_skill chopTrees "{\"types\":\"oak\",\"count\":1,\"maxDist\":16,\"replant\":false,\"force\":true}")
[[ "$(jget "$r" '.result.ok')" == "true" ]] || fail "start_skill rejected: $r"
final=$(wait_task 60)

trunkGone=$(eval_js "
const cells = [[$TX,$TY,$TZ],[$TX,$((TY+1)),$TZ],[$TX,$((TY+2)),$TZ]];
return cells.every(c => { const b = bot.blockAt(new Vec3(c[0],c[1],c[2])); return !b || b.name === 'air'; });
")
canopyGone=$(eval_js "
const cells = [];
for (let dx=-1; dx<=1; dx++) for (let dz=-1; dz<=1; dz++) cells.push([$TX+dx,$((TY+3)),$TZ+dz]);
return cells.every(c => { const b = bot.blockAt(new Vec3(c[0],c[1],c[2])); return !b || b.name !== 'oak_leaves'; });
")
# leaf decay is legitimately random-ticked and could occasionally clear a cell on its own even
# without this fix -- 'not oak_leaves any more' also passes if it decayed into air naturally
# mid-test, which is fine, that's still "no floating oak_leaves canopy left", the actual thing
# under test. What the fix guarantees and decay alone would not: NONE left, not just some.
noStrayDrops=$(eval_js "
const near = new Vec3($TX, $TY, $TZ);
const items = Object.values(bot.entities).filter(e => e && e.name === 'item' && e.position && e.position.distanceTo(near) < 10);
return items.length;
")

rcon "fill $((TX-8)) $((TY-2)) $((TZ-8)) $((TX+8)) $((TY+8)) $((TZ+8)) minecraft:air" >/dev/null
rcon "forceload remove $((TX-10)) $((TZ-10)) $((TX+10)) $((TZ+10))" >/dev/null

trunkGoneVal=$(jget "$trunkGone" '.result')
canopyGoneVal=$(jget "$canopyGone" '.result')
strayDrops=$(jget "$noStrayDrops" '.result')
felled=$(jget "$final" '.result.task.result.treesFelled')
leavesCleared=$(jget "$final" '.result.task.result.leavesCleared')
errCode=$(jget "$final" '.result.task.error.code')

[[ "$felled" == "1" ]] || fail "tree was not felled at all (treesFelled=$felled, errCode=$errCode)"
assert_eq "$trunkGoneVal" "true" "trunk logs still standing after chopTrees claimed the tree felled"
assert_eq "$canopyGoneVal" "true" "the leaf canopy is still floating after chopTrees -- this is #102's exact bug, the fix did not clear it (leavesCleared=$leavesCleared)"
[[ "$strayDrops" == "0" ]] || fail "$strayDrops drop(s) left uncollected near the felled tree -- canopy clearing must feed the same collection sweep as the logs"

pass "trunk AND canopy both fully cleared (leavesCleared=$leavesCleared), zero drops left behind -- no floating half-felled tree"
