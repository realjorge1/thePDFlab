// ============================================
// Workspace Insights Service
// Single source of truth for the WorkSpace "Progress" dashboard and the data
// layer behind the Knowledge Graph.
//
// Real counters (persisted): AI interactions and reading time.
// Derived metrics: pulled live from the unified file index + reading progress
// + the persisted workspace notebook state.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getAllFiles, type UnifiedFileRecord } from "@/services/fileIndexService";
import {
  getAllReadingProgress,
  type ReadingProgressEntry,
} from "@/services/readingProgressService";

// ─── Storage keys ─────────────────────────────────────────────────────────────
const AI_KEY = "@wordsinscribed/ws_ai_interactions_v1";
const READTIME_KEY = "@wordsinscribed/ws_reading_time_v1";
// Mirrors the workspace screen's storage key so we can read notebook notes here
// without importing the (huge) screen module.
const WORKSPACE_KEY = "@wordsinscribed/ai_workspace_state_v1";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BOOK_DONE = 0.9; // progress >= 0.9 counts as "read"

// ─── Persisted shapes ─────────────────────────────────────────────────────────
interface AIRecord {
  total: number;
  timestamps: number[]; // recent interaction times (capped)
}

interface ReadTimeRecord {
  totalMs: number;
  updatedAt: number;
}

// ─── Public types ─────────────────────────────────────────────────────────────
export interface RecentBook {
  name: string;
  uri: string;
  type: string;
  progress: number;
  lastReadAt: number;
}

export interface WorkspaceInsights {
  booksTotal: number;
  booksCompleted: number;
  booksInProgress: number;
  documentsCreated: number;
  readingTimeMs: number;
  aiInteractions: number;
  aiInteractionsThisWeek: number;
  notesCount: number;
  notesWords: number;
  recentBooks: RecentBook[];
}

// ─── pub/sub ──────────────────────────────────────────────────────────────────
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.warn("[WorkspaceInsights] listener error:", e);
    }
  }
}

