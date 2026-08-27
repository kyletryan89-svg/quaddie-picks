// One-off debug v4: matrix over event type x filter syntax x identity.
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env.js';

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Writer (its own anon session + profile).
const writer = createClient(url, anonKey);
await writer.auth.signInAnonymously();
const writerId = (await writer.auth.getUser()).data.user!.id;
await admin.from('profiles').upsert({ id: writerId, display_name: 'RT4 writer' });

// Listener user (separate anon session + profile) — owns the fixture rows.
const listenerUser = createClient(url, anonKey);
await listenerUser.auth.signInAnonymously();
const listenerUserId = (await listenerUser.auth.getUser()).data.user!.id;
await admin.from('profiles').upsert({ id: listenerUserId, display_name: 'RT4 listener' });

// Fixture created BY THE LISTENER USER (mirrors db-check where listener created rows).
const mtg = await listenerUser.from('meetings').insert({ track: 'RT4', meeting_date: '2026-01-01' }).select('id').single();
const legs = await listenerUser.from('legs').insert([{ meeting_id: mtg.data!.id, leg_number: 1 }]).select('id').single();
const legId = legs.data!.id;

interface Variant {
  name: string;
  event: '*' | 'INSERT';
  filter?: string;
}
const variants: Variant[] = [
  { name: 'star+in-parens', event: '*', filter: `leg_id=in.(${legId})` },
  { name: 'insert+in-parens', event: 'INSERT', filter: `leg_id=in.(${legId})` },
  { name: 'star+no-filter', event: '*' },
  { name: 'insert+no-filter', event: 'INSERT' },
];

const hits: Record<string, number> = {};
for (const v of variants) {
  hits[v.name] = 0;
  const ch = listenerUser.channel(`rt4-${v.name}`);
  ch.on(
    'postgres_changes',
    { event: v.event, schema: 'public', table: 'picks', ...(v.filter !== undefined ? { filter: v.filter } : {}) },
    () => {
      hits[v.name] += 1;
    },
  ).subscribe((s: string) => console.log(`[${v.name}]`, s));
}

// App-replica variant: exact channel name + 4-leg joined filter shape.
const { data: moreLegs } = await listenerUser
  .from('legs')
  .insert([
    { meeting_id: mtg.data!.id, leg_number: 2 },
    { meeting_id: mtg.data!.id, leg_number: 3 },
    { meeting_id: mtg.data!.id, leg_number: 4 },
  ])
  .select('id');
const allIds = [legId, ...(moreLegs ?? []).map((l) => l.id)];
hits['app-replica'] = 0;
listenerUser
  .channel(`picks:${mtg.data!.id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'picks', filter: `leg_id=in.(${allIds.join(',')})` }, () => {
    hits['app-replica'] += 1;
  })
  .subscribe((s: string) => console.log('[app-replica]', s));

await new Promise((r) => setTimeout(r, 3000));
const ins = await writer.from('picks').insert({ leg_id: legId, user_id: writerId, runner_number: 2 });
console.log('insert error:', ins.error?.message ?? 'none');
await new Promise((r) => setTimeout(r, 4000));
console.log('HITS:', JSON.stringify(hits));

await admin.from('meetings').delete().like('track', 'RT4');
for (const uid of [writerId, listenerUserId]) {
  await admin.from('profiles').delete().eq('id', uid);
  await admin.auth.admin.deleteUser(uid);
}
process.exit(0);
