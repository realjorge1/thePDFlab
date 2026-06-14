// ─────────────────────────────────────────────
//  PPT Module — PPTHomeScreen
//  Dashboard: Create new, Themes, Feature overview.
// ─────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
  Alert,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/services/ThemeProvider';
import { AppHeaderContainer } from '@/components/AppHeaderContainer';
import { GradientView } from '@/components/GradientView';
import { colors as brandColors } from '@/constants/theme';
import { THEME_LIST } from '../../themes/pptThemes';
import { ThemeId, PPTPresentation } from '../../types/ppt.types';
import {
  generateDeckFromTopic,
  DECK_TOPIC_EXAMPLES,
} from '../../services/topicToDeck.service';
import {
  ArrowLeft,
  FilePlus,
  Palette,
  LayoutTemplate,
  Image as ImageIcon,
  Pencil,
  RotateCcw,
  Share2,
  CheckCircle,
  Sparkles,
  Wand2,
  X,
  ArrowRight,
} from 'lucide-react-native';

interface PPTHomeScreenProps {
  onCreateNew: (themeId?: ThemeId) => void;
  /** Open the editor on a deck built by Topic-to-deck. */
  onCreateWithPresentation?: (p: PPTPresentation) => void;
  onExit?: () => void;
}

// Status lines shown while the deck is being built — they sell the ~10s wait.
const GENERATION_STAGES = [
  'Reading your brief…',
  'Structuring the story…',
  'Choosing the right layout per slide…',
  'Writing your slides…',
  'Applying the theme…',
  'Almost ready…',
];

