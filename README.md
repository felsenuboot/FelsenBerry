# Minecraft Bot Infrastructure

Self-owned mineflayer bot fleet for Felix's server — no MCP dependency. Each bot is a
standalone Node process with a local HTTP control API, so any tool that can run `curl`
has full control. Multiple bots run side by side, one process + one control port each.

- **Server:** `100.101.197.44:25565` (Tailscale, offline-mode — no Microsoft auth)
- **Server version detected:** 1.21.11 (mineflayer auto-negotiates; pin with `--version` only if needed)
- **Stack:** mineflayer 4.38.0, mineflayer-pathfinder 2.4.5, prismarine-viewer 1.33.0 (optional, installed)
- **"Baritone-like" plugins** (all optional, each load guarded — a missing plugin can never
  break startup, its endpoint just returns 501): mineflayer-collectblock 1.6.0,
  mineflayer-tool 1.2.0, mineflayer-auto-eat 3.3.6 (pinned — 4.x/5.x are ESM-only),
  mineflayer-armor-manager 2.0.1 (auto-equips best armor, no endpoint needed),
  mineflayer-pvp 1.3.2

Note on real Baritone: not viable here — official Baritone tops out at MC 1.21.8 (no
1.21.11 release; only untrusted third-party forks claim it), there is no JVM on this
box, and HeadlessMc validates accounts even for offline servers. The endpoints below
are the mineflayer equivalent.

## Naming rule (mandatory)

Every bot gets an **incredibly stupid, funny, ridiculous name**. Mild swearing welcome,
German humor a plus. Max 16 chars, only `[A-Za-z0-9_]`. Examples of the vibe:
`KackboonKevin` (taken — the MCP bot), `DirtDieter`, `SirKacksalot`, `FurzFriedrich`.
Invent fresh ones; never reuse a name that is already connected.

## Scripts

```sh
./spawn.sh <name> <port>     # start a bot detached; logs/<name>.log, pids/<name>.pid
./spawn.sh LauchLothar 3102  # ports 31xx by convention, one per bot
./stop.sh <name>             # kill by pidfile
./list.sh                    # table of bots: name, pid, port, connected + position
```

`spawn.sh` refuses if the name is already running or the port is in use. Extra args
after the port are passed to runner.js, e.g. `./spawn.sh DoenerDetlef 3103 --version 1.21.4`
or `--host <ip> --mcport <port>` for a different server.

Manual run (foreground, for debugging):

```sh
node runner.js --name PommesGuenther --port 3105 [--host 100.101.197.44] [--mcport 25565] [--version 1.21.x]
```

## Auto-reconnect

The runner never gives up: on `end`, `kicked`, or pre-login `error` it reconnects with
exponential backoff — 1s, 2s, 4s, ... capped at 30s — and logs every attempt. The backoff
resets to 1s after a successful spawn. The control API stays up the whole time;
while disconnected, `GET /state` reports `"connected": false` and POST endpoints
return 503 `{"ok":false,"error":"bot not connected"}`. An `/eval` error can never
kill the process (errors are caught and returned as JSON; there are also
uncaughtException/unhandledRejection guards).

All chat, whispers, joins/leaves, health changes, deaths, kicks, and API calls are
logged to `logs/<name>.log` with ISO timestamps.

## Control API

Binds to `127.0.0.1:<port>` **only** — never exposed on the network.

### GET /state

```sh
curl -s http://127.0.0.1:3101/state
# {"name":"FurzFriedrich","connected":true,"position":{"x":-2.5,"y":115,"z":8.7},
#  "health":20,"food":20,"dimension":"overworld","task":null,
#  "payloads":{"skills":9,"digguard":true,"graychat":true,"panicguard":true,
#              "idleguard":true,"reachguard":true},
#  "movements":{"parkour":false,"maxDropDown":3,"sprint":true,"towers":false,"digCost":1},
#  "orphanedGoto":false,"pathStuckRecent":0,"role":"lumberjack"}
# "task" is non-null while /mine, /follow, or /hunt is active, e.g.
# {"type":"follow","detail":"KackboonKevin","startedAt":"..."}
# (bots started before the Baritone-like upgrade don't report "task")
```

