// panicguard payload (inject via POST /eval, idempotent): last-resort survival
// reflex that runs at game speed, not driver-poll speed. If HP drops below 8,
// the bot aborts whatever it is doing, announces (white, important), and flees
// to base. Exists because MettMarcel bled 20->0 in ~8s inside a 50s driver
// polling gap. Re-inject after every bot restart. Remove: __panic.restore()
if (globalThis.__panic && globalThis.__panic.restore) { try { globalThis.__panic.restore(); } catch (e) {} }
const g = { enabled: true, fires: 0, last: 0 };
globalThis.__panic = g;
const HOME = { x: -3, y: 111, z: 4 };
const onHealth = () => {
  try {
    if (!g.enabled || bot.health <= 0 || bot.health >= 8) return;
    const now = Date.now();
    if (now - g.last < 30000) return;
    g.last = now; g.fires++;
    try { bot.chat("! HP " + Math.round(bot.health) + "/20 - breaking off and retreating to base!"); } catch (e) {}
    try { if (globalThis.__skills && globalThis.__skills.stop) globalThis.__skills.stop(bot, "panic-retreat"); } catch (e) {}
    try { if (globalThis.__idleguard && globalThis.__idleguard.pause) globalThis.__idleguard.pause(60000); } catch (e) {}
    try { bot.pathfinder.setGoal(null); } catch (e) {}
    try { bot.pathfinder.setGoal(new goals.GoalNear(HOME.x, HOME.y, HOME.z, 3)); } catch (e) {}
  } catch (e) {}
};
bot.on("health", onHealth);
g.restore = () => { g.enabled = false; try { bot.removeListener("health", onHealth); } catch (e) {} };
return { installed: true, threshold: 8, home: HOME };
