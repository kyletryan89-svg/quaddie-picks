// Racing NSW FreeFields parser — PURE (like lib/scoring.ts): no imports from
// `next`, `react`, or `@supabase/*`, no I/O. Feed HTML in, typed data out.
//
// Source: https://racing.racingnsw.com.au/FreeFields/ (the state authority's
// public form feed). Two pages are parsed:
//   Calendar_Meetings.aspx?State=NSW  → upcoming meetings + their race cards
//   Acceptances.aspx?Key=<key>        → the field for a meeting (runners)
//
// Both pages are classic ASP.NET tables; the parsers split on well-known
// markers first, then match within each bounded chunk, so the regexes never
// cross a race/meeting boundary.

export const LEGS_PER_QUADDIE = 4;

// Metropolitan tracks (NSW). The feed also tags meetings class="Metro"; the
// whitelist is belt-and-braces for a midweek metro card slipping through.
export const METRO_TRACKS = [
  'Royal Randwick',
  'Rosehill Gardens',
  'Warwick Farm',
  'Canterbury Park',
  'Canterbury',
  'Kensington',
];

export interface FeedRace {
  /** Race number on the card (1-based). */
  number: number;
  /** Race name, e.g. "UP AND COMING STAKES". Empty when the feed omits it. */
  name: string;
  /** Jump time as the feed prints it, e.g. "3:15PM". Empty when unknown. */
  time: string;
  /** Distance, e.g. "1300". Empty when unknown. */
  distance: string;
}

export interface FeedMeeting {
  /** Stable feed key, e.g. "2026Aug29,NSW,Rosehill Gardens". */
  key: string;
  /** State code, e.g. "NSW". */
  state: string;
  /** Track display name, e.g. "Rosehill Gardens". */
  track: string;
  /** Feed meeting class: "Metro", "Trial", etc. */
  cls: string;
  /** ISO date, e.g. "2026-08-29". */
  date: string;
  /** Every race on the card, in card order. */
  races: FeedRace[];
}

export interface FeedRunner {
  number: number;
  name: string;
  jockey: string;
  trainer: string;
  barrier: string;
  weight: string;
  benchmark: string;
  /** Last-10 form line, e.g. "x321310x41". */
  form: string;
  scratched: boolean;
}

export interface FeedRaceField {
  number: number;
  name: string;
  time: string;
  runners: FeedRunner[];
}

const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

const KEY_RE = /^(\d{4})([A-Z][a-z]{2})(\d{1,2}),([A-Z]{2,3}),(.+)$/;

/** "2026Aug29,NSW,Rosehill Gardens" → { date: "2026-08-29", state: "NSW", track } */
export function parseMeetingKey(key: string): { date: string; state: string; track: string } | null {
  const m = KEY_RE.exec(key.trim());
  if (m === null) return null;
  const year = Number(m[1]);
  const month = MONTHS[m[2]!];
  const day = Number(m[3]);
  if (month === undefined || day < 1 || day > 31) return null;
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    state: m[4]!,
    track: m[5]!.trim(),
  };
}

/** Day of week (0=Sun … 6=Sat) for an ISO date string, computed in UTC. */
export function dayOfWeek(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const TIME_RE = /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/;
const DISTANCE_RE = /\(\s*(\d+)\s*m(?:etres?)?\s*\)/i;

/** Split a race title line into its name, jump time and distance. */
export function splitRaceTitle(title: string): { name: string; time: string; distance: string } {
  let cleaned = title.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  let time = '';
  const tm = TIME_RE.exec(cleaned);
  if (tm !== null) {
    time = tm[1]!;
    cleaned = cleaned.replace(tm[1]!, ' ');
  }
  let distance = '';
  const dm = DISTANCE_RE.exec(cleaned);
  if (dm !== null) {
    distance = dm[1]!;
    cleaned = cleaned.replace(dm[0]!, ' ');
  }
  return { name: cleaned.replace(/\s+/g, ' ').trim(), time, distance };
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract the first cell's text for a given class from a <tr> chunk. */
function cell(tr: string, className: string): string {
  const m = new RegExp(`<td[^>]*class=['"]${className}['"][^>]*>([\\s\\S]*?)<\\/td>`, 'i').exec(tr);
  return m === null ? '' : stripTags(m[1]!);
}

/** Parse the race list inside ONE meeting's chunk of the calendar page. */
function parseRaces(chunk: string): FeedRace[] {
  const races: FeedRace[] = [];
  const re = /<b>R(\d+)<\/b>\s*:\s*<a href="StageMeeting\.aspx\?Key=[^"]+&racenumber=\d+"\s*>([^<]*)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const number = Number(m[1]);
    const { name, time, distance } = splitRaceTitle(m[2] ?? '');
    races.push({ number, name, time, distance });
  }
  return races;
}

