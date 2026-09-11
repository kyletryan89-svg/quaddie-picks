// Database row shapes used across the app. Hand-maintained to mirror
// supabase/migrations/*.sql exactly.

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
  /** Racing NSW feed key, e.g. "2026Aug29,NSW,Rosehill Gardens". */
  source_key: string | null;
  created_by: string | null;
  created_at: string;
  /** Who last reopened a locked meeting, and when (null until then). */
  reopened_by: string | null;
  reopened_at: string | null;
}

export interface Leg {
  id: string;
  meeting_id: string;
  leg_number: number;
  race_number: number | null;
  /** Race name from the form guide, e.g. "UP AND COMING STAKES". */
  race_name: string | null;
  /** Jump time, e.g. "3:15PM". */
  race_time: string | null;
  /** null until settled */
  winner_number: number | null;
  winner_name: string | null;
  /** numeric(7,2) arrives from PostgREST as a string — total return per $1 */
  winner_sp: string | null;
  /** True when the race was abandoned and will never have a winner. */
  abandoned: boolean;
}

/** One runner in a leg's field, mirrored from the Racing NSW feed. */
export interface Runner {
  id: string;
  leg_id: string;
  runner_number: number;
  runner_name: string | null;
  scratched: boolean;
  /** Form-guide detail (display only; never used in scoring). */
  jockey: string | null;
  trainer: string | null;
  barrier: string | null;
  weight: string | null;
  benchmark: string | null;
  form: string | null;
  created_at: string;
}

/** A member's selection: a pointer at a runner, never free text. */
export interface Pick {
  id: string;
  leg_id: string;
  user_id: string;
  runner_id: string;
  created_at: string;
  /** 1 = first pick, 2 = second pick, 3 = third pick, null = unranked. Display only. */
  rank: number | null;
}

/** A comment posted against a single leg. */
export interface LegComment {
  id: string;
  leg_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

/** A message on the group chat board. user_id is null when is_anonymous (the
 *  read view omits it). */
export interface ChatMessage {
  id: string;
  body: string;
  created_at: string;
  is_anonymous: boolean;
  user_id: string | null;
}

/** A message on the meeting's side panel. */
export interface Comment {
  id: string;
  meeting_id: string;
  user_id: string;
  body: string;
  created_at: string;
}
