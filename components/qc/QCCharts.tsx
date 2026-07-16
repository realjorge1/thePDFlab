/**
 * Offline charts for the QC calculators, drawn with React Native Skia.
 *
 *  - LeveyJenningsChart: mean and ±1s/2s/3s control-limit lines.
 *  - SigmaDecisionChart: normalized method-decision / OPSpecs plane with
 *    sigma boundary lines and the method's operating point.
 *  - RegressionChart: measured-vs-assigned scatter with regression line.
 *
 * Everything renders on-device from engine outputs — no network, no extra
 * chart library.
 */
import { fmt } from "@/components/qc/qcFormat";
import { useTheme } from "@/services/ThemeProvider";
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  Text as SkiaText,
  matchFont,
  vec,
  type SkFont,
} from "@shopify/react-native-skia";
import React, { useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

const CHART_HEIGHT = 220;
// Screen padding (16×2) + card padding (16×2).
const HORIZONTAL_CHROME = 64;
const LABEL_FONT_SIZE = 10;

function useChartWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(Math.max(width - HORIZONTAL_CHROME, 240), 520);
}

function useLabelFont(): SkFont | null {
  return useMemo(() => matchFont({ fontSize: LABEL_FONT_SIZE }), []);
}

function textWidth(font: SkFont | null, text: string): number {
  if (!font) return 0;
  return font.measureText(text).width;
}

/** Skia text is baseline-anchored at x; emulate SVG-style anchors. */
function anchoredX(
  font: SkFont | null,
  text: string,
  x: number,
  anchor: "start" | "middle" | "end",
): number {
  if (anchor === "start") return x;
  const w = textWidth(font, text);
  return anchor === "end" ? x - w : x - w / 2;
}

// ─── Levey-Jennings ───────────────────────────────────────────────────────────

interface LeveyJenningsChartProps {
  mean: number;
  sd: number;
  /** Optional raw QC values to plot as points in run order. */
  values?: number[];
}

