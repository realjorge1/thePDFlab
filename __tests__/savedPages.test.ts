/**
 * savedPages.test.ts
 *
 * The store's job is to survive the file. These tests cover save/read/remove,
 * the 500 cap REFUSING rather than evicting (a saved page is user data, not
 * cache), notes, recordOpen, and thumbnail cleanup on remove.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockDeletedImages: (string | undefined | null)[] = [];

jest.mock("@/services/savedPageImageStore", () => ({
  deleteSavedPageImage: jest.fn(async (p: string | undefined | null) => {
    mockDeletedImages.push(p);
  }),
}));

// The snapshot store is the file system; in-memory stand-in keyed by id.
// normalizePageText is the real one — what it does to whitespace is part of
// what a stored page IS, so stubbing it would test nothing.
const mockSnapshots = new Map<string, string>();
const mockHtmlSnapshots = new Map<string, string>();
const mockDeletedSnapshots: (string | undefined | null)[] = [];

jest.mock("@/services/savedPageSnapshotStore", () => {
  const SNAPSHOT_MAX = 20_000;
  const normalizePageText = (raw: string): string =>
    !raw
      ? ""
      : raw
          .replace(/\r\n?/g, "\n")
          .replace(/[ \t\u00a0]+/g, " ")
          .replace(/ *\n */g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, SNAPSHOT_MAX);
  return {
    normalizePageText,
    snapshotPathFor: (id: string) => `file:///docs/saved-pages/text/${id}.txt`,
    writeSnapshot: jest.fn(async (id: string, text: string) => {
      const clean = normalizePageText(text);
      if (!id || !clean) return null;
      mockSnapshots.set(id, clean);
      return { path: `file:///docs/saved-pages/text/${id}.txt`, chars: clean.length };
    }),
    readSnapshot: jest.fn(async (pathOrId: string | undefined | null) => {
      if (!pathOrId) return null;
      const id = pathOrId.startsWith("file:")
        ? (pathOrId.split("/").pop() || "").replace(/\.txt$/, "")
        : pathOrId;
      return mockSnapshots.get(id) ?? null;
    }),
    deleteSnapshot: jest.fn(async (pathOrId: string | undefined | null) => {
      mockDeletedSnapshots.push(pathOrId);
    }),
    htmlSnapshotPathFor: (id: string) =>
      `file:///docs/saved-pages/text/${id}.html`,
    writeHtmlSnapshot: jest.fn(async (id: string, html: string) => {
      const clean = (html || "").trim();
      if (!id || !clean) return null;
      mockHtmlSnapshots.set(id, clean);
      return `file:///docs/saved-pages/text/${id}.html`;
    }),
    readHtmlSnapshot: jest.fn(async (pathOrId: string | undefined | null) => {
      if (!pathOrId) return null;
      const id = pathOrId.startsWith("file:")
        ? (pathOrId.split("/").pop() || "").replace(/\.html$/, "")
        : pathOrId;
      return mockHtmlSnapshots.get(id) ?? null;
    }),
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetSavedPagesForTests,
  findSavedPageAt,
  flushSavedPages,
  getSavedPage,
  getSavedPageGroups,
  getSavedPages,
  preloadSavedPages,
  recordOpen,
  relinkSavedPage,
  removeSavedPage,
  SAVED_PAGES_MAX,
  savePage,
  subscribeSavedPages,
  getSavedPageHtml,
  getSavedPageText,
  updateExcerpt,
  updateHtmlSnapshot,
  updateNote,
  updateSnapshot,
  type SavePageInput,
} from "@/services/savedPagesService";
import { EXCERPT_MAX, NOTE_MAX, SNAPSHOT_MAX } from "@/services/savedPagesTypes";

const STORAGE_KEY = "@wordsinscribed/saved_pages_v1";

function input(over: Partial<SavePageInput> = {}): SavePageInput {
  return {
    identityKey: "f1_abc_x",
    fileName: "Thermodynamics.pdf",
    fileExt: "pdf",
    fileUriAtSave: "file:///books/Thermodynamics.pdf",
    locatorType: "page",
    page: 12,
    totalPages: 300,
    excerpt: "The second law states that entropy never decreases.",
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockDeletedImages.length = 0;
  mockDeletedSnapshots.length = 0;
  mockSnapshots.clear();
  mockHtmlSnapshots.clear();
  __resetSavedPagesForTests();
});

