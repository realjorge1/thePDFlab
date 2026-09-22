// RevenueCat SDK configuration
// Android key: RevenueCat Dashboard → Project → Apps → your Android app → Public SDK key
// iOS key: add when publishing to App Store
export const REVENUECAT_ANDROID_API_KEY = "goog_abfriCegFJdkuYnrUnVGpDQXXbe";
export const REVENUECAT_IOS_API_KEY = "appl_YOUR_IOS_KEY_HERE";

// Must match the Entitlement ID you created in RevenueCat dashboard
export const PREMIUM_ENTITLEMENT_ID = "premium";

// ⚠️ TEST OVERRIDE — when true, every Premium feature/screen is unlocked
// regardless of the user's real subscription status. This bypasses all
// paywalls and the AI premium guard so upgrades can be tested end-to-end.
//
// It can only be true in a development build (__DEV__) started with
// EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK=true. Release builds compile __DEV__ to
// false, so real users always go through the real subscription check. Never
// replace this with a hard-coded `true`.
export const FORCE_PREMIUM_UNLOCK = __DEV__ && process.env.EXPO_PUBLIC_FORCE_PREMIUM_UNLOCK === "true";
