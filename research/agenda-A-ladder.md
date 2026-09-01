# Agenda A — Priority Ladder / Subsumption brain (`agenda.js`)

Design for the PHASE-1 autonomous agenda: the deterministic "what next" controller that
lets ONE bot survive and stay productive for hours with **no LLM in the loop**, the LLM
setting only a high-level P2 project. This is architecture **A** of the agenda bake-off:
a fixed, ordered **priority ladder** (Brooks subsumption): rungs are evaluated top-down
every cycle; the highest rung whose precondition fires **owns the body** until it clears.

Ground truth read for this design: `skills.js` (task queue, `ctx`, `__skills.status`),
`idleguard.js` v7, `survival.js` v2, `dangerscan.js` v2, `toolguard.js` v1, `runner.js`
(`GET /state`, `applyPayloadStack`), `protected.json`, `research/SYNTHESIS.md`,
`EVALUATION.md`, `LEARNING_HANDOFF.md`. **No engine code is changed by this design** —
`agenda.js` is a new idempotent `/eval` payload injected on spawn, exactly like the rest of
the stack. It reads the globals the existing stack already publishes and drives the body
through `__skills` and a handful of inline micro-actions borrowed verbatim from
`survival.js`.

---

## 0. Where it sits in the stack (the one non-negotiable relationship)

There are two control loops on the body and they must never be three:

| Loop | Rate | Owns | Mechanism |
|---|---|---|---|
| **Reflex** = `dangerscan.js` (4 Hz sensor) + `survival.js` (event-driven) | 250 ms scan, instant fire on state→`panic` | imminent-death response | subscribes to `__danger.on`, calls `__skills.stop('panic')`, holds `__idleguard.busy=true` |
| **Agenda** = `agenda.js` (this design, ~0.5 Hz deliberative) | 2000 ms tick | everything else (P0b–P3) | reads globals, drives `__skills.start/stop` + inline micro-acts |

**`agenda.js` SUBSUMES `idleguard.js`.** The idle-guard is a single-rung brain (chop OR
mine OR sweep) with its own independent 5 s timer. Two independent timers fighting for
`bot.pathfinder.goal` is the single most-reported field hazard in `LEARNING_HANDOFF.md`
("idle-guard fighting the driver for the goal", "GoalChanged loops", the false "physics
freeze"). So on install the agenda calls `globalThis.__idleguard.stop()` and **re-uses the
idle-guard's role-default work as its own P3 rung** (same `mineNearest` logic, same
surface/`notBelow` gates). One deliberative loop, one reflex loop. Never two deliberative
loops.

The agenda **yields the body completely** whenever the reflex owns it: P0a below is not
code that fights survival, it is code that gets out of survival's way and makes the
resume-vs-abort decision on the falling edge (`survival.js` explicitly logs
`panic_recovered … driver decides resume vs abort` — **the agenda is now that driver**).

```
                 ┌─────────────── dangerscan 4Hz ── __danger.{state,score,threats,held,light,surfaceExposed}
                 │
   __danger.on ──┤
                 ▼
   survival.js (reflex, event)  ──stop('panic')──►  __skills (one task at a time)
        │  active/branch                                  ▲
        ▼                                                 │ start / stop / status
   __survival.active ──────────────────────────►  agenda.js tick (2s)  ── inline: eatUp / torch / posture
                                                          ▲
   __agenda.setProject(desc)  ◄── LLM, once ─────────────┘  (zero tokens per cycle after that)
```

---

## 1. Sensing — the per-tick snapshot (bound to REAL fields)

The agenda runs **in-process** (an `AsyncFunction` `/eval` body with a `setInterval`), so it
reads the live globals directly — **no HTTP `/state` poll, no LLM, zero tokens per cycle**.
One `sense()` builds an immutable snapshot each tick; every predicate reads only this
snapshot (so a rung can never see a half-updated world mid-evaluation).

