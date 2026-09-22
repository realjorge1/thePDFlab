/**
 * readAloudPlayback.test.ts
 * Covers the playback-preference and sleep-timer behaviour added to the
 * Read Aloud layer — the parts that are pure logic or observable through the
 * hook's public controls, without needing a real TTS engine.
 *
 * expo-speech is mocked at the module boundary so these assertions describe
 * our state machine, not the platform's.
 */

import { act, renderHook } from "@testing-library/react-native";
import { AppState, Platform } from "react-native";

import { useReadAloud } from "@/hooks/useReadAloud";
import { getPitch, setPitch } from "@/services/ttsService";
import type { TextChunk } from "@/utils/chunkText";

// ── Mocks ──────────────────────────────────────────────────────

/** Captures the options of the most recent Speech.speak() call. */
const mockSpeakCalls: { text: string; options: Record<string, unknown> }[] =
  [];

jest.mock("expo-speech", () => ({
  speak: jest.fn((text: string, options: Record<string, unknown>) => {
    mockSpeakCalls.push({ text, options });
  }),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn(async () => false),
  getAvailableVoicesAsync: jest.fn(async () => []),
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {}),
  maxSpeechInputLength: 4000,
}));

/**
 * A handle on the mock so tests can steer it.
 *
 * Fetched rather than closed over: jest.mock factories are hoisted above
 * every declaration in this file, so a `const` referenced from inside one is
 * still in its temporal dead zone when the factory runs.
 */
const mockSpeech = jest.requireMock("expo-speech") as {
  isSpeakingAsync: jest.Mock;
  speak: jest.Mock;
  stop: jest.Mock;
};

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// ── Helpers ────────────────────────────────────────────────────

/**
 * Whether this platform can suspend an utterance rather than stop-and-restart
 * it. The two branches differ in how many utterances a pause/resume costs, so
 * the assertions below state both rather than assuming one.
 */
const NATIVE_PAUSE = Platform.OS === "ios";

/** Two chunks on page 0, two on page 1 — enough to cross a section boundary. */
function makeChunks(): TextChunk[] {
  return [
    { text: "Page one, first sentence.", pageIndex: 0, chunkIndex: 0 },
    { text: "Page one, second sentence.", pageIndex: 0, chunkIndex: 1 },
    { text: "Page two, first sentence.", pageIndex: 1, chunkIndex: 2 },
    { text: "Page two, second sentence.", pageIndex: 1, chunkIndex: 3 },
  ];
}

/**
 * Flush the microtask queue inside act().
 *
 * The hook resolves global reading defaults asynchronously once per document;
 * letting that land before asserting keeps React from warning about state
 * updates outside act().
 */
async function settle(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  mockSpeakCalls.length = 0;
  jest.clearAllMocks();
  setPitch(1.0);
});

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

describe("ttsService pitch", () => {
  it("clamps to the engine-supported 0.5 – 2.0 range", async () => {
    setPitch(5);
    expect(getPitch()).toBe(2.0);

    setPitch(0.01);
    expect(getPitch()).toBe(0.5);

    setPitch(1.25);
    expect(getPitch()).toBe(1.25);
  });
});