// ─── Feature Cards data ───────────────────────
const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI Topic-to-Deck',
    desc: 'One sentence → a complete, themed presentation',
    gradient: ['#6D28D9', '#4F46E5'] as [string, string],
  },
  {
    icon: LayoutTemplate,
    title: '14 Smart Layouts',
    desc: 'Comparison, Timeline, Stats, Process Steps & more',
    gradient: ['#0891B2', '#06B6D4'] as [string, string],
  },
  {
    icon: Palette,
    title: 'Pro Themes',
    desc: 'Full color systems, fonts & accent palettes',
    gradient: ['#4F46E5', '#7C3AED'] as [string, string],
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
  onCreateWithPresentation,
  onExit,
}) => {
  const { colors: t } = useTheme();

  // ─── Topic-to-deck state ───────────────────
  const [topic, setTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Animations: a soft sparkle pulse on the hero badge + a looping progress
  // shimmer + a status-line cross-fade while generating.
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const stageOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Drive the staged status text + indeterminate progress bar during generation.
  useEffect(() => {
    if (!isGenerating) return;
    progress.setValue(0);
    const bar = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    );
    bar.start();

    const timer = setInterval(() => {
      Animated.timing(stageOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setStageIndex((i) => Math.min(i + 1, GENERATION_STAGES.length - 1));
        Animated.timing(stageOpacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
      });
    }, 1700);

    return () => {
      bar.stop();
      clearInterval(timer);
    };
  }, [isGenerating, progress, stageOpacity]);

  const handleGenerate = useCallback(async () => {
    const brief = topic.trim();
    if (!brief || isGenerating) return;
    Keyboard.dismiss();

    const controller = new AbortController();
    abortRef.current = controller;
    setStageIndex(0);
    stageOpacity.setValue(1);
    setIsGenerating(true);

    try {
      const { presentation } = await generateDeckFromTopic(brief, undefined, controller.signal);
      if (controller.signal.aborted) return;
      // Hand the finished deck to the editor.
      if (onCreateWithPresentation) onCreateWithPresentation(presentation);
      else onCreateNew(presentation.themeId);
      // Clear so returning home is a fresh slate.
      setTopic('');
    } catch (e: any) {
      if (controller.signal.aborted || e?.name === 'AbortError') return;
      if (e?.name === 'PremiumRequiredError') {
        Alert.alert(
          'Premium Feature',
          'Topic-to-deck uses AI and is part of Premium. You can still build a deck from scratch.',
        );
      } else {
        Alert.alert(
          'Could not build the deck',
          'Something went wrong while generating. Please check your connection and try again.',
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsGenerating(false);
    }
  }, [topic, isGenerating, onCreateWithPresentation, onCreateNew, stageOpacity]);

  const handleCancelGenerate = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  }, []);

  // Abort any in-flight request if the screen unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const progressLeft = progress.interpolate({ inputRange: [0, 1], outputRange: ['-40%', '100%'] });

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
        keyboardShouldPersistTaps="handled"
      >
        {/* ─── ✦ Topic-to-Deck (the standout) ───────────────────────── */}
        <GradientView
          colors={['#6D28D9', '#4F46E5', '#0891B2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTopRow}>
            <Animated.View
              style={[styles.heroBadge, { transform: [{ scale: pulseScale }] }]}
            >
              <Sparkles size={16} color="#FFFFFF" strokeWidth={2.4} />
            </Animated.View>
            <View style={styles.heroBadgeText}>
              <Text style={styles.heroEyebrow}>AI · TOPIC → DECK</Text>
              <Text style={styles.heroTitle}>Describe it. Get a full deck.</Text>
            </View>
            <View style={styles.heroTimePill}>
              <Text style={styles.heroTimePillText}>~10s</Text>
            </View>
          </View>

          <Text style={styles.heroSub}>
            One sentence in. A themed, ready-to-edit presentation out — with the right
            layout chosen for every slide.
          </Text>

          {isGenerating ? (
            /* ── Generating state ── */
            <View style={styles.genWrap}>
              <View style={styles.genStatusRow}>
                <Wand2 size={15} color="#FFFFFF" strokeWidth={2.2} />
                <Animated.Text style={[styles.genStatusText, { opacity: stageOpacity }]} numberOfLines={1}>
                  {GENERATION_STAGES[stageIndex]}
                </Animated.Text>
              </View>
              <View style={styles.genTrack}>
                <Animated.View style={[styles.genBar, { left: progressLeft }]} />
              </View>
              <TouchableOpacity onPress={handleCancelGenerate} style={styles.genCancel} activeOpacity={0.8}>
                <X size={13} color="#FFFFFF" strokeWidth={2.4} />
                <Text style={styles.genCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Input state ── */
            <>
              <View style={styles.heroInputWrap}>
                <TextInput
                  style={styles.heroInput}
                  value={topic}
                  onChangeText={setTopic}
                  placeholder="e.g. Pitch deck for a fitness app targeting Gen Z"
                  placeholderTextColor="rgba(255,255,255,0.6)"
                  multiline
                  maxLength={220}
                  returnKeyType="go"
                  blurOnSubmit
                  onSubmitEditing={handleGenerate}
                />
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
                keyboardShouldPersistTaps="handled"
              >
                {DECK_TOPIC_EXAMPLES.map((ex) => (
                  <TouchableOpacity
                    key={ex}
                    style={styles.chip}
                    onPress={() => setTopic(ex)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>{ex}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={[styles.generateBtn, !topic.trim() && styles.generateBtnDisabled]}
                onPress={handleGenerate}
                disabled={!topic.trim()}
                activeOpacity={0.9}
              >
                <Sparkles size={17} color="#4F46E5" strokeWidth={2.5} />
                <Text style={styles.generateBtnText}>Generate deck</Text>
                <ArrowRight size={16} color="#4F46E5" strokeWidth={2.5} />
              </TouchableOpacity>
            </>
          )}
        </GradientView>

        {/* ─── New Presentation (full-width) ─── */}
        <TouchableOpacity
          onPress={() => onCreateNew()}
          style={styles.newCard}
          activeOpacity={0.82}
        >
          <View style={[styles.actionIconBox, { backgroundColor: '#4F46E520' }]}>
            <FilePlus size={26} color="#4F46E5" strokeWidth={2} />
          </View>
          <View style={styles.newCardText}>
            <Text style={[styles.actionTitle, { color: '#4F46E5' }]}>New Presentation</Text>
            <Text style={[styles.actionDesc, { color: t.textSecondary }]}>
              Start from scratch · 14 layouts · Export to .pptx
            </Text>
          </View>
          <View style={styles.paletteChip}>
            <Palette size={20} color="#0891B2" strokeWidth={2.2} />
          </View>
        </TouchableOpacity>

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
          <View style={[styles.featuresPanel, { backgroundColor: t.card, borderColor: t.borderLight }]}>
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <View
                  key={i}
                  style={[
                    styles.featureRow,
                    i < FEATURES.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: t.borderLight,
                    },
                  ]}
                >
                  <View style={[styles.featureIconWrap, { backgroundColor: f.gradient[0] + '18' }]}>
                    <Icon size={20} color={f.gradient[0]} strokeWidth={2} />
                  </View>
                  <View style={styles.featureRowText}>
                    <Text style={[styles.featureTitle, { color: t.text }]}>{f.title}</Text>
                    <Text style={[styles.featureDesc, { color: t.textSecondary }]}>{f.desc}</Text>
                  </View>
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

  // ── Topic-to-Deck hero ──
  heroCard: {
    borderRadius: 22,
    padding: 18,
    gap: 14,
    // Soft elevation so it reads as the primary surface on the screen.
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  heroBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
  },
  heroBadgeText: { flex: 1, gap: 2 },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.78)',
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  heroTimePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  heroTimePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  heroSub: {
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.88)',
    marginTop: -4,
  },
  heroInputWrap: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  heroInput: {
    color: '#FFFFFF',
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '600',
    padding: 0,
    maxHeight: 96,
  },
  chipsRow: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    maxWidth: 220,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  chipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 13,
  },
  generateBtnDisabled: { opacity: 0.55 },
  generateBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4F46E5',
    letterSpacing: 0.1,
  },

  // ── Generating state ──
  genWrap: { gap: 12, paddingTop: 2 },
  genStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  genStatusText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  genTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  genBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '40%',
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  genCancel: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  genCancelText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // New Presentation card (full-width)
  newCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#EEF2FF',
  },
  newCardText: { flex: 1, gap: 3 },
  actionIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  actionDesc: { fontSize: 12, lineHeight: 16 },
  // Palette chip — carries the old "Open & Re-theme" light-mode colors
  paletteChip: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#E0F2FE',
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

  // Feature panel — one card, all features as rows
  featuresPanel: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  featureRowText: { flex: 1, gap: 2 },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
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
