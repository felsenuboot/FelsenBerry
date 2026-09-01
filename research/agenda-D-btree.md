# Agenda D — the Behavior-Tree brain (`agenda.js` / `globalThis.__agenda`)

Design for the AUTONOMOUS AGENDA capstone (GOAL.md phase-1): the deterministic
"brain" that decides what a driverless bot does each cycle. Architecture:
**behavior tree** — a ticked tree of selector / sequence / condition / action nodes,
re-evaluated top-down every tick, with running-node memory. The LLM sets one thing
(the *project*); the tree runs everything else forever.

Author: agenda-D track. Ground truth read: `skills.js` (engine v16, task queue v6,
`ctx` primitives, `S.status`), `idleguard.js` v7, `survival.js` v2, `dangerscan.js`
v2, `toolguard.js` v1, `runner.js` `GET /state`, `EVALUATION.md`, `LEARNING_HANDOFF.md`,
`research/SYNTHESIS.md`, `protected.json`. **No engine code is edited by this design** —
`agenda.js` is a new injectable payload in the exact mold of `idleguard.js`/`survival.js`,
plus a small family of *maintenance micro-skills* registered into the existing
`S.registry`.

---

## 0. Thesis (why a behavior tree, in one paragraph)

The agenda is a **hard-priority arbiter over a small, fixed set of needs**
(survival › self-maintenance › project › idle), where each need is a **stateful,
multi-step behavior** (descend → mine → deposit → repeat), and where the whole
thing must **re-decide reactively** the instant a higher need appears (a creeper, a
broken pick, a full bag). That is precisely the shape a behavior tree encodes
natively: the top-level ordering is a **priority Selector** (identical in legibility
and determinism to the ladder that GOAL.md sketches — a ladder *is* a one-level
Selector), and each need is a **Sequence** with running-node memory (which the ladder
cannot express without hand-rolled `bb.phase` state machines). Reactivity is free:
the tree ticks from the root each cycle, so a lower-priority project is preempted with
zero explicit `if error then…` wiring. And unlike utility AI, the behavior is *read
off the tree structure* — auditable, diffable, reproducible from state — which the
DETERMINISM CODICIL and EVALUATION.md's Law 1/Law 2 demand. Utility scoring is the
right tool *inside* a leaf (pick the nearest safe ore) and the wrong tool for the
agenda itself, where the priorities are laws, not preferences.

---

## 1. Where the brain sits (payload model, what it replaces, what it defers to)

`agenda.js` is injected via `POST /eval` exactly like the other payloads — `bot`,
`mineflayer`, `pathfinder`, `goals`, `Vec3` are in scope; it installs
`globalThis.__agenda`; it is idempotent (re-inject restores + replaces); it registers
in `globalThis.__payloads` and marks itself `stale` on `bot.once('end')`. Inject order:
**after** skills.js, dangerscan.js, survival.js, toolguard.js, digguard.js (it reads all
of their globals). The runner spawn-hook (SYNTHESIS P0.2) adds `agenda.js` to the
auto-inject list so it survives reconnect.

It **replaces** exactly one thing: `idleguard.work()` — the single-role default-work
decider. The BT's idle-subtree does that job, deterministically, and with the full
priority context above it. It **keeps** idleguard's non-decision machinery
(the goal stall-buster, the orphan-timer killer, the external-activity tracker) by
leaving idleguard installed but neutered (`__idleguard.work` becomes a no-op, set at
agenda install; see §11.3). One brain, no two deciders fighting for `bot.pathfinder`.

It **defers to** two things it must never duplicate:

- **survival.js** owns the tick-speed reflex (250 ms `__danger` scan → ENV / CREEPER /
  BREAK_LOS / FLEE_HOME / WALL_OFF branches, force-stops `__skills`, suspends the guard).
  The BT's survival subtree does **not** re-implement combat — it *detects that the
  reflex owns the body* and yields, and it covers the **sub-panic** band the reflex
  ignores (ALERT, proactive lighting, retreat-before-it-becomes-panic).
