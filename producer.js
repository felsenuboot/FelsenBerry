// producer.js — the PRODUCE side of self-sufficiency (team-lead assignment, the other half of
// engine-dev-3's RESTOCK-churn finding). "Acquire by PRODUCING, not just withdrawing."
//
// The gap: on a fresh/depot-less world a bot can't WITHDRAW consumables it also can't get any
// other way (torches especially — not mineable, and restock only withdraws), so RESTOCK could
// never satisfy a deep-descent kit and the soak stalled. This gives RESTOCK a produce-fallback:
// make the consumable from raw materials it can mine and craft.
//
// INTERFACE (agreed with engine-dev-2, who owns agenda.js and wires the fallback):
//   __skills.produce(bot, resource, count, opts) -> { ok, made, how, steps[], reason }
//   - resource is an ITEM NAME ('torch'|'cobblestone'|'coal'|'stick'|'*_planks'), not a category.
//   - how: 'mined' | 'crafted' | 'gathered' — so the ladder logs producing vs withdrawing honestly.
//   - PARTIAL SUCCESS, never throws: {ok:true, made:8} when 16 was asked is real progress the
//     ladder can act on. Full success => reason undefined; made>0<count => reason:'partial'.
//   - Unproduceable-right-now => {ok:false, reason:<typed>}: no_pickaxe | no_coal_nearby | no_wood
//     | craft_failed | unproduceable — a code to branch on, not a message string.
//   - ONE-SHOT, no internal retry loop. The ladder owns retry cadence + backoff (two stacked
//     retry policies is how you get the churn we just fixed).
//
// SHAPES: the AGENDA starts the `produce` SKILL (S.define below) via runSkill — that's the shape
// with the task mutex, telemetry, clean preemption, and no act-cap collision (see the wrapper's
// own comment for why a blocking-method-in-act is the wrong shape). `S.produce(bot,...)` is the
// implementation, for calling from INSIDE another skill's fn where a ctx already exists (pass
// {ctx} so it cancels at a step boundary). Reuses S.craftSafe + S.ensureTool, and the DISCIPLINE
// from craftToolChain (bill via planks + logs*4; the Δy surface filter on wood; the sanctioned
// force:true hand-on-log bootstrap) WITHOUT calling it — that chain is skills.js-internal and
// tool-specific, and the whole torch line (torch/stick/planks are all 2x2-or-smaller) needs NO
// crafting table, so it sidesteps the table/head-planks bill bug entirely.
//
// Remove: __producer.restore()
if (!globalThis.__skills || typeof globalThis.__skills.define !== 'function') {
  return { installed: false, error: '__skills not installed — inject skills.js first, then producer.js' };
}
const S = globalThis.__skills;

const SPECIES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove'];
const LOG_NAMES = SPECIES.map((s) => s + '_log');
const COAL_ORE = ['coal_ore', 'deepslate_coal_ore'];
const MAX_BELOW = 5;                 // wood: never chase it DOWN a ravine (the Grog anti-descent rule)
const MAX_ABOVE = 10;                // ...and BOUND IT ABOVE too — matches engine-dev-2's v31 fix to
                                     // craftToolChain: a one-sided filter let a bot at y73 "find" trees
                                     // at y113, then spend 36s failing to path up to each before
                                     // reporting no_wood — a reachability failure masquerading as supply.
const MINE_RADIUS = 20;
// Ore/stone IS underground, so no surface filter — but an unbounded 3D findBlocks would let
// produce chase a deep vein straight down a ravine to the stranded-and-mobbed death engine-dev-2
// flagged for harvestGrass (CAVECREW's Grog, y89->y26). produce grabs what is NEARBY; genuinely
// deep mining is a PROJECT (mineLane/safeDescend, which handle torches + hazards), not this. So
// cap how far below the bot it will pursue ore — enough to dig down a few blocks for surface
// stone, not enough to descend into a cave system.
const MAX_MINE_BELOW = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inv = (bot, n) => bot.inventory.items().filter((i) => i.name === n).reduce((a, i) => a + i.count, 0);
const invRe = (bot, re) => bot.inventory.items().filter((i) => re.test(i.name)).reduce((a, i) => a + i.count, 0);
const idsOf = (bot, names) => names.map((n) => (bot.registry.blocksByName[n] || {}).id).filter((x) => x != null);
const isProt = (bot, pos) => { try { const dg = globalThis.__digguard; return dg && dg.hit ? Boolean(dg.hit(pos)) : false; } catch (_) { return false; } };

