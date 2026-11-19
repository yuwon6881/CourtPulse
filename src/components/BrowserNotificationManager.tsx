import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellRing,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  Ticket,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  motion,
  PanInfo,
  useMotionValue,
  useTransform,
} from 'motion/react';
import { Club, Player, PlayerBenefitWallet, Session, SessionRsvp } from '../types';
import {
  AppNotificationItem,
  ClubActivityNotificationEvent,
  evaluateClubAndSessionNotifications,
  formatRelativeTime,
  NotificationCategory,
  pruneNotificationFeed,
  RsvpSnapshotEntry,
} from '../utils/notificationLogic';
import { anchorPanelBelow } from '../utils/popoverPosition';

/** 24rem: the widest the notifications panel gets (it shrinks on a phone). */
const BELL_PANEL_MAX_WIDTH_PX = 384;

export type {
  AppNotificationItem,
  ClubActivityNotificationEvent,
  NotificationCategory,
};

import {
  ACTIVITY_EVENTS_STORAGE_KEY,
  ALLOWED_STORAGE_PREFIX,
  NOTIFIED_KEYS_STORAGE_PREFIX,
  NOTIF_FEED_STORAGE_PREFIX,
  RSVP_SNAPSHOT_STORAGE_PREFIX,
  PROMPT_SNOOZE_STORAGE_PREFIX,
} from '../utils/localData';

export {
  ACTIVITY_EVENTS_STORAGE_KEY,
  ALLOWED_STORAGE_PREFIX,
  NOTIFIED_KEYS_STORAGE_PREFIX,
  NOTIF_FEED_STORAGE_PREFIX,
  RSVP_SNAPSHOT_STORAGE_PREFIX,
  PROMPT_SNOOZE_STORAGE_PREFIX,
};

// Auto-dismiss pop-up notification toasts after 4 seconds
const TOAST_AUTO_DISMISS_MS = 4000;
const SWIPE_DISMISS_OFFSET_PX = 72;
const SWIPE_DISMISS_VELOCITY_PX = 350;

// Activity events older than 5 minutes are discarded to prevent backlog replays when notifications are enabled
const MAX_ACTIVITY_EVENT_AGE_MS = 5 * 60 * 1000;
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface SwipeableNotificationRowProps {
  item: AppNotificationItem;
  icon: React.ReactNode;
  onAction: (item: AppNotificationItem) => void;
  onDismiss: (id: string) => void;
}

