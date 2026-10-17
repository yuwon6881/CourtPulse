import React, { useState } from 'react';
import { CheckCircle2, LogIn, UserPlus, Users } from 'lucide-react';
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
    <div className="min-h-screen bg-[#f8fafc] flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-1">
          <p className="text-base font-bold tracking-tight text-slate-900 font-display">
            CourtPulse
          </p>
          <h1 className="text-xl font-bold text-slate-900">
            {invitedClub ? `Join ${invitedClub.name}` : 'Badminton Club Portal'}
          </h1>
          <p className="text-xs text-slate-500">
            {invitedClub
              ? 'Sign in or create an account to accept your invite.'
              : 'Access court sessions, standings, and fee splits.'}
          </p>
        </div>

        <div className="flex justify-center">
          <SegmentedControl
            options={[
              { value: 'login', label: 'Sign In' },
              { value: 'register', label: 'Register' },
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
              className="w-full h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Continue with Google</span>
            </button>

            <div className="relative flex py-1 items-center">
              <div className="grow border-t border-slate-100"></div>
              <span className="shrink mx-3 text-[11px] text-slate-400">
                or credentials
              </span>
              <div className="grow border-t border-slate-100"></div>
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
                <p className="text-xs text-amber-700">{loginError}</p>
              )}

              <button
                type="submit"
                className="w-full h-10 px-4 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Sign In
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

            {regError && <p className="text-xs text-amber-700">{regError}</p>}

            <button
              type="submit"
              className="w-full h-10 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </form>
        )}

        {authError && (
          <p className="text-xs text-amber-700 text-center">{authError}</p>
        )}
      </div>
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
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-club-title"
    >
      <div className="bg-white w-full max-w-md rounded-2xl border border-slate-200 shadow-lg p-6 space-y-5">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-emerald-700">
              Club Invitation
            </p>
            <h2
              id="join-club-title"
              className="text-lg font-bold text-slate-900 mt-0.5"
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
            className="h-9 px-3.5 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Dismiss
          </button>
          <button
            type="button"
            disabled={joining}
            onClick={handleJoin}
            className="h-9 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Join as {player.name}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
