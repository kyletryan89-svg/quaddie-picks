'use server';

// Meeting lifecycle actions: lock, settle. Meetings themselves now come from
// the racing feed (lib/feed.ts), not member input.
// Every action re-checks auth server-side; RLS remains the real gate.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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

/**
 * Reopen a locked meeting so members can change picks for late scratchings.
 * Any member may do this; it is impossible once the meeting is settled. The
 * unlocker and timestamp are recorded so the screen can show who did it.
 */
export async function unlockMeeting(meetingId: string): Promise<{ error?: string }> {
  const auth = await getAuthContext();
  if (auth === null) redirect('/login');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('meetings')
    .update({ status: 'open', reopened_by: auth.userId, reopened_at: new Date().toISOString() })
    .eq('id', meetingId)
    .eq('status', 'locked');

  if (error !== null) {
    return { error: error.message };
  }
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/');
  return {};
}

export interface SettleState {
  error?: string;
  /** Echoed back so a rejected settle does not wipe the form (see CreateMeetingState). */
  values?: Record<string, string>;
}

/**
 * A leg's field, as a runner-number range.
 *
 * The schema stores no field list — `legs` has a `race_number`, not a runner
 * roster — and SPEC §6 fixes the settle screen at "winning runner number,
 * runner name, and starting price. Nothing else", so there is nowhere to enter
 * one. The only other per-leg runner data in the app is the set of runners
 * members happened to tip, and validating against *that* would make it
 * impossible to record the single most common real result: a winner nobody
 * backed. SPEC R4 case 6 ("All losses. Nobody hits anything") requires exactly
 * that state to be reachable, so the field is bounded by what a runner number
 * can legally be, not by what anyone tipped.
 */
const FIELD_MIN = 1;
const FIELD_MAX = 99;

/**
 * Enter the four winners. winner_sp is TOTAL RETURN PER $1 (spec §2) — stored as
 * typed, never converted to odds-to-one anywhere.
 */
export async function settleMeeting(_prev: SettleState, formData: FormData): Promise<SettleState> {
  const auth = await getAuthContext();
  if (auth === null) redirect('/login');

  const meetingId = String(formData.get('meetingId') ?? '');

  // Echo every field back so a rejected settle keeps what was typed — React
  // resets an uncontrolled form once its action resolves.
  const values: Record<string, string> = {};
  for (const legNumber of [1, 2, 3, 4]) {
    for (const prefix of ['winner', 'name', 'sp']) {
      values[`${prefix}${legNumber}`] = String(formData.get(`${prefix}${legNumber}`) ?? '');
    }
  }

  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) {
    return { error: 'Bad meeting reference.', values };
  }

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase.from('meetings').select('status').eq('id', meetingId).maybeSingle();
  if (meeting === null) return { error: 'Meeting not found.', values };
  if (meeting.status !== 'locked') {
    return { error: 'Only a locked meeting can be settled.', values };
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

    // ── Winner number: must be a whole number inside the leg's field ────────
    if (numRaw === '') {
      return { error: `Leg ${legNumber}: enter the winning runner number.`, values };
    }
    // Number('') is 0 and Number(' 7 ') is 7, so reject anything that is not a
    // plain integer literal before trusting the numeric conversion.
    if (!/^\d+$/.test(numRaw)) {
      return {
        error: `Leg ${legNumber}: runner number must be a whole number — “${numRaw}” is not.`,
        values,
      };
    }
    const num = Number(numRaw);
    if (!Number.isInteger(num) || num < FIELD_MIN || num > FIELD_MAX) {
      return {
        error: `Leg ${legNumber}: runner #${numRaw} is not in the field (runners are ${FIELD_MIN}–${FIELD_MAX}).`,
        values,
      };
    }

    // ── Starting price: must be a positive number, above 1.00 ───────────────
    if (spRaw === '') {
      return { error: `Leg ${legNumber}: enter the starting price.`, values };
    }
    const sp = Number(spRaw);
    if (!Number.isFinite(sp)) {
      return {
        error: `Leg ${legNumber}: starting price must be a number — “${spRaw}” is not.`,
        values,
      };
    }
    if (sp <= 0) {
      return {
        error: `Leg ${legNumber}: starting price must be a positive number, not ${spRaw}.`,
        values,
      };
    }
    if (sp <= 1) {
      // SP is TOTAL RETURN per $1 including the stake (SPEC §2), so any real
      // price is strictly above 1.00 — 1.00 itself would mean a free bet.
      return {
        error: `Leg ${legNumber}: starting price must be above 1.00 — it is total return per $1, stake included.`,
        values,
      };
    }
    if (sp > 1000) {
      return { error: `Leg ${legNumber}: starting price of ${spRaw} looks like a typo.`, values };
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
      return { error: `Leg ${legNumberStr}: ${error.message}`, values };
    }
  }

  const { error: statusError } = await supabase
    .from('meetings')
    .update({ status: 'settled' })
    .eq('id', meetingId)
    .eq('status', 'locked');
  if (statusError !== null) {
    return { error: `Winners saved but status change failed: ${statusError.message}`, values };
  }

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/leaderboard');
  revalidatePath('/');
  redirect(`/meetings/${meetingId}`);
}

