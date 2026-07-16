import { SigmaDecisionChart } from "@/components/qc/QCCharts";
import { FormulaSection, QCButtonRow, QCSection } from "@/components/qc/QCWidgets";
import { fmt } from "@/components/qc/qcFormat";
import { QCInsights } from "@/components/qc/QCInsights";
import { QCResultPanel } from "@/components/qc/QCResultPanel";
import {
  classificationVerdict,
  toCopyText,
  type QCResultModel,
} from "@/components/qc/qcResult";
import { SavedRunsSection } from "@/components/qc/SavedRunsSection";
import {
  SigmaInputFields,
  useSigmaForm,
  type SigmaFormValues,
} from "@/components/qc/tools/sigmaForm";
import { getQcTool } from "@/constants/qcTools";
import { useTheme } from "@/services/ThemeProvider";
import * as QC from "@/utils/qcCalculators";
import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";

const TOOL = getQcTool("opspecs")!;

const FORMULA = `Sigma = (TEa − |Bias|) / CV

Operating point (normalized to TEa):
  x = CV / TEa      (allowable imprecision)
  y = |Bias| / TEa  (allowable inaccuracy)

Control rules and number of control
measurements (N) are recommended from
the sigma band.`;

interface OpSpecsState {
  opspecs: QC.OpSpecsResult;
  /** Boundary lines for the chart, from the same engine inputs. */
  grid: QC.QcGridResult;
}

export function OpSpecsTool() {
  const { colors: t } = useTheme();
  const form = useSigmaForm();
  const [result, setResult] = useState<OpSpecsState | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  const calculateFrom = useCallback(
    (values: SigmaFormValues) => {
      const parsed = form.validate(values);
      if (!parsed) {
        setResult(null);
        return;
      }
      try {
        setResult({
          opspecs: QC.normalizedOpSpecs(parsed),
          grid: QC.qcGrid(parsed),
        });
        setCalcError(null);
      } catch (e) {
        setResult(null);
        setCalcError(e instanceof Error ? e.message : "Could not calculate.");
      }
    },
    [form],
  );

  const handleReset = useCallback(() => {
    form.reset();
    setResult(null);
    setCalcError(null);
  }, [form]);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      form.restore(saved);
      calculateFrom({
        tea: saved.tea ?? "",
        bias: saved.bias ?? "",
        cv: saved.cv ?? "",
      });
    },
    [form, calculateFrom],
  );

  const model = useMemo<QCResultModel | null>(() => {
    if (!result) return null;
    const o = result.opspecs;
    return {
      headline: { label: "Sigma metric", value: fmt(o.sigma), unit: "σ" },
      verdict: classificationVerdict(o.classification),
      formula: "σ = (TEa − |Bias|) / CV → rules & N from the sigma band",
      metrics: [
        { label: "Recommended rules", value: o.recommendation.rules, emphasize: true },
        { label: "Controls per run (N)", value: String(o.recommendation.N), emphasize: true },
        { label: "Allowable imprecision", value: fmt(o.operatingPoint.allowableImprecision, 3), hint: "CV / TEa" },
        { label: "Allowable inaccuracy", value: fmt(o.operatingPoint.allowableInaccuracy, 3), hint: "|Bias| / TEa" },
      ],
      interpretation: o.recommendation.note,
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Inputs">
        <SigmaInputFields form={form} />
        <QCButtonRow onCalculate={() => calculateFrom(form.values)} onReset={handleReset} />
        {calcError ? <Text style={{ color: t.error, fontSize: 13 }}>{calcError}</Text> : null}
      </QCSection>

      {model && result ? (
        <>
          <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} />
          <QCSection title="Normalized OPSpecs chart">
            <SigmaDecisionChart
              operatingPoint={{
                x: result.opspecs.operatingPoint.allowableImprecision,
                y: result.opspecs.operatingPoint.allowableInaccuracy,
              }}
              sigmaLines={result.grid.sigmaLines}
              xAxisLabel="Allowable imprecision (CV / TEa)"
              yAxisLabel="Allowable inaccuracy (Bias / TEa)"
            />
          </QCSection>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="opspecs"
        currentRun={
          result
            ? {
                inputs: { ...form.values },
                summary: `σ = ${fmt(result.opspecs.sigma)} · ${result.opspecs.recommendation.rules}`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}
