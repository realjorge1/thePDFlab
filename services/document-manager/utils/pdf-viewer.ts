/**
 * PDF Viewer Utility
 * Cross-platform PDF URI normalization and file management
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

// ============================================================================
// CONSTANTS
// ============================================================================
const PDF_CACHE_DIR_NAME = "pdf-viewer-cache";

// ============================================================================
// URI NORMALIZATION
// ============================================================================

/**
 * Normalize PDF URI for the current platform
 * - Web: as-is (pdf.js handles it)
 * - Android content:// : try to mirror to a local file:// so validation can
 *   read bytes; if mirroring fails (e.g. SAF tree-document URIs that throw
 *   EISDIR through expo-file-system), fall back to passing the URI through
 *   directly. react-native-pdf v7's Android renderer uses
 *   ContentResolver.openInputStream() directly, which is a different code
 *   path that succeeds for these URIs.
 */
export async function normalizePdfUri(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    return uri;
  }

  if (uri.startsWith("content://")) {
    try {
      return await copyToLocalStorage(uri);
    } catch (error) {
      console.warn(
        "[PdfViewer] Cache copy failed; passing content:// URI through to renderer:",
        error,
      );
      return uri;
    }
  }

  return uri;
}

/**
 * Copy a file from content:// URI to app-controlled storage
 * Returns the new file:// URI
 * Includes retry logic for Android permission issues
 */
async function copyToLocalStorage(
  contentUri: string,
  retries = 3,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const cacheDir = getPdfCacheDir();
      await ensurePdfCacheDir();

      const fileName = extractFileName(contentUri) || `pdf_${Date.now()}.pdf`;
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const uniqueFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName}`;
      const destUri = `${cacheDir}${uniqueFileName}`;

      // ── Why not FileSystem.copyAsync? ────────────────────────────
      // expo-file-system v19's copyAsync is documented for file:// URIs.
      // When fed a SAF tree-document content:// URI from
      // ExternalStorageDocumentsProvider it produced a ZIP-wrapped output
      // instead of the real PDF bytes (header was PK\x03\x04). Reading
      // through StorageAccessFramework.readAsStringAsync({encoding:Base64})
      // and writing the bytes ourselves preserves the binary faithfully.
      const SAF = (FileSystem as any).StorageAccessFramework;
      let base64: string | null = null;
      if (SAF && typeof SAF.readAsStringAsync === "function") {
        base64 = await SAF.readAsStringAsync(contentUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        // Fallback for environments without SAF helper — readAsStringAsync
        // accepts content:// in most provider cases too.
        base64 = await FileSystem.readAsStringAsync(contentUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      if (!base64) throw new Error("SAF read returned empty content");

      await FileSystem.writeAsStringAsync(destUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const destInfo = await FileSystem.getInfoAsync(destUri);
      if (!destInfo.exists) {
        throw new Error("Copy verification failed: destination file not created");
      }
      const destSize = (destInfo as any).size ?? 0;
      if (destSize <= 0) {
        try {
          await FileSystem.deleteAsync(destUri, { idempotent: true });
        } catch {}
        throw new Error("Copy verification failed: destination file is empty");
      }

      return destUri;
    } catch (error) {
      lastError = error;
      console.warn(
        `[PdfViewer] Copy attempt ${attempt + 1}/${retries} failed for ${contentUri}:`,
        error,
      );
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw new Error(
    `Failed to prepare PDF after ${retries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Get the PDF cache directory URI
 */
function getPdfCacheDir(): string {
  return `${FileSystem.documentDirectory}${PDF_CACHE_DIR_NAME}/`;
}

/**
 * Ensure the PDF cache directory exists
 */
async function ensurePdfCacheDir(): Promise<string> {
  const cacheDir = getPdfCacheDir();
  try {
    const info = await FileSystem.getInfoAsync(cacheDir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      // ✅ Verify it was actually created
      const verifyInfo = await FileSystem.getInfoAsync(cacheDir);
      if (!verifyInfo.exists) {
        throw new Error(
          "Cache directory creation failed - path doesn't exist after creation",
        );
      }
    }
    return cacheDir;
  } catch (error) {
    throw new Error(
      `Failed to initialize PDF cache directory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Extract filename from a URI
 */
function extractFileName(uri: string): string | null {
  try {
    const decoded = decodeURIComponent(uri);
    // Try to get filename from the URI path
    const parts = decoded.split(/[/\\]/);
    const lastPart = parts.pop();
    if (lastPart && lastPart.includes(".")) {
      return lastPart;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a URI points to a PDF file
 */
export function isPdfUri(uri: string): boolean {
  const lowerUri = uri.toLowerCase();
  return (
    lowerUri.endsWith(".pdf") ||
    lowerUri.includes(".pdf?") ||
    lowerUri.includes("application/pdf")
  );
}

/**
 * Clean up cached PDF files (call periodically or on app start)
 */
export async function clearPdfCache(): Promise<void> {
  try {
    const cacheDir = getPdfCacheDir();
    const info = await FileSystem.getInfoAsync(cacheDir);
    if (info.exists) {
      await FileSystem.deleteAsync(cacheDir, { idempotent: true });
    }
  } catch (error) {
    console.error("[PdfViewer] Failed to clear PDF cache:", error);
  }
}

/**
 * Get cached PDF URI if it exists and is still valid
 */
export async function getCachedPdfUri(
  originalUri: string,
): Promise<string | null> {
  try {
    const cacheDir = getPdfCacheDir();
    const info = await FileSystem.getInfoAsync(cacheDir);
    if (!info.exists) return null;

    // For now, we don't maintain a mapping, so return null
    // The caller should use normalizePdfUri which will create a new cache
    return null;
  } catch {
    return null;
  }
}
