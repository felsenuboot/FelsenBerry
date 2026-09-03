# Breaking point 2026-09-02 ~23:55 — WIND-DOWN for model switch (successor: Fable 5.1)

Canonical checkout: ~/ghq/github.com/felsenuboot/FelsenBerry (~/minecraft/bots = symlink; servers in ~/minecraft/). GitHub: felsenuboot/FelsenBerry (renamed from felcrew-mcp 2026-09-02).
Everything stopped by user order mid-night-shift. All findings/state in FEEDBACK.md
(append-only), SCOREBOARD.md (races + laws + Race book v2 + retrospective), the tracker
(felsenuboot/felcrew-mcp, 104 issues), GOAL.md (**THE HUMAN BAR** — the formalized
4-criteria goal acceptance), research/IDLE_TRIGGER_SPEC.md. Ground truth = git log on main.
An active session /goal exists: "a minecraft bot behaving like a human" (Felix may clear it).

## 0. Restart recipe (unchanged from morning, plus new pieces)
1. Local test server: `cd ~/minecraft/localserver && setsid nohup ./setup.sh > server.log 2>&1 &` → 25599 (RCON 25598).
2. Race server (only for a race): `cd ~/minecraft/localserver-race && setsid nohup java -Xmx1536M -Xms512M -jar server.jar nogui > server.log 2>&1 &`
   → 25600. Before a new race: swap level-name → world-race6. ARCHIVES (never delete/reuse):
   world-race2 (staked R2 wedge + wall-off site), world-race4 (#99 site), world-race5 (run #5 suspended mid-state).
3. Ollama (decider LLM): `setsid nohup ollama serve &` (USER-level; models in ~/.ollama; andy-cpu = CPU-pinned).
4. Bots: `OWNER=<teammate> PURPOSE="why" [DECIDER_EXCLUDE=1] MC_HOST=127.0.0.1 MC_PORT=<port> ./spawn.sh <Name> <31xx> [--agenda]`;
   ./list.sh first, always. `./bench/preflight.sh <port>` = regression (203/203 expected at 0dbde11+).
5. Decider daemon: `[SOAK_BOT=<name>] setsid nohup node decider.js > logs/decider.log 2>&1 &`
   (state persists in decider-state.json/decisions.jsonl; liveness = state-file mtime, NOT log silence).
6. **Keep the PC awake for unattended runs** (hypridle's 30-min listener ran `systemctl suspend` at 23:54 on 2026-09-02; the PC slept 9h until 09:06 — a block-mode logind sleep inhibitor refuses that call):
   `setsid nohup systemd-inhibit --what=idle:sleep:handle-lid-switch --who=FelsenBerry --why="overnight bot operation" --mode=block sleep infinity &`
   (hypridle honors logind inhibitors by default; verify with `systemd-inhibit --list`). Kill it at wind-down.
7. Teammates (Agent tool WITH name, ONE at a time + verify members; Sonnet): engine-dev-3
   (skills/agenda/producer/decider), engine-dev (QA/telemetry/metrics/survival/grader),
   test-driver (races), issue-manager (tracker sync — hasn't run since ~104 issues; due).
   PUT IN EVERY SPAWN PROMPT: drain inbox at every task boundary (chronic cross-in-transit
   all day); commit with explicit pathspecs only; OWNER/PURPOSE on every spawn; ack-before-edit
   on any cross-lane file (even break-glass); wall-clock timers are the LEAD's job only.
8. Lead monitors to re-arm: cavecrew watch (100.101.197.44:25565; on UP → fleet reconnect
   3101-3105 + AFTER-playcheck vs stored baseline) + night-pulse (scratchpad script gone; rebuild:
   poll test-driver-owned bots' agenda rung → alert IDLE streaks; tail both server logs for
   <Felsenuboot> chat = supervisor wake).

## 1. IMMEDIATE queue (priority order) — re-sequenced 2026-09-02 23:40 (Fable 5.1)
1. ~~#102 chopTrees fell-complete~~ DONE (skills v61, f35333b — GoalLookAtBlock height-cap reach bug fixed via digThorough).
2. ~~Gear-progression drive~~ DONE (#107, fc6cef5 — TOOL rung upgrades wooden→stone when payable; depot-walk inversion fixed).
3. ~~SHELTER rung~~ DONE (51b39d0; #105 primitives 79e0e1e with all four exits live-fired e51744b).
3b. ~~#106 light composite~~ DONE (c3149b3 — surface isDay·skyLight; underground = torch-position scan; autoTorch raw-light trigger removed; 210/210).
4. **SOAK #4 = first formal HUMAN-BAR attempt** (after 1-3 + preflight): fresh crude name, --agenda, SOAK_BOT on the
   decider, canonical timestamp, 60 min hands-off, `node bench/humanbar4.mjs --bot <name> --since <ISO> --until <ISO>
   --inspector-port <port> --label soak4` (ALL FOUR criteria, one verdict; trail check runs FIRST — drops despawn in 5 min;
   engine-dev spawns the inspector bot at ~T+55: DECIDER_EXCLUDE=1, no --agenda, parked far away). Lead holds the timer. Pass = /goal met.
5. **#106 stuck `.light` field** (engine-dev): block light reads constant 0 day/night; dangerscan's field may be the same →
   LIGHT/POSTURE may run on a false "always dark". Investigate, propose fix (isDay + skyLight geometry composite).
5b. ~~FOOD-ACQUISITION DRIVE~~ DONE (#108, e4a2cca+42ba208 — FOOD rung prio 6.5, role/project-independent; hunt kit gate force:true; raw-meat allowlist; 216/216). Original note: soak #4's role:null bot hit food 0 / HP 10 at T+30 — rules.json has
   no food rule, ROLE_WORK.hunter doesn't apply to role:null (#88 residual), Andy didn't supply it. Build a FOOD rung
   (foodItems==0 && hunger ≤ ~12 → huntAnimals w/ widening radius → harvest/farm fallback → backoff) + a zero-token
   rules.json entry. Starvation ended runs #1/#2 too.
5c. **Busy-but-unproductive rung detector** (eng-3, from soak #4's T+30→T+46 stall): the TOOL rung retried
   "could not acquire sword" every ~90s for 16+ min at one spot while direction stayed 8/8 — a rung that ACTS every
   tick but never progresses is invisible to the episode layer (no stall opens because TOOL reads as busy). Propose
   `tool_stalled` (N consecutive identical TOOL failures → episode) — composition-rot at the rung/episode boundary.
   Likely trigger: stick exhaustion from the durability-not-tier recraft bug (fixed af5d009) — verify from ledger.
6. **Gear-race run #6** (test-driver, GammelGerhard reserved, world-race6, Race book v2) after soak #4's verdict (5b landed).
7. #103 respawn-opens-episode (eng-3); held #95 follow-ups if soak data asks; #104 low.

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

- **Push discipline**: every commit auto-pushes via .git/hooks/post-commit (installed 2026-09-02 after 113 commits sat unpushed for a day). If a clone lacks the hook, `git push` after every commit is law; check .git/push.log if GitHub looks stale.

- **Reading teammate progress (tmux mode)**: the pane prompt line is NOT a liveness signal (it shows an empty prompt while the model thinks). Use ListAgents (running/idle) + context growth in the pane status bar + `git status`/commits. Inbox files under ~/.claude/teams/<session>/inboxes/ show undelivered messages (empty = consumed).

- **Soak-window world hygiene** (learned 2026-09-03, soak #4): during a formal soak window NO other bot may run on the soak server within 200 blocks of the soak bot — DECIDER_EXCLUDE protects only the LLM budget; a test bot digging near the soak bot's work sites corrupts the trail criterion. Test elsewhere (another server/world) or after the window. Grader tooling: trail.mjs/humanbar4.mjs `--exclude-zones "x,z,r"` for any contamination that did happen, recorded in the gate file. (Also: `pgrep -f` matches your own shell wrapper — verify processes by PID or exclude zsh.)
