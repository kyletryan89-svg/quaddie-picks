// Server-only service-role Supabase client, used by the cron routes (which have
// no user session) to run the ingestion sync. Protected upstream by a CRON_SECRET
// bearer token — never used from a client component or a user-facing action.
// (D21: this scopes the service role to server-side, secret-gated jobs.)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === '' || key === undefined || key === '') {
    throw new Error('Supabase env vars missing for the service client');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
