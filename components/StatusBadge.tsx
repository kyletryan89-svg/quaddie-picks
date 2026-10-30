import { displayStatus } from '@/lib/meeting-status';
import type { MeetingStatus } from '@/lib/types';

const STYLES: Record<MeetingStatus, string> = {
  open: 'bg-emerald-100 text-emerald-800',
  locked: 'bg-emerald-100 text-emerald-800',
  settled: 'bg-sky-100 text-sky-800',
};

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const shown = displayStatus(status);
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[shown]}`}>
      {shown}
    </span>
  );
}
