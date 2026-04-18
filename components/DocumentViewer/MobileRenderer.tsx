/**
 * MobileRenderer — WebView-based reflow renderer for Mobile View.
 * Renders the HTML returned by the reflow API.
 * Supports: search (via injected JS), highlight application, text selection,
 * scroll position restore, and live style updates.
 *
 * Shared by both PDF and DOCX viewers.
 */
import type {
  Highlight,
  ReaderSettings,
  Strikethrough,
  Underline,
  WebViewMessage,
} from "@/src/types/document-viewer.types";
import { injectSelectionBridge } from "@/utils/selectionScripts";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

// ============================================================================
// Public imperative handle
// ============================================================================
export interface MobileRendererHandle {
  search: (query: string) => void;
  searchNext: () => void;
  searchPrev: () => void;
  clearSearch: () => void;
  updateStyles: (settings: ReaderSettings) => void;
  scrollToPosition: (y: number) => void;
  /** Scroll to a percentage of the document height (0–100). Used for Read Aloud auto-scroll. */
  scrollToPercent: (percent: number) => void;
  /** Scroll so that text matching `searchText` appears near the top of the viewport. Falls back to proportional scroll. */
  scrollToText: (searchText: string, fallbackPercent: number) => void;
  applyHighlights: (highlights: Highlight[]) => void;
  /** Apply a single highlight via the selection bridge. */
  bridgeHighlight: (
    id: string,
    startOffset: number,
    endOffset: number,
    color: string,
  ) => void;
  /** Apply a single underline via the selection bridge. */
  bridgeUnderline: (id: string, startOffset: number, endOffset: number) => void;
  /** Copy the current WebView text selection to clipboard via execCommand. */
  bridgeCopySelection: () => void;
  /** Clear the current browser text selection. */
  bridgeClearSelection: () => void;
  /** Reapply all annotations (highlights + underlines + strikethroughs) after load. */
  bridgeReapplyAnnotations: (
    highlights: Highlight[],
    underlines: Underline[],
    strikethroughs?: Strikethrough[],
  ) => void;
  /** Remove a single annotation (highlight or underline). */
  bridgeRemoveAnnotation: (id: string) => void;
  /** Apply bold formatting to the given offset range. */
  bridgeBold: (startOffset: number, endOffset: number) => void;
  /** Apply italic formatting to the given offset range. */
  bridgeItalic: (startOffset: number, endOffset: number) => void;
  /** Apply text colour to the given offset range. */
  bridgeTextColor: (startOffset: number, endOffset: number, color: string) => void;
  /** Apply strikethrough to the given offset range. */
  bridgeStrikethrough: (id: string, startOffset: number, endOffset: number) => void;
  /** Extract all visible text from the WebView for Read Aloud. */
  extractTextForReadAloud: () => void;
}

// ============================================================================
// Props
// ============================================================================
interface Props {
  html: string | null;
  loading?: boolean;
  error?: string | null;
  /** Called when WebView posts a message (scroll, search result, text selection) */
  onMessage?: (msg: WebViewMessage) => void;
  /** Called once the WebView signals 'ready' */
  onReady?: () => void;
}

