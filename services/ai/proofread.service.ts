// ============================================
// Proofread Service (contract §4)
// ---------------------------------------------
// The network half of proofreading. The local half (utils/localProofread.ts)
// needs none of this and runs regardless — if everything here fails, the
// feature degrades to "fewer suggestions", never to "broken".
//
// FOUR THINGS THIS FILE IS CAREFUL ABOUT
//
// 1. IT IS NOT A DOCUMENT TASK. 20 s per attempt (P5.1), not the 180 s
//    whole-document budget. A proofread check is on the typing path, and a
//    request that hangs for three minutes is worse than no request.
//
// 2. THE APP SPLITS THE WORK (P2). Chunking to 20 blocks / 20,000 chars per
//    request, and splitting any block over 4,000 chars at a sentence
//    boundary, happens HERE. The server is never relied on to split.
//
// 3. SUGGESTIONS ARE LOCATED CLIENT-SIDE (P4.7). There are no character
//    offsets anywhere in the contract, by design — models do not return
//    reliable ones. Each suggestion is found by searching the block text for
//    `original` and taking the `occurrence`-th match, with `before` only as a
//    tie-break. Anything that cannot be located is DISCARDED and shown to
//    nobody.
//
// 4. THE PARSE IS HOSTILE-INPUT-SAFE. Every field is validated against P3
//    before use, in the same spirit as normalizeDevilsAdvocate /
//    normalizeNarrativeArc. A malformed response yields ZERO suggestions —
//    never a crash, and never a partially-applied edit.
//
// No warm-up pings, ever (the owner keeps servers warm externally), and every
// call goes through resilientFetch so the failover pool works unchanged.
// ============================================

import { API_ENDPOINTS, resilientFetch } from "@/config/api";
import { AI_PROOFREAD } from "@/constants/featureFlags";
import { aiErrorFromResponseBody, normalizeAIError, type AIError } from "@/services/ai/aiErrors";
import { canUse } from "@/services/ai/capabilities";
import { assertAIPremium } from "@/services/ai/premiumGuard";
import { localProofread, type LocalProofreadOptions } from "@/utils/localProofread";
import {
  DEFAULT_GOALS,
  LIMITS,
  locateOccurrence,
  mergeSuggestions,
  PROOFREAD_TYPES,
  beforeAt,
  occurrenceAt,
  type ProofreadBlockResult,
  type ProofreadGoal,
  type ProofreadSuggestion,
  type ProofreadType,
} from "@/utils/proofreadTypes";

/** P5.1: the server answers within 15 s; the app allows 20 s per attempt. */
export const PROOFREAD_TIMEOUT_MS = 20_000;

export interface ProofreadBlockInput {
  id: string;
  text: string;
}

export interface ProofreadOptions {
  /** "auto" (default) or a BCP-47 tag. */
  language?: string;
  /** "us", "uk" or null (default null). */
  dialect?: "us" | "uk" | null;
  goals?: ProofreadGoal[];
  signal?: AbortSignal;
  /** Skip the in-memory cache (an explicit "Check document"). */
  noCache?: boolean;
  /** Options handed to the local pass. */
  local?: LocalProofreadOptions;
}

/** True when the remote half may run at all. */
export function canProofreadRemotely(): boolean {
  return canUse(AI_PROOFREAD, "proofread");
}

// ─── Request body (P2) ────────────────────────────────────────────────────────

export interface ProofreadRequestBody {
  blocks: { id: string; text: string }[];
  language: string;
  dialect: "us" | "uk" | null;
  goals: ProofreadGoal[];
}

function normalizeGoals(goals?: ProofreadGoal[]): ProofreadGoal[] {
  const allowed: ProofreadGoal[] = ["spelling", "grammar", "punctuation", "clarity", "tone"];
  if (!Array.isArray(goals) || goals.length === 0) return [...DEFAULT_GOALS];
  const picked = goals.filter((g) => allowed.includes(g));
  return picked.length ? Array.from(new Set(picked)) : [...DEFAULT_GOALS];
}

/**
 * Split a block that exceeds the 4,000-char limit at a SENTENCE boundary.
 *
 * Parts keep the parent id with a "#n" suffix so results can be stitched back
 * together, and every part's text is a verbatim slice of the parent, so an
 * `original` located in a part is located identically in the parent.
 */
