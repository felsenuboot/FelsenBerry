# Agenda B — Utility-AI Brain (`agenda.js` payload)

Design for the driverless autonomous agenda: the deterministic "what do I do next"
selector that runs each cycle **without an LLM in the loop**. Architecture = **utility
AI**: every candidate action scores a scalar utility from a pure read of bot state, the
highest score wins each cycle, and inertia/hysteresis stops it from dithering. The LLM
sets the *project* and nudges ~7 weights **once**; the curves run forever.

Status: design only. No engine code changed here. Target: a new injectable payload
`agenda.js` → `globalThis.__agenda`, injected after skills/dangerscan/survival, same
idempotent-replace + staleness-registry discipline as the other payloads.

---

## 0. Where it sits in the stack (and what it does NOT do)

Three control layers already exist. The agenda is a **fourth layer that sits above the
task queue and replaces idleguard's decision role**, and it stays strictly *below*
survival.js:

```
 survival.js   ── involuntary REFLEX. Fires on __danger.state==='panic'
 (unchanged)      (score>=5 | hp<8 | creeper<=8). Suspends idleguard, owns the
                  body, runs ENV/CREEPER/BREAK_LOS/FLEE_HOME/WALL_OFF. 10s lockout.
        ▲ agenda YIELDS entirely while __survival.active
        │
 agenda.js    ── voluntary DELIBERATION (THIS DESIGN). Runs every ~2.5s when NOT in
 (new)           panic and NOT under a live driver command. Scores actions from state,
                 dispatches the winner as a __skills task (or a short inline micro-act).
        │ dispatches via
        ▼
 skills.js    ── task queue + primitives (S.start / S.enqueue / S.kitCheck / ctx.*).
 (unchanged)     One task at a time, kit preflight, HALT_ALWAYS codes, ASSERTS.
        │ passive, always-on
        ▼
 auto-eat 3.3.6, armor-manager, dangerscan 4Hz  (reflex sensors/actuators)
```

**Division of responsibility — the honest boundary.** survival.js already owns the one
inviolable guarantee ("acute danger beats everything"): when `__danger` crosses to
`panic`, survival seizes the body and the agenda yields. The agenda therefore does **not**
re-implement combat, fleeing, or coffin-walling. It governs only the **sub-panic space** —
the graded region where a good human player is *managing* needs before they become
emergencies: eat before you're starving, light before it's dark, replace the pick before
it snaps, deposit before the last slot fills, resupply before you set off, and otherwise
push the project forward. That is exactly the space where a strict ladder is wrong and
graded utility is right (§7).

**auto-eat stays enabled.** The passive plugin handles the moment-to-moment "food dropped,
take a bite" reflex. The agenda's food job is the part auto-eat *cannot* do: top saturation
during a safe lull before an excursion, and — the real one — **acquire/restock food when
there is none left to eat** (§4 EAT / DEPOT\_RESUPPLY). We do not fight auto-eat; survival
already sets `autoEat.options.offhand=false` so the shield wins slot 45.

---

## 1. The state snapshot (`readState()`) — bound to REAL fields

The agenda reads live in-process globals (no HTTP; per the token-efficiency law). Every
utility function is a pure function of this one immutable snapshot, taken once per tick.
Every field below is a real, verified read from the current engine:

```js
function readState(bot, g) {
  const D = globalThis.__danger || {};
  const SV = globalThis.__survival || {};
  const SK = globalThis.__skills || {};
  const p  = bot.entity && bot.entity.position;

  const inv = (() => { try { return bot.inventory.items(); } catch (_) { return []; } })();
  const count = (pred) => inv.filter(pred).reduce((a, i) => a + i.count, 0);
  const totalSlots = 36; // main inventory usable slots
  const emptySlots = (() => { try { return bot.inventory.emptySlotCount(); } catch (_) { return 0; } })();

  const proj = g.project;                      // LLM-set descriptor (or null → idle)
  const need = proj && proj.tool ? needSpecFor(bot, proj.tool) : null;
  const projTool = need ? bestOwnedFor(bot, need) : null;   // best owned tool that satisfies

  return {
    // --- vitals (bot.*) ---
    hp:   typeof bot.health === 'number' ? bot.health : 20,   // 0..20
    food: typeof bot.food   === 'number' ? bot.food   : 20,   // 0..20
    sat:  bot.foodSaturation || 0,

    // --- danger (globalThis.__danger, dangerscan v2) ---
    danger:  D.score || 0,                       // weighted, LOS-adjusted, situational mults baked in
    dstate:  D.state || 'calm',                  // 'calm'|'alert'|'panic'
    threats: Array.isArray(D.threats) ? D.threats : [],  // [{name,d,ranged,los,pos,id}]
    nearest: D.nearest || null,
    light:   D.light,                            // 0..15 | null   (block light at feet/head/+2 max)
    skyLight: D.skyLight,                        // 0..15 | null
    exposed: D.surfaceExposed,                   // true | false | null  (geometry-backed, not a bare read)
    heldDur: D.held && typeof D.held.dur === 'number' ? D.held.dur : null,  // 0..100 %
    heldName: D.held ? D.held.name : (bot.heldItem ? bot.heldItem.name : null),

    // --- inventory economy ---
    emptySlots,
    invFull: 1 - emptySlots / totalSlots,        // 0..1  (fullness)
    torches: count((i) => i.name === 'torch' || i.name === 'soul_torch' || i.name === 'copper_torch'),
    foodItems: count((i) => FOODS.has(i.name)),
    filler: count((i) => FILLERS.has(i.name)),
    surplus: surplusCount(inv, proj),            // items that DEPOT would offload (non-kept)

    // --- geometry ---
    y: p ? p.y : 64,
    distHome: p ? dist(p, SV.home || { x: 0, y: 64, z: 0 }) : 0,

    // --- project (LLM intent) ---
    project: proj,                               // {id,skill,args,tool,kit,priority,site,progress,...}
    projTool,                                    // truthy iff we hold a satisfying tool
    projReady: proj ? projectReadiness(bot, proj) : 0,  // 0..1: tool+kit+at-site (§4)
    projRemain: proj ? projectRemaining(bot, proj) : 0, // 0..1: fraction of work left (verifier-read)

    // --- control-plane flags ---
    panicActive: Boolean(SV.active),
    taskRunning: Boolean(SK.currentTask && SK.currentTask.running),
    myTask: g.myTaskId && SK.currentTask && SK.currentTask.id === g.myTaskId,
    now: Date.now(),
  };
}
```

