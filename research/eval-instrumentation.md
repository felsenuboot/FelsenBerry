# Evaluation Instrumentation — codebase audit + telemetry spec

Research track: **instrumentation**. Written 2026-09-01 against engine v13 (`skills.js`
ENGINE_VERSION 13), `runner.js` (v8 payload stack), `dangerscan.js` v2, `survival.js` v1,
`idleguard.js` v5, `digguard.js` v2, `reachguard.js` v1.

**Thesis under test:** *"the LLM thinks once; code runs forever."* That claim is currently
unfalsifiable — nothing in the stack records what an algorithm cost, how often it lied about
success, or how many tokens a driver burned getting an outcome. This document specifies the
smallest instrumentation layer that makes it measurable, and proves the token half is
measurable **today** by computing it from data that already exists on disk (§6.6).

Headline from that measurement, before any code is written:

> **The fleet spent ≈ $287 of list-price-equivalent model time in a 2.6-hour shift to produce
> 365 skill invocations — ≈ $0.79 per task attempt. 71 % of that ($201) was cache-read tokens
> on driver polling turns, not reasoning. The cheapest driver produced a task for $0.26; the
> most expensive for $2.78 — a 10.6× spread across bots running the same engine.**

That spread is the highest-value unexploited signal in the project, and it is recoverable
retroactively for every shift already run.

---

## 0. Contents

