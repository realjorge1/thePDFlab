/**
 * Reading Progress Service
 * Unified, lightweight per-file reading progress tracking.
 *
 * Keyed by file URI to match viewerStorageService and epubService conventions.
 * Persists a single JSON map in AsyncStorage with an in-memory cache and a
 * pub/sub channel so subscribed components re-render without re-reading storage.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@inscribed_reading_progress";

export type ReadingProgressSource = "pdf" | "epub" | "scroll";

export interface ReadingProgressEntry {
  /** Normalised 0..1 reading progress. */
  progress: number;
  /** Timestamp of last update. */
  lastReadAt: number;
  /** Optional: paginated formats track current page. */
  currentPage?: number;
  /** Optional: paginated formats track total page count. */
  totalPages?: number;
  /** Format of the underlying signal. */
  source: ReadingProgressSource;
}

type ProgressMap = Record<string, ReadingProgressEntry>;

let memoryCache: ProgressMap | null = null;
let loadPromise: Promise<ProgressMap> | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.warn("[ReadingProgress] listener error:", e);
    }
  }
}

async function loadMap(): Promise<ProgressMap> {
  if (memoryCache) return memoryCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      memoryCache = raw ? (JSON.parse(raw) as ProgressMap) : {};
    } catch (e) {
      console.warn("[ReadingProgress] load error:", e);
      memoryCache = {};
    }
    return memoryCache!;
  })();

  return loadPromise;
}

// Coalesce writes — viewers fire page changes rapidly (scroll, swipe).
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 400;

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    if (!memoryCache) return;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache));
    } catch (e) {
      console.warn("[ReadingProgress] persist error:", e);
    }
  }, WRITE_DEBOUNCE_MS);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Write progress for a file. `progress` should be in 0..1. */
export async function setReadingProgress(
  fileUri: string,
  progress: number,
  meta?: {
    currentPage?: number;
    totalPages?: number;
    source?: ReadingProgressSource;
  },
): Promise<void> {
  if (!fileUri) return;
  const map = await loadMap();
  const next: ReadingProgressEntry = {
    progress: clamp01(progress),
    lastReadAt: Date.now(),
    source: meta?.source ?? "scroll",
  };
  if (typeof meta?.currentPage === "number") next.currentPage = meta.currentPage;
  if (typeof meta?.totalPages === "number") next.totalPages = meta.totalPages;

  const prev = map[fileUri];
  // Skip noisy duplicate writes — same percentage rounded to nearest 0.5%.
  if (
    prev &&
    Math.abs(prev.progress - next.progress) < 0.005 &&
    prev.currentPage === next.currentPage &&
    prev.totalPages === next.totalPages
  ) {
    return;
  }

  map[fileUri] = next;
  scheduleWrite();
  notify();
}

/** Convenience: write progress as `current / total`. */
export async function setReadingProgressFromPages(
  fileUri: string,
  currentPage: number,
  totalPages: number,
): Promise<void> {
  if (!fileUri || !totalPages || totalPages <= 0) return;
  const progress = currentPage / totalPages;
  await setReadingProgress(fileUri, progress, {
    currentPage,
    totalPages,
    source: "pdf",
  });
}

/** Read a single file's progress (0..1). Returns null if untracked. */
export function getReadingProgressSync(
  fileUri: string,
): ReadingProgressEntry | null {
  if (!memoryCache) return null;
  return memoryCache[fileUri] ?? null;
}

/** Async fetch for a single file, ensures cache is loaded. */
export async function getReadingProgress(
  fileUri: string,
): Promise<ReadingProgressEntry | null> {
  const map = await loadMap();
  return map[fileUri] ?? null;
}

/** Read the entire progress map (for batch UI rendering). */
export async function getAllReadingProgress(): Promise<ProgressMap> {
  return { ...(await loadMap()) };
}

/** Synchronous accessor — returns the cached map, or null if not yet loaded. */
export function getAllReadingProgressSync(): ProgressMap | null {
  return memoryCache ? { ...memoryCache } : null;
}

/** Eagerly populate the in-memory cache. Safe to call from app startup. */
export async function preloadReadingProgress(): Promise<void> {
  await loadMap();
}

/** Remove an entry (e.g. when a file is deleted). */
export async function clearReadingProgress(fileUri: string): Promise<void> {
  const map = await loadMap();
  if (map[fileUri]) {
    delete map[fileUri];
    scheduleWrite();
    notify();
  }
}

/** Subscribe to progress changes; returns an unsubscribe fn. */
export function subscribeReadingProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
