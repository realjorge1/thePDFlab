// ============================================
// AI Service – Public API consumed by screens
// Wraps the active provider and manages sessions.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { resilientFetch } from "@/config/api";
import {
    AI_CITATIONS_V2,
    AI_DOCID_TASKS,
    AI_MARKDOWN,
    AI_PERSISTENT_DOC_CACHE,
} from "@/constants/featureFlags";

import type { AIProvider } from "./ai.provider";
import type {
    AIAction,
    AIChatMessage,
    AIDocTaskFields,
    AIDocumentRef,
    AIResponse,
    AISession,
} from "./ai.types";
import { generateId } from "./ai.types";
import {
    AI_NO_PROVIDER_CODE,
    AI_TEMPORARILY_UNAVAILABLE_MESSAGE,
    AIError,
} from "./aiErrors";
import {
    canUse,
    canUseAsync,
    getAICapabilities,
    getAIStatus,
    getCachedAIStatus,
    type AICapabilityKey,
} from "./capabilities";
import {
    isV2CitationShape,
    parseCitations,
    removeOrphanCitationMarkers,
    stripCitationMarkers,
} from "./citations";
import { withDocRecovery } from "./docRecovery";
import {
    ensureDocumentUploaded,
    getDocRefDocId,
    getDocRefLocatorType,
} from "./docSessionCache";
import { assertAIPremium } from "./premiumGuard";
import { BackendAIProvider } from "./providers/backend.provider";
import { MockAIProvider } from "./providers/mock.provider";
import { deepStripMarkdown, stripMarkdown } from "@/utils/sanitizeAiText";

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
const SESSIONS_KEY = "@wordsinscribed/ai_sessions";
const MAX_SESSIONS = 50;
const TEXT_INPUT_LIMIT = 15_000; // characters

/**
 * Pasted-text limit when the backend supports whole-document tasks (contract
 * v2): it rejects anything over 100,000 characters.
 */
export const PASTED_TEXT_LIMIT_V2 = 90_000;
export const PASTED_TEXT_CUT_NOTICE = "Only the first 90,000 characters were used.";
/** The contract allows at most 2,000 characters of `instruction`. */
const INSTRUCTION_LIMIT = 2_000;

// ─── AI output sanitization ───────────────────────────────────────────────────
// Every AI result is routed through here so raw Markdown tokens (## / ** / *)
// never reach the UI — answers should read as clean prose, not a mock draft.
//
// Exception (AI_MARKDOWN): a caller that renders with MarkdownText may ask for
// `preserveMarkdown` on a free-text task; when the backend reports the
// `markdown` capability, `content` keeps its formatting. Structured data is
// always stripped.

/** Provider methods whose `content` is free text the user reads (C9). */
const FREE_TEXT_METHODS = new Set(["chat", "summarize", "translate", "analyze", "explain"]);

function sanitizeAIResponse(res: AIResponse, keepMarkdown = false): AIResponse {
  return {
    ...res,
    content:
      typeof res.content === "string" && !keepMarkdown
        ? stripMarkdown(res.content)
        : res.content,
    structuredData: res.structuredData
      ? deepStripMarkdown(res.structuredData)
      : res.structuredData,
    ...(keepMarkdown ? { format: "markdown" as const } : {}),
  };
}

/**
 * Wrap a provider so every method that resolves to an AIResponse has its text
 * (content + structured fields) stripped of Markdown formatting. New provider
 * methods are covered automatically.
 */
function makeSanitizingProvider(provider: AIProvider): AIProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      return async (...args: unknown[]) => {
        const result = await orig.apply(target, args);
        if (!(result && typeof result === "object" && "content" in (result as object))) {
          return result;
        }
        const req = args[0] as { preserveMarkdown?: boolean } | undefined;
        const keepMarkdown =
          typeof prop === "string" &&
          FREE_TEXT_METHODS.has(prop) &&
          req?.preserveMarkdown === true &&
          canUse(AI_MARKDOWN, "markdown");
        return sanitizeAIResponse(result as AIResponse, keepMarkdown);
      };
    },
  });
}

