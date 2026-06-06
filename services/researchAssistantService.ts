// ============================================
// Autonomous Research Assistant (suggestions engine)
// ============================================
// Turns the studio editor into an active collaborator. As the user writes,
// this surfaces — on demand, never auto-editing the document — :
//   • Related notes from the notebook
//   • Related documents from the library (knowledge graph)
//   • Discovered topics in the draft
//   • A suggested outline (AI, with a local fallback)
//   • A reference list drawn from the user's own library
//   • A draft table for a given prompt (AI, with a local fallback)
//
// SECONDARY / additive: read-only over existing services + optional AI that
// degrades gracefully. Returns suggestions; the UI decides what (if anything)
// to insert. Never throws.
// ============================================

import {
  getRelatedDocumentsByText,
  type RelatedDocument,
} from "@/services/knowledgeGraphService";
import { getNotebookNotesForGraph } from "@/services/workspaceInsightsService";
import { parseListReply, quickChat } from "@/services/ai/quickChat";
import {
  keywordSet,
  sharedKeywords,
  stripExtension,
  topKeywords,
} from "@/utils/keywords";

export interface RelatedNoteSuggestion {
  id: string;
  text: string;
  /** Number of concept words shared with the draft. */
  score: number;
}

export interface ResearchSuggestions {
  /** Topics detected in the draft. */
  topics: string[];
  relatedNotes: RelatedNoteSuggestion[];
  relatedDocuments: RelatedDocument[];
  /** Suggested section headings. */
  outline: string[];
  /** Reference lines built from the user's own related documents. */
  references: string[];
  /** Whether AI contributed to the outline (false = local fallback). */
  usedAI: boolean;
}

/** First non-empty line of the draft, used as the working title/topic. */
function leadTopic(draft: string): string {
  const line = (draft || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, 160) : "";
}

/** A reasonable scholarly outline when AI isn't available. */
function localOutline(topic: string): string[] {
  const subject = topic || "the topic";
  return [
    "Introduction",
    `Background on ${subject}`,
    "Literature Review",
    "Methodology",
    "Findings & Analysis",
    "Discussion",
    "Conclusion",
    "References",
  ];
}

/**
 * Gather research suggestions for the current draft. Pure read + optional AI;
 * returns empty-ish suggestions rather than throwing on any failure.
 */
export async function getResearchSuggestions(
  draftText: string,
  opts: { signal?: AbortSignal; includeOutline?: boolean } = {},
): Promise<ResearchSuggestions> {
  const topic = leadTopic(draftText);
  const draftKw = keywordSet(draftText);
  const topics = topKeywords(draftText, 8);

  const [notes, relatedDocuments] = await Promise.all([
    getNotebookNotesForGraph().catch(() => []),
    getRelatedDocumentsByText(draftText).catch(() => [] as RelatedDocument[]),
  ]);

  const relatedNotes: RelatedNoteSuggestion[] = notes
    .map((n) => ({
      id: n.id,
      text: n.text,
      score: sharedKeywords(draftKw, keywordSet(n.text)).length,
    }))
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // References drawn from the user's own related library documents.
  const references = relatedDocuments
    .slice(0, 8)
    .map((d) => stripExtension(d.name));

  // Outline: AI when available, otherwise a sensible local scaffold.
  let outline: string[] = localOutline(topic);
  let usedAI = false;
  if (opts.includeOutline !== false && topic) {
    const generated = await generateOutline(topic, opts.signal);
    if (generated.usedAI && generated.outline.length > 0) {
      outline = generated.outline;
      usedAI = true;
    }
  }

  return { topics, relatedNotes, relatedDocuments, outline, references, usedAI };
}

/**
 * Generate a section outline for a topic. AI-first with a local fallback.
 */
export async function generateOutline(
  topic: string,
  signal?: AbortSignal,
): Promise<{ outline: string[]; usedAI: boolean }> {
  const subject = (topic || "").trim();
  if (!subject) return { outline: [], usedAI: false };

  const prompt =
    `Create a concise document outline for a piece about:\n"${subject}"\n\n` +
    `Return 6-9 section headings only, one per line, no numbering, no description.`;

  const reply = await quickChat(prompt, { signal, timeoutMs: 15_000 });
  if (!reply) return { outline: localOutline(subject), usedAI: false };

  const headings = parseListReply(reply, 9);
  if (headings.length === 0) return { outline: localOutline(subject), usedAI: false };
  return { outline: headings, usedAI: true };
}

/**
 * Generate a simple draft table for a prompt, as rows of cells.
 * AI-first; falls back to a minimal 2-column scaffold the user can fill in.
 */
export async function generateTable(
  prompt: string,
  signal?: AbortSignal,
): Promise<{ rows: string[][]; usedAI: boolean }> {
  const subject = (prompt || "").trim();
  const fallback: string[][] = [
    ["Item", "Detail"],
    ["", ""],
    ["", ""],
  ];
  if (!subject) return { rows: fallback, usedAI: false };

  const ask =
    `Create a small comparison/summary table for:\n"${subject}"\n\n` +
    `Return CSV only (comma-separated), first row = headers, 3-6 rows total, ` +
    `no commentary, no code fences.`;

  const reply = await quickChat(ask, { signal, timeoutMs: 15_000 });
  if (!reply) return { rows: fallback, usedAI: false };

  const rows = reply
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes(","))
    .slice(0, 8)
    .map((line) => line.split(",").map((c) => c.trim()));

  if (rows.length < 2) return { rows: fallback, usedAI: false };
  return { rows, usedAI: true };
}
