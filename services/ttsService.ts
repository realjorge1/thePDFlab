/**
 * ttsService.ts
 * A thin wrapper around expo-speech for the Read Aloud feature.
 *
 * Responsibilities:
 *  - Expose speak / stop / pause / resume / setRate / getVoices helpers
 *  - Forward TTS lifecycle events via callbacks
 *  - Shield the rest of the app from platform differences
 *  - Persist selected voice across sessions via AsyncStorage
 *  - Resolve the bundled voice registry against installed system voices
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { Platform } from "react-native";

import {
    identitySpokenText,
    spokenToDisplayRange,
    type SpokenText,
} from "@/utils/pronunciation";

import {
    BUNDLED_VOICES,
    DEFAULT_LANGUAGE,
    DEFAULT_VOICE_ID,
    type BundledVoice,
    type ResolvedVoice,
} from "./voiceRegistry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TTSStatus = "idle" | "speaking" | "paused" | "error";

export interface TTSCallbacks {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: unknown) => void;
  /**
   * Word-level progress, where supported by the engine.
   *
   * `charIndex` is absolute within the **whole chunk**, and in **display**
   * coordinates. Two details are handled before it gets here, so no consumer
   * has to know about either: after an Android resume the engine is only
   * speaking the tail of a chunk, and when pronunciation rules are active the
   * engine is reading a respelled string of a different length.
   */
  onBoundary?: (event: { charIndex: number; charLength: number }) => void;
}

/** Raw system voice shape from expo-speech. */
interface SystemVoice {
  identifier: string;
  name: string;
  language: string;
  quality: number;
}

// ---------------------------------------------------------------------------
// Persistence key
// ---------------------------------------------------------------------------

const VOICE_STORAGE_KEY = "@wordsinscribed_selected_voice";

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let currentRate = 1.0; // 0.75 – 2.0 human-friendly
let currentPitch = 1.0; // 0.5 – 2.0; 1.0 is the engine's natural pitch
let currentVoice: string | undefined;
let currentLanguage = DEFAULT_LANGUAGE;
let _autoDetectLanguage = false;
let _savedVoiceLoaded = false;

/**
 * Monotonically increasing counter used to detect stale TTS callbacks.
 *
 * Each call to speakChunk() captures the current value. stopSpeaking()
 * increments it so that any onDone/onStopped/onError from a previous
 * utterance is silently discarded — regardless of platform quirks where
 * Speech.stop() may fire onDone instead of onStopped.
 */
let _currentSpeakId = 0;

// ---------------------------------------------------------------------------
// Pause / resume state
//
// Android has no pause at any layer — its platform TextToSpeech simply does
// not expose one — so a pause there is a stop plus a remembered offset, and a
// resume re-speaks the tail of the chunk. iOS suspends the utterance for real.
// ---------------------------------------------------------------------------

/**
 * The full **spoken** text of the current chunk — what the engine was given,
 * and therefore what a resume must slice.
 */
let _currentChunkText = "";

/**
 * Display/spoken mapping for the current chunk. Boundaries are tracked in
 * spoken coordinates (the engine's) and converted on the way out.
 */
let _currentSpokenText: SpokenText = identitySpokenText("");

/** Where the in-flight utterance starts within `_currentChunkText`. */
let _utteranceOffset = 0;

/** Last word boundary reported, absolute within `_currentChunkText`. */
let _lastBoundaryCharIndex = 0;

/** Callbacks of the in-flight utterance, reused when resuming it. */
let _currentCallbacks: TTSCallbacks | undefined;

/** True between a pauseSpeaking() and the resume/stop that ends it. */
let _isPausedMidUtterance = false;

/** True when the pause was a real native suspend rather than a stop. */
let _nativePauseActive = false;

// ---------------------------------------------------------------------------
// Core speak / stop
// ---------------------------------------------------------------------------

/**
 * Start one utterance and wire its lifecycle callbacks to the staleness guard.
 *
 * Kept separate from speakChunk() because an Android resume speaks only part
 * of a chunk and must not reset the chunk-level bookkeeping around it.
 */
