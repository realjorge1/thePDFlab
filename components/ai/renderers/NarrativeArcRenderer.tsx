// ============================================
// NarrativeArcRenderer — detected-type + arc-flow verdict + suggested reorder
// Consumes NarrativeArcData (see ai.types.ts)
// Tiers: verdict banner → ideal-vs-detected arc → diagnosis →
//        suggested reorder (copy, no auto-apply) → RFP coverage
// ============================================

import { copyToClipboard } from "@/services/ai/ai.service";
import type {
  ArcSectionStatus,
  ArcVerdict,
  CoverageStatus,
  NarrativeArcData,
} from "@/services/ai/ai.types";
import { useTheme } from "@/services/ThemeProvider";
import {
  ArrowRight,
  Check,
  CircleX,
  Copy,
  Stethoscope,
  TriangleAlert,
  Waypoints,
} from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface Props {
  data: NarrativeArcData;
  documentName?: string;
  onAddToNotes?: () => void;
}

const VERDICT_META: Record<
  ArcVerdict,
  { label: string; color: string; bgLight: string; bgDark: string; borderLight: string; borderDark: string }
> = {
  strong: { label: "Strong arc", color: "#10B981", bgLight: "#ECFDF5", bgDark: "#052E1B", borderLight: "#A7F3D0", borderDark: "#065F46" },
  weak: { label: "Weak arc", color: "#F59E0B", bgLight: "#FFFBEB", bgDark: "#1C1407", borderLight: "#FDE68A", borderDark: "#854D0E" },
  broken: { label: "Broken arc", color: "#DC2626", bgLight: "#FEF2F2", bgDark: "#1C0A0A", borderLight: "#FECACA", borderDark: "#7F1D1D" },
};

const SECTION_STATUS_COLORS: Record<ArcSectionStatus, string> = {
  ok: "#10B981",
  misplaced: "#F59E0B",
  missing: "#DC2626",
  extra: "#64748B",
};

const COVERAGE_COLORS: Record<CoverageStatus, string> = {
  covered: "#10B981",
  missing: "#DC2626",
  partial: "#F59E0B",
};

