/**
 * proofreadRequest.test.ts
 *
 * Two things:
 *   1. With the flag OFF, or the backend capability OFF, NO request is ever
 *      sent. Not a request that fails, not a request that is discarded — no
 *      request at all. (The local pass must still run.)
 *   2. With both on, the bodies match P2 exactly, including the app doing its
 *      own splitting at the 20-block / 20,000-char / 4,000-char limits. The
 *      app never relies on server-side splitting.
 */

jest.mock("@/config/api", () => ({
  API_ENDPOINTS: { AI: { PROOFREAD: "https://b.test/api/ai/proofread" } },
  resilientFetch: jest.fn(),
}));

let mockFlag = false;
jest.mock("@/constants/featureFlags", () => ({
  get AI_PROOFREAD() {
    return mockFlag;
  },
}));

let mockCapability = false;
jest.mock("@/services/ai/capabilities", () => ({
  canUse: jest.fn((flag: boolean) => flag === true && mockCapability === true),
}));

let mockPremium = true;
jest.mock("@/services/ai/premiumGuard", () => ({
  assertAIPremium: jest.fn(() => {
    if (!mockPremium) {
      const e = new Error("Premium required");
      e.name = "PremiumRequiredError";
      throw e;
    }
  }),
}));

import { resilientFetch } from "@/config/api";
import {
  chunkBlocks,
  clearProofreadCache,
  proofreadBlocks,
  proofreadCacheSize,
  PROOFREAD_TIMEOUT_MS,
  splitOversizeBlock,
  buildRequestBody,
} from "@/services/ai/proofread.service";
import { LIMITS } from "@/utils/proofreadTypes";

const fetchMock = resilientFetch as jest.MockedFunction<typeof resilientFetch>;

function okResponse(blocks: { id: string; suggestions?: unknown[] }[]) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => ({
      success: true,
      task: "proofread",
      data: { blocks: blocks.map((b) => ({ id: b.id, language: "en", suggestions: b.suggestions ?? [] })) },
    }),
    text: async () => "",
  } as unknown as Response;
}

/** Bodies of every request made so far. */
function sentBodies(): any[] {
  return fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
}

beforeEach(() => {
  fetchMock.mockReset();
  clearProofreadCache();
  mockFlag = false;
  mockCapability = false;
  mockPremium = true;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("no request is sent when the feature is off", () => {
  const blocks = [{ id: "b1", text: "recieve this  text. it is wrong." }];

  it("sends nothing when the flag is off and the capability is on", async () => {
    mockFlag = false;
    mockCapability = true;
    const out = await proofreadBlocks(blocks);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.usedRemote).toBe(false);
  });

  it("sends nothing when the flag is on but the backend lacks the capability", async () => {
    mockFlag = true;
    mockCapability = false;
    const out = await proofreadBlocks(blocks);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.usedRemote).toBe(false);
  });

  it("sends nothing when both are off", async () => {
    const out = await proofreadBlocks(blocks);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.usedRemote).toBe(false);
  });

  it("still returns local suggestions with the feature off", async () => {
    const out = await proofreadBlocks(blocks);
    expect(fetchMock).not.toHaveBeenCalled();
    // The local pass found the double space and the missing capital.
    expect(out.blocks[0].suggestions.length).toBeGreaterThan(0);
    expect(out.blocks[0].suggestions.every((s) => s.source === "local")).toBe(true);
  });

  it("sends nothing for a free user, and reports PREMIUM_REQUIRED", async () => {
    mockFlag = true;
    mockCapability = true;
    mockPremium = false;
    const out = await proofreadBlocks(blocks);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.error?.code).toBe("PREMIUM_REQUIRED");
    // The local pass is not an AI feature and is unaffected by the gate.
    expect(out.blocks[0].suggestions.length).toBeGreaterThan(0);
  });

  it("sends nothing for empty or whitespace-only blocks", async () => {
    mockFlag = true;
    mockCapability = true;
    await proofreadBlocks([
      { id: "a", text: "" },
      { id: "b", text: "   \n  " },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the request body matches P2", () => {
  beforeEach(() => {
    mockFlag = true;
    mockCapability = true;
  });

  it("sends exactly the documented shape", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    await proofreadBlocks([
      { id: "b1", text: "The data shows that recieve rates are up." },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://b.test/api/ai/proofread");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
    });

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      blocks: [{ id: "b1", text: "The data shows that recieve rates are up." }],
      language: "auto",
      dialect: null,
      goals: ["spelling", "grammar", "punctuation"],
    });
    expect(Object.keys(body).sort()).toEqual(["blocks", "dialect", "goals", "language"]);

    // P5.1: 20 s, never the 180 s document-task budget.
    expect((opts as { timeoutMs: number }).timeoutMs).toBe(20_000);
    expect(PROOFREAD_TIMEOUT_MS).toBe(20_000);
  });

  it("passes language, dialect and goals through", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    await proofreadBlocks([{ id: "b1", text: "colour or color" }], {
      language: "en-GB",
      dialect: "uk",
      goals: ["spelling", "clarity"],
    });
    const body = sentBodies()[0];
    expect(body.language).toBe("en-GB");
    expect(body.dialect).toBe("uk");
    expect(body.goals).toEqual(["spelling", "clarity"]);
  });

  it("falls back to the default goals for junk goal values", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    await proofreadBlocks([{ id: "b1", text: "some text here" }], {
      goals: ["nonsense" as never],
    });
    expect(sentBodies()[0].goals).toEqual(["spelling", "grammar", "punctuation"]);
  });

  it("truncates a block id to 64 characters", async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    await proofreadBlocks([{ id: "x".repeat(200), text: "some text here" }]);
    expect(sentBodies()[0].blocks[0].id).toHaveLength(64);
  });
});

