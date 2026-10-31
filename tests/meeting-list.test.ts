import { describe, expect, it } from 'vitest';
import { comparePast, compareUpcoming, isOnOrAfter } from '@/lib/meeting-list';
import { sydneyTodayISO } from '@/lib/racing/dates';

describe('sydneyTodayISO', () => {
  it('uses the Australia/Sydney calendar date across midnight', () => {
    // 30 Oct 2026 13:30 UTC is 31 Oct 00:30 in Sydney (AEDT, UTC+11).
    expect(sydneyTodayISO(new Date('2026-10-30T13:30:00Z'))).toBe('2026-10-31');
    // One hour earlier is still 30 Oct in Sydney.
    expect(sydneyTodayISO(new Date('2026-10-30T12:30:00Z'))).toBe('2026-10-30');
  });
});

describe('meeting list split', () => {
  const today = '2026-10-31';
  const rows = [
    { meeting_date: '2026-10-24', track: 'Randwick' },
    { meeting_date: '2026-10-31', track: 'Flemington' },
    { meeting_date: '2026-11-07', track: 'Rosehill' },
    { meeting_date: '2026-10-31', track: 'Caulfield' },
    { meeting_date: '2026-10-17', track: 'Eagle Farm' },
  ];

  it('keeps today and later, soonest first', () => {
    const upcoming = rows.filter((m) => isOnOrAfter(m.meeting_date, today)).sort(compareUpcoming);
    expect(upcoming.map((m) => `${m.meeting_date} ${m.track}`)).toEqual([
      '2026-10-31 Caulfield',
      '2026-10-31 Flemington',
      '2026-11-07 Rosehill',
    ]);
  });

  it('puts older meetings newest first', () => {
    const past = rows.filter((m) => !isOnOrAfter(m.meeting_date, today)).sort(comparePast);
    expect(past.map((m) => `${m.meeting_date} ${m.track}`)).toEqual([
      '2026-10-24 Randwick',
      '2026-10-17 Eagle Farm',
    ]);
  });
});
