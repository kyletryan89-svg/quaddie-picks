// Shared test helper (M8). Since a pick now points at a runner, any script that
// wants picks must first give the leg a field.
//
// This drives the same `replace_leg_field` RPC the paste box calls, with the
// member's own JWT, so the fixtures go in through the real path rather than
// around it.

export interface FieldRunner {
  number: number;
  name: string;
}

export interface RunnerRow {
  id: string;
  leg_id: string;
  runner_number: number;
  runner_name: string | null;
}

/**
 * Give a leg a field and return runner number → runner id.
 * `token` must be a member's access token; the RPC refuses anonymous callers
 * and any meeting that is not open.
 */
export async function pasteField(opts: {
  url: string;
  anonKey: string;
  token: string;
  legId: string;
  runners: FieldRunner[];
}): Promise<Map<number, string>> {
  const res = await fetch(`${opts.url}/rest/v1/rpc/replace_leg_field`, {
    method: 'POST',
    headers: {
      apikey: opts.anonKey,
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_leg_id: opts.legId, p_runners: opts.runners }),
  });
  const body = (await res.json()) as RunnerRow[] | { message?: string };
  if (!Array.isArray(body)) {
    throw new Error(`replace_leg_field failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return new Map(body.map((r) => [r.runner_number, r.id]));
}

/**
 * A field big enough to contain every number the fixtures use in that leg,
 * named so assertions can recognise them on screen.
 */
export function fieldFor(numbers: readonly number[]): FieldRunner[] {
  return [...new Set(numbers)].sort((a, b) => a - b).map((n) => ({ number: n, name: `Runner ${n}` }));
}

/** Insert picks as a member, by runner id. Returns how many rows landed. */
export async function pickRunners(opts: {
  url: string;
  anonKey: string;
  token: string;
  userId: string;
  rows: Array<{ legId: string; runnerId: string }>;
}): Promise<number> {
  const res = await fetch(`${opts.url}/rest/v1/picks`, {
    method: 'POST',
    headers: {
      apikey: opts.anonKey,
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(opts.rows.map((r) => ({ leg_id: r.legId, user_id: opts.userId, runner_id: r.runnerId }))),
  });
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error(`pick insert failed (${res.status}): ${JSON.stringify(body)}`);
  return body.length;
}
