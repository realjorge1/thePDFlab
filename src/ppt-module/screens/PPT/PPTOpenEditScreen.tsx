// ─────────────────────────────────────────────
//  PPT Module — PPTOpenEditScreen
//  Pick an existing .pptx from device storage,
//  parse it, then edit or re-export with a new theme.
// ─────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '@/services/ThemeProvider';
import { openPPTX, toPPTPresentation } from '../../services/pptxEditor.service';
import { usePPTEditor } from '../../hooks/usePPTEditor';
import { useExportPPT } from '../../hooks/useExportPPT';
import { getTheme } from '../../themes/pptThemes';
import { ThemePicker } from '../../components/PPT/ThemePicker';
import { SlideCard } from '../../components/PPT/SlideCard';
import { ExportModal } from '../../components/PPT/ExportModal';
import { SlideThumbnailStrip } from '../../components/PPT/SlideThumbnailStrip';
import { PPTPresentation } from '../../types/ppt.types';
import { ArrowLeft, FolderOpen, Upload, Eye } from 'lucide-react-native';

type ScreenState = 'pick' | 'loading' | 'editing';

interface PPTOpenEditScreenProps {
  onViewPresentation?: (presentation: PPTPresentation) => void;
  onGoBack?: () => void;
}

export const PPTOpenEditScreen: React.FC<PPTOpenEditScreenProps> = ({
  onViewPresentation,
  onGoBack,
}) => {
  const { colors: t } = useTheme();
  const [screenState, setScreenState] = useState<ScreenState>('pick');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportModalVisible, setExportModalVisible] = useState(false);

  const editor = usePPTEditor();
  const exporter = useExportPPT();
  const pptTheme = getTheme(editor.presentation.themeId);

  // ─── Pick file from device ───────────────
  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.ms-powerpoint',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      const filePath = asset.uri.replace('file://', '');

      setScreenState('loading');
      setLoadError(null);

      const parsed = await openPPTX(filePath);
      const pptPresentation = toPPTPresentation(parsed);
      editor.setPresentation(pptPresentation);
      setScreenState('editing');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setScreenState('pick');
      Alert.alert('Failed to open file', msg);
    }
  }, [editor]);

  const handleExport = useCallback(async () => {
    setExportModalVisible(true);
    await exporter.exportPPTX(editor.presentation);
  }, [editor.presentation, exporter]);

  const handleShare = useCallback(() => {
    if (exporter.result?.filePath) {
      exporter.shareFile(exporter.result.filePath, editor.presentation.title);
    }
  }, [exporter, editor.presentation.title]);

  // ─── Pick screen ─────────────────────────
  if (screenState === 'pick') {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: t.background }]}
        edges={['top', 'bottom']}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
          <TouchableOpacity
            onPress={onGoBack}
            hitSlop={10}
            style={[styles.backBtn, { backgroundColor: t.backgroundSecondary }]}
          >
            <ArrowLeft size={18} color={t.text} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: t.text }]}>Open & Re-theme</Text>
          <View style={{ width: 34 }} />
        </View>

        <View style={styles.pickContainer}>
          <View style={[styles.pickIllustration, { backgroundColor: t.backgroundSecondary }]}>
            <FolderOpen size={44} color={t.textSecondary} strokeWidth={1.5} />
          </View>
          <Text style={[styles.pickTitle, { color: t.text }]}>Open a Presentation</Text>
          <Text style={[styles.pickSub, { color: t.textSecondary }]}>
            Select a .pptx file from your device.{'\n'}
            You can re-theme it and export a new version.
          </Text>
          {loadError ? (
            <Text style={styles.errorText}>{loadError}</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.pickBtn, { backgroundColor: pptTheme.colors.primary }]}
            onPress={pickFile}
            activeOpacity={0.85}
          >
            <FolderOpen size={18} color="#FFFFFF" strokeWidth={2} />
            <Text style={styles.pickBtnText}>Browse Files</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loading screen ───────────────────────
  if (screenState === 'loading') {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: t.background }]}
        edges={['top', 'bottom']}
      >
        <View style={styles.pickContainer}>
          <ActivityIndicator size="large" color={pptTheme.colors.primary} />
          <Text style={[styles.loadingText, { color: t.text }]}>Reading presentation…</Text>
          <Text style={[styles.loadingSub, { color: t.textSecondary }]}>
            Parsing slides and extracting content
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Editing screen ───────────────────────
  const selectedSlide = editor.presentation.slides[editor.selectedSlideIndex];

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: t.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <TouchableOpacity
          onPress={() => setScreenState('pick')}
          hitSlop={10}
          style={[styles.backBtn, { backgroundColor: t.backgroundSecondary }]}
        >
          <ArrowLeft size={18} color={t.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.text }]} numberOfLines={1}>
          {editor.presentation.title}
        </Text>
        <View style={styles.headerActions}>
          {onViewPresentation && (
            <TouchableOpacity
              onPress={() => onViewPresentation(editor.presentation)}
              style={[styles.viewBtn, { borderColor: t.border, backgroundColor: t.backgroundSecondary }]}
            >
              <Eye size={14} color={t.text} strokeWidth={2} />
              <Text style={[styles.viewBtnText, { color: t.text }]}>View</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.exportBtn, { backgroundColor: pptTheme.colors.primary }]}
            onPress={handleExport}
            activeOpacity={0.85}
          >
            <Upload size={14} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.exportBtnText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info Banner */}
        <View style={[styles.infoBanner, { backgroundColor: t.info + '15', borderColor: t.info + '30' }]}>
          <Text style={[styles.infoText, { color: t.info }]}>
            {editor.presentation.slides.length} slides imported. Pick a new theme below and export to regenerate the presentation.
          </Text>
        </View>

        {/* Theme Picker */}
        <View style={[styles.section, { borderTopColor: t.border }]}>
          <ThemePicker
            selectedThemeId={editor.presentation.themeId}
            onSelect={editor.updateTheme}
          />
        </View>

        {/* Slide Preview */}
        <View style={[styles.previewContainer, { backgroundColor: t.backgroundSecondary }]}>
          {selectedSlide && (
            <SlideCard slide={selectedSlide} theme={pptTheme} scale={0.82} />
          )}
        </View>

        {/* Thumbnail Strip */}
        <SlideThumbnailStrip
          slides={editor.presentation.slides}
          selectedIndex={editor.selectedSlideIndex}
          theme={pptTheme}
          onSelect={editor.selectSlide}
          onDelete={() => {}}
        />

        {/* Slide Content Preview */}
        {selectedSlide && (
          <View style={[styles.section, { borderTopColor: t.border }]}>
            <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>
              Slide {editor.selectedSlideIndex + 1} Content
            </Text>
            {selectedSlide.content.title ? (
              <View style={[styles.contentRow, { borderBottomColor: t.borderLight }]}>
                <Text style={[styles.contentKey, { color: t.textTertiary }]}>Title</Text>
                <Text style={[styles.contentVal, { color: t.text }]}>
                  {selectedSlide.content.title}
                </Text>
              </View>
            ) : null}
            {selectedSlide.content.body ? (
              <View style={[styles.contentRow, { borderBottomColor: t.borderLight }]}>
                <Text style={[styles.contentKey, { color: t.textTertiary }]}>Body</Text>
                <Text style={[styles.contentVal, { color: t.text }]} numberOfLines={4}>
                  {selectedSlide.content.body}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <ExportModal
        visible={exportModalVisible}
        status={exporter.status}
        progress={exporter.progress}
        filePath={exporter.result?.filePath}
        error={exporter.result?.error}
        accentColor={pptTheme.colors.primary}
        onShare={handleShare}
        onClose={() => {
          setExportModalVisible(false);
          exporter.reset();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  viewBtnText: { fontSize: 13, fontWeight: '600' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 5,
  },
  exportBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  // Pick screen
  pickContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  pickIllustration: {
    width: 96,
    height: 96,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  pickTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  pickSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorText: { fontSize: 13, color: '#EF4444', textAlign: 'center' },
  pickBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    gap: 8,
  },
  pickBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  loadingText: { fontSize: 18, fontWeight: '700', marginTop: 16 },
  loadingSub: { fontSize: 13, textAlign: 'center' },

  // Info banner
  infoBanner: {
    borderRadius: 12,
    margin: 16,
    padding: 12,
    borderWidth: 1,
  },
  infoText: { fontSize: 13, lineHeight: 18 },

  // Sections
  section: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  previewContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    minHeight: 196,
  },
  contentRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contentKey: {
    fontSize: 12,
    fontWeight: '700',
    width: 48,
    paddingTop: 1,
  },
  contentVal: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
