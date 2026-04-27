// ============================================
// DocumentRenderer — Smart Document View for Extract Text
// Parses extracted PDF text into sections/paragraphs, supports filters,
// per-paragraph actions, and "Convert to Editable Document".
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import { copyToClipboard } from "@/services/ai/ai.service";
import {
  FileEdit,
  Highlighter,
  Lightbulb,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AIActionsBar } from "./AIActionsBar";

export interface DocumentSection {
  heading?: string;
  paragraphs: string[];
  page?: number;
}

interface Props {
  fullText: string;
  documentName?: string;
  onExplainParagraph?: (text: string) => void;
  onSummarizeParagraph?: (text: string) => void;
  onHighlightParagraph?: (text: string) => void;
  /** Called when user taps "Ask" on a section heading. Receives the heading label and joined section text. */
  onAskAboutSection?: (heading: string, sectionText: string) => void;
  onConvertToEditable?: (sections: DocumentSection[]) => void;
  onExport?: () => void;
  onAddToNotes?: () => void;
}

const HEADING_REGEX = /^([A-Z][A-Z0-9 \-:&()/.,]{2,80})$/;
const HEADING_TITLE_CASE = /^(\d+\.)?\s*[A-Z][A-Za-z0-9]+(\s+[A-Z][A-Za-z0-9]+){0,6}\s*:?\s*$/;

/**
 * Parse raw extracted text (with optional [Page N] anchors) into sections.
 * Heuristics:
 *   - Lines matching ALL CAPS or Title-Case short lines → headings
 *   - Blank lines separate paragraphs
 *   - [Page N] markers are captured but stripped from visible body
 */
