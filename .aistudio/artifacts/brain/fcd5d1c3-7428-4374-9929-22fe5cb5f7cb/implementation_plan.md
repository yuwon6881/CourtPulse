# CourtPulse Production Readiness & Security Hardening Plan

This plan addresses all backend, authentication, role-based access control (RBAC), validation, and state-isolation gaps identified during the production readiness audit so CourtPulse can be safely deployed to Google Cloud / Firebase Hosting and Cloud Firestore.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and security decisions were confirmed and govern this production hardening pass:

- **Confirmed Decision 1 — Disable Developer Quick Access in Production**: Developer Quick Access personas and `localStorage` dev sessions are strictly disabled in production builds (`import.meta.env.PROD`), preventing anyone from bypassing the authentication gate via browser storage inspection.
- **Confirmed Decision 2 — Strict Club Owner Financial & Wallet Authority in Firestore Rules**: Only a club's assigned Club Owner (`isClubOwner(clubId)`) may create or update member wallets (`clubWallets`), finalize session fee splits, or approve/reject member RSVP payments (`paidStatus: 'paid'` or `'unpaid'`). Site Admins retain platform governance (creating/deleting clubs, managing user accounts, linking profiles, and cascade-deleting records when removing a club or user).
- **Confirmed Decision 3 — Clean Production Database Boot (No Demo Auto-Seeding)**: Production builds will not auto-seed demo clubs, sessions, or fake players into an empty Firestore database. First-time users and Site Admins will land in a clean workspace with resilient zero-states for creating the first club and profile.

---

## 1. Overview & Core Concept

- **What It Does**: Hardens CourtPulse's authentication lifecycle, Firestore security rules, client-side state transitions, and zero-state UI resilience for live multi-tenant badminton club operations.
- **Target Audience / Persona**:
  - **Platform Site Admins**: Provision clubs, assign club owners, and approve member profile-link claims without accessing or altering private club financial ledgers.
  - **Club Owners**: Organize sessions, manage club rosters, finalize court/shuttle fee splits, approve member payment notifications, and manage member benefit wallets (credits, free passes, VIP waivers).
  - **Club Members**: Join public or private clubs, RSVP with optional guests, track ELO standings and personal gear lockers, and report session fee payments.
- **Key Value**: Eliminates permission crashes on first-time Gear Locker access, prevents post-logout cloud data leaks into browser storage, enforces strict financial role boundaries at the database rule layer, and ensures empty production databases work seamlessly from day one.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Production Sign-In & Verification Gate**: Unauthenticated visitors see either the shared session invitation preview (when arriving via an invite URL) or the authentication card supporting Google OAuth Popup and Email/Password with mandatory email verification (`email_verified == true`). Developer persona buttons are completely absent in production builds.
  2. **First-Time Profile Onboarding & Claim Flow**: Verified users without a linked player profile either create a fresh profile (`player_{uid}`) in one click or browse/search unclaimed organizer-created profiles to request a Site Admin account link.
  3. **Empty Database Zero-State (First Production Boot)**: When no clubs exist in Firestore yet, Site Admins see a dedicated zero-state action card to create the platform's first club and assign its owner, while regular members see a clean empty state prompting them to wait for a club invite or browse once clubs are published.
  4. **Secure Sign-Out & Session Reset**: Signing out immediately purges all in-memory cloud snapshots (`clubs`, `sessions`, `players`, `rsvps`, `matches`, `clubWallets`, `profileClaims`) without writing cloud data to `localStorage`, returning cleanly to the authentication gate.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Crisp athletic SaaS utility with high-density tabular ledgers, single-level card elevation, and zero decorative clutter.
  - *Color Palette & Mood*: Cool neutral canvas (`bg-slate-50` / `bg-white`), deep slate primary actions (`bg-slate-900`), emerald high-intent accents (`bg-emerald-600`, `text-emerald-700`), amber warning states (`text-amber-700`), and rose destructive/overdue states (`text-rose-700`).
  - *Typography & Hierarchy*: Expressive display headings paired with readable sans-serif body copy and strict `font-mono tabular-nums` alignment across all ELO ratings, court/shuttle fee splits, and wallet balances.
  - *Component Styling & Layout*: 1px hairline borders (`border-slate-200/90`), responsive 3-zone top navigation bar, and mobile bottom navigation bar with consistent club context scoping.
