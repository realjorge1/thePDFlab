/**
 * useDocLib — React hooks for the SAF-indexed document library.
 *
 * Each hook wraps a discrete piece of the DocLib backend (database, indexer,
 * SAF bridge) and adds:
 *  - A focus-refresh subscription so opens in another screen surface here.
 *  - A bridge to the app's shared `readingProgressService` so the existing
 *    PDF/EPUB/DOCX viewers automatically populate readingProgress without any
 *    viewer changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import db, { DocumentRecord, FolderRecord } from "@/services/doclib/database";
import fileIndexer, { IndexingStatus } from "@/services/doclib/fileIndexer";
import SAF from "@/services/doclib/safBridge";
import {
  getReadingProgressSync,
  preloadReadingProgress,
  subscribeReadingProgress,
} from "@/services/readingProgressService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Apply the latest reading progress from the shared service onto each doc. */
function withSharedProgress(docs: DocumentRecord[]): DocumentRecord[] {
  return docs.map((doc) => {
    const entry = getReadingProgressSync(doc.uri);
    if (!entry) return doc;
    if (entry.progress === doc.readingProgress) return doc;
    return { ...doc, readingProgress: entry.progress };
  });
}

// ─── useDocuments ─────────────────────────────────────────────────────────────

export function useDocuments(type?: string) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      await db.init();
      const docs = await db.getAllDocuments(type);
      if (mounted.current) setDocuments(withSharedProgress(docs));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    mounted.current = true;
    load();
    preloadReadingProgress().catch(() => {});
    const unsub = subscribeReadingProgress(() => {
      setDocuments((prev) => withSharedProgress(prev));
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [load]);

  return { documents, loading, refetch: load };
}

// ─── useRecentDocuments ───────────────────────────────────────────────────────

export function useRecentDocuments(limit = 10) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      await db.init();
      const docs = await db.getRecentDocuments(limit);
      if (mounted.current) setDocuments(withSharedProgress(docs));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    mounted.current = true;
    load();
    preloadReadingProgress().catch(() => {});
    const unsub = subscribeReadingProgress(() => {
      setDocuments((prev) => withSharedProgress(prev));
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [load]);

  return { documents, loading, refetch: load };
}

// ─── useSearch ────────────────────────────────────────────────────────────────

export function useSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        await db.init();
        const docs = await db.searchDocuments(query.trim());
        setResults(withSharedProgress(docs));
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return { query, setQuery, results, loading };
}

// ─── useIndexingStatus ────────────────────────────────────────────────────────

export function useIndexingStatus() {
  const [status, setStatus] = useState<IndexingStatus>({ phase: "idle" });

  useEffect(() => {
    return fileIndexer.onStatusChange(setStatus);
  }, []);

  return status;
}

// ─── useFolders ───────────────────────────────────────────────────────────────

export function useFolders() {
  const [folders, setFolders] = useState<FolderRecord[]>([]);

  const load = useCallback(async () => {
    await db.init();
    const all = await db.getAllFolders();
    setFolders(all);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addFolder = useCallback(async () => {
    try {
      const result = await SAF.selectFolder();
      await fileIndexer.addFolder(result.uri, result.displayName);
      await load();
      return result;
    } catch (e: any) {
      if (e?.code === "CANCELLED" || e?.message?.includes("CANCELLED")) {
        return null;
      }
      throw e;
    }
  }, [load]);

  const removeFolder = useCallback(
    async (uri: string) => {
      await fileIndexer.removeFolder(uri);
      await load();
    },
    [load],
  );

  return { folders, addFolder, removeFolder, refetch: load };
}

// ─── useDocumentOpener ────────────────────────────────────────────────────────

export function useDocumentOpener() {
  const open = useCallback(async (doc: DocumentRecord) => {
    try {
      await db.updateLastOpened(doc.uri);
    } catch {
      /* non-fatal */
    }
    await SAF.openFile(doc.uri, doc.mimeType);
  }, []);

  return { open };
}

// ─── useDocumentCounts ────────────────────────────────────────────────────────

export function useDocumentCounts() {
  const [counts, setCounts] = useState({
    all: 0,
    pdf: 0,
    docx: 0,
    xlsx: 0,
    pptx: 0,
  });

  const load = useCallback(async () => {
    await db.init();
    const [all, pdf, docx, xlsx, pptx] = await Promise.all([
      db.getDocumentCount(),
      db.getDocumentCount("pdf"),
      db.getDocumentCount("docx"),
      db.getDocumentCount("xlsx"),
      db.getDocumentCount("pptx"),
    ]);
    setCounts({ all, pdf, docx, xlsx, pptx });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { counts, refetch: load };
}
