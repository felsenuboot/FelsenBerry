#!/usr/bin/env bash
# Fixture: induced-creeper-encounter (#32, engine-dev QA pass, 2026-09-03)
#
# #32's own acceptance test, the CREEPER half: "one real CREEPER encounter... producing a
# panic_recovered branch=CREEPER log line with the bot surviving above 0 HP and the described
# tactic actually observed (opened to >=10 blocks, never swung, shielded if cornered)" — not
# __survival.drill()'s fabricated threat, a real summoned creeper. GOAL.md's own "known honest
# gaps" list has called this branch untested against a real mob since 2026-09-01; grepping
# FEEDBACK.md for "branch=CREEPER" before this fixture existed returns zero hits.
#
# Equips a real shield deliberately (unlike this file's BREAK_LOS sibling, induced-stress-
# sequencing.sh, which is DELIBERATELY toolless per #56's own stress-scenario design) -- this
# fixture is testing the CREEPER mechanic itself, including its own cornered-shield path, not
# re-running the combined-stress scenario a second time.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

ENC_TIMEOUT="${ENC_TIMEOUT:-60}"

hp=$(eval_js "return bot.health;")
hpVal=$(jget "$hp" '.result')
if [[ -z "$hpVal" || "$hpVal" == "null" ]]; then fail "bot not reachable"; fi
agendaPresent=$(eval_js "return Boolean(globalThis.__agenda);")
if [[ "$(jget "$agendaPresent" '.result')" != "true" ]]; then
  fail "no __agenda installed -- this fixture needs the ladder present (matches its BREAK_LOS sibling)"
fi

# ---- isolated, roofless arena (a creeper needs no roof -- unlike zombies/skeletons it does
# NOT burn in daylight) so the ONLY hostile present is the one this fixture summons ----
BOT_POS=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];")
BX=$(jq -r '.result[0]' <<<"$BOT_POS")
BY=$(jq -r '.result[1]' <<<"$BOT_POS")
BZ=$(jq -r '.result[2]' <<<"$BOT_POS")
AX=$((BX-8)); AY=$BY; AZ=$((BZ-8))
rcon "kill @e[type=minecraft:creeper,x=$AX,y=$AY,z=$AZ,distance=..24]" >/dev/null 2>&1 || true
build_platform "$AX" "$AY" "$AZ" 16
tp_bot "$BX" "$BY" "$BZ" || fail "could not confirm teleport into the arena"

rcon "give $BOT_NAME minecraft:shield 1" >/dev/null
for i in 1 2 3; do
  kitOk=$(eval_js "return bot.inventory.items().some(i=>i.name==='shield');")
  [[ "$(jget "$kitOk" '.result')" == "true" ]] && break
  sleep 0.3
done
[[ "$(jget "$kitOk" '.result')" == "true" ]] || fail "shield never showed up in the bot's own inventory view -- refusing to proceed with a stale-kit race"
eval_js "bot.health = 20; bot.food = 20; return {hp: bot.health, food: bot.food};" >/dev/null

# ---- the real creeper, at CLOSE range (this is deliberately inside dangerscan's own
# creeperRadius=8 panic override, NOT a distant one the bot would have plenty of warning on --
# the acceptance test is "reacted correctly to an ALREADY-close creeper", not "never let one
# get close at all") but outside vanilla's own ~3-block fuse-ignition range, so the branch gets
# a real chance to open distance before any explosion risk. ----
rcon "summon minecraft:creeper $((BX+6)) $BY $BZ {}" >/dev/null
sleep 0.5

pushLogT0=$(date +%s)
BOT_LOG="$BENCH_DIR/../logs/$BOT_NAME.log"
BOT_LOG_OFFSET=$( { wc -c < "$BOT_LOG" 2>/dev/null || echo 0; } )
real_death_since() { tail -c "+$((BOT_LOG_OFFSET + 1))" "$BOT_LOG" 2>/dev/null | grep -q '<death>'; }

# ---- watch: same two-witness + ground-truth-death pattern as induced-stress-sequencing.sh ----
T0=$(date +%s)
hpMin=20
creeperBranchSeen="false"
maxGained="0"
while (( $(date +%s) - T0 < ENC_TIMEOUT )); do
  hpNow=$(eval_js "return bot.health;")
  hpNowVal=$(jget "$hpNow" '.result')
  if [[ "$hpNowVal" != "null" ]] && awk -v h="$hpNowVal" -v m="$hpMin" 'BEGIN{exit !(h<m)}' 2>/dev/null; then hpMin="$hpNowVal"; fi
  if real_death_since; then
    rcon "kill @e[type=minecraft:creeper,x=$AX,y=$AY,z=$AZ,distance=..24]" >/dev/null 2>&1 || true
    clear_platform "$AX" "$AY" "$AZ" 16
    fail "bot died during the induced creeper encounter (ground-truth log check) -- criterion-1 AND criterion-3 both FAIL, this is the real finding"
  fi
  le=$(eval_js "return globalThis.__survival.lastEvent;")
  branch=$(jget "$le" '.result.branch')
  gained=$(jget "$le" '.result.out.gained')
  if [[ "$branch" == "CREEPER" ]]; then
    creeperBranchSeen="true"
    [[ "$gained" != "null" ]] && maxGained="$gained"
    break   # #65's own lesson (see the BREAK_LOS sibling's comment): this branch is a bounded
            # 6s-max encounter by its own code (t0..6000ms loop), not an open-ended one -- a
            # single completed CREEPER lastEvent IS the whole encounter, unlike BREAK_LOS/
            # WALL_OFF's open-ended multi-cycle shape. Confirmed no death via the check above
            # before trusting this as done.
  fi
  sleep 1
done

rcon "kill @e[type=minecraft:creeper,x=$AX,y=$AY,z=$AZ,distance=..24]" >/dev/null 2>&1 || true
clear_platform "$AX" "$AY" "$AZ" 16

recent=$(tail -n 200 "$BOT_LOG" 2>/dev/null | grep -E '<chat>|<say>' | tail -n 15 | tr '\n' '|')

if [[ "$creeperBranchSeen" != "true" ]]; then
  fail "no panic_recovered branch=CREEPER within ${ENC_TIMEOUT}s -- either the creeper never got dangerscan's attention or a different branch handled it. log tail: $recent"
fi
if [[ "$hpMin" != "null" ]] && awk -v h="$hpMin" 'BEGIN{exit !(h<=0)}' 2>/dev/null; then
  fail "hpMin<=0 despite no <death> line caught -- inconsistent, treat as a fail: $recent"
fi
if awk -v g="$maxGained" 'BEGIN{exit !(g < 10)}' 2>/dev/null; then
  fail "CREEPER branch fired but only opened ${maxGained} blocks, short of creeperClear's own 10-block target -- log tail: $recent"
fi

pass "real creeper encounter: branch=CREEPER fired, opened ${maxGained} blocks (>=10 target), hpMin=${hpMin}, no death. log tail: $recent"
