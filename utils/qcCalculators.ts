/**
 * QC Calculators — pure, dependency-free statistical engine for the
 * Westgard-style method-validation tool suite.
 *
 * Every function here is deterministic, synchronous and fully offline.
 * No side effects, no I/O, no globals. Inputs are validated and invalid
 * input throws a plain `Error` with a user-readable message — callers
 * (the calculator screens) mirror these guards and catch defensively.
 *
 * All percent-based inputs (TEa, bias, CV, allowable error) are expressed
 * in PERCENT units, e.g. `tea: 10` means a total allowable error of 10%.
 */

// ─── Legal / intended-use text ────────────────────────────────────────────────
// Canonical strings surfaced across the QC calculator screens. Edit here and
// every screen updates.

/** Intended-use / disclaimer shown on the calculator screens. */
export const DISCLAIMER =
  "For laboratory quality-control support only. These calculators are a " +
  "decision-support aid for qualified laboratory personnel and are not a " +
  "diagnostic device. They do not determine the acceptability or release of " +
  "patient results. All outputs must be reviewed and interpreted by a " +
  "competent laboratory professional, who is responsible for verifying inputs " +
  "and for any decisions made. This software does not replace " +
  "regulatory-cleared QC systems, applicable standards, or professional " +
  "judgment.";

/** Method attribution & non-endorsement statement for an About/Legal screen. */
export const ATTRIBUTION =
  "The statistical methods used here are established, publicly documented " +
  "techniques in clinical laboratory science, drawn from the general " +
  "method-validation and statistical quality-control literature (including " +
  "CLSI guidelines such as EP26-A, EP06, EP15 and C24, standard " +
  "clinical-chemistry texts, and peer-reviewed publications). This " +
  "application is independently developed and is not affiliated with, " +
  "endorsed by, or certified by any standards organization or provider of " +
  "quality-control tools or training. Common method names are used " +
  "descriptively to identify recognized techniques, not to imply endorsement.";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DescriptiveStats {
  n: number;
  mean: number;
  sd: number;
  variance: number;
  /** Coefficient of variation, in percent. NaN when mean is 0. */
  cv: number;
  sem: number;
  min: number;
  max: number;
  range: number;
  sum: number;
  /** Sample median (50th percentile, linear interpolation). */
  median: number;
  /** First quartile (25th percentile). */
  q1: number;
  /** Third quartile (75th percentile). */
  q3: number;
  /** Interquartile range, q3 − q1. */
  iqr: number;
  /** Lower bound of the 95% confidence interval of the mean (t-based). */
  ci95Lower: number;
  /** Upper bound of the 95% confidence interval of the mean (t-based). */
  ci95Upper: number;
}

export type SigmaClassification =
  | "unacceptable"
  | "poor"
  | "marginal"
  | "good"
  | "excellent"
  | "world-class";

export interface SigmaInputs {
  /** Total allowable error, % */
  tea: number;
  /** Bias, % (may be negative; magnitude is used) */
  bias: number;
  /** Coefficient of variation (imprecision), % */
  cv: number;
}

export interface SixSigmaResult {
  sigma: number;
  classification: SigmaClassification;
  /** Human-readable band label, e.g. "5 ≤ σ < 6" */
  band: string;
  inputs: SigmaInputs;
}

export interface ControlLimitsResult {
  mean: number;
  sd: number;
  cv: number;
  limits: {
    plus1s: number;
    minus1s: number;
    plus2s: number;
    minus2s: number;
    plus3s: number;
    minus3s: number;
  };
}

export interface QcGridResult {
  sigma: number;
  classification: SigmaClassification;
  /** Normalized to TEa: x = CV/TEa, y = |bias|/TEa (0..1 on-chart). */
  operatingPoint: { xImprecision: number; yInaccuracy: number };
  /** Straight boundary lines y = 1 − σ·x, given as endpoint pairs. */
  sigmaLines: { sigma: number; points: { x: number; y: number }[] }[];
}

export interface OpSpecsResult {
  sigma: number;
  classification: SigmaClassification;
  recommendation: { rules: string; N: number; note: string };
  operatingPoint: { allowableImprecision: number; allowableInaccuracy: number };
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  r: number;
  r2: number;
  /** Standard error of the estimate (Sy/x). NaN when n < 3. */
  syx: number;
  n: number;
}

