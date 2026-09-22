/**
 * readingSessions.test.ts
 *
 * The four things that decide whether this feature is trustworthy:
 *   1. the day bucket is the LOCAL calendar date, not a UTC ISO slice;
 *   2. the 60-second activity guard, so a phone on a table earns nothing;
 *   3. the partial interval is flushed on background rather than lost;
 *   4. getResumeCandidate's exclusions (finished, too short, file gone).
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockLiveUris = new Map<string, string | null>();

jest.mock("@/services/fileIdentity", () => ({
  resolveIdentityToLiveUri: jest.fn(async (key: string) => mockLiveUris.get(key) ?? null),
}));

const mockProgress: Record<string, unknown> = {};

jest.mock("@/services/readingProgressService", () => ({
  getAllReadingProgress: jest.fn(async () => mockProgress),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  __resetReadingSessionsForTests,
  creditTime,
  endSession,
  flushReadingSessions,
  getDayTotals,
  getFileTotals,
  getResumeCandidate,
  getWindowTotalMs,
  localDayKey,
  MIN_RESUMABLE_MS,
  preloadReadingSessions,
  RETENTION_DAYS,
  startSession,
} from "@/services/readingSessionService";
import { BOOK_DONE } from "@/services/workspaceInsightsService";

const STORAGE_KEY = "@wordsinscribed/reading_sessions_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

const identity = {
  key: "f1_book_x",
  name: "Thermodynamics.pdf",
  ext: "pdf",
  uri: "file:///books/Thermodynamics.pdf",
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockLiveUris.clear();
  for (const k of Object.keys(mockProgress)) delete mockProgress[k];
  __resetReadingSessionsForTests();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("local-day bucketing across a UTC midnight, in a non-UTC zone", () => {
  /**
   * Jest's worker has already used Date by the time a test file loads, so the
   * process timezone is fixed and `process.env.TZ` no longer moves it. These
   * tests therefore pin the LOCAL calendar getters directly, which is exactly
   * the contract under test: localDayKey must read the device's local
   * calendar, and must never be a slice of the UTC ISO string.
   *
   * The instant and the UTC string below are real; only the local-clock
   * readings are forced to the target zone. Verifying this on a real handset
   * (change the device timezone, check the weekday in the resume card) is a
   * device-QA step — see docs/reader-upgrade/QA_CHECKLIST.md.
   */
  function atLocalWallClock(
    utcInstant: Date,
    local: { y: number; m: number; d: number; offsetMinutes: number },
  ): Date {
    const stub = new Date(utcInstant.getTime());
    jest.spyOn(stub, "getFullYear").mockReturnValue(local.y);
    jest.spyOn(stub, "getMonth").mockReturnValue(local.m - 1);
    jest.spyOn(stub, "getDate").mockReturnValue(local.d);
    jest.spyOn(stub, "getTimezoneOffset").mockReturnValue(local.offsetMinutes);
    return stub;
  }

  it("files Friday-evening reading in New York under FRIDAY, not Saturday", () => {
    // 21:30 Friday 2026-09-22 in New York (UTC-4) == 01:30 SATURDAY UTC.
    const instant = new Date(Date.UTC(2026, 8, 23, 1, 30));
    const fridayEvening = atLocalWallClock(instant, {
      y: 2026,
      m: 9,
      d: 22,
      offsetMinutes: 240,
    });

    // The instant really does straddle UTC midnight.
    expect(fridayEvening.toISOString().slice(0, 10)).toBe("2026-09-23");

    // THE ASSERTION: the bucket is the LOCAL date...
    expect(localDayKey(fridayEvening)).toBe("2026-09-22");
    // ...which is precisely what a UTC ISO slice would have got wrong.
    expect(localDayKey(fridayEvening)).not.toBe(
      fridayEvening.toISOString().slice(0, 10),
    );
  });

  it("files early-morning reading in Tokyo under the local day, not the UTC one", () => {
    // 06:00 Wednesday 2026-09-23 in Tokyo (UTC+9) == 21:00 TUESDAY UTC.
    const instant = new Date(Date.UTC(2026, 8, 22, 21, 0));
    const wednesdayMorning = atLocalWallClock(instant, {
      y: 2026,
      m: 9,
      d: 23,
      offsetMinutes: -540,
    });

    expect(wednesdayMorning.toISOString().slice(0, 10)).toBe("2026-09-22");
    expect(localDayKey(wednesdayMorning)).toBe("2026-09-23");
    expect(localDayKey(wednesdayMorning)).not.toBe(
      wednesdayMorning.toISOString().slice(0, 10),
    );
  });

  it("keeps a whole local evening in one bucket even as UTC rolls over", () => {
    // 19:00 and 23:00 local Friday in New York — UTC dates 09-22 and 09-23.
    const early = atLocalWallClock(new Date(Date.UTC(2026, 8, 22, 23, 0)), {
      y: 2026,
      m: 9,
      d: 22,
      offsetMinutes: 240,
    });
    const late = atLocalWallClock(new Date(Date.UTC(2026, 8, 23, 3, 0)), {
      y: 2026,
      m: 9,
      d: 22,
      offsetMinutes: 240,
    });

    expect(early.toISOString().slice(0, 10)).not.toBe(
      late.toISOString().slice(0, 10),
    );
    expect(localDayKey(early)).toBe(localDayKey(late));
    expect(localDayKey(late)).toBe("2026-09-22");
  });

  it("is built from local getters, never from the ISO string", () => {
    // A belt-and-braces guard against someone 'simplifying' localDayKey back
    // into toISOString().slice(0, 10) later.
    const instant = new Date(Date.UTC(2026, 0, 1, 4, 0));
    const localNewYearsEve = atLocalWallClock(instant, {
      y: 2025,
      m: 12,
      d: 31,
      offsetMinutes: 300,
    });
    expect(localDayKey(localNewYearsEve)).toBe("2025-12-31");
  });
});

