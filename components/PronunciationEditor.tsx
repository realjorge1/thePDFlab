/**
 * PronunciationEditor.tsx
 * Lets a reader teach the speech engine how to say a word.
 *
 * Invented names, acronyms and technical terms are where every TTS engine
 * embarrasses itself, and a book can be unlistenable because of one recurring
 * word. A rule rewrites that word phonetically on the way to the engine only —
 * the page is never altered, and highlighting stays aligned because
 * utils/pronunciation.ts keeps a map between the two.
 *
 * The Test button is the point of the screen: tuning a respelling is guesswork
 * without hearing it, and a reader should never have to restart a book to find
 * out whether "Shiv-awn" landed.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addRule,
  deleteRule,
  getAllRulesSync,
  loadRules,
  subscribeRules,
  updateRule,
} from "@/services/pronunciationService";
import { speakChunk, stopSpeaking } from "@/services/ttsService";
import type { PronunciationRule } from "@/utils/pronunciation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PronunciationEditorProps {
  visible: boolean;
  onClose: () => void;
  /** Scopes new rules to one book when set. */
  documentId?: string;
  /** Shown on the "this book only" option so the scope is unambiguous. */
  documentName?: string;
  colorScheme?: "dark" | "light";
}

/** Fields of a rule while it is being edited. */
interface Draft {
  id: string | null;
  match: string;
  replacement: string;
  wholeWord: boolean;
  caseSensitive: boolean;
  scopedToDocument: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  match: "",
  replacement: "",
  wholeWord: true,
  caseSensitive: false,
  scopedToDocument: false,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PronunciationEditor: React.FC<PronunciationEditorProps> = ({
  visible,
  onClose,
  documentId,
  documentName,
  colorScheme = "dark",
}) => {
  const isDark = colorScheme === "dark";

  const bg = isDark ? "#1C1C1E" : "#FFFFFF";
  const textPrimary = isDark ? "#EFEFEF" : "#0F172A";
  const textSecondary = isDark ? "#8E8E93" : "#64748B";
  const separator = isDark ? "#2C2C2E" : "#E5E7EB";
  const fieldBg = isDark ? "#2C2C2E" : "#F1F5F9";

  const [rules, setRules] = useState<readonly PronunciationRule[]>(
    getAllRulesSync(),
  );
  const [draft, setDraft] = useState<Draft | null>(null);

  // ── Load & subscribe ─────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    loadRules().then(setRules);
    return subscribeRules(setRules);
  }, [visible]);

  // Leaving the sheet must not leave a test utterance talking over the book.
  useEffect(() => {
    if (!visible) {
      setDraft(null);
      stopSpeaking();
    }
  }, [visible]);

  // ── Rules visible here: global ones plus this book's ─────────
  const visibleRules = useMemo(
    () =>
      rules.filter(
        (r) => r.documentId === undefined || r.documentId === documentId,
      ),
    [rules, documentId],
  );

  // ── Actions ──────────────────────────────────────────────────

  const handleTest = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Speak the replacement exactly as the engine will receive it, at the
    // reader's current voice, rate and pitch.
    speakChunk(trimmed);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const match = draft.match.trim();
    const replacement = draft.replacement.trim();

    if (!match) {
      Alert.alert("Nothing to match", "Enter the word you want to change.");
      return;
    }
    if (!replacement) {
      Alert.alert(
        "Nothing to say",
        "Enter how the word should be pronounced — try spelling it the way it sounds.",
      );
      return;
    }

    const fields = {
      match,
      replacement,
      wholeWord: draft.wholeWord,
      caseSensitive: draft.caseSensitive,
      documentId: draft.scopedToDocument ? documentId : undefined,
    };

    if (draft.id) {
      await updateRule(draft.id, fields);
    } else {
      await addRule({ ...fields, enabled: true });
    }
    setDraft(null);
  }, [draft, documentId]);

  const handleDelete = useCallback((rule: PronunciationRule) => {
    Alert.alert(
      "Delete rule",
      `Stop pronouncing "${rule.match}" as "${rule.replacement}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteRule(rule.id);
          },
        },
      ],
    );
  }, []);

  const handleToggleEnabled = useCallback((rule: PronunciationRule) => {
    void updateRule(rule.id, { enabled: !rule.enabled });
  }, []);

  const startEdit = useCallback(
    (rule: PronunciationRule) => {
      setDraft({
        id: rule.id,
        match: rule.match,
        replacement: rule.replacement,
        wholeWord: rule.wholeWord,
        caseSensitive: rule.caseSensitive,
        scopedToDocument: rule.documentId !== undefined,
      });
    },
    [],
  );

  // ── Render helpers ───────────────────────────────────────────

  const renderToggleRow = (
    label: string,
    hint: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <View style={styles.toggleRow}>
      <View style={styles.toggleLabels}>
        <Text style={[styles.toggleLabel, { color: textPrimary }]}>
          {label}
        </Text>
        <Text style={[styles.toggleHint, { color: textSecondary }]}>
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: ACCENT, false: isDark ? "#3A3A3C" : "#CBD5E1" }}
        thumbColor="#FFFFFF"
      />
    </View>
  );

  const renderDraft = (d: Draft) => (
    <ScrollView
      style={styles.body}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.bodyContent}
    >
      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        When the book says
      </Text>
      <TextInput
        value={d.match}
        onChangeText={(match) => setDraft({ ...d, match })}
        placeholder="Siobhan"
        placeholderTextColor={textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { backgroundColor: fieldBg, color: textPrimary }]}
      />

      <Text style={[styles.fieldLabel, { color: textSecondary }]}>
        Say it like this
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          value={d.replacement}
          onChangeText={(replacement) => setDraft({ ...d, replacement })}
          placeholder="Shiv awn"
          placeholderTextColor={textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            styles.inputGrow,
            { backgroundColor: fieldBg, color: textPrimary },
          ]}
        />
        <Pressable
          onPress={() => handleTest(d.replacement)}
          style={[styles.testBtn, { borderColor: ACCENT }]}
          accessibilityLabel="Hear this pronunciation"
        >
          <Text style={[styles.testBtnText, { color: ACCENT }]}>Test</Text>
        </Pressable>
      </View>
      <Text style={[styles.helpText, { color: textSecondary }]}>
        Spell it the way it sounds, and use spaces or hyphens to break up
        syllables. Tap Test until it sounds right.
      </Text>

      {renderToggleRow(
        "Whole words only",
        'Keeps "Ann" from changing "Announce".',
        d.wholeWord,
        (wholeWord) => setDraft({ ...d, wholeWord }),
      )}

      {renderToggleRow(
        "Match capitals exactly",
        "Off means it matches however the book writes it.",
        d.caseSensitive,
        (caseSensitive) => setDraft({ ...d, caseSensitive }),
      )}

      {documentId
        ? renderToggleRow(
            "This book only",
            documentName
              ? `Applies to ${documentName} and nothing else.`
              : "Applies to this book and nothing else.",
            d.scopedToDocument,
            (scopedToDocument) => setDraft({ ...d, scopedToDocument }),
          )
        : null}

      <View style={styles.draftActions}>
        <Pressable
          onPress={() => setDraft(null)}
          style={[styles.secondaryBtn, { borderColor: separator }]}
        >
          <Text style={[styles.secondaryBtnText, { color: textSecondary }]}>
            Cancel
          </Text>
        </Pressable>
        <Pressable onPress={handleSave} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>
            {d.id ? "Save rule" : "Add rule"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const renderList = () => (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      {visibleRules.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: textPrimary }]}>
            No pronunciation rules yet
          </Text>
          <Text style={[styles.emptyBody, { color: textSecondary }]}>
            If a name or an acronym is read wrong, add a rule and the reader
            will say it your way from then on.
          </Text>
        </View>
      ) : (
        visibleRules.map((rule) => (
          <View
            key={rule.id}
            style={[styles.ruleRow, { borderBottomColor: separator }]}
          >
            <Pressable
              onPress={() => startEdit(rule)}
              style={styles.ruleMain}
              accessibilityLabel={`Edit rule: ${rule.match} spoken as ${rule.replacement}`}
            >
              <Text
                style={[
                  styles.ruleMatch,
                  { color: rule.enabled ? textPrimary : textSecondary },
                ]}
                numberOfLines={1}
              >
                {rule.match}
              </Text>
              <Text
                style={[styles.ruleReplacement, { color: textSecondary }]}
                numberOfLines={1}
              >
                → {rule.replacement}
              </Text>
              <View style={styles.badgeRow}>
                <View style={[styles.badge, { backgroundColor: fieldBg }]}>
                  <Text style={[styles.badgeText, { color: textSecondary }]}>
                    {rule.documentId ? "This book" : "All books"}
                  </Text>
                </View>
                {!rule.wholeWord && (
                  <View style={[styles.badge, { backgroundColor: fieldBg }]}>
                    <Text style={[styles.badgeText, { color: textSecondary }]}>
                      Partial
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>

            <Pressable
              onPress={() => handleTest(rule.replacement)}
              style={styles.iconBtn}
              accessibilityLabel={`Hear ${rule.replacement}`}
            >
              <Text style={[styles.iconBtnText, { color: ACCENT }]}>Test</Text>
            </Pressable>

            <Switch
              value={rule.enabled}
              onValueChange={() => handleToggleEnabled(rule)}
              trackColor={{ true: ACCENT, false: isDark ? "#3A3A3C" : "#CBD5E1" }}
              thumbColor="#FFFFFF"
            />

            <Pressable
              onPress={() => handleDelete(rule)}
              style={styles.iconBtn}
              accessibilityLabel={`Delete rule for ${rule.match}`}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          </View>
        ))
      )}

      <Pressable
        onPress={() => setDraft({ ...EMPTY_DRAFT, scopedToDocument: false })}
        style={[styles.addBtn, { borderColor: ACCENT }]}
      >
        <Text style={[styles.addBtnText, { color: ACCENT }]}>
          + Add a pronunciation
        </Text>
      </Pressable>
    </ScrollView>
  );

  // ── Render ───────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <SafeAreaView
          edges={["bottom"]}
          style={[styles.sheet, { backgroundColor: bg }]}
        >
          <View style={[styles.handle, { backgroundColor: separator }]} />

          <View style={[styles.header, { borderBottomColor: separator }]}>
            <Text style={[styles.title, { color: textPrimary }]}>
              {draft ? (draft.id ? "Edit rule" : "New rule") : "Pronunciation"}
            </Text>
            <Pressable
              onPress={draft ? () => setDraft(null) : onClose}
              style={styles.headerAction}
              accessibilityLabel={draft ? "Back to rules" : "Close"}
            >
              <Text style={[styles.headerActionText, { color: ACCENT }]}>
                {draft ? "Back" : "Done"}
              </Text>
            </Pressable>
          </View>

          {draft ? renderDraft(draft) : renderList()}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Matches the Read Aloud bar accent (the Home header gradient start). */
const ACCENT = "#4F46E5";

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "82%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: "700" },
  headerAction: { position: "absolute", right: 16, padding: 4 },
  headerActionText: { fontSize: 15, fontWeight: "600" },

  body: { paddingHorizontal: 16 },
  bodyContent: { paddingTop: 14, paddingBottom: 28 },

  // ── List ───────────────────────────────────────────────────
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleMain: { flex: 1, gap: 2 },
  ruleMatch: { fontSize: 15, fontWeight: "600" },
  ruleReplacement: { fontSize: 13 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "600" },
  iconBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  iconBtnText: { fontSize: 13, fontWeight: "600" },
  deleteText: { fontSize: 13, fontWeight: "600", color: "#EF4444" },

  addBtn: {
    marginTop: 18,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  addBtnText: { fontSize: 14, fontWeight: "600" },

  empty: { paddingVertical: 28, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: "center" },

  // ── Draft form ─────────────────────────────────────────────
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 12,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  inputGrow: { flex: 1 },
  testBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  testBtnText: { fontSize: 14, fontWeight: "700" },
  helpText: { fontSize: 12, lineHeight: 17, marginTop: 8 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 18,
  },
  toggleLabels: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: 15, fontWeight: "500" },
  toggleHint: { fontSize: 12, lineHeight: 16 },

  draftActions: { flexDirection: "row", gap: 10, marginTop: 26 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600" },
  primaryBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: ACCENT,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
});
