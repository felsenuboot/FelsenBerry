// bench/fixtures/panic-gate.mjs — bench/lib/panic-gate.mjs (#121/5r, 2026-09-03). PURE NODE,
// hermetic: synthetic threat lists / streak state in, actionableThreats()/panicStreakStep()
// verdicts out. No ledger, no live bot -- same doctrine as trail-vacuous.mjs / vitals-floor.mjs
// / latency-breakdown.mjs / stall-attribution.mjs / ledger-gaps.mjs.
//
// Run:  node bench/fixtures/panic-gate.mjs
import { actionableThreats, panicStreakStep, ACTIONABLE_MAX_D, PANIC_STREAK_ESCALATE_AT, PANIC_STREAK_EXPIRY_MS }
  from '../lib/panic-gate.mjs';

const out = { cases: [] };
const T = (label, got, expect) => out.cases.push({ label, got, expect,
  PASS: JSON.stringify(got) === JSON.stringify(expect) });

const t0 = 1_800_000_000_000;
const emptyStreak = () => ({ threatId: null, count: 0, lastAt: 0, lastHp: null });

// ---- 1. actionableThreats: the live specimen's own exact shape (#121/5r's real find) ----
{
  const threats = [{ id: 3952, name: 'creeper', d: 16.1, los: false, ranged: false }];
  T('the live specimen itself: los:false, d=16.1 -- the phantom that caused the whole loop -- is filtered out',
    actionableThreats(threats), []);
}
{
  // the lead's own named case: los:false, d=14 (just past ACTIONABLE_MAX_D=12)
  const threats = [{ id: 1, name: 'skeleton', d: 14, los: false }];
  T('los:false, d=14 (>12) -- filtered out (the lead\'s own named phantom case)', actionableThreats(threats), []);
}
{
  const threats = [{ id: 1, name: 'skeleton', d: 12, los: false }];
  T('los:false, d=12 (== ACTIONABLE_MAX_D, boundary) -- kept, inclusive', actionableThreats(threats), threats);
}
{
  const threats = [{ id: 1, name: 'creeper', d: 40, los: true }];
  T('los:true, however far (d=40) -- always kept, a visible threat could still be closing',
    actionableThreats(threats), threats);
}
{
  const near = { id: 1, name: 'zombie', d: 3, los: true };
  const farHidden = { id: 2, name: 'creeper', d: 20, los: false };
  T('mixed list: the actionable one survives, the phantom does not',
    actionableThreats([near, farHidden]), [near]);
}
T('empty list in, empty list out, no crash', actionableThreats([]), []);
T('ACTIONABLE_MAX_D is the documented 12 (matches the lead\'s own "~12 blocks" ask)', ACTIONABLE_MAX_D, 12);

// ---- 2. panicStreakStep: a fresh threat never escalates on its own first sighting ----
{
  const r = panicStreakStep({ streak: emptyStreak(), topThreat: { id: 99 }, pickOverride: false,
    hpBefore: 10, hpAfter: 10, now: t0 });
  T('brand-new threat id: never escalates on sight', r.escalate, false);
  T('brand-new threat id: streak seeds at count 0, not 1', r.nextStreak, { threatId: 99, count: 0, lastAt: t0, lastHp: 10 });
}

// ---- 3. panicStreakStep: the lead's own named case -- reaching 3 escalates to walk-off ----
// Drives the exact sequence enter() would: each call's OWN escalate verdict is checked against
// the INCOMING streak (before this cycle's outcome updates it), never damaged, same threat id
// throughout, one call every 30s (well inside PANIC_STREAK_EXPIRY_MS).
{
  let streak = emptyStreak();
  const topThreat = { id: 3952 };
  const verdicts = [];
  for (let i = 0; i < 6; i++) {
    const now = t0 + i * 30000;
    const r = panicStreakStep({ streak, topThreat, pickOverride: false, hpBefore: 7, hpAfter: 7, now });
    verdicts.push(r.escalate);
    streak = r.nextStreak;
  }
  // i=0 seeds the streak at count 0 (a first sighting is never itself a repeat); i=1..3 each
  // increment on arrival with no damage (count 1,2,3); the ESCALATE check reads the INCOMING
  // count before this cycle's own update, so it's i=4's call (incoming count=3) that first
  // reads count>=3 and escalates -- four honest no-progress cycles, not three, before a
  // walk-off, matching "give it a few tries" rather than firing on the very first repeat.
  T('reaching PANIC_STREAK_ESCALATE_AT(3) with zero damage the whole time escalates from then on',
    verdicts, [false, false, false, false, true, true]);
  T('count keeps climbing past the threshold rather than resetting once it fires (still no progress)',
    streak.count >= PANIC_STREAK_ESCALATE_AT, true);
}

