// ─────────────────────────────────────────────
//  PPT Module — PPTHomeScreen
//  Dashboard: Create new, Open existing, Themes.
// ─────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/services/ThemeProvider';
import { AppHeaderContainer } from '@/components/AppHeaderContainer';
import { GradientView } from '@/components/GradientView';
import { colors as brandColors } from '@/constants/theme';
import { THEME_LIST } from '../../themes/pptThemes';
import { ThemeId } from '../../types/ppt.types';
import {
  ArrowLeft,
  FilePlus,
  FolderOpen,
  ChevronRight,
  Palette,
  LayoutTemplate,
  Image as ImageIcon,
  Pencil,
  RotateCcw,
  Share2,
  CheckCircle,
} from 'lucide-react-native';

interface PPTHomeScreenProps {
  onCreateNew: (themeId?: ThemeId) => void;
  onOpenExisting: () => void;
  onExit?: () => void;
}

// ─── Feature Cards data ───────────────────────
const FEATURES = [
  {
    icon: Palette,
    title: '12 Pro Themes',
    desc: 'Full color systems, fonts & accent palettes',
    gradient: ['#4F46E5', '#7C3AED'] as [string, string],
  },
  {
    icon: LayoutTemplate,
    title: '9 Slide Layouts',
    desc: 'Title, Content, Stats, Timeline, Image & more',
    gradient: ['#0891B2', '#06B6D4'] as [string, string],
  },
  {
    icon: Pencil,
    title: 'Inline Editing',
    desc: 'Type directly on the slide — no separate forms',
    gradient: ['#059669', '#10B981'] as [string, string],
  },
  {
    icon: ImageIcon,
    title: 'Image Insertion',
    desc: 'Add photos from camera roll or gallery',
    gradient: ['#D97706', '#F59E0B'] as [string, string],
  },
  {
    icon: RotateCcw,
    title: 'Undo / Redo',
    desc: 'Full edit history — never lose your work',
    gradient: ['#DB2777', '#EC4899'] as [string, string],
  },
  {
    icon: Share2,
    title: 'Export & Share',
    desc: 'Save .pptx and share to any app instantly',
    gradient: ['#EA580C', '#F97316'] as [string, string],
  },
];

