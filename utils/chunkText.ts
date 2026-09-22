/**
 * chunkText.ts
 * Splits plain text into TTS-friendly chunks.
 * Handles PDF, DOCX, and EPUB extraction artifacts.
 */

const MAX_CHUNK_CHARS = 300;

/**
 * Consecutive sentences are packed into one utterance up to this length.
 *
 * Every utterance boundary costs a stop and a fresh start in the speech
 * engine — a few hundred milliseconds of silence on most voices — so one
 * utterance per sentence made reading sound halting, with a gap after every
 * full stop. The engine's own pause between sentences *inside* an utterance is
 * short and natural.
 *
 * Deliberately well under MAX_CHUNK_CHARS: a chunk is also the unit that
 * "skip 10 s" moves by and that an engine without word boundaries replays on
 * resume, so packing all the way to the limit would make both coarse.
 */
const PACK_TARGET_CHARS = 200;

/** Text that finishes a sentence, allowing a closing quote or bracket. */
const SENTENCE_END = /[.!?]["'”’)\]]*\s*$/;

/**
 * Version of the chunk layout that saved positions refer to.
 *
 * 1 — one chunk per sentence (the original layout).
 * 2 — consecutive sentences packed up to PACK_TARGET_CHARS within a paragraph.
 */
export const CHUNK_LAYOUT_VERSION = 2;

// ---------------------------------------------------------------------------
// PDF / DOCX text cleaning
// ---------------------------------------------------------------------------

export function cleanPdfText(raw: string): string {
  return raw
    .replace(/(\w)-\n(\w)/g, "$1$2") // de-hyphenate line breaks
    .replace(/(?<!\n)\n(?!\n)/g, " ") // single newlines → space
    .replace(/[ \t]{2,}/g, " ") // collapse spaces
    .replace(/\n{3,}/g, "\n\n") // max 2 consecutive newlines
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

/** @deprecated Use cleanPdfText instead. Kept for backward compatibility. */
export const cleanText = cleanPdfText;

// ---------------------------------------------------------------------------
// EPUB text cleaning  (text has already had HTML stripped by epubExtractor)
// ---------------------------------------------------------------------------

export function cleanEpubText(raw: string): string {
  return (
    raw
      // Remove any residual HTML tags that slipped through
      .replace(/<[^>]+>/g, " ")
      // Normalise whitespace
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      // Remove lines that are only numbers (page markers from some EPUBs)
      .replace(/^\s*\d+\s*$/gm, "")
      // Remove lines shorter than 2 chars (stray punctuation, etc.)
      .replace(/^.{0,1}$/gm, "")
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Sentence splitter  (shared by PDF, DOCX, and EPUB)
// ---------------------------------------------------------------------------

function splitIntoSentences(text: string): string[] {
  const abbreviations =
    /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|Fig|No|Vol|Ch|pp)\.\s/g;
  const placeholder = "___ABBR___";
  const safe = text.replace(abbreviations, (m) => m.replace(". ", placeholder));

  const parts = safe
    .split(/(?<=[.!?])\s+(?=[A-Z"'\u201C])/)
    .map((s) => s.replace(/___ABBR___/g, ". ").trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [text.trim()];
}

// ---------------------------------------------------------------------------
// Enforce MAX_CHUNK_CHARS
// ---------------------------------------------------------------------------

function enforceMaxLength(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];

  const chunks: string[] = [];
  const commaParts = sentence.split(/,\s+/);
  let current = "";

  for (const part of commaParts) {
    const candidate = current ? `${current}, ${part}` : part;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      current = candidate;
    } else {
      if (current) chunks.push(current.trim());
      if (part.length > MAX_CHUNK_CHARS) {
        const words = part.split(" ");
        current = "";
        for (const word of words) {
          const next = current ? `${current} ${word}` : word;
          if (next.length <= MAX_CHUNK_CHARS) {
            current = next;
          } else {
            if (current) chunks.push(current.trim());
            current = word;
          }
        }
      } else {
        current = part;
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// ---------------------------------------------------------------------------
// Public: chunk a single text block
// ---------------------------------------------------------------------------

/** A chunk plus the structural facts the player needs about it. */
interface DetailedChunk {
  text: string;
  /** True when this chunk opens a paragraph in the cleaned source. */
  startsParagraph: boolean;
  /** How many sentence-sized pieces were packed into this chunk. */
  sentenceCount: number;
  /** Offset of `text` within the cleaned source it came from. */
  charStart: number;
  /** Exclusive end offset within the cleaned source. */
  charEnd: number;
}

/**
 * Chunk a text block, keeping track of where paragraphs begin.
 *
 * Paragraph position is only knowable here — cleanPdfText() has already
 * collapsed single newlines into spaces, so by the time anything downstream
 * sees a chunk the blank-line structure is gone.
 */
function chunkTextDetailed(
  raw: string,
  source: "pdf" | "epub" | "docx",
): DetailedChunk[] {
  const cleaned = source === "epub" ? cleanEpubText(raw) : cleanPdfText(raw);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: DetailedChunk[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Sentence-sized pieces, each already within MAX_CHUNK_CHARS. These are
    // exactly the chunks of layout 1, which is what sentenceCount counts.
    const pieces: string[] = [];
    for (const sentence of splitIntoSentences(trimmed)) {
      for (const text of enforceMaxLength(sentence)) {
        if (text) pieces.push(text);
      }
    }

    // Pack consecutive pieces while they fit. Packing never crosses a
    // paragraph, so paragraph starts and the inter-paragraph pause survive.
    let first = true;
    let current = "";
    let count = 0;

    const flush = () => {
      if (!current) return;
      chunks.push({
        text: current,
        startsParagraph: first,
        sentenceCount: count,
        charStart: 0,
        charEnd: 0,
      });
      first = false;
      current = "";
      count = 0;
    };

    for (const piece of pieces) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (current && candidate.length > PACK_TARGET_CHARS) {
        flush();
        current = piece;
      } else {
        current = candidate;
      }
      count += 1;
    }
    flush();
  }

  // Locate each chunk in the cleaned source, scanning forward so repeated
  // sentences resolve to the right occurrence. Splitting can trim or rejoin a
  // little whitespace, so a full-text miss retries on the chunk's opening
  // words, and only then falls back to "immediately after the previous
  // chunk" — approximate rather than wrong, and never out of order.
  let cursor = 0;
  for (const chunk of chunks) {
    let found = cleaned.indexOf(chunk.text, cursor);
    if (found < 0) found = cleaned.indexOf(chunk.text.slice(0, 40), cursor);
    chunk.charStart = found >= 0 ? found : cursor;
    chunk.charEnd = Math.min(
      cleaned.length,
      chunk.charStart + chunk.text.length,
    );
    cursor = chunk.charEnd;
  }

  return chunks;
}

/**
 * Returns an array of ready-to-speak text chunks from a raw text string.
 * The optional `source` parameter selects the appropriate cleaning strategy.
 */
export function chunkText(
  raw: string,
  source: "pdf" | "epub" | "docx" = "pdf",
): string[] {
  return chunkTextDetailed(raw, source).map((c) => c.text);
}

/**
 * Map a chunk index saved under layout 1 (one chunk per sentence) onto the
 * current chunk list.
 *
 * Exact, not proportional: every chunk records how many layout-1 chunks it
 * packs, so a running total finds the chunk that now holds the saved sentence.
 * Returns -1 when that sentence lies beyond the chunks loaded so far — PDF text
 * streams in page by page — so the caller can wait instead of guessing.
 */
export function mapLegacyChunkIndex(
  chunks: readonly TextChunk[],
  legacyIndex: number,
): number {
  if (!Number.isFinite(legacyIndex) || legacyIndex < 0) return 0;
  let covered = 0;
  for (let i = 0; i < chunks.length; i++) {
    covered += chunks[i].sentenceCount ?? 1;
    if (legacyIndex < covered) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A text chunk with metadata for tracking page and global position.
 */
export interface TextChunk {
  text: string;
  /** For PDF/DOCX: 0-based page index. For EPUB: 0-based chapter index. */
  pageIndex: number;
  chunkIndex: number; // global index across all pages
  /**
   * True when this chunk opens a paragraph. Drives the optional inter-
   * paragraph pause; absent on chunks built before this existed, which reads
   * as "no pause".
   */
  startsParagraph?: boolean;
  /**
   * How many sentence-sized pieces this chunk packs together. Chunks used to
   * be one sentence each, so a position saved under that layout is mapped
   * through this count — see mapLegacyChunkIndex(). Absent means 1.
   */
  sentenceCount?: number;
  /**
   * Absolute start offset of `text` within its page/chapter source — the
   * **cleaned** text that was chunked, not the raw source a viewer renders.
   * The two differ (see cleanPdfText), which is why the word highlighters
   * locate text by normalised search rather than by these offsets.
   */
  charStart?: number;
  /** Absolute end offset, exclusive. See `charStart`. */
  charEnd?: number;
}

// ---------------------------------------------------------------------------
// Running headers & footers
// ---------------------------------------------------------------------------

/** Below this many pages there is not enough evidence to call a line running. */
const RUNNING_HEADER_MIN_PAGES = 4;

/** Body text repeats too; only short lines are plausible running heads. */
const RUNNING_HEADER_MAX_LINE_CHARS = 80;

/**
 * Running heads are labels, not prose — a title, a chapter name, a page
 * number. Digits are normalised away before lines are compared, which on its
 * own would make any short numbered body line ("Figure 3.") look like a
 * running foot; the word cap is what keeps real sentences out.
 */
const RUNNING_HEADER_MAX_WORDS = 8;

/** Share of pages a line must appear on to count as running. */
const RUNNING_HEADER_PAGE_FRACTION = 0.6;

/** How many non-empty lines from each edge of a page are candidates. */
const RUNNING_HEADER_EDGE_LINES = 2;

/**
 * Indices of the lines at the top and bottom of a page.
 *
 * Counted over non-empty lines: extracted PDF text is full of blank lines, and
 * letting them consume the edge budget would either miss the real head or
 * reach far enough down the page to put body text at risk.
 */
function edgeIndices(lines: string[]): number[] {
  const nonEmpty: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) nonEmpty.push(i);
  }

  const out = new Set<number>();
  const span = Math.min(RUNNING_HEADER_EDGE_LINES, nonEmpty.length);
  for (let k = 0; k < span; k++) {
    out.add(nonEmpty[k]);
    out.add(nonEmpty[nonEmpty.length - 1 - k]);
  }
  return [...out];
}

/** Could this line plausibly be a running head or foot rather than prose? */
function isPlausibleRunningLine(trimmed: string): boolean {
  if (!trimmed || trimmed.length > RUNNING_HEADER_MAX_LINE_CHARS) return false;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return words <= RUNNING_HEADER_MAX_WORDS;
}

/**
 * Collapse the parts of a line that legitimately vary between pages, so a
 * running head like "Chapter 3 — Method    47" matches its neighbours.
 */
function recurrenceKey(line: string): string {
  return line.trim().replace(/\d+/g, "#").replace(/\s+/g, " ").toLowerCase();
}

/**
 * Remove lines that recur near the edge of most pages — running heads, feet
 * and page numbers.
 *
 * Operates on **raw** page text, before cleanPdfText() turns single newlines
 * into spaces and destroys the line structure this depends on. Conservative by
 * design: it needs several pages of evidence, ignores long lines, and only
 * looks at the first and last few lines of each page.
 */
export function stripRunningHeaders(pages: string[]): string[] {
  if (pages.length < RUNNING_HEADER_MIN_PAGES) return pages;

  const pageLines = pages.map((p) => (p ?? "").split(/\r?\n/));
  const counts = new Map<string, number>();

  for (const lines of pageLines) {
    const seen = new Set<string>();
    for (const i of edgeIndices(lines)) {
      const trimmed = (lines[i] ?? "").trim();
      if (!isPlausibleRunningLine(trimmed)) continue;
      const key = recurrenceKey(trimmed);
      // Count each distinct line once per page, so a line repeated twice on
      // one page cannot reach the threshold on its own.
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = pages.length * RUNNING_HEADER_PAGE_FRACTION;
  const running = new Set(
    [...counts.entries()].filter(([, n]) => n > threshold).map(([k]) => k),
  );
  if (running.size === 0) return pages;

  return pageLines.map((lines) => {
    const edges = new Set(edgeIndices(lines));
    return lines
      .filter((line, i) => {
        if (!edges.has(i)) return true;
        const trimmed = line.trim();
        if (!isPlausibleRunningLine(trimmed)) return true;
        return !running.has(recurrenceKey(trimmed));
      })
      .join("\n");
  });
}

export interface ChunkPagesOptions {
  /**
   * Strip running heads and feet before chunking.
   *
   * Defaults to **off**: the heuristic is conservative but it is still a
   * heuristic, and silently dropping a line of a user's document is worse
   * than reading a page number aloud.
   */
  stripRunningHeaders?: boolean;
}

// ---------------------------------------------------------------------------
// Public: chunk per-page arrays (PDF / DOCX)
// ---------------------------------------------------------------------------

/**
 * Given an array of per-page text strings, returns a flat chunk list
 * with metadata so the player knows which page each chunk belongs to.
 */
export function chunkPages(
  pages: string[],
  options: ChunkPagesOptions = {},
): TextChunk[] {
  const source = options.stripRunningHeaders
    ? stripRunningHeaders(pages)
    : pages;

  const result: TextChunk[] = [];
  let globalIndex = 0;

  for (let p = 0; p < source.length; p++) {
    const pageChunks = chunkTextDetailed(source[p], "pdf");
    for (let i = 0; i < pageChunks.length; i++) {
      const chunk = pageChunks[i];

      // Each page is chunked on its own, so its first chunk always looks like
      // a new paragraph — but page breaks land mid-sentence as often as not,
      // and a paragraph pause there sounds like a stumble. Only honour it when
      // the previous page actually ended a sentence.
      const previous = result[result.length - 1];
      const continuesPreviousPage =
        i === 0 && !!previous && !SENTENCE_END.test(previous.text);

      result.push({
        text: chunk.text,
        pageIndex: p,
        chunkIndex: globalIndex++,
        startsParagraph: chunk.startsParagraph && !continuesPreviousPage,
        sentenceCount: chunk.sentenceCount,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
      });
    }
  }

  return result;
}

/**
 * Given a single body of text (no page separation), returns chunks
 * all assigned to pageIndex 0.
 */
export function chunkSingleDocument(text: string): TextChunk[] {
  return chunkTextDetailed(text, "pdf").map((chunk, i) => ({
    text: chunk.text,
    pageIndex: 0,
    chunkIndex: i,
    startsParagraph: chunk.startsParagraph,
    sentenceCount: chunk.sentenceCount,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
  }));
}

// ---------------------------------------------------------------------------
// Public: chunk EPUB chapters
// ---------------------------------------------------------------------------

/**
 * Given an array of EPUB chapters, returns a flat chunk list where
 * `pageIndex` represents the chapter index for TTS navigation.
 */
export function chunkEpubChapters(
  chapters: Array<{ index: number; text: string }>,
): TextChunk[] {
  if (__DEV__) {
    console.log(`[chunkEpubChapters] chapters received: ${chapters.length}`);
  }

  const result: TextChunk[] = [];
  let globalIndex = 0;
  for (const chapter of chapters) {
    for (const chunk of chunkTextDetailed(chapter.text, "epub")) {
      result.push({
        text: chunk.text,
        pageIndex: chapter.index, // re-uses pageIndex field as chapterIndex
        chunkIndex: globalIndex++,
        startsParagraph: chunk.startsParagraph,
        sentenceCount: chunk.sentenceCount,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
      });
    }
  }

  if (__DEV__) {
    console.log(`[chunkEpubChapters] chunks produced: ${result.length}`);
  }

  return result;
}
