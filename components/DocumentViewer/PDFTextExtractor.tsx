/**
 * PDFTextExtractor
 *
 * A hidden (0-height) WebView that runs pdf.js to extract per-page text from a
 * PDF file WITHOUT switching the main viewer to Mobile View.
 *
 * Usage:
 *   <PDFTextExtractor
 *     uri={normalizedPdfUri}
 *     active={readAloudActive}
 *     onPageTexts={(pages) => setReadAloudPageTexts(pages)}
 *     onError={(msg) => console.warn('[PDFExtractor]', msg)}
 *   />
 *
 * The component is always mounted but only generates and loads the extraction
 * HTML when `active` becomes true. Resets whenever `uri` changes.
 *
 * PAGE IMAGES (Bookmarks): pass `imagePage` and the same pass also rasterises
 * that one page and hands back a JPEG through `onPageImage`. It rides along on
 * the pdf.js load that is happening anyway rather than mounting a second
 * WebView, because a bookmark wants the text and the picture of one page and
 * loading the document twice to get them would be absurd.
 */

import {
  generatePdfTextExtractionHtml,
} from "@/services/documentReflowService";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { WebView } from "react-native-webview";

interface Props {
  /** Normalised local URI of the PDF to extract. */
  uri: string | null;
  /** When true, triggers extraction. When false, does nothing (resets on next true). */
  active: boolean;
  /** Called with per-page text array when extraction succeeds. */
  onPageTexts: (pageTexts: string[]) => void;
  /**
   * Called incrementally as each page's text is extracted, in page order.
   * Receives the growing per-page array and the total page count. Lets
   * Read Aloud begin speaking page 1 before the whole document is parsed.
   */
  onProgress?: (pageTexts: string[], total: number) => void;
  /** Called when extraction fails. */
  onError?: (message: string) => void;
  /**
   * 1-based page to ALSO rasterise on this pass, or null for text only.
   * Changing it starts a fresh pass, because the page image is produced by
   * the host page at load time.
   */
  imagePage?: number | null;
  /** Longest edge of the rasterised page, in pixels. */
  imageMaxEdge?: number;
  /** JPEG quality for the rasterised page, 0-1. */
  imageQuality?: number;
  /**
   * Produce ONLY the page image and skip text extraction. Set this when the
   * document's text is already cached — otherwise a bookmark on a late page
   * re-parses the whole book to reach one picture.
   */
  imageOnly?: boolean;
  /** Called with the page image as base64 JPEG (no data: prefix). */
  onPageImage?: (page: number, base64Jpeg: string) => void;
}