- **Interactive Feedback & Motion**:
  - Instant optimistic state updates backed by atomic Firestore batch writes (`safeBatchWrite`).
  - Clear inline validation banners (`FormAlertBanner`) for authentication, rate limiting, and permission boundaries.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Strict Separation of Platform Governance vs. Club Financial Authority in `firestore.rules`**
  - *Chosen Approach*: Split club management helpers in `firestore.rules` into `canManageClub(clubId)` (for non-financial club/session/match operations, or restrict financial operations to `isClubOwner(clubId)`) and `isClubOwner(clubId)` (strictly required for `clubWallets` create/update and RSVP payment approval/rejection), while allowing `isAdmin()` on `delete` for cascade cleanup when deleting a club or player.
  - *Why*: Matches the application's privacy and governance guarantee that Site Admins administer the platform directory and club ownership assignments, whereas only the assigned Club Owner controls their club's money, credits, and payment approvals.
  - *Alternatives Considered*: Allowing `isAdmin()` full write access to `clubWallets` and RSVP payment statuses was rejected because it violates the confirmed role separation at the backend rule layer.

- **Decision 2: Null-Safe Resource Evaluation on Per-Account Document Reads (`/gearLockers/{ownerId}`)**
  - *Chosen Approach*: Update `/gearLockers/{ownerId}` `allow get` to check `ownerId == request.auth.uid && (resource == null || existing().ownerId == request.auth.uid)`.
  - *Why*: In Firestore Security Rules, evaluating `resource.data` (`existing()`) when a document does not exist yet throws a runtime evaluation error and returns `PERMISSION_DENIED`. Allowing `resource == null` when the document ID matches `request.auth.uid` lets `onSnapshot` cleanly report `{ status: 'missing' }` on first open.
  - *Alternatives Considered*: Pre-creating a `gearLockers` document for every user during sign-up adds unnecessary writes for users who haven't opened the Gear Locker.

- **Decision 3: Complete Removal of Demo Auto-Seeding in Production**
  - *Chosen Approach*: Gate local demo fallback state and cloud auto-seeding strictly behind development/emulator mode (`import.meta.env.DEV`), and ensure all views (`Clubs`, `Users & Balances`, `Profile`, `Settings`, `Sessions`, `Standings`) handle `clubs.length === 0` (`activeClub === undefined`) with explicit empty states.
  - *Why*: Prevents test personas (`Alex Tan`, `Sarah Lin`, `Kevin Lee`) and sample sessions from polluting a live production Firestore database on first admin sign-in.
  - *Alternatives Considered*: Auto-seeding and deleting later requires manual cleanup of multiple collections (`clubs`, `sessions`, `players`, `rsvps`, `matches`).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Role Authorization Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Client Application (React + Vite)                     │
│                                                                              │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────┐  │
│  │   Auth & Onboarding  │   │  Club & Session Ops  │   │ Financial Ledger │  │
│  │  • Google Popup Auth │   │  • Sessions & Courts │   │  • Fee Splits    │  │
│  │  • Email + Verify    │   │  • Tap RSVP (+Guest) │   │  • Pay Approvals │  │
│  │  • Profile Setup /   │   │  • Match Scorer &    │   │  • Club Wallets  │  │
│  │    Admin Claim Link  │   │    Standings ELO     │   │    (Owner Only)  │  │
│  └──────────┬───────────┘   └──────────┬───────────┘   └────────┬─────────┘  │
└─────────────┼──────────────────────────┼────────────────────────┼────────────┘
              │                          │                        │
              ▼                          ▼                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Cloud Firestore Security Rules (Zero-Trust ABAC)             │
│                                                                              │
│  • Global Gate: isSignedIn() && request.auth.token.email_verified == true    │
│  • Identity Resolution: players/{playerId}.authUid == request.auth.uid       │
│                                                                              │
│  ┌─────────────────────────┬────────────────────────┬─────────────────────┐  │
│  │   Site Admin (isAdmin)  │ Club Owner (isClubOwn) │   Member (isSelf)   │  │
│  ├─────────────────────────┼────────────────────────┼─────────────────────┤  │
│  │ • Create / Delete Clubs │ • Edit Owned Club      │ • Create Own Player │  │
│  │ • Assign Club Owner     │ • CRUD Sessions/Matches│ • Join Public Club  │  │
│  │ • Approve Profile Claims│ • Approve Join Reqs    │ • Request Private   │  │
│  │ • Cascade Delete Users, │ • Finalize Fee Splits  │ • Open-Session RSVP │  │
│  │   Clubs, Wallets, RSVPs │ • Approve/Reject Paid  │ • Report Payment    │  │
│  │                         │ • CRUD clubWallets     │ • Own Gear Locker   │  │
│  └─────────────────────────┴────────────────────────┴─────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Security Rule Enhancements