export function parseDocumentSections(fullText: string): DocumentSection[] {
  if (!fullText) return [];
  const lines = fullText.split(/\r?\n/);

  const sections: DocumentSection[] = [];
  let current: DocumentSection = { paragraphs: [] };
  let buffer: string[] = [];
  let currentPage: number | undefined = undefined;

  const flushParagraph = () => {
    const joined = buffer.join(" ").trim();
    if (joined.length > 0) current.paragraphs.push(joined);
    buffer = [];
  };
  const flushSection = () => {
    flushParagraph();
    if (current.heading || current.paragraphs.length > 0) {
      sections.push({ ...current, page: currentPage });
    }
    current = { paragraphs: [] };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const pageMatch = line.match(/^\[Page (\d+)\]$/);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }

    if (line.length === 0) {
      flushParagraph();
      continue;
    }

    // Heading detection
    const isHeading =
      (line.length <= 80 && HEADING_REGEX.test(line)) ||
      (line.length <= 70 && HEADING_TITLE_CASE.test(line) && !line.endsWith("."));

    if (isHeading) {
      flushSection();
      current = { heading: line.replace(/:$/, ""), paragraphs: [], page: currentPage };
      continue;
    }

    buffer.push(line);
  }
  flushSection();

  // Dedup paragraphs that appear on many pages (headers/footers)
  const counts = new Map<string, number>();
  for (const s of sections) {
    for (const p of s.paragraphs) {
      counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  const total = sections.length || 1;
  const isRepeated = (p: string) => {
    if (p.length > 140) return false;
    const c = counts.get(p) || 0;
    return c > 3 && c / total >= 0.3;
  };

  return sections
    .map((s) => ({ ...s, paragraphs: s.paragraphs.filter((p) => !isRepeated(p)) }))
    .filter((s) => s.heading || s.paragraphs.length > 0);
}

export function DocumentRenderer({
  fullText,
  documentName,
  onExplainParagraph,
  onSummarizeParagraph,
  onHighlightParagraph,
  onAskAboutSection,
  onConvertToEditable,
  onExport,
  onAddToNotes,
}: Props) {
  const { colors: t, mode } = useTheme();
  const [removeHeaders, setRemoveHeaders] = useState(true);
  const [cleanFormatting, setCleanFormatting] = useState(true);
  const [openParagraph, setOpenParagraph] = useState<string | null>(null);

  const sections = useMemo(() => {
    const parsed = parseDocumentSections(fullText);
    if (!removeHeaders && !cleanFormatting) return parsed;
    return parsed.map((s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => {
        let text = p;
        if (cleanFormatting) {
          text = text.replace(/\s+/g, " ").trim();
        }
        return text;
      }),
    }));
  }, [fullText, removeHeaders, cleanFormatting]);

  const handleCopyParagraph = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) Alert.alert("Copied", "Paragraph copied to clipboard.");
  }, []);

  const card = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };

  const totalWords = useMemo(
    () =>
      sections.reduce(
        (sum, s) => sum + s.paragraphs.join(" ").split(/\s+/).filter(Boolean).length,
        0,
      ),
    [sections],
  );

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={[styles.card, card]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.docTitle, { color: t.text }]} numberOfLines={1}>
              {documentName || "Extracted Document"}
            </Text>
            <Text style={[styles.docMeta, { color: t.textSecondary }]}>
              {sections.length} section{sections.length === 1 ? "" : "s"} · {totalWords.toLocaleString()} words
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.editableBtn, { backgroundColor: "#9333EA" }]}
            onPress={() =>
              onConvertToEditable
                ? onConvertToEditable(sections)
                : Alert.alert(
                    "Convert to Editable",
                    "Opens content inside the in-app editor (wire up in your editor screen).",
                  )
            }
            activeOpacity={0.8}
          >
            <FileEdit size={13} color="#FFF" />
            <Text style={styles.editableBtnText}>Editable</Text>
          </TouchableOpacity>
        </View>

        {/* Toggles */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleItem}>
            <Switch value={removeHeaders} onValueChange={setRemoveHeaders} />
            <Text style={[styles.toggleLabel, { color: t.textSecondary }]}>
              Remove headers/footers
            </Text>
          </View>
          <View style={styles.toggleItem}>
            <Switch value={cleanFormatting} onValueChange={setCleanFormatting} />
            <Text style={[styles.toggleLabel, { color: t.textSecondary }]}>
              Clean formatting
            </Text>
          </View>
        </View>
      </View>

      {/* Sections */}
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
        {sections.map((section, si) => (
          <View key={si} style={[styles.sectionCard, card]}>
            {section.heading ? (
              <View style={styles.sectionHeadingRow}>
                <Text style={[styles.sectionHeading, { color: t.text }]} numberOfLines={2}>
                  {section.heading}
                </Text>
                <View style={styles.sectionHeadingMeta}>
                  {section.page ? (
                    <Text style={[styles.pageBadge, { color: t.textTertiary }]}>
                      p. {section.page}
                    </Text>
                  ) : null}
                  {onAskAboutSection ? (
                    <TouchableOpacity
                      style={[
                        styles.askSectionBtn,
                        {
                          backgroundColor:
                            mode === "dark" ? "rgba(147,51,234,0.12)" : "#F5F3FF",
                          borderColor: mode === "dark" ? "#4C1D95" : "#DDD6FE",
                        },
                      ]}
                      onPress={() =>
                        onAskAboutSection(
                          section.heading!,
                          section.paragraphs.join(" "),
                        )
                      }
                      activeOpacity={0.7}
                    >
                      <MessageCircle size={11} color="#9333EA" />
                      <Text style={styles.askSectionBtnText}>Ask</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
            {section.paragraphs.map((p, pi) => {
              const key = `${si}-${pi}`;
              const active = openParagraph === key;
              return (
                <View key={pi}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setOpenParagraph(active ? null : key)}
                  >
                    <Text style={[styles.paragraph, { color: t.text }]}>{p}</Text>
                  </TouchableOpacity>
                  {active ? (
                    <View
                      style={[
                        styles.paraActions,
                        {
                          backgroundColor:
                            mode === "dark" ? "rgba(147,51,234,0.1)" : "#F5F3FF",
                          borderColor: mode === "dark" ? "#4C1D95" : "#DDD6FE",
                        },
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.paraBtn}
                        onPress={() =>
                          onExplainParagraph
                            ? onExplainParagraph(p)
                            : Alert.alert("Explain", "Explanation service not wired.")
                        }
                      >
                        <Lightbulb size={12} color="#9333EA" />
                        <Text style={[styles.paraBtnText, { color: "#9333EA" }]}>Explain</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.paraBtn}
                        onPress={() =>
                          onSummarizeParagraph
                            ? onSummarizeParagraph(p)
                            : Alert.alert("Summarize", "Summarize service not wired.")
                        }
                      >
                        <Sparkles size={12} color="#2563EB" />
                        <Text style={[styles.paraBtnText, { color: "#2563EB" }]}>Summarize</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.paraBtn}
                        onPress={() =>
                          onHighlightParagraph
                            ? onHighlightParagraph(p)
                            : handleCopyParagraph(p)
                        }
                      >
                        <Highlighter size={12} color="#F59E0B" />
                        <Text style={[styles.paraBtnText, { color: "#F59E0B" }]}>Highlight</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.paraBtn}
                        onPress={() => handleCopyParagraph(p)}
                      >
                        <MoreHorizontal size={12} color={t.textSecondary} />
                        <Text style={[styles.paraBtnText, { color: t.textSecondary }]}>
                          Copy
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <AIActionsBar handlers={{ onAddToNotes, onExport }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  docTitle: { fontSize: 14, fontWeight: "700" },
  docMeta: { fontSize: 11.5, marginTop: 2 },
  editableBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editableBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  toggleItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleLabel: { fontSize: 11.5, fontWeight: "600" },
  sectionCard: {
    marginTop: 6,
    padding: 10,
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  sectionHeadingRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 6 },
  sectionHeading: { flex: 1, fontSize: 13.5, fontWeight: "800" },
  sectionHeadingMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  pageBadge: { fontSize: 11 },
  askSectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  askSectionBtnText: { fontSize: 10.5, fontWeight: "700", color: "#9333EA" },
  paragraph: { fontSize: 13.5, lineHeight: 20, marginTop: 4 },
  paraActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  paraBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  paraBtnText: { fontSize: 11, fontWeight: "700" },
});
