// ============================================
// AI Errors — one typed error for every AI failure
// ---------------------------------------------
// Every AI network path converts what went wrong into an AIError with a stable
// `code`, so screens can react by code (open the paywall, show a Retry button,
// stay silent on cancel) instead of matching message strings.
//
// Two backend error bodies are understood (contract v2, C1.5):
//   • new routes:  { success:false, code:"RATE_LIMITED", error:"…", retryAfterSec, requestId }
//   • task routes: { success:false, error:{ code, message } }
// Plain-text bodies (proxies, old servers) fall back to the HTTP status.
// ============================================

export type AIErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "CANCELLED"
  | "UNAUTHORIZED"
  | "PREMIUM_REQUIRED"
  | "RATE_LIMITED"
  | "DOC_NOT_FOUND"
  | "UNAVAILABLE"
  | "SERVER"
  | "BAD_OUTPUT";

export interface AIErrorOptions {
  status?: number;
  retryAfterSec?: number;
  requestId?: string;
  /** The server's own human-readable message, when it sent one. */
  serverMessage?: string;
  /**
   * The raw `code` from the response body, if any. Lets callers tell a real
   * DOC_NOT_FOUND 404 from a plain "route does not exist" 404.
   */
  serverCode?: string;
}

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly status?: number;
  readonly retryAfterSec?: number;
  readonly requestId?: string;
  readonly serverMessage?: string;
  readonly serverCode?: string;

  constructor(code: AIErrorCode, message: string, opts: AIErrorOptions = {}) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.status = opts.status;
    this.retryAfterSec = opts.retryAfterSec;
    this.requestId = opts.requestId;
    this.serverMessage = opts.serverMessage;
    this.serverCode = opts.serverCode;
    // Keep `instanceof` reliable (for subclasses too) when classes are down-levelled.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** serverCode used when /ai/status reports that no AI provider is configured. */
export const AI_NO_PROVIDER_CODE = "NO_PROVIDER";
export const AI_TEMPORARILY_UNAVAILABLE_MESSAGE = "Gozlin is temporarily unavailable.";

export function isAIError(e: unknown): e is AIError {
  return (
    e instanceof AIError ||
    (!!e &&
      typeof e === "object" &&
      (e as { name?: unknown }).name === "AIError" &&
      typeof (e as { code?: unknown }).code === "string")
  );
}

// ─── Body / status mapping ────────────────────────────────────────────────────

const SERVER_CODE_MAP: Record<string, AIErrorCode> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PREMIUM_REQUIRED: "PREMIUM_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
  DOC_NOT_FOUND: "DOC_NOT_FOUND",
  AI_BAD_OUTPUT: "BAD_OUTPUT",
  BAD_OUTPUT: "BAD_OUTPUT",
  TIMEOUT: "TIMEOUT",
  UNAVAILABLE: "UNAVAILABLE",
};

const UNAVAILABLE_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524]);

/** Map a server `code` string (e.g. from an SSE `error` event) to an AIErrorCode. */
export function codeFromServerCode(code: unknown, fallback: AIErrorCode = "SERVER"): AIErrorCode {
  return typeof code === "string" ? (SERVER_CODE_MAP[code.toUpperCase()] ?? fallback) : fallback;
}

/** The code implied by an HTTP status alone (used when the body has no code). */
export function codeForStatus(status: number): AIErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "PREMIUM_REQUIRED";
  // A 404 from a document route means the document is gone (old backends send
  // no code, contract v2 sends DOC_NOT_FOUND).
  if (status === 404) return "DOC_NOT_FOUND";
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (UNAVAILABLE_STATUSES.has(status)) return "UNAVAILABLE";
  return "SERVER";
}

type HeaderSource =
  | { get(name: string): string | null }
  | Record<string, string | undefined>
  | null
  | undefined;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  try {
    if (typeof (headers as { get?: unknown }).get === "function") {
      return (headers as { get(n: string): string | null }).get(name) ?? undefined;
    }
    const rec = headers as Record<string, string | undefined>;
    const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? rec[key] : undefined;
  } catch {
    return undefined;
  }
}

/** Retry-After is either delta-seconds or an HTTP date. */
function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.ceil(value);
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const n = Number(value.trim());
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return undefined;
}

interface ParsedBody {
  code?: string;
  message?: string;
  retryAfterSec?: number;
  requestId?: string;
}

function parseErrorBody(bodyText: string): ParsedBody {
  const trimmed = (bodyText || "").trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      const out: ParsedBody = {};
      const err = json.error;
      if (typeof err === "string") {
        out.message = err;
        if (typeof json.code === "string") out.code = json.code;
      } else if (err && typeof err === "object") {
        const e = err as Record<string, unknown>;
        if (typeof e.code === "string") out.code = e.code;
        if (typeof e.message === "string") out.message = e.message;
      }
      if (!out.code && typeof json.code === "string") out.code = json.code;
      if (!out.message && typeof json.message === "string") out.message = json.message;
      out.retryAfterSec = parseRetryAfter(json.retryAfterSec);
      if (typeof json.requestId === "string") out.requestId = json.requestId;
      return out;
    } catch {
      // Not JSON after all — treat as text below.
    }
  }
  // Plain text (HTML error pages are not useful to show; keep them short).
  return { message: trimmed.startsWith("<") ? undefined : trimmed.slice(0, 500) };
}

