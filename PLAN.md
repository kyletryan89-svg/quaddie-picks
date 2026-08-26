# PLAN.md — Quaddie Picks Tracker

Authoritative spec: `~/Downloads/SPEC.md` (copied reference below). Build follows the AGENT LOOP in §8: milestone → implement → `npm run verify` → honest self-score into `PROGRESS.md` → commit.

## Product in one line

Private web app (~5 mates, NSW): create a quaddie meeting, everyone's picks visible live, lock before the jump, someone types the 4 winners + SPs, app scores legs/outlay/profit and keeps a season leaderboard. No ticket/payout/ticket-cost logic ever — individual leg scoring only.

## Environment findings (surveyed 2026-08-26)

- Node v22.16.0, npm 10.9.2. No pnpm/bun → **npm** throughout.
- Supabase CLI v2.30.4, **logged in**. Orgs: `Carrots` (txothanwlpgbhzmchsit), `wiatrewartha@gmail.com's Org` (qzuemanqmaranhkdkqbx). Three existing Sydney projects (all carrot-related, not ours).
- Docker Desktop: **not installed** → no local Supabase stack. All DB work targets a hosted project.
- Vercel CLI 44.2.13, **logged in** as `kyle-7604` → preview deploys authorized by spec R7.
- Repo location: `~/quaddie-picks` (own git repo; `~` is itself an unrelated git repo with everything untracked — nested repo is fine).

## Decisions already fixed by spec (§1–§6)

Stack, scoring model, SP convention, RLS shape, screens, non-goals — implemented exactly as written. Key traps I will respect:

- SP is total return per $1 (never subtract 1 except inside profit = return − outlay).
- Duplicate picks score in full for every picker; multi-picks cost $1 each; a leg hit pays `winner_sp` **once** regardless of shotgun width.
- `scoreMeeting(legs, picks)` pure in `lib/scoring.ts`, unit-tested before any results UI.
- Picks insert/delete gated by `status='open'` **in the RLS policy**, not just UI.

## My decisions (D-series; logged in DECISIONS.md as made)

| # | Decision |
|---|----------|
| D1 | Project root `~/quaddie-picks`. Next.js latest (App Router, TS strict), Tailwind, Vitest, npm. |
| D2 | Supabase JS v2 + `@supabase/ssr` cookie sessions; anonymous sign-in on login success; profiles upsert keyed off `auth.uid()`. |
| D3 | Realtime: one client-side subscription on `picks` filtered to the meeting's leg ids. |
| D4 | Season = rolling 1 Aug–31 Jul computed from today's date; leaderboard defaults to current season, selector lists seasons present in data. |
| D5 | Security tests (R2) are integration tests against the hosted DB: two+ anonymous sign-in sessions exercise the policies; unique `TEST-` prefixed fixtures; cleanup via service-role key supplied only through env (never committed, never used client-side). |
| D6 | Seed script (M9) uses service role to create 5 anon-auth profiles + fixtures; runs against the preview-linked project. |
| D7 | `GROUP_PASSCODE` generated locally, lives in `.env.local` / `.env.example` / Vercel env; referenced only in a server action module. |
| D8 | `vercel.json` pins functions region `syd1`. |
| D9 | Errors surface as inline UI messages; loading/empty states on every list (R6). |

## Open question(s) — asked once, in one batch

**Q1. Database target:** create a fresh hosted Supabase project (Sydney) for this app, or reuse an existing carrot project? Recommended: fresh project named `quaddie-picks` under the Carrots org — clean schema, no risk to existing apps. Answer pending → recorded in DECISIONS.md when given.

*(No other blocking questions: passcode value, repo path, deploy project name are all reversible details covered by D-series.)*

## Milestone → rubric map

| Milestone | Scope | Rubric |
|-----------|-------|--------|
| M0 | Scaffold, Tailwind, Vitest, `.env.example`, `vercel.json`, `npm run verify` chain | R1 |
| M1 | Schema/migrations, RLS, security integration tests | R2 |
| M2 | Login/passcode server action, profiles, redirects | R3 |
| M3 | `lib/scoring.ts` + full suite + `docs/scoring-examples.md` — **before any results UI** | R4 |
| M4 | Meetings list + create + legs | R1,R6 |
| M5 | Meeting screen: picks CRUD, realtime, live outlay counter | R5,R6 |
| M6 | Lock + settle + per-meeting result table | R4,R5 |
| M7 | Season leaderboard, both sorts | R5 |
| M8 | Mobile pass @390px, empty/loading/error everywhere | R6 |
| M9 | Seed, README, Vercel preview deploy, smoke test | R7 |

Loop discipline: no milestone advances with a failing item in its section; three consecutive failures on an item → stop and report. Nothing marked passed without executing something.
