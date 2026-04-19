// ============================================================================
// Persistent on-disk cache for rendered PPTX → PDF outputs.
//
// Design:
//   - PDFs live under FileSystem.cacheDirectory/pptxOnline/
//   - An AsyncStorage-backed index tracks entries keyed by (uri+mtime+size).
//     A secondary index maps backend serverId (content hash) → cacheKey so
//     that distinct URIs to the same content dedup.
//   - LRU eviction: cap by total size (MAX_CACHE_BYTES) AND entry count
//     (MAX_ENTRIES), evicting least-recently-accessed first.
//   - Stale-on-disk guard: every cache hit validates the PDF file still
//     exists with non-zero size before using it.
//
// Fully self-contained — no imports from the rest of the app's cache layer.
// ============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import type { CacheEntry, CacheIndex } from "../types/pptxViewer";

const INDEX_KEY = "pptxOnlineCache_v1";
const CACHE_SUBDIR = "pptxOnline";
const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_ENTRIES = 30;

// ── Paths ───────────────────────────────────────────────────────────────────

function cacheDir(): string {
  return `${FileSystem.cacheDirectory}${CACHE_SUBDIR}/`;
}

async function ensureCacheDir(): Promise<void> {
  const dir = cacheDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
}

// ── Cache key ───────────────────────────────────────────────────────────────
// Poor-man's content fingerprint derived from local file metadata. Cheap
// (no hashing) yet catches the common "same file reopened" case.

export async function buildCacheKey(fileUri: string): Promise<string> {
  const info: any = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) throw new Error(`File does not exist: ${fileUri}`);
  const size = info.size ?? 0;
  const mtime = info.modificationTime ?? 0;
  return `${fileUri}::${mtime}::${size}`;
}

// ── Index I/O ───────────────────────────────────────────────────────────────

async function readIndex(): Promise<CacheIndex> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return emptyIndex();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.entries || !parsed.serverIdIndex) {
      return emptyIndex();
    }
    return parsed as CacheIndex;
  } catch {
    return emptyIndex();
  }
}

async function writeIndex(index: CacheIndex): Promise<void> {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // best-effort: persistence failure must not break viewer
  }
}

function emptyIndex(): CacheIndex {
  return { version: 1, entries: {}, serverIdIndex: {} };
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/**
 * Check if we have a usable cached PDF for either the cacheKey or serverId.
 * If found but the file no longer exists, the entry is pruned.
 */
export async function lookupCached(params: {
  cacheKey?: string;
  serverId?: string;
}): Promise<CacheEntry | null> {
  const { cacheKey, serverId } = params;
  const index = await readIndex();

  let entry: CacheEntry | undefined;
  if (cacheKey) entry = index.entries[cacheKey];
  if (!entry && serverId) {
    const mappedKey = index.serverIdIndex[serverId];
    if (mappedKey) entry = index.entries[mappedKey];
  }
  if (!entry) return null;

  const info = await FileSystem.getInfoAsync(entry.pdfPath);
  if (!info.exists || ((info as any).size ?? 0) === 0) {
    delete index.entries[entry.cacheKey];
    delete index.serverIdIndex[entry.serverId];
    await writeIndex(index);
    return null;
  }

  entry.lastAccessedAt = Date.now();
  index.entries[entry.cacheKey] = entry;
  await writeIndex(index);
  return entry;
}

// ── Store a freshly-downloaded PDF ──────────────────────────────────────────

/**
 * Copy (or move) a freshly downloaded PDF into the persistent cache directory
 * and record it under both cacheKey and serverId.
 */
export async function storeRendered(params: {
  cacheKey: string;
  serverId: string;
  sourcePdfUri: string;
  downloadName: string;
  originalName: string | null;
}): Promise<CacheEntry> {
  const { cacheKey, serverId, sourcePdfUri, downloadName, originalName } =
    params;

  await ensureCacheDir();
  const safeName = sanitize(downloadName || "presentation.pdf");
  const targetPath = `${cacheDir()}${serverId}_${safeName}`;

  const srcInfo = await FileSystem.getInfoAsync(sourcePdfUri);
  if (!srcInfo.exists) {
    throw new Error("Downloaded PDF missing before it could be cached");
  }

  const targetInfo = await FileSystem.getInfoAsync(targetPath);
  if (targetInfo.exists) {
    try {
      await FileSystem.deleteAsync(targetPath, { idempotent: true });
    } catch {
      // ignore
    }
  }

  try {
    await FileSystem.moveAsync({ from: sourcePdfUri, to: targetPath });
  } catch {
    await FileSystem.copyAsync({ from: sourcePdfUri, to: targetPath });
  }

  const size = (srcInfo as any).size ?? 0;
  const now = Date.now();

  const index = await readIndex();
  const existingByServerId = index.serverIdIndex[serverId];
  if (existingByServerId && existingByServerId !== cacheKey) {
    // Same content, different key — drop the old entry to keep one copy.
    const prev = index.entries[existingByServerId];
    if (prev) {
      try {
        await FileSystem.deleteAsync(prev.pdfPath, { idempotent: true });
      } catch {
        // ignore
      }
      delete index.entries[existingByServerId];
    }
  }

  const entry: CacheEntry = {
    cacheKey,
    serverId,
    pdfPath: targetPath,
    sizeBytes: size,
    renderedAt: now,
    lastAccessedAt: now,
    originalName,
  };
  index.entries[cacheKey] = entry;
  index.serverIdIndex[serverId] = cacheKey;
  await writeIndex(index);

  await enforceLimits();
  return entry;
}

// ── LRU eviction ────────────────────────────────────────────────────────────

async function enforceLimits(): Promise<void> {
  const index = await readIndex();
  const entries = Object.values(index.entries);
  if (entries.length === 0) return;

  let totalBytes = entries.reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
  if (entries.length <= MAX_ENTRIES && totalBytes <= MAX_CACHE_BYTES) return;

  const sorted = [...entries].sort(
    (a, b) => a.lastAccessedAt - b.lastAccessedAt,
  );
  let count = entries.length;

  for (const victim of sorted) {
    if (count <= MAX_ENTRIES && totalBytes <= MAX_CACHE_BYTES) break;
    try {
      await FileSystem.deleteAsync(victim.pdfPath, { idempotent: true });
    } catch {
      // ignore
    }
    delete index.entries[victim.cacheKey];
    if (index.serverIdIndex[victim.serverId] === victim.cacheKey) {
      delete index.serverIdIndex[victim.serverId];
    }
    totalBytes -= victim.sizeBytes || 0;
    count -= 1;
  }

  await writeIndex(index);
}

// ── Public maintenance API ──────────────────────────────────────────────────

export async function clearPptxCache(): Promise<void> {
  const index = await readIndex();
  for (const entry of Object.values(index.entries)) {
    try {
      await FileSystem.deleteAsync(entry.pdfPath, { idempotent: true });
    } catch {
      // ignore
    }
  }
  await writeIndex(emptyIndex());
  try {
    await FileSystem.deleteAsync(cacheDir(), { idempotent: true });
  } catch {
    // ignore
  }
}

export async function getCacheStats(): Promise<{
  entries: number;
  totalBytes: number;
}> {
  const index = await readIndex();
  const entries = Object.values(index.entries);
  return {
    entries: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + (e.sizeBytes || 0), 0),
  };
}
