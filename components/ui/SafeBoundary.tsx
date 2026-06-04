// ============================================
// SafeBoundary
// ---------------------------------------------
// A minimal error boundary for *non-essential* UI. If a decorative/secondary
// subtree throws (e.g. a native module missing in the current build, an
// animation edge case), we render an optional fallback (default: nothing, or a
// passthrough of children) instead of crashing the whole app. Core app features
// must never be wrapped in a way that hides their own errors — this is only for
// the cosmetic motion layer added in the UI upgrade.
// ============================================

import React from "react";

interface Props {
  children: React.ReactNode;
  /** Rendered when children throw. Use "passthrough" to render children-as-is on retry. */
  fallback?: React.ReactNode;
  /** Optional tag for logging. */
  label?: string;
}

interface State {
  hasError: boolean;
}

export class SafeBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (__DEV__) {
      console.warn(
        `[SafeBoundary${this.props.label ? `:${this.props.label}` : ""}] suppressed error`,
        error,
      );
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
