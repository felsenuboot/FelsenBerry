#!/usr/bin/env bash
# Fixture: false-success-emptypath
# FEEDBACK: "goto resolved without reaching the goal (empty-path noPath)" — astar.js can
# resolve WITHOUT reaching the goal (e.g. an empty path from a boxed-in start), which the
# OLD ctx.goto treated as unconditional success. Shipped fix (engine-dev, v8): an arrival
# assertion in ctx.goto's resolve branch checks goal.isEnd on the bot's real position
# before trusting the resolve, converting a silent false-success into an honest no_path.
#
# test design note: reliably forcing the EXACT historical trigger (a boxed-in START with
# zero legal first moves) in a live dynamic world is fragile (gravity/teleport timing
# races). This fixture instead verifies the OUTWARD-FACING GUARANTEE the fix provides,
# which is strictly more general and catches the same regression class: request arrival
# at a target that is PHYSICALLY IMPOSSIBLE to occupy (range:0 into solid bedrock) and
# assert the task never reports done:true. If the empty-path bug ever came back, this
# exact scenario is exactly the shape that would trigger it (goto resolves, arrival
# assertion is the only thing standing between that resolve and a false "done").
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

TX=210; TY=80; TZ=210   # isolated test coordinate, well clear of any base

rcon "setblock $TX $TY $TZ minecraft:bedrock" >/dev/null
tp_bot "$((TX+5))" "$TY" "$TZ"
sleep 0.5

# range:0 at a solid bedrock cell the bot can never legally occupy.
r=$(start_skill come "{\"x\":$TX,\"y\":$TY,\"z\":$TZ,\"range\":0}")
ok=$(jget "$r" '.result.ok')
if [[ "$ok" != "true" ]]; then
  rcon "setblock $TX $TY $TZ minecraft:air" >/dev/null
  fail "start_skill rejected: $r"
fi

final=$(wait_task 40)
done_=$(jget "$final" '.result.task.done')
errCode=$(jget "$final" '.result.task.error.code')
running=$(jget "$final" '.result.task.running')

rcon "setblock $TX $TY $TZ minecraft:air" >/dev/null

if [[ "$running" == "true" ]]; then
  fail "task still running after 40s — either genuinely slow or wait_task needs a longer window; inconclusive, not a pass"
fi
if [[ "$done_" == "true" ]]; then
  fail "task reported done:true for an occupy-solid-bedrock target — false success, the empty-path bug class is back"
fi
pass