export function splitOversizeBlock(block: ProofreadBlockInput): ProofreadBlockInput[] {
  const { id, text } = block;
  if (text.length <= LIMITS.BLOCK_TEXT_MAX) return [{ id, text }];

  const parts: ProofreadBlockInput[] = [];
  let offset = 0;
  let index = 0;

  while (offset < text.length) {
    let end = Math.min(offset + LIMITS.BLOCK_TEXT_MAX, text.length);
    if (end < text.length) {
      // Prefer the last sentence end inside the window.
      const window = text.slice(offset, end);
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf("\n"),
      );
      // Only honour it if it leaves a reasonably full chunk.
      if (sentence > LIMITS.BLOCK_TEXT_MAX * 0.5) {
        end = offset + sentence + 1;
      } else {
        const space = window.lastIndexOf(" ");
        if (space > LIMITS.BLOCK_TEXT_MAX * 0.5) end = offset + space + 1;
      }
    }
    parts.push({ id: `${id}#${index}`, text: text.slice(offset, end) });
    offset = end;
    index += 1;
  }
  return parts;
}

/**
 * Group blocks into requests that respect BOTH P2 limits: at most 20 blocks
 * and at most 20,000 characters of text per request.
 */
export function chunkBlocks(blocks: ProofreadBlockInput[]): ProofreadBlockInput[][] {
  const chunks: ProofreadBlockInput[][] = [];
  let current: ProofreadBlockInput[] = [];
  let chars = 0;

  for (const block of blocks) {
    const size = block.text.length;
    const wouldExceed =
      current.length >= LIMITS.BLOCKS_PER_REQUEST ||
      (current.length > 0 && chars + size > LIMITS.TOTAL_CHARS_PER_REQUEST);
    if (wouldExceed) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Prepare blocks for the wire: drop empties, split oversize, then chunk. */
export function prepareBlocks(blocks: ProofreadBlockInput[]): ProofreadBlockInput[][] {
  const usable = (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && typeof b.id === "string" && b.id && typeof b.text === "string")
    .filter((b) => b.text.trim().length > 0)
    .map((b) => ({ id: b.id.slice(0, 64), text: b.text }));

  const split: ProofreadBlockInput[] = [];
  for (const block of usable) split.push(...splitOversizeBlock(block));
  return chunkBlocks(split);
}

export function buildRequestBody(
  blocks: ProofreadBlockInput[],
  opts: ProofreadOptions,
): ProofreadRequestBody {
  return {
    blocks: blocks.map((b) => ({ id: b.id, text: b.text })),
    language: opts.language || "auto",
    dialect: opts.dialect ?? null,
    goals: normalizeGoals(opts.goals),
  };
}

// ─── Response parsing (P3 / P4) ───────────────────────────────────────────────

function isType(v: unknown): v is ProofreadType {
  return typeof v === "string" && (PROOFREAD_TYPES as readonly string[]).includes(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Turn one raw block entry into validated, LOCATED suggestions against the
 * block text we actually sent. Anything that fails a P3 rule or cannot be
 * located is dropped silently.
 */
export function parseBlockSuggestions(
  raw: unknown,
  text: string,
): ProofreadSuggestion[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return [];

  const located: {
    suggestion: ProofreadSuggestion;
    start: number;
    end: number;
  }[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;

    // Both fields must be genuine strings. Coercing a non-string to "" would
    // silently turn a garbled or hostile payload into "delete this text",
    // which one tap then applies to the user's document.
    if (typeof s.original !== "string" || typeof s.replacement !== "string") continue;
    const original = s.original;
    const replacement = s.replacement;

    // P3 field rules. An empty replacement is legitimate — it means delete —
    // but only when the server actually sent an empty string.
    if (!original || original.length > LIMITS.ORIGINAL_MAX) continue;
    if (replacement.length > LIMITS.REPLACEMENT_MAX) continue;
    // P4.4: identical pairs are not suggestions.
    if (replacement === original) continue;

    const occurrenceRaw = s.occurrence;
    const occurrence =
      typeof occurrenceRaw === "number" && Number.isFinite(occurrenceRaw) && occurrenceRaw >= 1
        ? Math.floor(occurrenceRaw)
        : 1;

    // P4.7: locate client-side; `before` only breaks ties.
    const start = locateOccurrence(text, original, occurrence, str(s.before));
    if (start < 0) continue; // cannot locate → discard, show nothing

    const confidenceRaw = s.confidence;
    const confidence =
      typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : 0.5;

    const reason = str(s.reason).replace(/\s+/g, " ").trim().slice(0, LIMITS.REASON_MAX);

    located.push({
      start,
      end: start + original.length,
      suggestion: {
        id: str(s.id) || `r${located.length + 1}`,
        type: isType(s.type) ? s.type : "grammar",
        original,
        replacement,
        // Recompute from the position WE found, not the value we were sent.
        occurrence: occurrenceAt(text, original, start),
        before: beforeAt(text, start),
        reason,
        confidence,
        source: "remote",
      },
    });
  }

  // P4.3: drop overlaps, higher confidence wins, ties to the earlier start.
  const ordered = [...located].sort(
    (a, b) => b.suggestion.confidence - a.suggestion.confidence || a.start - b.start,
  );
  const kept: typeof located = [];
  for (const candidate of ordered) {
    if (kept.some((k) => candidate.start < k.end && k.start < candidate.end)) continue;
    kept.push(candidate);
  }

  // P4.5: per-block cap, lowest confidence dropped first.
  return kept
    .sort((a, b) => b.suggestion.confidence - a.suggestion.confidence)
    .slice(0, LIMITS.SUGGESTIONS_PER_BLOCK)
    .sort((a, b) => a.start - b.start)
    .map((x) => x.suggestion);
}

/** Parse a whole response body. Malformed → empty map, never a throw. */
export function parseProofreadResponse(
  body: unknown,
  sent: ProofreadBlockInput[],
): Map<string, ProofreadSuggestion[]> {
  const out = new Map<string, ProofreadSuggestion[]>();
  const byId = new Map(sent.map((b) => [b.id, b.text]));

  if (!body || typeof body !== "object") return out;
  const root = body as Record<string, unknown>;
  if (root.success === false) return out;

  const data = root.data;
  if (!data || typeof data !== "object") return out;
  const blocks = (data as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return out;

  let total = 0;
  for (const entry of blocks) {
    if (!entry || typeof entry !== "object") continue;
    const id = str((entry as Record<string, unknown>).id);
    if (!id || !byId.has(id)) continue; // an id we never sent
    if (out.has(id)) continue; // a duplicate entry

    const suggestions = parseBlockSuggestions(entry, byId.get(id)!);
    // P4.5: 200 per response.
    const room = Math.max(0, LIMITS.SUGGESTIONS_PER_RESPONSE - total);
    const capped = suggestions.slice(0, room);
    total += capped.length;
    out.set(id, capped);
  }
  return out;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/**
 * Content-hash cache. Users re-check the same paragraph constantly (every
 * debounce after every keystroke elsewhere in the document); without this the
 * endpoint gets hammered for answers we already have.
 */
const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, ProofreadSuggestion[]>();

/** Normalize the way the server does before hashing: whitespace-insensitive. */
function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The dependency-free 32-bit string hash used elsewhere in this repo. */
export function hashText(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function cacheKeyFor(text: string, opts: ProofreadOptions): string {
  const optionPart = `${opts.language || "auto"}|${opts.dialect ?? "null"}|${normalizeGoals(
    opts.goals,
  )
    .slice()
    .sort()
    .join(",")}`;
  return `${hashText(normalizeForHash(text))}|${hashText(optionPart)}`;
}

function cacheGet(key: string): ProofreadSuggestion[] | undefined {
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency (Map preserves insertion order).
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: ProofreadSuggestion[]): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearProofreadCache(): void {
  cache.clear();
}

export function proofreadCacheSize(): number {
  return cache.size;
}

// ─── The call ─────────────────────────────────────────────────────────────────

async function postChunk(
  chunk: ProofreadBlockInput[],
  opts: ProofreadOptions,
): Promise<Map<string, ProofreadSuggestion[]>> {
  const body = buildRequestBody(chunk, opts);

  const res = await resilientFetch(
    API_ENDPOINTS.AI.PROOFREAD,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
    { timeoutMs: PROOFREAD_TIMEOUT_MS },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw aiErrorFromResponseBody(res.status, text, {
      headers: res.headers,
      statusText: res.statusText,
    });
  }

  const json = await res.json().catch(() => null);
  return parseProofreadResponse(json, chunk);
}

/** Stitch "#n" part results back onto their parent block id. */
function parentIdOf(id: string): string {
  const hash = id.lastIndexOf("#");
  return hash > 0 ? id.slice(0, hash) : id;
}

export interface ProofreadOutcome {
  blocks: ProofreadBlockResult[];
  /** True when the remote half ran and returned. */
  usedRemote: boolean;
  /** Set when the remote half failed. The local results are still valid. */
  error?: AIError;
}

/**
 * Proofread a set of blocks.
 *
 * ALWAYS returns local suggestions, even when the remote half is off, gated,
 * cached-out or broken. `error` is populated for the caller to decide what to
 * do with — and per P5.5, an automatic (debounced) check must show NOTHING at
 * all, while only an explicit "Check document" surfaces it.
 */
export async function proofreadBlocks(
  blocks: ProofreadBlockInput[],
  opts: ProofreadOptions = {},
): Promise<ProofreadOutcome> {
  const input = (Array.isArray(blocks) ? blocks : []).filter(
    (b) => b && typeof b.id === "string" && typeof b.text === "string",
  );

  // 1. The local pass. Free, instant, offline, no gate.
  const localByParent = new Map<string, ProofreadSuggestion[]>();
  const textByParent = new Map<string, string>();
  for (const block of input) {
    textByParent.set(block.id, block.text);
    localByParent.set(block.id, localProofread(block.text, opts.local));
  }

  const buildResult = (
    remoteByParent: Map<string, ProofreadSuggestion[]>,
  ): ProofreadBlockResult[] =>
    input.map((block) => ({
      id: block.id,
      suggestions: mergeSuggestions(
        block.text,
        localByParent.get(block.id) ?? [],
        remoteByParent.get(block.id) ?? [],
      ),
    }));

  // 2. The remote half — only when the flag AND the capability are both on.
  if (!canProofreadRemotely()) {
    return { blocks: buildResult(new Map()), usedRemote: false };
  }

  try {
    assertAIPremium();
  } catch (e) {
    return {
      blocks: buildResult(new Map()),
      usedRemote: false,
      error: normalizeAIError(e),
    };
  }

  // 3. Serve what the cache already knows; only ask about the rest.
  const remoteByParent = new Map<string, ProofreadSuggestion[]>();
  const needed: ProofreadBlockInput[] = [];
  for (const block of input) {
    if (!block.text.trim()) continue;
    const key = cacheKeyFor(block.text, opts);
    const hit = opts.noCache ? undefined : cacheGet(key);
    if (hit) remoteByParent.set(block.id, hit);
    else needed.push(block);
  }

  if (needed.length === 0) {
    return { blocks: buildResult(remoteByParent), usedRemote: true };
  }

  const chunks = prepareBlocks(needed);
  let error: AIError | undefined;

  for (const chunk of chunks) {
    try {
      const parsed = await postChunk(chunk, opts);
      for (const [sentId, suggestions] of parsed) {
        const parent = parentIdOf(sentId);
        const existing = remoteByParent.get(parent) ?? [];
        remoteByParent.set(parent, [...existing, ...suggestions]);
      }
    } catch (e) {
      error = normalizeAIError(e, { signal: opts.signal ?? null });
      // A cancelled check stops immediately; other failures leave whatever
      // earlier chunks already produced in place.
      if (error.code === "CANCELLED") break;
    }
  }

  // Cache only complete, successful answers for a block.
  if (!error) {
    for (const block of needed) {
      const suggestions = remoteByParent.get(block.id) ?? [];
      cacheSet(cacheKeyFor(block.text, opts), suggestions);
    }
  }

  return {
    blocks: buildResult(remoteByParent),
    usedRemote: !error,
    ...(error ? { error } : {}),
  };
}

/** Local-only pass, for airplane mode and for the no-flag path. */
export function proofreadLocally(
  blocks: ProofreadBlockInput[],
  opts: LocalProofreadOptions = {},
): ProofreadBlockResult[] {
  return (Array.isArray(blocks) ? blocks : []).map((b) => ({
    id: b.id,
    suggestions: localProofread(b.text, opts),
  }));
}
