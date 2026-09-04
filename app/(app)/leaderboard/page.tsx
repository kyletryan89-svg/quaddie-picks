import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { money } from '@/lib/format';
import { buildLeaderboard, canonicalRoster, sortLeaderboard, type LeaderboardRow, type LeaderboardSort } from '@/lib/leaderboard';
import { getProfiles, getSeasonSettledBundles } from '@/lib/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { seasonFor, seasonFromLabel, seasonsCovering } from '@/lib/season';
import { toScoringLegs, toScoringPicks } from '@/lib/meeting-score';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ season?: string; sort?: string }>;
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
  const current = seasonFor();
  const season = (sp.season !== undefined ? seasonFromLabel(sp.season) : null) ?? current;
  const sort: LeaderboardSort = sp.sort === 'legs' ? 'legs' : 'profit';

  let table;
  try {
    table = await loadTable(season, current);
  } catch (err) {
    return <ErrorNote message={err instanceof Error ? err.message : 'Could not load the leaderboard.'} />;
  }

  const sorted = sortLeaderboard(table.rows, sort);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Ladder</h1>

        {/* Season selector */}
        <nav aria-label="Season" className="flex gap-1 overflow-x-auto">
          {table.seasons.map((s) => (
            <Link
              key={s.label}
              href={`/leaderboard?season=${encodeURIComponent(s.label)}&sort=${sort}`}
              scroll={false}
              className={`whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium ${
                s.label === season.label ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Sort toggle — winners vs profit */}
      <div className="flex items-center gap-2 text-sm" role="group" aria-label="Sort by">
        <span className="text-slate-500">Sort:</span>
        {(
          [
            ['profit', 'Profit'],
            ['legs', 'Winners'],
          ] as const
        ).map(([mode, label]) => (
          <Link
            key={mode}
            href={`/leaderboard?season=${encodeURIComponent(season.label)}&sort=${mode}`}
            scroll={false}
            className={`rounded-md px-2 py-1.5 ${
              sort === mode ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {table.settledMeetings === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          No settled meetings in {season.label} yet — nothing to argue about.
        </div>
      ) : (
        <>
          {/* Mobile: one stacked card per member. */}
          <ol className="flex flex-col gap-3 lg:hidden">
            {sorted.map((row, i) => (
              <LeaderCard key={row.member} row={row} rank={i + 1} sort={sort} />
            ))}
          </ol>

          {/* Desktop keeps a compact table. */}
          <section className="hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Punter</th>
                  <th className="px-2 py-2 text-right font-medium">Winners</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map((row) => (
                  <LeaderTableRow key={row.member} row={row} />
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function LeaderTableRow({ row }: { row: LeaderboardRow }) {
  const profit = Math.max(0, row.profit);
  return (
    <tr>
      <td className="px-3 py-2 font-medium">{row.member}</td>
      <td className="px-2 py-2 text-right tabular-nums">{row.legsHit}</td>
      <td
        className={`px-3 py-2 text-right font-semibold tabular-nums ${
          profit > 0 ? 'text-emerald-700' : 'text-slate-400'
        }`}
      >
        ${money(profit)}
      </td>
    </tr>
  );
}

function LeaderCard({ row, rank, sort }: { row: LeaderboardRow; rank: number; sort: LeaderboardSort }) {
  const isLeader = rank === 1;
  const profit = Math.max(0, row.profit);

  const dominant =
    sort === 'profit'
      ? { value: `$${money(profit)}`, tone: profit > 0 ? 'text-emerald-700' : 'text-slate-900' }
      : { value: String(row.legsHit), tone: 'text-slate-900' };

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
        <span className={`text-2xl font-bold tabular-nums ${dominant.tone}`}>{dominant.value}</span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
        <span>{row.legsHit} winner{row.legsHit === 1 ? '' : 's'}</span>
        <span aria-hidden>·</span>
        <span>${money(profit)} profit</span>
      </div>
    </li>
  );
}

async function loadTable(season: ReturnType<typeof seasonFor>, current: ReturnType<typeof seasonFor>) {
  const [bundles, profiles] = await Promise.all([getSeasonSettledBundles(season), getProfiles()]);

  const scored = bundles.map((b) => ({
    legs: toScoringLegs(b.legs),
    picks: toScoringPicks(b.legs, b.runners, b.picks),
  }));

  const roster = canonicalRoster(profiles);

  // Season selector lists every season that has any meeting at all.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('meetings').select('meeting_date');
  const allDates = (data ?? []).map((r) => r.meeting_date as string);
  const seasons = seasonsCovering(allDates);
  if (!seasons.some((s) => s.label === current.label)) {
    seasons.unshift(current);
  }

  // `rows` always has one entry per canonical member, so it is never empty and
  // cannot signal "nothing has been settled yet" — the count of settled
  // meetings is what the empty state actually means.
  return { rows: buildLeaderboard(scored, roster), seasons, settledMeetings: bundles.length };
}