export function LeveyJenningsChart({ mean, sd, values }: LeveyJenningsChartProps) {
  const { colors: t } = useTheme();
  const width = useChartWidth();
  const font = useLabelFont();
  const pad = { left: 8, right: 44, top: 12, bottom: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  // Vertical span: ±3.5s around the mean.
  const yOf = (v: number) =>
    pad.top + plotH * (1 - (v - (mean - 3.5 * sd)) / (7 * sd));

  const levels: {
    value: number;
    label: string;
    color: string;
    dash?: number[];
  }[] = [
    { value: mean + 3 * sd, label: "+3s", color: t.error },
    { value: mean + 2 * sd, label: "+2s", color: t.warning, dash: [6, 4] },
    { value: mean + sd, label: "+1s", color: t.textTertiary, dash: [2, 4] },
    { value: mean, label: "x̄", color: t.success },
    { value: mean - sd, label: "−1s", color: t.textTertiary, dash: [2, 4] },
    { value: mean - 2 * sd, label: "−2s", color: t.warning, dash: [6, 4] },
    { value: mean - 3 * sd, label: "−3s", color: t.error },
  ];

  const points = (values ?? []).map((v, i) => ({
    x:
      pad.left +
      (values && values.length > 1 ? (i / (values.length - 1)) * plotW : plotW / 2),
    y: yOf(v),
  }));

  return (
    <View style={styles.chartWrap}>
      <Canvas style={{ width, height: CHART_HEIGHT }}>
        {levels.map((level) => (
          <Group key={level.label}>
            <Line
              p1={vec(pad.left, yOf(level.value))}
              p2={vec(pad.left + plotW, yOf(level.value))}
              color={level.color}
              strokeWidth={level.label === "x̄" ? 1.5 : 1}
            >
              {level.dash ? <DashPathEffect intervals={level.dash} /> : null}
            </Line>
            {font ? (
              <SkiaText
                x={pad.left + plotW + 6}
                y={yOf(level.value) + 4}
                text={level.label}
                font={font}
                color={level.color}
              />
            ) : null}
          </Group>
        ))}
        {points.map((p, i) => {
          const prev = points[i - 1];
          return (
            <Group key={`pt-${i}`}>
              {prev ? (
                <Line
                  p1={vec(prev.x, prev.y)}
                  p2={vec(p.x, p.y)}
                  color={t.primary}
                  strokeWidth={1}
                  opacity={0.6}
                />
              ) : null}
              <Circle cx={p.x} cy={p.y} r={3.5} color={t.primary} />
            </Group>
          );
        })}
      </Canvas>
      <Text style={[styles.caption, { color: t.textTertiary }]}>
        Mean {fmt(mean)} · SD {fmt(sd, 3)}
        {values && values.length > 0 ? ` · ${values.length} points` : ""}
      </Text>
    </View>
  );
}

// ─── Sigma decision plane (QC Grid / OPSpecs) ─────────────────────────────────

interface SigmaDecisionChartProps {
  /** Normalized operating point (x = CV/TEa, y = |bias|/TEa). */
  operatingPoint: { x: number; y: number };
  /** Boundary lines from the engine: y = 1 − σ·x endpoint pairs. */
  sigmaLines: { sigma: number; points: { x: number; y: number }[] }[];
  xAxisLabel: string;
  yAxisLabel: string;
}

export function SigmaDecisionChart({
  operatingPoint,
  sigmaLines,
  xAxisLabel,
  yAxisLabel,
}: SigmaDecisionChartProps) {
  const { colors: t } = useTheme();
  const width = useChartWidth();
  const font = useLabelFont();
  const pad = { left: 34, right: 12, top: 18, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  const sx = (x: number) => pad.left + x * plotW;
  const sy = (y: number) => pad.top + (1 - y) * plotH;

  // The point can fall outside the unit square (very poor methods) —
  // clamp for display and say so in the caption.
  const clampedX = Math.min(operatingPoint.x, 1);
  const clampedY = Math.min(operatingPoint.y, 1);
  const clamped = clampedX !== operatingPoint.x || clampedY !== operatingPoint.y;

  return (
    <View style={styles.chartWrap}>
      <Canvas style={{ width, height: CHART_HEIGHT }}>
        {/* Frame */}
        <Line p1={vec(sx(0), sy(0))} p2={vec(sx(1), sy(0))} color={t.border} strokeWidth={1} />
        <Line p1={vec(sx(0), sy(0))} p2={vec(sx(0), sy(1))} color={t.border} strokeWidth={1} />
        <Line p1={vec(sx(1), sy(0))} p2={vec(sx(1), sy(1))} color={t.border} strokeWidth={1} />
        <Line p1={vec(sx(0), sy(1))} p2={vec(sx(1), sy(1))} color={t.border} strokeWidth={1} />

        {/* Sigma boundary lines, clipped to the unit square. */}
        {sigmaLines.map((line) => {
          const [p0, p1] = line.points;
          // Engine gives (0, 1) → (1/σ, 0); clip the x-intercept at x = 1.
          const endX = Math.min(p1.x, 1);
          const endY = p1.x > 1 ? Math.max(1 - line.sigma, 0) : Math.max(p1.y, 0);
          const label = `${line.sigma}σ`;
          return (
            <Group key={`sigma-${line.sigma}`}>
              <Line
                p1={vec(sx(p0.x), sy(p0.y))}
                p2={vec(sx(endX), sy(endY))}
                color={t.textTertiary}
                strokeWidth={1}
              >
                <DashPathEffect intervals={[4, 4]} />
              </Line>
              {font ? (
                <SkiaText
                  x={anchoredX(font, label, sx(endX) - 2, "end")}
                  y={sy(endY) - 4}
                  text={label}
                  font={font}
                  color={t.textTertiary}
                />
              ) : null}
            </Group>
          );
        })}

        {/* Operating point */}
        <Circle cx={sx(clampedX)} cy={sy(clampedY)} r={5.5} color={t.primary} />
        <Circle
          cx={sx(clampedX)}
          cy={sy(clampedY)}
          r={5.5}
          style="stroke"
          strokeWidth={1.5}
          color="#FFFFFF"
        />

        {/* Axis labels */}
        {font ? (
          <>
            <SkiaText
              x={anchoredX(font, xAxisLabel, pad.left + plotW / 2, "middle")}
              y={CHART_HEIGHT - 8}
              text={xAxisLabel}
              font={font}
              color={t.textSecondary}
            />
            <Group
              transform={[{ rotate: -Math.PI / 2 }]}
              origin={vec(12, pad.top + plotH / 2)}
            >
              <SkiaText
                x={anchoredX(font, yAxisLabel, 12, "middle")}
                y={pad.top + plotH / 2}
                text={yAxisLabel}
                font={font}
                color={t.textSecondary}
              />
            </Group>
            <SkiaText
              x={sx(0)}
              y={sy(0) + 12}
              text="0"
              font={font}
              color={t.textTertiary}
            />
            <SkiaText
              x={anchoredX(font, "1.0", sx(1), "end")}
              y={sy(0) + 12}
              text="1.0"
              font={font}
              color={t.textTertiary}
            />
          </>
        ) : null}
      </Canvas>
      <Text style={[styles.caption, { color: t.textTertiary }]}>
        Axes normalized to TEa (0–1).
        {clamped ? " Operating point lies beyond the chart — clamped for display." : ""}
      </Text>
    </View>
  );
}

// ─── Regression (measured vs assigned) ────────────────────────────────────────

interface RegressionChartProps {
  points: { assigned: number; measured: number; withinAllowable?: boolean }[];
  slope: number;
  intercept: number;
}

export function RegressionChart({ points, slope, intercept }: RegressionChartProps) {
  const { colors: t } = useTheme();
  const width = useChartWidth();
  const font = useLabelFont();
  const pad = { left: 44, right: 14, top: 14, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = CHART_HEIGHT - pad.top - pad.bottom;

  const xs = points.map((p) => p.assigned);
  const ys = points.map((p) => p.measured);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys, slope * xMin + intercept, xMin);
  const yMax = Math.max(...ys, slope * xMax + intercept, xMax);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const sx = (x: number) => pad.left + ((x - xMin) / xSpan) * plotW;
  const sy = (y: number) => pad.top + (1 - (y - yMin) / ySpan) * plotH;

  return (
    <View style={styles.chartWrap}>
      <Canvas style={{ width, height: CHART_HEIGHT }}>
        {/* Frame */}
        <Line
          p1={vec(pad.left, pad.top + plotH)}
          p2={vec(pad.left + plotW, pad.top + plotH)}
          color={t.border}
          strokeWidth={1}
        />
        <Line
          p1={vec(pad.left, pad.top)}
          p2={vec(pad.left, pad.top + plotH)}
          color={t.border}
          strokeWidth={1}
        />

        {/* Identity line y = x (ideal recovery) */}
        <Line
          p1={vec(sx(xMin), sy(xMin))}
          p2={vec(sx(xMax), sy(xMax))}
          color={t.textTertiary}
          strokeWidth={1}
        >
          <DashPathEffect intervals={[4, 4]} />
        </Line>

        {/* Regression line */}
        <Line
          p1={vec(sx(xMin), sy(slope * xMin + intercept))}
          p2={vec(sx(xMax), sy(slope * xMax + intercept))}
          color={t.primary}
          strokeWidth={1.5}
        />

        {/* Points — red when outside the allowable error */}
        {points.map((p, i) => (
          <Circle
            key={`p-${i}`}
            cx={sx(p.assigned)}
            cy={sy(p.measured)}
            r={4}
            color={p.withinAllowable === false ? t.error : t.success}
          />
        ))}

        {/* Axis extent labels */}
        {font ? (
          <>
            <SkiaText
              x={pad.left}
              y={CHART_HEIGHT - 8}
              text={fmt(xMin, 1)}
              font={font}
              color={t.textTertiary}
            />
            <SkiaText
              x={anchoredX(font, fmt(xMax, 1), pad.left + plotW, "end")}
              y={CHART_HEIGHT - 8}
              text={fmt(xMax, 1)}
              font={font}
              color={t.textTertiary}
            />
            <SkiaText
              x={anchoredX(font, fmt(yMax, 1), pad.left - 6, "end")}
              y={sy(yMax) + 8}
              text={fmt(yMax, 1)}
              font={font}
              color={t.textTertiary}
            />
            <SkiaText
              x={anchoredX(font, fmt(yMin, 1), pad.left - 6, "end")}
              y={sy(yMin)}
              text={fmt(yMin, 1)}
              font={font}
              color={t.textTertiary}
            />
            <SkiaText
              x={anchoredX(font, "Assigned", pad.left + plotW / 2, "middle")}
              y={CHART_HEIGHT - 8}
              text="Assigned"
              font={font}
              color={t.textSecondary}
            />
          </>
        ) : null}
      </Canvas>
      <Text style={[styles.caption, { color: t.textTertiary }]}>
        Solid: regression · dashed: ideal (y = x)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chartWrap: {
    alignItems: "center",
    marginTop: 4,
  },
  caption: {
    fontSize: 11,
    marginTop: 6,
  },
});
