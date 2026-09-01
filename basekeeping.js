// basekeeping.js — base-maintenance skill pack for the __skills engine (inject via POST /eval).
//
// GitHub #4: (a) spawnProof — light dark, mob-spawnable pockets near registered structures so
// creepers/mobs stop re-damaging the base; (b) structureAudit — diff protected.json's registered
// regions against the world and REPORT drift (a torch post gone to air) instead of a driver
// finding the damage by accident during an unrelated task.
//
// STANDALONE injected module (like farmskills.js): registers into the already-installed __skills
// via S.define — no skills.js body edits. Inject skills.js FIRST; add to runner.js auto-inject to
// persist across reconnects. Reuses ctx primitives (goto/placeBlockAt/isProtected/collectDrops)
// so house rules apply for free.
//
// TWO deliberate robustness choices, both from field findings:
//   1. COVERAGE is torch-DISTANCE, not a light readback. This map has a confirmed server-side
//      lighting bug (GitHub #17: block light stays 0 next to a freshly-placed torch, and skyLight
//      reads 0 in open sky) — so a greedy loop that re-reads light to decide "is this cell lit
//      now" would loop forever or over-torch. Instead we track placed/existing torch positions in
//      CODE and treat a cell as covered once a torch is within taxicab COVER of it. Light is used
//      ONLY as the initial "is this cell dark enough to bother" filter; if that read is wrong the
//      worst case is a few extra torches, which the doctrine says is a non-issue (coal is cheap).
//   2. COVER defaults to 12 (survival-doctrine §6: open-room 13-spacing keeps every cell at block
//      light >= 1, which is the ACTUAL 1.18+ mob-spawn threshold — mobs need block light 0 to
//      spawn). The issue's "blockLight<8" is the older, ~3x-conservative phrasing; pass a smaller
//      `cover` if you want the tighter light>=8 everywhere.
//
// Remove with __basekeeping.restore().

if (!globalThis.__skills || typeof globalThis.__skills.define !== 'function') {
  return { installed: false, error: '__skills not installed — inject skills.js first, then basekeeping.js' };
}
const S = globalThis.__skills;
const V = Vec3;

