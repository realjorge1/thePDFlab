/**
 * Engine integration tests for the QC Calculators.
 *
 * The known-value fixtures below are pre-verified and must pass unchanged —
 * they lock the public API of utils/qcCalculators.ts. If one of these fails,
 * the engine changed behaviour; fix the engine, never the fixture.
 */
import * as QC from "@/utils/qcCalculators";

describe("qcCalculators — pre-verified fixtures", () => {
  test("sixSigma: sigma ≈ 5.333, classification excellent", () => {
    const result = QC.sixSigma({ tea: 10, bias: 2, cv: 1.5 });
    expect(result.sigma).toBeCloseTo(5.333, 3);
    expect(result.classification).toBe("excellent");
  });

  test("criticalNumberOfTestSamples: observed 2 vs allowable 3 → N = 10", () => {
    const result = QC.criticalNumberOfTestSamples({
      observedSD: 2,
      allowableSD: 3,
    });
    expect(result.criticalN).toBe(10);
  });

  test("criticalNumberOfTestSamples: observed 3 vs allowable 3 → null", () => {
    const result = QC.criticalNumberOfTestSamples({
      observedSD: 3,
      allowableSD: 3,
    });
    expect(result.criticalN).toBeNull();
  });

  test("linearRegression: slope ≈ 1.02, intercept ≈ 0.5 (±0.05)", () => {
    const { slope, intercept } = QC.linearRegression(
      [10, 20, 40, 80, 160],
      [10.7, 20.9, 41.3, 82.1, 163.7],
    );
    expect(Math.abs(slope - 1.02)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(intercept - 0.5)).toBeLessThanOrEqual(0.05);
  });

  test("controlLimits from mean/sd: +3s = 106, −2s = 96", () => {
    const { limits } = QC.controlLimits({ mean: 100, sd: 2 });
    expect(limits.plus3s).toBe(106);
    expect(limits.minus2s).toBe(96);
  });

  test("describe: n = 7, mean ≈ 100.43, sd ≈ 1.72", () => {
    const stats = QC.describe([100, 102, 99, 101, 100, 103, 98]);
    expect(stats.n).toBe(7);
    expect(stats.mean).toBeCloseTo(100.43, 2);
    expect(stats.sd).toBeCloseTo(1.72, 2);
  });
});

