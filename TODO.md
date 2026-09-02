# Breaking point 2026-09-02 (~16:00 local) — FULL WIND-DOWN, resume checklist

Everything stopped by user order: all bots, both local MC servers, the decider
daemon, ollama, all teammates, all monitors. Every finding of the day is in
FEEDBACK.md (append-only), SCOREBOARD.md (race records + laws), the tracker
(felsenuboot/felcrew-mcp, 92 issues), and research/IDLE_TRIGGER_SPEC.md.
Ground truth for "what happened today" = git log on main (this repo).

## 0. Restart recipe (in order)
1. **Local test server** (fixtures/dev): `cd ../localserver && setsid nohup ./setup.sh > server.log 2>&1 &`
   → 127.0.0.1:25599, RCON 25598 (pw in setup.sh). NOTE setup.sh rewrites server.properties (same content).
2. **Race server** (only for a race): `cd ../localserver-race && setsid nohup java -Xmx1536M -Xms512M -jar server.jar nogui > server.log 2>&1 &`
   → 127.0.0.1:25600, RCON 25601. Before a NEW race: swap `level-name` to world-race3 (fresh-world-per-run
   law, same seed felcrewtest). **world-race2 is an ARCHIVE — never delete/reuse**: it carries the staked
   R2 wedge (point (2,101,2), escape cell (4,100,2), target (-55,115,-17)) AND run #2's WALL_OFF site.
3. **Ollama for the decider**: `setsid nohup ollama serve >/dev/null 2>&1 &` (USER-level — the systemd
   service points at an empty store /var/lib/ollama; models live in ~/.ollama: andy-cpu:latest = CPU-pinned
   micro-q8, andy8-cpu:latest = bigger fallback; alternative fix: systemd override OLLAMA_MODELS=/home/felix/.ollama).
4. **Bots**: `OWNER=<teammate> PURPOSE="why" MC_HOST=127.0.0.1 MC_PORT=<25599|25600> ./spawn.sh <Name> <port> [--agenda]`
   — fleet-awareness law: ./list.sh BEFORE every spawn and in every report. --agenda for driverless/racing.
   Stack auto-injects on spawn+reconnect. `./bench/preflight.sh <port>` = regression (185/185+ green expected).
5. **Decider daemon** (Direction Episodes phase 3): `setsid nohup node decider.js > logs/decider.log 2>&1 &`
   (writes pids/decider.pid; state in decider-state.json + decisions.jsonl, both survive restarts).
6. **Teammates to respawn** (Agent tool WITH name, one at a time, verify
   `jq -r '.members[].name' ~/.claude/teams/session-*/config.json` after each; Sonnet):
   engine-dev-3 (skills/agenda/producer/decider lane), engine-dev (QA/telemetry/metrics/grader lane),
   test-driver (races), issue-manager (tracker). Onboard from GOAL.md + FEEDBACK.md tail + this file.
   KNOWN FAILURE MODE all session: teammates drain their inbox LATE — instruct them to check messages
   at every task boundary.
