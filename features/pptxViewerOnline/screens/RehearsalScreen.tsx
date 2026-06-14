// ============================================================================
// RehearsalScreen — a full-screen rehearsal timer for a loaded PPTX deck.
//
// Three modes inside one full-screen overlay:
//   • setup       — pick a target time + distribution (bottom sheet)
//   • rehearsing  — the slide fills the screen; floating timers + controls;
//                   the slide border pulses amber/red as you near/exceed the
//                   per-slide target. The user paces manually (swipe / Next).
//   • results     — per-slide breakdown bars, smart callouts, history trend.
//
// Timing model (pause-aware, revisit-safe):
//   accumulatedRef[i]  committed ms already spent on slide i
//   segmentStartRef    Date.now() of the currently-running segment, or null
//   A slide's live time = accumulatedRef[i] + (now - segmentStartRef).
//   Total rehearsal time = Σ accumulatedRef + the live segment. Every moment is
//   attributed to exactly one slide, so the total is just the sum of the parts.
// ============================================================================

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";

import {
  PptxOfflineViewer,
  type PptxOfflineViewerHandle,
} from "../components/PptxOfflineViewer";
import {
  PptxPdfViewer,
  type PptxPdfViewerHandle,
} from "../components/PptxPdfViewer";
import {
  useRehearsalHistory,
  type RehearsalRun,
} from "../hooks/useRehearsalHistory";

// ── Signal colors ───────────────────────────────────────────────
const GREEN = "#22C55E";
const AMBER = "#F59E0B";
const RED = "#EF4444";

const PRESETS = [5, 7, 10, 15, 20, 30];

type Mode = "setup" | "rehearsing" | "results";
type Distribution = "even" | "weighted";
type SlideStatus = "ok" | "over" | "rushed";

export type RehearsalSource =
  | { kind: "pdf"; pdfUri: string; backgroundColor: string }
  | { kind: "offline"; html: string };

interface RehearsalScreenProps {
  visible: boolean;
  onClose: () => void;
  fileName: string;
  /** Stable identifier for the deck — used to scope saved history. */
  fileKey: string;
  totalSlides: number;
  source: RehearsalSource;
  /** Jump the underlying viewer to a slide (1-based) and dismiss. */
  onJumpToSlide: (page: number) => void;
}

// ── Pure helpers ────────────────────────────────────────────────

