// digchain.js v1 payload (inject via POST /eval, idempotent) — GitHub #55.
//
// THE SINGLE bot.dig WRAP POINT. Before this, digguard + toolguard + reachguard each did
//   `const orig = bot.dig.bind(bot); bot.dig = guarded;`
// — three INDEPENDENT re-wraps of the same function. That model caused both historical
// failure modes the issue names:
//   - RE-STACK: each re-inject captured the CURRENT bot.dig (an already-wrapped fn) as its
//     "orig" and wrapped again; toolguard's restore() is inert, so every reconnect grew the
//     chain by a dead no-op layer, unbounded.
//   - SILENT DROP: order depended on inject order, restores were inconsistent (digguard
//     restored bot.dig, toolguard didn't, reachguard did), and a self-heal that re-wrapped a
//     wrapper it couldn't see through formed a cycle — 9.2M recursive dig calls in one test.
//
// This coordinator replaces all three re-wraps with ONE. Guards no longer touch bot.dig;
// they REGISTER an ordered check function here, and this installs exactly one wrapper that
// runs the checks in order (reach=0, tool=1, protection=2) and then the TRUE original.
//
// Why this cannot re-stack: rebuild() always recovers the TRUE original by walking
// __wrappedTarget down from whatever bot.dig currently is (our own wrapper included), then
// builds a fresh single wrapper over THAT original — never over another wrapper. Re-injecting
// on reconnect rebinds to the new bot's pristine bot.dig; re-injecting in place recovers the
// same true original through our wrapper's published __wrappedTarget. Either way: one wrapper.
//
// Why this cannot silently drop a level: the registry (keyed by name) is the source of truth,
// and rebuild() reconstructs the whole ordered chain from it every time. A guard re-registers
// by name (overwrite, not append), so its check is refreshed, never duplicated and never lost.
//
// Re-inject after every bot restart (auto-injected by runner.js BEFORE the guards, so they
// have something to register into). Remove: __digchain.restore()

if (globalThis.__digchain && globalThis.__digchain.restore) {
  // Take the registry across a re-inject so guards already registered stay registered; the
  // rebuild below rebinds everything to the current bot's true original.
  try { globalThis.__digchain.__detach(); } catch (e) {}
}

const prior = globalThis.__digchain;
const c = {
  enabled: true, version: 1,
  guards: (prior && prior.guards instanceof Map) ? prior.guards : new Map(), // name -> {order, fn}
  rebuilds: 0, calls: 0, rejects: 0, equips: 0, guardErrors: 0,
};
globalThis.__digchain = c;

// The base this chain should sit on top of: walk down ONLY through OUR OWN wrappers (marked
// __digchainWrapper) and stop at the FIRST FOREIGN function — the pristine bot.dig, OR a guard
// still self-wrapping mid-refactor. We must NEVER walk past a wrapper we did not create.
//
// This is the invariant that makes a PARTIAL refactor safe (#55, eng-2): if one guard has been
// converted to register() while the others still self-wrap, walking all the way to the pristine
// dig would rebuild a chain that SILENTLY STRIPS the still-self-wrapping guards — unguarded digs
// on a live base. Stopping at the first foreign wrapper instead builds ON TOP of it, so a partial
// state degrades to one harmless extra layer (digchain(registered checks) over the still-self-
// wrapping guards, all of which still run) rather than to an unguarded dig. Bounded so a
// malformed cycle can never spin here.
const baseBeneathOurs = (fn) => {
  let cur = fn, guard = 0;
  while (cur && cur.__digchainWrapper && cur.__wrappedTarget && guard++ < 32) cur = cur.__wrappedTarget;
  return cur;
};

