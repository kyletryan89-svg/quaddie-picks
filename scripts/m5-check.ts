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

/** The add-pick form for a leg — scoped so it can never match the header's sign-out form. */
function addForm(leg: number): string {
  return `form:has(input[aria-label="Runner number for leg ${leg}"])`;
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

/** Add a pick through the UI exactly as a user would. */
async function addPick(page: Page, leg: number, number: string, name?: string): Promise<void> {
  await page.type(`input[aria-label="Runner number for leg ${leg}"]`, number);
  if (name !== undefined) await page.type(`input[aria-label="Runner name for leg ${leg}"]`, name);
  await page.click(`${addForm(leg)} button[type="submit"]`);
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
    const emptyLegs = await bodyText(pageB);
    check(
      'R6: a leg with no picks shows an empty state, not blank space',
      (emptyLegs.match(/No tips yet/g) ?? []).length === 4,
      `${(emptyLegs.match(/No tips yet/g) ?? []).length}/4 legs`,
    );

    // ── R6: 390px, and the counter is visible BEFORE any picking ────────────
    const w = await scrollWidth(pageB);
    check('R6: meeting screen has no horizontal scroll at 390px', w <= 391, `scrollWidth=${w}`);
    check(
      'R6: selections + outlay counter visible while picking (before settling)',
      /Your tips:\s*0/.test(emptyLegs) && /Outlay so far:\s*\$0\.00/.test(emptyLegs),
      emptyLegs.split('\n').filter((l) => /Your tips|Outlay/.test(l)).join(' / '),
    );

    // ── R6: adding a pick is inline — no navigation, ≤3 interactions ────────
    const legForms = await pageB.$$eval('form:has(input[aria-label^="Runner number for leg"])', (els) => els.length);
    check('R6: an inline add-pick form sits under each of the 4 legs', legForms === 4, `${legForms} forms`);

    // ── R5: A adds a pick, B sees it WITHOUT reloading ──────────────────────
    await pageA.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await pageA.waitForSelector('input[aria-label="Runner number for leg 1"]');
    await pageA.waitForFunction(() => document.body.innerText.includes('● live'), { timeout: 20000 });
    await pageB.waitForFunction(() => document.body.innerText.includes('● live'), { timeout: 20000 });
    check('R5: both screens report a live realtime subscription', true);

    const navsB = trackNavigations(pageB);
    const navsBefore = navsB();

    await addPick(pageA, 1, '7', 'Winx The Second');
    const bSawIt = await pageB
      .waitForFunction(() => document.body.innerText.includes('Winx The Second'), { timeout: 20000 })
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
      "R6: B's counter still reads 0 — it counts B's own tips, not A's",
      /Your tips:\s*0/.test(bView),
      bView.split('\n').filter((l) => /Your tips/.test(l)).join(' '),
    );

    // ── R5/R6: B adds picks; B's own counter and outlay move live ───────────
    await addPick(pageB, 1, '7'); // same runner as A — duplicates are legal, both score
    await pageB.waitForFunction(() => /Your tips:\s*1/.test(document.body.innerText), { timeout: 15000 });
    await addPick(pageB, 2, '3');
    await addPick(pageB, 3, '11');
    await pageB.waitForFunction(() => /Your tips:\s*3/.test(document.body.innerText), { timeout: 15000 });
    const bAfter = await bodyText(pageB);
    check(
      'R6: counter and outlay update live as picks go in (3 tips → $3.00)',
      /Your tips:\s*3/.test(bAfter) && /Outlay so far:\s*\$3\.00/.test(bAfter),
      bAfter.split('\n').filter((l) => /Your tips|Outlay/.test(l)).join(' / '),
    );

    // Duplicate runner in the same leg for the same user → visible error.
    await addPick(pageB, 1, '7');
    const dupErr = await pageB
      .waitForFunction(() => {
        const alerts = [...document.querySelectorAll('[role="alert"]')];
        return alerts.some((a) => (a as HTMLElement).innerText.includes('already have'));
      }, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check('R6: a duplicate pick surfaces a visible inline error, never a silent console log', dupErr);

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

    // (a) B's UI offers no remove control for A's pick.
    const removeButtonsOnB = await pageB.$$eval('button[aria-label^="Remove your tip"]', (els) => els.length);
    check(
      "R5: B's UI exposes remove controls only for B's own tips",
      removeButtonsOnB === 3,
      `${removeButtonsOnB} remove buttons for B's 3 tips`,
    );

    // (b) The real test: fire a genuine DELETE carrying B's OWN session JWT,
    // lifted out of B's cookie jar. Hiding the button proves nothing; this
    // proves RLS refuses B even when B bypasses the UI entirely.
    const bToken = await sessionTokenOf(pageB);
    check("R5: B's session JWT was recoverable, so the delete is a real attempt", bToken !== null);

    const restDelete = await fetch(`${url}/rest/v1/picks?id=eq.${aPickId}`, {
      method: 'DELETE',
      headers: {
        apikey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
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

    // A's pick is still on screen for both.
    check("R5: A's pick is still visible after B's delete attempt", (await bodyText(pageB)).includes('Winx The Second'));

    // ── M5: removing your OWN pick works and propagates live ────────────────
    const navsBefore2 = navsB();
    await pageA.click('button[aria-label="Remove your tip #7"]');
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
        () => document.querySelectorAll('form:has(input[aria-label^="Runner number for leg"])').length === 0,
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);
    check('R5: locking removes pick entry from session B without a reload', bWentReadOnly);
    check('R5: B saw the lock live', navsB() === navsBefore3, `${navsB() - navsBefore3} navigations`);

    const aFormsAfterLock = await pageA.$$eval('form:has(input[aria-label^="Runner number for leg"])', (els) => els.length);
    check('R5: locking removes pick entry from session A too', aFormsAfterLock === 0, `${aFormsAfterLock} forms left`);

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
