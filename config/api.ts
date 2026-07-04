import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Backend pool (primary + failover backups) ───────────────────────────────
// The app talks to a POOL of interchangeable backends, tried in priority order.
// The first reachable one is used; the moment it errors / is unavailable /
// suspended, the app fails over to the next one ("backup generator" behaviour).
// The active choice is sticky and persisted, so once we land on a healthy
// backend the whole app follows it until that one also fails.
//
// Priority order (highest first):
//   1. EXPO_PUBLIC_API_URL, then EXPO_PUBLIC_API_URL_2 / _3   (.env / eas.json)
//   2. app.json → expo.extra.apiUrl, then expo.extra.apiUrlBackups: [ … ]
//   3. https://inscribed-backend-docker.onrender.com/api      (final fallback)
// Each base may end in "/api" or not — it is normalised below. Duplicates are
// removed while preserving order.
//
// IMPORTANT: cleartext (HTTP) traffic is only permitted to the hosts listed in
// android/app/src/main/res/xml/network_security_config.xml. If you add a base
// on a new local IP, add it there too or release builds fail with
// "Network request failed".
function normalizeBase(url?: string | null): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}

const _extra: any = Constants.expoConfig?.extra ?? {};
const _RAW_BASES: Array<string | undefined | null> = [
  process.env.EXPO_PUBLIC_API_URL,
  process.env.EXPO_PUBLIC_API_URL_2,
  process.env.EXPO_PUBLIC_API_URL_3,
  _extra.apiUrl,
  ...(Array.isArray(_extra.apiUrlBackups) ? _extra.apiUrlBackups : []),
  "https://inscribed-backend-docker.onrender.com/api",
];

/** Ordered, de-duped pool of backend bases (priority high → low). */
export const BACKEND_BASES: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of _RAW_BASES) {
    const b = normalizeBase(raw);
    if (b && !seen.has(b)) {
      seen.add(b);
      out.push(b);
    }
  }
  return out.length
    ? out
    : ["https://inscribed-backend-docker.onrender.com/api"];
})();

let _activeIndex = 0;

/** The backend base currently in use, e.g. "https://host/api". */
export function getActiveBaseUrl(): string {
  return BACKEND_BASES[_activeIndex] ?? BACKEND_BASES[0];
}

// Live, mutable mirrors so legacy `${API_BASE_URL}/path` call sites follow the
// active backend (ES-module live bindings). New code should prefer
// getActiveBaseUrl() / resilientFetch(), which actively fail over.
export let API_BASE_URL = getActiveBaseUrl();
export let BACKEND_BASE = API_BASE_URL.replace(/\/api$/, "");
export let HEALTH_URL = `${BACKEND_BASE}/health`;

const _ACTIVE_KEY = "@wordsinscribed/active_backend_base";

function _applyActive(index: number): void {
  if (BACKEND_BASES.length === 0) return;
  _activeIndex =
    ((index % BACKEND_BASES.length) + BACKEND_BASES.length) %
    BACKEND_BASES.length;
  API_BASE_URL = getActiveBaseUrl();
  BACKEND_BASE = API_BASE_URL.replace(/\/api$/, "");
  HEALTH_URL = `${BACKEND_BASE}/health`;
}

function _persistActive(): void {
  AsyncStorage.setItem(_ACTIVE_KEY, getActiveBaseUrl()).catch(() => {});
}

// Restore the last-known-good backend on startup (best-effort, async).
AsyncStorage.getItem(_ACTIVE_KEY)
  .then((saved) => {
    if (!saved) return;
    const idx = BACKEND_BASES.indexOf(saved);
    if (idx > 0) _applyActive(idx);
  })
  .catch(() => {});

/** Force a specific base (by URL) to be active and persist the choice. */
export function setActiveBaseUrl(base: string): boolean {
  const idx = BACKEND_BASES.indexOf(normalizeBase(base) ?? "");
  if (idx >= 0) {
    _applyActive(idx);
    _persistActive();
    return true;
  }
  return false;
}

