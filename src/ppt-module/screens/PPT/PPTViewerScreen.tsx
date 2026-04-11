// ─────────────────────────────────────────────
//  PPT Module — PPTViewerScreen
//  Fullscreen slide viewer.
//  Strategy A: WebView (Google Docs) for remote files.
//  Strategy B: Native SlideCard pager for local/parsed.
// ─────────────────────────────────────────────

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StyleSheet,
  FlatList,
  Dimensions,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { PPTPresentation } from '../../types/ppt.types';
import { getTheme } from '../../themes/pptThemes';
import { SlideCard } from '../../components/PPT/SlideCard';
import { SlideThumbnailStrip } from '../../components/PPT/SlideThumbnailStrip';
import { buildViewerSource } from '../../services/pptxViewer.service';

const { width: SCREEN_W } = Dimensions.get('window');

interface PPTViewerScreenProps {
  presentation: PPTPresentation;
  /** Optional remote URL to open in WebView viewer */
  remoteUrl?: string;
  onEdit?: () => void;
  onClose?: () => void;
}

export const PPTViewerScreen: React.FC<PPTViewerScreenProps> = ({
  presentation,
  remoteUrl,
  onEdit,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [webviewLoading, setWebviewLoading] = useState(true);
  const [webviewError, setWebviewError] = useState(false);
  const [useWebview, setUseWebview] = useState(!!remoteUrl);
  const flatListRef = useRef<FlatList>(null);

  const theme = getTheme(presentation.themeId);
  const viewerSource = buildViewerSource(
    presentation.filePath,
    presentation.slides,
    remoteUrl,
  );

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      flatListRef.current?.scrollToIndex({ index, animated: true });
    },
    [],
  );

  const goNext = useCallback(() => {
    if (currentIndex < presentation.slides.length - 1) goTo(currentIndex + 1);
  }, [currentIndex, goTo, presentation.slides.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) goTo(currentIndex - 1);
  }, [currentIndex, goTo]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.backgroundDark} />

      {/* ─── Top Bar ───────────────────── */}
      <View style={[styles.topBar, { backgroundColor: theme.colors.backgroundDark }]}>
        <TouchableOpacity onPress={onClose} style={styles.topBarBtn}>
          <Text style={styles.topBarIcon}>✕</Text>
        </TouchableOpacity>

        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {presentation.title}
          </Text>
          <Text style={styles.slideCounter}>
            {currentIndex + 1} / {presentation.slides.length}
          </Text>
        </View>

        <View style={styles.topBarRight}>
          {useWebview && (
            <TouchableOpacity
              onPress={() => setUseWebview(false)}
              style={styles.topBarBtn}
            >
              <Text style={[styles.topBarIcon, { fontSize: 12 }]}>📱 Native</Text>
            </TouchableOpacity>
          )}
          {onEdit && (
            <TouchableOpacity onPress={onEdit} style={styles.topBarBtn}>
              <Text style={styles.topBarIcon}>✏️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ─── Content ───────────────────── */}
      {useWebview && viewerSource.uri ? (
        <View style={styles.webviewContainer}>
          {webviewLoading && !webviewError && (
            <View style={styles.webviewLoader}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.webviewLoadingText}>Loading presentation…</Text>
            </View>
          )}

          {webviewError ? (
            <View style={styles.webviewError}>
              <Text style={styles.webviewErrorIcon}>⚠️</Text>
              <Text style={styles.webviewErrorTitle}>Could not load viewer</Text>
              <Text style={styles.webviewErrorSub}>Falling back to native view</Text>
              <TouchableOpacity
                onPress={() => setUseWebview(false)}
                style={[styles.fallbackBtn, { backgroundColor: theme.colors.primary }]}
              >
                <Text style={styles.fallbackBtnText}>Use Native Viewer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <WebView
              source={{ uri: viewerSource.uri }}
              style={{ flex: 1, opacity: webviewLoading ? 0 : 1 }}
              onLoadEnd={() => setWebviewLoading(false)}
              onError={() => setWebviewError(true)}
              startInLoadingState={false}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
            />
          )}
        </View>
      ) : (
        /* ─── Native Pager ─────────────── */
        <View style={styles.flex}>
          <FlatList
            ref={flatListRef}
            data={presentation.slides}
            keyExtractor={item => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            onMomentumScrollEnd={e => {
              const idx = Math.round(
                e.nativeEvent.contentOffset.x / SCREEN_W,
              );
              setCurrentIndex(idx);
            }}
            getItemLayout={(_, index) => ({
              length: SCREEN_W,
              offset: SCREEN_W * index,
              index,
            })}
            renderItem={({ item }) => (
              <View style={[styles.slidePage, { width: SCREEN_W }]}>
                <SlideCard
                  slide={item}
                  theme={theme}
                  scale={SCREEN_W / 380}
                  style={styles.slideShadow}
                />
              </View>
            )}
          />

          {/* Navigation Arrows */}
          {currentIndex > 0 && (
            <TouchableOpacity
              style={[styles.navArrow, styles.navLeft, { backgroundColor: theme.colors.primary + 'CC' }]}
              onPress={goPrev}
              activeOpacity={0.8}
            >
              <Text style={styles.navArrowText}>‹</Text>
            </TouchableOpacity>
          )}
          {currentIndex < presentation.slides.length - 1 && (
            <TouchableOpacity
              style={[styles.navArrow, styles.navRight, { backgroundColor: theme.colors.primary + 'CC' }]}
              onPress={goNext}
              activeOpacity={0.8}
            >
              <Text style={styles.navArrowText}>›</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ─── Thumbnail Strip ───────────── */}
      {!useWebview && (
        <SlideThumbnailStrip
          slides={presentation.slides}
          selectedIndex={currentIndex}
          theme={theme}
          onSelect={goTo}
          onDelete={() => {}}
        />
      )}

      {/* ─── Speaker Notes ─────────────── */}
      {!useWebview &&
        presentation.slides[currentIndex]?.speakerNotes ? (
        <View style={[styles.notesBar, { backgroundColor: theme.colors.backgroundDark + 'EE' }]}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText} numberOfLines={2}>
            {presentation.slides[currentIndex].speakerNotes}
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  topBarBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    minWidth: 36,
    alignItems: 'center',
  },
  topBarIcon: { color: '#FFFFFF', fontSize: 16 },
  topBarCenter: { flex: 1, alignItems: 'center' },
  topBarTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  slideCounter: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 1 },
  topBarRight: { flexDirection: 'row', gap: 6 },
  webviewContainer: { flex: 1, position: 'relative' },
  webviewLoader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    gap: 12,
  },
  webviewLoadingText: { fontSize: 14, color: '#6B7280' },
  webviewError: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  webviewErrorIcon: { fontSize: 48 },
  webviewErrorTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  webviewErrorSub: { fontSize: 14, color: '#6B7280', marginBottom: 16 },
  fallbackBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  fallbackBtnText: { color: '#FFFFFF', fontWeight: '700' },
  slidePage: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1F2937',
  },
  slideShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  navArrow: {
    position: 'absolute',
    top: '38%',
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navLeft: { left: 12 },
  navRight: { right: 12 },
  navArrowText: { color: '#FFFFFF', fontSize: 28, lineHeight: 32 },
  notesBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  notesLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  notesText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 17 },
});
