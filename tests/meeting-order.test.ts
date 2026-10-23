import { describe, expect, it } from 'vitest';
import { orderMeetings } from '@/lib/meeting-order';
import { sydneyTodayISO } from '@/lib/racing/dates';
import type { MeetingStatus } from '@/lib/types';

const COX_PLATE = '2026-10-24';

function card(track: string, date: string, status: MeetingStatus) {
  return { meeting: { track, meeting_date: date, status } };
}

function tracks(cards: ReturnType<typeof card>[], today = COX_PLATE): string[] {
  return [...cards].sort((a, b) => orderMeetings(a, b, today)).map((c) => c.meeting.track);
}

describe('orderMeetings', () => {
  it('puts every meeting on today above upcoming and past cards', () => {
    const ordered = tracks([
      card('Caulfield', '2026-10-17', 'locked'),
      card('Rosehill Gardens', '2026-10-10', 'settled'),
      card('Randwick', COX_PLATE, 'open'),
      card('Flemington', COX_PLATE, 'open'),
      card('Moonee Valley', '2026-10-31', 'open'),
    ]);

    expect(ordered.slice(0, 2).sort()).toEqual(['Flemington', 'Randwick']);
    expect(ordered[2]).toBe('Moonee Valley');
    expect(ordered.slice(3)).toEqual(['Caulfield', 'Rosehill Gardens']);
  });

  it('keeps today together even when an older card is locked and today is open', () => {
    const ordered = tracks([
      card('Warwick Farm', '2026-10-03', 'locked'),
      card('Flemington', COX_PLATE, 'open'),
      card('Randwick', COX_PLATE, 'open'),
    ]);

    expect(ordered).toEqual(['Flemington', 'Randwick', 'Warwick Farm']);
  });

  it('orders upcoming dates soonest-first and past dates most-recent-first', () => {
    const ordered = tracks(
      [
        card('Sandown', '2026-09-05', 'settled'),
        card('Caulfield', '2026-10-17', 'settled'),
        card('Rosehill Gardens', '2026-11-07', 'open'),
        card('Moonee Valley', '2026-10-31', 'open'),
      ],
      COX_PLATE,
    );

    expect(ordered).toEqual(['Moonee Valley', 'Rosehill Gardens', 'Caulfield', 'Sandown']);
  });

  it('breaks a same-day tie by status, then track name', () => {
    const ordered = tracks([
      card('Randwick', COX_PLATE, 'open'),
      card('Flemington', COX_PLATE, 'settled'),
      card('Caulfield', COX_PLATE, 'locked'),
      card('Sandown', COX_PLATE, 'open'),
    ]);

    expect(ordered).toEqual(['Caulfield', 'Randwick', 'Sandown', 'Flemington']);
  });
});

describe('sydneyTodayISO', () => {
  it('uses the Sydney calendar date, including when UTC is still the day before', () => {
    // 21:08 UTC Friday is 08:08 Saturday in Sydney (AEDT, UTC+11).
    expect(sydneyTodayISO(new Date('2026-10-23T21:08:00Z'))).toBe('2026-10-24');
    expect(sydneyTodayISO(new Date('2026-10-23T12:00:00Z'))).toBe('2026-10-23');
  });
});
