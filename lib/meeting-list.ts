// Home-list ordering only. The ladder does not use this.

export interface DatedMeeting {
  meeting_date: string;
  track: string;
}

/** Today and later, soonest date first. Same day: track name. */
export function compareUpcoming(a: DatedMeeting, b: DatedMeeting): number {
  return a.meeting_date.localeCompare(b.meeting_date) || a.track.localeCompare(b.track);
}

/** Before today, newest date first. Same day: track name. */
export function comparePast(a: DatedMeeting, b: DatedMeeting): number {
  return b.meeting_date.localeCompare(a.meeting_date) || a.track.localeCompare(b.track);
}

export function isOnOrAfter(meetingDate: string, today: string): boolean {
  return meetingDate >= today;
}
