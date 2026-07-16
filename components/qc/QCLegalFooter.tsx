/**
 * QCLegalFooter — intended-use disclaimer + method attribution.
 *
 * Rendered at the bottom of every QC calculator screen by QCScreenShell. The
 * disclaimer is always visible; the attribution / non-endorsement statement is
 * tucked behind an expandable row. Both strings are the canonical
 * `QC.DISCLAIMER` / `QC.ATTRIBUTION` from utils/qcCalculators.ts.
 */
import { useTheme } from "@/services/ThemeProvider";
import { ATTRIBUTION, DISCLAIMER } from "@/utils/qcCalculators";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export function QCLegalFooter() {
  const { colors: t } = useTheme();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showAttribution, setShowAttribution] = useState(false);

  return (
    <View style={[styles.wrap, { borderTopColor: t.border }]}>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setShowDisclaimer((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel="Intended use"
      >
        <View style={styles.titleRow}>
          <ShieldAlert size={13} color={t.textSecondary} />
          <Text style={[styles.toggleText, { color: t.textSecondary }]}>
            Intended use
          </Text>
        </View>
        {showDisclaimer ? (
          <ChevronUp size={14} color={t.textTertiary} />
        ) : (
          <ChevronDown size={14} color={t.textTertiary} />
        )}
      </TouchableOpacity>
      {showDisclaimer ? (
        <Text style={[styles.body, { color: t.textSecondary }]}>
          {DISCLAIMER}
        </Text>
      ) : null}

      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setShowAttribution((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel="Method attribution and non-endorsement"
      >
        <Text style={[styles.toggleText, { color: t.textSecondary }]}>
          Method attribution & non-endorsement
        </Text>
        {showAttribution ? (
          <ChevronUp size={14} color={t.textTertiary} />
        ) : (
          <ChevronDown size={14} color={t.textTertiary} />
        )}
      </TouchableOpacity>
      {showAttribution ? (
        <Text style={[styles.body, { color: t.textSecondary }]}>
          {ATTRIBUTION}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    marginTop: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  body: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  toggleText: {
    fontSize: 11.5,
    fontWeight: "600",
  },
});
