// ─────────────────────────────────────────────
//  PPT Module — SlideFieldEditor
//  Comfortable, full-width composer for slide content.
//  Pairs with the read-only InteractiveSlideCanvas preview above.
// ─────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Trash2,
  Plus,
  List,
  Type,
} from 'lucide-react-native';
import { Slide, SlideContent, SlideLayout, PPTTheme } from '../../types/ppt.types';
import { useTheme } from '@/services/ThemeProvider';

// Discriminated union of every editable region on any slide layout.
// One entry per slide field (lists are edited as a single grouped field).
export type FieldId =
  | { kind: 'title' }
  | { kind: 'subtitle' }
  | { kind: 'body' }
  | { kind: 'leftTitle' }
  | { kind: 'leftContent' }
  | { kind: 'rightTitle' }
  | { kind: 'rightContent' }
  | { kind: 'sectionNumber' }
  | { kind: 'footnote' }
  | { kind: 'statValue' }
  | { kind: 'statLabel' }
  | { kind: 'bullets' }
  | { kind: 'steps' }
  | { kind: 'timeline' }
  | { kind: 'image' };

export function fieldsForLayout(layout: SlideLayout, content: SlideContent): FieldId[] {
  switch (layout) {
    case 'title':
    case 'closing':
      return [{ kind: 'title' }, { kind: 'subtitle' }];
    case 'titleContent': {
      const hasBullets = (content.bullets ?? []).length > 0;
      return [{ kind: 'title' }, hasBullets ? { kind: 'bullets' } : { kind: 'body' }];
    }
    case 'twoColumn':
      return [{ kind: 'title' }, { kind: 'leftContent' }, { kind: 'rightContent' }];
    case 'imageLeft':
    case 'imageRight':
      return [{ kind: 'image' }, { kind: 'title' }, { kind: 'body' }];
    case 'statHighlight':
      return [
        { kind: 'title' },
        { kind: 'statValue' },
        { kind: 'statLabel' },
        { kind: 'footnote' },
      ];
    case 'timeline':
      return [{ kind: 'title' }, { kind: 'timeline' }];
    case 'quote':
      return [{ kind: 'body' }, { kind: 'subtitle' }];
    case 'sectionDivider':
      return [{ kind: 'sectionNumber' }, { kind: 'title' }, { kind: 'subtitle' }];
    case 'agenda':
      return [{ kind: 'title' }, { kind: 'bullets' }];
    case 'comparison':
      return [
        { kind: 'title' },
        { kind: 'leftTitle' },
        { kind: 'leftContent' },
        { kind: 'rightTitle' },
        { kind: 'rightContent' },
      ];
    case 'processSteps':
      return [{ kind: 'title' }, { kind: 'steps' }];
    case 'blank':
      return [];
    default:
      return [{ kind: 'title' }, { kind: 'body' }];
  }
}

export function fieldKey(f: FieldId): string {
  return f.kind;
}

interface FieldMeta {
  label: string;
  placeholder: string;
  multiline?: boolean;
  numeric?: boolean;
}

