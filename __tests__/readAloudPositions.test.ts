/**
 * readAloudPositions.test.ts
 * A saved reading position has to survive a change in how text is chunked.
 *
 * Chunks used to be one sentence each; they now pack several sentences into
 * one utterance so speech doesn't stop and restart after every full stop.
 * Positions saved before that change count sentences, and must be mapped onto
 * the packed layout exactly — not dropped, and not left pointing at the wrong
 * part of the book.
 */

import { act, renderHook } from "@testing-library/react-native";

import { useReadAloud } from "@/hooks/useReadAloud";
import { readAloudPersistence } from "@/services/readAloudPersistence";
import { CHUNK_LAYOUT_VERSION, type TextChunk } from "@/utils/chunkText";

jest.mock("expo-speech", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn(async () => false),
  getAvailableVoicesAsync: jest.fn(async () => []),
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {}),
  maxSpeechInputLength: 4000,
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

/** Three packed chunks holding sentences 0–2, 3–4 and 5–7. */
const PACKED: TextChunk[] = [
  { text: "One. Two. Three.", pageIndex: 0, chunkIndex: 0, sentenceCount: 3 },
  { text: "Four. Five.", pageIndex: 0, chunkIndex: 1, sentenceCount: 2 },
  { text: "Six. Seven. Eight.", pageIndex: 1, chunkIndex: 2, sentenceCount: 3 },
];

/** Let the hook's async restore and default resolution land. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {});
  }
}

describe("restoring a saved position", () => {
  it("maps a position saved one sentence per chunk onto packed chunks", async () => {
    await readAloudPersistence.saveState({
      documentId: "legacy-book",
      chunkIndex: 4, // "Five." under the old layout
      status: "paused",
      rate: 1,
      timestamp: Date.now(),
    });

    const { result } = renderHook(() =>
      useReadAloud({ chunks: PACKED, documentId: "legacy-book" }),
    );
    await flush();

    expect(result.current.currentChunkIndex).toBe(1);
    expect(result.current.status).toBe("paused");
  });

  it("restores a current-layout position exactly as saved", async () => {
    await readAloudPersistence.saveState({
      documentId: "current-book",
      chunkIndex: 2,
      chunkLayout: CHUNK_LAYOUT_VERSION,
      status: "paused",
      rate: 1,
      timestamp: Date.now(),
    });

    const { result } = renderHook(() =>
      useReadAloud({ chunks: PACKED, documentId: "current-book" }),
    );
    await flush();

    expect(result.current.currentChunkIndex).toBe(2);
  });

  it("waits for streamed text rather than restoring to the wrong place", async () => {
    await readAloudPersistence.saveState({
      documentId: "streaming-book",
      chunkIndex: 7, // "Eight." — on page two, not loaded yet
      status: "paused",
      rate: 1,
      timestamp: Date.now(),
    });

    let chunks = PACKED.slice(0, 2);
    const { result, rerender } = renderHook(() =>
      useReadAloud({ chunks, documentId: "streaming-book" }),
    );
    await flush();
    expect(result.current.currentChunkIndex).toBe(0);

    chunks = PACKED;
    rerender({});
    await flush();
    expect(result.current.currentChunkIndex).toBe(2);
  });

  it("records the chunk layout with every save", async () => {
    const spy = jest.spyOn(readAloudPersistence, "saveState");
    const { result } = renderHook(() =>
      useReadAloud({ chunks: PACKED, documentId: "new-book" }),
    );
    await flush();

    act(() => result.current.setRate(1.1));
    await flush();

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ chunkLayout: CHUNK_LAYOUT_VERSION }),
    );
    spy.mockRestore();
  });
});
