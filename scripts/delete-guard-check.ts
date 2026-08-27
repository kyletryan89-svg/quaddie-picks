// Security re-verification of the R5 delete guard.
//
// Run: BASE_URL=http://localhost:3000 npm run test:delete-guard
//
// The M5 suite proved B's DELETE returned `HTTP 200 []` and that a SERVICE-ROLE
// read still saw the row. That is suggestive but not conclusive: an empty
// PostgREST body only says RLS matched no row for B, and a service-role read
// bypasses RLS entirely. Neither shows the row is still there for the people
// who are supposed to see it.
//
// So this reads the pick back **as user A, through A's own session and RLS**,
// and separately confirms it is still on A's screen and still countable in A's
// outlay. If B's delete had actually landed, every one of those goes away.

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
  await page.setViewport({ width: 390, height: 844 });
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

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL').replace(/\/+$/, '');
  const passcode = requireEnv('GROUP_PASSCODE');
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now().toString().slice(-6);
  const track = `Guard Park ${stamp}`;
  const nameA = `Ann ${stamp} Archer`;
  const nameB = `Baz ${stamp} Blake`;

  const browser = await puppeteer.launch({ headless: true });
  let meetingId = '';
  try {
    const pageA = await login(browser, base, passcode, nameA);
    const pageB = await login(browser, base, passcode, nameB);

    // A creates the meeting and puts one pick in leg 1.
    await pageA.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
    await pageA.type('input[name="track"]', track);
    for (const [i, r] of [1, 2, 3, 4].entries()) await pageA.type(`input[name="race${i + 1}"]`, String(r));
    await pageA.click('form:has(input[name="track"]) button[type="submit"]');
    await pageA.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
    meetingId = (await pageA.evaluate(() => window.location.pathname)).split('/')[2] as string;

    // M8: leg 1 needs a field, then A taps runner #9 to select it.
    const tokenA = (await sessionTokenOf(pageA)) as string;
    const { data: legRows } = await admin.from('legs').select('id, leg_number').eq('meeting_id', meetingId).order('leg_number');
    const leg1Id = (legRows as Array<{ id: string; leg_number: number }>).find((l) => l.leg_number === 1)!.id;
    await pasteField({ url, anonKey, token: tokenA, legId: leg1Id, runners: [{ number: 9, name: 'Guarded Gelding' }, ...fieldFor([1, 2, 3])] });

    await pageA.reload({ waitUntil: 'networkidle0' });
    await pageA.waitForSelector('button[aria-label="Pick 9 Guarded Gelding"]');
    await pageA.click('button[aria-label="Pick 9 Guarded Gelding"]');
    await pageA.waitForFunction(() => /\b1 horse picked/.test(document.body.innerText), { timeout: 15000 });

    const { data: aProfile } = await admin.from('profiles').select('id').eq('display_name', nameA).single();
    const aUserId = (aProfile as { id: string }).id;
    const { data: aPicks } = await admin.from('picks').select('id, runner_id').eq('user_id', aUserId);
    const aPickId = ((aPicks ?? [])[0] as { id: string } | undefined)?.id ?? '';
    check("A's pick exists before the attack", aPickId !== '', `pick ${aPickId}`);

    // ── B attacks: a real DELETE carrying B's own session JWT ────────────────
    await pageB.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    const bToken = await sessionTokenOf(pageB);
    check("B's session JWT recovered, so the attack is genuine", bToken !== null);

    const del = await fetch(`${url}/rest/v1/picks?id=eq.${aPickId}`, {
      method: 'DELETE',
      headers: { apikey: anonKey, Authorization: `Bearer ${bToken ?? ''}`, Prefer: 'return=representation' },
    });
    note(`B's DELETE → HTTP ${del.status} ${JSON.stringify((await del.text()).slice(0, 120))}`);

    // ── THE POINT: read it back AS USER A, through A's own session and RLS ───
    const aToken = await sessionTokenOf(pageA);
    check("A's session JWT recovered, so the read-back is genuinely user A", aToken !== null);

    const asA = await fetch(
      `${url}/rest/v1/picks?id=eq.${aPickId}&select=id,user_id,runners(runner_number,runner_name)`,
      {
        headers: { apikey: anonKey, Authorization: `Bearer ${aToken ?? ''}` },
      },
    );
    const rowsAsA = (await asA.json()) as Array<{
      id: string;
      user_id: string;
      runners: { runner_number: number; runner_name: string | null } | null;
    }>;
    note(`A's read-back → HTTP ${asA.status} ${JSON.stringify(rowsAsA)}`);

    check(
      'SELECT as user A returns the pick B tried to delete — the row genuinely survived',
      rowsAsA.length === 1 && rowsAsA[0]?.id === aPickId,
      `${rowsAsA.length} row(s) visible to A`,
    );
    check(
      "the surviving row is intact: still A's, still runner #9",
      rowsAsA[0]?.user_id === aUserId &&
        rowsAsA[0]?.runners?.runner_number === 9 &&
        rowsAsA[0]?.runners?.runner_name === 'Guarded Gelding',
      JSON.stringify(rowsAsA[0] ?? null),
    );

    // A cold reload proves it is served from the database, not React state.
    await pageA.reload({ waitUntil: 'networkidle0' });
    await pageA.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const aText = await pageA.evaluate(() => document.body.innerText);
    check(
      "after a full reload A's pick is still rendered from the database",
      aText.includes('Guarded Gelding'),
    );
    check(
      "A's picked count still counts the pick (1 horse picked)",
      /\b1 horse picked/.test(aText),
      aText.split('\n').filter((l) => /picked/.test(l)).join(' / '),
    );

    // And B — the attacker — can still see it too.
    await pageB.reload({ waitUntil: 'networkidle0' });
    await pageB.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    check(
      "B still sees A's pick after B's own delete attempt",
      (await pageB.evaluate(() => document.body.innerText)).includes('Guarded Gelding'),
    );
  } finally {
    if (meetingId !== '') {
      await admin.from('meetings').delete().eq('id', meetingId);
      console.log(`[cleanup] removed test meeting ${meetingId}`);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} delete-guard checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
