import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Keeps the Supabase session alive and, when the browser has none, opens an
 * anonymous one. That session is the member id picks attach to. There is no
 * passcode and this proxy never redirects to a login page.
 *
 * Cron routes are outside the matcher: they authenticate with CRON_SECRET.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser() — it refreshes an
  // expired access token and writes the new session back to the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error !== null) console.error('anonymous sign-in failed:', error.message);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Every route except static assets, image optimisation and API/cron routes
     * (which authenticate with CRON_SECRET, not a session).
     */
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
