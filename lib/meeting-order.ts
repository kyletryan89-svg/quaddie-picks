// Meetings list order. Race day should lead: every card dated today (Sydney)
// sits together at the top, then upcoming dates soonest-first, then history
// most-recent-first. Status only breaks a tie on the same date — a locked
// card from last week must not bury today's Flemington or Randwick.

import type { MeetingStatus } from '@/lib/types';

const STATUS_ORDER: Record<MeetingStatus, number> = { locked: 0, open: 1, settled: 2 };

export interface OrderedMeeting {
  meeting: {
    meeting_date: string;
    status: MeetingStatus;
    track: string;
  };
}

/** 0 = today, 1 = upcoming, 2 = already run. */
function bucket(date: string, today: string): number {
  if (date === today) return 0;
  if (date > today) return 1;
  return 2;
}

export function orderMeetings(a: OrderedMeeting, b: OrderedMeeting, today: string): number {
  const byBucket = bucket(a.meeting.meeting_date, today) - bucket(b.meeting.meeting_date, today);
  if (byBucket !== 0) return byBucket;

  const dateCmp = a.meeting.meeting_date.localeCompare(b.meeting.meeting_date);
  const byDate = bucket(a.meeting.meeting_date, today) === 2 ? -dateCmp : dateCmp;
  if (byDate !== 0) return byDate;

  const byStatus = STATUS_ORDER[a.meeting.status] - STATUS_ORDER[b.meeting.status];
  if (byStatus !== 0) return byStatus;

  return a.meeting.track.localeCompare(b.meeting.track, 'en');
}
