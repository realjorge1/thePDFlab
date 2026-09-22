/**
 * aiCapabilities.test.ts
 * Every new AI path is gated on /api/ai/status. Anything missing, partial,
 * malformed or unreachable must mean "false" — i.e. the legacy path — and the
 * status must be fetched once per session, not per request.
 */

jest.mock("@/config/api", () => ({
  API_ENDPOINTS: { AI: { CHAT: "https://backend.test/api/ai/chat" } },
  resilientFetch: jest.fn(),
}));

import { resilientFetch } from "@/config/api";
import {
  __resetAICapabilitiesForTests,
  canUse,
  canUseAsync,
  DEFAULT_AI_CAPABILITIES,
  getAICapabilities,
  getAIStatus,
  getCachedAICapabilities,
  invalidateAICapabilities,
  parseAIStatus,
} from "@/services/ai/capabilities";

const mockFetch = resilientFetch as jest.Mock;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const FULL_STATUS = {
  success: true,
  currentProvider: "claude",
  availableProviders: ["claude"],
  apiVersion: 2,
  capabilities: {
    docIdTasks: true,
    persistentDocs: true,
    citationsV2: true,
    streamChat: true,
    streamChatDocument: true,
    devilsAdvocate: true,
    narrativeArc: true,
    markdown: true,
    authMode: "monitor",
  },
};

beforeEach(() => {
  __resetAICapabilitiesForTests();
  mockFetch.mockReset();
});

describe("parseAIStatus", () => {
  it("treats a missing body as all false", () => {
    expect(parseAIStatus(undefined).capabilities).toEqual(DEFAULT_AI_CAPABILITIES);
    expect(parseAIStatus(null).capabilities).toEqual(DEFAULT_AI_CAPABILITIES);
    expect(parseAIStatus("ok").capabilities).toEqual(DEFAULT_AI_CAPABILITIES);
  });

  it("treats a legacy status (no capabilities) as all false", () => {
    const parsed = parseAIStatus({ success: true, currentProvider: "gemini", fallbackEnabled: true });
    expect(parsed.capabilities).toEqual(DEFAULT_AI_CAPABILITIES);
    expect(parsed.providerConfigured).toBe(true);
  });

  it("accepts only literal true for each capability", () => {
    const { capabilities } = parseAIStatus({
      capabilities: { docIdTasks: true, streamChat: "true", markdown: 1, citationsV2: null, authMode: "yes" },
    });
    expect(capabilities.docIdTasks).toBe(true);
    expect(capabilities.streamChat).toBe(false);
    expect(capabilities.markdown).toBe(false);
    expect(capabilities.citationsV2).toBe(false);
    expect(capabilities.persistentDocs).toBe(false);
    expect(capabilities.authMode).toBe("off");
  });

  it("reports a missing provider only when the backend says so", () => {
    expect(parseAIStatus({ success: true, currentProvider: null }).providerConfigured).toBe(false);
    expect(parseAIStatus({ success: true }).providerConfigured).toBeNull();
  });
});

describe("getAICapabilities / canUse", () => {
  it("is all false (legacy path) when the status request fails", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));
    await expect(getAICapabilities()).resolves.toEqual(DEFAULT_AI_CAPABILITIES);
    expect(canUse(true, "docIdTasks")).toBe(false);
    expect((await getAIStatus()).reachable).toBe(false);
  });

  it("is all false when the status is not OK", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "nope" }, 500));
    await expect(getAICapabilities()).resolves.toEqual(DEFAULT_AI_CAPABILITIES);
  });

  it("is all false for a partial status", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, currentProvider: "x", capabilities: { markdown: true } }));
    const caps = await getAICapabilities();
    expect(caps.markdown).toBe(true);
    expect(canUse(true, "markdown")).toBe(true);
    expect(canUse(true, "streamChat")).toBe(false);
    expect(canUse(true, "docIdTasks")).toBe(false);
  });

  it("requires the flag as well as the capability", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FULL_STATUS));
    await getAICapabilities();
    expect(canUse(true, "streamChatDocument")).toBe(true);
    expect(canUse(false, "streamChatDocument")).toBe(false);
  });

  it("fetches once per session and again after invalidation", async () => {
    mockFetch.mockResolvedValue(jsonResponse(FULL_STATUS));
    await getAICapabilities();
    await getAICapabilities();
    await Promise.all([getAICapabilities(), getAICapabilities()]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    invalidateAICapabilities();
    await getAICapabilities();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not touch the network when the flag is off", async () => {
    await expect(canUseAsync(false, "docIdTasks")).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(getCachedAICapabilities()).toEqual(DEFAULT_AI_CAPABILITIES);
  });

  it("never throws, even if the body is not JSON", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
    await expect(getAICapabilities()).resolves.toEqual(DEFAULT_AI_CAPABILITIES);
  });
});