describe("qcCalculators — guards and behaviour", () => {
  test("describe rejects fewer than 2 values", () => {
    expect(() => QC.describe([5])).toThrow(/at least 2/i);
  });

  test("describe rejects non-numeric input", () => {
    expect(() => QC.describe([1, Number.NaN])).toThrow(/valid numbers/i);
  });

  test("sixSigma rejects non-positive CV and TEa", () => {
    expect(() => QC.sixSigma({ tea: 10, bias: 1, cv: 0 })).toThrow(/CV/);
    expect(() => QC.sixSigma({ tea: 0, bias: 1, cv: 1 })).toThrow(/TEa/);
  });

  test("sixSigma uses |bias| and classifies bands", () => {
    expect(QC.sixSigma({ tea: 10, bias: -2, cv: 1.5 }).sigma).toBeCloseTo(
      5.333,
      3,
    );
    expect(QC.sixSigma({ tea: 12, bias: 0, cv: 2 }).classification).toBe(
      "world-class",
    );
    expect(QC.sixSigma({ tea: 10, bias: 8, cv: 2 }).classification).toBe(
      "unacceptable",
    );
  });

  test("replication reports smeas equal to the sample SD", () => {
    const result = QC.replication([100, 102, 99, 101, 100, 103, 98]);
    expect(result.smeas).toBe(result.sd);
    expect(result.smeas).toBeCloseTo(1.72, 2);
  });

  test("controlLimits from raw values matches describe", () => {
    const values = [100, 102, 99, 101, 100, 103, 98];
    const stats = QC.describe(values);
    const result = QC.controlLimits(values);
    expect(result.mean).toBeCloseTo(stats.mean, 10);
    expect(result.limits.plus1s).toBeCloseTo(stats.mean + stats.sd, 10);
    expect(result.limits.minus3s).toBeCloseTo(stats.mean - 3 * stats.sd, 10);
  });

  test("qcGrid normalizes the operating point to TEa", () => {
    const result = QC.qcGrid({ tea: 10, bias: 2, cv: 1.5 });
    expect(result.operatingPoint.xImprecision).toBeCloseTo(0.15, 10);
    expect(result.operatingPoint.yInaccuracy).toBeCloseTo(0.2, 10);
    expect(result.sigmaLines.length).toBeGreaterThan(0);
    for (const line of result.sigmaLines) {
      expect(line.points[0]).toEqual({ x: 0, y: 1 });
      expect(line.points[1].y).toBe(0);
      expect(line.points[1].x).toBeCloseTo(1 / line.sigma, 10);
    }
  });

  test("normalizedOpSpecs recommends rules and N for the sigma level", () => {
    const result = QC.normalizedOpSpecs({ tea: 10, bias: 2, cv: 1.5 });
    expect(result.sigma).toBeCloseTo(5.333, 3);
    expect(result.classification).toBe("excellent");
    expect(result.recommendation.rules.length).toBeGreaterThan(0);
    expect(result.recommendation.N).toBeGreaterThanOrEqual(2);
  });

  test("reportableRangeRecord summarizes each level", () => {
    const rows = QC.reportableRangeRecord([
      { assigned: 10, replicates: [10.1, 10.3, 9.9] },
      { assigned: 100, replicates: [101, 99] },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].n).toBe(3);
    expect(rows[0].meanMeasured).toBeCloseTo(10.1, 6);
    expect(rows[1].meanMeasured).toBeCloseTo(100, 6);
    expect(rows[1].sd).toBeCloseTo(Math.SQRT2, 6);
  });

  test("reportableRangeQuantify flags levels and finds the passing span", () => {
    const result = QC.reportableRangeQuantify({
      points: [
        { assigned: 10, measured: 10.2 },
        { assigned: 50, measured: 50.5 },
        { assigned: 100, measured: 101 },
        { assigned: 200, measured: 230 }, // 15% error — out
      ],
      allowableErrorPct: 5,
    });
    expect(result.points.map((p) => p.withinAllowable)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(result.reportableRange).toEqual({ low: 10, high: 100 });
  });

  test("reportableRangeQuantify returns null when no span passes", () => {
    const result = QC.reportableRangeQuantify({
      points: [
        { assigned: 10, measured: 15 },
        { assigned: 100, measured: 92 },
        { assigned: 200, measured: 230 },
      ],
      allowableErrorPct: 2,
    });
    expect(result.reportableRange).toBeNull();
  });

  test("criticalNumberOfTestSamples surfaces the limitation note", () => {
    const result = QC.criticalNumberOfTestSamples({
      observedSD: 2,
      allowableSD: 3,
    });
    expect(result.note).toMatch(/chi-square/i);
    expect(result.confidence).toBeCloseTo(0.9, 10);
  });

  test("criticalNumberOfTestSamples validates inputs", () => {
    expect(() =>
      QC.criticalNumberOfTestSamples({ observedSD: 0, allowableSD: 3 }),
    ).toThrow(/Observed SD/);
    expect(() =>
      QC.criticalNumberOfTestSamples({
        observedSD: 2,
        allowableSD: 3,
        confidence: 1.5,
      }),
    ).toThrow(/Confidence/);
  });

  test("linearRegression guards degenerate input", () => {
    expect(() => QC.linearRegression([1], [2])).toThrow(/at least 2/i);
    expect(() => QC.linearRegression([5, 5, 5], [1, 2, 3])).toThrow(
      /identical/i,
    );
  });
});

describe("qcCalculators — lot-to-lot comparison", () => {
  test("computes paired differences and accepts within the limit", () => {
    const result = QC.lotToLot({
      pairs: [
        { oldLot: 4, newLot: 4.2 },
        { oldLot: 8, newLot: 8.2 },
      ],
      allowableDifferencePct: 10,
    });
    expect(result.n).toBe(2);
    expect(result.pairs[0].diffPct).toBeCloseTo(5, 10);
    expect(result.pairs[1].diffPct).toBeCloseTo(2.5, 10);
    expect(result.meanDiff).toBeCloseTo(0.2, 10);
    expect(result.meanDiffPct).toBeCloseTo(3.75, 10);
    expect(result.passing).toBe(2);
    expect(result.verdict).toBe("acceptable");
  });

  test("rejects the new lot when the mean difference exceeds the limit", () => {
    const result = QC.lotToLot({
      pairs: [
        { oldLot: 10, newLot: 12 },
        { oldLot: 20, newLot: 24 },
      ],
      allowableDifferencePct: 10,
    });
    expect(result.meanDiffPct).toBeCloseTo(20, 10);
    expect(result.failing).toBe(2);
    expect(result.verdict).toBe("unacceptable");
  });

  test("reports the SD of the paired differences", () => {
    const result = QC.lotToLot({
      pairs: [
        { oldLot: 10, newLot: 11 },
        { oldLot: 20, newLot: 20 },
      ],
      allowableDifferencePct: 15,
    });
    expect(result.sdDiff).toBeCloseTo(Math.SQRT1_2, 6);
  });

  test("validates its inputs", () => {
    expect(() =>
      QC.lotToLot({
        pairs: [{ oldLot: 10, newLot: 11 }],
        allowableDifferencePct: 10,
      }),
    ).toThrow(/at least 2/i);
    expect(() =>
      QC.lotToLot({
        pairs: [
          { oldLot: 0, newLot: 1 },
          { oldLot: 2, newLot: 2 },
        ],
        allowableDifferencePct: 10,
      }),
    ).toThrow(/must not be 0/i);
    expect(() =>
      QC.lotToLot({
        pairs: [
          { oldLot: 1, newLot: 1 },
          { oldLot: 2, newLot: 2 },
        ],
        allowableDifferencePct: 0,
      }),
    ).toThrow(/Allowable difference/);
  });
});
