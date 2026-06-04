// ============================================
// ActivityOverlay
// ---------------------------------------------
// The single, root-mounted spring "pull-to-cancel" overlay. Subscribes to the
// global activity store; when a task is active it dims the screen and shows the
// shimmering 3-phase status text — no card, no icon, just the words floating
// centered on the dimmed screen. The user can drag down (with springy
// rubber-band resistance) past a threshold to cancel — which aborts the
// underlying request and springs the overlay away.
//
// Renders null when idle, so screens that never call runCancelable() are wholly
// unaffected. Wrapped in a SafeBoundary at the mount site.
// ============================================

import { ShimmerText } from "@/components/activity/ShimmerText";
import { phaseMessage } from "@/services/activity/activityPhases";
import { useActivityStore } from "@/services/activity/activityStore";
import { useTheme } from "@/services/ThemeProvider";
import * as Haptics from "expo-haptics";
import { ChevronDown } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Downward drag (px) required to arm a cancel.
const CANCEL_THRESHOLD = 130;

/** Tiny stable hash so the phase message doesn't flicker within a task. */
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

function safeHaptic(fn: () => Promise<unknown>) {
  try {
    fn().catch(() => {});
  } catch {
    // haptics unavailable — ignore
  }
}

export function ActivityOverlay() {
  const task = useActivityStore((s) => s.task);
  const { colors: t, mode } = useTheme();

  // Drag + entrance animation state
  const translateY = useSharedValue(0);
  const enter = useSharedValue(0);
  const [armed, setArmed] = useState(false);

  // Re-tick so the time-based phase message advances for indeterminate work.
  const [, setTick] = useState(0);

  const active = !!task;
  const cancelable = task?.cancelable ?? false;

  useEffect(() => {
    if (active) {
      translateY.value = 0;
      setArmed(false);
      enter.value = withTiming(1, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      enter.value = 0;
    }
  }, [active, enter, translateY]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setTick((n) => n + 1), 600);
    return () => clearInterval(interval);
  }, [active]);

  // Drive the "release to cancel" label from the UI thread without re-rendering
  // on every frame.
  useAnimatedReaction(
    () => translateY.value > CANCEL_THRESHOLD,
    (isArmed, was) => {
      if (isArmed !== was) {
        runOnJS(setArmed)(isArmed);
        if (isArmed) runOnJS(safeHaptic)(() => Haptics.selectionAsync());
      }
    },
  );

  const doCancel = React.useCallback(() => {
    safeHaptic(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    );
    task?.abort();
  }, [task]);

  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(cancelable)
        .activeOffsetY(8)
        .onUpdate((e) => {
          "worklet";
          const dy = e.translationY;
          if (dy <= 0) {
            // Resist upward drags strongly — this overlay only pulls down.
            translateY.value = dy * 0.15;
          } else if (dy <= CANCEL_THRESHOLD) {
            translateY.value = dy;
          } else {
            // Diminishing returns past the threshold (rubber band).
            translateY.value = CANCEL_THRESHOLD + (dy - CANCEL_THRESHOLD) * 0.4;
          }
        })
        .onEnd(() => {
          "worklet";
          if (translateY.value > CANCEL_THRESHOLD) {
            translateY.value = withTiming(600, { duration: 220 });
            runOnJS(doCancel)();
          } else {
            translateY.value = withSpring(0, { damping: 16, stiffness: 180 });
          }
        }),
    [cancelable, doCancel, translateY],
  );

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
  }));

  const contentStyle = useAnimatedStyle(() => {
    const dragT = interpolate(
      translateY.value,
      [0, CANCEL_THRESHOLD],
      [0, 1],
      "clamp",
    );
    return {
      transform: [
        { translateY: translateY.value },
        { scale: 0.96 + 0.04 * enter.value - 0.03 * dragT },
      ],
      opacity: enter.value * (1 - 0.25 * dragT),
    };
  });

  if (!active || !task) return null;

  const elapsedMs = Date.now() - task.startedAt;
  const message = phaseMessage({
    kind: task.kind,
    elapsedMs,
    progress: task.progress,
    seed: hashSeed(task.id),
  });

  const accent = t.primary;
  const scrimColor =
    mode === "dark" ? "rgba(0,0,0,0.62)" : "rgba(15,23,42,0.42)";
  const determinate = typeof task.progress === "number";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: scrimColor },
          scrimStyle,
        ]}
        pointerEvents="auto"
      />
      <GestureDetector gesture={panGesture}>
        {/* Full-screen capture surface so the pull-to-cancel gesture works
            anywhere on the overlay, and underlying touches stay blocked. The
            status text floats alone — no card, no icon. */}
        <Animated.View style={styles.centerWrap}>
          <Animated.View style={[styles.content, contentStyle]}>
            <ShimmerText
              text={task.label ? `${task.label}…` : `${message}…`}
              color={t.textSecondary}
              highlightColor={mode === "dark" ? "#FFFFFF" : accent}
              fontSize={18}
              fontWeight="700"
              style={styles.statusText}
            />

            {/* Sub status uses the rotating phase copy when a label is set */}
            {!!task.label && (
              <ShimmerText
                text={`${message}…`}
                color={t.textTertiary}
                highlightColor={t.textSecondary}
                fontSize={13}
                fontWeight="500"
                duration={1800}
                style={styles.subText}
              />
            )}

            {determinate && (
              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: mode === "dark" ? "#262626" : "#EEF2FF" },
                ]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: accent,
                      width: `${Math.round(
                        Math.min(1, Math.max(0, task.progress ?? 0)) * 100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            )}

            {cancelable && (
              <View style={styles.cancelHint}>
                <ChevronDown
                  size={16}
                  color={armed ? accent : t.textTertiary}
                  strokeWidth={2.4}
                />
                <Animated.Text
                  style={[
                    styles.cancelText,
                    { color: armed ? accent : t.textTertiary },
                  ]}
                >
                  {armed ? "Release to cancel" : "Pull down to cancel"}
                </Animated.Text>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  content: {
    alignItems: "center",
    maxWidth: 340,
  },
  statusText: {
    textAlign: "center",
  },
  subText: {
    marginTop: 6,
    textAlign: "center",
  },
  progressTrack: {
    marginTop: 16,
    height: 5,
    width: 180,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  cancelHint: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  cancelText: {
    fontSize: 12.5,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
