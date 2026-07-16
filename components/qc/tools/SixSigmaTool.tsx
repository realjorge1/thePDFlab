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

const TOOL = getQcTool("six-sigma")!;

const FORMULA = `Sigma = (TEa − |Bias|) / CV

All inputs in percent.
Example: (10 − |2|) / 1.5 = 5.33

Bands:
  σ ≥ 6   world class
  5 – 6   excellent
  4 – 5   good
  3 – 4   marginal
  2 – 3   poor
  σ < 2   unacceptable`;

function interpret(r: QC.SixSigmaResult): string {
  const strategy =
    r.sigma >= 5
      ? "A single 1-3s rule with N=2 gives ample error detection."
      : r.sigma >= 4
        ? "Use a short multirule (1-3s / 2-2s / R-4s) with N=2."
        : r.sigma >= 3
          ? "A full multirule with N=4 is needed to control this method."
          : "Even maximum QC gives limited detection — improve the method rather than adding QC.";
  return (
    `A sigma metric of ${fmt(r.sigma)} rates the method "${r.classification}". ` +
    `On a defect scale, higher sigma means fewer results exceeding your total ` +
    `allowable error. ${strategy}`
  );
}

export function SixSigmaTool() {
  const { colors: t } = useTheme();
  const form = useSigmaForm();
  const [result, setResult] = useState<QC.SixSigmaResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  const calculateFrom = useCallback(
    (values: SigmaFormValues) => {
      const parsed = form.validate(values);
      if (!parsed) {
        setResult(null);
        return;
      }
      try {
        setResult(QC.sixSigma(parsed));
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
    const { tea, bias, cv } = result.inputs;
    const numerator = tea - Math.abs(bias);
    const te = QC.totalError(bias, cv);
    return {
      headline: { label: "Sigma metric", value: fmt(result.sigma), unit: "σ" },
      verdict: classificationVerdict(result.classification, result.band),
      formula: "σ = (TEa − |Bias|) / CV",
      variables: [
        { symbol: "TEa", value: fmt(tea), unit: "%" },
        { symbol: "Bias", value: fmt(bias), unit: "%" },
        { symbol: "CV", value: fmt(cv), unit: "%" },
      ],
      steps: [
        `TEa − |Bias| = ${fmt(tea)} − ${fmt(Math.abs(bias))} = ${fmt(numerator)}`,
        `÷ CV = ${fmt(numerator)} / ${fmt(cv)} = ${fmt(result.sigma)} σ`,
      ],
      metrics: [
        { label: "Total error (est.)", value: `${fmt(te)} %`, hint: "|bias| + 1.65·CV" },
        { label: "Allowable error", value: `${fmt(tea)} %`, hint: "TEa budget" },
      ],
      interpretation: interpret(result),
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

      {model ? <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} /> : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="six-sigma"
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
