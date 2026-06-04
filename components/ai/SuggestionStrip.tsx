// ============================================
// SuggestionStrip
// ---------------------------------------------
// Horizontally-scrolling starter-prompt chips shown on empty AI screens. Tapping
// a chip fires onPick(text) — the screen fills the composer and auto-sends.
// Replaces the old static "Ask me a question" hint bullets.
// ============================================

import { PressableScale } from "@/components/ui/PressableScale";
import { pickSuggestions } from "@/constants/ai-suggestions";
import type { AIAction } from "@/services/ai/ai.types";
import { useTheme } from "@/services/ThemeProvider";
import { Sparkles } from "lucide-react-native";
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

interface Props {
  action: AIAction;
  onPick: (text: string) => void;
  /** Optional override list (e.g. doc-specific prompts). */
  suggestions?: string[];
  style?: ViewStyle;
}

export const SuggestionStrip = React.memo(function SuggestionStrip({
  action,
  onPick,
  suggestions,
  style,
}: Props) {
  const { colors: t, mode } = useTheme();
  // Fresh random batch each time the strip mounts or the feature changes; never
  // the same set twice in a row (handled inside pickSuggestions).
  const items = useMemo(
    () => suggestions ?? pickSuggestions(action),
    [action, suggestions],
  );

  return (
    <View style={[styles.wrap, style]} pointerEvents="box-none">
      <View style={styles.labelRow}>
        <Sparkles size={13} color={t.primary} strokeWidth={2.2} />
        <Text style={[styles.label, { color: t.textTertiary }]}>
          Try one of these
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((text, i) => (
          <Animated.View
            key={`${i}-${text}`}
            entering={FadeInDown.delay(i * 55)
              .duration(320)
              .springify()
              .damping(16)}
          >
            <PressableScale
              haptic="light"
              onPress={() => onPick(text)}
              style={[
                styles.chip,
                {
                  backgroundColor: mode === "dark" ? "#161616" : "#FFFFFF",
                  borderColor: mode === "dark" ? "#262626" : "#E2E8F0",
                },
              ]}
            >
              <Text
                style={[styles.chipText, { color: t.text }]}
                numberOfLines={2}
              >
                {text}
              </Text>
            </PressableScale>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 6,
    paddingBottom: 8,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  row: {
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    maxWidth: 230,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13.5,
    fontWeight: "500",
    lineHeight: 18,
  },
});
