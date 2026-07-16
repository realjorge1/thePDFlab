import { LeveyJenningsChart } from "@/components/qc/QCCharts";
import { FormulaSection, QCButtonRow, QCListField, QCSection } from "@/components/qc/QCWidgets";
import { fmt, parseNumberList } from "@/components/qc/qcFormat";
import { QCInsights } from "@/components/qc/QCInsights";
import { QCResultPanel } from "@/components/qc/QCResultPanel";
import { toCopyText, type QCResultModel } from "@/components/qc/qcResult";
import { SavedRunsSection } from "@/components/qc/SavedRunsSection";
import { getQcTool } from "@/constants/qcTools";
import * as QC from "@/utils/qcCalculators";
import React, { useCallback, useMemo, useState } from "react";

const TOOL = getQcTool("dispersion")!;

const FORMULA = `mean = Σx / n
variance = Σ(x − mean)² / (n − 1)
SD = √variance
CV% = 100 · SD / mean
SEM = SD / √n
95% CI = mean ± t₀.₉₇₅,ₙ₋₁ · SEM
median, Q1, Q3 = order statistics (IQR = Q3 − Q1)`;

function interpret(r: QC.DescriptiveStats): string {
  const skew =
    Math.abs(r.mean - r.median) < 0.1 * r.sd
      ? "The mean and median are close, so the distribution looks roughly symmetric."
      : r.mean > r.median
        ? "The mean sits above the median — the data are right-skewed (a few high values)."
        : "The mean sits below the median — the data are left-skewed (a few low values).";
  return (
    `n = ${r.n} values, mean ${fmt(r.mean, 4)} with SD ${fmt(r.sd, 4)} ` +
    `(CV ${fmt(r.cv)}%). The 95% confidence interval for the mean is ` +
    `${fmt(r.ci95Lower, 4)} to ${fmt(r.ci95Upper, 4)}. ${skew}`
  );
}

export function DispersionTool() {
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    stats: QC.DescriptiveStats;
    values: number[];
  } | null>(null);

  const calculateFrom = useCallback((source: string) => {
    const { values } = parseNumberList(source);
    if (values.length < 2) {
      setFieldError("Enter at least 2 values.");
      setResult(null);
      return;
    }
    try {
      setResult({ stats: QC.describe(values), values });
      setFieldError(null);
    } catch (e) {
      setResult(null);
      setFieldError(e instanceof Error ? e.message : "Could not calculate.");
    }
  }, []);

  const handleReset = useCallback(() => {
    setText("");
    setFieldError(null);
    setResult(null);
  }, []);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      const restored = saved.values ?? "";
      setText(restored);
      calculateFrom(restored);
    },
    [calculateFrom],
  );

  const model = useMemo<QCResultModel | null>(() => {
    if (!result) return null;
    const r = result.stats;
    return {
      headline: { label: "Mean", value: fmt(r.mean, 4) },
      formula: "SD = √( Σ(x − mean)² / (n − 1) )",
      metrics: [
        { label: "n", value: String(r.n) },
        { label: "SD", value: fmt(r.sd, 4), emphasize: true },
        { label: "Variance", value: fmt(r.variance, 4) },
        { label: "CV", value: `${fmt(r.cv)} %`, emphasize: true },
        { label: "SEM", value: fmt(r.sem, 4) },
        { label: "Median", value: fmt(r.median, 4) },
        { label: "Q1 – Q3", value: `${fmt(r.q1, 3)} – ${fmt(r.q3, 3)}`, hint: `IQR ${fmt(r.iqr, 3)}` },
        { label: "95% CI (mean)", value: `${fmt(r.ci95Lower, 3)} – ${fmt(r.ci95Upper, 3)}`, hint: "t-based" },
        { label: "Min / Max", value: `${fmt(r.min, 3)} / ${fmt(r.max, 3)}` },
        { label: "Range", value: fmt(r.range, 4) },
        { label: "Sum", value: fmt(r.sum, 4) },
      ],
      interpretation: interpret(r),
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Data">
        <QCListField
          label="Values"
          value={text}
          onChangeText={setText}
          error={fieldError}
        />
        <QCButtonRow onCalculate={() => calculateFrom(text)} onReset={handleReset} />
      </QCSection>

      {model && result ? (
        <>
          <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} />
          <QCSection title="Levey-Jennings view">
            <LeveyJenningsChart
              mean={result.stats.mean}
              sd={result.stats.sd}
              values={result.values}
            />
          </QCSection>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="dispersion"
        currentRun={
          result
            ? {
                inputs: { values: text },
                summary: `n = ${result.stats.n} · mean ${fmt(result.stats.mean)} · SD ${fmt(result.stats.sd, 3)}`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}
