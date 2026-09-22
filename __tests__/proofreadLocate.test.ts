/**
 * proofreadLocate.test.ts
 *
 * There are no character offsets anywhere in the contract, by design: models
 * do not return reliable ones. Everything depends on finding the
 * `occurrence`-th match of `original`, using `before` only to break ties.
 *
 * The case that matters most: in "the cat sat on the mat and the mat was
 * flat", a suggestion targeting the SECOND "mat" must land on the second one.
 * Getting this wrong silently edits the wrong word.
 */

import {
  beforeAt,
  locateOccurrence,
  mergeSuggestions,
  occurrenceAt,
  resolveOverlaps,
  spansToSuggestions,
  toSpan,
  type ProofreadSpan,
  type ProofreadSuggestion,
} from "@/utils/proofreadTypes";

const REPEATS = "the cat sat on the mat and the mat was flat";

function suggestion(over: Partial<ProofreadSuggestion> = {}): ProofreadSuggestion {
  return {
    id: "s1",
    type: "grammar",
    original: "mat",
    replacement: "rug",
    occurrence: 1,
    before: "",
    reason: "Test.",
    confidence: 0.9,
    source: "remote",
    ...over,
  };
}

describe("occurrence matching", () => {
  it("finds the first occurrence", () => {
    expect(locateOccurrence(REPEATS, "mat", 1)).toBe(REPEATS.indexOf("mat"));
  });

  it("finds the SECOND occurrence, not the first", () => {
    const first = REPEATS.indexOf("mat");
    const second = REPEATS.indexOf("mat", first + 1);
    expect(second).toBeGreaterThan(first);
    expect(locateOccurrence(REPEATS, "mat", 2)).toBe(second);
  });

  it("applies a second-occurrence suggestion to the second word only", () => {
    const s = suggestion({ occurrence: 2, before: "on the mat and the " });
    const span = toSpan(REPEATS, s)!;
    const edited = REPEATS.slice(0, span.start) + s.replacement + REPEATS.slice(span.end);
    expect(edited).toBe("the cat sat on the mat and the rug was flat");
    // The first "mat" is untouched.
    expect(edited.indexOf("mat")).toBe(REPEATS.indexOf("mat"));
  });

  it("handles three occurrences of the same word", () => {
    const text = "the the the";
    expect(locateOccurrence(text, "the", 1)).toBe(0);
    expect(locateOccurrence(text, "the", 2)).toBe(4);
    expect(locateOccurrence(text, "the", 3)).toBe(8);
  });

  it("finds overlapping occurrences by scanning one character at a time", () => {
    const text = "aaaa";
    expect(locateOccurrence(text, "aa", 1)).toBe(0);
    expect(locateOccurrence(text, "aa", 2)).toBe(1);
    expect(locateOccurrence(text, "aa", 3)).toBe(2);
  });

  it("treats a missing or zero occurrence as the first", () => {
    expect(locateOccurrence(REPEATS, "mat", 0)).toBe(REPEATS.indexOf("mat"));
    expect(locateOccurrence(REPEATS, "mat", undefined as unknown as number)).toBe(
      REPEATS.indexOf("mat"),
    );
  });

  it("is case-sensitive, as the contract requires a verbatim substring", () => {
    expect(locateOccurrence("The cat", "the", 1)).toBe(-1);
  });

  it("preserves internal whitespace when matching", () => {
    const text = "a  b and a b";
    expect(locateOccurrence(text, "a  b", 1)).toBe(0);
    expect(locateOccurrence(text, "a b", 1)).toBe(9);
  });
});

describe("`before` tie-breaks", () => {
  it("uses before when the occurrence count disagrees with the context", () => {
    // The server said occurrence 1, but the context clearly points at the 2nd.
    const at = locateOccurrence(REPEATS, "mat", 1, "on the mat and the ");
    expect(at).toBe(REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1));
  });

  it("prefers the counted occurrence when before agrees with it", () => {
    const first = REPEATS.indexOf("mat");
    expect(locateOccurrence(REPEATS, "mat", 1, "the cat sat on the ")).toBe(first);
  });

  it("falls back to the count when before matches nothing", () => {
    const first = REPEATS.indexOf("mat");
    expect(locateOccurrence(REPEATS, "mat", 1, "completely unrelated ")).toBe(first);
  });

  it("matches on a short before string", () => {
    // The contract caps `before` at 32 chars; a shorter one must still work.
    const at = locateOccurrence(REPEATS, "mat", 1, "and the ");
    expect(at).toBe(REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1));
  });

  it("degrades to the occurrence count when before is fabricated", () => {
    // An out-of-contract `before` (over 32 chars, and not real context) must
    // not send the edit somewhere arbitrary — it falls back to the count.
    const fabricated = "z".repeat(100) + "never appeared in this text";
    expect(locateOccurrence(REPEATS, "mat", 2, fabricated)).toBe(
      REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1),
    );
  });

  it("works with an empty before at the start of a block", () => {
    expect(locateOccurrence("the cat", "the", 1, "")).toBe(0);
  });
});

