// ─────────────────────────────────────────────
//  PPT Module — SlideThumbnailStrip
//  Horizontal scrollable strip of slide thumbnails.
//  Tapping selects; long-press opens context menu.
// ─────────────────────────────────────────────

import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
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
}

const THUMB_SCALE = 0.28;

export const SlideThumbnailStrip: React.FC<SlideThumbnailStripProps> = ({
  slides,
  selectedIndex,
  theme,
  onSelect,
  onDelete,
  onDuplicate,
  onAddAfter,
}) => {
  const scrollRef = useRef<ScrollView>(null);

  const handleLongPress = (index: number) => {
    const opts = ['Delete'];
    if (onDuplicate) opts.unshift('Duplicate');
    if (onAddAfter) opts.unshift('Add Slide After');

    Alert.alert(`Slide ${index + 1}`, 'Actions', [
      ...opts.map(o => ({
        text: o,
        style: o === 'Delete' ? ('destructive' as const) : ('default' as const),
        onPress: () => {
          if (o === 'Delete') onDelete(index);
          else if (o === 'Duplicate' && onDuplicate) onDuplicate(index);
          else if (o === 'Add Slide After' && onAddAfter) onAddAfter(index);
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.container}>
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
              index === selectedIndex && [
                styles.thumbSelected,
                { borderColor: theme.colors.primary },
              ],
            ]}
          >
            <SlideCard
              slide={slide}
              theme={theme}
              scale={THUMB_SCALE}
            />
            <Text
              style={[
                styles.slideNum,
                index === selectedIndex && { color: theme.colors.primary, fontWeight: '700' },
              ]}
            >
              {index + 1}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 80,
    backgroundColor: '#F9FAFB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  content: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 8,
  },
  thumbWrapper: {
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    position: 'relative',
  },
  thumbSelected: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  slideNum: {
    position: 'absolute',
    bottom: 3,
    right: 5,
    fontSize: 9,
    color: '#9CA3AF',
    fontWeight: '500',
  },
});
