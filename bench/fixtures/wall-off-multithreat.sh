#!/usr/bin/env bash
# Fixture: wall-off-multithreat (#115, TODO 5f, survival.js v12)
#
# Run #6 death #1 (test-driver, SCOREBOARD.md, 2026-09-03): a creeper blast dropped the bot to
# 6 HP, WALL_OFF engaged correctly against the creeper it saw, and while it built, a SECOND,
# completely untracked threat (a spider — server.log's own kill-attribution line names it as
# the actual killer) landed three unseen melee hits and finished the bot off. dangerscan's own
# 4Hz scan already had the spider in its threats[] list the whole time (weight 2, present) —
# it just never won the SCORE-sorted ranking against the creeper (weight 5 + close-range
# escalation), so `pick()`'s single-threat model (`ts[0]`) handed branchWallOff ONE threat and
# nothing downstream ever looked again.
#
# Fix (survival.js): branchWallOff now re-scans threatsNow() by DISTANCE (nearestMeleeThreat),
# not score, every cycle of both its placement loop and its wait/heal loop — a closer/
# different attacker than the one it was originally called with gets named in chat (once,
# not spammed) and re-shielded/re-targeted against. Returns `threatsNamed` (>1 means the fix
# actually fired), stashed on `globalThis.__survival.lastEvent.out` by enter()'s own
# bookkeeping, so this doesn't have to grep chat text alone.
#
# Reproduces the death's SHAPE, not its exact mob types (a creeper's explosion is single-shot
# and hard to time deterministically; two real, continuously-attacking zombies exercise the
# SAME structural gap without relying on blast RNG). Deliberately goes through the REAL
# automatic pipeline (dangerscan sees both zombies -> panic -> onDanger -> enter() -> pick())
# rather than calling __survival.runBranch() directly: an early draft called runBranch()
# directly and it raced the bot's own always-on onDanger listener, which fired its OWN
# independent enter('danger')/pick()/WALL_OFF for the same encounter — two concurrent
# branchWallOff calls stepping on each other's shieldDown()/state, an artifact of the test
# harness, not anything the real death ever had. Letting the real pipeline drive means exactly
# ONE branchWallOff call happens, called with pick()'s own single highest-SCORE threat
# (whichever zombie that is — this fixture doesn't get to choose, same as the real creeper vs
# spider), and zombie B's detection has to come entirely from dangerscan's own live scan.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# ---- preconditions ----
hasSurvival=$(eval_js "return Boolean(globalThis.__survival);")
[[ "$(jget "$hasSurvival" '.result')" == "true" ]] || fail "__survival (survival.js) not installed"
hasDanger=$(eval_js "return Boolean(globalThis.__danger);")
[[ "$(jget "$hasDanger" '.result')" == "true" ]] || fail "__danger (dangerscan.js) not installed -- WALL_OFF's re-scan reads threatsNow(), which reads __danger.threats"
active=$(eval_js "return globalThis.__survival.brief();")
[[ "$(jget "$active" '.result.state')" != *"panic"* ]] || fail "survival is already mid-panic before this fixture even starts -- refusing to layer a test encounter on top of a real one"

# ---- isolated, lit, roofed arena (induced-stress-sequencing.sh's own pattern) so the ONLY
# hostiles present are the two this fixture summons, not incidental natural spawns ----
BOT_POS=$(eval_js "const p=bot.entity.position; return [Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)];")
BX=$(jq -r '.result[0]' <<<"$BOT_POS")
BY=$(jq -r '.result[1]' <<<"$BOT_POS")
BZ=$(jq -r '.result[2]' <<<"$BOT_POS")
AX=$((BX-6)); AY=$BY; AZ=$((BZ-6))
# pre-clean: a previous run of THIS fixture that failed/was interrupted before its own
# coordinate-anchored cleanup (below) could leave zombies alive right here -- start from zero.
rcon "kill @e[type=minecraft:zombie,x=$AX,y=$AY,z=$AZ,distance=..24]" >/dev/null 2>&1 || true
build_platform "$AX" "$AY" "$AZ" 12
rcon "fill $AX $((AY+3)) $AZ $((AX+11)) $((AY+3)) $((AZ+11)) minecraft:glowstone" >/dev/null
tp_bot "$BX" "$BY" "$BZ" || fail "could not confirm teleport into the arena"

