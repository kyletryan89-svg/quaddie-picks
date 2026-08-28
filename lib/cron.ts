// Shared auth for the /api/cron routes. Vercel calls these on a schedule with
// a plain GET; the only thing standing between the internet and a data sync is
// this bearer token, so it must be a strong, server-only secret.

export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === '') return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token === secret;
}
