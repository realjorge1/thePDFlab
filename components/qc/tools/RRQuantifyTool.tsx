import { RegressionChart } from "@/components/qc/QCCharts";
import {
  FormulaSection,
  QCButtonRow,
  QCNumberField,
  QCResultRow,
  QCResultsCard,
  QCSection,
} from "@/components/qc/QCWidgets";
import { fmt, parseDecimal } from "@/components/qc/qcFormat";
import { QCInsights } from "@/components/qc/QCInsights";
import { QCResultPanel } from "@/components/qc/QCResultPanel";
import { toCopyText, type QCResultModel } from "@/components/qc/qcResult";
import { SavedRunsSection } from "@/components/qc/SavedRunsSection";
import { getQcTool } from "@/constants/qcTools";
import { useTheme } from "@/services/ThemeProvider";
import * as QC from "@/utils/qcCalculators";
import { Plus, X } from "lucide-react-native";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const TOOL = getQcTool("rr-quantify")!;

const FORMULA = `OLS regression of measured on assigned:
  slope, intercept, r, r², Sy/x

%Error = 100 · (measured − assigned)
              / assigned

A level passes when |%Error| ≤ allowable
error. The reportable range is the widest
contiguous span of passing levels.`;

interface PairRow {
  assigned: string;
  measured: string;
}

const EMPTY_PAIR: PairRow = { assigned: "", measured: "" };

function initialPairsFrom(json: string | undefined): PairRow[] {
  if (json) {
    try {
      const parsed = JSON.parse(json) as { assigned: number; measured: number }[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => ({
          assigned: String(p.assigned),
          measured: String(p.measured),
        }));
      }
    } catch {
      // Malformed handoff payload — fall through to empty rows.
    }
  }
  return [{ ...EMPTY_PAIR }, { ...EMPTY_PAIR }, { ...EMPTY_PAIR }];
}

interface RRQuantifyToolProps {
  /** JSON pairs handed off from the Recording Results calculator. */
  initialPairs?: string;
}

