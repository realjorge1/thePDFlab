/**
 * AILogoBadge
 *
 * Pure visual / presentational AI logo badge — the gradient-ringed "/x" icon
 * used on the FloatingAIButton. Clean design with gradient rings, inner
 * app-gradient mask, and AILogoIcon centre.
 *
 * Fully scalable via the `size` prop (base unit = 64 dp, matching the FAB).
 */

import { GradientView } from "@/components/GradientView";
import { useGlowOpacity } from "@/components/motion/iconMotion";
import { colors as appColors } from "@/constants/theme";
import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useSharedValue, type SharedValue } from "react-native-reanimated";

import AILogoIcon from "./AILogoIcon";
import { CircleRing } from "./CircleRing";

// ─── Canonical tech colours (shared with FloatingAIButton) ──────────────────
const NEON_GREEN = "#4dff91";
const CYAN = "#00e5ff";
const ELECTRIC_BLUE = "#0080ff";
const MAGENTA = "#ff00ff";

// ─── Flash colours ──────────────────────────────────────────────────────────
// The two the disc passes through on its way back to the app gradient. The gold
// is the app's own — the same one the Premium chip wears — so the badge borrows
// a colour the product already has rather than inventing a second gold.
const FLASH_WHITE = "#FFFFFF";
const FLASH_GOLD = "#DAA520";

// ─── Base dimensions (from FloatingAIButton, size = 64) ─────────────────────
const BASE = 64;
const BASE_BUTTON = 36;
const BASE_RING_INSET = 4;
const BASE_RING = BASE_BUTTON + BASE_RING_INSET * 2; // 44
const BASE_INNER = BASE_BUTTON - BASE_RING_INSET * 2; // 28
const BASE_ICON = 16;
const BASE_RING_STROKE = (BASE_RING - BASE_INNER) / 2; // 8 — ring thickness
interface AILogoBadgeProps {
  /** Overall badge size in dp (default 64, matching the FAB). */
  size?: number;
  /**
   * Optional 0 → 1 → 2 → 3 driver that takes the disc behind the bolt white,
   * then gold, then back to the app gradient. Supplied by the Activity card's
   * idle show; left out everywhere else, where the badge is simply still.
   */
  glow?: SharedValue<number>;
}

export default function AILogoBadge({ size = BASE, glow }: AILogoBadgeProps) {
  const s = size / BASE; // scale factor

  const ringSize = BASE_RING * s;
  const ringStroke = BASE_RING_STROKE * s;
  const innerSize = BASE_INNER * s;
  const iconSize = BASE_ICON * s;

  // A badge nobody is driving still needs a value to read, and hooks can't be
  // skipped — so it reads a private one that never leaves zero.
  const still = useSharedValue(0);
  const flash = useGlowOpacity(glow ?? still);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* ── Ring A — primary circle gradient ─────────────────────── */}
      <CircleRing
        size={ringSize}
        strokeWidth={ringStroke}
        opacity={0.9}
        colors={[NEON_GREEN, CYAN, ELECTRIC_BLUE, MAGENTA, NEON_GREEN]}
        gradientStart={{ x: 0, y: 0 }}
        gradientEnd={{ x: 1, y: 1 }}
        gradientId="badge_ring_a"
      />

      {/* ── Ring B — secondary circle gradient (softer) ────────────── */}
      <CircleRing
        size={ringSize}
        strokeWidth={ringStroke}
        opacity={0.5}
        colors={[CYAN, NEON_GREEN, ELECTRIC_BLUE, CYAN]}
        gradientStart={{ x: 1, y: 0 }}
        gradientEnd={{ x: 0, y: 1 }}
        gradientId="badge_ring_b"
      />

      {/* ── Inner mask (app header gradient) ──────────────────────── */}
      <View
        style={{
          position: "absolute",
          width: innerSize,
          height: innerSize,
          borderRadius: innerSize / 2,
          overflow: "hidden",
        }}
      >
        <GradientView
          colors={[
            appColors.gradientStart,
            appColors.gradientMid,
            appColors.gradientEnd,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, borderRadius: innerSize / 2 }}
        />

        {/* Both flat fills sit inside the same clipped circle as the gradient,
            gold over white, so the disc changes colour without the badge's
            silhouette moving at all. Opacity only — the rings and the bolt are
            untouched. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: FLASH_WHITE },
            flash.white,
          ]}
        />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: FLASH_GOLD },
            flash.gold,
          ]}
        />
      </View>

      {/* ── AILogoIcon centre ────────────────────────────────────── */}
      <AILogoIcon size={iconSize} color={NEON_GREEN} animated={false} />
    </View>
  );
}
