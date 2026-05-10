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
 * Create (or find) an app folder for every SAF-watched folder, then map each
 * SAF document into the appropriate app folder.
 */
export async function syncSafFoldersToAppFolders(): Promise<void> {
  await db.init();

  const [safFolders, safDocs] = await Promise.all([
    db.getAllFolders(),
    db.getAllDocuments(),
  ]);

  if (safFolders.length === 0 || safDocs.length === 0) return;

  const appFolders = await getAllFolders();
  // Map: SAF displayName → app Folder id
  const nameToAppFolderId: Record<string, string> = {};

  for (const safFolder of safFolders) {
    const name = safFolder.displayName;

    // Find existing root-level app folder with the same name
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

    nameToAppFolderId[name] = appFolder.id;
  }

  // Group files that need to be (re)mapped
  const currentMap = await getFileFolderMap();
  const toAssign: Record<string, string[]> = {}; // targetFolderId → fileIds

  for (const doc of safDocs) {
    const fileId = `saf:${doc.uri}`;
    const targetFolderId = nameToAppFolderId[doc.folder];
    if (!targetFolderId) continue;

    // Only update if not already correctly mapped
    if (currentMap[fileId] !== targetFolderId) {
      (toAssign[targetFolderId] ??= []).push(fileId);
    }
  }

  // Batch-move files into their app folders
  for (const [folderId, fileIds] of Object.entries(toAssign)) {
    if (fileIds.length > 0) {
      await moveFilesToFolder(fileIds, folderId);
    }
  }
}
