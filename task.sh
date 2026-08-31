#!/usr/bin/env bash
# task.sh <port> <start|status|stop|list|wait> [name|since|reason] [argsJson]
#
#   ./task.sh 3104 start chopTrees '{"types":"any","count":2}'
#   ./task.sh 3104 status [sinceSeq]     # one-call poll: bot vitals + task + new log lines
#   ./task.sh 3104 wait                  # poll every 5s, print terminal status (token-optimal)
#   ./task.sh 3104 stop [reason]         # cancels the task AND clears the queue + fallback
#   ./task.sh 3104 list                  # skill registry with params
#   ./task.sh 3104 queue '[{"name":"come","args":{...}},{"name":"collectDrops"}]' '{"onEmpty":"collectDrops"}'
#   ./task.sh 3104 enqueue collectDrops '{"radius":12}'   # append one job
#   ./task.sh 3104 qinfo                 # full queue introspection (args, history, gapMs)
#   ./task.sh 3104 skip [reason]         # abort current job, advance to the next
#   ./task.sh 3104 resume                # continue after a halt / reconnect pause
set -euo pipefail
PORT="${1:?usage: ./task.sh <port> <start|queue|enqueue|status|qinfo|stop|skip|resume|list|wait> [name] [argsJson]}"
CMD="${2:?usage: ./task.sh <port> <start|queue|enqueue|status|qinfo|stop|skip|resume|list|wait> [name] [argsJson]}"

evalpost() { # $1 = js code
  jq -n --arg c "$1" '{code:$c}' \
    | curl -s -X POST "http://127.0.0.1:$PORT/eval" -H 'Content-Type: application/json' -d @-
}

case "$CMD" in
  start)
    NAME="${3:?start needs a skill name}"
    ARGS="${4:-}"; [ -z "$ARGS" ] && ARGS="{}"
    echo "$ARGS" | jq -e . >/dev/null || { echo "argsJson is not valid JSON: $ARGS" >&2; exit 2; }
    evalpost "return __skills.start(bot, '$NAME', $ARGS)" | jq -c .
    ;;
  status)
    SINCE="${3:-0}"
    evalpost "return __skills.status(bot, $SINCE)" | jq -c .
    ;;
  stop)
    REASON="${3:-cli}"
    evalpost "return __skills.stop('$REASON')" | jq -c .
    ;;
  list)
    evalpost "return __skills.list()" | jq .
    ;;
  queue)   # ./task.sh 3106 queue '[{"name":"mineLane","args":{"target":"stone","count":5}},{"name":"depositToChest"}]' '{"onEmpty":"collectDrops"}'
    ITEMS="${3:?queue needs a JSON array of name/args objects}"
    OPTS="${4:-}"; [ -z "$OPTS" ] && OPTS="{}"
    echo "$ITEMS" | jq -e 'type=="array"' >/dev/null || { echo "items must be a JSON array" >&2; exit 2; }
    echo "$OPTS"  | jq -e 'type=="object"' >/dev/null || { echo "opts must be a JSON object" >&2; exit 2; }
    evalpost "return __skills.enqueue(bot, $ITEMS, $OPTS)" | jq -c .
    ;;
  enqueue) # ./task.sh 3106 enqueue mineLane '{"target":"stone","count":5}'   (append one)
    NAME="${3:?enqueue needs a skill name}"
    ARGS="${4:-}"; [ -z "$ARGS" ] && ARGS="{}"
    echo "$ARGS" | jq -e . >/dev/null || { echo "argsJson is not valid JSON: $ARGS" >&2; exit 2; }
    evalpost "return __skills.enqueue(bot, [{name:'$NAME', args:$ARGS}])" | jq -c .
    ;;
  qinfo)
    evalpost 'return __skills.queueInfo()' | jq .
    ;;
  skip)
    evalpost "return __skills.skip('${3:-cli}')" | jq -c .
    ;;
  resume)
    evalpost 'return __skills.resume(bot)' | jq -c .
    ;;
  wait)
    # zero-token wait: loop locally, print ONE terminal status when the task ends
    while :; do
      OUT="$(evalpost 'return __skills.status(bot, 0)')" || true
      if echo "$OUT" | jq -e '.result.task.running != true and ((.result.queue.n // 0) == 0)' >/dev/null 2>&1; then
        echo "$OUT" | jq -c .result
        exit 0
      fi
      sleep 5
    done
    ;;
  *)
    echo "unknown command '$CMD' (start|queue|enqueue|status|qinfo|stop|skip|resume|list|wait)" >&2
    exit 2
    ;;
esac
