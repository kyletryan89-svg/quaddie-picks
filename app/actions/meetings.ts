'use server';

// Meeting lifecycle actions: create (+ its 4 legs), lock, settle.
// Every action re-checks auth server-side; RLS remains the real gate.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface CreateMeetingState {
  error?: string;
}

export async function createMeeting(_prev: CreateMeetingState, formData: FormData): Promise<CreateMeetingState> {
  const auth = await getAuthContext();
  if (auth === null) redirect('/login');

  const track = String(formData.get('track') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const raceNumbers = [1, 2, 3, 4].map((i) => String(formData.get(`race${i}`) ?? '').trim());

  if (track.length < 2 || track.length > 60) {
    return { error: 'Track name must be 2–60 characters.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'Pick a valid meeting date.' };
  }
  const races: number[] = [];
  for (const raw of raceNumbers) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return { error: 'Race numbers must be whole numbers between 1 and 12.' };
    }
    races.push(n);
  }

  const supabase = await createSupabaseServerClient();
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .insert({ track, meeting_date: date })
    .select('id')
    .single();
  if (meetingError !== null || meeting === null) {
    return { error: 'Could not create the meeting — try again.' };
  }

  const { error: legsError } = await supabase
    .from('legs')
    .insert(races.map((raceNumber, i) => ({ meeting_id: meeting.id, leg_number: i + 1, race_number: raceNumber })));
  if (legsError !== null) {
    return { error: `Meeting created but legs failed (${legsError.message}). Delete it and try again.` };
  }

  revalidatePath('/');
  redirect(`/meetings/${meeting.id}`);
}

export async function lockMeeting(meetingId: string): Promise<{ error?: string }> {
  const auth = await getAuthContext();
  if (auth === null) redirect('/login');

  const supabase = await createSupabaseServerClient();
  // Guard against locking an already-settled meeting; RLS still enforces the rest.
  const { error } = await supabase
    .from('meetings')
    .update({ status: 'locked' })
    .eq('id', meetingId)
    .eq('status', 'open');

  if (error !== null) {
    return { error: error.message };
  }
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/');
  return {};
}

export interface SettleState {
  error?: string;
}

/**
 * Enter the four winners. winner_sp is TOTAL RETURN PER $1 (spec §2) — stored as
 * typed, never converted to odds-to-one anywhere.
 */
export async function settleMeeting(_prev: SettleState, formData: FormData): Promise<SettleState> {
  const auth = await getAuthContext();
  if (auth === null) redirect('/login');

  const meetingId = String(formData.get('meetingId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) {
    return { error: 'Bad meeting reference.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase.from('meetings').select('status').eq('id', meetingId).maybeSingle();
  if (meeting === null) return { error: 'Meeting not found.' };
  if (meeting.status !== 'locked') {
    return { error: 'Only a locked meeting can be settled.' };
  }

  interface WinnerInput {
    winner_number: number;
    winner_name: string | null;
    winner_sp: string;
  }
  const winners: Record<number, WinnerInput> = {};
  for (const legNumber of [1, 2, 3, 4]) {
    const numRaw = String(formData.get(`winner${legNumber}`) ?? '').trim();
    const nameRaw = String(formData.get(`name${legNumber}`) ?? '').trim();
    const spRaw = String(formData.get(`sp${legNumber}`) ?? '').trim();

    const num = Number(numRaw);
    if (!Number.isInteger(num) || num < 1 || num > 99) {
      return { error: `Leg ${legNumber}: runner number must be a whole number (1–99).` };
    }
    const sp = Number(spRaw);
    if (!Number.isFinite(sp) || sp <= 1 || sp > 1000) {
      // SP is total return per $1, so it must exceed 1.00 by definition.
      return { error: `Leg ${legNumber}: starting price must be above 1.00 (it is total return per $1).` };
    }
    winners[legNumber] = {
      winner_number: num,
      winner_name: nameRaw.length > 0 ? nameRaw : null,
      winner_sp: sp.toFixed(2),
    };
  }

  for (const [legNumberStr, w] of Object.entries(winners)) {
    const { error } = await supabase
      .from('legs')
      .update(w)
      .eq('meeting_id', meetingId)
      .eq('leg_number', Number(legNumberStr));
    if (error !== null) {
      return { error: `Leg ${legNumberStr}: ${error.message}` };
    }
  }

  const { error: statusError } = await supabase
    .from('meetings')
    .update({ status: 'settled' })
    .eq('id', meetingId)
    .eq('status', 'locked');
  if (statusError !== null) {
    return { error: `Winners saved but status change failed: ${statusError.message}` };
  }

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/leaderboard');
  revalidatePath('/');
  redirect(`/meetings/${meetingId}`);
}

