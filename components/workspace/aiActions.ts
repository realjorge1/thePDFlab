// ============================================
// WorkSpace AI actions
// Thin wrappers over the shared AI service used by Smart Notes and the Document
// Studio. Each user-facing call records a workspace AI interaction (for the
// Progress dashboard) and returns clean, ready-to-use output.
// ============================================

import { extractDocumentText, sendChat } from "@/services/ai/ai.service";
import type { AIDocumentRef } from "@/services/ai/ai.types";
import type { UnifiedFileRecord } from "@/services/fileIndexService";
import {
  recordAIInteraction,
  type ConceptInput,
  type WorkspaceInsights,
} from "@/services/workspaceInsightsService";

export type Tone = "formal" | "conversational" | "persuasive" | "academic";

export interface SourceQuote {
  quote: string;
  source: string; // book/chapter attribution
}

// ─── Source text extraction (cached per session) ──────────────────────────────
const textCache = new Map<string, string>();
const MAX_SOURCE_CHARS = 6000;

function toDocRef(file: UnifiedFileRecord): AIDocumentRef {
  return {
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType || "application/octet-stream",
    size: file.size,
  };
}

/** Extract (and cache) a trimmed slice of a source document's text. */
export async function getSourceText(file: UnifiedFileRecord): Promise<string> {
  const cached = textCache.get(file.uri);
  if (cached !== undefined) return cached;
  let text = "";
  try {
    text = await extractDocumentText(toDocRef(file));
  } catch {
    text = "";
  }
  const trimmed = (text || "").slice(0, MAX_SOURCE_CHARS);
  textCache.set(file.uri, trimmed);
  return trimmed;
}

async function buildSourcesContext(sources: UnifiedFileRecord[], perSource = 2500): Promise<string> {
  const parts: string[] = [];
  for (const s of sources.slice(0, 3)) {
    const text = await getSourceText(s);
    if (text.trim()) {
      parts.push(`### Source: "${stripExt(s.name)}"\n${text.slice(0, perSource)}`);
    } else {
      parts.push(`### Source: "${stripExt(s.name)}" (no extractable text)`);
    }
  }
  return parts.join("\n\n");
}

