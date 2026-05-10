// ============================================
// AI Tab Screen – full-featured AI assistant
// ============================================

import {
  AIChatBubble,
  AIEmptyState,
  AILanguagePicker,
  AISessionHistory,
  AthemiHeader,
} from "@/components/ai";
import GenerateDocumentModal from "@/components/ai/GenerateDocumentModal";
import { QuizPanel } from "@/components/ai/QuizPanel";
import { LibraryFilePicker } from "@/components/LibraryFilePicker";
import { PINGate } from "@/components/PINGate";
import { aiFeatures } from "@/constants/ai-features";
import { spacing } from "@/constants/theme";
import type {
  AIAction,
  AIChatMessage,
  AIDocumentRef,
  AISession,
  HighlightItem,
} from "@/services/ai";
import {
  analyze,
  classifyDocument,
  clearAIScreenState,
  clearAllSessions,
  convertHighlightToTask,
  createMessage,
  createSession,
  deleteSession as deleteSessionStorage,
  explainText,
  extractDocumentText,
  extractTasks,
  generateDocument,
  getAIScreenState,
  hasUnfinishedWork,
  highlightKeyPoints,
  initAIProvider,
  loadSessions,
  pickDocument,
  saveAIScreenState,
  saveSession,
  sendChat,
  summarize,
  SUPPORTED_LANGUAGES,
  translate,
} from "@/services/ai";
import { useTheme } from "@/services/ThemeProvider";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  Clock,
  Copy,
  FileSearch,
  FileText,
  Globe,
  GraduationCap,
  Highlighter,
  Languages,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Paperclip,
  ScanSearch,
  Send,
  Wand2,
  X,
} from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCENT = "#9333EA";
const GRID_GAP = 6;
const GRID_COLUMNS = 3;
const GRID_H_PADDING = 8;
const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_WIDTH = Math.floor(
  (SCREEN_WIDTH - GRID_H_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) /
    GRID_COLUMNS,
);

// ── Module-level constants (avoid re-creation on each render) ───────────────
const FILE_ONLY_MODES: AIAction[] = [
  "summarize",
  "translate",
  "extract-text",
  "analyze",
  "tasks",
  "classify",
  "highlight",
  "explain",
  // "quiz" intentionally excluded — quiz uses its own dedicated panel with
  // built-in file handling and does not participate in the chat send flow.
];

const FEATURE_ICONS: Record<string, React.ComponentType<any>> = {
  summarize: BookOpen,
  translate: Languages,
  "extract-text": FileText,
  chat: MessageSquare,
  analyze: Brain,
  tasks: ListChecks,
  "generate-document": Wand2,
  "chat-with-document": FileText,
  classify: ScanSearch,
  highlight: Highlighter,
  explain: Lightbulb,
  quiz: GraduationCap,
  workspace: Wand2,
};

// ── Title inference for generated documents ──────────────────────────────────
function inferDocTitle(prompt: string, category: string): string {
  const cleaned = prompt
    .trim()
    .replace(/^(write|create|generate|make|build|produce|draft|compose|prepare)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .trim();
  const firstSentence = cleaned.split(/[.!?]/)[0].trim();
  const words = firstSentence.split(/\s+/).slice(0, 8);
  if (words.length < 2) return `${category} Document`;
  const stop = new Set(["a","an","the","and","or","but","in","on","at","to","for","of","with","by","about"]);
  const title = words
    .map((w, i) => (i === 0 || !stop.has(w.toLowerCase()))
      ? w.charAt(0).toUpperCase() + w.slice(1)
      : w.toLowerCase())
    .join(" ");
  return title.length >= 4 ? title : `${category} Document`;
}

// ── Page selection utilities ──────────────────────────────────────────────────
function parsePageSelection(input: string, totalPages: number): number[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>();
  for (const part of normalized.split(",")) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1]);
      const to = parseInt(rangeMatch[2]);
      for (let p = Math.max(1, from); p <= Math.min(totalPages, to); p++) pages.add(p);
    } else {
      const n = parseInt(trimmed);
      if (!isNaN(n) && n >= 1 && n <= totalPages) pages.add(n);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function extractTextForPages(fullText: string, pageNums: number[], totalPages: number): string {
  if (pageNums.length >= totalPages) return fullText;
  const sections: Record<number, string> = {};
  const regex = /\[Page (\d+)\]/g;
  const hits: Array<{ page: number; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(fullText)) !== null) hits.push({ page: parseInt(m[1]), index: m.index });
  if (hits.length === 0) return fullText;
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : fullText.length;
    sections[hits[i].page] = fullText.slice(start, end);
  }
  return pageNums.filter(p => sections[p]).map(p => sections[p]).join("\n\n") || fullText;
}

