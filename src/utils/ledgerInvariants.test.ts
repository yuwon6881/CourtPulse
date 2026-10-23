/**
 * ledgerInvariants.test.ts
 *
 * Seeded, deterministic randomized property tests for the CourtPulse wallet and fee-split ledger.
 * Simulates 3,000 action sequences (5..25 actions each) against the real production functions
 * in badmintonLogic.ts and walletLedger.ts to verify invariants I1-I9.
 *
 * Shrinks failing sequences to minimal reproducing action traces with seed and diagnostics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { AttendanceOutcome, Club, PlayerBenefitWallet, RsvpStatus, Session, SessionRsvp } from '../types.ts';
import {
  applyWalletsToFinalizedSessionRsvps, computeSessionSplitDetails, getRsvpAdjustment,
  getRsvpGuestCount, isCashOrPendingRsvp, isManualWaiverRsvp, makeClubWalletKey, restoreSessionRsvpsAndWalletsForReopen,
  settlePlayerExistingUnpaidRsvpsWithWallet, settleRsvpAdjustment, splitPartyShareForPass,
} from './badmintonLogic.ts';
import {
  applyWalletUpdate, computeFullWalletRefund, computeManualWaiver, walletsEqual, WalletUpdate,
} from './walletLedger.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;
const randChoice = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];

const MASTER_SEED = 20261023;
const NUM_SEQUENCES = 3000;

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9';

export interface Action {
  type:
    | 'join' | 'leave' | 'late_leave' | 'guest_change' | 'mark_no_show' | 'attendance_edit'
    | 'finalize' | 'recalculate' | 'cash_paid' | 'pending_approval' | 'host_received'
    | 'reject' | 'waive' | 'reopen' | 'wallet_topup' | 'delete_session' | 'settle_adjustment';
  sessionIdx?: number;
  playerIdx?: number;
  guests?: number;
  outcome?: AttendanceOutcome;
  update?: WalletUpdate;
}

export interface SessionModel {
  id: string;
  clubId: string;
  sessionDate: string;
  courtFee: number;
  shuttleFee: number;
  feeSplitFinalized: boolean;
  bookingStatus: 'booked' | 'in_play' | 'completed';
  rsvps: SessionRsvp[];
}

export interface ModelState {
  club: Club;
  players: Array<{ id: string; name: string }>;
  sessions: SessionModel[];
  walletsMap: Record<string, PlayerBenefitWallet>;
  passesGrantedTotal: Record<string, number>;
  creditGrantedTotal: Record<string, number>; // integer cents
}

export interface InvariantFailure {
  invariantId: InvariantId;
  seed: number;
  stepIndex: number;
  actionList: Action[];
  observed: string;
  expected: string;
  message: string;
}

function generateInitialState(rng: () => number): ModelState {
  const clubId = 'club_1';
  const numPlayers = randInt(rng, 2, 6);
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));

  const club: Club = {
    id: clubId,
    name: 'Prime Badminton Club',
    description: '',
    paymentInfo: 'PayNow',
    freeCancelHours: 24,
    lockCancelHours: 4,
    lateCancelFeePercent: 50,
    noShowFeePercent: randChoice(rng, [50, 100]),
    ownerId: 'owner_user',
    clubOwnerPlayerId: undefined,
    excludeOwnerFromBilling: false,
  };

  const walletsMap: Record<string, PlayerBenefitWallet> = {};
  const passesGrantedTotal: Record<string, number> = {};
  const creditGrantedTotal: Record<string, number> = {};

  for (const p of players) {
    const credit = randChoice(rng, [0, 5, 10, 15, 20, 25.5]);
    const passes = randInt(rng, 0, 2);
    const waiveAllFees = rng() < 0.2;
    walletsMap[makeClubWalletKey(clubId, p.id)] = {
      creditBalance: credit,
      freeSessionPasses: passes,
      waiveAllFees,
    };
    passesGrantedTotal[p.id] = passes;
    creditGrantedTotal[p.id] = Math.round(credit * 100);
  }

  const numSessions = randInt(rng, 1, 3);
  const shuttleOptions = randChoice(rng, [[], [15], [10, 20]]);
  const sessions: SessionModel[] = [];

  for (let sIdx = 0; sIdx < numSessions; sIdx++) {
    const sId = `s${sIdx + 1}`;
    const courtFee = randChoice(rng, [20, 30, 40]);
    const shuttleFee = shuttleOptions.length > 0 ? randChoice(rng, shuttleOptions) : 0;
    const rsvps: SessionRsvp[] = players.map((p) => {
      const status: RsvpStatus = randChoice(rng, ['going', 'going', 'going', 'out', 'late_out']);
      const guests = status === 'going' ? randInt(rng, 0, 3) : 0;
      const attendance: AttendanceOutcome =
        status === 'going' ? (rng() < 0.8 ? 'present' : 'no_show') : 'present';
      return {
        id: `r_${sId}_${p.id}`,
        clubId,
        sessionId: sId,
        playerId: p.id,
        playerName: p.name,
        guestCount: guests,
        status,
        attendanceOutcome: attendance,
        penaltyPercentApplied:
          status === 'late_out' ? 50 : attendance === 'no_show' ? club.noShowFeePercent : 0,
        feeShare: 0,
        grossFeeShare: 0,
        walletCreditApplied: 0,
        walletPassApplied: false,
        walletWaiverApplied: false,
        paidStatus: 'unpaid',
        paidMethod: 'pending',
        ownerId: 'owner_user',
      };
    });

    sessions.push({
      id: sId,
      clubId,
      sessionDate: `2026-10-0${sIdx + 1}`,
      courtFee,
      shuttleFee,
      feeSplitFinalized: false,
      bookingStatus: 'booked',
      rsvps,
    });
  }

  return { club, players, sessions, walletsMap, passesGrantedTotal, creditGrantedTotal };
}

function generateActionList(rng: () => number, count: number): Action[] {
  const types: Action['type'][] = [
    'join', 'leave', 'late_leave', 'guest_change', 'mark_no_show', 'attendance_edit',
    'finalize', 'recalculate', 'cash_paid', 'pending_approval', 'host_received',
    'reject', 'waive', 'reopen', 'wallet_topup', 'delete_session', 'settle_adjustment',
  ];
  return Array.from({ length: count }, () => {
    const type = randChoice(rng, types);
    const update =
      type === 'wallet_topup'
        ? randChoice(rng, [
            { creditDelta: randChoice(rng, [5, 10, -5, -10]) },
            { passDelta: randChoice(rng, [1, 2, -1]) },
            { waiveAllFees: rng() < 0.5 },
            { creditDelta: 5, passDelta: 1 },
          ])
        : undefined;
    return {
      type,
      sessionIdx: randInt(rng, 0, 5),
      playerIdx: randInt(rng, 0, 5),
      guests: randInt(rng, 0, 3),
      outcome: randChoice(rng, ['present', 'excused', 'no_show']),
      update,
    };
  });
}

interface PreActionSnapshot {
  cashOrPendingRows?: Map<string, { paidStatus: string; paidMethod: string; feeShare: number }>;
}

function executeAction(state: ModelState, action: Action): PreActionSnapshot {
  const snapshot: PreActionSnapshot = {};
  if (['recalculate', 'attendance_edit', 'reopen', 'wallet_topup'].includes(action.type)) {
    const map = new Map<string, { paidStatus: string; paidMethod: string; feeShare: number }>();
    for (const sess of state.sessions) {
      for (const r of sess.rsvps) {
        if (isCashOrPendingRsvp(r)) {
          map.set(r.id, { paidStatus: r.paidStatus, paidMethod: r.paidMethod, feeShare: r.feeShare });
        }
      }
    }
    snapshot.cashOrPendingRows = map;
  }

  if (state.sessions.length === 0) return snapshot;

  const session = state.sessions[(action.sessionIdx ?? 0) % state.sessions.length];
  const player = state.players[(action.playerIdx ?? 0) % state.players.length];
  const rsvp = session.rsvps.find((r) => r.playerId === player.id);
  const ownerOpts = {
    clubOwnerPlayerId: state.club.clubOwnerPlayerId,
    excludeOwnerFromBilling: Boolean(state.club.excludeOwnerFromBilling),
  };

  const recomputeSplits = () => {
    const splits = computeSessionSplitDetails(
      session.courtFee,
      session.shuttleFee,
      session.rsvps,
      state.club.noShowFeePercent,
      ownerOpts
    ).splits;
    const res = applyWalletsToFinalizedSessionRsvps({
      sessionRsvps: session.rsvps,
      splits,
      walletsMap: state.walletsMap,
      finalizeSplit: true,
      ...ownerOpts,
    });
    session.rsvps = res.updatedSessionRsvps;
    state.walletsMap = res.updatedWalletsMap;
  };

  switch (action.type) {
    case 'join':
      if (!session.feeSplitFinalized) {
        if (rsvp) {
          Object.assign(rsvp, {
            status: 'going', guestCount: action.guests ?? 0, attendanceOutcome: 'present',
            penaltyPercentApplied: 0, feeShare: 0,
          });
        } else {
          session.rsvps.push({
            id: `r_${session.id}_${player.id}`, clubId: state.club.id, sessionId: session.id,
            playerId: player.id, playerName: player.name, guestCount: action.guests ?? 0,
            status: 'going', attendanceOutcome: 'present', penaltyPercentApplied: 0, feeShare: 0,
            grossFeeShare: 0, walletCreditApplied: 0, walletPassApplied: false, walletWaiverApplied: false,
            paidStatus: 'unpaid', paidMethod: 'pending', ownerId: 'owner_user',
          });
        }
      }
      break;

    case 'leave':
      if (!session.feeSplitFinalized && rsvp) {
        Object.assign(rsvp, { status: 'out', guestCount: 0, penaltyPercentApplied: 0, feeShare: 0 });
      }
      break;

    case 'late_leave':
      if (!session.feeSplitFinalized && rsvp) {
        Object.assign(rsvp, {
          status: 'late_out', guestCount: 0, penaltyPercentApplied: state.club.lateCancelFeePercent, feeShare: 0,
        });
      }
      break;

    case 'guest_change':
      if (!session.feeSplitFinalized && rsvp && rsvp.status === 'going') {
        rsvp.guestCount = action.guests ?? 0;
      }
      break;

    case 'mark_no_show':
      if (rsvp && rsvp.status === 'going') {
        rsvp.attendanceOutcome = 'no_show';
        rsvp.penaltyPercentApplied = state.club.noShowFeePercent;
        if (session.feeSplitFinalized) recomputeSplits();
      }
      break;

    case 'attendance_edit':
      if (rsvp && rsvp.status === 'going') {
        const out = action.outcome ?? 'present';
        rsvp.attendanceOutcome = out;
        // Mirrors handleMarkAttendanceOutcome: no-show -> club no-show %, anything else 100.
        rsvp.penaltyPercentApplied = out === 'no_show' ? state.club.noShowFeePercent : 100;
        if (session.feeSplitFinalized) recomputeSplits();
      }
      break;

    case 'finalize':
      recomputeSplits();
      session.feeSplitFinalized = true;
      session.bookingStatus = 'completed';
      break;

    case 'recalculate':
      if (session.feeSplitFinalized) recomputeSplits();
      break;

    case 'cash_paid':
      if (session.feeSplitFinalized && rsvp && rsvp.paidStatus !== 'paid' && rsvp.feeShare > 0) {
        rsvp.paidStatus = 'paid';
        rsvp.paidMethod = 'Cash';
      }
      break;

    case 'pending_approval':
      if (session.feeSplitFinalized && rsvp && rsvp.paidStatus === 'unpaid' && rsvp.feeShare > 0) {
        rsvp.paidStatus = 'pending_approval';
        rsvp.paidMethod = 'PayNow';
      }
      break;

    case 'host_received':
      if (rsvp && rsvp.paidStatus === 'pending_approval') {
        rsvp.paidStatus = 'paid';
        rsvp.paidMethod = 'Received';
      }
      break;

    case 'reject':
      if (rsvp && rsvp.paidStatus === 'pending_approval') {
        rsvp.paidStatus = 'unpaid';
        rsvp.paidMethod = 'Rejected';
      }
      break;

    case 'waive':
      if (rsvp) {
        const key = makeClubWalletKey(state.club.id, player.id);
        const w = state.walletsMap[key] || { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };
        const res = computeManualWaiver({ serverRsvp: rsvp, serverWallet: w, paidMethod: 'Fee Waived' });
        const idx = session.rsvps.findIndex((x) => x.id === rsvp.id);
        session.rsvps[idx] = res.rsvp;
        state.walletsMap[key] = res.wallet;
      }
      break;

    case 'reopen':
      if (session.feeSplitFinalized) {
        const reopened = restoreSessionRsvpsAndWalletsForReopen({
          sessionRsvps: session.rsvps,
          walletsMap: state.walletsMap,
        });
        session.rsvps = reopened.restoredSessionRsvps;
        state.walletsMap = reopened.restoredWalletsMap;
        session.feeSplitFinalized = false;
        session.bookingStatus = 'in_play';
      }
      break;

    case 'wallet_topup':
      if (action.update) {
        const key = makeClubWalletKey(state.club.id, player.id);
        const existing = state.walletsMap[key] || { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };
        const updated = applyWalletUpdate(existing, action.update);

        state.creditGrantedTotal[player.id] +=
          Math.round(updated.creditBalance * 100) - Math.round(existing.creditBalance * 100);
        state.passesGrantedTotal[player.id] += updated.freeSessionPasses - existing.freeSessionPasses;

        const sessionObjs: Session[] = state.sessions.map((s) => ({
          id: s.id, clubId: s.clubId, title: 'S', venue: 'V', courtNumbers: '1', sessionDate: s.sessionDate,
          startTime: '19:00', endTime: '21:00', bookingStatus: s.bookingStatus, courtFee: s.courtFee,
          shuttlesUsed: 0, shuttleUnitCost: 0, shuttleFee: s.shuttleFee, maxPlayers: 10,
          organizerName: 'H', paymentInfo: '', feeSplitFinalized: s.feeSplitFinalized, ownerId: 'owner_user',
        }));

        const settled = settlePlayerExistingUnpaidRsvpsWithWallet({
          playerId: player.id,
          clubId: state.club.id,
          wallet: updated,
          rsvps: state.sessions.flatMap((s) => s.rsvps),
          sessions: sessionObjs,
        });

        state.walletsMap[key] = settled.remainingWallet;
        const rsvpMap = new Map(settled.updatedRsvps.map((r) => [r.id, r]));
        for (const s of state.sessions) {
          s.rsvps = s.rsvps.map((r) => rsvpMap.get(r.id) || r);
        }
      }
      break;

    case 'delete_session':
      if (state.sessions.length > 1) {
        const targetIdx = (action.sessionIdx ?? 0) % state.sessions.length;
        const sDel = state.sessions[targetIdx];
        for (const r of sDel.rsvps) {
          const key = makeClubWalletKey(r.clubId, r.playerId);
          const w = state.walletsMap[key] || { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };
          state.walletsMap[key] = computeFullWalletRefund({ serverRsvp: r, serverWallet: w }).wallet;
        }
        state.sessions.splice(targetIdx, 1);
      }
      break;

    case 'settle_adjustment':
      if (rsvp && (rsvp.paidStatus === 'paid' || rsvp.paidStatus === 'pending_approval')) {
        const idx = session.rsvps.findIndex((x) => x.id === rsvp.id);
        session.rsvps[idx] = settleRsvpAdjustment(rsvp);
      }
      break;
  }

  return snapshot;
}

function checkInvariant(
  state: ModelState,
  invariantId: InvariantId,
  preSnapshot?: PreActionSnapshot,
  lastAction?: Action
): { ok: boolean; observed?: string; expected?: string; reason?: string } {
  switch (invariantId) {
    case 'I1': {
      for (const p of state.players) {
        const key = makeClubWalletKey(state.club.id, p.id);
        const wallet = state.walletsMap[key] || { freeSessionPasses: 0 };
        const applied = state.sessions.flatMap((s) => s.rsvps).filter((r) => r.playerId === p.id && r.walletPassApplied).length;
        const total = wallet.freeSessionPasses + applied;
        const expected = state.passesGrantedTotal[p.id];
        if (total !== expected) {
          return {
            ok: false,
            observed: `${p.id}: wallet(${wallet.freeSessionPasses}) + applied(${applied}) = ${total}`,
            expected: `${expected}`,
            reason: `Pass conservation violated for ${p.id}`,
          };
        }
      }
      return { ok: true };
    }

    case 'I2': {
      for (const p of state.players) {
        const key = makeClubWalletKey(state.club.id, p.id);
        const wallet = state.walletsMap[key] || { creditBalance: 0 };
        const walletCents = Math.round(wallet.creditBalance * 100);
        let appliedCents = 0;
        for (const s of state.sessions) {
          for (const r of s.rsvps) {
            if (r.playerId === p.id) appliedCents += Math.round((r.walletCreditApplied ?? 0) * 100);
          }
        }
        const total = walletCents + appliedCents;
        const expected = state.creditGrantedTotal[p.id];
        if (total !== expected) {
          return {
            ok: false,
            observed: `${p.id}: wallet(${walletCents}c) + applied(${appliedCents}c) = ${total}c`,
            expected: `${expected}c`,
            reason: `Credit conservation violated for ${p.id}`,
          };
        }
      }
      return { ok: true };
    }

    case 'I3': {
      for (const p of state.players) {
        const w = state.walletsMap[makeClubWalletKey(state.club.id, p.id)];
        if (w && (w.creditBalance < -1e-4 || w.freeSessionPasses < 0)) {
          return {
            ok: false,
            observed: `creditBalance=${w?.creditBalance}, freeSessionPasses=${w?.freeSessionPasses}`,
            expected: 'balances >= 0',
            reason: `Negative wallet balance on ${p.id}`,
          };
        }
      }
      for (const s of state.sessions) {
        for (const r of s.rsvps) {
          if (r.feeShare < -1e-4 || (r.grossFeeShare ?? 0) < -1e-4 || (r.walletCreditApplied ?? 0) < -1e-4) {
            return {
              ok: false,
              observed: `feeShare=${r.feeShare}, gross=${r.grossFeeShare}, creditApplied=${r.walletCreditApplied}`,
              expected: '>= 0',
              reason: `Negative fee value on row ${r.id}`,
            };
          }
          if ((r.walletCreditApplied ?? 0) > (r.grossFeeShare ?? 0) + 1e-4) {
            return {
              ok: false,
              observed: `walletCreditApplied=${r.walletCreditApplied} > gross=${r.grossFeeShare}`,
              expected: 'walletCreditApplied <= grossFeeShare',
              reason: `walletCreditApplied exceeds grossFeeShare on ${r.id}`,
            };
          }
        }
      }
      return { ok: true };
    }

    case 'I4': {
      if (preSnapshot?.cashOrPendingRows) {
        for (const s of state.sessions) {
          for (const r of s.rsvps) {
            const prev = preSnapshot.cashOrPendingRows.get(r.id);
            if (prev && (r.paidStatus !== prev.paidStatus || r.paidMethod !== prev.paidMethod || Math.abs(r.feeShare - prev.feeShare) > 1e-4)) {
              return {
                ok: false,
                observed: `status=${r.paidStatus}, method=${r.paidMethod}, feeShare=${r.feeShare}`,
                expected: `status=${prev.paidStatus}, method=${prev.paidMethod}, feeShare=${prev.feeShare}`,
                reason: `Money safety violated on row ${r.id} after ${lastAction?.type}`,
              };
            }
          }
        }
      }
      return { ok: true };
    }

    case 'I5': {
      if (lastAction?.type === 'finalize' || lastAction?.type === 'recalculate') {
        const session = state.sessions[(lastAction.sessionIdx ?? 0) % state.sessions.length];
        if (session && session.feeSplitFinalized) {
          const ownerOpts = { clubOwnerPlayerId: state.club.clubOwnerPlayerId, excludeOwnerFromBilling: Boolean(state.club.excludeOwnerFromBilling) };
          const splits = computeSessionSplitDetails(session.courtFee, session.shuttleFee, session.rsvps, state.club.noShowFeePercent, ownerOpts).splits;
          const second = applyWalletsToFinalizedSessionRsvps({
            sessionRsvps: session.rsvps, splits, walletsMap: state.walletsMap, finalizeSplit: true, ...ownerOpts,
          });

          for (let i = 0; i < session.rsvps.length; i++) {
            const a = session.rsvps[i];
            const b = second.updatedSessionRsvps[i];
            if (a.feeShare !== b.feeShare || a.grossFeeShare !== b.grossFeeShare || a.walletCreditApplied !== b.walletCreditApplied ||
                a.walletPassApplied !== b.walletPassApplied || a.paidStatus !== b.paidStatus || a.paidMethod !== b.paidMethod) {
              return { ok: false, observed: JSON.stringify(b), expected: JSON.stringify(a), reason: `Idempotency failure on ${a.id}` };
            }
          }
          for (const key of Object.keys(state.walletsMap)) {
            if (!walletsEqual(state.walletsMap[key], second.updatedWalletsMap[key])) {
              return { ok: false, observed: JSON.stringify(second.updatedWalletsMap[key]), expected: JSON.stringify(state.walletsMap[key]), reason: `Idempotency failure on wallet ${key}` };
            }
          }
        }
      }
      return { ok: true };
    }

    case 'I6': {
      // Pool = billed gross + shares the host manually waived + the amount the split itself
      // reports as unallocated (nobody weighted for it, so the host is warned before finalizing).
      for (const s of state.sessions) {
        if (!s.feeSplitFinalized) continue;
        const ownerOpts = { clubOwnerPlayerId: state.club.clubOwnerPlayerId, excludeOwnerFromBilling: Boolean(state.club.excludeOwnerFromBilling) };
        const details = computeSessionSplitDetails(s.courtFee, s.shuttleFee, s.rsvps, state.club.noShowFeePercent, ownerOpts);
        const billedRows = s.rsvps.filter((r) => (r.grossFeeShare ?? 0) > 0);
        // A manually waived row is forgiven by the host: its gross may be stale or 0, so its
        // current computed share stands in for it. Every other row must carry its own gross.
        const sumGross = s.rsvps
          .filter((r) => !isManualWaiverRsvp(r))
          .reduce((acc, r) => acc + (r.grossFeeShare ?? 0), 0);
        const waivedShare = s.rsvps
          .filter((r) => isManualWaiverRsvp(r))
          .reduce((acc, r) => acc + (details.splits.get(r.id)?.feeShare ?? 0), 0);
        const totalCost = s.courtFee + s.shuttleFee;
        const accounted = sumGross + waivedShare + details.unallocatedAmount;
        const tol = 0.01 * Math.max(1, billedRows.length);
        if (Math.abs(accounted - totalCost) > tol + 1e-4) {
          return {
            ok: false,
            observed: `sumGross=${sumGross.toFixed(2)} + waived=${waivedShare.toFixed(2)} + unallocated=${details.unallocatedAmount.toFixed(2)} (billed=${billedRows.length})`,
            expected: `totalCost=${totalCost.toFixed(2)} (tolerance ±${tol.toFixed(2)})`,
            reason: `Pool conservation violated in session ${s.id}`,
          };
        }
      }
      return { ok: true };
    }

    case 'I7': {
      for (const s of state.sessions) {
        if (!s.feeSplitFinalized) continue;
        for (const r of s.rsvps) {
          if (r.walletWaiverApplied && r.feeShare > 1e-4) {
            return { ok: false, observed: `feeShare=${r.feeShare}`, expected: '0', reason: `VIP waiver row ${r.id} owes feeShare > 0` };
          }
          // Cash / pending rows keep the money already collected; a changed share shows as an
          // adjustment (covered by I4 and I9), so only wallet-settled or unpaid rows are exact.
          if (r.walletPassApplied && !isCashOrPendingRsvp(r)) {
            const guests = getRsvpGuestCount(r);
            if (guests > 0) {
              const { guestShare } = splitPartyShareForPass(r.grossFeeShare ?? 0, guests);
              // Independent of the helper: the party share is split evenly per head.
              const perHeadGuestShare = ((r.grossFeeShare ?? 0) * guests) / (guests + 1);
              if (Math.abs(guestShare - perHeadGuestShare) > 0.01) {
                return { ok: false, observed: `guestShare=${guestShare}`, expected: `${perHeadGuestShare.toFixed(2)} (gross*guests/(guests+1))`, reason: `Guest share of ${r.id} is not an even per-head split` };
              }
              const owed = Number(((r.walletCreditApplied ?? 0) + r.feeShare).toFixed(2));
              if (Math.abs(owed - guestShare) > 0.02) {
                return { ok: false, observed: `cash+credit owed=${owed}`, expected: `guestShare=${guestShare}`, reason: `Pass+guests row ${r.id} did not owe exactly guestShare` };
              }
            }
          }
        }
      }
      return { ok: true };
    }

    case 'I8': {
      // Checked straight after a finalize: no wallet grant in between, so reopening and
      // finalizing again must land on the very same wallets.
      if (lastAction?.type !== 'finalize') return { ok: true };
      for (const s of state.sessions) {
        if (!s.feeSplitFinalized) continue;
        if (s !== state.sessions[(lastAction.sessionIdx ?? 0) % state.sessions.length]) continue;
        const ownerOpts = { clubOwnerPlayerId: state.club.clubOwnerPlayerId, excludeOwnerFromBilling: Boolean(state.club.excludeOwnerFromBilling) };
        const reopened = restoreSessionRsvpsAndWalletsForReopen({ sessionRsvps: s.rsvps, walletsMap: state.walletsMap });
        const splits = computeSessionSplitDetails(s.courtFee, s.shuttleFee, reopened.restoredSessionRsvps, state.club.noShowFeePercent, ownerOpts).splits;
        const refinalized = applyWalletsToFinalizedSessionRsvps({
          sessionRsvps: reopened.restoredSessionRsvps, splits, walletsMap: reopened.restoredWalletsMap, finalizeSplit: true, ...ownerOpts,
        });

        for (const r of s.rsvps) {
          const key = makeClubWalletKey(state.club.id, r.playerId);
          const beforeW = state.walletsMap[key] || { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };
          const afterW = refinalized.updatedWalletsMap[key] || { creditBalance: 0, freeSessionPasses: 0, waiveAllFees: false };
          if (!walletsEqual(beforeW, afterW)) {
            return {
              ok: false,
              observed: `${r.playerId}: ${JSON.stringify(afterW)}`,
              expected: `${r.playerId}: ${JSON.stringify(beforeW)}`,
              reason: `Reopen then re-finalize changed wallet of ${r.playerId} in session ${s.id}`,
            };
          }
        }
      }
      return { ok: true };
    }

    case 'I9': {
      for (const s of state.sessions) {
        for (const r of s.rsvps) {
          const adj = getRsvpAdjustment(settleRsvpAdjustment(r));
          if (adj.kind !== null) {
            return { ok: false, observed: `kind=${adj.kind}, amount=${adj.amount}`, expected: 'kind=null', reason: `settleRsvpAdjustment did not clear adjustment on ${r.id}` };
          }
        }
      }
      return { ok: true };
    }
  }

  return { ok: true };
}

const ALL_INVARIANTS: InvariantId[] = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'];

/** Runs one seeded sequence, checking every requested invariant after each step. */
function runSequence(seed: number, ids: InvariantId[], actions?: Action[]): InvariantFailure[] {
  const rng = mulberry32(seed);
  const state = generateInitialState(rng);
  const actionList = actions ?? generateActionList(rng, randInt(rng, 5, 25));
  const failures = new Map<InvariantId, InvariantFailure>();

  for (const id of ids) {
    const initCheck = checkInvariant(state, id);
    if (!initCheck.ok) {
      failures.set(id, {
        invariantId: id, seed, stepIndex: -1, actionList: [],
        observed: initCheck.observed ?? '', expected: initCheck.expected ?? '',
        message: initCheck.reason ?? 'Failed on initial state',
      });
    }
  }

  for (let i = 0; i < actionList.length; i++) {
    const act = actionList[i];
    const preSnapshot = executeAction(state, act);
    for (const id of ids) {
      if (failures.has(id)) continue;
      const check = checkInvariant(state, id, preSnapshot, act);
      if (!check.ok) {
        failures.set(id, {
          invariantId: id, seed, stepIndex: i, actionList: actionList.slice(0, i + 1),
          observed: check.observed ?? '', expected: check.expected ?? '',
          message: check.reason ?? 'Invariant failed',
        });
      }
    }
    if (failures.size === ids.length) break;
  }

  return [...failures.values()];
}

