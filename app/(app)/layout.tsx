import Link from 'next/link';
import { IdentityBanner, IdentityButton, IdentityProvider } from '@/components/Identity';
import { SessionBootstrap } from '@/components/SessionBootstrap';
import { getViewer } from '@/lib/auth';

// Always render the cards. A missing session is read-only until the browser
// finishes anonymous sign-in; it is never a wall.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  return (
    <IdentityProvider displayName={viewer?.profile?.display_name ?? null}>
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
        <SessionBootstrap />
        <main className="mx-auto w-full max-w-md px-4 pb-16 pt-4 lg:max-w-5xl">{children}</main>
      </div>
    </IdentityProvider>
  );
}
