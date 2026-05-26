// ─────────────────────────────────────────────
//  PPT Module — SlideThumbnailStrip
//  Horizontal scrollable strip of slide thumbnails.
//  Tapping selects; long-press opens context menu.
// ─────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { Plus } from 'lucide-react-native';
import { useTheme } from '@/services/ThemeProvider';
import { Slide, PPTTheme } from '../../types/ppt.types';
import { SlideCard } from './SlideCard';

interface SlideThumbnailStripProps {
  slides: Slide[];
  selectedIndex: number;
  theme: PPTTheme;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
  onDuplicate?: (index: number) => void;
  onAddAfter?: (index: number) => void;
  /** Move a slide one position left / right. */
  onMove?: (from: number, to: number) => void;
  /** Renders a "+" card at the end of the strip for seamless slide addition */
  onAdd?: () => void;
}

const THUMB_SCALE = 0.28;
const BASE_W = 360;
const BASE_H = 202;
const THUMB_W = Math.round(BASE_W * THUMB_SCALE); // ~101
const THUMB_H = Math.round(BASE_H * THUMB_SCALE); // ~57

export const SlideThumbnailStrip: React.FC<SlideThumbnailStripProps> = ({
  slides,
  selectedIndex,
  theme,
  onSelect,
  onDelete,
  onDuplicate,
  onAddAfter,
  onMove,
  onAdd,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const { colors: t } = useTheme();

  // Keep the selected thumbnail comfortably in view.
  useEffect(() => {
    const STEP = THUMB_W + 8; // thumb width + gap
    scrollRef.current?.scrollTo({
      x: Math.max(0, selectedIndex * STEP - STEP),
      animated: true,
    });
  }, [selectedIndex]);

  const handleLongPress = (index: number) => {
    const buttons: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [];
    if (onAddAfter) buttons.push({ text: 'Add Slide After', onPress: () => onAddAfter(index) });
    if (onDuplicate) buttons.push({ text: 'Duplicate', onPress: () => onDuplicate(index) });
    if (onMove && index > 0) buttons.push({ text: 'Move Left', onPress: () => onMove(index, index - 1) });
    if (onMove && index < slides.length - 1) buttons.push({ text: 'Move Right', onPress: () => onMove(index, index + 1) });
    buttons.push({ text: 'Delete', style: 'destructive', onPress: () => onDelete(index) });
    buttons.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(`Slide ${index + 1}`, 'Actions', buttons);
  };

  return (
    <View style={[styles.container, { backgroundColor: t.backgroundSecondary, borderTopColor: t.border }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {slides.map((slide, index) => (
          <TouchableOpacity
            key={slide.id}
            onPress={() => onSelect(index)}
            onLongPress={() => handleLongPress(index)}
            delayLongPress={400}
            activeOpacity={0.85}
            style={[
              styles.thumbWrapper,
              { borderColor: 'transparent' },
              index === selectedIndex && [
                styles.thumbSelected,
                { borderColor: theme.colors.primary },
              ],
            ]}
          >
            <SlideCard slide={slide} theme={theme} scale={THUMB_SCALE} />
            <Text
              style={[
                styles.slideNum,
                { color: t.textTertiary },
                index === selectedIndex && { color: theme.colors.primary, fontWeight: '700' },
              ]}
            >
              {index + 1}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Inline "+" card — seamless slide addition at the end of the strip */}
        {onAdd && (
          <TouchableOpacity
            onPress={onAdd}
            activeOpacity={0.7}
            style={[
              styles.addCard,
              {
                width: THUMB_W,
                height: THUMB_H,
                borderColor: t.border,
                backgroundColor: t.backgroundSecondary,
              },
            ]}
          >
            <Plus size={20} color={t.textSecondary} strokeWidth={1.8} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 88,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  content: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 8,
  },
  thumbWrapper: {
    borderRadius: 7,
    borderWidth: 2.5,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbSelected: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  slideNum: {
    position: 'absolute',
    bottom: 3,
    right: 5,
    fontSize: 9,
    fontWeight: '600',
  },
  addCard: {
    borderRadius: 7,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
