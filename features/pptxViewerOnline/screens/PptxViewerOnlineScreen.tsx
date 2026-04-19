// ============================================================================
// PptxViewerOnlineScreen
//
// The single entrypoint for the online PPTX viewing feature. Consumed by
// app/ppt-viewer.tsx as a thin shim. All state, caching, rendering and UX
// live inside this feature module.
// ============================================================================

import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ErrorState } from "../components/ErrorState";
import { LoadingStages } from "../components/LoadingStages";
import {
  PptxPdfViewer,
  type PptxPdfViewerHandle,
} from "../components/PptxPdfViewer";
import { SlideStrip } from "../components/SlideStrip";
import { usePptxRender } from "../hooks/usePptxRender";

const BG = "#111827";
const HEADER_BG = "#1F2937";

export default function PptxViewerOnlineScreen() {
  const params = useLocalSearchParams<{ uri: string; name?: string }>();
  const fileUri = params.uri ?? "";
  const fileName = params.name ?? "Presentation";

  const { stage, retry } = usePptxRender(fileUri, fileName);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const viewerRef = useRef<PptxPdfViewerHandle | null>(null);

  const handleJump = useCallback((page: number) => {
    viewerRef.current?.goToPage(page);
  }, []);

  const handleBack = useCallback(() => router.back(), []);

  const subTitle = (() => {
    switch (stage.phase) {
      case "ready":
        return totalPages > 0
          ? `Slide ${currentPage} / ${totalPages}${
              stage.fromCache ? " • cached" : ""
            }`
          : "";
      case "preparing":
      case "uploading":
      case "rendering":
      case "downloading":
        return stage.message;
      default:
        return "";
    }
  })();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBack}
          hitSlop={10}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName}
          </Text>
          {!!subTitle && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {subTitle}
            </Text>
          )}
        </View>

        <View style={styles.headerRight} />
      </View>

      {stage.phase === "ready" ? (
        <View style={styles.body}>
          <PptxPdfViewer
            ref={viewerRef}
            pdfUri={stage.pdfUri}
            onLoadComplete={(pages) => setTotalPages(pages)}
            onPageChanged={(page) => setCurrentPage(page)}
            onError={(msg) => {
              console.warn("[pptx-viewer] pdf render error", msg);
            }}
          />
          <SlideStrip
            totalPages={totalPages}
            currentPage={currentPage}
            onJump={handleJump}
          />
        </View>
      ) : stage.phase === "error" ? (
        <ErrorState
          message={stage.message}
          retryable={stage.retryable}
          offlineSuspected={stage.offlineSuspected}
          onRetry={retry}
          onBack={handleBack}
        />
      ) : (
        <LoadingStages stage={stage} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: HEADER_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 30,
    marginTop: -2,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  headerSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    marginTop: 1,
    maxWidth: "100%",
  },
  headerRight: { width: 34 },
  body: { flex: 1 },
});
