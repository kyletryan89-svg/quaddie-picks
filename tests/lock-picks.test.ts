import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('lock picks removal', () => {
  it('does not offer a Lock picks button or lockMeeting action', () => {
    const screen = source('app/(app)/meetings/[id]/MeetingScreen.tsx');
    const actions = source('app/actions/meetings.ts');
    expect(screen).not.toContain('Lock picks');
    expect(screen).not.toMatch(/\blockMeeting\b/);
    expect(actions).not.toMatch(/\blockMeeting\b/);
  });

  it('still lets an open meeting be settled', () => {
    const actions = source('app/actions/meetings.ts');
    const settlePage = source('app/(app)/meetings/[id]/settle/page.tsx');
    expect(actions).toContain("in('status', ['open', 'locked'])");
    expect(actions).toContain('already settled');
    expect(settlePage).not.toContain("status !== 'locked'");
    expect(settlePage).toContain("status === 'settled'");
  });

  it('keeps Edit picks for a meeting that is already locked', () => {
    const screen = source('app/(app)/meetings/[id]/MeetingScreen.tsx');
    expect(screen).toContain('Edit picks');
    expect(screen).toContain('unlockMeeting');
  });
});
