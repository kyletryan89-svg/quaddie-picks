// Ingestion sync: mirror the provider's metro meetings into Supabase.
//
// All the M3 rules live here:
//   - idempotent (upserts; running twice yields identical rows)
//   - never overwrites a manually entered value (field_source / winner_source)
//   - scratchings set scratched=true and never delete picks (runner ids are
//     stable under `on conflict (leg_id, runner_number)`, so picks survive)
//   - every run is written to sync_log (a row per meeting, plus a job-level row
//     when a run fails before touching any meeting)
//
// Pages never call these during a render — reads come from Supabase. The cron
// routes and the "Sync now" action are the only callers.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Provider, ProviderMeeting, ProviderRace, ProviderRunner } from '@/lib/racing/provider';
import { canonicalTrackName, isMetroTrack } from '@/lib/racing/tracks';

export const SOURCE_PREFIX = 'ladbrokes:';

const QUADDIE_LEGS = 4;

export interface SyncSummary {
  job: string;
  provider: string;
  meetingCount: number;
  rowsTouched: number;
  error: string | null;
}

export interface RunRow {
  job: string;
  provider: string;
  meeting_id: string | null;
  started: string;
  rows_touched: number;
  error: string | null;
}

function sourceKey(providerMeetingId: string): string {
  return `${SOURCE_PREFIX}${providerMeetingId}`;
}

function lastRaces(races: ProviderRace[], n: number): ProviderRace[] {
  const sorted = [...races].sort((a, b) => a.number - b.number);
  return sorted.slice(-n);
}

