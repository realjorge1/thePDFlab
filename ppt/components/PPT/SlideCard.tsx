// ─────────────────────────────────────────────
//  PPT Module — SlideCard Component
//  Native rendering of a single slide.
//  Used in both the Viewer and the Editor thumbnail strip.
// ─────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ViewStyle,
} from 'react-native';
import { Slide, PPTTheme } from '../../types/ppt.types';

interface SlideCardProps {
  slide: Slide;
  theme: PPTTheme;
  /** Scale relative to full-screen (1 = full, 0.2 = thumbnail) */
  scale?: number;
  style?: ViewStyle;
}

const BASE_W = 360;
const BASE_H = 202; // 16:9

export const SlideCard: React.FC<SlideCardProps> = ({
  slide,
  theme,
  scale = 1,
  style,
}) => {
  const { colors, fonts } = theme;
  const { layout, content } = slide;

  const isOnDark =
    layout === 'title' ||
    layout === 'closing' ||
    layout === 'statHighlight';

  const bg = isOnDark ? colors.backgroundDark : colors.background;
  const titleColor = isOnDark ? colors.textOnDark : colors.primary;
  const bodyColor = isOnDark ? colors.secondary : colors.text;
  const mutedColor = isOnDark ? colors.secondary : colors.textMuted;

  const w = BASE_W * scale;
  const h = BASE_H * scale;
  const p = 12 * scale;
  const titleSize = 13 * scale;
  const bodySize = 9 * scale;
  const accentBarW = 4 * scale;

  return (
    <View
      style={[
        {
          width: w,
          height: h,
          backgroundColor: bg,
          overflow: 'hidden',
          borderRadius: 4 * scale,
        },
        style,
      ]}
    >
      {/* Accent left bar */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: accentBarW,
          height: h,
          backgroundColor: colors.primary,
        }}
      />

      {/* Content */}
      <View style={{ flex: 1, paddingLeft: p + accentBarW, paddingRight: p, paddingVertical: p }}>
        {renderContent(
          layout,
          content,
          { titleColor, bodyColor, mutedColor, primary: colors.primary, secondary: colors.secondary, accent: colors.accent, fonts },
          scale,
        )}
      </View>
    </View>
  );
};

