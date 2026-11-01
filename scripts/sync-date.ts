// Load metro meetings for one date (meetings, quaddie legs, runners).
//
// The home page only inserts rows when the visitor already has a session, and
// the Saturday cron never asks for a Tuesday. This uses the service role.
//
//   DATE=2026-11-03 npm run sync:date
//   npx tsx scripts/sync-date.ts 2026-11-03
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local
// or the shell). Does not delete anything.

import { canonicalTrackName, isMetroTrack } from '@/lib/racing/tracks';
import { ladbrokes } from '@/lib/racing/providers/ladbrokes';
import { syncFields } from '@/lib/racing/sync';
import { createServiceClient } from '@/lib/supabase/service';
import { loadEnvLocal } from './load-env';

loadEnvLocal();

function dateArg(): string {
  const fromArg = process.argv[2];
  const raw = fromArg !== undefined && fromArg !== '' ? fromArg : process.env.DATE;
  if (raw === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    console.error('Pass a date: DATE=2026-11-03 npm run sync:date');
    process.exit(2);
  }
  return raw;
}

async function main(): Promise<void> {
  const date = dateArg();
  const meetings = await ladbrokes.getMeetings(date, date);
  const metro = meetings.filter((m) => isMetroTrack(m.track, m.state));
  if (metro.length === 0) {
    console.error(`Ladbrokes returned no metro meetings for ${date}.`);
    process.exit(1);
  }
  for (const meeting of metro) {
    const races = [...meeting.races].sort((a, b) => a.number - b.number);
    const quaddie = races.slice(-4);
    console.log(`\n${canonicalTrackName(meeting.track)} (${meeting.state}) ${meeting.date}`);
    for (const race of races) console.log(`  R${race.number} ${race.name}`);
    console.log(`  quaddie (last 4): ${quaddie.map((r) => `R${r.number}`).join(', ')}`);
  }

  const db = createServiceClient();
  const summary = await syncFields(db, ladbrokes, date);
  console.log('\n', JSON.stringify(summary));
  if (summary.error !== null) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
