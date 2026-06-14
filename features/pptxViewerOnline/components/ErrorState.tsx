// ============================================================================
// ErrorState — clear, actionable error UI with retry and back actions.
// Differentiates offline-suspected errors from server errors.
// ============================================================================

import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Palette } from "@/services/document-manager";
import { useTheme } from "@/services/ThemeProvider";

const ACCENT = Palette.primary[500];

interface Props {
  message: string;
  retryable: boolean;
  offlineSuspected: boolean;
  onRetry: () => void;
  onBack: () => void;
  // When provided, offers the explicit low-fidelity on-device preview.
  onBasicPreview?: () => void;
}

export function ErrorState({
  message,
  retryable,
  offlineSuspected,
  onRetry,
  onBack,
  onBasicPreview,
}: Props) {
  const { colors: t } = useTheme();

  const title = offlineSuspected
    ? "You appear to be offline"
    : "Can't open presentation";
  const hint = offlineSuspected
    ? "This feature needs an internet connection. Please check your connection and try again."
    : "If this keeps happening, the file may be corrupted. Please try again in a moment.";

  return (
    <View style={styles.root}>
      <Text style={styles.icon}>{offlineSuspected ? "📡" : "⚠️"}</Text>
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      <Text style={[styles.body, { color: t.textSecondary }]}>
        {message}
      </Text>
      <Text style={[styles.hint, { color: t.textTertiary }]}>{hint}</Text>

      {retryable && (
        <TouchableOpacity style={styles.primaryBtn} onPress={onRetry}>
          <Text style={styles.primaryText}>Try again</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={[
          styles.secondaryBtn,
          { backgroundColor: t.backgroundSecondary },
        ]}
        onPress={onBack}
      >
        <Text style={[styles.secondaryText, { color: t.text }]}>
          Go back
        </Text>
      </TouchableOpacity>

      {onBasicPreview && (
        <TouchableOpacity
          style={styles.tertiaryBtn}
          onPress={onBasicPreview}
          hitSlop={8}
        >
          <Text style={[styles.tertiaryText, { color: t.textSecondary }]}>
            Show basic preview
          </Text>
        </TouchableOpacity>
      )}
      {onBasicPreview && (
        <Text style={[styles.tertiaryHint, { color: t.textTertiary }]}>
          Basic preview is text-only and won&apos;t match the original design.
        </Text>
      )}
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
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  body: {
    fontSize: 13,
    textAlign: "center",
    marginHorizontal: 12,
  },
  hint: {
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
  },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryText: { fontWeight: "600", fontSize: 14 },
  tertiaryBtn: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tertiaryText: {
    fontWeight: "600",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  tertiaryHint: {
    fontSize: 10,
    textAlign: "center",
    marginTop: -4,
  },
});
