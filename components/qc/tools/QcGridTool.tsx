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

const TOOL = getQcTool("qc-grid")!;

const FORMULA = `Method decision chart, axes normalized
to TEa:
  x = CV / TEa      (imprecision)
  y = |Bias| / TEa  (inaccuracy)

Each σ boundary is the line y = 1 − σ·x.
A method plotted below/left of a boundary
performs at least at that sigma level.`;

export function QcGridTool() {
  const { colors: t } = useTheme();
  const form = useSigmaForm();
  const [result, setResult] = useState<QC.QcGridResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  const calculateFrom = useCallback(
    (values: SigmaFormValues) => {
      const parsed = form.validate(values);
      if (!parsed) {
        setResult(null);
        return;
      }
      try {
        setResult(QC.qcGrid(parsed));
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
    return {
      headline: { label: "Sigma metric", value: fmt(result.sigma), unit: "σ" },
      verdict: classificationVerdict(result.classification),
      formula: "operating point: x = CV/TEa, y = |Bias|/TEa  ·  boundary y = 1 − σ·x",
      metrics: [
        { label: "Imprecision x", value: fmt(result.operatingPoint.xImprecision, 3), hint: "CV / TEa" },
        { label: "Inaccuracy y", value: fmt(result.operatingPoint.yInaccuracy, 3), hint: "|Bias| / TEa" },
      ],
      interpretation:
        `The method's operating point falls in the "${result.classification}" ` +
        `zone of the decision chart. Points nearer the origin (lower ` +
        `imprecision and inaccuracy relative to TEa) indicate higher sigma and ` +
        `simpler QC requirements.`,
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
          <QCSection title="Method decision chart">
            <SigmaDecisionChart
              operatingPoint={{
                x: result.operatingPoint.xImprecision,
                y: result.operatingPoint.yInaccuracy,
              }}
              sigmaLines={result.sigmaLines}
              xAxisLabel="Imprecision (CV / TEa)"
              yAxisLabel="Inaccuracy (Bias / TEa)"
            />
          </QCSection>
        </>
      ) : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="qc-grid"
        currentRun={
          result
            ? {
                inputs: { ...form.values },
                summary: `σ = ${fmt(result.sigma)} · ${result.classification}`,
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}
