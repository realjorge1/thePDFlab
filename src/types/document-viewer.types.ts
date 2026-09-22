/**
 * Document Viewer Types
 * Shared type definitions for PDF & DOCX viewer upgrade features:
 * Mobile View, Search, Highlighting, Text Extraction.
 */

// ============================================================================
// VIEW MODE
// ============================================================================
export type ViewMode = "original" | "mobile";

// ============================================================================
// READER SETTINGS
// ============================================================================
export type ReaderTheme = "light" | "sepia" | "dark";

/**
 * The single source of truth for reader typography across every viewer.
 *
 * Mobile View (DOCX/PDF reflow) consumes these values directly. The EPUB
 * reader keeps its own persistence layer because epub.js wants a *percentage*
 * font size rather than points — see readerFontSizeToEpubPercent() in
 * services/epubService.ts, which is the one documented place that conversion
 * happens.
 */
export interface ReaderSettings {
  fontSize: number; // 12–32 pt
  lineHeight: number; // 1.2–2.4
  theme: ReaderTheme;
  fontFamily: string;
  /** Horizontal page margin in px, 0–64. */
  margin: number;
  textAlign: "left" | "justify";
  /** Space between paragraphs as an em multiplier, 0–2. */
  paragraphSpacing: number;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 16,
  lineHeight: 1.6,
  theme: "light",
  fontFamily: "system-ui",
  margin: 16,
  textAlign: "left",
  paragraphSpacing: 1,
};

// ============================================================================
// REFLOW API RESPONSE
// ============================================================================
export interface ReflowResponse {
  success: boolean;
  html?: string;
  plainText?: string;
  metadata?: {
    pageCount?: number;
    wordCount?: number;
    hasImages?: boolean;
    extractionQuality?: string;
  };
  // Error fields (422)
  error?: string;
  message?: string;
  isScanned?: boolean;
}

// ============================================================================
// SEARCH
// ============================================================================
export interface SearchState {
  query: string;
  matchCount: number;
  currentIndex: number; // -1 if none
  isSearching: boolean;
}

export const INITIAL_SEARCH_STATE: SearchState = {
  query: "",
  matchCount: 0,
  currentIndex: -1,
  isSearching: false,
};

// ============================================================================
// HIGHLIGHTS
// ============================================================================
export interface Highlight {
  id: string;
  fileUri: string;
  /** Offset-based for Mobile View */
  startOffset?: number;
  endOffset?: number;
  /** Page-based for Original PDF */
  pageNumber?: number;
  /** The selected text snippet */
  text: string;
  color: string;
  createdAt: number;
}

export const HIGHLIGHT_COLORS = [
  { label: "Yellow", value: "rgba(255,235,59,0.4)" },
  { label: "Green", value: "rgba(76,175,80,0.4)" },
  { label: "Blue", value: "rgba(33,150,243,0.4)" },
  { label: "Pink", value: "rgba(233,30,99,0.4)" },
  { label: "Orange", value: "rgba(255,152,0,0.4)" },
];

// ============================================================================
// SCROLL POSITION
// ============================================================================
export interface ScrollPosition {
  scrollY: number;
  scrollPercent: number;
  timestamp: number;
}

// ============================================================================
// WEBVIEW MESSAGES (from injected JS)
// ============================================================================
export type WebViewMessage =
  | { type: "ready" }
  | { type: "scroll"; scrollY: number; scrollPercent: number }
  | { type: "search-result"; count: number; current: number }
  | {
      type: "text-selected";
      text: string;
      startOffset: number;
      endOffset: number;
    }
  | {
      type: "selection";
      text: string;
      startOffset: number;
      endOffset: number;
      rect: { x: number; y: number; width: number; height: number };
      scrollX: number;
      scrollY: number;
    }
  | { type: "selection_clear" }
  | {
      type: "annotation_applied";
      success: boolean;
      id?: string;
      kind?: "highlight" | "underline" | "strikethrough";
    }
  | { type: "read-aloud-text"; text: string }
  /** The text currently on screen. Bookmarks stores it as the page's text;
   *  deliberately separate from "read-aloud-text", which is the whole doc. */
  | { type: "visible-text"; text: string }
  /** The MARKUP currently on screen, already sanitised — Bookmarks stores it
   *  so a reflow page comes back looking like itself rather than as plain
   *  text. `css` is a computed-style summary of the reading surface. */
  | { type: "visible-html"; html: string; css: string }
  /** Posted by the reflow HTML when it cannot render the document
   *  (scanned PDF, parse failure, vendor script missing). Viewers fall
   *  back to Original view and surface the message. */
  | { type: "reflow-error"; title: string; message: string };

// ============================================================================
// UNDERLINE ANNOTATIONS
// ============================================================================
export interface Underline {
  id: string;
  fileUri: string;
  startOffset: number;
  endOffset: number;
  /** 0-based page index — set for the in-place page (text-layer) view. */
  pageNumber?: number;
  text: string;
  createdAt: number;
}

// ============================================================================
// STRIKETHROUGH ANNOTATIONS
// ============================================================================
export interface Strikethrough {
  id: string;
  fileUri: string;
  startOffset: number;
  endOffset: number;
  /** 0-based page index — set for the in-place page (text-layer) view. */
  pageNumber?: number;
  text: string;
  createdAt: number;
}

// ============================================================================
// SELECTION MENU
// ============================================================================
export type SelectionAction =
  | "copy"
  | "bold"
  | "italic"
  | "underline"
  | "ask-gozlin"
  | "text-color"
  | "highlight-color";

export interface SelectionPayload {
  text: string;
  startOffset: number;
  endOffset: number;
  rect: { x: number; y: number; width: number; height: number };
  scrollX: number;
  scrollY: number;
}
