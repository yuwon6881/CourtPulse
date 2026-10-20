# CourtPulse Backend Production Hardening & Role Operations Plan

This plan resolves all backend defects across authentication, registration, multi-device Firestore persistence, security rules, and role-based operations (`Site Admin`, `Club Owner`, and `Club Member / User`) so that CourtPulse operates as a fully synchronized, zero-trust production platform.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and permission decisions were confirmed and govern this remediation plan:

- **Confirmed Decision 1 — Production Authentication & Dev Persona Isolation**: Real Firebase Authentication (Google Sign-In + Email/Password with email verification) is enforced on all deployed Cloud Run and production domains. Developer Quick Access personas and silent fallback to local-only persona sessions are restricted strictly to `localhost` / `127.0.0.1` / Firebase Emulator environments.
- **Confirmed Decision 2 — Full Cloud Persistence for Wallets, Guest Counts & Club Rules**: Member benefit wallets (`creditBalance`, `freeSessionPasses`, `waiveAllFees`), RSVP guest counts (`guestCount`), and extended club billing/match rules (`excludeOwnerFromBilling`, `defaultMatchTargetPoints`, `currency`, structured `paymentDetails`) are migrated from browser `localStorage` into Firestore documents with strict schema and role validation in security rules.
- **Confirmed Decision 3 — Role & Membership Boundaries**:
  - **Club Ownership & Financial Isolation**: Each player may own at most 1 club, and Club Owners stay in their dedicated Owner workspace view. Financial ledgers, payment approvals, and member benefit wallets are managed by the Club Owner of that specific club (plus Site Admins when managing a club they own).
  - **Leaving & Removing Members**: Players can leave any club they do not own (provided they have no unsettled debt in that club), and Club Owners / Site Admins can remove members from a club roster or update club memberships.
- **Confirmed Decision 4 — Session & Ledger Lifecycle Management**: Club Owners and Site Admins can edit full session details (title, venue, date, start/end time, courts, court fee, max players, booking status), safely reopen or adjust finalized session fee splits (with automatic wallet/credit reconciliation), and delete sessions with cascading cleanup of associated RSVPs, matches, and player stat rollbacks.

---

### 1. Overview & Core Concept

- **What It Does**: CourtPulse is a multi-club badminton session organizer, automated court/shuttle fee split ledger, Elo leaderboard, and personal equipment locker. It enforces a 3-tier role architecture (`Site Admin`, `Club Owner`, and `User`) backed by Firestore real-time synchronization and Attribute-Based Access Control (ABAC) security rules.
- **Target Audience / Persona**:
  - **Club Members (`User`)**: Players who register/sign in, claim or create their player profile, join public or private clubs, RSVP (`Going`, `Out`, `Late Out`) with optional `+1` to `+4` guests, view automated fee splits and wallet perks, report payments sent, and manage their gear locker.
  - **Club Organizers (`Club Owner`)**: Organizers who own a single badminton club, configure cancellation/no-show policies and payment instructions, approve private club join requests, schedule/edit/delete sessions, mark attendance (`Present`, `No-Show`, `Excused`), finalize or reopen shuttle fee splits, manage member wallets (credits, free passes, VIP waivers), and approve/reject member payments.
  - **Platform Administrators (`Site Admin`)**: Operators who create/delete clubs, assign or transfer club ownership, approve account-to-profile link claims, and manage the platform-wide player directory.
- **Key Value**: Eliminates silent `PERMISSION_DENIED` failures, local-only state desynchronization across devices, and accidental mock-persona fallbacks on live deployments.

#### Comprehensive Backend Defect Audit

