// ============================================
// AI Capabilities (contract v2, C2)
// ---------------------------------------------
// GET /api/ai/status tells the app which v2 features this backend really has.
// Every new AI path asks canUse(FLAG, "capabilityKey"): the feature flag must be
// on AND the backend must report the capability `true`. Anything missing,
// malformed or unreachable means `false`, i.e. today's legacy behavior.
//
// Fetch policy (no warm-up, no keep-alive — the owner keeps servers warm):
//   • once per app session, on the first AI use;
//   • again on the next AI use after the app returns to the foreground having
//     last fetched ≥ 10 minutes earlier;
//   • again after any 404 from a v2 route (invalidateAICapabilities());
//   • a failed fetch may be retried on a later AI use, at most every 30 s.
// Never throws.
// ============================================

import { useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { API_ENDPOINTS, resilientFetch } from "@/config/api";

export type AICapabilityKey =
  | "docIdTasks"
  | "persistentDocs"
  | "citationsV2"
  | "streamChat"
  | "streamChatDocument"
  | "devilsAdvocate"
  | "narrativeArc"
  | "markdown"
  | "proofread";

export type AIAuthMode = "off" | "monitor" | "enforce";

export interface AICapabilities {
  apiVersion: number;
  docIdTasks: boolean;
  persistentDocs: boolean;
  citationsV2: boolean;
  streamChat: boolean;
  streamChatDocument: boolean;
  devilsAdvocate: boolean;
  narrativeArc: boolean;
  markdown: boolean;
  proofread: boolean;
  authMode: AIAuthMode;
}

export const DEFAULT_AI_CAPABILITIES: Readonly<AICapabilities> = Object.freeze({
  apiVersion: 1,
  docIdTasks: false,
  persistentDocs: false,
  citationsV2: false,
  streamChat: false,
  streamChatDocument: false,
  devilsAdvocate: false,
  narrativeArc: false,
  markdown: false,
  proofread: false,
  authMode: "off",
});

const BOOLEAN_KEYS: AICapabilityKey[] = [
  "docIdTasks",
  "persistentDocs",
  "citationsV2",
  "streamChat",
  "streamChatDocument",
  "devilsAdvocate",
  "narrativeArc",
  "markdown",
  "proofread",
];

export interface AIStatusSnapshot {
  /** /ai/status answered 2xx with a JSON body. */
  reachable: boolean;
  /**
   * Whether the backend has an LLM provider configured (legacy
   * `currentProvider`). null = unknown (unreachable or field absent).
   */
  providerConfigured: boolean | null;
  capabilities: AICapabilities;
  fetchedAt: number;
}

/** Pure parser for a /ai/status body. Missing or partial → all false. */
export function parseAIStatus(json: unknown): {
  capabilities: AICapabilities;
  providerConfigured: boolean | null;
} {
  const capabilities: AICapabilities = { ...DEFAULT_AI_CAPABILITIES };
  let providerConfigured: boolean | null = null;
  if (!json || typeof json !== "object") return { capabilities, providerConfigured };
  const body = json as Record<string, unknown>;

  if (typeof body.currentProvider === "string" && body.currentProvider.trim()) {
    providerConfigured = true;
  } else if (body.success === true && "currentProvider" in body) {
    providerConfigured = false;
  }

  if (typeof body.apiVersion === "number" && Number.isFinite(body.apiVersion)) {
    capabilities.apiVersion = body.apiVersion;
  }
  const caps = body.capabilities;
  if (caps && typeof caps === "object" && !Array.isArray(caps)) {
    const c = caps as Record<string, unknown>;
    for (const key of BOOLEAN_KEYS) capabilities[key] = c[key] === true;
    if (c.authMode === "off" || c.authMode === "monitor" || c.authMode === "enforce") {
      capabilities.authMode = c.authMode;
    }
  }
  return { capabilities, providerConfigured };
}

// ─── Module state ─────────────────────────────────────────────────────────────

const STATUS_TIMEOUT_MS = 5_000;
const FOREGROUND_REFRESH_MS = 10 * 60_000;
const FAILURE_RETRY_MS = 30_000;

let _snapshot: AIStatusSnapshot | null = null;
let _stale = false;
let _inflight: Promise<AIStatusSnapshot> | null = null;
let _appStateSub: { remove(): void } | null = null;
const _listeners = new Set<() => void>();

function notify(): void {
  for (const l of Array.from(_listeners)) {
    try {
      l();
    } catch {
      // listeners must not break the store
    }
  }
}

function onAppStateChange(state: AppStateStatus): void {
  if (state !== "active" || !_snapshot) return;
  if (Date.now() - _snapshot.fetchedAt >= FOREGROUND_REFRESH_MS) _stale = true;
}

function ensureAppStateListener(): void {
  if (_appStateSub) return;
  try {
    _appStateSub = AppState.addEventListener("change", onAppStateChange);
  } catch {
    _appStateSub = { remove() {} };
  }
}

function needsFetch(): boolean {
  if (!_snapshot) return true;
  if (_stale) return true;
  const degraded = !_snapshot.reachable || _snapshot.providerConfigured === false;
  return degraded && Date.now() - _snapshot.fetchedAt >= FAILURE_RETRY_MS;
}

function statusUrl(): string {
  return API_ENDPOINTS.AI.CHAT.replace(/\/chat$/, "/status");
}

function unreachable(): AIStatusSnapshot {
  return {
    reachable: false,
    providerConfigured: null,
    capabilities: { ...DEFAULT_AI_CAPABILITIES },
    fetchedAt: Date.now(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch (or reuse) the /ai/status snapshot. Never throws. */
export async function getAIStatus(opts: { force?: boolean } = {}): Promise<AIStatusSnapshot> {
  ensureAppStateListener();
  if (!opts.force && !needsFetch() && _snapshot) return _snapshot;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    let next: AIStatusSnapshot;
    try {
      const res = await resilientFetch(statusUrl(), { method: "GET" }, { timeoutMs: STATUS_TIMEOUT_MS });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        next =
          json && typeof json === "object"
            ? { reachable: true, ...parseAIStatus(json), fetchedAt: Date.now() }
            : unreachable();
      } else {
        next = unreachable();
      }
    } catch {
      next = unreachable();
    }
    _snapshot = next;
    _stale = false;
    notify();
    return next;
  })();

  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** The backend's capabilities (all false on any failure). Never throws. */
export async function getAICapabilities(opts: { force?: boolean } = {}): Promise<AICapabilities> {
  return (await getAIStatus(opts)).capabilities;
}

/** Last known capabilities without any network (all false before the first fetch). */
export function getCachedAICapabilities(): AICapabilities {
  return _snapshot?.capabilities ?? (DEFAULT_AI_CAPABILITIES as AICapabilities);
}

/** Last known status snapshot, or null before the first fetch. */
export function getCachedAIStatus(): AIStatusSnapshot | null {
  return _snapshot;
}

/**
 * Synchronous gate for a new AI path: the feature flag is on AND the backend
 * reported the capability. Uses the cached snapshot — call (and await)
 * getAICapabilities() / canUseAsync() first when freshness matters.
 */
export function canUse(flag: boolean, capabilityKey: AICapabilityKey): boolean {
  return flag === true && getCachedAICapabilities()[capabilityKey] === true;
}

/** Like canUse, but refreshes the snapshot first when the flag is on. */
export async function canUseAsync(flag: boolean, capabilityKey: AICapabilityKey): Promise<boolean> {
  if (flag !== true) return false;
  const caps = await getAICapabilities();
  return caps[capabilityKey] === true;
}

/** Mark the snapshot stale (e.g. after a 404 from a v2 route). */
export function invalidateAICapabilities(): void {
  _stale = true;
}

export function subscribeAICapabilities(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** React hook: re-renders when the capability snapshot changes. */
export function useAICapabilities(): AICapabilities {
  return useSyncExternalStore(
    subscribeAICapabilities,
    getCachedAICapabilities,
    getCachedAICapabilities,
  );
}

/** Test-only: reset module state. */
export function __resetAICapabilitiesForTests(): void {
  _snapshot = null;
  _stale = false;
  _inflight = null;
  _listeners.clear();
  if (_appStateSub) {
    try {
      _appStateSub.remove();
    } catch {
      // ignore
    }
  }
  _appStateSub = null;
}
