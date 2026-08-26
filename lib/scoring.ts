// lib/scoring.ts — the single source of truth for quaddie scoring (SPEC §2).
//
// PURE by mandate (rubric R4): no imports from `next`, `react`, or `@supabase/*`,
// no database access, no I/O. Everything derives from the arguments alone.
//
// Conventions fixed by spec — do not "fix" these, they are deliberate:
//  * winner_sp is TOTAL RETURN per $1 staked (incl. stake). Never subtract 1
//    anywhere except implicitly via profit = return − outlay.
//  * A leg hit pays winner_sp ONCE per user regardless of how many runners they
//    picked in the leg and regardless of how many other members also picked it.
//  * Every selection costs exactly one NOTIONAL_UNIT of outlay. Shotgunning is
//    braked only by outlay, never by credit dilution.

export const LEGS_PER_QUADDIE = 4;
export const NOTIONAL_UNIT = 1.0;

/** One race leg of the quaddie. Unsettled ⇒ winnerNumber/winnerSp are null. */
export interface ScoringLeg {
  legNumber: number;
  winnerNumber: number | null;
  /** Total return per $1 staked. Null until settled. */
  winnerSp: number | null;
}

/** One runner picked by one member in one leg. */
export interface ScoringPick {
  userId: string;
  legNumber: number;
  runnerNumber: number;
}

export interface UserResult {
  userId: string;
  /** Every runner picked across all legs. Each costs one NOTIONAL_UNIT. */
  selections: number;
  /** selections × NOTIONAL_UNIT */
  outlay: number;
  /** Distinct legs (of 4) where one of this user's runners won. Max 4. */
  legsHit: number;
  /** Sum of winner_sp, once per leg hit. */
  return: number;
  /** return − outlay. Usually negative. That is horse racing. */
  profit: number;
  /** Legs where this user was the ONLY member to pick the winner. Display only. */
  soloLegs: number;
  /** True iff all LEGS_PER_QUADDIE legs were hit. Display only. */
  fullCover: boolean;
}

/**
 * POT % = profit / outlay × 100. Returns null when outlay is 0 — callers render
 * null as “—”. Kept here so the zero-outlay guard has exactly one home.
 */
export function potPercent(profit: number, outlay: number): number | null {
  if (outlay === 0) return null;
  return (profit / outlay) * 100;
}

/**
 * Score one settled-or-partially-settled meeting for every member who made at
 * least one pick. Never throws on missing/unsettled data: an unsettled leg
 * scores as no hit for everyone.
 *
 * Results are ordered profit descending, then legs hit descending, then userId,
 * so output is deterministic for tests and screens alike.
 */
export function scoreMeeting(legs: ScoringLeg[], picks: ScoringPick[]): UserResult[] {
  // Leg → winning runner + SP, but only for legs settled enough to score
  // (both winner and SP present).
  const winnerByLeg = new Map<number, { runnerNumber: number; sp: number }>();
  for (const leg of legs) {
    if (leg.winnerNumber !== null && leg.winnerSp !== null) {
      winnerByLeg.set(leg.legNumber, { runnerNumber: leg.winnerNumber, sp: leg.winnerSp });
    }
  }

  // Who hit each leg — needed globally so "solo" means solo across all members,
  // not merely solo within one user's own slip.
  const hittersByLeg = new Map<number, string[]>();
  for (const pick of picks) {
    const winner = winnerByLeg.get(pick.legNumber);
    if (winner !== undefined && pick.runnerNumber === winner.runnerNumber) {
      const hitters = hittersByLeg.get(pick.legNumber);
      if (hitters === undefined) {
        hittersByLeg.set(pick.legNumber, [pick.userId]);
      } else {
        hitters.push(pick.userId);
      }
    }
  }

  // user → leg → distinct runner numbers picked. The Set makes duplicate input
  // rows idempotent: picking the same runner twice cannot pay twice.
  const runnersByUserLeg = new Map<string, Map<number, Set<number>>>();
  for (const pick of picks) {
    let byLeg = runnersByUserLeg.get(pick.userId);
    if (byLeg === undefined) {
      byLeg = new Map();
      runnersByUserLeg.set(pick.userId, byLeg);
    }
    let runners = byLeg.get(pick.legNumber);
    if (runners === undefined) {
      runners = new Set();
      byLeg.set(pick.legNumber, runners);
    }
    runners.add(pick.runnerNumber);
  }

  const results: UserResult[] = [];
  for (const [userId, byLeg] of runnersByUserLeg) {
    let selections = 0;
    let legsHit = 0;
    let totalReturn = 0;
    let soloLegs = 0;

    for (const [legNumber, runners] of byLeg) {
      selections += runners.size;
      const winner = winnerByLeg.get(legNumber);
      if (winner !== undefined && runners.has(winner.runnerNumber)) {
        legsHit += 1;
        totalReturn += winner.sp;
        const hitters = hittersByLeg.get(legNumber);
        if (hitters !== undefined && hitters.length === 1) {
          soloLegs += 1;
        }
      }
    }

    const outlay = selections * NOTIONAL_UNIT;
    results.push({
      userId,
      selections,
      outlay,
      legsHit,
      return: totalReturn,
      profit: totalReturn - outlay,
      soloLegs,
      fullCover: legsHit === LEGS_PER_QUADDIE,
    });
  }

  results.sort((a, b) =>
    b.profit - a.profit ||
    b.legsHit - a.legsHit ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return results;
}
