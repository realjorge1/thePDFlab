/**
 * localProofread.test.ts
 *
 * Every rule, plus the part that actually decides whether the feature is
 * usable: NO FALSE POSITIVES ON ORDINARY PROSE. A rule that fires on correct
 * writing teaches the user to ignore every mark, which is worse than shipping
 * no rules at all.
 */

import { localProofread } from "@/utils/localProofread";
import { toSpan, type ProofreadSuggestion } from "@/utils/proofreadTypes";

/** Apply every suggestion to the text, right-to-left, and return the result. */
function applyAll(text: string, suggestions: ProofreadSuggestion[]): string {
  const spans = suggestions
    .map((s) => ({ s, span: toSpan(text, s) }))
    .filter((x) => x.span !== null)
    .sort((a, b) => b.span!.start - a.span!.start);
  let out = text;
  for (const { s, span } of spans) {
    out = out.slice(0, span!.start) + s.replacement + out.slice(span!.end);
  }
  return out;
}

function reasonsFor(text: string, opts?: Parameters<typeof localProofread>[1]) {
  return localProofread(text, opts).map((s) => `${s.type}:${s.original}→${s.replacement}`);
}

describe("contract shape", () => {
  it("produces contract-shaped suggestions with verbatim originals", () => {
    const text = "The data shows that recieve rates are up.  it is unclear why.";
    const suggestions = localProofread(text);
    expect(suggestions.length).toBeGreaterThan(0);

    for (const s of suggestions) {
      // The single most important invariant: `original` is a real substring.
      expect(text).toContain(s.original);
      expect(s.original.length).toBeGreaterThan(0);
      expect(s.original.length).toBeLessThanOrEqual(200);
      expect(s.replacement.length).toBeLessThanOrEqual(400);
      expect(s.replacement).not.toBe(s.original);
      expect(s.occurrence).toBeGreaterThanOrEqual(1);
      expect(s.before.length).toBeLessThanOrEqual(32);
      expect(s.reason.length).toBeGreaterThan(0);
      expect(s.reason.length).toBeLessThanOrEqual(140);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(s.source).toBe("local");
      // Every suggestion must be locatable, or it should not have been emitted.
      expect(toSpan(text, s)).not.toBeNull();
    }
  });

  it("never returns two overlapping suggestions", () => {
    const text = "this  is  a  test .and  i  think  the  the  answer is here!!!";
    const spans = localProofread(text)
      .map((s) => toSpan(text, s)!)
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
  });

  it("returns [] for empty, blank and non-string input", () => {
    expect(localProofread("")).toEqual([]);
    expect(localProofread("   \n  ")).toEqual([]);
    // Defensive: the editor bridge can hand back anything.
    expect(localProofread(undefined as unknown as string)).toEqual([]);
    expect(localProofread(null as unknown as string)).toEqual([]);
    expect(localProofread(42 as unknown as string)).toEqual([]);
  });
});

describe("rule: double spaces", () => {
  it("collapses two or more spaces to one", () => {
    const text = "Entropy  never decreases.";
    expect(applyAll(text, localProofread(text))).toBe("Entropy never decreases.");
  });

  it("collapses a long run", () => {
    const text = "One     two.";
    expect(applyAll(text, localProofread(text))).toBe("One two.");
  });

  it("leaves single spaces alone", () => {
    expect(reasonsFor("One two three.")).toEqual([]);
  });
});

describe("rule: space before punctuation", () => {
  it.each([
    ["Yes , please.", "Yes, please."],
    ["Stop ; wait.", "Stop; wait."],
    ["Really ?", "Really?"],
    ["Wow !", "Wow!"],
  ])("fixes %s", (input, expected) => {
    expect(applyAll(input, localProofread(input))).toBe(expected);
  });

  it("does not fire on correct spacing", () => {
    expect(reasonsFor("Yes, please. Really? Wow!")).toEqual([]);
  });
});

describe("rule: missing space after a sentence-ending period", () => {
  it("adds the space", () => {
    const text = "Rates are up.It is unclear why.";
    expect(applyAll(text, localProofread(text))).toBe("Rates are up. It is unclear why.");
  });

  it("leaves URLs, file names and decimals alone", () => {
    expect(reasonsFor("See www.example.com for details.")).toEqual([]);
    expect(reasonsFor("Open report.pdf now.")).toEqual([]);
    expect(reasonsFor("The value is 3.5 units.")).toEqual([]);
    expect(reasonsFor("Visit docs.example.org/guide today.")).toEqual([]);
  });

  it("leaves abbreviations and initials alone", () => {
    expect(reasonsFor("Use e.g. the second law here.")).toEqual([]);
    expect(reasonsFor("Ask J.Smith about it.")).toEqual([]);
  });
});