// ─── Demo (mock) responses — development only ────────────────────────────────

export const DEMO_RESPONSE_PREFIX = "[Demo response] ";

/**
 * The mock provider invents answers, so it is only ever used in a development
 * build started with EXPO_PUBLIC_AI_MOCK=true, and every answer is labelled.
 */
export function isMockAIEnabled(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_AI_MOCK === "true";
}

function makeDemoLabelledProvider(provider: AIProvider): AIProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      return async (...args: unknown[]) => {
        const result = (await orig.apply(target, args)) as AIResponse;
        if (result && typeof result === "object" && typeof result.content === "string") {
          return result.content.startsWith(DEMO_RESPONSE_PREFIX)
            ? result
            : { ...result, content: DEMO_RESPONSE_PREFIX + result.content };
        }
        return result;
      };
    },
  });
}

function createDefaultProvider(): AIProvider {
  return makeSanitizingProvider(
    isMockAIEnabled()
      ? makeDemoLabelledProvider(new MockAIProvider())
      : new BackendAIProvider(),
  );
}

// ─── Singleton provider ──────────────────────────────────────────────────────
// The real backend is the default. If it can't be reached, requests fail with
// an AIError the screens show with a Retry button — never invented answers.
let _provider: AIProvider = createDefaultProvider();
let _usingDefaultProvider = true;
let _providerInitialized = false;

export function setAIProvider(provider: AIProvider) {
  _provider = makeSanitizingProvider(provider);
  _usingDefaultProvider = false;
}

export function getAIProvider(): AIProvider {
  return _provider;
}

/**
 * Probe the backend AI service (GET /ai/status) and cache what it supports.
 * Safe to call multiple times: the status is fetched once per session (see
 * services/ai/capabilities.ts). Never throws and never falls back to mock
 * answers.
 */
export async function initAIProvider(): Promise<void> {
  if (isMockAIEnabled() || !_usingDefaultProvider) {
    _providerInitialized = true;
    return;
  }
  const status = await getAIStatus();
  _providerInitialized = status.reachable;
}

/** True once /ai/status has answered (or a custom / demo provider is in use). */
export function isAIProviderInitialized(): boolean {
  return _providerInitialized;
}

/**
 * Run before every AI operation. Throws UNAVAILABLE ("Gozlin is temporarily
 * unavailable.") when the backend explicitly reports no provider configured.
 * An unreachable status probe does not block: the request itself goes through
 * resilientFetch's failover and surfaces its own error.
 */
