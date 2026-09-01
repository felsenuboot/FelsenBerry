#!/usr/bin/env bash
# Fixture: craft-void
# FEEDBACK (peter-driver, seen-again): crafting back-to-back without a settle desyncs
# the window and VOIDS items (a driver lost 15 batches of planks that way, unrecoverable
# via collectDrops). Second bug found while shipping the fix: bot.craft(recipe, N) does
# not reliably produce N batches -- N=2 on a torch recipe (result.count 4) produced 4
# torches, not 8. Shipped fix (engine-dev, v12): S.craftSafe crafts exactly one batch per
# call, 800ms settle, full inventory re-count after every craft, trusts what actually
# arrived rather than the requested count.
# test: craftSafe planks from a known log count, and assert the ACTUAL inventory delta
# matches craftSafe's own reported `made` count exactly -- zero silent loss.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' -d '{"code":"return __skills.stop(\"fixture reset\");"}' >/dev/null
rcon "clear $BOT_NAME minecraft:oak_log" >/dev/null
rcon "clear $BOT_NAME minecraft:oak_planks" >/dev/null
sleep 0.3
rcon "give $BOT_NAME minecraft:oak_log 4" >/dev/null
sleep 0.5

before=$(eval_js "return bot.inventory.items().filter(i=>i.name==='oak_planks').reduce((a,i)=>a+i.count,0);")
beforeN=$(jget "$before" '.result')

r=$(eval_js "return await __skills.craftSafe(bot, 'oak_planks', 4);")
madeReported=$(jget "$r" '.result.made')
ok=$(jget "$r" '.result.ok')

sleep 0.5
after=$(eval_js "return bot.inventory.items().filter(i=>i.name==='oak_planks').reduce((a,i)=>a+i.count,0);")
afterN=$(jget "$after" '.result')
realDelta=$((afterN - beforeN))

[[ "$ok" != "false" ]] || fail "craftSafe reported ok:false unexpectedly: $r"
if [[ "$realDelta" -ne "$madeReported" ]]; then
  fail "craftSafe reported made=$madeReported but real inventory delta was $realDelta -- silent void or over-report detected"
fi
if [[ "$realDelta" -le 0 ]]; then
  fail "craftSafe made no planks at all (delta=$realDelta) -- craft path broken, not just a counting issue"
fi
pass
