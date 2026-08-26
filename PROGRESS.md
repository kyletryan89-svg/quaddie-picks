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
