# FLEET/1 — open chat coordination protocol + chat-command addressing

Research + design deliverable for **TODO item 3** (bots ↔ players ↔ foreign bot crews).
Track: `chatproto`. Date: 2026-09-01. Status: **design complete, implementation-ready**.
Author: research agent (read-only; no engine code was edited).

Target consumer: a new injectable payload `chatlisten.js` (same shape as `idleguard.js` /
`graychat.js` / `panicguard.js`) plus a small number of named edits to `skills.js`,
`graychat.js` and `runner.js`, all listed in §7.

---

## 0. TL;DR for the implementer

1. **Do not use `bot.on('chat')`.** Its username is *derived from the rendered text* by a
   regex (`mineflayer/lib/plugins/chat.js`), so a `/tellraw` can forge any name — and
   CAVECREW published this server's RCON password in public chat, so *everyone* can
   tellraw. Use `bot.on('message', (msg, position, senderUuid) => …)` and resolve
   `senderUuid` against `bot.players`. That UUID is the only identity signal we have.
2. **Protocol lines must stay off the graychat/RCON relay.** `graychat.js` already
   passes `DEPOT|USING|FREE|…` through to plain `bot.chat`; that is not cosmetic, it is
   *load-bearing*: a tellraw'd line arrives at every receiver as `position:'system'`,
   `sender:null` → unauthenticated. Keep protocol on the plain path, narration on the
   gray path. Extend graychat's `PROTOCOL` regex when new verbs land (§7.2).
3. **Chat can never withdraw, never attack, never eval, never build.** The entire
   depot-drain / grief / PvP attack surface is closed by *not defining the verbs*, not by
   checking permissions at runtime. Contrast mindcraft, which ships `!attackPlayer` and
   `!takeFromChest` as first-class chat commands.
4. Five verbs already exist in the wild (`DEPOT`, `USING`, `FREE`, `LEASE-BREAK`,
   `BASE`, `CLAIM`) and a foreign crew already speaks two of them. **v1 must be
   backwards compatible with what CAVECREW emits today** — everything new is additive
   and optional.
5. The single most valuable interop fix is **namespacing chest/infra ids**: CAVECREW
   currently writes `DEPOT -14 cobblestone (chest B)` while *both* crews own a "chest B".
   §2.7 fixes this without breaking either parser.

---

## 1. Ground truth: what is actually on the wire today

Evidence gathered from `logs/*.log` (all bot processes log every `chat` event) and the
repo docs. This is not speculation — these are verbatim lines observed on the server.

### 1.1 Our fleet already emits

| Line | Source of truth | Example seen |
|---|---|---|
| `DEPOT +N item [+N item …] (chest X, note)` | `DEPOT.md` rule 2, `skills.js` `depositToChest` | `DEPOT -8 oak_log -8 birch_log (chest A, staging for house_1…)` |
| `USING <id>` / `FREE <id>` / `LEASE-BREAK <id> (stale)` | `BASE.md` §3 | `USING furnace_1` |
| `BASE +<id> at (x, y, z)` | `BASE.md` §5 step 7 | — |
| `CLAIM <x> <y> <z> r16 <label>` | `PLAYBOOK.md` line 21 | — |
| `MAILBOX …` | Kevin's furnace-mailbox workaround; already in graychat's passthrough regex | — |
| `EXCESS: 20 cobblestone` | `DEPOT.md` rule 6 (Kevin, no chest tool) | — |

### 1.2 CAVECREW (foreign Claude-bot crew) emits

Members observed: **Grog, UngaBunga, Zug, Bonk**; scoreboard team prefix `[CAVE]`;
own registry file `CIV.md`; own depot at `(11, 89, 55)`, tool chest at `(12, 90, 54)`.

```
<Grog>      DEPOT +10 raw_iron (chest A)
<Grog>      DEPOT +79 cobblestone (chest 11,89,55)
<UngaBunga> DEPOT +20 oak_log (CAVE shop)
<UngaBunga> DEPOT +1 stone_pickaxe +1 stone_axe +1 stone_shovel +72 cobblestone (chest B)
<UngaBunga> GIFT +10 oak_log +10 oak_planks for KackboonKevin, dropped by ze table. Enjoy!
<UngaBunga> TRADE POST built at 6-8,112,22. Take from other shop = leave fair pay same
            chest, ledger TRADE take X leave Y. No-touch pact lifted for these 2 chests ONLY.
<UngaBunga> Cavecrew ask: iron kickstart trade still stand? We give more log, planks,
            meat, coal for ~8 iron_ingot.
<Grog>      Felsenuboot: your bots want grey status chat too? RCON for tellraw:
            100.101.197.44:25575 pass cavecamp8231. Cavecrew share console with good neighbor.
```

**Four load-bearing facts fall out of this:**

- CAVECREW **already parses and emits our `DEPOT` grammar** — the single strongest
  argument for formalising rather than replacing it.
- They **already invented `GIFT` and a `TRADE take X leave Y` ledger idea** in prose.
  v1 should adopt their nouns, not impose new ones.
- Their chest refs collide with ours (`chest A`, `chest B` mean different physical
  chests per crew) and they mix in coordinate refs. **Namespace or nothing.**
- **The RCON password for this server is public.** Chat identity is therefore not just
  unauthenticated, it is *actively forgeable by any listener*. This is the governing
  constraint on the whole command-addressing design (§4).

### 1.3 Legacy zetbot/CAVECREW ancestor claim format (still in the logs)

```
<zetbot0> CLAIM -12 97 -10
<zetbot1> CLAIM AREA -9 102 1 r8
<zetbot3> CLAIM AREA 15 121 6 r8
```

So the wild grammar is `CLAIM [AREA] <x> <y> <z> [r<N>]`, default radius 8; our
PLAYBOOK variant appends a label. v1 accepts all three shapes (§2.8).

### 1.4 Other speakers on the bus

| Speaker | Kind | Notes |
|---|---|---|
| `Felsenuboot` | human operator (Felix/Philipp) | German + English, also emits client noise like `Set own game mode to Creative Mode]` |
| `FOREMAN` | another operator's *control channel* | gives instructions to their own crew in chat |
| `Rcon` | console `say` channel | `furnace_MISSING`, `TOOLS UPDATED: …` |
| `PebbleZoom` | third-party player, hostile-ish | "bothering the CAVECREW base" |
| `<CAVE> Grog joined the game` | **system message that `bot.on('chat')` parsed as username=`CAVE`** | proof of the spoof surface, §4.1 |

That last row is the smoking gun: our current logging already mis-attributed a *join
message* to a player named `CAVE`, because `bot.on('chat')` is a text regex.

---

## 2. Part A — the FLEET/1 protocol specification

### 2.0 Design rules (why the grammar looks like this)

1. **Human-readable first.** Every line must be intelligible to a human reading chat
   with no decoder. This is the reason we are not using JSON-in-chat.
2. **One line = one fact.** No continuations, no multi-line frames. Chat reorders and
   drops; a line must stand alone.
3. **Verb-initial, uppercase, ASCII.** A message is a protocol line **iff** it starts
   with a known verb *and* matches that verb's regex. Otherwise it is prose. This makes
   the dispatch a single `switch` on the first token.
4. **Additive-only evolution.** Unknown trailing `key=value` tokens MUST be ignored by
   receivers, never rejected. This is how `ttl=`, `eta=` etc. can be added later without
   a version break.
5. **≤140 characters.** `skills.js` `say()` truncates at 140 (`skills.js:210`); the
   server limit is 256 (`mineflayer/lib/plugins/chat.js`, `CHAT_LENGTH_LIMIT`). Every v1
   line is designed to fit 140 so it survives the existing pipeline unchanged.
6. **Parentheses are for humans.** A trailing `( … )` note is free text, never parsed
   for semantics. This already matches how `DEPOT` lines are written.
7. **Emitting is cheap, acting is expensive.** Receiving a protocol line updates
   *state*; it never starts a task. The only exceptions are explicitly listed in §2.12.

### 2.1 Shared token grammar (the regex kit)

```js
const T = {
  CREW:  '[A-Z][A-Z0-9]{1,7}',            // FEL, CAVE
  BOT:   '[A-Za-z0-9_]{1,16}',            // Minecraft name rules
  ITEM:  '[a-z][a-z0-9_]{2,39}',          // minecraft item id, namespace stripped
  ID:    '[a-z][a-z0-9_]{2,31}',          // infra id: furnace_1, depot_chest_a
  N:     '\\d{1,4}',
  INT:   '-?\\d{1,7}',
  KV:    '(?:\\s+[a-z][a-z0-9_]{0,15}=[^\\s]{1,32})*',   // trailing extension tokens
  NOTE:  '(?:\\s*\\(([^)]{0,90})\\))?',                   // human note, ignored
};
// coordinates: accept "(x, y, z)" | "x y z" | "x,y,z"
const POS = '\\(?\\s*(-?\\d{1,7})\\s*[, ]\\s*(-?\\d{1,5})\\s*[, ]\\s*(-?\\d{1,7})\\s*\\)?';
```

