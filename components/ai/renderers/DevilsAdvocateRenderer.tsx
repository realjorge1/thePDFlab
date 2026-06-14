// ============================================
// DevilsAdvocateRenderer — role-aware, document-grounded objections
// Consumes DevilsAdvocateData (see ai.types.ts)
// Tiers: killer objections → secondary challenges → blind spots →
//        format-specific extras → grounded objections → RFP coverage
// ============================================

import { copyToClipboard } from "@/services/ai/ai.service";
import {
  CHALLENGER_ROLES,
  type ChallengerRole,
  type CoverageStatus,
  type DevilsAdvocateData,
  type ObjectionSeverity,
} from "@/services/ai/ai.types";
import { useTheme } from "@/services/ThemeProvider";
import {
  Check,
  Copy,
  EyeOff,
  OctagonAlert,
  Quote,
  ShieldAlert,
  Swords,
  Users,
} from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface Props {
  data: DevilsAdvocateData;
  documentName?: string;
  /** Re-run the analysis as a different challenger. */
  onRerunWithRole?: (role: ChallengerRole, customRole?: string) => void;
  onAddToNotes?: () => void;
}

const SEVERITY_COLORS: Record<ObjectionSeverity, string> = {
  critical: "#DC2626",
  high: "#F59E0B",
  medium: "#64748B",
};

const COVERAGE_COLORS: Record<CoverageStatus, string> = {
  covered: "#10B981",
  missing: "#DC2626",
  partial: "#F59E0B",
};

