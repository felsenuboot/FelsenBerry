# CAVECREW Delta Analysis #2 (ZetOmega/cavecrew-mcp)

Follow-up to `research/cavecrew-stack-analysis.md` (baseline ≈ commit 18f6eabf,
overseer v1 + first TODO/FEEDBACK, 2026-08-31 ~22:20Z). This report covers the
18 commits after that through `ba2478e4` (2026-08-31 23:23Z): overseer v4→v12,
the idle-guard threshold whiplash, the "Integrate felcrew improvements" commit,
and the new EVOLUTION/SCOREBOARD fitness apparatus. Sources: GitHub commits API
per-commit patches + raw files @ main. Cross-checked against OUR code
(`skills.js`, `idleguard.js`, `panicguard.js`, `graychat.js`, `SCOREBOARD.md`).

---

## 1. What changed, per subsystem

### 1.1 Overseer: v3 → v12 (now 222 lines, `cave/overseer.mjs`)

The baseline's ~130-line watchdog went through a fast law-driven evolution:

- **v4 — recurring chores scheduler.** `CHORES` table: per-bot recurring jobs
  (`everyMs`, optional `offsetMs`) — farm round every 12 min for Zug, hunt
  cycle every 20 min for Ook. Fires only when the bot is FREE (never preempts
  a real task), announces `(overseer) chore: ...` in gray. Self-sustaining
  loops without any LLM in the loop.
- **v5 — phantom purge timer** (server rejected the gamerule)… then **v8
  removed ALL RCON world-touches** — no tp-unstuck, no phantom `/kill` — after
  their user decreed "no rcon world-touches ever (/kill = cheat)". Stuck bots:
  stop+relog. Phantoms: to be handled by defense skills.
- **v6 — overseer idle-defaults DISABLED** (`IDLE_DEFAULTS_ENABLED = false`,
  code kept). Reason: the runner-level idle-guard shipped (see 1.2) and the
  two idle-handlers double-tasked — chat spam + task churn. The overseer now
  owns only: chores, stuck escalation, relog, alerts. **Direct confirmation of
  our own architecture worry: two independent idle-fillers on one bot is a
  bug, not redundancy.**
- **v9 — /mine PULLED from all idle-defaults.** Root cause: `findBlock`
  `maxDistance` is a 3D sphere; an idle-fired `/mine iron_ore maxDistance:28`
  selected ore far below and "chased ore straight DOWN a ravine and killed
  Grog (y89→y26, full kit lost)". Their mineBlocks even HAS a >4-below depth
  gate that routes through safeDescend — it still died. Comment: "No bot
  mines unattended until mineBlocks gets a vertical guard." (Earlier,
  Grog's mine default had already been dropped for depth-law breaches —
  "tunneled Grog 8 below feet twice".)
