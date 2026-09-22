// ============================================
// AI Error Presenter (W1.6)
// ---------------------------------------------
// One place that decides what the user sees for an AI failure, shared by every
// AI screen:
//   PREMIUM_REQUIRED                → the existing paywall opens
//   RATE_LIMITED                    → "You're going a bit fast. Try again in N seconds."
//   UNAUTHORIZED                    → "Please update the app to keep using Gozlin."
//   NETWORK / UNAVAILABLE / TIMEOUT → "Gozlin can't reach the server…" + Retry
//   CANCELLED                       → nothing
// ============================================

import { Alert } from "react-native";

import {
  AI_NO_PROVIDER_CODE,
  AI_TEMPORARILY_UNAVAILABLE_MESSAGE,
  normalizeAIError,
  type AIError,
} from "./aiErrors";

export const CANT_REACH_MESSAGE =
  "Gozlin can't reach the server. Check your connection and try again.";
export const UPDATE_APP_MESSAGE = "Please update the app to keep using Gozlin.";
export const TEMPORARILY_UNAVAILABLE_MESSAGE = AI_TEMPORARILY_UNAVAILABLE_MESSAGE;
/** serverCode used when /ai/status reports no provider configured. */
export const NO_PROVIDER_CODE = AI_NO_PROVIDER_CODE;

export type AIErrorPresentation =
  | { kind: "silent"; error: AIError }
  | { kind: "paywall"; error: AIError }
  | { kind: "message"; error: AIError; title: string; message: string; retryable: boolean };

export function rateLimitMessage(retryAfterSec?: number): string {
  if (typeof retryAfterSec === "number" && retryAfterSec > 0) {
    const n = Math.ceil(retryAfterSec);
    return `You're going a bit fast. Try again in ${n} second${n === 1 ? "" : "s"}.`;
  }
  return "You're going a bit fast. Try again in a few seconds.";
}

/** Pure: what to show for an error. */
export function describeAIError(err: unknown): AIErrorPresentation {
  const error = normalizeAIError(err);
  switch (error.code) {
    case "CANCELLED":
      return { kind: "silent", error };
    case "PREMIUM_REQUIRED":
      return { kind: "paywall", error };
    case "RATE_LIMITED":
      return {
        kind: "message",
        error,
        title: "Slow down a little",
        message: rateLimitMessage(error.retryAfterSec),
        retryable: false,
      };
    case "UNAUTHORIZED":
      return { kind: "message", error, title: "Update needed", message: UPDATE_APP_MESSAGE, retryable: false };
    case "NETWORK":
    case "TIMEOUT":
    case "UNAVAILABLE":
      if (error.serverCode === NO_PROVIDER_CODE) {
        return {
          kind: "message",
          error,
          title: "Gozlin",
          message: TEMPORARILY_UNAVAILABLE_MESSAGE,
          retryable: true,
        };
      }
      return { kind: "message", error, title: "Can't reach Gozlin", message: CANT_REACH_MESSAGE, retryable: true };
    case "DOC_NOT_FOUND":
      return {
        kind: "message",
        error,
        title: "Document unavailable",
        message: "This document is no longer available. Please open it again and retry.",
        retryable: true,
      };
    case "BAD_OUTPUT":
      return {
        kind: "message",
        error,
        title: "Gozlin",
        message: "Gozlin couldn't produce a usable answer this time. Please try again.",
        retryable: true,
      };
    case "SERVER":
    default:
      return {
        kind: "message",
        error,
        title: "Gozlin",
        message: error.serverMessage?.trim() || "Something went wrong. Please try again.",
        retryable: true,
      };
  }
}

/**
 * True for the errors the presenter owns end to end (paywall, rate limit,
 * update, connectivity, cancel). Screens keep their own inline handling for
 * anything else.
 */
export function isPresentableAIError(err: unknown): boolean {
  const code = normalizeAIError(err).code;
  return (
    code === "CANCELLED" ||
    code === "PREMIUM_REQUIRED" ||
    code === "RATE_LIMITED" ||
    code === "UNAUTHORIZED" ||
    code === "NETWORK" ||
    code === "TIMEOUT" ||
    code === "UNAVAILABLE"
  );
}

export interface PresentAIErrorOptions {
  /** Offered as a "Retry" button for retryable errors. */
  onRetry?: () => void;
  /** Override how the paywall opens (default: router.push("/premium")). */
  openPaywall?: () => void;
}

/** Show the error the standard way. Returns what was shown. */
export function presentAIError(err: unknown, opts: PresentAIErrorOptions = {}): AIErrorPresentation {
  const p = describeAIError(err);
  if (p.kind === "silent") return p;
  if (p.kind === "paywall") {
    try {
      if (opts.openPaywall) opts.openPaywall();
      else {
        const { router } = require("expo-router");
        router.push("/premium");
      }
    } catch {
      // navigation unavailable — nothing else to do
    }
    return p;
  }
  const buttons: { text: string; style?: "cancel" | "default"; onPress?: () => void }[] = [];
  if (p.retryable && opts.onRetry) {
    buttons.push({ text: "Cancel", style: "cancel" });
    buttons.push({ text: "Retry", onPress: opts.onRetry });
  } else {
    buttons.push({ text: "OK" });
  }
  Alert.alert(p.title, p.message, buttons);
  return p;
}

/** Inline text for chat bubbles (null when nothing should be shown). */
export function aiErrorInlineMessage(err: unknown): string | null {
  const p = describeAIError(err);
  return p.kind === "message" ? p.message : null;
}
