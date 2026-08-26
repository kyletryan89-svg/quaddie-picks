// Security integration tests — rubric R2.
//
// Exercises the REAL database policies over the wire (no mocks): an unauthenticated
// client, two independent anonymous sign-in sessions, and a service-role client used
// ONLY for status flips where realistic plus cleanup. Every fixture is tagged
// TEST-<ts> and removed again afterwards.
//
// Run: npm run test:security   (needs NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — loaded from .env.local)

import { createClient, type Session } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

interface TestResult {
  name: string;
  ok: boolean;
}

const results: TestResult[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key} — is .env.local present?`);
    process.exit(2);
  }
  return raw;
}

async function signInAnonymous(url: string, anonKey: string): Promise<Session> {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInAnonymously();
  if (error !== null || data.session === null) {
    throw new Error(`anonymous sign-in failed: ${error?.message ?? 'no session'} (is Anonymous sign-in enabled?)`);
  }
  return data.session;
}

async function main(): Promise<void> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const tag = `TEST-${Date.now()}`;
  // Service role bypasses RLS — reserved for cleanup and nothing else.
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const stranger = createClient(url, anonKey); // never signed in — the "random person" client

  const [sessionA, sessionB] = await Promise.all([
    signInAnonymous(url, anonKey),
    signInAnonymous(url, anonKey),
  ]);
  const userA = sessionA.user.id;
  const userB = sessionB.user.id;
  const clientA = createClient(url, anonKey);
  await clientA.auth.setSession(sessionA);
  const clientB = createClient(url, anonKey);
  await clientB.auth.setSession(sessionB);

  try {
    // ── R2.2: unauthenticated requests cannot read picks or meetings ──
    {
      const meetings = await stranger.from('meetings').select('*');
      check(
        'anon (no session) reads zero meetings',
        meetings.error === null && (meetings.data ?? []).length === 0,
      );
      const picks = await stranger.from('picks').select('*');
      check(
        'anon (no session) reads zero picks',
        picks.error === null && (picks.data ?? []).length === 0,
      );
      const sneakyInsert = await stranger
        .from('meetings')
        .insert({ track: `${tag}-sneak`, meeting_date: '2026-01-01' });
      check('anon (no session) cannot insert a meeting', sneakyInsert.error !== null);
    }

    // ── setup through the real policies: both upsert profiles, then A creates meeting + legs ──
    // (profiles first — meetings.created_by has a FK into profiles)
    check('member A can upsert own profile', (await clientA.from('profiles').upsert({ id: userA, display_name: `${tag}-Alice` })).error === null);
    check('member B can upsert own profile', (await clientB.from('profiles').upsert({ id: userB, display_name: `${tag}-Bill` })).error === null);

    const meeting = await clientA
      .from('meetings')
      .insert({ track: `${tag}-Randwick`, meeting_date: '2026-08-29', created_by: userA })
      .select('id')
      .single();
    check(
      'authenticated member can create a meeting (positive control)',
      meeting.error === null,
      meeting.error !== null ? `db said: ${meeting.error.message}` : undefined,
    );
    if (meeting.data === null) throw new Error('cannot proceed without meeting');

    const legs = await clientA
      .from('legs')
      .insert([1, 2, 3, 4].map((n) => ({ meeting_id: meeting.data!.id, leg_number: n, race_number: n + 4 })))
      .select('id, leg_number');
    check('authenticated member can add the 4 legs (positive control)', legs.error === null && (legs.data ?? []).length === 4);
    const legRows = legs.data ?? [];
    if (legRows.length !== 4) throw new Error('cannot proceed without legs');
    const leg1 = legRows.find((l) => l.leg_number === 1)!;

    // ── positive controls while open ──
    const ownPick = await clientA
      .from('picks')
      .insert({ leg_id: leg1.id, user_id: userA, runner_number: 3, runner_name: `${tag}-Runner` });
    check('own pick into OPEN meeting accepted', ownPick.error === null);

    const visible = await clientB.from('picks').select('*').eq('user_id', userA);
    check('authenticated member sees the group’s picks', visible.error === null && (visible.data ?? []).length >= 1);

    // ── R2.3: user B cannot insert a pick carrying user A’s identity ──
    const forged = await clientB
      .from('picks')
      .insert({ leg_id: leg1.id, user_id: userA, runner_number: 9, runner_name: `${tag}-Forged` });
    check('cross-user pick insert rejected (B forging A’s user_id)', forged.error !== null);

    // NB: an RLS-blocked DELETE does not error — it silently affects zero rows —
    // so the proof here is that A’s pick still exists afterwards.
    await clientB.from('picks').delete().eq('user_id', userA);
    const afterTheft = await admin
      .from('picks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA);
    check('cross-user pick delete rejected (A’s pick survives)', (afterTheft.count ?? 0) >= 1);

    // ── R2.4: locked meeting rejects picks at the DATABASE level, not just UI ──
    const lock = await clientA.from('meetings').update({ status: 'locked' }).eq('id', meeting.data!.id);
    check('member can lock the meeting', lock.error === null);
    const latePick = await clientA
      .from('picks')
      .insert({ leg_id: leg1.id, user_id: userA, runner_number: 12, runner_name: `${tag}-TooLate` });
    check('insert into LOCKED meeting rejected by database', latePick.error !== null);

    await clientA.from('picks').delete().eq('user_id', userA);
    const stillThere = await admin
      .from('picks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userA);
    check('delete from LOCKED meeting also rejected (pick survives)', (stillThere.count ?? 0) >= 1);

    // ── no delete path for meetings, even for their creator ──
    await admin.from('meetings').update({ status: 'open' }).eq('id', meeting.data!.id);
    const delMeeting = await clientA.from('meetings').delete().eq('id', meeting.data!.id);
    const meetingSurvives = await admin.from('meetings').select('*', { count: 'exact', head: true }).eq('id', meeting.data!.id);
    check('no client can delete a meeting', delMeeting.error !== null || (meetingSurvives.count ?? 0) === 1);
  } finally {
    // ── cleanup (service role only) ──
    await admin.from('meetings').delete().like('track', `${tag}%`);
    await admin.from('profiles').delete().in('id', [userA, userB]);
    await admin.auth.admin.deleteUser(userA);
    await admin.auth.admin.deleteUser(userB);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} security checks passed`);
  if (failed.length > 0) process.exit(1);
}

void main();
