/**
 * citations.test.ts
 * Old backends send { page, quote }; contract v2 sends { id, page, locator,
 * quote, chunkId }. Both must parse, junk must be dropped, and every citation
 * must come out with a human label. Also covers the navigator's viewer params.
 */

import {
  citationMarkerIds,
  isV2CitationShape,
  locatorLabel,
  locatorTypeForDocument,
  parseCitations,
  removeOrphanCitationMarkers,
  stripCitationMarkers,
} from "@/services/ai/citations";
import {
  buildCitationParams,
  parseLocatorParams,
  viewerPathFor,
} from "@/services/ai/citationNavigator";

describe("parseCitations", () => {
  it("accepts the old { page, quote } shape and builds labels", () => {
    const out = parseCitations([
      { page: 3, quote: "  First quote  " },
      { page: "4", quote: "" },
    ]);
    expect(out).toEqual([
      { id: 1, page: 3, quote: "First quote", locator: { type: "page", index: 3, label: "Page 3" } },
      { id: 2, page: 4, quote: "", locator: { type: "page", index: 4, label: "Page 4" } },
    ]);
  });

  it("labels old-shape EPUB citations as chapters", () => {
    const [c] = parseCitations([{ page: 7, quote: "q" }], { locatorType: "chapter" });
    expect(c.locator).toEqual({ type: "chapter", index: 7, label: "Chapter 7" });
  });

  it("accepts the contract v2 shape as sent", () => {
    const [c] = parseCitations([
      {
        id: 2,
        page: 12,
        locator: { type: "slide", index: 12, label: "Slide 12" },
        quote: "Exact text.",
        chunkId: 7,
      },
    ]);
    expect(c).toEqual({
      id: 2,
      page: 12,
      locator: { type: "slide", index: 12, label: "Slide 12" },
      quote: "Exact text.",
      chunkId: 7,
    });
  });

  it("uses the locator index when page is missing and builds a missing label", () => {
    const [c] = parseCitations([{ id: 1, locator: { type: "sheet", index: 2 }, quote: "x" }]);
    expect(c.page).toBe(2);
    expect(c.locator?.label).toBe("Sheet 2");
  });

  it("drops junk and never throws", () => {
    expect(parseCitations(null)).toEqual([]);
    expect(parseCitations("nope")).toEqual([]);
    expect(parseCitations({ page: 1 })).toEqual([]);
    expect(
      parseCitations([null, 5, "x", {}, { page: -1 }, { page: "abc" }, { page: 2, quote: 9 }]),
    ).toEqual([{ id: 7, page: 2, quote: "", locator: { type: "page", index: 2, label: "Page 2" } }]);
  });

  it("re-numbers duplicate or zero ids", () => {
    const out = parseCitations([
      { id: 1, page: 1, quote: "a" },
      { id: 1, page: 2, quote: "b" },
      { id: 0, page: 3, quote: "c" },
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(3);
  });

  it("ignores an invalid locator type", () => {
    const [c] = parseCitations([{ page: 5, locator: { type: "paragraph", index: 5 }, quote: "q" }]);
    expect(c.locator?.type).toBe("page");
  });
});

describe("citation helpers", () => {
  it("detects the v2 shape", () => {
    expect(isV2CitationShape([{ page: 1, quote: "a" }])).toBe(false);
    expect(isV2CitationShape([{ id: 1, page: 1, quote: "a" }])).toBe(true);
    expect(isV2CitationShape(undefined)).toBe(false);
  });

  it("finds, strips and prunes [n] markers", () => {
    const text = "Revenue rose [1]. Costs fell [2][3]. Again [1].";
    expect(citationMarkerIds(text)).toEqual([1, 2, 3]);
    expect(stripCitationMarkers(text)).toBe("Revenue rose. Costs fell. Again.");
    const kept = removeOrphanCitationMarkers(text, parseCitations([{ id: 1, page: 1, quote: "q" }]));
    expect(kept).toBe("Revenue rose [1]. Costs fell. Again [1].");
  });

  it("labels every locator type", () => {
    expect(locatorLabel("page", 1)).toBe("Page 1");
    expect(locatorLabel("slide", 2)).toBe("Slide 2");
    expect(locatorLabel("sheet", 3)).toBe("Sheet 3");
    expect(locatorLabel("chapter", 4)).toBe("Chapter 4");
    expect(locatorLabel("section", 5)).toBe("Section 5");
    expect(locatorLabel(undefined, 6)).toBe("Page 6");
  });

  it("maps documents to locator types", () => {
    expect(locatorTypeForDocument({ name: "a.pdf" })).toBe("page");
    expect(locatorTypeForDocument({ name: "deck.pptx" })).toBe("slide");
    expect(locatorTypeForDocument({ name: "numbers.xlsx" })).toBe("sheet");
    expect(locatorTypeForDocument({ mimeType: "application/epub+zip" })).toBe("chapter");
    expect(locatorTypeForDocument({ name: "notes.docx" })).toBe("section");
    expect(locatorTypeForDocument({ name: "readme.txt" })).toBe("section");
    expect(locatorTypeForDocument({ fileType: "csv" })).toBe("section");
    expect(locatorTypeForDocument({})).toBe("page");
  });
});

describe("citation navigator params", () => {
  const citation = parseCitations([
    { id: 1, page: 9, locator: { type: "chapter", index: 9, label: "Chapter 9" }, quote: "It was a dark night." },
  ])[0];

  it("chooses the right viewer", () => {
    expect(viewerPathFor({ name: "a.PDF" })).toBe("/pdf-viewer");
    expect(viewerPathFor({ name: "b.epub" })).toBe("/epub-viewer");
    expect(viewerPathFor({ name: "c.docx" })).toBe("/docx-viewer");
    expect(viewerPathFor({ name: "d.pptx" })).toBe("/ppt-viewer");
    expect(viewerPathFor({ name: "e.xlsx" })).toBeNull();
  });

  it("round-trips locator params and encodes the uri like the library does", () => {
    const params = buildCitationParams({ uri: "content://x/doc 1.epub", name: "doc.epub" }, citation);
    expect(params.uri).toBe(encodeURIComponent("content://x/doc 1.epub"));
    expect(parseLocatorParams(params)).toEqual({
      locatorType: "chapter",
      index: 9,
      quote: "It was a dark night.",
    });
  });

  it("returns null for missing or invalid params (today's behavior)", () => {
    expect(parseLocatorParams({})).toBeNull();
    expect(parseLocatorParams({ locatorType: "page", locatorIndex: "0" })).toBeNull();
    expect(parseLocatorParams({ locatorType: "bogus", locatorIndex: "3" })).toBeNull();
    expect(parseLocatorParams({ locatorType: ["slide"], locatorIndex: ["4"] })).toEqual({
      locatorType: "slide",
      index: 4,
      quote: "",
    });
  });
});
