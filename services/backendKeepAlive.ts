/**
 * Backend Keep-Alive Service — DISABLED BY DESIGN.
 *
 * The app does NOT ping or warm the backend in the background. Keeping the
 * backend(s) warm is handled by a separate, external system; the app contacts a
 * backend ONLY when an actual user request needs it (and each such request
 * fails over across the backend pool — see resilientFetch in config/api).
 *
 * `initKeepAlive()` is retained as a no-op so any existing call site keeps
 * compiling without reintroducing background traffic.
 */
export function initKeepAlive(): void {
  // Intentionally a no-op — app-side warming was removed on request.
}