// bounded goto — bot.pathfinder.goto has no timeout, and a leaked goal poisons the next one,
// so always clear it on exit (same reasoning as ctx.goto / gotoT in skills.js).
async function gotoT(bot, x, y, z, range = 2, ms = 20000) {
  let timer;
  try {
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(x, y, z, range)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('goto_timeout')), ms); }),
    ]);
    return true;
  } catch (_) { try { bot.pathfinder.setGoal(null); } catch (_) {} return false; }
  finally { clearTimeout(timer); }
}

// dig a reachable block, then hop onto its cell to sweep the drop (vanilla pickup ~1 block).
// bot.dig goes through toolguard, which auto-equips the best owned tool (the pickaxe ensured
// upstream) and rejects tool_missing if none — so no manual equip here.
async function digAt(bot, pos, force) {
  let b = bot.blockAt(pos);
  if (!b || b.name === 'air' || b.name === 'cave_air') return { ok: true, already: true };
  const eye = () => bot.entity.position.offset(0, 1.6, 0);
  if (pos.offset(0.5, 0.5, 0.5).distanceTo(eye()) > 4.0) {
    if (!await gotoT(bot, pos.x, pos.y, pos.z, 2, 15000)) return { ok: false, reason: 'unreachable' };
    b = bot.blockAt(pos);
    if (!b || b.name === 'air' || b.name === 'cave_air') return { ok: true, already: true };
  }
  try { await bot.dig(b, true, force ? { force: true } : undefined); }
  catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 40) }; }
  await gotoT(bot, pos.x, pos.y, pos.z, 1, 5000);   // step onto the drop
  await sleep(300);
  return { ok: true };
}

