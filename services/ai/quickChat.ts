// ============================================
// quickChat — lightweight one-shot backend chat
// ============================================
// Used by the SECONDARY intelligence services (semantic search, research
// assistant) that want an optional AI boost but must degrade gracefully.
//
// Contract: this function NEVER throws and NEVER blocks a feature.
//   • Returns null when the user lacks AI access (respects premiumGuard).
//   • Returns null on any network error, timeout, or non-OK response.
// Callers treat null as "AI unavailable" and fall back to fully-local logic,
// so existing flows can never break because of these add-on features.
// ============================================

import { API_ENDPOINTS } from "@/config/api";
import { stripMarkdown } from "@/utils/sanitizeAiText";
import { hasAIPremiumAccess } from "./premiumGuard";

export interface QuickChatOptions {
  signal?: AbortSignal;
  /** Per-call timeout. Kept short so add-on features stay snappy. */
  timeoutMs?: number;
}

/**
 * Send a single message to the backend chat endpoint and return the plain-text
 * reply, or null if AI is unavailable for any reason.
 */
export async function quickChat(
  message: string,
  opts: QuickChatOptions = {},
): Promise<string | null> {
  // Respect the global AI premium policy — never fire AI for a free user.
  if (!hasAIPremiumAccess()) return null;
  if (!message || !message.trim()) return null;

  const timeoutMs = opts.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(API_ENDPOINTS.AI.CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: [] }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const json = await res.json();
    const content: unknown = json?.response ?? json?.data?.text ?? "";
    if (typeof content !== "string" || !content.trim()) return null;
    return stripMarkdown(content);
  } catch {
    // Offline, cold backend, timeout, or aborted — caller falls back locally.
    return null;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Parse a model reply into a clean list of short items.
 * Accepts comma-, newline-, semicolon-, or bullet-separated text and drops
 * empty / overly long fragments (full sentences) that aren't useful terms.
 */
export function parseListReply(reply: string, maxItems = 12): string[] {
  if (!reply) return [];
  const parts = reply
    .split(/[\n,;•·\-–]+/)
    .map((s) =>
      s
        .replace(/^\s*\d+[.)]\s*/, "") // strip "1." / "2)" numbering
        .replace(/["'`*]/g, "")
        .trim(),
    )
    .filter((s) => s.length >= 2 && s.length <= 60);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= maxItems) break;
  }
  return out;
}
