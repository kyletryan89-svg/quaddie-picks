// Display names are the only identity a member types. The passcode is gone;
// the ladder still folds these strings onto Kyle, Leigh, Steve, Pete and Chris.

const MAX_LENGTH = 40;

export const NAME_REQUIRED = 'Add your name at the top so this is yours.';

export type DisplayNameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateDisplayName(raw: string): DisplayNameResult {
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_LENGTH) {
    return { ok: false, error: 'Enter a name (up to 40 characters).' };
  }
  return { ok: true, name };
}

/** True when this browser's profile is already in the names map the page loaded. */
export function hasDisplayName(names: Record<string, string>, userId: string): boolean {
  return (names[userId] ?? '').trim() !== '';
}
