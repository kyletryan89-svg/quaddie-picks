// Server-side data fetching for pages. Tiny group, tiny data: we deliberately
// fetch small tables whole and stitch them in memory rather than maintaining
// views/RPCs. Everything here runs post-auth (callers use requireProfile()).

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Season } from '@/lib/season';
import type { Leg, Meeting, Pick, Profile, Runner } from '@/lib/types';

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

/** All profiles in the group (used to show every member on the leaderboard even before they pick). */
export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('profiles').select('*').order('display_name');
  return (data ?? []) as Profile[];
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
