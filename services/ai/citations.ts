// ============================================
// Citations — one parser for every citation shape
// ---------------------------------------------
// Old backends send `{ page, quote }` (often with an empty quote). Contract v2
// (C6) sends `{ id, page, locator: { type, index, label }, quote, chunkId }`.
// parseCitations accepts both, drops junk, and always fills in a locator and a
// human label ("Page 12", "Chapter 3", "Slide 7") so the UI never has to care
// which backend answered. It never throws.
// ============================================

export const AI_LOCATOR_TYPES = ["page", "slide", "sheet", "chapter", "section"] as const;
export type AILocatorType = (typeof AI_LOCATOR_TYPES)[number];

export interface AICitationLocator {
  type: AILocatorType;
  index: number;
  label: string;
}

export interface AICitation {
  id: number;
  page: number;
  locator?: AICitationLocator;
  quote: string;
  chunkId?: number;
}

const LABEL_WORD: Record<AILocatorType, string> = {
  page: "Page",
  slide: "Slide",
  sheet: "Sheet",
  chapter: "Chapter",
  section: "Section",
};

export function isLocatorType(v: unknown): v is AILocatorType {
  return typeof v === "string" && (AI_LOCATOR_TYPES as readonly string[]).includes(v);
}

/** "Page 12", "Slide 7", "Sheet 2", "Chapter 3", "Section 4". */
export function locatorLabel(type: AILocatorType | undefined | null, index: number): string {
  return `${LABEL_WORD[isLocatorType(type) ? type : "page"]} ${index}`;
}

/**
 * The locator unit a document uses (contract v2, C4): PDF → page, PPTX →
 * slide, XLSX → sheet, EPUB → chapter, DOCX/TXT/MD/CSV → section.
 * Accepts a file name, MIME type, or backend `fileType`.
 */
export function locatorTypeForDocument(doc: {
  name?: string | null;
  mimeType?: string | null;
  fileType?: string | null;
}): AILocatorType {
  const hay = [doc.fileType, doc.mimeType, doc.name]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  if (/\bepub\b|epub\+zip|\.epub\b/.test(hay)) return "chapter";
  if (/presentation|\bpptx?\b|\.pptx?\b/.test(hay)) return "slide";
  if (/spreadsheet|\bxlsx?\b|\.xlsx?\b/.test(hay)) return "sheet";
  if (/\bpdf\b|\.pdf\b/.test(hay)) return "page";
  if (/wordprocessing|\bdocx?\b|\.docx?\b|text\/plain|\btxt\b|\.txt\b|markdown|\bmd\b|\.md\b|\bcsv\b|\.csv\b/.test(hay)) {
    return "section";
  }
  return "page";
}

function toInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** Parse citations from either backend shape. */
export function parseCitations(
  raw: unknown,
  opts: { locatorType?: AILocatorType } = {},
): AICitation[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: AICitation[] = [];
    const usedIds = new Set<number>();
    const fallbackType: AILocatorType = isLocatorType(opts.locatorType) ? opts.locatorType : "page";

    raw.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const r = item as Record<string, unknown>;
      const loc =
        r.locator && typeof r.locator === "object" ? (r.locator as Record<string, unknown>) : null;
      const locIndex = loc ? toInt(loc.index) : undefined;
      const page = toInt(r.page) ?? locIndex;
      if (page === undefined) return;

      const type = loc && isLocatorType(loc.type) ? loc.type : fallbackType;
      const index = locIndex ?? page;
      const label =
        loc && typeof loc.label === "string" && loc.label.trim()
          ? loc.label.trim()
          : locatorLabel(type, index);

      let id = toInt(r.id);
      if (id === undefined || id === 0 || usedIds.has(id)) {
        id = i + 1;
        while (usedIds.has(id)) id++;
      }
      usedIds.add(id);

      const citation: AICitation = {
        id,
        page,
        locator: { type, index, label },
        quote: typeof r.quote === "string" ? r.quote.trim() : "",
      };
      const chunkId = toInt(r.chunkId);
      if (chunkId !== undefined) citation.chunkId = chunkId;
      out.push(citation);
    });
    return out;
  } catch {
    return [];
  }
}

/** True when the payload uses the contract v2 shape (has ids or locators). */
export function isV2CitationShape(raw: unknown): boolean {
  return (
    Array.isArray(raw) &&
    raw.some(
      (c) =>
        !!c &&
        typeof c === "object" &&
        ("locator" in (c as object) || typeof (c as { id?: unknown }).id === "number"),
    )
  );
}

const MARKER = /( ?)\[(\d{1,3})\]/g;

/** Citation ids referenced by `[n]` markers, in order of first appearance. */
export function citationMarkerIds(text: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  if (typeof text !== "string") return out;
  for (const m of text.matchAll(MARKER)) {
    const id = Number(m[2]);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Remove every `[n]` marker (used when citations are not rendered as chips). */
export function stripCitationMarkers(text: string): string {
  if (typeof text !== "string" || !text) return text;
  return text.replace(MARKER, "");
}

/** Remove `[n]` markers that have no matching citation. */
export function removeOrphanCitationMarkers(text: string, citations: AICitation[]): string {
  if (typeof text !== "string" || !text) return text;
  const ids = new Set(citations.map((c) => c.id));
  return text.replace(MARKER, (match, space: string, n: string) =>
    ids.has(Number(n)) ? match : "",
  );
}
