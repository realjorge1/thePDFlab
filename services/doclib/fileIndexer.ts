/**
 * DocLib — Indexing engine.
 *
 * Walks every watched folder via SAF, diffs against the SQLite index by
 * lastModified timestamp, and batch-upserts changed/new files.
 *
 * Ported from picker/FileIndexer.ts (logic-preserving) with imports adjusted to
 * the Expo-backed safBridge / database modules in this folder.
 */

import SAF, { ScannedFile } from "./safBridge";
import db, { DocumentRecord, FolderRecord } from "./database";

export type IndexingStatus =
  | { phase: "idle" }
  | { phase: "scanning"; folder: string; found: number }
  | { phase: "saving"; total: number }
  | {
      phase: "done";
      total: number;
      added: number;
      updated: number;
      skipped: number;
    }
  | { phase: "error"; message: string };

type StatusListener = (status: IndexingStatus) => void;

class FileIndexer {
  private listeners: Set<StatusListener> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isScanning = false;
  private lastStatus: IndexingStatus = { phase: "idle" };

  // ─── Public API ───────────────────────────────────────────────────────────

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    // Replay last known status so freshly-mounted UI is in sync.
    try {
      listener(this.lastStatus);
    } catch {
      /* listener errors are not fatal */
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Full scan: validates permissions, scans every stored folder, batch-upserts
   * new/changed files. Files unchanged since last scan (matched by lastModified)
   * are skipped.
   */
  async runFullScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const folders = await db.getAllFolders();

      if (folders.length === 0) {
        this.emit({ phase: "idle" });
        return;
      }

      const validFolders = await this.filterValidFolders(folders);
      if (validFolders.length === 0) {
        this.emit({
          phase: "error",
          message: "No valid folder permissions found.",
        });
        return;
      }

      const existingMap = await db.getExistingUrisWithModified();
      const allScanned: ScannedFile[] = [];

      for (const folder of validFolders) {
        this.emit({
          phase: "scanning",
          folder: folder.displayName,
          found: allScanned.length,
        });
        try {
          const files = await SAF.scanDirectory(folder.uri);
          allScanned.push(...files);
          this.emit({
            phase: "scanning",
            folder: folder.displayName,
            found: allScanned.length,
          });
        } catch (e: any) {
          console.warn(
            `[FileIndexer] Failed to scan folder ${folder.displayName}:`,
            e,
          );
        }
      }

      this.emit({ phase: "saving", total: allScanned.length });

      const toUpsert: DocumentRecord[] = [];
      let skipped = 0;

      for (const file of allScanned) {
        const existingModified = existingMap.get(file.uri);
        if (
          existingModified !== undefined &&
          existingModified === file.lastModified
        ) {
          skipped++;
          continue;
        }

        toUpsert.push({
          name: file.name,
          uri: file.uri,
          type: file.type as DocumentRecord["type"],
          mimeType: file.mimeType,
          size: file.size,
          lastModified: file.lastModified,
          lastOpened: null,
          readingProgress: 0,
          folder: file.parentFolder,
        });
      }

      const added = toUpsert.filter((d) => !existingMap.has(d.uri)).length;
      const updated = toUpsert.length - added;

      const CHUNK_SIZE = 100;
      for (let i = 0; i < toUpsert.length; i += CHUNK_SIZE) {
        await db.upsertDocumentsBatch(toUpsert.slice(i, i + CHUNK_SIZE));
      }

      this.emit({
        phase: "done",
        total: allScanned.length,
        added,
        updated,
        skipped,
      });
    } catch (e: any) {
      this.emit({
        phase: "error",
        message: e?.message ?? "Unknown error during scan",
      });
    } finally {
      this.isScanning = false;
    }
  }

  /** Debounced background scan — safe to call on app launch. */
  scheduleIncrementalScan(delayMs = 1500): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.runFullScan().catch((e) => {
        console.warn("[FileIndexer] background scan failed:", e);
      });
    }, delayMs);
  }

  /** Add a watched folder and immediately index it. */
  async addFolder(uri: string, displayName: string): Promise<void> {
    const folder: FolderRecord = {
      uri,
      displayName,
      addedAt: Date.now(),
    };
    await db.addFolder(folder);
    await this.runFullScan();
  }

  /** Stop watching a folder and drop all of its indexed documents. */
  async removeFolder(uri: string): Promise<void> {
    try {
      await SAF.releasePermission(uri);
    } catch {
      /* expo SAF has no release; safe to ignore */
    }
    await db.removeFolder(uri);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async filterValidFolders(
    folders: FolderRecord[],
  ): Promise<FolderRecord[]> {
    const results: FolderRecord[] = [];
    for (const folder of folders) {
      const hasPermission = await SAF.checkPermission(folder.uri);
      if (hasPermission) {
        results.push(folder);
      } else {
        console.warn(
          `[FileIndexer] Permission lost for folder: ${folder.displayName}`,
        );
      }
    }
    return results;
  }

  private emit(status: IndexingStatus): void {
    this.lastStatus = status;
    this.listeners.forEach((l) => {
      try {
        l(status);
      } catch (e) {
        console.warn("[FileIndexer] listener error:", e);
      }
    });
  }
}

export const fileIndexer = new FileIndexer();
export default fileIndexer;
