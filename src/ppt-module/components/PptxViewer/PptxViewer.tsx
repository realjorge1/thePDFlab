/**
 * PptxViewer.tsx
 *
 * Drop-in React Native component for rendering PPTX files.
 *
 * Props:
 *  fileUri   – local file path (content:// or file:// URI)
 *  base64    – raw base64 string of the PPTX file (alternative to fileUri)
 *  onReady   – called once parsing is complete; receives { totalSlides }
 *  onError   – called if parsing fails; receives { message }
 *  onSlideChange – called on each slide transition; receives { currentSlide, totalSlides }
 *  style     – outer container ViewStyle
 *  showControls – show built-in prev/next controls (default: true)
 *  theme     – 'dark' | 'light' (controls UI chrome colour; default: 'dark')
 */

import React, {
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  Platform,
  ViewStyle,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

import { getPptxViewerHtml } from './pptxViewerHtml';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PptxViewerHandle {
  /** Navigate to a specific slide (0-based index). */
  goToSlide: (index: number) => void;
  /** Move to the next slide. */
  nextSlide: () => void;
  /** Move to the previous slide. */
  prevSlide: () => void;
}

export interface PptxViewerProps {
  /** Local file URI (file:// or content:// scheme). */
  fileUri?: string;
  /** Base64-encoded PPTX data (alternative to fileUri). */
  base64?: string;
  /** Called when the presentation is fully parsed and ready. */
  onReady?: (info: { totalSlides: number }) => void;
  /** Called when a navigation error or parsing error occurs. */
  onError?: (error: { message: string }) => void;
  /** Called whenever the displayed slide changes. */
  onSlideChange?: (info: { currentSlide: number; totalSlides: number }) => void;
  /** Outer container style. */
  style?: ViewStyle;
  /** Show built-in navigation controls. Default: true. */
  showControls?: boolean;
  /** UI colour scheme for the native chrome. Default: 'dark'. */
  theme?: 'dark' | 'light';
}

// ── Component ─────────────────────────────────────────────────────────────────

const PptxViewer = forwardRef<PptxViewerHandle, PptxViewerProps>(
  (
    {
      fileUri,
      base64: base64Prop,
      onReady,
      onError,
      onSlideChange,
      style,
      showControls = true,
      theme = 'dark',
    },
    ref
  ) => {
    const webViewRef = useRef<WebView>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [totalSlides, setTotalSlides] = useState(0);

    const isDark = theme === 'dark';

    // ── Imperative API ───────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      goToSlide(index: number) {
        postToWebView({ type: 'goToSlide', index });
      },
      nextSlide() {
        postToWebView({ type: 'next' });
      },
      prevSlide() {
        postToWebView({ type: 'prev' });
      },
    }));

    // ── Helper: send a JSON message to the WebView ───────────────
    const postToWebView = useCallback((payload: object) => {
      const js = `
        (function(){
          try {
            window.dispatchEvent(new MessageEvent('message', {
              data: ${JSON.stringify(JSON.stringify(payload))}
            }));
          } catch(e) {}
        })();
        true;
      `;
      webViewRef.current?.injectJavaScript(js);
    }, []);

    // ── Called once the WebView DOM is ready ─────────────────────
    const handleWebViewLoad = useCallback(async () => {
      try {
        let b64 = base64Prop;

        if (!b64 && fileUri) {
          // Read the file from disk and encode it as base64
          const info = await FileSystem.getInfoAsync(fileUri);
          if (!info.exists) {
            throw new Error(`File not found: ${fileUri}`);
          }
          b64 = await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        if (!b64) {
          throw new Error('No PPTX data provided. Pass either fileUri or base64 prop.');
        }

        // Chunk the base64 string to avoid hitting the JS bridge limit
        // (most platforms handle strings up to ~5 MB fine, but we chunk
        //  at 2 MB to be safe with very large decks.)
        const CHUNK   = 2 * 1024 * 1024; // 2 MB of base64 chars
        if (b64.length <= CHUNK) {
          postToWebView({ type: 'loadPptx', base64: b64 });
        } else {
          // Send in chunks, reassemble in WebView
          const totalChunks = Math.ceil(b64.length / CHUNK);
          for (let i = 0; i < totalChunks; i++) {
            const chunk = b64.slice(i * CHUNK, (i + 1) * CHUNK);
            postToWebView({
              type: 'chunk',
              index: i,
              total: totalChunks,
              data: chunk,
            });
          }
        }
      } catch (err: any) {
        const message = err?.message ?? 'Unknown error';
        setLoadError(message);
        setIsLoading(false);
        onError?.({ message });
      }
    }, [fileUri, base64Prop, postToWebView, onError]);

    // ── Messages coming FROM the WebView ─────────────────────────
    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);

          switch (msg.type) {
            case 'ready':
              setIsLoading(false);
              setTotalSlides(msg.totalSlides ?? 0);
              onReady?.({ totalSlides: msg.totalSlides ?? 0 });
              break;

            case 'slideChange':
              setCurrentSlide(msg.currentSlide ?? 0);
              setTotalSlides(msg.totalSlides ?? 0);
              onSlideChange?.({
                currentSlide: msg.currentSlide ?? 0,
                totalSlides: msg.totalSlides ?? 0,
              });
              break;

            case 'error':
              setLoadError(msg.message ?? 'Render error');
              setIsLoading(false);
              onError?.({ message: msg.message ?? 'Render error' });
              break;

            default:
              break;
          }
        } catch (_) {}
      },
      [onReady, onError, onSlideChange]
    );

    // ── Navigation helpers ───────────────────────────────────────
    const goPrev = () => postToWebView({ type: 'prev' });
    const goNext = () => postToWebView({ type: 'next' });

    // ── Styles that depend on theme ──────────────────────────────
    const bg     = isDark ? '#111827' : '#f3f4f6';
    const chrome = isDark ? '#1f2937' : '#ffffff';
    const text   = isDark ? '#e5e7eb' : '#111827';
    const sub    = isDark ? '#6b7280' : '#9ca3af';
    const btn    = isDark ? '#374151' : '#e5e7eb';
    const btnTxt = isDark ? '#e5e7eb' : '#374151';

    // ── Render ───────────────────────────────────────────────────
    return (
      <View style={[styles.container, { backgroundColor: bg }, style]}>
        {/* WebView houses the PPTX renderer */}
        <WebView
          ref={webViewRef}
          style={styles.webView}
          source={{ html: getPptxViewerHtml() }}
          originWhitelist={['*']}
          // Allow base64 and data-URL resources (needed for embedded images)
          allowFileAccess
          allowUniversalAccessFromFileURLs
          mixedContentMode="always"
          // Disable native scroll so our swipe handler works cleanly
          scrollEnabled={false}
          bounces={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          // Android hardware acceleration
          androidHardwareAccelerationDisabled={false}
          // Send a post-message once the WebView HTML is fully loaded
          onLoad={handleWebViewLoad}
          onMessage={handleMessage}
          onError={(e) => {
            const msg = e.nativeEvent.description ?? 'WebView error';
            setLoadError(msg);
            setIsLoading(false);
            onError?.({ message: msg });
          }}
          // Prevent the WebView itself from navigating away
          onShouldStartLoadWithRequest={(request) => {
            return request.url === 'about:blank' || request.url.startsWith('data:');
          }}
        />

        {/* Loading overlay */}
        {isLoading && (
          <View style={[styles.overlay, { backgroundColor: bg }]}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={[styles.loadingText, { color: sub }]}>
              Loading presentation…
            </Text>
          </View>
        )}

        {/* Error overlay */}
        {loadError && (
          <View style={[styles.overlay, { backgroundColor: bg }]}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={[styles.errorTitle, { color: text }]}>
              Unable to open file
            </Text>
            <Text style={[styles.errorBody, { color: sub }]}>{loadError}</Text>
          </View>
        )}

        {/* Slide controls */}
        {showControls && !isLoading && !loadError && totalSlides > 1 && (
          <View style={[styles.controls, { backgroundColor: chrome }]}>
            <TouchableOpacity
              style={[styles.navBtn, { backgroundColor: btn }, currentSlide === 0 && styles.navBtnDisabled]}
              onPress={goPrev}
              disabled={currentSlide === 0}
              activeOpacity={0.7}
            >
              <Text style={[styles.navBtnTxt, { color: btnTxt }]}>‹</Text>
            </TouchableOpacity>

            <Text style={[styles.slideIndicator, { color: text }]}>
              {currentSlide + 1} / {totalSlides}
            </Text>

            <TouchableOpacity
              style={[
                styles.navBtn,
                { backgroundColor: btn },
                currentSlide === totalSlides - 1 && styles.navBtnDisabled,
              ]}
              onPress={goNext}
              disabled={currentSlide === totalSlides - 1}
              activeOpacity={0.7}
            >
              <Text style={[styles.navBtnTxt, { color: btnTxt }]}>›</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }
);

PptxViewer.displayName = 'PptxViewer';
export default PptxViewer;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 10,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 8,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  errorBody: {
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: Platform.OS === 'ios' ? 16 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  navBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnTxt: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '300',
  },
  slideIndicator: {
    fontSize: 14,
    fontWeight: '500',
  },
});
