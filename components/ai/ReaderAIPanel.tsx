// ============================================
// ReaderAIPanel — Gozlin inside the reader (W7)
// ---------------------------------------------
// iPhone: a bottom sheet (hidden / peek ≈ 40% / expanded ≈ 90%).
// Windows ≥ 768 pt wide (iPad): a ≈ 380 pt panel on the right.
//
// Contents: a document chat thread (streamed per W5, citations per W4,
// Markdown per W6) and quick actions — Summarize, Explain selection, Translate
// selection, Ask about selection. The document is uploaded only when the user
// first sends something (W3 cache first).
//
// Performance: every piece of panel state lives in this component. Viewers hold
// a ref and call open()/close(), so opening, closing or streaming never
// re-renders the document renderer (no PDF reload, no EPUB reflow).
// The panel sits inside an error boundary: if it crashes it closes with a short
// toast and the reader keeps working.
// ============================================

import { useSubscription } from "@/context/SubscriptionContext";
import { isCancelError, runCancelable } from "@/services/activity/activityStore";
import {
  createMessage,
  explainText,
  extractDocumentText,
  getDocumentId,
  messageExtrasFromResponse,
  summarize,
  translate,
} from "@/services/ai/ai.service";
import type { AIChatMessage, AIDocumentRef, AIResponse } from "@/services/ai/ai.types";
import { generateId } from "@/services/ai/ai.types";
import {
  aiErrorInlineMessage,
  isPresentableAIError,
  presentAIError,
} from "@/services/ai/aiErrorPresenter";
import {
  navigateToCitation,
  registerReaderCitationTarget,
  registerReaderPanelHooks,
  type ReaderKind,
  type SourceCardData,
} from "@/services/ai/citationNavigator";
import { locatorTypeForDocument, type AICitation, type AILocatorType } from "@/services/ai/citations";
import { setDocRefDocId } from "@/services/ai/docSessionCache";
import { answerDocumentQuestion } from "@/services/ai/streamingChat";
import { extractDocumentForChat } from "@/services/documentChatService";
import { useTheme } from "@/services/ThemeProvider";
import { useRouter } from "expo-router";
import {
  BookOpen,
  Crown,
  Languages,
  Lightbulb,
  Maximize2,
  MessageSquare,
  Send,
  Sparkles,
  X,
} from "lucide-react-native";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AIChatBubble } from "./AIChatBubble";
import { SourceCard } from "./SourceCard";

// ─── Public API ──────────────────────────────────────────────────────────────

export type ReaderPanelSheetState = "hidden" | "peek" | "expanded";

export interface ReaderAIPanelOpenOptions {
  /** Selected text to show as a quoted chip above the input. */
  selection?: string;
  /** Initial sheet height (default "peek"). */
  state?: "peek" | "expanded";
}

export interface ReaderAIPanelHandle {
  open: (options?: ReaderAIPanelOpenOptions) => void;
  close: () => void;
  isOpen: () => boolean;
}

export interface ReaderAIPanelProps {
  document: { uri: string; name: string; mimeType?: string } | null;
  readerKind: ReaderKind;
  /** Move the viewer to a citation. Must be a stable callback. */
  onNavigateToCitation?: (citation: AICitation) => boolean | Promise<boolean>;
  /** Space kept free at the bottom (e.g. the Read Aloud bar). */
  bottomOffset?: number;
  /** "Open full screen" → the existing Chat with File screen. */
  onOpenFullScreen?: () => void;
}

const WIDE_BREAKPOINT = 768;
const SIDE_PANEL_WIDTH = 380;
const ACCENT = "#9333EA";

/** Bottom clearance that keeps the panel above a visible Read Aloud bar. */
export const READ_ALOUD_PANEL_CLEARANCE = 112;

const TRANSLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "ig", label: "Igbo" },
  { code: "yo", label: "Yoruba" },
  { code: "ha", label: "Hausa" },
];

const SPRING = { damping: 24, stiffness: 240, mass: 0.9 };

// ─── Error boundary ──────────────────────────────────────────────────────────

