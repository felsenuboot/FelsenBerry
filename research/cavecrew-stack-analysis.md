# CAVECREW Stack Analysis (ZetOmega/cavecrew-mcp, cave/)

Research read of the allied crew's operator stack, 2026-09-01. Sources: raw
GitHub files `cave/{overseer.mjs, rconchat.js, movement.js, runner.js,
skills.js, spawn.mjs, TRADE.md, CIV.md, BASE.md, TODO.md, FEEDBACK.md,
DRIVER_GUIDE.md, README.md}` @ main. Compared against our
LEARNING_HANDOFF.md, FEEDBACK.md, graybridge.js/graychat.js, BASE.md, DEPOT.md.

They run mineflayer 4.35 (we run 4.38), same server, same three-layer
philosophy ("LLM thinks once, code runs forever"), Sonnet teammate drivers,
a team-lead orchestrator. They openly credit our field intel in their
FEEDBACK.md ("FEL intel" entries: Movements safety, craft voiding, nuisance
wedges, bucket activateItem, blockAt staleness, torch kit, panic listener,
protocol-lines-must-stay-real-chat). The flow of learning is already
bidirectional — this report closes the loop the other way.

---

## 1. Architecture: how their fleet runs

### Layers

1. **Runner** (`runner.js`, one Node process per bot, HTTP API on
   `127.0.0.1:32xx`): skills are **compiled into the process**
   (`import * as skills from './skills.js'`), not injected via /eval like our
   payload stack. Consequence: they have NO re-injection-after-restart
   problem at all — the entire class of bugs in our FEEDBACK ("auto-inject
   payload stack on spawn", "injection reports drift from reality",
   "idleguard must be re-injected") does not exist for them.
2. **Drivers**: one Sonnet teammate per bot (`UngaBungaDriver` etc., senior
   driver GrogDriver), same poll discipline as ours (15-30s, single-poll
   contract, escalate to /eval only after a skill fails twice, report quirks).
3. **Orchestrator** (team-lead) sets goals, maintains CIV.md, and is the one
   who edits skills.js when drivers report quirks.

### The overseer (their answer to our idleguard) — the big design difference

`overseer.mjs` is a ~130-line **deterministic, LLM-free external watchdog
process** (own pid file, own log). Loop: poll every bot's `GET /status`
every 30s, then per bot:

- **disconnected** → `POST /relog` (throttled to once per 2 min);
- **running a goto with position frozen >150s** → `/stop` + RCON
  `tp <name> <camp>` + gray announce "(overseer) unstuck, teleported home";
- **idle >60s** → issue the next **role-default task** from a per-bot
  round-robin list (e.g. UngaBunga: chop 4 / sweep drops; Thak: dig coal /
  dig iron), announce "(overseer) idle: ..." in gray.

Crucially it drives bots ONLY through the public HTTP API, and the runner's
**single-task mutex** (409 busy unless `force:true`) means the overseer can
NEVER stomp a driver's in-flight task — if a driver task is running, the
idle-default POST just gets rejected and logged. Compare our injected
idleguard v3, which lives inside the bot process, fights the driver for
`bot.pathfinder`'s goal (the fake-freeze root cause BuddelBernd diagnosed),
needs `pause()`/`stop()` discipline, and dies on every restart. Their
split — mutex in the runner, watchdog outside the process — is structurally
immune to every one of those failure modes.

(Caveat for us: the tp-home unstuck is an RCON cheat. Our user rule is DO
NOT CHEAT (graychat.js header), so we would port the overseer pattern
without the teleport — relog or a recovery task instead.)

### Task model in the runner

- `startTask()` mutex: one task at a time; `409 {"error":"busy",currentTask}`;
  `force:true` = cancel-then-start with a re-check after the await so two
  forcers can't both install. **`/stop` actually cancels the running task**
  (flips state synchronously so `ctx.isCancelled()` is seen everywhere, then
  `movement.cancelMovement`) — unlike our runner's /stop, which only clears
  the pathfinder goal and leaves __skills tasks running (known quirk).
- `/status` single-poll contract: name, connected, pos, health, food,
  inventory summary, currentTask{id,kind,state,detail,result}, lastError,
  engine, **deathCount, lastDeath, poisonedTargets**.
- `GET /events?since=<n>`: 500-entry ring buffer (chat heard, health drops,
  death, kicked, task transitions, quirk hits) with a seq cursor — cheap
  driver catch-up without log reading.
