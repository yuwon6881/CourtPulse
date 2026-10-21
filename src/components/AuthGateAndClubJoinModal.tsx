import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Globe,
  Lock,
  LogIn,
  Mail,
  MapPin,
  ShieldCheck,
  Terminal,
  UserPlus,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Club, PermissionTier, Player, Session, SessionRsvp } from '../types';
import {
  formatClubCurrency,
  getRsvpGuestCount,
  getSessionDateDisplay,
  getSessionGoingHeadcount,
} from '../utils/badmintonLogic';
import {
  describeAuthError,
  refreshCurrentUser,
  registerWithEmailPassword,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithEmailPassword,
} from '../firebase';
import {
  FormAlertBanner,
  SegmentedControl,
  StyledInput,
} from './ui/FormControls';

export interface DevLoginPersona {
  playerId: string;
  name: string;
  email: string;
  role: PermissionTier;
  subtitle: string;
}

export const DEV_LOGIN_PERSONAS: DevLoginPersona[] = [
  {
    playerId: 'player_alex',
    name: 'Alex Tan',
    email: 'alex.tan@courtpulse.dev',
    role: 'admin',
    subtitle: 'Site Admin & Club Owner',
  },
  {
    playerId: 'player_sarah',
    name: 'Sarah Lin',
    email: 'sarah.lin@courtpulse.dev',
    role: 'club_owner',
    subtitle: 'Club Owner (Jurong West)',
  },
  {
    playerId: 'player_kevin',
    name: 'Kevin Lee',
    email: 'kevin.lee@courtpulse.dev',
    role: 'user',
    subtitle: 'Club Member',
  },
];

interface AuthGateScreenProps {
  invitedClub: Club | null;
  invitedSession?: Session | null;
  initialMode?: 'login' | 'register';
  onBackToSessionPreview?: () => void;
  onSignInWithGoogle: () => Promise<void>;
  onDevLogin?: (persona: DevLoginPersona) => void;
  authError: string | null;
}

interface SharedSessionPreviewScreenProps {
  session: Session;
  club: Club | null;
  sessionRsvps: SessionRsvp[];
  onJoinSession: () => void;
  onSignIn: () => void;
}

export const SharedSessionPreviewScreen: React.FC<
  SharedSessionPreviewScreenProps
