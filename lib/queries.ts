// Server-side data fetching for pages. Tiny group, tiny data: we deliberately
// fetch small tables whole and stitch them in memory rather than maintaining
// views/RPCs. Everything here runs post-auth (callers use requireProfile()).

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Season } from '@/lib/season';
import type { Comment, Leg, Meeting, Pick, Profile, Runner } from '@/lib/types';

export interface MeetingSummary {
  meeting: Meeting;
  /** total picks entered across all members */
  pickCount: number;
  /** distinct members who have entered at least one pick */
  memberCount: number;
}

export async function getSeasonMeetings(season: Season): Promise<MeetingSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data: meetings, error } = await supabase
    .from('meetings')
    .select('*')
    .gte('meeting_date', season.start)
    .lte('meeting_date', season.end)
    .order('meeting_date', { ascending: false });
  if (error !== null) throw new Error(error.message);
  if ((meetings as Meeting[]).length === 0) return [];

  const [{ data: legs }, { data: picks }] = await Promise.all([
    supabase.from('legs').select('id, meeting_id'),
    supabase.from('picks').select('leg_id, user_id'),
  ]);

  const meetingIdByLeg = new Map<string, string>();
  for (const l of (legs ?? []) as Array<{ id: string; meeting_id: string }>) {
    meetingIdByLeg.set(l.id, l.meeting_id);
  }

  const membersByMeeting = new Map<string, Set<string>>();
  const totalPicksByMeeting = new Map<string, number>();
  for (const p of (picks ?? []) as Array<{ leg_id: string; user_id: string }>) {
    const meetingId = meetingIdByLeg.get(p.leg_id);
    if (meetingId === undefined) continue;
    totalPicksByMeeting.set(meetingId, (totalPicksByMeeting.get(meetingId) ?? 0) + 1);
    let members = membersByMeeting.get(meetingId);
    if (members === undefined) {
      members = new Set();
      membersByMeeting.set(meetingId, members);
    }
    members.add(p.user_id);
  }

  return (meetings as Meeting[]).map((meeting) => ({
    meeting,
    pickCount: totalPicksByMeeting.get(meeting.id) ?? 0,
    memberCount: membersByMeeting.get(meeting.id)?.size ?? 0,
  }));
}

export interface MeetingBundle {
  meeting: Meeting;
  legs: Leg[];
  /** Every leg's field. A leg with none has not had a field pasted yet. */
  runners: Runner[];
  picks: Pick[];
  /** userId → display name */
  names: Map<string, string>;
}

export async function getMeetingBundle(meetingId: string): Promise<MeetingBundle | null> {
  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase.from('meetings').select('*').eq('id', meetingId).maybeSingle();
  if (meeting === null) return null;

  const { data: legRows } = await supabase
    .from('legs')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('leg_number');
  const legs = (legRows ?? []) as Leg[];

  // PostgREST rejects an empty `in.()` list; a leg-less meeting just has no
  // picks and no field.
  const legIds = legs.map((l) => l.id);
  const [{ data: pickRows }, { data: runnerRows }] =
    legs.length === 0
      ? [{ data: [] }, { data: [] }]
      : await Promise.all([
          supabase.from('picks').select('*').in('leg_id', legIds).order('created_at'),
          supabase.from('runners').select('*').in('leg_id', legIds).order('runner_number'),
        ]);

  const { data: profiles } = await supabase.from('profiles').select('id, display_name');
  const names = new Map<string, string>();
  for (const p of (profiles ?? []) as Profile[]) {
    names.set(p.id, p.display_name);
  }

  return {
    meeting: meeting as Meeting,
    legs,
    runners: (runnerRows ?? []) as Runner[],
    picks: (pickRows ?? []) as Pick[],
    names,
  };
}

/**
 * Meetings a member created by hand (no feed source), newest first. The feed
 * covers NSW Saturday metro only; these are the cards a member adds themselves
 * (e.g. a Caulfield meeting) and pastes a field into.
 */