describe("rule: missing capital at sentence start", () => {
  it("capitalises after a full stop", () => {
    const text = "Rates are up. it is unclear why.";
    expect(applyAll(text, localProofread(text))).toBe("Rates are up. It is unclear why.");
  });

  it("capitalises the first word of the block", () => {
    const text = "entropy never decreases.";
    expect(applyAll(text, localProofread(text))).toBe("Entropy never decreases.");
  });

  it("capitalises after ? and !", () => {
    expect(applyAll("Why? because.", localProofread("Why? because."))).toBe(
      "Why? Because.",
    );
    expect(applyAll("Stop! now.", localProofread("Stop! now."))).toBe("Stop! Now.");
  });

  it("does not fire after an abbreviation", () => {
    // The naive version flags "the" here. This is the guard that matters most.
    expect(reasonsFor("Consider e.g. the second law of thermodynamics.")).toEqual([]);
    expect(reasonsFor("Heat, work, etc. are all forms of energy.")).toEqual([]);
    expect(reasonsFor("See Fig. 4 and the caption below.")).toEqual([]);
  });

  it("does not fire on correctly capitalised prose", () => {
    expect(reasonsFor("Rates are up. It is unclear why. We will find out.")).toEqual([]);
  });
});

describe("rule: standalone lowercase i", () => {
  it("capitalises the pronoun", () => {
    const text = "Yesterday i read the chapter.";
    expect(applyAll(text, localProofread(text))).toBe("Yesterday I read the chapter.");
  });

  it("catches several in one block", () => {
    const text = "When i read, i learn.";
    expect(applyAll(text, localProofread(text))).toBe("When I read, I learn.");
  });

  it("leaves roman-numeral list markers alone", () => {
    expect(reasonsFor("See item i) below for details.")).toEqual([]);
    expect(reasonsFor("Clause (i) applies to this case.")).toEqual([]);
  });

  it("leaves i.e. alone", () => {
    expect(reasonsFor("The first law, i.e. conservation of energy, applies.")).toEqual([]);
  });

  it("leaves capital I and words containing i alone", () => {
    expect(reasonsFor("I think it is in the middle.")).toEqual([]);
  });
});

describe("rule: doubled words", () => {
  it("removes the repeat", () => {
    const text = "The the answer is simple.";
    expect(applyAll(text, localProofread(text))).toBe("The answer is simple.");
  });

  it("handles a mid-sentence repeat", () => {
    const text = "It is in in the box.";
    expect(applyAll(text, localProofread(text))).toBe("It is in the box.");
  });

  it("leaves legitimate doubles alone", () => {
    // "had had" and "that that" are correct English.
    expect(reasonsFor("The work he had had to do was hard.")).toEqual([]);
    expect(reasonsFor("She said that that was fine.")).toEqual([]);
  });

  it("does not fire across a line break", () => {
    // The capitalisation rule legitimately fires here (the block starts
    // lowercase); what must NOT appear is a doubled-word suggestion.
    const suggestions = localProofread("the\nthe");
    expect(suggestions.some((s) => s.reason.includes("repeated"))).toBe(false);
  });

  it("does not fire on different words that share a prefix", () => {
    expect(reasonsFor("The theory is sound.")).toEqual([]);
    expect(reasonsFor("We can can the beans.")).not.toEqual([]); // genuinely ambiguous, flagged
  });
});

describe("rule: repeated terminal punctuation", () => {
  it("reduces !!! and ???", () => {
    expect(applyAll("Stop!!!", localProofread("Stop!!!"))).toBe("Stop!");
    expect(applyAll("Why???", localProofread("Why???"))).toBe("Why?");
  });

  it("leaves a three-dot ellipsis alone but fixes four or more", () => {
    expect(reasonsFor("Wait... I see.")).toEqual([]);
    expect(applyAll("Wait..... I see.", localProofread("Wait..... I see."))).toBe(
      "Wait... I see.",
    );
  });

  it("leaves single marks alone", () => {
    expect(reasonsFor("Stop! Why? Now.")).toEqual([]);
  });
});

