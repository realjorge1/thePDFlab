import {
  FormulaSection,
  QCButtonRow,
  QCListField,
  QCNumberField,
  QCResultsCard,
  QCSection,
} from "@/components/qc/QCWidgets";
import { fmt, parseDecimal, parseNumberList } from "@/components/qc/qcFormat";
import { QCInsights } from "@/components/qc/QCInsights";
import { QCResultPanel } from "@/components/qc/QCResultPanel";
import { toCopyText, type QCResultModel } from "@/components/qc/qcResult";
import { SavedRunsSection } from "@/components/qc/SavedRunsSection";
import { getQcTool } from "@/constants/qcTools";
import { useTheme } from "@/services/ThemeProvider";
import * as QC from "@/utils/qcCalculators";
import { useRouter } from "expo-router";
import { Plus, Send, X } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const TOOL = getQcTool("rr-record")!;

const FORMULA = `For each level:
  mean = Σx / n
  SD = √( Σ(x − mean)² / (n − 1) )
  CV% = 100 · SD / mean

The mean measured value of each level is
what carries over to the Quantifying
Errors calculator.`;

interface LevelRow {
  assigned: string;
  replicates: string;
}

const EMPTY_LEVEL: LevelRow = { assigned: "", replicates: "" };
const INITIAL_LEVELS: LevelRow[] = [
  { ...EMPTY_LEVEL },
  { ...EMPTY_LEVEL },
  { ...EMPTY_LEVEL },
];

