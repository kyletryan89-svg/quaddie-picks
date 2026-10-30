// Anonymous sign-in runs in the browser, on the visitor's IP. Supabase limits
// that endpoint to 30 requests per hour per IP (https://supabase.com/docs/guides/auth/rate-limits).
// Doing it on the server spent that budget on Vercel's shared egress address,
// so every production visitor was rejected and no session cookie was set.

export const ANON_SIGN_IN_ATTEMPTS = 3;

/** Backoff before attempt n (0-based). The first try waits nothing. */
export function anonSignInDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  return 800 * 2 ** (attempt - 1);
}

export async function signInAnonymouslyWithRetry(
  signIn: () => Promise<{ ok: boolean }>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  for (let attempt = 0; attempt < ANON_SIGN_IN_ATTEMPTS; attempt++) {
    const wait = anonSignInDelayMs(attempt);
    if (wait > 0) await sleep(wait);
    const result = await signIn();
    if (result.ok) return true;
  }
  return false;
}
