# CourtPulse live QA checklist

For a human with three accounts, on a staging copy or on production with **throwaway data**. Never use real members' clubs.

Every expected number below comes from `npx tsx scripts/qa-live-numbers.ts`, which runs the real ledger functions
(`computeSessionSplitDetails`, `applyWalletsToFinalizedSessionRsvps`, `restoreSessionRsvpsAndWalletsForReopen`,
`computeManualWaiver`, `getRsvpAdjustment`, `settleRsvpAdjustment`). If the app shows something different, that is a bug
(or the script is stale, so re-run it and compare).

## Setup and assumptions

| Item | Value |
| --- | --- |
| Accounts | **Owner** (club owner, host), **A**, **B** (members). Use three different browsers or profiles: Owner = browser 1, A = browser 2 (also a real phone if possible), B = browser 3. |
| Club | New private club "QA Club". No-show fee 100%. Free cancel 24 h, lock 4 h, late-cancel fee 50%. Currency as shown by the club. Owner is billed (do not tick "exclude owner from billing"). |
| Session S1 | Starts in the near future (see step 3.1 for the timing trick), court fee **60.00**, **4 shuttles at 3.00 = 12.00**, pool **72.00**. |
| Wallets (set in step 1) | A: **1 free session pass, 10.00 credit**. B: **0 passes, 5.00 credit**. Owner: nothing. |
| Heads | Owner 1, A 2 (A + one guest), B 1 = **4 heads, 18.00 per head**. |

Notation: **[Owner/br1]** = who does it / which browser or device. "Payable" = the cash amount still owed after pass and credit.

Tick each box only when the expected value was seen exactly.

## 1. Wallets: grant a pass and credit

- [ ] 1.1 **[Owner/br1]** Open QA Club, Members. For A: add **+1 pass** and **+10.00 credit**. For B: add **+5.00 credit**.
  Expected: A shows **1 pass, 10.00 credit**. B shows **0 passes, 5.00 credit**. Owner shows 0 / 0.00.
- [ ] 1.2 **[A/br2]** Reload. Expected: A's wallet shows 1 pass and 10.00 credit. **[B/br3]** Reload: 0 passes, 5.00 credit.
- [ ] 1.3 **[Owner/br1]** Try to remove 20.00 credit from B. Expected: balance never goes below **0.00** (floors at 0.00, no negative).

## 2. Join with and without a guest

- [ ] 2.1 **[Owner/br1]** Create session S1 (court fee 60.00, 4 shuttles x 3.00 can be entered later). Expected: A and B (and Owner) get a "New Session" alert only if they have not joined: title `New Session · QA Club`.
- [ ] 2.2 **[Owner/br1]** Join S1 yourself (no guest). **[B/br3]** Join S1, no guest. **[A/br2]** Join S1 and add **1 guest**.
  Expected: roster shows Owner 1, B 1, A + 1 guest. Headcount **4**.
- [ ] 2.3 **[Owner/br1]** Expected alerts: `A Joined Session` (body mentions the guest), `B Joined Session`. No alert about your own join.
- [ ] 2.4 **[A/br2]** Before finalize, check A, B and Owner each show **no fee** (preview only). Expected per row: fee share 0.00, nothing billed. Wallets unchanged: A 1 pass / 10.00, B 0 / 5.00.

## 3. Finalize

- [ ] 3.1 **[Owner/br1]** Tapping Finalize now (before the session start) must be **refused**. Expected: a clear message that the session has not started / courts are not booked. If courts are still `pending`, also refused. (Server rule: it cannot be bypassed.)
  Then mark courts booked and wait until the start time has passed (or create S1 with a start time a few minutes ahead and wait).
- [ ] 3.2 **[Owner/br1]** Enter court fee **60.00**, **4** shuttles, unit cost **3.00**, then Finalize.
  Expected per row (gross / pass / credit applied / payable):
  - Owner: **18.00 / no / 0.00 / 18.00** (paid as "Club Owner")
  - A (2 heads): **36.00 / pass used / 10.00 / 8.00**. The pass covers A's own seat (18.00); the guest's 18.00 is payable: 10.00 credit then 8.00 cash.
  - B: **18.00 / no / 5.00 / 13.00**
  Sum of gross = **72.00**.
- [ ] 3.3 **[A/br2]** Expected wallet after finalize: **0 passes, 0.00 credit**. **[B/br3]**: **0 passes, 0.00 credit**.
- [ ] 3.4 **[A/br2]** and **[B/br3]** Expected alert: `Session Fees Finalized · <session title>` with your share (A: 8.00 payable, B: 13.00 payable).
- [ ] 3.5 **[Owner/br1]** Press Finalize a second time (or recalculate with the same numbers). Expected: **nothing changes** (same shares, wallets still 0 / 0.00).

