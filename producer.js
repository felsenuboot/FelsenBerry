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
// It is an S-level method (like ensureTool/craftToolChain), run INLINE within an agenda act
// (the 180s ACT_TIMEOUT exists for exactly this). Reuses S.craftSafe + S.ensureTool, and the
// DISCIPLINE from craftToolChain (bill via planks + logs*4; the Δy<=5 surface filter on wood;
// the sanctioned force:true hand-on-log bootstrap) WITHOUT calling it — that chain is skills.js-
// internal and tool-specific, and the whole torch line (torch/stick/planks are all 2x2-or-
// smaller) needs NO crafting table, so it sidesteps the table/head-planks bill bug entirely.
//
// Remove: __producer.restore()
if (!globalThis.__skills || typeof globalThis.__skills.define !== 'function') {
  return { installed: false, error: '__skills not installed — inject skills.js first, then producer.js' };
}
const S = globalThis.__skills;

const SPECIES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'mangrove'];
const LOG_NAMES = SPECIES.map((s) => s + '_log');
const COAL_ORE = ['coal_ore', 'deepslate_coal_ore'];
const MAX_BELOW = 5;                 // wood is a surface feature — never chase it down a ravine
const MINE_RADIUS = 24;

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

// mine ore/stone until `want` of `product` is in inventory or nothing reachable remains
async function mineProduct(bot, oreNames, product, want, steps) {
  const tr = await S.ensureTool(bot, 'pickaxe', {});
  steps.push('pick:' + tr.how);
  if (!tr.ok) return { ok: false, made: 0, how: 'mined', reason: 'no_pickaxe', steps };
  const oreIds = idsOf(bot, oreNames);
  const start = inv(bot, product);
  const noun = product === 'coal' ? 'coal' : 'ore';
  let scans = 0, stagnant = 0;
  while (inv(bot, product) - start < want && scans++ < 60) {
    const before = inv(bot, product);
    const found = bot.findBlocks({ matching: oreIds, maxDistance: MINE_RADIUS, count: 8 }).filter((p) => !isProt(bot, p));
    if (!found.length) break;
    for (const p of found) {
      if (inv(bot, product) - start >= want) break;
      await digAt(bot, p, false);
    }
    if (inv(bot, product) <= before) { if (++stagnant >= 2) break; } else stagnant = 0;
  }
  const made = inv(bot, product) - start;
  return { ok: made > 0, made, how: 'mined', reason: made >= want ? undefined : (made > 0 ? 'partial' : 'no_' + noun + '_nearby'), steps };
}