describe("useReadAloud pitch", () => {
  it("exposes pitch and reports the clamped value back to the UI", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    expect(result.current.pitch).toBe(1.0);

    act(() => result.current.setPitch(1.25));
    expect(result.current.pitch).toBe(1.25);

    // Out-of-range requests settle at the clamp rather than the raw input.
    act(() => result.current.setPitch(99));
    expect(result.current.pitch).toBe(2.0);
  });

  it("passes the current pitch to the speech engine", async () => {
    jest.useFakeTimers();
    try {
      const chunks = makeChunks();
      const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

      act(() => result.current.setPitch(0.75));
      act(() => result.current.play(0));
      // speakAt() defers the utterance by 50 ms to let the previous stop land.
      act(() => jest.advanceTimersByTime(60));

      expect(mockSpeakCalls.length).toBeGreaterThan(0);
      expect(mockSpeakCalls[mockSpeakCalls.length - 1].options.pitch).toBe(0.75);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Sleep timer
// ---------------------------------------------------------------------------

describe("useReadAloud sleep timer", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("counts down a minute at a time and pauses playback at zero", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    expect(result.current.status).toBe("speaking");

    act(() => result.current.setSleepTimer(3));
    expect(result.current.sleepTimerMinutesLeft).toBe(3);

    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current.sleepTimerMinutesLeft).toBe(2);

    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current.sleepTimerMinutesLeft).toBe(1);

    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current.sleepTimerMinutesLeft).toBeNull();
    // Paused through the state machine, so the position is kept, not reset.
    expect(result.current.status).toBe("paused");
    expect(result.current.currentChunkIndex).toBe(0);
  });

  it("keeps running across a manual pause", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setSleepTimer(30));
    act(() => result.current.pause());

    expect(result.current.sleepTimerMinutesLeft).toBe(30);

    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current.sleepTimerMinutesLeft).toBe(29);
  });

  it("is cancelled by stop()", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setSleepTimer(30));
    act(() => result.current.setSleepAtSectionEnd(true));
    act(() => result.current.stop());

    expect(result.current.sleepTimerMinutesLeft).toBeNull();
    expect(result.current.sleepAtSectionEnd).toBe(false);

    // No lingering ticker.
    act(() => jest.advanceTimersByTime(5 * 60_000));
    expect(result.current.sleepTimerMinutesLeft).toBeNull();
  });

  it("is cancellable by passing null", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setSleepTimer(45));
    expect(result.current.sleepTimerMinutesLeft).toBe(45);

    act(() => result.current.setSleepTimer(null));
    expect(result.current.sleepTimerMinutesLeft).toBeNull();

    act(() => jest.advanceTimersByTime(5 * 60_000));
    expect(result.current.sleepTimerMinutesLeft).toBeNull();
  });

  it("leaves no interval running after unmount", async () => {
    const chunks = makeChunks();
    const { result, unmount } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setSleepTimer(15));
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    unmount();
    // The 60 s ticker must be gone; any other pending timer would keep firing.
    act(() => jest.advanceTimersByTime(10 * 60_000));
    expect(jest.getTimerCount()).toBe(0);
  });

  it("pauses at a section boundary when 'end of section' is armed", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setSleepAtSectionEnd(true));

    // Start on the last chunk of page 0, then let the utterance complete.
    act(() => result.current.play(1));
    act(() => jest.advanceTimersByTime(60));
    expect(result.current.status).toBe("speaking");

    const done = mockSpeakCalls[mockSpeakCalls.length - 1].options.onDone as () => void;
    act(() => done());

    // Parked at the first chunk of page 1, paused rather than reading on.
    expect(result.current.status).toBe("paused");
    expect(result.current.currentChunkIndex).toBe(2);
    expect(result.current.currentPageIndex).toBe(1);
    // One-shot: disarmed so the next play() isn't cut short again.
    expect(result.current.sleepAtSectionEnd).toBe(false);
  });

  it("reads straight through a section boundary when not armed", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(1));
    act(() => jest.advanceTimersByTime(60));

    const done = mockSpeakCalls[mockSpeakCalls.length - 1].options.onDone as () => void;
    act(() => done());
    act(() => jest.advanceTimersByTime(60));

    expect(result.current.status).toBe("speaking");
    expect(result.current.currentChunkIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

describe("useReadAloud pause and resume", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resumes in place instead of restarting the chunk", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    expect(mockSpeakCalls).toHaveLength(1);

    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");

    await act(async () => {
      result.current.play();
    });
    act(() => jest.advanceTimersByTime(60));

    expect(result.current.status).toBe("speaking");
    expect(result.current.currentChunkIndex).toBe(0);
    // A native suspend needs no new utterance; the offset strategy re-speaks
    // the remainder, which here is the whole chunk since no boundary arrived.
    expect(mockSpeakCalls).toHaveLength(NATIVE_PAUSE ? 1 : 2);
  });

  it("still auto-advances after a pause and resume", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));

    act(() => result.current.pause());
    await act(async () => {
      result.current.play();
    });
    act(() => jest.advanceTimersByTime(60));

    const done = mockSpeakCalls[mockSpeakCalls.length - 1].options.onDone as () => void;
    act(() => done());
    act(() => jest.advanceTimersByTime(60));

    expect(result.current.currentChunkIndex).toBe(1);
    expect(result.current.status).toBe("speaking");
  });

  it("survives rapid pause/play cycles without stacking or skipping", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    const baseline = mockSpeakCalls.length;

    for (let i = 0; i < 3; i++) {
      act(() => result.current.pause());
            await act(async () => {
        result.current.play();
      });
      act(() => jest.advanceTimersByTime(60));
    }
    // Let every deferred safety-pause land.
    act(() => jest.advanceTimersByTime(500));

    expect(result.current.status).toBe("speaking");
    expect(result.current.currentChunkIndex).toBe(0);
    expect(mockSpeakCalls).toHaveLength(NATIVE_PAUSE ? baseline : baseline + 3);
  });

  it("does not resume after a stop", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    act(() => result.current.pause());
    act(() => result.current.stop());

    expect(result.current.status).toBe("idle");
    expect(result.current.currentChunkIndex).toBe(0);

    act(() => jest.advanceTimersByTime(500));
    expect(result.current.status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Inter-paragraph pause
// ---------------------------------------------------------------------------

describe("useReadAloud paragraph pause", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Two chunks where the second opens a new paragraph. */
  function paragraphChunks(): TextChunk[] {
    return [
      { text: "End of the first paragraph.", pageIndex: 0, chunkIndex: 0 },
      {
        text: "Start of the second.",
        pageIndex: 0,
        chunkIndex: 1,
        startsParagraph: true,
      },
    ];
  }

  it("holds silence before a chunk that opens a paragraph", async () => {
    const chunks = paragraphChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setParagraphPauseMs(600));
    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    expect(mockSpeakCalls).toHaveLength(1);

    const done = mockSpeakCalls[0].options.onDone as () => void;
    act(() => done());

    // Mid-gap: nothing new spoken, but playback has not "paused".
    act(() => jest.advanceTimersByTime(300));
    expect(mockSpeakCalls).toHaveLength(1);
    expect(result.current.status).toBe("speaking");

    // Gap elapses, then speakAt's own 50 ms settle.
    act(() => jest.advanceTimersByTime(400));
    act(() => jest.advanceTimersByTime(60));
    expect(mockSpeakCalls).toHaveLength(2);
    expect(result.current.currentChunkIndex).toBe(1);
  });

  it("advances immediately when the pause is off", async () => {
    const chunks = paragraphChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    expect(result.current.paragraphPauseMs).toBe(0);
    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));

    const done = mockSpeakCalls[0].options.onDone as () => void;
    act(() => done());
    act(() => jest.advanceTimersByTime(60));

    expect(mockSpeakCalls).toHaveLength(2);
  });

  it("drops a pending gap when the user pauses inside it", async () => {
    const chunks = paragraphChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setParagraphPauseMs(1000));
    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));

    const done = mockSpeakCalls[0].options.onDone as () => void;
    act(() => done());
    act(() => result.current.pause());

    act(() => jest.advanceTimersByTime(3000));
    expect(mockSpeakCalls).toHaveLength(1);
    expect(result.current.status).toBe("paused");
  });

  it("clamps the pause to the supported range", async () => {
    const chunks = paragraphChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setParagraphPauseMs(9999));
    expect(result.current.paragraphPauseMs).toBe(2000);

    act(() => result.current.setParagraphPauseMs(-50));
    expect(result.current.paragraphPauseMs).toBe(0);
  });

  it("leaves no pending gap after unmount", async () => {
    const chunks = paragraphChunks();
    const { result, unmount } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.setParagraphPauseMs(1000));
    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    const done = mockSpeakCalls[0].options.onDone as () => void;
    act(() => done());

    unmount();
    act(() => jest.advanceTimersByTime(5000));
    expect(jest.getTimerCount()).toBe(0);
    expect(mockSpeakCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

describe("useReadAloud app lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Drive AppState by invoking the listener the hook registered. */
  function emitAppState(state: "active" | "background" | "inactive"): void {
    const calls = (AppState.addEventListener as unknown as jest.Mock).mock.calls;
    for (const [event, handler] of calls) {
      if (event === "change") handler(state);
    }
  }

  it("settles on paused when the engine stopped while backgrounded", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    expect(result.current.status).toBe("speaking");

    // Android tears the TTS engine down with the process.
    mockSpeech.isSpeakingAsync.mockResolvedValue(false);

    act(() => emitAppState("background"));
    await act(async () => {
      emitAppState("active");
    });

    // The bar must not offer Pause on a reader that is silent.
    expect(result.current.status).toBe("paused");
    // Position is kept, so play() picks up where it left off.
    expect(result.current.currentChunkIndex).toBe(0);
  });

  it("leaves playback alone when it survived the background", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));

    // iOS keeps speaking behind the lock screen.
    mockSpeech.isSpeakingAsync.mockResolvedValue(true);

    act(() => emitAppState("background"));
    await act(async () => {
      emitAppState("active");
    });

    expect(result.current.status).toBe("speaking");
  });

  it("does not resurrect a reader the user paused", async () => {
    const chunks = makeChunks();
    const { result } = renderHook(() => useReadAloud({ chunks }));
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));
    act(() => result.current.pause());

    mockSpeech.isSpeakingAsync.mockResolvedValue(false);
    act(() => emitAppState("background"));
    await act(async () => {
      emitAppState("active");
    });

    expect(result.current.status).toBe("paused");
  });

  it("suppresses word boundaries while backgrounded", async () => {
    const onWordBoundary = jest.fn();
    const chunks = makeChunks();
    const { result } = renderHook(() =>
      useReadAloud({ chunks, onWordBoundary }),
    );
    await settle();

    act(() => result.current.play(0));
    act(() => jest.advanceTimersByTime(60));

    const boundary = mockSpeakCalls[0].options.onBoundary as (e: {
      charIndex: number;
      charLength: number;
    }) => void;

    act(() => emitAppState("background"));
    act(() => boundary({ charIndex: 0, charLength: 4 }));
    expect(onWordBoundary).not.toHaveBeenCalled();

    act(() => emitAppState("active"));
    act(() => boundary({ charIndex: 0, charLength: 4 }));
    expect(onWordBoundary).toHaveBeenCalledTimes(1);
  });
});
