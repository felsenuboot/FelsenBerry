#!/usr/bin/env bash
# list.sh — show running bots: name, pid, control port, connected state.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

shopt -s nullglob
FOUND=0
printf '%-18s %-8s %-6s %s\n' NAME PID PORT STATE
for PIDFILE in pids/*.pid; do
  NAME="$(basename "$PIDFILE" .pid)"
  PID="$(cat "$PIDFILE")"
  PORT="$(cat "pids/$NAME.port" 2>/dev/null || echo '?')"
  FOUND=1
  if ! kill -0 "$PID" 2>/dev/null; then
    printf '%-18s %-8s %-6s %s\n' "$NAME" "$PID" "$PORT" "dead (stale pidfile)"
    continue
  fi
  STATE="$(curl -s -m 2 "http://127.0.0.1:$PORT/state" 2>/dev/null | node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      try { const s=JSON.parse(d); console.log(s.connected?"connected "+JSON.stringify(s.position):"not connected"); }
      catch { console.log("api unreachable"); }
    })' 2>/dev/null || echo 'api unreachable')"
  printf '%-18s %-8s %-6s %s\n' "$NAME" "$PID" "$PORT" "$STATE"
done
[[ $FOUND -eq 0 ]] && echo '(no bots)'
exit 0
