import Link from 'next/link';
import { Suspense } from 'react';
import { ChatBoard } from '@/components/ChatBoard';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { getViewer } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { comparePast, compareUpcoming, isOnOrAfter } from '@/lib/meeting-list';
import { sydneyTodayISO, targetSaturdayISO } from '@/lib/racing/dates';
import { ladbrokes } from '@/lib/racing/providers/ladbrokes';
import { syncMeetings } from '@/lib/racing/sync';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProfiles, getSeasonMeetings, type MeetingSummary } from '@/lib/queries';
import { seasonFor } from '@/lib/season';

export const dynamic = 'force-dynamic';

export default async function MeetingsPage() {
  const viewer = await getViewer();
  const userId = viewer?.userId ?? '';
  const profiles = await getProfiles();
  const names: Record<string, string> = {};
  for (const p of profiles) names[p.id] = p.display_name;

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
      <ChatBoard currentUserId={userId} names={names} />
      <Suspense fallback={<ListSkeleton />}>
        <MeetingsList />
      </Suspense>
    </div>
  );
}

function MeetingCard({ m }: { m: MeetingSummary }) {
  return (
    <li>
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
      </Link>
    </li>
  );
}

/**
 * Today and later for the current season, soonest first. Older rows stay in
 * the table and sit behind Past meetings. Ladbrokes is synced first so a
 * just-published card exists, but the list itself reads the table.
 */
async function MeetingsList() {
  let upcoming: MeetingSummary[];
  let past: MeetingSummary[];
  try {
    try {
      const supabase = await createSupabaseServerClient();
      await syncMeetings(supabase, ladbrokes, targetSaturdayISO());
    } catch {
      // Ingestion is best-effort; the list comes from the table regardless.
    }
    const today = sydneyTodayISO();
    const meetings = await getSeasonMeetings(seasonFor());
    const dated = (m: MeetingSummary) => ({ meeting_date: m.meeting.meeting_date, track: m.meeting.track });
    upcoming = meetings
      .filter((m) => isOnOrAfter(m.meeting.meeting_date, today))
      .sort((a, b) => compareUpcoming(dated(a), dated(b)));
    past = meetings
      .filter((m) => !isOnOrAfter(m.meeting.meeting_date, today))
      .sort((a, b) => comparePast(dated(a), dated(b)));
  } catch (err) {
    return <ErrorNote message={err instanceof Error ? err.message : 'Could not load meetings.'} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {upcoming.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          {past.length === 0 ? 'No meetings this season yet — check back midweek.' : 'Nothing on today or later.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {upcoming.map((m) => (
            <MeetingCard key={m.meeting.id} m={m} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="tap cursor-pointer list-none px-4 text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
            Past meetings
          </summary>
          <ul className="flex flex-col gap-3 border-t border-slate-100 px-3 py-3">
            {past.map((m) => (
              <MeetingCard key={m.meeting.id} m={m} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
