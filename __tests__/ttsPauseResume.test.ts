/**
 * ttsPauseResume.test.ts
 * Exercises the two very different things "pause" means underneath
 * ttsService: a real native suspend on iOS, and a stop plus a remembered word
 * offset on Android, which has no pause at any layer.
 *
 * Both react-native's Platform and expo-speech are mocked per test so each
 * platform branch can be driven deterministically from one suite.
 */

import {
  applyPronunciation,
  type PronunciationRule,
} from "@/utils/pronunciation";

type SpeakOptions = {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e: unknown) => void;
  onBoundary?: (e: { charIndex: number; charLength: number }) => void;
  [key: string]: unknown;
};

type SpeechMock = {
  calls: { text: string; options: SpeakOptions }[];
  speak: jest.Mock;
  stop: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
  isSpeakingAsync: jest.Mock;
  getAvailableVoicesAsync: jest.Mock;
  maxSpeechInputLength: number;
};

type TtsService = typeof import("@/services/ttsService");

/** "jumps" starts at index 20; "over" at 26. */
const SENTENCE = "The quick brown fox jumps over the lazy dog.";
const JUMPS_AT = SENTENCE.indexOf("jumps");
const TAIL_FROM_JUMPS = SENTENCE.slice(JUMPS_AT);

let speech: SpeechMock;

/**
 * Load a fresh copy of ttsService against a given platform. The service keeps
 * module-level singleton state, so every test needs its own instance.
 */