/** mm:ss for a non-negative duration. */
function fmt(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Per-slide target distribution. "weighted" gives the first and last slides
 * (typically the title and the "Thank You" closer) half weight, so they don't
 * claim a full content-slide's worth of the budget. We can't read slide layout
 * from a rendered deck, so first/last is the pragmatic heuristic.
 */
function computeTargets(
  totalMs: number,
  n: number,
  mode: Distribution,
): number[] {
  if (n <= 0) return [];
  if (mode === "even" || n <= 2) return new Array(n).fill(totalMs / n);
  const weights = Array.from({ length: n }, (_, i) =>
    i === 0 || i === n - 1 ? 0.5 : 1,
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (totalMs * w) / sum);
}

function statusFor(
  durationMs: number,
  targetMs: number,
  isEdge: boolean,
): SlideStatus {
  if (targetMs <= 0) return "ok";
  const r = durationMs / targetMs;
  if (r > 1.05) return "over";
  if (r < 0.5 && !isEdge) return "rushed";
  return "ok";
}

interface Callout {
  kind: SlideStatus;
  text: string;
}

function buildCallouts(durations: number[], targets: number[]): Callout[] {
  const n = durations.length;
  const out: Callout[] = [];
  let worstOverIdx = -1;
  let worstOverDelta = 0;
  let worstRushIdx = -1;
  let worstRushRatio = 1;
  let okCount = 0;

  durations.forEach((d, i) => {
    const t = targets[i] ?? 0;
    const isEdge = i === 0 || i === n - 1;
    const st = statusFor(d, t, isEdge);
    if (st === "ok") okCount += 1;
    if (st === "over" && d - t > worstOverDelta) {
      worstOverDelta = d - t;
      worstOverIdx = i;
    }
    if (st === "rushed" && t > 0 && d / t < worstRushRatio) {
      worstRushRatio = d / t;
      worstRushIdx = i;
    }
  });

  if (worstOverIdx >= 0) {
    out.push({
      kind: "over",
      text: `You overran Slide ${worstOverIdx + 1} by ${Math.round(
        worstOverDelta / 1000,
      )}s — consider splitting it or trimming the bullet points.`,
    });
  }
  if (worstRushIdx >= 0) {
    out.push({
      kind: "rushed",
      text: `You rushed Slide ${worstRushIdx + 1} (${fmt(
        durations[worstRushIdx],
      )} vs ${fmt(targets[worstRushIdx])} target) — did you skip content?`,
    });
  }
  out.push({
    kind: "ok",
    text: `${okCount} of ${n} slide${n === 1 ? "" : "s"} ${
      okCount === 1 ? "was" : "were"
    } on target.`,
  });
  return out;
}

// ============================================================================

export function RehearsalScreen({
  visible,
  onClose,
  fileName,
  fileKey,
  totalSlides,
  source,
  onJumpToSlide,
}: RehearsalScreenProps) {
  const { colors: t } = useTheme();
  const insets = useSafeAreaInsets();
  const { history, addRun } = useRehearsalHistory(fileKey);

  const [mode, setMode] = useState<Mode>("setup");

  // Setup choices
  const [targetMinutes, setTargetMinutes] = useState(10);
  const [isCustom, setIsCustom] = useState(false);
  const [distribution, setDistribution] = useState<Distribution>("weighted");

  // Live rehearsal state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [, setTick] = useState(0); // forces the timer re-render

  // Slide count. Prefer the count the parent already knows; otherwise fall back
  // to the count this overlay's own viewer reports once it loads. This is what
  // lets app-created decks rehearse even if the parent hadn't resolved a page
  // count yet (the Rehearse button no longer waits on it).
  const [loadedTotal, setLoadedTotal] = useState(0);
  const effectiveTotal = totalSlides > 0 ? totalSlides : loadedTotal;

  // Results snapshot
  const [results, setResults] = useState<{
    durations: number[];
    targets: number[];
    totalTargetMs: number;
  } | null>(null);

  // Refs are the source of truth for timing so interval/native callbacks never
  // read stale closures.
  const accumulatedRef = useRef<number[]>([]);
  const segmentStartRef = useRef<number | null>(null);
  const targetsRef = useRef<number[]>([]);
  const currentIndexRef = useRef(0);
  const pausedRef = useRef(false);

  const pdfRef = useRef<PptxPdfViewerHandle | null>(null);
  const offlineRef = useRef<PptxOfflineViewerHandle | null>(null);

  // Latest `mode` for callbacks that must stay referentially stable (so the
  // deck viewer isn't torn down/re-rendered on every timer tick).
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const totalTargetMs = targetMinutes * 60_000;

  const driveViewer = useCallback((page: number) => {
    pdfRef.current?.goToPage(page);
    offlineRef.current?.goToPage(page);
  }, []);

  // ── Timing primitives ─────────────────────────────────────────
  const commitSegment = useCallback(() => {
    if (segmentStartRef.current != null) {
      const idx = currentIndexRef.current;
      accumulatedRef.current[idx] =
        (accumulatedRef.current[idx] ?? 0) +
        (Date.now() - segmentStartRef.current);
      segmentStartRef.current = null;
    }
  }, []);

  const goToSlide = useCallback(
    (targetIdx: number, fromViewer = false) => {
      const clamped = Math.max(0, Math.min(effectiveTotal - 1, targetIdx));
      if (clamped === currentIndexRef.current) return;
      commitSegment();
      currentIndexRef.current = clamped;
      setCurrentIndex(clamped);
      if (!pausedRef.current) segmentStartRef.current = Date.now();
      if (!fromViewer) driveViewer(clamped + 1);
    },
    [commitSegment, driveViewer, effectiveTotal],
  );

  // Native swipe / WebView page change. Only meaningful mid-rehearsal.
  // Reads `mode` from a ref so this callback stays stable across renders.
  const handleViewerPageChanged = useCallback(
    (page: number) => {
      if (modeRef.current !== "rehearsing") return;
      goToSlide(page - 1, true);
    },
    [goToSlide],
  );

  // Fallback slide count from our own viewer (see `effectiveTotal`). Stable so
  // it never re-creates the memoized viewer.
  const handleViewerLoaded = useCallback((pages: number) => {
    setLoadedTotal((prev) => (pages > prev ? pages : prev));
  }, []);

  const startRehearsal = useCallback(() => {
    // Guard: never start before we know how many slides there are.
    if (effectiveTotal < 1) return;
    const targets = computeTargets(totalTargetMs, effectiveTotal, distribution);
    targetsRef.current = targets;
    accumulatedRef.current = new Array(effectiveTotal).fill(0);
    currentIndexRef.current = 0;
    segmentStartRef.current = Date.now();
    pausedRef.current = false;
    setCurrentIndex(0);
    setPaused(false);
    setResults(null);
    setMode("rehearsing");
    // Make sure the deck starts on slide 1.
    requestAnimationFrame(() => driveViewer(1));
  }, [totalTargetMs, effectiveTotal, distribution, driveViewer]);

  const togglePause = useCallback(() => {
    if (pausedRef.current) {
      segmentStartRef.current = Date.now();
      pausedRef.current = false;
      setPaused(false);
    } else {
      commitSegment();
      pausedRef.current = true;
      setPaused(true);
    }
  }, [commitSegment]);

  const endRehearsal = useCallback(() => {
    commitSegment();
    pausedRef.current = true;
    const durations = [...accumulatedRef.current];
    const targets = [...targetsRef.current];
    const total = durations.reduce((a, b) => a + b, 0);
    setResults({ durations, targets, totalTargetMs });
    setMode("results");
    const run: RehearsalRun = {
      totalMs: total,
      targetMs: totalTargetMs,
      slideCount: effectiveTotal,
      completedAt: Date.now(),
    };
    addRun(run);
  }, [commitSegment, totalTargetMs, effectiveTotal, addRun]);

  // ── Timer tick — only while actively running ───────────────────
  useEffect(() => {
    if (mode !== "rehearsing" || paused) return;
    const id = setInterval(() => setTick((x) => x + 1), 200);
    return () => clearInterval(id);
  }, [mode, paused]);

  // Reset to a clean setup whenever the sheet is dismissed.
  useEffect(() => {
    if (!visible) {
      segmentStartRef.current = null;
      pausedRef.current = false;
      setMode("setup");
    }
  }, [visible]);

  // ── Live display values (recomputed each tick) ─────────────────
  const liveSeg =
    segmentStartRef.current != null ? Date.now() - segmentStartRef.current : 0;
  const currentSlideMs =
    (accumulatedRef.current[currentIndex] ?? 0) +
    (mode === "rehearsing" ? liveSeg : 0);
  const totalElapsedMs =
    accumulatedRef.current.reduce((a, b) => a + b, 0) +
    (mode === "rehearsing" ? liveSeg : 0);
  const slideTargetMs = targetsRef.current[currentIndex] ?? 0;
  const ratio = slideTargetMs > 0 ? currentSlideMs / slideTargetMs : 0;

  const slideTimerColor = ratio >= 1 ? RED : ratio >= 0.9 ? AMBER : GREEN;
  const flashState: "none" | "near" | "over" =
    ratio >= 1 ? "over" : ratio >= 0.9 ? "near" : "none";

  // ── Border pulse animation ─────────────────────────────────────
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (mode !== "rehearsing" || flashState === "none" || paused) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, flashState, paused, pulse]);

  // Hardware back closes the rehearsal overlay (replaces Modal.onRequestClose).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // The deck viewer is memoized on stable primitives (kind + uri/html) rather
  // than the parent's freshly-allocated `source` object, so the 5×/sec timer
  // tick re-renders the overlays without ever re-rendering the heavy viewer.
  // `onPageChanged` is referentially stable and reads `mode` via modeRef.
  const sourceKind = source.kind;
  const sourceData = source.kind === "pdf" ? source.pdfUri : source.html;
  const viewer = useMemo(() => {
    if (sourceKind === "pdf") {
      return (
        <PptxPdfViewer
          ref={pdfRef}
          pdfUri={sourceData}
          backgroundColor="#000000"
          horizontal
          onLoadComplete={handleViewerLoaded}
          onPageChanged={handleViewerPageChanged}
          onError={() => {}}
        />
      );
    }
    return (
      <PptxOfflineViewer
        ref={offlineRef}
        html={sourceData}
        onPageChanged={handleViewerPageChanged}
      />
    );
  }, [sourceKind, sourceData, handleViewerPageChanged, handleViewerLoaded]);

  if (!visible) return null;

  return (
    <View style={styles.root}>
      {/* Deck fills the screen behind every overlay */}
      <View style={StyleSheet.absoluteFill}>{viewer}</View>

        {/* Pulsing pacing border */}
        {mode === "rehearsing" && flashState !== "none" && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flashBorder,
              {
                borderColor: flashState === "over" ? RED : AMBER,
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.45, 1],
                }),
              },
            ]}
          />
        )}

        {mode === "setup" && (
          <SetupOverlay
            t={t}
            insets={insets}
            fileName={fileName}
            totalSlides={effectiveTotal}
            targetMinutes={targetMinutes}
            isCustom={isCustom}
            distribution={distribution}
            onPickPreset={(m) => {
              setTargetMinutes(m);
              setIsCustom(false);
            }}
            onPickCustom={() => setIsCustom(true)}
            onAdjustCustom={(delta) =>
              setTargetMinutes((m) => Math.max(1, Math.min(120, m + delta)))
            }
            onDistribution={setDistribution}
            onStart={startRehearsal}
            onClose={onClose}
          />
        )}

        {mode === "rehearsing" && (
          <RehearsingOverlay
            insets={insets}
            slideNumber={currentIndex + 1}
            totalSlides={effectiveTotal}
            currentSlideMs={currentSlideMs}
            totalElapsedMs={totalElapsedMs}
            totalTargetMs={totalTargetMs}
            slideTimerColor={slideTimerColor}
            paused={paused}
            canPrev={currentIndex > 0}
            canNext={currentIndex < effectiveTotal - 1}
            onPrev={() => goToSlide(currentIndex - 1)}
            onNext={() => goToSlide(currentIndex + 1)}
            onTogglePause={togglePause}
            onEnd={endRehearsal}
          />
        )}

        {mode === "results" && results && (
          <ResultsOverlay
            t={t}
            insets={insets}
            results={results}
            history={history}
            onRehearseAgain={startRehearsal}
            onAdjustTarget={() => setMode("setup")}
            onViewSlide={onJumpToSlide}
            onClose={onClose}
          />
        )}
    </View>
  );
}

