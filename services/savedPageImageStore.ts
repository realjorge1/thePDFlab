// ============================================
// Saved Pages — page images
// ---------------------------------------------
// The picture of a bookmarked page: storage, write path and cleanup.
//
// WHERE THE FILES LIVE
//   FileSystem.documentDirectory + "saved-pages/". NEVER cacheDirectory: the
//   OS evicts it whenever it likes, and a saved page whose picture silently
//   disappears breaks the one promise this feature makes. This is also why
//   services/pdfThumbnailService.ts is NOT reused here — besides caching into
//   cacheDirectory, it is a stub that writes 1x1 gray placeholder JPEGs.
//
// WHERE THE PIXELS COME FROM (and why not from here)
//   Capture is NOT in this module, because the thing that can rasterise a page
//   is a mounted pdf.js WebView and the reader already has one. PDF page images
//   are produced by components/DocumentViewer/PDFTextExtractor.tsx on the same
//   pass that fetches the page text (see its `imagePage` prop), and handed to
//   writeSavedPageImage() below by app/pdf-viewer.tsx. One document load gives
//   the bookmark both its text and its picture.
//
//   A PREVIOUS VERSION OF THIS FILE said capture was blocked until the pdf.js
//   host page streamed the PDF by URL rather than inlining it as base64. That
//   was correct at the time and is no longer true: services/documentReflowService
//   .ts → DOC_BYTES_LOADER_JS / buildDocumentSourceLiteral already deliver the
//   bytes without inlining (Android XHRs the file:// URI; iOS keeps the inline
//   path WKWebView handles well), and the extraction host page now uses them.
//   Rasterising one page costs a single bitmap on top of a load that was
//   happening anyway. None of this touches ENABLE_INPLACE_PDF_SELECTION, which
//   is about keeping a whole book's text layer live in the VISIBLE viewer.
//
//   Reflow formats (DOCX, EPUB) have no rasteriser — there is no native view
//   capture in this app — so they store the visible region's HTML instead, via
//   services/savedPageSnapshotStore.ts. Both are "the page as it looked".
//
// Nothing here throws. A picture is the best version of a bookmark, not a
// precondition for one.
// ============================================
import * as FileSystem from "expo-file-system/legacy";

import type { SavedPage } from "@/services/savedPagesTypes";

/** Images live in documentDirectory — never cacheDirectory (the OS evicts it). */
export const SAVED_PAGES_IMAGE_DIR = `${FileSystem.documentDirectory}saved-pages/`;

/** Budget: roughly 100 MB and 500 images. */
export const IMAGE_BUDGET_BYTES = 100 * 1024 * 1024;
export const IMAGE_BUDGET_COUNT = 500;
/** JPEG quality and longest edge for a downscaled page image. */
export const IMAGE_QUALITY = 0.7;
export const IMAGE_MAX_EDGE = 1200;

let dirReady = false;

/** Create the image directory once. Never throws. */
async function ensureDir(): Promise<boolean> {
  if (dirReady) return true;
  try {
    const info = await FileSystem.getInfoAsync(SAVED_PAGES_IMAGE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(SAVED_PAGES_IMAGE_DIR, {
        intermediates: true,
      });
    }
    dirReady = true;
    return true;
  } catch {
    return false;
  }
}

/** Absolute path for a saved page's image. */
export function imagePathFor(savedPageId: string): string {
  return `${SAVED_PAGES_IMAGE_DIR}${savedPageId}.jpg`;
}

/**
 * Write an already-encoded JPEG (base64, no data: prefix) for a saved page.
 * Returns the path written, or null on any failure. Never throws.
 */
export async function writeSavedPageImage(
  savedPageId: string,
  base64Jpeg: string,
): Promise<string | null> {
  if (!savedPageId || !base64Jpeg) return null;
  if (!(await ensureDir())) return null;
  const path = imagePathFor(savedPageId);
  try {
    await FileSystem.writeAsStringAsync(path, base64Jpeg, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  } catch {
    return null;
  }
}

/**
 * Delete a saved page's image. Called by removeSavedPage so a removed record
 * never leaves an orphaned file behind. Never throws; a missing file is fine.
 */
export async function deleteSavedPageImage(
  pathOrId: string | undefined | null,
): Promise<void> {
  if (!pathOrId) return;
  const path = pathOrId.startsWith("file:") ? pathOrId : imagePathFor(pathOrId);
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Already gone, or unwritable — nothing to do either way.
  }
}

/**
 * Delete image files with no surviving record, and report the bytes in use.
 * Safe to call at any time; it only ever removes files this module wrote.
 */
export async function pruneOrphanedImages(
  liveRecords: SavedPage[],
): Promise<{ removed: number; bytes: number }> {
  if (!(await ensureDir())) return { removed: 0, bytes: 0 };

  const live = new Set(
    liveRecords
      .map((r) => r.thumbPath)
      .filter((p): p is string => typeof p === "string" && !!p)
      .map((p) => p.split("/").pop() || p),
  );

  let removed = 0;
  let bytes = 0;
  try {
    const names = await FileSystem.readDirectoryAsync(SAVED_PAGES_IMAGE_DIR);
    for (const name of names) {
      const path = `${SAVED_PAGES_IMAGE_DIR}${name}`;
      if (live.has(name)) {
        try {
          const info = (await FileSystem.getInfoAsync(path)) as { size?: number };
          if (typeof info.size === "number") bytes += info.size;
        } catch {
          // Size unknown — it just doesn't count toward the budget reading.
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

/**
 * True when the store is at or over its image budget. Callers use it to stop
 * REQUESTING new page images; it never deletes a user's picture to make room,
 * for the same reason the record cap refuses rather than evicts.
 */
export async function isOverImageBudget(
  liveRecords: SavedPage[],
): Promise<boolean> {
  const withImages = liveRecords.filter((r) => r.thumbPath).length;
  if (withImages >= IMAGE_BUDGET_COUNT) return true;
  const { bytes } = await pruneOrphanedImages(liveRecords);
  return bytes >= IMAGE_BUDGET_BYTES;
}

