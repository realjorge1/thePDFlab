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

const TOOL = getQcTool("replication")!;

const FORMULA = `mean = Σx / n
smeas (SD) = √( Σ(x − mean)² / (n − 1) )
CV% = 100 · SD / mean
SEM = SD / √n

The replication experiment estimates the
measurement imprecision (smeas) from
repeated results of the same sample.`;

export function ReplicationTool() {
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    stats: ReturnType<typeof QC.replication>;
    values: number[];
  } | null>(null);

  const calculateFrom = useCallback((source: string) => {
    const { values } = parseNumberList(source);
    if (values.length < 2) {
      setFieldError("Enter at least 2 replicate values.");
      setResult(null);
      return;
    }
    try {
      setResult({ stats: QC.replication(values), values });
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
      headline: { label: "Imprecision (smeas / SD)", value: fmt(r.smeas, 4) },
      formula: "smeas = √( Σ(x − mean)² / (n − 1) )",
      metrics: [
        { label: "n", value: String(r.n) },
        { label: "Mean", value: fmt(r.mean, 4) },
        { label: "CV", value: `${fmt(r.cv)} %`, emphasize: true },
        { label: "SEM", value: fmt(r.sem, 4) },
        { label: "95% CI (mean)", value: `${fmt(r.ci95Lower, 3)} – ${fmt(r.ci95Upper, 3)}`, hint: "t-based" },
        { label: "Range", value: `${fmt(r.min, 3)} – ${fmt(r.max, 3)}` },
      ],
      interpretation:
        `From ${r.n} replicates, the measurement imprecision (smeas) is ` +
        `${fmt(r.smeas, 4)} (CV ${fmt(r.cv)}%). Use this CV as the imprecision ` +
        `term when computing the sigma metric or setting control limits.`,
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Replicate results">
        <QCListField
          label="Values"
          value={text}
          onChangeText={setText}
          placeholder="Paste or type values, e.g. 4.1, 4.0, 4.2, 3.9"
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
              sd={result.stats.smeas}
              values={result.values}
            />
          </QCSection>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="replication"
        currentRun={
          result
            ? {
                inputs: { values: text },
                summary: `n = ${result.stats.n} · smeas = ${fmt(result.stats.smeas, 4)} · CV ${fmt(result.stats.cv)}%`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}
