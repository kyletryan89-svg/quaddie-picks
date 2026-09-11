// Date helpers for the ingestion jobs, all in Australia/Sydney (the group is
// AEST; racing days are Saturdays).

function sydneyParts(d: Date): { y: number; m: number; day: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { y: Number(get('year')), m: Number(get('month')), day: Number(get('day')), weekday: get('weekday') };
}

/** YYYY-MM-DD for the given Sydney-local date. */
function toISO(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The Saturday the jobs should target: today when today is Saturday (the
 * scratchings/results jobs run on Saturday), otherwise the next Saturday (the
 * fields job runs Thursday/Friday ahead of the card).
 */
export function targetSaturdayISO(): string {
  const now = new Date();
  const { y, m, day, weekday } = sydneyParts(now);
  if (weekday === 'Sat') return toISO(y, m, day);
  for (let i = 1; i <= 7; i++) {
    const c = new Date(now.getTime() + i * 86_400_000);
    const p = sydneyParts(c);
    if (p.weekday === 'Sat') return toISO(p.y, p.m, p.day);
  }
  return toISO(y, m, day);
}

/**
 * The most recent Saturday on or before today (AEST). Results are about races
 * that have already run, so this is the Saturday the results job targets: today
 * when today is Saturday, otherwise the one just past.
 */
export function mostRecentSaturdayISO(): string {
  const now = new Date();
  const { y, m, day, weekday } = sydneyParts(now);
  if (weekday === 'Sat') return toISO(y, m, day);
  for (let i = 1; i <= 7; i++) {
    const c = new Date(now.getTime() - i * 86_400_000);
    const p = sydneyParts(c);
    if (p.weekday === 'Sat') return toISO(p.y, p.m, p.day);
  }
  return toISO(y, m, day);
}
