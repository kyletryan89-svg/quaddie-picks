import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapEvent, mapMeetings } from '@/lib/racing/providers/ladbrokes';

// Fixtures are the raw responses saved during the M0 spike (docs/samples/).
// Tests never touch the live network — they exercise the pure mappers only.

function fixture(name: string): unknown {
  const url = new URL(`../docs/samples/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

describe('mapMeetings (Ladbrokes)', () => {
  const meetings = mapMeetings(fixture('ladbrokes_meetings.json'));

  it('extracts meetings with id, track, state and date', () => {
    expect(meetings.length).toBeGreaterThan(0);
    for (const m of meetings) {
      expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(m.state).toMatch(/^[A-Z]{2,3}$/);
      expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('includes the VIC metro meeting (Caulfield)', () => {
    const caulfield = meetings.find((m) => m.track === 'Caulfield');
    expect(caulfield).toBeDefined();
    expect(caulfield!.state).toBe('VIC');
    expect(caulfield!.races.length).toBeGreaterThanOrEqual(4);
  });

  it('includes the NSW metro meeting (Rosehill)', () => {
    const rosehill = meetings.find((m) => m.track === 'Rosehill');
    expect(rosehill).toBeDefined();
    expect(rosehill!.state).toBe('NSW');
  });

  it('parses race number, name, distance and track condition', () => {
    const caulfield = meetings.find((m) => m.track === 'Caulfield')!;
    const r1 = caulfield.races[0]!;
    expect(r1.number).toBe(1);
    expect(r1.name).toBeTruthy();
    expect(r1.distance).toBeGreaterThan(0);
    expect(r1.trackCondition).toBe('Soft7');
  });
});

describe('mapEvent (Ladbrokes) — open race', () => {
  const event = mapEvent(fixture('ladbrokes_event.json'));

  it('maps runners with number, name and scratched flag', () => {
    expect(event.runners.length).toBe(10);
    const scratched = event.runners.filter((r) => r.scratched);
    expect(scratched.length).toBeGreaterThan(0);
    expect(scratched[0]!.name).toBe('Get Ready Lass');
    expect(scratched[0]!.number).toBe(1);
  });

  it('maps form-guide columns', () => {
    const r = event.runners.find((x) => x.number === 1)!;
    expect(r.jockey).toBe('Jasper Franklin');
    expect(r.trainer).toBe('Chris Anderson');
    expect(r.weight).toBe('59.5');
    expect(r.barrier).toBe('5');
    expect(r.form).toBe('6x12022x79');
  });

  it('returns no result before the race has run', () => {
    expect(event.result).toBeNull();
  });
});

describe('mapEvent (Ladbrokes) — completed race (the SP)', () => {
  const event = mapEvent(fixture('sandown_2026-08-22_r9_completed.json'));

  it('reports the winner number and name from results', () => {
    expect(event.result).not.toBeNull();
    expect(event.result!.winnerNumber).toBe(9);
    expect(event.result!.winnerName).toBe('Stay Silent');
  });

  it('reports the host-state Tote Win dividend as the SP, not the fixed odds', () => {
    // VIC "Tote Win" dividend was 5.0; the winner's fixed_win was 4.8. The
    // provider must surface the tote starting price, never the fixed odds.
    expect(event.result!.winnerSp).toBe(5.0);
  });
});
