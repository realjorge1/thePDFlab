/**
 * premiumUnlock.test.ts
 * FORCE_PREMIUM_UNLOCK used to be a hard-coded `true`, which gave every user
 * free AI. It must now be impossible to ship: false in any release build
 * (__DEV__ false), whatever the environment says. jest-expo sets __DEV__ to
 * true, so each case sets it explicitly and loads the modules fresh.
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

const g = global as unknown as { __DEV__: boolean };
const originalDev = g.__DEV__;
const originalEnv = process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK;

afterEach(() => {
  g.__DEV__ = originalDev;
  if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK;
  else process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK = originalEnv;
});

function loadUnlock(): boolean {
  let value = true;
  jest.isolateModules(() => {
    value = require("@/config/revenuecat").FORCE_PREMIUM_UNLOCK;
  });
  return value;
}

describe("FORCE_PREMIUM_UNLOCK", () => {
  it("is false in a release build even when the env var is set", () => {
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK = "true";
    expect(loadUnlock()).toBe(false);
  });

  it("is false in development without the env var", () => {
    g.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK;
    expect(loadUnlock()).toBe(false);
  });

  it("is true only in development with EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK=true", () => {
    g.__DEV__ = true;
    process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK = "true";
    expect(loadUnlock()).toBe(true);
    process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK = "1";
    expect(loadUnlock()).toBe(false);
  });
});

describe("premium guard in a release build", () => {
  it("blocks a non-subscriber before any network request, and lets a subscriber through", async () => {
    g.__DEV__ = false;
    process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK = "true";

    await jest.isolateModulesAsync(async () => {
      const { resilientFetch } = require("@/config/api");
      const guard = require("@/services/ai/premiumGuard");
      const service = require("@/services/ai/ai.service");
      const { normalizeAIError } = require("@/services/ai/aiErrors");

      expect(guard.hasAIPremiumAccess()).toBe(false);

      const err = await service.summarize("some text").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(guard.PremiumRequiredError);
      expect(normalizeAIError(err).code).toBe("PREMIUM_REQUIRED");
      await expect(service.sendChat("hi", [])).rejects.toBeInstanceOf(guard.PremiumRequiredError);
      expect(resilientFetch).not.toHaveBeenCalled();

      // SubscriptionContext calls this when RevenueCat reports the entitlement.
      guard.setAIPremiumAccess(true);
      expect(guard.hasAIPremiumAccess()).toBe(true);
      expect(() => guard.assertAIPremium()).not.toThrow();

      guard.setAIPremiumAccess(false);
      expect(() => guard.assertAIPremium()).toThrow(guard.PremiumRequiredError);
    });
  });
});
