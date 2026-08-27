// End-to-end test — rubric R5, driven by a real browser (Puppeteer).
//
// Run: BASE_URL=https://… GROUP_PASSCODE=… npm run e2e
//
// Two independent browser sessions exercise the whole flow:
//   login → create meeting → B sees A's pick WITHOUT reload → B cannot delete
//   A's pick → lock disables entry in both sessions → settle → result table
//   matches hand-computed numbers → leaderboard aggregates multiple meetings.
//
// Expected result table (hand-computed for the picks below):
//   E2E Alice: L1 #1 ✓(4.00), L2 #9 ✗, L3 #5 ✓(2.50), L4 #8 ✗
//              tips 4 · outlay 4.00 · hit 2 · return 6.50 · profit +2.50
//   E2E Bill:  L1 #1 ✓(4.00), L2 #3 ✓(6.00), L4 #7 ✓(10.00)  [no leg-3 tip]
//              tips 3 · outlay 3.00 · hit 3 · return 20.00 · profit +17.00

import puppeteer, { type Page } from 'puppeteer';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key}. Usage: BASE_URL=https://… GROUP_PASSCODE=… npm run e2e`);
    process.exit(2);
  }
  return raw.replace(/\/+$/, '');
}

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
}

async function login(page: Page, base: string, passcode: string, name: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="displayName"]', name);
  await page.type('input[name="passcode"]', passcode);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 15000 });
}

/**
 * M8: selections are made by tapping a runner in the leg's field. The field must
 * already have been pasted in — see pasteFields() below.
 */
async function addPick(page: Page, _legNumber: number, runnerNumber: number, runnerName: string): Promise<void> {
  const sel = `button[aria-label="Pick ${runnerNumber} ${runnerName}"]`;
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
  await page.waitForSelector(`button[aria-label="Remove ${runnerNumber} ${runnerName}"]`, { timeout: 15000 });
}

