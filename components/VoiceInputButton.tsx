/**
 * VoiceInputButton — DISABLED
 *
 * The offline Whisper voice feature has been disabled. This component is
 * kept as a no-op stub so any existing imports across the app continue to
 * type-check and compile, but it never renders any UI and never invokes
 * any voice/microphone code path. Every mic icon that previously came
 * from this component is now silently absent.
 *
 * Re-enabling the feature is a pure restore of this file plus
 * `services/whisperService.ts` — no other code in the app references the
 * old internals directly.
 */

import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

interface Props {
  onTranscribed: (text: string) => void;
  language?: string;
  color?: string;
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onError?: (message: string) => void;
}

export function VoiceInputButton(_props: Props): React.ReactElement | null {
  return null;
}

export default VoiceInputButton;