// mine ore/stone until `want` of `product` is in inventory or nothing reachable remains.
// chk() is the cancellation hook (ctx.step when run as a skill) — it THROWS to stop cleanly.
async function mineProduct(bot, oreNames, product, want, steps, chk) {
  const oreIds = idsOf(bot, oreNames);
  const noun = product === 'coal' ? 'coal' : 'ore';
  // TODO 7c (#71): cheap existence check BEFORE spending anything on a pickaxe. Live-caught:
  // a bot with no pickaxe AND no ore nearby (the produce('torch') coal-fallback path from a
  // sealed/deep spot, no reachable stone-tier ore at all) used to call `S.ensureTool(bot,
  // 'pickaxe', {})` UNCONDITIONALLY first — which, holding nothing, tries to bootstrap a whole
  // wooden pickaxe from scratch (gather logs, craft planks/sticks/table) before ever checking
  // whether there was anything to MINE with it. Measured live: 25.6s spent acquiring nothing,
  // every single retry cycle (every PRODUCE_COOLDOWN_MS, agenda.js), before finally falling
  // through to `no_pickaxe`/`no_fuel` — not a literal infinite loop, but a real, recurring,
  // wasted-effort deadlock from a live bot's perspective ("parks one torch short forever").
  // The SAME origin-anchored, protection-filtered scan the real mining loop below uses (#91's
  // own doctrine — bounded, not a wandering search) decides in one cheap `findBlocks` call
  // whether acquiring a tool is even worth attempting.
  const origin = bot.entity.position.clone();
  const floorY0 = Math.floor(bot.entity.position.y) - MAX_MINE_BELOW;
  const anyOreNearby = bot.findBlocks({ matching: oreIds, maxDistance: MINE_RADIUS, count: 1 })
    .some((p) => !isProt(bot, p) && p.y >= floorY0 && p.distanceTo(origin) <= MINE_RADIUS);
  if (!anyOreNearby) { steps.push('mine:no_' + noun + '_nearby'); return { ok: false, made: 0, how: 'mined', reason: 'no_' + noun + '_nearby', steps }; }
  const tr = await S.ensureTool(bot, 'pickaxe', {});
  steps.push('pick:' + tr.how);
  if (!tr.ok) return { ok: false, made: 0, how: 'mined', reason: 'no_pickaxe', steps };
  if (bot.inventory.emptySlotCount() === 0) return { ok: false, made: 0, how: 'mined', reason: 'no_space', steps };
  const start = inv(bot, product);
  // #91 forensics (OhneHoseOtto, GEAR-RACE run #1, 2026-09-02): findBlocks was centred on the
  // bot's CURRENT position every scan, with no bound on how far the WHOLE multi-scan pass
  // could wander chasing "nearest unmined stone" — over up to 60 iterations that is an
  // unbounded random walk, and it is what actually dug this bot into a fully-enclosed dead
  // end with no path back (the #89 specimen; NOT a WALL_OFF seal — zero panic/danger events
  // ever fired for that bot — and NOT mineLane, which never once ran there, always
  // kit_missing). Anchor the search to where THIS CALL started (same `origin` as the
  // existence check above), same MINE_RADIUS, so a mining pass explores a bounded area
  // instead of marching progressively further with every scan. Nothing left reachable within
  // that area now hits the existing "found.length===0" exit and reports partial — the same
  // honest stop, reached for the right reason.
  let scans = 0, stagnant = 0, spaceOut = false;
  while (inv(bot, product) - start < want && scans++ < 60) {
    chk();
    if (bot.inventory.emptySlotCount() === 0) { spaceOut = true; break; }
    const before = inv(bot, product);
    const floorY = Math.floor(bot.entity.position.y) - MAX_MINE_BELOW;
    const found = bot.findBlocks({ matching: oreIds, maxDistance: MINE_RADIUS, count: 8 })
      .filter((p) => !isProt(bot, p) && p.y >= floorY && p.distanceTo(origin) <= MINE_RADIUS);
    if (!found.length) break;
    for (const p of found) {
      chk();
      if (inv(bot, product) - start >= want) break;
      if (bot.inventory.emptySlotCount() === 0) { spaceOut = true; break; }
      await digAt(bot, p, false);
    }
    if (spaceOut) break;
    if (inv(bot, product) <= before) { if (++stagnant >= 2) break; } else stagnant = 0;
  }
  const made = inv(bot, product) - start;
  const reason = made >= want ? undefined : (spaceOut ? 'no_space' : (made > 0 ? 'partial' : 'no_' + noun + '_nearby'));
  return { ok: made > 0, made, how: 'mined', reason, steps };
}

// gather logs by hand (bootstrap: no axe yet is fine, logs drop bare-handed — the one
// sanctioned force dig) until `wantLogs` are held or no reachable surface wood remains
async function gatherLogs(bot, wantLogs, steps, chk) {
  if (invRe(bot, /_log$/) >= wantLogs) return true;
  const myY = Math.floor(bot.entity.position.y);
  const found = bot.findBlocks({ matching: idsOf(bot, LOG_NAMES), maxDistance: 48, count: 16 })
    .filter((p) => p.y >= myY - MAX_BELOW && p.y <= myY + MAX_ABOVE && !isProt(bot, p));
  if (found.length) {
    steps.push('gather:wood');
    for (const p of found) {
      chk();
      if (invRe(bot, /_log$/) >= wantLogs) break;
      if (!await gotoT(bot, p.x, p.y, p.z, 2, 20000)) continue;
      const blk = bot.blockAt(p);
      if (!blk || !/_log$/.test(blk.name)) continue;
      try { await bot.dig(blk, true, { force: true }); } catch (_) {}
      await gotoT(bot, p.x, p.y, p.z, 1, 5000);
      await sleep(300);
    }
  }
  return invRe(bot, /_log$/) >= wantLogs;
}

