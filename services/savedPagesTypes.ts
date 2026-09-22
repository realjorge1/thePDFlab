// ============================================
// Saved Pages — record shape
// ---------------------------------------------
// Split out from savedPagesService so the ranking module (and its tests) can
// depend on the shape without pulling in AsyncStorage or the file system.
// ============================================

/**
 * The unit a location is expressed in. Deliberately the same vocabulary as
 * services/ai/citations.ts → AILocatorType, so a saved page's location label
 * reads the same as an AI citation's ("Page 12", "Chapter 4", "Slide 7").
 */
export type SavedPageLocatorType =
  | "page"
  | "slide"
  | "sheet"
  | "chapter"
  | "section";

/**
 * One saved page.
 *
 * Every displayable field is DENORMALIZED at save time. After saving, the
 * list renders with no access to the source file, the file index or the
 * network — which is the whole feature: these records outlive the file.
 */
export interface SavedPage {
  /** uuid */
  id: string;
  /** Stable file key from services/fileIdentity.ts. */
  identityKey: string;
  fileName: string;
  fileExt: string;
  /** Informational only; may be dead. Re-linking a file updates it. */
  fileUriAtSave: string;
  locatorType: SavedPageLocatorType;
  /** page/slide/sheet/section index, 1-based */
  page?: number;
  totalPages?: number;
  /** EPUB */
  cfi?: string;
  /** reflow/DOCX fallback */
  scrollPct?: number;
  /** "Chapter 4", "Slide 7" */
  chapterLabel?: string;
  /** captured at save time, <= 600 chars */
  excerpt: string;
  /** user's own note, <= 500 chars */
  note?: string;
  /**
   * Path to the FULL text of the bookmarked page, written at save time by
   * services/savedPageSnapshotStore.ts. This — not `excerpt` — is the page.
   * `excerpt` is the list preview; this is what /saved-page renders, and it
   * stays readable after the source file is gone from the app AND the device.
   * Absent on records saved before snapshots existed, and when capture failed.
   */
  snapshotPath?: string;
  /** Snapshot length, so the list can report it without reading the file. */
  snapshotChars?: number;
  /**
   * Path to the bookmarked page's MARKUP, for reflow formats (DOCX, EPUB)
   * that cannot be rasterised. Re-rendered on /saved-page by the same engine
   * that drew it, so the page comes back with its fonts, tables and lists
   * rather than as flattened text. See utils/pageHtmlCapture.ts.
   */
  htmlPath?: string;
  /** The surface styling captured with it (font, size, leading, colour). */
  htmlCss?: string;
  /**
   * Path to the bookmarked page's PICTURE — a rasterised PDF page. Written by
   * services/savedPageImageStore.ts from the pdf.js pass that also fetched the
   * page text. Absent for reflow formats, which have htmlPath instead.
   */
  thumbPath?: string;
  createdAt: number;
  openCount: number;
  lastOpenedAt: number | null;
}

/** Longest excerpt kept on a record. */
export const EXCERPT_MAX = 600;
/** Longest user note kept on a record. */
export const NOTE_MAX = 500;

/**
 * Longest page snapshot kept on disk, in characters.
 *
 * A dense A4 page of prose is ~3,500 characters; 20,000 covers a long DOCX
 * section or a two-column paper page with room to spare, while capping the
 * worst case (a single-section EPUB whose whole body counts as "on screen")
 * at ~20 KB per bookmark — about 10 MB at the 500-record cap.
 */
export const SNAPSHOT_MAX = 20_000;

/**
 * Retention cap. At the cap a save is REFUSED with a clear message — a saved
 * page is user data, not cache, so it is never silently evicted to make room.
 */
export const SAVED_PAGES_MAX = 500;

/** Human label for a location, matching services/ai/citations.ts. */
const LABEL_WORD: Record<SavedPageLocatorType, string> = {
  page: "Page",
  slide: "Slide",
  sheet: "Sheet",
  chapter: "Chapter",
  section: "Section",
};

/** "Page 12" / "Chapter 4" / "Slide 7", or a stored chapterLabel when richer. */
export function savedPageLocationLabel(page: SavedPage): string {
  if (page.chapterLabel && page.chapterLabel.trim()) return page.chapterLabel.trim();
  if (typeof page.page === "number" && page.page > 0) {
    return `${LABEL_WORD[page.locatorType] ?? "Page"} ${page.page}`;
  }
  if (typeof page.scrollPct === "number") {
    return `${LABEL_WORD[page.locatorType] ?? "Section"} · ${Math.round(page.scrollPct)}%`;
  }
  return LABEL_WORD[page.locatorType] ?? "Location";
}

/** The locator unit a file extension uses. */
export function locatorTypeForExt(ext: string): SavedPageLocatorType {
  const e = (ext || "").toLowerCase();
  if (e === "epub") return "chapter";
  if (e === "pptx" || e === "ppt") return "slide";
  if (e === "xlsx" || e === "xls") return "sheet";
  if (e === "pdf") return "page";
  return "section";
}
