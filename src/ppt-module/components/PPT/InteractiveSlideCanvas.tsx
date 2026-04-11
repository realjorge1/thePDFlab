// ─────────────────────────────────────────────
//  PPT Module — InteractiveSlideCanvas
//  Full-width editable slide canvas.
//  TextInputs live directly inside the slide layout —
//  no separate form panel needed.
// ─────────────────────────────────────────────

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Slide, SlideContent, PPTTheme } from '../../types/ppt.types';
import { ImagePlus } from 'lucide-react-native';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 16;
const CANVAS_W = SCREEN_W - H_PAD * 2;
const CANVAS_H = Math.round(CANVAS_W * 9 / 16);
const ACCENT_W = 4;
const INNER_PAD = 11;

// Font sizes — proportional and readable within the canvas
const FS_TITLE_HERO = Math.round(CANVAS_H * 0.13);   // ~26px — title/closing hero
const FS_SUBTITLE   = Math.round(CANVAS_H * 0.085);  // ~17px
const FS_TITLE      = Math.round(CANVAS_H * 0.088);  // ~18px — regular slide titles
const FS_BODY       = Math.round(CANVAS_H * 0.068);  // ~14px
const FS_SMALL      = Math.round(CANVAS_H * 0.057);  // ~11px
const FS_STAT       = Math.round(CANVAS_H * 0.38);   // ~76px — big stat number

interface InteractiveSlideCanvasProps {
  slide: Slide;
  theme: PPTTheme;
  onChange: (content: Partial<SlideContent>) => void;
}

