// Smoke test against a deployed URL.
//
// Run: BASE_URL=https://your-preview.vercel.app npm run smoke
//
// The app is open: pages render with no passcode and no redirect to /login.
// Cron routes stay behind CRON_SECRET.

import { loadEnvLocal } from './load-env';

loadEnvLocal();

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key}. Usage: BASE_URL=https://… npm run smoke`);
    process.exit(2);
  }
  return raw.replace(/\/+$/, '');
}

async function main(): Promise<void> {
  const base = requireEnv('BASE_URL');
  const checks: Check[] = [];
  const fakeMeetingId = '00000000-0000-4000-8000-000000000000';

  async function get(path: string): Promise<Response> {
    return fetch(`${base}${path}`, { redirect: 'manual' });
  }

  for (const path of ['/', `/meetings/${fakeMeetingId}`, '/leaderboard']) {
    const res = await get(path);
    const loc = res.headers.get('location') ?? '';
    const ok = res.status < 400 && !loc.includes('/login');
    checks.push({ name: `GET ${path} is open (no login redirect)`, ok, detail: `${res.status} → ${loc || 'no redirect'}` });
  }

  {
    const res = await fetch(`${base}/`);
    const body = await res.text();
    const ok = res.status === 200 && body.includes('WST') && !/passcode/i.test(body) && !body.includes('name="passcode"');
    checks.push({ name: 'GET / renders the app with no passcode field', ok, detail: String(res.status) });
  }

  {
    const res = await fetch(`${base}/login`, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const ok = res.status === 404 && !loc.includes('/login');
    checks.push({ name: 'GET /login is gone', ok, detail: `${res.status} → ${loc || 'no redirect'}` });
  }

  {
    const res = await fetch(`${base}/api/cron/sync-fields`);
    checks.push({
      name: 'GET /api/cron/sync-fields without CRON_SECRET is 401',
      ok: res.status === 401,
      detail: String(res.status),
    });
  }

  let failed = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.ok ? '' : ` — ${c.detail ?? ''}`}`);
    if (!c.ok) failed += 1;
  }
  console.log(`\n${checks.length - failed}/${checks.length} smoke checks passed against ${base}`);
  if (failed > 0) process.exit(1);
}

void main();
