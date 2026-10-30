import { describe, expect, it } from 'vitest';
import { hasDisplayName, validateDisplayName } from '@/lib/display-name';

describe('validateDisplayName', () => {
  it('trims and accepts a normal name', () => {
    expect(validateDisplayName('  Kyle  ')).toEqual({ ok: true, name: 'Kyle' });
  });

  it('rejects an empty name', () => {
    const result = validateDisplayName('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects a name over 40 characters', () => {
    const result = validateDisplayName('a'.repeat(41));
    expect(result.ok).toBe(false);
  });

  it('accepts a name of exactly 40 characters', () => {
    const name = 'a'.repeat(40);
    expect(validateDisplayName(name)).toEqual({ ok: true, name });
  });
});

describe('hasDisplayName', () => {
  it('is false until this user id is in the map', () => {
    expect(hasDisplayName({}, 'user-1')).toBe(false);
    expect(hasDisplayName({ 'user-1': '   ' }, 'user-1')).toBe(false);
    expect(hasDisplayName({ 'user-1': 'Kyle' }, 'user-1')).toBe(true);
  });
});
