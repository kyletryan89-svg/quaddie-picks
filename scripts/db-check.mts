// One-off: verify realtime publication + test an actual broadcast round-trip.
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env.js';

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// 1. (publication checked implicitly by the round-trip below)

// 2. End-to-end broadcast test: sign in two users, create meeting+leg, listen, insert.
const a = createClient(url, anonKey);
const b = createClient(url, anonKey);
await a.auth.signInAnonymously();
await b.auth.signInAnonymously();
const ua = (await a.auth.getUser()).data.user!.id;
const ub0 = (await b.auth.getUser()).data.user!.id;
await a.from('profiles').upsert({ id: ua, display_name: 'RT-CHECK-A' });
await b.from('profiles').upsert({ id: ub0, display_name: 'RT-CHECK-B' });
const { data: mtg } = await a.from('meetings').insert({ track: 'RTCHECK', meeting_date: '2026-01-01' }).select('id').single();
const { data: legs } = await a.from('legs').insert([1].map((n) => ({ meeting_id: mtg!.id, leg_number: n }))).select('id');
const legId = legs![0]!.id;

let received = 0;
const channel = a
  .channel('rt-check')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'picks', filter: `leg_id=in.(${legId})` }, () => {
    received += 1;
  })
  .subscribe((status: string) => {
    console.log('subscribe status:', status);
  });

await new Promise((r) => setTimeout(r, 2500));
const ins = await b.from('picks').insert({ leg_id: legId, user_id: (await b.auth.getUser()).data.user!.id, runner_number: 1 });
console.log('insert error:', ins.error?.message ?? 'none');
await new Promise((r) => setTimeout(r, 4000));
console.log('events received:', received);

// cleanup
await admin.from('meetings').delete().like('track', 'RTCHECK');
const { data: prof } = await admin.from('profiles').delete().eq('id', ua);
void prof;
await admin.auth.admin.deleteUser(ua);
const ub = (await b.auth.getUser()).data.user?.id;
if (ub !== undefined) await admin.auth.admin.deleteUser(ub);
void channel;
process.exit(0);
