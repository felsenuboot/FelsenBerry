// survival v13 payload (inject via POST /eval, idempotent) — REPLACES panicguard.js.
//
// v13 (#115, TODO 5g item 4, eng-3's proposal, ack'd and implemented here): shelterBuild()
// fell through to a silent no-op (`no_viable_primitive`) whenever there was no filler for a
// hut AND diginStandable()'s full 3-deep column wasn't available — during a genuine spawn-camp
// (bot._spawnCamp.active, #116's shared bot-level flag) doing nothing is worse than partial
// cover. `diginDepth()` (0-3, partial credit sibling of diginStandable) + shelterDigIn(depth)
// add a last-resort branch, gated on the camp flag so an ordinary no-filler night still fails
// honestly as before. The cap/ring placement math in shelterDigIn needed NO change to support
// a shallower depth — it was already depth-independent (cap computed from the real post-dig
// feet position, ring references the undisturbed terrain around the single dug column at
// whatever absolute Y that lands, same either way) — see its own comment.
//
// v12 (#115, TODO 5f, run #6 death #1): branchWallOff used to defend against exactly ONE
// threat — whichever one dangerscan's own SCORE ranking handed pick() (a nearby creeper always
// outranks a nearby spider regardless of which is actually landing hits) — for its whole
// build+wait episode. A spider dangerscan had already detected the entire time landed the
// finishing hits, unnamed and undefended-against, because nothing downstream of pick() ever
// looked again. `nearestMeleeThreat()` (DISTANCE-sorted, not score) + branchWallOff's own
// `activeThreat`/`rescanMelee()` now re-derive the closest threat every cycle of both the
// placement and wait loops — see their own comments below. Live-confirmed 3x against real
// summoned zombies (FEEDBACK.md, 2026-09-03).
//
// v11 (#105, NIGHT-SHELTER): every branch above is a REACTION to a threat already engaged.
// Six survival-lane fixes in one day (#92/#94/#96/#98/#99/#100) all harden that reaction, and
// gear-race runs #1-#5 still died or nearly died at night every time (SCOREBOARD.md) because
// nothing upstream of combat ever considers NOT fighting. A human at wood/stone tier digs in
// at dusk instead. This adds `g.shelter` — a proactive, PRE-combat primitive pair, deliberately
// separate from the panic state machine above (REFLEX/POSTURE still sit above it in agenda's
// ladder and can always preempt): `shelterDigIn()` (dig 2 down, cap with the block just dug —
// free, no carried filler needed — torch inside, pillar back out) and `shelterHut()` (reuses
// branchWallOff's own 13-cell box-build below, proactively, no threat to face first). Exposed
// as `__survival.shelter.{should,enter,exit,status}` for agenda.js's own SHELTER rung (a
// separate lane, ack-before-edit) to drive. Trigger is real-night (`bot.time.isDay`) +
// surface-exposure + gear-tier. The ORIGINAL design (FEEDBACK.md, "NIGHT-SHELTER behavior
// design") argued for a light-LEVEL read specifically to avoid a clock dependency — live
// testing during this file's own fixture found that plan doesn't survive contact with this
// server's mineflayer client: `bot.blockAt(pos).light` reads a stuck 0 at noon AND at
// midnight (frozen, not day/night-reactive at all), and `.skyLight` reads a constant 15 in
// open sky regardless of time (it is static sky-EXPOSURE geometry, not brightness) — neither
// field answers "is it dark right now" on this world. `bot.time.isDay` is the one signal that
// updated correctly and immediately under a live `time set` both directions (see
// `isDaylight()`'s own comment below for the full trace). This still generalizes to
// cavecrew's frozen daylight exactly as intended: CAVECREW_HANDOFF.md pins it at MORNING, so
// `isDay` reads a constant `true` there and this correctly never fires — same outcome the
// light-based design wanted, carried by the signal that actually works when tested for real.
// Full design + this correction: FEEDBACK.md 2026-09-02 "NIGHT-SHELTER behavior design" and
// its live-fixture follow-up; tracker felsenuboot/FelsenBerry#105 (formerly felcrew-mcp).
//
// v10 (#100): standdown's arming was keyed to ONE branch's result (WALL_OFF + cannotHeal) --
// #99 found the identical shape reachable through a different early-return in the same branch,
// and #96's own live-mob verification found it reachable after FIGHT_BACK/FLEE_AWAY too (a
// fight's own sprint/combat exhaustion can dip food below the regen floor, not just #92's
// original starvation case). Re-keyed to a predicate -- threatsNow().length===0 && cannotHeal()
// -- so it arms regardless of which branch produced the outcome, with two exclusions found by
// walking every branch: ENV (branchEnv never verifies the hazard is actually gone, and it's the
// one class whose whole point is "nothing else matters") and FLEE_AWAY's own `cornered:true`
// (arming on a threatsNow()===0 reading right after the branch's own result says "did not
// actually get away" risks the exact dangerscan self-blinding #94 already documented).
//
// v9 (#96): a real fleet bot (RotzRudi, gear-race run #3) died three times in one melee encounter
// after its filler ran out mid-fight -- FLEE_HOME's melee path requires HP>=6, and once HP
// crossed that, pick() fell straight to branchWallOff with NO intermediate branch: a melee threat
// never reaches BREAK_LOS (that check is `ranged && los`-gated), so #94's corner-step fix never
// applies either. With no filler, branchWallOff's own no-filler check makes every call a
// synchronous no-op (measured: 20-30ms, the same sub-100ms fingerprint #94 found) while the
// attacker keeps landing real hits every cycle -- a genuinely representable "zero active defense"
// state in the routing table itself, not a bug in any one branch.
// Generalized doctrine (FEEDBACK.md 2026-09-02): "zero defense must be unrepresentable" --
// pick() must always reach a branch that can ACTUALLY act given current resources. Fix: pick()
// now verifies `fillerItem()` before choosing WALL_OFF at all when a real threat is present
// (same "verify before deferring" discipline as #94/#98, applied to the last-resort fallback
// itself) -- no filler falls through to two new branches instead: FIGHT_BACK (weapon held,
// threat already adjacent -- reuses BREAK_LOS's own counter-attack gate, deliberately WITHOUT
// its health floor, since the alternative here is guaranteed unopposed damage, not a safer
// option) or FLEE_AWAY (the absolute floor -- needs no inventory and no specific reachable
// target, generalizing branchCreeper's own proven GoalInvert/GoalFollow retreat to any threat).
// Corner-step-for-melee was considered and rejected: its whole value is breaking LINE OF SIGHT,
// which a melee attacker's pathfinding doesn't need and routes around in normal time -- the
// mechanism doesn't transfer, unlike FLEE_AWAY's genuine distance-gaining (sprint beats a
// zombie's walk).
//
// v8 (#98): pick()'s FLEE_HOME routing chose on straight-line distance to home alone -- terrain,
// water, or a cliff between here and home only surfaced after branchFleeHome had already
// committed up to 30s of ownedGoto to it, exposed the whole time. Same "unverified deferral is a
// disablement" shape as #94 (composition-rot doctrine, FEEDBACK.md 2026-09-02), just a different
// branch deferring to a different fallback. Fixed by gating the routing decision on
// S.reachOf(bot, g.home) (skills.js's own proven _reachOf probe, exposed for exactly this reuse,
// v59) before committing -- unreachable falls through to WALL_OFF, the next thing pick() would
// try anyway, instead of burning the full 30s find out. Fails open (treats home as reachable) if
// skills.js isn't installed, matching this file's existing optional-payload degradation posture.
//
// v7 (#94): BREAK_LOS's corner-step search skips itself under critical HP on the assumption
// that arrow-shadow/counter-attack/WALL_OFF cover the gap faster (the #65 fix below). That
// assumption silently breaks the instant the bot carries no filler blocks: arrow-shadow's and
// WALL_OFF's own placeAt() calls both open with a synchronous no-filler check and return
// near-instantly, counter-attack gates on HP>=rushHp (already false), and corner-step never
// got a real search. Measured, not guessed at: 593 real panic cycles across 5 live encounters
// (#94's own recorded runs) show 99% resolving in <100ms (median 31-36ms) -- far faster than
// any real goto/placeBlock round-trip, meaning every phase was short-circuiting. A bot with no
// filler got LITERALLY ZERO seconds of active defense once HP crossed the critical threshold,
// for as long as the fight lasted, re-diagnosing the identical undefended situation every
// ~200-250ms while taking real, unopposed damage each cycle. Fix: only skip corner-step under
// critical HP when a filler-based fallback can actually catch it -- corner-step needs no
// inventory at all, so it should never be the thing sacrificed when supplies are the problem.
// Byte-for-byte identical behavior for any kitted bot (the common case).
//
// v6 (#92): WALL_OFF's only exit was "healed" (HP>=regenHp AND food>=regenFood), timeboxed
// to 60s. If food is stuck below the regen threshold with nothing left to eat, "healed" can
// never become true — the branch just burns the full 60s every time, digs out, and then the
// 'hp' health-listener backstop (critical HP correctly bypasses the re-entry lockout, #65)
// re-triggers on the very next food/health tick and reseals from scratch. Live-observed: 26
// identical cycles over 25m44s, zero self-exit, DNF. Fixed at two levels: (1) branchWallOff
// now exits as soon as (threat-clear AND (healed OR cannot-heal)), not just on "healed" —
// cannot-heal is food<regenFood with no food item carried, checked via the same FOODS list
// skills.js's kit gate uses; (2) orchestration-level g.standdown remembers a diagnosed
// cannot-heal-and-threat-clear outcome so the SAME unresolved condition doesn't re-seal on
// every subsequent tick — any genuine change (HP actually drops, or a live threat reappears)
// clears it immediately and is handled for real, same as always; a 10-minute hard expiry
// re-checks anyway so this can never go silent forever. Also: a one-shot sweepNearbyFood()
// attempt right at the cannot-heal exit, since the general skills.js health guard correctly
// blocks combat-adjacent risk but also blocked the harmless act of grabbing a food drop two
// blocks away — exactly the thing that would resolve the deadlock on its own.
//
// v5 (#65): four fixes from one live-testing session against real mobs, all in the
// survival/don't-get-stuck path the acceptance soak depends on:
//  1. BREAK_LOS's counter-attack sub-branch was chasing a kiting skeleton across open
//     ground with the shield down for up to 15s, only breaking off after HP had already
//     fallen 4 points below the gate. Restricted to "threat already at melee reach, no
//     closing a gap in the open" (the FLEE_HOME "Bernd death" lesson, run in reverse).
//  2. The corner-step search (BREAK_LOS phase a) gave every qualifying offset its own
//     full 4000ms goto with NO overall budget -- fine in the open, but inside anything
//     enclosed several of the 8 offsets can all break LOS off nearby walls, and the loop
//     tried each in turn: up to 32s fully exposed with g.active blocking everything else.
//     Reproduced live: stuck on 'deciding' for 22s while HP went 11.6 -> dead. Now has a
//     hard overall search deadline and yields early on critical HP.
//  3. The 10s re-entry lockout could gag the critical-HP backstop mid-encounter: a
//     re-trigger landing inside the lockout window was silently dropped even at HP < 8,
//     which is exactly the situation the backstop exists for. Critical HP now bypasses it.
//  4. branchWallOff ran its ~12-cell placement sequence with zero shield and zero HP
//     check -- live-traced a bot going 6 HP -> dead DURING construction. Now holds the
//     shield throughout, prioritises the threat-facing side, and bails on non-essential
//     cells once HP crosses a critical floor instead of marching the list to the end.
//
// The tick-speed survival reflex from research/survival-doctrine.md section 4. panicguard
// had exactly one answer to everything ("run home"), which is why BuddelBernd died: it
// fled 150 blocks up a corridor with a skeleton shooting it in the back. This module picks
// the RIGHT escape for the situation:
//
//   ENV        lava / fire / drowning            -> get out first, nothing else matters
//   CREEPER    creeper within 8                  -> open 10+ blocks (fuse aborts at 7), never swing
//   BREAK_LOS  skeleton/stray/witch with LOS     -> corner-step or 2-cobble "arrow shadow";
//                                                   fleeing a ranged mob in the open is the Bernd death
//   FLEE_HOME  home <= 40 away, melee-only, reachable -> sprint home, turn and hold with shield
//   WALL_OFF   far / low HP / mixed threats, has filler -> seal a coffin, eat to 18, regen, dig out
//   FIGHT_BACK no filler, threat already adjacent, weapon in hand -> swing back, no HP floor
//   FLEE_AWAY  no filler, no fight worth taking      -> the floor: sprint away, no target needed
//
// Entry: __danger state -> 'panic' (score >= 5, or HP < 8, or creeper within 8), with a
// health-listener backstop if dangerscan.js is not installed. 10s re-entry lockout — NOT
// panicguard's 30s, which was longer than MettMarcel's 8s time-to-die.
//
// Idle-guard handling improves on the doctrine: instead of __idleguard.stop() + re-inject
// (the spec's workaround for the stall-buster ignoring pause()), we hold __idleguard.busy
// = true. In idleguard v4 the timer checks `if (g.busy) return` BEFORE the stall-buster,
// so this suspends the WHOLE guard, needs no re-injection, and reverses in one assignment.
//
// Requires: dangerscan.js (strongly recommended), skills.js (optional), digguard.js
// (optional but keeps wall-off from mining someone's house). Inject AFTER dangerscan.
// Remove: __survival.restore()
if (globalThis.__survival && globalThis.__survival.restore) { try { globalThis.__survival.restore(); } catch (e) {} }

