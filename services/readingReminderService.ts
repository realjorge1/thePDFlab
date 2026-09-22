// ============================================
// Reading Reminders (R2.5)
// ---------------------------------------------
// A single, optional, LOCAL nudge to pick a book back up.
//
// OPT-IN, DEFAULT OFF. With settings.readingReminders false nothing is ever
// scheduled. There is no push infrastructure and no backend: these are
// expo-notifications local scheduled notifications, using the existing
// `task_reminder` type and scheduleTaskReminder from notificationService, and
// no permission beyond the POST_NOTIFICATIONS already declared in app.json.
//
// THE HARD LIMITS, all of them deliberate:
//   • at most ONE per day;
//   • never for a finished book (the resume candidate already excludes those
//     via the shared BOOK_DONE threshold);
//   • never for a file that no longer resolves (same);
//   • never within 3 hours of the user actually reading — a reminder to read
//     the thing you just put down is an insult, not a nudge;
//   • cancelled the moment the user opens the file.
//
// If notification permission is absent this no-ops SILENTLY. The underlying
// service already behaves that way; no prompt and no Alert is added here.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";

import { READING_SESSIONS } from "@/constants/featureFlags";
import {
  cancelScheduledNotification,
  scheduleTaskReminder,
} from "@/services/notificationService";
import {
  getResumeCandidate,
  localDayKey,
} from "@/services/readingSessionService";
import { hasAIPremiumAccess } from "@/services/ai/premiumGuard";
import { loadSettings } from "@/services/settingsService";

const STORAGE_KEY = "@wordsinscribed/reading_reminder_v1";

/** At most one reminder per local calendar day. */
const ONE_PER_DAY = true;
/** Never nudge within this long of real reading. */
export const QUIET_AFTER_READING_MS = 3 * 60 * 60 * 1000;
/** How far ahead a reminder is scheduled. */
const SCHEDULE_AHEAD_MS = 20 * 60 * 60 * 1000;

interface ReminderState {
  /** OS notification id of the pending reminder, if any. */
  pendingId: string | null;
  /** Identity key the pending reminder is about. */
  pendingKey: string | null;
  /** Local day (YYYY-MM-DD) a reminder was last scheduled on. */
  lastScheduledDay: string | null;
}

const EMPTY: ReminderState = {
  pendingId: null,
  pendingKey: null,
  lastScheduledDay: null,
};

async function readState(): Promise<ReminderState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<ReminderState>;
    return {
      pendingId: typeof parsed.pendingId === "string" ? parsed.pendingId : null,
      pendingKey: typeof parsed.pendingKey === "string" ? parsed.pendingKey : null,
      lastScheduledDay:
        typeof parsed.lastScheduledDay === "string" ? parsed.lastScheduledDay : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(state: ReminderState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A reminder that cannot be remembered simply isn't scheduled again.
  }
}

/**
 * Cancel any pending reminder. Called when the user opens the file — nudging
 * someone about the book already in their hands is the fastest way to get the
 * whole feature turned off.
 */
export async function cancelReadingReminder(): Promise<void> {
  const state = await readState();
  if (state.pendingId) {
    await cancelScheduledNotification(state.pendingId);
  }
  await writeState({ ...state, pendingId: null, pendingKey: null });
}

/**
 * Cancel a pending reminder only when it is about this specific file.
 * Used from the viewers, so opening book A does not drop a reminder about B.
 */
export async function cancelReminderFor(identityKey: string): Promise<void> {
  if (!identityKey) return;
  const state = await readState();
  if (state.pendingKey && state.pendingKey === identityKey && state.pendingId) {
    await cancelScheduledNotification(state.pendingId);
    await writeState({ ...state, pendingId: null, pendingKey: null });
  }
}

export type ReminderOutcome =
  | "scheduled"
  | "disabled"
  | "already-today"
  | "too-soon"
  | "no-candidate"
  | "no-permission";

/**
 * Schedule at most one reminder for the best resume candidate.
 *
 * Safe to call on app start and after a reading session ends. Never throws.
 */
export async function maybeScheduleReadingReminder(): Promise<ReminderOutcome> {
  if (!READING_SESSIONS) return "disabled";
  // Reading sessions are a premium Gozlin feature. Checked here too, not only
  // in the settings UI, so a lapsed subscription stops the nudges.
  if (!hasAIPremiumAccess()) return "disabled";

  try {
    const settings = await loadSettings();
    if (!settings.readingReminders) return "disabled";

    const state = await readState();
    const today = localDayKey();
    if (ONE_PER_DAY && state.lastScheduledDay === today) return "already-today";

    // getResumeCandidate already excludes finished books (>= BOOK_DONE),
    // sessions under two minutes, and files that no longer resolve.
    const candidate = await getResumeCandidate();
    if (!candidate) return "no-candidate";

    // Never nudge someone who has just been reading.
    if (Date.now() - candidate.lastReadAt < QUIET_AFTER_READING_MS) {
      return "too-soon";
    }

    // Replace any pending reminder rather than stacking a second one.
    if (state.pendingId) await cancelScheduledNotification(state.pendingId);

    const when = new Date(Date.now() + SCHEDULE_AHEAD_MS);
    const title = candidate.fileName.replace(/\.[a-z0-9]+$/i, "");
    const body = candidate.lastPageLabel
      ? `Pick up ${title} again — you left off at ${candidate.lastPageLabel}.`
      : `Pick up ${title} again where you left off.`;

    const id = await scheduleTaskReminder(body, when);
    if (!id) {
      // Permission denied or scheduling failed: stay silent, per R2.5.
      await writeState({ ...state, pendingId: null, pendingKey: null });
      return "no-permission";
    }

    await writeState({
      pendingId: id,
      pendingKey: candidate.identityKey,
      lastScheduledDay: today,
    });
    return "scheduled";
  } catch {
    return "no-candidate";
  }
}

/** Test-only: read the persisted state. */
export async function __getReminderStateForTests(): Promise<ReminderState> {
  return readState();
}
