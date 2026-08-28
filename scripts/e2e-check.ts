// End-to-end check for the feed-driven flow, against a RUNNING server.
//
// Run: BASE_URL=http://localhost:3000 npm run test:e2e
//
// Two real browsers (separate anonymous sessions) log in, land on the live
// Saturday-metro list, open the same meeting, pick runners, watch each other's
// picks arrive over realtime, and chat in the comment box. Cleans up after.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key}. Usage: BASE_URL=… GROUP_PASSCODE=… npm run test:e2e`);
    process.exit(2);
  }
  return raw;
}

async function login(page: import('puppeteer').Page, base: string, name: string, passcode: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="displayName"]', name);
  await page.type('input[name="passcode"]', passcode);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
    page.click('button[type="submit"]'),
  ]);
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL').replace(/\/+$/, '');
  const passcode = requireEnv('GROUP_PASSCODE');
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const stamp = Date.now().toString().slice(-6);
  const nameA = `E2E Ada ${stamp}`;
  const nameB = `E2E Ben ${stamp}`;

  let userA: string | undefined;
  let userB: string | undefined;

  // Sweep leftovers from any previously crashed run so the meeting stays clean.
  {
    const { data: stale } = await admin.from('profiles').select('id').like('display_name', 'E2E %');
    for (const p of stale ?? []) {
      await admin.from('comments').delete().eq('user_id', p.id);
      await admin.from('picks').delete().eq('user_id', p.id);
      await admin.from('profiles').delete().eq('id', p.id);
      await admin.auth.admin.deleteUser(p.id);
    }
  }

  const browser = await puppeteer.launch({ headless: true });
  try {
    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await pageA.setViewport({ width: 390, height: 844 });
    await pageB.setViewport({ width: 390, height: 844 });

    await login(pageA, base, nameA, passcode);
    check('A lands on the meetings list', new URL(pageA.url()).pathname === '/');

    // The list syncs the live feed server-side before streaming, so give it time.
    const meetingLink = await pageA.waitForSelector('main ul li a', { timeout: 30000 }).catch(() => null);
    const listText = await pageA.evaluate(() => document.body.innerText);
    check('list shows real Saturday metro (not seed)', /Rosehill|Randwick|Warwick|Canterbury|Kensington/.test(listText));
    check('list is clean of seed markers', !listText.includes('SEED-') && !listText.includes('No meetings in the'));

    if (meetingLink === null) {
      check('a meeting is listed to open', false, 'no meeting link found');
      throw new Error('no meeting link found');
    }
    const meetingHref = await meetingLink.evaluate((el) => el.getAttribute('href'));
    const meetingPath = meetingHref ?? '';

    await pageA.goto(`${base}${meetingPath}`, { waitUntil: 'networkidle0' });
    await pageA.waitForSelector('main section h2', { timeout: 30000 });
    check('meeting screen opens', new URL(pageA.url()).pathname.startsWith('/meetings/'));

    // Quaddie = four legs; each leg shows the field as tappable runners.
    const legCount = await pageA.evaluate(() =>
      [...document.querySelectorAll('main section h2')].filter((h) => (h.textContent ?? '').startsWith('Leg')).length,
    );
    check('four quaddie legs rendered', legCount === 4, `legs=${legCount}`);

    const runnerButtonsA = await pageA.$$('main section button[aria-label^="Pick "]');
    check('runners are tappable (form guide present)', runnerButtonsA.length > 0, `buttons=${runnerButtonsA.length}`);

    // Form guide detail is on screen (jockey/weight/barrier form line).
    const formLinePresent = await pageA.evaluate(() => /\bB\d+\b|\d+kg|·/.test(document.body.innerText));
    check('form guide detail shown (weight/barrier/form)', formLinePresent);

    // No money framing while picking.
    const hasOutlay = await pageA.evaluate(() => document.body.innerText.toLowerCase().includes('outlay'));
    check('no outlay framing on the picking screen', !hasOutlay);

    // A taps the first runner; picked count goes 0 → 1.
    const before = await pageA.$eval('[data-testid="picked-count"]', (el) => el.textContent ?? '');
    await runnerButtonsA[0]!.click();
    await pageA.waitForFunction(
      (prev) => document.querySelector('[data-testid="picked-count"]')?.textContent !== prev,
      { timeout: 10000 },
      before,
    );
    const after = await pageA.$eval('[data-testid="picked-count"]', (el) => el.textContent ?? '');
    check('tapping a runner increments the pick count', !after.includes('0') && after !== before, `${before} → ${after}`);

    // B opens the same meeting and sees A's pick arrive live (no reload).
    await login(pageB, base, nameB, passcode);
    const pageBOnList = new URL(pageB.url()).pathname === '/';
    check('B lands on the meetings list', pageBOnList);

    const bLink = await pageB.waitForSelector(`main ul li a[href="${meetingPath}"]`, { timeout: 30000 }).catch(() => null);
    if (bLink === null) {
      check('B can open the same meeting', false, `no link to ${meetingPath}`);
    } else {
      await pageB.goto(`${base}${meetingPath}`, { waitUntil: 'networkidle0' });
      await pageB.waitForSelector('main section h2', { timeout: 30000 });
      await pageB.waitForSelector(`abbr[title="${nameA}"]`, { timeout: 15000 });
      check('B sees A’s pick live (realtime)', true);
    }

    // A posts a comment; B sees it arrive live.
    await pageA.type('input[aria-label="Comment"]', 'First Saturday in, gents');
    await pageA.click('button::-p-text(Post)');
    await pageB.waitForFunction(
      (text) => document.body.innerText.includes(text),
      { timeout: 15000 },
      'First Saturday in, gents',
    );
    check('comment posted and seen live by B', true);

    // 390px: no horizontal scroll on either screen.
    const noHScroll = await pageA.evaluate(() => document.documentElement.scrollWidth <= 390);
    check('meeting screen fits 390px with no horizontal scroll', noHScroll);

    const rows = await admin.from('profiles').select('id, display_name').in('display_name', [nameA, nameB]);
    userA = (rows.data ?? []).find((p) => p.display_name === nameA)?.id;
    userB = (rows.data ?? []).find((p) => p.display_name === nameB)?.id;

    await ctxA.close();
    await ctxB.close();
  } finally {
    // Remove the test members' picks/comments so the real meeting stays clean,
    // then the profiles themselves.
    for (const uid of [userA, userB]) {
      if (uid === undefined) continue;
      await admin.from('comments').delete().eq('user_id', uid);
      await admin.from('picks').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} e2e checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
