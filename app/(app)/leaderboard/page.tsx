import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { money, pct, signedMoney } from '@/lib/format';
import { buildLeaderboard, sortLeaderboard, type LeaderboardSort } from '@/lib/leaderboard';
import { getProfiles, getSeasonSettledBundles } from '@/lib/queries';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { seasonFor, seasonFromLabel, seasonsCovering } from '@/lib/season';
import type { ScoringLeg, ScoringPick } from '@/lib/scoring';

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

      {table.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          No settled meetings in {season.label} yet — nothing to argue about.
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
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
                {sortLeaderboard(table.rows, sort).map((row) => (
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
      )}

      <p className="text-[11px] text-slate-400">
        POT % = profit ÷ outlay. SP is total return per $1 staked. Every selection costs $1; credit is never split.
      </p>
    </div>
  );
}

async function loadTable(season: ReturnType<typeof seasonFor>, current: ReturnType<typeof seasonFor>) {
  const [bundles, profiles] = await Promise.all([getSeasonSettledBundles(season), getProfiles()]);

  const scored = bundles.map((b) => {
    const legIdToNumber = new Map<string, number>(b.legs.map((l) => [l.id, l.leg_number]));
    const legs: ScoringLeg[] = b.legs.map((l) => ({
      legNumber: l.leg_number,
      winnerNumber: l.winner_number,
      winnerSp: l.winner_sp === null ? null : Number(l.winner_sp),
    }));
    const picks: ScoringPick[] = b.picks.map((p) => ({
      userId: p.user_id,
      legNumber: legIdToNumber.get(p.leg_id) ?? 0,
      runnerNumber: p.runner_number,
    }));
    return { legs, picks };
  });

  const roster = profiles.map((p) => ({ id: p.id, displayName: p.display_name }));

  // Season selector lists every season that has any meeting at all.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('meetings').select('meeting_date');
  const allDates = (data ?? []).map((r) => r.meeting_date as string);
  const seasons = seasonsCovering(allDates);
  if (!seasons.some((s) => s.label === current.label)) {
    seasons.unshift(current);
  }

  return { rows: buildLeaderboard(scored, roster), seasons };
}
