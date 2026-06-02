// ============================================
// Document Studio — a three-panel writing workspace inside the WorkSpace.
//   • Source Library (top): activate books; one-click AI actions.
//   • Editor (center): rich-text StudioEditor + formatting toolbar.
//   • AI Assistant (bottom panel): Assistant / Quotes / Outline tabs.
// Plus word-count target, attributed quote injection, tone control, cross-book
// synthesis, and export to PDF / DOCX / TXT. State persists to AsyncStorage.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Bold,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Download,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  Plus,
  Quote,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react-native";

import type { UnifiedFileRecord } from "@/services/fileIndexService";
import { getLibraryBooks } from "@/services/workspaceInsightsService";
import {
  findQuotes,
  rewriteTone,
  suggestOutline,
  suggestSection,
  synthesizeBooks,
  type SourceQuote,
  type Tone,
} from "@/components/workspace/aiActions";
import SourceLibraryPicker from "@/components/workspace/SourceLibraryPicker";
import StudioEditor, {
  type EditorChange,
  type EditorHeading,
  type StudioEditorHandle,
} from "@/components/workspace/StudioEditor";

const STUDIO_KEY = "@wordsinscribed/doc_studio_v1";
const ACCENT = "#9333EA";

interface StudioState {
  title: string;
  html: string;
  target: number;
  activeUris: string[];
}

type AssistantTab = "assistant" | "quotes" | "outline";

const TONES: { id: Tone; label: string }[] = [
  { id: "formal", label: "Formal" },
  { id: "conversational", label: "Conversational" },
  { id: "persuasive", label: "Persuasive" },
  { id: "academic", label: "Academic" },
];