const AIR = new Set(['air', 'cave_air', 'void_air']);
const TORCHES = new Set(['torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'copper_torch', 'copper_wall_torch', 'redstone_torch', 'redstone_wall_torch']);
const TORCH_ITEMS = ['torch', 'soul_torch', 'copper_torch'];
const DARK_LIGHT = 8;   // a cell is a "spawnable pocket" when both block light and sky light are < this
const COVER = 12;       // a torch covers cells within this taxicab distance (see header note 2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const taxicab = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

// A standable spawn cell: air, a full solid block directly below, air directly above (mob headroom).
function standable(bot, pos) {
  const here = bot.blockAt(pos);
  if (!here || !AIR.has(here.name)) return false;
  const below = bot.blockAt(pos.offset(0, -1, 0));
  if (!below || below.boundingBox !== 'block') return false;
  const above = bot.blockAt(pos.offset(0, 1, 0));
  return Boolean(above && AIR.has(above.name));
}

// Is a full solid block within `up` cells straight overhead? A GEOMETRIC roof detector, used
// because this map's frozen-daylight hack leaves skyLight stuck at 15 even inside a sealed room
// (GitHub #17, reproduced live: a fully-roofed cell reads skyLight 15 after a forced recalc, but
// the block directly above reads solid). Geometry is the trustworthy signal here.
function roofed(bot, pos, up = 6) {
  for (let dy = 2; dy <= up + 1; dy++) {   // start at +2: skip the mob's own headroom cell
    const b = bot.blockAt(pos.offset(0, dy, 0));
    if (b && b.boundingBox === 'block') return true;
  }
  return false;
}

// A cell is a spawnable pocket when block light is low AND it is not sunlit. "Not sunlit" is
// skyLight<8 OR — since skyLight is unreliable on this map — a solid roof overhead. blockLight is
// sampled at the cell and the headroom cell and taken brighter (single-read defence, marcel).
// Consequence on this map: only roofed/enclosed pockets are torched, never open-sky cells — which
// is exactly the "mob-accessible pocket near a structure" the issue targets; a map with a working
// light engine would additionally catch shaded-but-open cells via the skyLight<8 clause.
function cellDark(bot, pos) {
  let bl = 0, sl = 0;
  for (const p of [pos, pos.offset(0, 1, 0)]) {
    const b = bot.blockAt(p);
    if (!b) continue;
    if (typeof b.light === 'number') bl = Math.max(bl, b.light);
    if (typeof b.skyLight === 'number') sl = Math.max(sl, b.skyLight);
  }
  if (bl >= DARK_LIGHT) return false;
  return sl < DARK_LIGHT || roofed(bot, pos);
}

// Anchor a sweep on a protected.json region (so "near registered structures" needs no new schema).
function regionCenter(r) {
  if (r.kind === 'sphere' && r.center) return new V(r.center[0], r.center[1], r.center[2]);
  if (r.min && r.max) return new V(Math.round((r.min[0] + r.max[0]) / 2), Math.round((r.min[1] + r.max[1]) / 2), Math.round((r.min[2] + r.max[2]) / 2));
  return null;
}
function regions() { try { return (globalThis.__digguard && globalThis.__digguard.regions) || []; } catch (_) { return []; } }

// ---------------------------------------------------------------------------
// spawnProof (#4a) — torch dark spawnable cells around an anchor zone
// ---------------------------------------------------------------------------
S.define('spawnProof', {
  description: 'Light dark, mob-spawnable standable cells around an anchor (a point, or a registered protected.json structure) so creepers/mobs stop re-damaging the base. Coverage is torch-distance (robust to this map\'s light-readback bug); a cell counts dark only if block AND sky light are both low.',
  params: {
    at: 'optional {x,y,z} centre of the sweep',
    near: 'optional protected.json region id to anchor on (e.g. "main_hall_1"); default: the nearest region within maxDist, else the bot',
    radius: 'horizontal sweep radius (default 8, capped 16)',
    yBand: 'vertical half-height to scan around the centre (default 3)',
    cover: 'taxicab distance one torch covers (default 12 = block light >=1, the real spawn threshold)',
    maxTorches: 'safety cap on torches placed (default 32)',
  },
  tool: null,
  validate: (a) => {
    if (a.at && ![a.at.x, a.at.y, a.at.z].every((n) => typeof n === 'number')) return 'at must be {x,y,z} numbers';
    if (a.radius != null && !(a.radius > 0)) return 'radius must be > 0';
    return null;
  },
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const radius = Math.min(args.radius || 8, 16);
    const yBand = Math.min(args.yBand != null ? args.yBand : 3, 8);
    const cover = args.cover || COVER;
    const maxTorches = args.maxTorches || 32;

    // 1. resolve the anchor centre
    let center = null, anchorName = null;
    if (args.at) center = new V(Math.floor(args.at.x), Math.floor(args.at.y), Math.floor(args.at.z));
    else if (args.near) { const r = regions().find((x) => x.id === args.near); if (r) { center = regionCenter(r); anchorName = r.id; } }
    if (!center) {
      // nearest region centre within maxDist, else the bot's own position
      const me = bot.entity.position;
      let best = null, bd = Infinity;
      for (const r of regions()) { const c = regionCenter(r); if (!c) continue; const d = c.distanceTo(me); if (d < bd && d < 96) { bd = d; best = c; anchorName = r.id; } }
      center = best || bot.entity.position.floored();
      if (!best) anchorName = 'bot';
    }

    // 2. travel into the zone so blockAt/light reads are live, not stale-remote (§3/§6 rule)
    ctx.setPhase('travelling', `Heading over to spawn-proof ${anchorName || 'the area'}.`);
    try { await ctx.gotoNear(center, 3, 30000); } catch (_) {}

    // torches on hand?
    const torchName = TORCH_ITEMS.find((n) => bot.inventory.items().some((i) => i.name === n));
    if (!torchName) return { ok: false, error: { code: 'no_torches', message: 'no torches in inventory — restock from depot chest B (64 banked)' } };

    // 3. survey standable dark cells + collect torches ALREADY in the zone (pre-existing coverage)
    ctx.setPhase('surveying', 'Scanning for dark spots.');
    const cx = center.x, cy = center.y, cz = center.z;
    const dark = [];
    const existingTorches = [];
    let scanned = 0;
    const SCAN_CAP = 6000;
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let z = cz - radius; z <= cz + radius; z++) {
        for (let y = cy - yBand; y <= cy + yBand; y++) {
          if (++scanned > SCAN_CAP) break;
          const pos = new V(x, y, z);
          const b = bot.blockAt(pos);
          if (b && TORCHES.has(b.name)) { existingTorches.push(pos); continue; }
          if (!standable(bot, pos)) continue;
          if (ctx.isProtected(pos)) continue;                 // don't torch INTO a protected cell
          if (cellDark(bot, pos)) dark.push(pos);
        }
      }
    }

    // a cell is covered if any placed/existing torch is within `cover` taxicab of it
    const torches = existingTorches.slice();
    const covered = (pos) => torches.some((t) => taxicab(t, pos) <= cover);
    let uncovered = dark.filter((p) => !covered(p));

    if (!uncovered.length) {
      ctx.setPhase('finishing');
      return { anchor: anchorName, surveyed: dark.length, existingTorches: existingTorches.length, placed: 0, remainingDark: 0, note: 'already lit' };
    }

    // 4. greedy: repeatedly place a torch at the uncovered cell that blankets the most others
    ctx.setPhase('lighting', `Lighting ${uncovered.length} dark cell${uncovered.length === 1 ? '' : 's'} near ${anchorName || 'here'}.`);
    let placed = 0;
    const unplaceable = [];
    const torchedAt = [];
    while (uncovered.length && placed < maxTorches) {
      ctx.step();
      // pick the cell whose torch would cover the most currently-uncovered cells
      let bestCell = uncovered[0], bestScore = -1;
      for (const c of uncovered) {
        let s = 0;
        for (const o of uncovered) if (taxicab(c, o) <= cover) s++;
        if (s > bestScore) { bestScore = s; bestCell = c; }
      }
      const r = await ctx.placeBlockAt(bestCell, torchName);
      if (r.ok || r.offSpec) {                                // 'torch' on a floor, 'wall_torch' on a wall — both light the cell
        torches.push(bestCell); torchedAt.push([bestCell.x, bestCell.y, bestCell.z]); placed++;
        ctx.progress(placed, Math.min(uncovered.length + placed, maxTorches), 'torches');
        await sleep(400);
      } else {
        unplaceable.push(bestCell);                           // unreachable / no reference — report, don't loop
        ctx.log(`spawnProof: could not torch ${bestCell.x},${bestCell.y},${bestCell.z}: ${r.reason}`);
      }
      uncovered = dark.filter((p) => !covered(p) && !unplaceable.includes(p));
      if (!bot.inventory.items().some((i) => i.name === torchName)) { ctx.log('spawnProof: out of torches mid-sweep'); break; }
    }

    ctx.setPhase('finishing');
    await ctx.collectDrops(6, 5000);
    return {
      anchor: anchorName, surveyed: dark.length, existingTorches: existingTorches.length,
      placed, remainingDark: uncovered.length + unplaceable.length,
      ...(unplaceable.length ? { unplaceable: unplaceable.slice(0, 8).map((p) => [p.x, p.y, p.z]) } : {}),
      torchedAt: torchedAt.slice(0, 24),
    };
  },
  doneMsg: (t) => {
    const r = t.result;
    if (r && r.note === 'already lit') return `${r.anchor || 'Area'} already lit — no dark spots.`;
    if (!r || !r.placed) return `No reachable dark spots to torch${r && r.remainingDark ? ` (${r.remainingDark} unreachable)` : ''}.`;
    return `Spawn-proofed ${r.anchor || 'the area'}: placed ${r.placed} torch${r.placed === 1 ? '' : 'es'}${r.remainingDark ? `, ${r.remainingDark} still dark (unreachable)` : ''}.`;
  },
});

