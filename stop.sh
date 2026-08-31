#!/usr/bin/env bash
# stop.sh <name> — stop a bot by pidfile.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: ./stop.sh <name>" >&2
  exit 2
fi

PIDFILE="pids/$NAME.pid"
if [[ ! -f "$PIDFILE" ]]; then
  echo "no pidfile for '$NAME'" >&2
  exit 1
fi

PID="$(cat "$PIDFILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped $NAME (pid $PID)"
else
  echo "$NAME (pid $PID) was not running"
fi
rm -f "$PIDFILE" "pids/$NAME.port"