`payloads`/`movements`/`orphanedGoto`/`pathStuckRecent`/`role` are engine v8+ (a bot
running an OLDER runner.js **process** won't have them yet — a `POST /eval` skills.js
re-injection alone doesn't add them, only a `./stop.sh` + `./spawn.sh` process restart
does; check for the `payloads` key's presence to tell which runner.js generation a
given bot is on). `payloads` is a LIVE check (`typeof globalThis.__x !== 'undefined'`),
never a cached injection-time report — see "Payload stack" below. `movements` mirrors
the bot's current `bot.pathfinder.movements` safety knobs. `orphanedGoto` flags a
leaked `path_update` listener (a stuck `goto` promise still alive); `pathStuckRecent`
counts `path_reset('stuck')` events in the last 15s (a wedge in progress). `role` is
whatever `--role` the process was started with (`null` if none — see below).

### Payload stack (engine v8+, auto-injected on every spawn)

Every bot installs seven *payloads* — the skill engine plus six small guard scripts —
installed via the same `/eval` AsyncFunction mechanism, each idempotent (safe to
re-inject; re-installing replaces the old instance cleanly) and each surviving a
Minecraft *reconnect* by re-running its setup (`bot.on('spawn', ...)`, not `once`).
None of them survive a **process restart** (`./stop.sh`) on their own — but as of v8,
`runner.js` re-installs the whole stack automatically on every `spawn` event (first
connect, reconnect, AND death-respawn), so a `./stop.sh` + `./spawn.sh` cycle is now a
one-step full upgrade instead of "restart, then remember 5 separate manual injections."

| File | Does | Auto-injected? |
|---|---|---|
| `skills.js` | the task engine (see below) | always |
| `digguard.js` | makes registered base infrastructure undiggable (bot.dig level + pathfinder planner level); reads `protected.json`, hot-reloads it | always |
| `graychat.js` | routine chat routed through gray tellraw via the local RCON relay (`graybridge.js`), protocol/ledger lines and `!important` lines pass through plain | always |
| `dangerscan.js` | 4Hz weighted hostile scan over `bot.entities` (sees through walls — the server streams entities regardless of line of sight) + held-item durability + light/skyLight; grafts all of it onto `__skills.status()` | always |
| `survival.js` | context-aware panic reflex at game tick speed — ENV / CREEPER / BREAK_LOS / FLEE_HOME / WALL_OFF. **Replaces `panicguard.js`**, which was flee-home-only and got a bot killed fleeing a skeleton in the open | always |
| `reachguard.js` | rejects out-of-range dig/place/activate/attack with an immediate `reach_violation` error instead of a silent hang (survival reach is ~4.5 blocks for blocks, ~3.0 for entities) | always |
| `idleguard.js` | role-templated (`__ROLE__` substituted at inject time) idle-time work | **only if `runner.js` was started with `--role <role>`** — otherwise inject manually, see DRIVER_GUIDE.md |

**Presence is not liveness.** A reconnect makes `createBot` build a *fresh* bot object while
`globalThis` survives the swap, so a payload's global can still be there while its `bot.dig` /
`bot.chat` patches and event listeners point at the discarded bot — installed, reporting
`true`, and doing nothing. Payloads therefore register in `globalThis.__payloads` and mark
themselves `stale` on their own bot's `end` event; `GET /state` surfaces that as
`stalePayloads: [...]`. Anything listed there needs a re-inject (or a process restart, which
rebinds the whole stack). This is the mechanism behind the long-running "injection reports
drift from reality" bug.

Manual re-inject (any payload, any time — idempotent):
```sh
jq -Rs '{code:.}' digguard.js | curl -s -X POST http://127.0.0.1:3101/eval -H 'Content-Type: application/json' -d @-
```

### POST /chat

