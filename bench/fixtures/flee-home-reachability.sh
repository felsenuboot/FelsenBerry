#!/usr/bin/env bash
# Fixture: flee-home-reachability (#98)
#
# pick()'s FLEE_HOME routing used to choose on straight-line distance to home alone --
# terrain, water, or a cliff between here and home only surfaced after branchFleeHome had
# already committed up to 30s of ownedGoto to it, exposed to whatever threat triggered the
# flee the whole time. Fixed by gating the routing decision on S.reachOf(bot, g.home)
# (skills.js's own proven no-movement getPathTo probe, exposed for exactly this reuse)
# before committing.
#
# Two real geometries, one open (home reachable) and one sealed (home NOT reachable, same
# straight-line distance class), same fabricated melee threat both times -- proves the gate
# fires correctly in BOTH directions, not just that it doesn't crash.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

has98=$(eval_js "return Boolean(globalThis.__survival && globalThis.__skills && typeof globalThis.__skills.reachOf === 'function');")
if [[ "$(jget "$has98" '.result')" != "true" ]]; then
  echo '{"skipped":"S.reachOf not exposed -- engine predates #98"}'
  exit 0
fi

hp=$(eval_js "return bot.health;")
if [[ -z "$(jget "$hp" '.result')" || "$(jget "$hp" '.result')" == "null" ]]; then
  fail "bot not reachable"
fi

# ---- geometry: an OPEN platform (the reachable "home") and a SEALED box (unreachable,
# same straight-line distance class), both anchored off the bot's own current position so
# this fixture works anywhere the bot happens to be. ----
BOT_POS=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];")
BX=$(echo "$BOT_POS" | jq -r '.result[0]')
BY=$(echo "$BOT_POS" | jq -r '.result[1]')
BZ=$(echo "$BOT_POS" | jq -r '.result[2]')

HOME_X=$((BX + 60)); HOME_Y=$BY; HOME_Z=$BZ
OPEN_START_X=$((BX + 55))
SEALED_X=$((BX + 30)); SEALED_Y=$BY; SEALED_Z=$BZ

cleanup() {
  rcon "fill $((OPEN_START_X-2)) $((BY-1)) $((BZ-2)) $((HOME_X+6)) $((BY+3)) $((BZ+6)) minecraft:air" >/dev/null 2>&1 || true
  rcon "fill $((SEALED_X-1)) $((BY-1)) $((SEALED_Z-1)) $((SEALED_X+5)) $((BY+4)) $((SEALED_Z+5)) minecraft:air" >/dev/null 2>&1 || true
  rcon "kill @e[type=minecraft:zombie,distance=..80]" >/dev/null 2>&1 || true
  eval_js "if (globalThis.__survival && globalThis.__savedHome98) { globalThis.__survival.home.x=globalThis.__savedHome98.x; globalThis.__survival.home.y=globalThis.__savedHome98.y; globalThis.__survival.home.z=globalThis.__savedHome98.z; delete globalThis.__savedHome98; }" >/dev/null
}
trap cleanup EXIT

# a single open corridor/platform connecting OPEN_START_X..HOME_X at ground level
build_platform "$OPEN_START_X" "$BY" "$((BZ-1))" 3
rcon "fill $OPEN_START_X $BY $BZ $HOME_X $((BY+2)) $BZ minecraft:air" >/dev/null
rcon "fill $OPEN_START_X $((BY-1)) $BZ $HOME_X $((BY-1)) $BZ minecraft:stone" >/dev/null
build_platform "$HOME_X" "$BY" "$((BZ-1))" 3

# a fully sealed box, no connection to anything, same distance class as the open case
rcon "fill $SEALED_X $((SEALED_Y-1)) $SEALED_Z $((SEALED_X+4)) $((SEALED_Y+3)) $((SEALED_Z+4)) minecraft:stone" >/dev/null
rcon "fill $((SEALED_X+1)) $SEALED_Y $((SEALED_Z+1)) $((SEALED_X+3)) $((SEALED_Y+1)) $((SEALED_Z+3)) minecraft:air" >/dev/null

# point __survival.home at the OPEN platform, saving the real value for cleanup
eval_js "globalThis.__savedHome98 = Object.assign({}, __survival.home); __survival.home.x=$HOME_X; __survival.home.y=$BY; __survival.home.z=$BZ;" >/dev/null

fabricate_and_trigger() {
  eval_js "
    bot.health = 15; bot.food = 20;
    globalThis.__danger = { threats: [{ name: 'zombie', d: 5, ranged: false, los: false }] };
    __survival.standdown = null; __survival.lastEnd = 0;
    const t0 = Date.now();
    await __survival.trigger('hp');
    return { elapsed: Date.now() - t0, branch: __survival.lastBranch, pos: bot.entity.position };
  "
}

# ---- case 1: home genuinely reachable -> FLEE_HOME, real travel ----
tp_bot "$OPEN_START_X" "$BY" "$BZ" || fail "setup: could not place bot on the open platform"
sleep 0.5
r1=$(fabricate_and_trigger)
branch1=$(jget "$r1" '.result.branch')
elapsed1=$(jget "$r1" '.result.elapsed')

# ---- case 2: home distance-eligible but genuinely sealed off -> falls through, not FLEE_HOME ----
rcon "kill @e[type=minecraft:zombie,distance=..80]" >/dev/null 2>&1 || true
tp_bot "$((SEALED_X+2))" "$SEALED_Y" "$((SEALED_Z+2))" || fail "setup: could not place bot in the sealed box"
sleep 0.5
r2=$(fabricate_and_trigger)
branch2=$(jget "$r2" '.result.branch')
elapsed2=$(jget "$r2" '.result.elapsed')

if [[ "$branch1" != "FLEE_HOME" ]]; then
  fail "case 1 (home reachable): expected branch FLEE_HOME, got $branch1 -- reachability gate is rejecting a genuinely reachable home"
fi
if ! awk -v e="$elapsed1" 'BEGIN{exit !(e > 500)}' 2>/dev/null; then
  fail "case 1 (home reachable): resolved in ${elapsed1}ms -- too fast to be real travel, FLEE_HOME may not have actually run"
fi
if [[ "$branch2" == "FLEE_HOME" ]]; then
  fail "case 2 (home sealed off): FLEE_HOME still fired despite home being genuinely unreachable -- the #98 gate is not working"
fi
if ! awk -v e="$elapsed2" 'BEGIN{exit !(e < 500)}' 2>/dev/null; then
  fail "case 2 (home sealed off): took ${elapsed2}ms to fall through -- should be near-instant (WALL_OFF's own no-filler/critical-hp fast paths), not a 30s burn"
fi

pass "case 1: home reachable -> FLEE_HOME, real travel (${elapsed1}ms). case 2: home sealed -> $branch2, fell through in ${elapsed2}ms (no 30s burn)"
