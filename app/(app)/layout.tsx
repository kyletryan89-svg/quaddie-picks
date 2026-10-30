import Link from 'next/link';
import { IdentityBanner, IdentityButton, IdentityProvider } from '@/components/Identity';
import { getViewer } from '@/lib/auth';

// The app is open. The proxy has already started an anonymous session; a missing
// display name is a banner, not a redirect.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  if (viewer === null) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">WST</h1>
        <p className="text-sm text-slate-600">Could not open a session. Refresh the page.</p>
      </main>
    );
  }

  return (
    <IdentityProvider displayName={viewer.profile?.display_name ?? null}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-12 w-full max-w-md items-center justify-between gap-2 px-4 lg:max-w-5xl">
            <Link href="/" className="whitespace-nowrap text-base font-bold tracking-tight">
              WST
            </Link>
            <nav className="flex items-center gap-0.5 text-sm">
              <Link href="/" className="tap inline-flex items-center px-2 font-medium hover:text-emerald-700">
                Meetings
              </Link>
              <Link href="/leaderboard" className="tap inline-flex items-center px-2 font-medium hover:text-emerald-700">
                Ladder
              </Link>
              <IdentityButton />
            </nav>
          </div>
          <IdentityBanner />
        </header>
        <main className="mx-auto w-full max-w-md px-4 pb-16 pt-4 lg:max-w-5xl">{children}</main>
      </div>
    </IdentityProvider>
  );
}
