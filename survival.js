// survival v1 payload (inject via POST /eval, idempotent) — REPLACES panicguard.js.
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
  enabled: true, version: 1,
  home: readHome(),
  active: false, branch: null, lastBranch: null, lastEvent: null,
  fires: 0, recovered: 0, failures: 0, lastEnd: 0, startedAt: 0,
  cfg: {
    lockoutMs: 10000,     // re-entry lockout after a completed recovery
    hpPanic: 8,           // backstop trigger when dangerscan is absent
    fleeHomeMax: 40,      // FLEE_HOME only inside this radius
    creeperClear: 10,     // open this much space from a creeper (fuse aborts at 7)
    rushHp: 12,           // BREAK_LOS may counter-attack at/above this HP
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
    if (typeof bot.oxygenLevel === 'number' && bot.oxygenLevel <= 5) return 'drowning';
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

  // (a) step to a neighbouring cell the threat cannot see into
  if (tEye) {
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const o of offs) {
      const cell = feet.offset(o[0], 0, o[1]);
      const at = bot.blockAt(cell), above = bot.blockAt(cell.offset(0, 1, 0)), below = bot.blockAt(cell.offset(0, -1, 0));
      if (!at || !above || !below) continue;
      if (isSolid(at) || isSolid(above) || !isSolid(below)) continue;  // leaf_litter is walkable
      if (!losBlocked(tEye, cell.offset(0.5, 1.6, 0.5))) continue;
      const r = await ownedGoto(new goals.GoalBlock(cell.x, cell.y, cell.z), 4000);
      if (r === 'arrived') {
        return { branch: 'BREAK_LOS', how: 'corner', cell: [cell.x, cell.y, cell.z] };
      }
    }
  }

  // (b) arrow shadow: a 1x2 filler pillar on the cell between bot and threat
  let placed = 0;
  if (ent && ent.position) {
    const dx = ent.position.x - p.x, dz = ent.position.z - p.z;
    const step = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
    for (const dy of [0, 1]) {
      const r = await placeAt(feet.offset(step[0], dy, step[1]));
      if (r === 'placed') placed++;
    }
  }
  if (placed) say('Cobble wall up - that is my arrow shadow.');

  // (c) healthy and armed -> take it out around the wall; otherwise seal in
  const sword = bestSword();
  const live = entOf(t);
  if (placed >= 1 && bot.health >= g.cfg.rushHp && sword && live) {
    try {
      await bot.equip(sword, 'hand');
      shieldDown();
      say('Armed and steady - taking it out.');
      bot.pvp.attack(live);
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        await sleep(400);
        const still = entOf(t);
        if (!still || !still.isValid) break;
        if (bot.health < g.cfg.rushHp - 4) break;              // losing the trade — stop
      }
    } catch (e) {} finally { try { bot.pvp.stop(); } catch (e) {} }
    const gone = !entOf(t) || !entOf(t).isValid;
    if (gone) return { branch: 'BREAK_LOS', how: 'wall+kill', placed };
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
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const cells = [];
  for (const dy of [0, 1]) for (const s of sides) cells.push(feet.offset(s[0], dy, s[1]));
  // The roof cell (feet+2) has NO orthogonal reference on open ground: below it is the
  // bot's own head space. Its side neighbours at the same y do have one (the head ring
  // directly beneath them), so lay those first and the cap becomes placeable. Underground
  // — the branch's real use case — these are already stone and cost nothing.
  for (const s of sides) cells.push(feet.offset(s[0], 2, s[1]));
  cells.push(feet.offset(0, 2, 0));                            // cap: skeletons shoot down shafts

  // Two passes: a cell with no solid neighbour to place against ('no_reference') often
  // gains one once its neighbours are up — pass 2 catches those. Bottom-up order matters,
  // so cells stays feet-ring -> head-ring -> roof.
  let placed = 0;
  const fails = [];
  for (const c of cells) {
    const r = await placeAt(c);
    if (r === 'placed') placed++;
    else if (r !== 'occupied') fails.push(c);
  }
  for (const c of fails.slice()) {
    const r = await placeAt(c);
    if (r === 'placed') { placed++; fails.splice(fails.indexOf(c), 1); }
  }
  // seal = re-read the world, not a running tally. Never report sealed on faith.
  const open = cells.filter((c) => !isSolid(bot.blockAt(c))).length;
  if (open) pushLog('warn', `wall_off: ${open} face(s) still open — coffin is not arrow-tight`);

  const t0 = Date.now();
  await eatUp();
  while (Date.now() - t0 < 60000) {
    if (bot.health >= g.cfg.regenHp && bot.food >= g.cfg.regenFood) break;
    await sleep(1000);
    if (bot.food < g.cfg.regenFood) await eatUp();
  }

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
  return { branch: 'WALL_OFF', sealed: open === 0, placed, openFaces: open, hp: bot.health, food: bot.food, exit: dug };
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

const enter = async (why) => {
  if (!g.enabled || g.active) return;
  if (Date.now() - g.lastEnd < g.cfg.lockoutMs) return;
  if (!bot.entity || bot.health <= 0) return;
  g.active = true; g.fires++; g.startedAt = Date.now();
  const guarded = suspendGuard();
  let out = null;
  const cap = setTimeout(() => { pushLog('error', 'panic run exceeded maxRunMs — forcing exit'); g.active = false; }, g.cfg.maxRunMs);
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
    g.branch = 'deciding';
    out = await pick();
    g.branch = out && out.branch;
    g.lastBranch = g.branch;
    g.recovered++;
    pushLog('warn', `panic_recovered branch=${g.branch} hp=${Math.round(bot.health)} — driver decides resume vs abort`);
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
g.runBranch = async (name, threat) => {
  const t = threat || threatsNow()[0] || null;
  const guarded = suspendGuard();
  try {
    switch (String(name || '').toUpperCase()) {
      case 'ENV': return await branchEnv(envHazard() || 'fire');
      case 'CREEPER': return await branchCreeper(t || { name: 'creeper', d: 3, id: null });
      case 'BREAK_LOS': return await branchBreakLOS(t || { name: 'skeleton', d: 10, ranged: true, los: true, id: null });
      case 'FLEE_HOME': return await branchFleeHome(t);
      case 'WALL_OFF': return await branchWallOff(t);
      default: return { error: 'unknown branch', known: ['ENV', 'CREEPER', 'BREAK_LOS', 'FLEE_HOME', 'WALL_OFF'] };
    }
  } finally { if (guarded) resumeGuard(); shieldDown(); }
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
REG.survival = { version: 1, boundAt: Date.now(), stale: false };
bot.once('end', () => {
  try {
    REG.survival.stale = true;
    g.enabled = false;
    if (g.subTimer) clearInterval(g.subTimer);
    resumeGuard();
  } catch (e) {}
});

return {
  installed: true, version: 1, home: g.home,
  dangerscan: Boolean(globalThis.__danger),
  skills: Boolean(globalThis.__skills),
  idleguard: Boolean(globalThis.__idleguard),
  branches: ['ENV', 'CREEPER', 'BREAK_LOS', 'FLEE_HOME', 'WALL_OFF'],
  replaces: 'panicguard.js',
};
