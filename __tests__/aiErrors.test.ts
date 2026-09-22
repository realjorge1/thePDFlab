/**
 * aiErrors.test.ts
 * Every AI failure becomes one AIError with a stable code, whichever error
 * body the backend sent (new top-level `code`, the task routes' nested
 * `error: { code, message }`, or plain text). Screens then react by code, so
 * the mapping and the shared presenter's wording are pinned here.
 */

import {
  AI_NO_PROVIDER_CODE,
  AIError,
  aiErrorFromResponseBody,
  isAIError,
  isRouteMissing,
  normalizeAIError,
  toAIError,
} from "@/services/ai/aiErrors";
import {
  CANT_REACH_MESSAGE,
  describeAIError,
  isPresentableAIError,
  TEMPORARILY_UNAVAILABLE_MESSAGE,
  UPDATE_APP_MESSAGE,
} from "@/services/ai/aiErrorPresenter";
import { isCancelError } from "@/services/activity/activityStore";
import { PremiumRequiredError } from "@/services/ai/premiumGuard";

describe("aiErrorFromResponseBody", () => {
  it("reads the contract-v2 body (string error + top-level code)", () => {
    const err = aiErrorFromResponseBody(
      429,
      JSON.stringify({
        success: false,
        code: "RATE_LIMITED",
        error: "Too many requests. Try again in 30 seconds.",
        retryAfterSec: 30,
        requestId: "req-1",
      }),
    );
    expect(err).toBeInstanceOf(AIError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSec).toBe(30);
    expect(err.requestId).toBe("req-1");
    expect(err.serverMessage).toBe("Too many requests. Try again in 30 seconds.");
    expect(err.message).toMatch(/^Backend AI error \(429\)/);
  });

  it("reads the task-route body (error: { code, message })", () => {
    const err = aiErrorFromResponseBody(
      500,
      JSON.stringify({ success: false, error: { code: "AI_BAD_OUTPUT", message: "Model output invalid" } }),
    );
    expect(err.code).toBe("BAD_OUTPUT");
    expect(err.serverMessage).toBe("Model output invalid");
  });

  it("falls back to the status for plain-text and HTML bodies", () => {
    expect(aiErrorFromResponseBody(503, "Service Unavailable").code).toBe("UNAVAILABLE");
    expect(aiErrorFromResponseBody(502, "<html>Bad gateway</html>").serverMessage).toBeUndefined();
    expect(aiErrorFromResponseBody(500, "boom").code).toBe("SERVER");
    expect(aiErrorFromResponseBody(400, "").code).toBe("SERVER");
  });

  it("maps 401 / 403 / 404 / 429 by status", () => {
    expect(aiErrorFromResponseBody(401, "").code).toBe("UNAUTHORIZED");
    expect(aiErrorFromResponseBody(403, "").code).toBe("PREMIUM_REQUIRED");
    expect(aiErrorFromResponseBody(404, "Cannot POST /api/ai/chat/stream").code).toBe("DOC_NOT_FOUND");
    expect(aiErrorFromResponseBody(429, "").code).toBe("RATE_LIMITED");
  });

  it("reads Retry-After from headers (seconds or HTTP date)", () => {
    const headers = new Map([["retry-after", "12"]]);
    const err = aiErrorFromResponseBody(429, "", {
      headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    });
    expect(err.retryAfterSec).toBe(12);
    const date = new Date(Date.now() + 5_000).toUTCString();
    const byDate = aiErrorFromResponseBody(429, "", { headers: { "Retry-After": date } });
    expect(byDate.retryAfterSec).toBeGreaterThanOrEqual(3);
    expect(byDate.retryAfterSec).toBeLessThanOrEqual(6);
  });

  it("tells a missing route from a missing document", () => {
    expect(isRouteMissing(aiErrorFromResponseBody(404, "Cannot POST /x"))).toBe(true);
    expect(
      isRouteMissing(aiErrorFromResponseBody(404, JSON.stringify({ code: "DOC_NOT_FOUND", error: "gone" }))),
    ).toBe(false);
    expect(isRouteMissing(aiErrorFromResponseBody(500, ""))).toBe(false);
  });
});

