/**
 * PPT Viewer Screen
 *
 * In-app, fully offline PPTX renderer.  Uses the on-device WebView renderer
 * (JSZip bundled inline) to parse the .pptx archive and render each slide
 * with its original design — backgrounds, gradients, shapes, images, tables
 * and theme-resolved colours.
 */

import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  PptxViewer,
  type PptxViewerHandle,
} from '@/src/ppt-module/components/PptxViewer';

const BG = '#111827';
const HEADER_BG = '#1F2937';
const ACCENT = '#6366F1';

export default function PPTViewerScreen() {
  const params = useLocalSearchParams<{ uri: string; name?: string }>();
  const fileUri = params.uri ?? '';
  const fileName = params.name ?? 'Presentation';

  const viewerRef = useRef<PptxViewerHandle>(null);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [ready, setReady] = useState(false);

  const handleReady = useCallback(({ totalSlides: t }: { totalSlides: number }) => {
    setTotalSlides(t);
    setReady(true);
  }, []);

  const handleSlideChange = useCallback(
    ({ currentSlide: c, totalSlides: t }: { currentSlide: number; totalSlides: number }) => {
      setCurrentSlide(c);
      setTotalSlides(t);
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* ─── Header ─────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName}
          </Text>
          {ready && totalSlides > 0 && (
            <Text style={styles.slideCounter}>
              {currentSlide + 1} / {totalSlides}
            </Text>
          )}
        </View>

        <View style={styles.headerRight} />
      </View>

      {/* ─── Viewer ─────────────────────────── */}
      {fileUri ? (
        <PptxViewer
          ref={viewerRef}
          fileUri={fileUri}
          style={styles.viewer}
          showControls
          theme="dark"
          onReady={handleReady}
          onSlideChange={handleSlideChange}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>No file provided</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: HEADER_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 30,
    marginTop: -2,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  slideCounter: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginTop: 1,
  },
  headerRight: {
    width: 34,
  },
  viewer: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  errorIcon: { fontSize: 52 },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
