# Survival Doctrine — combat, panic, and lighting research (2026-09-01)

Research track [survival], commissioned after 3 preventable deaths in one shift:

| Death | Cause | Root failure |
|---|---|---|
| MettMarcel #1 | "fell from a high place", SE hilltop | stock `new Movements(bot)` defaults live mid-session (FEEDBACK: *pathfinder Movements spawn with unsafe defaults*, open) |
| MettMarcel #2 | zombie, dark low pocket, 20→0 HP in ~8s | 50s driver polling gap; no in-bot reflex (FEEDBACK: *promote panicguard into engine*, open) |
| BuddelBernd | skeleton at ~(-22,-31,-16), 40s of arrows | HP<8 flee-home panic fired but home was 150 blocks up a corridor; fleeing from a ranged attacker with your back turned is suicide (FEEDBACK: *panic-retreat useless at depth vs ranged attackers*, open) |

World facts that shape everything below: daylight is frozen at day-0 morning → surface is
spawn-safe (sky-exposed blocks hold internal sky light 15 all "day"); only enclosed dark
space (block light 0, sky light blocked) spawns hostiles. Deaths respawn at world spawn
next to camp. Fleet stack: mineflayer 4.38, pathfinder 2.4.5, pvp, collectblock, tool,
auto-eat **3.3.6**, armor-manager, offline server MC 1.21.11.

Everything here is written to be implementable in `skills.js` / `runner.js` without new
dependencies. Local verifications were done against the installed `node_modules` on this box.

---

## 1. Threat model — exact mob mechanics (Java, current wiki)

### Spawning (the part that makes lighting cheap)

