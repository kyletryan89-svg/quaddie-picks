// Season leaderboard aggregation — PURE (like lib/scoring.ts, which it wraps).
// No DB or React here: pages feed in per-meeting scoring inputs, this module
// produces the exact rows SPEC §2 demands.

import { LEGS_PER_QUADDIE, potPercent, scoreMeetingRanked, type ScoringLeg, type ScoringPick } from '@/lib/scoring';

export type LeaderboardSort = 'profit' | 'legs';

/** The group. Anything else in `profiles` is noise and never reaches the ladder. */
export const CANONICAL_MEMBERS = ['Kyle', 'Leigh', 'Steve', 'Pete', 'Chris'] as const;

/**
 * Nicknames members signed up with. Fold them onto their real name so a member
 * whose profile says "lethal" still lands on the ladder as Leigh.
 */
const NAME_ALIASES: Record<string, string> = { lethal: 'Leigh' };

/** Resolve a raw profile display name to a canonical member name, or null. */
export function canonicalNameOf(displayName: string): string | null {
  const key = displayName.trim().toLowerCase();
  if (key === '') return null;
  const alias = NAME_ALIASES[key];
  if (alias !== undefined) return alias;
  return CANONICAL_MEMBERS.find((n) => n.toLowerCase() === key) ?? null;
}

/**
 * Map every profile id to its canonical member name. Duplicate accounts (a
 * member signed in twice) all resolve to the same name; non-members (test
 * accounts) are dropped. Keyed by id so a pick can always find its member.
 */
export function canonicalRoster(
  profiles: ReadonlyArray<{ id: string; display_name: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of profiles) {
    const name = canonicalNameOf(p.display_name);
    if (name !== null) out.set(p.id, name);
  }
  return out;
}

/** One settled meeting, ready to score. */
export interface ScoredMeeting {
  legs: ScoringLeg[];
  picks: ScoringPick[];
}

export interface LeaderboardRow {
  /** Canonical member name (Kyle, Leigh, …). */
  member: string;
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
 * Aggregate every settled meeting in a season into one row per canonical member.
 * Picks are resolved through `roster` (id → member name) first, so duplicate
 * accounts fold into a single row and stray picks from non-members vanish —
 * nobody ever renders as "Unknown".
 */
export function buildLeaderboard(
  scoredMeetings: readonly ScoredMeeting[],
  roster: ReadonlyMap<string, string>,
): LeaderboardRow[] {
  const members = [...CANONICAL_MEMBERS];
  const acc = new Map<string, LeaderboardRow>();

  const ensureRow = (member: string): LeaderboardRow => {
    let row = acc.get(member);
    if (row === undefined) {
      row = {
        member,
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
      acc.set(member, row);
    }
    return row;
  };

  // Every member appears even before they pick (zero across the board).
  for (const member of members) ensureRow(member);

  const memberSet = new Set<string>(members);
  const resolve = (picks: readonly ScoringPick[]): ScoringPick[] =>
    picks.flatMap((p) => {
      const member = roster.get(p.userId);
      return member === undefined ? [] : [{ ...p, userId: member }];
    });

  for (const meeting of scoredMeetings) {
    for (const result of scoreMeetingRanked(meeting.legs, resolve(meeting.picks), memberSet)) {
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
    return a.member.localeCompare(b.member);
  });
  return sorted;
}