describe("local-day bucketing", () => {

  it("rolls over at LOCAL midnight", () => {
    const lateFriday = new Date(2026, 8, 22, 23, 59, 59);
    const earlySaturday = new Date(2026, 8, 23, 0, 0, 1);
    expect(localDayKey(lateFriday)).toBe("2026-09-22");
    expect(localDayKey(earlySaturday)).toBe("2026-09-23");
  });

  it("pads single-digit months and days", () => {
    expect(localDayKey(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("credits time into today's local bucket", async () => {
    await startSession(identity);
    await creditTime(90_000, "Page 12");
    await flushReadingSessions();

    const today = await getDayTotals();
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({
      identityKey: identity.key,
      day: localDayKey(),
      ms: 90_000,
      lastPageLabel: "Page 12",
      fileName: "Thermodynamics.pdf",
    });
  });
});

describe("the activity guard and the per-beat cap", () => {
  // The guard itself lives in hooks/useReadingSession (it needs AppState and
  // timers); what the STORE must guarantee is that it never inflates a credit.
  it("caps a single credit at five minutes, like bumpReadingTime", async () => {
    await startSession(identity);
    // A wildly long "elapsed" — e.g. a device that slept.
    await creditTime(6 * 60 * 60 * 1000);
    const totals = await getFileTotals(identity.key);
    expect(totals.totalMs).toBe(5 * 60 * 1000);
  });

  it("ignores zero, negative and non-finite credits", async () => {
    await startSession(identity);
    await creditTime(0);
    await creditTime(-5000);
    await creditTime(Number.NaN);
    const totals = await getFileTotals(identity.key);
    expect(totals.totalMs).toBe(0);
  });

  it("credits nothing when no session is active", async () => {
    await creditTime(60_000);
    expect(await getWindowTotalMs()).toBe(0);
  });

  it("stops crediting the old file after the session ends", async () => {
    await startSession(identity);
    await creditTime(60_000);
    await endSession();
    await creditTime(60_000); // no active session

    const totals = await getFileTotals(identity.key);
    expect(totals.totalMs).toBe(60_000);
  });
});

describe("flush on background", () => {
  it("persists the partial interval rather than losing it", async () => {
    await startSession(identity);
    await creditTime(17_000); // a partial beat, not a whole 20 s one

    // endSession() is what the hook calls on background / blur / unmount.
    await endSession();

    // Read from storage only — prove it actually hit the disk.
    __resetReadingSessionsForTests();
    await preloadReadingSessions();
    const totals = await getFileTotals(identity.key);
    expect(totals.totalMs).toBe(17_000);
  });

  it("keeps the last page label through the flush", async () => {
    await startSession(identity);
    await creditTime(30_000, "Page 41");
    await endSession();

    __resetReadingSessionsForTests();
    await preloadReadingSessions();
    expect((await getFileTotals(identity.key)).lastPageLabel).toBe("Page 41");
  });
});

describe("closing a reader while a credit is still in flight", () => {
  // The exact shape of the crash this reproduces: useReadingSession's cleanup
  // calls creditElapsed() and then endSession() in the SAME tick, so
  // creditTime() is suspended on its internal load() when `active` is nulled.
  // Reading module state after the await threw
  // "Cannot read property 'identityKey' of null" on every reader exit.
  it("does not throw when endSession lands mid-credit", async () => {
    await startSession(identity);

    const credit = creditTime(20_000, "Page 12");
    const end = endSession();

    await expect(Promise.all([credit, end])).resolves.toBeDefined();
  });

  it("still credits the final partial interval to the session that earned it", async () => {
    await startSession(identity);
    await creditTime(20_000);

    // The cleanup order the hook actually uses: credit, then end, unawaited.
    const credit = creditTime(9_000, "Page 12");
    const end = endSession();
    await Promise.all([credit, end]);

    await flushReadingSessions();
    __resetReadingSessionsForTests();
    await preloadReadingSessions();

    const totals = await getFileTotals(identity.key);
    expect(totals.totalMs).toBe(29_000);
    expect(totals.lastPageLabel).toBe("Page 12");
  });

  it("credits nothing once the session has fully ended", async () => {
    await startSession(identity);
    await creditTime(20_000);
    await endSession();

    await creditTime(60_000);

    expect((await getFileTotals(identity.key)).totalMs).toBe(20_000);
  });
});

describe("90-day pruning", () => {
  it("drops rows outside the rolling window on load and keeps the rest", async () => {
    const now = Date.now();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          { identityKey: "old", day: localDayKey(now - (RETENTION_DAYS + 30) * DAY_MS), ms: 111, opens: 1, updatedAt: 1 },
          { identityKey: "edge", day: localDayKey(now - (RETENTION_DAYS - 1) * DAY_MS), ms: 222, opens: 1, updatedAt: 1 },
          { identityKey: "fresh", day: localDayKey(now), ms: 333, opens: 1, updatedAt: 1 },
        ],
      }),
    );

    await preloadReadingSessions();

    expect((await getFileTotals("old")).totalMs).toBe(0);
    expect((await getFileTotals("edge")).totalMs).toBe(222);
    expect((await getFileTotals("fresh")).totalMs).toBe(333);
  });

  it("writes the pruned state back, so the blob cannot grow without bound", async () => {
    const now = Date.now();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          { identityKey: "old", day: localDayKey(now - 400 * DAY_MS), ms: 1, opens: 1, updatedAt: 1 },
          { identityKey: "fresh", day: localDayKey(now), ms: 2, opens: 1, updatedAt: 1 },
        ],
      }),
    );

    await preloadReadingSessions();
    await flushReadingSessions();

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).not.toContain('"old"');
    expect(raw).toContain('"fresh"');
  });

  it("survives a corrupt blob and malformed rows", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "{{{not json");
    await expect(getWindowTotalMs()).resolves.toBe(0);

    __resetReadingSessionsForTests();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          { identityKey: "ok", day: localDayKey(), ms: 5, opens: 1, updatedAt: 1 },
          { identityKey: "bad-day", day: "not-a-date", ms: 99, opens: 1, updatedAt: 1 },
          { day: localDayKey(), ms: 99 },
          null,
        ],
      }),
    );
    expect(await getWindowTotalMs()).toBe(5);
  });
});