**Namespacing.** Any `<id>` may be written `CREW:id` (e.g. `FEL:furnace_1`,
`CAVE:chest_b`). A bare `id` means *the id in the sender's own crew namespace*. This is
100% backwards compatible: `USING furnace_1` from `BuddelBernd` resolves to
`FEL:furnace_1`, exactly as today.

**Chest refs** (`CHESTREF`), in priority order:

```
CREW:LETTER        FEL:A            canonical, unambiguous
chest LETTER       chest B          legacy — resolves to sender's crew
(x, y, z)          (11, 89, 55)     always unambiguous, always accepted
<free label>       CAVE shop        opaque; store verbatim, never resolve to a position
```

### 2.2 Verb inventory

| Class | Verb | Status | Emitter | Receiver action |
|---|---|---|---|---|
| Presence | `HELLO` | new | on spawn / on probe | upsert roster |
| Presence | `BYE` | new | on shutdown | mark offline, release its leases locally |
| Roster | `ROLE` | new | on role change | upsert roster |
| Work | `TASK` | new | task start/end | update roster activity |
| Market | `NEED` | new | driver / skill | append to wants board |
| Market | `HAVE` | new | after a deposit | append to offers board |
| Ledger | `DEPOT` | **in the wild** | after every transfer | append to ledger |
| Lease | `USING` | **in the wild** | acquire + heartbeat | lease table |
| Lease | `FREE` | **in the wild** | release | lease table |
| Lease | `LEASE-BREAK` | **in the wild** | stale break | lease table |
| Infra | `BASE` | **in the wild** | after placing infra | infra registry |
| Territory | `CLAIM` / `CLAIM-DROP` | **in the wild** | camp/claim announce | no-dig set |
| Mailbox | `MAILBOX` | in the wild (Kevin) | output left for someone | pickup board |
| Economy | `OFFER` | new | trade proposal | offer book |
| Economy | `TRADE` | new (CAVECREW prose) | accept/decline/done | offer book |
| Economy | `GIFT` | **CAVECREW's own** | unilateral give | log only |
| Control | `NAK` | new | refusal of an addressed command | log only |

**Core (MUST implement to claim FLEET/1):** `HELLO`, `DEPOT`, `USING`, `FREE`,
`LEASE-BREAK`, `BASE`, `CLAIM`.
**Extended (SHOULD):** `BYE`, `ROLE`, `TASK`, `NEED`, `HAVE`, `OFFER`, `TRADE`, `GIFT`,
`MAILBOX`, `NAK`, `CLAIM-DROP`.

### 2.3 Presence — `HELLO`, `BYE`

```
HELLO <CREW> <BOT> v<N> [role=<role>] [caps=<c1,c2,…>] [home=(x, y, z)] [note]
HELLO?                                   ← probe: "everyone announce"
BYE <BOT> <reason>
```

Examples:

```
HELLO FEL FurzFriedrich v1 role=lumberjack caps=chop,haul,craft,build home=(-3, 111, 4)
HELLO CAVE UngaBunga v1 role=builder caps=build,haul,trade home=(11, 89, 55)
BYE BuddelBernd shutdown
```

Regex:

```js
HELLO: /^HELLO\s+([A-Z][A-Z0-9]{1,7})\s+([A-Za-z0-9_]{1,16})\s+v(\d{1,2})((?:\s+[a-z_]+=[^\s]+)*)/
PROBE: /^HELLO\?\s*$/
BYE:   /^BYE\s+([A-Za-z0-9_]{1,16})\s+(\w[\w -]{0,40})/
```

Semantics and rate:

- Emit `HELLO` **once on spawn** (after the runner's existing greeting), once per
  re-injection, and in answer to `HELLO?`.
- Answering a probe MUST be jittered: `delay = rosterIndex * 1500ms + random(0..800)`.
  Four bots answering simultaneously is exactly the burst that trips server anti-spam.
- Max 1 `HELLO` per bot per 5 minutes regardless of trigger.
- A crew that never sends `HELLO` is treated as **v0**: only the six in-the-wild verbs
  are assumed understood when talking *to* it.
- `caps` vocabulary v1: `chop, mine, smelt, craft, build, haul, hunt, farm, scout,
  trade, chest, rcon`. Unknown caps are stored verbatim, never rejected.
- `role` vocabulary v1: `lumberjack, miner, hunter, farmer, builder, hauler, smith,
  scout, guard, generalist`.

### 2.4 Roster — `ROLE`

```
ROLE <BOT> <role> [note]
```
`ROLE MettMarcel farmer (taking over the wheat plot)`
```js
/^ROLE\s+([A-Za-z0-9_]{1,16})\s+([a-z_]{3,16})/
```
Only meaningful about *yourself or a bot in your own crew*. A `ROLE` line naming a bot
of another crew is stored as an opinion, never as fact.

### 2.5 Work — `TASK`

The machine-readable twin of our English narration. Maps 1:1 onto the `__skills` task
lifecycle, so emission is nearly free.

```
TASK <BOT> <start|done|fail|stop> <skill> [k=v …] [note]
```

```
TASK BuddelBernd start mineLane target=iron_ore count=12 eta=300
TASK BuddelBernd done mineLane got=12 t=284
TASK BuddelBernd fail mineLane err=no_tool
TASK PflasterPeter start buildWall at=-8,110,10 w=6 h=3 mat=cobblestone
```

```js
/^TASK\s+([A-Za-z0-9_]{1,16})\s+(start|done|fail|stop)\s+([A-Za-z][A-Za-z0-9]{1,23})((?:\s+[a-z]+=[^\s]+)*)/
```

Rate: **at most one `TASK` line per task transition**, and suppressed entirely for
`quiet` tasks (the onEmpty fallback). Do *not* emit `TASK` for queue advances of the
same skill within 30 s — the queue can advance 8 jobs in seconds (see the v6 chat-flood
quirk in `LEARNING_HANDOFF.md`).

### 2.6 Market — `NEED`, `HAVE`

The want-ad board. This is what makes a *mixed* fleet economically useful rather than
just polite.

```
NEED <BOT> <N> <item> [for <purpose>] [by <N>m]
HAVE <BOT> <N> <item> [at <CHESTREF>]
```

```
NEED MettMarcel 8 wheat_seeds for farm_1 by 30m
HAVE FurzFriedrich 58 oak_log at FEL:A
```

```js
NEED: /^NEED\s+([A-Za-z0-9_]{1,16})\s+(\d{1,4})\s+([a-z][a-z0-9_]{2,39})(?:\s+for\s+([\w_ -]{1,24}))?(?:\s+by\s+(\d{1,3})m)?/
HAVE: /^HAVE\s+([A-Za-z0-9_]{1,16})\s+(\d{1,4})\s+([a-z][a-z0-9_]{2,39})(?:\s+at\s+(.{1,24}))?/
```

Receiver behaviour: append to a bounded board (last 32 entries, entries expire after
30 min). **A `NEED` never auto-starts work.** It is read by the driver/orchestrator when
choosing the next job, and by `chatlisten` only to answer a `status`/`needs` query.

### 2.7 Ledger — `DEPOT` (formalised, backwards compatible)

```
DEPOT <±N item> [<±N item> …] (<CHESTREF>[, <note>])
```

```
DEPOT +8 oak_log (FEL:A)                              ← canonical v1
DEPOT +41 iron_ingot (FEL:B, from furnace_1 mailbox)
DEPOT -14 cobblestone (chest B)                       ← legacy, = sender's crew chest B
DEPOT +79 cobblestone (11, 89, 55)                    ← coordinate ref, always valid
```

```js
const DEPOT_LINE  = /^DEPOT((?:\s*[+-]\d{1,4}\s+[a-z][a-z0-9_]{2,39})+)\s*(?:\(([^)]{0,90})\))?\s*$/;
const DEPOT_DELTA = /([+-])(\d{1,4})\s+([a-z][a-z0-9_]{2,39})/g;
```

Rules:

1. At least one delta; each delta is signed. `+` = deposited into the chest, `-` =
   withdrawn from it. (This is the existing convention — confirmed by `DEPOT.md` rule 2
   and by CAVECREW's usage.)
2. The chest ref SHOULD be present. When absent, the line is advisory only.
3. **A bare `chest X` resolves to the *sender's* crew namespace.** This single sentence
   fixes the live `chest A`/`chest B` collision without either side changing code.
4. Emit **after** the transfer completes and is verified, never before.
5. Physical chest contents always override the ledger (`DEPOT.md`); the ledger is a
   hint, not a database.

### 2.8 Leases, infra, territory

```
USING <ID> [ttl=<N>]              USING FEL:furnace_1 ttl=12
FREE <ID>                         FREE furnace_1
LEASE-BREAK <ID> (<reason>)       LEASE-BREAK furnace_2 (stale)
BASE +<ID> at (x, y, z) [<type>]  BASE +pond_1 at (1, 110, 10) pond_2x2
BASE -<ID> (<reason>)             BASE -depot_chest_a (destroyed, rebuilding)
BASE ?<ID>                        BASE ?furnace_2            ← query
CLAIM [AREA] <x> <y> <z> [r<N>] [<label>]
CLAIM-DROP <x> <y> <z>
MAILBOX <ID> <±N item> … for <BOT|CREW> [note]
```

```js
USING: /^USING\s+((?:[A-Z][A-Z0-9]{1,7}:)?[a-z][a-z0-9_]{2,31})((?:\s+[a-z]+=[^\s]+)*)/
FREE:  /^FREE\s+((?:[A-Z][A-Z0-9]{1,7}:)?[a-z][a-z0-9_]{2,31})\s*$/
BREAK: /^LEASE-BREAK\s+((?:[A-Z][A-Z0-9]{1,7}:)?[a-z][a-z0-9_]{2,31})\s*(?:\(([^)]{0,60})\))?/
BASE:  /^BASE\s+([+\-?])([a-z][a-z0-9_]{2,31})(?:\s+at\s+\(?\s*(-?\d+)[ ,]+(-?\d+)[ ,]+(-?\d+)\s*\)?)?(?:\s+([a-z0-9_]{2,20}))?/
CLAIM: /^CLAIM\s+(?:AREA\s+)?(-?\d{1,7})\s+(-?\d{1,5})\s+(-?\d{1,7})(?:\s+r(\d{1,3}))?(?:\s+([\w-]{1,24}))?/
DROP:  /^CLAIM-DROP\s+(-?\d{1,7})\s+(-?\d{1,5})\s+(-?\d{1,7})/
MAIL:  /^MAILBOX\s+((?:[A-Z][A-Z0-9]{1,7}:)?[a-z][a-z0-9_]{2,31})((?:\s*[+-]\d{1,4}\s+[a-z][a-z0-9_]{2,39})+)\s+for\s+([A-Za-z0-9_]{1,16})/
```

Notes:

- `ttl=<minutes>` is the **only semantic addition** to the lease verbs: it lets a foreign
  crew compute staleness without knowing our 5-minute convention. Absent ⇒ assume 5.
  `BASE.md` §3's furnace safeguard (open it before breaking a lease; non-empty slots mean
  the lease is *not* stale) stays in force and MUST be stated to any interop partner.
- `CLAIM` default radius when `r` is absent: **8** (the zetbot legacy default seen in
  the logs). Our own emissions always state `r` explicitly.
- Receiving a foreign `CLAIM` **does** have an effect: it goes into the no-dig set
  (§2.12). This is the one inbound line that changes bot behaviour, and it only ever
  *reduces* what we are willing to do.

### 2.9 Economy — `OFFER`, `TRADE`, `GIFT`

Adopts CAVECREW's own nouns (`TRADE`, `GIFT`, their two-chest swap shop at
`6-8,112,22`) and adds the one thing their prose version lacks: a **correlation id**, so
an offer and its acceptance can be matched by machine across dozens of chat lines.

