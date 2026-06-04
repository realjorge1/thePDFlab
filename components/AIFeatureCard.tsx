// ============================================
// FILE: components/AIFeatureCard.tsx
// ============================================
import { spacing } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import {
  BookOpen,
  Brain,
  FileSignature,
  FileText,
  Languages,
  ListChecks,
  MessageSquare,
} from "lucide-react-native";
import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PressableScale } from "@/components/ui/PressableScale";

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
    <PressableScale
      onPress={onPress}
      style={[styles.card, { backgroundColor: t.card }]}
    >
      <View style={iconBg()}>
        <IconComponent color="white" size={ICON_SIZE} />
      </View>
      <Text style={[styles.name, { color: t.text }]}>{feature.name}</Text>
      <Text style={[styles.description, { color: t.textSecondary }]}>
        {feature.description}
      </Text>
    </PressableScale>
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
