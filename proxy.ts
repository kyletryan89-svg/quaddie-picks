import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes an existing Supabase session. It does not create one.
 *
 * Anonymous sign-in is 30 requests per hour per IP. Calling it here spent that
 * budget on Vercel's shared egress address, so production visitors never got a
 * cookie. The browser opens the session instead (components/SessionBootstrap).
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
  // Do not sign in here. getUser() only refreshes a session the browser already has.
  await supabase.auth.getUser();

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
