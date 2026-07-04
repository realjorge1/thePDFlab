/**
 * useReaderSettings — Mobile View reader preferences (font size, line
 * spacing, theme), persisted across sessions via readerSettingsService.
 *
 * Until the user customizes anything, the theme follows the app color
 * scheme; once they apply a setting, their choice wins.
 */
import {
  getDefaultReaderSettings,
  getSavedReaderSettings,
  saveReaderSettings,
} from "@/services/readerSettingsService";
import type { ReaderSettings } from "@/src/types/document-viewer.types";
import { useCallback, useEffect, useRef, useState } from "react";

export function useReaderSettings(colorScheme: "light" | "dark") {
  const [settings, setSettings] = useState<ReaderSettings>(() =>
    getDefaultReaderSettings(colorScheme),
  );
  const hasSavedRef = useRef(false);

  // Load any saved preferences once on mount.
  useEffect(() => {
    let live = true;
    getSavedReaderSettings().then((saved) => {
      if (live && saved) {
        hasSavedRef.current = true;
        setSettings(saved);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Follow the app color scheme until the user picks a theme themselves.
  useEffect(() => {
    if (hasSavedRef.current) return;
    setSettings((prev) => {
      const def = getDefaultReaderSettings(colorScheme);
      return prev.theme === def.theme ? prev : { ...prev, theme: def.theme };
    });
  }, [colorScheme]);

  const updateSettings = useCallback((next: ReaderSettings) => {
    hasSavedRef.current = true;
    setSettings(next);
    saveReaderSettings(next);
  }, []);

  return { settings, updateSettings };
}