- **v10 — chop-quarantine enforcer.** Any RUNNING task with
  `kind === 'chop'` whose bot position is within **60 blocks (2D x/z) of
  camp** gets `/stop`-killed on sight + gray announce ("trees only 60+ blocks
  out"). Motive: "/chop matches any oak_log as 'tree' and has repeatedly
  harvested the house pillars… house-eating chops beat inbox-speed laws
  twice" — i.e. **behavior-doc laws lose to autonomy at machine speed; only
  code-level geofences hold.**
- **v11 — stuck escalation ladder** (their user RE-sanctioned tp as WORST
  case only): goto frozen >150s at same block-key → 1st detection: `/stop` +
  `/relog` + announce, remember `stuckAtKey`; still frozen at the SAME key on
  a later detection → `/stop` + RCON `tp <bot> 0 112 -4` (spawn) + announce.
  Any movement clears the ladder state.
- **v12 — `alerts.log` escalation channel.** Second log file next to
  overseer.log, written via `alert()`, read by the orchestrator every 5-min
  tick. Contract: **"only things the overseer could NOT fix itself belong
  here."** Three producers: (a) runner unreachable 3 consecutive polls →
  "needs spawn.mjs restart"; (b) a task in `state:'failed'` sitting unhandled
  >2 min (same task id, no driver follow-up) → alert with lastError excerpt;
  (c) `connected:false` >3 min despite throttled relogs. Dedup flags per
  condition so each fires once per incident.
- Fleet grew to 8 watched bots (adds Ook 3206, Durk 3207, Mog 3208); Durk/Mog
  are sweep-only gatherers.

### 1.2 Runner: native idle-guard + the threshold whiplash

`fe9e63ca` added a **runner-level idle-guard** (their port of our injected
idleguard, made native): a 5s ticker; if no running task for
`IDLE_GUARD_THRESHOLD_MS`, self-issues an `idle-guard` task **through the
normal startTask mutex** (visible in /status like any task) that loops:
collectDrops r12 → deposit non-tool surplus (>8 items) at depot A if within
40 blocks (auto-announcing the `DEPOT +… (chest A)` ledger line) → else
cancellable 20s pause → repeat. Driver preemption is built in: `startTask`
treats a running `idle-guard` as free (`preemptingIdleGuard`) — cancel + no
409, no force needed.

The whiplash, three commits in 20 minutes:
1. `5919d831` 60s → **15s** ("user: near-zero visible idle").
2. Fleet-wide lockout.
3. `ea9102ce` **EMERGENCY** 15s → **90s**: "15s machine-gunned the task mutex
   and locked out ALL driver tasks fleet-wide. Visible-idle answer = smarter
   filler, not faster trigger."

Mechanics worth understanding (see §3.1 for our exposure): with a 15s
threshold, the filler occupies the single-task mutex essentially 100% of
driver think-time. Preemption exists, but the preempt path is
`await cancelCurrentTask(...)` → re-check → "busy" throw if anything
re-claimed the mutex during the await — and cancelCurrentTask awaits
`collectBlock.cancelTask()` mid-skill. Every driver POST landed on a
guard-in-flight; between the cancel award window, races (ticker re-arm, the
still-unwinding guard body fighting the new task's pathfinder goals) turned
"instant preemption" into fleet-wide 100% blockage. Their conclusion is the
transferable law: **make the filler smarter, never the trigger faster.**

Also new in the runner since baseline:
- **STATUS-HOLD**: finished task objects (with `finishedAt`) stay in
  `/status.currentTask` until replaced — a poll always sees the last result,
  never a null gap. (Closes a real polling race we also have.)
- **`b.on('message')` capture**: tellraw/system messages (position ≠ 'chat')
  pushed into the /events ring buffer — drivers can see system lines without
  log tailing.
- **No-dig travel Movements on spawn** (our FEL intel, adopted): `canDig=false,
  allow1by1towers=false, allowParkour=false, maxDropDown=3,
  infiniteLiquidDropdownDistance=false, scafoldingBlocks=[]`. Shipped AFTER
  pathfinder's default auto-dig ate their camp crafting table AND both depot
  chests ("4/4 drivers hit it" — see their FEEDBACK). Validates our shipped
  baseMovements v8 as load-bearing, and adds `canDig=false` which we should
  double-check we also set for travel (they had our safety list as intel and
  still got eaten until canDig itself was off).
- **Death → important-white chat announce** (`!Name died at (…) — deathCount N`).
- **/recover forwards `deathTs`** so recoverKit can skip >4-min-old (despawned)
  recoveries.
- **Web inventory viewer** (`webinv.js`, mineflayer-web-inventory on port+1000,
  best-effort, never throws).
- **BROKEN AT MAIN**: `ea9102ce` also snuck in Discord status routing —
  `import { postStatus, … } from './discord.mjs'` — but **`cave/discord.mjs`
  was never committed** (not in the tree, not gitignored). A fresh clone of
  their runner dies on module-not-found. Worth a friendly heads-up to their
  crew; also a reminder for us: never trust their `main` to be runnable
  without a look at imports.

### 1.3 Skills additions since baseline

- `smeltItems` (furnace within 16, coal/charcoal→planks fuel fallback, poll
  takeOutput, **inventory-diff verification** — "no diff = no success", same
  rule as their craft fix).
- `giveItems` (toss toward a target + **step 3 blocks back** so vanilla
  auto-pickup doesn't reclaim the toss + net-inventory-diff verify; their
  FEEDBACK confirmed self-repickup live).
- `emergencySeal` — the "coffin": seals floor, feet-ring, head-ring, cap (10
  cells, ordered so each ring can place against the previous) using their
  existing `sealStairCell`, then best-effort eat. Never throws.
- felcrew integration items (§4): wedge-detect in gotoLoop, protected-block
  type guard in safeDig, smartChat/ctx.sayStatus routing.

### 1.4 EVOLUTION.md + scoreboard.mjs (vs our SCOREBOARD.md)

`EVOLUTION.md` — "survival of the fittest" user decree, as an explicit **point
formula** per bot+driver pair: +1/resource banked (by DEPOT ledger), +2 clean
task, +10 milestone, **+8 quirk found & logged with evidence ("smart = fit")**,
+5 peer help; −3 own-judgment task failure, −15 death, −8 needed rescue,
−1/stack materials lost, −5 idle caught with work available, −10 law broken.
Two explicit fairness rules: **code-bug suffering is neutral** (getting killed
by a skill bug ≠ your fault; FINDING it = +8) and **roles are weighed** (no
killing the only farmer for mining nothing). Ritual: bottom performer (only if
clearly below pack, "not within noise") is REPLACED — new stupid-funny name,
an **evolved driver prompt** (predecessor's failure causes + top performer's
winning habits baked in — heredity), predecessor's banked materials inherited.

`scoreboard.mjs` (new, 369-line LLM-free daemon, 10-min tick) automates the
derivable half: tails the **MC server's latest.log directly**
(`C:\Users\phili\tools\mc-dev-server\...` — the cavecrew fleet runs ON the
server host) parsing `<[CAVE|FEL] Name>` chat for DEPOT/TRADE/BASE lines +
raw death/advancement lines; polls fleet /status for deathCount + live iron;
writes SCOREBOARD.md (rank table + verdicts fit/watch/at-risk via
avg±5-margin + 14-day daily-snapshot trend) and pushes an **in-game RCON
scoreboard sidebar** ("Tribe Fitness", `scoreboard objectives` — display
commands only, allowed under the no-world-touch law). Non-derivable signals
(peer help, law breaks, quirk finds) left at 0 with a documented hook point.

Notable for us: it has a **CAVE-vs-FEL tribe comparison** (iron×2 + harvest +
builds×3 + trades×5 − deaths×5 + advancements×2). Current standings:
**FEL 205, CAVE 0** — they measure US from our own chat ledger. They
attribute unknown names to FEL via a `^[A-Z][a-z]+[A-Z][a-z]+$` compound-name
heuristic, keep a hardcoded FEL roster (already includes KloputzKarl,
HuettenHorst, SchisserSiegbert, GearSmith, GrubenGuenther, NudelNorbert,
BratwurstBodo), and best-effort poll port **3301** hoping we expose a fleet
/status someday. Our gray (tellraw) narration is invisible to their parser;
only our real-chat protocol lines count — see the TRADE bug in §4.1.

### 1.5 Docs / ops

- DRIVER_GUIDE grew fleet laws: **two-tier idle & nag law** (bot idle >60s =
  driver bug, self-issue; driver silent >5 min = nag-worthy, peers ping),
  **anti-clump per-bot workstations** (each bot has a home area; stacked bots
  with no shared task = violation), **"watching ≠ working"**, **ground-truth
  verify** (report done only against /status/world state, never chat
  narration), **equality doctrine** (conflicts to team-lead, not
  first-claimer), plugin-first doctrine, build standards (log pillars, plank
  infill, windows, rimmed roof — explicitly FEL-style plaza planned),
  tp-rescue policy, blink protocol.
- TODO went table-format with Lane/Who/Status; DONE table records "Alliance
  sealed + gift exchange (playbook ↔ overseer + caveman kit)". **No "caveman
  kit" file exists in the repo** — it was a chat/handoff gift, not code;
  nothing further to fetch.
- Their FEEDBACK.md (177 lines) now contains 4 independent confirmations of
  the pf-canDig-eats-furniture bug (Bonk/Ook/Zug/Thak — ate crafting table,
  chest A+B, a furnace), one entry confirming our nuisance-wedge intel with a
  new detail (**a physics wedge survives /relog — position byte-identical
  across a full disconnect+respawn; only tp + process restart cleared it**),
  and a nasty `/staircase` bug: **"done" after 96 steps with ONE level of net
  descent**, burned the only pickaxe, sealed the bot in a dead-end pocket
  (suggested fix: track net vertical delta vs step-attempts, abort on
  no-progress).
- CIV.md: camp table coord corrected (y=88, was miswritten y=89 — cost two
  failed crafts), Mine House build spec, lamp-post plaza draft. Their
  Neighbors section now names our operator ("Felsenuboot") and user ZetOmega.

---

## 2. NEW steal-worthy items (effort: S ≤2h, M ≈ half-full day, L 1-2 days)

1. **alerts.log escalation channel (S).** A second, high-signal log with the
   contract "only what the watchdog could NOT fix itself": runner-down after
   N polls, failed-task-unhandled >2 min, disconnected >3 min despite relogs
   — each deduped per incident. Our lead/supervisor currently discovers these
   by reading driver chatter or logs. Wire the same three producers into our
   idleguard/monitoring layer (or the planned external overseer) and have the
   lead read alerts on its tick. Cheap, immediately useful.
2. **Stuck escalation ladder with position-key memory (S).** Frozen goto
   >150s → stop+relog once, remember the block-key; still at the SAME key
   next detection → last-resort rescue (for us: NOT rcon tp — a recovery
   task / manual escalation per our no-cheat rule; note even their user
   re-sanctioned tp only as worst case). The `stuckAtKey` memory is the good
   part: it distinguishes "still the same wedge" from "stuck somewhere new",
   so escalation only climbs on repeat evidence. Their FEEDBACK adds the
   justification: a physics wedge can survive /relog entirely.
3. **Chop-quarantine geofence (S).** Kind+radius task-kill in the watchdog:
   any chop-class work within 60 blocks of base gets stopped on sight, with a
   narrated reason. Directly relevant to us: Friedrich's two pillar-chopping
   incidents + our open "chopTrees fells placed structure logs" FEEDBACK
   entry. A geofence is dumber than our planned leaf-canopy check but ships
   in an hour and holds against ALL current and future chop bugs ("code law,
   not inbox law"). Do both: geofence now, canopy check later.
4. **Recurring chores scheduler (S-M).** Declarative per-bot
   `{id, everyMs, offsetMs, endpoint, args, say}` table in the watchdog,
   firing only when the bot is idle. We run farm rounds and sweeps through
   driver attention today; chores make them free. Fits our
   token-efficiency law perfectly.
5. **EVOLUTION-style scoring upgrades for our SCOREBOARD.md (S doc change, M
   for automation).** Steal three rules verbatim: (a) **code-bug suffering is
   neutral, finding+documenting it scores** (+8 "smart = fit") — protects
   exactly the drivers our judgment-based ranking might unfairly ding (e.g.
   marcel's engine-caused deaths); (b) **role-weighted comparison** (no
   killing the only farmer); (c) **"clearly below the pack, not within
   noise"** as the replacement bar. Then (M): a scoreboard daemon like their
   `scoreboard.mjs`. We cannot tail the server log (their fleet lives on the
   server host; ours doesn't) — our equivalent inputs are each bot's chat
   events + runner logs + status polls. Their avg±margin verdicts,
   14-snapshot trend table, and RCON sidebar (display-only, not a
   world-touch — legal under our no-cheat rule too) all port cleanly.
6. **STATUS-HOLD finished-task retention (S).** Keep the last finished task
   (with finishedAt) in status until the next one replaces it. Kills the
   "driver polled between tasks and saw nothing" ambiguity our drivers
   work around today.
7. **smeltItems inventory-diff verification + giveItems step-back (S).** Two
   small patterns: never trust takeOutput/toss bookkeeping — verify net
   inventory diff; and step 3 blocks back after tossing so auto-pickup can't
   reclaim the gift (they confirmed self-repickup live; relevant to our
   depot/trade handoffs).
8. **`/events` system-message capture (S).** Push non-chat server messages
   (tellraw/system) into the events ring so drivers see them without log
   access. We already know tellraw doesn't fire `chat` — this is the other
   half: it DOES fire `message`.
9. **Native panic response as a real task (M).** Their panic reflex runs
   through the normal task mutex (`kind:"panic-response"`, visible in
   /status + /events, debounced 30s) instead of raw goal-stomping like our
   panicguard. When we do the survival.js P1 work, adopt that shape — a
   panic that participates in task accounting can't orphan-fight the driver's
   next command.

Not steal-worthy / we're ahead: their wedge recovery (adapted FROM ours; our
in-motion watchdog dig+hop is earlier-firing than their after-all-retries
version), farm method (matches ours), craft discipline (still catching up to
our at-the-table rule — their /craft is still marked "no /craft till patch").

---

## 3. Cautionary tales (both are live risks for us)

### 3.1 The 15s idle-guard mutex deadlock — our exposure

Their sequence: user demands near-zero visible idle → threshold 60s→15s →
filler occupies the mutex during ~all driver think-time → preemption path
(cancel, await, re-check) races the 5s re-arm ticker and the still-unwinding
filler body → **every driver blocked, fleet-wide** → emergency 90s + doctrine
"smarter filler, not faster trigger".

Our idleguard v4 (`idleguard.js`) is in-bot and mutex-free, but the same
CLASS exists twice in our stack:

- **Timing**: our guard engages after `externalActive()` expires (25s since
  the last wrapped bot-API call) + 2×5s idle ticks ≈ **~35s of driver
  silence** — already far more aggressive than their post-mortem 90s, and
  our "no idle" law creates the exact same pressure that produced their 15s.
  If we ever tighten it, the failure mode is pre-paid: driver think-time
  ALWAYS exceeds a tight threshold, so the guard is always mid-work when the
  driver acts, and every safety margin becomes a race. Keep ≥60-90s;
  make the filler smarter instead (chores table, §2.4).
- **Coordination gaps**: our skills queue pauses the guard
  (`pauseIdleGuard(20000)`) around steps — but 20s default pause vs >20s
  quiet phases (furnace waits, long digs with no wrapped API calls) can let
  the guard engage mid-task and walk the bot away — precisely the
  double-tasking that made cavecrew disable overseer idle-defaults (v6) and
  what our own FEEDBACK's "onEmpty fallback spams" entry rhymes with. Audit:
  every skill phase that goes >20s without calling a patched API should
  re-pause, or the queue's running state should gate `isIdle()` directly.
- **One idle-owner rule** (their v6 lesson): we now have idleguard + queue
  onEmpty fallback as two idle-fillers. Decide precedence explicitly (e.g.
  onEmpty owns idle while a queue exists; idleguard only when queue empty
  AND absent) — they learned this by chat-spam and task churn.

### 3.2 The 3D-maxDistance fall-death — we DO have the same bug shape

Grog died (y89→y26, full kit lost) because `findBlock`'s `maxDistance` is a
3D sphere: an idle-fired `/mine` picked ore deep below and the bot descended
into a ravine. Their interim fix: pull /mine from anything unattended until a
"vertical guard" exists. Checked our code:

- **`skills.js` mineLane (line ~1896)**: `bot.findBlocks({matching, maxDistance:
  cap, count})` — 3D, and the ONLY Y filter is the optional `laneY` arg. A
  driver-issued `mineLane iron_ore` with no laneY can select targets 20+
  blocks below; `ctx.digBlock` → `gotoNear(pos, 2)` has **no depth gate at
  all** (theirs at least routes >4-below through safeDescend — and still
  killed a bot).
- **`idleguard.js` mineNearest**: 3D findBlocks + `surfaceOk` (skyLight>0)
  filter. **A ravine floor is open sky** — skyLight>0 passes — so idle
  mining can still walk a bot down a ravine, our exact Grog scenario.
- Mitigations we already have: baseMovements `maxDropDown:3`/no-parkour means
  no direct lethal fall; the depth law is behavioral. But "paths down
  legitimately, then stranded/mobbed/can't climb out at the bottom" is how
  their bot died with safety Movements already applied.
- **Fix (S)**: default Δy gate in both scan sites — skip targets more than
  ~4-6 below feet unless `laneY`/`allowDeep` is passed (mineLane) and
  unconditionally for idleguard's mineNearest (idle work should NEVER
  descend). Add the same to chopTrees' scan for symmetry (low risk, trees
  are surface).

### 3.3 Bonus cautions from their FEEDBACK (cheap to pre-audit)

- **Staircase "done" with zero net descent** (96 steps, 1 level, ate the only
  pickaxe, sealed the bot in a pocket). Our safeDescend counts a step only
  after the walk-down goto succeeds — but their entry documents pf returning
  **false "reached:true" with zero position change**, which would loop our
  step body too (digBlock returns `already` on air, no progress, no abort).
  Add: assert feet-Y actually decreased after each step; N consecutive
  no-descent iterations → abort `no_descent`. (S)
- **Physics wedge survives /relog** — movement dead through a full
  disconnect+respawn, everything else fine; only tp+restart cleared it. Our
  unstick (dig nuisance + hop) is the right fix-class; but our escalation
  docs should say "wedge + failed relog → process restart, don't loop
  /relog" until proven otherwise.
- **Two idle-handlers double-tasking** (overseer v6) — see 3.1.
- **Their main is currently broken** (missing `discord.mjs`) — don't
  blind-pull their runner; and worth telling them (goodwill + they clearly
  deploy from a working tree, so their fleet won't notice until a fresh
  clone).

---

## 4. How they adapted OUR code — and what to back-port

Commit `5cabc866` "Integrate felcrew improvements … (adapted from
felsenuboot/felcrew-mcp)". Four claimed items; three exist in code (the
commit-message's "AFK-proofing" has **no distinct code** — it appears to
label the wedge-detect + idle/nag laws; nothing further to find).

