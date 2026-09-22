/**
 * Document Chat Service
 * Manages the Chat With Document feature on the frontend.
 * Handles document upload, extraction, and conversational Q&A via the backend RAG pipeline.
 */

import { API_ENDPOINTS, resilientFetch, wakeUpBackend } from "@/config/api";
import {
  AI_CITATIONS_V2,
  AI_MARKDOWN,
  AI_PERSISTENT_DOC_CACHE,
} from "@/constants/featureFlags";
import { assertAIPremium } from "@/services/ai/premiumGuard";
import type { AIChatMessage, AIDocumentRef } from "@/services/ai/ai.types";
import { AIError, aiErrorFromResponseBody, normalizeAIError } from "@/services/ai/aiErrors";
import { canUse, canUseAsync } from "@/services/ai/capabilities";
import {
  isV2CitationShape,
  parseCitations,
  removeOrphanCitationMarkers,
  stripCitationMarkers,
  type AICitation,
  type AILocatorType,
} from "@/services/ai/citations";
import { ensureDocumentUploaded } from "@/services/ai/docSessionCache";
import { stripMarkdown } from "@/utils/sanitizeAiText";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocumentChatSession {
  docId: string;
  filename: string;
  fileType: string;
  totalPages: number;
  chunkCount: number;
  embeddingProvider: string;
  preview: string;
  suggestedPrompts: string[];
  /** Locator unit of this document (contract v2, C4). */
  locatorType?: AILocatorType;
  /** "hybrid" with real embeddings, "keyword" otherwise (C4). */
  retrievalMode?: "hybrid" | "keyword" | null;
}

export type DocumentChatCitation = { page: number; quote: string } & Partial<AICitation>;

export interface DocumentChatResponse {
  answer: string;
  citations: DocumentChatCitation[];
  found: boolean;
  retrievedChunks?: Array<{
    chunkId: number;
    pages: number[];
    score: number;
    preview: string;
  }>;
  /** "markdown" when the answer kept its formatting (AI_MARKDOWN). */
  format?: "markdown";
  /** True when `citations` were parsed into the contract-v2 shape (AI_CITATIONS_V2). */
  citationsV2?: boolean;
  retrieval?: { mode?: string; embeddingProvider?: string | null };
}

export interface AskDocumentOptions {
  /** Locator unit used to label citations that arrive without a locator. */
  locatorType?: AILocatorType;
  /** Keep Markdown in the answer; only for callers that render MarkdownText. */
  preserveMarkdown?: boolean;
}

// ─── In-memory cache for extracted documents ────────────────────────────────

const _extractionCache = new Map<
  string,
  { session: DocumentChatSession; timestamp: number }
>();
const CACHE_EXPIRY_MS = 90 * 60 * 1000; // 90 minutes (less than backend's 2 hours)

function getCacheKey(uri: string, name: string): string {
  return `${uri}::${name}`;
}

function getCachedSession(doc: AIDocumentRef): DocumentChatSession | null {
  const key = getCacheKey(doc.uri, doc.name);
  const cached = _extractionCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
    return cached.session;
  }
  if (cached) {
    _extractionCache.delete(key); // Expired
  }
  return null;
}

function cacheSession(doc: AIDocumentRef, session: DocumentChatSession): void {
  const key = getCacheKey(doc.uri, doc.name);
  _extractionCache.set(key, { session, timestamp: Date.now() });

  // Evict old entries if cache grows too large
  if (_extractionCache.size > 20) {
    const oldest = [..._extractionCache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    )[0];
    if (oldest) _extractionCache.delete(oldest[0]);
  }
}

// ─── API Functions ──────────────────────────────────────────────────────────

/**
 * Upload and extract a document for chat. Returns a session ID and metadata.
 * Uses caching to avoid re-processing the same document.
 *
 * With AI_PERSISTENT_DOC_CACHE and the `persistentDocs` capability the upload
 * is remembered across launches (services/ai/docSessionCache.ts), so reopening
 * the same file before it expires makes no upload request.
 */