export const API_ENDPOINTS = {
  // PDF Operations
  PDF: {
    MERGE: `${API_BASE_URL}/pdf/merge`,
    SPLIT: `${API_BASE_URL}/pdf/split`,
    COMPRESS: `${API_BASE_URL}/pdf/compress`,
    ROTATE: `${API_BASE_URL}/pdf/rotate`,
    WATERMARK: `${API_BASE_URL}/pdf/watermark`,
    PAGE_NUMBERS: `${API_BASE_URL}/pdf/page-numbers`,
    REMOVE_PAGES: `${API_BASE_URL}/pdf/remove-pages`,
    EXTRACT_PAGES: `${API_BASE_URL}/pdf/extract-pages`,
    TO_IMAGES: `${API_BASE_URL}/convert/pdf-to-jpg`,
    TO_WORD: `${API_BASE_URL}/convert/pdf-to-word`,
    CROP: `${API_BASE_URL}/pdf/crop`,
    // Additional PDF operations
    ORGANIZE: `${API_BASE_URL}/pdf/organize`,
    REVERSE: `${API_BASE_URL}/pdf/reverse`,
    DUPLICATE: `${API_BASE_URL}/pdf/duplicate`,
    REPAIR: `${API_BASE_URL}/pdf/repair`,
    REPAIR_ENHANCED: `${API_BASE_URL}/pdf/repair-enhanced`,
    OPTIMIZE_IMAGES: `${API_BASE_URL}/pdf/optimize-images`,
    REMOVE_DUPLICATES: `${API_BASE_URL}/pdf/remove-duplicates`,
    FLATTEN: `${API_BASE_URL}/pdf/flatten`,
    PROTECT: `${API_BASE_URL}/pdf/protect`,
    UNLOCK: `${API_BASE_URL}/pdf/unlock`,
    ENCRYPT: `${API_BASE_URL}/pdf/encrypt`,
    DECRYPT: `${API_BASE_URL}/pdf/decrypt`,
    CHECK_ENCRYPTED: `${API_BASE_URL}/pdf/check-encrypted`,
    REDACT: `${API_BASE_URL}/pdf/redact`,
    COMPARE: `${API_BASE_URL}/pdf/compare`,
    OCR: `${API_BASE_URL}/pdf/ocr`,
    GRAYSCALE: `${API_BASE_URL}/pdf/black-white`,
    INFO: `${API_BASE_URL}/pdf/info`,
    METADATA: `${API_BASE_URL}/pdf/metadata`,
  },

  // Conversion Operations
  CONVERT: {
    IMAGES_TO_PDF: `${API_BASE_URL}/convert/images-to-pdf`,
    WORD_TO_PDF: `${API_BASE_URL}/convert/word-to-pdf`,
    PPT_TO_PDF: `${API_BASE_URL}/convert/ppt-to-pdf`,
    EXCEL_TO_PDF: `${API_BASE_URL}/convert/excel-to-pdf`,
    HTML_TO_PDF: `${API_BASE_URL}/convert/html-to-pdf`,
    TEXT_TO_PDF: `${API_BASE_URL}/convert/text-to-pdf`,
    PDF_TO_JPG: `${API_BASE_URL}/convert/pdf-to-jpg`,
    PDF_TO_PNG: `${API_BASE_URL}/convert/pdf-to-png`,
    PDF_TO_WORD: `${API_BASE_URL}/convert/pdf-to-word`,
    PDF_TO_PPT: `${API_BASE_URL}/convert/pdf-to-ppt`,
    PDF_TO_EXCEL: `${API_BASE_URL}/convert/pdf-to-excel`,
    PDF_TO_TEXT: `${API_BASE_URL}/convert/pdf-to-text`,
    PDF_TO_HTML: `${API_BASE_URL}/convert/pdf-to-html`,
  },

  // AI Operations
  AI: {
    SUMMARIZE: `${API_BASE_URL}/ai/summarize`,
    TRANSLATE: `${API_BASE_URL}/ai/translate`,
    CHAT: `${API_BASE_URL}/ai/chat`,
    ANALYZE: `${API_BASE_URL}/ai/analyze`,
    EXTRACT_TASKS: `${API_BASE_URL}/ai/extract-tasks`,
    FILL_FORM: `${API_BASE_URL}/ai/fill-form`,
    EXTRACT_PDF: `${API_BASE_URL}/ai/extract-pdf`,
    ASK_PDF: `${API_BASE_URL}/ai/ask-pdf`,
    EXTRACT_DOCUMENT: `${API_BASE_URL}/ai/extract-document`,
    CHAT_DOCUMENT: `${API_BASE_URL}/ai/chat-document`,
    DEVILS_ADVOCATE: `${API_BASE_URL}/ai/devils-advocate`,
    NARRATIVE_ARC: `${API_BASE_URL}/ai/narrative-arc`,
    HIGHLIGHT: `${API_BASE_URL}/ai/highlight`,
    HIGHLIGHT_SUMMARY: `${API_BASE_URL}/ai/highlight-summary`,
    CONVERT_TO_TASK: `${API_BASE_URL}/ai/convert-to-task`,
    EXPLAIN: `${API_BASE_URL}/ai/explain`,
    QUIZ: `${API_BASE_URL}/ai/quiz`,
    OCR_SCAN: `${API_BASE_URL}/ai/ocr-scan`,
  },

  // Document Operations
  DOCUMENT: {
    CREATE: `${API_BASE_URL}/document/create`,
    LIST: `${API_BASE_URL}/document/list`,
    GET: `${API_BASE_URL}/document/get`,
    FILE: `${API_BASE_URL}/document/file`,
    DELETE: `${API_BASE_URL}/document/delete`,
    UPDATE: `${API_BASE_URL}/document/update`,
    // Reflow endpoints removed: Mobile View is generated fully on-device by
    // services/documentReflowService.ts (bundled pdf.js / Mammoth).
    EXTRACT_TEXT: `${API_BASE_URL}/document/extract-text`,
  },

  // Signing Operations
  SIGNING: {
    VISUAL: `${API_BASE_URL}/signing/visual`,
    DIGITAL: `${API_BASE_URL}/signing/digital`,
    VERIFY: `${API_BASE_URL}/signing/verify`,
    CERT_INFO: `${API_BASE_URL}/signing/cert-info`,
  },

  // New Tools
  TOOLS: {
    EXTRACT_IMAGES: `${API_BASE_URL}/extract-images`,
    BATCH_COMPRESS: `${API_BASE_URL}/batch-compress`,
    FIND_REPLACE: `${API_BASE_URL}/find-replace`,
    FIND_REPLACE_PREVIEW: `${API_BASE_URL}/find-replace/preview`,
    QRCODE: `${API_BASE_URL}/qrcode`,
    QRCODE_PREVIEW: `${API_BASE_URL}/qrcode/preview`,
    HEADER_FOOTER: `${API_BASE_URL}/header-footer`,
    HIGHLIGHT_EXPORT: `${API_BASE_URL}/highlight-export`,
    CITATIONS_EXTRACT: `${API_BASE_URL}/citations/extract`,
    CITATIONS_FORMAT: `${API_BASE_URL}/citations/format`,
  },

  // GozlinScientia
  SCIENTIFIC_CALC: {
    CALCULATE: `${API_BASE_URL}/scientific-calc/calculate`,
    SUGGESTIONS: `${API_BASE_URL}/scientific-calc/suggestions`,
  },

  // Health check
  HEALTH: `${API_BASE_URL.replace("/api", "")}/health`,
};

