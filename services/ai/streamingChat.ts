// ============================================
// Streaming chat (W5, contract v2 C7)
// ---------------------------------------------
// Streams answers as Server-Sent Events:
//   POST /api/ai/chat-document/stream   (same body as /chat-document)
//   POST /api/ai/chat/stream            (same body as /chat)
// Events: meta → delta* → citations? → done | error.
//
// Fallback rules (every screen gets them by using the answer* helpers):
//   • flag or capability off, the stream route 404s, or anything fails before
//     the first delta → the non-streaming endpoint, once;
//   • a failure AFTER text arrived → keep the partial text, marked interrupted;
//   • a cancel is never retried.
// ============================================

import { API_ENDPOINTS, resilientStream } from "@/config/api";
import {
  AI_CITATIONS_V2,
  AI_DOCID_TASKS,
  AI_MARKDOWN,
  AI_STREAMING,
} from "@/constants/featureFlags";
import { stripMarkdown } from "@/utils/sanitizeAiText";
import { SSEParser } from "@/utils/sseParser";

import type { AIChatMessage, AIDocumentRef } from "./ai.types";
import {
  AIError,
  codeFromServerCode,
  isAIError,
  isRouteMissing,
  normalizeAIError,
} from "./aiErrors";
import { canUse, canUseAsync, invalidateAICapabilities } from "./capabilities";
import {
  parseCitations,
  removeOrphanCitationMarkers,
  stripCitationMarkers,
  type AICitation,
  type AILocatorType,
} from "./citations";
import { withDocRecovery } from "./docRecovery";
import { getDocRefDocId, getDocRefLocatorType, setDocRefDocId } from "./docSessionCache";
import { assertAIPremium } from "./premiumGuard";

// ─── Low-level stream clients ────────────────────────────────────────────────

export interface StreamMeta {
  requestId?: string;
  retrieval?: { mode?: string; embeddingProvider?: string | null };
}

export interface StreamDone {
  answer: string;
  citations: AICitation[];
  found: boolean;
}

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void;
  onDelta?: (text: string) => void;
  onCitations?: (citations: AICitation[]) => void;
}

/** An AIError from a stream that also records whether answer text had arrived. */
export class AIStreamError extends AIError {
  readonly receivedText: boolean;
  readonly partialText: string;
  readonly routeMissing: boolean;

  constructor(base: AIError, receivedText: boolean, partialText: string, routeMissing = false) {
    super(base.code, base.message, {
      status: base.status,
      retryAfterSec: base.retryAfterSec,
      requestId: base.requestId,
      serverMessage: base.serverMessage,
      serverCode: base.serverCode,
    });
    this.receivedText = receivedText;
    this.partialText = partialText;
    this.routeMissing = routeMissing;
  }
}

/** The C7 event names; anything else is ignored. */
export const STREAM_EVENTS = ["meta", "delta", "citations", "done", "error"] as const;

const STREAM_CONNECT_TIMEOUT_MS = 30_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;

