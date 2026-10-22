# Security Specification (Phase 0: Payload-First Security TDD)

## 0. Identity & Roles

- **Accounts**: Firebase Auth with Google or email + password. Email/password accounts must verify their email before they can read or write anything (`isVerifiedUser()`).
- **Player ↔ account link**: `players/{id}.authUid` holds the uid of the account that owns the profile. A new account creates exactly one profile with id `player_{uid}`; an existing (unlinked) profile can only be linked by a Site Admin, after the account files a `profileClaims/{uid}` request.
- **Site Admin**: a verified bootstrap admin email, or an `/admins/{uid}` document (managed in the Firebase console).
- **Club Owner**: the player in `clubs/{id}.ownerPlayerId`; only a Site Admin can create, delete or reassign clubs.
- **Role checks** in the rules resolve to "is the signed-in account linked to that player?" (`isPlayerSelf`, `isClubOwner`, `canManageClub`):
  - Sessions and matches: written only by the club's owner or an admin.
  - RSVPs: a player creates/updates only their own deterministic RSVP (`rsvp_{sessionId}_{playerId}`), in clubs they belong to, while `bookingStatus in ['pending', 'booked']` and `!feeSplitFinalized`, with pinned `penaltyPercentApplied` (`0` when `going`/`out`, `>= club.lateCancelFeePercent` when `late_out`) and zeroed wallet ledger fields on self-create; they can report a payment as sent (`paidStatus == 'pending_approval'`) but never mark it paid or change `feeShare` or `attendanceOutcome`. Players can only delete their own RSVP when `feeShare == 0 && paidStatus == 'unpaid' && sessionIsOpen(sessionId)`.
  - Club Wallets (`clubWallets`): created, updated, and deleted by `canManageClub(clubId)` (Club Owner or Site Admin); readable (`get`/`list`) only by `canManageClub(clubId)` or the wallet's `isPlayerSelf(playerId)`.
  - Players: a player self-creates `player_{uid}` with `hasFreshStats` (`gamesPlayed == 0`, `wins == 0`, `losses == 0`, `ratingScore == 1200`, etc.); edits their own name/tag and joins **public** clubs; joining a private club needs the club owner (`actingClubId` names the authorising club). Stats only change in the same batch as a newly created match (`!exists(matchPath) && existsAfter(matchPath) && getAfter(matchPath).data.createdAt == request.time`, `gamesPlayed == existing().gamesPlayed + 1`) or match deletion by that club's manager (`lastMatchId`). Players may delete their own `/players/{playerId}` document (`isPlayerSelf(playerId)`).
  - Join requests: filed by the player for themselves; removed by them, the club owner or an admin.
  - Gear Lockers (`gearLockers`): keyed by `ownerId == request.auth.uid`; `allow get: if isVerifiedUser() && isValidId(ownerId) && ownerId == request.auth.uid;` so reading a non-existent locker before first save succeeds without dereferencing `resource.data`.

## 1. Data Invariants

