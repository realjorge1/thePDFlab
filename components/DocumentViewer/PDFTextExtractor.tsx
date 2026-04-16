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
 */

import { generatePdfTextExtractionHtml } from "@/services/documentReflowService";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

interface Props {
  /** Normalised local URI of the PDF to extract. */
  uri: string | null;
  /** When true, triggers extraction. When false, does nothing (resets on next true). */
  active: boolean;
  /** Called with per-page text array when extraction succeeds. */
  onPageTexts: (pageTexts: string[]) => void;
  /** Called when extraction fails. */
  onError?: (message: string) => void;
}

export function PDFTextExtractor({ uri, active, onPageTexts, onError }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const extractingRef = useRef<string | null>(null); // tracks which URI is being extracted

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Generate extraction HTML when active + uri changes
  useEffect(() => {
    if (!active || !uri) return;
    // Already extracting this URI — skip
    if (extractingRef.current === uri) return;

    extractingRef.current = uri;
    setHtml(null); // reset first

    generatePdfTextExtractionHtml(uri).then((result) => {
      if (!mountedRef.current) return;
      if ("error" in result) {
        onError?.(result.error);
        extractingRef.current = null;
      } else {
        setHtml(result.html);
      }
    });
  }, [active, uri]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when deactivated
  useEffect(() => {
    if (!active) {
      extractingRef.current = null;
      setHtml(null);
    }
  }, [active]);

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "pdf-page-texts") {
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
    [onPageTexts, onError],
  );

  if (!html) return null;

  return (
    <View
      style={{ height: 0, width: 0, overflow: "hidden", position: "absolute" }}
      pointerEvents="none"
    >
      <WebView
        source={{ html }}
        style={{ height: 0, width: 0 }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        // Block all network requests — everything is inlined
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:"))
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