| Defect ID | Area | Root Cause Identified | Impact on Roles | Planned Fix |
| :--- | :--- | :--- | :--- | :--- |
| **DEF-01** | **Auth & Login Fallback** | Hostname check treated `.run.app` and `.usercontent.goog` as local dev environments, exposing Developer Quick Access on live deployments and silently falling back to local mock personas when an auth error occurred. | **All Roles**: Users on live URLs could enter a local-only session where `user === null` and zero writes reached Firestore. | Restrict dev personas strictly to `localhost` / `127.0.0.1` / emulator flag; surface actionable auth errors on live domains. |
| **DEF-02** | **Self Profile Update Failure** | Updating own display name sent `joinedClubIdsCsv` and `ratingScore` in the `players` update payload, violating the security rule `changed.hasOnly(['name', 'playerTag', 'updatedAt'])`, and sent all 7 RSVP fields across historical completed sessions (violating `sessionIsOpen` and `feeShare == 0` in `rsvpSelfUpdateAllowed`). | **User / Owner**: Saving personal display name threw `PERMISSION_DENIED` whenever the player had past or billed RSVPs. | Send only `{ name, playerTag }` to `players/{id}`, and allow a dedicated `playerName`-only sync action on `rsvps` in security rules. |
| **DEF-03** | **User Payment Reporting Failure** | Reporting a payment sent (`pending_approval`) sent all 7 RSVP fields (`status`, `attendanceOutcome`, `penaltyPercentApplied`, `feeShare`, `paidStatus`, `paidMethod`, `playerName`). Any local-vs-cloud delta on `feeShare` or re-reporting after an owner rejection (`paidMethod: 'Rejected'`) risked rule rejection. | **User**: Reporting payment on finalized sessions could fail or skip re-notifying a previously pending item. | Update only `{ paidStatus: 'pending_approval', paidMethod }` on `rsvps/{id}` and explicitly permit `unpaid -> pending_approval` and `pending_approval -> pending_approval` (method update) in rules regardless of session completion state. |
| **DEF-04** | **Local-Only RSVP Guest Counts** | Guest count (`+1` to `+4`) was persisted only in `localStorage` (`courtpulse_rsvp_guests_v1`) and omitted from Firestore `/rsvps/{rsvpId}`. | **User / Owner**: Guests added by a player on their phone were invisible to the Club Owner finalizing the session split on another device, causing under-billed party shares. | Add `guestCount` (`0..4`) to the `SessionRsvp` schema, Firestore writes, and `isValidSessionRsvp` security rule blueprint. |
| **DEF-05** | **Local-Only Member Wallets** | Per-club member benefit wallets (`creditBalance`, `freeSessionPasses`, `waiveAllFees`) were stored only in `localStorage` (`courtpulse_player_wallets_v1`). | **Owner / User**: Credits, free passes, and VIP fee waivers granted by a Club Owner never appeared on the member's own device. | Create a dedicated `/clubWallets/{walletId}` collection (`wallet_{clubId}_{playerId}`) synced in real time via `onSnapshot` and guarded by `isClubOwner(clubId)`. |
| **DEF-06** | **Local-Only Club Billing & Match Rules** | `excludeOwnerFromBilling`, `defaultMatchTargetPoints`, `currency`, and structured `paymentDetails` were saved only in `localStorage` instead of `/clubs/{clubId}`. | **Owner / Admin / User**: Other devices did not see owner billing exclusions, custom match target points (e.g., 15 or 30 pts), or club currency. | Persist `excludeOwnerFromBilling`, `defaultMatchTargetPoints`, and `currency` directly on `/clubs/{clubId}` and validate them in `isValidClub`. |
| **DEF-07** | **Missing Leave Club & Remove Member Logic** | Security rules only had `appendsClub(actingClubId)` (addition only). Players could not leave a club, and Club Owners / Site Admins could not remove a member from a club or update memberships. | **User / Owner / Admin**: Club memberships were permanently append-only. | Add `removesClub(actingClubId)` rule helper allowing players to leave a club (when not the club's owner) and Club Owners / Admins to remove members from their club. |
| **DEF-08** | **Club Deletion Fails for Non-Member Owners & Orphaned Data** | Deleting a club updated former members' `joinedClubIdsCsv` in a batch, which works for Admin, but did not clean up pending `/clubJoinRequests` or `/clubWallets` in the same flow, nor roll back player stats from deleted club matches. | **Admin**: Deleting a club left stale join requests, orphaned wallet docs, or inflated match stats. | Include `/clubJoinRequests` and `/clubWallets` cleanup and atomic player stat recalculation when a club or user is deleted. |
| **DEF-09** | **Missing Session Edit, Reopen Split & Delete Operations** | Sessions could only be created or cloned; full session metadata editing (`title`, `venue`, `sessionDate`, `startTime`, `endTime`), reopening a finalized split, and deleting a session with cascading cleanup of RSVPs/matches were missing. | **Owner / Admin**: Mistakes in session date/time/venue or finalized shuttle counts could not be corrected or deleted cleanly. | Add complete session edit, reopen/re-finalize split (with wallet credit/pass restoration), and cascading session delete handlers. |
| **DEF-10** | **Admin Session Scheduling & Management Parity** | While `firestore.rules` permits `canManageClub(clubId)` (`isAdmin() || isClubOwner(clubId)`), the Sessions organizer UI blocked Site Admins from scheduling or editing sessions unless they were also the assigned `clubOwnerPlayerId`. | **Admin**: Site Admins could not schedule, edit, or delete sessions in clubs they did not personally own. | Allow Site Admins (in `Admin` view) and the assigned `Club Owner` (in `Owner` view) to schedule, edit, and delete sessions for the active club, while keeping financial payment/wallet approvals strictly scoped to the Club Owner. |

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Registration, Verification & Profile Setup**:
     - New user signs in with Google (auto-verified) or registers with Email & Password -> receives verification email -> clicks `"I've verified my email"` (which reloads the Firebase Auth token so `request.auth.token.email_verified == true` is immediately recognized by Firestore rules) -> lands on **Set Up Your Player Profile** where they either create their new profile (`player_{uid}`) or search and claim an existing unlinked club roster profile (`/profileClaims/{uid}`).
  2. **Club Discovery, Joining, Leaving & Member Removal**:
     - Public clubs can be joined in one tap; private clubs create a deterministic `/clubJoinRequests/joinreq_{clubId}_{playerId}` document for the Club Owner to approve or decline.
     - Members viewing a joined club (that they do not own and where they have `$0.00` unpaid balance) can click **Leave Club**. Club Owners and Site Admins viewing their club's member roster can click **Remove from Club** to revoke membership cleanly.
  3. **Session Scheduling, Editing, Reopening Splits & Cascading Deletion**:
     - Club Owners and Site Admins can schedule new sessions, edit all session details (`Title`, `Venue`, `Date`, `Start/End Time`, `Courts`, `Court Fee`, `Max Players`, `Status`), reopen a finalized session ledger to adjust shuttle counts or attendance (automatically restoring and re-applying any wallet passes/credits consumed by that session), or delete a session with confirmation (cleaning up its RSVPs, matches, and rolling back player stats).
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Crisp athletic SaaS utility (`Plus Jakarta Sans` / `DM Sans` with `JetBrains Mono` `tabular-nums` for all currency, Elo ratings, court counts, and rally scores).
  - *Color Palette & Mood*: 60% clean neutral canvas (`bg-slate-50` / `bg-white`), 30% structural slate surfaces and hairline borders (`border-slate-200/80`), 10% high-intent emerald accent (`bg-emerald-600`) for primary actions, with semantic amber (`amber-700`) for pending/late-out warnings and rose (`rose-700`) for destructive confirmations.
  - *Component Styling & Layout*: Single-elevation cards, unboxed metadata separated by middle dots (`·`), responsive 3-zone header bar, and confirmation modals (`ConfirmModal`) for all destructive or financial state transitions.
- **Interactive Feedback & Motion**:
  - Immediate optimistic UI state transitions paired with atomic `safeBatchWrite` commits, inline validation banners (`FormAlertBanner`), and auto-dismissing save confirmation notices.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dedicated `/clubWallets/{walletId}` Collection vs. Embedding Wallets in `/players/{playerId}`**
  - *Chosen Approach*: Store per-club member benefit wallets in a top-level `/clubWallets/{walletId}` collection with deterministic ID `wallet_{clubId}_{playerId}`.
  - *Why*: Firestore security rules do not support dynamic map key inspection cleanly when multiple club owners need independent write access to only their own club's wallet on a shared player document. A dedicated `/clubWallets/{walletId}` document allows strict, zero-trust validation (`isClubOwner(data.clubId)`), atomic batch updates alongside `/rsvps/{rsvpId}` during session finalization, and zero contention with player profile or match stat updates.
  - *Alternatives Considered*: Storing a nested `clubWallets` map inside `/players/{playerId}` was rejected because rules cannot easily enforce that Owner A only mutates `clubWallets[clubA]` without touching `clubWallets[clubB]`.
- **Decision 2: Reversible Session Fee Split Finalization**
  - *Chosen Approach*: Record how each RSVP was settled (`paidMethod`, `feeShare`) and allow Club Owners / Admins to reopen a finalized session or re-finalize with updated court/shuttle costs, safely recalculating splits and reconciling member wallets.
  - *Why*: Organizers frequently need to correct a miscounted shuttle tube or mark a late arrival after initially finalizing the split.
- **Decision 3: Strict Separation of Dev Personas from Production Auth**
  - *Chosen Approach*: Gate `isDevEnvironment` strictly on `import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'`.
  - *Why*: Prevents live Cloud Run deployments (`*.run.app`) from exposing mock persona bypass buttons or silently dropping users into an unauthenticated local state when a sign-in error occurs.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

#### Architecture & Role-Based Data Flow Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        FIREBASE AUTHENTICATION & IDENTITY                         │
│  ┌─────────────────────┐   ┌────────────────────────┐   ┌──────────────────────┐  │
│  │ Google OAuth Popup  │   │ Email/Password + Verify│   │ Profile Claim / Setup│  │
│  └──────────┬──────────┘   └───────────┬────────────┘   └──────────┬───────────┘  │
└─────────────┼──────────────────────────┼───────────────────────────┼──────────────┘
              └──────────────────────────┼───────────────────────────┘
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    ROLE & PERMISSION GATE (Client + Firestore Rules)              │
│  • Site Admin  : /admins/{uid} OR verified bootstrap admin email                  │
│  • Club Owner  : clubs/{clubId}.ownerPlayerId == players/{me}.id (authUid == uid) │
│  • Club Member : players/{me}.joinedClubIdsCsv contains clubId                    │
└─────────────┬──────────────────────────┬───────────────────────────┬──────────────┘
              │                          │                           │
              ▼                          ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────────────┐
│   SITE ADMIN ACTIONS    │ │   CLUB OWNER ACTIONS    │ │    CLUB MEMBER ACTIONS    │
│ • Create / Delete Clubs │ │ • Edit Club Policy/Pay  │ │ • Edit Own Name           │
│ • Assign Club Owner     │ │ • Approve/Reject Joins  │ │ • Join Public / Req Priv  │
│ • Approve Profile Claims│ │ • Remove Club Members   │ │ • Leave Unowned Club      │
│ • Manage All Users      │ │ • Schedule/Edit/Delete  │ │ • RSVP Going/Out (+Guests)│
│ • Schedule/Edit/Delete  │ │   Sessions & Splits     │ │ • Report Payment Sent     │
│   Sessions              │ │ • Manage /clubWallets   │ │ • Manage Own /gearLockers │
│                         │ │ • Approve/Reject Rsvps  │ │                           │
│                         │ │ • Log / Delete Matches  │ │                           │
└─────────────┬───────────┘ └────────────┬────────────┘ └─────────────┬─────────────┘
              └──────────────────────────┼───────────────────────────┘
                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                     FIRESTORE COLLECTIONS & ATOMIC BATCHES                        │
│  /clubs/{clubId}          /sessions/{sessionId}       /players/{playerId}         │
│  /rsvps/{rsvpId}          /matches/{matchId}          /clubWallets/{walletId}     │
│  /clubJoinRequests/{id}   /profileClaims/{uid}        /gearLockers/{uid}          │
└───────────────────────────────────────────────────────────────────────────────────┘
```

#### Role-Based Operations & Security Rules Matrix

| Resource & Operation | Regular Member (`User`) | Club Owner (`club_owner`) | Site Admin (`admin`) | Firestore Rule Enforcement |
| :--- | :--- | :--- | :--- | :--- |
| **Auth: Register / Sign In / Verify** | Yes | Yes | Yes | `isVerifiedUser()` (`request.auth != null && request.auth.token.email_verified == true`) |
| **Profile: Create Self (`player_{uid}`)** | Yes (1 per account, fresh stats) | Yes | Yes | `playerId == 'player_' + request.auth.uid && hasFreshStats()` |
| **Profile: Claim Unlinked Profile** | Request via `/profileClaims/{uid}` | Request via `/profileClaims/{uid}` | Instant self-link or Approve/Reject any claim | `/profileClaims/{uid}` create by owner; approve/link by `isAdmin()` |
| **Profile: Edit Display Name** | Own profile + own RSVPs `playerName` | Own profile + club members' name/rating | Any player profile | `isPlayerSelf(playerId)` for `['name', 'playerTag', 'updatedAt']`; `rsvps` allows self `playerName`-only sync |
| **Club: Create / Delete / Reassign Owner** | No | No | Yes (1 club per owner limit) | `isAdmin()` on `/clubs/{clubId}` create, delete, and `ownerPlayerId` update |
| **Club: Edit Settings, Policy, Currency, Billing Exclusion** | No | Own club only | Any club | `isAdmin() \|\| isClubOwner(clubId)` with `isValidClub()` |
| **Club Membership: Join / Request / Approve** | Join public club; request private club | Approve/reject requests & add members to own club | Add/remove any player to/from any club | `appendsClub(actingClubId)` for self (public) or `isClubOwner(actingClubId)` |
| **Club Membership: Leave / Remove Member** | Leave any joined club (if not owner & no unpaid debt) | Remove member from own club (if not owner) | Remove member from any club | `removesClub(actingClubId)` for `isPlayerSelf(playerId)` or `canManageClub(actingClubId)` |
| **Session: Create / Clone / Edit Full Details / Delete** | View only | Own club sessions | Any club sessions | `canManageClub(clubId)` on `/sessions/{sessionId}` create, update, delete |
| **RSVP: Tap Going / Out / Late Out + Guest Count (`0..4`)** | Own RSVP while session is open & in joined club | Own RSVP + any member RSVP in own club | Any RSVP | `rsvpSelfUpdateAllowed()` includes `guestCount` (`0..4`) while `sessionIsOpen()` |
| **Session: Mark Attendance & Finalize / Reopen Fee Split** | View split | Own club sessions | Any club sessions | `canManageClub(clubId)` batch updates `sessions`, `rsvps`, and `clubWallets` |
| **Payments: Report Payment Sent (`pending_approval`)** | Own unpaid/pending RSVP (`paidStatus`, `paidMethod`) | Own RSVP | Own RSVP | `rsvpSelfPaymentUpdateAllowed()` permits updating only `['paidStatus', 'paidMethod', 'updatedAt']` to `'pending_approval'` even on completed sessions |
| **Payments: Approve (`paid`) / Reject (`unpaid`)** | No | Own club RSVPs only | Own club RSVPs (if Admin owns club) | `isClubOwner(existing().clubId) \|\| isAdmin()` |
| **Member Wallets: Credit, Free Passes, VIP Waiver** | View own club wallets | Manage for own club (`/clubWallets/wallet_{clubId}_{playerId}`) | Manage for owned club | `/clubWallets/{walletId}` write restricted to `isClubOwner(incoming().clubId) \|\| isAdmin()` |
| **Matches: Record Match / Delete Match (with Stat Rollback)** | View match history & Elo | Own club sessions (atomic batch with player stats) | Any club sessions | `canManageClub(clubId)` + `matchAuthorizesStats()` / `matchDeletionAuthorizesStats()` |
| **Gear Locker: Rackets, Strings, Shuttles** | Own `/gearLockers/{uid}` | Own `/gearLockers/{uid}` | Own `/gearLockers/{uid}` | `ownerId == request.auth.uid` |

#### Data Model & Schema Updates (`firebase-blueprint.json` & `firestore.rules`)

1. **`Club` (`/clubs/{clubId}`)**:
   - Add optional persisted fields: `excludeOwnerFromBilling` (`bool`), `defaultMatchTargetPoints` (`int`, `1..100`), `currency` (`string`, `1..10`), alongside existing `visibility` (`'public' | 'private'`) and `ownerPlayerId`.
2. **`SessionRsvp` (`/rsvps/{rsvpId}`)**:
   - Add optional persisted field: `guestCount` (`int`, `0..4`) so party size (`1 + guestCount`) is synchronized across all devices and enforced by `isValidSessionRsvp`.
3. **`ClubWallet` (`/clubWallets/{walletId}`)**:
   - Deterministic ID: `wallet_{clubId}_{playerId}`.
   - Required fields: `clubId` (valid ID), `playerId` (valid ID), `creditBalance` (`number`, `0..100000`), `freeSessionPasses` (`int`, `0..1000`), `waiveAllFees` (`bool`), `ownerId` (valid ID), `createdAt` (`timestamp`), `updatedAt` (`timestamp`).
   - Read access: `isVerifiedUser()`.
   - Create/Update/Delete access: `isVerifiedUser() && (isClubOwner(incoming().clubId) || isAdmin())`.

#### Interactive Component & State Mapping

- **Authentication Gate**:
  - Restricts `isDevEnvironment` strictly to local development (`localhost`, `127.0.0.1`, `import.meta.env.DEV`, or emulator mode).
  - Surfaces clear guidance if an unconfigured provider error (`auth/operation-not-allowed`) occurs in production instead of silently switching into a disconnected mock persona.
- **Clubs & Memberships View & Settings View**:
  - Adds a **Leave Club** action (with confirmation modal) for members on clubs they do not own, blocked if the member has unsettled unpaid fees in that club.
  - Adds a **Remove Member** action (with confirmation modal) inside the Club Roster modal and Admin User Management modal so Club Owners and Site Admins can remove members from a club.
- **Sessions Overview & Session RSVP / Ledger Portal**:
  - Enables full **Edit Session Details** modal (editing title, venue, date, start/end time, court numbers, court fee, max players, and booking status) and **Delete Session** confirmation modal (cascading delete of the session's RSVPs and matches, plus rolling back player stats from any matches logged in that session) for Club Owners and Site Admins.
  - Adds a **Reopen / Edit Finalized Split** flow on completed sessions so organizers can unlock a finalized session, adjust shuttle counts, court fees, or attendance outcomes, and re-finalize cleanly.
