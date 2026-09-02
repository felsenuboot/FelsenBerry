#!/usr/bin/env bash
# Fixture: craft-terrain-seek (#101, skills.js v60)
#
# Live root cause (soak #3, MatschMoritz, 2026-09-02): craftToolChain's alreadyHolding()
# guard correctly refuses to craft a SECOND crafting_table once one is already held and its
# first placeCarriedTable() attempt failed -- a real, deliberate fix from an earlier #84
# investigation (crafting an identical fungible item does not change the geometry that just
# rejected the one already held). But nothing was ever paired with it that tries PLACING the
# held table again from somewhere else -- so a bot stranded on an isolated single-block
# pillar (a self-dug mining leftover, confirmed live: every cell in placeCarriedTable's own
# narrow 8-cell/dy:0-1 search was open air, zero solid faces anywhere) held a table it could
# never place for an entire hour: 177 identical `ensureTool` failures, one position.
#
# Fix: seekPlaceableSpot() (skills.js, an expanding square-ring search bounded to
# TERRAIN_SEEK_RADIUS) looks further than the immediate 8 cells, walks there via gotoT, and
# retries placeCarriedTable() from the new spot -- built as a reusable primitive, not a
# one-off patch, per team-lead's ruling (#97 item 2's eventual generalized recovery wants
# the same "find somewhere workable nearby" search).
#
# Two cases, proving BOTH directions per this session's own doctrine (a fix that only proves
# the happy path is not proven):
#  1. The real pillar shape (isolated single block, all-air 8-cell neighbourhood, a genuine
#     placeable spot a few blocks away) -- ensureTool(sword) must now SUCCEED, and the
#     `steps` trail must show `terrain-seek:` firing (proving the NEW code path ran, not
#     that the pre-existing narrow search got lucky).
#  2. A genuinely marooned bot (nothing placeable within TERRAIN_SEEK_RADIUS at all) --
#     ensureTool(sword) must still fail HONESTLY (a real reason, fast) -- the terrain-seek's
#     whole point is bounded search, not bounded patience.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# full inventory wipe between cases -- /clear only accepts ONE item filter per call, so
# clearing a whitelist of items is NOT the same as clearing everything (found live building
# this fixture: case 2 inherited case 1's freshly-crafted sword and "succeeded" by already
# holding one, never touching the code under test at all).
give_sword_kit() {
  rcon "clear $BOT_NAME" >/dev/null
  rcon "give $BOT_NAME minecraft:oak_planks 6" >/dev/null
  rcon "give $BOT_NAME minecraft:stick 4" >/dev/null
  rcon "give $BOT_NAME minecraft:crafting_table 1" >/dev/null
}

# full heal -- cheap defensive hygiene matching craft-void.sh/chop-canopy.sh convention
# (this fixture can run right after others that leave the bot damaged, e.g. ascend-staircase
# / chop-canopy in the full tier0 suite). Not the fix for the real flake below, just good
# practice on its own.
heal_bot() { rcon "effect give $BOT_NAME minecraft:instant_health 1 9" >/dev/null; }