- Since 1.18, hostile mobs spawn **only at block light 0**. Any block light ≥ 1 makes a
  block spawn-proof, permanently, regardless of time of day.
  ([spawn-proofing calculator](https://www.minecraftmaps.com/tools/spawn-proofing-calculator),
  [1.18 spawning changes thread](https://www.minecraftforum.net/forums/minecraft-java-edition/recent-updates-and-snapshots/3126866-hostile-mob-spawning-has-changed-a-lot-in-1-18))
- Block light falls off 1 per block of **taxicab** distance. A torch (level 14) spawn-proofs
  every block within taxicab distance 13.
- **No hostile spawns within 24 blocks (spherical) of any player — and our bots ARE
  player entities.** The mob that kills a bot was never spawned next to it; it spawned
  ≥24 blocks away in the dark and **wandered in**. Lighting prevents spawns; it does not
  stop wander-ins. Sealing openings does.
- Immediate despawn beyond 128 blocks from the nearest player; random despawn eligibility
  beyond 32 blocks. A skeleton camped 10 blocks from a walled-in bot will NOT despawn —
  plan the wall-off exit accordingly (§4).

### Zombie ([wiki](https://minecraft.wiki/w/Zombie))

- Follow range **35 blocks** (base attribute 35 ± 5%, plus up to +150% from local
  difficulty). Sees the bot through its 35-block sphere on sight — far beyond the 16
  blocks most people assume. This is why the "dark low pocket" death happened with no
  warning at driver-poll cadence.
- Melee only, slower than a walking player. **Kiting works**: back away and swing
  (mindcraft's defendSelf pattern, §3). Baby zombies are sprint-speed — flee or corner them.
- Burns in sunlight only when the sun is above 15°. **Caution for this world**: with time
  frozen at day-0 *morning*, the sun may sit at/near the horizon — do not assume surface
  undead burn; they may persist indefinitely in the open. Field-verify once.

### Skeleton ([wiki](https://minecraft.wiki/w/Skeleton))

- Detection 16 blocks; starts shooting at **15 blocks with clear line of sight**; fires
  every 3s (2s on Hard); arrows 2–5 HP on Easy/Normal per hit.
- **Strafes to dodge and retreats to safe range if the target comes within 4 blocks**;
  sprints closer if ≥14 blocks away; if out of range it waits with drawn bow and fires the
  instant you re-enter range.
- When line of sight breaks it stops shooting and pathfinds toward you.
- Doctrine consequence: **kiting a skeleton is impossible and fleeing in the open is a
  40s death by chip damage (that's exactly the Bernd log). The only two valid answers are
  (a) break LOS immediately — two cobblestone or one corner is a full counter — or
  (b) rush with shield raised.** Never turn your back inside its 15-block firing sphere.

### Creeper ([wiki](https://minecraft.wiki/w/Creeper))

- Chases within 16 blocks. Fuse starts **within 3 blocks**, lasts **1.5s (30 ticks)**,
  and **aborts if the target gets ≥7 blocks away or LOS breaks** during the countdown.
  It explodes only if it keeps uninterrupted LOS for the entire 1.5s.
- Power 3 explosion (blast radius ≈ 4; lethal to unarmored at close range even on Normal).
- A shield **completely blocks** creeper explosion damage (wiki, Shield page) — and
  mineflayer-pvp already auto-raises the shield for 2s when its target is a primed creeper (§2).
- Doctrine: **never melee a creeper without a shield; never trade hits.** The cheap
  counter is distance — any move that puts 8+ blocks or a wall between you inside 1.5s
  cancels the fuse. PLAYBOOK's "retreat past 10m BEFORE engaging" rule stands; add:
  a creeper within 8 blocks preempts every other panic branch (§4).

### Shield ([wiki](https://minecraft.wiki/w/Shield))

- Blocks: all melee, arrows (incl. tipped/flaming), tridents, **explosions incl. creeper**,
  fireballs. Blocks knockback from melee/projectiles entirely.
- Coverage is a **horizontal semicircle in the facing direction** (pitch ignored) — the
  bot must `lookAt` the attacker for the block to count.
- Active **5 ticks (0.25s) after raising**; movement slows to sneak pace while raised.
- Durability: loses (attack strength, rounded up) per blocked hit ≥3 HP; 337 durability →
  ~100+ blocked arrows per shield. Craft: 6 planks + 1 iron ingot — one ingot per bot is
  the single highest-value survival ingot in the M2 budget.
- Axe shield-disable is a player-vs-player mechanic — irrelevant vs our mob threat model.
- Mineflayer usage (verified in [docs/api.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)):
  `await bot.equip(shieldItem, 'off-hand')`, raise with `bot.activateItem(true)` (true =
  off-hand), lower with `bot.deactivateItem()`. Face the attacker with
  `bot.lookAt(attacker.position.offset(0, attacker.height, 0))` first.

---

## 2. Combat stack we already ship — capabilities and gaps

### mineflayer-pvp (verified from [PVP.ts source](https://github.com/PrismarineJS/mineflayer-pvp/blob/master/src/PVP.ts))

- Defaults: `attackRange 3.0`, `followRange 2`, `viewDistance 128`,
  `meleeAttackRate = MaxDamageOffset` (honors the 1.9+ attack cooldown — full-charge swings).
- `attack(target)` sets a pathfinder `GoalFollow(target, followRange)` and swings whenever
  in `attackRange` and the cooldown timer has elapsed. Emits `startedAttacking`,
  `attackedTarget`, `stoppedAttacking` — AUTONOMY_PLAN step 3's mutex-release-on-
  `stoppedAttacking` stands.
- **Shield support is built in**: if a shield is equipped it lowers 100ms before each
  swing and re-raises 150ms after; if the target is a **primed creeper it raises the
  shield for 2s** instead of swinging.
- No strafing, no crits, no bow use, no target selection — caller picks the target.
- `stop()` waits for `path_stop` (5s timeout); `forceStop()` nulls immediately (can drop
  the bot mid-air — prefer `stop()` except in panic).
- Verdict vs our mobs: **fully adequate for zombies and rushing skeletons once a shield
  is in the off-hand**; the creeper handling is defensive only — pvp will happily walk a
  bot into fuse range, so target selection (§4) must filter creepers out.

### mineflayer-armor-manager ([README](https://github.com/PrismarineJS/MineflayerArmorManager))

- Auto-equips better armor as it enters inventory; manual sweep via
  `bot.armorManager.equipAll()` — call it **on every spawn event** (same place the safe
  Movements profile must be re-applied, FEEDBACK *Movements unsafe defaults* / TODO 5).
- Known bug (AUTONOMY_PLAN risk list): ranks chainmail above iron — patch the table in
  `node_modules/mineflayer-armor-manager/dist/data/armor.js` (one-line rank fix) or pin a
  postinstall patch. Otherwise a bot that picks up chainmail *downgrades* from iron.
- Armor doctrine (PLAYBOOK M2 80/20 stands, now safety-justified): iron chestplate first
  (best pts/ingot), then helmet (also stops sun-burn of… nothing here, but stops skeleton
  headshots same as any armor), shield before boots. FEEDBACK TODO 5: "kits lost to deaths
  cost more than armor" — confirmed by this shift's math: 3 deaths ≈ 3 kits + travel time.

### mineflayer-auto-eat 3.3.6 (verified locally in `node_modules/mineflayer-auto-eat/dist/index.js`)

- Options: `priority 'saturation'`, `startAt 16`, `eatingTimeout 3000`, `bannedFood`
  includes golden apples, **`offhand: true`**.
- `bot.autoEat.eat()` **refuses when `bot.food > startAt`** — a panic "top up to regen"
  cannot go through `autoEat.eat()` unless you temporarily bump `bot.autoEat.options.startAt`
  (do that: set to 20 inside panic, restore after).
- **Conflict found: `offhand: true` eats from/via the off-hand slot (slot 45) — the same
  slot the shield doctrine claims.** When shields land, set
  `bot.autoEat.options.offhand = false` fleet-wide or the eat and the shield will fight
  over slot 45.
- Regen mechanics for the wall-off branch: hunger ≥ 18 gives natural regen (~1 HP/4s);
  full hunger + saturation gives fast regen. A walled-in bot at 6 HP with cooked meat is
  back to fighting strength in under a minute.

### What's missing (build list)

1. **Target selection / hostile scan** — nothing in the stack watches `bot.entities`.
2. **Shield micro** — equip-to-offhand + face-attacker + raise; pvp handles the rest.
3. **Context-aware panic** — current `panicguard.js` is flee-home-only (§4 replaces it).
4. **Preflight kit checks** — doctrine only, not enforced (§5).
5. **Bow use** — skip. mineflayer-hawkeye exists but is unmaintained; our mobs die fine
   to iron sword + shield, and arrows-vs-skeleton is a losing trade for a bot that can
   place cobble.

---

## 3. Reactive safety architectures in the wild

### mindcraft's `modes.js` — the reference design ([source](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/modes.js), MIT, already slated for vendoring in AUTONOMY_PLAN step 6)

Priority-ordered list of always-on tick handlers; first mode wins; each mode declares which
running actions it may interrupt (`'all'` or specific labels). Their thresholds, verified
from source:

| Mode | Fires when | Action |
|---|---|---|
| `self_preservation` | drowning; falling onto sand/gravel; in lava/fire; **health < 5** or `lastDamageTaken >= health` within 3s | jump out of water; move away 2 from fall hazard; water-bucket for fire; **move away 20 blocks when dying** |
| `unstuck` | moved < 2 blocks for > 20s while tasked | `moveAway(bot, 5)`, 10s timeout, then kill the action |
| `cowardice` | hostile within **16** with clear path | `avoidEnemies(bot, 24)` |
| `self_defense` | hostile within **8** with clear path | `defendSelf(bot, 8)` |
| `item_collecting` / `torch_placing` / `hunting` | opportunistic | interrupt only follow-type actions |

Key implementation details from their `skills.js`
([source](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/library/skills.js)):

- `avoidEnemies`: `new GoalInvert(new GoalFollow(enemy, distance+1))` with
  `setGoal(goal, true)` (dynamic), re-evaluated every 500ms; if the enemy closes to ≤3 it
  throws one non-lethal `bot.attack` to buy knockback distance. **GoalInvert + GoalFollow
  is the canonical mineflayer flee primitive and pathfinder 2.4.5 has both (verified in
  `node_modules/mineflayer-pathfinder/lib/goals.js`).**
- `defendSelf`: loop over `getNearestEntityWhere(isHostile, range)`; equips highest
  `attackDamage` item (swords, then axes); `bot.pvp.attack(enemy)`; **kites melee mobs
  by switching goals — `GoalFollow(enemy, 3.5)` when ≥4 away, `GoalInvert(GoalFollow(enemy, 2))`
  when ≤2 away.**
- `isHostile(e)` ([mcdata.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/utils/mcdata.js)):
  `(e.type === 'mob' || e.type === 'hostile') && e.name !== 'iron_golem' && e.name !== 'snow_golem'`.
  Note: on recent protocol versions hostile mobs come through with `type: 'hostile'` —
  match both, and add a name allowlist for the mobs we actually care about (below).
- Their `shouldPlaceTorch` (world.js) does **not** read light — comment: *"TODO: check
  light level instead of nearby torches, block.light is broken"* — they fall back to
  "no torch within 6 blocks". See §6 for why our stack is better off but should keep the
  same fallback.
- The interrupt mechanism is the part worth stealing wholesale: modes run **in-process at
  tick speed** and interrupt the running skill by flag (`bot.interrupt_code`), exactly the
  gap our 50s driver polling loop leaves open. Our equivalent hook is `S.stop(reason)` +
  the task-engine's phase checks; a panic module must call that, not wait for a driver.

### Voyager — negative result worth recording

Voyager ([paper](https://arxiv.org/abs/2305.16291), [repo](https://github.com/minedojo/voyager))
has no reactive self-preservation layer at all — safety emerges (or doesn't) from
LLM-written skills plus curriculum retries; deaths are handled by reset. Its lesson for us
is the one we already run (skill library + iterative refinement), not survival. mindcraft
is the actionable prior art; nothing else in the ecosystem (checked during the plugin
survey prep) ships a maintained danger-sensing layer.

### Hazard sensing on our stack — verified facts

- **`bot.entities` is a wallhack.** The server streams every tracked entity within its
  tracking range (~48+ blocks) regardless of line of sight. A 4Hz scan of
  `Object.values(bot.entities)` sees the zombie in the sealed cavity *before* the bot digs
  into it. This is the single cheapest life-saver available and costs no packets (data is
  already client-side).
- **Light levels ARE readable on this stack** — unlike mindcraft's stack.
  Verified locally: mineflayer 4.38 parses `update_light` packets
  (`node_modules/mineflayer/lib/plugins/blocks.js:263` → `loadParsedLight`), and
  prismarine-chunk 1.18 `getBlock()` populates `block.light` and `block.skyLight`
  (`node_modules/prismarine-chunk/src/pc/1.18/ChunkColumn.js:113-118`). Engine v4's
  `autoTorch` light<8 trigger was live-verified on KloputzKarl. Two caveats: (a) values
  update only when the server pushes light packets — after placing a torch allow ~1-2s
  before re-reading; (b) the stale-chunk rule (LEARNING_HANDOFF / FEEDBACK
  *stale chunk data*) applies to light exactly as to blocks — only trust light reads near
  the bot. Keep the every-N-blocks interval fallback in autoTorch forever.
- **Line of sight**: `bot.world.raycast(eyePos, dirToTarget, distance)` (prismarine-world,
  present in our version) gives a cheap LOS check for the skeleton logic; mindcraft
  instead path-checks with `canDig=false` Movements, which is more expensive — use raycast.

### Danger score — spec

Single number, computed in-process at 4Hz (250ms, same cadence PLAYBOOK's GUARD spec uses),
exposed in `__skills.status` so drivers see it for free:

```js
const HOSTILE_WEIGHT = { creeper: 5, skeleton: 4, stray: 4, witch: 3.5,
  baby_zombie: 3.5, drowned: 2.5, zombie: 2.5, husk: 2.5, spider: 2,
  cave_spider: 3, enderman: 0.5, slime: 1, silverfish: 1, phantom: 3 };
function dangerScore(bot) {
  let score = 0, threats = [];
  const eye = bot.entity.position.offset(0, 1.62, 0);
  for (const e of Object.values(bot.entities)) {
    if (!e.position || !(e.type === 'hostile' || e.type === 'mob')) continue;
    const w = HOSTILE_WEIGHT[e.name]; if (!w) continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d > 24) continue;
    const los = hasLOS(bot, e) ? 1 : (e.name === 'skeleton' || e.name === 'stray' ? 0.3 : 0.6);
    const s = w * Math.max(0, (24 - d) / 24) * los;
    score += s; threats.push({ name: e.name, d: Math.round(d), s });
  }
  // situational multipliers
  if (bot.health < 10) score *= 1.5;
  if (bot.food < 6) score *= 1.25;
  if (bot.entity.position.y < 0) score *= 1.25;              // deep = far from help
  const feet = bot.blockAt(bot.entity.position);
  if (feet && feet.light === 0 && feet.skyLight === 0) score += 0.5; // in the dark
  return { score, threats };
}
```

Thresholds: `score >= 2.5` → **ALERT** (log line `danger`, equip weapon, face nearest
threat, raise shield if ranged threat has LOS; task keeps running); `score >= 5` **or
`bot.health < 8`** (the existing panicguard trigger) **or any creeper within 8** → **PANIC**
(§4). Hysteresis: leave ALERT below 1.5, leave PANIC only via the recovery exits in §4.
All constants in one exported table so field tuning is a one-line /eval.

---

## 4. Context-aware panic module — `survival.js` spec (replaces panicguard.js)

Design goals, from the three deaths: runs at game speed in-process (no driver in the
loop), picks the *right* escape per context (Bernd's death was the wrong escape), and is
engine-resident (auto-installed on spawn, FEEDBACK *auto-inject payload stack* +
*injection reports can drift* — both open).

### Entry

```
PANIC when: health < 8 (existing rule)  OR dangerScore >= 5  OR creeper within 8 blocks
Debounce: 10s re-entry lockout after a completed recovery (not 30s like panicguard v1 —
Marcel bled out in 8s; a lockout longer than time-to-die is a bug).
```

On entry, in order (each step try/catch, total < 1 tick):

1. `__skills.stop(bot, 'panic')` — kills the task engine's current task and queue pump.
2. `globalThis.__idleguard.stop()` — **NOT `pause()`**: FEEDBACK (open) documents that the
   stall-buster runs before the pause check and yanks goals during paused windows; a panic
   flee is exactly the slow, stuck-prone travel it would murder. Re-inject the guard on
   recovery. (When the engine fix for that entry lands, downgrade to `pause`.)
3. `bot.pvp.forceStop()`, `bot.collectBlock.cancelTask().catch(()=>{})`,
   `bot.pathfinder.setGoal(null)` — the ordered cleanup from AUTONOMY_PLAN step 3.
4. Take an owned goal token (FEEDBACK *orphaned goto promises*): every pathfinder call the
   panic module makes goes through one wrapper that `setGoal(null)`s on its own timeout
   losers, so panic can never poison post-recovery pathing.
5. One chat line (white, important): `"! HP x/20, <threat> at <dist> — <branch>"`.

### Decision tree (the core fix)

```
threat  = nearest entry in threats[] by s (score contribution)
home    = BASE.md anchor (config, not hardcoded like panicguard v1; default depot/plaza)
dHome   = |pos - home|  (3D)

BRANCH 0 — CREEPER OVERRIDE (any creeper within 8, regardless of HP):
    sprint-move directly away from the creeper to >= 10 blocks
    (fuse needs <3 to start, aborts at >=7 or LOS break; 10 gives margin).
    Movements tweak for this move only: allowSprinting = true.
    If cornered (no path gains distance in 1.5s): face creeper, raise shield
    (blocks 100% of blast), back into own tunnel if any. NEVER swing at it.
    Then re-evaluate tree.

BRANCH 1 — NEAR HOME (dHome <= 40 and threat is melee-only): FLEE_HOME
    allowSprinting = true temporarily; GoalNear(home, 2) via owned-token goto;
    zombies/spiders can't catch a sprinting player. On arrival: stand in lit
    plaza, face threat, shield up, let pvp finish anything that followed.

BRANCH 2 — RANGED ATTACKER WITH LOS (skeleton/stray/witch, any distance): BREAK_LOS
    Never turn back and run in the open (Bernd). Priority order:
    a. Corner within 4 blocks? (scan the 8 horizontal neighbors + known corridor
       geometry for a cell where raycast(threat -> cell) hits a solid) -> step there.
    b. Else WALL: face the threat, raise shield, then place 2 cobble as a
       1x2 pillar on the block between bot and threat (the "arrow shadow"):
       sneak-place against floor, then against the placed block. Cost: 2 blocks,
       ~0.5s, ends all incoming damage instantly.
    c. Then decide: HP >= 12 and sword+shield -> rush-and-kill around the wall
       (bot.pvp.attack; pvp handles shield lower/raise per swing); else fall
       through to BRANCH 3 wall-off behind the arrow shadow.

BRANCH 3 — FAR FROM HOME or HP < 6 or multiple threats: WALL_OFF ("coffin")
    see algorithm below; eat to full; regen; exit via opposite azimuth.

BRANCH 4 — environmental (lava/fire/drowning — port of mindcraft self_preservation):
    fire/lava: water bucket at feet if carried (PLAYBOOK mandates one below y-30;
    use lookAt + activateItem() per the bucket quirk in FEEDBACK — NOT activateBlock);
    else move away 5. Drowning: GoalY(surfaceY) / jump+forward.
```

### WALL_OFF algorithm (implementation-ready)

```
requires: >= 6 filler blocks (kit preflight §5 guarantees 16; if 0 filler, degrade
          to BREAK_LOS corner + flee along own corridor — and log kit_violation)
1. cell = feet block position (stay put — own tunnel floor is known-safe ground,
   never dig down, PLAYBOOK rule).
2. for each of the 4 horizontal faces of the FEET cell and 4 of the HEAD cell:
   if neighbor is not solid -> place filler against it (sneak not needed for
   blocks; use placeBlock ref-face pattern from skills.js). Skip faces where a
   solid already stands. Typical corridor cost: 2-4 blocks.
3. roof: if head+1 not solid -> place. (Skeletons shoot down staircases.)
4. verify sealed: all 10 faces solid (8 horizontal + roof + floor). If any face
   unplaceable (entity in the way = the mob itself): shield up facing it and
   place the remaining faces first; the last face is placed while shield-blocking.
5. eat: bot.autoEat.options.startAt = 20; await bot.autoEat.eat(); restore option.
   (3.3.6 eat() refuses above startAt — verified in dist source. If shield doctrine
   is live, options.offhand must already be false, §2.)
6. wait: poll health at 1Hz until health >= 16 AND food >= 18 (regen ~1 HP/4s,
   faster with saturation; worst case ~1 min from 6 HP).
7. exit: mobs do NOT despawn within 32 blocks — assume the threat is still there.
   Compute azimuth AWAY from last-known threat position; dig the wall face on
   that side (own placed cobble, instant-ish with any pick), step out, replace
   the block behind (1 block), then BRANCH 1 flee-home or resume-task decision
   is handed BACK to the driver via status: task.error = { code: 'panic_recovered',
   threat, branch, hpNow } — the driver decides resume vs abort. The engine only
   guarantees "alive and stable", not "job finished".
```

### Integration contract

- Lives in the engine (runner.js payload stack, auto-injected on every spawn —
  FEEDBACK *auto-inject payload stack on spawn*), enumerable via `GET /state` payload
  list (FEEDBACK *injection reports can drift*).
- Danger score + panic state (`calm | alert | panic:<branch>`) rides in `__skills.status`
  bot block, next to the requested `heldItem`/durability fields (FEEDBACK *tool durability
  invisible* — same status-block change, ship together).
- The idleguard patch list wraps setGoal/goto/dig/equip/craft/openContainer/activateBlock
  but **not `activateItem`** — shield raises won't register as external activity. Moot
  while panic stops the guard outright, but add `activateItem` to the patch list anyway
  for ALERT-state shield use outside panic.
- Movements: panic temporarily sets `allowSprinting=true` (flee is the PLAYBOOK-sanctioned
  sprint exception) and restores the safe profile after — and *verifies* it, given the
  documented silent-revert incident (FEEDBACK *Movements unsafe defaults*).
- ALERT state (pre-panic) is where pvp gets used offensively: a single melee-class threat
  closing in on a healthy, armed bot → `defendSelf`-style engage (equip best sword,
  `bot.pvp.attack`, mindcraft kite pattern for melee mobs only) rather than waiting for
  it to land the first hit. Creepers and ranged attackers are never valid pvp targets
  during auto-engage.

---

## 5. Deep-work kit preflight — `ctx.preflight(taskClass)` spec

Engine check, not doctrine (FEEDBACK *panic-retreat useless at depth*, fix line 2). Runs
inside `S.start` before the first phase of any task whose target leaves base radius
(>32 from BASE.md anchor) or goes underground. Fail-fast: return
`{ error: 'kit_missing', missing: [...] }` — never depart half-kitted; restock from depot
(chest B torches, GEAR chest kits per PLAYBOOK).

| Class | Trigger | Required kit |
|---|---|---|
| `excursion` (any task leaving base radius) | dist > 32 | ≥8 torches (user rule, FEEDBACK *universal torch preflight*), ≥2 food items and food ≥ 18 (PLAYBOOK), weapon (any sword) |
| `underground` (mineLane / safeDescend / target y < 40) | task class | everything above, plus: ≥16 torches, **2 pickaxes** (main + backup — Bernd's double tool loss), ≥16 filler blocks (cobble/dirt — the wall-off budget), ≥4 food |
| `deep` (target y < 0) | task class | everything above, plus: ≥40 torches, ≥8 food, armor worn (chestplate minimum, `armorManager.equipAll()` called), shield in off-hand, water bucket (PLAYBOOK y<-30 rule) |

Also at preflight: check role-tool durability > 20% (pairs with the status durability
field; FEEDBACK *tool durability invisible*) and warn `tool_low` — replacing a breaking
tool before departure is the memory rule "broken tool outranks the job" made mechanical.

---

## 6. Lighting automation — cheapest mob-proofing per block

### The math (1.18+ rules)

- Spawn-proof = block light ≥ 1. Torch = 14, taxicab falloff 1/block.
- **Corridor**: torches on the floor/wall every **N ≤ 24** keeps every floor block ≥ 1
  (midpoint at taxicab 12-13 from nearest torch; wall placement at head height adds ~1-2
  taxicab — use 20 for margin). Our current autoTorch `every=7` yields light ≥ 8
  everywhere — 3× more torches than spawn-proofing needs.
  - Recommendation: keep `every=7` (user rule, human aesthetic, and it doubles as the
    breadcrumb trail home) for **work faces and staircases**; allow a documented
    `every=13` profile for long transit corridors if torch economy ever pinches. At
    1 coal + 1 stick = 4 torches and 164 coal blocks censused, cost is a non-issue —
    do not spend engineering time optimizing below `every=7`.
- **Open room / quarry floor**: torch grid at **13-block spacing** (worst cell at taxicab
  ≤ 13 keeps ≥ 1); use 12 for margin near walls (walls force light to path around).
- Remember: spawning is only half the threat. **No spawns occur within 24 blocks of any
  bot anyway** — lighting protects the zone *beyond* the bot and the moments *after* it
  leaves. Wander-ins are stopped by geometry, not light.

### `lightSweep(radius)` — new skill spec (rule-of-twice candidate before it happens twice)

```
1. stand inside the zone (stale-chunk rule: only survey chunks you're in).
2. candidates = standable floor cells within radius (solid below, 2 air above)
   with blockAt(cell).light === 0   // real data on our stack, §3 verification
3. while candidates remain: greedy-pick the candidate covering the most other
   candidates within taxicab 12; goto + place torch (floor preferred, wall ok);
   wait 1.5s (server light packet settle); re-read and re-filter candidates.
4. result: { placed, remainingDark } — remainingDark > 0 means unplaceable cells
   (water, entity) — report, don't loop forever.
Fallback if light reads ever prove unreliable on some chunk (mindcraft's stack
gave up on block.light entirely and used "no torch within 6 blocks"): same
greedy loop keyed on torch-distance instead of light. Keep both paths.
```

### Work-zone mob-proofing procedure (doctrine + engine hooks)

1. **On breach of any cavity** (mineLane/safeDescend digs into air beyond the target
   block): before stepping through — `bot.entities` scan for hostiles within 16 of the
   opening (wallhack, free, §3). Hostiles present → wall the opening with 2 cobble and
   route around (or ALERT-engage if melee-class and healthy). No hostiles → place a torch
   just inside, then proceed. This is the exact Marcel-death counter.
2. **Seal every dark side-opening** the lane passes with 2 cobble; a sealed cave can't
   leak wander-ins. Log sealed coords to the task result for BASE.md.
3. **Shaft mouths get a door or fence gate** (zombies can't open doors on Normal;
   villager-door-breaking is Hard-only) — 2 planks…6 planks, one-time cost per shaft,
   registered in BASE.md so digguard protects it.
4. Torch the active face per autoTorch (already live, v4) and lightSweep any room-scale
   dig before calling the task done.

---

## 7. FEEDBACK.md mapping and build order

| FEEDBACK entry (all `open`) | This report |
|---|---|
| *promote panicguard into engine* | §4 replaces panicguard.js wholesale; auto-inject + /state enumeration |
| *panic-retreat useless at depth vs ranged attackers* | §4 BRANCH 2/3 (LOS break, wall-off+eat); §5 deep kit preflight |
| *pathfinder Movements spawn with unsafe defaults* | §4 integration (panic sprint exception + verify-and-restore); root fix stays TODO 5 |
| *universal torch preflight (user rule)* | §5 excursion class; §6 lightSweep + breach hook |
| *tool durability invisible in status* | §5 preflight durability gate; ship with the same status-block change as danger score |
| *auto-inject payload stack / injection reports can drift* | §4 integration contract — survival.js must be engine-resident, not injected |
| *__idleguard.pause() doesn't cover stall-buster* | §4 entry step 2 uses `stop()` not `pause()` until fixed |
| *orphaned goto promises poison later goals* | §4 entry step 4 owned goal token |
| *bucket fill/empty needs activateItem* | §4 BRANCH 4 fire/lava uses lookAt + activateItem() |
| *stale chunk data poisons remote surveys* | §6 lightSweep step 1 proximity rule; §3 light caveat |

**Suggested build order** (each step independently shippable, live-verifiable on the 3106
test bot):

1. **Danger scanner + status fields** (§3) — pure read, zero risk, immediately gives
   drivers eyes. ~80 lines.
2. **survival.js panic module** (§4) — the tick-speed reflex; test by spawning next to the
   known dark pocket. Depends on 1.
3. **Kit preflight** (§5) — pure check in `S.start`. ~40 lines.
4. **Shield doctrine** — craft 4 shields (4 iron ingots from the 41 waiting in furnace_1),
   `equip('off-hand')` in kit-up, set `autoEat.options.offhand=false`, patch armor-manager
   chainmail rank. pvp then handles creeper-shield and swing timing for free.
5. **Cavity-breach hook + lightSweep** (§6) — extends mineLane/safeDescend + one new skill.
6. **Vendored mindcraft modes port** (AUTONOMY_PLAN step 6) — after 1-5, port `unstuck` and
   `self_preservation` remainders into the same tick loop rather than as a second system.

---

## Sources

- mindcraft (MIT): [modes.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/modes.js) · [library/skills.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/library/skills.js) · [library/world.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/library/world.js) · [utils/mcdata.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/utils/mcdata.js)
- [mineflayer-pvp PVP.ts source](https://github.com/PrismarineJS/mineflayer-pvp/blob/master/src/PVP.ts) · [MineflayerArmorManager README](https://github.com/PrismarineJS/MineflayerArmorManager) · [mineflayer api.md (activateItem/deactivateItem/equip)](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- Minecraft Wiki: [Skeleton](https://minecraft.wiki/w/Skeleton) · [Creeper](https://minecraft.wiki/w/Creeper) · [Shield](https://minecraft.wiki/w/Shield) · [Zombie](https://minecraft.wiki/w/Zombie)
- Lighting/spawning: [Spawn-proofing calculator](https://www.minecraftmaps.com/tools/spawn-proofing-calculator) · [1.18 hostile spawning changes (Minecraft Forum)](https://www.minecraftforum.net/forums/minecraft-java-edition/recent-updates-and-snapshots/3126866-hostile-mob-spawning-has-changed-a-lot-in-1-18) · [mob spawning guide](https://gamertagmythras.com/blog/minecraft/minecraft-mob-spawning-guide)
- Voyager: [arXiv 2305.16291](https://arxiv.org/abs/2305.16291) · [github.com/minedojo/voyager](https://github.com/minedojo/voyager)
- Local verifications (this box): `node_modules/mineflayer/lib/plugins/blocks.js:263` (update_light parsing), `node_modules/prismarine-chunk/src/pc/1.18/ChunkColumn.js:113` (`block.light` populated), `node_modules/prismarine-world/src/worldsync.js:124` (`getBlockLight`), `node_modules/mineflayer-auto-eat/dist/index.js` (3.3.6 options/eat gate/offhand default), `node_modules/mineflayer-pathfinder/lib/goals.js` (GoalInvert/GoalFollow present), `/home/felix/minecraft/bots/panicguard.js`, `idleguard.js`, `skills.js` (autoTorch light read, line ~578)
