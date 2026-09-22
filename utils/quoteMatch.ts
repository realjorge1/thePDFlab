// ============================================
// quoteMatch — find a citation quote inside document text
// ---------------------------------------------
// Citation quotes are copied from the stored document text, but the text a
// reader shows differs in small ways: curly vs straight quotes, en/em dashes,
// ligatures (ﬁ), soft hyphens, words hyphenated across a line break, and
// whitespace. Matching normalizes both sides and maps the match back to the
// ORIGINAL text, so callers can hand the exact on-page substring to a viewer's
// own search. Never throws; returns null when nothing matches.
// ============================================

export interface NormalizedText {
  text: string;
  /** map[i] = index in the original string of normalized character i. */
  map: number[];
}

export interface QuoteMatch {
  /** Start index in the original haystack (inclusive). */
  start: number;
  /** End index in the original haystack (exclusive). */
  end: number;
  /** haystack.slice(start, end) — the text as it appears in the document. */
  text: string;
  strategy: "full" | "window";
}

const SOFT_HYPHEN = "\u00AD";

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
  "\u0152": "oe",
  "\u0153": "oe",
  "\u00C6": "ae",
  "\u00E6": "ae",
};

const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032`\u00B4]/;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/;
const WHITESPACE = /[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/;
const LINE_END_HYPHENS = /[-\u2010\u2011]/;

/** A cased letter in any alphabet (no Unicode property escapes needed). */
function isLetter(ch: string | undefined): boolean {
  return !!ch && ch.toLowerCase() !== ch.toUpperCase();
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * If position `from` is followed (after spaces/tabs/CR) by a newline, return
 * the index of the first non-whitespace character after it; otherwise -1.
 */
function skipLineBreak(src: string, from: number): number {
  let j = from;
  while (j < src.length && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
  if (src[j] !== "\n") return -1;
  j++;
  while (j < src.length && WHITESPACE.test(src[j])) j++;
  return j;
}

/** Normalize text for matching while keeping a map back to the original. */
export function normalizeForMatch(input: string): NormalizedText {
  const src = typeof input === "string" ? input : "";
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // suppress leading whitespace

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    // Soft hyphen: invisible, always removed (and joins across a line break).
    if (c === SOFT_HYPHEN) {
      const j = skipLineBreak(src, i + 1);
      if (j !== -1) i = j - 1;
      continue;
    }

    // "exam-\nple" → "example": a hyphen between a letter and a line break.
    if (LINE_END_HYPHENS.test(c) && i > 0 && isLetter(src[i - 1])) {
      const j = skipLineBreak(src, i + 1);
      if (j !== -1 && isLetter(src[j])) {
        i = j - 1;
        continue;
      }
    }

    if (WHITESPACE.test(c)) {
      if (!lastWasSpace) {
        chars.push(" ");
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }

    let mapped: string;
    if (LIGATURES[c]) mapped = LIGATURES[c];
    else if (SINGLE_QUOTES.test(c)) mapped = "'";
    else if (DOUBLE_QUOTES.test(c)) mapped = '"';
    else if (DASHES.test(c)) mapped = "-";
    else if (c === "\u2026") mapped = "...";
    else mapped = c;

    const lowered = mapped.toLowerCase();
    for (let k = 0; k < lowered.length; k++) {
      chars.push(lowered[k]);
      map.push(i);
    }
    lastWasSpace = false;
  }

  if (chars.length && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { text: chars.join(""), map };
}

function toOriginal(
  haystack: string,
  norm: NormalizedText,
  idx: number,
  length: number,
  strategy: QuoteMatch["strategy"],
): QuoteMatch | null {
  if (idx < 0 || length <= 0) return null;
  const start = norm.map[idx];
  const lastOrig = norm.map[idx + length - 1];
  if (start === undefined || lastOrig === undefined) return null;
  let end = lastOrig + 1;
  const code = haystack.charCodeAt(lastOrig);
  if (code >= 0xd800 && code <= 0xdbff) end += 1; // keep surrogate pairs whole
  return { start, end, text: haystack.slice(start, end), strategy };
}

const MIN_WINDOW_WORDS = 8;
const MAX_WINDOW_WORDS = 12;

/**
 * Find `quote` in `haystack`. Tries the whole quote first, then the longest
 * 8–12-word window of it (earliest window wins at each length).
 */
export function findQuote(haystack: string, quote: string): QuoteMatch | null {
  try {
    if (typeof haystack !== "string" || typeof quote !== "string") return null;
    const nq = normalizeForMatch(quote).text;
    if (nq.length < 3) return null;
    const nh = normalizeForMatch(haystack);
    if (!nh.text) return null;

    const full = nh.text.indexOf(nq);
    if (full >= 0) return toOriginal(haystack, nh, full, nq.length, "full");

    const words = nq.split(" ").filter(Boolean);
    if (words.length < MIN_WINDOW_WORDS) return null;
    const maxW = Math.min(MAX_WINDOW_WORDS, words.length);
    for (let w = maxW; w >= MIN_WINDOW_WORDS; w--) {
      for (let s = 0; s + w <= words.length; s++) {
        const needle = words.slice(s, s + w).join(" ");
        const idx = nh.text.indexOf(needle);
        if (idx >= 0) return toOriginal(haystack, nh, idx, needle.length, "window");
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** A word made only of letters/digits, optionally ending in , . ; or : */
function isPlainWord(word: string): boolean {
  if (!word) return false;
  const body = /[,.;:]$/.test(word) ? word.slice(0, -1) : word;
  if (!body) return false;
  for (const ch of body) {
    if (!isLetter(ch) && !isDigit(ch)) return false;
  }
  return true;
}

/**
 * A short, distinctive run of words from a quote, suitable for a viewer's
 * plain substring search (which cannot normalize). Prefers plain words that
 * viewers render identically. Never throws.
 */
export function pickSearchRun(quote: string, minWords = 6, maxWords = 10): string {
  try {
    const words = (quote || "")
      .split(SOFT_HYPHEN)
      .join("")
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return "";
    if (words.length <= maxWords) return words.join(" ");
    const size = Math.max(minWords, Math.min(maxWords, words.length));
    let best = 0;
    let bestScore = -1;
    for (let s = 0; s + size <= words.length; s++) {
      let score = 0;
      for (let k = s; k < s + size; k++) {
        if (isPlainWord(words[k])) score += 1;
        if (words[k].length >= 6) score += 0.25;
      }
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return words
      .slice(best, best + size)
      .join(" ")
      .replace(/[,.;:]$/, "");
  } catch {
    return "";
  }
}
