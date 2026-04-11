/**
 * Usage Limiter — PDFlab
 *
 * Enforces the 3-download free tier limit.
 * Pro users bypass all limits.
 *
 * Usage:
 *   if (!(await canDownload(isPro))) {
 *     const success = await presentPaywall();
 *     if (!success) return;
 *     await refresh(); // re-check Pro status
 *   }
 *   await incrementDownload();
 *   // ... proceed with download
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DOWNLOAD_COUNT_KEY = 'download_count';
const FREE_DOWNLOAD_LIMIT = 3;

/**
 * Returns true if the user is allowed to download.
 * Pro users always return true.
 * Free users may download up to FREE_DOWNLOAD_LIMIT times.
 */
export const canDownload = async (isPro: boolean): Promise<boolean> => {
  if (isPro) return true;

  try {
    const count = Number(await AsyncStorage.getItem(DOWNLOAD_COUNT_KEY)) || 0;
    return count < FREE_DOWNLOAD_LIMIT;
  } catch (e) {
    console.error('[UsageLimiter] canDownload error:', e);
    return true; // safe fallback: let the attempt through
  }
};

/**
 * Increments the persistent download counter.
 * Call this after a successful download.
 */
export const incrementDownload = async (): Promise<void> => {
  try {
    const count = Number(await AsyncStorage.getItem(DOWNLOAD_COUNT_KEY)) || 0;
    await AsyncStorage.setItem(DOWNLOAD_COUNT_KEY, String(count + 1));
  } catch (e) {
    console.error('[UsageLimiter] incrementDownload error:', e);
  }
};

/**
 * Returns the current download count for the free tier.
 */
export const getDownloadCount = async (): Promise<number> => {
  try {
    return Number(await AsyncStorage.getItem(DOWNLOAD_COUNT_KEY)) || 0;
  } catch {
    return 0;
  }
};

/**
 * Resets the download counter (e.g., after a successful Pro upgrade).
 */
export const resetDownloadCount = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(DOWNLOAD_COUNT_KEY);
  } catch (e) {
    console.error('[UsageLimiter] resetDownloadCount error:', e);
  }
};
