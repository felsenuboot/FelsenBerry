// farmskills.js — farm skill pack for the __skills engine (inject via POST /eval, idempotent).
//
// GitHub #5 farmCycle (autonomous harvest->collect->replant->bake->deposit loop),
// #13 tillFarmland (soil->farmland + optional plant), plus harvestGrass from the pool.
//
// STANDALONE injected module: it registers skills into the ALREADY-INSTALLED __skills via
// S.define, so it ships without editing the shared skills.js body (engine-dev-3 lane —
// collision avoidance). Inject skills.js FIRST. Add farmskills.js to runner.js's auto-inject
// list to persist across reconnects (it does NOT survive a reconnect on its own, exactly like
// a hand-injected payload — a warn line will show if __skills is missing).
//
// It reuses the engine's ctx primitives (digBlock / collectDrops / gotoNear / gotoSee /
// craftSafe / ensureTool / isProtected / placeBlockAt) so every house rule already lives in
// them: tool preflight + canHarvest gate, reach guard, the drop-sweep discipline, and the
// protected-structure target filter. The only farm-specific mechanics are three, and each is
// a live FEEDBACK finding, not a guess:
//   - TILL:  equip a hoe, lookAt the block's TOP FACE (pos + .5,1,.5), then
//            activateBlock(block, up-face Vec3(0,1,0)). center-face lookAt, a bare
//            activateBlock, or activateItem all SILENTLY NO-OP for tilling (karl+marcel).
//   - PLANT: equip the seed, placeBlock(farmland-below, up-face) with an own-hitbox step-aside
//            — same shape as chopTrees' sapling replant. ctx.placeBlockAt can't do wheat (its
//            place-item is wheat_seeds, not "wheat"), so planting is done here.
//   - MATURE: only age-max crops are harvested; an immature crop is NEVER dug. A protected
//            farm's crops stay harvestable because protected.json matches farmland/fence, not
//            the crop block, and crops are in neverProtect anyway.
//
// Remove with __farmskills.restore() (just deletes the registered skills).

if (!globalThis.__skills || typeof globalThis.__skills.define !== 'function') {
  return { installed: false, error: '__skills not installed — inject skills.js first, then farmskills.js' };
}
const S = globalThis.__skills;
const V = Vec3; // runner.js passes Vec3 into the payload AsyncFunction
// Same accessor as skills.js's own (#69 gap 1: depositItems moves real items through a chest
// and never told the ledger). No cross-module import — each payload keeps its own copy.
const MET = () => { try { return globalThis.__metrics; } catch (_) { return null; } };