async function ensureAIReady(): Promise<void> {
  await initAIProvider();
  if (isMockAIEnabled() || !_usingDefaultProvider) return;
  const status = getCachedAIStatus();
  if (status?.reachable && status.providerConfigured === false) {
    throw new AIError("UNAVAILABLE", AI_TEMPORARILY_UNAVAILABLE_MESSAGE, {
      serverCode: AI_NO_PROVIDER_CODE,
      serverMessage: AI_TEMPORARILY_UNAVAILABLE_MESSAGE,
    });
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
    analyze: "Analysis",
    tasks: "Task Extraction",
    "fill-form": "Form Fill",
    "generate-document": "Generate Document",
    "chat-with-document": "Document Chat",
    "devils-advocate": "Devil's Advocate",
    "narrative-arc": "Narrative Arc",
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
  extras?: Pick<AIChatMessage, "format" | "citations" | "locatorType" | "notice" | "streamState">,
): AIChatMessage {
  const message: AIChatMessage = {
    id: generateId(),
    role,
    content,
    timestamp: Date.now(),
    structuredData,
  };
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (v !== undefined) (message as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return message;
}

/** Build the message extras (format / citations / notice) carried by a response. */
export function messageExtrasFromResponse(
  res: AIResponse,
): Pick<AIChatMessage, "format" | "citations" | "locatorType" | "notice"> {
  const extras: Pick<AIChatMessage, "format" | "citations" | "locatorType" | "notice"> = {};
  if (res.format === "markdown") extras.format = "markdown";
  if (Array.isArray(res.citations) && res.citations.length > 0) extras.citations = res.citations;
  if (res.locatorType) extras.locatorType = res.locatorType;
  if (res.notice) extras.notice = res.notice;
  return extras;
}

// ─── Core AI operations ───────────────────────────────────────────────────────

/** Today's 15,000-character clamp, for request builders outside this file. */
export function prepareTextForRequest(text: string): string {
  return prepareText(text);
}

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

/** Options for document-aware tasks (all optional; omitted = legacy behavior). */
export interface AITaskOptions {
  /** The attached document. Enables whole-document requests (AI_DOCID_TASKS). */
  docRef?: AIDocumentRef;
  /** The user's typed request about the document, sent as `instruction`. */
  instruction?: string;
  /** Keep Markdown in `content`; only for callers that render MarkdownText. */
  preserveMarkdown?: boolean;
}

export interface AIAnalysisTaskOptions extends AITaskOptions {
  /** A second context document for Devil's Advocate / Narrative Arc. */
  contextDocRef?: AIDocumentRef;
}

interface ResolvedTaskInput {
  text: string;
  fields: AIDocTaskFields;
  notice?: string;
  /** Set when the request is a whole-document (docId) request. */
  docRef?: AIDocumentRef;
}

/** "Gozlin read the first part of this document (about N pages)." */
export function legacyTruncationNotice(fullText: string, doc?: AIDocumentRef): string {
  const slice = fullText.slice(0, TEXT_INPUT_LIMIT);
  let pages = (slice.match(/\[Page \d+\]/g) || []).length;
  if (!pages) {
    const total = (doc as AIDocumentRefInternal | undefined)?._extractionMeta?.totalPages;
    pages =
      typeof total === "number" && total > 0 && fullText.length > 0
        ? Math.round((total * TEXT_INPUT_LIMIT) / fullText.length)
        : Math.round(TEXT_INPUT_LIMIT / 3_000);
  }
  pages = Math.max(1, pages);
  return `Gozlin read the first part of this document (about ${pages} page${pages === 1 ? "" : "s"}).`;
}

/** "Gozlin covered about X% of this document." */
export function coverageNotice(res: AIResponse): string | undefined {
  const c = res.coverage;
  if (!c || !c.truncated) return undefined;
  if (c.totalChars > 0) {
    const pct = Math.min(99, Math.max(1, Math.round((c.processedChars / c.totalChars) * 100)));
    return `Gozlin covered about ${pct}% of this document.`;
  }
  return "Gozlin covered part of this document.";
}

function clampInstruction(instruction?: string): string | undefined {
  const t = typeof instruction === "string" ? instruction.trim() : "";
  return t ? t.slice(0, INSTRUCTION_LIMIT) : undefined;
}

/**
 * Decide what a task sends:
 *   • flag + `docIdTasks` capability + a document with a backend docId →
 *     `{ docId, instruction }` (the whole document, C5);
 *   • flag + capability without such a document → the text, up to 90,000
 *     characters, with a visible note when cut;
 *   • otherwise → exactly today's request (15,000-character cut). With the flag
 *     on, a cut document gets an honest note.
 */
async function resolveTaskInput(
  text: string,
  opts: AITaskOptions = {},
  extraCapability?: AICapabilityKey,
): Promise<ResolvedTaskInput> {
  const fields: AIDocTaskFields = {};
  if (opts.preserveMarkdown) fields.preserveMarkdown = true;

  const v2 = await canUseAsync(AI_DOCID_TASKS, "docIdTasks");
  const docId = getDocRefDocId(opts.docRef);
  const extraOk =
    v2 && (!extraCapability || (await getAICapabilities())[extraCapability] === true);

  if (v2 && extraOk && docId && opts.docRef) {
    return {
      text: "",
      fields: { ...fields, docId, wholeDocument: true, instruction: clampInstruction(opts.instruction) },
      docRef: opts.docRef,
    };
  }
  if (v2) {
    if (text.length > PASTED_TEXT_LIMIT_V2) {
      return { text: text.slice(0, PASTED_TEXT_LIMIT_V2), fields, notice: PASTED_TEXT_CUT_NOTICE };
    }
    return { text, fields };
  }
  const notice =
    AI_DOCID_TASKS && opts.docRef && text.length > TEXT_INPUT_LIMIT
      ? legacyTruncationNotice(text, opts.docRef)
      : undefined;
  return { text: prepareText(text), fields, notice };
}

/** Run a task, recovering once from DOC_NOT_FOUND on whole-document requests. */
async function runTask(
  input: ResolvedTaskInput,
  call: (fields: AIDocTaskFields) => Promise<AIResponse>,
): Promise<AIResponse> {
  const res =
    input.fields.wholeDocument && input.docRef
      ? await withDocRecovery(input.docRef, (docId) => call({ ...input.fields, docId }))
      : await call(input.fields);
  const notice = input.notice ?? coverageNotice(res);
  return notice ? { ...res, notice } : res;
}

export async function sendChat(
  message: string,
  history: AIChatMessage[],
  documentText?: string,
  documentName?: string,
  signal?: AbortSignal,
  options: { preserveMarkdown?: boolean } = {},
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const req: Parameters<AIProvider["chat"]>[0] = {
    message,
    history,
    documentText: documentText ? prepareText(documentText) : undefined,
    documentName,
    signal,
  };
  if (options.preserveMarkdown) req.preserveMarkdown = true;
  return _provider.chat(req);
}

export async function summarize(
  text: string,
  documentName?: string,
  signal?: AbortSignal,
  options?: AITaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options);
  return runTask(input, (fields) =>
    _provider.summarize({ text: input.text, documentName, signal, ...fields }),
  );
}

export async function translate(
  text: string,
  targetLanguage: string,
  documentName?: string,
  signal?: AbortSignal,
  options?: AITaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options);
  return runTask(input, (fields) =>
    _provider.translate({
      text: input.text,
      targetLanguage,
      documentName,
      signal,
      ...fields,
    }),
  );
}

