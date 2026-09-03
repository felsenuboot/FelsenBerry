#!/usr/bin/env bash
# Fixture: respawn-episode (#103, agenda.js v28)
#
# A death/respawn should open a needs_direction episode IMMEDIATELY, not wait out
# unproductive_idle's 120s window (research/IDLE_TRIGGER_SPEC.md's E2 trigger) -- a bot that
# just died is PROVABLY projectless and idle, not probably.
#
# Genuinely tricky wiring, not a bare event-to-openEpisode call: runner.js's own 'spawn'
# handler re-runs applyPayloadStack on every spawn "including death-respawn" (its own
# comment) -- which re-injects agenda.js ITSELF, fresh, wiping the whole module's state
# (a new `A`, direction.episode:null) in the SAME breath a naive 'death' listener would fire.
# The fix threads the signal through a flag on the BOT object (bot._respawnedNeedsDirection
# -- survives re-injection; a reconnect creates a fresh bot object, so this correctly never
# fires for a plain reconnect/kick, only a real death), read directly by directionCheck every
# tick rather than snapshotted once at module-init (live-caught during this fixture's own
# development: an overlapping double re-injection -- a reconnect immediately followed by a
# death, close enough together to re-inject agenda.js twice in ~100ms -- lost a
# module-init-snapshotted flag entirely; reading it live each tick is immune to that race).
#
# This fixture proves the live behavior directly, not a dry-run replay: A.step()'s
# injected-snapshot hook does NOT call directionCheck at all (only choose()) -- direction
# detection is a live-tick-only concern by design, so there is no dry-run equivalent to add
# to bench/fixtures/agenda-ladder.js for this. Three real cases:
#   1. A real death (RCON kill) -> a 'respawned' episode opens, fast.
#   2. Assigning a project answers it, like any other episode -> it closes.
#   3. A plain reconnect (RCON kick, no death) -> does NOT spuriously open one.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

hasAgenda=$(eval_js "return typeof globalThis.__agenda !== 'undefined' && typeof globalThis.__agenda.snapshot === 'function';")
[[ "$(jget "$hasAgenda" '.result')" == "true" ]] || fail "globalThis.__agenda is not installed on this bot (needs --agenda)"

direction() { eval_js "return globalThis.__agenda.snapshot().direction;"; }

# make sure the bot is fully connected before touching it -- a kill issued mid-reconnect can
# land before agenda.js's own death listener is even registered, which this fixture's own
# development caught as a false negative unrelated to the code under test.
wait_connected() {
  local i
  for i in $(seq 1 20); do
    [[ "$(jget "$(api_get state)" '.connected')" == "true" ]] && return 0
    sleep 1
  done
  return 1
}
wait_connected || fail "bot never reported connected -- cannot start"

# clear any episode already open from a previous run against this same bot -- openEpisode's
# own single-latch (at most one open episode) would otherwise silently swallow case 1's kill.
# NOTE on `opened`/`closed`: these are per-injection counters, not a global lifetime total --
# a fresh agenda.js injection (every spawn, including a plain reconnect) resets them to 0
# alongside everything else in `A`. So the assertions below check the `why` STRING directly,
# never these counts across a kill/kick boundary (a first draft of this fixture compared
# `opened` before vs after and false-failed every time for exactly this reason -- caught live
# writing it, not a defect in the code under test).
eval_js "return globalThis.__agenda.setProject({skill:'chopTrees', tool:'axe', args:{count:1}, restockFloor:{torches:0,food:2,filler:0}});" >/dev/null
sleep 1

# ---- case 1: a real death opens the episode, fast ----
rcon "kill $BOT_NAME" >/dev/null

opened="false"
i=0
while (( i < 20 )); do
  d=$(direction)
  why=$(jget "$d" '.result.why')
  if [[ "$why" == "respawned" ]]; then opened="true"; break; fi
  sleep 1
  ((i++))
done
[[ "$opened" == "true" ]] || fail "case 1: no 'respawned' direction episode opened within 20s of a real death (last direction: $(direction))"
echo "case 1: respawned episode opened ($(direction))" >&2

# ---- case 2: answering it (a project) closes it, exactly like any other episode ----
eval_js "return globalThis.__agenda.setProject({skill:'chopTrees', tool:'axe', args:{count:1}, restockFloor:{torches:0,food:2,filler:0}});" >/dev/null
closed="false"
i=0
while (( i < 15 )); do
  d=$(direction)
  st=$(jget "$d" '.result.state')
  if [[ "$st" == "ok" ]]; then closed="true"; break; fi
  sleep 1
  ((i++))
done
[[ "$closed" == "true" ]] || fail "case 2: episode did not close after a project was assigned (last direction: $(direction))"
echo "case 2: episode closed after a project was assigned ($(direction))" >&2

# ---- case 3: a plain reconnect (no death) must NOT spuriously open one ----
eval_js "return __skills.stop('respawn-episode fixture reset');" >/dev/null
rcon "kick $BOT_NAME respawn-episode: forcing a plain reconnect, no death" >/dev/null
wait_connected || fail "case 3: bot never reconnected after the kick"

# poll across several of the fresh injection's own early ticks -- if it were going to fire
# spuriously, it would do so on the very first one.
i=0
while (( i < 6 )); do
  why3=$(jget "$(direction)" '.result.why')
  [[ "$why3" != "respawned" ]] || fail "case 3: a plain reconnect (no death) spuriously opened a 'respawned' direction episode (last direction: $(direction)) -- the bot-object flag should never survive a reconnect (a fresh bot object) if it isn't set by a real death"
  sleep 1
  ((i++))
done
echo "case 3: plain reconnect did not spuriously open an episode ($(direction))" >&2

pass "death opens a 'respawned' episode within seconds (was: waits out unproductive_idle's 120s window), a project assignment closes it like any other episode, and a plain reconnect (no death) does not spuriously fire it"
