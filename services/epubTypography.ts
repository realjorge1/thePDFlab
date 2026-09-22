/**
 * epubTypography.ts
 * Turns ReaderSettings into the CSS the EPUB WebView applies to book content.
 *
 * This is the boundary between the app's single ReaderSettings type and
 * epub.js's own conventions. Two things are reconciled here and nowhere else:
 *
 *  1. **Font size units.** ReaderSettings carries points; epub.js sizes text
 *     as a percentage of the book's own base. `readerFontSizeToEpubPercent`
 *     is the one place that conversion happens.
 *
 *  2. **Specificity.** epub.js's `themes.override()` writes properties onto
 *     `body`, which a book's own stylesheet beats whenever it styles `p`
 *     directly — and most do. These rules target the elements the book styles
 *     and use `!important`, so a reader's choice actually takes effect.
 *
 * Nothing here touches colour: the light/sepia/dark themes registered in the
 * viewer keep sole control of that, so a typography change can never make text
 * unreadable against its background.
 */

import { buildFontFaceCss, buildFontStack } from "@/services/readingFontLoader";
import type { ReaderSettings } from "@/src/types/document-viewer.types";

/**
 * Point size that corresponds to epub.js's 100%.
 *
 * Matches DEFAULT_READER_SETTINGS.fontSize so a reader who has never opened
 * the settings sheet sees the book at its intended size.
 */
export const EPUB_BASE_FONT_PT = 16;

/** ReaderSettings points → the percentage epub.js wants. */
export function readerFontSizeToEpubPercent(pt: number): number {
  const safe = Number.isFinite(pt) ? pt : EPUB_BASE_FONT_PT;
  return Math.round((safe / EPUB_BASE_FONT_PT) * 100);
}

/** The percentage epub.js stored → ReaderSettings points. */
export function epubPercentToReaderFontSize(percent: number): number {
  const safe = Number.isFinite(percent) ? percent : 100;
  return Math.round((safe / 100) * EPUB_BASE_FONT_PT);
}

/**
 * Build the stylesheet for a set of reader settings.
 *
 * Async only because an embedded face has to be read from the asset bundle
 * and base64-encoded; the result is cached, so this is a one-off per face.
 */
export async function buildEpubTypographyCss(
  settings: ReaderSettings,
): Promise<string> {
  const fontFace = await buildFontFaceCss(settings.fontFamily);
  const stack = buildFontStack(settings.fontFamily);

  const margin = clamp(settings.margin ?? 16, 0, 64);
  const lineHeight = clamp(settings.lineHeight ?? 1.6, 1.2, 2.4);
  const spacing = clamp(settings.paragraphSpacing ?? 1, 0, 2);
  const align = settings.textAlign === "justify" ? "justify" : "left";

  return [
    fontFace,
    // The body margin is what creates the page gutter; epub.js sizes its
    // iframe to the container, so padding here would be clipped instead.
    `body{`,
    `margin-left:${margin}px !important;`,
    `margin-right:${margin}px !important;`,
    `line-height:${lineHeight} !important;`,
    `font-family:${stack} !important;`,
    `}`,
    // Books almost always style these directly, so they need naming.
    `p,li,blockquote,div{`,
    `line-height:${lineHeight} !important;`,
    `font-family:${stack} !important;`,
    `}`,
    `p{`,
    `text-align:${align} !important;`,
    `margin-bottom:${spacing}em !important;`,
    // Justified text without hyphenation opens rivers on a narrow screen.
    align === "justify" ? `hyphens:auto !important;-webkit-hyphens:auto;` : ``,
    `}`,
    // Headings keep their own rhythm; only the family follows the reader.
    `h1,h2,h3,h4,h5,h6{font-family:${stack} !important;}`,
  ].join("");
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
