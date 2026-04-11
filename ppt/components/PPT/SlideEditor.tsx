// ─────────────────────────────────────────────
//  PPT Module — SlideEditor Component
//  Form to edit content of the selected slide.
// ─────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Slide, SlideLayout, SlideContent, PPTTheme } from '../../types/ppt.types';

const LAYOUTS: { id: SlideLayout; label: string; icon: string }[] = [
  { id: 'title',        label: 'Title',       icon: '🎯' },
  { id: 'titleContent', label: 'Content',     icon: '📝' },
  { id: 'twoColumn',   label: '2 Column',    icon: '⬛⬛' },
  { id: 'imageLeft',   label: 'Img Left',    icon: '🖼️◀' },
  { id: 'imageRight',  label: 'Img Right',   icon: '▶🖼️' },
  { id: 'statHighlight',label: 'Big Stat',   icon: '📊' },
  { id: 'timeline',    label: 'Timeline',    icon: '📅' },
  { id: 'closing',     label: 'Closing',     icon: '🏁' },
  { id: 'blank',       label: 'Blank',       icon: '⬜' },
];

interface SlideEditorProps {
  slide: Slide;
  theme: PPTTheme;
  onChange: (content: Partial<SlideContent>) => void;
  onLayoutChange: (layout: SlideLayout) => void;
  onNotesChange: (notes: string) => void;
}

