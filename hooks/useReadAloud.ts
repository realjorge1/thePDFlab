/**
 * useReadAloud.ts
 * The single source of truth for Read-Aloud playback state.
 *
 * Responsibilities:
 *  - Owns playback state (status, currentChunkIndex, currentPageIndex)
 *  - Drives the TTS service (expo-speech)
 *  - Provides play / pause / stop / skip / setRate / jumpToChunk actions
 *  - Page-based skipping (next/prev page)
 *  - Time-based skipping (~10 s forward/backward via chunk estimation)
 *  - Owns the sleep timer, so it can never drift from playback state
 *  - Applies pronunciation rules on the way to the engine
 *  - Cleans up on unmount
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
    getRulesForSync,
    loadRules,
    subscribeRules,
} from "@/services/pronunciationService";
import { readAloudPersistence } from "@/services/readAloudPersistence";
import { loadSettings } from "@/services/settingsService";
import {
    getPitch,
    isSpeaking,
    pauseSpeaking,
    resumeSpeaking,
    speakSpokenText,
    stopSpeaking,
    setPitch as ttsSetPitch,
    setRate as ttsSetRate,
} from "@/services/ttsService";
import {
    CHUNK_LAYOUT_VERSION,
    mapLegacyChunkIndex,
    type TextChunk,
} from "@/utils/chunkText";
import { applyPronunciation } from "@/utils/pronunciation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadAloudStatus =
  | "idle"
  | "speaking"
  | "paused"
  | "finished"
  | "error";

/** Result from page-skip helpers so the UI can show a toast. */
export type SkipResult =
  | { kind: "jumped"; message: string }
  | { kind: "boundary"; message: string };

/**
 * Where the engine is, word by word.
 *
 * Two coordinate spaces, because the consumers need different ones:
 *  - `chunkStart`/`chunkEnd` are offsets inside the chunk's own text, which is
 *    what the WebView highlighters use — they locate the chunk in the rendered
 *    DOM first, then the word inside it.
 *  - `displayStart`/`displayEnd` are absolute within the page or chapter's
 *    **cleaned** text. Useful for progress and analysis, but note that a
 *    renderer shows the raw source, which cleaning has changed.
 *
 * All offsets are in display coordinates: pronunciation replacements have
 * already been mapped back, so a respelled word reports the span of the word
 * as written.
 */
export interface WordBoundaryPosition {
  chunkIndex: number;
  pageIndex: number;
  chunkStart: number;
  chunkEnd: number;
  displayStart: number;
  displayEnd: number;
}

export interface UseReadAloudOptions {
  /** Full flat chunk list (across all pages). */
  chunks: TextChunk[];
  /** Called whenever playback advances to a new chunk. */
  onChunkChange?: (chunk: TextChunk) => void;
  /**
   * Called as each word is spoken, where the engine reports word boundaries.
   *
   * Throttled and suppressed while the app is backgrounded — see
   * MIN_BOUNDARY_INTERVAL_MS. Never called at all on engines that report no
   * ranges, which is the signal to stay with chunk-level highlighting.
   */
  onWordBoundary?: (position: WordBoundaryPosition) => void;
  /** Initial playback rate (0.75 – 2.0). Defaults to 1.0. */
  initialRate?: number;
  /** Initial voice pitch (0.5 – 2.0). Defaults to 1.0. */
  initialPitch?: number;
  /** Initial inter-paragraph pause in ms (0 – 2000). Defaults to 0 (off). */
  initialParagraphPauseMs?: number;
  /** Document ID for persistence. If provided, state will be saved/restored. */
  documentId?: string;
  /** Whether to persist Read Aloud state. Defaults to true if documentId is provided. */
  persistState?: boolean;
  /**
   * Display name of the document. Currently unused by playback itself —
   * retained because the forthcoming MediaSession/Now-Playing integration
   * needs a title to show on the lock screen.
   */
  documentName?: string;
}

