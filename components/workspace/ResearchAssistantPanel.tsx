// ============================================
// ResearchAssistantPanel — autonomous research help inside the Studio.
// ============================================
// Lives inside the Studio's AI Assistant sheet. Unlike the existing source-based
// actions (which work off books you manually add), this panel AUTO-discovers
// material from your whole library + notebook as you write, and offers it for
// one-tap insertion — never editing the document on its own:
//   • Related notes (from your notebook)
//   • Related documents (knowledge graph)
//   • A reference list drawn from those documents
//   • A suggested outline (AI, local fallback)
//   • A draft table for the topic (AI, local fallback)
//
// SECONDARY / additive: pure consumer of researchAssistantService. AI degrades
// to local results; the panel never throws and inserts only on explicit tap.
// ============================================

import {
  BookMarked,
  FileText,
  ListTree,
  Quote as QuoteIcon,
  Sparkles,
  StickyNote,
  Table as TableIcon,
} from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  generateTable,
  getResearchSuggestions,
  type ResearchSuggestions,
} from "@/services/researchAssistantService";
import { stripExtension } from "@/utils/keywords";

const ACCENT = "#9333EA";

interface Props {
  /** The current draft text (plain). */
  draftText: string;
  t: any;
  field: string;
  border: string;
  /** Insert plain text at the cursor (caller wraps undo + closes sheet). */
  onInsertText: (text: string) => void;
  /** Insert heading list as document sections. */
  onInsertOutline: (headings: string[]) => void;
}

