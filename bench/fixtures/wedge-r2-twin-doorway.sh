#!/usr/bin/env bash
# Fixture: wedge-r2-twin-doorway (#54 R2 — the live half of the proof)
#
# STATUS (2026-09-02, live server): the GEOMETRY-BUILDING HARNESS below works and is real
# infrastructure (continuous floor, forceload-before-fill, chunk-settle verification, ledger
# window analysis, honest PASS/INCONCLUSIVE grading — all live-debugged, see the REVISION
# notes). The OBSTRUCTION MECHANISM does not: FOUR candidates were tried live in the
# "blocked" gap and all four FAILED to wedge the bot (see REVISIONS 1-4 below) — a fifth idea
# is needed before this fixture can prove anything. Running it as currently committed
# (armor_stand) will reliably report INCONCLUSIVE, not because the harness is broken but
# because that specific mechanism is now confirmed not to work. Whoever picks this up next:
# read all four revision notes before trying a fifth candidate, so the same ground isn't
# re-covered.
#
# engine-dev-3's bench/fixtures/gotoR-recovery.js proved findRepositionTarget's CANDIDATE
# SEARCH is correct in isolation (right cell, right priority, protection respected) but its
# own header says explicitly what it cannot prove: that walking to the chosen cell and
# re-issuing the goto actually gets a genuinely wedged bot unstuck. That needs a real
# pathfinder against real terrain. This fixture is that half. Coordinate with engine-dev-3
# before/while iterating further — they own gotoR/_reposition's actual internals and may have
# field-observed what a real `stuck` looks like better than a synthetic trap can guess.
#
# WHY TORCH/LEAF-LITTER WON'T DO (see wedge-torch.sh / wedge-leaf-litter.sh headers): those
# are PLANNER-RETIRED — baseMovements' blocksToAvoid digs them out before the bot ever steps
# in, so they never reach `stuck` at all any more. A genuine R2-triggering wedge needs an
# obstruction ctx._unstick's nuisance-block dig CANNOT clear (solid, not empty-boundingBox)
# and a caller timeoutMs generous enough that the internal FROZEN/NO_PROGRESS watchdog can
# actually reach `stuck` before the caller's own path_timeout fires first (the "thinkTimeout
# pre-empts stuck" trap) -- see the timing budget below.
#
# GEOMETRY (the "twin doorway" trap, v2 -- see the REVISION note below): a wall between the
# bot and the goal has two gaps, both block-wise open air. The "blocked" gap sits exactly on
# the straight heuristic line between start and goal (so a distance-minimizing A* prefers and
# COMMITS to it -- it is genuinely the shorter path); the real OPEN gap sits 2 blocks off that
# axis, matching _reposition's own dx/dz=2 candidate offsets, so if this wedges the bot at
# all, the reposition step lands it roughly in line with the real doorway and the re-issued
# A* finds the now-obvious route.
#
# WHAT ACTUALLY BLOCKS THE "BLOCKED" GAP: a non-marker `minecraft:armor_stand` entity, not a
# block. baseMovements() (runner.js ~139) has `entitiesToAvoid` scoped to hostile mobs only
# (creeper/zombie/skeleton/spider/witch/husk/drowned/enderman/phantom/pillager) -- an armor
# stand is invisible to the pathfinder's cost model entirely, so the SEARCH sees both gaps as
# equally valid block-wise-open air and correctly, minimally, picks the geometrically shorter
# one. The bot then tries to WALK it and physically collides with the entity's real hitbox --
# a phantom obstruction the graph search never priced in. `ctx._unstick` cannot clear this
# either, by design (skills.js ~659: it explicitly excludes plain `air`/`cave_air`/`void_air`
# from its nuisance-block dig, and there IS no block there to dig -- the block layer is
# genuinely open, only the entity blocks). Confirmed on this server: `entitiesToAvoid` really
# is scoped that narrowly (read runner.js directly, not inferred).
#
# REVISION 1: v1 used `minecraft:barrier` in the blocked gap. LIVE-OBSERVED (once the
# chunk-loading issues below were fixed): the bot reached the goal in 4s with ZERO recovery
# events -- mineflayer-pathfinder's A* is a complete graph search, not local hill-climbing,
# so a block-level-impassable barrier is simply excluded from the graph and the search finds
# the real (open) gap on its first and only attempt. It never "tries" the blocked route at
# all, so there is nothing for R2 to recover FROM. Conclusion: the trap needs to target an
# EXECUTION-level failure (a real obstruction the search cannot see), not a search-level one
# (a graph edge the search correctly prices out).
#
# REVISION 2: swapped the barrier for a non-marker `minecraft:armor_stand` (Invulnerable,
# NoGravity, tagged for cleanup) sitting in block-wise-open air, reasoning that baseMovements'
# `entitiesToAvoid` (runner.js ~139) is scoped to hostile mobs only, so the SEARCH would price
# both gaps as equally open and correctly prefer the geometrically shorter (blocked) one,
# while the entity's real hitbox should physically stop the walk. LIVE-OBSERVED (isolated
# single-gap corridor, raw `bot.pathfinder.setGoal` + polling, no fixture harness): the bot's
# OWN reported position walked straight past/through the armor stand's exact cell with zero
# hesitation. Conclusion: mineflayer's client-side physics (prismarine-physics) does not
# simulate entity-vs-entity collision for the bot's own movement AT ALL -- only block AABBs.
# No entity of any kind can physically obstruct a bot's own walk this way; this whole
# approach (any non-block obstruction) is a dead end, not just this specific entity type.
#
# REVISION 3 & 4: went looking for another leaf_litter-CLASS block (empty boundingBox,
# `shapes:[]`, diggable -- the exact signature that made the ORIGINAL torch/leaf_litter bug
# possible: "onGround=false forever, jump never fires" per wedge-torch.sh/wedge-leaf-litter.sh's
# own headers) that is NOT yet in baseMovements' blocksToAvoid list. Queried the live block
# registry directly (`bot.registry.blocksByName`) rather than guessing: 231 blocks match that
# signature and aren't blocklisted (full list in FEEDBACK.md, 2026-09-02). Tried the two most
# structurally similar to leaf_litter -- `cobweb` (real, intentional movement-speed penalty)
# and `short_dry_grass` (a near-identical thin floor-decoration overlay, likely the same
# rendering/collision code family as leaf_litter). LIVE-OBSERVED (same isolated single-gap
# corridor + raw goal, tight 1s polling from the start): the bot walked through BOTH at full
# speed with no stall or slowdown at all -- reached the goal well within the first poll each
# time. Conclusion: whatever made leaf_litter/torch specifically break onGround/auto-jump on
# this mineflayer version is NOT a general property of "empty boundingBox" blocks; it was
# specific to those two block(s)' own quirky collision/rendering code, now specifically
# patched, and does not generalize to other decorative overlay blocks that merely share the
# same `shapes:[]` registry signature. A fifth candidate needs a DIFFERENT theory of the bug,
# not another block picked from the same registry query.
#
# TIMING BUDGET (worked from skills.js's own watchdog, ctx.goto): FROZEN fires at 6s of zero
# displacement; 3 escalations (unsticks 0->1->2->3) before throwing `stuck` is ~4 x 6s = 24s
# of accumulated frozen time PLUS however long each ctx._unstick() attempt itself takes.
# NO_PROGRESS uses a 15s window instead, per #53's calibration note. Either path needs
# meaningfully more than ~30s of caller budget to complete before a shorter timeoutMs would
# hit path_timeout first and never reach `stuck` (the exact failure mode this fixture must
# avoid). `come` (skills.js ~3099) calls `ctx.retry('travel', () => ctx.gotoNear(args, range,
# 60000), 2)` -- gotoNear routes through gotoR since #54 landed (f6adce8), and 60s per
# attempt (x2 retries) is comfortably inside the budget this needs.
#
# PASS = the bot reaches the goal room AND the ledger recorded at least one `recovery`
# event (rung R2) in this fixture's own time window -- i.e. it didn't just detour around
# cleanly without ever wedging (that would prove nothing about R2) or fail outright.
# A run that reaches the goal with ZERO recovery events is inconclusive, not a pass: it
# means this geometry didn't actually wedge the bot, and the trap needs to be harder
# (narrower offset margin, longer false-lead approach, or a longer wall so the heuristic
# commits more strongly to the blocked gap) -- reported as such, not silently swept into
# a false "R2 works" claim.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