- **the task queue** (`__skills`) owns *execution*. The BT never drives the body with
  its own `await bot.dig/goto` loops — that would violate the strict single-task mutex
  (AUTONOMY_PLAN risk #1: four control loops over one body). **Every action the BT takes
  is dispatched through `S.start` / `S.enqueue`**, and a running task *is* a RUNNING
  leaf (§5). This is the single most important structural decision in the design.

```
                    dangerscan.js (250ms)  ──state──▶  survival.js (reflex, owns body on panic)
                          │                                   │ suspends
   GET /state ◀───────────┤                                   ▼
                          │                              __idleguard (stall-buster kept, work() off)
   agenda.js  ── ticks 1s ─┤ reads globals                     ▲
   (__agenda) ── dispatches ─────────────────────────▶  __skills task queue ──▶ bot (one task at a time)
                                                             ▲
                    LLM ── setProject() once ──────────────┘ (only high-level intent)
```

---

## 2. Signals the tree reads (bound to REAL fields)

Every predicate below is a pure read of these — no I/O, no awaits. The brain snapshots
them once per tick into `st` (a plain object) so the whole tree sees a consistent frame.

| Blackboard field (`st.*`) | Source expression | Type / range |
|---|---|---|
| `hp` | `bot.health` | 0–20 |
| `food` | `bot.food` | 0–20 |
| `oxygen` | `bot.oxygenLevel` | 0–20 (undef on land) |
| `pos` | `bot.entity.position` | Vec3 |
| `emptySlots` | `bot.inventory.emptySlotCount()` | 0–36 |
| `held` | `__danger.held` → `{name,count,dur}` (dur = %); else from `bot.heldItem` | obj/null |
| `dangerState` | `__danger.state` | `'calm'│'alert'│'panic'` |
| `dangerScore` | `__danger.score` | float |
| `threats` | `__danger.threats` | `[{name,d,s,los,ranged,id,pos}]` |
| `nearest` | `__danger.nearest` | threat/null |
| `light` | `__danger.light` | 0–15 / null |
| `skyLight` | `__danger.skyLight` | 0–15 / null |
| `surfaceExposed` | `__danger.surfaceExposed` | `true│false│null` (geometry-backed) |
| `reflexActive` | `__survival.active === true` | bool |
| `reflexBranch` | `__survival.branch` | string/null |
| `task` | `__skills.currentTask` | `{running,done,error{code},result,name,id,phase,progress,collected}`/null |
| `queueState` | `__skills.queueState` | `idle│running│draining│halted│paused│stopped` |
| `queueHalt` | `__skills.queueHalt` | `{code,message,task,pending}`/null |
| `daytime` | `bot.time.timeOfDay < 12000` (0–24000) | bool |
| `movements` | `bot.pathfinder.movements` | for the safe-profile re-assert |
| `stale` | `Object.entries(__payloads).filter(v=>v.stale)` | list |

**Kit / durability queries** reuse the engine's own inspectors so the brain and the
engine never disagree about "the right tool" or "enough torches":

- `S.kitCheck(bot, tier)` → `{ok, tier, missing:[...], warnings:[...]}` — pure, no side
  effects (already used by kit preflight; drivers already call it directly).
- role-tool durability: `st.held.dur` when the role tool is held, else scan
  `bot.inventory.items()` for the role class and take min `dur%` (same math as
  dangerscan `heldInfo`).

---

## 3. Actions the tree can take (bound to REAL skills)

Two families, both routed through the one task queue.

**A. Existing registered skills** (the project + idle leaves dispatch these; args are the
skills' real `params`):

| skill | key args | kit tier | tool |
|---|---|---|---|
| `come` | `{x,y,z,range}` | – | – |
| `collectDrops` | `{radius,timeoutMs,only}` | – | – |
| `chopTrees` | `{types,count,maxDist,replant}` | excursion | axe |
| `mineLane` | `{target,count,maxDist,vein,laneY}` | underground / deep (y<0) | pickaxe |
| `huntAnimals` | `{species,count,radius}` | excursion | sword |
| `safeDescend` | `{toY,dir,torchEvery,maxSteps,minY}` | underground / deep | pickaxe |
| `depositToChest` | `{pos,keep,keepTools,items}` | – | – |
| `buildWall`/`buildFloor`/`frameStructure`/`buildSchematic`/`buildStaircase` | see registry | – | – |

**B. New maintenance micro-skills** — thin wrappers over `ctx` primitives that ALREADY
exist, registered into `S.registry` at agenda-install time via `S.define(...)`. This is
deliberate: it keeps maintenance inside the same single-task mutex, the same kit
preflight, the same `S.status`/telemetry contract, the same `ctx.step()` cancellation.
The brain never hand-drives the body. Each is ~15–30 lines:

| micro-skill | body (all pre-existing `ctx` calls) | terminal result |
|---|---|---|
| `restockKit {tier}` | `ctx.withdrawFromChest(depot.minerals, {cobblestone, torch, coal…})`, `withdrawFromChest(depot.food, {bread…})` to meet `KIT_TIERS[tier]` deltas | `{got:{}, short:{}}` |
| `acquireTool {cls}` | `ctx.ensureTool(cls)` (equip → depot → craft chain already implemented) | `{how, item}` |
| `eatNow {to}` | mirror `survival.eatUp()` — bump `autoEat.startAt`, `bot.autoEat.eat()` until `food>=to` | `{food}` |
| `lightArea {radius}` | greedy `ctx.autoTorch(state, 1)` sweep of dark cells within radius (SYNTHESIS P4.13 `lightSweep`) | `{placed}` |
| `goHome {}` | `come(home)` with HAUL profile | arrival |
| `stow {}` | `depositToChest(depot nearest)` keeping gear | deposit result |

> These are the *only* new engine surface this design requires, and they add no new
> control loop — they run **as tasks**, one at a time, like every other skill.

---

## 4. The node kernel (≈130 lines, pure, no engine coupling)

Status is a 3-value enum mapped 1:1 onto the task lifecycle so the queue and the tree
speak the same language:

```js
const S_OK = 'success', S_FAIL = 'failure', S_RUN = 'running';
```

Node = a function `(bb) => status`, plus optional per-node memory keyed by a stable
`id`. Composites and decorators:

```js
// --- leaves ---
const Cond = (id, pred) => ({ id, tick: (bb) => pred(bb) ? S_OK : S_FAIL });
const Do   = (id, fn)   => ({ id, tick: (bb) => fn(bb) });            // returns a status

// --- composites ---
// Selector (Fallback): first non-FAIL wins. This is the priority arbiter.
const Sel = (id, kids) => ({ id, kids, tick(bb) {
  for (const k of kids) { const s = k.tick(bb); if (s !== S_FAIL) return s; }
  return S_FAIL;
}});
// Sequence: first non-OK stops. REACTIVE (re-evaluates guards each tick); running-task
// ownership is remembered on the blackboard (§5), NOT via a latched child index — guards
// over real state are self-correcting and idempotent, which survives knock-back/teleport.
const Seq = (id, kids) => ({ id, kids, tick(bb) {
  for (const k of kids) { const s = k.tick(bb); if (s !== S_OK) return s; }
  return S_OK;
}});

// --- decorators (per-node memory lives in bb.mem[id]) ---
const Cooldown = (id, ms, child) => ({ id, tick(bb) {   // FAIL until ms since last non-FAIL
  const m = bb.mem[id] || (bb.mem[id] = { until: 0 });
  if (bb.now < m.until) return S_FAIL;
  const s = child.tick(bb);
  if (s !== S_FAIL && s !== S_RUN) m.until = bb.now + ms;  // arm cooldown on a completed run
  return s;
}});
const RetryUpTo = (id, n, child) => ({ id, tick(bb) {    // FAIL becomes RUN until n failures
  const m = bb.mem[id] || (bb.mem[id] = { fails: 0 });
  const s = child.tick(bb);
  if (s === S_OK)  { m.fails = 0; return S_OK; }
  if (s === S_RUN) return S_RUN;
  if (++m.fails >= n) { m.fails = 0; return S_FAIL; }      // give up → let a sibling try
  return S_RUN;                                            // absorb the failure, retry next tick
}});
const Once = (id, child) => ({ id, tick(bb) {             // latch: SUCCESS forever after first OK
  const m = bb.mem[id] || (bb.mem[id] = { done: false });
  if (m.done) return S_OK;
  const s = child.tick(bb); if (s === S_OK) m.done = true; return s;
}});
const Invert = (id, child) => ({ id, tick: (bb) => {
  const s = child.tick(bb); return s === S_OK ? S_FAIL : s === S_FAIL ? S_OK : S_RUN; }});
const Guard = (cond, child) => Seq('g:' + child.id, [cond, child]); // cond must pass to run child
```

`bb.mem` is cleared per node only by the node itself; it survives ticks (running-node
memory) but is wiped on reconnect with the payload. Cooldowns default to wall-clock
`Date.now()` (`bb.now`, snapshotted once per tick).

---

## 5. The reconciliation: a 1 s BT tick vs an 800 ms skill

This is the crux the brief asks to resolve. **A BT tick is a DECISION; the skill is the
WORK.** They run at different rates on purpose and never block each other.

- **Tick cadence:** one `setInterval` at `TICK_MS = 1000`. A tick is fully synchronous
  and cheap — snapshot `st`, walk the tree, issue **at most one** dispatch command
  (`S.start` / `S.enqueue` / `S.stop` / `S.skip`, all synchronous and non-blocking). No
  `await` in the tick, ever — same discipline the queue's `_pump`/`_onTaskEnd` enforce.
  1 s is comfortably slower than dangerscan's 250 ms reflex (so survival always wins the
  race to a threat) and slower than a skill's ~800 ms phase (so the tree observes stable
  task state), yet fast enough to react to inv-full / tool-break / queue-halt — the
  events survival.js does *not* cover — within ~1 s.

