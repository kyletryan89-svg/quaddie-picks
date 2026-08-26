// Minimal .env.local loader for the standalone scripts (no dotenv dependency).
// Existing process.env values always win, so CI/shell overrides keep working.
import { readFileSync } from 'node:fs';

export function loadEnvLocal(): void {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
      if (match !== null && process.env[match[1]!] === undefined) {
        process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // .env.local is optional for some scripts (smoke/e2e can take pure env vars)
  }
}
