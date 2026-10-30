import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export interface Viewer {
  userId: string;
  /** Null until this browser saves a display name. The app still renders. */
  profile: Profile | null;
}

/**
 * The signed-in member, if the proxy has already opened an anonymous session.
 * Never redirects. A missing profile is a normal first visit, not a logged-out user.
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

/**
 * Pages that need a user id. Throws (no redirect) when the session could not
 * be opened — the proxy should have signed the browser in anonymously.
 */
export async function requireProfile(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer === null) {
    throw new Error('Could not open a session. Refresh and try again.');
  }
  return viewer;
}
