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
import { useTheme } from '@/services/ThemeProvider';
import { Slide, SlideLayout, SlideContent, PPTTheme } from '../../types/ppt.types';

const LAYOUTS: { id: SlideLayout; label: string; icon: string }[] = [
  { id: 'title',         label: 'Title',     icon: '⬛' },
  { id: 'titleContent',  label: 'Content',   icon: '▤' },
  { id: 'twoColumn',    label: '2 Column',  icon: '▥' },
  { id: 'imageLeft',    label: 'Img Left',  icon: '▧' },
  { id: 'imageRight',   label: 'Img Right', icon: '▨' },
  { id: 'statHighlight', label: 'Stat',     icon: '📊' },
  { id: 'timeline',     label: 'Timeline',  icon: '📅' },
  { id: 'closing',      label: 'Closing',   icon: '🏁' },
  { id: 'blank',        label: 'Blank',     icon: '□' },
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
  const { colors: t } = useTheme();
  const accent = theme.colors.primary;

  const input = useCallback(
    (
      label: string,
      key: keyof SlideContent,
      multiline?: boolean,
      placeholder?: string,
    ) => (
      <View style={styles.field} key={key}>
        <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>{label}</Text>
        <TextInput
          style={[
            styles.input,
            multiline && styles.inputMulti,
            { borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary },
          ]}
          value={typeof content[key] === 'string' ? (content[key] as string) : ''}
          onChangeText={val => onChange({ [key]: val })}
          placeholder={placeholder ?? label}
          placeholderTextColor={t.textTertiary}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          returnKeyType={multiline ? 'default' : 'next'}
        />
      </View>
    ),
    [content, onChange, t],
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: t.card }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Layout Picker */}
      <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>Slide Layout</Text>
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
              { borderColor: t.border, backgroundColor: t.backgroundSecondary },
              l.id === layout && {
                borderColor: accent,
                backgroundColor: accent + '14',
              },
            ]}
            activeOpacity={0.75}
          >
            <Text style={styles.layoutIcon}>{l.icon}</Text>
            <Text
              style={[
                styles.layoutLabel,
                { color: t.textSecondary },
                l.id === layout && { color: accent, fontWeight: '700' },
              ]}
            >
              {l.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

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
            <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Big Number / Stat Value</Text>
            <TextInput
              style={[styles.input, { borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary }]}
              value={content.stat?.value ?? ''}
              onChangeText={val =>
                onChange({ stat: { ...content.stat, value: val, label: content.stat?.label ?? '' } })
              }
              placeholder="94%"
              placeholderTextColor={t.textTertiary}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Stat Label</Text>
            <TextInput
              style={[styles.input, { borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary }]}
              value={content.stat?.label ?? ''}
              onChangeText={val =>
                onChange({ stat: { value: content.stat?.value ?? '', label: val } })
              }
              placeholder="Customer Satisfaction"
              placeholderTextColor={t.textTertiary}
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
        <Text style={[styles.blankMsg, { color: t.textTertiary }]}>
          Blank slide — no content fields required.
        </Text>
      )}

      <View style={[styles.divider, { backgroundColor: t.borderLight }]} />

      {/* Speaker Notes */}
      <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Speaker Notes</Text>
      <TextInput
        style={[
          styles.input,
          styles.inputMulti,
          styles.notesInput,
          { borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary },
        ]}
        value={slide.speakerNotes ?? ''}
        onChangeText={onNotesChange}
        placeholder="Notes visible only to you during presentation…"
        placeholderTextColor={t.textTertiary}
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
}> = ({ bullets, onChange, accent }) => {
  const { colors: t } = useTheme();
  return (
    <View style={styles.field}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Bullet Points</Text>
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
            style={[styles.input, { flex: 1, borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary }]}
            value={b}
            onChangeText={val => {
              const next = [...bullets];
              next[i] = val;
              onChange(next);
            }}
            placeholder={`Bullet ${i + 1}`}
            placeholderTextColor={t.textTertiary}
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
};

// ─── Timeline Sub-editor ─────────────────────
const TimelineEditor: React.FC<{
  items: Array<{ year: string; event: string }>;
  onChange: (items: Array<{ year: string; event: string }>) => void;
  accent: string;
}> = ({ items, onChange, accent }) => {
  const { colors: t } = useTheme();
  return (
    <View style={styles.field}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Timeline Events</Text>
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
            style={[styles.input, { width: 60, marginRight: 6, borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary }]}
            value={item.year}
            onChangeText={val => {
              const next = [...items];
              next[i] = { ...next[i], year: val };
              onChange(next);
            }}
            placeholder="Year"
            placeholderTextColor={t.textTertiary}
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 6, borderColor: t.border, color: t.text, backgroundColor: t.backgroundSecondary }]}
            value={item.event}
            onChangeText={val => {
              const next = [...items];
              next[i] = { ...next[i], event: val };
              onChange(next);
            }}
            placeholder="Event description"
            placeholderTextColor={t.textTertiary}
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
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  layoutRow: { gap: 8, paddingBottom: 4 },
  layoutChip: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    minWidth: 64,
  },
  layoutIcon: { fontSize: 15, marginBottom: 2 },
  layoutLabel: { fontSize: 10, fontWeight: '500' },
  divider: { height: 1, marginVertical: 16 },
  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 42,
  },
  inputMulti: { minHeight: 96, paddingTop: 10 },
  notesInput: {
    minHeight: 80,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  addBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addBtnText: { fontSize: 12, fontWeight: '600' },
  deleteBtn: { padding: 8 },
  deleteBtnText: { color: '#EF4444', fontSize: 13, fontWeight: '700' },
  blankMsg: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 40,
    fontStyle: 'italic',
  },
});
