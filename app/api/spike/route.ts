import { NextResponse } from 'next/server';

// ── M0 SPIKE ──────────────────────────────────────────────────────────────────
// Deploy-only probe: does ANY provider return usable racing JSON from Vercel?
// Nothing here builds against a schema we have not seen a real response for.
// Each probe returns the raw status, content type and body (truncated).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Probe {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: string;
  json?: unknown;
  error?: string;
  ms: number;
}

const BODY_CAP = 60_000;

async function probe(name: string, url: string, headers: Record<string, string> = {}): Promise<Probe> {
  const started = Date.now();
  const out: Probe = { name, url, ok: false, ms: 0 };
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        accept: 'application/json,text/plain,*/*',
        ...headers,
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    out.status = res.status;
    out.contentType = res.headers.get('content-type') ?? undefined;
    const text = await res.text();
    out.ms = Date.now() - started;
    out.body = text.slice(0, BODY_CAP);
    out.ok = res.ok;
    if (res.ok && out.contentType?.includes('json')) {
      try {
        out.json = JSON.parse(text);
      } catch {
        // not JSON despite the header
      }
    }
  } catch (err) {
    out.ms = Date.now() - started;
    out.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  return out;
}

function nextSaturdaySydney(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(Date.now() + i * 86_400_000);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney', weekday: 'short' }).format(candidate);
    if (weekday === 'Sat') return fmt.format(candidate);
  }
  return fmt.format(new Date());
}

const ID = {
  From: 'quaddie-picks@users.noreply.github.com',
  'X-Partner': 'quaddie-picks',
};

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? nextSaturdaySydney();
  const region = process.env.VERCEL_REGION ?? process.env.NOW_REGION ?? 'unknown';

  const probes: Probe[] = [];

  // ── Source 1: TAB (recorded for the spike log) ──────────────────────────────
  probes.push(await probe('tab-meetings', `https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/${date}/meetings?jurisdiction=VIC`));

  // ── Source 3: Ladbrokes/Neds Entain affiliate racing API ────────────────────
  const meetingsParams = `category=T&country=AUS&date_from=${date}&date_to=${date}`;
  const entainBases = [
    ['ladbrokes', 'https://api.ladbrokes.com.au/affiliates/v1'],
    ['ladbrokes-aff', 'https://api-affiliates.ladbrokes.com.au/affiliates/v1'],
    ['neds', 'https://api.neds.com.au/affiliates/v1'],
  ] as const;

  const meetingsResults = await Promise.all(
    entainBases.map(([tag, base]) => probe(`entain-${tag}-meetings`, `${base}/racing/meetings?${meetingsParams}`, ID)),
  );
  probes.push(...meetingsResults);

  // Follow up with a race detail call from the FIRST base that returned JSON
  // with at least one meeting carrying a race id — the URL is derived from a
  // real response, not guessed.
  for (let i = 0; i < entainBases.length; i++) {
    const res = meetingsResults[i]!;
    if (res.json === undefined) continue;
    const data = (res.json as { data?: { meetings?: Array<{ races?: Array<{ id?: string }> }> } }).data;
    const meeting = data?.meetings?.find((m) => (m.races?.length ?? 0) > 0);
    const raceId = meeting?.races?.[0]?.id;
    if (raceId === undefined) continue;
    const base = entainBases[i]![1];
    probes.push(await probe(`entain-${entainBases[i]![0]}-event`, `${base}/racing/events/${raceId}`, ID));
    break;
  }

  // ── Source 4: racing.com (recorded for the spike log) ───────────────────────
  probes.push(await probe('racingcom', `https://www.racing.com/form/${date}/racing`));

  return NextResponse.json({ date, region, ranAt: new Date().toISOString(), probes });
}
