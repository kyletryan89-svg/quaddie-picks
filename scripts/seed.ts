// Seed script — rubric R7: 5 profiles, 2 settled meetings, 1 open meeting.
//
// Run: npm run seed   (needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// Service role throughout — this script stands in for "the group already exists".
// Re-runnable: wipes previous SEED-* fixtures and the five named profiles first.
// Picks/meetings are inserted directly (service role bypasses RLS); scoring is NOT
// computed here — the app derives everything from legs + picks at read time.

import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

const MEMBERS = ['Davo', 'Kylie', 'Tommo', 'Sarah', 'Jonesy'] as const;

interface LegSpec {
  legNumber: number;
  raceNumber: number;
  winnerNumber?: number;
  winnerName?: string;
  winnerSp?: number;
}
interface MeetingSpec {
  track: string;
  date: string;
  status: 'open' | 'locked' | 'settled';
  legs: LegSpec[];
  // userId -> legNumber -> runner numbers
  picks: Record<string, Record<number, number[]>>;
}

function requireEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === '') {
    console.error(`Missing env var ${key}`);
    process.exit(2);
  }
  return raw;
}

async function main(): Promise<void> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log('Wiping previous SEED fixtures…');
  await admin.from('meetings').delete().like('track', 'SEED-%');

  // Remove stale profiles with our member names (and their auth users) so re-runs
  // never duplicate members.
  const staleProfiles = await admin.from('profiles').select('id').in('display_name', [...MEMBERS]);
  if ((staleProfiles.data ?? []).length > 0) {
    const ids = (staleProfiles.data ?? []).map((p) => p.id);
    await admin.from('picks').delete().in('user_id', ids);
    await admin.from('meetings').update({ created_by: null }).in('created_by', ids);
    await admin.from('profiles').delete().in('id', ids);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  }

  console.log('Creating 5 member profiles…');
  const userIds: Record<string, string> = {};
  for (const name of MEMBERS) {
    // Anonymous sign-in gives us a real auth.users row per member; then stamp the profile.
    const client = createClient(url, anonKey);
    const { data: anon, error: anonErr } = await client.auth.signInAnonymously();
    if (anonErr !== null || anon.user === null) throw new Error(`anon sign-in failed for ${name}: ${anonErr?.message}`);
    const { error: profErr } = await admin.from('profiles').upsert({ id: anon.user.id, display_name: name });
    if (profErr !== null) throw new Error(`profile upsert failed for ${name}: ${profErr.message}`);
    userIds[name] = anon.user.id;
  }
  const [davo, kylie, tommo, sarah, jonesy] = MEMBERS.map((m) => userIds[m]);

  const meetings: MeetingSpec[] = [
    {
      track: 'SEED-Royal Randwick',
      date: '2026-08-08',
      status: 'settled',
      legs: [
        { legNumber: 1, raceNumber: 5, winnerNumber: 7, winnerName: 'Speedmap Special', winnerSp: 3.2 },
        { legNumber: 2, raceNumber: 6, winnerNumber: 2, winnerName: 'Barrier Rogue', winnerSp: 11.0 },
        { legNumber: 3, raceNumber: 7, winnerNumber: 1, winnerName: 'Favourite Frank', winnerSp: 1.9 },
        { legNumber: 4, raceNumber: 8, winnerNumber: 9, winnerName: 'Roughie Rolf', winnerSp: 26.0 },
      ],
      picks: {
        [davo]: { 1: [7], 2: [2], 3: [1], 4: [9] },
        [kylie]: { 1: [7], 2: [2, 5, 6], 3: [1], 4: [3] },
        [tommo]: { 1: [4, 7], 2: [8], 3: [1, 3, 6, 10], 4: [9, 11] },
        [sarah]: { 1: [7], 2: [2], 3: [1], 4: [4, 9] },
        [jonesy]: { 1: [12], 2: [2], 3: [14, 15], 4: [16, 17, 18] },
      },
    },
    {
      track: 'SEED-Rosehill',
      date: '2026-08-15',
      status: 'settled',
      legs: [
        { legNumber: 1, raceNumber: 4, winnerNumber: 6, winnerName: 'Wet Track Warrior', winnerSp: 4.5 },
        { legNumber: 2, raceNumber: 5, winnerNumber: 3, winnerName: 'Rail Hugging Rita', winnerSp: 6.5 },
        { legNumber: 3, raceNumber: 6, winnerNumber: 8, winnerName: 'Punters Pony', winnerSp: 2.6 },
        { legNumber: 4, raceNumber: 7, winnerNumber: 5, winnerName: 'Last Laugh Larry', winnerSp: 17.0 },
      ],
      picks: {
        [davo]: { 1: [6], 2: [3], 3: [8], 4: [5] },
        [kylie]: { 1: [1, 6], 2: [3, 9], 3: [8, 10, 11], 4: [12] },
        [tommo]: { 1: [13], 2: [3], 3: [8], 4: [5, 14] },
        [sarah]: { 1: [6], 2: [15, 16], 3: [17], 4: [18] },
        [jonesy]: { 1: [19, 20], 2: [21], 3: [22, 23], 4: [24, 25] },
      },
    },
    {
      track: 'SEED-Canterbury',
      date: '2026-08-29',
      status: 'open',
      legs: [
        { legNumber: 1, raceNumber: 3 },
        { legNumber: 2, raceNumber: 4 },
        { legNumber: 3, raceNumber: 5 },
        { legNumber: 4, raceNumber: 6 },
      ],
      picks: {
        [davo]: { 1: [2], 2: [1, 4] },
        [kylie]: { 1: [2, 6], 2: [3] },
        [tommo]: { 1: [8], 3: [2, 9, 10] },
      },
    },
  ];

  let pickCount = 0;
  for (const spec of meetings) {
    const { data: meeting, error } = await admin
      .from('meetings')
      .insert({ track: spec.track, meeting_date: spec.date, status: spec.status })
      .select('id')
      .single();
    if (error !== null || meeting === null) throw new Error(`meeting insert failed (${spec.track}): ${error?.message}`);

    const { error: legErr } = await admin.from('legs').insert(
      spec.legs.map((l) => ({
        meeting_id: meeting.id,
        leg_number: l.legNumber,
        race_number: l.raceNumber,
        ...(l.winnerNumber !== undefined
          ? { winner_number: l.winnerNumber, winner_name: l.winnerName, winner_sp: l.winnerSp }
          : {}),
      })),
    );
    if (legErr !== null) throw new Error(`legs insert failed (${spec.track}): ${legErr.message}`);

    const { data: legRows } = await admin.from('legs').select('id, leg_number').eq('meeting_id', meeting.id);
    const legIdByNumber = new Map((legRows ?? []).map((l) => [l.leg_number as number, l.id as string]));

    // M8: a pick points at a runner, so each leg needs its field first. The
    // field is every runner anyone tips in that leg, plus the winner.
    const numbersByLeg = new Map<number, Set<number>>();
    for (const l of spec.legs) {
      const set = new Set<number>();
      if (l.winnerNumber !== undefined) set.add(l.winnerNumber);
      numbersByLeg.set(l.legNumber, set);
    }
    for (const byLeg of Object.values(spec.picks)) {
      for (const [legNumber, runners] of Object.entries(byLeg)) {
        const set = numbersByLeg.get(Number(legNumber));
        if (set !== undefined) for (const n of runners) set.add(n);
      }
    }

    const runnerRows = [...numbersByLeg.entries()].flatMap(([legNumber, numbers]) =>
      [...numbers]
        .sort((a, b) => a - b)
        .map((n) => ({
          leg_id: legIdByNumber.get(legNumber) as string,
          runner_number: n,
          runner_name: `Runner #${n}`,
        })),
    );
    const { data: runnerData, error: runnerErr } = await admin.from('runners').insert(runnerRows).select('id, leg_id, runner_number');
    if (runnerErr !== null) throw new Error(`runners insert failed (${spec.track}): ${runnerErr.message}`);
    const runnerIdByLegAndNumber = new Map(
      (runnerData ?? []).map((r) => [`${r.leg_id as string}:${r.runner_number as number}`, r.id as string]),
    );

    const pickRows = Object.entries(spec.picks).flatMap(([userId, byLeg]) =>
      Object.entries(byLeg).flatMap(([legNumber, runners]) =>
        runners.map((runnerNumber) => {
          const legId = legIdByNumber.get(Number(legNumber)) as string;
          return {
            leg_id: legId,
            user_id: userId,
            runner_id: runnerIdByLegAndNumber.get(`${legId}:${runnerNumber}`) as string,
          };
        }),
      ),
    );
    if (pickRows.length > 0) {
      const { error: pickErr } = await admin.from('picks').insert(pickRows);
      if (pickErr !== null) throw new Error(`picks insert failed (${spec.track}): ${pickErr.message}`);
      pickCount += pickRows.length;
    }
    console.log(`  ${spec.track}: ${spec.status}, ${spec.legs.length} legs`);
  }

  console.log(`\nSeeded ${MEMBERS.length} members, ${meetings.length} meetings, ${pickCount} picks.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
