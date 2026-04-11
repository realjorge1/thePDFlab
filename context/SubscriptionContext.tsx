/**
 * Subscription Context
 * Provides subscription/premium state throughout the app.
 * Currently a pass-through provider — ready for real IAP integration.
 */

import React, { createContext, useContext, type ReactNode } from "react";

interface SubscriptionState {
  /** Whether the user has an active premium subscription */
  isPremium: boolean;
}

const SubscriptionContext = createContext<SubscriptionState>({
  isPremium: false,
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  return (
    <SubscriptionContext.Provider value={{ isPremium: false }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionState {
  return useContext(SubscriptionContext);
}