## 4. Pay in cash, then recalculate

- [ ] 4.1 **[Owner/br1]** On A's row press **Received** (cash). Expected: A shows paid / cash, payable 8.00 collected.
- [ ] 4.2 **[A/br2]** Expected alert: `Payment Confirmed · <session title>` mentioning cash.
- [ ] 4.3 **[Owner/br1]** Change shuttles to **5** (pool **75.00**, **18.75 per head**) and Recalculate.
  Expected: Owner **18.75**; A gross **37.50**, still pass + 10.00 credit; B gross **18.75**.
  A stays **paid / cash** (cash is never wiped) and shows an adjustment **due 0.75** (expected cash 8.75, collected 8.00).
- [ ] 4.4 **[A/br2]** Expected alert: `Your Share Changed · <session title>` ("you owe 0.75 more").
- [ ] 4.5 **[Owner/br1]** Mark the 0.75 as collected (settle adjustment). Expected: A adjustment disappears (collected 8.75). Wallets unchanged (A 0 / 0.00).
- [ ] 4.6 **[Owner/br1]** (B must also have paid 13.75 in full by now, i.e. its 0.75 was settled the same way.) Set shuttles back to **4** and Recalculate. Expected: gross returns to Owner 18.00 / A 36.00 / B 18.00; A (paid cash) and B (paid PayNow) each show a **refund of 0.75** (stored payable A 8.75, B 13.75). Settle both; wallets stay A 0 / 0.00, B 0 / 0.00.

## 5. Pending payment: confirmed and rejected

- [ ] 5.1 **[B/br3]** Press "I've paid" with PayNow. Expected: B's row shows `pending_approval`, payable still 13.00.
- [ ] 5.2 **[Owner/br1]** Expected alert: `B Pressed Paid (13.00)` ... "Tap to verify receipt".
- [ ] 5.3 **[Owner/br1]** Press **Reject** on B. Expected: B row back to **unpaid**, payable **13.00**.
  **[B/br3]** Expected alert: `Payment Not Received · <session title>` (13.00).
- [ ] 5.4 **[B/br3]** Press "I've paid" again, then **[Owner/br1]** press **Confirm / Received**.
  Expected: B paid / PayNow. **[B/br3]** alert: `Payment Confirmed · <session title>`.
- [ ] 5.5 **[Owner/br1]** Recalculate with 5 shuttles while B is paid (PayNow) and A is paid (cash). Expected: both stay **paid** with an adjustment **due 0.75** each; no payment lost. Set shuttles back to 4 and recalculate; adjustments clear or become refunds as in 4.6.

## 6. Waive

- [ ] 6.1 **[Owner/br1]** Use a fresh state: reopen (step 7) first, finalize again so A and B are unpaid with credit used (A 8.00 payable, B 13.00 payable). Then **Waive** B.
  Expected: B row **paid / Fee Waived**, payable **0.00**, and B's **5.00 credit is returned**: B wallet **5.00 credit, 0 passes**.
- [ ] 6.2 **[B/br3]** Expected alert: `Fee Waived · <session title>` ("Nothing to pay").

## 7. Reopen

- [ ] 7.1 **[Owner/br1]** With **nobody paid** (undo waive, or use a fresh session with the same numbers), press **Reopen split**.
  Expected: all rows back to 0.00 and unbilled; A wallet **1 pass / 10.00 credit**; B **0 passes / 5.00 credit**; Owner 0 / 0.00. Session no longer finalized.
- [ ] 7.2 **[Owner/br1]** Finalize again. Expected identical to 3.2 (36.00 / 18.00 / 18.00; wallets 0 / 0.00). Reopen then finalize == finalize once.
- [ ] 7.3 **[Owner/br1]** Mark A cash received, B `pending_approval` (via B), then Reopen.
  Expected: A stays **paid / cash**, gross 36.00, payable 8.00 and its pass + 10.00 credit **stay consumed**; B stays **pending_approval**, 13.00, 5.00 credit consumed. Owner row returns to 0.00 / unbilled. Real money survives a reopen.

## 8. Cancel in time and late

Create a second session S2 for these (same court/shuttle numbers, same members and wallets: A 1 pass / 10.00, B 0 / 5.00, Owner + A (+1 guest) + B joined).

- [ ] 8.1 **[B/br3]** Cancel **before the free-cancel deadline** (more than 24 h before start). Expected: B is out, no fee. Then **[Owner/br1]** finalize after start: 3 heads, pool 72.00:
  Owner **24.00 / payable 24.00**; A **48.00 / pass / 10.00 credit / payable 14.00**; B **0.00** and B wallet stays **5.00 credit**.
