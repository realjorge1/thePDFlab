// ============================================
// Document Session Cache (W3, contract v2 C4)
// ---------------------------------------------
// The backend now stores uploaded documents persistently and shares them
// across both servers, so the app no longer needs to re-upload a file every
// session. This module remembers what was uploaded:
//   • metadata in AsyncStorage, keyed by uri + name + size + modificationTime
//     (so an edited file is treated as a new document);
//   • the extracted full text in cacheDirectory/ai-doc-text/ for legacy flows.
// Entries are treated as expired 10 minutes before the server's `expiresAt`,
// and at most 200 are kept (oldest evicted first).
//
// Used only when canUse(AI_PERSISTENT_DOC_CACHE, "persistentDocs"); otherwise
// the original in-memory caches stay in charge. Never uploads on its own: an
// upload happens only when a caller explicitly asks for a document.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { API_ENDPOINTS, resilientFetch } from "@/config/api";
import type { AIDocumentRef } from "./ai.types";
import { AIError, aiErrorFromResponseBody, normalizeAIError } from "./aiErrors";
import { isLocatorType, locatorTypeForDocument, type AILocatorType } from "./citations";

export interface DocCacheEntry {
  docId: string;
  /** ISO timestamp from the server, or null when it sent none. */
  expiresAt: string | null;
  locatorType: AILocatorType;
  retrievalMode: "hybrid" | "keyword" | null;
  totalPages: number;
  fileType: string;
  filename?: string;
  chunkCount?: number;
  scannedPages?: number;
  embeddingProvider?: string;
  preview?: string;
  suggestedPrompts?: string[];
  /** When this entry was written (ms). Eviction removes the oldest first. */
  cachedAt: number;
}

/** Internal fields the AI service keeps on a document ref (in memory only). */
export interface AIDocumentRefExtraction extends AIDocumentRef {
  _extractionDocId?: string;
  _extractionMeta?: {
    totalPages: number;
    scannedPages: number;
    chunkCount: number;
  };
  _extractionLocatorType?: AILocatorType;
  _extractionCacheKey?: string;
}

export const DOC_CACHE_STORAGE_KEY = "@wordsinscribed/ai_doc_session_cache_v1";
export const DOC_CACHE_MAX_ENTRIES = 200;
export const DOC_CACHE_EXPIRY_MARGIN_MS = 10 * 60_000;
/** Used only if a server response carries no expiresAt (matches the old 90-min cache). */
const FALLBACK_TTL_MS = 90 * 60_000;
const TEXT_DIR_NAME = "ai-doc-text/";

// ─── Keys & expiry ───────────────────────────────────────────────────────────

/** Cache key: uri + name + size + modificationTime (from expo-file-system). */
export async function docCacheKey(
  doc: Pick<AIDocumentRef, "uri" | "name" | "size">,
): Promise<string> {
  let size: number | undefined = doc.size;
  let mtime: number | undefined;
  try {
    const info = (await FileSystem.getInfoAsync(doc.uri)) as {
      exists: boolean;
      size?: number;
      modificationTime?: number;
    };
    if (info?.exists) {
      if (typeof info.size === "number") size = info.size;
      if (typeof info.modificationTime === "number") mtime = info.modificationTime;
    }
  } catch {
    // content:// URIs and missing files still get a usable key
  }
  return [doc.uri, doc.name, size ?? "", mtime ?? ""].join("|");
}

/** True while an entry is still safely usable (10 min before server expiry). */
export function isDocCacheEntryFresh(entry: DocCacheEntry, now = Date.now()): boolean {
  const expiry = entry.expiresAt ? Date.parse(entry.expiresAt) : entry.cachedAt + FALLBACK_TTL_MS;
  if (!Number.isFinite(expiry)) return false;
  return expiry - DOC_CACHE_EXPIRY_MARGIN_MS > now;
}

// ─── Metadata store ──────────────────────────────────────────────────────────

let _mem: Record<string, DocCacheEntry> | null = null;
let _loading: Promise<Record<string, DocCacheEntry>> | null = null;
let _writeChain: Promise<void> = Promise.resolve();

function isEntry(v: unknown): v is DocCacheEntry {
  const e = v as DocCacheEntry;
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.docId === "string" &&
    !!e.docId &&
    typeof e.cachedAt === "number"
  );
}