describe("getResumeCandidate exclusions", () => {
  async function seed(bucket: Record<string, unknown>) {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          {
            identityKey: identity.key,
            day: localDayKey(),
            ms: 40 * 60 * 1000,
            opens: 2,
            fileName: identity.name,
            fileExt: "pdf",
            lastPageLabel: "Page 88",
            updatedAt: Date.now(),
            ...bucket,
          },
        ],
      }),
    );
    __resetReadingSessionsForTests();
  }

  it("returns the file with a plausible minute count and the right day", async () => {
    await seed({});
    mockLiveUris.set(identity.key, identity.uri);
    mockProgress[identity.uri] = {
      progress: 0.42,
      lastReadAt: Date.now(),
      currentPage: 88,
      totalPages: 210,
      source: "pdf",
    };

    const candidate = await getResumeCandidate();
    expect(candidate).not.toBeNull();
    expect(candidate!.fileName).toBe("Thermodynamics.pdf");
    expect(Math.round(candidate!.ms / 60000)).toBe(40);
    expect(candidate!.day).toBe(localDayKey());
    expect(candidate!.currentPage).toBe(88);
    expect(candidate!.lastPageLabel).toBe("Page 88");
    expect(candidate!.uri).toBe(identity.uri);
  });

  it("excludes a book finished past the shared BOOK_DONE threshold", async () => {
    await seed({});
    mockLiveUris.set(identity.key, identity.uri);
    mockProgress[identity.uri] = { progress: BOOK_DONE, lastReadAt: Date.now(), source: "pdf" };

    await expect(getResumeCandidate()).resolves.toBeNull();
  });

  it("includes a book just below the threshold", async () => {
    await seed({});
    mockLiveUris.set(identity.key, identity.uri);
    mockProgress[identity.uri] = { progress: BOOK_DONE - 0.01, lastReadAt: Date.now(), source: "pdf" };

    await expect(getResumeCandidate()).resolves.not.toBeNull();
  });

  it("excludes a session under two minutes", async () => {
    await seed({ ms: MIN_RESUMABLE_MS - 1 });
    mockLiveUris.set(identity.key, identity.uri);
    mockProgress[identity.uri] = { progress: 0.3, lastReadAt: Date.now(), source: "pdf" };

    await expect(getResumeCandidate()).resolves.toBeNull();
  });

  it("excludes a file that no longer resolves", async () => {
    await seed({});
    mockLiveUris.set(identity.key, null); // deleted from app and device
    mockProgress[identity.uri] = { progress: 0.3, lastReadAt: Date.now(), source: "pdf" };

    await expect(getResumeCandidate()).resolves.toBeNull();
  });

  it("returns null when nothing has been read", async () => {
    await expect(getResumeCandidate()).resolves.toBeNull();
  });

  it("skips excluded candidates and returns the next eligible one", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          {
            identityKey: "finished",
            day: localDayKey(),
            ms: 60 * 60 * 1000,
            opens: 3,
            fileName: "Done.pdf",
            fileExt: "pdf",
            updatedAt: Date.now(),
          },
          {
            identityKey: identity.key,
            day: localDayKey(),
            ms: 10 * 60 * 1000,
            opens: 1,
            fileName: identity.name,
            fileExt: "pdf",
            updatedAt: Date.now(),
          },
        ],
      }),
    );
    __resetReadingSessionsForTests();

    mockLiveUris.set("finished", "file:///books/Done.pdf");
    mockLiveUris.set(identity.key, identity.uri);
    mockProgress["file:///books/Done.pdf"] = { progress: 0.99, lastReadAt: Date.now(), source: "pdf" };
    mockProgress[identity.uri] = { progress: 0.2, lastReadAt: Date.now(), source: "pdf" };

    const candidate = await getResumeCandidate();
    expect(candidate!.fileName).toBe("Thermodynamics.pdf");
  });

  it("finds progress saved under an older URI after a re-download", async () => {
    await seed({});
    // The file now lives somewhere new...
    mockLiveUris.set(identity.key, "file:///new/Thermodynamics.pdf");
    // ...but its reading progress was saved under the old path.
    mockProgress["file:///old/Thermodynamics.pdf"] = {
      progress: 0.5,
      lastReadAt: Date.now(),
      currentPage: 120,
      totalPages: 240,
      source: "pdf",
    };

    const candidate = await getResumeCandidate();
    expect(candidate).not.toBeNull();
    expect(candidate!.currentPage).toBe(120);
    expect(candidate!.uri).toBe("file:///new/Thermodynamics.pdf");
  });

  it("prefers the most recent day", async () => {
    const now = Date.now();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          {
            identityKey: "older",
            day: localDayKey(now - 3 * DAY_MS),
            ms: 60 * 60 * 1000,
            opens: 1,
            fileName: "Older.pdf",
            fileExt: "pdf",
            updatedAt: now - 3 * DAY_MS,
          },
          {
            identityKey: "newer",
            day: localDayKey(now),
            ms: 5 * 60 * 1000,
            opens: 1,
            fileName: "Newer.pdf",
            fileExt: "pdf",
            updatedAt: now,
          },
        ],
      }),
    );
    __resetReadingSessionsForTests();
    mockLiveUris.set("older", "file:///a/Older.pdf");
    mockLiveUris.set("newer", "file:///a/Newer.pdf");

    const candidate = await getResumeCandidate();
    expect(candidate!.fileName).toBe("Newer.pdf");
  });
});

