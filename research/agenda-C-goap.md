# Agenda C — GOAP needs-selector (means-ends brain)

Design for the driverless AUTONOMOUS AGENDA, architecture **C = GOAP**
(goal-oriented action planning). Ground truth read: `skills.js` v16 (registry +
queue + `ctx`), `idleguard.js` v7, `survival.js` v2, `dangerscan.js` v2,
`toolguard.js` v1, `runner.js` `GET /state`, `SYNTHESIS.md`, `EVALUATION.md`,
`LEARNING_HANDOFF.md`, `AUTONOMY_PLAN.md`, `protected.json`.

This is a **design only** — no engine code is changed here. The proposal is a new
injected payload `agenda.js` plus a short list of small engine additions it depends
on (§9).

---

## 0. TL;DR and the honest verdict up front

GOAP is **two layers, not one**, and only the second layer is really GOAP:

- **Layer A — maintenance ladder** (eat / retreat-before-panic / light / re-tool /
  deposit / restock). Each goal is a *shallow* condition with a ≤2-action plan. The
  planner over this layer is degenerate — it collapses to a **fixed priority ladder**.
  This layer is identical to what a plain ladder design (agenda-A) would ship. GOAP
  buys nothing here, and pretending otherwise would be dishonest.

- **Layer B — project planner** (advance the LLM-set project). This is real GOAP:
  **backward-chaining regression over a static resource/tech-tree graph**, producing
  the next macro-step, cached, replanned on failure. This is where means-ends
  reasoning earns its complexity — the "need iron pick → need iron → smelt → need ore
  + fuel → need to descend + mine" chain, and the cold-start bootstrap (spawn with
  nothing → full tool tree) that Phase-1's "everything a good human needs, ALONE"
  demands.

**Where GOAP earns its keep vs the ladder:** only when a project requires an
acquisition chain the bot must *bootstrap* rather than execute as one skill. If every
project is a single skill run to a target ("mine 64 iron", "build house_1 from stocked
mats"), Layer B degenerates to "run this skill until the target predicate holds" and
GOAP is over-engineered — the ladder wins on simplicity. If projects start cold (no
tools, no mats) or span the tech tree, the ladder cannot sequence them and GOAP is the
only one of the three architectures that can. Phase-1's stated bar (a fully
self-sufficient solo player) **includes cold-start**, so Layer B is justified — but the
report is explicit that ~80% of the value is Layer A (which is not GOAP) and the GOAP
machinery must stay small enough that it never becomes a liability against Layer A's
reflexes.

**The planner is cheap.** The action graph is ~20 nodes, depth ≤ 6, branching ≤ 3.
Memoized backward DFS resolves the frontier action in microseconds. **No per-cycle A\*
frontier search is needed or wanted** — a plan is computed once per goal and cached;
the tick loop only re-reads world state and checks whether the cached plan's next step
still applies. Replanning is event-driven (§6), not per-tick.

---

## 1. Boundaries: what the agenda owns vs what already owns itself

The engine already has autonomous layers. The agenda must **not** duplicate or fight
them; it sits *above* the reflexes and *below* nothing.

| Layer | Owner | Cadence | Agenda relationship |
|---|---|---|---|
| Acute combat / lava / drowning / creeper / HP<8 | `survival.js` (`__danger` subscription + HP backstop) | tick, ~4 Hz | **Yield completely.** Agenda never plans combat. It reads `__survival.active` / `__danger.state==='panic'` and stands down. |
| Auto-eat passive | `bot.autoEat` 3.3.6 | event | Agenda's FED goal is the *deliberative* backstop for when auto-eat is off/failing or food ran out — it does not micro-manage eating. |
| Right-tool-at-dig | `toolguard.js` (`bot.dig` choke) | per dig | Agenda's TOOLED goal *acquires* tools; toolguard *enforces* holding them. |
| Protected-block guard | `digguard.js` | per dig + planner | Agenda respects it via `ctx.isProtected`; never plans to break protected infra. |
| Task mutex + queue + kit preflight + stall recovery | `skills.js` | per task | Agenda is a **producer** for this engine: it calls `S.start` / `S.enqueue` and reads `S.status`. One task at a time is an invariant it honors. |
| Role-default idle work | `idleguard.js` v7 | tick, 5 s | **Subsumed.** Agenda's lowest band (IDLE-FALLBACK) *is* the role-default work; idleguard's autonomous `work()` is disabled when the agenda is present (§8). |

**Consequence:** the agenda is a *deliberative supervisor*, not a reflex. Reflexes run
at tick speed inside their own payloads; the agenda runs at ~1.5 s and is allowed to be
"slow" because anything time-critical is already handled below it.

---

## 2. World-state representation (bound to real `/state` + globals)

An `/eval` body sees `bot, mineflayer, pathfinder, goals, Vec3` and every
`globalThis.__*`. The agenda computes one **world-state snapshot `ws`** per tick from
the *live* bot object and the reflex payloads' published state — never from a cached
`/state` HTTP response (that can be one poll stale; the agenda runs in-process and reads
the source).

