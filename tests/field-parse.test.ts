import { describe, expect, it } from 'vitest';
import { parseField } from '../lib/field-parse';

describe('parseField — the accepted shapes', () => {
  it('reads "7. Horse Name"', () => {
    expect(parseField('7. Winx The Second').runners).toEqual([{ number: 7, name: 'Winx The Second' }]);
  });

  it('reads "7 Horse Name" without the dot', () => {
    expect(parseField('7 Winx The Second').runners).toEqual([{ number: 7, name: 'Winx The Second' }]);
  });

  it('discards a trailing barrier in brackets', () => {
    expect(parseField('7. Winx The Second (5)').runners).toEqual([{ number: 7, name: 'Winx The Second' }]);
  });

  it('discards a trailing jockey after a barrier', () => {
    expect(parseField('7. Winx The Second (5) J. Smith').runners).toEqual([{ number: 7, name: 'Winx The Second' }]);
  });

  it('discards a trailing jockey whose initial has no dot', () => {
    expect(parseField('7. Winx The Second (5) J Smith').runners).toEqual([{ number: 7, name: 'Winx The Second' }]);
  });

  it('discards a multi-initial and Mc-prefixed jockey', () => {
    expect(parseField('4. Late Scratching Replacement (2) J. B. McDonald').runners).toEqual([
      { number: 4, name: 'Late Scratching Replacement' },
    ]);
  });

  it('keeps brackets that are part of the name, not a trailing barrier', () => {
    expect(parseField('3. Bob (NZ) Junior').runners).toEqual([{ number: 3, name: 'Bob (NZ) Junior' }]);
  });

  it('keeps a name with an internal single-letter word that is not a jockey', () => {
    // "The Second" is not "initial + surname", so the whole name survives.
    expect(parseField('7. Winx The Second').runners).toEqual([{ number: 7, name: 'Winx The Second' }]);
  });
});

describe('parseField — a whole pasted field', () => {
  const paste = `
1. Alpha Male (4) J. McDonald
2 Beta Blocker (7)
3. Gamma Ray (11) Z Purton
10. Delta Force
  `;

  it('reads every runner and no others', () => {
    expect(parseField(paste).runners).toEqual([
      { number: 1, name: 'Alpha Male' },
      { number: 2, name: 'Beta Blocker' },
      { number: 3, name: 'Gamma Ray' },
      { number: 10, name: 'Delta Force' },
    ]);
  });

  it('skips nothing when every line is readable', () => {
    expect(parseField(paste).skipped).toEqual([]);
  });

  it('ignores blank lines rather than counting them as skipped', () => {
    expect(parseField('\n\n1. Alpha\n\n\n2. Beta\n\n').skipped).toEqual([]);
  });
});

describe('parseField — leniency', () => {
  it('skips unparseable lines but keeps the good ones', () => {
    const result = parseField('1. Alpha\nRace 4 — 1200m Good 3\n2. Beta\nScratchings: 9');
    expect(result.runners).toEqual([
      { number: 1, name: 'Alpha' },
      { number: 2, name: 'Beta' },
    ]);
    expect(result.skipped).toEqual(['Race 4 — 1200m Good 3', 'Scratchings: 9']);
  });

  it('skips a bare number with no name', () => {
    const result = parseField('7\n8. Real Horse');
    expect(result.runners).toEqual([{ number: 8, name: 'Real Horse' }]);
    expect(result.skipped).toEqual(['7']);
  });

  it('skips a line whose name is only a barrier', () => {
    expect(parseField('7. (5)').runners).toEqual([]);
  });

  it('rejects runner numbers outside the field bound', () => {
    const result = parseField('0. Nobody\n100. Nobody Else\n5. Somebody');
    expect(result.runners).toEqual([{ number: 5, name: 'Somebody' }]);
    expect(result.skipped).toEqual(['0. Nobody', '100. Nobody Else']);
  });

  it('keeps the first of a duplicated runner number and skips the rest', () => {
    const result = parseField('4. First Claim\n4. Second Claim');
    expect(result.runners).toEqual([{ number: 4, name: 'First Claim' }]);
    expect(result.skipped).toEqual(['4. Second Claim']);
  });

  it('returns nothing at all for text that is not a field', () => {
    expect(parseField('the quick brown fox\njumped over')).toEqual({
      runners: [],
      skipped: ['the quick brown fox', 'jumped over'],
    });
  });

  it('sorts by runner number regardless of paste order', () => {
    expect(parseField('10. Ten\n2. Two\n7. Seven').runners.map((r) => r.number)).toEqual([2, 7, 10]);
  });

  it('accepts other separators people paste', () => {
    expect(parseField('1) One\n2: Two\n3 - Three').runners).toEqual([
      { number: 1, name: 'One' },
      { number: 2, name: 'Two' },
      { number: 3, name: 'Three' },
    ]);
  });
});
