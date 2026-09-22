// ============================================
// Saved Pages — page snapshots (the page itself, kept)
// ---------------------------------------------
// A bookmark is supposed to be A PAGE, not a pointer into a file. The excerpt
// on the record is a 600-char PREVIEW for the list; it is not the page. This
// module stores the page itself: the full text of the one page that was
// bookmarked, written at save time, readable forever after — after the file is
// deleted from the app, after it is deleted from the device, offline.
//
// WHY A FILE AND NOT THE RECORD
//   The index in savedPagesService is ONE AsyncStorage blob, parsed whole on
//   every cold start. A page of prose is 2-6 KB; 500 of them would turn a
//   ~100 KB index into a multi-megabyte JSON parse on the first frame of the
//   Bookmarks screen. So the index keeps a path and a length, and the body
//   lives in its own file, read only when a page is actually opened.
//
// WHERE THE FILES LIVE
//   documentDirectory + "saved-pages/text/" — a sibling of the image dir in
//   services/savedPageImageStore.ts, for the same reason spelled out there:
//   NEVER cacheDirectory, because the OS evicts it whenever it likes and a
//   bookmark whose page silently vanished breaks the one promise this feature
//   makes.
//
// TWO KINDS OF SNAPSHOT live here, both per saved page:
//   <id>.txt   the page's text — always written when capture succeeds. It is
//              what search, copy, share and Read Aloud use, and the fallback
//              when nothing richer exists.
//   <id>.html  the page's MARKUP, for reflow formats (DOCX, EPUB) that have
//              no rasteriser. Re-rendered on /saved-page, it brings back the
//              fonts, tables, lists and inline images that text cannot.
// PDFs get a picture instead, from services/savedPageImageStore.ts — the
// three are ranked picture > markup > text when a saved page is shown.
//
// Nothing here throws. A snapshot is the best version of a bookmark, not a
// precondition for one: when a write fails the record still exists and still
// renders from its excerpt.
// ============================================

import * as FileSystem from "expo-file-system/legacy";

import { SNAPSHOT_MAX } from "@/services/savedPagesTypes";
import type { SavedPage } from "@/services/savedPagesTypes";
import { HTML_SNAPSHOT_MAX } from "@/utils/pageHtmlCapture";

/** Snapshots live in documentDirectory — never cacheDirectory (OS evicts it). */
export const SAVED_PAGES_TEXT_DIR = `${FileSystem.documentDirectory}saved-pages/text/`;

let dirReady = false;

/** Create the snapshot directory once. Never throws. */
async function ensureDir(): Promise<boolean> {
  if (dirReady) return true;
  try {
    const info = await FileSystem.getInfoAsync(SAVED_PAGES_TEXT_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(SAVED_PAGES_TEXT_DIR, {
        intermediates: true,
      });
    }
    dirReady = true;
    return true;
  } catch {
    return false;
  }
}

/** Absolute path for a saved page's text snapshot. */
export function snapshotPathFor(savedPageId: string): string {
  return `${SAVED_PAGES_TEXT_DIR}${savedPageId}.txt`;
}

/** Absolute path for a saved page's markup snapshot. */
export function htmlSnapshotPathFor(savedPageId: string): string {
  return `${SAVED_PAGES_TEXT_DIR}${savedPageId}.html`;
}

/**
 * Normalize captured page text for storage and re-display.
 *
 * Paragraph structure is the difference between a page and a wall of words, so
 * blank lines are PRESERVED (collapsed to exactly one) while runs of spaces and
 * stray carriage returns are cleaned up.
 */
export function normalizePageText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, SNAPSHOT_MAX);
}

/**
 * Write the page text for a saved page. Returns `{ path, chars }` on success
 * and null on any failure (including empty text — an empty file is worse than
 * no file, because it reads as "this page was blank").
 */
export async function writeSnapshot(
  savedPageId: string,
  text: string,
): Promise<{ path: string; chars: number } | null> {
  if (!savedPageId) return null;
  const clean = normalizePageText(text);
  if (!clean) return null;
  if (!(await ensureDir())) return null;
  const path = snapshotPathFor(savedPageId);
  try {
    await FileSystem.writeAsStringAsync(path, clean);
    return { path, chars: clean.length };
  } catch {
    return null;
  }
}

/**
 * Read a snapshot back. Accepts either a stored path or a saved page id, so a
 * record written before this field existed can still be probed by id.
 * Returns null when there is nothing to read.
 */
export async function readSnapshot(
  pathOrId: string | undefined | null,
): Promise<string | null> {
  if (!pathOrId) return null;
  const path = pathOrId.startsWith("file:") ? pathOrId : snapshotPathFor(pathOrId);
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const text = await FileSystem.readAsStringAsync(path);
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Write the page MARKUP for a saved page. Returns the path on success, null
 * on any failure — including empty markup, which is indistinguishable from
 * 'this page was blank' once stored.
 */
export async function writeHtmlSnapshot(
  savedPageId: string,
  html: string,
): Promise<string | null> {
  if (!savedPageId) return null;
  const clean = (html || "").trim().slice(0, HTML_SNAPSHOT_MAX);
  if (!clean) return null;
  if (!(await ensureDir())) return null;
  const path = htmlSnapshotPathFor(savedPageId);
  try {
    await FileSystem.writeAsStringAsync(path, clean);
    return path;
  } catch {
    return null;
  }
}

/** Read a markup snapshot back. Null when there is none. */
export async function readHtmlSnapshot(
  pathOrId: string | undefined | null,
): Promise<string | null> {
  if (!pathOrId) return null;
  const path = pathOrId.startsWith("file:")
    ? pathOrId
    : htmlSnapshotPathFor(pathOrId);
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const html = await FileSystem.readAsStringAsync(path);
    return html || null;
  } catch {
    return null;
  }
}

/**
 * Delete a snapshot. Called when the record is removed, so a deleted bookmark
 * never leaves its page behind on disk. A missing file is fine.
 */
export async function deleteSnapshot(
  pathOrId: string | undefined | null,
): Promise<void> {
  if (!pathOrId) return;
  const path = pathOrId.startsWith("file:") ? pathOrId : snapshotPathFor(pathOrId);
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Already gone, or unwritable — nothing to do either way.
  }
}

/**
 * Delete snapshot files with no surviving record, and report the bytes in use.
 * Only ever removes files this module wrote.
 */
export async function pruneOrphanedSnapshots(
  liveRecords: SavedPage[],
): Promise<{ removed: number; bytes: number }> {
  if (!(await ensureDir())) return { removed: 0, bytes: 0 };

  const live = new Set(
    liveRecords
      .flatMap((r) => [r.snapshotPath, r.htmlPath])
      .filter((p): p is string => typeof p === "string" && !!p)
      .map((p) => p.split("/").pop() || p),
  );

  let removed = 0;
  let bytes = 0;
  try {
    const names = await FileSystem.readDirectoryAsync(SAVED_PAGES_TEXT_DIR);
    for (const name of names) {
      const path = `${SAVED_PAGES_TEXT_DIR}${name}`;
      if (live.has(name)) {
        try {
          const info = (await FileSystem.getInfoAsync(path)) as { size?: number };
          if (typeof info.size === "number") bytes += info.size;
        } catch {
          // Size unknown — it just doesn't count toward the reading.
        }
        continue;
      }
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
        removed += 1;
      } catch {
        // Leave it; the next prune will try again.
      }
    }
  } catch {
    return { removed, bytes };
  }
  return { removed, bytes };
}

/** Test-only: forget that the directory was created. */
export function __resetSnapshotStoreForTests(): void {
  dirReady = false;
}