```sh
curl -s -X POST http://127.0.0.1:3101/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Moin! Ich bin FurzFriedrich."}'
# {"ok":true}
```

### POST /goto

Pathfinds to within 1 block of the target (GoalNear). Responds when arrived, or with
`{"ok":false,"error":...}` on failure / after a 60s timeout (pathing is cancelled).

```sh
curl -s -X POST http://127.0.0.1:3101/goto \
  -H 'Content-Type: application/json' \
  -d '{"x":-4,"y":115,"z":8}'
# {"ok":true,"position":{"x":-2.5,"y":115.9,"z":8.7}}
```

### POST /mine — Baritone-style block collection

Finds up to `count` (max 32) blocks of the given type within `maxDistance` (default 64),
pathfinds to them, equips the best tool it has, digs, and picks up the drops
(mineflayer-collectblock + mineflayer-tool). Responds when done or after `timeoutMs`
(default 120s, max 300s). The bot chat-announces start/finish. Caveat: blocks that need
a tool the bot doesn't have (e.g. stone with no pickaxe) drop nothing, so the collect
will hang until the timeout — give the bot a pickaxe first or mine hand-friendly blocks.

```sh
curl -s -X POST http://127.0.0.1:3103/mine \
  -H 'Content-Type: application/json' \
  -d '{"block":"oak_log","count":2}'
# {"ok":true,"mined":2,"block":"oak_log"}      (verified: took ~17s, logs in inventory)
# no match nearby -> 404 {"ok":false,"error":"no diamond_ore found within 64 blocks"}
```

### POST /follow — follow a player

Dynamic GoalFollow (keeps re-pathing as the target moves), default range 3 (1–10).
Responds immediately; runs until `/stop` or a new goal replaces it. `/state` shows it
under `"task"`.

```sh
curl -s -X POST http://127.0.0.1:3103/follow \
  -H 'Content-Type: application/json' \
  -d '{"player":"KackboonKevin"}'
# {"ok":true,"following":"KackboonKevin","range":3}   (verified: closed to 4.4 blocks)
# offline player -> 404; online but out of render distance -> 404
```

### POST /hunt — attack nearest entity

Finds the nearest entity whose type (`cow`, `zombie`, ...) or username matches, then
mineflayer-pvp chases and attacks it (pathfinder-driven, up to 128 blocks). Responds
immediately; when the target dies or leaves tracking range the bot announces
"Hunt finished" and clears the task.

```sh
curl -s -X POST http://127.0.0.1:3103/hunt \
  -H 'Content-Type: application/json' \
  -d '{"entity":"pig"}'
# {"ok":true,"hunting":"pig","target":{"id":186,"position":{...}}}
# nothing matching in sight -> 404 {"ok":false,"error":"no entity 'wither' in sight"}
```

### POST /stop — clear all tasks

Cancels collectblock task, pvp attack, and pathfinder goal. Always safe to call.

```sh
curl -s -X POST http://127.0.0.1:3103/stop
# {"ok":true,"stopped":["collectblock","pvp","pathfinder"]}
```

### POST /autoeat — toggle auto-eating

mineflayer-auto-eat is ON by default (eats from inventory when hungry). Empty body
toggles; `{"enabled":true|false}` sets explicitly.

```sh
curl -s -X POST http://127.0.0.1:3103/autoeat -d '{"enabled":false}' \
  -H 'Content-Type: application/json'
# {"ok":true,"autoeat":false}
curl -s -X POST http://127.0.0.1:3103/autoeat    # toggle back
# {"ok":true,"autoeat":true}
```

### POST /eval — the escape hatch

Runs `code` as the body of an async function with `bot`, `mineflayer`, `pathfinder`
(the mineflayer-pathfinder module), `goals`, and `Vec3` in scope. The result is awaited
and returned JSON-safely (`util.inspect` fallback for circular structures). Errors come
back as `{"ok":false,"error":...}` — they never crash the bot.

