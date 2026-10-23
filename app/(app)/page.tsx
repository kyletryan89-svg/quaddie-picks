import Link from 'next/link';
import { Suspense } from 'react';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate } from '@/lib/format';
import { orderMeetings } from '@/lib/meeting-order';
import { sydneyTodayISO, targetSaturdayISO } from '@/lib/racing/dates';
import { ladbrokes } from '@/lib/racing/providers/ladbrokes';
import { syncMeetings } from '@/lib/racing/sync';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSeasonMeetings } from '@/lib/queries';
import { seasonFor } from '@/lib/season';

export const dynamic = 'force-dynamic';

export default function MeetingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Meetings</h1>
        <Link
          href="/meetings/new"
          className="tap inline-flex items-center rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white"
        >
          New meeting
        </Link>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <MeetingsList />
      </Suspense>
    </div>
  );
}

/**
 * Every meeting in the table for the current season. Ladbrokes (the single feed
 * source) is synced first so a just-published card exists, but the list itself
 * reads the table — never the feed.
 */
async function MeetingsList() {
  let meetings;
  try {
    try {
      const supabase = await createSupabaseServerClient();
      await syncMeetings(supabase, ladbrokes, targetSaturdayISO());
    } catch {
      // Ingestion is best-effort; the list comes from the table regardless.
    }
    meetings = (await getSeasonMeetings(seasonFor())).sort((a, b) => orderMeetings(a, b, sydneyTodayISO()));
  } catch (err) {
    return <ErrorNote message={err instanceof Error ? err.message : 'Could not load meetings.'} />;
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        No meetings this season yet — check back midweek.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {meetings.map((m) => (
        <li key={m.meeting.id}>
          <Link
            href={`/meetings/${m.meeting.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-base font-semibold">{m.meeting.track}</span>
              <StatusBadge status={m.meeting.status} />
            </div>
            <div className="mt-1 flex items-center justify-between text-sm text-slate-600">
              <span>{formatDate(m.meeting.meeting_date)}</span>
              <span>
                {m.memberCount === 0 ? (
                  'No picks yet'
                ) : (
                  <>
                    {m.memberCount} picking · {m.pickCount} tip{m.pickCount === 1 ? '' : 's'}
                  </>
                )}
              </span>
            </div>
            {m.meeting.status === 'locked' && (
              <div className="mt-1 text-xs font-medium text-amber-600">Results waiting — tap to enter</div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