// craft up to `wantPlanks` planks total (gather logs when the plank+log*4 supply can't cover it)
async function ensurePlanks(bot, wantPlanks, steps, chk) {
  if (invRe(bot, /_planks$/) >= wantPlanks) return true;
  const needLogs = Math.ceil((wantPlanks - invRe(bot, /_planks$/)) / 4);
  if (invRe(bot, /_log$/) < needLogs) await gatherLogs(bot, needLogs, steps, chk);
  let guard = 0;
  while (guard++ < 24 && invRe(bot, /_planks$/) < wantPlanks) {
    chk();
    const lg = bot.inventory.items().find((i) => /_log$/.test(i.name));
    if (!lg) break;
    const r = await S.craftSafe(bot, lg.name.replace(/_log$/, '_planks'), 1);
    if (!r.made) break;
  }
  steps.push('planks:' + invRe(bot, /_planks$/));
  return invRe(bot, /_planks$/) >= wantPlanks;
}

// craft until `wantSticks` sticks are held (2 planks -> 4 sticks; gather+plank as needed)
async function ensureSticks(bot, wantSticks, steps, chk) {
  if (inv(bot, 'stick') >= wantSticks) return true;
  const stickBatches = Math.ceil((wantSticks - inv(bot, 'stick')) / 4);
  // Gather what wood we can, but craft from the planks ALREADY in the bag even if that falls
  // short of the full target — a deep bot with 8 planks and no reachable tree must still make
  // its 16 sticks rather than report no_wood and make zero. (ensurePlanks itself crafts the
  // partial; only this caller used to bail on its false return.) The craft loop below stops
  // on its own when planks run out, so entering it unconditionally is safe.
  await ensurePlanks(bot, stickBatches * 2, steps, chk);
  let guard = 0;
  while (guard++ < 24 && inv(bot, 'stick') < wantSticks) {
    chk();
    const r = await S.craftSafe(bot, 'stick', 1);
    if (!r.made) break;
  }
  steps.push('sticks:' + inv(bot, 'stick'));
  return inv(bot, 'stick') >= wantSticks;
}

// TODO 5e follow-up (cook/smelt): shared furnace lookup, factored out of smeltCharcoal (below)
// so cookMeat (also below) doesn't duplicate the find-or-craft-and-place dance. Same behaviour
// as smeltCharcoal had inline: reuse one within 24 blocks, else craft+place from 8 cobblestone.
async function findOrMakeFurnace(bot, steps, tag) {
  let fblk = bot.findBlock({ matching: idsOf(bot, ['furnace', 'blast_furnace']), maxDistance: 24 });
  if (!fblk && inv(bot, 'cobblestone') >= 8) {
    if ((await S.craftSafe(bot, 'furnace', 1)).made) {
      try {
        const spot = bot.entity.position.offset(1, 0, 0).floored();
        const under = bot.blockAt(spot.offset(0, -1, 0));
        const fitem = bot.inventory.items().find((i) => i.name === 'furnace');
        if (under && under.boundingBox === 'block' && fitem) {
          await bot.equip(fitem, 'hand');
          await bot.lookAt(spot.offset(0.5, 0.5, 0.5), true);
          await bot.placeBlock(under, new Vec3(0, 1, 0));
        }
      } catch (_) {}
      fblk = bot.findBlock({ matching: idsOf(bot, ['furnace', 'blast_furnace']), maxDistance: 6 });
    }
  }
  if (!fblk) { steps.push((tag || 'smelt') + ':no_furnace'); return null; }
  return fblk;
}