export function RRRecordTool() {
  const { colors: t } = useTheme();
  const router = useRouter();
  const [levels, setLevels] = useState<LevelRow[]>(INITIAL_LEVELS);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QC.ReportableRangeLevelResult[] | null>(
    null,
  );

  const setLevel = useCallback(
    (index: number, patch: Partial<LevelRow>) => {
      setLevels((prev) =>
        prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const addLevel = useCallback(() => {
    setLevels((prev) => [...prev, { ...EMPTY_LEVEL }]);
  }, []);

  const removeLevel = useCallback((index: number) => {
    setLevels((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );
  }, []);

  const calculateFrom = useCallback((rows: LevelRow[]) => {
    const parsed: { assigned: number; replicates: number[] }[] = [];
    for (const [i, row] of rows.entries()) {
      const assigned = parseDecimal(row.assigned);
      const { values: replicates } = parseNumberList(row.replicates);
      if (assigned === null) {
        setError(`Level ${i + 1}: enter a valid assigned value.`);
        setResult(null);
        return;
      }
      if (replicates.length === 0) {
        setError(`Level ${i + 1}: enter at least one replicate.`);
        setResult(null);
        return;
      }
      parsed.push({ assigned, replicates });
    }
    try {
      setResult(QC.reportableRangeRecord(parsed));
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Could not calculate.");
    }
  }, []);

  const handleReset = useCallback(() => {
    setLevels(INITIAL_LEVELS.map((l) => ({ ...l })));
    setError(null);
    setResult(null);
  }, []);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      try {
        const restored = JSON.parse(saved.levels ?? "[]") as LevelRow[];
        if (Array.isArray(restored) && restored.length > 0) {
          setLevels(restored);
          calculateFrom(restored);
        }
      } catch {
        // Corrupt saved record — ignore.
      }
    },
    [calculateFrom],
  );

  const handleSendToQuantify = useCallback(() => {
    if (!result) return;
    const pairs = result.map((row) => ({
      assigned: row.assigned,
      measured: row.meanMeasured,
    }));
    router.push({
      pathname: "/qc-calculators/[tool]",
      params: { tool: "rr-quantify", pairs: JSON.stringify(pairs) },
    });
  }, [result, router]);

  const copyText = result
    ? [
        `Reportable Range — Recording Results`,
        ...result.map(
          (row, i) =>
            `Level ${i + 1}: assigned ${row.assigned}, n ${row.n}, mean ${fmt(row.meanMeasured, 4)}, SD ${fmt(row.sd, 4)}, CV ${fmt(row.cv)}%`,
        ),
      ].join("\n")
    : undefined;

  const model = useMemo<QCResultModel | null>(() => {
    if (!result || result.length === 0) return null;
    const cvs = result.map((r) => r.cv).filter((c) => !Number.isNaN(c));
    const meanCv = cvs.length ? cvs.reduce((a, b) => a + b, 0) / cvs.length : NaN;
    const lowest = result[0];
    const highest = result[result.length - 1];
    return {
      headline: { label: "Levels recorded", value: String(result.length) },
      formula: "per level: mean = Σx/n, SD = √(Σ(x−mean)²/(n−1)), CV% = 100·SD/mean",
      metrics: [
        { label: "Levels", value: String(result.length) },
        { label: "Mean CV across levels", value: `${fmt(meanCv)} %`, emphasize: true },
        { label: "Lowest level", value: fmt(lowest.assigned, 2) },
        { label: "Highest level", value: fmt(highest.assigned, 2) },
      ],
      interpretation:
        `Recorded ${result.length} levels spanning ${fmt(lowest.assigned, 2)} to ` +
        `${fmt(highest.assigned, 2)} with a mean replicate CV of ${fmt(meanCv)}%. ` +
        `Send the per-level means to Quantifying Errors to test recovery against ` +
        `an allowable-error budget and establish the reportable range.`,
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Levels">
        {levels.map((row, i) => (
          <View
            key={`level-${i}`}
            style={[styles.levelCard, { borderColor: t.border }]}
          >
            <View style={styles.levelHeader}>
              <Text style={[styles.levelTitle, { color: t.textSecondary }]}>
                Level {i + 1}
              </Text>
              {levels.length > 1 ? (
                <TouchableOpacity
                  onPress={() => removeLevel(i)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove level ${i + 1}`}
                >
                  <X size={16} color={t.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
            <QCNumberField
              label={`Assigned value (level ${i + 1})`}
              value={row.assigned}
              onChangeText={(text) => setLevel(i, { assigned: text })}
              placeholder="e.g. 50"
              allowNegative
            />
            <QCListField
              label={`Replicates (level ${i + 1})`}
              value={row.replicates}
              onChangeText={(text) => setLevel(i, { replicates: text })}
              placeholder="e.g. 49.8, 50.4, 50.1"
            />
          </View>
        ))}

        <TouchableOpacity
          style={[styles.addBtn, { borderColor: t.primary }]}
          onPress={addLevel}
          accessibilityRole="button"
          accessibilityLabel="Add level"
        >
          <Plus size={16} color={t.primary} />
          <Text style={[styles.addBtnText, { color: t.primary }]}>Add level</Text>
        </TouchableOpacity>

        <QCButtonRow
          onCalculate={() => calculateFrom(levels)}
          onReset={handleReset}
        />
        {error ? (
          <Text style={{ color: t.error, fontSize: 13 }}>{error}</Text>
        ) : null}
      </QCSection>

      {result && model ? (
        <>
          <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} />

          <QCResultsCard title="Per-level statistics" copyText={copyText}>
            {/* Per-level summary table */}
            <View style={[styles.tableHead, { borderBottomColor: t.separator }]}>
              {["Assigned", "n", "Mean", "SD", "CV%"].map((h) => (
                <Text
                  key={h}
                  style={[styles.tableHeadCell, { color: t.textTertiary }]}
                >
                  {h}
                </Text>
              ))}
            </View>
            {result.map((row, i) => (
              <View
                key={`res-${i}`}
                style={[styles.tableRow, { borderBottomColor: t.separator }]}
              >
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(row.assigned, 2)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>{row.n}</Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(row.meanMeasured, 2)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(row.sd, 3)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(row.cv, 1)}
                </Text>
              </View>
            ))}
          </QCResultsCard>

          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: t.primary }]}
            onPress={handleSendToQuantify}
            accessibilityRole="button"
            accessibilityLabel="Send to Quantifying Errors"
          >
            <Send size={16} color={t.textInverse} />
            <Text style={[styles.sendBtnText, { color: t.textInverse }]}>
              Send to Quantifying Errors
            </Text>
          </TouchableOpacity>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="rr-record"
        currentRun={
          result
            ? {
                inputs: { levels: JSON.stringify(levels) },
                summary: `${result.length} level${result.length === 1 ? "" : "s"} recorded`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}

const styles = StyleSheet.create({
  levelCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  levelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  levelTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  tableHead: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHeadCell: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableCell: {
    flex: 1,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 12,
  },
  sendBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