1. **Global Default Deny**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity**: All writes and reads require an authenticated user (`request.auth != null`) with `request.auth.token.email_verified == true`.
3. **Path ID Hardening**: Document IDs (`{sessionId}`, `{playerId}`, `{rsvpId}`, `{matchId}`) on single-document operations (`get`, `create`, `update`, `delete`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` characters.
4. **Ownership & Relational Integrity**:
   - Every created document (`Club`, `Session`, `Player`, `SessionRsvp`, `BadmintonMatch`, `ClubWallet`, `ClubJoinRequest`, `GearLocker`) must have `ownerId == request.auth.uid`.
   - `GearLocker` documents are keyed by the owner's uid (`/gearLockers/{ownerId}` with `ownerId == request.auth.uid`), so there is no list rule and no cross-account path.
   - `SessionRsvp` and `BadmintonMatch` documents cannot be created unless their referenced `sessionId` exists in `/sessions/$(incoming().sessionId)` with matching `clubId`.
   - `SessionRsvp` documents must also reference an existing `/players/$(incoming().playerId)`.
5. **Strict Key & Type Enforcement**: Every `create` and `update` invokes `isValid[Entity](incoming())` checking `keys().hasAll(...)`, `keys().hasOnly(...)`, string `.size()` bounds, numeric ranges, and enum membership.
6. **Temporal & Immutable Fields**: `createdAt` must equal `request.time` on `create` and remain immutable on `update`. `updatedAt` must equal `request.time` on `create` and `update`. `ownerId` is immutable across all updates.

## 2. The "Dirty Dozen" Payloads

1. **Shadow Field Injection (`sessions`)**: Valid `Session` payload plus `"isAdmin": true`. Rejected by `keys().hasOnly(...)`.
2. **Unverified Email Spoof (`sessions`)**: Authenticated token with `email_verified: false`. Rejected by `isVerifiedUser()`.
3. **Owner Spoofing on Create (`players`)**: `ownerId: "victim_uid_999"` while `request.auth.uid == "attacker_uid"`. Rejected by `data.ownerId == request.auth.uid`.
4. **Owner Mutation on Update (`players`)**: Changing `ownerId` during an update. Rejected by `incoming().ownerId == existing().ownerId` and `affectedKeys().hasOnly(...)`.
5. **Orphaned RSVP Creation (`rsvps`)**: Creating a `SessionRsvp` with `sessionId: "non_existent_session"`. Rejected by `exists(/databases/$(database)/documents/sessions/$(incoming().sessionId))`.
6. **Orphaned Match Creation (`matches`)**: Creating a `BadmintonMatch` with `sessionId: "non_existent_session"`. Rejected by `exists(/databases/$(database)/documents/sessions/$(incoming().sessionId))`.
7. **Timestamp Forgery on Create (`sessions`)**: Passing a past/future client timestamp instead of `request.time`. Rejected by `incoming().createdAt == request.time`.
8. **CreatedAt Mutation on Update (`sessions`)**: Attempting to alter `createdAt` on update. Rejected by `incoming().createdAt == existing().createdAt`.
9. **Oversized String Denial-of-Wallet (`sessions`)**: `title` with 5,000 characters (`> 120`). Rejected by `data.title.size() <= 120`.
10. **Path ID Poisoning (`players`)**: Document ID containing spaces/special characters or `> 128` chars. Rejected by `isValidId(playerId)`.
11. **Value Poisoning on Update (`rsvps`)**: Updating `paidStatus` to `"waived_hacked"` (not in `['unpaid', 'pending_approval', 'paid']`). Rejected by `isValidSessionRsvp(incoming())`.
12. **Unverified List Query Scraping (`sessions`)**: Listing `/sessions` without a verified email. Rejected by `isVerifiedUser()`.
13. **Cross-Account Gear Locker Write (`gearLockers`)**: Writing `/gearLockers/victim_uid` as `attacker_uid`. Rejected because the document id must equal `request.auth.uid`.
14. **Oversized Gear Locker (`gearLockers`)**: `stateJson` over 800,000 characters. Rejected by `data.stateJson.size() <= 800000`.
15. **Forged Club Join Request Id (`clubJoinRequests`)**: Creating a request whose id is not `joinreq_{clubId}_{playerId}`. Rejected by `isValidClubJoinRequest(requestId, incoming())`.
16. **Invalid Club Visibility (`clubs`)**: Setting `visibility` to anything other than `'public'` or `'private'`. Rejected by `isValidClub(incoming())`.
17. **Non-Manager Wallet Mutation (`clubWallets`)**: A verified player who is neither the club's owner nor a Site Admin attempting to create or update a `clubWallets` document for that club. Rejected by `canManageClub(incoming().clubId)` (see §0: Club Owner and Site Admin are both authorized wallet managers).
18. **Finalized Session RSVP Fee Reset (`rsvps`)**: A player attempting to reset `feeShare` to `0` after `feeSplitFinalized == true`. Rejected by `sessionIsOpen(existing().sessionId)` and `existing().feeShare == 0`.