`projectRemaining` and `projectReadiness` are **verifier reads** (independent of any skill
self-report) so the agenda can never chase a false success (§8, EVALUATION law 1):

```js
// fraction of work still to do, read from the WORLD not the skill's claim
function projectRemaining(bot, proj) {
  const pr = proj.progress;
  if (!pr) return 1;
  if (pr.kind === 'itemCount') {                       // "mine 64 raw_iron"
    const have = countItems(bot, [pr.item]);
    return clamp01(1 - have / pr.target);
  }
  if (pr.kind === 'buildVerified') {                   // cells still not matching blueprint
    return clamp01(pr.remainingCells / pr.totalCells); // refreshed by the build skill's verify pass
  }
  if (pr.kind === 'reachY')  return clamp01((bot.entity.position.y - pr.targetY) / (pr.startY - pr.targetY));
  return 1;
}
```

---

## 2. Shaping primitives — the only maths in the system

Five pure helpers. Every curve in §4 is built from these, so the whole system is auditable
and deterministic. No `Math.random`, no time-of-day, no wall-clock inside a curve (only the
snapshot's frozen `now` for cooldowns, which is state, not entropy).

```js
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
// rising ramp: 0 at/below lo, 1 at/above hi, linear between
const up   = (x, lo, hi) => clamp01((x - lo) / (hi - lo));
// falling ramp: 1 at/below lo, 0 at/above hi
const down = (x, lo, hi) => clamp01((hi - x) / (hi - lo));
// deficit of a resource vs a target need: 0 when satisfied, →1 as it empties
const deficit = (have, need) => need <= 0 ? 0 : clamp01((need - have) / need);
// soft knee: emphasize the last stretch (square) so "almost empty/almost broken" bites
const knee = (x) => x * x;
```

**Every breakpoint fed to `up/down/deficit/knee` is a Minecraft mechanic, not a free knob**
(this is the core of the brittleness answer, §11). The registry of physical breakpoints:

| Constant | Value | Why it is a mechanic, not a tunable |
|---|---|---|
| `FOOD_REGEN` | 18 | natural HP regen requires food ≥ 18 |
| `FOOD_SPRINT` | 6 | below 6 you cannot sprint (escape speed lost) |
| `FOOD_STARVE` | 4 | starvation damage imminent, act now |
| `HP_PANIC` | 8 | dangerscan panics below this — survival's floor |
| `HP_REGEN_TGT` | 18 | heal target that resumes safe work |
| `LIGHT_SPAWN` | 8 | block light ≥ 8 blocks hostile spawns |
| `DUR_LOW` | 15 | `tool_low` line; "replacing a broken tool outranks the job" |
| `DUR_URGENT` | 6 | near-certain break within a task |
| `SLOTS_CRIT` | 1 | 0 empty slots = `inv_full` fatal halts the skill |
| `DANGER_ALERT` | 2.5 | dangerscan `alert` threshold |
| `DANGER_PANIC` | 5 | dangerscan `panic` — above this survival owns the body |
| `FLEE_HOME_MAX` | 40 | survival's flee-home radius; home is "reachable" within it |
| kit tiers | `KIT_TIERS` | 8/16/40 torches, 2/4/8 food, 16 filler, 2 picks, … |

These are imported/mirrored from `dangerscan.thresholds`, `survival.cfg`, and
`KIT_TIERS` so they can never drift from the modules that enforce them.

---

## 3. The tunable weights (the ENTIRE tuning surface)

Seven numbers. This is the whole thing the LLM (or a human) may change. Each has a clamped
legal range; `setWeights` rejects out-of-range values. Defaults chosen so that **at their
respective worst-case intensities**, the action classes order the way the GOAL.md ladder
demands (safety ≳ maintenance ≳ project ≳ idle) — while still permitting the graded
cross-tier overrides that make utility better than a ladder (§7).

```js
g.W = {
  safety:  1.00,  // range 0.80..1.20  — SEEK_SAFETY (sub-panic danger / darkness+threat)
  heal:    0.95,  //       0.60..1.15  — RETURN_HOME_HEAL (low hp, no active threat)
  eat:     0.90,  //       0.60..1.10  — EAT (force top-up / hunger)
  tool:    0.90,  //       0.60..1.15  — ACQUIRE_TOOL (missing/near-broken project tool)
  depot:   0.85,  //       0.50..1.10  — DEPOT_RESUPPLY (deposit surplus + restock consumables)
  project: 0.60,  //       0.20..0.90  — ADVANCE_PROJECT (× project.priority)
  idle:    0.15,  //       0.05..0.30  — IDLE_FALLBACK (role-default; the no-idle floor)
};
```

Utility per action = `W[class] × intensity01(snap)`, where `intensity01 ∈ [0,1]` is the
curve. Weights are directly interpretable because every curve is normalised to 0..1: "at
full intensity, SEEK\_SAFETY outputs `W.safety`."

---

## 4. The action set

Eight actions. Each is `{ id, cls, utility(snap), commitMs, dispatch(snap,bot,g),
onFail }`. Two dispatch classes:

* **SKILL actions** run a `__skills` task (via `S.start`/`S.enqueue`); the agenda records
  `g.myTaskId` and re-evaluates when the task ends (or preempts it, §6).
* **MICRO actions** run a short inline routine (place a torch, force one eat, step to a
  lit cell), guarded by `g.busy` so ticks never overlap, finishing within a tick or two.

Utilities are written as `W.x * <curve>`; the curve is the part grounded in state.

### 4.1 `SEEK_SAFETY` (micro; sub-panic danger + preventive darkness-under-threat)

The graded ramp survival.js does **not** cover — everything below the panic line. Rises with
`__danger.score` in the alert band and with "dark + a hostile in range" spawn pressure.

```js
utility: (s) => {
  if (s.dstate === 'panic') return 0;               // survival owns it; agenda yields anyway
  // proximity of danger within the alert band [1.2 .. PANIC]
  const dScore = knee(up(s.danger, 1.2, DANGER_PANIC));           // 0..1, squared knee
  // dark-and-not-alone: enclosed darkness with any hostile tracked nearby
  const dark = (s.exposed === false && (s.light ?? 15) < LIGHT_SPAWN) ? 1 : 0;
  const nearHostile = s.threats.some((t) => t.d <= 12) ? 1 : 0;
  const spawnPressure = 0.5 * dark * nearHostile;                 // preventive, capped low
  // low hp amplifies (below panic hp we're already in survival)
  const hpAmp = 1 + 0.5 * down(s.hp, HP_PANIC, 14);
  return W.safety * clamp01((dScore + spawnPressure) * hpAmp);
},
commitMs: 1500,
dispatch: async (s, bot, g) => {
  // 1) ready the shield if held (defensive, cheap)  2) deny spawns: autoTorch the spot
  // 3) put distance toward home / higher skyLight — a few blocks, not a marathon
  await readyShield(bot, s.nearest);
  await placeTorchHere(bot);                          // reuses ctx.autoTorch semantics
  await stepToward(bot, safeBearing(bot, s));         // toward home or brightest neighbour cell
}
```

This is deliberately gentle — it *pre-empts* the panic. If it fails to help and the score
keeps climbing past `DANGER_PANIC`, dangerscan flips to `panic`, survival takes the body,
and the agenda yields. That smooth ramp into the reflex is the whole point (§7).

### 4.2 `RETURN_HOME_HEAL` (skill; low hp, no active threat)

Low HP with *nothing shooting at us* → stop working, get to the lit plaza, eat to the regen
line, wait out natural regeneration. (With a threat, SEEK\_SAFETY/panic outrank this by
construction — its curve zeroes when danger is up.)

```js
utility: (s) => {
  if (s.danger >= DANGER_ALERT) return 0;            // a threat present → not a calm heal
  const lowHp = knee(up(20 - s.hp, 4, 12));          // hp 16→0 .. hp 8→1 (squared)
  return W.heal * lowHp;
},
commitMs: 4000,
dispatch: (s,bot,g) => startSkill(g, bot, 'come', { ...homeXYZ(), range: 2 }),
// after arrival the EAT curve force-feeds to FOOD_REGEN and HEAL holds until hp≥HP_REGEN_TGT
```

### 4.3 `EAT` (micro; hunger / pre-excursion top-up)

Backstops auto-eat and force-tops before excursions. Gated on actually holding food; if out
of food the deficit flows to DEPOT\_RESUPPLY instead.

```js
utility: (s) => {
  if (s.foodItems <= 0) return 0;                    // nothing to eat → not this action's job
  // below the regen line matters; below sprint/starve it bites hard
  const regenGap = up(FOOD_REGEN - s.food, 0, 6);    // food 18→0 .. food 12→1
  const acute    = knee(up(FOOD_SPRINT - s.food, 0, FOOD_SPRINT)); // food 6→0 .. food 0→1, squared
  return W.eat * clamp01(0.55 * regenGap + acute);
},
commitMs: 0,
dispatch: async (s, bot) => { try {
  bot.autoEat.options.startAt = 20; await bot.autoEat.eat();   // eat up to full (survival's eatUp pattern)
} catch (_) {} finally { /* restore startAt */ } }
```

### 4.4 `ACQUIRE_TOOL` (skill; the project tool is missing or dying)

Binds directly to `__danger.held.dur` and to `bestOwnedFor(need)`. Encodes the MEMORY law
"broken tool = replacing it outranks the job": as durability → 0 the curve climbs past a
low-priority project's utility.

```js
utility: (s) => {
  const need = s.project && s.project.tool;
  if (!need) return 0;
  if (!s.projTool) return W.tool * 0.95;             // no satisfying tool at all → very high
  // held tool is the project tool and it's dying
  const dyingHeld = (s.heldDur != null && satisfies(s.heldName, need))
    ? knee(down(s.heldDur, DUR_URGENT, 40))          // 40%→0 .. 6%→1, squared
    : 0;
  return W.tool * dyingHeld;
},
commitMs: 4000,
dispatch: (s,bot,g) => runInline(g, () => ctx_ensureTool(bot, s.project.tool)),
// ctx.ensureTool: equip → depot withdraw → craft (already implemented in skills.js)
```

Note the crossover: a project at `priority 0.5` yields `≈0.30` (§4.7). A held pickaxe at
`dur 5%` yields `W.tool*knee(down(5,6,40)) ≈ 0.90`. The near-broken pick correctly wins —
a thing a `survival > maintenance > project` ladder *also* gets right, but a
`project vs maintenance` ladder without intensities gets wrong when the tool is at 30%
(agenda: `≈0.08`, so the project keeps running until the tool actually gets low). Graded
intensity is what lets "same two tiers, different urgency" resolve differently.

### 4.5 `DEPOT_RESUPPLY` (skill; inventory full OR consumables low)

One action, one trip, both concerns — deposit surplus *and* refill torches/food/filler.
Utility = the worse of the two pressures. Merging them prevents a deposit↔restock ping-pong
(a classic utility-AI oscillation) at the source.

```js
utility: (s) => {
  // deposit pressure: steep as slots run out (inv_full HALTS every skill)
  const depositP = s.surplus > 0 ? knee(up(s.invFull, 0.72, 1.0)) : 0;   // ~10 slots left→0 .. 0→1
  // restock pressure: only when we hold enough to make a trip worthwhile OR are truly out
  const kit = s.project && s.project.kit ? KIT_TIERS[s.project.kit] : KIT_TIERS.excursion;
  const torchP = deficit(s.torches, kit.torches);
  const foodP  = s.foodItems === 0 ? up(FOOD_REGEN - s.food, 0, 8) : deficit(s.foodItems, kit.foodItems) * 0.6;
  const fillP  = kit.filler ? deficit(s.filler, kit.filler) * 0.5 : 0;
  const restockP = Math.max(torchP, foodP, fillP);
  return W.depot * Math.max(depositP, restockP);
},
commitMs: 5000,
dispatch: (s,bot,g) => startSkill(g, bot, 'depositToChest', { pos: depotChest() }, /* then */
                                   { name: 'restock', args: { needs: kitShoppingList(s) } }),
onFail: backoff(15000),   // chest unreachable/full → back off, don't loop
```

`restock` is a thin new skill (or an inline `ctx.withdrawFromChest(depotChest, needs)` — the
primitive already exists). `kitShoppingList` computes the deficit vs the project's kit tier.

### 4.6 `LIGHT_AREA` (micro; dark workspace, no threat — preventive)

The calm-time complement to SEEK\_SAFETY: light a spawnable-dark spot before anything shows
up. Low ceiling, gated on holding torches and on genuine enclosed darkness.

```js
utility: (s) => {
  if (s.torches <= 0) return 0;
  if (s.danger >= DANGER_ALERT) return 0;            // threat present → SEEK_SAFETY handles lighting
  const spawnable = (s.exposed === false && (s.light ?? 15) < LIGHT_SPAWN) ? 1 : 0;
  return W.safety * 0.35 * spawnable * up(LIGHT_SPAWN - (s.light ?? 15), 0, LIGHT_SPAWN);
},
commitMs: 0,
dispatch: (s,bot) => placeTorchHere(bot),
```

### 4.7 `ADVANCE_PROJECT` (skill; the actual work)

The baseline that wins whenever no maintenance/safety need is pressing. Utility scales with
LLM-set priority, and is *discounted when the bot is not ready* (missing tool, incomplete
kit, far from site) so that DEPOT\_RESUPPLY / ACQUIRE\_TOOL naturally run **first** — this is
what stops the "start → kit\_missing → retry" loop that a naive ladder would spin in.

```js
utility: (s) => {
  if (!s.project) return 0;
  const base = W.project * clamp01(s.project.priority ?? 0.5);   // LLM lever
  const work = 0.35 + 0.65 * s.projRemain;                        // more left ⇒ more pull; small finish-it bump near 0? see note
  const ready = 0.35 + 0.65 * s.projReady;                        // unready ⇒ let maintenance win first
  return base * work * ready;
},
commitMs: 8000,           // once mining/building, let the skill make real progress
dispatch: (s,bot,g) => startSkill(g, bot, s.project.skill, s.project.args),
```

`projectReadiness` binds to the same `S.kitCheck` the engine enforces, so readiness and the
kit preflight can never disagree:

```js
function projectReadiness(bot, proj) {
  let r = 1;
  if (proj.tool && !bestOwnedFor(bot, needSpecFor(bot, proj.tool))) r *= 0.15;  // no tool
  if (proj.kit) { const k = globalThis.__skills.kitCheck(bot, proj.kit); if (!k.ok) r *= 0.4; }
  if (proj.site) r *= down(dist(bot.entity.position, proj.site), 8, 96) * 0.5 + 0.5; // far ⇒ mild discount
  return clamp01(r);
}
```

*Finish-it note:* `work = 0.35 + 0.65*projRemain` means utility **falls** as the project
completes. That is intentional: near completion, a maintenance need that would otherwise
lose gets a chance to interleave. If instead you want momentum-to-finish, flip to
`0.5 + 0.5*(1-projRemain)`; the choice is one line and is itself a snapshot-fixture
decision (§11). Default keeps the falling form — it never starves maintenance late in a
long build.

### 4.8 `IDLE_FALLBACK` (skill; the no-idle floor)

Exactly today's idleguard behavior, demoted to the lowest tier and invoked *by* the agenda
so there is only one brain. Reuses idleguard's deterministic role scans (`mineNearest`,
`sweepDrops`) and its surface-only gate.

