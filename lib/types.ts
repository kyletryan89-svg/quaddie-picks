// Database row shapes used across the app. Hand-maintained to mirror
// supabase/migrations/*.sql exactly — there are only four tables.

export type MeetingStatus = 'open' | 'locked' | 'settled';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface Meeting {
  id: string;
  track: string;
  /** ISO date string, e.g. 2026-08-29 */
  meeting_date: string;
  status: MeetingStatus;
  created_by: string | null;
  created_at: string;
}

export interface Leg {
  id: string;
  meeting_id: string;
  leg_number: number;
  race_number: number | null;
  /** null until settled */
  winner_number: number | null;
  winner_name: string | null;
  /** numeric(7,2) arrives from PostgREST as a string — total return per $1 */
  winner_sp: string | null;
}

export interface Pick {
  id: string;
  leg_id: string;
  user_id: string;
  runner_number: number;
  runner_name: string | null;
  created_at: string;
}
