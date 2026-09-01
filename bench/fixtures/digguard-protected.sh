#!/usr/bin/env bash
# Fixture: digguard-protected
# digguard.js wraps bot.dig and refuses any block matching a registered protected.json
# region (base infrastructure, coordinate-based -- reads the SAME shared protected.json
# the whole fleet uses, so this fixture is READ-ONLY against it, never mutates the file).
# test: uses the real plaza_1_floor region (box -8,110,-1 to 2,110,9, matches
# cobblestone|dirt|grass_block|stone) -- places a matching block inside the box and
# asserts bot.dig on it is refused, then places the SAME block type just outside the
# box (on a built platform -- this world has unpredictable cave/void terrain at
# arbitrary Y levels, verified live, so a bare coordinate isn't reliably solid ground)
# and asserts that one is diggable normally (confirms the guard is scoped, not
# blanket-refusing everything).
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# inside plaza_1_floor's registered box -- this coordinate has real solid ground
# (verified: repeated teleports here never fell through)
IX=-3; IY=110; IZ=4

# outside it, on a small BUILT platform so footing is guaranteed regardless of this
# world's terrain (z=20 clears every registered region, checked against all 11 entries
# in protected.json)
OPX=-6; OPY=110; OPZ=20
build_platform "$OPX" "$OPY" "$OPZ" 4
OX=$((OPX+1)); OY=$OPY; OZ=$((OPZ+1))

# self-contained tool state: this fixture calls bot.dig() directly (not ctx.digBlock,
# which auto-equips), so it must not assume what a PRIOR fixture left equipped -- found
# live running the full suite in order: chop-canopy ends holding a wooden_axe, which
# made the "outside" stone dig fail on tool_missing, a false failure unrelated to
# digguard. Give+equip a pickaxe explicitly so this fixture's result never depends on
# suite ordering.
rcon "clear $BOT_NAME minecraft:wooden_pickaxe" >/dev/null
rcon "give $BOT_NAME minecraft:wooden_pickaxe 1" >/dev/null
eval_js "try { const pick = bot.inventory.items().find(i => i.name === 'wooden_pickaxe'); if (pick) await bot.equip(pick, 'hand'); return {equipped: bot.heldItem && bot.heldItem.name}; } catch (e) { return {err: e.message}; }" >/dev/null

rcon "setblock $IX $IY $IZ minecraft:stone" >/dev/null
rcon "setblock $OX $OY $OZ minecraft:stone" >/dev/null
sleep 1.0

# reachguard.js is also active on this bot (rejects out-of-range dig attempts with
# reach_violation) -- teleport within reach of EACH target before its dig, otherwise a
# failure could be reachguard doing its job, not digguard, and this fixture would be
# testing the wrong thing.
tp_bot "$IX" "$IY" "$((IZ+1))"
sleep 0.5
r1=$(eval_js "
const inside = bot.blockAt(new Vec3($IX, $IY, $IZ));
try { await bot.dig(inside); return { insideRefused: false }; }
catch (e) { return { insideRefused: true, insideErr: e.message }; }
")
tp_bot "$((OX-1))" "$OY" "$OZ"
sleep 0.5
r2=$(eval_js "
const outside = bot.blockAt(new Vec3($OX, $OY, $OZ));
try { await bot.dig(outside); return { outsideDug: true }; }
catch (e) { return { outsideDug: false, outsideErr: e.message }; }
")
insideRefused=$(jget "$r1" '.result.insideRefused')
insideErr=$(jget "$r1" '.result.insideErr')
outsideDug=$(jget "$r2" '.result.outsideDug')
outsideErr=$(jget "$r2" '.result.outsideErr')

clear_platform "$OPX" "$OPY" "$OPZ" 4
# NOTE: do not clear $IX/$IY/$IZ -- that coordinate is real base infrastructure
# (plaza_1's registered floor) if this were ever pointed at the main server; harmless
# no-op on the local fixture world where it's just a placed stone block, left as-is
# since digguard already proved it can't be dug (that's the point).

assert_true "$insideRefused" "dig on a block INSIDE plaza_1_floor's registered region was NOT refused (err=$insideErr) -- protection regressed"
assert_true "$outsideDug" "dig on an identical block type OUTSIDE any registered region was refused too (err=$outsideErr) -- guard is over-scoping, not just protecting what it should"
pass
