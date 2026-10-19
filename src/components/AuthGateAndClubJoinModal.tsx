import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Globe,
  Lock,
  LogIn,
  Mail,
  UserPlus,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Club, Player } from '../types';
import {
  describeAuthError,
  refreshCurrentUser,
  registerWithEmailPassword,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithEmailPassword,
} from '../firebase';
import { SegmentedControl, StyledInput } from './ui/FormControls';

interface AuthGateScreenProps {
  invitedClub: Club | null;
  onSignInWithGoogle: () => Promise<void>;
  authError: string | null;
}

const AuthCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex flex-col justify-center items-center px-4 py-12">
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="w-full max-w-md bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-6"
    >
      {children}
    </motion.div>
  </div>
);

const AuthHeader: React.FC<{ title: string; subtitle?: string }> = ({
  title,
  subtitle,
}) => (
  <div className="text-center space-y-1.5">
    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
      CourtPulse Badminton
    </p>
    <h1 className="text-2xl font-bold text-slate-900 font-display">{title}</h1>
    {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
  </div>
);

const MIN_PASSWORD_LENGTH = 8;

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  invitedClub,
  onSignInWithGoogle,
  authError,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regName, setRegName] = useState('');

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      const msg = describeAuthError(err);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => signInWithEmailPassword(email, password));
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) {
      setError('Enter your name.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }
    void run(() => registerWithEmailPassword(regName, email, password));
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      setError('Enter your email above, then tap "Forgot password?" again.');
      return;
    }
    void run(async () => {
      await sendPasswordReset(email);
      setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
    });
  };

  return (
    <AuthCard>
      <AuthHeader
        title={invitedClub ? `Join ${invitedClub.name}` : 'Badminton Club Portal'}
        subtitle={
          invitedClub
            ? 'Sign in or create an account to accept your club invitation.'
            : undefined
        }
      />

      <div className="flex justify-center">
        <SegmentedControl
          options={[
            { value: 'login', label: 'Sign In' },
            { value: 'register', label: 'Create Account' },
          ]}
          value={mode}
          onChange={(val) => {
            setMode(val);
            setError(null);
            setNotice(null);
          }}
        />
      </div>

      <div className="space-y-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(onSignInWithGoogle)}
          className="w-full h-11 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
        >
          <LogIn className="w-4 h-4" />
          <span>Continue with Google</span>
        </button>

        <div className="relative flex py-1 items-center">
          <div className="grow border-t border-slate-200"></div>
          <span className="shrink mx-3 text-[11px] font-medium text-slate-500">
            or with email
          </span>
          <div className="grow border-t border-slate-200"></div>
        </div>

        <form
          onSubmit={mode === 'login' ? handleSignIn : handleRegister}
          className="space-y-3.5"
        >
          {mode === 'register' && (
            <StyledInput
              label="Your Name"
              type="text"
              required
              maxLength={80}
              autoComplete="name"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder="e.g. Kevin Lee"
            />
          )}
          <StyledInput
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <StyledInput
            label="Password"
            type="password"
            required
            minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              mode === 'login'
                ? 'Enter password'
                : `At least ${MIN_PASSWORD_LENGTH} characters`
            }
          />

          {mode === 'login' && (
            <div className="flex justify-end -mt-1">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
          )}

          {(error || authError) && (
            <p className="text-xs text-amber-700 font-medium">{error || authError}</p>
          )}
          {notice && (
            <p className="text-xs text-emerald-700 font-medium">{notice}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            {mode === 'login' ? (
              <LogIn className="w-4 h-4" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            <span>
              {busy
                ? 'Please wait…'
                : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
            </span>
          </button>
          {mode === 'register' && (
            <p className="text-[11px] text-slate-500 text-center">
              We&apos;ll email you a link to verify your address before you can
              start.
            </p>
          )}
        </form>
      </div>
    </AuthCard>
  );
};

interface VerifyEmailScreenProps {
  email: string;
  onVerified: () => void;
  onSignOut: () => void;
}

export const VerifyEmailScreen: React.FC<VerifyEmailScreenProps> = ({
  email,
  onVerified,
  onSignOut,
}) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCheck = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const refreshed = await refreshCurrentUser();
      if (refreshed?.emailVerified) {
        onVerified();
      } else {
        setMessage('Not verified yet. Open the link in the email, then try again.');
      }
    } catch (err) {
      setMessage(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await resendVerificationEmail();
      setMessage('Verification email sent again.');
    } catch (err) {
      setMessage(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <AuthHeader
        title="Verify your email"
        subtitle={`We sent a verification link to ${email}. Open it, then come back here.`}
      />
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
          <Mail className="w-6 h-6 text-emerald-700" />
        </div>
      </div>
      {message && (
        <p className="text-xs text-center text-slate-700 font-medium">{message}</p>
      )}
      <div className="space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleCheck}
          className="w-full h-11 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl transition-colors cursor-pointer shadow-xs"
        >
          I&apos;ve verified my email
        </button>
        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            disabled={busy}
            onClick={handleResend}
            className="font-semibold text-emerald-700 hover:underline cursor-pointer"
          >
            Resend email
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Use a different account
          </button>
        </div>
      </div>
    </AuthCard>
  );
};

interface ProfileSetupScreenProps {
  accountName: string;
  accountEmail: string;
  unclaimedPlayers: Player[];
  pendingClaimPlayer: Player | null;
  onCreateProfile: (name: string) => Promise<void>;
  onRequestClaim: (playerId: string) => Promise<void>;
  onCancelClaim: () => Promise<void>;
  onSignOut: () => void;
}

/**
 * First sign-in: the account is not linked to a player yet. The player either starts a new
 * profile or asks an admin to link an existing one (e.g. a profile created before accounts).
 */
export const ProfileSetupScreen: React.FC<ProfileSetupScreenProps> = ({
  accountName,
  accountEmail,
  unclaimedPlayers,
  pendingClaimPlayer,
  onCreateProfile,
  onRequestClaim,
  onCancelClaim,
  onSignOut,
}) => {
  const [mode, setMode] = useState<'new' | 'claim'>('new');
  const [name, setName] = useState(accountName);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const matches = q
    ? unclaimedPlayers
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.playerTag.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : [];

  if (pendingClaimPlayer) {
    return (
      <AuthCard>
        <AuthHeader
          title="Waiting for approval"
          subtitle={`You asked to link ${accountEmail} to the profile "${pendingClaimPlayer.name}". A site admin needs to approve it.`}
        />
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onCancelClaim)}
            className="w-full h-10 px-4 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
          >
            Cancel request
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeader
        title="Set up your player profile"
        subtitle={`Signed in as ${accountEmail}`}
      />
      <div className="flex justify-center">
        <SegmentedControl
          options={[
            { value: 'new', label: 'New Profile' },
            { value: 'claim', label: 'I Already Have One' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {mode === 'new' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void run(() => onCreateProfile(name.trim()));
          }}
          className="space-y-3.5"
        >
          <StyledInput
            label="Player Name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="How other players will see you"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl cursor-pointer shadow-xs"
          >
            Create My Profile
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-600">
            Find the profile a club organiser created for you. A site admin will
            confirm it&apos;s you before linking it to this account.
          </p>
          <StyledInput
            label="Search by name or tag"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Kevin or kevin#204"
          />
          <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl">
            {matches.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">
                {q ? 'No unlinked profile matches.' : 'Start typing to search.'}
              </p>
            ) : (
              matches.map((p) => (
                <div
                  key={p.id}
                  className="px-3 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {p.name}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">
                      {p.playerTag}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onRequestClaim(p.id))}
                    className="h-8 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    This is me
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onSignOut}
        className="w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
      >
        Sign out
      </button>
    </AuthCard>
  );
};

interface ClubJoinPromptModalProps {
  club: Club;
  player: Player;
  hasPendingRequest?: boolean;
  onAcceptJoinClub: (clubId: string) => Promise<void>;
  onCancelRequest?: (clubId: string) => void;
  onDismiss: () => void;
}

export const ClubJoinPromptModal: React.FC<ClubJoinPromptModalProps> = ({
  club,
  player,
  hasPendingRequest = false,
  onAcceptJoinClub,
  onCancelRequest,
  onDismiss,
}) => {
  const [joining, setJoining] = useState(false);
  const isPrivate = club.visibility === 'private';

  const handleJoin = async () => {
    setJoining(true);
    try {
      await onAcceptJoinClub(club.id);
    } finally {
      setJoining(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-club-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-xl p-6 space-y-5"
      >
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-emerald-700">
                Club Invitation
              </p>
              {isPrivate ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  <Lock className="w-3 h-3" />
                  Private
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Globe className="w-3 h-3" />
                  Public
                </span>
              )}
            </div>
            <h2
              id="join-club-title"
              className="text-lg font-bold text-slate-900 mt-0.5 font-display"
            >
              {club.name}
            </h2>
            <p className="text-xs text-slate-500 mt-1">{club.description}</p>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1 text-xs text-slate-600 font-mono tabular-nums">
          <p className="font-sans font-semibold text-slate-900 mb-1">
            Club Rules
          </p>
          <p>· Free cancel &gt;{club.freeCancelHours}h before match</p>
          <p>
            · Late cancel (&lt;{club.freeCancelHours}h):{' '}
            {club.lateCancelFeePercent}% court share
          </p>
          <p>· Lock cutoff: {club.lockCancelHours}h before match</p>
          <p>· No-show penalty: {club.noShowFeePercent}% court share</p>
        </div>

        {isPrivate && (
          <p className="text-xs text-slate-600">
            {hasPendingRequest
              ? `Your request to join is waiting for ${club.clubOwnerName || 'the club owner'} to approve.`
              : `This is a private club. ${club.clubOwnerName || 'The club owner'} must approve your request before you can see its sessions.`}
          </p>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onDismiss}
            className="h-9 px-3.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Dismiss
          </button>
          {isPrivate && hasPendingRequest ? (
            <button
              type="button"
              onClick={() => onCancelRequest?.(club.id)}
              className="h-9 px-4 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Cancel Request</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={joining}
              onClick={handleJoin}
              className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              {isPrivate ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>
                {isPrivate ? 'Request to Join' : `Join as ${player.name}`}
              </span>
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
