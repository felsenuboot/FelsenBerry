# Breaking point 2026-09-02 ~23:55 — WIND-DOWN for model switch (successor: Fable 5.1)

**2026-09-03 08:46Z: host REBOOTED mid-soak-#4 (clean systemd reboot); lead session + team + bots died. Lead resumed 08:49Z from the FelsenBerry checkout (new session), infra re-raised (25599 server, ollama, inhibitor), soak #4 graded post-hoc — see queue item 4.**

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
4. ~~SOAK #4 = first formal HUMAN-BAR attempt~~ GRADED 08:53Z post-hoc (host rebooted 08:46Z at T+56, #111): **FAIL 3/4** — playcheck
   PLAYING, survives unaided (starving: hp10/food0), trail clean (thin: 0 chops), **direction-gate FAIL on latency p50 76s/p90 215s**.
   Attributed (SCOREBOARD "SOAK #4"): decider DRIVER_GRACE_MS keyed on OWNER label (every bot has one now) + 120s retry gap after
   Andy parse-misses — plumbing timing, not behaviour. Verdict NON-CATASTROPHIC → run #6 green. Next attempt = soak #5 after 4b+5c.
4b. ~~Decider latency fix~~ DONE (2fea6d8 — driver grace keys on explicit DRIVEN=1 meta field, not OWNER; parse-miss retry rides the next poll; replay fixture 12/12 against the real module; POLL_MS 20→10 argued NO in FEEDBACK; 216/216). Ran live in run #6 from T+3m23s (grace 0s caveat recorded). Validated for the human bar by soak #5.
5. **#106 stuck `.light` field** (engine-dev): block light reads constant 0 day/night; dangerscan's field may be the same →
   LIGHT/POSTURE may run on a false "always dark". Investigate, propose fix (isDay + skyLight geometry composite).