```js
utility: (s) => {
  // only on the surface, never descend (idleguard's MAX_BELOW rule), never in the dark
  if (s.exposed === false) return 0;
  return W.idle;   // flat floor; wins only when everything else is ~0
},
commitMs: 6000,
dispatch: (s,bot,g) => runRoleDefault(g, bot),   // lumberjack→chop, miner→surface ore/stone, else sweep
```

### Action summary

| Action | Class | Curve driver (real field) | Worst-case U | Dispatch |
|---|---|---|---|---|
| SEEK\_SAFETY | micro | `__danger.score` (1.2..5), dark+hostile | ~1.2 | shield + torch + step to safety |
| RETURN\_HOME\_HEAL | skill | `bot.health` (16..8), no threat | ~0.95 | `come` home, hold to hp≥18 |
| EAT | micro | `bot.food` vs 18/6/0 | ~0.90 | `bot.autoEat.eat()` to full |
| ACQUIRE\_TOOL | skill | `__danger.held.dur`, tool missing | ~0.90 | `ctx.ensureTool(project.tool)` |
| DEPOT\_RESUPPLY | skill | `emptySlotCount`, kit deficits | ~0.85 | `depositToChest` + `withdrawFromChest` |
| LIGHT\_AREA | micro | `__danger.light`<8, `surfaceExposed`===false | ~0.30 | `ctx.autoTorch` |
| ADVANCE\_PROJECT | skill | `project.priority`×readiness×remaining | ~0.90 | `S.start(project.skill,args)` |
| IDLE\_FALLBACK | skill | constant floor, surface-only | 0.15 | role-default scan |