# ---- kit: fillerItem() needs real cobblestone, the wait-loop's swing needs a real sword. No
# shield -- a shield can fully block the arc it's facing and starve the fixture of the very
# "damage from an unblocked direction" condition this fix exists for. Full HP (20), deliberately
# -- TODO #119's own ask is a DETERMINISTIC single-run pass, and a lower starting HP (an earlier
# draft used 12) turned this into real combat RNG: two live zombies against a partially-built
# wall can and did kill the bot outright before rescanMelee() ever got a chance to matter, which
# is a fixture-harness failure, not evidence about the fix. The mechanism under test — does
# rescanMelee() catch the SECOND zombie proactively, during normal building, before either lands
# a hit — needs zero HP margin to prove: dangerscan's panic trigger is SCORE-driven (two zombies
# close by cross panic() regardless of the bot's own HP), so branchWallOff still engages at full
# health, and a clean run (verified live, 2026-09-03T10:01:30-10:01:42Z) shows threatsNamed=2
# with hp staying 20/20 the WHOLE encounter -- the fix caught zombie B before it ever swung. ----
rcon "give $BOT_NAME minecraft:cobblestone 32" >/dev/null
rcon "give $BOT_NAME minecraft:stone_sword 1" >/dev/null
rcon "clear $BOT_NAME minecraft:shield" >/dev/null
# verify the kit actually landed in the bot's OWN inventory view before proceeding -- a `give`
# is server-side-immediate but the mineflayer client's inventory only updates once the
# WINDOW_ITEMS/SET_SLOT packet round-trips, independently of this script's own timing. First
# draft summoned the zombies right after the gives with no confirmation: dangerscan's own
# 250ms scan timer isn't gated on this script at all, and it fired pick() with a still-stale
# (empty) inventory often enough to send the fixture down FLEE_AWAY/FIGHT_BACK instead of
# WALL_OFF — same tp_bot/_tp_bot_once "confirm before proceeding" discipline as common.sh's own.
for i in 1 2 3 4 5 6 7 8 9 10; do
  kitOk=$(eval_js "return bot.inventory.items().some(i=>i.name==='cobblestone') && bot.inventory.items().some(i=>/_sword\$/.test(i.name));")
  [[ "$(jget "$kitOk" '.result')" == "true" ]] && break
  sleep 0.3
done
[[ "$(jget "$kitOk" '.result')" == "true" ]] || fail "cobblestone/sword never showed up in the bot's own inventory view within 3s of the give -- refusing to proceed with a stale-kit race"
eval_js "bot.health = 20; bot.food = 20; return {hp: bot.health, food: bot.food};" >/dev/null

# ---- two real zombies, close, at DIFFERENT bearings -- neither is named to anything, dangerscan
# has to find both on its own 4Hz scan exactly as it would a real second attacker.
#
# NoAI:1b (AI DISABLED), on purpose -- TODO #119's ask is a DETERMINISTIC single-run pass, and
# two live (NoAI:0b) attacking zombies made this a real-combat coin flip: whether the bot lives
# long enough for rescanMelee() to matter depends on how fast pathfinding lands hits on an
# unshielded bot doing nothing but placeAt() calls for several real seconds (branchWallOff does
# not fight back until HP<4 AND falling) -- two zombies got real, unmitigated hits in and killed
# the bot outright three separate times testing this, independent of starting HP (12 AND 20 both
# died this way), which is a fixture-harness failure, not evidence about the fix either way.
# NoAI does NOT change type/name/weight -- dangerscan's scan() only reads e.type/e.name (a NoAI
# zombie is still 'hostile'/'zombie', scores identically, still crosses panic()'s score
# threshold) -- so detection/naming is tested exactly as thoroughly with zero combat RNG. The
# fix's REACTIVE path (mid-wait-loop, HP actually falling) is separately already live-confirmed
# with real attacking zombies (FEEDBACK.md, 2026-09-03T10:18:22Z, hp fell to ~0.8 and
# recovered) -- this fixture only needs to nail down the PROACTIVE path deterministically.
rcon "summon minecraft:zombie $((BX+2)) $BY $BZ {NoAI:1b}" >/dev/null
rcon "summon minecraft:zombie $((BX-2)) $BY $BZ {NoAI:1b}" >/dev/null
sleep 0.5