describe("save / read / remove", () => {
  it("saves a page and reads it back with every displayable field", async () => {
    const res = await savePage(input());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const read = await getSavedPage(res.page.id);
    expect(read).toMatchObject({
      identityKey: "f1_abc_x",
      fileName: "Thermodynamics.pdf",
      fileExt: "pdf",
      locatorType: "page",
      page: 12,
      totalPages: 300,
      openCount: 0,
      lastOpenedAt: null,
    });
    expect(read!.excerpt).toContain("entropy");
    expect(read!.createdAt).toBeGreaterThan(0);
  });

  it("persists across a cold start", async () => {
    await savePage(input());
    await flushSavedPages();

    // Cold start: drop the in-memory cache, read from storage only.
    __resetSavedPagesForTests();
    await preloadSavedPages();

    const pages = await getSavedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].fileName).toBe("Thermodynamics.pdf");
  });

  it("renders from the record alone — the stored blob carries the excerpt", async () => {
    await savePage(input());
    await flushSavedPages();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toContain("entropy");
    expect(raw).toContain("Thermodynamics.pdf");
  });

  it("removes a page", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await expect(removeSavedPage(res.page.id)).resolves.toBe(true);
    await expect(getSavedPages()).resolves.toHaveLength(0);
    // Removing a second time is a no-op, not a crash.
    await expect(removeSavedPage(res.page.id)).resolves.toBe(false);
  });

  it("clips an over-long excerpt and note", async () => {
    const res = await savePage(
      input({ excerpt: "x".repeat(EXCERPT_MAX + 500), note: "n".repeat(NOTE_MAX + 200) }),
    );
    if (!res.ok) throw new Error("save failed");
    expect(res.page.excerpt).toHaveLength(EXCERPT_MAX);
    expect(res.page.note).toHaveLength(NOTE_MAX);
  });

  it("accepts an empty excerpt", async () => {
    const res = await savePage(input({ excerpt: "" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.page.excerpt).toBe("");
  });

  it("refuses a save with no identity key", async () => {
    const res = await savePage(input({ identityKey: "" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid");
  });

  it("survives a corrupt stored blob", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "{not json");
    await expect(getSavedPages()).resolves.toEqual([]);
  });

  it("drops malformed records but keeps good ones", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "good", identityKey: "k", excerpt: "fine", createdAt: 1, openCount: 0, lastOpenedAt: null },
        { identityKey: "no-id" },
        null,
        "nonsense",
      ]),
    );
    const pages = await getSavedPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("good");
  });
});

