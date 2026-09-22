/**
 * aiRequestHeaders.test.ts
 * Contract v2 (C3): every request under /api/ai/ carries X-App-Key, X-User-Id,
 * X-Client-Version and X-Request-Id — JSON and multipart alike — so the backend
 * can identify the app and the subscriber. Non-AI routes stay untouched, and
 * the first AI request waits at most 2 seconds for the RevenueCat user ID.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.4.2", extra: {} } },
}));

import {
  __resetAIRequestHeadersForTests,
  getAIRequestHeaders,
  mergeHeaders,
  setAIUserId,
} from "@/services/ai/aiRequestHeaders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  __resetAIRequestHeadersForTests();
  process.env.EXPO_PUBLIC_AI_APP_KEY = "app-key-123";
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_AI_APP_KEY;
});

describe("getAIRequestHeaders", () => {
  it("returns the four C3 headers", async () => {
    setAIUserId("rc-user-1");
    const headers = await getAIRequestHeaders();
    expect(headers).toEqual({
      "X-App-Key": "app-key-123",
      "X-User-Id": "rc-user-1",
      "X-Client-Version": "1.4.2",
      "X-Request-Id": expect.stringMatching(UUID),
    });
  });

  it("uses a new request id for every request", async () => {
    setAIUserId("u");
    const a = await getAIRequestHeaders();
    const b = await getAIRequestHeaders();
    expect(a["X-Request-Id"]).not.toBe(b["X-Request-Id"]);
  });

  it("waits at most 2 seconds for the user id, then sends without it — once", async () => {
    jest.useFakeTimers();
    try {
      const pending = getAIRequestHeaders();
      jest.advanceTimersByTime(2_000);
      const first = await pending;
      expect(first["X-User-Id"]).toBeUndefined();
      expect(first["X-App-Key"]).toBe("app-key-123");
      // Later requests do not wait again (with fake timers they would hang).
      const second = await getAIRequestHeaders();
      expect(second["X-User-Id"]).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("goes out as soon as the user id arrives", async () => {
    const pending = getAIRequestHeaders();
    setAIUserId("late-user");
    expect((await pending)["X-User-Id"]).toBe("late-user");
  });

  it("omits the user id when it could not be resolved, and the app key when unset", async () => {
    setAIUserId(null);
    delete process.env.EXPO_PUBLIC_AI_APP_KEY;
    const headers = await getAIRequestHeaders();
    expect(headers["X-User-Id"]).toBeUndefined();
    expect(headers["X-App-Key"]).toBeUndefined();
    expect(headers["X-Client-Version"]).toBe("1.4.2");
  });
});

describe("mergeHeaders", () => {
  it("never overrides the caller's headers and never adds Content-Type", () => {
    const merged = mergeHeaders(
      { "content-type": "application/json", "X-Request-Id": "mine" },
      { "X-Request-Id": "theirs", "Content-Type": "text/plain", "X-App-Key": "k" },
    );
    expect(merged).toEqual({ "content-type": "application/json", "X-Request-Id": "mine", "X-App-Key": "k" });
  });
});

describe("callBackend and resilientFetch", () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    setAIUserId("rc-user-1");
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ success: true, response: "hi" }),
      text: async () => "",
    }));
    (global as any).fetch = fetchMock;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it("attaches the headers to /ai/* JSON calls made by callBackend", async () => {
    const { callBackend } = require("@/services/ai/providers/backend.provider");
    await callBackend("https://anything.example/api/ai/summarize", { text: "x" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/ai\/summarize$/);
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-App-Key": "app-key-123",
      "X-User-Id": "rc-user-1",
      "X-Client-Version": "1.4.2",
    });
    expect(init.headers["X-Request-Id"]).toMatch(UUID);
  });

  it("attaches them to multipart uploads without a Content-Type", async () => {
    const { resilientFetch } = require("@/config/api");
    const body = typeof FormData !== "undefined" ? new FormData() : undefined;
    await resilientFetch("https://x.example/api/ai/extract-pdf", { method: "POST", body });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
    expect(headers["X-Request-Id"]).toMatch(UUID);
    expect(headers["X-User-Id"]).toBe("rc-user-1");
  });

  it("leaves non-AI routes untouched", async () => {
    const { resilientFetch } = require("@/config/api");
    await resilientFetch("https://x.example/api/pdf/merge", { method: "POST" });
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
  });

  it("throws a typed error that keeps the legacy message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? "7" : null) },
      text: async () => JSON.stringify({ success: false, code: "RATE_LIMITED", error: "slow down" }),
    });
    const { callBackend } = require("@/services/ai/providers/backend.provider");
    const err = await callBackend("https://x.example/api/ai/chat", { message: "hi" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "AIError", code: "RATE_LIMITED", retryAfterSec: 7 });
    expect((err as Error).message).toMatch(/^Backend AI error \(429\)/);
  });
});