- `/eval` escape hatch with a 10s soft timeout that returns
  "still running, poll /status" instead of blocking.

### Generation tracking (their fix for our orphaned-promise plague)

`connect()` bumps a module-level `generation` counter; `makeCtx()` snapshots
it at task start and exposes live `ctx.isStaleGeneration()`. Every movement
race (`raceWithCancelAndTimeout`) polls `isCancelled` + `isStaleGeneration`
every 200ms and abandons (never re-awaits) the loser. A goto issued just
before a relog fails fast with "stale generation" instead of driving a
zombie bot instance or poisoning later goals. This is precisely the engine
fix our FEEDBACK entries "orphaned goto promises poison later goals" and the
hard-reconnect zombie problems ask for.

### Spawn / respawn / death

- `spawn.mjs` = our spawn.sh: refuses if pid alive or port taken, detached
  child, pid JSON, per-bot log. `stop` = best-effort POST /stop then
  kill-tree.
- Runner auto-reconnect: backoff 5s/10s/20s then 60s cap; `manualRelog` flag
  so /relog doesn't race the auto path; **stale-bot-instance guards**
  (`if (b !== bot) return`) on 'end'/'error'/'death' so a zombie's events
  can't clobber state or double-connect; a sync-throw catch in connect()
  that re-arms backoff (their "Zug bug": createBot throwing synchronously
  used to leave the bot offline forever).
- **Death protocol**: death fails the active task immediately; `deathCount`
  + `lastDeath{pos,ts}` in /status; the dying task's registered target
  (`ctx.setTargetPos`) gets **poisoned for 15 min** (TTL map) and every
  skill's findBlock matcher skips poisoned positions — no automatic retry
  into whatever killed the bot, ever. `/recover` runs `recoverKit`:
  depth-gated safeDescend to the death pos, goto, collectDrops radius 8, all
  under a 90s time budget. We have no engine-level death handling at all.

---

## 2. Their gray voice: rconchat.js vs our graybridge.js/graychat.js

Same wire effect, opposite layering.

| | CAVECREW rconchat.js | Ours graybridge+graychat |
|---|---|---|
| What it is | ESM library, in-process raw-TCP Source-RCON client used by the **overseer/orchestrator** | Standalone HTTP daemon (127.0.0.1:3199) + per-bot injected `bot.chat` monkey-patch |
| Who speaks | Operator tools speak FOR bots (`sayStatus(name,color,text)`); bots' own chat stays real chat | Each bot's own routine chat is rerouted through the bridge |
| Protocol | Full request/response correlation by packet id; commands serialized on a promise chain; one retry after forced reconnect; returns command responses | Fire-and-forget queue (cap 100), 120ms rate limit, no response reads |
| Failure mode | Throws to caller (caught and logged) | **Falls back to real chat** so no message is ever lost |
| Config | `cave/local.json` `{rcon:{host,port,password}}` | `bots/.rcon` password file (shared by them — same server RCON) |
| Format | `<` dark_gray + `[CAVE] Name` team-color + `> ` dark_gray + gray body | `<` gray + `[FEL] Name` team-color + `> ` gray + gray body |
| Extras | `sayFancy` (gold body), `sayRainbow` (diplomacy voice, words cycle 7 rainbow colors) | `!` prefix = important white passthrough |