describe("totals", () => {
  it("accumulates across days for one file", async () => {
    const now = Date.now();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        buckets: [
          { identityKey: "k", day: localDayKey(now - 2 * DAY_MS), ms: 1000, opens: 1, updatedAt: now - 2 * DAY_MS },
          { identityKey: "k", day: localDayKey(now - 1 * DAY_MS), ms: 2000, opens: 1, updatedAt: now - DAY_MS },
          { identityKey: "k", day: localDayKey(now), ms: 3000, opens: 1, lastPageLabel: "Page 7", updatedAt: now },
        ],
      }),
    );
    __resetReadingSessionsForTests();

    const totals = await getFileTotals("k");
    expect(totals.totalMs).toBe(6000);
    expect(totals.days).toBe(3);
    expect(totals.lastDay).toBe(localDayKey(now));
    expect(totals.lastPageLabel).toBe("Page 7");
  });

  it("reports zero for an untracked file", async () => {
    const totals = await getFileTotals("never-read");
    expect(totals.totalMs).toBe(0);
    expect(totals.days).toBe(0);
    expect(totals.lastDay).toBeNull();
  });

  it("separates two files read on the same day", async () => {
    await startSession({ ...identity, key: "a", name: "A.pdf" });
    await creditTime(10_000);
    await startSession({ ...identity, key: "b", name: "B.pdf" });
    await creditTime(20_000);

    const today = await getDayTotals();
    expect(today).toHaveLength(2);
    expect(today[0].ms).toBe(20_000); // sorted by time spent
    expect((await getFileTotals("a")).totalMs).toBe(10_000);
    expect((await getFileTotals("b")).totalMs).toBe(20_000);
  });
});