# ---- geometry: pick coordinates well clear of every other fixture's footprint ----
WX=300          # the dividing wall sits at this x
Z0=80           # wall spans z=Z0..Z0+10
WY=80           # wall base y (3 tall: WY, WY+1, WY+2)
BLOCKED_Z=$((Z0 + 5))   # on the straight start->goal line -- the false lead
OPEN_Z=$((Z0 + 7))      # 2 blocks off-axis -- the real route, matching _reposition's offset

START_X=$((WX - 10)); START_Z=$BLOCKED_Z
GOAL_X=$((WX + 10));  GOAL_Z=$BLOCKED_Z

echo "building twin-doorway geometry at wall x=$WX, blocked gap z=$BLOCKED_Z, open gap z=$OPEN_Z" >&2

# ONE continuous floor spanning start room -> wall -> goal room. LIVE-OBSERVED BUG (first
# build of this fixture): two separate build_platform islands (start x=286-299, goal
# x=308-321) with the wall as a lone 1-thick column at x=300 left an 8-block strip
# (x=301-307) covered by NEITHER platform -- unguaranteed natural terrain exactly like
# build_platform's own header warns about ("unpredictable cave/void terrain... any fixture
# needing guaranteed solid ground builds its own"). The pathfinder correctly reported
# `no_path`: there was a real hole between the open doorway and the goal room. build_platform
# only builds a SQUARE footprint (x2=x+size-1, z2=z+size-1), so one call sized to the full
# x-span (with z overshooting a little, harmless) replaces the two disconnected islands.
FULL_X=$((START_X - 4))
FULL_Z=$((Z0 - 2))
FULL_SIZE=$(( (GOAL_X + 2) - FULL_X + 1 ))
FULL_X2=$((FULL_X + FULL_SIZE - 1))
FULL_Z2=$((FULL_Z + FULL_SIZE - 1))
FL_X1=$((FULL_X - 10)); FL_Z1=$((FULL_Z - 10)); FL_X2=$((FULL_X2 + 10)); FL_Z2=$((FULL_Z2 + 10))
# single source of truth for teardown, called from every exit path below -- the platform is a
# SQUARE (build_platform's own math), so cleanup must match that footprint exactly or it
# leaves an orphaned stone slab behind (the z-axis overshoots what the geometry actually
# needs, since one call sized the platform to cover the full x-span). Also releases the
# forceload ticket -- leaving chunks force-loaded forever is bad citizenship on a shared
# fixture server.
FIXTURE_TAG="wedge_r2_twin_doorway"
cleanup_geometry() {
  rcon "kill @e[type=armor_stand,tag=$FIXTURE_TAG]" >/dev/null
  rcon "fill $FULL_X $((WY-1)) $FULL_Z $FULL_X2 $((WY+3)) $FULL_Z2 minecraft:air" >/dev/null
  rcon "forceload remove $FL_X1 $FL_Z1 $FL_X2 $FL_Z2" >/dev/null
}