```js
// Constants pulled from the codebase so the brain and the reflexes agree by construction.
const FOODS   = /* skills.js FOODS set */;            // reuse via globalThis if exported, else inline copy
const FILLERS = /* skills.js FILLERS set */;
const ORE_ALIASES = /* skills.js ORE_ALIASES */;
const TOOL_LOW = 20;                                  // skills.js TOOL_LOW_PCT
const HOME = readHome();                              // protected.json .home -> {x:-3,y:111,z:4}
const DEPOT = readCfg().depot;                        // {minerals:[-5,111,3], wood:[-5,111,1], food:[-3,111,1], craftingTable:[-3,111,4]}

function readWorldState(bot) {
  const D = globalThis.__danger, SV = globalThis.__survival;
  const inv = bot.inventory.items();
  const sum = (pred) => inv.filter(pred).reduce((a, i) => a + i.count, 0);
  const p   = bot.entity.position;
  const held = D && D.held;                            // {name,count,dur%}  (dur may be absent for non-tools)

  return {
    // --- vitals ---
    hp:   bot.health,                                  // 0..20
    food: bot.food,                                    // 0..20

    // --- danger (reflex-published; degrade to calm if dangerscan absent) ---
    threat:      D ? D.state : 'calm',                 // 'calm' | 'alert' | 'panic'
    threatScore: D ? D.score : 0,
    nearestD:    (D && D.nearest) ? D.nearest.d : Infinity,
    panicOwned:  Boolean(SV && SV.active),             // survival.js is driving the body RIGHT NOW

    // --- environment ---
    y:              Math.floor(p.y),
    surfaceExposed: D ? D.surfaceExposed : null,       // true | false | null(unknown)
    light:          D ? D.light : null,                // block light 0..15 | null
    darkHere:       (D && typeof D.light === 'number') ? D.light < 8 : false,
    isDay:          Boolean(bot.time && bot.time.isDay),
    dHome:          dist(p, HOME),

    // --- inventory pressure ---
    freeSlots: bot.inventory.emptySlotCount(),         // 0..27+9
    invFull:   bot.inventory.emptySlotCount() <= 1,    // 1-slot margin so a dig can still bank

    // --- consumables (kit floor inputs) ---
    torches:   sum((i) => i.name === 'torch' || i.name === 'soul_torch'),
    foodItems: sum((i) => FOODS.has(i.name)),
    filler:    sum((i) => FILLERS.has(i.name)),

    // --- tools (durability% via dangerscan for held; recompute for owned) ---
    heldName:  bot.heldItem ? bot.heldItem.name : null,
    heldDur:   (held && typeof held.dur === 'number') ? held.dur : 100,
    tool: {                                            // best-owned tier per class, or null
      pickaxe: bestClass(inv, 'pickaxe'),              // {name,tier,dur} | null
      axe:     bestClass(inv, 'axe'),
      sword:   bestClass(inv, 'sword'),
    },

    // --- resource stock for the project planner (name -> count) ---
    stock: rollupStock(inv),                           // {oak_log:12, cobblestone:40, raw_iron:3, iron_ingot:0, coal:5, ...}
  };
}
```

`ws` is the **fact base** the planner regresses over. Everything the goal/plan code
needs is a field here; no goal function is allowed to read the bot directly (keeps the
snapshot the single source of truth per tick — the same discipline dangerscan uses).

**Gaps we are honest about:** `bot.time.isDay` is stock mineflayer and reliable;
`surfaceExposed`/`light` are dangerscan's geometry-backed reads (already hardened
against the stale-skyLight quirk, issue #18); `heldDur` is dangerscan's held-item
durability. `tool.*.dur` for *unheld* tools must be recomputed from
`it.durabilityUsed / maxDurability` (dangerscan only publishes the held item) — a
5-line helper, same math as `kitCheck`.

---

## 3. Goals (world-state conditions + urgency)

A **goal** is a standing condition the planner wants true. Each is a small object:

```js
// A goal: id, band (fixed priority tier), test (satisfied?), relevant (does it apply
// in this context?), urgency (dynamic bump within/above band), and plan (the Layer-A
// shallow planner, or a pointer to the Layer-B project planner).
{
  id: 'FED',
  band: 80,
  relevant: (ws) => true,
  test:     (ws) => ws.food >= 18,                         // natural regen needs >=18
  urgency:  (ws) => ws.food <= 6 ? 40 : (ws.food < 14 ? 10 : 0),
  plan:     (ws) => planFed(ws),                           // returns an ACTION or a blocked/nop
}
```

### 3.1 The band table (survival > maintenance > project > idle)

Bands are fixed integers; `effectivePriority = band + urgency(ws)`. Bands are spaced by
100 so urgency (0–40) reorders **within** a tier but a hungry bot never outranks a
retreating one. All thresholds trace to existing engine constants.