// #71: smelt logs -> charcoal (torch fuel) when there's no coal. A bot with logs and a furnace
// can always make torches, where MINING coal at a treeline base cannot — so this is what lets
// RESTOCK close a torch shortfall instead of parking one torch short (FurzFriedrich: 7 torches,
// 0 coal, 233 logs, furnace nearby, deadlocked forever). `want` is a TOTAL charcoal target.
// Bounded (need*~12s smelt) and cancellable via chk().
async function smeltCharcoal(bot, want, steps, chk) {
  if (inv(bot, 'charcoal') >= want) return true;
  const need = Math.max(1, want - inv(bot, 'charcoal'));
  // logs for INPUT (1 log -> 1 charcoal) and FUEL (a log burns ~1.5 items)
  const wantLogs = need + Math.ceil(need / 1.5) + 1;
  if (invRe(bot, /_log$/) < wantLogs) await gatherLogs(bot, wantLogs, steps, chk);
  if (invRe(bot, /_log$/) < 2) { steps.push('smelt:no_logs'); return false; }

  const fblk = await findOrMakeFurnace(bot, steps, 'smelt');
  if (!fblk) return false;
  if (!await gotoT(bot, fblk.position.x, fblk.position.y, fblk.position.z, 2, 20000)) { steps.push('smelt:unreachable'); return false; }

  let furnace;
  try { furnace = await bot.openFurnace(fblk); } catch (_) { steps.push('smelt:open_failed'); return false; }
  try {
    const logType = () => { const l = bot.inventory.items().find((i) => /_log$/.test(i.name)); return l ? l.type : null; };
    if (!furnace.fuelItem()) { const ft = logType(); if (ft != null) await furnace.putFuel(ft, null, Math.max(1, Math.ceil(need / 1.5))); }
    const it = logType();
    if (it == null) return false;
    await furnace.putInput(it, null, need);
    const t0 = Date.now(), budget = need * 12000 + 15000;
    while (Date.now() - t0 < budget) {
      chk();
      const out = furnace.outputItem();
      if (out && out.count >= need) break;
      if (!furnace.fuelItem() && (!out || out.count < need)) { const ft = logType(); if (ft != null) await furnace.putFuel(ft, null, 2); }
      await sleep(1000);
    }
    if (furnace.outputItem()) await furnace.takeOutput();
    if (furnace.inputItem()) { try { await furnace.takeInput(); } catch (_) {} }   // reclaim unsmelted logs
    if (furnace.fuelItem()) { try { await furnace.takeFuel(); } catch (_) {} }      // reclaim leftover fuel
  } catch (e) {
    if (e && (e.cancelled || e.fatal)) throw e;   // task-control signals pass through
  } finally { try { furnace.close(); } catch (_) {} }
  steps.push('smelt:charcoal=' + inv(bot, 'charcoal'));
  return inv(bot, 'charcoal') >= 1;
}