// ============================================================================
// Component
// ============================================================================
export const MobileRenderer = forwardRef<MobileRendererHandle, Props>(
  function MobileRenderer(
    { html, loading = false, error, onMessage, onReady },
    ref,
  ) {
    const webViewRef = useRef<WebView>(null);
    const [webViewReady, setWebViewReady] = useState(false);
    const pendingQueue = useRef<string[]>([]);

    // Flush any JS that was queued before WebView was ready
    useEffect(() => {
      if (webViewReady && pendingQueue.current.length > 0) {
        pendingQueue.current.forEach((js) =>
          webViewRef.current?.injectJavaScript(js),
        );
        pendingQueue.current = [];
      }
    }, [webViewReady]);

    const inject = useCallback(
      (js: string) => {
        if (webViewReady && webViewRef.current) {
          webViewRef.current.injectJavaScript(js);
        } else {
          pendingQueue.current.push(js);
        }
      },
      [webViewReady],
    );

    // Expose imperative methods
    useImperativeHandle(
      ref,
      () => ({
        search(query: string) {
          inject(`window.searchText(${JSON.stringify(query)}); true;`);
        },
        searchNext() {
          inject(`window.searchNext(); true;`);
        },
        searchPrev() {
          inject(`window.searchPrev(); true;`);
        },
        clearSearch() {
          inject(`window.clearSearch(); true;`);
        },
        updateStyles(s: ReaderSettings) {
          inject(
            `window.updateStyles(${s.fontSize},${s.lineHeight},${JSON.stringify(s.theme)}); true;`,
          );
        },
        scrollToPosition(y: number) {
          inject(`window.scrollToPosition(${y}); true;`);
        },
        scrollToPercent(percent: number) {
          const clamped = Math.max(0, Math.min(100, percent));
          inject(
            `window.scrollTo(0, document.documentElement.scrollHeight * ${clamped} / 100); true;`,
          );
        },
        scrollToText(searchText: string, fallbackPercent: number) {
          const escaped = JSON.stringify(searchText.trim().substring(0, 60));
          const fb = Math.max(0, Math.min(100, fallbackPercent));
          inject(
            `(function(){` +
            `var prev=document.getElementById('_ra_hl');if(prev)prev.remove();` +
            `var s=${escaped};` +
            `var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);` +
            `while(w.nextNode()){` +
            `var t=w.currentNode.textContent;` +
            `var idx=t?t.indexOf(s):-1;` +
            `if(idx!==-1){` +
            `var r=document.createRange();` +
            `r.setStart(w.currentNode,idx);r.setEnd(w.currentNode,Math.min(idx+s.length,t.length));` +
            `var hl=document.createElement('mark');hl.id='_ra_hl';` +
            `hl.style.cssText='background:#4F46E540;border-radius:3px;transition:background 0.3s;';` +
            `r.surroundContents(hl);` +
            `var rect=hl.getBoundingClientRect();` +
            `window.scrollTo({top:Math.max(0,window.scrollY+rect.top-80),behavior:'smooth'});` +
            `return;}}` +
            `window.scrollTo({top:document.documentElement.scrollHeight*${fb}/100,behavior:'smooth'});` +
            `})(); true;`,
          );
        },
        applyHighlights(highlights: Highlight[]) {
          const payload = highlights.map((h) => ({
            id: h.id,
            startOffset: h.startOffset,
            endOffset: h.endOffset,
            color: h.color,
          }));
          inject(`window.applyHighlights(${JSON.stringify(payload)}); true;`);
        },
        // ── Selection Bridge methods ──────────────────────────
        bridgeHighlight(
          id: string,
          startOffset: number,
          endOffset: number,
          color: string,
        ) {
          inject(
            `window.__selBridge_highlight(${JSON.stringify(id)},${startOffset},${endOffset},${JSON.stringify(color)}); true;`,
          );
        },
        bridgeUnderline(id: string, startOffset: number, endOffset: number) {
          inject(
            `window.__selBridge_underline(${JSON.stringify(id)},${startOffset},${endOffset}); true;`,
          );
        },
        bridgeCopySelection() {
          inject(`document.execCommand('copy'); true;`);
        },
        bridgeClearSelection() {
          inject(`window.__selBridge_clearSelection(); true;`);
        },
        bridgeReapplyAnnotations(
          highlights: Highlight[],
          underlines: Underline[],
          strikethroughs?: Strikethrough[],
        ) {
          const annotations = [
            ...highlights.map((h) => ({
              id: h.id,
              startOffset: h.startOffset ?? 0,
              endOffset: h.endOffset ?? 0,
              kind: "highlight" as const,
              color: h.color,
            })),
            ...underlines.map((u) => ({
              id: u.id,
              startOffset: u.startOffset,
              endOffset: u.endOffset,
              kind: "underline" as const,
            })),
            ...(strikethroughs ?? []).map((s) => ({
              id: s.id,
              startOffset: s.startOffset,
              endOffset: s.endOffset,
              kind: "strikethrough" as const,
            })),
          ];
          inject(
            `window.__selBridge_reapplyAnnotations(${JSON.stringify(annotations)}); true;`,
          );
        },
        bridgeRemoveAnnotation(id: string) {
          inject(
            `window.__selBridge_removeAnnotation(${JSON.stringify(id)}); true;`,
          );
        },
        bridgeBold(startOffset: number, endOffset: number) {
          inject(`window.__selBridge_bold(${startOffset},${endOffset}); true;`);
        },
        bridgeItalic(startOffset: number, endOffset: number) {
          inject(`window.__selBridge_italic(${startOffset},${endOffset}); true;`);
        },
        bridgeTextColor(startOffset: number, endOffset: number, color: string) {
          inject(
            `window.__selBridge_textColor(${startOffset},${endOffset},${JSON.stringify(color)}); true;`,
          );
        },
        bridgeStrikethrough(id: string, startOffset: number, endOffset: number) {
          inject(
            `window.__selBridge_strikethrough(${JSON.stringify(id)},${startOffset},${endOffset}); true;`,
          );
        },
        extractTextForReadAloud() {
          inject(
            `(function(){
              var el = document.getElementById('reader-content') || document.body;
              var text = el.innerText || el.textContent || '';
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'read-aloud-text', text: text }));
            })(); true;`,
          );
        },
      }),
      [inject],
    );

    // Handle messages from WebView
    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        try {
          const msg: WebViewMessage = JSON.parse(event.nativeEvent.data);
          if (msg.type === "ready") {
            setWebViewReady(true);
            onReady?.();
          }
          onMessage?.(msg);
        } catch {
          // Ignore non-JSON messages
        }
      },
      [onMessage, onReady],
    );

    // Inject selection bridge JS into the HTML (memoized to avoid re-injection)
    // Must be called before any early returns to satisfy rules-of-hooks
    const enhancedHtml = useMemo(
      () => (html ? injectSelectionBridge(html) : ""),
      [html],
    );

    // Loading state
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Please wait…</Text>
        </View>
      );
    }

    // Error state
    if (error) {
      return (
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Mobile View not available</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <Text style={styles.errorHint}>Switch to Original view.</Text>
        </View>
      );
    }

    if (!html) return null;

    return (
      <WebView
        ref={webViewRef}
        source={{ html: enhancedHtml }}
        style={styles.webview}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#2196F3" />
          </View>
        )}
        onError={() => {
          // Webview render error — surface it
          onMessage?.({ type: "ready" } as any);
        }}
        // All vendor scripts are inlined into the HTML, so we never need
        // network access. Allow only the initial data: / about:blank load
        // and block every other navigation — this enforces fully offline
        // operation even if some future edit reintroduces a CDN URL.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:"))
            return true;
          return !req.isTopFrame;
        }}
        scrollEnabled
        showsVerticalScrollIndicator
        showsHorizontalScrollIndicator={false}
        // Enable reliable text selection on iOS and Android
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        // Performance
        cacheEnabled
        allowsBackForwardNavigationGestures={false}
        // Never allow mixed-content loads — all assets are inlined.
        mixedContentMode="never"
        allowsInlineMediaPlayback
      />
    );
  },
);

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#666",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
  },
  errorHint: { fontSize: 13, color: "#2196F3", marginTop: 12 },
});
