// ============================================
// AI Premium Guard
// AI is a Premium-only capability. SubscriptionContext keeps this flag in sync
// via setAIPremiumAccess(). Every user-facing AI operation calls assertAIPremium()
// before doing any work, so no AI request can fire for a free user — even from a
// code path that bypasses the screen-level <PremiumGate> (e.g. scheduled tasks).
// ============================================

import { FORCE_PREMIUM_UNLOCK } from "@/config/revenuecat";

let _hasPremiumAccess = FORCE_PREMIUM_UNLOCK;

export function setAIPremiumAccess(hasAccess: boolean): void {
  // TEST OVERRIDE keeps AI access pinned on regardless of real status.
  _hasPremiumAccess = FORCE_PREMIUM_UNLOCK || hasAccess;
}

export function hasAIPremiumAccess(): boolean {
  return _hasPremiumAccess;
}

export class PremiumRequiredError extends Error {
  constructor(
    message = "A Premium subscription is required to use AI features.",
  ) {
    super(message);
    this.name = "PremiumRequiredError";
  }
}

/** Throws PremiumRequiredError when the user does not have an active subscription. */
export function assertAIPremium(): void {
  if (!_hasPremiumAccess) throw new PremiumRequiredError();
}
