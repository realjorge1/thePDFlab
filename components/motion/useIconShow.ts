/**
 * The Activity card's idle show
 * ─────────────────────────────────────────────────────────────────────────────
 * Five icons, one at a time, in a fresh random order every time — so the card
 * never plays the same little film twice and never looks like a sequence being
 * stepped through. It runs when the app is opened, and again after every stretch
 * of genuine stillness; it stops dead the moment the screen is left.
 *
 * Nothing here loops on a timer that outlives the screen: every pending beat
 * lives in one array that the effect's cleanup empties, so leaving the tab,
 * backgrounding the app or unmounting all cancel the show by the same path.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { IconMotion } from "./iconMotion";

/** Silence between one icon finishing its turn and the next one starting. */
export const SHOW_GAP = 1200;
/** Stillness on the screen that earns a repeat performance. */
export const IDLE_REPEAT = 20_000;
/**
 * Beat between the screen appearing and the first icon moving.
 *
 * Deliberately past the tab dock's own arrival gesture (ARRIVAL_DELAY, plus the
 * half-second the Home icon's hop takes): on a cold start both would otherwise
 * fire on the same frame, and two unrelated things moving at once reads as the
 * screen glitching rather than as either of them greeting you.
 */
export const SHOW_LEAD = 1400;

/**
 * Whether the app is in front of the user, and how many times it has been
 * *opened*: 1 on a cold start, and one more each time it comes back after being
 * sent away.
 *
 * A resume counts as an opening deliberately. "Reopened" is what the user
 * experiences either way — whether Android actually tore the process down or
 * merely parked it is an implementation detail they never see, and tying the
 * show to a true cold start alone would make it fire arbitrarily rarely.
 */
export function useAppOpen(): { opens: number; foreground: boolean } {
  const [state, setState] = useState(() => ({
    opens: 1,
    foreground: AppState.currentState !== "background",
  }));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setState((prev) => {
        if (next === "background") return { ...prev, foreground: false };
        if (next !== "active") return prev;
        // "inactive" is skipped above rather than treated as away: iOS reports
        // it for a passing system sheet, a notification shade, a call banner.
        // Counting those would replay the show every time a dialog went by.
        return prev.foreground
          ? prev
          : { opens: prev.opens + 1, foreground: true };
      });
    });

    return () => sub.remove();
  }, []);

  return state;
}

export interface IconShowOptions {
  /** The screen is on-screen and the app is in front of the user. */
  active: boolean;
  /**
   * Bumped on every app opening (see `useAppOpen`). A value this hook has
   * not shown yet plays the whole set as soon as `active` allows; one it has
   * already shown just arms the idle timer, so walking back onto the screen
   * doesn't re-trigger it.
   */
  openCount: number;
  gap?: number;
  idle?: number;
  lead?: number;
}

/**
 * @returns `poke` — call it on any real user input on the screen. It pushes the
 *          next idle performance back out to a full `idle` away, which is what
 *          makes the repeat a reward for stillness rather than a metronome
 *          ticking over somebody who is busy reading.
 */
export function useIconShow(
  motions: IconMotion[],
  { active, openCount, gap = SHOW_GAP, idle = IDLE_REPEAT, lead = SHOW_LEAD }: IconShowOptions,
): () => void {
  // The caller rebuilds this array every render; the scheduler only ever wants
  // the newest one at the moment a beat actually fires.
  const motionsRef = useRef(motions);
  motionsRef.current = motions;

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playing = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  /** The last opening this hook has performed for. */
  const shown = useRef(-1);

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const at = useCallback((ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms));
  }, []);

  // `run` re-schedules itself, so it has to reach the *current* one rather than
  // the one that happened to be current when a timer was armed.
  const runRef = useRef<() => void>(() => {});

  const run = useCallback(() => {
    clear();
    const set = motionsRef.current;
    if (!set.length) return;

    // Fisher–Yates: every ordering equally likely, drawn fresh each show. Not a
    // rotation, not a shuffled list played to its end — two shows in a row can
    // legitimately open on the same icon, and that is what "random" looks like.
    const order = set.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    playing.current = true;
    let ends = 0;
    order.forEach((index, beat) => {
      const start = beat * gap;
      at(start, () => motionsRef.current[index]?.play());
      ends = Math.max(ends, start + set[index].duration);
    });

    at(ends, () => {
      playing.current = false;
    });
    // The wait starts when the last icon finishes, not when the first one
    // started — otherwise the gap between shows would shrink by the length of
    // the show itself.
    at(ends + idle, () => runRef.current());
  }, [at, clear, gap, idle]);

  runRef.current = run;

  const poke = useCallback(() => {
    // Mid-show input is left alone: cutting a gesture off half-way is more
    // distracting than letting the remaining second of it play out.
    if (!activeRef.current || playing.current) return;
    clear();
    at(idle, () => runRef.current());
  }, [at, clear, idle]);

  useEffect(() => {
    if (!active) {
      clear();
      playing.current = false;
      motionsRef.current.forEach((motion) => motion.stop());
      return;
    }

    const fresh = shown.current !== openCount;
    shown.current = openCount;
    at(fresh ? lead : idle, () => runRef.current());

    return clear;
  }, [active, openCount, lead, idle, at, clear]);

  return poke;
}
