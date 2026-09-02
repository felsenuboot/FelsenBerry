# IDLE_TRIGGER_SPEC — Direction Episodes

**Status:** FINAL synthesized specification (2026-09-02). SHIPPED (2026-09-02): all four phases
built and live-verified — see FEEDBACK.md's Phase 1/3 entries and felcrew-mcp#68.

**VERSION NOTE:** this spec was written against agenda v20, landing Direction Episodes as
v21. Before it landed, engine-dev-3's #89 (digOut/ascendToSurface) claimed v21 first for the
unrelated ESCAPE rung — Direction Episodes shipped as **v22** instead (a number, not a
functional change), and the follow-on setProject/nextProject ruling (§1.1i) bumped it once
more to **v23**. Nothing below keys off the literal version number — every consumer
(`bench/fixtures/agenda-direction.js`, `metrics.mjs`) checks for `A._directionCheck`'s
existence instead, exactly so a version bump elsewhere in the file never invalidates this
spec's own text. Read every "v21" below as "the version that ships Direction Episodes,
whatever that turns out to be."
**Problem (Felix):** bots idle too often; nothing triggers the LLM when a toolchain finishes, fails, or a bot has no direction. Measurement is half the request: idling must become a number.
**Base design:** Direction Episodes (failure-first, judge winner 146/144/131 summed, 2-of-3 judges' pick), with grafts from the events-minimal design (log marker, /state observability, rules-before-LLM, poll-as-sweep) and the queue-ahead design (promotion placement + hygiene, gap_ms cross-check, contradiction alarm). Every judge must_fix is resolved in §8.

---

## 0. Architecture in one paragraph

"Needs direction" becomes **latched, level-triggered state inside agenda.js** (`A.direction`), opened by deterministic edges read off ladder state — never off raw movement, so a 200-block haul can never false-fire. At most ONE open episode per bot; the episode holds until something fills the project slot (a driver, the fleet decider, a promoted queued-next, or deterministic self-recovery), and the close stamps `latency_ms` at the source. Consumption is **pull** (GET /state polling + a stdout log marker for push-like driver wake); dispatch is race-safe via an episode-id compare-and-set. A 1-deep `A.nextProject` slot, staged at decision time (the decider always answers current+next), makes steady-state completions promote at zero tokens and zero gap — episodes then fire only when the queue is empty. One shared **decider.js** daemon serves the driverless fleet: rules.json first (zero tokens), one Haiku call on a rule miss, every decision logged for rule-of-twice conversion. The engine spends zero tokens; the LLM is the metered exception the codicil demands.

Notation: file line anchors below are against the current live files (agenda.js v20 @ 1043 lines, runner.js @ 1057, telemetry.js @ 501, metrics.mjs @ 477, bots-llm/planner.js @ 530). Anchors are the *current* lines; after edits, find by the quoted code, not the number.

---

## 1. Engine changes, per file

### 1.1 agenda.js — v20 → v21 (~90 lines) — lane: engine-dev-3

**(a) State.** Extend the `A` literal (lines 104–117):

```js
direction: {
  state: 'ok',                 // 'ok' | 'needs_direction' | 'cooldown'
  episode: null,               // {id, why, openedAt, detail}
  prevLvl: 'none',             // central edge detector's last composite level
  lastProductiveAt: 0,         // set to now() at install (reinjection grace)
  reopenAt: {}, reopenCount: {},   // per-why escalating reopen backoff
  opened: 0, closed: 0, promoted: 0, byWhy: {},   // UNCONDITIONAL counters (#38 witness 1)
},
nextProject: null,             // 1-deep queue: {skill,args,tool,restockFloor,repeat,stagedAt}
```
Bump `version: 21`.

**(b) Constants** (near the existing block, lines 39–102):

```js
const DIRECTION_IDLE_WINDOW_MS = 120000;   // E2: undirected-idle window
const DIRECTION_STALL_MS       = 180000;   // E3a: stalled-project window
const DIRECTION_BARREN_RUNS    = 3;        // E3b: consecutive zero-yield repeat runs
const DIRECTION_REOPEN_MS      = [30000, 60000, 120000, 300000];  // same shape as STAND_DOWN_MS
```

**(c) `dirEmit(op, fields)` helper** next to `note()` (lines 121–129). Does exactly two pushes, each try/catch-wrapped like `note()`'s S.log mirror:
1. stdout marker: `console.log(new Date().toISOString() + ' AGENDA_EVENT ' + JSON.stringify({ev:'direction', op, ...fields}))` — lands in `logs/<name>.log` via spawn.sh:36's `>> "logs/$NAME.log"` redirect; this is the driver wake signal.
2. ledger: `const m = M(); if (m && m.emit) m.emit('direction', Object.assign({op}, fields))` — the SAME proven-live path the rung-transition `note` uses at line 965 (`m.emit('note', ...)`), NOT an optional guard into a phantom sink (#38/#54-R2 lesson).

**(d) `markProductive(s, src)` — the churn-proof productivity clock.** Stamps `A.direction.lastProductiveAt = s.now`, resets `reopenCount`, and if an episode is open, closes it with `closedBy:'self_recovered'` (src carried in the close record). **Never uses `A.ownerSince`** — tick's NO_PROGRESS handler (line 984) nulls the owner even at the floor, so ownerSince can never accumulate a window on a wedged bot (judge-verified inversion). Stamp sites, all existing outcome-graded branches (reuse, don't duplicate — the long-haul guard):

| site | anchor | meaning |
|---|---|---|
| `gradeIdleWork` `out === 'worked'` branch | line 456 | role-work verifiably yielded |
| project progress banked `got > 0` | lines 846–849 | resumable project moved |
| project VERIFIED done (`finished`) | lines 861–863 | verified completion |
| repeat-project run graded 'worked' (new, see (f)) | harvest block | repeat project yielded |
| `produce` `made > 0` | lines 909–916 | maintenance moved the world |
| `restock` stocked branch (`else` clearing `_restockShort`) | line 901 | resupply succeeded |
| `ensureTool` finished done, no error (new, in harvest try) | after line 902 | TOOL repaired |

Fully-stocked-only on restock is deliberate (partial withdrawals have no readable delivered-count); a run of repeated partials without ever stocking is treated as stalled — noted, accepted.

**(e) `openEpisode(why, detail, s)` / `closeEpisode(closedBy, skill, s)`.**
- `openEpisode`: no-op if an episode is already open (single-latch) or `reopenAt[why] > s.now` (then `state:'cooldown'`, visible in /state — nothing is silently suppressed, see §8 fix J2-7). Otherwise: `episode = {id: 'd'+Date.now().toString(36)+(++seq), why, openedAt: s.now, detail}`, `state:'needs_direction'`, `opened++`, `byWhy[why]++`, `dirEmit('open', {eid, why, project, detail, rung: A.owner && A.owner.id, pos})`.
- `closeEpisode`: stamps `latency_ms = s.now - episode.openedAt`, `closed++`, sets `reopenAt[why] = s.now + DIRECTION_REOPEN_MS[min(reopenCount[why]++, 3)]`, `dirEmit('close', {eid, why, closedBy, latency_ms, skill})`, clears episode, `state:'ok'`.

**(f) Repeat-project yield grading** (resolves the OhneHoseOtto class: `repeat:true` harvestGrass finding nothing forever). In the harvest block's `ours` branch, after the finished/paused/failed grading (after line 881):

```js
if (p.repeat) {
  const out = idleWorkOutcome(p.skill, raw && raw.result, s.task.error);   // line 409, already exposed A._idleWorkOutcome
  if (out === 'worked') { p.barrenRuns = 0; markProductive(s, 'repeat_project'); }
  else if (out === 'barren') p.barrenRuns = (p.barrenRuns || 0) + 1;      // 'other' untouched — maintenance owns it
}
```

**(g) Zero-gap promotion** — placement and hygiene are load-bearing. In the `finished` branch, immediately after `note('project VERIFIED done...')` (line 863), **inside the harvest block, BEFORE `choose(s)` runs** (a post-choose promotion lets IDLE win the completion tick, start a 15s collectDrops, and eat the 2-tick preempt debounce):

```js
if (!p.repeat && A.nextProject) {                    // NEVER promote over a repeat project (see §8 J2-4)
  // re-arbitration hygiene, verbatim from the prior art (bots-llm/planner.js:515-520):
  // without it the unproductive detector (line 932) reads the fresh project as
  // "completed twice without meeting its own condition" and stands PROJECT down.
  A.owner = null;
  A.unproductive.PROJECT = 0;
  delete A.standDown.PROJECT;
  A.standDownCount.PROJECT = 0;
  const nx = A.nextProject; A.nextProject = null;
  dirEmit('promote', { from: p.skill, to: nx.skill, queuedForMs: now() - nx.stagedAt });
  A.direction.promoted++;
  A.setProject(Object.assign({}, nx, { by: 'promoted' }));
}
```
No episode opens (directionCheck below sees an active project). The promote record carries `queuedForMs` (staleness is measured before any TTL is argued — v1 has no TTL; the kit gates re-validate at start). **latency is never hard-coded 0**: the true completion→start gap is corroborated by the EXISTING `gap_ms` on the next `task_start` (skills.js:2333 `_gapMs` → telemetry.js:335) — expected ≤ ~2500 ms (one tick). Two instruments, one fact.

**(h) `directionCheck(s)` — the central detector.** Called once per tick immediately after the harvest block closes (line 943), before `const { target } = choose(s)` (line 945). Exposed as `A._directionCheck` for fixtures (same discipline as `A._idleWorkOutcome`, line 422). Logic:

```js
// composite level — catches EVERY current/future mutation site of p.blocked / completedOnce /
// A.blocked (including driver /eval writes) without per-site calls:
const p = A.project;
const lvl = !p ? 'none'
  : p.blocked ? 'blocked'                                  // set at lines 697 (3 refused starts) and 879 (5 unverified runs)
  : (A.blocked && A.blocked.why === 'no_tool') ? 'no_tool' // set at line 572 (TOOL refusal) — projectDone() (745-752) NEVER reads A.blocked, so this needs its own arm (§8 J1-4/J3-3)
  : projectDone(s) ? 'done' : 'active';
const prev = A.direction.prevLvl; A.direction.prevLvl = lvl;
// EDGES (project lifecycle):
if (prev === 'active' && lvl === 'done')    openEpisode('project_done',    {skill: p.skill}, s);   // non-repeat verified done with NO staged next (a promote already swapped lvl back to 'active')
if (prev !== 'blocked' && lvl === 'blocked') openEpisode('project_blocked', {skill: p.skill, lastError: p.lastError, attempts: p.attempts}, s);
if (prev !== 'no_tool' && lvl === 'no_tool') openEpisode('no_tool',        {cls: A.blocked.cls}, s);
// LEVELS (windows on the churn-proof productivity clock; gated on no in-flight task so a
// long productive run can never false-fire — a wedged RUNNING act is owned by ACT_TIMEOUT_MS
// (lines 96-102) and busyStuck (791-795), not by this detector):
const running = Boolean(s.task && s.task.running);
const quiet = s.now - A.direction.lastProductiveAt;
if (!p && !running && quiet > DIRECTION_IDLE_WINDOW_MS)
  openEpisode('unproductive_idle', {barren: A._barren || 0, role: A.role}, s);                     // E2
if (p && !projectDone(s) && !running && quiet > DIRECTION_STALL_MS)
  openEpisode('project_stalled', {skill: p.skill, lastError: p.lastError, blocked: A.blocked && A.blocked.why}, s); // E3a — the kit-deadlock catcher
if (p && p.repeat && (p.barrenRuns || 0) >= DIRECTION_BARREN_RUNS)
  openEpisode('project_stalled', {skill: p.skill, barren: p.barrenRuns, repeat: true}, s);         // E3b — zero-yield repeat
```
tick() early-returns (busy 789, !alive 800, externalNav 803–811) mean an edge during a /goto2 flight is reported when nav releases — latency, not loss: the comparison is level-based, an edge cannot be missed entirely.

**(i) `A.setProject` (line 993)** gains three optional spec fields, backward-compatible:
- `spec.by` — `'driver' | 'decider' | 'human' | 'promoted'` (default `'manual'`): stamped into the episode close.
- `spec.next` — `{skill, args?, tool?, restockFloor?, repeat?}`: validated (must have `skill`), stored as `A.nextProject = Object.assign({}, spec.next, {stagedAt: now()})`. **Staged at decision time** — the decider/driver always answers current+next; there is NO progress-threshold pre-staging (nearly_done dropped, §8 J1-3).
- `spec.keepNext` — bool, default `false`. **RULING (team-lead, 2026-09-02, agenda v23), amending this section after Phase 1 shipped:** a plain `setProject` call with **no** `spec.next` field DROPS any stale previously-staged `A.nextProject`, rather than leaving it in place. Rationale: `setProject` expresses FRESH intent — a `next` staged for a PREVIOUS decision context silently promoting after an UNRELATED new project completes is a ghost-decision footgun (a driver redirects the bot, the old plan resurrects itself, the bot veers off, and nobody would trace it quickly). `spec.keepNext: true` is the explicit opt-in for the rare case that genuinely wants an old staged plan to survive an unrelated project change — never the default. Covered by `bench/fixtures/agenda-direction.js` case 11.
- At the top of the function (both the set and the `spec == null` clear branch): if `A.direction.episode`, `closeEpisode(spec ? (spec.by || 'manual') : 'cleared', spec && spec.skill, {now: now()})`. Clearing the project also clears `A.nextProject` (it was chosen to follow the old plan) — now the SAME rule a normal set follows by default, not a special case.

**(j) `A.dirDispatch(eid, spec)` — the race-safe entry point (mandatory in ALL modes, §8 J1-5/J3-6):**
```js
A.dirDispatch = (eid, spec) => {
  const ep = A.direction.episode;
  if (!ep || ep.id !== eid) return { ok: false, skipped: 'stale' };   // someone answered first — no-op, no clobber
  return A.setProject(Object.assign({}, spec, { by: spec.by || 'decider' }));
};
```
A driver that answered first closed the episode; the decider's later dispatch returns `{skipped:'stale'}` and the second LLM call's output is discarded, never applied. Drivers SHOULD also dispatch through `dirDispatch` when answering an episode (and MAY use plain `setProject` for unsolicited redirection).

**(k) `A.snapshot()` (line 1018)** gains `direction: {state, why, eid, forMs, opened, closed, promoted}` and `next: A.nextProject ? A.nextProject.skill : null`.

**(l) Install block** (after line 1035): `A.direction.lastProductiveAt = now()` — a reinjection gets a full window of grace instead of an instant re-fire.

### 1.2 skills.js — ZERO changes
No progress-threshold trigger (nearly_done dropped), no new skill. `idleWorkOutcome` grading and `_gapMs` already exist.

### 1.3 runner.js (~10 lines) — lane: engine-dev-3
Extend the agenda closure in GET /state (lines 681–688):
```js
direction: a.direction ? {
  state: a.direction.state,
  why:  a.direction.episode ? a.direction.episode.why : null,
  eid:  a.direction.episode ? a.direction.episode.id  : null,
  forMs: a.direction.episode ? (Date.now() - a.direction.episode.openedAt) : null,
  opened: a.direction.opened, closed: a.direction.closed, promoted: a.direction.promoted,
} : null,
next: a.nextProject ? a.nextProject.skill : null,
```
**Deliberately NOT added** (blast-radius decisions, see §8): no `GET /direction` long-poll (new waiter machinery on the runner for ≤20s latency win over polling — not worth it when windows are 120–180s), no `--notify` HTTP push (a clobberable global + a dead-channel failure class; the decider's 20s poll IS the stale-latch sweep). `/eval` stays the single dispatch route; `INTERVENTION_ROUTES` (line 347) is untouched — decider dispatches are honest interventions, attributed via body match (§4).

### 1.4 telemetry.js — ZERO changes — lane: engine-dev (verify only)
`M.emit(ev, fields)` (lines 167–175) is generic and stamps `{v: SCHEMA_V, t, bot, run, seq, ev}`. `ev:'direction'` is additive JSONL exactly like `recovery` and `pos` were; no field repurposed ⇒ **SCHEMA_V stays 2**. engine-dev's task is to confirm this by inspection, not to edit.

### 1.5 metrics.mjs (~45 lines) — lane: engine-dev
New `── direction (idle-as-a-number) ──` section after ladder coverage (lines 238–257). See §4.

### 1.6 decider.js — NEW standalone daemon (~180 lines) — lane: engine-dev-3
**Never a payload: no LLM code runs inside the bot process.** graybridge.js pattern (standalone, `setsid nohup node decider.js >> logs/decider.log 2>&1 &`, pid-file guard `logs/decider.pid`). See §3b.

### 1.7 bench/fixtures/agenda-direction.js — NEW — lane: engine-dev
Wired into preflight.sh's fixture list. See §4 (proof) for the 10 cases.

### 1.8 DRIVER_GUIDE.md — one paragraph — lane: engine-dev-3
"Wake on `AGENDA_EVENT` in `tail -F logs/<bot>.log` (or read `agenda.direction` on your normal /state poll). On `needs_direction`: decide NOW and dispatch via `__agenda.dirDispatch('<eid>', {skill, args, repeat?, next:{...}, by:'driver'})` — always include `next` so the completion after this one costs zero tokens. You have ~60s before the fleet decider answers for you. A skill not in the resumable registry finishes after ONE pass regardless of `count` — use `repeat:true` for open-ended goals."

---

## 2. The trigger contract

### 2.1 Episode kinds (`why`)

| why | type | condition (all deterministic, ladder-state only) |
|---|---|---|
| `project_done` | edge | non-repeat project VERIFIED done (line 862) with no staged next (a staged next promotes instead — no episode) |
| `project_blocked` | edge | `p.blocked` latches: 3 refused starts (line 697) or 5 unverified runs (line 879) |
| `no_tool` | edge | `A.blocked = {why:'no_tool'}` latches (line 572) — its OWN arm because `projectDone()` never reads `A.blocked` |
| `unproductive_idle` (E2) | level | no project, no task in flight, nothing graded productive for 120s |
| `project_stalled` (E3a) | level | project set, not done, no task in flight, nothing productive for 180s — catches the repairable-refusal kit-deadlock (the live 2026-09-02 gear-race incident: `kit_missing`/`no_tool` reset `p.attempts` at lines 696/880 so `p.blocked` NEVER latches) |
| `project_stalled` (E3b) | outcome-count | repeat project with ≥3 consecutive barren-graded runs — catches zero-yield repeat loops that never stop "completing" |

`#68`'s future motion-stuck kind arms the SAME latch (§5). A ladder-wedged bot (busy stuck, hung act) is out of scope by design — owned by ACT_TIMEOUT_MS / busyStuck force-release.

### 2.2 Records (ledger, `logs/metrics-<bot>.jsonl`, schema v2)
All stamped `{v:2, t, bot, run, seq, ev:'direction'}` by M.emit, plus:
- **open**: `{op:'open', eid, why, project, detail:{lastError?, attempts?, barren?, blocked?, role?, cls?, repeat?}, rung, pos}`
- **close**: `{op:'close', eid, why, closedBy: 'driver'|'decider'|'human'|'manual'|'promoted'|'self_recovered'|'cleared', latency_ms, skill}`
- **promote**: `{op:'promote', from, to, queuedForMs}` (true start gap corroborated by the next task_start's `gap_ms`)

### 2.3 Rate discipline (#49 — by construction, then by belt)
1. **A latched level cannot storm**: at most one open episode per bot, no matter how long nobody consumes it. Emits are once-per-episode by construction.
2. **Per-why reopen backoff** in the engine: 30s→60s→120s→300s, reset when `markProductive` fires. During backoff the episode is *deferred, not silently suppressed*: `/state` shows `state:'cooldown'` — ledger and /state can never disagree about open episodes.
3. **Decider-side (durable)**: per-bot ≥120s between LLM calls; fleet-wide cap 30 LLM calls/hr; single in-flight decision per bot; dedup by `(bot, eid)`. All persisted in `logs/decider-state.json` — **never engine-side only**, because reinjection (agenda.js:37 stops the old instance; the fresh payload rebuilds `A` wholesale, and payloads are re-injected after every restart per standing ops) resets every engine latch to zero.
4. Non-preempting by design: an episode interrupts nothing; a dispatch takes effect through the normal PROJECT-preempts-IDLE ladder rules next tick.

### 2.4 Respawn / reinjection semantics
- Fresh install: `lastProductiveAt = now()` ⇒ full-window grace, no instant re-fire.
- Open episode, staged next, counters, backoffs: LOST with the old `A` — by design. Durable truth = the ledger (run-stamped; the `session`/`versions` records mark the boundary) + `decider-state.json`.
- The decider treats a handled eid that vanished from /state as answered-elsewhere (no re-call); a NEW episode gets a new eid, so dedup is safe across restarts.
- Drivers must re-arm their log Monitor after respawns (same rule as the idle-guard reinjection note in MEMORY).

---

## 3. Consumers

### 3a. Driver-steered bots (per-bot Sonnet teammates)
- **Wake**: arm ONE background Monitor on `tail -F logs/<bot>.log` matching `/AGENDA_EVENT/` — push-latency wake at zero polling tokens. The 45s /state poll may be kept or dropped; either way `agenda.direction` turns a poll from "guess from rung/project" into an explicit contract.
- **Act**: GET /state → read `direction.{why, eid, forMs}` + context → ONE decision → POST /eval `__agenda.dirDispatch('<eid>', {skill, args, next:{...}, by:'driver'})`. Log line = wake signal; /state = truth.
- Net driver tokens go DOWN: event wakes replace speculative nothing-to-decide poll turns.

### 3b. Driverless fleet — decider.js (ONE shared daemon)
Flow per 20s poll cycle (staggered across bots discovered via `pids/*.port` + `pids/*.meta`):
1. GET /state; skip unless `agenda.direction.state === 'needs_direction'`.
2. **Driver grace — conditional, not flat** (§8 J1-5): if the bot's meta/roster.json names an owner/driver, wait until `forMs ≥ 60000` (the driver wins the race by default); an unowned bot is answered immediately — no free 60s of idle for the driverless fleet.
3. Dedup `(bot, eid)` against `decider-state.json` (kills restart replays and re-polls of the same armed episode — one decision per episode, mechanically).
4. **rules.json FIRST** (events-minimal graft; the codicil verbatim): key = `why|role|lastError|barrenBucket`; a hit dispatches at zero tokens.
5. On a rule miss: rate gates (per-bot ≥120s, fleet 30/hr persisted rolling window; overflow → `decisions.jsonl {src:'skipped_cap'}`, logged not spent) → build compact context from /state (position, hp/food, inventory digest, role, agenda snapshot incl. project/next/blocked/log tail, cached skill-name list fetched once via /eval `Object.keys(globalThis.__skills.registry)`) → **ONE `claude-haiku-4-5` call** returning `{skill, args, repeat?, next?}` → validate skill (and next.skill) against the registry → dispatch.
6. Dispatch: POST /eval `__agenda.dirDispatch('<eid>', {...decision, by:'decider'})` — the eid CAS makes a driver-first answer a `{skipped:'stale'}` no-op (double-dispatch dead in ALL modes).
7. Append `decisions.jsonl {t, bot, eid, why, key, src:'rule'|'llm'|'skipped_cap', decision, latency_ms}` — the rule-of-twice input: a `(key → decision)` pair seen twice graduates into rules.json (offline `--promote-rules` pass first; auto later), and ultimately into `ROLE_WORK` defaults — the LLM's role shrinks monotonically.
- Decider vocabulary is CLOSED: `dirDispatch`/`setProject` specs only — it can never become a second deliberative loop driving the body (the idleguard-subsumption law, agenda.js:26–29).
- **Decider down ⇒ graceful degradation**: the IDLE role-work floor keeps bots productive exactly as today; unanswered episodes accumulate as the LOUD open-unclosed alarm (§4), not as silence.

---

## 4. Measurement + proof of firing

### 4.1 The metric
**direction-latency** = ms from episode open (`project_done` | `project_blocked` | `no_tool` | `unproductive_idle` | `project_stalled`) to close (any setProject/dirDispatch, promotion, or deterministic self-recovery) — exactly "seconds from project_done/blocked/idle_start to next setProject **or productive action**", computed engine-side and stamped on the close record. Closing on `self_recovered` keeps the number honest — it must not overcount bots that recovered without an LLM (§8 J2-5).
**undirected-time fraction** = Σ episode durations (open episodes closed at run end) / session wall clock — Felix's screenshot number, per bot and fleet.

### 4.2 metrics.mjs `── direction ──` section (engine-dev)
Filter `ev==='direction'`, pair open/close by eid. Prints per bot and fleet:
- episodes/hr by `why`; direction-latency median/p90 (target: p90 < 120s driverless); closedBy share (`promoted` share = completions that never touched an LLM — the queue-ahead proof; `self_recovered` share = deterministic floor working);
- undirected-time fraction; **open-unclosed count + max age — an episode open >30min prints as an explicit DEAD-CONSUMER alarm**;
- promote cross-check: median `gap_ms` on the task_start following each promote (expect ≤2500ms);
- **contradiction alarm** (queue-ahead graft): reuse the ladder-coverage `note` parse (lines 246–249) — if IDLE-transition share is high while direction records are ZERO, print the failure explicitly. Silence while idle is reported as the failure it is.
- with `--decisions logs/decisions.jsonl`: LLM calls/hr vs the cap, rule-hit share, `skipped_cap` count — the token SLO is auditable from the same command.

### 4.3 Proof the trigger fires (#38: an optional-guarded emit into nothing is indistinguishable from a rung that never runs)
Four independent witnesses:
1. **Unconditional counters in the payload** (`A.direction.opened/closed/promoted`), readable live via GET /state — a dead ledger cannot hide a dead trigger.
2. **Ledger records on the proven-live M.emit path** (telemetry.js:167–175; agenda already emits `note` through it at line 965) — not the #54-R2 phantom-`M.recovery` shape.
3. **The contradiction alarm** — a dead trigger with a live ledger prints as IDLE-high/emits-zero.
4. **bench/fixtures/agenda-direction.js**, driving the exposed pure `A._directionCheck` with injected snapshots (agenda-ladder.js precedent). Ten cases: (1) active→done edge opens once, no re-open next tick; (2) staged next promotes — no episode, project swapped, all four hygiene fields cleared; (3) repeat project is NEVER promoted; (4) E2 respects the 120s window, stays quiet while a task runs and after a 'worked' stamp; (5) E3a fires on a refused-start loop (project set, nothing running, 180s); (6) E3b fires after 3 barren repeat runs, resets on 'worked'; (7) no_tool edge on the A.blocked latch (proves the projectDone-doesn't-read-A.blocked fix); (8) dirDispatch stale-eid → `{skipped:'stale'}`, matching eid closes with closedBy; (9) fresh install stays quiet for the full grace window; (10) reopen backoff escalates and resets on markProductive.

**Live acceptance test** (test bot on 3106): `setProject({skill:'chopTrees', args:{count:1}, by:'human'})`, await VERIFIED done, then assert all three surfaces — `grep AGENDA_EVENT logs/<bot>.log`, `/state agenda.direction.why === 'project_done'`, an `op:'open'` record in the ledger; answer via dirDispatch and assert the paired close carries sane `latency_ms`. Then repeat with `next` staged and assert: no episode, one `op:'promote'`, next task_start `gap_ms ≤ 2500`.

---

## 5. #68 composition

This spec **IS** felcrew-mcp#68, split at the joint the issue itself names (trigger + decider):
- **Trigger half — replaced, strictly stronger**: instead of a new displacement/no-progress sensor, E2/E3 read the ladder's own exhaustion (nothing graded productive; project unfinished while starts refuse or repeat runs yield nothing). It cannot false-fire on a 200-block haul (the haul is a running task — gated), it fires only after v20's deterministic recovery genuinely exhausted (stand-downs, #54 movement recovery, #67b relocate, #84 idle-kit all run first — exactly #68's "gated ABOVE the deterministic recovery"), and it duplicates none of agenda's stall-vs-travel grading.
- **Decider half — lands verbatim**: one tiny-LLM (claude-haiku-4-5) call per stuck-episode — the eid latch is the *mechanical* definition of "one call per stuck-episode"; context in, a registry-validated `{skill,args}` out via setProject (WHAT not HOW); every decision logged to decisions.jsonl for rule-of-twice.
- **Extension**: `project_done` + the nextProject queue extend #68 to the completion boundary Felix's complaint is actually about, and direction-latency gives #68 the acceptance number it lacked.
- **Prior art folds in**: bots-llm/planner.js's `advance()` (lines 506–526) is functionally this promotion (its hygiene is copied verbatim); when the look-ahead spine goes live, the planner becomes the FIRST filler of `A.nextProject` for spine-shaped goals at zero tokens — episodes then fire only when the queue is empty, and the trigger is the queue's refill signal.
- **Action**: issue-manager comments on felsenuboot/felcrew-mcp#68 that the stuck-trigger ships as Direction Episodes per this spec — no competing issue.

---

## 6. Phased plan, lanes, acceptance

**Lanes** (fixed): engine-dev-3 = agenda.js / skills.js / runner.js / decider.js / DRIVER_GUIDE.md; engine-dev = telemetry.js (verify-only) / metrics.mjs / bench fixture.

**Phase 1 — engine trigger (engine-dev-3), agenda v21 + runner /state.**
Accept: existing fixture suite still green via preflight.sh; live acceptance test of §4.3 passes on the 3106 test bot (all three surfaces + promote gap_ms ≤ 2500); a deliberately blocked project and a kit-starved no-project bot each open the correct episode within their windows.

**Phase 2 — measurement (engine-dev), fixture + metrics section (can start against Phase 1's branch).**
Accept: all 10 fixture cases pass and are wired into preflight.sh; DIRECTION section renders on a live ledger; the contradiction alarm demonstrably fires on a pre-v21 ledger (IDLE-heavy, zero direction records); telemetry.js zero-diff confirmed in the entry.

**Phase 3 — decider (engine-dev-3): decider.js + empty rules.json + decider-state.json + DRIVER_GUIDE.md paragraph.**
Accept: 60-min driverless soak, ≥2 bots, no drivers: every opened episode closes (open-unclosed = 0 at end); p50 direction-latency ≤ 60s, p90 < 120s; LLM calls ≤ cap with any overflow visible as `skipped_cap`; decisions.jsonl populated; every decider intervention identifiable in `/state interventions.recent` by `__agenda.dirDispatch(` in the recorded body (the #52 tripwire stays honest: decider dispatches ARE interventions, attributed, and reconciled against `closedBy:'decider'` counts in the DIRECTION section).

**Phase 4 — soak + rules (both lanes + issue-manager).**
Accept: 3h fleet soak reports undirected-time fraction; SCOREBOARD.md gains the number with its target; first rule-of-twice promotions into rules.json (rule-hit share > 0); #68 comment posted.

---

## 7. Token budget (the CAP is the SLO — not dollar guesses)

- **Engine: 0.** Episodes, promotion, grading, the metric — all deterministic payload code.
- **Steady state** (healthy fleet, next always staged): expected 2–6 Haiku calls/hr fleet-wide; ~2.5k tokens/call (≈2k in / ≈300 out).
- **Hard ceiling, enforced**: per-bot ≥120s spacing + fleet cap **30 LLM calls/hr** + single in-flight + (bot,eid) dedup — all persisted in decider-state.json (survives restarts AND payload reinjection; engine-side backoffs are additive, never load-bearing). Ceiling ⇒ ≤ ~75k tokens/hr ≈ ≤ **$0.11/hr** at claude-haiku-4-5 list pricing ($1/MTok in, $5/MTok out). Overflow is logged (`skipped_cap`), never spent.
- **Driver mode: net negative marginal cost** — event wakes replace nothing-to-decide poll turns on resident Sonnet drivers.
- **Trajectory**: rule-of-twice + planner-spine staging shrink calls monotonically; `promoted` + `rule` + `self_recovered` shares in the DIRECTION section are the shrinkage read-out.

---

## 8. must_fix resolution ledger (every item, all three judges)

Judge 1 = token-economics; Judge 2 = verification-honesty; Judge 3 = blast-radius.

| # | item | resolution |
|---|---|---|
| J1-1 / J3-2 | kit-deadlock blindspot (repairable refusals reset attempts at lines 696/880, p.blocked never latches; live 2026-09-02 incident) | **E3a** is a first-class kind: project set, !projectDone, no task in flight, 180s unproductive (§2.1). Fixture case 5. |
| J1-2 / J3-5 | promotion hygiene + placement | Hygiene copied verbatim from planner.js:515–520; promotion runs inside the harvest block after line 863, BEFORE choose() (§1.1g). Fixture case 2. |
| J1-3 / J3-10 | drop nearly_done@80% (totalWanted only exists for mineLane; ctx.progress coverage partial) | **Dropped.** Next is staged at decision time — decider/driver always answers current+next (§1.1i, §3). RESUMABLE is not extended to feed a trigger. |
| J1-4 / J2-2 / J3-3 | E1-covers-A.blocked claim is false (projectDone, lines 745–752, never reads A.blocked) | `no_tool` gets its own arm in the composite level, edge-detected on the A.blocked latch (line 572) (§1.1h). Fixture case 7. |
| J1-5 / J3-6 | double-dispatch guard mandatory; driver grace must be conditional | `A.dirDispatch` eid-CAS is the dispatch path in ALL modes (§1.1j); 60s grace applies ONLY to bots with a named owner in meta/roster (§3b step 2). Fixture case 8. |
| J1-6 / J2-10 / J3-7 | durable rate state outside the payload (reinjection rebuilds A, agenda.js:37) | All load-bearing throttles persisted in decider-state.json; engine backoffs additive only; lastProductiveAt = install time for grace; vanished-episode = answered-elsewhere (§2.3, §2.4). Fixture case 9. |
| J1-7 / J3-8 | repeat-project zero-yield silence | Repeat runs graded via idleWorkOutcome in the harvest block; barren streak → **E3b**; 'worked' stamps the clock, so the E2-class window effectively runs under repeat projects too (§1.1f, §2.1). Fixture case 6. |
| J1-8 / J3-9 | proof-of-firing: combine strongest witnesses; keep dead-channel observability | Unconditional /state counters + proven-live M.emit + contradiction alarm + fixture = four witnesses (§4.3). The push-notify channel is REMOVED rather than instrumented — the decider's 20s poll is itself the stale-latch sweep, and a poll has no dead-channel failure class. |
| J1-9 | token arithmetic: publish the cap as the SLO | §7: 30 calls/hr fleet cap enforced+persisted, ≤$0.11/hr ceiling at real Haiku pricing; metrics reports actual calls, rule-hit share, cap-skips. |
| J2-1 / J3-1 | never clock on A.ownerSince (NO_PROGRESS at line 984 nulls owner even at the floor; EAT interludes reset it) | The clock is `lastProductiveAt`, stamped only by verified-outcome branches (§1.1d) — churn-proof by construction. |
| J2-2 | E3 must tolerate TOOL re-fires between stand-downs | No sustained-rung counter exists to disturb: E3a uses the productivity clock + no-running-task gate; successful maintenance (ensureTool done, produce made>0, restock stocked) stamps the clock, so a working repair chain never fires and a failing one fires at exactly 180s (§1.1d/h). |
| J2-3 | promote pre-choose; never hard-code latency 0 | §1.1g: harvest-block placement; promote record carries `queuedForMs` and the true gap is the independent `gap_ms` on the next task_start — two instruments, one fact. |
| J2-4 | gate promotion on !p.repeat (completedOnce sets even for repeat at line 862) | Promotion condition is `finished && !p.repeat && A.nextProject` (§1.1g). Fixture case 3. |
| J2-5 | close on deterministic self-recovery, stamp closedBy | markProductive closes an open episode `closedBy:'self_recovered'`; closedBy on every close (§1.1d/e, §4.1). |
| J2-6 | ship the driverless consumer in the same slice | decider.js is Phase 3 of THIS spec with its own acceptance gate — not deferred to another repo (§1.6, §6). |
| J2-7 | no silent suppression (design 1's quiet re-arm made /state and metrics disagree) | Nothing is suppressed: reopen backoff *defers the open* (no episode, no emit, `/state state:'cooldown'` visible) — the two surfaces agree by construction (§1.1e). Design 1's quiet:true mechanism rejected as the wrong shape. |
| J2-8 | adopt BOTH cross-witness alarms | Contradiction alarm + open->30min dead-consumer alarm + soak criterion (≥1 open AND ≥1 close per driverless bot) all in §4.2/§6. |
| J2-9 | #52 intervention tripwire attribution | Decider dispatches ARE interventions; every one is body-matchable (`__agenda.dirDispatch(`) in interventions.recent and reconciled against closedBy:'decider' (§6 Phase 3). Runner is not modified for this — the recorded body already suffices. |
| J3-4 | design 3's E2 false-fired mid-run (clock only advances at grade time) | E2/E3a are gated on `!(s.task && s.task.running)` — a long productive run cannot fire them; a wedged RUNNING act is ACT_TIMEOUT/busyStuck's jurisdiction (§1.1h). Fixture case 4. |

**Explicitly rejected, with reasons**: design 1's `--notify` HTTP push + `globalThis.__notify` (dead-channel class, clobberable global; poll suffices at these windows); design 1's ownerSince idle edge (inverted clock); design 2's GET /direction long-poll (waiter machinery on the runner for a latency win the 120–180s windows don't need — revisit only if driver wake latency ever matters, the context-bundle idea is noted); design 2's nearly_done pre-staging (per-episode LLM habit, predicate unfireable for most skills); design 2's setProject normalization refactor (staging reuses setProject's own path — no refactor of the delicate function).