export async function extractDocumentForChat(
  doc: AIDocumentRef,
  options: { force?: boolean } = {},
): Promise<DocumentChatSession> {
  assertAIPremium();

  if (await canUseAsync(AI_PERSISTENT_DOC_CACHE, "persistentDocs")) {
    const ensured = await ensureDocumentUploaded(doc, {
      endpoint: API_ENDPOINTS.AI.EXTRACT_DOCUMENT,
      fieldName: "document",
      includeFullText: false,
      needText: false,
      force: options.force,
    });
    const e = ensured.entry;
    const session: DocumentChatSession = {
      docId: e.docId,
      filename: e.filename || doc.name,
      fileType: e.fileType || "pdf",
      totalPages: e.totalPages,
      chunkCount: e.chunkCount ?? 0,
      embeddingProvider: e.embeddingProvider || "none",
      preview: e.preview || "",
      suggestedPrompts: e.suggestedPrompts || [],
      locatorType: e.locatorType,
      retrievalMode: e.retrievalMode,
    };
    cacheSession(doc, session);
    return session;
  }

  // Check cache first
  const cached = options.force ? null : getCachedSession(doc);
  if (cached) {
    console.log(
      `[DocChat] Using cached extraction for "${doc.name}" (docId=${cached.docId})`,
    );
    return cached;
  }

  await wakeUpBackend();

  const formData = new FormData();
  formData.append("document", {
    uri: doc.uri,
    type: doc.mimeType || "application/octet-stream",
    name: doc.name || "document",
  } as any);

  // resilientFetch fails over across the backend pool; 3 min per attempt for
  // large documents.
  const response = await resilientFetch(
    API_ENDPOINTS.AI.EXTRACT_DOCUMENT,
    { method: "POST", body: formData },
    { timeoutMs: 180_000 },
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(
      (errBody as any)?.error ||
        `Document extraction failed (${response.status})`,
    );
  }

  const result = await response.json();

  const session: DocumentChatSession = {
    docId: result.docId,
    filename: result.filename,
    fileType: result.fileType || "pdf",
    totalPages: result.totalPages,
    chunkCount: result.chunkCount,
    embeddingProvider: result.embeddingProvider || "none",
    preview: result.preview || "",
    suggestedPrompts: result.suggestedPrompts || [],
  };

  // Cache the session
  cacheSession(doc, session);

  return session;
}

/**
 * Send a question about a previously extracted document.
 * Supports conversation history for multi-turn Q&A.
 *
 * Errors are thrown as AIError. A 404 is DOC_NOT_FOUND; its message keeps the
 * legacy "DOCUMENT_EXPIRED: …" prefix so older screens still recognize it.
 */
export async function askDocumentQuestion(
  docId: string,
  question: string,
  history?: AIChatMessage[],
  externalSignal?: AbortSignal,
  options: AskDocumentOptions = {},
): Promise<DocumentChatResponse> {
  assertAIPremium();
  // Abort on EITHER the 60s timeout OR an external cancel (spring overlay).
  // resilientFetch fails over across the backend pool; externalSignal (caller
  // cancel, e.g. the spring overlay) is honored without failover.
  let response: Response;
  try {
    response = await resilientFetch(
      API_ENDPOINTS.AI.CHAT_DOCUMENT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          question,
          history: (history || []).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: externalSignal,
      },
      { timeoutMs: 60_000 },
    );
  } catch (e) {
    throw normalizeAIError(e, { signal: externalSignal ?? null });
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    let errBody: any = {};
    try {
      errBody = JSON.parse(errText);
    } catch {
      // not JSON
    }

    if (response.status === 404) {
      // Document expired — clear from cache
      throw new AIError(
        "DOC_NOT_FOUND",
        "DOCUMENT_EXPIRED: Document session has expired. Please re-upload the document.",
        {
          status: 404,
          serverCode: typeof errBody?.code === "string" ? errBody.code : undefined,
          serverMessage: typeof errBody?.error === "string" ? errBody.error : undefined,
        },
      );
    }

    throw aiErrorFromResponseBody(response.status, errText, {
      headers: response.headers,
      message:
        (typeof errBody?.error === "string" && errBody.error) ||
        `Chat failed (${response.status})`,
    });
  }

  const data = await response.json();

  const keepMarkdown = options.preserveMarkdown === true && canUse(AI_MARKDOWN, "markdown");
  const citationsV2 = canUse(AI_CITATIONS_V2, "citationsV2");
  // Strip Markdown so the answer renders as clean prose (no ## / ** tokens),
  // unless the caller renders Markdown and the backend supports it.
  let answer: string = keepMarkdown
    ? typeof data.answer === "string"
      ? data.answer
      : ""
    : stripMarkdown(data.answer);
  let citations: DocumentChatCitation[] = data.citations || [];

  if (citationsV2) {
    const parsed = parseCitations(data.citations, { locatorType: options.locatorType });
    citations = parsed;
    answer = removeOrphanCitationMarkers(answer, parsed);
  } else if (isV2CitationShape(data.citations)) {
    // A contract-v2 backend with chips turned off: markers would read as noise.
    answer = stripCitationMarkers(answer);
  }

  const out: DocumentChatResponse = {
    answer,
    citations,
    found: data.found !== false,
    retrievedChunks: data.retrievedChunks || [],
  };
  if (keepMarkdown) out.format = "markdown";
  if (citationsV2) out.citationsV2 = true;
  if (data.retrieval && typeof data.retrieval === "object") out.retrieval = data.retrieval;
  return out;
}

/**
 * Clear the extraction cache for a specific document.
 */
export function clearDocumentCache(doc: AIDocumentRef): void {
  const key = getCacheKey(doc.uri, doc.name);
  _extractionCache.delete(key);
}

/**
 * Clear all cached extractions.
 */
export function clearAllDocumentCache(): void {
  _extractionCache.clear();
}
