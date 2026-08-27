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
