import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { featureRaces } from '@/lib/feature-race';
import { formatExotic, isMissingExoticsTable, parseExotic } from '@/lib/exotics';
import { syncWindowISO } from '@/lib/racing/dates';
import { mapMeetings } from '@/lib/racing/providers/ladbrokes';
import { isMetroTrack } from '@/lib/racing/tracks';

function flemingtonCard() {
  const url = new URL('../docs/samples/flemington_20261103.json', import.meta.url);
  const meetings = mapMeetings(JSON.parse(readFileSync(url, 'utf8')) as unknown);
  const flemington = meetings.find((m) => m.track === 'Flemington');
  if (flemington === undefined) throw new Error('fixture missing Flemington');
  return flemington;
}

describe('Flemington 3 Nov 2026 card (saved Ladbrokes response)', () => {
  it('is a VIC metro meeting whose quaddie is races 7–10, with the Cup as race 7', () => {
    const meeting = flemingtonCard();
    expect(meeting.state).toBe('VIC');
    expect(meeting.date).toBe('2026-11-03');
    expect(isMetroTrack(meeting.track, meeting.state)).toBe(true);
    const races = [...meeting.races].sort((a, b) => a.number - b.number);
    expect(races.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const quaddie = races.slice(-4);
    expect(quaddie.map((r) => r.number)).toEqual([7, 8, 9, 10]);
    expect(races.find((r) => r.number === 7)?.name).toBe('Lexus Melbourne Cup (G1)');
    expect(featureRaces(quaddie.map((r) => ({ race_number: r.number, race_name: r.name })))).toEqual([
      { raceNumber: 7, label: 'Lexus Melbourne Cup (G1)' },
    ]);
  });
});

describe('sync window', () => {
  it('includes Tuesday 3 Nov when today is Monday 2 Nov in Sydney', () => {
    // 2026-11-01T21:00:00Z is 08:00 on Monday 2 Nov in Sydney (AEDT).
    const window = syncWindowISO(new Date('2026-11-01T21:00:00Z'));
    expect(window.from).toBe('2026-11-02');
    expect(window.to).toBe('2026-11-07');
    expect(window.from <= '2026-11-03' && '2026-11-03' <= window.to).toBe(true);
  });
});

describe('exotic picks', () => {
  it('accepts an ordered trifecta and rejects duplicates', () => {
    expect(parseExotic(['4', '8', '1'], 3, 'Trifecta')).toEqual({ ok: true, numbers: [4, 8, 1] });
    expect(parseExotic(['4', '4', '1'], 3, 'Trifecta').ok).toBe(false);
    expect(parseExotic(['', '', ''], 3, 'Trifecta')).toEqual({ ok: true, numbers: [] });
    expect(formatExotic([4, 8, 1, 12])).toBe('4-8-1-12');
    expect(formatExotic([])).toBe('—');
  });

  it('recognises a missing exotic_picks table', () => {
    expect(isMissingExoticsTable({ code: 'PGRST205', message: "Could not find the table 'public.exotic_picks' in the schema cache" })).toBe(true);
    expect(isMissingExoticsTable({ code: '23505', message: 'duplicate key' })).toBe(false);
  });
});