const fs = process.mainModule.require('fs');
const nodePath = process.mainModule.require('path');
const CFG_FILE = nodePath.join(nodePath.dirname(process.mainModule.filename), 'protected.json');

const readHome = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    if (Array.isArray(raw.home) && raw.home.length === 3) return { x: raw.home[0], y: raw.home[1], z: raw.home[2] };
  } catch (e) {}
  return { x: -3, y: 111, z: 4 };
};

const g = {
  enabled: true, version: 13,
  home: readHome(),
  active: false, branch: null, lastBranch: null, lastEvent: null,
  fires: 0, recovered: 0, failures: 0, lastEnd: 0, startedAt: 0,
  standdown: null,       // #92: {since, hp} once a cannot-heal/threat-clear outcome is diagnosed
  cfg: {
    lockoutMs: 10000,     // re-entry lockout after a completed recovery
    hpPanic: 8,           // backstop trigger when dangerscan is absent
    fleeHomeMax: 40,      // FLEE_HOME only inside this radius
    creeperClear: 10,     // open this much space from a creeper (fuse aborts at 7)
    rushHp: 12,           // BREAK_LOS may counter-attack at/above this HP
    meleeReach: 4,        // ...and only if the threat is ALREADY this close (#65: no chasing)
    regenHp: 16,          // wall-off waits for this HP...
    regenFood: 18,        // ...and this food (natural regen needs >= 18)
    maxRunMs: 90000,      // hard cap on one panic run
    standdownMaxMs: 600000, // #92: force a fresh re-check at least this often, never silent forever
    // #105 NIGHT-SHELTER
    shelterHutFiller: 10,   // >= this many carried filler blocks -> hut; below -> dig-in
    shelterMaxWaitMs: 900000, // #92/#65-style hard expiry: never wait silent-forever on a wrong signal
  },
  filler: ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite', 'granite', 'netherrack'],
  shelter: { active: false, kind: null, since: 0, exitRequested: false, exitReason: null, extraFiller: [] },
};
globalThis.__survival = g;

const AIR = new Set(['air', 'cave_air', 'void_air']);
const HAZARD = new Set(['lava', 'fire', 'soul_fire', 'campfire', 'soul_campfire', 'magma_block']);
// #92: same canonical list as skills.js's own kit-gate FOODS (duplicated locally, matching
// this file's own established pattern of not cross-requiring another independently-injected
// payload — see `filler` above, which duplicates skills.js's FILLERS the same way).
const FOODS = new Set(['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato', 'apple', 'golden_apple',
  'enchanted_golden_apple', 'carrot', 'beetroot', 'melon_slice', 'sweet_berries', 'glow_berries',
  'cookie', 'pumpkin_pie', 'mushroom_stew', 'beetroot_soup', 'rabbit_stew', 'dried_kelp']);

const pushLog = (lvl, msg) => {
  try {
    const S = globalThis.__skills;
    if (!S || !Array.isArray(S.log)) return;
    S._seq = (S._seq || 0) + 1;
    S.log.push({ seq: S._seq, lvl, msg: String(msg).slice(0, 200) });
    if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
  } catch (e) {}
};
const say = (msg) => { try { bot.chat(msg); } catch (e) {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

// ---- owned goal token: a timed-out goto can never clear a LATER goal ----
let gotoGen = 0;
const ownedGoto = (goal, ms) => {
  const gen = ++gotoGen;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      if (gen === gotoGen) { try { bot.pathfinder.setGoal(null); } catch (e) {} }
      finish('timeout');
    }, ms);
    try {
      bot.pathfinder.goto(goal).then(() => finish('arrived')).catch((e) => finish('err:' + (e && e.message)));
    } catch (e) { finish('err:' + e.message); }
  });
};

// ---- idle-guard suspension (see header) ----
let guardTimer = null;
const suspendGuard = () => {
  const ig = globalThis.__idleguard;
  if (!ig) return false;
  ig.busy = true;
  if (guardTimer) clearInterval(guardTimer);
  guardTimer = setInterval(() => { try { if (globalThis.__idleguard) globalThis.__idleguard.busy = true; } catch (e) {} }, 1000);
  return true;
};
const resumeGuard = () => {
  if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
  try { if (globalThis.__idleguard) { globalThis.__idleguard.busy = false; globalThis.__idleguard.lastExternal = Date.now(); } } catch (e) {}
};

// ---- gear helpers ----
const findItem = (pred) => bot.inventory.items().find(pred);
const bestSword = () => findItem((i) => /_sword$/.test(i.name)) || findItem((i) => /_axe$/.test(i.name));
// #105: `g.shelter.extraFiller` — block names dug by `shelterDigIn` on THIS shelter session
// that aren't in the fixed `g.filler` list above (e.g. terracotta, sand: live-caught during
// this feature's own fixture on badlands terrain — the "the block just dug IS the cap
// material" design point is only true when that block happens to already be in `g.filler`;
// terracotta isn't). Empty outside an active shelter session, so this is a no-op for
// WALL_OFF/BREAK_LOS/every other `fillerItem()` caller the rest of the time.
const fillerNames = () => g.filler.concat(g.shelter.extraFiller || []);
const fillerItem = () => { for (const n of fillerNames()) { const it = findItem((i) => i.name === n); if (it) return it; } return null; };
const fillerCount = () => { const names = fillerNames(); return bot.inventory.items().reduce((n, i) => n + (names.includes(i.name) ? i.count : 0), 0); };
const torchItem = () => findItem((i) => i.name === 'torch');
// #92: "cannot heal" — hunger is below the natural-regen floor AND there is nothing left to
// eat to raise it. Distinct from "hasn't healed yet" (which just needs more time/food).
const hasFoodItem = () => bot.inventory.items().some((i) => FOODS.has(i.name));
const cannotHeal = () => bot.food < g.cfg.regenFood && !hasFoodItem();

// #105: same tier order as skills.js's own TIER_RANK (skills.js:1623) — duplicated locally,
// same established pattern as `filler`/`FOODS` above (this file never cross-requires another
// independently-injected payload). Only weapon + worn armor matter for "can this bot fight
// through a night" — tools (pickaxes) don't help in combat.
const GEAR_TIER_RANK = { netherite: 6, diamond: 5, iron: 4, stone: 3, copper: 2.5, golden: 2, wooden: 1 };
const gearTierOf = (name) => GEAR_TIER_RANK[String(name || '').split('_')[0]] || 0;
const gearTier = () => {
  let best = 0;
  const weapon = bestSword();
  if (weapon) best = Math.max(best, gearTierOf(weapon.name));
  for (const slot of [5, 6, 7, 8]) { // the 4 armor slots (helmet/chestplate/leggings/boots, mineflayer's fixed indices)
    const it = bot.inventory.slots[slot];
    if (it) best = Math.max(best, gearTierOf(it.name));
  }
  return best;
};

// #105: dangerscan's own geometry-backed `state`/`surfaceExposed` (globalThis.__danger —
// same object threatsNow() below already reads), degrading to nulls when dangerscan isn't
// installed — same optional-payload posture as everywhere else in this file.
const readDanger = () => {
  const d = globalThis.__danger;
  return { state: d ? d.state : null, surfaceExposed: d ? d.surfaceExposed : null };
};
// #105: NOT a light-level read, despite the original design (FEEDBACK.md, "NIGHT-SHELTER
// behavior design") arguing for exactly that. Live-verified during this feature's own fixture
// (ShltrQA, 2026-09-02, real local server) that BOTH of mineflayer's exposed light fields are
// unusable here: `bot.blockAt(pos).light` reads a stuck 0 in broad daylight AND at night (a
// frozen/uninitialized value, not day/night-reactive at all — a different, harsher bug than
// basekeeping.js's documented #17), and `.skyLight` reads a constant 15 in an open-sky column
// REGARDLESS of time of day (confirmed via RCON `time set` both ways plus a fresh relog each
// time to rule out a stale cache) — it is the static "how exposed to open sky is this column"
// geometry value, not a time-varying brightness. Neither field answers "is it dark right now".
// `bot.time.isDay` DID update correctly and immediately on every `time set` tested (day, night,
// and back) — this file falls back to it as the only signal that actually works. This still
// satisfies the "not hard-coded per server" requirement in practice: CAVECREW_HANDOFF.md's own
// frozen daylight is pinned at MORNING (line 5, "frozen morning daylight"), so `isDay` reads a
// constant `true` there and this correctly never fires — the same generalization the original
// design wanted from a light read, just carried by the one signal that was actually reliable
// when tested against the real server. `surfaceExposed` (dangerscan's geometry-backed field)
// still does the exposure gating, unaffected by this — only the darkness signal changed.
const isDaylight = () => { try { return bot.time ? Boolean(bot.time.isDay) : null; } catch (e) { return null; } };

const shieldUp = async (ent) => {
  try {
    const sh = findItem((i) => i.name === 'shield');
    const off = bot.inventory.slots[45];
    if (!sh && !(off && off.name === 'shield')) return false;
    // auto-eat 3.3.6 defaults offhand:true and fights the shield over slot 45
    try { if (bot.autoEat && bot.autoEat.options) bot.autoEat.options.offhand = false; } catch (e) {}
    if (sh && !(off && off.name === 'shield')) await bot.equip(sh, 'off-hand');
    if (ent && ent.position) await bot.lookAt(ent.position.offset(0, Math.min(ent.height || 1.8, 1.8), 0));
    bot.activateItem(true);
    return true;
  } catch (e) { return false; }
};
const shieldDown = () => { try { bot.deactivateItem(); } catch (e) {} };

