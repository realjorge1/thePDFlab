/**
 * useReadingProgress
 *
 * Subscribes to the reading-progress service and exposes a stable map of
 * `{ [fileUri]: progress 0..1 }`. Re-renders only the consuming component
 * when progress for any tracked file changes.
 */
import { useEffect, useState } from "react";
import {
  ReadingProgressEntry,
  getAllReadingProgressSync,
  getReadingProgressSync,
  preloadReadingProgress,
  subscribeReadingProgress,
} from "@/services/readingProgressService";

type ProgressMap = Record<string, ReadingProgressEntry>;

export function useReadingProgress(): ProgressMap {
  const [map, setMap] = useState<ProgressMap>(
    () => getAllReadingProgressSync() ?? {},
  );

  useEffect(() => {
    let cancelled = false;

    if (!getAllReadingProgressSync()) {
      preloadReadingProgress().then(() => {
        if (cancelled) return;
        setMap(getAllReadingProgressSync() ?? {});
      });
    }

    const unsubscribe = subscribeReadingProgress(() => {
      if (cancelled) return;
      setMap(getAllReadingProgressSync() ?? {});
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return map;
}

/** Single-file variant — re-renders only when this file's entry changes. */
export function useReadingProgressFor(
  fileUri: string | undefined | null,
): ReadingProgressEntry | null {
  const [entry, setEntry] = useState<ReadingProgressEntry | null>(() =>
    fileUri ? getReadingProgressSync(fileUri) : null,
  );

  useEffect(() => {
    if (!fileUri) {
      setEntry(null);
      return;
    }
    let cancelled = false;

    if (!getAllReadingProgressSync()) {
      preloadReadingProgress().then(() => {
        if (cancelled) return;
        setEntry(getReadingProgressSync(fileUri));
      });
    } else {
      setEntry(getReadingProgressSync(fileUri));
    }

    const unsubscribe = subscribeReadingProgress(() => {
      if (cancelled) return;
      setEntry((prev) => {
        const next = getReadingProgressSync(fileUri);
        if (prev?.progress === next?.progress && prev?.lastReadAt === next?.lastReadAt) {
          return prev;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fileUri]);

  return entry;
}
