// ============================================
// Saved Pages Service
// ---------------------------------------------
// A reader hits an important page and screenshots it. This replaces the
// screenshot: the page is saved, browsable as a PAGE rather than as a file,
// ranked by how often the reader returns to it — and it keeps working after
// the source file is deleted from the app AND from the device.
//
// SHAPE: modelled on services/readingProgressService.ts (in-memory cache +
// 400 ms debounced write + pub/sub), NOT on services/viewerStorageService.ts.
// viewerStorageService keys per file (`@viewer_highlights_<uri>`), which is
// exactly wrong here: a per-URI key dies with the URI, and these records are
// supposed to outlive the file. One flat array under one key instead.
//
// DENORMALIZED BY DESIGN: every displayable field is copied into the record at
// save time. Rendering the list touches no file, no file index and no network.
//
// THE PAGE ITSELF lives beside the record, not in it: the full text of the
// bookmarked page goes to services/savedPageSnapshotStore.ts as one small file,
// and the record keeps its path. That is what makes a bookmark a PAGE rather
// than a pointer — /saved-page renders the snapshot and never opens the source
// file. `excerpt` stays what it always was: the preview shown in the list.
//
// RETENTION: at most SAVED_PAGES_MAX records. At the cap a save is REFUSED
// with a clear message — never silently evicted. That is the opposite of the
// policy for caches, and deliberately so: these are the user's own data.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";

import { deleteSavedPageImage } from "@/services/savedPageImageStore";
import {
  deleteSnapshot,
  htmlSnapshotPathFor,
  readHtmlSnapshot,
  readSnapshot,
  writeHtmlSnapshot,
  writeSnapshot,
} from "@/services/savedPageSnapshotStore";
import {
  comparatorFor,
  groupSavedPages,
  type SavedPageGroup,
  type SavedPagesSort,
} from "@/services/savedPagesRanking";
import {
  EXCERPT_MAX,
  NOTE_MAX,
  SAVED_PAGES_MAX,
  type SavedPage,
  type SavedPageLocatorType,
} from "@/services/savedPagesTypes";

export type {
  SavedPage,
  SavedPageLocatorType,
} from "@/services/savedPagesTypes";
export {
  EXCERPT_MAX,
  NOTE_MAX,
  SAVED_PAGES_MAX,
  SNAPSHOT_MAX,
  locatorTypeForExt,
  savedPageLocationLabel,
} from "@/services/savedPagesTypes";
export type { SavedPageGroup, SavedPagesSort } from "@/services/savedPagesRanking";

const STORAGE_KEY = "@wordsinscribed/saved_pages_v1";

let memoryCache: SavedPage[] | null = null;
let loadPromise: Promise<SavedPage[]> | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.warn("[SavedPages] listener error:", e);
    }
  }
}

/** Keep only well-formed records; a corrupt blob must not break the screen. */
function sanitize(raw: unknown): SavedPage[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.identityKey !== "string" || !r.identityKey) continue;
    out.push({
      id: r.id,
      identityKey: r.identityKey,
      fileName: typeof r.fileName === "string" ? r.fileName : "Document",
      fileExt: typeof r.fileExt === "string" ? r.fileExt : "",
      fileUriAtSave: typeof r.fileUriAtSave === "string" ? r.fileUriAtSave : "",
      locatorType: isLocator(r.locatorType) ? r.locatorType : "page",
      ...(typeof r.page === "number" ? { page: r.page } : {}),
      ...(typeof r.totalPages === "number" ? { totalPages: r.totalPages } : {}),
      ...(typeof r.cfi === "string" ? { cfi: r.cfi } : {}),
      ...(typeof r.scrollPct === "number" ? { scrollPct: r.scrollPct } : {}),
      ...(typeof r.chapterLabel === "string" ? { chapterLabel: r.chapterLabel } : {}),
      excerpt: typeof r.excerpt === "string" ? r.excerpt : "",
      ...(typeof r.note === "string" ? { note: r.note } : {}),
      ...(typeof r.snapshotPath === "string" ? { snapshotPath: r.snapshotPath } : {}),
      ...(typeof r.snapshotChars === "number" ? { snapshotChars: r.snapshotChars } : {}),
      ...(typeof r.htmlPath === "string" ? { htmlPath: r.htmlPath } : {}),
      ...(typeof r.htmlCss === "string" ? { htmlCss: r.htmlCss } : {}),
      ...(typeof r.thumbPath === "string" ? { thumbPath: r.thumbPath } : {}),
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
      openCount: typeof r.openCount === "number" ? r.openCount : 0,
      lastOpenedAt: typeof r.lastOpenedAt === "number" ? r.lastOpenedAt : null,
    });
  }
  return out;
}

function isLocator(v: unknown): v is SavedPageLocatorType {
  return (
    v === "page" || v === "slide" || v === "sheet" || v === "chapter" || v === "section"
  );
}

async function loadAll(): Promise<SavedPage[]> {
  if (memoryCache) return memoryCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      memoryCache = raw ? sanitize(JSON.parse(raw)) : [];
    } catch (e) {
      console.warn("[SavedPages] load error:", e);
      memoryCache = [];
    }
    return memoryCache!;
  })();

  return loadPromise;
}