describe("the retention cap refuses instead of evicting", () => {
  it(`refuses the save at ${SAVED_PAGES_MAX} and keeps every existing page`, async () => {
    const existing = Array.from({ length: SAVED_PAGES_MAX }, (_, i) => ({
      id: `p${i}`,
      identityKey: "k",
      fileName: "f.pdf",
      fileExt: "pdf",
      fileUriAtSave: "",
      locatorType: "page",
      excerpt: "",
      createdAt: 1000 + i,
      openCount: 0,
      lastOpenedAt: null,
    }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    const res = await savePage(input());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("cap");
      expect(res.message).toContain(String(SAVED_PAGES_MAX));
    }

    // Nothing was evicted — the oldest record is still there.
    const pages = await getSavedPages();
    expect(pages).toHaveLength(SAVED_PAGES_MAX);
    expect(pages.some((p) => p.id === "p0")).toBe(true);
  });

  it("allows a save again once one is removed", async () => {
    const existing = Array.from({ length: SAVED_PAGES_MAX }, (_, i) => ({
      id: `p${i}`,
      identityKey: "k",
      fileName: "f.pdf",
      fileExt: "pdf",
      fileUriAtSave: "",
      locatorType: "page",
      excerpt: "",
      createdAt: 1000 + i,
      openCount: 0,
      lastOpenedAt: null,
    }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    await removeSavedPage("p0");
    await expect(savePage(input())).resolves.toMatchObject({ ok: true });
  });
});

describe("notes", () => {
  it("sets, replaces and clears a note", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    const { id } = res.page;

    await expect(updateNote(id, "Come back to this")).resolves.toBe(true);
    expect((await getSavedPage(id))!.note).toBe("Come back to this");

    await updateNote(id, "Changed my mind");
    expect((await getSavedPage(id))!.note).toBe("Changed my mind");

    await updateNote(id, "");
    expect((await getSavedPage(id))!.note).toBeUndefined();
  });

  it("returns false for an unknown id", async () => {
    await expect(updateNote("nope", "x")).resolves.toBe(false);
  });
});

describe("recordOpen", () => {
  it("counts return visits and stamps the time", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    const { id } = res.page;

    for (let i = 0; i < 4; i++) await recordOpen(id);

    const page = await getSavedPage(id);
    expect(page!.openCount).toBe(4);
    expect(page!.lastOpenedAt).toBeGreaterThan(0);
  });

  it("is a no-op for an unknown id", async () => {
    await expect(recordOpen("nope")).resolves.toBeUndefined();
  });
});

describe("thumbnail cleanup", () => {
  it("deletes the image file when the record is removed", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "withimg",
          identityKey: "k",
          fileName: "f.pdf",
          fileExt: "pdf",
          fileUriAtSave: "",
          locatorType: "page",
          excerpt: "",
          thumbPath: "file:///docs/saved-pages/withimg.jpg",
          createdAt: 1,
          openCount: 0,
          lastOpenedAt: null,
        },
      ]),
    );

    await removeSavedPage("withimg");
    expect(mockDeletedImages).toContain("file:///docs/saved-pages/withimg.jpg");
  });
});

describe("excerpt fill and re-linking", () => {
  it("fills an excerpt that arrived after the save and notifies subscribers", async () => {
    const res = await savePage(input({ excerpt: "" }));
    if (!res.ok) throw new Error("save failed");

    let notified = 0;
    const unsubscribe = subscribeSavedPages(() => {
      notified += 1;
    });

    await expect(updateExcerpt(res.page.id, "  Extracted   later.  ")).resolves.toBe(true);
    expect((await getSavedPage(res.page.id))!.excerpt).toBe("Extracted later.");
    expect(notified).toBe(1);

    // No change → no write, no notification.
    await expect(updateExcerpt(res.page.id, "Extracted later.")).resolves.toBe(false);
    expect(notified).toBe(1);

    unsubscribe();
  });

  it("re-links a record without rewriting the user's snapshot", async () => {
    const res = await savePage(input({ note: "mine" }));
    if (!res.ok) throw new Error("save failed");

    await relinkSavedPage(res.page.id, {
      identityKey: "f1_new_y",
      fileUriAtSave: "file:///new/Thermodynamics.pdf",
    });

    const page = await getSavedPage(res.page.id);
    expect(page!.identityKey).toBe("f1_new_y");
    expect(page!.fileUriAtSave).toBe("file:///new/Thermodynamics.pdf");
    // The snapshot is the user's, and is never rewritten by a re-link.
    expect(page!.note).toBe("mine");
    expect(page!.excerpt).toContain("entropy");
    expect(page!.page).toBe(12);
  });
});