```js
// constants reused verbatim from skills.js / survival.js / dangerscan.js
const FOODS   = new Set([...]);          // == skills.js FOODS
const FILLERS = new Set([...]);          // == skills.js FILLERS
const TORCHES = new Set(['torch','soul_torch']);
const HOME  = readHome();                // protected.json .home  (survival.js pattern)
const DEPOT = readDepot();               // protected.json .depot {minerals,wood,food,craftingTable}

function sense() {
  const S = globalThis.__skills, D = globalThis.__danger, SV = globalThis.__survival;
  const p = bot.entity && bot.entity.position;
  const inv = bot.inventory;
  const sum = (pred) => inv.items().filter(pred).reduce((a,i)=>a+i.count,0);
  return {
    now: Date.now(),
    alive:        !!(p && typeof bot.health === 'number'),
    hp:           bot.health,                       // 0..20
    food:         bot.food,                         // 0..20
    pos:          p,
    dHome:        p ? dist(p, HOME) : Infinity,
    // --- reflex signals (authoritative, dangerscan-owned) ---
    dangerState:  D ? D.state  : 'calm',            // 'calm' | 'alert' | 'panic'
    dangerScore:  D ? D.score  : 0,
    threats:      D ? D.threats : [],               // [{name,d,s,los,ranged,id,pos}]
    survivalActive: !!(SV && SV.active),
    // --- self-maintenance signals ---
    freeSlots:    inv.emptySlotCount(),
    torches:      sum(i => TORCHES.has(i.name)),
    foodCount:    sum(i => FOODS.has(i.name)),
    filler:       sum(i => FILLERS.has(i.name)),
    light:        D ? D.light : null,               // block light at feet (may be null)
    surfaceExposed: D ? D.surfaceExposed : null,    // geometry-backed: true|false|null
    held:         D ? D.held : heldInline(),        // {name,dur} dur = %; null if bare hand
    // --- best owned tool per class + its durability% (bestOwned pattern) ---
    tools:        toolCensus(inv),                  // {pickaxe:{name,dur}|null, axe, sword, shovel}
    // --- task ---
    task:         S ? S.currentTask : null,         // {id,name,running,done,phase,error}
  };
}
```

Notes bound to quirks:
- `surfaceExposed`/`light` come from `dangerscan.js` v2, which is **geometry-backed** (column
  scan when `skyLight` is stale). This is the LIGHT RULE made mechanical — the agenda never
  uses `y` as a safety proxy (the Marcel-at-y109-under-an-overhang death).
- `held.dur` and `tools[].dur` are the `%` fields dangerscan already computes (`heldInfo`);
  the durability gate reuses them, so "a broken tool outranks the job" needs no new reads.
- The agenda **never does a remote `blockAt` terrain survey** — stale-chunk data
  (`LEARNING_HANDOFF`: "blockAt at distance returns stale/wrong data"). Target selection is
  always delegated to a `__skills` skill, which walks to the frontier first.

---

## 2. The fixed ladder (top = highest priority)

Ten rungs, fixed order, evaluated top-down. `fire(s)` = precondition; `clear(s)` = the
hysteresis/exit condition (an owning rung holds until `clear` even if `fire` has lapsed, so
it cannot re-thrash on the boundary). `act(s)` is what it does.

| # | Rung | `fire(s)` (trigger) | `clear(s)` (release / hysteresis) | `act(s)` |
|---|------|---------------------|-----------------------------------|----------|
| 0 | **P0a REFLEX** (survival.js) | `s.survivalActive \|\| s.dangerState==='panic'` | `!s.survivalActive && s.dangerState!=='panic'` | **yield** — start nothing; on falling edge run handback (§6) |
| 1 | **P0b POSTURE** (alert) | `s.dangerState==='alert'` | `s.dangerState==='calm'` (dangerscan hysteresis: leave at score<1.5) + 3 s dwell | equip sword+shield, stop advancing, hold in lit cell / short step toward HOME, torch if dark |
| 2 | **P1a EAT_CRITICAL** | `s.food<=6 && s.foodCount>0` | `s.food>=19` | `eatUp()` inline (survival.js `eatUp`) |
| 3 | **P1b DEPOSIT** | `s.freeSlots<=2` \|\| last task error `inv_full` | `s.freeSlots>=6` | `depositToChest {pos: DEPOT.minerals}` (keeps gear/food/torches) |
| 4 | **P1c EAT** | `s.food<=17 && s.foodCount>0` | `s.food>=19` | `eatUp()` inline |
| 5 | **P1d TOOL** | active-class tool missing OR `dur<=15%` (§4) | a tool of the class with `dur>25%` owned | `__skills.ensureTool(class)` (equip→depot→craft) |
| 6 | **P1e RESTOCK** | active intent consumes a resource now below its floor (§4) | all active-intent floors met | withdraw from DEPOT to floor+margin |
| 7 | **P1f LIGHT** | `s.surfaceExposed===false && (s.light==null\|\|s.light<8) && s.torches>0` | `s.light!=null && s.light>=9` | place one torch at feet (ctx.autoTorch pattern) inline |
| 8 | **P2 PROJECT** | `project && !projectDone(s)` | `projectDone(s) \|\| project===null` | advance the project (§5) |
| 9 | **P3 IDLE** | `true` (the floor) | never (floor) | role-default work (subsumed idle-guard) |

