// ============================================
// Saved Pages — ranking
// ---------------------------------------------
// "Most visited" is a BLEND, not a raw openCount sort. A page saved yesterday
// and not yet reopened has openCount === 0; sorting on opens alone buries it
// under pages the user opened twice last month and has since forgotten, which
// is the opposite of useful.
//
// The blend follows services/predictiveRankingService.ts: a WEIGHTS object
// summing to 1 over normalized 0..1 signals. Pure functions, no I/O, so the
// whole thing is unit-testable.
// ============================================

import type { SavedPage } from "@/services/savedPagesTypes";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Signal blend weights (sum to 1).
 *
 * `opens` leads because the feature's promise is "the pages I keep going back
 * to". The two recency terms exist so a brand-new save is visible immediately
 * and a page the user returned to this morning outranks one they last opened
 * in spring.
 */
export const WEIGHTS = {
  /** How often the page has been reopened. */
  opens: 0.45,
  /** How recently it was last reopened. */
  recencyOfOpen: 0.3,
  /** How recently it was saved — surfaces new saves that have no opens yet. */
  recencyOfSave: 0.25,
};

// Why recencyOfSave is 0.25 and not lower: with opens at 0.5, a page opened
// TWICE months ago and never returned to scored exactly level with a page the
// user saved a minute ago (0.5 x 0.4 == 0.2 x 1.0), and won on the tiebreak.
// That is the wrong answer — the user just deliberately saved that page, and
// the old one has decayed to nothing on both recency axes. Moving 0.05 from
// opens to recencyOfSave settles it without disturbing the main ordering: a
// genuinely revisited page still leads, which is what "Most visited" promises.

/** Opens saturate at 5, matching predictiveRankingService's frequencyScore. */
export function opensScore(openCount: number): number {
  if (!openCount || openCount <= 0) return 0;
  return Math.min(1, openCount / 5);
}

/** Exponential decay over ~14 days, matching predictiveRankingService. */
export function decayScore(at: number | null | undefined, now: number): number {
  if (!at || !Number.isFinite(at)) return 0;
  const days = Math.max(0, (now - at) / DAY_MS);
  return Math.exp(-days / 14);
}

export interface SavedPageSignals {
  opens: number;
  recencyOfOpen: number;
  recencyOfSave: number;
}

/** The three normalized signals behind a page's blended score. */
export function signalsFor(page: SavedPage, now: number): SavedPageSignals {
  return {
    opens: opensScore(page.openCount),
    recencyOfOpen: decayScore(page.lastOpenedAt, now),
    recencyOfSave: decayScore(page.createdAt, now),
  };
}

/** Blended 0..1 "how likely is this the page you want" score. */
export function frequentScore(page: SavedPage, now: number = Date.now()): number {
  const s = signalsFor(page, now);
  return (
    s.opens * WEIGHTS.opens +
    s.recencyOfOpen * WEIGHTS.recencyOfOpen +
    s.recencyOfSave * WEIGHTS.recencyOfSave
  );
}

export type SavedPagesSort = "frequent" | "recent" | "added";

/**
 * Total-ordered comparator for a sort mode. Every comparator ends on `id` so
 * the order is stable and total: two pages saved in the same millisecond with
 * identical scores still sort deterministically, and re-sorting the same list
 * never reshuffles it under the user.
 */
export function comparatorFor(
  sort: SavedPagesSort,
  now: number = Date.now(),
): (a: SavedPage, b: SavedPage) => number {
  if (sort === "added") {
    return (a, b) => b.createdAt - a.createdAt || cmpId(a, b);
  }
  if (sort === "recent") {
    // "Recently used": last opened, falling back to when it was saved, so a
    // never-opened page is ordered by its save time rather than pinned last.
    return (a, b) =>
      (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt) ||
      cmpId(a, b);
  }
  return (a, b) => {
    const diff = frequentScore(b, now) - frequentScore(a, now);
    if (Math.abs(diff) > 1e-12) return diff;
    return b.openCount - a.openCount || b.createdAt - a.createdAt || cmpId(a, b);
  };
}

function cmpId(a: SavedPage, b: SavedPage): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sort a copy of `pages`. Never mutates the input. */
export function sortSavedPages(
  pages: SavedPage[],
  sort: SavedPagesSort = "frequent",
  now: number = Date.now(),
): SavedPage[] {
  return [...pages].sort(comparatorFor(sort, now));
}

export interface SavedPageGroup {
  identityKey: string;
  fileName: string;
  fileExt: string;
  pages: SavedPage[];
  /** The group's rank, taken from its best-ranked page under the same sort. */
  topScore: number;
}

/**
 * Group by file, ordering the groups by the chosen sort. A flat list of 200
 * page cards is unreadable; the user's mental model is "the book I keep going
 * back to, and the pages inside it".
 *
 * Group order follows the sort's own comparator applied to each group's best
 * page, so "Most visited" ranks files by their most-visited page rather than
 * by a separate rule the UI would have to explain.
 */
export function groupSavedPages(
  pages: SavedPage[],
  sort: SavedPagesSort = "frequent",
  now: number = Date.now(),
): SavedPageGroup[] {
  const cmp = comparatorFor(sort, now);
  const byKey = new Map<string, SavedPage[]>();
  for (const page of pages) {
    const list = byKey.get(page.identityKey);
    if (list) list.push(page);
    else byKey.set(page.identityKey, [page]);
  }

  const groups: SavedPageGroup[] = [];
  for (const [identityKey, list] of byKey) {
    const sorted = [...list].sort(cmp);
    const head = sorted[0];
    groups.push({
      identityKey,
      fileName: head.fileName,
      fileExt: head.fileExt,
      pages: sorted,
      topScore: frequentScore(head, now),
    });
  }

  // Order groups by their own best page under the active sort.
  groups.sort((a, b) => cmp(a.pages[0], b.pages[0]));
  return groups;
}