function evaluateSequence(seed: number, invariantId: InvariantId, actions?: Action[]): InvariantFailure | null {
  return runSequence(seed, [invariantId], actions)[0] ?? null;
}

function shrinkSequence(initialFailure: InvariantFailure): InvariantFailure {
  let currentFailure = initialFailure;
  let currentActions = [...initialFailure.actionList];

  let changed = true;
  while (changed && currentActions.length > 1) {
    changed = false;
    for (let i = 0; i < currentActions.length; i++) {
      const candidate = currentActions.filter((_, idx) => idx !== i);
      const fail = evaluateSequence(initialFailure.seed, initialFailure.invariantId, candidate);
      if (fail) {
        currentActions = fail.actionList;
        currentFailure = fail;
        changed = true;
        break;
      }
    }
  }

  return currentFailure;
}

// Every sequence is simulated once for all invariants; only the first failure of each
// invariant is shrunk. Results are cached so each test() below just reads its own entry.
let suiteCache: Map<InvariantId, InvariantFailure> | null = null;

function runInvariantSuite(invariantId: InvariantId): InvariantFailure | null {
  if (!suiteCache) {
    const first = new Map<InvariantId, InvariantFailure>();
    for (let i = 0; i < NUM_SEQUENCES && first.size < ALL_INVARIANTS.length; i++) {
      for (const fail of runSequence(MASTER_SEED + i, ALL_INVARIANTS)) {
        if (!first.has(fail.invariantId)) first.set(fail.invariantId, fail);
      }
    }
    suiteCache = new Map([...first].map(([id, fail]) => [id, shrinkSequence(fail)]));
  }
  return suiteCache.get(invariantId) ?? null;
}

