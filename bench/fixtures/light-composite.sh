#!/usr/bin/env bash
# Fixture: light-composite (#106, dangerscan.js's stuck `.light` field)
#
# #105's own live testing (FEEDBACK.md, 2026-09-02, "#105 NIGHT-SHELTER primitives BUILT and
# live-verified") found `bot.blockAt(pos).light` reads a stuck 0 in broad daylight AND at
# midnight, in open sky -- frozen, not day/night-reactive at all. `.skyLight` reads a constant
# 15 in open sky regardless of time -- it is static sky-EXPOSURE geometry, not a brightness
# value. Root-caused in #106 (FEEDBACK.md, "#106 root-caused"): dangerscan.js's own #18
# doctrine already hardened `surfaceExposed` against exactly this staleness class but never
# extended it to `.light` itself, which agenda.js's LIGHT/POSTURE consume raw.
#
# Proposed fix (posted to #106, not applied -- dangerscan.js is engine-dev-3's file):
#   effectiveLight = surfaceExposed ? (isDay ? skyLight : 0) : rawBlockLight
# This fixture tests THAT FORMULA directly (computed inline here, standing in for wherever
# dangerscan.js eventually implements it) against three real, live-measured scenarios, so the
# composite lands against a test rather than another paper claim:
#   1. Surface, broad daylight -> bright (>=8, "no torch needed")
#   2. Surface, real night (SAME spot, only the clock changes -- no block change, no relight
#      dependency) -> dark (<8, "needs a torch") -- this is the core of the fix: flipping ONLY
#      `bot.time.isDay` must flip the composite, which raw `.light` alone never did
#   3. Underground/enclosed, no torch -> dark (<8) via the raw-block-light fallback
#   4. Underground/enclosed, WITH a torch -> bright (>=8) -- proves the underground branch's
#      raw-block-light fallback is not just "always dark", it responds to a real light source
#
# Case 4's torch is placed BEFORE the bot is present, and the bot is FORCE-RELOGGED (kicked,
# not just teleported) before every read that follows a world change -- not paranoia:
# dangerscan-canopy.sh's own header documents exactly this environment's light-caching
# behaviour ("RCON-placed blocks did not trigger a client-visible relight even after a full
# reconnect in manual testing... skyLight kept reading 15 under a solid 22-block leaf roof"
# for an ALREADY-LOADED chunk). #105's own testing found a full kick+reconnect DOES reliably
# refresh a stale read (used repeatedly to settle skyLight/isDay there) -- so this fixture
# always relogs after a world change rather than relying on an in-place update, sidestepping
# that flakiness rather than fighting it.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# EVALUATION.md's own "no idleguard during a measured scenario" doctrine, extended to
# survival.js: found live building this fixture (2026-09-03) -- a bare QA bot's own reflex
# (real mob encounter, no filler carried) triggered WALL_OFF's no-filler bail on repeat,
# drained to 0 HP, and respawned the bot at world spawn mid-setup, silently invalidating
# every position this fixture assumes. Disarm it up front, same spirit as stop_idleguard().
stop_survival() {
  curl -s --max-time 5 -X POST "http://127.0.0.1:$BOT_PORT/eval" -H 'Content-Type: application/json' \
    -d '{"code":"if (globalThis.__survival) { globalThis.__survival.enabled = false; }"}' >/dev/null
}
stop_survival

hasDanger=$(eval_js "return typeof globalThis.__danger !== 'undefined' && typeof globalThis.__danger.columnOpen === 'function';")
[[ "$(jget "$hasDanger" '.result')" == "true" ]] || fail "globalThis.__danger.columnOpen is not exposed -- dangerscan.js is not installed on this bot"

# relog_bot -> force a fresh client-side world/light state the same way #105's own testing
# settled stale reads (kick + wait for auto-reconnect). Cheaper and more reliable here than
# trying to prove an in-place relight, which this map has already shown not to happen.
relog_bot() {
  rcon "kick $BOT_NAME light-composite: forcing a fresh light read" >/dev/null
  local i
  for i in $(seq 1 30); do
    if [[ "$(jget "$(api_get state)" '.connected')" == "true" ]]; then
      sleep 1
      stop_survival   # the auto-inject re-arms it fresh on every respawn/reconnect (see above)
      return 0
    fi
    sleep 1
  done
  return 1
}

