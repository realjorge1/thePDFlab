import {
  PREMIUM_ENTITLEMENT_ID,
  REVENUECAT_ANDROID_API_KEY,
  REVENUECAT_IOS_API_KEY,
} from '@/config/revenuecat';
import { setAIPremiumAccess } from '@/services/ai/premiumGuard';
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
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    const apiKey =
      Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;

    Purchases.configure({ apiKey });

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
