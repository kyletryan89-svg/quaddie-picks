// Ordered exotic selections. A trifecta is three distinct runner numbers,
// a first 4 is four. Empty means "not entered".

const MIN = 1;
const MAX = 30;

export type ExoticParse = { ok: true; numbers: number[] } | { ok: false; error: string };

export function parseExotic(raw: readonly string[], count: 3 | 4, label: string): ExoticParse {
  const filled = raw.map((value) => value.trim()).filter((value) => value !== '');
  if (filled.length === 0) return { ok: true, numbers: [] };
  if (filled.length !== count) {
    return { ok: false, error: `${label} needs ${count} runners, in order.` };
  }
  const numbers: number[] = [];
  for (const value of filled) {
    if (!/^\d+$/.test(value)) return { ok: false, error: `${label}: “${value}” is not a runner number.` };
    const n = Number(value);
    if (n < MIN || n > MAX) return { ok: false, error: `${label}: runner numbers are ${MIN}–${MAX}.` };
    numbers.push(n);
  }
  if (new Set(numbers).size !== numbers.length) {
    return { ok: false, error: `${label}: each finishing place needs a different runner.` };
  }
  return { ok: true, numbers };
}

export function formatExotic(numbers: readonly number[] | null | undefined): string {
  if (numbers === null || numbers === undefined || numbers.length === 0) return '—';
  return numbers.join('-');
}

/** PostgREST when the table has not been created yet. */
export function isMissingExoticsTable(error: { code?: string; message?: string } | null): boolean {
  if (error === null) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  const message = error.message ?? '';
  return /exotic_picks/i.test(message) && /schema cache|does not exist|could not find/i.test(message);
}
