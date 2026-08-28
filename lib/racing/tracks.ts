// Metro track whitelist for the Saturday meetings we ingest.
//
// VIC metro: Flemington, Caulfield, Moonee Valley, Sandown.
// NSW metro: Randwick, Rosehill Gardens, Warwick Farm, Canterbury Park.
//
// Matching is on a normalised track name (lowercased, non-alphanumerics
// stripped) plus a small alias table, because providers spell some tracks
// differently — the Ladbrokes feed reports "Rosehill" and "Randwick", while the
// Racing NSW feed reports "Rosehill Gardens" and "Royal Randwick". There is no
// reliable venue mnemonic in the Ladbrokes feed, so name is all we have.

export const VIC_METRO_TRACKS = ['Flemington', 'Caulfield', 'Moonee Valley', 'Sandown'] as const;
export const NSW_METRO_TRACKS = ['Randwick', 'Rosehill Gardens', 'Warwick Farm', 'Canterbury Park'] as const;

/** Canonical display name keyed by normalised name (so every source stores the
 *  same spelling in the DB). */
const CANONICAL: Record<string, string> = {
  flemington: 'Flemington',
  caulfield: 'Caulfield',
  mooneevalley: 'Moonee Valley',
  sandown: 'Sandown',
  randwick: 'Randwick',
  rosehillgardens: 'Rosehill Gardens',
  warwickfarm: 'Warwick Farm',
  canterburypark: 'Canterbury Park',
};

/** Alternative spellings → canonical normalised name. */
const ALIASES: Record<string, string> = {
  rosehill: 'rosehillgardens',
  royalrandwick: 'randwick',
  canterbury: 'canterburypark',
  mooneevalleyracecourse: 'mooneevalley',
};

/** Lowercase and strip everything that is not a-z0-9. */
export function normaliseTrackName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Canonical display name for a metro track, or null when it is not whitelisted. */
export function canonicalTrackName(name: string): string | null {
  const norm = normaliseTrackName(name);
  const canonical = CANONICAL[ALIASES[norm] ?? norm];
  return canonical ?? null;
}

/** Is this a whitelisted metro track for the given state? */
export function isMetroTrack(name: string, state: string): boolean {
  const canonical = canonicalTrackName(name);
  if (canonical === null) return false;
  const inVic = (VIC_METRO_TRACKS as readonly string[]).includes(canonical);
  const inNsw = (NSW_METRO_TRACKS as readonly string[]).includes(canonical);
  return (state === 'VIC' && inVic) || (state === 'NSW' && inNsw);
}
