/**
 * AILogoIcon
 *
 * Thunder bolt icon rendered via Expo Vector Icons (Ionicons "flash").
 * Replaces the old SVG "/x" letterform.
 * Fully scalable via `size` and `color` props.
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { View } from "react-native";

interface AILogoIconProps {
  /** Render size in dp */
  size?: number;
  /** Icon colour — default matches ai_logo neon green */
  color?: string;
  /** Unused; kept for backward-compat with existing call sites */
  animated?: boolean;
}

export default function AILogoIcon({
  size = 22,
  color = "#4dff91",
}: AILogoIconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name="flash" size={size} color={color} />
    </View>
  );
}
