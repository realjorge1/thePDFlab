// ============================================
// AISkyBackground
// ---------------------------------------------
// A lightweight ambient backdrop for the main AI chat only:
//   • dark mode → occasional diagonal shooting-star streaks (Grok-style)
//   • light mode → nothing (kept deliberately clean / "normal")
// Absolute-fill, pointerEvents="none", and fully paused when `active` is false
// (e.g. screen blurred) so it never costs anything off-screen. Decorative only —
// safe to fail (mounted behind a SafeBoundary).
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const { width: W, height: H } = Dimensions.get("window");

const STAR_COUNT = 3;

// ─── Shooting star (dark mode) ──────────────────────────────────────────────
// A thin streak with a faint tail and a bright leading head, gliding diagonally
// down-and-left across the upper portion of the screen, then a long dark gap.
function ShootingStar({ index }: { index: number }) {
  const progress = useSharedValue(0);

  const cfg = useMemo(() => {
    // Travel direction: down-left. Angle measured in screen space (y points
    // down), so 145° → moving left and slightly down.
    const dirDeg = 142 + Math.random() * 10;
    const rad = (dirDeg * Math.PI) / 180;
    return {
      length: 70 + Math.random() * 70, // streak length (px)
      // Spread the entry points wider across the screen so the streaks don't
      // bunch up in the same right-hand corner.
      startX: W * 0.45 + Math.random() * W * 0.6,
      startY: -40 - Math.random() * H * 0.1,
      distance: H * 0.55 + Math.random() * H * 0.3,
      vx: Math.cos(rad),
      vy: Math.sin(rad),
      rotate: `${dirDeg}deg`,
      // Fraction of the full cycle that the star is actually streaking; the
      // remainder is the quiet dark gap before it appears again. Kept small so
      // each long cycle is mostly dark sky — sparse, not raining.
      streakFrac: 0.12 + Math.random() * 0.06,
      // Long, widely-varied cycles → long unpredictable gaps between streaks.
      cycle: 7000 + Math.random() * 7000,
      // Heavily staggered + randomised start so the streaks desync instead of
      // arriving in a predictable, evenly-spaced patter.
      delay: index * 2600 + Math.random() * 6500,
    };
  }, [index]);

  useEffect(() => {
    progress.value = withDelay(
      cfg.delay,
      withRepeat(
        withTiming(1, { duration: cfg.cycle, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, [progress, cfg]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const sf = cfg.streakFrac;
    // local 0..1 while streaking, clamped after.
    const local = Math.min(1, p / sf);
    // Ease-out so the star decelerates slightly as it fades — feels more natural
    // than a dead-linear slide.
    const eased = 1 - Math.pow(1 - local, 2);
    const d = eased * cfg.distance;
    let op = 0;
    if (p < sf) {
      // Fade in over the first 18% of the streak, out over the last 45%.
      op = local < 0.18 ? local / 0.18 : Math.max(0, 1 - (local - 0.18) / 0.82);
    }
    return {
      // Dimmer overall so the streaks read as a faint ambient glow rather than
      // bright, attention-grabbing flashes.
      opacity: op * 0.5,
      transform: [
        { translateX: cfg.startX + cfg.vx * d },
        { translateY: cfg.startY + cfg.vy * d },
        { rotate: cfg.rotate },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.streakWrap, { width: cfg.length }, style]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.45)"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.streak}
      />
      <View style={styles.head} />
    </Animated.View>
  );
}

interface Props {
  /** Pause + unmount the animation when false (e.g. screen blurred). */
  active?: boolean;
}

export const AISkyBackground = React.memo(function AISkyBackground({
  active = true,
}: Props) {
  const { mode } = useTheme();
  // Light mode stays clean/"normal" — no decorative motion.
  if (!active || mode !== "dark") return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      renderToHardwareTextureAndroid
    >
      {Array.from({ length: STAR_COUNT }, (_, i) => (
        <ShootingStar key={i} index={i} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  streakWrap: {
    position: "absolute",
    height: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  streak: {
    flex: 1,
    height: 1.5,
    borderRadius: 1,
  },
  // Bright leading head at the front of the streak.
  head: {
    position: "absolute",
    right: 0,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
});
