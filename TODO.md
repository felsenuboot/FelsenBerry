# Breaking point 2026-09-02 ~23:55 — WIND-DOWN for model switch (successor: Fable 5.1)

Everything stopped by user order mid-night-shift. All findings/state in FEEDBACK.md
(append-only), SCOREBOARD.md (races + laws + Race book v2 + retrospective), the tracker
(felsenuboot/felcrew-mcp, 104 issues), GOAL.md (**THE HUMAN BAR** — the formalized
4-criteria goal acceptance), research/IDLE_TRIGGER_SPEC.md. Ground truth = git log on main.
An active session /goal exists: "a minecraft bot behaving like a human" (Felix may clear it).

## 0. Restart recipe (unchanged from morning, plus new pieces)
1. Local test server: `cd ../localserver && setsid nohup ./setup.sh > server.log 2>&1 &` → 25599 (RCON 25598).
2. Race server (only for a race): `cd ../localserver-race && setsid nohup java -Xmx1536M -Xms512M -jar server.jar nogui > server.log 2>&1 &`
   → 25600. Before a new race: swap level-name → world-race6. ARCHIVES (never delete/reuse):
   world-race2 (staked R2 wedge + wall-off site), world-race4 (#99 site), world-race5 (run #5 suspended mid-state).
3. Ollama (decider LLM): `setsid nohup ollama serve &` (USER-level; models in ~/.ollama; andy-cpu = CPU-pinned).
4. Bots: `OWNER=<teammate> PURPOSE="why" [DECIDER_EXCLUDE=1] MC_HOST=127.0.0.1 MC_PORT=<port> ./spawn.sh <Name> <31xx> [--agenda]`;
   ./list.sh first, always. `./bench/preflight.sh <port>` = regression (203/203 expected at 0dbde11+).
5. Decider daemon: `[SOAK_BOT=<name>] setsid nohup node decider.js > logs/decider.log 2>&1 &`
   (state persists in decider-state.json/decisions.jsonl; liveness = state-file mtime, NOT log silence).
6. Teammates (Agent tool WITH name, ONE at a time + verify members; Sonnet): engine-dev-3
   (skills/agenda/producer/decider), engine-dev (QA/telemetry/metrics/survival/grader),
   test-driver (races), issue-manager (tracker sync — hasn't run since ~104 issues; due).
   PUT IN EVERY SPAWN PROMPT: drain inbox at every task boundary (chronic cross-in-transit
   all day); commit with explicit pathspecs only; OWNER/PURPOSE on every spawn; ack-before-edit
   on any cross-lane file (even break-glass); wall-clock timers are the LEAD's job only.
7. Lead monitors to re-arm: cavecrew watch (100.101.197.44:25565; on UP → fleet reconnect
   3101-3105 + AFTER-playcheck vs stored baseline) + night-pulse (scratchpad script gone; rebuild:
   poll test-driver-owned bots' agenda rung → alert IDLE streaks; tail both server logs for
   <Felsenuboot> chat = supervisor wake).

## 1. IMMEDIATE queue (priority order)
1. **#102 chopTrees fell-complete + elevated drops** — eng-3 was mid-work at wind-down; check
   `git status`/last commits for WIP state + their handoff note in FEEDBACK. REQUIRED for human-bar
   criterion 4 (a soak bot chops constantly; half-felled trees fail the trail check). Spec: fell the
   WHOLE trunk column; collect/prevent canopy-stranded drops. Felix's screenshot = the incident.
2. **SOAK #4 = the first formal HUMAN-BAR attempt** (after #102 + preflight green): fresh crude-named
   bot on 25599 with --agenda, SOAK_BOT=<name> on the decider, canonical start timestamp from
   decider.js's startup log, 60 min hands-off, then grade with **`node bench/humanbar.mjs --bot <name>
   --since <ISO> --until <ISO> --label soak4`** (NEW combined instrument: direction-gate AND playcheck,
   built+validated byte-identical vs soak-3's hand grade) + a WORLD SPOT-CHECK of its work sites
   (criterion 4: no half-trees/stranded drops/scars). Pass = all four criteria → the /goal condition
   is genuinely met. Soak-3 postmortem context: 1.5% SR, root causes both FIXED (#101 terrain-seek
   landed cd30f4c; R2 EXONERATED — see FEEDBACK edeb3e3: R2 did its job every time, the gap was
   destination-unreachability one level up, already covered by #95+#97-item-3, both field-confirmed).
3. **Gear-race run #6** (after soak #4 verdict): Race book v2 in SCOREBOARD.md governs; gates were
   R2-fix(→exonerated, moot) + #101(done) + preflight; world-race6; the WALL to beat: 0-of-4 runs
   ever crafted a stone pickaxe (run #5 SUSPENDED, excluded). Stack at wind-down: skills v60,
   survival v10, agenda v25, producer v7, dangerscan v5.
4. **#103** death/respawn opens a needs_direction episode (agenda lane; spec'd to exact hook lines in
   the issue). **#100-family residue:** #96 residual = #96 issue's unkitted-last-resort design Q (open),
   #104 losAssumed tag (low, needs live sighting).
5. **Held #95 follow-ups** (specific `why` for repeated identical failures; RESTOCK repeat-count feed)
   — pull them if soak #4's data says so.
6. **issue-manager sync pass** — much landed since the last one: #96 #98 #99 #100 #101 fixed/closed-
   or-closable, #102-#104 filed, R2 exoneration comments, soak grades on #68.

## 2. Standing (unchanged)
- Cavecrew reconnect + AFTER-playcheck of #70-75 (blocked on their server; monitor on resume).
- Historical idle 55-93% = the before-number for the human bar's undirected-time story.
- #97 item 2 emergencyDescend (fixture-first, after any routing contention clears); #83 roads/aesthetics;
  FLEET/1 phase 2; Java 21 installed (Baritone still hard NO per roadmap).
- Artifact showcase (FelsenBerry Field Day) published: https://claude.ai/code/artifact/d247012a-ed2b-48dd-a278-5e8ea8533383
  — update it after soak #4 / the wall breaking; same URL redeploy.

## 3. Tonight's laws & doctrines (enforce from spawn prompt #6 above)
- THE HUMAN BAR (GOAL.md): playcheck PLAYING + direction-gate PASS + survives night unaided +
  human trail — all four on one hour.
- Composition rot: "an unverified deferral is a disablement wearing a shortcut's clothing" (+ the
  refinement: an INSTRUMENTED deferral under measurement is a hypothesis, not rot).
- Zero defense must be unrepresentable (routing must always reach a branch that CAN act).
- Every iterative search needs an anchor; assumed-false ≠ verified-false (representable uncertainty);
- Instrument is scorekeeper; predictions get scored AT the prediction; deferred-gap comments are
  promissory notes (two honored tonight); ensureTool is NOT test-inert by default (opts.depot:false
  in fixtures); a TODO comment is not a tracker item.
