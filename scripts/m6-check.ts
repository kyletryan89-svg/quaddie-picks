// M6 verification — lock + settle + per-meeting result table (rubric R4, R5).
//
// Run: BASE_URL=http://localhost:3000 npm run test:m6
//
// The meeting built here is **Example 3 from docs/scoring-examples.md** —
// "shotgun vs sharpshooter" — reproduced end to end through the real UI. The
// numbers asserted below are transcribed from that document by hand, NOT read
// out of the code. Three things must agree:
//
//   1. the hand-computed table in docs/scoring-examples.md
//   2. scoreMeeting() — the pure function that is the authority (SPEC §2)
//   3. what the settled meeting screen actually renders
//
// If 2 and 3 disagree with 1, the UI is wrong. All three are checked.

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { scoreMeeting, type ScoringLeg, type ScoringPick } from '../lib/scoring';
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

// ─── The document, transcribed by hand ──────────────────────────────────────
// docs/scoring-examples.md, Example 3. Winners and both punters' rows.
const DOC = {
  winners: [
    { leg: 1, runner: 77, sp: '15.00' },
    { leg: 2, runner: 2, sp: '1.90' },
    { leg: 3, runner: 33, sp: '21.00' },
    { leg: 4, runner: 4, sp: '2.40' },
  ],
  // "Tommo boxes six wide every leg (24 selections, $24 outlay) and lands all four"
  tommo: { tips: 24, outlay: '24.00', legsHit: 4, ret: '40.30', profit: '+16.30', fullCover: true, soloLegs: 2 },
  // "Davo has one dart per leg (4 selections, $4 outlay), hits #77 and #33"
  davo: { tips: 4, outlay: '4.00', legsHit: 2, ret: '36.00', profit: '+32.00', fullCover: false, soloLegs: 0 },
} as const;

// The slips that produce that table. Tommo boxes six wide including each
// winner; Davo has one dart per leg and lands legs 1 and 3 only.
const TOMMO_SLIP: Record<number, number[]> = {
  1: [77, 10, 11, 12, 13, 14],
  2: [2, 20, 21, 22, 23, 24],
  3: [33, 30, 31, 32, 34, 35],
  4: [4, 40, 41, 42, 43, 44],
};
const DAVO_SLIP: Record<number, number[]> = { 1: [77], 2: [9], 3: [33], 4: [9] };

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

/** The cell values of one rendered result row, by punter name. */
async function resultRow(page: Page, punter: string): Promise<string[] | null> {
  return page.evaluate((who: string) => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const row = rows.find((r) => (r.querySelector('td') as HTMLElement | null)?.innerText.trim() === who);
    if (row === undefined) return null;
    return [...row.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.trim());
  }, punter);
}

/** Overwrite all twelve settle fields. Uncontrolled inputs, so a direct set is what the form submits. */
async function fillSettle(page: Page, vals: Record<string, string>): Promise<void> {
  await page.evaluate((v: Record<string, string>) => {
    for (const [name, value] of Object.entries(v)) {
      const el = document.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
      if (el !== null) el.value = value;
    }
  }, vals);
}

function goodSettleValues(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const w of DOC.winners) {
    v[`winner${w.leg}`] = String(w.runner);
    v[`name${w.leg}`] = `Winner ${w.leg}`;
    v[`sp${w.leg}`] = w.sp;
  }
  return v;
}

