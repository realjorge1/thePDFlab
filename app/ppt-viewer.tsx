import { useEffect } from "react";
import { AppState } from "react-native";

import { PptxViewerOnlineScreen } from "@/features/pptxViewerOnline";
import { bumpReadingTime } from "@/services/workspaceInsightsService";

export default function PptViewer() {
  // Reading-time heartbeat → WorkSpace Progress dashboard. Credits time only
  // while mounted and the app is foregrounded.
  useEffect(() => {
    const BEAT_MS = 20000;
    const id = setInterval(() => {
      if (AppState.currentState === "active") bumpReadingTime(BEAT_MS);
    }, BEAT_MS);
    return () => clearInterval(id);
  }, []);

  return <PptxViewerOnlineScreen />;
}
