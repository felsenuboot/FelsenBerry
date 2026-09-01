DRIVER GUIDE — Minecraft bot skill library (__skills v23)
For LLM driver agents. Run commands from /home/felix/minecraft/bots. One task per bot at a time.

HARD LAW: `mcp__minecraft__*` tools are kevin-driver-ONLY, even if they show up as available
in your environment (MCP config inheritance) — using them from any other driver risks
spawning a rival KackboonKevin connection (duplicate_login identity war, already cured once).
Framework bots (a runner.js HTTP port) go through that port; Kevin goes through kevin-driver
only. See LEARNING_HANDOFF.md's Hard conventions #6 for the full note.

RETIRED LAW: RIGHT TOOL, ALWAYS (added 2026-09-01, retired 2026-09-01 — see the RETIRED
entry further down for the full note). toolguard.js v2 + `__skills.ensureTool` now enforce
this at the engine level: `ctx.digBlock`/skill primitives auto-equip the best owned tool and
block with a typed `tool_missing` error (rather than silently proceeding bare-fisted) when
none is held, withdrawing from the depot or crafting fresh as needed. You no longer need to
check tool class/tier by hand before a dig/chop/harvest/build call. Exception that stays even
with the engine gate live: the cheap-tool-for-travel doctrine (deliberately holding a
cheap/stone tool while walking long distances, since pathfinder digs traversal blocks with
whatever's held and a good tool's durability is worth protecting — see LEARNING_HANDOFF's
tool-durability-on-travel entry) is a driver choice the engine doesn't make for you.

INJECT — engine v8+ CHANGED THIS: check GET /state's `payloads` field first. If it's
present, your bot is on the NEW runner.js process and skills/dangerscan/survival/
digguard/graychat/reachguard already auto-reinstall on every spawn/reconnect — you do NOT need
to manually re-inject them after a ./stop.sh+./spawn.sh restart. idleguard is the ONE
exception: it only auto-installs if the process was started with `--role <role>`; if
`payloads.idleguard` is false after a restart, inject it yourself (role-templated, see
README.md's "Payload stack" section). If GET /state has NO `payloads` field, your bot
is still on the pre-v8 runner.js process — treat everything below as still needed after
every ./spawn.sh, same as before, until you restart the process:
  ./inject.sh <port>
  # raw: jq -Rs '{code:.}' skills.js | curl -s -X POST http://127.0.0.1:<port>/eval -H 'Content-Type: application/json' -d @-
  Safe while a task is RUNNING: old task is stopped cleanly, log/seq preserved, no orphans.
  Manual re-inject ALWAYS works regardless of runner.js generation — same idempotent
  jq-pipe pattern for digguard.js/graychat.js/panicguard.js/reachguard.js/idleguard.js.

SUSPENDING IDLEGUARD for a long manual eval or travel troubleshooting — three levers,
weakest to strongest:
  `__idleguard.pause(ms)` — cheapest, but does NOT protect against the stall-buster
    (v3 gap: the stall-buster block runs before the pause check in the same tick), so a
    slow/legitimate long travel can still get its goal yanked mid-pause.
  `globalThis.__idleguard.busy = true` (set `= false` when done) — PREFERRED for long
    evals (marcel-driver, confirmed live). Skips the guard's own idle-fire tick entirely
    without touching anything it wraps, so it's strictly safer than stop() and doesn't
    need re-injection afterward.
  `__idleguard.stop()` — now SAFE (idleguard v8+), but no longer necessary as the default
    reach-for-first tool now that busy=true exists. HISTORY, so nobody reintroduces the
    bug: before v8, stop() RESTORED bot.dig/setGoal/etc. to their pre-idleguard originals
    by assignment — but digguard/reachguard/toolguard wrap those SAME methods on top of
    idleguard's wrapper, so restoring idleguard's copy silently tore all of them off at
    once (structure protection, reach limits, tool enforcement — gone, while every
    `payloads`/presence check kept reporting them installed). v8 fixes this at the root:
    the wrapper is permanent and goes INERT when stopped rather than restoring anything,
    and re-injection rebinds the existing wrapper instead of stacking a new one. stop()
    is real going forward, but prefer busy=true for anything short enough not to need the
    full disable.

DISCOVER
  ./task.sh <port> list   # come, collectDrops, chopTrees, mineLane, huntAnimals, depositToChest,
                          # safeDescend, buildSchematic, buildWall, buildFloor, frameStructure,
                          # buildStaircase, farmCycle, tillFarmland, harvestGrass,
                          # spawnProof, structureAudit
                          # (v7: buildSchematic/buildWall/frameStructure are live-verified;
                          #  buildFloor shares the same engine; buildStaircase is still the one
                          #  build skill never live-run — see ENGINE_NOTES.md before trusting it)
                          # (farm skills ship in farmskills.js — auto-injected after skills.js,
                          #  so payloads.farmskills should read 1; see FARM SKILLS below)

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

BLUEPRINT BUILDING (v7 — TODO 1 "human-looking builds"; all four skills share ONE engine)
  Check BASE.md BEFORE you build anything another bot could use, and never site a build on top
  of a registered row. All build skills are IDEMPOTENT (a block that is already correct is
  skipped), so "fix the cause and restart with the same args" is always safe.

  Parametric (no schematic file needed):
    ./task.sh <port> start frameStructure '{"origin":{"x":-3,"y":104,"z":28},"width":5,"depth":5,
      "height":4,"cornerMaterial":"oak_log","fillMaterial":"oak_planks","doorway":"south"}'
    ./task.sh <port> start buildWall  '{"origin":{"x":2,"y":104,"z":31},"width":4,"height":3,
      "axis":"x","material":"oak_planks"}'          # or {"from":{x,y,z},"to":{x,z}} instead
    ./task.sh <port> start buildFloor '{"origin":{"x":2,"y":103,"z":31},"width":5,"length":5,
      "material":"oak_planks"}'                      # or {"from":{x,z},"to":{x,z},"y":103}
  frameStructure is the aesthetics primitive: log corner posts + plank infill + a real 1-wide
  2-tall doorway gap ('north'(=z origin, the v5/v6 default) |'south'|'east'|'west'|null), plus
  optional `roof` (true = fillMaterial, or a block name) and `floor` (block name, fills the
  INTERIOR one block below the walls). Put a door item in the gap yourself if you want one.

  From a .schem file (prismarine-schematic 1.3.0, parsed runner-side):
    curl -s -X POST http://127.0.0.1:<port>/blueprint/load -H 'Content-Type: application/json' \
      -d '{"name":"hut5","path":"/home/felix/minecraft/bots/blueprints/hut5.schem","at":{"x":2,"y":104,"z":32}}'
    # -> {"ok":true,"blocks":62,"bill":{"oak_log":16,"oak_planks":46},"size":{...},"warnings":[]}
    curl -s http://127.0.0.1:<port>/blueprint/list        # what this bot has loaded
    ./task.sh <port> start buildSchematic '{"blueprint":"hut5","chest":{"x":-2,"y":103,"z":34}}'
  `at` is the world MIN corner. `path` must live under /home/felix/minecraft/bots/ (or send
  `base64` instead). Cap 4096 non-air blocks. !! THE BLUEPRINT REGISTRY DOES NOT SURVIVE A
  PROCESS RESTART — re-POST /blueprint/load after every ./spawn.sh, exactly like ./inject.sh.
  Small lists can skip the file entirely: {"placements":[{"name":"oak_planks","pos":[2,103,36]}]}.

  Common args on all four: `chest:{x,y,z}` (restock materials mid-build instead of failing —
  the bot walks over, withdraws only what the rest of the build still needs, and walks back;
  `maxRestocks` default 3), `clearSite` (buildSchematic default false, the other three true —
  when true the builder digs blocks occupying build cells; it NEVER touches chests/furnaces/
  crafting tables/beds — those come back as `protected_block`).

  READ `result.verified`, NOT the placed counter: every build ends with a block-by-block
  re-read of the site — {ok, mismatched, examples[]}. mismatched>0 means the world does not
  match the plan (gravity blocks that fell, a server-rejected placement, or a schematic with
  stairs/doors whose facing v7 does not reproduce yet).
    {"blocks":62,"placed":62,"already":0,"deferredResolved":0,"restocks":1,"missing":{},
     "failed":[],"failedCount":0,"verified":{"ok":62,"mismatched":0,"examples":[]}}
  Failure codes: `no_material` (out of a material and no chest, or the chest is empty too —
  restock and restart), `build_stuck` (3 placements in a row failed the same way — go look at
  the site), `not_found`/`unreachable` (bad chest coords). Pass `skipMissing:true` to report
  missing materials instead of failing.

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
  broken — never use it. skills.js is ~115KB, well under the 1MB /eval cap.
  Placement-specific (v7): bot.placeBlock can resolve without the block appearing AND can hang on
  a server rejection ("Event blockUpdate did not fire within timeout of 5000ms") — the engine
  races it and re-reads the block, but any RAW /eval placement of yours must verify with
  bot.blockAt afterwards instead of trusting the promise. Pathfinder digs traversal blocks and
  spends inventory blocks as scaffolding; during a build the engine swaps in Movements with
  scafoldingBlocks=[] and an exclusionAreasBreak guard over the build's own cells, and restores
  your movements in the task's finally — including after a stop/cancel.

