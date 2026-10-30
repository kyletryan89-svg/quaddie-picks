import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components')), ...walk(path.join(root, 'lib')), path.join(root, 'proxy.ts')];

describe('passcode gate removed', () => {
  it('does not keep a login route', () => {
    expect(existsSync(path.join(root, 'app/login'))).toBe(false);
  });

  it('has no passcode or login redirect in app code', () => {
    const hits: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('GROUP_PASSCODE') || text.includes("redirect('/login')") || text.includes('name="passcode"')) {
        hits.push(path.relative(root, file));
      }
    }
    expect(hits).toEqual([]);
  });

  it('does not sign in anonymously on the server, and a missing session is not a wall', () => {
    const proxy = readFileSync(path.join(root, 'proxy.ts'), 'utf8');
    const layout = readFileSync(path.join(root, 'app/(app)/layout.tsx'), 'utf8');
    expect(proxy).not.toContain('signInAnonymously');
    expect(layout).not.toContain('Could not open a session');
    expect(layout).toContain('SessionBootstrap');
  });

  it('still guards cron routes with CRON_SECRET', () => {
    for (const route of ['sync-fields', 'sync-results', 'sync-scratchings']) {
      const text = readFileSync(path.join(root, 'app/api/cron', route, 'route.ts'), 'utf8');
      expect(text).toContain('authorizeCron');
    }
    const cron = readFileSync(path.join(root, 'lib/cron.ts'), 'utf8');
    expect(cron).toContain('CRON_SECRET');
  });
});