- **A running skill IS a RUNNING leaf.** The mapping lives in one bridge function every
  dispatching action calls. It gives leaves "running-node memory" by remembering, on the
  blackboard, *which leaf owns the current task* and *what outcome to expect*:

```js
// bb.cur = { owner, prio, taskId, expect } | null   — the one task the brain owns
function dispatch(bb, owner, prio, spec, expect) {
  const t = bb.st.task;                       // __skills.currentTask snapshot
  const q = bb.st.queueState;

  // (1) our task is still running → RUNNING (this is the running-node memory)
  if (bb.cur && bb.cur.owner === owner && t && t.running && t.id === bb.cur.taskId)
    return S_RUN;

  // (2) our task just ended → read terminal state, verify, clear ownership
  if (bb.cur && bb.cur.owner === owner && t && !t.running && t.id === bb.cur.taskId) {
    const out = classifyOutcome(bb, t, bb.cur.expect);   // §12 — honest, verifier-backed
    bb.cur = null;
    return out === 'ok' ? S_OK : S_FAIL;                 // typed code left on bb.lastFail
  }

  // (3) something ELSE is running. Preempt only if we outrank it (tree order = priority).
  if (t && t.running) {
    if (prio > (bb.cur ? bb.cur.prio : 0)) { S.stop('agenda-preempt:' + owner); return S_RUN; }
    return S_RUN;   // an equal/higher task owns the body — wait, don't thrash
  }
  if (q === 'paused' || q === 'halted') { /* handled by conditions above us; don't start */ }

  // (4) body is free → start our task. Cooldown/thrash guard lives in the calling decorator.
  const r = spec.queue
    ? S.enqueue(bot, spec.items, spec.opts)
    : S.start(bot, spec.name, spec.args);
  if (!r.ok) { bb.lastFail = r.error; return S_FAIL; }   // busy/bad_args/kit_missing → sibling handles
  bb.cur = { owner, prio, taskId: r.taskId || (S.currentTask && S.currentTask.id), expect };
  return S_RUN;
}
```

Consequences:

- The tree **cannot** start two tasks — `S.start` returns `{ok:false, code:'busy'}` if one
  runs, and the bridge treats that as "someone owns the body, wait". The single-task mutex
  is respected structurally.
- **Preemption is safe.** `S.stop()` cancels only at the next `ctx.step()` boundary
  (never mid-dig) and clears the pathfinder goal — the same mechanism survival.js already
  uses. The brain preempts a project task for a maintenance/survival need by returning a
  higher-priority action; the running task tears down cleanly, and next tick the winner
  dispatches into a free body.
- **`kit_missing` from `S.start` is not a failure of the leaf — it's a routing signal.**
  When a project leaf's `S.start` is refused with `kit_missing`, `bb.lastFail` carries the
  tier + missing list, the leaf returns FAIL, the project subtree returns FAIL, and *next
  tick* the maintenance subtree's restock condition (which reads the same `S.kitCheck`)
  passes and fixes it. No explicit wiring — the priority selector does the interleave.

---

## 6. The blackboard (`__agenda.bb`)

```js
bb = {
  now: 0,                       // Date.now(), snapped per tick
  st: {},                       // the §2 signal frame, snapped per tick
  role: '__ROLE__',             // injected like idleguard: miner|lumberjack|hunter|builder
  home:  readHome(),            // protected.json .home  → {x,y,z}
  depot: readDepot(),           // protected.json .depot → {minerals,wood,food,craftingTable}
  project: { kind: 'none', params: {}, phase: 'idle', done: false, blocked: null },
  cur: null,                    // { owner, prio, taskId, expect } — the owned task (§5)
  mem: {},                      // per-node decorator memory (cooldowns, retries, latches)
  lastFail: null,               // last typed error, for outcome routing + status
  stats: { ticks: 0, dispatches: 0, preempts: 0, falseSuccess: 0, byOwner: {} },
};
```

`project` is the **only** field the LLM writes, via
`__agenda.setProject({kind, params})` (a chat verb or a `/eval` one-liner or a future
runner route). Everything else is engine-owned. Reading `__agenda.snapshot()` in
`GET /state` gives a driver the whole agenda at a glance (current owner, project phase,
last block).

---

## 7. The tree (root + four subtrees, expanded to real leaves)

Priority = tree order. Each subtree returns RUNNING while it owns work, SUCCESS when it
handled the frame (idle always does), FAIL to pass control down.

