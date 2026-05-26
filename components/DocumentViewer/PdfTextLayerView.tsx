/**
 * PdfTextLayerView — WPS-style in-place selectable PDF renderer.
 *
 * Renders a PDF inside a WebView with pdf.js: each page is painted to a canvas
 * (pixel-identical to the original) with an invisible, glyph-aligned text layer
 * on top. Long-press selects the real text on the page — no reflow, no visual
 * change. Pages render lazily for fast load on large files.
 *
 * Designed as a drop-in alongside the native <PdfViewer>: same
 * onLoadComplete / onPageChanged / onError contract, plus selection + an
 * annotation bridge. If the WebView reports a fatal render error, onError fires
 * so the caller can fall back to the native renderer.
 */
import {
  generatePdfTextLayerHtml,
  type PdfTextLayerOptions,
} from "@/services/pdfTextLayerHtml";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

export interface PdfTextLayerSelection {
  text: string;
  pageIndex: number;
  startOffset: number;
  endOffset: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface PdfTextLayerHandle {
  goToPage: (page: number) => void;
  highlight: (
    id: string,
    pageIndex: number,
    startOffset: number,
    endOffset: number,
    color: string,
  ) => void;
  underline: (
    id: string,
    pageIndex: number,
    startOffset: number,
    endOffset: number,
  ) => void;
  strikethrough: (
    id: string,
    pageIndex: number,
    startOffset: number,
    endOffset: number,
  ) => void;
  removeAnnotation: (id: string) => void;
  reapply: (
    annotations: {
      id: string;
      pageIndex: number;
      startOffset: number;
      endOffset: number;
      kind: "highlight" | "underline" | "strikethrough";
      color?: string;
    }[],
  ) => void;
  clearSelection: () => void;
}

interface Props {
  uri: string;
  colorScheme?: "light" | "dark";
  /** Jump target (1-based). Update the value to navigate. */
  page?: number;
  onLoadComplete?: (numberOfPages: number) => void;
  onPageChanged?: (page: number, numberOfPages: number) => void;
  /** Fatal render failure — caller should fall back to the native renderer. */
  onError?: (message: string) => void;
  onSelection?: (selection: PdfTextLayerSelection) => void;
  onSelectionClear?: () => void;
  /** A queued annotation could not be applied (offsets stale) — caller may prune it. */
  onAnnotationFailed?: (
    id: string,
    kind: "highlight" | "underline" | "strikethrough",
  ) => void;
}

export const PdfTextLayerView = forwardRef<PdfTextLayerHandle, Props>(
  function PdfTextLayerView(
    {
      uri,
      colorScheme = "light",
      page,
      onLoadComplete,
      onPageChanged,
      onError,
      onSelection,
      onSelectionClear,
      onAnnotationFailed,
    },
    ref,
  ) {
    const webRef = useRef<WebView>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [genError, setGenError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const mountedRef = useRef(true);
    const queue = useRef<string[]>([]);
    const lastPageRef = useRef<number | undefined>(undefined);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // Generate the self-contained HTML once per file. Theme changes are applied
    // live via injection (no regeneration needed).
    useEffect(() => {
      let cancelled = false;
      setReady(false);
      setHtml(null);
      setGenError(null);
      queue.current = [];
      const opts: PdfTextLayerOptions = {
        theme: colorScheme === "dark" ? "dark" : "light",
      };
      generatePdfTextLayerHtml(uri, opts).then((res) => {
        if (cancelled || !mountedRef.current) return;
        if ("error" in res) {
          setGenError(res.error);
          onError?.(res.error);
        } else {
          setHtml(res.html);
        }
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uri]);

    const inject = useCallback(
      (js: string) => {
        if (ready && webRef.current) webRef.current.injectJavaScript(js);
        else queue.current.push(js);
      },
      [ready],
    );

    // Flush queued JS once ready
    useEffect(() => {
      if (ready && queue.current.length) {
        queue.current.forEach((js) => webRef.current?.injectJavaScript(js));
        queue.current = [];
      }
    }, [ready]);

    // Apply live theme changes without regenerating
    useEffect(() => {
      if (ready) {
        inject(`window.__pv_setTheme(${JSON.stringify(colorScheme)}); true;`);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [colorScheme, ready]);

    // Jump to page when the prop changes
    useEffect(() => {
      if (page && page !== lastPageRef.current) {
        lastPageRef.current = page;
        inject(`window.__pv_goToPage(${page}); true;`);
      }
    }, [page, inject]);

    useImperativeHandle(
      ref,
      () => ({
        goToPage(p) {
          inject(`window.__pv_goToPage(${p | 0}); true;`);
        },
        highlight(id, pageIndex, s, e, color) {
          inject(
            `window.__pv_highlight(${JSON.stringify(id)},${pageIndex},${s},${e},${JSON.stringify(color)}); true;`,
          );
        },
        underline(id, pageIndex, s, e) {
          inject(
            `window.__pv_underline(${JSON.stringify(id)},${pageIndex},${s},${e}); true;`,
          );
        },
        strikethrough(id, pageIndex, s, e) {
          inject(
            `window.__pv_strikethrough(${JSON.stringify(id)},${pageIndex},${s},${e}); true;`,
          );
        },
        removeAnnotation(id) {
          inject(`window.__pv_removeAnnotation(${JSON.stringify(id)}); true;`);
        },
        reapply(annotations) {
          inject(`window.__pv_reapply(${JSON.stringify(annotations)}); true;`);
        },
        clearSelection() {
          inject(`window.__pv_clearSelection(); true;`);
        },
      }),
      [inject],
    );

    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        let msg: any;
        try {
          msg = JSON.parse(event.nativeEvent.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "ready":
            setReady(true);
            break;
          case "loaded":
            onLoadComplete?.(msg.total ?? 0);
            break;
          case "page-changed":
            onPageChanged?.(msg.page ?? 1, msg.total ?? 0);
            break;
          case "selection":
            onSelection?.({
              text: msg.text ?? "",
              pageIndex: msg.pageIndex ?? 0,
              startOffset: msg.startOffset ?? 0,
              endOffset: msg.endOffset ?? 0,
              rect: msg.rect ?? { x: 0, y: 0, width: 0, height: 0 },
            });
            break;
          case "selection_clear":
            onSelectionClear?.();
            break;
          case "annotation_applied":
            if (!msg.success && msg.id) onAnnotationFailed?.(msg.id, msg.kind);
            break;
          case "render-error":
            onError?.(msg.message || "PDF could not be rendered");
            break;
        }
      },
      [
        onLoadComplete,
        onPageChanged,
        onSelection,
        onSelectionClear,
        onAnnotationFailed,
        onError,
      ],
    );

    if (genError) {
      // Caller's onError already fired; render nothing (fallback view takes over).
      return null;
    }

    if (!html) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>Preparing PDF…</Text>
        </View>
      );
    }

    return (
      <WebView
        ref={webRef}
        source={{ html }}
        style={styles.webview}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        startInLoadingState={false}
        // Everything is inlined — block any external navigation/network.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:"))
            return true;
          return !req.isTopFrame;
        }}
        onError={() => onError?.("WebView failed to load")}
        onRenderProcessGone={() => onError?.("PDF renderer crashed")}
        // Selection ergonomics
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        // The page handles its own scrolling/zoom inside the WebView document.
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        cacheEnabled={false}
        mixedContentMode="never"
        androidLayerType="hardware"
      />
    );
  },
);

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: "#525659" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#525659",
  },
  loadingText: { marginTop: 12, fontSize: 15, color: "#fff" },
});