Design rationale for the intra-P1 order (this is a *fixed* order, not conditional priority —
hence two separate EAT rungs rather than one rung with a moving priority):

- **EAT_CRITICAL above DEPOSIT**: at `food<=6` HP loss from starvation is imminent and
  irreversible; a full inventory only wastes future picks. Eating is ~2 s.
- **DEPOSIT above EAT(17)**: between 7 and 17 food there is *no* active harm (HP drain begins
  at food 0; natural regen just pauses < 18), whereas a full inventory silently drops every
  block you mine from here on. Fix the active waste first.
- **TOOL below both eats/deposit**: acquisition may require travel + craft (expensive);
  do it after the cheap fixes.
- **RESTOCK below TOOL**: it is a *departure* gate for the next excursion, not an emergency.
- **LIGHT lowest in P1**: spawn-*prevention* is low urgency at any single tick, and if a mob
  actually spawns the reflex catches it. Still above the project because a lit workspace is a
  standing user rule.

---

## 3. The tick — arbitration, preemption, latch (deterministic)

```js
const TICK_MS = 2000;                 // deliberative; safety does NOT depend on this
const MIN_SWITCH_MS = 1500;           // global anti-flap floor (except REFLEX/POSTURE)
const PREEMPT_DEBOUNCE = 2;           // ticks a higher rung must hold to preempt a running lower task

function tick() {
  if (globalThis.__agenda !== A || !A.enabled) { clearInterval(A.timer); return; }   // orphan killer
  if (invariantSweep()) return;       // §7: dead-bot / stale / re-arm; may short-circuit
  if (A.busy) return;                 // one act() in flight at a time (re-entrancy guard)

  const s = sense();
  if (!s.alive) return;

  harvestTaskEnd(s);                  // §5: if our task just finished, record outcome + route it

  // 1. DEMAND: highest-priority rung whose fire() holds
  const demanded = RUNGS.find(r => safeFire(r, s));

  // 2. LATCH + PREEMPTION: keep the owner until it clears, unless something higher demands
  let target;
  const owner = A.owner;
  if (owner && !safeClear(owner, s) && demanded.prio >= owner.prio) {
    target = owner;                                  // owner still busy, nothing higher wants in
  } else {
    target = demanded;                               // owner cleared, OR a higher rung fired
  }

  // 3. PREEMPT a running lower-rung skill cleanly before switching down/across
  if (target !== owner) {
    const t = s.task;
    const running = t && t.running && t.id === A.activeTaskId;
    if (running && target.prio > owner?.prio) {
      // never happens: target lower than a still-unclear owner is filtered in step 2
    }
    if (running && target.prio < owner.prio) {       // a HIGHER rung is taking over a running task
      if (target.id === 'REFLEX') { /* survival already stopped it */ }
      else if (debouncePreempt(target, s)) {         // require PREEMPT_DEBOUNCE ticks for non-safety
        globalThis.__skills.stop('agenda:' + target.id, { keepQueue: false });   // clean @ step boundary
        A.pendingPreempt = target.id;
        return;                                       // next tick: task gone → we start `target`
      } else { return; }                              // still debouncing; leave the task running
    }
    if (A.owner && (s.now - A.ownerSince) < MIN_SWITCH_MS
        && target.prio > A.owner.prio && A.owner.prio > 1) return;   // anti-flap floor (safety exempt)
    A.owner = target; A.ownerSince = s.now; A.pendingPreempt = null;
    A.metrics.transitions++;  emit('note', { rung: target.id });
  }

  // 4. RUN the owner's action (idempotent; guarded)
  A.busy = true;
  Promise.resolve(runAct(target, s)).catch(e => log('act ' + target.id + ': ' + e.message))
                                    .finally(() => { A.busy = false; });
}
A.timer = setInterval(tick, TICK_MS);
```

The whole arbiter is these three rules:

1. **Higher always preempts.** A rung strictly above the current owner takes the body the
   moment its `fire` holds (REFLEX/POSTURE immediately; other rungs after a 2-tick debounce
   that absorbs sensor noise).
2. **Owner latches until it clears.** While an owner's `clear` is still false, no
   same-or-lower rung can steal it — this, plus the two-threshold hysteresis, is what stops
   eat/mine/eat oscillation.
3. **Lower never steals.** The floor (IDLE) only ever runs when literally nothing above it is
   firing.

### `runSkill` — the single skill-dispatch helper (used by DEPOSIT, RESTOCK, PROJECT, IDLE)

