// ============================================
// useSavePage — the reader side of Bookmarks
// ---------------------------------------------
// One hook for all four readers. It owns:
//   • the file identity for the open document (R0);
//   • whether the CURRENT location is already saved, for the menu toggle;
//   • saving, which returns IMMEDIATELY with whatever text was in hand;
//   • capturing THE PAGE afterwards, asynchronously.
//
// WHAT GETS CAPTURED: the whole page, not a preview of it. capturePageText()
// returns everything on the bookmarked page (up to SNAPSHOT_MAX); the hook
// stores that as the page snapshot and derives the list excerpt from its first
// EXCERPT_MAX characters. A bookmark has to stand on its own after the file is
// deleted, so saving 600 characters of a page and calling it a bookmark is not
// enough — see services/savedPageSnapshotStore.ts.
//
// AND HOW IT LOOKED: readers that can also hand back the page's MARKUP pass
// capturePageHtml(), and the saved page then re-renders with its fonts, tables
// and lists rather than as flattened text. That is the reflow answer to a
// picture of the page; PDFs get an actual rasterised image instead, captured
// by the viewer itself (app/pdf-viewer.tsx) because only it has pdf.js mounted.
// Both are optional: the text is what every bookmark is guaranteed to have.
//
// The capture runs EVEN WHEN a seed excerpt is supplied. A seed comes from the
// selection toolbar and is the phrase the reader highlighted — it says what the
// bookmark is about, but it is not the page, so it sets the preview and the
// page is still captured underneath it.
//
// A save is NEVER blocked on capture and the user NEVER waits on it. Extracting
// a PDF page's text means mounting a hidden WebView and running pdf.js; making
// the user watch that happen would turn a one-tap action into a multi-second
// one, and the whole point is to be faster than a screenshot. So: save now with
// what we have, fill the page in when it arrives, notify subscribers so the
// list updates in place.
//
// Behind SAVED_PAGES. With the flag off the hook does nothing, reads nothing
// and writes nothing.
// ============================================

import { useCallback, useEffect, useRef, useState } from "react";

import { SAVED_PAGES } from "@/constants/featureFlags";
import { getFileIdentity, type FileIdentity } from "@/services/fileIdentity";
import {
  findSavedPageAt,
  removeSavedPage,
  savePage,
  subscribeSavedPages,
  updateExcerpt,
  updateHtmlSnapshot,
  updateSnapshot,
  type SavePageResult,
} from "@/services/savedPagesService";
import {
  EXCERPT_MAX,
  locatorTypeForExt,
  type SavedPage,
  type SavedPageLocatorType,
} from "@/services/savedPagesTypes";

/** Where the reader currently is. Each viewer fills in what it knows. */
export interface ReaderLocation {
  locatorType?: SavedPageLocatorType;
  page?: number;
  totalPages?: number;
  cfi?: string;
  scrollPct?: number;
  chapterLabel?: string;
}

export interface UseSavePageOptions {
  uri?: string;
  name?: string;
  location: ReaderLocation;
  /**
   * Fetch the FULL text of the current page — everything on it, not a preview.
   * Optional and asynchronous: the save has already happened by the time this
   * resolves. The hook stores the result as the page snapshot and derives the
   * list excerpt from it.
   */
  capturePageText?: () => Promise<string> | string;
  /**
   * Fetch the MARKUP of the current page, already sanitised, plus a summary
   * of the reading surface's styling. Optional: readers that cannot produce
   * markup simply omit it and their bookmarks are text-only.
   */
  capturePageHtml?: () => Promise<{ html: string; css: string }>;
}

export interface UseSavePageResult {
  /** True when the exact current location is already saved. */
  isSaved: boolean;
  /** The saved record for the current location, when there is one. */
  savedHere: SavedPage | null;
  /** Save the current location. Resolves with the store's result. */
  save: (seedExcerpt?: string) => Promise<SavePageResult>;
  /** Remove the bookmark at the current location. */
  unsave: () => Promise<boolean>;
  /** Save when unsaved, remove when saved — for the menu's toggle item. */
  toggle: (seedExcerpt?: string) => Promise<SavePageResult | { ok: true; removed: true }>;
  /** True while a save is in flight (it is brief — the excerpt is not awaited). */
  saving: boolean;
  enabled: boolean;
}

