import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ErrorNote';
import { requireProfile } from '@/lib/auth';
import { getMeetingBundle } from '@/lib/queries';
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
  const bundle = await getMeetingBundle(meetingId);
  if (bundle === null) {
    notFound();
  }

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
      initialNames={names}
      currentUserId={currentUserId}
    />
  );
}
