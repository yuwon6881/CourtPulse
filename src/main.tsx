import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { purgeDevLeftoversOutsideDev } from './utils/localData';
import { initializeTheme } from './utils/theme';

// Production never uses the demo state or the dev persona; drop any leftovers from older builds.
purgeDevLeftoversOutsideDev(Boolean(import.meta.env.DEV));
// Ensure the persisted theme is applied synchronously before first React paint.
initializeTheme();

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message:
        err instanceof Error ? err.message : 'An unexpected error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4 text-center">
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              Something went wrong
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              Reload CourtPulse
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