// TODO 5e follow-up: cook/smelt, flagged as an unbuilt gap when #113 shipped ("a role-less
// racer that hunts its way to raw meat still cannot satisfy a COOKED-food gate by any legal
// path — no cook/smelt skill exists"). Cooks whatever raw meat the bot is ALREADY holding
// (RAW_MEATS below), one species at a time (a vanilla furnace only smelts one input item type
// per input slot), up to `want` TOTAL cooked items across however many species are held —
// mirrors smeltCharcoal's own shape (find/craft a furnace, feed input+fuel, wait, collect).
// Deliberately covers `chicken`: raw chicken is excluded from FOODS (#108's own argued
// poison-risk call) but COOKED chicken is completely safe — cooking is literally how a human
// neutralizes that risk, not just a saturation upgrade for the other four.
const RAW_MEATS = ['beef', 'porkchop', 'mutton', 'chicken', 'rabbit'];
// coal > charcoal > planks, per the ask ("fuel (coal/charcoal/planks from inventory, planks as
// fallback)") — deliberately does NOT gather/produce fuel on its own the way smeltCharcoal
// gathers logs: cookMeat is meant to be a CHEAP finishing step on food already in hand, not
// another multi-minute acquisition chain layered under FOOD's own already-multi-step hunt.
// No fuel on hand -> `no_fuel`, same honest-partial doctrine as every other branch here.
function cookFuelItem(bot) {
  return bot.inventory.items().find((i) => i.name === 'coal')
    || bot.inventory.items().find((i) => i.name === 'charcoal')
    || bot.inventory.items().find((i) => /_planks$/.test(i.name));
}
async function cookMeat(bot, want, steps, chk) {
  const heldRaw = () => RAW_MEATS.filter((m) => inv(bot, m) > 0);
  if (!heldRaw().length) { steps.push('cook:no_raw_meat'); return 0; }
  if (!cookFuelItem(bot)) { steps.push('cook:no_fuel'); return 0; }
  const fblk = await findOrMakeFurnace(bot, steps, 'cook');
  if (!fblk) return 0;
  if (!await gotoT(bot, fblk.position.x, fblk.position.y, fblk.position.z, 2, 20000)) { steps.push('cook:unreachable'); return 0; }

  // Snapshot BEFORE opening the furnace window. Live-caught building this: `bot.inventory.
  // items()` counts items sitting in an OPEN container's own slots too — a cooked item that
  // just landed in the furnace's output slot already read as "in inventory" well before
  // takeOutput() ever moved it into the player's true slots, so comparing a before/after count
  // taken WHILE the window stayed open always measured a zero delta, even on a real,
  // successful cook (confirmed live: raw meat consumed, cooked item genuinely present a
  // moment later, `made` still reported 0). Snapshotting before open + reading the final
  // count only after `furnace.close()` (below) is the fix — not a settle delay, an actual
  // wrong-window bug.
  const beforeCooked = {};
  for (const meat of heldRaw()) beforeCooked[meat] = inv(bot, 'cooked_' + meat);

  let furnace;
  try { furnace = await bot.openFurnace(fblk); } catch (_) { steps.push('cook:open_failed'); return 0; }
  try {
    for (const meat of Object.keys(beforeCooked)) {
      chk();
      const count = inv(bot, meat);
      if (!count) continue;
      const it = bot.inventory.items().find((i) => i.name === meat);
      if (!it) continue;
      if (!furnace.fuelItem()) {
        const f = cookFuelItem(bot);
        if (!f) break;   // ran out of fuel mid-batch — stop, don't stall on an empty furnace
        await furnace.putFuel(f.type, null, Math.max(1, Math.ceil(count / 1.5)));
      }
      await furnace.putInput(it.type, null, count);
      const t0 = Date.now(), budget = count * 12000 + 15000;
      while (Date.now() - t0 < budget) {
        chk();
        const out = furnace.outputItem();
        if (out && out.count >= count) break;
        if (!furnace.fuelItem()) {
          const f = cookFuelItem(bot);
          if (!f) break;
          await furnace.putFuel(f.type, null, 2);
        }
        await sleep(1000);
      }
      if (furnace.outputItem()) await furnace.takeOutput();
      if (furnace.inputItem()) { try { await furnace.takeInput(); } catch (_) {} }   // reclaim unsmelted raw
    }
    if (furnace.fuelItem()) { try { await furnace.takeFuel(); } catch (_) {} }
  } catch (e) {
    if (e && (e.cancelled || e.fatal)) throw e;
  } finally { try { furnace.close(); } catch (_) {} }
  // Read the TRUE final count only now the window is closed (see the snapshot comment above).
  let madeTotal = 0;
  for (const meat of Object.keys(beforeCooked)) madeTotal += inv(bot, 'cooked_' + meat) - beforeCooked[meat];
  steps.push('cook:made=' + madeTotal);
  return madeTotal;
}

