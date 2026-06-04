/**
 * Notification Service
 * Delivers REAL device notifications (status-bar / notification-drawer) for
 * processing, downloads, AI tasks, and Read Aloud — via expo-notifications.
 *
 * These are true OS notifications, never on-screen Alert dialogs. If the OS
 * notification permission is unavailable we silently no-op rather than fall
 * back to an intrusive center-screen alert.
 */
import { loadSettings } from "@/services/settingsService";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | "processing_complete"
  | "download_complete"
  | "ai_complete"
  | "read_aloud_playing"
  | "read_aloud_stopped"
  | "read_aloud_end_of_file"
  | "task_reminder";

interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType;
}

const ANDROID_CHANNEL_ID = "wordsinscribed-tasks";

/**
 * Stable notification identifiers per type. Posting a notification with an
 * identifier that is already showing causes the OS to REPLACE the existing one
 * (same Android tag/iOS identifier) instead of stacking a new entry. This stops
 * notifications from piling up — the latest of each kind overwrites the last.
 * All Read Aloud states share one id so the playback status updates in place.
 * `task_reminder` is intentionally absent: scheduled reminders must each be
 * distinct so multiple can coexist and be individually cancelled.
 */
const NOTIFICATION_IDS: Partial<Record<NotificationType, string>> = {
  processing_complete: "wordsinscribed.processing",
  download_complete: "wordsinscribed.download",
  ai_complete: "wordsinscribed.ai",
  read_aloud_playing: "wordsinscribed.read_aloud",
  read_aloud_stopped: "wordsinscribed.read_aloud",
  read_aloud_end_of_file: "wordsinscribed.read_aloud",
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let _initialized = false;
let _permissionGranted = false;
let _handlerSet = false;

/** Configure how notifications behave while the app is in the foreground. */
function ensureHandler() {
  if (_handlerSet) return;
  _handlerSet = true;
  Notifications.setNotificationHandler({
    // Show the notification in the tray/banner even when the app is foregrounded.
    handleNotification: async () => ({
      // `shouldShowAlert` is the legacy field; `shouldShowBanner`/`shouldShowList`
      // are the current ones. Setting all keeps every SDK version happy.
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Initialise notifications: request OS permission and create the Android
 * channel. Safe to call repeatedly — work happens only once. Call at app
 * startup and whenever the user enables a notification toggle.
 */
export async function initNotifications(): Promise<boolean> {
  ensureHandler();

  // Android requires an explicit channel for notifications to post.
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "Task & Reading Notifications",
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 100],
        lightColor: "#6366F1",
      });
    } catch (e) {
      if (__DEV__) console.warn("[Notifications] Channel setup failed:", e);
    }
  }

  if (_initialized) return _permissionGranted;
  _initialized = true;

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    _permissionGranted = status === "granted";
    if (!_permissionGranted && __DEV__) {
      console.warn("[Notifications] Permission not granted");
    }
  } catch (e) {
    if (__DEV__) console.warn("[Notifications] Init failed:", e);
    _permissionGranted = false;
  }

  return _permissionGranted;
}

// ─── Send Notification ────────────────────────────────────────────────────────

async function sendLocalNotification(payload: NotificationPayload) {
  // Make sure permission + channel are ready (covers the case where a task
  // fires before initNotifications() ran, e.g. a fast background download).
  if (!_initialized) {
    await initNotifications();
  } else {
    ensureHandler();
  }
  if (!_permissionGranted) return; // no permission → stay silent, never alert

  try {
    await Notifications.scheduleNotificationAsync({
      // Reuse a stable id per type so a new notification replaces the previous
      // one of the same kind rather than stacking a separate entry.
      identifier: NOTIFICATION_IDS[payload.type],
      content: {
        title: payload.title,
        body: payload.body,
        data: { type: payload.type },
      },
      // `null` trigger = deliver immediately. On Android the channel must be
      // supplied via the trigger object.
      trigger:
        Platform.OS === "android"
          ? ({ channelId: ANDROID_CHANNEL_ID } as Notifications.NotificationTriggerInput)
          : null,
    });
  } catch (e) {
    if (__DEV__) console.warn("[Notifications] Failed to post:", e);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// ─── Scheduled task reminders ───────────────────────────────────────────────

/**
 * Schedule a REAL device notification to fire at `when` for a workspace task.
 * Requests notification permission on first use. Returns the OS notification
 * identifier (so it can later be cancelled), or `null` if permission was
 * denied or scheduling failed. The reminder survives app restarts because the
 * OS owns the scheduled notification.
 */
export async function scheduleTaskReminder(
  taskText: string,
  when: Date,
): Promise<string | null> {
  const granted = await initNotifications();
  if (!granted) return null;

  // Guard against scheduling in the past (would fire immediately or be dropped).
  if (when.getTime() <= Date.now() + 1000) return null;

  try {
    const trigger: Notifications.NotificationTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    } as Notifications.NotificationTriggerInput;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Task reminder",
        body: taskText.trim() || "You have a task to do.",
        data: { type: "task_reminder" },
        sound: true,
      },
      trigger,
    });
    return id;
  } catch (e) {
    if (__DEV__) console.warn("[Notifications] Failed to schedule reminder:", e);
    return null;
  }
}

/** Cancel a previously scheduled notification by its identifier. Safe to call
 * with an id that no longer exists. */
export async function cancelScheduledNotification(id: string): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (e) {
    if (__DEV__) console.warn("[Notifications] Failed to cancel reminder:", e);
  }
}

/**
 * Notify user that a file processing task completed.
 * Respects `notifyProcessingComplete` setting.
 */
export async function notifyProcessingComplete(
  fileName: string,
): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyProcessingComplete) return;

  await sendLocalNotification({
    title: "Processing Complete",
    body: `"${fileName}" has been processed successfully.`,
    type: "processing_complete",
  });
}

/**
 * Notify user that a download completed.
 * Respects `notifyDownloadsComplete` setting.
 */
export async function notifyDownloadComplete(fileName: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyDownloadsComplete) return;

  await sendLocalNotification({
    title: "Download Complete",
    body: `"${fileName}" has been downloaded successfully.`,
    type: "download_complete",
  });
}

/**
 * Notify user that an AI task completed.
 * Respects `notifyAIComplete` setting.
 */
export async function notifyAIComplete(taskName: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyAIComplete) return;

  await sendLocalNotification({
    title: "AI Task Complete",
    body: `${taskName} has finished.`,
    type: "ai_complete",
  });
}

/**
 * Notify user that Read Aloud has started playing.
 * Respects `notifyReadAloudPlaying` setting.
 */
export async function notifyReadAloudPlaying(fileName: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyReadAloudPlaying) return;

  await sendLocalNotification({
    title: "Read Aloud Playing",
    body: `Now reading: "${fileName}"`,
    type: "read_aloud_playing",
  });
}

/**
 * Notify user that Read Aloud has been stopped.
 * Respects `notifyReadAloudStopped` setting.
 */
export async function notifyReadAloudStopped(fileName: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyReadAloudStopped) return;

  await sendLocalNotification({
    title: "Read Aloud Stopped",
    body: `Stopped reading: "${fileName}"`,
    type: "read_aloud_stopped",
  });
}

/**
 * Notify user that Read Aloud has reached the end of the file.
 * Respects `notifyReadAloudEndOfFile` setting.
 */
export async function notifyReadAloudEndOfFile(fileName: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.notifyReadAloudEndOfFile) return;

  await sendLocalNotification({
    title: "Read Aloud Finished",
    body: `Finished reading: "${fileName}"`,
    type: "read_aloud_end_of_file",
  });
}