describe("the page snapshot — what makes a bookmark a page, not a pointer", () => {
  it("stores the whole page and reads it back, file or no file", async () => {
    const res = await savePage(input({ excerpt: "" }));
    if (!res.ok) throw new Error("save failed");

    const pageText = [
      "The second law states that entropy never decreases.",
      "It is the only physical law that distinguishes past from future.",
    ].join("\n\n");

    expect(await updateSnapshot(res.page.id, pageText)).toBe(true);

    // Nothing below touches a file, a URI or the file index — the same call
    // answers identically after the source is deleted from the device.
    const shown = await getSavedPageText(res.page.id);
    expect(shown.full).toBe(true);
    expect(shown.text).toBe(pageText);

    const record = await getSavedPage(res.page.id);
    expect(record?.snapshotPath).toContain(res.page.id);
    expect(record?.snapshotChars).toBe(pageText.length);
  });

  it("survives a cold start: the path is persisted, the page is re-read", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateSnapshot(res.page.id, "Page one.\n\nPage one, continued.");
    await flushSavedPages();

    __resetSavedPagesForTests();
    await preloadSavedPages();

    const shown = await getSavedPageText(res.page.id);
    expect(shown.full).toBe(true);
    expect(shown.text).toBe("Page one.\n\nPage one, continued.");
  });

  it("keeps paragraph breaks and collapses only horizontal whitespace", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateSnapshot(
      res.page.id,
      "  First   paragraph.  \r\n\r\n\r\n\r\nSecond\tparagraph.  ",
    );

    const shown = await getSavedPageText(res.page.id);
    expect(shown.text).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("caps a runaway capture at SNAPSHOT_MAX", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateSnapshot(res.page.id, "z".repeat(SNAPSHOT_MAX + 5_000));

    const record = await getSavedPage(res.page.id);
    expect(record?.snapshotChars).toBe(SNAPSHOT_MAX);
    expect((await getSavedPageText(res.page.id)).text).toHaveLength(SNAPSHOT_MAX);
  });

  it("falls back to the excerpt for a record saved before snapshots existed", async () => {
    const res = await savePage(input({ excerpt: "Only a preview was kept." }));
    if (!res.ok) throw new Error("save failed");

    const shown = await getSavedPageText(res.page.id);
    // full:false is what tells the screen to say so rather than pass a
    // 600-char stub off as the page.
    expect(shown.full).toBe(false);
    expect(shown.text).toBe("Only a preview was kept.");
  });

  it("refuses to store an empty capture, leaving the record snapshot-less", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");

    expect(await updateSnapshot(res.page.id, "   \n\n  ")).toBe(false);
    const record = await getSavedPage(res.page.id);
    expect(record?.snapshotPath).toBeUndefined();
    expect((await getSavedPageText(res.page.id)).full).toBe(false);
  });

  it("is a no-op for an unknown id", async () => {
    expect(await updateSnapshot("nope", "text")).toBe(false);
    expect(await getSavedPageText("nope")).toEqual({ text: "", full: false });
  });

  it("deletes the stored page when the bookmark is removed", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateSnapshot(res.page.id, "A page that is about to be removed.");
    const record = await getSavedPage(res.page.id);

    await removeSavedPage(res.page.id);
    expect(mockDeletedSnapshots).toContain(record?.snapshotPath);
  });

  it("keeps the saved page when the record is re-linked to a found file", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateSnapshot(res.page.id, "The page the reader kept.");

    await relinkSavedPage(res.page.id, {
      identityKey: "f2_moved_y",
      fileUriAtSave: "file:///elsewhere/Thermodynamics.pdf",
    });

    const shown = await getSavedPageText(res.page.id);
    expect(shown.text).toBe("The page the reader kept.");
    expect(shown.full).toBe(true);
  });
});

