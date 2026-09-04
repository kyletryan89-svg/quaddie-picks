'use server';

// Login flow (SPEC §4). The group passcode NEVER leaves the server: it is read
// from process.env inside this server action only. A wrong passcode must not
// create a session or a profile row — so it is checked BEFORE any Supabase call.

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const passcode = String(formData.get('passcode') ?? '');

  if (displayName.length < 1 || displayName.length > 40) {
    return { error: 'Enter a name (up to 40 characters).' };
  }

  const expected = process.env.GROUP_PASSCODE;
  if (expected === undefined || expected === '') {
    return { error: 'Server is missing GROUP_PASSCODE — ask Kyle to set it.' };
  }
  if (passcode !== expected) {
    // No session, no profile row, nothing written. Just an error message.
    return { error: 'Wrong passcode.' };
  }

  const supabase = await createSupabaseServerClient();

  // Reuse an existing session if the browser already has one; otherwise
  // anonymous sign-in creates one.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let userId = user?.id;

  if (userId === undefined) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error !== null || data.user === null) {
	console.error('LOGIN FAIL:', JSON.stringify(error));      
	return { error: 'Could not start a session — try again.' };
    }
    userId = data.user.id;
  }

  // Upsert keeps display names editable on re-login without creating dupes.
  const { error: upsertError } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: displayName });
  if (upsertError !== null) {
    return { error: 'Signed in but could not save your name — try again.' };
  }

  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
