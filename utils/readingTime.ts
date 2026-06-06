/**
 * Reading Time Estimation
 * ─────────────────────────────────────────────────────────────────────
 * Estimates how long a document takes to read at an average adult reading
 * speed. Pure, dependency-free, and safe to call from anywhere.
 *
 *   readingMinutes = wordCount / WORDS_PER_MINUTE      (default 200 wpm)
 *
 * This is a SECONDARY, additive helper — it reads nothing and mutates
 * nothing, so it cannot affect any existing feature.
 * ─────────────────────────────────────────────────────────────────────
 */

/** Average adult silent reading speed (words per minute). */
export const DEFAULT_WPM = 200;

/** Rough average of body words on a typical document page. */
export const AVG_WORDS_PER_PAGE = 300;

/** Count words in a block of text (whitespace-delimited). */
export function countWords(text: string): number {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Estimate reading time in minutes from a raw word count.
 * Always returns a finite, non-negative number.
 */
export function estimateReadingMinutes(
  wordCount: number,
  wpm: number = DEFAULT_WPM,
): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;
  const speed = Number.isFinite(wpm) && wpm > 0 ? wpm : DEFAULT_WPM;
  return wordCount / speed;
}

/** Estimate reading time in minutes directly from text. */
export function estimateReadingMinutesFromText(
  text: string,
  wpm: number = DEFAULT_WPM,
): number {
  return estimateReadingMinutes(countWords(text), wpm);
}

/**
 * Estimate reading time for a paginated document when the exact word count
 * is unknown, using an average words-per-page heuristic.
 */
export function estimateReadingMinutesFromPages(
  pageCount: number,
  wordsPerPage: number = AVG_WORDS_PER_PAGE,
  wpm: number = DEFAULT_WPM,
): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;
  return estimateReadingMinutes(pageCount * wordsPerPage, wpm);
}

/**
 * Human-readable label: "< 1 min read", "7 min read", "1h 5m read".
 * Pass `suffix=""` for just the duration.
 */
export function formatReadingTime(minutes: number, suffix = " read"): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return `< 1 min${suffix}`;
  const rounded = Math.round(minutes);
  if (rounded < 1) return `< 1 min${suffix}`;
  if (rounded < 60) return `${rounded} min${suffix}`;
  const hours = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem ? `${hours}h ${rem}m${suffix}` : `${hours}h${suffix}`;
}
