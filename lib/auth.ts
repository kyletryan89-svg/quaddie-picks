import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export interface Viewer {
  userId: string;
  /** Null until this browser saves a display name. The app still renders. */
  profile: Profile | null;
}

/**
 * The signed-in member, or null when this browser has no session yet.
 * Null is read-only, not an error: pages still render, and the browser
 * opens an anonymous session on the visitor's own IP.
 */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error !== null) {
    console.error('profile read failed:', error.message);
  }

  return { userId: user.id, profile: (profile as Profile | null) ?? null };
}
