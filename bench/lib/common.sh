#!/usr/bin/env bash
# bench/lib/common.sh — shared helpers for Tier-0 fixtures. Source, don't execute.
# Pure bash+curl+jq (+ node only for the RCON binary protocol, via rcon.mjs).
set -uo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$BENCH_DIR/lib"

# ---- config (env-overridable; defaults target the local fixture server) ----
BOT_PORT="${BOT_PORT:?common.sh: BOT_PORT must be set by the caller}"
RCON_HOST="${RCON_HOST:-127.0.0.1}"
RCON_PORT="${RCON_PORT:-25598}"
RCON_PASS="${RCON_PASS:-fellocal123}"

# ---- RCON ----
# rcon "<command>" -> prints the server's response, one command per call.
rcon() {
  node "$LIB_DIR/rcon.mjs" "$RCON_HOST" "$RCON_PORT" "$RCON_PASS" "$1" 2>&1
}

# ---- bot HTTP API ----
api_get() { curl -s --max-time 5 "http://127.0.0.1:$BOT_PORT/$1"; }
api_post() { curl -s --max-time 10 -X POST "http://127.0.0.1:$BOT_PORT/$1" -H 'Content-Type: application/json' -d "$2"; }

# BOT_NAME: bench.sh exports it; standalone fixture runs (dev/debug) fetch it themselves.
if [[ -z "${BOT_NAME:-}" ]]; then
  BOT_NAME=$(api_get state | jq -r '.name // ""')
fi

# tp_bot <x> <y> <z> -> teleport the bench bot via RCON (test-fixture setup only,
# never used by production skills — fixtures are allowed to use admin commands to build
# deterministic scenarios, that's the whole point of a local fixture server). VERIFIES
# the teleport actually landed via the bot's own reported position before returning —
# found live (chop-canopy flake): an RCON tp can succeed server-side while the bot's own
# GET /state still reports its old position for a beat, and fixtures that proceeded
# immediately picked up stale coordinates, silently operating on the wrong location.
_tp_bot_once() {
  local x="$1" y="$2" z="$3"
  rcon "tp $BOT_NAME $x $y $z" >/dev/null
  local i
  for i in 1 2 3 4 5 6 7 8; do
    local pos; pos=$(api_get state)
    local px pz
    px=$(jq -r '.position.x // 999999' <<<"$pos" 2>/dev/null)
    pz=$(jq -r '.position.z // 999999' <<<"$pos" 2>/dev/null)
    # within 3 blocks in X/Z is "landed" (Y can differ if it fell on arrival -- that's a
    # terrain fact for the fixture to handle, not a teleport-confirmation concern)
    if awk -v a="$px" -v b="$x" 'BEGIN{exit !(sqrt((a-b)^2) < 3)}' 2>/dev/null && \
       awk -v a="$pz" -v b="$z" 'BEGIN{exit !(sqrt((a-b)^2) < 3)}' 2>/dev/null; then
      return 0
    fi
    sleep 0.3
  done
  return 1
}

# stop_idleguard -> EVALUATION.md §4 doctrine: bench bot runs WITHOUT idleguard during
# measured scenarios. It can auto-arm/activate transiently (observed live during harness
# development: it wandered the bot and ran a background depositToChest mid-fixture,
# silently invalidating the scenario) -- call this defensively right before any
# assertion-critical action, not just once at suite start.
stop_idleguard() {
  curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' \
    -d '{"code":"if (globalThis.__idleguard && globalThis.__idleguard.stop) { globalThis.__idleguard.stop(); }"}' >/dev/null
}

# tp_bot <x> <y> <z> -> teleport with confirmation, self-healing once against the
# "corrupt chunk geometry" client freeze (felcrew-mcp#20 -- server-side position moves,
# but the bot's own physics state stops updating; the documented remedy is a relog once
# it's off the corrupt block, but a plain teleport doesn't move it off first). If the
# first teleport doesn't confirm, force a relog via RCON kick (auto-reconnect picks the
# bot back up) and retry the SAME teleport once before giving up -- observed live during
# harness development: this reliably unsticks it.
tp_bot() {
  local x="$1" y="$2" z="$3"
  if _tp_bot_once "$x" "$y" "$z"; then return 0; fi
  echo "tp_bot: teleport to $x $y $z didn't confirm -- forcing a relog (suspected corrupt-geometry freeze, felcrew-mcp#20) and retrying once" >&2
  rcon "kick $BOT_NAME bench: unsticking a stuck client" >/dev/null
  local i
  for i in $(seq 1 30); do
    local st; st=$(api_get state)
    [[ "$(jq -r '.connected // false' <<<"$st" 2>/dev/null)" == "true" ]] && break
    sleep 1
  done
  sleep 1
  if _tp_bot_once "$x" "$y" "$z"; then return 0; fi
  echo "tp_bot: WARNING -- teleport to $x $y $z still did not confirm after a relog retry" >&2
  return 1
}

