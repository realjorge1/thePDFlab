/**
 * Shared building blocks for the QC calculator screens: numeric fields,
 * list input, calculate/reset buttons, result rows, classification badge,
 * collapsible formula section and note boxes. All theme-aware.
 */
import type { SigmaClassification } from "@/utils/qcCalculators";
import { parseNumberList } from "@/components/qc/qcFormat";
import { useKeypadField } from "@/components/qc/QCKeypad";
import { useTheme } from "@/services/ThemeProvider";
import * as Clipboard from "expo-clipboard";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Info,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ─── Section card ─────────────────────────────────────────────────────────────

export function QCSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  return (
    <View
      style={[styles.section, { backgroundColor: t.card, borderColor: t.border }]}
    >
      {title ? (
        <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

// ─── Numeric field ────────────────────────────────────────────────────────────

interface QCNumberFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Unit suffix rendered inside the field, e.g. "%". */
  unit?: string;
  placeholder?: string;
  /** Bias may be negative; CV/SD/TEa may not. */
  allowNegative?: boolean;
  error?: string | null;
}

export function QCNumberField({
  label,
  value,
  onChangeText,
  unit,
  placeholder,
  allowNegative = false,
  error,
}: QCNumberFieldProps) {
  const { colors: t } = useTheme();
  const { onFocus, focused, padVisible } = useKeypadField(value, onChangeText);

  // Keep only characters a numeric/expression field can contain (digits, the
  // decimal separators, sign and the number-pad's calculator symbols), so
  // garbage never reaches validation. Full validation still happens on Calculate.
  const handleChange = useCallback(
    (text: string) => {
      onChangeText(text.replace(/[^0-9.,\-+*/^()√π×÷eE ]/g, ""));
    },
    [onChangeText],
  );

  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>{label}</Text>
      <View
        style={[
          styles.fieldRow,
          {
            backgroundColor: t.background,
            borderColor: error ? t.error : focused ? t.primary : t.border,
          },
        ]}
      >
        <TextInput
          style={[styles.fieldInput, { color: t.text }]}
          value={value}
          onChangeText={handleChange}
          onFocus={onFocus}
          showSoftInputOnFocus={!padVisible}
          placeholder={placeholder}
          placeholderTextColor={t.textTertiary}
          keyboardType={
            allowNegative
              ? Platform.select({
                  ios: "numbers-and-punctuation" as const,
                  default: "numeric" as const,
                })
              : "decimal-pad"
          }
          accessibilityLabel={label}
        />
        {unit ? (
          <Text style={[styles.fieldUnit, { color: t.textTertiary }]}>{unit}</Text>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.fieldError, { color: t.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

// ─── Number-list field ────────────────────────────────────────────────────────

interface QCListFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string | null;
}

/**
 * Free-form list editor: values separated by commas, spaces or new lines.
 * Shows a live count of parsed values and flags unreadable tokens.
 */
export function QCListField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
}: QCListFieldProps) {
  const { colors: t } = useTheme();
  const parsed = useMemo(() => parseNumberList(value), [value]);

  return (
    <View style={styles.fieldWrap}>
      <View style={styles.listHeader}>
        <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>{label}</Text>
        <Text style={[styles.listCount, { color: t.textTertiary }]}>
          {parsed.values.length} value{parsed.values.length === 1 ? "" : "s"}
        </Text>
      </View>
      <TextInput
        style={[
          styles.listInput,
          {
            backgroundColor: t.background,
            borderColor: error ? t.error : t.border,
            color: t.text,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? "e.g. 100, 102, 99, 101"}
        placeholderTextColor={t.textTertiary}
        multiline
        numberOfLines={4}
        keyboardType={Platform.select({
          ios: "numbers-and-punctuation" as const,
          default: "default" as const,
        })}
        accessibilityLabel={label}
      />
      {parsed.invalid.length > 0 ? (
        <Text style={[styles.fieldError, { color: t.warning }]}>
          Ignoring unreadable entries: {parsed.invalid.slice(0, 5).join(", ")}
          {parsed.invalid.length > 5 ? "…" : ""}
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.fieldError, { color: t.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function QCButtonRow({
  onCalculate,
  onReset,
  calculateLabel = "Calculate",
}: {
  onCalculate: () => void;
  onReset: () => void;
  calculateLabel?: string;
}) {
  const { colors: t } = useTheme();
  return (
    <View style={styles.buttonRow}>
      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: t.primary }]}
        onPress={onCalculate}
        accessibilityRole="button"
        accessibilityLabel={calculateLabel}
      >
        <Text style={[styles.primaryBtnText, { color: t.textInverse }]}>
          {calculateLabel}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.secondaryBtn, { borderColor: t.border }]}
        onPress={onReset}
        accessibilityRole="button"
        accessibilityLabel="Reset"
      >
        <Text style={[styles.secondaryBtnText, { color: t.textSecondary }]}>
          Reset
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Results ──────────────────────────────────────────────────────────────────

export function QCResultsCard({
  title = "Results",
  copyText,
  children,
}: {
  title?: string;
  /** Plain-text version of the results, for the copy button. */
  copyText?: string;
  children: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!copyText) return;
    try {
      await Clipboard.setStringAsync(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — non-fatal.
    }
  }, [copyText]);

  return (
    <View
      style={[styles.section, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <View style={styles.resultsHeader}>
        <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>
          {title}
        </Text>
        {copyText ? (
          <TouchableOpacity
            onPress={handleCopy}
            hitSlop={8}
            style={styles.copyBtn}
            accessibilityRole="button"
            accessibilityLabel="Copy results"
          >
            {copied ? (
              <Check size={16} color={t.success} />
            ) : (
              <Copy size={16} color={t.textTertiary} />
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
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function QCResultRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  const { colors: t } = useTheme();
  return (
    <View style={[styles.resultRow, { borderBottomColor: t.separator }]}>
      <Text style={[styles.resultLabel, { color: t.textSecondary }]}>{label}</Text>
      <Text
        style={[
          styles.resultValue,
          { color: t.text },
          emphasize && [styles.resultValueEmph, { color: t.primary }],
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Classification badge ─────────────────────────────────────────────────────

// Fixed hues chosen for contrast with white text in both themes.
const CLASSIFICATION_COLORS: Record<SigmaClassification, string> = {
  "world-class": "#1D4ED8",
  excellent: "#047857",
  good: "#16A34A",
  marginal: "#D97706",
  poor: "#EA580C",
  unacceptable: "#DC2626",
};

const CLASSIFICATION_LABELS: Record<SigmaClassification, string> = {
  "world-class": "World class",
  excellent: "Excellent",
  good: "Good",
  marginal: "Marginal",
  poor: "Poor",
  unacceptable: "Unacceptable",
};

export function ClassificationBadge({
  classification,
  band,
}: {
  classification: SigmaClassification;
  band?: string;
}) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: CLASSIFICATION_COLORS[classification] },
      ]}
      accessibilityLabel={`Classification: ${CLASSIFICATION_LABELS[classification]}${band ? `, ${band}` : ""}`}
    >
      <Text style={styles.badgeText}>
        {CLASSIFICATION_LABELS[classification]}
        {band ? `  ·  ${band}` : ""}
      </Text>
    </View>
  );
}

// ─── Collapsible formula section ──────────────────────────────────────────────

export function FormulaSection({ formula }: { formula: string }) {
  const { colors: t } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={[styles.section, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <TouchableOpacity
        style={styles.formulaHeader}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel="How this is calculated"
      >
        <View style={styles.formulaTitleRow}>
          <BookOpen size={15} color={t.textTertiary} />
          <Text style={[styles.formulaTitle, { color: t.textSecondary }]}>
            How this is calculated
          </Text>
        </View>
        {open ? (
          <ChevronUp size={16} color={t.textTertiary} />
        ) : (
          <ChevronDown size={16} color={t.textTertiary} />
        )}
      </TouchableOpacity>
      {open ? (
        <Text style={[styles.formulaBody, { color: t.text }]}>{formula}</Text>
      ) : null}
    </View>
  );
}

// ─── Note box ─────────────────────────────────────────────────────────────────

export function QCNote({ text }: { text: string }) {
  const { colors: t } = useTheme();
  return (
    <View
      style={[
        styles.note,
        { backgroundColor: t.backgroundSecondary, borderColor: t.border },
      ]}
    >
      <Info size={15} color={t.info} style={styles.noteIcon} />
      <Text style={[styles.noteText, { color: t.textSecondary }]}>{text}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  fieldWrap: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  fieldUnit: {
    fontSize: 14,
    marginLeft: 6,
  },
  fieldError: {
    fontSize: 12,
    marginTop: 4,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listCount: {
    fontSize: 12,
    marginBottom: 6,
  },
  listInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: "top",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 10,
  },
  copyText: {
    fontSize: 12,
    fontWeight: "600",
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  resultLabel: {
    fontSize: 14,
    flexShrink: 1,
  },
  resultValue: {
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  resultValueEmph: {
    fontSize: 16,
    fontWeight: "700",
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 8,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  formulaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  formulaTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  formulaTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  formulaBody: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  note: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  noteIcon: {
    marginTop: 2,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
