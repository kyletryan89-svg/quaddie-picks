// Plain-text quaddie slip for the meeting screen. One line per leg, real race
// numbers, the group's saddlecloth numbers. Scratched runners are left off so
// the copied block can go straight onto a bet slip.

export interface SlipLeg {
  id: string;
  legNumber: number;
  raceNumber: number | null;
}

export interface SlipRunner {
  id: string;
  legId: string;
  number: number;
  scratched: boolean;
}

export interface SlipPick {
  runnerId: string;
  rank: number | null;
}

const EMPTY_LEG = 'none';

/** Best (lowest) rank wins. A null rank never beats a real one. */
function betterRank(current: number | null, next: number | null): number | null {
  if (current === null) return next;
  if (next === null) return current;
  return Math.min(current, next);
}

function compareRunners(a: { number: number; rank: number | null }, b: { number: number; rank: number | null }): number {
  if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank !== null && b.rank === null) return -1;
  if (a.rank === null && b.rank !== null) return 1;
  return a.number - b.number;
}

/**
 * `R7- 6,8,12` per leg, legs in card order. Ranked runners lead (1st, then 2nd,
 * then 3rd); everything else is by saddlecloth number. A leg nobody has a live
 * pick in reads `R9- none`.
 */
export function formatBetSlip(legs: readonly SlipLeg[], runners: readonly SlipRunner[], picks: readonly SlipPick[]): string {
  const runnerById = new Map(runners.map((r) => [r.id, r]));

  return [...legs]
    .sort((a, b) => a.legNumber - b.legNumber)
    .map((leg) => {
      const chosen = new Map<number, { number: number; rank: number | null }>();
      for (const pick of picks) {
        const runner = runnerById.get(pick.runnerId);
        if (runner === undefined || runner.legId !== leg.id || runner.scratched) continue;
        const existing = chosen.get(runner.number);
        chosen.set(runner.number, {
          number: runner.number,
          rank: betterRank(existing?.rank ?? null, pick.rank),
        });
      }
      const numbers = [...chosen.values()].sort(compareRunners).map((r) => r.number);
      const body = numbers.length === 0 ? EMPTY_LEG : numbers.join(',');
      return `R${leg.raceNumber ?? leg.legNumber}- ${body}`;
    })
    .join('\n');
}
