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

import { API_BASE_URL } from "@/config/api";
import type { PptxRenderServerResult } from "../types/pptxViewer";

const UPLOAD_TIMEOUT_MS = 180_000; // 3 min — LibreOffice cold start can be slow
const DOWNLOAD_TIMEOUT_MS = 60_000;

export type RenderProgress =
  | { stage: "uploading" }
  | { stage: "rendering" }
  | { stage: "downloading" };

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  // No native upload-progress event on fetch in RN. Emit "uploading" now,
  // then flip to "rendering" after a short grace so the UX reflects what
  // LibreOffice is actually doing during the request's long tail.
  onProgress?.({ stage: "uploading" });
  const renderTimer = setTimeout(
    () => onProgress?.({ stage: "rendering" }),
    2500,
  );

  try {
    const response = await fetch(`${API_BASE_URL}/pptx/convert`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text.slice(0, 300);
      try {
        const json = JSON.parse(text);
        detail = json.details || json.error || detail;
      } catch {
        // not JSON
      }
      throw new Error(
        `Server could not convert presentation (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as PptxRenderServerResult;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Conversion timed out. The server may be starting up — please try again in a moment.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
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
      throw new Error(`PDF download failed with status ${result.status}`);
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
  const server = await postPptxForConversion(fileUri, fileName, onProgress);
  const localPdfUri = await downloadPdfToCache(
    server.streamUrl,
    server.downloadName,
    onProgress,
  );
  return { server, localPdfUri };
}

/**
 * Health check against the backend LibreOffice renderer.
 */
export async function isPptxRendererAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${API_BASE_URL}/pptx/health`, {
        method: "GET",
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