const eatUp = async () => {
  try {
    if (!bot.autoEat || bot.food >= 20) return false;
    const prev = bot.autoEat.options.startAt;
    try {
      bot.autoEat.options.startAt = 20;   // 3.3.6 eat() refuses above startAt
      await bot.autoEat.eat();
      return true;
    } finally { bot.autoEat.options.startAt = prev; }
  } catch (e) { return false; }
};

// ---- placement (verify-on-timeout: a blockUpdate timeout usually means it DID place) ----
const FACES = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
// SOLID, not "not air". leaf_litter/short_grass/torch/snow all have an EMPTY bounding box:
// they stop neither arrows nor mobs. Treating them as occupied (v1 did) left holes in the
// coffin AND reported it sealed — same zero-shape-block trap as the pathfinder wedges.
const isSolid = (b) => Boolean(b && b.boundingBox === 'block');
const placeAt = async (pos) => {
  try {
    const at = bot.blockAt(pos);
    if (!at) return 'unloaded';
    if (isSolid(at)) return 'occupied';
    const item = fillerItem();
    if (!item) return 'no_filler';
    // clear a passable non-air block first (leaf_litter, grass); not all are replaceable
    if (!AIR.has(at.name)) { try { await bot.dig(at); } catch (e) {} }
    if (!bot.heldItem || bot.heldItem.name !== item.name) await bot.equip(item, 'hand');
    for (const f of FACES) {
      const ref = bot.blockAt(pos.offset(f[0], f[1], f[2]));
      if (!isSolid(ref)) continue;
      try {
        await bot.placeBlock(ref, new Vec3(-f[0], -f[1], -f[2]));
        return 'placed';
      } catch (e) {
        const now = bot.blockAt(pos);
        if (now && !AIR.has(now.name)) return 'placed';   // false timeout
      }
    }
    return 'no_reference';
  } catch (e) { return 'err:' + e.message; }
};

// ---- LOS helper ----
const losBlocked = (fromEye, toEye) => {
  try {
    const dir = toEye.minus(fromEye);
    const d = dir.norm();
    if (d < 0.5) return false;
    return Boolean(bot.world.raycast(fromEye, dir.scaled(1 / d), d));
  } catch (e) { return false; }
};

const threatsNow = () => {
  const d = globalThis.__danger;
  if (d && Array.isArray(d.threats)) return d.threats;
  return [];
};
const entOf = (t) => (t && t.id != null ? bot.entities[t.id] : null);

// #115 (run #6 death #1, 2026-09-03, test-driver): threatsNow() is dangerscan's own list
// SORTED BY SCORE (weight*proximity*LOS) -- exactly right for "what should decide the branch"
// (pick()'s own use of ts[0]), exactly wrong for "what is close enough to be hitting me right
// now". A creeper (weight 5, plus the close-range escalation in dangerscan's scan()) ranks
// ts[0] over a spider (weight 2) at the same or even closer distance every time -- so a
// single-threat branch built around ts[0]/`t` never sees the spider at all, even though
// dangerscan's own 4Hz scan already has it in threats[]. This is the DISTANCE-sorted view of
// the SAME list: for melee defense, proximity is the only thing that matters. Creepers are
// excluded unless nothing else qualifies -- a lone close creeper is branchCreeper's distance
// problem (RUN, never swing), not something WALL_OFF's shield/counter-attack should target.
const nearestMeleeThreat = (maxD) => {
  const ts = threatsNow().filter((x) => x.d <= maxD);
  if (!ts.length) return null;
  const nonCreeper = ts.filter((x) => x.name !== 'creeper').sort((a, b) => a.d - b.d);
  if (nonCreeper.length) return nonCreeper[0];
  return ts.slice().sort((a, b) => a.d - b.d)[0];
};

// ================= BRANCHES =================

// ENV — checked first: standing in lava kills faster than any mob.
const envHazard = () => {
  try {
    const p = bot.entity.position;
    const feet = bot.blockAt(p), head = bot.blockAt(p.offset(0, 1, 0));
    if (feet && HAZARD.has(feet.name)) return feet.name;
    if (head && HAZARD.has(head.name)) return head.name;
    // #65: bot.oxygenLevel is not a reliable "am I actually drowning" signal on its own —
    // live-traced it reading 15 (not the max 20) while bot.entity.isInWater was false and
    // the bot was standing on dry ground. envHazard() is checked FIRST in pick(), ahead of
    // every combat branch, so a stale/untracked oxygen value spuriously took over from a
    // real skeleton attack: the bot tried to "surface" (swim up 6 blocks) through a solid
    // ceiling while the actual threat kept hitting it, unaddressed, for the seconds that
    // wasted. Require actual submersion before trusting the number.
    if (typeof bot.oxygenLevel === 'number' && bot.oxygenLevel <= 5
        && (bot.entity.isInWater || (head && head.name === 'water'))) return 'drowning';
    return null;
  } catch (e) { return null; }
};

const branchEnv = async (hazard) => {
  say('! ' + hazard + ' - getting out of this first.');
  if (hazard === 'drowning') {
    try {
      bot.setControlState('jump', true);
      const surfaceY = Math.floor(bot.entity.position.y) + 6;
      await ownedGoto(new goals.GoalY(surfaceY), 8000);
    } finally { try { bot.setControlState('jump', false); } catch (e) {} }
    return { branch: 'ENV', hazard, note: 'surfaced' };
  }
  // fire/lava: water bucket if carried (lookAt + activateItem — activateBlock silently no-ops)
  const bucket = findItem((i) => i.name === 'water_bucket');
  if (bucket) {
    try {
      await bot.equip(bucket, 'hand');
      await bot.lookAt(bot.entity.position.offset(0, -1, 0));
      bot.activateItem();
      await sleep(400);
    } catch (e) {}
  }
  const p = bot.entity.position;
  await ownedGoto(new goals.GoalNear(Math.floor(p.x) + 5, Math.floor(p.y), Math.floor(p.z) + 5, 1), 8000);
  return { branch: 'ENV', hazard, usedBucket: Boolean(bucket) };
};

// BRANCH 0 — creeper override. Distance is the whole counter; never swing.
const branchCreeper = async (t) => {
  const ent = entOf(t);
  say('! Creeper at ' + t.d + ' blocks - backing off, do NOT touch it.');
  const mv = bot.pathfinder.movements;
  const prevSprint = mv ? mv.allowSprinting : null;
  try {
    if (mv) { mv.allowSprinting = true; bot.pathfinder.setMovements(mv); }
    if (ent) {
      try { bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(ent, g.cfg.creeperClear + 1)), true); } catch (e) {}
    }
    const t0 = Date.now();
    let best = t.d;
    while (Date.now() - t0 < 6000) {
      await sleep(250);
      const live = entOf(t);
      if (!live || !live.position) break;                       // despawned / died
      const d = dist(bot.entity.position, live.position);
      if (d > best) best = d;
      if (d >= g.cfg.creeperClear) break;
      // cornered: no distance gained in 1.5s -> shield is the only remaining counter
      if (Date.now() - t0 > 1500 && d <= t.d + 0.5) { await shieldUp(live); }
    }
    const live = entOf(t);
    return { branch: 'CREEPER', gained: Math.round((live && live.position ? dist(bot.entity.position, live.position) : best) * 10) / 10 };
  } finally {
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    shieldDown();
    if (mv && prevSprint !== null) { mv.allowSprinting = prevSprint; try { bot.pathfinder.setMovements(mv); } catch (e) {} }
  }
};

