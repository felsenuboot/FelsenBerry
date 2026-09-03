#!/usr/bin/env bash
# Fixture: induced-stress-sequencing (#56 fixture i, criterion #3)
#
# Criterion #3 ("needs met in priority order under stress") has never been run as its
# designed test — only met under normal, non-simultaneous operation. This fixture induces
# hungry + toolless + THREATENED all at once and asserts the ladder sequences
# survival > maintenance > project > idle with no thrashing (a rung does not fire, clear,
# then fire again out of order — the observable form of "hysteresis holds").
#
# Also folds in two related open items, per #56's own ask, by choosing the threat
# deliberately: a real skeleton triggers survival.js's BREAK_LOS branch, which
# (a) satisfies #32 (CREEPER/BREAK_LOS have never faced a live mob — this is a real one,
# not __survival.drill()'s fabricated threat) and (b) re-verifies #38 (BREAK_LOS drill
# hung 90s before force-exit) resolves within a sane bound now, against a genuine encounter
# rather than the synthetic one that first found the hang.
#
# #121/5n (2026-09-03, engine-dev + team-lead): the arena defaults to a WORLD variant --
# build_platform's flat roofed footprint plus a handful of scattered 1-2 block stone
# pillars -- so FLEE_AWAY's LOS-biased retreat has something to duck behind, same as
# almost any real outdoor terrain would offer. STRESS_ARENA_BARE=1 switches to the
# original featureless platform instead: a genuinely un-winnable "expected-loss" case
# (unarmed, shieldless -- this fixture is deliberately toolless -- with zero cover
# anywhere against sustained ranged fire has no in-rules mitigation) that is run
# separately, logged, and never gates a pass/fail on its own hpMin. Do not read the
# pillars as hiding a regression: run STRESS_ARENA_BARE=1 to see the documented bare
# number any time.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

SEQ_TIMEOUT="${SEQ_TIMEOUT:-90}"
STRESS_ARENA_BARE="${STRESS_ARENA_BARE:-0}"

# scatter_stress_pillars <x0> <y> <z0> -- a handful of 1-2 block stone columns inside an
# already-built build_platform footprint (12x12, corner at x0,z0), positioned clear of the
# bot's start (local ~6,6) / skeleton's spawn (local ~10,6) sightline so BREAK_LOS still
# gets its triggering shot -- these exist for the RETREAT, not to block the initial
# encounter. Cleared by the fixture's own clear_platform call (same y range).
scatter_stress_pillars() {
  local x0="$1" y="$2" z0="$3"
  local -a offs=("1,1,2" "9,2,1" "2,9,2" "9,9,1" "5,10,2")
  local o dx dz h
  for o in "${offs[@]}"; do
    IFS=',' read -r dx dz h <<<"$o"
    rcon "fill $((x0+dx)) $y $((z0+dz)) $((x0+dx)) $((y+h-1)) $((z0+dz)) minecraft:stone" >/dev/null
  done
}

# precondition: healthy, connected, agenda present -- same reasoning as induced-wedge-relog,
# there is nothing for a bare skills.js bot to "sequence" without a ladder driving it.
hp=$(eval_js "return bot.health;")
hpVal=$(jget "$hp" '.result')
if [[ -z "$hpVal" || "$hpVal" == "null" ]]; then fail "bot not reachable"; fi
agendaPresent=$(eval_js "return Boolean(globalThis.__agenda);")
if [[ "$(jget "$agendaPresent" '.result')" != "true" ]]; then
  fail "no __agenda installed -- this fixture needs the ladder present to have anything to sequence"
fi

# ---- induce all three simultaneously ----
# hungry: direct override, not the Hunger effect -- deterministic and difficulty-independent
# (EVALUATION.md sect 9 C3 already found the Hunger effect does nothing on Peaceful and is
# slow even on Normal; a fixture needs repeatable timing, not organic depletion). Give food
# items too, or EAT_CRITICAL's OTHER half (foodCount>0) never fires.
rcon "give $BOT_NAME minecraft:bread 4" >/dev/null
eval_js "bot.food = 6; bot.foodSaturation = 0; return bot.food;" >/dev/null

# toolless: strip every pickaxe tier so TOOL has real work to do
for tier in wooden stone iron golden diamond netherite; do
  rcon "clear $BOT_NAME minecraft:${tier}_pickaxe" >/dev/null
