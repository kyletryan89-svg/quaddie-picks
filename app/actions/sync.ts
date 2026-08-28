'use server';

// "Sync now" — run the fields sync for one meeting on demand and report what it
// found. Used by the button on the meeting screen (M4). The manual paste path
// remains fully functional with every provider disabled; this is an addition,
// never a replacement.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { syncMeeting } from '@/lib/feed';
import { ladbrokes } from '@/lib/racing/providers/ladbrokes';
import { syncMeetingFieldById } from '@/lib/racing/sync';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface SyncNowResult {
  /** Rows written (a Ladbrokes meeting), when the sync reports a count. */
  synced?: number;
  error?: string;
}

async function writeLog(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  meetingId: string,
  started: string,
  rows: number,
  error: string | null,
): Promise<void> {
  const { error: logErr } = await supabase.from('sync_log').insert({
    job: 'sync-now',
    provider: 'ladbrokes',
    meeting_id: meetingId,
    started,
    finished: new Date().toISOString(),
    rows_touched: rows,
    error,
  });
  if (logErr !== null) console.error('sync_log insert failed:', logErr.message);
}

export async function syncMeetingNow(meetingId: string): Promise<SyncNowResult> {
  const auth = await getAuthContext();
  if (auth === null) redirect('/login');

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from('meetings')
    .select('source_key')
    .eq('id', meetingId)
    .maybeSingle();
  if (meeting === null) return { error: 'Meeting not found.' };

  const key = meeting.source_key as string | null;
  const started = new Date().toISOString();

  if (key === null) {
    return { error: 'This meeting has no feed source — paste the field by hand.' };
  }

  try {
    if (key.startsWith('ladbrokes:')) {
      const rows = await syncMeetingFieldById(supabase, ladbrokes, key.slice('ladbrokes:'.length));
      await writeLog(supabase, meetingId, started, rows, null);
      revalidatePath(`/meetings/${meetingId}`);
      return { synced: rows };
    }

    // Racing NSW source — reuse the existing feed sync.
    await syncMeeting(key);
    await writeLog(supabase, meetingId, started, 0, null);
    revalidatePath(`/meetings/${meetingId}`);
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeLog(supabase, meetingId, started, 0, message);
    return { error: message };
  }
}