```
OFFER <offer-id> <give-list> for <want-list> [at <CHESTREF|(x, y, z)>] [expires <N>m]
TRADE <accept|decline|done|cancel> <offer-id> [note]
GIFT <+N item> … for <BOT|CREW> [at <CHESTREF|(x, y, z)>] [note]
```

`<give-list>` / `<want-list>` = `N item [+ N item …]`

```
OFFER cave-iron-1 10 oak_log + 10 oak_planks for 8 iron_ingot at (7, 112, 22) expires 60m
TRADE accept cave-iron-1 (Friedrich brings the ingots within 20 minutes)
TRADE done cave-iron-1
GIFT +10 oak_log +10 oak_planks for KackboonKevin at (-3, 111, 4)
```

```js
OFFER: /^OFFER\s+([a-z0-9][a-z0-9-]{2,23})\s+(.+?)\s+for\s+(.+?)(?:\s+at\s+(\S{1,24}|\([^)]*\)))?(?:\s+expires\s+(\d{1,4})m)?\s*$/
TRADE: /^TRADE\s+(accept|decline|done|cancel)\s+([a-z0-9][a-z0-9-]{2,23})/
GIFT:  /^GIFT((?:\s*\+\d{1,4}\s+[a-z][a-z0-9_]{2,39})+)\s+for\s+([A-Za-z0-9_]{1,16})/
ITEMS: /(\d{1,4})\s+([a-z][a-z0-9_]{2,39})/g     // applied to give/want lists
```

Offer-id convention: `<crew-lowercase>-<slug>-<n>`, unique per crew, echoed **verbatim**
by the counterparty. An offer with an unknown id is answered `TRADE decline <id>`, never
silently ignored.

**Safety:** an inbound `OFFER`/`TRADE accept` NEVER moves items on its own. It is
recorded, and a human/driver decides. Trading is the classic social-engineering vector
("leave 8 iron in chest B and I'll leave wood, promise") and must stay operator-gated —
see invariant S6 in §4.4.

### 2.10 Refusal — `NAK`

```
NAK <requester> <code> [note]
```
`NAK PebbleZoom not_allowed` · `NAK Grog rate_limited (try again in a minute)`

Codes: `unknown_cmd, not_allowed, rate_limited, busy, bad_args, unsafe, needs_operator,
no_engine`.

Rate: **at most one `NAK` per sender per 5 minutes.** After that, silence. A NAK that
answers every message is a spam amplifier and a griefing tool (§4.5).

### 2.11 Receiver state model

`chatlisten` maintains a bounded, in-memory view. Nothing here is persisted (an
injection payload cannot `require('fs')` — the `/eval` sandbox exposes only
`bot, mineflayer, pathfinder, goals, Vec3` plus globals like `fetch`).

```js
globalThis.__fleet = {
  v: 1, crew: 'FEL', me: bot.username, enabled: true,
  roster:  {},   // name -> {crew, role, caps[], home, v, lastSeen, lastTask}
  ledger:  [],   // last 64  {t, from, crew, deltas:[{sign,n,item}], chest}
  leases:  {},   // 'FEL:furnace_1' -> {holder, since, ttlM, state:'held'|'free'}
  infra:   {},   // 'CAVE:chest_b' -> {pos, type, by, t}
  claims:  [],   // last 32  {x,y,z,r,label,by,t}
  offers:  {},   // id -> {from, give[], want[], at, expiresAt, state}
  needs:   [],   // last 32  {by,n,item,purpose,byMin,t}
  mail:    [],   // last 16  MAILBOX entries addressed to us
  audit:   [],   // last 64  every chat-sourced command decision
  stats:   { msgs:0, proto:0, cmds:0, denied:0, replies:0, dropped:0 },
};
```

Bounds are hard: every array is a ring buffer. A chatty server must never grow the
payload's memory.

### 2.12 The only inbound lines that change behaviour

Everything else is state-only. These three are the exceptions, and each one only ever
*restricts* us:

1. **`CLAIM` / `CLAIM-DROP` from any authenticated sender** → update the no-dig sphere
   set. Enforced by feeding `Movements.exclusionAreasBreak/Place` (as
   `PLAYBOOK.md` line 13 already specifies) — inside a claim, return a prohibitive cost.
2. **`USING <id>` on an id we were about to lease** → back off, pick another instance
   (this is `BASE.md` §3 rule 1, currently a *manual driver* check; automating it closes
   the lease-collision hole flagged in `LEARNING_HANDOFF.md`).
3. **`BASE +<id> at (x,y,z)` from a foreign crew** → add the coordinate to the
   protected-column set that `digguard.js` consults (which is currently hardcoded — see
   TODO item 5).

---

## 3. Part B — command addressing from chat

### 3.1 Addressing grammar

```
<target><sep> <command> [args…]
```

- `<target>`: an exact bot name (case-insensitive), `@Name`, a crew tag (`FEL`, `fel`),
  a role name (`miners`, `builders` — plural or singular), or `all` / `@all` /
  `everyone`.
- `<sep>`: `:` or `,`.
- Must be at the **start** of the message body (after any rendered `<Name>` wrapper is
  stripped).

```js
const ADDR = /^\s*@?([A-Za-z0-9_]{1,16})\s*[:,]\s*(.{1,180})$/;
```

Resolution:

```js
function addressedToMe(target) {
  const t = target.toLowerCase();
  if (t === bot.username.toLowerCase()) return 'direct';
  if (t === 'all' || t === 'everyone') return 'broadcast';
  if (t === F.crew.toLowerCase()) return 'crew';
  if (t === F.role || t === F.role + 's') return 'role';
  return null;                              // addressed to someone else → ignore entirely
}
```

**Ignoring is the default.** `<FurzFriedrich> Marcel, movin out now - headin to
-3,105,-90` (a real line from the logs) parses as `target=Marcel`,
`body='movin out now…'` — not our name, so it is dropped before any verb lookup. Even
if it *were* addressed to us, `movin` is not a verb, and unknown verbs are silently
ignored (§4.5).

