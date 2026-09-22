/**
 * pronunciation.test.ts
 * The offset map is the load-bearing part of the pronunciation feature: word
 * highlighting and Android's resume both index into strings that pronunciation
 * rules have changed the length of. These cases pin down that mapping.
 */

import {
  applyPronunciation,
  identitySpokenText,
  spokenToDisplayOffset,
  spokenToDisplayRange,
  type PronunciationRule,
} from "@/utils/pronunciation";

// ── Helpers ────────────────────────────────────────────────────

let nextId = 0;

function rule(
  match: string,
  replacement: string,
  overrides: Partial<PronunciationRule> = {},
): PronunciationRule {
  return {
    id: `r${nextId++}`,
    match,
    replacement,
    wholeWord: true,
    caseSensitive: false,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("applyPronunciation", () => {
  it("leaves text untouched when no rule matches", () => {
    const t = applyPronunciation("Nothing to see here.", [rule("Zzz", "Zed")]);
    expect(t.spoken).toBe("Nothing to see here.");
    expect(t.edits).toHaveLength(0);
  });

  it("replaces a matched word and records the edit", () => {
    const t = applyPronunciation("Meet Siobhan today.", [
      rule("Siobhan", "Shiv awn"),
    ]);

    expect(t.spoken).toBe("Meet Shiv awn today.");
    expect(t.display).toBe("Meet Siobhan today.");
    expect(t.edits).toEqual([
      { displayStart: 5, displayEnd: 12, spokenStart: 5, spokenEnd: 13 },
    ]);
  });

  it("honours wholeWord so a rule cannot eat a longer word", () => {
    const withWholeWord = applyPronunciation("Ann announced it.", [
      rule("Ann", "Anne"),
    ]);
    expect(withWholeWord.spoken).toBe("Anne announced it.");

    const withoutWholeWord = applyPronunciation("Ann announced it.", [
      rule("Ann", "Anne", { wholeWord: false }),
    ]);
    expect(withoutWholeWord.spoken).toBe("Anne Anneounced it.");
  });

  it("honours caseSensitive", () => {
    const insensitive = applyPronunciation("nasa and NASA", [
      rule("nasa", "Nassa"),
    ]);
    expect(insensitive.spoken).toBe("Nassa and Nassa");

    const sensitive = applyPronunciation("nasa and NASA", [
      rule("NASA", "Nassa", { caseSensitive: true }),
    ]);
    expect(sensitive.spoken).toBe("nasa and Nassa");
  });

  it("prefers the longest rule when two match at the same place", () => {
    const t = applyPronunciation("New York is big.", [
      rule("New", "Noo"),
      rule("New York", "Noo Yawk"),
    ]);
    expect(t.spoken).toBe("Noo Yawk is big.");
    expect(t.edits).toHaveLength(1);
  });

  it("never re-matches its own output", () => {
    // Without a single left-to-right pass, "a" -> "aa" would run away.
    const t = applyPronunciation("a b a", [rule("a", "aa")]);
    expect(t.spoken).toBe("aa b aa");
    expect(t.edits).toHaveLength(2);
  });

  it("does not let one rule's output feed another rule", () => {
    const t = applyPronunciation("cat", [
      rule("cat", "dog"),
      rule("dog", "wolf"),
    ]);
    expect(t.spoken).toBe("dog");
  });

  it("ignores disabled rules", () => {
    const t = applyPronunciation("Meet Siobhan.", [
      rule("Siobhan", "Shiv awn", { enabled: false }),
    ]);
    expect(t.spoken).toBe("Meet Siobhan.");
    expect(t.edits).toHaveLength(0);
  });

  it("treats a literal match as literal, not as a regex", () => {
    const t = applyPronunciation("cost is $5.00 (approx)", [
      rule("$5.00", "five dollars", { wholeWord: false }),
    ]);
    expect(t.spoken).toBe("cost is five dollars (approx)");
  });
});

// ---------------------------------------------------------------------------
// Offset mapping
// ---------------------------------------------------------------------------

describe("spokenToDisplayOffset", () => {
  it("is the identity when there are no edits", () => {
    const t = identitySpokenText("Plain text.");
    expect(spokenToDisplayOffset(t, 0)).toBe(0);
    expect(spokenToDisplayOffset(t, 6)).toBe(6);
    expect(spokenToDisplayOffset(t, 11)).toBe(11);
  });

  it("maps an index before any edit unchanged", () => {
    const t = applyPronunciation("Meet Siobhan today.", [
      rule("Siobhan", "Shiv awn"),
    ]);
    expect(spokenToDisplayOffset(t, 0)).toBe(0);
    // "Meet" — entirely before the replacement.
    expect(spokenToDisplayOffset(t, 4)).toBe(4);
  });

  it("maps an index inside an edit to the whole original word", () => {
    const t = applyPronunciation("Meet Siobhan today.", [
      rule("Siobhan", "Shiv awn"),
    ]);
    // Anywhere inside "Shiv awn" resolves to where "Siobhan" starts.
    expect(spokenToDisplayOffset(t, 5)).toBe(5);
    expect(spokenToDisplayOffset(t, 9)).toBe(5);
    expect(spokenToDisplayOffset(t, 12)).toBe(5);
  });

  it("maps an index after an edit back by the length delta", () => {
    const t = applyPronunciation("Meet Siobhan today.", [
      rule("Siobhan", "Shiv awn"),
    ]);
    // "today" starts at 13 in display and 14 in spoken (one char longer).
    expect(t.spoken.indexOf("today")).toBe(14);
    expect(spokenToDisplayOffset(t, 14)).toBe(13);
    expect(t.display.indexOf("today")).toBe(13);
  });

  it("accumulates across multiple edits", () => {
    const t = applyPronunciation("Siobhan met Xu at NASA.", [
      rule("Siobhan", "Shiv awn"),
      rule("Xu", "Shoo"),
      rule("NASA", "Nassa"),
    ]);

    for (const word of ["met", "at"]) {
      expect(spokenToDisplayOffset(t, t.spoken.indexOf(word))).toBe(
        t.display.indexOf(word),
      );
    }
  });

  it("maps an index past the last edit", () => {
    const t = applyPronunciation("Xu went home and stayed home.", [
      rule("Xu", "Shoo"),
    ]);
    const spokenIdx = t.spoken.lastIndexOf("home");
    expect(spokenToDisplayOffset(t, spokenIdx)).toBe(t.display.lastIndexOf("home"));
  });

  it("clamps out-of-range indices to the display string", () => {
    const t = applyPronunciation("Xu.", [rule("Xu", "Shoo")]);
    expect(spokenToDisplayOffset(t, -5)).toBe(0);
    expect(spokenToDisplayOffset(t, 9999)).toBe(t.display.length);
  });
});

describe("spokenToDisplayRange", () => {
  it("covers the whole original word when the range lands in a replacement", () => {
    const t = applyPronunciation("Meet Siobhan today.", [
      rule("Siobhan", "Shiv awn"),
    ]);
    // The engine says "Shiv" (4 chars at spoken offset 5) — on screen the
    // reader should see the whole of "Siobhan" light up.
    expect(spokenToDisplayRange(t, 5, 4)).toEqual({ start: 5, end: 12 });
  });

  it("is a plain range when no rule is involved", () => {
    const t = identitySpokenText("Meet Siobhan today.");
    expect(spokenToDisplayRange(t, 5, 7)).toEqual({ start: 5, end: 12 });
  });

  it("maps a word after a replacement correctly", () => {
    const t = applyPronunciation("Meet Siobhan today.", [
      rule("Siobhan", "Shiv awn"),
    ]);
    const spokenIdx = t.spoken.indexOf("today");
    expect(spokenToDisplayRange(t, spokenIdx, 5)).toEqual({
      start: 13,
      end: 18,
    });
  });

  it("never returns an inverted range", () => {
    const t = applyPronunciation("Xu", [rule("Xu", "Shoo")]);
    const r = spokenToDisplayRange(t, 3, 1);
    expect(r.end).toBeGreaterThanOrEqual(r.start);
  });
});
