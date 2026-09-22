/**
 * ReadAloudBar.tsx
 * Floating playback control bar for the Read-Aloud feature.
 *
 * Design:
 *  - Slides up from the bottom with a spring animation
 *  - Progress bar, chunk counter, speed presets
 *  - Play/Pause, Page Skip, 10 s Skip, Stop controls
 *  - Two mutually exclusive sheets — Playback (speed + pitch) and Sleep — so
 *    the dense control row never grows another button row
 *  - Toast overlay for skip feedback
 *  - Themed to match the app's primary color (Home header accent)
 *
 * Deliberately icon-library-free: every glyph below is composed from Views so
 * the bar drops into any viewer without pulling in a font dependency.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import type { ReadAloudControls } from "@/hooks/useReadAloud";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * One-tap speeds, weighted toward the slow end: synthetic voices tend to read
 * quickly, and a reader who finds 1× rushed needs somewhere to go that is less
 * than a quarter-step away. Everything in between is on the stepper.
 */
const SPEED_PRESETS = [0.75, 0.9, 1.0, 1.25, 1.5] as const;

/** Stepper increment for fine speed adjustment. */
const SPEED_STEP = 0.05;
const MIN_RATE = 0.5;
const MAX_RATE = 2.0;

/** 1 → "1", 0.95 → "0.95", 1.1 → "1.1" — no float noise, no trailing zeros. */
function formatRate(rate: number): string {
  return String(Number(rate.toFixed(2)));
}

/**
 * Pitch is a set-once preference rather than a live control, so three clearly
 * distinct steps beat a fiddly slider inside a floating bar. Values sit well
 * inside the engine-supported 0.5 – 2.0 range.
 */
const PITCH_PRESETS = [
  { value: 0.75, label: "Low" },
  { value: 1.0, label: "Normal" },
  { value: 1.25, label: "High" },
] as const;

/** Sleep-timer countdown presets, in minutes. */
const SLEEP_PRESETS = [15, 30, 45, 60] as const;

/**
 * Extra silence between paragraphs. Off by default.
 *
 * Added *on top of* the gap the engine already leaves at every utterance
 * boundary, so the steps are small — the earlier 0.3–1 s presets roughly
 * doubled that gap and read as dead air.
 */
const PAUSE_PRESETS = [
  { value: 0, label: "Off" },
  { value: 150, label: "Short" },
  { value: 350, label: "Medium" },
  { value: 700, label: "Long" },
] as const;

const TOAST_DURATION_MS = 2500;

// ---------------------------------------------------------------------------
// Theme type — accent derived from app primary (home header) color
// ---------------------------------------------------------------------------

interface BarTheme {
  surface: string;
  text: string;
  textSecondary: string;
  accent: string;
  trackBg: string;
  chipBg: string;
  chipActiveBg: string;
  chipText: string;
  chipActiveText: string;
  iconColor: string;
}

function buildBarTheme(
  colorScheme: "dark" | "light",
  accentOverride?: string,
): BarTheme {
  // Accent always matches the Home screen header gradient start color
  const accent = accentOverride ?? "#4F46E5";

  if (colorScheme === "dark") {
    return {
      surface: "#1C1C1E",
      text: "#EFEFEF",
      textSecondary: "#888",
      accent,
      trackBg: "#333",
      chipBg: "#2C2C2E",
      chipActiveBg: accent,
      chipText: "#888",
      chipActiveText: "#fff",
      iconColor: "#fff",
    };
  }
  return {
    surface: "#FFFFFF",
    text: "#0F172A",
    textSecondary: "#64748B",
    accent,
    trackBg: "#E5E7EB",
    chipBg: "#F3F4F6",
    chipActiveBg: accent,
    chipText: "#64748B",
    chipActiveText: "#fff",
    iconColor: "#fff",
  };
}

// ---------------------------------------------------------------------------
// Inline icon components (no external icon library dependency)
// ---------------------------------------------------------------------------

