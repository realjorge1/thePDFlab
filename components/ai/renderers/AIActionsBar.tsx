// ============================================
// AIActionsBar — global actions strip shown below any AI output
// Reusable across feature renderers. Non-blocking: missing handlers are skipped.
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import {
  Download,
  FileText,
  Lightbulb,
  ListChecks,
  Presentation,
  StickyNote,
} from "lucide-react-native";
import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

export interface AIAction {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  onPress: () => void;
}

interface Props {
  actions?: AIAction[];
  /** Shorthand: provide handlers for the built-in action set */
  handlers?: {
    onConvertToSlides?: () => void;
    onAddToNotes?: () => void;
    onExtractTasks?: () => void;
    onExplain?: () => void;
    onExport?: () => void;
  };
}

export function AIActionsBar({ actions, handlers }: Props) {
  const { colors: t, mode } = useTheme();

  const defaultActions: AIAction[] = handlers
    ? (
        [
          handlers.onConvertToSlides && {
            id: "slides",
            label: "To Slides",
            icon: Presentation,
            onPress: handlers.onConvertToSlides,
          },
          handlers.onAddToNotes && {
            id: "notes",
            label: "To Notes",
            icon: StickyNote,
            onPress: handlers.onAddToNotes,
          },
          handlers.onExtractTasks && {
            id: "tasks",
            label: "Extract Tasks",
            icon: ListChecks,
            onPress: handlers.onExtractTasks,
          },
          handlers.onExplain && {
            id: "explain",
            label: "Explain",
            icon: Lightbulb,
            onPress: handlers.onExplain,
          },
          handlers.onExport && {
            id: "export",
            label: "Export",
            icon: Download,
            onPress: handlers.onExport,
          },
        ].filter(Boolean) as AIAction[]
      )
    : [];

  const merged: AIAction[] = actions && actions.length > 0 ? actions : defaultActions;

  if (merged.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.barContent}
    >
      {merged.map((a) => {
        const Icon = a.icon ?? FileText;
        return (
          <TouchableOpacity
            key={a.id}
            onPress={a.onPress}
            activeOpacity={0.7}
            style={[
              styles.chip,
              {
                backgroundColor:
                  mode === "dark" ? "rgba(147,51,234,0.18)" : "#F3E8FF",
                borderColor: mode === "dark" ? "#6B21A8" : "#D8B4FE",
              },
            ]}
          >
            <Icon size={13} color={mode === "dark" ? "#E9D5FF" : "#7E22CE"} />
            <Text
              style={[
                styles.chipText,
                { color: mode === "dark" ? "#E9D5FF" : "#7E22CE" },
              ]}
            >
              {a.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginTop: 10,
    marginHorizontal: -2,
  },
  barContent: {
    gap: 6,
    paddingRight: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11.5,
    fontWeight: "600",
  },
});
