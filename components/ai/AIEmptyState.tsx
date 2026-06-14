// ============================================
// AI Empty State – shown when no messages exist yet
// Time-of-day greeting + a one-line description of what the active feature
// does. Only the default Chat shows the gozlin badge; every other feature is
// icon-free so the description carries the meaning.
// ============================================

import AILogoBadge from "@/components/AIButton/AILogoBadge";
import { pickGreeting } from "@/constants/ai-greetings";
import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import type { AIAction } from "@/services/ai/ai.types";
import { AI_FEATURES } from "@/services/ai/ai.types";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  action: AIAction;
}

export const AIEmptyState = React.memo(function AIEmptyState({
  action,
}: Props) {
  const { colors: t, mode } = useTheme();
  const feature = AI_FEATURES.find((f) => f.id === action);
  const isChat = action === "chat";
  // Pick a fresh time-based greeting once per mount (i.e. each time the empty
  // screen opens / the feature changes). Never repeats twice in a row.
  const [greeting] = useState(() => pickGreeting());

  return (
    <View style={styles.container}>
      {/* Only the default Chat keeps a centered icon — the gozlin badge. */}
      {isChat && (
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor:
                mode === "dark" ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.12)",
            },
          ]}
        >
          <AILogoBadge size={56} />
        </View>
      )}
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
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 300,
    marginBottom: spacing.lg,
  },
});
