// ============================================
// Knowledge Graph Engine
// ============================================
// Builds relationships BETWEEN documents instead of treating each file as an
// island. Two documents are linked when they share enough significant concept
// words (derived from their titles). The result powers:
//   • "Related Documents"
//   • Visual knowledge maps (nodes + weighted links)
//   • Automatic topic discovery
//   • Smart navigation
//
// SECONDARY / additive: reads the existing unified file index read-only and
// never mutates app state. Complements (does not replace) the concept graph in
// workspaceInsightsService.buildGraph.
// ============================================

import {
  getAllFiles,
  type UnifiedFileRecord,
} from "@/services/fileIndexService";
import {
  jaccard,
  keywordSet,
  overlapCoefficient,
  sharedKeywords,
  titleKeywords,
} from "@/utils/keywords";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DocNode {
  uri: string;
  name: string;
  type: string;
}

export interface DocLink {
  /** Source document URI. */
  a: string;
  /** Target document URI. */
  b: string;
  /** Connection strength 0..1 (Jaccard over title concepts). */
  weight: number;
  /** Concept words the two documents share. */
  shared: string[];
}

export interface KnowledgeNetwork {
  nodes: DocNode[];
  links: DocLink[];
}

export interface RelatedDocument {
  uri: string;
  name: string;
  type: string;
  /** Relationship strength 0..1. */
  score: number;
  /** Concept words driving the relationship. */
  shared: string[];
}

export interface DiscoveredTopic {
  concept: string;
  docs: DocNode[];
}

// ─── Tuning ───────────────────────────────────────────────────────────────────
const READABLE = new Set(["pdf", "epub", "docx"]);
/** Minimum Jaccard weight for two docs to be considered linked. */
const MIN_LINK_WEIGHT = 0.12;
/** Minimum number of shared concept words for a link. */
const MIN_SHARED = 1;

// ─── Internals ────────────────────────────────────────────────────────────────
interface Indexed {
  rec: UnifiedFileRecord;
  kw: Set<string>;
}

async function readableDocs(): Promise<UnifiedFileRecord[]> {
  try {
    const files = await getAllFiles();
    return files.filter((f) => READABLE.has(f.type));
  } catch {
    return [];
  }
}

function indexDocs(docs: UnifiedFileRecord[]): Indexed[] {
  return docs.map((rec) => ({ rec, kw: titleKeywords(rec.name) }));
}

function toNode(rec: UnifiedFileRecord): DocNode {
  return { uri: rec.uri, name: rec.name, type: rec.type };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full document knowledge network — every node plus the weighted
 * concept links between them. Suitable for rendering a visual knowledge map.
 */
export async function buildKnowledgeNetwork(): Promise<KnowledgeNetwork> {
  const docs = indexDocs(await readableDocs());
  const nodes: DocNode[] = docs.map((d) => toNode(d.rec));
  const links: DocLink[] = [];

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const shared = sharedKeywords(docs[i].kw, docs[j].kw);
      if (shared.length < MIN_SHARED) continue;
      const weight = jaccard(docs[i].kw, docs[j].kw);
      if (weight < MIN_LINK_WEIGHT) continue;
      links.push({ a: docs[i].rec.uri, b: docs[j].rec.uri, weight, shared });
    }
  }

  links.sort((x, y) => y.weight - x.weight);
  return { nodes, links };
}

/**
 * Related documents for one document, ranked by shared-concept strength.
 * Returns an empty list if the document isn't in the library.
 */
export async function getRelatedDocuments(
  targetUri: string,
  limit = 6,
): Promise<RelatedDocument[]> {
  const docs = indexDocs(await readableDocs());
  const target = docs.find((d) => d.rec.uri === targetUri);
  if (!target) return [];

  const out: RelatedDocument[] = [];
  for (const d of docs) {
    if (d.rec.uri === targetUri) continue;
    const shared = sharedKeywords(target.kw, d.kw);
    if (shared.length < MIN_SHARED) continue;
    const score = jaccard(target.kw, d.kw);
    if (score < MIN_LINK_WEIGHT) continue;
    out.push({ uri: d.rec.uri, name: d.rec.name, type: d.rec.type, score, shared });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Find documents related to arbitrary free text — e.g. a draft heading, a note,
 * or a search query. Uses overlap-coefficient so short text still matches.
 */
export async function getRelatedDocumentsByText(
  text: string,
  limit = 6,
): Promise<RelatedDocument[]> {
  const queryKw = keywordSet(text);
  if (queryKw.size === 0) return [];

  const docs = indexDocs(await readableDocs());
  const out: RelatedDocument[] = [];
  for (const d of docs) {
    const shared = sharedKeywords(queryKw, d.kw);
    if (shared.length < MIN_SHARED) continue;
    const score = overlapCoefficient(queryKw, d.kw);
    if (score < MIN_LINK_WEIGHT) continue;
    out.push({ uri: d.rec.uri, name: d.rec.name, type: d.rec.type, score, shared });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Automatic topic discovery: concept words shared by `minDocs`+ documents,
 * each with the documents that mention it. Ranked by how many docs share it.
 */
export async function discoverTopics(
  minDocs = 2,
  limit = 12,
): Promise<DiscoveredTopic[]> {
  const docs = indexDocs(await readableDocs());
  const map = new Map<string, DocNode[]>();

  for (const d of docs) {
    const node = toNode(d.rec);
    for (const w of d.kw) {
      const arr = map.get(w);
      if (arr) arr.push(node);
      else map.set(w, [node]);
    }
  }

  return [...map.entries()]
    .filter(([, ds]) => ds.length >= minDocs)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([concept, ds]) => ({ concept, docs: ds }));
}

/**
 * Degree-centrality of each document (sum of its link weights), normalized
 * 0..1. Well-connected "hub" documents score highest — useful for predictive
 * ranking and smart navigation.
 */
export async function getDocumentCentrality(): Promise<Map<string, number>> {
  const { links } = await buildKnowledgeNetwork();
  const raw = new Map<string, number>();
  for (const l of links) {
    raw.set(l.a, (raw.get(l.a) || 0) + l.weight);
    raw.set(l.b, (raw.get(l.b) || 0) + l.weight);
  }
  let max = 0;
  for (const v of raw.values()) if (v > max) max = v;
  if (max === 0) return raw;
  const norm = new Map<string, number>();
  for (const [uri, v] of raw) norm.set(uri, v / max);
  return norm;
}
