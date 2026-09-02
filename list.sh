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
  META="$(cat "pids/$NAME.meta" 2>/dev/null || echo '?|?|')"
  # 4-field format since #95 (owner|server|purpose|decider_exclude) -- parse all four so a
  # DECIDER_EXCLUDE=1 bot's flag doesn't leak into the displayed PURPOSE text (it used to,
  # visibly, as a stray trailing "|1").
  OWNER="${META%%|*}"; REST="${META#*|}"; SERVER="${REST%%|*}"; REST="${REST#*|}"
  PURPOSE="${REST%%|*}"; EXCLUDED="${REST#*|}"
  [[ "$PURPOSE" == "$REST" ]] && EXCLUDED=""   # no 4th field present (older meta file)
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
  printf '%-14s %-8s %-6s %-13s %-21s %s\n' "$NAME" "$PID" "$PORT" "$OWNER" "$SERVER" "$STATE"
done
[[ $FOUND -eq 0 ]] && echo '(no bots)'
exit 0
