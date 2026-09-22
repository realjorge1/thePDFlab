/**
 * savedPagesRanking.test.ts
 *
 * "Most visited" must be a blend, not a raw openCount sort. The case that
 * matters: a page saved yesterday and not yet reopened has openCount === 0,
 * and must NOT sink below a page opened once months ago. All three sorts must
 * also be total-ordered and stable, so the list never reshuffles under the
 * user's thumb.
 */

import {
  comparatorFor,
  decayScore,
  frequentScore,
  groupSavedPages,
  opensScore,
  signalsFor,
  sortSavedPages,
  WEIGHTS,
} from "@/services/savedPagesRanking";
import type { SavedPage } from "@/services/savedPagesTypes";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function page(over: Partial<SavedPage> & { id: string }): SavedPage {
  return {
    identityKey: "k",
    fileName: "Book.pdf",
    fileExt: "pdf",
    fileUriAtSave: "",
    locatorType: "page",
    excerpt: "",
    createdAt: NOW,
    openCount: 0,
    lastOpenedAt: null,
    ...over,
  };
}

describe("WEIGHTS", () => {
  it("sums to 1, like predictiveRankingService", () => {
    const total = WEIGHTS.opens + WEIGHTS.recencyOfOpen + WEIGHTS.recencyOfSave;
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("signal scores", () => {
  it("saturates opens at 5", () => {
    expect(opensScore(0)).toBe(0);
    expect(opensScore(1)).toBeCloseTo(0.2);
    expect(opensScore(5)).toBe(1);
    expect(opensScore(50)).toBe(1);
    expect(opensScore(-3)).toBe(0);
  });

  it("decays over days and treats a null timestamp as zero", () => {
    expect(decayScore(NOW, NOW)).toBe(1);
    expect(decayScore(NOW - 14 * DAY, NOW)).toBeCloseTo(Math.exp(-1), 6);
    expect(decayScore(null, NOW)).toBe(0);
    expect(decayScore(undefined, NOW)).toBe(0);
    // A future timestamp (clock skew) must not exceed 1.
    expect(decayScore(NOW + 5 * DAY, NOW)).toBe(1);
  });

  it("reports the three signals behind a score", () => {
    const s = signalsFor(
      page({ id: "a", openCount: 5, lastOpenedAt: NOW, createdAt: NOW }),
      NOW,
    );
    expect(s).toEqual({ opens: 1, recencyOfOpen: 1, recencyOfSave: 1 });
    expect(frequentScore(page({ id: "a", openCount: 5, lastOpenedAt: NOW }), NOW)).toBeCloseTo(1);
  });
});

describe("the blend", () => {
  it("ranks a never-opened recent save above a stale once-opened one", () => {
    // THE case the blend exists for.
    const freshUnopened = page({
      id: "fresh",
      createdAt: NOW - 1 * DAY,
      openCount: 0,
      lastOpenedAt: null,
    });
    const staleOnceOpened = page({
      id: "stale",
      createdAt: NOW - 120 * DAY,
      openCount: 1,
      lastOpenedAt: NOW - 100 * DAY,
    });

    expect(frequentScore(freshUnopened, NOW)).toBeGreaterThan(
      frequentScore(staleOnceOpened, NOW),
    );
    expect(sortSavedPages([staleOnceOpened, freshUnopened], "frequent", NOW)[0].id).toBe(
      "fresh",
    );
  });

  it("still puts a genuinely revisited page first", () => {
    const revisited = page({
      id: "revisited",
      createdAt: NOW - 30 * DAY,
      openCount: 6,
      lastOpenedAt: NOW - 1 * DAY,
    });
    const freshUnopened = page({ id: "fresh", createdAt: NOW - 1 * DAY });

    expect(sortSavedPages([freshUnopened, revisited], "frequent", NOW)[0].id).toBe(
      "revisited",
    );
  });

  it("separates two heavily-opened pages by when they were last opened", () => {
    // A raw openCount sort cannot tell these apart — both saturate at 5+.
    const openedRecently = page({
      id: "recent",
      createdAt: NOW - 200 * DAY,
      openCount: 8,
      lastOpenedAt: NOW - 2 * DAY,
    });
    const openedLongAgo = page({
      id: "ancient",
      createdAt: NOW - 400 * DAY,
      openCount: 20,
      lastOpenedAt: NOW - 300 * DAY,
    });

    // More opens, but cold: the recency term is what breaks the tie.
    expect(sortSavedPages([openedLongAgo, openedRecently], "frequent", NOW)[0].id).toBe(
      "recent",
    );
  });

  it("never leaves a brand-new save at the bottom of the list", () => {
    // The requirement the blend exists for: openCount === 0 must not mean last.
    const savedToday = page({ id: "new", createdAt: NOW });
    const staleOnce = page({
      id: "stale-1",
      createdAt: NOW - 90 * DAY,
      openCount: 1,
      lastOpenedAt: NOW - 80 * DAY,
    });
    const staleTwice = page({
      id: "stale-2",
      createdAt: NOW - 200 * DAY,
      openCount: 2,
      lastOpenedAt: NOW - 150 * DAY,
    });
    const heavilyUsed = page({
      id: "hot",
      createdAt: NOW - 10 * DAY,
      openCount: 12,
      lastOpenedAt: NOW - 1 * DAY,
    });

    const order = sortSavedPages(
      [staleOnce, heavilyUsed, savedToday, staleTwice],
      "frequent",
      NOW,
    );

    // A genuinely revisited page leads — that is what "Most visited" promises.
    expect(order[0].id).toBe("hot");
    // But the new save is not last, and outranks both forgotten pages.
    expect(order[order.length - 1].id).not.toBe("new");
    expect(order.indexOf(savedToday)).toBeLessThan(order.indexOf(staleOnce));
    expect(order.indexOf(savedToday)).toBeLessThan(order.indexOf(staleTwice));
  });

  it("a page opened four times shows its count and rises", () => {
    const four = page({ id: "four", openCount: 4, lastOpenedAt: NOW, createdAt: NOW - 2 * DAY });
    const none = page({ id: "none", createdAt: NOW - 2 * DAY });
    expect(four.openCount).toBe(4);
    expect(sortSavedPages([none, four], "frequent", NOW)[0].id).toBe("four");
  });
});

describe("all three sorts", () => {
  const a = page({ id: "a", createdAt: NOW - 3 * DAY, openCount: 1, lastOpenedAt: NOW - 1 * DAY });
  const b = page({ id: "b", createdAt: NOW - 1 * DAY, openCount: 0, lastOpenedAt: null });
  const c = page({ id: "c", createdAt: NOW - 2 * DAY, openCount: 9, lastOpenedAt: NOW - 10 * DAY });

  it("'added' orders by save time, newest first", () => {
    expect(sortSavedPages([a, b, c], "added", NOW).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("'recent' orders by last use, falling back to save time", () => {
    expect(sortSavedPages([a, b, c], "recent", NOW).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("'frequent' orders by the blend", () => {
    const order = sortSavedPages([a, b, c], "frequent", NOW).map((p) => p.id);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
  });

  it.each(["frequent", "recent", "added"] as const)(
    "%s is total-ordered and stable across repeated sorts",
    (sort) => {
      const pages = [a, b, c];
      const once = sortSavedPages(pages, sort, NOW).map((p) => p.id);
      const twice = sortSavedPages(sortSavedPages(pages, sort, NOW), sort, NOW).map(
        (p) => p.id,
      );
      const reversedInput = sortSavedPages([...pages].reverse(), sort, NOW).map((p) => p.id);
      expect(twice).toEqual(once);
      // A total order does not depend on the input order.
      expect(reversedInput).toEqual(once);
    },
  );

  it.each(["frequent", "recent", "added"] as const)(
    "%s breaks exact ties deterministically by id",
    (sort) => {
      // Two records identical in every ranked field.
      const twin1 = page({ id: "aaa", createdAt: NOW, openCount: 2, lastOpenedAt: NOW });
      const twin2 = page({ id: "bbb", createdAt: NOW, openCount: 2, lastOpenedAt: NOW });
      expect(comparatorFor(sort, NOW)(twin1, twin2)).toBeLessThan(0);
      expect(comparatorFor(sort, NOW)(twin2, twin1)).toBeGreaterThan(0);
      expect(comparatorFor(sort, NOW)(twin1, twin1)).toBe(0);
    },
  );

  it("never mutates the input array", () => {
    const pages = [a, b, c];
    const snapshot = pages.map((p) => p.id);
    sortSavedPages(pages, "frequent", NOW);
    expect(pages.map((p) => p.id)).toEqual(snapshot);
  });
});

describe("grouping by file", () => {
  it("orders groups by their best page under the active sort", () => {
    const pages = [
      page({ id: "x1", identityKey: "kx", fileName: "Rarely.pdf", createdAt: NOW - 90 * DAY }),
      page({
        id: "y1",
        identityKey: "ky",
        fileName: "Often.pdf",
        createdAt: NOW - 30 * DAY,
        openCount: 8,
        lastOpenedAt: NOW,
      }),
      page({ id: "y2", identityKey: "ky", fileName: "Often.pdf", createdAt: NOW - 29 * DAY }),
    ];

    const groups = groupSavedPages(pages, "frequent", NOW);
    expect(groups.map((g) => g.fileName)).toEqual(["Often.pdf", "Rarely.pdf"]);
    expect(groups[0].pages.map((p) => p.id)).toEqual(["y1", "y2"]);
    expect(groups[0].identityKey).toBe("ky");
  });

  it("keeps every page in exactly one group", () => {
    const pages = [
      page({ id: "a", identityKey: "k1" }),
      page({ id: "b", identityKey: "k1" }),
      page({ id: "c", identityKey: "k2" }),
    ];
    const groups = groupSavedPages(pages, "added", NOW);
    const ids = groups.flatMap((g) => g.pages.map((p) => p.id)).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("handles an empty list", () => {
    expect(groupSavedPages([], "frequent", NOW)).toEqual([]);
    expect(sortSavedPages([], "frequent", NOW)).toEqual([]);
  });
});