async function load(): Promise<Record<string, DocCacheEntry>> {
  if (_mem) return _mem;
  if (!_loading) {
    _loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(DOC_CACHE_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const clean: Record<string, DocCacheEntry> = {};
        for (const [k, v] of Object.entries(parsed ?? {})) if (isEntry(v)) clean[k] = v;
        _mem = clean;
      } catch {
        _mem = {};
      }
      return _mem;
    })();
  }
  try {
    return await _loading;
  } finally {
    _loading = null;
  }
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(_mem ?? {});
  _writeChain = _writeChain.then(() =>
    AsyncStorage.setItem(DOC_CACHE_STORAGE_KEY, snapshot).catch(() => {}),
  );
  return _writeChain;
}

/** A fresh entry for `key`, or null (expired entries are removed). */
export async function getDocCacheEntry(key: string, now = Date.now()): Promise<DocCacheEntry | null> {
  const mem = await load();
  const entry = mem[key];
  if (!entry) return null;
  if (!isDocCacheEntryFresh(entry, now)) {
    delete mem[key];
    void deleteCachedText(key);
    await persist();
    return null;
  }
  return entry;
}

/** Store an entry, evicting the oldest beyond DOC_CACHE_MAX_ENTRIES. */
export async function putDocCacheEntry(key: string, entry: DocCacheEntry): Promise<void> {
  const mem = await load();
  mem[key] = entry;
  const keys = Object.keys(mem);
  if (keys.length > DOC_CACHE_MAX_ENTRIES) {
    const oldestFirst = keys.sort((a, b) => mem[a].cachedAt - mem[b].cachedAt);
    for (const k of oldestFirst.slice(0, keys.length - DOC_CACHE_MAX_ENTRIES)) {
      delete mem[k];
      void deleteCachedText(k);
    }
  }
  await persist();
}

export async function removeDocCacheEntry(key: string): Promise<void> {
  const mem = await load();
  if (mem[key]) {
    delete mem[key];
    await persist();
  }
  await deleteCachedText(key);
}

/** Remove every cache entry that points at `docId` (e.g. after DOC_NOT_FOUND). */
export async function removeDocCacheEntriesForDocId(docId: string): Promise<void> {
  const mem = await load();
  const keys = Object.keys(mem).filter((k) => mem[k].docId === docId);
  if (keys.length === 0) return;
  for (const k of keys) {
    delete mem[k];
    void deleteCachedText(k);
  }
  await persist();
}

export async function docCacheSize(): Promise<number> {
  return Object.keys(await load()).length;
}

// ─── Extracted text files ────────────────────────────────────────────────────