// BRANCH 2 — ranged attacker. Break line of sight; never turn and run in the open.
const branchBreakLOS = async (t) => {
  const ent = entOf(t);
  say('! ' + t.name + ' shooting from ' + t.d + ' - breaking line of sight.');
  await shieldUp(ent);
  const p = bot.entity.position;
  const feet = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const tEye = ent && ent.position ? ent.position.offset(0, 1.4, 0) : null;

  // (a) step to a neighbouring cell the threat cannot see into. #65 (found live, the
  // dangerous way): this used to give EVERY qualifying offset its own full 4000ms
  // ownedGoto with no overall budget. That's fine in the open, where usually zero or one
  // offset has a wall nearby to duck behind -- but inside anything enclosed (a room, a
  // tunnel junction, the exact terrain WALL_OFF and corridors put the bot in), several of
  // the 8 offsets can all legitimately break LOS off nearby walls, and the loop would try
  // each one in turn: up to 8 x 4000ms = 32s, fully exposed, with `g.active` still true
  // the entire time so NOTHING else -- not even the critical-HP backstop -- can step in.
  // Reproduced live: __survival.branch stuck on 'deciding' for 22s solid while HP went
  // 11.6 -> dead. A hard overall deadline plus a per-attempt HP check bounds the worst
  // case and guarantees the search itself yields to phase (b)/(c) instead of silently
  // consuming the whole encounter.
  if (tEye) {
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const searchDeadline = Date.now() + 3000;      // total budget for ALL attempts combined
    for (const o of offs) {
      if (Date.now() > searchDeadline) break;
      // #94: only skip the search if a filler-based fallback (arrow-shadow / WALL_OFF) can
      // actually catch it -- both open with the identical no-filler check and return near-
      // instantly without one, so "stop searching, go defend" was silently "stop searching,
      // do nothing" for a bot with no cobblestone. Corner-step needs no inventory at all; it
      // should never be the thing sacrificed when supplies are the problem.
      if (bot.health > 0 && bot.health < g.cfg.hpPanic && fillerItem()) break;   // stop searching, go defend
      const cell = feet.offset(o[0], 0, o[1]);
      const at = bot.blockAt(cell), above = bot.blockAt(cell.offset(0, 1, 0)), below = bot.blockAt(cell.offset(0, -1, 0));
      if (!at || !above || !below) continue;
      if (isSolid(at) || isSolid(above) || !isSolid(below)) continue;  // leaf_litter is walkable
      if (!losBlocked(tEye, cell.offset(0.5, 1.6, 0.5))) continue;
      const perAttempt = Math.max(600, Math.min(1500, searchDeadline - Date.now()));
      const r = await ownedGoto(new goals.GoalBlock(cell.x, cell.y, cell.z), perAttempt);
      if (r === 'arrived') {
        // #65 (eng-2 + team-lead's lead): this used to return success the instant the
        // goto landed, on the strength of a LOS check done against `tEye` -- the
        // THREAT'S POSITION AT FUNCTION ENTRY, before any of the travel time above. A
        // real skeleton repositions to hold a sightline; by the time a ~1s move lands,
        // the prediction that got it picked can simply be wrong. BREAK_LOS's entire job
        // is captured in its name, so "arrived at the cell that was predicted to work"
        // is not the same claim as "line of sight is actually broken" -- re-read the
        // world instead of trusting the plan. Same shape as the false-success-root
        // doctrine elsewhere in this codebase: a verifier (here, the branch's own return
        // value) that checks the manoeuvre happened instead of the outcome it exists to
        // produce.
        const liveT = entOf(t);
        const stillBlocked = !liveT || !liveT.position
          || losBlocked(bot.entity.position.offset(0, 1.62, 0), liveT.position.offset(0, 1.4, 0));
        if (stillBlocked) {
          return { branch: 'BREAK_LOS', how: 'corner', cell: [cell.x, cell.y, cell.z] };
        }
        break; // prediction was wrong and the bot has now moved -- the rest of `offs` is
               // relative to a stale origin, so stop guessing and fall through to (b)/(c)
               // against the bot's REAL current position instead of compounding the error.
      }
    }
  }

  // (b) arrow shadow: a 1x2 filler pillar on the cell between bot and threat. Re-reads
  // the bot's position fresh rather than reusing `p`/`feet` from function entry -- #65:
  // those are stale the moment phase (a) has moved the bot at all (including a failed
  // attempt above), and building "between bot and threat" from the WRONG bot position
  // places the wall somewhere that doesn't correspond to where the bot actually is.
  const p2 = bot.entity.position;
  const feet2 = new Vec3(Math.floor(p2.x), Math.floor(p2.y), Math.floor(p2.z));
  let placed = 0;
  if (ent && ent.position) {
    const dx = ent.position.x - p2.x, dz = ent.position.z - p2.z;
    const step = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
    for (const dy of [0, 1]) {
      const r = await placeAt(feet2.offset(step[0], dy, step[1]));
      if (r === 'placed') placed++;
    }
  }
  if (placed) say('Cobble wall up - that is my arrow shadow.');
  // Same false-success risk as phase (a): blocks landing does not by itself mean the
  // sightline is actually interrupted (wrong side, threat already stepped around it,
  // or only one of the two cells took). Verify before reporting a bare "wall" success.
  if (placed) {
    const liveT2 = entOf(t);
    const wallBlocksLOS = !liveT2 || !liveT2.position
      || losBlocked(bot.entity.position.offset(0, 1.62, 0), liveT2.position.offset(0, 1.4, 0));
    if (!wallBlocksLOS) pushLog('warn', 'break_los: arrow-shadow placed but LOS still open — threat likely repositioned');
  }

  // (c) counter-attack — ONLY if the threat is ALREADY at melee reach right now. This used
  // to gate on nothing but HP + sword + `placed`, which let it chase a kiting skeleton
  // across open ground for up to 15s with the shield DOWN the entire time (shieldDown()
  // ran unconditionally before the loop, and the break-off check only fired after health
  // had already fallen 4 points below the gate). Real skeleton AI backs off to hold its
  // preferred shooting range, so "closing the distance" on one in the open is the exact
  // same mistake the header calls out for FLEE_HOME ("fleeing a ranged mob in the open is
  // the Bernd death") run in reverse — and it's what actually put the bot at 0.67 HP twice
  // in #65's live testing despite the branch reporting a clean recovery. Gating on live
  // proximity means there is no gap to close: either it's already close enough that a swing
  // costs no extra exposure, or we skip straight to the wall it already has half-built.
  // (engine-dev, 2026-09-01, issue #65.)
  const sword = bestSword();
  const live = entOf(t);
  const liveDist = live && live.position ? dist(bot.entity.position, live.position) : Infinity;
  // `t.name !== 'creeper'` is defence in depth, not redundancy. pick() dispatches creepers
  // to branchCreeper before BREAK_LOS can ever see one, so today this is unreachable — but
  // that safety lives entirely in a DIFFERENT function, and the failure mode here is a bot
  // walking into fuse range with a sword. One condition is cheaper than that outcome, and it
  // keeps the guarantee local to the code that would do the damage.
  // (engine-dev QA, 2026-09-01: verified no live path reaches this with a creeper, and
  // verified this line was missing — belt and suspenders on the safety-critical branch.)
  // point-blank (<=2) is allowed through even with placed===0: at that range the mob
  // occupies the only cell a wall could go in, so "no wall built" isn't a sign the fight
  // should be declined — it's a sign there was never room for one. Found live in #65: a
  // skeleton at 0.5-1.7 blocks left BREAK_LOS reporting "how: none, placed: 0" and doing
  // nothing whatsoever beyond holding a shield, which is strictly worse than fighting back
  // when the threat was already standing next to the bot with nothing left to close.
  if ((placed >= 1 || liveDist <= 2) && bot.health >= g.cfg.rushHp && sword && live && liveDist <= g.cfg.meleeReach && t.name !== 'creeper') {
    try {
      await bot.equip(sword, 'hand');
      shieldDown();
      say('Armed and steady - taking it out.');
      bot.pvp.attack(live);
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {                          // was 15000 — a fight this
        await sleep(200);                                       // slow against a mob already
        const still = entOf(t);                                 // in reach means it's kiting,
        if (!still || !still.isValid) break;                    // not losing a close trade
        if (bot.health < g.cfg.rushHp - 2) break;                // was -4 — stop sooner
      }
    } catch (e) {} finally {
      try { bot.pvp.stop(); } catch (e) {}
      await shieldUp(entOf(t));                                 // back up the instant combat
    }                                                            // ends, win or break-off —
    const gone = !entOf(t) || !entOf(t).isValid;                 // wall-off below never starts
    if (gone) return { branch: 'BREAK_LOS', how: 'wall+kill', placed };  // from zero cover
  }
  if (placed || bot.health < g.cfg.rushHp) {
    const w = await branchWallOff(t);
    return { branch: 'BREAK_LOS', how: 'wall+coffin', placed, wall: w };
  }
  return { branch: 'BREAK_LOS', how: placed ? 'wall' : 'none', placed };
};

// BRANCH 1 — melee-only threat and home is close: outrun it.
const branchFleeHome = async (t) => {
  say('! HP ' + Math.round(bot.health) + '/20 - breaking off, running for base.');
  const mv = bot.pathfinder.movements;
  const prevSprint = mv ? mv.allowSprinting : null;
  try {
    if (mv) { mv.allowSprinting = true; bot.pathfinder.setMovements(mv); }
    const r = await ownedGoto(new goals.GoalNear(g.home.x, g.home.y, g.home.z, 2), 30000);
    const d = Math.round(dist(bot.entity.position, g.home));
    if (d <= 6) {
      const live = entOf(t);
      await shieldUp(live);                                   // turn and hold in the lit plaza
      await sleep(1500);
      shieldDown();
    }
    return { branch: 'FLEE_HOME', result: r, distHome: d };
  } finally {
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    if (mv && prevSprint !== null) { mv.allowSprinting = prevSprint; try { bot.pathfinder.setMovements(mv); } catch (e) {} }
  }
};

// #92 item 3: the general skills.js task guard (ctx.step(), minHealth default 6) correctly
// blocks combat-adjacent risk, but it also blocks the completely harmless act of walking a
// couple of blocks to a food drop — exactly the thing that would resolve a cannot-heal
// standdown on its own. survival.js is the one place that has ALREADY verified the threat is
// genuinely clear (that's cannot-heal's own precondition), so it's the right place to attempt
// this directly rather than fighting the generic guard through skills.js's task queue.
// Self-contained: goto only, no digging, capped to a short walk and a handful of drops.
const sweepNearbyFood = async (radius = 10) => {
  try {
    const me = bot.entity.position;
    const drops = Object.values(bot.entities).filter((e) => {
      if (!e || e.name !== 'item' || !e.position || e.isValid === false) return false;
      if (e.position.distanceTo(me) > radius) return false;
      // metadata not in yet: assume collectable rather than excluding it — skills.js's own
      // collectDrops makes the identical call for the identical race (item entity spotted
      // before its metadata packet arrives). A wasted goto attempt on a non-food item is
      // cheap and bounded; silently walking past real food because we checked one tick too
      // early is the worse failure for a cannot-heal bot.
      let it = null;
      try { it = e.getDroppedItem(); } catch (_) { return true; }
      return Boolean(!it || FOODS.has(it.name));
    }).sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
    if (!drops.length) return { swept: 0 };
    let swept = 0;
    for (const e of drops.slice(0, 3)) {
      if (!bot.entities[e.id]) { swept++; continue; }
      const r = await ownedGoto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 1), 6000);
      if (r === 'arrived' && !bot.entities[e.id]) swept++;
    }
    return { swept };
  } catch (e) { return { swept: 0, error: e.message }; }
};

