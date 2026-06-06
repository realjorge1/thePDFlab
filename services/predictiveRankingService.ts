// ============================================
// Predictive Document Ranking
// ============================================
// Predicts which documents the user is most likely to want next by blending
// four signals the app already has:
//   • recency    — how recently it was opened           (file index)
//   • frequency  — how often it's been opened            (context awareness)
//   • review     — spaced-repetition review priority     (knowledge decay)
//   • centrality — how connected it is in the knowledge graph
//
// Powers smart navigation / "pick up where you'll go next" surfaces.
//
// SECONDARY / additive: pure read-only aggregation over existing services.
// ============================================

import {
  getAllFiles,
  type UnifiedFileRecord,
} from "@/services/fileIndexService";
import { getOpenStats } from "@/services/contextAwarenessService";
import { getReviewPriorityMap } from "@/services/knowledgeDecayService";
import { getDocumentCentrality } from "@/services/knowledgeGraphService";

const DAY_MS = 24 * 60 * 60 * 1000;
const READABLE = new Set(["pdf", "epub", "docx"]);

/** Signal blend weights (sum to 1). */
const WEIGHTS = {
  recency: 0.4,
  frequency: 0.25,
  review: 0.2,
  centrality: 0.15,
};

export interface RankedDocument {
  uri: string;
  name: string;
  type: string;
  /** Blended predicted-relevance score 0..1. */
  score: number;
  signals: {
    recency: number;
    frequency: number;
    review: number;
    centrality: number;
  };
}

/** Exponential recency decay over ~14 days. */
function recencyScore(lastOpenedAt: number, now: number): number {
  if (!lastOpenedAt) return 0;
  const days = Math.max(0, (now - lastOpenedAt) / DAY_MS);
  return Math.exp(-days / 14);
}

/** Open-frequency saturating at 5 opens. */
function frequencyScore(count: number): number {
  if (!count || count <= 0) return 0;
  return Math.min(1, count / 5);
}

/**
 * Rank readable library documents by predicted relevance, highest first.
 */
export async function getPredictedDocuments(
  limit = 8,
): Promise<RankedDocument[]> {
  const [files, openStats, reviewMap, centralityMap] = await Promise.all([
    getAllFiles().catch(() => [] as UnifiedFileRecord[]),
    getOpenStats().catch(() => new Map()),
    getReviewPriorityMap().catch(() => new Map()),
    getDocumentCentrality().catch(() => new Map()),
  ]);

  const now = Date.now();
  const ranked: RankedDocument[] = [];

  for (const f of files) {
    if (!READABLE.has(f.type)) continue;

    const recency = recencyScore(f.lastOpenedAt, now);
    const frequency = frequencyScore(openStats.get(f.uri)?.count ?? 0);
    const review = Math.max(0, Math.min(1, reviewMap.get(f.uri) ?? 0));
    const centrality = Math.max(0, Math.min(1, centralityMap.get(f.uri) ?? 0));

    const score =
      recency * WEIGHTS.recency +
      frequency * WEIGHTS.frequency +
      review * WEIGHTS.review +
      centrality * WEIGHTS.centrality;

    if (score <= 0) continue;

    ranked.push({
      uri: f.uri,
      name: f.name,
      type: f.type,
      score,
      signals: { recency, frequency, review, centrality },
    });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}
