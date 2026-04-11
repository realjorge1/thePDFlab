// ============================================
// AI Service – Public API consumed by screens
// Wraps the active provider and manages sessions.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import type { AIProvider } from "./ai.provider";
import type {
    AIAction,
    AIChatMessage,
    AIDocumentRef,
    AIResponse,
    AISession,
} from "./ai.types";
import { generateId } from "./ai.types";
import { BackendAIProvider } from "./providers/backend.provider";
import { MockAIProvider } from "./providers/mock.provider";

// ─── Extended document ref (internal) ────────────────────────────────────────
interface AIDocumentRefInternal extends AIDocumentRef {
  _extractionDocId?: string;
  _extractionMeta?: {
    totalPages: number;
    scannedPages: number;
    chunkCount: number;
  };
}

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SESSIONS_KEY = "@pdflab/ai_sessions";
const MAX_SESSIONS = 50;
const TEXT_INPUT_LIMIT = 15_000; // characters

// ─── Singleton provider (swap here when backend is ready) ─────────────────────
let _provider: AIProvider = new MockAIProvider();
let _providerInitialized = false;

export function setAIProvider(provider: AIProvider) {
  _provider = provider;
}

export function getAIProvider(): AIProvider {
  return _provider;
}

/**
 * Try to connect to the backend AI service.
 * If reachable and has a provider configured, switch from mock to backend.
 * Safe to call multiple times – only the first successful probe sticks.
 */
export async function initAIProvider(): Promise<void> {
  if (_providerInitialized) return;
  _providerInitialized = true;

  try {
    // Use dynamic import to avoid circular deps with config/api
    const { API_ENDPOINTS } = require("@/config/api");
    const statusUrl = API_ENDPOINTS.AI.CHAT.replace("/chat", "/status");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(statusUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      // Backend responds with { success: true, currentProvider: "gemini", ... }
      if (data.success && data.currentProvider) {
        _provider = new BackendAIProvider();
        return;
      }
    }
  } catch {
    // Backend unreachable — stay on mock
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────

export async function loadSessions(): Promise<AISession[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: AISession[] = JSON.parse(raw);
    // Sort newest first
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveSession(session: AISession): Promise<void> {
  try {
    const sessions = await loadSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.unshift(session);
    }
    // Keep only latest MAX_SESSIONS
    const trimmed = sessions.slice(0, MAX_SESSIONS);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("Failed to save AI session:", e);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const sessions = await loadSessions();
    const filtered = sessions.filter((s) => s.id !== sessionId);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn("Failed to delete AI session:", e);
  }
}

export async function clearAllSessions(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSIONS_KEY);
  } catch (e) {
    console.warn("Failed to clear AI sessions:", e);
  }
}

// ─── Session factory ──────────────────────────────────────────────────────────