// ============================================================================
// Screen 1 — Setup bottom sheet
// ============================================================================

interface SetupOverlayProps {
  t: ReturnType<typeof useTheme>["colors"];
  insets: ReturnType<typeof useSafeAreaInsets>;
  fileName: string;
  totalSlides: number;
  targetMinutes: number;
  isCustom: boolean;
  distribution: Distribution;
  onPickPreset: (m: number) => void;
  onPickCustom: () => void;
  onAdjustCustom: (delta: number) => void;
  onDistribution: (d: Distribution) => void;
  onStart: () => void;
  onClose: () => void;
}

function SetupOverlay({
  t,
  insets,
  fileName,
  totalSlides,
  targetMinutes,
  isCustom,
  distribution,
  onPickPreset,
  onPickCustom,
  onAdjustCustom,
  onDistribution,
  onStart,
  onClose,
}: SetupOverlayProps) {
  return (
    <View style={styles.setupRoot}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: t.card, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={styles.grabber} />

        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderText}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>
              Rehearse your deck
            </Text>
            <Text style={[styles.sheetDescription, { color: t.textSecondary }]}>
              Practice against the clock and get a per-slide breakdown of where
              you ran long or rushed — so your delivery lands every time.
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.sheetClose}>
            <MaterialIcons name="close" size={20} color={t.textSecondary} />
          </Pressable>
        </View>

        {/* Slide count · framing line */}
        <View style={styles.sheetMetaRow}>
          <MaterialIcons
            name="slideshow"
            size={15}
            color={brandColors.primary}
          />
          <Text
            style={[styles.sheetMeta, { color: t.textSecondary }]}
            numberOfLines={1}
          >
            {totalSlides > 0
              ? `${totalSlides} slide${totalSlides === 1 ? "" : "s"} · pace it like the real thing`
              : "Preparing slides…"}
          </Text>
        </View>

        {/* Big target readout */}
        <View style={styles.targetReadout}>
          <Text style={[styles.targetValue, { color: brandColors.primary }]}>
            {targetMinutes}
          </Text>
          <Text style={[styles.targetUnit, { color: t.textSecondary }]}>
            min target
          </Text>
        </View>

        {/* Preset drum roll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetRow}
        >
          {PRESETS.map((m) => {
            const active = !isCustom && m === targetMinutes;
            return (
              <Pressable
                key={m}
                onPress={() => onPickPreset(m)}
                style={[
                  styles.presetChip,
                  {
                    backgroundColor: active
                      ? brandColors.primary
                      : t.backgroundSecondary,
                    borderColor: active ? brandColors.primary : t.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    { color: active ? "#FFFFFF" : t.text },
                  ]}
                >
                  {m}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={onPickCustom}
            style={[
              styles.presetChip,
              styles.presetChipWide,
              {
                backgroundColor: isCustom
                  ? brandColors.primary
                  : t.backgroundSecondary,
                borderColor: isCustom ? brandColors.primary : t.border,
              },
            ]}
          >
            <MaterialIcons
              name="tune"
              size={15}
              color={isCustom ? "#FFFFFF" : t.textSecondary}
            />
            <Text
              style={[
                styles.presetChipText,
                { color: isCustom ? "#FFFFFF" : t.text },
              ]}
            >
              Custom
            </Text>
          </Pressable>
        </ScrollView>

        {/* Custom stepper */}
        {isCustom && (
          <View style={[styles.stepperRow, { borderColor: t.border }]}>
            <Pressable
              onPress={() => onAdjustCustom(-1)}
              style={[styles.stepperBtn, { backgroundColor: t.backgroundSecondary }]}
            >
              <MaterialIcons name="remove" size={22} color={t.text} />
            </Pressable>
            <View style={styles.stepperValueWrap}>
              <Text style={[styles.stepperValue, { color: t.text }]}>
                {targetMinutes}
              </Text>
              <Text style={[styles.stepperUnit, { color: t.textSecondary }]}>
                minutes
              </Text>
            </View>
            <Pressable
              onPress={() => onAdjustCustom(1)}
              style={[styles.stepperBtn, { backgroundColor: t.backgroundSecondary }]}
            >
              <MaterialIcons name="add" size={22} color={t.text} />
            </Pressable>
          </View>
        )}

        {/* Distribution */}
        <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>
          TIME DISTRIBUTION
        </Text>
        <View style={styles.distRow}>
          <DistOption
            t={t}
            active={distribution === "even"}
            icon="drag-handle"
            title="Even"
            desc="Every slide gets the same share"
            onPress={() => onDistribution("even")}
          />
          <DistOption
            t={t}
            active={distribution === "weighted"}
            icon="equalizer"
            title="Weighted"
            desc="Title & closing get less time"
            onPress={() => onDistribution("weighted")}
          />
        </View>

        {/* Start — disabled until the slide count is known. */}
        <Pressable
          onPress={onStart}
          disabled={totalSlides < 1}
          style={[styles.startBtn, totalSlides < 1 && styles.startBtnDisabled]}
        >
          <GradientView
            colors={[
              brandColors.gradientStart,
              brandColors.gradientMid,
              brandColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.startBtnInner}
          >
            <MaterialIcons name="play-arrow" size={22} color="#FFFFFF" />
            <Text style={styles.startBtnText}>
              {totalSlides < 1 ? "Preparing…" : "Start Rehearsal"}
            </Text>
          </GradientView>
        </Pressable>
      </View>
    </View>
  );
}

