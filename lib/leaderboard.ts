// Season leaderboard aggregation — PURE (like lib/scoring.ts, which it wraps).
// No DB or React here: pages feed in per-meeting scoring inputs, this module
// produces the exact rows the ladder demands.
//
// Since the "no deducting" change the ladder pays gross winnings only: a member's
// line is just how many legs they hit and what those legs returned. There is no
// outlay, no cost, no profit — picking a leg wrong subtracts nothing.

import { scoreMeetingRanked, type ScoringLeg, type ScoringPick } from '@/lib/scoring';

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
  /** Legs hit across the settled meetings in scope. */
  winners: number;
  /** Total return (SP money won) across those legs. */
  return: number;
}

/**
 * Aggregate every settled meeting in scope into one row per canonical member.
 * Picks are resolved through `roster` (id → member name) first, so duplicate
 * accounts fold into a single row and stray picks from non-members vanish.
 * Only a member's first pick pays (D25); winnings are gross — no outlay.
 */
export function buildLeaderboard(
  scoredMeetings: readonly ScoredMeeting[],
  roster: ReadonlyMap<string, string>,
): LeaderboardRow[] {
  const acc = new Map<string, LeaderboardRow>();
  for (const member of CANONICAL_MEMBERS) acc.set(member, { member, winners: 0, return: 0 });

  const memberSet = new Set<string>(CANONICAL_MEMBERS);
  const resolve = (picks: readonly ScoringPick[]): ScoringPick[] =>
    picks.flatMap((p) => {
      const member = roster.get(p.userId);
      return member === undefined ? [] : [{ ...p, userId: member }];
    });

  for (const meeting of scoredMeetings) {
    for (const result of scoreMeetingRanked(meeting.legs, resolve(meeting.picks), memberSet)) {
      const row = acc.get(result.userId);
      if (row === undefined) continue;
      row.winners += result.legsHit;
      row.return += result.return;
    }
  }

  return sortLeaderboard([...acc.values()]);
}

/** Rank by total return, then legs hit, then name. */
export function sortLeaderboard(rows: LeaderboardRow[]): LeaderboardRow[] {
  const sorted = [...rows];
  sorted.sort(
    (a, b) =>
      b.return - a.return ||
      b.winners - a.winners ||
      a.member.localeCompare(b.member),
  );
  return sorted;
}
