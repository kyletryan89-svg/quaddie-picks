// Racing carnivals — the three-month "seasonal" periods the leaderboard breaks
// into. Australian meteorological seasons, so the current block changes every
// three months (Spring Carnival → Summer → Autumn → Winter).

export interface Carnival {
  /** Display label, e.g. "Spring Carnival". */
  label: string;
  /** First day, YYYY-MM-DD (inclusive). */
  start: string;
  /** Last day, YYYY-MM-DD (inclusive). */
  end: string;
}

function sydneyParts(d: Date): { y: number; m: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), day: get('day') };
}

function iso(d: Date): string {
  const { y, m, day } = sydneyParts(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The carnival (three-month block) containing the given moment. */
export function carnivalFor(now: Date = new Date()): Carnival {
  const { y, m } = sydneyParts(now);
  if (m >= 9 && m <= 11) return { label: 'Spring Carnival', start: `${y}-09-01`, end: `${y}-11-30` };
  if (m === 12) return { label: 'Summer', start: `${y}-12-01`, end: `${y + 1}-02-28` };
  if (m <= 2) return { label: 'Summer', start: `${y - 1}-12-01`, end: `${y}-02-28` };
  if (m <= 5) return { label: 'Autumn', start: `${y}-03-01`, end: `${y}-05-31` };
  return { label: 'Winter', start: `${y}-06-01`, end: `${y}-08-31` };
}

/** Start of the rolling "last week" window (seven days ago, Sydney time). */
export function lastWeekStart(now: Date = new Date()): string {
  return iso(new Date(now.getTime() - 7 * 86_400_000));
}
