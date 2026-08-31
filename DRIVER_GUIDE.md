DRIVER GUIDE — Minecraft bot skill library (__skills v6)
For LLM driver agents. Run commands from /home/felix/minecraft/bots. One task per bot at a time.

INJECT (idempotent; MUST re-run after every ./spawn.sh — engine survives reconnects, NOT process restarts)
  ./inject.sh <port>
  # raw: jq -Rs '{code:.}' skills.js | curl -s -X POST http://127.0.0.1:<port>/eval -H 'Content-Type: application/json' -d @-
  Safe while a task is RUNNING: old task is stopped cleanly, log/seq preserved, no orphans.

DISCOVER
  ./task.sh <port> list   # come, collectDrops, chopTrees, mineLane, huntAnimals, depositToChest,
                          # safeDescend, buildWall, buildFloor, frameStructure, buildStaircase
                          # (v5: the four build* skills are code-complete; only buildWall is
                          # live-verified so far — see ENGINE_NOTES.md before relying on the rest)

START (fire-and-forget; returns {taskId} instantly)
  ./task.sh <port> start mineLane '{"target":"stone","count":5}'
  # raw: curl -s -X POST http://127.0.0.1:<port>/eval -H 'Content-Type: application/json' \
  #   -d '{"code":"return __skills.start(bot, '\''mineLane'\'', {target:'\''stone'\'',count:5})"}'

POLL (ONE self-contained call: bot vitals + task state + new log lines since seq; ~200-350 bytes)
  ./task.sh <port> status [sinceSeq]
  # raw: ... -d '{"code":"return __skills.status(bot, <lastSeq>)"}'
  Always pass the last seq you saw so only new log lines return. Blocking, most token-optimal:
  ./task.sh <port> wait

