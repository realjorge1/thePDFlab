// ─────────────────────────────────────────────
//  PPT Module — InteractiveSlideCanvas
//  Read-only slide preview where each region is tappable.
//  Editing happens in the SlideFieldEditor drawer below.
// ─────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Slide, PPTTheme } from '../../types/ppt.types';
import { ImagePlus } from 'lucide-react-native';
import { FieldId, fieldKey } from './SlideFieldEditor';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 16;
const CANVAS_W = SCREEN_W - H_PAD * 2;
const CANVAS_H = Math.round((CANVAS_W * 9) / 16);
const ACCENT_W = 4;
const INNER_PAD = 11;

// Font sizes — proportional to canvas dimensions
const FS_TITLE_HERO = Math.round(CANVAS_H * 0.13);
const FS_SUBTITLE = Math.round(CANVAS_H * 0.085);
const FS_TITLE = Math.round(CANVAS_H * 0.088);
const FS_BODY = Math.round(CANVAS_H * 0.068);
const FS_SMALL = Math.round(CANVAS_H * 0.057);
const FS_STAT = Math.round(CANVAS_H * 0.38);

interface InteractiveSlideCanvasProps {
  slide: Slide;
  theme: PPTTheme;
  activeField: FieldId | null;
  onFieldFocus: (f: FieldId) => void;
}