// Build the ONE wrapper over `base` (the function beneath our own wrappers — pristine dig, or a
// foreign guard wrapper in a partial state), running the ordered guard checks first.
// A check(block, forceLook, digFace, opts) returns:
//   null / undefined  -> pass to the next check
//   { reject: Error }  -> stop the chain; the dig rejects with this error
//   { equip: item }    -> equip this item (toolguard's equip-first), then continue
// opts.force short-circuits EVERY guard (a raw dig, matching the old per-guard bypass).
const buildWrapper = (base, ordered) => {
  const chained = async function (block, forceLook, digFace) {
    c.calls++;
    const opts = (digFace && typeof digFace === 'object') ? digFace : null;
    if (!c.enabled || (opts && opts.force)) return base(block, forceLook, digFace);
    for (const gd of ordered) {
      let verdict = null;
      try {
        verdict = await gd.fn(block, forceLook, digFace, opts);
      } catch (e) {
        // A check that THROWS a coded refusal (e.g. tool_missing) is a real rejection and
        // must propagate. Any other throw is a guard bug — never let it break a real dig.
        if (e && e.code) { c.rejects++; throw e; }
        c.guardErrors++;
        verdict = null;
      }
      if (verdict && verdict.reject) { c.rejects++; throw verdict.reject; }
      if (verdict && verdict.equip) {
        c.equips++;
        try { await bot.equip(verdict.equip, 'hand'); } catch (e) { /* dig proceeds with what's held */ }
      }
    }
    return base(block, forceLook, digFace);
  };
  chained.__digchainWrapper = true;
  chained.__wrappedTarget = base;
  return chained;
};

// Recover the base beneath our own wrappers, sort the registry, install one wrapper on top.
const rebuild = () => {
  const base = baseBeneathOurs(bot.dig);
  c.base = base;
  const ordered = [...c.guards.entries()]
    .map(([name, v]) => ({ name, order: v.order, fn: v.fn }))
    .sort((a, b) => a.order - b.order);
  c.order = ordered.map((g) => g.name);
  bot.dig = buildWrapper(base, ordered);
  c.rebuilds++;
  return c.order;
};

// A guard registers (or refreshes) its ordered check. Overwrite by name so a re-inject
// replaces the guard's closure instead of stacking a second copy.
c.register = (name, order, fn) => {
  if (typeof fn !== 'function') return false;
  c.guards.set(name, { order, fn });
  rebuild();
  return true;
};
c.unregister = (name) => { const had = c.guards.delete(name); if (had) rebuild(); return had; };

// __detach: on re-inject, drop our wrapper back to the true original WITHOUT clearing the
// registry (the incoming instance inherits `guards` and rebuilds). Idempotent.
c.__detach = () => {
  try { if (bot.dig && bot.dig.__digchainWrapper) bot.dig = baseBeneathOurs(bot.dig); } catch (e) {}
};

// Full removal: restore the pristine bot.dig and forget every guard.
c.restore = () => {
  c.enabled = false;
  try { if (bot.dig && bot.dig.__digchainWrapper) bot.dig = baseBeneathOurs(bot.dig); } catch (e) {}
  c.guards.clear();
};

c.snapshot = () => ({ order: c.order, guards: [...c.guards.keys()], rebuilds: c.rebuilds,
  calls: c.calls, rejects: c.rejects, equips: c.equips, guardErrors: c.guardErrors,
  wrapped: !!(bot.dig && bot.dig.__digchainWrapper), depth: (() => {
    let d = 0, cur = bot.dig; while (cur && cur.__wrappedTarget && d < 40) { d++; cur = cur.__wrappedTarget; } return d;
  })() });

// Install now: rebind to this bot's true bot.dig and rebuild from whatever guards carried over.
rebuild();

// ---- staleness registry (see FEEDBACK "injection reports can drift from reality") ----
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.digchain = { version: 1, boundAt: Date.now(), stale: false };
try { bot.once('end', () => { try { REG.digchain.stale = true; c.enabled = false; } catch (e) {} }); } catch (e) {}

return { installed: true, version: 1, order: c.order, guards: [...c.guards.keys()],
  singleWrapPoint: true, depth: c.snapshot().depth };
