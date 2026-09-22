/**
 * pronunciation.ts
 * Rewrites text phonetically before it reaches the speech engine, and keeps a
 * map back to the text the reader can actually see.
 *
 * Why the map exists:
 *   A replacement changes string length. Respelling "Siobhan" as "Shiv-awn"
 *   shifts every character after it. The `charIndex` that engines report in
 *   onBoundary refers to the string they were *given* — the spoken one — while
 *   anything drawn on screen is indexed against the display one. Without an
 *   explicit mapping those two silently diverge, and word highlighting lands
 *   further off the longer a chunk runs.
 *
 * So every transformation records an edit, and `spokenToDisplayOffset` walks
 * those edits to convert an engine offset back into a display offset. Chunks
 * that matched no rule carry an empty edit list and take an identity fast
 * path, which is the overwhelmingly common case.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PronunciationRule {
  id: string;
  /** Literal text to look for. Never a pattern — user input is not a regex. */
  match: string;
  /** What the engine should say instead. */
  replacement: string;
  /** Whole-word only (default true) — stops "Ann" rewriting "Announce". */
  wholeWord: boolean;
  caseSensitive: boolean;
  /** Undefined = global rule; set = applies to one document only. */
  documentId?: string;
  enabled: boolean;
}

/** One applied replacement, in both coordinate systems. */
export interface SpokenTextEdit {
  displayStart: number;
  displayEnd: number;
  spokenStart: number;
  spokenEnd: number;
}

export interface SpokenText {
  /** What the TTS engine receives. */
  spoken: string;
  /** What the user sees. Unchanged from the source chunk. */
  display: string;
  /** Sorted, non-overlapping edits applied to produce `spoken`. */
  edits: SpokenTextEdit[];
}

// ---------------------------------------------------------------------------
// Word boundaries
// ---------------------------------------------------------------------------

/**
 * Character class used for whole-word matching.
 *
 * Built at load time behind a try/catch: Unicode property escapes are the
 * correct tool here, but a regex SyntaxError thrown while a module initialises
 * would take the whole app down on any engine that lacks them, and Read Aloud
 * must never be the reason a document fails to open.
 */
const WORD_CHAR: RegExp = (() => {
  try {
    return new RegExp("[\\p{L}\\p{N}_]", "u");
  } catch {
    return /[A-Za-z0-9_À-ɏ]/;
  }
})();

function isWordChar(ch: string): boolean {
  return ch.length > 0 && WORD_CHAR.test(ch);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchesAt(
  text: string,
  pos: number,
  rule: PronunciationRule,
): boolean {
  const needle = rule.match;
  if (pos + needle.length > text.length) return false;

  const slice = text.slice(pos, pos + needle.length);
  const same = rule.caseSensitive
    ? slice === needle
    : slice.toLowerCase() === needle.toLowerCase();
  if (!same) return false;

  if (!rule.wholeWord) return true;

  const before = pos > 0 ? text[pos - 1] : "";
  const after = text[pos + needle.length] ?? "";
  return !isWordChar(before) && !isWordChar(after);
}

// ---------------------------------------------------------------------------
// Public: build a SpokenText
// ---------------------------------------------------------------------------

/** A SpokenText that changes nothing — the no-rules-matched case. */
export function identitySpokenText(text: string): SpokenText {
  return { spoken: text, display: text, edits: [] };
}

/**
 * Apply pronunciation rules in a single left-to-right pass.
 *
 * Scanning once, and jumping past the *source* span rather than the
 * replacement, guarantees a rule's output can never be re-matched by another
 * rule — so rules cannot cascade into each other no matter how they are
 * written. Rules are tried longest-match-first at each position, so a
 * two-word rule beats a one-word rule that starts in the same place.
 */
export function applyPronunciation(
  display: string,
  rules: readonly PronunciationRule[],
): SpokenText {
  const active = rules.filter((r) => r.enabled && r.match.length > 0);
  if (active.length === 0 || display.length === 0) {
    return identitySpokenText(display);
  }

  const ordered = [...active].sort((a, b) => b.match.length - a.match.length);

  let spoken = "";
  const edits: SpokenTextEdit[] = [];
  let i = 0;

  while (i < display.length) {
    let hit: PronunciationRule | undefined;
    for (const rule of ordered) {
      if (matchesAt(display, i, rule)) {
        hit = rule;
        break;
      }
    }

    if (!hit) {
      spoken += display[i];
      i += 1;
      continue;
    }

    const displayStart = i;
    const displayEnd = i + hit.match.length;
    const spokenStart = spoken.length;
    spoken += hit.replacement;

    edits.push({
      displayStart,
      displayEnd,
      spokenStart,
      spokenEnd: spoken.length,
    });

    i = displayEnd;
  }

  // No rule actually fired — hand back the identity shape so consumers take
  // the fast path.
  if (edits.length === 0) return identitySpokenText(display);

  return { spoken, display, edits };
}

// ---------------------------------------------------------------------------
// Public: map spoken offsets back to display offsets
// ---------------------------------------------------------------------------

/**
 * Map a character offset in `spoken` back to its offset in `display`.
 *
 * An index landing *inside* a replacement returns that edit's `displayStart`,
 * so the whole original word highlights as one unit — which is what a reader
 * expects anyway, since the respelling has no visible counterpart.
 */
export function spokenToDisplayOffset(
  t: SpokenText,
  spokenIndex: number,
): number {
  if (t.edits.length === 0) {
    return clamp(spokenIndex, 0, t.display.length);
  }

  let delta = 0;
  for (const e of t.edits) {
    if (e.spokenEnd <= spokenIndex) {
      // Fully before the index — accumulate how much it shifted things.
      delta += e.displayEnd - e.displayStart - (e.spokenEnd - e.spokenStart);
      continue;
    }
    if (e.spokenStart <= spokenIndex) {
      return e.displayStart;
    }
    // Edits are sorted, so everything remaining starts after the index.
    break;
  }

  return clamp(spokenIndex + delta, 0, t.display.length);
}

/**
 * Map a spoken range onto display coordinates.
 *
 * The end offset is widened to a replacement's `displayEnd` when it falls
 * inside one, so a word that was respelled highlights completely rather than
 * collapsing to a zero-width range at its start.
 */
export function spokenToDisplayRange(
  t: SpokenText,
  spokenStart: number,
  spokenLength: number,
): { start: number; end: number } {
  const start = spokenToDisplayOffset(t, spokenStart);

  const spokenEnd = spokenStart + Math.max(0, spokenLength);
  const straddled = t.edits.find(
    (e) => e.spokenStart < spokenEnd && spokenEnd < e.spokenEnd,
  );
  const end = straddled
    ? straddled.displayEnd
    : spokenToDisplayOffset(t, spokenEnd);

  return { start, end: Math.max(start, end) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