---

## 5. The selection loop (`tick`) — argmax + commitment

One interval, ~2.5s, mirroring idleguard's orphan-killer + sticky-stop discipline:

```js
g.timer = setInterval(() => (async () => {
  if (globalThis.__agenda !== g || !g.enabled) { clearInterval(g.timer); return; }  // superseded/stopped
  if (g.busy) { hardPreemptCheck(g); return; }              // a micro-act is mid-flight
  if (globalThis.__survival && globalThis.__survival.active) { g.yield = 'panic'; return; }  // reflex owns body
  if (driverActive(g)) { g.yield = 'driver'; return; }      // yield to a live external command (§10)
  g.yield = null;

  const s = readState(bot, g);

  // 1) HARD PRE-EMPTS — cancel a running task immediately, regardless of dwell (§6)
  const forced = hardPreempt(s);                            // returns an action id or null
  // 2) score everything from the frozen snapshot (PURE — no side effects, no RNG)
  const U = {};
  for (const a of ACTIONS) U[a.id] = a.utility(s, g);
  // 3) winner = argmax, deterministic tie-break by fixed ACTIONS order
  let win = ACTIONS[0]; for (const a of ACTIONS) if (U[a.id] > U[win.id]) win = a;
  if (forced) win = byId(forced);

  // 4) COMMITMENT / hysteresis — don't abandon a running action cheaply
  const cur = g.current;
  if (cur && !forced) {
    const dwell = s.now - g.currentStart;
    const runningMyTask = s.myTask;                          // our skill task is still going
    const keep = (dwell < cur.commitMs) ||
                 (runningMyTask && U[win.id] <= U[cur.id] + SWITCH_MARGIN);  // margin = 0.15
    if (keep && win.id !== cur.id) {
      logDecision(s, U, cur.id, 'hold');                     // audit line: why we stayed
      return;
    }
  }

  // 5) switch: stop our own running task if any, then dispatch the winner
  if (s.myTask && win.id !== (cur && cur.id)) { try { globalThis.__skills.stop('agenda:switch', { }); } catch (_) {} }
  g.current = win; g.currentStart = s.now; g.lastU = U;
  logDecision(s, U, win.id, forced ? 'forced' : 'select');
  g.busy = win.cls === 'micro';
  try { await win.dispatch(s, bot, g); }
  catch (e) { g.errors++; if (win.onFail) win.onFail(g); }
  finally { if (win.cls === 'micro') g.busy = false; }
})().catch(() => {}), AGENDA_TICK_MS);   // 2500
```

