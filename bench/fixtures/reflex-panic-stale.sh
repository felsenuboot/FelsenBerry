#!/usr/bin/env bash
# Fixture: reflex-panic-stale (#97, agenda.js v25)
#
# test-driver's live finding: a threat dangerscan can SEE (raycast LOS across a gap) but that
# cannot actually PATH to the bot (a zombie 3+ blocks straight down from an isolated platform)
# keeps danger.state pinned at 'panic' forever. REFLEX's old fire()/clear() read raw
# dangerState alone, so it fired every tick regardless of whether survival.js was doing
# anything about it -- observed live: survivalActive:false the WHOLE time (correctly nothing
# to physically do), yet REFLEX perpetually yielded and never let PROJECT run again. ~19
# consecutive dead minutes on gear-race run #3 (felcrew-mcp#97).
#
# Fix: `s.panicStale` tracks an UNBROKEN "panic AND survival not active" streak plus whether
# any damage landed during it (agenda.js's sense(), ~PANIC_STALE_MS). Only once BOTH signals
# corroborate (sustained duration, AND zero health lost the whole time) does REFLEX's
# fire()/clear() treat the panic as stale and let the ladder proceed.
#
# bench/fixtures/agenda-ladder.js already proves the RUNG WIRING (does REFLEX correctly obey
# an injected panicStale field) via A.step()'s dry-run -- that hook's sense(inject) short-
# circuits before the stateful tracking code ever runs, by design (a dry run must be
# deterministic, not dependent on real elapsed wall-clock time), so it CANNOT exercise the
# tracking itself. This fixture is the other half: it stubs globalThis.__danger/__survival on
# a real bot and calls the REAL __agenda.sense() (no inject) repeatedly over REAL time,
# proving the tracking logic that actually produces panicStale, not just that something
# downstream would honor it if handed one.
#
# Three cases, matching the three ways the streak resets (each an independent corroborating
# signal, not "any one is enough" -- a safety:true rung earns the conservative bar):
#  1. sustained panic + survival never active + health never drops -> panicStale eventually
#     goes true (real wait, ~PANIC_STALE_MS -- this fixture is slow by nature, not a bug).
#  2. same setup, but health drops partway through -> panicStale must NOT go true even after
#     the same real time has elapsed (a genuine hit landing means it's not actually a phantom).
#  3. same setup, but survival.js goes active partway through -> the streak resets; panicStale
#     must NOT go true even after the same elapsed time (survival IS handling it).
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

hasField=$(eval_js "return typeof globalThis.__agenda.sense === 'function';")
[[ "$(jget "$hasField" '.result')" == "true" ]] || fail "__agenda.sense is not exposed -- engine predates #97 or agenda.js failed to inject"

# find PANIC_STALE_MS indirectly: sense() doesn't expose the constant, so poll every 2s up to
# a generous cap and report exactly when panicStale flips, rather than assuming the number.
poll_until_stale() {
  local capSec="$1" label="$2"
  local elapsed=0
  while (( elapsed < capSec )); do
    local r stale
    r=$(eval_js "return __agenda.sense();")
    stale=$(jget "$r" '.result.panicStale')
    if [[ "$stale" == "true" ]]; then echo "true:$elapsed"; return; fi
    sleep 2
    elapsed=$((elapsed+2))
  done
  echo "false:$elapsed"
}

restore_globals() {
  eval_js "
    globalThis.__danger = __savedDanger;
    globalThis.__survival = __savedSurvival;
    bot.health = __savedHp;
  " >/dev/null
}

setup=$(eval_js "
globalThis.__savedDanger = globalThis.__danger;
globalThis.__savedSurvival = globalThis.__survival;
globalThis.__savedHp = bot.health;
return { ok: true, realHp: bot.health };
")
realHp=$(jget "$setup" '.result.realHp')
[[ "$realHp" != "null" ]] || fail "could not read real bot.health before stubbing -- refusing to proceed without a restore point"

echo "=== case 1: sustained panic, survival never active, health never drops -> eventually stale ===" >&2
eval_js "
globalThis.__danger = { state: 'panic' };
globalThis.__survival = { active: false };
bot.health = 20;
"  >/dev/null
r1=$(poll_until_stale 40 "case1")
restore_globals

echo "=== case 2: same, but health drops partway -> must stay non-stale the whole cap ===" >&2
eval_js "
globalThis.__danger = { state: 'panic' };
globalThis.__survival = { active: false };
bot.health = 20;
"  >/dev/null
eval_js "return __agenda.sense();" >/dev/null   # arm the streak (first observation starts it)
sleep 8
eval_js "bot.health = 18;" >/dev/null           # a hit lands partway through
r2=$(poll_until_stale 24 "case2")               # same total window as case 1's typical stale point
restore_globals

echo "=== case 3: same, but survival goes active partway -> must stay non-stale the whole cap ===" >&2
eval_js "
globalThis.__danger = { state: 'panic' };
globalThis.__survival = { active: false };
bot.health = 20;
"  >/dev/null
eval_js "return __agenda.sense();" >/dev/null   # arm the streak
sleep 8
eval_js "globalThis.__survival.active = true;" >/dev/null
sleep 4
eval_js "globalThis.__survival.active = false;" >/dev/null   # survival finished, streak should have reset, not just paused
r3=$(poll_until_stale 12 "case3")
restore_globals

echo "case1 (should go true, eventually): $r1" >&2
echo "case2 (must stay false, health dropped): $r2" >&2
echo "case3 (must stay false, survival engaged mid-streak): $r3" >&2

s1_ok="${r1%%:*}"; s1_at="${r1#*:}"
s2_ok="${r2%%:*}"
s3_ok="${r3%%:*}"

[[ "$s1_ok" == "true" ]] || fail "case 1: panicStale never went true within 40s of sustained undamaged idle panic -- the fix does not fire at all"
[[ "$s2_ok" == "false" ]] || fail "case 2: panicStale went true DESPITE a health drop mid-streak (at ${s1_at}s reference) -- the damage-corroboration signal isn't working, a safety rung could stand down while actually being hit"
[[ "$s3_ok" == "false" ]] || fail "case 3: panicStale went true despite survival.js engaging mid-streak -- the engagement-reset isn't working"

pass "panicStale requires BOTH sustained idle-panic time AND zero damage the whole way (case1 true at ${s1_at}s; case2/3 correctly stayed false when either corroborating signal broke)"
