// digguard v5 payload (inject via POST /eval, idempotent).
// v5 (engine-dev-3, #26): the level-3 bot.ashDig wrap below is now actually IMPLEMENTED — v4
// advertised THREE levels in this header and left the restore hook, but the body only had 1+2.
//
// Makes registered base infrastructure undiggable at THREE levels:
//   1. bot.dig  — covers chopTrees, idle-guard, skills, manual evals (everything
//      that removes a block goes through bot.dig).
//   2. pathfinder movements.exclusionAreasBreak — the PLANNER refuses to route a
//      path THROUGH protected blocks, so it never digs the plaza floor out from
//      under a build loop (FEEDBACK: "repeated GoalNear calls can dig the floor out").
//      exclusionBreak >= 100 makes safeToBreak() false in mineflayer-pathfinder.
//   3. bot.ashDig — ashfinder (/goto2) issues its own block breaks through bot.ashDig,
//      which NEVER pass through bot.dig, so levels 1+2 miss them entirely (GitHub #26,
//      the safety-critical Baritone finding). goto2.patch.js used to guard this per-run
//      via guardAshDig; v4 folds that coverage in here permanently, reusing g.hit so
//      there is ONE protected-region lookup, not two. typeof-guarded: a no-op on the
//      normal fleet (bot.ashDig doesn't exist there), live only where ashfinder is loaded.
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
  enabled: true, version: 5, file: FILE,
  blocked: 0, blockedByRegion: {}, plannerHits: 0, ashBlocked: 0,
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

// ---- level 1: bot.dig protection, now a CHAIN LINK (GitHub #55) ----
// The protection check is registered into digchain (the single bot.dig wrap point) as guard
// 'protection' at order 1 — a hard VETO that runs before the tool equip-check's side effect,
// after the reach veto. This file no longer re-wraps bot.dig itself; the chain owns the wrap.
// LEVELS 2 (pathfinder exclusionAreasBreak) and 3 (ashDig) below are UNCHANGED — neither is on
// the bot.dig path, so consolidating level 1 leaves them exactly as they were.
function protectionDigCheck(block, forceLook, digFace, opts) {
  if (!g.enabled || !block || !block.position) return null;
  const r = g.hit(block.position, block.name);
  if (r) {
    g.blocked++;
    g.blockedByRegion[r.id] = (g.blockedByRegion[r.id] || 0) + 1;
    if (g.blockedByRegion[r.id] <= 2) {
      try { bot.chat("Hands off - " + r.id + " is protected base structure (" + r.reason + "). Backing off."); } catch (e) {}
    }
    return { reject: new Error('protected_structure:' + r.id) };
  }
  return null;
}
if (globalThis.__digchain && globalThis.__digchain.register) {
  globalThis.__digchain.register('protection', 1, protectionDigCheck);
} else {
  // No self-wrap fallback: a silent second wrap point is exactly the stacking #55 removes.
  try { console.error('[digguard] __digchain absent — protection dig-guard NOT installed (inject digchain.js before the guards)'); } catch (e) {}
  g.chainMissing = true;
}


// ---- level 2: pathfinder planner ----
// RESTORED after I sliced it out by accident while removing the self-heal (the removal's
// text range ran from the level-1 wrap to g.reload and took this whole block with it).
// Losing it silently killed BOTH the plaza-floor planner protection AND protected.json
// hot-reload: runner.js's baseMovements() late-binds to g.exclusionBreak, so with the
// function gone that hook just returned 0 and the planner was free to dig through
// registered structure again. Caught by engine-dev-3 reading the file, not by any test.
// Returned cost >= 100 makes mineflayer-pathfinder treat the block as unbreakable.
g.exclusionBreak = (block) => {
  try {
    if (block && block.position && g.hit(block.position, block.name)) { g.plannerHits++; return 100; }
  } catch (e) {}
  return 0;
};
// runner.js's baseMovements() installs a late-binding hook tagged __digguardBound that
// calls straight into us, so every profile it builds is covered from birth. Only wire
// ourselves in when that hook is absent (an older runner.js, or a foreign Movements object).
const alreadyBound = (arr) => Array.isArray(arr) && arr.some((f) => f && (f.__digguardBound || f === g.exclusionBreak));
const wireMovements = () => {
  try {
    const mv = bot.pathfinder && bot.pathfinder.movements;
    if (!mv) return false;
    if (!Array.isArray(mv.exclusionAreasBreak)) mv.exclusionAreasBreak = [];
    if (!alreadyBound(mv.exclusionAreasBreak)) mv.exclusionAreasBreak.push(g.exclusionBreak);
    if (!Array.isArray(mv.exclusionAreasPlace)) mv.exclusionAreasPlace = [];
    if (!alreadyBound(mv.exclusionAreasPlace)) mv.exclusionAreasPlace.push(g.exclusionBreak);
    mv.scafoldingBlocks = [];
    return true;
  } catch (e) { return false; }
};
g.wired = wireMovements();

