/**
 * OnboardingScreen — brand splash shown on every app launch.
 * Renders "inScribed" over the app's signature gradient for 3 s, then calls onFinish.
 */
import { colors } from "@/constants/theme";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GradientView } from "./GradientView";

interface Props {
  onFinish: () => void;
  durationMs?: number;
}

export function OnboardingScreen({ onFinish, durationMs = 3000 }: Props) {
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordScale = useRef(new Animated.Value(0.88)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Animate wordmark in
    Animated.parallel([
      Animated.timing(wordOpacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(wordScale, {
        toValue: 1,
        duration: 750,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
    ]).start();

    // Fade the whole screen out before calling onFinish
    const fadeOutAt = Math.max(durationMs - 400, 200);
    const timer = setTimeout(() => {
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 400,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onFinish();
      });
    }, fadeOutAt);

    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[styles.root, { opacity: screenOpacity }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.gradientStart} />
      <GradientView
        colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        <View style={styles.center}>
          <Animated.View
            style={{
              opacity: wordOpacity,
              transform: [{ scale: wordScale }],
            }}
          >
            <Text style={styles.wordmark}>inScribed</Text>
          </Animated.View>
        </View>
      </GradientView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  fill: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    fontSize: 52,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -1,
    includeFontPadding: false,
  },
});

export default OnboardingScreen;
