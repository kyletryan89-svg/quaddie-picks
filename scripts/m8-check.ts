// M8 verification — real fields and tap-to-pick.
//
// Run: BASE_URL=http://localhost:3000 npm run test:m8
//
// Three things to prove, all by execution:
//   1. SCHEMA   runners exists with the right RLS, picks point at runner_id,
//               and the migration preserved the picks that were already there
//   2. PASTE    the paste box parses the three accepted line shapes, previews a
//               count before saving, skips junk, and re-pasting replaces a field
//   3. STRIPPED the meeting screen carries track, date, status and four legs and
//               nothing else — no money, no "outlay", no free-text entry

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

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

/** Type into a leg's paste box, character-safe for multi-line text. */
async function pasteInto(page: Page, leg: number, text: string): Promise<void> {
  const sel = `textarea[aria-label="Paste the field for leg ${leg}"]`;
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
  await page.$eval(sel, (el) => {
    (el as HTMLTextAreaElement).value = '';
  });
  await page.type(sel, text);
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
  const track = `M8 Park ${stamp}`;
  const nameA = `Ada ${stamp} Archer`;
  const nameB = `Ben ${stamp} Baker`;

  const browser = await puppeteer.launch({ headless: true });
  let meetingId = '';
  let schemaMeetingId = '';
  try {
    // ═══ 1. SCHEMA ═════════════════════════════════════════════════════════

    // The migration had to preserve existing picks by matching on number. Every
    // pick in the database — legacy rows included — must now resolve to a runner
    // in its own leg, or the migration lost or mismatched something.
    const { count: pickTotal } = await admin.from('picks').select('*', { count: 'exact', head: true });
    const { data: allPicks } = await admin.from('picks').select('id, leg_id, runner_id, runners(leg_id)');
    const orphans = ((allPicks ?? []) as unknown as Array<{
      id: string;
      leg_id: string;
      runner_id: string | null;
      runners: { leg_id: string } | null;
    }>).filter((p) => p.runner_id === null || p.runners === null || p.runners.leg_id !== p.leg_id);
    check(
      'migration preserved picks: every pick in the database resolves to a runner in its own leg',
      orphans.length === 0,
      `${pickTotal ?? 0} picks total, ${orphans.length} orphaned`,
    );

    // Login at 390px — the one check that only scripts/mobile-check.ts covered
    // before it was retired (it drove the free-text UI this milestone removed).
    {
      const probePage = await (await browser.createBrowserContext()).newPage();
      await probePage.setViewport({ width: 390, height: 844 });
      await probePage.goto(`${base}/login`, { waitUntil: 'networkidle0' });
      const w = await probePage.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      );
      check('login screen has no horizontal scroll at 390px', w <= 391, `scrollWidth=${w}`);
      await probePage.close();
    }

    const pageA = await login(browser, base, passcode, nameA);
    const pageB = await login(browser, base, passcode, nameB);
    const tokenA = (await sessionTokenOf(pageA)) as string;

    async function createMeeting(label: string): Promise<{ id: string; legId: Map<number, string> }> {
      await pageA.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
      await pageA.type('input[name="track"]', label);
      for (const [i, r] of [1, 2, 3, 4].entries()) await pageA.type(`input[name="race${i + 1}"]`, String(r + 1));
      await pageA.click('form:has(input[name="track"]) button[type="submit"]');
      await pageA.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 20000 });
      const id = (await pageA.evaluate(() => window.location.pathname)).split('/')[2] as string;
      const { data: rows } = await admin.from('legs').select('id, leg_number').eq('meeting_id', id).order('leg_number');
      return {
        id,
        legId: new Map((rows as Array<{ id: string; leg_number: number }>).map((l) => [l.leg_number, l.id])),
      };
    }

    // The schema probes write runners directly, so they get their own meeting —
    // otherwise they would leave a field behind and the UI meeting would not
    // start in the "no field pasted yet" state the strip rules are about.
    const probe = await createMeeting(`M8 Schema ${stamp}`);
    schemaMeetingId = probe.id;
    const legId = probe.legId;

    const authed = { apikey: anonKey, Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };

    // Insert as a member — the policy allows it.
    const insertRes = await fetch(`${url}/rest/v1/runners`, {
      method: 'POST',
      headers: { ...authed, Prefer: 'return=representation' },
      body: JSON.stringify([
        { leg_id: legId.get(4), runner_number: 1, runner_name: 'Schema Check' },
        { leg_id: legId.get(4), runner_number: 2, runner_name: 'Second Check' },
      ]),
    });
    const inserted = (await insertRes.json()) as Array<{ id: string; scratched: boolean }>;
    check('runners: an authenticated member can insert', Array.isArray(inserted) && inserted.length === 2, `HTTP ${insertRes.status}`);
    check('runners: scratched defaults to false', inserted[0]?.scratched === false, String(inserted[0]?.scratched));

    // Select as a member — the policy allows it.
    const selRes = await fetch(`${url}/rest/v1/runners?leg_id=eq.${legId.get(4)}&select=id`, { headers: authed });
    check('runners: an authenticated member can select', ((await selRes.json()) as unknown[]).length === 2);

    // unique (leg_id, runner_number)
    const dupRes = await fetch(`${url}/rest/v1/runners`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify([{ leg_id: legId.get(4), runner_number: 1, runner_name: 'Clash' }]),
    });
    check('runners: unique(leg_id, runner_number) rejects a duplicate number', dupRes.status >= 400, `HTTP ${dupRes.status}`);

    // No delete from the client.
    const runnerToKill = inserted[1]!.id;
    const delRes = await fetch(`${url}/rest/v1/runners?id=eq.${runnerToKill}`, {
      method: 'DELETE',
      headers: { ...authed, Prefer: 'return=representation' },
    });
    const stillThere = await fetch(`${url}/rest/v1/runners?id=eq.${runnerToKill}&select=id`, { headers: authed });
    const survivors = (await stillThere.json()) as unknown[];
    note(`member DELETE on runners → HTTP ${delRes.status}`);
    check(
      'runners: a member cannot delete — the row survives a real DELETE with their own JWT',
      survivors.length === 1,
      `${survivors.length} row(s) still visible to that member`,
    );

    // picks now point at runner_id; the old free-text column is gone.
    const oldShape = await fetch(`${url}/rest/v1/picks`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify([{ leg_id: legId.get(4), user_id: (await admin.from('profiles').select('id').eq('display_name', nameA).single()).data!.id, runner_number: 1 }]),
    });
    check('picks: the old free-text runner_number column is gone', oldShape.status >= 400, `HTTP ${oldShape.status}`);

    // A pick may not point at a runner from another leg.
    const { data: profA } = await admin.from('profiles').select('id').eq('display_name', nameA).single();
    const aId = (profA as { id: string }).id;
    const wrongLeg = await fetch(`${url}/rest/v1/picks`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify([{ leg_id: legId.get(3), user_id: aId, runner_id: inserted[0]!.id }]),
    });
    check(
      'picks: a pick pointing at a runner from a different leg is rejected',
      wrongLeg.status >= 400,
      `HTTP ${wrongLeg.status}`,
    );

    // ═══ 2. PASTE THE FIELD ════════════════════════════════════════════════
    // A clean meeting: four legs, no field pasted in any of them.
    const ui = await createMeeting(track);
    meetingId = ui.id;
    const uiLegId = ui.legId;
    await pageA.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await pageA.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });

    const boxes = await pageA.$$eval('textarea[aria-label^="Paste the field for leg"]', (els) => els.length);
    check('paste: every leg offers a paste box while the meeting is open', boxes === 4, `${boxes} boxes`);

    // A leg with no field shows the paste box and nothing else — no runner list.
    const leg1Runners = await pageA.$$eval('button[aria-label^="Pick "]', (els) => els.length);
    check('paste: a leg with no field shows the paste box and no runner list', leg1Runners === 0, `${leg1Runners} runner rows`);

    // The three accepted shapes, plus junk that must be skipped.
    const pasteText = [
      '7. Winx The Second',
      '3 Beta Blocker',
      '11. Gamma Ray (5)',
      'Race 4 — 1200m Good 3',
      'Scratchings: 9',
    ].join('\n');
    await pasteInto(pageA, 1, pasteText);

    const previewSel = '[data-testid="paste-preview-1"]';
    await pageA.waitForSelector(previewSel, { timeout: 15000 });
    const preview = await pageA.$eval(previewSel, (el) => (el as HTMLElement).innerText);
    note(`preview: ${JSON.stringify(preview.replace(/\n/g, ' | '))}`);
    check('paste: a preview appears with a count BEFORE saving', /3 runners parsed/.test(preview), preview.split('\n')[0]);
    check('paste: the preview reports the lines it skipped', /2 lines skipped/.test(preview));
    check(
      'paste: the preview shows exactly what was parsed, barrier discarded',
      preview.includes('Winx The Second') && preview.includes('Beta Blocker') && preview.includes('Gamma Ray') && !preview.includes('Gamma Ray (5)'),
    );

    // Nothing saved yet.
    const { count: beforeSave } = await admin.from('runners').select('*', { count: 'exact', head: true }).eq('leg_id', uiLegId.get(1) as string);
    check('paste: previewing does not save anything', (beforeSave ?? 0) === 0, `${beforeSave} runners`);

    await pageA.click('button[aria-label="Save field for leg 1"]');
    await pageA.waitForFunction(() => document.querySelectorAll('button[aria-label^="Pick "]').length === 3, { timeout: 20000 });

    const { data: savedRunners } = await admin
      .from('runners')
      .select('runner_number, runner_name')
      .eq('leg_id', uiLegId.get(1) as string)
      .order('runner_number');
    note(`saved field: ${JSON.stringify(savedRunners)}`);
    check(
      'paste: saving stores exactly the parsed field, in runner order, barrier discarded',
      JSON.stringify(savedRunners) ===
        JSON.stringify([
          { runner_number: 3, runner_name: 'Beta Blocker' },
          { runner_number: 7, runner_name: 'Winx The Second' },
          { runner_number: 11, runner_name: 'Gamma Ray' },
        ]),
      JSON.stringify(savedRunners),
    );

    // ── Re-pasting replaces the leg's field ────────────────────────────────
    // First take two runners, one of which survives the replacement.
    await pageA.click('button[aria-label="Pick 7 Winx The Second"]');
    await pageA.waitForFunction(() => /\b1 horse picked/.test(document.body.innerText), { timeout: 15000 });
    await pageA.click('button[aria-label="Pick 3 Beta Blocker"]');
    await pageA.waitForFunction(() => /\b2 horses picked/.test(document.body.innerText), { timeout: 15000 });

    await pageA.click('button::-p-text(Re-paste field)');
    await pasteInto(pageA, 1, '7. Winx The Second\n4. Late Scratching Replacement');
    await pageA.click('button[aria-label="Save field for leg 1"]');
    await pageA.waitForFunction(() => document.querySelectorAll('button[aria-label^="Pick "], button[aria-label^="Remove "]').length === 2, {
      timeout: 20000,
    });

    const { data: replaced } = await admin
      .from('runners')
      .select('runner_number, runner_name')
      .eq('leg_id', uiLegId.get(1) as string)
      .order('runner_number');
    check(
      're-pasting replaces that leg’s field',
      JSON.stringify(replaced) ===
        JSON.stringify([
          { runner_number: 4, runner_name: 'Late Scratching Replacement' },
          { runner_number: 7, runner_name: 'Winx The Second' },
        ]),
      JSON.stringify(replaced),
    );

    const { data: picksAfterReplace } = await admin
      .from('picks')
      .select('runner_id, runners(runner_number)')
      .eq('user_id', aId)
      .eq('leg_id', uiLegId.get(1) as string);
    const survivingNumbers = ((picksAfterReplace ?? []) as unknown as Array<{ runners: { runner_number: number } | null }>)
      .map((p) => p.runners?.runner_number)
      .sort();
    check(
      're-pasting keeps picks on runners that survived and drops the rest',
      JSON.stringify(survivingNumbers) === JSON.stringify([7]),
      `picks left on runners ${JSON.stringify(survivingNumbers)}`,
    );
    await pageA.waitForFunction(() => /\b1 horse picked/.test(document.body.innerText), { timeout: 20000 });
    check('re-pasting updates the on-screen count to match', true);

    // ═══ 3. THE STRIPPED SCREEN ════════════════════════════════════════════
    // Give the remaining legs a field so the screen is in its normal state.
    for (const leg of [2, 3, 4]) {
      await pasteInto(pageA, leg, '1. Alpha Male\n2 Beta Blocker\n5. Gamma Ray (3)');
      await pageA.click(`button[aria-label="Save field for leg ${leg}"]`);
      // The box collapses once the leg has a field — that is the save landing.
      await pageA.waitForFunction(
        (n: number) => document.querySelector(`button[aria-label="Save field for leg ${n}"]`) === null,
        { timeout: 20000 },
        leg,
      );
    }

    await pageA.reload({ waitUntil: 'networkidle0' });
    await pageA.waitForFunction(() => document.querySelector('[aria-label="Loading"]') === null, { timeout: 20000 });
    const screen = await bodyText(pageA);
    note(`meeting screen text: ${JSON.stringify(screen.replace(/\n/g, ' | ').slice(0, 400))}`);

    check('stripped: the track is shown', screen.includes(track));
    check('stripped: the date is shown', /\w{3}, \d{1,2} \w{3} \d{4}/.test(screen));
    check('stripped: the status is shown', /OPEN/i.test(screen));

    const legSections = await pageA.$$eval('section', (els) => els.length);
    check('stripped: exactly four leg sections, no other races', legSections === 4, `${legSections} sections`);

    check(
      'stripped: no dollar amounts anywhere on this screen',
      !screen.includes('$'),
      screen.split('\n').filter((l) => l.includes('$')).join(' / ') || 'none',
    );
    check('stripped: the word "outlay" appears nowhere', !/outlay/i.test(screen));
    check('stripped: no "tips" cost framing remains', !/your tips/i.test(screen));

    check(
      'stripped: the header shows a plain count of horses picked',
      /\b1 horse picked/.test(screen),
      screen.split('\n').find((l) => /horse[s]? picked/.test(l)) ?? '(missing)',
    );

    const legCounts = await pageA.$$eval('[data-testid^="leg-count-"]', (els) =>
      els.map((e) => (e as HTMLElement).innerText.trim()),
    );
    check(
      'stripped: each leg shows the count of your selections in that leg',
      legCounts.length === 4 && legCounts[0] === '1 picked' && legCounts.slice(1).every((c) => c === '0 picked'),
      JSON.stringify(legCounts),
    );

    check(
      'stripped: no race times, distances or race names leak onto the screen',
      !/\b\d{1,2}:\d{2}\s?(am|pm)?\b/i.test(screen) && !/\b\d{3,4}\s?m\b/i.test(screen) && !/1200m|Good 3/.test(screen),
    );

    const freeText = await pageA.$$eval(
      'input[aria-label^="Runner number"], input[aria-label^="Runner name"]',
      (els) => els.length,
    );
    check('rules: no free-text runner entry anywhere on the screen', freeText === 0, `${freeText} inputs`);

    // Each row is number / name / who picked it — and nothing else.
    const rowShape = await pageA.evaluate(() => {
      const btn = document.querySelector('button[aria-label^="Remove 7"]') as HTMLElement | null;
      if (btn === null) return null;
      return [...btn.children].map((c) => (c as HTMLElement).innerText.trim());
    });
    note(`runner row parts: ${JSON.stringify(rowShape)}`);
    check(
      'stripped: a runner row is number, name, and who picked it — three parts, nothing more',
      rowShape !== null && rowShape.length === 3 && rowShape[0] === '7' && rowShape[1] === 'Winx The Second',
      JSON.stringify(rowShape),
    );

    // ── B taps too: initials of every member appear on the runner ───────────
    await pageB.goto(`${base}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await pageB.waitForSelector('button[aria-label="Pick 7 Winx The Second"]', { timeout: 20000 });
    await pageB.click('button[aria-label="Pick 7 Winx The Second"]');
    await pageB.waitForFunction(() => /\b1 horse picked/.test(document.body.innerText), { timeout: 15000 });

    const bothOnRow = await pageB.evaluate(() => {
      const btn = document.querySelector('button[aria-label^="Remove 7"]') as HTMLElement | null;
      return btn === null ? '' : (btn.children[2] as HTMLElement).innerText.replace(/\s+/g, '');
    });
    check(
      'stripped: the runner row lists the initials of every member who has it',
      bothOnRow.includes('AA') && bothOnRow.includes('BB'),
      JSON.stringify(bothOnRow),
    );

    const wide = await pageA.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    );
    check('stripped: no horizontal scroll at 390px', wide <= 391, `scrollWidth=${wide}`);

    // ── Errors still surface ───────────────────────────────────────────────
    await pageA.reload({ waitUntil: 'networkidle0' });
    await pageA.waitForSelector('button::-p-text(Re-paste field)', { timeout: 20000 });
    await pageA.click('button::-p-text(Re-paste field)');
    await pasteInto(pageA, 1, 'this is not a field at all');
    const savePressable = await pageA.$eval('button[aria-label="Save field for leg 1"]', (el) => !(el as HTMLButtonElement).disabled);
    const zeroPreview = await pageA.$eval('[data-testid="paste-preview-1"]', (el) => (el as HTMLElement).innerText);
    check(
      'paste: text that parses to nothing reports 0 runners and cannot be saved',
      !savePressable && /0 runners parsed/.test(zeroPreview),
      `${zeroPreview.split('\n')[0]} · save enabled: ${savePressable}`,
    );
  } finally {
    for (const id of [meetingId, schemaMeetingId]) {
      if (id !== '') {
        await admin.from('meetings').delete().eq('id', id);
        console.log(`[cleanup] removed test meeting ${id}`);
      }
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} M8 checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