```js
function runSkill(name, args) {
  const S = globalThis.__skills, t = S.currentTask;
  if (t && t.running) {
    if (t.id === A.activeTaskId) return { state: 'running' };     // ours, let it run
    S.stop('agenda:preempt:' + name, { keepQueue: false });        // foreign/leftover → clean stop
    return { state: 'preempting' };
  }
  if (A.owner.prio > 1 && (globalThis.__survival?.active || globalThis.__danger?.state === 'panic'))
    return { state: 'blocked_by_reflex' };                         // belt+suspenders: never start under panic
  const r = S.start(bot, name, args);                              // returns {ok,taskId} or {ok:false,error}
  if (r.ok) { A.activeTaskId = r.taskId; return { state: 'started', id: r.taskId }; }
  return { state: 'busy', err: r.error };                          // e.g. code 'busy' — retry next tick
}
```

Inline acts (EAT, POSTURE, LIGHT) follow the same "stop any foreign task first, then act"
shape but do the work directly (borrowed from `survival.js`): they must be able to run when
`__skills` has no task at all.

### Preemption granularity & cleanliness

- `__skills.stop()` **"halts at next step boundary (never mid-dig)"** (its own contract). A
  step boundary is between `ctx.step()` calls — sub-second to ~one dig atom (a few seconds
  for stone). So **every non-reflex preemption is clean**: no partial dig, no corrupted
  build cell, latency ≤ 1 tick + 1 step boundary.
- **Reflex (P0a) is the one hard preemption.** `survival.js` already `stop('panic')`s,
  `pvp.forceStop()`s, cancels `collectBlock`, and `setGoal(null)`s on entry. The agenda does
  nothing but observe `survivalActive` and stay out — it *cannot* race survival because it
  checks P0a first and the `runSkill` guard refuses to start under panic.
- A drop or two abandoned by a hard preemption is reclaimed by the next DEPOSIT trip or the
  P3 sweep — a lesser evil than death (the "never leave drops" law yields to "don't die").

---

## 4. Per-rung detail (the non-obvious predicates)

### P0b POSTURE (alert)

Fires on `__danger.state==='alert'` (score ≥ `__danger.thresholds.alert`=2.5, already
hysteretic down to 1.5). It is the graduated step between calm and the panic reflex — the
thing that keeps `panicEntries` and `hostileExposureS` (EVALUATION §2.5 surrogates) low by
**not walking the project into a fight**. `act`:
1. equip best sword + raise shield if carried (survival.js `bestSword`/`shieldUp`).
2. stop advancing: if our project/idle task is running, `S.stop('agenda:posture')`.
3. if `surfaceExposed===false && light<8 && torches>0`, drop a torch (deny the spawn).
4. if `dHome<=40` and the nearest threat is closing, take one step toward HOME's lit plaza
   (a *short* `gotoNear(HOME,4)` capped at 8 s — never the 150-block corridor run that killed
   Bernd; the reflex owns real fleeing).
5. otherwise hold. Clears when dangerscan returns to `calm`; 3 s dwell prevents alert/calm
   flicker on a mob pacing at the radius edge.

### P1d TOOL — "the right tool, always / a broken tool outranks the job"

`activeClass(s)` = the tool class the current intent needs: `project.tool` if a project is
set, else the role default (`miner`→`pickaxe`, `lumberjack`→`axe`, `hunter`→`sword`,
`builder`→none). `fire`:

```js
function toolFire(s) {
  const cls = activeClass(s);            if (!cls) return false;
  const best = s.tools[cls];             // {name,dur} | null   (bestOwned by class)
  if (!best) return true;                // missing entirely
  return typeof best.dur === 'number' && best.dur <= 15;   // near-break (matches dangerscan tool_low)
}
```

`clear`: a class tool with `dur>25` is owned (band 15→25 stops flap as durability ticks
down). `act` = `ctx.ensureTool`/`S.ensureTool(class)` which already does equip→depot(chest
by class from `protected.json`)→craft. If `ensureTool` **fails** (no material, depot empty,
no table) the agenda cannot advance a tool-gated intent: it marks `project.blocked='no_tool'`
(or role `blocked`), logs `tool_unavailable`, and drops to a rung that needs no tool (IDLE
sweep, or a `chop` for a miner to gather craftable wood if the world allows). This is a
genuine handback point — rare, logged for the LLM.