| Band | Goal | `test` (satisfied when…) | Actionable plan (Layer A) |
|---|---|---|---|
| **1000** | `SURVIVE` | `!ws.panicOwned && ws.threat!=='panic'` | **none — yield.** Sentinel that makes the agenda stand down while survival.js drives. |
| **900** | `DE_ESCALATE` | `ws.threat!=='alert'` (pre-panic) | Retreat toward light/home *before* score crosses 5 into survival.js's domain: `come` to nearest lit safe cell or `HOME` if `dHome<=40`; stop project. Hysteresis: only fires from `alert`, clears at `calm`. |
| **300** | `FED` | `ws.food >= 18` | Layer A: eat held food (auto-eat backstop) → else `HAVE(food)` via hunt/harvest chain (defers to project planner's food sub-graph). |
| **250** | `UNBURDENED` | `!ws.invFull` | Layer A: `depositToChest {pos: DEPOT.minerals}` (or nearest). Full inventory *blocks* the collect-drops law and stops mining — high band. |
| **220** | `TOOLED` | project's required tool present AND `dur > TOOL_LOW` | Layer A: `ensureTool(cls)` (engine already chains depot→craft→gather). If broken mid-project, this preempts. |
| **200** | `LIT` | `!(ws.darkHere && ws.surfaceExposed===false)` | Layer A: place a torch at feet/wall via a one-block `lightSpot` action; if out of torches, escalate to STOCKED. |
| **150** | `STOCKED` | kit floor for the project's excursion tier met (`kitCheck` clean) | Layer A: restock trip — `withdrawFromChest` torches/food/filler from DEPOT, else craft/gather. Runs at base, between excursions. |
| **100** | `PROJECT` | project goal predicate holds (e.g. `stock.diamond >= 3`) | **Layer B: backward-chaining project planner** (§4). The only non-degenerate planner. |
| **10** | `IDLE_FALLBACK` | never (always "unsatisfied", lowest band) | Role-default useful work — the current idleguard behavior, re-homed here: lumberjack→chop, miner→mine surface stone/coal, else sweep drops. |

### 3.2 Selection algorithm (deterministic)

```js
function selectGoal(ws) {
  if (ws.panicOwned || ws.threat === 'panic') return null;      // SURVIVE sentinel: yield
  const active = GOALS
    .filter((g) => g.relevant(ws) && !g.test(ws))               // unsatisfied + applicable
    .map((g) => ({ g, pri: g.band + g.urgency(ws) }))
    .sort((a, b) => b.pri - a.pri);
  for (const { g } of active) {
    const action = g.plan(ws);                                  // may be nop/blocked
    if (action && action.kind === 'ACTION') return { goal: g.id, action };
    if (action && action.kind === 'BLOCKED') noteBlocked(g, action);  // e.g. escalate
  }
  return { goal: 'IDLE_FALLBACK', action: idleAction(ws) };
}
```

Top-down, first *actionable* goal wins. A goal that is unsatisfied but whose plan is a
no-op (e.g. LIT wants a torch but the bot is mid-air with no reference block) is skipped
so a lower goal can still make progress — this is the mechanism that keeps the bot
productive instead of freezing on an impossible high goal (a real failure mode: a bot
stuck "trying to light" forever). A goal that is unsatisfiable *and* important (STOCKED
with an empty depot, PROJECT blocked with no tech path) raises the **LLM escalation**
(§7), the one sanctioned "think again" exit.

**Why this reads as a ladder:** for Layer A it *is* a ladder — and that is correct.
GOAP's generality is deliberately unused there. The GOAP machinery is confined to
`PROJECT.plan`.

---

## 4. Layer B — the project planner (this is the actual GOAP)

### 4.1 Goal shape (LLM sets exactly this, once)

The LLM's *only* per-project input is a target predicate + optional params:

```js
// set via a new POST /agenda {goal:{...}}  (or __agenda.setGoal(...))
project = {
  kind: 'HAVE',        target: 'diamond',      qty: 3          // acquire N of an item
  // kind: 'HAVE',     target: 'iron_pickaxe', qty: 1
  // kind: 'MINE',     target: 'iron_ore',     qty: 32         // bank N of a resource
  // kind: 'BUILD',    blueprint: 'house_1',   chest: {x,y,z}  // build a structure
  // kind: 'DESCEND',  toY: -54                                // reach a depth
  // kind: 'FARM',     crop: 'wheat'                           // (phase-1 stretch) run a farm cycle
}
```

`project.test(ws)` is a pure predicate over `ws` (`ws.stock.diamond >= 3`;
`blueprintVerified('house_1')`; `ws.y <= toY`). The planner's job: return the next
macro-action that moves `ws` toward `project.test` becoming true.

### 4.2 The resource / tech-tree graph (`SOURCES`)

The GOAP action model expressed as a **regression graph**: for each obtainable thing,
the ways to get it, each with resource preconditions, an executable skill, and effects.

```js
// Each source: { how, needs:{resource:qty}, requires:[flags], skill(ws)->{name,args}, yields:{resource:qty}, cost(ws) }
const SOURCES = {
  // ---- raw gathering (leaves of the tree; skills already exist) ----
  oak_log:      [{ how:'chop',  needs:{}, requires:['tool:axe?'],
                   skill:(ws,n)=>({name:'chopTrees',  args:{types:'any', count:Math.ceil(n/4)}}),
                   yields:{oak_log:4}, cost:()=>60 }],
  cobblestone:  [{ how:'mine',  needs:{}, requires:['tool:pickaxe'],
                   skill:(ws,n)=>({name:'mineLane',   args:{target:'stone', count:n}}),
                   yields:{cobblestone:1}, cost:()=>40 }],
  coal:         [{ how:'mine',  needs:{}, requires:['tool:pickaxe'],
                   skill:(ws,n)=>({name:'mineLane',   args:{target:'coal_ore', count:n}}),
                   yields:{coal:1}, cost:()=>50 }],
  raw_iron:     [{ how:'mine',  needs:{}, requires:['tool:pickaxe>=stone','depth:iron'],
                   skill:(ws,n)=>({name:'mineLane',   args:{target:'iron_ore', count:n, allowDeep:true}}),
                   yields:{raw_iron:1}, cost:()=>80 }],
  diamond:      [{ how:'mine',  needs:{}, requires:['tool:pickaxe>=iron','depth:diamond'],
                   skill:(ws,n)=>({name:'mineLane',   args:{target:'diamond_ore', count:n, allowDeep:true}}),
                   yields:{diamond:1}, cost:()=>120 }],
  raw_beef:     [{ how:'hunt',  needs:{}, requires:['tool:sword?'],
                   skill:(ws,n)=>({name:'huntAnimals',args:{species:['cow'], count:n}}),
                   yields:{raw_beef:1}, cost:()=>60 }],

  // ---- crafting (delegated to ctx.craftSafe via a craftItems skill, §9) ----
  oak_planks:   [{ how:'craft', needs:{oak_log:1}, requires:[],
                   skill:(ws,n)=>({name:'craftItems', args:{item:'oak_planks', count:n}}),
                   yields:{oak_planks:4}, cost:()=>5 }],
  stick:        [{ how:'craft', needs:{oak_planks:2}, requires:[],
                   skill:(ws,n)=>({name:'craftItems', args:{item:'stick', count:n}}),
                   yields:{stick:4}, cost:()=>5 }],
  stone_pickaxe:[{ how:'craft', needs:{cobblestone:3, stick:2}, requires:['table'],
                   skill:()=>({name:'ensureTool', args:{spec:'pickaxe'}}),  // engine owns the micro-chain
                   yields:{stone_pickaxe:1}, cost:()=>15 }],
  iron_pickaxe: [{ how:'craft', needs:{iron_ingot:3, stick:2}, requires:['table'],
                   skill:(ws)=>({name:'craftItems', args:{item:'iron_pickaxe', count:1}}),
                   yields:{iron_pickaxe:1}, cost:()=>15 }],

  // ---- smelting (needs a smeltItems skill, §9 — no smelt skill exists today) ----
  iron_ingot:   [{ how:'smelt', needs:{raw_iron:1, fuel:0.125}, requires:['furnace'],
                   skill:(ws,n)=>({name:'smeltItems', args:{input:'raw_iron', count:n, fuel:'coal'}}),
                   yields:{iron_ingot:1}, cost:()=>10 }],

  // 'fuel' is an abstract resource satisfied by coal (1 coal = 8 smelts) or planks.
};
```

Notes that keep this honest and small:

- **Crafting micro-chains are delegated, not re-planned.** `ensureTool('pickaxe')`
  already does depot→craft→gather-wood→place-table internally and idempotently
  (`skills.js` `S.ensureTool` / `craftToolChain`). The graph leans on it rather than
  re-deriving "5 planks not 3" logic the engine already got right. GOAP plans the
  *coarse* steps (mine ore, descend, smelt, chop bulk); the engine owns the fine ones.
- The graph is **static data** — no learning, no LLM. Adding a tech branch is one entry.
- `requires` flags (`tool:pickaxe>=stone`, `depth:iron`, `furnace`, `table`) are checked
  against `ws` and, when unmet, become **sub-goals** the regression expands.

### 4.3 Depth-as-precondition (the safeDescend link)

`depth:iron`/`depth:diamond` map to Y-bands (`iron` ≈ y −24..56, richest ~y16;
`diamond` ≈ y −59..−54). The regression satisfies an unmet depth flag by emitting a
`safeDescend {toY}` macro-step, then mineLane runs with `allowDeep:true` /
`laneY:targetY`. This is the concrete "need ore → need to be deep → dig a staircase"
chain that no ladder can express and GOAP does naturally.

### 4.4 The planner (backward-chaining regression, memoized)

```js
// Returns the FRONTIER macro-action: the first executable step whose own needs/requires
// are already met. Pure over ws + SOURCES; bounded depth; memoized per call.
function planProject(ws, project) {
  if (project.test(ws)) return { kind:'SATISFIED' };

  const seen = new Set();                                         // cycle guard
  function resolve(resource, qty, depth) {
    if (depth > 8) return { kind:'BLOCKED', reason:'too_deep' };
    if ((ws.stock[resource] || 0) >= qty) return { kind:'SATISFIED' };
    const tag = resource + '#' + depth;
    if (seen.has(resource)) return { kind:'BLOCKED', reason:'cycle:'+resource };
    seen.add(resource);

    const options = SOURCES[resource];
    if (!options) return { kind:'BLOCKED', reason:'no_source:'+resource };

    // choose cheapest option whose FLAG requirements can be met (or expanded)
    let best = null;
    for (const opt of options.sort((a,b)=>a.cost(ws)-b.cost(ws))) {
      // 1) expand unmet resource inputs first (deepest missing leaf surfaces)
      for (const [inRes, per] of Object.entries(opt.needs)) {
        const needQty = Math.ceil(per * qty / yieldPer(opt, resource));
        const sub = resolve(inRes, needQty, depth+1);
        if (sub.kind === 'ACTION')  return sub;                   // a missing input is the frontier
        if (sub.kind === 'BLOCKED') { best = best || sub; continue; }
      }
      // 2) expand unmet FLAG requirements (tool tier / depth / furnace / table)
      const flag = firstUnmetFlag(opt.requires, ws);
      if (flag) {
        const fa = planFlag(flag, ws, depth+1);                   // -> ACTION (ensureTool/safeDescend/placeFurnace) or BLOCKED
        if (fa.kind === 'ACTION')  return fa;
        if (fa.kind === 'BLOCKED') { best = best || fa; continue; }
      }
      // 3) inputs + flags all satisfied -> THIS source is executable now
      return { kind:'ACTION', action: opt.skill(ws, qty - (ws.stock[resource]||0)), source: opt.how, resource };
    }
    return best || { kind:'BLOCKED', reason:'exhausted:'+resource };
  }

  // project 'MINE'/'HAVE' regress on the target; 'BUILD'/'DESCEND' have direct actions
  if (project.kind === 'DESCEND') return descendStep(ws, project.toY);
  if (project.kind === 'BUILD')   return buildStep(ws, project);   // ensure mats via resolve(), then buildSchematic
  return resolve(project.target, project.qty, 0);
}
```

Properties:

- **Frontier-only.** It returns *one* action — the deepest currently-executable leaf —
  never a full plan. After that action runs, the agenda re-reads `ws` and calls
  `planProject` again. This is **continuous replanning by construction**: the plan
  never goes stale because it is never stored. The world *is* the plan state.
- **Deterministic tie-break.** `cost(ws)` orders options; within equal cost, source
  declaration order. Same `ws` → same action, always (rule-of-twice friendly, testable).
- **Bounded & cheap.** ≤ 8 recursion depth, ≤ ~20 nodes, memoized via `seen`. Runs in
  microseconds; safe to call every tick, though we only call it when idle or on a
  replan trigger (§6).

### 4.5 Is A\* affordable each cycle? — the honest answer

**We don't use A\*, and shouldn't.** A\* buys optimal-cost paths over a large state
space with many interchangeable routes. Our graph is a shallow **acyclic tech tree**
where each resource has 1–2 obtain-methods; there is essentially one sensible route to
"3 iron ingots". Greedy cheapest-option backward DFS *is* optimal here for a fraction of
the code and zero frontier bookkeeping. If a future project introduced genuine route
choice (nether vs overworld iron; buy-from-villager vs mine), we'd add a cost-ranked
option list — still handled by the `sort((a,b)=>a.cost-b.cost)` line, still not A\*.
Caching question moot: nothing to cache because we compute the frontier action fresh and
it's already sub-millisecond. **Verdict: full A\* over skills is over-engineering; the
memoized regression is right-sized.**

---

## 5. Action dispatch — driving the existing engine

The agenda is a **producer** for the `skills.js` task engine, honoring its one-task
mutex. It does **not** pre-enqueue whole plans (they'd go stale); it issues **one
action, waits for its terminal state, verifies the effect, re-plans**.

```js
async function dispatch(sel, ws) {
  const S = globalThis.__skills;
  const a = sel.action;                                          // {name, args}

  if (a.name === 'ensureTool')  { await S.ensureTool(bot, a.args.spec); return; }  // primitive, not a task
  if (a.name === 'lightSpot')   { await ctxlessTorch(bot); return; }               // one-block, no task needed

  // everything else is a registered skill -> start it, tagged as agenda-owned
  const before = snapshotStock(ws);
  const r = S.start(bot, a.name, a.args, { agenda: true });      // §9: S.start honors an `agenda` tag
  if (!r.ok) return noteFailure(sel, r.error);                   // busy/kit_missing/bad_args -> replan
  // the agenda's tick loop now watches S.currentTask; it does NOT block here.
}
```

**Effect verification (false-success firewall).** When the task reaches terminal state,
the agenda does **not** trust `task.done`. It re-reads `ws` and checks the *expected
resource delta*:

```js
function verify(sel, wsBefore, wsAfter) {
  const exp = sel.action.__expectYield;                         // e.g. {raw_iron:+32}
  for (const [res, want] of Object.entries(exp)) {
    const got = (wsAfter.stock[res]||0) - (wsBefore.stock[res]||0);
    if (got < want * 0.5) return { progressed:false, res, want, got };   // yield<1 -> under-production
  }
  return { progressed:true };
}
```

`mineLane` returning `ok` with `banked: 3/32` is exactly the `yield<1 ∧ ok` case
EVALUATION §2.1 calls `under_prod_rate`. The agenda treats *no measurable progress* as a
failed step and replans (possibly with a different source or an LLM escalation after N
no-progress attempts) — it never loops re-issuing a step that banks nothing. This is the
single most important design property for scoring FSR = 0 and avoiding the "busy but
accomplishing nothing" soak failure.

### 5.1 Preemption (agenda interrupts its own project for a maintenance need)

While a PROJECT task runs, a maintenance goal can rise (inventory fills, tool breaks,
night falls with mobs, food craters). The agenda's tick loop re-evaluates `selectGoal`
every 1.5 s even with a task running:

```js
if (S.currentTask && S.currentTask.running && currentTask.__agenda) {
  const sel = selectGoal(ws);
  if (sel && band(sel.goal) > band(runningGoal) + PREEMPT_MARGIN) {   // strictly higher tier
    S.stop('agenda-preempt: ' + sel.goal, { keepQueue:false });       // its own task only
    // next idle tick issues the maintenance action; project resumes automatically after
  }
}
```

Rules that stop thrash:

- **Only preempt for a strictly-higher band** (`PREEMPT_MARGIN` ≥ 100 so urgency alone
  never preempts). UNBURDENED (250) preempts PROJECT (100); FED (300) preempts a deposit
  run only if it *also* out-bands it — it does.
- **Never preempt a survival/driver task** — the `__agenda` tag gates this; a task the
  agenda didn't start is a driver override and is left alone (respects the existing
  idleguard "external activity" doctrine).
- **The `queue_thrash` guard already exists** (`skills.js` THRASH_N=12 in 10 s → halt) as
  a backstop if preemption logic ever oscillates; the agenda additionally rate-limits its
  own re-issues (min 3 s between starts of the same goal).

### 5.2 Resume is free

Because the project planner is frontier-only and stateless, "resume the project" is not a
special path — after the maintenance action completes, the next idle tick simply calls
`planProject` again and gets the same next step (or a further one if the maintenance
action also advanced things, e.g. depositing freed slots and banked nothing new so the
same mine step recurs). No plan pointer to restore, nothing to invalidate.

---

## 6. Replan triggers (event-driven, not per-tick)

Because the frontier action is recomputed each dispatch, "replanning" is implicit. The
*explicit* triggers are the conditions under which the agenda re-runs `selectGoal` /
`planProject` **between** task boundaries:

| Trigger | Source signal | Response |
|---|---|---|
| Task terminal | `S.status().task.running` false-edge | verify effect (§5), select next goal |
| Task failure | `task.error.code` | typed handling: `not_found`→try alt source / widen; `no_tool`→TOOLED; `kit_missing`→STOCKED; `inv_full`→UNBURDENED; `timeout`/`stuck`/`no_path`→retry-once-then-escalate |
| No measurable progress | `verify().progressed===false` | count against `noProgress[goal]`; ≥3 → LLM escalation for that goal |
| Danger rises to `alert` | `__danger.state` change (poll each tick) | DE_ESCALATE outranks; preempt project |
| Danger `panic` / `__survival.active` | reflex owns body | **hard yield**; resume only after `__danger` returns to `calm` and `__survival.active` false |
| Tool crosses `TOOL_LOW` | `ws.heldDur <= 20` / owned tool low | TOOLED preempts at next boundary (dangerscan already logs `tool_low`) |
| Night + surface + mob-band | `!ws.isDay && ws.surfaceExposed && score↑` | bias toward indoor/underground project steps or DE_ESCALATE; do not start a fresh open-surface excursion |
| Windfall / loss | `ws.stock` delta unrelated to expected | recompute (e.g. found a diamond vein → project may already be `SATISFIED`) |
| Goal changed | LLM `POST /agenda` | drop `noProgress`, replan from scratch |
| Watchdog | every 30 s even if "busy" | sanity re-select; catches a wedged task the skill's own timeout hasn't yet cut |

There is **no periodic full re-plan cost** because there is no stored plan — the 1.5 s
tick's `readWorldState` + `selectGoal` is the whole recurring cost (a few hundred
microseconds), and `planProject` only runs when PROJECT is the selected band.