## The learning loop (MANDATORY for every driver)

Every field finding — quirk, bug, missing feature, anything you hand-drove twice —
goes into **FEEDBACK.md** THE MOMENT you discover it (append-only, entry format in
the file header). That file is the engineers' inbox: every engine work cycle reads
the open entries and ships fixes, so a finding you don't log is a bug every future
bot re-suffers. Workarounds additionally go to LEARNING_HANDOFF.md (driver-facing);
big roadmap items get triaged into TODO.md by the lead. Log first, work around
second.

**When you find yourself doing the same manual check twice, the FEEDBACK entry you
file should propose the ENGINE GATE, not a driver rule.** A behavioral rule costs
tokens on every single action, forever, in every driver's habit loop; an engine
gate costs once. If your fix suggestion is "drivers should remember to check X
before Y," rewrite it as "the engine should refuse Y until X is satisfied" — see
Behavioral Law Lifecycle below for what happens once that gate actually ships.

## Update rollout protocol (user law, 2026-09-01)

**Engineer updates benefit EVERYONE.** When an engineer live-verifies an engine/
payload change: bump the version, then ROLL OUT — notify every driver directly
(SendMessage), announce the version in chat, and the rollout manager (curator)
version-audits every bot afterward and chases stragglers until the whole fleet
runs the new version. No bot gets left behind on an old engine.

**Driver inventions get vetted, then shared.** If a driver/bot invents a major
improvement (a new primitive, a better pattern, a fix), it does NOT stay private
to one bot and is NOT self-deployed as engine code: log it as a proposal in
FEEDBACK.md → an engineer vets it (correctness, safety, fleet fit) → the engineer
ships it into the engine → fleet-wide rollout per the above. Short-lived personal
workarounds are fine while waiting, but must be logged the moment they're used.

(The endgame is runner.js auto-inject-on-spawn (SYNTHESIS P0.2) making rollouts
automatic; until that lands, this manual protocol is law.)

## Behavioral law lifecycle (user doctrine, 2026-09-01)

