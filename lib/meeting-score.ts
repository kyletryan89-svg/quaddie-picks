// Bridges database rows to the pure scoring inputs. Type-only imports, so this
// adds no runtime dependency and lib/scoring.ts stays import-free (rubric R4).
//
// Since M8 a pick points at a runner rather than carrying a number, so turning a
// meeting into scoring input means resolving each pick through its runner.

import type { ScoringLeg, ScoringPick } from '@/lib/scoring';
import type { Leg, Pick, Runner } from '@/lib/types';

export function toScoringLegs(legs: readonly Leg[]): ScoringLeg[] {
  return legs.map((l) => ({
    legNumber: l.leg_number,
    winnerNumber: l.winner_number,
    winnerSp: l.winner_sp === null ? null : Number(l.winner_sp),
  }));
}

/**
 * Picks become (user, leg number, runner number) triples. A pick whose runner
 * is missing — the field was re-pasted without it, and the cascade has not been
 * read back yet — is dropped rather than scored as runner 0.
 */
export function toScoringPicks(
  legs: readonly Leg[],
  runners: readonly Runner[],
  picks: readonly Pick[],
): ScoringPick[] {
  const legNumberById = new Map<string, number>(legs.map((l) => [l.id, l.leg_number]));
  const runnerById = new Map<string, Runner>(runners.map((r) => [r.id, r]));

  const out: ScoringPick[] = [];
  for (const pick of picks) {
    const runner = runnerById.get(pick.runner_id);
    const legNumber = legNumberById.get(pick.leg_id);
    if (runner === undefined || legNumber === undefined) continue;
    out.push({ userId: pick.user_id, legNumber, runnerNumber: runner.runner_number });
  }
  return out;
}