describe("the app does its own splitting", () => {
  beforeEach(() => {
    mockFlag = true;
    mockCapability = true;
  });

  it("never sends more than 20 blocks in one request", async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const blocks = Array.from({ length: 47 }, (_, i) => ({
      id: `b${i}`,
      text: `Paragraph number ${i} with some words in it.`,
    }));
    await proofreadBlocks(blocks);

    const bodies = sentBodies();
    expect(bodies.length).toBe(3); // 20 + 20 + 7
    for (const body of bodies) {
      expect(body.blocks.length).toBeLessThanOrEqual(LIMITS.BLOCKS_PER_REQUEST);
    }
    expect(bodies.flatMap((b: any) => b.blocks).length).toBe(47);
  });

  it("never sends more than 20,000 characters in one request", async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    // 8 blocks of 3,500 chars = 28,000 total: under the block count, over chars.
    const blocks = Array.from({ length: 8 }, (_, i) => ({
      id: `b${i}`,
      text: "word ".repeat(700), // 3,500 chars
    }));
    await proofreadBlocks(blocks);

    const bodies = sentBodies();
    expect(bodies.length).toBeGreaterThan(1);
    for (const body of bodies) {
      const chars = body.blocks.reduce((n: number, b: any) => n + b.text.length, 0);
      expect(chars).toBeLessThanOrEqual(LIMITS.TOTAL_CHARS_PER_REQUEST);
    }
  });

  it("never sends a block over 4,000 characters", async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    const long = "This is a sentence. ".repeat(600); // 12,000 chars
    await proofreadBlocks([{ id: "big", text: long }]);

    const allBlocks = sentBodies().flatMap((b: any) => b.blocks);
    expect(allBlocks.length).toBeGreaterThan(1);
    for (const b of allBlocks) {
      expect(b.text.length).toBeLessThanOrEqual(LIMITS.BLOCK_TEXT_MAX);
    }
  });

  it("splits a long block at a sentence boundary, losing no text", () => {
    const long = "This is a sentence. ".repeat(600);
    const parts = splitOversizeBlock({ id: "big", text: long });

    expect(parts.length).toBeGreaterThan(1);
    // Nothing is lost or duplicated.
    expect(parts.map((p) => p.text).join("")).toBe(long);
    // Ids are traceable back to the parent.
    expect(parts.every((p) => p.id.startsWith("big#"))).toBe(true);
    // Every part but the last ends at a sentence boundary.
    for (const part of parts.slice(0, -1)) {
      expect(part.text.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("leaves a block under the limit untouched", () => {
    expect(splitOversizeBlock({ id: "b", text: "short" })).toEqual([
      { id: "b", text: "short" },
    ]);
  });

  it("splits a long block with no sentence boundary at all", () => {
    const long = "x".repeat(9000);
    const parts = splitOversizeBlock({ id: "b", text: long });
    expect(parts.map((p) => p.text).join("")).toBe(long);
    for (const p of parts) expect(p.text.length).toBeLessThanOrEqual(LIMITS.BLOCK_TEXT_MAX);
  });

  it("chunkBlocks respects both limits together", () => {
    const blocks = [
      { id: "a", text: "x".repeat(15_000) },
      { id: "b", text: "x".repeat(9_000) },
      { id: "c", text: "x".repeat(1_000) },
    ];
    const chunks = chunkBlocks(blocks);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMITS.BLOCKS_PER_REQUEST);
      const chars = chunk.reduce((n, b) => n + b.text.length, 0);
      // A single oversize block still goes alone rather than being dropped.
      if (chunk.length > 1) expect(chars).toBeLessThanOrEqual(LIMITS.TOTAL_CHARS_PER_REQUEST);
    }
    expect(chunks.flat().map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("stitches split-part results back onto the parent block", async () => {
    const long = "This is a sentence. ".repeat(600);
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return okResponse(
        body.blocks.map((b: { id: string; text: string }) => ({
          id: b.id,
          suggestions: [
            { original: "This is", replacement: "This was", occurrence: 1, reason: "r", confidence: 0.9 },
          ],
        })),
      );
    });

    const out = await proofreadBlocks([{ id: "big", text: long }]);
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0].id).toBe("big");
    expect(out.blocks[0].suggestions.some((s) => s.source === "remote")).toBe(true);
  });
});

