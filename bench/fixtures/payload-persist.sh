#!/usr/bin/env bash
# Fixture: payload-persist
# FEEDBACK ("injection reports can drift from reality" + engine-dev's later CORRECTION:
# payloads do NOT survive a reconnect, they only look like they do): a reconnect builds
# a FRESH bot object while globalThis survives, so naive presence checks kept reporting
# "installed:true" on payloads whose listeners were actually bound to the dead bot
# object. Shipped fix: v8's auto-inject-per-spawn (bot.on('spawn'), not once) re-installs
# the full stack on every spawn including reconnect; v10's __payloads staleness registry
# (GET /state.stalePayloads) makes drift detectable even in the gap before re-install
# completes.
# test: force a REAL reconnect (RCON kick, not a simulated one), then poll GET /state
# until reconnected and assert stalePayloads is empty and the core payloads report
# fresh versions -- not just "present".
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

before=$(api_get state)
skillsVerBefore=$(jget "$before" '.payloads.skills')

rcon "kick $BOT_NAME fixture: forced reconnect test" >/dev/null
sleep 1.0

# wait for the runner's auto-reconnect (exponential backoff, capped 30s) to land
reconnected="false"
for i in $(seq 1 40); do
  st=$(api_get state)
  if [[ "$(jget "$st" '.connected')" == "true" ]]; then reconnected="true"; break; fi
  sleep 1
done
assert_true "$reconnected" "bot did not reconnect within 40s of an RCON kick"

# give applyPayloadStack a moment to finish (it's a sequential async chain, not instant)
sleep 2
after=$(api_get state)
stale=$(jget "$after" '.stalePayloads')
skillsVerAfter=$(jget "$after" '.payloads.skills')
digguardAfter=$(jget "$after" '.payloads.digguard')

if [[ "$stale" != "[]" ]]; then
  fail "stalePayloads is non-empty after reconnect: $stale -- a payload didn't re-bind to the new bot object"
fi
if [[ -z "$skillsVerAfter" || "$skillsVerAfter" == "null" || "$skillsVerAfter" == "false" ]]; then
  fail "skills payload missing entirely after reconnect (was v$skillsVerBefore before)"
fi
if [[ -z "$digguardAfter" || "$digguardAfter" == "null" || "$digguardAfter" == "false" ]]; then
  fail "digguard payload missing after reconnect"
fi
pass
