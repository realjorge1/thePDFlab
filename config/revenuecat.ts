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
// SET BACK TO false BEFORE RELEASE.
export const FORCE_PREMIUM_UNLOCK = false;
