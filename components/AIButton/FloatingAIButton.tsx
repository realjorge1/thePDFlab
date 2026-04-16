/**
 * FloatingAIButton
 *
 * A global floating action button for quick athemi access, using the techy "/a"
 * logo. Features a static multi-tone tech-color aura ring around the logo.
 *
 * No animations — clean, static, polished look.
 *
 * Appears on all bottom-tab screens **except** the Home screen.
 * Position: bottom-right, fixed and consistent across screens.
 */

import { GradientView } from "@/components/GradientView";
import { colors as appColors } from "@/constants/theme";
import { usePathname, useRouter } from "expo-router";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import AILogoIcon from "./AILogoIcon";
import { CircleRing } from "./CircleRing";

// ─── Layout constants ───────────────────────────────────────────────────────
const BUTTON_SIZE = 36;
const RING_INSET = 4;
const RING_SIZE = BUTTON_SIZE + RING_INSET * 2; // 44
const INNER_SIZE = BUTTON_SIZE - RING_INSET * 2; // 28
const GLOW_SIZE = BUTTON_SIZE + 28; // 64
const RING_STROKE = (RING_SIZE - INNER_SIZE) / 2; // 8 — ring thickness

// ─── Static Tech Colors ────────────────────────────────────────────────────
const NEON_GREEN = "#4dff91";
const CYAN = "#00e5ff";
const ELECTRIC_BLUE = "#0080ff";
const MAGENTA = "#ff00ff";

// ─── Main component ─────────────────────────────────────────────────────────
export default function FloatingAIButton() {
  const router = useRouter();
  const pathname = usePathname();

  // ── Visibility: all tab screens except Home, plus the Folders screen ─
  const allowedPaths = ["/tools", "/library", "/download", "/folders"];
  const isVisible = allowedPaths.some(
    (p) => pathname === p || pathname === `/(tabs)${p}`,
  );

  // PERF: Early return when not visible — avoids rendering the entire
  // gradient/aura tree on every screen where the button is hidden
  if (!isVisible) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* ── Ring A: primary circle gradient ──────────────────────── */}
      <CircleRing
        size={RING_SIZE}
        strokeWidth={RING_STROKE}
        opacity={0.9}
        colors={[NEON_GREEN, CYAN, ELECTRIC_BLUE, MAGENTA, NEON_GREEN]}
        gradientStart={{ x: 0, y: 0 }}
        gradientEnd={{ x: 1, y: 1 }}
        gradientId="fab_ring_a"
      />

      {/* ── Ring B: secondary circle gradient (softer) ────────────── */}
      <CircleRing
        size={RING_SIZE}
        strokeWidth={RING_STROKE}
        opacity={0.5}
        colors={[CYAN, NEON_GREEN, ELECTRIC_BLUE, CYAN]}
        gradientStart={{ x: 1, y: 0 }}
        gradientEnd={{ x: 0, y: 1 }}
        gradientId="fab_ring_b"
      />

      {/* ── Inner mask (app header gradient) ─────────────────────── */}
      <View style={styles.innerMask} pointerEvents="none">
        <GradientView
          colors={[
            appColors.gradientStart,
            appColors.gradientMid,
            appColors.gradientEnd,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.innerMaskGradient}
        />
      </View>

      {/* ── Tappable button with static /x icon ──────────────────── */}
      <TouchableOpacity
        style={styles.hitArea}
        activeOpacity={0.8}
        onPress={() => router.push("/ai")}
        accessibilityLabel="Open athemi"
        accessibilityRole="button"
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <AILogoIcon size={16} color={NEON_GREEN} animated={false} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 100,
    right: 18,
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    elevation: 20,
  },

  innerMask: {
    position: "absolute",
    width: INNER_SIZE,
    height: INNER_SIZE,
    borderRadius: INNER_SIZE / 2,
    overflow: "hidden",
  },

  innerMaskGradient: {
    flex: 1,
    borderRadius: INNER_SIZE / 2,
  },

  hitArea: {
    position: "absolute",
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