export interface ReportableRangeLevelResult {
  assigned: number;
  n: number;
  meanMeasured: number;
  /** NaN when fewer than 2 replicates. */
  sd: number;
  /** NaN when fewer than 2 replicates or mean is 0. */
  cv: number;
}

export interface ReportableRangeQuantifyResult {
  regression: RegressionResult;
  points: {
    assigned: number;
    measured: number;
    predicted: number;
    errorAbs: number;
    errorPct: number;
    withinAllowable: boolean;
  }[];
  reportableRange: { low: number; high: number } | null;
  allowableErrorPct: number;
}

export interface CriticalNResult {
  criticalN: number | null;
  observedSD: number;
  allowableSD: number;
  confidence: number;
  note: string;
}

// ─── Input guards ─────────────────────────────────────────────────────────────

function assertFiniteNumbers(values: number[], what: string): void {
  if (!Array.isArray(values)) {
    throw new Error(`${what} must be a list of numbers.`);
  }
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`${what} must contain only valid numbers.`);
    }
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a number greater than 0.`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a valid number.`);
  }
}

// ─── 3.1 Dispersion / shared stats ────────────────────────────────────────────

/**
 * Descriptive statistics of a data set. Requires at least 2 values
 * (SD is the sample standard deviation, n − 1 denominator).
 */