export default function DocumentStudio({
  mode,
  t,
}: {
  mode: "light" | "dark";
  t: any;
}) {
  const editorRef = useRef<StudioEditorHandle>(null);

  const [hydrated, setHydrated] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [initialHtml, setInitialHtml] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<EditorHeading[]>([]);
  const [target, setTarget] = useState(0);

  const [activeSources, setActiveSources] = useState<UnifiedFileRecord[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<AssistantTab>("assistant");

  const [busy, setBusy] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<SourceQuote[]>([]);
  const [outlineDraft, setOutlineDraft] = useState<string[] | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const undoRef = useRef<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  // input modals (link / target / title)
  const [inputModal, setInputModal] = useState<null | {
    kind: "link" | "target" | "title";
    value: string;
  }>(null);

  // ── Load persisted state ───────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STUDIO_KEY);
        const saved: StudioState | null = raw ? JSON.parse(raw) : null;
        if (saved && active) {
          setTitle(saved.title || "Untitled document");
          setInitialHtml(saved.html || "");
          setHtml(saved.html || "");
          setTarget(saved.target || 0);
          if (saved.activeUris?.length) {
            const books = await getLibraryBooks();
            const set = new Set(saved.activeUris);
            setActiveSources(books.filter((b) => set.has(b.uri)));
          }
        }
      } catch {
        /* default empty doc */
      } finally {
        if (active) setHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // ── Persist (debounced) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      const snapshot: StudioState = {
        title,
        html,
        target,
        activeUris: activeSources.map((s) => s.uri),
      };
      AsyncStorage.setItem(STUDIO_KEY, JSON.stringify(snapshot)).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [hydrated, title, html, target, activeSources]);

  const onEditorChange = useCallback((data: EditorChange) => {
    setHtml(data.html);
    setText(data.text);
    setWordCount(data.wordCount);
    setHeadings(data.headings);
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const lastParagraph = useMemo(() => {
    const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    return paras.slice(-2).join("\n") || "";
  }, [text]);

  const stashUndo = () => {
    undoRef.current = html;
    setCanUndo(true);
  };

  const applyUndo = () => {
    if (undoRef.current != null) {
      editorRef.current?.setContent(undoRef.current);
      undoRef.current = null;
      setCanUndo(false);
    }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      Alert.alert("AI", e?.message || "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  // ── Source toggling ────────────────────────────────────────────────────────
  const toggleSource = useCallback((file: UnifiedFileRecord) => {
    setActiveSources((prev) =>
      prev.some((s) => s.uri === file.uri)
        ? prev.filter((s) => s.uri !== file.uri)
        : [...prev, file],
    );
  }, []);

  // ── One-click AI actions ───────────────────────────────────────────────────
  const doSuggest = () =>
    run("Suggesting a section…", async () => {
      const out = await suggestSection(text, activeSources);
      if (out) {
        stashUndo();
        editorRef.current?.insertText(out);
      }
    });

  const doQuotes = () =>
    run("Finding quotes…", async () => {
      setTab("quotes");
      setPanelOpen(true);
      const qs = await findQuotes(activeSources, lastParagraph);
      setQuotes(qs);
      if (qs.length === 0) Alert.alert("Quotes", "No relevant passages found in the active sources.");
    });

  const doSynthesize = () =>
    run("Bridging your books…", async () => {
      const out = await synthesizeBooks(activeSources);
      if (out) {
        stashUndo();
        editorRef.current?.insertText(out);
      }
    });

  const doOutline = () =>
    run("Drafting an outline…", async () => {
      const o = await suggestOutline(text, title);
      if (o.length) {
        setOutlineDraft(o);
        // compute missing sections vs current headings
        const have = new Set(headings.map((h) => h.text.toLowerCase()));
        setMissing(o.filter((h) => !have.has(h.toLowerCase())));
      } else {
        Alert.alert("Outline", "Couldn't draft an outline right now.");
      }
    });

  const acceptOutline = () => {
    if (!outlineDraft) return;
    stashUndo();
    editorRef.current?.insertOutline(outlineDraft);
    setOutlineDraft(null);
    setMissing(null);
  };

  const applyTone = (tone: Tone) =>
    run(`Rewriting (${tone})…`, async () => {
      if (!text.trim()) {
        Alert.alert("Tone", "Write something first, then adjust its tone.");
        return;
      }
      const out = await rewriteTone(text, tone);
      if (out) {
        stashUndo();
        const htmlOut = out
          .split(/\n\n+/)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
          .join("");
        editorRef.current?.setContent(htmlOut);
      }
    });

  const insertQuote = (q: SourceQuote) => {
    editorRef.current?.insertQuote(q.quote, q.source);
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportDoc = () => {
    Alert.alert("Export document", `Export “${title}” as:`, [
      { text: "PDF", onPress: () => doExport("pdf") },
      { text: "Word (.docx)", onPress: () => doExport("docx") },
      { text: "Plain text", onPress: () => doExport("txt") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const doExport = (kind: "pdf" | "docx" | "txt") =>
    run("Exporting…", async () => {
      const Sharing = await import("expo-sharing");
      const safeTitle = (title || "document").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 60);
      let uri = "";
      if (kind === "pdf") {
        const Print = await import("expo-print");
        const fullHtml = wrapPrintHtml(title, html);
        const res = await Print.printToFileAsync({ html: fullHtml, base64: false });
        uri = res.uri;
      } else if (kind === "docx") {
        const { saveDocxFromHtml } = await import("@/utils/docxGenerator");
        const saved = await saveDocxFromHtml({
          html: html || "<p></p>",
          title,
          fileName: `${safeTitle}_${Date.now()}`,
        });
        if (!saved.success || !saved.uri) throw new Error(saved.error || "DOCX export failed");
        uri = saved.uri;
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        uri = `${FileSystem.cacheDirectory}${safeTitle}_${Date.now()}.txt`;
        await FileSystem.writeAsStringAsync(uri, text || "", {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert("Exported", "Saved to a temporary file.");
      }
    });

  // ── Input modal submit ─────────────────────────────────────────────────────
  const submitInput = () => {
    if (!inputModal) return;
    const v = inputModal.value.trim();
    if (inputModal.kind === "link") {
      if (v) editorRef.current?.exec("createLink", v.startsWith("http") ? v : `https://${v}`);
    } else if (inputModal.kind === "target") {
      const n = parseInt(v, 10);
      setTarget(Number.isFinite(n) && n > 0 ? n : 0);
    } else if (inputModal.kind === "title") {
      setTitle(v || "Untitled document");
    }
    setInputModal(null);
  };

  const surface = mode === "dark" ? "#0F172A" : "#FFFFFF";
  const field = mode === "dark" ? "#1E293B" : "#F1F5F9";
  const border = mode === "dark" ? "#334155" : "#E2E8F0";

  const progress = target > 0 ? Math.min(1, wordCount / target) : 0;
  const targetHint =
    target > 0
      ? wordCount < target * 0.5
        ? "Just getting started"
        : wordCount > target * 1.15
          ? "Over target — consider trimming"
          : wordCount >= target
            ? "Target reached 🎉"
            : "On track"
      : null;

  if (!hydrated) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Title + word target ── */}
      <View style={styles.titleRow}>
        <TouchableOpacity
          style={{ flex: 1 }}
          onPress={() => setInputModal({ kind: "title", value: title })}
        >
          <Text style={[styles.docTitle, { color: t.text }]} numberOfLines={1}>
            {title}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={exportDoc} style={[styles.exportBtn, { backgroundColor: `${ACCENT}18` }]}>
          <Download size={14} color={ACCENT} />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.metaRow}>
        <View style={[styles.progressTrack, { backgroundColor: field }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: ACCENT }]} />
        </View>
        <TouchableOpacity onPress={() => setInputModal({ kind: "target", value: target ? String(target) : "" })}>
          <Text style={[styles.metaText, { color: t.textSecondary }]}>
            {wordCount}
            {target > 0 ? ` / ${target}` : ""} words{target > 0 && targetHint ? ` · ${targetHint}` : " · set target"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Source Library ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sourceRow}
      >
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          style={[styles.sourceChip, styles.addChip, { borderColor: border }]}
        >
          <Plus size={13} color={t.textSecondary} />
          <Text style={[styles.sourceChipText, { color: t.textSecondary }]}>Sources</Text>
        </TouchableOpacity>
        {activeSources.map((s) => (
          <TouchableOpacity
            key={s.uri}
            onPress={() => toggleSource(s)}
            style={[styles.sourceChip, { backgroundColor: `${ACCENT}18`, borderColor: `${ACCENT}55` }]}
          >
            <BookMarked size={12} color={ACCENT} />
            <Text style={[styles.sourceChipText, { color: ACCENT }]} numberOfLines={1}>
              {stripExt(s.name)}
            </Text>
            <X size={11} color={ACCENT} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── One-click AI actions ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
        <ActionChip label="Suggest section" Icon={Sparkles} onPress={doSuggest} t={t} border={border} />
        <ActionChip label="Find quotes" Icon={Quote} onPress={doQuotes} t={t} border={border} disabled={activeSources.length === 0} />
        <ActionChip
          label="Synthesize"
          Icon={Wand2}
          onPress={doSynthesize}
          t={t}
          border={border}
          disabled={activeSources.length < 2}
        />
        <ActionChip label="Outline" Icon={List} onPress={doOutline} t={t} border={border} />
      </ScrollView>

      {/* ── Outline chip banner ── */}
      {outlineDraft ? (
        <View style={[styles.outlineBanner, { backgroundColor: `${ACCENT}12`, borderColor: `${ACCENT}40` }]}>
          <Text style={[styles.outlineTitle, { color: ACCENT }]}>Suggested outline</Text>
          <Text style={[styles.outlineBody, { color: t.textSecondary }]} numberOfLines={3}>
            {outlineDraft.join(" · ")}
          </Text>
          <View style={styles.outlineActions}>
            <TouchableOpacity onPress={acceptOutline} style={[styles.outlineBtn, { backgroundColor: ACCENT }]}>
              <Text style={styles.outlineBtnText}>Insert</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setOutlineDraft(null);
                setMissing(null);
              }}
              style={[styles.outlineBtn, { backgroundColor: field }]}
            >
              <Text style={[styles.outlineBtnText, { color: t.textSecondary }]}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* ── Formatting toolbar ── */}
      <View style={[styles.toolbar, { backgroundColor: field, borderColor: border }]}>
        <ToolBtn Icon={Bold} onPress={() => editorRef.current?.exec("bold")} t={t} />
        <ToolBtn Icon={Italic} onPress={() => editorRef.current?.exec("italic")} t={t} />
        <ToolBtn Icon={Heading1} onPress={() => editorRef.current?.exec("formatBlock", "<h1>")} t={t} />
        <ToolBtn Icon={Heading2} onPress={() => editorRef.current?.exec("formatBlock", "<h2>")} t={t} />
        <ToolBtn Icon={List} onPress={() => editorRef.current?.exec("insertUnorderedList")} t={t} />
        <ToolBtn Icon={Quote} onPress={() => editorRef.current?.exec("formatBlock", "<blockquote>")} t={t} />
        <ToolBtn Icon={Link2} onPress={() => setInputModal({ kind: "link", value: "" })} t={t} />
        {canUndo ? <ToolBtn Icon={RotateCcw} onPress={applyUndo} t={t} tint={ACCENT} /> : null}
      </View>

      {/* ── Editor ── */}
      <View style={styles.editorWrap}>
        <StudioEditor ref={editorRef} initialHtml={initialHtml} onChange={onEditorChange} mode={mode} />
        {busy ? (
          <View style={[styles.busyBar, { backgroundColor: surface, borderColor: border }]}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Text style={[styles.busyText, { color: t.textSecondary }]}>{busy}</Text>
          </View>
        ) : null}
      </View>

      {/* ── AI Assistant panel ── */}
      <View style={[styles.panel, { backgroundColor: surface, borderColor: border }]}>
        <TouchableOpacity style={styles.panelHeader} onPress={() => setPanelOpen((v) => !v)} activeOpacity={0.7}>
          <Sparkles size={14} color={ACCENT} />
          <Text style={[styles.panelTitle, { color: t.text }]}>AI Assistant</Text>
          <View style={{ flex: 1 }} />
          {panelOpen ? <ChevronDown size={18} color={t.textSecondary} /> : <ChevronUp size={18} color={t.textSecondary} />}
        </TouchableOpacity>

        {panelOpen ? (
          <View style={styles.panelBody}>
            <View style={[styles.tabBar, { borderColor: border }]}>
              {(["assistant", "quotes", "outline"] as AssistantTab[]).map((id) => (
                <TouchableOpacity key={id} style={styles.tabBtn} onPress={() => setTab(id)}>
                  <Text
                    style={[
                      styles.tabText,
                      { color: tab === id ? ACCENT : t.textTertiary },
                      tab === id && styles.tabTextActive,
                    ]}
                  >
                    {id === "assistant" ? "Assistant" : id === "quotes" ? "Quotes" : "Outline"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={styles.tabContent} keyboardShouldPersistTaps="handled">
              {tab === "assistant" ? (
                <View>
                  <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>Adjust tone</Text>
                  <View style={styles.toneRow}>
                    {TONES.map((tn) => (
                      <TouchableOpacity
                        key={tn.id}
                        onPress={() => applyTone(tn.id)}
                        style={[styles.toneChip, { borderColor: border, backgroundColor: field }]}
                      >
                        <Text style={[styles.toneText, { color: t.textSecondary }]}>{tn.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.assistHint, { color: t.textTertiary }]}>
                    Tone rewrites the whole draft. Use Undo (↺) in the toolbar to revert.
                  </Text>

                  {missing && missing.length > 0 ? (
                    <View style={[styles.missingBox, { backgroundColor: `${ACCENT}10`, borderColor: `${ACCENT}33` }]}>
                      <Text style={[styles.missingTitle, { color: ACCENT }]}>Missing sections</Text>
                      <Text style={[styles.missingBody, { color: t.textSecondary }]}>{missing.join(", ")}</Text>
                    </View>
                  ) : null}

                  <TouchableOpacity onPress={doSuggest} style={[styles.bigBtn, { backgroundColor: ACCENT }]}>
                    <Sparkles size={14} color="#FFF" />
                    <Text style={styles.bigBtnText}>Suggest the next section</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {tab === "quotes" ? (
                <View>
                  {activeSources.length === 0 ? (
                    <Text style={[styles.emptyTab, { color: t.textTertiary }]}>
                      Activate a book above, then tap “Find quotes” to surface relevant passages.
                    </Text>
                  ) : (
                    <>
                      <TouchableOpacity onPress={doQuotes} style={[styles.bigBtn, { backgroundColor: ACCENT, marginBottom: 10 }]}>
                        <Quote size={14} color="#FFF" />
                        <Text style={styles.bigBtnText}>Find quotes for this paragraph</Text>
                      </TouchableOpacity>
                      {quotes.length === 0 ? (
                        <Text style={[styles.emptyTab, { color: t.textTertiary }]}>
                          No quotes yet.
                        </Text>
                      ) : (
                        quotes.map((q, i) => (
                          <TouchableOpacity
                            key={i}
                            onPress={() => insertQuote(q)}
                            style={[styles.quoteCard, { backgroundColor: field, borderColor: border }]}
                          >
                            <Text style={[styles.quoteText, { color: t.text }]}>“{q.quote}”</Text>
                            <Text style={[styles.quoteSource, { color: ACCENT }]}>— {q.source} · tap to insert</Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </>
                  )}
                </View>
              ) : null}

              {tab === "outline" ? (
                <View>
                  {headings.length === 0 ? (
                    <Text style={[styles.emptyTab, { color: t.textTertiary }]}>
                      Add headings (H1/H2) and they’ll appear here. Tap one to jump to it.
                    </Text>
                  ) : (
                    headings.map((h) => (
                      <TouchableOpacity
                        key={h.id}
                        onPress={() => editorRef.current?.scrollToHeading(h.id)}
                        style={[styles.outlineItem, { paddingLeft: 4 + (h.level - 1) * 16 }]}
                      >
                        <Text style={[styles.outlineItemText, { color: t.textSecondary }]} numberOfLines={1}>
                          {h.text || "(untitled heading)"}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {/* ── Modals ── */}
      <SourceLibraryPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multi
        selectedUris={activeSources.map((s) => s.uri)}
        onToggle={toggleSource}
        title="Active sources"
      />

      <Modal visible={inputModal !== null} transparent animationType="fade" onRequestClose={() => setInputModal(null)}>
        <View style={styles.inputBackdrop}>
          <View style={[styles.inputCard, { backgroundColor: surface, borderColor: border }]}>
            <Text style={[styles.inputTitle, { color: t.text }]}>
              {inputModal?.kind === "link" ? "Insert link (URL)" : inputModal?.kind === "target" ? "Word target" : "Document title"}
            </Text>
            <TextInput
              value={inputModal?.value ?? ""}
              onChangeText={(v) => setInputModal((m) => (m ? { ...m, value: v } : m))}
              placeholder={inputModal?.kind === "link" ? "https://…" : inputModal?.kind === "target" ? "e.g. 2000" : "Title"}
              placeholderTextColor={t.textTertiary}
              keyboardType={inputModal?.kind === "target" ? "number-pad" : "default"}
              autoFocus
              style={[styles.input, { color: t.text, backgroundColor: field }]}
            />
            <View style={styles.inputActions}>
              <TouchableOpacity onPress={() => setInputModal(null)} style={[styles.inputBtn, { backgroundColor: field }]}>
                <Text style={[styles.inputBtnText, { color: t.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitInput} style={[styles.inputBtn, { backgroundColor: ACCENT }]}>
                <Text style={[styles.inputBtnText, { color: "#FFF" }]}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Small presentational helpers ─────────────────────────────────────────────
function ActionChip({
  label,
  Icon,
  onPress,
  t,
  border,
  disabled,
}: {
  label: string;
  Icon: any;
  onPress: () => void;
  t: any;
  border: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionChip, { borderColor: border, opacity: disabled ? 0.4 : 1 }]}
    >
      <Icon size={13} color={ACCENT} />
      <Text style={[styles.actionChipText, { color: t.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ToolBtn({ Icon, onPress, t, tint }: { Icon: any; onPress: () => void; t: any; tint?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.toolBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
      <Icon size={17} color={tint || t.textSecondary} strokeWidth={2.2} />
    </TouchableOpacity>
  );
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapPrintHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body{ font-family: Georgia, serif; color:#111; padding:32px; line-height:1.6; }
  h1{ font-size:26px; } h2{ font-size:21px; }
  blockquote{ border-left:3px solid #9333EA; margin:14px 0; padding:8px 14px; background:#f6f0fb; font-style:italic; }
  blockquote cite{ display:block; margin-top:6px; font-style:normal; font-size:12px; color:#666; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${body}
</body></html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 10, paddingTop: 8 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  docTitle: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  exportText: { color: ACCENT, fontWeight: "700", fontSize: 12.5 },

  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  metaText: { fontSize: 11.5, fontWeight: "600" },

  sourceRow: { gap: 7, paddingVertical: 2, alignItems: "center" },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 180,
  },
  addChip: {},
  sourceChipText: { fontSize: 12, fontWeight: "600" },

  actionRow: { gap: 7, paddingVertical: 8, alignItems: "center" },
  actionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionChipText: { fontSize: 12.5, fontWeight: "600" },

  outlineBanner: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8, gap: 4 },
  outlineTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  outlineBody: { fontSize: 12.5, lineHeight: 17 },
  outlineActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  outlineBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  outlineBtnText: { color: "#FFF", fontWeight: "700", fontSize: 12.5 },

  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 6,
  },
  toolBtn: { paddingHorizontal: 9, paddingVertical: 5 },

  editorWrap: { flex: 1, borderRadius: 12, overflow: "hidden", position: "relative" },
  busyBar: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  busyText: { fontSize: 12, fontWeight: "600" },

  panel: { borderTopWidth: 1, borderRadius: 12, borderWidth: 1, marginTop: 6, overflow: "hidden" },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 10 },
  panelTitle: { fontSize: 13.5, fontWeight: "700" },
  panelBody: { maxHeight: 230 },
  tabBar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 9 },
  tabText: { fontSize: 12.5, fontWeight: "600" },
  tabTextActive: { fontWeight: "800" },
  tabContent: { paddingHorizontal: 12, paddingVertical: 10 },

  sectionLabel: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  toneRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  toneChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  toneText: { fontSize: 12.5, fontWeight: "600" },
  assistHint: { fontSize: 11, marginTop: 8, lineHeight: 15 },
  missingBox: { marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  missingTitle: { fontSize: 12, fontWeight: "800", marginBottom: 2 },
  missingBody: { fontSize: 12.5, lineHeight: 17 },
  bigBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 11, marginTop: 12 },
  bigBtnText: { color: "#FFF", fontWeight: "700", fontSize: 13 },

  emptyTab: { fontSize: 12.5, lineHeight: 18, paddingVertical: 6 },
  quoteCard: { borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 8 },
  quoteText: { fontSize: 13, lineHeight: 19, fontStyle: "italic" },
  quoteSource: { fontSize: 11.5, fontWeight: "700", marginTop: 6 },

  outlineItem: { paddingVertical: 7 },
  outlineItemText: { fontSize: 13, fontWeight: "500" },

  inputBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 28 },
  inputCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16 },
  inputTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5 },
  inputActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  inputBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10 },
  inputBtnText: { fontSize: 13.5, fontWeight: "700" },
});
