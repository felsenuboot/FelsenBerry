#!/usr/bin/env bash
# Fixture: reposition-cleanstate (#54, skills.js v58)
#
# engine-dev's second-pass #54 diagnosis (FEEDBACK.md 2026-09-02) found a real, previously
# undocumented robustness gap: `_reposition()` never cleared any inherited movement control
# state before walking. Two demonstrated failure modes, both reproduced deterministically on
# the real staged R2 wedge geometry: (1) sneak left active (inheritable from whatever ran
# immediately before `_reposition`, e.g. the pathfinder library) blocks walking off a ledge in
# vanilla entirely -- 3/3 fail, `candidateFound:true` but the bot barely moves and the drop
# never completes; (2) chaining onto `_unstick`'s own airborne state (zero settle, residual
# velocity) reliably overshoots past the candidate instead -- 5/5, `displaced:true` but
# `reachedTarget:false`. Both are qualitative matches for the original wedge's exact symptom.
#
# Fix (skills.js v58): `_reposition` now explicitly clears sneak/sprint/back/left/right and
# waits briefly (capped ~400ms, never open-ended -- onGround is separately known to stick
# false forever on some feet blocks, see goto()'s own leaf_litter comment) for onGround before
# issuing its own forward+jump.
#
# This fixture builds its OWN small gap (not the archived world-race2 wedge, which TODO.md
# says must stay untouched) on the local test server, so it's a normal preflight-style
# regression rather than a one-off diagnostic. It calls the REAL `_reposition()` via
# `S.recoveryDetect.reposition()` (added alongside this fix specifically so this never again
# needs a genuinely-staged wedge to test against) -- not a hand-copied replay of its logic,
# which is exactly the #38-doctrine failure mode of a hook that can silently drift from the
# code it claims to verify.
#
# TWO GEOMETRY BUGS found and fixed while building this (neither is a skills.js bug, both are
# recorded here so the next person doesn't re-discover them the slow way):
#  1. The first attempt left the column between the bot and the dip solid, so a plain
#     forward+jump just hopped clean over a 1-tile pit in a repeating bunny-hop arc instead of
#     making the real fall-across-a-gap traverse `_reposition` is meant for. Fix: the ENTIRE
#     approach column (MX) is a full-depth void, same as the landing column (DX) above its
#     floor -- a real gap, not a hoppable divot.
#  2. Case B's injected residual velocity, in a wide-open platform with nothing to bound it,
#     let the bot drift arbitrarily far during the settle wait (no side walls -> no friction/
#     collision to arrest horizontal drift, unlike a real confined wedge pocket). Fix: wall in
#     a 1-wide-in-Z corridor (real wedges are confined spaces, not open plains -- this is
#     actually the MORE faithful geometry, not a workaround) and use a modest injected velocity
#     (a real `_unstick`-adjacent bounce, not an exaggerated one) so the capped onGround-settle
#     wait gets a genuine chance to work as designed.
#
# Proves three things, not just the happy path: a clean baseline still succeeds (no
# regression), forced sneak now succeeds (was 3/3 fail), and a simulated post-unstick airborne
# state now genuinely REACHES the candidate rather than merely being "displaced" (the old
# overshoot failure was ALSO displaced:true, so that field alone can't tell fixed from broken --
# this checks the real final distance to the candidate instead).
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=340; PY=90; PZ=260
BX=$((PX+1)); BZ=$((PZ+1))        # bot's standing cell
MX=$((BX+1))                      # approach column -- must be a full void, see bug #1 above
DX=$((BX+2))                      # REPOSITION_OFFSETS' first-priority offset is [2,0]
WZ1=$((BZ-1)); WZ2=$((BZ+1))      # corridor walls, one block either side of the bot's Z -- see bug #2

# A 1-wide-in-Z corridor: solid walls at WZ1/WZ2, floor+ceiling, a real void gap at MX/DX above
# the landing floor. Self-contained so this fixture owns its own world.
build_geometry() {
  rcon "fill $PX $((PY-4)) $WZ1 $((PX+5)) $((PY+3)) $WZ1 minecraft:stone" >/dev/null
  rcon "fill $PX $((PY-4)) $WZ2 $((PX+5)) $((PY+3)) $WZ2 minecraft:stone" >/dev/null
  rcon "fill $PX $((PY-4)) $BZ $((PX+5)) $((PY+3)) $BZ minecraft:air" >/dev/null
  rcon "fill $PX $((PY+3)) $BZ $((PX+5)) $((PY+3)) $BZ minecraft:stone" >/dev/null   # ceiling
  rcon "fill $PX $((PY-1)) $BZ $((PX+5)) $((PY-1)) $BZ minecraft:stone" >/dev/null   # floor (bot's tile + apron)
  rcon "fill $MX $((PY-4)) $BZ $DX $((PY-1)) $BZ minecraft:air" >/dev/null           # the gap itself
  rcon "fill $DX $((PY-3)) $BZ $DX $((PY-3)) $BZ minecraft:stone" >/dev/null         # landing, 2 below the bot
}
build_geometry

