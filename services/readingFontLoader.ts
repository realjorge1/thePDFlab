/**
 * readingFontLoader.ts
 * Makes the app's bundled reading faces available inside a WebView.
 *
 * React Native fonts do not reach a WebView iframe — the EPUB reader renders
 * inside one, so a font the app has loaded for its own UI is invisible there.
 * The usual fix is to base64-embed faces into a generated source file, the way
 * scripts/bundle-epub-scripts.js does for epub.js and jszip.
 *
 * That is not the right trade here. These faces are **already shipped** as app
 * assets (assets/fonts, loaded by expo-font for the RN side), so embedding
 * copies of them into the JS bundle would pay for the same bytes twice —
 * Merriweather alone is ~1 MB, ~1.4 MB once base64-encoded. Reading the
 * existing asset at runtime and encoding it on demand costs no extra app size
 * at all, and follows the pattern services/mobileViewVendorLoader.ts already
 * established for pdf.js and Mammoth.
 *
 * Encoding happens once per face per launch and is cached. Everything is
 * local: no network, so offline reading is unaffected.
 */

import type { Asset as ExpoAsset } from "expo-asset";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface ReadingFace {
  /** Stable id stored in ReaderSettings.fontFamily. */
  id: string;
  /** Shown in the reader settings sheet. */
  label: string;
  /** Family name used inside the WebView's @font-face rule. */
  family: string;
  /** Fallback stack for when the face has not finished loading. */
  fallback: string;
  /** One-line description of what it is good for. */
  hint: string;
}

/**
 * Deliberately short.
 *
 * A reader needs two or three good choices, not six mediocre ones, and every
 * face that can be selected is one more that has to be encoded and injected.
 * "system-ui" is the default and needs no loading at all.
 */
export const READING_FACES: ReadingFace[] = [
  {
    id: "system-ui",
    label: "System",
    family: "system-ui",
    fallback:
      "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    hint: "Matches the rest of your device",
  },
  {
    id: "Merriweather",
    label: "Merriweather",
    family: "InscribedSerif",
    fallback: "Georgia,'Times New Roman',serif",
    hint: "A serif designed for long reading on screens",
  },
  {
    id: "Lato",
    label: "Lato",
    family: "InscribedSans",
    fallback: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    hint: "An open, even sans-serif",
  },
];

/**
 * Asset handles, kept beside the catalogue.
 *
 * `require` of an asset must be a literal path for Metro to resolve it, so
 * these cannot be derived from the id at runtime.
 */
const FACE_ASSETS: Record<string, number | undefined> = {
  Merriweather: require("../assets/fonts/Merriweather_400Regular.ttf"),
  Lato: require("../assets/fonts/Lato_400Regular.ttf"),
};

export function getReadingFace(id: string): ReadingFace {
  return READING_FACES.find((f) => f.id === id) ?? READING_FACES[0];
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

async function encodeFace(id: string): Promise<string | null> {
  const cached = cache.get(id);
  if (cached) return cached;

  const existing = inflight.get(id);
  if (existing) return existing;

  const moduleId = FACE_ASSETS[id];
  if (moduleId === undefined) return null;

  const task = (async () => {
    try {
      const asset: ExpoAsset = Asset.fromModule(moduleId);
      if (!asset.downloaded) await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      if (!uri) return null;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      cache.set(id, base64);
      return base64;
    } catch (e) {
      // A missing or unreadable face must never stop a book opening — the
      // caller falls back to the stack in ReadingFace.fallback.
      console.warn("[readingFontLoader] Could not load face", id, e);
      return null;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, task);
  return task;
}

/**
 * A `@font-face` rule for the given face, ready to inject into a WebView.
 *
 * Returns an empty string for the system face, and for any face that could
 * not be read — in both cases the fallback stack is what renders.
 */
export async function buildFontFaceCss(id: string): Promise<string> {
  const face = getReadingFace(id);
  if (!FACE_ASSETS[face.id]) return "";

  const base64 = await encodeFace(face.id);
  if (!base64) return "";

  return (
    `@font-face{font-family:'${face.family}';` +
    `src:url(data:font/ttf;base64,${base64}) format('truetype');` +
    `font-weight:400;font-style:normal;font-display:swap}`
  );
}

/** The CSS font stack for a face, whether or not its file loaded. */
export function buildFontStack(id: string): string {
  const face = getReadingFace(id);
  return face.family === "system-ui"
    ? face.fallback
    : `'${face.family}',${face.fallback}`;
}