// BRANCH 3 — coffin: seal, eat, regen, dig out away from the threat.
const branchWallOff = async (t) => {
  if (!fillerItem()) {
    // test-driver's live #99 finding: this early bail never set `cannotHeal` on its result,
    // so #92's standdown-arming check in enter() (`out.branch==='WALL_OFF' && out.cannotHeal`)
    // never fired for it — a bot with zero filler AND hp<8 AND food stuck below regen (no
    // food to eat) re-triggered `enter('hp')` as fast as the health listener fires, since
    // `critical` (hp<8) bypasses the normal lockoutMs, and NOTHING here ever remembered the
    // diagnosis. Live: 2060+ fires in a few minutes and climbing, no legal setProject-only
    // recovery (the trigger itself cancels the only task that could fix its own cause — eat).
    // `pick()`'s #96 redesign only ever reaches this path with `t` (the threat) already null
    // (a real threat + no filler diverts to branchFightBack/branchFleeAway before this
    // function is even called) — so `threatsNow()` is already guaranteed empty here, exactly
    // matching cannotHeal's own precondition in the full seal path below. Setting it here
    // closes the SAME gap #92 closed for the full-seal path, for this earlier bail-out too.
    pushLog('warn', 'kit_violation: no filler blocks for wall-off — carry 16+ cobble underground');
    say('! No cobble to wall in with. Kit rule broken - heading out the way I came.');
    const p0 = bot.entity.position;
    await ownedGoto(new goals.GoalNear(Math.floor(p0.x), Math.floor(p0.y), Math.floor(p0.z), 8), 8000);
    return { branch: 'WALL_OFF', sealed: false, reason: 'no_filler', cannotHeal: cannotHeal() };
  }
  say('! Walling myself in to patch up. Back shortly.');
  try { bot.pathfinder.setGoal(null); } catch (e) {}
  const p = bot.entity.position;
  const feet = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const liveThreat = entOf(t);
  // Hold what cover we've got WHILE building — see #65: this loop used to run fully
  // undefended, on the theory that WALL_OFF is only reached "far / low HP / mixed threats"
  // (header table above) where a few seconds of construction is cheap. That's false the
  // moment BREAK_LOS falls through to this as ITS fallback: the threat is then already
  // adjacent, and a live trace caught the bot going 6 HP -> dead DURING construction,
  // never reaching the coffin it was building. shieldDown() happens once at the very end.
  const shielded = liveThreat ? await shieldUp(liveThreat) : false;

  // #115 (run #6 death #1): everything below used to defend against `t` alone — the ONE
  // threat pick() happened to be looking at when it selected this branch — for the entire
  // build+wait episode. A creeper ranks dangerscan's own score-sorted list ahead of a spider
  // regardless of which one is actually landing melee hits, so a spider already present in
  // dangerscan's threats[] never got named, shielded against, or fought back — it was simply
  // never the `t` this function was handed, and nothing here ever looked again.
  // `activeThreat` is now re-derived from a fresh DISTANCE-sorted scan (nearestMeleeThreat)
  // every cycle of both loops below, so a closer/different attacker than the original `t`
  // takes over targeting the moment it's within melee range — named once (not spammed) via
  // `namedThisEpisode`, re-shielded toward immediately. This is the "hold N threats, re-scan
  // on damage-without-named-source" fix TODO 5f asks for, scoped to this branch (the one that
  // actually died to it) rather than a fleet-wide threat-model rewrite.
  let activeThreat = t;
  const namedThisEpisode = new Set(t && t.id != null ? [t.id] : []);
  const rescanMelee = async () => {
    const closest = nearestMeleeThreat(g.cfg.meleeReach);
    if (!closest) return activeThreat;
    if (!activeThreat || closest.id !== activeThreat.id) {
      if (!namedThisEpisode.has(closest.id)) {
        namedThisEpisode.add(closest.id);
        say(`! Also ${closest.name} at ${closest.d} blocks - didn't see that one before.`);
      }
      activeThreat = closest;
      if (closest.name !== 'creeper') { try { await shieldUp(entOf(closest)); } catch (e) {} }
    }
    return activeThreat;
  };
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // face the threat's bearing FIRST — the highest-value block is the one between the bot
  // and whatever is currently hitting it, not whichever side happens to be first in a
  // fixed list. Also #65: an unordered list meant the mob-facing side could be the LAST
  // of four feet-level blocks placed, i.e. dead last in coverage priority.
  if (liveThreat && liveThreat.position) {
    const bx = Math.sign(feet.x - liveThreat.position.x), bz = Math.sign(feet.z - liveThreat.position.z);
    const toward = Math.abs(feet.x - liveThreat.position.x) >= Math.abs(feet.z - liveThreat.position.z) ? [-bx, 0] : [0, -bz];
    sides.sort((a, b) => (a[0] === toward[0] && a[1] === toward[1] ? -1 : b[0] === toward[0] && b[1] === toward[1] ? 1 : 0));
  }
  const cells = [];
  for (const dy of [0, 1]) for (const s of sides) cells.push(feet.offset(s[0], dy, s[1]));
  // The roof cell (feet+2) has NO orthogonal reference on open ground: below it is the
  // bot's own head space. Its side neighbours at the same y do have one (the head ring
  // directly beneath them), so lay those first and the cap becomes placeable. Underground
  // — the branch's real use case — these are already stone and cost nothing.
  for (const s of sides) cells.push(feet.offset(s[0], 2, s[1]));
  cells.push(feet.offset(0, 2, 0));                            // cap: skeletons shoot down shafts

  // #65: HP can crater faster than a fixed 12-cell placement sequence completes. A cell
  // placed at 3 HP is worth less than the seconds it costs while still exposed — bail on
  // NON-essential remaining cells and go straight to holding position (shield still up)
  // once health crosses this floor, rather than marching the list to the end regardless.
  const CRIT = 4;
  let bailed = false;
  const critical = () => bot.health > 0 && bot.health < CRIT;

  // Two passes: a cell with no solid neighbour to place against ('no_reference') often
  // gains one once its neighbours are up — pass 2 catches those. Bottom-up order matters,
  // so cells stays feet-ring -> head-ring -> roof.
  let placed = 0;
  const fails = [];
  for (const c of cells) {
    await rescanMelee();   // #115: catch a closer/unnamed attacker BEFORE the critical() bail, not after
    if (critical()) { bailed = true; break; }
    const r = await placeAt(c);
    if (r === 'placed') placed++;
    else if (r !== 'occupied') fails.push(c);
  }
  if (!bailed) {
    for (const c of fails.slice()) {
      await rescanMelee();
      if (critical()) { bailed = true; break; }
      const r = await placeAt(c);
      if (r === 'placed') { placed++; fails.splice(fails.indexOf(c), 1); }
    }
  }
  // seal = re-read the world, not a running tally. Never report sealed on faith.
  let open = cells.filter((c) => !isSolid(bot.blockAt(c))).length;
  if (open) pushLog('warn', `wall_off: ${open} face(s) still open — coffin is not arrow-tight${bailed ? ' (bailed on low HP)' : ''}`);

  const t0 = Date.now();
  await eatUp();
  let lastHp = bot.health;
  let resealed = false;
  let lastFoodCheck = 0;
  let cannotHealHit = false;
  while (Date.now() - t0 < 60000) {
    if (bot.health >= g.cfg.regenHp && bot.food >= g.cfg.regenFood) break;
    if (bot.health <= 0) break;
    // #92: healing is IMPOSSIBLE once food is stuck below the regen threshold with nothing
    // left to eat — waiting out the rest of this 60s changes nothing (eatUp() below already
    // retries every second and keeps failing the same way). Once the threat is genuinely gone
    // (dangerscan's own live list, not just "wasn't hit this exact tick") and HP has stopped
    // falling, stop waiting on a condition that can never become true from inside a sealed
    // box — this is the exit branchWallOff never had, root cause of #92's 26-cycle stall.
    if (threatsNow().length === 0 && bot.health >= lastHp && cannotHeal()) { cannotHealHit = true; break; }
    // #65: this used to wait passively for up to 60s on the assumption a "sealed" coffin
    // stops incoming damage entirely, checking only once per 1000ms. Live-traced a bot
    // holding stable for 33s then dropping 5.5 -> 0.8 HP in ~4s during this exact wait —
    // faster than a 1s poll could react to, let alone a re-seal attempt (which itself
    // costs real time) before checking again. Now polls every 250ms and, on critical AND
    // still-falling HP, swings FIRST if a threat is adjacent and armed -- stopping the
    // damage source directly is faster than rebuilding a wall around it -- and re-seals
    // (once per bail episode, not every poll) only as a secondary measure.
    if (bot.health > 0 && bot.health < CRIT && bot.health <= lastHp) {
      // #115: damage-without-a-named-source — HP is falling and the ORIGINAL threat may not
      // be what's doing it (dead already, or never was: the whole point of this fix). Re-scan
      // before deciding who to swing at, same helper as the placement loop above.
      const current = await rescanMelee();
      const lt = entOf(current);
      const ld = lt && lt.position ? dist(bot.entity.position, lt.position) : Infinity;
      const sw = bestSword();
      if (ld <= 2 && sw && lt && current && current.name !== 'creeper') {
        try {
          await bot.equip(sw, 'hand');
          bot.pvp.attack(lt);
          await sleep(400);
        } catch (e) {} finally { try { bot.pvp.stop(); } catch (e) {} }
      }
      if (!resealed) {
        resealed = true;
        const stillOpen = cells.filter((c) => !isSolid(bot.blockAt(c)));
        for (const c of stillOpen) { const r = await placeAt(c); if (r === 'placed') placed++; }
        open = cells.filter((c) => !isSolid(bot.blockAt(c))).length;
      }
    }
    lastHp = bot.health;
    await sleep(250);
    if (Date.now() - lastFoodCheck > 1000) {
      lastFoodCheck = Date.now();
      if (bot.food < g.cfg.regenFood) await eatUp();
    }
  }
  open = cells.filter((c) => !isSolid(bot.blockAt(c))).length;   // final re-read, not the pre-wait tally
  if (shielded) shieldDown();

  // exit away from the last known threat bearing (mobs do NOT despawn within 32 blocks) —
  // #115: `activeThreat`, not the original `t`, so exiting steers away from whichever mob was
  // actually last confirmed close, not necessarily the one this branch was first called for.
  let dug = null;
  try {
    const live = entOf(activeThreat);
    const bearing = live && live.position
      ? [Math.sign(feet.x - live.position.x) || 1, Math.sign(feet.z - live.position.z) || 0]
      : [1, 0];
    const away = Math.abs(bearing[0]) >= Math.abs(bearing[1]) ? [bearing[0], 0] : [0, bearing[1]];
    const exit = bot.blockAt(feet.offset(away[0], 0, away[1]));
    if (isSolid(exit)) { await bot.dig(exit); dug = [exit.position.x, exit.position.y, exit.position.z]; }
  } catch (e) {}

  // #92: one self-contained attempt to solve our own cannot-heal deadlock before handing
  // control back — see sweepNearbyFood's own comment for why this bypasses the general
  // skills.js health guard rather than routing through it.
  let sweep = null;
  if (cannotHealHit) {
    sweep = await sweepNearbyFood();
    if (sweep.swept) await eatUp();
  }
  const stillCannotHeal = cannotHealHit && cannotHeal();
  return {
    branch: 'WALL_OFF', sealed: open === 0, placed, openFaces: open, bailed,
    hp: bot.health, food: bot.food, exit: dug,
    cannotHeal: stillCannotHeal, threatClear: threatsNow().length === 0, sweep,
    // #115: >1 means rescanMelee() caught at least one threat beyond the one this branch was
    // originally called with — the multi-threat gap actually firing, visible to a fixture/log
    // reader without needing to grep chat lines.
    threatsNamed: namedThisEpisode.size,
  };
};

// BRANCH 4 — fight back: the last resort BEFORE running, when the threat is already
// adjacent and a weapon is in hand. #96: reuses BREAK_LOS's own proven counter-attack gate
// (weapon held, live target, already at melee reach, not a creeper) but deliberately drops
// its `health >= rushHp` floor — that floor exists there because declining to fight and
// holding the shield is a genuinely SAFE alternative in that context. It is not here: this
// branch only fires once WALL_OFF and FLEE_HOME have both already been ruled out (no
// filler, HP too low, or home unreachable), so the honest alternative to fighting at HP
// 0.33 is not "a safer option" — it is guaranteed continued unopposed damage, which is
// exactly what killed a real fleet bot three times (#96, RotzRudi, 2026-09-02). A real
// player facing that choice swings back.
const canFightBack = (t) => {
  const sword = bestSword();
  const live = entOf(t);
  const liveDist = live && live.position ? dist(bot.entity.position, live.position) : Infinity;
  return Boolean(sword && live && live.isValid !== false && liveDist <= g.cfg.meleeReach && t.name !== 'creeper');
};
const branchFightBack = async (t) => {
  const sword = bestSword();
  say('! No wall, no room to run clean - fighting back.');
  try {
    if (sword) await bot.equip(sword, 'hand');
    const live0 = entOf(t);
    if (live0) bot.pvp.attack(live0);
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      await sleep(200);
      const still = entOf(t);
      if (!still || still.isValid === false) break;   // dead or despawned — we won
      if (bot.health <= 0) break;
    }
  } catch (e) {} finally {
    try { bot.pvp.stop(); } catch (e) {}
  }
  const live = entOf(t);
  const killed = !live || live.isValid === false;
  // didn't end it and we're still standing — running beats repeating a losing fight forever.
  if (!killed && bot.health > 0) return { branch: 'FIGHT_BACK', killed: false, then: await branchFleeAway(t) };
  return { branch: 'FIGHT_BACK', killed };
};

// BRANCH 5 — flee away: the absolute floor. #96: needs NO inventory (unlike WALL_OFF/
// arrow-shadow), NO specific reachable target (unlike FLEE_HOME's home or corner-step's
// qualifying cell) — the only thing it needs is that SOME direction has room to move,
// strictly weaker than every other branch's own precondition, so `pick()` can always reach
// a branch that can act. Generalizes `branchCreeper`'s own proven retreat mechanism
// (maximize distance from a live entity via GoalInvert/GoalFollow, real pathfinding
// handles obstacles automatically) rather than reimplementing dead-reckoning — #54's own
// lesson (trust a proven navigation primitive over a bespoke one) applies here too.
const branchFleeAway = async (t) => {
  say('! Nothing left to fight or wall off with - running for it.');
  const ent = entOf(t);
  const mv = bot.pathfinder.movements;
  const prevSprint = mv ? mv.allowSprinting : null;
  try {
    if (mv) { mv.allowSprinting = true; bot.pathfinder.setMovements(mv); }
    const startD = ent && ent.position ? dist(bot.entity.position, ent.position) : 0;
    if (ent) {
      try { bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(ent, 12)), true); } catch (e) {}
    }
    const t0 = Date.now();
    let best = 0;
    while (Date.now() - t0 < 8000) {
      await sleep(250);
      const live = entOf(t);
      if (!live || !live.position) break;                       // despawned / died / lost us
      const d = dist(bot.entity.position, live.position);
      if (d > best) best = d;
      if (d >= 12) break;
      if (bot.health <= 0) break;
      // cornered: no distance gained in 1.5s -> shield is the only remaining counter
      if (Date.now() - t0 > 1500 && d <= startD + 0.5) { await shieldUp(live); }
    }
    const live = entOf(t);
    const gained = Math.round((live && live.position ? dist(bot.entity.position, live.position) : best) * 10) / 10;
    return { branch: 'FLEE_AWAY', gained, cornered: gained < 3 };
  } finally {
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    shieldDown();
    if (mv && prevSprint !== null) { mv.allowSprinting = prevSprint; try { bot.pathfinder.setMovements(mv); } catch (e) {} }
  }
};

