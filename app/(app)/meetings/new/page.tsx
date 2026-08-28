import { NewMeetingForm } from './NewMeetingForm';

export const dynamic = 'force-dynamic';

export default function NewMeetingPage() {
  // Default the date to today, server-computed so no hydration mismatch.
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">New meeting</h1>
      <p className="text-sm text-slate-600">Track, date, and the race number of each quaddie leg. Paste the field into each leg afterwards.</p>
      <NewMeetingForm today={today} />
    </div>
  );
}