export function createSession(
  action: AIAction,
  document?: AIDocumentRef,
): AISession {
  const now = Date.now();
  const actionLabels: Record<AIAction, string> = {
    chat: "Chat",
    translate: "Translation",
    summarize: "Summary",
    "extract-text": "Text Extraction",
    "extract-data": "Data Extraction",
    analyze: "Analysis",
    tasks: "Task Extraction",
    "fill-form": "Form Fill",
    "generate-document": "Generate Document",
    "chat-with-document": "Document Chat",
    classify: "Classification",
    highlight: "Highlights",
    explain: "Explanation",
    quiz: "Quiz",
  };
  const title = document
    ? `${actionLabels[action]} – ${document.name}`
    : actionLabels[action];

  return {
    id: generateId(),
    action,
    title,
    messages: [],
    document,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Derive a short title from the first user message in a session.
 * Returns trimmed text (max 60 chars) suitable for display in history.
 */
export function deriveSessionTitle(session: AISession): string {
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  if (firstUserMsg) {
    const cleaned = firstUserMsg.content
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > 60) return cleaned.slice(0, 57) + "…";
    return cleaned;
  }
  return session.title;
}

// ─── Message factory ──────────────────────────────────────────────────────────

export function createMessage(
  role: AIChatMessage["role"],
  content: string,
  structuredData?: Record<string, unknown>,
): AIChatMessage {
  return {
    id: generateId(),
    role,
    content,
    timestamp: Date.now(),
    structuredData,
  };
}

// ─── Core AI operations ───────────────────────────────────────────────────────

/** Validate & clamp text input. Returns the (possibly truncated) text. */
function prepareText(text: string): string {
  if (text.length > TEXT_INPUT_LIMIT) {
    return (
      text.slice(0, TEXT_INPUT_LIMIT) +
      `\n\n[… text truncated at ${TEXT_INPUT_LIMIT.toLocaleString()} characters]`
    );
  }
  return text;
}

export async function sendChat(
  message: string,
  history: AIChatMessage[],
  documentText?: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.chat({
    message,
    history,
    documentText: documentText ? prepareText(documentText) : undefined,
    documentName,
  });
}

export async function summarize(
  text: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.summarize({ text: prepareText(text), documentName });
}

export async function translate(
  text: string,
  targetLanguage: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.translate({
    text: prepareText(text),
    targetLanguage,
    documentName,
  });
}

export async function extractData(
  text: string,
  dataType?: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.extractData({
    text: prepareText(text),
    dataType,
    documentName,
  });
}

export async function analyze(
  text: string,
  analysisType?: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.analyze({
    text: prepareText(text),
    analysisType,
    documentName,
  });
}

export async function extractTasks(
  text: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.extractTasks({ text: prepareText(text), documentName });
}

export async function generateDocument(
  prompt: string,
  fileType: "docx" | "pdf" | "ppt",
  category: string,
  tone?: string,
  wordCount?: number,
  audience?: string,
): Promise<AIResponse> {
  return _provider.generateDocument({
    prompt: prepareText(prompt),
    fileType,
    category,
    tone,
    wordCount,
    audience,
  });
}

export async function classifyDocument(
  text: string,
  filename?: string,
): Promise<AIResponse> {
  return _provider.classify({ text: prepareText(text), filename });
}

export async function highlightKeyPoints(
  text: string,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.highlight({ text: prepareText(text), documentName });
}

export async function explainText(
  text: string,
  mode?: "plain" | "legal" | "medical" | "technical",
): Promise<AIResponse> {
  return _provider.explain({ text: prepareText(text), mode });
}

export async function generateQuiz(
  text: string,
  quizType?: "quiz" | "comprehension" | "flashcards",
  count?: number,
  documentName?: string,
): Promise<AIResponse> {
  return _provider.quiz({
    text: prepareText(text),
    quizType,
    count,
    documentName,
  });
}

// ─── Document helpers ─────────────────────────────────────────────────────────

/**
 * Pick a document using the system file picker.
 * Returns an AIDocumentRef or null if cancelled.
 */
export async function pickDocument(): Promise<AIDocumentRef | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
        "application/epub+zip",
        "text/plain",
      ],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) return null;

    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType || "application/octet-stream",
      size: asset.size ?? undefined,
    };
  } catch (e) {
    console.error("pickDocument error:", e);
    return null;
  }
}

/**
 * Attempt to extract text content from a document.
 * For PDFs, sends to backend extraction endpoint for high-quality text extraction.
 * For plain text files, reads directly.
 */
