import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellRing,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  UserCheck,
  UserMinus,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Club, Player, Session, SessionRsvp } from '../types';
import {
  AppNotificationItem,
  ClubActivityNotificationEvent,
  evaluateClubAndSessionNotifications,
  NotificationCategory,
  RsvpSnapshotEntry,
} from '../utils/notificationLogic';

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

// Activity events older than 5 minutes are discarded to prevent backlog replays when notifications are enabled
const MAX_ACTIVITY_EVENT_AGE_MS = 5 * 60 * 1000;
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

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
  canManageClubById: (clubId: string) => boolean;
  onOpenSessionDetail: (sessionId: string, openPayInfo?: boolean) => void;
}

export const BrowserNotificationManager: React.FC<BrowserNotificationManagerProps> = ({
  dataReady,
  activePlayer,
  clubs,
  sessions,
  rsvps,
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
    right: number;
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
    setBellAnchorRect({
      top: Math.max(8, Math.round(rect.bottom + 8)),
      right: Math.max(12, Math.round(window.innerWidth - rect.right)),
    });
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

      newItems.forEach((item, idx) => {
        if (keys.has(item.dedupKey)) return;
        keys.add(item.dedupKey);
        const fullItem: AppNotificationItem = {
          ...item,
          id: `notif_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          createdAtMs: Date.now() + idx,
          read: false,
        };
        createdNow.push(fullItem);
      });

      if (createdNow.length === 0) return;

      saveNotifiedKeys(activePlayer.id, keys);

      const latestFeed = loadStoredFeed(activePlayer.id);
      const next = [...createdNow, ...latestFeed].slice(0, 40);
      saveStoredFeed(activePlayer.id, next);
      setFeed(next);

      setActiveToasts((prev) => [...createdNow, ...prev].slice(0, 4));

      createdNow.forEach((n) => {
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
    setFeed(loadStoredFeed(activePlayer.id));

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
    onOpenSessionDetail(item.sessionId, item.openPaymentOnClick);
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
                  style={{
                    top: bellAnchorRect ? `${bellAnchorRect.top}px` : '56px',
                    right: bellAnchorRect ? `${bellAnchorRect.right}px` : '16px',
                  }}
                  className="fixed z-[85] w-[min(calc(100vw-1.5rem),24rem)] max-h-[calc(100dvh-5rem)] flex flex-col bg-white border border-slate-200/95 rounded-2xl shadow-xl shadow-slate-900/10 overflow-hidden ring-1 ring-slate-900/5"
                >
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/70 shrink-0">
                    <div className="flex items-center gap-2">
                      <Bell className="w-3.5 h-3.5 text-emerald-700" />
                      <span className="text-xs font-bold text-slate-900">
                        Notifications
                      </span>
                      {isAllowed && unreadCount > 0 && (
                        <span className="text-[11px] font-mono font-semibold text-emerald-700">
                          ({unreadCount} new)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isAllowed && unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setBellMenuOpen(false)}
                        aria-label="Close notifications panel"
                        className="w-6 h-6 rounded-lg hover:bg-slate-200/70 flex items-center justify-center text-slate-500 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {!isAllowed ? (
                    <div className="p-5 text-center space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
                        <BellRing className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-900">
                          Browser notifications are not enabled yet
                        </p>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
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
                    <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
                      {feed.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 space-y-1">
                          <p className="font-semibold text-slate-700">
                            No notifications yet
                          </p>
                          <p className="text-[11px]">
                            Alerts for unjoined club sessions, finalized fee splits, and player RSVP/payment updates appear here.
                          </p>
                        </div>
                      ) : (
                        feed.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleNotificationAction(item)}
                            className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3 cursor-pointer ${
                              !item.read ? 'bg-emerald-50/30' : 'bg-white'
                            }`}
                          >
                            <div className="mt-0.5">
                              {renderCategoryIcon(item.category)}
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-900 truncate">
                                  {item.title}
                                </span>
                                {!item.read && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed break-words">
                                {item.body}
                              </p>
                              <span className="text-[11px] font-semibold text-emerald-700 inline-block pt-0.5">
                                Open Session →
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
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
                className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
                role="dialog"
                aria-modal="true"
                aria-labelledby="browser-notif-request-title"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.12, ease: 'easeIn' } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                  className="my-auto bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                        <BellRing className="w-5 h-5" />
                      </div>
                      <div>
                        <h2
                          id="browser-notif-request-title"
                          className="text-base font-bold text-slate-900 font-display"
                        >
                          Enable Browser Notifications?
                        </h2>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Stay updated on your club sessions and fee splits
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDismissPrompt}
                      aria-label="Close notification prompt"
                      className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-2.5 bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs text-slate-700">
                    <div className="flex items-start gap-2.5">
                      <Calendar className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-slate-900">
                          New Unjoined Club Sessions
                        </p>
                        <p className="text-slate-600 mt-0.5">
                          Get alerted whenever a club you joined schedules a new session that you haven&apos;t joined yet.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 pt-2 border-t border-slate-200/70">
                      <CreditCard className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-slate-900">
                          Finalized Session Fees
                        </p>
                        <p className="text-slate-600 mt-0.5">
                          Get notified as soon as a session you joined has its court and shuttle fees calculated and finalized.
                        </p>
                      </div>
                    </div>

                    {ownsAnyClub && (
                      <div className="flex items-start gap-2.5 pt-2 border-t border-slate-200/70">
                        <UserCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-slate-900">
                            Club Owner Activity Alerts
                          </p>
                          <p className="text-slate-600 mt-0.5">
                            Receive instant notifications with the player&apos;s name whenever someone joins, leaves, or presses the Paid button.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleDismissPrompt}
                      className="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                    >
                      Later
                    </button>
                    <button
                      type="button"
                      onClick={handleRequestBrowserPermission}
                      className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
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
              className="fixed top-16 right-3 sm:right-6 z-[90] w-[min(calc(100vw-1.5rem),24rem)] space-y-2 pointer-events-none"
            >
              <AnimatePresence>
                {activeToasts.map((toast) => (
                  <motion.div
                    key={toast.id}
                    initial={{ opacity: 0, x: 24, scale: 0.96 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 24, scale: 0.96 }}
                    transition={{ duration: 0.18 }}
                    onMouseEnter={() => pauseToastAutoDismiss(toast.id)}
                    onMouseLeave={() => scheduleToastAutoDismiss(toast.id)}
                    className="pointer-events-auto bg-white border border-slate-200/95 rounded-2xl p-3.5 shadow-xl shadow-slate-900/10 flex items-start gap-3 ring-1 ring-slate-900/5"
                  >
                    <div className="mt-0.5">{renderCategoryIcon(toast.category)}</div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-xs font-bold text-slate-900 leading-snug">
                        {toast.title}
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed break-words">
                        {toast.body}
                      </p>
                      <div className="pt-1 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleNotificationAction(toast)}
                          className="text-xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                        >
                          {toast.openPaymentOnClick
                            ? 'View & Pay Share →'
                            : 'View Session →'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDismissToast(toast.id)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDismissToast(toast.id)}
                      aria-label="Dismiss notification"
                      className="w-6 h-6 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
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
              ? 'bg-amber-50/90 hover:bg-amber-100 border-amber-300 text-amber-900'
              : bellMenuOpen
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-950'
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
            <BellRing className="w-4 h-4 text-amber-700 animate-pulse" />
          )}
          {isAllowed && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold flex items-center justify-center shadow-2xs">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          {!isAllowed && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
          )}
        </button>
      </div>
      {portaledOverlays}
    </>
  );
};
