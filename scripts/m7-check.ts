// M7 verification — season leaderboard, both sort modes (rubric R5).
//
// Run: BASE_URL=http://localhost:3000 npm run test:m7
//
// Builds TWO settled meetings in the current season and checks the ladder
// aggregates them correctly. Both meetings are drawn from
// docs/scoring-examples.md so the per-meeting numbers are already hand-computed
// there, and the season totals below are hand-added from those rows:
//
//   Meeting 1 = Example 3, "shotgun vs sharpshooter"
//     Tommo 24 tips / $24.00 / 4 hits / $40.30 / +$16.30  (solo 2, full cover)
//     Davo   4 tips / $4.00  / 2 hits / $36.00 / +$32.00  (solo 0)
//   Meeting 2 = Example 4, "the empty leg" (Davo plays Sarah's slip exactly)
//     Davo   3 tips / $3.00  / 3 hits / $9.00  / +$6.00   (no full cover)
//     Tommo  4 tips / $4.00  / 3 hits / $10.00 / +$6.00
//
//   Season totals, added by hand from the four rows above:
//     Tommo  2 mtgs / 28 tips / $28.00 / 7 hits / $50.30 / +$22.30 / solo 3 / 1 full cover
//     Davo   2 mtgs /  7 tips / $7.00  / 5 hits / $45.00 / +$38.00 / solo 1 / 0 full covers
//
// Tommo hits more legs; Davo makes more money. That is deliberate — it is the
// only way to prove the two sort modes actually order differently.

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { buildLeaderboard, sortLeaderboard } from '../lib/leaderboard';
import type { ScoringLeg, ScoringPick } from '../lib/scoring';
import { seasonFor } from '../lib/season';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
}
function note(text: string): void {
  console.log(`[NOTE] ${text}`);
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key}`);
    process.exit(2);
  }
  return raw;
}

// ─── Fixtures, traced to docs/scoring-examples.md ───────────────────────────
const M1_WINNERS = [
  { leg: 1, runner: 77, sp: '15.00' },
  { leg: 2, runner: 2, sp: '1.90' },
  { leg: 3, runner: 33, sp: '21.00' },
  { leg: 4, runner: 4, sp: '2.40' },
];
const M1_TOMMO: Record<number, number[]> = {
  1: [77, 10, 11, 12, 13, 14],
  2: [2, 20, 21, 22, 23, 24],
  3: [33, 30, 31, 32, 34, 35],
  4: [4, 40, 41, 42, 43, 44],
};
const M1_DAVO: Record<number, number[]> = { 1: [77], 2: [9], 3: [33], 4: [9] };

const M2_WINNERS = [
  { leg: 1, runner: 1, sp: '2.00' },
  { leg: 2, runner: 2, sp: '3.00' },
  { leg: 3, runner: 9, sp: '5.00' },
  { leg: 4, runner: 4, sp: '4.00' },
];
// Example 4's "Sarah": legs 1, 2 and 4 only — nothing at all in leg 3.
const M2_DAVO: Record<number, number[]> = { 1: [1], 2: [2], 4: [4] };
const M2_TOMMO: Record<number, number[]> = { 1: [1], 2: [2], 3: [9], 4: [50] };

// ─── Season totals, hand-added from the document's per-meeting rows ─────────
// Column order in the rendered table:
// Punter | Mtgs | Tips | Legs# | Legs% | W/Tips | Solo | Full | Outlay | Return | Profit | POT%
const EXPECTED = {
  tommo: ['2', '28', '7', '87.5%', '0.25', '3', '1', '$28.00', '$50.30', '+22.30', '79.6%'],
  davo: ['2', '7', '5', '62.5%', '0.71', '1', '0', '$7.00', '$45.00', '+38.00', '542.9%'],
};

async function sessionTokenOf(page: Page): Promise<string | null> {
  const cookies = await page.cookies();
  const parts = cookies
    .filter((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (parts.length === 0) return null;
  let raw = decodeURIComponent(parts.map((c) => c.value).join(''));
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
  try {
    return (JSON.parse(raw) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

async function login(browser: Browser, base: string, passcode: string, name: string): Promise<Page> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="displayName"]', name);
  await page.type('input[name="passcode"]', passcode);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 20000 });
  return page;
}

/** Every ladder row as an array of cell strings, keyed by punter name. */
async function ladderRows(page: Page): Promise<Map<string, string[]>> {
  const raw = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr')].map((r) =>
      [...r.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.trim()),
    ),
  );
  const map = new Map<string, string[]>();
  for (const cells of raw) if (cells.length > 0) map.set(cells[0] as string, cells.slice(1));
  return map;
}

async function ladderOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr')].map((r) => (r.querySelector('td') as HTMLElement).innerText.trim()),
  );
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL').replace(/\/+$/, '');
  const passcode = requireEnv('GROUP_PASSCODE');
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const admin = createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now().toString().slice(-6);
  const nameT = `Tommo ${stamp}`;
  const nameD = `Davo ${stamp}`;
  const season = seasonFor();

  const browser = await puppeteer.launch({ headless: true });
  const createdMeetings: string[] = [];
  try {
    const pageT = await login(browser, base, passcode, nameT);
    const pageD = await login(browser, base, passcode, nameD);
    const tokenT = (await sessionTokenOf(pageT)) as string;
    const tokenD = (await sessionTokenOf(pageD)) as string;

    const { data: profs } = await admin.from('profiles').select('id, display_name').in('display_name', [nameT, nameD]);
    const idOf = (n: string): string =>
      ((profs ?? []) as Array<{ id: string; display_name: string }>).find((p) => p.display_name === n)?.id ?? '';
    const tommoId = idOf(nameT);
    const davoId = idOf(nameD);

    async function buildSettledMeeting(
      label: string,
      winners: Array<{ leg: number; runner: number; sp: string }>,
      slips: Array<{ token: string; userId: string; slip: Record<number, number[]> }>,
    ): Promise<string> {
      // Create through the UI so the meeting is made the way a member makes it.
      await pageT.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
      await pageT.type('input[name="track"]', label);
      for (const [i, r] of [1, 2, 3, 4].entries()) await pageT.type(`input[name="race${i + 1}"]`, String(r + 1));
      await pageT.click('form:has(input[name="track"]) button[type="submit"]');
      await pageT.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
      const id = (await pageT.evaluate(() => window.location.pathname)).split('/')[2] as string;
      createdMeetings.push(id);

      const { data: legRows } = await admin.from('legs').select('id, leg_number').eq('meeting_id', id).order('leg_number');
      const legIdByNumber = new Map<number, string>(
        (legRows as Array<{ id: string; leg_number: number }>).map((l) => [l.leg_number, l.id]),
      );

      // Each slip written with that punter's own session, so RLS still gates it.
      for (const { token, userId, slip } of slips) {
        const rows: Array<Record<string, unknown>> = [];
        for (const [legNumber, runners] of Object.entries(slip)) {
          for (const runner of runners) {
            rows.push({ leg_id: legIdByNumber.get(Number(legNumber)), user_id: userId, runner_number: runner });
          }
        }
        const res = await fetch(`${url}/rest/v1/picks`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(rows),
        });
        const stored = ((await res.json()) as unknown[]).length;
        if (stored !== rows.length) throw new Error(`${label}: stored ${stored} of ${rows.length} picks`);
      }

      // Lock and settle through the real UI.
      await pageT.goto(`${base}/meetings/${id}`, { waitUntil: 'networkidle0' });
      await pageT.waitForSelector('button::-p-text(Lock picks)');
      await pageT.click('button::-p-text(Lock picks)');
      await pageT.waitForFunction(() => document.body.innerText.includes('Picks are locked'), { timeout: 20000 });

      await pageT.goto(`${base}/meetings/${id}/settle`, { waitUntil: 'networkidle0' });
      await pageT.waitForSelector('input[name="winner1"]');
      await pageT.evaluate((w: Array<{ leg: number; runner: number; sp: string }>) => {
        for (const one of w) {
          (document.querySelector(`[name="winner${one.leg}"]`) as HTMLInputElement).value = String(one.runner);
          (document.querySelector(`[name="name${one.leg}"]`) as HTMLInputElement).value = `Winner ${one.leg}`;
          (document.querySelector(`[name="sp${one.leg}"]`) as HTMLInputElement).value = one.sp;
        }
      }, winners);
      await pageT.click('form:has(input[name="winner1"]) button[type="submit"]');
      await pageT.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 25000 });

      const { data: m } = await admin.from('meetings').select('status').eq('id', id).single();
      if ((m as { status: string }).status !== 'settled') throw new Error(`${label} did not settle`);
      return id;
    }

    await buildSettledMeeting(`M7 One ${stamp}`, M1_WINNERS, [
      { token: tokenT, userId: tommoId, slip: M1_TOMMO },
      { token: tokenD, userId: davoId, slip: M1_DAVO },
    ]);
    await buildSettledMeeting(`M7 Two ${stamp}`, M2_WINNERS, [
      { token: tokenT, userId: tommoId, slip: M2_TOMMO },
      { token: tokenD, userId: davoId, slip: M2_DAVO },
    ]);
    check('two meetings settled in the current season', createdMeetings.length === 2, createdMeetings.join(', '));

    // ── Authority check: buildLeaderboard() vs the hand-added totals ────────
    const toScored = (winners: typeof M1_WINNERS, slips: Array<{ userId: string; slip: Record<number, number[]> }>) => {
      const legs: ScoringLeg[] = winners.map((w) => ({ legNumber: w.leg, winnerNumber: w.runner, winnerSp: Number(w.sp) }));
      const picks: ScoringPick[] = [];
      for (const { userId, slip } of slips) {
        for (const [legNumber, runners] of Object.entries(slip)) {
          for (const r of runners) picks.push({ userId, legNumber: Number(legNumber), runnerNumber: r });
        }
      }
      return { legs, picks };
    };
    const pure = buildLeaderboard(
      [
        toScored(M1_WINNERS, [
          { userId: tommoId, slip: M1_TOMMO },
          { userId: davoId, slip: M1_DAVO },
        ]),
        toScored(M2_WINNERS, [
          { userId: tommoId, slip: M2_TOMMO },
          { userId: davoId, slip: M2_DAVO },
        ]),
      ],
      [
        { id: tommoId, displayName: nameT },
        { id: davoId, displayName: nameD },
      ],
    );
    const pT = pure.find((r) => r.userId === tommoId);
    const pD = pure.find((r) => r.userId === davoId);
    note(`buildLeaderboard → Tommo ${JSON.stringify(pT)}`);
    note(`buildLeaderboard → Davo  ${JSON.stringify(pD)}`);

    check(
      'buildLeaderboard matches the hand-added season totals for Tommo (2 mtgs, 28 tips, 7 hits, $50.30, +$22.30)',
      pT !== undefined &&
        pT.meetings === 2 &&
        pT.selections === 28 &&
        pT.legsHit === 7 &&
        pT.outlay.toFixed(2) === '28.00' &&
        pT.returnTotal.toFixed(2) === '50.30' &&
        pT.profit.toFixed(2) === '22.30' &&
        pT.soloLegs === 3 &&
        pT.fullCovers === 1,
    );
    check(
      'buildLeaderboard matches the hand-added season totals for Davo (2 mtgs, 7 tips, 5 hits, $45.00, +$38.00)',
      pD !== undefined &&
        pD.meetings === 2 &&
        pD.selections === 7 &&
        pD.legsHit === 5 &&
        pD.outlay.toFixed(2) === '7.00' &&
        pD.returnTotal.toFixed(2) === '45.00' &&
        pD.profit.toFixed(2) === '38.00' &&
        pD.soloLegs === 1 &&
        pD.fullCovers === 0,
    );

    // ── R5: the rendered ladder aggregates both meetings ───────────────────
    await pageT.goto(`${base}/leaderboard`, { waitUntil: 'networkidle0' });
    await pageT.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const rows = await ladderRows(pageT);
    note(`rendered Tommo row: ${JSON.stringify(rows.get(nameT))}`);
    note(`rendered Davo  row: ${JSON.stringify(rows.get(nameD))}`);

    check(
      'rendered ladder row for Tommo matches the hand-added totals cell for cell',
      JSON.stringify(rows.get(nameT)) === JSON.stringify(EXPECTED.tommo),
      `got ${JSON.stringify(rows.get(nameT))} want ${JSON.stringify(EXPECTED.tommo)}`,
    );
    check(
      'rendered ladder row for Davo matches the hand-added totals cell for cell',
      JSON.stringify(rows.get(nameD)) === JSON.stringify(EXPECTED.davo),
      `got ${JSON.stringify(rows.get(nameD))} want ${JSON.stringify(EXPECTED.davo)}`,
    );

    // ── R5/SPEC §2: both sorts, and they must differ ───────────────────────
    const profitOrder = await ladderOrder(pageT);
    const pIdxT = profitOrder.indexOf(nameT);
    const pIdxD = profitOrder.indexOf(nameD);
    check(
      'default sort is profit descending — Davo (+$38.00) above Tommo (+$22.30)',
      pIdxD >= 0 && pIdxT >= 0 && pIdxD < pIdxT,
      `Davo #${pIdxD + 1}, Tommo #${pIdxT + 1}`,
    );

    await pageT.click('a::-p-text(Legs hit)');
    await pageT.waitForFunction(() => window.location.search.includes('sort=legs'), { timeout: 20000 });
    await pageT.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const legsOrder = await ladderOrder(pageT);
    const lIdxT = legsOrder.indexOf(nameT);
    const lIdxD = legsOrder.indexOf(nameD);
    check(
      'legs-hit sort reverses them — Tommo (7 legs) above Davo (5 legs)',
      lIdxT >= 0 && lIdxD >= 0 && lIdxT < lIdxD,
      `Tommo #${lIdxT + 1}, Davo #${lIdxD + 1}`,
    );
    check(
      'the two sort modes genuinely produce different orders',
      pIdxD < pIdxT && lIdxT < lIdxD,
      `profit: Davo→Tommo · legs: Tommo→Davo`,
    );

    // Totals must be identical under either sort — sorting must not re-aggregate.
    const rowsAfterSort = await ladderRows(pageT);
    check(
      'switching sort does not change any number, only the order',
      JSON.stringify(rowsAfterSort.get(nameT)) === JSON.stringify(EXPECTED.tommo) &&
        JSON.stringify(rowsAfterSort.get(nameD)) === JSON.stringify(EXPECTED.davo),
    );

    // The pure sorter and the rendered order must agree.
    const pureLegsOrder = sortLeaderboard(pure, 'legs').map((r) => r.displayName);
    check(
      'rendered legs-hit order agrees with sortLeaderboard()',
      pureLegsOrder[0] === nameT && pureLegsOrder[1] === nameD,
      pureLegsOrder.join(' → '),
    );

    // ── Season selector defaults to the current season ─────────────────────
    await pageT.goto(`${base}/leaderboard`, { waitUntil: 'networkidle0' });
    await pageT.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const activeSeason = await pageT.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Season"]');
      const active = [...(nav?.querySelectorAll('a') ?? [])].find((a) => a.className.includes('bg-slate-900'));
      return (active as HTMLElement | undefined)?.innerText.trim() ?? '(none)';
    });
    check('season selector defaults to the current season', activeSeason === season.label, `${activeSeason} vs ${season.label}`);

    const seasonChips = await pageT.evaluate(() =>
      [...(document.querySelector('nav[aria-label="Season"]')?.querySelectorAll('a') ?? [])].map((a) =>
        (a as HTMLElement).innerText.trim(),
      ),
    );
    check('season selector lists the seasons present in the data', seasonChips.length >= 1, seasonChips.join(', '));

    const wide = await pageT.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    );
    check('R6: ladder page has no horizontal scroll at 390px', wide <= 391, `scrollWidth=${wide}`);

    // ── A season with nothing settled must say so, not show a table of zeros ─
    // The empty branch keyed off row count, which is never zero while any
    // profile exists. Park both settled meetings out of season to reach it.
    const parked: Array<{ id: string; meeting_date: string }> = [];
    const { data: inSeason } = await admin
      .from('meetings')
      .select('id, meeting_date')
      .eq('status', 'settled')
      .gte('meeting_date', season.start)
      .lte('meeting_date', season.end);
    try {
      for (const m of (inSeason ?? []) as Array<{ id: string; meeting_date: string }>) {
        parked.push(m);
        await admin.from('meetings').update({ meeting_date: '2001-01-01' }).eq('id', m.id);
      }
      await pageT.goto(`${base}/leaderboard`, { waitUntil: 'networkidle0' });
      await pageT.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
      const emptyText = await pageT.evaluate(() => (document.querySelector('main') as HTMLElement).innerText);
      check(
        'a season with no settled meetings shows the empty state, not a table of zero rows',
        emptyText.includes('No settled meetings in') && emptyText.includes(season.label),
        JSON.stringify(emptyText.replace(/\n/g, ' | ').slice(0, 160)),
      );
      const tableGone = await pageT.evaluate(() => document.querySelectorAll('table tbody tr').length);
      check('no ladder table is rendered when nothing is settled', tableGone === 0, `${tableGone} rows`);
    } finally {
      for (const m of parked) {
        await admin.from('meetings').update({ meeting_date: m.meeting_date }).eq('id', m.id);
      }
      console.log(`[restore] ${parked.length} settled meeting dates restored to the ${season.label} season`);
    }
  } finally {
    for (const id of createdMeetings) {
      await admin.from('meetings').delete().eq('id', id);
    }
    if (createdMeetings.length > 0) console.log(`[cleanup] removed ${createdMeetings.length} test meetings`);
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} M7 checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
