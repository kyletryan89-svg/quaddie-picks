// A feature race is a single race on a meeting that gets its own exotic picks
// (trifecta and first 4), separate from the quaddie. Melbourne Cup is the one
// that must match; the section is keyed by meeting id + race number.

const FEATURE_PATTERNS: readonly RegExp[] = [/melbourne cup/i];

export interface FeatureRace {
  raceNumber: number;
  label: string;
}

export function featureRaces(
  legs: ReadonlyArray<{ race_number: number | null; race_name: string | null }>,
): FeatureRace[] {
  const out: FeatureRace[] = [];
  for (const leg of legs) {
    if (leg.race_number === null || leg.race_name === null || leg.race_name.trim() === '') continue;
    if (!FEATURE_PATTERNS.some((pattern) => pattern.test(leg.race_name!))) continue;
    out.push({ raceNumber: leg.race_number, label: leg.race_name.trim() });
  }
  return out;
}
