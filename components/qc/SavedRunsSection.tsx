/**
 * Save/reopen section shared by every QC calculator screen.
 * Persists runs offline via qcCalcHistoryService; reopening a run hands the
 * saved input state back to the tool, which recalculates instantly on-device.
 */
import type { QcToolId } from "@/constants/qcTools";
import {
  deleteRun,
  getSavedRuns,
  saveRun,
  type SavedQcRun,
} from "@/services/qcCalcHistoryService";
import { useTheme } from "@/services/ThemeProvider";
import { History, Save, Trash2 } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

interface SavedRunsSectionProps {
  tool: QcToolId;
  /** Set after a successful calculation; enables the Save button. */
  currentRun: { inputs: Record<string, string>; summary: string } | null;
  /** Restore a saved run's input state (the tool recalculates from it). */
  onRestore: (inputs: Record<string, string>) => void;
}

export function SavedRunsSection({
  tool,
  currentRun,
  onRestore,
}: SavedRunsSectionProps) {
  const { colors: t } = useTheme();
  const [runs, setRuns] = useState<SavedQcRun[]>([]);
  const [label, setLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSavedRuns(tool).then((saved) => {
      if (!cancelled) setRuns(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [tool]);

  const handleSave = useCallback(async () => {
    if (!currentRun) return;
    const run = await saveRun({
      tool,
      label,
      inputs: currentRun.inputs,
      summary: currentRun.summary,
    });
    setRuns((prev) => [run, ...prev]);
    setLabel("");
  }, [currentRun, label, tool]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteRun(id);
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return (
    <View
      style={[styles.section, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <View style={styles.titleRow}>
        <History size={15} color={t.textTertiary} />
        <Text style={[styles.title, { color: t.textSecondary }]}>
          Saved calculations
        </Text>
      </View>

      <View style={styles.saveRow}>
        <TextInput
          style={[
            styles.labelInput,
            {
              backgroundColor: t.background,
              borderColor: t.border,
              color: t.text,
            },
          ]}
          value={label}
          onChangeText={setLabel}
          placeholder="Label (analyte / instrument, optional)"
          placeholderTextColor={t.textTertiary}
          accessibilityLabel="Label for saved calculation"
        />
        <TouchableOpacity
          style={[
            styles.saveBtn,
            { backgroundColor: currentRun ? t.primary : t.border },
          ]}
          onPress={handleSave}
          disabled={!currentRun}
          accessibilityRole="button"
          accessibilityLabel="Save calculation"
        >
          <Save size={16} color={currentRun ? t.textInverse : t.textTertiary} />
          <Text
            style={[
              styles.saveBtnText,
              { color: currentRun ? t.textInverse : t.textTertiary },
            ]}
          >
            Save
          </Text>
        </TouchableOpacity>
      </View>
      {!currentRun ? (
        <Text style={[styles.hint, { color: t.textTertiary }]}>
          Run a calculation first, then save it here.
        </Text>
      ) : null}

      {runs.map((run) => (
        <View
          key={run.id}
          style={[styles.runRow, { borderTopColor: t.separator }]}
        >
          <TouchableOpacity
            style={styles.runBody}
            onPress={() => onRestore(run.inputs)}
            accessibilityRole="button"
            accessibilityLabel={`Reopen saved calculation${run.label ? ` ${run.label}` : ""}`}
          >
            <Text style={[styles.runTitle, { color: t.text }]} numberOfLines={1}>
              {run.label || run.summary}
            </Text>
            <Text
              style={[styles.runMeta, { color: t.textTertiary }]}
              numberOfLines={1}
            >
              {new Date(run.createdAt).toLocaleString()}
              {run.label ? ` · ${run.summary}` : ""}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(run.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete saved calculation"
          >
            <Trash2 size={16} color={t.textTertiary} />
          </TouchableOpacity>
        </View>
      ))}
      {runs.length === 0 ? (
        <Text style={[styles.hint, { color: t.textTertiary }]}>
          Nothing saved yet.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  saveRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  labelInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  hint: {
    fontSize: 12,
    marginTop: 8,
  },
  runRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
  },
  runBody: {
    flex: 1,
  },
  runTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  runMeta: {
    fontSize: 11,
    marginTop: 2,
  },
});
