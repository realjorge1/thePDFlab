import Constants from "expo-constants";

// API URL resolution order:
//   1. EXPO_PUBLIC_API_URL — set per-profile in eas.json or .env (recommended
//      for production builds; e.g. "https://your-app.onrender.com/api").
//   2. app.json → expo.extra.apiUrl — LAN address for on-device dev.
//   3. http://localhost:5000/api — Hermes/web fallback for local emulators.
//
// IMPORTANT: cleartext (HTTP) traffic is only permitted to the hosts listed
// in android/app/src/main/res/xml/network_security_config.xml. If you point
// the LAN URL at a new IP, add it there or release builds will silently fail
// with "Network request failed".
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiUrl ||
  "http://localhost:5000/api";

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
    CLASSIFY: `${API_BASE_URL}/ai/classify`,
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
    PDF_REFLOW: `${API_BASE_URL}/document/pdf-reflow`,
    DOCX_REFLOW: `${API_BASE_URL}/document/docx-reflow`,
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

export const BACKEND_BASE = API_BASE_URL.replace("/api", "");
export const HEALTH_URL = `${BACKEND_BASE}/health`;

// Render free-tier cold starts can take up to 60s.
// We poll /health with short individual timeouts rather than one long request,
// so the OS can surface network errors quickly between attempts.
export async function wakeUpBackend(
  onStatus?: (msg: string) => void,
  maxWaitMs = 65_000,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutMs = Math.min(10_000, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Neutral status — never expose "server" / "backend" wording in UI.
      onStatus?.("Please wait…");

      const res = await fetch(HEALTH_URL, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);

      if (res.ok) {
        return true;
      }
    } catch {
      clearTimeout(timer);
    }

    // Short pause before retry
    const retryDelay = Math.min(3_000, deadline - Date.now());
    if (retryDelay > 0) {
      await new Promise<void>((r) => setTimeout(r, retryDelay));
    }
  }

  return false;
}

// Helper function for API calls with error handling and timeout
export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 30000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      ...options,
      signal: controller.signal,
      headers: {
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${endpoint} timed out after ${timeoutMs}ms`);
    }
    console.error(`API call failed to ${endpoint}:`, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Helper for file uploads (with 120s timeout for large files)
export async function uploadFile(
  endpoint: string,
  file: any,
  fieldName: string = "file",
  additionalData?: Record<string, any>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

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

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      // Do NOT set Content-Type manually — fetch auto-generates it with the correct boundary
    });

    if (!response.ok) {
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText}`,
      );
    }

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Upload to ${endpoint} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
