/**
 * DocLib — SAF (Storage Access Framework) Bridge
 *
 * Wraps Expo's StorageAccessFramework + IntentLauncher to provide:
 *  - User-initiated folder selection with persistable URI permission
 *  - Recursive directory scanning that filters supported document types
 *  - External file open via ACTION_VIEW
 *
 * No MANAGE_EXTERNAL_STORAGE / READ_EXTERNAL_STORAGE — fully Play-compliant.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentType = "pdf" | "docx" | "pptx" | "xlsx" | "unknown";

export interface ScannedFile {
  name: string;
  uri: string;
  mimeType: string;
  size: number;
  lastModified: number;
  type: DocumentType;
  parentFolder: string;
}

export interface FolderSelection {
  uri: string;
  displayName: string;
}

// ─── Supported file types ─────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "xlsx",
  "xls",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

const MAX_RECURSION_DEPTH = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function getDocumentType(name: string, mimeType?: string): DocumentType {
  const ext = extractExtension(name);
  const mime = (mimeType ?? "").toLowerCase();

  if (ext === "pdf" || mime.includes("pdf")) return "pdf";
  if (ext === "docx" || ext === "doc" || mime.includes("wordprocessingml") || mime.includes("msword")) return "docx";
  if (ext === "pptx" || ext === "ppt" || mime.includes("presentationml") || mime.includes("powerpoint")) return "pptx";
  if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheetml") || mime.includes("ms-excel")) return "xlsx";
  return "unknown";
}

function isSupportedFile(name: string, mimeType?: string): boolean {
  const ext = extractExtension(name);
  if (SUPPORTED_EXTENSIONS.has(ext)) return true;
  if (!mimeType) return false;
  const mime = mimeType.toLowerCase();
  return (
    mime.includes("pdf") ||
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    mime.includes("presentationml") ||
    mime.includes("powerpoint") ||
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel")
  );
}

/**
 * Re-encode a SAF document URI to canonical percent-encoded form.
 *
 * expo-file-system's readDirectoryAsync returns child URIs with the document-ID
 * segment in decoded form (literal ':', '/', spaces, etc.) — e.g.:
 *   .../tree/primary:documents/document/primary:documents/My File.pdf
 *
 * Android's ContentResolver splits on literal '/' inside the document-ID path
 * segment, so it resolves to a directory instead of a file → EISDIR.
 * Properly encoding the tree and document segments with encodeURIComponent fixes
 * this; Android's Uri.parse() then decodes %2F within a segment without treating
 * it as a path separator.
 */
function reEncodeSafDocumentUri(uri: string): string {
  if (!uri.startsWith("content://")) return uri;
  const treeIdx = uri.indexOf("/tree/");
  const docIdx  = uri.indexOf("/document/");
  if (treeIdx === -1 || docIdx === -1 || docIdx <= treeIdx) return uri;
  const authority = uri.slice(0, treeIdx);
  const treeId    = uri.slice(treeIdx + 6, docIdx);
  const docId     = uri.slice(docIdx + 10);
  try {
    return (
      `${authority}/tree/${encodeURIComponent(decodeURIComponent(treeId))}` +
      `/document/${encodeURIComponent(decodeURIComponent(docId))}`
    );
  } catch {
    return uri;
  }
}

/** Decode the trailing display segment of a SAF URI, returning only the file name. */
function decodeNameFromUri(uri: string): string {
  try {
    // SAF child URIs end with the document id; we want the segment after the last
    // colon or slash, decoded.
    const last = uri.split("/").pop() || "";
    const decoded = decodeURIComponent(last);
    let name = decoded;
    if (decoded.includes(":")) {
      // e.g. "primary:Download/foo/William Shakespeare.pdf" → "Download/foo/William Shakespeare.pdf"
      const parts = decoded.split(":");
      name = parts[parts.length - 1] || decoded;
    }
    // Strip any subdirectory prefix — keep only the actual file name
    const segments = name.split("/");
    return segments[segments.length - 1] || name;
  } catch {
    return uri;
  }
}

