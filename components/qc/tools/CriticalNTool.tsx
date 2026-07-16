import {
  FormulaSection,
  QCButtonRow,
  QCNote,
  QCNumberField,
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
import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";

const TOOL = getQcTool("critical-n")!;

const FORMULA = `Upper confidence bound of an SD
estimated from n samples:

  SDᵤ = SD_obs · √( (n−1) / χ²(α, n−1) )
  α = 1 − confidence

Critical N = smallest n with
  SDᵤ ≤ allowable SD.`;

const LIMITATION =
  "Known limitation: this tool uses the chi-square upper confidence bound " +
  "on an estimated SD, not the (unpublished) formula behind the Westgard " +
  "guest calculator. Results may differ slightly from that tool.";

interface InputsState {
  observedSD: string;
  allowableSD: string;
  confidencePct: string;
}

const EMPTY: InputsState = { observedSD: "", allowableSD: "", confidencePct: "90" };

type FieldErrors = Partial<Record<keyof InputsState, string>>;

export function CriticalNTool() {
  const { colors: t } = useTheme();
  const [inputs, setInputs] = useState<InputsState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [calcError, setCalcError] = useState<string | null>(null);
  const [result, setResult] = useState<QC.CriticalNResult | null>(null);

  const calculateFrom = useCallback((source: InputsState) => {
    const observedSD = parseDecimal(source.observedSD);
    const allowableSD = parseDecimal(source.allowableSD);
    const confidencePct = parseDecimal(source.confidencePct);
    const next: FieldErrors = {};
    if (observedSD === null || observedSD <= 0)
      next.observedSD = "Observed SD must be greater than 0.";
    if (allowableSD === null || allowableSD <= 0)
      next.allowableSD = "Allowable SD must be greater than 0.";
    if (confidencePct === null || confidencePct <= 0 || confidencePct >= 100)
      next.confidencePct = "Confidence must be between 0 and 100 (e.g. 90).";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setResult(null);
      return;
    }
    try {
      setResult(
        QC.criticalNumberOfTestSamples({
          observedSD: observedSD as number,
          allowableSD: allowableSD as number,
          confidence: (confidencePct as number) / 100,
        }),
      );
      setCalcError(null);
    } catch (e) {
      setResult(null);
      setCalcError(e instanceof Error ? e.message : "Could not calculate.");
    }
  }, []);

  const handleReset = useCallback(() => {
    setInputs(EMPTY);
    setErrors({});
    setCalcError(null);
    setResult(null);
  }, []);

  const handleRestore = useCallback(
    (saved: Record<string, string>) => {
      const restored: InputsState = {
        observedSD: saved.observedSD ?? "",
        allowableSD: saved.allowableSD ?? "",
        confidencePct: saved.confidencePct ?? "90",
      };
      setInputs(restored);
      calculateFrom(restored);
    },
    [calculateFrom],
  );

  const model = useMemo<QCResultModel | null>(() => {
    if (!result) return null;
    const attainable = result.criticalN !== null;
    return {
      headline: attainable
        ? { label: "Critical N", value: String(result.criticalN), unit: "samples" }
        : { label: "Critical N", value: "—" },
      verdict: attainable
        ? { label: `${fmt(result.confidence * 100, 0)}% confidence`, tone: "good" }
        : { label: "Not attainable", tone: "bad" },
      formula: "SDᵤ = SD_obs · √((n−1) / χ²(α, n−1));  smallest n with SDᵤ ≤ allowable SD",
      metrics: [
        { label: "Observed SD", value: fmt(result.observedSD, 4) },
        { label: "Allowable SD", value: fmt(result.allowableSD, 4) },
        { label: "Confidence", value: `${fmt(result.confidence * 100, 0)} %` },
      ],
      interpretation: attainable
        ? `You need at least ${result.criticalN} samples so the upper ` +
          `${fmt(result.confidence * 100, 0)}% confidence bound of the observed ` +
          `SD (${fmt(result.observedSD, 3)}) falls within the allowable SD ` +
          `(${fmt(result.allowableSD, 3)}).`
        : `No sample size can demonstrate the allowable SD: the observed SD is ` +
          `already at or above it, so its upper confidence bound can never fall ` +
          `within the allowable limit.`,
      warnings: [result.note, LIMITATION],
    };
  }, [result]);

  const insightContext = useMemo(
    () => (model ? toCopyText(TOOL.name, model) : null),
    [model],
  );

  return (
    <>
      <QCSection title="Inputs">
        <QCNumberField
          label="Observed SD"
          value={inputs.observedSD}
          onChangeText={(text) =>
            setInputs((prev) => ({ ...prev, observedSD: text }))
          }
          placeholder="e.g. 2"
          error={errors.observedSD}
        />
        <QCNumberField
          label="Allowable SD"
          value={inputs.allowableSD}
          onChangeText={(text) =>
            setInputs((prev) => ({ ...prev, allowableSD: text }))
          }
          placeholder="e.g. 3"
          error={errors.allowableSD}
        />
        <QCNumberField
          label="Confidence"
          value={inputs.confidencePct}
          onChangeText={(text) =>
            setInputs((prev) => ({ ...prev, confidencePct: text }))
          }
          unit="%"
          placeholder="90"
          error={errors.confidencePct}
        />
        <QCButtonRow
          onCalculate={() => calculateFrom(inputs)}
          onReset={handleReset}
        />
        {calcError ? (
          <Text style={{ color: t.error, fontSize: 13 }}>{calcError}</Text>
        ) : null}
      </QCSection>

      {model ? <QCResultPanel title={TOOL.name} model={model} accent={TOOL.accent} /> : null}

      <QCInsights toolName={TOOL.name} accent={TOOL.accent} context={insightContext} />

      <QCNote text={LIMITATION} />

      <FormulaSection formula={FORMULA} />

      <SavedRunsSection
        tool="critical-n"
        currentRun={
          result
            ? {
                inputs: { ...inputs },
                summary:
                  result.criticalN !== null
                    ? `Critical N = ${result.criticalN}`
                    : "Not attainable",
              }
            : null
        }
        onRestore={handleRestore}
      />
    </>
  );
}