const IconPlay = ({ color }: { color: string }) => (
  <View
    style={{
      width: 0,
      height: 0,
      borderTopWidth: 9,
      borderBottomWidth: 9,
      borderLeftWidth: 16,
      borderTopColor: "transparent",
      borderBottomColor: "transparent",
      borderLeftColor: color,
      marginLeft: 3,
    }}
  />
);

const IconPause = ({ color }: { color: string }) => (
  <View style={{ flexDirection: "row" }}>
    <View
      style={{
        width: 4,
        height: 18,
        backgroundColor: color,
        borderRadius: 2,
      }}
    />
    <View
      style={{
        width: 4,
        height: 18,
        backgroundColor: color,
        borderRadius: 2,
        marginLeft: 4,
      }}
    />
  </View>
);

const IconStop = ({ color }: { color: string }) => (
  <View
    style={{
      width: 16,
      height: 16,
      backgroundColor: color,
      borderRadius: 2,
    }}
  />
);

/** Page skip backward (bar + triangle pointing left) */
const IconPageBack = ({ color }: { color: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center" }}>
    <View
      style={{
        width: 3,
        height: 16,
        backgroundColor: color,
        borderRadius: 1,
      }}
    />
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: 8,
        borderBottomWidth: 8,
        borderRightWidth: 14,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderRightColor: color,
        marginLeft: 2,
      }}
    />
  </View>
);

/** Page skip forward (triangle pointing right + bar) */
const IconPageForward = ({ color }: { color: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center" }}>
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: 8,
        borderBottomWidth: 8,
        borderLeftWidth: 14,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: color,
        marginLeft: 2,
      }}
    />
    <View
      style={{
        width: 3,
        height: 16,
        backgroundColor: color,
        borderRadius: 1,
        marginLeft: 2,
      }}
    />
  </View>
);

/** 10 s backward icon — "−10" text label (compact) */
const Icon10sBack = ({ color }: { color: string }) => (
  <Text style={{ color, fontSize: 11, fontWeight: "700" }}>−10s</Text>
);

/** 10 s forward icon — "+10" text label (compact) */
const Icon10sForward = ({ color }: { color: string }) => (
  <Text style={{ color, fontSize: 11, fontWeight: "700" }}>+10s</Text>
);

/**
 * Sleep timer — a clock dial with a single hand.
 *
 * Drawn as a ring plus a bar rather than the more obvious crescent moon: a
 * crescent needs a cut-out filled with the surface colour behind it, which
 * breaks the moment the chip's own background changes when the timer is armed.
 */
const IconTimer = ({ color }: { color: string }) => (
  <View style={styles.timerIcon}>
    <View style={[styles.timerDial, { borderColor: color }]} />
    <View style={[styles.timerHand, { backgroundColor: color }]} />
  </View>
);

// ---------------------------------------------------------------------------
// Chip — shared pill used by every sheet row
// ---------------------------------------------------------------------------

const Chip: React.FC<{
  label: string;
  active: boolean;
  theme: BarTheme;
  onPress: () => void;
  /** Share the row width evenly instead of hugging the label. */
  grow?: boolean;
}> = ({ label, active, theme, onPress, grow }) => (
  <Pressable
    onPress={onPress}
    style={[
      styles.chip,
      grow && styles.chipGrow,
      { backgroundColor: active ? theme.chipActiveBg : theme.chipBg },
    ]}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
  >
    <Text
      style={[
        styles.chipText,
        { color: active ? theme.chipActiveText : theme.chipText },
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

// ---------------------------------------------------------------------------
// Toast component
// ---------------------------------------------------------------------------

const Toast: React.FC<{ message: string | null }> = ({ message }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message) {
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(TOAST_DURATION_MS - 400),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      opacity.setValue(0);
    }
  }, [message, opacity]);

  if (!message) return null;

  return (
    <Animated.View style={[toastStyles.container, { opacity }]}>
      <View style={toastStyles.pill}>
        <Text style={toastStyles.text}>{message}</Text>
      </View>
    </Animated.View>
  );
};

const toastStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: -52,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 110,
  },
  pill: {
    backgroundColor: "rgba(0,0,0,0.78)",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
});