describe("the markup snapshot — how a reflow page looked", () => {
  it("stores the page markup and reads it back with its surface styling", async () => {
    const res = await savePage(input({ fileExt: "docx", locatorType: "section" }));
    if (!res.ok) throw new Error("save failed");

    const html = "<h2>Heat engines</h2><p>No cycle can be <em>perfectly</em> efficient.</p>";
    const css = "font-family:Merriweather;font-size:17px;line-height:1.6";

    expect(await updateHtmlSnapshot(res.page.id, html, css)).toBe(true);

    const markup = await getSavedPageHtml(res.page.id);
    expect(markup).toEqual({ html, css });

    const record = await getSavedPage(res.page.id);
    expect(record?.htmlPath).toContain(res.page.id);
    expect(record?.htmlCss).toBe(css);
  });

  it("survives a cold start", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateHtmlSnapshot(res.page.id, "<p>Kept.</p>", "font-size:16px");
    await flushSavedPages();

    __resetSavedPagesForTests();
    await preloadSavedPages();

    expect(await getSavedPageHtml(res.page.id)).toEqual({
      html: "<p>Kept.</p>",
      css: "font-size:16px",
    });
  });

  it("returns null for a record with no markup — a PDF, or an older save", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    expect(await getSavedPageHtml(res.page.id)).toBeNull();
  });

  it("refuses empty markup, leaving the record without it", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    expect(await updateHtmlSnapshot(res.page.id, "   ", "font-size:16px")).toBe(
      false,
    );
    expect((await getSavedPage(res.page.id))?.htmlPath).toBeUndefined();
  });

  it("is a no-op for an unknown id", async () => {
    expect(await updateHtmlSnapshot("nope", "<p>x</p>", "")).toBe(false);
    expect(await getSavedPageHtml("nope")).toBeNull();
  });

  it("deletes the markup with the bookmark, text snapshot included", async () => {
    const res = await savePage(input());
    if (!res.ok) throw new Error("save failed");
    await updateSnapshot(res.page.id, "The text of the page.");
    await updateHtmlSnapshot(res.page.id, "<p>The page.</p>", "");
    const record = await getSavedPage(res.page.id);

    await removeSavedPage(res.page.id);
    expect(mockDeletedSnapshots).toContain(record?.snapshotPath);
    expect(mockDeletedSnapshots).toContain(record?.htmlPath);
  });

  it("keeps text and markup independent: one can exist without the other", async () => {
    const textOnly = await savePage(input());
    const markupOnly = await savePage(input({ page: 13 }));
    if (!textOnly.ok || !markupOnly.ok) throw new Error("save failed");

    await updateSnapshot(textOnly.page.id, "Words only.");
    await updateHtmlSnapshot(markupOnly.page.id, "<p>Markup only.</p>", "");

    expect((await getSavedPageText(textOnly.page.id)).full).toBe(true);
    expect(await getSavedPageHtml(textOnly.page.id)).toBeNull();

    expect((await getSavedPageText(markupOnly.page.id)).full).toBe(false);
    expect(await getSavedPageHtml(markupOnly.page.id)).not.toBeNull();
  });
});

describe("findSavedPageAt", () => {
  it("matches a PDF page and drives the saved/unsaved toggle", async () => {
    await savePage(input({ page: 12 }));
    await expect(
      findSavedPageAt({ identityKey: "f1_abc_x", locatorType: "page", page: 12 }),
    ).resolves.not.toBeNull();
    await expect(
      findSavedPageAt({ identityKey: "f1_abc_x", locatorType: "page", page: 13 }),
    ).resolves.toBeNull();
  });

  it("matches an EPUB CFI", async () => {
    await savePage(
      input({ locatorType: "chapter", page: undefined, cfi: "epubcfi(/6/14!/4/2)" }),
    );
    await expect(
      findSavedPageAt({
        identityKey: "f1_abc_x",
        locatorType: "chapter",
        cfi: "epubcfi(/6/14!/4/2)",
      }),
    ).resolves.not.toBeNull();
  });

  it("treats a nearby scroll position as the same place", async () => {
    await savePage(
      input({ locatorType: "section", page: undefined, scrollPct: 40 }),
    );
    await expect(
      findSavedPageAt({ identityKey: "f1_abc_x", locatorType: "section", scrollPct: 41 }),
    ).resolves.not.toBeNull();
    await expect(
      findSavedPageAt({ identityKey: "f1_abc_x", locatorType: "section", scrollPct: 60 }),
    ).resolves.toBeNull();
  });
});

describe("grouping", () => {
  it("groups by file and labels each group with its file name", async () => {
    await savePage(input({ page: 1 }));
    await savePage(input({ page: 2 }));
    await savePage(
      input({ identityKey: "f1_other_y", fileName: "Optics.pdf", page: 9 }),
    );

    const groups = await getSavedPageGroups("added");
    expect(groups).toHaveLength(2);
    const names = groups.map((g) => g.fileName).sort();
    expect(names).toEqual(["Optics.pdf", "Thermodynamics.pdf"]);
    const thermo = groups.find((g) => g.fileName === "Thermodynamics.pdf")!;
    expect(thermo.pages).toHaveLength(2);
  });
});