// ─── Failover engine ─────────────────────────────────────────────────────────

// Response statuses that mean "this backend can't serve the request right now"
// (gateway / unavailable / suspended) → fail over to the next backend.
const FAILOVER_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524]);

/** Indices of the pool, active first, then the rest in priority order. */
function _backendOrder(): number[] {
  const n = BACKEND_BASES.length;
  const order: number[] = [];
  for (let k = 0; k < n; k++) order.push((_activeIndex + k) % n);
  return order;
}

/** Reduce any endpoint (full URL or "/path") to the path AFTER "/api". */
function _toApiPath(input: string): string {
  let path = input;
  const m = input.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (m) path = m[1] || "/";
  // Drop a single leading "/api" segment — each base re-adds its own.
  path = path.replace(/^\/api(?=\/|$)/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

export interface ResilientFetchOptions {
  /** Per-attempt timeout in ms (each backend gets a fresh timeout). */
  timeoutMs?: number;
  /** Response statuses that should trigger failover (default: gateway 5xx). */
  retryStatuses?: Set<number>;
}

/**
 * fetch() with automatic backend failover — the "backup generator".
 *
 * The host in `input` is ignored: the request is re-targeted to the ACTIVE
 * backend and, on a network error or a failover status, to each remaining
 * backend in priority order. The first backend that responds becomes the new
 * active backend (sticky + persisted), so the rest of the app follows it.
 *
 * Cancellation: pass an AbortSignal via `init.signal`. A caller-initiated abort
 * cancels WITHOUT failover; only per-attempt timeouts (opts.timeoutMs) and
 * network/gateway failures trigger failover.
 */
export async function resilientFetch(
  input: string,
  init: RequestInit = {},
  opts: ResilientFetchOptions = {},
): Promise<Response> {
  const path = _toApiPath(input);
  const order = _backendOrder();
  const retryStatuses = opts.retryStatuses ?? FAILOVER_STATUSES;
  const callerSignal = init.signal as AbortSignal | null | undefined;
  let lastErr: unknown;

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const url = `${BACKEND_BASES[idx]}${path}`;
    const isLast = i === order.length - 1;

    // Per-attempt controller, chained to the caller's cancel signal.
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", onCallerAbort);
    }
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => controller.abort(), opts.timeoutMs)
        : null;

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);

      if (!res.ok && retryStatuses.has(res.status) && !isLast) {
        lastErr = new Error(`Backend ${BACKEND_BASES[idx]} → ${res.status}`);
        continue; // unavailable / suspended → try the next backend
      }
      // Reachable backend (any non-failover status, incl. 200/4xx) → adopt it.
      _applyActive(idx);
      _persistActive();
      return res;
    } catch (e) {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      // Caller cancelled → propagate, never fail over.
      if (callerSignal?.aborted) throw e;
      lastErr = e;
      if (isLast) break;
      // Network error / per-attempt timeout → try the next backend.
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("All backends are unavailable. Please try again shortly.");
}

