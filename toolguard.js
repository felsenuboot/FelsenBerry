// toolguard v2 payload (inject via POST /eval, idempotent) — RIGHT TOOL, ALWAYS.
//
// User escalation: bots must never work with the wrong tool. This sits at the bot.dig
// choke point, so it covers skills, idle-guard and every hand-rolled /eval alike.
//
// It EQUIPS before it rejects, which is the important design choice. A guard that only
// refuses would break every internal dig that happens to be holding the wrong thing; a
// guard that equips first actually delivers "right tool always" and only refuses when the
// tool genuinely isn't in the bag. Acquisition (depot / crafting) is NOT done here —
// that needs travel, chests and a crafting table, and a bare monkey-patch must never
// call pathfinder (the same reasoning reachguard used for not auto-approaching).
// __skills.ensureTool() owns acquisition.
//
// Resolution is grounded in minecraft-data, verified live on 1.21.11:
//   block.harvestTools -> present = a tool is REQUIRED for the block to drop anything
//                         (stone, ores, obsidian). Absent = it drops by hand.
//   block.material     -> 'mineable/axe' | 'mineable/pickaxe' | 'mineable/shovel'
//                         | 'default' (no tool) | 'incorrect_for_<tier>_tool' (ore tiers)
//
// Two severities, deliberately different:
//   REQUIRED unsatisfiable -> reject. Digging stone bare-handed yields NOTHING; letting
//                             it through is pure wasted time and a broken task.
//   CLASS mismatch         -> reject for axe/pickaxe work (the visible "punching trees"
//                             case the user saw), ADVISORY for shovel/hoe. Dirt by hand is
//                             legitimate Minecraft, and gating it would break placeBlockAt's
//                             clear-a-block path and the stall-buster's nuisance digs.
//
// Bypass a single call with bot.dig(block, forceLook, {force:true}) or globally via
// __toolguard.enabled = false. Remove: __toolguard.restore()
if (globalThis.__toolguard && globalThis.__toolguard.restore) { try { globalThis.__toolguard.restore(); } catch (e) {} }

const g = {
  enabled: true, version: 2,
  equipped: 0, rejected: 0, allowed: 0,
  byReason: {}, bySite: {},          // which call sites over-reach — tells us what to fix
  lastReject: null,
  rejectClasses: ['axe', 'pickaxe'], // hard-gate these; the user's complaint lives here
  advisoryClasses: ['shovel', 'hoe'],// equip if we have one, never block the dig
};
globalThis.__toolguard = g;

const TIER_RANK = { netherite: 6, diamond: 5, iron: 4, stone: 3, copper: 2.5, golden: 2, wooden: 1 };
const CLASS_RE = /_(pickaxe|axe|shovel|hoe|sword)$/;
const toolClass = (name) => { const m = CLASS_RE.exec(name || ''); return m ? m[1] : null; };
const toolTier = (name) => { const t = String(name || '').split('_')[0]; return TIER_RANK[t] || 0; };

// need = { cls, required } — required is a Set of item names that make the block drop,
// or null when any tool (or none) will do.
const needFor = (block) => {
  try {
    if (!block || !block.name) return null;
    const def = bot.registry.blocksByName[block.name];
    if (!def) return null;
    if (def.hardness === 0) return null;                 // instant-break: never gate
    let required = null;
    if (def.harvestTools) {
      required = new Set(Object.keys(def.harvestTools)
        .map((id) => (bot.registry.items[id] || {}).name).filter(Boolean));
      if (!required.size) required = null;
    }
    let cls = null;
    const mat = def.material || '';
    const m = /^mineable\/(\w+)$/.exec(mat);
    if (m) cls = m[1];
    else if (/^incorrect_for_/.test(mat) && required) cls = toolClass([...required][0]);
    if (!cls && !required) return null;
    return { cls, required };
  } catch (e) { return null; }
};

const satisfies = (itemName, need) => {
  if (!itemName) return false;
  if (need.required) return need.required.has(itemName);
  return need.cls ? toolClass(itemName) === need.cls : true;
};

