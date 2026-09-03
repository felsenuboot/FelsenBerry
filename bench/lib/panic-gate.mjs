// bench/lib/panic-gate.mjs — pure port of survival.js's #121/5r panic-loop-prevention logic
// (actionableThreats() gating + g.panicStreak's no-progress escalation), for hermetic testing.
//
// survival.js is an injected CommonJS payload (process.mainModule.require via POST /eval), not
// an importable ES module, so this is a deliberately-hand-synced PORT rather than a shared
// import -- keep ACTIONABLE_MAX_D, the los/d predicate, PANIC_STREAK_ESCALATE_AT,
// PANIC_STREAK_EXPIRY_MS, and the streak update/escalate rules below byte-identical to
// survival.js's own actionableThreats()/g.panicStreak block whenever either changes. This
// fixture is also the reason this file exists at all: building it caught a REAL gap in the
// first pass of #121/5r (2026-09-03) -- `g.panicStreak` and `branchWalkOff` had been added to
// survival.js and committed as "done", but the actual escalation CHECK inside enter() was never
// wired up (no code ever read g.panicStreak.count or called branchWalkOff), so fix 2 of the
// lead's two explicit asks was pure scaffolding that could never fire. Caught on a second read
// of the committed diff, not by this fixture (which didn't exist yet) -- but it's exactly the
// kind of gap a hermetic test of the pure decision logic exists to catch mechanically instead
// of by chance next time.

export const ACTIONABLE_MAX_D = 12;
export const PANIC_STREAK_ESCALATE_AT = 3;
export const PANIC_STREAK_EXPIRY_MS = 5 * 60 * 1000;

// threats: dangerscan's own threats[] shape, [{id, d, los, name, ...}, ...]
export const actionableThreats = (threats) => threats.filter((x) => x.los === true || x.d <= ACTIONABLE_MAX_D);

// Mirrors enter()'s own inline block exactly: given the CURRENT streak, the raw top threat
// (dangerscan's threats[0], unfiltered -- NOT actionableThreats()[0], matching survival.js's
// own choice to track the same threat id regardless of gate 1's actionability verdict), whether
// this is an explicit drill()/pickOverride call, and hp before/after this cycle, returns
// { escalate, nextStreak } -- escalate is true iff this cycle's CHECK (evaluated against the
// INCOMING streak, before this cycle's own outcome updates it) should run branchWalkOff instead
// of the normal branch dispatch.
export const panicStreakStep = ({ streak, topThreat, pickOverride, hpBefore, hpAfter, now }) => {
  const streakLive = Boolean(topThreat) && streak.threatId === topThreat.id
    && now - streak.lastAt < PANIC_STREAK_EXPIRY_MS;
  const escalate = !pickOverride && streakLive && streak.count >= PANIC_STREAK_ESCALATE_AT;
  let nextStreak;
  if (!topThreat) {
    nextStreak = { threatId: null, count: 0, lastAt: 0, lastHp: null };
  } else {
    const damaged = hpAfter < hpBefore - 0.01;
    if (!damaged && streakLive) {
      nextStreak = { threatId: streak.threatId, count: streak.count + 1, lastAt: now, lastHp: hpAfter };
    } else {
      nextStreak = { threatId: topThreat.id, count: 0, lastAt: now, lastHp: hpAfter };
    }
  }
  return { escalate, nextStreak };
};
