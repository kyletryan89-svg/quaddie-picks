import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { money, pct, signedMoney } from '@/lib/format';
import { buildLeaderboard, sortLeaderboard, type LeaderboardRow, type LeaderboardSort } from '@/lib/leaderboard';
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

      {/* Sort toggle — legs hit is the number they will argue about (SPEC §2) */}
      <div className="flex items-center gap-2 text-sm" role="group" aria-label="Sort by">
        <span className="text-slate-500">Sort:</span>
        {(
          [
            ['profit', 'Profit'],
            ['legs', 'Legs hit'],
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
              <LeaderCard key={row.userId} row={row} rank={i + 1} sort={sort} />
            ))}
          </ol>

          {/* Desktop keeps the full table. */}
          <section className="hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th rowSpan={2} className="sticky left-0 bg-white px-3 py-2 align-bottom font-medium">Punter</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Mtgs</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Tips</th>
                    <th colSpan={2} className="border-b border-slate-100 px-2 pt-2 pb-0.5 text-center font-medium">Legs hit</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">W/Tips</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Solo</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Full</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Outlay</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Return</th>
                    <th rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium">Profit</th>
                    <th rowSpan={2} className="px-3 py-2 text-right align-bottom font-medium">POT %</th>
                  </tr>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                    <th className={`px-2 py-0.5 text-right ${sort === 'legs' ? 'font-bold text-emerald-700' : ''}`}>#</th>
                    <th className="px-2 py-0.5 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sorted.map((row) => (
                    <tr key={row.userId}>
                      <td className="sticky left-0 max-w-[110px] truncate bg-white px-3 py-2 font-medium">{row.displayName}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.meetings}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.selections}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.legsHit}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                        {row.legsHitPct === null ? '—' : pct(row.legsHitPct)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.selections === 0 ? '—' : (row.legsHit / row.selections).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.soloLegs}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.fullCovers}</td>
                      <td className="px-2 py-2 text-right tabular-nums">${money(row.outlay)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">${money(row.returnTotal)}</td>
                      <td
                        className={`px-2 py-2 text-right font-semibold tabular-nums ${
                          row.profit > 0 ? 'text-emerald-700' : row.profit < 0 ? 'text-red-600' : ''
                        }`}
                      >
                        {signedMoney(row.profit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.pot === null ? '—' : pct(row.pot)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="text-[11px] text-slate-400">
        POT % = profit ÷ outlay. SP is total return per $1 staked. Every selection costs $1; credit is never split.
      </p>
    </div>
  );
}

function LeaderCard({ row, rank, sort }: { row: LeaderboardRow; rank: number; sort: LeaderboardSort }) {
  const isLeader = rank === 1;

  const dominant =
    sort === 'profit'
      ? {
          value: signedMoney(row.profit),
          tone: row.profit > 0 ? 'text-emerald-700' : row.profit < 0 ? 'text-red-600' : 'text-slate-900',
        }
      : { value: String(row.legsHit), tone: 'text-slate-900' };

  const detailRows: Array<[string, string]> = [
    ['Tips', String(row.selections)],
    ['Winners/tip', row.selections === 0 ? '—' : (row.legsHit / row.selections).toFixed(2)],
    ['Solo legs', String(row.soloLegs)],
    ['Full covers', String(row.fullCovers)],
    ['Outlay', `$${money(row.outlay)}`],
    ['Return', `$${money(row.returnTotal)}`],
    ['POT %', row.pot === null ? '—' : pct(row.pot)],
  ];

  return (
    <li
      className={`rounded-xl border bg-white p-3 shadow-sm ${
        isLeader ? 'border-emerald-600 bg-emerald-50/60' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-label={`Rank ${rank}`}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${
              isLeader ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            {rank}
          </span>
          <span className="font-bold text-slate-900">{row.displayName}</span>
        </div>
        <span className={`text-2xl font-bold tabular-nums ${dominant.tone}`}>{dominant.value}</span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
        <span>{row.legsHit} legs hit</span>
        <span aria-hidden>·</span>
        <span>{row.legsHitPct === null ? '—' : pct(row.legsHitPct)} strike</span>
        <span aria-hidden>·</span>
        <span>{row.meetings} mtgs</span>
      </div>

      <details className="group mt-3 border-t border-slate-100 pt-1">
        <summary className="tap flex cursor-pointer list-none items-center justify-between text-xs font-medium text-slate-500 [&::-webkit-details-marker]:hidden">
          <span>Details</span>
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          {detailRows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

async function loadTable(season: ReturnType<typeof seasonFor>, current: ReturnType<typeof seasonFor>) {
  const [bundles, profiles] = await Promise.all([getSeasonSettledBundles(season), getProfiles()]);

  const scored = bundles.map((b) => ({
    legs: toScoringLegs(b.legs),
    picks: toScoringPicks(b.legs, b.runners, b.picks),
  }));

  const roster = profiles.map((p) => ({ id: p.id, displayName: p.display_name }));

  // Season selector lists every season that has any meeting at all.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('meetings').select('meeting_date');
  const allDates = (data ?? []).map((r) => r.meeting_date as string);
  const seasons = seasonsCovering(allDates);
  if (!seasons.some((s) => s.label === current.label)) {
    seasons.unshift(current);
  }

  // `rows` always has one entry per roster profile, so it is never empty and
  // cannot signal "nothing has been settled yet" — the count of settled
  // meetings is what the empty state actually means.
  return { rows: buildLeaderboard(scored, roster), seasons, settledMeetings: bundles.length };
}
