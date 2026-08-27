// M5 verification — meeting screen: picks CRUD, realtime, live outlay counter.
// Rubric R5 (functional flow) + R6 (usability).
//
// Run: BASE_URL=http://localhost:3000 npm run test:m5
//
// Drives TWO independent browser sessions (separate contexts = separate cookie
// jars = separate anonymous users) against the live hosted Supabase project.
// Nothing here is asserted from reading source: realtime is proved by watching
// B's DOM change while B never navigates, and the delete guard is proved by
// firing a real DELETE from B's own authenticated browser client.

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { fieldFor, pasteField } from './test-field';
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

/** Tap a runner in the leg's field. M8 removed free-text entry entirely. */
function runnerButton(number: number, name: string, taken: boolean): string {
  return `button[aria-label="${taken ? 'Remove' : 'Pick'} ${number} ${name}"]`;
}

async function scrollWidth(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
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

/** Select a runner by tapping it, exactly as a member does. */
async function tapRunner(page: Page, number: number, name: string): Promise<void> {
  const sel = runnerButton(number, name, false);
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
}

/** Deselect one you already have — the same row, tapped again. */
async function untapRunner(page: Page, number: number, name: string): Promise<void> {
  const sel = runnerButton(number, name, true);
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
}

/**
 * The access token for a page's Supabase session. @supabase/ssr keeps the
 * session in cookies (chunked as `.0`, `.1`, … and tagged `base64-`), so this
 * reassembles it rather than guessing at localStorage.
 */
async function sessionTokenOf(page: Page): Promise<string | null> {
  const cookies = await page.cookies();
  const parts = cookies
    .filter((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (parts.length === 0) return null;
  let raw = decodeURIComponent(parts.map((c) => c.value).join(''));
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

/** Counts a page's full navigations, so "without reloading" is a measured fact. */
function trackNavigations(page: Page): () => number {
  let n = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) n += 1;
  });
  return () => n;
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL').replace(/\/+$/, '');
  const passcode = requireEnv('GROUP_PASSCODE');
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const stamp = Date.now().toString().slice(-6);
  const track = `M5 Park ${stamp}`;
  // initialsOf() takes first-word + last-word initials, so keep the unique
  // stamp in the MIDDLE — these must render as "AA" and "BB".
  const nameA = `Alice ${stamp} Anderson`;
  const nameB = `Bob ${stamp} Brown`;

  const browser = await puppeteer.launch({ headless: true });
  let meetingId = '';
  try {
    // ── R5: two sessions, different names, both log in ──────────────────────
    const pageA = await login(browser, base, passcode, nameA);
    const pageB = await login(browser, base, passcode, nameB);
    const onA = await bodyText(pageA);
    const onB = await bodyText(pageB);
    check('R5: two browser sessions with different names can both log in', onA.includes(nameA.slice(0, 10)) && onB.includes(nameB.slice(0, 10)));

    const { data: profs } = await admin.from('profiles').select('id, display_name').in('display_name', [nameA, nameB]);
    check('R5: both logins created distinct profile rows', (profs ?? []).length === 2, `${(profs ?? []).length} profiles`);

    // ── A creates the meeting both sessions will use ────────────────────────
    await pageA.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
    await pageA.type('input[name="track"]', track);
    for (const [i, r] of [1, 2, 3, 4].entries()) await pageA.type(`input[name="race${i + 1}"]`, String(r));
    await pageA.click('form:has(input[name="track"]) button[type="submit"]');
    await pageA.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    meetingId = (await pageA.evaluate(() => window.location.pathname)).split('/')[2] as string;

    // ── R6: loading + empty states on the meeting screen ────────────────────
    await pageB.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'domcontentloaded' });
    await pageB.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const pasteBoxes = await pageB.$$eval('textarea[aria-label^="Paste the field for leg"]', (els) => els.length);
    check(
      'R6: a leg with no field shows the paste box, not blank space',
      pasteBoxes === 4,
      `${pasteBoxes}/4 legs offer a paste box`,
    );
    const emptyLegs = await bodyText(pageB);

    // ── R6: 390px, and the counter is visible BEFORE any picking ────────────
    const w = await scrollWidth(pageB);
    check('R6: meeting screen has no horizontal scroll at 390px', w <= 391, `scrollWidth=${w}`);
    check(
      'R6: own selection count visible while picking (before settling)',
      /\b0 horses picked/.test(emptyLegs),
      emptyLegs.split('\n').filter((l) => /picked/.test(l)).join(' / '),
    );

    // ── M8: give every leg a real field, then picking is tapping ────────────
    const { data: legRows } = await admin
      .from('legs')
      .select('id, leg_number')
      .eq('meeting_id', meetingId)
      .order('leg_number');
    const legIdByNumber = new Map<number, string>(
      (legRows as Array<{ id: string; leg_number: number }>).map((l) => [l.leg_number, l.id]),
    );
    const tokenA = (await sessionTokenOf(pageA)) as string;
    await pasteField({
      url,
      anonKey,
      token: tokenA,
      legId: legIdByNumber.get(1) as string,
      runners: [{ number: 7, name: 'Winx The Second' }, ...fieldFor([1, 2, 3])],
    });
    for (const legNumber of [2, 3, 4]) {
      await pasteField({
        url,
        anonKey,
        token: tokenA,
        legId: legIdByNumber.get(legNumber) as string,
        runners: fieldFor([3, 7, 11]),
      });
    }

    await pageB.reload({ waitUntil: 'networkidle0' });
    await pageB.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const tappable = await pageB.$$eval('button[aria-label^="Pick "]', (els) => els.length);
    check('R6: every runner in every leg is a tap target (no free text anywhere)', tappable === 13, `${tappable} tappable runners`);
    const freeText = await pageB.$$eval('input[aria-label^="Runner number"], input[aria-label^="Runner name"]', (els) => els.length);
    check('M8: no free-text runner entry remains on the meeting screen', freeText === 0, `${freeText} free-text inputs`);

    // ── R5: A adds a pick, B sees it WITHOUT reloading ──────────────────────
    await pageA.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await pageA.waitForSelector('button[aria-label^="Pick "]');
    await pageA.waitForFunction(() => document.body.innerText.includes('● live'), { timeout: 20000 });
    await pageB.waitForFunction(() => document.body.innerText.includes('● live'), { timeout: 20000 });
    check('R5: both screens report a live realtime subscription', true);

    const navsB = trackNavigations(pageB);
    const navsBefore = navsB();

    await tapRunner(pageA, 7, 'Winx The Second');
    // Since M8 the runner NAME is always on screen — it is the field — so the
    // arrival of A's PICK is A's initials chip appearing on that row, not the
    // name appearing. Waiting on the name would pass without any realtime.
    const bSawIt = await pageB
      .waitForFunction(() => document.body.innerText.includes('AA'), { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("R5: session B sees session A's pick appear WITHOUT reloading", bSawIt);
    check(
      'R5: B received it live — zero page navigations while it arrived',
      navsB() === navsBefore,
      `${navsB() - navsBefore} navigations`,
    );

    // ── R6: who-picked-what legible at a glance, no tapping ─────────────────
    const bView = await bodyText(pageB);
    check(
      "R6: A's initials are on the runner row for B to see at a glance",
      bView.includes('AA'),
      bView.split('\n').filter((l) => l.includes('7') || l.includes('AA')).slice(0, 3).join(' / '),
    );

    // ── R6: counter tracks the OWNER's picks, not everyone's ────────────────
    check(
      "R6: B's counter still reads 0 — it counts B's own picks, not A's",
      /\b0 horses picked/.test(bView),
      bView.split('\n').filter((l) => /picked/.test(l)).join(' '),
    );

    // ── R5/R6: B taps three runners; B's own count moves live ──────────────
    await tapRunner(pageB, 7, 'Winx The Second'); // same runner as A — both score it in full
    await pageB.waitForFunction(() => /\b1 horse picked/.test(document.body.innerText), { timeout: 15000 });
    await tapRunner(pageB, 3, 'Runner 3');
    await tapRunner(pageB, 11, 'Runner 11');
    await pageB.waitForFunction(() => /\b3 horses picked/.test(document.body.innerText), { timeout: 15000 });
    const bAfter = await bodyText(pageB);
    check(
      'R6: the count updates live as picks go in (3 horses picked) and shows no money',
      /\b3 horses picked/.test(bAfter) && !bAfter.includes('$') && !/outlay/i.test(bAfter),
      bAfter.split('\n').filter((l) => /picked/.test(l)).join(' / '),
    );

    // M8 replaces the duplicate-pick error with a toggle: tapping a runner you
    // already hold removes it, so a duplicate is now unrepresentable.
    await untapRunner(pageB, 11, 'Runner 11');
    await pageB.waitForFunction(() => /\b2 horses picked/.test(document.body.innerText), { timeout: 15000 });
    await tapRunner(pageB, 11, 'Runner 11');
    await pageB.waitForFunction(() => /\b3 horses picked/.test(document.body.innerText), { timeout: 15000 });
    check('M8: tapping a runner you already hold removes it, so duplicates cannot happen', true);

    // A and B both on #7 in leg 1 — the row must show BOTH sets of initials.
    const bothChips = await pageB.evaluate(
      () => document.body.innerText.includes('AA') && document.body.innerText.includes('BB'),
    );
    check('R6: duplicate picks show both members on the one runner row', bothChips);

    // ── R5: B cannot delete A's pick ────────────────────────────────────────
    const { data: aPickRows } = await admin
      .from('picks')
      .select('id, user_id')
      .eq('user_id', (profs ?? []).find((p) => (p as { display_name: string }).display_name === nameA)?.id ?? '');
    const aPickId = ((aPickRows ?? [])[0] as { id: string } | undefined)?.id ?? '';
    check("R5: A's pick exists in the database to attempt a delete against", aPickId !== '');

    // (a) B's UI offers a remove action only for B's own picks; A's pick on the
    // shared runner is a chip B cannot act on.
    const removeButtonsOnB = await pageB.$$eval('button[aria-label^="Remove "]', (els) => els.length);
    check(
      "R5: B's UI exposes remove controls only for B's own picks",
      removeButtonsOnB === 3,
      `${removeButtonsOnB} remove controls for B's 3 picks`,
    );

    // (b) The real test: fire a genuine DELETE carrying B's OWN session JWT,
    // lifted out of B's cookie jar. Hiding the button proves nothing; this
    // proves RLS refuses B even when B bypasses the UI entirely.
    const bToken = await sessionTokenOf(pageB);
    check("R5: B's session JWT was recoverable, so the delete is a real attempt", bToken !== null);

    const restDelete = await fetch(`${url}/rest/v1/picks?id=eq.${aPickId}`, {
      method: 'DELETE',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bToken ?? ''}`,
        Prefer: 'return=representation',
      },
    });
    const restBody = (await restDelete.text()).slice(0, 200);
    note(`B's DELETE against A's pick → HTTP ${restDelete.status} ${JSON.stringify(restBody)}`);

    const { data: survived } = await admin.from('picks').select('id').eq('id', aPickId);
    check(
      "R5: session B cannot delete session A's pick (row survives a real DELETE from B's session)",
      (survived ?? []).length === 1 && bToken !== null,
      `${(survived ?? []).length} rows remain; RLS matched no row for B so the delete removed nothing`,
    );

    // A's pick is still on screen for both. The runner NAME is now always shown
    // (it is the field), so the proof is A's initials chip on that row.
    check("R5: A's pick is still visible after B's delete attempt", (await bodyText(pageB)).includes('AA'));

    // ── M5: removing your OWN pick works and propagates live ────────────────
    const navsBefore2 = navsB();
    await pageA.click('button[aria-label="Remove 7 Winx The Second"]');
    const bSawRemoval = await pageB
      .waitForFunction(() => !document.body.innerText.includes('AA'), { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("M5: A removing their own pick disappears from B's screen live", bSawRemoval);
    check('M5: the removal reached B without a reload', navsB() === navsBefore2, `${navsB() - navsBefore2} navigations`);

    const { data: goneRows } = await admin.from('picks').select('id').eq('id', aPickId);
    check('M5: the removed pick is gone from the database', (goneRows ?? []).length === 0);

    // ── R5: locking disables pick entry in BOTH sessions ────────────────────
    // (The lock button lives on this screen; the settle flow itself is M6.)
    const navsBefore3 = navsB();
    await pageA.click('button::-p-text(Lock picks)');
    const bWentReadOnly = await pageB
      .waitForFunction(
        () =>
          document.querySelectorAll('button[aria-label^="Pick "], button[aria-label^="Remove "]').length === 0 &&
          document.querySelectorAll('textarea[aria-label^="Paste the field"]').length === 0,
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);
    check('R5: locking removes pick entry from session B without a reload', bWentReadOnly);
    check('R5: B saw the lock live', navsB() === navsBefore3, `${navsB() - navsBefore3} navigations`);

    const aControlsAfterLock = await pageA.$$eval(
      'button[aria-label^="Pick "], button[aria-label^="Remove "], textarea[aria-label^="Paste the field"]',
      (els) => els.length,
    );
    check('R5: locking removes pick entry from session A too', aControlsAfterLock === 0, `${aControlsAfterLock} controls left`);

    const bLockedText = await bodyText(pageB);
    check(
      "R5: B's badge and banner both report LOCKED (live status, not the stale server prop)",
      /LOCKED/i.test(bLockedText) && bLockedText.includes('Picks are locked'),
      bLockedText.split('\n').filter((l) => /LOCKED|locked/i.test(l)).join(' / '),
    );
    check(
      'R5: B is not wrongly told the meeting is settled',
      !bLockedText.includes('Settled — final numbers below'),
    );

    // Database is the real gate, not the hidden form.
    const { data: lockedMeeting } = await admin.from('meetings').select('status').eq('id', meetingId).single();
    check('R5: the meeting is locked in the database', (lockedMeeting as { status: string }).status === 'locked');

    const wLocked = await scrollWidth(pageB);
    check('R6: locked meeting screen still has no horizontal scroll at 390px', wLocked <= 391, `scrollWidth=${wLocked}`);
  } finally {
    if (meetingId !== '') {
      await admin.from('meetings').delete().eq('id', meetingId);
      console.log(`[cleanup] removed test meeting ${meetingId}`);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} M5 checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
