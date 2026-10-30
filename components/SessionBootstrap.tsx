'use client';

// Opens the anonymous session from this browser. A failure must not replace
// the page — meetings stay readable with the anon key, and the visitor can retry.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInAnonymouslyWithRetry } from '@/lib/anon-session';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type SessionResult = 'ready' | 'created' | 'failed';

let inFlight: Promise<SessionResult> | null = null;

/** One in-flight sign-in shared by a remounted effect. A later call re-checks the cookie. */
function ensureBrowserSession(): Promise<SessionResult> {
  const supabase = getSupabaseBrowserClient();
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user !== null) return 'ready' as const;
    const ok = await signInAnonymouslyWithRetry(async () => {
      const { data: signed, error } = await supabase.auth.signInAnonymously();
      return { ok: error === null && signed.session !== null };
    });
    return ok ? ('created' as const) : ('failed' as const);
  })().then((result) => {
    inFlight = null;
    return result;
  });
  return inFlight;
}

export function SessionBootstrap() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await ensureBrowserSession();
      if (cancelled) return;
      if (result === 'created') {
        setFailed(false);
        router.refresh();
      } else if (result === 'failed') {
        setFailed(true);
      } else {
        setFailed(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  if (!failed) return null;

  return (
    <p
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      Sign-in did not go through. You can still look at the cards.{' '}
      <button
        type="button"
        className="underline"
        onClick={() => {
          setFailed(false);
          inFlight = null;
          setAttempt((n) => n + 1);
        }}
      >
        Try again
      </button>
    </p>
  );
}
