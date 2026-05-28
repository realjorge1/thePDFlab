/**
 * whisperService.ts — DISABLED
 *
 * The offline Whisper voice feature has been disabled. This module is kept
 * as a no-op shim so any existing imports keep type-checking and compiling,
 * but every voice capability is turned off:
 *
 *   - `isVoiceAvailable()` always returns `false`, so any UI that gates on
 *     it (e.g. the dictation chip in the gozlin workspace) hides itself.
 *   - All capture/transcription entry points are no-ops or throw a clear
 *     "voice disabled" error if accidentally invoked.
 *   - Nothing in here imports any native voice modules, and the
 *     `whisper.rn` package itself has been removed from `package.json`
 *     (along with its patch in `patches/`). The bundle no longer pulls
 *     in any whisper-related native code.
 */

export interface VoiceDiagnostics {
  capturedBytes: number;
  durationSec: number;
  avgLevel: number;
  peakLevel: number;
  wavPath: string;
  rawResult: string;
  error: string;
}

const EMPTY_DIAGNOSTICS: VoiceDiagnostics = {
  capturedBytes: 0,
  durationSec: 0,
  avgLevel: 0,
  peakLevel: 0,
  wavPath: "",
  rawResult: "",
  error: "Voice feature is disabled.",
};

type LevelListener = (level: number) => void;

export function isVoiceAvailable(): boolean {
  return false;
}

export function getVoiceDiagnostics(): VoiceDiagnostics {
  return { ...EMPTY_DIAGNOSTICS };
}

export function setLevelListener(_cb: LevelListener | null): void {
  // no-op
}

export async function isModelReady(): Promise<boolean> {
  return false;
}

export async function ensureModel(
  _onProgress?: (fraction: number) => void,
): Promise<string> {
  throw new Error("Voice feature is disabled.");
}

export async function prepareVoice(
  _onProgress?: (fraction: number) => void,
): Promise<void> {
  // no-op
}

export async function startRecording(): Promise<void> {
  throw new Error("Voice feature is disabled.");
}

export async function stopRecording(): Promise<string> {
  return "";
}

export function isRecording(): boolean {
  return false;
}

export async function cancelRecording(): Promise<void> {
  // no-op
}

export async function transcribeFile(
  _wavPath: string,
  _language: string = "auto",
): Promise<string> {
  return "";
}

export async function stopAndTranscribe(
  _language: string = "auto",
): Promise<string> {
  return "";
}

export async function releaseVoice(): Promise<void> {
  // no-op
}
