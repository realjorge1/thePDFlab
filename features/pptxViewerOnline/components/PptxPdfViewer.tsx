// ============================================================================
// PptxPdfViewer — thin wrapper around react-native-pdf configured for a
// slide-deck UX: swipe paging (horizontal or vertical), pinch-to-zoom, and
// page sync with the surrounding chrome.
//
// Navigation is IMPERATIVE: the `goToPage` handle calls react-native-pdf's
// native `setPage()` command rather than driving a controlled `page` prop.
// The controlled prop used to fight the user — after a swipe the prop still
// pointed at the old page, so the next re-render snapped the deck back to it
// (the "returns to slide 1" bug during rehearsal). The `page` prop is now
// frozen to the initial page and never updated; every later jump goes through
// setPage(), which the native view honours without resetting on re-render.
//
// Orientation / fit / zoom are LIVE props on a viewer kept in one tree
// position — never remounted to toggle them (that re-extracts the file and
// races the native cache). Changing `fitPolicy` / `scale` makes react-native-
// pdf re-fit in place, which is how "present mode" re-frames and how a
// lingering pinch-zoom is cleared on enter/exit.
// ============================================================================

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet } from "react-native";
import Pdf, { type PdfRef } from "react-native-pdf";

export interface PptxPdfViewerHandle {
  goToPage: (page: number) => void;
}

interface Props {
  pdfUri: string;
  onLoadComplete: (pages: number) => void;
  onPageChanged: (page: number) => void;
  onError: (message: string) => void;
  /** Fired on a single tap that isn't a swipe/zoom — used to toggle chrome. */
  onSingleTap?: () => void;
  /** Canvas color behind the slides (theme-aware). */
  backgroundColor?: string;
  /** Swipe direction. `true` = horizontal paging (default), `false` = vertical. */
  horizontal?: boolean;
  /** Page to open on first mount (1-based). Captured once; later jumps use goToPage. */
  initialPage?: number;
  /**
   * Snap one slide per swipe. Default `true`. Set `false` for a continuous,
   * free-scrolling deck (vertical reading where slides stack and ~2 are
   * visible at once).
   */
  paged?: boolean;
  /**
   * react-native-pdf fit policy: 0 = fit width, 1 = fit height, 2 = fit both
   * (default). Changing it forces an in-place re-fit.
   */
  fitPolicy?: 0 | 1 | 2;
  /** Gap between slides in continuous mode. Ignored when paged. */
  spacing?: number;
  /**
   * Zoom level relative to the fit. Changing this resets the live zoom, which
   * is how present-mode clears a lingering pinch-zoom on enter/exit.
   */
  scale?: number;
}

export const PptxPdfViewer = forwardRef<PptxPdfViewerHandle, Props>(
  function PptxPdfViewer(
    {
      pdfUri,
      onLoadComplete,
      onPageChanged,
      onError,
      onSingleTap,
      backgroundColor,
      horizontal = true,
      initialPage,
      paged = true,
      fitPolicy = 2,
      spacing = 0,
      scale = 1,
    },
    ref,
  ) {
    const pdfInstance = useRef<PdfRef | null>(null);
    // Frozen at first mount. react-native-pdf opens here; every later jump is
    // imperative (setPage), so the prop never snaps the deck back on re-render.
    const initialPageRef = useRef(initialPage && initialPage > 0 ? initialPage : 1);

    useImperativeHandle(
      ref,
      () => ({
        goToPage: (page: number) => {
          if (page > 0) pdfInstance.current?.setPage(page);
        },
      }),
      [],
    );

    return (
      <Pdf
        ref={pdfInstance}
        source={{ uri: pdfUri }}
        style={[styles.viewer, backgroundColor ? { backgroundColor } : null]}
        trustAllCerts={false}
        horizontal={horizontal}
        enablePaging={paged}
        fitPolicy={fitPolicy}
        spacing={paged ? 0 : spacing}
        enableAntialiasing
        minScale={1.0}
        maxScale={4.0}
        scale={scale}
        page={initialPageRef.current}
        onLoadComplete={(pages) => onLoadComplete(pages)}
        onPageChanged={(page) => onPageChanged(page)}
        onPageSingleTap={() => onSingleTap?.()}
        onError={(err: unknown) => {
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
    backgroundColor: "#000000",
  },
});
