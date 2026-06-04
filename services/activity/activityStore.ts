// ============================================
// Global Activity Store
// ---------------------------------------------
// One source of truth for "the app is doing something the user is waiting on".
// A single root-mounted <ActivityOverlay/> subscribes to this store and renders
// the spring pull-to-cancel UI. Any flow — AI, file creation, download, tool —
// registers a cancelable task via runCancelable() and gets the overlay + true
// abort for free, instead of wiring a bespoke spinner at every call site.
// ============================================

import { create } from "zustand";

export type ActivityKind = "ai" | "file" | "download" | "tool" | "generic";

export interface ActivityTask {
  id: string;
  /** Short human label, e.g. "Generating document". */
  label: string;
  kind: ActivityKind;
  startedAt: number;
  /** 0..1 for determinate work (e.g. downloads); undefined = indeterminate. */
  progress?: number;
  /** Whether the user may pull-to-cancel this task. */
  cancelable: boolean;
  /** Abort the underlying work and reject the runCancelable() promise. */
  abort: () => void;
}

/** Thrown into a caller's await when the user pulls to cancel. */
export class CancelError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "CancelError";
  }
}

/** True for our own cancellations and for fetch AbortError (aborted network). */
export function isCancelError(e: unknown): boolean {
  return (
    e instanceof CancelError ||
    (e instanceof Error && (e.name === "CancelError" || e.name === "AbortError"))
  );
}

interface ActivityState {
  task: ActivityTask | null;
  start: (task: ActivityTask) => void;
  update: (patch: Partial<Pick<ActivityTask, "label" | "progress">>) => void;
  end: (id?: string) => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  task: null,
  start: (task) => set({ task }),
  update: (patch) =>
    set((s) => (s.task ? { task: { ...s.task, ...patch } } : s)),
  // Only clear if the id matches the active task (guards against a stale
  // finally{} from a task that was already superseded).
  end: (id) => set((s) => (!id || s.task?.id === id ? { task: null } : s)),
}));

// ─── runCancelable ────────────────────────────────────────────────────────────

let _counter = 0;

export interface RunCancelableOptions {
  /** Label shown in the overlay. */
  label?: string;
  kind?: ActivityKind;
  /** Defaults to true. Set false for work that genuinely cannot be interrupted. */
  cancelable?: boolean;
  /** Side effect to run the moment the user cancels (before the abort lands). */
  onCancel?: () => void;
}

/**
 * Run an async task while showing the global spring activity overlay.
 *
 * The executor receives an AbortSignal — wire it into fetch (and any other
 * abortable primitive) for *true* cancellation. The returned promise rejects
 * with a CancelError the instant the user pulls to cancel, so the caller's UI
 * can restore immediately even if the underlying op finishes in the background.
 *
 * Usage:
 *   try {
 *     const res = await runCancelable((signal) => sendChat(text, hist, doc, name, signal),
 *       { kind: "ai", label: "Thinking" });
 *   } catch (e) {
 *     if (!isCancelError(e)) showError(e);
 *   }
 */
export async function runCancelable<T>(
  executor: (signal: AbortSignal) => Promise<T>,
  opts: RunCancelableOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const id = `act_${Date.now()}_${++_counter}`;
  let settled = false;

  let rejectCancel!: (reason: CancelError) => void;
  const cancelPromise = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });
  // If the executor wins the race this promise stays pending forever; swallow
  // any (impossible-after-settle) rejection so it never surfaces as unhandled.
  cancelPromise.catch(() => {});

  useActivityStore.getState().start({
    id,
    label: opts.label ?? "Working",
    kind: opts.kind ?? "generic",
    startedAt: Date.now(),
    cancelable: opts.cancelable ?? true,
    abort: () => {
      if (settled) return;
      try {
        opts.onCancel?.();
      } catch {
        // ignore onCancel errors — cancellation must still proceed
      }
      controller.abort(); // aborts any fetch wired to the signal
      rejectCancel(new CancelError()); // restores the caller's UI immediately
    },
  });

  try {
    return (await Promise.race([
      executor(controller.signal),
      cancelPromise,
    ])) as T;
  } finally {
    settled = true;
    useActivityStore.getState().end(id);
  }
}
