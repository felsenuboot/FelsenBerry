// dangerscan v6 payload (inject via POST /eval, idempotent).
//
// v6 (#106): raw `.light` (block light) turned out to be broadly unreliable on this server —
// stuck at 0 in open daylight, AND stuck at 0 immediately next to a real, confirmed-present
// torch after a full relog — not trustworthy in either direction, so it can't even serve as
// a cheap pre-filter. `light`/`g.light` (what everything downstream already consumed) is now
// a COMPOSITE: surface uses skyLight+bot.time.isDay (both independently verified reliable,
// #105's own fix), underground/enclosed uses a bounded findBlock scan for a real torch block
// within TORCH_COVER (basekeeping.js's own already-proven "coverage is torch-distance, not a
// light readback" pattern) instead of trusting any light value. The old raw sample is kept
// separately as `rawLight`, for diagnostics only — never as truth. See lightInfo() below.
//
// v5 (#68 field finding): columnOpen()'s surfaceExposed check didn't distinguish forest
// canopy (leaves) from a real ceiling (stone/dirt/etc), so chopTrees under any tree canopy
// read as "underground" and spuriously woke LIGHT/ESCAPE. See columnOpen's own comment below.
//
// v4 (#65): the linear proximity falloff let a single close, clearly-seen hostile score
// well under the panic(5) threshold at full HP (a skeleton at d=2 with full LOS scored
// ~3.67) — survival.js's branches were then invoked only once the `health < 10` situational
// multiplier or the raw hpPanic(8) backstop eventually caught up, by which point ~12 HP had
// already been lost with zero defensive response. A close-range escalation in scan() now
// pushes threats already inside near-melee range over threshold immediately instead of
// waiting for the bot to already be hurt. See survival.js's own v5 changelog for the rest
// of this issue's fixes.
//
// The 4Hz "wallhack" hostile scan from research/survival-doctrine.md section 3, plus the
// status fields three FEEDBACK entries asked for. Pure read — it never moves the bot,
// never digs, never fights. It only ANSWERS "how dangerous is it right here".
//
// Why it works: the server streams every tracked entity within ~48 blocks through
// bot.entities REGARDLESS of line of sight. Scanning that object is free (data is already
// client-side) and sees the zombie in the sealed cavity BEFORE the bot digs into it.
// bot.world is a WorldSync on this stack, so raycast LOS checks are synchronous —
// verified live, no await in the hot loop.
//
// Provides:
//   globalThis.__danger.score / .state ('calm'|'alert'|'panic') / .threats[]
//   globalThis.__danger.on(fn)   -> state-change callbacks (survival.js subscribes)
//   __skills.status() gains  bot.held {name,dur%}, bot.light/rawLight/skyLight/surfaceExposed,
//                            and a top-level danger block — drivers get it for free.
// Resolves FEEDBACK: "tool durability invisible in status", the signal half of
// "come/goto silently tunnels underground", "elevation overhang blind spot".
//
// Ordering: inject AFTER skills.js (it wraps __skills.status). Re-inject after restarts.
// Tune live:  __danger.weights.creeper = 6   /   __danger.thresholds.alert = 3
// Remove: __danger.restore()
if (globalThis.__danger && globalThis.__danger.restore) { try { globalThis.__danger.restore(); } catch (e) {} }

