// ============================================
// useReadingSession — one heartbeat for all four readers
// ---------------------------------------------
// Replaces the four near-identical 20-second BEAT_MS effects in
// app/pdf-viewer.tsx, app/epub-viewer.tsx, app/docx-viewer.tsx and
// app/ppt-viewer.tsx. Behind READING_SESSIONS; with the flag off this hook
// does nothing at all and each viewer keeps its original effect verbatim.
//
// WHAT IT FIXES
//
// 1. THE HONESTY GUARD. The existing heartbeat credits time whenever a viewer
//    is mounted and the app is foregrounded — including a phone lying face-up
//    on a table through lunch. If the app claims "40 minutes" for that, the
//    user stops believing the whole feature, permanently. So a beat is
//    credited only when noteActivity() has fired within ACTIVITY_WINDOW_MS.
//
//    Read Aloud is the deliberate exception: while it is actively speaking,
//    that IS reading, with no touches at all. The viewer passes its existing
//    read-aloud state in — no new global.
//
// 2. THE LOST TAIL. The old interval loses the final partial interval before
//    unmount: leave 19 seconds into a beat and those 19 seconds vanish. A
//    claim of "40 minutes" cannot afford that, so this hook credits elapsed
//    wall time and flushes on blur, unmount, and every AppState change away
//    from active.
//
// BOTH COUNTERS STAY IN SYNC. Every credit also calls bumpReadingTime() with
// the same total, so services/workspaceInsightsService.ts and the WorkSpace
// Progress dashboard read exactly as they do today for the same reading.
// bumpReadingTime's signature and its 5-minute-per-call cap are untouched.
// ============================================

import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";

import { READING_SESSIONS } from "@/constants/featureFlags";
import { getFileIdentity } from "@/services/fileIdentity";
import {
  cancelReminderFor,
  maybeScheduleReadingReminder,
} from "@/services/readingReminderService";
import {
  creditTime,
  endSession,
  noteLocation,
  startSession,
} from "@/services/readingSessionService";
import { bumpReadingTime } from "@/services/workspaceInsightsService";

/**
 * THE ACTIVITY RULE, in one place so it can be tuned without hunting through
 * four viewers: a beat counts only if the reader did something — turned a
 * page, scrolled, touched the screen — within this window.
 */
export const ACTIVITY_WINDOW_MS = 60_000;

/** How often the hook wakes up to credit elapsed time. Matches the old BEAT_MS. */
export const BEAT_MS = 20_000;

/** Never credit more than this in one beat — mirrors bumpReadingTime's cap. */
const MAX_CREDIT_PER_BEAT_MS = 5 * 60 * 1000;

export interface UseReadingSessionOptions {
  uri?: string;
  name?: string;
  /**
   * True while Read Aloud is actively speaking. Speech counts as activity
   * with no touches — pass the viewer's existing read-aloud state, don't add
   * a new global.
   */
  isSpeaking?: boolean;
  /** A label for where the reader is ("Page 12", "Chapter 4"). */
  pageLabel?: string;
  /** Set false to disable entirely (e.g. while a viewer is still loading). */
  enabled?: boolean;
}

export interface UseReadingSessionResult {
  /** Call on page change, scroll and touch. Cheap: a ref write, no re-render. */
  noteActivity: () => void;
}

/**
 * Track a reading session for the open document.
 *
 * Returns `noteActivity`, which the viewer wires to its existing page-change
 * callback, its scroll handler and an onTouchStart on the reader surface.
 */
export function useReadingSession(
  options: UseReadingSessionOptions,
): UseReadingSessionResult {
  const { uri, name, isSpeaking = false, pageLabel, enabled = true } = options;

  const lastActivityRef = useRef<number>(Date.now());
  const lastCreditAtRef = useRef<number>(Date.now());
  const speakingRef = useRef(isSpeaking);
  const pageLabelRef = useRef(pageLabel);
  const startedKeyRef = useRef<string | null>(null);

  speakingRef.current = isSpeaking;
  pageLabelRef.current = pageLabel;

  const noteActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Speech is activity: keep the window open while it speaks, so a beat that
  // lands mid-sentence is credited even though nobody has touched the screen.
  useEffect(() => {
    if (isSpeaking) lastActivityRef.current = Date.now();
  }, [isSpeaking]);

  useEffect(() => {
    if (pageLabel) noteLocation(pageLabel);
  }, [pageLabel]);

  /**
   * Credit the wall time since the last credit, if the guard allows it.
   * Returns the ms credited (0 when the guard refused).
   */
  const creditElapsed = useCallback((): number => {
    const now = Date.now();
    const elapsed = now - lastCreditAtRef.current;
    lastCreditAtRef.current = now;

    if (elapsed <= 0) return 0;
    if (AppState.currentState !== "active") return 0;

    const recentlyActive = now - lastActivityRef.current <= ACTIVITY_WINDOW_MS;
    if (!recentlyActive && !speakingRef.current) return 0;

    const credited = Math.min(elapsed, MAX_CREDIT_PER_BEAT_MS);
    void creditTime(credited, pageLabelRef.current);
    // The dashboard's counter gets the SAME total, so it reads as it does today.
    void bumpReadingTime(credited);
    return credited;
  }, []);

  // ── Session lifecycle: start on focus, end + flush on blur ──
  useFocusEffect(
    useCallback(() => {
      if (!READING_SESSIONS || !enabled || !uri) return;

      let cancelled = false;
      const now = Date.now();
      lastActivityRef.current = now;
      lastCreditAtRef.current = now;

      void (async () => {
        const identity = await getFileIdentity(uri, name);
        if (cancelled) return;
        startedKeyRef.current = identity.key;
        await startSession(identity);
        // Opening the file cancels any pending nudge ABOUT THIS FILE. A
        // reminder to read the book already on screen is worse than none.
        void cancelReminderFor(identity.key);
      })();

      const interval = setInterval(() => {
        creditElapsed();
      }, BEAT_MS);

      // Every move away from "active" flushes the partial interval, and no
      // time accrues while backgrounded (creditElapsed refuses, and the next
      // credit window restarts from the moment we come back).
      const onAppState = (state: AppStateStatus) => {
        if (state === "active") {
          lastCreditAtRef.current = Date.now();
          return;
        }
        creditElapsed();
        void endSession();
      };
      const sub = AppState.addEventListener("change", onAppState);

      return () => {
        cancelled = true;
        clearInterval(interval);
        sub.remove();
        // The final partial interval — the one the old heartbeat threw away.
        creditElapsed();
        void endSession().then(() => {
          // Consider a nudge now that a real session has finished. It no-ops
          // unless the user opted in, and respects every limit in R2.5.
          void maybeScheduleReadingReminder();
        });
        startedKeyRef.current = null;
      };
    }, [uri, name, enabled, creditElapsed]),
  );

  return { noteActivity };
}
