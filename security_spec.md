# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Global Default Deny**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity**: All writes and reads require an authenticated user (`request.auth != null`) with `request.auth.token.email_verified == true`.
3. **Path ID Hardening**: Document IDs (`{sessionId}`, `{playerId}`, `{rsvpId}`, `{matchId}`) on single-document operations (`get`, `create`, `update`, `delete`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` characters.
4. **Ownership & Relational Integrity**:
   - Every document (`Session`, `Player`, `SessionRsvp`, `BadmintonMatch`) must have `ownerId == request.auth.uid`.
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
