/**
 * chunkText.test.ts
 * Covers the two structural facts chunking now carries: where paragraphs
 * begin (which drives the optional inter-paragraph pause) and which lines are
 * running heads or feet rather than body text.
 */

import {
  chunkEpubChapters,
  chunkPages,
  chunkSingleDocument,
  chunkText,
  cleanPdfText,
  mapLegacyChunkIndex,
  stripRunningHeaders,
  type TextChunk,
} from "@/utils/chunkText";

// ---------------------------------------------------------------------------
// Paragraph marks
// ---------------------------------------------------------------------------

describe("paragraph tracking", () => {
  const TWO_PARAGRAPHS =
    "First paragraph, first sentence. First paragraph, second sentence.\n\n" +
    "Second paragraph opens here. And continues.";

  it("marks the first chunk of each paragraph and nothing else", () => {
    // Paragraphs long enough to need more than one packed chunk each.
    const para = (label: string) =>
      Array.from(
        { length: 8 },
        (_, i) =>
          `${label} sentence ${i + 1} carries enough ordinary words to count.`,
      ).join(" ");
    const chunks = chunkSingleDocument(`${para("Alpha")}\n\n${para("Beta")}`);
    const flags = chunks.map((c) => c.startsParagraph === true);

    expect(chunks.length).toBeGreaterThan(2);
    expect(flags.filter(Boolean)).toHaveLength(2);
    expect(flags[0]).toBe(true);

    const secondStart = chunks.findIndex((c) => c.text.startsWith("Beta"));
    expect(secondStart).toBeGreaterThan(1);
    expect(flags[secondStart]).toBe(true);
    expect(flags[secondStart - 1]).toBe(false);
  });

  it("does not treat a mid-sentence page break as a new paragraph", () => {
    const chunks = chunkPages([
      "The argument begins on this page and runs",
      "straight on to the next page before it ends.",
      "A fresh paragraph opens the third page.",
    ]);

    expect(chunks.find((c) => c.pageIndex === 0)?.startsParagraph).toBe(true);
    expect(chunks.find((c) => c.pageIndex === 1)?.startsParagraph).toBe(false);
    // Page two did end a sentence, so page three really is a new start.
    expect(chunks.find((c) => c.pageIndex === 2)?.startsParagraph).toBe(true);
  });

  it("carries the flag through page chunking", () => {
    const chunks = chunkPages([TWO_PARAGRAPHS, TWO_PARAGRAPHS]);

    expect(chunks.filter((c) => c.startsParagraph).length).toBe(4);
    expect(chunks[0].pageIndex).toBe(0);
    expect(chunks[chunks.length - 1].pageIndex).toBe(1);
    // The global chunk index stays dense and ordered across pages.
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("carries the flag through EPUB chapter chunking", () => {
    const chunks = chunkEpubChapters([
      { index: 0, text: TWO_PARAGRAPHS },
      { index: 1, text: "Only one paragraph here." },
    ]);

    expect(chunks.some((c) => c.pageIndex === 1)).toBe(true);
    expect(chunks.filter((c) => c.startsParagraph).length).toBe(3);
  });

  it("leaves chunkText's public string output unchanged", () => {
    const strings = chunkText(TWO_PARAGRAPHS);
    expect(strings.every((s) => typeof s === "string")).toBe(true);
    expect(strings).toEqual(
      chunkSingleDocument(TWO_PARAGRAPHS).map((c) => c.text),
    );
  });
});

// ---------------------------------------------------------------------------
// Running headers & footers
// ---------------------------------------------------------------------------

describe("sentence packing", () => {
  const SENTENCES = Array.from(
    { length: 12 },
    (_, i) => `This is sentence ${i + 1}, short and plain.`,
  );
  const PARAGRAPH = SENTENCES.join(" ");

  it("packs several short sentences into each chunk", () => {
    const chunks = chunkSingleDocument(PARAGRAPH);
    expect(chunks.length).toBeLessThan(SENTENCES.length);
    expect(chunks.some((c) => (c.sentenceCount ?? 1) > 1)).toBe(true);
  });

  it("accounts for every sentence exactly once, in order", () => {
    const chunks = chunkSingleDocument(PARAGRAPH);
    const total = chunks.reduce((n, c) => n + (c.sentenceCount ?? 1), 0);
    expect(total).toBe(SENTENCES.length);
    expect(chunks.map((c) => c.text).join(" ")).toBe(PARAGRAPH);
  });

  it("never grows a chunk past the engine limit", () => {
    const long = Array.from(
      { length: 40 },
      (_, i) => `Sentence ${i} has a handful of ordinary words in it.`,
    ).join(" ");
    for (const c of chunkSingleDocument(long)) {
      expect(c.text.length).toBeLessThanOrEqual(300);
    }
  });

  it("never packs across a paragraph break", () => {
    const chunks = chunkSingleDocument("Short one.\n\nShort two.");
    expect(chunks.map((c) => c.text)).toEqual(["Short one.", "Short two."]);
  });

  it("keeps charStart/charEnd pointing at the packed text", () => {
    const text = `${PARAGRAPH}\n\n${PARAGRAPH}`;
    const cleaned = cleanPdfText(text);
    for (const c of chunkSingleDocument(text)) {
      expect(cleaned.slice(c.charStart, c.charEnd)).toBe(c.text);
    }
  });
});

describe("mapLegacyChunkIndex", () => {
  /** Packed chunks holding sentences 0–2, 3–4 and 5–8. */
  const packed: TextChunk[] = [3, 2, 4].map((sentenceCount, i) => ({
    text: `chunk ${i}`,
    pageIndex: 0,
    chunkIndex: i,
    sentenceCount,
  }));

  it("finds the chunk that now holds each saved sentence", () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => mapLegacyChunkIndex(packed, i)),
    ).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 2]);
  });

  it("returns -1 past the loaded chunks, so a streaming restore can wait", () => {
    expect(mapLegacyChunkIndex(packed, 9)).toBe(-1);
  });

  it("treats a chunk with no count as one sentence", () => {
    const unpacked: TextChunk[] = [
      { text: "a", pageIndex: 0, chunkIndex: 0 },
      { text: "b", pageIndex: 0, chunkIndex: 1 },
    ];
    expect(mapLegacyChunkIndex(unpacked, 1)).toBe(1);
  });

  it("lands on the chunk containing the same sentence in real chunker output", () => {
    const sentences = Array.from(
      { length: 10 },
      (_, i) => `Numbered sentence ${i + 1} sits right here in the text.`,
    );
    const chunks = chunkSingleDocument(sentences.join(" "));

    sentences.forEach((sentence, legacyIndex) => {
      const idx = mapLegacyChunkIndex(chunks, legacyIndex);
      expect(chunks[idx].text).toContain(sentence);
    });
  });
});

