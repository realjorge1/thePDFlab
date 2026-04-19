// ============================================================================
// LoadingStages — staged loading UI. Shows a step list with the active stage
// highlighted, giving clear feedback during a multi-second render.
// ============================================================================

import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { RenderStage } from "../types/pptxViewer";

const ACCENT = "#6366F1";
const DONE = "#22C55E";
const DIM = "rgba(255,255,255,0.35)";

interface Props {
  stage: RenderStage;
}

const ORDER: Array<{
  key: RenderStage["phase"];
  label: string;
}> = [
  { key: "preparing", label: "Preparing" },
  { key: "uploading", label: "Uploading" },
  { key: "rendering", label: "Rendering on server" },
  { key: "downloading", label: "Downloading slides" },
];

function indexOf(phase: RenderStage["phase"]): number {
  return ORDER.findIndex((s) => s.key === phase);
}

export function LoadingStages({ stage }: Props) {
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
      <Text style={styles.primary}>{message || "Preparing…"}</Text>
      <Text style={styles.secondary}>
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
                  done && styles.dotDone,
                  active && styles.dotActive,
                ]}
              />
              <Text
                style={[
                  styles.stepLabel,
                  active && styles.stepLabelActive,
                  done && styles.stepLabelDone,
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
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 8,
  },
  secondary: {
    color: "rgba(255,255,255,0.5)",
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
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dotActive: { backgroundColor: ACCENT },
  dotDone: { backgroundColor: DONE },
  stepLabel: { color: DIM, fontSize: 13 },
  stepLabelActive: { color: "#FFFFFF", fontWeight: "600" },
  stepLabelDone: { color: "rgba(255,255,255,0.7)" },
});