* **argmax is total and deterministic**: fixed `ACTIONS` order breaks exact ties (never
  random). Same snapshot ⇒ same winner, always.
* **commitment = dwell + hysteresis margin.** A running SKILL action is only abandoned when
  a challenger beats it by `SWITCH_MARGIN` (0.15) *or* a hard pre-empt fires. This is the
  anti-dithering core: two needs sitting near a boundary cannot flip the bot every tick.
* **MICRO actions** finish within a tick (`g.busy`), so they don't need dwell — but a hard
  pre-empt is still checked while `busy` so a torch-placement can't delay a panic.

`logDecision` writes one throttled line per *change* (not per tick) into `S.log` with the
full utility vector, e.g. `agenda select ADVANCE_PROJECT U=0.41 {safety:0,eat:0.12,tool:0,
depot:0.30,project:0.41,idle:0.15}`. This makes every field decision auditable and is the
raw material for the tuning fixtures (§11) and the soak benchmark (§8).

---

## 6. Pre-emption — the hard lines that bypass dwell

Below panic, some conditions must interrupt *even a committed, freshly-started task*.
These are not graded — they are the small set of "never keep doing X while Y" gates, and
they mirror the engine's own `HALT_ALWAYS` codes so the agenda acts *before* the skill
fails rather than after:

```js
function hardPreempt(s) {
  if (s.emptySlots === 0 && s.surplus > 0)                         return 'DEPOT_RESUPPLY'; // inv_full incoming
  if (s.project && s.project.tool && !s.projTool)                  return 'ACQUIRE_TOOL';   // tool broke mid-task
  if (s.foodItems > 0 && s.food <= FOOD_STARVE)                    return 'EAT';            // starvation damage soon
  if (s.dstate === 'alert' && s.danger >= 4 && curIsWorkOrIdle(s)) return 'SEEK_SAFETY';    // climbing toward panic
  return null;
}
```

Everything else — including the ordinary "the pick is at 30%, keep mining" — is left to the
graded comparison, which is exactly where graded beats a cliff.

---

## 7. Why graded utility beats a strict ladder here

The GOAL.md capstone names a *strict ladder*: `survival > self-maintenance > project >
idle`. This design **keeps that ordering as the emergent common case** (weights are sized so
each class's worst-case tops the next class's) but fixes the three places a literal ladder
misbehaves. The honest framing: **the one hard rung that must never bend — acute survival —
is enforced structurally by survival.js's panic seizure and the `hardPreempt` gates, not by
the utility comparison.** Everything softer is graded, and softer things genuinely trade
off against each other.

**1. A ladder cannot compare *intensities across* a rung.** Two states, both "maintenance
tier":

* pick at 30%, inventory 60% full → nothing is urgent; keep mining.
* pick at 4%, inventory 1 slot left → both are about to halt the task.

A binary ladder ("is a maintenance need present? then do maintenance") treats these
identically and yanks the bot off the vein in both. Graded intensity: case 1 →
`max(tool 0.08, depot 0.10) < project 0.41`, keep working; case 2 → `depot ≈0.80` (or
`tool ≈0.92`) `> project`, go fix it. **Same tier, different urgency, correctly different
action** — a ladder structurally cannot express this.

**2. Competing needs at once — "hungry AND threatened AND full."** Consider hp 11, food 5,
one skeleton at 14 blocks *with no LOS* (`__danger.score ≈ 1.6`, still `alert`), 1 empty
slot. A `survival > maintenance` ladder fires "survival" on the mild skeleton and ignores
that we're one bite from losing sprint and one block from a halt. Utility scores each
*actual* need by its *actual* acuteness:

```
SEEK_SAFETY ≈ 1.0 * knee(up(1.6,1.2,5)) ≈ 1.0*0.012 ≈ 0.01   (no LOS, distant → tiny)
EAT         ≈ 0.90*(0.55*up(13)→ .. )  ≈ 0.55                  (food 5: past sprint knee)
DEPOT       ≈ 0.85*knee(up(0.97,0.72,1)) ≈ 0.72                (1 slot: near-halt)
```