function startUtterance(
  text: string,
  callbacks: TTSCallbacks | undefined,
): void {
  // Capture the speak ID for this utterance so callbacks can self-validate.
  // stopSpeaking() increments _currentSpeakId, which makes any in-flight
  // callbacks from this utterance become no-ops — fixing the race where
  // Android fires onDone instead of onStopped after Speech.stop().
  const speakId = ++_currentSpeakId;

  _currentCallbacks = callbacks;
  _isPausedMidUtterance = false;
  _nativePauseActive = false;

  // Stop any current utterance to avoid stacking
  Speech.stop();

  Speech.speak(text, {
    // When autoDetectLanguage is ON, omit language so the OS engine handles it
    language: _autoDetectLanguage ? undefined : currentLanguage,
    rate: currentRate,
    pitch: currentPitch,
    voice: currentVoice,
    // useApplicationAudioSession is deliberately left unset, keeping the iOS
    // default of true. Passing false makes AVSpeechSynthesizer activate and
    // release its own audio session around every utterance, and every chunk is
    // an utterance, so it lands as an audible gap between chunks.
    onStart: () => {
      if (_currentSpeakId === speakId) callbacks?.onStart?.();
    },
    // Annotated structurally: expo-speech types onBoundary as a union with a
    // DOM SpeechEventCallback and does not re-export NativeBoundaryEvent from
    // its entrypoint, so the parameter has no inferable shape here.
    onBoundary: ({
      charIndex,
      charLength,
    }: {
      charIndex: number;
      charLength: number;
    }) => {
      if (_currentSpeakId !== speakId) return;
      // Kept in spoken coordinates: this is what resumeSpeaking() slices.
      _lastBoundaryCharIndex = _utteranceOffset + charIndex;

      if (!callbacks?.onBoundary) return;
      const range = spokenToDisplayRange(
        _currentSpokenText,
        _lastBoundaryCharIndex,
        charLength,
      );
      callbacks.onBoundary({
        charIndex: range.start,
        charLength: range.end - range.start,
      });
    },
    onDone: () => {
      if (_currentSpeakId !== speakId) return;
      _isPausedMidUtterance = false;
      _nativePauseActive = false;
      callbacks?.onDone?.();
    },
    onStopped: () => {
      if (_currentSpeakId === speakId) callbacks?.onStopped?.();
    },
    onError: (err) => {
      if (_currentSpeakId !== speakId) return;
      _isPausedMidUtterance = false;
      _nativePauseActive = false;
      callbacks?.onError?.(err);
    },
  });
}

/**
 * Speak a chunk of text with lifecycle callbacks.
 *
 * expo-speech handles one utterance at a time. Calling speak() while
 * already speaking queues the utterance, but we always stop first
 * to avoid stacking.
 */
export function speakChunk(text: string, callbacks?: TTSCallbacks): void {
  speakSpokenText(identitySpokenText(text), callbacks);
}

/**
 * Speak a chunk that has been through the pronunciation rules.
 *
 * The engine receives `spokenText.spoken`; every boundary reported back out is
 * mapped into `spokenText.display` coordinates first, so the rest of the app
 * only ever sees offsets into text the reader can actually see.
 */
export function speakSpokenText(
  spokenText: SpokenText,
  callbacks?: TTSCallbacks,
): void {
  if (!spokenText.spoken?.trim()) {
    callbacks?.onDone?.();
    return;
  }

  _currentSpokenText = spokenText;
  _currentChunkText = spokenText.spoken;
  _utteranceOffset = 0;
  _lastBoundaryCharIndex = 0;

  startUtterance(spokenText.spoken, callbacks);
}

export function stopSpeaking(): void {
  // Invalidate any pending callbacks from the current utterance before stopping.
  _currentSpeakId++;
  // A stop is not a pause: drop any resume position with it.
  _isPausedMidUtterance = false;
  _nativePauseActive = false;
  Speech.stop();
}

// ---------------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------------

/** True when the platform can suspend an utterance mid-word (iOS only). */
export function supportsNativePause(): boolean {
  return Platform.OS === "ios";
}

/**
 * Walk back from `index` to the start of the word containing it, so a resume
 * never begins mid-word. Engines report `charIndex` at the start of the word
 * they are about to say, in which case this is already a no-op.
 */
