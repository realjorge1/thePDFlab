/**
 * Keep Awake Service — persistence for the "Keep Screen Awake" reader
 * preference (the screen never sleeps while a document is open).
 *
 * Kept separate from the global settingsService for the same reason
 * readerSettingsService is: this is a viewer-only preference and should
 * never appear on the app settings surface.
 *
 * The preference is global rather than per-file, matching how other readers
 * expose it — turn it on once and every document you open honours it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@inscribed/keep_screen_awake";

/**
 * Returns the saved preference. Defaults to `false` — the screen sleeping on
 * its usual schedule is what the OS does, and holding a wake lock the user
 * never asked for drains their battery.
 */
export async function getKeepAwakeEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === "true";
  } catch {
    return false;
  }
}

/** Persists the preference. Never throws — a failed write only loses the setting. */
export async function saveKeepAwakeEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage unavailable — the toggle still works for this session.
  }
}