function formatFailureReport(fail: InvariantFailure): string {
  const actionsSummary = fail.actionList.map((a, idx) => `  ${idx + 1}. ${JSON.stringify(a)}`).join('\n');
  return (
    `\n[INVARIANT VIOLATION] ${fail.invariantId}\n` +
    `  Failing Seed: ${fail.seed}\n` +
    `  Observed: ${fail.observed}\n` +
    `  Expected: ${fail.expected}\n` +
    `  Reason: ${fail.message}\n` +
    `  Minimal Action Trace (${fail.actionList.length} steps):\n${actionsSummary}\n`
  );
}

test('I1: pass conservation', () => {
  const fail = runInvariantSuite('I1');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I2: credit conservation', () => {
  const fail = runInvariantSuite('I2');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I3: no negative balances', () => {
  const fail = runInvariantSuite('I3');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I4: money safety', () => {
  const fail = runInvariantSuite('I4');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I5: idempotency', () => {
  const fail = runInvariantSuite('I5');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I6: pool conservation', () => {
  const fail = runInvariantSuite('I6');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I7: pass-for-player-only', () => {
  const fail = runInvariantSuite('I7');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I8: reopen then re-finalize returns wallet to same state', () => {
  const fail = runInvariantSuite('I8');
  if (fail) assert.fail(formatFailureReport(fail));
});

test('I9: settleRsvpAdjustment yields kind null', () => {
  const fail = runInvariantSuite('I9');
  if (fail) assert.fail(formatFailureReport(fail));
});
