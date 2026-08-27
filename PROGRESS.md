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

---

## Carried-over security re-verification — R5 delete guard

**Challenge:** the M5 evidence was a `HTTP 200 []` response plus a service-role read. Neither is conclusive — an empty PostgREST body only says RLS matched no row *for the attacker*, and a service-role read bypasses RLS entirely. Neither shows the row is still there for the people who are supposed to see it.

Re-verified 2026-08-28 with `npm run test:delete-guard` (`scripts/delete-guard-check.ts`), which reads the pick back **as user A, through A's own session and RLS**. **8/8 green — the row genuinely survived. No security failure.**

| Check | Result | Evidence |
|-------|--------|----------|
| B's DELETE was a genuine attempt | ✅ PASS | Fired with B's own session JWT lifted from B's cookie jar → `HTTP 200 []` |
| **SELECT as user A returns the row B tried to delete** | ✅ PASS | `GET /rest/v1/picks?id=eq.<id>` with **A's** JWT → `HTTP 200 [{"id":"edd83bc4…","runner_number":9,"runner_name":"Guarded Gelding","user_id":"20155465…"}]` — 1 row, visible to A under RLS |
| The surviving row is intact, not a tombstone | ✅ PASS | Still A's `user_id`, still runner #9, name unchanged |
| Served from the database, not React state | ✅ PASS | Full page reload → "Guarded Gelding" still rendered |
| Still counted in A's outlay | ✅ PASS | "Your tips: 1 / Outlay so far: $1.00" after reload |
| Attacker still sees it too | ✅ PASS | B's own reloaded screen still shows A's pick |

---

## M6 — Lock + settle + per-meeting result table (R4, R5)

Verified 2026-08-28 via `npm run test:m6` (`scripts/m6-check.ts`). **32/32 green.**

The meeting under test is **Example 3 of `docs/scoring-examples.md`** ("shotgun vs sharpshooter") reproduced end to end through the real UI. The expected numbers are transcribed into the script by hand from that document — not read out of the code — and **three things are required to agree**: the hand-computed document, `scoreMeeting()` (the authority), and what the settled screen actually renders.