describe("unlocatable suggestions are discarded", () => {
  it("returns -1 when original is not in the text at all", () => {
    expect(locateOccurrence(REPEATS, "elephant", 1)).toBe(-1);
  });

  it("returns -1 when the occurrence is out of range", () => {
    // Only two "mat"s exist.
    expect(locateOccurrence(REPEATS, "mat", 5)).toBe(-1);
  });

  it("returns -1 for empty inputs", () => {
    expect(locateOccurrence("", "mat", 1)).toBe(-1);
    expect(locateOccurrence(REPEATS, "", 1)).toBe(-1);
  });

  it("toSpan returns null so the caller can drop it", () => {
    expect(toSpan(REPEATS, suggestion({ original: "elephant" }))).toBeNull();
    expect(toSpan(REPEATS, suggestion({ occurrence: 99 }))).toBeNull();
  });

  it("drops an unlocatable remote suggestion during a merge", () => {
    const merged = mergeSuggestions(
      REPEATS,
      [],
      [suggestion({ id: "ghost", original: "elephant" }), suggestion({ id: "real" })],
    );
    expect(merged.map((s) => s.id)).toEqual(["real"]);
  });
});

describe("occurrence and before computation", () => {
  it("computes the occurrence index for a known position", () => {
    const second = REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1);
    expect(occurrenceAt(REPEATS, "mat", REPEATS.indexOf("mat"))).toBe(1);
    expect(occurrenceAt(REPEATS, "mat", second)).toBe(2);
  });

  it("computes before, capped at 32 characters", () => {
    const at = REPEATS.indexOf("flat");
    expect(beforeAt(REPEATS, at).length).toBeLessThanOrEqual(32);
    expect(REPEATS.startsWith(beforeAt(REPEATS, 5))).toBe(true);
    expect(beforeAt(REPEATS, 0)).toBe("");
  });

  it("round-trips: compute then locate returns the same position", () => {
    const at = REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1);
    const occ = occurrenceAt(REPEATS, "mat", at);
    const bef = beforeAt(REPEATS, at);
    expect(locateOccurrence(REPEATS, "mat", occ, bef)).toBe(at);
  });
});