// ---- level 3: bot.ashDig (ashfinder /goto2 bypasses bot.dig — GitHub #26, safety) ----
// ashfinder breaks blocks through bot.ashDig, which never passes through bot.dig, so levels
// 1+2 miss it entirely. Wrap it too, reusing g.hit (ONE protected-region lookup, not
// goto2.patch.js's parallel box list — that guardAshDig becomes redundant now). typeof-guarded:
// most bots never load ashfinder and bot.ashDig won't exist there, so this is a no-op for the
// normal fleet and live only where /goto2 is loaded.
//
// Unlike bot.dig, a plain idempotent re-wrap on the timer IS safe here: the level-1 no-self-heal
// note is specific to TWO self-healing bot.dig wrappers (digguard + toolguard) re-pointing at
// each other into a call cycle. bot.ashDig has exactly one wrapper (this one) — goto2's per-run
// guardAshDig is retired in its favour — so an identity-checked re-wrap can never form a cycle.
const guardedAshDig = (block, ...rest) => {
  try {
    if (g.enabled && block && block.position) {
      const r = g.hit(block.position, block.name);
      if (r) {
        g.blocked++; g.ashBlocked = (g.ashBlocked || 0) + 1;
        g.blockedByRegion[r.id] = (g.blockedByRegion[r.id] || 0) + 1;
        if (g.blockedByRegion[r.id] <= 2) {
          try { bot.chat("Hands off - " + r.id + " is protected base structure (" + r.reason + "). Backing off."); } catch (e) {}
        }
        return Promise.reject(new Error('protected_structure:' + r.id));
      }
    }
  } catch (e) {}
  return g.origAsh(block, ...rest);
};
guardedAshDig.__digguardWrapper = true;
// (Re)wrap only when ashDig exists and is not already ours. guardedAshDig is a stable closure,
// so once installed a re-run is a no-op (identity match); if a reconnect or a late ashfinder
// load replaced bot.ashDig, we layer over whatever is current. No chain-walk: nothing else wraps
// ashDig, so "am I outermost" is the whole question.
const ensureAshWrapped = () => {
  try {
    if (typeof bot.ashDig !== 'function' || bot.ashDig === guardedAshDig) return false;
    g.origAsh = bot.ashDig.bind(bot);
    guardedAshDig.__wrappedTarget = bot.ashDig;
    bot.ashDig = guardedAshDig;
    g.ashRewraps = (g.ashRewraps || 0) + 1;
    return true;
  } catch (e) { return false; }
};
// restoreAsh is the hook g.restore() already calls (left in place for #26). Undo our wrap only
// if it is still ours, so restore() never clobbers a wrapper something else layered on later.
g.restoreAsh = () => { try { if (g.origAsh && bot.ashDig === guardedAshDig) bot.ashDig = g.origAsh; } catch (e) {} };
g.ashWired = ensureAshWrapped();

// Re-wire periodically: a reconnect (or any setMovements call) installs a fresh Movements
// object that has never heard of us. The same timer polls protected.json so an edit reaches
// running bots within ~10s with no re-injection, and re-checks the ashDig wrap so a /goto2
// loaded AFTER digguard still gets covered within ~10s. NOTE: this timer must never re-wrap
// bot.dig — see the no-self-heal note above — but ashDig (single-wrapper) is safe.
g.timer = setInterval(() => {
  if (globalThis.__digguard !== g || !g.enabled) { clearInterval(g.timer); return; }
  load(false);
  wireMovements();
  ensureAshWrapped();
}, RELOAD_MS);

g.reload = () => { const changed = load(true); wireMovements(); return { changed, regions: g.regions.length, error: g.error }; };
g.restore = () => {
  g.enabled = false;
  if (g.timer) clearInterval(g.timer);
  // level-1 is now a chain link: unregister from digchain instead of restoring bot.dig.
  try { if (globalThis.__digchain && globalThis.__digchain.unregister) globalThis.__digchain.unregister('protection'); } catch (e) {}
  // level-3 ashDig restore is owned by engine-dev-3 (#26); guarded so restore()
  // cannot throw while that block is being (re)added.
  try { if (g.origAsh && typeof g.restoreAsh === 'function') g.restoreAsh(); } catch (e) {}
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
REG.digguard = { version: 5, boundAt: Date.now(), stale: false };
bot.once('end', () => {
  try { REG.digguard.stale = true; g.enabled = false; if (g.timer) clearInterval(g.timer); } catch (e) {}
});

return {
  installed: true, version: 5, file: FILE, regions: g.regions.length,
  ids: g.regions.map((r) => r.id), plannerWired: g.wired, ashWired: g.ashWired,
  neverProtect: g.neverProtect.size, error: g.error, scaffoldingDisabled: true,
};