function metaFor(field: FieldId, layout: SlideLayout): FieldMeta {
  switch (field.kind) {
    case 'title':
      if (layout === 'title') return { label: 'Title', placeholder: 'Presentation title' };
      if (layout === 'closing') return { label: 'Title', placeholder: 'Thank you / Closing title' };
      if (layout === 'statHighlight')
        return { label: 'Section label', placeholder: 'e.g. CUSTOMER SATISFACTION' };
      if (layout === 'agenda') return { label: 'Title', placeholder: 'Agenda' };
      if (layout === 'processSteps') return { label: 'Title', placeholder: 'Process' };
      return { label: 'Slide title', placeholder: 'Slide title' };
    case 'subtitle':
      if (layout === 'quote') return { label: 'Attribution', placeholder: 'Author or source' };
      if (layout === 'sectionDivider')
        return { label: 'Description', placeholder: 'Optional description' };
      if (layout === 'closing') return { label: 'Subtitle', placeholder: 'Thank You · Questions?' };
      return { label: 'Subtitle', placeholder: 'Your subtitle here' };
    case 'body':
      if (layout === 'quote')
        return { label: 'Quote', placeholder: 'Type a memorable quote…', multiline: true };
      return { label: 'Body text', placeholder: 'Body text or explanation…', multiline: true };
    case 'leftTitle':
      return { label: 'Left heading', placeholder: 'Option A' };
    case 'leftContent':
      return { label: 'Left content', placeholder: 'Pros / details…', multiline: true };
    case 'rightTitle':
      return { label: 'Right heading', placeholder: 'Option B' };
    case 'rightContent':
      return { label: 'Right content', placeholder: 'Pros / details…', multiline: true };
    case 'sectionNumber':
      return { label: 'Section number', placeholder: '01' };
    case 'footnote':
      return { label: 'Footnote', placeholder: 'Source (optional)' };
    case 'statValue':
      return { label: 'Big number', placeholder: '94%' };
    case 'statLabel':
      return { label: 'Stat label', placeholder: 'Customer satisfaction' };
    case 'bullets':
      return { label: 'Bullet points', placeholder: 'Add a point' };
    case 'steps':
      return { label: 'Steps', placeholder: 'Add a step' };
    case 'timeline':
      return { label: 'Timeline', placeholder: 'Add an event' };
    case 'image':
      return { label: 'Image', placeholder: '' };
  }
}

interface SlideFieldEditorProps {
  slide: Slide;
  theme: PPTTheme;
  activeField: FieldId | null;
  onActiveFieldChange: (f: FieldId | null) => void;
  onChange: (content: Partial<SlideContent>) => void;
  /** Tint color for accents (matches PPT theme) */
  accent: string;
}