// ---------------------------------------------------------------------------
// structureAudit (#4b) — diff registered protected.json regions vs the world, REPORT drift
// ---------------------------------------------------------------------------
S.define('structureAudit', {
  description: 'Re-verify registered protected.json structures against the world and REPORT damage (a torch post gone to air, missing walls) instead of a driver discovering it during an unrelated task. Precise for column regions (torch posts); a present/missing census for box/sphere regions. Only audits regions near the bot (stale-chunk rule).',
  params: {
    ids: 'optional array of region ids to audit; default: every protected.json region whose centre is within maxDist',
    maxDist: 'only audit regions whose centre is within this of the bot (default 80); far regions are listed as skipped',
  },
  tool: null,
  validate: (a) => (a.ids && !Array.isArray(a.ids) ? 'ids must be an array of region-id strings' : null),
  fn: async (ctx) => {
    const { bot, args } = ctx;
    const maxDist = args.maxDist || 80;
    const wanted = args.ids ? new Set(args.ids) : null;
    const all = regions();
    if (!all.length) return { ok: false, error: { code: 'no_regions', message: 'digguard not installed / no protected.json regions to audit' } };

    ctx.setPhase('auditing', 'Re-checking base structures against the registry.');
    const me = () => bot.entity.position;
    const report = [];
    const skipped = [];
    let damaged = 0;
    for (const r of all) {
      ctx.step();
      if (wanted && !wanted.has(r.id)) continue;
      const c = regionCenter(r);
      if (!c) { skipped.push({ id: r.id, why: 'no-geometry' }); continue; }
      if (c.distanceTo(me()) > maxDist && !wanted) { skipped.push({ id: r.id, why: 'far' }); continue; }
      // walk close enough that reads are live for this region
      if (c.distanceTo(me()) > 24) { try { await ctx.gotoNear(c, 6, 30000); } catch (_) {} }
      const rx = new RegExp(r.match || '.', 'i');

      if (r.kind === 'columns' && Array.isArray(r.columns)) {
        // PRECISE diff: every listed [x,z] column across [yMin,yMax] should hold a matching block
        const missing = [];
        let present = 0, total = 0;
        for (const [x, z] of r.columns) {
          for (let y = r.yMin; y <= r.yMax; y++) {
            total++;
            const b = bot.blockAt(new V(x, y, z));
            if (b && !AIR.has(b.name) && rx.test(b.name)) present++;
            else if (!b || AIR.has(b.name)) missing.push([x, y, z]);
          }
        }
        const ok = missing.length === 0;
        if (!ok) damaged++;
        report.push({ id: r.id, kind: 'columns', ok, present, total, missing: missing.slice(0, 12), missingCount: missing.length });
      } else {
        // box/sphere: census of matching structure blocks present vs air in the AABB (no stored
        // baseline layout, so this is informational — a sharp drop = investigate)
        const min = r.min, max = r.max;
        if (!min || !max) { skipped.push({ id: r.id, why: 'no-aabb' }); continue; }
        let present = 0, air = 0, cells = 0;
        const CAP = 4000;
        for (let x = min[0]; x <= max[0] && cells < CAP; x++)
          for (let y = min[1]; y <= max[1] && cells < CAP; y++)
            for (let z = min[2]; z <= max[2] && cells < CAP; z++) {
              cells++;
              const b = bot.blockAt(new V(x, y, z));
              if (!b) continue;
              if (AIR.has(b.name)) air++;
              else if (rx.test(b.name)) present++;
            }
        report.push({ id: r.id, kind: r.kind, present, air, cells });
      }
    }
    ctx.setPhase('finishing');
    const anyDamage = damaged > 0;
    if (anyDamage) {
      const hits = report.filter((x) => x.ok === false).map((x) => `${x.id}(-${x.missingCount})`).join(' ');
      ctx.log(`structure_damaged ${hits}`);   // greppable in status.log, like TASK_DONE
      ctx.say(`!structure_damaged: ${hits} — ${damaged} registered structure(s) show missing blocks. See BASE.md / repair.`);
    }
    return { audited: report.length, damaged, anyDamage, regions: report, ...(skipped.length ? { skipped } : {}) };
  },
  doneMsg: (t) => {
    const r = t.result;
    if (!r || !r.audited) return 'Nothing to audit.';
    return r.anyDamage
      ? `AUDIT: ${r.damaged} of ${r.audited} structures DAMAGED — see the structure_damaged line.`
      : `Audit clean: ${r.audited} structures intact.`;
  },
});

// ---- registry + staleness bookkeeping ----
const NAMES = ['spawnProof', 'structureAudit'];
globalThis.__basekeeping = {
  version: 1, skills: NAMES,
  restore() { for (const n of NAMES) { try { delete S.registry[n]; } catch (_) {} } },
};
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.basekeeping = { version: 1, boundAt: Date.now(), stale: false };
try { bot.once('end', () => { try { REG.basekeeping.stale = true; } catch (_) {} }); } catch (_) {}

return { installed: true, version: 1, skills: NAMES };