Winner: DEPOT\_RESUPPLY, then EAT — the two things that are actually about to break the run
— while the harmless skeleton is correctly ignored *because dangerscan already priced its
lack of LOS and distance into the score*. A ladder that fires on "a hostile exists" gets
this exactly backwards. And the instant that skeleton gains LOS and closes,
`__danger.score` climbs, SEEK\_SAFETY's squared knee overtakes, and past 5 survival seizes
the body. The **ramp** from "ignore it" to "reflex" is continuous; a ladder is a cliff.

**3. Dithering at a boundary.** Two needs oscillating around a ladder threshold flip the bot
every poll (the exact idleguard-vs-driver goal-stomp class of bug in LEARNING\_HANDOFF).
Utility + `SWITCH_MARGIN` hysteresis + per-action `commitMs` dwell make switching *sticky*:
you leave an action only when a challenger is *clearly* better, not marginally. A ladder has
no natural place to put hysteresis; utility does.

**The concession:** graded utility earns these wins at the cost of a tuning surface. §11 is
the honest accounting of that cost and how this design keeps it small.

---

## 8. Determinism (the codicil)

* **Utility is a pure function of one frozen snapshot.** `readState` is called once per
  tick; every `utility(s)` reads only `s`. No `Math.random`, no direct clock reads inside a
  curve (cooldown comparisons use `s.now`, a snapshot field, so replaying a snapshot with
  its recorded `now` is exact).
* **argmax is total with a fixed tie-break** (declaration order of `ACTIONS`). Identical
  state ⇒ identical decision, every time. This is the property that makes the LLM-thinks-
  once/code-runs-forever contract literally true here.
* **The LLM is out of the steady-state loop.** It writes `project` + `W` once (or on a
  major context change) via one `/eval`; the tick loop never calls a model. `think_share`
  (EVALUATION §2.8) for a bot in steady project-advance should be ~0.
* **Replayability = testability.** Because a decision is `f(snapshot)`, recorded snapshots
  replay bit-for-bit through the utility functions offline (§11). This is both the
  determinism proof and the regression harness.
* **No false success.** Project progress is read from the world (`projectRemaining`, item
  counts / verified-cell counts), never from a skill's self-report — so the agenda cannot
  "advance" on a lie (EVALUATION law 1, false\_success = target 0). When a dispatched skill
  returns, the agenda re-reads world state; a skill that claimed done but banked nothing
  leaves `projRemain` unchanged and the agenda simply re-dispatches (and the ASSERTS layer
  flags the false\_success independently).

---

## 9. The LLM interface — set the project, nudge the weights, once

The LLM's entire steady-state footprint is these calls (one `/eval` each):

```js
// Set / replace the current project. Persisted on globalThis (survives reconnect via re-inject).
__agenda.setProject({
  id:    'mine-iron-64',
  skill: 'mineLane',                       // any registered skill name
  args:  { target: 'iron_ore', count: 64, laneY: 12 },
  tool:  'pickaxe',                        // → ACQUIRE_TOOL need
  kit:   'underground',                    // → readiness + DEPOT restock target (KIT_TIERS)
  site:  { x: 120, y: 12, z: -40 },        // → readiness distance term
  priority: 0.7,                           // → ADVANCE_PROJECT weight (0..1)
  progress: { kind: 'itemCount', item: 'raw_iron', target: 64 },  // VERIFIER read
});

__agenda.setWeights({ project: 0.8 });     // clamped to legal range; rejects out-of-range
__agenda.clearProject();                   // → agenda falls back to IDLE_FALLBACK role work
__agenda.snapshot();                       // → {current, lastU, project, W, yield, fires,...} for a driver poll
```

**Multi-phase projects (one intent → a whole workflow).** `project` may be a *plan* — an
ordered list of phases with per-phase `done` predicates. When a phase's verifier read says
done, the agenda advances to the next phase automatically. This is how one LLM decision
yields hours of structured autonomy:

```js
__agenda.setPlan([
  { id:'gather',  skill:'mineLane', args:{target:'iron_ore',count:64}, tool:'pickaxe', kit:'underground',
    done:(bot)=>countItems(bot,['raw_iron'])>=64 },
  { id:'smelt',   skill:'smeltAll', args:{input:'raw_iron',fuel:'coal'},
    done:(bot)=>countItems(bot,['iron_ingot'])>=64 },
  { id:'build',   skill:'frameStructure', args:{origin:{x:-3,y:111,z:4}, width:7, depth:7, height:4},
    progress:{kind:'buildVerified'}, done:(bot,ph)=>ph.progress.remainingCells===0 },
]);
```

The agenda exposes only *intent* to the LLM (what to build, how much it matters). It never
exposes the curves — the LLM cannot rewrite `up(x,lo,hi)` breakpoints, only pick a project
and slide seven clamped weights. That bounded surface is deliberate (§11).

**Driver escalation stays possible.** A driver that wants manual control issues an ordinary
`__skills.start(...)` / pathfinder goal; the agenda detects the external command and yields
(§10), exactly as idleguard does today. The agenda is the *default* driver, not a lock.

---

## 10. Coexistence, reconnect, staleness (the non-negotiables)

* **One brain.** On install, `agenda.js` calls `__idleguard.stop()` (idempotent; re-inject
  restores it) and takes over the idle role via IDLE\_FALLBACK — so the agenda and idleguard
  never both drive. If the operator prefers to keep idleguard, the agenda instead holds
  `__idleguard.busy=true` while it owns a decision (the survival.js trick) and only releases
  for its own IDLE\_FALLBACK. Recommended: supersede idleguard outright; it becomes a code
  path the agenda calls, not a peer.
* **Survival supremacy.** The tick's first checks are `__survival.active` (yield) — survival
  already suspends idleguard via `busy`; the agenda additionally self-suspends on
  `__survival.active`, and survival needs **no change** to know about the agenda.
* **Driver yield.** Reuse idleguard's proven mechanism: patch `bot.pathfinder.setGoal/goto`,
  `bot.dig/equip/craft/openContainer/activateBlock` to stamp `g.lastExternal` when the call
  did **not** originate from an agenda dispatch (track an `g.dispatching` flag around
  `win.dispatch`). `driverActive(g)` = `now - g.lastExternal < 25000` *and not our task*.
  A running `__skills` task the agenda itself started is `s.myTask` (not external). This is
  the same yield logic that already keeps idleguard out of a driver's way.
