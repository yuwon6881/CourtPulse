import React, { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import {
  auth,
  db,
  describeFirestoreFailure,
  safeDeleteDoc,
  safeSetDoc,
  safeUpdateDoc,
} from '../firebase';
import { buildShareableClubAndSessionUrl } from '../utils/badmintonLogic';
import {
  buildReferralUrl,
  generateReferralCode,
  isValidReferralCode,
} from '../utils/referral';
import { FormAlertBanner } from './ui/FormControls';

interface ClubReferralPanelProps {
  clubId: string;
  isPrivate: boolean;
}

/**
 * The club manager's referral link: the invite URL plus a secret code. Anyone who signs up through
 * it joins the club automatically, with no confirm card and no approval step. Revoking (or
 * regenerating) the code stops the old link from working for anyone who has not used it yet.
 */
export const ClubReferralPanel: React.FC<ClubReferralPanelProps> = ({
  clubId,
  isPrivate,
}) => {
  // undefined = still loading, null = no code yet
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const signedIn = Boolean(auth.currentUser);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    setCode(undefined);
    setError(null);
    getDoc(doc(db, 'clubReferralCodes', clubId))
      .then((snap) => {
        if (cancelled) return;
        const stored = snap.exists() ? (snap.data() as { code?: unknown }).code : null;
        setCode(isValidReferralCode(stored) ? stored : null);
      })
      .catch((err) => {
        if (cancelled) return;
        setCode(null);
        setError(describeFirestoreFailure(err));
      });
    return () => {
      cancelled = true;
    };
  }, [clubId, signedIn]);

  // Local demo mode has no cloud database to hold a code.
  if (!signedIn) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(describeFirestoreFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const next = generateReferralCode();
      if (code) {
        await safeUpdateDoc('clubReferralCodes', clubId, { code: next, ownerId: uid });
      } else {
        await safeSetDoc('clubReferralCodes', clubId, { clubId, code: next, ownerId: uid });
      }
      setCode(next);
    });

  const revoke = () =>
    run(async () => {
      await safeDeleteDoc('clubReferralCodes', clubId);
      setCode(null);
    });

  const link = code ? buildReferralUrl(buildShareableClubAndSessionUrl(clubId), code) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // The field is selectable as a fallback.
    }
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <KeyRound className="w-3.5 h-3.5 text-emerald-700" />
        Referral Link (no approval needed)
      </label>
      <p className="text-xs text-slate-500">
        {isPrivate
          ? 'People who open this link can join the club by pressing Join, without waiting for your approval. Share it only with people you trust.'
          : 'People who open this link see a Join button for this club.'}
      </p>
      <FormAlertBanner message={error} variant="error" onDismiss={() => setError(null)} />
      {code === undefined ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : code === null ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-xs"
        >
          <KeyRound className="w-4 h-4" />
          <span>{busy ? 'Please wait…' : 'Generate Referral Link'}</span>
        </button>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Referral Link"
              className="flex-1 h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-xs font-mono text-slate-700 shadow-2xs focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15 select-all"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Referral Link Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Referral Link</span>
                </>
              )}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void generate()}
              className="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Replace Link</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              className="h-9 px-3 rounded-xl bg-red-50 hover:bg-red-100 disabled:opacity-60 text-red-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Turn Off</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