Every behavioral driver law below is a TIME-BOXED STOPGAP, not a permanent rule.
The rollout manager (curator) owns retiring them: when the corresponding engine
gate ships AND is live-verified, the law gets marked **RETIRED — enforced by
<gate> since v<N>** in place (never deleted — the history of why a rule existed
stays, so nobody re-derives it from scratch later). A retired law needs no more
manual checking; the engine refuses the unsafe action outright. Rationale: a
per-action manual check costs tokens forever, in every driver's habit loop, on
every single action; an engine gate costs once, at build time, and then it's
free forever after. Check this section before assuming an "interim"/"until X
ships" law is still active — it may already be retired.

**What NOT to gate** — the codicil's other, equally-principled half (recorded
2026-09-01 after engine-dev-2's LAWS_AUDIT.md deliberately declined to gate several
rules): deterministic-where-possible has an edge. Routine, mechanical, per-action
safety checks become engine gates. Genuine JUDGMENT does not — encoding it would make
bots worse, not better. Not gate candidates: aesthetics (tidy builds, no scars, looking
human-made), chat manners and ledger honesty, crew etiquette and "don't be a bad
neighbour" beyond the mechanical protected-region check, when to escalate to Felix and
what counts as a milestone, and the `@`/`!` chat-tier convention (a writing decision per
message). When you're about to propose a gate, ask which half of the codicil the rule
actually belongs to — LLM judgment where judgment is required, engine everywhere else.
See LAWS_AUDIT.md's own "Not gate candidates" section for the full reasoning.

