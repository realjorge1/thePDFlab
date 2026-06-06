// ============================================
// PressableScale
// ---------------------------------------------
// A drop-in replacement for TouchableOpacity/Pressable that adds a springy
// scale-down + (optional) haptic tap on press, with zero change to press
// semantics. onPress / disabled / hitSlop / etc. all behave exactly as before.
// Adopt incrementally anywhere a tappable control should feel responsive.
// ============================================

// Haptics are globally disabled — this is a no-op shim (see utils/haptics.ts).
import * as Haptics from "@/utils/haptics";
import React from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticKind = "light" | "medium" | "heavy" | "selection";

function fireHaptic(kind: HapticKind) {
  try {
    if (kind === "selection") {
      Haptics.selectionAsync().catch(() => {});
    } else {
      const map = {
        light: Haptics.ImpactFeedbackStyle.Light,
        medium: Haptics.ImpactFeedbackStyle.Medium,
        heavy: Haptics.ImpactFeedbackStyle.Heavy,
      } as const;
      Haptics.impactAsync(map[kind]).catch(() => {});
    }
  } catch {
    // haptics unavailable on this device/build — ignore
  }
}

export interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Target scale on press-in. Default 0.96. */
  scaleTo?: number;
  /** Haptic on press-in: true = light, or a specific kind, or false to disable. Default "light". */
  haptic?: HapticKind | boolean;
  children?: React.ReactNode;
}

export const PressableScale = React.forwardRef<
  React.ComponentRef<typeof Pressable>,
  PressableScaleProps
>(function PressableScale(
  {
    style,
    scaleTo = 0.96,
    haptic = "light",
    disabled,
    onPressIn,
    onPressOut,
    children,
    ...rest
  },
  ref,
) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn: PressableProps["onPressIn"] = (e) => {
    if (!disabled) {
      scale.value = withSpring(scaleTo, { damping: 18, stiffness: 320 });
      if (haptic) fireHaptic(haptic === true ? "light" : haptic);
    }
    onPressIn?.(e);
  };

  const handlePressOut: PressableProps["onPressOut"] = (e) => {
    scale.value = withSpring(1, { damping: 14, stiffness: 260 });
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
});