export function describe(values: number[]): DescriptiveStats {
  assertFiniteNumbers(values, "Data");
  const n = values.length;
  if (n < 2) {
    throw new Error("At least 2 values are required to calculate SD.");
  }
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const ss = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const variance = ss / (n - 1);
  const sd = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sem = sd / Math.sqrt(n);
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  // 95% CI of the mean uses the two-sided Student-t critical value.
  const tCrit = studentTQuantile(0.975, n - 1);
  const halfWidth = tCrit * sem;
  return {
    n,
    mean,
    sd,
    variance,
    cv: mean === 0 ? Number.NaN : (sd / mean) * 100,
    sem,
    min,
    max,
    range: max - min,
    sum,
    median: quantileSorted(sorted, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    ci95Lower: mean - halfWidth,
    ci95Upper: mean + halfWidth,
  };
}

/**
 * Linear-interpolation quantile of a pre-sorted array (R "type 7").
 * `p` in [0, 1]. Empty → NaN.
 */
function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ─── Total error & SDI (clinical QC helpers) ──────────────────────────────────

/**
 * Estimated total analytical error, in percent: TE = |bias| + z·CV.
 * Default z = 1.65 (one-sided 95%). All inputs/outputs in percent.
 */
export function totalError(bias: number, cv: number, z = 1.65): number {
  assertFinite(bias, "Bias (%)");
  assertPositive(cv, "CV (%)");
  assertPositive(z, "z");
  return Math.abs(bias) + z * cv;
}

/**
 * Standard Deviation Index / z-score of a single QC result against a peer or
 * target mean and SD: SDI = (observed − mean) / SD.
 */
export function sdiZScore(observed: number, mean: number, sd: number): number {
  assertFinite(observed, "Observed value");
  assertFinite(mean, "Target mean");
  assertPositive(sd, "Target SD");
  return (observed - mean) / sd;
}

// ─── 3.2 Replication ──────────────────────────────────────────────────────────

/**
 * Replication experiment: descriptive stats where the SD is reported as the
 * measurement standard deviation (smeas).
 */
export function replication(
  values: number[],
): DescriptiveStats & { smeas: number } {
  const stats = describe(values);
  return { ...stats, smeas: stats.sd };
}

// ─── 3.3 Control limits (Levey-Jennings) ──────────────────────────────────────

/**
 * Control limits at ±1s/2s/3s, from either raw QC values or a known mean/SD.
 */
export function controlLimits(
  input: number[] | { mean: number; sd: number },
): ControlLimitsResult {
  let mean: number;
  let sd: number;
  let cv: number;
  if (Array.isArray(input)) {
    const stats = describe(input);
    mean = stats.mean;
    sd = stats.sd;
    cv = stats.cv;
  } else {
    assertFinite(input.mean, "Mean");
    assertPositive(input.sd, "SD");
    mean = input.mean;
    sd = input.sd;
    cv = mean === 0 ? Number.NaN : (sd / mean) * 100;
  }
  return {
    mean,
    sd,
    cv,
    limits: {
      plus1s: mean + sd,
      minus1s: mean - sd,
      plus2s: mean + 2 * sd,
      minus2s: mean - 2 * sd,
      plus3s: mean + 3 * sd,
      minus3s: mean - 3 * sd,
    },
  };
}

// ─── 3.4 Six Sigma ────────────────────────────────────────────────────────────

const SIGMA_BANDS: { min: number; classification: SigmaClassification; band: string }[] =
  [
    { min: 6, classification: "world-class", band: "σ ≥ 6" },
    { min: 5, classification: "excellent", band: "5 ≤ σ < 6" },
    { min: 4, classification: "good", band: "4 ≤ σ < 5" },
    { min: 3, classification: "marginal", band: "3 ≤ σ < 4" },
    { min: 2, classification: "poor", band: "2 ≤ σ < 3" },
    { min: -Infinity, classification: "unacceptable", band: "σ < 2" },
  ];

function classifySigma(sigma: number): {
  classification: SigmaClassification;
  band: string;
} {
  const found = SIGMA_BANDS.find((b) => sigma >= b.min);
  // The -Infinity sentinel guarantees a match for any finite sigma.
  const bandDef = found ?? SIGMA_BANDS[SIGMA_BANDS.length - 1];
  return { classification: bandDef.classification, band: bandDef.band };
}

function validateSigmaInputs({ tea, bias, cv }: SigmaInputs): void {
  assertPositive(tea, "TEa (%)");
  assertFinite(bias, "Bias (%)");
  assertPositive(cv, "CV (%)");
}

/**
 * Sigma metric: σ = (TEa − |bias|) / CV, all inputs in percent.
 */
export function sixSigma(inputs: SigmaInputs): SixSigmaResult {
  validateSigmaInputs(inputs);
  const { tea, bias, cv } = inputs;
  const sigma = (tea - Math.abs(bias)) / cv;
  return { sigma, ...classifySigma(sigma), inputs: { tea, bias, cv } };
}

// ─── 3.5 QC Grid (Method Decision Chart) ──────────────────────────────────────

const DEFAULT_SIGMA_LEVELS = [2, 3, 4, 5, 6];

/**
 * Method decision chart: the operating point and the σ boundary lines,
 * normalized to TEa (x = CV/TEa imprecision, y = |bias|/TEa inaccuracy).
 * Each boundary is the straight line y = 1 − σ·x.
 */
export function qcGrid(
  inputs: SigmaInputs & { sigmaLevels?: number[] },
): QcGridResult {
  validateSigmaInputs(inputs);
  const { tea, bias, cv } = inputs;
  const sigmaLevels = inputs.sigmaLevels ?? DEFAULT_SIGMA_LEVELS;
  assertFiniteNumbers(sigmaLevels, "Sigma levels");
  const sigma = (tea - Math.abs(bias)) / cv;
  return {
    sigma,
    classification: classifySigma(sigma).classification,
    operatingPoint: {
      xImprecision: cv / tea,
      yInaccuracy: Math.abs(bias) / tea,
    },
    sigmaLines: sigmaLevels.map((s) => ({
      sigma: s,
      points: [
        { x: 0, y: 1 },
        { x: 1 / s, y: 0 },
      ],
    })),
  };
}

// ─── 3.6 Normalized OPSpecs ───────────────────────────────────────────────────

const OPSPECS_RECOMMENDATIONS: {
  min: number;
  rules: string;
  N: number;
  note: string;
}[] = [
  {
    min: 6,
    rules: "1-3s",
    N: 2,
    note: "World-class performance. A single wide rule with N=2 provides ample error detection with a minimal false-rejection rate.",
  },
  {
    min: 5,
    rules: "1-3s",
    N: 2,
    note: "Excellent performance. Single-rule QC (1-3s, N=2) is sufficient.",
  },
  {
    min: 4,
    rules: "1-3s / 2-2s / R-4s",
    N: 2,
    note: "Good performance. Use a simple multirule procedure with 2 control measurements per run.",
  },
  {
    min: 3,
    rules: "1-3s / 2-2s / R-4s / 4-1s",
    N: 4,
    note: "Marginal performance. Use a full multirule procedure with 4 control measurements per run.",
  },
  {
    min: -Infinity,
    rules: "1-3s / 2-2s / R-4s / 4-1s / 8-x (maximum QC)",
    N: 6,
    note: "Poor performance. Even maximum QC gives limited error detection — method improvement is required, not just more QC.",
  },
];

/**
 * Normalized OPSpecs: the operating point on a chart whose axes are
 * normalized to TEa, plus a rule/N recommendation for the sigma level.
 */
export function normalizedOpSpecs(inputs: SigmaInputs): OpSpecsResult {
  validateSigmaInputs(inputs);
  const { tea, bias, cv } = inputs;
  const sigma = (tea - Math.abs(bias)) / cv;
  const rec =
    OPSPECS_RECOMMENDATIONS.find((r) => sigma >= r.min) ??
    OPSPECS_RECOMMENDATIONS[OPSPECS_RECOMMENDATIONS.length - 1];
  return {
    sigma,
    classification: classifySigma(sigma).classification,
    recommendation: { rules: rec.rules, N: rec.N, note: rec.note },
    operatingPoint: {
      allowableImprecision: cv / tea,
      allowableInaccuracy: Math.abs(bias) / tea,
    },
  };
}

// ─── Linear regression (shared by reportable range) ───────────────────────────

/**
 * Ordinary least-squares regression of y on x. Requires at least 2 points
 * with non-constant x. Sy/x is NaN when n < 3 (zero degrees of freedom).
 */
export function linearRegression(x: number[], y: number[]): RegressionResult {
  assertFiniteNumbers(x, "X values");
  assertFiniteNumbers(y, "Y values");
  if (x.length !== y.length) {
    throw new Error("X and Y must have the same number of values.");
  }
  const n = x.length;
  if (n < 2) {
    throw new Error("At least 2 points are required for regression.");
  }
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0) {
    throw new Error("X values must not all be identical.");
  }
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy);
  const sse = syy - slope * sxy;
  const syx = n > 2 ? Math.sqrt(Math.max(0, sse) / (n - 2)) : Number.NaN;
  return { slope, intercept, r, r2: r * r, syx, n };
}