export async function getManualMeetings(): Promise<MeetingSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data: meetings } = await supabase
    .from('meetings')
    .select('*')
    .is('source_key', null)
    .order('meeting_date', { ascending: false });
  const manual = (meetings ?? []) as Meeting[];

  const counts = await getPickCountsByMeeting(manual.map((m) => m.id));
  return manual.map((meeting) => ({
    meeting,
    pickCount: counts.get(meeting.id)?.pickCount ?? 0,
    memberCount: counts.get(meeting.id)?.memberCount ?? 0,
  }));
}

/** All profiles in the group (used to show every member on the leaderboard even before they pick). */
export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('profiles').select('*').order('display_name');
  return (data ?? []) as Profile[];
}

/** The 5 most recent comments for a meeting, oldest first. */
export async function getComments(meetingId: string): Promise<Comment[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('comments')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(5);
  return ((data ?? []) as Comment[]).reverse();
}

/** Latest sync error for a meeting, or null when the last sync succeeded. */
export async function getLatestSyncError(meetingId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('sync_log')
    .select('error')
    .eq('meeting_id', meetingId)
    .order('started', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data === null || data.error === null) return null;
  return data.error as string;
}

export interface PickCount {
  pickCount: number;
  memberCount: number;
}

/** Per-meeting pick/member counts for a batch of meeting ids (the list page). */
export async function getPickCountsByMeeting(meetingIds: readonly string[]): Promise<Map<string, PickCount>> {
  const out = new Map<string, PickCount>();
  if (meetingIds.length === 0) return out;

  const supabase = await createSupabaseServerClient();
  const { data: legs } = await supabase.from('legs').select('id, meeting_id').in('meeting_id', meetingIds);
  const meetingIdByLeg = new Map<string, string>();
  for (const l of (legs ?? []) as Array<{ id: string; meeting_id: string }>) {
    meetingIdByLeg.set(l.id, l.meeting_id);
  }
  const legIds = [...meetingIdByLeg.keys()];
  if (legIds.length === 0) return out;

  const { data: picks } = await supabase.from('picks').select('leg_id, user_id').in('leg_id', legIds);
  for (const p of (picks ?? []) as Array<{ leg_id: string; user_id: string }>) {
    const meetingId = meetingIdByLeg.get(p.leg_id);
    if (meetingId === undefined) continue;
    const cur = out.get(meetingId) ?? { pickCount: 0, memberCount: 0 };
    cur.pickCount += 1;
    out.set(meetingId, cur);
  }
  // Members who have picked, per meeting.
  const membersByMeeting = new Map<string, Set<string>>();
  for (const p of (picks ?? []) as Array<{ leg_id: string; user_id: string }>) {
    const meetingId = meetingIdByLeg.get(p.leg_id);
    if (meetingId === undefined) continue;
    let set = membersByMeeting.get(meetingId);
    if (set === undefined) {
      set = new Set();
      membersByMeeting.set(meetingId, set);
    }
    set.add(p.user_id);
  }
  for (const [meetingId, set] of membersByMeeting) {
    const cur = out.get(meetingId) ?? { pickCount: 0, memberCount: 0 };
    cur.memberCount = set.size;
    out.set(meetingId, cur);
  }
  return out;
}

/** Every SETTLED meeting inside the season, bundled for lib/leaderboard.ts. */
export async function getSeasonSettledBundles(season: Season): Promise<MeetingBundle[]> {
  const supabase = await createSupabaseServerClient();

  const { data: meetings } = await supabase
    .from('meetings')
    .select('*')
    .eq('status', 'settled')
    .gte('meeting_date', season.start)
    .lte('meeting_date', season.end)
    .order('meeting_date');

  const bundles: MeetingBundle[] = [];
  for (const meeting of (meetings ?? []) as Meeting[]) {
    const bundle = await getMeetingBundle(meeting.id);
    if (bundle !== null) bundles.push(bundle);
  }
  return bundles;
}