1. [Audit — what signal exists today](#1-audit--what-signal-exists-today)
2. [Audit — what is missing](#2-audit--what-is-missing-the-evaluation-gap)
3. [Architecture — where the ledger lives and why](#3-architecture--where-the-ledger-lives-and-why)
4. [Schemas — the event ledger](#4-schemas--the-event-ledger)
5. [Counters — always-on instrumentation points](#5-counters--always-on-instrumentation-points)
6. [Token economy — attributing driver spend to tasks](#6-token-economy--attributing-driver-spend-to-tasks)
7. [`metrics.mjs` — the aggregator and its KPI formulas](#7-metricsmjs--the-aggregator-and-its-kpi-formulas)
8. [Implementation plan — one pass](#8-implementation-plan--one-pass)
9. [Risks, anti-goals, and what NOT to build](#9-risks-anti-goals-and-what-not-to-build)

---

## 1. Audit — what signal exists today

The stack is not un-instrumented. It is instrumented **for a human reading one bot in real
time**, and not at all for **comparing algorithms across bots and shifts**. Every signal below
is real and working; the "Evaluation value" column is the honest verdict.

### 1.1 `skills.js` — task layer

| Signal | Where | Shape | Lifetime | Evaluation value |
|---|---|---|---|---|
| `task.id/name/args` | `S.start` :1001 | strings + raw args object | until next `start()` | High — but **volatile**: overwritten by the next task, never persisted |
| `task.phase` + `task.phases[]` | `ctx.setPhase` :360 | array of phase strings | same | High — free per-phase breakdown, currently discarded |
| `task.startedAt/endedAt` | :1011, :1062 | epoch ms | same | High — exact durations already computed |
| `elapsedS` | `S.status` :1100 | int seconds | poll-time only | Medium — 1 s granularity loses short gotos |
| `task.result` (per-skill) | each `S.define` | rich, e.g. `{banked,dug,lost,rescans,torches,stoppedBecause}` | same | **Very high** — this is the yield data; never leaves memory |
| `task.collected` | `invGains()` :1034 | `{item: delta}` | same | **Very high** — real resource yield per task |
| `task.error{code,message,phase,hint}` | :1050 | object | same | **Very high** — the failure taxonomy already half-exists as `code` |
| `task._gapMs` | :1017 | ms since previous task ended | same | High — direct idle-gap measurement (the no-idle law) |
| `S._history[]` | `_onTaskEnd` :1241 | `{name, ok, code, ms, gapMs, fallback}` | **ring of 6** | High shape, useless retention |
| `S.queueCollected` | :1250 | `{item: total}` per runId | until next runId | Medium |
| `S.log[]` | `pushLog` :192 | `{seq,lvl,msg}`, **ring of 100** | until re-inject | Medium — `phase`/`retry`/`warn` lines are events in prose form |
| `S.queueState/queueHalt/queueDone` | :1106 | enum + object | session | Medium |
| `kitCheck` result | :926 | `{ok,tier,missing[],warnings[]}` | **discarded on rejection** | High — kit failures never reach any counter |

**Verdict:** `skills.js` computes nearly every number an evaluation needs and then throws all
of it away. `S._history` is a 6-slot ring; `S.log` is a 100-line ring; both are wiped by
re-injection (:104) and by every reconnect. There is no path from any of this to disk.

### 1.2 `runner.js` — process/API layer

| Signal | Where | Evaluation value |
|---|---|---|
| `pathStuckRecent` (count of `path_reset('stuck')` in 15 s) | :353–359, :523 | **High** — this is a wedge detector, but it is a *gauge*, not a counter: it decays and is never summed |
| `orphanedGoto` (`listenerCount('path_update') > 1`) | :518–522 | High — leaked-goto detector, sampled only when someone GETs `/state` |
| `stalePayloads[]` | :505–509 | High — payload-death detector, same sampling problem |
| `movements{parkour,maxDropDown,sprint,towers,digCost}` | :510–514 | High — profile-drift detector (the death that started this) |
| `payloads{name: version}` | :490–500 | Medium — version drift |
| `<health> hp=… food=…` log line | :407–413 | Medium — damage is derivable but only by parsing prose |
| `<death>` log line | :415 | High — but prose |
| `<api> eval: <first 200 chars>` | :606 | **High and underrated** — every `__skills.start` call is timestamped in `logs/<bot>.log`; this is how tonight's 365-task count was recovered. But **results are never logged**, so outcomes are invisible |
| `<payload-stack> {json}` | :238 | Medium |

**Verdict:** `runner.js` has the best detectors in the stack (`pathStuckRecent`,
`orphanedGoto`, `stalePayloads`, `movements`) and exposes all of them **only through a pull
endpoint nobody polls on a schedule.** A wedge that self-clears in 14 s is invisible unless a
driver happened to `GET /state` during it. `logs/<bot>.log` records every task *start* and
zero task *ends*.

### 1.3 Guard payloads

| Payload | Counters it keeps | Evaluation value |
|---|---|---|
| `dangerscan.js` v2 | `scans`, `errors`, `score`, `state`, `threats[]`, `held{name,dur%}`, `light/skyLight/surfaceExposed`, `lastStateChange` | **Very high.** Danger score and held-tool durability at 4 Hz, already grafted onto `__skills.status` (:254–281). Nothing records the *transitions* |
| `survival.js` v1 | `fires`, `recovered`, `failures`, `lastBranch`, `lastEvent` (`g.brief()` :512) | **Very high** — panic frequency + branch mix; monotonic counters, never sampled |
| `idleguard.js` v5 | `runs`, `errors`, `stalls`, `idleTicks`, `lastExternal` | **High** — `runs` is the direct "how much time was unproductive" number; `stalls` is a second wedge counter |
| `digguard.js` v2 | `blocked`, `blockedByRegion{}`, `plannerHits`, `reloads` | High — protected-infrastructure near-misses |
| `reachguard.js` v1 | `violations`, `byCall{dig,placeBlock,activateBlock,attack}` | High — the `reach_violation` taxonomy bucket, already counted |
| `graychat.js` v2 | `sent`, `passthrough` | Low |

**Verdict:** five payloads maintain honest monotonic counters that **no code ever reads**.
`survival.fires` and `reachguard.violations` are exactly two of the taxonomy buckets the
evaluation needs, sitting in memory, deleted on reconnect.

### 1.4 Free telemetry available but unwired

Verified against the installed `mineflayer-pathfinder@2.4.5` and `mineflayer@4.38` sources:

| Event | Payload | Notes |
|---|---|---|
| `path_update` | `{status, cost, time, visitedNodes, generatedNodes, path[], context}` (`lib/astar.js:53–63`) | `status ∈ {success, partial, timeout, noPath}`. Fires per replan. **This distinguishes "search budget too small" from "no representation of the route"** — the difference between a tunable loss and an unfixable one |
| `path_reset` | one of `goal_updated, movements_updated, block_updated, chunk_loaded, goal_moved, dig_error, no_scaffolding_blocks, place_error, stuck` (`index.js:146…634`) | A closed enum that **names the wedge cause**. Only `stuck` is currently observed |
| `goal_reached` | `stateGoal` | Currently unobserved |
| `path_stop` | — | Currently unobserved |
| `diggingCompleted` / `diggingAborted` | `block` | Free dig counter, unobserved |
| `playerCollect(collector, collected)` | entities | Free pickup counter, unobserved |
| `entityHurt(entity, source)` | entity | Damage attribution, unobserved |
| `death` / `respawn` | — | Logged as prose only |
| `health` | — | Logged as prose only |

### 1.5 Off-engine sources that already work

- **`logs/<bot>.log`** — ISO-timestamped, server-wide chat transcript plus every `<api>` call.
  Already used in the field for chat archaeology (LEARNING_HANDOFF, kevin-driver). Task
  *starts* are recoverable; outcomes are not.
- **Driver transcripts** — `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<name>-<hash>.jsonl`
  with a sibling `.meta.json` carrying `{"agentType":"bernd-driver","model":"sonnet",…}`.
  Every assistant message carries `message.usage` and an ISO `timestamp`. **This is the token
  ledger and it already exists** (§6).
- **`SCOREBOARD.md`** — a manual, judgment-weighted driver ranking with a hand-maintained
  `score = (100 - 10*rank) - 25*deaths + 5*shipped_findings`. Honest about being manual. The
  aggregator in §7 replaces the numerator of every term in that formula with a measured one.

---

## 2. Audit — what is missing (the evaluation gap)

Eight gaps, in descending order of what they cost the project.

**G1 — No persistence. Every number dies.**
`S._history` holds 6 entries; `S.log` holds 100; both are wiped by re-injection and by
reconnect (`skills.js:104`, and every payload's `bot.once('end')` staleness hook). A shift
produces ~400 task outcomes and retains ~6. There is no file, table, or endpoint that
survives a restart. **Consequence: no algorithm can be compared against its previous version.**

**G2 — Success is self-reported and known to be wrong.**
`task.done = !task.error && !task.cancelled` (`skills.js:1061`). Three documented false-success
modes are invisible to it:
- `goto` resolving on an empty path (patched in `ctx.goto` :421–430, but the *save* is never
  counted — we cannot tell how often that assertion fires);
- `safeDescend` reporting 96 steps for 1 level of descent;
- `craftSafe` reporting `ok:true` with `made < want`.

`ok` and `made/want` both exist in the returned object; nothing compares them. **The single
most important evaluation metric — "how often does the engine lie to its driver" — has no
denominator today.**

**G3 — Failures are classified inconsistently and never counted.**
`task.error.code` carries ~16 values from three sources (`fatal()` codes, pathfinder error
names prefixed `path_`, and `retries_exhausted`), plus `HALT_ALWAYS` defines a *different*
7-value set for queue policy. The field taxonomy in LEARNING_HANDOFF (wedge / false_success /
timeout / kit_missing / reach_violation / death / silent tool breakage) maps onto **none** of
them cleanly. `kit_missing` is worst: `S.start` returns it as an early `{ok:false}` **before a
task object exists** (:991–996), so a half-kitted bot that never departs leaves no trace in any
task record at all.

**G4 — Movement quality is unmeasured.**
No distance traveled, no crow-flies baseline, no per-leg timing, no route classification. The
`goto2` A/B plan (`research/goto2-ab-plan.md` §3) specifies exactly the right metrics —
`arrived`, `falseSuccess`, `dist`, `blocksBroken`, `visitedNodes`, `stuckResets` — and then
requires a **human to hand-fill a 60-row CSV**. Six hours of manual work for data the engine
could emit for free on every goto it already performs.

**G5 — Wedges are detected but not accumulated.**
Three independent wedge detectors exist (`ctx.goto`'s 6 s stall + unstick ladder,
`idleguard`'s stall-buster, `runner`'s `pathStuckRecent`) and **none of them increments a
persistent counter**. `unsticks` is a local `let` in `ctx.goto` (:407), discarded on return.
Wedge rate — the KPI that would have justified the `blocksToAvoid` fix in an afternoon — is
unknown before and after the fix.

**G6 — Silent tool breakage has a detector with no memory.**
`dangerscan` computes held-tool durability at 4 Hz and logs `tool_low` once per 5 %-bucket
(:219–227). It never records the moment a tool actually *hits zero and vanishes*, which is the
event that cost a full round trip to base. Digs-per-tool-break is computable from
`diggingCompleted` + the durability stream and is currently computed by nobody.

**G7 — Token cost is not attributed to anything.**
No component knows what a driver spent. `SCOREBOARD.md` ranks drivers by judgment. The data
exists (§6) and is unread. **The stack's founding thesis is about token cost and the project
has never measured it.**

**G8 — Utilization is unmeasured.**
`task._gapMs` measures the gap between tasks and is computed, stored on the task, exposed in
`queueInfo().history`, and then dropped from the 6-slot ring. `idleguard.runs` counts guard
takeovers. Neither is persisted, so "what fraction of a bot-hour was spent inside a task"
— the no-idle law's actual metric — is unknown.

---

## 3. Architecture — where the ledger lives and why

### 3.1 The constraint that decides the design

`skills.js` and every guard payload are **`/eval` bodies compiled with `new AsyncFunction`**
(`runner.js:186, :608`). They cannot `require()` at the top level. `digguard.js:20` proves
`process.mainModule.require('fs')` works from inside a payload — but taking that route means
**seven payloads each opening their own file handle, each with its own flush policy, each
leaking one on every reconnect.**

**Decision: exactly one writer, and it lives in `runner.js`'s module scope.**

```
runner.js (CJS, has fs/path, one per bot process, survives reconnect)
  └── require('./telemetry.js')  →  globalThis.__metrics
                                     ├── .emit(type, fields)      ← the only write path
                                     ├── .span(kind, fields)      ← open/close timed spans
                                     ├── .counters                ← monotonic in-memory
                                     └── writes logs/metrics-<bot>.jsonl (append-only stream)

skills.js / dangerscan.js / survival.js / idleguard.js
  └── globalThis.__metrics?.emit(...)   ← optional, try/catch, no-op if absent
```

Properties this buys:

- **One process per bot ⇒ one file per bot ⇒ zero cross-process write contention.** Each
  `runner.js` owns `logs/metrics-<NAME>.jsonl` exclusively. No locking, no interleaving.
- **Survives reconnect.** The bot object is rebuilt on reconnect (`createBot()` :321);
  `globalThis` is not. Counters and the file handle live across every reconnect and every
  payload re-injection — the exact failure mode that kills every existing counter.
- **Fails open.** Every call site is `try { globalThis.__metrics?.emit(…) } catch {}`. An older
  `runner.js` process running a newer `skills.js` degrades to today's behavior silently.
- **No `require()` in payloads.** The design invariant at `skills.js:1–17` is preserved.

### 3.2 Write policy

`fs.createWriteStream(file, { flags: 'a' })`, one `stream.write(JSON.stringify(rec) + '\n')`
per event. **Not `appendFileSync`** — a synchronous append inside `_onTaskEnd` would block the
strictly-synchronous queue advance (`skills.js:1152` — "MUST STAY STRICTLY SYNCHRONOUS"). A
write stream buffers in userspace and flushes on the event loop, so the zero-gap handover is
untouched.

- Flush on `process.on('exit' | 'SIGINT' | 'SIGTERM')` and on `bot.on('end')`.
- Backpressure: if `stream.write()` returns `false`, increment `counters.telemetry_backpressure`
  and keep writing (events are small; the kernel buffer will drain). Never `await` a drain in
  a task path.
- **Rotation:** on open, if the file exceeds 32 MB, rename to
  `metrics-<NAME>.<ISO-date>.jsonl` and start fresh. At the measured volume (§5.5) this fires
  roughly never; it exists so an unattended week cannot fill the disk.
- `logs/` is already in `.gitignore` — the ledger is local operational data, not repo content.

### 3.3 Read paths

Two, deliberately:

1. **`GET /metrics`** on the runner — in-memory rollups only (no file read). One HTTP call
   gives a driver or supervisor the current counters, the last N task outcomes, and the live
   gauges. **This is the token-cheap path**: a supervisor polling 6 bots costs 6 small JSON
   bodies instead of six file reads and a parse.
2. **`metrics.mjs`** offline over `logs/metrics-*.jsonl` — the full KPI computation (§7).
   Runs on a laptop, no server contact, works on historical shifts.

---

## 4. Schemas — the event ledger

### 4.1 Envelope (every record)

Every line in `logs/metrics-<bot>.jsonl` is one JSON object with this envelope. Field names
are short deliberately — at ~2 400 records/bot/shift the envelope is ~15 % of bytes.

```jsonc
{
  "v":   1,                    // int   — ledger schema version. Bump on ANY breaking change.
  "t":   1756684800123,        // int   — Date.now() at emit, epoch ms, UTC
  "bot": "BuddelBernd",        // str   — runner --name; the join key to roster.json
  "run": "r1756684321",        // str   — process run id: 'r' + start epoch seconds.
                               //         Changes on process restart, NOT on reconnect.
  "seq": 417,                  // int   — monotonic per run, gap = lost write
  "ev":  "task_end",           // str   — event type (closed set, §4.2)
  "ev_v": 1                    // int   — per-event-type schema version (optional; default 1)
  // ...event-specific fields, flat, no nesting deeper than 2
}
```

**Invariants the aggregator relies on:**
- `(bot, run, seq)` is unique. A gap in `seq` means a dropped write — the aggregator reports
  it rather than silently under-counting.
- `t` is non-decreasing within a `run`.
- Unknown `ev` values are skipped with a warning, never fatal. Forward compatibility is free.
- No field is ever repurposed. To change a meaning, add a field and bump `ev_v`.

### 4.2 Event types

| `ev` | Emitted by | Approx. per shift per bot | Purpose |
|---|---|---|---|
| `session` | `telemetry.js` on open | 1–3 | Run boundaries, versions, roster context |
| `connect` | `bot.on('spawn')` / `bot.on('end')` | 2–20 | Uptime, reconnect storms |
| `task_start` | `S.start` **before** kit preflight | ~130 | Attempt count (denominator) |
| `task_end` | `S.start`'s IIFE, before `_onTaskEnd` | ~130 | **The primary record** |
| `goto` | `ctx.goto` on exit (any path) | ~600 | Movement quality, SPL, wedges |
| `wedge` | `ctx._unstick`, idleguard stall-buster | ~15 | Wedge taxonomy detail |
| `dig_batch` | `telemetry.js` rollup, every 64 digs or task end | ~40 | Dig throughput, tool wear |
| `tool_break` | `telemetry.js` durability watcher | ~3 | Silent breakage, digs-per-break |
| `danger` | `dangerscan` state transitions | ~30 | Threat exposure |
| `panic` | `survival.js` enter/exit | ~4 | Reflex frequency and branch mix |
| `death` | `bot.on('death')` | 0–2 | The hard failure |
| `craft` | `S.craftSafe` per call | ~20 | Craft under-production |
| `chest` | `depositToChest` / `withdrawFromChest` | ~15 | Depot economy |
| `guard` | rollup every 60 s **only if a counter changed** | ~20 | digguard/reachguard/idleguard deltas |
| `note` | manual `__metrics.emit('note',…)` from an /eval | rare | Driver-marked experiment boundaries |

Total ≈ **1 000–1 500 records/bot/shift ≈ 400 KB.** Six bots, a full night: under 3 MB.

### 4.3 `task_start`

Emitted at the **top** of `S.start`, immediately after the `busy`/`unknown_skill`/`bad_args`
guards and **before** the kit preflight — so that a `kit_missing` rejection produces a
matching `task_end` and appears in the denominator (fixes **G3**).

```jsonc
{
  "v":1,"t":…,"bot":"BuddelBernd","run":"r…","seq":412,"ev":"task_start",
  "tid":   "t1m9k2xa",          // str — task.id; joins task_start↔task_end↔goto↔dig_batch
  "skill": "mineLane",          // str — registry key
  "adg":   "9f3c1b02",          // str — args digest, 8 hex, FNV-1a over canonical JSON (§4.9)
  "akey":  {"target":"iron_ore","count":12,"vein":true},  // obj — salient args only (§4.9)
  "src":   "driver",            // enum: driver | queue | fallback | idleguard
  "qid":   null,                // str|null — queue item id when src=queue
  "gap_ms": 41200,              // int|null — task._gapMs: idle time since previous task end
  "pos":   [-4,111,3],          // [int,int,int] — start position, floored
  "hp":    20.0, "food": 19,    // num, int
  "kit":   {"tier":"underground","ok":true,"missing":[]},  // from S.kitCheck
  "inv":   {"torch":34,"cobblestone":128,"iron_pickaxe":1},// obj — counts of KEY items only (§4.9)
  "held":  {"name":"iron_pickaxe","dur":72},               // from __danger.held; null if absent
  "danger":{"score":0.4,"state":"calm"},                   // from __danger; null if absent
  "sky":   true,                // bool|null — __danger.surfaceExposed
  "prof":  "base"               // enum: base | HAUL | WORK | CAVE | unknown
}
```

### 4.4 `task_end` — the primary record

Emitted in `S.start`'s IIFE **after** the `finally` block sets terminal state and **before**
`S._onTaskEnd(bot, task)`. Placement matters: `_onTaskEnd` starts the next task synchronously,
so emitting after it would time-order records wrongly.

```jsonc
{
  "v":1,"t":…,"bot":"BuddelBernd","run":"r…","seq":438,"ev":"task_end",
  "tid":     "t1m9k2xa",
  "skill":   "mineLane",
  "adg":     "9f3c1b02",

  // ---- outcome ----
  "outcome": "ok",              // enum, §4.5 — THE classification. Closed set, stable forever.
  "code":    null,              // str|null — raw task.error.code, open set, may grow
  "msg":     null,              // str|null — task.error.message, truncated to 160
  "phase":   "mining",          // str — phase at exit (task.error.phase or last of task.phases)
  "phases":  ["starting","travelling","mining","banking"],  // str[] — capped at 12
  "assert":  null,              // str|null — which false-success assertion fired (§4.6)

  // ---- production ----
  "yield":   0.75,              // num|null — achieved/requested, §4.6. null when undefined.
  "want":    12, "got": 9,      // num|null — the two operands behind `yield`, in skill units
  "collected": {"raw_iron":9,"cobblestone":47},  // task.collected — invGains delta
  "result":  {"banked":9,"dug":118,"lost":2,"rescans":1,"torches":6,"stoppedBecause":"count"},
                                // obj — task.result verbatim, capped at 24 keys / 2 KB

  // ---- cost ----
  "ms":      284310,            // int — endedAt - startedAt
  "digs":    118,               // int — diggingCompleted during [start,end]
  "placed":  6,                 // int — successful placeBlock during [start,end]
  "torches": 6,                 // int — from result.torches when present, else placement count
  "moved":   412.7,             // num — traveled distance, 2 Hz sampler, §5.2
  "crow":    96.4,              // num — Σ crow-flies of goto legs inside this task
  "spl":     0.23,              // num|null — crow/max(moved,crow) when outcome=ok, §7.2
  "dmg":     6.5,               // num — total HP lost during the task
  "deaths":  0,                 // int
  "gotos":   4,                 // int — goto spans opened
  "wedges":  1,                 // int — goto spans where unstick fired
  "unsticks":2,                 // int — total unstick invocations
  "retries": 1,                 // int — ctx.retry attempts beyond the first
  "panics":  0,                 // int — survival.js entries during the task
  "reach_viol": 0,              // int — reachguard delta during the task
  "dig_blocked":0,              // int — digguard delta during the task

  // ---- exit state ----
  "pos":  [-11,44,29], "hp": 13.5, "food": 16,
  "held": {"name":"iron_pickaxe","dur":41},
  "danger":{"score":1.2,"state":"calm"},
  "queue": {"state":"running","done":3,"total":5}   // obj|null
}
```

### 4.5 `outcome` — the closed enum, with exact precedence

This is the contract the whole evaluation rests on. **Evaluate top to bottom; first match
wins.** The rule set is written so it can be dropped into `telemetry.js` as a pure function of
`(task, span)` with no engine changes beyond passing the span counters in.

| # | `outcome` | Fires when | Taxonomy origin |
|---|---|---|---|
| 1 | `death` | a `death` event occurred between `task_start` and `task_end` | LEARNING_HANDOFF: 3 deaths |
| 2 | `disconnected` | `task._disconnected` or `code === 'disconnected'` | engine |
| 3 | `timeout` | `code ∈ {timeout, path_timeout, chest_open_timeout, dig_timeout, equip_timeout}` **and** `span.unsticks === 0` | LEARNING_HANDOFF: timeout |
| 4 | `wedge` | `code === 'stuck'`, **or** `span.unsticks ≥ 1`, **or** (`code === 'path_timeout'` **and** `span.moved < 2`) | LEARNING_HANDOFF: leaf_litter / torch / hitbox wedges |
| 5 | `kit_missing` | `S.start` rejected on preflight (`code === 'kit_missing'`) | LEARNING_HANDOFF: kit preflight |
| 6 | `no_tool` | `code === 'no_tool'`, **or** a `tool_break` event fired inside the task | LEARNING_HANDOFF: silent tool breakage |
| 7 | `reach_violation` | `code === 'reach_violation'` or `span.reach_viol > 0` **and** the task failed | reachguard |
| 8 | `low_health` | `code === 'low_health'` | engine |
| 9 | `inv_full` | `code === 'inv_full'` | engine |
| 10 | `no_path` | `code === 'no_path'` | engine (incl. the empty-path assertion) |
| 11 | `not_found` | `code ∈ {not_found, unreachable}` | engine |
| 12 | `cancelled` | `task.cancelled` and no error (stop/skip) | LEARNING_HANDOFF: cancelled |
| 13 | `bad_input` | `code ∈ {bad_args, unknown_skill, busy, queue_full}` | engine — **operator error, exclude from algorithm success rates** |
| 14 | `error` | any other `code` (`retries_exhausted`, `bug`, `queue_thrash`, `path_*`, …) | catch-all; `code` retains the detail |
| 15 | `false_success` | `task.done === true` **and** an assertion in §4.6 returned a failure | **LEARNING_HANDOFF: goto empty-path, staircase 96/1** |
| 16 | `ok` | `task.done === true` and every assertion passed | — |

Two rules that make this survive schema drift:

- **`outcome` is closed and permanent.** New failure kinds go in `code` first, and only get
  promoted to an `outcome` value with a `v` bump.
- **`bad_input` is excluded from every algorithm KPI by default.** A driver typo is not an
  engine failure; keeping it in the same bucket as `wedge` corrupts every success rate.

### 4.6 False-success assertions (per skill) and `yield`

The engine already returns everything needed; nothing here requires new gameplay code. Each
assertion is a pure function of `(task, bot)` run once, in the IIFE, **after** `task.done` is
set. Both outputs are recorded: `assert` (which rule fired) and `yield` (a continuous ratio,
so partial credit is measurable without a binary verdict).

| Skill | `want` / `got` | `false_success` when | Rationale (field evidence) |
|---|---|---|---|
| `come` | `1` / `dist ≤ range+1 ? 1 : 0` | final position farther than `range + 1.5` from `(x,y,z)` | `ctx.goto`'s empty-path noPath; `come` returns **no result object**, so position is the only ground truth |
| `safeDescend` | `startY - toY` / `startY - endY` | `got < 2` **and** `steps > 8` | the documented 96-steps/1-level report |
| `buildStaircase` | same | same | same class |
| `mineLane` | `args.count` / `result.banked` | `banked === 0` **and** `dug > 0` | dug-but-banked-nothing = drops lost or wrong target |
| `chopTrees` | `args.count` / `result.treesFelled` | `treesFelled === 0` **and** `logsDug > 0` | placed-log incident: logs harvested, no tree felled |
| `huntAnimals` | `result.of` / `result.killed` | `killed === 0` **and** `swings > 3` | swinging at nothing = reach or target-lock failure |
| `collectDrops` | `picked + unreachable` / `picked` | never (best-effort by contract) | do not punish an honest sweep |
| `buildWall`/`buildFloor`/`frameStructure`/`buildSchematic` | `result.blocks` / `result.verified.ok` | `verified.ok < blocks` | **the engine already verifies with `blockAt`** — free ground truth |
| `depositToChest` | items offered / items moved | moved `=== 0` with a non-empty offer | chest full / window desync |
| `craftSafe` (via `craft` event) | `times` / `made` | `made < times` | reproduced stackable void quirk |
| anything else | `null` | never | absent assertion ⇒ `yield: null`, excluded from yield KPIs |

> **Note for the implementer:** put these in one `ASSERTS` object keyed by skill name at the
> bottom of `skills.js`, next to the registry. Do **not** scatter them into each `fn` — the
> whole point is that the assertion is independent of the code that might be lying.

### 4.7 `goto` — the movement sub-event

Emitted by `ctx.goto` on **every** exit path (`return`, `throw`, `Cancelled`) from inside its
existing `finally` block (`skills.js:455`), which already runs on all three.

```jsonc
{
  "v":1,"t":…,"bot":"BuddelBernd","run":"r…","seq":419,"ev":"goto",
  "tid":   "t1m9k2xa",          // str|null — enclosing task, null when unattributed
  "gid":   "g1m9k31f",          // str — span id
  "goal":  "GoalNear",          // str — goal.constructor.name
  "range": 2,                   // num|null
  "from":  [-4,111,3], "to": [-11,44,29],
  "crow":  73.4,                // num — Euclidean |to - from| at span open
  "moved": 118.9,               // num — sampled traveled distance (§5.2)
  "ms":    41200,
  "tmo":   30000,               // int — timeoutMs argument
  "res":   "arrived",           // enum: arrived | no_path | path_timeout | stuck | cancelled | error
  "assert_fail": false,         // bool — the empty-path arrival assertion rejected a "success"
  "unsticks": 1,                // int
  "prof":  "HAUL",              // enum
  "class": "MEDIUM_DESCENT",    // enum — route class, §4.8

  // pathfinder's free telemetry, aggregated over the span (NOT one record per replan)
  "replans": 7,                 // int — path_update count
  "pf": {"success":5,"partial":2,"timeout":0,"noPath":0},   // path_update.status histogram
  "nodes": {"visited":18422,"generated":26109,"ms":940},    // sums over the span
  "resets": {"stuck":3,"block_updated":1,"goal_moved":0}    // path_reset reason histogram
}
```

`resets.stuck ≥ 3` inside one span is the machine-readable form of the wedge signature that
`runner.js:351` describes in a comment. `pf.timeout > 0` with `res:"no_path"` means the search
budget was the binding constraint (tunable); `pf.noPath > 0` means the planner has no
representation of the route (not tunable) — **exactly the distinction the goto2 A/B needs to
make its adoption call honestly**, and it comes for free.

### 4.8 Route classes

Assigned by `telemetry.js` from the span's own numbers. These map 1:1 onto the `goto2` A/B
route classes so the ledger can produce that CSV without a human walking 60 trips.

```js
function routeClass (crow, dy, sky, tid) {
  const vertical = Math.abs(dy) > 0.5 * crow && Math.abs(dy) > 8;
  const size = crow < 16 ? 'SHORT' : crow <= 80 ? 'MEDIUM' : 'LONG';
  const terrain = vertical ? '_DESCENT' : (sky === false ? '_ENCLOSED' : '_OPEN');
  return size + terrain;                 // e.g. SHORT_ENCLOSED, LONG_OPEN, MEDIUM_DESCENT
}
```

| Class | goto2 A/B analogue | Why it is its own class |
|---|---|---|
| `SHORT_ENCLOSED` | R1 (cluttered base move) | tight quarters; where greedy heuristics lose |
| `SHORT_OPEN` | — | the plaza baseline; near-zero variance expected |
| `MEDIUM_OPEN` | R2 (the 60 s timeout route) | detour-heavy sloped forest |
| `LONG_OPEN` | R3 (325-block haul) | past every waypointing threshold |
| `MEDIUM_DESCENT` / `LONG_DESCENT` | R4 (ridge), R6 (shaft) | fall exposure; the class that killed a bot |
| `*_ENCLOSED` at `sky === false` | R6 | cave routing under the LIGHT rule |

### 4.9 Args digest, salient args, and inventory keys

**`adg` (args digest)** — groups *identical call shapes* across bots and shifts without storing
arbitrary driver-supplied data:

```js
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object')
    ? Object.keys(v).sort().reduce((o,k) => (o[k] = canon(v[k]), o), {})
    : v;
function adg (args) {                       // FNV-1a 32-bit, 8 hex chars
  const s = JSON.stringify(canon(args ?? {}));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
```

**`akey` (salient args)** — a skill-declared whitelist, so KPIs can be grouped by the parameter
that actually varies the algorithm rather than by coordinates that never repeat:

```js
const SALIENT = {
  come:            (a) => ({ range: a.range ?? 1 }),
  collectDrops:    (a) => ({ radius: a.radius ?? 16 }),
  chopTrees:       (a) => ({ types: a.types ?? 'any', count: a.count ?? 1, replant: a.replant !== false }),
  mineLane:        (a) => ({ target: a.target, count: a.count ?? 8, vein: a.vein !== false }),
  huntAnimals:     (a) => ({ species: a.species ?? ['cow'], count: a.count ?? 1 }),
  safeDescend:     (a) => ({ toY: a.toY, torchEvery: a.torchEvery ?? 8 }),
  buildStaircase:  (a) => ({ toY: a.toY, material: a.material ?? 'cobblestone_stairs' }),
  buildWall:       (a) => ({ material: a.material, cells: (a.width ?? 5) * (a.height ?? 3) }),
  buildFloor:      (a) => ({ material: a.material, cells: (a.width ?? 5) * (a.length ?? 5) }),
  frameStructure:  (a) => ({ w: a.width, d: a.depth, h: a.height }),
  buildSchematic:  (a) => ({ name: a.name }),
  depositToChest:  (a) => ({ keepTools: a.keepTools !== false }),
};
```

**`inv` (inventory snapshot)** — never the whole inventory. A fixed key list keeps the record
small and comparable:

```js
const INV_KEYS = ['torch','cobblestone','oak_log','oak_planks','bread','coal','raw_iron',
                  'iron_ingot','diamond','stick','dirt','wheat','iron_pickaxe','stone_pickaxe',
                  'wooden_pickaxe','iron_axe','iron_sword','shield','water_bucket'];
```

### 4.10 Remaining event schemas

```jsonc
// ev:"session" — first record of every run
{"ev":"session","t":…,"bot":"BuddelBernd","run":"r…","seq":0,
 "pid":48211,"port":3103,"role":"miner","driver":"bernd-driver",
 "engine":{"skills":13,"dangerscan":2,"survival":1,"idleguard":5,"digguard":2,"reachguard":1},
 "node":"v24.20.0","mc":"1.21.11","ledger_v":1,"started":"2026-09-01T00:12:04.221Z"}

// ev:"connect"
{"ev":"connect","state":"spawn","ms_since_last":null,"reconnects":0,"reason":null}
{"ev":"connect","state":"end","ms_since_last":4210331,"reconnects":1,"reason":"socketClosed"}

// ev:"wedge" — one per unstick invocation; the goto span carries the count
{"ev":"wedge","tid":"t…","gid":"g…","src":"ctx.goto",   // src: ctx.goto | idleguard
 "pos":[-11,44,29],"feet":"torch","cause":"torch",       // cause: torch|leaf_litter|hitbox|unknown
 "nuisance_dug":["torch"],"cleared":true,"attempt":1,"still_ms":6100}

// ev:"dig_batch" — rolled up every 64 digs or at task end; NEVER one record per dig
{"ev":"dig_batch","tid":"t…","n":64,"ms":41200,
 "blocks":{"stone":51,"iron_ore":9,"deepslate":4},
 "tool":"iron_pickaxe","dur_from":72,"dur_to":58,"aborted":2}

// ev:"tool_break" — durability watcher, §5.4. The G6 fix.
{"ev":"tool_break","tid":"t…","tool":"iron_pickaxe","digs_since_equip":238,
 "replacement":"wooden_pickaxe","have_spare":true,"warned_at_pct":15,"ms_since_warn":184000}

// ev:"danger" — state TRANSITIONS only (dangerscan already dedupes at :230)
{"ev":"danger","from":"calm","to":"alert","score":3.4,
 "top":{"name":"skeleton","d":11.2,"los":true},"n":3,"hp":16.5,"sky":false,"tid":"t…"}

// ev:"panic"
{"ev":"panic","state":"enter","why":"danger","branch":null,"hp":7.5,"score":6.1,"tid":"t…"}
{"ev":"panic","state":"exit","why":null,"branch":"BREAK_LOS","hp":11.0,"ms":18400,
 "recovered":true,"tid":"t…"}

// ev:"death"
{"ev":"death","tid":"t…","skill":"safeDescend","pos":[-11,-31,29],
 "hp_before":6.0,"danger":{"score":5.4,"state":"panic"},"top_threat":"skeleton",
 "sky":false,"ms_into_task":284310,"last_dmg_ms_ago":900,"deaths_this_run":1}

// ev:"craft" — one per S.craftSafe call (§4.6 under-production)
{"ev":"craft","tid":"t…","item":"torch","want":8,"made":8,"calls":2,
 "table":true,"voided":false,"ms":2100}

// ev:"chest"
{"ev":"chest","tid":"t…","op":"deposit","pos":[-5,111,3],
 "moved":{"cobblestone":64,"raw_iron":9},"n":73,"full":false,"ms":6100}

// ev:"guard" — 60 s rollup, emitted ONLY when a counter changed (§5.3)
{"ev":"guard","window_ms":60000,
 "digguard":{"blocked":2,"plannerHits":41},
 "reachguard":{"violations":1,"byCall":{"dig":1}},
 "idleguard":{"runs":1,"stalls":2,"errors":0},
 "danger":{"scans":240,"errors":0},
 "survival":{"fires":0,"recovered":0,"failures":0}}

// ev:"note" — experiment boundaries, from a driver's /eval
{"ev":"note","tag":"ab:goto2:R2:run3","text":"ashfinder leg, outbound"}
```

---

## 5. Counters — always-on instrumentation points

The design rule: **event-driven where mineflayer gives an event; one 500 ms timer for
everything else; never a per-tick (20 Hz) listener.**

### 5.1 Attach site and the listener-count trap

All listeners attach **once per bot instance** inside `createBot()` (`runner.js:321`), next to
the existing `path_reset` hook at :353 — *not* inside `bot.on('spawn')`, which fires again on
death-respawn and would leak a duplicate set each time. The existing comment at :348–352 makes
exactly this point; follow it.

> **⚠️ Required companion edit — this WILL silently break an existing detector.**
> `runner.js:522` computes `orphanedGoto = bot.listenerCount('path_update') > 1`. Adding a
> permanent telemetry listener on `path_update` makes that expression **always true**, silently
> converting a working leaked-goto detector into a stuck alarm. Fix it in the same commit:
>
> ```js
> // telemetry.js records how many listeners IT attached, per event name
> const base = 1 + ((globalThis.__metrics && globalThis.__metrics.pathListeners) || 0);
> orphanedGoto = bot.listenerCount('path_update') > base;
> ```
>
> Do not hardcode `> 2`. `pathListeners` must be a real property set by `telemetry.js` so the
> two files cannot drift.

### 5.2 The 500 ms sampler (the only timer)

One `setInterval(sample, 500)` per process. It is also the process heartbeat.

```js
function sample () {
  const e = bot && bot.entity; if (!e || !e.position) return;
  const p = e.position;
  if (last) {
    const d = p.distanceTo(last);
    if (d > 0.05 && d < 30) {           // dead-band kills float jitter; 30 rejects teleports
      C.moved += d;                      // process-lifetime odometer
      for (const s of spans) s.moved += d;   // every open span (task + goto)
    }
  }
  last = p.clone();
  if (typeof bot.health === 'number') {
    if (lastHp != null && bot.health < lastHp) {
      const dmg = lastHp - bot.health;
      C.dmg += dmg; for (const s of spans) s.dmg += dmg;
    }
    lastHp = bot.health;
  }
}
```

**Cost:** ~2 float ops + one `Vec3.distanceTo` per 500 ms. Immeasurable.

**Accuracy caveat, state it in the report output:** 2 Hz sampling under-counts a wiggling path
by roughly 5–15 % versus true per-tick integration. It is **consistently** biased, so
comparisons between algorithms, profiles, and engines are valid; absolute path length is a
lower bound. Do not raise to 20 Hz — a per-tick `move` listener is the one thing here that
would show up in a profiler, and the added fidelity changes no decision.

**Damage attribution via sampling** also under-counts: two hits inside one 500 ms window that
are partially regenerated read as one smaller hit. Acceptable for a damage *index*. If exact
damage matters later, add `bot.on('entityHurt')` filtered to `bot.entity` — event-driven and
cheap — but the health delta is the honest total including fall, drowning, and starvation.

### 5.3 Event listeners (all event-driven, zero polling)

| Listener | Work per fire | Frequency |
|---|---|---|
| `diggingCompleted` | `C.digs++`, per-span `digs++`, block-name tally; flush a `dig_batch` every 64 | ≤ 3 Hz during mining |
| `diggingAborted` | `C.digs_aborted++` | rare |
| `path_update` | span histogram + node sums; **no record emitted** | ~0.3 Hz |
| `path_reset` | span reason histogram; keep the existing 15 s `_pathStuckTimes` window | ~0.3 Hz |
| `goal_reached` | mark the open goto span `reached:true` | per goto |
| `death` | emit `death`, `C.deaths++`, mark all open spans `died:true` | rare |
| `respawn` | reset `lastHp` so the respawn heal is not counted as damage | rare |
| `health` | nothing — the 500 ms sampler owns HP (avoids a duplicate path) | — |
| `end` / `spawn` | emit `connect`, flush the stream | rare |

The guard rollup is a second, much slower timer (60 s) that **diffs the payload counter objects
and emits nothing when every delta is zero.** On a quiet bot that is one comparison per minute
and no I/O.

### 5.4 The tool-break watcher (closes G6)

`dangerscan` already computes `held.dur` at 4 Hz. The watcher is ~12 lines in `telemetry.js`:

```js
// remembers the last non-null durability per tool NAME; on transition to
// "held tool changed AND the previous tool is no longer in inventory", emit tool_break.
if (prevHeld && prevHeld.name !== held?.name && prevHeld.dur != null && prevHeld.dur <= 6
    && !bot.inventory.items().some((i) => i.name === prevHeld.name)) {
  emit('tool_break', { tool: prevHeld.name, digs_since_equip: digsSinceEquip,
                       replacement: held?.name ?? null,
                       have_spare: /* any other _pickaxe in inventory */,
                       warned_at_pct: lastWarnPct, ms_since_warn: … });
}
```

The `dur ≤ 6 %` guard plus the disappeared-from-inventory check distinguishes a **break** from
an ordinary tool swap. This yields **digs-per-tool-break**, the metric that turns "tools break
silently" from an anecdote into a maintenance interval.

### 5.5 Overhead budget (measured against tonight's shift)

| Cost | Estimate | Basis |
|---|---|---|
| CPU, sampler | 2 Hz × ~6 float ops | negligible |
| CPU, listeners | ≤ 5 Hz aggregate during heavy mining | negligible |
| Memory | ~4 KB counters + ≤ 8 open spans | negligible |
| Disk writes | ~1 300 records × ~380 B ≈ **480 KB/bot/shift** | §4.2 volume × envelope |
| Event-loop blocking | **zero** — stream `.write()`, no sync fs, no `await` in task paths | §3.2 |
| Chat / in-game | **zero** — the ledger never speaks (respects the chat-diet directive) | — |
| Tokens | **zero** — no driver reads the ledger during a task | by design |

The design constraint "cheap enough to always-on" is satisfied with three orders of magnitude
of headroom. There is no sampling mode and no on/off switch to forget to turn on. If a kill
switch is wanted: `--no-metrics` sets `globalThis.__metrics = null` and every call site
no-ops — but the default must be on, or the data will not exist when it is needed.

---

## 6. Token economy — attributing driver spend to tasks

### 6.1 The options, and the verdict

| Option | Verdict |
|---|---|
| **A. Drivers self-report tokens per shift** | **Reject.** A model cannot observe its own usage; the number would be a hallucinated estimate entering a fitness function that retires drivers. Worse than no data. |
| **B. Count driver actions as a proxy** (task starts, polls, evals) | **Keep as a secondary.** Free from `logs/<bot>.log` and from ledger `src` fields, useful as a cross-check, but a poor cost proxy: turns vary ~50× in context size. |
| **C. Parse teammate transcripts** | **Adopt.** Ground truth, already on disk, zero driver overhead, **retroactive over every shift already run**, and costs nothing at runtime. |
| **D. OpenTelemetry export from Claude Code** | **Secondary/optional.** Gives live streaming metrics rather than post-hoc files. Worth wiring if a live dashboard is ever wanted; not needed for evaluation and adds a moving part. |

**Adopt C, cross-check with B.**

### 6.2 Where the data is (verified on this machine)

```
~/.claude/projects/<cwd-slug>/<sessionId>/subagents/
    agent-<agentName>-<hash>.jsonl        ← the transcript
    agent-<agentName>-<hash>.meta.json    ← {"agentType":"bernd-driver","name":"bernd-driver",
                                          →  "model":"sonnet","taskKind":"in_process_teammate"}
```

Every assistant record carries an ISO `timestamp` and a full `usage` block:

```jsonc
{"type":"assistant","timestamp":"2026-08-31T23:46:09.008Z",
 "requestId":"req_011Ceb…","message":{"id":"msg_011Ceb…","model":"claude-sonnet-5",
 "usage":{"input_tokens":2,"cache_creation_input_tokens":6739,
          "cache_read_input_tokens":25307,"output_tokens":3,…}}}
```

### 6.3 The dedupe rule — get this wrong and every number is inflated

**Streaming writes several JSONL rows per API request, all sharing `message.id` and
`requestId`, and the `usage` numbers differ between them** (verified: the same `message.id`
appears with two different `output_tokens` values). Naively summing rows over-counts by roughly
2.5×.

> **Rule: group assistant records by `message.id`; within each group keep the single record
> with the maximum `output_tokens`; sum across groups.** Never sum rows. Never dedupe on
> `uuid` (unique per row) or on `timestamp` (ties).

Reference implementation, exactly as used to produce §6.6:

```bash
jq -s -r '
  [ .[] | select(.type=="assistant" and .message.usage) | {id:.message.id, ts:.timestamp, u:.message.usage} ]
  | group_by(.id) | map(max_by(.u.output_tokens))
  | { turns: length,
      inp: (map(.u.input_tokens)             | add),
      out: (map(.u.output_tokens)            | add),
      cw:  (map(.u.cache_creation_input_tokens // 0) | add),
      cr:  (map(.u.cache_read_input_tokens    // 0) | add) }' agent-abernd-driver-*.jsonl
```

### 6.4 The join: transcript → bot → task

Two pieces are needed and one does not exist yet.

**(a) `roster.json`** — new file, repo-tracked, ~20 lines. This is the missing map between an
LLM agent name and a Minecraft bot:

```jsonc
{ "bots": [
  { "name": "BuddelBernd",   "port": 3103, "role": "miner",      "driver": "bernd-driver" },
  { "name": "FurzFriedrich", "port": 3101, "role": "lumberjack", "driver": "friedrich-driver" },
  { "name": "MettMarcel",    "port": 3102, "role": "hunter",     "driver": "marcel-driver" },
  { "name": "PflasterPeter", "port": 3105, "role": "builder",    "driver": "peter-driver" },
  { "name": "KloputzKarl",   "port": 3106, "role": "miner",      "driver": "karl-driver" },
  { "name": "KackboonKevin", "port": null, "role": "mcp",        "driver": "kevin-driver" }
] }
```

> **Free win, ship it in the same commit:** this file also closes the open FEEDBACK entry
> *"auto-inject needs a per-port role map for idleguard"* — `runner.js` falls back to
> `roster.json[name].role` when `--role` is absent, which removes the manual
> `sed 's/__ROLE__/…/'` step that five of five drivers had to reinvent during the last rollout.
> One file, two problems.

**(b) Interval attribution.** For each driver's deduped turns, and each `task_start`/`task_end`
pair in that bot's ledger:

```
attribute(turn) =
    task T   if  T.t_start ≤ turn.ts ≤ T.t_end        (bot = roster[turn.agentName])
    "overhead"  otherwise
```

Three refinements that matter:

1. **Overlap.** A driver may start task B while A is still in flight only via the queue; the
   queue guarantees one running task at a time (`S.start` returns `busy`). Where records
   nonetheless overlap, split the turn's cost evenly across overlapping tasks and set
   `attribution:"split"` on the row.
2. **Overhead is the headline, not the residue.** Turns landing outside every task interval are
   the driver *thinking, reading docs, chatting, coordinating, and waiting*. **This is the
   direct measurement of the founding thesis.** Report `overhead_usd / total_usd` as
   `think_share` — the fraction of model spend that bought no engine work.
3. **Two cost figures, both reported.** Interval attribution localizes *which* tasks are
   expensive but is somewhat arbitrary for cache reads (cache cost is a function of context
   size, not of the task). So also compute the robust one:
   - `cost_attributed(T)` = Σ usd of turns inside T's interval
   - `cost_amortized`     = `shift_total_usd / count(outcome === "ok")`
   Use `cost_amortized` for cross-driver comparison and headlines; use `cost_attributed` to
   find the expensive task shapes.

### 6.5 The price table (Anthropic first-party list rates, 2026-06-24)

Cache write ≈ 1.25 × input; cache read ≈ 0.1 × input.

| Model id | In $/MTok | Cache write $/MTok | Cache read $/MTok | Out $/MTok |
|---|---|---|---|---|
| `claude-sonnet-5` | 2.00 | 2.50 | 0.20 | 10.00 |
| `claude-opus-5` | 5.00 | 6.25 | 0.50 | 25.00 |
| `claude-haiku-4-5` | 1.00 | 1.25 | 0.10 | 5.00 |

```
usd = (input_tokens*IN + cache_creation*CW + cache_read*CR + output_tokens*OUT) / 1e6
```

Prices live in `metrics.mjs`'s `PRICES` constant keyed by the transcript's own
`message.model` — never hardcoded per-driver, since drivers run Sonnet and engineers may run
Opus in the same session.

> **Honesty note to keep in the tool's output:** these sessions run under a Claude Code
> subscription, not metered API billing, so the dollar figure is a **cost-equivalent index**,
> not an invoice. It is the correct unit for comparing drivers, algorithms, and shifts against
> each other, and for deciding whether a code change is worth writing.

### 6.6 What tonight's data already says (computed, not estimated)

Session `ec5d947d`, window `2026-08-31T21:09:58Z → 23:46:09Z` (≈ 2.6 h wall clock), six
drivers, deduped by `message.id`, priced as `claude-sonnet-5`:

| Driver | Bot | Turns | Cache read | Cache write | Output | **USD-equiv** | Tasks* | **$/task** |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| bernd-driver | BuddelBernd | 476 | 140.3 M | 1.87 M | 10 005 | **$32.83** | 125 | **$0.26** |
| friedrich-driver | FurzFriedrich | 714 | 247.7 M | 9.49 M | 12 015 | **$73.39** | 127 | **$0.58** |
| karl-driver | KloputzKarl | 390 | 121.0 M | 2.32 M | 19 294 | **$30.20** | 41 (+26 q) | **$0.74** |
| marcel-driver | MettMarcel | 729 | 264.8 M | 9.46 M | 10 452 | **$76.72** | 48 | **$1.60** |
| peter-driver | PflasterPeter | 619 | 220.6 M | 8.99 M | 14 746 | **$66.74** | 24 | **$2.78** |
| kevin-driver | KackboonKevin | 117 | 21.7 M | 1.09 M | 8 272 | **$7.14** | MCP | — |
| **Fleet** | | **3 045** | **1.016 B** | **33.2 M** | **74 784** | **$287.02** | **365** | **$0.79** |

\* task starts counted from `logs/<bot>.log` `<api> eval: return __skills.start(...)`. This is
the **attempt** count, not the success count — which is precisely why the ledger is needed: the
real denominator is `outcome === "ok"`, and today nobody knows what it is.

**Four findings, available before a line of engine code changes:**

1. **Cache reads are 71 % of all spend** ($203 of $287). This is the cost of *context existing*
   across polling turns, not of reasoning. Output tokens are **0.26 %** of the bill. Any
   optimization aimed at making drivers "write less" is aimed at a rounding error.
2. **A 10.6× cost-per-task spread** between the cheapest and most expensive driver on the same
   engine. `SCOREBOARD.md` already flags friedrich-driver for "chronic wait-loops" by judgment;
   the data agrees and extends it — and it also shows peter-driver, ranked **#1** by output, as
   the most expensive per task. Both facts can be true (large builds are few, long tasks), and
   only a normalized denominator — outcomes, blocks placed, structures verified — can settle
   it. That denominator is exactly what `task_end` provides.
3. **Cache-write volume separates the drivers as sharply as cache reads.** bernd 1.87 M vs
   marcel 9.46 M — a 5× spread. High `cache_creation` means the context prefix is being
   invalidated repeatedly (long tool outputs, re-reads of large docs). `cache_write / cache_read`
   is a cheap, direct **context-hygiene** metric per driver, and one of the few token levers
   a driver can actually act on.
4. **Poll discipline is already good and is not where the money went.** Transcript tool-call
   histograms show bernd at 127 `task.sh wait` vs 26 `task.sh status`, karl 31 vs 6, peter 27
   vs 4 — the token-free local wait loop is being used as documented. The spend is in *how
   large each turn's context is*, not in *how many polls happen*. **Without this measurement
   the obvious next optimization would have been "poll less", which the data says would
   accomplish almost nothing.** That inversion is the argument for building this layer.

---

## 7. `metrics.mjs` — the aggregator and its KPI formulas

### 7.1 CLI

```
node metrics.mjs [--since <ISO|epoch|"3h">] [--until …] [--bot NAME]… [--skill NAME]…
                 [--group skill|bot|skill,class|adg|driver] [--class ROUTE_CLASS]
                 [--tokens] [--json] [--csv <file>] [--ab] [--baseline <file.json>]
```

- Reads `logs/metrics-*.jsonl` (streaming, line by line — never loads a file into memory).
- `--tokens` additionally reads `roster.json` + driver transcripts and joins per §6.4.
- `--ab` emits the `goto2` A/B row format from `goto` events, replacing the hand-filled CSV.
- `--baseline` diffs against a saved `--json` run: **the regression gate.** An engine change
  that raises wedge rate or lowers SPL fails visibly instead of anecdotally.
- ESM (`.mjs`) because `package.json` is `"type":"commonjs"` and the runner-side writer must
  stay CJS. Zero dependencies — Node 24 has everything needed.

### 7.2 KPI definitions (exact)

Let **T** be the set of `task_end` records after filtering, **excluding `outcome === "bad_input"`**
(operator error is not an algorithm property). `N = |T|`.

**Attempt success rate**
```
SR = |{ t ∈ T : t.outcome === "ok" }| / N
```

**Trusted success rate** — the number that matters. `false_success` is already excluded from
`ok` by construction (§4.5 rule 15), so `SR` *is* the trusted rate; report the delta explicitly:
```
FSR (false-success rate) = |{ t : t.outcome === "false_success" }| / N
naive_SR                 = |{ t : t.done === true }| / N        // what the engine self-reports
trust_gap                = naive_SR - SR
```
**`trust_gap` is the headline integrity metric.** It answers "how often does the engine lie to
its driver", which is the question G2 says is currently unanswerable.

**SPL — Success weighted by inverse Path Length** (Anderson et al., 2018), the standard
embodied-navigation efficiency measure, adapted:
```
SPL = (1/N) · Σ_i  S_i · ( l_i / max(p_i, l_i) )

  S_i = 1 if outcome ∈ {ok}, else 0
  l_i = crow-flies distance  (goto: `crow`; task: Σ crow over its goto legs)
  p_i = traveled distance    (`moved`, from the 2 Hz sampler)
```
Two documented biases, both in the same direction, both stated in the tool's output:
- `l_i` uses crow-flies, a **lower bound** on the true shortest path ⇒ SPL is **pessimistic**.
- `p_i` uses 2 Hz sampling, which **under-counts** path length ⇒ SPL is **optimistic**.

They partially cancel and both are constant across compared algorithms, so **SPL is valid for
ranking and invalid as an absolute**. Print it as an index, never as a percentage of optimal.

Report SPL per route class, never pooled — a fleet SPL is a meaningless average over
`SHORT_OPEN` plaza hops and `LONG_OPEN` hauls.

**Wedge rate per 100 calls**
```
WR_goto = 100 · |{ g ∈ G : g.unsticks > 0 ∨ g.res === "stuck" ∨ g.resets.stuck ≥ 3 }| / |G|
WR_task = 100 · |{ t ∈ T : t.outcome === "wedge" }| / N
```
Report both. `WR_goto` is the *sensitivity* measure (how often the recovery ladder was needed);
`WR_task` is the *escape* measure (how often recovery failed and the task died). The ratio
`WR_task / WR_goto` is the **unstick ladder's failure rate** — the direct evidence for or
against the `blocksToAvoid` fix and the torch-underfoot check.

**Duration percentiles per `(skill, route_class)`**, nearest-rank on the sorted ascending array:
```
p(q) = sorted[ ceil(q · n) - 1 ],  n ≥ 1
```
Report `n, mean, p50, p90, max`. **Suppress any cell with `n < 5`** and print `n=3 (low)` —
this stack's per-shift sample sizes are small and a p90 over four trials is noise dressed as a
number.

**Resource yield**
```
active_ms      = Σ_{t ∈ T} t.ms                        // time inside tasks
wall_ms        = Σ over runs of (last event t - session t)
utilization    = active_ms / wall_ms                   // ← the no-idle law, measured
yield_work[i]  = Σ_t t.collected[i] / (active_ms / 3.6e6)   // per bot-WORKING-hour
yield_wall[i]  = Σ_t t.collected[i] / (wall_ms   / 3.6e6)   // per bot-hour
```
`yield_wall` is what the operation actually gets; `yield_work` is what the algorithm is capable
of. Their ratio is `utilization`, which turns the no-idle law into a number for the first time
(closes **G8**).

**Deaths and damage**
```
deaths_per_bot_hour = deaths / (wall_ms / 3.6e6)
hp_per_task         = Σ t.dmg / N
hp_per_100m         = 100 · Σ t.dmg / Σ t.moved       // damage normalized by exposure
```
`hp_per_100m` is the fair safety comparison between a hauler and a miner; raw death counts are
not.

**Tool economy**
```
digs_per_break   = Σ t.digs / |tool_break|
torches_per_100  = 100 · Σ t.torches / Σ t.digs
breaks_unspared  = |{ b ∈ tool_break : b.have_spare === false }|   // the round-trip-to-base count
```

**Production fidelity**
```
mean_yield(skill) = mean over T of t.yield, where t.yield ≠ null
under_prod_rate   = |{ t : t.yield ≠ null ∧ t.yield < 1 ∧ t.outcome === "ok" }| / N
```
`under_prod_rate` catches the craft-void and partial-mine class that `outcome === "ok"` hides.

**Cost per outcome** (with `--tokens`)
```
cost_per_ok       = shift_usd / |{ t : t.outcome === "ok" }|
cost_per_attempt  = shift_usd / N
think_share       = overhead_usd / shift_usd            // tokens that bought no engine work
cost_per_item[i]  = shift_usd / Σ_t t.collected[i]      // e.g. $ per raw_iron
tokens_per_ok     = (cr + cw + inp + out) / |ok|
cache_ratio       = cache_write / cache_read            // context-hygiene index, §6.6 finding 3
```
`cost_per_ok` is **the** number this whole track exists to produce. `think_share` is the direct
test of "the LLM thinks once; code runs forever": as the engine absorbs behaviors, `think_share`
should fall while `yield_wall` holds or rises. If it does not, the thesis is not being served
by the work, and that becomes visible in one line.

### 7.3 Output

Default: a compact per-group table to stdout, `n < 5` cells flagged, biases footnoted.

```
skill=mineLane                       n   SR    FSR  trust  WR_t  p50s  p90s  yield  SPL   $/ok
  MEDIUM_DESCENT                    23  0.78  0.04   0.09   8.7   241   402   0.81  0.31  1.04
  SHORT_ENCLOSED                     9  0.89  0.00   0.00   0.0    96   180   0.94  0.55  0.42
  LONG_OPEN                          4  (n<5, suppressed)
```

`--json` emits the same numbers as a structured document with a `meta` block recording
`{ ledger_v, window, files, records, seq_gaps, suppressed_cells, price_table }` — so a baseline
diff can refuse to compare across a schema bump.

`--csv` with `--ab` emits the exact column set `research/goto2-ab-plan.md` §4.7 asks a human to
type: `route,engine,run,direction,ms,arrived,dist,falseSuccess,deaths,hpDelta,blocksBroken,timedOut,visitedNodes,stuckResets,firstVisit,nearbyBots`. Every column except
`engine`, `run`, `direction`, `firstVisit`, and `nearbyBots` comes straight from a `goto`
record; the remaining five come from `note` events the harness emits between trips. **That
converts a six-hour manual A/B into a scripted one.**

---

## 8. Implementation plan — one pass

Ordered so each step is independently verifiable and nothing is left half-wired.

### Step 1 — `telemetry.js` (new, CJS, ~280 lines)

Exports `install(bot, ctx)` returning the `globalThis.__metrics` object:
`{ v, emit, span, endSpan, counters, snapshot, pathListeners, flush, file, run }`.
Contains: the write stream + rotation (§3.2), the 500 ms sampler (§5.2), the event listeners
(§5.3), the tool-break watcher (§5.4), `routeClass` (§4.8), `adg`/`SALIENT`/`INV_KEYS` (§4.9),
and `classify(task, span)` implementing the §4.5 precedence table.

**Verify:** `node -e "require('./telemetry.js')"` loads clean; a bot spawned with no driver
writes a `session` + `connect` record and nothing else while idle.

### Step 2 — `runner.js` (~25 lines changed)

- `const telemetry = require('./telemetry.js')` at module top.
- `telemetry.install(bot, {name: NAME, port: CONTROL_PORT, role: ROLE})` inside `createBot()`,
  adjacent to the existing `path_reset` hook at :353. **Once per bot instance, not in `spawn`.**
- **Fix `orphanedGoto` to use `__metrics.pathListeners`** (§5.1) — same commit, non-negotiable.
- `GET /metrics` → `telemetry.snapshot()`; `GET /metrics/tail?n=50` → last N in-memory records.
- Add `session` fields from the payload-stack report.
- `roster.json` role fallback when `--role` is absent (the free FEEDBACK win, §6.4a).

**Verify:** `curl :3103/metrics | jq` returns counters; `curl :3103/state | jq .orphanedGoto`
still returns `false` on an idle bot (this is the regression the fix exists to prevent).

### Step 3 — `skills.js` (6 call sites, ~45 lines added, no logic changed)

| Site | Line (v13) | Insert |
|---|---|---|
| `S.start`, after `bad_args`, **before** kit preflight | ~:984 | `const M = G.__metrics; const mspan = M?.span('task', {...})` + `emit('task_start')` |
| `S.start`, kit rejection branch | ~:991 | `emit('task_end', {outcome:'kit_missing', …})` then return — **so the attempt is counted** |
| `S.start` IIFE, after `finally`, **before** `_onTaskEnd` | ~:1068 | run `ASSERTS[name]`, `emit('task_end', …)`, `M?.endSpan(mspan)` |
| `ctx.goto`, at entry | :402 | `const gspan = M?.span('goto', {goal, from, crow, tmo, prof})` |
| `ctx.goto`, in its existing `finally` | :455 | `M?.endSpan(gspan, {res, unsticks, assert_fail})` → emits the `goto` record |
| `ctx._unstick`, at entry | :463 | `emit('wedge', {cause: feetBlockName, …})` |
| `S.craftSafe`, at return | :885/:905 | `emit('craft', {item, want, made, calls, table})` |

Plus the `ASSERTS` and `SALIENT` tables near the registry (§4.6, §4.9).

**Every call site is `try { … } catch (_) {}` and every `M?.` is optional-chained.** With
`globalThis.__metrics` absent, `skills.js` behaves exactly as v13.

**Verify:** re-inject into a live bot, run `./task.sh <port> start come '{…}'`, confirm
`logs/metrics-<bot>.jsonl` gains exactly one `task_start`, ≥ 1 `goto`, one `task_end`, and that
`task_end.outcome === "ok"` with a plausible `moved`/`crow`/`spl`.

### Step 4 — guard payload hooks (~4 lines each)

- `dangerscan.js` — in the state-transition block (:230–237): `emit('danger', …)`.
- `survival.js` — at `enter()` and at `panic_recovered` (:448, :454): `emit('panic', …)`.
- `idleguard.js`, `digguard.js`, `reachguard.js` — **no edits**. `telemetry.js`'s 60 s rollup
  reads their counter objects off `globalThis` and diffs them. Zero payload churn, and it keeps
  working if a payload is missing.

### Step 5 — `roster.json` + `metrics.mjs` (~380 lines)

`metrics.mjs` is pure offline analysis: streaming JSONL reader, filter, group, the §7.2
formulas, table/JSON/CSV renderers, and the `--tokens` transcript join (§6.3 dedupe rule + §6.4
interval attribution + §6.5 price table).

**Verify:** `node metrics.mjs --since 2h` produces a table from the shift just run;
`node metrics.mjs --tokens --group driver` reproduces the §6.6 table (that table is the
regression test — the numbers are already known).

### Step 6 — documentation

- `DRIVER_GUIDE.md`: one paragraph — `GET /metrics` exists, is token-cheap, and drivers should
  read *their own* `cost_per_ok` and `think_share` after a shift instead of guessing.
- `SCOREBOARD.md`: replace the hand-counted `deaths` and `shipped_findings` terms with measured
  ones and add `cost_per_ok`, and record the current judgment-based scores as the last manual
  evaluation so the history stays auditable.
- `README.md`: the ledger file layout and the `metrics.mjs` invocations.

### Total: ~750 new lines, ~70 changed. One engineer, one pass.

### Post-landing verification checklist

1. Spawn a bot, leave it idle 5 min → ledger has `session`, `connect`, and **no `guard` records**
   (zero-delta suppression works).
2. Run one `come` → exactly one `task_start`/`task_end`; `moved ≥ crow`; `spl ∈ (0,1]`.
3. Deliberately wedge a bot (place a torch at its feet in a 1-wide corridor, per
   LEARNING_HANDOFF) → a `wedge` record with `cause:"torch"`, and the enclosing `goto` shows
   `unsticks ≥ 1`.
4. Start `mineLane` with no pickaxe → `task_end.outcome === "kit_missing"` **and** it appears in
   `metrics.mjs`'s denominator. (Today this event leaves no trace anywhere — this is the check
   that G3 is actually closed.)
5. `curl :PORT/state | jq .orphanedGoto` → `false` on an idle bot.
6. `node metrics.mjs --tokens --group driver` reproduces §6.6 within rounding.
7. Kill a bot process mid-task (`kill -TERM`) → the ledger's last line is valid JSON (flush-on-exit
   works) and `metrics.mjs` reports one unterminated span rather than crashing.

---

## 9. Risks, anti-goals, and what NOT to build

**Risks, with mitigations already in the spec**

| Risk | Mitigation |
|---|---|
| A permanent `path_update` listener silently breaks `orphanedGoto` | §5.1 — derive the threshold from `__metrics.pathListeners`; it is a Step-2 requirement, not a follow-up |
| A synchronous write stalls the strictly-synchronous queue advance | §3.2 — write stream only; **never** `appendFileSync` inside `_onTaskEnd` or `_pump` |
| Telemetry throws and kills a task | Every call site optional-chained inside `try/catch`; `telemetry.js` catches internally and increments `counters.telemetry_errors` |
| Ledger grows unbounded | §3.2 rotation at 32 MB; `logs/` is gitignored |
| Cost figures get read as a bill | §6.5 — the tool prints "cost-equivalent index, subscription session" on every run |
| Small-n percentiles get quoted as fact | §7.2 — cells with `n < 5` are suppressed, not printed faintly |
| A driver is retired on a metric that is an artifact | `cost_per_ok` and `SR` are **inputs to judgment**, never the whole `SCOREBOARD` formula. Peter is #1 by output and most expensive per task; both are true. Publish the denominator alongside every ratio |

**Anti-goals — do not build these**

- **No per-tick sampling.** A 20 Hz `move` listener is the only thing in this design that would
  cost measurable CPU, and it changes no decision. 2 Hz, permanently.
- **No per-event `path_update` record.** Aggregate into the enclosing goto span. One record per
  replan would be ~10× the volume for no additional answer.
- **No new chat lines.** The ledger is silent in-game. The user directive on chat diet
  (FEEDBACK, "chat diet: logs out of Minecraft chat") applies here with full force.
- **No driver-facing polling of the ledger during a task.** Reading metrics costs tokens; the
  entire point is to reduce them. `GET /metrics` is for supervisors and post-shift review.
- **No self-reported token counts.** §6.1 option A. If a driver ever writes a token number into
  a report, treat it as fiction.
- **No database.** Append-only JSONL, one file per bot, is inspectable with `jq`, survives
  every crash, needs no schema migration, and is diffable in review. A database would be a
  second thing to keep alive on a machine that is already running seven Node processes and a
  Minecraft server.
- **No metric without a denominator in the same table.** Every rate is printed next to its `n`.

**What this unlocks, in order of value**

1. `trust_gap` — the first honest answer to "does the engine lie to its drivers", and the
   number that makes the goto arrival assertion, the staircase check, and the craft verify
   provably worth their code.
2. `cost_per_ok` and `think_share` — the founding thesis becomes falsifiable, and the $287
   already spent tonight gets a denominator.
3. `WR_task / WR_goto` — settles the wedge-fix debate with measurement instead of anecdote.
4. A scripted `goto2` A/B, replacing six hours of manual CSV entry with a flag.
5. A regression gate (`--baseline`) so engine v14 cannot quietly be worse than v13 — which,
   given that v13's entire performance record is a 6-slot in-memory ring, is currently
   impossible to detect.

---

### Appendix — commands used to produce §6.6 (reproducible now, no code required)

```bash
# per-driver token totals, correctly deduped by message.id
cd ~/.claude/projects/-home-felix-minecraft/<sessionId>/subagents
for d in bernd friedrich karl marcel peter kevin; do
  jq -s -r --arg d "$d" '
    [ .[] | select(.type=="assistant" and .message.usage) | {id:.message.id,u:.message.usage} ]
    | group_by(.id) | map(max_by(.u.output_tokens))
    | { turns:length, inp:(map(.u.input_tokens)|add), out:(map(.u.output_tokens)|add),
        cw:(map(.u.cache_creation_input_tokens // 0)|add),
        cr:(map(.u.cache_read_input_tokens // 0)|add) }
    | . + { usd: (((.inp*2 + .cw*2.5 + .cr*0.2 + .out*10)/1000000)*100|round/100) }
    | "\($d): turns=\(.turns) cr=\(.cr) cw=\(.cw) out=\(.out) usd=$\(.usd)"' \
    agent-a${d}-driver-*.jsonl 2>/dev/null
done

# task-attempt denominator per bot (until task_end exists)
cd /home/felix/minecraft/bots
for f in logs/*.log; do
  printf '%s starts=%s waits/polls=%s\n' "$(basename "$f" .log)" \
    "$(grep -c 'eval: return __skills.start' "$f")" \
    "$(grep -c 'eval: return __skills.status' "$f")"
done
```
