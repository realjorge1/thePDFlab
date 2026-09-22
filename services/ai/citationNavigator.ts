// ============================================
// Citation Navigator (W4.3) — the single entry point for citation taps
// ---------------------------------------------
// Inside a reader (the in-reader AI panel):
//   the panel shrinks to its peek height, a Source card shows the label and
//   quote, and the mounted viewer moves to the location through the target it
//   registered (PDF page jump, EPUB search / chapter, DOCX search, PPTX slide).
// Outside a reader (Chat with File):
//   the matching viewer opens with the optional params
//   `locatorType`, `locatorIndex` and `quote`; the viewer acts on them once its
//   document has loaded.
// PDFs are never highlighted on the page (ENABLE_INPLACE_PDF_SELECTION stays
// off): page jumps plus the Source card only.
// ============================================

import { Alert } from "react-native";

import {
  isLocatorType,
  locatorLabel,
  locatorTypeForDocument,
  type AICitation,
  type AILocatorType,
} from "./citations";

export type ReaderKind = "pdf" | "epub" | "docx" | "pptx" | "other";

export interface ReaderCitationTarget {
  kind: ReaderKind;
  /** Move the viewer to the citation. Resolve true when it moved. */
  navigate: (citation: AICitation) => boolean | Promise<boolean>;
}

export interface SourceCardData {
  label: string;
  quote: string;
  citation: AICitation;
}

export interface ReaderPanelHooks {
  shrinkToPeek: () => void;
  showSourceCard: (card: SourceCardData) => void;
}

let _reader: ReaderCitationTarget | null = null;
let _panel: ReaderPanelHooks | null = null;

/** A viewer registers how to navigate while it is mounted. Returns unregister. */
export function registerReaderCitationTarget(target: ReaderCitationTarget): () => void {
  _reader = target;
  return () => {
    if (_reader === target) _reader = null;
  };
}

/** The in-reader panel registers its hooks while mounted. Returns unregister. */
export function registerReaderPanelHooks(hooks: ReaderPanelHooks): () => void {
  _panel = hooks;
  return () => {
    if (_panel === hooks) _panel = null;
  };
}

export function getActiveReaderTarget(): ReaderCitationTarget | null {
  return _reader;
}

export interface CitationDocument {
  uri: string;
  name: string;
  mimeType?: string;
}

export type CitationContext =
  | { source: "reader-panel" }
  | { source: "screen"; document?: CitationDocument | null };

export function citationLabel(citation: AICitation): string {
  return citation.locator?.label ?? locatorLabel(citation.locator?.type, citation.page);
}

type ViewerPath = "/pdf-viewer" | "/docx-viewer" | "/epub-viewer" | "/ppt-viewer";

/** Which reader route shows a document, or null when none does. */
export function viewerPathFor(doc: { name?: string; mimeType?: string }): ViewerPath | null {
  const name = (doc.name || "").toLowerCase();
  const mime = (doc.mimeType || "").toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "/pdf-viewer";
  if (mime.includes("epub") || name.endsWith(".epub")) return "/epub-viewer";
  if (mime.includes("wordprocessingml") || name.endsWith(".docx")) return "/docx-viewer";
  if (mime.includes("presentationml") || name.endsWith(".pptx") || name.endsWith(".ppt")) return "/ppt-viewer";
  return null;
}

/**
 * Route params for opening a viewer at a citation. The URI is wrapped in
 * encodeURIComponent, matching library.tsx, because expo-router decodes one
 * layer and SAF URIs break without it.
 */
export function buildCitationParams(doc: CitationDocument, citation: AICitation): Record<string, string> {
  const type: AILocatorType =
    citation.locator?.type ?? locatorTypeForDocument({ name: doc.name, mimeType: doc.mimeType });
  return {
    uri: encodeURIComponent(doc.uri),
    name: doc.name,
    locatorType: type,
    locatorIndex: String(citation.locator?.index ?? citation.page),
    quote: (citation.quote || "").slice(0, 300),
  };
}

export interface LocatorParams {
  locatorType: AILocatorType;
  index: number;
  quote: string;
}

type ParamValue = string | string[] | undefined;

/** Read the optional viewer params. Missing or invalid → null (today's behavior). */
export function parseLocatorParams(params: {
  locatorType?: ParamValue;
  locatorIndex?: ParamValue;
  quote?: ParamValue;
}): LocatorParams | null {
  const first = (v: ParamValue) => (Array.isArray(v) ? v[0] : v);
  const type = first(params.locatorType);
  const index = Number(first(params.locatorIndex));
  if (!isLocatorType(type) || !Number.isFinite(index) || index < 1) return null;
  const quote = first(params.quote);
  return { locatorType: type, index: Math.floor(index), quote: typeof quote === "string" ? quote : "" };
}

/** Handle a citation tap. Never throws. */
export async function navigateToCitation(citation: AICitation, ctx: CitationContext): Promise<void> {
  const label = citationLabel(citation);
  try {
    if (ctx.source === "reader-panel") {
      _panel?.shrinkToPeek();
      _panel?.showSourceCard({ label, quote: citation.quote, citation });
      if (_reader) await _reader.navigate(citation);
      return;
    }

    const doc = ctx.document;
    const path = doc?.uri ? viewerPathFor(doc) : null;
    if (!doc || !path) {
      Alert.alert(label, citation.quote ? `“${citation.quote}”` : "This is where the answer came from.");
      return;
    }
    const { router } = require("expo-router");
    router.push({ pathname: path, params: buildCitationParams(doc, citation) });
  } catch (e) {
    console.warn("[citationNavigator] navigation failed:", e);
  }
}
