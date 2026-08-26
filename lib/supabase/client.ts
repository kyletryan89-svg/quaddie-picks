'use client';

import { createBrowserClient } from '@supabase/ssr';

let cached: ReturnType<typeof createBrowserClient> | undefined;

/** Browser Supabase client — anon key only; RLS is the security boundary. */
export function getSupabaseBrowserClient() {
  if (cached === undefined) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url === undefined || url === '' || anonKey === undefined || anonKey === '') {
      throw new Error('Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    cached = createBrowserClient(url, anonKey);
  }
  return cached;
}