describe("stripRunningHeaders", () => {
  /** Body prose that genuinely differs page to page, as it does in real books. */
  const BODIES = [
    "Salt was once carried across deserts at considerable expense.",
    "Merchants weighed it against silver in the markets of Timbuktu.",
    "Whole cities grew up around the deposits and the roads to them.",
    "Taxes on the mineral funded armies for most of a century.",
    "Refrigeration eventually made the preserving trade redundant.",
    "What remains is a seasoning nobody thinks twice about.",
  ];

  /** Pages shaped like extracted PDF text: constant head, numbered foot. */
  function makePages(count: number): string[] {
    return Array.from({ length: count }, (_, i) =>
      [
        "A History of Salt",
        "",
        BODIES[i % BODIES.length],
        "A second line of body prose follows it, carrying the argument onward.",
        "",
        `Page ${i + 1}`,
      ].join("\n"),
    );
  }

  it("removes a running head and a numbered foot", () => {
    const stripped = stripRunningHeaders(makePages(6));

    for (const page of stripped) {
      expect(page).not.toContain("A History of Salt");
      expect(page).not.toMatch(/^Page \d+$/m);
      expect(page).toContain("A second line of body prose");
    }
  });

  it("leaves body text alone even when it repeats verbatim", () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      [
        "Head",
        "",
        "This identical sentence appears in the middle of every single page " +
          "of this document and is unmistakably body text.",
        `Page ${i + 1}`,
      ].join("\n"),
    );
    const stripped = stripRunningHeaders(pages);

    for (const page of stripped) {
      expect(page).toContain("This identical sentence appears");
    }
  });

  it("does nothing below the minimum page count", () => {
    const pages = makePages(3);
    expect(stripRunningHeaders(pages)).toEqual(pages);
  });

  it("does nothing when no line recurs often enough", () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      [`Unique head ${String.fromCharCode(65 + i)}`, "", BODIES[i]].join("\n"),
    );
    expect(stripRunningHeaders(pages)).toEqual(pages);
  });

  it("keeps a short recurring line that reads as prose", () => {
    // Same on every page and short, but too many words to be a running head.
    const line = "And then the whole argument turned back on itself again.";
    const pages = Array.from({ length: 6 }, (_, i) =>
      ["Head", "", line, BODIES[i], "", `Page ${i + 1}`].join("\n"),
    );
    const stripped = stripRunningHeaders(pages);

    for (const page of stripped) {
      expect(page).toContain(line);
    }
  });

  it("is off by default in chunkPages and opt-in via the flag", () => {
    const pages = makePages(6);

    const withHeaders = chunkPages(pages);
    expect(withHeaders.some((c) => c.text.includes("A History of Salt"))).toBe(
      true,
    );

    const without = chunkPages(pages, { stripRunningHeaders: true });
    expect(without.some((c) => c.text.includes("A History of Salt"))).toBe(
      false,
    );
    expect(
      without.some((c) => c.text.includes("A second line of body prose")),
    ).toBe(true);
  });
});
