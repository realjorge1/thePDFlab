// ============================================================================
// PptxViewerOnlineScreen
//
// The single entrypoint for the online PPTX viewing feature. Consumed by
// app/ppt-viewer.tsx as a thin shim. All state, caching, rendering and UX
// live inside this feature module.
//
// UX model (WPS-Office-style):
//   • Signature gradient app header — taller, two rows. Top row: back ·
//     filename · slide chip · fullscreen. Tool row: orientation toggle ·
//     rehearse, tucked under the slide chip / fullscreen.
//   • Slide chip shows just the current number; tapping it opens a
//     jump-to-slide grid.
//   • Vertical view is a continuous, free-scrolling stack (≈2 slides on
//     screen) rather than one-slide-per-page paging.
//   • Fullscreen is a bold "present mode": the deck rotates to landscape to
//     fill the screen; a single tap brings floating controls back.
// ============================================================================

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { Palette, Spacing, Typography } from "@/services/document-manager";
import { useTheme } from "@/services/ThemeProvider";

import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { AnalyzeSheet } from "@/components/ai/AnalyzeSheet";
import { GradientView } from "@/components/GradientView";
import { colors as brandColors } from "@/constants/theme";

import { ErrorState } from "../components/ErrorState";
import { LoadingStages } from "../components/LoadingStages";
import {
  PptxPdfViewer,
  type PptxPdfViewerHandle,
} from "../components/PptxPdfViewer";
import {
  PptxOfflineViewer,
  type PptxOfflineViewerHandle,
} from "../components/PptxOfflineViewer";
import { RehearsalScreen } from "./RehearsalScreen";
import { usePptxRender } from "../hooks/usePptxRender";

const AUTO_HIDE_MS = 3500;

type Orientation = "horizontal" | "vertical";