# ACTUAL root cause of this fixture's flake, found after a long chase (survival.js standdown,
# leaked tasks, low health, and a "teetering on a razor's-edge perch" theory were all chased
# and all wrong): ensureTool(bot, 'sword', {}) -- with no options -- runs its depot-withdrawal
# step BEFORE ever reaching craftToolChain. That step (ctxlessWithdrawTool, skills.js) reads
# the REAL depot coordinates out of protected.json (this repo's live production config, not
# fixture-local) and calls a real gotoT() toward them if the cached coordinate isn't currently
# a container. Those coordinates are nowhere near this fixture's test area, so the pathfinder
# can't complete the route -- but it can and does make partial progress first, walking the bot
# OFF the isolated pillar top and onto the general floor before giving up. From that new
# position, placeCarriedTable's own narrow search legitimately finds a real face nearby (the
# pillar's own side, or the floor itself) and "succeeds" without terrain-seek ever running.
# Every displaced position captured while chasing this (e.g. feet landing one cell over, one
# level down from the pillar top) is consistent with this, not with a teleport slip or a
# stability race. Fix: this fixture is testing craftToolChain specifically, not depot
# withdrawal -- disable it via ensureTool's own opts.depot=false (see the two ensureTool calls
# below) rather than trying to out-race a real travel attempt.
#
# land_on_pillar still exists as ordinary defensive hygiene: tp_bot only confirms X/Z within 3
# blocks and explicitly does NOT check Y ("Y can differ if it fell on arrival -- that's a
# terrain fact for the fixture to handle"), which matters more than usual on a bare 1-wide
# target. Verify the exact landing cell and retry the teleport a bounded number of times.
land_on_pillar() {
  local x="$1" y="$2" z="$3" i pos fx fy fz
  for i in 1 2 3 4 5; do
    tp_bot "$x" "$y" "$z"
    sleep 1.0
    pos=$(eval_js "const f=bot.entity.position.floored(); return [f.x,f.y,f.z];")
    fx=$(jget "$pos" '.result[0]'); fy=$(jget "$pos" '.result[1]'); fz=$(jget "$pos" '.result[2]')
    [[ "$fx" == "$x" && "$fy" == "$y" && "$fz" == "$z" ]] && return 0
    echo "land_on_pillar: landed at $fx,$fy,$fz instead of $x,$y,$z -- retrying ($i/5)" >&2
  done
  return 1
}

echo "=== case 1: isolated pillar rising from CONNECTED ground, genuine walkable spot nearby -- must succeed via terrain-seek ===" >&2
PX=320; PY=90; PZ=320
COLX=$((PX+1)); COLZ=$((PZ+1))
rcon "forceload add $((PX-15)) $((PZ-15)) $((PX+15)) $((PZ+15))" >/dev/null
# A first attempt at this fixture built the landing spot as a disconnected floating platform
# across an open void -- _reachOf (and a real gotoT) correctly refused it: no bounded-drop,
# no-parkour path exists across a multi-block void, matching this codebase's own safe-
# movement rules (maxDropDown etc.), so that was never a fair test. The real MatschMoritz
# incident was a pillar rising from otherwise-CONTINUOUS ground -- build that instead: one
# solid floor across the whole area, 2 blocks below the pillar's own top (comfortably within
# a normal walked step-down), so the pathfinder has a genuine, connected route the whole way.
rcon "fill $((PX-12)) $((PY-8)) $((PZ-12)) $((PX+12)) $((PY+6)) $((PZ+12)) minecraft:air" >/dev/null
rcon "fill $((PX-8)) $((PY-3)) $((PZ-8)) $((PX+8)) $((PY-3)) $((PZ+8)) minecraft:cobblestone" >/dev/null
# the pillar: rises 2 blocks above that general floor, isolated on its own -- explicitly void
# the entire immediate 8-cell/dy:0-1 neighbourhood placeCarriedTable's own search checks (the
# general floor is 2 below that window, so this doesn't touch it), so this case can only
# succeed through the NEW wider search, never the pre-existing narrow one.
rcon "setblock $COLX $((PY-1)) $COLZ minecraft:cobblestone" >/dev/null
rcon "fill $((COLX-1)) $PY $((COLZ-1)) $((COLX+1)) $((PY+1)) $((COLZ+1)) minecraft:air" >/dev/null

# defensive fixture-reset (matches craft-void.sh / chop-canopy.sh convention): a task or
# pathfinder goal left running by whatever fixture ran before this one could otherwise
# interfere with the teleport below.
curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null
heal_bot

give_sword_kit
land_on_pillar "$COLX" "$PY" "$COLZ" || fail "case 1 setup: could not land the bot exactly on the isolated pillar top after 5 attempts (kept sliding off the 1-wide top)"