```js
const ROOT = Sel('root', [ SURVIVAL, MAINTENANCE, PROJECT, IDLE ]);
```

### 7.1 SURVIVAL subtree (prio 100) — detect the reflex, cover the sub-panic band

```js
const SURVIVAL = Sel('survival', [

  // (a) the reflex owns the body → yield completely. survival.js already S.stop()'d our
  //     task and suspended the guard; we must not dispatch anything.
  Guard(Cond('reflex.active', bb => bb.st.reflexActive),
        Do('defer.reflex', bb => { bb.cur = null; return S_RUN; })),

  // (b) ENV backstop: feet/head in hazard or drowning, but reflex somehow not firing
  //     (dangerscan stale / not installed). Nudge survival.js directly — do NOT re-implement.
  Guard(Cond('env.imminent', bb => envHazard(bb) || bb.st.oxygen <= 6),
        Do('trigger.env', bb => { try { __survival.trigger('bt-env'); } catch(e){} return S_RUN; })),

  // (c) ALERT band (2.5 ≤ score < 5): no reflex, but do NOT lead a project deeper into it.
  //     Preempt any descending/mining task and retreat toward light/home if base is near.
  Guard(Cond('danger.alert', bb => bb.st.dangerState === 'alert'),
        Sel('alert', [
          // if a deep/dark project task is running, stop it (don't dig toward the mob)
          Guard(Cond('proj.isDeep', bb => ownerIsDeepProject(bb)),
                Do('alert.preempt', bb => { S.stop('alert-preempt'); bb.cur = null; return S_RUN; })),
          // melee-only and home ≤ 40 → walk to the lit plaza and hold
          Guard(Cond('flee.viable', bb => meleeOnly(bb) && distHome(bb) <= 40),
                Do('alert.home', bb => dispatch(bb, 'alert', 90,
                     { name:'come', args:{ ...bb.home, range:2 } }, { arriveNear: bb.home }))),
          // otherwise light the area so it stops spawning, if we have torches
          Guard(Cond('alert.dark.torched', bb => isDark(bb) && haveTorches(bb)),
                Do('alert.light', bb => dispatch(bb, 'alert', 90,
                     { name:'lightArea', args:{ radius:6 } }, {}))),
        ])),
]);
```

`SURVIVAL` returns FAIL only when the frame is genuinely calm — then MAINTENANCE ticks.

### 7.2 MAINTENANCE subtree (prio 80) — self-upkeep, one need per tick

A Selector of `Guard(Cond, Action)` pairs, urgency-ordered. Each action is
cooldown-decorated so it can't thrash; most ticks every guard is FALSE and the whole
subtree falls through in microseconds.

```js
const MAINTENANCE = Sel('maint', [

  // 1. EAT (active backstop; passive auto-eat handles the gentle case). Preempts.
  Guard(Cond('food.critical', bb => bb.st.food <= 6 && haveFood(bb)),
    Cooldown('cd.eat', 3000, Do('eat', bb => {
      if (bb.st.task && bb.st.task.running) { S.stop('eat-preempt'); bb.cur = null; return S_RUN; }
      return dispatch(bb, 'maint.eat', 80, { name:'eatNow', args:{ to:18 } }, {}); }))),

  // 2. TOOL broken/missing (user law: "replacing a broken tool outranks the job").
  //    Fires on low durability, on a no_tool queue halt, or on kitCheck missing weapon/pick.
  Guard(Cond('tool.bad', bb => roleToolDur(bb) <= 15
                              || haltCode(bb) === 'no_tool' || haltCode(bb) === 'tool_missing'),
    Cooldown('cd.tool', 8000, Do('tool', bb => {
      if (bb.st.task && bb.st.task.running) { S.stop('tool-preempt'); bb.cur = null; return S_RUN; }
      return dispatch(bb, 'maint.tool', 80, { name:'acquireTool', args:{ cls: roleClass(bb) } }, {}); }))),

  // 3. INVENTORY full (reactive halt inv_full, or proactive ≤1 free slot). Deposit.
  Guard(Cond('inv.full', bb => bb.st.emptySlots <= 1 || haltCode(bb) === 'inv_full'),
    Cooldown('cd.stow', 5000, Do('stow', bb =>
      dispatch(bb, 'maint.stow', 80, { name:'stow', args:{} }, { emptiedSlots: true })))),

  // 4. RESTOCK consumables to the project's kit tier — only when it can be done cheaply
  //    (near depot) or the queue is already halted on kit_missing.
  Guard(Cond('restock.needed', bb =>
        (!S.kitCheck(bot, projectTier(bb)).ok) &&
        (distDepot(bb) <= 24 || haltCode(bb) === 'kit_missing')),
    Cooldown('cd.restock', 10000, Do('restock', bb =>
      dispatch(bb, 'maint.restock', 80, { name:'restockKit', args:{ tier: projectTier(bb) } }, {})))),

  // 5. PROACTIVE lighting where we work (dark, enclosed, torches on hand, calm).
  Guard(Cond('workspace.dark', bb => isDark(bb) && bb.st.surfaceExposed === false
                                   && haveTorches(bb) && bb.st.dangerState === 'calm'),
    Cooldown('cd.light', 15000, Do('light', bb =>
      dispatch(bb, 'maint.light', 80, { name:'lightArea', args:{ radius:5 } }, {})))),

  // 6. SELF-HEAL: re-assert the safe Movements profile (HANDOFF: it silently reverts and
  //    killed Marcel). Pure read+reapply, no task, cheap, every ~30s.
  Cooldown('cd.mv', 30000, Do('mv.reassert', bb => reassertMovements(bb) ? S_OK : S_FAIL)),

  // 7. STALE payload alarm: can't re-inject ourselves, but surface it loudly for the
  //    spawn-hook / driver and re-subscribe survival to __danger if that link dropped.
  Guard(Cond('stale', bb => bb.st.stale.length > 0),
    Cooldown('cd.stale', 20000, Do('stale.warn', bb => { warnStale(bb); return S_OK; }))),
]);
```

Any pair returning RUNNING/SUCCESS stops the subtree there; PROJECT never sees the frame
that tick. When all guards are FALSE, MAINTENANCE returns FAIL and PROJECT ticks.

