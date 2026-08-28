import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Already signed in AND profiled → straight through (SPEC §4.4).
  // Session without profile → stay here so they can (re-)enter a name (SPEC §4.5).
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user !== null) {
    const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
    if (profile !== null) redirect('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">WST</h1>
      <p className="mb-8 text-sm text-slate-600">
        Private scoring for the Saturday crew. Name + passcode, nothing else.
      </p>
      <LoginForm />
    </main>
  );
}
