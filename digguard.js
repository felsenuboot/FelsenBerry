// digguard v2 payload (inject via POST /eval, idempotent).
//
// Makes registered base infrastructure undiggable at TWO levels:
//   1. bot.dig  — covers chopTrees, idle-guard, skills, manual evals (everything
//      that removes a block goes through bot.dig).
//   2. pathfinder movements.exclusionAreasBreak — the PLANNER refuses to route a
//      path THROUGH protected blocks, so it never digs the plaza floor out from
//      under a build loop (FEEDBACK: "repeated GoalNear calls can dig the floor out").
//      exclusionBreak >= 100 makes safeToBreak() false in mineflayer-pathfinder.
// Also disables pathfinder self-scaffolding (scafoldingBlocks=[]) so bots stop
// building dirt towers/bridges.
//
// v1 hardcoded the 8 plaza post columns. v2 reads ./protected.json (same dir as
// runner.js) and HOT-RELOADS it: edit the file and running bots pick it up within
// ~10s, no re-injection. Mirror BASE.md section 1 into that file when infra changes.
//
// Re-inject after every bot restart (like idleguard/graychat). Remove: __digguard.restore()
if (globalThis.__digguard && globalThis.__digguard.restore) { try { globalThis.__digguard.restore(); } catch (e) {} }

const fs = process.mainModule.require('fs');
const nodePath = process.mainModule.require('path');
const FILE = nodePath.join(nodePath.dirname(process.mainModule.filename), 'protected.json');
const RELOAD_MS = 10000;

const g = {
  enabled: true, version: 2, file: FILE,
  blocked: 0, blockedByRegion: {}, plannerHits: 0,
  regions: [], neverProtect: new Set(), loadedAt: 0, mtime: 0, error: null, reloads: 0,
};
globalThis.__digguard = g;

// ---- protected.json -> compiled regions (each gets an AABB for cheap rejection) ----
const compile = (raw) => {
  const out = [];
  for (const r of (raw.regions || [])) {
    const c = { id: r.id || '?', kind: r.kind, reason: r.reason || 'protected structure' };
    c.match = r.match ? new RegExp(r.match, 'i') : null;
    c.exclude = (r.exclude || []).map((b) => ({ min: b.min, max: b.max }));
    if (r.kind === 'box') {
      c.min = r.min; c.max = r.max;
    } else if (r.kind === 'columns') {
      c.keys = new Set((r.columns || []).map((p) => p[0] + ',' + p[1]));
      const xs = (r.columns || []).map((p) => p[0]), zs = (r.columns || []).map((p) => p[1]);
      c.min = [Math.min(...xs), r.yMin, Math.min(...zs)];
      c.max = [Math.max(...xs), r.yMax, Math.max(...zs)];
    } else if (r.kind === 'sphere') {
      c.center = r.center; c.r2 = r.radius * r.radius;
      c.min = [r.center[0] - r.radius, r.center[1] - r.radius, r.center[2] - r.radius];
      c.max = [r.center[0] + r.radius, r.center[1] + r.radius, r.center[2] + r.radius];
    } else continue;
    out.push(c);
  }
  return out;
};

const load = (force) => {
  try {
    const st = fs.statSync(FILE);
    if (!force && st.mtimeMs === g.mtime) return false;
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    g.regions = compile(raw);
    g.neverProtect = new Set(raw.neverProtect || []);
    g.mtime = st.mtimeMs; g.loadedAt = Date.now(); g.error = null; g.reloads++;
    return true;
  } catch (e) {
    // fail soft: keep whatever we already had rather than dropping protection
    g.error = e.message;
    return false;
  }
};
load(true);

const inBox = (x, y, z, min, max) =>
  x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2];

// hit(pos, name) -> region that protects this block, or null
g.hit = (pos, name) => {
  if (!g.enabled || !pos) return null;
  if (name && g.neverProtect.has(name)) return null;
  const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
  for (const r of g.regions) {
    if (!inBox(x, y, z, r.min, r.max)) continue;                       // cheap AABB reject
    if (r.kind === 'columns' && !r.keys.has(x + ',' + z)) continue;
    if (r.kind === 'sphere') {
      const dx = x - r.center[0], dy = y - r.center[1], dz = z - r.center[2];
      if (dx * dx + dy * dy + dz * dz > r.r2) continue;
    }
    if (r.match && !(name && r.match.test(name))) continue;
    if (r.exclude.some((b) => inBox(x, y, z, b.min, b.max))) continue;  // intentional gaps
    return r;
  }
  return null;
};

