// ============================================
// ProgressDashboard — the WorkSpace "Progress" tab.
// Real activity metrics (books, documents created, reading time, AI usage,
// notes) plus on-demand personalized AI suggestions.
// ============================================

import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Lightbulb,
  StickyNote,
  Zap,
} from "lucide-react-native";

import {
  formatReadingTime,
  getInsights,
  subscribeInsights,
  type WorkspaceInsights,
} from "@/services/workspaceInsightsService";
import { personalizedSuggestions } from "@/components/workspace/aiActions";

const ACCENT = "#9333EA";

export default function ProgressDashboard({ mode, t }: { mode: "light" | "dark"; t: any }) {
  const router = useRouter();
  const [insights, setInsights] = useState<WorkspaceInsights | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const refresh = useCallback(() => {
    getInsights()
      .then(setInsights)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeInsights(refresh);
    return unsub;
  }, [refresh]);

  const getSuggestions = useCallback(async () => {
    if (!insights || suggesting) return;
    setSuggesting(true);
    try {
      const s = await personalizedSuggestions(insights);
      setSuggestions(s.length ? s : ["Keep reading and taking notes — I'll have tips as your activity grows."]);
    } catch {
      setSuggestions(["Couldn't reach the AI just now. Try again in a moment."]);
    } finally {
      setSuggesting(false);
    }
  }, [insights, suggesting]);

  if (!insights) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  const surface = mode === "dark" ? "#0F172A" : "#FFFFFF";
  const border = mode === "dark" ? "#334155" : "#E2E8F0";

  const cards = [
    { Icon: CheckCircle2, color: "#10B981", value: String(insights.booksCompleted), label: "Books read" },
    { Icon: BookOpen, color: "#2563EB", value: String(insights.booksInProgress), label: "In progress" },
    { Icon: FileText, color: "#F59E0B", value: String(insights.documentsCreated), label: "Docs created" },
    { Icon: Clock, color: "#06B6D4", value: formatReadingTime(insights.readingTimeMs), label: "Reading time" },
    { Icon: Zap, color: ACCENT, value: String(insights.aiInteractions), label: "AI interactions" },
    { Icon: StickyNote, color: "#6366F1", value: String(insights.notesCount), label: "Notes" },
  ];

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <Text style={[styles.sectionTitle, { color: t.text }]}>Your activity</Text>

      <View style={styles.grid}>
        {cards.map((c) => (
          <View key={c.label} style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.cardAccent, { backgroundColor: c.color }]} />
            <c.Icon size={22} color={c.color} strokeWidth={2.1} />
            <View style={styles.cardText}>
              <Text style={[styles.cardValue, { color: t.text }]} numberOfLines={1}>{c.value}</Text>
              <Text style={[styles.cardLabel, { color: t.textTertiary }]} numberOfLines={1}>{c.label}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.weekStrip, { backgroundColor: surface, borderColor: border }]}>
        <Zap size={14} color={ACCENT} />
        <Text style={[styles.weekText, { color: t.textSecondary }]}>
          {insights.aiInteractionsThisWeek} AI interaction{insights.aiInteractionsThisWeek === 1 ? "" : "s"} this week ·{" "}
          {insights.notesWords.toLocaleString()} words in notes
        </Text>
      </View>

      {insights.recentBooks.length > 0 ? (
        <>
          <Text style={[styles.sectionTitle, { color: t.text, marginTop: 20 }]}>Recently reading</Text>
          {insights.recentBooks.map((b) => (
            <TouchableOpacity
              key={b.uri}
              activeOpacity={0.7}
              onPress={() =>
                router.push({
                  pathname: (b.type === "epub" ? "/epub-viewer" : b.type === "docx" ? "/docx-viewer" : "/pdf-viewer") as any,
                  params: { uri: b.uri, name: b.name },
                })
              }
              style={[styles.bookRow, { backgroundColor: surface, borderColor: border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.bookName, { color: t.text }]} numberOfLines={1}>
                  {b.name.replace(/\.[a-z0-9]+$/i, "")}
                </Text>
                <View style={[styles.bookTrack, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}>
                  <View style={[styles.bookFill, { width: `${Math.round(b.progress * 100)}%` }]} />
                </View>
              </View>
              <Text style={[styles.bookPct, { color: t.textSecondary }]}>{Math.round(b.progress * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      <View style={[styles.suggestCard, { backgroundColor: surface, borderColor: border }]}>
        <View style={styles.suggestHeader}>
          <Lightbulb size={16} color={ACCENT} />
          <Text style={[styles.suggestTitle, { color: t.text }]}>Personalized suggestions</Text>
        </View>
        {suggestions ? (
          suggestions.map((s, i) => (
            <View key={i} style={styles.suggestItem}>
              <Text style={[styles.suggestBullet, { color: ACCENT }]}>•</Text>
              <Text style={[styles.suggestText, { color: t.textSecondary }]}>{s}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.suggestEmpty, { color: t.textTertiary }]}>
            Get AI tips on what to read or write next, based on your activity.
          </Text>
        )}
        <TouchableOpacity
          onPress={getSuggestions}
          disabled={suggesting}
          style={[styles.suggestBtn, { backgroundColor: ACCENT, opacity: suggesting ? 0.6 : 1 }]}
        >
          {suggesting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.suggestBtnText}>{suggestions ? "Refresh suggestions" : "Get suggestions"}</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { paddingVertical: 14 },
  sectionTitle: { fontSize: 15, fontWeight: "800", marginBottom: 12, letterSpacing: -0.2 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  card: {
    width: "48.5%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 16,
    paddingLeft: 18,
    paddingRight: 14,
    overflow: "hidden",
  },
  // Thin solid colour rail at the card's leading edge (no glow / tint).
  cardAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardText: { flex: 1, gap: 2 },
  cardValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  cardLabel: { fontSize: 11.5, fontWeight: "600" },

  weekStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  weekText: { fontSize: 12.5, fontWeight: "600", flex: 1, lineHeight: 17 },

  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  bookName: { fontSize: 13.5, fontWeight: "600", marginBottom: 7 },
  bookTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  bookFill: { height: 6, borderRadius: 3, backgroundColor: ACCENT },
  bookPct: { fontSize: 12, fontWeight: "700" },

  suggestCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 20 },
  suggestHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  suggestTitle: { fontSize: 14.5, fontWeight: "700" },
  suggestItem: { flexDirection: "row", gap: 8, marginBottom: 8 },
  suggestBullet: { fontSize: 15, lineHeight: 19, fontWeight: "800" },
  suggestText: { flex: 1, fontSize: 13, lineHeight: 19 },
  suggestEmpty: { fontSize: 12.5, lineHeight: 18, marginBottom: 4 },
  suggestBtn: { borderRadius: 11, paddingVertical: 11, alignItems: "center", marginTop: 8 },
  suggestBtnText: { color: "#FFF", fontWeight: "700", fontSize: 13.5 },
});
