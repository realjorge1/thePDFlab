/**
 * pronunciationService.ts
 * Stores pronunciation rules and hands the playback path a synchronous view
 * of them.
 *
 * Rules live in one AsyncStorage record. A rule with no `documentId` is
 * global; one with a `documentId` applies to that book only. Everything is
 * mirrored into an in-memory cache because the speak path must be able to ask
 * "what are the rules right now?" without awaiting — an await there would put
 * a gap between chunks.
 *
 * Read Aloud works offline, and so does this: AsyncStorage only.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PronunciationRule } from "@/utils/pronunciation";

export type { PronunciationRule };

const STORAGE_KEY = "@wordsinscribed_pronunciation_rules";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _rules: PronunciationRule[] = [];
let _loaded = false;
let _loading: Promise<PronunciationRule[]> | null = null;
let _listeners: ((rules: PronunciationRule[]) => void)[] = [];

function notify(): void {
  for (const fn of _listeners) fn(_rules);
}

/**
 * Drop anything that does not look like a rule.
 *
 * Storage is user-writable state that has to survive schema drift; a single
 * malformed entry must not take Read Aloud down with it.
 */
function sanitise(raw: unknown): PronunciationRule[] {
  if (!Array.isArray(raw)) return [];

  const out: PronunciationRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<PronunciationRule>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.match !== "string" || !r.match) continue;
    if (typeof r.replacement !== "string") continue;

    out.push({
      id: r.id,
      match: r.match,
      replacement: r.replacement,
      wholeWord: r.wholeWord !== false,
      caseSensitive: r.caseSensitive === true,
      documentId: typeof r.documentId === "string" ? r.documentId : undefined,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Load / persist
// ---------------------------------------------------------------------------

/** Load rules into the cache. Safe to call repeatedly; loads once. */
export async function loadRules(): Promise<PronunciationRule[]> {
  if (_loaded) return _rules;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      _rules = raw ? sanitise(JSON.parse(raw)) : [];
    } catch (e) {
      console.warn("[pronunciationService] Failed to load rules", e);
      _rules = [];
    }
    _loaded = true;
    _loading = null;
    notify();
    return _rules;
  })();

  return _loading;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_rules));
  } catch (e) {
    console.warn("[pronunciationService] Failed to save rules", e);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Rules that apply to a document, synchronously, from cache.
 *
 * Returns the global rules plus that document's own. Before loadRules() has
 * resolved this is an empty list, which degrades to "speak the text as
 * written" rather than to a stall.
 */
export function getRulesForSync(
  documentId?: string,
): readonly PronunciationRule[] {
  if (_rules.length === 0) return _rules;
  return _rules.filter(
    (r) => r.documentId === undefined || r.documentId === documentId,
  );
}

/** Every rule, global and per-document. Cached copy. */
export function getAllRulesSync(): readonly PronunciationRule[] {
  return _rules;
}

/** Subscribe to rule changes. Returns an unsubscribe function. */
export function subscribeRules(
  fn: (rules: PronunciationRule[]) => void,
): () => void {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function makeId(): string {
  return `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a rule. Returns the stored rule, including its generated id. */
export async function addRule(
  rule: Omit<PronunciationRule, "id">,
): Promise<PronunciationRule> {
  await loadRules();
  const created: PronunciationRule = { ...rule, id: makeId() };
  _rules = [..._rules, created];
  notify();
  await persist();
  return created;
}

/** Patch an existing rule. No-op when the id is unknown. */
export async function updateRule(
  id: string,
  patch: Partial<Omit<PronunciationRule, "id">>,
): Promise<void> {
  await loadRules();
  _rules = _rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
  notify();
  await persist();
}

export async function deleteRule(id: string): Promise<void> {
  await loadRules();
  _rules = _rules.filter((r) => r.id !== id);
  notify();
  await persist();
}

/** Remove every rule scoped to one document. Used when a book is forgotten. */
export async function clearRulesForDocument(documentId: string): Promise<void> {
  await loadRules();
  _rules = _rules.filter((r) => r.documentId !== documentId);
  notify();
  await persist();
}

/** Test seam — resets the module's cache. */
export function __resetForTests(): void {
  _rules = [];
  _loaded = false;
  _loading = null;
  _listeners = [];
}
