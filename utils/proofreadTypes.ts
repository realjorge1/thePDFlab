// ============================================
// Proofread — the suggestion shape, and the span → suggestion machinery
// ---------------------------------------------
// Shared by the local pass (utils/localProofread.ts) and the remote one
// (services/ai/proofread.service.ts) so both produce IDENTICAL records and the
// editor has exactly one thing to render.
//
// THERE ARE NO CHARACTER OFFSETS IN THE WIRE CONTRACT, BY DESIGN — language
// models do not return reliable ones. A suggestion is located by searching the
// block text for `original` and taking the `occurrence`-th match. These
// helpers are what convert an internally-known span into that shape, and what
// convert it back again.
// ============================================

export type ProofreadType =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "clarity"
  | "tone"
  | "style";

export const PROOFREAD_TYPES: readonly ProofreadType[] = [
  "spelling",
  "grammar",
  "punctuation",
  "clarity",
  "tone",
  "style",
];

export type ProofreadGoal = "spelling" | "grammar" | "punctuation" | "clarity" | "tone";

export const DEFAULT_GOALS: ProofreadGoal[] = ["spelling", "grammar", "punctuation"];

/** One suggestion, exactly as P3 of the contract defines it. */
export interface ProofreadSuggestion {
  id: string;
  type: ProofreadType;
  /** An exact, verbatim substring of the block's text. 1–200 chars. */
  original: string;
  /** The text to substitute. May be "" to delete. At most 400 chars. */
  replacement: string;
  /** 1-based index of WHICH occurrence of `original` this refers to. */
  occurrence: number;
  /** Up to 32 chars immediately preceding that occurrence. A tie-break aid. */
  before: string;
  /** One short sentence, at most 140 chars, plain text. */
  reason: string;
  /** 0..1 */
  confidence: number;
  /** Where it came from. Local suggestions win when the two overlap. */
  source: "local" | "remote";
}

export interface ProofreadBlockResult {
  id: string;
  language?: string;
  suggestions: ProofreadSuggestion[];
}

/** An internally-known edit, before it is converted to the wire shape. */
export interface ProofreadSpan {
  start: number;
  end: number;
  replacement: string;
  type: ProofreadType;
  reason: string;
  confidence: number;
}

/** Field limits from P2 / P3. */
export const LIMITS = {
  ORIGINAL_MAX: 200,
  REPLACEMENT_MAX: 400,
  REASON_MAX: 140,
  BEFORE_MAX: 32,
  SUGGESTIONS_PER_BLOCK: 50,
  SUGGESTIONS_PER_RESPONSE: 200,
  BLOCK_TEXT_MAX: 4000,
  BLOCKS_PER_REQUEST: 20,
  TOTAL_CHARS_PER_REQUEST: 20_000,
} as const;

/** Count occurrences of `needle` in `hay` up to and including position `at`. */
export function occurrenceAt(hay: string, needle: string, at: number): number {
  if (!needle) return 1;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1 || idx > at) break;
    count += 1;
    if (idx === at) return count;
    from = idx + 1;
  }
  return Math.max(1, count);
}

/** The up-to-32 characters immediately preceding `at` ("" at the start). */
export function beforeAt(hay: string, at: number): string {
  if (at <= 0) return "";
  return hay.slice(Math.max(0, at - LIMITS.BEFORE_MAX), at);
}

/**
 * Find the character index of the `occurrence`-th match of `original`.
 *
 * P4.7: the app locates a suggestion client-side. `before` is used only to
 * break ties when the counts disagree — never as a locator in its own right.
 * Returns -1 when the suggestion cannot be located, and the caller must then
 * DISCARD it and show nothing.
 */
export function locateOccurrence(
  text: string,
  original: string,
  occurrence: number,
  before?: string,
): number {
  if (!text || !original) return -1;

  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(original, from);
    if (idx === -1) break;
    positions.push(idx);
    from = idx + 1;
  }
  if (positions.length === 0) return -1;

  const wanted = Math.max(1, Math.floor(occurrence || 1));
  if (wanted <= positions.length) {
    const candidate = positions[wanted - 1];
    // When `before` is supplied and agrees, we are done.
    if (!before) return candidate;
    if (beforeAt(text, candidate).endsWith(before.slice(-LIMITS.BEFORE_MAX))) {
      return candidate;
    }
    // The counts disagree with the context: fall through to the `before` scan.
  }

  // Tie-break with `before` — only ever a disambiguation aid.
  if (before) {
    const tail = before.slice(-LIMITS.BEFORE_MAX);
    for (const pos of positions) {
      if (beforeAt(text, pos).endsWith(tail)) return pos;
    }
  }

  // Out of range and no usable context → not locatable.
  return wanted <= positions.length ? positions[wanted - 1] : -1;
}

