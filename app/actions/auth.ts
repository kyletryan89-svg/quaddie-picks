'use server';

// Name only. There is no passcode. The proxy opens an anonymous Supabase
// session; this action writes the display name onto that session's profile
// so picks, comments and the ladder can attribute them.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { validateDisplayName } from '@/lib/display-name';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface NameState {
  error?: string;
  saved?: string;
}

export async function setDisplayName(_prev: NameState, formData: FormData): Promise<NameState> {
  const parsed = validateDisplayName(String(formData.get('displayName') ?? ''));
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) {
    return { error: 'Could not open a session. Refresh and try again.' };
  }

  const { error } = await supabase.from('profiles').upsert({ id: user.id, display_name: parsed.name });
  if (error !== null) {
    return { error: 'Could not save your name. Try again.' };
  }

  revalidatePath('/', 'layout');
  return { saved: parsed.name };
}

/** Drop this browser's session so the next request starts a fresh anonymous user. */
export async function startFresh(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}