### 7.3 PROJECT subtree (prio 50) — advance the assigned intent

Selector over known project *kinds*; the LLM set `bb.project.kind` + `params`. Each kind
is a small reactive Sequence of guarded dispatches. Unknown/none/done → FAIL (idle takes
over). Kit tier per kind feeds §7.2-4's restock.

```js
const PROJECT = Sel('project', [

  Guard(Cond('proj.none', bb => bb.project.kind === 'none' || bb.project.done),
        Do('proj.idlefall', () => S_FAIL)),   // explicit: no project ⇒ let idle run

  // --- mineTo: descend to lane depth, mine until banked, deposit when full, repeat ---
  Guard(Cond('proj.mineTo', bb => bb.project.kind === 'mineTo'),
    Seq('mineTo', [
      // descend only if above the working Y (self-correcting guard; re-descends if knocked up)
      Guard(Cond('need.descend', bb => bb.st.pos.y > bb.project.params.laneY + 2),
            Do('descend', bb => dispatch(bb, 'proj', 50,
                 { name:'safeDescend', args:{ toY: bb.project.params.laneY, torchEvery:8 } },
                 { deltaY: true }))),
      // mine a batch; completion when banked ≥ count (verified from inventory, not the skill)
      Guard(Invert('done?', Cond('banked.enough', bb => banked(bb, bb.project.params.target) >= bb.project.params.count)),
            Do('mine', bb => dispatch(bb, 'proj', 50,
                 { name:'mineLane', args:{ target: bb.project.params.target, count: 16,
                                           laneY: bb.project.params.laneY, vein: true } },
                 { bankedDelta: bb.project.params.target }))),
      Do('mineTo.done', bb => markDone(bb, `banked ${bb.project.params.count} ${bb.project.params.target}`)),
    ])),

  // --- stockWood ---
  Guard(Cond('proj.stockWood', bb => bb.project.kind === 'stockWood'),
    Seq('stockWood', [
      Guard(Invert('wood.done?', Cond('logs.enough', bb => banked(bb, '_log') >= bb.project.params.count)),
            Do('chop', bb => dispatch(bb, 'proj', 50,
                 { name:'chopTrees', args:{ types: bb.project.params.types || 'any', count: 2 } },
                 { bankedDelta: '_log' }))),
      Do('wood.done', bb => markDone(bb, `stocked ${bb.project.params.count} logs`)),
    ])),

  // --- build (single dispatch + verify) ---
  Guard(Cond('proj.build', bb => bb.project.kind === 'build'),
    Seq('build', [
      Do('build.run', bb => dispatch(bb, 'proj', 50,
           { name: bb.project.params.skill,           // buildWall|frameStructure|buildSchematic…
             args: bb.project.params.args },
           { verifiedBuild: true })),
      Do('build.done', bb => markDone(bb, 'structure verified')),
    ])),

  // --- hunt / goTo / farmCycle(placeholder) ---
  Guard(Cond('proj.hunt', bb => bb.project.kind === 'hunt'),
    Do('hunt', bb => dispatch(bb, 'proj', 50,
         { name:'huntAnimals', args:{ species: bb.project.params.species, count: bb.project.params.count } },
         {}))),
  Guard(Cond('proj.goTo', bb => bb.project.kind === 'goTo'),
    Seq('goTo', [ Do('goto', bb => dispatch(bb, 'proj', 50,
         { name:'come', args:{ ...bb.project.params, range:2 } }, { arriveNear: bb.project.params })),
      Do('goTo.done', bb => markDone(bb, 'arrived')) ])),
]);
```

Two rules make the project robust and honest:

- **Completion is verified from the world, not claimed by the skill.** `banked()` counts
  `bot.inventory.items()`; `markDone` sets `bb.project.done=true`, chats one `!project
  done` line, and returns SUCCESS. This is Law 1 ("verifier or it didn't happen") applied
  at the agenda level — a skill under-producing (`yield<1 ∧ ok`) does not falsely complete
  the project, it just loops again.
- **A project that FAILs with a code the upper subtrees can fix does not stall.** The
  dispatch bridge left the typed code on `bb.lastFail`; the project Sequence returns FAIL;
  next tick maintenance/survival handles it; the tick after, the project re-dispatches into
  a fixed world. Only a code *nothing* can self-heal (`not_found`, `no_path` after retries,
  `bad_input`) latches `bb.project.blocked = code` — the **one** place the LLM re-enters:
  it polls `snapshot().project.blocked`, re-plans, and calls `setProject` again.

### 7.4 IDLE subtree (prio 10) — deterministic role-default, always SUCCESS

Replaces `idleguard.work()`. Surface-only, never-descend (reuses idleguard's exact
constraints: `surfaceExposed` / `skyLight>0`, `notBelow = y ≥ feet-5`). Always returns
SUCCESS so the root Selector never falls off the end (the bot is never truly idle).

```js
const IDLE = Sel('idle', [
  // never wander off the surface into the dark
  Guard(Cond('idle.dark', bb => bb.st.surfaceExposed === false),
        Do('idle.hold', bb => holdAtHome(bb))),   // stand by near home; SUCCESS
  Guard(Cond('role.lumberjack', bb => bb.role === 'lumberjack'),
        Do('idle.chop', bb => dispatch(bb, 'idle', 10, surfaceChopSpec(bb), {}))),
  Guard(Cond('role.miner', bb => bb.role === 'miner'),
        Do('idle.mine', bb => dispatch(bb, 'idle', 10, surfaceMineSpec(bb), {}))),
  Guard(Cond('role.hunter', bb => bb.role === 'hunter'),
        Do('idle.hunt', bb => dispatch(bb, 'idle', 10, grassOrHuntSpec(bb), {}))),
  // default / builder / anything: sweep stray drops (house rule: never leave drops)
  Do('idle.sweep', bb => dispatch(bb, 'idle', 10, { name:'collectDrops', args:{ radius:24 } }, {})),
]);
```