- [ ] 8.2 **[Owner/br1]** Expected alert at the time of cancelling: `B Left Session` (no "late" note).
- [ ] 8.3 Repeat on S3 (fresh numbers). **[B/br3]** cancel **after the free deadline but before the lock** (late window, 50%). Expected on finalize: Owner **21.14**; A **42.29** (pass + 10.00 credit, payable **11.14**); B **8.57** gross with 5.00 credit, payable **3.57**. Sum of gross = 72.00.
  Alert **[Owner/br1]**: `B Left Session` with a late-cancel note.
- [ ] 8.4 **[B/br3]** try to cancel **after the lock deadline** (within 4 h of start) and again **after start**. Expected: both refused, the button is disabled or an error is shown. Joining after start is also refused.
- [ ] 8.5 **[Owner/br1]** On a finalized S1 (B billed 18.00 with 5.00 credit), set B to out and Recalculate. Expected: B **0.00**, B wallet **5.00 credit** back; Owner **24.00**, A **48.00 / payable 14.00**.
- [ ] 8.6 Timezone: set the club timezone to a zone different from your device and confirm all deadlines shown are in the **club's** zone (not the device's).

## 9. Leave a club with an open session

- [ ] 9.1 **[A/br2]** While A is on the roster of unfinalized S1 and cannot withdraw (past the lock deadline), try Leave club. Expected: refused with a message that you are on an open session.
- [ ] 9.2 **[B/br3]** Finalize first, then B (unpaid, owes 13.00) tries Leave club. Expected: refused while owing or owed money.
- [ ] 9.3 **[B/br3]** After B has paid and has nothing open: Leave club succeeds.
- [ ] 9.4 **[Owner/br1]** Remove member A at any time (even with an open session). Expected: allowed; A's pass and credit consumed by open rows are returned; A's rows disappear.

## 10. Two browsers at once

- [ ] 10.1 **[Owner/br1]** and **[Owner/br1b, second tab/profile logged in as the same owner]** press Finalize on S1 at the same moment. Expected: wallets spent **once** (A 0 / 0.00, B 0 / 5.00 less 5.00 = 0.00); shares as in 3.2; no negative balances.
- [ ] 10.2 **[Owner/br1]** adds +25.00 credit to B while **[Owner/br1b]** finalizes. Expected: B ends with the 25.00 intact (credit never lost).
- [ ] 10.3 **[A/br2]** (A leaves S1 before the deadline) while **[Owner/br1]** finalizes. Expected: either finalize reports "changed their RSVP just now", or the split is consistent. Never an "out" row that still carries a pass or fee.
- [ ] 10.4 **[Owner/br1]** presses **Received** on A while **[Owner/br1b]** recalculates. Expected: A still shows paid / cash.
- [ ] 10.5 **[Owner/br1]** reopens while **[Owner/br1b]** finalizes. Expected: ends either fully finalized (shares as 3.2, wallets 0 / 0.00) or fully open (wallets A 1 / 10.00, B 0 / 5.00), never half.

## 11. Notifications: one alert per event, none for your own action

Use browsers with notifications allowed, and keep each tab in the background.

| # | Action | Who does it | Who must get an alert (exact title) | Who must **not** |
| --- | --- | --- | --- | --- |
| 11.1 | Join S1 | B | Owner: `B Joined Session` | B |
| 11.2 | Add 1 guest | A | Owner: `A Added 1 Guest` ("Now bringing 1") | A |
| 11.3 | Remove the guest | A | Owner: `A Removed 1 Guest` | A |
| 11.4 | Leave S1 | B | Owner: `B Left Session` | B |
| 11.5 | Fill the session (max players) | last member joins | Owner: `Session Full · <title>` ("N/N players") | members |
| 11.6 | Mark payment sent | B | Owner: `B Pressed Paid (<amount>)` | B |
| 11.7 | Confirm payment | Owner | B: `Payment Confirmed · <title>` | Owner |
| 11.8 | Reject payment | Owner | B: `Payment Not Received · <title>` | Owner |
| 11.9 | Mark courts booked (pending -> booked) | Owner | A and B (going): `Session Updated · <title>` ("courts are now booked") | Owner |
| 11.10 | Finalize | Owner | A, B: `Session Fees Finalized · <title>` | Owner |
| 11.11 | Recalculate so a paid share changes | Owner | A, B: `Your Share Changed · <title>` | Owner |
| 11.12 | Waive | Owner | B: `Fee Waived · <title>` | Owner |

For each row also check: **exactly one** alert (reload the page and re-open the app: no repeat), and repeat 11.1 / 11.4 three times in a row (join, leave, join, leave): each repeat alerts again.

## 12. Results

Record for each failed box: step number, expected, actual, screenshot, browser. Any unexpected negative balance, double spent pass, wiped cash payment, or alert for your own action is a release blocker.
