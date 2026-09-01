# Movement recovery ladder — design (issue #54)

**Status:** design prep, pre-build. The DETECTION layer (#53) is shipped; this document is the
grounded design the recovery ladder is built FROM, **after** the #57 shakeout ranks the real
wedge distribution. It exists so #54 starts from the session's evidence rather than a blank page.

**Owner:** engine-dev-2 (#54, and #53 detection). Catalogue + framing: engine-dev-3.

**Scope discipline (read first):** this is not a to-build list. A design doc's contents tend to
become rungs — anything written here reads as "implement me." Two of the six stall classes are
NOT rungs (see Constraints), and most of the rungs must NOT be pre-built (see Build order). The
ladder that ships is the one the distribution justifies, not the one this catalogue imagines.

---

## 1. Constraints the ladder MUST satisfy (these are NOT rungs)

Two of the filed stall classes are not recovery actions — they are properties every rung must
preserve. They live above the ladder deliberately: a rung that violates one turns recovery into a
new wedge.

**C1 — Generation-token invariant (from the goal-stomp class).** An orphaned/timed-out `goto`, or
a competing goal from another loop, can override the active goal and present as `path_GoalChanged`
/ "stuck: no movement" — and it survived a full relog as a false lead (FEEDBACK: idle-guard
drop-sweep clobbering a driver goal; orphaned-goto override). #53 closed this with a per-connect
generation counter + `taskRunning()` gating. **Every recovery rung that re-issues a goal MUST
carry the current generation token**, so a stale recovery `goto` can never stomp a fresh goal —
including the ladder's own earlier attempt. Recovery that re-issues goals is exactly where this
invariant is easiest to break.

**C2 — No-tunnelling guard (from the tunnelling class).** `_unstick`'s "dig the nuisance block and
hop" recovery will just as happily dig through stone/dirt terrain: a y-target that intersects a
hill silently became underground travel — no error, no phase change, `light` alone could not tell
night-outdoors from buried-in-rock (FEEDBACK: escort mission tunnelled through a hillside).
**Recovery digging MUST cap nuisance-dig depth and refuse solid runs longer than ~2–3 blocks
without an explicit tunnelling flag.** `surfaceExposed` (from dangerscan) distinguishes the states.
This bounds R1 and gates R5; it is a limit on recovery, not a recovery action.

---

## 2. Stall taxonomy (grounded in filed specimens)

#53's watchdog already classifies stalls and carries the class on the ledger `wedge` event's
`why` field — so the #57 ranking reads an existing field rather than re-deriving the taxonomy.
The two watchdog classes map onto the two rung-bearing classes below directly.

| # | Class | `why` | Detection signature | Addressed by |
|---|-------|-------|---------------------|--------------|
| 1 | **Frozen / corrupt-chunk** (#20 physics-desync) | `frozen` | `blockAt` air at feet/head/below + `onGround:true` + tiny `-y` velocity | R6 relog → R7 tp + alarm (survivability, NOT a criterion-#5 self-recovery — RCON is an admin escape hatch) |
| 2 | **No-progress wedge** (the canonical one) | `no_progress` | `task.running && moved < ε` over the window; unsticks accumulating, progress metric frozen, **no error** | R0–R4 (the workhorse band) |
| 3 | Nuisance-block-underfoot (torch/leaf_litter, zero-shape → planner reads as air) | — | pathfinder stalled, a zero-shape block on the next cell | Largely FIXED at the planner (`movements.blocksToAvoid`, skills v8). R1's nuisance-dig is the BACKSTOP only |
| 4 | Goal-stomp | — | `path_GoalChanged` / survives relog | **Constraint C1**, not a rung. FIXED in #53 |
| 5 | Inventory-saturation (depot-less deep) | — | `freeSlots → 0`; silently breaks drop-pickup AND mineLane banked-count math | Shed/deposit-or-halt heuristic (distinct from depot-chest overfill #15) |
| 6 | Tunnelling | — | `_unstick` digging solid runs; `surfaceExposed:false` unexpectedly | **Constraint C2**, not a rung |

The canonical no-progress specimen, for calibration: chopTrees sat 192s at one spot, 19 unsticks in
a row, progress frozen at 1/5, **zero error** — because it targeted protected logs as trunk bases
and ground the gotoSee→gotoNear ladder against each. That fix was at target-selection
(`ctx.isProtected`), but the SHAPE — running:true, not moving, unsticks climbing, no error — is what
the watchdog must catch and what R0–R4 must resolve.

---

## 3. The recovery ladder (R0–R7) — cheapest/safest first

Pattern: ROS Nav2 recovery-behaviors, cheapest and least-destructive first. Rungs escalate only
when the one below fails.

- **R0 — re-verify arrival.** False-reached check: maybe we DID arrive and the goal predicate is
  wrong. Free, non-destructive; catches the cheapest false wedge.
- **R1 — generalized `_unstick` + jump-back ×3.** #53's `_unstick`, bounded. Digs only nuisance
  blocks, under **C2**.
- **R2 — reposition to nearest safe standing cell + re-issue** (carrying the **C1** token).
- **R3 — replan-from-current with a virtual-obstacle blacklist**, so A* never re-derives the failing
  path.
- **R4 — goal relaxation.** GoalNear → GoalNearXZ tolerance ladder → reachable-waypoint fallback.
- **R5 — macro self-rescue** (dig-to-goal / pillar-up / bridge-gap). **GATED**: always routed
  through digchain (reach→protection→tool) so recovery never scars terrain or violates a claim, and
  **kept OFF the acceptance-critical path until placeBlock (#19) is hardened** — R5 rests on
  placeBlock, the flakiest primitive in the stack (silent no-op on hitbox overlap #19). Recovery of
  last resort must not depend on the least-reliable foundation.
- **R6 — relog** (drives the payload re-inject; attempt-capped). The only cure for class 1 (frozen).
- **R7 — teleport (RCON), the LAST rung.** Every firing writes a "recovery-ladder MISS" to
  FEEDBACK.md. For class 1 it is a logged escape + hard alarm, adjudicated as survivability, not a
  criterion-#5 self-recovery proof.

---

## 4. Build order — do NOT pre-build the ladder

Build the rung the distribution shows is the **workhorse**, and let a second wedge class earn the
second rung. A ladder built from a catalogue is a ladder ordered by imagination, not by what the
world actually does. This session settled the same question three separate times by waiting — the
depth anchor, the recovery ladder's own sequencing, and the ore sweep — and each time the run
either removed the cause or named the mechanism actually needed. So:

1. Ship the DETECTION layer (#53 — done) and the two **Constraints** (C1 shipped; C2 is a bounded
   guard, cheap, ship with R1).
2. Run #57 (shakeout) and rank the `no_progress` sub-distribution: how often does R0 alone resolve
   it? R1? How often does it reach R2? **Build R0–R2 first.** Add R3/R4 **only if** #57 shows
   re-derived-same-path (earns R3) or unreachable-goal (earns R4) cases at material frequency.
3. Class 1 (frozen) and R6/R7 ship together — the watchdog only DETECTS the freeze; only relog
   CURES it, so neither is useful alone.
4. R5 waits on #19.

---

## 5. Acceptance criteria

- A deliberately induced IN-WORLD wedge (torch-underfoot / ledge / boundary-bounce) resumes
  driverless with **zero intervention, resolved at R6-or-below**. Any R7/RCON firing on that fixture
  is a **criterion-#5 MISS**.
- An induced corrupt-chunk signature (#20) resolves via capped relog → logged R7 + alarm (treated as
  survivability, not a #5 proof).
- Depot-less inventory-saturation rung verified in the depot-less config.
- `bench/preflight.sh` stays green.
- **FIRST-CLASS: rung-firing frequency TRENDS DOWN across successive soaks.** This is a criterion,
  not a note. A recovery rung that fires at a constant rate is not recovery — it is a symptom being
  absorbed, and it will read as health on every dashboard we have (the same shape as "quiet for the
  right reason" from the chat-spam fix: the metric that matters is not whether the system copes, but
  whether it stopped needing to). Emit per-rung firing frequency as a first-class soak metric.

---

## 6. Open questions (record, do not resolve from memory)

- **The `no_progress` window (~15s) is CALIBRATED, not proven.** It was set against a ~21s observed
  wedge and a 20–30s goto timeout (skills.js). If #57 shows it firing on paths that turned out fine,
  the CONSTANT is wrong, not the design — retune against the shakeout distribution. This is an
  explicit open question the ranking step must check, not an assumption to inherit.
- Class-1 frequency: is corrupt-chunk common enough to warrant first-class routing, or a rare
  logged-alarm? #57 answers.
- Inventory-saturation threshold: the depot-less fill rate (blocks mined before `freeSlots → 0`)
  sets where the shed/halt heuristic trips. #57 measures it.

---

## 7. What #57 must produce for this build

A ranked `no_progress` sub-distribution (which rung resolves each wedge — the workhorse), class-1
frequency, the inventory fill rate, and a check on whether the ~15s window fired on any path that
completed fine. The recovery ladder is not started until #57 delivers these — per the build-order
discipline above, ranked data over imagined coverage.
