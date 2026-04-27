// ============================================
// TableRenderer — Smart Data Table for Extract Data
// Consumes: { documentType, fields, rows, columns, notes }
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import {
  ChevronsUpDown,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AIActionsBar } from "./AIActionsBar";

export interface TableData {
  documentType?: string;
  fields?: Record<string, string | number | null>;
  rows?: Array<Record<string, any>>;
  columns?: string[];
  notes?: string;
}

interface Props {
  data: TableData;
  onExport?: (format: "csv" | "excel") => void;
  onAddToNotes?: () => void;
  onExtractTasks?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  resume: "Resume",
  contract: "Contract",
  report: "Report",
  letter: "Letter",
  form: "Form",
  statement: "Statement",
  table: "Tabular Data",
  list: "List",
  other: "Document",
};

function toCsv(rows: Array<Record<string, any>>, columns: string[]): string {
  const head = columns.join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return s.includes(",") || s.includes("\n") || s.includes('"') ? `"${s}"` : s;
      })
      .join(","),
  );
  return [head, ...lines].join("\n");
}

export function TableRenderer({
  data,
  onExport,
  onAddToNotes,
  onExtractTasks,
}: Props) {
  const { colors: t, mode } = useTheme();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const columns: string[] = useMemo(() => {
    if (data.columns && data.columns.length > 0) return data.columns;
    if (data.rows && data.rows.length > 0) return Object.keys(data.rows[0]);
    return [];
  }, [data.columns, data.rows]);

  const sortedRows = useMemo(() => {
    if (!data.rows) return [];
    if (!sortKey) return data.rows;
    const copy = [...data.rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const sa = String(av).toLowerCase();
      const sb = String(bv).toLowerCase();
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return copy;
  }, [data.rows, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const card = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };

  const handleExport = (format: "csv" | "excel") => {
    if (onExport) return onExport(format);
    if (!sortedRows.length || !columns.length) {
      Alert.alert("Export", "No tabular data available to export.");
      return;
    }
    const csv = toCsv(sortedRows, columns);
    // Simple share of text — relies on clipboard fallback
    try {
      const { copyToClipboard } = require("@/services/ai/ai.service");
      copyToClipboard(csv);
      Alert.alert("Copied to clipboard", `CSV for ${sortedRows.length} rows copied — paste into Excel/Sheets.`);
    } catch {
      Alert.alert("Export failed", "Could not export data.");
    }
  };

  const typeLabel = TYPE_LABELS[data.documentType || "other"] || "Data";

  return (
    <View style={styles.wrap}>
      {/* Header badge */}
      <View style={[styles.headerCard, card]}>
        <FileSpreadsheet size={14} color="#10B981" />
        <Text style={[styles.typeLabel, { color: t.text }]}>{typeLabel}</Text>
        {sortedRows.length > 0 ? (
          <Text style={[styles.rowCount, { color: t.textSecondary }]}>
            {sortedRows.length} row{sortedRows.length === 1 ? "" : "s"}
          </Text>
        ) : null}
      </View>

      {/* Fields (scalars) */}
      {data.fields && Object.keys(data.fields).length > 0 ? (
        <View style={[styles.card, card]}>
          <Text style={[styles.sectionTitle, { color: t.text }]}>Details</Text>
          {Object.entries(data.fields).map(([k, v]) => (
            <View key={k} style={styles.fieldRow}>
              <Text style={[styles.fieldKey, { color: t.textSecondary }]}>{humanize(k)}</Text>
              <Text style={[styles.fieldVal, { color: t.text }]} numberOfLines={3}>
                {v === null || v === undefined || v === "" ? "—" : String(v)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Rows table */}
      {sortedRows.length > 0 && columns.length > 0 ? (
        <View style={[styles.card, card, { padding: 0, overflow: "hidden" }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Header row */}
              <View
                style={[
                  styles.tableHeaderRow,
                  {
                    backgroundColor: mode === "dark" ? "#1E293B" : "#F8FAFC",
                    borderBottomColor: mode === "dark" ? "#334155" : "#E2E8F0",
                  },
                ]}
              >
                {columns.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => toggleSort(c)}
                    style={styles.thCell}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.thText, { color: t.text }]} numberOfLines={1}>
                      {humanize(c)}
                    </Text>
                    {sortKey === c ? (
                      sortDir === "asc" ? (
                        <ChevronUp size={12} color={t.textSecondary} />
                      ) : (
                        <ChevronDown size={12} color={t.textSecondary} />
                      )
                    ) : (
                      <ChevronsUpDown size={11} color={t.textTertiary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              {/* Body rows */}
              {sortedRows.map((row, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.tableRow,
                    {
                      borderBottomColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
                      backgroundColor:
                        idx % 2 === 0
                          ? "transparent"
                          : mode === "dark"
                            ? "rgba(255,255,255,0.02)"
                            : "rgba(15,23,42,0.015)",
                    },
                  ]}
                >
                  {columns.map((c) => (
                    <View key={c} style={styles.tdCell}>
                      <Text style={[styles.tdText, { color: t.text }]} numberOfLines={3}>
                        {row[c] === undefined || row[c] === null || row[c] === ""
                          ? "—"
                          : String(row[c])}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {data.notes ? (
        <Text style={[styles.notes, { color: t.textTertiary }]}>{data.notes}</Text>
      ) : null}

      <AIActionsBar
        actions={[
          { id: "csv", label: "Export CSV", icon: FileSpreadsheet, onPress: () => handleExport("csv") },
          { id: "excel", label: "Copy for Excel", icon: FileSpreadsheet, onPress: () => handleExport("excel") },
        ]}
      />
      <AIActionsBar
        handlers={{ onAddToNotes, onExtractTasks }}
      />
    </View>
  );
}

function humanize(k: string): string {
  return k
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const COL_MIN_WIDTH = 110;

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
  },
  typeLabel: { fontSize: 13, fontWeight: "700" },
  rowCount: { fontSize: 12, marginLeft: "auto" },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingVertical: 3 },
  fieldKey: { fontSize: 12, fontWeight: "600", width: 110 },
  fieldVal: { fontSize: 13, flex: 1 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  thCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: COL_MIN_WIDTH,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  thText: { fontSize: 12, fontWeight: "700" },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tdCell: {
    minWidth: COL_MIN_WIDTH,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tdText: { fontSize: 12.5 },
  notes: { fontSize: 11, fontStyle: "italic", marginTop: 2 },
});
