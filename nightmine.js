// nightmine.js — pure decision logic for TODO 5m (#120 follow-up): night productivity inside
// a sealed dig-in. Soak #5's stall attribution showed SHELTER owning 27.7 of 60 minutes with
// nothing happening inside it but a sleep/eat poll — a human who digs in at dusk mines until
// dawn. This is the "should I mine right now, and with what args" half of that fix.
//
// Plain CommonJS module — NOT itself a payload, never injected/eval'd via runner.js's
// AsyncFunction-from-source-text mechanism, same idiom as foods.js (see its own header): a
// real `require()`, loaded defensively by whichever payload consumes it, the same way
// agenda.js/skills.js already load foods.js via `process.mainModule.require(...)`.
//
// Deliberately has ZERO bot/mineflayer access — every input is a plain value the caller
// (survival.js's shelterEnter(), once this lands there) already has or can cheaply compute.
// That is what makes this fixture-testable hermetically (bench/fixtures/nightmine.mjs) without
// a live bot, and it is also the actual safety property this file exists to guarantee: every
// exit condition it can see, it enforces the SAME way regardless of what mineLane itself does
// or how long a batch takes — the caller is expected to re-derive this state and call
// shouldNightMine() again before every batch, not trust a stale decision.

'use strict';

// Should shelterEnter() attempt (another) night-mining batch right now?
//
// state:
//   builtKind    — shelterBuild()'s own result.kind ('digin'|'hut'|null)
//   builtSealed  — shelterBuild()'s own result.sealed
//   hasPickaxe   — checked ONCE, at shelter-entry: a bot that sealed in without one is not
//                  going to grow one mid-night (TOOL, prio 5, never got the body before
//                  SHELTER, prio 2.5, took it) — caller should pass the SAME value every call
//                  within one shelter session, not re-derive it (there is nothing to re-derive).
//   currentY     — freshly read bot Y, EVERY call: mineLane's own search can drift the bot
//                  along a slope even with vein:false, so this is not a one-time check the way
//                  hasPickaxe is.
//   freeSlots    — freshly read every call.
//   batchesUsed  — how many mineLane batches this shelter session has already run.
//
// opts (all optional, defaults argued in FEEDBACK.md's 5m entry):
//   batchCap        — hard ceiling on batches per night (default 12: "a 7-minute night should
//                      be mostly mining", not a token amount — the real bound is the exits
//                      below, this is a backstop against a pathological all-night lane).
//   minY            — refuse a batch whose lane would sit at or below this (default 0: stays
//                      inside the 'underground' kit tier, never 'deep' — steers clear of the
//                      armor/shield/water gap TODO 5o still has to close, rather than depend on
//                      a fix that has not landed).
//   freeSlotsFloor  — reuses DEPOSIT rung's own existing threshold (agenda.js: `fire: (s) =>
//                      s.freeSlots <= 2`) rather than inventing a new number.
function shouldNightMine(state, opts) {
  const s = state || {};
  const o = Object.assign({ batchCap: 12, minY: 0, freeSlotsFloor: 2 }, opts || {});
  if (s.builtKind !== 'digin' || s.builtSealed !== true) return { go: false, reason: 'not_sealed_digin' };
  if (!s.hasPickaxe) return { go: false, reason: 'no_pickaxe' };
  if (typeof s.batchesUsed === 'number' && s.batchesUsed >= o.batchCap) return { go: false, reason: 'batch_cap' };
  // the LANE sits one below current feet (mineLane's own laneY convention, matching
  // nightMineArgs below) -- checked against minY, not currentY itself, so a bot resting
  // exactly at y=0 correctly refuses (its lane would be y=-1, already 'deep') rather than
  // being allowed one batch too many.
  if (typeof s.currentY === 'number' && (s.currentY - 1) < o.minY) return { go: false, reason: 'y_floor' };
  if (typeof s.freeSlots === 'number' && s.freeSlots <= o.freeSlotsFloor) return { go: false, reason: 'inventory_full' };
  return { go: true, reason: null };
}

// Ordered candidate targets for one batch: prefer ore if it is genuinely adjacent, fall back to
// stone (always available, also feeds RESTOCK's own filler/cobblestone economy) rather than
// chase. mineLane's own `target` param is a single block name (confirmed by reading its
// validate()/fn() in skills.js — ORE_ALIASES[a.target] || [a.target], no array support), so
// "prefer ore, never chase" is implemented as an ORDERED LIST of separate, cheap attempts here,
// not a single mineLane call: dispatch coal_ore first with a tight maxDist/vein:false (see
// nightMineArgs) -- mineLane fails FAST and honestly (`throw fatal('not_found', ...)`) the
// instant its own initial scan comes up empty, so trying coal first costs one quick failed scan,
// never a chase. iron_ore next, stone last as the guaranteed catch-all (UBIQUITOUS, always
// findable). The caller tries each in order for a batch, moving to the next only on a
// not_found refusal (not on any other failure -- a hazard/tool error should surface honestly,
// not be papered over by silently trying a different block).
function nightMineTargets() {
  return ['coal_ore', 'iron_ore', 'stone'];
}

// The mineLane args for one attempt at one batch. `restY` is shelterDigIn's own result.restY
// (the bot's resting Y right after the seal, captured ONCE at shelter-entry) -- never the
// live/current Y, so the lane can never creep toward the cap above it, however long the night
// runs or however many batches happen.
function nightMineArgs(target, restY, opts) {
  const o = Object.assign({ maxDist: 8, count: 6 }, opts || {});
  return { target, vein: false, laneY: restY - 1, maxDist: o.maxDist, count: o.count };
}

module.exports = { shouldNightMine, nightMineTargets, nightMineArgs };
