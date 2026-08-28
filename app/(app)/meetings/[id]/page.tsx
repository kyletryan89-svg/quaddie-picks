import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ErrorNote';
import { requireProfile } from '@/lib/auth';
import { syncMeeting } from '@/lib/feed';
import { getComments, getMeetingBundle } from '@/lib/queries';
import { MeetingScreen } from './MeetingScreen';

export const dynamic = 'force-dynamic';

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await requireProfile();

  return (
    <Suspense fallback={<ListSkeleton />}>
      <MeetingLoader meetingId={id} currentUserId={userId} />
    </Suspense>
  );
}

async function MeetingLoader({ meetingId, currentUserId }: { meetingId: string; currentUserId: string }) {
  const first = await getMeetingBundle(meetingId);
  if (first === null) {
    notFound();
  }

  // Refresh the field from the feed before rendering, so scratchings and late
  // changes are current. The meeting has already been rendered without this
  // data, so a feed hiccup must not take the screen down.
  if (first.meeting.source_key !== null) {
    try {
      await syncMeeting(first.meeting.source_key);
    } catch {
      // Render with whatever is already in the DB.
    }
  }

  const bundle = await getMeetingBundle(meetingId);
  if (bundle === null) {
    notFound();
  }
  const comments = await getComments(meetingId);

  // Plain records cross the RSC boundary cleanly.
  const names: Record<string, string> = {};
  for (const [uid, displayName] of bundle.names) {
    names[uid] = displayName;
  }

  return (
    <MeetingScreen
      meeting={bundle.meeting}
      legs={bundle.legs}
      initialRunners={bundle.runners}
      initialPicks={bundle.picks}
      initialComments={comments}
      initialNames={names}
      currentUserId={currentUserId}
    />
  );
}
