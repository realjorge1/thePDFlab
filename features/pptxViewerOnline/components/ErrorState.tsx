// ============================================================================
// ErrorState — clear, actionable error UI with retry and back actions.
// Differentiates offline-suspected errors from server errors.
// ============================================================================

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const ACCENT = "#6366F1";

interface Props {
  message: string;
  retryable: boolean;
  offlineSuspected: boolean;
  onRetry: () => void;
  onBack: () => void;
}

export function ErrorState({
  message,
  retryable,
  offlineSuspected,
  onRetry,
  onBack,
}: Props) {
  const title = offlineSuspected
    ? "You appear to be offline"
    : "Can't open presentation";
  const hint = offlineSuspected
    ? "This feature needs a connection to the render server. Please check your internet and try again."
    : "If this keeps happening, the file may be corrupted or the server may be starting up.";

  return (
    <View style={styles.root}>
      <Text style={styles.icon}>{offlineSuspected ? "📡" : "⚠️"}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
      <Text style={styles.hint}>{hint}</Text>

      {retryable && (
        <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
          <Text style={styles.primaryText}>Try again</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
        <Text style={styles.secondaryText}>Go back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
  },
  icon: { fontSize: 48 },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  body: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    textAlign: "center",
    marginHorizontal: 12,
  },
  hint: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    textAlign: "center",
    marginHorizontal: 24,
    marginTop: -2,
    marginBottom: 8,
  },
  primaryBtn: {
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  secondaryBtn: {
    marginTop: 2,
    paddingVertical: 11,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
});
