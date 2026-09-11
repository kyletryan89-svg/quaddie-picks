// Domain model for the racing provider abstraction.
//
// Provider-specific field names, URLs and response shapes live inside
// lib/racing/providers/ — nothing in this file references them, so a new
// provider (or a replacement) can be dropped in without touching the sync,
// cron or UI layers.

export interface ProviderMeeting {
  /** Provider meeting id (opaque to the app). */
  id: string;
  /** Track name as the provider reports it (unnormalised). */
  track: string;
  /** Jurisdiction, e.g. "VIC" or "NSW". */
  state: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** The race card, in card order. */
  races: ProviderRace[];
}

export interface ProviderRace {
  /** Provider race id (opaque to the app). */
  id: string;
  /** 1-based race number on the card. */
  number: number;
  name: string;
  /** Scheduled jump time (ISO string or empty when unknown). */
  startTime: string;
  distance: number | null;
  trackCondition: string | null;
}

export interface ProviderRunner {
  number: number;
  name: string;
  scratched: boolean;
  jockey: string | null;
  trainer: string | null;
  barrier: string | null;
  /** Allocated weight, e.g. "59.5". */
  weight: string | null;
  /** Form line, e.g. "6x12022x79". */
  form: string | null;
}

export interface ProviderResult {
  winnerNumber: number;
  winnerName: string;
  /** Tote starting price — total return per $1 including stake. Null when the
   *  feed does not carry a tote win dividend (manual entry is then required). */
  winnerSp: number | null;
}

export interface Provider {
  readonly name: string;
  /** Saturday thoroughbred meetings. Metro filtering is applied downstream by
   *  the sync using the track whitelist (lib/racing/tracks.ts) — providers
   *  return the raw card and never make whitelist decisions. */
  getSaturdayMeetings(date: string): Promise<ProviderMeeting[]>;
  /** The race card for a meeting. */
  getCard(meetingId: string): Promise<ProviderRace[]>;
  /** Runners for a race, including the scratched flag. */
  getRunners(raceId: string): Promise<ProviderRunner[]>;
  /** Winner number, name and tote SP, or null if the race has not run yet. */
  getResult(raceId: string): Promise<ProviderResult | null>;
  /** Result and abandonment in one call. `abandoned` is true when the race was
   *  declared off (no winner can ever exist); `result` is null until it is run. */
  getOutcome(raceId: string): Promise<{ result: ProviderResult | null; abandoned: boolean }>;
}