class PanelErrorBoundary extends React.Component<
  { onError: (error: Error) => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// ─── Inner panel ─────────────────────────────────────────────────────────────

function isPlaceholderText(text: string): boolean {
  const t = (text || "").trimStart();
  return (
    !t ||
    (t.startsWith("[") &&
      /extraction was not available|Extraction failed|extraction is not available|Failed to read|no text extracted/.test(t))
  );
}

const PanelInner = forwardRef<ReaderAIPanelHandle, ReaderAIPanelProps>(function PanelInner(
  { document, readerKind, onNavigateToCitation, bottomOffset = 0, onOpenFullScreen },
  ref,
) {
  const { colors: t, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const { isPremium } = useSubscription();
  const wide = width >= WIDE_BREAKPOINT;

  const [sheet, setSheet] = useState<ReaderPanelSheetState>("hidden");
  const [hasOpened, setHasOpened] = useState(false);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceCard, setSourceCard] = useState<SourceCardData | null>(null);
  const [showLanguages, setShowLanguages] = useState(false);

  const sheetRef = useRef<ReaderPanelSheetState>("hidden");
  sheetRef.current = sheet;
  const messagesRef = useRef<AIChatMessage[]>(messages);
  messagesRef.current = messages;
  const busyRef = useRef(false);
  busyRef.current = busy;

  const docRef = useRef<AIDocumentRef | null>(null);
  const chatDocIdRef = useRef<string | null>(null);
  const locatorRef = useRef<AILocatorType | undefined>(undefined);
  const listRef = useRef<FlatList<AIChatMessage>>(null);
  const questionsRef = useRef(new Map<string, { question: string; display: string }>());
  const inflightRef = useRef<{ controller: AbortController; lastProgress: number; suspended: boolean } | null>(null);

  // A new document starts a new thread.
  const docUri = document?.uri;
  const docName = document?.name;
  const docMime = document?.mimeType;
  useEffect(() => {
    docRef.current = docUri
      ? { uri: docUri, name: docName || "Document", mimeType: docMime || "application/octet-stream" }
      : null;
    chatDocIdRef.current = null;
    locatorRef.current = docUri ? locatorTypeForDocument({ name: docName, mimeType: docMime }) : undefined;
    setMessages([]);
  }, [docUri, docName, docMime]);

  // ── Geometry & animation ──────────────────────────────────────────────────
  const expandedH = Math.round(height * 0.9);
  const peekH = Math.round(height * 0.4);
  const sheetHeight = useSharedValue(0);
  const sideX = useSharedValue(SIDE_PANEL_WIDTH + 24);
  const dragStart = useSharedValue(0);

  const targetFor = useCallback(
    (state: ReaderPanelSheetState) => (state === "expanded" ? expandedH : state === "peek" ? peekH : 0),
    [expandedH, peekH],
  );

  const animateTo = useCallback(
    (state: ReaderPanelSheetState) => {
      if (wide) {
        const x = state === "hidden" ? SIDE_PANEL_WIDTH + 24 : 0;
        sideX.value = reduceMotion ? withTiming(x, { duration: 0 }) : withSpring(x, SPRING);
      } else {
        const h = targetFor(state);
        sheetHeight.value = reduceMotion ? withTiming(h, { duration: 0 }) : withSpring(h, SPRING);
      }
    },
    [wide, reduceMotion, targetFor, sideX, sheetHeight],
  );

  const snapTo = useCallback(
    (state: ReaderPanelSheetState) => {
      setSheet(state);
      animateTo(state);
      if (state === "hidden") setSourceCard(null);
    },
    [animateTo],
  );

  useEffect(() => {
    animateTo(sheet);
  }, [sheet, animateTo]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!wide)
        .activeOffsetY([-8, 8])
        .onBegin(() => {
          dragStart.value = sheetHeight.value;
        })
        .onUpdate((e) => {
          sheetHeight.value = Math.max(0, Math.min(expandedH, dragStart.value - e.translationY));
        })
        .onEnd((e) => {
          const projected = sheetHeight.value - e.velocityY * 0.15;
          const points = [expandedH, peekH, 0];
          let best = points[0];
          for (const p of points) {
            if (Math.abs(p - projected) < Math.abs(best - projected)) best = p;
          }
          const next: ReaderPanelSheetState = best === expandedH ? "expanded" : best === peekH ? "peek" : "hidden";
          runOnJS(snapTo)(next);
        }),
    [wide, expandedH, peekH, dragStart, sheetHeight, snapTo],
  );

  const sheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  const sideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sideX.value }] }));

  // ── Imperative handle ─────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      open: (options) => {
        setHasOpened(true);
        if (options && "selection" in options) {
          const s = options.selection?.trim();
          setSelection(s ? s : null);
        }
        const current = sheetRef.current;
        snapTo(current === "expanded" ? "expanded" : options?.state ?? "peek");
      },
      close: () => snapTo("hidden"),
      isOpen: () => sheetRef.current !== "hidden",
    }),
    [snapTo],
  );

  // ── Citation navigation hooks ─────────────────────────────────────────────
  useEffect(
    () =>
      registerReaderPanelHooks({
        shrinkToPeek: () => {
          if (sheetRef.current !== "hidden") snapTo("peek");
        },
        showSourceCard: (card) => setSourceCard(card),
      }),
    [snapTo],
  );

  useEffect(() => {
    if (!onNavigateToCitation) return;
    return registerReaderCitationTarget({ kind: readerKind, navigate: onNavigateToCitation });
  }, [onNavigateToCitation, readerKind]);

  // ── iOS lifecycle: a stream that died in the background shows Retry ──────
  useEffect(() => {
    let backgroundAt = 0;
    const sub = AppState.addEventListener("change", (state) => {
      const flight = inflightRef.current;
      if (state !== "active") {
        backgroundAt = Date.now();
        return;
      }
      if (flight && backgroundAt && Date.now() - backgroundAt > 3_000 && flight.lastProgress <= backgroundAt) {
        flight.suspended = true;
        flight.controller.abort();
      }
      backgroundAt = 0;
    });
    return () => sub.remove();
  }, []);

  // ── Messages ──────────────────────────────────────────────────────────────
  const updateMessage = useCallback((id: string, patch: Partial<AIChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  const ensureChatDocument = useCallback(async (): Promise<string> => {
    const d = docRef.current;
    if (!d) throw new Error("No document is open.");
    if (chatDocIdRef.current) return chatDocIdRef.current;
    const session = await extractDocumentForChat(d);
    chatDocIdRef.current = session.docId;
    locatorRef.current =
      session.locatorType ?? locatorTypeForDocument({ name: d.name, mimeType: d.mimeType, fileType: session.fileType });
    setDocRefDocId(d, session.docId, locatorRef.current);
    return session.docId;
  }, []);

  const handleFailure = useCallback(
    (err: unknown, ids: { user: string; assistant: string }, retry: () => void) => {
      setMessages((prev) => prev.filter((m) => m.id !== ids.assistant));
      if (isPresentableAIError(err)) {
        setMessages((prev) => prev.filter((m) => m.id !== ids.user));
        presentAIError(err, { onRetry: retry });
        return;
      }
      const msg =
        aiErrorInlineMessage(err) ?? (err instanceof Error ? err.message : "Something went wrong.");
      setMessages((prev) => [...prev, createMessage("assistant", `❌ ${msg}`)]);
    },
    [],
  );

  const askDocument = useCallback(
    async (question: string, display: string) => {
      if (busyRef.current || !docRef.current) return;
      const userMsg = createMessage("user", display);
      const assistantId = generateId();
      const history = messagesRef.current.filter((m) => m.streamState !== "streaming");
      questionsRef.current.set(assistantId, { question, display });
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streamState: "streaming" },
      ]);
      setBusy(true);
      scrollToEnd();

      const progress = { text: "", cancelled: false };
      const local = new AbortController();
      inflightRef.current = { controller: local, lastProgress: Date.now(), suspended: false };

      try {
        const result = await runCancelable(
          async (signal) => {
            signal.addEventListener("abort", () => local.abort());
            const docId = await ensureChatDocument();
            return answerDocumentQuestion({
              docRef: docRef.current!,
              docId,
              question,
              history,
              signal: local.signal,
              locatorType: locatorRef.current,
              preserveMarkdown: true,
              onText: (text) => {
                if (progress.cancelled) return;
                progress.text = text;
                if (inflightRef.current) inflightRef.current.lastProgress = Date.now();
                updateMessage(assistantId, { content: text });
              },
              reupload: async (d) => {
                const s = await extractDocumentForChat(d, { force: true });
                chatDocIdRef.current = s.docId;
                return s.docId;
              },
            });
          },
          { kind: "ai", label: "Reading the document" },
        );
        updateMessage(assistantId, {
          content: result.content,
          streamState: result.streamState,
          format: result.format,
          citations: result.citations.length ? result.citations : undefined,
          locatorType: result.locatorType,
        });
        if (!result.streamState) AccessibilityInfo.announceForAccessibility?.("Answer ready");
      } catch (err) {
        if (inflightRef.current?.suspended) {
          updateMessage(assistantId, { content: progress.text, streamState: "interrupted" });
          return;
        }
        if (isCancelError(err)) {
          progress.cancelled = true;
          if (progress.text) {
            updateMessage(assistantId, { streamState: "stopped" });
          } else {
            setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
          }
          return;
        }
        handleFailure(err, { user: userMsg.id, assistant: assistantId }, () => {
          void askDocumentRef.current(question, display);
        });
      } finally {
        inflightRef.current = null;
        setBusy(false);
      }
    },
    [ensureChatDocument, updateMessage, scrollToEnd, handleFailure],
  );
  const askDocumentRef = useRef(askDocument);
  askDocumentRef.current = askDocument;

  const runTask = useCallback(
    async (display: string, label: string, exec: (signal: AbortSignal) => Promise<AIResponse>) => {
      if (busyRef.current || !docRef.current) return;
      const userMsg = createMessage("user", display);
      const assistantId = generateId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", timestamp: Date.now(), streamState: "streaming" },
      ]);
      setBusy(true);
      scrollToEnd();
      try {
        const res = await runCancelable(exec, { kind: "ai", label });
        const msg = createMessage("assistant", res.content, res.structuredData, messageExtrasFromResponse(res));
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...msg, id: assistantId } : m)));
        AccessibilityInfo.announceForAccessibility?.("Answer ready");
      } catch (err) {
        if (isCancelError(err)) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
          return;
        }
        handleFailure(err, { user: userMsg.id, assistant: assistantId }, () => {
          void runTaskRef.current(display, label, exec);
        });
      } finally {
        setBusy(false);
      }
    },
    [scrollToEnd, handleFailure],
  );
  const runTaskRef = useRef(runTask);
  runTaskRef.current = runTask;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleSummarize = useCallback(() => {
    const d = docRef.current;
    if (!d) return;
    void runTask(`Summarize “${d.name}”`, "Summarizing", async (signal) => {
      const text = await extractDocumentText(d);
      if (isPlaceholderText(text) && !getDocumentId(d)) {
        throw new Error("Gozlin couldn't read the text of this document.");
      }
      return summarize(text, d.name, signal, { docRef: d, preserveMarkdown: true });
    });
  }, [runTask]);

  const handleExplain = useCallback(() => {
    const s = selection;
    if (!s) return;
    void runTask(`Explain: “${s.length > 120 ? `${s.slice(0, 120)}…` : s}”`, "Explaining", (signal) =>
      explainText(s, undefined, undefined, signal, { preserveMarkdown: true }),
    );
  }, [runTask, selection]);

  const handleTranslate = useCallback(
    (code: string, label: string) => {
      const s = selection;
      setShowLanguages(false);
      if (!s || !docRef.current) return;
      const name = docRef.current.name;
      void runTask(`Translate to ${label}: “${s.length > 100 ? `${s.slice(0, 100)}…` : s}”`, "Translating", (signal) =>
        translate(s, code, name, signal, { preserveMarkdown: true }),
      );
    },
    [runTask, selection],
  );

  const handleAskSelection = useCallback(() => {
    const s = selection;
    if (!s) return;
    const typed = input.trim();
    const question = `About this passage from the document: "${s}"\n\n${
      typed || "Explain what this passage means in the context of the document."
    }`;
    const display = `“${s.length > 160 ? `${s.slice(0, 160)}…` : s}”${typed ? `\n\n${typed}` : ""}`;
    setInput("");
    void askDocument(question, display);
  }, [askDocument, input, selection]);

  const handleSend = useCallback(() => {
    const typed = input.trim();
    if (!typed) return;
    if (selection) {
      handleAskSelection();
      return;
    }
    setInput("");
    void askDocument(typed, typed);
  }, [askDocument, handleAskSelection, input, selection]);

  const handleCitationPress = useCallback((citation: AICitation) => {
    void navigateToCitation(citation, { source: "reader-panel" });
  }, []);

  const handleRetry = useCallback(
    (message: AIChatMessage) => {
      const q = questionsRef.current.get(message.id);
      if (!q) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === message.id);
        if (idx < 0) return prev;
        const next = prev.slice();
        next.splice(idx > 0 && prev[idx - 1].role === "user" ? idx - 1 : idx, idx > 0 && prev[idx - 1].role === "user" ? 2 : 1);
        return next;
      });
      setTimeout(() => void askDocumentRef.current(q.question, q.display), 0);
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: AIChatMessage }) => (
      <AIChatBubble message={item} onCitationPress={handleCitationPress} onRetry={handleRetry} />
    ),
    [handleCitationPress, handleRetry],
  );
  const keyExtractor = useCallback((m: AIChatMessage) => m.id, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const bg = mode === "dark" ? "#0B1120" : "#FFFFFF";
  const border = mode === "dark" ? "#1E293B" : "#E2E8F0";
  const chipBg = mode === "dark" ? "#1E293B" : "#F5F3FF";
  const hidden = sheet === "hidden";

  const quickActions = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.actionsRow}
      keyboardShouldPersistTaps="handled"
    >
      <ActionChip icon={<BookOpen size={14} color={ACCENT} />} label="Summarize" onPress={handleSummarize} disabled={busy} bg={chipBg} color={t.text} />
      <ActionChip icon={<Lightbulb size={14} color={ACCENT} />} label="Explain selection" onPress={handleExplain} disabled={busy || !selection} bg={chipBg} color={t.text} />
      <ActionChip icon={<Languages size={14} color={ACCENT} />} label="Translate selection" onPress={() => setShowLanguages((v) => !v)} disabled={busy || !selection} bg={chipBg} color={t.text} />
      <ActionChip icon={<MessageSquare size={14} color={ACCENT} />} label="Ask about selection" onPress={handleAskSelection} disabled={busy || !selection} bg={chipBg} color={t.text} />
    </ScrollView>
  );

  const body = !isPremium ? (
    <View style={styles.upsell}>
      <Crown size={28} color={ACCENT} />
      <Text allowFontScaling style={[styles.upsellTitle, { color: t.text }]}>
        Gozlin is a Premium feature
      </Text>
      <Text allowFontScaling style={[styles.upsellText, { color: t.textSecondary }]}>
        Ask questions about this document without leaving the reader.
      </Text>
      <Pressable
        onPress={() => router.push("/premium" as any)}
        style={[styles.upsellBtn, { backgroundColor: ACCENT }]}
        accessibilityRole="button"
      >
        <Text style={styles.upsellBtnText}>See Premium</Text>
      </Pressable>
    </View>
  ) : (
    <>
      <FlatList
        ref={listRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (busyRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Sparkles size={22} color={ACCENT} />
            <Text allowFontScaling style={[styles.emptyText, { color: t.textSecondary }]}>
              Ask anything about “{document?.name ?? "this document"}”. Answers cite the pages they come from.
            </Text>
          </View>
        }
      />
      {quickActions}
      {showLanguages && selection ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsRow}>
          {TRANSLATE_LANGUAGES.map((l) => (
            <ActionChip key={l.code} label={l.label} onPress={() => handleTranslate(l.code, l.label)} disabled={busy} bg={chipBg} color={t.text} />
          ))}
        </ScrollView>
      ) : null}
      {selection ? (
        <View style={[styles.selectionChip, { backgroundColor: chipBg, borderColor: border }]}>
          <Text allowFontScaling numberOfLines={2} style={[styles.selectionText, { color: t.text }]}>
            “{selection}”
          </Text>
          <Pressable onPress={() => setSelection(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove selected text">
            <X size={14} color={t.textTertiary} />
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.inputRow, { borderTopColor: border, paddingBottom: 8 + (wide ? insets.bottom : Math.max(insets.bottom, 0)) }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={selection ? "Ask about the selection…" : "Ask about this document…"}
          placeholderTextColor={t.textTertiary}
          style={[styles.input, { color: t.text, backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}
          multiline
          maxLength={2000}
          editable={!busy}
          onFocus={() => {
            if (!wide && sheetRef.current !== "expanded") snapTo("expanded");
          }}
          allowFontScaling
          accessibilityLabel="Question for Gozlin"
        />
        <Pressable
          onPress={handleSend}
          disabled={busy || !input.trim()}
          style={[styles.sendBtn, { backgroundColor: busy || !input.trim() ? border : ACCENT }]}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Send size={16} color={busy || !input.trim() ? t.textTertiary : "#FFFFFF"} />
        </Pressable>
      </View>
    </>
  );

  const header = (
    <View style={styles.header}>
      {!wide ? <View style={[styles.grabber, { backgroundColor: border }]} /> : null}
      <View style={styles.headerRow}>
        <Sparkles size={16} color={ACCENT} />
        <View style={styles.flex}>
          <Text allowFontScaling style={[styles.title, { color: t.text }]} accessibilityRole="header">
            Ask gozlin
          </Text>
          {document?.name ? (
            <Text allowFontScaling numberOfLines={1} style={[styles.subtitle, { color: t.textTertiary }]}>
              {document.name}
            </Text>
          ) : null}
        </View>
        {onOpenFullScreen ? (
          <Pressable
            onPress={() => {
              snapTo("hidden");
              onOpenFullScreen();
            }}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Open full screen"
          >
            <Maximize2 size={16} color={t.textSecondary} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => snapTo("hidden")}
          hitSlop={8}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Close Gozlin panel"
        >
          <X size={18} color={t.textSecondary} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      {sourceCard && !hidden ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.sourceCardWrap,
            wide
              ? { top: insets.top + 56, left: 12, right: SIDE_PANEL_WIDTH + 12 }
              : { left: 12, right: 12, bottom: bottomOffset + peekH + 12 },
          ]}
        >
          <SourceCard label={sourceCard.label} quote={sourceCard.quote} onClose={() => setSourceCard(null)} />
        </View>
      ) : null}

      <Animated.View
        pointerEvents={hidden ? "none" : "auto"}
        style={
          wide
            ? [styles.side, { top: insets.top, bottom: bottomOffset, backgroundColor: bg, borderColor: border }, sideStyle]
            : [styles.sheet, { bottom: bottomOffset, backgroundColor: bg, borderColor: border }, sheetStyle]
        }
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {wide ? header : <GestureDetector gesture={pan}>{header}</GestureDetector>}
          {hasOpened ? body : null}
        </KeyboardAvoidingView>
      </Animated.View>
    </>
  );
});

function ActionChip({
  icon,
  label,
  onPress,
  disabled,
  bg,
  color,
}: {
  icon?: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  bg: string;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, { backgroundColor: bg, opacity: disabled ? 0.45 : 1 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      {icon}
      <Text allowFontScaling style={[styles.chipText, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Outer wrapper (error boundary + crash toast) ────────────────────────────

const MAX_REMOUNTS = 3;

export const ReaderAIPanel = React.memo(
  forwardRef<ReaderAIPanelHandle, ReaderAIPanelProps>(function ReaderAIPanel(props, ref) {
    const innerRef = useRef<ReaderAIPanelHandle>(null);
    const [epoch, setEpoch] = useState(0);
    const [toast, setToast] = useState<string | null>(null);
    const crashesRef = useRef(0);

    useImperativeHandle(
      ref,
      () => ({
        open: (options) => innerRef.current?.open(options),
        close: () => innerRef.current?.close(),
        isOpen: () => innerRef.current?.isOpen() ?? false,
      }),
      [],
    );

    useEffect(() => {
      if (!toast) return;
      const id = setTimeout(() => setToast(null), 3_000);
      return () => clearTimeout(id);
    }, [toast]);

    const onError = useCallback((error: Error) => {
      console.warn("[ReaderAIPanel] crashed and closed:", error);
      setToast("Gozlin had a problem and closed. Your reading isn't affected.");
      crashesRef.current += 1;
      if (crashesRef.current <= MAX_REMOUNTS) setEpoch((n) => n + 1);
    }, []);

    return (
      <>
        <PanelErrorBoundary key={epoch} onError={onError}>
          <PanelInner ref={innerRef} {...props} />
        </PanelErrorBoundary>
        {toast ? (
          <View pointerEvents="none" style={styles.toastWrap}>
            <Text allowFontScaling style={styles.toast}>
              {toast}
            </Text>
          </View>
        ) : null}
      </>
    );
  }),
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    zIndex: 1200,
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  side: {
    position: "absolute",
    right: 0,
    width: SIDE_PANEL_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    zIndex: 1200,
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  header: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerBtn: { padding: 6 },
  title: { fontSize: 15, fontWeight: "700" },
  subtitle: { fontSize: 11.5 },
  listContent: { paddingHorizontal: 10, paddingBottom: 8, flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  actionsRow: { paddingHorizontal: 10, paddingVertical: 6, gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16 },
  chipText: { fontSize: 12.5, fontWeight: "600" },
  selectionChip: {
    marginHorizontal: 10,
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectionText: { flex: 1, fontSize: 12.5, fontStyle: "italic" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 9 : 6, fontSize: 14, maxHeight: 110 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  upsell: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  upsellTitle: { fontSize: 16, fontWeight: "700" },
  upsellText: { fontSize: 13, textAlign: "center" },
  upsellBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  upsellBtnText: { color: "#FFFFFF", fontWeight: "700" },
  sourceCardWrap: { position: "absolute", zIndex: 1300 },
  toastWrap: { position: "absolute", left: 16, right: 16, bottom: 48, alignItems: "center", zIndex: 1400 },
  toast: {
    backgroundColor: "rgba(0,0,0,0.8)",
    color: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: "hidden",
    fontSize: 13,
  },
});
