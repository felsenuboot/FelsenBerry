// Idle-guard v6 payload: body of a POST /eval call. Role substituted per bot: __ROLE__
// v2 fixes the yield bug found by BuddelBernd's driver: v1 treated "no pathfinder goal"
// as idle and hijacked the bot between driver commands. v2 wraps setGoal/goto/dig to
// timestamp EXTERNAL activity (anything issued while the guard isn't working), engages
// only after 60s of driver silence, and aborts its own work the moment a driver acts.
// Idempotent: re-injection restores originals then replaces. Disable: __idleguard.stop()
if (globalThis.__idleguard) { try { globalThis.__idleguard.stop(); } catch (e) {} }
const g = { version: 6, role: "__ROLE__", busy: false, idleTicks: 0, enabled: true, lastChat: 0, timer: null,
            runs: 0, errors: 0, lastExternal: Date.now(), workStarted: 0, patched: [], pausedUntil: 0 };
globalThis.__idleguard = g;
// pause(ms): drivers call __idleguard.pause(120000) at the start of long monitoring
// evals so the guard never mistakes an in-flight eval for silence.
g.pause = (ms) => { g.pausedUntil = Date.now() + (ms || 60000); return g.pausedUntil; };
const patch = (obj, key) => {
  if (!obj || typeof obj[key] !== "function") return;
  const orig = obj[key].bind(obj);
  g.patched.push(() => { obj[key] = orig; });
  obj[key] = (...args) => { if (!g.busy) g.lastExternal = Date.now(); return orig(...args); };
};
patch(bot.pathfinder, "setGoal");
patch(bot.pathfinder, "goto");
patch(bot, "dig");
patch(bot, "equip");
patch(bot, "craft");
patch(bot, "openContainer");
patch(bot, "activateBlock");
g.stop = () => { g.enabled = false; if (g.timer) clearInterval(g.timer); g.patched.forEach(fn => { try { fn(); } catch (e) {} }); g.patched = []; };
// v5: a RUNNING __skills task is external activity by definition. The guard used to only
// count its own patched methods, so a long phase that didn't call setGoal/dig for 25s
// looked like driver silence and the guard hijacked the bot mid-task (FEEDBACK:
// "idle-guard stomps driver pathfinder goals").
const taskRunning = () => {
  try { const S = globalThis.__skills; return Boolean(S && S.currentTask && S.currentTask.running); }
  catch (e) { return false; }
};
const paused = () => Date.now() < g.pausedUntil;
const externalActive = () => (Date.now() - g.lastExternal) < 25000 || paused() || taskRunning();
const interrupted = () => !g.enabled || g.lastExternal > g.workStarted;
const say = (msg) => { const now = Date.now(); if (now - g.lastChat > 90000) { g.lastChat = now; try { bot.chat(msg); } catch (e) {} } };
const T = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => { try { bot.pathfinder.setGoal(null); } catch (e) {} rej(new Error("timeout")); }, ms))]);
const isIdle = () => { try { return !bot.pathfinder.goal && !bot.targetDigBlock && !(bot.pathfinder.isMoving && bot.pathfinder.isMoving()); } catch (e) { return !bot.targetDigBlock; } };
// v4: LIGHT RULE — idle work is surface-only. skyAt fails OPEN (15) if the API is
// missing so v4 degrades to v3 behavior rather than freezing the guard.
const skyAt = (p) => { try { return bot.world.getSkyLight ? bot.world.getSkyLight(p) : 15; } catch (e) { return 15; } };
const surfaceOk = (p) => skyAt(p.offset ? p.offset(0, 1, 0) : p) > 0;
const gotoNear = (pos, r, ms) => T(bot.pathfinder.goto(new goals.GoalNear(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), r)), ms || 12000);
const sweepDrops = async (radius, maxN) => {
  const me = bot.entity.position;
  const items = Object.values(bot.entities)
    .filter(e => e.name === "item" && e.position && e.position.distanceTo(me) < radius
                 && surfaceOk(e.position) && notBelow(e.position))
    .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me)).slice(0, maxN || 4);
  if (!items.length) return 0;
  say("(idle-guard) sweeping stray drops, waste not!");
  let n = 0;
  for (const it of items) { if (interrupted()) break; try { await gotoNear(it.position, 1, 10000); n++; } catch (e) {} }
  return n;
};
const bestPick = () => bot.inventory.items().find(i => /(_pickaxe)$/.test(i.name) && !/wooden/.test(i.name)) || bot.inventory.items().find(i => /_pickaxe$/.test(i.name));
const digWithTool = async (block) => {
  let tool = null;
  try { tool = bot.pathfinder.bestHarvestTool(block); if (tool) await bot.equip(tool, "hand"); } catch (e) {}
  // harvestability gate: never waste time on blocks that drop nothing with our gear
  try { if (block.canHarvest && !block.canHarvest(tool ? tool.type : null)) return; } catch (e) {}
  await T(bot.dig(block), 15000);
  if (!interrupted()) { try { await gotoNear(block.position, 1, 8000); } catch (e) {} }
};
// v6: findBlocks' maxDistance is a 3D SPHERE and surfaceOk (skyLight>0) PASSES a ravine
// floor — so idle mining could select ore far below and walk the bot down into it. That is
// exactly how CAVECREW lost Grog (y89->y26, full kit) with safe movements already applied.
// Idle work never descends: the gate is unconditional here, unlike mineLane's opt-out.
// (research/cavecrew-delta-2.md ss3.2)
const MAX_BELOW = 5;
const notBelow = (p) => p.y >= Math.floor(bot.entity.position.y) - MAX_BELOW;
const mineNearest = async (names, maxDist, maxN, label) => {
  const ids = names.map(n => bot.registry.blocksByName[n] && bot.registry.blocksByName[n].id).filter(Boolean);
  if (!ids.length) return 0;
  const found = bot.findBlocks({ matching: ids, maxDistance: maxDist, count: maxN * 3 }).filter(surfaceOk).filter(notBelow);
  if (!found.length) return 0;
  say("(idle-guard) " + label);
  let n = 0;
  for (const pos of found.slice(0, maxN)) {
    if (interrupted()) break;
    const b = bot.blockAt(pos); if (!b || !ids.includes(b.type)) continue;
    try { await gotoNear(pos, 2, 12000); if (interrupted()) break; await digWithTool(b); n++; } catch (e) { g.errors++; }
  }
  return n;
};
const work = async () => {
  g.runs++; g.workStarted = Date.now();
  // v4 gate: never START autonomous work while standing in the dark (skyLight 0 =
  // underground or shaded hazard pocket — the guard walked bots into caves in v3).
  if (!surfaceOk(bot.entity.position)) { say("(idle-guard) dark spot, not wandering. Waiting for orders."); return; }
  if (await sweepDrops(24, 4)) return;
  if (interrupted()) return;
  if (g.role === "lumberjack") {
    await mineNearest(["oak_log", "birch_log", "spruce_log"], 32, 4, "no orders, so I chop. The wood must flow.");
  } else if (g.role === "miner") {
    const pick = bestPick();
    if (pick) {
      if (!/wooden/.test(pick.name) && await mineNearest(["iron_ore", "deepslate_iron_ore"], 24, 3, "idle hands mine iron.")) return;
      if (interrupted()) return;
      if (await mineNearest(["coal_ore"], 24, 4, "bored, so: free coal.")) return;
      if (interrupted()) return;
      await mineNearest(["stone"], 12, 6, "digging stone to pass the time. Buddel buddel.");
    }
  } else if (g.role === "hunter") {
    await mineNearest(["short_grass", "tall_grass"], 16, 8, "harvesting grass for seeds while waiting.");
  } else if (g.role === "builder") {
    await sweepDrops(32, 6);
  }
};
g.timer = setInterval(() => {
  (async () => {
    // orphan killer + sticky stop: if a newer guard replaced us, or we were stopped,
    // this timer terminates itself — no zombie re-arms possible.
    if (globalThis.__idleguard !== g || !g.enabled) { clearInterval(g.timer); return; }
    if (g.busy) return;
    // stall-buster: a pathfinder goal that produces no movement for ~15s is stuck —
    // clear it so neither the driver's dead goal nor the guard's own leftovers pin the bot.
    // v5: it now respects pause() and yields to a running __skills task. It used to run
    // BEFORE both checks, so it yanked goals out from under paused drivers and mid-task
    // skills alike (FEEDBACK: "__idleguard.pause() doesn't cover the stall-buster" —
    // reproduced repeatedly, a 240s pause still lost goals to "The goal was changed").
    // ctx.goto has its own bounded unstick ladder; two stall-busters fighting is worse
    // than one, so while a task runs the engine's own recovery owns the goal.
    try {
      const p = bot.entity.position;
      if (paused() || taskRunning()) {
        g.stallTicks = 0;
        g.lastPos = p.clone ? p.clone() : p;
      } else if (bot.pathfinder.goal && g.lastPos && p.distanceTo(g.lastPos) < 0.3) {
        g.stallTicks = (g.stallTicks || 0) + 1;
        if (g.stallTicks >= 3) { bot.pathfinder.setGoal(null); bot.clearControlStates(); g.stallTicks = 0; g.stalls = (g.stalls || 0) + 1; }
      } else { g.stallTicks = 0; }
      g.lastPos = p.clone ? p.clone() : p;
    } catch (e) {}
    if (externalActive() || !isIdle()) { g.idleTicks = 0; return; }
    g.idleTicks++;
    if (g.idleTicks < 2) return;
    g.busy = true;
    try { await work(); } catch (e) { g.errors++; } finally { g.busy = false; g.idleTicks = 0; }
  })().catch(() => {});
}, 5000);
return { installed: true, version: 6, role: g.role };