function wordStartAtOrBefore(text: string, index: number): number {
  if (index <= 0) return 0;
  let i = Math.min(index, text.length);
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

/**
 * Pause playback.
 *
 * iOS suspends the utterance, so `_currentSpeakId` is deliberately left alone —
 * the utterance is not cancelled and its eventual onDone is still the one the
 * caller wants. Android stops and remembers the last word boundary instead,
 * going through stopSpeaking() so the in-flight onDone cannot auto-advance.
 */
export async function pauseSpeaking(): Promise<void> {
  const speakId = _currentSpeakId;

  // Mark synchronously: a play() arriving before the native call settles has
  // to see that a pause is already in progress.
  _isPausedMidUtterance = true;

  if (supportsNativePause()) {
    _nativePauseActive = true;
    try {
      await Speech.pause();
      return;
    } catch {
      // Advertised but refused — fall through to the offset strategy.
      if (_currentSpeakId !== speakId) return;
      _nativePauseActive = false;
    }
  }

  // A new utterance started while we were awaiting — it owns the state now.
  if (_currentSpeakId !== speakId) return;

  stopSpeaking();
  _isPausedMidUtterance = true;
}

/**
 * Resume playback.
 *
 * iOS continues the suspended utterance. Android re-speaks the remainder of
 * the current chunk from the last reported word boundary, reusing the paused
 * utterance's callbacks so auto-advance still works.
 *
 * @returns false when there was nothing to resume — including the case where
 *   the engine never reported a boundary — so the caller can fall back to
 *   replaying the chunk from its start, which is the pre-Phase-2 behaviour.
 */
export async function resumeSpeaking(
  callbacks?: TTSCallbacks,
): Promise<boolean> {
  if (!_isPausedMidUtterance) return false;

  if (_nativePauseActive) {
    try {
      await Speech.resume();
      _isPausedMidUtterance = false;
      _nativePauseActive = false;
      return true;
    } catch {
      // Suspend/resume is unavailable after all — fall through and re-speak.
      _nativePauseActive = false;
    }
  }

  _isPausedMidUtterance = false;

  // No boundary was ever reported (some OEM engines never emit ranges), so
  // there is no better-than-chunk-start position to resume from.
  if (_lastBoundaryCharIndex <= 0 || !_currentChunkText) return false;

  const start = wordStartAtOrBefore(_currentChunkText, _lastBoundaryCharIndex);
  const remainder = _currentChunkText.slice(start);
  if (!remainder.trim()) return false;

  // Keep the chunk bookkeeping so boundaries stay absolute within the chunk.
  _utteranceOffset = start;
  startUtterance(remainder, callbacks ?? _currentCallbacks);
  return true;
}

/**
 * Character offset of the last word boundary reported for the current chunk.
 * 0 when the engine reports no ranges.
 */
export function getLastBoundaryCharIndex(): number {
  return _lastBoundaryCharIndex;
}

export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

// ---------------------------------------------------------------------------
// Rate & voice controls
// ---------------------------------------------------------------------------

/**
 * @param rate  Human-friendly scale: 0.75 – 2.0
 */
export function setRate(rate: number): void {
  currentRate = Math.min(2.0, Math.max(0.5, rate));
}

export function getRate(): number {
  return currentRate;
}

/**
 * Pitch is supported natively on both iOS and Android — unlike `volume`,
 * which expo-speech only honours on web.
 *
 * @param pitch  1.0 is the voice's natural pitch. Clamped to 0.5 – 2.0.
 */
export function setPitch(pitch: number): void {
  currentPitch = Math.min(2.0, Math.max(0.5, pitch));
}

export function getPitch(): number {
  return currentPitch;
}

export function setLanguage(lang: string): void {
  currentLanguage = lang;
}

export function setAutoDetectLanguage(enabled: boolean): void {
  _autoDetectLanguage = enabled;
}

// ---------------------------------------------------------------------------
// Voice resolution — bundled registry → installed system voices
// ---------------------------------------------------------------------------

/**
 * Returns every voice in the bundled registry, each tagged available/unavailable
 * based on what is actually installed on the current device.
 *
 * Resolution order per voice:
 *  1. Exact platform ID match   (iosIds / androidIds)
 *  2. Name-hint + language match
 *  3. Language-prefix-only match (last resort)
 */
export async function getResolvedVoices(): Promise<ResolvedVoice[]> {
  if (!_savedVoiceLoaded) {
    await loadSavedVoice();
  }

  let systemVoices: SystemVoice[] = [];
  try {
    const raw = await Speech.getAvailableVoicesAsync();
    // On Android, voices can be slow to load — retry once after a short delay
    if (raw.length === 0 && Platform.OS === "android") {
      await new Promise((r) => setTimeout(r, 500));
      const retry = await Speech.getAvailableVoicesAsync();
      systemVoices = retry.map(normaliseVoice);
    } else {
      systemVoices = raw.map(normaliseVoice);
    }
  } catch {
    // No TTS engine — all voices will be unavailable
  }

  return BUNDLED_VOICES.map((b) => resolveVoice(b, systemVoices));
}

/**
 * Google TTS voice identifiers follow the pattern "en-au-x-aub-local".
 * We use this to prefer Google's engine over OEM engines (Samsung, Bixby, …)
 * when falling back to a language-only match.
 */
const GOOGLE_VOICE_ID = /^[a-z]{2,3}-[a-z]{2,4}-x-[a-z0-9]{3,4}-(local|network)$/i;

function isGoogleVoice(v: SystemVoice): boolean {
  return GOOGLE_VOICE_ID.test(v.identifier ?? "");
}

function normaliseVoice(v: Speech.Voice): SystemVoice {
  return {
    identifier: v.identifier,
    name: v.name,
    language: v.language,
    quality: typeof v.quality === "number" ? v.quality : Number(v.quality) || 0,
  };
}

function resolveVoice(
  bundled: BundledVoice,
  system: SystemVoice[],
): ResolvedVoice {
  const ids = Platform.OS === "ios" ? bundled.iosIds : bundled.androidIds;

  // 1 — exact ID match
  for (const id of ids) {
    const hit = system.find((v) => v.identifier === id);
    if (hit) return { ...bundled, available: true, systemId: hit.identifier };
  }

  // 2 — name hint + language prefix
  const lang5 = bundled.language.substring(0, 5); // "en-US"
  const byName = system.find(
    (v) =>
      v.name?.toLowerCase().includes(bundled.nameHint) &&
      v.language?.replace("_", "-").startsWith(lang5),
  );
  if (byName)
    return { ...bundled, available: true, systemId: byName.identifier };

  // 3 — language prefix only, preferring a Google engine voice
  const byLang = system.filter((v) =>
    v.language?.replace("_", "-").startsWith(lang5),
  );
  const pick = byLang.find(isGoogleVoice) ?? byLang[0];
  if (pick) return { ...bundled, available: true, systemId: pick.identifier };

  return { ...bundled, available: false, systemId: null };
}

// ---------------------------------------------------------------------------
// Voice selection & persistence
// ---------------------------------------------------------------------------

/**
 * Set and persist the selected voice.
 */
export async function setVoice(voiceId: string): Promise<void> {
  currentVoice = voiceId;
  try {
    await AsyncStorage.setItem(VOICE_STORAGE_KEY, voiceId);
  } catch (e) {
    console.error("[ttsService] Failed to persist voice selection", e);
  }
}

/**
 * Load the saved voice from AsyncStorage into the singleton.
 */
export async function loadSavedVoice(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_STORAGE_KEY);
    if (stored) currentVoice = stored;
  } catch {}
  _savedVoiceLoaded = true;
}