export const InteractiveSlideCanvas: React.FC<InteractiveSlideCanvasProps> = ({
  slide,
  theme,
  activeField,
  onFieldFocus,
}) => {
  const { layout, content } = slide;
  const c = theme.colors;

  const isOnDark =
    layout === 'title' ||
    layout === 'closing' ||
    layout === 'statHighlight' ||
    layout === 'quote' ||
    layout === 'sectionDivider';

  const bgColor = isOnDark ? c.backgroundDark : c.background;
  const phColor = isOnDark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.28)';
  const titleColor = isOnDark ? c.textOnDark : c.primary;
  const bodyColor = isOnDark ? c.textOnDark : c.text;

  const activeKey = activeField ? fieldKey(activeField) : null;

  // Region wrapper: highlights active field & raises tap target
  const Region: React.FC<{
    field: FieldId;
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
  }> = ({ field, children, style }) => {
    const isActive = activeKey === fieldKey(field);
    return (
      <Pressable
        onPress={() => onFieldFocus(field)}
        style={[
          styles.region,
          style,
          isActive && {
            backgroundColor: (isOnDark ? '#FFFFFF' : c.primary) + '14',
            borderColor: c.primary,
          },
        ]}
        hitSlop={4}
      >
        {children}
      </Pressable>
    );
  };

  // Helper to render either content text or a placeholder
  const PlaceholderText: React.FC<{
    value: string | undefined;
    placeholder: string;
    style: object;
    numberOfLines?: number;
  }> = ({ value, placeholder, style, numberOfLines }) => (
    <Text style={[style, !value && { color: phColor }]} numberOfLines={numberOfLines}>
      {value && value.length > 0 ? value : placeholder}
    </Text>
  );

  // ─── Layout renderers (all read-only Text) ────

  const renderTitle = () => (
    <View style={styles.centered}>
      <Region field={{ kind: 'title' }} style={styles.regionCenter}>
        <PlaceholderText
          value={content.title}
          placeholder={layout === 'closing' ? 'Closing Title' : 'Presentation Title'}
          style={{
            fontSize: FS_TITLE_HERO,
            fontWeight: '700',
            color: c.textOnDark,
            textAlign: 'center',
          }}
          numberOfLines={3}
        />
      </Region>
      <View style={[styles.heroDivider, { backgroundColor: c.secondary }]} />
      <Region field={{ kind: 'subtitle' }} style={styles.regionCenter}>
        <PlaceholderText
          value={content.subtitle}
          placeholder={layout === 'closing' ? 'Thank You · Questions?' : 'Your subtitle here'}
          style={{ fontSize: FS_SUBTITLE, color: c.secondary, textAlign: 'center' }}
          numberOfLines={2}
        />
      </Region>
    </View>
  );

  const renderTitleContent = () => {
    const hasBullets = (content.bullets ?? []).length > 0;
    return (
      <View style={styles.full}>
        <Region field={{ kind: 'title' }}>
          <PlaceholderText
            value={content.title}
            placeholder="Slide Title"
            style={{ fontSize: FS_TITLE, fontWeight: '700', color: c.primary }}
            numberOfLines={2}
          />
        </Region>
        <View style={[styles.divider, { backgroundColor: c.primary, opacity: 0.2 }]} />
        {hasBullets ? (
          <Region field={{ kind: 'bullets' }} style={{ flex: 1 }}>
            <View style={{ gap: 4 }}>
              {(content.bullets ?? []).map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: c.primary }]} />
                  <PlaceholderText
                    value={b}
                    placeholder={`Point ${i + 1}`}
                    style={{ flex: 1, fontSize: FS_BODY, color: bodyColor }}
                    numberOfLines={2}
                  />
                </View>
              ))}
            </View>
          </Region>
        ) : (
          <Region field={{ kind: 'body' }} style={{ flex: 1 }}>
            <PlaceholderText
              value={content.body}
              placeholder="Body text or explanation…"
              style={{ fontSize: FS_BODY, color: bodyColor, lineHeight: FS_BODY * 1.4 }}
              numberOfLines={8}
            />
          </Region>
        )}
      </View>
    );
  };

  const renderTwoColumn = () => (
    <View style={styles.full}>
      <Region field={{ kind: 'title' }}>
        <PlaceholderText
          value={content.title}
          placeholder="Section Title"
          style={{ fontSize: FS_TITLE, fontWeight: '700', color: c.primary }}
        />
      </Region>
      <View style={[styles.divider, { backgroundColor: c.primary, opacity: 0.2 }]} />
      <View style={styles.columns}>
        <Region
          field={{ kind: 'leftContent' }}
          style={{ flex: 1, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.secondary + '80', paddingRight: 6 }}
        >
          <PlaceholderText
            value={content.leftContent}
            placeholder="Left column…"
            style={{ fontSize: FS_BODY, color: bodyColor }}
            numberOfLines={8}
          />
        </Region>
        <Region field={{ kind: 'rightContent' }} style={{ flex: 1, paddingLeft: 6 }}>
          <PlaceholderText
            value={content.rightContent}
            placeholder="Right column…"
            style={{ fontSize: FS_BODY, color: bodyColor }}
            numberOfLines={8}
          />
        </Region>
      </View>
    </View>
  );

  const renderImageSide = (imageLeft: boolean) => {
    const imageArea = (
      <Region
        field={{ kind: 'image' }}
        style={[styles.imagePicker, { backgroundColor: c.secondary + '28' }]}
      >
        {content.imageUri ? (
          <Image
            source={{ uri: content.imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <ImagePlus size={20} color={c.primary} strokeWidth={1.5} />
            <Text style={[styles.imagePickerLabel, { color: c.primary }]}>Tap to add image</Text>
          </View>
        )}
      </Region>
    );
    const textArea = (
      <View style={{ flex: 1, gap: 5 }}>
        <Region field={{ kind: 'title' }}>
          <PlaceholderText
            value={content.title}
            placeholder="Title"
            style={{ fontSize: FS_TITLE - 2, fontWeight: '700', color: c.primary }}
            numberOfLines={2}
          />
        </Region>
        <Region field={{ kind: 'body' }} style={{ flex: 1 }}>
          <PlaceholderText
            value={content.body}
            placeholder="Description…"
            style={{ fontSize: FS_BODY, color: bodyColor }}
            numberOfLines={6}
          />
        </Region>
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
        <Region field={{ kind: 'title' }} style={styles.regionCenter}>
          <PlaceholderText
            value={content.title}
            placeholder="Section Label"
            style={{
              fontSize: FS_SMALL,
              color: c.secondary,
              textAlign: 'center',
              opacity: 0.85,
            }}
          />
        </Region>
        <Region field={{ kind: 'statValue' }} style={styles.regionCenter}>
          <PlaceholderText
            value={content.stat?.value}
            placeholder="94%"
            style={{
              fontSize: FS_STAT,
              fontWeight: '700',
              color: statColor,
              textAlign: 'center',
              lineHeight: FS_STAT * 1.05,
            }}
          />
        </Region>
        <Region field={{ kind: 'statLabel' }} style={styles.regionCenter}>
          <PlaceholderText
            value={content.stat?.label}
            placeholder="Stat label"
            style={{ fontSize: FS_BODY, color: c.textOnDark, textAlign: 'center' }}
          />
        </Region>
        <Region field={{ kind: 'footnote' }} style={styles.regionCenter}>
          <PlaceholderText
            value={content.footnote}
            placeholder="Source (optional)"
            style={{
              fontSize: FS_SMALL,
              color: c.secondary,
              textAlign: 'center',
              fontStyle: 'italic',
              opacity: 0.7,
            }}
          />
        </Region>
      </View>
    );
  };

  const renderTimeline = () => (
    <View style={styles.full}>
      <Region field={{ kind: 'title' }}>
        <PlaceholderText
          value={content.title}
          placeholder="Timeline Title"
          style={{ fontSize: FS_TITLE, fontWeight: '700', color: c.primary }}
        />
      </Region>
      <Region field={{ kind: 'timeline' }} style={{ flex: 1, marginTop: 5 }}>
        <View style={{ gap: 4 }}>
          {(content.timelineItems ?? []).map((item, i) => {
            const dotColor = c.accent === '#FFFFFF' ? c.secondary : c.accent;
            return (
              <View key={i} style={styles.timelineRow}>
                <View style={[styles.timelineDot, { backgroundColor: dotColor }]} />
                <PlaceholderText
                  value={item.year}
                  placeholder="Year"
                  style={{ fontSize: FS_SMALL, fontWeight: '700', color: c.primary, width: 36 }}
                />
                <PlaceholderText
                  value={item.event}
                  placeholder="Event"
                  style={{ flex: 1, fontSize: FS_SMALL, color: bodyColor }}
                  numberOfLines={2}
                />
              </View>
            );
          })}
          {(content.timelineItems ?? []).length === 0 ? (
            <Text style={{ fontSize: FS_SMALL, color: phColor }}>
              Tap here to add timeline events
            </Text>
          ) : null}
        </View>
      </Region>
    </View>
  );

  const renderQuote = () => (
    <View style={styles.centered}>
      <Text
        style={{
          fontSize: FS_STAT * 0.7,
          color: c.secondary,
          fontWeight: '700',
          lineHeight: FS_STAT * 0.6,
        }}
      >
        “
      </Text>
      <Region field={{ kind: 'body' }} style={styles.regionCenter}>
        <PlaceholderText
          value={content.body}
          placeholder="Type a memorable quote…"
          style={{
            fontSize: FS_SUBTITLE,
            color: c.textOnDark,
            textAlign: 'center',
            fontStyle: 'italic',
          }}
          numberOfLines={4}
        />
      </Region>
      <View style={[styles.heroDivider, { backgroundColor: c.secondary }]} />
      <Region field={{ kind: 'subtitle' }} style={styles.regionCenter}>
        <PlaceholderText
          value={content.subtitle}
          placeholder="Attribution / author"
          style={{ fontSize: FS_SMALL, color: c.secondary, textAlign: 'center' }}
        />
      </Region>
    </View>
  );

  const renderSectionDivider = () => (
    <View style={styles.full}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Region field={{ kind: 'sectionNumber' }}>
          <PlaceholderText
            value={content.sectionNumber}
            placeholder="01"
            style={{
              fontSize: FS_STAT * 0.7,
              fontWeight: '700',
              color: c.secondary,
              lineHeight: FS_STAT * 0.75,
            }}
          />
        </Region>
        <Region field={{ kind: 'title' }}>
          <PlaceholderText
            value={content.title}
            placeholder="Section Title"
            style={{
              fontSize: FS_TITLE * 1.2,
              fontWeight: '700',
              color: c.textOnDark,
            }}
            numberOfLines={2}
          />
        </Region>
        <Region field={{ kind: 'subtitle' }}>
          <PlaceholderText
            value={content.subtitle}
            placeholder="Optional description"
            style={{ fontSize: FS_SMALL, color: c.secondary }}
          />
        </Region>
      </View>
    </View>
  );

  const renderAgenda = () => (
    <View style={styles.full}>
      <Region field={{ kind: 'title' }}>
        <PlaceholderText
          value={content.title}
          placeholder="Agenda"
          style={{ fontSize: FS_TITLE, fontWeight: '700', color: c.primary }}
        />
      </Region>
      <View style={[styles.divider, { backgroundColor: c.primary, opacity: 0.2 }]} />
      <Region field={{ kind: 'bullets' }} style={{ flex: 1 }}>
        <View style={{ gap: 4 }}>
          {(content.bullets ?? []).map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <View
                style={[
                  styles.numBadge,
                  { backgroundColor: c.accent === '#FFFFFF' ? c.secondary : c.accent },
                ]}
              >
                <Text style={styles.numBadgeText}>{i + 1}</Text>
              </View>
              <PlaceholderText
                value={b}
                placeholder={`Item ${i + 1}`}
                style={{ flex: 1, fontSize: FS_BODY, color: bodyColor }}
                numberOfLines={1}
              />
            </View>
          ))}
          {(content.bullets ?? []).length === 0 ? (
            <Text style={{ fontSize: FS_BODY, color: phColor }}>
              Tap here to add agenda items
            </Text>
          ) : null}
        </View>
      </Region>
    </View>
  );

  const renderProcessSteps = () => (
    <View style={styles.full}>
      <Region field={{ kind: 'title' }}>
        <PlaceholderText
          value={content.title}
          placeholder="Process"
          style={{ fontSize: FS_TITLE, fontWeight: '700', color: c.primary }}
        />
      </Region>
      <View style={[styles.divider, { backgroundColor: c.primary, opacity: 0.2 }]} />
      <Region field={{ kind: 'steps' }} style={{ flex: 1 }}>
        <View style={{ gap: 4 }}>
          {(content.steps ?? []).map((s, i) => (
            <View key={i} style={styles.bulletRow}>
              <View
                style={[
                  styles.numBadge,
                  { backgroundColor: c.accent === '#FFFFFF' ? c.secondary : c.accent },
                ]}
              >
                <Text style={styles.numBadgeText}>{i + 1}</Text>
              </View>
              <PlaceholderText
                value={s}
                placeholder={`Step ${i + 1}`}
                style={{ flex: 1, fontSize: FS_BODY, color: bodyColor }}
                numberOfLines={2}
              />
            </View>
          ))}
          {(content.steps ?? []).length === 0 ? (
            <Text style={{ fontSize: FS_BODY, color: phColor }}>
              Tap here to add process steps
            </Text>
          ) : null}
        </View>
      </Region>
    </View>
  );

  const renderComparison = () => (
    <View style={styles.full}>
      <Region field={{ kind: 'title' }}>
        <PlaceholderText
          value={content.title}
          placeholder="Comparison Title"
          style={{ fontSize: FS_TITLE, fontWeight: '700', color: c.primary }}
        />
      </Region>
      <View style={[styles.divider, { backgroundColor: c.primary, opacity: 0.2 }]} />
      <View style={styles.columns}>
        <View style={{ flex: 1, paddingRight: 5 }}>
          <Region field={{ kind: 'leftTitle' }}>
            <PlaceholderText
              value={content.leftTitle}
              placeholder="Option A"
              style={{
                fontSize: FS_SMALL,
                fontWeight: '700',
                color: c.primary,
                textAlign: 'center',
              }}
            />
          </Region>
          <Region field={{ kind: 'leftContent' }} style={{ flex: 1, marginTop: 3 }}>
            <PlaceholderText
              value={content.leftContent}
              placeholder="Pros / details…"
              style={{ fontSize: FS_SMALL, color: bodyColor }}
              numberOfLines={6}
            />
          </Region>
        </View>
        <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: c.secondary + '80' }} />
        <View style={{ flex: 1, paddingLeft: 5 }}>
          <Region field={{ kind: 'rightTitle' }}>
            <PlaceholderText
              value={content.rightTitle}
              placeholder="Option B"
              style={{
                fontSize: FS_SMALL,
                fontWeight: '700',
                color: c.primary,
                textAlign: 'center',
              }}
            />
          </Region>
          <Region field={{ kind: 'rightContent' }} style={{ flex: 1, marginTop: 3 }}>
            <PlaceholderText
              value={content.rightContent}
              placeholder="Pros / details…"
              style={{ fontSize: FS_SMALL, color: bodyColor }}
              numberOfLines={6}
            />
          </Region>
        </View>
      </View>
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
      case 'closing':
        return renderTitle();
      case 'titleContent':
        return renderTitleContent();
      case 'twoColumn':
        return renderTwoColumn();
      case 'imageLeft':
        return renderImageSide(true);
      case 'imageRight':
        return renderImageSide(false);
      case 'statHighlight':
        return renderStat();
      case 'timeline':
        return renderTimeline();
      case 'quote':
        return renderQuote();
      case 'sectionDivider':
        return renderSectionDivider();
      case 'agenda':
        return renderAgenda();
      case 'comparison':
        return renderComparison();
      case 'processSteps':
        return renderProcessSteps();
      case 'blank':
        return renderBlank();
      default:
        return renderTitleContent();
    }
  };

  return (
    <View
      style={[
        styles.canvas,
        { width: CANVAS_W, height: CANVAS_H, backgroundColor: bgColor },
      ]}
    >
      <View style={[styles.accentBar, { backgroundColor: c.primary }]} />
      <View style={styles.inner}>{renderLayout()}</View>
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

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  regionCenter: { alignSelf: 'stretch', alignItems: 'center' },
  full: { flex: 1 },
  columns: { flex: 1, flexDirection: 'row', paddingTop: 5 },

  region: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 2,
    paddingVertical: 1,
  },

  heroDivider: {
    width: 40,
    height: 2,
    borderRadius: 1,
    marginVertical: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 5,
    marginTop: 2,
  },

  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  numBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },

  imagePicker: {
    flex: 1,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePickerLabel: {
    fontSize: 9,
    fontWeight: '600',
  },

  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  blankMsg: {
    fontSize: 11,
    fontStyle: 'italic',
    opacity: 0.4,
  },
});
