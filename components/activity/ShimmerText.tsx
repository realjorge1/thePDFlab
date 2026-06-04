// ============================================
// ShimmerText
// ---------------------------------------------
// A line of text with a soft band of light that sweeps across the characters,
// left to right, on a loop — the "flash moving across the words" used while the
// AI is thinking and inside the spring activity overlay. Pure Reanimated, one
// shared clock driving per-character color/opacity. No native masked-view dep.
// ============================================

import React, { useEffect, useMemo } from "react";
import { StyleSheet, View, type TextStyle } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

// Fraction of the string the bright band spans at any instant.
const BAND = 0.22;

interface ShimmerCharProps {
  char: string;
  pos: number; // normalized position 0..1
  progress: SharedValue<number>;
  baseColor: string;
  highlightColor: string;
  textStyle: TextStyle;
}

function ShimmerChar({
  char,
  pos,
  progress,
  baseColor,
  highlightColor,
  textStyle,
}: ShimmerCharProps) {
  const animatedStyle = useAnimatedStyle(() => {
    // Sweep the band head from just off the left edge to just off the right.
    const head = progress.value * (1 + 2 * BAND) - BAND;
    const dist = Math.abs(pos - head);
    const t = Math.max(0, 1 - dist / BAND); // 1 at band center → 0 outside
    return {
      color: interpolateColor(t, [0, 1], [baseColor, highlightColor]),
      opacity: 0.5 + 0.5 * t,
    };
  });

  return (
    <Animated.Text style={[textStyle, animatedStyle]}>{char}</Animated.Text>
  );
}

export interface ShimmerTextProps {
  text: string;
  /** Dim base color of the characters. */
  color: string;
  /** Bright color at the center of the sweep. Defaults to white-ish. */
  highlightColor?: string;
  fontSize?: number;
  fontWeight?: TextStyle["fontWeight"];
  letterSpacing?: number;
  /** One full sweep duration in ms. */
  duration?: number;
  style?: TextStyle;
}

export const ShimmerText = React.memo(function ShimmerText({
  text,
  color,
  highlightColor = "#FFFFFF",
  fontSize = 16,
  fontWeight = "600",
  letterSpacing = 0.2,
  duration = 1500,
  style,
}: ShimmerTextProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [progress, duration, text]);

  const chars = useMemo(() => text.split(""), [text]);
  const total = chars.length;

  const textStyle: TextStyle = useMemo(
    () => ({ fontSize, fontWeight, letterSpacing, ...style }),
    [fontSize, fontWeight, letterSpacing, style],
  );

  return (
    <View style={styles.row}>
      {chars.map((char, i) => (
        <ShimmerChar
          key={`${i}-${char}`}
          char={char === " " ? " " : char}
          pos={total <= 1 ? 0 : i / (total - 1)}
          progress={progress}
          baseColor={color}
          highlightColor={highlightColor}
          textStyle={textStyle}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
});