const g = {
  enabled: true, version: 6,
  score: 0, state: 'calm', threats: [], nearest: null,
  scans: 0, errors: 0, lastScan: 0, lastStateChange: 0,
  light: null, rawLight: null, skyLight: null, surfaceExposed: null,
  held: null,
  listeners: [],
  // survival-doctrine section 3 table. All constants live here so field tuning is one /eval.
  weights: {
    creeper: 5, skeleton: 4, stray: 4, bogged: 4, witch: 3.5, phantom: 3,
    cave_spider: 3, drowned: 2.5, zombie: 2.5, husk: 2.5, zombie_villager: 2.5,
    zombified_piglin: 2, spider: 2, slime: 1, silverfish: 1, endermite: 1,
    pillager: 3.5, vindicator: 4, evoker: 4, ravager: 5, vex: 2,
    blaze: 4, ghast: 3, magma_cube: 1.5, piglin_brute: 4.5, hoglin: 3,
    warden: 10, enderman: 0.5,
  },
  thresholds: {
    radius: 24,        // entities beyond this contribute nothing
    alert: 2.5,        // >= -> ALERT
    alertLeave: 1.5,   // hysteresis: drop back to calm only below this
    panic: 5,          // >= -> PANIC
    hpPanic: 8,        // existing panicguard rule, kept
    creeperRadius: 8,  // any creeper this close -> PANIC regardless of score
    maxRaycasts: 8,    // bound the per-scan LOS cost
    toolLowPct: 15,    // <= -> log tool_low once per tool
    panicSelfHealMs: 10000, // clear a latched panic after this much calm IF nobody subscribed
  },
  calmSince: 0,
  intervalMs: 250,
};
globalThis.__danger = g;

const pushLog = (lvl, msg) => {
  try {
    const S = globalThis.__skills;
    if (!S || !Array.isArray(S.log)) return;
    S._seq = (S._seq || 0) + 1;
    S.log.push({ seq: S._seq, lvl, msg: String(msg).slice(0, 200) });
    if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
  } catch (e) {}
};

// ---- line of sight (sync on WorldSync; null return = nothing solid in the way) ----
const hasLOS = (eye, ent) => {
  try {
    const target = ent.position.offset(0, Math.min(ent.height || 1.8, 1.8) * 0.5, 0);
    const dir = target.minus(eye);
    const dist = dir.norm();
    if (dist < 0.5) return true;
    const hit = bot.world.raycast(eye, dir.scaled(1 / dist), Math.min(dist, g.thresholds.radius));
    return !hit;
  } catch (e) { return true; } // fail toward caution: assume it can see us
};

// ---- held-item durability ----
const heldInfo = () => {
  try {
    const it = bot.heldItem;
    if (!it) return null;
    const max = it.maxDurability || (bot.registry.items[it.type] && bot.registry.items[it.type].maxDurability) || 0;
    if (!max) return { name: it.name, count: it.count };
    const used = it.durabilityUsed || 0;
    return { name: it.name, count: it.count, dur: Math.max(0, Math.round(((max - used) / max) * 100)) };
  } catch (e) { return null; }
};

// ---- light / sky exposure (the "am I actually underground" signal) ----
// v2 (marcel-driver, issue #18): a single light sample is NOT trustworthy. Standing in the
// middle of farm_1 with open air all the way up, skyLight read 0 at BOTH feet and head, so
// a neighbour-check workaround would not have caught it either — the server's light packets
// simply go stale. Light is now a hint, and GEOMETRY is the authority: sample three points
// and take the max, then, only when that still claims darkness, settle it by scanning the
// column for a real solid block. The scan runs only in the disputed case, so the 4Hz cost
// is unchanged on the surface (skyLight > 0 short-circuits) and bounded underground.
const COLUMN_SCAN = 24;
// Leaves are `boundingBox:'block'` (a real solid full cube) but are forest canopy, not an
// enclosure -- a bot standing under a tree is in daylight and can walk out any direction, the
// opposite of what surfaceExposed:false is meant to signal. Without this, chopTrees spuriously
// reads as "underground": skyLight genuinely reads 0 under a canopy (correctly -- leaves DO
// block light), columnOpen then finds the first leaf block and calls it solid, and LIGHT/ESCAPE
// (agenda.js) wake up over an above-ground tree-chopping bot with nothing useful to do. Live
// field finding (#68, engine-dev): chopTrees stopped and restarted from zero every ~50s under
// canopy — LIGHT fired, found no dark spot worth torching, stood itself down for 30s, PROJECT
// resumed, repeat — for the soak's entire duration, since it never actually left the forest.
const LEAVES = /_leaves$/;
const columnOpen = (feet) => {
  for (let dy = 2; dy <= COLUMN_SCAN; dy++) {
    const b = bot.blockAt(feet.offset(0, dy, 0));
    if (!b) return null;                       // unloaded chunk: unknown, never guess
    if (LEAVES.test(b.name)) continue;
    if (b.boundingBox === 'block') return false;
  }
  return true;                                 // nothing solid (leaves aside) overhead within the window
};
// Exposed for fixture testing (same pattern as skills.js's findRepositionTarget ->
// S.recoveryDetect): lightInfo()'s own skyLight short-circuit makes it hard to reliably
// force the disputed-geometry branch live -- RCON-placed blocks don't always trigger a
// prompt client-visible relight, so a fixture can't just fill a leaf roof and expect
// skyLight to read dark on cue. columnOpen is pure given a blockAt accessor, so testing it
// directly bypasses that server-timing flakiness entirely.
g.columnOpen = columnOpen;