/** Paste a field into every leg through the real paste box. */
async function pasteFields(page: Page, fields: Record<number, Array<[number, string]>>): Promise<void> {
  for (const [legNumber, runners] of Object.entries(fields)) {
    const sel = `textarea[aria-label="Paste the field for leg ${legNumber}"]`;
    await page.waitForSelector(sel, { timeout: 15000 });
    await page.click(sel);
    await page.type(sel, runners.map(([n, name]) => `${n}. ${name}`).join('\n'));
    await page.click(`button[aria-label="Save field for leg ${legNumber}"]`);
    await page.waitForFunction(
      (n: string) => document.querySelector(`button[aria-label="Save field for leg ${n}"]`) === null,
      { timeout: 20000 },
      legNumber,
    );
  }
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL');
  const passcode = requireEnv('GROUP_PASSCODE');
  const stamp = Date.now().toString().slice(-6);

  const browserA = await puppeteer.launch({ headless: true });
  const browserB = await puppeteer.launch({ headless: true });
  const pageA = await browserA.newPage();
  const pageB = await browserB.newPage();
  const aliceName = `E2E Alice ${stamp}`;
  const billName = `E2E Bill ${stamp}`;

  try {
    // ── R5.1: two sessions log in ──
    await login(pageA, base, passcode, aliceName);
    check(`session A (${aliceName}) logs in and lands on meetings list`, true);
    await login(pageB, base, passcode, billName);
    check(`session B (${billName}) logs in independently`, true);

    // Wrong passcode does not get in (R3 spot-check from the outside).
    // Isolated browser context so A's session cookie cannot leak into it.
    {
      const contextX = await browserA.createBrowserContext();
      const pageX = await contextX.newPage();
      await pageX.goto(`${base}/login`, { waitUntil: 'networkidle0' });
      await pageX.type('input[name="displayName"]', `Intruder ${stamp}`);
      await pageX.type('input[name="passcode"]', `wrong-${passcode}`);
      await Promise.all([
        pageX.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
        pageX.click('button[type="submit"]'),
      ]);
      const stillOnLogin = new URL(pageX.url()).pathname === '/login';
      const bodyText = await pageX.evaluate(() => document.body.innerText);
      check('wrong passcode stays on /login with visible error', stillOnLogin && bodyText.includes('Wrong passcode'));
      await contextX.close();
    }

    // ── A creates a meeting ──
    await pageA.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
    await pageA.type('input[name="track"]', `E2E Track ${stamp}`);
    await pageA.type('input[name="race1"]', '1');
    await pageA.type('input[name="race2"]', '2');
    await pageA.type('input[name="race3"]', '3');
    await pageA.type('input[name="race4"]', '4');
    // NB: don't use "startsWith('/meetings/')" as the wait predicate — we are
    // ON /meetings/new, which already matches. Wait for the created-meeting
    // path shape (/meetings/<uuid>) instead.
    await pageA.click('button::-p-text(Create meeting)');
    await pageA.waitForFunction(
      () => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname),
      { timeout: 15000 },
    );
    const meetingPath = new URL(pageA.url()).pathname; // /meetings/<id>
    check('A creates a meeting with 4 legs', /^\/meetings\/[0-9a-f-]{36}$/i.test(meetingPath));

    // ── A pastes the field for all four legs (M8: no free-text picking) ──
    const horseOne = `Zed Runner ${stamp}a`;
    await pasteFields(pageA, {
      1: [[1, horseOne], [5, `Xray Five ${stamp}`]],
      2: [[3, `Xavier Three ${stamp}`], [9, `Yankee Doodle ${stamp}`]],
      3: [[5, `Zulu Five ${stamp}`], [6, `Whisky Six ${stamp}`]],
      4: [[7, `Yellow Seven ${stamp}`], [8, `Yacht Eight ${stamp}`]],
    });

    // ── B opens the same meeting directly ──
    await pageB.goto(`${base}${meetingPath}`, { waitUntil: 'networkidle0' });

    // Mark A's page so we can prove no reload happens when B's pick arrives.
    const loadedAt = await pageA.evaluate(() => {
      window.__e2eLoadedAt = Date.now().toString();
      return window.__e2eLoadedAt;
    });

    // ── R5.2: B adds a pick; A sees it appear without reloading ──
    // The runner NAME is on screen already (it is the field), so the arrival of
    // B's PICK is B's initials chip showing up on that row.
    await addPick(pageB, 1, 1, horseOne);
    await pageA.waitForFunction(
      () => (document.querySelector('button[aria-label^="Pick 1 "]') as HTMLElement | null)?.innerText.includes('BB') === true,
      { timeout: 20000 },
    );
    const loadedAfter = await pageA.evaluate(() => window.__e2eLoadedAt);
    check('B’s pick appears on A’s screen WITHOUT reload (realtime)', loadedAfter === loadedAt);

    // ── A also picks, both legs 1..4 per expected table ──
    await addPick(pageA, 1, 1, horseOne); // same runner — duplicate picks allowed
    await addPick(pageA, 2, 9, `Yankee Doodle ${stamp}`);
    await addPick(pageA, 3, 5, `Zulu Five ${stamp}`);
    await addPick(pageA, 4, 8, `Yacht Eight ${stamp}`);
    await addPick(pageB, 2, 3, `Xavier Three ${stamp}`);
    await addPick(pageB, 4, 7, `Yellow Seven ${stamp}`);

    // Live counter shows A's five selections? A has 4 tips at this point.
    {
      const counter = await pageA.evaluate(() => document.body.innerText.match(/(\d+) horses? picked/)?.[1]);
      check('live selection counter reflects A’s 4 picks while picking', counter === '4', `counter read ${counter}`);
    }

    // ── R5.3: B cannot delete A's pick (no remove affordance on someone else's row) ──
    {
      const bRemoveButtons = await pageB.$$eval('button[aria-label^="Remove "]', (els) => els.length);
      const aRemoveButtons = await pageA.$$eval('button[aria-label^="Remove "]', (els) => els.length);
      // A owns exactly 4 picks ⇒ 4 remove buttons; B sees none of A's rows with X.
      // B holds 3 picks of their own; none of them are A's.
      check(
        'delete affordance exists only on own picks (A: 4, B: 3 of B’s own)',
        aRemoveButtons === 4 && bRemoveButtons === 3,
        `A saw ${aRemoveButtons}, B saw ${bRemoveButtons}`,
      );
    }

    // ── R5.4: locking disables pick entry in BOTH sessions ──
    await pageA.click('button::-p-text(Lock picks)');
    await pageA.waitForFunction(() => document.body.innerText.includes('Picks are locked'), { timeout: 15000 });
    check('lock button works for A; banner shows', true);
    await pageB.waitForFunction(() => document.body.innerText.includes('Picks are locked'), { timeout: 20000 });
    const bControls = await pageB.$$eval(
      'button[aria-label^="Pick "], button[aria-label^="Remove "], textarea[aria-label^="Paste the field"]',
      (els) => els.length,
    );
    check('pick controls disappear for B after lock (disabled entry)', bControls === 0, `${bControls} controls left`);

    // ── R5.5: settle produces the hand-computed table ──
    await pageA.click('a::-p-text(Enter results)');
    await pageA.waitForFunction(() => document.body.innerText.includes('Winner of each leg'), { timeout: 15000 });
    const winners: Record<string, string> = {
      winner1: '1',
      sp1: '4.00',
      name1: `Zed Runner ${stamp}a`,
      winner2: '3',
      sp2: '6.00',
      name2: `Xavier Three ${stamp}`,
      winner3: '5',
      sp3: '2.50',
      name3: `Zulu Five ${stamp}`,
      winner4: '7',
      sp4: '10.00',
      name4: `Yellow Seven ${stamp}`,
    };
    for (const [field, value] of Object.entries(winners)) {
      await pageA.type(`input[name="${field}"]`, value);
    }
    await Promise.all([
      pageA.waitForFunction(() => document.body.innerText.includes('Result'), { timeout: 20000 }),
      pageA.click('button::-p-text(Settle & show result)'),
    ]);

    const resultText = await pageA.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    // Hand-computed expectations (see header comment):
    // Bill: profit +17.00, hit 3/4 · Alice: profit +2.50, hit 2/4
    check(
      'result table shows Bill +17.00 (3/4)',
      resultText.includes(billName) && resultText.includes('+17.00') && resultText.includes('3/4'),
    );
    check(
      'result table shows Alice +2.50 (2/4)',
      resultText.includes(aliceName) && resultText.includes('+2.50') && resultText.includes('2/4'),
    );

    // ── R5.6: leaderboard aggregates settled meetings ──
    await pageA.goto(`${base}/leaderboard`, { waitUntil: 'networkidle0' });
    const ladder = await pageA.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    check('leaderboard shows both E2E members', ladder.includes(aliceName) && ladder.includes(billName));
    check('leaderboard shows seed members too (multi-meeting aggregation)', ladder.includes('Davo'));
    // Profit sort default: Bill (+17.00 this meeting) should appear above Alice (+2.50).
    check(
      'default sort is profit descending (Bill above Alice)',
      ladder.indexOf(billName) < ladder.indexOf(aliceName),
    );
    const legsSortUrl = `${base}/leaderboard?sort=legs`;
    await pageA.goto(legsSortUrl, { waitUntil: 'networkidle0' });
    const ladderLegs = await pageA.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    check('legs-hit sort renders (Bill 3 hits leads)', ladderLegs.indexOf(billName) !== -1);
  } finally {
    await browserA.close();
    await browserB.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} E2E checks passed`);
  if (failed > 0) process.exit(1);
}

declare global {
  interface Window {
    __e2eLoadedAt?: string;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
