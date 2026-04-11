/**
 * PDF Thumbnail Service
 * Generates and caches thumbnail images for PDF pages
 * Avoids concurrent <Pdf /> rendering which causes native crashes
 */

import * as MD5 from "crypto-js/crypto-js";
import * as FileSystem from "expo-file-system/legacy";

const THUMBNAIL_CACHE_DIR = `${FileSystem.cacheDirectory}pdf-thumbnails/`;
const THUMBNAIL_SIZE = { width: 300, height: 424 }; // A4 aspect ratio

interface ThumbnailCacheEntry {
  uri: string;
  page: number;
  timestamp: number;
  imagePath: string;
}

/**
 * Generate a unique cache key for a PDF page
 */
function generateCacheKey(pdfUri: string, page: number): string {
  const hash = MD5.MD5(`${pdfUri}-page-${page}`).toString();
  return `thumb-${hash}-${page}.jpg`;
}

/**
 * Get the cache file path for a thumbnail
 */
async function getCachePath(pdfUri: string, page: number): Promise<string> {
  const cacheKey = generateCacheKey(pdfUri, page);
  const filePath = `${THUMBNAIL_CACHE_DIR}${cacheKey}`;

  // Ensure cache directory exists
  try {
    const dirInfo = await FileSystem.getInfoAsync(THUMBNAIL_CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(THUMBNAIL_CACHE_DIR, {
        intermediates: true,
      });
    }
  } catch (e) {
    console.warn("[PdfThumbnailService] Failed to create cache dir:", e);
  }

  return filePath;
}

/**
 * Check if a thumbnail is cached and valid
 */
export async function isThumbnailCached(
  pdfUri: string,
  page: number,
): Promise<boolean> {
  try {
    const cachePath = await getCachePath(pdfUri, page);
    const info = await FileSystem.getInfoAsync(cachePath);
    return info.exists && info.size! > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Get cached thumbnail image URI
 */
export async function getCachedThumbnail(
  pdfUri: string,
  page: number,
): Promise<string | null> {
  try {
    if (await isThumbnailCached(pdfUri, page)) {
      const cachePath = await getCachePath(pdfUri, page);
      return `file://${cachePath}`;
    }
    return null;
  } catch (e) {
    console.warn("[PdfThumbnailService] Failed to get cached thumbnail:", e);
    return null;
  }
}

/**
 * Clear all cached thumbnails for a PDF
 */
export async function clearThumbnailCache(pdfUri: string): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(THUMBNAIL_CACHE_DIR);
    if (!dirInfo.exists) return;

    const files = await FileSystem.readDirectoryAsync(THUMBNAIL_CACHE_DIR);
    const pdfHash = MD5.MD5(pdfUri).toString();

    for (const file of files) {
      if (file.includes(pdfHash)) {
        await FileSystem.deleteAsync(`${THUMBNAIL_CACHE_DIR}${file}`);
      }
    }
  } catch (e) {
    console.warn("[PdfThumbnailService] Failed to clear cache:", e);
  }
}

/**
 * Queue a thumbnail for extraction (background task)
 * NOTE: Actual extraction requires a native PDF-to-image converter
 * This is a placeholder that returns placeholder images
 * For production: implement PDFTron, pdf-lib, or native Android PDFRenderer
 */
export async function generateThumbnails(
  pdfUri: string,
  totalPages: number,
  priority: number[] = [1], // Pages to prioritize
): Promise<void> {
  try {
    // Prioritize generation of visible thumbnails
    const pagesToGenerate = [...new Set([...priority])];

    for (const page of pagesToGenerate) {
      if (page < 1 || page > totalPages) continue;

      const alreadyCached = await isThumbnailCached(pdfUri, page);
      if (alreadyCached) continue;

      // NOTE: Implementation requires native PDF extraction capability
      // For now, we use placeholder gray images
      // TODO: Implement actual PDF page extraction
      await generatePlaceholderThumbnail(pdfUri, page);
    }
  } catch (e) {
    console.warn("[PdfThumbnailService] Failed to generate thumbnails:", e);
  }
}

/**
 * Generate a placeholder thumbnail (gray box with page number)
 * Replace this with actual PDF extraction in production
 */
async function generatePlaceholderThumbnail(
  pdfUri: string,
  page: number,
): Promise<void> {
  try {
    const cachePath = await getCachePath(pdfUri, page);

    // In production, this would be replaced with actual PDF page extraction
    // using native methods or a library like react-native-pdf-lib

    // Create a minimal valid JPEG (1x1 gray pixel as placeholder)
    // This is base64 encoded 1x1 gray JPEG for testing
    const placeholderBase64 =
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwwUExMTExMUEhEREhEREhQkFBcTFBsTGBQWGBgTGhscIiEiIyEjMzAxMQAA///z/+zz//+AABEIAAEAAQMBIgADEQERAD/xAAfAAABBQADBQAAAAAAAAAAAAAYAQICAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWm5ygnJ2eoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==";

    const dataUri = `data:image/jpeg;base64,${placeholderBase64}`;
    const base64String = placeholderBase64;

    // Write base64 directly to file
    await FileSystem.writeAsStringAsync(cachePath, base64String, {
      encoding: FileSystem.EncodingType.Base64,
    });

    console.log(`[PdfThumbnailService] Cached placeholder for page ${page}`);
  } catch (e) {
    console.warn(`[PdfThumbnailService] Failed to generate placeholder: ${e}`);
  }
}

/**
 * Preload visible thumbnails for a PDF grid
 * Call this when the thumbnail grid becomes visible
 */
export async function preloadVisibleThumbnails(
  pdfUri: string,
  totalPages: number,
  visibleRange: { start: number; end: number },
): Promise<void> {
  const visiblePages = [];
  for (
    let i = visibleRange.start;
    i <= visibleRange.end && i <= totalPages;
    i++
  ) {
    visiblePages.push(i);
  }

  // Generate in background without awaiting
  generateThumbnails(pdfUri, totalPages, visiblePages).catch((e) =>
    console.warn("[PdfThumbnailService] Background preload failed:", e),
  );
}

export default {
  isThumbnailCached,
  getCachedThumbnail,
  clearThumbnailCache,
  generateThumbnails,
  preloadVisibleThumbnails,
};