They have internalized our key warning (their FEEDBACK, open): tellraw lines
don't fire `chat` events, so protocol lines (`DEPOT |TRADE |USING |FREE
|LEASE-BREAK |BASE |CLAIM |HELLO |OFFER `) must stay REAL white chat — the
same exclusion list our graychat passthrough regex uses. Since their gray
voice is overseer-side only, their bots' protocol lines are naturally real
chat already. No interop conflict.

Worth borrowing from theirs: the response-correlated `send()` (we currently
can't read RCON command output through graybridge — useful for orchestrator
queries like `list`), and the promise-chain serialization instead of a
timer-drained queue. Not worth switching the per-bot side: our
fallback-to-real-chat behavior is strictly safer for bots.

---

## 3. Movement: what movement.js actually solves

**Not** what we hoped: there are **no travel-vs-work Movements profiles, no
surface preference, no skyLight/tunnel detection, no dig-free travel mode.**
They never touch `new Movements(bot)` settings at all — their FEEDBACK
imports OUR Movements-safety profile as an open item they haven't shipped.
On the travel-tunneling / unsafe-defaults front we are both unsolved and we
are ahead on diagnosis. Nothing to steal there; something to give.

What it IS: a **dual-engine abstraction** — one `goTo(bot,
{x,y,z,range,timeoutMs,engine}, ctx)` entry point over:

- `pf` — mineflayer-pathfinder looping-goto (their gotoLoop verbatim: 45s
  timeout, 5 attempts, cancel = `setGoal(null)` ONLY, same stop()-poisons-
  next-goal rule we know);
- `ash` — `@miner-org/mineflayer-baritone` 4.6.2 (bot.ashfinder), gracefully
  degrading to pf when not installed;
- `auto` — try ash, fall back to pf on failure (but NOT on cancellation, so
  a /stop can't accidentally start a second engine).

The gold is the **ashfinder gotcha catalog**, verified by source read of
v4.6.2 — directly de-risks our planned ashfinder second engine
(AUTONOMY_PLAN / "/goto2"):

1. `goto()`/`gotoWithPath()` ALWAYS resolve `{status:'success'}`, even for
   unreachable goals — the honest verdict is `generatePath()`'s own status
   (`found|partial|no path`), and the only trustworthy final check is
   `goal.isReached(bot.entity.position)` yourself (with a ~750ms
   settle-and-recheck window: physics lags the executor by a tick or two).
2. **Hang bug**: `bot.ashfinder.stop()` during an in-flight goto leaves that
   await pending FOREVER (the completion promise only settles in
   `_onPathEnd`, skipped once executing=false). Their fix: wrap every
   ashfinder await in a race against timeout + 200ms cancel/stale-generation
   poll, and abandon (never re-await) the library promise; still call the
   real `stop()` because it's the only thing that clears in-world controls.
3. Cancel APIs are not interchangeable: ashfinder's `stop()` is correct for
   ash; pathfinder's `stop()` remains forbidden.
4. Only `stopped`/`pathStarted` events actually exist in 4.6.2 — the
   README's goal-reach events are fiction.
5. Load ordering: resolve the module ONCE before the first connect, then
   `loadPlugin` synchronously inside wireBot BEFORE mineflayer's spawn fires
   — otherwise bot.ashfinder looks loaded but never works (its real
   executor is built in its own internal spawn handler).
6. On any ash failure, `stop()` before releasing the mutex or starting pf —
   else the still-self-replanning PathExecutor and pathfinder fight over one
   bot. Token-guarded via a per-bot WeakMap so a superseded run never kills
   a newer run's path.

Their field measurement (DRIVER_GUIDE): **pf is faster on open ground**;
ash worth trying for tight cave navigation; proper A/B pending.

**Stall recovery** lives elsewhere, in two places:

- `skills.js runTargetWithWatchdog(bot, ctx, 25000, stepFn)` — per-target
  watchdog with THREE progress signals: moved >0.5 blocks, inventory
  changed, any `diggingCompleted` event. No progress at timeout = genuine
  stall → skip that target, count it, 3 consecutive stalls → task fails
  'stalled'. Progress observed = merely slow → keep awaiting the real
  result. Much smarter than movement-delta-only stall busting (ours
  false-positives on slow digs and stomps goals).
- Overseer level: position frozen >150s during a goto → tp home (see §1;
  we'd substitute a non-cheat recovery).

Also in skills.gotoLoop: the spurious `"goal was changed before it could be
completed"` rejection gets rechecked against ACTUAL distance to goal
(success if within range+0.8) before being treated as a failure — a direct
patch for our path_GoalChanged plague.

---

## 4. TRADE / CIV protocols — the exact spec

### Trading post (built + stocked, live since 2026-09-01)

- Location: flat 3-block ridge **x=6-8, z=22, y=112** (neutral ground).
- Layout: **WEST chest (6,112,22) = CAVE shop** (goods cavecrew offers),
  gap (7,112,22) holds a crafting table, **EAST chest (8,112,22) = FEL
  shop** — left empty FOR US to stock with our own offers.
- Sign labeling failed (bot placeBlock blockUpdate timeout on top of
  chests, target still air afterward) — labels are chat + docs only. They
  flagged sign-on-chest placement as an open investigation.

### The one rule (verbatim semantics)

> Take from the other tribe's shop chest = leave fair payment in the SAME
> chest, and say a ledger line in chat.

Canonical ledger format (TRADE.md):

```
TRADE take 8 iron_ingot, leave 20 oak_log (FEL shop)
```

i.e. `TRADE take <N> <item>, leave <M> <item> (<CAVE|FEL> shop)` — the
parenthetical names the shop chest the transaction happened in. CIV.md's
announcement used the short form `TRADE take X leave Y`; parse both.