/**
 * Resolve the voice Read Aloud should use, once, at app start.
 *
 * Precedence:
 *  1. A voice the user explicitly picked (persisted in AsyncStorage)
 *  2. The app default — DEFAULT_VOICE_ID, a Google Australian voice
 *  3. Nothing, in which case speakChunk() lets the OS pick for currentLanguage
 *
 * The default is deliberately not written to storage, so it re-resolves on
 * every launch — e.g. it upgrades itself once the user installs a better
 * en-AU voice — and only an explicit pick in the VoicePicker overrides it.
 */
export async function initVoice(): Promise<void> {
  await loadSavedVoice();
  if (currentVoice) return;

  try {
    const resolved = await getResolvedVoices();
    const fallback = resolved.find((v) => v.id === DEFAULT_VOICE_ID);
    if (fallback?.available && fallback.systemId) {
      currentVoice = fallback.systemId;
      currentLanguage = fallback.language;
    }
  } catch {
    // No TTS engine — leave currentVoice unset and fall back to the language.
  }
}

/**
 * Get the voice identifier Read Aloud is currently using (synchronous — reads
 * from cache): the user's saved pick, or the app default resolved by
 * initVoice(). Undefined only when neither could be resolved.
 */
export function getSavedVoiceId(): string | undefined {
  return currentVoice;
}

export function clearVoice(): void {
  currentVoice = undefined;
  AsyncStorage.removeItem(VOICE_STORAGE_KEY).catch(() => {});
}