// ─── 3.7 Reportable range — recording results ─────────────────────────────────

/**
 * Per-level summary of a reportable-range (linearity) experiment:
 * mean, SD and CV of the replicates measured at each assigned level.
 */
export function reportableRangeRecord(
  levels: { assigned: number; replicates: number[] }[],
): ReportableRangeLevelResult[] {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("At least one level is required.");
  }
  return levels.map((level, i) => {
    assertFinite(level.assigned, `Assigned value for level ${i + 1}`);
    assertFiniteNumbers(level.replicates, `Replicates for level ${i + 1}`);
    const n = level.replicates.length;
    if (n === 0) {
      throw new Error(`Level ${i + 1} needs at least one replicate.`);
    }
    const mean = level.replicates.reduce((a, b) => a + b, 0) / n;
    let sd = Number.NaN;
    if (n >= 2) {
      const ss = level.replicates.reduce(
        (a, b) => a + (b - mean) * (b - mean),
        0,
      );
      sd = Math.sqrt(ss / (n - 1));
    }
    return {
      assigned: level.assigned,
      n,
      meanMeasured: mean,
      sd,
      cv: !Number.isNaN(sd) && mean !== 0 ? (sd / mean) * 100 : Number.NaN,
    };
  });
}

// ─── 3.8 Reportable range — quantifying errors ────────────────────────────────

/**
 * Regression of measured vs assigned, per-level systematic error against an
 * allowable-error budget, and the widest contiguous span of passing levels
 * as the reportable range (null when fewer than 2 consecutive levels pass).
 */
