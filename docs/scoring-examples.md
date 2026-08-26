# Scoring examples — hand-worked

These tables are computed **by hand** from SPEC §2 and match the automated fixtures in
`tests/scoring.test.ts` (case numbers referenced inline). If code and this document ever
disagree, one of them is wrong — find out which before shipping.

Reminder of the two conventions everything here hangs off:

- `winner_sp` is **total return per $1 staked** (stake included). SP 15.00 ⇒ a $1 winner
  selection returns $15.00 ($14.00 profit). Never subtract 1 except implicitly inside
  `profit = return − outlay`.
- Every selection costs exactly **$1 notional outlay**, win or lose, hit or miss. That is
  the *only* brake on shotgunning. Credit is never split, shared, or diluted — if you and
  three mates all found the winner, each of you banks the full point and the full SP.

---

## Example 1 — No splitting (test case 1)

Leg 1 winner: **#5 at SP 8.00**. Three members all picked #5. Nobody else picked anything
that won.

| member | selections | outlay | legs hit | return | profit |
|--------|-----------:|-------:|---------:|-------:|-------:|
| u1     |          1 |   1.00 |        1 |   8.00 |  +7.00 |
| u2     |          1 |   1.00 |        1 |   8.00 |  +7.00 |
| u3     |          1 |   1.00 |        1 |   8.00 |  +7.00 |

All three returns are identical and equal `winner_sp` exactly. Three people being right
does not shrink anyone's payout — there is no pool, no split, no sharing. Each also gets
their 1 leg-hit point.

## Example 2 — No double-paying (test case 2)

Leg 1 winner: **#7 at SP 4.50**. u1 boxed five runners: #1, #2, #3, #4, #7.

| member | selections | outlay | legs hit | return | profit |
|--------|-----------:|-------:|---------:|-------:|-------:|
| u1     |          5 |   5.00 |        1 |   4.50 |  −0.50 |

Hitting the winner with one of five picks still pays the winner's SP **once**. The extra
four runners bought nothing except $4 of extra outlay — which is precisely how the app
punishes spraying without ever diluting credit.

## Example 3 — The SP convention itself (test case 3)

One leg, winner **#3 at SP 4.50**, one member picked it and nothing else:

return = 4.50, outlay = 1.00, profit = 4.50 − 1.00 = **+3.50**. ✔

If you catch yourself computing 4.50 − 1 = 3.50 as "odds", stop: the subtraction above is
`profit = return − outlay`, not odds conversion. SP is already total return.

## Example 4 — Shotgun vs sniper (test case 4, the argument-settler)

Four settled legs:

| leg | winner | SP |
|-----|--------|------:|
| 1   | #77    | 15.00 |
| 2   | #2     |  1.90 |
| 3   | #33    | 21.00 |
| 4   | #4     |  2.40 |

- **userA** boxes six wide in every leg (all four winners included among their sixes):
  24 selections, outlay 24.00. Hit every leg ⇒ return = 15.00 + 1.90 + 21.00 + 2.40 = 40.30.
- **userB** fires one bullet per leg (4 selections, outlay 4.00), nails #77 and #33,
  misses legs 2 and 4 ⇒ return = 15.00 + 21.00 = 36.00.

| member | selections | outlay | legs hit | return | profit |
|--------|-----------:|-------:|---------:|-------:|-------:|
| userA  |         24 |  24.00 |    **4** |  40.30 | +16.30 |
| userB  |          4 |   4.00 |    **2** |  36.00 | **+32.00** |

Both facts reportable and both true at once: **userA wins the legs-hit column (4 > 2);
userB wins the money (+32.00 > +16.30)**. Wide netted more winners but each of userA's
six-pick legs cost $6 of outlay to find what userB found for $1. Neither number is "the"
number — which is exactly why the leaderboard carries both sorts.

Solo flags here: none — userB also had #77 and #33, so userA was never the sole picker of
a winning runner.

## Example 5 — Empty leg (test case 5)

u1 skips leg 3 entirely but finds winners in legs 1, 2 and 4:

- selections 3 ⇒ outlay 3.00 (only legs actually entered cost anything),
- legs hit 3 ⇒ can never be full cover,
- leg 3's winner scores them nothing, because they were not in the race.

## Example 6 — All losses (test case 6)

Nobody finds a winner across the meeting: every member's return is 0.00 and every
member's profit equals minus their outlay. Spray wide, lose wide; tip tight, lose cheap.

## Flags — solo & full cover (test cases 7–8)

- **solo**: true for a leg only when exactly one member picked that leg's winner. Display
  only — no bonus points, ever. Two members on the same winner ⇒ neither is solo.
- **full cover**: true only when a member hit all four legs. Display only.

## POT guard (test case 9)

`POT % = profit / outlay × 100`, shown as `—` whenever outlay is 0. A member with zero
selections divides nothing, renders `—`, and breaks nothing.

## Unsettled legs (test case 10)

A leg with no entered winner scores as **no hit for everyone** and throws nothing: the
meeting simply shows fewer hit-able legs until someone settles it.
