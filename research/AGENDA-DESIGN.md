# AGENDA-DESIGN.md — the phase-1 capstone decision (issue #28)

Synthesis of the 4-architecture bake-off (agenda-A-ladder / B-utility / C-goap /
D-btree.md) + 5-judge panel. Author: team-lead (the workflow's synthesis step hit a
StructuredOutput cap; the supervisor owned the decision directly since this is the
single most load-bearing phase-1 design).

## The verdict

Judge totals: behavior-tree 42, **priority-ladder 40**, GOAP 36, utility 35 — but the
SHAPE decides, not the total:

| axis | winner | ladder | why it matters |
|---|---|---|---|
| determinism (codicil #1) | **ladder 10** | 10 | zero tokens/cycle, pure state→action; the whole thesis |
| stability (anti-thrash) | **ladder 9** | 9 | dual-threshold hysteresis per rung — no oscillation |
| composability (fits our engine) | **ladder 9** | 9 | every predicate binds to a global that exists TODAY |
| expressiveness (multi-step) | goap 9 | 6 | ladder can't express acquisition chains… |
| testability (replay) | btree 9 | 6 | ladder ships zero test hooks… |

**Decision: SHIP ARCHITECTURE A (the priority ladder) as `agenda.js`**, because it
dominates the three axes that mean "runs reliably in our engine tonight without
breaking the fleet" — and those are exactly the codicil's core. Its two weaknesses are
each handled without a paradigm change:

1. **Expressiveness (6) is largely already solved.** The judge's fatal-flaw example —
   multi-step acquisition ("need iron pick → need iron → smelt → ore+fuel → mine") — is
   NOT the ladder's job: `ensureTool` already does deterministic acquisition chains
   (proven live: empty inventory → wood → planks → table → axe in 33s). The ladder's P1d
   rung just *calls* it. And multi-step PROJECTS are expressed as SKILLS with internal
   sequencing (buildSchematic, farmCycle, safeDescend), which the P2 rung delegates to.
   So the ladder + ensureTool + projects-as-skills covers the real need. GOAP's
   expressiveness win (9) comes bundled with a composability FATAL flaw (5) — adopting it
   wholesale imports exactly the complexity/collision risk we're fighting. **GOAP is held
   in reserve** (see §Future) for a *proven* multi-step-project need, not speculative.

2. **Testability (6) is a fixable gap, not a paradigm choice.** GRAFT the behavior-tree
   design's (D) test-hook discipline onto the ladder: `sense()` must accept an INJECTED
   snapshot (so a test can hand it a synthetic world), each rung's `fire/clear/act` must
   be individually callable, and a `__agenda.step(injectedSnapshot)` returns the chosen
   rung + action WITHOUT executing — deterministic replay per EVALUATION.md. This is ~40
   lines on top of A, and it's mandatory (the autonomy-soak benchmark can't score without
   it).

## The design (base = research/agenda-A-ladder.md, with the graft)

Adopt A's spec verbatim as the base — it is implementation-ready. Key structural
commitments (non-negotiable, from A):

- **`agenda.js` SUBSUMES `idleguard.js`.** On install it calls `__idleguard.stop()` and
  reuses the role-default work as its own P3 rung. ONE deliberative loop (2s tick) + ONE
  reflex loop (survival.js/dangerscan, 4Hz). NEVER two deliberative timers — that's the
  most-reported field hazard (goal-fighting, GoalChanged loops, false physics-freeze).
  NOTE: this composes with the idleguard-v8 fix (stop() now goes inert-in-place, doesn't
  strip the dig-guard stack) — verify agenda's install-time stop() call is v8-safe.
- **10 fixed rungs, top-down, fire/clear hysteresis** (A §2): P0a reflex-yield > P0b
  posture(alert) > P1a eat-critical > P1b deposit > P1c eat > P1d tool > P1e restock >
  P1f light > P2 project > P3 idle-floor.
- **Pure per-tick `sense()` snapshot** bound to real globals (`__danger`, `__skills`,
  `__survival`, inventory) — no HTTP poll, no LLM, no remote blockAt (stale-chunk quirk).
- **The LLM sets ONLY the project** via `__agenda.setProject(desc)`, once; zero tokens
  per cycle after. The ladder runs it. This IS the determinism codicil.
- **The agenda IS survival.js's "driver decides resume vs abort"** on the panic falling
  edge (A §6 handback).

GRAFT (from D): the test-hook layer above — injectable snapshot, per-rung callability,
`__agenda.step()` dry-run.

## PHASE-1 ACCEPTANCE TEST (the "solo-complete" done-signal)

Run on the LOCAL server (localhost:25599, deterministic seed felcrewtest), driverless,
`__agenda` installed + a project set, then the LLM disconnects entirely:

1. **Survives ≥3 hours** with zero deaths (dangerscan/survival + P0 rungs).
2. **Zero false-success** in the telemetry ledger (every task_end outcome verified).
3. **Needs met in priority order** under induced stress: spawn it hungry+toolless+full-
   inventory near dark, confirm it eats→deposits→acquires-tool→lights in the ladder's
   order without thrashing (hysteresis holds — no eat/mine/eat oscillation).
4. **Advances its project** to completion when no need is unmet (mines to a target /
   builds a schematic / runs a farm cycle), then falls back to P3 without idling-visible.
5. **Recovers autonomously** from ≥1 induced wedge (torch-underfoot) and ≥1 relog without
   human touch (auto-inject + the physics-desync auto-relog signature).

Passing all five on the soak bot = the "one fully self-sufficient player" phase-1 pillar
is DONE, and phase 2 (cooperation) opens.

## Build order (engine-dev-2, when this unblocks #28 — top priority on landing)

1. `agenda.js` payload skeleton: `sense()` (injectable), the rung table, the top-down
   `tick()` with fire/clear hysteresis, `__agenda.setProject/step` API. Subsume idleguard.
2. Wire P0–P1 rungs (reflex-yield, posture, eat×2, deposit, tool→ensureTool, restock,
   light) — all bind to existing globals; verify each rung fires/clears in isolation via
   the dry-run hook on the local server.
3. Wire P2 project executor (delegate to the named skill) + P3 idle-floor (subsumed
   idleguard work). Define the project descriptor shape the LLM sets.
4. Add to runner.js auto-inject stack; `/state` reports agenda version + current rung.
5. Run the phase-1 acceptance test on SoloSauhund (the driverless soak bot) — that bot
   is currently the living gap-detector; agenda is what it's missing.

## Future (NOT now — phase-1.5, only if proven needed)

If projects-as-skills proves too rigid for genuinely open-ended multi-step projects,
graft GOAP's (C) memoized backward-DFS over a static SOURCES graph as the P2 project
PLANNER only (bounded, ladder-invoked) — never as the arbiter (its composability-5 flaw
is fatal there). File as a follow-up issue with the concrete project that broke
projects-as-skills as its justification. Do not build speculatively.
