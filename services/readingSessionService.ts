// ============================================
// Reading Session Service
// ---------------------------------------------
// Per-file, per-day reading time, and the data behind "You spent 40 minutes
// reading Thermodynamics, Ch. 4 on Friday — continue where you left off?".
//
// The existing counter in services/workspaceInsightsService.ts is ONE global
// number: it does not know which file, and it does not bucket by day. This
// store adds both, without changing that counter — the shared hook credits
// both, so the Progress dashboard keeps reading exactly as it does today.
//
// THE DAY IS A LOCAL CALENDAR DATE.
//   `day` is YYYY-MM-DD derived from the DEVICE'S LOCAL TIME, never from a
//   UTC ISO slice. This is the single easiest bug to introduce in this file.
//   new Date().toISOString().slice(0,10) is wrong: for anyone reading in the
//   evening west of UTC it names TOMORROW, so the resume card says "Saturday"
//   about Friday evening's reading. Use localDayKey() below, always.
//
// RETENTION: a rolling 90-day window, pruned on load. One row per file per day
// grows without bound otherwise (365 rows per file per year), and this app has
// no SQLite — every local store here is one AsyncStorage JSON blob.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";

import { resolveIdentityToLiveUri, type FileIdentity } from "@/services/fileIdentity";
import {
  getAllReadingProgress,
  type ReadingProgressEntry,
} from "@/services/readingProgressService";
import { BOOK_DONE } from "@/services/workspaceInsightsService";

const STORAGE_KEY = "@wordsinscribed/reading_sessions_v1";

/** Rolling window. Rows older than this are dropped when the store loads. */
export const RETENTION_DAYS = 90;

/** A session shorter than this is not worth resuming or reporting. */
export const MIN_RESUMABLE_MS = 2 * 60 * 1000;

export interface ReadingDayBucket {
  identityKey: string;
  /** Local calendar date, YYYY-MM-DD. Never a UTC ISO slice. */
  day: string;
  ms: number;
  opens: number;
  lastPageLabel?: string;
  /** Denormalized so a resume card can be built without the file index. */
  fileName?: string;
  fileExt?: string;
  /** Last known URI — informational, may be dead. */
  lastUri?: string;
  /** Local-time epoch ms of the last credited activity in this bucket. */
  updatedAt: number;
}

interface SessionState {
  buckets: ReadingDayBucket[];
}

/**
 * The local calendar date as YYYY-MM-DD.
 *
 * Built from getFullYear/getMonth/getDate — the DEVICE'S local calendar.
 * Do not replace this with toISOString().slice(0, 10): that is UTC, and it
 * puts evening reading on the wrong day for every user west of UTC (and
 * morning reading on the wrong day east of it).
 */
export function localDayKey(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight (as epoch ms) for a YYYY-MM-DD key. */
export function localDayStart(day: string): number {
  const [y, m, d] = day.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// ─── State + persistence ──────────────────────────────────────────────────────

let cache: SessionState | null = null;
let loadPromise: Promise<SessionState> | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.warn("[ReadingSessions] listener error:", e);
    }
  }
}

export function subscribeReadingSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop rows outside the rolling window. Returns true when anything changed. */
function prune(state: SessionState, now: number = Date.now()): boolean {
  const cutoffDay = localDayKey(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const before = state.buckets.length;
  // YYYY-MM-DD compares correctly as a string.
  state.buckets = state.buckets.filter((b) => b.day >= cutoffDay);
  return state.buckets.length !== before;
}

function sanitize(raw: unknown): SessionState {
  const state: SessionState = { buckets: [] };
  if (!raw || typeof raw !== "object") return state;
  const list = (raw as { buckets?: unknown }).buckets;
  if (!Array.isArray(list)) return state;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (typeof b.identityKey !== "string" || !b.identityKey) continue;
    if (typeof b.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.day)) continue;
    state.buckets.push({
      identityKey: b.identityKey,
      day: b.day,
      ms: typeof b.ms === "number" && b.ms >= 0 ? b.ms : 0,
      opens: typeof b.opens === "number" && b.opens >= 0 ? b.opens : 0,
      ...(typeof b.lastPageLabel === "string" ? { lastPageLabel: b.lastPageLabel } : {}),
      ...(typeof b.fileName === "string" ? { fileName: b.fileName } : {}),
      ...(typeof b.fileExt === "string" ? { fileExt: b.fileExt } : {}),
      ...(typeof b.lastUri === "string" ? { lastUri: b.lastUri } : {}),
      updatedAt: typeof b.updatedAt === "number" ? b.updatedAt : 0,
    });
  }
  return state;
}

