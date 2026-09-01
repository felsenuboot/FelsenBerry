#!/usr/bin/env bash
# bench/bench.sh — Tier-0 fixture runner (EVALUATION.md §4 Amendment 2).
# Usage: ./bench.sh tier0 <port> [--host H --mcport P --name expectedBotName]
#   ./bench.sh tier0 3110                    # run all fixtures against port 3110
#   ./bench.sh tier0 3110 --name MesswurstManni   # refuse if bot name doesn't match
#   ./bench.sh tier0 3110 --only wedge-torch,craft-void   # run a subset
#
# Pure bash+curl+jq (+ node for RCON only). Zero LLM tokens per run. N=1 per fixture,
# 3-5 min total. Exits nonzero if any fixture fails.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="${1:-}"
PORT="${2:-}"
shift 2 2>/dev/null || true

EXPECTED_NAME=""
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) EXPECTED_NAME="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --rcon-host) export RCON_HOST="$2"; shift 2 ;;
    --rcon-port) export RCON_PORT="$2"; shift 2 ;;
    --rcon-pass) export RCON_PASS="$2"; shift 2 ;;
    *) echo "bench.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

if [[ "$MODE" != "tier0" ]]; then
  echo "usage: ./bench.sh tier0 <port> [--name expectedBotName] [--only f1,f2] [--rcon-host H --rcon-port P --rcon-pass X]" >&2
  exit 2
fi
if [[ -z "$PORT" ]]; then
  echo "bench.sh: <port> required" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "bench.sh: jq required" >&2
  exit 2
fi

STATE=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/state") || { echo "bench.sh: port $PORT unreachable"; exit 2; }
BOT_NAME=$(jq -r '.name // "?"' <<<"$STATE")
CONNECTED=$(jq -r '.connected // false' <<<"$STATE")
if [[ "$CONNECTED" != "true" ]]; then
  echo "bench.sh: bot on port $PORT ($BOT_NAME) is not connected — aborting" >&2
  exit 2
fi
if [[ -n "$EXPECTED_NAME" && "$BOT_NAME" != "$EXPECTED_NAME" ]]; then
  echo "bench.sh: REFUSING — port $PORT is '$BOT_NAME', expected '$EXPECTED_NAME' (wrong-bot safety check)" >&2
  exit 2
fi

# EVALUATION.md §4 doctrine: "bench bot spawned WITHOUT idleguard for measured
# scenarios (idleguard stop(), not pause() -- the stall-buster ignores pause)". Found
# live during harness development: idleguard running in the background can wander the
# bot / deposit items mid-fixture, silently invalidating whatever the fixture set up
# (it did -- cost real debugging time before this line existed). Belt-and-suspenders:
# stop it if present, every run, regardless of how it got there.
curl -s --max-time 5 -X POST "http://127.0.0.1:$PORT/eval" -H 'Content-Type: application/json' \
  -d '{"code":"if (globalThis.__idleguard && globalThis.__idleguard.stop) { globalThis.__idleguard.stop(); return {stopped:true}; } return {stopped:false, reason:\"not installed\"};"}' >/dev/null

echo "bench Tier-0 :: bot=$BOT_NAME port=$PORT :: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "---"

export BOT_PORT="$PORT"
export BOT_NAME
RESULTS_DIR="$DIR/results"
mkdir -p "$RESULTS_DIR"
RUN_ID="tier0-$(date -u +%Y%m%dT%H%M%SZ)"
ROWS=()
PASS_N=0
FAIL_N=0
T0=$(date +%s)

FIXTURE_LIST=()
if [[ -n "$ONLY" ]]; then
  IFS=',' read -ra names <<<"$ONLY"
  for n in "${names[@]}"; do FIXTURE_LIST+=("$DIR/fixtures/$n.sh"); done
else
  while IFS= read -r -d '' f; do FIXTURE_LIST+=("$f"); done < <(find "$DIR/fixtures" -maxdepth 1 -name '*.sh' -print0 | sort -z)
fi

for f in "${FIXTURE_LIST[@]}"; do
  name="$(basename "$f" .sh)"
  if [[ ! -f "$f" ]]; then
    echo "SKIP $name: fixture file not found"
    continue
  fi
  fstart=$(date +%s)
  out=$(FIXTURE_NAME="$name" bash "$f" 2>&1)
  code=$?
  fdur=$(( $(date +%s) - fstart ))
  echo "$out"
  status="FAIL"
  if [[ $code -eq 0 ]]; then status="PASS"; ((PASS_N++)); else ((FAIL_N++)); fi
  ROWS+=("{\"fixture\":\"$name\",\"status\":\"$status\",\"seconds\":$fdur,\"output\":$(jq -Rs . <<<"$out")}")
done

TOTAL_DUR=$(( $(date +%s) - T0 ))
echo "---"
echo "bench Tier-0 :: $PASS_N/$((PASS_N + FAIL_N)) passed :: ${TOTAL_DUR}s"

RESULT_FILE="$RESULTS_DIR/$RUN_ID.json"
{
  echo "{"
  echo "  \"runId\": \"$RUN_ID\","
  echo "  \"tier\": 0,"
  echo "  \"bot\": \"$BOT_NAME\","
  echo "  \"port\": $PORT,"
  echo "  \"startedAt\": \"$(date -u -d @$T0 +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"durationSeconds\": $TOTAL_DUR,"
  echo "  \"passed\": $PASS_N,"
  echo "  \"failed\": $FAIL_N,"
  echo "  \"rows\": [$(IFS=,; echo "${ROWS[*]}")]"
  echo "}"
} > "$RESULT_FILE"
echo "results written: $RESULT_FILE"

[[ $FAIL_N -eq 0 ]] || exit 1
