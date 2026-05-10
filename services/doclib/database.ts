import * as FileSystem from "expo-file-system/legacy";

export type DocumentType = "pdf" | "docx" | "pptx" | "xlsx" | "unknown";

// Mirrors the same helper in safBridge — kept inline to avoid a circular import.
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

export interface DocumentRecord {
  id?: number;
  name: string;
  uri: string;
  type: DocumentType;
  mimeType: string;
  size: number;
  lastModified: number;
  lastOpened: number | null;
  readingProgress: number;
  folder: string;
}

export interface FolderRecord {
  id?: number;
  uri: string;
  displayName: string;
  addedAt: number;
}

const BASE = FileSystem.documentDirectory ?? "";
const DOCS_FILE = BASE + "doclib_documents.json";
const FOLDERS_FILE = BASE + "doclib_folders.json";

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return fallback;
    const text = await FileSystem.readAsStringAsync(path);
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data), {
    encoding: "utf8",
  });
}

class DatabaseService {
  private docs: DocumentRecord[] = [];
  private folders: FolderRecord[] = [];
  private ready = false;
  private nextId = 1;

  async init(): Promise<void> {
    if (this.ready) return;
    [this.docs, this.folders] = await Promise.all([
      readJSON<DocumentRecord[]>(DOCS_FILE, []),
      readJSON<FolderRecord[]>(FOLDERS_FILE, []),
    ]);
    this.nextId =
      Math.max(
        0,
        ...this.docs.map((d) => d.id ?? 0),
        ...this.folders.map((f) => f.id ?? 0),
      ) + 1;

    // One-time migration: re-encode SAF URIs that were persisted in decoded form.
    let migrated = false;
    for (const doc of this.docs) {
      const fixed = reEncodeSafDocumentUri(doc.uri);
      if (fixed !== doc.uri) {
        doc.uri = fixed;
        migrated = true;
      }
    }
    if (migrated) {
      await writeJSON(DOCS_FILE, this.docs);
    }

    this.ready = true;
  }

  private requireReady(): void {
    if (!this.ready)
      throw new Error("DocLib database not initialized. Call init() first.");
  }

  private persistDocs(): void {
    writeJSON(DOCS_FILE, this.docs).catch(console.error);
  }

  private persistFolders(): void {
    writeJSON(FOLDERS_FILE, this.folders).catch(console.error);
  }

  // ─── Document operations ────────────────────────────────────────────────────

  async upsertDocument(doc: DocumentRecord): Promise<void> {
    this.requireReady();
    const idx = this.docs.findIndex((d) => d.uri === doc.uri);
    if (idx >= 0) {
      const existing = this.docs[idx];
      this.docs[idx] = {
        ...existing,
        name: doc.name,
        type: doc.type,
        mimeType: doc.mimeType,
        size: doc.size,
        lastModified: doc.lastModified,
        folder: doc.folder,
      };
    } else {
      this.docs.push({ ...doc, id: this.nextId++ });
    }
    this.persistDocs();
  }

  async upsertDocumentsBatch(docs: DocumentRecord[]): Promise<void> {
    if (docs.length === 0) return;
    this.requireReady();
    const map = new Map(this.docs.map((d) => [d.uri, d]));
    for (const doc of docs) {
      const existing = map.get(doc.uri);
      if (existing) {
        map.set(doc.uri, {
          ...existing,
          name: doc.name,
          type: doc.type,
          mimeType: doc.mimeType,
          size: doc.size,
          lastModified: doc.lastModified,
          folder: doc.folder,
        });
      } else {
        map.set(doc.uri, { ...doc, id: this.nextId++ });
      }
    }
    this.docs = Array.from(map.values());
    this.persistDocs();
  }

  async updateLastOpened(uri: string): Promise<void> {
    this.requireReady();
    const doc = this.docs.find((d) => d.uri === uri);
    if (doc) {
      doc.lastOpened = Date.now();
      this.persistDocs();
    }
  }

  async updateReadingProgress(uri: string, progress: number): Promise<void> {
    this.requireReady();
    const doc = this.docs.find((d) => d.uri === uri);
    if (doc) {
      doc.readingProgress = Math.max(0, Math.min(1, progress));
      this.persistDocs();
    }
  }

  async getAllDocuments(type?: string): Promise<DocumentRecord[]> {
    this.requireReady();
    const filtered =
      type && type !== "all"
        ? this.docs.filter((d) => d.type === type)
        : this.docs;
    return [...filtered].sort((a, b) => b.lastModified - a.lastModified);
  }

  async getRecentDocuments(limit = 10): Promise<DocumentRecord[]> {
    this.requireReady();
    return this.docs
      .filter((d) => d.lastOpened != null)
      .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
      .slice(0, limit);
  }

  async searchDocuments(query: string): Promise<DocumentRecord[]> {
    this.requireReady();
    const q = query.toLowerCase();
    return this.docs
      .filter((d) => d.name.toLowerCase().includes(q))
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 100);
  }

  async getDocumentByUri(uri: string): Promise<DocumentRecord | null> {
    this.requireReady();
    return this.docs.find((d) => d.uri === uri) ?? null;
  }

  async getExistingUrisWithModified(): Promise<Map<string, number>> {
    this.requireReady();
    return new Map(this.docs.map((d) => [d.uri, d.lastModified]));
  }

  async deleteDocumentsByFolder(folderUri: string): Promise<void> {
    this.requireReady();
    this.docs = this.docs.filter((d) => d.folder !== folderUri);
    this.persistDocs();
  }

  async removeDocument(uri: string): Promise<void> {
    this.requireReady();
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => d.uri !== uri);
    if (this.docs.length !== before) this.persistDocs();
  }

  async getDocumentCount(type?: string): Promise<number> {
    this.requireReady();
    if (type && type !== "all") {
      return this.docs.filter((d) => d.type === type).length;
    }
    return this.docs.length;
  }

  // ─── Folder operations ──────────────────────────────────────────────────────

  async addFolder(folder: FolderRecord): Promise<void> {
    this.requireReady();
    const idx = this.folders.findIndex((f) => f.uri === folder.uri);
    if (idx >= 0) {
      this.folders[idx] = { ...this.folders[idx], ...folder };
    } else {
      this.folders.push({ ...folder, id: this.nextId++ });
    }
    this.persistFolders();
  }

  async getAllFolders(): Promise<FolderRecord[]> {
    this.requireReady();
    return [...this.folders].sort((a, b) => b.addedAt - a.addedAt);
  }

  async removeFolder(uri: string): Promise<void> {
    this.requireReady();
    this.folders = this.folders.filter((f) => f.uri !== uri);
    this.persistFolders();
    await this.deleteDocumentsByFolder(uri);
  }

  async close(): Promise<void> {
    // No persistent connection to close
  }
}

export const docLibDb = new DatabaseService();
export default docLibDb;