describe("overlap resolution (P4.3)", () => {
  const span = (over: Partial<ProofreadSpan>): ProofreadSpan => ({
    start: 0,
    end: 5,
    replacement: "x",
    type: "grammar",
    reason: "r",
    confidence: 0.5,
    ...over,
  });

  it("keeps the higher-confidence span when two overlap", () => {
    const kept = resolveOverlaps([
      span({ start: 0, end: 10, confidence: 0.6 }),
      span({ start: 5, end: 15, confidence: 0.9 }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].start).toBe(5);
  });

  it("breaks a confidence tie by the earlier start", () => {
    const kept = resolveOverlaps([
      span({ start: 5, end: 15, confidence: 0.8 }),
      span({ start: 0, end: 10, confidence: 0.8 }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].start).toBe(0);
  });

  it("keeps spans that merely touch without overlapping", () => {
    const kept = resolveOverlaps([
      span({ start: 0, end: 5 }),
      span({ start: 5, end: 10 }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("returns spans sorted by start", () => {
    const kept = resolveOverlaps([
      span({ start: 20, end: 25 }),
      span({ start: 0, end: 5 }),
      span({ start: 10, end: 15 }),
    ]);
    expect(kept.map((s) => s.start)).toEqual([0, 10, 20]);
  });
});

describe("spansToSuggestions", () => {
  it("produces verbatim originals and computed occurrence/before", () => {
    const suggestions = spansToSuggestions(
      REPEATS,
      [
        {
          start: REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1),
          end: REPEATS.indexOf("mat", REPEATS.indexOf("mat") + 1) + 3,
          replacement: "rug",
          type: "clarity",
          reason: "Test.",
          confidence: 0.8,
        },
      ],
      { source: "local" },
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].original).toBe("mat");
    expect(suggestions[0].occurrence).toBe(2);
    expect(suggestions[0].before.endsWith("and the ")).toBe(true);
  });

  it("drops a span whose replacement equals the original", () => {
    const at = REPEATS.indexOf("mat");
    expect(
      spansToSuggestions(REPEATS, [
        { start: at, end: at + 3, replacement: "mat", type: "grammar", reason: "r", confidence: 1 },
      ]),
    ).toEqual([]);
  });

  it("drops out-of-range and inverted spans", () => {
    expect(
      spansToSuggestions(REPEATS, [
        { start: -5, end: 3, replacement: "x", type: "grammar", reason: "r", confidence: 1 },
        { start: 10, end: 5, replacement: "x", type: "grammar", reason: "r", confidence: 1 },
        { start: 0, end: 9999, replacement: "x", type: "grammar", reason: "r", confidence: 1 },
      ]),
    ).toEqual([]);
  });

  it("clamps an over-long reason to 140 characters", () => {
    const at = REPEATS.indexOf("mat");
    const [s] = spansToSuggestions(REPEATS, [
      {
        start: at,
        end: at + 3,
        replacement: "rug",
        type: "grammar",
        reason: "y".repeat(400),
        confidence: 1,
      },
    ]);
    expect(s.reason.length).toBeLessThanOrEqual(140);
  });

  it("caps a block at 50 suggestions, dropping lowest confidence first", () => {
    const text = "a ".repeat(120);
    const spans: ProofreadSpan[] = [];
    for (let i = 0; i < 120; i++) {
      spans.push({
        start: i * 2,
        end: i * 2 + 1,
        replacement: "b",
        type: "grammar",
        reason: "r",
        // Later spans are more confident, so the survivors are the later ones.
        confidence: i / 120,
      });
    }
    const suggestions = spansToSuggestions(text, spans);
    expect(suggestions).toHaveLength(50);
    expect(Math.min(...suggestions.map((s) => s.confidence))).toBeGreaterThan(0.5);
  });
});

describe("merging local and remote", () => {
  it("drops a remote suggestion overlapping a local one", () => {
    const text = "the the answer";
    const local: ProofreadSuggestion[] = [
      {
        id: "l1",
        type: "grammar",
        original: "the the",
        replacement: "the",
        occurrence: 1,
        before: "",
        reason: "Repeated.",
        confidence: 0.92,
        source: "local",
      },
    ];
    const remote: ProofreadSuggestion[] = [
      {
        id: "r1",
        type: "clarity",
        original: "the",
        replacement: "The",
        occurrence: 1,
        before: "",
        reason: "Capitalise.",
        confidence: 0.99,
        source: "remote",
      },
    ];
    const merged = mergeSuggestions(text, local, remote);
    expect(merged.map((s) => s.id)).toEqual(["l1"]);
  });

  it("keeps a remote suggestion that does not overlap", () => {
    const text = "the the answer is wrng";
    const local: ProofreadSuggestion[] = [
      {
        id: "l1",
        type: "grammar",
        original: "the the",
        replacement: "the",
        occurrence: 1,
        before: "",
        reason: "Repeated.",
        confidence: 0.92,
        source: "local",
      },
    ];
    const remote: ProofreadSuggestion[] = [
      {
        id: "r1",
        type: "spelling",
        original: "wrng",
        replacement: "wrong",
        occurrence: 1,
        before: "answer is ",
        reason: "Misspelling.",
        confidence: 0.99,
        source: "remote",
      },
    ];
    const merged = mergeSuggestions(text, local, remote);
    expect(merged.map((s) => s.id)).toEqual(["l1", "r1"]);
  });

  it("orders the merged list by position", () => {
    const text = "aaa bbb ccc";
    const mk = (id: string, original: string, source: "local" | "remote") => ({
      id,
      type: "grammar" as const,
      original,
      replacement: original.toUpperCase(),
      occurrence: 1,
      before: "",
      reason: "r",
      confidence: 0.8,
      source,
    });
    const merged = mergeSuggestions(text, [mk("l", "ccc", "local")], [mk("r", "aaa", "remote")]);
    expect(merged.map((s) => s.id)).toEqual(["r", "l"]);
  });

  it("handles empty inputs", () => {
    expect(mergeSuggestions("text", [], [])).toEqual([]);
  });
});