---

## 7. The one LLM touchpoint (determinism codicil compliance)

Per the codicil ("the LLM thinks once, code runs forever"), the LLM is in the loop in
exactly **two** places, both edge-triggered, never per-cycle:

1. **Project intent (once per project).** `POST /agenda {goal:{...}}` sets
   `project`. That's the "think once." Everything after is deterministic.
2. **Blocked-goal escalation (rare).** When a goal is important-and-unsatisfiable —
   `PROJECT` returns `BLOCKED` with `no_source`/`cycle`/`exhausted`, or `STOCKED` finds
   an empty depot, or `noProgress[goal] >= 3` — the agenda does **not** spin. It emits a
   structured escalation (chat line + `__agenda.blocked` in `/state`) and drops to
   IDLE_FALLBACK so the bot stays productive while a human/driver LLM decides. This is
   the sanctioned "when something HAS to go through an LLM, do it — then ask how to make
   it deterministic." Each escalation is a candidate new `SOURCES` entry (e.g. "no iron
   reachable here" → add a "relocate/branch-mine" source), converting the escape into
   engine data over time. The escalations are the **feedback backlog** the FEEDBACK
   doctrine wants: propose the engine gate, not the driver rule.

Both are logged so `think_share` (EVALUATION §2.8) can be measured and driven toward
zero across sessions.