> = ({ session, club, sessionRsvps, onJoinSession, onSignIn }) => {
  const dateDisplay = getSessionDateDisplay(session.sessionDate);
  const goingRsvps = sessionRsvps.filter((r) => r.status === 'going');
  const goingHeadcount = getSessionGoingHeadcount(sessionRsvps);
  const spotsOpen = Math.max(0, session.maxPlayers - goingHeadcount);
  const isProposed = session.bookingStatus === 'pending';
  const isCompleted = session.bookingStatus === 'completed';
  const isPrivateClub = club?.visibility === 'private';

  return (
    <div className="min-h-screen flex flex-col text-slate-900 pb-12">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 py-3 shadow-2xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap">
              CourtPulse
            </span>
            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full whitespace-nowrap">
              Session Invite
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSignIn}
              className="h-9 px-3.5 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <LogIn className="w-3.5 h-3.5 text-slate-600" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={onJoinSession}
              className="h-9 px-3.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 sm:p-6 space-y-5"
        >
          {/* Club & Booking Status Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-900 inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{club?.name || 'Badminton Club'}</span>
              </span>
              {club && (
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
                    isPrivateClub
                      ? 'text-amber-800 bg-amber-50 border-amber-200'
                      : 'text-emerald-800 bg-emerald-50 border-emerald-200'
                  }`}
                >
                  {isPrivateClub ? (
                    <>
                      <Lock className="w-3 h-3" />
                      <span>Private Club</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3 h-3" />
                      <span>Public Club</span>
                    </>
                  )}
                </span>
              )}
            </div>

            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                isCompleted
                  ? 'text-slate-700'
                  : isProposed
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isCompleted
                    ? 'bg-slate-500'
                    : isProposed
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
              />
              <span>
                {isCompleted
                  ? 'Completed Session'
                  : isProposed
                  ? 'Proposed (Court Not Booked)'
                  : 'Upcoming Session · Courts Booked'}
              </span>
            </span>
          </div>

          {/* Session Title & Organizer */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
                {session.title}
              </h1>
              <p className="text-xs text-slate-500">
                Organized by{' '}
                <span className="font-semibold text-slate-700">
                  {session.organizerName}
                </span>
                {club?.description ? ` · ${club.description}` : ''}
              </p>
            </div>

            {!isCompleted && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onJoinSession}
                  className="w-full sm:w-auto h-11 px-5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors inline-flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Join Session</span>
                </button>
              </div>
            )}
          </div>

          {/* Key Session Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Date &amp; Time</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                {dateDisplay.fullLabel}
              </p>
              <p className="text-xs font-mono tabular-nums font-semibold text-slate-700">
                {session.startTime} – {session.endTime}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Venue &amp; Courts</span>
              </div>
              <p className="text-xs font-bold text-slate-900 break-words">
                {session.venue}
              </p>
              <p className="text-xs font-medium text-slate-600">
                {isProposed
                  ? 'Court TBD (based on sign-ups)'
                  : session.courtNumbers || 'Court 1'}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Court &amp; Shuttle Fee</span>
              </div>
              <p className="text-xs font-mono tabular-nums font-bold text-slate-900">
                {formatClubCurrency(session.courtFee, club)} court fee
              </p>
              <p className="text-[11px] text-slate-500">
                + shuttles split after session ends
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <Users className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Player Spots</span>
              </div>
              <p className="text-xs font-mono tabular-nums font-bold text-slate-900">
                {goingHeadcount} / {session.maxPlayers} going
              </p>
              <p className="text-[11px] font-medium text-emerald-700">
                {spotsOpen > 0
                  ? `${spotsOpen} ${spotsOpen === 1 ? 'spot' : 'spots'} open`
                  : isProposed
                  ? 'Open for headcount polling'
                  : 'Session currently full'}
              </p>
            </div>
          </div>

          {/* Confirmed Roster & Club Policy */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="p-4 rounded-xl bg-slate-50/60 border border-slate-200/80 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Going Roster ({goingHeadcount}/{session.maxPlayers})
                </h2>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                  {spotsOpen} left
                </span>
              </div>
              {goingRsvps.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  No players listed yet — tap Join Session to be the first on the
                  roster.
                </p>
              ) : (
                <div className="divide-y divide-slate-200/60">
                  {goingRsvps.map((r, index) => {
                    const guests = getRsvpGuestCount(r);
                    return (
                      <div
                        key={r.id}
                        className="py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold text-slate-800 truncate">
                          <span className="font-mono text-slate-400 mr-1.5">
                            {index + 1}.
                          </span>
                          {r.playerName}
                        </span>
                        {guests > 0 && (
                          <span className="text-[11px] font-mono font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md shrink-0">
                            +{guests} {guests === 1 ? 'Guest' : 'Guests'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-slate-50/60 border border-slate-200/80 space-y-2">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Club Cancellation &amp; Tap-Out Policy
                </h2>
              </div>
              <div className="space-y-1 text-xs text-slate-600 font-mono tabular-nums">
                <p>
                  · Free cancel &gt;{club?.freeCancelHours ?? 24}h before match
                </p>
                <p>
                  · Late cancel (&lt;{club?.freeCancelHours ?? 24}h):{' '}
                  {club?.lateCancelFeePercent ?? 50}% court share
                </p>
                <p>· Lock cutoff: {club?.lockCancelHours ?? 4}h before match</p>
                <p>
                  · No-show penalty: {club?.noShowFeePercent ?? 100}% court share
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Join Call-to-Action Banner */}
          <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-900">
                Want to join this session?
              </p>
              <p className="text-xs text-slate-600">
                Create an account or sign in to reserve your court spot and
                manage your RSVP.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onSignIn}
                className="flex-1 sm:flex-initial h-10 px-4 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={onJoinSession}
                className="flex-1 sm:flex-initial h-10 px-5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Join Session</span>
              </button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAuthProviderNotEnabledError(err: unknown): boolean {
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/configuration-not-found' ||
    code === 'auth/unauthorized-domain' ||
    code === 'auth/api-key-not-valid'
  );
}

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  invitedClub,
  invitedSession,
  initialMode = 'login',
  onBackToSessionPreview,
  onSignInWithGoogle,
  onDevLogin,
  authError,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regName, setRegName] = useState('');

  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const isDevEnvironment = Boolean(import.meta.env.DEV);

  const clearFieldErrors = () => {
    setNameError('');
    setEmailError('');
    setPasswordError('');
  };

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

  const validateEmailField = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return 'Enter your email address.';
    if (!EMAIL_REGEX.test(trimmed)) {
      return 'Enter a valid email address (e.g. you@example.com).';
    }
    return '';
  };

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const eErr = validateEmailField(email);
    const pErr = !password ? 'Enter your password.' : '';
    setEmailError(eErr);
    setPasswordError(pErr);
    if (eErr || pErr) return;

    void run(() => signInWithEmailPassword(email, password));
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedName = regName.trim();
    const nErr = !trimmedName
      ? 'Enter your full name.'
      : trimmedName.length < 2
      ? 'Name must be at least 2 characters.'
      : '';
    const eErr = validateEmailField(email);
    const pErr = !password
      ? 'Create a password.'
      : password.length < MIN_PASSWORD_LENGTH
      ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      : '';

    setNameError(nErr);
    setEmailError(eErr);
    setPasswordError(pErr);
    if (nErr || eErr || pErr) return;

    void run(() => registerWithEmailPassword(regName, email, password));
  };

  const handleForgotPassword = () => {
    setError(null);
    setNotice(null);
    const eErr = validateEmailField(email);
    if (eErr) {
      setEmailError('Enter your email above to receive a password reset link.');
      return;
    }
    void run(async () => {
      await sendPasswordReset(email);
      setNotice(
        `If an account exists for ${email.trim()}, a reset link is on its way.`
      );
    });
  };

  return (
    <AuthCard>
      {onBackToSessionPreview && (
        <div>
          <button
            type="button"
            onClick={onBackToSessionPreview}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to session details</span>
          </button>
        </div>
      )}
      <AuthHeader
        title={
          invitedSession
            ? `Join ${invitedSession.title}`
            : invitedClub
            ? `Join ${invitedClub.name}`
            : 'Badminton Club Portal'
        }
        subtitle={
          invitedSession
            ? `Create an account or sign in to reserve your spot at ${invitedSession.venue}.`
            : invitedClub
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
            clearFieldErrors();
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
          noValidate
          onSubmit={mode === 'login' ? handleSignIn : handleRegister}
          className="space-y-3.5"
        >
          {mode === 'register' && (
            <StyledInput
              id="auth-name-input"
              label="Your Name"
              type="text"
              maxLength={80}
              autoComplete="name"
              value={regName}
              error={nameError}
              onChange={(e) => {
                setRegName(e.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="e.g. Kevin Lee"
            />
          )}
          <StyledInput
            id="auth-email-input"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError('');
            }}
            placeholder="you@example.com"
          />
          <StyledInput
            id="auth-password-input"
            label="Password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            error={passwordError}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError('');
            }}
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

          <FormAlertBanner
            message={error || authError}
            variant="error"
            onDismiss={() => setError(null)}
          />
          <FormAlertBanner
            message={notice}
            variant="success"
            onDismiss={() => setNotice(null)}
          />

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
          <p className="text-[10px] text-slate-400 text-center leading-snug">
            Your display name, match history, and session RSVPs are visible to
            signed-in club members. You can delete your profile at any time in
            Settings.
          </p>
        </form>

        {isDevEnvironment && onDevLogin && (
          <div className="pt-3 border-t border-slate-200/90 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                <Terminal className="w-3.5 h-3.5 text-emerald-600" />
                <span>Developer Quick Access</span>
              </span>
              <span className="text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                DEV ENV
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              Bypass external auth providers and sign in immediately as a test
              persona:
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {DEV_LOGIN_PERSONAS.map((persona) => (
                <button
                  key={persona.playerId}
                  type="button"
                  onClick={() => onDevLogin(persona)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 hover:border-emerald-500/70 bg-slate-50/70 hover:bg-emerald-50/40 text-left flex items-center justify-between gap-2 transition-all cursor-pointer group"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 group-hover:text-emerald-800 truncate flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{persona.name}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 truncate pl-5">
                      {persona.subtitle}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-700 group-hover:translate-x-0.5 transition-transform shrink-0">
                    Enter →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
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
      <FormAlertBanner
        message={message}
        variant={
          message?.toLowerCase().includes('sent again') ? 'success' : 'warning'
        }
        onDismiss={() => setMessage(null)}
      />
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
  const [nameError, setNameError] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setSubmitError(null);
    try {
      await action();
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not complete profile setup. Please try again.'
      );
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
        .slice(0, 10)
    : unclaimedPlayers.slice(0, 10);

  if (pendingClaimPlayer) {
    return (
      <AuthCard>
        <AuthHeader
          title="Waiting for approval"
          subtitle={`You asked to link ${accountEmail} to the profile "${pendingClaimPlayer.name}". A site admin needs to approve it.`}
        />
        <FormAlertBanner
          message={submitError}
          variant="error"
          onDismiss={() => setSubmitError(null)}
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
          onChange={(val) => {
            setMode(val);
            setNameError('');
            setSubmitError(null);
          }}
        />
      </div>

      <FormAlertBanner
        message={submitError}
        variant="error"
        onDismiss={() => setSubmitError(null)}
      />

      {mode === 'new' ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) {
              setNameError('Enter a display name for your player profile.');
              return;
            }
            if (trimmed.length < 2) {
              setNameError('Player name must be at least 2 characters.');
              return;
            }
            void run(() => onCreateProfile(trimmed));
          }}
          className="space-y-3.5"
        >
          <StyledInput
            id="profile-setup-name"
            label="Player Name"
            type="text"
            maxLength={80}
            value={name}
            error={nameError}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError('');
            }}
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
          <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl max-h-64 overflow-y-auto">
            {matches.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">
                {q
                  ? 'No unlinked profile matches.'
                  : 'No unlinked profiles exist yet. Switch to New Profile to create yours.'}
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
                  Approval Required
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Globe className="w-3 h-3" />
                  Open Join
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
              : `Membership in this club requires approval from ${club.clubOwnerName || 'the club owner'} before you can join and RSVP to sessions.`}
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
                {isPrivate ? 'Request to Join' : 'Join Club'}
              </span>
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
