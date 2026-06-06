/**
 * Keyword & Concept Extraction
 * ─────────────────────────────────────────────────────────────────────
 * Shared, dependency-free text helpers used by the secondary intelligence
 * services (knowledge graph, context-awareness, predictive ranking,
 * research assistant, semantic search).
 *
 * Kept fully self-contained on purpose: these "secondary" features never
 * reach into — or risk — the existing relevance filter or AI services.
 * ─────────────────────────────────────────────────────────────────────
 */

/** Common English stop words + library-noise words to ignore when tokenizing. */
export const STOP_WORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "is", "it", "its", "as", "was", "that", "this", "are",
  "be", "has", "had", "have", "not", "no", "do", "does", "did", "will", "can",
  "could", "would", "should", "may", "might", "about", "into", "over", "after",
  "before", "between", "through", "during", "under", "how", "what", "which",
  "who", "when", "where", "why", "each", "every", "all", "both", "few", "more",
  "most", "other", "some", "such", "than", "too", "very", "just", "because",
  "so", "if", "then", "there", "here", "up", "out", "off", "down", "only",
  "own", "same", "also", "been", "being", "were", "while", "their", "them",
  "they", "these", "those", "your", "you", "our", "his", "her",
  // library / filename noise
  "new", "edition", "vol", "volume", "part", "chapter", "introduction",
  "final", "draft", "copy", "untitled", "document", "pdf", "epub", "docx",
]);

/** Lowercase, strip punctuation (Unicode-aware), collapse whitespace. */
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a trailing file extension from a name. */
export function stripExtension(name: string): string {
  return (name || "").replace(/\.[a-z0-9]+$/i, "");
}

/** Tokenize into meaningful words (no stop words, min length). */
export function tokenize(text: string, minLen = 3): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((w) => w.length >= minLen && !STOP_WORDS.has(w));
}

/** Unique keyword set for a piece of text. */
export function keywordSet(text: string, minLen = 3): Set<string> {
  return new Set(tokenize(text, minLen));
}

/** Keywords for a document title (extension stripped first). */
export function titleKeywords(name: string, minLen = 3): Set<string> {
  return keywordSet(stripExtension(name), minLen);
}

/** Keywords shared between two sets. */
export function sharedKeywords(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (large.has(w)) out.push(w);
  return out;
}

/** Jaccard similarity of two keyword sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (large.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Overlap coefficient relative to the SMALLER set (0..1).
 * Better than Jaccard when comparing a short query against a longer text.
 */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (large.has(w)) inter++;
  return inter / small.size;
}

/** Top-N frequency keywords from longer text (for concept discovery). */
export function topKeywords(text: string, n = 8, minLen = 4): string[] {
  const counts = new Map<string, number>();
  for (const w of tokenize(text, minLen)) {
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}
