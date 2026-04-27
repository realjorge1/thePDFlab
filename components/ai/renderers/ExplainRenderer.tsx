// ============================================
// ExplainRenderer — Adaptive Explain Engine
// Displays explanation output with an in-place mode + depth switcher
// that re-runs the Explain call using the cached original text.
// ============================================

import { explainText } from "@/services/ai/ai.service";
import { useTheme } from "@/services/ThemeProvider";
import {
  Briefcase,
  Cpu,
  Heart,
  Layers,
  List,
  Scale,
  Sparkles,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AIActionsBar } from "./AIActionsBar";

export type ExplainMode =
  | "simple"
  | "professional"
  | "legal"
  | "medical"
  | "technical"
  | "bullet";

export type ExplainDepth = "short" | "medium" | "deep";

interface Props {
  /** Explanation content to display initially */
  content: string;
  /** Original raw text to re-run explain with different modes */
  originalText?: string;
  initialMode?: ExplainMode;
  initialDepth?: ExplainDepth;
  onAddToNotes?: () => void;
  onExport?: () => void;
}

const MODES: Array<{ id: ExplainMode; label: string; Icon: React.ComponentType<any>; color: string }> = [
  { id: "simple", label: "Simple", Icon: Sparkles, color: "#22D3EE" },
  { id: "professional", label: "Pro", Icon: Briefcase, color: "#2563EB" },
  { id: "legal", label: "Legal", Icon: Scale, color: "#F97316" },
  { id: "technical", label: "Tech", Icon: Cpu, color: "#9333EA" },
  { id: "medical", label: "Medical", Icon: Heart, color: "#EF4444" },
  { id: "bullet", label: "Bullets", Icon: List, color: "#10B981" },
];

const DEPTHS: Array<{ id: ExplainDepth; label: string }> = [
  { id: "short", label: "Short" },
  { id: "medium", label: "Medium" },
  { id: "deep", label: "Deep" },
];

export function ExplainRenderer({
  content,
  originalText,
  initialMode = "simple",
  initialDepth = "medium",
  onAddToNotes,
  onExport,
}: Props) {
  const { colors: t, mode: themeMode } = useTheme();
  const [mode, setMode] = useState<ExplainMode>(initialMode);
  const [depth, setDepth] = useState<ExplainDepth>(initialDepth);
  const [text, setText] = useState<string>(content);
  const [loading, setLoading] = useState(false);

  const rerun = async (nextMode: ExplainMode, nextDepth: ExplainDepth) => {
    if (!originalText) return;
    setLoading(true);
    setMode(nextMode);
    setDepth(nextDepth);
    try {
      const res = await explainText(originalText, nextMode, nextDepth);
      setText(res.content);
    } catch (e: any) {
      setText(`Could not re-run explanation: ${e?.message || "unknown error"}.`);
    } finally {
      setLoading(false);
    }
  };

  const card = {
    backgroundColor: themeMode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: themeMode === "dark" ? "#334155" : "#E2E8F0",
  };

  const canSwitch = !!originalText;

  return (
    <View style={styles.wrap}>
      {/* Mode switcher */}
      <View style={[styles.card, card]}>
        <Text style={[styles.label, { color: t.textSecondary }]}>Explanation mode</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {MODES.map((m) => {
            const active = m.id === mode;
            const Icon = m.Icon;
            return (
              <TouchableOpacity
                key={m.id}
                disabled={!canSwitch || loading}
                onPress={() => rerun(m.id, depth)}
                activeOpacity={0.75}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active
                      ? `${m.color}22`
                      : themeMode === "dark"
                        ? "#1E293B"
                        : "#F8FAFC",
                    borderColor: active ? m.color : themeMode === "dark" ? "#334155" : "#E2E8F0",
                  },
                  !canSwitch && { opacity: 0.5 },
                ]}
              >
                <Icon size={12} color={active ? m.color : t.textSecondary} />
                <Text
                  style={{
                    fontSize: 11.5,
                    fontWeight: "700",
                    color: active ? m.color : t.textSecondary,
                  }}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[styles.label, { color: t.textSecondary, marginTop: 8 }]}>Depth</Text>
        <View style={styles.depthRow}>
          {DEPTHS.map((d) => {
            const active = d.id === depth;
            return (
              <TouchableOpacity
                key={d.id}
                disabled={!canSwitch || loading}
                onPress={() => rerun(mode, d.id)}
                activeOpacity={0.75}
                style={[
                  styles.depthBtn,
                  {
                    backgroundColor: active ? "#9333EA" : themeMode === "dark" ? "#1E293B" : "#F8FAFC",
                    borderColor: active ? "#9333EA" : themeMode === "dark" ? "#334155" : "#E2E8F0",
                  },
                  !canSwitch && { opacity: 0.5 },
                ]}
              >
                <Layers size={12} color={active ? "#FFF" : t.textSecondary} />
                <Text
                  style={{
                    fontSize: 11.5,
                    fontWeight: "700",
                    color: active ? "#FFFFFF" : t.textSecondary,
                  }}
                >
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!canSwitch ? (
          <Text style={{ color: t.textTertiary, fontSize: 10.5, marginTop: 4 }}>
            Tip: re-run Explain from a selection to unlock mode switching.
          </Text>
        ) : null}
      </View>

      {/* Explanation body */}
      <View style={[styles.card, card]}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#9333EA" />
            <Text style={{ color: t.textSecondary, fontStyle: "italic" }}>
              Re-explaining in {mode} mode…
            </Text>
          </View>
        ) : (
          <Text style={[styles.body, { color: t.text }]}>{text}</Text>
        )}
      </View>

      <AIActionsBar handlers={{ onAddToNotes, onExport }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  chipRow: { flexDirection: "row", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  depthRow: { flexDirection: "row", gap: 6 },
  depthBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  body: { fontSize: 13.5, lineHeight: 21 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 6 },
});
