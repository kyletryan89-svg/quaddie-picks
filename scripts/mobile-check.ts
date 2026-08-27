// Mobile usability checks — rubric R6, at 390px (iPhone 12/13/14 width).
//
// Run: BASE_URL=http://localhost:3000 npm run test:mobile
//
// Verifies, all in a 390×844 viewport:
//   - no horizontal scroll on login / meetings list / meeting screen / ladder
//   - adding a pick is ≤3 interactions from the meeting screen (type #, type
//     name [optional], tap Add)
//   - who-picked-what is legible without tapping (picker initials on each tip)
//   - your tips/outlay counter is visible WHILE picking (pre-settle)
//   - a duplicate pick surfaces a visible inline error, never silence

import puppeteer, { type Page } from 'puppeteer';
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
    console.error(`Missing env var ${key}. Usage: BASE_URL=… GROUP_PASSCODE=… npm run test:mobile`);
    process.exit(2);
  }
  return raw;
}

async function horizontalScrollWidth(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL').replace(/\/+$/, '');
  const passcode = requireEnv('GROUP_PASSCODE');
  const stamp = Date.now().toString().slice(-6);

  const browser = await puppeteer.launch({ headless: true });
  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    // Login screen at 390px.
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
    let w = await horizontalScrollWidth(page);
    check('login fits 390px with no horizontal scroll', w <= 391, `scrollWidth=${w}`);

    // Log in.
    await page.type('input[name="displayName"]', `Mobile Meg ${stamp}`);
    await page.type('input[name="passcode"]', passcode);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForFunction(() => window.location.pathname === '/', { timeout: 15000 });

    w = await horizontalScrollWidth(page);
    check('meetings list fits 390px with no horizontal scroll', w <= 391, `scrollWidth=${w}`);

    const hasListContent = await page.evaluate(() => document.body.innerText.includes('This season'));
    check('meetings list renders content or an explicit empty state', hasListContent);

    // Create a meeting through the UI.
    await page.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
    await page.type('input[name="track"]', `Mobile Park ${stamp}`);
    for (const r of ['1', '2', '3', '4']) await page.type(`input[name="race${r}"]`, r);
    await page.click('button::-p-text(Create meeting)');
    await page.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 15000 });

    w = await horizontalScrollWidth(page);
    check('meeting screen fits 390px with no horizontal scroll', w <= 391, `scrollWidth=${w}`);

    // Adding a pick: the form is right there under each leg — number, optional
    // name, Add ⇒ 2–3 interactions, zero navigation.
    const inputCount = await page.$$eval('input[aria-label^="Runner number for leg"]', (els) => els.length);
    check('pick form is inline on the meeting screen (≤3 taps to add)', inputCount === 4, `${inputCount} leg forms`);
    await page.type('input[aria-label="Runner number for leg 1"]', '4');
    await page.type('input[aria-label="Runner name for leg 1"]', 'Mobility');
    // Each leg's add-form has its own submit button; the first belongs to leg 1.
    await page.click('form button[type="submit"]');

    await page.waitForFunction(() => document.body.innerText.includes('Mobility'), { timeout: 10000 });
    check('added pick appears immediately', true);

    // Counter visible while picking (meeting still open).
    const counterVisible = await page.evaluate(() => /Your tips:\s*1/.test(document.body.innerText));
    check('tips/outlay counter visible while picking', counterVisible);

    // Who-picked-what: initials chip on the row.
    const chip = await page.evaluate(() => document.body.innerText.includes('MM'));
    check('picker initials shown on the tip row (who-picked at a glance)', chip);

    // Duplicate pick → visible error, not silence.
    await page.type('input[aria-label="Runner number for leg 1"]', '4');
    await page.click('form button[type="submit"]');
    const dupError = await page
      .waitForFunction(() => document.body.innerText.includes('already have'), { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check('duplicate pick shows a visible inline error', dupError);

    // Ladder at 390px.
    await page.goto(`${base}/leaderboard`, { waitUntil: 'networkidle0' });
    w = await horizontalScrollWidth(page);
    check('ladder fits 390px with no horizontal scroll', w <= 391, `scrollWidth=${w}`);

    await context.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} mobile checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
