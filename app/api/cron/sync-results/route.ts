import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { targetSaturdayISO } from '@/lib/racing/dates';
import { ladbrokes } from '@/lib/racing/providers/ladbrokes';
import { syncResults } from '@/lib/racing/sync';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Cron: Sat 17:00, 19:00, 21:00 AEST (see vercel.json for the UTC expressions).
export async function GET(request: Request): Promise<NextResponse> {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const db = createServiceClient();
    const summary = await syncResults(db, ladbrokes, targetSaturdayISO());
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
