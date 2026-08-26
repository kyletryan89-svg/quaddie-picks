# DECISIONS.md

Append-only log of decisions made during the build, per SPEC §8 rules.

| # | Date | Decision | Rationale |
|---|------|----------|-----------|
| D1 | 2026-08-26 | Project root `~/quaddie-picks`, npm as package manager | Only npm installed; home dir is an unrelated git repo |
| D2 | 2026-08-26 | Supabase JS v2 + `@supabase/ssr`; anonymous sign-in after passcode check; profiles upsert keyed off `auth.uid()` | Spec §4 auth flow |
| D3 | 2026-08-26 | Realtime via single client subscription on `picks` filtered to the meeting's legs | Spec §6 core feature |
| D4 | 2026-08-26 | Season = rolling 1 Aug–31 Jul from today's date; selector lists seasons present in data | Spec §2 SEASON |
| D5 | 2026-08-26 | R2 security tests = integration tests vs hosted DB using anonymous sign-in sessions; fixtures prefixed `TEST-`; cleanup via service-role key from env only | No Docker locally; policies must be exercised for real |
| D6 | 2026-08-26 | Seed script uses service role to create 5 anon-auth profiles + fixtures | Spec R7 seed requirements |
| D7 | 2026-08-26 | `GROUP_PASSCODE` generated locally; stored in `.env.local`, `.env.example`, Vercel env; referenced only in server action module | Spec §4 + R1 |
| D8 | 2026-08-26 | `vercel.json` pins functions region `syd1` | Spec §3 |
| D9 | 2026-08-26 | Errors render inline in UI; every list has loading/empty states | Spec R6 |

**Answered questions**

- **Q1 (2026-08-26): Database target → NEW hosted Supabase project**, named `quaddie-picks`, Sydney (`ap-southeast-2`), under org `Carrots` (`txothanwlpgbhzmchsit`). User selected "New project (Recommended)" when asked. Docker is not installed so local Supabase was never viable; fresh project avoids touching existing carrot apps.