STOP (runner's POST /stop cancels NEITHER the task NOR the queue — always use this instead)
  ./task.sh <port> stop "reason"
  Cooperative: stops at step boundaries, never mid-dig. Terminal state persists until the next start().
  v6: stop ALSO clears the queue and the onEmpty fallback ("stop" means stop) and reports
  {clearedQueue:N}. Keep the pending items with the escape hatch:
    ... -d '{"code":"return __skills.stop(\"reason\",{keepQueue:true})"}'   then resume later.

QUEUE (v6 — THE token win: one enqueue + one wait replaces N start/poll cycles)
  Chain jobs; the engine advances IN-PROCESS the instant a task reaches terminal state
  (measured live: gapMs 0 between consecutive tasks). The bot never stands idle waiting
  for you to think.
  ./task.sh <port> queue '[{"name":"chopTrees","args":{"count":2}},{"name":"depositToChest"}]' '{}'
  ./task.sh <port> enqueue collectDrops '{"radius":12}'   # append ONE job to a live queue
  ./task.sh <port> qinfo        # full introspection: pending args, history, per-task gapMs, collected
  ./task.sh <port> skip [why]   # abort the current job and ADVANCE (stop would end the batch)
  ./task.sh <port> resume       # continue after a halt or a reconnect pause
  # raw: return __skills.enqueue(bot, [{name,args},...], opts)

  opts: mode 'append'(default)|'replace' · onError 'halt'(default)|'continue'|'abort'
        onEmpty <fallback spec> · start true(default)
  Caps: 16 pending items. Enqueueing while a task runs just appends — including a task
  started with plain start().

  VALIDATION IS ATOMIC AND UP-FRONT. Every item is arg-checked before anything is queued,
  so a typo surfaces now, not three jobs later:
    {"ok":false,"error":{"code":"unknown_skill","index":1,"name":"nope","known":[...]}}
    {"ok":false,"error":{"code":"bad_args","index":0,"message":"need args.target","params":{...}}}
  Nothing is partially queued on a reject.

  STATUS reports the queue in the SAME single poll (null when the queue is unused, so a
  plain-start driver's payload is unchanged):
    "queue":{"state":"running","n":2,"next":"collectDrops","pending":[...],"done":1,
             "total":3,"runId":"q…","onEmpty":null,"halted":null}
    state: idle | running | draining (fallback loop) | halted | paused (disconnected) | stopped

  ON FAILURE the batch HALTS by default, keeps the pending items, and chats the halt:
    "Queue halted: mineLane failed (no_tool). 1 job(s) still pending."
  Fix the cause (e.g. replace the broken tool — that outranks the job), then `resume`.
  low_health / inv_full / disconnected / timeout ALWAYS halt, even under onError:'continue'.
  !! After a halt the engine stops shielding the bot from the idle-guard: act within ~25s
     or the guard takes over with role-default work.

  onEmpty FALLBACK (fleet default: collectDrops) — what the bot does when the queue drains,
  instead of standing still until idle-guard dormancy:
    ./task.sh <port> queue '[...]' '{"onEmpty":"collectDrops"}'
    ./task.sh <port> queue '[...]' '{"onEmpty":{"name":"collectDrops","args":{"radius":12},"everyMs":20000}}'
  First run fires instantly (~1ms after drain) and announces once; repeats every everyMs
  (default 20000, clamped 3s..300s) and go quiet to spare chat. Clear it with
  `return __skills.setFallback(bot,null)`; `stop` drops it too. NOTE: a bot with a fallback
  armed effectively never reaches idle-guard role-default work — YOU now define "idle".

  `wait` returns only when the task is done AND the queue is empty. With a fallback armed
  the loop is endless, so `wait` returns at the first lull between fallback runs.

  RE-INJECTION DROPS THE QUEUE (by design). The pending names are preserved as a warn line
  in the log so you can re-enqueue them:
    [98,"warn","queue dropped by re-inject (2): collectDrops, collectDrops"]

POLL CADENCE (minimize tokens)
  Cheapest of all: queue a batch and poll ONCE at the end (a 3-task queue drains with ZERO
  polls — verified live over a 90s window). Otherwise prefer ./task.sh <port> wait when you
  can block, or sleep between polls, sized to the task:
    <10s tasks (collectDrops, short come) ........ first poll at 3-5s, then every 5s
    ~30s tasks (small mineLane, safeDescend) ..... first poll at 15s, then every 15s
    1-3 min (chopTrees, hunts, long travel) ...... first poll at 45-60s, then every 30-60s
  Never poll a terminal task again — done:true or error is final until the next start().

ERRORS AND ESCALATION
  Failures surface in status as {error:{code, message, phase}} — e.g. bad_args, not_found,
  path_timeout, stuck. Retries are already in-engine (2 travel attempts; 6s stall watchdog that
  digs nuisance blocks like leaf_litter and hops, 3 recoveries before 'stuck').
  Retry a failed task at most ONCE with adjusted args. Escalate to manual /eval reasoning when:
    - the same error code surfaces TWICE for one goal, or
    - a RUNNING task shows no progress delta (same phase/counters) across 2-3 polls past its budget.
  To escalate: ./task.sh <port> stop first, then inspect via /eval (position, blocks, inventory), then act.

HOUSE RULES (enforced inside the engine — do not re-implement in driver code)
  Tool preflight (equipBestTool + canHarvest gate, digs raced vs digTime*3+1.5s), drop sweep with
  inventory-delta verification after every dig/kill, one throttled English chat per phase,
  players are NEVER valid hunt targets (rejected at validate and re-checked before every swing).
  Torch discipline (v4): mineLane and safeDescend auto-place a torch every ~7 blocks/steps (or
  sooner if the local light level is low) via a shared ctx.autoTorch primitive — never bring it
  up as a manual step. If the bot carries zero torches you'll see one `no_torches` warning line
  in status.log per task (not repeated) — restock from depot chest B (64 banked), don't ignore it.

GROWING THE LIBRARY (hard rule)
  If you hand-drive a task type via raw /eval TWICE, it is recurring: ADD it as a skill in skills.js
  (use the existing ctx primitives so house rules apply), re-inject, and document it in README.md.
  Never hand-drive the same task type a third time.

KNOWN QUIRKS (1.21.11 / pathfinder 2.4.5) — details in README.md and LEARNING_HANDOFF.md
  leaf_litter wedges prismarine-physics (handled by the stall watchdog); GoalNear can recalc partial
  paths forever near clutter (depositToChest falls back to GoalLookAtBlock); GoalBreakBlock is
  broken — never use it. skills.js is ~50KB, well under the 1MB /eval cap.

## The learning loop (MANDATORY for every driver)

Every field finding — quirk, bug, missing feature, anything you hand-drove twice —
goes into **FEEDBACK.md** THE MOMENT you discover it (append-only, entry format in
the file header). That file is the engineers' inbox: every engine work cycle reads
the open entries and ships fixes, so a finding you don't log is a bug every future
bot re-suffers. Workarounds additionally go to LEARNING_HANDOFF.md (driver-facing);
big roadmap items get triaged into TODO.md by the lead. Log first, work around
second.
