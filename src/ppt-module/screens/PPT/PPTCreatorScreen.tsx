// ─────────────────────────────────────────────
//  PPT Module — PPTCreatorScreen (v3)
//  Inline-canvas editing. Gradient header matching app style.
//  Save → Save to App / Save to Device (folder picker).
//  Undo/Redo always visible.
// ─────────────────────────────────────────────

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import {
  SlideFieldEditor,
  fieldsForLayout,
  type FieldId,
} from '../../components/PPT/SlideFieldEditor';
import { SlideLayout, ThemeId } from '../../types/ppt.types';
import { saveFileToDevice, MIME_TYPES, UTI_TYPES } from '@/utils/file-save-utils';
import { markFileAsCreated } from '@/services/fileService';
import {
  ArrowLeft,
  RotateCcw,
  RotateCw,
  Download,
  Palette,
  Play,
  Copy,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react-native';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Layout picker config ────────────────────
const LAYOUTS: { id: SlideLayout; label: string; icon: string }[] = [
  { id: 'title',         label: 'Title',     icon: '▣' },
  { id: 'titleContent',  label: 'Content',   icon: '▤' },
  { id: 'twoColumn',    label: '2 Col',     icon: '▥' },
  { id: 'agenda',       label: 'Agenda',    icon: '☰' },
  { id: 'comparison',   label: 'Compare',   icon: '⊞' },
  { id: 'processSteps', label: 'Steps',     icon: '➜' },
  { id: 'quote',        label: 'Quote',     icon: '❝' },
  { id: 'sectionDivider', label: 'Section', icon: '§' },
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
  const router = useRouter();
  const editor = usePPTEditor(undefined, initialThemeId);
  const exporter = useExportPPT();
  const [isCreating, setIsCreating] = useState(false);
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [isPreparingPresent, setIsPreparingPresent] = useState(false);

  const pptTheme = getTheme(editor.presentation.themeId);
  // Theme chip uses PPT theme color — gives a "pro" feel showing current theme
  const uiAccent = mode === 'dark' ? pptTheme.colors.secondary : pptTheme.colors.primary;
  const selectedSlide = editor.presentation.slides[editor.selectedSlideIndex];
  const slideCount = editor.presentation.slides.length;
  const selIdx = editor.selectedSlideIndex;

  // Active field for the editor drawer. Default to first field of current slide.
  const [activeField, setActiveField] = useState<FieldId | null>(null);
  useEffect(() => {
    if (!selectedSlide) {
      setActiveField(null);
      return;
    }
    const fields = fieldsForLayout(selectedSlide.layout, selectedSlide.content);
    setActiveField(fields[0] ?? null);
    // Reset only when the slide or its layout changes, not on every keystroke.
  }, [selIdx, selectedSlide?.layout]);

  // Subtle fade when switching slides — gives the canvas a "live" feel.
  const canvasOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    canvasOpacity.setValue(0.45);
    Animated.timing(canvasOpacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [selIdx, selectedSlide?.layout, canvasOpacity]);

  // ─── Create (generate → save to app library → success alert) ──
  const handleCreate = useCallback(async () => {
    if (isCreating) return;
    const title = editor.presentation.title.trim();
    if (!title) {
      Alert.alert('Title required', 'Give your presentation a title before creating it.');
      return;
    }
    setIsCreating(true);
    try {
      const res = await exporter.exportPPTX({ ...editor.presentation, title });
      if (res?.success && res.filePath) {
        const fileUri = res.filePath.startsWith('file://')
          ? res.filePath
          : `file://${res.filePath}`;
        await markFileAsCreated(fileUri, title, 'pptx');
        Alert.alert('PPT Created', 'Your PPT file has been created successfully!', [
          { text: 'OK' },
        ]);
      } else {
        Alert.alert('Error', res?.error ?? 'Failed to create presentation.');
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create presentation.');
    } finally {
      setIsCreating(false);
      exporter.reset();
    }
  }, [editor.presentation, exporter, isCreating]);

  // ─── Present: export the live deck to a temp .pptx and open it in the
  // high-fidelity /ppt-viewer (PDF render + offline HTML fallback). The
  // native SlideCard renderer drops styling on round-trip, so we always
  // view real files through the same pipeline used elsewhere in the app.
  const handlePresent = useCallback(async () => {
    if (isPreparingPresent) return;
    const title = editor.presentation.title.trim();
    if (!title) {
      Alert.alert('Title required', 'Give your presentation a title before previewing it.');
      return;
    }
    setIsPreparingPresent(true);
    try {
      const res = await exporter.exportPPTX({ ...editor.presentation, title });
      if (res?.success && res.filePath) {
        const uri = res.filePath.startsWith('file://')
          ? res.filePath
          : `file://${res.filePath}`;
        router.push({
          pathname: '/ppt-viewer',
          params: {
            uri: encodeURIComponent(uri),
            name: title,
          },
        });
      } else {
        Alert.alert('Error', res?.error ?? 'Failed to prepare preview.');
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to prepare preview.');
    } finally {
      setIsPreparingPresent(false);
      exporter.reset();
    }
  }, [editor.presentation, exporter, isPreparingPresent, router]);

  // ─── Save to Device (generate silently → system share/save sheet) ──
  const handleSaveToDevice = useCallback(async () => {
    const title = editor.presentation.title.trim();
    if (!title) {
      Alert.alert('Title required', 'Give your presentation a title before saving it.');
      return;
    }
    const res = await exporter.exportPPTX({ ...editor.presentation, title });
    if (res?.success && res.filePath) {
      await saveFileToDevice({
        sourceUri: res.filePath,
        fileName: `${title}.pptx`,
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

  // ─── Slide management ──
  const handleAddSlide = useCallback(() => {
    Alert.alert('Add Slide', 'Choose a layout:', [
      { text: 'Content',       onPress: () => editor.addSlide('titleContent',  editor.selectedSlideIndex) },
      { text: 'Agenda',        onPress: () => editor.addSlide('agenda',        editor.selectedSlideIndex) },
      { text: 'Comparison',    onPress: () => editor.addSlide('comparison',    editor.selectedSlideIndex) },
      { text: 'Process Steps', onPress: () => editor.addSlide('processSteps',  editor.selectedSlideIndex) },
      { text: 'Quote',         onPress: () => editor.addSlide('quote',         editor.selectedSlideIndex) },
      { text: 'Section Divider', onPress: () => editor.addSlide('sectionDivider', editor.selectedSlideIndex) },
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
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            editor.deleteSlide(index);
            // Keep a valid selection after removing the last slide.
            if (index >= editor.presentation.slides.length - 1) {
              editor.selectSlide(Math.max(0, index - 1));
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [editor],
  );

  const handleDuplicate = useCallback(
    (index: number) => {
      editor.duplicateSlide(index);
      editor.selectSlide(index + 1);
    },
    [editor],
  );

  const handleMove = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= editor.presentation.slides.length) return;
      editor.reorderSlide(from, to);
      editor.selectSlide(to);
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
            {/* Row 1: Back · Presentation title (roomy) · Create */}
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={onGoBack}
                hitSlop={10}
                style={styles.gradientIconBtn}
              >
                <ArrowLeft size={18} color="#FFFFFF" strokeWidth={2.2} />
              </TouchableOpacity>

              {/* This title is the presentation name AND the exported file name */}
              <TextInput
                style={styles.titleInput}
                value={editor.presentation.title}
                onChangeText={editor.updateTitle}
                placeholder="Presentation title"
                placeholderTextColor="rgba(255,255,255,0.5)"
                returnKeyType="done"
              />

              {/* Primary "Create" button — saves to app library */}
              <TouchableOpacity
                style={[styles.createBtn, isCreating && styles.createBtnDisabled]}
                onPress={handleCreate}
                disabled={isCreating}
                activeOpacity={0.85}
              >
                {isCreating ? (
                  <ActivityIndicator size={14} color="#FFFFFF" />
                ) : null}
                <Text style={styles.createBtnText}>
                  {isCreating ? 'Creating…' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Row 2: Theme button · Present · Save to device */}
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

              <View style={styles.headerRow2Right}>
                {/* "Present" — high-fidelity preview via /ppt-viewer */}
                <TouchableOpacity
                  style={[styles.gradientIconBtnSm, isPreparingPresent && { opacity: 0.6 }]}
                  onPress={handlePresent}
                  disabled={isPreparingPresent}
                  hitSlop={6}
                  activeOpacity={0.85}
                >
                  {isPreparingPresent ? (
                    <ActivityIndicator size={12} color="#FFFFFF" />
                  ) : (
                    <Play size={14} color="#FFFFFF" strokeWidth={2.2} fill="#FFFFFF" />
                  )}
                </TouchableOpacity>

                {/* "Save to Device" */}
                <TouchableOpacity
                  style={styles.gradientIconBtnSm}
                  onPress={handleSaveToDevice}
                  hitSlop={6}
                  activeOpacity={0.85}
                >
                  <Download size={14} color="#FFFFFF" strokeWidth={2.2} />
                </TouchableOpacity>
              </View>
            </View>
          </GradientView>
        </AppHeaderContainer>

        {/* ─── Sub-bar (below header): Undo/Redo · Slide count ───────── */}
        <View style={[styles.subBar, { backgroundColor: t.background, borderBottomColor: t.border }]}>
          <TouchableOpacity
            onPress={editor.undo}
            disabled={!editor.canUndo}
            style={[styles.subBarBtn, { backgroundColor: t.backgroundSecondary, borderColor: t.border }]}
            hitSlop={6}
            activeOpacity={0.7}
          >
            <RotateCcw size={14} color={editor.canUndo ? uiAccent : t.textTertiary} strokeWidth={2.2} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={editor.redo}
            disabled={!editor.canRedo}
            style={[styles.subBarBtn, { backgroundColor: t.backgroundSecondary, borderColor: t.border }]}
            hitSlop={6}
            activeOpacity={0.7}
          >
            <RotateCw size={14} color={editor.canRedo ? uiAccent : t.textTertiary} strokeWidth={2.2} />
          </TouchableOpacity>

          <Text style={[styles.subBarInfo, { color: t.textSecondary }]}>
            Slide {selIdx + 1} / {slideCount}
            {editor.isDirty ? ' · Unsaved' : ''}
          </Text>
        </View>

        {/* ─── Main Editing Area ────────────────────── */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.canvasArea}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Interactive Slide Canvas — read-only preview, tap any region to edit */}
          {selectedSlide ? (
            <Animated.View style={{ opacity: canvasOpacity, width: '100%', alignItems: 'center' }}>
              <InteractiveSlideCanvas
                slide={selectedSlide}
                theme={pptTheme}
                activeField={activeField}
                onFieldFocus={setActiveField}
              />
            </Animated.View>
          ) : (
            <View style={styles.emptySlate}>
              <Text style={[styles.emptyMsg, { color: t.textTertiary }]}>No slide selected</Text>
            </View>
          )}

          {/* Field editor drawer — comfortable composer for the active field */}
          {selectedSlide ? (
            <SlideFieldEditor
              slide={selectedSlide}
              theme={pptTheme}
              activeField={activeField}
              onActiveFieldChange={setActiveField}
              onChange={content =>
                editor.updateSlideContent(editor.selectedSlideIndex, content)
              }
              accent={uiAccent}
            />
          ) : null}

          {/* ─── Slide Action Bar ─── */}
          {selectedSlide ? (
            <View style={styles.actionBar}>
              {[
                {
                  key: 'dup',
                  label: 'Duplicate',
                  Icon: Copy,
                  disabled: false,
                  onPress: () => handleDuplicate(selIdx),
                },
                {
                  key: 'left',
                  label: 'Move left',
                  Icon: ChevronLeft,
                  disabled: selIdx === 0,
                  onPress: () => handleMove(selIdx, selIdx - 1),
                },
                {
                  key: 'right',
                  label: 'Move right',
                  Icon: ChevronRight,
                  disabled: selIdx >= slideCount - 1,
                  onPress: () => handleMove(selIdx, selIdx + 1),
                },
                {
                  key: 'del',
                  label: 'Delete',
                  Icon: Trash2,
                  disabled: slideCount <= 1,
                  danger: true,
                  onPress: () => handleDeleteSlide(selIdx),
                },
              ].map(a => (
                <TouchableOpacity
                  key={a.key}
                  onPress={a.onPress}
                  disabled={a.disabled}
                  activeOpacity={0.7}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: t.backgroundSecondary, borderColor: t.border },
                    a.disabled && styles.actionBtnDisabled,
                  ]}
                >
                  <a.Icon
                    size={14}
                    color={a.danger ? '#EF4444' : uiAccent}
                    strokeWidth={2.1}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.actionBtnLabel,
                      { color: a.danger ? '#EF4444' : t.textSecondary },
                    ]}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

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
                    <Text style={[styles.layoutIcon, { color: active ? uiAccent : t.textSecondary }]}>{l.icon}</Text>
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
          onDuplicate={handleDuplicate}
          onMove={handleMove}
          onAddAfter={index => editor.addSlide('titleContent', index)}
          onAdd={handleAddSlide}
        />
      </KeyboardAvoidingView>

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
    fontSize: 17,
    fontWeight: '700',
    padding: 0,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  gradientIconBtnSm: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  createBtnDisabled: {
    opacity: 0.6,
  },
  createBtnText: {
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
  headerRow2Right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },

  // ── Sub-bar (undo/redo + slide count, below gradient header) ──
  subBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subBarBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subBarInfo: {
    fontSize: 12,
    fontWeight: '600',
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

  // ── Slide action bar ──
  actionBar: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnLabel: {
    fontSize: 9.5,
    fontWeight: '600',
  },

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
