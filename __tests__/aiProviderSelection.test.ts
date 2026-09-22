/**
 * aiProviderSelection.test.ts
 * Users who couldn't reach the server used to get invented "mock" answers
 * presented as real. Now the real backend is the only provider: an unreachable
 * server is a clear, retryable error, and demo answers exist only in a
 * development build started with EXPO_PUBLIC_AI_MOCK=true — always labelled.
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
jest.mock("@/config/api", () => ({
  API_ENDPOINTS: { AI: { CHAT: "https://b.test/api/ai/chat" } },
  resilientFetch: jest.fn(),
  resilientStream: jest.fn(),
  wakeUpBackend: jest.fn(),
}));

import { resilientFetch } from "@/config/api";
import { getAIProvider, sendChat, summarize } from "@/services/ai/ai.service";
import { CANT_REACH_MESSAGE, describeAIError } from "@/services/ai/aiErrorPresenter";
import { __resetAICapabilitiesForTests } from "@/services/ai/capabilities";
import { setAIPremiumAccess } from "@/services/ai/premiumGuard";
import { BackendAIProvider } from "@/services/ai/providers/backend.provider";
import { MockAIProvider } from "@/services/ai/providers/mock.provider";

const mockFetch = resilientFetch as jest.Mock;
const g = global as unknown as { __DEV__: boolean };
const originalDev = g.__DEV__;

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

beforeEach(() => {
  __resetAICapabilitiesForTests();
  setAIPremiumAccess(true);
  mockFetch.mockReset();
});

afterEach(() => {
  g.__DEV__ = originalDev;
  delete process.env.EXPO_PUBLIC_AI_MOCK;
});

describe("provider selection", () => {
  it("defaults to the real backend provider", () => {
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(BackendAIProvider);
    expect(provider).not.toBeInstanceOf(MockAIProvider);
  });

  it("shows a clear, retryable error when the backend is unreachable — never an invented answer", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));
    const chatError = await sendChat("hello", []).catch((e: unknown) => e);
    expect(chatError).toMatchObject({ name: "AIError", code: "NETWORK" });
    expect(describeAIError(chatError)).toMatchObject({ message: CANT_REACH_MESSAGE, retryable: true });
    await expect(summarize("some text")).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("says Gozlin is temporarily unavailable when the backend has no provider", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/ai/status") ? json({ success: true, currentProvider: null }) : json({ response: "never" }),
    );
    await expect(sendChat("hello", [])).rejects.toMatchObject({ code: "UNAVAILABLE", serverCode: "NO_PROVIDER" });
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the status probe
  });

  it("uses labelled demo answers only in development with EXPO_PUBLIC_AI_MOCK=true", async () => {
    g.__DEV__ = true;
    process.env.EXPO_PUBLIC_AI_MOCK = "true";
    await jest.isolateModulesAsync(async () => {
      require("@/services/ai/premiumGuard").setAIPremiumAccess(true);
      const service = require("@/services/ai/ai.service");
      const res = await service.sendChat("hello", []);
      expect(res.content.startsWith("[Demo response] ")).toBe(true);
    });
  });

  it("never uses demo answers in a release build", async () => {
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_AI_MOCK = "true";
    await jest.isolateModulesAsync(async () => {
      const { resilientFetch: isolatedFetch } = require("@/config/api");
      isolatedFetch.mockRejectedValue(new TypeError("Network request failed"));
      require("@/services/ai/premiumGuard").setAIPremiumAccess(true);
      const service = require("@/services/ai/ai.service");
      await expect(service.sendChat("hello", [])).rejects.toMatchObject({ code: "NETWORK" });
    });
  });
});