5b. ~~FOOD-ACQUISITION DRIVE~~ DONE (#108, e4a2cca+42ba208 — FOOD rung prio 6.5, role/project-independent; hunt kit gate force:true; raw-meat allowlist; 216/216). Original note: soak #4's role:null bot hit food 0 / HP 10 at T+30 — rules.json has
   no food rule, ROLE_WORK.hunter doesn't apply to role:null (#88 residual), Andy didn't supply it. Build a FOOD rung
   (foodItems==0 && hunger ≤ ~12 → huntAnimals w/ widening radius → harvest/farm fallback → backoff) + a zero-token
   rules.json entry. Starvation ended runs #1/#2 too.
5c. ~~Same-remedy-repeats-across-positions escalation~~ DONE (#110; landed inside 16604e7 by a shared-index commit race — content is eng-3's: A.remedy class counters wood_gather/depot_reach, REMEDY rung prio 4.8, tier 1 = relocateToWork hops 64, tier 2 = directed 128-block findBlock + come; ledger event `remedy_escalate`; agenda-ladder 46/46, preflight 224/224; live-verified tiers on 25599). Corrected diagnosis: the (-21,108) wedges were RESTOCK failing to REACH THE DEPOT (route), the (-45,114) site was clean wood-search failure — both now classes of the same mechanism. Grader for `remedy_escalate` = engine-dev (soak #5).
5d. ~~PROJECT standDown backoff keyed on rung, not project~~ DONE (#112, 3c7c3b7 — A.setProject resets PROJECT unproductive/standDown/standDownCount + restarts the stall clock on every call; A.owner untouched; agenda-ladder 52/52, preflight 230/230, live-verified). Grader side (engine-dev) still owed: latency breakdown attributes standdown carryover.
5e. ~~skills.js FOODS allowlist missed #108 + huntAnimals species widening~~ DONE (#113/#114, 872aa07 — shared foods.js (union of both copies), huntAnimals anyMob defaults to cow/pig/sheep/chicken; fixture 12/12, preflight 242/242, live kit gate 0/2→2/2). Cook/smelt skill = FEEDBACK follow-up, unbuilt.
5f. ~~Multi-threat gap~~ DONE (#115, survival.js v12 — `nearestMeleeThreat`/`branchWallOff`'s
   `activeThreat`/`rescanMelee`, re-scans by DISTANCE not dangerscan's own score ranking, on every cycle of both the placement and
   wait loops, proactively not just on damage). Live-confirmed 3x against real summoned zombies (raw chat log: "Also zombie at 0.6
   blocks - didn't see that one before." firing correctly, safe WALL_OFF recovery each time). Fixture `bench/fixtures/wall-off-
   multithreat.sh` built and captured the fix live, but flaky as an automated single-run CI check in this session's shared world
   (two harness bugs fixed — coordinate-anchored kill, kit-landing race — plus an unrelated real hazard: 10 live deaths to a
   respawn-point zombie, corroborating #116's already-fixed spawn-camp gap on THIS server too, not just the race one).
5g. ~~Respawn camp~~ DONE items 1-3+5 (#116, 89ab46b — bot-level death ring + spawnCampCheck (3 in 90s; release on window age-out / dawn+60s stable / 10-min cap), SHELTER fires on spawnCamped or justRespawned+(night|hostile), safeFire() suppresses TOOL/RESTOCK/FOOD/LIGHT/PROJECT/ESCAPE while camped, `spawn_camp` ledger event; two re-injection bugs fixed (death listener double-registration, A-vs-bot state); agenda-ladder 67/67, preflight 257/257, live RCON-kill verified). Corrected mechanism: SHELTER already outranks project work; the gaps were late start after respawn and no dispatch suppression. **Item 4 DONE** (d9d8376, survival v13 — `diginDepth()` partial-credit sibling of `diginStandable`, `shelterDigIn(depth)`, `shelterBuild()`'s last-resort branch gated on `bot._spawnCamp.active`; cap/ring placement needed no change, already depth-independent).
5h. ~~EAT/EAT_CRITICAL owner-latch deadlock at foodCount 0~~ DONE (#117, f267e4c — EAT/EAT_CRITICAL clear() widened to food≥19 || foodCount===0; eatInline reports honest NO_PROGRESS so the generic standDown release path fires; the per-tick safeFire(owner) re-check was argued DOWN (would break the fire/clear hysteresis gap file-wide and reintroduce #84's boundary bounce) — LIGHT/RESTOCK audited, not affected; agenda-ladder 71/71, preflight 266/266, live-verified release to FOOD in one tick). Note: mineflayer-auto-eat's own watcher eats independently of the ladder — food-scarcity tests need state injection, not natural decay.
6. **Gear-race run #6** LIVE 08:58:28Z→cap 10:28:28Z — **STONE PICKAXE T+31m50s, FIRST EVER (stone wall broken)**; death #1 creeper 1.9s later, #103 respawn episode fired live; 10 steering calls at T+32. (test-driver, GammelGerhard, world-race6, Race book v2) — GREEN-LIT 2026-09-03 08:55Z (soak #4 non-catastrophic; 5b landed). Launch on the race server 25600.
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

- **Shared-index commit law** (2026-09-03, learned by a race): everyone commits on ONE working tree, so `git add X && git commit` commits whatever anyone else has staged. Commit with a pathspec on the commit itself: `git commit -m ... -- <files>` (or `git commit <files>`), never a bare `git commit`.

- **Push discipline**: every commit auto-pushes via .git/hooks/post-commit (installed 2026-09-02 after 113 commits sat unpushed for a day). If a clone lacks the hook, `git push` after every commit is law; check .git/push.log if GitHub looks stale.

- **Reading teammate progress (tmux mode)**: the pane prompt line is NOT a liveness signal (it shows an empty prompt while the model thinks). Use ListAgents (running/idle) + context growth in the pane status bar + `git status`/commits. Inbox files under ~/.claude/teams/<session>/inboxes/ show undelivered messages (empty = consumed).

- **Soak-window world hygiene** (learned 2026-09-03, soak #4): during a formal soak window NO other bot may run on the soak server within 200 blocks of the soak bot — DECIDER_EXCLUDE protects only the LLM budget; a test bot digging near the soak bot's work sites corrupts the trail criterion. Test elsewhere (another server/world) or after the window. Grader tooling: trail.mjs/humanbar4.mjs `--exclude-zones "x,z,r"` for any contamination that did happen, recorded in the gate file. (Also: `pgrep -f` matches your own shell wrapper — verify processes by PID or exclude zsh.)

- **Food-scarcity tests inject state, they don't wait on natural hunger decay** (2026-09-03, TODO 5h): mineflayer-auto-eat's own background watcher (`checkOnItemPickup:true`, `startAt:16`) eats a food item the moment it enters inventory, independent of the agenda ladder's EAT/EAT_CRITICAL rungs — a hunted item can be gone before either rung ever gets a turn to own it. Not a bug, just means a live test of the EAT rungs' own behavior (not autoEat's) needs to force `A.owner`/food state directly via `/eval` rather than relying on a real hunger-effect drain plus a real food item to race autoEat.