// ─── Tolerant JSON parsing ────────────────────────────────────────────────────
export function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();
  // strip code fences
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // try the whole thing first
  try {
    return JSON.parse(s) as T;
  } catch {
    /* keep going */
  }
  // extract the first balanced array or object
  const startIdx = s.search(/[[{]/);
  if (startIdx < 0) return null;
  const open = s[startIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(startIdx, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ─── Writing assistance ───────────────────────────────────────────────────────

/** Suggest the next section/paragraph for a draft, optionally grounded in sources. */
export async function suggestSection(
  draftText: string,
  sources: UnifiedFileRecord[],
): Promise<string> {
  await recordAIInteraction();
  const ctx = sources.length ? await buildSourcesContext(sources) : "";
  const prompt =
    `You are a writing assistant. Suggest the next section to continue this draft. ` +
    `Write 1–2 well-formed paragraphs in the draft's voice. Output only the prose — ` +
    `no preamble, no headings unless natural.` +
    (ctx ? `\n\nReference material the author has open:\n${ctx}` : "") +
    `\n\nDraft so far:\n"""\n${draftText.slice(-3000) || "(empty draft)"}\n"""`;
  const res = await sendChat(prompt, []);
  return (res.content || "").trim();
}

/** Find the most relevant passages from the active sources for a paragraph. */
export async function findQuotes(
  sources: UnifiedFileRecord[],
  paragraph: string,
): Promise<SourceQuote[]> {
  if (sources.length === 0) return [];
  await recordAIInteraction();
  const ctx = await buildSourcesContext(sources, 3000);
  const prompt =
    `From the source material below, select up to 4 short passages (1–3 sentences each) ` +
    `most relevant to the author's current paragraph. Quote the text verbatim. ` +
    `Reply with ONLY a JSON array of objects: ` +
    `[{"quote":"…","source":"Book title"}]. No prose, no code fences.\n\n` +
    `Author's current paragraph:\n"""\n${paragraph.slice(0, 1200) || "(start of document)"}\n"""\n\n` +
    `Source material:\n${ctx}`;
  const res = await sendChat(prompt, []);
  const parsed = parseJsonLoose<SourceQuote[]>(res.content || "");
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((q) => q && typeof q.quote === "string" && q.quote.trim())
    .map((q) => ({ quote: q.quote.trim(), source: (q.source || "Source").toString().trim() }))
    .slice(0, 4);
}

/** Rewrite text in a target tone, preserving meaning. */
export async function rewriteTone(text: string, tone: Tone): Promise<string> {
  await recordAIInteraction();
  const desc: Record<Tone, string> = {
    formal: "formal and polished",
    conversational: "warm, conversational, and plain-spoken",
    persuasive: "persuasive and confident",
    academic: "academic and precise, with measured hedging",
  };
  const prompt =
    `Rewrite the text below to be ${desc[tone]}. Keep the meaning and any facts identical. ` +
    `Do not add or remove information. Output only the rewritten text.\n\n"""\n${text}\n"""`;
  const res = await sendChat(prompt, []);
  return (res.content || "").trim();
}

/** Bridge two or more active books into a synthesis paragraph. */
export async function synthesizeBooks(sources: UnifiedFileRecord[]): Promise<string> {
  await recordAIInteraction();
  const ctx = await buildSourcesContext(sources, 2200);
  const titles = sources.map((s) => `"${stripExt(s.name)}"`).join(" and ");
  const prompt =
    `The author has these books open: ${titles}. Write one insightful paragraph that ` +
    `connects their ideas — note where they agree, differ, or complement each other. ` +
    `Reference each by title. Output only the paragraph.\n\n${ctx}`;
  const res = await sendChat(prompt, []);
  return (res.content || "").trim();
}

/** Detect the dominant tone of a passage. */
export async function detectTone(text: string): Promise<Tone | null> {
  if (text.trim().length < 40) return null;
  await recordAIInteraction();
  const prompt =
    `Classify the dominant tone of this writing as exactly one of: formal, conversational, ` +
    `persuasive, academic. Reply with only that single word.\n\n"""\n${text.slice(0, 1500)}\n"""`;
  const res = await sendChat(prompt, []);
  const word = (res.content || "").toLowerCase().match(/formal|conversational|persuasive|academic/);
  return (word?.[0] as Tone) ?? null;
}

/** Propose an outline of section headings for the draft / topic. */
export async function suggestOutline(draftText: string, title: string): Promise<string[]> {
  await recordAIInteraction();
  const prompt =
    `Propose a clear section outline (4–7 headings) for a document titled "${title || "Untitled"}". ` +
    `Base it on the draft if present. Reply with ONLY a JSON array of heading strings.\n\n` +
    `Draft:\n"""\n${draftText.slice(0, 2500) || "(empty)"}\n"""`;
  const res = await sendChat(prompt, []);
  const parsed = parseJsonLoose<string[]>(res.content || "");
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((h) => typeof h === "string" && h.trim()).map((h) => h.trim()).slice(0, 8);
}

// ─── Smart Notes ──────────────────────────────────────────────────────────────
export type NoteAction = "expand" | "summarize" | "continue" | "cleanup";

/** Run a Smart-Notes AI action on a note, optionally grounded in a source. */
export async function runNoteAction(
  action: NoteAction,
  noteText: string,
  source?: UnifiedFileRecord,
): Promise<string> {
  await recordAIInteraction();
  const ctx = source ? await getSourceText(source) : "";
  const grounding = ctx
    ? `\n\nGround your answer in this source document ("${stripExt(source!.name)}"):\n"""\n${ctx.slice(0, 3500)}\n"""`
    : "";
  const instructions: Record<NoteAction, string> = {
    expand:
      "Expand these notes into fuller, well-organized prose. Keep every original point; add helpful detail and structure.",
    summarize: "Summarize these notes into a tight set of key bullet points.",
    continue: "Continue these notes naturally — add the next 1–2 paragraphs that logically follow.",
    cleanup:
      "Clean up and organize these rough notes: fix grammar, group related ideas under short headings, and tidy the wording. Keep all information.",
  };
  const prompt = `${instructions[action]} Output only the resulting note text.${grounding}\n\nNotes:\n"""\n${noteText}\n"""`;
  const res = await sendChat(prompt, []);
  return (res.content || "").trim();
}

// ─── Knowledge graph concepts ─────────────────────────────────────────────────
export async function extractConcepts(
  noteTexts: string[],
  bookTitles: string[],
): Promise<ConceptInput[]> {
  if (noteTexts.length === 0 && bookTitles.length === 0) return [];
  await recordAIInteraction();
  const notesBlock = noteTexts.slice(0, 20).map((t, i) => `Note ${i + 1}: ${t.slice(0, 200)}`).join("\n");
  const titlesBlock = bookTitles.slice(0, 30).map((t) => `- ${t}`).join("\n");
  const prompt =
    `Identify 6–12 key concepts/themes that connect the following books and notes. ` +
    `For each concept, list the titles or note phrases it relates to (use words that appear in them). ` +
    `Reply with ONLY a JSON array: [{"name":"Concept","related":["title or phrase", …]}].\n\n` +
    `Books:\n${titlesBlock || "(none)"}\n\nNotes:\n${notesBlock || "(none)"}`;
  const res = await sendChat(prompt, []);
  const parsed = parseJsonLoose<ConceptInput[]>(res.content || "");
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      related: Array.isArray(c.related) ? c.related.filter((r) => typeof r === "string") : [],
    }))
    .slice(0, 12);
}

// ─── Progress: personalized suggestions ───────────────────────────────────────
export async function personalizedSuggestions(insights: WorkspaceInsights): Promise<string[]> {
  await recordAIInteraction();
  const summary =
    `Library: ${insights.booksTotal} books (${insights.booksCompleted} finished, ` +
    `${insights.booksInProgress} in progress). Documents created: ${insights.documentsCreated}. ` +
    `Notes: ${insights.notesCount}. AI interactions this week: ${insights.aiInteractionsThisWeek}. ` +
    `Recently reading: ${insights.recentBooks.map((b) => stripExt(b.name)).slice(0, 3).join(", ") || "nothing yet"}.`;
  const prompt =
    `Based on this reader/writer's activity, give 3 short, specific, encouraging suggestions ` +
    `for what to do next (finish a book, turn notes into a draft, explore a topic, etc.). ` +
    `Reply with ONLY a JSON array of 3 short strings.\n\n${summary}`;
  const res = await sendChat(prompt, []);
  const parsed = parseJsonLoose<string[]>(res.content || "");
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()).slice(0, 3);
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}