export default function PptxViewerOnlineScreen() {
  const params = useLocalSearchParams<{ uri: string; name?: string }>();
  const fileUri = params.uri ?? "";
  const fileName = params.name ?? "Presentation";

  const { colors: t, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  // Dark mode is true black across the app; light mode keeps a soft grey so
  // slides read as a deck, not a document.
  const canvasBg = mode === "dark" ? "#000000" : Palette.gray[200];

  const { stage, retry, showBasicPreview } = usePptxRender(fileUri, fileName);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [gridVisible, setGridVisible] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [rehearsalOpen, setRehearsalOpen] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  // The single native PDF instance is handed between the main deck and the
  // rehearsal overlay. These two flags stagger that handoff so the two viewers
  // of the same file never exist at once (that combination crashes
  // react-native-pdf on Android). See the effect below.
  const [deckMounted, setDeckMounted] = useState(true);
  const [rehearsalVisible, setRehearsalVisible] = useState(false);

  const viewerRef = useRef<PptxPdfViewerHandle | null>(null);
  const offlineViewerRef = useRef<PptxOfflineViewerHandle | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOfflinePreview = stage.phase === "ready_offline";

  useEffect(() => {
    if (stage.phase === "ready_offline") setTotalPages(stage.totalSlides);
  }, [stage]);

  // ── Deck ⇄ rehearsal handoff (single-instance safety) ──────────
  // Only one native viewer of this file may be live at a time. On entry we
  // unmount the main deck immediately and mount the rehearsal a beat later;
  // on exit we unmount the rehearsal immediately and remount the deck a beat
  // later. The short gap lets the outgoing native view finish tearing down.
  useEffect(() => {
    if (rehearsalOpen) {
      setDeckMounted(false);
      const id = setTimeout(() => setRehearsalVisible(true), 160);
      return () => clearTimeout(id);
    }
    setRehearsalVisible(false);
    const id = setTimeout(() => setDeckMounted(true), 160);
    return () => clearTimeout(id);
  }, [rehearsalOpen]);

  const handleJump = useCallback((page: number) => {
    // Only one viewer is mounted at a time; the other ref is null.
    viewerRef.current?.goToPage(page);
    offlineViewerRef.current?.goToPage(page);
  }, []);

  const handleBack = useCallback(() => router.back(), []);

  // ── Fullscreen chrome auto-hide ───────────────────────────────
  // The offline WebView can't report taps, so its controls never auto-hide
  // (the user would have no way to bring them back).
  const canAutoHide = stage.phase === "ready";

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (fullscreen && controlsVisible && canAutoHide) {
      hideTimer.current = setTimeout(
        () => setControlsVisible(false),
        AUTO_HIDE_MS,
      );
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [fullscreen, controlsVisible, canAutoHide, currentPage]);

  const handleViewerTap = useCallback(() => {
    if (fullscreen) setControlsVisible((v) => !v);
  }, [fullscreen]);

  const enterFullscreen = useCallback(() => {
    setFullscreen(true);
    setControlsVisible(true);
  }, []);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    setControlsVisible(true);
  }, []);

  const toggleOrientation = useCallback(() => {
    setOrientation((o) => (o === "horizontal" ? "vertical" : "horizontal"));
  }, []);

  const isReady = stage.phase === "ready" || stage.phase === "ready_offline";

  // ── Deck viewer configuration ──────────────────────────────────
  // Fullscreen forces horizontal paging so a single slide rotates to fill the
  // landscape "present" frame. Otherwise the orientation toggle decides:
  //   horizontal → one slide per swipe
  //   vertical   → continuous free-scroll stack (≈2 slides shown)
  //
  // Fit policy: present mode fits BOTH (fills the rotated landscape frame);
  // every other mode fits WIDTH (identical to fit-both for a landscape slide
  // in a portrait viewport, but a DIFFERENT value — so entering/leaving
  // present mode always flips fitPolicy and react-native-pdf re-fits in place.
  // Without that flip the deck kept the portrait fit and rendered smaller).
  // The `scale` flip on the same transition clears any lingering pinch-zoom.
  const viewerHorizontal = fullscreen ? true : orientation === "horizontal";
  const viewerPaged = fullscreen ? true : orientation === "horizontal";
  const viewerFit: 0 | 1 | 2 = fullscreen ? 2 : 0; // 2 = fit both, 0 = fit width
  const viewerScale = fullscreen ? 1.0 : 1.0001;

  // Rotated layer that turns the portrait viewport into a bold landscape frame.
  const rotatedDeck = {
    position: "absolute" as const,
    width: winH,
    height: winW,
    top: (winH - winW) / 2,
    left: (winW - winH) / 2,
    transform: [{ rotate: "90deg" }],
  };

  // One deck viewer. Orientation and fullscreen are driven by LIVE props
  // (react-native-pdf re-lays-out in place) — it is never remounted on toggle.
  // Remounting re-extracts the file and races the native cache, which is what
  // made toggling lag and crash. It is torn down only while the rehearsal
  // overlay owns the screen (see the staggered handoff above), so two native
  // viewers of one file never coexist.
  const deck =
    stage.phase === "ready" ? (
      <PptxPdfViewer
        ref={viewerRef}
        pdfUri={stage.pdfUri}
        backgroundColor={fullscreen ? "#000000" : canvasBg}
        horizontal={viewerHorizontal}
        paged={viewerPaged}
        fitPolicy={viewerFit}
        scale={viewerScale}
        spacing={14}
        initialPage={currentPage}
        onLoadComplete={(pages) => setTotalPages(pages)}
        onPageChanged={(page) => setCurrentPage(page)}
        onSingleTap={handleViewerTap}
        onError={(msg) => {
          console.warn("[pptx-viewer] pdf render error", msg);
        }}
      />
    ) : stage.phase === "ready_offline" ? (
      <PptxOfflineViewer
        ref={offlineViewerRef}
        html={stage.html}
        onPageChanged={(page) => setCurrentPage(page)}
      />
    ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: t.background }]}>
      <SafeAreaView
        style={[styles.safe, { backgroundColor: t.background }]}
        edges={fullscreen ? [] : ["top", "bottom"]}
      >
        {/* ── Header (signature gradient style, hidden in fullscreen) ── */}
      {!fullscreen && (
        <AppHeaderContainer>
          <GradientView
            colors={[
              brandColors.gradientStart,
              brandColors.gradientMid,
              brandColors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.headerTopRow}>
              <Pressable
                onPress={handleBack}
                style={styles.headerButton}
                hitSlop={6}
              >
                <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" />
              </Pressable>

              <View style={styles.headerCenter}>
                <Text
                  style={styles.headerTitle}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {fileName}
                </Text>
                {isOfflinePreview && (
                  <Text style={styles.headerSubtitle}>Basic preview</Text>
                )}
              </View>

              <View style={styles.headerActions}>
                {/* Slide chip — one compact box, number flips as slides switch */}
                {isReady && totalPages > 0 && (
                  <Pressable
                    onPress={() => setGridVisible(true)}
                    hitSlop={6}
                    style={styles.pageChip}
                  >
                    <Text style={styles.pageChipText}>{currentPage}</Text>
                  </Pressable>
                )}

                {/* Fullscreen */}
                {isReady && (
                  <Pressable
                    onPress={enterFullscreen}
                    style={styles.headerButton}
                    hitSlop={6}
                  >
                    <MaterialIcons name="fullscreen" size={22} color="#FFFFFF" />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Tool row — sits under the slide chip / fullscreen buttons */}
            {isReady && (
              <View style={styles.headerToolRow}>
                {/* View switch — horizontal ⇄ vertical (PDF path only) */}
                {stage.phase === "ready" && (
                  <Pressable
                    onPress={toggleOrientation}
                    style={styles.toolBtn}
                    hitSlop={6}
                  >
                    <MaterialIcons
                      name={
                        orientation === "horizontal"
                          ? "view-carousel"
                          : "view-day"
                      }
                      size={17}
                      color="#FFFFFF"
                    />
                    <Text style={styles.toolBtnText}>
                      {orientation === "horizontal" ? "Horizontal" : "Vertical"}
                    </Text>
                  </Pressable>
                )}

                {/* Rehearse — opens the rehearsal timer flow. Shown for any
                    rendered deck (app-created decks included); the rehearsal
                    learns the slide count from its own viewer if needed. */}
                <Pressable
                  onPress={() => setRehearsalOpen(true)}
                  style={styles.toolBtn}
                  hitSlop={6}
                >
                  <MaterialIcons name="timer" size={17} color="#FFFFFF" />
                  <Text style={styles.toolBtnText}>Rehearse</Text>
                </Pressable>

                {/* Analyze — Devil's Advocate / Narrative Arc */}
                <Pressable
                  onPress={() => setShowAnalyze(true)}
                  style={styles.toolBtn}
                  hitSlop={6}
                >
                  <MaterialIcons name="auto-awesome" size={17} color="#FFFFFF" />
                  <Text style={styles.toolBtnText}>Analyze</Text>
                </Pressable>
              </View>
            )}
          </GradientView>
        </AppHeaderContainer>
      )}

      {/* ── Body ─────────────────────────────────────────────────── */}
      {isReady ? (
        deckMounted ? (
          // The deck lives in ONE stable position. Fullscreen ("present mode")
          // only swaps this wrapper's style (flex → rotated landscape frame)
          // and flips live props — the native pdf is never remounted to toggle.
          <View
            style={[
              styles.body,
              { backgroundColor: fullscreen ? "#000000" : canvasBg },
            ]}
          >
            <View style={fullscreen ? rotatedDeck : styles.deckFill}>
              {deck}
            </View>
          </View>
        ) : (
          // Deck handed over to the rehearsal overlay — keep a plain backdrop
          // so only one native viewer of this file is ever mounted.
          <View style={[styles.body, { backgroundColor: "#000000" }]} />
        )
      ) : stage.phase === "error" ? (
        <ErrorState
          message={stage.message}
          retryable={stage.retryable}
          offlineSuspected={stage.offlineSuspected}
          onRetry={retry}
          onBack={handleBack}
          onBasicPreview={stage.canBasicPreview ? showBasicPreview : undefined}
        />
      ) : (
        <LoadingStages stage={stage} />
      )}

      {/* ── Fullscreen floating controls ─────────────────────────── */}
      {fullscreen && controlsVisible && (
        <>
          <View
            style={[styles.fsTop, { paddingTop: insets.top + 8 }]}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={exitFullscreen}
              style={styles.fsRoundBtn}
              hitSlop={8}
            >
              <MaterialIcons name="fullscreen-exit" size={24} color="#FFFFFF" />
            </Pressable>
          </View>

          {/* Swipe changes slides in present mode — just a progress counter,
              no arrows. */}
          <View style={styles.fsBottom} pointerEvents="box-none">
            <View style={styles.fsPill}>
              <Text style={styles.fsCounter}>
                {currentPage} / {totalPages || "–"}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* ── Jump-to-slide grid ───────────────────────────────────── */}
      <Modal
        visible={gridVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGridVisible(false)}
      >
        <Pressable
          style={styles.gridOverlay}
          onPress={() => setGridVisible(false)}
        >
          <Pressable
            style={[styles.gridSheet, { backgroundColor: t.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.gridTitle, { color: t.text }]}>
              Go to slide
            </Text>
            <Text style={[styles.gridSub, { color: t.textSecondary }]}>
              Slide {currentPage} of {totalPages}
            </Text>
            <FlatList
              data={Array.from({ length: totalPages }, (_, i) => i + 1)}
              keyExtractor={(n) => String(n)}
              numColumns={5}
              style={styles.gridList}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item: page }) => {
                const active = page === currentPage;
                return (
                  <Pressable
                    onPress={() => {
                      setGridVisible(false);
                      handleJump(page);
                    }}
                    style={[
                      styles.gridCell,
                      {
                        backgroundColor: active
                          ? Palette.primary[500]
                          : t.backgroundSecondary,
                        borderColor: active
                          ? Palette.primary[500]
                          : t.borderLight,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.gridCellText,
                        { color: active ? "#FFFFFF" : t.text },
                      ]}
                    >
                      {page}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      </SafeAreaView>

      {/* ── Rehearsal timer (full-screen in-window overlay, not a Modal, so
          the native deck viewer stays in the main window) ─────────────── */}
      {(stage.phase === "ready" || stage.phase === "ready_offline") && (
        <RehearsalScreen
          visible={rehearsalVisible}
          onClose={() => setRehearsalOpen(false)}
          fileName={fileName}
          fileKey={fileUri || fileName}
          totalSlides={totalPages}
          source={
            stage.phase === "ready"
              ? { kind: "pdf", pdfUri: stage.pdfUri, backgroundColor: "#000000" }
              : { kind: "offline", html: stage.html }
          }
          onJumpToSlide={(page) => {
            // Reopen the main deck on this slide once it remounts (initialPage).
            setCurrentPage(page);
            setRehearsalOpen(false);
          }}
        />
      )}

      <AnalyzeSheet
        visible={showAnalyze}
        onClose={() => setShowAnalyze(false)}
        file={
          fileUri
            ? {
                uri: fileUri,
                name: fileName,
                mimeType:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              }
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safe: { flex: 1 },

  // Signature gradient header — taller, two rows.
  header: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.xs,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    textAlign: "center",
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: Typography.size.xs,
    marginTop: 2,
    fontWeight: Typography.weight.medium,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerToolRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  toolBtnText: {
    color: "#FFFFFF",
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  pageChip: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  pageChipText: {
    color: "#FFFFFF",
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    fontVariant: ["tabular-nums"],
  },

  // Clips the rotated present-mode layer to the screen bounds.
  body: { flex: 1, overflow: "hidden" },
  deckFill: { flex: 1 },

  // Fullscreen floating controls
  fsTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    alignItems: "flex-end",
  },
  fsRoundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  fsBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: "center",
  },
  fsPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  fsCounter: {
    color: "#FFFFFF",
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },

  // Jump-to-slide grid
  gridOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  gridSheet: {
    borderRadius: 18,
    paddingTop: 18,
    paddingBottom: 10,
    maxHeight: "70%",
  },
  gridTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
    textAlign: "center",
  },
  gridSub: {
    fontSize: Typography.size.xs,
    textAlign: "center",
    marginTop: 2,
    marginBottom: 10,
  },
  gridList: { flexGrow: 0 },
  gridContent: { paddingHorizontal: 14, paddingBottom: 8 },
  gridRow: { gap: 8, marginBottom: 8 },
  gridCell: {
    flex: 1,
    aspectRatio: 1.4,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  gridCellText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
});