export function NarrativeArcRenderer({ data, documentName, onAddToNotes }: Props) {
  const { colors: t, mode } = useTheme();
  const v = VERDICT_META[data.verdict];

  const card = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };

  const VerdictIcon = data.verdict === "strong" ? Check : data.verdict === "weak" ? TriangleAlert : CircleX;

  const handleCopyReorder = () => {
    const lines: string[] = [];
    lines.push(`Narrative Arc — ${data.detectedType} (${v.label})`);
    if (documentName) lines.push(documentName);
    lines.push("");
    lines.push(data.verdictLine);
    if (data.reorder?.length) {
      lines.push("");
      lines.push("SUGGESTED REORDER");
      data.reorder.forEach((r, i) => lines.push(`${i + 1}. ${r.instruction}`));
    }
    copyToClipboard(lines.join("\n"));
  };

  return (
    <View style={styles.wrap}>
      {/* ── Tier 1: Verdict banner ── */}
      <View
        style={[
          styles.banner,
          {
            backgroundColor: mode === "dark" ? v.bgDark : v.bgLight,
            borderColor: mode === "dark" ? v.borderDark : v.borderLight,
          },
        ]}
      >
        <View style={[styles.verdictBadge, { backgroundColor: v.color }]}>
          <VerdictIcon size={18} color="#FFF" strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.bannerTopRow}>
            <Text style={[styles.verdictLabel, { color: v.color }]}>{v.label}</Text>
            <View style={[styles.typePill, { backgroundColor: `${v.color}1F` }]}>
              <Waypoints size={11} color={v.color} />
              <Text style={[styles.typePillText, { color: v.color }]}>{data.detectedType}</Text>
            </View>
          </View>
          <Text style={[styles.verdictLine, { color: t.text }]}>{data.verdictLine}</Text>
        </View>
      </View>

      {/* ── Ideal-vs-detected arc strip ── */}
      {data.idealStructure?.length ? (
        <View style={[styles.card, card]}>
          <Text style={[styles.miniLabel, { color: t.textTertiary }]}>IDEAL ARC FOR A {data.detectedType.toUpperCase()}</Text>
          <View style={styles.arcRow}>
            {data.idealStructure.map((s, i) => (
              <React.Fragment key={`i${i}`}>
                <View style={[styles.idealChip, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9", borderColor: card.borderColor }]}>
                  <Text style={[styles.idealChipText, { color: t.textSecondary }]}>{s}</Text>
                </View>
                {i < data.idealStructure!.length - 1 ? (
                  <ArrowRight size={12} color={t.textTertiary} style={styles.arcArrow} />
                ) : null}
              </React.Fragment>
            ))}
          </View>
        </View>
      ) : null}

      {/* ── Detected order ── */}
      {data.detectedSections?.length ? (
        <View style={[styles.card, card]}>
          <Text style={[styles.miniLabel, { color: t.textTertiary }]}>YOUR ORDER</Text>
          {data.detectedSections.map((s, i) => {
            const sc = SECTION_STATUS_COLORS[s.status];
            return (
              <View key={`d${i}`} style={[styles.secItem, i > 0 && { borderTopWidth: 1, borderTopColor: card.borderColor }]}>
                <View style={[styles.secIndex, { backgroundColor: `${sc}1F` }]}>
                  <Text style={[styles.secIndexText, { color: sc }]}>{s.index}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.secTitle, { color: t.text }]}>{s.title}</Text>
                  {s.role ? <Text style={[styles.secRole, { color: t.textTertiary }]}>{s.role}</Text> : null}
                </View>
                {s.status !== "ok" ? (
                  <View style={[styles.statusTag, { backgroundColor: `${sc}1F` }]}>
                    <Text style={[styles.statusTagText, { color: sc }]}>{s.status}</Text>
                  </View>
                ) : (
                  <Check size={15} color={sc} />
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* ── Tier 2: Diagnosis ── */}
      {data.diagnosis ? (
        <View style={[styles.card, card]}>
          <View style={styles.sectionHead}>
            <Stethoscope size={14} color={v.color} />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Diagnosis</Text>
          </View>
          <Text style={[styles.diagnosis, { color: t.textSecondary }]}>{data.diagnosis}</Text>
        </View>
      ) : null}

      {/* ── Tier 3: Suggested reorder ── */}
      {data.reorder?.length ? (
        <View style={[styles.card, card, { borderLeftWidth: 3, borderLeftColor: v.color }]}>
          <View style={styles.reorderHead}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>
              {data.editable ? "Suggested reorder" : "Recommendations"}
            </Text>
            <TouchableOpacity onPress={handleCopyReorder} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.copyInline}>
              <Copy size={13} color={t.textTertiary} />
              <Text style={[styles.copyInlineText, { color: t.textTertiary }]}>Copy</Text>
            </TouchableOpacity>
          </View>
          {data.reorder.map((r, i) => (
            <View key={`r${i}`} style={styles.reorderItem}>
              <View style={[styles.reorderNum, { backgroundColor: v.color }]}>
                <Text style={styles.reorderNumText}>{i + 1}</Text>
              </View>
              <Text style={[styles.reorderText, { color: t.text }]}>{r.instruction}</Text>
            </View>
          ))}
          {!data.editable ? (
            <Text style={[styles.pdfNote, { color: t.textTertiary }]}>
              PDFs can't be reordered in-app — use these as a checklist when you revise the source.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── RFP coverage (cross-document) ── */}
      {data.rfpCoverage?.length ? (
        <View style={[styles.card, card]}>
          <Text style={[styles.miniLabel, { color: t.textTertiary }]}>DOES YOUR RESPONSE MIRROR THE RFP?</Text>
          {data.rfpCoverage.map((c, i) => {
            const cc = COVERAGE_COLORS[c.status];
            return (
              <View key={`c${i}`} style={[styles.secItem, i > 0 && { borderTopWidth: 1, borderTopColor: card.borderColor }]}>
                <View style={[styles.coverageTag, { backgroundColor: `${cc}1F` }]}>
                  <Text style={[styles.coverageTagText, { color: cc }]}>{c.status}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.secTitle, { color: t.text }]}>{c.criterion}</Text>
                  {c.note ? <Text style={[styles.secRole, { color: t.textTertiary }]}>{c.note}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* ── Footer actions ── */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={handleCopyReorder} activeOpacity={0.7} style={[styles.footerBtn, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9", borderColor: card.borderColor }]}>
          <Copy size={13} color={t.textSecondary} />
          <Text style={[styles.footerBtnText, { color: t.textSecondary }]}>Copy</Text>
        </TouchableOpacity>
        {onAddToNotes ? (
          <TouchableOpacity onPress={onAddToNotes} activeOpacity={0.7} style={[styles.footerBtn, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9", borderColor: card.borderColor }]}>
            <Text style={[styles.footerBtnText, { color: t.textSecondary }]}>Save to Workspace</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  verdictBadge: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  bannerTopRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 },
  verdictLabel: { fontSize: 15, fontWeight: "800" },
  typePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  typePillText: { fontSize: 11, fontWeight: "700" },
  verdictLine: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  miniLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  arcRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, marginTop: 2 },
  idealChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  idealChipText: { fontSize: 11.5, fontWeight: "700" },
  arcArrow: { marginHorizontal: 1 },
  secItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  secIndex: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  secIndexText: { fontSize: 11, fontWeight: "800" },
  secTitle: { fontSize: 13, fontWeight: "700" },
  secRole: { fontSize: 11, marginTop: 1 },
  statusTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  statusTagText: { fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 13.5, fontWeight: "800" },
  diagnosis: { fontSize: 12.5, lineHeight: 19 },
  reorderHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  copyInline: { flexDirection: "row", alignItems: "center", gap: 4 },
  copyInlineText: { fontSize: 11.5, fontWeight: "600" },
  reorderItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 2 },
  reorderNum: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  reorderNumText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  reorderText: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 19 },
  pdfNote: { fontSize: 11.5, fontStyle: "italic", lineHeight: 16, marginTop: 4 },
  coverageTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, minWidth: 58, alignItems: "center" },
  coverageTagText: { fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  footer: { flexDirection: "row", gap: 8, marginTop: 6 },
  footerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  footerBtnText: { fontSize: 12.5, fontWeight: "700" },
});
