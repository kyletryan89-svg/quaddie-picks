// Season leaderboard aggregation — PURE (like lib/scoring.ts, which it wraps).
// No DB or React here: pages feed in per-meeting scoring inputs, this module
// produces the exact rows SPEC §2 demands.

import { LEGS_PER_QUADDIE, potPercent, scoreMeeting, type ScoringLeg, type ScoringPick } from '@/lib/scoring';

export type LeaderboardSort = 'profit' | 'legs';

/** One settled meeting, ready to score. */
export interface ScoredMeeting {
  legs: ScoringLeg[];
  picks: ScoringPick[];
}

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  /** settled meetings where the member made at least one selection */
  meetings: number;
  selections: number;
  outlay: number;
  legsHit: number;
  returnTotal: number;
  profit: number;
  soloLegs: number;
  fullCovers: number;
  /** legsHit / (4 × meetings) × 100 — null when meetings is 0 */
  legsHitPct: number | null;
  /** null when outlay is 0 → renders as “—” */
  pot: number | null;
}

/**
 * Aggregate every settled meeting in a season into one row per member.
 * `roster` supplies the whole group so zero-pick members still appear
 * (with `—` POT), not just whoever happened to have a pick.
 */
export function buildLeaderboard(
  scoredMeetings: readonly ScoredMeeting[],
  roster: ReadonlyArray<{ id: string; displayName: string }>,
): LeaderboardRow[] {
  const acc = new Map<string, LeaderboardRow>();

  const ensureRow = (userId: string): LeaderboardRow => {
    let row = acc.get(userId);
    if (row === undefined) {
      row = {
        userId,
        displayName: '',
        meetings: 0,
        selections: 0,
        outlay: 0,
        legsHit: 0,
        returnTotal: 0,
        profit: 0,
        soloLegs: 0,
        fullCovers: 0,
        legsHitPct: null,
        pot: null,
      };
      acc.set(userId, row);
    }
    return row;
  };

  for (const member of roster) {
    ensureRow(member.id).displayName = member.displayName;
  }

  for (const meeting of scoredMeetings) {
    for (const result of scoreMeeting(meeting.legs, meeting.picks)) {
      const row = ensureRow(result.userId);
      if (result.selections > 0) {
        row.meetings += 1;
      }
      row.selections += result.selections;
      row.outlay += result.outlay;
      row.legsHit += result.legsHit;
      row.returnTotal += result.return;
      row.profit += result.profit;
      row.soloLegs += result.soloLegs;
      row.fullCovers += result.fullCover ? 1 : 0;
    }
  }

  const rows = [...acc.values()];
  for (const row of rows) {
    // Fill any display name we never saw (profile deleted mid-season etc).
    if (row.displayName === '') row.displayName = 'Unknown';
    row.legsHitPct =
      row.meetings === 0 ? null : (row.legsHit / (LEGS_PER_QUADDIE * row.meetings)) * 100;
    row.pot = potPercent(row.profit, row.outlay);
  }
  return sortLeaderboard(rows, 'profit');
}

export function sortLeaderboard(rows: LeaderboardRow[], mode: LeaderboardSort): LeaderboardRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (mode === 'legs') {
      if (b.legsHit !== a.legsHit) return b.legsHit - a.legsHit;
    }
    if (b.profit !== a.profit) return b.profit - a.profit;
    if (b.legsHit !== a.legsHit) return b.legsHit - a.legsHit;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted;
}