export interface ReadAloudControls {
  status: ReadAloudStatus;
  currentChunkIndex: number;
  currentPageIndex: number;
  rate: number;
  /** Voice pitch (0.5 – 2.0). 1.0 is the voice's natural pitch. */
  pitch: number;
  totalChunks: number;
  totalPages: number;
  play: (fromIndex?: number) => void;
  pause: () => void;
  stop: () => void;
  /** Jump to next page. Returns a message for toast display. */
  skipPageForward: () => SkipResult;
  /** Jump to previous page. Returns a message for toast display. */
  skipPageBack: () => SkipResult;
  /** Skip forward ~10 s of speech (chunk-based approximation). */
  skipForward10s: () => void;
  /** Skip backward ~10 s of speech (chunk-based approximation). */
  skipBack10s: () => void;
  jumpToChunk: (index: number) => void;
  setRate: (rate: number) => void;
  /** Set the voice pitch. Clamped to 0.5 – 2.0 and saved per document. */
  setPitch: (pitch: number) => void;
  /** Silence inserted between paragraphs, in ms. 0 disables it. */
  paragraphPauseMs: number;
  /** Set the inter-paragraph pause. Clamped to 0 – 2000 ms. */
  setParagraphPauseMs: (ms: number) => void;

  // ── Sleep timer ──────────────────────────────────────

