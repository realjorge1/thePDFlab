import {
  FORCE_PREMIUM_UNLOCK,
  PREMIUM_ENTITLEMENT_ID,
  REVENUECAT_ANDROID_API_KEY,
  REVENUECAT_IOS_API_KEY,
} from '@/config/revenuecat';
import { setAIPremiumAccess } from '@/services/ai/premiumGuard';
import { setAIUserId } from '@/services/ai/aiRequestHeaders';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  LOG_LEVEL,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';

interface SubscriptionState {
  isPremium: boolean;
  isLoading: boolean;
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  restore: () => Promise<boolean>;
  getOfferings: () => Promise<PurchasesOfferings | null>;
}

const SubscriptionContext = createContext<SubscriptionState>({
  isPremium: false,
  isLoading: true,
  purchase: async () => false,
  restore: async () => false,
  getOfferings: async () => null,
});

function isPremiumActive(info: CustomerInfo): boolean {
  // TEST OVERRIDE: force-unlock regardless of real entitlement status.
  if (FORCE_PREMIUM_UNLOCK) return true;
  return info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
}

/** Update both React state and the non-React AI service guard flag. */
function applyPremium(
  active: boolean,
  setState: (v: boolean) => void,
): void {
  setState(active);
  setAIPremiumAccess(active);
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [isPremium, setIsPremium] = useState(FORCE_PREMIUM_UNLOCK);
  // When force-unlocked, skip the loading gate so screens render immediately
  // even if RevenueCat can't be configured in this build.
  const [isLoading, setIsLoading] = useState(!FORCE_PREMIUM_UNLOCK);

  useEffect(() => {
    // Keep the non-React AI guard in sync immediately on mount.
    setAIPremiumAccess(FORCE_PREMIUM_UNLOCK);

    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    const apiKey =
      Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;

    try {
      Purchases.configure({ apiKey });
    } catch (e) {
      // Without the SDK nobody can be verified as premium. End the loading
      // state so gated screens show the upsell instead of spinning forever,
      // and let AI requests go out without a user ID.
      console.error(e);
      setAIUserId(null);
      setIsLoading(false);
      return;
    }

    // Contract v2 (C3): AI requests carry the RevenueCat app user ID. AI calls
    // wait at most 2 s for it, then go out without it.
    Purchases.getAppUserID()
      .then((id) => setAIUserId(id))
      .catch(() => setAIUserId(null));

    Purchases.getCustomerInfo()
      .then((info) => applyPremium(isPremiumActive(info), setIsPremium))
      .catch(console.error)
      .finally(() => setIsLoading(false));

    const onCustomerInfoUpdate = (info: CustomerInfo) => {
      applyPremium(isPremiumActive(info), setIsPremium);
    };

    Purchases.addCustomerInfoUpdateListener(onCustomerInfoUpdate);

    return () => {
      Purchases.removeCustomerInfoUpdateListener(onCustomerInfoUpdate);
    };
  }, []);

  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const active = isPremiumActive(customerInfo);
    applyPremium(active, setIsPremium);
    return active;
  }, []);

  const restore = useCallback(async (): Promise<boolean> => {
    const customerInfo = await Purchases.restorePurchases();
    const active = isPremiumActive(customerInfo);
    applyPremium(active, setIsPremium);
    return active;
  }, []);

  const getOfferings = useCallback(async (): Promise<PurchasesOfferings | null> => {
    try {
      return await Purchases.getOfferings();
    } catch {
      return null;
    }
  }, []);

  return (
    <SubscriptionContext.Provider value={{ isPremium, isLoading, purchase, restore, getOfferings }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionState {
  return useContext(SubscriptionContext);
}
