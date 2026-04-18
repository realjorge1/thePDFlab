// ============================================================================
// PPTX Render Client
//
// Thin frontend wrapper around the backend /api/pptx endpoints. The backend
// converts the .pptx to PDF (LibreOffice headless), and we download the PDF
// to local cache so react-native-pdf can display it.
//
// Kept deliberately small: no shared imports with the PDF/DOCX/EPUB tooling.
// ============================================================================

import * as FileSystem from "expo-file-system/legacy";

import { API_BASE_URL } from "@/config/api";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PptxRenderResult {
  id: string;
  sizeBytes: number;
  originalName: string | null;
  downloadName: string;
  streamUrl: string;
  downloadUrl: string;
}

export interface RenderedPptxPdf {
  id: string;
  localPdfUri: string;
  sizeBytes: number;
  originalName: string | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

const UPLOAD_TIMEOUT_MS = 180_000; // 3 min — LibreOffice can be slow on cold start
const DOWNLOAD_TIMEOUT_MS = 60_000;

// ── Local dedup cache ───────────────────────────────────────────────────────
// Maps a backend id (file-content hash) to the local PDF uri so that
// reopening the same file skips both the upload and the download.

const localCache = new Map<string, string>();

// ── Helpers ─────��───────────────────────────────────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && (info as any).size > 0;
  } catch {
    return false;
  }
}

// ── Upload PPTX to backend ─────────────────────────────────────────────────

async function postPptxForConversion(
  fileUri: string,
  fileName: string,
): Promise<PptxRenderResult> {
  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: fileName || "presentation.pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  } as any);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/pptx/convert`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text.slice(0, 300);
      // Try to extract the structured error message
      try {
        const json = JSON.parse(text);
        detail = json.details || json.error || detail;
      } catch {
        // not JSON — use raw text
      }
      throw new Error(
        `Server could not convert presentation (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as PptxRenderResult;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Conversion timed out. The server may be starting up — please try again in a moment.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Download rendered PDF to device cache ──────────────────────────────────

async function downloadPdfToCache(
  streamUrlPath: string,
  downloadName: string,
): Promise<string> {
  const safeName = sanitizeName(downloadName || "presentation.pdf");
  const targetUri = `${FileSystem.cacheDirectory}pptx_${Date.now()}_${safeName}`;

  const base = API_BASE_URL.replace(/\/api$/, "");
  const fullUrl = streamUrlPath.startsWith("http")
    ? streamUrlPath
    : `${base}${streamUrlPath}`;

  const result = await FileSystem.downloadAsync(fullUrl, targetUri);
  if (result.status !== 200) {
    throw new Error(`PDF download failed with status ${result.status}`);
  }
  return result.uri;
}

// ── Public API ─────���────────────────────────────────────────────────────────

/**
 * Upload a .pptx to the backend, convert to PDF, download the PDF to local
 * cache, and return a uri the react-native-pdf viewer can consume.
 *
 * Hash-based caching on both backend (skips LibreOffice) and frontend (skips
 * re-download) ensures repeat opens are near-instant.
 */
export async function renderPptxAsPdf(
  fileUri: string,
  fileName: string,
): Promise<RenderedPptxPdf> {
  // ── Validate input ────────────────────────────────────────────
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) throw new Error(`File does not exist: ${fileUri}`);

  // ── Upload & convert ──────────────────────────────────────────
  const conversion = await postPptxForConversion(fileUri, fileName);

  // ── Check local dedup cache ───────────────────────────────────
  const cachedUri = localCache.get(conversion.id);
  if (cachedUri && (await fileExists(cachedUri))) {
    return {
      id: conversion.id,
      localPdfUri: cachedUri,
      sizeBytes: conversion.sizeBytes,
      originalName: conversion.originalName,
    };
  }

  // ── Download PDF to device ────────────────────────────────────
  const localPdfUri = await downloadPdfToCache(
    conversion.streamUrl,
    conversion.downloadName,
  );

  // Cache for future opens of the same file
  localCache.set(conversion.id, localPdfUri);

  return {
    id: conversion.id,
    localPdfUri,
    sizeBytes: conversion.sizeBytes,
    originalName: conversion.originalName,
  };
}

/**
 * Check whether the backend PPTX renderer (LibreOffice) is available.
 */
export async function isPptxRendererAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/pptx/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