export async function analyze(
  text: string,
  analysisType?: string,
  documentName?: string,
  signal?: AbortSignal,
  options?: AITaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options);
  return runTask(input, (fields) =>
    _provider.analyze({
      text: input.text,
      analysisType,
      documentName,
      signal,
      ...fields,
    }),
  );
}

export async function extractTasks(
  text: string,
  documentName?: string,
  signal?: AbortSignal,
  options?: AITaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options);
  return runTask(input, (fields) =>
    _provider.extractTasks({ text: input.text, documentName, signal, ...fields }),
  );
}

export async function generateDocument(
  prompt: string,
  fileType: "docx" | "pdf" | "ppt",
  category: string,
  tone?: string,
  wordCount?: number,
  audience?: string,
  signal?: AbortSignal,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  return _provider.generateDocument({
    prompt: prepareText(prompt),
    fileType,
    category,
    tone,
    wordCount,
    audience,
    signal,
  });
}

/**
 * Resolve the context document of Devil's Advocate / Narrative Arc on a
 * contract-v2 backend: its docId on a whole-document request, otherwise its
 * text up to the v2 pasted-text limit. (Callers use today's cut context text
 * when the flag or capability is off.)
 */
function resolveContext(
  input: ResolvedTaskInput,
  contextText?: string,
  contextDocRef?: AIDocumentRef,
): { contextText?: string; contextDocId?: string } {
  const contextDocId = input.fields.wholeDocument ? getDocRefDocId(contextDocRef) : undefined;
  if (contextDocId) return { contextDocId };
  if (!contextText) return {};
  return { contextText: contextText.slice(0, PASTED_TEXT_LIMIT_V2) };
}

