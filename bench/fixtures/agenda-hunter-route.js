// bench/fixtures/agenda-hunter-route.js — the food-bootstrap-paradox routing gap (gear-race
// deadlock, 2026-09-02): #45 already gated huntAnimals on a WEAPON, not on already holding
// food (KIT_TIERS.hunt = {torches, weapon:true}, no foodItems at all) — but ROLE_WORK.hunter
// was never updated to actually USE it, still pointing at harvestGrass under a comment that
// literally said "revisit when #45 gates huntAnimals on a weapon." #45 landed; the comment
// didn't get revisited. A role:'hunter' bot therefore had a correctly-gated hunt path that
// nothing ever routed to, and RESTOCK still demanded food:4 via ROLE_FLOOR.hunter with no
// produce path for it (GOAL.md's own honest-gaps note) — the actual deadlock the race hit.
//
// Fixed: ROLE_WORK.hunter -> huntAnimals. This composes with #84's effectiveKit machinery for
// free: once IDLE's role-work resolves to huntAnimals, roleWorkKit(s) resolves the SAME 'hunt'
// tier for RESTOCK/TOOL, so an idle hunter's floor stops demanding food it cannot produce
// (ROLE_FLOOR.hunter's food:4 is superseded here, not deleted — a bot WITH a project still
// uses that project's own floor), and TOOL provisions the sword huntAnimals needs before it
// ever runs. No new mechanism, just closing the loop between #45 and #84's own fallback.
//
// Stubs __skills.start, same discipline as agenda-resume.js/agenda-deepkit.js: a rung's act()
// reaches runSkill (and so S.start) SYNCHRONOUSLY before its first await, so calling .act(s)
// without awaiting the returned promise is enough to observe what it tried to start.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/agenda-hunter-route.js '{code:$c}')" | jq .result
const A = globalThis.__agenda, S = globalThis.__skills;
const out = { agenda: A.version, cases: [] };
if (!S || !S.registry || !S.registry.huntAnimals) { out.skipped = 'engine predates huntAnimals\' kit spec'; return out; }
const TOOL = A.rung('TOOL'), RESTOCK = A.rung('RESTOCK'), IDLE = A.rung('IDLE');
const realStart = S.start;
let started = [];
S.start = (b, n, a) => { started.push({ name: n, args: a }); return { ok: true, taskId: 'stub' }; };
const saved = { project: A.project, activeTaskId: A.activeTaskId, idleAt: A._idleAt };

const T = (label, got, expect) => out.cases.push({ label, got, expect, PASS: got === expect });

const base = {
  now: Date.now(), alive: true, hp: 20, food: 20, foodCount: 0, torches: 8, filler: 0,
  freeSlots: 20, dangerState: 'calm', survivalActive: false, light: 15, surfaceExposed: true,
  dHome: 10, task: null, counts: {},
};

try {
  A.project = null;   // the exact race condition: no project, food-bootstrap paradox live

  // --- unarmed hunter: TOOL must gate the sword, RESTOCK must NOT gate food ---
  {
    const s = Object.assign({}, base, { role: 'hunter', pos: { x: 0, y: 111, z: 0 },
      tools: {}, toolCounts: {} });
    T('hunter idle, no weapon -> TOOL fires (needs a sword before it can hunt)', TOOL.fire(s), true);
    T('...RESTOCK does NOT demand food (hunt tier has no foodItems floor)', RESTOCK.fire(s), false);
  }

  // --- armed hunter: TOOL clears, and IDLE's role-work must resolve to huntAnimals ---
  {
    const s = Object.assign({}, base, { role: 'hunter', pos: { x: 0, y: 111, z: 0 },
      tools: { sword: { name: 'wooden_sword', dur: 59 } }, toolCounts: {} });
    T('hunter idle, has a sword -> TOOL does not fire', TOOL.fire(s), false);
    T('...RESTOCK stays quiet too', RESTOCK.fire(s), false);
  }
  {
    started = []; A.activeTaskId = null; A._idleAt = 0;
    const s = Object.assign({}, base, { role: 'hunter', pos: { x: 0, y: 111, z: 0 },
      tools: { sword: { name: 'wooden_sword', dur: 59 } }, toolCounts: {} });
    IDLE.act(s);   // reaches S.start synchronously before its first await — see header
    T('armed hunter idle -> IDLE routes to huntAnimals (was harvestGrass)',
      started.length === 1 ? started[0].name : `${started.length} calls`, 'huntAnimals');
  }

  out.passed = out.cases.filter((c) => c.PASS).length;
  out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${c.expect}, got ${c.got}`);
  return out;
} finally {
  S.start = realStart;
  A.project = saved.project; A.activeTaskId = saved.activeTaskId; A._idleAt = saved.idleAt;
}