/**
 * Build an AIError from an HTTP error response whose body has already been
 * read. `message` defaults to the legacy "Backend AI error (status): body"
 * format so older string checks keep working.
 */
export function aiErrorFromResponseBody(
  status: number,
  bodyText: string,
  opts: { headers?: HeaderSource; statusText?: string; message?: string } = {},
): AIError {
  const parsed = parseErrorBody(bodyText);
  const mapped = parsed.code ? SERVER_CODE_MAP[parsed.code.toUpperCase()] : undefined;
  const code = mapped ?? codeForStatus(status);
  const retryAfterSec =
    parsed.retryAfterSec ?? parseRetryAfter(readHeader(opts.headers, "Retry-After"));
  const requestId = parsed.requestId ?? readHeader(opts.headers, "X-Request-Id");
  const message =
    opts.message ??
    `Backend AI error (${status}): ${bodyText || opts.statusText || ""}`.trim();
  return new AIError(code, message, {
    status,
    retryAfterSec,
    requestId,
    serverMessage: parsed.message,
    serverCode: parsed.code,
  });
}

/**
 * True for a 404 that means "this route does not exist on this server" (an
 * older backend), as opposed to a contract-v2 DOC_NOT_FOUND.
 */
export function isRouteMissing(err: unknown): boolean {
  return (
    isAIError(err) &&
    (err.status === 404 || err.status === 405 || err.status === 501) &&
    (err.status !== 404 || !err.serverCode)
  );
}

// ─── Thrown-error mapping ─────────────────────────────────────────────────────

export interface NormalizeOptions {
  /**
   * The caller's AbortSignal. When the key is present, an AbortError whose
   * signal was NOT aborted is a per-attempt timeout (TIMEOUT); an aborted one is
   * a user cancel (CANCELLED). When the key is absent, AbortError = CANCELLED.
   */
  signal?: AbortSignal | null;
}

/** Map anything thrown by a fetch / AI call to an AIError (synchronous). */
export function normalizeAIError(err: unknown, opts: NormalizeOptions = {}): AIError {
  if (isAIError(err)) return err;
  const hasSignalKey = Object.prototype.hasOwnProperty.call(opts, "signal");
  if (opts.signal?.aborted) {
    return new AIError("CANCELLED", "Cancelled");
  }

  const name = err instanceof Error ? err.name : (err as { name?: string })?.name;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String((err as { message?: unknown })?.message ?? "Unknown error");

  if (name === "PremiumRequiredError") {
    return new AIError("PREMIUM_REQUIRED", message);
  }
  if (name === "CancelError") {
    return new AIError("CANCELLED", message || "Cancelled");
  }
  if (name === "AbortError") {
    return hasSignalKey
      ? new AIError("TIMEOUT", "The request timed out.")
      : new AIError("CANCELLED", message || "Cancelled");
  }

  const lower = (message || "").toLowerCase();
  if (/all backends are unavailable|backend .* → (502|503|504|52[1-4])/.test(lower)) {
    return new AIError("UNAVAILABLE", message);
  }
  if (/timed? ?out|timeout/.test(lower)) {
    return new AIError("TIMEOUT", message);
  }
  if (
    name === "TypeError" &&
    /network|fetch|connection|internet|offline/.test(lower)
  ) {
    return new AIError("NETWORK", message);
  }
  if (/network request failed|failed to fetch|network error|offline/.test(lower)) {
    return new AIError("NETWORK", message);
  }
  const legacy = /^Backend AI error \((\d{3})\)/.exec(message || "");
  if (legacy) {
    return aiErrorFromResponseBody(Number(legacy[1]), message.replace(legacy[0], "").replace(/^:\s*/, ""), {
      message,
    });
  }
  return new AIError("SERVER", message || "Something went wrong.");
}

interface ResponseLike {
  ok?: boolean;
  status: number;
  statusText?: string;
  headers?: HeaderSource;
  text(): Promise<string>;
}

function isResponseLike(v: unknown): v is ResponseLike {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as ResponseLike).status === "number" &&
    typeof (v as ResponseLike).text === "function"
  );
}

/**
 * Convert an error Response OR a thrown error into an AIError. Reads the body
 * of a Response (so don't read it yourself first).
 */
export async function toAIError(
  responseOrError: unknown,
  opts: NormalizeOptions = {},
): Promise<AIError> {
  if (isResponseLike(responseOrError)) {
    const body = await responseOrError.text().catch(() => "");
    return aiErrorFromResponseBody(responseOrError.status, body, {
      headers: responseOrError.headers,
      statusText: responseOrError.statusText,
    });
  }
  return normalizeAIError(responseOrError, opts);
}
