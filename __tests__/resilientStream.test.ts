/**
 * resilientStream.test.ts
 * Streaming must fail over to the backup server only BEFORE response headers
 * arrive. Once a stream has started, retrying elsewhere would duplicate the
 * answer, so a mid-stream failure is an error, never a failover. A caller
 * cancel must never fail over, and a silent stream must time out.
 */

import { TextDecoder, TextEncoder } from "util";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: "9.9.9",
      extra: { apiUrl: "https://primary.test/api", apiUrlBackups: ["https://backup.test/api"] },
    },
  },
}));

type Api = typeof import("@/config/api");
let api: Api;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface MockResponseOptions {
  status?: number;
  chunks?: string[];
  errorAfter?: Error;
  hang?: boolean;
  body?: string;
}

function mockResponse(opts: MockResponseOptions, signal?: AbortSignal) {
  const status = opts.status ?? 200;
  const chunks = (opts.chunks ?? []).map((c) => encoder.encode(c));
  let i = 0;
  let cancelled = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => opts.body ?? "",
    body: {
      getReader: () => ({
        read: () => {
          if (cancelled) return Promise.resolve({ done: true });
          if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
          if (opts.errorAfter) return Promise.reject(opts.errorAfter);
          if (opts.hang) {
            return new Promise<{ done: boolean }>((resolve, reject) => {
              signal?.addEventListener("abort", () =>
                reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
              );
              const poll = setInterval(() => {
                if (cancelled) {
                  clearInterval(poll);
                  resolve({ done: true });
                }
              }, 5);
            });
          }
          return Promise.resolve({ done: true });
        },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
  };
}

async function readAll(stream: Awaited<ReturnType<Api["resilientStream"]>>): Promise<string> {
  let out = "";
  await stream.read((chunk) => {
    out += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array);
  });
  return out;
}

const STREAM_URL = "https://ignored.example/api/ai/chat-document/stream";

beforeAll(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_API_URL_2;
  delete process.env.EXPO_PUBLIC_API_URL_3;
  api = require("@/config/api");
  // Resolve the user ID up front so no request waits for it.
  require("@/services/ai/aiRequestHeaders").setAIUserId("user-123");
});

let streamFetch: jest.Mock;

beforeEach(() => {
  api.setActiveBaseUrl("https://primary.test/api");
  streamFetch = jest.fn();
  api.__setStreamFetchForTests(streamFetch as any);
});

afterAll(() => {
  api.__setStreamFetchForTests(null);
});

describe("resilientStream", () => {
  it("fails over on a network error before headers arrive", async () => {
    streamFetch
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockImplementationOnce(async (_url: string, init: any) =>
        mockResponse({ chunks: ["event: done\n", 'data: {"answer":"ok"}\n\n'] }, init.signal),
      );

    const stream = await api.resilientStream(STREAM_URL, { method: "POST", body: "{}" });
    expect(await readAll(stream)).toBe('event: done\ndata: {"answer":"ok"}\n\n');
    expect(streamFetch).toHaveBeenCalledTimes(2);
    expect(streamFetch.mock.calls[0][0]).toBe("https://primary.test/api/ai/chat-document/stream");
    expect(streamFetch.mock.calls[1][0]).toBe("https://backup.test/api/ai/chat-document/stream");
    expect(api.getActiveBaseUrl()).toBe("https://backup.test/api");
  });

  it("fails over on a gateway status before the stream starts", async () => {
    streamFetch
      .mockImplementationOnce(async () => mockResponse({ status: 503, body: "Service Unavailable" }))
      .mockImplementationOnce(async (_u: string, init: any) => mockResponse({ chunks: ["data: x\n\n"] }, init.signal));
    const stream = await api.resilientStream(STREAM_URL, { method: "POST", body: "{}" });
    expect(await readAll(stream)).toBe("data: x\n\n");
    expect(streamFetch).toHaveBeenCalledTimes(2);
  });

  it("never fails over once the first byte has arrived", async () => {
    streamFetch.mockImplementation(async (_u: string, init: any) =>
      mockResponse({ chunks: ['event: delta\ndata: {"text":"Hel"}\n\n'], errorAfter: new TypeError("Network request failed") }, init.signal),
    );
    const stream = await api.resilientStream(STREAM_URL, { method: "POST", body: "{}" });
    let received = "";
    await expect(
      stream.read((c) => {
        received += decoder.decode(c as Uint8Array);
      }),
    ).rejects.toMatchObject({ name: "AIError", code: "NETWORK" });
    expect(received).toContain("Hel");
    expect(streamFetch).toHaveBeenCalledTimes(1);
  });

  it("throws a non-2xx JSON error as an AIError without failing over", async () => {
    streamFetch.mockImplementation(async () =>
      mockResponse({
        status: 429,
        body: JSON.stringify({ success: false, code: "RATE_LIMITED", error: "slow", retryAfterSec: 5 }),
      }),
    );
    await expect(api.resilientStream(STREAM_URL, { method: "POST", body: "{}" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSec: 5,
    });
    expect(streamFetch).toHaveBeenCalledTimes(1);
  });

  it("does not fail over when the caller cancels before headers", async () => {
    const controller = new AbortController();
    streamFetch.mockImplementation(
      (_u: string, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
          );
        }),
    );
    const pending = api.resilientStream(STREAM_URL, { method: "POST", body: "{}", signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(streamFetch).toHaveBeenCalledTimes(1);
  });

  it("stops reading when the caller cancels mid-stream", async () => {
    const controller = new AbortController();
    streamFetch.mockImplementation(async (_u: string, init: any) =>
      mockResponse({ chunks: ["data: a\n\n"], hang: true }, init.signal),
    );
    const stream = await api.resilientStream(STREAM_URL, { method: "POST", body: "{}", signal: controller.signal });
    const reading = stream.read(() => {});
    setTimeout(() => controller.abort(), 10);
    await expect(reading).rejects.toMatchObject({ code: "CANCELLED" });
    expect(streamFetch).toHaveBeenCalledTimes(1);
  });

  it("aborts a stream that goes silent (idle timeout)", async () => {
    streamFetch.mockImplementation(async (_u: string, init: any) => mockResponse({ hang: true }, init.signal));
    const stream = await api.resilientStream(
      STREAM_URL,
      { method: "POST", body: "{}" },
      { idleTimeoutMs: 40 },
    );
    await expect(stream.read(() => {})).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("sends the AI request headers and asks for an event stream", async () => {
    streamFetch.mockImplementation(async (_u: string, init: any) => mockResponse({ chunks: [] }, init.signal));
    const stream = await api.resilientStream(STREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await readAll(stream);
    const headers = streamFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["X-Client-Version"]).toBe("9.9.9");
    expect(headers["X-User-Id"]).toBe("user-123");
    expect(headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
