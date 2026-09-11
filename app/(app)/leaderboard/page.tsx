import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { money } from '@/lib/format';
import { buildLeaderboard, canonicalRoster, type LeaderboardRow } from '@/lib/leaderboard';
import { getProfiles, getSettledBundles } from '@/lib/queries';
import { carnivalFor, lastWeekStart } from '@/lib/carnival';
import { toScoringLegs, toScoringPicks } from '@/lib/meeting-score';

export const dynamic = 'force-dynamic';

type Scope = 'week' | 'season' | 'all';

interface PageProps {
  searchParams: Promise<{ scope?: string }>;
}

export default function LeaderboardPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <LeaderboardLoader searchParams={searchParams} />
    </Suspense>
  );
}

async function LeaderboardLoader({ searchParams }: PageProps) {
  const sp = await searchParams;
  const carnival = carnivalFor();
  const scope: Scope = sp.scope === 'week' || sp.scope === 'all' ? sp.scope : 'season';

  let rows: LeaderboardRow[];
  let settled: number;
  try {
    const [bundles, profiles] = await Promise.all([
      getSettledBundles(scopeRange(scope, carnival)),
      getProfiles(),
    ]);
    settled = bundles.length;
    const scored = bundles.map((b) => ({
      legs: toScoringLegs(b.legs),
      picks: toScoringPicks(b.legs, b.runners, b.picks),
    }));
    rows = buildLeaderboard(scored, canonicalRoster(profiles));
  } catch (err) {
    return <ErrorNote message={err instanceof Error ? err.message : 'Could not load the leaderboard.'} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Ladder</h1>
      </div>

      {/* Scope tabs — last week / current carnival / all time */}
      <nav aria-label="Ladder scope" className="flex gap-1 overflow-x-auto">
        {(
          [
            ['week', 'Last week'],
            ['season', carnival.label],
            ['all', 'All time'],
          ] as const
        ).map(([mode, label]) => (
          <Link
            key={mode}
            href={`/leaderboard?scope=${mode}`}
            scroll={false}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium ${
              scope === mode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {settled === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          No settled meetings in this view yet — nothing to argue about.
        </div>
      ) : (
        <>
          {/* Mobile: one stacked card per member. */}
          <ol className="flex flex-col gap-3 lg:hidden">
            {rows.map((row, i) => (
              <LeaderCard key={row.member} row={row} rank={i + 1} />
            ))}
          </ol>

          {/* Desktop: compact table. */}
          <section className="hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Punter</th>
                  <th className="px-2 py-2 text-right font-medium">Winners</th>
                  <th className="px-3 py-2 text-right font-medium">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((row) => (
                  <tr key={row.member}>
                    <td className="px-3 py-2 font-medium">{row.member}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.winners}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      ${money(row.return)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function LeaderCard({ row, rank }: { row: LeaderboardRow; rank: number }) {
  const isLeader = rank === 1;
  return (
    <li
      className={`rounded-xl border bg-white p-3 shadow-sm ${
        isLeader ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-label={`Rank ${rank}`}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${
              isLeader ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {rank}
          </span>
          <span className="font-bold text-slate-900">{row.member}</span>
        </div>
        <span className={`text-2xl font-bold tabular-nums ${row.return > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
          ${money(row.return)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
        <span>{row.winners} winner{row.winners === 1 ? '' : 's'}</span>
        <span aria-hidden>·</span>
        <span>${money(row.return)} returned</span>
      </div>
    </li>
  );
}

function scopeRange(scope: Scope, carnival: ReturnType<typeof carnivalFor>): { start?: string; end?: string } {
  if (scope === 'all') return {};
  if (scope === 'week') return { start: lastWeekStart() };
  return { start: carnival.start, end: carnival.end };
}