The idle dispatches are honest, low-priority tasks; the moment any higher need appears
they are preempted by §5's `prio` comparison. Idle work also naturally suppresses
idleguard because every dispatch keeps `__skills` busy and `S.enqueue`/`_pump` call
`pauseIdleGuard(20000)` — but we additionally neuter `idleguard.work` at install (§11.3)
so there is exactly one idle decider.

---

## 8. Reactive self-heal — three worked frames

**Tool breaks 40 blocks down a lane.** `mineLane` halts with `no_tool` →
`queueState='halted'`, `queueHalt.code='no_tool'`. Tick *t*: SURVIVAL FAIL (calm),
MAINTENANCE `tool.bad` guard passes (`haltCode==='no_tool'`) → `acquireTool` dispatched
(depot → craft chain), RUNNING. Ticks *t+1…*: RUNNING until the new pick is equipped →
SUCCESS. Tick *t+k*: MAINTENANCE all-FALSE, PROJECT `mineTo` re-dispatches `mineLane`
into a tool-equipped body. **Zero LLM, zero explicit error handler in the project code.**

**Creeper appears mid-mine.** dangerscan (250 ms) scores it → `__danger.state='panic'`
→ survival.js fires, `S.stop()`s the mine, runs CREEPER branch, `__survival.active=true`.
Next BT tick: SURVIVAL `reflex.active` guard passes → `defer.reflex` returns RUNNING,
`bb.cur=null`. The brain issues nothing while the reflex works. When survival recovers
(`active=false`), MAINTENANCE checks the bot (ate? tool? inv?), then PROJECT resumes.

**Bag fills during a chop.** `collectDrops` / `chopTrees` throws `inv_full` (fatal) →
task ends error. Tick: MAINTENANCE `inv.full` (`emptySlots<=1` or halt `inv_full`) →
`stow` dispatched → deposit → SUCCESS → PROJECT resumes. If the nearest chest is the
depot, `stow` also emits the DEPOT ledger line (resource-sharing rule) for free.

---

## 9. Preemption & safety

- **Cancellation is always clean.** Every preempt is `S.stop()` (or `S.skip()` to advance
  a queue), which sets `S._cancel` checked at `ctx.step()` boundaries — **never mid-dig**
  (skills.js invariant). No half-dug blocks, no orphaned goals (`S.start`'s `finally`
  clears the goal + stops digging).
- **The brain never double-drives.** It cannot start a second task (`busy` guard), and it
  never awaits the body itself. `bot.pathfinder` has exactly one owner at a time: the
  current task, the reflex, or nobody.
- **Priority monotonicity.** `prio` is fixed per subtree (survival 90–100, maint 80,
  project 50, idle 10). A running task is only preempted by a strictly higher prio. This
  prevents the classic BT flip-flop (two branches alternately preempting each other):
  equal-priority work is left to finish.
- **Reflex race.** The 1 s tick is deliberately slower than the 250 ms scan so survival
  always reaches a threat first; the tick's job is only to *not fight it* and to *pick up
  the pieces afterward*.

---

## 10. Decorators in practice (concrete tunings)

| decorator | where | value | reason |
|---|---|---|---|
| `Cooldown` | every maintenance action | eat 3 s, tool 8 s, stow 5 s, restock 10 s, light 15 s, mv 30 s, stale 20 s | stop re-dispatching a fix while its task or its effect is still settling; mirrors the queue's own 30 s fallback floor |
| `RetryUpTo` | wrap project dispatch leaves | n = 3, then latch `blocked` | absorb transient `path_GoalChanged`/`stuck`/`place_timeout` (all in HANDOFF) before bothering the LLM |
| `Once` | one-shot project steps (e.g. initial descend in a fixed shaft) | – | don't re-run a completed setup step every tick |
| `Guard` | pervasive | – | a leaf runs only when its predicate over real `st` holds; this is what makes the whole tree self-correcting |

---

## 11. Lifecycle, coexistence, reconnect

### 11.1 Install (idempotent, like every payload)
```js
if (globalThis.__agenda) { try { globalThis.__agenda.stop(); } catch(e){} }
const g = { version:1, role:'__ROLE__', enabled:true, bb, timer:null, ... };
globalThis.__agenda = g;
registerMaintenanceSkills();                 // S.define restockKit/acquireTool/eatNow/lightArea/goHome/stow (idempotent)
neuterIdleguardWork();                        // §11.3
g.timer = setInterval(tick, 1000);
const REG=(globalThis.__payloads=globalThis.__payloads||{});
REG.agenda={version:1, boundAt:Date.now(), stale:false};
bot.once('end',()=>{ REG.agenda.stale=true; g.enabled=false; clearInterval(g.timer); });
```

### 11.2 The tick guard (orphan-killer + staleness, copied from the proven payloads)
```js
function tick() {
  if (globalThis.__agenda !== g || !g.enabled) { clearInterval(g.timer); return; } // superseded
  if (!botAlive(bot)) return;                     // never decide on a dead bot object
  try {
    g.bb.now = Date.now();
    g.bb.st  = snapshot();                        // §2 — one consistent frame
    g.bb.stats.ticks++;
    ROOT.tick(g.bb);                              // one decision, ≤1 dispatch
  } catch (e) { pushLog('error','agenda tick: '+e.message); }
}
```
`botAlive` is skills.js's own predicate. On reconnect the payload's `bot` is dead →
`REG.agenda.stale=true`, the timer self-terminates on the `globalThis.__agenda!==g` /
`!g.enabled` check, and the runner spawn-hook re-injects a fresh `agenda.js` bound to the
new bot. `GET /state.stalePayloads` will name `agenda` in the gap, exactly like the others
— presence never implies liveness.

### 11.3 Coexistence with idleguard
`idleguard` keeps its useful low-level machinery (stall-buster that clears a movement-dead
goal, orphan-timer killer, external-activity tracking) but must not *decide* idle work.
At install, the brain sets `__idleguard.work = async()=>{}` (a no-op) if idleguard is
present, and logs it. The stall-buster already yields to a running `__skills` task
(idleguard v7 `taskRunning()`), so it will not fight the brain's dispatched tasks. If the
user prefers a hard split, `__idleguard.stop()` at install and rely solely on the brain's
IDLE subtree — but keeping the stall-buster is cheap insurance against the leaf_litter/
torch/chest-gap wedges catalogued in HANDOFF.

