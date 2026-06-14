// ─────────────────────────────────────────────
//  PPT Module — InteractiveSlideCanvas
//  WYSIWYG slide preview where each region is tappable.
//  Editing happens in the SlideFieldEditor drawer below.
//
//  IMPORTANT: this canvas mirrors pptxGenerator.service.ts geometry 1:1.
//  The generator lays slides out in inches on a 13.33 × 7.5 canvas; every
//  rect here uses those same coordinates scaled to screen pixels, so the
//  exported .pptx looks exactly like the preview. If you change a layout
//  in the generator, change it here too (and vice-versa).
// ─────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Slide, PPTTheme } from '../../types/ppt.types';
import { ImagePlus } from 'lucide-react-native';
import { FieldId, fieldKey } from './SlideFieldEditor';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 16;

// Generator slide dimensions (inches) — keep in sync with pptxGenerator.
const W = 13.33;
const H = 7.5;

interface InteractiveSlideCanvasProps {
  slide: Slide;
  theme: PPTTheme;
  activeField: FieldId | null;
  onFieldFocus: (f: FieldId) => void;
  /** 1-based slide number, rendered exactly where the export renders it. */
  slideNumber?: number;
  /** Canvas width in px. Defaults to full screen minus page padding. */
  width?: number;
}

export const InteractiveSlideCanvas: React.FC<InteractiveSlideCanvasProps> = ({
  slide,
  theme,
  activeField,
  onFieldFocus,
  slideNumber,
  width,
}) => {
  const { layout, content } = slide;
  const c = theme.colors;

  const CANVAS_W = width ?? SCREEN_W - H_PAD * 2;
  const CANVAS_H = Math.round((CANVAS_W * H) / W);
  const S = CANVAS_W / W; // px per inch
  const fs = (pt: number) => (pt / 72) * S; // pptx points → px
  const op = (transparency: number) => (100 - transparency) / 100;

  // Absolute rect in generator inches → px style. Typed as the intersection
  // so the same rect can style Views and Texts.
  const rc = (x: number, y: number, w: number, h: number): ViewStyle & TextStyle => ({
    position: 'absolute',
    left: x * S,
    top: y * S,
    width: w * S,
    height: h * S,
  });

  const isDarkSlide =
    layout === 'title' ||
    layout === 'closing' ||
    layout === 'sectionDivider' ||
    layout === 'quote' ||
    layout === 'statHighlight';

  const bgColor = isDarkSlide ? c.backgroundDark : c.background;
  const textColor = isDarkSlide ? c.textOnDark : c.text;
  const phColor = isDarkSlide ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.30)';

  const activeKey = activeField ? fieldKey(activeField) : null;

  // ── Building blocks ─────────────────────────

  /** Solid / translucent shape mirroring generator addShape calls. */
  const Shape: React.FC<{
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    transparency?: number;
    circle?: boolean;
    radius?: number;
    borderColor?: string;
    borderWidth?: number;
  }> = ({ x, y, w, h, color, transparency = 0, circle, radius, borderColor, borderWidth }) => (
    <View
      pointerEvents="none"
      style={[
        rc(x, y, w, h),
        {
          backgroundColor: color,
          opacity: op(transparency),
          borderRadius: circle ? (w * S) / 2 : (radius ?? 0),
        },
        borderColor
          ? { borderColor, borderWidth: borderWidth ?? StyleSheet.hairlineWidth }
          : null,
      ]}
    />
  );

  /** Tappable text region pinned to the exact generator text-box rect. */
  const TxtRegion: React.FC<{
    field: FieldId;
    x: number;
    y: number;
    w: number;
    h: number;
    value: string | undefined;
    placeholder: string;
    size: number; // pt, as in the generator
    color: string;
    bold?: boolean;
    italic?: boolean;
    align?: 'left' | 'center' | 'right';
    valign?: 'top' | 'middle';
    lineSpacing?: number;
    extraTextStyle?: StyleProp<TextStyle>;
  }> = ({
    field,
    x,
    y,
    w,
    h,
    value,
    placeholder,
    size,
    color,
    bold,
    italic,
    align = 'left',
    valign = 'top',
    lineSpacing,
    extraTextStyle,
  }) => {
    const isActive = activeKey === fieldKey(field);
    const px = fs(size);
    return (
      <Pressable
        onPress={() => onFieldFocus(field)}
        style={[
          rc(x, y, w, h),
          styles.region,
          { justifyContent: valign === 'middle' ? 'center' : 'flex-start' },
          isActive && {
            backgroundColor: (isDarkSlide ? '#FFFFFF' : c.primary) + '14',
            borderColor: isDarkSlide ? '#FFFFFF' : c.primary,
          },
        ]}
        hitSlop={2}
      >
        <Text
          style={[
            {
              fontSize: px,
              color: value ? color : phColor,
              fontWeight: bold ? '700' : '400',
              fontStyle: italic ? 'italic' : 'normal',
              textAlign: align,
              lineHeight: px * (lineSpacing ?? 1.15),
            },
            extraTextStyle,
          ]}
        >
          {value && value.length > 0 ? value : placeholder}
        </Text>
      </Pressable>
    );
  };

  /** Footer line + slide number — mirrors addFooter() in the generator. */
  const Footer = () => (
    <>
      <Shape x={0.4} y={H - 0.4} w={W - 0.8} h={0.02} color={c.primary} transparency={60} />
      {slideNumber != null && (
        <Text
          pointerEvents="none"
          style={[
            rc(W - 1.0, H - 0.5, 0.6, 0.3),
            { fontSize: fs(10), color: c.textMuted, textAlign: 'right' },
          ]}
        >
          {slideNumber}
        </Text>
      )}
    </>
  );

  // ── Layout renderers (geometry mirrors the generator) ────

  const renderTitle = () => (
    <>
      <Shape x={9.2} y={-2.8} w={6.0} h={6.0} color={c.primary} transparency={72} circle />
      <Shape x={11.4} y={-1.0} w={3.2} h={3.2} color={c.secondary} transparency={78} circle />
      <Shape x={0} y={H - 0.55} w={W} h={0.55} color={c.primary} transparency={30} />
      <Shape x={0} y={H - 0.58} w={W} h={0.04} color={c.secondary} />
      <Shape x={0.5} y={2.1} w={0.06} h={1.9} color={c.secondary} />

      <TxtRegion
        field={{ kind: 'title' }}
        x={0.9} y={1.8} w={9.5} h={2.0}
        value={content.title}
        placeholder="Presentation Title"
        size={46} color={c.textOnDark} bold valign="middle"
      />
      <Shape x={0.9} y={3.95} w={3.5} h={0.04} color={c.secondary} transparency={30} />
      <TxtRegion
        field={{ kind: 'subtitle' }}
        x={0.9} y={4.1} w={9.5} h={0.9}
        value={content.subtitle}
        placeholder="Your subtitle here"
        size={18} color={c.secondary}
      />
      {slideNumber != null && (
        <Text
          pointerEvents="none"
          style={[
            rc(W - 1.2, H - 0.48, 0.7, 0.36),
            { fontSize: fs(11), color: c.textOnDark, fontWeight: '700', textAlign: 'right' },
          ]}
        >
          {slideNumber}
        </Text>
      )}
    </>
  );

  const renderTitleContent = () => {
    const bullets = content.bullets ?? [];
    const hasBullets = bullets.length > 0;
    return (
      <>
        <Shape x={0} y={0} w={W} h={1.5} color={c.primary} />
        <Shape x={0} y={1.5} w={W} h={0.05} color={c.secondary} />
        <Shape x={W - 1.2} y={-1.2} w={2.8} h={2.8} color={c.textOnDark} transparency={88} circle />

        <TxtRegion
          field={{ kind: 'title' }}
          x={0.55} y={0.2} w={W - 1.1} h={1.1}
          value={content.title}
          placeholder="Slide Title"
          size={30} color={c.textOnDark} bold valign="middle"
        />

        {hasBullets ? (
          <Pressable
            onPress={() => onFieldFocus({ kind: 'bullets' })}
            style={[
              rc(0.55, 1.8, W - 1.1, 4.6),
              styles.region,
              activeKey === 'bullets' && {
                backgroundColor: c.primary + '14',
                borderColor: c.primary,
              },
            ]}
          >
            <View style={{ gap: fs(22) * 0.55 }}>
              {bullets.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View
                    style={[
                      styles.bulletDot,
                      { backgroundColor: textColor, marginTop: fs(22) * 0.5 },
                    ]}
                  />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: fs(22),
                      color: b ? textColor : phColor,
                      lineHeight: fs(22) * 1.4,
                    }}
                  >
                    {b || `Point ${i + 1}`}
                  </Text>
                </View>
              ))}
            </View>
          </Pressable>
        ) : (
          <TxtRegion
            field={{ kind: 'body' }}
            x={0.55} y={1.8} w={W - 1.1} h={4.6}
            value={content.body}
            placeholder="Body text or explanation…"
            size={22} color={textColor} lineSpacing={1.3}
          />
        )}
        <Footer />
      </>
    );
  };

  const renderTwoColumn = () => (
    <>
      <Shape x={0} y={0} w={W} h={1.3} color={c.primary} />
      <Shape x={0} y={1.3} w={W} h={0.04} color={c.secondary} />
      <TxtRegion
        field={{ kind: 'title' }}
        x={0.55} y={0.15} w={W - 1.1} h={1.0}
        value={content.title}
        placeholder="Section Title"
        size={28} color={c.textOnDark} bold valign="middle"
      />
      <Shape x={W / 2 - 0.015} y={1.55} w={0.03} h={H - 2.2} color={c.secondary} transparency={30} />
      <TxtRegion
        field={{ kind: 'leftContent' }}
        x={0.55} y={1.6} w={W / 2 - 0.9} h={H - 2.3}
        value={content.leftContent}
        placeholder="Left column…"
        size={20} color={textColor} lineSpacing={1.35}
      />
      <TxtRegion
        field={{ kind: 'rightContent' }}
        x={W / 2 + 0.35} y={1.6} w={W / 2 - 0.9} h={H - 2.3}
        value={content.rightContent}
        placeholder="Right column…"
        size={20} color={textColor} lineSpacing={1.35}
      />
      <Footer />
    </>
  );

  const renderStat = () => {
    const statAccent = c.accent === '#FFFFFF' ? c.secondary : c.accent;
    return (
      <>
        <Shape x={-1.5} y={-1.5} w={5.5} h={5.5} color={c.primary} transparency={82} circle />
        <Shape x={8.8} y={4.0} w={6.0} h={6.0} color={c.secondary} transparency={85} circle />
        <Shape x={3.5} y={0.55} w={W - 7.0} h={0.05} color={c.secondary} />
        <TxtRegion
          field={{ kind: 'title' }}
          x={1.0} y={0.65} w={W - 2.0} h={0.9}
          value={content.title}
          placeholder="SECTION LABEL"
          size={22} color={c.secondary} bold align="center"
        />
        <TxtRegion
          field={{ kind: 'statValue' }}
          x={0.5} y={1.4} w={W - 1.0} h={3.4}
          value={content.stat?.value}
          placeholder="94%"
          size={120} color={statAccent} bold align="center" lineSpacing={1.0}
        />
        <Shape x={3.5} y={5.1} w={W - 7.0} h={0.04} color={c.secondary} transparency={40} />
        <TxtRegion
          field={{ kind: 'statLabel' }}
          x={1.0} y={5.2} w={W - 2.0} h={0.8}
          value={content.stat?.label}
          placeholder="Stat label"
          size={24} color={c.textOnDark} align="center"
        />
        <TxtRegion
          field={{ kind: 'footnote' }}
          x={0.5} y={H - 0.55} w={W - 1.0} h={0.35}
          value={content.footnote}
          placeholder="Source (optional)"
          size={13} color={c.secondary} italic align="center"
        />
      </>
    );
  };

  const renderImageSide = (imageLeft: boolean) => {
    const imgX = imageLeft ? 0.1 : 7.3;
    const txtX = imageLeft ? 6.3 : 0.5;
    const txtW = imageLeft ? 6.6 : 6.4;
    return (
      <>
        <Shape x={0} y={0} w={W} h={0.1} color={c.primary} />

        <Pressable
          onPress={() => onFieldFocus({ kind: 'image' })}
          style={[
            rc(imgX, 0.1, 5.8, H - 0.3),
            styles.region,
            {
              backgroundColor: content.imageUri ? 'transparent' : c.secondary + '46',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            },
            activeKey === 'image' && { borderColor: c.primary },
          ]}
        >
          {content.imageUri ? (
            <Image
              source={{ uri: content.imageUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <ImagePlus size={Math.max(16, fs(28))} color={c.primary} strokeWidth={1.5} />
              <Text style={{ fontSize: fs(11), fontWeight: '600', color: c.primary }}>
                Tap to add image
              </Text>
            </View>
          )}
        </Pressable>

        <TxtRegion
          field={{ kind: 'title' }}
          x={txtX} y={0.7} w={txtW} h={1.1}
          value={content.title}
          placeholder="Title"
          size={28} color={c.primary} bold
        />
        <Shape x={txtX} y={1.85} w={2.5} h={0.04} color={c.primary} transparency={40} />
        <TxtRegion
          field={{ kind: 'body' }}
          x={txtX} y={2.05} w={txtW} h={4.2}
          value={content.body}
          placeholder="Description…"
          size={20} color={textColor} lineSpacing={1.35}
        />
        <Footer />
      </>
    );
  };

  const renderTimeline = () => {
    const items = content.timelineItems ?? [];
    const step = (W - 1.0) / Math.max(items.length, 1);
    const dotAccent = c.accent === '#FFFFFF' ? c.secondary : c.accent;
    return (
      <>
        <Shape x={0} y={0} w={W} h={1.3} color={c.primary} />
        <Shape x={0} y={1.3} w={W} h={0.04} color={c.secondary} />
        <TxtRegion
          field={{ kind: 'title' }}
          x={0.55} y={0.15} w={W - 1.1} h={1.0}
          value={content.title}
          placeholder="Timeline Title"
          size={28} color={c.textOnDark} bold valign="middle"
        />
        <Shape x={0.5} y={2.1} w={W - 1.0} h={0.05} color={c.primary} />

        <Pressable
          onPress={() => onFieldFocus({ kind: 'timeline' })}
          style={[
            rc(0.4, 1.7, W - 0.8, H - 2.2),
            styles.region,
            activeKey === 'timeline' && { borderColor: c.primary },
          ]}
        >
          {items.length === 0 && (
            <Text
              style={{
                fontSize: fs(14),
                color: phColor,
                textAlign: 'center',
                marginTop: fs(40),
              }}
            >
              Tap to add timeline events
            </Text>
          )}
        </Pressable>

        {items.map((item, i) => {
          const cx = 0.5 + i * step + step / 2;
          return (
            <React.Fragment key={i}>
              <View
                pointerEvents="none"
                style={[
                  rc(cx - 0.2, 1.87, 0.4, 0.4),
                  {
                    backgroundColor: dotAccent,
                    borderRadius: (0.4 * S) / 2,
                    borderWidth: Math.max(1, fs(2)),
                    borderColor: c.primary,
                  },
                ]}
              />
              <Text
                pointerEvents="none"
                style={[
                  rc(cx - 0.6, 2.32, 1.2, 0.4),
                  { fontSize: fs(16), fontWeight: '700', color: c.primary, textAlign: 'center' },
                ]}
              >
                {item.year || 'Year'}
              </Text>
              <Text
                pointerEvents="none"
                style={[
                  rc(cx - step / 2 + 0.1, 2.8, step - 0.2, 3.5),
                  {
                    fontSize: fs(17),
                    color: item.event ? textColor : phColor,
                    textAlign: 'center',
                    lineHeight: fs(17) * 1.2,
                  },
                ]}
              >
                {item.event || 'Event'}
              </Text>
            </React.Fragment>
          );
        })}
        <Footer />
      </>
    );
  };

  const renderClosing = () => (
    <>
      <Shape x={-2.0} y={H - 4.5} w={6.0} h={6.0} color={c.primary} transparency={72} circle />
      <Shape x={W - 3.5} y={-1.5} w={5.0} h={5.0} color={c.secondary} transparency={80} circle />
      <Shape x={W / 2 - 1.5} y={2.3} w={3.0} h={0.05} color={c.secondary} />
      <TxtRegion
        field={{ kind: 'title' }}
        x={1.5} y={2.4} w={W - 3.0} h={1.5}
        value={content.title}
        placeholder="Thank You"
        size={52} color={c.textOnDark} bold align="center"
      />
      <Shape x={W / 2 - 1.5} y={4.05} w={3.0} h={0.05} color={c.secondary} />
      <TxtRegion
        field={{ kind: 'subtitle' }}
        x={1.5} y={4.2} w={W - 3.0} h={0.8}
        value={content.subtitle}
        placeholder="Thank You · Questions?"
        size={18} color={c.secondary} align="center"
      />
      <Shape x={0} y={H - 0.5} w={W} h={0.5} color={c.primary} transparency={35} />
      <Shape x={0} y={H - 0.52} w={W} h={0.04} color={c.secondary} />
    </>
  );

  const renderQuote = () => (
    <>
      <Text
        pointerEvents="none"
        style={[
          rc(0.5, 0.1, 3.5, 3.0),
          { fontSize: fs(200), fontWeight: '700', color: c.secondary, lineHeight: fs(200) },
        ]}
      >
        “
      </Text>
      <TxtRegion
        field={{ kind: 'body' }}
        x={1.4} y={2.1} w={W - 2.8} h={2.9}
        value={content.body}
        placeholder="Type a memorable quote…"
        size={30} color={c.textOnDark} italic align="center" valign="middle" lineSpacing={1.2}
      />
      <Shape x={W / 2 - 0.8} y={5.3} w={1.6} h={0.04} color={c.secondary} />
      <TxtRegion
        field={{ kind: 'subtitle' }}
        x={1.5} y={5.5} w={W - 3.0} h={0.7}
        value={content.subtitle ? `— ${content.subtitle}` : undefined}
        placeholder="— Attribution"
        size={18} color={c.secondary} align="center"
      />
    </>
  );

  const renderSectionDivider = () => (
    <>
      <Shape x={0} y={0} w={0.25} h={H} color={c.secondary} />
      <Shape x={W - 3.0} y={-1.5} w={5.0} h={5.0} color={c.primary} transparency={70} circle />
      <TxtRegion
        field={{ kind: 'sectionNumber' }}
        x={0.9} y={1.2} w={5.0} h={2.0}
        value={content.sectionNumber}
        placeholder="01"
        size={110} color={c.secondary} bold lineSpacing={1.0}
      />
      <TxtRegion
        field={{ kind: 'title' }}
        x={0.95} y={3.5} w={W - 2.0} h={1.6}
        value={content.title}
        placeholder="Section Title"
        size={44} color={c.textOnDark} bold
      />
      <TxtRegion
        field={{ kind: 'subtitle' }}
        x={0.95} y={5.2} w={W - 2.0} h={1.0}
        value={content.subtitle}
        placeholder="Optional description"
        size={18} color={c.secondary}
      />
    </>
  );

  const renderAgenda = () => {
    const items = content.bullets ?? content.steps ?? [];
    const numColor = c.accent === '#FFFFFF' ? c.secondary : c.accent;
    const rowH = Math.min(1.0, (H - 2.2) / Math.max(items.length, 1));
    return (
      <>
        <Shape x={0} y={0} w={W} h={1.4} color={c.primary} />
        <Shape x={0} y={1.4} w={W} h={0.05} color={c.secondary} />
        <TxtRegion
          field={{ kind: 'title' }}
          x={0.55} y={0.15} w={W - 1.1} h={1.1}
          value={content.title}
          placeholder="Agenda"
          size={30} color={c.textOnDark} bold valign="middle"
        />

        <Pressable
          onPress={() => onFieldFocus({ kind: 'bullets' })}
          style={[
            rc(0.5, 1.8, W - 1.0, H - 2.4),
            styles.region,
            activeKey === 'bullets' && { borderColor: c.primary },
          ]}
        >
          {items.length === 0 && (
            <Text style={{ fontSize: fs(15), color: phColor, marginTop: fs(8) }}>
              Tap to add agenda items
            </Text>
          )}
        </Pressable>

        {items.map((item, i) => {
          const yy = 1.9 + i * rowH;
          return (
            <React.Fragment key={i}>
              <View
                pointerEvents="none"
                style={[
                  rc(0.7, yy, 0.55, 0.55),
                  {
                    backgroundColor: numColor,
                    borderRadius: (0.55 * S) / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                ]}
              >
                <Text style={{ fontSize: fs(18), fontWeight: '700', color: c.background }}>
                  {i + 1}
                </Text>
              </View>
              <View
                pointerEvents="none"
                style={[rc(1.5, yy, W - 2.2, 0.55), { justifyContent: 'center' }]}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fs(22), color: item ? textColor : phColor }}
                >
                  {item || `Item ${i + 1}`}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
        <Footer />
      </>
    );
  };

  const renderComparison = () => {
    const cardY = 1.75;
    const cardH = H - 2.4;
    const cardW = W / 2 - 0.85;
    const rightX = W / 2 + 0.35;
    const vsColor = c.accent === '#FFFFFF' ? c.primary : c.accent;
    return (
      <>
        <Shape x={0} y={0} w={W} h={1.3} color={c.primary} />
        <TxtRegion
          field={{ kind: 'title' }}
          x={0.55} y={0.15} w={W - 1.1} h={1.0}
          value={content.title}
          placeholder="Comparison"
          size={28} color={c.textOnDark} bold valign="middle"
        />

        <Shape
          x={0.5} y={cardY} w={cardW} h={cardH}
          color={c.secondary} transparency={55} radius={0.1 * S}
        />
        <Shape
          x={rightX} y={cardY} w={cardW} h={cardH}
          color={c.primary} transparency={88} radius={0.1 * S}
        />

        <TxtRegion
          field={{ kind: 'leftTitle' }}
          x={0.7} y={cardY + 0.2} w={cardW - 0.4} h={0.7}
          value={content.leftTitle}
          placeholder="Option A"
          size={18} color={c.primary} bold align="center"
        />
        <TxtRegion
          field={{ kind: 'leftContent' }}
          x={0.8} y={cardY + 1.0} w={cardW - 0.6} h={cardH - 1.2}
          value={content.leftContent}
          placeholder="Pros / details…"
          size={20} color={textColor} lineSpacing={1.3}
        />
        <TxtRegion
          field={{ kind: 'rightTitle' }}
          x={rightX + 0.2} y={cardY + 0.2} w={cardW - 0.4} h={0.7}
          value={content.rightTitle}
          placeholder="Option B"
          size={18} color={c.primary} bold align="center"
        />
        <TxtRegion
          field={{ kind: 'rightContent' }}
          x={rightX + 0.1} y={cardY + 1.0} w={cardW - 0.6} h={cardH - 1.2}
          value={content.rightContent}
          placeholder="Pros / details…"
          size={20} color={textColor} lineSpacing={1.3}
        />

        <View
          pointerEvents="none"
          style={[
            rc(W / 2 - 0.45, cardY + cardH / 2 - 0.45, 0.9, 0.9),
            {
              backgroundColor: vsColor,
              borderRadius: (0.9 * S) / 2,
              borderWidth: Math.max(1.5, fs(3)),
              borderColor: c.background,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <Text style={{ fontSize: fs(18), fontWeight: '700', color: c.background }}>VS</Text>
        </View>
        <Footer />
      </>
    );
  };

  const renderProcessSteps = () => {
    const steps = (content.steps ?? content.bullets ?? []).slice(0, 5);
    const stepColor = c.accent === '#FFFFFF' ? c.secondary : c.accent;
    const n = Math.max(steps.length, 1);
    const colW = (W - 1.0) / n;
    const circleD = Math.min(1.3, colW * 0.55);
    const circleY = 2.9;
    return (
      <>
        <Shape x={0} y={0} w={W} h={1.3} color={c.primary} />
        <TxtRegion
          field={{ kind: 'title' }}
          x={0.55} y={0.15} w={W - 1.1} h={1.0}
          value={content.title}
          placeholder="Process"
          size={28} color={c.textOnDark} bold valign="middle"
        />

        <Pressable
          onPress={() => onFieldFocus({ kind: 'steps' })}
          style={[
            rc(0.5, 1.7, W - 1.0, H - 2.3),
            styles.region,
            activeKey === 'steps' && { borderColor: c.primary },
          ]}
        >
          {steps.length === 0 && (
            <Text
              style={{
                fontSize: fs(15),
                color: phColor,
                textAlign: 'center',
                marginTop: fs(50),
              }}
            >
              Tap to add process steps
            </Text>
          )}
        </Pressable>

        {steps.map((step, i) => {
          const cx = 0.5 + i * colW + colW / 2;
          return (
            <React.Fragment key={i}>
              {i < steps.length - 1 && (
                <Shape
                  x={cx + circleD / 2 + 0.1}
                  y={circleY + circleD / 2 - 0.12}
                  w={colW - circleD - 0.2}
                  h={0.24}
                  color={c.secondary}
                  transparency={30}
                  radius={0.12 * S}
                />
              )}
              <View
                pointerEvents="none"
                style={[
                  rc(cx - circleD / 2, circleY, circleD, circleD),
                  {
                    backgroundColor: stepColor,
                    borderRadius: (circleD * S) / 2,
                    borderWidth: Math.max(1, fs(2)),
                    borderColor: c.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                ]}
              >
                <Text style={{ fontSize: fs(30), fontWeight: '700', color: c.background }}>
                  {i + 1}
                </Text>
              </View>
              <Text
                pointerEvents="none"
                style={[
                  rc(cx - colW / 2 + 0.15, circleY + circleD + 0.25, colW - 0.3, 1.6),
                  {
                    fontSize: fs(18),
                    color: step ? textColor : phColor,
                    textAlign: 'center',
                    lineHeight: fs(18) * 1.15,
                  },
                ]}
              >
                {step || `Step ${i + 1}`}
              </Text>
            </React.Fragment>
          );
        })}
        <Footer />
      </>
    );
  };

  const renderBlank = () => (
    <View style={styles.blankWrap} pointerEvents="none">
      <Text style={[styles.blankMsg, { color: isDarkSlide ? c.textOnDark : c.textMuted }]}>
        Blank slide
      </Text>
    </View>
  );

  const renderLayout = () => {
    switch (layout) {
      case 'title':
        return renderTitle();
      case 'closing':
        return renderClosing();
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
      {renderLayout()}
    </View>
  );
};

const styles = StyleSheet.create({
  canvas: {
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 5,
  },

  region: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },

  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },

  blankWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blankMsg: {
    fontSize: 11,
    fontStyle: 'italic',
    opacity: 0.4,
  },
});
