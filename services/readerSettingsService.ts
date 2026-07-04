/**
 * Reader Settings Service — persistence for Mobile View reader preferences
 * (font size, line spacing, theme). Deliberately separate from the global
 * settingsService so viewer-only preferences never touch the app settings
 * surface (Settings screen, theme provider, etc.).
 */
import type {
  ReaderSettings,
  ReaderTheme,
} from "@/src/types/document-viewer.types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@inscribed/reader_settings";

const VALID_THEMES: ReaderTheme[] = ["light", "sepia", "dark"];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Defaults match the values both viewers hard-coded before reader settings
 * existed, so users who never open the settings sheet see no change.
 * Theme follows the app color scheme until the user picks one explicitly.
 */
export function getDefaultReaderSettings(
  colorScheme: "light" | "dark",
): ReaderSettings {
  return {
    fontSize: 17,
    lineHeight: 1.6,
    theme: colorScheme === "dark" ? "dark" : "light",
    fontFamily: "system-ui",
  };
}

/** Returns the user's saved settings, or null if they never customized. */
export async function getSavedReaderSettings(): Promise<ReaderSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    // Clamp to the ranges ReaderControls offers so a corrupt or stale entry
    // can never produce an unreadable page.
    return {
      fontSize: clamp(Number(parsed.fontSize) || 17, 12, 32),
      lineHeight: clamp(Number(parsed.lineHeight) || 1.6, 1.2, 2.4),
      theme: VALID_THEMES.includes(parsed.theme) ? parsed.theme : "light",
      fontFamily:
        typeof parsed.fontFamily === "string" && parsed.fontFamily
          ? parsed.fontFamily
          : "system-ui",
    };
  } catch {
    return null;
  }
}

export async function saveReaderSettings(
  settings: ReaderSettings,
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non-critical — settings just won't persist across sessions.
  }
}
