/**
 * ReaderControls — Bottom sheet UI for reader settings: typeface, font size,
 * line spacing, page margin, alignment, paragraph spacing and theme.
 *
 * These settings are app-wide: the EPUB reader reads the same record for
 * everything except font size and theme, which epub.js owns directly.
 */
import { READING_FACES } from "@/services/readingFontLoader";
import type {
  ReaderSettings,
  ReaderTheme,
} from "@/src/types/document-viewer.types";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Slider from "@react-native-community/slider";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

interface Props {
  visible: boolean;
  settings: ReaderSettings;
  onApply: (settings: ReaderSettings) => void;
  onClose: () => void;
}

const THEMES: { label: string; value: ReaderTheme; bg: string; fg: string }[] =
  [
    { label: "Light", value: "light", bg: "#ffffff", fg: "#1a1a1a" },
    { label: "Sepia", value: "sepia", bg: "#f4ecd8", fg: "#5c4a3a" },
    { label: "Dark", value: "dark", bg: "#1a1a1a", fg: "#e0e0e0" },
  ];

export function ReaderControls({ visible, settings, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<ReaderSettings>({ ...settings });

  // Reset draft when opening
  React.useEffect(() => {
    if (visible) setDraft({ ...settings });
  }, [visible]);

  const apply = () => {
    onApply(draft);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Reader Settings</Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        {/* Typeface */}
        <Text style={[styles.label, { marginBottom: 8 }]}>Typeface</Text>
        <View style={styles.optionRow}>
          {READING_FACES.map((face) => {
            const active = draft.fontFamily === face.id;
            return (
              <Pressable
                key={face.id}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => setDraft((p) => ({ ...p, fontFamily: face.id }))}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityHint={face.hint}
              >
                <Text
                  style={[
                    styles.optionText,
                    active && styles.optionTextActive,
                  ]}
                >
                  {face.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Font Size */}
        <View style={styles.row}>
          <Text style={styles.label}>Font Size</Text>
          <Text style={styles.value}>{draft.fontSize}px</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={12}
          maximumValue={32}
          step={1}
          value={draft.fontSize}
          onValueChange={(v) => setDraft((p) => ({ ...p, fontSize: v }))}
          minimumTrackTintColor="#2196F3"
          maximumTrackTintColor="#ccc"
          thumbTintColor="#2196F3"
        />

        {/* Line Height */}
        <View style={styles.row}>
          <Text style={styles.label}>Line Spacing</Text>
          <Text style={styles.value}>{draft.lineHeight.toFixed(1)}</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={1.2}
          maximumValue={2.4}
          step={0.1}
          value={draft.lineHeight}
          onValueChange={(v) =>
            setDraft((p) => ({ ...p, lineHeight: parseFloat(v.toFixed(1)) }))
          }
          minimumTrackTintColor="#2196F3"
          maximumTrackTintColor="#ccc"
          thumbTintColor="#2196F3"
        />

        {/* Page Margin */}
        <View style={styles.row}>
          <Text style={styles.label}>Page Margin</Text>
          <Text style={styles.value}>{Math.round(draft.margin)}px</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={64}
          step={4}
          value={draft.margin}
          onValueChange={(v) => setDraft((p) => ({ ...p, margin: v }))}
          minimumTrackTintColor="#2196F3"
          maximumTrackTintColor="#ccc"
          thumbTintColor="#2196F3"
        />

        {/* Paragraph Spacing */}
        <View style={styles.row}>
          <Text style={styles.label}>Paragraph Spacing</Text>
          <Text style={styles.value}>
            {draft.paragraphSpacing.toFixed(1)}em
          </Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={2}
          step={0.25}
          value={draft.paragraphSpacing}
          onValueChange={(v) =>
            setDraft((p) => ({
              ...p,
              paragraphSpacing: parseFloat(v.toFixed(2)),
            }))
          }
          minimumTrackTintColor="#2196F3"
          maximumTrackTintColor="#ccc"
          thumbTintColor="#2196F3"
        />

        {/* Alignment */}
        <Text style={[styles.label, { marginBottom: 8 }]}>Alignment</Text>
        <View style={styles.optionRow}>
          {(["left", "justify"] as const).map((value) => {
            const active = draft.textAlign === value;
            return (
              <Pressable
                key={value}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => setDraft((p) => ({ ...p, textAlign: value }))}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.optionText,
                    active && styles.optionTextActive,
                  ]}
                >
                  {value === "left" ? "Ragged right" : "Justified"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Theme */}
        <Text style={[styles.label, { marginBottom: 8 }]}>Theme</Text>
        <View style={styles.themeRow}>
          {THEMES.map((t) => (
            <Pressable
              key={t.value}
              style={[
                styles.themeBtn,
                {
                  backgroundColor: t.bg,
                  borderColor: t.bg === "#ffffff" ? "#ddd" : t.bg,
                },
                draft.theme === t.value && styles.themeBtnActive,
              ]}
              onPress={() => setDraft((p) => ({ ...p, theme: t.value }))}
            >
              <Text style={[styles.themeLabel, { color: t.fg }]}>
                {t.label}
              </Text>
              {draft.theme === t.value && (
                <MaterialIcons name="check-circle" size={16} color="#2196F3" />
              )}
            </Pressable>
          ))}
        </View>

        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable style={styles.applyBtn} onPress={apply}>
            <Text style={styles.applyText}>Apply</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 12,
  },
  scroll: { maxHeight: 440 },
  scrollContent: { paddingBottom: 4 },
  optionRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  optionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
  },
  optionBtnActive: { borderColor: "#2196F3", backgroundColor: "#E3F2FD" },
  optionText: { fontSize: 13, fontWeight: "600", color: "#666" },
  optionTextActive: { color: "#1565C0" },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ddd",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 20,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  label: { fontSize: 15, fontWeight: "600", color: "#333" },
  value: { fontSize: 14, color: "#666" },
  slider: { width: "100%", height: 40, marginBottom: 16 },
  themeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 24,
  },
  themeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 2,
    gap: 6,
  },
  themeBtnActive: {
    borderColor: "#2196F3",
  },
  themeLabel: { fontSize: 14, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#f0f0f0",
  },
  cancelText: { fontSize: 15, fontWeight: "600", color: "#666" },
  applyBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#2196F3",
  },
  applyText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});
