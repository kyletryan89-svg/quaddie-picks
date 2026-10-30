// Identity check against a RUNNING server (dev or preview).
//
// Run: BASE_URL=http://localhost:3000 npm run test:auth
//
// The passcode gate is gone. A fresh browser lands in the app, saving a name
// creates exactly one profile, and /login does not exist. Cron is not covered
// here — see scripts/smoke-test.ts.

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
    console.error(`Missing env var ${key}. Usage: BASE_URL=… npm run test:auth`);
    process.exit(2);
  }
  return raw;
}

async function saveName(page: import('puppeteer').Page, base: string, name: string): Promise<void> {
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[name="displayName"]', { timeout: 15000 });
  await page.click('input[name="displayName"]');
  await page.type('input[name="displayName"]', name);
  await Promise.all([
    page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 15000 }, name),
    page.click('button[data-testid="save-name"]'),
  ]);
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL').replace(/\/+$/, '');
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const stamp = Date.now().toString().slice(-6);
  const goodName = `R3 Tester ${stamp}`;

  {
    const { data: stale } = await admin.from('profiles').select('id').like('display_name', 'R3 %');
    for (const p of stale ?? []) {
      await admin.from('profiles').delete().eq('id', p.id);
      await admin.auth.admin.deleteUser(p.id);
    }
  }

  const browser = await puppeteer.launch({ headless: true });
  let userId: string | undefined;
  try {
    {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const resp = await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
      const path = new URL(page.url()).pathname;
      const body = await page.evaluate(() => document.body.innerText);
      const html = await page.content();
      check('fresh visit stays on /', path === '/' && (resp?.status() ?? 0) < 400, `landed on ${path}`);
      check('fresh visit has no passcode prompt', !/passcode/i.test(body) && !html.includes('name="passcode"'));
      check('name field is on the page', html.includes('name="displayName"'));
      await context.close();
    }

    {
      const res = await fetch(`${base}/login`, { redirect: 'manual' });
      check('GET /login is not a login page', res.status === 404, `status ${res.status}`);
    }

    {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await saveName(page, base, goodName);

      check('saving a name stays on /', new URL(page.url()).pathname === '/');

      const rows = await admin.from('profiles').select('id, display_name').eq('display_name', goodName);
      const data = rows.data ?? [];
      check('exactly ONE profile row created for the member', data.length === 1, `rows=${data.length}`);
      userId = data[0]?.id;

      await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
      const afterReload = new URL(page.url()).pathname;
      const header = await page.evaluate(() => document.body.innerText);
      check('session persists across reload (still on /)', afterReload === '/');
      check('header shows the saved display name', header.includes(goodName));
      await context.close();
    }

    {
      const fakeId = '11111111-1111-1111-1111-111111111111';
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const resp = await page.goto(`${base}/meetings/${fakeId}`, { waitUntil: 'networkidle0' });
      const finalPath = new URL(page.url()).pathname;
      const body = await page.evaluate(() => document.body.innerText);
      check(
        'opening a meeting does not redirect to /login',
        finalPath !== '/login' && !/passcode/i.test(body) && (resp?.status() ?? 0) < 500,
        `landed on ${finalPath}`,
      );
      await context.close();
    }
  } finally {
    if (userId !== undefined) {
      await admin.from('profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
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
