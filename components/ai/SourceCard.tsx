// ============================================
// SourceCard — shows where a citation points (W4)
// ---------------------------------------------
// A small floating card with the location label and quote. Used above the
// in-reader AI panel and by viewers opened from Chat with File with a quote.
// PDF pages are never highlighted in place (see ENABLE_INPLACE_PDF_SELECTION),
// so this card is how the user sees the cited words. Closes on tap or after
// 6 seconds.
// ============================================

import { Quote, X } from "lucide-react-native";
import React, { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useTheme } from "@/services/ThemeProvider";

export const SOURCE_CARD_TIMEOUT_MS = 6_000;

/** Floating position for a Source card over a reader (clear of bottom bars). */
export const SOURCE_CARD_OVERLAY_STYLE = {
  position: "absolute" as const,
  left: 12,
  right: 12,
  bottom: 96,
  zIndex: 60,
};

interface Props {
  label: string;
  quote?: string;
  onClose: () => void;
  style?: ViewStyle;
  /** Auto-close delay; 0 disables. */
  timeoutMs?: number;
}

export function SourceCard({ label, quote, onClose, style, timeoutMs = SOURCE_CARD_TIMEOUT_MS }: Props) {
  const { colors: t, mode } = useTheme();

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(`Source: ${label}`);
    if (!timeoutMs) return;
    const id = setTimeout(onClose, timeoutMs);
    return () => clearTimeout(id);
  }, [label, quote, onClose, timeoutMs]);

  return (
    <Pressable
      onPress={onClose}
      style={[
        styles.card,
        {
          backgroundColor: mode === "dark" ? "#111827" : "#FFFFFF",
          borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Source, ${label}. ${quote ?? ""}. Tap to close.`}
    >
      <View style={styles.header}>
        <Quote size={14} color="#9333EA" />
        <Text allowFontScaling style={[styles.label, { color: "#9333EA" }]} numberOfLines={1}>
          Source · {label}
        </Text>
        <X size={14} color={t.textTertiary} />
      </View>
      {quote ? (
        <Text allowFontScaling style={[styles.quote, { color: t.text }]} numberOfLines={4}>
          “{quote}”
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { flex: 1, fontSize: 12.5, fontWeight: "700" },
  quote: { fontSize: 13.5, lineHeight: 19, fontStyle: "italic" },
});
