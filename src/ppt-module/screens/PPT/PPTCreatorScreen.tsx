// ─────────────────────────────────────────────
//  PPT Module — PPTCreatorScreen (v3)
//  Inline-canvas editing. Gradient header matching app style.
//  Save → Save to App / Save to Device (folder picker).
//  Undo/Redo always visible.
// ─────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/services/ThemeProvider';
import { AppHeaderContainer } from '@/components/AppHeaderContainer';
import { GradientView } from '@/components/GradientView';
import { colors as brandColors } from '@/constants/theme';
import { usePPTEditor } from '../../hooks/usePPTEditor';
import { useExportPPT } from '../../hooks/useExportPPT';
import { getTheme } from '../../themes/pptThemes';
import { InteractiveSlideCanvas } from '../../components/PPT/InteractiveSlideCanvas';
import { SlideThumbnailStrip } from '../../components/PPT/SlideThumbnailStrip';
import { ThemePicker } from '../../components/PPT/ThemePicker';
import { ExportModal } from '../../components/PPT/ExportModal';
import { SlideLayout, ThemeId } from '../../types/ppt.types';
import { saveFileToDevice, MIME_TYPES, UTI_TYPES } from '@/utils/file-save-utils';
import {
  ArrowLeft,
  RotateCcw,
  RotateCw,
  Save,
  Palette,
} from 'lucide-react-native';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Layout picker config ────────────────────
const LAYOUTS: { id: SlideLayout; label: string; icon: string }[] = [
  { id: 'title',         label: 'Title',     icon: '▣' },
  { id: 'titleContent',  label: 'Content',   icon: '▤' },
  { id: 'twoColumn',    label: '2 Col',     icon: '▥' },
  { id: 'imageLeft',    label: 'Img Left',  icon: '▧' },
  { id: 'imageRight',   label: 'Img Right', icon: '▨' },
  { id: 'statHighlight', label: 'Stat',     icon: '◉' },
  { id: 'timeline',     label: 'Timeline',  icon: '◷' },
  { id: 'closing',      label: 'Closing',   icon: '◼' },
  { id: 'blank',        label: 'Blank',     icon: '□' },
];

interface PPTCreatorScreenProps {
  onGoBack?: () => void;
  initialThemeId?: ThemeId;
}