// ---- the public method ----
S.produce = async function (bot, resource, wantCount, opts = {}) {
  const want = wantCount || 16;
  const steps = [];
  const R = String(resource);
  // cancellation hook: when produce runs INSIDE the produce skill, opts.ctx.step() throws
  // Cancelled the moment survival/POSTURE stops the task — so a long mine/chop yields the body
  // at a step boundary instead of steering it while unowned. A bare method call passes no ctx
  // and chk is a no-op. ctx.step also enforces the low-health guard as a fatal.
  const chk = (opts && opts.ctx && typeof opts.ctx.step === 'function') ? () => opts.ctx.step() : () => {};
  try {
    // MINED consumables
    if (R === 'cobblestone' || R === 'filler' || R === 'stone') return await mineProduct(bot, ['stone'], 'cobblestone', want, steps, chk);
    if (R === 'coal') return await mineProduct(bot, COAL_ORE, 'coal', want, steps, chk);

    // CRAFTED wood chain
    if (R === 'oak_planks' || /_planks$/.test(R)) {
      const before = invRe(bot, /_planks$/);
      const ok = await ensurePlanks(bot, before + want, steps, chk);
      const made = invRe(bot, /_planks$/) - before;
      return { ok: made > 0, made, how: made > 0 ? 'crafted' : null, reason: (ok || made >= want) ? undefined : (made > 0 ? 'partial' : 'no_wood'), steps };
    }
    if (R === 'stick') {
      const before = inv(bot, 'stick');
      await ensureSticks(bot, before + want, steps, chk);
      const made = inv(bot, 'stick') - before;
      return { ok: made > 0, made, how: made > 0 ? 'crafted' : null, reason: made >= want ? undefined : (made > 0 ? 'partial' : 'no_wood'), steps };
    }

    // TORCH: the two-step chain (coal + stick -> 4 torches; no crafting table needed)
    if (R === 'torch') {
      const beforeT = inv(bot, 'torch');
      const batches = Math.ceil(want / 4);
      // #71: fuel is coal OR charcoal — both craft torches. Mine coal if a vein is near (cheap),
      // then SMELT logs -> charcoal, which a treeline base can always do where coal-mining can't.
      const fuel = () => inv(bot, 'coal') + inv(bot, 'charcoal');
      if (fuel() < batches) {
        if (inv(bot, 'coal') < batches) await mineProduct(bot, COAL_ORE, 'coal', batches - inv(bot, 'coal'), steps, chk);
        if (fuel() < batches) await smeltCharcoal(bot, Math.max(1, batches - inv(bot, 'coal')), steps, chk);
        if (fuel() < 1) return { ok: false, made: 0, how: 'crafted', reason: 'no_fuel', steps };
      }
      if (inv(bot, 'stick') < batches) {
        await ensureSticks(bot, batches, steps, chk);
        if (inv(bot, 'stick') < 1) return { ok: false, made: 0, how: 'crafted', reason: 'no_wood', steps };
      }
      let guard = 0;
      while (guard++ < want + 4 && inv(bot, 'torch') - beforeT < want && fuel() > 0 && inv(bot, 'stick') > 0) {
        chk();
        const r = await S.craftSafe(bot, 'torch', 1);
        if (!r.made) break;
      }
      const made = inv(bot, 'torch') - beforeT;
      return { ok: made > 0, made, how: 'crafted', reason: made >= want ? undefined : (made > 0 ? 'partial' : 'craft_failed'), steps };
    }

    // COOKED_MEAT: TODO 5e follow-up. Cooks whatever raw meat is ALREADY held (see cookMeat's
    // own header) — never gathers/hunts on its own, that is FOOD's own job one layer up.
    if (R === 'cooked_meat') {
      const made = await cookMeat(bot, want, steps, chk);
      return { ok: made > 0, made, how: made > 0 ? 'smelted' : null,
        reason: made >= want ? undefined : (made > 0 ? 'partial' : (steps[steps.length - 1] || 'unproduceable').replace(/^cook:/, '')),
        steps };
    }

    // CRAFTING_TABLE (4 planks -> 1 table; 2x2, no table needed). Team-lead greenlit this as the
    // enabler for #43 item(1) (promoted to phase-1): the deep kit now carries the makings of an
    // in-place tool re-craft, and RESTOCK's floor calls produce('crafting_table',1) to self-heal it
    // — otherwise the new kit floor would be a permanent refusal no rung could satisfy.
    if (R === 'crafting_table') {
      const before = inv(bot, 'crafting_table');
      if (before < want) {
        // Gather what wood we can, then craft from the planks in hand even if short of the full
        // bill — the same partial-craft discipline as ensureSticks/ensurePlanks. Reachable via
        // the public produce('crafting_table') default of want=16 (producer.js:284): a bot with
        // planks but no reachable wood used to return no_wood/made:0 instead of floor(planks/4)
        // tables. RESTOCK's want=1 ask masks it, but it is a real defect. The loop stops on its
        // own when planks run out (craftSafe returns !made).
        await ensurePlanks(bot, 4 * (want - before), steps, chk);
        let guard = 0;
        while (guard++ < want + 2 && inv(bot, 'crafting_table') - before < want) {
          chk();
          const r = await S.craftSafe(bot, 'crafting_table', 1);
          if (!r.made) break;
        }
      }
      const made = inv(bot, 'crafting_table') - before;
      return { ok: made > 0, made, how: made > 0 ? 'crafted' : null, reason: made >= want ? undefined : (made > 0 ? 'partial' : 'no_wood'), steps };
    }

    return { ok: false, made: 0, how: null, reason: 'unproduceable', steps };
  } catch (e) {
    // cancellation and fatal (low_health) are task-control signals, NOT produce failures —
    // re-throw so the skill task cancels/aborts cleanly instead of reporting a swallowed 'error'.
    if (e && (e.cancelled || e.fatal)) throw e;
    // everything else: never throw — a produce failure is a stand-down signal, not a crash.
    return { ok: false, made: 0, how: null, reason: 'error', steps: [...steps, String(e.message || e).slice(0, 60)] };
  }
};