export const SlideEditor: React.FC<SlideEditorProps> = ({
  slide,
  theme,
  onChange,
  onLayoutChange,
  onNotesChange,
}) => {
  const { content, layout } = slide;
  const accent = theme.colors.primary;

  const input = useCallback(
    (
      label: string,
      key: keyof SlideContent,
      multiline?: boolean,
      placeholder?: string,
    ) => (
      <View style={styles.field} key={key}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={[
            styles.input,
            multiline && styles.inputMulti,
            { borderColor: '#E5E7EB' },
          ]}
          value={typeof content[key] === 'string' ? (content[key] as string) : ''}
          onChangeText={val => onChange({ [key]: val })}
          placeholder={placeholder ?? label}
          placeholderTextColor="#9CA3AF"
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          returnKeyType={multiline ? 'default' : 'next'}
        />
      </View>
    ),
    [content, onChange],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Layout Picker */}
      <Text style={styles.sectionLabel}>Slide Layout</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.layoutRow}
      >
        {LAYOUTS.map(l => (
          <TouchableOpacity
            key={l.id}
            onPress={() => onLayoutChange(l.id)}
            style={[
              styles.layoutChip,
              l.id === layout && { borderColor: accent, backgroundColor: accent + '18' },
            ]}
            activeOpacity={0.75}
          >
            <Text style={styles.layoutIcon}>{l.icon}</Text>
            <Text
              style={[
                styles.layoutLabel,
                l.id === layout && { color: accent, fontWeight: '700' },
              ]}
            >
              {l.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.divider} />

      {/* Dynamic fields based on layout */}
      {(layout === 'title' || layout === 'closing') && (
        <>
          {input('Title', 'title', false, 'Presentation title')}
          {input('Subtitle', 'subtitle', false, 'Subtitle or tagline')}
        </>
      )}

      {layout === 'titleContent' && (
        <>
          {input('Slide Title', 'title', false, 'Section heading')}
          {input('Body Text', 'body', true, 'Paragraph or explanation…')}
          <BulletsEditor
            bullets={content.bullets ?? []}
            onChange={bullets => onChange({ bullets })}
            accent={accent}
          />
        </>
      )}

      {layout === 'twoColumn' && (
        <>
          {input('Slide Title', 'title', false, 'Column header')}
          {input('Left Column', 'leftContent', true, 'Left column text…')}
          {input('Right Column', 'rightContent', true, 'Right column text…')}
        </>
      )}

      {(layout === 'imageLeft' || layout === 'imageRight') && (
        <>
          {input('Slide Title', 'title', false, 'Title')}
          {input('Body Text', 'body', true, 'Description text…')}
          {input('Image URL', 'imageUri', false, 'https://… or local path')}
        </>
      )}

      {layout === 'statHighlight' && (
        <>
          {input('Section Title', 'title', false, 'e.g. Our Impact')}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Big Number / Stat Value</Text>
            <TextInput
              style={styles.input}
              value={content.stat?.value ?? ''}
              onChangeText={val => onChange({ stat: { ...content.stat, value: val, label: content.stat?.label ?? '' } })}
              placeholder="94%"
              placeholderTextColor="#9CA3AF"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Stat Label</Text>
            <TextInput
              style={styles.input}
              value={content.stat?.label ?? ''}
              onChangeText={val => onChange({ stat: { value: content.stat?.value ?? '', label: val } })}
              placeholder="Customer Satisfaction"
              placeholderTextColor="#9CA3AF"
            />
          </View>
          {input('Footnote (optional)', 'footnote', false, 'Source: Survey 2024')}
        </>
      )}

      {layout === 'timeline' && (
        <>
          {input('Slide Title', 'title', false, 'Timeline title')}
          <TimelineEditor
            items={content.timelineItems ?? []}
            onChange={timelineItems => onChange({ timelineItems })}
            accent={accent}
          />
        </>
      )}

      {layout === 'blank' && (
        <Text style={styles.blankMsg}>
          Blank slide — no content fields required.
        </Text>
      )}

      <View style={styles.divider} />

      {/* Speaker Notes */}
      <Text style={styles.fieldLabel}>Speaker Notes</Text>
      <TextInput
        style={[styles.input, styles.inputMulti, styles.notesInput]}
        value={slide.speakerNotes ?? ''}
        onChangeText={onNotesChange}
        placeholder="Notes visible only to you during presentation…"
        placeholderTextColor="#9CA3AF"
        multiline
        textAlignVertical="top"
      />
    </ScrollView>
  );
};

// ─── Bullets Sub-editor ──────────────────────
const BulletsEditor: React.FC<{
  bullets: string[];
  onChange: (b: string[]) => void;
  accent: string;
}> = ({ bullets, onChange, accent }) => (
  <View style={styles.field}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <Text style={styles.fieldLabel}>Bullet Points</Text>
      <TouchableOpacity
        onPress={() => onChange([...bullets, ''])}
        style={[styles.addBtn, { borderColor: accent }]}
      >
        <Text style={[styles.addBtnText, { color: accent }]}>+ Add</Text>
      </TouchableOpacity>
    </View>
    {bullets.map((b, i) => (
      <View key={i} style={styles.bulletRow}>
        <Text style={{ color: accent, marginRight: 6, marginTop: 10 }}>•</Text>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={b}
          onChangeText={val => {
            const next = [...bullets];
            next[i] = val;
            onChange(next);
          }}
          placeholder={`Bullet ${i + 1}`}
          placeholderTextColor="#9CA3AF"
        />
        <TouchableOpacity
          onPress={() => onChange(bullets.filter((_, j) => j !== i))}
          style={styles.deleteBtn}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    ))}
  </View>
);

// ─── Timeline Sub-editor ─────────────────────
const TimelineEditor: React.FC<{
  items: Array<{ year: string; event: string }>;
  onChange: (items: Array<{ year: string; event: string }>) => void;
  accent: string;
}> = ({ items, onChange, accent }) => (
  <View style={styles.field}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <Text style={styles.fieldLabel}>Timeline Events</Text>
      <TouchableOpacity
        onPress={() => onChange([...items, { year: '', event: '' }])}
        style={[styles.addBtn, { borderColor: accent }]}
      >
        <Text style={[styles.addBtnText, { color: accent }]}>+ Add</Text>
      </TouchableOpacity>
    </View>
    {items.map((item, i) => (
      <View key={i} style={styles.timelineRow}>
        <TextInput
          style={[styles.input, { width: 60, marginRight: 6 }]}
          value={item.year}
          onChangeText={val => {
            const next = [...items];
            next[i] = { ...next[i], year: val };
            onChange(next);
          }}
          placeholder="Year"
          placeholderTextColor="#9CA3AF"
          keyboardType="numeric"
        />
        <TextInput
          style={[styles.input, { flex: 1, marginRight: 6 }]}
          value={item.event}
          onChangeText={val => {
            const next = [...items];
            next[i] = { ...next[i], event: val };
            onChange(next);
          }}
          placeholder="Event description"
          placeholderTextColor="#9CA3AF"
        />
        <TouchableOpacity
          onPress={() => onChange(items.filter((_, j) => j !== i))}
          style={styles.deleteBtn}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  layoutRow: { gap: 8, paddingBottom: 4 },
  layoutChip: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    minWidth: 64,
    backgroundColor: '#FAFAFA',
  },
  layoutIcon: { fontSize: 16, marginBottom: 2 },
  layoutLabel: { fontSize: 10, color: '#374151', fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 16 },
  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#FAFAFA',
    minHeight: 42,
  },
  inputMulti: { minHeight: 96, paddingTop: 10 },
  notesInput: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    minHeight: 80,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  addBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  addBtnText: { fontSize: 12, fontWeight: '600' },
  deleteBtn: { padding: 8 },
  deleteBtnText: { color: '#EF4444', fontSize: 13, fontWeight: '700' },
  blankMsg: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 40,
    fontStyle: 'italic',
  },
});