// ---- constants (self-contained; skills.js keeps its own copies internal) ----
const AIR = new Set(['air', 'cave_air', 'void_air']);
const SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'dirt_path', 'farmland']);
const CLUTTER = new Set(['short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'leaf_litter']);
const CONTAINERS = new Set(['chest', 'trapped_chest', 'barrel']);
const GRASS = new Set(['short_grass', 'tall_grass', 'fern', 'large_fern']);

// crop key -> {seed item, planted block, ripe age, harvest product}
const CROPS = {
  wheat:     { seed: 'wheat_seeds',    block: 'wheat',     maxAge: 7, product: 'wheat' },
  carrots:   { seed: 'carrot',         block: 'carrots',   maxAge: 7, product: 'carrot' },
  potatoes:  { seed: 'potato',         block: 'potatoes',  maxAge: 7, product: 'potato' },
  beetroots: { seed: 'beetroot_seeds', block: 'beetroots', maxAge: 3, product: 'beetroot' },
};
const CROP_BLOCKS = new Set(Object.values(CROPS).map((c) => c.block));
const BLOCK_TO_CROP = {};
for (const [k, c] of Object.entries(CROPS)) BLOCK_TO_CROP[c.block] = k;
const ALL_HARVEST_ITEMS = [...new Set(Object.values(CROPS).flatMap((c) => [c.product, c.seed]))];

const withTimeout = (p, ms, label) => Promise.race([
  Promise.resolve(p),
  new Promise((_, rej) => setTimeout(() => rej(new Error(label || 'timeout')), ms)),
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// crop growth stage. Prefer the block-state property; fall back to metadata (age is metadata
// on this version for the vanilla crops, but getProperties() is the forward-safe read).
function cropAge(block) {
  if (!block) return null;
  try {
    const pr = block.getProperties ? block.getProperties() : null;
    if (pr && pr.age != null) return Number(pr.age);
  } catch (_) {}
  return typeof block.metadata === 'number' ? block.metadata : null;
}
function isMatureCrop(block) {
  const crop = BLOCK_TO_CROP[block && block.name];
  if (!crop) return false;
  const age = cropAge(block);
  return age != null && age >= CROPS[crop].maxAge;
}
function seedForCrop(cropKey) { return CROPS[cropKey] ? CROPS[cropKey].seed : null; }

// bot AABB (0.6 wide, 1.8 tall) vs the 1x1x1 cell at pos — a block can't be placed into a cell
// the bot occupies (the documented placeBlock own-hitbox no-op).
function overlapsCell(bot, pos) {
  const p = bot.entity.position;
  return (p.x - 0.3 < pos.x + 1) && (p.x + 0.3 > pos.x)
    && (p.z - 0.3 < pos.z + 1) && (p.z + 0.3 > pos.z)
    && (p.y < pos.y + 1) && (p.y + 1.8 > pos.y);
}

// Parse a field/rect spec into a list of ground-level cell positions (inclusive box or a cells[]
// list). {from:{x,y,z},to:{x,y,z}} | {min,max} | {cells:[{x,y,z}]}. Capped so a fat-fingered
// region can't spin forever.
function parseCells(spec) {
  if (!spec) return null;
  const CAP = 512;
  if (Array.isArray(spec.cells)) {
    return spec.cells.slice(0, CAP)
      .filter((c) => c && [c.x, c.y, c.z].every((n) => typeof n === 'number'))
      .map((c) => new V(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)));
  }
  const a = spec.from || spec.min;
  const b = spec.to || spec.max;
  if (!a || !b) return null;
  const y0 = Math.floor(Math.min(a.y != null ? a.y : spec.y, b.y != null ? b.y : spec.y));
  const y1 = Math.floor(Math.max(a.y != null ? a.y : spec.y, b.y != null ? b.y : spec.y));
  if (!isFinite(y0) || !isFinite(y1)) return null;
  const xs = [Math.floor(Math.min(a.x, b.x)), Math.floor(Math.max(a.x, b.x))];
  const zs = [Math.floor(Math.min(a.z, b.z)), Math.floor(Math.max(a.z, b.z))];
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = xs[0]; x <= xs[1]; x++) {
      for (let z = zs[0]; z <= zs[1]; z++) {
        out.push(new V(x, y, z));
        if (out.length >= CAP) return out;
      }
    }
  }
  return out;
}

// ---- shared mechanics (exposed on __farmskills so both skills reuse ONE implementation) ----

// Till one SOIL cell into farmland. pos = the ground block. Returns {ok, already?, reason?}.
// Never tills a protected structure block; never digs a crop.
async function tillCell(ctx, pos) {
  const bot = ctx.bot;
  ctx.step();
  let b = bot.blockAt(pos);
  if (!b) { try { await ctx.gotoNear(pos, 3, 15000); } catch (_) {} b = bot.blockAt(pos); }
  if (!b) return { ok: false, reason: 'unloaded' };
  if (b.name === 'farmland') return { ok: true, already: true };
  if (!SOIL.has(b.name)) return { ok: false, reason: 'not_soil', block: b.name };
  if (ctx.isProtected(pos, b.name)) return { ok: false, reason: 'protected' };

  // Something sitting on the soil? A crop means it's already farmed — leave it. Clutter
  // (grass/snow) gets cleared via the engine dig primitive so tilling can land.
  const abovePos = pos.offset(0, 1, 0);
  const above = bot.blockAt(abovePos);
  if (above && !AIR.has(above.name)) {
    if (CROP_BLOCKS.has(above.name)) return { ok: false, reason: 'crop_above', block: above.name };
    if (CLUTTER.has(above.name)) { try { await ctx.digBlock(abovePos); } catch (_) {} }
    else return { ok: false, reason: 'occupied_above', block: above.name };
  }

  const eye = () => bot.entity.position.offset(0, 1.6, 0);
  if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 3.6) {
    try { await ctx.gotoNear(pos, 2, 15000); } catch (_) {}
    if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.4) return { ok: false, reason: 'unreachable' };
  }
  const hoe = bot.inventory.items().find((i) => /_hoe$/.test(i.name));
  if (!hoe) return { ok: false, reason: 'no_hoe' };
  try { await withTimeout(bot.equip(hoe, 'hand'), 5000, 'equip_timeout'); } catch (_) {}
  b = bot.blockAt(pos);
  try {
    await bot.lookAt(pos.offset(0.5, 1, 0.5), true);       // TOP FACE — the load-bearing detail
    await withTimeout(bot.activateBlock(b, new V(0, 1, 0)), 4000, 'till_timeout');
  } catch (_) { /* verify below rather than trust the call */ }
  await sleep(350);                                         // settle before the confirming read
  const now = bot.blockAt(pos);
  return (now && now.name === 'farmland') ? { ok: true } : { ok: false, reason: 'till_no_effect', block: now && now.name };
}

