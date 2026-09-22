/**
 * bookCovers.test.ts
 * Covers the parts of the shelf that must behave identically on every launch:
 * the cache key and the generated placeholder.
 *
 * Stability is the point. A shelf whose placeholder colours reshuffle between
 * launches reads as broken, because the colour is part of how someone
 * recognises a book without reading the title.
 */

import {
  coverKey,
  placeholderInitials,
  placeholderTint,
} from "@/services/bookCoverService";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  EncodingType: { Base64: "base64" },
}));

jest.mock("@/src/utils/epubExtractor", () => ({
  extractEpubCover: jest.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

describe("coverKey", () => {
  it("is stable for the same URI", () => {
    const uri = "file:///docs/The%20Long%20Ships.epub";
    expect(coverKey(uri)).toBe(coverKey(uri));
  });

  it("differs between files", () => {
    const keys = new Set(
      [
        "file:///a.epub",
        "file:///b.epub",
        "file:///docs/a.epub",
        "content://saf/tree/primary%3ABooks/a.epub",
      ].map(coverKey),
    );
    expect(keys.size).toBe(4);
  });

  it("is safe to use as a filename", () => {
    const key = coverKey("content://com.android.providers/tree/primary:Books/a b.epub");
    expect(key).toMatch(/^[a-z0-9]+$/);
  });

  it("does not collide across a realistic library", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      keys.add(coverKey(`file:///books/volume-${i}-of-the-series.epub`));
    }
    expect(keys.size).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Generated placeholder
// ---------------------------------------------------------------------------

describe("placeholderTint", () => {
  it("is stable across calls", () => {
    expect(placeholderTint("Moby Dick")).toBe(placeholderTint("Moby Dick"));
  });

  it("returns a usable colour for any title, including empty", () => {
    for (const title of ["", "A", "Moby Dick", "日本語のタイトル", "  "]) {
      expect(placeholderTint(title)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("spreads a real set of titles across the palette", () => {
    const titles = [
      "Moby Dick",
      "War and Peace",
      "The Odyssey",
      "Dune",
      "Neuromancer",
      "Beloved",
      "Ulysses",
      "Middlemarch",
      "Persuasion",
      "The Trial",
      "Invisible Man",
      "Wolf Hall",
    ];
    const distinct = new Set(titles.map(placeholderTint));
    // Not a guarantee of uniqueness — just that it is not collapsing to one.
    expect(distinct.size).toBeGreaterThan(3);
  });
});

describe("placeholderInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(placeholderInitials("Moby Dick")).toBe("MD");
    expect(placeholderInitials("War and Peace")).toBe("WA");
  });

  it("takes two letters from a single word", () => {
    expect(placeholderInitials("Dune")).toBe("DU");
  });

  it("drops a file extension rather than initialising it", () => {
    expect(placeholderInitials("Neuromancer.epub")).toBe("NE");
    expect(placeholderInitials("War and Peace.pdf")).toBe("WA");
  });

  it("treats separators in filenames as word breaks", () => {
    expect(placeholderInitials("the-long-ships.epub")).toBe("TL");
    expect(placeholderInitials("annual_report_2024.docx")).toBe("AR");
  });

  it("never returns an empty string", () => {
    for (const title of ["", "   ", "...", "—"]) {
      expect(placeholderInitials(title).length).toBeGreaterThan(0);
    }
  });
});
