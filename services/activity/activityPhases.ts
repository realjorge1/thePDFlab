// ============================================
// Activity phase messages
// ---------------------------------------------
// Three-phase status copy for the spring activity overlay (and AI "thinking"
// states): an opening message right after the request, a mid-work message, and
// a near-done message. Determinate work (downloads) maps phases to progress;
// indeterminate work (AI) advances on a gentle time curve.
// ============================================

import type { ActivityKind } from "./activityStore";

type PhaseSet = [string[], string[], string[]]; // [opening, midway, finishing]

const PHASES: Record<ActivityKind, PhaseSet> = {
  ai: [
    ["Reading your request", "Getting started", "Thinking it through", "On it"],
    [
      "Working on it",
      "Putting it together",
      "Connecting the ideas",
      "Crunching the details",
    ],
    [
      "Almost there",
      "Adding finishing touches",
      "Polishing the result",
      "Wrapping up",
    ],
  ],
  file: [
    ["Preparing your file", "Getting started", "Setting things up"],
    ["Building the document", "Laying out the pages", "Putting it together"],
    ["Almost there", "Adding finishing touches", "Finalizing"],
  ],
  download: [
    ["Starting download", "Connecting", "Fetching"],
    ["Downloading", "Pulling it in", "Still going"],
    ["Almost done", "Saving", "Wrapping up"],
  ],
  tool: [
    ["Getting started", "Reading the file", "Warming up"],
    ["Processing", "Working on it", "Crunching"],
    ["Almost there", "Finishing up", "Adding finishing touches"],
  ],
  generic: [
    ["Getting started", "One moment"],
    ["Working on it", "Almost there"],
    ["Finishing up", "Wrapping up"],
  ],
};

export interface PhaseInput {
  kind: ActivityKind;
  elapsedMs: number;
  /** 0..1 when known; omit for indeterminate work. */
  progress?: number;
  /** Stable per task so the message doesn't flicker within a phase. */
  seed: number;
}

/** Pick the status message for the current phase. */
export function phaseMessage({
  kind,
  elapsedMs,
  progress,
  seed,
}: PhaseInput): string {
  const set = PHASES[kind] ?? PHASES.generic;
  let phase: 0 | 1 | 2;
  if (typeof progress === "number") {
    phase = progress < 0.34 ? 0 : progress < 0.8 ? 1 : 2;
  } else {
    phase = elapsedMs < 2800 ? 0 : elapsedMs < 8000 ? 1 : 2;
  }
  const bucket = set[phase];
  // seed + phase keeps the message stable within a phase but lets it change as
  // the work advances to the next phase.
  return bucket[(Math.abs(seed) + phase) % bucket.length];
}