```sh
# simple: what's around?
curl -s -X POST http://127.0.0.1:3101/eval \
  -H 'Content-Type: application/json' \
  -d '{"code":"const b = bot.blockAt(bot.entity.position.offset(0,-1,0)); return {standingOn: b && b.name, version: bot.version, players: Object.keys(bot.players)};"}'
# {"ok":true,"result":{"standingOn":"oak_leaves","version":"1.21.11","players":[...]}}

# nontrivial: dig the block below (equip a tool if one is available)
curl -s -X POST http://127.0.0.1:3101/eval \
  -H 'Content-Type: application/json' \
  -d '{"code":"const target = bot.blockAt(bot.entity.position.offset(0,-1,0)); if (!target || !bot.canDigBlock(target)) return {dug:false, reason:\"cannot dig \"+(target&&target.name)}; const tool = bot.pathfinder.bestHarvestTool(target); if (tool) await bot.equip(tool, \"hand\"); await bot.dig(target); return {dug:true, block:target.name};"}'

# pathfind via eval instead of /goto (full goal control)
curl -s -X POST http://127.0.0.1:3101/eval \
  -H 'Content-Type: application/json' \
  -d '{"code":"await bot.pathfinder.goto(new goals.GoalBlock(0, 115, 0)); return {...bot.entity.position};"}'
```

Anything mineflayer can do works here: `bot.inventory.items()`, `bot.craft(...)`,
`bot.placeBlock(...)`, `bot.attack(...)`, event listeners, multi-step scripts with `await`.

## Layout

```
bots/
├── runner.js    # single-bot process: mineflayer + pathfinder + control API
├── spawn.sh     # start detached      ├── stop.sh   # kill by pidfile
├── list.sh      # fleet overview      ├── logs/     # <name>.log (timestamped)
└── pids/        # <name>.pid, <name>.port
```

## Skill library (skills.js) — injectable Baritone-style task engine

`skills.js` is a single self-contained `/eval` payload that installs `globalThis.__skills`
into a RUNNING bot: a cancellable one-task-at-a-time runner plus deterministic skills, so
driver LLMs only pick a skill + parameters and poll cheaply (~2 calls per task). Survives
reconnects (lives on globalThis, takes the fresh `bot` from every /eval); does NOT survive
a process restart — re-inject after `./spawn.sh`. Re-injection is idempotent: it stops any
running task and replaces the engine (log/seq preserved — but the QUEUE is dropped, see below).
DO NOT use runner's `POST /stop` to cancel a skill task — it clears neither the task nor the
queue, only the pathfinder goal, and the bot picks the next queued job right back up; use
`./task.sh <port> stop`.

```sh
./inject.sh 3104                                            # install/upgrade the engine
./task.sh 3104 list                                         # skill registry + params
./task.sh 3104 start chopTrees '{"types":"any","count":2}'  # returns {taskId} immediately
./task.sh 3104 status [sinceSeq]     # ONE-call poll: bot vitals + task + queue + new log lines
./task.sh 3104 wait                  # loops locally, prints one terminal status (token-optimal)
./task.sh 3104 stop [reason]         # cooperative cancel (never mid-dig) + CLEARS THE QUEUE
```

### Task queue (engine v6, verified live 2026-08-31, KloputzKarl on 3106)

Chained jobs with an **in-process auto-advance**: the next task starts in the same
synchronous continuation in which the previous one reaches terminal state, so the visible
idle gap while a driver LLM thinks is gone. Measured live: `gapMs` **0 ms** between
consecutive queued tasks (0/0/0 over a 4-task chain, 0 across an 8-task chain), and zero
sampled states of `running:false` while items were pending.

```sh
./task.sh 3104 queue '[{"name":"chopTrees","args":{"count":2}},{"name":"depositToChest"}]' '{"onEmpty":"collectDrops"}'
./task.sh 3104 enqueue collectDrops '{"radius":12}'   # append one job to a live queue
./task.sh 3104 qinfo                 # pending args, history w/ gapMs, merged collected totals
./task.sh 3104 skip [reason]         # abort current job and ADVANCE (stop ends the batch)
./task.sh 3104 resume                # continue after a halt or a reconnect pause
```