async function submitSettle(page: Page): Promise<void> {
  // Scoped to the settle form: the header carries its own sign-out <form>, and
  // a bare `form button[type="submit"]` matches that one first and logs out.
  await page.click('form:has(input[name="winner1"]) button[type="submit"]');
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
  const track = `M6 Park ${stamp}`;
  const nameT = `Tommo ${stamp}`;
  const nameD = `Davo ${stamp}`;

  const browser = await puppeteer.launch({ headless: true });
  let meetingId = '';
  try {
    const pageT = await login(browser, base, passcode, nameT);
    const pageD = await login(browser, base, passcode, nameD);

    // ── Tommo creates the meeting ───────────────────────────────────────────
    await pageT.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
    await pageT.type('input[name="track"]', track);
    for (const [i, r] of [1, 2, 3, 4].entries()) await pageT.type(`input[name="race${i + 1}"]`, String(r));
    await pageT.click('form:has(input[name="track"]) button[type="submit"]');
    await pageT.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    meetingId = (await pageT.evaluate(() => window.location.pathname)).split('/')[2] as string;

    const { data: legRows } = await admin.from('legs').select('id, leg_number').eq('meeting_id', meetingId).order('leg_number');
    const legIdByNumber = new Map<number, string>(
      (legRows as Array<{ id: string; leg_number: number }>).map((l) => [l.leg_number, l.id]),
    );

    const tokenT = await sessionTokenOf(pageT);
    const tokenD = await sessionTokenOf(pageD);
    check('both punters have a usable session', tokenT !== null && tokenD !== null);

    const { data: profs } = await admin.from('profiles').select('id, display_name').in('display_name', [nameT, nameD]);
    const idOf = (n: string): string =>
      ((profs ?? []) as Array<{ id: string; display_name: string }>).find((p) => p.display_name === n)?.id ?? '';
    const tommoId = idOf(nameT);
    const davoId = idOf(nameD);

    // ── Both slips go in, each written with that punter's OWN session ───────
    // (M5 already proved the tap-by-tap UI path; 28 picks are entered here
    // through each user's own JWT so RLS still gates every row.)
    async function submitSlip(token: string, userId: string, slip: Record<number, number[]>): Promise<number> {
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
      return ((await res.json()) as unknown[]).length;
    }

    const tCount = await submitSlip(tokenT as string, tommoId, TOMMO_SLIP);
    const dCount = await submitSlip(tokenD as string, davoId, DAVO_SLIP);
    check("Tommo's six-wide slip stored: 24 selections", tCount === 24, `${tCount} rows`);
    check("Davo's one-dart slip stored: 4 selections", dCount === 4, `${dCount} rows`);

    // ── Lock through the UI ─────────────────────────────────────────────────
    await pageT.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await pageT.waitForFunction(() => /Your tips:\s*24/.test(document.body.innerText), { timeout: 20000 });
    await pageT.click('button::-p-text(Lock picks)');
    await pageT.waitForFunction(() => document.body.innerText.includes('Picks are locked'), { timeout: 20000 });
    const { data: locked } = await admin.from('meetings').select('status').eq('id', meetingId).single();
    check('R5: locking sets status=locked in the database', (locked as { status: string }).status === 'locked');

    const settleLinkVisible = await pageT.evaluate(() => document.body.innerText.includes('Enter results'));
    check('R5: a locked meeting offers "Enter results"', settleLinkVisible);

    // ── Settle screen rejects bad input ─────────────────────────────────────
    await pageT.goto(`${base}/meetings/${meetingId}/settle`, { waitUntil: 'networkidle0' });
    await pageT.waitForSelector('input[name="winner1"]');

    const badCases: Array<{ label: string; field: string; value: string; expect: string }> = [
      { label: 'winner number "abc" (not a number)', field: 'winner1', value: 'abc', expect: 'whole number' },
      { label: 'winner number "1.5" (not whole)', field: 'winner1', value: '1.5', expect: 'whole number' },
      { label: 'winner number "-5" (negative)', field: 'winner1', value: '-5', expect: 'whole number' },
      { label: 'winner number "0" (below the field)', field: 'winner1', value: '0', expect: 'not in the field' },
      { label: 'winner number "100" (above the field)', field: 'winner1', value: '100', expect: 'not in the field' },
      { label: 'SP "abc" (not a number)', field: 'sp1', value: 'abc', expect: 'must be a number' },
      { label: 'SP "0" (not positive)', field: 'sp1', value: '0', expect: 'positive number' },
      { label: 'SP "-3.5" (negative)', field: 'sp1', value: '-3.5', expect: 'positive number' },
      { label: 'SP "1.00" (not above evens)', field: 'sp1', value: '1.00', expect: 'above 1.00' },
    ];

    const readAlert = async (): Promise<string> =>
      pageT.evaluate(() => (document.querySelector('[role="alert"]') as HTMLElement | null)?.innerText ?? '');

    for (const bad of badCases) {
      await pageT.waitForSelector('input[name="winner1"]');
      // The previous rejection's message stays on screen until this one
      // resolves. Without waiting for it to actually CHANGE, a later case can
      // match the earlier case's text and score itself a false pass.
      const previous = await readAlert();
      const vals = { ...goodSettleValues(), [bad.field]: bad.value };
      await fillSettle(pageT, vals);
      await submitSettle(pageT);

      const changed = await pageT
        .waitForFunction(
          (prev: string) => {
            const el = document.querySelector('[role="alert"]');
            return el !== null && (el as HTMLElement).innerText !== prev;
          },
          { timeout: 20000 },
          previous,
        )
        .then(() => true)
        .catch(() => false);

      const alertText = await readAlert();
      check(
        `settle rejects ${bad.label}`,
        changed && alertText.includes(bad.expect),
        alertText === '' ? '(no alert)' : alertText,
      );
    }

    // Nothing above may have settled the meeting or written a winner.
    const { data: stillLocked } = await admin.from('meetings').select('status').eq('id', meetingId).single();
    check(
      'settle rejections leave the meeting locked, never half-settled',
      (stillLocked as { status: string }).status === 'locked',
      (stillLocked as { status: string }).status,
    );
    const { data: legsAfterBad } = await admin.from('legs').select('winner_number, winner_sp').eq('meeting_id', meetingId);
    check(
      'settle rejections wrote no winner to any leg',
      (legsAfterBad as Array<{ winner_number: number | null; winner_sp: string | null }>).every(
        (l) => l.winner_number === null && l.winner_sp === null,
      ),
    );

    // A rejected settle must not wipe the twelve fields.
    const keptValues = await pageT.evaluate(() => ({
      winner2: (document.querySelector('[name="winner2"]') as HTMLInputElement).value,
      sp3: (document.querySelector('[name="sp3"]') as HTMLInputElement).value,
    }));
    check(
      'a rejected settle keeps the other legs that were already typed',
      keptValues.winner2 === '2' && keptValues.sp3 === '21.00',
      JSON.stringify(keptValues),
    );

    // ── The real settle ─────────────────────────────────────────────────────
    await pageT.waitForSelector('input[name="winner1"]');
    await fillSettle(pageT, goodSettleValues());
    await submitSettle(pageT);
    const settled = await pageT
      .waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    check('settling a locked meeting redirects back to the meeting screen', settled);

    const { data: settledRow } = await admin.from('meetings').select('status').eq('id', meetingId).single();
    check('settle sets status=settled in the database', (settledRow as { status: string }).status === 'settled');

    const { data: settledLegs } = await admin
      .from('legs')
      .select('leg_number, winner_number, winner_sp')
      .eq('meeting_id', meetingId)
      .order('leg_number');
    const legFacts = (settledLegs ?? []) as Array<{ leg_number: number; winner_number: number; winner_sp: string }>;
    check(
      'winners stored exactly as typed, SP never converted to odds-to-one',
      legFacts.every((l, i) => l.winner_number === DOC.winners[i]!.runner && Number(l.winner_sp) === Number(DOC.winners[i]!.sp)),
      legFacts.map((l) => `L${l.leg_number} #${l.winner_number}@${l.winner_sp}`).join(' · '),
    );

    // ── Authority check: scoreMeeting() vs the document ─────────────────────
    const scoringLegs: ScoringLeg[] = DOC.winners.map((w) => ({
      legNumber: w.leg,
      winnerNumber: w.runner,
      winnerSp: Number(w.sp),
    }));
    const scoringPicks: ScoringPick[] = [];
    for (const [legNumber, runners] of Object.entries(TOMMO_SLIP)) {
      for (const r of runners) scoringPicks.push({ userId: tommoId, legNumber: Number(legNumber), runnerNumber: r });
    }
    for (const [legNumber, runners] of Object.entries(DAVO_SLIP)) {
      for (const r of runners) scoringPicks.push({ userId: davoId, legNumber: Number(legNumber), runnerNumber: r });
    }
    const scored = scoreMeeting(scoringLegs, scoringPicks);
    const sT = scored.find((r) => r.userId === tommoId);
    const sD = scored.find((r) => r.userId === davoId);
    note(`scoreMeeting → Tommo ${JSON.stringify(sT)}`);
    note(`scoreMeeting → Davo  ${JSON.stringify(sD)}`);

    const fmt2 = (n: number): string => n.toFixed(2);
    check(
      'scoreMeeting agrees with docs/scoring-examples.md for Tommo (24 tips, 4 hits, $40.30, +$16.30)',
      sT !== undefined &&
        sT.selections === DOC.tommo.tips &&
        fmt2(sT.outlay) === DOC.tommo.outlay &&
        sT.legsHit === DOC.tommo.legsHit &&
        fmt2(sT.return) === DOC.tommo.ret &&
        `+${fmt2(sT.profit)}` === DOC.tommo.profit &&
        sT.fullCover === DOC.tommo.fullCover &&
        sT.soloLegs === DOC.tommo.soloLegs,
    );
    check(
      'scoreMeeting agrees with docs/scoring-examples.md for Davo (4 tips, 2 hits, $36.00, +$32.00)',
      sD !== undefined &&
        sD.selections === DOC.davo.tips &&
        fmt2(sD.outlay) === DOC.davo.outlay &&
        sD.legsHit === DOC.davo.legsHit &&
        fmt2(sD.return) === DOC.davo.ret &&
        `+${fmt2(sD.profit)}` === DOC.davo.profit &&
        sD.fullCover === DOC.davo.fullCover &&
        sD.soloLegs === DOC.davo.soloLegs,
    );
    check(
      'the document is right about the punchline: Davo out-profits Tommo while Tommo out-hits Davo',
      sD !== undefined && sT !== undefined && sD.profit > sT.profit && sT.legsHit > sD.legsHit,
      `profit ${fmt2(sD?.profit ?? 0)} > ${fmt2(sT?.profit ?? 0)}; legs ${sT?.legsHit} > ${sD?.legsHit}`,
    );

    // ── R5: the rendered result table must match the document ──────────────
    await pageT.waitForFunction(() => document.body.innerText.includes('Result'), { timeout: 20000 });
    const rowT = await resultRow(pageT, nameT);
    const rowD = await resultRow(pageT, nameD);
    note(`rendered Tommo row: ${JSON.stringify(rowT)}`);
    note(`rendered Davo  row: ${JSON.stringify(rowD)}`);

    // Columns: Punter | Tips | Out | Hit | Ret | P/L | Flags
    check(
      'rendered result row for Tommo matches the hand-computed document exactly',
      rowT !== null &&
        rowT[1] === String(DOC.tommo.tips) &&
        rowT[2] === `$${DOC.tommo.outlay}` &&
        rowT[3] === `${DOC.tommo.legsHit}/4` &&
        rowT[4] === `$${DOC.tommo.ret}` &&
        rowT[5] === DOC.tommo.profit,
      JSON.stringify(rowT),
    );
    check(
      'rendered result row for Davo matches the hand-computed document exactly',
      rowD !== null &&
        rowD[1] === String(DOC.davo.tips) &&
        rowD[2] === `$${DOC.davo.outlay}` &&
        rowD[3] === `${DOC.davo.legsHit}/4` &&
        rowD[4] === `$${DOC.davo.ret}` &&
        rowD[5] === DOC.davo.profit,
      JSON.stringify(rowD),
    );
    check(
      'flags render: Tommo shows full cover + 2 solo legs, Davo shows none',
      rowT !== null && rowD !== null && rowT[6]?.includes('🧹') === true && rowT[6]?.includes('2') === true && rowD[6] === '—',
      `Tommo flags ${JSON.stringify(rowT?.[6])} · Davo flags ${JSON.stringify(rowD?.[6])}`,
    );

    // Ordering is the spec's default: profit descending.
    const order = await pageT.evaluate(() =>
      [...document.querySelectorAll('table tbody tr')].map((r) => (r.querySelector('td') as HTMLElement).innerText.trim()),
    );
    check('result table is sorted by profit descending (Davo above Tommo)', order[0] === nameD && order[1] === nameT, order.join(' → '));

    // The winner + SP are shown on each leg, unconverted.
    const settledText = await pageT.evaluate(() => document.body.innerText);
    check(
      'each leg displays its winner and SP as total return per $1',
      DOC.winners.every((w) => settledText.includes(`#${w.runner}`) && settledText.includes(`$${w.sp}`)),
    );
    check('settled meeting shows the SETTLED badge', /SETTLED/i.test(settledText));

    // ── Davo's screen shows the same table (no reload trickery) ─────────────
    await pageD.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await pageD.waitForFunction(() => document.body.innerText.includes('Result'), { timeout: 20000 });
    const rowDonD = await resultRow(pageD, nameD);
    check(
      "the other member sees the identical result table on their own screen",
      rowDonD !== null && rowDonD[5] === DOC.davo.profit,
      JSON.stringify(rowDonD),
    );

    // ── Settling twice must not be possible ────────────────────────────────
    await pageT.goto(`${base}/meetings/${meetingId}/settle`, { waitUntil: 'networkidle0' });
    const bouncedTo = await pageT.evaluate(() => window.location.pathname);
    check(
      'the settle screen refuses an already-settled meeting',
      bouncedTo === `/meetings/${meetingId}`,
      bouncedTo,
    );

    const wide = await pageT.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    );
    check('R6: settled meeting screen has no horizontal scroll at 390px', wide <= 391, `scrollWidth=${wide}`);
  } finally {
    if (meetingId !== '') {
      await admin.from('meetings').delete().eq('id', meetingId);
      console.log(`[cleanup] removed test meeting ${meetingId}`);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} M6 checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
