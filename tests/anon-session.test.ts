import { describe, expect, it } from 'vitest';
import { anonSignInDelayMs, signInAnonymouslyWithRetry } from '@/lib/anon-session';

describe('signInAnonymouslyWithRetry', () => {
  it('stops on the first success and does not wait', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const ok = await signInAnonymouslyWithRetry(
      async () => {
        calls += 1;
        return { ok: true };
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(ok).toBe(true);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('backs off and retries, then gives up', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const ok = await signInAnonymouslyWithRetry(
      async () => {
        calls += 1;
        return { ok: false };
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(ok).toBe(false);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([anonSignInDelayMs(1), anonSignInDelayMs(2)]);
  });
});