Note: `toolguard.js` already equips-the-right-tool at every `bot.dig`; P1d is the
*acquisition* layer above it (toolguard's own comment: "ensureTool owns acquisition"). The
two compose — toolguard keeps a running task from swinging wrong-handed; P1d makes sure the
tool exists before the task starts and replaces it before it breaks.

### P1e RESTOCK — a departure gate, only when something will consume the resource

Restocking torches to stand at base is pointless, so RESTOCK only fires when the **active
intent** (project or role) actually consumes the low resource:

```js
function restockFire(s) {
  const floor = activeFloors(s);   // from project.restockFloor or role default; e.g. {torches:16,food:4,filler:16}
  if (!floor) return false;
  return (floor.torches && s.torches < floor.torches)
      || (floor.food    && s.foodCount < floor.food)
      || (floor.filler  && s.filler   < floor.filler);
}
```

`act`: walk to DEPOT (`minerals` for torches/filler, `food` for food), withdraw to
`floor + margin`. **Best-effort, never a deadlock**: if the depot is empty/unreachable, log
`restock_short` and clear the rung anyway (with a backoff so it doesn't hammer an empty
chest) — a project that genuinely cannot run without the resource is then *parked* by P2's
own logic (§5), not by RESTOCK spinning forever. This is the one place we deliberately let
an unmet floor through rather than freeze the whole bot.

Floors reuse `skills.js` `KIT_TIERS` (`excursion`/`underground`/`deep`) so the agenda's
notion of "enough" matches the kit preflight the skill will itself enforce — they can't
disagree.

### P1f LIGHT

Local only — it lights *where the bot is*, never sends it wandering to light the world (the
idle-guard's mistake). Uses `surfaceExposed===false` (geometry-backed) as the gate, so an
open farm tile with a stale `skyLight 0` (issue #18) does **not** trigger a pointless torch.
Out of torches → the need becomes RESTOCK's; logs `no_torches` once (matches
`ctx.autoTorch`).

---

## 5. P2 — the PROJECT (how the LLM injects intent, how the ladder runs it forever)

The LLM sets intent **once** with a small descriptor; the ladder executes and re-issues the
underlying skill until an **independently-verified** completion predicate is met. This is
"the LLM thinks once; code runs forever" made literal.

### Descriptor shape

```js
__agenda.setProject({
  id:        'mine-iron-64',            // stable id (telemetry key)
  kind:      'mine',                    // mine | build | farm | stock | goto | chop | hunt
  skill:     'mineLane',                // the __skills skill that advances it
  args:      { target: 'iron_ore', length: 48, torchEvery: 7 },
  done:      { type: 'inventory', item: ['raw_iron','iron_ore'], count: 64 },   // VERIFIER (§EVALUATION law 1)
  tool:      'pickaxe',                 // active tool class (drives P1d)
  restockFloor: { torches: 16, food: 4, filler: 16 },     // drives P1e; falls back to KIT_TIERS
  leash:     200,                       // optional: abort if it would take us > N blocks from HOME
  ttlMs:     3_600_000,                 // optional: abandon after
  continue:  'advance',                 // 'advance' (default) | 'repeat' | 'once'
});
```

`kind`/`skill`/`args` map straight onto the existing registry (`mineLane`, `safeDescend`,
`chopTrees`, `huntAnimals`, `buildSchematic`/`buildWall`/`buildFloor`/`frameStructure`,
`depositToChest`, `come`). Nothing new in `skills.js` is required for the common projects.

### Completion predicate — the FSR=0 guarantee

`projectDone(s)` is an **independent read**, never the skill's self-report (EVALUATION law 1:
"no metric may be sourced from the system under test"; FSR target 0, always). Types:

| `done.type` | verifier |
|---|---|
| `inventory` | `sum(items where name ∈ done.item) >= done.count` (fresh `bot.inventory` read) |
| `position` | `dist(bot.entity.position, done.at) <= done.r` (harness-style, after settle) |
| `build` | independent `blockAt` sweep of the blueprint cells == spec (buildSchematic already re-verifies; the agenda re-checks the count, not the skill's claim) |
| `count` | `project.units >= done.n` (agenda-owned counter, ++ per verified sub-result) |
| `duration` | `now - project.startedAt >= done.ms` |
| `none` | never done — an open-ended standing intent (e.g. "keep the depot stocked"), effectively a *directed* P3 |

Because `projectDone` re-reads the world, a skill that lies ("done: mineLane" while yielding
0 iron — the false-success class the taxonomy names) does **not** advance or complete the
project: the predicate is still false, so the ladder re-issues. False success cannot leak
through the agenda.

### `advanceProject(s)` — the re-issue loop and self-healing failure routing

```js
function advanceProject(s) {
  if (projectDone(s)) { announceDone(); A.project = null; return; }         // → IDLE next tick
  if (leashViolated(s) || ttlExpired(s)) { parkProject('leash/ttl'); return; }

  const r = runSkill(A.project.skill, nextArgs(A.project, s));              // start/continue/preempt-foreign
  // completion is handled in harvestTaskEnd() when OUR task ends:
}

function harvestTaskEnd(s) {
  const t = s.task;
  if (!(A.activeTaskId && t && t.id === A.activeTaskId && !t.running)) return;
  const code = t.error && t.error.code;
  A.activeTaskId = null;
  if (A.owner?.id !== 'PROJECT') { emit('note',{taskEnd:t.name,code}); return; }

  if (!code /* done */) {
    A.project.iterations++;
    if (projectDone(s)) { announceDone(); A.project = null; return; }        // verified complete
    // not yet: re-issue continues on the next tick's advanceProject (mineLane next lane, etc.)
    return;
  }
  routeFailure(code, s);
}
```

**The elegant part — the ladder is a fixed-point controller, so most failures need no
explicit mapping.** A `no_tool` failure changes a *sensable* field (the tool is gone), so on
the very next tick `sense()` reports it and **P1d TOOL fires above P2** and fixes it, then
P2 resumes. Likewise `inv_full`→P1b DEPOSIT, `kit_missing`→P1e RESTOCK, `low_health`→P1a/P1c
EAT (or the reflex). The failure code is mostly informative; the world-state it produced is
what re-routes the ladder, automatically and convergently.

`routeFailure` only has to handle codes that **don't** change a sensable field:

| code | handling |
|---|---|
| `not_found` (frontier exhausted) | relocate the frontier: `mine`→`safeDescend` a few levels or shift XZ (bounded ≤ 3 tries); `chop`→widen radius; then retry. If still empty → `parkProject('exhausted')`. |
| `stuck` / `path_timeout` / `wedge` | retry once; if it recurs at the same `pos`, one small `gotoNear(offset)` nudge, then relocate; after `k=3` same-spot freezes → **hard-wedge escape** (§7). |
| `timeout` | retry with exponential backoff. |
| `unreachable` | nudge/relocate as `stuck`. |
| `no_path` | relocate frontier once, else park. |

**Anti-thrash on the project itself** (mirrors the queue_thrash guard, `THRASH_N=12`/10 s):
track `project.fails[]` timestamps; if ≥ 5 failures in 60 s → `parkProject('thrash')`:
set `project.state='stuck'`, exponential backoff, fall to IDLE (bot stays productive), and
log `project_stuck` — the **one** signal that wakes the LLM to reconsider intent. No hot
loop, ever.

`parkProject` never *deletes* the descriptor (the LLM may still want it); it sets
`state='stuck'` so `projectDone` stays false but `advanceProject` no-ops until a backoff
window passes or the LLM re-sets it.

---

## 6. Survival handback (the P0a falling edge)

`survival.js` completes a branch, calls `__danger.clearPanic()`, and hands back. On the tick
where `survivalActive` goes false and `dangerState!=='panic'`, the agenda decides
**deterministically**:

```
re-sense s
if s.dangerState === 'alert'        → POSTURE owns (do not resume the project into a live threat)
else:                                 // calm
  P1 sweep runs first by normal ladder order (eat/deposit as needed)
  if A.project && !projectDone(s) && !leashViolated(s):
        resume it — skills are idempotent/restartable
        (buildSchematic skips placed cells; mineLane restarts; safeDescend resumes; come re-paths)
  else → IDLE
```

Because resumption is just "the ladder keeps evaluating", there is nothing special to store:
the project descriptor survived (survival never touched `__agenda`), and the next tick simply
finds PROJECT is again the highest firing rung. The handback is a *non-event* — exactly the
subsumption property we want.

---

## 7. Invariant sweep (top of every tick; no body control; cheap)

Runs before rung evaluation. Fixes the "silently reverted" class of failures that
`LEARNING_HANDOFF` and `SYNTHESIS` blame for half the death pool. Returns `true` to
short-circuit the tick when the bot is not ours to drive.

```js
function invariantSweep() {
  // (a) OWN staleness: a reconnect built a fresh bot; this agenda is bound to the dead one.
  if (REG.agenda.stale) return true;                 // runner re-injects a fresh agenda; this one idles out

  // (b) one deliberative loop: keep the subsumed idle-guard's timer off
  const ig = globalThis.__idleguard;
  if (ig && ig.enabled) { try { ig.stop(); } catch (_) {} }

  // (c) Movements safety — the silent-revert that killed Marcel (unsafe defaults w/o a reconnect)
  const m = bot.pathfinder && bot.pathfinder.movements;
  if (m && (m.allowParkour || m.maxDropDown > 3 || m.allow1by1towers
            || m.infiniteLiquidDropdownDistance || (m.allowSprinting && !A.haulSanctioned))) {
    try { bot.pathfinder.setMovements(baseMovementsSafe(m)); A.metrics.movesReapplied++; } catch (_) {}
  }

  // (d) reflex liveness: survival re-subscribes itself on a 5s timer; just note if payload is stale
  const reg = globalThis.__payloads || {};
  if (reg.survival?.stale || reg.dangerscan?.stale) emit('note', { staleReflex: true });

  // (e) refresh HOME/DEPOT from protected.json occasionally (hot-reload, survival.js cadence)
  if (A.now - A.cfgReadAt > 30000) { HOME = readHome(); DEPOT = readDepot(); A.cfgReadAt = A.now; }
  return false;
}
```

**Hard-wedge escape** (last resort, deterministic, hard rate-limited): the chest-gap / narrow
freeze that `LEARNING_HANDOFF` documents survives `setGoal(null)`+`clearControlStates()`; the
proven cure is a relog. After `k=3` consecutive same-spot `stuck` failures (position
bit-identical), the agenda calls `bot.quit()` — runner auto-reconnects and re-injects the
whole stack (including a fresh agenda). Rate-limit **≤ 1 relog / 10 min**; if a freeze
recurs immediately after the reconnect, do **not** loop — log `hard_wedge_unrecovered` and
fall to a stationary IDLE posture. That is an honest L2 handback, not a crash loop.

---

## 8. How each known field hazard is survived (LEARNING_HANDOFF → mechanism)

| Hazard (LEARNING_HANDOFF) | How the ladder survives it |
|---|---|
| idle-guard fights driver for the goal / false "physics freeze" | agenda **stops** the idle-guard and is the *only* deliberative loop (invariant b) |
| `__idleguard.pause()` doesn't cover the stall-buster | moot — the guard is stopped, not paused |
| Movements silently revert to unsafe defaults (Marcel) | invariant (c) re-checks + reapplies every tick |
| torch-underfoot / leaf-litter wedge | handled *inside* `ctx.goto`'s unstick; the agenda only sees a returned `stuck` code → §5 relocate ladder |
| chest-gap hard freeze (survives setGoal null) | hard-wedge escape → bounded relog (§7) |
| orphaned goto poisons later goals | the agenda never hand-rolls `goto`; every move is `ctx.goto` (owned-token, clears on exit) or a skill |
| tools break silently mid-task | P1d fires on `dur<=15%` from dangerscan's real durability read, *before* the break |
| craft void / count desync | delegated to `ctx.craftSafe` (800 ms settle + count-verify) inside `ensureTool` |
| stale `blockAt` at distance | agenda does no remote surveys; skills walk to the frontier first |
| LIGHT RULE (y is not a safety proxy) | P1f/POSTURE gate on `surfaceExposed`/`light`, never `y` |
| drops sniped in seconds | skills sweep at their end; DEPOSIT/IDLE reclaim after any hard preemption |
| payload dies on reconnect (presence ≠ liveness) | agenda registers in `__payloads`, marks stale on `bot.once('end')`, idles out; runner re-injects fresh |

---

## 9. Public API (what the LLM / orchestrator touches — rarely)

```js
__agenda.setProject(desc)   // validate + set P2 intent; returns {ok} | {ok:false,error}
__agenda.clearProject()     // → P3 floor
__agenda.setRole(role)      // P3 default-work role: miner|lumberjack|hunter|builder
__agenda.snapshot()         // cheap poll: {owner, ownerSince, project:{id,kind,state,iterations,fails}, role,
                            //              counters, movesReapplied, stale}  — no body control
__agenda.pause()/resume()   // operator override: pause() parks the loop (bench needs a bare bot);
                            // (bench AS-soak runs WITH agenda; measured scenarios run with pause())
__agenda.cfg                // live-tunable thresholds (eatAt, depositAt, toolLowPct, tickMs, floors) — one /eval
```

`snapshot().project.state ∈ {running, done, stuck}` is the **only** thing an orchestrator
polls, and only when it wants to hand a *new* project. In the fully driverless AS-soak there
is no LLM at all: the agenda runs role-default P3 + self-maintenance (+ any seeded standing
project) for hours, `snapshot` unread. That is the phase-1 acceptance shape.

---

## 10. How this is measured (bound to EVALUATION.md)

- **AS 8 h autonomy soak** (§2.6, §4): the agenda is the subject. `utilization =
  active_ms/wall_ms` stays high because the floor (IDLE) is always eligible and self-maint is
  quick; `idlePct ≤ 5 %` target. **0 L2 interventions** because every failure routes to a
  rung or an honest park, never a freeze. **0 tokens** because the loop is in-process.
  `staleAfterReconnect` HARD trigger = 0 via §7 + the `__payloads` registry.
- **FSR = 0 law** (§0, §2.1): completion predicates are independent reads (§5); a lying skill
  cannot advance or finish a project. `trust_gap` contribution from the agenda = 0.
- **Survival surrogates** (§2.5): the ladder is *designed* to move them — P1f LIGHT cuts
  `darkExposureS`; P0b POSTURE cuts `hostileExposureS` and `panicEntries` (graduated response
  before the reflex); P1a/P1c EAT cut `lowHpMinutes`; P1d TOOL cuts unwarned tool breaks
  (a HARD trigger). `detectMs` for real threats stays ≤ 1000 ms because detection is
  dangerscan's 250 ms loop, not the 2 s agenda tick.
- **Outcome taxonomy** (§1): the agenda's task starts flow through `__skills`, so each attempt
  already emits a `task_end` with the closed-enum `outcome`; the agenda adds `note` events at
  rung transitions and `project_start/done/stuck` — all optional-chained to the future
  `telemetry.js` (§3 there), never blocking.
- **Anti-Goodhart** (§8): the agenda does not "fail fast to raise arrival rate" — a project is
  `done` only on the verifier, and `stuck` is logged with its denominator (iterations, fails).

---

## 11. Install / injection (no engine edit; one line in the stack)

`agenda.js` is a `__ROLE__`-templated payload (like `idleguard.js`), injected **after**
`survival.js` (it reads `__survival`/`__danger`) in `runner.js` `applyPayloadStack`'s list,
and it `stop()`s the idle-guard on install. Recommended end-state: the runner injects
`agenda.js` **in place of** `idleguard.js` when a role is present (the agenda subsumes it);
until then the agenda self-defensively stops the guard every tick (invariant b). It is
idempotent (`__agenda.restore()` then rebuild), registers `__payloads.agenda`, marks stale on
`bot.once('end')`, and re-subscribes to nothing (it *polls* `__danger`/`__survival` state; no
listener to orphan). Order in the stack:

```
skills.js → dangerscan.js → survival.js → digguard.js → graychat.js → reachguard.js → agenda.js
```

Config knobs that already exist and are reused (no new tables): `KIT_TIERS`, `FOODS`,
`FILLERS`, `TOOL_LOW_PCT`, `MAX_BELOW` (skills.js); `__danger.thresholds`, `.weights`
(dangerscan); `home`/`depot` (protected.json). The agenda adds only its own `A.cfg`
(thresholds table above), all live-tunable via one `/eval`.

---

## 12. Why the ladder (this architecture's own case) + open questions

**Why a fixed ladder is the right architecture for phase 1.** It is the cheapest thing to
*reason about*: at any instant the bot's behavior is "the highest rung that fired", a single
line of state (`__agenda.snapshot().owner`) fully explains what it is doing and why, and a new
hazard becomes one new rung at a fixed height — no reward tuning, no tree surgery, no
emergent surprises. The determinism codicil is satisfied structurally: the LLM sets one
descriptor; the arbiter is pure `sense()`→predicate→act with no learned parameters. It maps
1:1 onto the stack we already have (reflex above, `__skills` below), and it turns the two
loops fighting for the body — today's biggest field hazard — into one loop with a clean yield
to the reflex.

**Honest limits / open questions** (for the bake-off comparison):
- A strict ladder cannot express "do a little of B while A is mostly satisfied" — e.g. topping
  torches opportunistically *during* mining rather than as a separate RESTOCK trip. The ladder
  handles this only by folding it into the skill (`mineLane` already autoTorches) or accepting
  a dedicated trip. A utility/behavior-tree agenda may interleave more cheaply; the ladder
  trades that for legibility.
- Rung *order* is a human judgment call (the EAT-vs-DEPOSIT ordering above). It is fixed and
  auditable, but it is not *derived* — a bad ordering is a silent inefficiency, not a crash.
- The 2 s tick bounds non-safety reaction latency; anything needing < 2 s reaction that is
  *not* a dangerscan-visible threat (e.g. a lava-flow the ENV branch would catch but only
  once it touches feet) leans on the skill's own guards, not the agenda.
- What stays LLM (rare, logged): setting/replacing the project on `project_stuck`; the
  `tool_unavailable` handback; the `hard_wedge_unrecovered` handback. Everything else — eat,
  deposit, restock, light, retreat, tool-replace, project re-issue, idle fallback, survival
  handback — is deterministic and runs with zero tokens.

**Determinism scorecard:** every rung predicate and act is pure code over `sense()`. The
only LLM touch points are (1) one `setProject` call to declare intent and (2) three rare
handback logs. No LLM is in the per-cycle loop; the ladder is a closed-loop fixed-point
controller that converges the world toward "highest unmet need satisfied" every 2 s.
