// ============================================================================
// PptxOfflineViewer — on-device fallback renderer.
//
// Displays a fully self-contained HTML page (built by the offline PPTX parser)
// inside a WebView. No network, no backend. Mirrors the imperative `goToPage`
// API of PptxPdfViewer so the SlideStrip can drive it interchangeably.
// ============================================================================

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

export interface PptxOfflineViewerHandle {
  goToPage: (page: number) => void;
}

interface Props {
  html: string;
  onPageChanged: (page: number) => void;
}

export const PptxOfflineViewer = forwardRef<PptxOfflineViewerHandle, Props>(
  function PptxOfflineViewer({ html, onPageChanged }, ref) {
    const webRef = useRef<WebView>(null);

    useImperativeHandle(
      ref,
      () => ({
        goToPage: (page: number) => {
          // HTML viewer is 0-indexed; SlideStrip is 1-indexed.
          webRef.current?.injectJavaScript(
            `window.goToSlide && window.goToSlide(${page - 1}); true;`,
          );
        },
      }),
      [],
    );

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg?.type === "slide" && typeof msg.index === "number") {
          onPageChanged(msg.index + 1);
        }
      } catch {
        // ignore malformed messages
      }
    };

    return (
      <WebView
        ref={webRef}
        style={styles.viewer}
        source={{ html }}
        originWhitelist={["*"]}
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        javaScriptEnabled
        onMessage={handleMessage}
      />
    );
  },
);

const styles = StyleSheet.create({
  viewer: {
    flex: 1,
    backgroundColor: "#111827",
  },
});