export async function runDevilsAdvocate(
  text: string,
  documentName?: string,
  role?: import("./ai.types").ChallengerRole,
  customRole?: string,
  contextText?: string,
  contextName?: string,
  signal?: AbortSignal,
  options?: AIAnalysisTaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options, "devilsAdvocate");
  const context = canUse(AI_DOCID_TASKS, "docIdTasks")
    ? resolveContext(input, contextText, options?.contextDocRef)
    : { contextText: contextText ? prepareText(contextText) : undefined };
  return runTask(input, (fields) =>
    _provider.devilsAdvocate({
      text: input.text,
      documentName,
      role,
      customRole,
      ...context,
      contextName,
      signal,
      ...fields,
    }),
  );
}

export async function checkNarrativeArc(
  text: string,
  documentName?: string,
  format?: import("./ai.types").DocFormat,
  contextText?: string,
  contextName?: string,
  signal?: AbortSignal,
  options?: AIAnalysisTaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options, "narrativeArc");
  const context = canUse(AI_DOCID_TASKS, "docIdTasks")
    ? resolveContext(input, contextText, options?.contextDocRef)
    : { contextText: contextText ? prepareText(contextText) : undefined };
  return runTask(input, (fields) =>
    _provider.narrativeArc({
      text: input.text,
      documentName,
      format,
      ...context,
      contextName,
      signal,
      ...fields,
    }),
  );
}

export async function highlightKeyPoints(
  text: string,
  documentName?: string,
  signal?: AbortSignal,
  options?: AITaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options);
  return runTask(input, (fields) =>
    _provider.highlight({ text: input.text, documentName, signal, ...fields }),
  );
}

/**
 * Ask the backend to produce a meta summary (bullets + keyThemes) over a list
 * of already-extracted highlights. Falls back to a local digest when the
 * backend is unavailable.
 */
export async function summarizeHighlights(
  highlights: import("./ai.types").HighlightItem[],
  documentName?: string,
): Promise<{ summary: string[]; keyThemes: string[] }> {
  assertAIPremium();
  try {
    const { API_ENDPOINTS } = require("@/config/api");
    const res = await resilientFetch(
      API_ENDPOINTS.AI.HIGHLIGHT_SUMMARY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highlights, documentName }),
      },
      { timeoutMs: 60000 },
    );
    if (res.ok) {
      const json = await res.json();
      const data = json?.data ?? {};
      return {
        summary: Array.isArray(data.summary) ? deepStripMarkdown(data.summary) : [],
        keyThemes: Array.isArray(data.keyThemes) ? deepStripMarkdown(data.keyThemes) : [],
      };
    }
  } catch (e) {
    console.warn("[AI] summarizeHighlights failed, using local fallback", e);
  }

  // Local fallback: use top critical/high reasons as the summary
  const topN = highlights
    .slice()
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2 } as const;
      return (rank[a.importance] ?? 3) - (rank[b.importance] ?? 3);
    })
    .slice(0, 5)
    .map((h) => h.reason || h.text)
    .filter(Boolean);
  const themes = Array.from(
    new Set(highlights.map((h) => formatCategory(h.category)).filter(Boolean)),
  ).slice(0, 6);
  return { summary: topN, keyThemes: themes };
}

/**
 * Convert a highlight (text + optional reason/context) into a structured task
 * by reusing the backend's task extractor. Returns a task-like object or null.
 */
export async function convertHighlightToTask(
  highlightText: string,
  context?: string,
  documentName?: string,
): Promise<Record<string, unknown> | null> {
  assertAIPremium();
  try {
    const { API_ENDPOINTS } = require("@/config/api");
    const res = await resilientFetch(
      API_ENDPOINTS.AI.CONVERT_TO_TASK,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: highlightText, context, documentName }),
      },
      { timeoutMs: 60000 },
    );
    if (res.ok) {
      const json = await res.json();
      if (json?.data && typeof json.data === "object") return deepStripMarkdown(json.data);
    }
  } catch (e) {
    console.warn("[AI] convertHighlightToTask failed, using local fallback", e);
  }
  // Fallback: build a minimal task locally
  return {
    action: highlightText,
    owner: "Unassigned",
    deadline: "Not specified",
    priority: "medium",
    context: context || documentName || "",
    category: "follow-up",
  };
}