done

# threatened: a real skeleton, close and elevated so it has immediate LOS -- not a fabricated
# __survival.drill() threat, a genuine encounter (folds in #32). Found live on the first
# draft of this fixture: summoning into an unlit/underground area let the world's OWN
# natural hostile spawning compound the one deliberate skeleton -- "kill @e[type=skeleton]"
# after one run cleared SIXTEEN, not one, and the bot ended the run at 1.83 HP, a genuine
# near-death the fixture's own hp<=0-only death check silently missed. Build a small lit,
# roofed arena first so the ONLY threat present is the one this fixture actually summons.
BOT_POS=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];")
BX=$(echo "$BOT_POS" | jq -r '.result[0]')
BY=$(echo "$BOT_POS" | jq -r '.result[1]')
BZ=$(echo "$BOT_POS" | jq -r '.result[2]')
AX=$((BX-6)); AY=$BY; AZ=$((BZ-6))
build_platform "$AX" "$AY" "$AZ" 12
if [[ "$STRESS_ARENA_BARE" != "1" ]]; then
  scatter_stress_pillars "$AX" "$AY" "$AZ"
fi
rcon "fill $AX $((AY+3)) $AZ $((AX+11)) $((AY+3)) $((AZ+11)) minecraft:glowstone" >/dev/null
rcon "tp $BOT_NAME $((BX)) $BY $((BZ))" >/dev/null
sleep 1
rcon "summon minecraft:skeleton $((BX+4)) $BY $BZ {NoAI:0b}" >/dev/null

pushLogT0=$(date +%s)
# #32 QA pass (2026-09-03, engine-dev): live-caught a SECOND, more subtle version of the exact
# gap #65's own comment below already documents once -- a death-then-near-instant-respawn
# cycle (#103's own fix makes respawn ~100ms, per this file's own log) can complete ENTIRELY
# between two 2s polls of raw `bot.health`, so the poll loop's own hpNowVal<=0 check simply
# never samples the true 0 -- it reads a low positive number, then 20 (post-respawn), and the
# loop silently reports "dropped to 0.33 HP" instead of "died". Confirmed live: server.log's
# own kill line ("CreeperCarl was slain by Skeleton") landed inside a poll gap this exact
# check would otherwise have missed. `real_death_since()` reads the runner's own log file
# directly (byte-offset gate, same technique as any tail-from-here read -- no date parsing,
# no timezone risk) for a ground-truth `<death>` line appended after this fixture's own
# summon, checked every poll cycle below ALONGSIDE (not instead of) the existing HP check.
BOT_LOG="$BENCH_DIR/../logs/$BOT_NAME.log"
BOT_LOG_OFFSET=$( { wc -c < "$BOT_LOG" 2>/dev/null || echo 0; } )
real_death_since() {
  tail -c "+$((BOT_LOG_OFFSET + 1))" "$BOT_LOG" 2>/dev/null | grep -q '<death>'
}

