import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export interface AuthContext {
  userId: string;
  profile: Profile;
}

/**
 * Server-side guard used by every protected page and action.
 *  - no Supabase session        → /login
 *  - session without a profile  → sign the orphan session out, back to /login
 *    (SPEC §4.5 — a browser with cookies but no profile row is not logged in)
 */
export async function requireProfile(): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    redirect('/login');
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error !== null || profile === null) {
    await supabase.auth.signOut();
    redirect('/login');
  }

  return { userId: user.id, profile: profile as Profile };
}

/** Non-redirecting variant for server actions that need to report an error. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (profile === null) return null;

  return { userId: user.id, profile: profile as Profile };
}