| Ms | Rubric | Item | Result | Evidence |
|----|--------|------|--------|----------|
| M6 | R4 | No function computes a quaddie dividend, ticket cost, or combination count | ✅ PASS | grep for `dividend\|combination\|permutation\|factorial\|ticket\|nCr` across app/lib/components/scripts/tests → 0 matches |
| M6 | R5 | Locking the meeting disables pick entry in both sessions | ✅ PASS | Lock via the UI button → DB `status='locked'`; "Enter results" appears. (Both-sessions propagation re-verified by the M5 suite in this run's regression: 29/29) |
| M6 | R5 | **Settling produces a result table matching a hand-computed expected result** | ✅ PASS | Rendered rows, verbatim: Tommo `["24","$24.00","4/4","$40.30","+16.30","🎯2🧹"]` · Davo `["4","$4.00","2/4","$36.00","+32.00","—"]` — cell for cell identical to the document's Example 3 table |
| M6 | R5 | `scoreMeeting()` agrees with the document | ✅ PASS | Tommo `{selections:24, outlay:24, legsHit:4, return:40.3, profit:16.2999…, soloLegs:2, fullCover:true}`; Davo `{selections:4, outlay:4, legsHit:2, return:36, profit:32, soloLegs:0, fullCover:false}` |
| M6 | R5 | The document's punchline holds | ✅ PASS | Davo's profit 32.00 > Tommo's 16.30 **while** Tommo's legs-hit 4 > Davo's 2 — both reportable, per SPEC §2 |
| M6 | — | Winners stored as typed; SP never converted to odds-to-one | ✅ PASS | `L1 #77@15 · L2 #2@1.9 · L3 #33@21 · L4 #4@2.4` read back from the DB |
| M6 | — | Result table sorted by profit descending | ✅ PASS | Rendered order: Davo → Tommo |
| M6 | — | Each leg displays its winner and SP | ✅ PASS | All four `#runner` + `$SP` strings present on the settled screen; SETTLED badge shown |
| M6 | — | Other members see the identical table | ✅ PASS | Davo's own screen renders the same row (`+32.00`) |
| M6 | — | An already-settled meeting cannot be settled again | ✅ PASS | `/meetings/<id>/settle` redirects to `/meetings/<id>` |
| M6 | R6 | Settled meeting screen at 390px | ✅ PASS | `scrollWidth=390` |

### Settle-screen input rejection (explicitly required this run)

All nine rejections executed against the live server; each produced a visible `[role="alert"]`:

| Input | Rejected with |
|-------|---------------|
| winner `abc` | "runner number must be a whole number — “abc” is not." |
| winner `1.5` | "runner number must be a whole number — “1.5” is not." |
| winner `-5` | "runner number must be a whole number — “-5” is not." |
| winner `0` | "runner #0 is not in the field (runners are 1–99)." |
| winner `100` | "runner #100 is not in the field (runners are 1–99)." |
| SP `abc` | "starting price must be a number — “abc” is not." |
| SP `0` | "starting price must be a positive number, not 0." |
| SP `-3.5` | "starting price must be a positive number, not -3.5." |
| SP `1.00` | "starting price must be above 1.00 — it is total return per $1, stake included." |

And critically: after all nine rejections the meeting was **still `locked`**, and **no winner had been written to any leg** — a rejected settle never leaves the meeting half-settled.

### Interpretation I had to make — "a winner number not in that leg's field"

The instruction was to reject a winner number "not in that leg's field". **The schema stores no field.** `legs` has a `race_number`, not a runner roster, and SPEC §6 fixes the settle screen at *"winning runner number, runner name, and starting price. Nothing else"*, so there is nowhere to enter one.

The only other per-leg runner data in the app is the set of runners members happened to tip. Validating against **that** was rejected as an interpretation because it would make the most common real result unrecordable — a winner nobody backed — and because **SPEC R4 case 6 ("All losses. Nobody hits anything") explicitly requires that state to be reachable**. A settle screen that refused untipped winners could never produce it.

So "the field" is implemented as the runner-number range a runner number can legally take: **1–99**, named `FIELD_MIN`/`FIELD_MAX` in `app/actions/meetings.ts` with the reasoning in a comment. 99 rather than a tighter real-world cap (~24 starters) because the project's own worked examples use runner **#77** — a tighter bound would make `docs/scoring-examples.md` Example 3 unenterable, which this milestone's own verification proves is required. Logged as **D11**. Say the word if you meant the stricter tipped-runners-only rule and I will tighten it.

### Bugs found by executing M6 (fixed)

1. **A rejected settle wiped all twelve fields.** Same React 19 form-reset class as the M4 create form: one bad SP and the whole card of results had to be retyped. `SettleState` now echoes every submitted field back and `SettleForm` re-seeds its `defaultValue`s. Regression check asserts leg 2's winner and leg 3's SP survive a leg-1 rejection.
2. **Validation was coarse and let bad input through the front door.** The old check was a single `Number()` conversion plus `sp <= 1`, so `Number(' 7 ')` and other loose forms slipped past, and every failure produced the same vague message. Rewritten with an integer-literal regex, distinct messages per failure mode, and explicit positive/above-evens SP rules.

### Test-harness bugs found and fixed (not product bugs)

- `submitSettle` clicked `form button[type="submit"]`, which matches the header's sign-out form first — the third time this trap has bitten. Scoped to the settle form.
- The bad-input loop matched the *previous* rejection's alert text, scoring false passes for cases 2 and 3 and a false failure for case 4. Now waits for the alert text to actually change before asserting.

### Regression before commit

`npm run verify` ✓ · `npm run build` ✓ · R2 security **15/15** · R3 auth **9/9** · M4 **25/25** · M5 **29/29** · delete-guard **8/8**.

---

## M7 — Season leaderboard, both sort modes (R5)

Verified 2026-08-28 via `npm run test:m7` (`scripts/m7-check.ts`). **15/15 green.**

Two meetings were built, locked and settled through the real UI in the current season, both drawn from `docs/scoring-examples.md` so the per-meeting numbers are already hand-computed there. The season totals asserted below were **added by hand from those documented rows**, then required to match both `buildLeaderboard()` and the rendered ladder.

| Source | Punter | Tips | Outlay | Hits | Return | Profit |
|--------|--------|------|--------|------|--------|--------|
| Meeting 1 = Example 3 | Tommo | 24 | $24.00 | 4 | $40.30 | +$16.30 |
| Meeting 1 = Example 3 | Davo | 4 | $4.00 | 2 | $36.00 | +$32.00 |
| Meeting 2 = Example 4 (Davo plays Sarah's slip exactly) | Davo | 3 | $3.00 | 3 | $9.00 | +$6.00 |
| Meeting 2 | Tommo | 4 | $4.00 | 3 | $10.00 | +$6.00 |
| **Season total, hand-added** | **Tommo** | **28** | **$28.00** | **7** | **$50.30** | **+$22.30** |
| **Season total, hand-added** | **Davo** | **7** | **$7.00** | **5** | **$45.00** | **+$38.00** |

The fixtures are deliberately built so **Tommo hits more legs while Davo makes more money** — the only way to prove the two sort modes order differently rather than coincidentally agreeing.

| Ms | Rubric | Item | Result | Evidence |
|----|--------|------|--------|----------|
| M7 | R5 | **Leaderboard aggregates two settled meetings correctly** | ✅ PASS | Rendered rows, verbatim: Tommo `["2","28","7","87.5%","0.25","3","1","$28.00","$50.30","+22.30","79.6%"]` · Davo `["2","7","5","62.5%","0.71","1","0","$7.00","$45.00","+38.00","542.9%"]` — cell for cell identical to the hand-added totals |
| M7 | R5 | `buildLeaderboard()` agrees with the hand-added totals | ✅ PASS | Tommo `{meetings:2, selections:28, legsHit:7, returnTotal:50.3, profit:22.2999…, soloLegs:3, fullCovers:1, legsHitPct:87.5, pot:79.642…}`; Davo `{meetings:2, selections:7, legsHit:5, returnTotal:45, profit:38, soloLegs:1, fullCovers:0, legsHitPct:62.5, pot:542.857…}` |
| M7 | SPEC §2 | Default sort is profit descending | ✅ PASS | Davo #1 (+$38.00), Tommo #2 (+$22.30) |
| M7 | SPEC §2 | Secondary sort on legs hit | ✅ PASS | Toggle → `?sort=legs` → Tommo #1 (7 legs), Davo #2 (5 legs) |
| M7 | — | The two sorts genuinely differ | ✅ PASS | profit: Davo→Tommo · legs: Tommo→Davo — a real reversal, not the same order twice |
| M7 | — | Sorting re-orders without re-aggregating | ✅ PASS | Every cell in both rows byte-identical before and after the toggle |
| M7 | — | Rendered order agrees with `sortLeaderboard()` | ✅ PASS | Pure sorter returns Tommo → Davo for `legs`, matching the DOM |
| M7 | SPEC §6 | Season selector defaults to current | ✅ PASS | Active chip = `2026–27` = `seasonFor().label`; selector lists the seasons present in the data |
| M7 | R6 | Ladder usable at 390px | ✅ PASS | `scrollWidth=390` (wide table scrolls inside its own container, page does not) |
| M7 | R6 | Empty state for the season | ✅ PASS | See bug 1 below — executed, not assumed |

### Bug found by executing M7 (fixed)

1. **The ladder's empty state was dead code.** It keyed off `table.rows.length === 0`, but `buildLeaderboard` emits one row per roster profile, so the array is never empty while any member exists. A season with nothing settled therefore rendered a full table of all-zero rows instead of the message written for exactly that case. Now keyed off the count of settled meetings, which is what the message ("No settled meetings in {season} yet") actually means. Verified by execution: both settled meetings were parked out of season, the page was loaded for real → *"No settled meetings in 2026–27 yet — nothing to argue about."* with **0 table rows**; dates restored in a `finally` (`[restore] 2`).

### Regression before commit

`npm run verify` ✓ · `npm run build` ✓ (0 errors) · R2 security **15/15** · R3 auth **9/9** · M4 **25/25** · M5 **29/29** · M6 **32/32** · delete-guard **8/8**.

### Rubric status entering M8

R1 ✅ · R2 ✅ · R3 ✅ · R4 ✅ · **R5 ✅ complete — all six items now executed** · R6 partial (M8) · R7 not started (M9).

Carried into **M8**: tap targets ≥44px (header brand link measures 24px), plus the full R6 sweep across every screen.
