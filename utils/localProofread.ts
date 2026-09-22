// ============================================
// Local proofreading pass
// ---------------------------------------------
// Pure, dependency-free, synchronous. NO flag, NO network, NO premium gate,
// NO backend — this is not an AI feature, it is a set of rules.
//
// It is also most of the perceived value and ALL of the perceived speed: it
// runs on every keystroke's debounce in microseconds, so marks appear before
// any request could even be dispatched, and it keeps working in airplane mode
// when the remote pass cannot. If the endpoint is down the feature degrades to
// "fewer suggestions", never to "broken".
//
// FALSE POSITIVES ARE THE ENEMY. A rule that fires on correct prose teaches
// the user to ignore every mark, which is worse than having no rules. Every
// rule below is deliberately conservative, and the guards are commented where
// the naive version would misfire.
// ============================================

import {
  DEFAULT_GOALS,
  spansToSuggestions,
  type ProofreadGoal,
  type ProofreadSpan,
  type ProofreadSuggestion,
} from "@/utils/proofreadTypes";

export interface LocalProofreadOptions {
  /** Which rule families to run. Default: spelling, grammar, punctuation. */
  goals?: ProofreadGoal[];
  /**
   * Straight → curly quotes. OFF by default: it is a house-style preference,
   * and turning it on marks every apostrophe in the document, which is noise
   * rather than proofreading. Runs only when "style" is explicitly requested.
   */
  curlyQuotes?: boolean;
}

/**
 * Words that legitimately repeat in English. Without this list the
 * doubled-word rule flags correct sentences ("the work he had had to do").
 */
const LEGITIMATE_DOUBLES = new Set(["had", "that"]);

/**
 * Abbreviations that end in a period without ending a sentence. Without this
 * list the capitalisation rules flag "e.g. the second law" and "etc. and so".
 */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "cf", "al", "approx", "fig", "no", "vol", "pp",
  "ca", "dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr", "inc", "ltd", "dept",
]);

/** True when the period at `periodIndex` closes an abbreviation, not a sentence. */
function endsAbbreviation(text: string, periodIndex: number): boolean {
  // Walk back over the word (letters and internal periods, as in "e.g").
  let start = periodIndex;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1])) start -= 1;
  const word = text.slice(start, periodIndex).toLowerCase().replace(/^\.+/, "");
  if (!word) return false;
  if (ABBREVIATIONS.has(word)) return true;
  // A single letter before a period is an initial ("J. Smith") or part of an
  // abbreviation ("e.g"), never the end of a sentence.
  if (word.length === 1) return true;
  return false;
}

// ─── Individual rules ─────────────────────────────────────────────────────────

/** Two or more spaces where one belongs. */
function ruleDoubleSpaces(text: string, out: ProofreadSpan[]): void {
  const re = / {2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: " ",
      type: "punctuation",
      reason: "Remove the extra space.",
      confidence: 0.95,
    });
  }
}

/** A space before , . ; ! or ? */
function ruleSpaceBeforePunctuation(text: string, out: ProofreadSpan[]): void {
  const re = / +([,.;!?])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // "word . . ." — an ellipsis typed with spaces — is left alone.
    if (/[.]/.test(m[1]) && /^\s*\.\s*\./.test(text.slice(m.index + m[0].length - 1))) {
      continue;
    }
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: m[1],
      type: "punctuation",
      reason: `Remove the space before "${m[1]}".`,
      confidence: 0.93,
    });
  }
}

/** A sentence-ending period with no space after it: "up.It is unclear". */
function ruleMissingSpaceAfterPeriod(text: string, out: ProofreadSpan[]): void {
  // Guards, all load-bearing:
  //   [a-z]{2} before  → skips initials ("J.Smith") and "e.g"
  //   [A-Z] after      → skips URLs ("example.com") and files ("report.pdf")
  const re = /([a-z]{2})([.!?])([A-Z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const periodIndex = m.index + m[1].length;
    if (m[2] === "." && endsAbbreviation(text, periodIndex)) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: `${m[1]}${m[2]} ${m[3]}`,
      type: "punctuation",
      reason: "Add a space after the sentence.",
      confidence: 0.9,
    });
  }
}

