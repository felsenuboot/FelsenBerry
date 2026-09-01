// survival v5 payload (inject via POST /eval, idempotent) — REPLACES panicguard.js.
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
//   FLEE_HOME  home <= 40 away, melee-only       -> sprint home, turn and hold with shield
//   WALL_OFF   far / low HP / mixed threats      -> seal a coffin, eat to 18, regen, dig out away from the threat
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
  enabled: true, version: 5,
  home: readHome(),
  active: false, branch: null, lastBranch: null, lastEvent: null,
  fires: 0, recovered: 0, failures: 0, lastEnd: 0, startedAt: 0,
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
  },
  filler: ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'andesite', 'diorite', 'granite', 'netherrack'],
};
globalThis.__survival = g;

const AIR = new Set(['air', 'cave_air', 'void_air']);
const HAZARD = new Set(['lava', 'fire', 'soul_fire', 'campfire', 'soul_campfire', 'magma_block']);

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
const fillerItem = () => { for (const n of g.filler) { const it = findItem((i) => i.name === n); if (it) return it; } return null; };

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
      if (bot.health > 0 && bot.health < g.cfg.hpPanic) break;   // stop searching, go defend
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

// BRANCH 3 — coffin: seal, eat, regen, dig out away from the threat.
const branchWallOff = async (t) => {
  if (!fillerItem()) {
    pushLog('warn', 'kit_violation: no filler blocks for wall-off — carry 16+ cobble underground');
    say('! No cobble to wall in with. Kit rule broken - heading out the way I came.');
    const p0 = bot.entity.position;
    await ownedGoto(new goals.GoalNear(Math.floor(p0.x), Math.floor(p0.y), Math.floor(p0.z), 8), 8000);
    return { branch: 'WALL_OFF', sealed: false, reason: 'no_filler' };
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
    if (critical()) { bailed = true; break; }
    const r = await placeAt(c);
    if (r === 'placed') placed++;
    else if (r !== 'occupied') fails.push(c);
  }
  if (!bailed) {
    for (const c of fails.slice()) {
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
  while (Date.now() - t0 < 60000) {
    if (bot.health >= g.cfg.regenHp && bot.food >= g.cfg.regenFood) break;
    if (bot.health <= 0) break;
    // #65: this used to wait passively for up to 60s on the assumption a "sealed" coffin
    // stops incoming damage entirely, checking only once per 1000ms. Live-traced a bot
    // holding stable for 33s then dropping 5.5 -> 0.8 HP in ~4s during this exact wait —
    // faster than a 1s poll could react to, let alone a re-seal attempt (which itself
    // costs real time) before checking again. Now polls every 250ms and, on critical AND
    // still-falling HP, swings FIRST if a threat is adjacent and armed -- stopping the
    // damage source directly is faster than rebuilding a wall around it -- and re-seals
    // (once per bail episode, not every poll) only as a secondary measure.
    if (bot.health > 0 && bot.health < CRIT && bot.health <= lastHp) {
      const lt = entOf(t);
      const ld = lt && lt.position ? dist(bot.entity.position, lt.position) : Infinity;
      const sw = bestSword();
      if (ld <= 2 && sw && lt && t.name !== 'creeper') {
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

  // exit away from the last known threat bearing (mobs do NOT despawn within 32 blocks)
  let dug = null;
  try {
    const live = entOf(t);
    const bearing = live && live.position
      ? [Math.sign(feet.x - live.position.x) || 1, Math.sign(feet.z - live.position.z) || 0]
      : [1, 0];
    const away = Math.abs(bearing[0]) >= Math.abs(bearing[1]) ? [bearing[0], 0] : [0, bearing[1]];
    const exit = bot.blockAt(feet.offset(away[0], 0, away[1]));
    if (isSolid(exit)) { await bot.dig(exit); dug = [exit.position.x, exit.position.y, exit.position.z]; }
  } catch (e) {}
  return { branch: 'WALL_OFF', sealed: open === 0, placed, openFaces: open, bailed, hp: bot.health, food: bot.food, exit: dug };
};

// ================= ORCHESTRATION =================

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
  if (dHome <= g.cfg.fleeHomeMax && meleeOnly && bot.health >= 6) return branchFleeHome(nearest);
  if (!ts.length && dHome <= g.cfg.fleeHomeMax) return branchFleeHome(null);   // hurt, no visible threat

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
    say('Stable again (' + g.branch + ', HP ' + Math.round(bot.health) + '/20). Awaiting orders.');
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
    default: return { error: 'unknown branch', known: ['ENV', 'CREEPER', 'BREAK_LOS', 'FLEE_HOME', 'WALL_OFF'] };
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
g.brief = () => ({ state: g.active ? 'panic:' + (g.branch || '?') : 'ready', branch: g.lastBranch, fires: g.fires, recovered: g.recovered, failures: g.failures });
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
REG.survival = { version: 5, boundAt: Date.now(), stale: false };
bot.once('end', () => {
  try {
    REG.survival.stale = true;
    g.enabled = false;
    if (g.subTimer) clearInterval(g.subTimer);
    resumeGuard();
  } catch (e) {}
});

return {
  installed: true, version: 5, home: g.home,
  dangerscan: Boolean(globalThis.__danger),
  skills: Boolean(globalThis.__skills),
  idleguard: Boolean(globalThis.__idleguard),
  branches: ['ENV', 'CREEPER', 'BREAK_LOS', 'FLEE_HOME', 'WALL_OFF'],
  replaces: 'panicguard.js',
};