- **API** (additive; v3–v5 `start`/`status`/`stop` contract unchanged): `enqueue(bot, items, opts)`,
  `resume(bot)`, `skip(reason)`, `clearQueue(reason)`, `setFallback(bot, spec|null)`,
  `queueInfo()`, `rebind(bot)`. `status` gains a `queue` key that is **null while unused**, so a
  plain-`start` driver's poll keeps its old size (499 B vs 515 B with a queue active).
- **Atomic validation**: every item is `validate`d before anything is queued — a bad skill
  name or missing arg is rejected up front with `{code, index, name, message, params}` and
  nothing is partially enqueued.
- **onError** `halt` (default) | `continue` | `abort`. A failure keeps the pending items,
  chats the halt, and waits for `resume`. `low_health`, `inv_full`, `disconnected`,
  `timeout`, `unknown_skill`, `queue_thrash` always halt — so a broken tool or a starving
  bot can't burn the rest of the batch (the tool-maintenance rule at batch level).
- **onEmpty fallback**: what the bot does when the queue drains instead of standing still.
  Fires ~1 ms after the last job, repeats on `everyMs` (default 20 s, clamped 3–300 s), and
  announces only the first run (later runs are `quiet`). `stop` drops it; `setFallback(bot,null)`
  clears it. A bot with a fallback armed effectively never reaches idle-guard role-default
  work — the driver, not the guard, now decides what "idle" means.
- **Safety**: 16-item cap; a `queue_thrash` halt after 12 advances in 10 s; every queue timer
  is epoch- and identity-guarded so a re-injected engine can never be driven by the old one's
  timers; a disconnect pauses the queue (`state:"paused"`) and the next `status`/`enqueue`
  carrying a live bot resumes it. Re-injection deliberately DROPS the queue and records the
  lost items as a log line: `queue dropped by re-inject (2): collectDrops, collectDrops`.
- **Do not add `await` to `_pump` or `_onTaskEnd`** — the zero-gap handover depends on both
  staying strictly synchronous (banner comment in skills.js).

### Skills (all verified live on the server, 2026-08-31, bot BratwurstBodo)

| Skill | Args (defaults) | Verified result |
|---|---|---|
| `collectDrops` | `radius` 16, `timeoutMs` 30000, `only` [names] | swept area, `{picked,unreachable}` |
| `chopTrees` | `types` `'any'`/array, `count` 1, `maxDist` 64, `replant` true | 2 birch felled, 13 logs, sapling replanted |
| `mineLane` | `target` (ore aliases incl. deepslate), `count` 8, `maxDist` 32, `vein` true, `laneY` | 6/5 cobblestone banked, 0 drops lost |
| `huntAnimals` | `species` `['cow']`, `count` 1, `radius` 32, `anyMob` false | cow killed + looted; players ALWAYS rejected |
| `depositToChest` | `pos` {x,y,z} (else nearest), `keep` [], `keepTools` true, `items` whitelist | 22 cobble into depot chest B + `DEPOT +…` chat ledger |
| `safeDescend` | `toY`, `dir`, `torchEvery` 8, `maxSteps` 128, `minY` -59 | 45° staircase y97→92, lava-scanned, drops swept, torches placed |
| `come` | `x,y,z`, `range` 1 | walks there with stall recovery |
| `buildSchematic` | `blueprint` name **or** inline `placements` [{name,pos:[x,y,z]}], `chest` {x,y,z}, `maxRestocks` 3, `clearSite` false, `skipMissing` false | 5x4x5 .schem hut: 62/62 placed, 62/62 verified, 1 restock trip (HuettenHorst) |
| `buildWall` | `origin` {x,y,z} (or `from`/`to`), `width` 5, `height` 3, `material`, `axis` 'x'/'z', `chest`, `clearSite` true | 4x3 oak_log wall built from an EMPTY inventory via one chest restock, 12/12 verified |
| `buildFloor` | `origin` {x,y,z} (or `from`/`to`+`y`), `width` 5, `length` 5, `material`, `chest`, `clearSite` true | same generator + builder core as buildWall (which is verified); not separately live-run |
| `frameStructure` | `origin`, `width`≥3, `depth`≥3, `height` 4, `cornerMaterial` oak_log, `fillMaterial` oak_planks, `doorway` 'north'/'south'/'east'/'west'/null, `roof`, `floor`, `chest`, `clearSite` true | 5x5x3 log-corner + cobble-infill shell: 46/46 placed, 46/46 verified, doorway gap correct |
| `buildStaircase` | `origin` (opt), `toY`, `dir`, `material` `*_stairs`, `rail` (opt fence), `torchEvery` 6, `maxSteps` 96 | built-structure counterpart to safeDescend, uses ctx.autoTorch — still NOT live-verified |

