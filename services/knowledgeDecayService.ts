// ============================================
// Knowledge Decay / Personal Knowledge Memory
// ============================================
// Notices forgotten content using spaced-repetition principles. Documents you
// studied heavily but haven't revisited slowly "fade", and resurface for review
// before you forget them entirely.
//
// Model: the Ebbinghaus forgetting curve.
//   retention(t) = exp(-daysSinceReview / memoryStrength)
// where memoryStrength grows with how deeply you engaged (reading progress),
// so a book you finished decays much slower than one you barely opened.
//
// SECONDARY / additive: reads existing reading-progress + file index read-only.
// No new tracking is required — it reuses signals the app already records.
// ============================================

import {
  getAllFiles,
  type UnifiedFileRecord,
} from "@/services/fileIndexService";
import {
  getAllReadingProgress,
  type ReadingProgressEntry,
} from "@/services/readingProgressService";

const DAY_MS = 24 * 60 * 60 * 1000;
const READABLE = new Set(["pdf", "epub", "docx"]);

/** Progress at/below this is treated as "never really studied". */
const MIN_STUDIED_PROGRESS = 0.05;

export interface DecayItem {
  uri: string;
  name: string;
  type: string;
  /** Reading progress 0..1 at last review. */
  progress: number;
  lastReadAt: number;
  /** Days since last review (Infinity if never timestamped). */
  daysSince: number;
  /** Estimated current recall 0..1 (1 = fresh, 0 = forgotten). */
  retention: number;
  /** How worth resurfacing this is 0..1 (higher = review sooner). */
  reviewPriority: number;
}

/**
 * Memory strength in days. A barely-opened doc (progress 0) fades in ~7 days;
 * a fully-studied doc (progress 1) holds for ~37 days before similar decay.
 */
function memoryStrengthDays(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return 7 + p * 30;
}

/** Estimated current recall for a document, per the forgetting curve. */
export function retentionFor(
  progress: number,
  lastReadAt: number,
  now: number = Date.now(),
): number {
  if (!lastReadAt) return 0;
  const days = Math.max(0, (now - lastReadAt) / DAY_MS);
  const strength = memoryStrengthDays(progress);
  return Math.exp(-days / strength);
}

/**
 * Full decay analysis for every studied document, sorted by review priority
 * (most worth resurfacing first).
 */
export async function getKnowledgeDecay(): Promise<DecayItem[]> {
  const [progressMap, files] = await Promise.all([
    getAllReadingProgress().catch(
      () => ({}) as Record<string, ReadingProgressEntry>,
    ),
    getAllFiles().catch(() => [] as UnifiedFileRecord[]),
  ]);

  const byUri = new Map(files.map((f) => [f.uri, f]));
  const now = Date.now();
  const items: DecayItem[] = [];

  for (const [uri, entry] of Object.entries(progressMap)) {
    const file = byUri.get(uri);
    if (!file || !READABLE.has(file.type)) continue;

    const progress = entry.progress ?? 0;
    if (progress <= MIN_STUDIED_PROGRESS) continue; // never really studied

    const lastReadAt = entry.lastReadAt ?? 0;
    const daysSince = lastReadAt ? (now - lastReadAt) / DAY_MS : Infinity;
    const retention = retentionFor(progress, lastReadAt, now);
    // Weight toward material you actually invested time in.
    const learnedWeight = 0.4 + 0.6 * progress;
    const reviewPriority = learnedWeight * (1 - retention);

    items.push({
      uri,
      name: file.name,
      type: file.type,
      progress,
      lastReadAt,
      daysSince,
      retention,
      reviewPriority,
    });
  }

  return items.sort((a, b) => b.reviewPriority - a.reviewPriority);
}

export interface ResurfaceOptions {
  /** Don't resurface anything reviewed more recently than this many days. */
  minDaysSince?: number;
  /** Only resurface items at/above this review priority. */
  minPriority?: number;
  limit?: number;
}

/**
 * Documents worth resurfacing for review — studied before, now fading.
 * Powers the "you studied this heavily a while ago" nudge.
 */
export async function getResurfacedDocuments(
  opts: ResurfaceOptions = {},
): Promise<DecayItem[]> {
  const minDaysSince = opts.minDaysSince ?? 3;
  const minPriority = opts.minPriority ?? 0.25;
  const limit = opts.limit ?? 5;

  const all = await getKnowledgeDecay();
  return all
    .filter((i) => i.daysSince >= minDaysSince && i.reviewPriority >= minPriority)
    .slice(0, limit);
}

/** Map of uri → review priority, for blending into predictive ranking. */
export async function getReviewPriorityMap(): Promise<Map<string, number>> {
  const all = await getKnowledgeDecay();
  return new Map(all.map((i) => [i.uri, i.reviewPriority]));
}
