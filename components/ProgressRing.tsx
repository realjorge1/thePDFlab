/**
 * ProgressRing
 *
 * A minimal animated SVG ring indicator. Animates the stroke fill on mount
 * (and on `progress` change) and renders the percentage in the centre.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressRingProps {
  /** 0..1 progress value. */
  progress: number;
  /** Outer diameter in pixels. */
  size?: number;
  /** Stroke thickness. */
  strokeWidth?: number;
  /** Filled-arc colour. */
  color: string;
  /** Track (unfilled) colour. */
  trackColor: string;
  /** Centre text colour. */
  textColor: string;
  /** When `progress === 0`, render a subdued "—" instead of "0%". */
  emptyLabel?: string;
}

export function ProgressRing({
  progress,
  size = 128,
  strokeWidth = 10,
  color,
  trackColor,
  textColor,
  emptyLabel = "—",
}: ProgressRingProps) {
  const safeProgress = Math.max(0, Math.min(1, progress || 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const animatedProgress = useRef(new Animated.Value(0)).current;
  const numericProgress = useRef(safeProgress);

  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: safeProgress,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    numericProgress.current = safeProgress;
  }, [safeProgress, animatedProgress]);

  const strokeDashoffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const percent = Math.round(safeProgress * 100);
  const label = safeProgress <= 0 ? emptyLabel : `${percent}%`;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          // Rotate so progress starts at 12 o'clock.
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.labelLayer} pointerEvents="none">
        <Text
          style={[
            styles.percentText,
            {
              color: textColor,
              fontSize: Math.max(14, Math.round(size * 0.22)),
            },
          ]}
          allowFontScaling={false}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  labelLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  percentText: {
    fontWeight: "800",
    letterSpacing: -0.5,
  },
});
