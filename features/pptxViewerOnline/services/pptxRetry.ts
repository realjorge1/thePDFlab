// ============================================================================
// Retry helper with exponential backoff. Used by the PPTX render pipeline to
// recover from transient network / 5xx failures without hiding real errors.
// ============================================================================

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onAttempt?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const cap = opts.maxDelayMs ?? 8000;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      lastErr = e;
      if (attempt >= max || !shouldRetry(e)) throw e;
      opts.onAttempt?.(attempt, e);
      const delay = Math.min(cap, base * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error("Retry failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultShouldRetry(err: Error): boolean {
  const msg = err.message || "";
  // Network-ish errors
  if (/network|timed out|timeout|fetch failed|aborted/i.test(msg)) return true;
  // Server 5xx (our client throws with the status in the message)
  if (/\(5\d\d\)/.test(msg)) return true;
  return false;
}

export function isLikelyOffline(err: Error): boolean {
  const msg = err.message || "";
  return /network request failed|failed to fetch|network error|offline/i.test(
    msg,
  );
}
