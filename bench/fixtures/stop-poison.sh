#!/usr/bin/env bash
# Fixture: stop-poison
# FEEDBACK/research (movement-engines.md §2.3b): bot.pathfinder.stop() only sets a
# stopPathing flag, consumed on the NEXT resetPath() — so calling stop() when no path is
# active leaves the flag armed, and the very next setGoal(goal) immediately fires stop()
# again internally, poisoning that brand-new goto with PathStopped. Shipped fix
# (engine-dev, v8): ctx.goto's three internal stop() call sites (cancel, timeout, stuck)
# were all replaced with setGoal(null), which does not leave a stale flag armed.
#
# test: run a come task that is guaranteed to fail (target physically unreachable), let
# ctx.goto's own failure path run its course, then immediately run a SECOND come task to
# an easy, definitely-reachable nearby point ON A BUILT PLATFORM (the raw test coordinate
# has no solid ground -- verified live, it's cave/void terrain at this Y, so a bare offset
# target isn't reliably "trivially reachable" without its own real terrain problems
# confounding the poisoning question) and assert it succeeds cleanly. If the first
# failure's internal cleanup still called stop() (poisoning the pathfinder), the second
# task would fail too -- most visibly as an immediate spurious failure despite a trivial
# target on flat open ground.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=220; PY=80; PZ=220   # platform corner
TX=$((PX+2)); TY=$PY; TZ=$((PZ+2))  # bedrock trap sits ON the platform

curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null

# solid 8x8 stone platform + 2 headroom, so both the trap AND the "trivially easy" second
# target sit on guaranteed solid, open, flat ground -- isolates the poisoning question from
# this world's cave terrain.
rcon "fill $PX $((PY-1)) $PZ $((PX+7)) $((PY-1)) $((PZ+7)) minecraft:stone" >/dev/null
rcon "fill $PX $PY $PZ $((PX+7)) $((PY+2)) $((PZ+7)) minecraft:air" >/dev/null
rcon "setblock $TX $TY $TZ minecraft:bedrock" >/dev/null
tp_bot "$PX" "$PY" "$PZ"
sleep 0.5

# 1. a guaranteed-failing goto (occupy-solid-bedrock)
r1=$(start_skill come "{\"x\":$TX,\"y\":$TY,\"z\":$TZ,\"range\":0}")
[[ "$(jget "$r1" '.result.ok')" == "true" ]] || { rcon "setblock $TX $TY $TZ minecraft:air" >/dev/null; fail "first start_skill rejected: $r1"; }
final1=$(wait_task 40)
rcon "setblock $TX $TY $TZ minecraft:air" >/dev/null
run1=$(jget "$final1" '.result.task.running')
[[ "$run1" != "true" ]] || fail "first (expected-to-fail) task never finished within 40s — inconclusive"

# 2. immediately, a trivially easy goto across the SAME open platform
r2=$(start_skill come "{\"x\":$((PX+6)),\"y\":$TY,\"z\":$((PZ+6)),\"range\":2}")
[[ "$(jget "$r2" '.result.ok')" == "true" ]] || fail "second start_skill rejected: $r2 -- poisoned at the START call itself"
final2=$(wait_task 20)
done2=$(jget "$final2" '.result.task.done')
err2=$(jget "$final2" '.result.task.error.code')

rcon "fill $PX $((PY-1)) $PZ $((PX+7)) $((PY+2)) $((PZ+7)) minecraft:air" >/dev/null

assert_eq "$done2" "true" "second (trivially reachable, open platform) goto did not complete cleanly right after a failed one -- errCode=$err2, poisoning suspected"
pass
