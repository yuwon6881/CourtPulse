# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Global Default Deny**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity**: All writes and reads require an authenticated user (`request.auth != null`) with `request.auth.token.email_verified == true`.
3. **Path ID Hardening**: Document IDs (`{sessionId}`, `{playerId}`, `{rsvpId}`, `{matchId}`) on single-document operations (`get`, `create`, `update`, `delete`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` characters.
4. **Ownership & Relational Integrity**:
   - Every document (`Session`, `Player`, `SessionRsvp`, `BadmintonMatch`, `GearLocker`) must have `ownerId == request.auth.uid`.
   - `GearLocker` documents are keyed by the owner's uid (`/gearLockers/{ownerId}` with `ownerId == request.auth.uid`), so there is no list rule and no cross-account path.
   - `SessionRsvp` and `BadmintonMatch` documents cannot be created unless their referenced `sessionId` exists in `/sessions/$(incoming().sessionId)` and belongs to `request.auth.uid`.
   - `SessionRsvp` documents must also reference an existing `/players/$(incoming().playerId)` owned by `request.auth.uid`.
5. **Strict Key & Type Enforcement**: Every `create` and `update` invokes `isValid[Entity](incoming())` checking `keys().hasAll(...)`, `keys().hasOnly(...)`, string `.size()` bounds, numeric ranges, and enum membership.
6. **Temporal & Immutable Fields**: `createdAt` must equal `request.time` on `create` and remain immutable on `update`. `updatedAt` must equal `request.time` on `create` and `update`. `ownerId` is immutable across all updates.
7. **Query Enforcer on List**: `allow list` never uses `get()` or `exists()` and strictly enforces `resource.data.ownerId == request.auth.uid`.

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
11. **Value Poisoning on Update (`rsvps`)**: Updating `paidStatus` to `"free_override"` (not in `['unpaid', 'paid']`). Rejected by `isValidSessionRsvp(incoming())`.
12. **Unauthorized Cross-Tenant List Scraping (`sessions`)**: Listing `/sessions` without filtering `ownerId == request.auth.uid`. Rejected by `allow list: if isVerifiedUser() && resource.data.ownerId == request.auth.uid;`.
13. **Cross-Account Gear Locker Write (`gearLockers`)**: Writing `/gearLockers/victim_uid` as `attacker_uid`. Rejected because the document id must equal `request.auth.uid`.
14. **Oversized Gear Locker (`gearLockers`)**: `stateJson` over 800,000 characters. Rejected by `data.stateJson.size() <= 800000`.
15. **Forged Club Join Request Id (`clubJoinRequests`)**: Creating a request whose id is not `joinreq_{clubId}_{playerId}` (or for a club/player that does not exist, or with `ownerId` of another account). Rejected by `isValidClubJoinRequest(requestId, incoming())`, the `exists()` checks and `ownerId == request.auth.uid`. Requests are immutable (`allow update: if false`).
16. **Invalid Club Visibility (`clubs`)**: Setting `visibility` to anything other than `'public'` or `'private'`. Rejected by `isValidClub(incoming())`.