function formatCategory(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function explainText(
  text: string,
  mode?:
    | "simple"
    | "plain"
    | "professional"
    | "legal"
    | "medical"
    | "technical"
    | "bullet",
  depth?: "short" | "medium" | "deep",
  signal?: AbortSignal,
  options?: AITaskOptions,
): Promise<AIResponse> {
  assertAIPremium();
  await ensureAIReady();
  const input = await resolveTaskInput(text, options);
  return runTask(input, (fields) =>
    _provider.explain({ text: input.text, mode, depth, signal, ...fields }),
  );
}

export async function generateQuiz(
  text: string,
  questionType?: "mcq" | "true_false" | "short" | "mixed",
  length?: "quick" | "standard" | "deep",
  difficulty?: "easy" | "medium" | "hard" | "adaptive",
  documentName?: string,
  weakTopics?: string[],
  /** Document reference to look up the backend extraction docId for true RAG grounding. */
  docRef?: AIDocumentRef,
  signal?: AbortSignal,
): Promise<AIResponse> {
  assertAIPremium();
  // Re-probe the backend every time (no-op if already switched).
  // This handles the common case where the backend wasn't ready at app startup
  // but became available by the time the user actually runs a quiz.
  await ensureAIReady();

  const input = await resolveTaskInput(text, { docRef });
  if (input.fields.wholeDocument) {
    return runTask(input, (fields) =>
      _provider.quiz({
        text: input.text,
        questionType,
        length,
        difficulty,
        documentName,
        weakTopics,
        signal,
        ...fields,
      }),
    );
  }

  const docId = (docRef as AIDocumentRefInternal | undefined)?._extractionDocId;
  const res = await _provider.quiz({
    text: input.text,
    docId,
    questionType,
    length,
    difficulty,
    documentName,
    weakTopics,
    signal,
  });
  return input.notice ? { ...res, notice: input.notice } : res;
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

function isUploadableDocument(doc: AIDocumentRef): "pdf" | "document" | null {
  const name = doc.name.toLowerCase();
  if (doc.mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    doc.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx") ||
    doc.mimeType === "application/epub+zip" ||
    name.endsWith(".epub") ||
    doc.mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    name.endsWith(".pptx") ||
    doc.mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    name.endsWith(".xlsx")
  ) {
    return "document";
  }
  return null;
}

/**
 * Attempt to extract text content from a document.
 * For PDFs, sends to backend extraction endpoint for high-quality text extraction.
 * For plain text files, reads directly.
 *
 * With AI_PERSISTENT_DOC_CACHE and the backend's `persistentDocs` capability,
 * a document uploaded before (and not yet expired) is served from the cache
 * without any upload.
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

    const kind = isUploadableDocument(doc);
    if (kind && (await canUseAsync(AI_PERSISTENT_DOC_CACHE, "persistentDocs"))) {
      try {
        const ensured = await ensureDocumentUploaded(doc, { needText: true });
        const text = ensured.text ?? ensured.entry.preview ?? "";
        doc.extractedText = text;
        if (text) return text;
        return kind === "pdf"
          ? `[PDF: ${doc.name} — Extraction returned no text]`
          : `[${doc.name} — no text extracted]`;
      } catch (extractErr) {
        console.warn("[AI] Document extraction failed:", extractErr);
        return kind === "pdf"
          ? `[PDF document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nText extraction was not available. You can paste the document text below and I'll work with that.`
          : `[Document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nExtraction failed. You can paste the text manually.`;
      }
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

        // resilientFetch fails over across the backend pool; 2 min per attempt.
        const response = await resilientFetch(
          API_ENDPOINTS.AI.EXTRACT_PDF,
          { method: "POST", body: formData },
          { timeoutMs: 120000 },
        );

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

    if (kind === "document") {
      try {
        const { API_ENDPOINTS, wakeUpBackend } = require("@/config/api");
        await wakeUpBackend();

        const formData = new FormData();
        formData.append("file", {
          uri: doc.uri,
          type: doc.mimeType || "application/octet-stream",
          name: doc.name,
        } as any);

        // resilientFetch fails over across the backend pool; 2 min per attempt.
        const response = await resilientFetch(
          API_ENDPOINTS.AI.EXTRACT_DOCUMENT,
          { method: "POST", body: formData },
          { timeoutMs: 120000 },
        );

        if (response.ok) {
          const result = await response.json();
          if (result.docId) {
            doc.extractedText = result.fullText || result.preview || "";
            const internal = doc as AIDocumentRefInternal;
            internal._extractionDocId = result.docId;
            internal._extractionMeta = {
              totalPages: result.totalPages,
              scannedPages: result.scannedPages || 0,
              chunkCount: result.chunkCount,
            };
          }
          return result.fullText || result.preview || `[${doc.name} — no text extracted]`;
        }
        console.warn("[AI] Document extraction backend error:", response.status);
      } catch (extractErr) {
        console.warn("[AI] Document extraction failed:", extractErr);
      }
      return `[Document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nExtraction failed. You can paste the text manually.`;
    }

    return `[Document: "${doc.name}" – ${formatFileSize(doc.size)}]\n\nText extraction is not available for this format yet. You can paste the document text manually.`;
  } catch (e) {
    console.error("extractDocumentText error:", e);
    return `[Document: "${doc.name}"]\n\nFailed to read document. You can paste the document text manually.`;
  }
}

/** The backend docId of a document extracted earlier in this session, if any. */
export function getDocumentId(doc: AIDocumentRef | null | undefined): string | undefined {
  return getDocRefDocId(doc);
}

// Gozlin chat about an attached document lives in services/ai/streamingChat.ts
// (answerChat), which also owns streaming and the one-time /chat fallback.

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
  options: { preserveMarkdown?: boolean; signal?: AbortSignal } = {},
): Promise<AskPdfResult> {
  assertAIPremium();
  const docId = (doc as AIDocumentRefInternal)._extractionDocId;
  if (!docId) {
    return {
      answer:
        "This document hasn't been extracted yet. Please attach it to a chat first so the text can be extracted.",
      citations: [],
      found: false,
    };
  }

  const ask = async (id: string) => {
    const { API_ENDPOINTS } = require("../../config/api");
    const resp = await resilientFetch(API_ENDPOINTS.AI.ASK_PDF, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: id, question }),
      signal: options.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      let errBody: any = {};
      try {
        errBody = JSON.parse(errText);
      } catch {
        // not JSON
      }
      const { aiErrorFromResponseBody } = require("./aiErrors") as typeof import("./aiErrors");
      throw aiErrorFromResponseBody(resp.status, errText, {
        headers: resp.headers,
        message: (typeof errBody?.error === "string" && errBody.error) || `ask-pdf failed (${resp.status})`,
      });
    }

    return (await resp.json()) as {
      answer: string;
      citations: Array<{ page: number; quote: string }>;
      found: boolean;
    };
  };

  try {
    const data = canUse(AI_PERSISTENT_DOC_CACHE, "persistentDocs")
      ? await withDocRecovery(doc, ask)
      : await ask(docId);

    const keepMarkdown = options.preserveMarkdown === true && canUse(AI_MARKDOWN, "markdown");
    let answer = keepMarkdown ? data.answer : stripMarkdown(data.answer);
    let citations = data.citations ?? [];
    if (canUse(AI_CITATIONS_V2, "citationsV2")) {
      const parsed = parseCitations(data.citations, { locatorType: getDocRefLocatorType(doc) });
      citations = parsed;
      answer = removeOrphanCitationMarkers(answer, parsed);
    } else if (isV2CitationShape(data.citations)) {
      answer = stripCitationMarkers(answer);
    }

    return {
      answer,
      citations,
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