function renderContent(
  layout: Slide['layout'],
  content: Slide['content'],
  c: { titleColor: string; bodyColor: string; mutedColor: string; primary: string; secondary: string; accent: string; fonts: PPTTheme['fonts'] },
  scale: number,
) {
  const titleSize = 14 * scale;
  const bodySize = 9 * scale;
  const smallSize = 8 * scale;

  switch (layout) {
    case 'title':
    case 'closing':
      return (
        <View style={styles.center}>
          {content.title ? (
            <Text
              style={{ fontSize: titleSize * 1.3, fontWeight: 'bold', color: c.titleColor, textAlign: 'center', marginBottom: 6 * scale }}
              numberOfLines={3}
            >
              {content.title}
            </Text>
          ) : null}
          {content.subtitle ? (
            <Text
              style={{ fontSize: bodySize * 1.1, color: c.secondary, textAlign: 'center' }}
              numberOfLines={2}
            >
              {content.subtitle}
            </Text>
          ) : null}
        </View>
      );

    case 'statHighlight':
      return (
        <View style={styles.center}>
          {content.title ? (
            <Text style={{ fontSize: bodySize, color: c.secondary, textAlign: 'center', marginBottom: 4 * scale }}>
              {content.title}
            </Text>
          ) : null}
          {content.stat?.value ? (
            <Text style={{ fontSize: titleSize * 3.2, fontWeight: 'bold', color: c.accent === '#FFFFFF' ? c.secondary : c.accent, textAlign: 'center', lineHeight: titleSize * 3.4 }}>
              {content.stat.value}
            </Text>
          ) : null}
          {content.stat?.label ? (
            <Text style={{ fontSize: bodySize, color: c.titleColor, textAlign: 'center' }}>
              {content.stat.label}
            </Text>
          ) : null}
        </View>
      );

    case 'twoColumn':
      return (
        <>
          {content.title ? (
            <Text style={{ fontSize: titleSize, fontWeight: 'bold', color: c.titleColor, marginBottom: 6 * scale }} numberOfLines={2}>
              {content.title}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flex: 1 }}>
            <Text style={{ flex: 1, fontSize: bodySize, color: c.bodyColor, paddingRight: 4 * scale }} numberOfLines={8}>
              {content.leftContent}
            </Text>
            <View style={{ width: 1, backgroundColor: c.secondary, marginHorizontal: 4 * scale }} />
            <Text style={{ flex: 1, fontSize: bodySize, color: c.bodyColor, paddingLeft: 4 * scale }} numberOfLines={8}>
              {content.rightContent}
            </Text>
          </View>
        </>
      );

    case 'imageLeft':
    case 'imageRight': {
      const imageFirst = layout === 'imageLeft';
      const imgBlock = (
        <View
          style={{
            flex: 1,
            backgroundColor: c.secondary,
            borderRadius: 3 * scale,
            marginRight: imageFirst ? 6 * scale : 0,
            marginLeft: imageFirst ? 0 : 6 * scale,
            overflow: 'hidden',
          }}
        >
          {content.imageUri ? (
            <Image source={{ uri: content.imageUri }} style={{ flex: 1 }} resizeMode="cover" />
          ) : null}
        </View>
      );
      const textBlock = (
        <View style={{ flex: 1 }}>
          {content.title ? (
            <Text style={{ fontSize: titleSize, fontWeight: 'bold', color: c.primary, marginBottom: 4 * scale }} numberOfLines={2}>
              {content.title}
            </Text>
          ) : null}
          {content.body ? (
            <Text style={{ fontSize: bodySize, color: c.bodyColor }} numberOfLines={6}>
              {content.body}
            </Text>
          ) : null}
        </View>
      );
      return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {imageFirst ? imgBlock : textBlock}
          {imageFirst ? textBlock : imgBlock}
        </View>
      );
    }

    case 'timeline':
      return (
        <>
          {content.title ? (
            <Text style={{ fontSize: titleSize, fontWeight: 'bold', color: c.titleColor, marginBottom: 8 * scale }} numberOfLines={1}>
              {content.title}
            </Text>
          ) : null}
          {(content.timelineItems ?? []).map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 4 * scale, alignItems: 'flex-start' }}>
              <View style={{ width: 6 * scale, height: 6 * scale, borderRadius: 3 * scale, backgroundColor: c.accent === '#FFFFFF' ? c.secondary : c.accent, marginTop: 2 * scale, marginRight: 4 * scale }} />
              <Text style={{ fontSize: smallSize, color: c.primary, fontWeight: 'bold', width: 28 * scale }}>{item.year}</Text>
              <Text style={{ flex: 1, fontSize: smallSize, color: c.bodyColor }} numberOfLines={2}>{item.event}</Text>
            </View>
          ))}
        </>
      );

    // titleContent and default
    default:
      return (
        <>
          {content.title ? (
            <Text style={{ fontSize: titleSize, fontWeight: 'bold', color: c.titleColor, marginBottom: 6 * scale }} numberOfLines={2}>
              {content.title}
            </Text>
          ) : null}
          {content.subtitle ? (
            <Text style={{ fontSize: bodySize * 1.1, color: c.mutedColor, marginBottom: 6 * scale }} numberOfLines={1}>
              {content.subtitle}
            </Text>
          ) : null}
          {content.body ? (
            <Text style={{ fontSize: bodySize, color: c.bodyColor }} numberOfLines={7}>
              {content.body}
            </Text>
          ) : null}
          {(content.bullets ?? []).map((b, i) => (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 3 * scale }}>
              <Text style={{ fontSize: bodySize, color: c.primary, marginRight: 4 * scale }}>•</Text>
              <Text style={{ flex: 1, fontSize: bodySize, color: c.bodyColor }} numberOfLines={2}>{b}</Text>
            </View>
          ))}
        </>
      );
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