function load(os: "ios" | "android"): TtsService {
  jest.resetModules();

  const calls: { text: string; options: SpeakOptions }[] = [];
  speech = {
    calls,
    speak: jest.fn((text: string, options: SpeakOptions) => {
      calls.push({ text, options });
    }),
    stop: jest.fn(),
    pause: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    isSpeakingAsync: jest.fn(async () => false),
    getAvailableVoicesAsync: jest.fn(async () => []),
    maxSpeechInputLength: 4000,
  };

  jest.doMock("react-native", () => ({ Platform: { OS: os } }));
  jest.doMock("expo-speech", () => speech);
  jest.doMock("@react-native-async-storage/async-storage", () => ({
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
    removeItem: jest.fn(async () => {}),
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after doMock
  return require("@/services/ttsService") as TtsService;
}

/** Options of the nth Speech.speak() call. */
function optionsOf(n: number): SpeakOptions {
  return speech.calls[n].options;
}

// ---------------------------------------------------------------------------
// Platform capability
// ---------------------------------------------------------------------------

describe("supportsNativePause", () => {
  it("is true on iOS and false on Android", () => {
    expect(load("ios").supportsNativePause()).toBe(true);
    expect(load("android").supportsNativePause()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// iOS — real suspend
// ---------------------------------------------------------------------------

describe("iOS pause/resume", () => {
  it("suspends and continues the same utterance, speaking nothing new", async () => {
    const tts = load("ios");
    tts.speakChunk(SENTENCE);
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    expect(speech.pause).toHaveBeenCalledTimes(1);

    const resumed = await tts.resumeSpeaking();
    expect(resumed).toBe(true);
    expect(speech.resume).toHaveBeenCalledTimes(1);
    // The utterance was never cancelled, so no second speak() was needed.
    expect(speech.calls).toHaveLength(1);
  });

  it("keeps the suspended utterance's onDone alive", async () => {
    const tts = load("ios");
    const onDone = jest.fn();
    tts.speakChunk(SENTENCE, { onDone });

    await tts.pauseSpeaking();
    await tts.resumeSpeaking();

    // The original utterance eventually finishes — its callback is still ours.
    optionsOf(0).onDone?.();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("falls back to the offset strategy when the native pause is refused", async () => {
    const tts = load("ios");
    tts.speakChunk(SENTENCE);
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    speech.pause.mockRejectedValueOnce(new Error("UnavailabilityError"));
    await tts.pauseSpeaking();

    const resumed = await tts.resumeSpeaking();
    expect(resumed).toBe(true);
    expect(speech.resume).not.toHaveBeenCalled();
    expect(speech.calls[1].text).toBe(TAIL_FROM_JUMPS);
  });
});

// ---------------------------------------------------------------------------
// Android — stop plus remembered offset
// ---------------------------------------------------------------------------

describe("Android pause/resume", () => {
  it("never calls the unavailable native pause", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);
    await tts.pauseSpeaking();

    expect(speech.pause).not.toHaveBeenCalled();
    expect(speech.stop).toHaveBeenCalled();
  });

  it("resumes from the last reported word boundary, not the chunk start", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    const resumed = await tts.resumeSpeaking();

    expect(resumed).toBe(true);
    expect(speech.calls).toHaveLength(2);
    expect(speech.calls[1].text).toBe(TAIL_FROM_JUMPS);
  });

  it("backs up to the word start when the engine reports mid-word", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);
    // Two characters into "jumps".
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT + 2, charLength: 3 });

    await tts.pauseSpeaking();
    await tts.resumeSpeaking();

    expect(speech.calls[1].text).toBe(TAIL_FROM_JUMPS);
  });

  it("reuses the paused utterance's callbacks so auto-advance survives", async () => {
    const tts = load("android");
    const onDone = jest.fn();
    tts.speakChunk(SENTENCE, { onDone });
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    await tts.resumeSpeaking();

    optionsOf(1).onDone?.();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports boundaries absolute within the chunk after a resume", async () => {
    const tts = load("android");
    const onBoundary = jest.fn();
    tts.speakChunk(SENTENCE, { onBoundary });
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    await tts.resumeSpeaking();

    // "over" is at offset 6 of the resumed tail, 26 of the whole chunk.
    optionsOf(1).onBoundary?.({ charIndex: 6, charLength: 4 });

    expect(tts.getLastBoundaryCharIndex()).toBe(SENTENCE.indexOf("over"));
    expect(onBoundary).toHaveBeenLastCalledWith({
      charIndex: SENTENCE.indexOf("over"),
      charLength: 4,
    });
  });

  it("discards the stale onDone that Android fires after a stop", async () => {
    const tts = load("android");
    const onDone = jest.fn();
    tts.speakChunk(SENTENCE, { onDone });
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    // Android delivers onDone rather than onStopped after Speech.stop().
    optionsOf(0).onDone?.();

    // Auto-advance must not be triggered by a cancelled utterance.
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Degradation — engines that never report ranges
// ---------------------------------------------------------------------------

describe("engines that report no word boundaries", () => {
  it("reports nothing to resume, so the caller replays the chunk", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);

    await tts.pauseSpeaking();
    const resumed = await tts.resumeSpeaking();

    expect(resumed).toBe(false);
    expect(tts.getLastBoundaryCharIndex()).toBe(0);
    // No second utterance was started behind the caller's back.
    expect(speech.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("pause/resume ordering", () => {
  it("reports nothing to resume when no pause happened", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);
    expect(await tts.resumeSpeaking()).toBe(false);
  });

  it("drops the resume offset when playback is stopped outright", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    tts.stopSpeaking();

    expect(await tts.resumeSpeaking()).toBe(false);
    expect(speech.calls).toHaveLength(1);
  });

  it("survives rapid pause/resume cycles without stacking utterances", async () => {
    const tts = load("android");
    tts.speakChunk(SENTENCE);
    optionsOf(0).onBoundary?.({ charIndex: JUMPS_AT, charLength: 5 });

    await tts.pauseSpeaking();
    await tts.resumeSpeaking();
    // Second cycle: boundaries restart relative to the tail, absolute out.
    optionsOf(1).onBoundary?.({ charIndex: 6, charLength: 4 });
    await tts.pauseSpeaking();
    const resumed = await tts.resumeSpeaking();

    expect(resumed).toBe(true);
    expect(speech.calls).toHaveLength(3);
    expect(speech.calls[2].text).toBe(SENTENCE.slice(SENTENCE.indexOf("over")));
    // A second resume with nothing pending is a no-op, not a repeat.
    expect(await tts.resumeSpeaking()).toBe(false);
    expect(speech.calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Pronunciation × resume
//
// The riskiest interaction in the whole Read Aloud layer: the engine indexes
// into the respelled string, the UI indexes into the visible one, and an
// Android resume slices the former while reporting the latter.
// ---------------------------------------------------------------------------

describe("resume with pronunciation rules active", () => {
  const DISPLAY = "Meet Siobhan today and tomorrow.";
  const RULE: PronunciationRule = {
    id: "r1",
    match: "Siobhan",
    replacement: "Shiv awn",
    wholeWord: true,
    caseSensitive: false,
    enabled: true,
  };

  it("slices the spoken string but reports display offsets", async () => {
    const tts = load("android");
    const spokenText = applyPronunciation(DISPLAY, [RULE]);
    expect(spokenText.spoken).toBe("Meet Shiv awn today and tomorrow.");

    const onBoundary = jest.fn();
    tts.speakSpokenText(spokenText, { onBoundary });

    // The engine is reading the respelled string and reports offsets into it.
    const spokenToday = spokenText.spoken.indexOf("today");
    optionsOf(0).onBoundary?.({ charIndex: spokenToday, charLength: 5 });

    // What leaves the service must already be in display coordinates.
    expect(onBoundary).toHaveBeenLastCalledWith({
      charIndex: DISPLAY.indexOf("today"),
      charLength: 5,
    });

    await tts.pauseSpeaking();
    const resumed = await tts.resumeSpeaking();

    expect(resumed).toBe(true);
    // The engine must receive the respelled tail, not the display tail.
    expect(speech.calls[1].text).toBe(spokenText.spoken.slice(spokenToday));
  });

  it("keeps reporting display offsets after a resume", async () => {
    const tts = load("android");
    const spokenText = applyPronunciation(DISPLAY, [RULE]);
    const onBoundary = jest.fn();
    tts.speakSpokenText(spokenText, { onBoundary });

    const spokenToday = spokenText.spoken.indexOf("today");
    optionsOf(0).onBoundary?.({ charIndex: spokenToday, charLength: 5 });
    await tts.pauseSpeaking();
    await tts.resumeSpeaking();

    // "and" sits 6 characters into the resumed tail "today and tomorrow.".
    optionsOf(1).onBoundary?.({ charIndex: 6, charLength: 3 });

    expect(onBoundary).toHaveBeenLastCalledWith({
      charIndex: DISPLAY.indexOf("and"),
      charLength: 3,
    });
  });

  it("highlights the whole original word while speaking its respelling", async () => {
    const tts = load("android");
    const spokenText = applyPronunciation(DISPLAY, [RULE]);
    const onBoundary = jest.fn();
    tts.speakSpokenText(spokenText, { onBoundary });

    // Engine says "Shiv" — four characters of the eight-character respelling.
    optionsOf(0).onBoundary?.({ charIndex: 5, charLength: 4 });

    // On screen that is the whole of "Siobhan".
    expect(onBoundary).toHaveBeenLastCalledWith({
      charIndex: DISPLAY.indexOf("Siobhan"),
      charLength: "Siobhan".length,
    });
  });
});
