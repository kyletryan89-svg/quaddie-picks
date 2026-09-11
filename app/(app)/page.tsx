import Link from 'next/link';
import { Suspense } from 'react';
import { ChatBoard } from '@/components/ChatBoard';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { requireProfile } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { targetSaturdayISO } from '@/lib/racing/dates';
import { ladbrokes } from '@/lib/racing/providers/ladbrokes';
import { syncMeetings } from '@/lib/racing/sync';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProfiles, getSeasonMeetings, type MeetingSummary } from '@/lib/queries';
import { seasonFor } from '@/lib/season';
import type { MeetingStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Order the list around what needs doing: locked cards (results waiting) first,
// then upcoming open cards, then settled history. Within locked/open the soonest
// date wins; settled shows most recent first.
const STATUS_ORDER: Record<MeetingStatus, number> = { locked: 0, open: 1, settled: 2 };

function orderMeetings(a: MeetingSummary, b: MeetingSummary): number {
  const byStatus = STATUS_ORDER[a.meeting.status] - STATUS_ORDER[b.meeting.status];
  if (byStatus !== 0) return byStatus;
  if (a.meeting.status === 'settled') {
    return b.meeting.meeting_date.localeCompare(a.meeting.meeting_date);
  }
  return a.meeting.meeting_date.localeCompare(b.meeting.meeting_date);
}

export default async function MeetingsPage() {
  const { userId } = await requireProfile();
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
    meetings = (await getSeasonMeetings(seasonFor())).sort(orderMeetings);
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
