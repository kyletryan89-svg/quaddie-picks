// One-off debug v3: prove the auth-before-subscribe requirement.
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env.js';

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Writer + fixture
const writer = createClient(url, anonKey);
await writer.auth.signInAnonymously();
const writerId = (await writer.auth.getUser()).data.user!.id;
await admin.from('profiles').upsert({ id: writerId, display_name: 'RT3 writer' });
const { data: mtg } = await admin.from('meetings').insert({ track: 'RT3', meeting_date: '2026-01-01' }).select('id').single();
const { data: legs } = await admin.from('legs').insert([{ meeting_id: mtg!.id, leg_number: 1 }]).select('id');
const legId = legs![0]!.id;

// Listener A: subscribes with NO session (anon claims).
const anonListener = createClient(url, anonKey);
let anonHits = 0;
anonListener.channel('rt3-anon')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks', filter: `leg_id=in.${legId}` }, () => { anonHits += 1; })
  .subscribe((s: string) => console.log('[anon-listener]', s));

// Listener B: signs in FIRST, then subscribes (authenticated claims).
const authedListener = createClient(url, anonKey);
await authedListener.auth.signInAnonymously();
const authedId = (await authedListener.auth.getUser()).data.user!.id;
await admin.from('profiles').upsert({ id: authedId, display_name: 'RT3 listener' });
let authedHits = 0;
authedListener.channel('rt3-authed')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'picks', filter: `leg_id=in.${legId}` }, () => { authedHits += 1; })
  .subscribe((s: string) => console.log('[authed-listener]', s));

await new Promise((r) => setTimeout(r, 2500));
const ins = await writer.from('picks').insert({ leg_id: legId, user_id: writerId, runner_number: 1 });
console.log('insert error:', ins.error?.message ?? 'none');
await new Promise((r) => setTimeout(r, 4000));
console.log(`RESULT: anonHits=${anonHits} authedHits=${authedHits}`);

await admin.from('meetings').delete().like('track', 'RT3');
for (const uid of [writerId, authedId]) {
  await admin.from('profiles').delete().eq('id', uid);
  await admin.auth.admin.deleteUser(uid);
}
process.exit(0);