**RETIRED — reach-discipline interim rule** (was: "before any manual/eval dig,
place, activate, or attack, move within ~3 blocks of the target first — never
trust a distant target is reachable"). Enforced by `reachguard.js` since engine
v10 (rejects an out-of-range attempt with an immediate `reach_violation` error
instead of a silent hang) — live on every bot that's process-restarted onto
v10+. No more manual reach-checking needed; the engine won't let a bad call
through.

**RETIRED — right-tool-always** (was: "before any dig/chop/harvest/build
action, verify the correct tool class and best tier is equipped by hand;
acquire it first if missing"). Enforced by `toolguard.js` v2 + `ensureTool`
since engine v23 — shipped and verified (felsenuboot/felcrew-mcp#30, closed
with evidence 2026-09-01): live-verified equip-swap when a wrong tool is held
next to a matching resource, live-verified rejection with a typed
`tool_missing` error when the right tool isn't owned and can't be acquired,
and `ensureTool` proven end-to-end from a completely empty inventory (gather
-> craft planks -> craft+place a table -> craft the tool -> equip, 33s, zero
driver involvement). No more manual tool-checking needed before a
dig/chop/harvest/build call; the engine won't let a bad one through silently.
The cheap-tool-for-travel exception noted in the original law is a driver
choice, not something the gate makes for you, so it still stands.

## Resource-harvest distance law (RETIRED 2026-09-01)
Original law: resource gathering (chopTrees, mining sweeps, grass beyond the farm)
>=50 blocks from the plaza center (-3,111,4), because chopTrees couldn't tell a
structure's logs from a tree's (house frames and fences got eaten near base). Amended
once already (v10, `ctx.isProtected()` at target selection killed the structure-eating
root cause and relaxed the distance to >=25, purely aesthetic from that point on) —
this was the LAST ungated behavioral harvest law, and it is now fully retired.

**RETIRED — enforced by `protected.json.harvestExclusion` + `S.harvestAllowed()` since
engine v18** (LAWS_AUDIT.md, engine-dev-2): a 25-block-radius cylinder around home,
consulted at target selection inside chopTrees and idle-guard's mineNearest, the same
place `ctx.isProtected()` already runs. Verified: blocked at 24 blocks from center,
allowed at 26. No more manual distance-checking before chopping or letting idle-work
harvest near base — the engine won't select a target inside the buffer.
**Scope note — `mineLane` is deliberately NOT gated by this**, because a driver-issued
mining task at e.g. quarry_lane_1 is meant to be at the base; the aesthetic buffer
applies to chopping and idle work, not to deliberate mining. If you hand-issue a
mineLane near home, that's still your call to make, not the engine's.
Designated harvest zones remain fine, unforced choices for chopping: NW forest
(~-60..-30, z<0), SE scrub (x>25, z>40 — clear of CAVECREW), N slopes past z<-20.

## Engineering conventions (standing rules, 2026-09-01)

Two named rules from real incidents, kept here so they outlive the FEEDBACK.md entries
that discovered them.

**Cross-verify means READ THE DIFF, not just re-run the other engineer's live test.**
Incident: an edit silently deleted digguard's entire level-2 planner block; `node
--check` passed clean (it was a syntax-valid deletion, just of runtime-referenced code),
and no live test the author ran would have caught it, because the missing block only
bites through a late-bound runtime reference on a path that test didn't happen to
exercise. engine-dev-3 caught it by reading the actual diff, not by re-running anything.
A passing live test proves the happy path works; it says nothing about a silent deletion
of an adjacent block. This is the same "presence is not liveness" family of bug as the
idleguard-reconnect and payload-staleness findings, one level further upstream — at the
source rather than at runtime. When two engineers cross-verify each other's work, that
means actually reading the other's diff, every time, not treating a green test run as
sufficient.

**A payload timer MAY re-arm a subscription or re-assert a config/flag value; it MUST
NEVER re-assign a bot method it also wraps.** The precise form of the "no self-healing
guard timers" rule, replacing an earlier cruder version that would have wrongly banned
safe patterns too (survival.js's own danger-listener re-subscribe is legitimate and
stays fine under this wording). What it forbids: a timer that notices its wrapper is
"missing" and tries to defensively re-wrap the method — engine-dev-2 tried exactly this
as the obvious fix for a stripped guard, and it is a TRAP. Detecting "am I still in the
chain" means walking it, and every wrapper has to publish what it wraps for that walk to
mean anything; two guards each checking only "am I outermost" re-layer over each other
and form a cycle — 9.2 MILLION recursive dig calls in one live test before it was
killed. Both self-heals were removed; the guard-stripping bug itself was fixed at the
source instead (see the SUSPENDING IDLEGUARD note above). engine-dev-2 audited all 8
owned payloads against this exact wording and found zero violations — every timer in
the current stack touches flags, listener arrays, or Movements arrays, never a wrapped
method. If a self-heal is ever genuinely needed later: every dig wrapper must first
publish `__wrappedTarget` (digguard and toolguard already do this) before anything
attempts to walk the chain.

## Server-drop doctrine + completion truth (user, 2026-09-01)
- If the SERVER drops or crashes: everyone REJOINS, always. Runner processes
  auto-reconnect (v9 auto-injects the payload stack on every spawn); drivers just
  verify /state afterward and resume the queue. Never wind a bot down because the
  server blinked.
- **ONE-TIME EXCEPTION for the main server's NEXT return** (fold this into the
  return broadcast, then this note can retire itself once every bot has actually
  restarted): a bare reconnect is not enough this time. Any bot that ever had
  `__idleguard.stop()` called on it before it was running idleguard v8 is currently
  operating with digguard/reachguard/toolguard silently stripped off `bot.dig` (the
  guard-stripping bug — see SUSPENDING IDLEGUARD above), and a reconnect alone does
  NOT fix that; only a full process restart (`./stop.sh` + `./spawn.sh`) forces
  auto-inject to rebuild the wrapper chain clean on v8+. Every driver must do a full
  process restart when the main server comes back, not just wait for auto-reconnect,
  to guarantee the guard chain is actually intact rather than reporting installed
  while doing nothing.
- Task-state truth is status.task.done from __skills.status — NEVER infer from
  watching the bot move or chat: idle-guard picks up finished bots and makes them
  look busy, which has fooled multiple drivers into waiting on already-finished
  tasks.

## Survival stack (v10, 2026-09-01) — what your status poll now tells you

`__skills.status()` gained three blocks, filled in by the `dangerscan` payload. You do not
have to ask for them and they cost you nothing extra:

```
bot:  { ..., held: {name, count, dur}, light, skyLight, surfaceExposed }
danger:   { score, state: 'calm'|'alert'|'panic', threats: [{name,d,s,los,ranged,pos}] }
survival: { state: 'ready'|'panic:<BRANCH>', branch, fires, recovered, failures }
payloads: { skills: 'v10', digguard: 'v2', survival: 'v1 STALE', ... }
```

- **`held.dur`** is the held item's remaining durability in percent. Under 15% a one-shot
  `tool_low` warning lands in `status.log`. Fleet law says replacing a breaking tool
  outranks the job — this is how you see it coming instead of getting stranded at depth.
- **`surfaceExposed` / `skyLight`** answer the question `light` alone never could:
  dark because it is night or shade, or dark because the bot has tunnelled into a hillside.
  `surfaceExposed:false` at a "safe" y-level means an overhang or a roof — treat it as
  underground regardless of the y-coordinate.
- **`danger.score`** is a weighted 4Hz scan of every hostile within 24 blocks, through
  walls (the server streams entities regardless of line of sight, so this sees the zombie
  in the sealed cavity before you dig into it). `>= 2.5` is ALERT, `>= 5` is PANIC.
  Threat entries carry `los` — a skeleton with `los:true` is actively shooting.
- **`payloads`** reports real versions now. A `STALE` suffix means that payload is bound to
  a bot object that has been replaced by a reconnect: present but dead. Re-inject it, or
  restart the process so auto-inject rebinds everything.

### survival.js — the panic reflex (replaces panicguard.js)

It fires on its own at game speed, inside the gap where your polling loop cannot help.
Entry is HP < 8, danger score >= 5, or any creeper within 8 blocks; re-entry lockout is 10s.
It stops your task first (`__skills.stop('panic')`), so **a task that ends while
`survival.fires` went up did not fail — it was pre-empted.** Check `survival.branch`:

| Branch | When | What it does |
|---|---|---|
| `ENV` | lava / fire / drowning | water bucket or move clear, before anything else |
| `CREEPER` | creeper within 8 | opens to 10+ blocks; never swings; shield if cornered |
| `BREAK_LOS` | skeleton/stray/witch with line of sight | corner-step, else a 2-block cobble "arrow shadow"; counter-attacks only at HP >= 12 with a sword |
| `FLEE_HOME` | home <= 40 away AND melee-only threat | sprints home, turns and holds with shield |
| `WALL_OFF` | far from home, low HP, or mixed threats | seals a 13-face coffin, eats to food 18, waits for HP 16, digs out away from the threat |

After recovery it logs `panic_recovered branch=... hp=...` and hands the decision back to
you: **the engine guarantees "alive and stable", not "job finished"** — you decide resume
vs abort. Needs >= 6 filler blocks (cobble/dirt) for WALL_OFF; without them it logs
`kit_violation` and can only run. Carry 16+ cobble underground.

Manual controls: `__survival.trigger('why')` forces a panic run, `__survival.runBranch('WALL_OFF')`
exercises one branch for testing, `__survival.snapshot()` dumps config + last event.

### protected.json — the no-dig registry

`digguard v2` reads `protected.json` (same directory) and **hot-reloads it within ~10s**, so
adding a region reaches every running bot without re-injection. It blocks protected blocks
at two levels: `bot.dig` rejects with `protected_structure:<id>`, and the pathfinder planner
treats them as unbreakable so it never routes a path *through* your floor.

When you build something worth keeping, add it to `protected.json` AND `BASE.md`. Regions are
`box` (min/max inclusive), `columns` (xz pairs + y range) or `sphere` (center + radius), with
an optional `match` regex on the block name so a farm can protect its farmland while leaving
the wheat harvestable. `neverProtect` lists names that are always diggable.

**Skills must consult `ctx.isProtected(pos)` when SELECTING a target**, not rely on the dig
rejection: digguard refuses cheaply, but a skill that keeps choosing a protected block still
burns a full goto + stall-recovery ladder per attempt. That is what made chopTrees look
wedged for minutes near the plaza — every log within 24 blocks of base is a torch post or a
hall corner, not a tree.

ENGINEER TEST BOTS wear an `[ENG] ` gray-chat tag (dark_aqua), not `[FEL] `, so anyone
reading chat can tell a throwaway test bot from a real fleet member at a glance. Setup for
any NEW engineer test bot (do this once, right after `./spawn.sh`):
```sh
# via graybridge's RCON connection pattern (see graybridge.js), or ask the rollout manager:
/team add ENG_<shortname>
/team modify ENG_<shortname> color dark_aqua
/team modify ENG_<shortname> prefix {"text":"[ENG] ","color":"dark_aqua"}
/team join ENG_<shortname> <BotName>
```
graychat.js (v2+) reads the tag live from the bot's actual Minecraft team (`bot.teams`,
`prefix.text` or a plain string, falling back to `[FEL] ` if the bot has no team) and sends
it to graybridge's `POST /say` as an optional `tag` field — no code change needed per bot,
just the one-time `/team` setup above. The bot's own stupid-name rule still applies to the
name itself; only the chat TAG differs for engineer bots. Verify with one gray chat line
and check the RAW text via `bot.on('message', ...)` (NOT the parsed `chat` event — mineflayer
strips the `[TAG] ` prefix when it extracts a bare username for the `chat` event, so
runner.js's own `<chat> <username>` log lines will never show the tag even when it's
correctly present in the real broadcast; that took real debugging to figure out, save
yourself the trouble).

## Kit preflight (v11) — start() can now refuse to depart

`__skills.start()` checks the bot's kit before a task that leaves base or goes underground,
and **returns `{ok:false, error:{code:'kit_missing', tier, missing:[...]}}` without creating
a task**. Nothing is running when you get this — restock and start again. Two of this
fleet's three deaths were kit failures discovered at depth, so this is a gate, not a warning.

Tiers are cumulative, and which one applies is derived from the skill and its args:

| Tier | Applies to | Requires |
|---|---|---|
| `excursion` | `chopTrees`, `huntAnimals` | 8+ torches, 2+ food items, a sword or axe |
| `underground` | `mineLane`, `safeDescend` | 16+ torches, 4+ food, weapon, **2 pickaxes**, 16+ filler blocks |
| `deep` | `safeDescend {toY < 0}`, `mineLane` while already below y=0 | 40+ torches, 8+ food, weapon, 2 picks, 16 filler, worn chestplate, shield, water bucket |

The 2-pickaxe rule is bernd-driver's double tool loss made mechanical, and the 16 filler
blocks are survival.js's wall-off budget — without them the panic reflex can only run.

Check before you commit to a plan (pure inspection, no side effects):

```sh
./task.sh <port> eval "return __skills.kitCheck(bot, 'deep')"
# raw: ... -d '{"code":"return __skills.kitCheck(bot, \"deep\")"}'
# -> {ok, tier, missing:["torches 19/40","shield",...], warnings:["tool_low: iron_pickaxe at 12%"]}
```

`warnings` never block: they cover tools at or under 20% durability and hunger below 18.
They also fire on a task that *does* pass, so watch for `tool_low` in `status.log` —
replacing a breaking tool outranks the job.

**Override:** pass `{"force": true}` in the task args. It runs, and logs
`kit_missing OVERRIDDEN by force: ...` so the shortcut is visible afterwards. Use it for a
genuinely short trip, not to get past a restock.

Depot for restocking: chest B `(-5,111,3)` has cobblestone and coal, chest C `(-3,111,1)`
has bread. Announce transfers in chat as `DEPOT -32 cobblestone` per DEPOT.md.

## Crafting (v12) — always use craftSafe, never bot.craft in a loop

```sh
./task.sh <port> eval "return __skills.craftSafe(bot, 'torch', 3)"
# -> {ok:true, made:12, calls:3, table:[x,y,z]}
```

Two separate bugs make raw `bot.craft` loops unsafe, and the second one means a settle delay
alone is not enough:

1. Crafting back-to-back without a settle desyncs the window and **voids items** — a driver
   lost 15 batches of planks that way, and `collectDrops` found nothing to recover.
2. **`bot.craft(recipe, N)` does not reliably produce N batches.** Measured live: `N=2` on a
   torch recipe whose `result.count` is 4 produced 4 torches, not 8. The requested count is
   not a promise.

`craftSafe` therefore crafts exactly one batch per call, waits 800ms, re-counts the
inventory after every single craft, and stops the moment a craft yields nothing or an
ingredient drops by more than the recipe asked for. `made` is what actually arrived — trust
that, not your arithmetic. It finds a crafting table within 4 blocks on its own (pass
`{table:{x,y,z}}` to pin one); 2x2 recipes work without one, and a 3x3 recipe with no table
in reach comes back with that stated in `reason`.

## Farm skills (farmskills.js v1) — the farm that never sleeps

Three skills ship in `farmskills.js` (auto-injected after skills.js, so `payloads.farmskills`
reads `1` on a current bot). They reuse the engine's ctx primitives, so every house rule
(tool preflight, drop-sweep, reach guard, protected-structure filter) already applies.

- **`farmCycle`** — one full pass over a field: harvest ripe crops (age-max ONLY — immature
  crops are never dug), sweep drops, replant empties, re-till any cell that reverted to
  dirt/grass (self-heals the farmland-revert bug), optional bread bake, optional deposit.
  ```sh
  ./task.sh <port> start farmCycle '{"field":{"from":{"x":-2,"y":110,"z":10},"to":{"x":4,"y":110,"z":15}},
    "replant":true,"bakeAt":9,"depositTo":{"x":-3,"y":111,"z":1}}'
  ```
  `field` is the FARMLAND level (crops grow at y+1). `crop` auto-detects (or pass
  `wheat`|`carrots`|`potatoes`|`beetroots`). `bakeAt` = wheat-count threshold to craft
  floor(wheat/3) bread (`bakeTable:{x,y,z}` optional, else it auto-finds one). `depositTo`
  banks products + bread but ALWAYS keeps seeds for replanting. Seeds are never deposited.
  **A no-ripe-crop pass is a fast no-op, so it is the ideal `onEmpty` fallback** — queue it
  and the farm tends itself forever:
  ```sh
  ./task.sh <port> queue '[{"name":"farmCycle","args":{"field":{...}}}]' \
    '{"onEmpty":{"name":"farmCycle","args":{"field":{...}},"everyMs":60000}}'
  ```
  Deposit is NON-FATAL: a blocked/unreachable chest logs a reason and returns instead of
  erroring the cycle, so a chest hiccup never halts the queue.
- **`tillFarmland`** — hoe soil into farmland over a `rect:{from,to}` (or explicit
  `cells:[{x,y,z}]`), optional `plant:"wheat_seeds"` (or carrot/potato/beetroot_seeds) per
  cell. Skips protected/crop/water/non-soil cells; clears grass clutter first; acquires a
  hoe via ensureTool. `y` in the rect is the SOIL level.
- **`harvestGrass`** — cut short/tall grass & ferns within `radius` (up to `count`) for
  wheat seeds; only ever breaks grass/fern blocks, never terrain or structure.

All three are idempotent-friendly (already-tilled/planted cells are skipped) and queueable.

## Base-keeping skills (basekeeping.js v1) — stop discovering damage by accident

Two skills in `basekeeping.js` (auto-injected after digguard) for the self-maintenance rung:
keeping the base lit and re-verifying it against the registry.

- **`spawnProof`** — light dark, mob-spawnable pockets so creepers/mobs stop re-damaging the
  base. Anchor on a point (`at:{x,y,z}`) or a registered structure (`near:"main_hall_1"`, a
  protected.json region id; default = nearest region within 96, else the bot).
  ```sh
  ./task.sh <port> start spawnProof '{"near":"main_hall_1","radius":8}'
  ```
  Coverage is torch-DISTANCE, not a light readback — this map's lighting engine is broken
  (#17: skyLight reads 15 inside a sealed room), so a light-loop would over-torch or never
  converge; a cell counts "dark" via block light + a geometric roof check. Idempotent: a
  re-run finds existing torches as coverage and places 0, so it's safe as a periodic sweep.
  Reports `remainingDark`/`unplaceable` (walled-off cells) instead of looping. Needs torches
  in inventory (restock from depot chest B). `cover` defaults to 12 (block light >=1, the real
  1.18+ spawn threshold); pass a smaller `cover` for light>=8 everywhere.
- **`structureAudit`** — re-verify registered structures against the world and REPORT drift:
  ```sh
  ./task.sh <port> start structureAudit '{}'          # audits every region within maxDist (80)
  ./task.sh <port> start structureAudit '{"ids":["torch_posts_1"]}'
  ```
  Precise for `columns` regions (every post cell must hold a matching block — the torch-post
  case): a missing block is reported as damage with exact coords. Box/sphere regions get a
  present/air census (informational — no stored baseline layout). On damage it emits a
  `structure_damaged <id>(-N)` line to chat (`!`-tier) AND status.log, plus `anyDamage`/
  `missing[]` in the result — so a Monitor or the agenda ladder can react instead of a driver
  stumbling on the damage later. Only audits regions near the bot (stale-chunk rule); far ones
  are listed as `skipped`. Good as a periodic queue item paired with spawnProof.

GITHUB ISSUES (open to every teammate, drivers included — user law, 2026-09-01)
The repo (`felsenuboot/felcrew-mcp`, `gh` CLI already authenticated machine-wide) has an
issue tracker anyone can read and file into — a significant finding deserves an issue, not
just a FEEDBACK.md line; do both (FEEDBACK.md for the raw field entry, an issue for
tracking), cross-referenced with a `github: felsenuboot/felcrew-mcp#N` line in the
FEEDBACK.md entry.
```sh
gh issue list --state open                      # what's tracked right now
gh issue view <N> --comments                     # full thread
gh issue create --title "..." --body "..." --label bug   # labels: bug, enhancement, documentation, ...
gh issue comment <N> --body "..."                # add evidence without closing
gh issue close <N> --comment "shipped in <commit-hash>: <what changed, how it was verified>"
```
CLOSING REQUIRES EVIDENCE, always — the same audit discipline that flags premature closes
also flags issues left open after the fix already shipped; both directions are wrong. You
(any driver) may close an issue YOU filed once you can cite the actual fix/commit that
resolves it. Engineers close with a commit hash. The rollout manager (engine-dev) audits
across the board and may reopen a close that turns out to be premature, or push to close
one that's stale. Alliance channel `#1` (felsenuboot/felcrew-mcp#1, the CAVECREW direct
line) is READ-open to everyone but WRITE-restricted to team-lead/rollout-manager/
kevin-driver for outbound diplomacy — no driver freelancing replies there; relay anything
you want said to whoever currently owns that channel.