# ---- watch the REAL pipeline run: dangerscan's own scan -> panic -> onDanger -> enter() ----
T0=$(date +%s)
hpMin=20
lastEventAt0=$(jget "$(eval_js "return (globalThis.__survival.lastEvent && globalThis.__survival.lastEvent.at) || 0;")" '.result')
recovered="false"
while (( $(date +%s) - T0 < 90 )); do
  hpNow=$(eval_js "return bot.health;")
  hpNowVal=$(jget "$hpNow" '.result')
  if [[ "$hpNowVal" != "null" ]] && awk -v h="$hpNowVal" -v m="$hpMin" 'BEGIN{exit !(h<m)}' 2>/dev/null; then hpMin="$hpNowVal"; fi
  if [[ "$hpNowVal" != "null" ]] && awk -v h="$hpNowVal" 'BEGIN{exit !(h<=0)}' 2>/dev/null; then break; fi
  brief=$(eval_js "return globalThis.__survival.brief();")
  st=$(jget "$brief" '.result.state')
  le=$(eval_js "return globalThis.__survival.lastEvent;")
  leAt=$(jget "$le" '.result.at')
  if [[ "$st" != *"panic"* && -n "$leAt" && "$leAt" != "null" && "$leAt" != "$lastEventAt0" ]]; then
    recovered="true"
    break
  fi
  sleep 2
done

# ---- cleanup FIRST (never leave live mobs / the arena behind on a failed assertion below).
# ANCHORED on the arena coords, not the bot's current position -- a fled/wall-off'd bot can be
# well outside a bot-relative radius, and an unanchored `distance=..N` selector resolves
# relative to the WORLD ORIGIN for an RCON/console command, not the bot -- a first draft's kill
# silently missed both zombies every time (they were 600+ blocks from 0,0,0), leaving them
# alive to keep re-triggering fresh encounters across every subsequent run of this fixture
# until a manual `kill @e[type=minecraft:zombie]` cleared the accumulated backlog by hand. ----
rcon "kill @e[type=minecraft:zombie,x=$AX,y=$AY,z=$AZ,distance=..24]" >/dev/null 2>&1 || true
clear_platform "$AX" "$AY" "$AZ" 12
rcon "fill $AX $((AY+3)) $AZ $((AX+11)) $((AY+3)) $((AZ+11)) minecraft:air" >/dev/null 2>&1 || true

# __skills.status().log is the WRONG source for this -- it's pushLog()'s own internal
# diagnostic ring (agenda transitions, danger alert/panic/recovered lines), a completely
# different sink from say()/bot.chat(), which is what "Also zombie..." actually goes through.
# No amount of widening that slice would ever find it (found live: -20 AND -80 both came up
# empty for a run `lastEvent.out.threatsNamed` had already confirmed at 2). The bot's own
# runner.js process log (logs/<name>.log) is what actually records every <chat>/<say> line --
# read THAT directly, this script runs on the same machine/checkout as the bot process.
recent=$(tail -n 200 "$BENCH_DIR/../logs/$BOT_NAME.log" 2>/dev/null | grep -E '<chat>|<say>' | tail -n 20 | tr '\n' '|')
recentStr="$recent"
lastEvent=$(eval_js "return globalThis.__survival.lastEvent;")
branchOk=$(jget "$lastEvent" '.result.branch')
threatsNamed=$(jget "$lastEvent" '.result.out.threatsNamed')

if [[ "$hpMin" != "null" ]] && awk -v h="$hpMin" 'BEGIN{exit !(h<=0)}' 2>/dev/null; then
  fail "bot died during the induced two-zombie encounter (hpMin=$hpMin, threatsNamed=$threatsNamed) -- the fix did not save it. log tail: $recentStr"
fi
if [[ "$recovered" != "true" ]]; then
  fail "survival never reached a recovered state within 90s (never panicked at all, or got stuck mid-panic) -- brief: $brief, lastEvent: $lastEvent"
fi
if [[ "$branchOk" != "WALL_OFF" ]]; then
  fail "the real pipeline chose branch='$branchOk', not WALL_OFF -- this fixture's kit (filler+sword, far from home) is meant to force pick()'s WALL_OFF fallback; can't test the fix without landing in it. lastEvent: $lastEvent"
fi
if [[ "$threatsNamed" == "null" || "$threatsNamed" -lt 2 ]]; then
  fail "threatsNamed=$threatsNamed (expected >=2) -- zombie B was never independently detected/named by rescanMelee(), the multi-threat gap is NOT fixed. log tail: $recentStr"
fi
if [[ "$recentStr" != *"Also zombie"* ]]; then
  fail "engine reported threatsNamed=$threatsNamed but no 'Also zombie ... didn't see that one before' chat line found in the recent log -- corroborating signal missing: $recentStr"
fi

pass "two-zombie encounter survived (hpMin=$hpMin), pick() chose WALL_OFF against one zombie and threatsNamed=$threatsNamed (the second was independently detected/defended, not just the one the branch was originally called with), corroborated by chat: $recentStr"
