// ============================================================================
// PptxPdfViewer — thin wrapper around react-native-pdf configured for a
// slide-deck UX: horizontal swipe paging, pinch-to-zoom, page sync with the
// SlideStrip. Imperative `goToPage` handle for the strip to drive.
// ============================================================================

import React, { forwardRef, useImperativeHandle, useState } from "react";
import { StyleSheet } from "react-native";
import Pdf from "react-native-pdf";

export interface PptxPdfViewerHandle {
  goToPage: (page: number) => void;
}

interface Props {
  pdfUri: string;
  onLoadComplete: (pages: number) => void;
  onPageChanged: (page: number) => void;
  onError: (message: string) => void;
}

export const PptxPdfViewer = forwardRef<PptxPdfViewerHandle, Props>(
  function PptxPdfViewer(
    { pdfUri, onLoadComplete, onPageChanged, onError },
    ref,
  ) {
    const [targetPage, setTargetPage] = useState<number | undefined>(undefined);

    useImperativeHandle(
      ref,
      () => ({
        goToPage: (page: number) => setTargetPage(page),
      }),
      [],
    );

    return (
      <Pdf
        source={{ uri: pdfUri }}
        style={styles.viewer}
        trustAllCerts={false}
        horizontal
        enablePaging
        enableAntialiasing
        minScale={1.0}
        maxScale={4.0}
        scale={1.0}
        page={targetPage}
        onLoadComplete={onLoadComplete}
        onPageChanged={(page) => {
          onPageChanged(page);
          // Clear target once the jump has taken effect so subsequent swipes
          // aren't forced back to the same page.
          if (targetPage && page === targetPage) setTargetPage(undefined);
        }}
        onError={(err: any) => {
          const msg = err instanceof Error ? err.message : "PDF render error";
          onError(msg);
        }}
      />
    );
  },
);

const styles = StyleSheet.create({
  viewer: {
    flex: 1,
    backgroundColor: "#111827",
  },
});