/** Best-effort display name extraction for the picked folder root. */
function deriveFolderDisplayName(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    if (decoded.includes(":")) {
      const tail = decoded.split(":").pop() || "";
      const segments = tail.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) return last;
    }
    const parts = decoded.split("/").filter(Boolean);
    return parts[parts.length - 1] || "Selected Folder";
  } catch {
    return "Selected Folder";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

class SAFBridge {
  /**
   * Open the system folder picker. Returns the granted folder URI + display name.
   * Throws { code: "CANCELLED" } when the user backs out.
   */
  async selectFolder(): Promise<FolderSelection> {
    if (Platform.OS !== "android") {
      const err = new Error("Folder picking is only supported on Android.");
      (err as any).code = "PLATFORM_NOT_SUPPORTED";
      throw err;
    }

    const result =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

    if (!result.granted) {
      const err = new Error("CANCELLED: User cancelled folder selection");
      (err as any).code = "CANCELLED";
      throw err;
    }

    return {
      uri: result.directoryUri,
      displayName: deriveFolderDisplayName(result.directoryUri),
    };
  }

  /**
   * Recursively scan a SAF tree URI. Returns only supported document files.
   * Depth-limited to prevent runaway scans.
   */
  async scanDirectory(treeUri: string): Promise<ScannedFile[]> {
    if (Platform.OS !== "android") return [];

    const parentDisplay = deriveFolderDisplayName(treeUri);
    const out: ScannedFile[] = [];
    await this.scanRecursive(treeUri, parentDisplay, out, 0);
    return out;
  }

  /**
   * Verify the persisted folder permission is still active.
   * StorageAccessFramework does not expose a direct check, so we fall back to
   * attempting a directory read — a permission revocation surfaces as a thrown
   * error, which we treat as "no permission".
   */
  async checkPermission(treeUri: string): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    try {
      await FileSystem.StorageAccessFramework.readDirectoryAsync(treeUri);
      return true;
    } catch (e: any) {
      if (__DEV__) {
        console.warn(
          "[SAFBridge] checkPermission failed for",
          treeUri,
          e?.message,
        );
      }
      return false;
    }
  }

  /**
   * Expo's SAF does not expose a public release API.
   * This is a no-op so the index can still be cleaned client-side.
   * Users can revoke explicitly via Android Settings → Privacy → Permission manager.
   */
  async releasePermission(_treeUri: string): Promise<void> {
    return;
  }

  /**
   * Open a file via Android's chooser. The viewer/system app handles the
   * actual content read using the SAF URI we already hold permission for.
   */
  async openFile(uri: string, mimeType: string): Promise<void> {
    if (Platform.OS !== "android") {
      const err = new Error("File open is only supported on Android.");
      (err as any).code = "PLATFORM_NOT_SUPPORTED";
      throw err;
    }

    const resolvedMime =
      mimeType || MIME_BY_EXTENSION[extractExtension(decodeNameFromUri(uri))] ||
      "application/octet-stream";

    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: uri,
      type: resolvedMime,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async scanRecursive(
    folderUri: string,
    parentDisplay: string,
    out: ScannedFile[],
    depth: number,
  ): Promise<void> {
    if (depth > MAX_RECURSION_DEPTH) return;

    let childUris: string[] = [];
    try {
      childUris =
        await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
    } catch (e) {
      if (__DEV__) {
        console.warn("[SAFBridge] readDirectory failed:", folderUri, e);
      }
      return;
    }

    for (const childUri of childUris) {
      let info: any = null;
      try {
        info = await FileSystem.getInfoAsync(childUri);
      } catch {
        // Skip entries we can't stat
        continue;
      }
      if (!info?.exists) continue;

      const name = decodeNameFromUri(childUri);

      if (info.isDirectory) {
        await this.scanRecursive(childUri, parentDisplay, out, depth + 1);
        continue;
      }

      // Some providers won't expose mime via getInfoAsync; fall back to ext.
      const inferredMime =
        MIME_BY_EXTENSION[extractExtension(name)] ?? "";

      if (!isSupportedFile(name, inferredMime)) continue;

      out.push({
        name,
        uri: reEncodeSafDocumentUri(childUri),
        mimeType: inferredMime,
        size: typeof info.size === "number" ? info.size : 0,
        lastModified:
          typeof info.modificationTime === "number"
            ? Math.floor(info.modificationTime * 1000) // SAF returns seconds
            : Date.now(),
        type: getDocumentType(name, inferredMime),
        parentFolder: parentDisplay,
      });
    }
  }
}

export const SAF = new SAFBridge();
export default SAF;