describe("the content cache", () => {
  beforeEach(() => {
    mockFlag = true;
    mockCapability = true;
  });

  it("does not re-request an unchanged paragraph", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    const blocks = [{ id: "b1", text: "The data shows that rates are up." }];

    await proofreadBlocks(blocks);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await proofreadBlocks(blocks);
    await proofreadBlocks(blocks);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-requests when the text changes", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    await proofreadBlocks([{ id: "b1", text: "First version of the text." }]);
    await proofreadBlocks([{ id: "b1", text: "Second version of the text." }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats whitespace-only differences as the same content", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    await proofreadBlocks([{ id: "b1", text: "Some text here." }]);
    await proofreadBlocks([{ id: "b1", text: "Some text here.\n" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-requests when the options change", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    const blocks = [{ id: "b1", text: "Some text here." }];
    await proofreadBlocks(blocks, { dialect: "us" });
    await proofreadBlocks(blocks, { dialect: "uk" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bypasses the cache when asked (an explicit Check document)", async () => {
    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    const blocks = [{ id: "b1", text: "Some text here." }];
    await proofreadBlocks(blocks);
    await proofreadBlocks(blocks, { noCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stays bounded at about 200 entries", async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    for (let i = 0; i < 260; i++) {
      await proofreadBlocks([{ id: "b", text: `Paragraph variant number ${i} here.` }]);
    }
    expect(proofreadCacheSize()).toBeLessThanOrEqual(200);
  });

  it("does not cache a failed answer", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    const blocks = [{ id: "b1", text: "Some text here." }];
    await proofreadBlocks(blocks);
    expect(proofreadCacheSize()).toBe(0);

    fetchMock.mockResolvedValue(okResponse([{ id: "b1" }]));
    await proofreadBlocks(blocks);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("failures stay silent and keep the local pass working", () => {
  beforeEach(() => {
    mockFlag = true;
    mockCapability = true;
  });

  it("returns local suggestions and a typed error on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    const out = await proofreadBlocks([{ id: "b1", text: "this  is wrong. it is." }]);

    expect(out.usedRemote).toBe(false);
    expect(out.error?.code).toBe("NETWORK");
    // Airplane mode: the local pass still marks the double space.
    expect(out.blocks[0].suggestions.length).toBeGreaterThan(0);
    expect(out.blocks[0].suggestions.every((s) => s.source === "local")).toBe(true);
  });

  it("maps a 429 to RATE_LIMITED with retryAfterSec", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? "30" : null) },
      text: async () =>
        JSON.stringify({ success: false, code: "RATE_LIMITED", error: "slow down", retryAfterSec: 30 }),
      json: async () => ({}),
    } as unknown as Response);

    const out = await proofreadBlocks([{ id: "b1", text: "Some text here." }]);
    expect(out.error?.code).toBe("RATE_LIMITED");
    expect(out.error?.retryAfterSec).toBe(30);
  });

  it("maps a 500 AI_BAD_OUTPUT to BAD_OUTPUT", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      headers: { get: () => null },
      text: async () => JSON.stringify({ success: false, code: "AI_BAD_OUTPUT", error: "bad" }),
      json: async () => ({}),
    } as unknown as Response);

    const out = await proofreadBlocks([{ id: "b1", text: "Some text here." }]);
    expect(out.error?.code).toBe("BAD_OUTPUT");
    expect(out.blocks).toHaveLength(1);
  });

  it("never throws, whatever the response is", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("not json");
      },
      text: async () => "garbage",
    } as unknown as Response);

    await expect(
      proofreadBlocks([{ id: "b1", text: "Some text here." }]),
    ).resolves.toBeDefined();
  });
});

describe("buildRequestBody", () => {
  it("is a pure function over its inputs", () => {
    expect(buildRequestBody([{ id: "a", text: "t" }], {})).toEqual({
      blocks: [{ id: "a", text: "t" }],
      language: "auto",
      dialect: null,
      goals: ["spelling", "grammar", "punctuation"],
    });
  });
});