  /** Minutes remaining on the sleep timer, or null when unset. */
  sleepTimerMinutesLeft: number | null;
  /** Arm the timer. Pass null to cancel. */
  setSleepTimer: (minutes: number | null) => void;
  /** Stop at the end of the current page/chapter instead of at a wall-clock time. */
  setSleepAtSectionEnd: (enabled: boolean) => void;
  sleepAtSectionEnd: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Average words-per-minute at 1× speed (conservative estimate). */
const BASE_WPM = 155;

/**
 * Floor on the gap between word-boundary callbacks, ~10/s.
 *
 * Speech runs at roughly 3 words a second at 1×, so this almost never drops
 * anything; it is a ceiling on bridge traffic for fast rates and engines that
 * report sub-word ranges, not a feature of normal playback.
 */
const MIN_BOUNDARY_INTERVAL_MS = 100;

/** Count words in a string. */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Estimate duration (seconds) of a chunk given the current playback rate.
 */
function estimateChunkDuration(chunk: TextChunk, rate: number): number {
  const wpm = BASE_WPM * rate;
  return (wordCount(chunk.text) / wpm) * 60;
}

// ---------------------------------------------------------------------------
// Persistence helper
// ---------------------------------------------------------------------------

/**
 * `saveState` replaces the whole stored record, so every call site must pass
 * the full set of per-book playback preferences — omitting `pitch` here would
 * silently erase a pitch the user had chosen for this document.
 */
function saveReadAloudState(
  documentId: string | undefined,
  persistState: boolean,
  status: ReadAloudStatus,
  chunkIndex: number,
  rate: number,
  pitch: number,
): void {
  if (persistState && documentId) {
    readAloudPersistence
      .saveState({
        documentId,
        chunkIndex,
        status,
        rate,
        pitch,
        chunkLayout: CHUNK_LAYOUT_VERSION,
        timestamp: Date.now(),
      })
      .catch((error) => {
        console.warn("[useReadAloud] Failed to save state:", error);
      });
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReadAloud({
  chunks,
  onChunkChange,
  onWordBoundary,
  initialRate = 1.0,
  initialPitch = 1.0,
  initialParagraphPauseMs = 0,
  documentId,
  persistState = !!documentId,
}: UseReadAloudOptions): ReadAloudControls {
  const [status, setStatus] = useState<ReadAloudStatus>("idle");
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [rate, setRateState] = useState(initialRate);
  const [pitch, setPitchState] = useState(initialPitch);
  const [paragraphPauseMs, setParagraphPauseMsState] = useState(
    initialParagraphPauseMs,
  );

  // Keep refs so TTS callbacks always read the latest values
  const indexRef = useRef(0);
  const statusRef = useRef<ReadAloudStatus>("idle");
  const chunksRef = useRef<TextChunk[]>(chunks);
  const rateRef = useRef(initialRate);
  const pitchRef = useRef(initialPitch);
  const mountedRef = useRef(true);
  const documentIdRef = useRef(documentId);
  const persistStateRef = useRef(persistState);
  // Set once the user explicitly picks a rate/pitch, so the async global-default
  // resolution below can never overwrite a deliberate choice made while it was
  // still reading from storage.
  const userTouchedRateRef = useRef(false);
  const userTouchedPitchRef = useRef(false);
  const userTouchedPauseRef = useRef(false);

  // ── Word boundaries ────────────────────────────────────────────
  // Held in refs so the speak callbacks never need re-creating, and so a
  // backgrounded app stops paying to cross the bridge for invisible updates.
  const onWordBoundaryRef = useRef(onWordBoundary);
  const lastBoundaryEmitRef = useRef(0);
  const appActiveRef = useRef(true);

  useEffect(() => {
    onWordBoundaryRef.current = onWordBoundary;
  }, [onWordBoundary]);

  /**
   * Lifecycle.
   *
   * Two things happen around a trip to the background, and neither used to be
   * handled at all:
   *
   *  - **Leaving.** The OS can reclaim the process without warning. Position
   *    is normally written when a chunk starts, which could be minutes ago,
   *    so it is written again here — otherwise a reader who gets a phone call
   *    and never comes back loses their place.
   *  - **Returning.** iOS keeps speaking behind the lock screen once the
   *    audio background mode is configured; Android's TTS engine goes down
   *    with the app. If we come back still believing we are speaking while
   *    the device is silent, the bar shows Pause on a stopped reader and the
   *    only way out is to stop and start again. Asking the engine what is
   *    actually happening and settling on "paused" keeps the controls honest.
   */
  useEffect(() => {
    // Start from "active" rather than trusting AppState.currentState: a reader
    // is mounting because someone is looking at it, and an "unknown" or stale
    // initial value would silently drop every word boundary until the app next
    // changed state.
    appActiveRef.current = true;

    const sub = AppState.addEventListener("change", (next) => {
      const wasActive = appActiveRef.current;
      appActiveRef.current = next === "active";

      if (next !== "active") {
        if (statusRef.current === "speaking" || statusRef.current === "paused") {
          saveReadAloudState(
            documentIdRef.current,
            persistStateRef.current,
            statusRef.current,
            indexRef.current,
            rateRef.current,
            pitchRef.current,
          );
        }
        return;
      }

      if (!wasActive && statusRef.current === "speaking") {
        isSpeaking()
          .then((speaking) => {
            // Re-check: the user may have pressed play while we were asking.
            if (!mountedRef.current) return;
            if (speaking || statusRef.current !== "speaking") return;

            statusRef.current = "paused";
            setStatus("paused");
            saveReadAloudState(
              documentIdRef.current,
              persistStateRef.current,
              "paused",
              indexRef.current,
              rateRef.current,
              pitchRef.current,
            );
          })
          .catch(() => {
            // No engine to ask — leave the state alone rather than guessing.
          });
      }
    });

    return () => sub.remove();
  }, []);

  /**
   * Forward one word boundary to the consumer.
   *
   * `charIndex`/`charLength` arrive already mapped to display coordinates by
   * ttsService, so nothing here needs to know pronunciation rules exist.
   */
  const emitWordBoundary = useCallback(
    (chunk: TextChunk, charIndex: number, charLength: number) => {
      const cb = onWordBoundaryRef.current;
      if (!cb || !appActiveRef.current) return;

      const now = Date.now();
      if (now - lastBoundaryEmitRef.current < MIN_BOUNDARY_INTERVAL_MS) return;
      lastBoundaryEmitRef.current = now;

      const chunkStart = Math.max(0, Math.min(charIndex, chunk.text.length));
      const chunkEnd = Math.max(
        chunkStart,
        Math.min(chunkStart + charLength, chunk.text.length),
      );
      const base = chunk.charStart ?? 0;

      cb({
        chunkIndex: chunk.chunkIndex,
        pageIndex: chunk.pageIndex,
        chunkStart,
        chunkEnd,
        displayStart: base + chunkStart,
        displayEnd: base + chunkEnd,
      });
    },
    [],
  );

  // ── Pronunciation ──────────────────────────────────────────────
  // Read synchronously on the speak path — an await between chunks would be
  // audible — so rules are mirrored into a ref and kept fresh by subscription.
  const rulesRef = useRef(getRulesForSync(documentId));

  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      if (!cancelled) rulesRef.current = getRulesForSync(documentIdRef.current);
    };

    loadRules().then(sync);
    const unsubscribe = subscribeRules(sync);
    sync();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [documentId]);

  // ── Inter-paragraph pause ──────────────────────────────────────
  const paragraphPauseRef = useRef(initialParagraphPauseMs);
  const paragraphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearParagraphTimer = useCallback(() => {
    if (paragraphTimerRef.current) {
      clearTimeout(paragraphTimerRef.current);
      paragraphTimerRef.current = null;
    }
  }, []);

  const setParagraphPauseMs = useCallback((ms: number) => {
    userTouchedPauseRef.current = true;
    const clamped = Math.min(2000, Math.max(0, Math.round(ms)));
    paragraphPauseRef.current = clamped;
    setParagraphPauseMsState(clamped);
  }, []);
  // Ensures persisted state is restored at most once — otherwise streamed text
  // (chunks growing page-by-page) would re-run the restore and could yank
  // playback back to an earlier chunk.
  const hasRestoredRef = useRef(false);

  // Sync refs when props change
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    documentIdRef.current = documentId;
    persistStateRef.current = persistState;
    // A different document gets its own one-time restore.
    hasRestoredRef.current = false;
  }, [documentId, persistState]);

  // Load persisted state on mount
  useEffect(() => {
    if (persistState && documentId) {
      readAloudPersistence.getState(documentId).then((savedState) => {
        if (savedState && mountedRef.current && !hasRestoredRef.current) {
          // Positions saved before sentences were packed into chunks count
          // single sentences; map those onto the current layout exactly. -1
          // means that sentence has not streamed in yet, so the restore is
          // left for a later pass (hasRestoredRef stays false) rather than
          // landing somewhere wrong.
          const restoredIndex =
            savedState.chunkLayout === CHUNK_LAYOUT_VERSION
              ? savedState.chunkIndex
              : mapLegacyChunkIndex(chunksRef.current, savedState.chunkIndex);

          // Only restore if we have the same document and chunks are loaded
          if (
            chunks.length > 0 &&
            restoredIndex >= 0 &&
            restoredIndex < chunks.length
          ) {
            hasRestoredRef.current = true;
            indexRef.current = restoredIndex;
            setCurrentChunkIndex(restoredIndex);
            statusRef.current = savedState.status;
            setStatus(savedState.status);
            if (savedState.rate !== rate) {
              setRateState(savedState.rate);
              rateRef.current = savedState.rate;
              ttsSetRate(savedState.rate);
            }
            // Records written before pitch existed have none — those books fall
            // through to the global-default resolution below instead.
            if (
              savedState.pitch !== undefined &&
              savedState.pitch !== pitchRef.current
            ) {
              setPitchState(savedState.pitch);
              pitchRef.current = savedState.pitch;
              ttsSetPitch(savedState.pitch);
            }
          }
        }
      });
    }
  }, [persistState, documentId, chunks.length, rate]);

  // ── Global reading defaults ────────────────────────────────────
  // Supplies settingsService defaults for values this book has never saved.
  // The per-book restore above owns every value that *is* saved, so the two
  // paths are disjoint: whichever resolves first, the outcome is the same.
  // Guarded so it applies at most once per document, and skipped entirely for
  // a value the user has already chosen by hand this session.
  const hasAppliedGlobalDefaultsRef = useRef(false);

  useEffect(() => {
    hasAppliedGlobalDefaultsRef.current = false;
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const saved =
        persistState && documentId
          ? await readAloudPersistence.getState(documentId)
          : null;
      if (cancelled || !mountedRef.current) return;

      const needsRate = saved?.rate === undefined;
      const needsPitch = saved?.pitch === undefined;
      if (hasAppliedGlobalDefaultsRef.current) return;

      const settings = await loadSettings();
      if (cancelled || !mountedRef.current) return;
      if (hasAppliedGlobalDefaultsRef.current) return;
      hasAppliedGlobalDefaultsRef.current = true;

      if (needsRate && !userTouchedRateRef.current) {
        ttsSetRate(settings.readingSpeed);
        setRateState(settings.readingSpeed);
        rateRef.current = settings.readingSpeed;
      }
      if (needsPitch && !userTouchedPitchRef.current) {
        ttsSetPitch(settings.readingPitch);
        const applied = getPitch();
        setPitchState(applied);
        pitchRef.current = applied;
      }
      // The paragraph pause is a global preference only — it is not stored
      // per book, so it is resolved here every time a document loads.
      if (!userTouchedPauseRef.current) {
        const ms = Math.min(
          2000,
          Math.max(0, Math.round(settings.readingParagraphPauseMs ?? 0)),
        );
        paragraphPauseRef.current = ms;
        setParagraphPauseMsState(ms);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persistState, documentId]);

  // Bootstrap rate & pitch
  useEffect(() => {
    ttsSetRate(initialRate);
    ttsSetPitch(initialPitch);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track mount status
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Page index helpers ─────────────────────────────────────────
  /** Build a map from pageIndex → first chunk index on that page. */
  const pageStartMap = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < chunks.length; i++) {
      const p = chunks[i].pageIndex;
      if (!map.has(p)) map.set(p, i);
    }
    return map;
  }, [chunks]);

  /** Sorted unique page indices. */
  const sortedPages = useMemo(
    () => Array.from(pageStartMap.keys()).sort((a, b) => a - b),
    [pageStartMap],
  );

  const totalPages = sortedPages.length;

  // ── Sleep timer ────────────────────────────────────────────────
  const [sleepTimerMinutesLeft, setSleepTimerMinutesLeft] = useState<
    number | null
  >(null);
  const [sleepAtSectionEnd, setSleepAtSectionEndState] = useState(false);

  const sleepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sleepMinutesLeftRef = useRef<number | null>(null);
  const sleepAtSectionEndRef = useRef(false);
  /**
   * Latest pause(). The timer tick and the section-end guard both need to stop
   * playback *through the state machine* — so position is saved and the UI
   * reads "paused" — without speakAt() taking a dependency on pause() and
   * re-creating itself mid-playback.
   */
  const pauseRef = useRef<() => void>(() => {});

  const clearSleepInterval = useCallback(() => {
    if (sleepIntervalRef.current) {
      clearInterval(sleepIntervalRef.current);
      sleepIntervalRef.current = null;
    }
  }, []);

  const cancelSleepTimer = useCallback(() => {
    clearSleepInterval();
    sleepMinutesLeftRef.current = null;
    sleepAtSectionEndRef.current = false;
    if (mountedRef.current) {
      setSleepTimerMinutesLeft(null);
      setSleepAtSectionEndState(false);
    }
  }, [clearSleepInterval]);

  const setSleepTimer = useCallback(
    (minutes: number | null) => {
      clearSleepInterval();

      if (minutes === null || minutes <= 0) {
        sleepMinutesLeftRef.current = null;
        setSleepTimerMinutesLeft(null);
        return;
      }

      const whole = Math.round(minutes);
      sleepMinutesLeftRef.current = whole;
      setSleepTimerMinutesLeft(whole);

      // One ticker at minute resolution — the bar only ever shows whole minutes.
      sleepIntervalRef.current = setInterval(() => {
        const next = (sleepMinutesLeftRef.current ?? 0) - 1;

        if (next > 0) {
          sleepMinutesLeftRef.current = next;
          if (mountedRef.current) setSleepTimerMinutesLeft(next);
          return;
        }

        clearSleepInterval();
        sleepMinutesLeftRef.current = null;
        if (mountedRef.current) setSleepTimerMinutesLeft(null);
        pauseRef.current();
      }, 60_000);
    },
    [clearSleepInterval],
  );

  const setSleepAtSectionEnd = useCallback((enabled: boolean) => {
    sleepAtSectionEndRef.current = enabled;
    setSleepAtSectionEndState(enabled);
  }, []);

  // ---------------------------------------------------------------------------
  // Core: speak a specific chunk by index
  // ---------------------------------------------------------------------------
  const speakAt = useCallback(
    (index: number) => {
      const list = chunksRef.current;
      if (index >= list.length) {
        // Finished reading the whole document
        if (mountedRef.current) {
          setStatus("finished");
          statusRef.current = "finished";
          setCurrentChunkIndex(Math.max(0, list.length - 1));
          // Save finished state
          saveReadAloudState(
            documentIdRef.current,
            persistStateRef.current,
            "finished",
            Math.max(0, list.length - 1),
            rateRef.current,
            pitchRef.current,
          );
        }
        return;
      }

      const chunk = list[index];
      indexRef.current = index;
      if (mountedRef.current) {
        setCurrentChunkIndex(index);
        setStatus("speaking");
      }
      statusRef.current = "speaking";
      onChunkChange?.(chunk);

      // Save state when starting playback
      saveReadAloudState(
        documentIdRef.current,
        persistStateRef.current,
        "speaking",
        index,
        rateRef.current,
        pitchRef.current,
      );

      // Stop any current speech before starting a new one. A pending
      // inter-paragraph pause belongs to the chunk we just superseded.
      clearParagraphTimer();
      stopSpeaking();

      // Small delay to ensure previous stop completes
      setTimeout(() => {
        if (!mountedRef.current) return;
        // Guard: if status changed while waiting (e.g. user paused/stopped)
        if (statusRef.current !== "speaking") return;

        // Rewrite for the engine, keeping a map back to what is on screen so
        // boundary offsets stay meaningful to the UI.
        const spoken = applyPronunciation(chunk.text, rulesRef.current);

        speakSpokenText(spoken, {
          onBoundary: ({ charIndex, charLength }) => {
            emitWordBoundary(chunk, charIndex, charLength);
          },
          onDone: () => {
            // Auto-advance when we're still speaking (not manually stopped)
            if (statusRef.current === "speaking" && mountedRef.current) {
              const next = indexRef.current + 1;
              const list2 = chunksRef.current;

              // "Stop at end of section": pageIndex is the page for PDF/DOCX
              // and the chapter for EPUB, so this one check covers both.
              if (
                sleepAtSectionEndRef.current &&
                next < list2.length &&
                list2[next].pageIndex !== list2[indexRef.current].pageIndex
              ) {
                // Park at the *start of the next section* so pressing play
                // continues forward rather than replaying what just finished.
                indexRef.current = next;
                setCurrentChunkIndex(next);
                onChunkChange?.(list2[next]);

                // One-shot, like the countdown: disarm so the next play()
                // isn't cut short at the very next boundary too.
                sleepAtSectionEndRef.current = false;
                setSleepAtSectionEndState(false);

                pauseRef.current();
                return;
              }

              // Breathe between paragraphs. Status stays "speaking" through
              // the gap so pause/stop behave normally and the bar does not
              // flicker.
              const gap = paragraphPauseRef.current;
              if (gap > 0 && next < list2.length && list2[next].startsParagraph) {
                clearParagraphTimer();
                paragraphTimerRef.current = setTimeout(() => {
                  paragraphTimerRef.current = null;
                  if (mountedRef.current && statusRef.current === "speaking") {
                    speakAt(next);
                  }
                }, gap);
                return;
              }

              speakAt(next);
            }
          },
          onStopped: () => {
            // Stopped manually — don't auto-advance
          },
          onError: () => {
            if (mountedRef.current) {
              setStatus("error");
              statusRef.current = "error";
            }
          },
        });
      }, 50);
    },
    [onChunkChange, clearParagraphTimer, emitWordBoundary],
  );

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  /**
   * Play, or resume in place.
   *
   * With no explicit index this first asks the TTS service to resume: iOS
   * continues the suspended utterance, Android re-speaks the tail of the chunk
   * from the last word boundary. Only when there is nothing to resume — a cold
   * start, or an engine that reports no boundaries — does it fall back to
   * replaying the whole chunk.
   */
  const play = useCallback(
    (fromIndex?: number) => {
      if (fromIndex !== undefined) {
        speakAt(fromIndex);
        return;
      }

      const index = indexRef.current;

      // Enter "speaking" synchronously. The resumed utterance's onDone must
      // see the right status to auto-advance, and this also disarms the
      // delayed safety-pause that pause() schedules.
      statusRef.current = "speaking";
      setStatus("speaking");

      const replay = () => {
        if (mountedRef.current && statusRef.current === "speaking") {
          speakAt(index);
        }
      };

      resumeSpeaking()
        .then((resumed) => {
          if (!mountedRef.current || statusRef.current !== "speaking") return;
          if (!resumed) {
            replay();
            return;
          }
          saveReadAloudState(
            documentIdRef.current,
            persistStateRef.current,
            "speaking",
            index,
            rateRef.current,
            pitchRef.current,
          );
        })
        .catch(replay);
    },
    [speakAt],
  );

  /**
   * Pause where we are.
   *
   * Resolution depends on the platform, and pauseSpeaking() hides which: iOS
   * suspends the utterance and resumes at the exact same word; Android stops
   * and remembers the last reported word boundary, so a resume re-speaks only
   * the tail of the chunk rather than all ~300 characters of it.
   *
   * CRITICAL: set statusRef BEFORE pausing so that any synchronous
   * onDone/onStopped callback from the underlying Speech.stop() sees "paused"
   * and does NOT auto-advance.
   *
   * Pausing deliberately leaves the sleep timer running: someone who pauses to
   * answer a question still wants to fall asleep on schedule. Only stop()
   * cancels it.
   */
  const pause = useCallback(() => {
    statusRef.current = "paused";
    setStatus("paused");
    clearParagraphTimer();
    void pauseSpeaking();
    // Safety net for engines that do not honour the first request. Routed
    // through pauseSpeaking() rather than stopSpeaking() so it cannot discard
    // the resume offset, and guarded on status so a play() in the meantime
    // is not silenced.
    setTimeout(() => {
      if (mountedRef.current && statusRef.current === "paused") {
        void pauseSpeaking();
      }
    }, 100);
    saveReadAloudState(
      documentIdRef.current,
      persistStateRef.current,
      "paused",
      indexRef.current,
      rateRef.current,
      pitchRef.current,
    );
  }, [clearParagraphTimer]);

  const stop = useCallback(() => {
    statusRef.current = "idle";
    setStatus("idle");
    clearParagraphTimer();
    stopSpeaking();
    indexRef.current = 0;
    setCurrentChunkIndex(0);
    // Stopping ends the listening session — the sleep timer goes with it.
    cancelSleepTimer();
    // Clear persisted state when stopped
    if (persistStateRef.current && documentIdRef.current) {
      readAloudPersistence.clearState(documentIdRef.current);
    }
  }, [cancelSleepTimer, clearParagraphTimer]);

  // ── Page-based skipping ────────────────────────────────────────

  const skipPageForward = useCallback((): SkipResult => {
    const currentPage = chunksRef.current[indexRef.current]?.pageIndex ?? 0;
    const pagePos = sortedPages.indexOf(currentPage);

    if (pagePos === -1 || pagePos >= sortedPages.length - 1) {
      return { kind: "boundary", message: "Already on last page" };
    }

    const nextPage = sortedPages[pagePos + 1];
    const nextChunkIdx = pageStartMap.get(nextPage) ?? 0;

    // Set status before stopping to prevent auto-advance
    const wasSpeaking = statusRef.current === "speaking";
    statusRef.current = "paused";
    stopSpeaking();

    if (wasSpeaking) {
      speakAt(nextChunkIdx);
    } else {
      // If paused/idle, just move position (don't auto-play)
      indexRef.current = nextChunkIdx;
      setCurrentChunkIndex(nextChunkIdx);
      onChunkChange?.(chunksRef.current[nextChunkIdx]);
    }
    return { kind: "jumped", message: "Skipped forward to next page" };
  }, [sortedPages, pageStartMap, speakAt, onChunkChange]);

  const skipPageBack = useCallback((): SkipResult => {
    const currentPage = chunksRef.current[indexRef.current]?.pageIndex ?? 0;
    const pagePos = sortedPages.indexOf(currentPage);

    if (pagePos <= 0) {
      return { kind: "boundary", message: "Already on first page" };
    }

    const prevPage = sortedPages[pagePos - 1];
    const prevChunkIdx = pageStartMap.get(prevPage) ?? 0;

    const wasSpeaking = statusRef.current === "speaking";
    statusRef.current = "paused";
    stopSpeaking();

    if (wasSpeaking) {
      speakAt(prevChunkIdx);
    } else {
      indexRef.current = prevChunkIdx;
      setCurrentChunkIndex(prevChunkIdx);
      onChunkChange?.(chunksRef.current[prevChunkIdx]);
    }
    return { kind: "jumped", message: "Skipped backward to previous page" };
  }, [sortedPages, pageStartMap, speakAt, onChunkChange]);

  // ── 10-second time-based skipping ───────────────────────────────

  const skipForward10s = useCallback(() => {
    const list = chunksRef.current;
    const curRate = rateRef.current;
    let accumulated = 0;
    let target = indexRef.current;

    // Walk forward through chunks until ~10 s accumulated
    for (let i = indexRef.current; i < list.length; i++) {
      accumulated += estimateChunkDuration(list[i], curRate);
      target = i;
      if (accumulated >= 10) break;
    }

    // Advance at least 1 chunk
    target = Math.min(Math.max(target, indexRef.current + 1), list.length - 1);

    const wasSpeaking = statusRef.current === "speaking";
    statusRef.current = "paused";
    stopSpeaking();

    if (wasSpeaking) {
      speakAt(target);
    } else {
      indexRef.current = target;
      setCurrentChunkIndex(target);
      onChunkChange?.(list[target]);
    }
  }, [speakAt, onChunkChange]);

  const skipBack10s = useCallback(() => {
    const list = chunksRef.current;
    const curRate = rateRef.current;
    let accumulated = 0;
    let target = indexRef.current;

    // Walk backward through chunks until ~10 s accumulated
    for (let i = indexRef.current; i >= 0; i--) {
      accumulated += estimateChunkDuration(list[i], curRate);
      target = i;
      if (accumulated >= 10) break;
    }

    // Go back at least 1 chunk
    target = Math.max(Math.min(target, indexRef.current - 1), 0);

    const wasSpeaking = statusRef.current === "speaking";
    statusRef.current = "paused";
    stopSpeaking();

    if (wasSpeaking) {
      speakAt(target);
    } else {
      indexRef.current = target;
      setCurrentChunkIndex(target);
      onChunkChange?.(list[target]);
    }
  }, [speakAt, onChunkChange]);

  // ── Legacy chunk-level skip (kept for jumpToChunk) ────────────

  const jumpToChunk = useCallback(
    (index: number) => {
      const wasSpeaking = statusRef.current === "speaking";
      statusRef.current = "paused";
      stopSpeaking();

      const clamped = Math.max(
        0,
        Math.min(index, chunksRef.current.length - 1),
      );
      if (wasSpeaking) {
        speakAt(clamped);
      } else {
        indexRef.current = clamped;
        setCurrentChunkIndex(clamped);
      }
    },
    [speakAt],
  );

  const setRate = useCallback((newRate: number) => {
    userTouchedRateRef.current = true;
    ttsSetRate(newRate);
    setRateState(newRate);
    rateRef.current = newRate;
    saveReadAloudState(
      documentIdRef.current,
      persistStateRef.current,
      statusRef.current,
      indexRef.current,
      newRate,
      pitchRef.current,
    );
  }, []);

  /**
   * Pitch is a set-once preference rather than a live control, so it takes
   * effect on the *next* utterance — changing it mid-sentence would mean
   * restarting the chunk and repeating audio.
   */
  const setPitch = useCallback((newPitch: number) => {
    userTouchedPitchRef.current = true;
    ttsSetPitch(newPitch);
    // Read back through the service so the clamp lives in exactly one place.
    const applied = getPitch();
    setPitchState(applied);
    pitchRef.current = applied;
    saveReadAloudState(
      documentIdRef.current,
      persistStateRef.current,
      statusRef.current,
      indexRef.current,
      rateRef.current,
      applied,
    );
  }, []);

  // Keep pauseRef pointing at the live pause() for the sleep timer and the
  // section-end guard. Assigned in an effect rather than during render so the
  // React Compiler never sees a ref mutated mid-render.
  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      stopSpeaking();
      if (sleepIntervalRef.current) {
        clearInterval(sleepIntervalRef.current);
        sleepIntervalRef.current = null;
      }
      if (paragraphTimerRef.current) {
        clearTimeout(paragraphTimerRef.current);
        paragraphTimerRef.current = null;
      }
    };
  }, []);

  // Reset when chunks change (new document loaded)
  // But don't reset if we have persistence enabled and will load state
  useEffect(() => {
    if (!persistStateRef.current || !documentIdRef.current) {
      statusRef.current = "idle";
      stopSpeaking();
      setStatus("idle");
      indexRef.current = 0;
      setCurrentChunkIndex(0);
    }
  }, [chunks]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const currentPageIndex = chunks[currentChunkIndex]?.pageIndex ?? 0;

  return {
    status,
    currentChunkIndex,
    currentPageIndex,
    rate,
    totalChunks: chunks.length,
    totalPages,
    play,
    pause,
    stop,
    skipPageForward,
    skipPageBack,
    skipForward10s,
    skipBack10s,
    jumpToChunk,
    setRate,
    pitch,
    setPitch,
    paragraphPauseMs,
    setParagraphPauseMs,
    sleepTimerMinutesLeft,
    setSleepTimer,
    sleepAtSectionEnd,
    setSleepAtSectionEnd,
  };
}