// #106: `.light` (raw block light) is not trustworthy AT ALL on this server, in either
// direction — live-verified (FEEDBACK.md 2026-09-02/03): reads a stuck 0 in broad open-sky
// daylight, AND stays stuck at 0 immediately next to a real, confirmed-present, bot-placed
// torch after a full relog and 10s+ settle. Neither "trust it when it says bright" nor
// "trust it when it says dark" holds, so raw light cannot serve even as a pre-filter here —
// any gate keyed off it would be exactly as unreliable as reading it directly. Two
// independently-reliable primitives replace it, matching #105's own fix and basekeeping.js's
// own already-proven doctrine for the exact same field:
//  - surface (surfaceExposed:true): `skyLight` (real, geometry-backed, verified responsive)
//    gated by `bot.time.isDay` (real, immediately-updating) — the composite this issue is
//    named for.
//  - underground/enclosed (surfaceExposed:false): basekeeping.js's own "coverage is torch-
//    DISTANCE, not a light readback" pattern (its own header, since #17) — a bounded
//    findBlock scan for a real torch BLOCK within TORCH_COVER, not a light value. This is
//    the "track torch positions in code" fix team-lead specified after basekeeping's own
//    doctrine was re-confirmed necessary (light unreliable even as a filter here, not just
//    as confirmation).
const TORCH_NAMES = ['torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'copper_torch', 'copper_wall_torch', 'redstone_torch', 'redstone_wall_torch'];
const TORCH_COVER = 12;   // taxicab-ish reach for findBlock's maxDistance — matches basekeeping.js's COVER (block light >=1, the real spawn threshold)
let _torchIds = null;
const torchIds = () => {
  if (_torchIds) return _torchIds;
  try {
    _torchIds = TORCH_NAMES.map((n) => (bot.registry.blocksByName[n] || {}).id).filter((v) => v != null);
  } catch (e) { _torchIds = []; }
  return _torchIds;
};
// A bounded, live world query — not a persisted position ledger. A torch that gets mined or
// decays is correctly reflected on the very next scan, which a remembered-position list would
// not give for free; findBlock over a 12-block radius on an already-loaded chunk is cheap
// (the same order of cost as the 3-point block sampling already run every scan).
const torchNearby = (feet) => {
  try {
    const ids = torchIds();
    if (!ids.length) return null;                // registry not ready yet — unknown, not "no"
    return bot.findBlock({ matching: ids, maxDistance: TORCH_COVER, count: 1 }) != null;
  } catch (e) { return null; }
};
const isDaylight = () => { try { return bot.time ? Boolean(bot.time.isDay) : null; } catch (e) { return null; } };

const lightInfo = () => {
  try {
    const p = bot.entity.position;
    const feet = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    let raw = null, sky = null;
    for (const s of [feet, feet.offset(0, 1, 0), feet.offset(0, 2, 0)]) {
      const b = bot.blockAt(s);
      if (!b) continue;
      if (typeof b.light === 'number') raw = Math.max(raw == null ? 0 : raw, b.light);
      let sv = null;
      try { sv = bot.world.getSkyLight ? bot.world.getSkyLight(s) : null; } catch (e) {}
      if (typeof sv !== 'number' && typeof b.skyLight === 'number') sv = b.skyLight;
      if (typeof sv === 'number') sky = Math.max(sky == null ? 0 : sky, sv);
    }
    // exposed: true / false / null (unknown — unloaded chunk, never a guess)
    let exposed = sky != null && sky > 0 ? true : null;
    let viaColumn = false;
    if (exposed === null) { exposed = columnOpen(feet); viaColumn = true; }
    // effective (composited) light — this is what `light`/`g.light`/agenda.js's s.light mean
    // from here on; `raw` is kept separately (rawLight) for diagnostics only, never as truth.
    let light = null;
    if (exposed === true) {
      const day = isDaylight();
      light = day == null ? null : (day ? sky : 0);
    } else if (exposed === false) {
      const near = torchNearby(feet);
      light = near == null ? null : (near ? 15 : 0);
    }
    return { light, rawLight: raw, skyLight: sky, surfaceExposed: exposed, skyViaColumn: viaColumn };
  } catch (e) { return { light: null, rawLight: null, skyLight: null, surfaceExposed: null, skyViaColumn: false }; }
};

const scan = () => {
  const out = { score: 0, threats: [] };
  const me = bot.entity && bot.entity.position;
  if (!me || typeof bot.health !== 'number') return out;
  const eye = me.offset(0, 1.62, 0);
  const R = g.thresholds.radius;

  // collect candidates first, nearest-first, so the raycast budget goes to what matters
  const cands = [];
  for (const e of Object.values(bot.entities)) {
    if (!e || !e.position || e === bot.entity) continue;
    if (e.type !== 'hostile' && e.type !== 'mob') continue;
    const w = g.weights[e.name];
    if (!w) continue;
    const d = e.position.distanceTo(me);
    if (d > R) continue;
    cands.push({ e, w, d });
  }
  cands.sort((a, b) => a.d - b.d);

  let rays = 0;
  for (const c of cands) {
    const ranged = c.e.name === 'skeleton' || c.e.name === 'stray' || c.e.name === 'bogged' || c.e.name === 'witch';
    let los;
    if (rays < g.thresholds.maxRaycasts) { los = hasLOS(eye, c.e) ? 1 : (ranged ? 0.3 : 0.6); rays++; }
    else los = ranged ? 0.3 : 0.6; // budget spent: assume no LOS rather than skipping the threat
    let s = c.w * Math.max(0, (R - c.d) / R) * los;
    // #65: the linear (R-d)/R falloff undersells a threat that is ALREADY close. A
    // skeleton at d=2 with full LOS scored ~3.67 (weight 4) at full HP — below panic(5) —
    // and the only thing that eventually crossed the threshold was the `health < 10`
    // multiplier below, i.e. the bot had to already be hurt before detection caught up.
    // Live-traced: a bot took ~12 HP of completely undefended damage (20 -> ~8) before
    // survival.js's branches were ever invoked, against a threat standing right next to
    // it from the first tick. `close`/`closer` thresholds are melee/near-melee range,
    // not the general engagement radius above — this doesn't touch scoring for anything
    // further out, only escalates what's already effectively on top of the bot.
    if (los === 1 && c.d <= 4) s *= c.d <= 2 ? 2 : 1.5;
    out.score += s;
    out.threats.push({
      name: c.e.name, d: Math.round(c.d * 10) / 10, s: Math.round(s * 100) / 100,
      los: los === 1, ranged, id: c.e.id,
      pos: [Math.round(c.e.position.x), Math.round(c.e.position.y), Math.round(c.e.position.z)],
    });
  }

  // situational multipliers (survival-doctrine section 3)
  if (bot.health < 10) out.score *= 1.5;
  if (bot.food < 6) out.score *= 1.25;
  if (me.y < 0) out.score *= 1.25;
  const li = lightInfo();
  // spawnable-dark bonus: only when the COLUMN agrees we are enclosed. A stale skyLight 0
  // on an open farm tile used to inflate danger by 0.5 for no reason (issue #18).
  if (li.light === 0 && li.skyLight === 0 && li.surfaceExposed === false) out.score += 0.5;

  out.score = Math.round(out.score * 100) / 100;
  out.threats.sort((a, b) => b.s - a.s);
  out.light = li.light; out.rawLight = li.rawLight; out.skyLight = li.skyLight;
  out.surfaceExposed = li.surfaceExposed; out.skyViaColumn = li.skyViaColumn;
  return out;
};

const panicNow = (score, threats) => {
  const T = g.thresholds;
  return score >= T.panic || bot.health < T.hpPanic ||
    threats.some((t) => t.name === 'creeper' && t.d <= T.creeperRadius);
};

const decideState = (score, threats) => {
  const T = g.thresholds;
  if (panicNow(score, threats)) { g.calmSince = 0; return 'panic'; }
  if (g.state === 'panic') {
    // survival.js owns the panic exit and calls clearPanic() when its recovery
    // completes. With NO subscriber the latch would stick forever (seen in test),
    // so a scanner running solo self-heals after PANIC_SELFHEAL_MS of calm.
    if (g.listeners.length > 0) return 'panic';
    if (!g.calmSince) g.calmSince = Date.now();
    if (Date.now() - g.calmSince < g.thresholds.panicSelfHealMs) return 'panic';
    g.calmSince = 0;
  }
  if (score >= T.alert) return 'alert';
  if (g.state === 'alert' && score >= T.alertLeave) return 'alert'; // hysteresis
  return 'calm';
};

let lastToolWarn = '';
const tick = () => {
  if (globalThis.__danger !== g || !g.enabled) { clearInterval(g.timer); return; }
  try {
    const r = scan();
    g.score = r.score; g.threats = r.threats.slice(0, 6);
    g.nearest = r.threats.length ? r.threats[0] : null;
    g.light = r.light; g.rawLight = r.rawLight; g.skyLight = r.skyLight;
    g.surfaceExposed = r.surfaceExposed;   // geometry-backed, not a bare light read
    g.skyViaColumn = Boolean(r.skyViaColumn);
    g.held = heldInfo();
    g.scans++; g.lastScan = Date.now();

    // tool_low: once per tool instance, not per tick
    if (g.held && typeof g.held.dur === 'number' && g.held.dur <= g.thresholds.toolLowPct) {
      const key = g.held.name + ':' + Math.floor(g.held.dur / 5);
      if (key !== lastToolWarn) {
        lastToolWarn = key;
        pushLog('warn', `tool_low: ${g.held.name} at ${g.held.dur}% — replacing it outranks the job`);
      }
    } else if (g.held && typeof g.held.dur === 'number' && g.held.dur > g.thresholds.toolLowPct + 10) {
      lastToolWarn = '';
    }

    const next = decideState(g.score, g.threats);
    if (next !== g.state) {
      const prev = g.state;
      g.state = next; g.lastStateChange = Date.now();
      const top = g.nearest ? `${g.nearest.name} at ${g.nearest.d}` : 'no visible threat';
      if (next !== 'calm') pushLog('warn', `danger ${next} (${g.score}): ${top}`);
      else pushLog('info', `danger clear (${g.score})`);
      // metrics: threat exposure over time (EVALUATION E4). Transitions only, never per-scan —
      // a 4Hz loop would drown the ledger in noise for no analytical gain.
      try { const m = globalThis.__metrics; if (m && m.danger) m.danger(next, prev, g.score, g.nearest); } catch (e) {}
      for (const fn of g.listeners.slice()) { try { fn(next, prev, g); } catch (e) { g.errors++; } }
    }
  } catch (e) { g.errors++; }
};

g.on = (fn) => { if (typeof fn === 'function' && !g.listeners.includes(fn)) g.listeners.push(fn); return g.listeners.length; };
g.off = (fn) => { g.listeners = g.listeners.filter((f) => f !== fn); return g.listeners.length; };
g.scan = scan;               // one-shot, for manual /eval inspection
g.clearPanic = () => { g.state = 'calm'; g.lastStateChange = Date.now(); }; // survival.js calls this on recovery
g.snapshot = () => ({
  score: g.score, state: g.state, threats: g.threats, held: g.held,
  light: g.light, rawLight: g.rawLight, skyLight: g.skyLight, surfaceExposed: g.surfaceExposed,
  scans: g.scans, errors: g.errors,
});

// ---- graft the new fields onto __skills.status so drivers get them free ----
// (When P0.4 lands natively in skills.js this wrapper detects it and stands down.)
const S = globalThis.__skills;
if (S && typeof S.status === 'function' && !S.status.__dangerWrapped) {
  const orig = S.status.bind(S);
  const wrapped = (b, since = 0) => {
    const st = orig(b, since);
    try {
      if (st && st.bot && !st.bot.disconnected) {
        if (g.held) st.bot.held = g.held;
        st.bot.light = g.light;
        st.bot.rawLight = g.rawLight;
        st.bot.skyLight = g.skyLight;
        st.bot.surfaceExposed = g.surfaceExposed;
      }
      st.danger = { score: g.score, state: g.state, threats: g.threats.slice(0, 3) };
      // survival.js does not wrap status itself (one wrapper, no ordering hazard)
      if (globalThis.__survival && globalThis.__survival.brief) st.survival = globalThis.__survival.brief();
      // honest payload roster: name -> 'v1' or 'v1 STALE' (STALE = bound to a dead bot
      // after a reconnect, re-inject it). Drivers get this in their normal status poll.
      const reg = globalThis.__payloads;
      if (reg) {
        st.payloads = {};
        for (const [k, v] of Object.entries(reg)) st.payloads[k] = 'v' + v.version + (v.stale ? ' STALE' : '');
      }
    } catch (e) {}
    return st;
  };
  wrapped.__dangerWrapped = true;
  wrapped.__orig = orig;
  S.status = wrapped;
  g.statusWrapped = true;
} else {
  g.statusWrapped = false;
}

g.restore = () => {
  g.enabled = false;
  if (g.timer) clearInterval(g.timer);
  g.listeners = [];
  try {
    const SS = globalThis.__skills;
    if (SS && SS.status && SS.status.__dangerWrapped) SS.status = SS.status.__orig;
  } catch (e) {}
};

// ---- staleness registry (see FEEDBACK "injection reports can drift from reality") ----
// A reconnect makes runner.js build a FRESH bot object (runner.js:319) while globalThis
// survives. Left alone this timer keeps scanning the DEAD bot's stale world at 4Hz and
// reports a comfortable "calm" forever — worse than not running. Stop on our bot's 'end'
// and say so; re-injection (or P0.2 auto-inject-on-spawn) rebinds to the live bot.
const REG = (globalThis.__payloads = globalThis.__payloads || {});
REG.dangerscan = { version: 6, boundAt: Date.now(), stale: false };
bot.once('end', () => {
  try {
    REG.dangerscan.stale = true;
    g.enabled = false; g.state = 'stale';
    if (g.timer) clearInterval(g.timer);
  } catch (e) {}
});

g.timer = setInterval(tick, g.intervalMs);
tick();

return {
  installed: true, version: 6, intervalMs: g.intervalMs,
  statusWrapped: g.statusWrapped, skillsPresent: Boolean(S),
  weightsKnown: Object.keys(g.weights).length,
  first: g.snapshot(),
};
