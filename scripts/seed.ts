// Seed script — creates the group's five member profiles so the ladder shows the
// full roster before anyone logs in. No meetings, no picks: those come from the
// live racing feed and the members themselves.
//
// Run: npm run seed   (needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// Re-runnable: an existing member (matched by display_name) is refreshed, never
// duplicated.

import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

const MEMBERS = ['Davo', 'Kylie', 'Tommo', 'Sarah', 'Jonesy'] as const;

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key}`);
    process.exit(2);
  }
  return raw;
}

async function main(): Promise<void> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  for (const name of MEMBERS) {
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('display_name', name)
      .maybeSingle();
    if (existing !== null) {
      console.log(`  ${name}: already a member (${existing.id as string})`);
      continue;
    }

    const client = createClient(url, anonKey);
    const { data: anon, error: anonErr } = await client.auth.signInAnonymously();
    if (anonErr !== null || anon.user === null) throw new Error(`anon sign-in failed for ${name}: ${anonErr?.message}`);
    const { error: profErr } = await admin.from('profiles').upsert({ id: anon.user.id, display_name: name });
    if (profErr !== null) throw new Error(`profile upsert failed for ${name}: ${profErr.message}`);
    console.log(`  ${name}: created`);
  }

  console.log(`\n${MEMBERS.length} members ready.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