/** Parse the calendar page (Calendar_Meetings.aspx) into meetings. */
export function parseCalendar(html: string): FeedMeeting[] {
  const meetings: FeedMeeting[] = [];
  // Each meeting lives in its own <div id="outer" …> block, including its race
  // list, so a chunk never bleeds into the next meeting.
  const chunks = html.split(/<div\s+id="outer"/i).slice(1);

  for (const chunk of chunks) {
    const keyMatch = /showRaces\(event,\s*'([^']+)'/.exec(chunk);
    if (keyMatch === null) continue;
    const key = keyMatch[1]!;
    const parsed = parseMeetingKey(key);
    if (parsed === null) continue;

    const trackMatch = /<a\s+notranslate\s+href="StageMeeting\.aspx\?Key=[^"]*"\s+class="([^"]*)">\s*<span>([^<]+)<\/span>/.exec(chunk);
    const cls = trackMatch?.[1] ?? '';
    const track = trackMatch?.[2] ?? parsed.track;
    // Trials carry a ",Trial" suffix in the key and are never quaddie cards.
    if (key.includes(',Trial')) continue;

    meetings.push({
      key,
      state: parsed.state,
      track: track.trim(),
      cls,
      date: parsed.date,
      races: parseRaces(chunk),
    });
  }
  return meetings;
}

/** Last N races of a card, in card order — the quaddie is always the last four. */
export function lastRaces(races: FeedRace[], count = LEGS_PER_QUADDIE): FeedRace[] {
  const sorted = [...races].sort((a, b) => a.number - b.number);
  return sorted.slice(-count);
}

/** Parse the acceptances page (Acceptances.aspx) into race fields. */
export function parseAcceptances(html: string): FeedRaceField[] {
  const fields: FeedRaceField[] = [];
  // Each race is introduced by a title anchor; split on it so runner rows are
  // always attributed to the race they follow.
  const chunks = html.split(/<a\s+class="race-title-anchor"[^>]*>/i).slice(1);

  for (const chunk of chunks) {
    const head = /^([\s\S]*?)<\/a>/.exec(chunk);
    const title = head === null ? '' : stripTags(head[1]!);
    // "Race 7 - 3:15PM CANTERBURY … STAKES (1300 METRES)"
    const titleMatch = /Race\s+(\d+)\s*-\s*([\s\S]*)/i.exec(title);
    if (titleMatch === null) continue;
    const number = Number(titleMatch[1]);
    const { name, time } = splitRaceTitle(titleMatch[2] ?? '');

    const runners: FeedRunner[] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(chunk)) !== null) {
      const row = rm[0]!;
      if (!/<td[^>]*class=['"]horse['"]/i.test(row)) continue;

      const numMatch = /<td>(\d+)/i.exec(row);
      if (numMatch === null) continue;
      const number = Number(numMatch[1]);

      const nameMatch = /<td[^>]*class=['"]horse['"][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(row);
      const name = nameMatch === null ? '' : stripTags(nameMatch[1]!);

      const scratched = /\bScratched\b/i.test(row);

      runners.push({
        number,
        name,
        jockey: cell(row, 'jockey'),
        trainer: cell(row, 'trainer'),
        barrier: cell(row, 'barrier'),
        weight: cell(row, 'weight'),
        benchmark: cell(row, 'hcp'),
        form: cell(row, 'last'),
        scratched,
      });
    }

    fields.push({ number, name, time, runners });
  }
  return fields;
}

/** True when a meeting is a Saturday metro card worth showing. */
export function isSaturdayMetro(meeting: FeedMeeting, today: string): boolean {
  if (meeting.state !== 'NSW') return false;
  if (meeting.date < today) return false;
  if (dayOfWeek(meeting.date) !== 6) return false;
  return meeting.cls === 'Metro' || METRO_TRACKS.includes(meeting.track);
}

/** Today's date as YYYY-MM-DD in Australia/Sydney (the group is NSW). */
export function todaySydneyISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