/** AEST display time for a leg, from the provider's ISO UTC start time. */
function raceTime(iso: string): string {
  if (iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function runnerRow(legId: string, r: ProviderRunner) {
  return {
    leg_id: legId,
    runner_number: r.number,
    runner_name: r.name || null,
    scratched: r.scratched,
    jockey: r.jockey ?? null,
    trainer: r.trainer ?? null,
    barrier: r.barrier ?? null,
    weight: r.weight ?? null,
    form: r.form ?? null,
  };
}

interface DbMeeting {
  id: string;
  status: string;
}

async function upsertMeeting(
  db: SupabaseClient,
  m: ProviderMeeting,
): Promise<DbMeeting> {
  const track = canonicalTrackName(m.track) ?? m.track;
  const key = sourceKey(m.id);

  // Identity is (track, meeting_date), not source_key: the key differs between
  // providers (and a manual card has none), so a Ladbrokes card must adopt any
  // existing row for the same track+date rather than insert a duplicate that
  // trips meetings_track_meeting_date_unique. Adoption stamps the Ladbrokes key
  // so the meeting becomes Ladbrokes-sourced from here on.
  const { data: existing } = await db
    .from('meetings')
    .select('id, status')
    .eq('track', track)
    .eq('meeting_date', m.date)
    .maybeSingle();

  if (existing !== null) {
    await db
      .from('meetings')
      .update({ track, meeting_date: m.date, source_key: key })
      .eq('id', existing.id as string);
    return { id: existing.id as string, status: existing.status as string };
  }

  const { data: created, error } = await db
    .from('meetings')
    .insert({ track, meeting_date: m.date, source_key: key, status: 'open' })
    .select('id, status')
    .single();
  if (error !== null || created === null) {
    throw new Error(`could not prepare meeting ${track}: ${error?.message ?? 'unknown'}`);
  }
  return { id: created.id as string, status: created.status as string };
}

/** Sync one meeting's card (legs) and, where the field is not manually owned,
 *  the full runner field. Idempotent. */
async function syncMeetingField(
  db: SupabaseClient,
  provider: Provider,
  m: ProviderMeeting,
): Promise<number> {
  const meeting = await upsertMeeting(db, m);
  const quaddie = lastRaces(m.races, QUADDIE_LEGS);
  let rows = 0;

  const legRows = quaddie.map((race, i) => ({
    meeting_id: meeting.id,
    leg_number: i + 1,
    race_number: race.number,
    race_name: race.name || null,
    race_time: raceTime(race.startTime) || null,
  }));
  const { error: legErr } = await db.from('legs').upsert(legRows, { onConflict: 'meeting_id,leg_number' });
  if (legErr !== null) throw new Error(`could not sync legs: ${legErr.message}`);
  rows += legRows.length;

  const { data: legs, error: legsErr } = await db
    .from('legs')
    .select('id, leg_number, race_number, field_source')
    .eq('meeting_id', meeting.id);
  if (legsErr !== null) throw new Error(`could not read legs: ${legsErr.message}`);

  for (const leg of (legs ?? []) as Array<{
    id: string;
    race_number: number | null;
    field_source: string | null;
  }>) {
    if (leg.race_number === null) continue;
    if (leg.field_source === 'manual') continue; // a pasted field is never overwritten

    let runners: ProviderRunner[];
    try {
      const race = quaddie.find((r) => r.number === leg.race_number);
      if (race === undefined) continue;
      runners = await provider.getRunners(race.id);
    } catch {
      // Acceptances not published yet — leave whatever is in the DB.
      continue;
    }

    const rows2 = runners.map((r) => runnerRow(leg.id, r));
    if (rows2.length > 0) {
      const { error: runErr } = await db.from('runners').upsert(rows2, { onConflict: 'leg_id,runner_number' });
      if (runErr !== null) throw new Error(`could not sync runners: ${runErr.message}`);
      rows += rows2.length;
    }
    await db.from('legs').update({ field_source: 'feed' }).eq('id', leg.id);
  }

  return rows;
}

async function writeLog(db: SupabaseClient, row: RunRow): Promise<void> {
  const { error } = await db.from('sync_log').insert({
    job: row.job,
    provider: row.provider,
    meeting_id: row.meeting_id,
    started: row.started,
    finished: new Date().toISOString(),
    rows_touched: row.rows_touched,
    error: row.error,
  });
  if (error !== null) {
    // Logging must not take down the job; this is best-effort.
    console.error('sync_log insert failed:', error.message);
  }
}

/**
 * Metro meetings for a Saturday, whitelisted by track (M2). Ladbrokes is now the
 * single source for every VIC + NSW metro track; the Racing NSW feed no longer
 * creates rows, so there is no duplicate to avoid (reverses D22).
 */
async function metroMeetings(provider: Provider, date: string): Promise<ProviderMeeting[]> {
  const meetings = await provider.getSaturdayMeetings(date);
  return meetings.filter((m) => isMetroTrack(m.track, m.state));
}

/** Run a job across every whitelisted metro meeting, logging each outcome. */
async function runJob(
  db: SupabaseClient,
  provider: Provider,
  date: string,
  job: string,
  work: (m: ProviderMeeting) => Promise<number>,
): Promise<SyncSummary> {
  const started = new Date().toISOString();
  const meetings = await metroMeetings(provider, date);
  let rowsTouched = 0;
  let error: string | null = null;

  if (meetings.length === 0) {
    await writeLog(db, { job, provider: provider.name, meeting_id: null, started, rows_touched: 0, error: 'no metro meetings' });
    return { job, provider: provider.name, meetingCount: 0, rowsTouched: 0, error: 'no metro meetings' };
  }

  for (const m of meetings) {
    let meetingId: string | null = null;
    try {
      const { data } = await db
        .from('meetings')
        .select('id')
        .eq('source_key', sourceKey(m.id))
        .maybeSingle();
      meetingId = (data?.id as string | undefined) ?? null;
      const n = await work(m);
      rowsTouched += n;
      await writeLog(db, { job, provider: provider.name, meeting_id: meetingId, started, rows_touched: n, error: null });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await writeLog(db, { job, provider: provider.name, meeting_id: meetingId, started, rows_touched: 0, error });
    }
  }

  return { job, provider: provider.name, meetingCount: meetings.length, rowsTouched, error };
}

/** sync-fields: meetings + legs + runner fields for the target Saturday. */
export async function syncFields(
  db: SupabaseClient,
  provider: Provider,
  date: string,
): Promise<SyncSummary> {
  return runJob(db, provider, date, 'sync-fields', (m) => syncMeetingField(db, provider, m));
}

/**
 * Create the meeting rows + quaddie legs for a Saturday without fetching the
 * runner fields. This is the meetings-list ingestion path (replacing the Racing
 * NSW feed): it makes a card appear as soon as the provider publishes it, and is
 * idempotent, so it is cheap to run on every list render. Runner fields still
 * arrive through the fields/scratchings crons and the per-meeting "Sync now".
 */
export async function syncMeetings(
  db: SupabaseClient,
  provider: Provider,
  date: string,
): Promise<number> {
  const meetings = await metroMeetings(provider, date);
  let rows = 0;
  for (const m of meetings) {
    const meeting = await upsertMeeting(db, m);
    const quaddie = lastRaces(m.races, QUADDIE_LEGS);
    const legRows = quaddie.map((race, i) => ({
      meeting_id: meeting.id,
      leg_number: i + 1,
      race_number: race.number,
      race_name: race.name || null,
      race_time: raceTime(race.startTime) || null,
    }));
    const { error } = await db.from('legs').upsert(legRows, { onConflict: 'meeting_id,leg_number' });
    if (error !== null) throw new Error(`could not sync legs: ${error.message}`);
    rows += legRows.length;
  }
  return rows;
}

/**
 * Sync a single meeting's field by provider id — the "Sync now" path. Uses the
 * existing DB row for track/date (it is already canonical), fetches the card
 * and runners, and returns the number of rows touched.
 */
export async function syncMeetingFieldById(
  db: SupabaseClient,
  provider: Provider,
  providerMeetingId: string,
): Promise<number> {
  const races = await provider.getCard(providerMeetingId);
  const { data: existing } = await db
    .from('meetings')
    .select('track, meeting_date')
    .eq('source_key', sourceKey(providerMeetingId))
    .maybeSingle();
  const meeting: ProviderMeeting = {
    id: providerMeetingId,
    track: existing?.track ?? '',
    state: 'VIC',
    date: existing?.meeting_date ?? '',
    races,
  };
  return syncMeetingField(db, provider, meeting);
}

/** sync-scratchings: refresh the scratched flag (and late field changes). */
export async function syncScratchings(
  db: SupabaseClient,
  provider: Provider,
  date: string,
): Promise<SyncSummary> {
  return runJob(db, provider, date, 'sync-scratchings', async (m) => {
    const { data: meeting } = await db
      .from('meetings')
      .select('id')
      .eq('source_key', sourceKey(m.id))
      .maybeSingle();
    if (meeting === null) return 0;
    const { data: legs, error: legsErr } = await db
      .from('legs')
      .select('id, race_number, field_source')
      .eq('meeting_id', meeting.id as string);
    if (legsErr !== null) throw new Error(`could not read legs: ${legsErr.message}`);
    let rows = 0;
    for (const leg of (legs ?? []) as Array<{ id: string; race_number: number | null; field_source: string | null }>) {
      if (leg.race_number === null || leg.field_source === 'manual') continue;
      const race = m.races.find((r) => r.number === leg.race_number);
      if (race === undefined) continue;
      let runners: ProviderRunner[];
      try {
        runners = await provider.getRunners(race.id);
      } catch {
        continue;
      }
      const rows2 = runners.map((r) => runnerRow(leg.id, r));
      if (rows2.length > 0) {
        const { error } = await db.from('runners').upsert(rows2, { onConflict: 'leg_id,runner_number' });
        if (error !== null) throw new Error(`could not sync scratchings: ${error.message}`);
        rows += rows2.length;
      }
    }
    return rows;
  });
}

/** sync-results: winner number, name and tote SP into the legs, for both VIC
 *  and NSW metro meetings. Matches the provider meeting to the DB row by
 *  canonical track name + date — `source_key` differs between providers (and the
 *  manual Sandown has none), so the key is not used here. Never overwrites a
 *  winner a member entered by hand (`winner_source = 'manual'`). Auto-settles the
 *  meeting once every leg has a winner. */
export async function syncResults(
  db: SupabaseClient,
  provider: Provider,
  date: string,
): Promise<SyncSummary> {
  const started = new Date().toISOString();
  const job = 'sync-results';
  const meetings = (await provider.getSaturdayMeetings(date)).filter((m) =>
    isMetroTrack(m.track, m.state),
  );
  let rowsTouched = 0;
  let error: string | null = null;

  if (meetings.length === 0) {
    await writeLog(db, { job, provider: provider.name, meeting_id: null, started, rows_touched: 0, error: 'no metro meetings' });
    return { job, provider: provider.name, meetingCount: 0, rowsTouched: 0, error: 'no metro meetings' };
  }

  for (const m of meetings) {
    const canonical = canonicalTrackName(m.track);
    if (canonical === null) continue;
    let meetingId: string | null = null;
    try {
      const { data: rows } = await db
        .from('meetings')
        .select('id, track')
        .eq('meeting_date', m.date);
      const dbMeeting = (rows ?? []).find((r) => canonicalTrackName(r.track) === canonical);
      if (dbMeeting === undefined) continue; // no matching meeting in the table
      meetingId = dbMeeting.id as string;

      const { data: legs, error: legsErr } = await db
        .from('legs')
        .select('id, race_number, winner_number, abandoned')
        .eq('meeting_id', meetingId);
      if (legsErr !== null) throw new Error(`could not read legs: ${legsErr.message}`);

      let n = 0;
      for (const leg of (legs ?? []) as Array<{
        id: string;
        race_number: number | null;
        winner_number: number | null;
        abandoned: boolean;
      }>) {
        // A leg with a winner (feed or manual) or a known abandonment is done.
        if (leg.race_number === null || leg.winner_number !== null || leg.abandoned) continue;

        const race = m.races.find((r) => r.number === leg.race_number);
        if (race === undefined) continue;
        let outcome;
        try {
          outcome = await provider.getOutcome(race.id);
        } catch {
          continue;
        }
        if (outcome.abandoned) {
          const { error: abErr } = await db.from('legs').update({ abandoned: true }).eq('id', leg.id);
          if (abErr !== null) throw new Error(`could not mark leg abandoned: ${abErr.message}`);
          n += 1;
        } else if (outcome.result !== null) {
          const { error: upErr } = await db
            .from('legs')
            .update({
              winner_number: outcome.result.winnerNumber,
              winner_name: outcome.result.winnerName,
              winner_sp: outcome.result.winnerSp?.toFixed(2) ?? null,
              winner_source: 'feed',
            })
            .eq('id', leg.id);
          if (upErr !== null) throw new Error(`could not sync results: ${upErr.message}`);
          n += 1;
        }
      }

      // Auto-settle once every leg is resolved: it has a winner or was abandoned.
      const { data: done } = await db.from('legs').select('winner_number, abandoned').eq('meeting_id', meetingId);
      const complete =
        (done ?? []).length === 4 &&
        (done ?? []).every((l) => l.winner_number !== null || l.abandoned === true);
      if (complete) {
        await db.from('meetings').update({ status: 'settled' }).eq('id', meetingId).eq('status', 'locked');
      }

      rowsTouched += n;
      await writeLog(db, { job, provider: provider.name, meeting_id: meetingId, started, rows_touched: n, error: null });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await writeLog(db, { job, provider: provider.name, meeting_id: meetingId, started, rows_touched: 0, error });
    }
  }

  return { job, provider: provider.name, meetingCount: meetings.length, rowsTouched, error };
}
