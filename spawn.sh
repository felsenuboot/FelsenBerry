#!/usr/bin/env bash
# spawn.sh <name> <port> [extra runner.js args, e.g. --version 1.21.4]
# Starts a detached bot process; logs to logs/<name>.log, PID to pids/<name>.pid.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

NAME="${1:-}"
PORT="${2:-}"
if [[ -z "$NAME" || -z "$PORT" ]]; then
  echo "usage: ./spawn.sh <name> <port> [extra args]" >&2
  exit 2
fi
shift 2

if ! [[ "$NAME" =~ ^[A-Za-z0-9_]{1,16}$ ]]; then
  echo "refusing: name must match [A-Za-z0-9_], max 16 chars" >&2
  exit 2
fi

mkdir -p logs pids

# refuse if name already running
PIDFILE="pids/$NAME.pid"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "refusing: bot '$NAME' already running (pid $(cat "$PIDFILE"))" >&2
  exit 1
fi

# refuse if port already in use
if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "refusing: port $PORT already in use" >&2
  exit 1
fi

setsid nohup node runner.js --name "$NAME" --port "$PORT" "$@" >> "logs/$NAME.log" 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"
echo "$PORT" > "pids/$NAME.port"
# fleet-awareness meta: who spawned it, against which MC server, and why.
# Convention (team law 2026-09-02): OWNER=<teammate> PURPOSE="<short why>" ./spawn.sh ...
echo "${OWNER:-unowned}|${MC_HOST:-100.101.197.44}:${MC_PORT:-25565}|${PURPOSE:-}" > "pids/$NAME.meta"
echo "spawned $NAME (pid $PID, control port $PORT, owner ${OWNER:-unowned}, server ${MC_HOST:-100.101.197.44}:${MC_PORT:-25565}, log logs/$NAME.log)"
