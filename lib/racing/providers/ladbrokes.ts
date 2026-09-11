// Ladbrokes/Neds Entain affiliates racing API provider.
//
// This is the ONLY file (outside docs/) that may reference provider field
// names, URLs and response shapes — see docs/provider-mapping.md for the
// authoritative field map, written from real responses saved under
// docs/samples/. The pure mapping functions are exported so tests run against
// those saved fixtures and never touch the live network.

import type {
  Provider,
  ProviderMeeting,
  ProviderRace,
  ProviderResult,
  ProviderRunner,
} from '@/lib/racing/provider';

const DEFAULT_BASE_URL = 'https://api.ladbrokes.com.au/affiliates/v1';

// The provider's docs require identifying headers, else they rate-limit/block.
// TODO: replace the placeholders with real contact values via env before this
// is relied on in anger (noted in docs/provider-mapping.md).
const FROM = process.env.AFFILIATE_FROM ?? 'quaddie-picks@users.noreply.github.com';
const PARTNER = process.env.AFFILIATE_PARTNER ?? 'quaddie-picks';

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_INTERVAL_MS = 1_000;

// ── raw shapes (provider-private) ─────────────────────────────────────────────

interface RawMeeting {
  meeting?: string;
  name?: string;
  date?: string;
  category?: string;
  state?: string;
  races?: RawMeetingRace[];
}

interface RawMeetingRace {
  id?: string;
  race_number?: number;
  name?: string;
  start_time?: string;
  distance?: number;
  track_condition?: string;
}

interface RawEvent {
  data?: {
    race?: {
      state?: string;
      status?: string;
    };
    results?: RawResult[] | null;
    dividends?: RawDividend[] | null;
    runners?: RawRunner[] | null;
  };
}

interface RawResult {
  position?: number;
  runner_number?: number;
  name?: string;
}

interface RawDividend {
  product_name?: string;
  tote?: string;
  dividend?: number;
}

interface RawRunner {
  runner_number?: number;
  name?: string;
  is_scratched?: boolean;
  barrier?: number | string | null;
  jockey?: string;
  trainer_name?: string;
  weight?: { allocated?: string; total?: string };
  last_twenty_starts?: string;
}

// ── pure mapping (tested against docs/samples/) ───────────────────────────────

function mapMeetingRace(raw: RawMeetingRace): ProviderRace | null {
  if (typeof raw.id !== 'string') return null;
  if (typeof raw.race_number !== 'number' || raw.race_number < 1) return null;
  return {
    id: raw.id,
    number: raw.race_number,
    name: typeof raw.name === 'string' ? raw.name : '',
    startTime: typeof raw.start_time === 'string' ? raw.start_time : '',
    distance: typeof raw.distance === 'number' ? raw.distance : null,
    trackCondition: typeof raw.track_condition === 'string' ? raw.track_condition : null,
  };
}

/** Parse a meetings response into provider meetings (thoroughbred only). */
export function mapMeetings(json: unknown): ProviderMeeting[] {
  const list = (json as { data?: { meetings?: unknown } } | null)?.data?.meetings;
  if (!Array.isArray(list)) return [];
  const out: ProviderMeeting[] = [];
  for (const item of list) {
    const m = item as RawMeeting;
    if (typeof m.meeting !== 'string' || typeof m.name !== 'string' || typeof m.date !== 'string') continue;
    if (m.category !== undefined && m.category !== 'T') continue;
    if (typeof m.state !== 'string') continue;
    const races = (m.races ?? []).map(mapMeetingRace).filter((r): r is ProviderRace => r !== null);
    out.push({ id: m.meeting, track: m.name, state: m.state, date: m.date.slice(0, 10), races });
  }
  return out;
}

