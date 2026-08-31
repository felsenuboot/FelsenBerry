// digguard payload (inject via POST /eval, idempotent): makes the plaza's torch-post
// pillar columns unchoppable at the bot.dig level (covers chopTrees, idle-guard,
// manual evals - everything digs through bot.dig). Also disables pathfinder
// self-scaffolding (scafoldingBlocks=[]) so bots stop building dirt towers/bridges.
// Protected: the 8 perimeter post columns of plaza_1, y109-116, log/stripped blocks.
// Re-inject after every bot restart (like idleguard/graychat). Remove: __digguard.restore()
if (globalThis.__digguard && globalThis.__digguard.restore) { try { globalThis.__digguard.restore(); } catch (e) {} }
const g = { enabled: true, blocked: 0 };
globalThis.__digguard = g;
const COLS = new Set(["-8,-1", "-8,4", "-8,9", "-3,-1", "-3,9", "2,-1", "2,4", "2,9"]);
const orig = bot.dig.bind(bot);
g.restore = () => { bot.dig = orig; g.enabled = false; };
bot.dig = (block, ...rest) => {
  try {
    if (g.enabled && block && block.position && /(_log|stripped_)/.test(block.name || "")) {
      const k = block.position.x + "," + block.position.z;
      if (COLS.has(k) && block.position.y >= 109 && block.position.y <= 116) {
        g.blocked++;
        if (g.blocked <= 2) { try { bot.chat("Whoa - that pillar is protected base structure, not a tree. Backing off."); } catch (e) {} }
        return Promise.reject(new Error("protected_structure"));
      }
    }
  } catch (e) {}
  return orig(block, ...rest);
};
try { bot.pathfinder.movements.scafoldingBlocks = []; } catch (e) {}
return { installed: true, protectedColumns: COLS.size, scaffoldingDisabled: true };