function mapHistory(history: AIChatMessage[] | undefined) {
  return (history || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}

async function runStream(
  url: string,
  body: Record<string, unknown>,
  opts: { signal?: AbortSignal; locatorType?: AILocatorType; handlers?: StreamHandlers },
): Promise<StreamDone> {
  const handlers = opts.handlers ?? {};
  let stream;
  try {
    stream = await resilientStream(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
      { connectTimeoutMs: STREAM_CONNECT_TIMEOUT_MS, idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS },
    );
  } catch (e) {
    const err = normalizeAIError(e, { signal: opts.signal ?? null });
    const missing = isRouteMissing(err);
    if (missing) invalidateAICapabilities();
    throw new AIStreamError(err, false, "", missing);
  }

  let partial = "";
  let done: StreamDone | null = null;
  let failure: AIError | null = null;

  const parser = new SSEParser({
    knownEvents: STREAM_EVENTS,
    onEvent: (ev) => {
      if (done || failure) return;
      let data: any;
      try {
        data = ev.data ? JSON.parse(ev.data) : {};
      } catch {
        return; // malformed event — ignore it
      }
      switch (ev.event) {
        case "meta":
          handlers.onMeta?.({ requestId: data?.requestId, retrieval: data?.retrieval });
          break;
        case "delta":
          if (typeof data?.text === "string" && data.text) {
            partial += data.text;
            handlers.onDelta?.(data.text);
          }
          break;
        case "citations":
          handlers.onCitations?.(parseCitations(data?.citations, { locatorType: opts.locatorType }));
          break;
        case "done":
          done = {
            answer: typeof data?.answer === "string" ? data.answer : partial,
            citations: parseCitations(data?.citations, { locatorType: opts.locatorType }),
            found: data?.found !== false,
          };
          break;
        case "error":
          failure = new AIError(
            codeFromServerCode(data?.code),
            typeof data?.message === "string" && data.message
              ? data.message
              : "The answer was interrupted.",
            {
              serverCode: typeof data?.code === "string" ? data.code : undefined,
              serverMessage: typeof data?.message === "string" ? data.message : undefined,
            },
          );
          break;
        default:
          break; // unknown events are ignored
      }
    },
  });

  try {
    await stream.read((chunk) => {
      if (typeof chunk === "string") parser.feedText(chunk);
      else parser.feed(chunk);
    });
    parser.end();
  } catch (e) {
    parser.end();
    if (!done) {
      const err = normalizeAIError(e, { signal: opts.signal ?? null });
      throw new AIStreamError(err, partial.length > 0, partial);
    }
  } finally {
    stream.cancel();
  }

  if (done) return done;
  throw new AIStreamError(
    failure ?? new AIError("NETWORK", "The answer was interrupted."),
    partial.length > 0,
    partial,
  );
}

/** Stream an answer about a document. Resolves with the `done` payload. */
export async function streamDocumentChat(params: {
  docId: string;
  question: string;
  history?: AIChatMessage[];
  signal?: AbortSignal;
  locatorType?: AILocatorType;
  onMeta?: StreamHandlers["onMeta"];
  onDelta?: StreamHandlers["onDelta"];
  onCitations?: StreamHandlers["onCitations"];
}): Promise<StreamDone> {
  assertAIPremium();
  return runStream(
    `${API_ENDPOINTS.AI.CHAT_DOCUMENT}/stream`,
    { docId: params.docId, question: params.question, history: mapHistory(params.history) },
    {
      signal: params.signal,
      locatorType: params.locatorType,
      handlers: { onMeta: params.onMeta, onDelta: params.onDelta, onCitations: params.onCitations },
    },
  );
}

/** Stream a free chat answer. Resolves with the `done` payload. */
export async function streamChat(params: {
  message: string;
  history?: AIChatMessage[];
  documentText?: string;
  documentName?: string;
  signal?: AbortSignal;
  onMeta?: StreamHandlers["onMeta"];
  onDelta?: StreamHandlers["onDelta"];
}): Promise<StreamDone> {
  assertAIPremium();
  const body: Record<string, unknown> = {
    message: params.message,
    history: mapHistory(params.history),
  };
  if (params.documentText) body.documentText = params.documentText;
  if (params.documentName) body.documentName = params.documentName;
  return runStream(`${API_ENDPOINTS.AI.CHAT}/stream`, body, {
    signal: params.signal,
    handlers: { onMeta: params.onMeta, onDelta: params.onDelta },
  });
}

// ─── Delta batching ──────────────────────────────────────────────────────────

/**
 * Collects deltas and flushes the full text at most once per interval, so a
 * fast stream causes ~20 state updates a second instead of hundreds.
 */
export class DeltaBuffer {
  private text = "";
  private lastFlushed = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onFlush: (fullText: string) => void,
    private readonly intervalMs = 50,
  ) {}

  push(delta: string): void {
    this.text += delta;
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.intervalMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.text !== this.lastFlushed) {
      this.lastFlushed = this.text;
      this.onFlush(this.text);
    }
  }

  get value(): string {
    return this.text;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// ─── Display helpers ─────────────────────────────────────────────────────────

/** Text to show while streaming (Markdown kept only when it will be rendered). */
export function displayStreamingText(text: string, keepMarkdown: boolean, citationsV2: boolean): string {
  let t = text || "";
  if (!keepMarkdown) t = stripMarkdown(t);
  if (!citationsV2) t = stripCitationMarkers(t);
  return t;
}

/** The final answer text: replaces the streamed text on `done`. */
export function finalizeAnswerText(
  answer: string,
  opts: { keepMarkdown: boolean; citationsV2: boolean; citations: AICitation[] },
): string {
  let t = answer || "";
  if (!opts.keepMarkdown) t = stripMarkdown(t);
  t = opts.citationsV2 ? removeOrphanCitationMarkers(t, opts.citations) : stripCitationMarkers(t);
  return t;
}

// ─── High-level answer helpers used by screens ───────────────────────────────

/** Errors that must not trigger a second (non-streaming) request. */
const NO_FALLBACK_CODES = new Set(["CANCELLED", "PREMIUM_REQUIRED", "UNAUTHORIZED", "RATE_LIMITED"]);

export interface AnswerCallbacks {
  /** Batched (≤ every 50 ms) full text so far, already formatted for display. */
  onText?: (text: string) => void;
  /** Called once when the first streamed text arrives. */
  onFirstText?: () => void;
  /** Called when a missing document is being re-uploaded. */
  onReloading?: () => void;
}

export interface DocumentAnswer {
  content: string;
  /** Contract-v2 citations (only when AI_CITATIONS_V2 is usable). */
  citations: AICitation[];
  /** Citations in the legacy `{ page, quote }` form for the old Sources block. */
  legacyCitations: Array<{ page: number; quote: string }>;
  found: boolean;
  format?: "markdown";
  locatorType?: AILocatorType;
  streamed: boolean;
  /** Set when a stream failed after text arrived; `content` is the partial text. */
  streamState?: "interrupted";
  error?: AIError;
}

export interface DocumentAnswerParams extends AnswerCallbacks {
  question: string;
  history: AIChatMessage[];
  /** The document; enables one silent re-upload on DOC_NOT_FOUND. */
  docRef?: AIDocumentRef;
  /** The current docId (recorded on docRef when it has none yet). */
  docId?: string;
  signal?: AbortSignal;
  locatorType?: AILocatorType;
  preserveMarkdown?: boolean;
  /** How to re-upload `docRef` (default: the AI extraction upload). */
  reupload?: (doc: AIDocumentRef) => Promise<string>;
}

function isCancel(err: AIError, signal?: AbortSignal): boolean {
  return err.code === "CANCELLED" || !!signal?.aborted;
}

/**
 * Answer a question about a document: streamed when possible, otherwise the
 * normal request. Throws AIError (CANCELLED on cancel — an AIStreamError whose
 * partialText lets the screen keep what was shown, marked "Stopped").
 */
export async function answerDocumentQuestion(p: DocumentAnswerParams): Promise<DocumentAnswer> {
  assertAIPremium();
  const keepMarkdown = p.preserveMarkdown === true && canUse(AI_MARKDOWN, "markdown");
  const citationsV2 = canUse(AI_CITATIONS_V2, "citationsV2");
  const locatorType = p.locatorType ?? getDocRefLocatorType(p.docRef);

  if (p.docRef && p.docId && !getDocRefDocId(p.docRef)) {
    setDocRefDocId(p.docRef, p.docId, locatorType);
  }
  const withRecovery = <T>(fn: (docId: string) => Promise<T>): Promise<T> => {
    if (p.docRef) {
      return withDocRecovery(p.docRef, fn, { reupload: p.reupload, onReloading: p.onReloading });
    }
    if (!p.docId) return Promise.reject(new AIError("DOC_NOT_FOUND", "No document to ask about."));
    return fn(p.docId);
  };

  if (canUse(AI_STREAMING, "streamChatDocument")) {
    let firstText = false;
    const buffer = new DeltaBuffer((full) => p.onText?.(displayStreamingText(full, keepMarkdown, citationsV2)));
    try {
      const done = await withRecovery((docId) =>
        runStream(
          `${API_ENDPOINTS.AI.CHAT_DOCUMENT}/stream`,
          { docId, question: p.question, history: mapHistory(p.history) },
          {
            signal: p.signal,
            locatorType,
            handlers: {
              onDelta: (t) => {
                if (!firstText) {
                  firstText = true;
                  p.onFirstText?.();
                }
                buffer.push(t);
              },
            },
          },
        ),
      );
      buffer.dispose();
      return {
        content: finalizeAnswerText(done.answer, { keepMarkdown, citationsV2, citations: done.citations }),
        citations: citationsV2 ? done.citations : [],
        legacyCitations: done.citations.map((c) => ({ page: c.page, quote: c.quote })),
        found: done.found,
        format: keepMarkdown ? "markdown" : undefined,
        locatorType,
        streamed: true,
      };
    } catch (e) {
      buffer.flush();
      buffer.dispose();
      const err = isAIError(e) ? e : normalizeAIError(e, { signal: p.signal ?? null });
      const received = e instanceof AIStreamError ? e.receivedText || firstText : firstText;
      const partial = displayStreamingText(buffer.value, keepMarkdown, citationsV2);
      if (isCancel(err, p.signal)) {
        throw new AIStreamError(
          err.code === "CANCELLED" ? err : new AIError("CANCELLED", "Cancelled"),
          received,
          partial,
        );
      }
      if (received) {
        return {
          content: partial,
          citations: [],
          legacyCitations: [],
          found: true,
          format: keepMarkdown ? "markdown" : undefined,
          locatorType,
          streamed: true,
          streamState: "interrupted",
          error: err,
        };
      }
      if (NO_FALLBACK_CODES.has(err.code)) throw err;
      // Nothing shown yet → one non-streaming attempt below.
    }
  }

  const { askDocumentQuestion } = require("@/services/documentChatService") as typeof import("@/services/documentChatService");
  const res = await withRecovery((docId) =>
    askDocumentQuestion(docId, p.question, p.history, p.signal, {
      locatorType,
      preserveMarkdown: p.preserveMarkdown,
    }),
  );
  return {
    content: res.answer,
    citations: res.citationsV2 ? (res.citations as AICitation[]) : [],
    legacyCitations: (res.citations || []).map((c) => ({ page: c.page, quote: c.quote })),
    found: res.found,
    format: res.format,
    locatorType,
    streamed: false,
  };
}

export interface ChatAnswer {
  content: string;
  citations: AICitation[];
  format?: "markdown";
  locatorType?: AILocatorType;
  streamed: boolean;
  streamState?: "interrupted";
  error?: AIError;
}

export interface ChatAnswerParams extends AnswerCallbacks {
  message: string;
  history: AIChatMessage[];
  /** Extracted document text (legacy /chat context). */
  documentText?: string;
  /** The attached document; answers go through document search when possible. */
  docRef?: AIDocumentRef;
  signal?: AbortSignal;
  preserveMarkdown?: boolean;
}

/**
 * Gozlin chat. With an uploaded document and AI_DOCID_TASKS + `docIdTasks`, it
 * answers through document search (with citations); if that fails before
 * showing anything (other than a cancel), it falls back once to today's /chat.
 * Without a document it streams /chat when AI_STREAMING allows, else /chat.
 */
export async function answerChat(p: ChatAnswerParams): Promise<ChatAnswer> {
  assertAIPremium();
  const service = require("./ai.service") as typeof import("./ai.service");
  await service.initAIProvider();

  const docId = getDocRefDocId(p.docRef);
  if (p.docRef && docId && (await canUseAsync(AI_DOCID_TASKS, "docIdTasks"))) {
    try {
      const a = await answerDocumentQuestion({
        question: p.message,
        history: p.history,
        docRef: p.docRef,
        signal: p.signal,
        preserveMarkdown: p.preserveMarkdown,
        onText: p.onText,
        onFirstText: p.onFirstText,
        onReloading: p.onReloading,
      });
      return {
        content: a.content,
        citations: a.citations,
        format: a.format,
        locatorType: a.locatorType,
        streamed: a.streamed,
        streamState: a.streamState,
        error: a.error,
      };
    } catch (e) {
      const err = isAIError(e) ? e : normalizeAIError(e, { signal: p.signal ?? null });
      if (isCancel(err, p.signal) || NO_FALLBACK_CODES.has(err.code)) throw e;
      console.warn("[AI] Document chat failed, falling back to /chat:", err.message);
      const r = await service.sendChat(p.message, p.history, p.documentText, p.docRef?.name, p.signal, {
        preserveMarkdown: p.preserveMarkdown,
      });
      return { content: r.content, citations: [], format: r.format === "markdown" ? "markdown" : undefined, streamed: false };
    }
  }

  if (canUse(AI_STREAMING, "streamChat")) {
    const keepMarkdown = p.preserveMarkdown === true && canUse(AI_MARKDOWN, "markdown");
    let firstText = false;
    const buffer = new DeltaBuffer((full) => p.onText?.(displayStreamingText(full, keepMarkdown, false)));
    try {
      const done = await streamChat({
        message: p.message,
        history: p.history,
        documentText: p.documentText ? service.prepareTextForRequest(p.documentText) : undefined,
        documentName: p.docRef?.name,
        signal: p.signal,
        onDelta: (t) => {
          if (!firstText) {
            firstText = true;
            p.onFirstText?.();
          }
          buffer.push(t);
        },
      });
      buffer.dispose();
      return {
        content: finalizeAnswerText(done.answer, { keepMarkdown, citationsV2: false, citations: [] }),
        citations: [],
        format: keepMarkdown ? "markdown" : undefined,
        streamed: true,
      };
    } catch (e) {
      buffer.flush();
      buffer.dispose();
      const err = isAIError(e) ? e : normalizeAIError(e, { signal: p.signal ?? null });
      const received = e instanceof AIStreamError ? e.receivedText || firstText : firstText;
      const partial = displayStreamingText(buffer.value, keepMarkdown, false);
      if (isCancel(err, p.signal)) {
        throw new AIStreamError(err.code === "CANCELLED" ? err : new AIError("CANCELLED", "Cancelled"), received, partial);
      }
      if (received) {
        return {
          content: partial,
          citations: [],
          format: keepMarkdown ? "markdown" : undefined,
          streamed: true,
          streamState: "interrupted",
          error: err,
        };
      }
      if (NO_FALLBACK_CODES.has(err.code)) throw err;
    }
  }

  const r = await service.sendChat(p.message, p.history, p.documentText, p.docRef?.name, p.signal, {
    preserveMarkdown: p.preserveMarkdown,
  });
  return { content: r.content, citations: [], format: r.format === "markdown" ? "markdown" : undefined, streamed: false };
}

/** Partial text carried by a cancelled / failed stream, if any. */
export function partialTextOf(err: unknown): string {
  return err instanceof AIStreamError ? err.partialText : "";
}
