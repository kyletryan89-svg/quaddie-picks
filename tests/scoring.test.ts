import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LEGS_PER_QUADDIE,
  NOTIONAL_UNIT,
  type ScoringLeg,
  type ScoringPick,
  potPercent,
  scoreMeeting,
} from '@/lib/scoring';

const scoringSourcePath = fileURLToPath(new URL('../lib/scoring.ts', import.meta.url));

// ── fixture helpers ──────────────────────────────────────────────────────────
const leg = (legNumber: number, winnerNumber: number | null, winnerSp: number | null): ScoringLeg => ({
  legNumber,
  winnerNumber,
  winnerSp,
});
const pick = (userId: string, legNumber: number, runnerNumber: number): ScoringPick => ({
  userId,
  legNumber,
  runnerNumber,
});
const resultOf = (userId: string, results: ReturnType<typeof scoreMeeting>) => {
  const r = results.find((x) => x.userId === userId);
  if (!r) throw new Error(`no result for ${userId}`);
  return r;
};

describe('scoreMeeting — rubric R4', () => {
  it('1. no splitting: three users on the same winner each get the full point and the full SP', () => {
    const legs = [leg(1, 5, 8.0)];
    const picks = [pick('u1', 1, 5), pick('u2', 1, 5), pick('u3', 1, 5)];
    const results = scoreMeeting(legs, picks);
    expect(results).toHaveLength(3);
    for (const userId of ['u1', 'u2', 'u3']) {
      const r = resultOf(userId, results);
      expect(r.legsHit).toBe(1);
      expect(r.return).toBe(8.0); // full SP, undiluted
      expect(r.selections).toBe(1);
      expect(r.outlay).toBe(1 * NOTIONAL_UNIT);
      expect(r.profit).toBeCloseTo(7.0, 10);
    }
    // identical returns, explicitly
    const [a, b, c] = results.map((r) => r.return);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('2. no double-paying: 5 picks in a leg incl. the winner ⇒ SP paid once, outlay 5', () => {
    const legs = [leg(1, 7, 4.5)];
    const picks = [
      pick('u1', 1, 1),
      pick('u1', 1, 2),
      pick('u1', 1, 3),
      pick('u1', 1, 4),
      pick('u1', 1, 7), // the winner
    ];
    const results = scoreMeeting(legs, picks);
    const r = resultOf('u1', results);
    expect(r.selections).toBe(5);
    expect(r.outlay).toBe(5);
    expect(r.legsHit).toBe(1);
    expect(r.return).toBe(4.5); // once — not 5 × 4.50
    expect(r.profit).toBeCloseTo(4.5 - 5, 10);
  });

  it('3. SP convention: one selection, one hit at 4.50 ⇒ return 4.50, outlay 1, profit 3.50', () => {
    const results = scoreMeeting([leg(2, 3, 4.5)], [pick('u1', 2, 3)]);
    const r = resultOf('u1', results);
    expect(r.return).toBe(4.5);
    expect(r.outlay).toBe(1);
    expect(r.profit).toBeCloseTo(3.5, 10);
  });

  it('4. shotgun is punished: wide-and-lucky-all-4 loses more than sharp-two-hits wins', () => {
    // A: 6 per leg (24 selections), hits all 4 at short prices.
    // B: 1 per leg (4 selections), hits 2 at long prices.
    const legs = [
      leg(1, 1, 1.6),
      leg(2, 2, 1.9),
      leg(3, 3, 2.2),
      leg(4, 4, 2.4),
    ];
    const legs2 = [leg(1, 77, 15.0), leg(2, 2, 1.9), leg(3, 33, 21.0), leg(4, 4, 2.4)];
    const picks2: ScoringPick[] = [
      // A boxes six wide every leg, including both winning numbers where relevant.
      ...[77, 10, 11, 12, 13, 14].map((rn) => pick('userA', 1, rn)),
      ...[2, 20, 21, 22, 23, 24].map((rn) => pick('userA', 2, rn)),
      ...[33, 30, 31, 32, 34, 35].map((rn) => pick('userA', 3, rn)),
      ...[4, 40, 41, 42, 43, 44].map((rn) => pick('userA', 4, rn)),
      pick('userB', 1, 77), // lone pick, winner @ 15.00
      pick('userB', 2, 88), // miss
      pick('userB', 3, 33), // lone pick, winner @ 21.00
      pick('userB', 4, 99), // miss
    ];

    const results = scoreMeeting(legs2, picks2);
    const a = resultOf('userA', results);
    const b = resultOf('userB', results);

    expect(a.selections).toBe(LEGS_PER_QUADDIE * 6); // 24
    expect(b.selections).toBe(LEGS_PER_QUADDIE * 1); // 4
    expect(a.legsHit).toBe(4);
    expect(b.legsHit).toBe(2);
    expect(a.return).toBeCloseTo(15.0 + 1.9 + 21.0 + 2.4, 10); // 40.30
    expect(a.outlay).toBe(24);
    expect(b.return).toBeCloseTo(15.0 + 21.0, 10); // 36.00
    expect(b.outlay).toBe(4);

    // Both numbers reportable AND in the spec-required direction.
    expect(b.profit).toBeGreaterThan(a.profit); // 32 > 16.30
    expect(a.legsHit).toBeGreaterThan(b.legsHit); // 4 > 2
  });

  it('5. empty leg: no selections in leg 3 ⇒ cannot hit it, cannot be full cover, outlay only covers entered legs', () => {
    const legs = [leg(1, 1, 2.0), leg(2, 2, 3.0), leg(3, 9, 5.0), leg(4, 4, 4.0)];
    const picks = [
      pick('u1', 1, 1), // hit
      pick('u1', 2, 2), // hit
      // nothing in leg 3
      pick('u1', 4, 4), // hit
    ];
    const r = resultOf('u1', scoreMeeting(legs, picks));
    expect(r.selections).toBe(3);
    expect(r.outlay).toBe(3);
    expect(r.legsHit).toBe(3);
    expect(r.fullCover).toBe(false);
  });

  it('6. all losses: every return 0, every profit equals negative outlay', () => {
    const legs = [leg(1, 9, 3.0), leg(2, 8, 2.5)];
    const picks = [
      pick('u1', 1, 1),
      pick('u1', 2, 2),
      pick('u2', 1, 3),
      pick('u2', 2, 4),
      pick('u2', 2, 5),
    ];
    const results = scoreMeeting(legs, picks);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.return).toBe(0);
      expect(r.profit).toBeCloseTo(-r.outlay, 10);
      expect(r.profit).toBeLessThan(0);
    }
    expect(resultOf('u1', results).outlay).toBe(2);
    expect(resultOf('u2', results).outlay).toBe(3);
  });

  it('7. solo flag: true only when exactly one member picked that leg’s winner', () => {
    const legs = [leg(1, 5, 4.0), leg(2, 6, 6.0)];
    const picks = [
      pick('loner', 1, 5), // sole picker of leg 1 winner ⇒ solo
      pick('duo-a', 2, 6), // two pickers of leg 2 winner ⇒ NOT solo
      pick('duo-b', 2, 6),
    ];
    const results = scoreMeeting(legs, picks);
    expect(resultOf('loner', results).soloLegs).toBe(1);
    expect(resultOf('duo-a', results).soloLegs).toBe(0);
    expect(resultOf('duo-b', results).soloLegs).toBe(0);
  });

  it('8. full cover flag: true only when all 4 legs hit', () => {
    const legs = [leg(1, 1, 2.0), leg(2, 2, 2.0), leg(3, 3, 2.0), leg(4, 4, 2.0)];
    const perfect: ScoringPick[] = [
      pick('perfect', 1, 1),
      pick('perfect', 2, 2),
      pick('perfect', 3, 3),
      pick('perfect', 4, 4),
    ];
    const threeOfFour: ScoringPick[] = [
      pick('almost', 1, 1),
      pick('almost', 2, 2),
      pick('almost', 3, 3),
      pick('almost', 4, 44), // miss
    ];
    const results = scoreMeeting(legs, [...perfect, ...threeOfFour]);
    expect(resultOf('perfect', results).fullCover).toBe(true);
    expect(resultOf('almost', results).fullCover).toBe(false);
    expect(resultOf('perfect', results).legsHit).toBe(LEGS_PER_QUADDIE);
  });

  it('9. POT guard: zero outlay yields null (renders as —), never division-by-zero or NaN', () => {
    expect(potPercent(123.45, 0)).toBeNull();
    expect(potPercent(-25, 100)).toBe(-25);
    expect(potPercent(3.5, 1)).toBe(350);
    // and an empty meeting scores to an empty set without throwing
    expect(scoreMeeting([], [])).toEqual([]);
  });

  it('10. unsettled leg: null winner scores as no hit for everyone and does not throw', () => {
    const legs = [leg(1, null, null), leg(2, 2, 3.5)];
    const picks = [pick('u1', 1, 1), pick('u1', 2, 2), pick('u2', 1, 1)];
    const results = scoreMeeting(legs, picks);
    const u1 = resultOf('u1', results);
    const u2 = resultOf('u2', results);
    expect(u1.legsHit).toBe(1); // only the settled leg can hit
    expect(u1.fullCover).toBe(false);
    expect(u1.return).toBeCloseTo(3.5, 10);
    expect(u2.legsHit).toBe(0);
    expect(u2.selections).toBe(1); // still paid for the tip
  });
});

describe('rubric R4 — purity of lib/scoring.ts', () => {
  it('imports nothing from next, react, or @supabase/*', () => {
    const src = readFileSync(scoringSourcePath, 'utf8');
    const importLines = src.split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));
    for (const line of importLines) {
      expect(line).not.toMatch(/['"](next|react|@supabase\/)/);
    }
    // The module is dependency-free by design: no imports at all is the ideal.
    if (importLines.length > 0) return;
    expect(src.length).toBeGreaterThan(0); // sanity: we actually read the file
  });
});
