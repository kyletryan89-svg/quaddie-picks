# Scoring worked examples

These tables are hand-computed and mirror the automated fixtures in
`tests/scoring.test.ts` (rubric R4). If a number here ever disagrees with the
tests, the tests win — but they shouldn't.

## The model (SPEC §3)

- Every selection is a **$1 notional outlay**. Pick 6 runners in a leg, you've
  spent $6 on that leg.
- A leg hit pays **1 point** plus the winner's **starting price (SP)** added
  **once** — no matter how many runners of yours won it, and no matter how many
  other members also picked it.
- **SP convention:** `winner_sp` is the *total return per $1 staked*, stake
  included. An SP of 4.50 returns $4.50 on $1. It is never odds-to-one.
- `profit = return − outlay`, `POT % = profit ÷ outlay × 100`
  (`—` when outlay is 0).
- Flags are display-only: **solo** = you were the only member on that leg's
  winner; **full cover** = all four legs hit.
- Nothing splits, nothing doubles. Credit is never divided between pickers.

---

## Example 1 — three mates, same winner (test case 1)

Leg 1 winner: #5 at SP **8.00**. Davo, Kylie and Tommo all picked #5. Nobody
tipped anything else this meeting.

| Punter | Tips | Outlay | Legs hit | Return | Profit | POT % |
|--------|------|--------|----------|--------|--------|-------|
| Davo   | 1    | $1.00  | 1        | $8.00  | +$7.00 | 700%  |
| Kylie  | 1    | $1.00  | 1        | $8.00  | +$7.00 | 700%  |
| Tommo  | 1    | $1.00  | 1        | $8.00  | +$7.00 | 700%  |

The point and the full $8.00 go to **each** of them intact. Three people being
right together does not dilute anybody.

## Example 2 — boxing five wide (test cases 2 & 3)

Leg 1 winner: #7 at SP **4.50**. Kylie tipped #1, #2, #3, #4 **and** #7.

| Punter | Tips | Outlay | Legs hit | Return | Profit | POT % |
|--------|------|--------|----------|--------|--------|-------|
| Kylie  | 5    | $5.00  | 1        | $4.50  | −$0.50 | −10%  |

The winner pays **once**: return is $4.50, not 5 × $4.50. Five $1 tickets, one
of them winning, nets a 50-cent loss. That is the whole cost-of-clutter story
the counter on the meeting screen exists to show.

## Example 3 — shotgun vs sharpshooter (test case 4)

Same meeting, two styles. Winners: L1 #77 @ 15.00 · L2 #2 @ 1.90 · L3 #33 @
21.00 · L4 #4 @ 2.40.

- **Tommo boxes six wide every leg** (24 selections, $24 outlay) and lands all
  four winners at those short-ish prices: return = 15.00 + 1.90 + 21.00 + 2.40
  = **$40.30**, profit **+$16.30**, POT 67.9%.
- **Davo has one dart per leg** (4 selections, $4 outlay), hits #77 and #33,
  misses legs 2 and 4: return = 15.00 + 21.00 = **$36.00**, profit **+$32.00**,
  POT 800%.

| Punter | Tips | Outlay | Legs hit | Return  | Profit  | POT %  |
|--------|------|--------|----------|---------|---------|--------|
| Tommo  | 24   | $24.00 | **4**    | $40.30  | +$16.30 | 67.9%  |
| Davo   | 4    | $4.00  | 2        | $36.00  | **+$32.00** | 800% |

Both numbers are reportable side by side — Tommo tops the legs-hit sort, Davo
tops the profit sort. Neither view is hidden from the group (SPEC §2).

## Example 4 — the empty leg (test case 5)

Winners: L1 #1 @ 2.00 · L2 #2 @ 3.00 · L3 #9 @ 5.00 · L4 #4 @ 4.00.
Sarah tips L1 #1 ✓, L2 #2 ✓, **nothing at all in leg 3**, L4 #4 ✓.

| Punter | Tips | Outlay | Legs hit | Return | Profit | POT % | Full cover |
|--------|------|--------|----------|--------|--------|-------|------------|
| Sarah  | 3    | $3.00  | 3        | $9.00  | +$6.00 | 200%  | no         |

You cannot hit a leg you never entered — her ceiling is 3/4 and full cover stays
out of reach no matter what happens in leg 3. Outlay only counts legs entered.

## Example 5 — the solo flag (test case 7)

Winners: L1 #5 @ 4.00 · L2 #6 @ 6.00. The loner is the only member on #5; two
members (a duo) both had #6.

| Punter | Tips | Outlay | Legs hit | Return | Profit | Solo legs |
|--------|------|--------|----------|--------|--------|-----------|
| Loner  | 1    | $1.00  | 1        | $4.00  | +$3.00 | **1**     |
| Duo-a  | 1    | $1.00  | 1        | $6.00  | +$5.00 | 0         |
| Duo-b  | 1    | $1.00  | 1        | $6.00  | +$5.00 | 0         |

Solo means *exactly one member* picked that winner — being one of two or more
is not solo, even though everyone still gets the full SP. The flag is
display-only bragging rights; it never changes money.

## Example 6 — full cover (test case 8)

All four winners land at 2.00. A perfect card (#1/#2/#3/#4) sets the flag;
three-of-four with a miss in leg 4 does not, whatever the prices:

| Punter | Legs hit | Full cover |
|--------|----------|------------|
| Perfect | 4       | 🧹 yes      |
| Almost  | 3        | no          |

## Edge rules (test cases 9 & 10)

- A member with zero selections has outlay 0 → their POT renders as **—**
  (never NaN, never ∞).
- An unsettled leg (`winner_number` still null) simply can't be hit by anyone;
  scoring runs without throwing, so open meetings always render safely.
