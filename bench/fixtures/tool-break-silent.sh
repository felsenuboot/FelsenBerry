#!/usr/bin/env bash
# Fixture: tool-break-silent
# FEEDBACK (bernd-driver): both pickaxes broke silently mid-descent (twice in one
# shift), stranding the bot at depth with zero tools -- drivers can't see durability
# without a manual eval. Shipped fix (dangerscan v1): __skills.status().bot.held reports
# {name, count, dur%}, plus a one-shot 'tool_low' warn log line under 15%.
# test: equip a tool damaged to just under the 15% threshold, poll status, and assert
# held.dur% is reported and low, then assert a tool_low log line actually appears.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null

# clear any leftover pickaxes from other fixtures first -- unstackable tools land in
# separate slots, and a stray fresh one would win a plain .find() lookup below (the
# documented unstackable-item counting bug, LEARNING_HANDOFF.md).
rcon "clear $BOT_NAME minecraft:wooden_pickaxe" >/dev/null
sleep 0.3
# wooden_pickaxe max durability is 59; damage=56 leaves 3/59 ~= 5%, well under the 15% gate
rcon "give $BOT_NAME minecraft:wooden_pickaxe[minecraft:damage=56] 1" >/dev/null
sleep 0.5

r=$(eval_js "
const p = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
if (!p) return { error: 'no pickaxe after give' };
await bot.equip(p, 'hand');
return { equipped: bot.heldItem && bot.heldItem.name };
")
[[ "$(jget "$r" '.result.equipped')" == "wooden_pickaxe" ]] || fail "setup: could not equip the damaged pickaxe: $r"
sleep 0.5

st=$(eval_js "return __skills.status(bot, 0);")
heldName=$(jget "$st" '.result.bot.held.name')
heldDur=$(jget "$st" '.result.bot.held.dur')
if [[ -z "$heldDur" || "$heldDur" == "null" ]]; then
  fail "status().bot.held.dur missing entirely -- durability reporting regressed (held=$heldName)"
fi
# dur% should read low (well under 15) for a 56/59-damaged tool
if ! awk -v d="$heldDur" 'BEGIN{exit !(d < 15)}'; then
  fail "held.dur reported $heldDur%% for a 56/59-damaged tool -- expected well under 15%%"
fi

# a tool_low warning should appear in the log within a few seconds of status polling
sawWarn="false"
for i in 1 2 3 4 5; do
  logline=$(eval_js "return __skills.status(bot, 0).log.some(l => l[2] && l[2].includes('tool_low'));" 2>/dev/null)
  if [[ "$(jget "$logline" '.result')" == "true" ]]; then sawWarn="true"; break; fi
  sleep 1
done

assert_true "$sawWarn" "held.dur correctly reads $heldDur%% (low) but no 'tool_low' log line appeared within 5s"
pass