export function PDFTextExtractor({
  uri,
  active,
  onPageTexts,
  onProgress,
  onError,
  imagePage = null,
  imageMaxEdge = 1200,
  imageQuality = 0.7,
  imageOnly = false,
  onPageImage,
}: Props) {
  const [html, setHtml] = useState<string | null>(null);
  /** What the WebView loads: a staged file:// page on Android, inline on iOS. */
  const [source, setSource] = useState<{ uri: string } | { html: string } | null>(
    null,
  );
  const stagedPathRef = useRef<string | null>(null);
  const writeSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const extractingRef = useRef<string | null>(null); // tracks which URI is being extracted
  // Accumulates streamed per-page text for the current extraction run.
  const progressRef = useRef<string[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Generate extraction HTML when active + uri changes
  useEffect(() => {
    if (!active || !uri) return;
    // A pass is identified by the URI AND the page being rasterised: asking
    // for a different page's image is a different pass, even on the same file.
    const passKey = `${uri}|${imagePage ?? ''}|${imageOnly ? 'img' : 'txt'}`;
    if (extractingRef.current === passKey) return;

    extractingRef.current = passKey;
    progressRef.current = [];
    setHtml(null); // reset first

    generatePdfTextExtractionHtml(
      uri,
      imagePage && imagePage >= 1
        ? {
            page: imagePage,
            maxEdge: imageMaxEdge,
            quality: imageQuality,
            imageOnly,
          }
        : null,
    ).then((result) => {
      if (!mountedRef.current) return;
      if ("error" in result) {
        onError?.(result.error);
        extractingRef.current = null;
      } else {
        setHtml(result.html);
      }
    });
  }, [active, uri, imagePage, imageMaxEdge, imageQuality, imageOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when deactivated
  useEffect(() => {
    if (!active) {
      extractingRef.current = null;
      setHtml(null);
    }
  }, [active]);

  // Stage the host page for the WebView.
  //
  // On Android the page must itself have a file:// origin, or the XHR it uses
  // to read the PDF is refused — an inline (loadDataWithBaseURL) page cannot
  // read local files whatever the WebView flags say. iOS keeps the inline path:
  // WKWebView blocks file:// XHR regardless, so its host page carries the bytes
  // inline and has nothing to fetch.
  useEffect(() => {
    if (!html) {
      setSource(null);
      return;
    }
    if (Platform.OS !== "android") {
      setSource({ html });
      return;
    }

    let cancelled = false;
    const seq = ++writeSeqRef.current;
    void (async () => {
      try {
        const dir = FileSystem.cacheDirectory + "pdfextract/";
        try {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        } catch {
          // Already there — fine.
        }
        const path = `${dir}extract-${seq}.html`;
        await FileSystem.writeAsStringAsync(path, html);
        if (cancelled || seq !== writeSeqRef.current) {
          FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
          return;
        }
        const prev = stagedPathRef.current;
        stagedPathRef.current = path;
        setSource({ uri: path });
        if (prev && prev !== path) {
          FileSystem.deleteAsync(prev, { idempotent: true }).catch(() => {});
        }
      } catch {
        // Disk write failed — fall back to the inline page. On Android that
        // means the XHR will fail, so fall back to the base64 path too by
        // reporting the failure rather than silently extracting nothing.
        if (!cancelled && seq === writeSeqRef.current) setSource({ html });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  // Remove the staged page when the extractor unmounts.
  useEffect(
    () => () => {
      if (stagedPathRef.current) {
        FileSystem.deleteAsync(stagedPathRef.current, {
          idempotent: true,
        }).catch(() => {});
      }
    },
    [],
  );

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "pdf-page-progress") {
          // Streamed single page — accumulate in order and notify.
          if (typeof msg.index === "number") {
            const arr = progressRef.current;
            arr[msg.index] = typeof msg.text === "string" ? msg.text : "";
            // Pass a dense copy (fill any gaps with empty strings) so consumers
            // always receive a contiguous, index-stable array.
            const total = typeof msg.total === "number" ? msg.total : arr.length;
            const dense: string[] = [];
            for (let i = 0; i < total; i++) dense[i] = arr[i] ?? "";
            onProgress?.(dense, total);
          }
        } else if (msg.type === "pdf-page-texts") {
          const pages: string[] = Array.isArray(msg.pageTexts)
            ? msg.pageTexts
            : [];
          if (__DEV__) {
            const totalChars = pages.reduce((s, p) => s + (p?.length ?? 0), 0);
            console.log(
              `[PDFTextExtractor] Extracted ${pages.length} pages, ${totalChars} total chars`,
            );
          }
          onPageTexts(pages);
          extractingRef.current = null;
        } else if (msg.type === "pdf-page-image") {
          // data:image/jpeg;base64,XXXX → XXXX. The store writes raw base64,
          // and the prefix would corrupt the file.
          const url: string = typeof msg.dataUrl === "string" ? msg.dataUrl : "";
          const comma = url.indexOf(",");
          const base64 = comma >= 0 ? url.slice(comma + 1) : "";
          if (base64 && typeof msg.page === "number") {
            onPageImage?.(msg.page, base64);
          }
        } else if (msg.type === "pdf-page-image-error") {
          if (__DEV__) {
            console.warn("[PDFTextExtractor] Page image failed:", msg.message);
          }
          // Deliberately NOT surfaced through onError: the text pass is
          // unaffected, and a bookmark without a picture still works.
        } else if (msg.type === "pdf-text-error") {
          if (__DEV__) {
            console.warn("[PDFTextExtractor] Error:", msg.message);
          }
          onError?.(msg.message ?? "Extraction failed");
          extractingRef.current = null;
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
    [onPageTexts, onProgress, onError, onPageImage],
  );

  if (!source) return null;

  // IMPORTANT: Android WebViews with 0×0 dimensions often skip layout/JS
  // execution. We render at 1×1, positioned off-screen with opacity 0 so
  // pdf.js actually runs while remaining invisible to the user.
  return (
    <View
      style={{
        position: "absolute",
        left: -10000,
        top: -10000,
        width: 1,
        height: 1,
        opacity: 0,
      }}
      pointerEvents="none"
    >
      <WebView
        source={source}
        style={{ width: 1, height: 1, backgroundColor: "transparent" }}
        originWhitelist={["*"]}
        // Android: the host page XHRs the PDF from its file:// URI instead of
        // carrying it inline as base64. Same rationale as MobileRenderer —
        // inlining forced several copies of a 30+ MB string through the RN
        // heap on every extraction. Both the page and the document are
        // app-generated and local, and top-frame navigation is blocked below.
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={FileSystem.cacheDirectory ?? undefined}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        // No network: only the staged local page and its own file reads.
        onShouldStartLoadWithRequest={(req) => {
          if (
            req.url === "about:blank" ||
            req.url.startsWith("data:") ||
            req.url.startsWith("file://")
          )
            return true;
          return !req.isTopFrame;
        }}
        // Never show a loading indicator
        startInLoadingState={false}
        cacheEnabled={false}
      />
    </View>
  );
}