## Baritone sidecar (v1, 2026-09-01)

A **second movement engine that is not a mineflayer bot at all**: one headless real
Minecraft client (`GrubenGuenther`) running the Meteor Baritone fork under HeadlessMc,
wrapped by an HTTP adapter so it looks like every other bot port you already drive.

```sh
/home/felix/minecraft/baritone/baritone.sh start     # HTTP adapter only - NO player slot taken
curl -s -XPOST localhost:3109/launch -d '{"join":true}'   # ~25s: boots the client AND joins
curl -s -XPOST localhost:3109/goto   -d '{"x":80,"z":5,"wait":true}'
curl -s -XPOST localhost:3109/stop-client                 # MANDATORY when you are done
```

`baritone.sh start` is free — the adapter is an idle daemon. **`/launch` is what costs a
player slot and ~1.6 GB of RAM.** Nothing in the fleet depends on the sidecar; if it dies,
the mineflayer bots are unaffected.

### When to use it

- **Long-haul travel** over terrain where `/goto` (pathfinder) and `/goto2` (ashfinder)
  both stall — cliffs, ravines, deep water, big vertical climbs. Measured on this server:
  (79,81,18) → (80,86,5) in 23 s and (109,86,46) → (80,86,5) in 31 s, both first try.
- **Bulk mining in an approved remote zone**, when a driver would otherwise babysit
  `collectBlock` for an hour.