describe("rule: unbalanced brackets and quotes", () => {
  it("flags a bracket that never closes", () => {
    const suggestions = localProofread("The result (see chapter 4 is clear.");
    expect(suggestions.some((s) => s.original === "(")).toBe(true);
  });

  it("flags a closing bracket with no match", () => {
    const suggestions = localProofread("The result) is clear.");
    expect(suggestions.some((s) => s.original === ")")).toBe(true);
  });

  it("flags an odd straight quote", () => {
    const suggestions = localProofread('He said "hello and left.');
    expect(suggestions.some((s) => s.original === '"')).toBe(true);
  });

  it("ranks unbalanced marks below confident fixes", () => {
    const suggestions = localProofread("The result (see chapter 4 is clear.");
    const bracket = suggestions.find((s) => s.original === "(");
    expect(bracket!.confidence).toBeLessThan(0.6);
  });

  it("leaves balanced brackets and quotes alone", () => {
    expect(reasonsFor("The result (see chapter 4) is clear.")).toEqual([]);
    expect(reasonsFor('He said "hello" and left.')).toEqual([]);
    expect(reasonsFor("Nested [outer (inner) done] here.")).toEqual([]);
  });
});

describe("rule: straight vs curly quotes (style, off by default)", () => {
  it("does not run by default — an apostrophe in every word would be noise", () => {
    expect(reasonsFor("I don't think it's ready.")).toEqual([]);
  });

  it("converts apostrophes when style is requested", () => {
    const text = "I don't think so.";
    const out = applyAll(text, localProofread(text, { curlyQuotes: true }));
    expect(out).toBe("I don’t think so.");
  });

  it("converts paired double quotes when style is requested", () => {
    const text = 'He said "hello" today.';
    const out = applyAll(text, localProofread(text, { goals: ["style"] as never }));
    expect(out).toBe("He said “hello” today.");
  });
});

describe("goals filtering", () => {
  it("runs only the requested families", () => {
    const text = "rates are up.  it is unclear";
    const punctuationOnly = localProofread(text, { goals: ["punctuation"] });
    expect(punctuationOnly.every((s) => s.type === "punctuation")).toBe(true);

    const grammarOnly = localProofread(text, { goals: ["grammar"] });
    expect(grammarOnly.every((s) => s.type === "grammar")).toBe(true);

    expect(localProofread(text, { goals: [] })).toEqual([]);
  });
});

describe("no false positives on ordinary prose", () => {
  const CLEAN_PROSE = [
    "The second law of thermodynamics states that the entropy of an isolated system never decreases.",
    "Dr. Smith reviewed the manuscript and returned it with comments on 14 March.",
    "We measured 3.5 units at 20 °C, which matches the model within experimental error.",
    "See www.example.com/guide for the full specification and its appendices.",
    "The results (Table 2) show a clear trend, although the effect size is modest.",
    'She replied, "That is exactly what I expected," and closed the notebook.',
    "Consider e.g. the case where pressure is held constant throughout the process.",
    "Heat, work, radiation, etc. are all forms of energy transfer between systems.",
    "I think the work he had had to do was harder than anyone realised at the time.",
    "Is this the right approach? Probably not, but it is a reasonable starting point.",
    "Wait... the calibration drifted overnight, so we repeated the run this morning.",
    "Clause (i) applies here; clause (ii) does not, for the reasons set out above.",
  ];

  it.each(CLEAN_PROSE)("finds nothing to fix in: %s", (prose) => {
    expect(localProofread(prose)).toEqual([]);
  });

  it("finds nothing across the whole clean passage at once", () => {
    expect(localProofread(CLEAN_PROSE.join(" "))).toEqual([]);
  });
});

describe("the acceptance example", () => {
  it("marks both the missing capital and leaves the real word alone", () => {
    // The misspelling itself is the remote pass's job; the local pass must get
    // the capitalisation and must not damage anything else.
    const text = "The data shows that recieve rates are up. it is unclear why.";
    const suggestions = localProofread(text);

    const capital = suggestions.find((s) => s.original === "it");
    expect(capital).toBeDefined();
    expect(capital!.replacement).toBe("It");
    expect(capital!.type).toBe("grammar");

    // Applying every local suggestion changes only the capital.
    expect(applyAll(text, suggestions)).toBe(
      "The data shows that recieve rates are up. It is unclear why.",
    );
  });
});
