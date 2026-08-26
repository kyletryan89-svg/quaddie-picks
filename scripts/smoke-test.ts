// Smoke test against a deployed URL — rubric R7.
//
// Run: BASE_URL=https://your-preview.vercel.app npm run smoke
//
// Checks the public behaviour surface: unauthenticated users are redirected to
// /login from every protected route, and /login itself serves the form.

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

  // 1. Unauthenticated / redirects to /login (any 3xx whose Location points there)
  {
    const res = await get('/');
    const loc = res.headers.get('location') ?? '';
    const ok = res.status >= 300 && res.status < 400 && loc.includes('/login');
    checks.push({ name: 'GET / redirects unauthenticated visitor to /login', ok, detail: `${res.status} → ${loc}` });
  }

  // 2. Same for /meetings/[id] and /leaderboard
  for (const path of [`/meetings/${fakeMeetingId}`, '/leaderboard', '/meetings/new']) {
    const res = await get(path);
    const loc = res.headers.get('location') ?? '';
    const ok = res.status >= 300 && res.status < 400 && loc.includes('/login');
    checks.push({ name: `GET ${path} redirects to /login`, ok, detail: `${res.status} → ${loc}` });
  }

  // 3. /login renders the form
  {
    const res = await fetch(`${base}/login`);
    const body = await res.text();
    const ok =
      res.status === 200 &&
      body.toLowerCase().includes('name') &&
      body.toLowerCase().includes('passcode') &&
      body.includes('Quaddie');
    checks.push({ name: 'GET /login renders the login form', ok, detail: String(res.status) });
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
