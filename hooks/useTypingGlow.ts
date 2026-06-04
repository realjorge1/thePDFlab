// ============================================
// useTypingGlow
// ---------------------------------------------
// Returns an animated style that makes an input's container softly glow with
// the accent color *while the user is typing* (each keystroke re-pulses it),
// then fades out shortly after typing stops. It is a soft colored shadow halo —
// never a border (the app forbids dashed/dotted borders, and a solid border
// isn't the intent here). Wire `onType` to the TextInput's onChangeText.
// ============================================

import { useCallback, useEffect, useRef } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

interface Options {
  /** Max glow intensity 0..1. Default 0.5. */
  intensity?: number;
  /** Idle ms after the last keystroke before the glow fades. Default 550. */
  idleMs?: number;
}

export function useTypingGlow(accent: string, opts: Options = {}) {
  const { intensity = 0.5, idleMs = 550 } = opts;
  const glow = useSharedValue(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onType = useCallback(() => {
    glow.value = withTiming(1, { duration: 140 });
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      glow.value = withTiming(0, { duration: 650 });
    }, idleMs);
  }, [glow, idleMs]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: accent,
    shadowOpacity: 0.04 + intensity * glow.value,
    shadowRadius: 4 + 16 * glow.value,
    shadowOffset: { width: 0, height: 0 },
    elevation: glow.value * 8,
  }));

  return { glowStyle, onType };
}
