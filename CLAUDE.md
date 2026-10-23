# CourtPulse repository guidance

React 19 + Vite + TypeScript PWA on Firebase (Auth, Firestore, Hosting). There is no custom backend:
`firestore.rules` is the only server-side enforcement, so treat it as the security boundary.

Production: https://project-7eb1aec8-8636-4c86-b2a.web.app. Every push to `main` runs
`.github/workflows/deploy.yml` (verify → rules emulator tests → deploy Hosting, rules and indexes).

## Commands

```bash
npm run lint        # tsc --noEmit
npm test            # unit tests (tsx --test src/utils/*.test.ts)
npm run build
npm run test:rules  # Firestore rules against the emulator; needs a full JDK (Temurin 21), slow cold start
npm run test:concurrency  # wallet ledger races against the emulator (finalize/top-up/leave/reopen); same JDK
```

All five must pass before pushing; CI runs the same gates and a failed one blocks the deploy.

## Google AI Studio (Gemini) pushes: check every pull

Part of this app is edited in Google AI Studio, which commits straight to `main`. Its commits have
repeatedly broken the repo in the same ways. **After every pull of AI Studio work, run
`git show --stat <each new commit>` and check for the following before anything else.**

1. **`package-lock.json` deleted** (happened in `d8ffedd` and `7b12cf4`). The workflow caches npm via
   `actions/setup-node` with `cache: npm`, which fails within seconds when the lockfile is missing, so
   verify, rules and deploy all go red and nothing ships. Fix: restore the last good copy, commit and push.

   ```bash
   git log --oneline --diff-filter=D -- package-lock.json   # find the deleting commit
   git show <commit-before-deletion>:package-lock.json > package-lock.json
   ```

   Restore it byte-for-byte. Do not regenerate it with `npm install` on Windows: that adds bundled
   optional `@tailwindcss/oxide-wasm32-wasi` entries, which is noise. The workflow now has a
   "Require package-lock.json" step that fails with this explanation instead of the cache error.
2. **Earlier work reverted.** A merge from AI Studio once overwrote the hardened `App.tsx` and
   `badmintonLogic.ts` (restored in `6a74674`). Diff `--stat` against the last known-good commit and
   treat a large unexpected deletion in `src/App.tsx`, `src/utils/*`, `firestore.rules`,
   `tests/rules/*` or `.github/` as a regression to undo, not as new work.
3. **Screenshots under `public/assets/aistudio/`** and `.aistudio/**/.tempmediaStorage/` are scratch
   media. They are in `.gitignore`; delete them if they show up in a commit.

When writing a prompt for Gemini, include this block verbatim:

> Never delete, rename or regenerate `package-lock.json`. Never edit `.github/`, `firestore.rules`,
> `firestore.indexes.json`, `firebase.json` or `tests/rules/`. Do not add files under `public/assets/aistudio/`.
> Keep `src/App.tsx` changes minimal and additive; do not rewrite or reformat functions you were not asked to touch.
> After your change `npm run lint` and `npm test` must pass.

## Firestore rules

- The 1000-expression budget is counted cumulatively across every `allow` rule tried for one request,
  and function arguments are re-evaluated at each use. Put cheap discriminators first, split rules per
  transition, and avoid date arithmetic (managers store `startsAt`, `freeCancelUntil`, `lateCancelUntil`).
- Player RSVP rules run close to the budget. Any change to them needs a full-payload scenario in
  `tests/rules/firestore.rules.test.mjs`; a small clause can push the real app payload over the limit
  while unit-style tests still pass.
- A directory query on `clubs` must pin `visibility == 'public'`; do not use `.get('visibility', ...)` in list rules.

## Money and wallets

- Order applied at finalize: VIP waiver (covers guests too) -> one Free Session Pass -> credit. A pass covers only
  the player's own seat; the guests' share (even per-head split) stays payable and credit may meet it.
- Nothing is billed before the host finalizes. Cash/PayNow a player paid or reported is never wiped by a
  recalculation, attendance edit or reopen (see `getRsvpAdjustment`).
- Ledger writes are one Firestore transaction per RSVP+wallet pair (`src/utils/walletTransactionsCore.ts`), computed
  on server-read data. Keep them that way; `tests/concurrency` fails if they stop being atomic.
- Finalizing needs booked courts and a started session. The client waits `FINALIZE_CLOCK_SKEW_MS` (2 min) past the
  start; the rules (`finalizeFlipAllowed`) enforce the same on the server clock. Change both together.
- Amounts are shown in the club's own currency (`formatClubCurrency`); use `formatMixedMoney` for totals across clubs.
  Stored `paidMethod` labels such as "Credit ($12.50)" are parsed back and must not change; display them through
  `describeWalletPaidMethod`.
- `src/utils/ledgerInvariants.test.ts` replays random action sequences against the real ledger functions; a failure
  prints the seed. `docs/QA_LIVE_CHECKLIST.md` is the manual walkthrough with expected numbers.

## Conventions

- Source files are stored with LF line endings in git (a Windows checkout may show CRLF through autocrlf). When scripting
  edits keep whatever the file in front of you uses (`git ls-files --eol <file>` shows both).
- Club time is the club's IANA `timezone` (default `Asia/Singapore`); never use the device's zone for
  deadlines or labels.
- Notifications are client-side only (`src/utils/notificationLogic.ts`, `BrowserNotificationManager.tsx`).
  They are evaluated only once `clubDataLoaded` is true, so an empty initial list is never saved as the
  baseline, and they never alert a person about their own action.