/** A sentence starting with a lowercase letter. */
function ruleSentenceCapital(text: string, out: ProofreadSpan[]): void {
  // The very start of the block.
  const first = /^(\s*)([a-z])([a-z']{0,23})/.exec(text);
  if (first) {
    const start = first[1].length;
    const word = first[2] + first[3];
    out.push({
      start,
      end: start + word.length,
      replacement: word[0].toUpperCase() + word.slice(1),
      type: "grammar",
      reason: "Sentences start with a capital letter.",
      confidence: 0.9,
    });
  }

  // After a sentence-ending mark.
  const re = /([.!?])(\s+)([a-z])([a-z']{0,23})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] === "." && endsAbbreviation(text, m.index)) continue;
    // An ellipsis is a pause inside a sentence, not the end of one:
    // "Wait... the calibration drifted" is correct as written.
    if (m[1] === "." && text[m.index - 1] === ".") continue;
    const wordStart = m.index + 1 + m[2].length;
    const word = m[3] + m[4];
    out.push({
      start: wordStart,
      end: wordStart + word.length,
      replacement: word[0].toUpperCase() + word.slice(1),
      type: "grammar",
      reason: "Sentences start with a capital letter.",
      confidence: 0.95,
    });
  }
}

/** A standalone lowercase "i" used as the pronoun. */
function ruleLowercaseI(text: string, out: ProofreadSpan[]): void {
  const re = /\bi\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const next = text[m.index + 1] ?? "";
    const prev = text[m.index - 1] ?? "";
    // "i)" and "(i)" are roman-numeral list markers, not the pronoun.
    if (next === ")" || prev === "(") continue;
    // "i.e." is an abbreviation.
    if (next === "." && /^\.e\b/i.test(text.slice(m.index + 1))) continue;
    // "i-th", "x i y" in maths-like runs: a hyphen straight after is not a pronoun.
    if (next === "-") continue;
    out.push({
      start: m.index,
      end: m.index + 1,
      replacement: "I",
      type: "grammar",
      reason: 'The pronoun "I" is always capitalised.',
      confidence: 0.95,
    });
  }
}

/** The same word twice in a row: "the the". */
function ruleDoubledWords(text: string, out: ProofreadSpan[]): void {
  // A single space only — a line break between them is usually deliberate.
  const re = /\b([A-Za-z']+)( )(\1)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[1].toLowerCase();
    if (LEGITIMATE_DOUBLES.has(word)) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: m[1],
      type: "grammar",
      reason: `"${m[1]}" is repeated.`,
      confidence: 0.92,
    });
    // Step back so "the the the" reports the second pair too.
    re.lastIndex = m.index + m[1].length + 1;
  }
}

/** Repeated terminal punctuation: "!!!", "???", "....". */
function ruleRepeatedPunctuation(text: string, out: ProofreadSpan[]): void {
  const patterns: [RegExp, string, string][] = [
    [/!{2,}/g, "!", "One exclamation mark is enough."],
    [/\?{2,}/g, "?", "One question mark is enough."],
    // Three dots are an ellipsis; four or more are a typo.
    [/\.{4,}/g, "...", "An ellipsis is three dots."],
  ];
  for (const [re, replacement, reason] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        replacement,
        type: "punctuation",
        reason,
        confidence: 0.85,
      });
    }
  }
}

/** Brackets and quotes that never close (or never open). */
function ruleUnbalanced(text: string, out: ProofreadSpan[]): void {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closers = new Set([")", "]", "}"]);
  const stack: { char: string; index: number }[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (pairs[ch]) {
      stack.push({ char: ch, index: i });
    } else if (closers.has(ch)) {
      const top = stack[stack.length - 1];
      if (top && pairs[top.char] === ch) {
        stack.pop();
      } else if (!isListMarker(text, i)) {
        out.push(unbalancedSpan(i, ch, "This closing bracket has no match."));
      }
    }
  }
  for (const open of stack) {
    out.push(unbalancedSpan(open.index, open.char, "This bracket is never closed."));
  }

  // An odd number of straight double quotes means one is unmatched.
  const quoteIndexes: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '"') quoteIndexes.push(i);
  if (quoteIndexes.length % 2 === 1) {
    const last = quoteIndexes[quoteIndexes.length - 1];
    out.push(unbalancedSpan(last, '"', "This quotation mark has no pair."));
  }
}

