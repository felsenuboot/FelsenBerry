#!/usr/bin/env bash
# list.sh — show running bots: name, pid, control port, connected state.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

shopt -s nullglob
FOUND=0
printf '%-14s %-8s %-6s %-13s %-21s %s\n' NAME PID PORT OWNER SERVER 'STATE / DOING'
for PIDFILE in pids/*.pid; do
  NAME="$(basename "$PIDFILE" .pid)"
  PID="$(cat "$PIDFILE")"
  PORT="$(cat "pids/$NAME.port" 2>/dev/null || echo '?')"
  META="$(cat "pids/$NAME.meta" 2>/dev/null || echo '?|?|||')"
  # 5-field format since TODO 4b (owner|server|purpose|decider_exclude|driven) -- `read -a`
  # into named fields rather than hand-rolled %%/## stripping: that got the 4th field right
  # only because it was always LAST, and silently mis-split as soon as a 5th field (DRIVEN,
  # 2026-09-03) was appended after it. Missing trailing fields (an older meta file) just read
  # as empty, which is the correct "not excluded / not driven" default for either flag.
  IFS='|' read -r OWNER SERVER PURPOSE EXCLUDED DRIVEN <<< "$META"
  FOUND=1
  if ! kill -0 "$PID" 2>/dev/null; then
    printf '%-14s %-8s %-6s %-13s %-21s %s\n' "$NAME" "$PID" "$PORT" "$OWNER" "$SERVER" "dead (stale pidfile)"
    continue
  fi
  STATE="$(curl -s -m 2 "http://127.0.0.1:$PORT/state" 2>/dev/null | node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      try { const s=JSON.parse(d);
        if (!s.connected) { console.log("not connected"); return; }
        const p=s.position?`(${Math.round(s.position.x)},${Math.round(s.position.y)},${Math.round(s.position.z)})`:"";
        const a=s.agenda?` agenda:${s.agenda.rung||"?"}${s.agenda.project?"/"+s.agenda.project:""}`:"";
        const t=s.task&&s.task.skill?` task:${s.task.skill}`:"";
        console.log("connected "+p+a+t); }
      catch { console.log("api unreachable"); }
    })' 2>/dev/null || echo 'api unreachable')"
  [[ -n "$PURPOSE" ]] && STATE="$STATE — $PURPOSE"
  [[ -n "$EXCLUDED" ]] && STATE="$STATE [decider-excluded]"
  [[ -n "$DRIVEN" ]] && STATE="$STATE [driven]"
  printf '%-14s %-8s %-6s %-13s %-21s %s\n' "$NAME" "$PID" "$PORT" "$OWNER" "$SERVER" "$STATE"
done
[[ $FOUND -eq 0 ]] && echo '(no bots)'
exit 0
