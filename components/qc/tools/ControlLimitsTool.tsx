import { LeveyJenningsChart } from "@/components/qc/QCCharts";
import {
  FormulaSection,
  QCButtonRow,
  QCListField,
  QCNumberField,
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
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const TOOL = getQcTool("control-limits")!;

const FORMULA = `Control limits = mean ± k·SD, k = 1, 2, 3
CV% = 100 · SD / mean

From raw QC values, mean and SD are the
sample statistics of the data set. The
±1s/2s/3s lines are the Levey-Jennings
control limits used with Westgard rules.`;

type Mode = "values" | "meanSd";

interface InputsState {
  mode: Mode;
  values: string;
  mean: string;
  sd: string;
}

const EMPTY: InputsState = { mode: "values", values: "", mean: "", sd: "" };

export function ControlLimitsTool() {
  const { colors: t } = useTheme();
  const [inputs, setInputs] = useState<InputsState>(EMPTY);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    limits: QC.ControlLimitsResult;
    /** Raw values when calculated from data, for the chart. */
    values: number[] | null;
  } | null>(null);

  const calculateFrom = useCallback((source: InputsState) => {
    try {
      if (source.mode === "values") {
        const { values } = parseNumberList(source.values);
        if (values.length < 2) {
          setFieldError("Enter at least 2 QC values.");
          setResult(null);
          return;
        }
        setResult({ limits: QC.controlLimits(values), values });
      } else {
        const mean = parseDecimal(source.mean);
        const sd = parseDecimal(source.sd);
        if (mean === null) {
          setFieldError("Enter a valid mean.");
          setResult(null);
          return;
        }
        if (sd === null || sd <= 0) {
          setFieldError("SD must be greater than 0.");
          setResult(null);
          return;
        }
        setResult({ limits: QC.controlLimits({ mean, sd }), values: null });
      }
      setFieldError(null);
    } catch (e) {
      setResult(null);
      setFieldError(e instanceof Error ? e.message : "Could not calculate.");
    }
  }, []);

  const handleReset = useCallback(() => {
    setInputs(EMPTY);
    setFieldError(null);
    setResult(null);
  }, []);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      const restored: InputsState = {
        mode: saved.mode === "meanSd" ? "meanSd" : "values",
        values: saved.values ?? "",
        mean: saved.mean ?? "",
        sd: saved.sd ?? "",
      };
      setInputs(restored);
      calculateFrom(restored);
    },
    [calculateFrom],
  );

  const model = useMemo<QCResultModel | null>(() => {
    if (!result) return null;
    const l = result.limits;
    return {
      headline: { label: "Mean (target)", value: fmt(l.mean, 4) },
      formula: "control limit = mean ± k·SD  (k = 1, 2, 3)",
      variables: [
        { symbol: "x̄", value: fmt(l.mean, 4) },
        { symbol: "SD", value: fmt(l.sd, 4) },
        { symbol: "CV", value: fmt(l.cv), unit: "%" },
      ],
      metrics: [
        { label: "+3s", value: fmt(l.limits.plus3s, 4) },
        { label: "−3s", value: fmt(l.limits.minus3s, 4) },
        { label: "+2s", value: fmt(l.limits.plus2s, 4), emphasize: true },
        { label: "−2s", value: fmt(l.limits.minus2s, 4), emphasize: true },
        { label: "+1s", value: fmt(l.limits.plus1s, 4) },
        { label: "−1s", value: fmt(l.limits.minus1s, 4) },
      ],
      interpretation:
        `Plot QC results against these lines and apply Westgard rules: a single ` +
        `point beyond ±3s (1-3s) or two consecutive beyond the same ±2s (2-2s) ` +
        `flags a run. The ±2s lines (${fmt(l.limits.minus2s, 3)} to ` +
        `${fmt(l.limits.plus2s, 3)}) are warning limits, not automatic rejection.`,
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Inputs">
        {/* Mode toggle */}
        <View style={[styles.toggleRow, { borderColor: t.border }]}>
          {(
            [
              { key: "values", label: "Raw QC values" },
              { key: "meanSd", label: "Mean & SD" },
            ] as const
          ).map((option) => {
            const active = inputs.mode === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.toggleBtn,
                  active && { backgroundColor: t.primary },
                ]}
                onPress={() =>
                  setInputs((prev) => ({ ...prev, mode: option.key }))
                }
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: active ? t.textInverse : t.textSecondary },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {inputs.mode === "values" ? (
          <QCListField
            label="QC values"
            value={inputs.values}
            onChangeText={(text) =>
              setInputs((prev) => ({ ...prev, values: text }))
            }
            error={fieldError}
          />
        ) : (
          <>
            <QCNumberField
              label="Mean"
              value={inputs.mean}
              onChangeText={(text) =>
                setInputs((prev) => ({ ...prev, mean: text }))
              }
              placeholder="e.g. 100"
              allowNegative
            />
            <QCNumberField
              label="SD"
              value={inputs.sd}
              onChangeText={(text) =>
                setInputs((prev) => ({ ...prev, sd: text }))
              }
              placeholder="e.g. 2"
              error={fieldError}
            />
          </>
        )}

        <QCButtonRow
          onCalculate={() => calculateFrom(inputs)}
          onReset={handleReset}
        />
      </QCSection>

      {model && result ? (
        <>
          <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} />
          <QCSection title="Levey-Jennings chart">
            <LeveyJenningsChart
              mean={result.limits.mean}
              sd={result.limits.sd}
              values={result.values ?? undefined}
            />
          </QCSection>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="control-limits"
        currentRun={
          result
            ? {
                inputs: {
                  mode: inputs.mode,
                  values: inputs.values,
                  mean: inputs.mean,
                  sd: inputs.sd,
                },
                summary: `mean ${fmt(result.limits.mean)} · SD ${fmt(result.limits.sd, 3)}`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
