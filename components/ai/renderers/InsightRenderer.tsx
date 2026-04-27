// ============================================
// InsightRenderer — structured dashboard for Analyze results
// Consumes: { summary, sentiment, sentimentScore, insights[], strengths[],
//             weaknesses[], recommendations[], topics[], readability }
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import {
  AlertTriangle,
  CheckCircle2,
  Heart,
  Meh,
  ThumbsDown,
  ThumbsUp,
  Lightbulb,
  Sparkles,
  Tag,
  TrendingUp,
} from "lucide-react-native";
import React, { useCallback } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AIActionsBar } from "./AIActionsBar";

export interface InsightData {
  summary?: string;
  sentiment?: "positive" | "neutral" | "negative" | "mixed";
  sentimentScore?: number;
  insights?: Array<{ title: string; detail: string; sourceQuote?: string }>;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  topics?: string[];
  readability?: { level?: string; notes?: string };
}

interface Props {
  data: InsightData;
  onSourceTap?: (quote: string) => void;
  onAskMore?: (prompt: string) => void;
  onAddToNotes?: () => void;
  onExtractTasks?: () => void;
  onExport?: () => void;
}

const SENTIMENT_META: Record<
  string,
  { color: string; label: string; Icon: React.ComponentType<any> }
> = {
  positive: { color: "#10B981", label: "Positive", Icon: ThumbsUp },
  negative: { color: "#EF4444", label: "Negative", Icon: ThumbsDown },
  neutral: { color: "#64748B", label: "Neutral", Icon: Meh },
  mixed: { color: "#F59E0B", label: "Mixed", Icon: Heart },
};

export function InsightRenderer({
  data,
  onSourceTap,
  onAskMore,
  onAddToNotes,
  onExtractTasks,
  onExport,
}: Props) {
  const { colors: t, mode } = useTheme();
  const sentiment = SENTIMENT_META[data.sentiment || "neutral"] ?? SENTIMENT_META.neutral;
  const SentimentIcon = sentiment.Icon;

  const handleSource = useCallback(
    (quote: string) => {
      if (onSourceTap) onSourceTap(quote);
      else Alert.alert("Source", quote);
    },
    [onSourceTap],
  );

  const card = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };
  const sectionTitle = { color: t.text } as const;
  const sub = { color: t.textSecondary } as const;

  return (
    <View style={styles.wrap}>
      {/* Summary */}
      {data.summary ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <Sparkles size={14} color="#9333EA" />
            <Text style={[styles.cardTitle, sectionTitle]}>Summary</Text>
          </View>
          <Text style={[styles.body, { color: t.text }]}>{data.summary}</Text>
        </View>
      ) : null}

      {/* Sentiment */}
      {data.sentiment ? (
        <View style={[styles.card, card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
          <View style={[styles.sentimentIcon, { backgroundColor: `${sentiment.color}22` }]}>
            <SentimentIcon size={18} color={sentiment.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, sectionTitle]}>Sentiment</Text>
            <Text style={[styles.body, sub]}>
              {sentiment.label}
              {typeof data.sentimentScore === "number"
                ? `  ·  ${data.sentimentScore.toFixed(2)}`
                : ""}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Insights */}
      {Array.isArray(data.insights) && data.insights.length > 0 ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <TrendingUp size={14} color="#2563EB" />
            <Text style={[styles.cardTitle, sectionTitle]}>Key Insights</Text>
          </View>
          {data.insights.map((ins, idx) => (
            <TouchableOpacity
              key={idx}
              activeOpacity={ins.sourceQuote ? 0.75 : 1}
              onPress={() => ins.sourceQuote && handleSource(ins.sourceQuote)}
              style={[
                styles.insightRow,
                { borderLeftColor: "#2563EB" },
              ]}
            >
              <Text style={[styles.insightTitle, { color: t.text }]}>
                {ins.title}
              </Text>
              <Text style={[styles.insightDetail, sub]}>{ins.detail}</Text>
              {ins.sourceQuote ? (
                <Text style={[styles.sourceHint, { color: "#2563EB" }]} numberOfLines={1}>
                  "{ins.sourceQuote}"
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Strengths */}
      {Array.isArray(data.strengths) && data.strengths.length > 0 ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <CheckCircle2 size={14} color="#10B981" />
            <Text style={[styles.cardTitle, sectionTitle]}>Strengths</Text>
          </View>
          {data.strengths.map((s, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={[styles.bulletDot, { color: "#10B981" }]}>✓</Text>
              <Text style={[styles.bulletText, { color: t.text }]}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Weaknesses / Risks */}
      {Array.isArray(data.weaknesses) && data.weaknesses.length > 0 ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <AlertTriangle size={14} color="#F59E0B" />
            <Text style={[styles.cardTitle, sectionTitle]}>Risks / Weaknesses</Text>
          </View>
          {data.weaknesses.map((s, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={[styles.bulletDot, { color: "#F59E0B" }]}>!</Text>
              <Text style={[styles.bulletText, { color: t.text }]}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Recommendations */}
      {Array.isArray(data.recommendations) && data.recommendations.length > 0 ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <Lightbulb size={14} color="#9333EA" />
            <Text style={[styles.cardTitle, sectionTitle]}>Recommendations</Text>
          </View>
          {data.recommendations.map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => onAskMore && onAskMore(`Ask more about: ${s}`)}
              activeOpacity={onAskMore ? 0.7 : 1}
              style={styles.bulletRow}
            >
              <Text style={[styles.bulletDot, { color: "#9333EA" }]}>→</Text>
              <Text style={[styles.bulletText, { color: t.text }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Topics + Readability */}
      {(Array.isArray(data.topics) && data.topics.length > 0) ||
      data.readability?.level ? (
        <View style={[styles.card, card]}>
          {Array.isArray(data.topics) && data.topics.length > 0 ? (
            <>
              <View style={styles.rowHeader}>
                <Tag size={14} color={t.textSecondary} />
                <Text style={[styles.cardTitle, sectionTitle]}>Topics</Text>
              </View>
              <View style={styles.topicsWrap}>
                {data.topics.map((tp, i) => (
                  <View
                    key={i}
                    style={[
                      styles.topicPill,
                      {
                        backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                        borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
                      },
                    ]}
                  >
                    <Text style={[styles.topicText, { color: t.textSecondary }]}>{tp}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          {data.readability?.level ? (
            <Text style={[styles.body, sub, { marginTop: 8 }]}>
              Readability: {data.readability.level}
              {data.readability.notes ? ` — ${data.readability.notes}` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}

      <AIActionsBar
        handlers={{
          onAddToNotes,
          onExtractTasks,
          onExport,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  cardTitle: { fontSize: 13, fontWeight: "700" },
  body: { fontSize: 13.5, lineHeight: 20 },
  insightRow: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginTop: 6,
  },
  insightTitle: { fontSize: 13.5, fontWeight: "700", marginBottom: 2 },
  insightDetail: { fontSize: 13, lineHeight: 19 },
  sourceHint: { fontSize: 11.5, marginTop: 3, fontStyle: "italic" },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 },
  bulletDot: { fontWeight: "700", marginTop: 1 },
  bulletText: { fontSize: 13, lineHeight: 19, flex: 1 },
  sentimentIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  topicsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  topicPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  topicText: { fontSize: 11, fontWeight: "600" },
});