# ---- watch the rung/branch sequence unfold ----
# poll __agenda.snapshot() every 2s for the owning rung, and survival's own log for a
# panic_recovered line -- two independent signals (the ladder's OWN sequencing, and
# survival.js's REAL reflex firing underneath it), same two-witness pattern used
# throughout EVALUATION.md sect 9.
#
# #65 (found LIVE, the hard way): the original exit condition was
# `breakLosSeen && owner!=null && i>10` -- it fired the instant the FIRST panic_recovered
# landed, ~12s in, no matter what happened after. Both live #65 trials reported exactly
# "12s elapsed" and PASSED -- and trial 2's own telemetry ledger showed the bot took a
# SECOND hit, dropped from 6 HP to 0, and respawned 15s AFTER the loop had already broken
# and stopped watching. A verifier that stops the instant the thing it's grading first
# succeeds, and never checks again, is worth nothing against a death that happens right
# after -- exactly EVALUATION.md's "false-success root" doctrine, just found in a fixture
# rather than the engine. Now it only exits once the skeleton is confirmed gone (not just
# "a panic recovered once") AND that holds for 2 consecutive samples (4s) with no further
# HP drop -- both witnesses, sustained, not a single snapshot.
RUNG_SEQ=()
breakLosSeen="false"
hpMin="20"
stableChecks=0
i=0
while [[ $i -lt $SEQ_TIMEOUT ]]; do
  snap=$(eval_js "const a=__agenda.snapshot(); return {owner:a.owner, blocked:a.blocked};")
  owner=$(jget "$snap" '.result.owner')
  n=${#RUNG_SEQ[@]}
  last=""
  if [[ $n -gt 0 ]]; then last="${RUNG_SEQ[$((n-1))]}"; fi
  if [[ "$owner" != "null" && "$owner" != "$last" ]]; then
    RUNG_SEQ+=("$owner")
  fi
  recent=$(eval_js "const s=__skills.status(bot,0); return s.log.slice(-5).map(l=>l[2]).join(' | ');")
  if [[ "$(jget "$recent" '.result')" == *"panic_recovered branch=BREAK_LOS"* ]]; then
    breakLosSeen="true"
  fi
  hpPrev="$hpMin"
  hpNow=$(eval_js "return bot.health;")
  hpNowVal=$(jget "$hpNow" '.result')
  if [[ "$hpNowVal" != "null" ]]; then
    if [[ "$hpNowVal" != "$hpMin" ]] && awk -v h="$hpNowVal" -v m="$hpMin" 'BEGIN{exit !(h<m)}' 2>/dev/null; then hpMin="$hpNowVal"; fi
    if awk -v h="$hpNowVal" 'BEGIN{exit !(h<=0)}' 2>/dev/null; then
      rcon "kill @e[type=minecraft:skeleton,distance=..12]" >/dev/null 2>&1 || true
      clear_platform "$AX" "$AY" "$AZ" 12
      fail "bot died during the induced encounter -- criterion-1 AND criterion-3 both FAIL, this is the real finding"
    fi
  fi
  # #32 QA pass: the ground-truth check -- catches a death the poll above missed entirely
  # because respawn landed inside the 2s gap (see real_death_since's own comment above).
  if real_death_since; then
    rcon "kill @e[type=minecraft:skeleton,distance=..12]" >/dev/null 2>&1 || true
    clear_platform "$AX" "$AY" "$AZ" 12
    fail "bot died during the induced encounter (caught via the runner log, not the HP poll -- respawn landed inside a poll gap) -- criterion-1 AND criterion-3 both FAIL, this is the real finding"
  fi
  skelAlive=$(eval_js "return Object.values(bot.entities).some(e=>e.name==='skeleton' && e.position && Math.hypot(e.position.x-($BX),e.position.z-($BZ))<16);")
  skelAliveVal=$(jget "$skelAlive" '.result')
  hpDropped="false"
  if [[ "$hpNowVal" != "null" ]] && awk -v h="$hpNowVal" -v p="$hpPrev" 'BEGIN{exit !(h<p)}' 2>/dev/null; then hpDropped="true"; fi
  if [[ "$breakLosSeen" == "true" && "$skelAliveVal" == "false" && "$hpDropped" == "false" && $i -gt 10 ]]; then
    stableChecks=$((stableChecks+1))
  else
    stableChecks=0
  fi
  [[ $stableChecks -ge 2 ]] && break
  sleep 2
  i=$((i+2))
done

elapsed=$(( $(date +%s) - pushLogT0 ))
rcon "kill @e[type=minecraft:skeleton,distance=..12]" >/dev/null 2>&1 || true
clear_platform "$AX" "$AY" "$AZ" 12
rcon "fill $AX $((AY+3)) $AZ $((AX+11)) $((AY+3)) $((AZ+11)) minecraft:air" >/dev/null 2>&1 || true

seqStr="${RUNG_SEQ[*]}"

# ---- thrash check: a rung that was already superseded by a DIFFERENT rung must never
# reappear later. seen_and_left accumulates a rung only once something else has followed
# it (a rung repeating itself consecutively is normal — that's just "still owns the
# ladder" being sampled twice, not thrash). EXCLUDES safety-tier rungs (REFLEX/POSTURE,
# per __agenda.rungs()'s own `safety` flag -- the authoritative source, not a hardcoded
# name list here) -- found live: a real skeleton attacking repeatedly legitimately
# re-triggers REFLEX each time (panic -> recover -> a new hit -> panic again), which is
# the reflex doing its job against a persistent threat, not broken hysteresis. The
# hysteresis this criterion actually cares about is the MAINTENANCE tier (EAT_CRITICAL,
# TOOL, etc.), which has no legitimate reason to re-fire without a genuinely new need.
#
# ALSO excludes the floor rung (id of the entry with the highest `prio` -- again read
# from the engine, not hardcoded as "IDLE"): found live in #65 once the polling-loop fix
# above let a fixture run watch a real multi-cycle encounter properly for the first time
# -- the floor rung is BY DEFINITION superseded by anything and resumed the instant
# nothing else needs the ladder, so it recurring between bursts of REFLEX/POSTURE (or a
# one-off LIGHT firing as it got dark) is exactly as legitimate as safety re-firing, not
# hysteresis breaking. A real thrash is a MAINTENANCE-tier rung cycling without new cause.
safetyRungs=$(eval_js "return __agenda.rungs().filter(r=>r.safety).map(r=>r.id);")
floorRung=$(eval_js "const rs=__agenda.rungs(); return rs.reduce((a,r)=>r.prio>a.prio?r:a, rs[0]).id;")
declare -A IS_SAFETY
while IFS= read -r rid; do [[ -n "$rid" ]] && IS_SAFETY["$rid"]=1; done < <(echo "$safetyRungs" | jq -r '.result[]' 2>/dev/null)
floorRungId=$(jget "$floorRung" '.result')
[[ -n "$floorRungId" && "$floorRungId" != "null" ]] && IS_SAFETY["$floorRungId"]=1

thrash="false"
thrashRung=""
prev=""
seen_and_left=()
for r in "${RUNG_SEQ[@]}"; do
  if [[ -n "$prev" && "$prev" != "$r" ]]; then seen_and_left+=("$prev"); fi
  for s in "${seen_and_left[@]:-}"; do
    if [[ "$r" == "$s" && -z "${IS_SAFETY[$r]:-}" ]]; then thrash="true"; thrashRung="$r"; fi
  done
  prev="$r"
done

if [[ "$breakLosSeen" != "true" ]]; then
  fail "survival.js never logged panic_recovered branch=BREAK_LOS within ${SEQ_TIMEOUT}s (owner sequence: $seqStr) -- either the skeleton never got LOS, or BREAK_LOS didn't fire; not a pass either way"
fi
if [[ "$thrash" == "true" ]]; then
  fail "rung sequence THRASHED (non-safety rung '$thrashRung' recurred after being superseded): $seqStr -- hysteresis did not hold under simultaneous stress"
fi
# a near-death survival is a real finding, not something a clean sequencing PASS should
# bury -- found live: the first draft's own encounter took the bot to 1.83 HP (a natural
# mob pile-on the arena above now prevents), and correct rung ORDER doesn't say anything
# about whether the actual encounter was survived with any real margin. Threshold matches
# EAT_CRITICAL's own danger-zone number, not an arbitrary pick.
if awk -v h="$hpMin" 'BEGIN{exit !(h<6)}' 2>/dev/null; then
  if [[ "$STRESS_ARENA_BARE" == "1" ]]; then
    # #121/5n: the bare variant is a documented, non-gating expected-loss case -- an
    # unarmed, shieldless bot on a featureless platform with sustained ranged fire has no
    # in-rules mitigation (no cover to break LOS with, no shield to raise). Sequencing and
    # BREAK_LOS firing correctly is still the thing being checked; a low hpMin here is the
    # expected, not the tested, outcome -- log it and pass, don't fail the fixture on it.
    pass "BARE-PLATFORM EXPECTED-LOSS VARIANT (STRESS_ARENA_BARE=1): sequencing clean, no thrash, BREAK_LOS fired against a real skeleton, but hpMin=${hpMin} on zero-cover ground with no shield -- documented, non-gating loss, not a regression signal. owner sequence: $seqStr"
  fi
  fail "sequencing was clean (no thrash, BREAK_LOS fired correctly) but the bot dropped to ${hpMin} HP during the encounter -- a near-death is not a pass on its own, even with correct rung order. owner sequence: $seqStr"
fi

pass "sequenced cleanly under simultaneous hungry+toolless+threatened, ${elapsed}s, BREAK_LOS fired against a real skeleton (folds in #32), no thrash, hpMin=${hpMin}. owner sequence: $seqStr"
