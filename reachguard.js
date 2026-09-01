// reachguard payload (inject via POST /eval, idempotent). USER-CRITICAL fix
// (FEEDBACK.md, team-lead): bots were attempting block/entity interactions far beyond
// survival reach — mineflayer has NO built-in reach limit, the client just fires the
// packet and the server silently drops it out of range. This plausibly explains several
// open quirks: bot.dig never resolving, /mine buried-target hangs, placeBlock false
// blockUpdate timeouts, hunt swings missing.
//
// Fast-rollout design: wraps bot.dig/placeBlock/activateBlock/attack with a distance
// gate and REJECTS an out-of-range call with a clear, immediate, catchable
// {code:'reach_violation'} error instead of letting it silently hang or fail. It does
// NOT auto-approach — that would call the pathfinder from inside a bare monkey-patch
// with no task context, risking the exact same goal-stomping class already documented
// (idle-guard clobbering a driver's active goal). skills.js's own ctx.digBlock/
// placeBlockAt already approach-then-act safely inside their own task; this payload is
// the safety net for code that bypasses them (raw driver /eval, idle-guard, etc).
// Re-inject after every bot restart (like idleguard/graychat/panicguard/digguard).
// Remove: __reachguard.restore()
if (globalThis.__reachguard && globalThis.__reachguard.restore) { try { globalThis.__reachguard.restore(); } catch (e) {} }

const g = { enabled: true, version: 1, violations: 0, byCall: {} };
globalThis.__reachguard = g;

const BLOCK_REACH = 4.5; // vanilla survival block-interact reach
const ENTITY_REACH = 3.0; // vanilla survival attack reach
const eyePos = () => bot.entity.position.offset(0, 1.6, 0);
const note = (call, dist) => {
  g.violations++;
  g.byCall[call] = (g.byCall[call] || 0) + 1;
  if (g.violations <= 5 || g.violations % 20 === 0) {
    try { console.log(`[reachguard] ${call} rejected: ${dist.toFixed(1)}m out of reach (violations=${g.violations})`); } catch (e) {}
  }
};

const origPlaceBlock = bot.placeBlock.bind(bot);
const origActivateBlock = bot.activateBlock.bind(bot);
const origAttack = bot.attack.bind(bot);

// bot.dig is now a CHAIN LINK (GitHub #55): the reach check is registered into digchain (the
// single bot.dig wrap point) as guard 'reach' at order 0, instead of this file re-wrapping
// bot.dig itself. placeBlock/activateBlock/attack stay single-wrapper below — they are not on
// the bot.dig chain. A check returns {reject:err} to refuse or null to pass.
function reachDigCheck(block, forceLook, digFace, opts) {
  if (!g.enabled || !block || !block.position) return null;
  const d = block.position.offset(0.5, 0.5, 0.5).distanceTo(eyePos());
  if (d > BLOCK_REACH) {
    note('dig', d);
    return { reject: Object.assign(
      new Error(`reach_violation: dig target ${d.toFixed(1)}m away (max ${BLOCK_REACH})`),
      { code: 'reach_violation' },
    ) };
  }
  return null;
}
if (globalThis.__digchain && globalThis.__digchain.register) {
  globalThis.__digchain.register('reach', 0, reachDigCheck);
} else {
  // digchain MUST be injected first (runner.js order). No self-wrap fallback: a silent
  // second wrap point is exactly what #55 removes. Fail LOUD so stack-check catches it.
  try { console.error('[reachguard] __digchain absent — reach dig-guard NOT installed (inject digchain.js before the guards)'); } catch (e) {}
  g.chainMissing = true;
}

bot.placeBlock = (referenceBlock, faceVector, ...rest) => {
  try {
    if (g.enabled && referenceBlock && referenceBlock.position) {
      const d = referenceBlock.position.offset(0.5, 0.5, 0.5).distanceTo(eyePos());
      if (d > BLOCK_REACH) {
        note('placeBlock', d);
        return Promise.reject(Object.assign(
          new Error(`reach_violation: place reference ${d.toFixed(1)}m away (max ${BLOCK_REACH})`),
          { code: 'reach_violation' },
        ));
      }
    }
  } catch (e) {}
  return origPlaceBlock(referenceBlock, faceVector, ...rest);
};

bot.activateBlock = (block, ...rest) => {
  try {
    if (g.enabled && block && block.position) {
      const d = block.position.offset(0.5, 0.5, 0.5).distanceTo(eyePos());
      if (d > BLOCK_REACH) {
        note('activateBlock', d);
        return Promise.reject(Object.assign(
          new Error(`reach_violation: activate target ${d.toFixed(1)}m away (max ${BLOCK_REACH})`),
          { code: 'reach_violation' },
        ));
      }
    }
  } catch (e) {}
  return origActivateBlock(block, ...rest);
};

// bot.attack is fire-and-forget (no promise to reject) — refuse the swing and log only.
bot.attack = (entity, ...rest) => {
  try {
    if (g.enabled && entity && entity.position) {
      const d = entity.position.distanceTo(bot.entity.position);
      if (d > ENTITY_REACH) {
        note('attack', d);
        return;
      }
    }
  } catch (e) {}
  return origAttack(entity, ...rest);
};

g.restore = () => {
  g.enabled = false;
  try { if (globalThis.__digchain && globalThis.__digchain.unregister) globalThis.__digchain.unregister('reach'); } catch (e) {}
  bot.placeBlock = origPlaceBlock;
  bot.activateBlock = origActivateBlock;
  bot.attack = origAttack;
};

return { installed: true, blockReach: BLOCK_REACH, entityReach: ENTITY_REACH };
