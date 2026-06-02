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
  | "read_aloud_end_of_file";

interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType;
}

const ANDROID_CHANNEL_ID = "wordsinscribed-tasks";

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
