// ============================================
// ClassifyRenderer — Auto-Organize System display
// Consumes: { type, confidence, suggestedFilename, summary, keyEntities[] }
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import {
  FileSignature,
  FolderOpen,
  ScanSearch,
  Sparkles,
  Tag,
} from "lucide-react-native";
import React from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AIActionsBar } from "./AIActionsBar";

export interface ClassifyData {
  type?: string;
  confidence?: number;
  suggestedFilename?: string;
  summary?: string;
  keyEntities?: string[];
}

interface Props {
  data: ClassifyData;
  documentName?: string;
  onRenameFile?: (filename: string) => void;
  onMoveToFolder?: (folder: string) => void;
  onToggleAutoSort?: (enabled: boolean) => void;
  autoSortEnabled?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  invoice: "#10B981",
  receipt: "#10B981",
  resume: "#6366F1",
  contract: "#F97316",
  agreement: "#F97316",
  report: "#2563EB",
  research_paper: "#2563EB",
  letter: "#9333EA",
  form: "#14B8A6",
  proposal: "#F59E0B",
  manual: "#64748B",
  financial_statement: "#10B981",
  other: "#64748B",
};

const SMART_FOLDERS: Record<string, string> = {
  invoice: "Invoices",
  receipt: "Invoices",
  financial_statement: "Invoices",
  contract: "Contracts",
  agreement: "Contracts",
  proposal: "Contracts",
  report: "Reports",
  research_paper: "Reports",
  resume: "Resumes",
  letter: "Letters",
  form: "Forms",
  manual: "Manuals",
  other: "General",
};

export function ClassifyRenderer({
  data,
  documentName,
  onRenameFile,
  onMoveToFolder,
  onToggleAutoSort,
  autoSortEnabled,
}: Props) {
  const { colors: t, mode } = useTheme();
  const typeKey = (data.type || "other").toLowerCase();
  const typeColor = TYPE_COLORS[typeKey] ?? TYPE_COLORS.other;
  const folder = SMART_FOLDERS[typeKey] ?? "General";
  const confidence = Math.max(0, Math.min(100, data.confidence || 0));

  const card = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };

  return (
    <View style={styles.wrap}>
      {/* Type + confidence */}
      <View style={[styles.card, card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
        <View style={[styles.typeBadge, { backgroundColor: `${typeColor}22` }]}>
          <ScanSearch size={16} color={typeColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.typeLabel, { color: t.text }]}>
            {humanize(data.type || "Other")}
          </Text>
          <Text style={[styles.subtle, { color: t.textSecondary }]}>
            Confidence: {confidence}%
          </Text>
        </View>
        <View style={[styles.confidenceBar, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}>
          <View
            style={[
              styles.confidenceFill,
              { width: `${confidence}%`, backgroundColor: typeColor },
            ]}
          />
        </View>
      </View>

      {/* Summary */}
      {data.summary ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <Sparkles size={13} color="#9333EA" />
            <Text style={[styles.cardTitle, { color: t.text }]}>Summary</Text>
          </View>
          <Text style={[styles.body, { color: t.text }]}>{data.summary}</Text>
        </View>
      ) : null}

      {/* Rename suggestion */}
      {data.suggestedFilename ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <FileSignature size={13} color="#2563EB" />
            <Text style={[styles.cardTitle, { color: t.text }]}>Suggested filename</Text>
          </View>
          <View style={styles.renameRow}>
            <View
              style={[
                styles.filenameBox,
                {
                  backgroundColor: mode === "dark" ? "#1E293B" : "#F8FAFC",
                  borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
                },
              ]}
            >
              <Text style={[styles.filenameText, { color: t.text }]} numberOfLines={1}>
                {data.suggestedFilename}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.smallBtn, { backgroundColor: "#2563EB" }]}
              onPress={() =>
                onRenameFile
                  ? onRenameFile(data.suggestedFilename!)
                  : Alert.alert("Rename", `File will be renamed to ${data.suggestedFilename}.`)
              }
              activeOpacity={0.8}
            >
              <Text style={styles.smallBtnText}>Rename</Text>
            </TouchableOpacity>
          </View>
          {documentName ? (
            <Text style={[styles.subtle, { color: t.textTertiary, marginTop: 4 }]} numberOfLines={1}>
              Current: {documentName}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Smart folder */}
      <View style={[styles.card, card]}>
        <View style={styles.rowHeader}>
          <FolderOpen size={13} color="#F59E0B" />
          <Text style={[styles.cardTitle, { color: t.text }]}>Smart folder</Text>
        </View>
        <View style={styles.renameRow}>
          <View
            style={[
              styles.filenameBox,
              {
                backgroundColor: mode === "dark" ? "#1E293B" : "#FEF3C7",
                borderColor: mode === "dark" ? "#334155" : "#FDE68A",
              },
            ]}
          >
            <Text style={[styles.filenameText, { color: t.text }]}>{folder}</Text>
          </View>
          <TouchableOpacity
            style={[styles.smallBtn, { backgroundColor: "#F59E0B" }]}
            onPress={() =>
              onMoveToFolder
                ? onMoveToFolder(folder)
                : Alert.alert("Move to folder", `File will be moved to "${folder}".`)
            }
            activeOpacity={0.8}
          >
            <Text style={styles.smallBtnText}>Move</Text>
          </TouchableOpacity>
        </View>
        {onToggleAutoSort ? (
          <TouchableOpacity
            style={[
              styles.autoSortRow,
              {
                backgroundColor: autoSortEnabled
                  ? "rgba(16,185,129,0.12)"
                  : mode === "dark"
                    ? "#1E293B"
                    : "#F8FAFC",
                borderColor: autoSortEnabled
                  ? "#10B981"
                  : mode === "dark"
                    ? "#334155"
                    : "#E2E8F0",
              },
            ]}
            onPress={() => onToggleAutoSort(!autoSortEnabled)}
            activeOpacity={0.75}
          >
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: "600",
                color: autoSortEnabled ? "#10B981" : t.textSecondary,
              }}
            >
              {autoSortEnabled
                ? "✓ Auto-rename & auto-sort enabled on upload"
                : "Enable auto-rename & auto-sort on upload"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Key entities */}
      {Array.isArray(data.keyEntities) && data.keyEntities.length > 0 ? (
        <View style={[styles.card, card]}>
          <View style={styles.rowHeader}>
            <Tag size={13} color={t.textSecondary} />
            <Text style={[styles.cardTitle, { color: t.text }]}>Key entities</Text>
          </View>
          <View style={styles.entitiesWrap}>
            {data.keyEntities.map((e, i) => (
              <View
                key={i}
                style={[
                  styles.entityPill,
                  {
                    backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
                  },
                ]}
              >
                <Text style={{ fontSize: 11, color: t.textSecondary, fontWeight: "600" }}>
                  {e}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function humanize(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  cardTitle: { fontSize: 13, fontWeight: "700" },
  typeBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  typeLabel: { fontSize: 14, fontWeight: "700" },
  subtle: { fontSize: 11 },
  body: { fontSize: 13, lineHeight: 19 },
  confidenceBar: {
    width: 60,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  confidenceFill: { height: "100%" },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  filenameBox: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  filenameText: { fontSize: 12.5, fontWeight: "600" },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  smallBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  autoSortRow: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  entitiesWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  entityPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
});
