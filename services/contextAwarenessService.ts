// ============================================
// Gozlin Workspace — Context Awareness
// ============================================
// Detects what the user is actively working on and surfaces everything related
// without them searching. When a document (or a closely related topic) is
// opened repeatedly, the workspace can automatically pull together:
//   • Related documents (via the knowledge graph)
//   • Related notebook notes / drafts
//   • Related saved images
//
// SECONDARY / additive: opt-in tracking via a single fire-and-forget call
// (recordDocumentOpen) plus read-only surfacing. Persists to its OWN storage
// key, so nothing existing is touched. Every method is failure-tolerant.
// ============================================

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  getAllFiles,
  type UnifiedFileRecord,
} from "@/services/fileIndexService";
import {
  getRelatedDocuments,
  type RelatedDocument,
} from "@/services/knowledgeGraphService";
import { getNotebookNotesForGraph } from "@/services/workspaceInsightsService";
import { keywordSet, sharedKeywords, titleKeywords } from "@/utils/keywords";

const CONTEXT_KEY = "@wordsinscribed/ws_context_v1";
const MAX_TRACKED = 200;
/** "More than twice" → a topic is in focus once it has been opened this often. */
export const DEFAULT_FOCUS_THRESHOLD = 3;
/** Opens older than this don't count toward "active" focus. */
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface OpenStat {
  uri: string;
  name: string;
  type: string;
  count: number;
  firstOpenedAt: number;
  lastOpenedAt: number;
}

interface ContextState {
  stats: Record<string, OpenStat>;
}

export interface SurfacedContext {
  /** The document the user is currently focused on (most recent in-focus doc). */
  focus: OpenStat | null;
  relatedDocuments: RelatedDocument[];
  relatedNotes: { id: string; text: string }[];
  relatedImages: { uri: string; name: string }[];
}

// ─── State + persistence ──────────────────────────────────────────────────────
let cache: ContextState | null = null;
let loadPromise: Promise<ContextState> | null = null;

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.warn("[ContextAwareness] listener error:", e);
    }
  }
}

export function subscribeContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function load(): Promise<ContextState> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(CONTEXT_KEY);
      const parsed = raw ? (JSON.parse(raw) as ContextState) : null;
      cache =
        parsed && parsed.stats && typeof parsed.stats === "object"
          ? parsed
          : { stats: {} };
    } catch {
      cache = { stats: {} };
    }
    return cache;
  })();
  return loadPromise;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    if (!cache) return;
    try {
      await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn("[ContextAwareness] persist error:", e);
    }
  }, 500);
}

/** Trim to the most-recently-opened MAX_TRACKED entries. */
function trim(state: ContextState) {
  const entries = Object.values(state.stats);
  if (entries.length <= MAX_TRACKED) return;
  entries
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(MAX_TRACKED)
    .forEach((e) => delete state.stats[e.uri]);
}

// ─── Tracking (fire-and-forget) ───────────────────────────────────────────────

/**
 * Record that a document was opened. Safe to call from anywhere; never throws.
 * This is the single touch-point existing screens need to enable context
 * awareness — it changes no existing behavior.
 */
export async function recordDocumentOpen(doc: {
  uri: string;
  name: string;
  type?: string;
}): Promise<void> {
  if (!doc?.uri) return;
  try {
    const state = await load();
    const now = Date.now();
    const existing = state.stats[doc.uri];
    if (existing) {
      existing.count += 1;
      existing.lastOpenedAt = now;
      if (doc.name) existing.name = doc.name;
      if (doc.type) existing.type = doc.type;
    } else {
      state.stats[doc.uri] = {
        uri: doc.uri,
        name: doc.name || "Document",
        type: doc.type || "unknown",
        count: 1,
        firstOpenedAt: now,
        lastOpenedAt: now,
      };
    }
    trim(state);
    scheduleWrite();
    notify();
  } catch (e) {
    console.warn("[ContextAwareness] recordDocumentOpen failed:", e);
  }
}

/** Raw open-stats map (uri → stat). Used by predictive ranking. */
export async function getOpenStats(): Promise<Map<string, OpenStat>> {
  const state = await load();
  return new Map(Object.entries(state.stats));
}

/**
 * Documents currently "in focus" — opened more than the threshold within the
 * active window — most recent first.
 */
export async function getFocusDocuments(
  threshold: number = DEFAULT_FOCUS_THRESHOLD,
): Promise<OpenStat[]> {
  const state = await load();
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  return Object.values(state.stats)
    .filter((s) => s.count >= threshold && s.lastOpenedAt >= cutoff)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

// ─── Surfacing ────────────────────────────────────────────────────────────────

/**
 * Given the user's current focus document, pull together related materials.
 * Pass a `focusUri` to force a specific focus; otherwise the most recent
 * in-focus document is used. Returns empty arrays (never throws) if there's
 * nothing to surface.
 */
export async function getActiveContext(
  focusUri?: string,
): Promise<SurfacedContext> {
  const empty: SurfacedContext = {
    focus: null,
    relatedDocuments: [],
    relatedNotes: [],
    relatedImages: [],
  };

  try {
    const state = await load();
    let focus: OpenStat | null = null;
    if (focusUri) {
      focus = state.stats[focusUri] ?? null;
    } else {
      const inFocus = await getFocusDocuments();
      focus = inFocus[0] ?? null;
    }
    if (!focus) return empty;

    const focusKw = titleKeywords(focus.name);

    const [relatedDocuments, notes, files] = await Promise.all([
      getRelatedDocuments(focus.uri).catch(() => [] as RelatedDocument[]),
      getNotebookNotesForGraph().catch(() => []),
      getAllFiles().catch(() => [] as UnifiedFileRecord[]),
    ]);

    // Related notes: notebook notes whose words overlap the focus topic.
    const relatedNotes = notes
      .map((n) => ({
        n,
        overlap: sharedKeywords(focusKw, keywordSet(n.text)).length,
      }))
      .filter((x) => x.overlap > 0 || x.n.sourceUri === focus!.uri)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 6)
      .map((x) => ({ id: x.n.id, text: x.n.text }));

    // Related saved images: image files whose name shares the focus topic.
    const relatedImages = files
      .filter((f) => f.type === "image")
      .map((f) => ({
        f,
        overlap: sharedKeywords(focusKw, titleKeywords(f.name)).length,
      }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 6)
      .map((x) => ({ uri: x.f.uri, name: x.f.name }));

    return { focus, relatedDocuments, relatedNotes, relatedImages };
  } catch (e) {
    console.warn("[ContextAwareness] getActiveContext failed:", e);
    return empty;
  }
}

/** Clear all context-awareness tracking (e.g. from a privacy/reset action). */
export async function clearContext(): Promise<void> {
  cache = { stats: {} };
  try {
    await AsyncStorage.removeItem(CONTEXT_KEY);
  } catch {
    /* ignore */
  }
  notify();
}
