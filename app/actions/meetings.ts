'use server';

// Meeting lifecycle actions: create (+ its 4 legs) and settle. There is no lock
// step — picks stay open until results are in. Feed meetings are synced by
// lib/feed.ts; this file also lets a member create one by hand — the only way
// to run a card the feed does not cover (e.g. Caulfield, VIC). Every action
// re-checks the session server-side; RLS remains the real gate.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { isUnsettled } from '@/lib/meeting-status';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MeetingStatus } from '@/lib/types';

export interface CreateMeetingState {
  error?: string;
  /**
   * What the user typed, echoed back. React 19 resets an uncontrolled form once
   * its action resolves, so without this a validation error wipes the track and
   * all four race numbers and the user has to start again.
   */
  values?: {
    track: string;
    date: string;
    races: [string, string, string, string];
  };
}

export async function createMeeting(_prev: CreateMeetingState, formData: FormData): Promise<CreateMeetingState> {
  const auth = await getViewer();
  if (auth === null) return { error: 'Could not open a session. Refresh and try again.' };

  const track = String(formData.get('track') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const raceNumbers = [1, 2, 3, 4].map((i) => String(formData.get(`race${i}`) ?? '').trim());
  const values: CreateMeetingState['values'] = {
    track,
    date,
    races: raceNumbers as [string, string, string, string],
  };

  if (auth.profile === null) {
    return { error: 'Add your name at the top first.', values };
  }
  if (track.length < 2 || track.length > 60) {
    return { error: 'Track name must be 2–60 characters.', values };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'Pick a valid meeting date.', values };
  }
  const races: number[] = [];
  for (const raw of raceNumbers) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return { error: 'Race numbers must be whole numbers between 1 and 12.', values };
    }
    races.push(n);
  }

  const supabase = await createSupabaseServerClient();
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .insert({ track, meeting_date: date, created_by: auth.userId })
    .select('id')
    .single();
  if (meetingError !== null || meeting === null) {
    return { error: 'Could not create the meeting — try again.', values };
  }

  const { error: legsError } = await supabase
    .from('legs')
    .insert(races.map((raceNumber, i) => ({ meeting_id: meeting.id, leg_number: i + 1, race_number: raceNumber })));
  if (legsError !== null) {
    return { error: `Meeting created but legs failed (${legsError.message}). Delete it and try again.`, values };
  }

  revalidatePath('/');
  redirect(`/meetings/${meeting.id}`);
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
  const auth = await getViewer();
  if (auth === null) return { error: 'Could not open a session. Refresh and try again.' };

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
  if (!isUnsettled(meeting.status as MeetingStatus)) {
    return { error: 'This meeting is already settled.', values };
  }

  interface WinnerInput {
    winner_number: number;
    winner_name: string | null;
    winner_sp: string;
    /** 'manual' so the results sync never overwrites what a member entered. */
    winner_source: 'manual';
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
      winner_source: 'manual',
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

  const { data: settled, error: statusError } = await supabase
    .from('meetings')
    .update({ status: 'settled' })
    .eq('id', meetingId)
    .in('status', ['open', 'locked'])
    .select('id');
  if (statusError !== null) {
    return { error: `Winners saved but status change failed: ${statusError.message}`, values };
  }
  if (settled === null || settled.length === 0) {
    return { error: 'This meeting is already settled.', values };
  }

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/leaderboard');
  revalidatePath('/');
  redirect(`/meetings/${meetingId}`);
}