export const InteractiveSlideCanvas: React.FC<InteractiveSlideCanvasProps> = ({
  slide,
  theme,
  onChange,
}) => {
  const { layout, content } = slide;
  const c = theme.colors;

  const isOnDark =
    layout === 'title' ||
    layout === 'closing' ||
    layout === 'statHighlight';

  const bgColor = isOnDark ? c.backgroundDark : c.background;
  const phColor = isOnDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)';

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

  // ── Input style helper ──────────────────────
  const inp = (
    color: string,
    fontSize: number,
    opts?: { bold?: boolean; center?: boolean; flex?: boolean; italic?: boolean },
  ): object => ({
    color,
    fontSize,
    fontWeight: opts?.bold ? ('700' as const) : ('400' as const),
    fontStyle: opts?.italic ? ('italic' as const) : ('normal' as const),
    textAlign: opts?.center ? ('center' as const) : ('left' as const),
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    ...(opts?.flex ? { flex: 1, textAlignVertical: 'top' as const } : {}),
    ...(Platform.OS === 'android' ? { paddingVertical: 0 } : {}),
  });

  const Divider = ({ color, opacity = 1 }: { color: string; opacity?: number }) => (
    <View style={[styles.divider, { backgroundColor: color, opacity }]} />
  );

  // ── Layout renderers ────────────────────────

  const renderTitle = () => (
    <View style={styles.centered}>
      <TextInput
        value={content.title ?? ''}
        onChangeText={v => onChange({ title: v })}
        style={inp(c.textOnDark, FS_TITLE_HERO, { bold: true, center: true })}
        placeholder={layout === 'closing' ? 'Closing Title' : 'Presentation Title'}
        placeholderTextColor={phColor}
        multiline
      />
      <View style={[styles.heroDivider, { backgroundColor: c.secondary }]} />
      <TextInput
        value={content.subtitle ?? ''}
        onChangeText={v => onChange({ subtitle: v })}
        style={inp(c.secondary, FS_SUBTITLE, { center: true })}
        placeholder={layout === 'closing' ? 'Thank You · Questions?' : 'Your subtitle here'}
        placeholderTextColor={phColor}
        multiline
      />
    </View>
  );

  const renderTitleContent = () => (
    <View style={styles.full}>
      <TextInput
        value={content.title ?? ''}
        onChangeText={v => onChange({ title: v })}
        style={[inp(c.primary, FS_TITLE, { bold: true }), { marginBottom: 5 }]}
        placeholder="Slide Title"
        placeholderTextColor={phColor}
        returnKeyType="next"
      />
      <Divider color={c.primary} opacity={0.2} />

      {/* Bullets mode */}
      {(content.bullets ?? []).length > 0 ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
          {(content.bullets ?? []).map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: c.primary }]} />
              <TextInput
                value={b}
                onChangeText={val => {
                  const next = [...(content.bullets ?? [])];
                  next[i] = val;
                  onChange({ bullets: next });
                }}
                style={[inp(c.text, FS_BODY), { flex: 1 }]}
                placeholder={`Point ${i + 1}`}
                placeholderTextColor={phColor}
              />
              <TouchableOpacity
                onPress={() =>
                  onChange({ bullets: (content.bullets ?? []).filter((_, j) => j !== i) })
                }
                hitSlop={8}
              >
                <Text style={styles.deleteX}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            onPress={() => onChange({ bullets: [...(content.bullets ?? []), ''] })}
            style={styles.addBtn}
          >
            <Text style={[styles.addBtnText, { color: c.primary }]}>+ Add point</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onChange({ bullets: undefined })}
            style={styles.addBtn}
          >
            <Text style={[styles.addBtnText, { color: c.textMuted }]}>Switch to body text</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        /* Body text mode */
        <>
          <TextInput
            value={content.body ?? ''}
            onChangeText={v => onChange({ body: v })}
            style={[inp(c.text, FS_BODY, { flex: true }), { paddingTop: 5 }]}
            placeholder="Body text or explanation…"
            placeholderTextColor={phColor}
            multiline
          />
          <TouchableOpacity
            onPress={() => onChange({ bullets: [''], body: undefined })}
            style={styles.addBtn}
          >
            <Text style={[styles.addBtnText, { color: c.primary }]}>+ Use bullets</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderTwoColumn = () => (
    <View style={styles.full}>
      <TextInput
        value={content.title ?? ''}
        onChangeText={v => onChange({ title: v })}
        style={[inp(c.primary, FS_TITLE, { bold: true }), { marginBottom: 5 }]}
        placeholder="Section Title"
        placeholderTextColor={phColor}
      />
      <Divider color={c.primary} opacity={0.2} />
      <View style={styles.columns}>
        <TextInput
          value={content.leftContent ?? ''}
          onChangeText={v => onChange({ leftContent: v })}
          style={[
            inp(c.text, FS_BODY, { flex: true }),
            { paddingTop: 4, paddingRight: 6, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.secondary + '80' },
          ]}
          placeholder="Left column…"
          placeholderTextColor={phColor}
          multiline
        />
        <TextInput
          value={content.rightContent ?? ''}
          onChangeText={v => onChange({ rightContent: v })}
          style={[inp(c.text, FS_BODY, { flex: true }), { paddingTop: 4, paddingLeft: 6 }]}
          placeholder="Right column…"
          placeholderTextColor={phColor}
          multiline
        />
      </View>
    </View>
  );

  const renderImageSide = (imageLeft: boolean) => {
    const imageArea = (
      <TouchableOpacity
        onPress={pickImage}
        activeOpacity={0.78}
        style={[styles.imagePicker, { backgroundColor: c.secondary + '28' }]}
      >
        {content.imageUri ? (
          <Image
            source={{ uri: content.imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <>
            <ImagePlus size={20} color={c.primary} strokeWidth={1.5} />
            <Text style={[styles.imagePickerLabel, { color: c.primary }]}>Tap to add image</Text>
          </>
        )}
      </TouchableOpacity>
    );
    const textArea = (
      <View style={{ flex: 1, gap: 5 }}>
        <TextInput
          value={content.title ?? ''}
          onChangeText={v => onChange({ title: v })}
          style={inp(c.primary, FS_TITLE - 2, { bold: true })}
          placeholder="Title"
          placeholderTextColor={phColor}
          multiline
        />
        <TextInput
          value={content.body ?? ''}
          onChangeText={v => onChange({ body: v })}
          style={inp(c.text, FS_BODY, { flex: true })}
          placeholder="Description…"
          placeholderTextColor={phColor}
          multiline
        />
      </View>
    );
    return (
      <View style={[styles.full, { flexDirection: 'row', gap: 7 }]}>
        {imageLeft ? imageArea : textArea}
        {imageLeft ? textArea : imageArea}
      </View>
    );
  };

  const renderStat = () => {
    const statColor = c.accent === '#FFFFFF' ? c.secondary : c.accent;
    return (
      <View style={styles.centered}>
        <TextInput
          value={content.title ?? ''}
          onChangeText={v => onChange({ title: v })}
          style={[inp(c.secondary, FS_SMALL, { center: true }), { marginBottom: 6, opacity: 0.85 }]}
          placeholder="Section Label"
          placeholderTextColor={phColor}
        />
        <TextInput
          value={content.stat?.value ?? ''}
          onChangeText={v => onChange({ stat: { value: v, label: content.stat?.label ?? '' } })}
          style={inp(statColor, FS_STAT, { bold: true, center: true })}
          placeholder="94%"
          placeholderTextColor={phColor}
          keyboardType="default"
        />
        <TextInput
          value={content.stat?.label ?? ''}
          onChangeText={v => onChange({ stat: { value: content.stat?.value ?? '', label: v } })}
          style={[inp(c.textOnDark, FS_BODY, { center: true }), { marginTop: 4 }]}
          placeholder="Stat label"
          placeholderTextColor={phColor}
        />
        <TextInput
          value={content.footnote ?? ''}
          onChangeText={v => onChange({ footnote: v })}
          style={[inp(c.secondary, FS_SMALL, { center: true, italic: true }), { marginTop: 8, opacity: 0.6 }]}
          placeholder="Source (optional)"
          placeholderTextColor={phColor}
        />
      </View>
    );
  };

  const renderTimeline = () => (
    <View style={styles.full}>
      <TextInput
        value={content.title ?? ''}
        onChangeText={v => onChange({ title: v })}
        style={[inp(c.primary, FS_TITLE, { bold: true }), { marginBottom: 6 }]}
        placeholder="Timeline Title"
        placeholderTextColor={phColor}
      />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
        {(content.timelineItems ?? []).map((item, i) => {
          const dotColor = c.accent === '#FFFFFF' ? c.secondary : c.accent;
          return (
            <View key={i} style={styles.timelineRow}>
              <View style={[styles.timelineDot, { backgroundColor: dotColor }]} />
              <TextInput
                value={item.year}
                onChangeText={v => {
                  const next = [...(content.timelineItems ?? [])];
                  next[i] = { ...next[i], year: v };
                  onChange({ timelineItems: next });
                }}
                style={[inp(c.primary, FS_SMALL, { bold: true }), { width: 36 }]}
                placeholder="Year"
                placeholderTextColor={phColor}
                keyboardType="numeric"
              />
              <TextInput
                value={item.event}
                onChangeText={v => {
                  const next = [...(content.timelineItems ?? [])];
                  next[i] = { ...next[i], event: v };
                  onChange({ timelineItems: next });
                }}
                style={[inp(c.text, FS_SMALL), { flex: 1 }]}
                placeholder="Event"
                placeholderTextColor={phColor}
              />
              <TouchableOpacity
                onPress={() =>
                  onChange({
                    timelineItems: (content.timelineItems ?? []).filter((_, j) => j !== i),
                  })
                }
                hitSlop={8}
              >
                <Text style={styles.deleteX}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        })}
        <TouchableOpacity
          onPress={() =>
            onChange({ timelineItems: [...(content.timelineItems ?? []), { year: '', event: '' }] })
          }
          style={styles.addBtn}
        >
          <Text style={[styles.addBtnText, { color: c.primary }]}>+ Add event</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  const renderBlank = () => (
    <View style={styles.centered}>
      <Text style={[styles.blankMsg, { color: isOnDark ? c.textOnDark : c.textMuted }]}>
        Blank slide
      </Text>
    </View>
  );

  const renderLayout = () => {
    switch (layout) {
      case 'title':
      case 'closing':      return renderTitle();
      case 'titleContent': return renderTitleContent();
      case 'twoColumn':    return renderTwoColumn();
      case 'imageLeft':    return renderImageSide(true);
      case 'imageRight':   return renderImageSide(false);
      case 'statHighlight':return renderStat();
      case 'timeline':     return renderTimeline();
      case 'blank':        return renderBlank();
      default:             return renderTitleContent();
    }
  };

  return (
    <View
      style={[
        styles.canvas,
        { width: CANVAS_W, height: CANVAS_H, backgroundColor: bgColor },
      ]}
    >
      {/* Accent left bar */}
      <View style={[styles.accentBar, { backgroundColor: c.primary }]} />

      {/* Editable content area */}
      <View style={styles.inner}>
        {renderLayout()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  canvas: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 5,
  },
  accentBar: {
    width: ACCENT_W,
  },
  inner: {
    flex: 1,
    padding: INNER_PAD,
  },

  // Layout containers
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  full: { flex: 1 },
  columns: { flex: 1, flexDirection: 'row', paddingTop: 5 },

  // Hero title divider
  heroDivider: {
    width: 40,
    height: 2,
    borderRadius: 1,
    marginVertical: 6,
  },

  // Content divider
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 5,
  },

  // Bullets
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  deleteX: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  addBtn: {
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  addBtnText: {
    fontSize: FS_SMALL,
    fontWeight: '600',
  },

  // Image picker
  imagePicker: {
    flex: 1,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  imagePickerLabel: {
    fontSize: 9,
    fontWeight: '600',
  },

  // Timeline
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Blank
  blankMsg: {
    fontSize: 11,
    fontStyle: 'italic',
    opacity: 0.4,
  },
});