### Blueprint building (engine v7, verified live 2026-09-01, HuettenHorst on 3107)

Two front ends, **one builder**. The file layer lives in `runner.js` (skills.js can never
`require()`): `POST /blueprint/load` parses a `.schem` with **prismarine-schematic 1.3.0**
into an ordered, world-anchored placement list on `globalThis.__blueprints[name]`, which
`buildSchematic` reads directly out of the same process — no serialization, no /eval size
limit. The parametric generators (`__skills.blueprints.{wall,floor,frame}`) produce the same
`[{name, pos:[x,y,z]}]` shape in pure code, so the build skills work with no schematic
library installed at all.

```sh
curl -s -X POST http://127.0.0.1:3107/blueprint/load -H 'Content-Type: application/json' \
  -d '{"name":"hut5","path":"/home/felix/minecraft/bots/blueprints/hut5.schem","at":{"x":2,"y":104,"z":32}}'
# {"ok":true,"blocks":62,"bill":{"oak_log":16,"oak_planks":46},"size":{"x":5,"y":4,"z":5},"warnings":[]}
curl -s http://127.0.0.1:3107/blueprint/list          # registry (also GET-able while disconnected)
curl -s -X POST http://127.0.0.1:3107/blueprint/drop -d '{"name":"hut5"}'
./task.sh 3107 start buildSchematic '{"blueprint":"hut5","chest":{"x":-2,"y":103,"z":34}}'
```
`at` is the world MIN corner; `path` must resolve under the bots dir (or pass `base64`);
cap 4096 non-air blocks; the registry survives reconnects but **NOT a process restart** —
re-POST after every `./spawn.sh`, same as `./inject.sh`. A missing prismarine-schematic
degrades to `501` on `/blueprint/load` and the runner still starts clean (verified).

What the shared builder (`buildCore`) does, in order — `planning` (bill of materials, count
what's already correct, warn on gravity blocks) → `travelling` (loads the site chunks) →
`building` (bottom-up, row-major) → `restocking` (only when a material runs out and a `chest`
was given; withdraws exactly what the REST of the build needs, then returns) → `deferred`
(2 extra rounds over cells that had no reference face or were blocked by the bot's own
hitbox — neighbours placed later give them something to attach to) → `finishing` (drop sweep,
then a block-by-block `verified:{ok,mismatched,examples}` re-read of the whole site).

`ctx.placeBlockAt(pos, blockName, {clearMismatch, ...})` is the primitive underneath (the
v5/v6 `{ok, already, reason}` contract is unchanged). Quirk defenses baked in: unloaded
chunk → travel then retry; plant clutter in the cell is always dug (leaf_litter); the bot's
own hitbox → step aside and retry; out of reach → `gotoNear`→`gotoSee` ladder; an
*interactive* reference block (chest/table/door/…) → sneak-place so the right-click doesn't
open its UI; and every `bot.placeBlock` is raced against 5 s **and post-verified with
blockAt**, because it can both hang on a server rejection and resolve without the block
appearing. `PROTECTED` blocks are never dug to clear a cell.

Pathfinder is the other hazard: it digs traversal blocks with the held tool and spends
inventory blocks as scaffolding. During a build the engine installs Movements with
`scafoldingBlocks = []`, `allow1by1towers = false` and an `exclusionAreasBreak` guard
returning 100 for the build's own cells (pathfinder's `safeToBreak` treats ≥100 as
unbreakable), then restores the previous movements in the task's `finally` — verified live,
including after a mid-task `stop`.

