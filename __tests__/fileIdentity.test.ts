/**
 * fileIdentity.test.ts
 *
 * The whole point of the identity key is that it survives the things that
 * change a URI: the app copying a file into its cache directory, Android's
 * SAF re-encoding a content:// URI, and a re-download landing on a new path.
 * It must also keep working for a file that is gone, because Saved Pages
 * deliberately outlive the file.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockInfo = new Map<
  string,
  { exists: boolean; size?: number; modificationTime?: number }
>();
const mockThrowingUris = new Set<string>();

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(async (uri: string) => {
    if (mockThrowingUris.has(uri)) throw new Error("cannot stat");
    return mockInfo.get(uri) ?? { exists: false };
  }),
}));

const mockFiles: { name: string; uri: string; size?: number }[] = [];

jest.mock("@/services/fileIndexService", () => {
  const actual = jest.requireActual("@/services/fileIndexService");
  return {
    // The real hash — the identity key must be built from the repo's own
    // dependency-free hash, not a test double of one.
    generateFileId: actual.generateFileId,
    getAllFiles: jest.fn(async () => mockFiles),
  };
});

import {
  extensionFromName,
  fileNameFromUri,
  getFileIdentity,
  identityFromKnown,
  identityKeyFrom,
  isLowConfidenceKey,
  resolveIdentityToLiveUri,
} from "@/services/fileIdentity";

beforeEach(() => {
  mockInfo.clear();
  mockThrowingUris.clear();
  mockFiles.length = 0;
});

describe("identityKeyFrom", () => {
  it("is stable and pure", () => {
    expect(identityKeyFrom("Thermodynamics.pdf", 1024)).toBe(
      identityKeyFrom("Thermodynamics.pdf", 1024),
    );
  });

  it("ignores case and surrounding whitespace in the name", () => {
    expect(identityKeyFrom("  Thermodynamics.PDF  ", 1024)).toBe(
      identityKeyFrom("thermodynamics.pdf", 1024),
    );
  });

  it("gives identical names with different sizes different keys", () => {
    expect(identityKeyFrom("notes.pdf", 1024)).not.toBe(
      identityKeyFrom("notes.pdf", 2048),
    );
  });

  it("gives different names the same size different keys", () => {
    expect(identityKeyFrom("a.pdf", 1024)).not.toBe(
      identityKeyFrom("b.pdf", 1024),
    );
  });

  it("falls back to a name-only key when the size is unknown", () => {
    const key = identityKeyFrom("notes.pdf");
    expect(key).toBe(identityKeyFrom("notes.pdf", undefined));
    expect(isLowConfidenceKey(key)).toBe(true);
    expect(isLowConfidenceKey(identityKeyFrom("notes.pdf", 10))).toBe(false);
  });

  it("contains no part of any URI", async () => {
    mockInfo.set("file:///cache/a/notes.pdf", { exists: true, size: 900 });
    const id = await getFileIdentity("file:///cache/a/notes.pdf");
    expect(id.key).not.toContain("cache");
    expect(id.key).not.toContain("notes");
    expect(id.key).not.toContain("file");
  });
});

describe("getFileIdentity", () => {
  it("gives the same file at two different URIs one key", async () => {
    mockInfo.set("file:///inbox/Thermodynamics.pdf", {
      exists: true,
      size: 5_242_880,
      modificationTime: 111,
    });
    mockInfo.set("file:///cache/library-cache/Thermodynamics.pdf", {
      exists: true,
      size: 5_242_880,
      // A copy has a different mtime — the key must not care.
      modificationTime: 999,
    });

    const a = await getFileIdentity("file:///inbox/Thermodynamics.pdf");
    const b = await getFileIdentity(
      "file:///cache/library-cache/Thermodynamics.pdf",
    );

    expect(a.key).toBe(b.key);
    expect(a.uri).not.toBe(b.uri);
    expect(a.mtime).not.toBe(b.mtime);
  });

  it("gives a content:// URI and its re-encoded form one key", async () => {
    // The two shapes reEncodeSafDocumentUri converts between.
    const raw =
      "content://com.android.externalstorage.documents/tree/primary:Documents/document/primary:Documents/Book.epub";
    const reEncoded =
      "content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments%2FBook.epub";

    mockInfo.set(raw, { exists: true, size: 733_000 });
    mockInfo.set(reEncoded, { exists: true, size: 733_000 });

    const a = await getFileIdentity(raw);
    const b = await getFileIdentity(reEncoded);

    expect(a.key).toBe(b.key);
    expect(a.name).toBe("Book.epub");
    expect(b.name).toBe("Book.epub");
  });

  it("still yields a usable identity for a missing file", async () => {
    const id = await getFileIdentity("file:///gone/Deleted.pdf");
    expect(id.key).toBeTruthy();
    expect(id.name).toBe("Deleted.pdf");
    expect(id.ext).toBe("pdf");
    expect(id.size).toBeUndefined();
    expect(id.mtime).toBeUndefined();
    expect(isLowConfidenceKey(id.key)).toBe(true);
  });

  it("never throws when the file cannot be stat'ed", async () => {
    mockThrowingUris.add("content://weird/doc");
    const id = await getFileIdentity("content://weird/doc", "Report.docx");
    expect(id.key).toBe(identityKeyFrom("Report.docx"));
    expect(id.size).toBeUndefined();
  });

  it("prefers an explicit name over the one in the URI", async () => {
    mockInfo.set("file:///cache/tmp_8471.bin", { exists: true, size: 12 });
    const id = await getFileIdentity("file:///cache/tmp_8471.bin", "Real Name.pdf");
    expect(id.name).toBe("Real Name.pdf");
    expect(id.key).toBe(identityKeyFrom("Real Name.pdf", 12));
  });

  it("reports a stable fileId for cross-referencing the file index", async () => {
    const a = await getFileIdentity("file:///x/a.pdf");
    const b = await getFileIdentity("file:///x/a.pdf");
    const c = await getFileIdentity("file:///y/a.pdf");
    expect(a.fileId).toBe(b.fileId);
    expect(a.fileId).not.toBe(c.fileId);
  });
});

describe("identityFromKnown", () => {
  it("matches getFileIdentity for the same name and size", async () => {
    mockInfo.set("file:///x/a.pdf", { exists: true, size: 4096 });
    const async_ = await getFileIdentity("file:///x/a.pdf");
    const sync = identityFromKnown({ uri: "file:///x/a.pdf", name: "a.pdf", size: 4096 });
    expect(sync.key).toBe(async_.key);
  });
});

describe("resolveIdentityToLiveUri", () => {
  it("finds a file whose URI changed since the key was minted", async () => {
    mockInfo.set("file:///old/Book.pdf", { exists: true, size: 2048 });
    const saved = await getFileIdentity("file:///old/Book.pdf");

    // The file is re-downloaded to a new path; the index follows it.
    mockInfo.delete("file:///old/Book.pdf");
    mockInfo.set("file:///new/Book.pdf", { exists: true, size: 2048 });
    mockFiles.push({ name: "Book.pdf", uri: "file:///new/Book.pdf", size: 2048 });

    await expect(resolveIdentityToLiveUri(saved.key)).resolves.toBe(
      "file:///new/Book.pdf",
    );
  });

  it("returns null when the file is gone from the index", async () => {
    const saved = await getFileIdentity("file:///old/Book.pdf");
    await expect(resolveIdentityToLiveUri(saved.key)).resolves.toBeNull();
  });

  it("returns null when the index still lists a file that no longer exists", async () => {
    mockFiles.push({ name: "Book.pdf", uri: "file:///stale/Book.pdf", size: 2048 });
    const key = identityKeyFrom("Book.pdf", 2048);
    // getInfoAsync says exists:false → deleted from the device.
    await expect(resolveIdentityToLiveUri(key)).resolves.toBeNull();
  });

  it("matches a name-only key against an index entry that knows the size", async () => {
    mockInfo.set("file:///new/Book.pdf", { exists: true, size: 2048 });
    mockFiles.push({ name: "Book.pdf", uri: "file:///new/Book.pdf", size: 2048 });
    // Saved while the file could not be stat'ed.
    const key = identityKeyFrom("Book.pdf");
    await expect(resolveIdentityToLiveUri(key)).resolves.toBe("file:///new/Book.pdf");
  });

  it("matches a size-aware key against an index entry with no size", async () => {
    mockInfo.set("file:///new/Book.pdf", { exists: true, size: 2048 });
    mockFiles.push({ name: "Book.pdf", uri: "file:///new/Book.pdf" });
    const key = identityKeyFrom("Book.pdf");
    await expect(resolveIdentityToLiveUri(key)).resolves.toBe("file:///new/Book.pdf");
  });

  it("hands back a SAF URI it cannot stat rather than declaring it gone", async () => {
    const uri = "content://saf/tree/x/document/y";
    mockThrowingUris.add(uri);
    mockFiles.push({ name: "Book.pdf", uri, size: 2048 });
    await expect(resolveIdentityToLiveUri(identityKeyFrom("Book.pdf", 2048))).resolves.toBe(uri);
  });

  it("returns null for an empty key and never throws", async () => {
    await expect(resolveIdentityToLiveUri("")).resolves.toBeNull();
  });
});

describe("helpers", () => {
  it("extracts file names from plain and SAF URIs", () => {
    expect(fileNameFromUri("file:///a/b/My%20Book.pdf")).toBe("My Book.pdf");
    expect(
      fileNameFromUri(
        "content://com.android.externalstorage.documents/document/primary%3ADocuments%2FBook.epub",
      ),
    ).toBe("Book.epub");
    expect(fileNameFromUri("")).toBe("");
  });

  it("extracts extensions", () => {
    expect(extensionFromName("a.PDF")).toBe("pdf");
    expect(extensionFromName("no-extension")).toBe("");
    expect(extensionFromName(".hidden")).toBe("");
    expect(extensionFromName("trailing.")).toBe("");
  });
});
