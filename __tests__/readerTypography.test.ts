/**
 * readerTypography.test.ts
 * Covers the reader-settings contract: clamping on read (so a corrupt or
 * stale record can never produce an unreadable page) and the point ⇄ percent
 * conversion at the EPUB boundary.
 */

import {
  EPUB_BASE_FONT_PT,
  buildEpubTypographyCss,
  epubPercentToReaderFontSize,
  readerFontSizeToEpubPercent,
} from "@/services/epubTypography";
import {
  getDefaultReaderSettings,
  getSavedReaderSettings,
} from "@/services/readerSettingsService";
import { DEFAULT_READER_SETTINGS } from "@/src/types/document-viewer.types";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

// Embedded faces are read from the asset bundle, which has no meaning here.
jest.mock("@/services/readingFontLoader", () => ({
  READING_FACES: [
    {
      id: "system-ui",
      label: "System",
      family: "system-ui",
      fallback: "sans-serif",
      hint: "",
    },
  ],
  getReadingFace: (id: string) => ({
    id,
    label: id,
    family: id === "Merriweather" ? "InscribedSerif" : "system-ui",
    fallback: "serif",
    hint: "",
  }),
  buildFontFaceCss: jest.fn(async (id: string) =>
    id === "Merriweather"
      ? "@font-face{font-family:'InscribedSerif';src:url(data:font/ttf;base64,AAAA) format('truetype')}"
      : "",
  ),
  buildFontStack: (id: string) =>
    id === "Merriweather" ? "'InscribedSerif',serif" : "sans-serif",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- read back the mock
const AsyncStorage = require("@react-native-async-storage/async-storage");

function storedAs(value: unknown): void {
  AsyncStorage.getItem.mockResolvedValueOnce(
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("reader settings defaults", () => {
  it("carries every field of the unified type", () => {
    const s = getDefaultReaderSettings("light");
    expect(Object.keys(s).sort()).toEqual(
      Object.keys(DEFAULT_READER_SETTINGS).sort(),
    );
  });

  it("follows the app colour scheme until the reader chooses", () => {
    expect(getDefaultReaderSettings("dark").theme).toBe("dark");
    expect(getDefaultReaderSettings("light").theme).toBe("light");
  });
});

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

describe("clamping on read", () => {
  it("returns null when nothing was ever saved", async () => {
    AsyncStorage.getItem.mockResolvedValueOnce(null);
    expect(await getSavedReaderSettings()).toBeNull();
  });

  it("clamps every out-of-range value", async () => {
    storedAs({
      fontSize: 900,
      lineHeight: 99,
      theme: "neon",
      fontFamily: "",
      margin: 9999,
      textAlign: "centre",
      paragraphSpacing: 42,
    });

    const s = await getSavedReaderSettings();
    expect(s).toEqual({
      fontSize: 32,
      lineHeight: 2.4,
      theme: "light",
      fontFamily: "system-ui",
      margin: 64,
      textAlign: "left",
      paragraphSpacing: 2,
    });
  });

  it("clamps negatives up to the floor", async () => {
    storedAs({
      fontSize: -5,
      lineHeight: -1,
      theme: "dark",
      fontFamily: "Lato",
      margin: -30,
      textAlign: "justify",
      paragraphSpacing: -4,
    });

    const s = await getSavedReaderSettings();
    expect(s?.fontSize).toBe(12);
    expect(s?.lineHeight).toBe(1.2);
    expect(s?.margin).toBe(0);
    expect(s?.paragraphSpacing).toBe(0);
    // Valid values are left alone.
    expect(s?.theme).toBe("dark");
    expect(s?.fontFamily).toBe("Lato");
    expect(s?.textAlign).toBe("justify");
  });

  it("fills in fields written before they existed", async () => {
    // A record from the previous schema: no margin, align or spacing.
    storedAs({
      fontSize: 18,
      lineHeight: 1.8,
      theme: "sepia",
      fontFamily: "system-ui",
    });

    const s = await getSavedReaderSettings();
    expect(s?.fontSize).toBe(18);
    expect(s?.margin).toBe(16);
    expect(s?.textAlign).toBe("left");
    expect(s?.paragraphSpacing).toBe(1);
  });

  it("survives corrupt storage without throwing", async () => {
    storedAs("{not json at all");
    expect(await getSavedReaderSettings()).toBeNull();

    AsyncStorage.getItem.mockResolvedValueOnce("[]");
    const list = await getSavedReaderSettings();
    // An array parses, so it is clamped rather than rejected — every field
    // still lands on a readable value, which is the property that matters.
    expect(list?.fontSize).toBe(17);
    expect(list?.theme).toBe("light");
  });

  it("keeps a paragraph spacing of exactly zero", async () => {
    storedAs({
      fontSize: 16,
      lineHeight: 1.6,
      theme: "light",
      fontFamily: "system-ui",
      margin: 0,
      textAlign: "left",
      paragraphSpacing: 0,
    });

    const s = await getSavedReaderSettings();
    // 0 is a deliberate choice, not a missing value.
    expect(s?.paragraphSpacing).toBe(0);
    expect(s?.margin).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EPUB boundary
// ---------------------------------------------------------------------------

describe("point / percent conversion", () => {
  it("treats the base size as 100%", () => {
    expect(readerFontSizeToEpubPercent(EPUB_BASE_FONT_PT)).toBe(100);
    expect(epubPercentToReaderFontSize(100)).toBe(EPUB_BASE_FONT_PT);
  });

  it("scales proportionally", () => {
    expect(readerFontSizeToEpubPercent(24)).toBe(150);
    expect(readerFontSizeToEpubPercent(12)).toBe(75);
    expect(epubPercentToReaderFontSize(150)).toBe(24);
  });

  it("round-trips the sizes the slider can produce", () => {
    for (let pt = 12; pt <= 32; pt++) {
      const back = epubPercentToReaderFontSize(readerFontSizeToEpubPercent(pt));
      expect(Math.abs(back - pt)).toBeLessThanOrEqual(1);
    }
  });

  it("falls back to the base size on a non-finite input", () => {
    expect(readerFontSizeToEpubPercent(NaN)).toBe(100);
    expect(epubPercentToReaderFontSize(NaN)).toBe(EPUB_BASE_FONT_PT);
  });
});

describe("buildEpubTypographyCss", () => {
  const base = { ...DEFAULT_READER_SETTINGS };

  it("emits the reader's choices with enough specificity to win", async () => {
    const css = await buildEpubTypographyCss({
      ...base,
      lineHeight: 1.9,
      margin: 32,
      textAlign: "justify",
      paragraphSpacing: 1.5,
    });

    expect(css).toContain("line-height:1.9 !important");
    expect(css).toContain("margin-left:32px !important");
    expect(css).toContain("text-align:justify !important");
    expect(css).toContain("margin-bottom:1.5em !important");
    // Books style p directly, so body-level rules alone would be overridden.
    expect(css).toContain("p,li,blockquote,div{");
  });

  it("hyphenates justified text and leaves ragged-right alone", async () => {
    const justified = await buildEpubTypographyCss({
      ...base,
      textAlign: "justify",
    });
    expect(justified).toContain("hyphens:auto");

    const ragged = await buildEpubTypographyCss({ ...base, textAlign: "left" });
    expect(ragged).not.toContain("hyphens:auto");
  });

  it("embeds a face only when one is selected", async () => {
    const system = await buildEpubTypographyCss(base);
    expect(system).not.toContain("@font-face");

    const serif = await buildEpubTypographyCss({
      ...base,
      fontFamily: "Merriweather",
    });
    expect(serif).toContain("@font-face");
    expect(serif).toContain("'InscribedSerif',serif");
  });

  it("never sets a text colour, so reader themes keep control", async () => {
    const css = await buildEpubTypographyCss({ ...base, theme: "dark" });
    expect(css).not.toMatch(/[^-]color\s*:/);
    expect(css).not.toContain("background");
  });

  it("clamps values it is handed out of range", async () => {
    const css = await buildEpubTypographyCss({
      ...base,
      lineHeight: 99,
      margin: -20,
      paragraphSpacing: 50,
    });
    expect(css).toContain("line-height:2.4 !important");
    expect(css).toContain("margin-left:0px !important");
    expect(css).toContain("margin-bottom:2em !important");
  });
});