# build_platform <x> <y> <z> [size] -> a solid, open, flat <size>x<size> stone platform
# with 2 blocks of headroom at (x,y,z) as its corner. This local fixture world has
# unpredictable cave/void terrain at arbitrary Y levels (verified live), so any fixture
# needing guaranteed solid ground builds its own rather than assuming one exists.
build_platform() {
  local x="$1" y="$2" z="$3" size="${4:-8}"
  local x2=$((x + size - 1)) z2=$((z + size - 1))
  rcon "fill $x $((y-1)) $z $x2 $((y-1)) $z2 minecraft:stone" >/dev/null
  rcon "fill $x $y $z $x2 $((y+2)) $z2 minecraft:air" >/dev/null
}
# clear_platform <x> <y> <z> [size] -> undo build_platform's footprint after a fixture.
clear_platform() {
  local x="$1" y="$2" z="$3" size="${4:-8}"
  local x2=$((x + size - 1)) z2=$((z + size - 1))
  rcon "fill $x $((y-1)) $z $x2 $((y+2)) $z2 minecraft:air" >/dev/null
}

# eval_js "<code>" -> the JSON result of __skills-scope /eval (bot,mineflayer,pathfinder,goals,Vec3 in scope)
eval_js() {
  local code="$1"
  jq -Rs '{code:.}' <<<"$code" | curl -s --max-time 15 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d @-
}

# start_skill <name> <argsJson> -> {ok,taskId} (fire-and-forget)
start_skill() {
  local name="$1" args="$2"
  eval_js "return __skills.start(bot, '$name', $args);"
}

# wait_task [timeoutSec] -> prints the FINAL status JSON once task.running is false
# (polls every 1s; local fixtures are short by design, N=1, no token cost since this
# is bash polling the HTTP API directly, not an LLM).
wait_task() {
  local timeout="${1:-60}" waited=0
  while (( waited < timeout )); do
    local status
    status=$(eval_js "return __skills.status(bot, 0);")
    local running
    running=$(jq -r '.result.task.running // false' <<<"$status" 2>/dev/null)
    if [[ "$running" != "true" ]]; then
      echo "$status"
      return 0
    fi
    sleep 1
    ((waited++))
  done
  echo "$status"
  return 1
}

# ---- assertions ----
FIXTURE_NAME="${FIXTURE_NAME:-$(basename "${BASH_SOURCE[1]:-unknown}" .sh)}"
_FAIL_REASON=""

pass() {
  # optional detail message (#56): a bare PASS/FAIL line loses which of several valid
  # outcomes actually happened (e.g. "which recovery stage cleared it") -- print it when
  # given, backward-compatible with every existing fixture that calls pass() with none.
  if [[ -n "${1:-}" ]]; then echo "PASS $FIXTURE_NAME: $1"; else echo "PASS $FIXTURE_NAME"; fi
  exit 0
}
fail() {
  echo "FAIL $FIXTURE_NAME: $1"
  exit 1
}
assert_eq() {
  local actual="$1" expected="$2" msg="${3:-value mismatch}"
  [[ "$actual" == "$expected" ]] || fail "$msg (got '$actual', want '$expected')"
}
assert_true() {
  local cond="$1" msg="${2:-condition false}"
  [[ "$cond" == "true" ]] || fail "$msg (got '$cond')"
}

# jget <json> <jqpath> -> convenience wrapper, "null" on missing.
# NOT `"$2 // \"null\""` -- jq's `//` alternative operator treats a legitimate JSON
# `false` the same as null/missing (both count as "falsy" for `//`'s purposes), so any
# fixture checking a boolean field that is correctly `false` got silently handed the
# STRING "null" instead. Found live (2026-09-02, engine-dev-3, dangerscan-canopy fixture):
# columnOpen() was correctly returning `false` for a real stone ceiling on every one of
# ~15 retries, but jget reported "null" every time, reading as a fixture/logic bug that
# didn't exist. `if (EXPR)==null then "null" else (EXPR) end` distinguishes true
# null/missing from a real `false` while keeping the same "null" placeholder default.
jget() { jq -r "if ($2) == null then \"null\" else ($2) end" <<<"$1" 2>/dev/null; }
