#!/usr/bin/env bash
# Fixture: dangerscan-canopy (#68 field finding, dangerscan v5)
#
# engine-dev's live diagnosis on the 2026-09-02 Direction-Episodes soak: chopTrees was
# stopping and restarting from zero every ~50.1s, at a near-fixed position, with no error.
# Root cause confirmed via a single __skills.log/__agenda.log read on the live soak bot:
# LIGHT (agenda.js) was firing every cycle, finding nothing to torch, standing itself down,
# then PROJECT resumed and got preempted again next cycle. LIGHT's fire() gates on
# `s.surfaceExposed === false` -- and dangerscan.js's columnOpen() treated ANY solid
# `boundingBox:'block'` overhead as "enclosed", which is exactly what a forest canopy is:
# leaves are solid full cubes. A bot chopping trees stands in daylight under leaves, not
# sealed underground, but the old check couldn't tell the difference.
#
# This tests columnOpen() DIRECTLY (exposed as __danger.columnOpen) rather than going through
# the full surfaceExposed pipeline: lightInfo()'s own skyLight>0 short-circuit makes it hard
# to reliably force the disputed-geometry branch live in a fixture -- RCON-placed blocks did
# not trigger a client-visible relight even after a full reconnect in manual testing (skyLight
# kept reading 15 under a solid 22-block leaf roof), which is server/environment light-caching
# behaviour, not a fact about this fix. columnOpen is a straightforward blockAt scan with no
# light dependency, so calling it directly against REAL placed blocks proves the actual logic
# change without fighting that unrelated flakiness.
#
# Proves BOTH directions, not just the happy path: a leaf ceiling must now return true (open --
# the #68 bug was columnOpen returning false here), and a REAL stone ceiling must still return
# false (the fix must not just always return true, or LIGHT/ESCAPE would stop firing underground
# where they are actually needed).
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=280; PY=90; PZ=200
COLX=$((PX+1)); COLZ=$((PZ+1))
TOP=$((PY+24))

build_platform "$PX" "$PY" "$PZ" 6
# clear well above the platform first -- build_platform only clears up to y+2, and this
# fixture needs the full COLUMN_SCAN window (dy 2..24) to be under its control.
rcon "fill $COLX $((PY+2)) $COLZ $COLX $TOP $COLZ minecraft:air" >/dev/null

cleanup() {
  rcon "fill $COLX $((PY+2)) $COLZ $COLX $TOP $COLZ minecraft:air" >/dev/null
  clear_platform "$PX" "$PY" "$PZ" 6
}

tp_bot "$COLX" "$PY" "$COLZ"
sleep 1.0

hasDanger=$(eval_js "return typeof globalThis.__danger !== 'undefined' && typeof globalThis.__danger.columnOpen === 'function';")
if [[ "$(jget "$hasDanger" '.result')" != "true" ]]; then
  cleanup
  fail "globalThis.__danger.columnOpen is not exposed -- dangerscan.js v5's test-hook export is missing or not installed on this bot"
fi

# ---- case 1: solid leaf canopy overhead, feet+2..feet+24 -- must return true (open) ----
rcon "fill $COLX $((PY+2)) $COLZ $COLX $TOP $COLZ minecraft:oak_leaves" >/dev/null
sleep 0.5
leafBlockName=$(jget "$(eval_js "const b = bot.blockAt(new Vec3($COLX, $((PY+5)), $COLZ)); return { name: b && b.name, boundingBox: b && b.boundingBox };")" '.result.name')
leafOpen=$(jget "$(eval_js "const feet = new Vec3($COLX, $PY, $COLZ); return { open: globalThis.__danger.columnOpen(feet) };")" '.result.open')

# ---- case 2: real stone ceiling, same column -- must still return false (enclosed) ----
rcon "fill $COLX $((PY+2)) $COLZ $COLX $TOP $COLZ minecraft:stone" >/dev/null
sleep 0.5
stoneOpen=$(jget "$(eval_js "const feet = new Vec3($COLX, $PY, $COLZ); return { open: globalThis.__danger.columnOpen(feet) };")" '.result.open')

cleanup

echo "leaf block placed: $leafBlockName" >&2
echo "columnOpen with leaf roof: $leafOpen" >&2
echo "columnOpen with stone roof: $stoneOpen" >&2

[[ "$leafBlockName" == "oak_leaves" ]] || fail "setup failed: expected oak_leaves at the probe cell, got '$leafBlockName' -- the fill may not have landed before the check"
[[ "$leafOpen" == "true" ]] || fail "columnOpen() under a solid oak_leaves roof returned $leafOpen, expected true -- the canopy-vs-ceiling fix is not working, or regressed"
[[ "$stoneOpen" == "false" ]] || fail "columnOpen() under a solid stone roof returned $stoneOpen, expected false -- the leaf-aware fix broke real ceiling detection (LIGHT/ESCAPE would stop firing underground)"

pass "columnOpen correctly treats a solid leaf canopy as open (was: enclosed, the #68 bug) while a real stone ceiling still correctly reads enclosed -- fix is precise, not overcorrected"