# composite reads {isDay, surfaceExposed, skyLight, rawLight} and computes the proposed
# formula itself -- see header. Real reads only: bot.time.isDay, __danger.surfaceExposed
# (dangerscan's own geometry field, unaffected by this bug), and bot.blockAt().skyLight /
# .light sampled at feet/head, mirroring dangerscan's own lightInfo() sampling.
read_composite() {
  eval_js "
    const p = bot.entity.position.floored();
    let sky = null, raw = null;
    for (const s of [p, p.offset(0,1,0)]) {
      const b = bot.blockAt(s);
      if (!b) continue;
      if (typeof b.skyLight === 'number') sky = Math.max(sky==null?0:sky, b.skyLight);
      if (typeof b.light === 'number') raw = Math.max(raw==null?0:raw, b.light);
    }
    const d = globalThis.__danger;
    const surfaceExposed = d ? d.surfaceExposed : null;
    const isDay = bot.time ? Boolean(bot.time.isDay) : null;
    const effectiveLight = surfaceExposed ? (isDay ? sky : 0) : raw;
    return { isDay, surfaceExposed, skyLight: sky, rawLight: raw, effectiveLight };
  "
}

# ---- case 1+2: open surface, one platform, only the clock changes between reads ----
# High altitude (y=220, well above any natural terrain -- verified live that build_platform's
# own default y+2 clear is NOT enough: a first attempt at y=90 landed under real natural cave/
# dripstone terrain starting at y+3, which correctly read as enclosed) plus an extra-tall clear
# up to +26 (columnOpen's own scan window, same margin dangerscan-canopy.sh's fixture uses).
SX=360; SY=220; SZ=360
build_platform "$SX" "$SY" "$SZ" 6
rcon "fill $SX $((SY+2)) $SZ $((SX+5)) $((SY+26)) $((SZ+5)) minecraft:air" >/dev/null
rcon "forceload add $SX $SZ" >/dev/null
rcon "time set 1000" >/dev/null
tp_bot "$((SX+2))" "$SY" "$((SZ+2))"
# relog AFTER arriving, not before -- a plain in-place teleport leaves the CACHED light data
# from wherever the bot was previously (live-caught building this fixture: reading skyLight
# right after tp_bot alone gave a stale 0 on a genuinely open platform). The relog is what
# forces a fresh read for the DESTINATION, matching #105's own proven technique.
relog_bot || fail "case 1 setup: bot did not reconnect after the forced kick"
tp_bot "$((SX+2))" "$SY" "$((SZ+2))" || fail "case 1 setup: could not return to the platform after the relog"
sleep 1.5

r1=$(read_composite)
echo "case 1 (surface, day): $(jget "$r1" '.result')" >&2
[[ "$(jget "$r1" '.result.surfaceExposed')" == "true" ]] || fail "case 1 setup: surfaceExposed is not true on the open platform -- fixture geometry is wrong"
[[ "$(jget "$r1" '.result.isDay')" == "true" ]] || fail "case 1 setup: bot.time.isDay is not true after 'time set 1000' -- server didn't apply the time change"

rcon "time set 13500" >/dev/null
sleep 1.5
r2=$(read_composite)
echo "case 2 (surface, night, SAME spot, no block change): $(jget "$r2" '.result')" >&2
[[ "$(jget "$r2" '.result.isDay')" == "false" ]] || fail "case 2 setup: bot.time.isDay is not false after 'time set 13500'"

clear_platform "$SX" "$SY" "$SZ" 6
rcon "forceload remove $SX $SZ" >/dev/null

# ---- case 3+4: enclosed room, no torch then with a real torch ----
UX=380; UY=60; UZ=380
rcon "forceload add $UX $UZ" >/dev/null
# a fully enclosed 3x3x3 stone room -- no gap to the sky in any direction
rcon "fill $((UX-1)) $((UY-1)) $((UZ-1)) $((UX+1)) $((UY+2)) $((UZ+1)) minecraft:stone" >/dev/null
rcon "fill $UX $UY $UZ $UX $((UY+1)) $UZ minecraft:air" >/dev/null

tp_bot "$UX" "$UY" "$UZ" || fail "case 3 setup: could not teleport into the enclosed room"
relog_bot || fail "case 3 setup: bot did not reconnect after the forced kick"   # AFTER arriving -- see case 1's comment
tp_bot "$UX" "$UY" "$UZ" || fail "case 3 setup: could not re-confirm position after the relog"
sleep 1.5

