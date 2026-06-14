/**
 * Sync SAF-indexed folders (doclib) → app Folders screen.
 *
 * When the user grants access to a device folder, this ensures a matching
 * top-level folder appears in the app's Folders screen and all scanned files
 * from that device folder are automatically grouped inside it.
 *
 * Idempotent — safe to call on every focus/refresh.
 */

import db from "@/services/doclib/database";
import {
  FOLDER_COLORS,
  createFolder,
  getAllFolders,
  getFileFolderMap,
  moveFilesToFolder,
} from "@/services/folderService";

/**
 * For display: strip any path prefix and return only the file name.
 * Handles both forward-slash and backslash separators.
 */
export function cleanFileName(name: string): string {
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] || name;
}

/**
 * Stable identity for a SAF folder: the decoded "tree" id shared by the folder
 * URI and every document URI scanned beneath it.
 *
 * Document URIs look like `content://auth/tree/{treeId}/document/{docId}` while
 * the granted folder URI is `content://auth/tree/{treeId}` — so a document
 * belongs to the folder whose tree id matches the portion before `/document/`.
 *
 * Matching on this key (instead of the display name) is immune to two real
 * failure modes: two device folders sharing a name, and the folder picker vs.
 * the scanner percent-encoding the same path slightly differently.
 */
function safTreeKey(uri: string): string | null {
  if (!uri || !uri.startsWith("content://")) return null;
  const treeIdx = uri.indexOf("/tree/");
  if (treeIdx === -1) return null;
  const afterTree = uri.slice(treeIdx + 6);
  const docIdx = afterTree.indexOf("/document/");
  const treeId = docIdx === -1 ? afterTree : afterTree.slice(0, docIdx);
  try {
    return decodeURIComponent(treeId);
  } catch {
    return treeId;
  }
}

/**
 * Create (or find) an app folder for every SAF-watched folder that has indexed
 * files, then map each scanned document into the appropriate app folder.
 *
 * A folder is only surfaced once it actually owns at least one indexed file —
 * this prevents the "auto-created folder is empty" symptom when a scan has not
 * yet captured the folder's files.
 */
export async function syncSafFoldersToAppFolders(): Promise<void> {
  await db.init();

  const [safFolders, safDocs] = await Promise.all([
    db.getAllFolders(),
    db.getAllDocuments(),
  ]);

  if (safFolders.length === 0 || safDocs.length === 0) return;

  // Build lookup tables to resolve each doc back to its owning SAF folder.
  // Primary key is the tree URI; display name is a fallback for any legacy
  // records whose URI predates the tree-key scheme.
  const treeKeyToFolderUri: Record<string, string> = {};
  const nameToFolderUri: Record<string, string> = {};
  for (const f of safFolders) {
    const key = safTreeKey(f.uri);
    if (key) treeKeyToFolderUri[key] = f.uri;
    nameToFolderUri[f.displayName] = f.uri;
  }

  // Group every scanned document under the folder URI that owns it.
  const fileIdsByFolderUri: Record<string, string[]> = {};
  for (const doc of safDocs) {
    const key = safTreeKey(doc.uri);
    const ownerUri =
      (key ? treeKeyToFolderUri[key] : undefined) ?? nameToFolderUri[doc.folder];
    if (!ownerUri) continue;
    (fileIdsByFolderUri[ownerUri] ??= []).push(`saf:${doc.uri}`);
  }

  const appFolders = await getAllFolders();
  const currentMap = await getFileFolderMap();
  const toAssign: Record<string, string[]> = {}; // appFolderId → fileIds

  for (const safFolder of safFolders) {
    const fileIds = fileIdsByFolderUri[safFolder.uri];
    if (!fileIds || fileIds.length === 0) continue;

    const name = safFolder.displayName;

    // Find existing root-level app folder with the same name, else create one.
    let appFolder = appFolders.find(
      (f) => f.parentId === null && f.name === name,
    );

    if (!appFolder) {
      // Deterministically pick a color by hashing the folder name so the same
      // folder always gets the same color on re-creation.
      const colorIndex =
        Math.abs(
          name.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0),
        ) % FOLDER_COLORS.length;
      appFolder = await createFolder(name, null, FOLDER_COLORS[colorIndex]);
      appFolders.push(appFolder);
    }

    // Map this folder's files into it (only those not already correctly mapped).
    for (const fileId of fileIds) {
      if (currentMap[fileId] !== appFolder.id) {
        (toAssign[appFolder.id] ??= []).push(fileId);
      }
    }
  }

  // Batch-move files into their app folders.
  for (const [folderId, fileIds] of Object.entries(toAssign)) {
    if (fileIds.length > 0) {
      await moveFilesToFolder(fileIds, folderId);
    }
  }
}
