/**
 * Gozlin Insights — the premium, online "go deeper" layer for a QC result.
 *
 * The offline engine already gives the exact numbers instantly. Insights sends
 * a compact summary to the Gozlin AI backend for an expert read: what the
 * result means, likely causes, the Westgard-rule / QC strategy and next steps.
 *
 * Gated by the existing premium subscription (`useSubscription().isPremium`)
 * and needs internet. Non-premium users see an upsell; offline/backend errors
 * degrade gracefully with a retry.
 */
import { useSubscription } from "@/context/SubscriptionContext";
import { sendChat } from "@/services/ai/ai.service";
import { useTheme } from "@/services/ThemeProvider";
import { deepStripMarkdown } from "@/utils/sanitizeAiText";
import { useRouter } from "expo-router";
import { Lock, Sparkles } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface QCInsightsProps {
  /** Human tool name, e.g. "Six Sigma Calculator". */
  toolName: string;
  /** Tool accent for the card identity. */
  accent: string;
  /**
   * Compact plain-text summary of the inputs + result (typically
   * `toCopyText(title, model)`). Null when there's no result yet — the card
   * hides itself.
   */
  context: string | null;
}

export function QCInsights({ toolName, accent, context }: QCInsightsProps) {
  const { colors: t } = useTheme();
  const { isPremium } = useSubscription();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!context) return;
    setLoading(true);
    setError(null);
    setInsight(null);
    try {
      const prompt =
        `You are a clinical laboratory quality-control expert. A medical ` +
        `laboratory scientist just ran the "${toolName}" (Westgard / Six Sigma ` +
        `QC) calculation below.\n\n${context}\n\nGive a concise, practical ` +
        `interpretation: what this result means for the assay, the likely ` +
        `causes if performance is marginal or poor, the recommended Westgard ` +
        `multirule QC strategy (rules and N), and clear next steps. Prefer ` +
        `short paragraphs or bullet points. Do not simply restate the numbers.`;
      const res = await sendChat(prompt, []);
      const clean = deepStripMarkdown(res.content)?.trim();
      if (!clean) throw new Error("Gozlin returned an empty response.");
      setInsight(clean);
    } catch (e: any) {
      setError(
        e?.message?.includes("network") || e?.message?.includes("fetch")
          ? "Couldn't reach Gozlin. Check your connection and try again."
          : e?.message || "Couldn't generate insights. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [context, toolName]);

  // No result yet — nothing to interpret.
  if (!context) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.card, borderColor: accent },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Sparkles size={16} color={accent} />
          <Text style={[styles.title, { color: t.text }]}>Gozlin Insights</Text>
        </View>
        <View style={[styles.tag, { backgroundColor: accent }]}>
          <Text style={styles.tagText}>PREMIUM · ONLINE</Text>
        </View>
      </View>

      {!isPremium ? (
        <>
          <Text style={[styles.body, { color: t.textSecondary }]}>
            Get an expert read on this result — likely causes, the Westgard-rule
            QC strategy and clear next steps. The offline calculation above is
            always free; Insights uses Gozlin AI and needs Premium + internet.
          </Text>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: accent }]}
            onPress={() => router.push("/premium" as any)}
            accessibilityRole="button"
            accessibilityLabel="Unlock Gozlin Premium"
          >
            <Lock size={15} color="#FFFFFF" />
            <Text style={styles.ctaText}>Unlock Gozlin Premium</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {!insight && !loading ? (
            <Text style={[styles.body, { color: t.textSecondary }]}>
              Ask Gozlin for an expert interpretation, likely causes and the
              recommended QC strategy for this result.
            </Text>
          ) : null}

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={accent} />
              <Text style={[styles.loadingText, { color: t.textSecondary }]}>
                Gozlin is analysing your result…
              </Text>
            </View>
          ) : null}

          {insight ? (
            <Text style={[styles.insight, { color: t.text }]}>{insight}</Text>
          ) : null}

          {error ? (
            <Text style={[styles.error, { color: t.error }]}>{error}</Text>
          ) : null}

          {!loading ? (
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: accent }]}
              onPress={run}
              accessibilityRole="button"
              accessibilityLabel={
                insight ? "Regenerate Gozlin insight" : "Get expert insight"
              }
            >
              <Sparkles size={15} color="#FFFFFF" />
              <Text style={styles.ctaText}>
                {insight ? "Regenerate insight" : "Get expert insight"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  loadingText: {
    fontSize: 13,
  },
  insight: {
    fontSize: 13.5,
    lineHeight: 21,
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    marginBottom: 12,
  },
});