export async function extractDocumentText(
  doc: AIDocumentRef | AIDocumentRefInternal,
): Promise<string> {
  try {
    if (
      doc.mimeType === "text/plain" ||
      doc.name.toLowerCase().endsWith(".txt")
    ) {
      const content = await FileSystem.readAsStringAsync(doc.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return content;
    }

    // For PDFs: use the backend extraction endpoint
    if (
      doc.mimeType === "application/pdf" ||
      doc.name.toLowerCase().endsWith(".pdf")
    ) {
      try {
        const { API_ENDPOINTS, wakeUpBackend } = require("@/config/api");

        // Ensure backend is up
        await wakeUpBackend();

        const formData = new FormData();
        formData.append("pdf", {
          uri: doc.uri,
          type: "application/pdf",
          name: doc.name || "document.pdf",
        } as any);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout for large PDFs

        const response = await fetch(API_ENDPOINTS.AI.EXTRACT_PDF, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          const result = await response.json();
          // Store docId for potential ask-pdf calls later
          if (result.docId) {
            doc.extractedText = result.fullText || result.preview || "";
            // Attach the docId to the document ref for Q&A
            const internal = doc as AIDocumentRefInternal;
            internal._extractionDocId = result.docId;
            internal._extractionMeta = {
              totalPages: result.totalPages,
              scannedPages: result.scannedPages,
              chunkCount: result.chunkCount,
            };
          }
          return (
            result.fullText ||
            result.preview ||
            `[PDF: ${doc.name} — Extraction returned no text]`
          );
        }

        // If backend extraction fails, return a fallback message
        console.warn(
          "[AI] PDF extraction backend returned error:",
          response.status,
        );
      } catch (extractErr) {
        console.warn("[AI] PDF extraction failed, using fallback:", extractErr);
      }

      return `[PDF document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nText extraction was not available. You can paste the document text below and I'll work with that.`;
    }

    if (
      doc.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      doc.name.toLowerCase().endsWith(".docx")
    ) {
      return `[DOCX document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nFull text extraction for Word documents will be available when the backend is connected. For now, you can paste the document text below and I'll work with that.`;
    }

    if (
      doc.mimeType === "application/epub+zip" ||
      doc.name.toLowerCase().endsWith(".epub")
    ) {
      return `[EPUB document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nFull text extraction for EPUB files will be available when the backend is connected. For now, you can paste the document text below and I'll work with that.`;
    }

    return `[Document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nText extraction is not available for this format yet. You can paste the document text manually.`;
  } catch (e) {
    console.error("extractDocumentText error:", e);
    return `[Document: "${doc.name}"]\n\nFailed to read document. You can paste the document text manually.`;
  }
}

// ─── PDF Q&A (uses extraction docId stored during extractDocumentText) ────────

export interface AskPdfResult {
  answer: string;
  citations: Array<{ page: number; quote: string }>;
  found: boolean;
}

/**
 * Ask a question about a previously extracted PDF document.
 * Requires that extractDocumentText was called first for the same doc
 * (which stores _extractionDocId on the document ref).
 */
export async function askPdfQuestion(
  doc: AIDocumentRef | AIDocumentRefInternal,
  question: string,
): Promise<AskPdfResult> {
  const docId = (doc as AIDocumentRefInternal)._extractionDocId;
  if (!docId) {
    return {
      answer:
        "This document hasn't been extracted yet. Please attach it to a chat first so the text can be extracted.",
      citations: [],
      found: false,
    };
  }

  try {
    const { API_ENDPOINTS } = require("../../config/api");
    const resp = await fetch(API_ENDPOINTS.AI.ASK_PDF, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId, question }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(
        (errBody as any)?.error || `ask-pdf failed (${resp.status})`,
      );
    }

    const data = (await resp.json()) as {
      answer: string;
      citations: Array<{ page: number; quote: string }>;
      found: boolean;
    };

    return {
      answer: data.answer,
      citations: data.citations ?? [],
      found: data.found ?? true,
    };
  } catch (e: any) {
    console.error("askPdfQuestion error:", e);
    return {
      answer:
        `Sorry, I couldn't answer that question. ${e.message ?? ""}`.trim(),
      citations: [],
      found: false,
    };
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Dynamically import clipboard to avoid crashes if module is unavailable
    // Supports both @react-native-clipboard/clipboard and expo-clipboard
    try {
      const ExpoClipboard = require("expo-clipboard");
      if (ExpoClipboard?.setStringAsync) {
        await ExpoClipboard.setStringAsync(text);
        return true;
      }
    } catch {
      // expo-clipboard not installed, try RN Clipboard
    }
    try {
      const { Clipboard: RNClipboard } = require("react-native");
      if (RNClipboard?.setString) {
        RNClipboard.setString(text);
        return true;
      }
    } catch {
      // Clipboard not available
    }
    return false;
  } catch {
    return false;
  }
}