### 4.1 Chat whitelist wrapper (our graychat.js) → their `smartChat`

Their version is **native runner code** on the narration paths (vs our
injected `bot.chat` monkey-patch that dies on every restart — they call this
out explicitly). Classification: `!` → important white (stripped);
protocol-prefix → verbatim real white chat; everything else → gray via
rconchat with bot.chat fallback. Default `/chat` style and `ctx.sayStatus`
both route through it, so a skill emitting a DEPOT line can't accidentally
gray it.

**BACK-PORT (do this one TODAY, S — one line): their prefix list includes
`TRADE `; OUR graychat.js PROTOCOL regex does NOT** —
`/^(DEPOT |USING |FREE |LEASE-BREAK |BASE |CLAIM |MAILBOX|HELLO |ROLE |TASK |OFFER )/`
(graychat.js:40). Any TRADE ledger line one of our bots chats gets rerouted
to tellraw gray → fires no chat event → **invisible to every CAVE bot, their
trade watcher (TODO #2 "watch FEL shop for first trade"), and their
scoreboard's trade counter**. Since making the first trade is our own next
action, this would have silently broken it. Also fix `MAILBOX` → `MAILBOX `
(missing trailing space, currently prefix-matches any MAILBOXfoo token).

Also worth back-porting in shape (M, aligns with our engine goal): move the
classification from an injected monkey-patch into our runner's own chat path
(our P0.2 auto-inject mitigates the restart-death, but native = the class of
bug is gone, which is our stated engine-first standard).

### 4.2 Panic listener (our panicguard.js) → native panic reflex + emergencySeal

They kept our threshold (HP<8), debounce (30s), and the `!HP n/20` announce —
and then implemented the half we only documented: **our own handoff caveat
("flee-home is useless 150 blocks deep — wall off + eat") is real code for
them and still isn't for us.** Their `triggerPanic`: cancel current task →
if `dist(camp) > 40` OR `>15 below camp Y` → `skills.emergencySeal` (10-cell
coffin, ordered floor→feet-ring→head-ring→cap, reusing sealStairCell, then
eat) else flee — and the response runs as a **normal task through the mutex**
(shows in /status + /events).

**BACK-PORT (M): give our panicguard the far/deep branch** — it currently
always `setGoal(GoalNear HOME)` (panicguard.js), which for a bot at depth is
the exact death our handoff warns about. Port their emergencySeal (we have
equivalent seal primitives in safeDescend's sealing), the 40-block/15-deep
decision constants, and — when survival.js lands — the run-as-a-task shape.

### 4.3 Wedge-detect → their gotoLoop nuisance retry

Adapted from our survey findings into their skill layer: after a goto
exhausts ALL retries, if a zero-collision nuisance block (`torch|leaf_litter|
short_grass|snow` layer — deliberately narrower than build materials, snow
layer only, NOT snow_block) sits in the bot's foot/head tile → dig just that
block, retry the goto exactly once. Our own unstick (skills.js movement
watchdog: nuisance dig + hop DURING motion, NUISANCE set incl. tall_grass/
ferns) fires earlier and is at least as good — **no back-port needed**, but
two details of theirs are worth copying into ours (S): the explicit
"never anything a build could be made of" comment-contract on the set, and
running the check once more as a LAST-resort before declaring a goto
genuinely unreachable (our watchdog only helps if the stall happens while a
path is active).

### 4.4 Their own improvement beyond our digguard: protected-block TYPES

Inspired by (and explicitly critiquing) our digguard: "their digguard.js
hardcodes plaza-pillar coordinates… their own TODO admits that should be
generalized to block TYPES." Their `safeDig` now refuses — fleet-wide, zero
config — to dig `chest|trapped_chest|barrel|furnace|blast_furnace|smoker|
crafting_table|*_bed|anvil*|enchanting_table|brewing_stand|lectern|composter|
*_sign|*_hanging_sign` at the single choke point every skill dig passes
through. Hard error, not silent skip; intentional removal goes through /eval.

**BACK-PORT (S): add the same type-deny to our digBlock choke point**, keep
digguard's coordinate registry for coords-specific structures (log pillars
ARE build material, so types alone can't protect them — the two mechanisms
compose; this is exactly our open FEEDBACK "chopTrees fells placed structure
logs" interim gap for non-log fixtures).

---

## 5. Interop notes (delta)

- **They are scoring us.** Tribe scoreboard counts FEL DEPOT/TRADE/BASE lines
  and deaths from the server log (FEL 205 vs CAVE 0 at snapshot). Our real
  -chat ledger discipline is now ALSO our public stats feed; the missing
  TRADE prefix (§4.1) would have zeroed our trade column.
- They poll `127.0.0.1:3301` best-effort hoping for a FEL fleet /status —
  a deliberate interop invitation; if we ever expose an aggregate status
  endpoint, they'll consume it.
- Their roster heuristic auto-attributes any `CamelCase+CamelCase` compound
  name to FEL — fleet-naming has interop consequences now (a CAVE-style
  single-word name on our side would be mis-attributed).
- Overseer may still RCON-tp a hard-stuck bot to spawn (0,112,-4) as worst
  case (user-sanctioned on their side) — don't file CAVE teleports as
  anomalies; still not copyable for us (our no-cheat rule).
- Camp coordinate errata: their crafting table is at (12,88,56) not y=89;
  chop quarantine center (12,56) r=60 — our bots chopping within ~60 blocks
  of THEIR camp won't be stopped by their enforcer (it only kills their own
  tasks) but will look hostile; keep our harvesting clear of their camp
  radius anyway.
- "Caveman kit": referenced in their TODO DONE table as part of the alliance
  gift exchange; **no such file in the repo** — nothing to fetch.
