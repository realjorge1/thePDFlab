/**
 * useKeepScreenAwake — holds a screen wake lock for as long as the viewer
 * that mounts this hook stays open, when the user has turned the preference
 * on from the viewer's overflow menu.
 *
 * The preference is persisted globally (see keepAwakeService), so it carries
 * over to the next document; the wake lock itself is scoped to the mounted
 * viewer and is always released on unmount, so leaving the document lets the
 * screen sleep normally again.
 */
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  isAvailableAsync,
} from "expo-keep-awake";
import { useCallback, useEffect, useState } from "react";

import {
  getKeepAwakeEnabled,
  saveKeepAwakeEnabled,
} from "@/services/keepAwakeService";

/**
 * Shared across every viewer. A single tag means two viewers can never leave
 * a lock behind for each other: whichever one unmounts last releases it, and
 * re-activating an already-held tag is a no-op.
 */
const KEEP_AWAKE_TAG = "inscribed-document-viewer";

export interface KeepScreenAwakeState {
  /** Whether the wake lock is currently requested. */
  enabled: boolean;
  /**
   * False only where the platform cannot keep the screen awake at all
   * (browsers without the Wake Lock API). Always true on iOS and Android.
   */
  supported: boolean;
  /** Flips the preference and persists it. */
  toggle: () => void;
}

export function useKeepScreenAwake(): KeepScreenAwakeState {
  const [enabled, setEnabled] = useState(false);
  // Assume supported so the menu item does not flicker in on native, where
  // the answer is always yes; only an explicit "no" takes it away.
  const [supported, setSupported] = useState(true);

  // Load the saved preference, and find out whether the platform can honour it.
  useEffect(() => {
    let live = true;
    void getKeepAwakeEnabled().then((saved) => {
      if (live && saved) setEnabled(true);
    });
    void isAvailableAsync()
      .then((available) => {
        if (live && !available) setSupported(false);
      })
      .catch(() => {
        // Treat an unanswerable check as supported — activating is harmless
        // if it turns out not to be, and hiding a working toggle is worse.
      });
    return () => {
      live = false;
    };
  }, []);

  // Hold the lock while enabled; the cleanup covers both switching it off and
  // navigating away from the document.
  useEffect(() => {
    if (!enabled || !supported) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [enabled, supported]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      void saveKeepAwakeEnabled(next);
      return next;
    });
  }, []);

  return { enabled, supported, toggle };
}