### Torch discipline (engine v4, verified live 2026-08-31)

`mineLane` and `safeDescend` both call a shared `ctx.autoTorch(state, every)` primitive
after every real dig/step: places a torch every ~7 units of progress (junctions and
working faces included, since it fires on every successful dig in `mineLane`, not just
periodically), OR immediately if the current block's light level reads below 8 — so a
freshly-dug pitch-black tunnel gets lit liberally until the cadence catches up (verified:
placed 4 torches in the first 11 steps of a descent into unlit rock — conservative by
design, better over-lit than a mob spawner). Tries the floor first, then the four side
walls, so it works in open mining chambers as well as tunnels. When the bot carries zero
torches, it logs a one-time `no_torches` warning (`lvl:"warn"` in the status log — not
repeated every check) instead of silently digging in the dark; drivers seeing that line
should restock from depot chest B (64 banked) before continuing. `mineLane`'s result now
includes a `torches` count alongside `banked`/`dug`.

Known quirk: in `mineLane`'s vein-following (which can dig sideways/backwards through a
just-lit wall), a placed torch's support block sometimes gets mined out later in the same
task — the torch pops as a drop, gets swept up by the routine `collectDrops` calls, and
gets placed again elsewhere. This can make the `torches` counter read higher than net
torches consumed (verified: 9 placements from 8 crafted, 1 left over) — it's re-placement
of the same physical torches, not a counting bug, and does not affect correctness of the
`no_torches` signal.

All tasks accept `timeoutMs` (cap 30 min) and `minHealth` (abort guard, default 6).

### Status contract (what `status`/`wait` return)

`{v, seq, bot:{pos,hp,food,dim}, task:{name, args, phase, progress:{done,total,unit},
running, done, cancelled, error, result, collected, elapsedS}, log:[[seq,lvl,msg]…]}` —
`collected` is the live inventory-gain diff (proof drops were picked up), `result` is the
skill's own counters, `error` is `null` or `{code, message, phase, hint}` with codes like
`busy | unknown_skill | bad_args | not_found | no_tool | path_timeout | stuck | inv_full |
low_health | timeout | disconnected`. Transient failures are retried in-code (visible as
`retry` log lines); only decisions worth an LLM surface as errors.

### House rules enforced in the primitives (no skill can forget them)

best tool equipped before every dig + `canHarvest` gate (a wrong-tool `bot.dig` would hang
forever — every dig is also raced against a wall-clock budget); drops collected after every
dig/kill (inventory-delta verified); one English chat per phase (throttled ≥1.3 s, deduped);
players are never attack targets (checked at validate AND before every swing).

### Field quirks baked into skills.js (don't rediscover these)

- `goals.GoalBreakBlock` is broken in pathfinder 2.4.5 — use `GoalLookAtBlock(pos, bot.world)`.
- **leaf_litter physics wedge (1.21.11)**: standing in `leaf_litter` leaves `onGround=false`
  forever → jump never fires → pathfinder holds a "success" path while the bot stands still.
  `ctx.goto` detects the stall (6 s no movement) and digs the nuisance block + hops.
- `GoalNear` can loop forever recalculating partial paths near cluttered spots (the depot);
  the skills fall back to `GoalLookAtBlock` and all gotos have wall-clock timeouts.
- `window.deposit(type, null, count)`: count `null` means **1**, not "all" — always pass it.
- `bot.openContainer` has no timeout (blocked chest = hang) — raced with 8 s.
- Block↔item ids are different namespaces; `stone` drops `cobblestone` (see DROPS table).