// Coalesce writes — a save is immediately followed by an async excerpt fill.
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 400;

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    void flushSavedPages();
  }, WRITE_DEBOUNCE_MS);
}

/** Force the pending write out now (app backgrounding, tests). Never throws. */
export async function flushSavedPages(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!memoryCache) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache));
  } catch (e) {
    console.warn("[SavedPages] persist error:", e);
  }
}

function newId(): string {
  // Short, collision-resistant enough for a 500-record local list, and
  // dependency-free (uuid is a dependency but this avoids a native/crypto
  // path in a hot save).
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clip(text: string | undefined, max: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SavePageInput {
  identityKey: string;
  fileName: string;
  fileExt: string;
  fileUriAtSave: string;
  locatorType: SavedPageLocatorType;
  page?: number;
  totalPages?: number;
  cfi?: string;
  scrollPct?: number;
  chapterLabel?: string;
  excerpt?: string;
  note?: string;
}

export type SavePageResult =
  | { ok: true; page: SavedPage }
  | { ok: false; reason: "cap"; message: string }
  | { ok: false; reason: "invalid"; message: string };

/**
 * Save a page. Returns immediately with whatever was captured — the caller
 * fills the excerpt in afterwards via updateExcerpt() if it had to go and
 * fetch it. A save is never blocked on excerpt capture.
 */
export async function savePage(input: SavePageInput): Promise<SavePageResult> {
  if (!input?.identityKey) {
    return { ok: false, reason: "invalid", message: "Could not identify this file." };
  }

  const all = await loadAll();

  if (all.length >= SAVED_PAGES_MAX) {
    // Refuse rather than evict: a saved page is user data, not cache.
    return {
      ok: false,
      reason: "cap",
      message: `You have reached the limit of ${SAVED_PAGES_MAX} bookmarks. Remove a few to add more.`,
    };
  }

  const page: SavedPage = {
    id: newId(),
    identityKey: input.identityKey,
    fileName: input.fileName || "Document",
    fileExt: (input.fileExt || "").toLowerCase(),
    fileUriAtSave: input.fileUriAtSave || "",
    locatorType: input.locatorType,
    ...(typeof input.page === "number" ? { page: input.page } : {}),
    ...(typeof input.totalPages === "number" ? { totalPages: input.totalPages } : {}),
    ...(input.cfi ? { cfi: input.cfi } : {}),
    ...(typeof input.scrollPct === "number" ? { scrollPct: input.scrollPct } : {}),
    ...(input.chapterLabel ? { chapterLabel: input.chapterLabel } : {}),
    excerpt: clip(input.excerpt, EXCERPT_MAX),
    ...(input.note ? { note: clip(input.note, NOTE_MAX) } : {}),
    createdAt: Date.now(),
    openCount: 0,
    lastOpenedAt: null,
  };

  all.push(page);
  scheduleWrite();
  notify();
  return { ok: true, page };
}

/** All saved pages, sorted. Default "frequent" — the blend, not raw opens. */
export async function getSavedPages(
  sort: SavedPagesSort = "frequent",
): Promise<SavedPage[]> {
  const all = await loadAll();
  return [...all].sort(comparatorFor(sort));
}

/** Saved pages grouped by file, groups ordered by the same sort. */
export async function getSavedPageGroups(
  sort: SavedPagesSort = "frequent",
): Promise<SavedPageGroup[]> {
  const all = await loadAll();
  return groupSavedPages(all, sort);
}

/** Synchronous accessor — null until the cache is loaded. */
export function getSavedPagesSync(): SavedPage[] | null {
  return memoryCache ? [...memoryCache] : null;
}

export async function getSavedPage(id: string): Promise<SavedPage | null> {
  const all = await loadAll();
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Is this exact location already saved? Drives the menu item's
 * "Saved ✓ / Remove saved page" toggle.
 */
export async function findSavedPageAt(where: {
  identityKey: string;
  locatorType: SavedPageLocatorType;
  page?: number;
  cfi?: string;
  scrollPct?: number;
}): Promise<SavedPage | null> {
  const all = await loadAll();
  return (
    all.find((p) => {
      if (p.identityKey !== where.identityKey) return false;
      if (p.locatorType !== where.locatorType) return false;
      if (typeof where.page === "number") return p.page === where.page;
      if (where.cfi) return p.cfi === where.cfi;
      if (typeof where.scrollPct === "number" && typeof p.scrollPct === "number") {
        // Scroll positions are never byte-identical; 2% is "the same place".
        return Math.abs(p.scrollPct - where.scrollPct) <= 2;
      }
      return false;
    }) ?? null
  );
}

/** Replace the user's note. Pass "" to clear it. */
export async function updateNote(id: string, note: string): Promise<boolean> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return false;
  const clipped = clip(note, NOTE_MAX);
  if (clipped) page.note = clipped;
  else delete page.note;
  scheduleWrite();
  notify();
  return true;
}

/**
 * Fill in an excerpt that arrived after the save (PDF text extraction, a
 * WebView round-trip). Subscribers are notified so the list updates in place.
 */
export async function updateExcerpt(id: string, excerpt: string): Promise<boolean> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return false;
  const clipped = clip(excerpt, EXCERPT_MAX);
  if (!clipped || clipped === page.excerpt) return false;
  page.excerpt = clipped;
  scheduleWrite();
  notify();
  return true;
}

/**
 * Store the FULL text of the bookmarked page and point the record at it.
 *
 * Called right after the save, on the same capture the excerpt comes from, so
 * one WebView round-trip serves both. Returns false when there was nothing to
 * store or the write failed — a bookmark without a snapshot is degraded, never
 * broken: it still renders from its excerpt.
 */
export async function updateSnapshot(id: string, text: string): Promise<boolean> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return false;
  const written = await writeSnapshot(id, text);
  if (!written) return false;
  page.snapshotPath = written.path;
  page.snapshotChars = written.chars;
  scheduleWrite();
  notify();
  return true;
}

