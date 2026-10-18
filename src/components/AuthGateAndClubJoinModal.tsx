import React, { useState } from 'react';
import { CheckCircle2, LogIn, Sparkles, UserPlus, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { Club, Player } from '../types';
import { SegmentedControl, StyledInput } from './ui/FormControls';

interface AuthGateScreenProps {
  invitedClub: Club | null;
  onSignInWithGoogle: () => Promise<void>;
  onSignInWithCredentials: (
    name: string,
    password: string
  ) => { ok: boolean; error?: string };
  onRegisterNewAccount: (name: string, password: string) => Promise<void>;
  authError: string | null;
}

const QUICK_DEMO_ACCOUNTS = [
  { name: 'Alex Tan', role: 'Admin & Owner' },
  { name: 'Kevin Lee', role: 'Member' },
  { name: 'Rachel Lim', role: 'Member' },
];

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  invitedClub,
  onSignInWithGoogle,
  onSignInWithCredentials,
  onRegisterNewAccount,
  authError,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  const [loginName, setLoginName] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [regName, setRegName] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regError, setRegError] = useState<string | null>(null);

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const trimmedName = loginName.trim();
    if (!trimmedName || !loginPassword) {
      setLoginError('Enter your name and password.');
      return;
    }
    const res = onSignInWithCredentials(trimmedName, loginPassword);
    if (!res.ok && res.error) {
      setLoginError(res.error);
    }
  };

  const handleQuickDemoSignIn = (demoName: string) => {
    setLoginError(null);
    setLoginName(demoName);
    setLoginPassword('badminton');
    const res = onSignInWithCredentials(demoName, 'badminton');
    if (!res.ok && res.error) {
      setLoginError(res.error);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    const trimmedName = regName.trim();
    if (!trimmedName || !regPassword) {
      setRegError('Enter a name and password.');
      return;
    }
    await onRegisterNewAccount(trimmedName, regPassword);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-6"
      >
        <div className="text-center space-y-1.5">
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-emerald-500 to-emerald-700 text-white font-display font-bold text-base flex items-center justify-center mx-auto mb-2 shadow-sm shadow-emerald-700/30 ring-1 ring-inset ring-white/20">
            CP
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            CourtPulse Badminton
          </p>
          <h1 className="text-2xl font-bold text-slate-900 font-display">
            {invitedClub ? `Join ${invitedClub.name}` : 'Badminton Club Portal'}
          </h1>
          <p className="text-xs text-slate-500">
            {invitedClub
              ? 'Sign in or create an account to accept your club invitation.'
              : 'Organize court sessions, 1-tap RSVPs, match standings, and fee splits.'}
          </p>
        </div>

        <div className="flex justify-center">
          <SegmentedControl
            options={[
              { value: 'login', label: 'Sign In' },
              { value: 'register', label: 'Create Account' },
            ]}
            value={mode}
            onChange={(val) => {
              setMode(val);
              setLoginError(null);
              setRegError(null);
            }}
          />
        </div>

        {mode === 'login' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={onSignInWithGoogle}
              className="w-full h-11 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <LogIn className="w-4 h-4" />
              <span>Continue with Google</span>
            </button>

            {/* 1-Tap Quick Demo Roster Sign-In */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>Quick Demo Sign-In (1-Tap)</span>
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {QUICK_DEMO_ACCOUNTS.map((acct) => (
                  <button
                    key={acct.name}
                    type="button"
                    onClick={() => handleQuickDemoSignIn(acct.name)}
                    className="p-2.5 rounded-lg bg-white hover:bg-emerald-50 border border-slate-200/90 hover:border-emerald-300 text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-bold text-slate-900 block">
                      {acct.name}
                    </span>
                    <span className="text-[11px] text-slate-600 font-medium block">
                      {acct.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex py-1 items-center">
              <div className="grow border-t border-slate-200"></div>
              <span className="shrink mx-3 text-[11px] font-medium text-slate-500">
                or credentials
              </span>
              <div className="grow border-t border-slate-200"></div>
            </div>

            <form onSubmit={handleCredentialsSubmit} className="space-y-3.5">
              <StyledInput
                label="Player Name"
                type="text"
                required
                autoComplete="username"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="e.g. Alex Tan or Kevin Lee"
              />

              <StyledInput
                label="Password"
                type="password"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter password"
              />

              {loginError && (
                <p className="text-xs text-amber-700 font-medium">{loginError}</p>
              )}

              <button
                type="submit"
                className="w-full h-10 px-4 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl transition-colors cursor-pointer"
              >
                Sign In with Credentials
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            <StyledInput
              label="Player Name"
              type="text"
              required
              maxLength={80}
              autoComplete="username"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder="Enter your full name"
            />

            <StyledInput
              label="Password"
              type="password"
              required
              minLength={3}
              maxLength={80}
              autoComplete="new-password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              placeholder="Create a password"
            />

            {regError && (
              <p className="text-xs text-amber-700 font-medium">{regError}</p>
            )}

            <button
              type="submit"
              className="w-full h-11 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <UserPlus className="w-4 h-4" />
              <span>Create Player Account</span>
            </button>
          </form>
        )}

        {authError && (
          <p className="text-xs text-amber-700 text-center font-medium">
            {authError}
          </p>
        )}
      </motion.div>
    </div>
  );
};

interface ClubJoinPromptModalProps {
  club: Club;
  player: Player;
  onAcceptJoinClub: (clubId: string) => Promise<void>;
  onDismiss: () => void;
}

export const ClubJoinPromptModal: React.FC<ClubJoinPromptModalProps> = ({
  club,
  player,
  onAcceptJoinClub,
  onDismiss,
}) => {
  const [joining, setJoining] = useState(false);

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
            <p className="text-xs font-semibold text-emerald-700">
              Club Invitation
            </p>
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

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onDismiss}
            className="h-9 px-3.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Dismiss
          </button>
          <button
            type="button"
            disabled={joining}
            onClick={handleJoin}
            className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Join as {player.name}</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
