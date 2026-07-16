/**
 * Tests for the QC "2030" upgrade: the extended descriptive statistics and
 * clinical helpers in utils/qcCalculators.ts, and the number-pad expression
 * evaluator in components/qc/qcMath.ts (+ its parseDecimal fallback).
 */
import { parseDecimal } from "@/components/qc/qcFormat";
import { evalExpr, tryEval } from "@/components/qc/qcMath";
import * as QC from "@/utils/qcCalculators";

describe("describe — extended statistics", () => {
  const values = [100, 102, 99, 101, 100, 103, 98];

  test("median, quartiles and IQR", () => {
    const s = QC.describe(values);
    expect(s.median).toBeCloseTo(100, 6);
    expect(s.q1).toBeCloseTo(99.5, 6);
    expect(s.q3).toBeCloseTo(101.5, 6);
    expect(s.iqr).toBeCloseTo(2, 6);
  });

  test("t-based 95% CI of the mean brackets the mean", () => {
    const s = QC.describe(values);
    expect(s.ci95Lower).toBeLessThan(s.mean);
    expect(s.ci95Upper).toBeGreaterThan(s.mean);
    // n=7, df=6 → t(0.975)=2.4469; half-width = t·SEM.
    expect(s.ci95Lower).toBeCloseTo(98.84, 1);
    expect(s.ci95Upper).toBeCloseTo(102.02, 1);
  });

  test("CI narrows as n grows (df effect)", () => {
    const wide = QC.describe([98, 102]);
    const narrow = QC.describe([98, 100, 100, 100, 100, 102]);
    const widthWide = wide.ci95Upper - wide.ci95Lower;
    const widthNarrow = narrow.ci95Upper - narrow.ci95Lower;
    expect(widthNarrow).toBeLessThan(widthWide);
  });
});

describe("totalError", () => {
  test("|bias| + z·CV with default z = 1.65", () => {
    expect(QC.totalError(2, 1.5)).toBeCloseTo(4.475, 6);
    expect(QC.totalError(-2, 1.5)).toBeCloseTo(4.475, 6); // uses |bias|
  });

  test("honours a custom z", () => {
    expect(QC.totalError(2, 1.5, 2)).toBeCloseTo(5, 6);
  });

  test("rejects non-positive CV", () => {
    expect(() => QC.totalError(2, 0)).toThrow(/CV/);
  });
});

describe("sdiZScore", () => {
  test("(observed − mean) / SD", () => {
    expect(QC.sdiZScore(104, 100, 2)).toBeCloseTo(2, 6);
    expect(QC.sdiZScore(97, 100, 2)).toBeCloseTo(-1.5, 6);
  });

  test("rejects a non-positive SD", () => {
    expect(() => QC.sdiZScore(104, 100, 0)).toThrow(/SD/);
  });
});

describe("qcMath — evalExpr", () => {
  test("basic arithmetic and precedence", () => {
    expect(evalExpr("10/1.5")).toBeCloseTo(6.6667, 4);
    expect(evalExpr("2+3*4")).toBe(14);
    expect(evalExpr("(2+3)*4")).toBe(20);
  });

  test("√, π and ^ (right-associative)", () => {
    expect(evalExpr("√2")).toBeCloseTo(Math.SQRT2, 6);
    expect(evalExpr("2π")).toBeCloseTo(2 * Math.PI, 6);
    expect(evalExpr("2^3^2")).toBe(512); // 2^(3^2), not (2^3)^2
  });

  test("implicit multiplication", () => {
    expect(evalExpr("3(4)")).toBe(12);
    expect(evalExpr("2√9")).toBeCloseTo(6, 6);
  });

  test("× ÷ − unicode operators", () => {
    expect(evalExpr("6÷2×3")).toBeCloseTo(9, 6);
    expect(evalExpr("10−4")).toBe(6);
  });

  test("division by zero and garbage are rejected", () => {
    expect(tryEval("1/0")).toBeNull();
    expect(tryEval("abc")).toBeNull();
    expect(tryEval("")).toBeNull();
  });
});

describe("parseDecimal — number-pad fallback", () => {
  test("plain numbers still parse", () => {
    expect(parseDecimal("5")).toBe(5);
    expect(parseDecimal("-1.5")).toBe(-1.5);
    expect(parseDecimal("2,5")).toBe(2.5); // comma decimal
  });

  test("expressions evaluate through the fallback", () => {
    expect(parseDecimal("10/1.5")).toBeCloseTo(6.6667, 4);
    expect(parseDecimal("√2")).toBeCloseTo(Math.SQRT2, 6);
  });

  test("unparseable text is null", () => {
    expect(parseDecimal("abc")).toBeNull();
  });
});