export default function ResearchAssistantPanel({
  draftText,
  t,
  field,
  border,
  onInsertText,
  onInsertOutline,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sug, setSug] = useState<ResearchSuggestions | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [table, setTable] = useState<string[][] | null>(null);

  const hasDraft = draftText.trim().length > 0;

  const find = async () => {
    if (loading || !hasDraft) return;
    setLoading(true);
    try {
      setSug(await getResearchSuggestions(draftText));
    } catch {
      /* service is failure-tolerant; ignore */
    } finally {
      setLoading(false);
    }
  };

  const makeTable = async () => {
    if (tableLoading || !hasDraft) return;
    setTableLoading(true);
    try {
      const topic =
        (draftText.split(/\r?\n/).find((l) => l.trim()) || draftText).slice(0, 160);
      const res = await generateTable(topic);
      setTable(res.rows);
    } catch {
      /* ignore */
    } finally {
      setTableLoading(false);
    }
  };

  const insertReferences = () => {
    if (!sug || sug.references.length === 0) return;
    const block = sug.references.map((r, i) => `${i + 1}. ${r}`).join("\n");
    onInsertText(block);
  };

  const insertTable = () => {
    if (!table || table.length === 0) return;
    const text = table.map((row) => row.join("  |  ")).join("\n");
    onInsertText(text);
  };

  return (
    <View>
      <Text style={[styles.label, { color: t.textTertiary }]}>Research assistant</Text>

      {!hasDraft ? (
        <Text style={[styles.hint, { color: t.textTertiary }]}>
          Write a title or a few words, then I'll pull related notes, documents,
          references and an outline from your library.
        </Text>
      ) : (
        <TouchableOpacity
          onPress={find}
          disabled={loading}
          activeOpacity={0.85}
          style={[styles.primaryBtn, { backgroundColor: ACCENT, opacity: loading ? 0.6 : 1 }]}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Sparkles size={15} color="#FFF" strokeWidth={2.3} />
              <Text style={styles.primaryBtnText}>
                {sug ? "Refresh research" : "Find related & references"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {sug ? (
        <View style={{ marginTop: 4 }}>
          {/* Related notes */}
          {sug.relatedNotes.length > 0 ? (
            <Group t={t} Icon={StickyNote} title="Related notes">
              {sug.relatedNotes.map((n) => (
                <View key={n.id} style={[styles.row, { backgroundColor: field, borderColor: border }]}>
                  <Text style={[styles.rowText, { color: t.textSecondary }]} numberOfLines={2}>
                    {n.text || "Note"}
                  </Text>
                </View>
              ))}
            </Group>
          ) : null}

          {/* Related documents */}
          {sug.relatedDocuments.length > 0 ? (
            <Group t={t} Icon={BookMarked} title="Related documents">
              {sug.relatedDocuments.map((d) => (
                <View key={d.uri} style={[styles.row, { backgroundColor: field, borderColor: border }]}>
                  <FileText size={14} color={t.textTertiary} strokeWidth={2.1} />
                  <Text style={[styles.rowText, { color: t.textSecondary, flex: 1 }]} numberOfLines={1}>
                    {stripExtension(d.name)}
                  </Text>
                </View>
              ))}
            </Group>
          ) : null}

          {/* Suggested outline */}
          {sug.outline.length > 0 ? (
            <Group
              t={t}
              Icon={ListTree}
              title={sug.usedAI ? "Suggested outline" : "Outline scaffold"}
            >
              <View style={[styles.resultBox, { borderColor: `${ACCENT}40`, backgroundColor: `${ACCENT}10` }]}>
                <Text style={[styles.resultBody, { color: t.textSecondary }]}>
                  {sug.outline.join("  ·  ")}
                </Text>
                <TouchableOpacity
                  onPress={() => onInsertOutline(sug.outline)}
                  style={[styles.smallBtn, { backgroundColor: ACCENT }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.smallBtnText}>Insert outline</Text>
                </TouchableOpacity>
              </View>
            </Group>
          ) : null}

          {/* References */}
          {sug.references.length > 0 ? (
            <Group t={t} Icon={QuoteIcon} title="References from your library">
              <View style={[styles.resultBox, { borderColor: border, backgroundColor: field }]}>
                {sug.references.map((r, i) => (
                  <Text key={i} style={[styles.refText, { color: t.textSecondary }]} numberOfLines={2}>
                    {i + 1}. {r}
                  </Text>
                ))}
                <TouchableOpacity
                  onPress={insertReferences}
                  style={[styles.smallBtn, { backgroundColor: ACCENT }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.smallBtnText}>Insert references</Text>
                </TouchableOpacity>
              </View>
            </Group>
          ) : null}
        </View>
      ) : null}

      {/* Draft table — independent of the research run */}
      {hasDraft ? (
        <Group t={t} Icon={TableIcon} title="Draft table" style={{ marginTop: 16 }}>
          {table ? (
            <View style={[styles.resultBox, { borderColor: border, backgroundColor: field }]}>
              {table.map((row, ri) => (
                <Text
                  key={ri}
                  style={[
                    styles.tableRow,
                    { color: ri === 0 ? t.text : t.textSecondary, fontWeight: ri === 0 ? "800" : "500" },
                  ]}
                  numberOfLines={1}
                >
                  {row.join("  |  ")}
                </Text>
              ))}
              <TouchableOpacity
                onPress={insertTable}
                style={[styles.smallBtn, { backgroundColor: ACCENT }]}
                activeOpacity={0.85}
              >
                <Text style={styles.smallBtnText}>Insert table</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={makeTable}
              disabled={tableLoading}
              style={[styles.outlineBtn, { borderColor: border, backgroundColor: field, opacity: tableLoading ? 0.6 : 1 }]}
              activeOpacity={0.8}
            >
              {tableLoading ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : (
                <Text style={[styles.outlineBtnText, { color: t.textSecondary }]}>Generate a table for this topic</Text>
              )}
            </TouchableOpacity>
          )}
        </Group>
      ) : null}
    </View>
  );
}

function Group({
  t,
  Icon,
  title,
  style,
  children,
}: {
  t: any;
  Icon: any;
  title: string;
  style?: any;
  children: React.ReactNode;
}) {
  return (
    <View style={[{ marginTop: 14 }, style]}>
      <View style={styles.groupHead}>
        <Icon size={13} color={ACCENT} strokeWidth={2.3} />
        <Text style={[styles.groupTitle, { color: t.textSecondary }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 8,
  },
  hint: { fontSize: 12.5, lineHeight: 18 },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 11,
    paddingVertical: 11,
  },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 13.5 },

  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 7 },
  groupTitle: { fontSize: 12, fontWeight: "700" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 7,
  },
  rowText: { fontSize: 12.5, lineHeight: 17 },

  resultBox: { borderWidth: 1, borderRadius: 12, padding: 12 },
  resultBody: { fontSize: 12.5, lineHeight: 18 },
  refText: { fontSize: 12.5, lineHeight: 18, marginBottom: 5 },
  tableRow: { fontSize: 12, lineHeight: 18, marginBottom: 3 },

  smallBtn: { alignSelf: "flex-start", borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7, marginTop: 10 },
  smallBtnText: { color: "#FFF", fontWeight: "700", fontSize: 12.5 },

  outlineBtn: { borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: "center" },
  outlineBtnText: { fontSize: 12.5, fontWeight: "600" },
});