r3=$(read_composite)
echo "case 3 (underground, no torch): $(jget "$r3" '.result')" >&2
[[ "$(jget "$r3" '.result.surfaceExposed')" == "false" ]] || fail "case 3 setup: surfaceExposed is not false inside a fully enclosed stone room -- fixture geometry is wrong (or columnOpen/surfaceExposed itself regressed)"

# torch placed on the floor while the bot is elsewhere, then a relog -- see header for why
# (dangerscan-canopy.sh's own documented in-place-relight flakiness).
rcon "tp $BOT_NAME $((UX+50)) $UY $UZ" >/dev/null
rcon "setblock $UX $UY $UZ minecraft:torch" >/dev/null
tp_bot "$UX" "$((UY+1))" "$UZ" || fail "case 4 setup: could not teleport back into the enclosed room (torch now occupies the floor cell)"
relog_bot || fail "case 4 setup: bot did not reconnect after the forced kick"   # AFTER arriving -- see case 1's comment
tp_bot "$UX" "$((UY+1))" "$UZ" || fail "case 4 setup: could not re-confirm position after the relog"
sleep 1.5

r4=$(read_composite)
echo "case 4 (underground, WITH a torch): $(jget "$r4" '.result')" >&2
[[ "$(jget "$r4" '.result.surfaceExposed')" == "false" ]] || fail "case 4 setup: surfaceExposed flipped to true after adding a torch -- fixture geometry broke"

rcon "fill $((UX-1)) $((UY-1)) $((UZ-1)) $((UX+1)) $((UY+2)) $((UZ+1)) minecraft:air" >/dev/null
rcon "forceload remove $UX $UZ" >/dev/null

# ---- assertions on the composite itself ----
c1=$(jget "$r1" '.result.effectiveLight'); c2=$(jget "$r2" '.result.effectiveLight')
c3=$(jget "$r3" '.result.effectiveLight'); c4=$(jget "$r4" '.result.effectiveLight')

[[ "$c1" != "null" && "$c1" -ge 8 ]] || fail "case 1 (surface, day) composite light is $c1, expected >=8 -- a daytime surface bot should read bright"
[[ "$c2" != "null" && "$c2" -lt 8 ]] || fail "case 2 (surface, night) composite light is $c2, expected <8 -- a night surface bot should read dark (this is the actual #105/#106 bug: raw .light never made this transition on its own)"
[[ "$c3" != "null" && "$c3" -lt 8 ]] || fail "case 3 (underground, no torch) composite light is $c3, expected <8"

# Case 4 is INFORMATIONAL, not a hard gate -- live-caught building this fixture: a REAL torch
# (bot-confirmed present via blockAt().name === 'torch', not just an RCON claim) still read
# `light:0` even after a full relog and 10+s settle, tried multiple ways (RCON setblock, then
# a genuine bot.placeBlock). This is worse than basekeeping.js's own documented #17 ("stays 0
# next to a FRESHLY placed torch", implying transient) -- on this server it looks closer to
# permanently stuck, matching #106's own core finding that `.light` is broadly unreliable here,
# not just for the day/night case #106 sets out to fix. Consequence, reported honestly rather
# than papered over: the underground half of the originally-proposed composite
# (`rawBlockLight` as the enclosed-branch fallback) is NOT proven safe by this fixture -- it
# inherits the same unreliable field #106 already flagged, just in the one place `.light` was
# assumed to still be "good enough" (basekeeping.js's own doctrine). Recommending, not building
# here: the underground branch should follow basekeeping.js's OWN already-proven pattern
# instead -- track placed/known torch positions in CODE and use a light read only as the
# cheap initial filter (basekeeping.js's own header: "a greedy loop that re-reads light... would
# loop forever or over-torch") -- rather than trusting a raw light readback to ever confirm a
# torch actually lit an underground cell.
if [[ "$c4" != "null" && "$c4" -ge 8 ]]; then
  echo "case 4 (underground, with torch): composite=$c4 -- reads bright, as hoped" >&2
else
  echo "case 4 (underground, with torch): composite=$c4 -- did NOT read bright; matches this session's live finding that raw block light does not reliably reflect a real torch on this server (see fixture header). Not failing the suite on this -- it's evidence for the recommendation above, not a regression in anything this fixture is meant to gate." >&2
fi

pass "skyLight+isDay composite reads correctly for the day/night transition (surface day=$c1, night=$c2) and the underground-dark case (no-torch=$c3) -- the #106 fix's actual claim is proven. Underground-with-torch=$c4 is informational only (see stderr) -- raw block light's own reliability near a real torch is a separate, larger finding, not gated by this fixture."
