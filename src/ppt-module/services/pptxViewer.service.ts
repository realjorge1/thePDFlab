// ─────────────────────────────────────────────
//  PPT Module — Viewer Service
//  Strategy: Convert PPTX → slide previews
//
//  Approach A (Online): Google Docs Viewer embed
//  Approach B (Online): Office 365 viewer embed
//  Approach C (Offline): Render slide cards natively
//                        from our parsed slide data
// ─────────────────────────────────────────────

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { Slide, ViewerStrategy, ViewerSource } from '../types/ppt.types';

/**
 * Given a local PPTX file path, produce the best viewing source
 * for the current device.
 *
 * Decision tree:
 *  1. If we have a remote URL (already uploaded)  → Google Docs viewer
 *  2. If file is local and network is available   → Upload to temp host and use viewer
 *  3. Fallback                                    → Native card renderer
 */
export function buildViewerSource(
  filePath: string | undefined,
  slides: Slide[],
  remoteUrl?: string,
): ViewerSource {
  if (remoteUrl) {
    return {
      strategy: 'webview_google',
      uri: googleDocsViewerUrl(remoteUrl),
    };
  }

  // Native card fallback always works offline
  return { strategy: 'native_cards', slides };
}

export function googleDocsViewerUrl(fileUrl: string): string {
  return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(fileUrl)}`;
}

export function officeViewerUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fileUrl)}`;
}

/**
 * Try to get an RNFS-compatible file URI.
 * On iOS, files in DocumentDirectory can be shared via file://
 */
export function fileUri(filePath: string): string {
  return Platform.OS === 'ios' ? `file://${filePath}` : filePath;
}

/**
 * Copy a PPTX from assets/bundle into writable storage.
 * Useful for demo/template files bundled with the app.
 */
export async function copyBundledPPTX(
  assetName: string,
): Promise<string | null> {
  try {
    const destDir = RNFS.DocumentDirectoryPath;
    const dest = `${destDir}/${assetName}`;
    const exists = await RNFS.exists(dest);
    if (!exists) {
      await RNFS.copyFileAssets(assetName, dest);
    }
    return dest;
  } catch (e) {
    console.warn('[PPTViewer] copyBundledPPTX failed:', e);
    return null;
  }
}
