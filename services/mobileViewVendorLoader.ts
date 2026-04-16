/**
 * Loads bundled vendor JavaScript libraries for Mobile View rendering.
 *
 * The libraries live in assets/vendor/*.vlib and are bundled into the app
 * via Expo's asset system. They are loaded once, cached in memory, and
 * returned as raw JavaScript source strings that can be inlined into the
 * reflow HTML. This guarantees offline operation with no CDN dependency.
 */
import type { Asset as ExpoAsset } from "expo-asset";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

type VendorScripts = {
  pdfMinJs: string;
  pdfWorkerMinJs: string;
  mammothBrowserMinJs: string;
};

let cached: VendorScripts | null = null;
let inflight: Promise<VendorScripts> | null = null;

async function loadAssetText(module: number): Promise<string> {
  const asset: ExpoAsset = Asset.fromModule(module);
  if (!asset.downloaded) {
    await asset.downloadAsync();
  }
  const uri = asset.localUri || asset.uri;
  if (!uri) {
    throw new Error("Vendor asset missing local URI");
  }
  return FileSystem.readAsStringAsync(uri);
}

export async function loadMobileViewVendorScripts(): Promise<VendorScripts> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const [pdfMinJs, pdfWorkerMinJs, mammothBrowserMinJs] = await Promise.all([
      loadAssetText(require("../assets/vendor/pdf.min.js.vlib")),
      loadAssetText(require("../assets/vendor/pdf.worker.min.js.vlib")),
      loadAssetText(require("../assets/vendor/mammoth.browser.min.js.vlib")),
    ]);
    cached = { pdfMinJs, pdfWorkerMinJs, mammothBrowserMinJs };
    return cached;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
