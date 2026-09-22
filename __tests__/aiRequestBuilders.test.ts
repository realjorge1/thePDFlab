/**
 * aiRequestBuilders.test.ts
 * The kill-switch promise: with AI_DOCID_TASKS off — or on against a backend
 * without the `docIdTasks` capability — every request body is exactly what
 * the app sent before. With both on, document tasks send { docId, instruction }
 * instead of a 15,000-character slice, with the longer timeout.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  EncodingType: { UTF8: "utf8" },
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock("@/constants/featureFlags", () => ({
  GLOBAL_CONTAINER_HEADERS: true,
  EPUB_PAGINATED_MODE: false,
  AI_DOCID_TASKS: false,
  AI_PERSISTENT_DOC_CACHE: false,
  AI_CITATIONS_V2: false,
  AI_STREAMING: false,
  AI_MARKDOWN: false,
  AI_READER_PANEL: false,
}));
jest.mock("@/config/api", () => ({
  API_ENDPOINTS: {
    AI: {
      CHAT: "https://b.test/api/ai/chat",
      CHAT_DOCUMENT: "https://b.test/api/ai/chat-document",
      EXTRACT_PDF: "https://b.test/api/ai/extract-pdf",
      EXTRACT_DOCUMENT: "https://b.test/api/ai/extract-document",
    },
  },
  resilientFetch: jest.fn(),
  resilientStream: jest.fn(),
  wakeUpBackend: jest.fn(async () => true),
}));

import { resilientFetch } from "@/config/api";
import {
  analyze,
  explainText,
  generateQuiz,
  PASTED_TEXT_CUT_NOTICE,
  runDevilsAdvocate,
  sendChat,
  summarize,
  translate,
} from "@/services/ai/ai.service";
import type { AIDocumentRef } from "@/services/ai/ai.types";
import { __resetAICapabilitiesForTests } from "@/services/ai/capabilities";
import { setAIPremiumAccess } from "@/services/ai/premiumGuard";

const flags = require("@/constants/featureFlags") as Record<string, boolean>;
const mockFetch = resilientFetch as jest.Mock;

interface Call {
  path: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}

let calls: Call[] = [];
let statusBody: Record<string, unknown> = {};
let routeOverrides: Record<string, () => unknown> = {};

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: "",
  headers: { get: () => null },
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const LEGACY_STATUS = { success: true, currentProvider: "claude", availableProviders: ["claude"] };
const v2Status = (caps: Record<string, boolean>) => ({
  ...LEGACY_STATUS,
  apiVersion: 2,
  capabilities: { authMode: "monitor", ...caps },
});

function doc(id = "doc-1", name = "report.pdf"): AIDocumentRef {
  return {
    uri: `file:///docs/${name}`,
    name,
    mimeType: "application/pdf",
    _extractionDocId: id,
    _extractionMeta: { totalPages: 100, scannedPages: 0, chunkCount: 40 },
  } as AIDocumentRef;
}

const LONG = "x".repeat(20_000);
const LEGACY_CUT = LONG.slice(0, 15_000) + `\n\n[… text truncated at ${(15_000).toLocaleString()} characters]`;

beforeEach(() => {
  for (const key of Object.keys(flags)) if (key.startsWith("AI_")) flags[key] = false;
  __resetAICapabilitiesForTests();
  setAIPremiumAccess(true);
  calls = [];
  statusBody = LEGACY_STATUS;
  routeOverrides = {};
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init: any, opts: any) => {
    const path = url.replace("https://b.test/api", "");
    if (path === "/ai/status") return json(statusBody);
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : {}, timeoutMs: opts?.timeoutMs });
    if (routeOverrides[path]) return routeOverrides[path]();
    switch (path) {
      case "/ai/summarize":
        return json({ success: true, summary: "Summary", data: { text: "Summary" } });
      case "/ai/translate":
        return json({ success: true, translatedText: "Translated" });
      case "/ai/quiz":
        return json({ success: true, data: { text: "", json: { questions: [] } } });
      case "/ai/devils-advocate":
        return json({ success: true, data: { text: "Done", json: { killerObjections: [{ title: "Too risky" }] } } });
      case "/ai/chat":
        return json({ response: "**Bold** answer" });
      default:
        return json({ success: true, data: { text: "ok" } });
    }
  });
});

function lastCall(path: string): Call {
  const found = calls.filter((c) => c.path === path).pop();
  if (!found) throw new Error(`no call to ${path}`);
  return found;
}

describe("flag off → today's exact request bodies", () => {
  it("summarize cuts at 15,000 characters even when a docId exists", async () => {
    const res = await summarize(LONG, "report.pdf", undefined, { docRef: doc(), instruction: "focus", preserveMarkdown: true });
    expect(lastCall("/ai/summarize")).toEqual({ path: "/ai/summarize", body: { text: LEGACY_CUT }, timeoutMs: 60_000 });
    expect(res.notice).toBeUndefined();
  });

  it("translate, analyze and explain send text", async () => {
    await translate("hello", "fr");
    expect(lastCall("/ai/translate").body).toEqual({ text: "hello", targetLanguage: "fr" });
    await analyze("an essay", "full");
    expect(lastCall("/ai/analyze").body).toEqual({ text: "an essay", analysisType: "full" });
    await explainText("dense text", "simple", "short");
    expect(lastCall("/ai/explain").body).toEqual({ text: "dense text", mode: "simple", depth: "short" });
  });

  it("quiz keeps its legacy text + docId body", async () => {
    await generateQuiz("quiz text", "mcq", "quick", "easy", "report.pdf", undefined, doc());
    expect(lastCall("/ai/quiz").body).toEqual({
      text: "quiz text",
      questionType: "mcq",
      length: "quick",
      difficulty: "easy",
      weakTopics: [],
      docId: "doc-1",
    });
  });

  it("Devil's Advocate sends text and context text", async () => {
    await runDevilsAdvocate("doc text", "report.pdf", "investor", undefined, "ctx", "rfp.pdf", undefined, {
      docRef: doc(),
      contextDocRef: doc("ctx-9", "rfp.pdf"),
    });
    expect(lastCall("/ai/devils-advocate").body).toEqual({
      text: "doc text",
      documentName: "report.pdf",
      role: "investor",
      contextText: "ctx",
      contextName: "rfp.pdf",
    });
  });

  it("strips Markdown even when the caller asked to keep it", async () => {
    const res = await sendChat("hi", [], undefined, undefined, undefined, { preserveMarkdown: true });
    expect(res.content).toBe("Bold answer");
    expect(res.format).toBeUndefined();
  });
});

describe("flag on, capability off (older backend)", () => {
  beforeEach(() => {
    flags.AI_DOCID_TASKS = true;
    flags.AI_MARKDOWN = true;
    statusBody = LEGACY_STATUS;
  });

  it("keeps today's bodies and adds an honest note for a cut document", async () => {
    const res = await summarize(LONG, "report.pdf", undefined, { docRef: doc(), instruction: "focus" });
    expect(lastCall("/ai/summarize")).toEqual({ path: "/ai/summarize", body: { text: LEGACY_CUT }, timeoutMs: 60_000 });
    expect(res.notice).toBe("Gozlin read the first part of this document (about 75 pages).");
  });

  it("does not keep Markdown without the capability", async () => {
    const res = await sendChat("hi", [], undefined, undefined, undefined, { preserveMarkdown: true });
    expect(res.content).toBe("Bold answer");
  });
});

describe("flag and capability on", () => {
  beforeEach(() => {
    flags.AI_DOCID_TASKS = true;
    statusBody = v2Status({ docIdTasks: true });
  });

  it("summarize sends { docId, instruction } with the 180 s timeout", async () => {
    await summarize(LONG, "report.pdf", undefined, { docRef: doc(), instruction: "focus on the risks" });
    expect(lastCall("/ai/summarize")).toEqual({
      path: "/ai/summarize",
      body: { docId: "doc-1", instruction: "focus on the risks" },
      timeoutMs: 180_000,
    });
  });

  it("translate and quiz send the docId instead of text", async () => {
    await translate(LONG, "de", "report.pdf", undefined, { docRef: doc() });
    expect(lastCall("/ai/translate").body).toEqual({ docId: "doc-1", targetLanguage: "de" });
    await generateQuiz("quiz text", "mcq", "quick", "easy", "report.pdf", undefined, doc());
    expect(lastCall("/ai/quiz").body).toEqual({
      docId: "doc-1",
      questionType: "mcq",
      length: "quick",
      difficulty: "easy",
      weakTopics: [],
    });
  });

  it("caps pasted text at 90,000 characters with a visible note", async () => {
    const res = await summarize("y".repeat(95_000));
    expect((lastCall("/ai/summarize").body.text as string).length).toBe(90_000);
    expect(res.notice).toBe(PASTED_TEXT_CUT_NOTICE);
  });

  it("reports partial coverage", async () => {
    routeOverrides["/ai/summarize"] = () =>
      json({
        success: true,
        data: {
          text: "Summary",
          coverage: { totalChars: 1000, processedChars: 400, chunked: true, chunkCount: 3, truncated: true },
        },
      });
    const res = await summarize("", "report.pdf", undefined, { docRef: doc() });
    expect(res.coverage?.truncated).toBe(true);
    expect(res.notice).toBe("Gozlin covered about 40% of this document.");
  });

  it("keeps Markdown only with AI_MARKDOWN, the capability and the caller's opt-in", async () => {
    flags.AI_MARKDOWN = true;
    statusBody = v2Status({ docIdTasks: true, markdown: true });
    __resetAICapabilitiesForTests();
    const kept = await sendChat("hi", [], undefined, undefined, undefined, { preserveMarkdown: true });
    expect(kept.content).toBe("**Bold** answer");
    expect(kept.format).toBe("markdown");
    const stripped = await sendChat("hi", []);
    expect(stripped.content).toBe("Bold answer");
  });
});

describe("Devil's Advocate routing (W8)", () => {
  beforeEach(() => {
    flags.AI_DOCID_TASKS = true;
  });

  it("uses only the real route, with docId and contextDocId, when the capability is on", async () => {
    statusBody = v2Status({ docIdTasks: true, devilsAdvocate: true });
    const res = await runDevilsAdvocate("doc text", "report.pdf", "investor", undefined, "ctx", "rfp.pdf", undefined, {
      docRef: doc(),
      contextDocRef: doc("ctx-9", "rfp.pdf"),
    });
    expect(lastCall("/ai/devils-advocate")).toEqual({
      path: "/ai/devils-advocate",
      body: { docId: "doc-1", documentName: "report.pdf", role: "investor", contextName: "rfp.pdf", contextDocId: "ctx-9" },
      timeoutMs: 180_000,
    });
    // Normalized structured output.
    expect((res.structuredData as any).killerObjections[0]).toMatchObject({ title: "Too risky", severity: "critical" });
  });

  it("does not retry through /chat on a 404 when the capability is on", async () => {
    statusBody = v2Status({ docIdTasks: true, devilsAdvocate: true });
    routeOverrides["/ai/devils-advocate"] = () => json({ success: false, code: "DOC_NOT_FOUND", error: "gone" }, 404);
    const docRef = doc();
    (docRef as any).uri = ""; // no file to re-upload in this test
    await expect(
      runDevilsAdvocate("doc text", "report.pdf", "auto", undefined, undefined, undefined, undefined, { docRef }),
    ).rejects.toMatchObject({ code: "DOC_NOT_FOUND" });
    expect(calls.some((c) => c.path === "/ai/chat")).toBe(false);
  });

  it("keeps today's try-then-fall-back when the capability is off", async () => {
    statusBody = v2Status({ docIdTasks: true, devilsAdvocate: false });
    routeOverrides["/ai/devils-advocate"] = () => json("Cannot POST /api/ai/devils-advocate", 404);
    await runDevilsAdvocate("doc text", "report.pdf", "auto", undefined, undefined, undefined, undefined, {
      docRef: doc(),
    });
    expect(lastCall("/ai/devils-advocate").body).toEqual({ text: "doc text", documentName: "report.pdf", role: "auto" });
    expect(calls.some((c) => c.path === "/ai/chat")).toBe(true);
  });
});