function mapRunner(raw: RawRunner): ProviderRunner | null {
  if (typeof raw.runner_number !== 'number' || typeof raw.name !== 'string') return null;
  return {
    number: raw.runner_number,
    name: raw.name,
    scratched: raw.is_scratched === true,
    jockey: typeof raw.jockey === 'string' ? raw.jockey : null,
    trainer: typeof raw.trainer_name === 'string' ? raw.trainer_name : null,
    barrier: raw.barrier === null || raw.barrier === undefined ? null : String(raw.barrier),
    weight: typeof raw.weight?.allocated === 'string' ? raw.weight.allocated : null,
    form: typeof raw.last_twenty_starts === 'string' ? raw.last_twenty_starts : null,
  };
}

/** Host-state tote win dividend = the SP (total return per $1). Null if absent. */
function toteWinSp(dividends: RawDividend[] | null | undefined, state: string): number | null {
  if (!Array.isArray(dividends)) return null;
  const wins = dividends.filter((d) => d?.product_name === 'Tote Win');
  if (wins.length === 0) return null;
  const host = wins.find((d) => d.tote === state) ?? wins[0];
  const v = host?.dividend;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parse an event response into its runners, host state and result. */
export function mapEvent(json: unknown): {
  state: string;
  runners: ProviderRunner[];
  result: ProviderResult | null;
  abandoned: boolean;
} {
  const data = (json as RawEvent)?.data;
  const state = typeof data?.race?.state === 'string' ? data.race.state : '';
  const runners = (data?.runners ?? []).map(mapRunner).filter((r): r is ProviderRunner => r !== null);
  const abandoned = data?.race?.status === 'Abandoned';

  let result: ProviderResult | null = null;
  const results = data?.results;
  if (Array.isArray(results) && results.length > 0) {
    const winner = results.find((r) => r.position === 1);
    if (winner !== undefined && typeof winner.runner_number === 'number') {
      result = {
        winnerNumber: winner.runner_number,
        winnerName: typeof winner.name === 'string' ? winner.name : '',
        winnerSp: toteWinSp(data?.dividends, state),
      };
    }
  }
  return { state, runners, result, abandoned };
}

// ── HTTP layer: 1 req/sec, retry 429/5xx with backoff, max 3 attempts ────────

let lastRequestAt = 0;

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Enforce the 1 request/second floor across the whole process. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const waitFor = lastRequestAt + MIN_INTERVAL_MS - now;
  if (waitFor > 0) await wait(waitFor);
  lastRequestAt = Date.now();
}

export class LadbrokesProvider implements Provider {
  readonly name = 'ladbrokes';

  constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async fetchJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await throttle();
      try {
        const res = await this.fetcher(url, {
          headers: {
            From: FROM,
            'X-Partner': PARTNER,
            accept: 'application/json',
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: 'no-store',
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`provider returned ${res.status}`);
          await wait(attempt * 1_000);
          continue;
        }
        if (!res.ok) throw new Error(`provider returned ${res.status}`);
        const text = await res.text();
        return JSON.parse(text) as unknown;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) await wait(attempt * 1_000);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async getSaturdayMeetings(date: string): Promise<ProviderMeeting[]> {
    const json = await this.fetchJson(`/racing/meetings?category=T&country=AUS&date_from=${date}&date_to=${date}`);
    return mapMeetings(json);
  }

  async getCard(meetingId: string): Promise<ProviderRace[]> {
    const json = await this.fetchJson(`/racing/meetings/${encodeURIComponent(meetingId)}`);
    return mapMeetings(json)[0]?.races ?? [];
  }

  async getRunners(raceId: string): Promise<ProviderRunner[]> {
    const json = await this.fetchJson(`/racing/events/${encodeURIComponent(raceId)}`);
    return mapEvent(json).runners;
  }

  async getResult(raceId: string): Promise<ProviderResult | null> {
    return (await this.getOutcome(raceId)).result;
  }

  async getOutcome(raceId: string): Promise<{ result: ProviderResult | null; abandoned: boolean }> {
    const json = await this.fetchJson(`/racing/events/${encodeURIComponent(raceId)}`);
    const { result, abandoned } = mapEvent(json);
    return { result, abandoned };
  }
}

export const ladbrokes = new LadbrokesProvider();