// ================= SHELTER (#105) =================
// Proactive, not reactive: nothing here runs on its own timer. agenda.js's own SHELTER rung
// (a separate lane) polls `shouldShelter()` and calls `enter()`/`exit()` — this file only
// owns the PRIMITIVES and the wait/exit state machine once inside. Deliberately independent
// of `g.active`/`enter()`/`pick()` above (the panic reflex): a real threat is REFLEX/POSTURE's
// job, which sit above SHELTER in agenda's ladder and can always preempt it — this loop also
// watches `threatsNow()` itself, as a second, cheap, non-load-bearing check (composition-rot
// doctrine: never trust a deferral you haven't verified will actually happen in time).

// #105: the trigger — surface-exposure + real night + gear-tier (see isDaylight()'s own
// comment above for why this reads `bot.time.isDay` rather than a light level, and why that
// still generalizes to cavecrew's frozen-at-morning daylight). `surfaceExposed==null`/
// `isDaylight()==null` (dangerscan not installed, or `bot.time` unavailable) fails OPEN to
// "don't shelter" — same degradation posture as S.reachOf's own FLEE_HOME reuse (v8): a
// missing signal should never manufacture a false trigger.
const shouldShelter = () => {
  if (g.shelter.active) return false;
  const d = readDanger();
  if (d.surfaceExposed !== true) return false;
  if (isDaylight() !== false) return false;             // only a CONFIRMED night reading fires
  if (d.state === 'panic') return false;               // REFLEX/POSTURE already own this
  if (gearTier() >= GEAR_TIER_RANK.stone) return false; // stone-or-better can fight the night
  return true;
};
const shelterDawn = () => { const d = readDanger(); return d.surfaceExposed === true && isDaylight() === true; };
const shelterStarving = () => bot.food <= 6 && !hasFoodItem();

// #105: place a torch on the floor block beneath current feet. Deliberately duplicated from
// agenda.js's own `torchInline` (same technique: equip, place against the floor, up-face)
// rather than calling into it — this file never cross-requires another independently-injected
// payload (see the `filler`/`FOODS` comment above).
const torchHere = async () => {
  try {
    const t = torchItem();
    if (!t) return false;
    const feet = bot.entity.position.floored();
    const ref = bot.blockAt(feet.offset(0, -1, 0));
    if (!isSolid(ref)) return false;
    if (!bot.heldItem || bot.heldItem.name !== 'torch') await bot.equip(t, 'hand');
    await bot.placeBlock(ref, new Vec3(0, 1, 0));
    return true;
  } catch (e) { return false; }
};

// #105: is the ground under the bot's OWN feet solid, safe (no hazard), and at least 3 deep
// (so a 2-down dig still leaves the bot standing on something solid, not opening into a cave
// or the void one level further down)? Deliberately conservative — a marooned/floating bot
// (bridge, glass floor, thin ledge) should fail this and fall back to the hut, not risk a dig.
const diginStandable = () => {
  const feet = bot.entity.position.floored();
  for (let dy = 1; dy <= 3; dy++) {
    const b = bot.blockAt(feet.offset(0, -dy, 0));
    if (!isSolid(b) || HAZARD.has(b.name) || b.name === 'water') return false;
  }
  return true;
};
// #115/5g item 4 (spawn-camp dirt-dig fallback, eng-3's proposal, ack'd): diginStandable()
// is all-or-nothing (needs a verified 3-deep column) -- this is the partial-credit sibling,
// returning how many of the first 3 cells straight down are actually usable (0-3), so a
// spawn-camped bot with no filler and imperfect ground underneath can still get SOME cover
// instead of shelterBuild()'s current silent no-op. Same per-cell hazard/water/solid check.
const diginDepth = () => {
  const feet = bot.entity.position.floored();
  let depth = 0;
  for (let dy = 1; dy <= 3; dy++) {
    const b = bot.blockAt(feet.offset(0, -dy, 0));
    if (!isSolid(b) || HAZARD.has(b.name) || b.name === 'water') break;
    depth++;
  }
  return depth;
};

// #105: dig straight down `n` blocks (mineflayer physics free-falls the bot into each gap —
// no pathfinder goal needed for a 1-cell drop). Aborts honestly on a hazard or an undiggable
// block rather than digging blind. Digs whatever tool the bot has equipped/best-available;
// dirt/grass need no tool at all, matching the "needs only a pickaxe and one block" design —
// and often not even the pickaxe, on ordinary ground.
const digDownInto = async (n) => {
  let descended = 0;
  const dugNames = [];
  for (let i = 0; i < n; i++) {
    const feet = bot.entity.position.floored();
    const below = bot.blockAt(feet.offset(0, -1, 0));
    if (!below || AIR.has(below.name)) { descended++; await sleep(300); continue; } // already open
    if (HAZARD.has(below.name) || below.name === 'water') return { ok: false, descended, dugNames, reason: 'hazard_below' };
    try { await bot.dig(below); if (!dugNames.includes(below.name)) dugNames.push(below.name); }
    catch (e) { return { ok: false, descended, dugNames, reason: 'cannot_dig' }; }
    const t0 = Date.now();
    while (Date.now() - t0 < 2000 && Math.floor(bot.entity.position.y) >= feet.y) await sleep(100);
    if (Math.floor(bot.entity.position.y) >= feet.y) return { ok: false, descended, dugNames, reason: 'no_descent' };
    descended++;
  }
  return { ok: true, descended, dugNames };
};

// PRIMITIVE 1 — dig-in-and-cap. Cheap: on flat ground, sealing costs 1-2 blocks (one ring
// cell to give the cap a reference, see below, plus the cap itself) — both self-supplied
// from the dig, no carried filler required (`g.shelter.extraFiller` below covers whatever
// was actually dug, not just the fixed `g.filler` list). Needs a tool only where the ground
// itself does (stone/etc.); dirt/grass need no tool at all.
const shelterDigIn = async (depth = 2) => {
  say('! Digging in for the night.');
  const startFeet = bot.entity.position.floored();
  const dug = await digDownInto(depth);
  // whatever came out of the ground is fair cap/pillar material for THIS session, even if it
  // isn't one of `g.filler`'s fixed names (live-caught: terracotta, during this feature's own
  // fixture) — reset in shelterEnter's finally so this never leaks into a later WALL_OFF/
  // BREAK_LOS call once the shelter session ends.
  g.shelter.extraFiller = dug.dugNames || [];
  if (!dug.ok) {
    // partial dig, if any — climb back out of whatever hole exists rather than leaving the
    // bot part-way down an open shaft (pathfinder's own scaffolding-climb move, same as the
    // real exit path below).
    if (dug.descended > 0) await ownedGoto(new goals.GoalBlock(startFeet.x, startFeet.y, startFeet.z), 8000);
    return { kind: 'digin', ok: false, reason: dug.reason, sealed: false, lit: false };
  }
  const lit = await torchHere();
  if (!lit) pushLog('warn', 'kit_violation: no torch for the shelter dig-in — sealing dark');
  const feet = bot.entity.position.floored();
  const cap = feet.offset(0, 2, 0);
  // #105 (live-caught, ShltrQA fixture): the cap has NO reference on its own — on ANY flat
  // ground (natural or artificial), `feet.offset(0,2,0)` is exactly where the bot originally
  // stood, one head-height above open air on every side, same as `branchWallOff`'s own roof
  // cell (survival.js, "no orthogonal reference on open ground"). WALL_OFF solves this by
  // placing its 4 head-level RING cells first — each of THOSE has a reference (the wall block
  // directly below it), and the center cap then references the ring. Dig-in has no ring built
  // (the shaft's own natural walls at feet/head level are untouched terrain, not a placed
  // wall), so it needs the same one-cell-wide ring at cap height before the cap itself is
  // placeable — each ring cell's OWN reference is the natural ground one level down and one
  // column over, which IS solid on ordinary terrain (confirmed live: a 3x3 dirt platform's
  // untouched columns are solid exactly where a ring cell would need them).
  //
  // #115/5g item 4: this is DEPTH-INDEPENDENT and needs no special-casing for a shallower dig
  // (`depth` param above, `diginDepth()`'s partial-credit fallback) — `cap` is computed from
  // `feet`, re-read fresh right above AFTER whatever depth was actually dug, so it always sits
  // exactly 2 above the REAL resting feet (1 above the bot's own head) regardless of depth. The
  // ring's own reference (one level below the ring, at the ring's horizontal offset) is the
  // UNDISTURBED terrain surrounding the single dug column, at whatever absolute Y that lands —
  // solid either way, since digDownInto only ever touches the center 1x1 column, never the
  // footprint around it. A shallow (depth=1) dig-in's ring/cap ends up ABOVE original grade
  // instead of at it, which looks odd on paper but is mechanically identical to depth=2's case
  // one level up — same solid neighbours, same placement logic, no reference gap either way.
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let r = await placeAt(cap);   // cheap check first — some geometry (a ledge, a rim) already has a reference
  for (const s of sides) {
    if (r === 'placed' || isSolid(bot.blockAt(cap))) break;
    await placeAt(cap.offset(s[0], 0, s[1]));   // one ring cell — stops as soon as the cap itself succeeds
    r = await placeAt(cap);
  }
  const sealed = isSolid(bot.blockAt(cap));
  if (r !== 'placed' && !sealed) pushLog('warn', `shelter dig-in: cap not placed (${r}) — sealing incomplete`);
  return { kind: 'digin', ok: true, sealed, lit, cap: [cap.x, cap.y, cap.z], startY: startFeet.y, restY: feet.y };
};

// PRIMITIVE 2 — 1x1 hut. `branchWallOff`'s own cell list and `placeAt` loop (lines above),
// run PROACTIVELY: no live threat to face first, no shield needed. Needs ~10-13 filler blocks.
const shelterHut = async () => {
  say('! Boxing myself in for the night.');
  const p = bot.entity.position;
  const feet = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cells = [];
  for (const dy of [0, 1]) for (const s of sides) cells.push(feet.offset(s[0], dy, s[1]));
  for (const s of sides) cells.push(feet.offset(s[0], 2, s[1]));
  cells.push(feet.offset(0, 2, 0));
  let placed = 0;
  const fails = [];
  for (const c of cells) { const r = await placeAt(c); if (r === 'placed') placed++; else if (r !== 'occupied') fails.push(c); }
  for (const c of fails.slice()) { const r = await placeAt(c); if (r === 'placed') { placed++; fails.splice(fails.indexOf(c), 1); } }
  const lit = await torchHere();
  if (!lit) pushLog('warn', 'kit_violation: no torch for the shelter hut — sealing dark');
  const open = cells.filter((c) => !isSolid(bot.blockAt(c))).length;
  if (open) pushLog('warn', `shelter hut: ${open} face(s) still open — not arrow-tight`);
  return { kind: 'hut', ok: true, sealed: open === 0, lit, placed, openFaces: open, cells };
};