describe("toAIError / normalizeAIError", () => {
  it("reads a Response-like object", async () => {
    const err = await toAIError({
      status: 401,
      statusText: "Unauthorized",
      headers: { get: () => null },
      text: async () => JSON.stringify({ code: "UNAUTHORIZED", error: "Bad key" }),
    });
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);
  });

  it("maps PremiumRequiredError, cancels and timeouts", () => {
    expect(normalizeAIError(new PremiumRequiredError()).code).toBe("PREMIUM_REQUIRED");

    const aborted = new AbortController();
    aborted.abort();
    const abortErr = Object.assign(new Error("Aborted"), { name: "AbortError" });
    expect(normalizeAIError(abortErr, { signal: aborted.signal }).code).toBe("CANCELLED");
    expect(normalizeAIError(abortErr, { signal: new AbortController().signal }).code).toBe("TIMEOUT");
    expect(normalizeAIError(abortErr, { signal: null }).code).toBe("TIMEOUT");
    expect(normalizeAIError(abortErr).code).toBe("CANCELLED");
    expect(normalizeAIError(Object.assign(new Error("x"), { name: "CancelError" })).code).toBe("CANCELLED");
  });

  it("maps network failures", () => {
    expect(normalizeAIError(new TypeError("Network request failed")).code).toBe("NETWORK");
    expect(normalizeAIError(new Error("All backends are unavailable. Please try again shortly.")).code).toBe(
      "UNAVAILABLE",
    );
  });

  it("re-reads the legacy 'Backend AI error (status)' message", () => {
    const err = normalizeAIError(
      new Error('Backend AI error (429): {"code":"RATE_LIMITED","error":"slow","retryAfterSec":9}'),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSec).toBe(9);
  });

  it("passes AIErrors through and keeps them recognizable", () => {
    const original = new AIError("DOC_NOT_FOUND", "gone");
    expect(normalizeAIError(original)).toBe(original);
    expect(isAIError(original)).toBe(true);
    expect(isAIError(new Error("x"))).toBe(false);
  });

  it("counts an AIError CANCELLED as a cancel", () => {
    expect(isCancelError(new AIError("CANCELLED", "Cancelled"))).toBe(true);
    expect(isCancelError(new AIError("NETWORK", "offline"))).toBe(false);
  });
});

describe("describeAIError (shared presenter)", () => {
  it("opens the paywall for PREMIUM_REQUIRED and stays silent on cancel", () => {
    expect(describeAIError(new AIError("PREMIUM_REQUIRED", "x")).kind).toBe("paywall");
    expect(describeAIError(new AIError("CANCELLED", "x")).kind).toBe("silent");
  });

  it("uses the agreed wording", () => {
    const rate = describeAIError(new AIError("RATE_LIMITED", "x", { retryAfterSec: 30 }));
    expect(rate).toMatchObject({ kind: "message", message: "You're going a bit fast. Try again in 30 seconds." });
    expect(describeAIError(new AIError("UNAUTHORIZED", "x"))).toMatchObject({ message: UPDATE_APP_MESSAGE });
    for (const code of ["NETWORK", "UNAVAILABLE", "TIMEOUT"] as const) {
      expect(describeAIError(new AIError(code, "x"))).toMatchObject({
        kind: "message",
        message: CANT_REACH_MESSAGE,
        retryable: true,
      });
    }
    expect(
      describeAIError(new AIError("UNAVAILABLE", "x", { serverCode: AI_NO_PROVIDER_CODE })),
    ).toMatchObject({ message: TEMPORARILY_UNAVAILABLE_MESSAGE });
  });

  it("owns connectivity, auth, rate-limit and cancel errors only", () => {
    expect(isPresentableAIError(new TypeError("Network request failed"))).toBe(true);
    expect(isPresentableAIError(new AIError("SERVER", "x"))).toBe(false);
    expect(isPresentableAIError(new AIError("BAD_OUTPUT", "x"))).toBe(false);
  });
});