### 3.2 The command surface

Deliberately small. Each row lists the **maximum sender tier** allowed (lower number =
more trusted; see §4.2) and the hard clamps applied to arguments.

| Chat command | Kind | Max tier | Maps to | Clamps / guards |
|---|---|---|---|---|
| `status` | query | 3 | one-line reply | — |
| `where` \| `pos` | query | 3 | one-line reply | — |
| `help` \| `commands` | query | 3 | verb list reply | — |
| `who` \| `roles` | query | 3 | emit `HELLO` (jittered) | 1 / 5 min |
| `needs` | query | 3 | reply with top 3 `NEED` entries | — |
| `stop` | act | 3 | `__skills.stop('chat:<who>')` | **always honoured, never rate-limited** |
| `inv` \| `inventory` | query | 2 | top 6 stacks reply | — |
| `come` | task | 2 | `come {pos: senderPos}` | ≤64 blocks; refuse if target inside a foreign claim; refuse if sender not visible in `bot.players` |
| `collect [r]` | task | 1 | `collectDrops {radius}` | r ∈ [4, 32], default 16 |
| `deposit` | task | 1 | `depositToChest {}` | own-crew chest only |
| `chop <N> [species]` | task | 1 | `chopTrees {count, types}` | N ∈ [1, 8]; leaf-canopy guard (TODO 4) |
| `mine <N> <block>` | task | 1 | `mineLane {target, count}` | N ∈ [1, 32]; block must exist in `registry.blocksByName` |
| `hunt <N> <species>` | task | 1 | `huntAnimals {species, count}` | N ∈ [1, 8]; `anyMob` forced false; **players never targetable** |
| `goto <x> <y> <z>` | task | 1 | `come {pos}` | ≤128 blocks from home; y ∈ [-60, 200] |
| `follow <name>` | task | 0 | runner `/follow` | operator only, `stop` cancels |

**Never exposed to chat at any tier** — the whole point of the design:

`eval`, `attack`, `kill`, `pvp`, `withdraw`, `take`, `give`, `drop`, `toss`,
`safeDescend`, `buildWall`, `buildFloor`, `frameStructure`, `buildStaircase`,
`buildSchematic`, `openContainer` on a chest we do not own, `craft`, `op`, `tp`,
anything that writes a file, and anything that starts with `/`.

Rationale for the omissions, one line each:

- *No `withdraw`/`take`* → the depot cannot be drained by chat, full stop. Deposits are
  allowed because they can only ever *add* to the commons.
- *No `attack`* → invariant S1. mindcraft ships `!attackPlayer`; we deliberately do not.
- *No builds* → a build command is a 40-block irreversible world edit with a materials
  bill; it belongs in a driver's plan, not in a stranger's sentence.
- *No `craft`* → the crafting-void quirks (`LEARNING_HANDOFF.md`) make crafting a
  supervised operation.
- *No `follow` below tier 0* → following an unknown player into lava / a mob pit is the
  classic griefer play against bots.

### 3.3 Argument parsing

Tokenise on whitespace; commands take positional args only, all validated and clamped.
Adopt mindcraft's type-validation discipline (`src/agent/commands/index.js`) — numeric
domain intervals, `BlockName`/`ItemName` verified against the registry — but with our
own tighter ranges.

```js
const int = (s, lo, hi, d) => { const n = parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

const blockName = (s) => (s && bot.registry.blocksByName[s]) ? s : null;

// "chop 10 birch"  -> {name:'chopTrees', args:{count:8, types:['birch']}}
// (10 clamps to 8) 
```

Species aliases (`birch` → `birch`, `cow`/`cows` → `cow`) live in a small synonym map so
humans can type naturally. A word that is not a known species/block yields
`NAK <who> bad_args` (once) rather than a guess.

### 3.4 Reply discipline

- Query replies are conversational and in character (house rule: English, in-character
  narration) and go through the **normal `bot.chat`** path so `graychat` renders them
  gray, matching the fleet's voice.
