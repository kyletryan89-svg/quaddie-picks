import { describe, expect, it } from 'vitest';
import { formatBetSlip, type SlipLeg, type SlipPick, type SlipRunner } from '@/lib/bet-slip';

const legs: SlipLeg[] = [
  { id: 'l1', legNumber: 1, raceNumber: 7 },
  { id: 'l2', legNumber: 2, raceNumber: 8 },
  { id: 'l3', legNumber: 3, raceNumber: 9 },
  { id: 'l4', legNumber: 4, raceNumber: 10 },
];

function runner(id: string, legId: string, number: number, scratched = false): SlipRunner {
  return { id, legId, number, scratched };
}

function pick(runnerId: string, rank: number | null = null): SlipPick {
  return { runnerId, rank };
}

describe('formatBetSlip', () => {
  it('writes one line per race with the group’s saddlecloth numbers', () => {
    const text = formatBetSlip(
      legs,
      [
        runner('a', 'l1', 12),
        runner('b', 'l1', 6),
        runner('c', 'l1', 8),
        runner('d', 'l2', 9),
        runner('e', 'l2', 2),
      ],
      [pick('a'), pick('b'), pick('c'), pick('b'), pick('d'), pick('e')],
    );

    expect(text).toBe(['R7- 6,8,12', 'R8- 2,9', 'R9- none', 'R10- none'].join('\n'));
  });

  it('orders a leg by best rank, then saddlecloth number', () => {
    const text = formatBetSlip(
      [legs[0]!],
      [runner('a', 'l1', 6), runner('b', 'l1', 8), runner('c', 'l1', 12), runner('d', 'l1', 4)],
      [pick('a', null), pick('b', 1), pick('c', 2), pick('d', 2), pick('b', 3)],
    );

    expect(text).toBe('R7- 8,4,12,6');
  });

  it('leaves scratched runners off the slip', () => {
    const text = formatBetSlip(
      [legs[0]!],
      [runner('a', 'l1', 6), runner('b', 'l1', 8, true), runner('c', 'l1', 12)],
      [pick('a'), pick('b', 1), pick('c')],
    );

    expect(text).toBe('R7- 6,12');
  });

  it('uses the leg number when the race number is missing', () => {
    const text = formatBetSlip([{ id: 'l1', legNumber: 1, raceNumber: null }], [], []);
    expect(text).toBe('R1- none');
  });
});