/** Stable, filename-safe name for a cache key (two FNV-1a hashes). */
export function textFileNameForKey(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}.txt`;
}

function textPath(key: string): string | null {
  const base = FileSystem.cacheDirectory;
  return base ? `${base}${TEXT_DIR_NAME}${textFileNameForKey(key)}` : null;
}

export async function writeCachedText(key: string, text: string): Promise<void> {
  const path = textPath(key);
  const base = FileSystem.cacheDirectory;
  if (!path || !base) return;
  try {
    await FileSystem.makeDirectoryAsync(`${base}${TEXT_DIR_NAME}`, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(path, text);
  } catch {
    // A missing text file only means the next legacy use extracts again.
  }
}

export async function readCachedText(key: string): Promise<string | null> {
  const path = textPath(key);
  if (!path) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(path);
  } catch {
    return null;
  }
}

async function deleteCachedText(key: string): Promise<void> {
  const path = textPath(key);
  if (!path) return;
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // ignore
  }
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface UploadDocumentOptions {
  /** Endpoint URL (default: extract-pdf for PDFs, extract-document otherwise). */
  endpoint?: string;
  /** Multipart field name (default: "pdf" for extract-pdf, "file" otherwise). */
  fieldName?: string;
  /** false → `?includeFullText=0` (C4). Default true. */
  includeFullText?: boolean;
  /** Per-attempt timeout (default 180 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface UploadedDocument {
  raw: Record<string, unknown>;
  entry: DocCacheEntry;
  fullText: string | null;
}

function isPdf(doc: AIDocumentRef): boolean {
  return doc.mimeType === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf");
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Build a cache entry from an extraction response. */
export function entryFromExtraction(raw: Record<string, any>, doc: AIDocumentRef): DocCacheEntry {
  const ext = (doc.name.split(".").pop() || "").toLowerCase();
  const fileType = typeof raw.fileType === "string" && raw.fileType ? raw.fileType : ext || "pdf";
  return {
    docId: String(raw.docId),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : null,
    locatorType: isLocatorType(raw.locatorType)
      ? raw.locatorType
      : locatorTypeForDocument({ name: doc.name, mimeType: doc.mimeType, fileType }),
    retrievalMode:
      raw.retrievalMode === "hybrid" || raw.retrievalMode === "keyword" ? raw.retrievalMode : null,
    totalPages: num(raw.totalPages) ?? 0,
    fileType,
    filename: typeof raw.filename === "string" ? raw.filename : doc.name,
    chunkCount: num(raw.chunkCount),
    scannedPages: num(raw.scannedPages),
    embeddingProvider:
      typeof raw.embeddingProvider === "string"
        ? raw.embeddingProvider
        : typeof raw.embedding?.provider === "string"
          ? raw.embedding.provider
          : undefined,
    preview: typeof raw.preview === "string" ? raw.preview : undefined,
    suggestedPrompts: Array.isArray(raw.suggestedPrompts)
      ? raw.suggestedPrompts.filter((p: unknown): p is string => typeof p === "string")
      : undefined,
    cachedAt: Date.now(),
  };
}

/** Upload a document to an extraction endpoint through resilientFetch. */
export async function uploadDocumentForAI(
  doc: AIDocumentRef,
  opts: UploadDocumentOptions = {},
): Promise<UploadedDocument> {
  const pdf = isPdf(doc);
  const endpoint = opts.endpoint ?? (pdf ? API_ENDPOINTS.AI.EXTRACT_PDF : API_ENDPOINTS.AI.EXTRACT_DOCUMENT);
  const fieldName = opts.fieldName ?? (opts.endpoint ? "file" : pdf ? "pdf" : "file");
  const url = opts.includeFullText === false ? `${endpoint}?includeFullText=0` : endpoint;

  const form = new FormData();
  form.append(fieldName, {
    uri: doc.uri,
    type: pdf ? "application/pdf" : doc.mimeType || "application/octet-stream",
    name: doc.name || (pdf ? "document.pdf" : "document"),
  } as any);

  let res: Response;
  try {
    // Never set Content-Type: fetch generates the multipart boundary.
    res = await resilientFetch(
      url,
      { method: "POST", body: form, signal: opts.signal },
      { timeoutMs: opts.timeoutMs ?? 180_000 },
    );
  } catch (e) {
    throw normalizeAIError(e, { signal: opts.signal ?? null });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let serverError = "";
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === "string") serverError = parsed.error;
    } catch {
      // not JSON
    }
    const err = aiErrorFromResponseBody(res.status, body, {
      headers: res.headers,
      message: serverError || `Document extraction failed (${res.status})`,
    });
    // A 404 from an upload route is not "document expired".
    if (err.code === "DOC_NOT_FOUND") {
      throw new AIError("SERVER", err.message, { status: err.status, requestId: err.requestId });
    }
    throw err;
  }

  const raw = (await res.json()) as Record<string, any>;
  if (!raw || typeof raw.docId !== "string" || !raw.docId) {
    throw new AIError("SERVER", "Document extraction returned no document id.");
  }
  return {
    raw,
    entry: entryFromExtraction(raw, doc),
    fullText: typeof raw.fullText === "string" ? raw.fullText : null,
  };
}

// ─── Doc ref helpers ─────────────────────────────────────────────────────────

export function attachExtractionToDocRef(
  doc: AIDocumentRef,
  entry: DocCacheEntry,
  key?: string,
): void {
  const d = doc as AIDocumentRefExtraction;
  d._extractionDocId = entry.docId;
  d._extractionMeta = {
    totalPages: entry.totalPages,
    scannedPages: entry.scannedPages ?? 0,
    chunkCount: entry.chunkCount ?? 0,
  };
  d._extractionLocatorType = entry.locatorType;
  if (key) d._extractionCacheKey = key;
}

/** Record a docId obtained elsewhere (e.g. Chat with File's session) on a doc ref. */
export function setDocRefDocId(doc: AIDocumentRef, docId: string, locatorType?: AILocatorType): void {
  const d = doc as AIDocumentRefExtraction;
  d._extractionDocId = docId;
  if (locatorType) d._extractionLocatorType = locatorType;
}

export function getDocRefDocId(doc: AIDocumentRef | null | undefined): string | undefined {
  const id = (doc as AIDocumentRefExtraction | undefined)?._extractionDocId;
  return typeof id === "string" && id ? id : undefined;
}

export function getDocRefLocatorType(doc: AIDocumentRef | null | undefined): AILocatorType | undefined {
  const d = doc as AIDocumentRefExtraction | undefined;
  if (d?._extractionLocatorType) return d._extractionLocatorType;
  return doc ? locatorTypeForDocument({ name: doc.name, mimeType: doc.mimeType }) : undefined;
}

// ─── Ensure (cache first, then upload) ───────────────────────────────────────

export interface EnsureDocumentOptions extends UploadDocumentOptions {
  /** The caller needs the full text too (a cache hit without a text file re-uploads). */
  needText?: boolean;
  /** Skip the cache and upload again. */
  force?: boolean;
  /** Write to the persistent cache (default true). */
  persist?: boolean;
}

export interface EnsuredDocument {
  key: string;
  entry: DocCacheEntry;
  text: string | null;
  fromCache: boolean;
  /** The raw extraction response when an upload happened. */
  raw?: Record<string, unknown>;
}

/**
 * Return the uploaded document for `doc`, uploading only when there is no
 * fresh cache entry (or the caller needs text that is not cached).
 */
export async function ensureDocumentUploaded(
  doc: AIDocumentRef,
  opts: EnsureDocumentOptions = {},
): Promise<EnsuredDocument> {
  const persistEntry = opts.persist !== false;
  const key = await docCacheKey(doc);

  if (!opts.force && persistEntry) {
    const entry = await getDocCacheEntry(key);
    if (entry) {
      if (!opts.needText) {
        attachExtractionToDocRef(doc, entry, key);
        return { key, entry, text: null, fromCache: true };
      }
      const text = await readCachedText(key);
      if (text !== null) {
        attachExtractionToDocRef(doc, entry, key);
        return { key, entry, text, fromCache: true };
      }
    }
  }

  const uploaded = await uploadDocumentForAI(doc, opts);
  if (persistEntry) {
    await putDocCacheEntry(key, uploaded.entry);
    if (uploaded.fullText) await writeCachedText(key, uploaded.fullText);
  }
  attachExtractionToDocRef(doc, uploaded.entry, key);
  return { key, entry: uploaded.entry, text: uploaded.fullText, fromCache: false, raw: uploaded.raw };
}

/**
 * A copy of `doc` carrying the cached docId, or null when there is no fresh
 * cache entry. Never uploads (used by background work such as scheduled tasks).
 */
export async function findCachedDocument(doc: AIDocumentRef): Promise<AIDocumentRef | null> {
  try {
    const key = await docCacheKey(doc);
    const entry = await getDocCacheEntry(key);
    if (!entry) return null;
    const copy: AIDocumentRef = { ...doc };
    attachExtractionToDocRef(copy, entry, key);
    return copy;
  } catch {
    return null;
  }
}

/** Forget a document everywhere (cache entry, text file, doc ref fields). */
export async function forgetDocument(doc: AIDocumentRef): Promise<void> {
  const d = doc as AIDocumentRefExtraction;
  const docId = d._extractionDocId;
  try {
    const key = d._extractionCacheKey ?? (await docCacheKey(doc));
    await removeDocCacheEntry(key);
    if (docId) await removeDocCacheEntriesForDocId(docId);
  } catch {
    // ignore
  }
  delete d._extractionDocId;
  delete d._extractionMeta;
  delete d._extractionCacheKey;
}

/** Test-only: drop in-memory state. */
export function __resetDocSessionCacheForTests(): void {
  _mem = null;
  _loading = null;
  _writeChain = Promise.resolve();
}
