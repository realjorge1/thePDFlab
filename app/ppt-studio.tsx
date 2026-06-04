/**
 * ppt-studio.tsx
 *
 * PowerPoint creation/editing is temporarily disabled. This route now shows a
 * "Not available now" screen instead of the PPT Studio. The route is preserved
 * so the Create screen tile and any stray navigation land here gracefully. The
 * underlying implementation in src/ppt-module is left intact for re-enabling.
 */

import { FeatureUnavailableScreen } from "@/components/FeatureUnavailableScreen";
import { MonitorPlay } from "lucide-react-native";
import React from "react";

export default function PPTStudioScreen() {
  return (
    <FeatureUnavailableScreen
      headerTitle="Create Presentation"
      icon={MonitorPlay}
      accentColor="#D24726"
      message="Creating PowerPoint presentations isn't available right now. Check back in an upcoming update."
    />
  );
}
