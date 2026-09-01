#!/usr/bin/env bash
# Fixture: induced-wedge-relog (#56 fixture ii — M3 induced-stress QA)
#
# Criterion #5 ("self-recovers: wedge/relog") has never been run as its designed test —
# only met incidentally. This fixture makes it runnable-on-demand: deliberately induce an
# IN-WORLD wedge (torch-underfoot — NOT the #20 corrupt-chunk case, explicitly excluded
# and checked for below), then measure which mechanism actually clears it, staged from
# cheapest to most drastic, matching #54's recovery-ladder ordering even though R2-R5
# don't exist as distinguishable code yet:
#   stage 1 — the existing generic stall-buster alone (roughly R1)
#   stage 2 — a forced relog + the agenda resuming its OWN project on its own tick,
#             with NO manual re-issue from this script (roughly R6, and the actual
#             "driverless resume" the criterion asks for)
#   stage 3 — neither cleared it: RCON rescue so the bot isn't left stuck, logged as a
#             criterion-#5 MISS (R7), per #54's "every R7 firing is a logged MISS" rule
#
# Requires an --agenda bot with a project already set and actively moving (a plain
# skills-only bot has no autonomous resume path after a relog — that would be testing
# nothing). Pass = stage 1 or stage 2 clears it (R6-or-below). Stage 3 = FAIL + MISS line.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

STAGE1_TIMEOUT="${STAGE1_TIMEOUT:-30}"   # generic stall-buster budget, seconds
STAGE2_TIMEOUT="${STAGE2_TIMEOUT:-60}"   # post-relog, agenda-resume budget, seconds

# corrupt-chunk exclusion (#20 signature): air at feet/head/below-feet + onGround:true +
# near-zero negative y-velocity. If the bot ALREADY shows this before induction even
# starts, this run cannot mean anything as a torch-wedge test — void it rather than
# misattributing a different bug class to this fixture.
check_corrupt_chunk() {
  eval_js "
    const p = bot.entity.position;
    const feet = bot.blockAt(p.offset(0,-0.1,0));
    const below = bot.blockAt(p.offset(0,-1,0));
    const head = bot.blockAt(p.offset(0,0.6,0));
    const airish = (b) => !b || b.name === 'air' || b.name === 'cave_air';
    return { corrupt: airish(feet) && airish(below) && airish(head) && bot.entity.onGround && Math.abs(bot.entity.velocity.y) < 0.1, onGround: bot.entity.onGround, vy: bot.entity.velocity.y };
  "
}

cc=$(check_corrupt_chunk)
if [[ "$(jget "$cc" '.result.corrupt')" == "true" ]]; then
  fail "VOID: bot shows the #20 corrupt-chunk signature BEFORE induction — not a fair torch-wedge test, rescue and re-run elsewhere"
fi

# require an agenda with a project genuinely in flight — that's what makes "driverless
# resume" a meaningful claim rather than this script re-issuing the command itself
proj=$(eval_js "return (globalThis.__agenda && __agenda.project) ? __agenda.project.skill : null;")
projVal=$(jget "$proj" '.result')
if [[ "$projVal" == "null" || -z "$projVal" ]]; then
  fail "no __agenda project set — this fixture needs an agenda-driven bot mid-project, not a bare skills.js bot (driverless resume has nothing to resume otherwise)"
fi

# induce: torch at the bot's EXACT current feet cell, mid-motion. Sampling position twice
# a beat apart first confirms it's actually moving (mid-project), not already idle --
# inducing on an already-stationary bot wouldn't be a fair "wedged mid-task" test.
p1=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x*4)/4,Math.floor(p.y*4)/4,Math.floor(p.z*4)/4];")
sleep 1.5
p2=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x*4)/4,Math.floor(p.y*4)/4,Math.floor(p.z*4)/4];")
if [[ "$p1" == "$p2" ]]; then
  fail "bot wasn't moving before induction (position unchanged over 1.5s) -- not a fair mid-task wedge test, re-run once the project's actually en route somewhere"
fi
FEETRAW=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];")
FX=$(echo "$FEETRAW" | jq -r '.result[0]')
FY=$(echo "$FEETRAW" | jq -r '.result[1]')
FZ=$(echo "$FEETRAW" | jq -r '.result[2]')
# same quarter-block-rounded precision used for every subsequent movement check, so the
# baseline and the checks are directly comparable (a mismatch in rounding here would
# register a stationary bot as "moved" on the very first poll)
POS_QUERY='const p=bot.entity.position; return [Math.floor(p.x*4)/4,Math.floor(p.y*4)/4,Math.floor(p.z*4)/4];'
FEETPOS=$(eval_js "$POS_QUERY")
rcon "setblock $FX $FY $FZ minecraft:torch" >/dev/null
pushLogT0=$(date +%s)

