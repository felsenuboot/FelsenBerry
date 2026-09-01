#!/usr/bin/env bash
# Fixture: orphan-goto
# FEEDBACK/research (movement-engines.md §2.5): an abandoned/timed-out goto's promise
# can clear or override a later goal ("The goal was changed" errors) -- goto.js attaches
# 4 listeners per call and removes them in cleanup(); an orphaned goto never cleans up.
# Cheap detector shipped (engine-dev, v8): bot.listenerCount('path_update') > 1 means a
# leaked goto is still alive, surfaced in GET /state.orphanedGoto.
# test: run several normal come tasks in a row (including one to an impossible bedrock
# target, exercising the failure/cleanup path too) and assert orphanedGoto stays false
# throughout -- a regression here means a goto's listeners aren't being cleaned up.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=260; PY=80; PZ=80
build_platform "$PX" "$PY" "$PZ" 8
tp_bot "$PX" "$PY" "$PZ"
sleep 0.5

check_clean() {
  local label="$1"
  local st=$(api_get state)
  local orphan=$(jget "$st" '.orphanedGoto')
  if [[ "$orphan" == "true" ]]; then
    clear_platform "$PX" "$PY" "$PZ" 8
    fail "orphanedGoto:true after $label -- leaked path_update listener detected"
  fi
}

curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null
check_clean "reset"

# 1. a normal successful goto
r=$(start_skill come "{\"x\":$((PX+6)),\"y\":$PY,\"z\":$((PZ+6)),\"range\":1}")
[[ "$(jget "$r" '.result.ok')" == "true" ]] || { clear_platform "$PX" "$PY" "$PZ" 8; fail "goto1 start rejected: $r"; }
wait_task 20 >/dev/null
check_clean "a normal successful goto"

# 2. a failing goto (occupy-solid-bedrock, exercises the error/cleanup path)
BX=$((PX+3)); BZ=$((PZ+3))
rcon "setblock $BX $PY $BZ minecraft:bedrock" >/dev/null
r2=$(start_skill come "{\"x\":$BX,\"y\":$PY,\"z\":$BZ,\"range\":0}")
[[ "$(jget "$r2" '.result.ok')" == "true" ]] || { rcon "setblock $BX $PY $BZ minecraft:air" >/dev/null; clear_platform "$PX" "$PY" "$PZ" 8; fail "goto2 start rejected: $r2"; }
wait_task 40 >/dev/null
rcon "setblock $BX $PY $BZ minecraft:air" >/dev/null
check_clean "a failing (unreachable-target) goto"

# 3. another normal goto right after, back where we started
r3=$(start_skill come "{\"x\":$PX,\"y\":$PY,\"z\":$PZ,\"range\":1}")
[[ "$(jget "$r3" '.result.ok')" == "true" ]] || { clear_platform "$PX" "$PY" "$PZ" 8; fail "goto3 start rejected: $r3"; }
wait_task 20 >/dev/null
check_clean "a third normal goto"

clear_platform "$PX" "$PY" "$PZ" 8
pass
