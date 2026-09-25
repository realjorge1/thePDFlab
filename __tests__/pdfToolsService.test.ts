/**
 * pdfToolsService.test.ts
 * - Regression for "Cannot read property 'split' of undefined" on Merge PDFs:
 *   the tool screen can hand processWithTool an undefined file name
 *   (expo-router drops nullish params). It must derive a name instead of
 *   throwing, and reject too-few-files before any request goes out.
 * - Watermark logo upload, multi-page image results, 4xx error wording and
 *   content:// uploads from the dedicated tool screens.
 * - Audit fixes: all images reach Images to PDF, cancel stops per-page
 *   downloads, non-PDF responses are never saved as .pdf, and watermark
 *   opacity stays within what pdf-lib accepts.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(async () => {}),
  writeAsStringAsync: jest.fn(),
  downloadAsync: jest.fn(async (_url: string, to: string) => ({ status: 200, uri: to })),
}));
jest.mock("@/services/fileIndexService", () => ({
  upsertFileRecord: jest.fn(async () => ({})),
}));
jest.mock("@/config/api", () => ({
  API_BASE_URL: "https://b.test/api",
  API_ENDPOINTS: {
    PDF: { MERGE: "https://b.test/api/pdf/merge" },
    CONVERT: {},
  },
  resilientFetch: jest.fn(),
}));

import { resilientFetch } from "@/config/api";
import { upsertFileRecord } from "@/services/fileIndexService";
import {
  deleteTempUploads,
  processWithTool,
  resolveFileName,
  toUploadPart,
} from "@/services/pdfToolsService";
import * as FileSystem from "expo-file-system/legacy";

const mockFetch = resilientFetch as jest.Mock;

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => "application/json" },
  json: async () => body,
});

/** A 200 with a binary body, as the PDF routes send. */
const binaryResponse = (body: string, contentType = "application/pdf") => ({
  ok: true,
  status: 200,
  headers: { get: () => contentType },
  blob: async () => ({
    arrayBuffer: async () =>
      Uint8Array.from(body, (c) => c.charCodeAt(0)).buffer,
  }),
});

/** The string fields appended to the request's FormData, in order. */
const textFields = (): [string, string][] =>
  appendSpy.mock.calls
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => [k, v]);

// The test env's FormData stringifies RN-style { uri, name } parts, so read
// them off append() instead of the built body.
let appendSpy: jest.SpyInstance;

/** The file parts appended to the request's FormData. */
const uploadedParts = (): { field: string; name: string; uri: string }[] =>
  appendSpy.mock.calls
    .filter(([, v]) => v && typeof v === "object")
    .map(([field, v]) => ({ field, name: v.name, uri: v.uri }));

afterEach(() => appendSpy.mockRestore());

beforeEach(() => {
  jest.clearAllMocks();
  appendSpy = jest.spyOn(FormData.prototype, "append");
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ success: true, outputUri: "file:///docs/merged.pdf" }),
  });
});

