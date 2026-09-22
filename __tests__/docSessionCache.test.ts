/**
 * docSessionCache.test.ts
 * Reopening the same file before it expires must not upload it again; an
 * edited file (new size / modification time) must; the cache must stay
 * bounded; and a document the server lost is re-uploaded exactly once — a
 * second DOC_NOT_FOUND is an error, never a loop.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockFiles = new Map<string, string>();
const mockInfo = new Map<string, { size: number; modificationTime: number }>();

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(async (path: string) => {
    const info = mockInfo.get(path);
    if (info) return { exists: true, ...info };
    return mockFiles.has(path) ? { exists: true, size: mockFiles.get(path)!.length } : { exists: false };
  }),
  makeDirectoryAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(async (path: string, text: string) => {
    mockFiles.set(path, text);
  }),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (!mockFiles.has(path)) throw new Error("missing");
    return mockFiles.get(path);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
  EncodingType: { UTF8: "utf8" },
}));

jest.mock("@/config/api", () => ({
  API_ENDPOINTS: {
    AI: {
      CHAT: "https://b.test/api/ai/chat",
      EXTRACT_PDF: "https://b.test/api/ai/extract-pdf",
      EXTRACT_DOCUMENT: "https://b.test/api/ai/extract-document",
    },
  },
  resilientFetch: jest.fn(),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import { resilientFetch } from "@/config/api";
import { AIError } from "@/services/ai/aiErrors";
import { withDocRecovery } from "@/services/ai/docRecovery";
import {
  __resetDocSessionCacheForTests,
  DOC_CACHE_MAX_ENTRIES,
  docCacheSize,
  ensureDocumentUploaded,
  getDocCacheEntry,
  getDocRefDocId,
  isDocCacheEntryFresh,
  putDocCacheEntry,
  type DocCacheEntry,
} from "@/services/ai/docSessionCache";

const mockFetch = resilientFetch as jest.Mock;

if (typeof (global as any).FormData === "undefined") {
  (global as any).FormData = class {
    append() {}
  };
}

function entry(overrides: Partial<DocCacheEntry> = {}): DocCacheEntry {
  return {
    docId: "doc-1",
    expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    locatorType: "page",
    retrievalMode: "hybrid",
    totalPages: 300,
    fileType: "pdf",
    cachedAt: Date.now(),
    ...overrides,
  };
}

let uploadCount = 0;
function mockExtractionResponse() {
  uploadCount++;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      success: true,
      docId: `doc-${uploadCount}`,
      filename: "report.pdf",
      totalPages: 300,
      chunkCount: 140,
      fullText: "[Page 1] Hello world",
      locatorType: "page",
      retrievalMode: "hybrid",
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
      persisted: true,
    }),
    text: async () => "",
  };
}

const DOC = { uri: "file:///docs/report.pdf", name: "report.pdf", mimeType: "application/pdf" };

beforeEach(async () => {
  __resetDocSessionCacheForTests();
  await AsyncStorage.clear();
  mockFiles.clear();
  mockInfo.clear();
  mockInfo.set(DOC.uri, { size: 1000, modificationTime: 111 });
  mockFetch.mockReset();
  uploadCount = 0;
  mockFetch.mockImplementation(async () => mockExtractionResponse());
});

describe("expiry", () => {
  it("treats an entry as expired 10 minutes before the server's expiresAt", () => {
    const now = Date.now();
    expect(isDocCacheEntryFresh(entry({ expiresAt: new Date(now + 11 * 60_000).toISOString() }), now)).toBe(true);
    expect(isDocCacheEntryFresh(entry({ expiresAt: new Date(now + 9 * 60_000).toISOString() }), now)).toBe(false);
    expect(isDocCacheEntryFresh(entry({ expiresAt: "not a date" }), now)).toBe(false);
  });

  it("removes an expired entry when it is read", async () => {
    await putDocCacheEntry("k", entry({ expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(await getDocCacheEntry("k")).toBeNull();
    expect(await docCacheSize()).toBe(0);
  });
});

describe("eviction", () => {
  it("keeps at most 200 entries and evicts the oldest", async () => {
    const base = Date.now() - 1_000_000;
    for (let i = 0; i <= DOC_CACHE_MAX_ENTRIES; i++) {
      await putDocCacheEntry(`key-${i}`, entry({ docId: `d${i}`, cachedAt: base + i }));
    }
    expect(await docCacheSize()).toBe(DOC_CACHE_MAX_ENTRIES);
    expect(await getDocCacheEntry("key-0")).toBeNull();
    expect((await getDocCacheEntry(`key-${DOC_CACHE_MAX_ENTRIES}`))?.docId).toBe(`d${DOC_CACHE_MAX_ENTRIES}`);
  });

  it("survives a restart (reloads from storage)", async () => {
    await putDocCacheEntry("persisted", entry({ docId: "keep-me" }));
    __resetDocSessionCacheForTests();
    expect((await getDocCacheEntry("persisted"))?.docId).toBe("keep-me");
  });
});

describe("ensureDocumentUploaded", () => {
  it("makes no upload when the same file is reopened before expiry", async () => {
    const first = await ensureDocumentUploaded({ ...DOC }, { needText: true });
    expect(first.fromCache).toBe(false);
    expect(first.text).toBe("[Page 1] Hello world");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const reopened = { ...DOC };
    const second = await ensureDocumentUploaded(reopened, { needText: true });
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe("[Page 1] Hello world");
    expect(getDocRefDocId(reopened)).toBe("doc-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("extracts again when the cached text file is missing", async () => {
    await ensureDocumentUploaded({ ...DOC }, { needText: true });
    mockFiles.clear();
    await ensureDocumentUploaded({ ...DOC }, { needText: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not need the text file when only the docId is wanted", async () => {
    await ensureDocumentUploaded({ ...DOC }, { needText: true });
    mockFiles.clear();
    const res = await ensureDocumentUploaded({ ...DOC }, { needText: false });
    expect(res.fromCache).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uploads again when the file changed (size or modification time)", async () => {
    await ensureDocumentUploaded({ ...DOC });
    mockInfo.set(DOC.uri, { size: 1000, modificationTime: 222 });
    await ensureDocumentUploaded({ ...DOC });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("sends ?includeFullText=0 when asked", async () => {
    await ensureDocumentUploaded({ ...DOC }, { includeFullText: false });
    expect(mockFetch.mock.calls[0][0]).toBe("https://b.test/api/ai/extract-pdf?includeFullText=0");
  });
});

describe("withDocRecovery", () => {
  const notFound = () => new AIError("DOC_NOT_FOUND", "Document not found or expired.", { status: 404 });

  it("re-uploads once after DOC_NOT_FOUND and then answers", async () => {
    const doc = { ...DOC };
    await ensureDocumentUploaded(doc);
    const reupload = jest.fn(async () => "doc-fresh");
    const onReloading = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce("the answer");

    await expect(withDocRecovery(doc, fn, { reupload, onReloading })).resolves.toBe("the answer");
    expect(fn).toHaveBeenNthCalledWith(1, "doc-1");
    expect(fn).toHaveBeenNthCalledWith(2, "doc-fresh");
    expect(reupload).toHaveBeenCalledTimes(1);
    expect(onReloading).toHaveBeenCalledTimes(1);
  });

  it("shows an error instead of looping on a second DOC_NOT_FOUND", async () => {
    const doc = { ...DOC };
    await ensureDocumentUploaded(doc);
    const reupload = jest.fn(async () => "doc-fresh");
    const fn = jest.fn().mockRejectedValue(notFound());

    await expect(withDocRecovery(doc, fn, { reupload, onReloading: () => {} })).rejects.toMatchObject({
      code: "DOC_NOT_FOUND",
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(reupload).toHaveBeenCalledTimes(1);
  });

  it("does not re-upload for other errors", async () => {
    const doc = { ...DOC };
    await ensureDocumentUploaded(doc);
    const reupload = jest.fn(async () => "x");
    const fn = jest.fn().mockRejectedValue(new AIError("RATE_LIMITED", "slow"));
    await expect(withDocRecovery(doc, fn, { reupload })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(reupload).not.toHaveBeenCalled();
  });

  it("forgets the stale cache entry before re-uploading", async () => {
    const doc = { ...DOC };
    await ensureDocumentUploaded(doc);
    const fn = jest.fn().mockRejectedValueOnce(notFound()).mockResolvedValueOnce("ok");
    await withDocRecovery(doc, fn, {
      reupload: async (d) => (await ensureDocumentUploaded(d, { force: true })).entry.docId,
      onReloading: () => {},
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("doc-2");
  });
});