cleanup() {
  rcon "fill $PX $((PY-4)) $WZ1 $((PX+5)) $((PY+3)) $WZ2 minecraft:air" >/dev/null
}

# tp_bot's own confirmation deliberately checks only X/Z ("Y can differ if it fell on
# arrival -- that's a terrain fact for the fixture to handle, not a teleport-confirmation
# concern"). Found live building this fixture: occasionally the bot lands, then free-falls
# straight through into whatever natural terrain sits below this corridor's floor before
# physics registers it standing on the just-built stone -- tp_bot reports success throughout
# because X/Z never moved. Verify Y explicitly here and rebuild+retry once, the same
# self-healing shape as tp_bot's own relog-retry just below it in common.sh.
land_on_floor() {
  for attempt in 1 2; do
    tp_bot "$BX" "$PY" "$BZ" >/dev/null
    sleep 1.0
    local y
    y=$(jget "$(eval_js "return bot.entity.position.y;")" '.result')
    if awk -v a="$y" -v b="$PY" 'BEGIN{exit !(sqrt((a-b)^2) < 2)}' 2>/dev/null; then
      return 0
    fi
    echo "land_on_floor: landed at y=$y, expected ~$PY -- rebuilding geometry and retrying" >&2
    build_geometry
    sleep 0.5
  done
  return 1
}

if ! land_on_floor; then
  cleanup
  fail "could not land the bot on the built floor after a rebuild+retry -- see land_on_floor's own warning above for the observed y"
fi

hasHook=$(eval_js "return typeof globalThis.__skills.recoveryDetect.reposition === 'function';")
if [[ "$(jget "$hasHook" '.result')" != "true" ]]; then
  cleanup
  fail "S.recoveryDetect.reposition is not exposed -- skills.js v58's test hook is missing or not installed on this bot"
fi

run_case() {
  local label="$1" setupJs="$2"
  if ! land_on_floor; then
    cleanup
    fail "$label: could not land the bot on the built floor after a rebuild+retry"
  fi
  # A plain /tp does not clear residual velocity from whatever ran immediately before --
  # exactly the class of leftover state this fixture exists to guard against, so zero it
  # explicitly and let the bot fully settle before each case, otherwise one case's artificial
  # velocity/control-state can bleed into the next.
  eval_js "bot.entity.velocity.set(0,0,0); bot.setControlState('sneak', false);" >/dev/null
  sleep 1.0
  local r
  r=$(eval_js "
$setupJs
const res = await __skills.recoveryDetect.reposition();
const dist = res.candidate ? bot.entity.position.distanceTo(new Vec3(res.candidate.x, res.candidate.y, res.candidate.z)) : null;
return { ...res, distToCandidate: dist, reachedTarget: dist != null && dist <= 1.2 };
")
  echo "$label: $(jget "$r" '.result')" >&2
  echo "$r"
}

baseline=$(run_case "baseline (clean state)" "")
sneak=$(run_case "case A (sneak forced active)" "bot.setControlState('sneak', true);")
# Modest injected bounce (not an exaggerated one -- see bug #2 above): enough to force
# onGround:false and real residual horizontal drift, small enough that the fix's capped
# settle-wait can genuinely dissipate it via ground contact, same as a real `_unstick`-adjacent
# bounce would.
airborne=$(run_case "case B (residual velocity, onGround false)" \
  "bot.entity.velocity.set(0.15, 0.12, 0.15); bot.entity.onGround = false;")

cleanup

for pair in "baseline:$baseline" "sneak:$sneak" "airborne:$airborne"; do
  label="${pair%%:*}"; json="${pair#*:}"
  cf=$(jget "$json" '.result.candidateFound')
  rt=$(jget "$json" '.result.reachedTarget')
  [[ "$cf" == "true" ]] || fail "$label: candidateFound=$cf, expected true -- the dip geometry isn't being found at all"
  [[ "$rt" == "true" ]] || fail "$label: reachedTarget=$rt, expected true -- _reposition did not genuinely reach the candidate (displaced alone is not enough, see this fixture's own header)"
done

pass "clean baseline, forced-sneak, and post-unstick-airborne all genuinely reach the candidate -- _reposition no longer trusts inherited control state (#54, skills v58)"
