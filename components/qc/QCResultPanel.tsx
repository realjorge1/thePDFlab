/**
 * QCResultPanel — the shared Scientia-style result card for every QC tool.
 *
 * Renders a `QCResultModel`: a large headline value + verdict badge tinted by
 * the tool accent, the formula, input chips, numbered working, a metrics grid,
 * a collapsible interpretation and warnings. One component, used by all 10
 * calculators, so each tool only has to build its model.
 */
import type { QCResultModel, VerdictTone } from "@/components/qc/qcResult";
import { toCopyText } from "@/components/qc/qcResult";
import { useTheme } from "@/services/ThemeProvider";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Lightbulb,
  TriangleAlert,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const VERDICT_COLORS: Record<VerdictTone, string> = {
  excellent: "#047857",
  good: "#16A34A",
  warn: "#D97706",
  bad: "#DC2626",
  neutral: "#475569",
};

interface QCResultPanelProps {
  title: string;
  model: QCResultModel;
  /** Tool accent — tints the headline value and section markers. */
  accent: string;
}

export function QCResultPanel({ title, model, accent }: QCResultPanelProps) {
  const { colors: t } = useTheme();
  const [copied, setCopied] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const [showInterp, setShowInterp] = useState(true);

  const copyText = useMemo(() => toCopyText(title, model), [title, model]);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — non-fatal.
    }
  }, [copyText]);

  const verdictColor = model.verdict
    ? VERDICT_COLORS[model.verdict.tone]
    : accent;

  return (
    <View
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: t.textTertiary }]}>Result</Text>
        <TouchableOpacity
          onPress={handleCopy}
          hitSlop={8}
          style={styles.copyBtn}
          accessibilityRole="button"
          accessibilityLabel="Copy results"
        >
          {copied ? (
            <Check size={15} color={t.success} />
          ) : (
            <Copy size={15} color={t.textTertiary} />
          )}
          <Text
            style={[
              styles.copyText,
              { color: copied ? t.success : t.textTertiary },
            ]}
          >
            {copied ? "Copied" : "Copy"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Headline */}
      <Text style={[styles.headlineLabel, { color: t.textSecondary }]}>
        {model.headline.label}
      </Text>
      <View style={styles.headlineRow}>
        <Text style={[styles.headlineValue, { color: accent }]}>
          {model.headline.value}
        </Text>
        {model.headline.unit ? (
          <Text style={[styles.headlineUnit, { color: t.textTertiary }]}>
            {model.headline.unit}
          </Text>
        ) : null}
      </View>

      {model.verdict ? (
        <View
          style={[styles.verdictBadge, { backgroundColor: verdictColor }]}
          accessibilityLabel={`Verdict: ${model.verdict.label}`}
        >
          <Text style={styles.verdictText}>{model.verdict.label}</Text>
        </View>
      ) : null}

      {/* Formula */}
      {model.formula ? (
        <View
          style={[
            styles.formulaBox,
            { backgroundColor: t.backgroundSecondary, borderColor: t.border },
          ]}
        >
          <Text style={[styles.formulaText, { color: t.text }]}>
            {model.formula}
          </Text>
        </View>
      ) : null}

      {/* Variable chips */}
      {model.variables?.length ? (
        <View style={styles.chipRow}>
          {model.variables.map((v, i) => (
            <View
              key={`${v.symbol}-${i}`}
              style={[
                styles.chip,
                { backgroundColor: t.background, borderColor: t.border },
              ]}
            >
              <Text style={[styles.chipSym, { color: t.textTertiary }]}>
                {v.symbol}
              </Text>
              <Text style={[styles.chipVal, { color: t.text }]}>
                {v.value}
                {v.unit ? (
                  <Text style={{ color: t.textTertiary }}> {v.unit}</Text>
                ) : null}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Metrics grid */}
      {model.metrics?.length ? (
        <View style={styles.metricGrid}>
          {model.metrics.map((m, i) => (
            <View
              key={`${m.label}-${i}`}
              style={[
                styles.metricCell,
                { borderColor: t.separator },
                m.emphasize && { backgroundColor: t.backgroundSecondary },
              ]}
            >
              <Text
                style={[styles.metricLabel, { color: t.textSecondary }]}
                numberOfLines={1}
              >
                {m.label}
              </Text>
              <Text
                style={[
                  styles.metricValue,
                  { color: m.emphasize ? accent : t.text },
                ]}
              >
                {m.value}
              </Text>
              {m.hint ? (
                <Text
                  style={[styles.metricHint, { color: t.textTertiary }]}
                  numberOfLines={1}
                >
                  {m.hint}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Step-by-step working */}
      {model.steps?.length ? (
        <View>
          <TouchableOpacity
            style={styles.sectionToggle}
            onPress={() => setShowWork((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel="Show step-by-step working"
          >
            <Text style={[styles.sectionToggleText, { color: t.textSecondary }]}>
              Step-by-step working
            </Text>
            {showWork ? (
              <ChevronUp size={16} color={t.textTertiary} />
            ) : (
              <ChevronDown size={16} color={t.textTertiary} />
            )}
          </TouchableOpacity>
          {showWork ? (
            <View style={styles.stepList}>
              {model.steps.map((s, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={[styles.stepNum, { backgroundColor: accent }]}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: t.text }]}>{s}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Interpretation */}
      {model.interpretation ? (
        <View
          style={[
            styles.interpBox,
            { backgroundColor: t.backgroundSecondary, borderColor: t.border },
          ]}
        >
          <TouchableOpacity
            style={styles.interpHeader}
            onPress={() => setShowInterp((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel="Interpretation"
          >
            <View style={styles.interpTitleRow}>
              <Lightbulb size={15} color={accent} />
              <Text style={[styles.interpTitle, { color: t.text }]}>
                Interpretation
              </Text>
            </View>
            {showInterp ? (
              <ChevronUp size={16} color={t.textTertiary} />
            ) : (
              <ChevronDown size={16} color={t.textTertiary} />
            )}
          </TouchableOpacity>
          {showInterp ? (
            <Text style={[styles.interpText, { color: t.textSecondary }]}>
              {model.interpretation}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Warnings */}
      {model.warnings?.length
        ? model.warnings.map((w, i) => (
            <View
              key={i}
              style={[
                styles.warnBox,
                { backgroundColor: t.background, borderColor: t.warning },
              ]}
            >
              <TriangleAlert size={15} color={t.warning} style={styles.warnIcon} />
              <Text style={[styles.warnText, { color: t.textSecondary }]}>
                {w}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  copyText: {
    fontSize: 12,
    fontWeight: "600",
  },
  headlineLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 10,
  },
  headlineRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginTop: 2,
  },
  headlineValue: {
    fontSize: 40,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  headlineUnit: {
    fontSize: 18,
    fontWeight: "600",
  },
  verdictBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  verdictText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  formulaBox: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  formulaText: {
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipSym: {
    fontSize: 12,
    fontWeight: "600",
  },
  chipVal: {
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 14,
    borderRadius: 12,
    overflow: "hidden",
  },
  metricCell: {
    width: "50%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metricLabel: {
    fontSize: 12,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  metricHint: {
    fontSize: 10.5,
    marginTop: 1,
  },
  sectionToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },
  sectionToggleText: {
    fontSize: 13,
    fontWeight: "600",
  },
  stepList: {
    marginTop: 10,
    gap: 8,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 1,
  },
  stepNumText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  stepText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  interpBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 16,
  },
  interpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  interpTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  interpTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  interpText: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  warnBox: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginTop: 12,
    gap: 8,
  },
  warnIcon: {
    marginTop: 1,
  },
  warnText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