7. Lead re-arms monitors: cavecrew port watch (100.101.197.44:25565 — was DOWN all day; on UP: fleet
   reconnect 3101-3105 + engine-dev's AFTER-playcheck vs the recorded baseline) + fleet-pulse
   (scratchpad script is gone — rebuild: poll pids/*.meta owner=test-driver bots' agenda rung, alert on
   IDLE streaks; tail both server logs for <Felsenuboot> chat = supervisor wake).

## 1. IMMEDIATE next work (priority order)
1. **Commit/land eng-3's WIP canopy fix** if still uncommitted: `M dangerscan.js` + new
   `bench/fixtures/dangerscan-canopy.sh` (LIGHT/canopy false-positive: dangerscan sky-check reads forest
   canopy as not-surface-exposed → LIGHT preempts chopTrees every ~50.1s, killing the task; root-caused
   in FEEDBACK dc7aaff; a SchlammSteffi throwaway bot was mid-verification when wind-down hit).
   Constraint from lead ruling: fix must NOT weaken LIGHT underground.
2. **Grade soak #1 post-hoc** (it ran 13:25:04Z–~14:00Z before wind-down, ledgers persist):
   `node metrics.mjs --direction-gate soak1 --since 2026-09-02T13:25:04Z --bot EngineDreckDave`
   (exclude the 12:54:17Z synthetic record). Caveats to annotate: episode.detail bug (3c327e0 fixed it
   but the soak bot never restarted onto it — economics-only skew) + LIGHT/canopy preemption (latency skew)
   + window shorter than 60min (gate has a too-short guard; may refuse — then just report descriptives).
   Observed live before wind-down: 100% rule-hit early, Andy path proven (miss→retry→mapped dispatch,
   eid dmtk50mcw14), 7+ episodes closed, 3 zero-gap promotions.
3. **Soak #2 = formal Phase-3 acceptance**: restart-spawn EngineDreckDave (or fresh name) on 25599 with
   --agenda (picks up runner 3c327e0 detail fix + owner-sentinel 149da8c + canopy fix once landed),
   start decider daemon, 60 min hands-off (NO /eval, no preflight against it during window), then
   `--direction-gate` grade: pass = p50≤60s, p90<120s, zero unclosed, calls under cap.
4. **#92 survival heal-deadlock fix** (engine-dev lane): WALL_OFF exits on threat-clear AND (healed OR
   cannot-heal: no food + hunger<18); + 60s re-announce churn; + collectDrops health-guard cascade.
   Run #2 died to this (26 cycles / 25m44s at 3 HP). Fixture + live mob verification per survival doctrine.
5. **#54 wedge diagnosis CONTINUES** (engine-dev): commit 54d54cc's live finding — candidate search is
   NOT the bug, WALK EXECUTION is the lead suspect (the dead-reckoned forward+jump toward the candidate).
   KrachKuddel bot was staged on world-race2 for this. Next: instrument/step the walk at the staked
   geometry. Then eng-3 improves _reposition per findings. R2 stays "recovers slowly at hard geometry
   (9.2min worst case)" until fixed. Telemetry now self-diagnoses future wedges ({candidateFound, base,
   candidate} full-float, skills v57).
6. **Gear-race run #3** — green light AFTER #92 + soak #2 verdict. Race book v1 in SCOREBOARD.md (tier
   plan + branch plans + laws: DEAD RACE = DEAD STOP, fresh world per run, read-only eval legal, ledger
   is scorekeeper). Fresh never-used crude name; OWNER/PURPOSE; gearrace.mjs is recorder of record.
   Baselines to beat: run#1 (v50): wood 1m00s, DNF-stone; run#2 (v55): wood only, DNF heal-deadlock,
   6 calls, 4 findings. Watch for: fauna-scarce spawn on this seed (measured twice), #88 role:null food
   routing (decider now covers it via rules.json — first race WITH the decider running is the point).
7. **#68/Direction Episodes follow-ups**: rule-of-twice promotion from decisions.jsonl (metrics section
   exists); Andy reply usability stat (was ~25% mappable — grow mapAndyCommand's dialect map from logged
   raw misses; andy8-cpu env-swap if micro stays too dumb); #88 formally closes when a race proves the
   decider feeds a role-less bot.

## 2. Standing/deferred (from before today, still valid)
- Cavecrew reconnect + AFTER-playcheck (#70-75 batch deployed-but-unmeasured) — blocked on their server.
- Historical fleet idle 55-93% (MettMarcel 93.2%) = the "before" number for undirected-time once v22+ runs fleet-wide.
- eng-2's displaced-vs-replan prediction: scored at source (data says opposite so far — 1/1 resolutions
  displaced:true); re-score after the #54 walk fix.
- Aesthetics/roads (#83), FLEET/1 chat protocol (phase 2), mindcraft-ce/AndiAmateur experiment (parked;
  ollama now doubles as decider backend), Java 21 installed (Baritone still a hard NO per roadmap).
- infra.js + server.log in repo root: untracked leftovers, safe to delete after confirming infra.js is
  the abandoned #76 draft.

## 3. Team/process laws learned today (keep enforcing)
- One teammate per lane; spawn named teammates ONE at a time + verify members (config race).
- Teammate inbox lag is chronic — "drain inbox at task boundaries" belongs in every spawn prompt.
- Grader/graded separation; instrument is scorekeeper (3 hand-count errors caught today); predictions on
  record get scored AT the prediction; silent+zero-cost mechanisms need explicit edge-case policy;
  every iterative search needs an anchor; optional-guarded emits must have verified sinks (#38).
- Supervisor is the idle-trigger of last resort: fleet-pulse + player-chat watch = lead's job until
  Direction Episodes runs fleet-wide.
