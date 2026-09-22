import { useEffect } from "react";
import { AppState } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { PptxViewerOnlineScreen } from "@/features/pptxViewerOnline";
import { READING_SESSIONS } from "@/constants/featureFlags";
import { useReadingSession } from "@/hooks/useReadingSession";
import { bumpReadingTime } from "@/services/workspaceInsightsService";

export default function PptViewer() {
  const { uri, name } = useLocalSearchParams<{ uri?: string; name?: string }>();

  // Reading-time heartbeat → WorkSpace Progress dashboard.
  //
  // ORIGINAL PATH (READING_SESSIONS off): credits time only while mounted and
  // the app is foregrounded. Kept verbatim so the flag is a true kill switch.
  useEffect(() => {
    if (READING_SESSIONS) return; // the shared hook owns the heartbeat instead
    const BEAT_MS = 20000;
    const id = setInterval(() => {
      if (AppState.currentState === "active") bumpReadingTime(BEAT_MS);
    }, BEAT_MS);
    return () => clearInterval(id);
  }, []);

  // SHARED PATH (READING_SESSIONS on): per-file, per-day time with the
  // activity guard, still crediting bumpReadingTime with the same totals.
  //
  // The PPTX screen owns its own slide navigation internally and exposes no
  // slide callback here, so this viewer has no fine-grained activity signal
  // to wire up. The guard therefore treats an untouched PPTX as idle, which
  // is the honest answer: with nothing reporting slide changes, the app
  // cannot claim the user is reading.
  useReadingSession({ uri, name });

  return <PptxViewerOnlineScreen />;
}