// ---- 4. panicStreakStep: real damage resets the streak, even one cycle before escalation ----
{
  let streak = emptyStreak();
  const topThreat = { id: 42 };
  for (let i = 0; i < 3; i++) {
    const r = panicStreakStep({ streak, topThreat, pickOverride: false, hpBefore: 10, hpAfter: 10, now: t0 + i * 1000 });
    streak = r.nextStreak;
  }
  T('streak built up to 2 with no damage', streak.count, 2);
  const hit = panicStreakStep({ streak, topThreat, pickOverride: false, hpBefore: 10, hpAfter: 6, now: t0 + 3000 });
  T('a real hit (10->6 HP) resets the streak instead of ever reaching escalation', hit.nextStreak.count, 0);
  T('the reset streak still remembers the SAME threat id (not cleared to null)', hit.nextStreak.threatId, 42);
}

// ---- 5. panicStreakStep: a different threat id never inherits a stale count ----
{
  let streak = { threatId: 1, count: 5, lastAt: t0, lastHp: 10 };  // already past the threshold
  const r = panicStreakStep({ streak, topThreat: { id: 2 }, pickOverride: false, hpBefore: 10, hpAfter: 10, now: t0 + 1000 });
  T('a NEW threat id never escalates off a different threat\'s count', r.escalate, false);
  T('the streak reseeds at 0 for the new id', r.nextStreak, { threatId: 2, count: 0, lastAt: t0 + 1000, lastHp: 10 });
}

// ---- 6. panicStreakStep: pickOverride (drill()) never escalates, even mid-streak ----
{
  const streak = { threatId: 7, count: 10, lastAt: t0, lastHp: 5 };
  const r = panicStreakStep({ streak, topThreat: { id: 7 }, pickOverride: true, hpBefore: 5, hpAfter: 5, now: t0 + 1000 });
  T('an explicit drill()/pickOverride call never gets hijacked into WALK_OFF, no matter the streak',
    r.escalate, false);
}

// ---- 7. panicStreakStep: a stale streak (past PANIC_STREAK_EXPIRY_MS) never escalates or carries in ----
{
  const streak = { threatId: 7, count: 10, lastAt: t0, lastHp: 5 };
  const now = t0 + PANIC_STREAK_EXPIRY_MS + 1000;
  const r = panicStreakStep({ streak, topThreat: { id: 7 }, pickOverride: false, hpBefore: 5, hpAfter: 5, now });
  T('a streak older than PANIC_STREAK_EXPIRY_MS is treated as dead, not escalated on',
    r.escalate, false);
  T('a stale streak reseeds at 0 rather than carrying its old count forward (mineflayer entity-id reuse guard)',
    r.nextStreak.count, 0);
}

// ---- 8. panicStreakStep: danger fully cleared (no top threat) always resets to the null streak ----
{
  const streak = { threatId: 7, count: 10, lastAt: t0, lastHp: 5 };
  const r = panicStreakStep({ streak, topThreat: null, pickOverride: false, hpBefore: 5, hpAfter: 5, now: t0 + 1000 });
  T('no threat at all: streak fully clears, no escalation possible with nothing to walk off from',
    r.nextStreak, { threatId: null, count: 0, lastAt: 0, lastHp: null });
  T('and never escalates when there is no threat to walk off from', r.escalate, false);
}

out.passed = out.cases.filter((c) => c.PASS).length;
out.failed = out.cases.filter((c) => !c.PASS).map((c) => `${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)}`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length ? 1 : 0);