const SwipeableNotificationRow: React.FC<SwipeableNotificationRowProps> = ({
  item,
  icon,
  onAction,
  onDismiss,
}) => {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-160, 0, 160], [0.25, 1, 0.25]);
  const didDragRef = useRef(false);

  const handleDragStart = () => {
    didDragRef.current = true;
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (
      Math.abs(info.offset.x) > SWIPE_DISMISS_OFFSET_PX ||
      Math.abs(info.velocity.x) > SWIPE_DISMISS_VELOCITY_PX
    ) {
      onDismiss(item.id);
      return;
    }
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 80);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, overflow: 'hidden', transition: { duration: 0.16 } }}
      className="relative overflow-hidden bg-slate-100/90 dark:bg-slate-800"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-between px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 pointer-events-none select-none"
      >
        <span>Dismiss</span>
        <span>Dismiss</span>
      </div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.45}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ x, opacity, touchAction: 'pan-y' }}
        className={`relative group ${
          !item.read
            ? 'bg-emerald-50/40 dark:bg-emerald-950/35'
            : 'bg-white dark:bg-slate-900'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (didDragRef.current) return;
            onAction(item);
          }}
          className="w-full text-left pl-4 pr-11 py-3 hover:bg-slate-50/90 dark:hover:bg-slate-800/70 transition-colors flex items-start gap-3 cursor-pointer"
        >
          <div className="mt-0.5">{icon}</div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {item.title}
              </span>
              {!item.read && (
                <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words">
              {item.body}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5 pt-0.5">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">Open Session →</span>
              <span aria-hidden="true">·</span>
              <span>{formatRelativeTime(item.createdAtMs)}</span>
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(item.id);
          }}
          aria-label={`Dismiss notification: ${item.title}`}
          title="Dismiss"
          className="absolute top-2 right-2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    </motion.div>
  );
};

interface SwipeableToastCardProps {
  toast: AppNotificationItem;
  icon: React.ReactNode;
  onAction: (item: AppNotificationItem) => void;
  onDismiss: (id: string) => void;
  onPauseTimer: (id: string) => void;
  onResumeTimer: (id: string) => void;
}

const SwipeableToastCard: React.FC<SwipeableToastCardProps> = ({
  toast,
  icon,
  onAction,
  onDismiss,
  onPauseTimer,
  onResumeTimer,
}) => {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-160, 0, 160], [0.25, 1, 0.25]);
  const didDragRef = useRef(false);

  const handleDragStart = () => {
    didDragRef.current = true;
    onPauseTimer(toast.id);
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (
      Math.abs(info.offset.x) > SWIPE_DISMISS_OFFSET_PX ||
      Math.abs(info.velocity.x) > SWIPE_DISMISS_VELOCITY_PX
    ) {
      onDismiss(toast.id);
      return;
    }
    onResumeTimer(toast.id);
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 80);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.95, transition: { duration: 0.16 } }}
      transition={{ duration: 0.18 }}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => onPauseTimer(toast.id)}
      onMouseLeave={() => onResumeTimer(toast.id)}
      style={{ x, opacity, touchAction: 'pan-y' }}
      className="pointer-events-auto bg-white dark:bg-slate-900 border border-slate-200/95 dark:border-slate-700/80 rounded-2xl p-3.5 shadow-xl shadow-slate-900/10 dark:shadow-black/50 flex items-start gap-3 ring-1 ring-slate-900/5 dark:ring-white/5 select-none"
    >
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-bold text-slate-900 dark:text-white leading-snug break-words">
          {toast.title}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words">
          {toast.body}
        </p>
        <div className="pt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (didDragRef.current) return;
              onAction(toast);
            }}
            className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline cursor-pointer min-h-[28px] inline-flex items-center"
          >
            {toast.openPaymentOnClick ? 'View & Pay Share →' : 'View Session →'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (didDragRef.current) return;
              onDismiss(toast.id);
            }}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer min-h-[28px] inline-flex items-center"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="w-8 h-8 -mr-1 -mt-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
};

function isPromptSnoozed(playerId: string): boolean {
  try {
    const raw = localStorage.getItem(`${PROMPT_SNOOZE_STORAGE_PREFIX}${playerId}`);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snoozePrompt(playerId: string): void {
  try {
    localStorage.setItem(
      `${PROMPT_SNOOZE_STORAGE_PREFIX}${playerId}`,
      String(Date.now() + PROMPT_SNOOZE_MS)
    );
  } catch {
    // ignore
  }
}

export function emitClubActivityNotificationEvent(
  event: Omit<ClubActivityNotificationEvent, 'id' | 'createdAtMs'>
): void {
  try {
    const raw = localStorage.getItem(ACTIVITY_EVENTS_STORAGE_KEY);
    const list: ClubActivityNotificationEvent[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - MAX_ACTIVITY_EVENT_AGE_MS;
    const nextEvent: ClubActivityNotificationEvent = {
      ...event,
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAtMs: Date.now(),
    };
    const updated = [
      ...list.filter(
        (e) => e && typeof e.createdAtMs === 'number' && e.createdAtMs >= cutoff
      ),
      nextEvent,
    ].slice(-100);
    localStorage.setItem(ACTIVITY_EVENTS_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('courtpulse-club-activity'));
  } catch {
    // ignore storage errors
  }
}

function loadActivityEvents(): ClubActivityNotificationEvent[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_ACTIVITY_EVENT_AGE_MS;
    const fresh = parsed.filter(
      (ev) => ev && typeof ev.createdAtMs === 'number' && ev.createdAtMs >= cutoff
    );
    if (fresh.length !== parsed.length) {
      try {
        localStorage.setItem(ACTIVITY_EVENTS_STORAGE_KEY, JSON.stringify(fresh));
      } catch {
        // ignore
      }
    }
    return fresh;
  } catch {
    return [];
  }
}

function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function hasUserAllowedNotifications(playerId: string): boolean {
  try {
    return localStorage.getItem(`${ALLOWED_STORAGE_PREFIX}${playerId}`) === 'true';
  } catch {
    return false;
  }
}

function saveUserAllowedNotifications(playerId: string, allowed: boolean): void {
  try {
    if (allowed) {
      localStorage.setItem(`${ALLOWED_STORAGE_PREFIX}${playerId}`, 'true');
    } else {
      localStorage.removeItem(`${ALLOWED_STORAGE_PREFIX}${playerId}`);
    }
  } catch {
    // ignore
  }
}

function clearDisallowedPlayerNotificationStorage(playerId: string): void {
  try {
    localStorage.removeItem(`${NOTIFIED_KEYS_STORAGE_PREFIX}${playerId}`);
    localStorage.removeItem(`${NOTIF_FEED_STORAGE_PREFIX}${playerId}`);
    localStorage.removeItem(`${RSVP_SNAPSHOT_STORAGE_PREFIX}${playerId}`);
    // Also clean up any legacy v1 keys so old unallowed notifications never appear
    localStorage.removeItem(`courtpulse_notified_keys_v1_${playerId}`);
    localStorage.removeItem(`courtpulse_notif_feed_v1_${playerId}`);
    localStorage.removeItem(`courtpulse_rsvp_snapshot_v1_${playerId}`);
  } catch {
    // ignore
  }
}

function loadNotifiedKeys(playerId: string): Set<string> {
  if (!hasUserAllowedNotifications(playerId)) return new Set();
  try {
    const raw = localStorage.getItem(`${NOTIFIED_KEYS_STORAGE_PREFIX}${playerId}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveNotifiedKeys(playerId: string, keys: Set<string>): void {
  if (!hasUserAllowedNotifications(playerId)) return;
  try {
    const arr = Array.from(keys).slice(-400);
    localStorage.setItem(
      `${NOTIFIED_KEYS_STORAGE_PREFIX}${playerId}`,
      JSON.stringify(arr)
    );
  } catch {
    // ignore
  }
}

function loadStoredFeed(playerId: string): AppNotificationItem[] {
  if (!hasUserAllowedNotifications(playerId)) return [];
  try {
    const raw = localStorage.getItem(`${NOTIF_FEED_STORAGE_PREFIX}${playerId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveStoredFeed(playerId: string, items: AppNotificationItem[]): void {
  if (!hasUserAllowedNotifications(playerId)) return;
  try {
    localStorage.setItem(
      `${NOTIF_FEED_STORAGE_PREFIX}${playerId}`,
      JSON.stringify(items.slice(0, 40))
    );
  } catch {
    // ignore
  }
}

function loadRsvpSnapshot(playerId: string): Record<string, RsvpSnapshotEntry> | null {
  if (!hasUserAllowedNotifications(playerId)) return null;
  try {
    const raw = localStorage.getItem(`${RSVP_SNAPSHOT_STORAGE_PREFIX}${playerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveRsvpSnapshot(
  playerId: string,
  snapshot: Record<string, RsvpSnapshotEntry>
): void {
  if (!hasUserAllowedNotifications(playerId)) return;
  try {
    localStorage.setItem(
      `${RSVP_SNAPSHOT_STORAGE_PREFIX}${playerId}`,
      JSON.stringify(snapshot)
    );
  } catch {
    // ignore
  }
}

function fireBrowserSystemNotification(title: string, body: string, tag: string): void {
  if (!isBrowserNotificationSupported()) return;
  try {
    if (Notification.permission === 'granted') {
      const nativeNotif = new Notification(title, {
        body,
        tag,
        icon: '/icon-192.png',
      });
      setTimeout(() => {
        try {
          nativeNotif.close();
        } catch {
          // ignore
        }
      }, TOAST_AUTO_DISMISS_MS);
    }
  } catch {
    // Fallback handled by in-app toast banner
  }
}

interface BrowserNotificationManagerProps {
  // False until sessions and rsvps have been confirmed by the server for this account.
  dataReady: boolean;
  activePlayer: Player;
  clubs: Club[];
  sessions: Session[];
  rsvps: SessionRsvp[];
  /** The signed-in player's club wallets, and whether the server has answered for them. */
  wallets?: Record<string, PlayerBenefitWallet>;
  walletsReady?: boolean;
  canManageClubById: (clubId: string) => boolean;
  onOpenSessionDetail: (sessionId: string, openPayInfo?: boolean) => void;
}

export const BrowserNotificationManager: React.FC<BrowserNotificationManagerProps> = ({
  dataReady,
  activePlayer,
  clubs,
  sessions,
  rsvps,
  wallets,
  walletsReady = false,
  canManageClubById,
  onOpenSessionDetail,
}) => {
  const [allowedVersion, setAllowedVersion] = useState<number>(0);

  // Synchronously derived for the current activePlayer so switching accounts NEVER leaks
  // the previous player's allowed state for even a single render cycle.
  const isAllowed = useMemo(
    () => hasUserAllowedNotifications(activePlayer.id),
    [activePlayer.id, allowedVersion]
  );

  const [dismissedPromptForPlayerId, setDismissedPromptForPlayerId] = useState<
    string | null
  >(null);
  const [manualPromptOpen, setManualPromptOpen] = useState<boolean>(false);
  const [bellMenuOpen, setBellMenuOpen] = useState<boolean>(false);
  const [bellAnchorRect, setBellAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [feed, setFeed] = useState<AppNotificationItem[]>(() =>
    loadStoredFeed(activePlayer.id)
  );
  const [activeToasts, setActiveToasts] = useState<AppNotificationItem[]>([]);
  const [activityTick, setActivityTick] = useState<number>(0);

  const bellButtonRef = useRef<HTMLButtonElement | null>(null);
  const notifiedKeysRef = useRef<Set<string>>(loadNotifiedKeys(activePlayer.id));
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const canManageClubByIdRef = useRef(canManageClubById);
  canManageClubByIdRef.current = canManageClubById;

  // Clear all active toast timers on unmount
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Sync player-scoped state when switching accounts/personas or permission state
  useEffect(() => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
    setActiveToasts([]);
    setBellMenuOpen(false);

    if (!hasUserAllowedNotifications(activePlayer.id)) {
      clearDisallowedPlayerNotificationStorage(activePlayer.id);
      notifiedKeysRef.current = new Set();
      setFeed([]);
      return;
    }

    notifiedKeysRef.current = loadNotifiedKeys(activePlayer.id);
    setFeed(loadStoredFeed(activePlayer.id));
  }, [activePlayer.id, isAllowed]);

  // Listen for custom activity events emitted in the same tab or storage changes across tabs
  useEffect(() => {
    const handleCustomEvent = () => setActivityTick((t) => t + 1);
    const handleStorage = (e: StorageEvent) => {
      if (
        !e.key ||
        e.key === ACTIVITY_EVENTS_STORAGE_KEY ||
        e.key.startsWith(NOTIFIED_KEYS_STORAGE_PREFIX) ||
        e.key.startsWith(NOTIF_FEED_STORAGE_PREFIX) ||
        e.key.startsWith(RSVP_SNAPSHOT_STORAGE_PREFIX)
      ) {
        setActivityTick((t) => t + 1);
      }
    };
    window.addEventListener('courtpulse-club-activity', handleCustomEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('courtpulse-club-activity', handleCustomEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const showPermissionPopup =
    manualPromptOpen ||
    (!isAllowed &&
      dismissedPromptForPlayerId !== activePlayer.id &&
      !isPromptSnoozed(activePlayer.id));

  // Close bell dropdown on Escape key (the Enable Browser Notifications modal only closes when explicitly dismissed by the user)
  useEffect(() => {
    if (!bellMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBellMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [bellMenuOpen]);

  // Keep bell dropdown anchored to the bell button on window resize/scroll
  const updateBellAnchor = useCallback(() => {
    if (!bellButtonRef.current || typeof window === 'undefined') return;
    const rect = bellButtonRef.current.getBoundingClientRect();
    // Clamped on both sides: a right-edge anchor alone put the panel off the left of a phone.
    setBellAnchorRect(
      anchorPanelBelow(rect, window.innerWidth, BELL_PANEL_MAX_WIDTH_PX)
    );
  }, []);

  useEffect(() => {
    if (!bellMenuOpen) return;
    updateBellAnchor();
    window.addEventListener('resize', updateBellAnchor);
    window.addEventListener('scroll', updateBellAnchor, true);
    return () => {
      window.removeEventListener('resize', updateBellAnchor);
      window.removeEventListener('scroll', updateBellAnchor, true);
    };
  }, [bellMenuOpen, updateBellAnchor]);

  const ownsAnyClub = useMemo(
    () =>
      clubs.some(
        (c) =>
          c.clubOwnerPlayerId === activePlayer.id || canManageClubById(c.id)
      ),
    [clubs, activePlayer.id, canManageClubById]
  );

  const handleRequestBrowserPermission = () => {
    // Enable in-app notifications and close the prompt immediately. The native browser
    // permission request can stay pending forever (Chrome's quiet permission UI, installed
    // PWAs, iframes), so it must never gate the UI update.
    saveUserAllowedNotifications(activePlayer.id, true);
    setAllowedVersion((v) => v + 1);
    setManualPromptOpen(false);
    setBellMenuOpen(false);
    setDismissedPromptForPlayerId(activePlayer.id);

    if (
      isBrowserNotificationSupported() &&
      Notification.permission === 'default' &&
      typeof Notification.requestPermission === 'function'
    ) {
      try {
        // Callback form is required by older Safari; modern browsers also return a promise.
        const pending = Notification.requestPermission(() => {});
        if (pending && typeof pending.catch === 'function') {
          pending.catch(() => {});
        }
      } catch {
        // Ignore browser iframe restriction errors
      }
    }
  };

  const handleDismissPrompt = () => {
    snoozePrompt(activePlayer.id);
    setManualPromptOpen(false);
    setDismissedPromptForPlayerId(activePlayer.id);
  };

  const scheduleToastAutoDismiss = useCallback((toastId: string) => {
    const existing = toastTimersRef.current.get(toastId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      toastTimersRef.current.delete(toastId);
      setActiveToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, TOAST_AUTO_DISMISS_MS);
    toastTimersRef.current.set(toastId, timer);
  }, []);

  const pauseToastAutoDismiss = useCallback((toastId: string) => {
    const existing = toastTimersRef.current.get(toastId);
    if (existing) {
      clearTimeout(existing);
      toastTimersRef.current.delete(toastId);
    }
  }, []);

  const pushNotifications = useCallback(
    (newItems: Omit<AppNotificationItem, 'id' | 'createdAtMs' | 'read'>[]) => {
      // Strictly guard: never push or display notifications if the user has not allowed them yet
      if (!hasUserAllowedNotifications(activePlayer.id)) return;
      if (newItems.length === 0) return;

      // Reload latest keys from localStorage so other tabs' writes are not clobbered
      const keys = loadNotifiedKeys(activePlayer.id);
      notifiedKeysRef.current = keys;

      const createdNow: AppNotificationItem[] = [];
      const nowStamp = Date.now();

      newItems.forEach((item, idx) => {
        if (keys.has(item.dedupKey)) return;
        keys.add(item.dedupKey);
        const fullItem: AppNotificationItem = {
          ...item,
          id: `notif_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          // Real event time when known (never in the future); detection time otherwise
          createdAtMs: item.occurredAtMs ? Math.min(item.occurredAtMs, nowStamp) : nowStamp + idx,
          read: false,
        };
        createdNow.push(fullItem);
      });

      if (createdNow.length === 0) return;
      // Alerts arriving together are built oldest-first; the bell and toasts show newest first
      const chronological = [...createdNow];
      createdNow.reverse();

      saveNotifiedKeys(activePlayer.id, keys);

      const latestFeed = loadStoredFeed(activePlayer.id);
      const next = [...createdNow, ...latestFeed]
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 40);
      saveStoredFeed(activePlayer.id, next);
      setFeed(next);

      setActiveToasts((prev) => [...createdNow, ...prev].slice(0, 4));

      chronological.forEach((n) => {
        scheduleToastAutoDismiss(n.id);
        fireBrowserSystemNotification(n.title, n.body, n.dedupKey);
      });
    },
    [activePlayer.id, scheduleToastAutoDismiss]
  );

  // Core Notification Detection Effect — ONLY runs when the current user has allowed notifications
  useEffect(() => {
    if (!dataReady || !isAllowed || !hasUserAllowedNotifications(activePlayer.id)) {
      return;
    }

    // Refresh in-memory notified keys and feed from localStorage to reflect updates from other tabs
    notifiedKeysRef.current = loadNotifiedKeys(activePlayer.id);
    // Drop stale alerts (old, or about sessions that are gone) before showing the stored feed
    const storedFeed = loadStoredFeed(activePlayer.id);
    const tidyFeed = pruneNotificationFeed(storedFeed, {
      sessions,
      rsvps,
      clubs,
      activePlayerId: activePlayer.id,
    });
    if (tidyFeed !== storedFeed) saveStoredFeed(activePlayer.id, tidyFeed);
    setFeed(tidyFeed);

    const prevSnapshot = loadRsvpSnapshot(activePlayer.id);
    const activityEvents = loadActivityEvents();

    const evaluated = evaluateClubAndSessionNotifications({
      activePlayer,
      clubs,
      sessions,
      rsvps,
      activityEvents,
      prevSnapshot,
      notifiedKeys: notifiedKeysRef.current,
      canManageClubById: (clubId) => canManageClubByIdRef.current(clubId),
      wallets,
      walletsReady,
    });

    notifiedKeysRef.current = evaluated.notifiedKeys;
    if (evaluated.keysMutated) {
      saveNotifiedKeys(activePlayer.id, evaluated.notifiedKeys);
    }

    saveRsvpSnapshot(activePlayer.id, evaluated.nextSnapshot);

    if (evaluated.pendingToQueue.length > 0) {
      pushNotifications(evaluated.pendingToQueue);
    }
  }, [
    dataReady,
    isAllowed,
    activePlayer,
    clubs,
    sessions,
    rsvps,
    wallets,
    walletsReady,
    ownsAnyClub,
    activityTick,
    pushNotifications,
  ]);

  const unreadCount = useMemo(
    () => (isAllowed ? feed.filter((item) => !item.read).length : 0),
    [feed, isAllowed]
  );

  const handleMarkAllRead = () => {
    setFeed((prev) => {
      const next = prev.map((item) => ({ ...item, read: true }));
      saveStoredFeed(activePlayer.id, next);
      return next;
    });
  };

  const handleDismissItem = (id: string) => {
    pauseToastAutoDismiss(id);
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
    setFeed((prev) => {
      const next = prev.filter((item) => item.id !== id);
      saveStoredFeed(activePlayer.id, next);
      return next;
    });
  };

  const handleClearAll = () => {
    toastTimersRef.current.forEach((timer) => clearTimeout(timer));
    toastTimersRef.current.clear();
    setActiveToasts([]);
    setFeed([]);
    saveStoredFeed(activePlayer.id, []);
  };

  const handleDismissToast = (id: string) => {
    pauseToastAutoDismiss(id);
    setActiveToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleNotificationAction = (item: AppNotificationItem) => {
    pauseToastAutoDismiss(item.id);
    setFeed((prev) => {
      const next = prev.map((n) =>
        n.id === item.id ? { ...n, read: true } : n
      );
      saveStoredFeed(activePlayer.id, next);
      return next;
    });
    setActiveToasts((prev) => prev.filter((t) => t.id !== item.id));
    setBellMenuOpen(false);
    // Alerts about a club wallet (a received pass) are not about one session: nothing to open.
    if (item.sessionId) onOpenSessionDetail(item.sessionId, item.openPaymentOnClick);
  };

  const renderCategoryIcon = (category: NotificationCategory) => {
    switch (category) {
      case 'new_unjoined_session':
        return <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'fees_finalized':
        return <CreditCard className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'owner_player_joined':
        return <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'owner_player_left':
        return <UserMinus className="w-4 h-4 text-rose-600 shrink-0" />;
      case 'owner_player_paid':
        return <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />;
      case 'owner_guest_changed':
        return <Users className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'owner_session_full':
        return <Users className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'member_payment_update':
        return <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />;
      case 'member_session_update':
        return <Calendar className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'member_share_adjusted':
        return <CreditCard className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'member_removed_from_session':
        return <UserMinus className="w-4 h-4 text-rose-600 shrink-0" />;
      case 'member_pass_received':
        return <Ticket className="w-4 h-4 text-emerald-600 shrink-0" />;
    }
  };

  // Render portaled overlays directly into document.body so parent <header> backdrop-blur
  // never creates a clipped fixed-position containing block.
  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  const portaledOverlays = portalTarget
    ? createPortal(
        <>
          {/* 1. Bell Notifications Dropdown Panel */}
          <AnimatePresence>
            {bellMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-[80]"
                  onClick={() => setBellMenuOpen(false)}
                  aria-hidden="true"
                />
                <motion.div
                  role="dialog"
                  aria-label="Notifications panel"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  style={
                    bellAnchorRect
                      ? {
                          top: `${bellAnchorRect.top}px`,
                          left: `${bellAnchorRect.left}px`,
                          width: `${bellAnchorRect.width}px`,
                        }
                      : { top: '56px', right: '12px' }
                  }
                  className="fixed z-[85] w-[min(calc(100vw-1.5rem),24rem)] max-h-[calc(100dvh-5rem)] flex flex-col bg-white dark:bg-slate-900 border border-slate-200/95 dark:border-slate-800 rounded-2xl shadow-xl shadow-slate-900/10 dark:shadow-black/50 overflow-hidden ring-1 ring-slate-900/5 dark:ring-white/5"
                >
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-950/60 shrink-0">
                    <div className="flex items-center gap-2">
                      <Bell className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Notifications
                      </span>
                      {isAllowed && unreadCount > 0 && (
                        <span className="text-[11px] font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                          ({unreadCount} new)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isAllowed && unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline cursor-pointer"
                        >
                          Mark all read
                        </button>
                      )}
                      {isAllowed && feed.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearAll}
                          className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 hover:underline cursor-pointer"
                        >
                          Clear all
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setBellMenuOpen(false)}
                        aria-label="Close notifications panel"
                        className="w-7 h-7 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {!isAllowed ? (
                    <div className="p-5 text-center space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto">
                        <BellRing className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                          Browser notifications are not enabled yet
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          Allow notifications to receive alerts for new unjoined club sessions, finalized session fee splits, and club owner activity.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          handleRequestBrowserPermission();
                        }}
                        className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Allow Notifications</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      {feed.length > 0 && (
                        <div className="px-4 py-1.5 bg-slate-50/50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500 shrink-0 sm:hidden">
                          Swipe an alert left or right to dismiss
                        </div>
                      )}
                      <div className="overflow-y-auto overflow-x-hidden divide-y divide-slate-100 dark:divide-slate-800 flex-1 overscroll-contain">
                        {feed.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
                            <p className="font-semibold text-slate-700 dark:text-slate-200">
                              No notifications yet
                            </p>
                            <p className="text-[11px]">
                              Alerts for unjoined club sessions, finalized fee splits, and player RSVP/payment updates appear here.
                            </p>
                          </div>
                        ) : (
                          <AnimatePresence initial={false}>
                            {feed.map((item) => (
                              <SwipeableNotificationRow
                                key={item.id}
                                item={item}
                                icon={renderCategoryIcon(item.category)}
                                onAction={handleNotificationAction}
                                onDismiss={handleDismissItem}
                              />
                            ))}
                          </AnimatePresence>
                        )}
                      </div>
                    </>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* 2. WEB BROWSER NOTIFICATION REQUEST POPUP MODAL
              Portaled to document.body so it is always centered in the viewport */}
          <AnimatePresence>
            {showPermissionPopup && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-[100] bg-slate-900/50 dark:bg-slate-950/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="browser-notif-request-title"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 16, transition: { duration: 0.12, ease: 'easeIn' } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full max-h-[90dvh] flex flex-col overflow-hidden"
                >
                  <div className="sm:hidden pt-2.5 flex justify-center shrink-0">
                    <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
                  </div>
                  <div className="shrink-0 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                        <BellRing className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h2
                          id="browser-notif-request-title"
                          className="text-base font-bold text-slate-900 dark:text-white font-display leading-snug"
                        >
                          Enable Browser Notifications?
                        </h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                          Stay updated on your club sessions and fee splits
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDismissPrompt}
                      aria-label="Close notification prompt"
                      className="w-8 h-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
                    <div className="space-y-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-3.5 text-xs text-slate-700 dark:text-slate-300">
                      <div className="flex items-start gap-2.5">
                        <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            New Unjoined Club Sessions
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                            Get alerted whenever a club you joined schedules a new session that you haven&apos;t joined yet.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-700/70">
                        <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            Finalized Session Fees
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                            Get notified as soon as a session you joined has its court and shuttle fees calculated and finalized.
                          </p>
                        </div>
                      </div>

                      {ownsAnyClub && (
                        <div className="flex items-start gap-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-700/70">
                          <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">
                              Club Owner Activity Alerts
                            </p>
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                              Receive instant notifications with the player&apos;s name whenever someone joins, leaves, or presses the Paid button.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 px-4 sm:px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleDismissPrompt}
                      className="w-full sm:w-auto h-10 sm:h-9 px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      Later
                    </button>
                    <button
                      type="button"
                      onClick={handleRequestBrowserPermission}
                      className="w-full sm:w-auto h-10 sm:h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Allow Notifications</span>
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 3. LIVE BROWSER / IN-APP NOTIFICATION TOAST STACK (Top-Right of Viewport)
              Strictly rendered ONLY when the user has allowed notifications */}
          {isAllowed && (
            <div
              aria-live="polite"
              className="fixed top-14 sm:top-16 inset-x-3 sm:left-auto sm:right-6 z-[90] sm:w-96 space-y-2 pointer-events-none"
            >
              <AnimatePresence>
                {activeToasts.map((toast) => (
                  <SwipeableToastCard
                    key={toast.id}
                    toast={toast}
                    icon={renderCategoryIcon(toast.category)}
                    onAction={handleNotificationAction}
                    onDismiss={handleDismissToast}
                    onPauseTimer={pauseToastAutoDismiss}
                    onResumeTimer={scheduleToastAutoDismiss}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>,
        portalTarget
      )
    : null;

  return (
    <>
      <div className="relative">
        <button
          ref={bellButtonRef}
          type="button"
          onClick={() => {
            updateBellAnchor();
            setBellMenuOpen((prev) => !prev);
          }}
          className={`relative h-9 w-9 rounded-xl border inline-flex items-center justify-center transition-all cursor-pointer shadow-2xs ${
            !isAllowed
              ? 'bg-amber-50/90 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-950 border-amber-300 dark:border-amber-800/80 text-amber-900 dark:text-amber-300'
              : bellMenuOpen
              ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-500'
              : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
          }`}
          aria-label="Notifications"
          aria-expanded={bellMenuOpen}
          title={
            !isAllowed
              ? 'Browser notifications not enabled yet — click to enable'
              : unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
              : 'Notifications'
          }
        >
          {isAllowed ? (
            <Bell className="w-4 h-4" />
          ) : (
            <BellRing className="w-4 h-4 text-amber-700 dark:text-amber-400 animate-pulse" />
          )}
          {isAllowed && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold flex items-center justify-center shadow-2xs">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          {!isAllowed && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900" />
          )}
        </button>
      </div>
      {portaledOverlays}
    </>
  );
};