---

## 8. Integration & injection (a new `agenda.js` payload)

Same shape as `dangerscan.js` / `survival.js`: idempotent, orphan-guarded, stale-on-end,
registered in `__payloads`.

```js
if (globalThis.__agenda && globalThis.__agenda.restore) { try { globalThis.__agenda.restore(); } catch(e){} }
const g = { version:1, enabled:true, tickMs:1500, project:null, runningGoal:null,
            noProgress:{}, blocked:null, lastStart:0, ... };
globalThis.__agenda = g;
// ... readWorldState / SOURCES / GOALS / selectGoal / planProject / dispatch ...
g.timer = setInterval(tick, g.tickMs);   // orphan-killer + stale guard identical to dangerscan
```

**Injection order** (extend `runner.js` P0.2 auto-inject / `inject.sh`):
`skills.js → dangerscan.js → survival.js → toolguard.js → digguard.js → idleguard.js →
**agenda.js**` (last — it reads all the others' published state). Re-inject on every
spawn/reconnect (the keystone rule; agenda holds no live bot ref outside a tick, reads
`bot` fresh each tick like the others).

**Idleguard relationship.** The agenda **subsumes** idleguard's autonomous `work()`. On
install, `agenda.js` sets `__idleguard.enabled = false` for its *work* loop (or a new
`__idleguard.workDisabled = true` flag, §9) while leaving idleguard's stall-buster and
external-activity tracking harmless. Rationale: two payloads both deciding "what to do
when idle" would fight over `bot.pathfinder` exactly like the FEEDBACK "idle-guard stomps
driver goals" incident. The agenda's IDLE_FALLBACK band *is* the role-default work, so no
capability is lost. If the agenda is ever removed, re-injecting `idleguard.js` restores
the old behavior.

**Driver coexistence.** A driver issuing a manual skill (`task.sh start …`) creates a
task without the `__agenda` tag. The agenda sees a running non-agenda task and yields
(same test idleguard uses). When the driver's task ends and the driver goes quiet, the
agenda resumes at the next tick — the driverless and driver-assisted modes are the same
code path, which is what Phase-1 acceptance ("driverless … staying productive for hours")
requires.

---

## 9. Required engine additions (small; the agenda depends on these)

The agenda is a payload, but Layer B needs three things the registry lacks today. Each is
a thin wrapper over an existing primitive — **honest gaps, flagged, not hidden**:

1. **`craftItems` skill** — registered wrapper over `S.craftSafe(bot, item, count, {table})`
   with a table-locate/place preflight (reuse `craftToolChain`'s table logic). Needed
   because `craftSafe` is a primitive, not a queueable skill; the project graph's `craft`
   sources call it. ~30 lines.
2. **`smeltItems` skill** — **there is no smelting anywhere in the engine today.** Must use
   `bot.openFurnace(block)` (LEARNING_HANDOFF: `openContainer` *cannot* open a furnace —
   hard-won quirk), load input + fuel, wait for output, collect. Needed for the entire
   `raw_iron → iron_ingot → iron_pickaxe` spine (the canonical GOAP chain). ~60 lines. This
   is the single biggest prerequisite and should be built first — without it, GOAP's iron
   tier is a dead branch.
3. **`agenda` task tag in `S.start`** — one field on the task object
   (`task.__agenda = Boolean(_q && _q.agenda)`) so the agenda can distinguish its own
   tasks from a driver's for preemption/yield. ~2 lines. (Alternatively reuse the existing
   `fallback`/`quiet` mechanism.)

Optional but recommended, and independently on the SYNTHESIS roadmap (P4.13):
`lightSweep` (room lighting) and a **cavity-breach hook** so a project mine step lights or
walls an opened air pocket before stepping in — the agenda would prefer these to keep
`darkExposureS`/`hostileExposureS` (EVALUATION §2.5 near-miss surrogates) low.

Nothing in `agenda.js` requires changing `survival.js`, `dangerscan.js`, or the queue
core — it composes over their public surfaces (`__danger.state/held/light`,
`__survival.active`, `S.start/status/stop/ensureTool/kitCheck`).

---

## 10. Failure modes from LEARNING_HANDOFF the brain must survive

The quirk catalog is the acceptance test for "does the brain stay alive." The agenda
does not re-solve these (the skills already do) but must not *re-trigger* them:

- **Idle-guard vs pathfinder goal fights** → agenda owns idle time exclusively (§8); it
  never runs a `goto` while a skill task is active (it yields on any running task).
- **Tools break silently mid-task** → TOOLED band + `ws.heldDur`/dangerscan `tool_low`;
  the agenda banks/replaces before break, and on a `no_tool` failure re-tools rather than
  looping. (Directly answers the BuddelBernd double-pickaxe-exhaustion death.)
- **Descend eats the pickaxe on false "reached"** → `safeDescend`'s own `no_descent`
  tripwire handles it; the agenda's *effect verification* (§5) catches the outer symptom
  (Δy ≈ 0 after a DESCEND step) and stops re-issuing.
- **`craft` desync voids items** → delegated to `craftSafe` (800 ms settle + count-verify)
  via `craftItems`; the agenda never calls `bot.craft` directly.
- **Furnace can't be opened with `openContainer`** → `smeltItems` uses `openFurnace` (§9).
- **Two-chest / narrow-gap hard wedge** → the agenda prefers `DEPOT.minerals` (a single
  chest) and never plans a stand-between-two-chests deposit; if a skill wedges, the skill's
  own stall ladder + timeout + the agenda's 30 s watchdog cut it.
- **Ravine/3D-sphere target selection** → all mine/chop skills already gate `MAX_BELOW`;
  the agenda passes `allowDeep` only when it *deliberately* emitted a `safeDescend` first,
  matching intent to permission.

---

## 11. Evaluation hooks (how this scores on the soak)

Designed to be measured by EVALUATION's frozen metrics without new instrumentation beyond
`telemetry.js`:

- **`autonomy_ratio` / MTBI (§2.6):** every action carries `__agenda`, so
  `engine-executed / total` and L2+ interventions are countable directly. Target: hours of
  `IDLE_FALLBACK`-or-better with 0 L2 interventions.
- **`FSR` / `under_prod_rate` (§2.1):** the effect-verification firewall (§5) is exactly
  the mechanism that keeps the agenda from *counting* a false-success as progress; it
  should drive agenda-attributed FSR to 0.
- **`utilization` (§2.6):** the ladder guarantees the bot is always executing the
  highest-value *actionable* goal; the only idle is the 1.5 s tick gap and deliberate
  yields to survival.
- **Near-miss surrogates (§2.5):** LIT/DE_ESCALATE/STOCKED exist specifically to hold
  `darkExposureS`, `hostileExposureS`, `panicEntries` down — the agenda's success is
  fewer survival.js `fires`, not more heroics.
- **Fault-injection drills (§2.5):** tool-loss mid-mine → TOOLED recovery; wedge at feet →
  skill stall ladder + watchdog; `bot.quit()` mid-task → reconnect + re-inject + resume
  (stateless planner makes this trivial); food void → FED. Each maps to an agenda band, so
  MTTR is a per-band number.

---

## 12. Honest cost/benefit summary (GOAP vs the ladder vs a behavior tree)

| Dimension | GOAP (this design) | Priority ladder (A) | Behavior tree (B) |
|---|---|---|---|
| Maintenance layer | A **fixed ladder falls out** of the band table — same as A | Native | Native |
| Cold-start bootstrap (spawn→tools→iron→diamond) | **Yes — regression graph sequences it** | No (can't chain) | Painful (hand-wire every branch) |
| Adding a tech branch | 1 `SOURCES` entry (data) | N/A | New subtree + wiring |
| Per-cycle cost | ~sub-ms; frontier-only, no A\* | trivial | trivial |
| Failure recovery | implicit (stateless replan) | manual per rule | manual per node |
| Lines of new code | moderate (graph + regression + 3 skills) | small | large (tree grows with capability) |
| Over-engineering risk | **only if projects are single-skill** — then Layer B is dead weight | none | none |
| Determinism | full (static graph, LLM sets intent once) | full | full |

**Recommendation:** ship **Layer A now** (it is the ladder and delivers ~80% of the soak
value immediately, with zero GOAP machinery), and ship **Layer B behind the same payload**
once `smeltItems` exists — gating its activation on whether the assigned project is
multi-tier. This gives an honest incremental path: the ladder value is never held hostage
to the planner, and GOAP's means-ends reasoning is switched on exactly when a project
actually needs it. That staging is itself the answer to "is GOAP over-engineered?" —
**not for Phase-1's cold-start bar, but only if you don't pay for Layer B until a project
demands it.**