* **The task queue is the actuator.** SKILL actions go through `S.start`/`S.enqueue`, so
  kit preflight, `HALT_ALWAYS`, `ASSERTS`, chat throttling, and the zero-gap handover all
  apply unchanged. The agenda reads `S.currentTask` state each tick to know when its task
  ended. It never bypasses the queue.
* **Reconnect / staleness.** Register in `globalThis.__payloads` (`{version, boundAt,
  stale}`) and flip `stale=true` on `bot.once('end')` exactly like survival/dangerscan, so
  `GET /state.stalePayloads` names a dead agenda and P0.2 auto-inject re-binds it. The tick
  guards on `globalThis.__agenda !== g`. The `project`/`plan`/`W` live on `globalThis` and
  are re-read after re-inject (or the driver re-`setPlan`s). **HARD trigger:** an agenda
  bound to a dead bot must never keep dispatching — the `botAlive`/end-listener discipline
  from skills.js applies verbatim.
* **`bot.blockAt` staleness / remote-scan quirk.** Readiness/lighting reads use only *local*
  block data (feet/head/±2), never a remote survey — dangerscan already learned this
  (issue #18, and the MettMarcel floating-dirt remote-scan lesson). The agenda never routes
  on a remote `blockAt`.

---

## 11. Tuning brittleness — the honest accounting

Utility AI's real, well-known failure mode: many weights and breakpoints, small changes
cascade unpredictably, one action can dominate and starve the rest, and emergent
oscillation is hard to trace. Pretending otherwise would be dishonest. Here is the cost and
the four concrete things that keep it bounded.

**The cost, stated plainly.** Seven weights × eight curves is a real parameter space. A bad
`W.project` can make the bot ignore a dying pick; a bad hysteresis margin can either dither
(too low) or freeze on a finished task (too high); a curve with the wrong knee can make
DEPOT fire a trip too early every time. These are genuine risks, not hypotheticals.

**Mitigation 1 — almost every breakpoint is a game mechanic, not a knob.** The curves are
keyed on `18/6/0` food, `8` light, `8` hp-panic, `15/6` durability, `2.5/5` danger,
`0/1` empty-slots, and the `KIT_TIERS` numbers (§2). Those are *dictated by Minecraft and
by the modules that already enforce them* (dangerscan thresholds, survival cfg, KIT\_TIERS)
— the agenda imports them, it does not choose them. So the *shape* of every curve is fixed;
the tuning surface collapses to the **seven weights** (relative priorities) plus the project
priority. That is a small, interpretable surface — each weight is "how much does this class
matter at full intensity," directly comparable because every curve is normalised to 0..1.

**Mitigation 2 — hard rungs are structural, not tuned.** The one guarantee that must never
bend (acute survival) does **not** live in the weights at all: it lives in survival.js's
panic seizure and in the `hardPreempt` gates (inv\_full, tool-broke, starvation, climbing
danger). No weight setting can make the bot trade acute survival for a block, because that
decision was removed from the utility comparison entirely. Tuning can only reshape the
*soft* middle, where being slightly wrong means "resupplied one trip early," not "died."

**Mitigation 3 — determinism makes tuning a regression test, not a guess.** Because a
decision is a pure function of a snapshot, we ship `bench/agenda-fixtures/*.json`: recorded
real snapshots (harvested from `logDecision` in the field, plus hand-built adversarial ones
— "hungry+threatened+full", "pick at 4% mid-vein", "dark cavity, skeleton no-LOS") each
labelled with the **expected winning action**. `metrics`/a tiny replay harness runs every
fixture through the exact `ACTIONS` array and asserts the winner. **Any weight or curve
change is validated against the whole corpus before deploy** — the "change one weight, break
something far away" failure becomes a *visible*, deterministic test failure, not a field
surprise. This slots directly into EVALUATION's Tier-0 fixture doctrine (law 2:
deterministic assertions before statistics; one N=1 reproduction outranks a gauntlet) and
the anti-Goodhart `assertionHash` discipline.

**Mitigation 4 — every decision is logged with its full utility vector.** `logDecision`
writes the vector on every change. When the field does something surprising, the answer is
in the log (`why did it deposit? depot=0.74 vs project=0.71 — margin`), not a mystery. That
is the difference between a tunable system and an inscrutable one; it is also the raw data
that grows the fixture corpus over time.

**What this does NOT solve, and the fallback.** These bound the risk; they do not make it
zero. Emergent multi-step oscillation across *task boundaries* (finish depot → project →
something re-triggers depot) can still occur and won't show in a single-snapshot fixture.
Two guards: (a) per-action `onFail`/cooldown backoff (a depot trip that didn't reduce
fullness — chest full/unreachable — backs off 15s instead of re-firing); (b) a **thrash
monitor** mirroring the queue's `THRASH_N`: if the agenda switches actions >8 times in 60s,
it latches to the current highest-utility SKILL action for a cooldown and logs
`agenda_thrash` for a human/LLM to inspect. If tuning ever proves genuinely intractable in
the field, the fallback is the ladder itself: because the hard rungs are already structural,
degrading to "strict tie-break order among non-zero curves" (ignore magnitudes, use the
fixed `ACTIONS` order) recovers exactly the GOAL.md strict ladder as a one-flag safe mode —
the utility layer is an *enhancement over* a ladder we can always fall back to, not a
replacement that burns the bridge.

---

## 12. Evaluation & telemetry hooks (EVALUATION.md)

* **Soak (AS, §2.6).** `utilization = active_ms/wall_ms` is measured directly from the
  agenda: `active` = any tick where `g.current` is a working action (not yield/idle-only).
  `idlePct` should stay ≤5% (the no-idle bar). Every `logDecision` is a cheap telemetry
  `note` event; `MTBI`/`L2+ interventions` count times a human had to `/eval` the agenda.
* **False success (law 1).** Project progress verifier-read (§8) means the agenda's own
  `projRemain` is a second, independent check on any build/mine skill's claim — a divergence
  (`skill said done, projRemain unchanged`) is itself a logged `false_success` signal.
