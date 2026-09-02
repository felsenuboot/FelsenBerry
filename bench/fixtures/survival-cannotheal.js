// bench/fixtures/survival-cannotheal.js — #92: WALL_OFF's heal-deadlock fix. Verifies the two
// deterministic pieces directly, same save/restore discipline as agenda-escape.js: nothing is
// fabricated that a real encounter couldn't produce, everything touched is restored in
// `finally`.
//
// Section A (cannotHeal() itself) is a pure-function check: zero side effects, food/inventory
// are monkey-patched and restored before anything else runs.
// Section B (the orchestration-level g.standdown gate) calls the REAL `enter()` via
// `V.trigger()` — not a drill() branch override — because #92's actual bug lived in enter()'s
// own re-entry logic, not in any one branch. To keep each case fast and side-effect-light,
// bot.health/food are restored to a healthy state before Section B runs, so if a case is
// SUPPOSED to proceed for real, whichever branch fires resolves in one tick (already "healed")
// or a short bounded goto (FLEE_HOME/WALL_OFF's own no-filler retreat) rather than a real
// 60s wait. Intended for a disposable QA bot, not a fleet bot — matches this file's own
// documented drill()/runBranch precedent ("perfectly safe... unlike ever doing this for real").
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/survival-cannotheal.js '{code:$c}')" | jq .result
const V = globalThis.__survival;
const out = { survival: V && V.version, cases: [] };
if (!V || typeof V.cannotHeal !== 'function' || !('standdown' in V)) {
  out.skipped = 'no cannotHeal()/standdown support — engine predates #92';
  return out;
}
const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const saved = {
  food: bot.food,
  health: bot.health,
  items: bot.inventory.items,
  standdown: V.standdown,
  danger: globalThis.__danger,
  lastEnd: V.lastEnd,
};

try {
  // ---- Section A: cannotHeal() itself, zero side effects (no enter() call at all) ----
  bot.inventory.items = () => [];
  bot.food = 9;
  T('food<regen, no food item -> cannotHeal', V.cannotHeal(), true);

  bot.inventory.items = () => [{ name: 'bread', count: 1 }];
  T('food<regen, HAS a food item -> not cannotHeal', V.cannotHeal(), false);

  bot.inventory.items = () => [];
  bot.food = 20;
  T('food already >= regen threshold -> not cannotHeal regardless of inventory', V.cannotHeal(), false);

  bot.food = saved.food;
  bot.inventory.items = saved.items;

  // ---- Section B: the enter() standdown gate. Force a healthy state first so any case
  // that DOES proceed resolves in ~one tick (branchWallOff's own "already healed" check)
  // instead of a real 60s wait — matters if this fixture ever runs against a bot that is
  // for real still hurt/hungry from something else, not just a freshly spawned one.
  bot.health = Math.max(bot.health, 16);
  bot.food = Math.max(bot.food, 18);

  globalThis.__danger = { threats: [] };
  V.standdown = { since: Date.now(), hp: bot.health };
  V.lastEnd = 0;
  const f1 = V.fires;
  await V.trigger('hp');
  T('standdown armed, hp unchanged, no threat -> trigger() is a silent no-op (no new fire)', V.fires, f1);

  globalThis.__danger = { threats: [] };
  V.standdown = { since: Date.now(), hp: bot.health + 5 };   // "stood down" at a HIGHER hp than now = a real drop since
  V.lastEnd = 0;
  const f2 = V.fires;
  await V.trigger('hp');
  T('standdown armed but hp has dropped since standdown -> trigger() proceeds for real', V.fires > f2, true);

  globalThis.__danger = { threats: [{ name: 'test_threat', d: 5 }] };
  V.standdown = { since: Date.now(), hp: bot.health };
  V.lastEnd = 0;
  const f3 = V.fires;
  await V.trigger('hp');
  T('standdown armed, hp unchanged, but a live threat is present -> trigger() proceeds for real', V.fires > f3, true);
  await sleep(300);   // let FLEE_HOME/WALL_OFF's brief travel settle before the next case

  globalThis.__danger = { threats: [] };
  V.standdown = { since: Date.now() - (V.cfg.standdownMaxMs + 1000), hp: bot.health };
  V.lastEnd = 0;
  const f4 = V.fires;
  await V.trigger('hp');
  T('standdown stale past standdownMaxMs -> trigger() proceeds anyway (never silent forever)', V.fires > f4, true);

  // ---- Section C (#100): standdown's arming predicate, tested per-branch via g.drill() —
  // NOT V.trigger(), because these cases need to force WHICH branch runs (drill's own
  // pickOverride bypasses the standdown entry-gate too, which is fine: it's the ARMING
  // logic after the branch returns that's under test here, not the entry short-circuit
  // Section B already covers). A fabricated threat (id:null) makes CREEPER/FLEE_AWAY
  // resolve on their first 250ms poll with no real entity to chase — cheap, safe, matches
  // this file's own established drill()/runBranch fabricated-threat precedent.
  bot.food = 9;                       // < regenFood, no food item (still true from Section A's
  bot.inventory.items = () => [];     // restore, done again here since Section B changed both)
  globalThis.__danger = { threats: [] };

  V.standdown = null;
  await V.drill('ENV', { name: 'fire', d: 0, id: null });
  T('#100: ENV is excluded from arming even when calm+cannotHeal', V.standdown, null);

  V.standdown = null;
  const flee = await V.drill('FLEE_AWAY', { name: 'zombie', d: 3, ranged: false, id: null });
  T('#100: FLEE_AWAY reports cornered with no real entity to flee (sanity check on the drill setup)',
    flee && flee.out && flee.out.cornered, true);
  T('#100: FLEE_AWAY cornered:true is excluded from arming even when calm+cannotHeal', V.standdown, null);

  V.standdown = null;
  await V.drill('CREEPER', { name: 'creeper', d: 3, id: null });
  T('#100: a NON-excluded branch (CREEPER) arms standdown when calm+cannotHeal — the actual #99/#100 generalization',
    Boolean(V.standdown), true);

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
  return out;
} finally {
  bot.food = saved.food;
  bot.health = saved.health;
  bot.inventory.items = saved.items;
  V.standdown = saved.standdown;
  globalThis.__danger = saved.danger;
  V.lastEnd = saved.lastEnd;
}
