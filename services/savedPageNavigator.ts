// ============================================
// Saved Pages — opening the source FILE
// ---------------------------------------------
// This module is no longer how a bookmark is opened. Tapping a bookmark opens
// /saved-page, which renders the saved page itself from its stored snapshot —
// no file, no file index, no network, and identical whether or not the source
// still exists. A bookmark is a PAGE; jumping into the whole document at that
// page is a different (and much heavier) thing to ask for.
//
// What lives here is that other thing: the SECONDARY "Open in document"
// action offered on /saved-page when the file still resolves. It must never
// dead-end and never crash — a missing file is a normal state in this feature,
// not an error — so it reports { opened: false } and the caller simply stays
// on the saved page.
//
// The jump itself reuses the citation route params the viewers already
// understand (locatorType / locatorIndex, see services/ai/citationNavigator.ts
// and the handlers in each viewer). No second navigation path is invented.
// ============================================

import { router } from "expo-router";

import { pickFilesWithResult } from "@/services/document-manager";
import {
  getFileIdentity,
  resolveIdentityToLiveUri,
} from "@/services/fileIdentity";
import { relinkSavedPage } from "@/services/savedPagesService";
import { setScrollPosition } from "@/services/viewerStorageService";
import type { SavedPage } from "@/services/savedPagesTypes";

type ViewerPath = "/pdf-viewer" | "/docx-viewer" | "/epub-viewer" | "/ppt-viewer";

/** Which reader shows a file, by extension. */
export function viewerPathForExt(ext: string): ViewerPath | null {
  const e = (ext || "").toLowerCase();
  if (e === "pdf") return "/pdf-viewer";
  if (e === "epub") return "/epub-viewer";
  if (e === "docx" || e === "doc") return "/docx-viewer";
  if (e === "pptx" || e === "ppt") return "/ppt-viewer";
  return null;
}

export interface OpenSavedPageResult {
  opened: boolean;
  /** Why it could not open, when it could not. */
  reason?: "file-gone" | "no-viewer";
}

/**
 * Open the SOURCE DOCUMENT at a saved page's stored location.
 *
 * The secondary action behind "Open in document" — not what tapping a
 * bookmark does. Returns `{ opened: false }` when the file no longer resolves
 * (or has no viewer), and the caller stays on /saved-page, which needs no
 * file to show the page. Never throws.
 */
export async function openSavedPage(
  page: SavedPage,
): Promise<OpenSavedPageResult> {
  try {
    const uri = await resolveIdentityToLiveUri(page.identityKey);
    if (!uri) return { opened: false, reason: "file-gone" };

    const path = viewerPathForExt(page.fileExt);
    if (!path) return { opened: false, reason: "no-viewer" };

    // The reflow viewers restore by scroll percentage, so the position is
    // written where the viewer already looks for it rather than passed as a
    // param the viewer would need new code to read.
    if (typeof page.scrollPct === "number" && page.locatorType === "section") {
      await setScrollPosition(uri, {
        scrollY: 0,
        scrollPercent: page.scrollPct,
        timestamp: Date.now(),
      }).catch(() => {});
    }

    const params: Record<string, string> = {
      // expo-router applies a net 1-decode to params, which corrupts SAF
      // content:// URIs. Pre-encode, exactly as library.tsx and
      // citationNavigator.buildCitationParams do.
      uri: encodeURIComponent(uri),
      name: page.fileName,
    };

    // Page and slide jumps reuse the citation params the viewers already act on.
    if (typeof page.page === "number" && page.page >= 1) {
      params.locatorType = page.locatorType;
      params.locatorIndex = String(page.page);
      params.quote = (page.excerpt || "").slice(0, 300);
    } else if (page.cfi) {
      // EPUB: the CFI is exact, so it is preferred over a chapter index.
      params.savedCfi = page.cfi;
      params.quote = (page.excerpt || "").slice(0, 300);
    }

    router.push({ pathname: path as never, params });
    return { opened: true };
  } catch {
    return { opened: false, reason: "file-gone" };
  }
}

/**
 * Re-link a saved page to a file the user has found again ("Find this file").
 * Only the pointer moves; the page the user saved is never rewritten.
 */
export async function relinkToFile(
  page: SavedPage,
  picked: { uri: string; name?: string },
): Promise<boolean> {
  try {
    const identity = await getFileIdentity(picked.uri, picked.name || page.fileName);
    return await relinkSavedPage(page.id, {
      identityKey: identity.key,
      fileUriAtSave: identity.uri,
      fileName: identity.name,
    });
  } catch {
    return false;
  }
}

export type RelinkOutcome =
  | { status: "linked"; fileName: string }
  | { status: "cancelled" }
  | { status: "failed" };

/**
 * The whole "Find this file" flow: pick a file, re-link the record to it.
 *
 * Lives here rather than in a screen because both surfaces that can offer it
 * — the Bookmarks list and /saved-page — must behave identically, and because
 * re-linking is about the POINTER only: nothing the user saved is touched, so
 * a wrong pick is never destructive.
 */
export async function pickAndRelink(page: SavedPage): Promise<RelinkOutcome> {
  try {
    const result = await pickFilesWithResult({ multiple: false });
    const picked = result.files?.[0];
    if (!picked) return { status: "cancelled" };
    const ok = await relinkToFile(page, { uri: picked.uri, name: picked.name });
    return ok ? { status: "linked", fileName: picked.name } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
