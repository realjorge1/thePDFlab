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
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

const TOOL = getQcTool("lot-to-lot")!;

const FORMULA = `Samples are paired by position: the 1st
old-lot result with the 1st new-lot
result, and so on.

For each sample:
  diff = new − old
  %diff = 100 · (new − old) / old

Mean %difference is the bias introduced
by the new lot. The comparison is
acceptable when |mean %diff| ≤ allowable
difference. Samples exceeding the limit
individually are flagged too.`;

interface InputsState {
  oldValues: string;
  newValues: string;
  allowable: string;
}

const EMPTY: InputsState = { oldValues: "", newValues: "", allowable: "" };

export function LotToLotTool() {
  const { colors: t } = useTheme();
  const [inputs, setInputs] = useState<InputsState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QC.LotToLotResult | null>(null);

  const calculateFrom = useCallback((source: InputsState) => {
    const oldParsed = parseNumberList(source.oldValues);
    const newParsed = parseNumberList(source.newValues);
    const allowable = parseDecimal(source.allowable);

    if (oldParsed.values.length < 2) {
      setError("Enter at least 2 results for the current (old) lot.");
      setResult(null);
      return;
    }
    if (newParsed.values.length !== oldParsed.values.length) {
      setError(
        `The two lists must have the same number of results (old: ${oldParsed.values.length}, new: ${newParsed.values.length}).`,
      );
      setResult(null);
      return;
    }
    if (allowable === null || allowable <= 0) {
      setError("Allowable difference must be greater than 0.");
      setResult(null);
      return;
    }
    try {
      setResult(
        QC.lotToLot({
          pairs: oldParsed.values.map((oldLot, i) => ({
            oldLot,
            newLot: newParsed.values[i],
          })),
          allowableDifferencePct: allowable,
        }),
      );
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Could not calculate.");
    }
  }, []);

  const handleReset = useCallback(() => {
    setInputs(EMPTY);
    setError(null);
    setResult(null);
  }, []);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      const restored: InputsState = {
        oldValues: saved.oldValues ?? "",
        newValues: saved.newValues ?? "",
        allowable: saved.allowable ?? "",
      };
      setInputs(restored);
      calculateFrom(restored);
    },
    [calculateFrom],
  );

  const model = useMemo<QCResultModel | null>(() => {
    if (!result) return null;
    const acceptable = result.verdict === "acceptable";
    return {
      headline: {
        label: "Mean %difference (new − old)",
        value: `${fmt(result.meanDiffPct)} %`,
      },
      verdict: acceptable
        ? { label: "Acceptable — new lot verified", tone: "good" }
        : { label: "Unacceptable — investigate before release", tone: "bad" },
      formula:
        "%diff = 100·(new − old)/old  ·  acceptable when |mean %diff| ≤ allowable",
      metrics: [
        { label: "Mean difference", value: fmt(result.meanDiff, 4), emphasize: true },
        { label: "n (pairs)", value: String(result.n) },
        { label: "Mean, old lot", value: fmt(result.meanOld, 4) },
        { label: "Mean, new lot", value: fmt(result.meanNew, 4) },
        { label: "SD of differences", value: fmt(result.sdDiff, 4) },
        { label: "Within limit", value: `${result.passing} / ${result.n}` },
        { label: "Allowable diff", value: `${fmt(result.allowableDifferencePct)} %` },
      ],
      interpretation: acceptable
        ? `The new lot's mean bias (${fmt(result.meanDiffPct)}%) is within the ` +
          `allowable difference of ${fmt(result.allowableDifferencePct)}%, so the ` +
          `lot is verified. Still review any individual samples flagged below.`
        : `The new lot's mean bias (${fmt(result.meanDiffPct)}%) exceeds the ` +
          `allowable difference of ${fmt(result.allowableDifferencePct)}%. ` +
          `Investigate the cause before releasing the lot.`,
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Paired sample results">
        <QCListField
          label="Current (old) lot results"
          value={inputs.oldValues}
          onChangeText={(text) =>
            setInputs((prev) => ({ ...prev, oldValues: text }))
          }
          placeholder="e.g. 4.2, 8.9, 15.3, 22.8"
        />
        <QCListField
          label="New lot results (same samples, same order)"
          value={inputs.newValues}
          onChangeText={(text) =>
            setInputs((prev) => ({ ...prev, newValues: text }))
          }
          placeholder="e.g. 4.3, 9.1, 15.1, 23.2"
        />
        <QCNumberField
          label="Allowable difference"
          value={inputs.allowable}
          onChangeText={(text) =>
            setInputs((prev) => ({ ...prev, allowable: text }))
          }
          unit="%"
          placeholder="e.g. 10"
        />
        <QCButtonRow
          onCalculate={() => calculateFrom(inputs)}
          onReset={handleReset}
        />
        {error ? (
          <Text style={{ color: t.error, fontSize: 13 }}>{error}</Text>
        ) : null}
      </QCSection>

      {result && model ? (
        <>
          <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} />

          <QCResultsCard title="Per-sample differences">
            <View style={[styles.tableHead, { borderBottomColor: t.separator }]}>
              {["Old", "New", "%Diff", ""].map((h, i) => (
                <Text
                  key={`h-${i}`}
                  style={[styles.tableHeadCell, { color: t.textTertiary }]}
                >
                  {h}
                </Text>
              ))}
            </View>
            {result.pairs.map((p, i) => (
              <View
                key={`row-${i}`}
                style={[styles.tableRow, { borderBottomColor: t.separator }]}
              >
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(p.oldLot, 2)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(p.newLot, 2)}
                </Text>
                <Text style={[styles.tableCell, { color: t.text }]}>
                  {fmt(p.diffPct)}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.flagCell,
                    { color: p.withinAllowable ? t.success : t.error },
                  ]}
                >
                  {p.withinAllowable ? "✓" : "✗"}
                </Text>
              </View>
            ))}
          </QCResultsCard>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="lot-to-lot"
        currentRun={
          result
            ? {
                inputs: { ...inputs },
                summary: `${result.verdict} · mean Δ ${fmt(result.meanDiffPct)}% · n ${result.n}`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}

const styles = StyleSheet.create({
  tableHead: {
    flexDirection: "row",
    paddingBottom: 6,
    marginTop: 12,
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
