// Auth flow test — rubric R3, against a RUNNING server (dev or preview).
//
// Run: BASE_URL=http://localhost:3000 npm run test:auth
//
// R3.1 wrong passcode → no session, no profile row, no new auth user
// R3.2 correct passcode → exactly one profile row, session persists across reload
// R3.3 unauthenticated request to /meetings/[id] redirects to /login

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
    console.error(`Missing env var ${key}. Usage: BASE_URL=… GROUP_PASSCODE=… npm run test:auth`);
    process.exit(2);
  }
  return raw;
}

async function submitLogin(page: import('puppeteer').Page, base: string, name: string, passcode: string): Promise<void> {
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
  // Service role is used ONLY to inspect/clean auth+profile state around the flow.
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const stamp = Date.now().toString().slice(-6);
  const badName = `R3 Intruder ${stamp}`;
  const goodName = `R3 Tester ${stamp}`;

  // Sweep leftovers from any previously crashed run so counts stay truthful.
  {
    const { data: stale } = await admin.from('profiles').select('id').like('display_name', 'R3 %');
    for (const p of stale ?? []) {
      await admin.from('profiles').delete().eq('id', p.id);
      await admin.auth.admin.deleteUser(p.id);
    }
  }

  const browser = await puppeteer.launch({ headless: true });
  try {
    // ── R3.1: wrong passcode writes nothing ──
    {
      const usersBefore = await admin.auth.admin.listUsers({ perPage: 1000 });
      const countBefore = usersBefore.data?.users.length ?? 0;

      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await submitLogin(page, base, badName, `wrong-${passcode}`);

      const stillOnLogin = new URL(page.url()).pathname === '/login';
      const body = await page.evaluate(() => document.body.innerText);
      check('wrong passcode stays on /login with visible error', stillOnLogin && body.includes('Wrong passcode'));

      const profiles = await admin.from('profiles').select('id').eq('display_name', badName);
      check('wrong passcode creates NO profile row', (profiles.data ?? []).length === 0);

      const usersAfter = await admin.auth.admin.listUsers({ perPage: 1000 });
      const countAfter = usersAfter.data?.users.length ?? 0;
      check('wrong passcode creates NO auth user', countAfter === countBefore, `before=${countBefore} after=${countAfter}`);
      await context.close();
    }

    // ── R3.2: correct passcode → exactly one profile row + session persists ──
    let userId: string | undefined;
    {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await submitLogin(page, base, goodName, passcode);

      const onHome = new URL(page.url()).pathname === '/';
      check('correct passcode lands on the meetings list (/)', onHome);

      const rows = await admin.from('profiles').select('id, display_name').eq('display_name', goodName);
      const data = rows.data ?? [];
      check('exactly ONE profile row created for the member', data.length === 1, `rows=${data.length}`);
      userId = data[0]?.id;

      // Reload: layout guard must accept the existing session (no bounce to /login).
      await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
      const afterReload = new URL(page.url()).pathname;
      check('session persists across reload (no redirect to /login)', afterReload === '/');

      // Header shows the display name.
      const header = await page.evaluate(() => document.body.innerText);
      check('header shows the signed-in display name', header.includes(goodName));

      // Sign out via the header button. Server actions soft-navigate, so wait
      // for the pathname to change rather than for a document navigation event.
      const signOutButton = await page.$('button::-p-text(Out)');
      if (signOutButton === null) throw new Error('sign-out button not found');
      await signOutButton.click();
      await page.waitForFunction(() => window.location.pathname === '/login', { timeout: 15000 });
      const afterSignOut = new URL(page.url()).pathname;
      check('sign out returns to /login', afterSignOut === '/login');
      await context.close();
    }

    // ── R3.3: unauthenticated request to a protected route redirects ──
    {
      const fakeId = '11111111-1111-1111-1111-111111111111';
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const resp = await page.goto(`${base}/meetings/${fakeId}`, { waitUntil: 'networkidle0' });
      const finalPath = new URL(page.url()).pathname;
      check(
        'unauthenticated /meetings/[id] redirects to /login',
        finalPath === '/login' && (resp?.status() ?? 0) < 400,
        `landed on ${finalPath}`,
      );
      await context.close();
    }

    // cleanup
    if (userId !== undefined) {
      await admin.from('profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} auth checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