// Plant a seed onto a farmland cell. pos = the farmland block; the crop grows at pos+1.
async function plantCell(ctx, pos, seedName) {
  const bot = ctx.bot;
  ctx.step();
  const farm = bot.blockAt(pos);
  if (!farm || farm.name !== 'farmland') return { ok: false, reason: 'not_farmland', block: farm && farm.name };
  const cropPos = pos.offset(0, 1, 0);
  const above = bot.blockAt(cropPos);
  if (above && CROP_BLOCKS.has(above.name)) return { ok: true, already: true };
  if (above && !AIR.has(above.name)) return { ok: false, reason: 'occupied', block: above.name };
  const seed = bot.inventory.items().find((i) => i.name === seedName);
  if (!seed) return { ok: false, reason: 'no_seed', seed: seedName };

  const eye = () => bot.entity.position.offset(0, 1.6, 0);
  if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 3.6) {
    try { await ctx.gotoNear(pos, 2, 15000); } catch (_) {}
  }
  // never plant into the bot's own hitbox — step aside like placeBlockAt does
  if (overlapsCell(bot, cropPos)) {
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      try { await ctx.gotoNear(pos.offset(dx, 0, dz), 1, 8000); } catch (_) { continue; }
      if (!overlapsCell(bot, cropPos)) break;
    }
    if (overlapsCell(bot, cropPos)) return { ok: false, reason: 'self_occupied' };
  }
  if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.4) return { ok: false, reason: 'unreachable' };
  try { await withTimeout(bot.equip(seed, 'hand'), 5000, 'equip_timeout'); } catch (_) {}
  try {
    await bot.lookAt(pos.offset(0.5, 1, 0.5), true);
    const pp = bot.placeBlock(farm, new V(0, 1, 0));
    pp.catch(() => {});                                     // placeBlock awaits blockUpdate, can hang — always raced
    await withTimeout(pp, 5000, 'place_timeout');
  } catch (_) { /* verify below */ }
  await sleep(300);
  const now = bot.blockAt(cropPos);
  return (now && CROP_BLOCKS.has(now.name)) ? { ok: true, block: now.name } : { ok: false, reason: 'plant_no_effect', block: now && now.name };
}

