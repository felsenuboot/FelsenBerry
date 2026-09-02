#!/usr/bin/env bash
# Fixture: wedge-r2-fault-inject (#54 R2 — live proof, fault-injection half)
#
# Team-lead's re-scoped standard (2026-09-02), after five documented live attempts to STAGE a
# genuine wedge on synthetic geometry all falsified their obstruction mechanism (see
# wedge-r2-twin-doorway.sh's REVISIONS 1-4 and FEEDBACK.md's flowing-water attempt #5): the
# engine will not wedge on invented terrain, which argues the recovery ladder is sound, not
# that it's proven. Rather than keep hunting exotic geometry, the gate splits in two: (a) THIS
# fixture proves R2's RESOLUTION ACTION — reposition + re-issued goto — fires and completes
# for real, with only the TRIGGER injected; (b) the field half is the first NATURALLY-occurring
# firing observed in fleet telemetry via the M.recovery sink, unrelated to this file.
#
# HOW THE INJECTION WORKS (skills.js's gotoR, ~line 727): armed via
# `globalThis.__r2Fault = {armed:true}`, gotoR's FIRST attempt throws a synthetic `stuck`
# instead of running the real ~25-30s watchdog — consumed one-shot the instant it's read.
# Every step after that is completely real: ctx._reposition()'s dead-reckoning walk against
# the real world, the re-issued A* against real terrain, whether it actually arrives.
#
# #38 DOCTRINE, why this fixture reads back TWO independent channels rather than trusting the
# task's own "done:true": the last test hook of this shape (survival.js's `drill()`,
# `pickOverride`) was silently broken for its entire life — captured but never called — so
# every historical claim built on it was unknowingly exercising unrelated live conditions. A
# hook that cannot prove it fired manufactures false confidence, worse than no hook. So this
# fixture asserts on BOTH: (1) globalThis.__r2FaultProof, written in-process as the episode
# unfolds (fired/reposition/retry, each with a real timestamp and outcome) — proves the CODE
# PATH was actually reached, not just that the task happened to succeed some other way; (2) the
# ledger's own `recovery`+`goto` records in the fixture's time window — proves the SAME episode
# independently, through the durable channel a field observation would use. Agreement between
# both, not either alone, is what "proven" means here.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SELF_DIR/lib/common.sh"

PX=400; PY=80; PZ=80
SIZE=30
PX2=$((PX + SIZE - 1)); PZ2=$((PZ + SIZE - 1))
START_X=$((PX + 3)); START_Z=$((PZ + 3))
GOAL_X=$((PX + 24)); GOAL_Z=$((PZ + 24))   # ~30 blocks away, well under come's 80-block gotoFar cutoff

# LIVE-OBSERVED (this fixture's own first run, and independently by engine-dev's
# wedge-r2-twin-doorway.sh): this far from spawn the chunk is often never-generated, and
# vanilla /fill SILENTLY NO-OPS ("that position is not loaded") rather than forcing
# generation the way a player walking in would -- so build_platform's fills can fail
# invisibly (this script's own `>/dev/null` would hide it) and the bot then teleports onto
# whatever unrelated natural terrain/void happens to exist there. `forceload add` first,
# then verify every fill actually succeeded rather than trusting it.
FL_X1=$((PX - 10)); FL_Z1=$((PZ - 10)); FL_X2=$((PX2 + 10)); FL_Z2=$((PZ2 + 10))
cleanup_geometry() {
  rcon "fill $PX $((PY - 1)) $PZ $PX2 $((PY + 3)) $PZ2 minecraft:air" >/dev/null
  rcon "forceload remove $FL_X1 $FL_Z1 $FL_X2 $FL_Z2" >/dev/null
}
rcon "forceload add $FL_X1 $FL_Z1 $FL_X2 $FL_Z2"
sleep 1.0
fill_checked() {
  local resp; resp=$(rcon "fill $1")
  if [[ "$resp" == *"not loaded"* || "$resp" == *"Unknown"* || "$resp" == *"failed"* ]]; then
    cleanup_geometry
    fail "fill '$1' did not succeed: $resp"
  fi
}
fill_checked "$PX $((PY - 1)) $PZ $PX2 $((PY - 1)) $PZ2 minecraft:stone"
fill_checked "$PX $PY $PZ $PX2 $((PY + 2)) $PZ2 minecraft:air"

stop_idleguard

# Teleport-wait-teleport-again + explicit settle check (engine-dev's proven fix,
# wedge-r2-twin-doorway.sh): a bot whose client never loaded this chunk before can free-fall
# on the FIRST teleport, because the position packet lands before the chunk's block-state
# packets do. tp_bot only confirms X/Z (Y drift on arrival is documented as expected there),
# so verify Y explicitly here rather than assuming the platform was actually stood on.
tp_bot "$START_X" "$PY" "$START_Z"
sleep 2.0
tp_bot "$START_X" "$PY" "$START_Z"
sleep 0.5
settle=$(eval_js "return { y: bot.entity.position.y };")
settleY=$(jget "$settle" '.result.y')
if ! awk -v y="$settleY" -v want="$PY" 'BEGIN{exit !(sqrt((y-want)^2) < 2)}' 2>/dev/null; then
  cleanup_geometry
  fail "settle check failed: bot at y=$settleY, expected near y=$PY -- still falling/unloaded after two teleports"
fi