// gather logs by hand (bootstrap: no axe yet is fine, logs drop bare-handed — the one
// sanctioned force dig) until `wantLogs` are held or no reachable surface wood remains
async function gatherLogs(bot, wantLogs, steps) {
  if (invRe(bot, /_log$/) >= wantLogs) return true;
  const found = bot.findBlocks({ matching: idsOf(bot, LOG_NAMES), maxDistance: 48, count: 16 })
    .filter((p) => p.y >= Math.floor(bot.entity.position.y) - MAX_BELOW && !isProt(bot, p));
  if (found.length) {
    steps.push('gather:wood');
    for (const p of found) {
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
async function ensurePlanks(bot, wantPlanks, steps) {
  if (invRe(bot, /_planks$/) >= wantPlanks) return true;
  const needLogs = Math.ceil((wantPlanks - invRe(bot, /_planks$/)) / 4);
  if (invRe(bot, /_log$/) < needLogs) await gatherLogs(bot, needLogs, steps);
  let guard = 0;
  while (guard++ < 24 && invRe(bot, /_planks$/) < wantPlanks) {
    const lg = bot.inventory.items().find((i) => /_log$/.test(i.name));
    if (!lg) break;
    const r = await S.craftSafe(bot, lg.name.replace(/_log$/, '_planks'), 1);
    if (!r.made) break;
  }
  steps.push('planks:' + invRe(bot, /_planks$/));
  return invRe(bot, /_planks$/) >= wantPlanks;
}

// craft until `wantSticks` sticks are held (2 planks -> 4 sticks; gather+plank as needed)
async function ensureSticks(bot, wantSticks, steps) {
  if (inv(bot, 'stick') >= wantSticks) return true;
  const stickBatches = Math.ceil((wantSticks - inv(bot, 'stick')) / 4);
  if (!await ensurePlanks(bot, stickBatches * 2, steps)) return inv(bot, 'stick') >= wantSticks;
  let guard = 0;
  while (guard++ < 24 && inv(bot, 'stick') < wantSticks) {
    const r = await S.craftSafe(bot, 'stick', 1);
    if (!r.made) break;
  }
  steps.push('sticks:' + inv(bot, 'stick'));
  return inv(bot, 'stick') >= wantSticks;
}

// ---- the public method ----
S.produce = async function (bot, resource, wantCount, opts = {}) {
  const want = wantCount || 16;
  const steps = [];
  const R = String(resource);
  try {
    // MINED consumables
    if (R === 'cobblestone' || R === 'filler' || R === 'stone') return await mineProduct(bot, ['stone'], 'cobblestone', want, steps);
    if (R === 'coal') return await mineProduct(bot, COAL_ORE, 'coal', want, steps);

    // CRAFTED wood chain
    if (R === 'oak_planks' || /_planks$/.test(R)) {
      const before = invRe(bot, /_planks$/);
      const ok = await ensurePlanks(bot, before + want, steps);
      const made = invRe(bot, /_planks$/) - before;
      return { ok: made > 0, made, how: made > 0 ? 'crafted' : null, reason: (ok || made >= want) ? undefined : (made > 0 ? 'partial' : 'no_wood'), steps };
    }
    if (R === 'stick') {
      const before = inv(bot, 'stick');
      await ensureSticks(bot, before + want, steps);
      const made = inv(bot, 'stick') - before;
      return { ok: made > 0, made, how: made > 0 ? 'crafted' : null, reason: made >= want ? undefined : (made > 0 ? 'partial' : 'no_wood'), steps };
    }

    // TORCH: the two-step chain (coal + stick -> 4 torches; no crafting table needed)
    if (R === 'torch') {
      const beforeT = inv(bot, 'torch');
      const batches = Math.ceil(want / 4);
      if (inv(bot, 'coal') < batches) {
        await mineProduct(bot, COAL_ORE, 'coal', batches - inv(bot, 'coal'), steps);
        if (inv(bot, 'coal') < 1) return { ok: false, made: 0, how: 'crafted', reason: 'no_coal_nearby', steps };
      }
      if (inv(bot, 'stick') < batches) {
        await ensureSticks(bot, batches, steps);
        if (inv(bot, 'stick') < 1) return { ok: false, made: 0, how: 'crafted', reason: 'no_wood', steps };
      }
      let guard = 0;
      while (guard++ < want + 4 && inv(bot, 'torch') - beforeT < want && inv(bot, 'coal') > 0 && inv(bot, 'stick') > 0) {
        const r = await S.craftSafe(bot, 'torch', 1);
        if (!r.made) break;
      }
      const made = inv(bot, 'torch') - beforeT;
      return { ok: made > 0, made, how: 'crafted', reason: made >= want ? undefined : (made > 0 ? 'partial' : 'craft_failed'), steps };
    }

    return { ok: false, made: 0, how: null, reason: 'unproduceable', steps };
  } catch (e) {
    // never throw — a produce failure is a stand-down signal, not a crash
    return { ok: false, made: 0, how: null, reason: 'error', steps: [...steps, String(e.message || e).slice(0, 60)] };
  }
};

// ---- bookkeeping (mirror the other payloads) ----
globalThis.__producer = {
  version: 1, restore() { try { delete S.produce; } catch (_) {} },
};
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.producer = { version: 1, boundAt: Date.now(), stale: false };
try { bot.once('end', () => { try { REG.producer.stale = true; } catch (_) {} }); } catch (_) {}

return { installed: true, version: 1, method: '__skills.produce(bot, resource, count, opts)',
  resources: ['torch', 'cobblestone', 'coal', 'stick', '*_planks'] };