interface DistOptionProps {
  t: ReturnType<typeof useTheme>["colors"];
  active: boolean;
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  desc: string;
  onPress: () => void;
}

function DistOption({ t, active, icon, title, desc, onPress }: DistOptionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.distOption,
        {
          backgroundColor: active
            ? brandColors.primary + "14"
            : t.backgroundSecondary,
          borderColor: active ? brandColors.primary : t.border,
        },
      ]}
    >
      <MaterialIcons
        name={icon}
        size={20}
        color={active ? brandColors.primary : t.textSecondary}
      />
      <Text
        style={[
          styles.distTitle,
          { color: active ? brandColors.primary : t.text },
        ]}
      >
        {title}
      </Text>
      <Text style={[styles.distDesc, { color: t.textSecondary }]}>{desc}</Text>
    </Pressable>
  );
}

// ============================================================================
// Screen 2 — Rehearsing overlay (floating chrome on the live deck)
// ============================================================================

interface RehearsingOverlayProps {
  insets: ReturnType<typeof useSafeAreaInsets>;
  slideNumber: number;
  totalSlides: number;
  currentSlideMs: number;
  totalElapsedMs: number;
  totalTargetMs: number;
  slideTimerColor: string;
  paused: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onEnd: () => void;
}

function RehearsingOverlay({
  insets,
  slideNumber,
  totalSlides,
  currentSlideMs,
  totalElapsedMs,
  totalTargetMs,
  slideTimerColor,
  paused,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onTogglePause,
  onEnd,
}: RehearsingOverlayProps) {
  const progress = totalTargetMs > 0 ? totalElapsedMs / totalTargetMs : 0;
  const over = totalElapsedMs > totalTargetMs;

  return (
    <>
      {/* Top floating bar */}
      <View
        style={[styles.topBar, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={styles.topBarInner}>
          <View style={styles.topRow}>
            <Text style={styles.topSlideLabel}>
              Slide {slideNumber}/{totalSlides}
            </Text>
            <View style={styles.topTimers}>
              <Text style={[styles.topCurrent, { color: slideTimerColor }]}>
                {fmt(currentSlideMs)}
              </Text>
              <View style={styles.topDivider} />
              <Text style={styles.topTotal}>
                {fmt(totalElapsedMs)} / {fmt(totalTargetMs)}
              </Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                  backgroundColor: over ? RED : "#FFFFFF",
                },
              ]}
            />
          </View>
          {paused && (
            <View style={styles.pausedPill}>
              <MaterialIcons name="pause" size={13} color="#FFFFFF" />
              <Text style={styles.pausedText}>Paused</Text>
            </View>
          )}
        </View>
      </View>

      {/* Bottom floating controls */}
      <View
        style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        <View style={styles.controlPill}>
          <CtrlBtn
            icon="chevron-left"
            label="Prev"
            dim={!canPrev}
            onPress={onPrev}
          />
          <CtrlBtn
            icon={paused ? "play-arrow" : "pause"}
            label={paused ? "Resume" : "Pause"}
            onPress={onTogglePause}
          />
          <CtrlBtn
            icon="chevron-right"
            label="Next"
            dim={!canNext}
            onPress={onNext}
          />
          <View style={styles.ctrlDivider} />
          <CtrlBtn icon="stop" label="End" tint={RED} onPress={onEnd} />
        </View>
      </View>
    </>
  );
}