/**
 * The text to SHOW for a saved page: the stored page, or the excerpt when a
 * record has no snapshot (saved before snapshots existed, or capture failed).
 *
 * Reads no source file and needs no network, which is the whole point — this
 * answers the same after the file is deleted as it did the day it was saved.
 */
export async function getSavedPageText(
  id: string,
): Promise<{ text: string; full: boolean }> {
  const page = await getSavedPage(id);
  if (!page) return { text: "", full: false };
  const snapshot = await readSnapshot(page.snapshotPath);
  if (snapshot) return { text: snapshot, full: true };
  return { text: page.excerpt || "", full: false };
}

/**
 * Store the MARKUP of the bookmarked page (reflow formats only) and point the
 * record at it. Written from the same capture as the text, so one WebView
 * round-trip produces both.
 */
export async function updateHtmlSnapshot(
  id: string,
  html: string,
  css: string,
): Promise<boolean> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return false;
  const path = await writeHtmlSnapshot(id, html);
  if (!path) return false;
  page.htmlPath = path;
  if (css) page.htmlCss = css;
  scheduleWrite();
  notify();
  return true;
}

/**
 * The bookmarked page's markup, or null when the record has none (a PDF, or
 * a record saved before markup snapshots existed). Reads no source file.
 */
export async function getSavedPageHtml(
  id: string,
): Promise<{ html: string; css: string } | null> {
  const page = await getSavedPage(id);
  if (!page?.htmlPath) return null;
  const html = await readHtmlSnapshot(page.htmlPath);
  if (!html) return null;
  return { html, css: page.htmlCss ?? "" };
}

/** Attach a rasterised page image path. */
export async function updateThumbPath(id: string, thumbPath: string): Promise<boolean> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return false;
  page.thumbPath = thumbPath;
  scheduleWrite();
  notify();
  return true;
}

/**
 * Re-link a record to a file the user found again. Only the informational URI
 * and the identity key move; the snapshot (excerpt, note, location) is the
 * user's and is never rewritten.
 */
export async function relinkSavedPage(
  id: string,
  next: { identityKey: string; fileUriAtSave: string; fileName?: string },
): Promise<boolean> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return false;
  page.identityKey = next.identityKey || page.identityKey;
  page.fileUriAtSave = next.fileUriAtSave || page.fileUriAtSave;
  if (next.fileName) page.fileName = next.fileName;
  scheduleWrite();
  notify();
  return true;
}

/** Count a return visit. Called BEFORE navigating, so ranking updates even
 *  if the open then fails. */
export async function recordOpen(id: string): Promise<void> {
  const all = await loadAll();
  const page = all.find((p) => p.id === id);
  if (!page) return;
  page.openCount += 1;
  page.lastOpenedAt = Date.now();
  scheduleWrite();
  notify();
}

/** Remove a saved page, plus its page snapshot and phase-2 image file. */
export async function removeSavedPage(id: string): Promise<boolean> {
  const all = await loadAll();
  const index = all.findIndex((p) => p.id === id);
  if (index === -1) return false;
  const [removed] = all.splice(index, 1);
  scheduleWrite();
  notify();
  // Fire-and-forget: the record is gone either way, and a stranded file is
  // swept up by pruneOrphanedImages() / pruneOrphanedSnapshots().
  void deleteSavedPageImage(removed.thumbPath);
  void deleteSnapshot(removed.snapshotPath ?? removed.id);
  void deleteSnapshot(removed.htmlPath ?? htmlSnapshotPathFor(removed.id));
  return true;
}

/** How many saved pages exist (0 until the cache loads). */
export function savedPagesCountSync(): number {
  return memoryCache ? memoryCache.length : 0;
}

/** Eagerly populate the in-memory cache. Safe from app startup. */
export async function preloadSavedPages(): Promise<void> {
  await loadAll();
}

/** Subscribe to changes; returns an unsubscribe fn. */
export function subscribeSavedPages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: reset module state. */
export function __resetSavedPagesForTests(): void {
  memoryCache = null;
  loadPromise = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  listeners.clear();
}
