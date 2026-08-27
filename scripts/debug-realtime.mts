// One-off debug: browser-level realtime repro with console capture on both pages.
import puppeteer from 'puppeteer';
import { loadEnvLocal } from './load-env.js';

loadEnvLocal();
const base = 'http://localhost:3000';
const passcode = process.env.GROUP_PASSCODE ?? '';
const stamp = Date.now().toString().slice(-6);

function wire(page: puppeteer.Page, tag: string): void {
  page.on('console', (m) => console.log(`[${tag} console:${m.type()}]`, m.text().slice(0, 220)));
  page.on('pageerror', (e) => console.log(`[${tag} pageerror]`, String(e).slice(0, 400)));
}

async function login(page: puppeteer.Page, name: string): Promise<void> {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="displayName"]', name);
  await page.type('input[name="passcode"]', passcode);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 15000 });
}

const browser = await puppeteer.launch({ headless: true });
const ctxA = await browser.createBrowserContext();
const ctxB = await browser.createBrowserContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
wire(pageA, 'A');
wire(pageB, 'B');

await login(pageA, `RT Alice ${stamp}`);
await login(pageB, `RT Bill ${stamp}`);

// A creates a meeting.
await pageA.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
await pageA.type('input[name="track"]', `RT Track ${stamp}`);
await pageA.type('input[name="race1"]', '1');
await pageA.type('input[name="race2"]', '2');
await pageA.type('input[name="race3"]', '3');
await pageA.type('input[name="race4"]', '4');
await pageA.click('button::-p-text(Create meeting)');
await pageA.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 15000 });
const path = new URL(pageA.url()).pathname;
console.log('meeting at', path);

// Both open the meeting.
await pageB.goto(`${base}${path}`, { waitUntil: 'networkidle0' });

for (const [tag, p] of [['A', pageA], ['B', pageB]] as const) {
  const liveText = await p.evaluate(() =>
    document.body.innerText.match(/(● live|○ offline)/)?.[1] ?? 'NO-INDICATOR',
  );
  console.log(`[${tag}] live indicator right after load:`, liveText);
}

// Independent node-side listeners: one UNFILTERED on picks, one with the SAME
// four-leg filter the app uses — to see whether the event leaves Realtime.
const { createClient } = await import('@supabase/supabase-js');
const urlE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const keyE = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const legIds = (await (await fetch(`${base}${path}`)).text(), '');
void legIds;

// Pull the leg ids straight from the DB via an anonymous session.
const probeUser = createClient(urlE, keyE);
await probeUser.auth.signInAnonymously();
// (RLS lets us read meetings/legs/picks as authenticated)
const { data: mtgRow } = await probeUser.from('meetings').select('id').eq('track', `RT Track ${stamp}`).single();
const { data: legRows } = await probeUser.from('legs').select('id').eq('meeting_id', mtgRow!.id);
const ids = (legRows ?? []).map((l) => l.id);
console.log('probe leg ids:', ids.length);

let unfilteredHits = 0;
let filteredHits = 0;
const unfiltered = createClient(urlE, keyE).channel('probe-unfiltered');
unfiltered
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks' }, () => {
    unfilteredHits += 1;
    console.log('[probe] UNFILTERED INSERT seen');
  })
  .subscribe();
const filtered = createClient(urlE, keyE).channel('probe-filtered');
filtered
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'picks', filter: `leg_id=in.(${ids.join(',')})` },
    () => {
      filteredHits += 1;
      console.log('[probe] FILTERED INSERT seen');
    },
  )
  .subscribe();
await new Promise((r) => setTimeout(r, 2000));

// B adds a pick via the UI.
const inputs = await pageB.$$('input[aria-label^="Runner number for leg"]');
console.log('B sees', inputs.length, 'runner-number inputs');
await inputs[0]!.type(String(1));
const names = await pageB.$$('input[aria-label^="Runner name for leg"]');
await (names[0] as unknown as { type(t: string): Promise<void> }).type(`Zed ${stamp}`);
await pageB.click('button::-p-text(Add)');
await pageB.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, `Zed ${stamp}`);
console.log('[B] own pick visible locally');

// Watch A for up to 15s.
try {
  await pageA.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 15000 }, `Zed ${stamp}`);
  console.log('[A] SAW the pick arrive live ✓');
} catch {
  console.log('[A] NEVER saw the pick ✗');
  const text = await pageA.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 500));
  console.log('[A] body:', text);
}
console.log(`probe totals: unfiltered=${unfilteredHits} filtered=${filteredHits}`);

await browser.close();
void probeUser;
process.exit(0); // node-side realtime websockets would otherwise keep us alive
