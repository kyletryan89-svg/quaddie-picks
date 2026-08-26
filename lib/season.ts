// Australian racing season: 1 August – 31 July. All date math in UTC against
// plain YYYY-MM-DD strings, so behaviour is identical on server and client.

export interface Season {
  /** First day, YYYY-MM-DD (inclusive) */
  start: string;
  /** Last day, YYYY-MM-DD (inclusive) */
  end: string;
  /** Human label, e.g. “2026–27” */
  label: string;
}

function toUTC(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** The season containing the given moment (defaults to now). */
export function seasonFor(date: Date = new Date()): Season {
  const calYear = date.getUTCFullYear();
  const startedThisSeason = date.getTime() >= Date.UTC(calYear, 7, 1); // 1 Aug
  const startYear = startedThisSeason ? calYear : calYear - 1;
  return {
    start: `${startYear}-08-01`,
    end: `${startYear + 1}-07-31`,
    label: `${startYear}–${String(startYear + 1).slice(2)}`,
  };
}

/** True when a YYYY-MM-DD date falls within the season. */
export function isInSeason(dateStr: string, season: Season): boolean {
  const t = toUTC(dateStr);
  return t >= toUTC(season.start) && t <= toUTC(season.end);
}

/** Season for a given label like “2026–27”; inverse of seasonFor().label. */
export function seasonFromLabel(label: string): Season | null {
  const match = /^(\d{4})–(\d{2})$/.exec(label);
  if (match === null) return null;
  const startYear = Number(match[1]);
  return {
    start: `${startYear}-08-01`,
    end: `${startYear + 1}-07-31`,
    label,
  };
}

/**
 * Every season that contains at least one of the given dates, newest first.
 * Used by the leaderboard selector.
 */
export function seasonsCovering(dates: readonly string[]): Season[] {
  const years = new Set<number>();
  for (const d of dates) {
    const [y, m] = d.split('-').map(Number) as [number, number];
    years.add(m >= 8 ? y : y - 1);
  }
  return [...years]
    .sort((a, b) => b - a)
    .map((startYear) => ({
      start: `${startYear}-08-01`,
      end: `${startYear + 1}-07-31`,
      label: `${startYear}–${String(startYear + 1).slice(2)}`,
    }));
}
