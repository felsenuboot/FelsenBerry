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

# poll_column_open / poll_block_name -> retry a few times before accepting an answer.
#
# 2026-09-02 postmortem (engine-dev-3): this fixture originally called columnOpen() once
# and appeared to fail every run -- "columnOpen with stone roof: null" instead of the
# expected false. A live trace (10 back-to-back queries, 0.2s apart) showed columnOpen()
# actually returning `false` -- correctly -- on EVERY SINGLE try; the "null" was never
# real. Root cause was in common.sh's jget(), not here: `jq -r "$2 // \"null\""` uses
# jq's `//` alternative operator, which treats a legitimate JSON `false` the same as
# null/missing, so jget silently turned a correct `false` into the string "null" every
# time. Fixed at the source in jget() (see its comment in common.sh) -- that alone makes
# this fixture reliably green. These two retry helpers are kept anyway as cheap, honest
# defensive hardening against a DIFFERENT, genuinely-observed (if rare) race: a fresh
# RCON fill occasionally reads back as still-air, or blockAt as unloaded, for one beat --
# the same class of transient tp_bot() already retries past above.
poll_column_open() {
  local tries=0 result
  while (( tries < 10 )); do
    result=$(jget "$(eval_js "const feet = new Vec3($COLX, $PY, $COLZ); return { open: globalThis.__danger.columnOpen(feet) };")" '.result.open')
    [[ "$result" != "null" ]] && { echo "$result"; return; }
    sleep 0.2
    tries=$((tries+1))
  done
  echo "$result"
}
# poll_block_name <y> <want> -> same idea for the raw blockAt setup-verification probe.
poll_block_name() {
  local y="$1" want="$2" tries=0 name=''
  while (( tries < 10 )); do
    name=$(jget "$(eval_js "const b = bot.blockAt(new Vec3($COLX, $y, $COLZ)); return { name: b && b.name };")" '.result.name')
    [[ "$name" == "$want" ]] && { echo "$name"; return; }
    sleep 0.2
    tries=$((tries+1))
  done
  echo "$name"
}

# ---- case 1: solid leaf canopy overhead, feet+2..feet+24 -- must return true (open) ----
rcon "fill $COLX $((PY+2)) $COLZ $COLX $TOP $COLZ minecraft:oak_leaves" >/dev/null
sleep 0.5
leafBlockName=$(poll_block_name $((PY+5)) "oak_leaves")
leafOpen=$(poll_column_open)

# ---- case 2: real stone ceiling, same column -- must still return false (enclosed) ----
rcon "fill $COLX $((PY+2)) $COLZ $COLX $TOP $COLZ minecraft:stone" >/dev/null
sleep 0.5
stoneOpen=$(poll_column_open)

cleanup

echo "leaf block placed: $leafBlockName" >&2
echo "columnOpen with leaf roof: $leafOpen" >&2
echo "columnOpen with stone roof: $stoneOpen" >&2

[[ "$leafBlockName" == "oak_leaves" ]] || fail "setup failed: expected oak_leaves at the probe cell, got '$leafBlockName' -- the fill may not have landed before the check"
[[ "$leafOpen" == "true" ]] || fail "columnOpen() under a solid oak_leaves roof returned $leafOpen, expected true -- the canopy-vs-ceiling fix is not working, or regressed"
[[ "$stoneOpen" == "false" ]] || fail "columnOpen() under a solid stone roof returned $stoneOpen, expected false -- the leaf-aware fix broke real ceiling detection (LIGHT/ESCAPE would stop firing underground)"

pass "columnOpen correctly treats a solid leaf canopy as open (was: enclosed, the #68 bug) while a real stone ceiling still correctly reads enclosed -- fix is precise, not overcorrected"