function clampReason(reason: string): string {
  const clean = (reason || "").replace(/\s+/g, " ").trim();
  return clean.length > LIMITS.REASON_MAX
    ? clean.slice(0, LIMITS.REASON_MAX - 1) + "…"
    : clean;
}

/**
 * Convert internally-known spans into contract-shaped suggestions.
 *
 * Applies the P4 safety rules: verbatim `original`, server-style computed
 * `occurrence` / `before`, no overlaps (higher confidence wins, ties go to the
 * earlier start), replacement must differ from original, and the per-block cap
 * drops lowest-confidence first.
 */
export function spansToSuggestions(
  text: string,
  spans: ProofreadSpan[],
  opts: { source: "local" | "remote"; idPrefix?: string } = { source: "local" },
): ProofreadSuggestion[] {
  const prefix = opts.idPrefix ?? (opts.source === "local" ? "l" : "r");

  const valid = spans.filter((s) => {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return false;
    if (s.start < 0 || s.end > text.length || s.end <= s.start) return false;
    const original = text.slice(s.start, s.end);
    if (!original || original.length > LIMITS.ORIGINAL_MAX) return false;
    if (s.replacement.length > LIMITS.REPLACEMENT_MAX) return false;
    // P4.4: an identical pair is not a suggestion.
    return s.replacement !== original;
  });

  const resolved = resolveOverlaps(valid);

  // Per-block cap, dropping lowest confidence first (P4.5).
  const capped =
    resolved.length > LIMITS.SUGGESTIONS_PER_BLOCK
      ? [...resolved]
          .sort((a, b) => b.confidence - a.confidence || a.start - b.start)
          .slice(0, LIMITS.SUGGESTIONS_PER_BLOCK)
          .sort((a, b) => a.start - b.start)
      : resolved;

  return capped.map((span, i) => {
    const original = text.slice(span.start, span.end);
    return {
      id: `${prefix}${i + 1}`,
      type: span.type,
      original,
      replacement: span.replacement,
      occurrence: occurrenceAt(text, original, span.start),
      before: beforeAt(text, span.start),
      reason: clampReason(span.reason),
      confidence: Math.max(0, Math.min(1, span.confidence)),
      source: opts.source,
    };
  });
}

/**
 * P4.3: no two suggestions in a block may overlap. Higher confidence wins;
 * ties go to the earlier start. Returns spans sorted by start.
 */
export function resolveOverlaps(spans: ProofreadSpan[]): ProofreadSpan[] {
  const ordered = [...spans].sort(
    (a, b) => b.confidence - a.confidence || a.start - b.start || a.end - b.end,
  );
  const kept: ProofreadSpan[] = [];
  for (const span of ordered) {
    const clashes = kept.some((k) => span.start < k.end && k.start < span.end);
    if (!clashes) kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Merge local and remote suggestions for one block, dropping any REMOTE
 * suggestion that overlaps a LOCAL one. The local pass is deterministic and
 * instant, so where the two disagree the local answer is the one already on
 * screen and the one that stays.
 */
export function mergeSuggestions(
  text: string,
  local: ProofreadSuggestion[],
  remote: ProofreadSuggestion[],
): ProofreadSuggestion[] {
  const localSpans = local
    .map((s) => toSpan(text, s))
    .filter((s): s is { start: number; end: number } => s !== null);

  const keptRemote = remote.filter((s) => {
    const span = toSpan(text, s);
    if (!span) return false; // unlocatable → discarded, per P4.7
    return !localSpans.some((l) => span.start < l.end && l.start < span.end);
  });

  const all = [...local, ...keptRemote];
  // Order by position so the editor marks read top-to-bottom.
  return all
    .map((s) => ({ s, span: toSpan(text, s) }))
    .filter((x) => x.span !== null)
    .sort((a, b) => a.span!.start - b.span!.start)
    .slice(0, LIMITS.SUGGESTIONS_PER_BLOCK)
    .map((x) => x.s);
}

/** Resolve a suggestion back to a span in `text`, or null when unlocatable. */
export function toSpan(
  text: string,
  suggestion: ProofreadSuggestion,
): { start: number; end: number } | null {
  const start = locateOccurrence(
    text,
    suggestion.original,
    suggestion.occurrence,
    suggestion.before,
  );
  if (start < 0) return null;
  return { start, end: start + suggestion.original.length };
}