export function subscribeInsights(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ─── AI interaction counter ─────────────────────────────────────────────────--
async function readAI(): Promise<AIRecord> {
  try {
    const raw = await AsyncStorage.getItem(AI_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AIRecord;
      if (typeof parsed.total === "number" && Array.isArray(parsed.timestamps)) {
        return parsed;
      }
    }
  } catch {
    /* fall through */
  }
  return { total: 0, timestamps: [] };
}

/** Increment the workspace AI-interaction counter. Safe to fire-and-forget. */
export async function recordAIInteraction(): Promise<void> {
  try {
    const rec = await readAI();
    rec.total += 1;
    rec.timestamps.push(Date.now());
    // Keep only the most recent 500 timestamps.
    if (rec.timestamps.length > 500) {
      rec.timestamps = rec.timestamps.slice(rec.timestamps.length - 500);
    }
    await AsyncStorage.setItem(AI_KEY, JSON.stringify(rec));
    notify();
  } catch (e) {
    console.warn("[WorkspaceInsights] recordAIInteraction failed:", e);
  }
}

// ─── Reading-time accumulator ─────────────────────────────────────────────────
async function readReadTime(): Promise<ReadTimeRecord> {
  try {
    const raw = await AsyncStorage.getItem(READTIME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReadTimeRecord;
      if (typeof parsed.totalMs === "number") return parsed;
    }
  } catch {
    /* fall through */
  }
  return { totalMs: 0, updatedAt: 0 };
}

/**
 * Add elapsed reading time. Called as a heartbeat by the PDF/EPUB viewers.
 * Ignores absurd values (e.g. app backgrounded for hours) by capping per call.
 */
export async function bumpReadingTime(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const capped = Math.min(ms, 5 * 60 * 1000); // never credit > 5 min per beat
  try {
    const rec = await readReadTime();
    rec.totalMs += capped;
    rec.updatedAt = Date.now();
    await AsyncStorage.setItem(READTIME_KEY, JSON.stringify(rec));
    notify();
  } catch (e) {
    console.warn("[WorkspaceInsights] bumpReadingTime failed:", e);
  }
}

// ─── Notebook notes (read from the workspace state) ───────────────────────────
interface PersistedNote {
  id: string;
  kind: string;
  text?: string;
}

async function readNotes(): Promise<{ count: number; words: number; texts: { id: string; text: string }[] }> {
  try {
    const raw = await AsyncStorage.getItem(WORKSPACE_KEY);
    if (!raw) return { count: 0, words: 0, texts: [] };
    const parsed = JSON.parse(raw) as { blocks?: PersistedNote[] };
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    const notes = blocks.filter((b) => b.kind === "note" && (b.text ?? "").trim());
    let words = 0;
    const texts: { id: string; text: string }[] = [];
    for (const n of notes) {
      const text = (n.text ?? "").trim();
      words += text.split(/\s+/).filter(Boolean).length;
      texts.push({ id: n.id, text });
    }
    return { count: notes.length, words, texts };
  } catch {
    return { count: 0, words: 0, texts: [] };
  }
}

// ─── Aggregate insights ───────────────────────────────────────────────────────
export async function getInsights(): Promise<WorkspaceInsights> {
  const [files, progressMap, ai, readTime, notes] = await Promise.all([
    safeFiles(),
    getAllReadingProgress().catch(() => ({}) as Record<string, ReadingProgressEntry>),
    readAI(),
    readReadTime(),
    readNotes(),
  ]);

  // Books / documents = everything readable in the library.
  const books = files.filter((f) => f.type === "pdf" || f.type === "epub" || f.type === "docx");

  let booksCompleted = 0;
  let booksInProgress = 0;
  const recent: RecentBook[] = [];
  for (const f of books) {
    const p = progressMap[f.uri];
    const progress = p?.progress ?? 0;
    if (progress >= BOOK_DONE) booksCompleted += 1;
    else if (progress > 0) booksInProgress += 1;
    if (p?.lastReadAt) {
      recent.push({
        name: f.name,
        uri: f.uri,
        type: f.type,
        progress,
        lastReadAt: p.lastReadAt,
      });
    }
  }
  recent.sort((a, b) => b.lastReadAt - a.lastReadAt);

  const documentsCreated = files.filter(
    (f) => f.sourceTags?.includes("created") || f.source === "created",
  ).length;

  const weekCutoff = Date.now() - WEEK_MS;
  const aiThisWeek = ai.timestamps.filter((t) => t >= weekCutoff).length;

  return {
    booksTotal: books.length,
    booksCompleted,
    booksInProgress,
    documentsCreated,
    readingTimeMs: readTime.totalMs,
    aiInteractions: ai.total,
    aiInteractionsThisWeek: aiThisWeek,
    notesCount: notes.count,
    notesWords: notes.words,
    recentBooks: recent.slice(0, 6),
  };
}

async function safeFiles(): Promise<UnifiedFileRecord[]> {
  try {
    return await getAllFiles();
  } catch {
    return [];
  }
}

/** Convenience: just the library docs (books) for the source library / graph. */
export async function getLibraryBooks(): Promise<UnifiedFileRecord[]> {
  const files = await safeFiles();
  return files.filter(
    (f) => f.type === "pdf" || f.type === "epub" || f.type === "docx",
  );
}

export function formatReadingTime(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

// ─── Knowledge graph builder ──────────────────────────────────────────────────
export type GraphNodeType = "book" | "note" | "concept";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** book → file uri; note → note id. */
  ref?: string;
  /** book → file type. */
  meta?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "link" | "concept";
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNoteInput {
  id: string;
  text: string;
  sourceUri?: string;
  sourceName?: string;
}

export interface ConceptInput {
  name: string;
  related: string[]; // free-text titles / note phrases the concept connects
}

/**
 * Build a logical graph (no layout) from notebook notes, library books, and an
 * AI-extracted concept layer. Concept `related` strings are matched (loose,
 * case-insensitive substring) against book names and note text to form edges.
 */
export function buildGraph(
  notes: GraphNoteInput[],
  books: UnifiedFileRecord[],
  concepts: ConceptInput[],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const bookNodeId = (uri: string) => `book:${uri}`;
  const noteNodeId = (id: string) => `note:${id}`;
  const conceptNodeId = (name: string) => `concept:${name.toLowerCase()}`;

  // Book nodes
  for (const b of books) {
    const id = bookNodeId(b.uri);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, type: "book", label: stripExt(b.name), ref: b.uri, meta: b.type });
  }

  // Note nodes + structural note→source edges
  for (const n of notes) {
    const id = noteNodeId(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, type: "note", label: snippet(n.text), ref: n.id });
    if (n.sourceUri) {
      const target = bookNodeId(n.sourceUri);
      if (seen.has(target)) edges.push({ from: id, to: target, kind: "link" });
    }
  }

  // Concept nodes + concept→{book,note} edges via loose matching
  for (const c of concepts) {
    const name = c.name.trim();
    if (!name) continue;
    const cid = conceptNodeId(name);
    if (!seen.has(cid)) {
      seen.add(cid);
      nodes.push({ id: cid, type: "concept", label: name });
    }
    const related = c.related.map((r) => r.toLowerCase()).filter(Boolean);
    for (const b of books) {
      const hay = b.name.toLowerCase();
      if (related.some((r) => hay.includes(r) || r.includes(stripExt(hay)))) {
        edges.push({ from: cid, to: bookNodeId(b.uri), kind: "concept" });
      }
    }
    for (const n of notes) {
      const hay = n.text.toLowerCase();
      if (related.some((r) => r.length > 3 && hay.includes(r))) {
        edges.push({ from: cid, to: noteNodeId(n.id), kind: "concept" });
      }
    }
  }

  return { nodes, edges };
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 28 ? clean.slice(0, 27) + "…" : clean || "Note";
}

/** Read notebook notes for the graph (id, text, linked source). */
export async function getNotebookNotesForGraph(): Promise<GraphNoteInput[]> {
  try {
    const raw = await AsyncStorage.getItem(WORKSPACE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      blocks?: { id: string; kind: string; text?: string; sourceUri?: string; sourceName?: string }[];
    };
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    return blocks
      .filter((b) => b.kind === "note" && (b.text ?? "").trim())
      .map((b) => ({
        id: b.id,
        text: (b.text ?? "").trim(),
        sourceUri: b.sourceUri,
        sourceName: b.sourceName,
      }));
  } catch {
    return [];
  }
}