/**
 * True when a lone ")" is a list marker rather than a stray bracket:
 * "item i) below", "a) first", "2) second". These are extremely common and
 * flagging them would put a mark on correctly written lists.
 *
 * The trade-off is deliberate: "see chapter 4)" is a genuine stray bracket
 * that this skips. A missed detection is much cheaper than a false positive
 * the user sees every time they write a list.
 */
function isListMarker(text: string, closerIndex: number): boolean {
  let start = closerIndex;
  while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) start -= 1;
  const token = text.slice(start, closerIndex);
  if (!token || token.length > 4) return false;
  const boundary = start === 0 || /\s/.test(text[start - 1]);
  return boundary;
}

function unbalancedSpan(index: number, char: string, reason: string): ProofreadSpan {
  return {
    start: index,
    end: index + 1,
    replacement: "",
    type: "punctuation",
    reason,
    // Low: deleting is a plausible fix but not certainly the one the writer
    // wants, so these rank last and never displace a confident suggestion.
    confidence: 0.45,
  };
}

/** Straight quotes and apostrophes → typographic ones. Style only. */
function ruleCurlyQuotes(text: string, out: ProofreadSpan[]): void {
  // Apostrophes inside a word: don't → don’t
  const apos = /([A-Za-z])'([A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = apos.exec(text))) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: `${m[1]}’${m[2]}`,
      type: "style",
      reason: "Use a typographic apostrophe.",
      confidence: 0.5,
    });
  }

  // Paired straight double quotes → “ ”
  const quoteIndexes: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '"') quoteIndexes.push(i);
  for (let i = 0; i + 1 < quoteIndexes.length; i += 2) {
    out.push({
      start: quoteIndexes[i],
      end: quoteIndexes[i] + 1,
      replacement: "“",
      type: "style",
      reason: "Use typographic quotation marks.",
      confidence: 0.5,
    });
    out.push({
      start: quoteIndexes[i + 1],
      end: quoteIndexes[i + 1] + 1,
      replacement: "”",
      type: "style",
      reason: "Use typographic quotation marks.",
      confidence: 0.5,
    });
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

interface Rule {
  goal: ProofreadGoal | "style";
  run: (text: string, out: ProofreadSpan[]) => void;
}

const RULES: Rule[] = [
  { goal: "punctuation", run: ruleDoubleSpaces },
  { goal: "punctuation", run: ruleSpaceBeforePunctuation },
  { goal: "punctuation", run: ruleMissingSpaceAfterPeriod },
  { goal: "punctuation", run: ruleRepeatedPunctuation },
  { goal: "punctuation", run: ruleUnbalanced },
  { goal: "grammar", run: ruleSentenceCapital },
  { goal: "grammar", run: ruleLowercaseI },
  { goal: "grammar", run: ruleDoubledWords },
];

/**
 * Run every enabled rule over one block of text.
 *
 * Returns suggestions in the same shape as the remote pass (P3), already
 * de-overlapped and capped. Never throws.
 */
export function localProofread(
  text: string,
  options: LocalProofreadOptions = {},
): ProofreadSuggestion[] {
  if (typeof text !== "string" || !text.trim()) return [];

  const goals = new Set<string>(options.goals ?? DEFAULT_GOALS);
  const spans: ProofreadSpan[] = [];

  for (const rule of RULES) {
    if (!goals.has(rule.goal)) continue;
    try {
      rule.run(text, spans);
    } catch {
      // A single misbehaving rule must never take the whole pass down.
    }
  }

  const wantsStyle = options.curlyQuotes === true || goals.has("style");
  if (wantsStyle) {
    try {
      ruleCurlyQuotes(text, spans);
    } catch {
      // As above.
    }
  }

  return spansToSuggestions(text, spans, { source: "local" });
}

/** Run the local pass over several blocks at once. */
export function localProofreadBlocks(
  blocks: { id: string; text: string }[],
  options: LocalProofreadOptions = {},
): { id: string; suggestions: ProofreadSuggestion[] }[] {
  return blocks.map((b) => ({
    id: b.id,
    suggestions: localProofread(b.text, options),
  }));
}