# LIVE-OBSERVED BUG (second run of this fixture): vanilla /fill silently no-ops with "That
# position is not loaded" on a chunk the server has never generated/loaded -- unlike a normal
# player walking in, RCON does not force generation. build_platform's fills were failing
# EVERY time (discarded by this script's own >/dev/null), so nothing was ever actually built
# and the bot was falling/landing on whatever unrelated natural terrain happened to be there.
# `forceload add` guarantees the chunks are loaded regardless of any player's view distance,
# independent of the tp_bot chunk-subscription timing fixed below.
rcon "forceload add $FL_X1 $FL_Z1 $FL_X2 $FL_Z2"
sleep 1.0

fill_checked() {
  local resp; resp=$(rcon "fill $1")
  if [[ "$resp" == *"not loaded"* || "$resp" == *"Unknown"* || "$resp" == *"failed"* ]]; then
    cleanup_geometry
    fail "fill '$1' did not succeed: $resp"
  fi
}
fill_checked "$FULL_X $((WY-1)) $FULL_Z $FULL_X2 $((WY-1)) $FULL_Z2 minecraft:stone"
fill_checked "$FULL_X $WY $FULL_Z $FULL_X2 $((WY+2)) $FULL_Z2 minecraft:air"
fill_checked "$WX $WY $Z0 $WX $((WY+2)) $((Z0+10)) minecraft:stone"
# "blocked" gap: block-wise OPEN (air, like the real gap) so the search's graph has no reason
# to price it any differently -- an armor stand physically fills it instead (see the header's
# WHAT ACTUALLY BLOCKS section). Invulnerable+NoGravity so it can't be knocked over or drop
# through anything mid-fixture; tagged so cleanup can kill exactly this entity and nothing else.
fill_checked "$WX $WY $BLOCKED_Z $WX $((WY+1)) $BLOCKED_Z minecraft:air"
rcon "summon minecraft:armor_stand $((WX)).5 $WY $((BLOCKED_Z)).5 {Invulnerable:1b,NoGravity:1b,Tags:[\"$FIXTURE_TAG\"]}" >/dev/null
# open gap: the only real (unobstructed) route
fill_checked "$WX $WY $OPEN_Z $WX $((WY+1)) $OPEN_Z minecraft:air"