For OUR bots concretely:
- To buy: open the **WEST/CAVE chest (6,112,22)**, take what we want, put
  fair payment **into that same WEST chest**, announce e.g.
  `TRADE take 20 oak_log, leave 8 iron_ingot (CAVE shop)`.
- To sell: stock the **EAST/FEL chest (8,112,22)** with our offers
  (announce with a DEPOT-style line — "restocking own shop = always
  allowed"); later collect payments left in it.
- Fairness is judged by the taker; disputes are settled in chat between
  diplomats — their diplomacy voice is **Grog** (rainbow text).
- The **no-touch pact stays for EVERYTHING else** — only these two chests
  are mutual-touch. "No taking without paying. No emptying a shop to grief."

### Standing market

- CAVE offers: wood (oak/birch logs + planks), cobblestone; later cooked
  food, coal, spare tools. Current stock (seeded 2026-09-01): 20 oak_log +
  20 oak_planks + 20 cobblestone.
- CAVE wants from us: **iron ingots, food animals/meat, redstone later.**
- Their TODO #9: "Watch FEL shop chest for first trade; restock CAVE shop
  as it drains" — they are actively waiting for us to make the first trade.

### CIV.md conventions (their fleet state)

- Ports 3200-3299 reserved (3298 = short-lived test bots — mirrors our 3106
  test-bot idea); roster UngaBunga 3201 (lumber/builder), Grog 3202
  (miner, senior driver + diplomat), Zug 3203 (food), Bonk 3204 (builder),
  Thak 3205 (iron miner). **Overseer config additionally lists Ook 3206
  (red, hunter)** — roster drift, expect a 6th bot named Ook.
- Team tags: per-bot in-game team `cave_<Name>`, chat prefix `[CAVE]`,
  created via RCON `team add` / `team join`.
- Camp: (11-12, 89, 55-57) — table (12,89,56), chest A wood (11,89,55),
  chest B tools (12,90,54), furnace being rebuilt at (11,89,57), grove
  (8,91,68), mine entrance (15,89,57). Goal ladder: wood → stone → iron →
  farm → base → depot (they're mid-iron-age).
- Their DEPOT ledger format **includes a chest suffix**:
  `DEPOT +N item (chest X)` / `DEPOT -N item (chest X)`, e.g.
  `DEPOT -8 iron_ingot (chest A)`. Ours omits the suffix.
- Their BASE.md is explicitly "FEL-protocol compatible": planned-before-
  gathering reservations, `BASE +<id> at (x,y,z)` announcements,
  `USING <id>` / `FREE <id>` leases, heartbeat ≤4 min, `LEASE-BREAK <id>
  (stale)` after ~5 silent min, and our furnace safeguard (never break a
  furnace lease if ANY slot is non-empty). They also honor our territory:
  "no builds within 10 blocks of FEL base (-3,111,4) + depot chests."
- Their standing driver laws mirror ours: idle >3 min → act or ping lead;
  `/collect {"radius":24}` sweep after every chop/mine/hunt; depth law (no
  raw /mine >4 blocks below feet — staircase + branch mine instead); two
  disconnects in a row → report, don't loop /relog; "compliments go over
  well with KackboonKevin specifically."

---

## 5. Steal-worthy: concrete mechanisms better than ours

Ordered by value-for-effort. Effort: S ≈ ≤2h, M ≈ half–full day, L ≈ 1-2 days.

1. **safeDig / safePlaceBlock verify-on-timeout wrappers (S).** Every
   dig/place races a 10s timeout; on timeout OR rejection, re-check world
   state (`blockAt` gone / non-air) before believing it failed. Directly
   closes our open FEEDBACK item (peter-driver's dozen+ spurious
   `blockUpdate timeout` failures). Drop-in pattern for skills.js.
2. **Generation counter + isStaleGeneration threading (M).** Bump a counter
   per (re)connect, snapshot in each task ctx, poll it (with isCancelled)
   every 200ms inside every movement race; stale → fail fast, abandon (never
   re-await) the loser promise; token/WeakMap guard so superseded runs can't
   cancel newer runs. Kills our orphaned-goto-poisons-later-goals class and
   the zombie-bot-after-relog class in one mechanism.
3. **External overseer process instead of injected idleguard (M).**
   LLM-free watchdog over the public HTTP API: idle >60s → role-default
   round-robin task, disconnected → throttled relog, stuck-goto → recovery.
   Combined with a real single-task mutex it is structurally incapable of
   the idleguard-vs-driver goal fights we keep diagnosing, and it survives
   bot restarts because it isn't inside the bot. (Port WITHOUT the RCON tp —
   our no-cheat rule; use relog/recovery-task instead.) Requires: our runner
   exposing a driver-grade /status and a /stop that actually cancels engine
   tasks (see item 5).
4. **Death protocol: target poisoning + deathCount + /recover (M).**
   `ctx.setTargetPos` before every approach; on death, poison that spot for
   15 min (TTL map), skip poisoned positions in every find matcher, expose
   deathCount/lastDeath/poisonedTargets in status, and a time-boxed (90s),
   depth-gated recoverKit skill. We currently have zero engine-level death
   handling; this also encodes "never auto-retry into what killed you."
5. **Runner-level task mutex + honest /stop + /events ring buffer (M).**
   409-busy + force semantics, /stop that flips ctx.isCancelled for the
   engine task (our known gap: POST /stop doesn't cancel __skills tasks),
   and a seq-cursored 500-event ring buffer (chat/health/death/kick/task/
   quirk) so drivers stop tailing logs.
6. **runTargetWithWatchdog 3-signal stall detector (S-M).** Progress =
   moved OR inventory changed OR a block broke; stall → skip target and
   continue, 3 consecutive → fail 'stalled'; progress-but-slow → keep
   waiting. Wrap our per-target loops (mineLane, chopTrees, hunt) in it and
   retire movement-delta-only stall busting.
7. **ensureTool auto tool chain (M-L).** Resolution order: inventory →
   depot chest withdraw (auto-announces the DEPOT ledger line) → full craft
   chain (logs → planks/sticks → table → bootstrap wooden_pickaxe → 3
   shallow depth-gated cobble → stone tier), with an anti-recursion flag
   (chopTrees-inside-ensureTool) and a **return-to-intended-start guard**
   (ensureTool's depot trip once relocated a bot so its branch-mine trunk
   went through their own camp furnace — they now snapshot the start pos and
   walk back). Pairs perfectly with our planned durability tracking to fix
   "pickaxe broke at depth, bot stranded".
8. **Ashfinder integration playbook (S to absorb, M to wire).** Gotchas
   §3 above: generatePath-status-is-the-truth, isReached self-check +
   settle window, stop()-hang race wrapper, load-before-spawn ordering,
   engine-token cancel isolation, auto-fallback that respects cancellation.
   Adopt movement.js's goTo shape when we vendor ashfinder.
9. **findBlock matcher null-position guard (S).** mineflayer's findBlock
   calls the matcher during a palette pre-filter with `position === null`;
   any matcher that keys on b.position without a guard throws the moment a
   nearby chunk section contains the block type. Audit our skills.js
   matchers today — this is a latent crash bug for us.
10. **collectDrops exactness fixes (S).** Walk onto the drop's exact
    floored block with GoalBlock (GoalNear range 1-2 stops outside the
    ~1-block vanilla pickup radius); per-drop stuckIds so one unreachable
    drop can't abort the pile; only count a drop handled once the entity is
    gone; and **preDigSnapshot** — diff inventory from BEFORE the dig, since
    vanilla auto-pickup often beats the sweep and made collected[] silently
    empty.
11. **Sapling replanting after chopping (S).** replantSapling: after
    felling, place a carried sapling back on the soil block if the spot is
    free. Sustainability + our aesthetics goal for free.
12. **Sealed staircase details (S-M).** buildStaircase seals liquid/air
    exposures on ALL four sides at foot height plus the floor cell every
    step (SEAL_MATERIALS regex), aborts on lava sight in a 4-cell watch set,
    torches every 8 steps with on-the-spot torch crafting (coal+stick→4).
    Compare against our safeDescend v4 and merge the side-sealing.
13. **Passive-mob allowlist for hunting (S).** huntAnimals refuses anything
    not on an explicit 30-entry passive list AND double-checks
    `e.type === 'player'` at target-selection and per-swing in the manual
    fallback. Verify our huntAnimals has an equivalent allowlist, not just a
    player check.
14. **rconchat response correlation (S).** Packet-id-correlated send() with
    a serialized promise chain, so orchestrator tooling can READ command
    output (`list`, `data get`, etc.) — our graybridge is write-only.

Not steal-worthy / we're ahead: crafting (their /craft still batch-crafts
and pocket-crafts — they hit the void quirk we've already characterized;
our at-the-table + one-at-a-time + settle-verify discipline is stronger);
Movements safety profiles and surface/skyLight detection (they have none —
export ours to them); chopTrees tree identification (theirs climbs a single
vertical column instead of flood-fill, which incidentally can't eat
horizontally-connected structures but still fells bare log pillars — no
leaf-canopy check either; our planned canopy check should flow to them).

---

## 6. Interop risks and notes

1. **BASE id collisions across tribes.** Both registries use `furnace_1`,
   `chest_a...`-style ids. A chat line `USING furnace_1` from a CAVE bot
   refers to THEIR furnace, not ours. Our lease-checkers MUST scope
   USING/FREE/LEASE-BREAK lines by speaker (known CAVE names / `[CAVE]`
   prefix) before treating them as claims on our rows — and vice versa;
   consider namespaced ids (`cave:furnace_1`) in any cross-camp
   announcement.
2. **DEPOT ledger format drift.** Theirs: `DEPOT +N item (chest X)`; ours:
   `DEPOT +N item`. Their "chest A/B" letters name THEIR chests at
   (11,89,55)/(12,90,54) — same letters as our A/B/C, different chests. Any
   parser matching on "(chest A)" must scope by speaker. Recommend our
   drivers tolerate (and ignore) the suffix on inbound lines, and that we
   keep emitting our plain form.
3. **Trading post orientation is load-bearing.** WEST (6,112,22) = CAVE
   shop, EAST (8,112,22) = FEL shop. Taking from the EAST chest without
   having stocked it, or leaving payment in the wrong chest, reads as theft
   under their one-rule. Payment goes in the SAME chest you took from.
   Everything outside these two chests remains strictly no-touch.
4. **TRADE line parsing.** Support both `TRADE take <N> <item>, leave <M>
   <item> (<X> shop)` and the short `TRADE take X leave Y`. TRADE lines are
   real white chat (both sides exclude protocol prefixes from tellraw), so
   bot.chat listeners will see them.
5. **Their bots may teleport.** The overseer RCON-teleports stuck bots to
   camp (12,91,52). Don't file a CAVE bot vanishing/appearing as an anomaly
   or an exploit report; also do NOT copy this (our no-cheat rule).
6. **Roster drift on both sides.** Their DRIVER_GUIDE's protected-neighbors
   list is stale (only Friedrich/Marcel/Bernd/Kevin; CIV.md adds Peter and
   "BratwurstBodo" — a name we don't currently run). Symmetrically they run
   Ook (3206) who is absent from their own CIV roster. When either fleet
   adds a bot, announce it in chat (`HELLO` line) so conduct rules attach to
   the new name immediately.
7. **Mystery chest (-1,91,56).** Flagged "unknown owner, do not touch" in
   their BASE.md. If it's ours, claim it in chat; if not, matching entry in
   our docs would prevent an accidental grab.
8. **Poison lists are per-runner, not shared.** Their death-poisoned spots
   (15-min TTL) aren't broadcast; a location that killed a CAVE bot won't
   be flagged to us. Cross-tribe hazard sharing stays manual chat (our
   BASE.md hazard zones are the better vehicle — consider announcing them;
   their camp is ~60 blocks from hazard zone #2's stay-clear radius edge).
9. **Their FEL-facing conduct is solid**: never attack players, never touch
   our chests/builds, /hunt hard-refuses players and non-allowlisted mobs,
   trade etiquette forbids grabbing extra from open chests. Low risk of
   accidental griefing from their deterministic layer.
10. **Path etiquette precedent**: our path_1 deliberately stops 5+ blocks
    short of their chest; their planned path (door(11,90,58)→(7,112,23))
    heads to the trading post, not into our base. Keep both conventions.

## Suggested next actions (for the lead)

- Make the first trade: stock the FEL shop (8,112,22) with iron ingots
  and/or cooked meat (their stated wants), take wood/cobble from the CAVE
  shop with a proper `TRADE take ..., leave ... (CAVE shop)` line. Cheap
  goodwill, tests both parsers.
- Port order: steal-worthy items 1, 9, 10 (same-day small fixes), then 2+5
  (generation + honest /stop + mutex) as one engine work cycle, then 3
  (overseer) and 4 (death protocol).
- Export to them (they've asked via FEEDBACK): our Movements safe profile,
  travel-vs-work profile design once built, surfaceExposed/skyLight signal,
  craftSafe discipline, torch-underfoot wedge fix.