export function useSavePage(options: UseSavePageOptions): UseSavePageResult {
  const { uri, name, location, capturePageText, capturePageHtml } = options;

  const [identity, setIdentity] = useState<FileIdentity | null>(null);
  const [savedHere, setSavedHere] = useState<SavedPage | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const captureRef = useRef(capturePageText);
  captureRef.current = capturePageText;
  const captureHtmlRef = useRef(capturePageHtml);
  captureHtmlRef.current = capturePageHtml;

  const enabled = SAVED_PAGES && !!uri;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve the file's stable identity once per open.
  useEffect(() => {
    if (!enabled || !uri) {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = await getFileIdentity(uri, name);
      if (!cancelled && mountedRef.current) setIdentity(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, uri, name]);

  const locatorType: SavedPageLocatorType =
    location.locatorType ?? locatorTypeForExt(identity?.ext ?? "");

  // Keep the "already saved here?" answer in step with both the location and
  // the store (another screen may have removed this very record).
  const refresh = useCallback(async () => {
    if (!enabled || !identity) {
      setSavedHere(null);
      return;
    }
    const found = await findSavedPageAt({
      identityKey: identity.key,
      locatorType,
      ...(typeof location.page === "number" ? { page: location.page } : {}),
      ...(location.cfi ? { cfi: location.cfi } : {}),
      ...(typeof location.scrollPct === "number" ? { scrollPct: location.scrollPct } : {}),
    });
    if (mountedRef.current) setSavedHere(found);
  }, [enabled, identity, locatorType, location.page, location.cfi, location.scrollPct]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    return subscribeSavedPages(() => {
      void refresh();
    });
  }, [enabled, refresh]);

  const save = useCallback(
    async (seedExcerpt?: string): Promise<SavePageResult> => {
      if (!enabled || !identity) {
        return { ok: false, reason: "invalid", message: "Could not identify this file." };
      }

      setSaving(true);
      try {
        const result = await savePage({
          identityKey: identity.key,
          fileName: identity.name,
          fileExt: identity.ext,
          fileUriAtSave: identity.uri,
          locatorType,
          ...(typeof location.page === "number" ? { page: location.page } : {}),
          ...(typeof location.totalPages === "number"
            ? { totalPages: location.totalPages }
            : {}),
          ...(location.cfi ? { cfi: location.cfi } : {}),
          ...(typeof location.scrollPct === "number"
            ? { scrollPct: location.scrollPct }
            : {}),
          ...(location.chapterLabel ? { chapterLabel: location.chapterLabel } : {}),
          excerpt: seedExcerpt ?? "",
        });

        // Capture the page afterwards. Deliberately NOT awaited: the save is
        // already done, and the record renders cleanly from its seed (or as
        // "No text captured") meanwhile.
        //
        // This runs even with a seed excerpt — the seed is the reader's
        // selection, which is what the bookmark is ABOUT, not the page it is
        // ON. The page is what has to survive the file, so it is always stored.
        if (result.ok && (captureRef.current || captureHtmlRef.current)) {
          const id = result.page.id;
          void (async () => {
            try {
              // Both captures are issued together and settled together, so
              // one reader round-trip produces the page in both forms and a
              // failure in either cannot cost us the other.
              const [textResult, htmlResult] = await Promise.allSettled([
                captureRef.current
                  ? Promise.resolve(captureRef.current())
                  : Promise.resolve(""),
                captureHtmlRef.current
                  ? Promise.resolve(captureHtmlRef.current())
                  : Promise.resolve({ html: "", css: "" }),
              ]);

              const pageText =
                textResult.status === "fulfilled" ? textResult.value : "";
              if (pageText) {
                await updateSnapshot(id, pageText);
                // The preview: keep the reader's own selection when they
                // made one, otherwise open the page with its first lines.
                if (!seedExcerpt) {
                  await updateExcerpt(id, pageText.slice(0, EXCERPT_MAX));
                }
              }

              if (htmlResult.status === "fulfilled" && htmlResult.value.html) {
                await updateHtmlSnapshot(
                  id,
                  htmlResult.value.html,
                  htmlResult.value.css,
                );
              }
            } catch {
              // A snapshot is the best version of a bookmark, not a
              // precondition for one. Losing it never affects the save.
            }
          })();
        }

        return result;
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    },
    [enabled, identity, locatorType, location],
  );

  const unsave = useCallback(async (): Promise<boolean> => {
    if (!savedHere) return false;
    return removeSavedPage(savedHere.id);
  }, [savedHere]);

  const toggle = useCallback(
    async (seedExcerpt?: string) => {
      if (savedHere) {
        await removeSavedPage(savedHere.id);
        return { ok: true as const, removed: true as const };
      }
      return save(seedExcerpt);
    },
    [savedHere, save],
  );

  return {
    isSaved: savedHere !== null,
    savedHere,
    save,
    unsave,
    toggle,
    saving,
    enabled,
  };
}
