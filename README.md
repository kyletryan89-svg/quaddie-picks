# Quaddie Picks Tracker

Private app for a small NSW crew who play the quaddie. Each Saturday the app pulls the
metropolitan meetings straight from the Racing NSW form guide; you pick a meeting, see
the quaddie (always the last four races), tap your runners, and watch everyone else's
picks appear live. Picks lock before the jump, someone types in the four winners +
starting prices, and the app scores every member leg by leg and keeps the season
leaderboard. A comment box sits under the card. Scoring is individual legs only —
**no tickets, no dividends, no payouts**; the real bet is settled privately between members.

Stack: Next.js (App Router) · TypeScript strict · Tailwind · Supabase (Postgres + Auth +
Realtime, RLS on) · Vitest · Vercel (`syd1`).

## How it works

- **Meetings** come from the [Racing NSW FreeFields](https://racing.racingnsw.com.au/FreeFields/)
  calendar feed — no manual entry. The app mirrors the upcoming Saturday metro cards
  (Randwick, Rosehill, Warwick Farm, Canterbury, Kensington) into Postgres on demand.
- **The quaddie is the last four races** of the card, runners and all, shown with their
  form guide detail (jockey, weight, barrier, form). Scratchings are marked.
- **Picks** are taps on a runner; they sync live via Supabase Realtime. **Comments**
  live on the same screen.
- **Settle + leaderboard** are unchanged: type the four winners + SPs, and the season
  ladder aggregates everything.

## Environment variables

| Variable | Where it lives | What it is |
|----------|----------------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local`, Vercel | Your Supabase project URL, e.g. `https://abcdefgh.supabase.co`. Public by design. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local`, Vercel | Supabase anon/public key. Public by design — RLS is the security boundary. |
| `GROUP_PASSCODE` | `.env.local`, Vercel (**server-only**) | The group passcode checked inside a server action. Never prefixed `NEXT_PUBLIC_`; never referenced from client code. |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` only — **not** needed on Vercel | Bypasses RLS. Used exclusively by `npm run seed` and `npm run test:security` cleanup. Never import it from app code. |

Copy `.env.example` → `.env.local` and fill these in before anything else.

## Deploy from scratch

1. **Supabase project**
   ```bash
   supabase login
   supabase projects create quaddie-picks --org-id <your-org-id> \
     --db-password <strong-password> --region ap-southeast-2
   supabase link --project-ref <project-ref>
   ```
2. **Auth settings** (Supabase dashboard → Authentication): enable **Anonymous
   sign-ins**. Nothing else to configure — no emails, no redirects.
3. **Database schema**
   ```bash
   supabase db push          # applies supabase/migrations/*.sql (tables + RLS + realtime)
   ```
4. **Env vars in Vercel** (Project → Settings → Environment Variables): add
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GROUP_PASSCODE`.
   Do **not** add `SUPABASE_SERVICE_ROLE_KEY` to Vercel.
5. **Deploy**
   ```bash
   vercel link
   vercel deploy             # or: git push if connected to a repo
   ```
   `vercel.json` pins serverless functions to `syd1` so latency stays local.
6. **Seed the roster (optional)**
   ```bash
   npm run seed              # creates the 5 member profiles (no meetings)
   ```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run verify` | typecheck + lint + unit tests (the pre-commit gate) |
| `npm run test:security` | RLS integration tests against the live database |
| `npm run test:auth` | Login flow tests against a running server |
| `npm run test:e2e` | Feed-driven flow (list → quaddie → picks → comments) against a running server |
| `npm run seed` | Create the 5 member profiles |
| `npm run smoke` | Smoke-test a deployed URL (pass `BASE_URL=https://…`) |

## Scoring in one paragraph

Every selection is a notional $1 win bet. A leg hit = your runner won that leg = 1
point plus the leg winner's SP added to your return **once**, no matter how many runners
you picked or how many mates also had it — credit is never split or diluted. Outlay =
selections × $1; profit = return − outlay; POT% = profit ÷ outlay. Solo legs and full
covers are flags for bragging rights only. Full worked examples with hand-computed
tables: [`docs/scoring-examples.md`](docs/scoring-examples.md).

## Season

The Australian racing season runs 1 Aug – 31 Jul. The leaderboard filters on the
current season by default. The meetings list shows the upcoming Saturday metro cards
regardless of season.