# ---- arm the fault, confirm the arm itself landed (belt+suspenders: a failed arm should
# read back as unarmed, not silently proceed to test nothing) ----
armed=$(eval_js "globalThis.__r2Fault = { armed: true }; return { armed: Boolean(globalThis.__r2Fault && globalThis.__r2Fault.armed) };")
if [[ "$(jget "$armed" '.result.armed')" != "true" ]]; then
  cleanup_geometry
  fail "could not arm globalThis.__r2Fault -- engine predates the #54 fault-injection hook, or eval failed: $armed"
fi

T0=$(date +%s%3N)
r=$(start_skill come "{\"x\":$GOAL_X,\"y\":$PY,\"z\":$GOAL_Z,\"range\":2}")
if [[ "$(jget "$r" '.result.ok')" != "true" ]]; then
  cleanup_geometry
  fail "start_skill rejected: $r"
fi
final=$(wait_task 60)

# ---- channel 1: the in-process proof object, written by gotoR itself as the episode unfolds ----
proof=$(eval_js "return globalThis.__r2FaultProof || null;")
firedAt=$(jget "$proof" '.result.firedAt')
attempt=$(jget "$proof" '.result.attempt')
repositionRan=$(jget "$proof" '.result.reposition != null')
retryOk=$(jget "$proof" '.result.retry.ok')

# ---- channel 2: the ledger, independent of anything this fixture's own /eval reads ----
# `seq` is a per-PROCESS-LIFETIME counter (telemetry.js's `run` field), not globally
# monotonic across the whole ledger file -- a bot restarted between fixture runs (routine
# during this hook's own bring-up) leaves earlier runs' records interleaved with lower-or-
# overlapping seq numbers. Scope the "next goto" query to the SAME `run` as the matched
# recovery record, not merely a higher seq, or it can silently pick up a stale record from
# a previous process lifetime and misreport a real episode as a mismatch.
LOG="$SELF_DIR/../logs/metrics-$BOT_NAME.jsonl"
recoveries="[]"; nextGoto="null"
if [[ -f "$LOG" ]]; then
  recoveries=$(jq -c --argjson t0 "$T0" '. as $r | select(.ev=="recovery" and .rung=="R2" and .t >= $t0)' "$LOG" 2>/dev/null | jq -sc '.')
  n_rec=$(jq 'length' <<<"$recoveries")
  if [[ "$n_rec" -gt 0 ]]; then
    rec_seq=$(jq -r '.[0].seq' <<<"$recoveries")
    rec_run=$(jq -r '.[0].run' <<<"$recoveries")
    nextGoto=$(jq -c --argjson s "$rec_seq" --arg run "$rec_run" 'select(.ev=="goto" and .run==$run and .seq > $s)' "$LOG" 2>/dev/null | jq -sc 'sort_by(.seq)[0] // null')
  fi
else
  echo "WARNING: no ledger file at $LOG -- was telemetry.js installed on this bot?" >&2
fi

# cleanup regardless of outcome
cleanup_geometry

running=$(jget "$final" '.result.task.running')
done_=$(jget "$final" '.result.task.done')
errCode=$(jget "$final" '.result.task.error.code')

echo "proof: $proof" >&2
echo "recoveries in window: $recoveries" >&2
echo "next goto after recovery: $nextGoto" >&2
echo "task: done=$done_ errCode=$errCode" >&2

[[ "$running" != "true" ]] || fail "come still running after 60s -- neither arrived nor gave up cleanly"

# ---- channel 1 assertions ----
[[ "$firedAt" != "null" ]] || fail "CHANNEL 1 (in-process proof): globalThis.__r2FaultProof was never written -- the injection point in gotoR was never reached (armed flag consumed by something else, or the hook is broken -- exactly the #38 failure mode this fixture exists to catch)"
[[ "$attempt" == "0" ]] || fail "CHANNEL 1: fired on attempt $attempt, expected 0 (armed flag should only ever be read on gotoR's first try)"
[[ "$repositionRan" == "true" ]] || fail "CHANNEL 1: the injected stuck was thrown but ctx._reposition() never ran -- gotoR's recovery branch was not reached despite the fault firing"
[[ "$retryOk" == "true" ]] || fail "CHANNEL 1: reposition ran but the REAL retry goto did not succeed (retry.ok=$retryOk) -- R2 fired but did not resolve"

# ---- channel 2 assertions (the independent, durable evidence) ----
n_rec=$(jq 'length' <<<"$recoveries")
[[ "$n_rec" -gt 0 ]] || fail "CHANNEL 2 (ledger): no recovery event with rung=R2 landed in the ledger, despite channel 1 reporting the injection fired -- M.recovery's sink or gotoR's emit call is broken"
rec_injected=$(jq -r '.[0].injected // false' <<<"$recoveries")
[[ "$rec_injected" == "true" ]] || fail "CHANNEL 2: the recovery record's own injected flag is not true -- metrics.mjs cannot distinguish this synthetic episode from a natural one"
nextGotoRes=$(jget "$nextGoto" '.res')
[[ "$nextGotoRes" == "arrived" ]] || fail "CHANNEL 2: the goto record immediately following the R2 recovery event did not resolve 'arrived' (got '$nextGotoRes') -- the ledger disagrees with channel 1's retry.ok=true"

# ---- the two channels must agree, not merely both look fine in isolation ----
assert_eq "$done_" "true" "both proof channels show R2 fired and the retry arrived, but the task itself never completed (errCode=$errCode)"

pass "R2 fault fired on attempt 0, ctx._reposition() ran (displaced=$(jget "$proof" '.result.reposition.displaced')), the real re-issued goto arrived, and the ledger independently confirms the same episode (recovery.injected=true, next goto res=arrived) -- resolution proven, not assumed"
