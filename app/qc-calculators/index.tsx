import { QCScreenShell } from "@/components/qc/QCScreenShell";
import { PressableScale } from "@/components/ui/PressableScale";
import {
  QC_TOOL_GROUP_TITLES,
  QC_TOOLS,
  type QcToolGroup,
} from "@/constants/qcTools";
import { useTheme } from "@/services/ThemeProvider";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

const GROUP_ORDER: QcToolGroup[] = ["method-validation", "lot-verification"];

/**
 * Westgard QC hub: the calculator suite. Every tool runs entirely
 * on-device — the whole section works in airplane mode.
 */
export default function QCCalculatorsHub() {
  const router = useRouter();
  const { colors: t } = useTheme();

  return (
    <QCScreenShell
      title="QC Calculators"
      subtitle="Statistical QC & method validation"
      showKeypad={false}
    >
      {GROUP_ORDER.map((group) => (
        <View key={group}>
          <Text style={[styles.groupHeader, { color: t.sectionHeader }]}>
            {QC_TOOL_GROUP_TITLES[group]}
          </Text>
          {QC_TOOLS.filter((tool) => tool.group === group).map((tool) => {
            const Icon = tool.icon;
            return (
              <PressableScale
                key={tool.id}
                scaleTo={0.98}
                onPress={() =>
                  router.push({
                    pathname: "/qc-calculators/[tool]",
                    params: { tool: tool.id },
                  })
                }
                style={[
                  styles.card,
                  { backgroundColor: t.card, borderColor: t.border },
                ]}
              >
                <View
                  style={[styles.iconWrap, { backgroundColor: t.primary }]}
                >
                  <Icon size={18} color="#FFFFFF" />
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: t.text }]}>
                    {tool.name}
                  </Text>
                  <Text
                    style={[styles.cardDesc, { color: t.textSecondary }]}
                    numberOfLines={2}
                  >
                    {tool.description}
                  </Text>
                </View>
                <ChevronRight size={16} color={t.textTertiary} />
              </PressableScale>
            );
          })}
        </View>
      ))}
    </QCScreenShell>
  );
}

const styles = StyleSheet.create({
  groupHeader: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: 12,
  },
});