interface CtrlBtnProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  dim?: boolean;
  tint?: string;
}

function CtrlBtn({ icon, label, onPress, dim, tint }: CtrlBtnProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.ctrlBtn, dim && styles.ctrlDim]}
    >
      <MaterialIcons name={icon} size={26} color={tint ?? "#FFFFFF"} />
      <Text style={[styles.ctrlLabel, tint ? { color: tint } : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ============================================================================
// Screen 3 — Results
// ============================================================================

interface ResultsOverlayProps {
  t: ReturnType<typeof useTheme>["colors"];
  insets: ReturnType<typeof useSafeAreaInsets>;
  results: { durations: number[]; targets: number[]; totalTargetMs: number };
  history: RehearsalRun[];
  onRehearseAgain: () => void;
  onAdjustTarget: () => void;
  onViewSlide: (page: number) => void;
  onClose: () => void;
}

function ResultsOverlay({
  t,
  insets,
  results,
  history,
  onRehearseAgain,
  onAdjustTarget,
  onViewSlide,
  onClose,
}: ResultsOverlayProps) {
  const { durations, targets, totalTargetMs } = results;
  const n = durations.length;
  const totalDuration = durations.reduce((a, b) => a + b, 0);
  const diff = totalDuration - totalTargetMs;
  const diffLabel =
    diff > 1000
      ? `+${fmt(diff)} over`
      : diff < -1000
        ? `-${fmt(-diff)} under`
        : "on target";
  const diffColor = diff > 1000 ? RED : diff < -1000 ? AMBER : GREEN;

  const callouts = useMemo(
    () => buildCallouts(durations, targets),
    [durations, targets],
  );

  // Shared scale so bars are comparable; cap runaway overruns.
  const maxRatio = durations.reduce((mx, d, i) => {
    const tg = targets[i] ?? 0;
    return tg > 0 ? Math.max(mx, d / tg) : mx;
  }, 1);
  const scale = Math.min(2.5, Math.max(1.25, maxRatio));
  const targetFrac = 1 / scale;

  // History trend (history is most-recent-first; recent[] is oldest→newest).
  const recent = history.slice(0, 3).reverse();
  const improving =
    history.length >= 2
      ? Math.abs(history[0].totalMs - history[0].targetMs) <
        Math.abs(history[1].totalMs - history[1].targetMs)
      : null;

  return (
    <View style={[styles.resultsRoot, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.resultsHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.resultsKicker, { color: brandColors.primary }]}>
              REHEARSAL COMPLETE
            </Text>
            <Text style={[styles.resultsTotal, { color: t.text }]}>
              {fmt(totalDuration)}
            </Text>
            <Text style={[styles.resultsMeta, { color: t.textSecondary }]}>
              target {fmt(totalTargetMs)} ·{" "}
              <Text style={{ color: diffColor, fontWeight: "700" }}>
                {diffLabel}
              </Text>
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.resultsClose}>
            <MaterialIcons name="close" size={22} color={t.textSecondary} />
          </Pressable>
        </View>

        {/* History pill */}
        {recent.length >= 2 && (
          <View
            style={[
              styles.historyPill,
              { backgroundColor: t.backgroundSecondary, borderColor: t.border },
            ]}
          >
            <MaterialIcons
              name={improving ? "trending-up" : "trending-down"}
              size={16}
              color={improving ? GREEN : AMBER}
            />
            <Text style={[styles.historyLabel, { color: t.textSecondary }]}>
              {recent.map((r) => fmt(r.totalMs)).join("  →  ")}
            </Text>
            {improving != null && (
              <Text
                style={[
                  styles.historyTag,
                  { color: improving ? GREEN : AMBER },
                ]}
              >
                {improving ? "improving" : "slipping"}
              </Text>
            )}
          </View>
        )}

        {/* Per-slide breakdown */}
        <Text style={[styles.breakdownTitle, { color: t.text }]}>
          Per-slide breakdown
        </Text>
        <View style={styles.breakdownList}>
          {durations.map((d, i) => {
            const tg = targets[i] ?? 0;
            const isEdge = i === 0 || i === n - 1;
            const st = statusFor(d, tg, isEdge);
            const r = tg > 0 ? d / tg : 0;
            const fillFrac = Math.min(r, scale) / scale;
            const barColor =
              st === "over" ? RED : st === "rushed" ? AMBER : GREEN;
            const iconName =
              st === "over" ? "close" : st === "rushed" ? "warning" : "check";
            const suffix =
              st === "over"
                ? `+${Math.round((d - tg) / 1000)}s`
                : st === "rushed"
                  ? "rushed"
                  : "";
            return (
              <Pressable
                key={i}
                onPress={() => onViewSlide(i + 1)}
                style={[styles.slideRow, { borderColor: t.borderLight }]}
              >
                <View style={[styles.slideIndex, { backgroundColor: barColor }]}>
                  <Text style={styles.slideIndexText}>{i + 1}</Text>
                </View>
                <View style={styles.slideBody}>
                  <View style={styles.slideTopRow}>
                    <Text style={[styles.slideName, { color: t.text }]}>
                      Slide {i + 1}
                    </Text>
                    <Text style={[styles.slideTime, { color: t.textSecondary }]}>
                      {fmt(d)} / {fmt(tg)}
                    </Text>
                  </View>
                  <View
                    style={[styles.barTrack, { backgroundColor: t.border }]}
                  >
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${fillFrac * 100}%`,
                          backgroundColor: barColor,
                        },
                      ]}
                    />
                    {/* Grey target marker */}
                    <View
                      style={[
                        styles.targetMarker,
                        {
                          left: `${targetFrac * 100}%`,
                          backgroundColor: t.textTertiary,
                        },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.slideStatus}>
                  <MaterialIcons name={iconName} size={18} color={barColor} />
                  {suffix ? (
                    <Text style={[styles.slideSuffix, { color: barColor }]}>
                      {suffix}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Smart callouts */}
        <View style={styles.calloutList}>
          {callouts.map((c, i) => {
            const color =
              c.kind === "over" ? RED : c.kind === "rushed" ? AMBER : GREEN;
            const icon =
              c.kind === "over"
                ? "trending-up"
                : c.kind === "rushed"
                  ? "fast-forward"
                  : "verified";
            return (
              <View
                key={i}
                style={[
                  styles.callout,
                  { backgroundColor: t.card, borderColor: t.borderLight },
                ]}
              >
                <View
                  style={[styles.calloutIcon, { backgroundColor: color + "1A" }]}
                >
                  <MaterialIcons name={icon} size={18} color={color} />
                </View>
                <Text style={[styles.calloutText, { color: t.text }]}>
                  {c.text}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Sticky actions */}
      <View
        style={[
          styles.resultsActions,
          {
            paddingBottom: insets.bottom + 14,
            backgroundColor: t.background,
            borderTopColor: t.borderLight,
          },
        ]}
      >
        <Pressable
          onPress={onAdjustTarget}
          style={[styles.secondaryBtn, { borderColor: t.border }]}
        >
          <MaterialIcons name="tune" size={18} color={t.text} />
          <Text style={[styles.secondaryBtnText, { color: t.text }]}>
            Adjust target
          </Text>
        </Pressable>
        <Pressable onPress={onRehearseAgain} style={styles.primaryBtn}>
          <GradientView
            colors={[
              brandColors.gradientStart,
              brandColors.gradientMid,
              brandColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.primaryBtnInner}
          >
            <MaterialIcons name="replay" size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Rehearse again</Text>
          </GradientView>
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================

const styles = StyleSheet.create({
  // Full-screen overlay (sibling of the viewer's SafeAreaView, not a Modal —
  // keeps the native deck viewer in the main window).
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 50,
    elevation: 50,
  },
  flashBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 6,
  },

  // ── Setup ────────────────────────────────────────────────────
  setupRoot: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(128,128,128,0.4)",
    marginBottom: 12,
  },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start" },
  sheetHeaderText: { flex: 1, paddingRight: 8 },
  sheetTitle: { fontSize: 23, fontWeight: "800", letterSpacing: -0.3 },
  sheetDescription: { fontSize: 13.5, lineHeight: 19, marginTop: 7 },
  sheetMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  sheetMeta: { flex: 1, fontSize: 12.5, fontWeight: "600" },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  targetReadout: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginTop: 22,
    marginBottom: 18,
    gap: 8,
  },
  targetValue: { fontSize: 56, fontWeight: "900", letterSpacing: -1 },
  targetUnit: { fontSize: 15, fontWeight: "600" },

  presetRow: { gap: 10, paddingVertical: 2, paddingRight: 4 },
  presetChip: {
    minWidth: 52,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  presetChipWide: { flexDirection: "row", gap: 6, paddingHorizontal: 16 },
  presetChipText: { fontSize: 17, fontWeight: "700" },

  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValueWrap: { alignItems: "center" },
  stepperValue: { fontSize: 28, fontWeight: "800" },
  stepperUnit: { fontSize: 12, marginTop: -2 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 10,
  },
  distRow: { flexDirection: "row", gap: 10 },
  distOption: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    gap: 4,
  },
  distTitle: { fontSize: 15, fontWeight: "700", marginTop: 4 },
  distDesc: { fontSize: 11.5, lineHeight: 15 },

  startBtn: { marginTop: 20, borderRadius: 16, overflow: "hidden" },
  startBtnDisabled: { opacity: 0.5 },
  startBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  startBtnText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },

  // ── Rehearsing ───────────────────────────────────────────────
  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topBarInner: {
    marginHorizontal: 12,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topSlideLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  topTimers: { flexDirection: "row", alignItems: "center", gap: 8 },
  topCurrent: {
    fontSize: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  topDivider: {
    width: 1,
    height: 16,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  topTotal: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2 },
  pausedPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 4,
    marginTop: 8,
  },
  pausedText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  controlPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 28,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  ctrlBtn: {
    width: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 2,
  },
  ctrlDim: { opacity: 0.35 },
  ctrlLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
  ctrlDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginHorizontal: 2,
  },

  // ── Results ──────────────────────────────────────────────────
  resultsRoot: { ...StyleSheet.absoluteFillObject },
  resultsHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
  },
  resultsKicker: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  resultsTotal: {
    fontSize: 46,
    fontWeight: "900",
    letterSpacing: -1.5,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  resultsMeta: { fontSize: 14, marginTop: 2 },
  resultsClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  historyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  historyLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  historyTag: { fontSize: 12, fontWeight: "700" },

  breakdownTitle: {
    fontSize: 17,
    fontWeight: "800",
    marginHorizontal: 20,
    marginTop: 26,
    marginBottom: 6,
  },
  breakdownList: { paddingHorizontal: 14 },
  slideRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  slideIndex: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  slideIndexText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  slideBody: { flex: 1, gap: 6 },
  slideTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  slideName: { fontSize: 14, fontWeight: "600" },
  slideTime: {
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    justifyContent: "center",
  },
  barFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
  targetMarker: {
    position: "absolute",
    top: -2,
    bottom: -2,
    width: 2,
    borderRadius: 1,
  },
  slideStatus: { width: 44, alignItems: "center", gap: 1 },
  slideSuffix: {
    fontSize: 10.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  calloutList: { paddingHorizontal: 20, marginTop: 20, gap: 10 },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  calloutIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  calloutText: { flex: 1, fontSize: 13.5, lineHeight: 19 },

  resultsActions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" },
  primaryBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  primaryBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