r1=$(eval_js "return await __skills.ensureTool(bot, 'sword', {depot:false});")
echo "case 1 result: $(jget "$r1" '.result')" >&2

rcon "fill $((PX-12)) $((PY-8)) $((PZ-12)) $((PX+12)) $((PY+6)) $((PZ+12)) minecraft:air" >/dev/null
rcon "forceload remove $((PX-15)) $((PZ-15)) $((PX+15)) $((PZ+15))" >/dev/null

echo "=== case 2: genuinely marooned, nothing placeable within radius -- must fail honestly ===" >&2
PX2=340; PY2=90; PZ2=340
COLX2=$((PX2+1)); COLZ2=$((PZ2+1))
rcon "forceload add $((PX2-15)) $((PZ2-15)) $((PX2+15)) $((PZ2+15))" >/dev/null
# a much bigger void -- nothing solid anywhere within TERRAIN_SEEK_RADIUS(10) except the
# pillar itself, so the ring search must exhaust and fail cleanly
rcon "fill $((PX2-14)) $((PY2-14)) $((PZ2-14)) $((PX2+14)) $((PY2+8)) $((PZ2+14)) minecraft:air" >/dev/null
rcon "setblock $COLX2 $((PY2-1)) $COLZ2 minecraft:cobblestone" >/dev/null

# same defensive reset as case 1, before teleporting (see comment above)
curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null
heal_bot

give_sword_kit
# same 1-wide-pillar landing fragility as case 1 -- doubly worth guarding here since sliding
# off THIS pillar drops the bot into a huge, otherwise-empty void with nothing to catch it.
land_on_pillar "$COLX2" "$PY2" "$COLZ2" || fail "case 2 setup: could not land the bot exactly on the marooned pillar top after 5 attempts"

t0=$(date +%s)
r2=$(eval_js "return await __skills.ensureTool(bot, 'sword', {depot:false});")
t1=$(date +%s)
echo "case 2 result: $(jget "$r2" '.result') (took $((t1-t0))s)" >&2

rcon "fill $((PX2-14)) $((PY2-14)) $((PZ2-14)) $((PX2+14)) $((PY2+8)) $((PZ2+14)) minecraft:air" >/dev/null
rcon "forceload remove $((PX2-15)) $((PZ2-15)) $((PX2+15)) $((PZ2+15))" >/dev/null

ok1=$(jget "$r1" '.result.ok')
how1=$(jget "$r1" '.result.how')
steps1=$(jget "$r1" '.result.steps')
ok2=$(jget "$r2" '.result.ok')
err2=$(jget "$r2" '.result.error')
elapsed2=$((t1-t0))

[[ "$ok1" == "true" ]] || fail "case 1: ensureTool(sword) failed on a solvable pillar -- expected ok:true, got steps: $steps1"
[[ "$how1" == "crafted" ]] || fail "case 1: expected how:crafted, got how:$how1"
[[ "$steps1" == *"terrain-seek:"* ]] || fail "case 1: succeeded WITHOUT the terrain-seek step ever appearing -- this proves nothing about the new code, the old narrow search must have found something (a fixture geometry bug, not a code pass). steps: $steps1"
[[ "$ok2" == "false" ]] || fail "case 2: ensureTool(sword) reported success on a genuinely marooned bot -- the terrain-seek should not have found anything here"
[[ "$err2" == "acquisition_failed" ]] || fail "case 2: expected a real acquisition_failed error, got: $(jget "$r2" '.result')"
[[ "$elapsed2" -lt 40 ]] || fail "case 2: took ${elapsed2}s to fail -- the bounded search should fail fast, not search forever"

pass "terrain-seek walks off a solvable pillar and crafts (case 1, steps confirm the new path ran), and fails honestly and quickly on a genuinely marooned bot (case 2, ${elapsed2}s)"