// selector, by carried stock — falls back to the OTHER primitive if the preferred one's own
// precondition fails, and fails honestly (never a silent no-op) if neither can act, matching
// #101's terrain-seek doctrine ("a genuinely marooned bot still fails fast and honestly").
const shelterBuild = async () => {
  const preferHut = fillerCount() >= g.cfg.shelterHutFiller;
  if (preferHut) return await shelterHut();
  if (diginStandable()) return await shelterDigIn();
  if (fillerCount() >= 4) return await shelterHut();  // degraded hut: fewer cells sealed, still something
  // #115/5g item 4: the LAST resort before giving up entirely, and deliberately scoped to a
  // genuine spawn-camp (bot._spawnCamp.active, #116's own shared bot-level flag — no
  // cross-payload require needed) rather than every ordinary no-filler night. Doing nothing
  // is worse than partial cover ONLY when the alternative is repeat-dying at an active camp;
  // an ordinary "ran out of filler, not currently camped" bot should still fail honestly here
  // (unchanged) rather than dig a half-sealed pit it didn't need. diginDepth()>=1 is a lower
  // bar than diginStandable()'s full 3, on purpose — 1-2 sealed cells beats zero.
  if (bot._spawnCamp && bot._spawnCamp.active) {
    const depth = diginDepth();
    if (depth >= 1) return await shelterDigIn(depth);
  }
  return { kind: null, ok: false, reason: 'no_viable_primitive' };
};

// exit: dig the cap (dig-in) or one wall (hut), then pillar back up if needed.
const shelterExitBuild = async (built) => {
  try {
    if (built.kind === 'digin') {
      const cap = new Vec3(built.cap[0], built.cap[1], built.cap[2]);
      const b = bot.blockAt(cap);
      if (isSolid(b)) await bot.dig(b);
      // #105 (live-caught, ShltrQA fixture): a hand-rolled jump-and-place-underfoot pillar
      // never gained height — placeBlock's own collision rules refuse a block at the exact
      // cell the bot's hitbox occupies, which is what a naive "place below current feet"
      // attempt does. mineflayer-pathfinder already has a proven scaffolding-climb move
      // (`Movements.scafoldingBlocks`, actively used elsewhere in this codebase — see
      // skills.js's own comments on clearing it during builds to avoid spending materials as
      // scaffolding by accident) — reusing that via a plain goto is simpler and more reliable
      // than reimplementing pillar-jump timing by hand.
      await ownedGoto(new goals.GoalBlock(cap.x, cap.y, cap.z), 8000);
    } else if (built.kind === 'hut') {
      const feet = bot.entity.position.floored();
      for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = bot.blockAt(feet.offset(s[0], 0, s[1]));
        if (isSolid(c)) { await bot.dig(c); break; }
      }
    }
  } catch (e) { pushLog('warn', 'shelter exit dig failed: ' + e.message); }
};

// __survival.shelter — the exposed API. `enter()` is fire-and-forget from the caller's side
// (same convention as `enter()`/`g.drill()` above, and TOOL/PROJECT's own task-not-await
// rule in agenda.js): it self-manages `g.shelter.active` for the agenda to poll, and resolves
// once the bot has genuinely left shelter.
const shelterEnter = async () => {
  if (g.shelter.active) return { error: 'already sheltering' };
  g.shelter.active = true; g.shelter.since = Date.now(); g.shelter.exitRequested = false; g.shelter.exitReason = null;
  const guarded = suspendGuard();
  try { if (globalThis.__skills && globalThis.__skills.stop) globalThis.__skills.stop('shelter'); } catch (e) {}
  try { bot.pathfinder.setGoal(null); } catch (e) {}
  let built = null, exitReason = 'unknown';
  try {
    built = await shelterBuild();
    g.shelter.kind = built.kind;
    if (!built.ok) { exitReason = 'build_failed:' + built.reason; return { ...built, exitReason }; }
    pushLog('warn', `shelter_enter (${built.kind}) sealed=${built.sealed} lit=${built.lit}`);
    const t0 = Date.now();
    let lastEat = 0;
    while (Date.now() - t0 < g.cfg.shelterMaxWaitMs) {
      if (g.shelter.exitRequested) { exitReason = g.shelter.exitReason || 'external'; break; }
      if (threatsNow().length > 0) { exitReason = 'threat'; break; }  // hand back to REFLEX/POSTURE
      if (shelterDawn()) { exitReason = 'dawn'; break; }
      if (shelterStarving()) { exitReason = 'hunger'; break; }
      if (Date.now() - lastEat > 1000) { lastEat = Date.now(); if (bot.food <= 17 && hasFoodItem()) await eatUp(); }
      if (bot.health <= 0) { exitReason = 'dead'; break; }
      await sleep(500);
    }
    if (Date.now() - t0 >= g.cfg.shelterMaxWaitMs) exitReason = 'max_wait';
    await shelterExitBuild(built);
    pushLog('warn', `shelter_exit (${exitReason})`);
    return { ...built, exitReason };
  } finally {
    if (guarded) resumeGuard();
    g.shelter.active = false; g.shelter.kind = null; g.shelter.extraFiller = [];
  }
};
const shelterExit = (reason) => {
  if (!g.shelter.active) return false;
  g.shelter.exitRequested = true; g.shelter.exitReason = reason || 'external';
  return true;
};
g.shelter.should = shouldShelter;
g.shelter.enter = shelterEnter;
g.shelter.exit = shelterExit;
g.shelter.status = () => ({ active: g.shelter.active, kind: g.shelter.kind, since: g.shelter.since, gearTier: gearTier(), fillerCount: fillerCount(), isDay: isDaylight(), ...readDanger() });

// ================= ORCHESTRATION =================

// #98: straight-line distance to home says nothing about whether a PATH exists — terrain, water,
// or a cliff between here and home would only be discovered after branchFleeHome has already
// committed up to 30s of ownedGoto to it, exposed to whatever threat triggered the flee the whole
// time. Reuses skills.js's own proven _reachOf probe (S.reachOf, #70's "checker must match the
// executor" no-movement getPathTo search) rather than reimplementing it — same idiom eng-3's #97
// fix is expected to want from a different file. Fails OPEN (treats home as reachable) if
// skills.js isn't installed: this file already documents skills.js as optional elsewhere, and a
// false "unreachable" from a missing optional payload would silently disable FLEE_HOME entirely
// rather than degrade to today's behavior.
const homeReachable = async () => {
  const S = globalThis.__skills;
  if (!S || typeof S.reachOf !== 'function') return true;
  try { return Boolean(S.reachOf(bot, g.home)); } catch (_) { return true; }
};

const pick = async () => {
  const hazard = envHazard();
  if (hazard) return branchEnv(hazard);

  const ts = threatsNow();
  const creeper = ts.find((x) => x.name === 'creeper' && x.d <= 8);
  if (creeper) return branchCreeper(creeper);

  const ranged = ts.find((x) => x.ranged && x.los);
  if (ranged) return branchBreakLOS(ranged);

  const nearest = ts.length ? ts[0] : null;
  const dHome = dist(bot.entity.position, g.home);
  const meleeOnly = ts.length > 0 && ts.every((x) => !x.ranged);
  // #98: fleeTarget is `nearest` (melee threat, still fighting-fit) or `null` (hurt, no visible
  // threat) exactly as before -- undefined means "not a flee candidate at all", distinct from a
  // real null target, so the reachability gate below only ever runs for the two cases that used
  // to unconditionally return.
  const fleeTarget = (dHome <= g.cfg.fleeHomeMax && meleeOnly && bot.health >= 6) ? nearest
    : (!ts.length && dHome <= g.cfg.fleeHomeMax) ? null
    : undefined;
  if (fleeTarget !== undefined && (await homeReachable())) return branchFleeHome(fleeTarget);

  // #96: WALL_OFF may only be chosen when it can actually seal something -- same "verify
  // before deferring" discipline as #94/#98, applied to the fallback of last resort itself.
  // With no filler, calling it anyway is a guaranteed no-op (branchWallOff's own no_filler
  // early-return): a genuine live threat (`nearest` non-null) then gets an honest attempt
  // instead — fight if the threat is already adjacent and a weapon is in hand, otherwise
  // run. The `nearest === null` case ("hurt, no visible threat, far from home") is left
  // routing to branchWallOff as before: nothing is actively landing hits during that no-op
  // retreat, so it is harmless there and not the state #96 is about.
  if (nearest && !fillerItem()) {
    if (canFightBack(nearest)) return branchFightBack(nearest);
    return branchFleeAway(nearest);
  }

  return branchWallOff(nearest);
};