/**
 * Backend failover for native uploads (e.g. expo-file-system `uploadAsync`)
 * that can't go through resilientFetch. `attempt` is called with each backend
 * base in priority order and must perform the upload, returning a result that
 * carries an HTTP `status`. The first backend to respond without a network
 * error / failover status becomes the active backend (sticky + persisted).
 */
export async function resilientUpload<T extends { status: number }>(
  attempt: (baseUrl: string) => Promise<T>,
  opts: { retryStatuses?: Set<number> } = {},
): Promise<T> {
  const order = _backendOrder();
  const retryStatuses = opts.retryStatuses ?? FAILOVER_STATUSES;
  let lastErr: unknown;

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const isLast = i === order.length - 1;
    try {
      const result = await attempt(BACKEND_BASES[idx]);
      if (retryStatuses.has(result.status) && !isLast) {
        lastErr = new Error(`Backend ${BACKEND_BASES[idx]} → ${result.status}`);
        continue; // unavailable / suspended → try the next backend
      }
      _applyActive(idx);
      _persistActive();
      return result;
    } catch (e) {
      lastErr = e;
      if (isLast) break;
      // Network error → try the next backend.
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("All backends are unavailable. Please try again shortly.");
}

// Probes each backend's /health and adopts the first healthy one as active.
// Render free-tier cold starts can take up to ~60s, so we keep cycling the pool
// until one answers or the deadline passes. A suspended/unavailable backend
// (non-OK health) is skipped immediately so we don't waste the budget on it.
export async function wakeUpBackend(
  onStatus?: (msg: string) => void,
  maxWaitMs = 65_000,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    for (const idx of _backendOrder()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const healthUrl = `${BACKEND_BASES[idx].replace(/\/api$/, "")}/health`;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.min(8_000, remaining),
      );
      try {
        // Neutral status — never expose "server" / "backend" wording in UI.
        onStatus?.("Please wait…");
        const res = await fetch(healthUrl, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timer);
        if (res.ok) {
          _applyActive(idx);
          _persistActive();
          return true;
        }
        // Non-OK (e.g. 503 suspended) → move to the next backend right away.
      } catch {
        clearTimeout(timer);
        // Network error → next backend.
      }
    }
    // No backend healthy this pass — brief pause, then retry (covers cold starts).
    const pause = Math.min(2_500, deadline - Date.now());
    if (pause > 0) await new Promise<void>((r) => setTimeout(r, pause));
  }

  return false;
}

// Helper for API calls with error handling, timeout, and backend failover.
export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 30000,
): Promise<T> {
  const response = await resilientFetch(endpoint, options, { timeoutMs });
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

// Helper for file uploads (120s per-attempt timeout) with backend failover.
export async function uploadFile(
  endpoint: string,
  file: any,
  fieldName: string = "file",
  additionalData?: Record<string, any>,
): Promise<Response> {
  const formData = new FormData();

  formData.append(fieldName, {
    uri: file.uri,
    type: file.type || file.mimeType,
    name: file.name || "document",
  } as any);

  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      formData.append(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    });
  }

  // Do NOT set Content-Type manually — fetch auto-generates the multipart
  // boundary. resilientFetch re-targets + fails over across the backend pool.
  const response = await resilientFetch(
    endpoint,
    { method: "POST", body: formData },
    { timeoutMs: 120000 },
  );
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }
  return response;
}