export const PPTCreatorScreen: React.FC<PPTCreatorScreenProps> = ({ onGoBack, initialThemeId }) => {
  const { colors: t, mode } = useTheme();
  const editor = usePPTEditor(undefined, initialThemeId);
  const exporter = useExportPPT();
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [themeModalVisible, setThemeModalVisible] = useState(false);

  const pptTheme = getTheme(editor.presentation.themeId);
  // Theme chip uses PPT theme color — gives a "pro" feel showing current theme
  const uiAccent = mode === 'dark' ? pptTheme.colors.secondary : pptTheme.colors.primary;
  const selectedSlide = editor.presentation.slides[editor.selectedSlideIndex];

  // ─── Save to App (export + show progress modal) ──
  const handleSaveToApp = useCallback(() => {
    setExportModalVisible(true);
    exporter.exportPPTX(editor.presentation);
  }, [editor.presentation, exporter]);

  // ─── Save to Device (generate silently → system folder picker) ──
  const handleSaveToDevice = useCallback(async () => {
    const res = await exporter.exportPPTX(editor.presentation);
    if (res?.success && res.filePath) {
      await saveFileToDevice({
        sourceUri: res.filePath,
        fileName: `${editor.presentation.title || 'Presentation'}.pptx`,
        mimeType: MIME_TYPES.PPTX,
        uti: UTI_TYPES.PPTX,
        dialogTitle: 'Save Presentation',
      });
      exporter.reset();
    } else {
      Alert.alert('Error', res?.error ?? 'Failed to generate presentation.');
      exporter.reset();
    }
  }, [editor.presentation, exporter]);

  // ─── Save action sheet ──
  const handleSave = useCallback(() => {
    Alert.alert(
      'Save Presentation',
      '',
      [
        { text: 'Save to App', onPress: handleSaveToApp },
        { text: 'Save to Device', onPress: handleSaveToDevice },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [handleSaveToApp, handleSaveToDevice]);

  // ─── Share from ExportModal success screen ──
  const handleShare = useCallback(() => {
    if (exporter.result?.filePath) {
      exporter.shareFile(exporter.result.filePath, editor.presentation.title);
    }
  }, [exporter, editor.presentation.title]);

  // ─── Slide management ──
  const handleAddSlide = useCallback(() => {
    Alert.alert('Add Slide', 'Choose a layout:', [
      { text: 'Title Slide',   onPress: () => editor.addSlide('title',         editor.selectedSlideIndex) },
      { text: 'Content',       onPress: () => editor.addSlide('titleContent',  editor.selectedSlideIndex) },
      { text: 'Two Columns',   onPress: () => editor.addSlide('twoColumn',     editor.selectedSlideIndex) },
      { text: 'Big Stat',      onPress: () => editor.addSlide('statHighlight', editor.selectedSlideIndex) },
      { text: 'Timeline',      onPress: () => editor.addSlide('timeline',      editor.selectedSlideIndex) },
      { text: 'Image + Text',  onPress: () => editor.addSlide('imageLeft',     editor.selectedSlideIndex) },
      { text: 'Closing Slide', onPress: () => editor.addSlide('closing',       editor.selectedSlideIndex) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [editor]);

  const handleDeleteSlide = useCallback(
    (index: number) => {
      if (editor.presentation.slides.length <= 1) {
        Alert.alert('Cannot delete', 'A presentation must have at least one slide.');
        return;
      }
      Alert.alert('Delete Slide', 'This cannot be undone.', [
        { text: 'Delete', style: 'destructive', onPress: () => editor.deleteSlide(index) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [editor],
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: t.background }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* ─── Gradient Header — two rows, fully inside gradient ──────── */}
        <AppHeaderContainer>
          <GradientView
            colors={[brandColors.gradientStart, brandColors.gradientMid, brandColors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientHeader}
          >
            {/* Row 1: Back · Title · Undo/Redo · Save */}
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={onGoBack}
                hitSlop={10}
                style={styles.gradientIconBtn}
              >
                <ArrowLeft size={18} color="#FFFFFF" strokeWidth={2.2} />
              </TouchableOpacity>

              <TextInput
                style={styles.titleInput}
                value={editor.presentation.title}
                onChangeText={editor.updateTitle}
                placeholder="PPT title"
                placeholderTextColor="rgba(255,255,255,0.5)"
                returnKeyType="done"
              />

              <View style={styles.headerActions}>
                <TouchableOpacity
                  onPress={editor.undo}
                  disabled={!editor.canUndo}
                  style={styles.gradientIconBtn}
                  hitSlop={6}
                >
                  <RotateCcw
                    size={15}
                    color={editor.canUndo ? '#FFFFFF' : 'rgba(255,255,255,0.3)'}
                    strokeWidth={2.2}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={editor.redo}
                  disabled={!editor.canRedo}
                  style={styles.gradientIconBtn}
                  hitSlop={6}
                >
                  <RotateCw
                    size={15}
                    color={editor.canRedo ? '#FFFFFF' : 'rgba(255,255,255,0.3)'}
                    strokeWidth={2.2}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSave}
                  activeOpacity={0.85}
                >
                  <Save size={14} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Row 2: Theme button (PPT theme color) · Slide info — inside gradient */}
            <View style={styles.headerRow2}>
              {/* Theme button — solid PPT theme color pill, clearly shows active theme */}
              <TouchableOpacity
                style={[styles.themeBtn, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
                onPress={() => setThemeModalVisible(true)}
                activeOpacity={0.8}
              >
                <Palette size={11} color="#FFFFFF" strokeWidth={2.5} />
                <View style={styles.themeBtnDot} />
                <Text style={styles.themeBtnText}>{pptTheme.name}</Text>
              </TouchableOpacity>

              <Text style={styles.slideInfo}>
                Slide {editor.selectedSlideIndex + 1} / {editor.presentation.slides.length}
                {editor.isDirty ? ' · Unsaved' : ''}
              </Text>
            </View>
          </GradientView>
        </AppHeaderContainer>

        {/* ─── Main Editing Area ────────────────────── */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.canvasArea}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Interactive Slide Canvas */}
          {selectedSlide ? (
            <InteractiveSlideCanvas
              slide={selectedSlide}
              theme={pptTheme}
              onChange={content =>
                editor.updateSlideContent(editor.selectedSlideIndex, content)
              }
            />
          ) : (
            <View style={styles.emptySlate}>
              <Text style={[styles.emptyMsg, { color: t.textTertiary }]}>No slide selected</Text>
            </View>
          )}

          {/* ─── Layout Picker ─── */}
          <View style={styles.layoutSection}>
            <Text style={[styles.layoutLabel, { color: t.textTertiary }]}>SLIDE LAYOUT</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.layoutRow}
            >
              {LAYOUTS.map(l => {
                const active = selectedSlide?.layout === l.id;
                return (
                  <TouchableOpacity
                    key={l.id}
                    onPress={() =>
                      selectedSlide &&
                      editor.updateSlideLayout(editor.selectedSlideIndex, l.id)
                    }
                    activeOpacity={0.75}
                    style={[
                      styles.layoutChip,
                      {
                        backgroundColor: active ? uiAccent + '18' : t.backgroundSecondary,
                        borderColor: active ? uiAccent : t.border,
                      },
                    ]}
                  >
                    <Text style={styles.layoutIcon}>{l.icon}</Text>
                    <Text
                      style={[
                        styles.layoutChipLabel,
                        { color: active ? uiAccent : t.textSecondary },
                        active && { fontWeight: '700' },
                      ]}
                    >
                      {l.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Speaker notes (compact, below layout picker) */}
          <View style={[styles.notesSection, { borderColor: t.border }]}>
            <Text style={[styles.notesLabel, { color: t.textTertiary }]}>SPEAKER NOTES</Text>
            <TextInput
              style={[styles.notesInput, { color: t.text, backgroundColor: t.backgroundSecondary, borderColor: t.border }]}
              value={selectedSlide?.speakerNotes ?? ''}
              onChangeText={notes =>
                editor.updateSlideNotes(editor.selectedSlideIndex, notes)
              }
              placeholder="Notes visible only to you during presentation…"
              placeholderTextColor={t.textTertiary}
              multiline
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        {/* ─── Thumbnail Strip (+ button inline at end of scroll) ──────── */}
        <SlideThumbnailStrip
          slides={editor.presentation.slides}
          selectedIndex={editor.selectedSlideIndex}
          theme={pptTheme}
          onSelect={editor.selectSlide}
          onDelete={handleDeleteSlide}
          onAddAfter={index => editor.addSlide('titleContent', index)}
          onAdd={handleAddSlide}
        />
      </KeyboardAvoidingView>

      {/* ─── Export / Save-to-App Modal ─── */}
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

      {/* ─── Theme Selection Modal ────────────────── */}
      <Modal
        visible={themeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setThemeModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setThemeModalVisible(false)}
        >
          <Pressable
            style={[styles.themeSheet, { backgroundColor: t.card }]}
            onPress={e => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: t.border }]} />
            <View style={[styles.sheetHeader, { borderBottomColor: t.border }]}>
              <Text style={[styles.sheetTitle, { color: t.text }]}>Choose Theme</Text>
              <TouchableOpacity
                onPress={() => setThemeModalVisible(false)}
                style={[styles.sheetDoneBtn, { backgroundColor: uiAccent }]}
              >
                <Text style={styles.sheetDoneText}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingVertical: 16 }}
              showsVerticalScrollIndicator={false}
            >
              <ThemePicker
                selectedThemeId={editor.presentation.themeId}
                onSelect={id => {
                  editor.updateTheme(id as ThemeId);
                  setThemeModalVisible(false);
                }}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },

  // ── Gradient header (two rows — fully inside gradient) ──
  gradientHeader: {
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  headerRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 10,
  },
  gradientIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  titleInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    padding: 0,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Save button: transparent glass — NOT influenced by PPT theme
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.1,
  },
  // Theme button: solid PPT theme color — shows active theme identity on gradient
  themeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
    gap: 5,
  },
  themeBtnDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  themeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  slideInfo: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    marginLeft: 'auto',
  },

  // ── Canvas area ──
  canvasArea: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 14,
    alignItems: 'center',
  },
  emptySlate: {
    width: SCREEN_W - 32,
    aspectRatio: 16 / 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyMsg: { fontSize: 14 },

  // ── Layout picker ──
  layoutSection: {
    width: '100%',
    gap: 8,
  },
  layoutLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  layoutRow: {
    gap: 8,
    paddingRight: 4,
  },
  layoutChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  layoutIcon: { fontSize: 13 },
  layoutChipLabel: { fontSize: 11, fontWeight: '500' },

  // ── Speaker notes ──
  notesSection: {
    width: '100%',
    gap: 6,
  },
  notesLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 72,
  },

  // ── Theme modal ──
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  themeSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 30,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sheetDoneBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  sheetDoneText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
