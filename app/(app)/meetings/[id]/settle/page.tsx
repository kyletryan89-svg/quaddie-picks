import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ErrorNote';
import { requireProfile } from '@/lib/auth';
import { getMeetingBundle } from '@/lib/queries';
import { SettleForm } from './SettleForm';

export const dynamic = 'force-dynamic';

export default async function SettlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile();

  return (
    <Suspense fallback={<ListSkeleton />}>
      <SettleLoader meetingId={id} />
    </Suspense>
  );
}

async function SettleLoader({ meetingId }: { meetingId: string }) {
  const bundle = await getMeetingBundle(meetingId);
  if (bundle === null) {
    notFound();
  }
  // Only a locked meeting can be settled (SPEC §6); anything else goes back.
  if (bundle.meeting.status !== 'locked') {
    redirect(`/meetings/${meetingId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Enter results</h1>
        <p className="text-sm text-slate-600">
          Winner of each leg. Starting price is total return per $1 — e.g. $4.50 returns $4.50 from a $1 tip.
        </p>
      </div>
      <SettleForm meetingId={bundle.meeting.id} legs={bundle.legs.map((l) => ({ legNumber: l.leg_number, raceNumber: l.race_number }))} />
    </div>
  );
}
