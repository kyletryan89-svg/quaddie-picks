// M11 group-features check — against a RUNNING server.
//
// Run: BASE_URL=http://localhost:3000 npm run test:m11
//
// Covers: rename (WST), picks staying open (including a stored 'locked' row)
// until settled, first/second picks, per-leg comments, and the group chat board
// (including the anonymous user_id omission). Drives two real browsers plus
// service-role and member-session clients for database truth. Cleans up after.

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
    console.error(`Missing env var ${key}. Usage: BASE_URL=… npm run test:m11`);
    process.exit(2);
  }
  return raw;
}

async function login(page: import('puppeteer').Page, base: string, name: string): Promise<void> {
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
  const nameA = `M11 Ada ${stamp}`;
  const nameB = `M11 Ben ${stamp}`;
  const uiTrack = `M11-UI-${stamp}`;
  const rlsTrack = `M11-RLS-${stamp}`;

  let userA: string | undefined;
  let userB: string | undefined;
  let uiMeetingId: string | undefined;
  let uiLeg1Id: string | undefined;
  let rlsMeetingId: string | undefined;
  let rlsLeg1Id: string | undefined;

  // Sweep leftovers from any crashed run.
  {
    const { data: stale } = await admin.from('profiles').select('id').like('display_name', 'M11 %');
    for (const p of stale ?? []) {
      await admin.from('chat_messages').delete().eq('user_id', p.id);
      await admin.from('leg_comments').delete().eq('user_id', p.id);
      await admin.from('comments').delete().eq('user_id', p.id);
      await admin.from('picks').delete().eq('user_id', p.id);
      await admin.from('profiles').delete().eq('id', p.id);
      await admin.auth.admin.deleteUser(p.id);
    }
    await admin.from('meetings').delete().like('track', 'M11-%');
  }

  // ── Fixture: controlled UI meeting with a leg-1 field ──────────────────────
  {
    const m = await admin
      .from('meetings')
      .insert({ track: uiTrack, meeting_date: '2026-08-29', status: 'open' })
      .select('id')
      .single();
    if (m.data === null) throw new Error('could not create UI meeting');
    uiMeetingId = m.data.id as string;
    const legs = await admin
      .from('legs')
      .insert([1, 2, 3, 4].map((n) => ({ meeting_id: uiMeetingId, leg_number: n, race_number: n + 6 })))
      .select('id, leg_number');
    uiLeg1Id = ((legs.data ?? []) as Array<{ id: string; leg_number: number }>).find((l) => l.leg_number === 1)?.id;
    await admin
      .from('runners')
      .insert(
        ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo'].map((name, i) => ({
          leg_id: uiLeg1Id,
          runner_number: i + 1,
          runner_name: name,
        })),
      );
  }

  // ── Fixture: RLS meeting for open / locked / settled pick rules ────────────
  {
    const m = await admin
      .from('meetings')
      .insert({ track: rlsTrack, meeting_date: '2026-08-29', status: 'open' })
      .select('id')
      .single();
    rlsMeetingId = m.data!.id as string;
    const legs = await admin
      .from('legs')
      .insert([1, 2, 3, 4].map((n) => ({ meeting_id: rlsMeetingId, leg_number: n, race_number: n + 6 })))
      .select('id, leg_number');
    rlsLeg1Id = ((legs.data ?? []) as Array<{ id: string; leg_number: number }>).find((l) => l.leg_number === 1)!.id;
    await admin
      .from('runners')
      .insert([
        { leg_id: rlsLeg1Id, runner_number: 1, runner_name: 'One' },
        { leg_id: rlsLeg1Id, runner_number: 2, runner_name: 'Two' },
        { leg_id: rlsLeg1Id, runner_number: 3, runner_name: 'Three' },
      ]);
  }

  const runnerIdIn = async (meetingId: string, runnerNumber: number): Promise<string> => {
    const legs = await admin.from('legs').select('id').eq('meeting_id', meetingId).eq('leg_number', 1).single();
    const r = await admin
      .from('runners')
      .select('id')
      .eq('leg_id', legs.data!.id as string)
      .eq('runner_number', runnerNumber)
      .single();
    return r.data!.id as string;
  };

  const browser = await puppeteer.launch({ headless: true });
  try {
    // ══ RLS: picks allowed while open or locked, blocked once settled ═════════
    {
      const clientC = createClient(url, anonKey);
      const { data: sess } = await clientC.auth.signInAnonymously();
      const userC = sess.user!.id;
      await clientC.from('profiles').upsert({ id: userC, display_name: `M11 Carl ${stamp}` });

      const rid1 = await runnerIdIn(rlsMeetingId!, 1);
      const rid2 = await runnerIdIn(rlsMeetingId!, 2);
      const rid3 = await runnerIdIn(rlsMeetingId!, 3);

      const openInsert = await clientC.from('picks').insert({ leg_id: rlsLeg1Id!, user_id: userC, runner_id: rid1 });
      check('pick insert accepted while OPEN (baseline)', openInsert.error === null, openInsert.error?.message);

      await clientC.from('meetings').update({ status: 'locked' }).eq('id', rlsMeetingId!);
      const lockedInsert = await clientC.from('picks').insert({ leg_id: rlsLeg1Id!, user_id: userC, runner_id: rid2 });
      check('pick insert accepted while status is locked', lockedInsert.error === null, lockedInsert.error?.message);

      await admin.from('meetings').update({ status: 'settled' }).eq('id', rlsMeetingId!);
      const settledInsert = await clientC.from('picks').insert({ leg_id: rlsLeg1Id!, user_id: userC, runner_id: rid3 });
      check('pick insert rejected once settled', settledInsert.error !== null);

      const beforeDelete = await admin.from('picks').select('*', { count: 'exact', head: true }).eq('user_id', userC);
      await clientC.from('picks').delete().eq('user_id', userC).eq('leg_id', rlsLeg1Id!);
      const remaining = await admin.from('picks').select('*', { count: 'exact', head: true }).eq('user_id', userC);
      check(
        'pick delete rejected once settled',
        (remaining.count ?? 0) === (beforeDelete.count ?? 0) && (remaining.count ?? 0) > 0,
      );

      await admin.from('picks').delete().eq('user_id', userC);
      await admin.from('profiles').delete().eq('id', userC);
      await admin.auth.admin.deleteUser(userC);
    }

    // ══ Browser flow: rename, pick + rank + leg comments + unlock ═════════════
    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await pageA.setViewport({ width: 390, height: 844 });
    await pageB.setViewport({ width: 390, height: 844 });

    // The app opens straight onto the meetings list. No passcode screen.
    await pageA.goto(`${base}/`, { waitUntil: 'networkidle0' });
    const homeText = await pageA.evaluate(() => document.body.innerText);
    check('home shows WST and no passcode', /\bWST\b/.test(homeText) && !/passcode/i.test(homeText));
    check('document title is WST', (await pageA.title()) === 'WST');

    await login(pageA, base, nameA);
    const header = await pageA.evaluate(() => document.body.innerText);
    check('app header brand shows WST', header.includes('WST') && !header.includes('QuaddiePicks'));

    await pageA.goto(`${base}/meetings/${uiMeetingId}`, { waitUntil: 'networkidle0' });
    await pageA.waitForSelector('main section h2', { timeout: 30000 });

    const rows = await admin.from('profiles').select('id').eq('display_name', nameA);
    userA = (rows.data ?? [])[0]?.id;

    // Pick Alpha and Beta.
    await pageA.click('button[aria-label="Pick 1 Alpha"]');
    await pageA.waitForFunction(() => document.querySelector('[data-testid="picked-count"]')?.textContent?.includes('1'), { timeout: 10000 });
    await pageA.click('button[aria-label="Pick 2 Beta"]');
    await pageA.waitForFunction(() => document.querySelector('[data-testid="picked-count"]')?.textContent?.includes('2'), { timeout: 10000 });

    // Mark Alpha 1st, Beta 2nd.
    await pageA.click('button[aria-label="Mark 1 Alpha as your 1st pick"]');
    await pageA.waitForSelector('button[aria-label="Mark 1 Alpha as your 1st pick"][aria-pressed="true"]', { timeout: 10000 });
    await pageA.click('button[aria-label="Mark 2 Beta as your 2nd pick"]');
    await pageA.waitForSelector('button[aria-label="Mark 2 Beta as your 2nd pick"][aria-pressed="true"]', { timeout: 10000 });

    {
      const ranks = await admin.from('picks').select('rank').eq('user_id', userA!).eq('leg_id', uiLeg1Id!);
      const data = ((ranks.data ?? []) as Array<{ rank: number | null }>).filter((r) => r.rank !== null);
      check(
        'only one 1st and one 2nd recorded per member per leg',
        data.length === 2 && data.some((r) => r.rank === 1) && data.some((r) => r.rank === 2),
        JSON.stringify(data),
      );
    }

    // Pick Gamma, then set Gamma 1st → clears Alpha's 1st.
    await pageA.click('button[aria-label="Pick 3 Gamma"]');
    await pageA.waitForFunction(() => document.querySelector('[data-testid="picked-count"]')?.textContent?.includes('3'), { timeout: 10000 });
    await pageA.click('button[aria-label="Mark 3 Gamma as your 1st pick"]');
    await pageA.waitForSelector('button[aria-label="Mark 3 Gamma as your 1st pick"][aria-pressed="true"]', { timeout: 10000 });

    {
      const { data: pickRows } = await admin.from('picks').select('runner_id, rank').eq('user_id', userA!).eq('leg_id', uiLeg1Id!);
      const { data: runnerRows } = await admin.from('runners').select('id, runner_number').eq('leg_id', uiLeg1Id!);
      const numById = new Map((runnerRows ?? []).map((r) => [r.id as string, r.runner_number as number]));
      const rankByNum = new Map<number, number | null>();
      for (const p of pickRows ?? []) {
        rankByNum.set(numById.get(p.runner_id as string)!, (p.rank as number | null) ?? null);
      }
      const alphaRank = rankByNum.get(1);
      const betaRank = rankByNum.get(2);
      const gammaRank = rankByNum.get(3);
      check(
        'setting a new 1st clears the old (Alpha null, Gamma 1st, Beta 2nd)',
        alphaRank === null && gammaRank === 1 && betaRank === 2,
        `alpha=${alphaRank} beta=${betaRank} gamma=${gammaRank}`,
      );
    }

    // Toggle the active rank off → unranked (rank is optional).
    await pageA.click('button[aria-label="Mark 3 Gamma as your 1st pick"]');
    await pageA.waitForSelector('button[aria-label="Mark 3 Gamma as your 1st pick"]:not([aria-pressed="true"])', { timeout: 10000 });
    {
      const { data: pickRows } = await admin.from('picks').select('runner_id, rank').eq('user_id', userA!).eq('leg_id', uiLeg1Id!);
      const { data: runnerRows } = await admin.from('runners').select('id, runner_number').eq('leg_id', uiLeg1Id!);
      const numById = new Map((runnerRows ?? []).map((r) => [r.id as string, r.runner_number as number]));
      const gamma = (pickRows ?? []).find((p) => numById.get(p.runner_id as string) === 3);
      check('toggling the active rank clears it (rank optional)', gamma !== undefined && gamma.rank === null, `gamma rank=${gamma?.rank}`);
    }

    // Per-leg comment: A posts; B (other session) sees it live.
    await login(pageB, base, nameB);
    await pageB.goto(`${base}/meetings/${uiMeetingId}`, { waitUntil: 'networkidle0' });
    await pageB.waitForSelector('main section h2', { timeout: 30000 });
    const rowsB = await admin.from('profiles').select('id').eq('display_name', nameB);
    userB = (rowsB.data ?? [])[0]?.id;

    const commentText = `Leg 1 looks wide ${stamp}`;
    await pageA.type('input[aria-label="Comment on leg"]', commentText);
    await pageA.click('button::-p-text(Add)');
    await pageB.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 15000 }, commentText);
    check('per-leg comment posted and seen live by B (no reload)', true);

    {
      const lc = await admin.from('leg_comments').select('body, user_id').eq('leg_id', uiLeg1Id!);
      const data = (lc.data ?? []) as Array<{ body: string; user_id: string }>;
      check('leg comment persisted with author', data.some((c) => c.body === commentText && c.user_id === userA), JSON.stringify(data));
    }

    const hasLockButton = await pageA.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => /lock picks|edit picks/i.test(b.textContent ?? '')),
    );
    check('no lock or edit-picks button', !hasLockButton);
    const settleLink = await pageA.$('a[href$="/settle"]');
    check('enter results is available without locking', settleLink !== null);

    // A row still stored as locked must pick and must not say picks are locked.
    await admin.from('meetings').update({ status: 'locked' }).eq('id', uiMeetingId!);
    await pageA.reload({ waitUntil: 'networkidle0' });
    await pageA.waitForSelector('button[aria-label="Pick 4 Delta"]', { timeout: 15000 });
    const lockedText = await pageA.evaluate(() => document.body.innerText);
    check('a locked row is not described as locked', !/picks are locked/i.test(lockedText) && !/\bLOCKED\b/.test(lockedText));
    await pageA.click('button[aria-label="Pick 4 Delta"]');
    await pageA.waitForFunction(() => document.querySelector('[data-testid="picked-count"]')?.textContent?.includes('4'), { timeout: 10000 });
    check('picking works while the row is stored as locked', true);

    // ══ Chat board ════════════════════════════════════════════════════════════
    // Desktop: side column visible without a toggle.
    await pageA.setViewport({ width: 1280, height: 900 });
    await pageA.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await pageA.waitForSelector('main ul li a', { timeout: 30000 });
    const desktopChatVisible = await pageA.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Chat message"]');
      return ta !== null && (ta as HTMLElement).offsetWidth > 0;
    });
    check('chat is a visible side column on desktop (no toggle needed)', desktopChatVisible);

    // Mobile: collapsed by default, no horizontal scroll, meetings list on screen.
    await pageA.setViewport({ width: 390, height: 844 });
    await pageB.setViewport({ width: 390, height: 844 });
    await pageA.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await pageB.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await pageA.waitForSelector('main ul li a', { timeout: 30000 });

    const listScrollW = await pageA.evaluate(() => document.documentElement.scrollWidth);
    check('meetings list fits 390px with chat panel (no horizontal scroll)', listScrollW <= 390, `scrollWidth=${listScrollW}`);

    const collapsedHidden = await pageA.evaluate(() => {
      const ta = document.querySelector('textarea[aria-label="Chat message"]');
      return ta === null || (ta as HTMLElement).offsetWidth === 0;
    });
    check('chat panel collapsed by default on mobile (390px)', collapsedHidden);

    await pageA.click('aside button::-p-text(Chat)');
    await pageB.click('aside button::-p-text(Chat)');
    await pageA.waitForFunction(() => {
      const ta = document.querySelector('textarea[aria-label="Chat message"]');
      return ta !== null && (ta as HTMLElement).offsetWidth > 0;
    }, { timeout: 10000 });

    const normalMsg = `normal hello ${stamp}`;
    await pageA.type('textarea[aria-label="Chat message"]', normalMsg);
    await pageA.click('aside button::-p-text(Post)');
    await pageB.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 15000 }, normalMsg);
    check('chat message posted and seen live by B', true);

    const anonMsg = `anonymous secret ${stamp}`;
    await pageA.click('input[type="checkbox"]');
    await pageA.type('textarea[aria-label="Chat message"]', anonMsg);
    await pageA.click('aside button::-p-text(Post)');
    await pageB.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 15000 }, anonMsg);
    check('anonymous chat message seen live by B', true);

    await pageA.waitForFunction((t) => document.body.innerText.includes('Anonymous'), { timeout: 10000 }, anonMsg);
    check('anonymous message displays as Anonymous to the poster', true);

    // API truth: the view omits user_id for anonymous rows; the table records it.
    {
      const clientD = createClient(url, anonKey);
      const { data: dSess } = await clientD.auth.signInAnonymously();
      const userD = dSess.user!.id;

      const viewRows = await clientD.from('chat_messages_view').select('*').ilike('body', `%${stamp}%`);
      const vData = (viewRows.data ?? []) as Array<{ body: string; user_id: string | null; is_anonymous: boolean }>;
      const anonView = vData.find((r) => r.body === anonMsg);
      const normalView = vData.find((r) => r.body === normalMsg);
      check(
        'view omits user_id for anonymous message (API response, not UI)',
        anonView !== undefined && anonView.is_anonymous === true && anonView.user_id === null,
        anonView === undefined ? 'anon row missing' : `user_id=${anonView.user_id}`,
      );
      check(
        'view keeps user_id for a non-anonymous message',
        normalView !== undefined && normalView.user_id === userA,
        normalView === undefined ? 'normal row missing' : `user_id=${normalView.user_id}`,
      );

      const tableRows = await admin.from('chat_messages').select('*').ilike('body', `%${stamp}%`);
      const tData = (tableRows.data ?? []) as Array<{ body: string; user_id: string; is_anonymous: boolean }>;
      const anonTable = tData.find((r) => r.body === anonMsg);
      check(
        'anonymous user_id still recorded on the row (for RLS delete-own)',
        anonTable !== undefined && anonTable.is_anonymous === true && anonTable.user_id === userA,
        anonTable === undefined ? 'anon row missing' : `user_id=${anonTable.user_id}`,
      );

      await admin.auth.admin.deleteUser(userD);
    }

    await ctxA.close();
    await ctxB.close();
  } finally {
    for (const uid of [userA, userB]) {
      if (uid === undefined) continue;
      await admin.from('chat_messages').delete().eq('user_id', uid);
      await admin.from('leg_comments').delete().eq('user_id', uid);
      await admin.from('comments').delete().eq('user_id', uid);
      await admin.from('picks').delete().eq('user_id', uid);
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
    await admin.from('meetings').delete().like('track', 'M11-%');
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} m11 checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
