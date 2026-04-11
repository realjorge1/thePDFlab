// ─────────────────────────────────────────────
//  PPT Module — ThemePicker (rebuilt)
//  Full-width cards, rich preview, clear selection.
// ─────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useTheme } from '@/services/ThemeProvider';
import { ThemeId, PPTTheme } from '../../types/ppt.types';
import { THEME_LIST } from '../../themes/pptThemes';
import { Check } from 'lucide-react-native';

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 16;
const CARD_GAP = 10;
const CARD_W = (SCREEN_W - H_PAD * 2 - CARD_GAP) / 2;
const PREVIEW_H = 80;

interface ThemePickerProps {
  selectedThemeId: ThemeId;
  onSelect: (id: ThemeId) => void;
}

export const ThemePicker: React.FC<ThemePickerProps> = ({
  selectedThemeId,
  onSelect,
}) => {
  const { colors: t } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: t.textSecondary }]}>CHOOSE THEME</Text>
      <Text style={[styles.subheading, { color: t.textTertiary }]}>
        Tap a theme to apply it to your presentation
      </Text>

      <View style={styles.grid}>
        {THEME_LIST.map(theme => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            selected={theme.id === selectedThemeId}
            onPress={() => onSelect(theme.id)}
          />
        ))}
      </View>
    </View>
  );
};

interface ThemeCardProps {
  theme: PPTTheme;
  selected: boolean;
  onPress: () => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({ theme, selected, onPress }) => {
  const { colors: t, mode } = useTheme();
  const accentText = mode === 'dark' ? theme.colors.secondary : theme.colors.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.78}
      style={[
        styles.card,
        {
          backgroundColor: t.card,
          borderColor: selected ? theme.colors.primary : t.border,
          borderWidth: selected ? 2.5 : 1,
        },
      ]}
    >
      {/* ── Slide Preview ── */}
      <View style={[styles.preview, { backgroundColor: theme.colors.backgroundDark }]}>
        {/* Top accent band */}
        <View style={[styles.band, { backgroundColor: theme.colors.primary }]}>
          <View style={styles.bandLines}>
            <View style={[styles.bandLine, { backgroundColor: theme.colors.textOnDark, width: '65%' }]} />
            <View style={[styles.bandLine, { backgroundColor: theme.colors.secondary, width: '40%', opacity: 0.75 }]} />
          </View>
        </View>
        {/* Body lines */}
        <View style={styles.previewBody}>
          <View style={[styles.bodyLine, { backgroundColor: theme.colors.textOnDark, width: '80%', opacity: 0.5 }]} />
          <View style={[styles.bodyLine, { backgroundColor: theme.colors.secondary, width: '60%', opacity: 0.4 }]} />
          <View style={[styles.bodyLine, { backgroundColor: theme.colors.secondary, width: '45%', opacity: 0.25 }]} />
        </View>
        {/* Bottom accent strip */}
        <View style={[styles.bottomStrip, { backgroundColor: theme.colors.primary, opacity: 0.6 }]} />
        {/* Selected checkmark */}
        {selected && (
          <View style={[styles.checkBadge, { backgroundColor: theme.colors.primary }]}>
            <Check size={11} color="#FFFFFF" strokeWidth={3} />
          </View>
        )}
      </View>

      {/* ── Palette Row ── */}
      <View style={styles.palette}>
        {[theme.colors.primary, theme.colors.secondary, theme.colors.accent, theme.colors.backgroundDark].map(
          (color, i) => (
            <View key={i} style={[styles.swatch, { backgroundColor: color }]} />
          ),
        )}
        <View style={styles.spacer} />
        {selected && (
          <Text style={[styles.selectedLabel, { color: accentText }]}>Active</Text>
        )}
      </View>

      {/* ── Name & Description ── */}
      <View style={styles.cardText}>
        <Text
          style={[
            styles.themeName,
            { color: selected ? accentText : t.text },
          ]}
          numberOfLines={1}
        >
          {theme.name}
        </Text>
        <Text style={[styles.themeDesc, { color: t.textTertiary }]} numberOfLines={2}>
          {theme.description}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: H_PAD,
    paddingBottom: 16,
  },
  heading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },

  card: {
    width: CARD_W,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  // Preview
  preview: {
    height: PREVIEW_H,
    position: 'relative',
  },
  band: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  bandLines: { gap: 5 },
  bandLine: { height: 4, borderRadius: 2 },
  previewBody: {
    flex: 1,
    paddingHorizontal: 8,
    paddingTop: 7,
    gap: 4,
  },
  bodyLine: { height: 4, borderRadius: 2 },
  bottomStrip: { height: 4, width: '100%' },

  // Check badge
  checkBadge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },

  // Palette
  palette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  spacer: { flex: 1 },
  selectedLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Card text
  cardText: {
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 3,
  },
  themeName: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  themeDesc: {
    fontSize: 10,
    lineHeight: 13,
  },
});