async function load(): Promise<SessionState> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    let state: SessionState;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      state = raw ? sanitize(JSON.parse(raw)) : { buckets: [] };
    } catch (e) {
      console.warn("[ReadingSessions] load error:", e);
      state = { buckets: [] };
    }
    // Prune on load — this is the only place the window is enforced.
    if (prune(state)) scheduleWrite();
    cache = state;
    return state;
  })();

  return loadPromise;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 400;

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    void flushReadingSessions();
  }, WRITE_DEBOUNCE_MS);
}

/** Force the pending write out now. Called on blur / background. Never throws. */
export async function flushReadingSessions(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!cache) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("[ReadingSessions] persist error:", e);
  }
}

function bucketFor(
  state: SessionState,
  identityKey: string,
  day: string,
): ReadingDayBucket {
  let bucket = state.buckets.find(
    (b) => b.identityKey === identityKey && b.day === day,
  );
  if (!bucket) {
    bucket = { identityKey, day, ms: 0, opens: 0, updatedAt: Date.now() };
    state.buckets.push(bucket);
  }
  return bucket;
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

interface ActiveSession {
  identityKey: string;
  fileName: string;
  fileExt: string;
  uri: string;
  lastPageLabel?: string;
}

let active: ActiveSession | null = null;

/**
 * Begin a reading session. Counts one open for today's bucket. Ending a
 * previous session first, so a session is never left dangling by a
 * reader-to-reader navigation.
 */
export async function startSession(
  identity: Pick<FileIdentity, "key" | "name" | "ext" | "uri">,
): Promise<void> {
  if (!identity?.key) return;
  if (active && active.identityKey !== identity.key) await endSession();

  active = {
    identityKey: identity.key,
    fileName: identity.name,
    fileExt: identity.ext,
    uri: identity.uri,
  };

  const state = await load();
  const bucket = bucketFor(state, identity.key, localDayKey());
  bucket.opens += 1;
  bucket.fileName = identity.name;
  bucket.fileExt = identity.ext;
  bucket.lastUri = identity.uri;
  bucket.updatedAt = Date.now();
  scheduleWrite();
  notify();
}

/**
 * Credit reading time to the CURRENT local day for the active session.
 *
 * `ms` is capped the same way workspaceInsightsService.bumpReadingTime caps
 * it, so the two counters can never diverge on a single call.
 */
export async function creditTime(ms: number, pageLabel?: string): Promise<void> {
  // Captured BEFORE the await. Closing a reader credits the final partial
  // interval and then ends the session in the same tick, so `active` is very
  // often null by the time load() resolves — and that last slice of time
  // still belongs to the session that earned it.
  const session = active;
  if (!session) return;
  if (!Number.isFinite(ms) || ms <= 0) return;
  const capped = Math.min(ms, 5 * 60 * 1000);

  const state = await load();
  // localDayKey() is evaluated per credit, so a session running across local
  // midnight splits into two buckets rather than crediting the wrong day.
  const bucket = bucketFor(state, session.identityKey, localDayKey());
  bucket.ms += capped;
  bucket.opens = bucket.opens || 1;
  bucket.fileName = session.fileName;
  bucket.fileExt = session.fileExt;
  bucket.lastUri = session.uri;
  if (pageLabel) {
    bucket.lastPageLabel = pageLabel;
    session.lastPageLabel = pageLabel;
  }
  bucket.updatedAt = Date.now();
  scheduleWrite();
  notify();
}

/** Record where the reader is, without crediting time. */
export function noteLocation(pageLabel: string): void {
  if (active && pageLabel) active.lastPageLabel = pageLabel;
}

/** End the active session and FLUSH. Called on blur, unmount and background. */
export async function endSession(): Promise<void> {
  if (!active) return;
  const finished = active;
  active = null;
  if (finished.lastPageLabel) {
    const state = await load();
    const bucket = bucketFor(state, finished.identityKey, localDayKey());
    bucket.lastPageLabel = finished.lastPageLabel;
  }
  await flushReadingSessions();
  notify();
}

/** The session currently being credited, if any. */
export function getActiveSessionKey(): string | null {
  return active?.identityKey ?? null;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Every file's time for one local day. */
export async function getDayTotals(
  day: string = localDayKey(),
): Promise<ReadingDayBucket[]> {
  const state = await load();
  return state.buckets
    .filter((b) => b.day === day)
    .sort((a, b) => b.ms - a.ms)
    .map((b) => ({ ...b }));
}

export interface FileTotals {
  identityKey: string;
  totalMs: number;
  days: number;
  lastDay: string | null;
  lastPageLabel?: string;
  fileName?: string;
  lastUri?: string;
  updatedAt: number;
}

/** One file's totals across the retained window. */
export async function getFileTotals(identityKey: string): Promise<FileTotals> {
  const state = await load();
  const rows = state.buckets.filter((b) => b.identityKey === identityKey);
  const totals: FileTotals = {
    identityKey,
    totalMs: 0,
    days: rows.length,
    lastDay: null,
    updatedAt: 0,
  };
  for (const r of rows) {
    totals.totalMs += r.ms;
    if (!totals.lastDay || r.day > totals.lastDay) {
      totals.lastDay = r.day;
      if (r.lastPageLabel) totals.lastPageLabel = r.lastPageLabel;
    }
    if (r.fileName) totals.fileName = r.fileName;
    if (r.lastUri) totals.lastUri = r.lastUri;
    if (r.updatedAt > totals.updatedAt) totals.updatedAt = r.updatedAt;
  }
  return totals;
}

/** Grand total across every file and day in the window. */
export async function getWindowTotalMs(): Promise<number> {
  const state = await load();
  return state.buckets.reduce((sum, b) => sum + b.ms, 0);
}

export interface ResumeCandidate {
  identityKey: string;
  fileName: string;
  fileExt: string;
  /** A URI that resolves right now — the card never offers a dead file. */
  uri: string;
  /** Time spent on `day`, in ms. */
  ms: number;
  /** The local day the time was spent. */
  day: string;
  lastPageLabel?: string;
  /** 0..1 reading progress from readingProgressService. */
  progress: number;
  currentPage?: number;
  totalPages?: number;
  lastReadAt: number;
}

/**
 * The best "continue reading" candidate, or null.
 *
 * Exclusions, all deliberate:
 *   • progress >= BOOK_DONE — finished books are not resumed. BOOK_DONE is
 *     imported from workspaceInsightsService rather than re-declared, so this
 *     card and the Progress dashboard can never disagree about what "finished"
 *     means.
 *   • sessions under MIN_RESUMABLE_MS — two minutes of reading is not a
 *     session worth advertising.
 *   • anything whose file no longer resolves — the card must never offer to
 *     open something that is gone.
 */
export async function getResumeCandidate(): Promise<ResumeCandidate | null> {
  const [state, progressMap] = await Promise.all([
    load(),
    getAllReadingProgress().catch(
      () => ({}) as Record<string, ReadingProgressEntry>,
    ),
  ]);

  if (state.buckets.length === 0) return null;

  // Most recent day first, then most time spent that day.
  const ordered = [...state.buckets].sort(
    (a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.ms - a.ms),
  );

  for (const bucket of ordered) {
    if (bucket.ms < MIN_RESUMABLE_MS) continue;

    const uri = await resolveIdentityToLiveUri(bucket.identityKey);
    if (!uri) continue; // file is gone — never offer it

    // readingProgressService is keyed by URI; the live URI is the one the
    // viewers write under, so this is the entry they will restore from.
    const entry = progressMap[uri] ?? findProgressByName(progressMap, bucket);
    const progress = entry?.progress ?? 0;
    if (progress >= BOOK_DONE) continue; // finished

    return {
      identityKey: bucket.identityKey,
      fileName: bucket.fileName || "your book",
      fileExt: bucket.fileExt || "",
      uri,
      ms: bucket.ms,
      day: bucket.day,
      ...(bucket.lastPageLabel ? { lastPageLabel: bucket.lastPageLabel } : {}),
      progress,
      ...(typeof entry?.currentPage === "number" ? { currentPage: entry.currentPage } : {}),
      ...(typeof entry?.totalPages === "number" ? { totalPages: entry.totalPages } : {}),
      lastReadAt: entry?.lastReadAt ?? bucket.updatedAt,
    };
  }

  return null;
}

/**
 * A file read under one URI and re-downloaded to another has its progress
 * under the OLD key. Fall back to the most recent progress entry whose URI
 * ends in the same file name, so resuming still lands on the right page.
 */
function findProgressByName(
  progressMap: Record<string, ReadingProgressEntry>,
  bucket: ReadingDayBucket,
): ReadingProgressEntry | undefined {
  const name = (bucket.fileName || "").toLowerCase();
  if (!name) return undefined;
  let best: ReadingProgressEntry | undefined;
  for (const [uri, entry] of Object.entries(progressMap)) {
    if (!decodeSafe(uri).toLowerCase().endsWith(name)) continue;
    if (!best || entry.lastReadAt > best.lastReadAt) best = entry;
  }
  return best;
}

function decodeSafe(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

/** Eagerly populate the cache (and prune). Safe from app startup. */
export async function preloadReadingSessions(): Promise<void> {
  await load();
}

/** Test-only: reset module state. */
export function __resetReadingSessionsForTests(): void {
  cache = null;
  loadPromise = null;
  active = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  listeners.clear();
}