const enter = async (why, pickOverride) => {
  if (!g.enabled || g.active) return;
  // lockoutMs exists to stop THRASHING on an already-resolved encounter — it must never
  // gag the critical-HP backstop mid-encounter. Found live in #65: BREAK_LOS can end a run
  // reporting "recovered" while the threat is still adjacent (a point-blank skeleton gives
  // it no cell to corner-step into and no room for an arrow-shadow — "how: none"), and the
  // very next re-trigger landed 184ms into the lockout window and was silently dropped —
  // fires stayed at 1 for the whole encounter while HP free-fell from 15 to 7.33 with zero
  // active response. Critical HP always breaks through, exactly like the backstop already
  // claims to do "even with no dangerscan installed" (line ~15) — that promise was false
  // whenever a prior panic had JUST ended, which is precisely when it matters most.
  const critical = Boolean(bot.entity) && bot.health > 0 && bot.health < g.cfg.hpPanic;
  if (!pickOverride && !critical && Date.now() - g.lastEnd < g.cfg.lockoutMs) return;
  if (!bot.entity || bot.health <= 0) return;
  // #92: once WALL_OFF has already diagnosed THIS exact situation as cannot-heal with the
  // threat genuinely clear, a stray food/health tick re-firing the 'hp' backstop must not
  // re-seal the bot — that IS the heal-deadlock (26 identical cycles, 25m44s, zero self-exit).
  // Any genuine new development breaks through immediately, same as always: HP actually
  // getting worse, or a live threat reappearing, both clear standdown and fall through to a
  // real pick() below. Never applies to an explicit drill()/pickOverride call. A hard expiry
  // forces a fresh re-check periodically regardless, so this can never go silent forever.
  if (g.standdown && !pickOverride) {
    const stale = Date.now() - g.standdown.since > g.cfg.standdownMaxMs;
    if (stale || bot.health < g.standdown.hp || threatsNow().length > 0) g.standdown = null;
    else return;
  }
  g.active = true; g.fires++; g.startedAt = Date.now();
  const guarded = suspendGuard();
  let out = null;
  // #38: this force-exit used to bypass the catch block entirely (it doesn't throw, it
  // just flips g.active off), so a run that hit the 90s wall-clock cap silently did NOT
  // count as a failure -- g.failures stayed exactly as informative as a run that never
  // hung at all. A hang IS a failure by any reasonable definition of the word.
  const cap = setTimeout(() => { pushLog('error', 'panic run exceeded maxRunMs — forcing exit'); g.active = false; g.failures++; }, g.cfg.maxRunMs);
  try {
    // ordered teardown of whatever the bot was doing (AUTONOMY_PLAN step 3)
    try { if (globalThis.__skills && globalThis.__skills.stop) globalThis.__skills.stop('panic'); } catch (e) {}
    try { if (bot.pvp) bot.pvp.forceStop(); } catch (e) {}
    try { if (bot.collectBlock) bot.collectBlock.cancelTask().catch(() => {}); } catch (e) {}
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    try { if (bot.armorManager) bot.armorManager.equipAll(); } catch (e) {}

    const ts = threatsNow();
    const top = ts.length ? `${ts[0].name} at ${ts[0].d}` : 'no visible threat';
    pushLog('warn', `panic_enter (${why}) hp=${Math.round(bot.health)} threat=${top}`);
    try { const m = globalThis.__metrics; if (m && m.panic) m.panic('enter', why, bot.health); } catch (e) {}
    g.branch = 'deciding';
    // #38: this called the real pick() UNCONDITIONALLY -- pickOverride was captured as a
    // parameter and used only as a truthy flag for the lockout check above, never actually
    // invoked. g.drill()'s entire premise is "go through the real enter() state machine
    // but force the requested branch/threat" (its own doc comment, below) -- that premise
    // was false. A drill() call ran the REAL pick() against REAL ambient conditions the
    // whole time, silently testing whatever the bot happened to be near rather than the
    // scenario the caller asked for. Reproducing #38's original repro live with this bug
    // still in place: drill('BREAK_LOS', {...a real id...}) actually fell through pick()'s
    // own no-real-threat path into branchWallOff(null), which is why it took a long time
    // (WALL_OFF's regen-wait) for reasons that had nothing to do with BREAK_LOS, corner
    // stepping, or the underwater entity at all.
    out = await (pickOverride || pick)();
    g.branch = out && out.branch;
    g.lastBranch = g.branch;
    g.recovered++;
    pushLog('warn', `panic_recovered branch=${g.branch} hp=${Math.round(bot.health)} — driver decides resume vs abort`);
    try { const m = globalThis.__metrics; if (m && m.panic) m.panic('recovered', g.branch, bot.health); } catch (e) {}
    // #100: standdown's arming used to be keyed to ONE branch's result (WALL_OFF +
    // cannotHeal) -- #99 found the identical "genuinely nothing left to do" shape reachable
    // through a DIFFERENT early-return in the same branch, and #96's own live-mob
    // verification separately found it reachable after FIGHT_BACK/FLEE_AWAY too (food
    // dipping below the regen floor from a fight's own exhaustion, not just the original
    // #92 starvation case). Re-keyed to a PREDICATE -- danger genuinely settled AND cannot
    // heal -- so it arms correctly regardless of which branch produced the outcome, per the
    // #94/#95 doctrine ("a branch may only defer to a fallback it has verified can act").
    // Two exclusions, found by walking every branch rather than trusting the general case:
    //  - ENV: branchEnv never verifies the hazard is actually gone (no `resolved` field),
    //    and pick()'s own FIRST check on every call is envHazard() -- arming standdown here
    //    could suppress that re-check until a real health-drop forces it, for the one
    //    branch class whose own header comment says "nothing else matters". Costs nothing
    //    to just exclude it; env hazards are rare and always re-checked when NOT suppressed.
    //  - FLEE_AWAY's own `cornered:true`: not hypothetical -- #94's diagnosis (this file,
    //    same day) found dangerscan's threat list can read empty WHILE a real melee
    //    attacker is still adjacent (the "self-blinding" observation from RotzRudi's
    //    ledger). Arming on a threatsNow()===0 reading right after the one branch whose OWN
    //    result says "I did not actually get away" is exactly that risk.
    // No change needed to standdown's own clear/re-arm logic (enter()'s entry gate) -- it
    // already re-checks health-dropped/threat-reappeared fresh on every call regardless of
    // which branch originally armed it.
    const dangerSettled = out && out.branch !== 'ENV' && threatsNow().length === 0
      && !(out.branch === 'FLEE_AWAY' && out.cornered);
    if (dangerSettled && cannotHeal()) {
      g.standdown = { since: Date.now(), hp: bot.health };
      say('Walled off but can\'t heal — food stuck at ' + Math.round(bot.food) + '/20 with nothing to eat. ' +
        'Standing down at ' + Math.round(bot.health) + ' HP. Need food or new orders.');
    } else {
      g.standdown = null;
      say('Stable again (' + g.branch + ', HP ' + Math.round(bot.health) + '/20). Awaiting orders.');
    }
  } catch (e) {
    g.failures++;
    pushLog('error', 'panic run failed: ' + e.message);
  } finally {
    clearTimeout(cap);
    g.lastEvent = { at: Date.now(), why, branch: g.branch, hp: bot.health, out };
    g.branch = null; g.active = false; g.lastEnd = Date.now();
    shieldDown();
    if (guarded) resumeGuard();
    try { if (globalThis.__danger && globalThis.__danger.clearPanic) globalThis.__danger.clearPanic(); } catch (e) {}
  }
};

// ---- triggers ----
const onDanger = (next) => { if (next === 'panic') enter('danger').catch(() => {}); };
// Re-injecting dangerscan.js builds a NEW __danger object and silently orphans this
// subscription, which would leave the bot with only the HP backstop. Re-arm on a timer
// so payload re-injection in any order still ends up wired.
const subscribe = () => {
  try {
    const d = globalThis.__danger;
    if (!d || typeof d.on !== 'function') { g.subscribed = false; return; }
    if (!Array.isArray(d.listeners) || !d.listeners.includes(onDanger)) d.on(onDanger);
    g.subscribed = true;
  } catch (e) { g.subscribed = false; }
};
subscribe();
g.subTimer = setInterval(() => {
  if (globalThis.__survival !== g || !g.enabled) { clearInterval(g.subTimer); return; }
  subscribe();
}, 5000);

// backstop: works even with no dangerscan installed
const onHealth = () => {
  try { if (bot.health > 0 && bot.health < g.cfg.hpPanic) enter('hp').catch(() => {}); } catch (e) {}
};
bot.on('health', onHealth);

g.trigger = (why) => enter(why || 'manual');
// Field-test entry point: run ONE branch directly, bypassing pick(). Manual /eval only —
// nothing calls this automatically. Use it to verify a branch without waiting for the
// matching mob to show up (e.g. __survival.runBranch('WALL_OFF')).
//
// STANDARD QA PATTERN (verified live 2026-09-01, engine-dev + engine-dev-2): pass `threat`
// with a REAL entity id from something harmless (an ambient mob like a bat is ideal — no
// aggro, no retaliation, no rule risk) instead of `id: null`. entOf(t) does a raw
// bot.entities[id] lookup with zero type/hostility filtering, so the branch reacts to the
// bat's REAL, MOVING position — genuine LOS raycasts, genuine pathfinding, genuine distance
// tracking — while `name`/`d`/`ranged`/`los` stay whatever you fabricate to pick the branch
// you want to test. This is strictly better than `id:null` (which only exercises the outer
// shell + cleanup, since entOf returns null and every position-dependent code path gets
// skipped) and categorically safer than a real hostile or ANY player entity (NEVER use a
// player id here — if a branch's rush/attack logic ever fired on it, that violates the
// hard never-attack-players rule). For CREEPER's retreat pathing specifically, the "threat"
// needs to be genuinely CLOSE (inside creeperClear, ~10 blocks) to exercise GoalInvert/
// GoalFollow for real — walk the bot to within a few blocks of a bat first (perfectly safe,
// unlike ever doing this to a real creeper), then call runBranch. Verified: gained 10.9
// distance from a 3.7m start, real terrain, no oscillation.
// shared dispatch, same fabricated-threat defaults for every caller: runBranch (bypasses
// enter() entirely) and drill (goes through the real enter() state machine, below).
const branchFor = async (name, threat) => {
  const t = threat || threatsNow()[0] || null;
  switch (String(name || '').toUpperCase()) {
    case 'ENV': return await branchEnv(envHazard() || 'fire');
    case 'CREEPER': return await branchCreeper(t || { name: 'creeper', d: 3, id: null });
    case 'BREAK_LOS': return await branchBreakLOS(t || { name: 'skeleton', d: 10, ranged: true, los: true, id: null });
    case 'FLEE_HOME': return await branchFleeHome(t);
    case 'WALL_OFF': return await branchWallOff(t);
    case 'FIGHT_BACK': return await branchFightBack(t || { name: 'zombie', d: 2, ranged: false, id: null });
    case 'FLEE_AWAY': return await branchFleeAway(t || { name: 'zombie', d: 3, ranged: false, id: null });
    default: return { error: 'unknown branch', known: ['ENV', 'CREEPER', 'BREAK_LOS', 'FLEE_HOME', 'WALL_OFF', 'FIGHT_BACK', 'FLEE_AWAY'] };
  }
};
g.runBranch = async (name, threat) => {
  const guarded = suspendGuard();
  try { return await branchFor(name, threat); }
  finally { if (guarded) resumeGuard(); shieldDown(); }
};
// SD-T1 bench hook (issue #23): unlike runBranch (which calls a branch function directly,
// bypassing the panic state machine entirely), drill() goes through the REAL enter() —
// same panic_enter/panic_recovered log lines, same g.branch/g.lastBranch/g.fires/
// g.recovered bookkeeping, same metrics.panic() calls a genuine encounter produces —
// just with the branch forced instead of picked from live threats. That's what makes its
// result bench-row-shaped without waiting for a real encounter. Bypasses the lockoutMs
// re-entry cooldown (this is a deliberate, manual, opt-in test call, not an accidental
// real panic — a bench suite drilling all five branches back-to-back shouldn't eat 10s
// per branch) but still refuses a second drill while one is already active, same as a
// real panic would. Same threat-fabrication rules as runBranch's doc comment above:
// prefer a real harmless entity id (a nearby bat) over `id: null` so LOS/pathing/distance
// are exercised for real, never a player id.
g.drill = async (name, threat) => {
  if (g.active) return { error: 'already active', branch: g.branch };
  await enter('drill:' + String(name || '').toUpperCase(), () => branchFor(name, threat));
  return { ...g.lastEvent, bench: true };
};
g.brief = () => ({ state: g.active ? 'panic:' + (g.branch || '?') : (g.standdown ? 'standdown' : 'ready'), branch: g.lastBranch, fires: g.fires, recovered: g.recovered, failures: g.failures, standdown: g.standdown });
// #92: exposed for fixture/live testing, same pattern as dangerscan.js's columnOpen ->
// g.columnOpen and skills.js's findRepositionTarget -> S.recoveryDetect.
g.cannotHeal = cannotHeal;
g.sweepNearbyFood = sweepNearbyFood;
g.snapshot = () => ({ ...g.brief(), home: g.home, cfg: g.cfg, lastEvent: g.lastEvent, active: g.active });
g.restore = () => {
  g.enabled = false;
  if (g.subTimer) clearInterval(g.subTimer);
  try { bot.removeListener('health', onHealth); } catch (e) {}
  try { if (globalThis.__danger && globalThis.__danger.off) globalThis.__danger.off(onDanger); } catch (e) {}
  resumeGuard();
};

// ---- staleness registry (see FEEDBACK "injection reports can drift from reality") ----
// A reconnect makes runner.js build a FRESH bot object (runner.js:319) while globalThis
// survives. This module would then hold a health listener on a DEAD bot: the reflex is
// gone, but every presence check still says it is installed — the exact failure that let
// three bots die inside driver polling gaps. Go stale loudly instead.
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.survival = { version: 13, boundAt: Date.now(), stale: false };
bot.once('end', () => {
  try {
    REG.survival.stale = true;
    g.enabled = false;
    if (g.subTimer) clearInterval(g.subTimer);
    resumeGuard();
  } catch (e) {}
});

return {
  installed: true, version: 13, home: g.home,
  dangerscan: Boolean(globalThis.__danger),
  skills: Boolean(globalThis.__skills),
  idleguard: Boolean(globalThis.__idleguard),
  branches: ['ENV', 'CREEPER', 'BREAK_LOS', 'FLEE_HOME', 'WALL_OFF', 'FIGHT_BACK', 'FLEE_AWAY'],
  shelter: ['digin', 'hut'],  // #105: proactive, exposed via __survival.shelter.{should,enter,exit,status}
  replaces: 'panicguard.js',
};
