// ============================================================================
// LoadingStages — staged loading UI. Shows a step list with the active stage
// highlighted, giving clear feedback during a multi-second render.
// ============================================================================

import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Palette } from "@/services/document-manager";
import { useTheme } from "@/services/ThemeProvider";

import type { RenderStage } from "../types/pptxViewer";

const ACCENT = Palette.primary[500];
const DONE = "#22C55E";

interface Props {
  stage: RenderStage;
}

const ORDER: {
  key: RenderStage["phase"];
  label: string;
}[] = [
  { key: "preparing", label: "Preparing" },
  { key: "uploading", label: "Uploading" },
  { key: "rendering", label: "Rendering slides" },
  { key: "downloading", label: "Downloading slides" },
];

function indexOf(phase: RenderStage["phase"]): number {
  return ORDER.findIndex((s) => s.key === phase);
}

export function LoadingStages({ stage }: Props) {
  const { colors: t } = useTheme();
  const currentIdx = indexOf(stage.phase);
  const message =
    stage.phase === "preparing" ||
    stage.phase === "uploading" ||
    stage.phase === "rendering" ||
    stage.phase === "downloading"
      ? stage.message
      : "";

  return (
    <View style={styles.root}>
      <ActivityIndicator color={ACCENT} size="large" />
      <Text style={[styles.primary, { color: t.text }]}>
        {message || "Preparing…"}
      </Text>
      <Text style={[styles.secondary, { color: t.textSecondary }]}>
        Large presentations may take a moment on first open. Future opens
        load instantly from cache.
      </Text>

      <View style={styles.steps}>
        {ORDER.map((step, idx) => {
          const active = idx === currentIdx;
          const done = idx < currentIdx;
          return (
            <View key={step.key} style={styles.stepRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: t.border },
                  done && styles.dotDone,
                  active && styles.dotActive,
                ]}
              />
              <Text
                style={[
                  styles.stepLabel,
                  { color: t.textTertiary },
                  active && [
                    styles.stepLabelActive,
                    { color: t.text },
                  ],
                  done && { color: t.textSecondary },
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  primary: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 8,
  },
  secondary: {
    fontSize: 12,
    textAlign: "center",
    marginHorizontal: 16,
  },
  steps: {
    marginTop: 20,
    gap: 10,
    alignSelf: "stretch",
    paddingHorizontal: 24,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotActive: { backgroundColor: ACCENT },
  dotDone: { backgroundColor: DONE },
  stepLabel: { fontSize: 13 },
  stepLabelActive: { fontWeight: "600" },
});
