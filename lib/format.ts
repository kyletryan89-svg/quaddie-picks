// Display formatting. Money values are ordinary numbers; the single source of
// truth for the POT zero-outlay guard lives in lib/scoring.ts (potPercent).

const moneyFmt = new Intl.NumberFormat('en-AU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(n: number): string {
  return moneyFmt.format(n);
}

export function signedMoney(n: number): string {
  return n > 0 ? `+${moneyFmt.format(n)}` : moneyFmt.format(n);
}

export function pct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}%`;
}

export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

/** AU-style short date: Sat 29 Aug 2026 */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
