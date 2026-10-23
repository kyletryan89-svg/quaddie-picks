import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('chat placement', () => {
  it('does not mount the chat board on the meetings list', () => {
    expect(source('app/(app)/page.tsx')).not.toContain('ChatBoard');
  });

  it('does not mount the chat board above a meeting card', () => {
    expect(source('app/(app)/meetings/[id]/MeetingScreen.tsx')).not.toContain('ChatBoard');
  });

  it('serves chat from its own page', () => {
    const page = source('app/(app)/chat/page.tsx');
    expect(page).toContain('ChatBoard');
    expect(page).toContain('getProfiles');
  });

  it('links Chat from the app nav', () => {
    const layout = source('app/(app)/layout.tsx');
    expect(layout).toContain('href="/chat"');
    expect(layout).toContain('Chat');
  });
});
