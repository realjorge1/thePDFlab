// ============================================
// AI Empty State – shown when no messages exist yet
// ============================================

import AILogoBadge from "@/components/AIButton/AILogoBadge";
import { pickGreeting } from "@/constants/ai-greetings";
import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import type { AIAction } from "@/services/ai/ai.types";
import { AI_FEATURES } from "@/services/ai/ai.types";
import {
  BookOpen,
  Brain,
  FileSearch,
  FileSignature,
  FileText,
  GraduationCap,
  Highlighter,
  Languages,
  Lightbulb,
  ListChecks,
  MessageSquare,
  ScanSearch,
  Sparkles,
} from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  "message-square": MessageSquare,
  "book-open": BookOpen,
  languages: Languages,
  "file-search": FileSearch,
  brain: Brain,
  "list-checks": ListChecks,
  "file-signature": FileSignature,
  "file-text": FileText,
  "scan-search": ScanSearch,
  highlighter: Highlighter,
  lightbulb: Lightbulb,
  "graduation-cap": GraduationCap,
};

interface Props {
  action: AIAction;
}

export const AIEmptyState = React.memo(function AIEmptyState({
  action,
}: Props) {
  const { colors: t, mode } = useTheme();
  const feature = AI_FEATURES.find((f) => f.id === action);
  const Icon = feature ? ICON_MAP[feature.icon] || Sparkles : Sparkles;
  const color = feature?.color || "#9333EA";
  // Pick a fresh time-based greeting once per mount (i.e. each time the empty
  // screen opens / the feature changes). Never repeats twice in a row.
  const [greeting] = useState(() => pickGreeting());

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: mode === "dark" ? `${color}22` : `${color}15`,
          },
        ]}
      >
        {action === "chat" ? (
          <AILogoBadge size={56} />
        ) : (
          <Icon color={color} size={44} strokeWidth={1.8} />
        )}
      </View>
      <Text style={[styles.title, { color: t.text }]}>{greeting}</Text>
      <Text style={[styles.subtitle, { color: t.textSecondary }]}>
        {feature?.description || "Select a mode to get started"}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  hints: {
    alignSelf: "stretch",
    gap: spacing.xs + 2,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 8,
  },
  hintBullet: {
    fontSize: 18,
    fontWeight: "700",
  },
  hintText: {
    fontSize: 13,
    flex: 1,
  },
});
