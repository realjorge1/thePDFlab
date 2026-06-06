// ============================================
// Semantic Search (AI query-expansion)
// ============================================
// Most search matches words; this matches MEANING. A query like
//   "disease where mother attacks baby's blood"
// expands (via the existing backend chat) into the concepts that actually
// appear in titles — "haemolytic disease of the newborn", "Rh incompatibility",
// "anti-D antibodies" — then reuses the EXISTING relevance filter to rank.
//
// Design guarantees (so existing search NEVER degrades):
//   • The original keyword results are computed first and always rank highest.
//   • AI expansion only ADDS semantically-related hits below them.
//   • If AI is unavailable (offline / free user / timeout), the result is
//     byte-for-byte the current keyword search — semanticFilter === filter.
//
// SECONDARY / additive: wraps filterByRelevance, never modifies it.
// ============================================

import { filterByRelevance } from "@/src/services/library/relevanceFilter";
import type { SearchResult } from "@/src/types/library.types";
import { hasAIPremiumAccess } from "@/services/ai/premiumGuard";
import { parseListReply, quickChat } from "@/services/ai/quickChat";
import { normalizeText } from "@/utils/keywords";

export interface QueryExpansion {
  /** The expanded phrases/terms (always includes the original query first). */
  terms: string[];
  /** Whether the AI actually contributed (false = local-only fallback). */
  usedAI: boolean;
}

// ─── Expansion cache (in-memory, per session) ─────────────────────────────────
const expansionCache = new Map<string, QueryExpansion>();
const MAX_CACHE = 100;

function cacheGet(key: string): QueryExpansion | undefined {
  return expansionCache.get(key);
}
function cacheSet(key: string, value: QueryExpansion) {
  if (expansionCache.size >= MAX_CACHE) {
    const first = expansionCache.keys().next().value;
    if (first !== undefined) expansionCache.delete(first);
  }
  expansionCache.set(key, value);
}

/** True when semantic enhancement can run (AI available for this user). */
export function isSemanticAvailable(): boolean {
  return hasAIPremiumAccess();
}

/**
 * Expand a query into related meaning-equivalent phrases. Falls back to just
 * the original query when AI is unavailable. Never throws.
 */
export async function expandQuery(
  query: string,
  signal?: AbortSignal,
): Promise<QueryExpansion> {
  const original = query.trim();
  if (!original) return { terms: [], usedAI: false };

  const key = normalizeText(original);
  const cached = cacheGet(key);
  if (cached) return cached;

  const fallback: QueryExpansion = { terms: [original], usedAI: false };
  if (!isSemanticAvailable()) return fallback;

  const prompt =
    `A user is searching an academic / book / research library for:\n"${original}"\n\n` +
    `List 4-6 alternative search phrases and precise topic terms that capture the ` +
    `MEANING of that query — include technical, medical, or scientific equivalents ` +
    `and the formal name of the concept if there is one. ` +
    `Return ONLY a comma-separated list of short phrases, no numbering, no explanation.`;

  const reply = await quickChat(prompt, { signal, timeoutMs: 12_000 });
  if (!reply) return fallback;

  const terms = parseListReply(reply, 8);
  if (terms.length === 0) return fallback;

  // Original query always leads; de-dupe expanded terms against it.
  const merged = [original];
  const seen = new Set([key]);
  for (const t of terms) {
    const tk = normalizeText(t);
    if (tk && !seen.has(tk)) {
      seen.add(tk);
      merged.push(t);
    }
  }

  const result: QueryExpansion = { terms: merged, usedAI: true };
  cacheSet(key, result);
  return result;
}

export interface SemanticFilterOptions {
  signal?: AbortSignal;
  /** Set false to force plain keyword search (identical to filterByRelevance). */
  enableAI?: boolean;
}

/**
 * Semantic search over a result set.
 *
 * Returns the existing keyword results FIRST (unchanged order), then appends
 * meaning-related results the original keywords missed. When AI is off/unavailable
 * the output is exactly `filterByRelevance(query, results)`.
 */
export async function semanticFilter(
  query: string,
  results: SearchResult[],
  opts: SemanticFilterOptions = {},
): Promise<SearchResult[]> {
  // Existing behavior — always computed, always the baseline.
  const base = filterByRelevance(query, results);

  const original = query.trim();
  if (!original || opts.enableAI === false || !isSemanticAvailable()) {
    return base;
  }

  let expansion: QueryExpansion;
  try {
    expansion = await expandQuery(original, opts.signal);
  } catch {
    return base; // any failure → unchanged keyword search
  }

  // Expanded terms beyond the original (which is index 0).
  const extraTerms = expansion.terms.slice(1);
  if (extraTerms.length === 0) return base;

  // Rank map: base results keep their leading positions.
  const order = new Map<string, number>();
  base.forEach((r, i) => order.set(r.id, i));

  let nextRank = base.length;
  const merged: SearchResult[] = [...base];

  for (const term of extraTerms) {
    const hits = filterByRelevance(term, results);
    for (const r of hits) {
      if (!order.has(r.id)) {
        order.set(r.id, nextRank++);
        merged.push(r);
      }
    }
  }

  return merged;
}