describe("processWithTool — merge", () => {
  it("does not throw when the file name is missing", async () => {
    const result = await processWithTool({
      toolId: "merge",
      fileUri: "file:///cache/DocumentPicker/a1b2.pdf",
      fileName: undefined as unknown as string,
      fileMimeType: "application/pdf",
      additionalFiles: [
        {
          uri: "file:///cache/DocumentPicker/c3d4.pdf",
          name: undefined as unknown as string,
          mimeType: "application/pdf",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(uploadedParts()).toEqual([
      { field: "pdfs", name: "a1b2.pdf", uri: "file:///cache/DocumentPicker/a1b2.pdf" },
      { field: "pdfs", name: "c3d4.pdf", uri: "file:///cache/DocumentPicker/c3d4.pdf" },
    ]);
  });

  it("rejects a single file before calling the backend", async () => {
    const result = await processWithTool({
      toolId: "merge",
      fileUri: "file:///cache/a.pdf",
      fileName: "a.pdf",
      fileMimeType: "application/pdf",
    });

    expect(result).toEqual({
      success: false,
      error: "Please select at least 2 PDF files to merge.",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a missing input file before calling the backend", async () => {
    const result = await processWithTool({
      toolId: "merge",
      fileUri: undefined as unknown as string,
      fileName: undefined as unknown as string,
      fileMimeType: "application/pdf",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No file was selected/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("resolveFileName", () => {
  it("keeps a real name, minus any SAF directory prefix", () => {
    expect(resolveFileName("documents/report.pdf", "file:///x.pdf")).toBe("report.pdf");
  });

  it("falls back to the URI's file name", () => {
    expect(
      resolveFileName(
        undefined,
        "content://com.android.externalstorage.documents/tree/primary%3ADocs/document/primary%3ADocs%2Freport.pdf",
      ),
    ).toBe("report.pdf");
  });

  it("uses the fallback when the URI has no file name", () => {
    expect(
      resolveFileName(
        "",
        "content://com.android.providers.downloads.documents/document/msf%3A1234",
        "document.docx",
      ),
    ).toBe("document.docx");
  });
});

describe("processWithTool — watermark logo", () => {
  it("uploads the logo as its own field, after the PDF", async () => {
    await processWithTool({
      toolId: "watermark",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
      params: {
        opacity: 0.3,
        logoUri: "file:///cache/logo.png",
        logoPosition: "top-right",
      },
    });

    expect(uploadedParts()).toEqual([
      { field: "file", name: "doc.pdf", uri: "file:///cache/doc.pdf" },
      { field: "logo", name: "logo.png", uri: "file:///cache/logo.png" },
    ]);
    expect(textFields().map(([k]) => k)).toEqual(["opacity", "logoPosition"]);
  });

  it.each([
    [1.5, "1"],
    [-0.2, "0.01"],
    [0.4, "0.4"],
  ])("sends opacity %p as %p", async (opacity, sent) => {
    await processWithTool({
      toolId: "watermark",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
      params: { text: "DRAFT", opacity },
    });
    expect(textFields()).toContainEqual(["opacity", sent]);
  });
});

describe("processWithTool — images to PDF", () => {
  it("uploads every picked image", async () => {
    mockFetch.mockResolvedValue(binaryResponse("%PDF-1.7\n%%EOF"));
    await processWithTool({
      toolId: "jpg-to-pdf",
      fileUri: "file:///cache/1.jpg",
      fileName: "1.jpg",
      fileMimeType: "image/jpeg",
      additionalFiles: [
        { uri: "file:///cache/2.jpg", name: "2.jpg", mimeType: "image/jpeg" },
        { uri: "file:///cache/3.png", name: "3.png", mimeType: "image/png" },
      ],
    });
    expect(uploadedParts().map((p) => [p.field, p.name])).toEqual([
      ["images", "1.jpg"],
      ["images", "2.jpg"],
      ["images", "3.png"],
    ]);
  });
});

describe("processWithTool — PDF to images", () => {
  it("saves every page the backend returns, as images", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        totalPages: 3,
        files: [1, 2, 3].map((n) => ({
          filename: `doc_page_${n}.png`,
          url: `https://b.test/outputs/${n}.png`,
        })),
      }),
    );

    const result = await processWithTool({
      toolId: "pdf-to-png",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
      params: { allPages: "true" },
    });

    expect(result.success).toBe(true);
    expect(result.outputType).toBe("image/png");
    expect(result.message).toMatch(/^Converted 3 pages to images\./);
    expect(FileSystem.downloadAsync).toHaveBeenCalledTimes(3);
    for (const [record] of (upsertFileRecord as jest.Mock).mock.calls.slice(-3)) {
      expect(record.extension).toBe("png");
    }
  });

  it("stops downloading pages once cancelled", async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        files: [1, 2, 3].map((n) => ({
          filename: `doc_page_${n}.png`,
          url: `https://b.test/outputs/${n}.png`,
        })),
      }),
    );
    // The user cancels while page 1 is downloading
    (FileSystem.downloadAsync as jest.Mock).mockImplementationOnce(
      async (_url: string, to: string) => {
        controller.abort();
        return { status: 200, uri: to };
      },
    );

    const result = await processWithTool({
      toolId: "pdf-to-png",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
      params: { allPages: "true" },
      signal: controller.signal,
    });

    expect(result).toEqual({ success: false, error: "Request was cancelled." });
    expect(FileSystem.downloadAsync).toHaveBeenCalledTimes(1);
  });
});

describe("processWithTool — binary results", () => {
  const compress = () =>
    processWithTool({
      toolId: "compress",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
    });

  it("saves a PDF response to the library", async () => {
    mockFetch.mockResolvedValue(binaryResponse("%PDF-1.7\n1 0 obj\n%%EOF"));
    const result = await compress();

    expect(result.success).toBe(true);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      result.outputUri,
      btoa("%PDF-1.7\n1 0 obj\n%%EOF"),
      { encoding: "base64" },
    );
  });

  it("refuses to save a non-PDF response as a PDF", async () => {
    mockFetch.mockResolvedValue(
      binaryResponse("<html><body>Sign in to Wi-Fi</body></html>", "text/html"),
    );
    const result = await compress();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid PDF/);
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(upsertFileRecord).not.toHaveBeenCalled();
  });
});

describe("processWithTool — backend errors", () => {
  it("shows the backend's explanation for a 4xx", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        {
          error: "Insufficient files",
          message: "Please upload at least 2 PDF files to merge",
        },
        400,
      ),
    );
    const result = await processWithTool({
      toolId: "compress",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
    });
    expect(result.error).toBe("Please upload at least 2 PDF files to merge");
  });

  it("keeps the short label for a 5xx (message is a raw exception)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(
        { error: "Failed to compress PDF", message: "TypeError: x is undefined" },
        500,
      ),
    );
    const result = await processWithTool({
      toolId: "compress",
      fileUri: "file:///cache/doc.pdf",
      fileName: "doc.pdf",
      fileMimeType: "application/pdf",
    });
    expect(result.error).toBe("Failed to compress PDF");
  });
});

describe("toUploadPart", () => {
  it("copies a content:// file to the cache and cleans it up", async () => {
    const tempPaths: string[] = [];
    const part = await toUploadPart(
      { uri: "content://docs/document/primary%3Aa.pdf", name: "a.pdf" },
      tempPaths,
    );

    expect(part.uri).toMatch(/^file:\/\/\/cache\/upload_.*\.pdf$/);
    expect(part).toMatchObject({ type: "application/pdf", name: "a.pdf" });
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: "content://docs/document/primary%3Aa.pdf",
      to: part.uri,
    });
    expect(tempPaths).toEqual([part.uri]);

    deleteTempUploads(tempPaths);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(part.uri, { idempotent: true });
  });

  it("drops a SAF folder prefix from the upload name", async () => {
    const part = await toUploadPart(
      { uri: "file:///cache/c.pdf", name: "documents/c.pdf" },
      [],
    );
    expect(part.name).toBe("c.pdf");
  });

  it("uploads file:// URIs as they are", async () => {
    const tempPaths: string[] = [];
    const part = await toUploadPart(
      { uri: "file:///cache/b.pdf", name: "b.pdf", mimeType: "application/pdf" },
      tempPaths,
    );
    expect(part.uri).toBe("file:///cache/b.pdf");
    expect(tempPaths).toEqual([]);
  });
});