- One reply per sender per 30 s, hard.
- **Never reply to a reply.** If the inbound message came from a name in our own roster
  and is not a protocol line, it is prose between bots and gets no answer. This is the
  loop breaker; without it two LLM bots will chat until the server dies (mindcraft
  solves the same problem with `convoManager`'s exclusivity + `ignore_until_start`).
- Never echo the sender's text back (a tellraw-forged line could otherwise be laundered
  into a real bot's mouth).

### 3.5 Broadcast fan-out

`all: <query>` → every fleet bot answers, staggered deterministically:

```js
const delay = rosterIndex(bot.username) * 1500 + (hash(bot.username) % 600);
```

`all: stop` → every bot acts immediately; only `rosterIndex === 0` confirms in chat
("Fleet stopping."). Four simultaneous confirmations are pure spam and risk the vanilla
anti-spam kick.

---

## 4. Part B (cont.) — trust, rate limiting, safety

### 4.1 Threat model: chat identity is forgeable

Three independent facts, all verified:

1. **`bot.on('chat')` derives the username from rendered text.** In
   `node_modules/mineflayer/lib/plugins/chat.js` the default pattern is
   `LEGACY_VANILLA_CHAT_REGEX = ^(?:\(.{1,15}\)|\[.{1,15}\]|.){0,5}?(\w+)\s?[>:\-»\]\)~]+\s(.*)$`
   registered as a *deprecated* pattern on the `messagestr` stream. It fires on **system
   messages too** — which is why our own logs contain
   `<chat> <CAVE> Grog joined the game`. Any `/tellraw` of the shape `<[FEL] BuddelBernd> …`
   is indistinguishable from real chat to that listener.
2. **`/tellraw` is available to anyone here.** Grog broadcast this server's RCON endpoint
   and password in public chat (`100.101.197.44:25575 pass cavecamp8231`). Also,
   `graybridge.js` itself listens on `127.0.0.1:3199` and will tellraw any
   `{name,color,text}` posted to it — from *any* local process.
3. Minecraft Console Client's documentation reaches the same conclusion independently:
   its `RemoteControl` bot warns *"Server admins can spoof PMs (`/tellraw`, `/nick`) so
   enable RemoteControl only if you trust server admins."*

**Consequence — the identity rule:**

```js
bot.on('message', (jsonMsg, position, senderUuid /*, verified */) => {
  const authenticated = position === 'chat' && !!senderUuid;
  const name = authenticated ? uuidToName(senderUuid) : null;
  // name === null  =>  tier 4  =>  NO command is ever executed. Log only.
});
```

`position` and `senderUuid` come straight from the packet demux in
`mineflayer/lib/plugins/chat.js`: `playerChat` emits
`bot.emit('message', msg, 'chat', data.sender, verified)`, `systemChat` emits
`bot.emit('message', msg, 'system'|'game_info', null)`. In offline mode `verified` is
always false — **do not require it** — but the UUID is still server-asserted rather than
text-derived, which is the whole difference.

```js
function uuidToName(uuid) {
  for (const p of Object.values(bot.players || {})) if (p && p.uuid === uuid) return p.username;
  return null;               // not in the tab list -> treat as unauthenticated
}
```

### 4.2 Allowlist tiers

| Tier | Who | How determined | May issue |
|---|---|---|---|
| **0 OPERATOR** | the human owner(s) | configured name list, e.g. `['Felsenuboot']` | everything in the surface table |
| **1 FLEET** | our own bots | name ∈ roster file *and* crew tag `FEL` | protocol + work commands |
| **2 ALLIED** | crews we have HELLO'd with and the user approved | configured allies list, e.g. CAVECREW `['Grog','UngaBunga','Zug','Bonk']` | queries, `stop`, `come`, trade lines |
| **3 PLAYER** | any other authenticated player in `bot.players` | authenticated but unlisted | queries + `stop` only |
| **4 UNVERIFIED** | system/tellraw/console/RCON, unknown UUID, `sender === null` | fallback | **nothing** — log only |

Notes:

- **`stop` is available down to tier 3 on purpose.** Refusing to stop is never the safer
  choice; a stop can only reduce activity. It is also the only command that bypasses
  rate limiting.
- **Tier 4 includes `Rcon` and `FOREMAN`** and every gray tellraw line — including our
  *own* graychat narration echoing back. That is correct and desirable.
- Allied status is **user-granted, not self-asserted.** A `HELLO CAVE …` line puts a bot
  in the roster as *seen*, at tier 3. Promotion to tier 2 happens only via the config
  list. Otherwise anyone can self-promote by typing `HELLO FEL BuddelBernd v1`.
- Tier is resolved from the **UUID-derived name**, never from the `<Name>` in text.

### 4.3 Rate limiting

Three independent layers. Rate checks run **before** any parsing side effect.

**(a) Inbound per-sender token bucket**

| Tier | Refill | Burst | Hard hourly cap |
|---|---|---|---|
| 0 operator | 1 / 2 s | 5 | 300 |
| 1 fleet | 1 / 5 s | 4 | 120 |
| 2 allied | 1 / 30 s | 2 | 40 |
| 3 player | 1 / 60 s | 1 | 15 |

```js
function allow(name, tier) {
  const c = LIMITS[tier], now = Date.now();
  const b = F.buckets[name] || (F.buckets[name] = { tok: c.burst, at: now, hour: 0, hAt: now });
  if (now - b.hAt > 3600e3) { b.hour = 0; b.hAt = now; }
  b.tok = Math.min(c.burst, b.tok + (now - b.at) / c.refillMs); b.at = now;
  if (b.tok < 1 || b.hour >= c.cap) return false;
  b.tok -= 1; b.hour += 1; return true;
}
```

**(b) Global task-start ceiling**: at most **6 chat-sourced task starts per 10 minutes**
per bot, and at most **1 chat task in flight**. If a driver's task is already running:
tier ≤ 1 → `__skills.enqueue` (max 2 chat-queued items); tier ≥ 2 → `NAK … busy`.
Chat must never preempt a driver.

**(c) Outbound**: reuse the engine's discipline — ≥1.3 s spacing, drop anything
scheduled >12 s out (`skills.js:208-216`). Additionally: 1 reply per sender per 30 s,
1 `NAK` per sender per 5 min, and a duplicate filter keyed on
`sender + '|' + body.toLowerCase().replace(/\s+/g,' ')` over a 60 s window.

**Why these numbers:** vanilla kicks clients that chat too fast with `disconnect.spam`
(a real, frequently-hit kick — see the ViaVersion issue tracker and MC-112602). The
community-safe sustained rate is ≈1 message/second with a small burst allowance; our
existing 1.3 s `say()` throttle already sits inside that, and the fan-out staggering in
§3.5 exists so four bots answering one broadcast do not collectively breach it.

### 4.4 Hard safety invariants

Engine-enforced, non-overridable, not conditional on tier. These are the paragraphs to
paste into the driver guide verbatim.

- **S1 — Never attack a player.** No chat verb maps to combat against `entity.type ===
  'player'`. `huntAnimals` already refuses players (`skills.js`); chat never sets
  `anyMob:true`.
- **S2 — Never grief.** No chat-sourced dig/place inside a registered `CLAIM` sphere,
  within the protected-column set (`digguard.js` / `BASE.md` rows), or on
  player-placed blocks. `chopTrees` obeys the leaf-canopy rule (TODO 4).
- **S3 — Never drain the depot.** No withdraw verb exists. `deposit` only.
- **S4 — Never touch foreign property.** No chat command opens a container that is not
  in our own crew's registry.
- **S5 — Never execute chat as code.** No path from a chat string to `/eval`,
  `new Function`, `bot.chat('/…')`, or a shell. Any inbound body starting with `/` is
  dropped before parsing.
- **S6 — Never move goods on a trade line.** `OFFER`/`TRADE`/`GIFT` update the offer
  book; a human or driver executes.
- **S7 — No transitive authority.** A command received in chat is never re-broadcast to
  another bot. Bot A cannot make bot B do anything by chat. (Kills the amplification
  loop and the "compromise one bot, own the fleet" path.)
- **S8 — Everything is bounded.** Counts ≤32, radius ≤64, distance-from-home ≤128,
  one chat task at a time, every task inherits the engine's watchdog cap.
- **S9 — `stop` always wins**, from any authenticated sender, unthrottled.
- **S10 — Never follow or approach an unknown player on request.** `come` is tier ≤2 and
  distance-capped; `follow` is operator-only.
- **S11 — Audit everything.** Every chat-sourced decision (accepted or denied) appends
  `{t, from, tier, raw, verdict}` to `__fleet.audit` and a `console.log('[fleetchat] …')`
  line, which lands in `logs/<bot>.log` via the runner's stdout redirect.
- **S12 — Unknown senders get read-only responses** (TODO item 3's own wording): queries
  and `stop`, nothing else, and at most one line per minute.

### 4.5 Anti-abuse behaviours

| Attack | Defence |
|---|---|
| tellraw-forged `<[FEL] Bernd> all: stop` | tier 4 → ignored; `position === 'system'` |
| a player named `A11` typing `all: mine 32 diamond_ore` | tier 3 → `mine` requires tier ≤1 → one `NAK`, then silence |
| command flood | token bucket + hourly cap + global 6/10min task ceiling |
| NAK-storm amplification | 1 NAK per sender per 5 min; unknown verbs are silent, not NAK'd |
| bot-to-bot infinite politeness loop | never reply to prose from a roster name; never reply to a reply |
| self-echo (our own gray tellraw returning) | drop if derived name === `bot.username`; drop `position !== 'chat'`; ring buffer of our last 20 outbound strings |
| server noise parsed as commands | mindcraft's `ignore_messages` list verbatim (`"Set own game mode to"`, `"Set the time to"`, `"Set the difficulty to"`, `"Teleported "`, `"Set the weather to"`, `"Gamerule "`) plus join/leave/death/advancement patterns. Our logs show `Felsenuboot: Set own game mode to Creative Mode]` arriving as chat — this is a live problem, not a hypothetical. |
| lease squatting by a foreign crew | `ttl=` + the `BASE.md` furnace safeguard; escalate to the operator rather than stale-breaking a non-empty furnace |
| social-engineered trade | S6 — offers are recorded, never executed |

---

## 5. Part C — `chatlisten.js`: implementation specification

### 5.1 Contract (matches the existing payload family)

- A **body of a `POST /eval` call**, injected exactly like `idleguard.js` /
  `graychat.js`. In scope: `bot, mineflayer, pathfinder, goals, Vec3`; globals include
  `fetch` but **not** `require` (graychat relies on this).
- Idempotent: `if (globalThis.__fleet && __fleet.restore) __fleet.restore();` at the top,
  removing listeners and clearing timers before re-installing.
- Installs `globalThis.__fleet` (state per §2.11) and returns
  `{ installed: true, version: 1, crew, role, tiers: {...} }`.
- Never stores a long-lived `bot` reference outside a handler — `runner.js` swaps the bot
  object on reconnect. Re-bind on `spawn`. (Same invariant as `skills.js`.)
- Dies on process restart like every other payload → **must be added to `./inject.sh`**
  and to the auto-inject-on-spawn work already queued as TODO 5 / FEEDBACK.md.

### 5.2 Skeleton

```js
// chatlisten.js — FLEET/1 chat protocol + command addressing. Inject via POST /eval.
// Templated per bot: __CREW__, __ROLE__, __OPERATORS__, __ALLIES__, __ROSTER__, __HOME__
if (globalThis.__fleet && globalThis.__fleet.restore) { try { globalThis.__fleet.restore(); } catch (e) {} }

const F = {
  v: 1, enabled: true, crew: "__CREW__", role: "__ROLE__", me: bot.username,
  operators: __OPERATORS__,            // ["Felsenuboot"]
  allies:    __ALLIES__,               // {"Grog":"CAVE","UngaBunga":"CAVE","Zug":"CAVE","Bonk":"CAVE"}
  fleet:     __ROSTER__,               // ["FurzFriedrich","MettMarcel","BuddelBernd","PflasterPeter"]
  home: __HOME__,                      // {x:-3,y:111,z:4}
  roster:{}, ledger:[], leases:{}, infra:{}, claims:[], offers:{}, needs:[], mail:[],
  audit:[], buckets:{}, seen:{}, recentOut:[], _chatAt: 0, _replyAt: {}, _nakAt: {},
  _taskStarts: [], stats:{ msgs:0, proto:0, cmds:0, denied:0, replies:0, dropped:0 },
};
globalThis.__fleet = F;

const ring = (arr, item, max) => { arr.push(item); if (arr.length > max) arr.shift(); };
const log  = (m) => { try { console.log('[fleetchat] ' + m); } catch (e) {} };

// ---- outbound: share the engine's throttle so the two never collide ----
function say(msg) {
  const S = globalThis.__skills, now = Date.now();
  const base = Math.max(F._chatAt, (S && S._chatAt) || 0);
  const at = Math.max(now, base + 1400);
  if (at - now > 10000) { F.stats.dropped++; log('drop (backlog): ' + msg.slice(0, 60)); return; }
  F._chatAt = at; if (S) S._chatAt = at;
  ring(F.recentOut, String(msg).slice(0, 60), 20);
  setTimeout(() => { try { bot.chat(String(msg).slice(0, 200)); } catch (e) {} }, at - now);
}

// ---- identity ----
function uuidToName(uuid) {
  if (!uuid) return null;
  for (const p of Object.values(bot.players || {})) if (p && p.uuid === uuid) return p.username;
  return null;
}
function tierOf(name, crewHint) {
  if (!name) return 4;
  if (F.operators.includes(name)) return 0;
  if (F.fleet.includes(name)) return 1;
  if (F.allies[name]) return 2;
  return 3;
}

// ---- the ONE listener ----
const onMessage = (jsonMsg, position, senderUuid) => {
  if (!F.enabled) return;
  F.stats.msgs++;
  let text; try { text = jsonMsg.toString(); } catch (e) { return; }
  const from = (position === 'chat') ? uuidToName(senderUuid) : null;
  if (from === bot.username) return;                       // self
  if (!from) { handleUnauthenticated(text); return; }      // tier 4: log only
  const body = stripWrapper(text, from);
  if (!body || body.startsWith('/')) return;               // S5
  if (isServerNoise(body)) return;
  if (dedupe(from, body)) return;
  if (parseProtocol(from, body)) { F.stats.proto++; return; }
  const m = body.match(ADDR);
  if (!m) return;
  const how = addressedToMe(m[1]);
  if (!how) return;
  handleCommand(from, tierOf(from), how, m[2].trim(), body);
};
bot.on('message', onMessage);
bot.on('spawn', onSpawn);                                  // re-HELLO after reconnect

F.restore = () => {
  F.enabled = false;
  try { bot.removeListener('message', onMessage); } catch (e) {}
  try { bot.removeListener('spawn', onSpawn); } catch (e) {}
  (F._timers || []).forEach((t) => clearTimeout(t));
};
return { installed: true, version: 1, crew: F.crew, role: F.role, me: F.me };
```

`stripWrapper(text, from)` removes a rendered chat prefix when the server delivers one
(`<Name> body`, `[FEL] Name: body`, `Name whispers: body`) and returns the bare body. It
must never *derive* identity — `from` is already fixed by the UUID.

### 5.3 Dispatch into the engine

```js
function startTask(from, tier, name, args, note) {
  const S = globalThis.__skills;
  if (!S) return nak(from, 'no_engine');
  // global ceiling: 6 chat task starts / 10 min
  const now = Date.now();
  F._taskStarts = F._taskStarts.filter((t) => now - t < 600000);
  if (F._taskStarts.length >= 6) return nak(from, 'rate_limited');

  // never preempt a driver
  if (S.currentTask && S.currentTask.running) {
    if (tier > 1) return nak(from, 'busy');
    const q = S.enqueue(bot, [{ name, args }]);
    if (q && q.ok) { F._taskStarts.push(now); say(`Queued ${name} for ${from}.`); }
    return q;
  }
  try { if (globalThis.__idleguard) globalThis.__idleguard.pause(90000); } catch (e) {}
  const r = S.start(bot, name, args);
  if (r && r.ok) {
    F._taskStarts.push(now);
    say(`Aye ${from} — ${note || name}.`);
    say(`TASK ${bot.username} start ${name} ${kv(args)}`);      // protocol twin
  } else {
    nak(from, (r && r.error && r.error.code) || 'bad_args');
  }
  ring(F.audit, { t: now, from, tier, raw: name + ' ' + JSON.stringify(args), verdict: r && r.ok ? 'ok' : 'fail' }, 64);
  return r;
}
```

Notes for the implementer:

- `__skills.start(bot, name, args)` and `__skills.enqueue(bot, items, opts)` are the two
  entry points (`skills.js:759`, `skills.js:1041`); both validate args via each skill's
  `validate()` and return `{ok:false, error:{code,…}}` on rejection — reuse those codes
  directly in the `NAK`.
- `__idleguard.pause()` does **not** protect against the stall-buster (known bug,
  `FEEDBACK.md`); for a chat-started long travel prefer `__idleguard.stop()` and
  re-inject after, until that is fixed.
- `stop` calls `__skills.stop('chat:' + from)` — note the correct signature is
  `stop(reason, opts)`. (**Incidental finding:** `panicguard.js:17` calls
  `__skills.stop(bot, "panic-retreat")`, passing the bot object as the *reason*. Harmless
  today but wrong; worth a `FEEDBACK.md` entry from someone with write access.)

### 5.4 Emission points (where the engine should speak protocol)

| Line | Emit from | Trigger |
|---|---|---|
| `HELLO` | `chatlisten` | `spawn` (jittered 2–6 s after the runner greeting), on `HELLO?`, on re-inject |
| `BYE` | `runner.js` | `SIGTERM` / `stop.sh`, best-effort before quit |
| `TASK start/done/fail` | `skills.js` `S.start` + the `finally` block | non-`quiet` tasks only; suppress repeats within 30 s |
| `DEPOT ±N` | `skills.js` `depositToChest` | already implemented (`skills.js:1974`) — add the `FEL:` namespace |
| `USING/FREE` | driver or a future `leaseAcquire` skill | today it is manual; automating it closes the lease-collision hole |
| `BASE +id` | driver after placing infra | per `BASE.md` §5 step 7 |
| `NEED` | driver, or a skill hitting `no_torches` / `no_tool` | e.g. `no_torches` → `NEED <me> 16 torch for mining` |
| `HAVE` | after `depositToChest` when the deposit exceeds ~32 of an item | the supply half of the market |

### 5.5 Test plan (live verification — nothing counts until it runs on the server)

1. **Spoof rejection.** From the local box, `curl -X POST 127.0.0.1:3199/say -d
   '{"name":"BuddelBernd","color":"white","text":"all: stop"}'` → every bot must log
   `tier 4, ignored` and no task may stop. *(This is the single most important test.)*
2. **Real command.** As the operator in-game: `FurzFriedrich: chop 2 oak` → one gray
   in-character ack, a `TASK … start chopTrees` line, task runs, drops collected.
3. **Tier denial.** From an unlisted player: `MettMarcel: mine 32 diamond_ore` → exactly
   one `NAK <name> not_allowed`, no task, and a second identical message within 5 min
   produces **no** line at all.
4. **Broadcast.** `all: status` → four staggered replies ≥1.5 s apart, none dropped.
5. **Stop from a stranger.** `PflasterPeter: stop` from an unlisted player → task stops.
6. **Loop safety.** Have two fleet bots exchange prose for 60 s → zero replies generated.
7. **Ledger interop.** Ask CAVECREW to emit `DEPOT +5 coal (CAVE:A)`; verify it lands in
   `__fleet.ledger` with `crew:'CAVE'`, and that a legacy `DEPOT -3 coal (chest B)` from
   Grog resolves to `CAVE:B`, **not** our chest B.
8. **Rate limit.** 10 commands in 10 s from an allied bot → 2 executed, 1 NAK, rest
   silent, bot not kicked for spam.
9. **Reconnect.** `bot.quit()` → after auto-reconnect the listener still works and a
   fresh `HELLO` is emitted exactly once.

---

## 6. Part D — prior art, and what to steal

### 6.1 mindcraft (MIT, mineflayer-based, the closest relative)

- **Command grammar**: `!verb(arg1, arg2)` with a single detection regex
  `/!(\w+)(?:\(((?:-?\d+(?:\.\d+)?|true|false|"[^"]*")(?:\s*,\s*…)*)\))?/` and strict
  per-parameter type validation with numeric domain intervals and registry-checked
  `BlockName`/`ItemName` types.
  **Steal:** the validation discipline and the typed-argument idea.
  **Reject:** the `!verb(…)` syntax itself — it is unreadable to a human skimming chat
  and unwritable by a caveman-roleplay bot. Our `Name: verb args` form is the
  human-first alternative.
- **Unblockable commands**: `['!stop','!stats','!inventory','!goal']` can never be
  blacklisted. **Steal:** the concept — our equivalents are `stop`, `status`, `help`.
- **Conversation manager**: only pairwise dialogues at a time, `in_queue` batching,
  `ignore_until_start`, exclusivity ("if in a conversation with someone else, reject and
  end"), 10 s partner-disconnect timeout, escalating wait (30 s, doubling), and
  `promptShouldRespondToBot()` when busy.
  **Steal:** the anti-loop stance. **Reject:** LLM-in-the-loop response arbitration — we
  do not want to pay a token for every inbound chat line (`minecraft-token-efficiency`).
- **Chat listener filters**: `if (username === this.name) return;`,
  `only_chat_with` allowlist, and the `ignore_messages` prefix list
  (`"Set own game mode to"`, `"Set the time to"`, `"Set the difficulty to"`,
  `"Teleported "`, `"Set the weather to"`, `"Gamerule "`). **Steal verbatim** — our logs
  prove those exact strings reach us today.
- **Open-chat gating**: `bot.on('chat', …)` is only processed *when no other agents are
  present*; otherwise agents talk over a side channel (Socket.IO `chat-message` through
  a central MindServer, with an `agent_connections` registry).
  **Reject the side channel** — the whole point of TODO 3 is that the *public chat* is
  the bus, because foreign crews and humans can only reach us there. But note the
  trade-off honestly: mindcraft chose an out-of-band channel precisely because public
  chat is unauthenticated and noisy. Our answer is tiering, not a private socket.
- **Danger to avoid**: mindcraft's action list includes `!attackPlayer(player_name)` and
  `!takeFromChest(item, num)` as ordinary chat-reachable commands, plus
  `!newAction(prompt)` behind `allow_insecure_coding` with the README warning *"Do not
  connect this bot to public servers with coding enabled."* We are on a public server
  with a leaked RCON password: those three verbs must not exist in our surface.

### 6.2 Minecraft Console Client — `RemoteControl` / `AutoRespond`

Chat-driven remote control with a `botowners` allowlist, delivered over `/tell`, plus a
global `messagecooldown`. Its documentation states the spoofing risk outright: *"Server
admins can spoof PMs (`/tellraw`, `/nick`) so enable `RemoteControl` only if you trust
server admins."* **Steal:** the owner-list model, the global message cooldown, and the
explicit spoofing caveat — it is the same threat we face and the same mitigation
(trust tiers, not text parsing).

### 6.3 CraftAssist (Facebook AI, 2019)

A Minecraft assistant driven by *dialogue*: player utterances are parsed into a formal
**action dictionary** (logical forms) rather than executed as free text, with
clarification dialogue for ambiguity. **Steal:** the two-stage shape — natural sentence →
validated logical form → bounded action. Our §3.3 parse is exactly that, minus the
learned parser.

### 6.4 Voyager / AgentVerse / VillagerAgent / MineLand

- **Voyager** contributes the architectural principle we already live by (a growing
  *skill library* of deterministic code, LLM used to compose not to act).
- **AgentVerse** uses a horizontal protocol: agents speak in a predetermined sequential
  order until consensus, appending an explicit **`[END]` token**, after which an
  auxiliary agent derives task assignments. **Steal:** the explicit end-of-negotiation
  token — our `TRADE done <id>` and `TRADE cancel <id>` play that role, giving every
  negotiation a terminating line so a stale offer never lingers.
- **VillagerAgent** models tasks as a **DAG with dependencies** and assigns them to
  agents. Relevant for a later `TASK … dep=<id>` extension; deliberately out of scope
  for v1.
- **MineLand** studies large-scale multi-agent interaction with limited senses — the
  reminder that agents miss messages. Hence: idempotent, self-contained lines; no
  multi-line frames; heartbeats over state-transfer.

### 6.5 Project Sid (Altera) — 1000 agents, emergent economy

Agents autonomously specialised into roles, formed a **merchant hub**, and converged on
**gems as a common currency**. The lesson for us is not the scale but the direction:
once `OFFER`/`TRADE` exist, a numéraire emerges. On this server the obvious candidate is
`iron_ingot` (CAVECREW's own first offer is priced in it: *"8 iron_ingot to kickstart
our iron age"*). Worth stating a reference price in the interop proposal so both crews
can quote consistently.

### 6.6 FIPA ACL (IEEE, the classic agent-communication standard)

The canonical typed-performative design: a message carries a mandatory **performative**
plus `sender`, `receiver`, `content`, `conversation-id`, `reply-with`, `in-reply-to`,
`reply-by` (Message Structure SC00061G; 22 communicative acts in the Communicative Act
Library SC00037J, including `inform`, `request`, `propose`, `accept-proposal`,
`reject-proposal`).

Mapping, and where we deliberately diverge:

| FIPA | FLEET/1 | Note |
|---|---|---|
| performative | the verb | uppercase, first token |
| sender | packet UUID | **never** a field in the line — an in-band sender field would be forgeable; the UUID is not |
| receiver | `Name:` addressing / `for <BOT>` | |
| content | the rest of the line | |
| conversation-id | `<offer-id>` | only where a conversation actually exists (trades) |
| reply-with / in-reply-to | — | dropped: chat is a broadcast bus, not a message queue |
| reply-by | `expires <N>m`, `by <N>m`, `ttl=` | |

**The one design point worth taking from FIPA and stating loudly**: `sender` must be
carried by the *envelope*, not the *content*. FLEET/1's version of the envelope is the
`playerChat` packet's UUID. Everything else is content and therefore untrusted.

### 6.7 Also considered

`node-minecraft-protocol` (transport, not coordination), villager-trading command
patterns from mindcraft (`!showVillagerTrades`, `!tradeWithVillager`) — irrelevant here
since our trades are bot-to-bot, and IRC/CTCP as the historical precedent for
machine-readable lines sharing a human channel (a verb-initial convention on a shared bus
is exactly CTCP's trick).

---

## 7. Required changes outside `chatlisten.js`

Small, named, and each independently useful.

### 7.1 `skills.js`

1. **Export the throttle**: add `S.say = (b, msg, force) => say(b, msg, force);` so
   payloads share one chat clock instead of the `_chatAt` poke in §5.2.
2. **Emit `TASK` lines** from `S.start` (start) and its `finally` block (done/fail/stop),
   suppressed for `quiet` tasks and deduped within 30 s.
3. **Namespace the `DEPOT` line** in `depositToChest`: `(FEL:B)` instead of `(chest B)`
   (keep accepting the legacy form on input).
4. Optional: a `leaseAcquire(id)` / `leaseRelease(id)` skill pair so the `USING`/`FREE`
   dance stops being a manual driver ritual — this directly addresses the lease-collision
   near-miss recorded in `LEARNING_HANDOFF.md`.

### 7.2 `graychat.js`

Extend the passthrough regex to the full v1 verb set — a protocol line that goes through
the RCON relay loses its authenticated identity for every receiver:

```js
const PROTOCOL = /^(DEPOT |USING |FREE |LEASE-BREAK |BASE |CLAIM |CLAIM-DROP |MAILBOX|HELLO|BYE |ROLE |TASK |NEED |HAVE |OFFER |TRADE |GIFT |NAK )/;
```

(`HELLO` without a trailing space so the bare `HELLO?` probe also passes through.)

### 7.3 `runner.js`

1. Add a **chat ring buffer + `GET /chatlog?since=`** (already on the PLAYBOOK M0 wish
   list) so drivers can read chat without an `/eval`.
2. Emit `BYE <name> shutdown` on `SIGTERM` before quitting.
3. Add `chatlisten.js` to the auto-inject-on-spawn payload stack (TODO 5 / FEEDBACK.md)
   and to `inject.sh` in the meantime.
4. `GET /state` should report `fleetchat: true/false` alongside the other payloads
   (the "injection reports drift from reality" entry in `FEEDBACK.md`).

### 7.4 New config file: `fleet.json`

One place for the roster, allies, and operators, read by the injector and templated into
the payload (like `idleguard.js`'s `__ROLE__`):

```json
{
  "crew": "FEL",
  "operators": ["Felsenuboot"],
  "fleet": { "FurzFriedrich": "lumberjack", "MettMarcel": "hunter",
             "BuddelBernd": "miner", "PflasterPeter": "builder" },
  "allies": { "CAVE": ["Grog", "UngaBunga", "Zug", "Bonk"] },
  "home": { "x": -3, "y": 111, "z": 4 }
}
```

Allies are **user-granted**. Nothing a bot says about itself can promote it.

---

## 8. Part E — interop proposal for CAVECREW (paste-ready)

Two forms: a one-page document (for a file or a pastebin), and a chat-sized script that
fits the 256-char line limit and the anti-spam rate.

### 8.1 One-page document — `FLEET_PROTOCOL_v1.md`

> **FLEET/1 — an open chat protocol for bot crews on this server**
> Proposed by the FEL crew (FurzFriedrich, MettMarcel, BuddelBernd, PflasterPeter,
> KackboonKevin). Open to anyone. No permission needed to implement it.
>
> **Why.** Two crews already share this world, already write `DEPOT +N item` lines, and
> already trade. Right now "chest B" means two different chests, an offer and its
> acceptance can't be matched by machine, and neither crew can tell a real message from a
> `/tellraw`. This is a ten-line fix.
>
> **Rule 0 — a line is protocol only if it starts with a known verb, in caps.**
> Everything else is prose. Keep protocol lines out of any RCON/tellraw relay: relayed
> lines arrive with no sender identity and we ignore them.
>
> **Rule 1 — namespace your ids.** `CREW:id` — `FEL:B`, `CAVE:A`, `FEL:furnace_1`. A bare
> `chest B` means *the speaker's own* chest B. Coordinates `(11, 89, 55)` are always
> unambiguous and always accepted. This one rule fixes the live collision between your
> chest B and ours.
>
> **The lines** (all ≤140 chars, one fact per line):
>
> ```
> HELLO <CREW> <BOT> v1 [role=<role>] [caps=<a,b>] [home=(x, y, z)]
> HELLO?                                    ask everyone to announce (answer with a few seconds of jitter)
> BYE <BOT> <reason>
> ROLE <BOT> <role>
> TASK <BOT> <start|done|fail|stop> <job> [k=v …]
> NEED <BOT> <N> <item> [for <purpose>] [by <N>m]
> HAVE <BOT> <N> <item> [at <CHESTREF>]
> DEPOT <±N item> [<±N item> …] (<CHESTREF>[, note])
> USING <ID> [ttl=<minutes>]     FREE <ID>     LEASE-BREAK <ID> (reason)
> BASE +<ID> at (x, y, z) [type]           BASE -<ID> (reason)
> CLAIM <x> <y> <z> r<N> [label]           CLAIM-DROP <x> <y> <z>
> OFFER <id> <N item [+ N item]> for <N item [+ N item]> [at <where>] [expires <N>m]
> TRADE <accept|decline|done|cancel> <id>
> GIFT <+N item> … for <BOT|CREW> [at <where>]
> ```
>
> **Etiquette.**
> - Announce a transfer *after* it lands, never before. Physical chest contents beat any
>   ledger line.
> - Hold a lease with `USING`, heartbeat every ≤4 min, `FREE` it the moment you are done.
>   Before breaking anyone's furnace lease: **open the furnace first** — if any slot has
>   items in it, the lease is not stale, no matter how quiet chat is. The contents belong
>   to the owner.
> - Respect `CLAIM` spheres: no digging, no building, no block-breaking inside one.
> - Keep it under ~1 line per second per bot. The server kicks for spam.
>
> **Trades.** Every offer gets an id so acceptance can be matched by machine. Nothing
> moves on a chat line alone — goods change hands at the trading post, and both sides
> post the `DEPOT`/`TRADE done` lines afterwards. Suggested unit of account:
> `iron_ingot`, since that is what your first offer was priced in.
>
> **Safety, and we ask you to match it.** Our bots will never attack a player, never
> break or build inside a claim, never open a chest that is not ours, and never withdraw
> anything on a chat request. Chat can ask our bots for status, or to stop, or to come
> over; it can never make them take, fight, or dig somewhere new. And because chat
> identity on this server is not authenticated (any tellraw can wear any name — your own
> published RCON credentials mean anyone listening can do it), **we act only on messages
> that arrive as real player chat, and only from names our operator has listed.** If one
> of your bots ever seems to be ignoring one of ours, that is why: ask our operator to
> add the name, or ping a human.
>
> **Your two existing conventions are adopted as-is:** `GIFT` and the trading-post
> two-chest swap. Thank you — they were the right idea, we just gave them ids.
>
> **Interop test, five lines, thirty seconds:** send `HELLO?`; we answer with `HELLO`
> lines. Send `HELLO CAVE Grog v1 role=miner caps=mine,smelt home=(11, 89, 55)`; we will
> answer with our roster and one `OFFER`. If that round-trips, we are compatible.

### 8.2 Chat-sized script (12 lines, ~20 s at 1.5 s spacing)

Post from one bot only. Every line is under 200 characters.

```
FEL crew proposing FLEET/1: an open chat protocol for bot crews. 12 lines, all optional, backwards compatible with the DEPOT lines we both already write. Read on.
Rule 0: a line is protocol only if it STARTS with a caps verb. Everything else is prose. Keep protocol off tellraw relays - relayed lines have no sender and we ignore them.
Rule 1: namespace ids as CREW:id. FEL:B is our chest B, CAVE:B is yours. Bare "chest B" = the speaker's own. Coordinates always work. This fixes the collision we have today.
HELLO <CREW> <BOT> v1 role=<role> caps=<a,b> home=(x, y, z)   -- and HELLO? asks everyone to announce. Answer with a few seconds of jitter so we do not all speak at once.
DEPOT +N item [+N item] (CHESTREF, note) -- unchanged from what you already send, we just ask for the namespace in the brackets. Announce AFTER the transfer lands.
USING <id> [ttl=<min>] / FREE <id> / LEASE-BREAK <id> (reason). Heartbeat every 4 min. Before breaking a furnace lease OPEN IT: any items inside means not stale, hands off.
BASE +<id> at (x, y, z) <type> for infrastructure. CLAIM <x> <y> <z> r<N> <label> for territory, CLAIM-DROP to release. We honour every claim we hear: no dig, no build.
TASK <BOT> <start|done|fail> <job> k=v -- machine-readable version of the status lines we both already narrate. NEED / HAVE <BOT> <N> <item> for want-ads.
OFFER <id> 10 oak_log + 10 oak_planks for 8 iron_ingot at (7, 112, 22) expires 60m. Then TRADE accept|decline|done|cancel <id>. The id is the point: it makes offers matchable.
GIFT +N item for <BOT> -- your invention, adopted as-is. So is your two-chest trading post. Suggested unit of account: iron_ingot, since that is what you priced your first offer in.
Safety we hold to and ask you to match: never attack a player, never dig or build in a claim, never open a chest that is not yours, never withdraw on a chat request.
Heads up: chat identity here is NOT authenticated - your published RCON means anyone can tellraw as anyone. We act only on real player chat from operator-listed names. Send HELLO? to test.
```

### 8.3 What to ask CAVECREW for in return

1. Their `CIV.md` equivalent of `BASE.md` — or at least the coordinates of every chest,
   furnace and claim, so both crews' no-touch sets are complete.
2. A crew tag they will use consistently (`CAVE` is already their scoreboard prefix).
3. **Rotate the RCON password** — it is public, and it means any listener can forge chat
   as any bot on this server. Worth saying plainly and once; it protects them more than
   it protects us.
4. Confirmation of the trading-post protocol: which chest is whose, and that a `DEPOT`
   line follows every take.

---

## 9. Open questions / risks

1. **Do we want auto-`TASK` narration at all?** It roughly doubles protocol line volume.
   Proposal: emit `TASK` only for tasks longer than ~20 s, and never for queue advances.
   Needs a live volume measurement before committing.
2. **`come` from tier 2 (allied) is the softest spot in the design.** A friendly-looking
   crew can walk our bot somewhere inconvenient. Mitigations in the spec: ≤64 blocks, not
   into a claim, sender must be visible in `bot.players`, `stop` always wins. Consider
   also refusing if the destination's local light level is <8 or y < 50.
3. **Roster promotion is manual by design.** That is correct for safety but means a new
   allied crew needs a human edit to `fleet.json`. Accepted.
4. **`bot.players` may be stale right after a reconnect**, making a legitimate sender
   briefly resolve to tier 4. Mitigation: on `spawn`, ignore commands for 3 s and let the
   tab list populate.
5. **Chest-namespace adoption depends on CAVECREW's cooperation.** The receiver rule
   ("bare `chest X` = sender's own crew") makes us correct unilaterally, so this is a
   nice-to-have, not a blocker.
6. **`graybridge.js` accepts any local POST** — the loopback binding is the only control.
   Any local process (or a future compromised script) can emit as any bot name. Worth a
   shared-secret header on `/say` at some point; noted, not in this track's scope.

---

## 10. Sources

Repo ground truth (read directly): `/home/felix/minecraft/bots/{LEARNING_HANDOFF,TODO,
FEEDBACK,AUTONOMY_PLAN,PLAYBOOK,BASE,DEPOT,README,DRIVER_GUIDE}.md`,
`skills.js` (v7), `runner.js`, `graychat.js`, `graybridge.js`, `idleguard.js`,
`panicguard.js`, `task.sh`, `inject.sh`, and `logs/*.log` (verbatim chat history quoted
in §1).

Library source (read locally): `node_modules/mineflayer/lib/plugins/chat.js` — the
`LEGACY_VANILLA_CHAT_REGEX` pattern, the `playerChat` / `systemChat` demux, and
`CHAT_LENGTH_LIMIT`.

- mineflayer API documentation — <https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md>
- mindcraft (MIT) — <https://github.com/mindcraft-bots/mindcraft> ·
  conversation manager <https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/conversation.js> ·
  command parser <https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/commands/index.js> ·
  action list <https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/commands/actions.js> ·
  settings <https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/settings.js>
- MindServer architecture (message routing) — <https://deepwiki.com/mindcraft-bots/mindcraft/6.1-mindserver-architecture>
- Mindcraft platform overview — <https://www.emergentmind.com/topics/mindcraft-platform>
- Minecraft Console Client, chat bots (`RemoteControl` allowlist + tellraw spoofing warning) — <https://mccteam.github.io/guide/chat-bots.html>
- CraftAssist: A Framework for Dialogue-enabled Interactive Agents — <https://arxiv.org/abs/1907.08584>
- AgentVerse (sequential consensus + `[END]` token, Minecraft experiments) — <https://arxiv.org/pdf/2308.10848>
- VillagerAgent (task-DAG multi-agent coordination in Minecraft) — <https://arxiv.org/pdf/2406.05720>
- MineLand (large-scale multi-agent, limited senses) — <https://arxiv.org/html/2403.19267v1>
- Project Sid: many-agent simulations toward AI civilization (roles, merchant hub, emergent currency) — <https://arxiv.org/abs/2411.00114> · <https://github.com/altera-al/project-sid>
- Voyager: An Open-Ended Embodied Agent with LLMs — <https://arxiv.org/abs/2305.16291>
- FIPA ACL Message Structure Specification SC00061G — <https://www.fipa.org/specs/fipa00061/SC00061G.html>
  (communicative acts library SC00037J: `inform`, `request`, `propose`, `accept-proposal`, …)
- `disconnect.spam` kick, evidence it is real and frequently hit —
  <https://bugs.mojang.com/browse/MC-112602> · <https://github.com/ViaVersion/ViaVersion/issues/1362>
