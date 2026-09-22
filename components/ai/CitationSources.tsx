// ============================================
// CitationSources — the "Sources" list under a document answer (W4)
// ---------------------------------------------
// Each row: a numbered badge + location label (tap to go there) and the quote,
// clamped to two lines (tap the quote to expand it).
// ============================================

import { ChevronRight } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AICitation } from "@/services/ai/citations";
import { useTheme } from "@/services/ThemeProvider";

interface Props {
  citations: AICitation[];
  onPress?: (citation: AICitation) => void;
  accentColor?: string;
}

function SourceRow({
  citation,
  onPress,
  accent,
}: {
  citation: AICitation;
  onPress?: (citation: AICitation) => void;
  accent: string;
}) {
  const { colors: t, mode } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const label = citation.locator?.label ?? `Page ${citation.page}`;
  const go = useCallback(() => onPress?.(citation), [onPress, citation]);

  return (
    <View style={[styles.row, { borderColor: mode === "dark" ? "#334155" : "#E2E8F0" }]}>
      <Pressable
        onPress={go}
        disabled={!onPress}
        style={styles.header}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Go to source ${citation.id}, ${label}`}
      >
        <View style={[styles.badge, { backgroundColor: `${accent}22` }]}>
          <Text allowFontScaling style={[styles.badgeText, { color: accent }]}>
            {citation.id}
          </Text>
        </View>
        <Text allowFontScaling style={[styles.label, { color: accent }]} numberOfLines={1}>
          {label}
        </Text>
        {onPress ? <ChevronRight size={14} color={accent} /> : null}
      </Pressable>
      {citation.quote ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityHint={expanded ? "Collapses the quote" : "Shows the full quote"}
        >
          <Text
            allowFontScaling
            numberOfLines={expanded ? undefined : 2}
            style={[styles.quote, { color: t.textSecondary }]}
          >
            “{citation.quote}”
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const CitationSources = React.memo(function CitationSources({
  citations,
  onPress,
  accentColor,
}: Props) {
  const { colors: t } = useTheme();
  if (!citations || citations.length === 0) return null;
  const accent = accentColor ?? "#9333EA";
  return (
    <View style={styles.wrap}>
      <Text allowFontScaling style={[styles.title, { color: t.textSecondary }]} accessibilityRole="header">
        Sources
      </Text>
      {citations.map((c) => (
        <SourceRow key={`${c.id}-${c.page}`} citation={c} onPress={onPress} accent={accent} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 6 },
  title: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, gap: 2 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  label: { fontSize: 12.5, fontWeight: "700", flexShrink: 1 },
  quote: { fontSize: 12.5, lineHeight: 18, fontStyle: "italic" },
});
