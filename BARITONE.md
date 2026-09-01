# BARITONE.md — Real-Baritone sidecar + ashfinder status (2026-09-01)

Handoff for the Baritone incorporation effort. Written by team-lead-workflow after
four phases: setup, in-world smoke test, HTTP adapter, ashfinder install/patch.
Detail docs: `/home/felix/minecraft/baritone/SETUP.md` (install + gotchas),
`/home/felix/minecraft/baritone/SMOKE.md` (in-world findings),
`DRIVER_GUIDE.md` "## Baritone sidecar (v1, 2026-09-01)" (line ~410, driver-facing),
`research/goto2-ab-plan.md` (ashfinder A/B plan), `goto2.patch.js` (the patch).

## Verdict in one line

The real-Baritone sidecar WORKS end to end (join, #goto, #mine, #stop, clean
shutdown, RAM under 2G) and is driveable through a guarded HTTP adapter — but
**Baritone has NO geofence of its own**, so it is fleet-usable ONLY through the
adapter, only with allowBreak=false by default, and only for jobs far from base.

## 1. What exists now

### A. Sidecar stack — `/home/felix/minecraft/baritone/` (437 MB, self-contained)
- HeadlessMC 2.10.0 GraalVM native binary (no system Java needed — it bundles
  Temurin 21). MC 1.21.11 + Fabric loader 0.19.3.
