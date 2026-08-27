// One-off debug v2: isolate WHERE realtime delivery breaks.
//   phase 1: node-side insert  → do browser A and node probes receive it?
//   phase 2: browser-side insert (B via UI) → do node probes receive it?
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env.js';

loadEnvLocal();
const base = 'http://localhost:3000';
const passcode = process.env.GROUP_PASSCODE ?? '';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const stamp = Date.now().toString().slice(-6);
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Probe identity (node side): real authenticated user with profile so RLS reads work.
const probeClient = createClient(url, anonKey);
await probeClient.auth.signInAnonymously();
const probeUserId = (await probeClient.auth.getUser()).data.user!.id;
await admin.from('profiles').upsert({ id: probeUserId, display_name: `RT2 probe ${stamp}` });

function watch(name: string, filter?: Record<string, string>): { hits: () => number } {
  let n = 0;
  const c = createClient(url, anonKey);
  const ch = c.channel(`watch-${name}`);
  const ev = { event: 'INSERT' as const, schema: 'public', table: 'picks', ...(filter ?? {}) };
  ch.on('postgres_changes', ev, () => {
    n += 1;
    console.log(`  [${name}] INSERT received`);
  }).subscribe((status: string) => console.log(`  [${name}] subscribe: ${status}`));
  return { hits: () => n };
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

await login(pageA, `RT2 Alice ${stamp}`);
await login(pageB, `RT2 Bill ${stamp}`);

await pageA.goto(`${base}/meetings/new`, { waitUntil: 'networkidle0' });
await pageA.type('input[name="track"]', `RT2 Track ${stamp}`);
for (const r of ['1', '2', '3', '4']) await pageA.type(`input[name="race${r}"]`, r);
await pageA.click('button::-p-text(Create meeting)');
await pageA.waitForFunction(() => /^\/meetings\/[0-9a-f-]{36}$/.test(window.location.pathname), { timeout: 15000 });
const path = new URL(pageA.url()).pathname;
await pageB.goto(`${base}${path}`, { waitUntil: 'networkidle0' });

const { data: mtg } = await admin.from('meetings').select('id').eq('track', `RT2 Track ${stamp}`).single();
const { data: legs } = await admin.from('legs').select('id, leg_number').eq('meeting_id', mtg!.id).order('leg_number');
const leg1 = legs!.find((l) => l.leg_number === 1)!;

console.log('starting listeners…');
const all = watch('all-picks'); // unfiltered
const byLeg = watch('leg1-filtered', { filter: `leg_id=in.${leg1.id}` });
void byLeg;
await new Promise((r) => setTimeout(r, 2500));

// ── PHASE 1: node-side insert as the probe user ──
console.log('PHASE 1: node-side insert');
await probeClient.from('picks').insert({ leg_id: leg1.id, user_id: probeUserId, runner_number: 5 });
try {
  await pageA.waitForFunction(() => document.body.innerText.includes('#5'), { timeout: 10000 });
  console.log('  [browser A] SAW node insert ✓');
} catch {
  console.log('  [browser A] did NOT see node insert ✗');
}
await new Promise((r) => setTimeout(r, 1500));
console.log(`  totals after phase 1: all=${all.hits()}`);

// ── PHASE 2: browser-side insert as B via UI ──
console.log('PHASE 2: browser-side insert (B via UI)');
const inputs = await pageB.$$('input[aria-label^="Runner number for leg"]');
await inputs[0]!.type(String(7));
const nameInputs = await pageB.$$('input[aria-label^="Runner name for leg"]');
await (nameInputs[0] as unknown as { type(t: string): Promise<void> }).type('Seven');
await pageB.click('button::-p-text(Add)');
await pageB.waitForFunction(() => document.body.innerText.includes('Seven'), { timeout: 10000 });
console.log('  [browser B] own pick visible locally ✓');
await new Promise((r) => setTimeout(r, 4000));

// Persistence check straight from the DB.
const { data: persisted } = await admin.from('picks').select('runner_number').eq('leg_id', leg1.id);
console.log('persisted picks on leg1:', JSON.stringify((persisted ?? []).map((p) => p.runner_number)));
console.log(`totals after phase 2: all=${all.hits()}`);

// cleanup
await admin.from('meetings').delete().like('track', `RT2 %`);
const { data: profs } = await admin.from('profiles').delete().like('display_name', `RT2 %`).select('id');
for (const p of profs ?? []) await admin.auth.admin.deleteUser(p.id);
await browser.close();
process.exit(0);
