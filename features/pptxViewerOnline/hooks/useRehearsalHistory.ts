// ============================================================================
// useRehearsalHistory — AsyncStorage-backed history of past rehearsal runs,
// keyed per presentation file. Powers the "history pill" trend on the results
// screen (last 3 totals + improving / slipping arrow). Capped at MAX_RUNS most
// recent runs per file so storage stays tiny.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "@pptx_rehearsal_history:";
const MAX_RUNS = 5;

export interface RehearsalRun {
  /** Total rehearsal time in ms. */
  totalMs: number;
  /** Target time the user was rehearsing against, in ms. */
  targetMs: number;
  /** Number of slides in the deck. */
  slideCount: number;
  /** Epoch ms when the run completed. */
  completedAt: number;
}

// A stable, filesystem-safe key. File URIs contain slashes and volatile cache
// paths, so we hash to a compact, deterministic token instead.
function keyFor(fileKey: string): string {
  let h = 5381;
  for (let i = 0; i < fileKey.length; i++) {
    h = (h * 33) ^ fileKey.charCodeAt(i);
  }
  return `${STORAGE_PREFIX}${(h >>> 0).toString(36)}`;
}

export interface UseRehearsalHistoryResult {
  /** Most-recent-first list of past runs (max MAX_RUNS). */
  history: RehearsalRun[];
  /** True until the first load from storage resolves. */
  loading: boolean;
  /** Persist a freshly completed run; returns the updated list. */
  addRun: (run: RehearsalRun) => Promise<void>;
}

export function useRehearsalHistory(fileKey: string): UseRehearsalHistoryResult {
  const [history, setHistory] = useState<RehearsalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const storageKey = useRef(keyFor(fileKey));

  useEffect(() => {
    storageKey.current = keyFor(fileKey);
    let alive = true;
    setLoading(true);
    AsyncStorage.getItem(storageKey.current)
      .then((raw) => {
        if (!alive) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) setHistory(parsed.slice(0, MAX_RUNS));
            else setHistory([]);
          } catch {
            setHistory([]);
          }
        } else {
          setHistory([]);
        }
      })
      .catch(() => {
        if (alive) setHistory([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fileKey]);

  const addRun = useCallback(async (run: RehearsalRun) => {
    let next: RehearsalRun[] = [];
    setHistory((prev) => {
      next = [run, ...prev].slice(0, MAX_RUNS);
      return next;
    });
    try {
      await AsyncStorage.setItem(storageKey.current, JSON.stringify(next));
    } catch {
      // Non-fatal — history is a nicety, not a requirement.
    }
  }, []);

  return { history, loading, addRun };
}