- `game/mods/baritone-1.21.11-20260103.131549-1.jar` — sha256 matches the pin in
  `research/movement-engines.md` §3.1. Runs STANDALONE (no Meteor Client needed —
  verified, this was the doc's biggest unknown).
- Offline auth as **GrubenGuenther** (fleet-law compliant name).
- Pre-seeded `game/baritone/settings.txt`: `prefixControl true`, `chatControl
  false` (critical — our bots narrate in chat; chatControl would parse narration
  as commands), `allowOnlyExposedOres true`, `backfill true`.
- CURRENT STATE: **client stopped, no player slot held**. Adapter daemon may be
  left running idle (~50 MB, holds no slot) — that is fine.

### B. HTTP adapter — the ONLY sanctioned way to drive the sidecar
- `/home/felix/minecraft/baritone/adapter.mjs` — Node ESM daemon, `127.0.0.1:3109`,
  zero deps. `/home/felix/minecraft/baritone/baritone.sh start|stop|restart|status`
  (stop also kills the MC client — a client can never outlive its adapter).
- Endpoints: `POST /launch /stop-client /cmd /goto /mine /halt /say /set`,
  `GET /state /pos /proc /health`.
- The adapter IS the geofence (see §4). It also fixes three landmines you WILL
  hit driving the sidecar raw: stdin turn-stealing (needs up to 14 retries, not
  6), "No process in control" firing on give-up exactly like on arrival (every
  /goto is graded against real position — trust `arrived`, never `state:"done"`),
  and stale waypoint-file position reads.
- Verified end to end: 4 clean launches (23–26 s to in-world), exact-arrival
  gotos with zero blocks broken, /halt ~1-tick cancel, /stop-client 2.2 s,
  client RSS 1.6–1.8 GB (under the 2G heap cap, below the doc's 2.5–3 GB guess).

### C. ashfinder (@miner-org/mineflayer-baritone 4.6.2) — installed, NOT wired
- Pinned exact in `bots/package.json`. `runner.js`/`skills.js` untouched.
- `/home/felix/minecraft/bots/goto2.patch.js` — standalone patch exporting
  `loadAshfinder(bot, log)` (MUST be called in createBot BEFORE spawn — post-spawn
  load leaves the executor null forever) and `install(bot, app, opts)` → /goto2
  endpoint with arrival assertion, single-flight mutex, engine-conflict handoff,
  corridor pre-check against protected.json, and a `bot.ashDig` guard (ashfinder's
  dig bypasses digguard.js — raw packets).
- Offline-smoke-tested only. **No in-world A/B has run.** Plan with 6 route
  classes + adoption criteria: `research/goto2-ab-plan.md`.

## 2. How a driver/lead uses the sidecar

```sh
/home/felix/minecraft/baritone/baritone.sh start     # adapter daemon up (no slot used)
curl -s -XPOST localhost:3109/launch                  # boot client + join (23-26s)
curl -s -XPOST localhost:3109/goto -d '{"x":80,"y":86,"z":5}'          # break off
curl -s -XPOST localhost:3109/goto -d '{"x":..,"break":true}'          # 60-blk fence
curl -s -XPOST localhost:3109/mine -d '{"block":"coal_ore"}'           # 150-blk fence
curl -s localhost:3109/state                          # poll; trust "arrived"
curl -s -XPOST localhost:3109/halt                    # ~1-tick kill switch
curl -s -XPOST localhost:3109/stop-client             # ALWAYS when the job ends
```

Rules of the road:
- One job at a time (409 otherwise). One sidecar client, ever. Stop the client
  the moment the job ends — the idle watchdog (15 min) will do it if you forget,
  but do not lean on it.
- Narrate via `POST /say` — fleet law applies to GrubenGuenther too.
- If you must go raw (adapter down): `msg #...` via `bcmd.sh` ONLY. Never
  `.#...` (runs off the main thread — `#mine` crashes with an
  IllegalStateException; `.#goto` only survives by accident). Never
  `pkill -f 'headlessmc launch'` (kills your own shell — use stop-sidecar.sh).
- Completion detection: poll `/proc` (or `msg #proc` raw) for "No process in
  control" — Baritone prints NOTHING on arrival — then verify position. The
  adapter does both for you.

## 3. Division of labor (recommended doctrine)

| Job | Engine |
|---|---|
| Anything near base / plaza / camp / trading post | **mineflayer-pathfinder** (in-process, digguard applies, exclusionAreas planned per movement-engines §2.8) |
| Long-haul travel (>150 blocks), pure navigation | **Real Baritone sidecar**, allowBreak=false (verified: 135-block mixed climb, zero blocks touched) |
| Bulk mining | **Real Baritone sidecar `#mine`**, ONLY in an approved remote zone ≥150 blocks from every anchor edge, break flipped on for the job and off after (adapter enforces) |
| /goto2 fallback for routes pathfinder fails | **ashfinder** — PENDING A/B; do not adopt before the plan in research/goto2-ab-plan.md runs |

## 4. Safety rules (non-negotiable)

1. **Baritone has no place-based restriction concept.** All ~300 settings were
   dumped: no exclusion areas, nothing like pathfinder's exclusionAreas.
   `minYLevelWhileMining` was observed being IGNORED (set to 150, it mined at
   y86–94). Altitude is not a fence. Observed: `#mine coal_ore` walked the bot
   78 blocks down and 50 sideways to the nearest cached ore — had that ore been
   under the plaza, it would have dug there.
2. Therefore: **allowBreak=false and allowPlace=false are the default state**,
   re-asserted after every join, forced back off when any job ends/cancels/times
   out. This is real protection — verified zero blocks broken over long mixed
   terrain.
3. Adapter geofence: `/mine` refuses unless live position is ≥150 blocks from
   the EDGE of every anchor (plaza, trading post, everything in
   `bots/protected.json` — new registered structures widen the fence
   automatically). `/goto {break:true}` uses a 60-block fence. Both
   env-overridable, don't.
4. `chatControl` stays **false** forever — the fleet narrates constantly and
   bare chat would be parsed as Baritone commands.
5. `#stop` / `POST /halt` is a reliable ~1-tick kill switch. Use it early.
6. Never drive with `.#` — main-thread crash (see §2).
7. **FEL-BT-1 (80,~164,5; box x75..85,z0..10) is a smoke-test zone only** — at
   83 blocks out it does NOT clear the 150-block mining fence. A production
   mining zone must be designated further out (and get a BASE.md row).
8. ashfinder with breakBlocks on **bypasses digguard.js** (`bot.ashDig`, raw
   packets). goto2.patch.js closes it locally; the wrapper belongs in
   digguard.js before any wider ashfinder use.

## 5. Blocked / pending

- **ashfinder A/B not run** (needs a driver window + the 60-trip plan). Adoption
  gate: +20pp arrival rate, zero deaths / protected breaks / falseSuccess.
- **goto2.patch.js not merged** into runner.js (a concurrent workflow owns
  runner.js/skills.js; merge instructions are 5 copy-paste edits in the file
  header, load in createBot pre-spawn).
- **bcmd.sh still has the 6-try hole** — the launcher context was observed
  swallowing 6 consecutive lines; needs the adapter's 14-try escalating backoff
  + "Successfully set" confirmation for #set.
- `allowOnlyExposedOres` + `backfill` are seeded and confirmed set, but
  **untested under a production mining job** — validate tunnel behavior in the
  first real remote-zone #mine.
- **BASE.md rows missing** for FEL-BT-1 and the ashfinder DIGTEST_1 zone
  (x=-100..-90, z=-60..-50) — deliberately not added while drivers were writing
  BASE.md live; the lead should add them.
- `loopback-proxy.js` in the baritone dir is confirmed dead weight (the
  "HMC hates dotted IPs" theory was the stdin bug) — safe to delete.
- Doc corrections owed to `research/movement-engines.md`: §1.3 documents
  ashfinder events (`goal-reach` etc.) that DO NOT EXIST (only `stopped` and
  `pathStarted`); §3.6's "no programmatic inventory access" is partially wrong
  (`gui` works under -lwjgl and dumps slot-by-slot).
- Brief's "player cap 8" is stale — server reported 18/99. Still run exactly
  one sidecar client.