### 11.4 Coexistence with survival.js
No changes to survival.js. The brain only *reads* `__survival.active`/`.branch` and *may*
call `__survival.trigger('bt-env')` as an ENV backstop. survival.js already suspends the
guard and force-stops `__skills` on entry, and calls `__danger.clearPanic()` on recovery —
the brain observes all of it through the snapshot.

---

## 12. False-success handling — the brain's own verifier (Law 1)

`classifyOutcome(bb, t, expect)` runs when an owned task ends, and it does **not** trust
`t.done`. It first maps the terminal state to EVALUATION.md's outcome enum
(`death > disconnected > timeout > wedge > kit_missing > no_tool > … > false_success > ok`)
from `t.error.code`, then, for a *claimed success*, runs the cheap independent check named
in `expect`:

```js
function classifyOutcome(bb, t, expect) {
  if (t.error) { bb.lastFail = t.error; return t.error.code; }      // typed failure
  // t claims done — verify it against the WORLD, not the skill's word:
  if (expect.arriveNear && dist(bb.st.pos, expect.arriveNear) > 3)  return falseSuccess(bb,'arrive');
  if (expect.emptiedSlots && bb.st.emptySlots <= 1)                 return falseSuccess(bb,'stow');
  if (expect.bankedDelta && !bankedRose(bb, expect.bankedDelta))    return falseSuccess(bb,'yield');
  if (expect.deltaY && Math.abs(bb.st.pos.y - bb._preY) < 1)        return falseSuccess(bb,'descend');
  return 'ok';
}
function falseSuccess(bb, why){ bb.stats.falseSuccess++; pushLog('warn','false_success:'+why); return 'false_success'; }
```

A `false_success` is treated as a FAIL by the bridge, so the leaf re-dispatches (up to the
`RetryUpTo` cap) instead of marking the project done on a lie. `bb.stats.falseSuccess` is
surfaced in `snapshot()` and is a HARD trigger in EVALUATION.md (FSR must be 0). This is
the design's answer to the false-success taxonomy: **the agenda is itself a verifier, and
it never advances on the system-under-test's own verdict.** (The full ASSERTS table stays
where EVALUATION.md puts it — in the eval harness; the brain's checks are the *runtime*
subset it needs to avoid looping on a lie.)

---

## 13. Quirk-survival checklist (mapped to LEARNING_HANDOFF)

Every quirk the brain could trip over is handled by *deferring to the primitive that
already handles it* rather than re-solving it:

| HANDOFF quirk | how the BT survives it |
|---|---|
| pathfinder `stop()` poisons next goto; orphaned goto → `path_GoalChanged` | brain never calls goto directly — all travel is `come`/skills, which use `ctx.goto`'s owned-token + `setGoal(null)` cleanup; `RetryUpTo(3)` absorbs the transient `GoalChanged` after reconnect |
| leaf_litter / torch-underfoot / chest-gap movement wedges | handled inside `ctx.goto` unstick ladder + idleguard stall-buster (kept); a `wedge`/`stuck` code just fails the leaf → retried |
| tools break silently, punch on at half speed | `tool.bad` guard on `st.held.dur<=15` + `no_tool` halt; user law "replacing a broken tool outranks the job" is `prio 80 > project 50` |
| Movements profile silently reverts (killed Marcel) | `mv.reassert` self-heal every 30 s reapplies safe knobs (maxDropDown 3, parkour off, sprint off) |
| `bot.openContainer` can't open furnaces; no internal timeout | never touched by the brain; deposit/withdraw use `depositToChest`/`withdrawFromChest` which race an 8 s timeout |
| craft-void / count>1 batches void items | `acquireTool`/`restockKit` go through `ctx.ensureTool`/`craftSafe` (one batch, 800 ms settle, count-verify) |
| chopTrees fells placed structure logs | idle/stock chop dispatch reuses chopTrees' own `ctx.isProtected` + `MAX_BELOW` + canopy guards; idle chop is surface-only near base |
| stale `blockAt` on remote chunks | the brain reads only *live* signals (`__danger`, inventory, `bot.entity.position`) — it never does remote terrain surveys; skills walk-then-scan |
| skyLight 0 under an overhang ≠ safe (LIGHT RULE) | uses `surfaceExposed` (geometry-backed) not y, exactly as dangerscan computes it |
| idle-guard fights driver for the goal | one decider: idleguard.work neutered; the brain owns idle |
| reconnect wipes payloads | staleness registry + spawn-hook re-inject (§11.2) |

---

## 14. Why a behavior tree — vs the ladder, vs utility AI

**The tree is a strict superset of the ladder.** GOAL.md's "deterministic priority
ladder — survival > self-maintenance > project advance > idle fallback" *is* the root
Selector (`Sel('root',[SURVIVAL,MAINT,PROJECT,IDLE])`). We concede nothing on legibility
or determinism — the top level reads identically. What a flat ladder cannot express is the
*inside* of each rung: a project is inherently multi-step and stateful (descend → mine →
deposit → repeat), and a maintenance need is a guarded sub-selector. In a ladder those
become hand-rolled `bb.phase` state machines and nested `if/elif` — exactly the tangle the
rule-of-twice says to extract. The tree gives Sequences + running-node memory + reusable
decorators (Cooldown/Retry/Once) as first-class structure, so a new behavior is a nested
node, not an edit to a monolithic chain. **More expressive, same determinism.**

**vs utility AI (score every option, argmax).** Utility AI shines when choices are soft
trade-offs on continuous axes. Our agenda is the opposite: the priorities are *laws*, not
preferences — survival ALWAYS outranks project; "a broken tool outranks the job" is a
verbatim user rule; FSR must be *0*. Encoding "always" in utility curves needs infinities
and careful normalization, and the resulting behavior is an *emergent* argmax over tuned
weights — the single hardest thing to audit and the exact Goodhart failure EVALUATION.md's
anti-Goodhart register warns about ("a regression shows up as: the weights drifted").
A Selector encodes "always" as *node order* — a reviewer reads the priority off the tree,
a diff shows a moved subtree, and the outcome is reproducible from `st` alone. Utility AI
also hides *why* it did something behind a score vector; the BT's decision is a path from
root to the leaf that fired, trivially loggable (`snapshot().cur.owner`) and trivially
testable (feed a synthetic `st`, assert the leaf). **More legible, more deterministic,
directly matches the codicil.**

