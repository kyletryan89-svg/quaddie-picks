import Link from 'next/link';
import { Suspense } from 'react';
import { ChatBoard } from '@/components/ChatBoard';
import { ErrorNote, ListSkeleton } from '@/components/ErrorNote';
import { StatusBadge } from '@/components/StatusBadge';
import { requireProfile } from '@/lib/auth';
import { syncMeeting, getSaturdayMeetings } from '@/lib/feed';
import { formatDate } from '@/lib/format';
import { getManualMeetings, getPickCountsByMeeting, getProfiles } from '@/lib/queries';
import { isSaturdayMetro, lastRaces, todaySydneyISO } from '@/lib/racedata';

export const dynamic = 'force-dynamic';

export default async function MeetingsPage() {
  const { userId } = await requireProfile();
  const profiles = await getProfiles();
  const names: Record<string, string> = {};
  for (const p of profiles) names[p.id] = p.display_name;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Saturday metro</h1>
        <Link
          href="/meetings/new"
          className="tap inline-flex items-center rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white"
        >
          New meeting
        </Link>
      </div>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          <Suspense fallback={<ListSkeleton />}>
            <UpcomingMeetings />
          </Suspense>
          <Suspense fallback={null}>
            <ManualMeetings />
          </Suspense>
        </div>
        <ChatBoard currentUserId={userId} names={names} />
      </div>
    </div>
  );
}

async function UpcomingMeetings() {
  let meetings;
  try {
    const today = todaySydneyISO();
    const feed = await getSaturdayMeetings();
    const upcoming = feed
      .filter((m) => isSaturdayMetro(m, today))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    meetings = await Promise.all(
      upcoming.map(async (feedMeeting) => {
        const synced = await syncMeeting(feedMeeting.key);
        const quaddie = lastRaces(feedMeeting.races, 4);
        return {
          ...synced,
          raceCount: feedMeeting.races.length,
          quaddieFrom: quaddie[0]?.number,
          quaddieTo: quaddie[quaddie.length - 1]?.number,
        };
      }),
    );

    const counts = await getPickCountsByMeeting(meetings.map((m) => m.id));
    meetings = meetings.map((m) => ({ ...m, count: counts.get(m.id) ?? { pickCount: 0, memberCount: 0 } }));
  } catch (err) {
    return <ErrorNote message={err instanceof Error ? err.message : 'Could not load the racing calendar.'} />;
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        No Saturday metro meetings coming up — check back midweek.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {meetings.map((m) => (
        <li key={m.id}>
          <Link
            href={`/meetings/${m.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-base font-semibold">{m.track}</span>
              <StatusBadge status={m.status} />
            </div>
            <div className="mt-1 flex items-center justify-between text-sm text-slate-600">
              <span>{formatDate(m.meeting_date)}</span>
              <span>
                {m.count.memberCount === 0 ? (
                  'No picks yet'
                ) : (
                  <>
                    {m.count.memberCount} picking · {m.count.pickCount} tip{m.count.pickCount === 1 ? '' : 's'}
                  </>
                )}
              </span>
            </div>
            {m.quaddieFrom !== undefined && (
              <div className="mt-1 text-xs text-slate-400">
                {m.raceCount} races · quaddie R{m.quaddieFrom}
                {m.quaddieTo !== m.quaddieFrom ? `–R${m.quaddieTo}` : ''}
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function ManualMeetings() {
  let meetings;
  try {
    meetings = await getManualMeetings();
  } catch {
    return null;
  }

  if (meetings.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-500">Manual meetings</h2>
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
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