export function reportableRangeQuantify(input: {
  points: { assigned: number; measured: number }[];
  allowableErrorPct: number;
}): ReportableRangeQuantifyResult {
  const { points, allowableErrorPct } = input;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("At least 2 assigned/measured points are required.");
  }
  assertPositive(allowableErrorPct, "Allowable error (%)");
  for (const [i, p] of points.entries()) {
    assertFinite(p.assigned, `Assigned value for point ${i + 1}`);
    assertFinite(p.measured, `Measured value for point ${i + 1}`);
    if (p.assigned === 0) {
      throw new Error(
        `Assigned value for point ${i + 1} must not be 0 (percent error is undefined).`,
      );
    }
  }

  const sorted = [...points].sort((a, b) => a.assigned - b.assigned);
  const regression = linearRegression(
    sorted.map((p) => p.assigned),
    sorted.map((p) => p.measured),
  );

  const evaluated = sorted.map((p) => {
    const errorAbs = p.measured - p.assigned;
    const errorPct = (errorAbs / p.assigned) * 100;
    return {
      assigned: p.assigned,
      measured: p.measured,
      predicted: regression.slope * p.assigned + regression.intercept,
      errorAbs,
      errorPct,
      withinAllowable: Math.abs(errorPct) <= allowableErrorPct,
    };
  });

  // Widest contiguous run (by assigned order) of passing levels, ≥ 2 levels.
  let best: { start: number; end: number } | null = null;
  let runStart = -1;
  for (let i = 0; i <= evaluated.length; i++) {
    const passing = i < evaluated.length && evaluated[i].withinAllowable;
    if (passing && runStart < 0) runStart = i;
    if (!passing && runStart >= 0) {
      const end = i - 1;
      if (end > runStart) {
        const span = evaluated[end].assigned - evaluated[runStart].assigned;
        const bestSpan = best
          ? evaluated[best.end].assigned - evaluated[best.start].assigned
          : -1;
        if (span > bestSpan) best = { start: runStart, end };
      }
      runStart = -1;
    }
  }

  return {
    regression,
    points: evaluated,
    reportableRange: best
      ? {
          low: evaluated[best.start].assigned,
          high: evaluated[best.end].assigned,
        }
      : null,
    allowableErrorPct,
  };
}

// ─── Lot-to-lot comparison (reagent lot verification) ─────────────────────────

export interface LotToLotResult {
  n: number;
  meanOld: number;
  meanNew: number;
  /** Mean of (new − old) paired differences. */
  meanDiff: number;
  /** Mean of per-pair percent differences, 100·(new − old)/old. */
  meanDiffPct: number;
  /** Sample SD of the paired differences. */
  sdDiff: number;
  pairs: {
    oldLot: number;
    newLot: number;
    diff: number;
    diffPct: number;
    withinAllowable: boolean;
  }[];
  passing: number;
  failing: number;
  /** Acceptable when |mean %difference| is within the allowable limit. */
  verdict: "acceptable" | "unacceptable";
  allowableDifferencePct: number;
}

/**
 * Reagent lot-to-lot verification: paired results for the same samples
 * measured with the current (old) and the candidate (new) lot. Reports the
 * per-sample and mean differences against an allowable-difference budget.
 * The overall verdict follows the mean percent difference; per-sample flags
 * are also returned so outliers stay visible.
 */
export function lotToLot(input: {
  pairs: { oldLot: number; newLot: number }[];
  allowableDifferencePct: number;
}): LotToLotResult {
  const { pairs, allowableDifferencePct } = input;
  if (!Array.isArray(pairs) || pairs.length < 2) {
    throw new Error("At least 2 sample pairs are required.");
  }
  assertPositive(allowableDifferencePct, "Allowable difference (%)");
  for (const [i, p] of pairs.entries()) {
    assertFinite(p.oldLot, `Old-lot result for sample ${i + 1}`);
    assertFinite(p.newLot, `New-lot result for sample ${i + 1}`);
    if (p.oldLot === 0) {
      throw new Error(
        `Old-lot result for sample ${i + 1} must not be 0 (percent difference is undefined).`,
      );
    }
  }

  const evaluated = pairs.map((p) => {
    const diff = p.newLot - p.oldLot;
    const diffPct = (diff / p.oldLot) * 100;
    return {
      oldLot: p.oldLot,
      newLot: p.newLot,
      diff,
      diffPct,
      withinAllowable: Math.abs(diffPct) <= allowableDifferencePct,
    };
  });

  const n = evaluated.length;
  const meanOld = evaluated.reduce((a, p) => a + p.oldLot, 0) / n;
  const meanNew = evaluated.reduce((a, p) => a + p.newLot, 0) / n;
  const meanDiff = evaluated.reduce((a, p) => a + p.diff, 0) / n;
  const meanDiffPct = evaluated.reduce((a, p) => a + p.diffPct, 0) / n;
  const ssDiff = evaluated.reduce(
    (a, p) => a + (p.diff - meanDiff) * (p.diff - meanDiff),
    0,
  );
  const sdDiff = Math.sqrt(ssDiff / (n - 1));
  const passing = evaluated.filter((p) => p.withinAllowable).length;

  return {
    n,
    meanOld,
    meanNew,
    meanDiff,
    meanDiffPct,
    sdDiff,
    pairs: evaluated,
    passing,
    failing: n - passing,
    verdict:
      Math.abs(meanDiffPct) <= allowableDifferencePct
        ? "acceptable"
        : "unacceptable",
    allowableDifferencePct,
  };
}