// best = satisfies the requirement, then highest tier (fastest), preferring the right class
const bestFor = (need) => {
  let best = null, bestScore = -1;
  for (const it of bot.inventory.items()) {
    if (!satisfies(it.name, need)) continue;
    const score = toolTier(it.name) + (toolClass(it.name) === need.cls ? 10 : 0);
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
};

const callSite = () => {
  try {
    const lines = String(new Error().stack).split('\n').slice(3, 7);
    for (const l of lines) {
      const m = /at (?:async )?(?:Object\.)?(\w+)/.exec(l);
      if (m && !['dig', 'toolClass', 'needFor', 'toolDigCheck'].includes(m[1])) return m[1];
    }
  } catch (e) {}
  return 'unknown';
};

// bot.dig is now a CHAIN LINK (GitHub #55): the tool check is registered into digchain as
// guard 'tool' at order 2 (LAST — after the reach and protection VETOES, because equipping is
// a SIDE EFFECT and must not fire for a dig a pure veto was going to refuse). The check returns
// {equip:item} for equip-first (the chain does the equip, then reaches the original since tool
// is last), {reject:err} for a genuine tool_missing refusal, or null to pass. opts.force is
// short-circuited by the chain before any guard runs. A guard bug that THROWS is swallowed by
// the chain's per-check catch (never breaks a real dig); a coded throw would propagate — we
// return {reject} rather than throw, so tool_missing is delivered deterministically.
async function toolDigCheck(block, forceLook, digFace, opts) {
  if (!g.enabled) return null;
  const need = needFor(block);
  if (!need) { g.allowed++; return null; }
  const held = bot.heldItem && bot.heldItem.name;
  if (satisfies(held, need) && (!need.cls || toolClass(held) === need.cls)) { g.allowed++; return null; }
  // EQUIP-FIRST: the tool is in the bag, we were just holding the wrong thing
  const best = bestFor(need);
  if (best) { g.equipped++; return { equip: best }; }
  // Nothing in the bag can do it. Advisory classes still dig (dirt by hand is fine).
  const advisory = need.cls && g.advisoryClasses.includes(need.cls) && !need.required;
  if (advisory) { g.allowed++; return null; }
  const site = callSite();
  const reason = need.required ? 'tool_required' : 'tool_wrong_class';
  g.rejected++;
  g.byReason[reason] = (g.byReason[reason] || 0) + 1;
  g.bySite[site] = (g.bySite[site] || 0) + 1;
  const want = need.required ? [...need.required].sort((a, b) => toolTier(a) - toolTier(b))[0]
    : `any ${need.cls}`;
  g.lastReject = { block: block.name, need: want, cls: need.cls, site, at: Date.now() };
  const err = new Error(`tool_missing: ${block.name} needs ${want} (have ${held || 'nothing'})`);
  err.code = 'tool_missing';
  err.need = { cls: need.cls, want, required: need.required ? [...need.required] : null };
  err.block = block.name;
  return { reject: err };
}
if (globalThis.__digchain && globalThis.__digchain.register) {
  globalThis.__digchain.register('tool', 2, toolDigCheck);
} else {
  // No self-wrap fallback: a silent second wrap point is exactly the stacking #55 removes.
  try { console.error('[toolguard] __digchain absent — tool dig-guard NOT installed (inject digchain.js before the guards)'); } catch (e) {}
  g.chainMissing = true;
}

g.need = (blockOrName) => {
  const b = typeof blockOrName === 'string' ? { name: blockOrName } : blockOrName;
  const n = needFor(b);
  return n ? { cls: n.cls, required: n.required ? [...n.required] : null } : null;
};
g.snapshot = () => ({ equipped: g.equipped, rejected: g.rejected, allowed: g.allowed,
  byReason: g.byReason, bySite: g.bySite, lastReject: g.lastReject });
g.restore = () => {
  g.enabled = false;
  try { if (globalThis.__digchain && globalThis.__digchain.unregister) globalThis.__digchain.unregister('tool'); } catch (e) {}
};

const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.toolguard = { version: 2, boundAt: Date.now(), stale: false };
bot.once('end', () => { try { REG.toolguard.stale = true; g.enabled = false; } catch (e) {} });

return { installed: true, version: 2, rejectClasses: g.rejectClasses, advisoryClasses: g.advisoryClasses };