export function RRQuantifyTool({ initialPairs }: RRQuantifyToolProps) {
  const { colors: t } = useTheme();
  const [pairs, setPairs] = useState<PairRow[]>(() =>
    initialPairsFrom(initialPairs),
  );
  const [allowable, setAllowable] = useState("");
  const [allowableError, setAllowableError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QC.ReportableRangeQuantifyResult | null>(
    null,
  );
  const receivedFromRecord = useRef(
    Boolean(initialPairs) && initialPairsFrom(initialPairs).length > 0,
  );

  const setPair = useCallback((index: number, patch: Partial<PairRow>) => {
    setPairs((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }, []);

  const addPair = useCallback(() => {
    setPairs((prev) => [...prev, { ...EMPTY_PAIR }]);
  }, []);

  const removePair = useCallback((index: number) => {
    setPairs((prev) =>
      prev.length > 2 ? prev.filter((_, i) => i !== index) : prev,
    );
  }, []);

  const calculateFrom = useCallback(
    (rows: PairRow[], allowableText: string) => {
      const allowablePct = parseDecimal(allowableText);
      if (allowablePct === null || allowablePct <= 0) {
        setAllowableError("Allowable error must be greater than 0.");
        setResult(null);
        return;
      }
      setAllowableError(null);

      const parsed: { assigned: number; measured: number }[] = [];
      for (const [i, row] of rows.entries()) {
        const assigned = parseDecimal(row.assigned);
        const measured = parseDecimal(row.measured);
        if (assigned === null || measured === null) {
          setError(`Point ${i + 1}: enter valid assigned and measured values.`);
          setResult(null);
          return;
        }
        if (assigned === 0) {
          setError(`Point ${i + 1}: assigned value must not be 0.`);
          setResult(null);
          return;
        }
        parsed.push({ assigned, measured });
      }
      if (parsed.length < 2) {
        setError("At least 2 points are required for regression.");
        setResult(null);
        return;
      }
      try {
        setResult(
          QC.reportableRangeQuantify({
            points: parsed,
            allowableErrorPct: allowablePct,
          }),
        );
        setError(null);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Could not calculate.");
      }
    },
    [],
  );

  const handleReset = useCallback(() => {
    setPairs([{ ...EMPTY_PAIR }, { ...EMPTY_PAIR }, { ...EMPTY_PAIR }]);
    setAllowable("");
    setAllowableError(null);
    setError(null);
    setResult(null);
    receivedFromRecord.current = false;
  }, []);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      try {
        const restored = JSON.parse(saved.pairs ?? "[]") as PairRow[];
        const restoredAllowable = saved.allowable ?? "";
        if (Array.isArray(restored) && restored.length > 0) {
          setPairs(restored);
          setAllowable(restoredAllowable);
          calculateFrom(restored, restoredAllowable);
        }
      } catch {
        // Corrupt saved record — ignore.
      }
    },
    [calculateFrom],
  );

  const model = useMemo<QCResultModel | null>(() => {
    if (!result) return null;
    const reg = result.regression;
    const rr = result.reportableRange;
    const passing = result.points.filter((p) => p.withinAllowable).length;
    return {
      headline: rr
        ? { label: "Reportable range", value: `${fmt(rr.low, 2)} – ${fmt(rr.high, 2)}` }
        : { label: "Reportable range", value: "Not established" },
      verdict: rr
        ? { label: `${passing}/${result.points.length} levels pass`, tone: "good" }
        : { label: "Not established", tone: "bad" },
      formula:
        "measured = slope·assigned + intercept  ·  %Error = 100(measured − assigned)/assigned",
      metrics: [
        { label: "Slope", value: fmt(reg.slope, 4), emphasize: true, hint: "ideal 1.0" },
        { label: "Intercept", value: fmt(reg.intercept, 4), hint: "ideal 0" },
        { label: "r", value: fmt(reg.r, 4) },
        { label: "r²", value: fmt(reg.r2, 4) },
        { label: "Sy/x", value: fmt(reg.syx, 4) },
        { label: "n", value: String(reg.n) },
      ],
      interpretation: rr
        ? `Levels from ${fmt(rr.low, 2)} to ${fmt(rr.high, 2)} recover within the ` +
          `allowable error, so that span is the verified reportable range. A slope ` +
          `of ${fmt(reg.slope, 3)} and intercept of ${fmt(reg.intercept, 3)} describe ` +
          `the measured-vs-assigned relationship (ideal is slope 1, intercept 0).`
        : `Fewer than two consecutive levels fall within the allowable error, so a ` +
          `reportable range could not be established. Review the failing levels below.`,
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      {receivedFromRecord.current ? (
        <View
          style={[
            styles.handoffBanner,
            { backgroundColor: t.backgroundSecondary, borderColor: t.border },
          ]}
        >
          <Text style={{ color: t.textSecondary, fontSize: 12 }}>
            Levels received from Recording Results. Enter the allowable error
            and calculate.
          </Text>
        </View>
      ) : null}

      <QCSection title="Assigned / measured pairs">
        {pairs.map((row, i) => (
          <View key={`pair-${i}`} style={styles.pairRow}>
            <View style={styles.pairField}>
              <QCNumberField
                label={`Assigned ${i + 1}`}
                value={row.assigned}
                onChangeText={(text) => setPair(i, { assigned: text })}
                allowNegative
              />
            </View>
            <View style={styles.pairField}>
              <QCNumberField
                label={`Measured ${i + 1}`}
                value={row.measured}
                onChangeText={(text) => setPair(i, { measured: text })}
                allowNegative
              />
            </View>
            {pairs.length > 2 ? (
              <TouchableOpacity
                onPress={() => removePair(i)}
                hitSlop={8}
                style={styles.removeBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove point ${i + 1}`}
              >
                <X size={16} color={t.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.addBtn, { borderColor: t.primary }]}
          onPress={addPair}
          accessibilityRole="button"
          accessibilityLabel="Add point"
        >
          <Plus size={16} color={t.primary} />
          <Text style={[styles.addBtnText, { color: t.primary }]}>Add point</Text>
        </TouchableOpacity>

        <QCNumberField
          label="Allowable error"
          value={allowable}
          onChangeText={setAllowable}
          unit="%"
          placeholder="e.g. 5"
          error={allowableError}
        />

        <QCButtonRow
          onCalculate={() => calculateFrom(pairs, allowable)}
          onReset={handleReset}
        />
        {error ? (
          <Text style={{ color: t.error, fontSize: 13 }}>{error}</Text>
        ) : null}
      </QCSection>

      {result && model ? (
        <>
          <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} />

          <QCResultsCard title="Error per level">
            <View style={[styles.tableHead, { borderBottomColor: t.separator }]}>
              {["Assigned", "Measured", "%Error", ""].map((h, i) => (
                <Text
                  key={`h-${i}`}
                  style={[styles.tableHeadCell, { color: t.textTertiary }]}
                >
                  {h}
                </Text>
              ))}
            </View>
            {result.points.map((p, i) => (
              <View
                key={`row-${i}`}
                style={[styles.tableRow, { borderBottomColor: t.separator }]}
              >
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(p.assigned, 2)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(p.measured, 2)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(p.errorPct)}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.flagCell,
                    { color: p.withinAllowable ? t.success : t.error },
                  ]}
                >
                  {p.withinAllowable ? "✓ pass" : "✗ fail"}
                </Text>
              </View>
            ))}
            {result.reportableRange ? (
              <QCResultRow
                label="Reportable range"
                value={`${fmt(result.reportableRange.low, 2)} – ${fmt(result.reportableRange.high, 2)}`}
                emphasize
              />
            ) : (
              <Text style={{ color: t.error, fontSize: 13, marginTop: 10 }}>
                A reportable range could not be established — fewer than two
                consecutive levels fall within the allowable error.
              </Text>
            )}
          </QCResultsCard>

          <QCSection title="Measured vs assigned">
            <RegressionChart
              points={result.points}
              slope={result.regression.slope}
              intercept={result.regression.intercept}
            />
          </QCSection>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="rr-quantify"
        currentRun={
          result
            ? {
                inputs: { pairs: JSON.stringify(pairs), allowable },
                summary: result.reportableRange
                  ? `Range ${fmt(result.reportableRange.low, 1)} – ${fmt(result.reportableRange.high, 1)} · slope ${fmt(result.regression.slope, 3)}`
                  : "Range not established",
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}

const styles = StyleSheet.create({
  handoffBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  pairRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  pairField: {
    flex: 1,
  },
  removeBtn: {
    paddingTop: 34,
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
  flagCell: {
    fontWeight: "700",
  },
});