# "cleared" needs BOTH signals, not just position moving -- found live (first draft of
# this fixture): the agenda can switch rungs mid-test for an UNRELATED reason (LIGHT
# firing because it got dark, EAT because hungry) and the bot moves away for that
# reason while the torch is still sitting there, untouched. Position-only would have
# falsely credited that as recovery. Require the torch block itself to be confirmed
# dug out AND the bot to no longer be standing in that cell.
check_cleared() {
  eval_js "
    const torch = bot.blockAt(new Vec3($FX, $FY, $FZ));
    const p = bot.entity.position;
    const stillThere = Math.floor(p.x) === $FX && Math.floor(p.y) === $FY && Math.floor(p.z) === $FZ;
    return { torchGone: !torch || torch.name !== 'torch', movedOff: !stillThere };
  "
}

# ---- stage 1: does the generic stall-buster alone clear it? ----
stage1_cleared="false"
i=0
while [[ $i -lt $STAGE1_TIMEOUT ]]; do
  cc=$(check_corrupt_chunk)
  if [[ "$(jget "$cc" '.result.corrupt')" == "true" ]]; then
    fail "VOID mid-run: the #20 corrupt-chunk signature appeared during induction — different bug class, not a fair torch-wedge measurement this time"
  fi
  cl=$(check_cleared)
  if [[ "$(jget "$cl" '.result.torchGone')" == "true" && "$(jget "$cl" '.result.movedOff')" == "true" ]]; then
    stage1_cleared="true"; break
  fi
  sleep 2
  i=$((i+2))
done

if [[ "$stage1_cleared" == "true" ]]; then
  elapsed=$(( $(date +%s) - pushLogT0 ))
  rcon "setblock $FX $FY $FZ minecraft:air" >/dev/null
  pass "resolved by the generic stall-buster alone (R1-equivalent), ${elapsed}s -- R6-or-below, criterion-5 MET"
fi

# ---- stage 2: force a relog, let the AGENDA resume its OWN project with zero manual re-issue ----
stalePayloadsBefore=$(curl -s --max-time 5 "http://127.0.0.1:$BOT_PORT/state" | jq -c '.stalePayloads')
rcon "kick $BOT_NAME induced-wedge-relog fixture (#56)" >/dev/null
recon_i=0
while [[ $recon_i -lt 30 ]]; do
  c=$(api_get state | jq -r '.connected // false')
  [[ "$c" == "true" ]] && break
  sleep 1
  recon_i=$((recon_i+1))
done
if [[ "$(api_get state | jq -r '.connected // false')" != "true" ]]; then
  fail "bot never reconnected after the kick -- that's its own finding, not a stage-2 result"
fi

stage2_cleared="false"
j=0
while [[ $j -lt $STAGE2_TIMEOUT ]]; do
  cl=$(check_cleared 2>/dev/null)
  if [[ "$(jget "$cl" '.result.torchGone')" == "true" && "$(jget "$cl" '.result.movedOff')" == "true" ]]; then
    stage2_cleared="true"; break
  fi
  sleep 3
  j=$((j+3))
done

rcon "setblock $FX $FY $FZ minecraft:air" >/dev/null

if [[ "$stage2_cleared" == "true" ]]; then
  elapsed=$(( $(date +%s) - pushLogT0 ))
  stalePayloadsAfter=$(curl -s --max-time 5 "http://127.0.0.1:$BOT_PORT/state" | jq -c '.stalePayloads')
  pass "resolved via relog + agenda's OWN driverless resume (R6), ${elapsed}s total -- criterion-5 MET (stalePayloads before=$stalePayloadsBefore after=$stalePayloadsAfter)"
fi

# ---- stage 3: neither cleared it. Rescue so the bot isn't left stuck, log the MISS. ----
rcon "tp $BOT_NAME $FX $((FY+3)) $FZ" >/dev/null
elapsed=$(( $(date +%s) - pushLogT0 ))
fail "R7/RCON required to clear the wedge after ${elapsed}s (stall-buster AND relog both failed) -- criterion-5 MISS, per #54's every-R7-is-a-logged-MISS rule this needs a FEEDBACK.md entry"
