// bench/fixtures/agenda-deepkit.js — the deep kit's tool-repair floors (#43 item 1) at the
// RESTOCK rung: does it fire on missing sticks or table, ask the depot for them by name,
// produce them in the right order when the depot is out, and clear only on the buffered
// target? Stubs __skills.start, so nothing runs and nothing moves; restores everything.
//
// Run:  curl -s localhost:<port>/eval -H 'content-type: application/json' \
//         --data "$(jq -Rn --rawfile c bench/fixtures/agenda-deepkit.js '{code:$c}')" | jq .result
//
// The point of the floors is that they SELF-HEAL. A kit requirement that RESTOCK cannot
// satisfy is a permanent refusal, not a safeguard — so every item the gate demands has to be
// withdrawable or produceable, and these cases are what proves it.
const A = globalThis.__agenda, S = globalThis.__skills;
const R = A.rung('RESTOCK');
const realStart = S.start;
const out = { version: A.version, fire: [], acts: [] };
A.busy = true;
const saved = { p: A.project, o: A.owner, sd: A.standDown, sh: A._restockShort, at: A._restockShortAt };
let calls = [];
S.start = (b, n, a) => { calls.push(n + ':' + JSON.stringify(a)); return { ok: true, taskId: 'stub' }; };

const FLOOR = { torches: 16, food: 4, filler: 16, sticks: 2, table: 1 };
A.project = { skill: 'mineLane', args: {}, restockFloor: FLOOR };
const base = {
  alive: true, hp: 20, food: 20, foodCount: 8, torches: 24, filler: 24, freeSlots: 20,
  dangerState: 'calm', survivalActive: false, light: 15, surfaceExposed: true, dHome: 10,
  tools: { pickaxe: { name: 'iron_pickaxe', dur: 90 } }, toolCounts: { pickaxe: 2 },
  task: null, role: 'miner', pos: { x: 0, y: 60, z: 0 },
  counts: { stick: 4, crafting_table: 1 },
};
const F = (label, over, expect) => {
  const s = Object.assign({}, base, { now: Date.now() }, over);
  let got = null, err = null;
  try { got = { fire: Boolean(R.fire(s)), clear: Boolean(R.clear(s)) }; } catch (e) { err = String(e.message || e); }
  out.fire.push({ label, expect, got, err, PASS: !err && got.fire === expect.fire && got.clear === expect.clear });
};
const ACT = (label, over, expect) => {
  calls = []; A.activeTaskId = null;
  const s = Object.assign({}, base, { now: Date.now() }, over);
  return Promise.resolve(R.act(s)).then((a) => {
    out.acts.push({ label, expect, action: a, started: calls, PASS: calls.join() === expect });
  });
};

return (async () => {
  try {
    F('fully kitted -> no fire, clears', {}, { fire: false, clear: true });
    F('no crafting table -> fires', { counts: { stick: 4, crafting_table: 0 } }, { fire: true, clear: false });
    F('no sticks -> fires', { counts: { stick: 0, crafting_table: 1 } }, { fire: true, clear: false });
    F('sticks exactly AT floor 2 -> no fire but does NOT clear (needs 1.5x)',
      { counts: { stick: 2, crafting_table: 1 } }, { fire: false, clear: false });
    F('sticks at 3 (ceil(2*1.5)) -> clears', { counts: { stick: 3, crafting_table: 1 } }, { fire: false, clear: true });

    // the withdraw ask must NAME the new items
    A._restockShort = null; A._restockShortAt = 0;
    await ACT('withdraw asks for stick + crafting_table', { counts: { stick: 0, crafting_table: 0 } },
      'restock:{"needs":{"torch":24,"bread":6,"cobblestone":24,"stick":3,"crafting_table":1}}');

    // and when the depot is out, produce them — table first
    A._restockShort = { torch: 24, stick: 3, crafting_table: 1 }; A._restockShortAt = Date.now();
    await ACT('depot out -> produce the TABLE first', { counts: { stick: 0, crafting_table: 0 } },
      'produce:{"resource":"crafting_table","count":1}');
    A._produceCooldown = { crafting_table: Date.now() + 60000 };
    await ACT('table on cooldown -> sticks next', { counts: { stick: 0, crafting_table: 0 } },
      'produce:{"resource":"stick","count":4}');
    A._produceCooldown = { crafting_table: Date.now() + 60000, stick: Date.now() + 60000 };
    await ACT('table+sticks on cooldown -> torches next', { counts: { stick: 0, crafting_table: 0 }, torches: 4 },
      'produce:{"resource":"torch","count":24}');
    A._produceCooldown = {};

    out.firePassed = out.fire.filter((c) => c.PASS).length;
    out.actPassed = out.acts.filter((c) => c.PASS).length;
    out.failures = [...out.fire, ...out.acts].filter((c) => !c.PASS).map((c) => c.label);
    return out;
  } finally {
    S.start = realStart; A.project = saved.p; A.owner = saved.o; A.standDown = saved.sd;
    A._restockShort = saved.sh; A._restockShortAt = saved.at; A._produceCooldown = {};
    A.activeTaskId = null; A.busy = false;
  }
})();
