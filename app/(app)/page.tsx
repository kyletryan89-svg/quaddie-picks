import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/format';
import { getSeasonMeetings } from '@/lib/queries';
import { seasonFor } from '@/lib/season';

export const dynamic = 'force-dynamic';

export default function MeetingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">This season</h1>
        <Link
          href="/meetings/new"
          className="tap inline-flex items-center rounded-lg bg-slate-900 px-3.5 font-medium text-white active:bg-slate-700"
        >
          New meeting
        </Link>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <SeasonMeetings season={seasonFor()} />
      </Suspense>
    </div>
  );
}

async function SeasonMeetings({ season }: { season: ReturnType<typeof seasonFor> }) {
  let summaries;
  try {
    summaries = await getSeasonMeetings(season);
  } catch (err) {
    return <ErrorNote message={err instanceof Error ? err.message : 'Could not load meetings.'} />;
  }

  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        No meetings in the {season.label} season yet.
        <br />
        Saturday arvo? Tap <span className="font-semibold text-slate-700">New meeting</span>.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {summaries.map(({ meeting, pickCount, memberCount }) => (
        <li key={meeting.id}>
          <Link
            href={`/meetings/${meeting.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-base font-semibold">{meeting.track}</span>
              <StatusBadge status={meeting.status} />
            </div>
            <div className="mt-1 flex items-center justify-between text-sm text-slate-600">
              <span>{formatDate(meeting.meeting_date)}</span>
              <span>
                {memberCount === 0 ? (
                  'No picks yet'
                ) : (
                  <>
                    {memberCount} picking · {pickCount} tip{pickCount === 1 ? '' : 's'}
                  </>
                )}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
