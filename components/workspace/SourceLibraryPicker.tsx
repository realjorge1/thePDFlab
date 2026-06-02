// ============================================
// SourceLibraryPicker — shared modal for choosing library documents.
// Single mode (Smart Notes "Link source") returns one file via onPick.
// Multi mode (Document Studio active sources) toggles via onToggle + selectedUris.
// ============================================

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BookOpen, Check, FileText, Search, X } from "lucide-react-native";

import { useTheme } from "@/services/ThemeProvider";
import type { UnifiedFileRecord } from "@/services/fileIndexService";
import { getLibraryBooks } from "@/services/workspaceInsightsService";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When true, rows stay open for multi-select and show a check. */
  multi?: boolean;
  /** URIs already selected (multi mode). */
  selectedUris?: string[];
  /** Single mode: called with the chosen file (modal closes). */
  onPick?: (file: UnifiedFileRecord) => void;
  /** Multi mode: called when a file is toggled. */
  onToggle?: (file: UnifiedFileRecord) => void;
  title?: string;
}

const TYPE_COLORS: Record<string, string> = {
  pdf: "#DC2626",
  epub: "#7C3AED",
  docx: "#2563EB",
};

export default function SourceLibraryPicker({
  visible,
  onClose,
  multi = false,
  selectedUris = [],
  onPick,
  onToggle,
  title,
}: Props) {
  const { colors: t, mode } = useTheme();
  const [files, setFiles] = useState<UnifiedFileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    getLibraryBooks()
      .then((list) => {
        if (active) setFiles(list);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, query]);

  const selected = useMemo(() => new Set(selectedUris), [selectedUris]);

  const surface = mode === "dark" ? "#0F172A" : "#FFFFFF";
  const field = mode === "dark" ? "#1E293B" : "#F1F5F9";
  const border = mode === "dark" ? "#334155" : "#E2E8F0";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}>
          <View style={styles.header}>
            <BookOpen size={18} color={t.primary} />
            <Text style={[styles.title, { color: t.text }]}>
              {title || (multi ? "Active sources" : "Link a source")}
            </Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={20} color={t.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchRow, { backgroundColor: field, borderColor: border }]}>
            <Search size={16} color={t.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your library…"
              placeholderTextColor={t.textTertiary}
              style={[styles.searchInput, { color: t.text }]}
            />
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={t.primary} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.empty, { color: t.textTertiary }]}>
                {files.length === 0
                  ? "No books or documents in your library yet."
                  : "No matches."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(f) => f.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
              renderItem={({ item }) => {
                const isSel = selected.has(item.uri);
                const color = TYPE_COLORS[item.type] || t.textSecondary;
                return (
                  <TouchableOpacity
                    style={[styles.row, { borderColor: border }, isSel && { backgroundColor: `${t.primary}14` }]}
                    activeOpacity={0.7}
                    onPress={() => {
                      if (multi) onToggle?.(item);
                      else {
                        onPick?.(item);
                        onClose();
                      }
                    }}
                  >
                    <View style={[styles.iconBadge, { backgroundColor: `${color}1F` }]}>
                      <FileText size={15} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowName, { color: t.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.rowMeta, { color: t.textTertiary }]}>
                        {item.type.toUpperCase()}
                        {item.size ? ` · ${formatSize(item.size)}` : ""}
                      </Text>
                    </View>
                    {multi ? (
                      <View
                        style={[
                          styles.check,
                          { borderColor: isSel ? t.primary : border, backgroundColor: isSel ? t.primary : "transparent" },
                        ]}
                      >
                        {isSel ? <Check size={13} color="#FFF" strokeWidth={3} /> : null}
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {multi ? (
            <TouchableOpacity style={[styles.doneBtn, { backgroundColor: t.primary }]} onPress={onClose}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "80%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: "700" },
  closeBtn: { padding: 2 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 14, height: 42 },
  center: { paddingVertical: 40, alignItems: "center" },
  empty: { fontSize: 13.5, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: { fontSize: 14, fontWeight: "600" },
  rowMeta: { fontSize: 11, marginTop: 2, fontWeight: "500" },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  doneText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});