1. **`/gearLockers/{ownerId}`**:
   - Fix `allow get` to permit reads when `ownerId == request.auth.uid && (resource == null || existing().ownerId == request.auth.uid)`.
2. **`/clubWallets/{walletId}`**:
   - Restrict `allow create, update` strictly to `isClubOwner(incoming().clubId)` / `isClubOwner(existing().clubId)`.
   - Allow `allow delete` for `isClubOwner(existing().clubId) || isAdmin()` so Site Admins can still cascade-delete wallets when deleting a club or user.
3. **`/rsvps/{rsvpId}`**:
   - **Self-Update Guard (`rsvpSelfUpdateAllowed`)**:
     - Block self-updates to `status`, `guestCount`, `penaltyPercentApplied`, or `feeShare` once the parent session has `feeSplitFinalized == true` or `bookingStatus == 'completed'`, and require `existing().feeShare == 0` when a player updates their open-session RSVP.
     - Ensure `paidMethod` can only be modified by a player when `paidStatus` is transitioning to `'pending_approval'`.
   - **Manager vs. Club Owner Update Separation**:
     - Restrict payment approval/rejection (`paidStatus` changing to `'paid'` or reverting from `'pending_approval'` to `'unpaid'`, or changing `feeShare`) to `isClubOwner(existing().clubId)`.
     - Allow `canManageClub(existing().clubId)` to manage open-session attendance/roster entries and sync `playerName` when a player's display name is updated.
4. **Blueprint & Security Test Suite Synchronization**:
   - Update `firebase-blueprint.json` so all collections (`/clubs`, `/sessions`, `/players`, `/rsvps`, `/matches`, `/clubWallets`, `/gearLockers`, `/clubJoinRequests`, `/profileClaims`, `/admins`) and field constraints (`joinedClubIdsCsv` `minLength: 0`) are represented accurately.
   - Add test cases in `firestore.rules.test.ts` covering non-owner admin wallet mutation rejection, finalized-session RSVP fee tampering rejection, and Gear Locker read safety.

### Interactive Component & State Mapping

1. **Production Auth & Dev-Mode Isolation**:
   - Gate `loadDevSession()`, `saveDevSession()`, `DEV_LOGIN_PERSONAS` UI in `AuthGateAndClubJoinModal`, and the dev persona switcher in `App` strictly behind `import.meta.env.DEV || import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'`.
   - In production builds (`import.meta.env.PROD`), initialize state with empty arrays (`[]`) instead of `INITIAL_CLUBS` / `INITIAL_SESSIONS` / `INITIAL_PLAYERS` / `INITIAL_RSVPS` / `INITIAL_MATCHES`, and disable `seedInitialClubDataToFirestore` so empty production databases stay clean.
2. **Post-Logout State Purge & Storage Guard**:
   - Only persist offline demo state to `localStorage` (`LOCAL_STATE_STORAGE_KEY`) when running in development local-demo mode (`!user && Boolean(devSession)`).
   - When `handleSignOutAccount` runs (or when `onAuthStateChanged` transitions from a signed-in user to `null`), reset all cloud state slices (`rawClubs`, `sessions`, `players`, `rsvps`, `matches`, `playerWalletsMap`, `clubJoinRequests`, `myProfileClaim`, `profileClaims`, `isAdminDoc`, `playersLoaded`, `inspectedPlayerId`, `paymentModalOpen`, `accountMenuOpen`) so zero cloud data remains in memory or leaks to `localStorage`.
3. **Empty-Database Zero-States & Club Owner Member Creation**:
   - Ensure `Clubs` (`AdminClubAndPolicySettings`), `Users & Balances` (`SiteAdminUserManagement`), `Profile`, and `Settings` render safely when `clubs.length === 0` (`activeClub` is `undefined`), giving Site Admins an immediate `"Create First Club"` workflow.
   - Fix `handleAdminCreateUser` so a Club Owner creating a member always targets their `myOwnedClub.id` regardless of whether the top club filter was set to `'all'`, and update the mobile bottom navigation bar to route through `handleSelectNavItem`.
   - In `ProfileSetupScreen`, display the list of unclaimed player profiles immediately on the `"I Already Have One"` tab (with live search filtering) so returning club members can easily spot and claim their profile.