export const PPTHomeScreen: React.FC<PPTHomeScreenProps> = ({
  onCreateNew,
  onOpenExisting,
  onExit,
}) => {
  const { colors: t } = useTheme();

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: t.background }]}
      edges={['top', 'bottom']}
    >
      {/* ─── Gradient Header ─── */}
      <AppHeaderContainer>
        <GradientView
          colors={[brandColors.gradientStart, brandColors.gradientMid, brandColors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerRow}>
            {onExit ? (
              <TouchableOpacity onPress={onExit} hitSlop={12} style={styles.exitBtn}>
                <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2.2} />
              </TouchableOpacity>
            ) : (
              <View style={styles.exitBtnPlaceholder} />
            )}
            <View style={styles.headerCenter}>
              <Text style={styles.headerLabel}>PRESENTATIONS</Text>
              <Text style={styles.headerTitle}>PowerPoint Studio</Text>
            </View>
            <View style={styles.exitBtnPlaceholder} />
          </View>
        </GradientView>
      </AppHeaderContainer>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Action Cards ─── */}
        <View style={styles.cardsRow}>
          <TouchableOpacity
            onPress={() => onCreateNew()}
            style={[styles.actionCard, { backgroundColor: '#EEF2FF' }]}
            activeOpacity={0.82}
          >
            <View style={[styles.actionIconBox, { backgroundColor: '#4F46E520' }]}>
              <FilePlus size={26} color="#4F46E5" strokeWidth={2} />
            </View>
            <Text style={[styles.actionTitle, { color: '#4F46E5' }]}>New Presentation</Text>
            <Text style={[styles.actionDesc, { color: t.textSecondary }]}>
              {'12 themes · 9 layouts\nExport to .pptx'}
            </Text>
            <View style={[styles.actionArrow, { backgroundColor: '#4F46E5' }]}>
              <ChevronRight size={14} color="#FFFFFF" strokeWidth={3} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onOpenExisting}
            style={[styles.actionCard, { backgroundColor: '#E0F2FE' }]}
            activeOpacity={0.82}
          >
            <View style={[styles.actionIconBox, { backgroundColor: '#0891B220' }]}>
              <FolderOpen size={26} color="#0891B2" strokeWidth={2} />
            </View>
            <Text style={[styles.actionTitle, { color: '#0891B2' }]}>Open & Re-theme</Text>
            <Text style={[styles.actionDesc, { color: t.textSecondary }]}>
              {'Import .pptx\nApply a new look'}
            </Text>
            <View style={[styles.actionArrow, { backgroundColor: '#0891B2' }]}>
              <ChevronRight size={14} color="#FFFFFF" strokeWidth={3} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ─── Available Themes (interactive) ─── */}
        <View>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Available Themes</Text>
            <Text style={[styles.sectionSubtitle, { color: t.textTertiary }]}>Tap to start with a theme</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.themesRow}
          >
            {THEME_LIST.map(theme => (
              <TouchableOpacity
                key={theme.id}
                style={styles.themePreview}
                onPress={() => onCreateNew(theme.id)}
                activeOpacity={0.75}
              >
                <View
                  style={[styles.miniSlide, { backgroundColor: theme.colors.backgroundDark }]}
                >
                  <View style={[styles.miniHeader, { backgroundColor: theme.colors.primary }]} />
                  <View style={styles.miniLines}>
                    <View style={[styles.miniLine, { backgroundColor: theme.colors.textOnDark, width: '80%' }]} />
                    <View style={[styles.miniLine, { backgroundColor: theme.colors.secondary, width: '55%', opacity: 0.7 }]} />
                    <View style={[styles.miniLine, { backgroundColor: theme.colors.secondary, width: '40%', opacity: 0.4 }]} />
                  </View>
                  <View style={[styles.miniFooter, { backgroundColor: theme.colors.primary, opacity: 0.5 }]} />
                  {/* Tap overlay indicator */}
                  <View style={styles.themeStartOverlay}>
                    <CheckCircle size={10} color="#FFFFFF" strokeWidth={2.5} />
                  </View>
                </View>
                <Text style={[styles.themePreviewName, { color: t.textSecondary }]} numberOfLines={2}>
                  {theme.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ─── Feature Showcase ─── */}
        <View>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>What You Can Do</Text>
          </View>
          <View style={styles.featuresGrid}>
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <View
                  key={i}
                  style={[styles.featureCard, { backgroundColor: t.card, borderColor: t.borderLight }]}
                >
                  <View style={[styles.featureIconWrap, { backgroundColor: f.gradient[0] + '18' }]}>
                    <Icon size={22} color={f.gradient[0]} strokeWidth={2} />
                  </View>
                  <Text style={[styles.featureTitle, { color: t.text }]}>{f.title}</Text>
                  <Text style={[styles.featureDesc, { color: t.textSecondary }]}>{f.desc}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header
  header: { paddingBottom: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  exitBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  exitBtnPlaceholder: { width: 38 },
  headerCenter: { flex: 1, alignItems: 'center', paddingTop: 8 },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 24,
  },

  // Action cards
  cardsRow: { flexDirection: 'row', gap: 12 },
  actionCard: {
    flex: 1,
    borderRadius: 18,
    padding: 16,
    gap: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  actionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  actionTitle: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  actionDesc: { fontSize: 12, lineHeight: 16 },
  actionArrow: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: '500' },

  // Themes row
  themesRow: { gap: 10, paddingRight: 4 },
  themePreview: { alignItems: 'center', gap: 6, width: 76 },
  miniSlide: {
    width: 76,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  miniHeader: { height: 14, width: '100%' },
  miniLines: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 5,
    gap: 4,
  },
  miniLine: { height: 4, borderRadius: 2 },
  miniFooter: { height: 4, width: '100%' },
  themeStartOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themePreviewName: {
    fontSize: 9,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 12,
  },

  // Feature cards grid
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featureCard: {
    width: '47.5%',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
  },
  featureIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  featureDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
});