* **Autonomy headline.** `autonomy_ratio = engine-executed actions / total actions → 1.0`:
  in driverless soak every dispatched action is engine-executed, so this is ~1.0 by
  construction; the number that matters is `T50` (autonomy half-life) — hours survived
  without an L2 intervention, tracked per engine version.
* **HARD triggers the agenda must never cause:** `staleAfterReconnect>0` (agenda dispatching
  on a dead bot), `dropsLeft>0` (dispatch a working action that skips collectDrops — but
  skills already sweep), `falseSuccess>0`. All are covered by §10 staleness discipline and
  §8 verifier reads.

---

## 13. Quirk-survival checklist (LEARNING_HANDOFF)

The agenda inherits every hazard the skills it dispatches already survive, but as a *new*
top-level loop it must itself respect:

- **Never store a long-lived `bot`.** Read `bot` fresh each tick from the injected scope;
  guard `globalThis.__agenda !== g`; flip `stale` on `'end'`. (skills.js invariant.)
- **Yield to a running task + a live driver** (idleguard v7 lesson: don't stomp a goal).
  `s.myTask` distinguishes the agenda's own task from an external one.
- **Never fight the stall-buster / survival.** Yield on `__survival.active`; suspend
  idleguard rather than run beside it.
- **Bounded, owned gotos in micro-acts.** `stepToward`/`readyShield` use survival's
  `ownedGoto` token pattern so a timed-out step can't clear a later goal (orphaned-goto
  quirk).
- **Local block reads only** (stale remote `blockAt`); torch-underfoot and leaf-litter
  wedges are handled by the skills' own `ctx.goto` recovery — the agenda just doesn't
  micro-path far.
- **Chat through `say()`** (the throttled path) and keep decision spam in `S.log`, not
  chat — one line per *change*, not per tick (the queue's chat-backlog lesson).
- **Kit preflight is the engine's, not the agenda's** — the agenda lowers `projReady` when
  `S.kitCheck` fails so DEPOT runs first, but never overrides the preflight with `force`.

---

## 14. Open questions / follow-ups

1. **AGENDA_TICK_MS vs preempt latency.** 2.5s is fine for graded needs but a tool breaking
   mid-dig is felt up to a tick late. Options: shorten to 1s (more CPU), or subscribe to
   `bot.on('diggingCompleted')`/a durability watcher for an event-driven tool preempt. The
   danger side is already event-driven via survival's `__danger.on`.
2. **DEPOT chest selection** is stubbed as `depotChest()`; it should read BASE.md/DEPOT.md
   coordinates (the same source survival's `readHome` uses `protected.json` for). File as a
   shared `basecfg` reader so agenda, survival, and skills agree on home/depot/chest coords.
3. **`restock` skill** does not yet exist as a registered skill; the primitive
   (`ctx.withdrawFromChest`) does. Either add a thin `restock` skill or inline it in
   DEPOT\_RESUPPLY's dispatch. Small; rule-of-twice already met (every excursion restocks).
4. **Finish-it vs interleave** (§4.7 note) — the sign of the `work` term is a one-line
   policy choice that a fixture campaign should settle empirically on the build/mine soaks.
5. **Weight auto-calibration** is explicitly *out of scope for phase 1* (that would be the
   "learning" layer). The defaults + fixture-gated manual tuning are the phase-1 answer; a
   later pass could fit weights to logged (snapshot → human-preferred action) pairs offline,
   still deterministic at runtime.

---

## 15. Skeleton (data shapes, for the implementer)

```js
// globalThis.__agenda
const g = {
  version: 1, enabled: true,
  W: { safety:1.0, heal:0.95, eat:0.90, tool:0.90, depot:0.85, project:0.60, idle:0.15 },
  project: null,            // {id,skill,args,tool,kit,site,priority,progress} | null
  plan: null, planIdx: 0,   // ordered phases; each phase IS a project descriptor + done()
  current: null,            // the action object currently committed
  currentStart: 0,
  myTaskId: null,           // id of the __skills task WE started (vs a driver's)
  lastU: {},                // last utility vector (for snapshot()/audit)
  yield: null,              // 'panic' | 'driver' | null
  busy: false,              // a micro-act is in flight
  lastExternal: 0,          // driver-activity timestamp (patched bot methods)
  dispatching: false,       // true while OUR dispatch calls bot methods (don't count as external)
  fires: 0, errors: 0, switches: [], // switches = ring of timestamps for thrash monitor
  timer: null,
};

const SWITCH_MARGIN = 0.15;
const AGENDA_TICK_MS = 2500;

// ACTIONS: fixed declaration order = deterministic tie-break, highest-tier first
const ACTIONS = [ SEEK_SAFETY, RETURN_HOME_HEAL, EAT, ACQUIRE_TOOL,
                  DEPOT_RESUPPLY, LIGHT_AREA, ADVANCE_PROJECT, IDLE_FALLBACK ];

// public API (LLM + driver)
g.setProject = (p) => { g.plan = null; g.project = p; return g.snapshot(); };
g.setPlan    = (phases) => { g.plan = phases; g.planIdx = 0; g.project = phases[0] || null; return g.snapshot(); };
g.clearProject = () => { g.plan = null; g.project = null; return g.snapshot(); };
g.setWeights = (w) => { for (const k in w) if (k in g.W) g.W[k] = clampW(k, w[k]); return g.W; };
g.snapshot   = () => ({ current: g.current && g.current.id, yield: g.yield, project: g.project && g.project.id,
                        planIdx: g.planIdx, W: g.W, lastU: g.lastU, fires: g.fires, errors: g.errors });
g.stop = () => { g.enabled = false; if (g.timer) clearInterval(g.timer); /* unpatch, restore idleguard */ };
```

Injection order: `skills.js → dangerscan.js → survival.js → agenda.js` (agenda depends on
`__danger` for the danger/light/held fields and on `__survival.active`/`.home`; both fail
soft — absent `__danger` degrades the agenda to vitals-only curves, absent `__survival`
disables the panic-yield and the agenda leans harder on SEEK\_SAFETY). Re-inject after every
reconnect (P0.2 auto-inject stack).