// Minimal deposit for farmCycle's depositTo step (skills.js's depositToChest is a top-level
// skill and can't be called re-entrantly from inside a running task; this deposits only a
// whitelist, so seeds are never banked away from replanting). Returns {moved, total}.
async function depositItems(ctx, chestPos, itemNames) {
  const bot = ctx.bot;
  const cp = new V(Math.floor(chestPos.x), Math.floor(chestPos.y), Math.floor(chestPos.z));
  try { await ctx.gotoNear(cp, 2, 25000); }
  catch (_) { try { await ctx.gotoSee(cp, 25000); } catch (_) {} }
  const chest = bot.blockAt(cp);
  if (!chest || !CONTAINERS.has(chest.name)) return { moved: {}, total: 0, reason: 'no_chest', found: chest && chest.name };
  if (cp.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.6, 0)) > 4.5) return { moved: {}, total: 0, reason: 'unreachable' };
  const want = new Set(itemNames);
  // openContainer has no internal timeout AND can genuinely fail (a blocked chest — a solid
  // block above it stops it opening in vanilla). Never let that hard-error the whole cycle:
  // the harvest is already banked in inventory, so a chest hiccup returns a reason and the
  // next pass retries. (ctx.step cancellation still propagates from the deposit loop below.)
  let win;
  try { win = await withTimeout(bot.openContainer(chest), 8000, 'chest_open_timeout'); }
  catch (e) { return { moved: {}, total: 0, reason: e.message || 'chest_open_failed' }; }
  const moved = {};
  try {
    for (const it of win.items().filter((i) => want.has(i.name))) {
      ctx.step();
      try { await win.deposit(it.type, null, it.count); moved[it.name] = (moved[it.name] || 0) + it.count; }
      catch (e) { if (/destination full/i.test(e.message)) break; if (/can't find/i.test(e.message)) continue; throw e; }
      await sleep(80);
    }
  } finally { try { win.close(); } catch (_) {} }
  const total = Object.values(moved).reduce((a, b) => a + b, 0);
  if (total > 0) ctx.say(('DEPOT ' + Object.entries(moved).map(([k, v]) => `+${v} ${k}`).join(' ')).slice(0, 140));
  // #69 gap 1: log the transaction (zero-moved included) — only reached once the chest was
  // actually opened, so an unreachable/missing chest above is a failed APPROACH, not a
  // zero-item VISIT, and does not get a chest record.
  try { const m = MET(); if (m && m.chest) m.chest('deposit', [cp.x, cp.y, cp.z], moved); } catch (_) {}
  return { moved, total };
}

const countItem = (bot, name) => bot.inventory.items().filter((i) => i.name === name).reduce((a, i) => a + i.count, 0);

// ---------------------------------------------------------------------------
// tillFarmland (#13)
// ---------------------------------------------------------------------------
S.define('tillFarmland', {
  description: 'Hoe soil into farmland over a rect or explicit cells; optionally plant a seed in each. Never digs crops or protected structure.',
  tool: 'hoe',
  params: {
    rect: 'box of ground cells: {from:{x,y,z},to:{x,y,z}} (y = the soil level)',
    cells: 'alternative to rect: [{x,y,z},...] explicit ground cells',
    plant: "optional seed item to plant in each tilled cell (e.g. 'wheat_seeds', 'carrot', 'potato', 'beetroot_seeds')",
  },
  validate: (a) => {
    if (!a.rect && !a.cells) return 'need rect:{from,to} or cells:[...]';
    if (a.cells && !Array.isArray(a.cells)) return 'cells must be an array of {x,y,z}';
    if (!parseCells(a.rect || a).length && !(a.cells && a.cells.length)) return 'rect/cells resolved to zero cells';
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const cells = parseCells(args.cells ? { cells: args.cells } : args.rect);
    if (!cells || !cells.length) return { tilled: 0, planted: 0, cells: 0 };
    const seedName = args.plant || null;

    ctx.setPhase('preparing', 'Grabbing a hoe for some tilling.');
    const tr = await ctx.ensureTool('hoe');
    if (!tr.ok) return { ok: false, error: { code: 'no_hoe', message: 'could not acquire a hoe (depot/craft both failed)', steps: tr.steps } };

    ctx.setPhase('tilling', `Tilling ${cells.length} cell${cells.length === 1 ? '' : 's'}${seedName ? ' and planting ' + seedName : ''}.`);
    let tilled = 0, planted = 0, already = 0, skipped = 0;
    const reasons = {};
    let i = 0;
    for (const pos of cells) {
      ctx.step();
      ctx.progress(++i, cells.length, 'cells');
      const tr2 = await tillCell(ctx, pos);
      if (tr2.ok && !tr2.already) tilled++;
      else if (tr2.already) already++;
      else { skipped++; reasons[tr2.reason] = (reasons[tr2.reason] || 0) + 1; continue; }
      if (seedName) {
        const pr = await plantCell(ctx, pos, seedName);
        if (pr.ok && !pr.already) planted++;
        else if (!pr.ok && pr.reason === 'no_seed') { reasons.no_seed = (reasons.no_seed || 0) + 1; }
      }
    }
    ctx.setPhase('finishing');
    await ctx.collectDrops(10, 8000, ALL_HARVEST_ITEMS);
    return { cells: cells.length, tilled, already, planted, skipped, ...(Object.keys(reasons).length ? { reasons } : {}) };
  },
  doneMsg: (t) => `Tilled ${t.result.tilled} new farmland${t.result.planted ? `, planted ${t.result.planted}` : ''}${t.result.skipped ? ` (${t.result.skipped} skipped)` : ''}.`,
});

// ---------------------------------------------------------------------------
// farmCycle (#5) — one full pass; queueable + onEmpty-safe (a no-mature-crop pass is a fast no-op)
// ---------------------------------------------------------------------------
S.define('farmCycle', {
  description: 'One farm pass over a field: harvest ripe crops, sweep drops, replant empties (re-tilling reverted soil), optionally bake bread at a wheat threshold, optionally deposit. A no-ripe-crop pass is a fast no-op, so it is safe as a queue onEmpty fallback.',
  tool: 'hoe',
  params: {
    field: 'box of farmland cells: {from:{x,y,z},to:{x,y,z}} (y = the farmland level; crops grow at y+1)',
    crop: "optional crop key ('wheat'|'carrots'|'potatoes'|'beetroots'); default: auto-detect from the field, fallback wheat",
    replant: 'bool (default true) — replant empty farmland (and re-till any cell that reverted to dirt/grass)',
    bakeAt: 'optional wheat-count threshold: at/above it, craft floor(wheat/3) bread',
    bakeTable: 'optional {x,y,z} of a crafting table for baking (else craftSafe auto-finds one within 4 blocks)',
    depositTo: 'optional {x,y,z} of a chest — deposit harvested products + bread (seeds are always kept for replanting)',
  },
  validate: (a) => {
    if (!a.field) return 'need field:{from,to}';
    const cells = parseCells(a.field);
    if (!cells || !cells.length) return 'field resolved to zero cells';
    if (a.crop && !CROPS[a.crop]) return `unknown crop '${a.crop}' (wheat|carrots|potatoes|beetroots)`;
    if (a.depositTo && ![a.depositTo.x, a.depositTo.y, a.depositTo.z].every((n) => typeof n === 'number')) return 'depositTo must be {x,y,z}';
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const cells = parseCells(args.field);
    const replant = args.replant !== false;

    // Get to the field first so every blockAt read below is a live, in-chunk read (stale
    // remote-chunk reads mis-report crop age — a documented quirk).
    ctx.setPhase('surveying', 'Checking the field.');
    const center = cells[Math.floor(cells.length / 2)];
    try { await ctx.gotoNear(center, 3, 25000); } catch (_) {}

    // crop type: explicit arg, else auto-detect from whatever is growing, else wheat
    let cropKey = args.crop || null;
    if (!cropKey) {
      for (const pos of cells) {
        const b = bot.blockAt(pos.offset(0, 1, 0));
        if (b && BLOCK_TO_CROP[b.name]) { cropKey = BLOCK_TO_CROP[b.name]; break; }
      }
      cropKey = cropKey || 'wheat';
    }
    const crop = CROPS[cropKey];
    const seedName = crop.seed;

    // ---- harvest ripe crops ----
    const ripe = [];
    for (const pos of cells) {
      const b = bot.blockAt(pos.offset(0, 1, 0));
      if (b && b.name === crop.block && isMatureCrop(b)) ripe.push(pos);
    }
    let harvested = 0;
    if (ripe.length) {
      ctx.setPhase('harvesting', `Harvesting ${ripe.length} ripe ${cropKey}.`);
      let h = 0;
      for (const pos of ripe) {
        ctx.step();
        ctx.progress(++h, ripe.length, 'crops');
        const cropPos = pos.offset(0, 1, 0);
        const b = bot.blockAt(cropPos);
        if (!b || b.name !== crop.block) continue;          // grew/changed since the survey
        const r = await ctx.digBlock(cropPos);
        if (r.ok && !r.already) harvested++;
      }
      ctx.setPhase('collecting', 'Sweeping up the harvest.');
      await ctx.collectDrops(Math.min(24, cells.length + 6), 20000, ALL_HARVEST_ITEMS);
    }

    // ---- replant empties (re-till any cell that reverted to dirt/grass) ----
    let replanted = 0, retilled = 0, seedShort = false;
    if (replant) {
      const empties = [];
      for (const pos of cells) {
        const ground = bot.blockAt(pos);
        if (!ground) continue;
        const above = bot.blockAt(pos.offset(0, 1, 0));
        const emptyAbove = !above || AIR.has(above.name);
        if (ground.name === 'farmland' && emptyAbove) empties.push({ pos, till: false });
        else if (SOIL.has(ground.name) && ground.name !== 'farmland' && emptyAbove && !ctx.isProtected(pos, ground.name)) empties.push({ pos, till: true });
      }
      if (empties.length) {
        ctx.setPhase('replanting', `Replanting ${empties.length} cell${empties.length === 1 ? '' : 's'}.`);
        if (empties.some((e) => e.till)) { const tr = await ctx.ensureTool('hoe'); if (!tr.ok) ctx.log('no hoe — cannot re-till reverted cells, will only replant existing farmland'); }
        let done = 0;
        for (const e of empties) {
          ctx.step();
          ctx.progress(++done, empties.length, 'replant');
          if (countItem(bot, seedName) <= 0) { seedShort = true; break; }
          if (e.till) { const tr = await tillCell(ctx, e.pos); if (!tr.ok) continue; retilled++; }
          const pr = await plantCell(ctx, e.pos, seedName);
          if (pr.ok && !pr.already) replanted++;
          else if (!pr.ok && pr.reason === 'no_seed') { seedShort = true; break; }
        }
      }
    }

    // ---- bake bread from surplus wheat ----
    let baked = 0;
    if (typeof args.bakeAt === 'number' && cropKey === 'wheat') {
      const wheat = countItem(bot, 'wheat');
      if (wheat >= args.bakeAt) {
        const batches = Math.floor(wheat / 3);
        if (batches > 0) {
          ctx.setPhase('baking', `Baking ${batches} bread.`);
          const opts = args.bakeTable ? { table: args.bakeTable } : {};
          const r = await ctx.craftSafe('bread', batches, opts);
          baked = r.made || 0;
          if (!baked && r.reason) ctx.log(`bake skipped: ${r.reason}`);
        }
      }
    }

    // ---- deposit products + bread (seeds always kept) ----
    let deposited = 0;
    if (args.depositTo && (harvested > 0 || baked > 0)) {
      ctx.setPhase('depositing', 'Banking the harvest.');
      const products = [...new Set(Object.values(CROPS).map((c) => c.product)), 'bread'];
      const d = await depositItems(ctx, args.depositTo, products);
      deposited = d.total || 0;
      if (d.reason) ctx.log(`deposit skipped: ${d.reason}${d.found ? ' (' + d.found + ')' : ''}`);
    }

    ctx.setPhase('finishing');
    return {
      crop: cropKey, mature: ripe.length, harvested, replanted, retilled, baked, deposited,
      ...(seedShort ? { seedShort: true } : {}),
    };
  },
  doneMsg: (t) => {
    const r = t.result;
    if (!r.harvested && !r.replanted && !r.baked) return `Field checked — nothing ripe yet.`;
    const bits = [];
    if (r.harvested) bits.push(`harvested ${r.harvested} ${r.crop}`);
    if (r.replanted) bits.push(`replanted ${r.replanted}`);
    if (r.baked) bits.push(`baked ${r.baked} bread`);
    if (r.deposited) bits.push(`banked ${r.deposited}`);
    return bits.join(', ') + (r.seedShort ? ' (ran low on seeds)' : '') + '.';
  },
});

// ---------------------------------------------------------------------------
// harvestGrass — cut short/tall grass & ferns for seeds; never digs terrain (pool item)
// ---------------------------------------------------------------------------
S.define('harvestGrass', {
  description: 'Cut short/tall grass & ferns within a radius (drops wheat seeds), collect drops. Only ever breaks grass/fern blocks — never terrain or structure.',
  params: { radius: 'search radius (default 16)', count: 'max grass blocks to cut (default 32)' },
  validate: (a) => (a.radius != null && !(a.radius > 0) ? 'radius must be > 0' : null),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const radius = args.radius || 16;
    const cap = args.count || 32;
    ctx.setPhase('scanning', 'Looking for grass to cut.');
    const ids = [...GRASS].map((n) => (bot.registry.blocksByName[n] || {}).id).filter((x) => x != null);
    let cut = 0, i = 0, probes = 0;
    while (cut < cap) {
      ctx.step();
      // findBlocks' maxDistance is a 3D SPHERE, so without a vertical gate this can select
      // grass many blocks BELOW the bot and walk it down a ravine to a stranded/mobbed death
      // (the shape that killed CAVECREW's Grog; MAX_BELOW=5 matches mineLane/chopTrees in
      // skills.js). Grass is a surface feature — never chase it downward.
      const floorY = Math.floor(bot.entity.position.y) - 5;
      const found = bot.findBlocks({ matching: ids, maxDistance: radius, count: 24 });
      const targets = found.filter((p) => !ctx.isProtected(p) && p.y >= floorY)
        .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));  // nearest first
      if (!targets.length) break;
      let progressed = false;
      for (const p of targets) {
        ctx.step();
        if (cut >= cap) break;
        const b = bot.blockAt(p);
        if (!b || !GRASS.has(b.name)) continue;             // changed since the scan
        // #70b: grass OUT OF REACH needs a goto — don't commit one to grass we have no route to
        // (MettMarcel's 8/8 no_path was harvestGrass reaching across the camp barrier). In-reach
        // grass digs in place, no probe. Bound the getPathTo probes so we never search a whole scan.
        if (p.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.6, 0)) > 4.4) {
          if (probes >= 8) break;                           // probed the nearest handful — stop
          probes++;
          if (!ctx.reachable(p, 2)) continue;               // unreachable: skip, no wasted goto
        }
        const r = await ctx.digBlock(p);
        if (r.ok && !r.already) { cut++; progressed = true; ctx.progress(cut, cap, 'grass'); }
      }
      if (!progressed && ++i > 2) break;                    // nothing reachable this scan — stop (cut:0 -> barren)
    }
    ctx.setPhase('collecting', 'Gathering seeds.');
    await ctx.collectDrops(radius, 15000, ['wheat_seeds', 'beetroot_seeds', 'short_grass', 'tall_grass']);
    return { cut };
  },
  doneMsg: (t) => (t.result && t.result.cut ? `Cut ${t.result.cut} grass.` : null),   // #67: "Cut 0 grass" is a no-op — log-only, no chat
});

// ---- registry + staleness bookkeeping (mirror the other payloads) ----
const NAMES = ['tillFarmland', 'farmCycle', 'harvestGrass'];
const fg = globalThis.__farmskills = {
  version: 3, skills: NAMES,
  tillCell, plantCell,   // exposed so future skills reuse ONE implementation
  restore() { for (const n of NAMES) { try { delete S.registry[n]; } catch (_) {} } },
};
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.farmskills = { version: 3, boundAt: Date.now(), stale: false };
try { bot.once('end', () => { try { REG.farmskills.stale = true; } catch (_) {} }); } catch (_) {}

return { installed: true, version: 3, skills: NAMES };
