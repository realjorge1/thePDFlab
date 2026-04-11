// ============================================
// FILE: components/AIFeatureCard.tsx
// ============================================
import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import {
  BookOpen,
  Brain,
  FileSearch,
  FileSignature,
  FileText,
  Languages,
  ListChecks,
  MessageSquare,
} from "lucide-react-native";
import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface AIFeature {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface AIFeatureCardProps {
  feature: AIFeature;
  onPress: () => void;
}

const iconMap: Record<string, React.ComponentType<{ color: string; size: number }>> = {
  summarize: BookOpen,
  translate: Languages,
  "extract-data": FileSearch,
  chat: MessageSquare,
  analyze: Brain,
  tasks: ListChecks,
  "fill-form": FileSignature,
  "chat-with-document": FileText,
};

const ICON_SIZE = 20;

export const AIFeatureCard = React.memo(function AIFeatureCard({
  feature,
  onPress,
}: AIFeatureCardProps) {
  const IconComponent = iconMap[feature.id] || BookOpen;
  const { colors: t } = useTheme();

  const iconBg = useCallback(
    () => ({ ...styles.iconBg, backgroundColor: feature.color }),
    [feature.color],
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, { backgroundColor: t.card }]}
      activeOpacity={0.75}
    >
      <View style={iconBg()}>
        <IconComponent color="white" size={ICON_SIZE} />
      </View>
      <Text style={[styles.name, { color: t.text }]}>{feature.name}</Text>
      <Text style={[styles.description, { color: t.textSecondary }]}>
        {feature.description}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    width: "48%",
    borderRadius: 12,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  iconBg: {
    padding: spacing.sm,
    borderRadius: 10,
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
  },
  name: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  description: {
    fontSize: 12,
  },
});