// ---------------------------------------------------------------------------
// ReadAloudBar
// ---------------------------------------------------------------------------

export interface ReadAloudBarProps extends ReadAloudControls {
  /** Whether the bar is visible. Animated in/out. */
  visible?: boolean;
  /** "dark" or "light" — matches the viewer's colorScheme */
  colorScheme?: "dark" | "light";
  /** Override accent color (pass the app's primary / home header color). */
  accentColor?: string;
  /** Additional container style */
  containerStyle?: ViewStyle;
  /** Callback when the voice button is pressed. Opens the voice picker. */
  onVoicePress?: () => void;
  /** Callback when the pronunciation button is pressed. */
  onPronunciationPress?: () => void;
  /**
   * What a `pageIndex` step means for this document, used to label the
   * "end of section" sleep option. EPUB reuses pageIndex as a chapter index,
   * so the EPUB viewers pass "chapter"; everything else is paginated.
   */
  sectionLabel?: "page" | "chapter";
}

export const ReadAloudBar: React.FC<ReadAloudBarProps> = ({
  visible = true,
  colorScheme = "dark",
  accentColor,
  status,
  currentChunkIndex,
  currentPageIndex,
  totalChunks,
  totalPages,
  rate,
  play,
  pause,
  stop,
  skipPageBack,
  skipPageForward,
  skipBack10s,
  skipForward10s,
  setRate,
  pitch,
  setPitch,
  paragraphPauseMs,
  setParagraphPauseMs,
  sleepTimerMinutesLeft,
  setSleepTimer,
  sleepAtSectionEnd,
  setSleepAtSectionEnd,
  containerStyle,
  onVoicePress,
  onPronunciationPress,
  sectionLabel = "page",
}) => {
  const t = buildBarTheme(colorScheme, accentColor);

  // ---------------------------------------------------------------------------
  // Slide animation
  // ---------------------------------------------------------------------------
  const slideY = useRef(new Animated.Value(140)).current;

  useEffect(() => {
    Animated.spring(slideY, {
      toValue: visible ? 0 : 140,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
  }, [visible, slideY]);

  // ---------------------------------------------------------------------------
  // Sheets — at most one open at a time so the bar never grows two panels tall
  // ---------------------------------------------------------------------------
  const [openSheet, setOpenSheet] = useState<"none" | "playback" | "sleep">(
    "none",
  );

  const toggleSheet = useCallback((sheet: "playback" | "sleep") => {
    setOpenSheet((current) => (current === sheet ? "none" : sheet));
  }, []);

  const handleSpeedSelect = useCallback(
    (preset: number) => {
      setRate(preset);
    },
    [setRate],
  );

  const handleSpeedStep = useCallback(
    (delta: number) => {
      // Round to hundredths so repeated steps never accumulate float error
      // (0.95 − 0.05 would otherwise land on 0.8999999…).
      const next = Math.min(
        MAX_RATE,
        Math.max(MIN_RATE, Math.round((rate + delta) * 100) / 100),
      );
      setRate(next);
    },
    [rate, setRate],
  );

  const handlePitchSelect = useCallback(
    (value: number) => {
      setPitch(value);
    },
    [setPitch],
  );

  // ---------------------------------------------------------------------------
  // Toast state
  // ---------------------------------------------------------------------------
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), TOAST_DURATION_MS);
  }, []);

  // Cleanup toast timer
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Skip handlers with toast
  // ---------------------------------------------------------------------------
  const handlePageForward = useCallback(() => {
    const result = skipPageForward();
    showToast(result.message);
  }, [skipPageForward, showToast]);

  const handlePageBack = useCallback(() => {
    const result = skipPageBack();
    showToast(result.message);
  }, [skipPageBack, showToast]);

  // ---------------------------------------------------------------------------
  // Sleep timer
  // ---------------------------------------------------------------------------

  /**
   * The preset the user picked. `sleepTimerMinutesLeft` counts down, so it
   * stops matching the chosen preset after the first minute — this keeps the
   * right chip highlighted for the whole countdown.
   */
  const [armedPreset, setArmedPreset] = useState<number | null>(null);

  /** Distinguishes "user cancelled" from "timer reached zero" for the toast. */
  const cancelledByUser = useRef(false);

  useEffect(() => {
    if (sleepTimerMinutesLeft !== null) return;
    setArmedPreset(null);
    if (cancelledByUser.current) {
      cancelledByUser.current = false;
      return;
    }
    // Fell to zero on its own — playback has just been paused for us.
    if (armedPreset !== null) showToast("Sleep timer ended — paused");
  }, [sleepTimerMinutesLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSleepPreset = useCallback(
    (minutes: number) => {
      // One sleep condition at a time: arming a countdown clears "end of
      // section", and vice versa.
      setSleepAtSectionEnd(false);
      setSleepTimer(minutes);
      setArmedPreset(minutes);
      setOpenSheet("none");
      showToast(`Pausing in ${minutes} minutes`);
    },
    [setSleepTimer, setSleepAtSectionEnd, showToast],
  );

  const handleSleepAtSectionEnd = useCallback(() => {
    cancelledByUser.current = true;
    setSleepTimer(null);
    setArmedPreset(null);
    setSleepAtSectionEnd(true);
    setOpenSheet("none");
    showToast(`Pausing at the end of this ${sectionLabel}`);
  }, [setSleepTimer, setSleepAtSectionEnd, showToast, sectionLabel]);

  const handleSleepOff = useCallback(() => {
    cancelledByUser.current = true;
    setSleepTimer(null);
    setArmedPreset(null);
    setSleepAtSectionEnd(false);
    setOpenSheet("none");
  }, [setSleepTimer, setSleepAtSectionEnd]);

  const sleepArmed = sleepTimerMinutesLeft !== null || sleepAtSectionEnd;

  const sleepChipLabel = sleepAtSectionEnd
    ? sectionLabel === "chapter"
      ? "Chapter"
      : "Page"
    : sleepTimerMinutesLeft !== null
      ? `${sleepTimerMinutesLeft}m`
      : "Sleep";

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------
  const progress = totalChunks > 0 ? (currentChunkIndex + 1) / totalChunks : 0;
  const isPlaying = status === "speaking";
  const isIdle = status === "idle" || status === "finished";

  // Page info label
  const pageLabel =
    totalPages > 1
      ? `Page ${currentPageIndex + 1}/${totalPages}  ·  ${currentChunkIndex + 1}/${totalChunks}`
      : totalChunks > 0
        ? `${currentChunkIndex + 1} / ${totalChunks}`
        : "No text available";

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: t.surface,
          transform: [{ translateY: slideY }],
          shadowColor: colorScheme === "dark" ? "#000" : "#64748B",
        },
        containerStyle,
      ]}
      pointerEvents={visible ? "auto" : "none"}
    >
      {/* Toast (positioned above bar) */}
      <Toast message={toastMsg} />

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: t.trackBg }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${progress * 100}%`, backgroundColor: t.accent },
          ]}
        />
      </View>

      {/* Chunk / page counter */}
      <Text style={[styles.counter, { color: t.textSecondary }]}>
        {pageLabel}
      </Text>

      {/* ── Playback sheet — speed + pitch ─────────────────────── */}
      {openSheet === "playback" && (
        <View style={[styles.sheet, { borderTopColor: t.trackBg }]}>
          <Text style={[styles.sheetLabel, { color: t.textSecondary }]}>
            Speed
          </Text>
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => handleSpeedStep(-SPEED_STEP)}
              disabled={rate <= MIN_RATE + 0.001}
              style={[
                styles.stepperBtn,
                { backgroundColor: t.chipBg },
                rate <= MIN_RATE + 0.001 && styles.controlBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Read slower"
            >
              <Text style={[styles.stepperGlyph, { color: t.text }]}>−</Text>
            </Pressable>
            <Text
              style={[styles.stepperValue, { color: t.text }]}
              accessibilityLabel={`Speed ${formatRate(rate)} times`}
            >
              {formatRate(rate)}×
            </Text>
            <Pressable
              onPress={() => handleSpeedStep(SPEED_STEP)}
              disabled={rate >= MAX_RATE - 0.001}
              style={[
                styles.stepperBtn,
                { backgroundColor: t.chipBg },
                rate >= MAX_RATE - 0.001 && styles.controlBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Read faster"
            >
              <Text style={[styles.stepperGlyph, { color: t.text }]}>+</Text>
            </Pressable>
          </View>
          <View style={styles.chipRow}>
            {SPEED_PRESETS.map((preset) => (
              <Chip
                key={preset}
                theme={t}
                label={`${formatRate(preset)}×`}
                active={Math.abs(rate - preset) < 0.001}
                onPress={() => handleSpeedSelect(preset)}
              />
            ))}
          </View>

          <Text style={[styles.sheetLabel, { color: t.textSecondary }]}>
            Pitch
          </Text>
          <View style={styles.chipRow}>
            {PITCH_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                theme={t}
                grow
                label={preset.label}
                active={Math.abs(pitch - preset.value) < 0.01}
                onPress={() => handlePitchSelect(preset.value)}
              />
            ))}
          </View>
          <Text style={[styles.sheetHint, { color: t.textSecondary }]}>
            Pitch applies from the next sentence.
          </Text>

          <Text style={[styles.sheetLabel, { color: t.textSecondary }]}>
            Pause between paragraphs
          </Text>
          <View style={styles.chipRow}>
            {PAUSE_PRESETS.map((preset) => (
              <Chip
                key={preset.value}
                theme={t}
                label={preset.label}
                active={paragraphPauseMs === preset.value}
                onPress={() => setParagraphPauseMs(preset.value)}
              />
            ))}
          </View>

          {(onVoicePress || onPronunciationPress) && (
            <>
              <Text style={[styles.sheetLabel, { color: t.textSecondary }]}>
                Voice
              </Text>
              <View style={styles.chipRow}>
                {onVoicePress && (
                  <Chip
                    theme={t}
                    grow
                    label="Change voice"
                    active={false}
                    onPress={() => {
                      setOpenSheet("none");
                      onVoicePress();
                    }}
                  />
                )}
                {onPronunciationPress && (
                  <Chip
                    theme={t}
                    grow
                    label="Pronunciation"
                    active={false}
                    onPress={() => {
                      setOpenSheet("none");
                      onPronunciationPress();
                    }}
                  />
                )}
              </View>
            </>
          )}
        </View>
      )}

      {/* ── Sleep sheet ────────────────────────────────────────── */}
      {openSheet === "sleep" && (
        <View style={[styles.sheet, { borderTopColor: t.trackBg }]}>
          <Text style={[styles.sheetLabel, { color: t.textSecondary }]}>
            Pause playback after
          </Text>
          <View style={styles.chipRow}>
            {SLEEP_PRESETS.map((minutes) => (
              <Chip
                key={minutes}
                theme={t}
                label={`${minutes}m`}
                active={armedPreset === minutes}
                onPress={() => handleSleepPreset(minutes)}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            <Chip
              theme={t}
              grow
              label={`End of ${sectionLabel}`}
              active={sleepAtSectionEnd}
              onPress={handleSleepAtSectionEnd}
            />
            <Chip
              theme={t}
              grow
              label="Off"
              active={!sleepArmed}
              onPress={handleSleepOff}
            />
          </View>
        </View>
      )}

      {/* ── Utility row — page skip + sleep timer ───────────────── */}
      <View style={styles.pageSkipRow}>
        {totalPages >= 1 ? (
          <Pressable
            onPress={handlePageBack}
            style={styles.pageSkipBtn}
            accessibilityLabel="Previous page"
          >
            <IconPageBack color={t.text} />
            <Text style={[styles.pageSkipLabel, { color: t.textSecondary }]}>
              Prev page
            </Text>
          </Pressable>
        ) : (
          <View style={styles.utilitySpacer} />
        )}

        <Pressable
          onPress={() => toggleSheet("sleep")}
          style={[
            styles.sleepChip,
            {
              backgroundColor: sleepArmed ? t.accent : "transparent",
              borderColor: sleepArmed ? t.accent : t.trackBg,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ expanded: openSheet === "sleep" }}
          accessibilityLabel={
            sleepArmed
              ? `Sleep timer armed: ${sleepChipLabel}. Change or cancel.`
              : "Set a sleep timer"
          }
        >
          <IconTimer color={sleepArmed ? t.chipActiveText : t.textSecondary} />
          <Text
            style={[
              styles.sleepChipText,
              { color: sleepArmed ? t.chipActiveText : t.textSecondary },
            ]}
          >
            {sleepChipLabel}
          </Text>
        </Pressable>

        {totalPages >= 1 ? (
          <Pressable
            onPress={handlePageForward}
            style={styles.pageSkipBtn}
            accessibilityLabel="Next page"
          >
            <Text style={[styles.pageSkipLabel, { color: t.textSecondary }]}>
              Next page
            </Text>
            <IconPageForward color={t.text} />
          </Pressable>
        ) : (
          <View style={styles.utilitySpacer} />
        )}
      </View>

      {/* ── Main controls row ──────────────────────────────────── */}
      <View style={styles.controls}>
        {/* Playback sheet toggle */}
        <Pressable
          onPress={() => toggleSheet("playback")}
          style={[styles.speedButton, { borderColor: t.accent }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: openSheet === "playback" }}
          accessibilityLabel="Change playback speed and pitch"
        >
          <Text style={[styles.speedLabel, { color: t.accent }]}>
            {formatRate(rate)}×
          </Text>
        </Pressable>

        {/* −10 s */}
        <Pressable
          onPress={skipBack10s}
          style={styles.controlBtn}
          accessibilityLabel="Skip back 10 seconds"
        >
          <Icon10sBack color={t.text} />
        </Pressable>

        {/* Play / Pause */}
        <Pressable
          onPress={isPlaying ? pause : () => play()}
          style={[styles.playBtn, { backgroundColor: t.accent }]}
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <IconPause color={t.iconColor} />
          ) : (
            <IconPlay color={t.iconColor} />
          )}
        </Pressable>

        {/* +10 s */}
        <Pressable
          onPress={skipForward10s}
          style={styles.controlBtn}
          accessibilityLabel="Skip forward 10 seconds"
        >
          <Icon10sForward color={t.text} />
        </Pressable>

        {/* Stop */}
        <Pressable
          onPress={stop}
          style={[styles.controlBtn, isIdle && styles.controlBtnDisabled]}
          disabled={isIdle}
          accessibilityLabel="Stop reading"
        >
          <IconStop color={t.text} />
        </Pressable>
      </View>
    </Animated.View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 12,
    zIndex: 100,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginBottom: 10,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  counter: {
    fontSize: 11,
    textAlign: "center",
    marginBottom: 6,
  },
  pageSkipRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  /** Holds the row's outer slots open when page skipping isn't available. */
  utilitySpacer: {
    width: 76,
  },
  pageSkipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  pageSkipLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  controlBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  controlBtnDisabled: {
    opacity: 0.3,
  },
  speedButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  speedLabel: {
    fontWeight: "600",
    fontSize: 13,
  },

  // ── Sheets (playback / sleep) ──────────────────────────────
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginBottom: 10,
    gap: 6,
  },
  sheetLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 4,
  },
  sheetHint: {
    fontSize: 10,
    paddingHorizontal: 4,
    opacity: 0.8,
  },
  chipRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    alignItems: "center",
  },
  chipGrow: {
    flex: 1,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    marginBottom: 2,
  },
  stepperBtn: {
    width: 38,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperGlyph: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 22,
  },
  stepperValue: {
    minWidth: 64,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  chipText: {
    fontSize: 12,
    fontWeight: "500",
  },

  // ── Sleep timer chip (utility row) ─────────────────────────
  sleepChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  sleepChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
  timerIcon: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  timerDial: {
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 1.5,
  },
  timerHand: {
    position: "absolute",
    width: 1.5,
    height: 4.5,
    borderRadius: 1,
    top: 2.5,
  },
});