// ---- thin SKILL wrapper over the method (agenda RESTOCK calls runSkill('produce', {resource,count})) ----
// engine-dev-2's contract, and the ACT_TIMEOUT reasoning inverts to require it: a blocking method
// awaited inside an agenda act holds A.busy for the whole run, and a torch-from-scratch chain can
// exceed the 180s cap — at which point the ladder force-releases busy and stands the rung down
// WHILE the method keeps running unowned, two things steering the body (the /goto2 interference
// class). A skill's act instead starts the task and returns immediately, reporting 'running' each
// tick with no cap pressure. So the skill is the shape the agenda starts; the method stays the
// implementation for calling from inside other skills where a ctx already exists. The skill also
// gets the task mutex, telemetry (a task_start/end + an ASSERTS grade — produce is precisely the
// thing that can 'finish' with made<count, a textbook yield), and clean preemption via ctx.step.
S.define('produce', {
  description: 'Acquire a consumable by MAKING it (mine/chop/craft) rather than withdrawing — the agenda RESTOCK produce-fallback. resource is an item name; result carries {ok, made, how, reason}.',
  params: { resource: 'item name: torch | cobblestone | coal | stick | *_planks | crafting_table | cooked_meat', count: 'how many (default 16)' },
  tool: null,
  validate: (a) => (a.resource && typeof a.resource === 'string') ? null : 'need resource (item name string)',
  fn: async (ctx) => {
    // pass ctx so the method's loops cancel at a step boundary. The result object — including
    // ok:false + a typed reason on a partial/failure — becomes task.result and is NOT thrown, so
    // a shortfall reads as an honest partial the ladder can grade, not a task error + stand-down.
    return await S.produce(ctx.bot, ctx.args.resource, ctx.args.count || 16, { ctx });
  },
  doneMsg: (t) => {
    const r = t.result || {};
    if (!r.made) return null;   // #67: "Produced 0 X — no_coal_nearby" is a no-op — log-only, no chat
    return `Produced ${r.made} ${t.args.resource}${r.how ? ' (' + r.how + ')' : ''}${r.reason ? ' — ' + r.reason : ''}.`;
  },
});

// ---- bookkeeping (mirror the other payloads) ----
globalThis.__producer = {
  version: 9,
  restore() { try { delete S.produce; } catch (_) {} try { delete S.registry.produce; } catch (_) {} },
};
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.producer = { version: 9, boundAt: Date.now(), stale: false };
try { bot.once('end', () => { try { REG.producer.stale = true; } catch (_) {} }); } catch (_) {}

return { installed: true, version: 9,
  method: '__skills.produce(bot, resource, count, opts)',
  skill: "runSkill('produce', {resource, count})  // agenda RESTOCK fallback shape",
  resources: ['torch', 'cobblestone', 'coal', 'stick', '*_planks', 'crafting_table', 'cooked_meat'],
  reasons: ['no_pickaxe', 'no_coal_nearby', 'no_fuel', 'no_ore_nearby', 'no_wood', 'no_space', 'no_raw_meat', 'no_furnace', 'unreachable', 'open_failed', 'partial', 'unproduceable'] };