Where utility *does* belong is one level down, *inside* a leaf — "which of five nearby
ores / which route / which chest" — and we already do that with deterministic argmin/argmax
in the skills (`findBlocks` nearest-first, `bestOwned` tool ranking). The BT arbitrates the
*needs*; small utility calculations resolve the *targets*. Best of both, each in its place.

**vs a raw async orchestrator loop.** A `while(true){ decide(); await act(); }` loop is the
tempting third option, but it reintroduces the four-loops-over-one-body hazard
(AUTONOMY_PLAN risk #1) and blocks the decision on the action. The BT's tick-decides /
queue-executes split (§5) keeps decision and execution decoupled and non-blocking, which is
why it composes with survival.js's reflex and the existing single-task mutex instead of
fighting them.

---

## 15. Determinism analysis (codicil compliance)

- **The tick loop is 100% deterministic** given a signal frame `st`: no randomness, no LLM,
  pure predicate evaluation and one synchronous dispatch. Same `st` → same leaf fires.
- **The LLM thinks exactly twice, at most:** (1) `setProject({kind,params})` — the
  high-level intent; (2) re-plan when `bb.project.blocked` latches a code nothing can
  self-heal (`not_found`, exhausted `no_path`). Steady-state autonomy runs with **zero**
  LLM calls — the AS-soak target (`think_share → 0`, `autonomy_ratio → 1`).
- **Residual non-determinism is all *below* the brain** and already characterized: skill
  timings, pathfinder route choice, mob spawns. The brain's *decisions* over those outcomes
  are deterministic; that is exactly the "code runs forever" half of the codicil.
- **Follow-up-to-deterministic (rule-of-twice):** the two LLM entry points are the honest
  residue. `setProject` is a genuine intent choice (fine to keep human/LLM). The
  `blocked`-replan path is a candidate for future determinization (e.g. a deterministic
  "relocate and retry `mineLane` elsewhere" policy for `not_found`) — filed as the follow-up
  per the codicil, not solved here.

---

## 16. How it's measured (ties to EVALUATION.md)

- **AS 8 h autonomy soak** (§2.6): `utilization = active_ms/wall_ms` (the brain should keep
  the body busy ≥95%), `idlePct ≤ 5%`, **`interventions L2+ = 0`**, **`tokens = 0`**,
  `staleAfterReconnect = 0`. `MTBI` / `T50` per activity class come from the ledger.
- **HARD triggers the brain must never cause:** `falseSuccess > 0` (guarded by §12),
  `protectedViolations` (skills' `ctx.isProtected` + digguard), `dropsLeft > 0` (house
  rule via `collectDrops`), `kit preflight accepting a half-kit` (the brain relies on it,
  never overrides `force`), unwarned tool break (`tool.bad` guard).
- **Test/drill hooks** (mirroring `__survival.runBranch`): `__agenda.setState(fakeSt)` +
  `__agenda.dryTick()` returns *which leaf would fire* without dispatching — a pure,
  N=1, zero-token fixture per FEEDBACK entry (Tier-0 suite, EVALUATION §4 Amendment 2):
  `agenda-tool-break-routes-to-maint`, `agenda-panic-defers-to-reflex`,
  `agenda-invfull-stows`, `agenda-project-blocked-latches`, `agenda-false-success-loops`,
  `agenda-idle-surface-only`. Each is a one-line assertion over `dryTick(st).owner`.
- **Telemetry emit points** (via `globalThis.__metrics` optional-chained, EVALUATION §3):
  a `note` event per preempt (`owner`, from→to), per `false_success`, per `blocked` latch.
  No new sampler, no chat lines.

---

## 17. Implementation checklist / phasing

1. **Node kernel** (§4, ~130 lines) — pure, unit-testable off-server.
2. **Maintenance micro-skills** (§3B) — `S.define(...)` wrappers; each is a re-export of an
   existing `ctx` primitive; ships with the ASSERTS entries the *other* engineer writes.
3. **`agenda.js` payload** (§11) — install/tick/snapshot/stop, staleness registry,
   idleguard-neuter, `setProject`/`dryTick`/`setState` hooks.
4. **The tree** (§7) + predicates (`envHazard`, `isDark`, `meleeOnly`, `banked`,
   `roleToolDur`, `projectTier`, `reassertMovements`, …) — all pure reads of §2.
5. **Bridge** (`dispatch`, `classifyOutcome`, §5/§12).
6. **Runner spawn-hook**: add `agenda.js` to the auto-inject list (SYNTHESIS P0.2) so it is
   engine-resident on every `bot.on('spawn')`, role-templated like idleguard.
7. **`GET /state`**: expose `__agenda.snapshot()` (current owner, project, blocked, stats).
8. **Tier-0 fixtures** (§16) before any soak.

Order matters only for 1→3→4→5; the micro-skills (2) and the runner/state wiring (6,7) are
independent and can land in parallel. No existing engine file's *logic* changes — only
additive `S.define` calls and one auto-inject list entry.

---

## 18. Open questions / residue

- **`bb.project.blocked` re-plan is the one LLM-in-the-loop path.** Acceptable for phase 1;
  flagged for determinization (§15).
- **Idleguard neuter vs stop** (§11.3) — keep the stall-buster (recommended) or hard-stop.
  A one-line config; defaults to neuter.
- **Restock geography.** §7.2-4 gates restock to "near depot or already halted" so the bot
  doesn't trek home for one torch mid-lane. The exact `distDepot` radius (24) and whether a
  *deep* project should pre-restock before descending is a tuning the AS soak will settle.
- **Project catalogue growth.** New project kinds are new PROJECT sub-Sequences; `farmCycle`
  is a placeholder until the farm skill lands (SYNTHESIS FC). The tree's shape makes this a
  localized addition, which is the whole expressiveness argument in §14.
```