// ---- level 1: bot.dig ----
const orig = bot.dig.bind(bot);
bot.dig = (block, ...rest) => {
  try {
    if (g.enabled && block && block.position) {
      const r = g.hit(block.position, block.name);
      if (r) {
        g.blocked++;
        g.blockedByRegion[r.id] = (g.blockedByRegion[r.id] || 0) + 1;
        if (g.blockedByRegion[r.id] <= 2) {
          try { bot.chat("Hands off - " + r.id + " is protected base structure (" + r.reason + "). Backing off."); } catch (e) {}
        }
        return Promise.reject(new Error('protected_structure:' + r.id));
      }
    }
  } catch (e) {}
  return orig(block, ...rest);
};

// ---- level 2: pathfinder planner ----
// Returned cost >= 100 makes mineflayer-pathfinder treat the block as unbreakable.
g.exclusionBreak = (block) => {
  try {
    if (block && block.position && g.hit(block.position, block.name)) { g.plannerHits++; return 100; }
  } catch (e) {}
  return 0;
};
const wireMovements = () => {
  try {
    const mv = bot.pathfinder && bot.pathfinder.movements;
    if (!mv) return false;
    if (!Array.isArray(mv.exclusionAreasBreak)) mv.exclusionAreasBreak = [];
    if (!mv.exclusionAreasBreak.includes(g.exclusionBreak)) mv.exclusionAreasBreak.push(g.exclusionBreak);
    if (!Array.isArray(mv.exclusionAreasPlace)) mv.exclusionAreasPlace = [];
    if (!mv.exclusionAreasPlace.includes(g.exclusionBreak)) mv.exclusionAreasPlace.push(g.exclusionBreak);
    mv.scafoldingBlocks = [];
    return true;
  } catch (e) { return false; }
};
g.wired = wireMovements();

// Re-wire periodically: a reconnect (or any setMovements call) installs a fresh
// Movements object that has never heard of us. Same timer polls protected.json.
g.timer = setInterval(() => {
  if (globalThis.__digguard !== g || !g.enabled) { clearInterval(g.timer); return; }
  load(false);
  wireMovements();
}, RELOAD_MS);

g.reload = () => { const changed = load(true); wireMovements(); return { changed, regions: g.regions.length, error: g.error }; };
g.restore = () => {
  g.enabled = false;
  if (g.timer) clearInterval(g.timer);
  try { bot.dig = orig; } catch (e) {}
  try {
    const mv = bot.pathfinder && bot.pathfinder.movements;
    if (mv) {
      if (Array.isArray(mv.exclusionAreasBreak)) mv.exclusionAreasBreak = mv.exclusionAreasBreak.filter((f) => f !== g.exclusionBreak);
      if (Array.isArray(mv.exclusionAreasPlace)) mv.exclusionAreasPlace = mv.exclusionAreasPlace.filter((f) => f !== g.exclusionBreak);
    }
  } catch (e) {}
};

// ---- staleness registry (see FEEDBACK "injection reports can drift from reality") ----
// A reconnect makes runner.js build a FRESH bot object (runner.js:319). globalThis
// survives, so `!!globalThis.__digguard` still reads true — but bot.dig here is patched on
// the DEAD bot and protects nothing. Bind to our own bot's 'end' and mark ourselves stale
// so drivers and GET /state see the truth instead of a phantom install.
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.digguard = { version: 2, boundAt: Date.now(), stale: false };
bot.once('end', () => {
  try { REG.digguard.stale = true; g.enabled = false; if (g.timer) clearInterval(g.timer); } catch (e) {}
});

return {
  installed: true, version: 2, file: FILE, regions: g.regions.length,
  ids: g.regions.map((r) => r.id), plannerWired: g.wired,
  neverProtect: g.neverProtect.size, error: g.error, scaffoldingDisabled: true,
};