// ─── 3.9 Critical number of test samples ──────────────────────────────────────

// KNOWN LIMITATION — intentional, do not "fix": this estimates the critical N
// using the chi-square upper confidence bound on an estimated SD, not the
// (unpublished) formula behind the Westgard guest tool. The `note` field must
// be surfaced to the user. Parity, if ever required, is a separate task.

const CRITICAL_N_NOTE =
  "Critical N is estimated as the smallest number of samples for which the " +
  "upper chi-square confidence bound of the observed SD falls within the " +
  "allowable SD. This approximation may differ from the original Westgard " +
  "guest calculator, whose exact formula is unpublished.";

/**
 * Smallest N such that the upper (confidence)-level chi-square bound of the
 * observed SD is ≤ the allowable SD. Returns null when unattainable (always
 * the case when observed SD ≥ allowable SD) within maxN.
 */
export function criticalNumberOfTestSamples(input: {
  observedSD: number;
  allowableSD: number;
  confidence?: number;
  maxN?: number;
}): CriticalNResult {
  const { observedSD, allowableSD } = input;
  const confidence = input.confidence ?? 0.9;
  const maxN = input.maxN ?? 2000;
  assertPositive(observedSD, "Observed SD");
  assertPositive(allowableSD, "Allowable SD");
  if (!(confidence > 0 && confidence < 1)) {
    throw new Error("Confidence must be between 0 and 1 (e.g. 0.90).");
  }
  if (!Number.isInteger(maxN) || maxN < 2) {
    throw new Error("maxN must be an integer of at least 2.");
  }

  const base = {
    observedSD,
    allowableSD,
    confidence,
    note: CRITICAL_N_NOTE,
  };

  // The chi-square upper bound is always strictly greater than the observed
  // SD, so an allowable SD at or below the observed SD is never attainable.
  if (allowableSD <= observedSD) {
    return { criticalN: null, ...base };
  }

  const targetRatioSq = (allowableSD / observedSD) ** 2;
  for (let n = 2; n <= maxN; n++) {
    const df = n - 1;
    // Upper bound: SD_upper = observedSD * sqrt(df / chi2_{1-conf, df}),
    // where chi2 is the lower-tail quantile at p = 1 − confidence.
    const chi2 = chiSquareQuantile(1 - confidence, df);
    if (df / chi2 <= targetRatioSq) {
      return { criticalN: n, ...base };
    }
  }
  return { criticalN: null, ...base };
}

// ─── Chi-square quantile (internal numerics) ──────────────────────────────────

/** Natural log of the gamma function (Lanczos approximation). */
function gammln(xx: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized lower incomplete gamma function P(a, x). */
function gammp(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new Error("Invalid arguments for gammp.");
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series representation.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let i = 0; i < 500; i++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
  }
  // Continued fraction for Q(a, x), then P = 1 − Q.
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
  return 1 - q;
}

/** Chi-square CDF with `df` degrees of freedom. */
function chiSquareCdf(x: number, df: number): number {
  return gammp(df / 2, x / 2);
}

/**
 * Lower-tail chi-square quantile: the x with CDF(x, df) = p.
 * Solved by bisection — monotone, bounded, deterministic.
 */
function chiSquareQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) {
    throw new Error("Quantile probability must be between 0 and 1.");
  }
  let lo = 0;
  let hi = df + 20 * Math.sqrt(2 * df) + 100;
  while (chiSquareCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (chiSquareCdf(mid, df) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-10 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

// ─── Student-t quantile (internal numerics) ───────────────────────────────────

/** Continued fraction for the incomplete beta function (Numerical Recipes). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammln(a + b) -
      gammln(a) -
      gammln(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** CDF of the Student-t distribution with `df` degrees of freedom. */
function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ib = betai(df / 2, 0.5, x);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

/**
 * Lower-tail Student-t quantile: the t with CDF(t, df) = p.
 * Solved by bisection — monotone, bounded, deterministic. `df` ≥ 1.
 */
function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) {
    throw new Error("Quantile probability must be between 0 and 1.");
  }
  if (!(df >= 1)) {
    throw new Error("Degrees of freedom must be at least 1.");
  }
  let lo = -1000;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}
