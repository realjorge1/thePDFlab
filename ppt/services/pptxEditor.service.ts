// ─────────────────────────────────────────────
//  PPT Module — Editor Service
//  Parse and mutate existing PPTX files.
//  Uses JSZip + XML manipulation on-device.
// ─────────────────────────────────────────────

import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import { Slide, PPTPresentation, ThemeId } from '../types/ppt.types';
import { DEFAULT_THEME_ID } from '../themes/pptThemes';

// ─── PPTX XML Helpers ────────────────────────

function extractTextFromSlideXml(xml: string): string {
  // Collect all <a:t> content from the slide XML
  const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
  return matches
    .map(m => m.replace(/<[^>]+>/g, ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function extractTitleFromSlideXml(xml: string): string {
  // Title placeholder is ph type="title" or idx="0"
  const titleSection = xml.match(
    /<p:sp>(?:(?!<p:sp>)[\s\S])*?ph[^>]*type="title"[\s\S]*?<\/p:sp>/,
  );
  if (titleSection) {
    const texts = titleSection[0].match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
    return texts
      .map(m => m.replace(/<[^>]+>/g, ''))
      .join('')
      .trim();
  }
  return '';
}

function replaceTextInSlideXml(xml: string, search: string, replace: string): string {
  // Safely replace text within <a:t> tags
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(
    new RegExp(`(<a:t[^>]*>)(${escaped})(<\\/a:t>)`, 'g'),
    `$1${replace}$3`,
  );
}

// ─── Public API ──────────────────────────────

export interface ParsedPresentation {
  id: string;
  title: string;
  themeId: ThemeId;
  slides: Slide[];
  createdAt: Date;
  updatedAt: Date;
  filePath: string;
  // Raw zip kept in memory for editing
  _zip: JSZip;
  _slideFileNames: string[];
}

/**
 * Open an existing .pptx file from device storage.
 * Returns a ParsedPresentation you can display and edit.
 */
export async function openPPTX(filePath: string): Promise<ParsedPresentation> {
  const base64 = await RNFS.readFile(filePath, 'base64');

  // base64 → binary string → Uint8Array
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const zip = await JSZip.loadAsync(bytes.buffer);

  // Discover slide files (ppt/slides/slide1.xml, slide2.xml …)
  const slideFileNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)\.xml$/)![1], 10);
      const numB = parseInt(b.match(/(\d+)\.xml$/)![1], 10);
      return numA - numB;
    });

  // Extract core.xml for title
  let presentationTitle = 'Imported Presentation';
  try {
    const coreXml = await zip.file('docProps/core.xml')!.async('string');
    const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
    if (titleMatch) presentationTitle = titleMatch[1];
  } catch { /* no core.xml – keep default */ }

  // Parse each slide into our Slide type
  const slides: Slide[] = [];
  for (let i = 0; i < slideFileNames.length; i++) {
    const xml = await zip.file(slideFileNames[i])!.async('string');
    const title = extractTitleFromSlideXml(xml);
    const body = extractTextFromSlideXml(xml)
      .replace(title, '')
      .trim();

    slides.push({
      id: `imported-slide-${i}`,
      layout: 'titleContent',
      speakerNotes: '',
      content: {
        title: title || `Slide ${i + 1}`,
        body,
      },
    });
  }

  return {
    id: `imported-${Date.now()}`,
    title: presentationTitle,
    themeId: DEFAULT_THEME_ID,
    slides,
    createdAt: new Date(),
    updatedAt: new Date(),
    filePath,
    _zip: zip,
    _slideFileNames: slideFileNames,
  };
}

/**
 * Save text edits back into the PPTX zip and write to disk.
 */
export async function saveEditsToExistingPPTX(
  parsed: ParsedPresentation,
  edits: Array<{
    slideIndex: number;
    search: string;
    replace: string;
  }>,
  outputPath?: string,
): Promise<string> {
  const zip = parsed._zip;

  for (const edit of edits) {
    const fileName = parsed._slideFileNames[edit.slideIndex];
    if (!fileName) continue;
    let xml = await zip.file(fileName)!.async('string');
    xml = replaceTextInSlideXml(xml, edit.search, edit.replace);
    zip.file(fileName, xml);
  }

  const base64Out = await zip.generateAsync({ type: 'base64' });
  const dest = outputPath ?? parsed.filePath;
  await RNFS.writeFile(dest, base64Out, 'base64');
  return dest;
}

/**
 * Convert a ParsedPresentation back to our PPTPresentation domain type,
 * so it can be re-generated with a new theme via generatePPTX().
 */
export function toPPTPresentation(
  parsed: ParsedPresentation,
): PPTPresentation {
  return {
    id: parsed.id,
    title: parsed.title,
    themeId: parsed.themeId,
    slides: parsed.slides,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    filePath: parsed.filePath,
  };
}
