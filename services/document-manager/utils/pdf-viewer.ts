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
 * - Android: Converts content:// URIs to file:// by copying to app storage
 * - Web: Returns the URI as-is (will be handled by pdf.js)
 */
export async function normalizePdfUri(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    // Web: return as-is, pdf.js will handle it
    return uri;
  }

  // Android: handle content:// URIs
  if (uri.startsWith("content://")) {
    return await copyToLocalStorage(uri);
  }

  // Already a file:// URI or local path
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
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const cacheDir = getPdfCacheDir();
      await ensurePdfCacheDir();

      // Extract filename from URI or generate one
      const fileName = extractFileName(contentUri) || `pdf_${Date.now()}.pdf`;
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
      const uniqueFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFileName}`;
      const destUri = `${cacheDir}${uniqueFileName}`;

      // ✅ Check if source file is accessible
      const sourceInfo = await FileSystem.getInfoAsync(contentUri);
      if (!sourceInfo.exists) {
        throw new Error(`Source file not accessible: ${contentUri}`);
      }

      await FileSystem.copyAsync({ from: contentUri, to: destUri });

      // ✅ Verify destination was created
      const destInfo = await FileSystem.getInfoAsync(destUri);
      if (!destInfo.exists) {
        throw new Error(
          "Copy verification failed: destination file not created",
        );
      }

      return destUri;
    } catch (error) {
      console.warn(
        `[PdfViewer] Copy attempt ${attempt + 1}/${retries} failed:`,
        error,
      );
      if (attempt === retries - 1) {
        throw new Error(
          `Failed to prepare PDF after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Wait before retrying (exponential backoff)
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error("Failed to prepare PDF for viewing");
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
