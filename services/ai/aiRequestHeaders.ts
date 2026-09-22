// ============================================
// AI Request Headers (contract v2, C3)
// ---------------------------------------------
// Every request under /api/ai/ carries:
//   X-App-Key         build-time EXPO_PUBLIC_AI_APP_KEY (public — ships in the binary)
//   X-User-Id         RevenueCat app user ID (omitted only if it can't be resolved)
//   X-Client-Version  app version, e.g. "1.0.0"
//   X-Request-Id      a new UUID per request
//
// config/api.ts attaches these inside resilientFetch / resilientStream for any
// /ai/* path, so no call site can forget them. This module must stay free of
// native SDK imports (it is imported by config/api.ts): SubscriptionContext
// pushes the RevenueCat ID in through setAIUserId().
// ============================================

import Constants from "expo-constants";

const USER_ID_WAIT_MS = 2_000;

let _userId: string | null = null;
let _userIdSettled = false;
let _firstWaitDone = false;
let _waiters: Array<(id: string | null) => void> = [];

/**
 * Record the RevenueCat app user ID (call once after Purchases.configure).
 * Pass null when it can't be resolved so waiting requests go out without it.
 */
export function setAIUserId(id: string | null | undefined): void {
  _userId = typeof id === "string" && id.trim() ? id.trim() : null;
  _userIdSettled = true;
  const waiters = _waiters;
  _waiters = [];
  for (const w of waiters) w(_userId);
}

export function getAIUserId(): string | null {
  return _userId;
}

/**
 * Resolve the user ID for a request. Only the first AI request waits (at most
 * 2 seconds); later requests use whatever is known by then.
 */
async function resolveUserId(maxWaitMs: number): Promise<string | null> {
  if (_userId || _userIdSettled || _firstWaitDone) return _userId;
  _firstWaitDone = true;
  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(id);
    };
    const timer = setTimeout(() => {
      _waiters = _waiters.filter((w) => w !== finish);
      finish(_userId);
    }, maxWaitMs);
    _waiters.push(finish);
  });
}

export function getAppVersion(): string {
  const v =
    (Constants.expoConfig as { version?: string } | null | undefined)?.version ??
    (Constants as unknown as { nativeAppVersion?: string | null }).nativeAppVersion;
  return typeof v === "string" && v ? v : "0.0.0";
}

export function getAIAppKey(): string {
  // Must be referenced literally so Expo inlines it at build time.
  const key = process.env.EXPO_PUBLIC_AI_APP_KEY;
  return typeof key === "string" ? key.trim() : "";
}

/** RFC 4122 v4 UUID. Uses Web Crypto when present (shim.js polyfills it). */
export function makeRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  try {
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    // fall through
  }
  const bytes = new Uint8Array(16);
  try {
    if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
    else throw new Error("no crypto");
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The C3 headers for one /ai/* request. Never throws. */
export async function getAIRequestHeaders(
  opts: { requestId?: string; maxUserIdWaitMs?: number } = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const appKey = getAIAppKey();
  if (appKey) headers["X-App-Key"] = appKey;
  let userId: string | null = null;
  try {
    userId = await resolveUserId(opts.maxUserIdWaitMs ?? USER_ID_WAIT_MS);
  } catch {
    userId = null;
  }
  if (userId) headers["X-User-Id"] = userId;
  headers["X-Client-Version"] = getAppVersion();
  headers["X-Request-Id"] = opts.requestId ?? makeRequestId();
  return headers;
}

/** True for API paths (after the base URL) that belong to the AI service. */
export function isAIApiPath(path: string): boolean {
  return /^\/ai(\/|$)/.test(path);
}

/**
 * Merge extra headers into a fetch `headers` value without overriding keys the
 * caller already set (case-insensitive). Never adds Content-Type, so FormData
 * uploads keep their generated multipart boundary.
 */
export function mergeHeaders(
  existing: HeadersInit | undefined,
  extra: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (existing) {
    if (typeof (existing as Headers).forEach === "function" && !Array.isArray(existing)) {
      (existing as Headers).forEach((value, key) => {
        out[key] = value;
      });
    } else if (Array.isArray(existing)) {
      for (const [k, v] of existing) out[k] = v;
    } else {
      Object.assign(out, existing as Record<string, string>);
    }
  }
  const present = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(extra)) {
    if (k.toLowerCase() === "content-type") continue;
    if (!present.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** Test-only: reset module state between tests. */
export function __resetAIRequestHeadersForTests(): void {
  _userId = null;
  _userIdSettled = false;
  _firstWaitDone = false;
  _waiters = [];
}