### When NOT to use it

- Anything inside or near the base. Read the geofence section below — this is not a style
  preference, it is the one way the sidecar can hurt us.
- Anything needing inventory logic, crafting, chests, combat, or trading. The sidecar is
  **text in, text out**: no programmatic world or inventory access. It cannot craft, it
  cannot equip, and it does not know what it is carrying. A mineflayer bot does all of that.
- Anything a mineflayer bot is already doing in the same area. **Always `/halt` the sidecar
  and `/stop-client` before you hand an area back to a driver** — two engines walking one
  area produce mutual grief and nobody can tell whose tunnel is whose.

### Endpoints (127.0.0.1:3109, JSON in / JSON out)

| Endpoint | Body | Notes |
|---|---|---|
| `POST /launch` | `{join:true, settings:{}}` | Boots the client and connects. ~25 s. Never auto-runs — a slot is only ever taken because you asked. |
| `POST /stop-client` | `{reason}` | Kills the client, frees the slot. ~2 s. **Do this the moment you finish.** |
| `POST /goto` | `{x, z, y?, break?, wait?, timeoutMs?}` | Omit `y` for an XZ goal (`#goto x z`) — that is the right default for travel; an exact-block goal often has no legal path with digging off. `wait:true` blocks until the job resolves. |
| `POST /mine` | `{block, quota?, wait?}` | Fenced, see below. `{"block":"coal_ore","quota":32}`. |
| `POST /halt` | `{reason}` | `#stop`. ~1 tick, verified: `ok canceled` in the same round trip. |
| `POST /say` | `{text}` | Chat narration. Refuses text starting with `#`. |
| `POST /cmd` | `{raw}` | Escape hatch, one raw HMC console line. Everything is logged. |
| `POST /set` | `{key, value}` | `#set`. Refuses `allowBreak true` inside the fence. |
| `GET /state` | `?lines=N` | running / joined / allowBreak / RSS / current job / last N output lines. |
| `GET /pos` | | Live position + which fence anchor is nearest. |
| `GET /proc` | | Raw `#proc` — is a Baritone process in control right now. |
| `GET /health` | | Cheap liveness. |