export default function AIScreen() {
  const { colors: t, mode } = useTheme();
  const router = useRouter();
  // "Ask gozlin" deep-link: viewers pass selected text as a route param
  const { initialText } = useLocalSearchParams<{ initialText?: string }>();

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeAction, setActiveAction] = useState<AIAction>("chat");
  const [session, setSession] = useState<AISession>(createSession("chat"));
  const [allSessions, setAllSessions] = useState<AISession[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachedDoc, setAttachedDoc] = useState<AIDocumentRef | undefined>();
  const [docText, setDocText] = useState<string | undefined>();
  const [extractionStatus, setExtractionStatus] = useState<
    "none" | "extracted" | "partial"
  >("none");

  // Translate-specific
  const [targetLang, setTargetLang] = useState("es");
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [translateDoc, setTranslateDoc] = useState<AIDocumentRef | undefined>();
  const [translateDocText, setTranslateDocText] = useState<string | undefined>();
  const [translateDocPageCount, setTranslateDocPageCount] = useState(0);
  const [translatePageInput, setTranslatePageInput] = useState("all");
  const [translateMessages, setTranslateMessages] = useState<Array<{ id: string; type: "request" | "response" | "error"; label: string; content: string; timestamp: number }>>([]);
  const [translateFreeText, setTranslateFreeText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateOutputMode, setTranslateOutputMode] = useState<"text" | "document">("text");
  const [translateDocFormat, setTranslateDocFormat] = useState<"pdf" | "docx">("pdf");
  const [translateProgress, setTranslateProgress] = useState<string | null>(null);
  const [isExtractingTranslateDoc, setIsExtractingTranslateDoc] = useState(false);
  const [translateDocExtractionFailed, setTranslateDocExtractionFailed] = useState(false);
  const [isExtractingAttachedDoc, setIsExtractingAttachedDoc] = useState(false);
  const translateScrollRef = useRef<ScrollView>(null);
  const translateContentHeightRef = useRef<number>(0);
  // When a new assistant response is appended, this stores the "y" offset where
  // that response starts. The ScrollView's onContentSizeChange handler then
  // scrolls to it, anchoring the top of the response at the top of the viewport.
  const translatePendingTopRef = useRef<number | null>(null);

  // History modal
  const [showHistory, setShowHistory] = useState(false);

  // Dropdown features panel
  const [showFeaturesDropdown, setShowFeaturesDropdown] = useState(false);

  // Attachment expansion
  const [attachmentExpanded, setAttachmentExpanded] = useState(false);

  // File source picker modal
  const [showFileSourcePicker, setShowFileSourcePicker] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  // Generate Document modal
  const [showGenerateDocumentModal, setShowGenerateDocumentModal] =
    useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const scrollRef = useRef<FlatList>(null);
  const filePickerForRef = useRef<"attach" | "translate">("attach");
  const navigation = useNavigation();

  // ── Close dropdown on screen blur / navigation away ─────────────────────
  useEffect(() => {
    const unsubBlur = navigation.addListener("blur", () => {
      setShowFeaturesDropdown(false);
    });
    return unsubBlur;
  }, [navigation]);

  // ── Reset to Chat on screen focus if no unfinished work ─────────────────
  useEffect(() => {
    const unsubFocus = navigation.addListener("focus", () => {
      const saved = getAIScreenState();
      if (hasUnfinishedWork(saved) && saved) {
        setActiveAction(saved.activeAction);
        setSession(saved.session);
        setInputText(saved.inputText);
        setAttachedDoc(saved.attachedDoc);
        setDocText(saved.docText);
        setExtractionStatus(saved.extractionStatus);
        setTargetLang(saved.targetLang);
        setAttachmentExpanded(saved.attachmentExpanded);
      } else {
        // No unfinished work — reset to Chat
        if (activeAction !== "chat" || session.messages.length > 0) {
          setActiveAction("chat");
          setSession(createSession("chat"));
          setInputText("");
          setAttachedDoc(undefined);
          setDocText(undefined);
          setExtractionStatus("none");
          setAttachmentExpanded(false);
        }
        clearAIScreenState();
      }
    });
    return unsubFocus;
  }, [navigation, activeAction, session.messages.length]);

  // ── Close dropdown on Android hardware back ─────────────────────────────
  useEffect(() => {
    if (!showFeaturesDropdown) return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowFeaturesDropdown(false);
      return true; // consume the event
    });
    return () => handler.remove();
  }, [showFeaturesDropdown]);

  // ── Restore unfinished work on mount / save on unmount ─────────────────
  useEffect(() => {
    // Probe backend and switch from mock to real AI if available
    initAIProvider();

    const saved = getAIScreenState();
    if (hasUnfinishedWork(saved) && saved) {
      setActiveAction(saved.activeAction);
      setSession(saved.session);
      setInputText(saved.inputText);
      setAttachedDoc(saved.attachedDoc);
      setDocText(saved.docText);
      setExtractionStatus(saved.extractionStatus);
      setTargetLang(saved.targetLang);
      setAttachmentExpanded(saved.attachmentExpanded);
    }
    // else: defaults already set to "chat"

    return () => {
      // Save current state on unmount so it can be restored later
      // We read the latest values via the ref-backed getter below.
    };
  }, []);

  // ── Pre-populate input from "Ask gozlin" deep-link ─────────────────────────
  useEffect(() => {
    if (initialText && typeof initialText === "string" && initialText.trim()) {
      // Start a fresh chat session with the highlighted text as the input
      setActiveAction("chat");
      setSession(createSession("chat"));
      setInputText(initialText.trim());
      clearAIScreenState();
    }
    // Run only once on mount (initialText is a route param, stable for this screen visit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // We need a ref to capture latest state for the unmount cleanup.
  const stateRef = useRef({
    activeAction,
    session,
    inputText,
    attachedDoc,
    docText,
    extractionStatus,
    targetLang,
    attachmentExpanded,
  });
  useEffect(() => {
    stateRef.current = {
      activeAction,
      session,
      inputText,
      attachedDoc,
      docText,
      extractionStatus,
      targetLang,
      attachmentExpanded,
    };
  });

  // Save snapshot when the screen unmounts (user navigates away)
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      saveAIScreenState({
        activeAction: s.activeAction,
        session: s.session,
        inputText: s.inputText,
        attachedDoc: s.attachedDoc,
        docText: s.docText,
        extractionStatus: s.extractionStatus,
        targetLang: s.targetLang,
        attachmentExpanded: s.attachmentExpanded,
      });
    };
  }, []);

  // ── Load sessions on mount ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    loadSessions()
      .then((s) => {
        if (mounted) setAllSessions(s);
      })
      .catch(console.error);
    return () => {
      mounted = false;
    };
  }, []);

  // ── Smart scroll on new messages ──────────────────────────────────────────
  // - User messages: anchor at the bottom (scrollToEnd) so the input stays in view.
  // - Assistant messages (AI results): anchor the START of the response at the
  //   top of the viewport so users naturally read top-to-bottom.
  const lastMessage = session.messages[session.messages.length - 1];
  useEffect(() => {
    if (!lastMessage) return;
    const idx = session.messages.length - 1;
    if (lastMessage.role === "assistant") {
      // Two passes — once for initial render, once after structured renderers
      // expand the bubble and the FlatList may need to recompute layout.
      const tryScroll = () => {
        try {
          scrollRef.current?.scrollToIndex({
            index: idx,
            viewPosition: 0,
            animated: true,
          });
        } catch {
          // Fall back to offset-based scroll if scrollToIndex fails
        }
      };
      setTimeout(tryScroll, 80);
      setTimeout(tryScroll, 320);
    } else {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage?.id, lastMessage?.role]);

  // ── Persist session whenever messages change ──────────────────────────────
  useEffect(() => {
    if (session.messages.length > 0) {
      const updated = { ...session, updatedAt: Date.now() };
      saveSession(updated);
      loadSessions().then(setAllSessions).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.messages.length]);

  // ── Mode change handler ───────────────────────────────────────────────────
  const handleModeChange = useCallback(
    (action: AIAction) => {
      if (action === activeAction) return;
      if (session.messages.length > 0) {
        saveSession({ ...session, updatedAt: Date.now() });
      }
      setActiveAction(action);
      setSession(createSession(action, attachedDoc));
      setInputText("");
      setAttachmentExpanded(false);
    },
    [activeAction, session, attachedDoc],
  );

  // ── Translate: document-based translation ─────────────────────────────────
  const handleTranslateDocPick = useCallback(() => {
    filePickerForRef.current = "translate";
    setShowFileSourcePicker(true);
  }, []);

  const handleTranslateRemoveDoc = useCallback(() => {
    setTranslateDoc(undefined);
    setTranslateDocText(undefined);
    setTranslateDocPageCount(0);
    setTranslatePageInput("all");
    setTranslateDocExtractionFailed(false);
  }, []);

  const handleTranslateSubmit = useCallback(async () => {
    if (isTranslating) return;
    const currentLangLabel = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang)?.name ?? targetLang;
    const msgId = String(Date.now());

    if (translateDoc) {
      const text = translateDocText ?? "";
      if (!text.trim()) {
        Alert.alert("No Text", "Could not extract text from this document. Try a text-based PDF or DOCX.");
        return;
      }
      const pageNums = parsePageSelection(translatePageInput, translateDocPageCount || 1);
      const pageLabel =
        !translatePageInput.trim() || translatePageInput.trim().toLowerCase() === "all"
          ? "All pages"
          : `Pages ${translatePageInput.trim()}`;
      const textToTranslate = extractTextForPages(text, pageNums, translateDocPageCount || 1);

      // ── Document output mode ──────────────────────────────────────────────
      if (translateOutputMode === "document") {
        setIsTranslating(true);
        setTranslateProgress("Translating…");
        try {
          const response = await translate(textToTranslate, targetLang, translateDoc.name);
          setTranslateProgress("Creating document…");
          const baseName = translateDoc.name.replace(/\.[^.]+$/, "");
          const docTitle = `${baseName}_Translated_${currentLangLabel}`;
          const { setPendingGeneration } = await import("@/services/generatedDocStore");
          setPendingGeneration({
            content: response.content,
            title: docTitle,
            fileType: translateDocFormat,
            category: "Translation",
            tone: "professional",
            wordCount: response.content.split(/\s+/).length,
          });
          router.push("/gozlin-generated-preview" as any);
        } catch {
          setTranslateMessages((prev) => [
            ...prev,
            { id: `${msgId}_e`, type: "error", label: "Error", content: "Translation or document creation failed. Please try again.", timestamp: Date.now() },
          ]);
        } finally {
          setIsTranslating(false);
          setTranslateProgress(null);
        }
        return;
      }

      // ── Text output mode (existing behavior) ─────────────────────────────
      setTranslateMessages((prev) => [
        ...prev,
        { id: msgId, type: "request", label: `${pageLabel} · ${translateDoc.name} → ${currentLangLabel}`, content: "", timestamp: Date.now() },
      ]);
      setIsTranslating(true);
      try {
        const beforeY = translateContentHeightRef.current;
        const response = await translate(textToTranslate, targetLang, translateDoc.name);
        setTranslateMessages((prev) => [
          ...prev,
          { id: `${msgId}_r`, type: "response", label: currentLangLabel, content: response.content, timestamp: Date.now() },
        ]);
        // Anchor the start of the new response at the top of the viewport
        translatePendingTopRef.current = beforeY;
      } catch {
        setTranslateMessages((prev) => [
          ...prev,
          { id: `${msgId}_e`, type: "error", label: "Error", content: "Translation failed. Please try again.", timestamp: Date.now() },
        ]);
      } finally {
        setIsTranslating(false);
      }
    } else {
      const text = translateFreeText.trim();
      if (!text) return;
      const preview = text.length > 60 ? text.slice(0, 60) + "…" : text;

      // ── Document output mode ──────────────────────────────────────────────
      if (translateOutputMode === "document") {
        setIsTranslating(true);
        setTranslateProgress("Translating…");
        try {
          const response = await translate(text, targetLang, "text");
          setTranslateProgress("Creating document…");
          const docTitle = `Translated_Text_${currentLangLabel}`;
          const { setPendingGeneration } = await import("@/services/generatedDocStore");
          setPendingGeneration({
            content: response.content,
            title: docTitle,
            fileType: translateDocFormat,
            category: "Translation",
            tone: "professional",
            wordCount: response.content.split(/\s+/).length,
          });
          setTranslateFreeText("");
          router.push("/gozlin-generated-preview" as any);
        } catch {
          setTranslateMessages((prev) => [
            ...prev,
            { id: `${msgId}_e`, type: "error", label: "Error", content: "Translation or document creation failed. Please try again.", timestamp: Date.now() },
          ]);
        } finally {
          setIsTranslating(false);
          setTranslateProgress(null);
        }
        return;
      }

      // ── Text output mode (existing behavior) ─────────────────────────────
      setTranslateMessages((prev) => [
        ...prev,
        { id: msgId, type: "request", label: `"${preview}" → ${currentLangLabel}`, content: "", timestamp: Date.now() },
      ]);
      setTranslateFreeText("");
      setIsTranslating(true);
      try {
        const beforeY = translateContentHeightRef.current;
        const response = await translate(text, targetLang, "text");
        setTranslateMessages((prev) => [
          ...prev,
          { id: `${msgId}_r`, type: "response", label: currentLangLabel, content: response.content, timestamp: Date.now() },
        ]);
        // Anchor the start of the new response at the top of the viewport
        translatePendingTopRef.current = beforeY;
      } catch {
        setTranslateMessages((prev) => [
          ...prev,
          { id: `${msgId}_e`, type: "error", label: "Error", content: "Translation failed. Please try again.", timestamp: Date.now() },
        ]);
      } finally {
        setIsTranslating(false);
      }
    }
  }, [translateDoc, translateDocText, translateDocPageCount, translatePageInput, translateFreeText, isTranslating, targetLang, translateOutputMode, translateDocFormat, router]);

  const handleTranslateClearHistory = useCallback(() => {
    setTranslateMessages([]);
  }, []);

  const handleCopyTranslateMessage = useCallback(async (content: string) => {
    const { copyToClipboard } = await import("@/services/ai/ai.service");
    await copyToClipboard(content);
  }, []);

  // Clear translate state when leaving translate mode
  useEffect(() => {
    if (activeAction !== "translate") {
      setTranslateDoc(undefined);
      setTranslateDocText(undefined);
      setTranslateDocPageCount(0);
      setTranslatePageInput("all");
      setTranslateFreeText("");
      setTranslateMessages([]);
      setIsTranslating(false);
      setTranslateProgress(null);
      setTranslateDocExtractionFailed(false);
    }
  }, [activeAction]);

  // ── Document attachment ───────────────────────────────────────────────────
  const handleAttachDocument = useCallback(async () => {
    filePickerForRef.current = "attach";
    setShowFileSourcePicker(true);
  }, []);

  const handlePickFromDevice = useCallback(async () => {
    setShowFileSourcePicker(false);

    const doc = await pickDocument();
    if (!doc) return;

    if (filePickerForRef.current === "translate") {
      setIsExtractingTranslateDoc(true);
      setTranslateDocExtractionFailed(false);
      setTranslateDoc(doc);
      setTranslateDocText(undefined);
      setTranslateDocPageCount(0);
      setTranslatePageInput("all");
      try {
        const text = await extractDocumentText(doc);
        const isPlaceholder =
          !text ||
          (text.trimStart().startsWith("[") &&
            (text.includes("extraction was not available") ||
              text.includes("Extraction failed") ||
              text.includes("extraction is not available") ||
              text.includes("Failed to read") ||
              text.includes("no text extracted")));
        if (isPlaceholder) {
          setTranslateDocText("");
          setTranslateDocExtractionFailed(true);
          setTranslateDocPageCount(1);
        } else {
          setTranslateDocText(text ?? "");
          const pageMatches = text?.match(/\[Page \d+\]/g);
          setTranslateDocPageCount(pageMatches ? pageMatches.length : 1);
        }
      } catch {
        setTranslateDocText("");
        setTranslateDocExtractionFailed(true);
        setTranslateDocPageCount(1);
      } finally {
        setIsExtractingTranslateDoc(false);
      }
      return;
    }

    setAttachedDoc(doc);
    setExtractionStatus("none");
    setIsExtractingAttachedDoc(true);

    try {
      const text = await extractDocumentText(doc);
      setDocText(text);

      const _trimmedForStatus = text?.trimStart() ?? "";
      if (text && (_trimmedForStatus.startsWith("[Page ") || !_trimmedForStatus.startsWith("["))) {
        setExtractionStatus("extracted");
      } else {
        setExtractionStatus("partial");
      }

      setSession((prev) => ({
        ...prev,
        document: doc,
        updatedAt: Date.now(),
      }));

      const extracted = text && !text.trimStart().startsWith("[");
      const sysMsg = createMessage(
        "assistant",
        `📎 Document attached: "${doc.name}"\n${
          extracted
            ? "Text extracted and ready. You can now summarize, translate, or ask questions."
            : "Attached. You can paste relevant text in your message for best results."
        }`,
      );
      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, sysMsg],
      }));
    } finally {
      setIsExtractingAttachedDoc(false);
    }
  }, []);

  const handlePickFromApp = useCallback(() => {
    setShowFileSourcePicker(false);
    setShowLibraryPicker(true);
  }, []);

  const handleLibraryFileSelected = useCallback(async (files: any[]) => {
    setShowLibraryPicker(false);

    if (files.length === 0) return;

    const selectedFile = files[0];
    const doc: AIDocumentRef = {
      uri: selectedFile.uri,
      name: selectedFile.name,
      mimeType: selectedFile.mimeType,
      size: selectedFile.size,
    };

    if (filePickerForRef.current === "translate") {
      setIsExtractingTranslateDoc(true);
      setTranslateDocExtractionFailed(false);
      setTranslateDoc(doc);
      setTranslateDocText(undefined);
      setTranslateDocPageCount(0);
      setTranslatePageInput("all");
      try {
        const text = await extractDocumentText(doc);
        const isPlaceholder =
          !text ||
          (text.trimStart().startsWith("[") &&
            (text.includes("extraction was not available") ||
              text.includes("Extraction failed") ||
              text.includes("extraction is not available") ||
              text.includes("Failed to read") ||
              text.includes("no text extracted")));
        if (isPlaceholder) {
          setTranslateDocText("");
          setTranslateDocExtractionFailed(true);
          setTranslateDocPageCount(1);
        } else {
          setTranslateDocText(text ?? "");
          const pageMatches = text?.match(/\[Page \d+\]/g);
          setTranslateDocPageCount(pageMatches ? pageMatches.length : 1);
        }
      } catch {
        setTranslateDocText("");
        setTranslateDocExtractionFailed(true);
        setTranslateDocPageCount(1);
      } finally {
        setIsExtractingTranslateDoc(false);
      }
      return;
    }

    setAttachedDoc(doc);
    setExtractionStatus("none");
    setIsExtractingAttachedDoc(true);

    try {
      const text = await extractDocumentText(doc);
      setDocText(text);

      const _trimmedForStatus = text?.trimStart() ?? "";
      if (text && (_trimmedForStatus.startsWith("[Page ") || !_trimmedForStatus.startsWith("["))) {
        setExtractionStatus("extracted");
      } else {
        setExtractionStatus("partial");
      }

      setSession((prev) => ({
        ...prev,
        document: doc,
        updatedAt: Date.now(),
      }));

      const extracted = text && !text.trimStart().startsWith("[");
      const sysMsg = createMessage(
        "assistant",
        `📎 Document attached: "${doc.name}"\n${
          extracted
            ? "Text extracted and ready. You can now summarize, translate, or ask questions."
            : "Attached. You can paste relevant text in your message for best results."
        }`,
      );
      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, sysMsg],
      }));
    } finally {
      setIsExtractingAttachedDoc(false);
    }
  }, []);

  const handleRemoveDocument = useCallback(() => {
    setAttachedDoc(undefined);
    setDocText(undefined);
    setExtractionStatus("none");
    setSession((prev) => ({
      ...prev,
      document: undefined,
    }));
  }, []);

  // ── Modes that can be sent with just a file (no text required) ────────────
  // (hoisted to module level via FILE_ONLY_MODES constant below)

  /** True when the Send button should be enabled. */
  const canSend = useMemo(() => {
    if (isLoading) return false;
    const hasText = inputText.trim().length > 0;
    const hasFile = !!attachedDoc;
    // File-only modes: text OR file is enough
    if (FILE_ONLY_MODES.includes(activeAction)) return hasText || hasFile;
    // Other modes: text is required (file optional)
    return hasText;
  }, [isLoading, inputText, attachedDoc, activeAction]);

  // ── Main send handler ─────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    const hasText = text.length > 0;
    const hasFile = !!attachedDoc;

    // Block if nothing to send
    if (isLoading) return;
    if (!hasText && !hasFile) return;

    // Modes that strictly require a document
    if (
      (activeAction === "chat-with-document" ||
        activeAction === "extract-text" ||
        activeAction === "classify") &&
      !hasFile
    ) {
      Alert.alert(
        "Document Required",
        activeAction === "extract-text"
          ? "Please attach a PDF to extract text from."
          : activeAction === "classify"
            ? "Please attach a document to classify."
            : "Please attach a document first for this feature.",
      );
      return;
    }

    // For non-file-only modes, text is required
    if (!hasText && !FILE_ONLY_MODES.includes(activeAction)) return;

    // Build user-visible message
    const displayText = hasText ? text : `📎 Process "${attachedDoc!.name}"`;
    const userMsg = createMessage("user", displayText);
    setSession((prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      updatedAt: Date.now(),
    }));
    setInputText("");
    setIsLoading(true);

    try {
      let response;

      // Build the effective text for the AI:
      // - If docText exists (extracted from file), use it, optionally prepended by user text
      // - If only user text, use that directly
      // - If file attached but no extracted text, send user text (backend will use file)
      let effectiveText: string;
      if (docText && hasText) {
        effectiveText = `${docText}\n\n---\nUser input: ${text}`;
      } else if (docText) {
        effectiveText = docText;
      } else if (hasText) {
        effectiveText = text;
      } else {
        effectiveText = "";
      }

      switch (activeAction) {
        case "chat":
          response = await sendChat(
            text,
            session.messages,
            docText,
            attachedDoc?.name,
          );
          break;
        case "summarize":
          response = await summarize(effectiveText, attachedDoc?.name);
          break;
        case "translate":
          response = await translate(
            effectiveText,
            targetLang,
            attachedDoc?.name,
          );
          break;
        case "extract-text": {
          // Text Extraction: return the raw extracted text from the document
          // (already extracted during attachment via extractDocumentText)
          let extracted = docText;
          if (!extracted && attachedDoc) {
            extracted = await extractDocumentText(attachedDoc);
            setDocText(extracted);
            setExtractionStatus("extracted");
          }
          if (extracted && (extracted.startsWith("[Page ") || !extracted.startsWith("["))) {
            const wordCount = extracted.split(/\s+/).length;
            const pageMatches = extracted.match(/\[Page \d+\]/g);
            const pageCount = pageMatches ? pageMatches.length : 1;
            response = {
              content:
                `📄 **Extracted Text from "${attachedDoc?.name || "document"}"**\n\n` +
                `**Stats:** ${wordCount.toLocaleString()} words · ${pageCount} page${pageCount !== 1 ? "s" : ""}`,
              structuredData: {
                __kind: "document",
                fullText: extracted,
              },
            };
          } else {
            response = {
              content:
                extracted ||
                "❌ Could not extract text from this document. Please try a different PDF.",
            };
          }
          break;
        }
        case "analyze":
          response = await analyze(effectiveText, undefined, attachedDoc?.name);
          break;
        case "tasks":
          response = await extractTasks(effectiveText, attachedDoc?.name);
          break;
        case "classify":
          response = await classifyDocument(effectiveText, attachedDoc?.name);
          break;
        case "highlight":
          response = await highlightKeyPoints(effectiveText, attachedDoc?.name);
          break;
        case "explain":
          response = await explainText(effectiveText);
          break;
        case "quiz":
          // Quiz is handled entirely by QuizPanel; the input row is hidden
          // in quiz mode so this branch should never execute.
          response = { content: "" };
          break;
        case "chat-with-document":
          response = await sendChat(
            text,
            session.messages,
            docText,
            attachedDoc?.name,
          );
          break;
        default:
          response = await sendChat(text, session.messages);
      }

      const assistantMsg = createMessage(
        "assistant",
        response.content,
        response.structuredData,
      );
      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
    } catch (e) {
      const errorMsg = createMessage(
        "assistant",
        `❌ Something went wrong: ${e instanceof Error ? e.message : "Unknown error"}. Please try again.`,
      );
      setSession((prev) => ({
        ...prev,
        messages: [...prev.messages, errorMsg],
      }));
    } finally {
      setIsLoading(false);
    }
  }, [
    inputText,
    isLoading,
    activeAction,
    attachedDoc,
    docText,
    session.messages,
    targetLang,
  ]);

  // ── New session ───────────────────────────────────────────────────────────
  const handleNewSession = useCallback(() => {
    if (session.messages.length > 0) {
      saveSession({ ...session, updatedAt: Date.now() });
    }
    setActiveAction("chat");
    setSession(createSession("chat"));
    setInputText("");
    setAttachedDoc(undefined);
    setDocText(undefined);
    setExtractionStatus("none");
    clearAIScreenState();
    loadSessions().then(setAllSessions);
  }, [session]);

  // ── History handlers ──────────────────────────────────────────────────────
  const handleSelectSession = useCallback(
    (s: AISession) => {
      if (session.messages.length > 0) {
        saveSession({ ...session, updatedAt: Date.now() });
      }
      setSession(s);
      setActiveAction(s.action);
      if (s.document) {
        setAttachedDoc(s.document);
      }
      setShowHistory(false);
    },
    [session],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSessionStorage(sessionId);
      const updated = await loadSessions();
      setAllSessions(updated);
      if (session.id === sessionId) {
        setSession(createSession(activeAction));
      }
    },
    [session.id, activeAction],
  );

  const handleClearAllSessions = useCallback(() => {
    Alert.alert(
      "Clear All History",
      "This will permanently delete all gozlin conversation history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            await clearAllSessions();
            setAllSessions([]);
            setActiveAction("chat");
            setSession(createSession("chat"));
            setInputText("");
            setAttachedDoc(undefined);
            setDocText(undefined);
            setExtractionStatus("none");
            clearAIScreenState();
            setShowHistory(false);
          },
        },
      ],
    );
  }, [activeAction]);

  // ── Generate Document handler ────────────────────────────────────────────
  const handleGenerateDocument = useCallback(
    async (params: {
      title: string;
      prompt: string;
      fileType: "docx" | "pdf" | "ppt";
      category: string;
      tone: string;
      wordCount: number;
      audience: string;
    }) => {
      setIsGenerating(true);
      try {
        const response = await generateDocument(
          params.prompt,
          params.fileType,
          params.category,
          params.tone,
          params.wordCount,
          params.audience,
        );

        if (!response.content?.trim()) {
          throw new Error("Generation returned empty content. Please try again.");
        }

        const { setPendingGeneration } = await import("@/services/generatedDocStore");
        setPendingGeneration({
          content: response.content,
          title: params.title.trim() || inferDocTitle(params.prompt, params.category),
          fileType: params.fileType,
          category: params.category,
          tone: params.tone,
          wordCount: params.wordCount,
        });

        setShowGenerateDocumentModal(false);
        router.push("/gozlin-generated-preview" as any);
      } catch (e) {
        Alert.alert(
          "Generation Failed",
          e instanceof Error ? e.message : "Something went wrong. Please try again.",
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [router],
  );

  // ── Placeholder text ──────────────────────────────────────────────────────
  const placeholder = useMemo(() => {
    const placeholders: Record<AIAction, string> = {
      chat: "Ask me anything...",
      summarize: "Paste text or attach file...",
      translate: "Paste text or attach file...",
      "extract-text": attachedDoc
        ? `Extract text from "${attachedDoc.name}"...`
        : "Attach a PDF to extract text...",
      analyze: "Paste text or attach file...",
      tasks: attachedDoc
        ? `Extract tasks from "${attachedDoc.name}"...`
        : "Paste text to find tasks...",
      "fill-form": attachedDoc
        ? `Fill form in "${attachedDoc.name}"...`
        : "Attach a PDF form to fill...",
      "generate-document": "Describe the document you need...",
      "chat-with-document": attachedDoc
        ? `Ask about "${attachedDoc.name}"...`
        : "Attach a document first...",
      classify: attachedDoc
        ? `Classify "${attachedDoc.name}"...`
        : "Attach a document to classify...",
      highlight: "Paste text or attach file to highlight...",
      explain: "Paste complex text to simplify...",
      quiz: "Use the Quiz panel below to attach a document and start a quiz.",
    };
    return placeholders[activeAction] || "Type a message...";
  }, [activeAction, attachedDoc]);

  // ── Language label ────────────────────────────────────────────────────────
  const langLabel = useMemo(
    () =>
      SUPPORTED_LANGUAGES.find((l) => l.code === targetLang)?.name ||
      targetLang,
    [targetLang],
  );

  // ── Structured renderer handlers ──────────────────────────────────────────
  const handleAddAllToTodos = useCallback(async (tasks: any[]) => {
    if (!Array.isArray(tasks) || tasks.length === 0) return;
    const docName = stateRef.current.attachedDoc?.name;
    const sourceLabel = docName ? `From Tasks • ${docName}` : "From Tasks";
    try {
      const { addTasksToMyTasks } = await import("@/services/workspaceService");
      await addTasksToMyTasks(tasks, sourceLabel);
      setSmartFolderToast(`${tasks.length} task${tasks.length === 1 ? "" : "s"} saved`);
    } catch (e: any) {
      Alert.alert("Save Tasks", e?.message || "Could not save tasks.");
    }
  }, []);

  const handleSourceTap = useCallback((quote: string) => {
    if (!quote) return;
    Alert.alert("Source", quote.length > 240 ? quote.slice(0, 240) + "…" : quote);
  }, []);

  const handleAskMore = useCallback((prompt: string) => {
    if (!prompt) return;
    setActiveAction("chat-with-document");
    setInputText(prompt);
  }, []);

  const handleConvertToEditable = useCallback(
    (_sections: any[]) => {
      Alert.alert(
        "Convert to Editable",
        "This will open the extracted content in the in-app editor.",
      );
    },
    [],
  );

  const handleRenameFile = useCallback(
    async (filename: string) => {
      if (!attachedDoc || !filename) return;
      try {
        // 1. Sanitize: strip chars illegal on Android/iOS/Windows, trim whitespace
        const sanitized = filename
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
          .trim()
          .replace(/[._]+$/, ""); // strip trailing dots/underscores
        if (!sanitized) {
          Alert.alert("Rename", "The suggested filename is invalid.");
          return;
        }

        // 2. Preserve the original file extension when the suggestion lacks one
        const origExt = attachedDoc.name.includes(".")
          ? attachedDoc.name.substring(attachedDoc.name.lastIndexOf("."))
          : "";
        const withExt =
          origExt &&
          !sanitized.toLowerCase().endsWith(origExt.toLowerCase())
            ? `${sanitized}${origExt}`
            : sanitized;

        // 3. Auto-resolve duplicate names in the file index
        const { getFileByUri, upsertFileRecord, loadFileIndex } =
          await import("@/services/fileIndexService");

        const allFiles = await loadFileIndex();
        let finalName = withExt;
        const baseNoExt = withExt.includes(".")
          ? withExt.substring(0, withExt.lastIndexOf("."))
          : withExt;
        const ext = withExt.includes(".")
          ? withExt.substring(withExt.lastIndexOf("."))
          : "";

        let counter = 1;
        while (
          allFiles.some(
            (f) =>
              f.name.toLowerCase() === finalName.toLowerCase() &&
              f.uri !== attachedDoc.uri,
          )
        ) {
          finalName = `${baseNoExt} (${counter})${ext}`;
          if (++counter > 99) break;
        }

        // 4. Update (or create) the file index record with the new display name.
        //    The URI is unchanged — we're renaming the index entry, not the
        //    underlying content:// or file:// resource.
        await upsertFileRecord({
          uri: attachedDoc.uri,
          name: finalName,
          mimeType: attachedDoc.mimeType,
          size: attachedDoc.size,
          source: "imported",
        });

        // 5. Reflect the new name in the current AI session
        setAttachedDoc((prev) => (prev ? { ...prev, name: finalName } : prev));
        setSmartFolderToast(`Renamed to "${finalName}"`);
      } catch (e: any) {
        Alert.alert(
          "Rename failed",
          e?.message || "Could not rename the file. Please try again.",
        );
      }
    },
    [attachedDoc],
  );

  // Lightweight in-screen toast for smart-folder confirmations
  const [smartFolderToast, setSmartFolderToast] = useState<string | null>(null);
  useEffect(() => {
    if (!smartFolderToast) return;
    const timer = setTimeout(() => setSmartFolderToast(null), 2400);
    return () => clearTimeout(timer);
  }, [smartFolderToast]);

  // Smart Folder integration: classify result → create-or-find folder by name,
  // ensure the attached file exists in the unified file index, then map the
  // file to the folder so it shows up in the Folders screen immediately.
  const handleMoveToFolder = useCallback(
    async (folderName: string) => {
      if (!attachedDoc || !folderName) return;
      try {
        const [
          { getAllFolders, createFolder, moveFileToFolder, FOLDER_COLORS },
          { upsertFileRecord, getFileByUri },
          { getAllFiles: getLegacyFiles },
        ] = await Promise.all([
          import("@/services/folderService"),
          import("@/services/fileIndexService"),
          import("@/services/fileService"),
        ]);

        // 1) Find or auto-create the smart folder at the root
        const allFolders = await getAllFolders();
        const target =
          allFolders.find(
            (f) =>
              f.parentId === null &&
              f.name.toLowerCase() === folderName.toLowerCase(),
          ) ||
          (await createFolder(
            folderName,
            null,
            FOLDER_COLORS[Math.floor(Math.random() * FOLDER_COLORS.length)],
          ));

        // 2) Determine the file ID to use for the folder mapping.
        //    The Folders screen uses the legacy fileService ID for legacy files,
        //    so we must check the legacy store first. Only fall back to the
        //    unified fileIndexService if the file is not in the legacy store.
        const legacyFiles = await getLegacyFiles();
        const legacyFile = legacyFiles.find((f) => f.uri === attachedDoc.uri);

        let fileId: string;
        if (legacyFile) {
          fileId = legacyFile.id;
        } else {
          let record = await getFileByUri(attachedDoc.uri);
          if (!record) {
            record = await upsertFileRecord({
              uri: attachedDoc.uri,
              name: attachedDoc.name,
              mimeType: attachedDoc.mimeType,
              size: attachedDoc.size,
              source: "imported",
            });
          }
          fileId = record.id;
        }

        // 3) Add the file to the folder (creates the file → folder mapping)
        await moveFileToFolder(fileId, target.id);

        setSmartFolderToast(`Added to "${target.name}" folder`);
      } catch (e: any) {
        Alert.alert(
          "Smart Folder",
          `Could not add to folder: ${e?.message || "Unknown error"}`,
        );
      }
    },
    [attachedDoc],
  );

  const [autoSortEnabled, setAutoSortEnabled] = useState(false);
  const handleToggleAutoSort = useCallback((enabled: boolean) => {
    setAutoSortEnabled(enabled);
  }, []);

  const handleExport = useCallback(() => {
    Alert.alert("Export", "Exporting current output (wire to your share/export flow).");
  }, []);

  const handleAddToNotes = useCallback(async () => {
    const { session: sess, activeAction: action, attachedDoc: doc } = stateRef.current;
    const msgs = sess?.messages ?? [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.content) return;
    const actionLabels: Record<string, string> = {
      "explain": "Explain",
      "summarize": "Summarize",
      "translate": "Translate",
      "extract-text": "Extract Text",
      "generate-document": "Generate",
      "analyze": "Analyze",
      "tasks": "Tasks",
      "highlight": "Highlights",
      "classify": "Classify",
      "chat": "Chat",
      "chat-with-document": "Chat",
      "quiz": "Quiz",
    };
    const actionLabel = actionLabels[action] ?? "AI";
    const sourceLabel = doc ? `From ${actionLabel} • ${doc.name}` : `From ${actionLabel}`;
    try {
      const { addNoteToWorkspace } = await import("@/services/workspaceService");
      await addNoteToWorkspace(lastAssistant.content, sourceLabel);
      setSmartFolderToast("Saved to Workspace");
    } catch (e: any) {
      Alert.alert("Save Note", e?.message || "Could not save to Workspace.");
    }
  }, []);

  const handleExtractTasks = useCallback(() => {
    setActiveAction("tasks");
  }, []);

  const handleExplainDocParagraph = useCallback((text: string) => {
    if (!text) return;
    setActiveAction("explain");
    setInputText(text.length > 2000 ? text.slice(0, 2000) : text);
  }, []);

  const handleSummarizeDocParagraph = useCallback((text: string) => {
    if (!text) return;
    setActiveAction("summarize");
    setInputText(text.length > 2000 ? text.slice(0, 2000) : text);
  }, []);

  // ── Highlight-specific handlers ─────────────────────────────────────────
  const handleJumpToHighlight = useCallback(
    (h: HighlightItem) => {
      const ref = h.sourceReference;
      if (!attachedDoc) {
        Alert.alert(
          "Jump to Source",
          ref?.snippet
            ? `"${ref.snippet}"${ref.page ? ` · page ${ref.page}` : ""}${
                ref.section ? ` · ${ref.section}` : ""
              }`
            : h.text,
        );
        return;
      }
      // Open the appropriate viewer with the page + snippet anchor so the
      // viewer can scroll to the location. Extra params are ignored by the
      // viewer if it doesn't support them yet — this is forward-compatible.
      const name = attachedDoc.name.toLowerCase();
      const params: Record<string, string> = {
        uri: attachedDoc.uri,
        name: attachedDoc.name,
      };
      if (typeof ref?.page === "number") params.page = String(ref.page);
      if (ref?.snippet) params.snippet = ref.snippet;
      if (ref?.section) params.section = ref.section;

      try {
        if (name.endsWith(".pdf")) {
          router.push({ pathname: "/pdf-viewer", params } as any);
        } else if (name.endsWith(".docx")) {
          router.push({ pathname: "/docx-viewer", params } as any);
        } else if (name.endsWith(".epub")) {
          router.push({ pathname: "/epub-viewer", params } as any);
        } else {
          Alert.alert(
            "Jump to Source",
            `${ref?.page ? `Page ${ref.page}\n` : ""}${
              ref?.section ? `${ref.section}\n\n` : ""
            }"${ref?.snippet || h.text}"`,
          );
        }
      } catch {
        Alert.alert("Source", h.text);
      }
    },
    [attachedDoc, router],
  );

  const handleConvertHighlightToTask = useCallback(
    async (h: HighlightItem) => {
      try {
        const task = await convertHighlightToTask(
          h.text,
          h.reason,
          attachedDoc?.name,
        );
        if (!task) {
          Alert.alert("Convert to Task", "Could not convert this highlight.");
          return;
        }
        const action = (task as any).action || h.text;
        const priority = (task as any).priority || "medium";
        const deadline = (task as any).deadline || "Not specified";
        Alert.alert(
          "Task created",
          `${action}\n\nPriority: ${priority}\nDeadline: ${deadline}`,
        );
      } catch (e: any) {
        Alert.alert("Convert to Task", e?.message || "Failed to create task.");
      }
    },
    [attachedDoc?.name],
  );

  const handleAddHighlightToNotes = useCallback(
    async (h: HighlightItem) => {
      const docName = stateRef.current.attachedDoc?.name;
      const lines = [
        `> ${h.text}`,
        "",
        h.reason ? `_${h.reason}_` : null,
        h.sourceReference?.page ? `Page ${h.sourceReference.page}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const sourceLabel = docName ? `From Highlights • ${docName}` : "From Highlights";
      try {
        const { addNoteToWorkspace } = await import("@/services/workspaceService");
        await addNoteToWorkspace(lines, sourceLabel);
        setSmartFolderToast("Saved to Workspace");
      } catch (e: any) {
        Alert.alert("Save Note", e?.message || "Could not save to Workspace.");
      }
    },
    [],
  );

  const handleExplainHighlight = useCallback((h: HighlightItem) => {
    setActiveAction("explain");
    setInputText(h.text);
  }, []);

  const handleGenerateQuizFromHighlights = useCallback(
    (items: HighlightItem[]) => {
      if (items.length === 0) return;
      const joined = items.map((h) => h.text).join("\n\n");
      setActiveAction("quiz");
      setInputText(joined);
      Alert.alert(
        "Quiz source ready",
        `Loaded ${items.length} highlight${items.length === 1 ? "" : "s"} as the quiz source. Open the Quiz panel to continue.`,
      );
    },
    [],
  );

  const handleConvertHighlightsToFlashcards = useCallback(
    (items: HighlightItem[]) => {
      if (items.length === 0) return;
      Alert.alert(
        "Flashcards",
        `${items.length} flashcard${items.length === 1 ? "" : "s"} ready (wire to your flashcards module).`,
      );
    },
    [],
  );

  const handleExportHighlights = useCallback(
    (items: HighlightItem[]) => {
      if (items.length === 0) return;
      Alert.alert(
        "Export",
        `Exporting ${items.length} highlight${items.length === 1 ? "" : "s"} (wire to your share/export flow).`,
      );
    },
    [],
  );

  // ── Chat FlatList helpers ─────────────────────────────────────────────────
  const renderChatItem = useCallback(
    ({ item }: { item: AIChatMessage }) => (
      <AIChatBubble
        message={item}
        action={session.action}
        documentName={attachedDoc?.name}
        onAddAllToTodos={handleAddAllToTodos}
        onSourceTap={handleSourceTap}
        onAskMore={handleAskMore}
        onConvertToEditable={handleConvertToEditable}
        onRenameFile={handleRenameFile}
        onMoveToFolder={handleMoveToFolder}
        onToggleAutoSort={handleToggleAutoSort}
        autoSortEnabled={autoSortEnabled}
        onExport={handleExport}
        onAddToNotes={handleAddToNotes}
        onExtractTasks={handleExtractTasks}
        onExplainDocParagraph={handleExplainDocParagraph}
        onSummarizeDocParagraph={handleSummarizeDocParagraph}
        onJumpToHighlight={handleJumpToHighlight}
        onConvertHighlightToTask={handleConvertHighlightToTask}
        onAddHighlightToNotes={handleAddHighlightToNotes}
        onExplainHighlight={handleExplainHighlight}
        onGenerateQuizFromHighlights={handleGenerateQuizFromHighlights}
        onConvertHighlightsToFlashcards={handleConvertHighlightsToFlashcards}
        onExportHighlights={handleExportHighlights}
      />
    ),
    [
      session.action,
      attachedDoc?.name,
      handleAddAllToTodos,
      handleSourceTap,
      handleAskMore,
      handleConvertToEditable,
      handleRenameFile,
      handleMoveToFolder,
      handleToggleAutoSort,
      autoSortEnabled,
      handleExport,
      handleAddToNotes,
      handleExtractTasks,
      handleExplainDocParagraph,
      handleSummarizeDocParagraph,
      handleJumpToHighlight,
      handleConvertHighlightToTask,
      handleAddHighlightToNotes,
      handleExplainHighlight,
      handleGenerateQuizFromHighlights,
      handleConvertHighlightsToFlashcards,
      handleExportHighlights,
    ],
  );
  const chatKeyExtractor = useCallback((item: AIChatMessage) => item.id, []);
  const chatListFooter = useMemo(() => {
    if (!isLoading) return null;
    return (
      <View
        style={[
          styles.loadingBubble,
          { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" },
        ]}
      >
        <ActivityIndicator size="small" color={ACCENT} />
        <Text style={[styles.loadingText, { color: t.textSecondary }]}>
          Thinking...
        </Text>
      </View>
    );
  }, [isLoading, mode, t.textSecondary]);
  const chatListEmpty = useMemo(
    () => <AIEmptyState action={activeAction} />,
    [activeAction],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PINGate screen="gozlin">
      <SafeAreaView
        style={[styles.safe, { backgroundColor: t.background }]}
        edges={["top"]}
      >
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* ─── Header ────────────────────────────────────────────── */}
          <AthemiHeader
            onBack={() => router.back()}
            onNewChat={handleNewSession}
            onToggleMenu={() => setShowFeaturesDropdown((p) => !p)}
            menuOpen={showFeaturesDropdown}
          />

          {/* ─── Dropdown Features Panel (slides down from header) ── */}
          {showFeaturesDropdown && (
            <>
              {/* Transparent backdrop — tap outside to dismiss */}
              <Pressable
                style={styles.dropdownBackdrop}
                onPress={() => setShowFeaturesDropdown(false)}
              />
              <View
                style={[
                  styles.dropdownPanel,
                  { backgroundColor: t.card, borderColor: t.border },
                ]}
              >
                <View style={styles.featuresGrid}>
                  {aiFeatures.map((feature) => {
                    const Icon =
                      FEATURE_ICONS[feature.id as keyof typeof FEATURE_ICONS] ||
                      Wand2;
                    const isActive = activeAction === feature.id;
                    return (
                      <TouchableOpacity
                        key={feature.id}
                        onPress={() => {
                          setShowFeaturesDropdown(false);
                          if (feature.id === "chat-with-document") {
                            router.push("/chat-with-document");
                            return;
                          }
                          if (feature.id === "generate-document") {
                            setShowGenerateDocumentModal(true);
                            return;
                          }
                          if (feature.id === "workspace") {
                            router.push("/gozlin-workspace" as any);
                            return;
                          }
                          handleModeChange(feature.id as AIAction);
                        }}
                        style={[
                          styles.featureCard,
                          {
                            backgroundColor: isActive
                              ? `${feature.color}15`
                              : t.card,
                            borderColor: isActive ? feature.color : t.border,
                            borderWidth: isActive ? 1.5 : 1,
                          },
                        ]}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.featureIconContainer,
                            { backgroundColor: feature.color },
                          ]}
                        >
                          <Icon color="#FFF" size={13} strokeWidth={2.5} />
                        </View>
                        <Text
                          style={[
                            styles.featureName,
                            {
                              color: isActive ? feature.color : t.text,
                              fontWeight: isActive ? "700" : "600",
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {feature.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={[
                    styles.dropdownChatBtn,
                    {
                      backgroundColor:
                        t.backgroundSecondary ||
                        (mode === "dark" ? "#1E293B" : "#F1F5F9"),
                      borderColor: t.border,
                    },
                  ]}
                  onPress={() => {
                    setShowFeaturesDropdown(false);
                    handleModeChange("chat" as AIAction);
                  }}
                  activeOpacity={0.7}
                >
                  <MessageSquare size={16} color={t.text} strokeWidth={2} />
                  <Text
                    style={[
                      styles.dropdownChatBtnText,
                      { color: t.text, flex: 1 },
                    ]}
                  >
                    Chat
                  </Text>
                  <Pressable
                    onPress={() => {
                      setShowFeaturesDropdown(false);
                      setShowHistory(true);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
                    style={styles.clockIconHit}
                  >
                    <Clock size={16} color={t.textSecondary} strokeWidth={2} />
                  </Pressable>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ─── Inline Document Bar (shown when doc attached, non-translate, non-quiz) ── */}
          {attachedDoc && activeAction !== "translate" && activeAction !== "quiz" && (
            <View
              style={[
                styles.docBar,
                {
                  backgroundColor: mode === "dark" ? "#1E293B" : "#F3E8FF",
                  borderColor: mode === "dark" ? "#334155" : "#D8B4FE",
                },
              ]}
            >
              <FileSearch size={16} color={ACCENT} />
              <Text
                style={[styles.docBarName, { color: t.text }]}
                numberOfLines={1}
              >
                {attachedDoc.name}
              </Text>
              {isExtractingAttachedDoc
                ? <ActivityIndicator size="small" color={ACCENT} />
                : <Text style={{ color: t.textTertiary, fontSize: 11 }}>
                    {extractionStatus === "extracted"
                      ? "✓"
                      : extractionStatus === "partial"
                        ? "⚠"
                        : "📄"}
                  </Text>
              }
              <TouchableOpacity
                onPress={handleRemoveDocument}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <X size={16} color={t.textTertiary} />
              </TouchableOpacity>
            </View>
          )}

          {/* ─── Quiz UI (dedicated panel, replaces chat area) ──────── */}
          {activeAction === "quiz" ? (
            <View style={[styles.chatContainer, { backgroundColor: t.card, borderColor: t.border }]}>
              <QuizPanel
                initialDoc={attachedDoc}
                initialDocText={docText}
              />
            </View>
          ) : null}

          {/* ─── Translate + Chat UI (hidden when quiz panel is active) ── */}
          {activeAction !== "quiz" && (activeAction === "translate" ? (
            <View style={styles.translateContainer}>

              {/* Language bar */}
              <View style={[styles.translateLangRow, { backgroundColor: mode === "dark" ? "#0F172A" : "#F8F4FF", borderColor: mode === "dark" ? "#334155" : "#E9D5FF" }]}>
                <View style={styles.translateLangBadge}>
                  <Globe size={13} color={t.textSecondary} />
                  <Text style={[styles.translateLangBadgeText, { color: t.textSecondary }]}>Auto-detect</Text>
                </View>
                <ArrowRight size={14} color={ACCENT} />
                <TouchableOpacity
                  style={[styles.translateLangBadge, styles.translateLangBadgeTarget, { backgroundColor: ACCENT }]}
                  onPress={() => setShowLangPicker(true)}
                  activeOpacity={0.8}
                >
                  <Languages size={13} color="#FFF" />
                  <Text style={[styles.translateLangBadgeText, { color: "#FFF", fontWeight: "700" }]}>{langLabel}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>▾</Text>
                </TouchableOpacity>
                {translateMessages.length > 0 && (
                  <TouchableOpacity onPress={handleTranslateClearHistory} style={styles.translateClearBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <X size={14} color={t.textTertiary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Messages / empty state */}
              <ScrollView
                ref={translateScrollRef}
                style={styles.translateMessagesScroll}
                contentContainerStyle={styles.translateMessagesContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={(_w, h) => {
                  translateContentHeightRef.current = h;
                  if (translatePendingTopRef.current !== null) {
                    const y = translatePendingTopRef.current;
                    translatePendingTopRef.current = null;
                    setTimeout(() => {
                      translateScrollRef.current?.scrollTo({ y, animated: true });
                    }, 50);
                  }
                }}
              >
                {translateMessages.length === 0 ? (
                  <View style={styles.translateEmptyState}>
                    <View style={[styles.translateEmptyIcon, { backgroundColor: `${ACCENT}18` }]}>
                      <Languages size={30} color={ACCENT} />
                    </View>
                    <Text style={[styles.translateEmptyTitle, { color: t.text }]}>Translate a Document</Text>
                    <Text style={[styles.translateEmptySubtitle, { color: t.textSecondary }]}>
                      Type text or pick a document, choose pages, and get an instant translation into {langLabel}.
                    </Text>
                    {!translateDoc && (
                      <TouchableOpacity
                        style={[styles.translatePickDocBtn, { backgroundColor: ACCENT }]}
                        onPress={handleTranslateDocPick}
                        activeOpacity={0.8}
                      >
                        <Paperclip size={15} color="#FFF" />
                        <Text style={styles.translatePickDocBtnText}>Pick Document</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  translateMessages.map((msg) =>
                    msg.type === "request" ? (
                      <View key={msg.id} style={styles.translateRequestRow}>
                        <View style={[styles.translateRequestBubble, { backgroundColor: `${ACCENT}12`, borderColor: `${ACCENT}28` }]}>
                          <FileText size={13} color={ACCENT} />
                          <Text style={[styles.translateRequestText, { color: ACCENT }]} numberOfLines={2}>{msg.label}</Text>
                        </View>
                      </View>
                    ) : msg.type === "error" ? (
                      <View key={msg.id} style={styles.translateResponseRow}>
                        <View style={[styles.translateResponseBubble, { backgroundColor: mode === "dark" ? "#1E293B" : "#FEF2F2", borderColor: "#FECACA" }]}>
                          <Text style={[styles.translateResponseText, { color: "#EF4444" }]}>{msg.content}</Text>
                        </View>
                      </View>
                    ) : (
                      <View key={msg.id} style={styles.translateResponseRow}>
                        <View style={[styles.translateResponseBubble, { backgroundColor: mode === "dark" ? "#1E293B" : "#F8F4FF", borderColor: mode === "dark" ? "#334155" : "#E9D5FF" }]}>
                          <View style={styles.translateResponseHeader}>
                            <Text style={[styles.translateResponseLang, { color: ACCENT }]}>{msg.label}</Text>
                            <TouchableOpacity onPress={() => handleCopyTranslateMessage(msg.content)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Copy size={13} color={t.textTertiary} />
                            </TouchableOpacity>
                          </View>
                          <Text style={[styles.translateResponseText, { color: t.text }]}>{msg.content}</Text>
                        </View>
                      </View>
                    )
                  )
                )}
                {isTranslating && (
                  <View style={styles.translateResponseRow}>
                    <View style={[styles.translateResponseBubble, { backgroundColor: mode === "dark" ? "#1E293B" : "#F8F4FF", borderColor: mode === "dark" ? "#334155" : "#E9D5FF" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <ActivityIndicator size="small" color={ACCENT} />
                        <Text style={[styles.translateResponseText, { color: t.textSecondary, fontStyle: "italic" }]}>Translating…</Text>
                      </View>
                    </View>
                  </View>
                )}
              </ScrollView>

              {/* Bottom dock */}
              <View style={[styles.translateDock, { backgroundColor: t.card, borderColor: t.border }]}>

                {/* Output mode selector */}
                <View style={[styles.translateOutputModeRow, { backgroundColor: mode === "dark" ? "#0F172A" : "#F1F5F9", borderColor: t.border }]}>
                  <TouchableOpacity
                    style={[styles.translateOutputModeBtn, translateOutputMode === "text" && { backgroundColor: ACCENT }]}
                    onPress={() => setTranslateOutputMode("text")}
                    activeOpacity={0.8}
                  >
                    <Languages size={12} color={translateOutputMode === "text" ? "#FFF" : t.textSecondary} />
                    <Text style={[styles.translateOutputModeBtnText, { color: translateOutputMode === "text" ? "#FFF" : t.textSecondary }]}>Text</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.translateOutputModeBtn, translateOutputMode === "document" && { backgroundColor: ACCENT }]}
                    onPress={() => setTranslateOutputMode("document")}
                    activeOpacity={0.8}
                  >
                    <FileText size={12} color={translateOutputMode === "document" ? "#FFF" : t.textSecondary} />
                    <Text style={[styles.translateOutputModeBtnText, { color: translateOutputMode === "document" ? "#FFF" : t.textSecondary }]}>Document</Text>
                  </TouchableOpacity>
                </View>

                {/* Format picker (shown only in document mode) */}
                {translateOutputMode === "document" && (
                  <View style={styles.translateFormatRow}>
                    <TouchableOpacity
                      style={[styles.translateFormatBtn, { borderColor: translateDocFormat === "pdf" ? "#DC2626" : t.border, backgroundColor: translateDocFormat === "pdf" ? "#DC2626" : "transparent" }]}
                      onPress={() => setTranslateDocFormat("pdf")}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.translateFormatBtnText, { color: translateDocFormat === "pdf" ? "#FFF" : t.textSecondary }]}>PDF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.translateFormatBtn, { borderColor: translateDocFormat === "docx" ? "#2563EB" : t.border, backgroundColor: translateDocFormat === "docx" ? "#2563EB" : "transparent" }]}
                      onPress={() => setTranslateDocFormat("docx")}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.translateFormatBtnText, { color: translateDocFormat === "docx" ? "#FFF" : t.textSecondary }]}>DOCX</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {translateDoc ? (
                  <>
                    {/* Doc info row */}
                    <View style={[styles.translateDocRow, { backgroundColor: translateDocExtractionFailed ? (mode === "dark" ? "#1C0A0A" : "#FEF2F2") : (mode === "dark" ? "#0F172A" : "#F3E8FF"), borderColor: translateDocExtractionFailed ? "#EF4444" : (mode === "dark" ? "#334155" : "#D8B4FE") }]}>
                      <FileText size={14} color={translateDocExtractionFailed ? "#EF4444" : ACCENT} />
                      <Text style={[styles.translateDocName, { color: t.text }]} numberOfLines={1}>{translateDoc.name}</Text>
                      {!isExtractingTranslateDoc && translateDocExtractionFailed && (
                        <Text style={{ fontSize: 11, color: "#EF4444", flexShrink: 1 }}>Can't read text</Text>
                      )}
                      {!isExtractingTranslateDoc && translateDocPageCount > 0 && !translateDocExtractionFailed && (
                        <Text style={[styles.translateDocPageCount, { color: t.textSecondary }]}>{translateDocPageCount}p</Text>
                      )}
                      {isExtractingTranslateDoc
                        ? <ActivityIndicator size="small" color={ACCENT} />
                        : translateDocExtractionFailed
                          ? <AlertTriangle size={14} color="#EF4444" />
                          : null
                      }
                      <TouchableOpacity onPress={handleTranslateRemoveDoc} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <X size={14} color={t.textTertiary} />
                      </TouchableOpacity>
                    </View>
                    {/* Page input + translate button */}
                    <View style={styles.translateActionRow}>
                      <TextInput
                        value={translatePageInput}
                        onChangeText={setTranslatePageInput}
                        placeholder={`Pages: "all", "1-3", "2,5,7-9"…`}
                        placeholderTextColor={t.textTertiary}
                        style={[styles.translatePageInput, { color: t.text, backgroundColor: mode === "dark" ? "#0F172A" : "#F8FAFC", borderColor: t.border }]}
                        autoCorrect={false}
                        autoCapitalize="none"
                        editable={!translateDocExtractionFailed}
                      />
                      <TouchableOpacity
                        onPress={handleTranslateSubmit}
                        disabled={isTranslating || isExtractingTranslateDoc || translateDocExtractionFailed}
                        style={[styles.translateSubmitBtn, { backgroundColor: (isTranslating || isExtractingTranslateDoc || translateDocExtractionFailed) ? t.border : ACCENT }]}
                        activeOpacity={0.8}
                      >
                        {isTranslating
                          ? <><ActivityIndicator size="small" color="#FFF" />{translateProgress ? <Text style={styles.translateSubmitText}>{translateProgress}</Text> : null}</>
                          : translateOutputMode === "document"
                            ? <><FileText size={14} color="#FFF" /><Text style={styles.translateSubmitText}>Create Doc</Text></>
                            : <><Languages size={14} color="#FFF" /><Text style={styles.translateSubmitText}>Translate</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={styles.translateFreeTextDock}>
                    <View style={[styles.translateFreeTextInputWrap, { backgroundColor: mode === "dark" ? "#0F172A" : "#F8FAFC", borderColor: t.border }]}>
                      <TextInput
                        value={translateFreeText}
                        onChangeText={setTranslateFreeText}
                        placeholder="Type text to translate…"
                        placeholderTextColor={t.textTertiary}
                        style={[styles.translateFreeTextInput, { color: t.text }]}
                        multiline
                        autoCorrect={false}
                        autoCapitalize="sentences"
                        maxLength={8000}
                      />
                      <TouchableOpacity
                        style={[styles.translateFreeTextAttach, { backgroundColor: `${ACCENT}12` }]}
                        onPress={handleTranslateDocPick}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        activeOpacity={0.7}
                      >
                        <Paperclip size={15} color={ACCENT} />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      onPress={handleTranslateSubmit}
                      disabled={isTranslating || !translateFreeText.trim()}
                      style={[
                        styles.translateSubmitBtn,
                        { backgroundColor: (isTranslating || !translateFreeText.trim()) ? t.border : ACCENT },
                      ]}
                      activeOpacity={0.8}
                    >
                      {isTranslating
                        ? <><ActivityIndicator size="small" color="#FFF" />{translateProgress ? <Text style={styles.translateSubmitText}>{translateProgress}</Text> : null}</>
                        : translateOutputMode === "document"
                          ? <><FileText size={14} color="#FFF" /><Text style={styles.translateSubmitText}>Create Doc</Text></>
                          : <><Languages size={14} color="#FFF" /><Text style={styles.translateSubmitText}>Translate</Text></>
                      }
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          ) : (
          /* ─── Chat area ──────────────────────────────────────────── */
          <View
            style={[
              styles.chatContainer,
              {
                backgroundColor: t.card,
                borderColor: t.border,
              },
            ]}
          >
            <FlatList
              ref={scrollRef}
              data={session.messages}
              renderItem={renderChatItem}
              keyExtractor={chatKeyExtractor}
              style={styles.flex}
              contentContainerStyle={styles.chatContent}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={chatListEmpty}
              ListFooterComponent={chatListFooter}
              initialNumToRender={15}
              maxToRenderPerBatch={10}
              windowSize={7}
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  scrollRef.current?.scrollToOffset({
                    offset: info.averageItemLength * info.index,
                    animated: true,
                  });
                }, 80);
              }}
            />

            {/* ─── Input area ──────────────────────────────────────── */}
            <View style={[styles.inputRow, { borderTopColor: t.border }]}>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder={placeholder}
                placeholderTextColor={t.textTertiary}
                style={[
                  styles.textInput,
                  {
                    backgroundColor:
                      t.backgroundSecondary ||
                      (mode === "dark" ? "#1E293B" : "#F1F5F9"),
                    color: t.text,
                  },
                ]}
                multiline
                maxLength={5000}
                editable={!isLoading}
                blurOnSubmit={false}
              />
              <TouchableOpacity
                onPress={handleAttachDocument}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={styles.attachIconBtn}
                activeOpacity={0.7}
              >
                <Paperclip
                  size={18}
                  color={attachedDoc ? ACCENT : t.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSend}
                disabled={!canSend}
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor: canSend ? ACCENT : t.border,
                  },
                ]}
                activeOpacity={0.7}
              >
                <Send color={canSend ? "#FFF" : t.textTertiary} size={18} />
              </TouchableOpacity>
            </View>
          </View>
          ))}
        </KeyboardAvoidingView>

        {/* ─── Modals ──────────────────────────────────────────────── */}
        <AILanguagePicker
          visible={showLangPicker}
          selected={targetLang}
          onSelect={setTargetLang}
          onClose={() => setShowLangPicker(false)}
        />

        {/* Generate Document Modal */}
        <GenerateDocumentModal
          visible={showGenerateDocumentModal}
          onClose={() => setShowGenerateDocumentModal(false)}
          onSubmit={handleGenerateDocument}
          isLoading={isGenerating}
        />

        {/* File Source Picker Modal */}
        {showFileSourcePicker && (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.5)",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 1000,
            }}
          >
            <View
              style={{
                backgroundColor: t.card,
                borderRadius: 16,
                padding: 24,
                width: "85%",
                maxWidth: 400,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "700",
                  color: t.text,
                  marginBottom: 8,
                }}
              >
                Attach Document
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  color: t.textSecondary,
                  marginBottom: 24,
                }}
              >
                Choose where to pick the document from
              </Text>

              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  backgroundColor: t.backgroundSecondary,
                  borderRadius: 12,
                  marginBottom: 12,
                }}
                onPress={handlePickFromApp}
                activeOpacity={0.7}
              >
                <BookOpen
                  size={24}
                  color={ACCENT}
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 16, fontWeight: "600", color: t.text }}
                  >
                    Pick from App Library
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: t.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    Choose from your imported documents
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  backgroundColor: t.backgroundSecondary,
                  borderRadius: 12,
                  marginBottom: 16,
                }}
                onPress={handlePickFromDevice}
                activeOpacity={0.7}
              >
                <FileSearch
                  size={24}
                  color={ACCENT}
                  style={{ marginRight: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 16, fontWeight: "600", color: t.text }}
                  >
                    Pick from Device
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: t.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    Browse files on your device
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  padding: 12,
                  alignItems: "center",
                }}
                onPress={() => setShowFileSourcePicker(false)}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "600",
                    color: t.textSecondary,
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Library Picker Modal */}
        <LibraryFilePicker
          visible={showLibraryPicker}
          onClose={() => setShowLibraryPicker(false)}
          onSelect={handleLibraryFileSelected}
          allowedTypes={["pdf", "docx", "txt", "epub", "xlsx", "csv"]}
          multiple={false}
          title="Select Document from Library"
        />

        <AISessionHistory
          visible={showHistory}
          sessions={allSessions}
          onSelect={handleSelectSession}
          onDelete={handleDeleteSession}
          onClearAll={handleClearAllSessions}
          onClose={() => setShowHistory(false)}
        />

        {/* Smart Folder toast */}
        {smartFolderToast && (
          <View style={styles.smartFolderToast} pointerEvents="none">
            <Text style={styles.smartFolderToastText}>{smartFolderToast}</Text>
          </View>
        )}
      </SafeAreaView>
    </PINGate>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  // ─── Feature Grid ───
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    zIndex: 9,
    backgroundColor: "transparent",
  },
  dropdownPanel: {
    paddingHorizontal: GRID_H_PADDING,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  dropdownChatBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dropdownChatBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  clockIconHit: {
    padding: 4,
  },
  featuresContainer: {
    paddingHorizontal: GRID_H_PADDING,
    paddingTop: 8,
    paddingBottom: 10,
  },
  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: GRID_GAP,
    rowGap: 4,
  },
  featureCard: {
    width: CARD_WIDTH,
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  featureIconContainer: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  featureName: {
    fontSize: 9,
    textAlign: "center",
    lineHeight: 11,
  },
  // ─── Language Bar ───
  langBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  langText: {
    flex: 1,
    fontSize: 13,
  },
  // ─── Inline Document Bar ───
  docBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 44,
  },
  docBarName: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
  },
  // ─── Chat Area ───
  chatContainer: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: 16,
    borderWidth: 0,
    overflow: "hidden",
  },
  chatContent: {
    padding: 8,
    flexGrow: 1,
  },
  loadingBubble: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    marginTop: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: "500",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: spacing.sm + 2,
    gap: spacing.sm,
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 15,
    maxHeight: 100,
    minHeight: 40,
  },
  attachIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  // ─── Translate UI (document-based) ───
  translateContainer: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    marginTop: 6,
    gap: 8,
  },
  translateLangRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  translateLangBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  translateLangBadgeTarget: {
    gap: 5,
  },
  translateLangBadgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  translateClearBtn: {
    marginLeft: "auto" as any,
    padding: 4,
  },
  translateMessagesScroll: {
    flex: 1,
  },
  translateMessagesContent: {
    paddingVertical: 4,
    flexGrow: 1,
  },
  translateEmptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 10,
  },
  translateEmptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  translateEmptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  translateEmptySubtitle: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 260,
  },
  translatePickDocBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 20,
  },
  translatePickDocBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
  translateRequestRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  translateResponseRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 10,
  },
  translateRequestBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: "86%",
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    borderWidth: 1,
  },
  translateRequestText: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  translateResponseBubble: {
    maxWidth: "92%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    gap: 6,
  },
  translateResponseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  translateResponseLang: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  translateResponseText: {
    fontSize: 14,
    lineHeight: 21,
  },
  translateDock: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  translateDocRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  translateDocName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  translateDocPageCount: {
    fontSize: 11,
    fontWeight: "500",
  },
  translateActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  translatePageInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 9 : 7,
    fontSize: 14,
    minHeight: 38,
  },
  translateSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    minHeight: 38,
  },
  translateSubmitText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
  translateFreeTextDock: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  translateFreeTextInputWrap: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 44,
    maxHeight: 110,
  },
  translateFreeTextInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 96,
    paddingTop: 0,
    paddingBottom: 3,
  },
  translateFreeTextAttach: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
  },
  // ─── Translate output mode selector ───
  translateOutputModeRow: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  translateOutputModeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 6,
    borderRadius: 8,
  },
  translateOutputModeBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  translateFormatRow: {
    flexDirection: "row",
    gap: 8,
  },
  translateFormatBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1.5,
  },
  translateFormatBtnText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  // ─── Smart Folder toast ───
  smartFolderToast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    backgroundColor: "rgba(15,23,42,0.92)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    maxWidth: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  smartFolderToastText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