export const SlideFieldEditor: React.FC<SlideFieldEditorProps> = ({
  slide,
  theme: _pptTheme,
  activeField,
  onActiveFieldChange,
  onChange,
  accent,
}) => {
  const { colors: t } = useTheme();
  const { layout, content } = slide;
  const fields = useMemo(() => fieldsForLayout(layout, content), [layout, content]);

  // Refs to focus inputs when active field changes
  const primaryInputRef = useRef<TextInput>(null);

  const activeIndex = activeField
    ? fields.findIndex(f => f.kind === activeField.kind)
    : -1;

  useEffect(() => {
    // Auto-focus when single-line / multiline text field is selected
    if (
      activeField &&
      activeField.kind !== 'bullets' &&
      activeField.kind !== 'steps' &&
      activeField.kind !== 'timeline' &&
      activeField.kind !== 'image'
    ) {
      // Small delay so the input is mounted
      const id = setTimeout(() => primaryInputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [activeField]);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) onActiveFieldChange(fields[activeIndex - 1]);
  }, [activeIndex, fields, onActiveFieldChange]);

  const goNext = useCallback(() => {
    if (activeIndex >= 0 && activeIndex < fields.length - 1) {
      onActiveFieldChange(fields[activeIndex + 1]);
    }
  }, [activeIndex, fields, onActiveFieldChange]);

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      onChange({ imageUri: result.assets[0].uri });
    }
  }, [onChange]);

  if (!activeField || fields.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: t.backgroundSecondary, borderColor: t.border }]}>
        <Text style={[styles.emptyText, { color: t.textTertiary }]}>
          {layout === 'blank' ? 'This is a blank slide.' : 'Tap any region on the slide to edit it.'}
        </Text>
      </View>
    );
  }

  const meta = metaFor(activeField, layout);

  // ─── Single text field renderer ───
  // Single-line fields chain with the keyboard's "next" key so a whole slide
  // can be filled without ever leaving the keyboard.
  const hasNext = activeIndex >= 0 && activeIndex < fields.length - 1;
  const renderTextField = (
    value: string,
    onChangeText: (v: string) => void,
    opts: { numeric?: boolean; multiline?: boolean; placeholder: string },
  ) => (
    <TextInput
      ref={primaryInputRef}
      value={value}
      onChangeText={onChangeText}
      placeholder={opts.placeholder}
      placeholderTextColor={t.textTertiary}
      multiline={opts.multiline}
      keyboardType={opts.numeric ? 'numbers-and-punctuation' : 'default'}
      returnKeyType={opts.multiline ? undefined : hasNext ? 'next' : 'done'}
      blurOnSubmit={opts.multiline ? undefined : !hasNext}
      onSubmitEditing={opts.multiline ? undefined : hasNext ? goNext : undefined}
      style={[
        styles.input,
        {
          color: t.text,
          backgroundColor: t.background,
          borderColor: t.border,
          minHeight: opts.multiline ? 120 : 52,
          textAlignVertical: opts.multiline ? 'top' : 'center',
        },
      ]}
    />
  );

  // ─── Body content with bullets/body switcher (titleContent only) ───
  const renderBodyOrBullets = () => {
    const isBullets = activeField.kind === 'bullets';
    const canSwitch = layout === 'titleContent';
    return (
      <View>
        {canSwitch ? (
          <View style={styles.modeRow}>
            <TouchableOpacity
              onPress={() => {
                onChange({ bullets: undefined });
                onActiveFieldChange({ kind: 'body' });
              }}
              style={[
                styles.modeBtn,
                {
                  backgroundColor: !isBullets ? accent : t.backgroundSecondary,
                  borderColor: !isBullets ? accent : t.border,
                },
              ]}
            >
              <Type size={14} color={!isBullets ? '#FFFFFF' : t.textSecondary} />
              <Text
                style={[
                  styles.modeBtnText,
                  { color: !isBullets ? '#FFFFFF' : t.textSecondary },
                ]}
              >
                Paragraph
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!(content.bullets ?? []).length) {
                  onChange({ bullets: [''], body: undefined });
                }
                onActiveFieldChange({ kind: 'bullets' });
              }}
              style={[
                styles.modeBtn,
                {
                  backgroundColor: isBullets ? accent : t.backgroundSecondary,
                  borderColor: isBullets ? accent : t.border,
                },
              ]}
            >
              <List size={14} color={isBullets ? '#FFFFFF' : t.textSecondary} />
              <Text
                style={[
                  styles.modeBtnText,
                  { color: isBullets ? '#FFFFFF' : t.textSecondary },
                ]}
              >
                Bullets
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isBullets ? (
          renderStringList(
            content.bullets ?? [],
            next => onChange({ bullets: next }),
            'point',
          )
        ) : (
          renderTextField(
            content.body ?? '',
            v => onChange({ body: v }),
            { multiline: true, placeholder: meta.placeholder },
          )
        )}
      </View>
    );
  };

  // ─── String-list editor (bullets / steps) ───
  const renderStringList = (
    items: string[],
    onItems: (next: string[]) => void,
    singular: string,
  ) => (
    <View style={{ gap: 8 }}>
      {items.map((item, i) => (
        <View key={i} style={styles.listRow}>
          <View style={[styles.listIndex, { backgroundColor: accent }]}>
            <Text style={styles.listIndexText}>{i + 1}</Text>
          </View>
          <TextInput
            value={item}
            onChangeText={v => {
              const next = [...items];
              next[i] = v;
              onItems(next);
            }}
            placeholder={`${singular.charAt(0).toUpperCase() + singular.slice(1)} ${i + 1}`}
            placeholderTextColor={t.textTertiary}
            style={[
              styles.listInput,
              { color: t.text, backgroundColor: t.background, borderColor: t.border },
            ]}
            multiline
          />
          <TouchableOpacity
            onPress={() => onItems(items.filter((_, j) => j !== i))}
            hitSlop={8}
            style={[styles.iconBtn, { backgroundColor: t.backgroundSecondary }]}
          >
            <Trash2 size={15} color="#EF4444" />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        onPress={() => onItems([...items, ''])}
        style={[styles.addRow, { borderColor: accent }]}
      >
        <Plus size={15} color={accent} />
        <Text style={[styles.addRowText, { color: accent }]}>Add {singular}</Text>
      </TouchableOpacity>
    </View>
  );

  // ─── Timeline editor ───
  const renderTimeline = () => {
    const items = content.timelineItems ?? [];
    return (
      <View style={{ gap: 8 }}>
        {items.map((item, i) => (
          <View key={i} style={styles.timelineRow}>
            <TextInput
              value={item.year}
              onChangeText={v => {
                const next = [...items];
                next[i] = { ...next[i], year: v };
                onChange({ timelineItems: next });
              }}
              placeholder="Year"
              placeholderTextColor={t.textTertiary}
              keyboardType="numbers-and-punctuation"
              style={[
                styles.timelineYearInput,
                { color: t.text, backgroundColor: t.background, borderColor: t.border },
              ]}
            />
            <TextInput
              value={item.event}
              onChangeText={v => {
                const next = [...items];
                next[i] = { ...next[i], event: v };
                onChange({ timelineItems: next });
              }}
              placeholder="Event description"
              placeholderTextColor={t.textTertiary}
              style={[
                styles.timelineEventInput,
                { color: t.text, backgroundColor: t.background, borderColor: t.border },
              ]}
              multiline
            />
            <TouchableOpacity
              onPress={() =>
                onChange({ timelineItems: items.filter((_, j) => j !== i) })
              }
              hitSlop={8}
              style={[styles.iconBtn, { backgroundColor: t.backgroundSecondary }]}
            >
              <Trash2 size={15} color="#EF4444" />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          onPress={() =>
            onChange({ timelineItems: [...items, { year: '', event: '' }] })
          }
          style={[styles.addRow, { borderColor: accent }]}
        >
          <Plus size={15} color={accent} />
          <Text style={[styles.addRowText, { color: accent }]}>Add event</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Image picker field ───
  const renderImage = () => (
    <TouchableOpacity
      onPress={pickImage}
      activeOpacity={0.85}
      style={[
        styles.imagePicker,
        {
          backgroundColor: content.imageUri ? 'transparent' : t.backgroundSecondary,
          borderColor: t.border,
        },
      ]}
    >
      {content.imageUri ? (
        <View style={styles.imagePreviewWrap}>
          <Text style={[styles.imageReplaceText, { color: accent }]}>
            Tap to replace image
          </Text>
        </View>
      ) : (
        <>
          <ImagePlus size={26} color={accent} strokeWidth={1.8} />
          <Text style={[styles.imagePickerText, { color: t.text }]}>Tap to add an image</Text>
          <Text style={[styles.imagePickerSub, { color: t.textTertiary }]}>
            Pick from your gallery
          </Text>
        </>
      )}
    </TouchableOpacity>
  );

  // ─── Body picker: which UI to show for the active field ───
  const renderActiveField = () => {
    switch (activeField.kind) {
      case 'title':
        return renderTextField(content.title ?? '', v => onChange({ title: v }), {
          placeholder: meta.placeholder,
        });
      case 'subtitle':
        return renderTextField(content.subtitle ?? '', v => onChange({ subtitle: v }), {
          placeholder: meta.placeholder,
          multiline: true,
        });
      case 'body':
      case 'bullets':
        return renderBodyOrBullets();
      case 'leftTitle':
        return renderTextField(content.leftTitle ?? '', v => onChange({ leftTitle: v }), {
          placeholder: meta.placeholder,
        });
      case 'leftContent':
        return renderTextField(
          content.leftContent ?? '',
          v => onChange({ leftContent: v }),
          { placeholder: meta.placeholder, multiline: true },
        );
      case 'rightTitle':
        return renderTextField(content.rightTitle ?? '', v => onChange({ rightTitle: v }), {
          placeholder: meta.placeholder,
        });
      case 'rightContent':
        return renderTextField(
          content.rightContent ?? '',
          v => onChange({ rightContent: v }),
          { placeholder: meta.placeholder, multiline: true },
        );
      case 'sectionNumber':
        return renderTextField(
          content.sectionNumber ?? '',
          v => onChange({ sectionNumber: v }),
          { placeholder: meta.placeholder, numeric: true },
        );
      case 'footnote':
        return renderTextField(content.footnote ?? '', v => onChange({ footnote: v }), {
          placeholder: meta.placeholder,
        });
      case 'statValue':
        return renderTextField(
          content.stat?.value ?? '',
          v => onChange({ stat: { value: v, label: content.stat?.label ?? '' } }),
          { placeholder: meta.placeholder },
        );
      case 'statLabel':
        return renderTextField(
          content.stat?.label ?? '',
          v => onChange({ stat: { value: content.stat?.value ?? '', label: v } }),
          { placeholder: meta.placeholder },
        );
      case 'steps':
        return renderStringList(
          content.steps ?? [],
          next => onChange({ steps: next }),
          'step',
        );
      case 'timeline':
        return renderTimeline();
      case 'image':
        return renderImage();
    }
  };

  const showPrevNext = fields.length > 1;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: t.card, borderColor: t.border },
      ]}
    >
      {/* Field navigator: prev · label · next */}
      <View style={[styles.navBar, { borderBottomColor: t.border }]}>
        {showPrevNext ? (
          <TouchableOpacity
            onPress={goPrev}
            disabled={activeIndex <= 0}
            hitSlop={6}
            style={[
              styles.navBtn,
              { backgroundColor: t.backgroundSecondary },
              activeIndex <= 0 && styles.navBtnDisabled,
            ]}
          >
            <ChevronLeft
              size={16}
              color={activeIndex <= 0 ? t.textTertiary : t.text}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        ) : null}

        <View style={styles.navLabelWrap}>
          <Text style={[styles.navLabel, { color: accent }]}>{meta.label}</Text>
          {fields.length > 1 ? (
            <Text style={[styles.navCount, { color: t.textTertiary }]}>
              Field {activeIndex + 1} of {fields.length}
            </Text>
          ) : null}
        </View>

        {showPrevNext ? (
          <TouchableOpacity
            onPress={goNext}
            disabled={activeIndex >= fields.length - 1}
            hitSlop={6}
            style={[
              styles.navBtn,
              { backgroundColor: t.backgroundSecondary },
              activeIndex >= fields.length - 1 && styles.navBtnDisabled,
            ]}
          >
            <ChevronRight
              size={16}
              color={activeIndex >= fields.length - 1 ? t.textTertiary : t.text}
              strokeWidth={2.4}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.body}>{renderActiveField()}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  empty: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, textAlign: 'center' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.35 },
  navLabelWrap: { flex: 1, alignItems: 'center' },
  navLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  navCount: {
    fontSize: 10.5,
    fontWeight: '500',
    marginTop: 1,
  },
  body: { padding: 12, gap: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 16,
    lineHeight: 22,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  modeBtnText: { fontSize: 13, fontWeight: '600' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  listIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  listIndexText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  listInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 44,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  timelineYearInput: {
    width: 72,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    fontWeight: '700',
    minHeight: 44,
    textAlign: 'center',
  },
  timelineEventInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    minHeight: 44,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  addRowText: { fontSize: 13, fontWeight: '700' },
  imagePicker: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 6,
  },
  imagePickerText: { fontSize: 14, fontWeight: '700' },
  imagePickerSub: { fontSize: 11.5 },
  imagePreviewWrap: { alignItems: 'center', paddingVertical: 8 },
  imageReplaceText: { fontSize: 13, fontWeight: '700' },
});
