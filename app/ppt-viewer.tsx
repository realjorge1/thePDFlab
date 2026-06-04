/**
 * ppt-viewer.tsx
 *
 * PowerPoint viewing is temporarily disabled. This route now shows a
 * "Not available now" screen instead of the online PPTX viewer. The route is
 * preserved so taps on .pptx/.ppt files from the library, folders, browse,
 * file-details and home land here gracefully. The underlying implementation in
 * features/pptxViewerOnline is left intact for re-enabling.
 */

import { FeatureUnavailableScreen } from "@/components/FeatureUnavailableScreen";
import { Presentation } from "lucide-react-native";
import React from "react";

export default function PptViewer() {
  return (
    <FeatureUnavailableScreen
      headerTitle="Presentation"
      icon={Presentation}
      accentColor="#D24726"
      message="Viewing PowerPoint presentations isn't available right now. Check back in an upcoming update."
    />
  );
}
