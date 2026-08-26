import Link from 'next/link';
import { signOut } from '@/app/actions/auth';
import { requireProfile } from '@/lib/auth';

// Route-group layout for everything behind login. The guard here is what makes
// unauthenticated requests to / and /meetings/* redirect to /login (rubric R3).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-md items-center justify-between gap-2 px-4">
          <Link href="/" className="whitespace-nowrap text-base font-bold tracking-tight">
            Quaddie<span className="text-emerald-600">Picks</span>
          </Link>
          <nav className="flex items-center gap-0.5 text-sm">
            <Link href="/" className="tap inline-flex items-center px-2 font-medium hover:text-emerald-700">
              Meetings
            </Link>
            <Link href="/leaderboard" className="tap inline-flex items-center px-2 font-medium hover:text-emerald-700">
              Ladder
            </Link>
            <form action={signOut} className="ml-1 flex items-center">
              <span className="max-w-[72px] truncate text-xs text-slate-500">{profile.display_name}</span>
              <button type="submit" className="tap inline-flex items-center px-1.5 text-xs text-slate-400 underline">
                Out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}
