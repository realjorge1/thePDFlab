// ============================================================================
// PPTX Render Client — feature-local
//
// Uploads the .pptx to the backend (/api/pptx/convert), downloads the rendered
// PDF to the device, and surfaces granular progress callbacks so the UI can
// show staged feedback (preparing → uploading → rendering → downloading).
//
// Kept fully self-contained inside this feature folder. Only shared import is
// the project-wide API_BASE_URL constant.
// ============================================================================

import * as FileSystem from "expo-file-system/legacy";

import { API_BASE_URL, resilientFetch } from "@/config/api";
import type { PptxRenderServerResult } from "../types/pptxViewer";

const UPLOAD_TIMEOUT_MS = 180_000; // 3 min — covers cold start + serialized queue
const DOWNLOAD_TIMEOUT_MS = 60_000;

export type RenderProgress =
  | { stage: "uploading" }
  | { stage: "rendering" }
  | { stage: "downloading" };

// Server error body: { error, code, details, hint? }. Codes:
//   503 ENGINE_UNAVAILABLE — renderer down; 503 CONVERSION_FAILED — this deck
//   failed or timed out; 400 INVALID_INPUT — bad extension / empty / >100 MB.
// The server never silently degrades to a text-only PDF anymore.
export type PptxErrorCode =
  | "ENGINE_UNAVAILABLE"
  | "CONVERSION_FAILED"
  | "INVALID_INPUT"
  | string;

export class PptxConversionError extends Error {
  status: number;
  code?: PptxErrorCode;
  hint?: string;

  constructor(
    message: string,
    status: number,
    code?: PptxErrorCode,
    hint?: string,
  ) {
    super(message);
    this.name = "PptxConversionError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ── POST /api/pptx/convert ──────────────────────────────────────────────────

async function postPptxForConversion(
  fileUri: string,
  fileName: string,
  onProgress?: (p: RenderProgress) => void,
): Promise<PptxRenderServerResult> {
  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: fileName || "presentation.pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  } as any);

  // No native upload-progress event on fetch in RN. Emit "uploading" now,
  // then flip to "rendering" after a short grace so the UX reflects what
  // LibreOffice is actually doing during the request's long tail.
  onProgress?.({ stage: "uploading" });
  const renderTimer = setTimeout(
    () => onProgress?.({ stage: "rendering" }),
    2500,
  );

  try {
    // resilientFetch fails over across the backend pool (UPLOAD_TIMEOUT_MS per
    // attempt); the PDF download below then targets the same active backend.
    const response = await resilientFetch(
      `${API_BASE_URL}/pptx/convert`,
      { method: "POST", body: form },
      { timeoutMs: UPLOAD_TIMEOUT_MS },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: {
        error?: string;
        code?: string;
        details?: string;
        hint?: string;
      } = {};
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON
      }

      let message: string;
      if (response.status === 503) {
        message =
          body.code === "CONVERSION_FAILED"
            ? "This presentation could not be converted right now. Please try again later."
            : "Presentation conversion is temporarily unavailable. Please try again later.";
      } else if (response.status === 400) {
        message =
          body.details ||
          body.error ||
          "This file can't be converted. Use a .pptx or .ppt file under 100 MB.";
      } else {
        const detail = body.details || body.error || text.slice(0, 300);
        message = `Could not convert presentation (${response.status})${
          detail ? `: ${detail}` : ""
        }`;
      }
      throw new PptxConversionError(
        message,
        response.status,
        body.code,
        body.hint,
      );
    }

    return (await response.json()) as PptxRenderServerResult;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Conversion timed out. Please try again in a moment.",
      );
    }
    throw err;
  } finally {
    clearTimeout(renderTimer);
  }
}

// ── Download PDF ────────────────────────────────────────────────────────────

export async function downloadPdfToCache(
  streamUrlPath: string,
  downloadName: string,
  onProgress?: (p: RenderProgress) => void,
): Promise<string> {
  onProgress?.({ stage: "downloading" });

  const safeName = sanitize(downloadName || "presentation.pdf");
  const targetUri = `${FileSystem.cacheDirectory}pptx_dl_${Date.now()}_${safeName}`;

  const base = API_BASE_URL.replace(/\/api$/, "");
  const fullUrl = streamUrlPath.startsWith("http")
    ? streamUrlPath
    : `${base}${streamUrlPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const result = await FileSystem.downloadAsync(fullUrl, targetUri);
    if (result.status !== 200) {
      throw new PptxConversionError(
        `PDF download failed with status ${result.status}`,
        result.status,
      );
    }
    return result.uri;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload → convert → download. Emits staged progress. Callers (hooks) layer
 * caching and retry on top of this primitive.
 */
export async function uploadConvertAndDownload(
  fileUri: string,
  fileName: string,
  onProgress?: (p: RenderProgress) => void,
): Promise<{ server: PptxRenderServerResult; localPdfUri: string }> {
  let server = await postPptxForConversion(fileUri, fileName, onProgress);
  try {
    const localPdfUri = await downloadPdfToCache(
      server.streamUrl,
      server.downloadName,
      onProgress,
    );
    return { server, localPdfUri };
  } catch (err) {
    // 404 on the stream URL means the rendered output expired server-side
    // (outputs are kept ~1 hour). Re-convert once — uploads are cached by
    // file hash, so this is cheap — and retry the download.
    if (err instanceof PptxConversionError && err.status === 404) {
      server = await postPptxForConversion(fileUri, fileName, onProgress);
      const localPdfUri = await downloadPdfToCache(
        server.streamUrl,
        server.downloadName,
        onProgress,
      );
      return { server, localPdfUri };
    }
    throw err;
  }
}

/**
 * Health check against the backend LibreOffice renderer.
 *
 * Gate on `ok` (true only when the body reports status === "ok"). `engine`
 * carries the renderer version (e.g. "LibreOffice 7.4.7.2") for diagnostics.
 * Doubles as a warm-up ping for the renderer on Render's free tier.
 */
export interface PptxRendererHealth {
  ok: boolean;
  engine?: string;
}

export async function getPptxRendererHealth(
  timeoutMs = 8000,
): Promise<PptxRendererHealth> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE_URL}/pptx/health`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false };
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        engine?: string;
      } | null;
      return { ok: body?.status === "ok", engine: body?.engine };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false };
  }
}

export async function isPptxRendererAvailable(): Promise<boolean> {
  return (await getPptxRendererHealth()).ok;
}
