// Server-side racing feed access + lazy sync into Supabase.
//
// Meetings and runners are no longer typed by members: they come from the
// Racing NSW FreeFields feed (see lib/racedata.ts). This module fetches that
// feed (with a short in-process TTL) and mirrors it into the existing
// meetings/legs/runners tables so picks, scoring, settle and the leaderboard
// keep working unchanged.
//
// Sync runs with the caller's Supabase session (RLS still applies — the group
// may read/insert/update meetings, legs and runners by policy). No service role.

import { lastRaces, parseAcceptances, parseCalendar, parseMeetingKey } from '@/lib/racedata';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MeetingStatus } from '@/lib/types';

const CALENDAR_URL = 'https://racing.racingnsw.com.au/FreeFields/Calendar_Meetings.aspx?State=NSW';
const ACCEPTANCES_URL = 'https://racing.racingnsw.com.au/FreeFields/Acceptances.aspx';

// Re-fetch at most every 10 minutes. A plain module Map is the whole cache: the
// group is tiny and the feed only needs to be "fresh enough", not instant.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { text: string; at: number }>();

async function fetchText(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.text;

  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`Racing feed returned ${res.status} — try again shortly.`);
  }
  const text = await res.text();
  cache.set(url, { text, at: Date.now() });
  return text;
}

/** The upcoming Saturday metro meetings (from the calendar feed). */
export async function getSaturdayMeetings(): Promise<ReturnType<typeof parseCalendar>> {
  const html = await fetchText(CALENDAR_URL);
  return parseCalendar(html);
}

export interface SyncedMeeting {
  id: string;
  track: string;
  meeting_date: string;
  status: MeetingStatus;
}

/**
 * Mirror a feed meeting into the DB and refresh its quaddie legs + runners.
 * Idempotent; returns the DB meeting row. The quaddie is the last four races of
 * the card, per the product rule.
 */
export async function syncMeeting(sourceKey: string): Promise<SyncedMeeting> {
  const parsed = parseMeetingKey(sourceKey);
  if (parsed === null) {
    throw new Error('Unknown meeting — pick one from the list.');
  }

  // The card (race numbers, names, times) comes from the calendar, so the four
  // quaddie legs exist even before acceptances are published. The runners come
  // from the acceptances page once they are out.
  const calendarHtml = await fetchText(CALENDAR_URL);
  const meeting = parseCalendar(calendarHtml).find((m) => m.key === sourceKey);
  if (meeting === undefined) {
    throw new Error('Meeting not found on the racing calendar.');
  }
  const quaddie = lastRaces(meeting.races, 4);

  let runnerByRace = new Map<number, ReturnType<typeof parseAcceptances>[number]['runners']>();
  try {
    const html = await fetchText(`${ACCEPTANCES_URL}?Key=${encodeURIComponent(sourceKey)}`);
    for (const field of parseAcceptances(html)) {
      runnerByRace.set(field.number, field.runners);
    }
  } catch {
    // Acceptances not published yet — list the meeting, leave the field empty.
    runnerByRace = new Map();
  }

  const supabase = await createSupabaseServerClient();

  // ── meeting (get-or-create, never touch status on an existing row) ────────
  const { data: existing } = await supabase
    .from('meetings')
    .select('id, status')
    .eq('source_key', sourceKey)
    .maybeSingle();

  let meetingId: string;
  let status: MeetingStatus;
  if (existing !== null) {
    meetingId = existing.id as string;
    status = existing.status as MeetingStatus;
    await supabase
      .from('meetings')
      .update({ track: parsed.track, meeting_date: parsed.date })
      .eq('id', meetingId);
  } else {
    const { data: created, error } = await supabase
      .from('meetings')
      .insert({ track: parsed.track, meeting_date: parsed.date, source_key: sourceKey, status: 'open' })
      .select('id, status')
      .single();
    if (error !== null || created === null) {
      throw new Error(`Could not prepare the meeting: ${error?.message ?? 'unknown error'}`);
    }
    meetingId = created.id as string;
    status = created.status as MeetingStatus;
  }

  // ── legs ───────────────────────────────────────────────────────────────────
  const legRows = quaddie.map((race, i) => ({
    meeting_id: meetingId,
    leg_number: i + 1,
    race_number: race.number,
    race_name: race.name || null,
    race_time: race.time || null,
  }));
  const { error: legErr } = await supabase.from('legs').upsert(legRows, { onConflict: 'meeting_id,leg_number' });
  if (legErr !== null) throw new Error(`Could not sync the quaddie legs: ${legErr.message}`);

  const { data: legs } = await supabase
    .from('legs')
    .select('id, leg_number, race_number, field_source')
    .eq('meeting_id', meetingId);

  // ── runners (upsert so scratchings/weights update in place) ────────────────
  const runnerRows: Array<{
    leg_id: string;
    runner_number: number;
    runner_name: string | null;
    scratched: boolean;
    jockey: string | null;
    trainer: string | null;
    barrier: string | null;
    weight: string | null;
    benchmark: string | null;
    form: string | null;
  }> = [];
  const syncedLegIds: string[] = [];
  for (const leg of (legs ?? []) as Array<{ id: string; leg_number: number; race_number: number | null; field_source: string | null }>) {
    if (leg.race_number === null) continue;
    // A field a member pasted by hand is never overwritten by the feed.
    if (leg.field_source === 'manual') continue;
    const legRunners = runnerByRace.get(leg.race_number) ?? [];
    for (const r of legRunners) {
      runnerRows.push({
        leg_id: leg.id,
        runner_number: r.number,
        runner_name: r.name || null,
        scratched: r.scratched,
        jockey: r.jockey || null,
        trainer: r.trainer || null,
        barrier: r.barrier || null,
        weight: r.weight || null,
        benchmark: r.benchmark || null,
        form: r.form || null,
      });
    }
    if (legRunners.length > 0) syncedLegIds.push(leg.id);
  }

  if (runnerRows.length > 0) {
    const { error: runnerErr } = await supabase.from('runners').upsert(runnerRows, {
      onConflict: 'leg_id,runner_number',
    });
    if (runnerErr !== null) throw new Error(`Could not sync the fields: ${runnerErr.message}`);
  }

  if (syncedLegIds.length > 0) {
    await supabase.from('legs').update({ field_source: 'feed' }).in('id', syncedLegIds);
  }

  return { id: meetingId, track: parsed.track, meeting_date: parsed.date, status };
}
