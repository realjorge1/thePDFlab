/**
 * Shared, Scientia-style result model for the QC calculators.
 *
 * Each tool maps its engine output into a `QCResultModel`; `QCResultPanel`
 * renders it identically everywhere (headline + verdict, formula, variable
 * chips, step-by-step working, a metrics grid, interpretation and warnings).
 * The engine (utils/qcCalculators.ts) stays pure — this is display shaping only.
 */
import type { SigmaClassification } from "@/utils/qcCalculators";

export type VerdictTone = "excellent" | "good" | "warn" | "bad" | "neutral";

export interface QCVariable {
  symbol: string;
  value: string;
  unit?: string;
}

export interface QCMetric {
  label: string;
  value: string;
  /** Optional secondary caption under the value. */
  hint?: string;
  /** Draw attention to a key metric. */
  emphasize?: boolean;
}

export interface QCResultModel {
  /** The single most important number, shown large. */
  headline: { value: string; unit?: string; label: string };
  verdict?: { label: string; tone: VerdictTone };
  /** Human-readable formula, e.g. "σ = (TEa − |Bias|) / CV". */
  formula?: string;
  /** Inputs echoed back as chips. */
  variables?: QCVariable[];
  /** Ordered working, one line per step. */
  steps?: string[];
  /** Everything-else numbers, as a grid. */
  metrics?: QCMetric[];
  /** Plain-language "what this means" paragraph(s). */
  interpretation?: string;
  /** Cautions / method limitations. */
  warnings?: string[];
}

const TONE_BY_CLASSIFICATION: Record<SigmaClassification, VerdictTone> = {
  "world-class": "excellent",
  excellent: "excellent",
  good: "good",
  marginal: "warn",
  poor: "bad",
  unacceptable: "bad",
};

const LABEL_BY_CLASSIFICATION: Record<SigmaClassification, string> = {
  "world-class": "World class",
  excellent: "Excellent",
  good: "Good",
  marginal: "Marginal",
  poor: "Poor",
  unacceptable: "Unacceptable",
};

/** Map a sigma classification (+ optional band) to a verdict badge. */
export function classificationVerdict(
  classification: SigmaClassification,
  band?: string,
): { label: string; tone: VerdictTone } {
  return {
    label:
      LABEL_BY_CLASSIFICATION[classification] + (band ? `  ·  ${band}` : ""),
    tone: TONE_BY_CLASSIFICATION[classification],
  };
}

/** Flatten a model into copy-to-clipboard plain text. */
export function toCopyText(title: string, model: QCResultModel): string {
  const lines: string[] = [title];
  lines.push(
    `${model.headline.label}: ${model.headline.value}${
      model.headline.unit ? ` ${model.headline.unit}` : ""
    }`,
  );
  if (model.verdict) lines.push(`Verdict: ${model.verdict.label}`);
  if (model.formula) lines.push(`Formula: ${model.formula}`);
  if (model.variables?.length) {
    lines.push(
      "Inputs: " +
        model.variables
          .map((v) => `${v.symbol}=${v.value}${v.unit ?? ""}`)
          .join("  "),
    );
  }
  if (model.metrics?.length) {
    for (const m of model.metrics) lines.push(`${m.label}: ${m.value}`);
  }
  if (model.steps?.length) {
    lines.push("Working:");
    model.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  if (model.interpretation) lines.push(`Interpretation: ${model.interpretation}`);
  if (model.warnings?.length) {
    for (const w of model.warnings) lines.push(`Note: ${w}`);
  }
  return lines.join("\n");
}
