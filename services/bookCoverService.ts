/**
 * bookCoverService.ts
 * Resolves cover art for readable documents, lazily and off the main path.
 *
 * A shelf is cover art plus progress, so this has to be cheap enough to run
 * while a list of two hundred books is scrolling. Three rules follow from
 * that:
 *
 *  - **Covers are cached as files, never held as data URIs.** Two hundred
 *    base64 covers in memory is tens of megabytes and an eventual crash; two
 *    hundred file paths is nothing, and expo-image handles its own caching
 *    from there.
 *  - **Work happens once per book, ever.** The extracted image is written to
 *    the cache directory under a hash of the file URI, so the second launch
 *    is a directory lookup.
 *  - **Failure is ordinary.** A book with no cover, a file that has been
 *    moved, an archive that will not open — all resolve to null, and the
 *    caller draws a generated placeholder. Nothing here can stop a book
 *    opening.
 *
 * ## PDF covers
 *
 * There is no page-1 thumbnail for PDFs. services/pdfThumbnailService.ts
 * looks like it provides one, but generateThumbnails() is a stub that writes
 * a 1×1 grey JPEG — its own comments say actual extraction needs a native
 * renderer. Stretching that across a cover card would look worse than a
 * designed placeholder, so PDFs get the placeholder until a real renderer
 * exists. See resolveCover() for where that would slot in.
 */

import * as FileSystem from "expo-file-system/legacy";

import { extractEpubCover } from "@/src/utils/epubExtractor";

// ---------------------------------------------------------------------------
// Cache location
// ---------------------------------------------------------------------------

const COVER_DIR = `${FileSystem.cacheDirectory}book-covers/`;

let dirReady: Promise<void> | null = null;

async function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = (async () => {
      const info = await FileSystem.getInfoAsync(COVER_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(COVER_DIR, { intermediates: true });
      }
    })().catch(() => {
      // Retry on the next call rather than caching the failure.
      dirReady = null;
    });
  }
  return dirReady;
}

/**
 * Stable, filesystem-safe key for a file URI.
 *
 * A simple string hash: this only has to avoid collisions inside one device's
 * cache, and a collision costs a wrong thumbnail, not data loss.
 */
export function coverKey(uri: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < uri.length; i++) {
    const c = uri.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return `${a}${b}`;
}

function extensionFor(mediaType: string): string {
  if (mediaType.includes("png")) return "png";
  if (mediaType.includes("gif")) return "gif";
  if (mediaType.includes("webp")) return "webp";
  return "jpg";
}

// ---------------------------------------------------------------------------
// In-memory index
// ---------------------------------------------------------------------------

/** uri → local cover file URI, or null once we know there is none. */
const resolved = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
let listeners: (() => void)[] = [];

function notify(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to cover resolution. Returns an unsubscribe function. */
export function subscribeCovers(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/**
 * The cover for a file if it is already known, without doing any work.
 *
 * Renderers call this: returning undefined means "not looked up yet", null
 * means "looked up, there is none", and a string is the file URI.
 */
export function getCoverSync(uri: string): string | null | undefined {
  return resolved.get(uri);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

async function findCached(key: string): Promise<string | null> {
  for (const ext of ["jpg", "png", "gif", "webp"]) {
    const path = `${COVER_DIR}${key}.${ext}`;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return path;
  }
  return null;
}

async function resolveCover(
  uri: string,
  extension: string,
): Promise<string | null> {
  await ensureDir();

  const key = coverKey(uri);
  const cached = await findCached(key);
  if (cached) return cached;

  if (extension === "epub") {
    const cover = await extractEpubCover(uri);
    if (!cover) return null;

    const path = `${COVER_DIR}${key}.${extensionFor(cover.mediaType)}`;
    await FileSystem.writeAsStringAsync(path, cover.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  }

  // PDF page-1 rendering would go here, once something can actually render a
  // page. Until then PDFs and DOCX fall through to the generated placeholder.
  return null;
}

/**
 * Resolve and cache the cover for a file.
 *
 * Safe to call repeatedly and concurrently for the same file: work is shared
 * and the answer is remembered either way.
 */
export async function loadCover(
  uri: string,
  extension: string,
): Promise<string | null> {
  if (resolved.has(uri)) return resolved.get(uri) ?? null;

  const existing = inflight.get(uri);
  if (existing) return existing;

  const task = (async () => {
    let result: string | null = null;
    try {
      result = await resolveCover(uri, extension.toLowerCase());
    } catch {
      result = null;
    }
    resolved.set(uri, result);
    inflight.delete(uri);
    notify();
    return result;
  })();

  inflight.set(uri, task);
  return task;
}

/** Forget a file's cover — used when a book is removed from the shelf. */
export async function clearCover(uri: string): Promise<void> {
  resolved.delete(uri);
  try {
    const path = await findCached(coverKey(uri));
    if (path) await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // A cover that will not delete is a stale cache entry, not a failure.
  }
  notify();
}

// ---------------------------------------------------------------------------
// Generated placeholders
// ---------------------------------------------------------------------------

/**
 * A palette deep enough for white text to sit on comfortably, so a
 * placeholder never depends on knowing the app's theme.
 */
const PLACEHOLDER_TINTS = [
  "#4F46E5",
  "#0F766E",
  "#B45309",
  "#9D174D",
  "#1D4ED8",
  "#4D7C0F",
  "#7C3AED",
  "#B91C1C",
  "#0E7490",
  "#A16207",
];

/**
 * Pick a tint for a book.
 *
 * Derived from the title so it is stable across launches — a shelf whose
 * colours reshuffle every time it loads reads as broken, and the colour is
 * part of how someone recognises a book at a glance.
 */
export function placeholderTint(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (Math.imul(hash, 31) + title.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_TINTS[Math.abs(hash) % PLACEHOLDER_TINTS.length];
}

/** Up to two initials for the placeholder card. */
export function placeholderInitials(title: string): string {
  const words = title
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[\s_\-–—]+/)
    .filter((w) => /[a-z0-9]/i.test(w));

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