stop_idleguard

# tp_bot only confirms X/Z (its own comment: Y drift on arrival is "a terrain fact for the
# fixture to handle, not a teleport-confirmation concern"). LIVE-OBSERVED (first run of this
# fixture): teleporting a bot whose client had never loaded this FAR-from-spawn chunk before
# caused mineflayer to free-fall from y=80 to y=64 -- the position packet lands before the
# chunk's block-state packets do, so physics briefly runs against an unloaded (air) world.
# Fix: teleport once to force the chunk subscription/generation, wait for it to actually
# arrive, then teleport AGAIN -- the second arrival lands on real, already-loaded geometry.
tp_bot "$START_X" "$WY" "$START_Z"
sleep 2.0
tp_bot "$START_X" "$WY" "$START_Z"
sleep 0.5
settle=$(eval_js "return { y: bot.entity.position.y, onGround: bot.entity.onGround };")
settleY=$(jget "$settle" '.result.y')
if ! awk -v y="$settleY" -v want="$WY" 'BEGIN{exit !(sqrt((y-want)^2) < 2)}' 2>/dev/null; then
  cleanup_geometry
  fail "settle check failed: bot at y=$settleY, expected near y=$WY -- still falling/unloaded after two teleports, geometry or chunk-load timing needs more work"
fi

# window start: only count recovery/goto records from here on
T0=$(date +%s%3N)

t0=$(date +%s)
r=$(start_skill come "{\"x\":$GOAL_X,\"y\":$WY,\"z\":$GOAL_Z,\"range\":2}")
if [[ "$(jget "$r" '.result.ok')" != "true" ]]; then
  cleanup_geometry
  fail "start_skill rejected: $r"
fi
final=$(wait_task 150)
t1=$(date +%s)
elapsed=$((t1 - t0))

# ---- ledger read: any `recovery` (rung R2) events in this window, for THIS bot ----
LOG="$SELF_DIR/../logs/metrics-$BOT_NAME.jsonl"
recoveries="[]"
if [[ -f "$LOG" ]]; then
  recoveries=$(jq -c --argjson t0 "$T0" '. as $r | select(.ev=="recovery" and .t >= $t0)' "$LOG" 2>/dev/null | jq -sc '.')
  gotos_in_window=$(jq -c --argjson t0 "$T0" '. as $r | select(.ev=="goto" and .t >= $t0)' "$LOG" 2>/dev/null | jq -sc '.')
else
  echo "WARNING: no ledger file at $LOG -- was telemetry.js installed on this bot?" >&2
  gotos_in_window="[]"
fi
n_recoveries=$(jq 'length' <<<"$recoveries")

# cleanup regardless of outcome
cleanup_geometry

running=$(jget "$final" '.result.task.running')
done_=$(jget "$final" '.result.task.done')
errCode=$(jget "$final" '.result.task.error.code')

echo "elapsed=${elapsed}s  done=$done_  errCode=$errCode  recovery_events_in_window=$n_recoveries" >&2
echo "recoveries: $recoveries" >&2
echo "gotos: $gotos_in_window" >&2

[[ "$running" != "true" ]] || fail "come still running after 150s -- neither arrived nor gave up cleanly"

if [[ "$n_recoveries" -eq 0 ]]; then
  if [[ "$done_" == "true" ]]; then
    fail "INCONCLUSIVE: reached the goal in ${elapsed}s but ZERO recovery events fired -- this geometry did not actually wedge the bot (search found the open gap directly), so it proves nothing about R2. Needs a harder trap: narrower margin, longer wall, or a longer false-lead approach."
  else
    fail "no recovery events AND did not complete (errCode=$errCode) -- either the trap is unsolvable as built (check the open gap is really clear) or something else broke; not an R2 result either way"
  fi
fi

assert_eq "$done_" "true" "R2 fired ($n_recoveries times) but the task never completed (errCode=$errCode) -- R2 recovered from the wedge without the bot actually reaching the goal, or gave up after r2Max retries. See the recoveries/gotos dump above."
pass "R2 fired $n_recoveries time(s) and the bot reached the goal in ${elapsed}s -- see stderr for the recovery/goto records to score displaced-vs-replan"
