# PROGRESS.md — build log & rubric scorecard

Spec: `~/Downloads/SPEC.md` · Plan: `PLAN.md` · Decisions: `DECISIONS.md`
Verify gate: `npm run verify` (typecheck + lint + unit tests). Nothing is marked PASS unless executed.

Scoring legend per item: ✅ PASS (executed & verified) · ❌ FAIL · ⏸ DEFERRED (with reason) · ➖ N/A this milestone

---

## Milestone scorecard

*(appended after each milestone)*

| Ms | Rubric | Item | Result | Evidence |
|----|--------|------|--------|----------|
| M0 | R1 | `tsc --noEmit` clean, `strict: true` in tsconfig | ✅ PASS | `npm run typecheck` exit 0 (TS 5.9.3, tsconfig `strict: true`) |
| M0 | R1 | `npm run lint` clean | ✅ PASS | `npm run lint` exit 0 (eslint 9 + eslint-config-next@16 native flat config) |
| M0 | R1 | No `any` in `lib/`, no `@ts-ignore` anywhere | ✅ PASS | grep for `: any`/`as any`/`<any>`/`any[]` in lib/ → 0 matches; grep `@ts-ignore\|@ts-expect-error\|@ts-nocheck` in app/lib/components/scripts/tests → 0 matches |
| M0 | R1 | No secrets in client components; `GROUP_PASSCODE` referenced only in server code | ✅ PASS | grep GROUP_PASSCODE → only `app/actions/auth.ts` (`'use server'`) + `scripts/e2e-test.ts` (Node script). Zero client components. `.env.local` gitignored |
| M0 | R4 | `lib/scoring.ts` is pure: no imports from `next`, `react`, `@supabase/*` | ✅ PASS | unit test "imports nothing from next, react, or @supabase/*" passes (module has zero imports at all) |
| M0 | R4 | Unit tests cover the 10 mandated scoring cases | ✅ PASS (tests only — full item needs docs) | `npm run test` → 11 passed (10 rubric cases + purity), vitest 4.1.11 |
| M0 | R1 | `npm run build` succeeds with zero errors | ⏸ DEFERRED to M9 | build needs `NEXT_PUBLIC_SUPABASE_*` env which is created in M1; will run before preview deploy |
| M1 | R2 | RLS enabled on all four tables, policies present in migration files | ✅ PASS | `supabase/migrations/20260826000000_init.sql` applied to live project via `db push` (session-pooler URL); policies for profiles/meetings/legs/picks all present; picks insert+delete policies enforce `user_id = auth.uid()` AND parent meeting `status = 'open'` inside the policy itself |
| M1 | R2 | Test: anon key **without a session** cannot read `picks` or `meetings` | ✅ PASS | `npm run test:security` → "anon (no session) reads zero meetings" ✅ · "anon (no session) reads zero picks" ✅ · "anon (no session) cannot insert a meeting" ✅ |
| M1 | R2 | Test: user A cannot be forged by B (`user_id` = A on B's insert) | ✅ PASS | "cross-user pick insert rejected (B forging A's user_id)" ✅ — plus "cross-user pick delete rejected (A's pick survives)" ✅ (RLS DELETE affects zero rows silently, so survival is asserted via service-role count) |
| M1 | R2 | Test: inserting a pick into a `locked` meeting rejected by the DATABASE | ✅ PASS | "insert into LOCKED meeting rejected by database" ✅ · "delete from LOCKED meeting also rejected (pick survives)" ✅ — policy subquery checks parent status, not UI state |
| M2 | R3 | Wrong passcode does not create a session or a profile row | ✅ PASS | `npm run test:auth` (Puppeteer vs live server + service-role inspection): stays on /login with visible error · profile rows for that name = 0 · auth-user count unchanged |
| M2 | R3 | Correct passcode creates exactly one profile row per user and persists across a reload | ✅ PASS | lands on / · exactly 1 profile row created · reload keeps session at / (no bounce to /login) · header shows display name · sign-out returns to /login |
| M2 | R3 | Unauthenticated request to `/meetings/[id]` redirects to `/login` | ✅ PASS | fresh browser context GET /meetings/<uuid> → final URL /login; also verified via curl |

**M2 summary:** 9/9 auth checks green (`npm run test:auth`, new script added). Found & fixed a real compile-breaking bug through this milestone's execution: `app/actions/meetings.ts` exported a sync helper from a `'use server'` file ("Server Actions must be async functions") which 500'd every /meetings/* route — dead code removed.

**M1 summary:** hosted project linked (`cznuxzrbvmybsrjtmsvq`, Sydney); migration pushed; Anonymous sign-ins enabled (`enable_anonymous_sign_ins = true` via config.toml → `config push`); `.env.local` written (gitignored — verified with `git check-ignore`); **15/15 security integration tests green over the wire**, including positive controls.

M1 notes:
- CLI v2.30 cannot reach the new project's direct `db.*.supabase.co:5432` host (IPv6-only routing) — used the session pooler `aws-0-ap-southeast-2.pooler.supabase.com:5432` instead.
- Security-test script bug found by execution: it created a meeting referencing `created_by` BEFORE upserting profiles — FK violation. Reordered (profiles first). The failure was surfaced by adding db error detail to check output.

**M0 summary:** scaffold complete and verified — Next.js 16 App Router, TS strict, Tailwind v4, Vitest, Supabase client wiring, all app screens/actions/scripts staged. `npm run verify` = green (typecheck ✓ · lint ✓ · 11/11 tests ✓).

Toolchain fixes made during M0 (recorded for reproducibility):
- TypeScript pinned to ~5.9.3 — typescript-eslint (via eslint-config-next) does not support TS 7.x yet.
- ESLint pinned to ^9 — eslint-plugin-react bundled with eslint-config-next still uses the removed ESLint 10 context API.
- `eslint.config.mjs` rewritten from FlatCompat shim to eslint-config-next's **native flat export** (`import next from 'eslint-config-next'; export default [...next]`); root `*.mjs` tooling configs globally ignored (next/babel parser can't load them, nothing to lint).

---

## Run notes

- 2026-08-26 — Environment surveyed; PLAN.md written; Q1 (database target) asked and answered: new hosted project `quaddie-picks` (Sydney).
- 2026-08-26 — Platform note: the session's permission classifier had an extended outage (~30 min). Used the window to stage the full codebase (schema migration, scoring module + tests, security/E2E/smoke scripts, all screens) so milestones could execute immediately once shell access returned. No rubric item has been marked based on unexecuted work.
- 2026-08-26 — M0 verified end-to-end via executed commands only: typecheck/lint/test all exit 0; purity + no-secret claims backed by greps shown above.

---

## M4 — Meetings list, create meeting, legs (R1, R6)

Verified 2026-08-28 against the live hosted DB via `npm run test:m4` (new script, `scripts/m4-check.ts`) driving Puppeteer at a 390×844 viewport, plus a service-role read of what actually landed in Postgres. **25/25 checks green.**

| Ms | Rubric | Item | Result | Evidence |
|----|--------|------|--------|----------|
| M4 | R1 | `npm run build` succeeds with zero errors | ✅ PASS | *(was ⏸ DEFERRED at M0 — env now exists, so it was run)* `npm run build` exit 0, Next 16.3.3 Turbopack, 7 routes compiled, TypeScript step clean |
| M4 | R1 | `tsc --noEmit` clean, `strict: true` | ✅ PASS | `npm run typecheck` exit 0; `tsconfig.json:11 "strict": true` |
| M4 | R1 | `npm run lint` clean | ✅ PASS | `eslint .` exit 0 — 0 errors (1 pre-existing warning in `MeetingScreen.tsx:117`, an M5 file; fixed in M5) |
| M4 | R1 | No `any` in `lib/`, no `@ts-ignore` anywhere | ✅ PASS | grep `: any\|as any\|<any>\|any[]` in `lib/` → 0; grep `@ts-ignore\|@ts-expect-error\|@ts-nocheck` in app/lib/components/scripts/tests → 0 |
| M4 | R1 | No secrets in client components; `GROUP_PASSCODE` server-only | ✅ PASS | `GROUP_PASSCODE` appears only in `app/actions/auth.ts` (`'use server'`) + Node scripts. All 5 `'use client'` files contain zero `process.env` references; `SERVICE_ROLE` → 0 matches in app/components/lib |
| M4 | R6 | Meetings list usable at 390px, no horizontal scroll | ✅ PASS | `scrollWidth=390` in all three states: empty, populated, and post-create |
| M4 | R6 | `/meetings/new` usable at 390px, no horizontal scroll | ✅ PASS | `scrollWidth=390` |
| M4 | R6 | Loading state exists for the meetings list | ✅ PASS | Skeleton caught **on screen** mid-query (`[aria-label="Loading"]` present), then asserted to clear once data arrived — not inferred from source |
| M4 | R6 | Empty state exists for the meetings list | ✅ PASS | Empty branch is unreachable while the season holds fixtures, so all 8 in-season meetings were parked at `2001-01-01`, `/` loaded for real → *"No meetings in the 2026–27 season yet. Saturday arvo? Tap New meeting."*; dates restored in a `finally` (`[restore] 8/8`) |
| M4 | R6 | Errors surface as visible messages, never silent console logs | ✅ PASS | 1-char track (passes HTML `required`, fails the server rule) → visible `[role="alert"]` reading "Track name must be 2–60 characters."; stays on `/meetings/new` |
| M4 | — | Create writes 1 meeting + exactly 4 legs | ✅ PASS | Service-role read: 1 meeting row, `status='open'`, `created_by` = creating user; 4 legs with `leg_number` 1,2,3,4 and `race_number` 3,5,7,9 exactly as typed; `winner_number`/`winner_sp` null |
| M4 | — | New meeting appears on the list with track, date, badge, pick count | ✅ PASS | Track string present, `OPEN` badge, "No picks yet", date rendered AU-style ("Wed, 26 Aug 2026") not raw ISO |

### Bugs found by executing M4 (both fixed)

1. **`created_by` was never written.** `createMeeting` inserted `{ track, meeting_date }` only, leaving the spec §5 `created_by` column null on every meeting. Fixed: `app/actions/meetings.ts` now inserts `created_by: auth.userId`. Verified by service-role read of the created row.
2. **A rejected create wiped the whole form.** React 19 resets an uncontrolled form once its action resolves, so hitting a validation error cleared the track, the date, and all four race numbers — the user had to retype everything. Confirmed by probe (`track:"A" races:["3","5","7","9"]` → `track:"" races:["","","",""]`). Fixed: `CreateMeetingState` now echoes the submitted `values` back and `NewMeetingForm` re-seeds its `defaultValue`s from them (keyed so React remounts with the new defaults). Regression check added: *"a rejected submit keeps what the user typed"*.

Also note: this bug is why the first run of the M4 script reported "create did not redirect" — the reset had emptied the race inputs, so HTML `required` silently blocked the second submit and no POST ever left the browser.

### Deferred out of M4

- ⏸ **Tap targets ≥44px** (SPEC §6 prose; not an R1/R6 rubric checkbox). Measured on both M4 screens: smallest interactive element is the header brand link `QuaddiePicks` at **24px**. Header is shared chrome — deferred to **M8** (the mobile pass), recorded here as a `[NOTE]` in the M4 script output rather than silently passed.

---

## M5 — Meeting screen: picks CRUD, realtime, live outlay counter (R5, R6)

Verified 2026-08-28 via `npm run test:m5` (new script, `scripts/m5-check.ts`). Drives **two independent browser contexts** — separate cookie jars, therefore two separate anonymous users — at 390×844 against the live hosted Supabase project, with service-role reads for database truth. **29/29 checks green.**

Realtime is not inferred from source: every "live" claim is backed by a `framenavigated` counter proving the receiving page performed **zero navigations** while the change arrived.

| Ms | Rubric | Item | Result | Evidence |
|----|--------|------|--------|----------|
| M5 | R5 | Two browser sessions with different names can both log in | ✅ PASS | Two contexts logged in as distinct users; service-role read confirms 2 distinct profile rows |
| M5 | R5 | Session A adds a pick; session B sees it appear **without reloading** | ✅ PASS | B's DOM gained "Winx The Second" after A's insert, with **0 navigations** on B; both screens reported `● live` first |
| M5 | R5 | Session B cannot delete session A's pick | ✅ PASS | Two layers: B's UI renders remove controls only for B's own 3 tips; and a **real DELETE carrying B's own session JWT** (lifted from B's cookie jar) against A's pick returned `HTTP 200 []` — RLS matched no row, so nothing was deleted. Service-role read: A's row still present, still on screen |
| M5 | R5 | Locking the meeting disables pick entry in both sessions | ✅ PASS | A locks → B's 4 add-forms drop to 0 with **0 navigations**; A's forms also 0; DB status = `locked`. B's badge reads LOCKED and the banner reads "Picks are locked. Waiting on results." *(Lock button lives on this screen; the settle flow itself is M6.)* |
| M5 | R6 | Meeting screen usable at 390px, no horizontal scroll | ✅ PASS | `scrollWidth=390` both open and locked |
| M5 | R6 | Adding a pick takes ≤3 taps from the meeting screen | ✅ PASS | 4 inline add-forms, one under each leg — tap number field, type, tap Add. Zero navigation to add a pick |
| M5 | R6 | Who-picked-what legible at a glance without tapping | ✅ PASS | A's initials `AA` render on the runner row in B's view with no interaction; when A and B both take #7 the one row shows `AA` **and** `BB` |
| M5 | R6 | Own selection count and outlay visible while picking | ✅ PASS | Sticky counter reads "Your tips: 0 / Outlay so far: $0.00" before any picking, then "Your tips: 3 / Outlay so far: $3.00" live as B adds. Counts the viewer's own tips only — B's counter stayed at 0 while showing A's pick |
| M5 | R6 | Loading and empty states exist | ✅ PASS | Suspense skeleton asserted to clear; all 4 legs show "No tips yet — open the batting." rather than blank space |
| M5 | R6 | Errors surface as visible messages, never silent console logs | ✅ PASS | Duplicate runner in the same leg → visible `[role="alert"]`: "You already have #7 in leg 1." |
| M5 | — | Removing your own pick works and propagates live | ✅ PASS | A's removal vanished from B's screen with **0 navigations**; service-role read confirms the row is gone |

### Bugs found by executing M5 (all fixed)

1. **Realtime DELETEs reached nobody — the live board never un-picked.** A removing a tip stayed on A's screen only; everyone else kept showing it until they reloaded. Root cause proved by probe, not guessed: with the default `REPLICA IDENTITY`, a DELETE's WAL record carries only the primary key, so Realtime cannot evaluate the screen's `filter: leg_id=in.(…)` against the deleted row and drops the event. The probe ran two channels side by side — unfiltered received the DELETE, filtered received nothing. Fixed by migration `supabase/migrations/20260828000000_picks_replica_identity.sql` (`alter table public.picks replica identity full`), pushed with `supabase db push --linked`. Re-ran the probe: filtered channel now receives the DELETE. Logged as **D10**.
2. **The screen mixed live status with the stale server prop.** `status` (state, updated by realtime) drove the forms, but the badge, the banner and the results table still read `meeting.status`, frozen at server-render time. So when another member locked, the reader saw entry disabled while the badge still said OPEN and the banner said **"Settled — final numbers below."** — flatly wrong. All six reads switched to the live value; regression checks assert B sees LOCKED *and* is not told it is settled.
3. **The locking member's own screen depended on a realtime round-trip.** `status` was seeded from the prop by `useState`, so the `router.refresh()` after a lock could not update it. Added React's adjust-state-during-render pattern to adopt a status the server reports. (The `useEffect` form of this trips `react-hooks/set-state-in-effect` under the React Compiler lint rules.)
4. **`scripts/mobile-check.ts` would have logged itself out.** It clicked `form button[type="submit"]`, which matches the header's sign-out form before any leg's add-form. Scoped to the leg-1 form. (Same trap bit the first M4 run.) Fixed now so M8 does not inherit it.

### Regression runs after the schema change

`npm run verify` ✓ (typecheck · lint clean, 0 warnings · 11/11 unit) · `npm run build` ✓ · **R2 security 15/15** · **R3 auth 9/9** · **M4 25/25** — all re-executed after `replica identity full` to prove RLS and the earlier milestones were unaffected.

### Housekeeping

Deleted the six one-off diagnostic scripts now that what they were chasing is fixed: `db-check.mts`, `debug-authtest.mts`, `debug-matrix.mts`, `debug-realtime.mts`, `debug-split.mts`, `debug-delete.mts`.

### Still open (not M5's rubric)

- ⏸ Tap targets ≥44px — header brand link measures 24px. Carried forward to **M8**.
- ➖ R5's remaining two items (settling produces a correct result table; leaderboard aggregates two settled meetings) belong to **M6/M7** and were not attempted.