export function DevilsAdvocateRenderer({
  data,
  documentName,
  onRerunWithRole,
  onAddToNotes,
}: Props) {
  const { colors: t, mode } = useTheme();

  const card = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };

  const handleCopy = () => {
    const lines: string[] = [];
    lines.push(`Devil's Advocate — ${data.detectedRole}`);
    if (documentName) lines.push(documentName);
    lines.push("");
    lines.push("KILLER OBJECTIONS");
    data.killerObjections.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.title}${o.reference ? ` (${o.reference})` : ""}`);
      if (o.detail) lines.push(`   ${o.detail}`);
    });
    if (data.blindSpots?.length) {
      lines.push("");
      lines.push("BLIND SPOTS");
      data.blindSpots.forEach((b) => lines.push(`• ${b.text}${b.why ? ` — ${b.why}` : ""}`));
    }
    copyToClipboard(lines.join("\n"));
  };

  return (
    <View style={styles.wrap}>
      {/* ── Header: swords + role badge ── */}
      <View style={[styles.header, { backgroundColor: mode === "dark" ? "#1C0A0A" : "#FEF2F2", borderColor: mode === "dark" ? "#7F1D1D" : "#FECACA" }]}>
        <View style={[styles.gavelBadge, { backgroundColor: "#DC2626" }]}>
          <Swords size={18} color="#FFF" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: t.text }]}>Devil's Advocate</Text>
          <View style={styles.roleRow}>
            <Users size={12} color="#DC2626" />
            <Text style={[styles.roleText, { color: "#DC2626" }]} numberOfLines={1}>
              {data.detectedRole}
              {data.documentType ? ` · ${data.documentType}` : ""}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleCopy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.copyBtn}>
          <Copy size={15} color={t.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* ── Role selector ── */}
      {onRerunWithRole ? (
        <View>
          <Text style={[styles.selectorLabel, { color: t.textTertiary }]}>WHO WILL READ THIS?</Text>
          <View style={styles.rolePills}>
            {CHALLENGER_ROLES.map((r) => {
              const active = r.key === data.roleKey;
              return (
                <TouchableOpacity
                  key={r.key}
                  onPress={() => onRerunWithRole(r.key)}
                  activeOpacity={0.75}
                  style={[
                    styles.rolePill,
                    {
                      backgroundColor: active ? "#DC2626" : mode === "dark" ? "#1E293B" : "#F1F5F9",
                      borderColor: active ? "#DC2626" : mode === "dark" ? "#334155" : "#E2E8F0",
                    },
                  ]}
                >
                  <Text style={[styles.rolePillText, { color: active ? "#FFF" : t.textSecondary }]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* ── Tier 1: Killer objections ── */}
      <View style={styles.sectionHead}>
        <OctagonAlert size={14} color="#DC2626" />
        <Text style={[styles.sectionTitle, { color: t.text }]}>Killer objections</Text>
        <Text style={[styles.sectionHint, { color: t.textTertiary }]}>the ones that end deals</Text>
      </View>
      {data.killerObjections.map((o, i) => {
        const sev = o.severity ?? "critical";
        const sevColor = SEVERITY_COLORS[sev];
        return (
          <View key={`k${i}`} style={[styles.card, card, { borderLeftWidth: 3, borderLeftColor: sevColor }]}>
            <View style={styles.objRow}>
              <View style={[styles.numBadge, { backgroundColor: sevColor }]}>
                <Text style={styles.numText}>{i + 1}</Text>
              </View>
              <Text style={[styles.objTitle, { color: t.text }]}>{o.title}</Text>
            </View>
            {o.detail ? <Text style={[styles.objDetail, { color: t.textSecondary }]}>{o.detail}</Text> : null}
            <View style={styles.metaRow}>
              <View style={[styles.sevTag, { backgroundColor: `${sevColor}1F` }]}>
                <Text style={[styles.sevTagText, { color: sevColor }]}>{sev.toUpperCase()}</Text>
              </View>
              {o.reference ? <Text style={[styles.refText, { color: t.textTertiary }]}>{o.reference}</Text> : null}
            </View>
          </View>
        );
      })}

      {/* ── Tier 2: Secondary challenges ── */}
      {data.secondaryChallenges?.length ? (
        <>
          <View style={styles.sectionHead}>
            <ShieldAlert size={14} color="#F59E0B" />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Secondary challenges</Text>
          </View>
          <View style={[styles.card, card]}>
            {data.secondaryChallenges.map((o, i) => {
              const sevColor = SEVERITY_COLORS[o.severity ?? "medium"];
              return (
                <View key={`s${i}`} style={[styles.listItem, i > 0 && { borderTopWidth: 1, borderTopColor: card.borderColor }]}>
                  <View style={[styles.dot, { backgroundColor: sevColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listText, { color: t.text }]}>{o.title}</Text>
                    {o.detail ? <Text style={[styles.listSub, { color: t.textTertiary }]}>{o.detail}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/* ── Tier 3: Blind spots ── */}
      {data.blindSpots?.length ? (
        <>
          <View style={styles.sectionHead}>
            <EyeOff size={14} color="#F59E0B" />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Blind spots</Text>
            <Text style={[styles.sectionHint, { color: t.textTertiary }]}>what the document ignores</Text>
          </View>
          {data.blindSpots.map((b, i) => (
            <View key={`b${i}`} style={[styles.card, { backgroundColor: mode === "dark" ? "#1C1407" : "#FFFBEB", borderColor: mode === "dark" ? "#854D0E" : "#FDE68A" }]}>
              <Text style={[styles.blindText, { color: t.text }]}>{b.text}</Text>
              {b.why ? <Text style={[styles.blindWhy, { color: t.textSecondary }]}>{b.why}</Text> : null}
            </View>
          ))}
        </>
      ) : null}

      {/* ── Tier 4: Format-specific extras ── */}
      {data.formatExtras?.length ? (
        <View style={[styles.card, { backgroundColor: mode === "dark" ? "#0B1220" : "#F8FAFC", borderColor: card.borderColor }]}>
          {data.formatExtras.map((f, i) => (
            <View key={`f${i}`} style={i > 0 ? { marginTop: 8 } : undefined}>
              <Text style={[styles.extraLabel, { color: "#0EA5E9" }]}>
                {f.label}{f.location ? ` · ${f.location}` : ""}
              </Text>
              <Text style={[styles.listText, { color: t.text }]}>{f.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Grounded objections (cross-document) ── */}
      {data.groundedObjections?.length ? (
        <>
          <View style={styles.sectionHead}>
            <Quote size={14} color="#9333EA" />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Grounded in your context doc</Text>
          </View>
          {data.groundedObjections.map((g, i) => (
            <View key={`g${i}`} style={[styles.card, card, { borderLeftWidth: 3, borderLeftColor: "#9333EA" }]}>
              <Text style={[styles.objTitle, { color: t.text }]}>{g.claim}</Text>
              <Text style={[styles.objDetail, { color: t.textSecondary }]}>{g.evidence}</Text>
              {g.source ? (
                <View style={[styles.sourceChip, { backgroundColor: mode === "dark" ? "#2E1065" : "#F3E8FF" }]}>
                  <Text style={[styles.sourceChipText, { color: "#9333EA" }]}>{g.source}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {/* ── RFP coverage ── */}
      {data.rfpCoverage?.length ? (
        <>
          <View style={styles.sectionHead}>
            <Check size={14} color="#10B981" />
            <Text style={[styles.sectionTitle, { color: t.text }]}>RFP criteria coverage</Text>
          </View>
          <View style={[styles.card, card]}>
            {data.rfpCoverage.map((c, i) => {
              const cc = COVERAGE_COLORS[c.status];
              return (
                <View key={`c${i}`} style={[styles.listItem, i > 0 && { borderTopWidth: 1, borderTopColor: card.borderColor }]}>
                  <View style={[styles.coverageTag, { backgroundColor: `${cc}1F` }]}>
                    <Text style={[styles.coverageTagText, { color: cc }]}>{c.status}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listText, { color: t.text }]}>{c.criterion}</Text>
                    {c.note ? <Text style={[styles.listSub, { color: t.textTertiary }]}>{c.note}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/* ── Footer actions ── */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={handleCopy} activeOpacity={0.7} style={[styles.footerBtn, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9", borderColor: card.borderColor }]}>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  gavelBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 15, fontWeight: "800" },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  roleText: { fontSize: 12, fontWeight: "700", flexShrink: 1 },
  copyBtn: { padding: 4 },
  selectorLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginBottom: 6, marginTop: 2 },
  rolePills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rolePill: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  rolePillText: { fontSize: 11.5, fontWeight: "600" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" },
  sectionTitle: { fontSize: 13.5, fontWeight: "800" },
  sectionHint: { fontSize: 11, fontStyle: "italic" },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  objRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  numBadge: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  objTitle: { flex: 1, fontSize: 13.5, fontWeight: "700", lineHeight: 19 },
  objDetail: { fontSize: 12.5, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sevTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  sevTagText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  refText: { fontSize: 11, fontWeight: "600" },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  listText: { fontSize: 13, fontWeight: "600", lineHeight: 18, flexShrink: 1 },
  listSub: { fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  blindText: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  blindWhy: { fontSize: 12, lineHeight: 17 },
  extraLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3, marginBottom: 2 },
  sourceChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  sourceChipText: { fontSize: 11, fontWeight: "700" },
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