Rate limited (writes ~30/min, reads ~120/min → HTTP 429). One job at a time: a second
`/goto` or `/mine` gets **409** unless you pass `{"force":true}`, which halts the first.
Everything lands in `/home/felix/minecraft/baritone/logs/adapter.log`.

### Fleet law for the sidecar

**Baritone has no geofence and cannot be given one.** ~300 settings, not one
exclusion-area concept; `minYLevelWhileMining` does not hold it either (observed: floor set
to 150, targets mined at y 86–94). `#mine coal_ore` walks to the nearest ore *it has ever
cached*, including chunks it merely passed through on the way out from base — and it will
tunnel straight there through anything. So the fence lives in the adapter:

- **`allowBreak` is false by default**, re-asserted on every join and forced back to false
  the instant any job ends, is cancelled, or times out. If the reset cannot be confirmed the
  adapter **stops the client** rather than leave digging enabled.
- **`/mine` refuses** unless the bot's live position is ≥150 blocks from the *edge* of every
  anchor: the plaza, the trading post, and every region in `bots/protected.json` (so a new
  registered structure widens the fence with no code change). Travel out with `/goto` first.
- **`/goto {break:true}` refuses** inside 60 blocks of those same edges. Travel gets the
  smaller number because a `#goto` digs to one fixed destination and stops, while `#mine`
  roams. Both are env-overridable (`BT_MINE_MIN_DIST`, `BT_GOTO_BREAK_MIN_DIST`) — don't,
  without a reason you would defend out loud.
- Note the consequence: **the FEL-BT-1 smoke zone (80,~164,5) is only 83 blocks out and does
  NOT clear the mining fence.** A production mining zone has to be further from base.
- `allowPlace false`, `chatControl false`, `allowOnlyExposedOres true` and `backfill true`
  are pre-seeded in `game/baritone/settings.txt` and re-applied after every join. The last
  two are the anti-rat-hole settings: mine only ore with an exposed face, and refill the
  tunnel behind you.
- It narrates every phase in chat like everybody else. `chatControl` stays **false** so the
  fleet's constant narration can never be parsed as commands.
- Idle watchdog: with no job and no command for 15 min the client stops itself. Belt and
  braces on the player slot, not a substitute for `/stop-client`.

### Gotchas you would otherwise rediscover the hard way

1. **"Job done" ≠ "arrived".** Baritone prints *nothing* on arrival, and releases the goal
   silently when it gives up. The only completion edge is polling `#proc` for
   `No process in control`, and that fires for both outcomes. The adapter therefore grades
   every `/goto` against the actual position afterwards and reports `state:"failed"` with
   `arrived:false` when it stopped short. Measured: a goto reported "done" in 15 s without
   the body moving one block. **Trust `arrived`, not `state:"done"` alone.**
