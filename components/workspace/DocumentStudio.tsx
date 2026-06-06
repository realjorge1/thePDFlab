// ============================================
// Document Studio — a focused, writing-first workspace inside the WorkSpace.
//   • Document bar (top): title, live word/target stats, export.
//   • Editor (center, the hero): full-bleed rich-text StudioEditor.
//   • Formatting toolbar (bottom): rides above the keyboard.
//   • AI Assistant (bottom sheet): sources + one-click AI + results, all in
//     one place — no stacked panels, nothing overlapping the editor.
// State (title, body, target, active sources) persists to AsyncStorage.
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
  BookPlus,
  Download,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
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
// SECONDARY (additive): auto-discovers related notes/docs/references + tables.
import ResearchAssistantPanel from "@/components/workspace/ResearchAssistantPanel";

const STUDIO_KEY = "@wordsinscribed/doc_studio_v1";
const ACCENT = "#9333EA";

interface StudioState {
  title: string;
  html: string;
  target: number;
  activeUris: string[];
}

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

  // The AI assistant now lives in a bottom sheet instead of an inline panel,
  // so it never competes with the editor for vertical space.
  const [assistantOpen, setAssistantOpen] = useState(false);

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
  // Insert-type actions close the sheet so the result is visible in the editor.
  const doSuggest = () =>
    run("Suggesting a section…", async () => {
      const out = await suggestSection(text, activeSources);
      if (out) {
        stashUndo();
        editorRef.current?.insertText(out);
        setAssistantOpen(false);
      }
    });

  // Quotes need at least one source; tapping with none opens the shelf so the
  // dependency reveals itself through use rather than a written explanation.
  const doQuotes = () => {
    if (activeSources.length === 0) {
      setAssistantOpen(false);
      setPickerOpen(true);
      return;
    }
    run("Finding quotes…", async () => {
      const qs = await findQuotes(activeSources, lastParagraph);
      setQuotes(qs);
      if (qs.length === 0) Alert.alert("Quotes", "No relevant passages found in the active sources.");
    });
  };

  // Synthesis bridges two or more books; one or none opens the shelf to add more.
  const doSynthesize = () => {
    if (activeSources.length < 2) {
      setAssistantOpen(false);
      setPickerOpen(true);
      return;
    }
    run("Bridging your books…", async () => {
      const out = await synthesizeBooks(activeSources);
      if (out) {
        stashUndo();
        editorRef.current?.insertText(out);
        setAssistantOpen(false);
      }
    });
  };

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
    setAssistantOpen(false);
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
        setAssistantOpen(false);
      }
    });

  const insertQuote = (q: SourceQuote) => {
    editorRef.current?.insertQuote(q.quote, q.source);
    setAssistantOpen(false);
  };

  const jumpToHeading = (id: string) => {
    setAssistantOpen(false);
    editorRef.current?.scrollToHeading(id);
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
      <View style={[styles.loadingWrap, { backgroundColor: surface }]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      {/* ── Document bar: title · stats · export ── */}
      <View style={[styles.docBar, { borderBottomColor: border }]}>
        <View style={styles.titleCol}>
          <TouchableOpacity
            onPress={() => setInputModal({ kind: "title", value: title })}
            activeOpacity={0.7}
          >
            <Text style={[styles.docTitle, { color: t.text }]} numberOfLines={1}>
              {title}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setInputModal({ kind: "target", value: target ? String(target) : "" })}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 8, left: 0, right: 20 }}
          >
            <Text style={[styles.docStats, { color: t.textTertiary }]} numberOfLines={1}>
              {wordCount.toLocaleString()}
              {target > 0 ? ` / ${target.toLocaleString()}` : ""} words
              {target > 0 && targetHint ? ` · ${targetHint}` : target === 0 ? " · set a goal" : ""}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={exportDoc}
          style={[styles.exportBtn, { backgroundColor: `${ACCENT}14` }]}
          activeOpacity={0.85}
        >
          <Download size={15} color={ACCENT} strokeWidth={2.3} />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress hairline (only with a goal set) ── */}
      {target > 0 ? (
        <View style={[styles.progressTrack, { backgroundColor: field }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: ACCENT }]} />
        </View>
      ) : null}

      {/* ── Source shelf: the always-visible signature of Studio. A writing
            surface with your own books open beside it — this is what a notebook
            doesn't have. Empty, it invites a book; filled, the AI writes from it. ── */}
      <View style={[styles.shelf, { borderBottomColor: border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.shelfScroll}
        >
          <TouchableOpacity
            onPress={() => setPickerOpen(true)}
            style={[
              styles.shelfAdd,
              activeSources.length === 0
                ? { backgroundColor: `${ACCENT}12`, borderColor: `${ACCENT}55` }
                : { borderColor: border },
            ]}
            activeOpacity={0.8}
          >
            <BookPlus size={15} color={ACCENT} strokeWidth={2.2} />
            <Text style={[styles.shelfAddText, { color: ACCENT }]}>
              {activeSources.length === 0 ? "Add source books" : "Sources"}
            </Text>
          </TouchableOpacity>
          {activeSources.map((s) => (
            <TouchableOpacity
              key={s.uri}
              onPress={() => toggleSource(s)}
              style={[styles.sourceChip, { backgroundColor: `${ACCENT}18`, borderColor: `${ACCENT}55` }]}
              activeOpacity={0.7}
            >
              <BookMarked size={12} color={ACCENT} />
              <Text style={[styles.sourceChipText, { color: ACCENT }]} numberOfLines={1}>
                {stripExt(s.name)}
              </Text>
              <X size={11} color={ACCENT} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── Editor (the hero) ── */}
      <View style={styles.editorWrap}>
        <StudioEditor ref={editorRef} initialHtml={initialHtml} onChange={onEditorChange} mode={mode} />
        {busy ? (
          <View style={[styles.busyBar, { backgroundColor: surface, borderColor: border }]}>
            <ActivityIndicator size="small" color={ACCENT} />
            <Text style={[styles.busyText, { color: t.textSecondary }]}>{busy}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Bottom bar: formatting (scrolls) + Assistant ── */}
      <View style={[styles.bottomBar, { backgroundColor: surface, borderTopColor: border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.toolScroll}
          style={styles.toolScrollView}
        >
          <ToolBtn Icon={Bold} onPress={() => editorRef.current?.exec("bold")} t={t} />
          <ToolBtn Icon={Italic} onPress={() => editorRef.current?.exec("italic")} t={t} />
          <ToolBtn Icon={Heading1} onPress={() => editorRef.current?.exec("formatBlock", "<h1>")} t={t} />
          <ToolBtn Icon={Heading2} onPress={() => editorRef.current?.exec("formatBlock", "<h2>")} t={t} />
          <ToolBtn Icon={List} onPress={() => editorRef.current?.exec("insertUnorderedList")} t={t} />
          <ToolBtn Icon={Quote} onPress={() => editorRef.current?.exec("formatBlock", "<blockquote>")} t={t} />
          <ToolBtn Icon={Link2} onPress={() => setInputModal({ kind: "link", value: "" })} t={t} />
          {canUndo ? <ToolBtn Icon={RotateCcw} onPress={applyUndo} t={t} tint={ACCENT} /> : null}
        </ScrollView>

        <TouchableOpacity
          onPress={() => setAssistantOpen(true)}
          style={[styles.assistantBtn, { backgroundColor: ACCENT }]}
          activeOpacity={0.85}
        >
          <Sparkles size={15} color="#FFF" strokeWidth={2.3} />
          <Text style={styles.assistantBtnText}>Assistant</Text>
        </TouchableOpacity>
      </View>

      {/* ── AI Assistant bottom sheet ── */}
      <Modal
        visible={assistantOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAssistantOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setAssistantOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.grabber, { backgroundColor: border }]} />

            <View style={styles.sheetHeader}>
              <Sparkles size={16} color={ACCENT} />
              <Text style={[styles.sheetTitle, { color: t.text }]}>AI Assistant</Text>
              <View style={{ flex: 1 }} />
              {busy ? <ActivityIndicator size="small" color={ACCENT} style={{ marginRight: 10 }} /> : null}
              <TouchableOpacity onPress={() => setAssistantOpen(false)} hitSlop={10}>
                <X size={20} color={t.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Write with AI */}
              <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>Write with AI</Text>
              <View style={styles.grid}>
                <SheetAction label="Suggest section" Icon={Sparkles} onPress={doSuggest} t={t} field={field} border={border} />
                <SheetAction label="Find quotes" Icon={Quote} onPress={doQuotes} t={t} field={field} border={border} />
                <SheetAction label="Synthesize" Icon={Wand2} onPress={doSynthesize} t={t} field={field} border={border} />
                <SheetAction label="Outline" Icon={List} onPress={doOutline} t={t} field={field} border={border} />
              </View>

              {/* Adjust tone */}
              <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>Adjust tone</Text>
              <View style={styles.toneRow}>
                {TONES.map((tn) => (
                  <TouchableOpacity
                    key={tn.id}
                    onPress={() => applyTone(tn.id)}
                    style={[styles.toneChip, { borderColor: border, backgroundColor: field }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.toneText, { color: t.textSecondary }]}>{tn.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Research assistant — auto-discovered material + references */}
              <ResearchAssistantPanel
                draftText={text}
                t={t}
                field={field}
                border={border}
                onInsertText={(s) => {
                  stashUndo();
                  editorRef.current?.insertText(s);
                  setAssistantOpen(false);
                }}
                onInsertOutline={(hs) => {
                  stashUndo();
                  editorRef.current?.insertOutline(hs);
                  setAssistantOpen(false);
                }}
              />

              {/* Suggested outline (AI result) */}
              {outlineDraft ? (
                <View style={[styles.resultBox, { backgroundColor: `${ACCENT}12`, borderColor: `${ACCENT}40` }]}>
                  <Text style={[styles.resultTitle, { color: ACCENT }]}>Suggested outline</Text>
                  <Text style={[styles.resultBody, { color: t.textSecondary }]}>{outlineDraft.join("  ·  ")}</Text>
                  {missing && missing.length > 0 ? (
                    <Text style={[styles.resultMeta, { color: t.textTertiary }]}>
                      Missing from your draft: {missing.join(", ")}
                    </Text>
                  ) : null}
                  <View style={styles.resultActions}>
                    <TouchableOpacity onPress={acceptOutline} style={[styles.resultBtn, { backgroundColor: ACCENT }]}>
                      <Text style={styles.resultBtnText}>Insert</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setOutlineDraft(null);
                        setMissing(null);
                      }}
                      style={[styles.resultBtn, { backgroundColor: field }]}
                    >
                      <Text style={[styles.resultBtnText, { color: t.textSecondary }]}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {/* Quotes (AI result) */}
              {quotes.length > 0 ? (
                <>
                  <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>Quotes · tap to insert</Text>
                  {quotes.map((q, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => insertQuote(q)}
                      style={[styles.quoteCard, { backgroundColor: field, borderColor: border }]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.quoteText, { color: t.text }]}>“{q.quote}”</Text>
                      <Text style={[styles.quoteSource, { color: ACCENT }]}>— {q.source}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : null}

              {/* Document outline (jump to heading) */}
              {headings.length > 0 ? (
                <>
                  <Text style={[styles.sectionLabel, { color: t.textTertiary }]}>Document outline</Text>
                  {headings.map((h) => (
                    <TouchableOpacity
                      key={h.id}
                      onPress={() => jumpToHeading(h.id)}
                      style={[styles.outlineItem, { paddingLeft: 2 + (h.level - 1) * 16 }]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.outlineItemText, { color: t.textSecondary }]} numberOfLines={1}>
                        {h.text || "(untitled heading)"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : null}

              <View style={{ height: 28 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

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
function SheetAction({
  label,
  Icon,
  onPress,
  t,
  field,
  border,
  disabled,
}: {
  label: string;
  Icon: any;
  onPress: () => void;
  t: any;
  field: string;
  border: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[styles.gridBtn, { backgroundColor: field, borderColor: border, opacity: disabled ? 0.4 : 1 }]}
    >
      <View style={[styles.gridIcon, { backgroundColor: `${ACCENT}18` }]}>
        <Icon size={15} color={ACCENT} strokeWidth={2.2} />
      </View>
      <Text style={[styles.gridBtnText, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ToolBtn({ Icon, onPress, t, tint }: { Icon: any; onPress: () => void; t: any; tint?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.toolBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
      <Icon size={18} color={tint || t.textSecondary} strokeWidth={2.2} />
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
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  // ── Document bar ──
  docBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleCol: { flex: 1 },
  docTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  docStats: { fontSize: 11.5, fontWeight: "600", marginTop: 3 },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exportText: { color: ACCENT, fontWeight: "700", fontSize: 12.5 },

  // ── Progress hairline ──
  progressTrack: { height: 3, width: "100%", overflow: "hidden" },
  progressFill: { height: 3 },

  // ── Editor ──
  editorWrap: { flex: 1, position: "relative" },
  busyBar: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  busyText: { fontSize: 12, fontWeight: "600" },

  // ── Bottom bar (formatting + assistant) ──
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolScrollView: { flex: 1 },
  toolScroll: { flexDirection: "row", alignItems: "center", gap: 2, paddingRight: 6 },
  toolBtn: { paddingHorizontal: 9, paddingVertical: 6 },
  assistantBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 11,
  },
  assistantBtnText: { color: "#FFF", fontWeight: "700", fontSize: 13 },

  // ── Source shelf ──
  shelf: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  shelfScroll: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  shelfAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  shelfAddText: { fontSize: 12.5, fontWeight: "700" },

  // ── Assistant bottom sheet ──
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  sheetScroll: {},

  sectionLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 8,
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 200,
  },
  sourceChipText: { fontSize: 12, fontWeight: "600", flexShrink: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridBtn: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  gridIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  gridBtnText: { fontSize: 12.5, fontWeight: "700", flexShrink: 1 },

  toneRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toneChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  toneText: { fontSize: 12.5, fontWeight: "600" },

  resultBox: { marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1 },
  resultTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.3, marginBottom: 4 },
  resultBody: { fontSize: 12.5, lineHeight: 18 },
  resultMeta: { fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  resultActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  resultBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 9 },
  resultBtnText: { color: "#FFF", fontWeight: "700", fontSize: 12.5 },

  quoteCard: { borderRadius: 12, borderWidth: 1, padding: 11, marginBottom: 8 },
  quoteText: { fontSize: 13, lineHeight: 19, fontStyle: "italic" },
  quoteSource: { fontSize: 11.5, fontWeight: "700", marginTop: 6 },

  outlineItem: { paddingVertical: 8 },
  outlineItemText: { fontSize: 13, fontWeight: "500" },

  // ── Small input modal (title / target / link) ──
  inputBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 28 },
  inputCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16 },
  inputTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5 },
  inputActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  inputBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10 },
  inputBtnText: { fontSize: 13.5, fontWeight: "700" },
});
