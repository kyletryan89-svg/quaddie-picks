import { describe, expect, it } from 'vitest';
import { displayStatus, isUnsettled } from '@/lib/meeting-status';

describe('meeting status', () => {
  it('treats a locked row as still open', () => {
    expect(isUnsettled('open')).toBe(true);
    expect(isUnsettled('locked')).toBe(true);
    expect(isUnsettled('settled')).toBe(false);
    expect(displayStatus('locked')).toBe('open');
    expect(displayStatus('settled')).toBe('settled');
  });
});