2. **The client's stdin has two readers.** The launcher and in-game command contexts both
   consume it, so commands get answered with `Couldn't find command for '[...]'`. SMOKE.md
   modelled this as strict alternation; it is not — the launcher swallowed **six consecutive
   lines** here. The adapter resends with backoff up to 14 times, and `#set` is verified
   against Baritone's own `Successfully set ...` reply rather than assumed. If you drive the
   client by hand, use `POST /cmd` (or, on the standalone `start-sidecar.sh` FIFO path
   only, `bcmd.sh`) — never a bare `echo` into the pipe. The adapter owns stdin directly
   and creates no FIFO, so `bcmd.sh` does not apply while the adapter is driving.
3. **Never `.#command`.** `msg` runs on the MC main thread, `.` does not, and `#mine` dies
   there with `BlockStateInterface must be constructed on the main thread`. The adapter only
   ever emits `msg #...` and rejects a raw `.#` line.
4. **The bot has no tools and cannot get any.** `#mine <ore>` bare-handed breaks the ore,
   gets no drop, and re-targets forever until the job times out. A mineflayer bot has to
   hand it a pickaxe first.
5. **It logs back in where it logged out**, often underground in its own tunnel. From there
   a pure-travel `/goto` legitimately fails — there is no legal path without digging. Check
   `GET /pos` before concluding the engine is broken.
6. `connect 100.101.197.44 25565` works fine (that old "HMC hates dotted IPs" theory was the
   stdin bug in disguise); `loopback-proxy.js` is not needed and can go.


## THE CHAT DIET (graychat v3) — routine narration left Minecraft chat

Chat was drowning in bot narration, so every `bot.chat()` is now sorted into a tier **by
prefix**, and the default changed: **an unprefixed line no longer appears in game chat.**

| Write | Tier | Where it goes |
|---|---|---|
| `bot.chat("swept the area")` | LOG (default) | the bot's local log + the Discord activity feed. NOT in chat. |
| `bot.chat("@where are you?")` | INTERACTION | gray chat via the bridge, `@` stripped. For talking TO someone. |
| `bot.chat("!HP 4/20, retreating")` | IMPORTANT | plain white chat, `!` stripped. Deaths, panics, completions. |
| `bot.chat("DEPOT -8 bread")` | PROTOCOL | plain white passthrough — the machine-readable ledger, unchanged. |
| `bot.chat("/seed")` | COMMAND | passthrough, untouched. |

The design point: skills' `ctx.say` and idle-guard chatter became log-tier with **zero skill
changes**, while anything a human or another crew needs is one character away. **If you want
a human to see it, prefix `@` (conversational) or `!` (important).** Everything is still
recorded — nothing is lost, it just stopped shouting.

The Discord sink lives in graybridge: `POST /log {name,text}` buffers and flushes **one
combined message per 5s** (webhook rate limits are ~30/min, so never one post per line).
The URL goes in `bots/.discord` (gitignored, like `.rcon`) and is picked up within ~5s with
no restart. Until it exists the bridge runs in **mock mode** and logs the exact payload it
would have posted — check `logs/graybridge.log` for `discord[mock] would post N line(s)`.
`GET http://127.0.0.1:3199/health` reports `discord: {configured, pending, queued, posted,
mocked, dropped, failed}`.

## Task completion is now unmissable (v15)

You should never again wait on a task that already finished. On completion the engine emits:

- a **white in-game chat line** (`!`-tier) — `Task X complete` / the skill's own done message;
- a **`TASK_DONE <name> <result>`** log line in `status.log`, machine-greppable;
- and idle-guard's takeover line now opens with **"previous task DONE"**, so the bot moving
  around after a task is no longer mistakable for the task still running.

Failures are important-tier too (`!failed: <task> — <reason>`). The doctrine half still
stands and matters more than ever: **poll `status.task.done` / `status.task.running`. Never
infer completion from whether the bot is moving** — idle-guard makes a finished bot look busy.

## Telemetry and the ship gate (v19+)

Every bot now writes a metrics ledger to `logs/metrics-<bot>.jsonl`, and every task attempt
gets exactly one `outcome` from a closed enum. The one you care about is **`false_success`**:
the task claimed `done` and an independent assertion disagreed. Its target is zero — a bot
that lies about finishing is worse than one that honestly fails, because the lie costs you
the time to discover it.

```sh
node metrics.mjs                       # verified SR vs naive SR, and the trust gap between
node metrics.mjs --by skill            # per-skill breakdown
node metrics.mjs --goto                # movement, per route class
node metrics.mjs --gate skills-v23     # freeze a ship-gate verdict to bench/gates/
```

**No fleet rollout until the smoke gate is green on the test bot (3110).** The gate is
mechanical: FSR must be 0, SR must clear 70%, and n must be at least 20. It records the
assertion set it judged under, because a changed assertion invalidates cross-version
comparison.

The gate judges **the latest process run only** — a smoke run is one run, so it self-scopes.
That matters: old specimens stay in the ledger forever, so a cumulative gate could never go
green again no matter what got fixed, and a permanently-red gate is one everybody learns to
ignore. Pass `--all` when you want the historical view instead of a rollout verdict.

Two numbers worth knowing how to read. **`trust gap`** is naive SR minus verified SR — how
much of the engine's self-reported success does not survive checking. **`DFR`** is the typed
share of failures; engine work that converts a silent failure into a typed early error shows
up as DFR rising even when SR is flat, and that is progress, not noise.

If you see `n<5 (suppressed)`, that is deliberate — a 1-for-1 success rate reads like
triumph and means nothing.
