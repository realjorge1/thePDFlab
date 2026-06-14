/**
 * PDF Viewer Screen
 * In-app PDF viewer with zoom, scroll, loading, and error states.
 * Includes pre-render validation and recovery flow for broken PDFs.
 *
 * Features:
 *  - Mobile View / Normal View toggle (text reflow via documentReflowService)
 *  - Continuous / Facing reading mode toggle
 *  - Three-dots overflow menu (Share, Search, Read Aloud, Chat, Lock, Edit, Delete, Star)
 *  - Page jump modal + thumbnail grid
 *  - Fullscreen mode
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
// SECONDARY (additive): records that a document was opened so the Gozlin
// workspace can surface related material. Fire-and-forget; never throws.
import { recordDocumentOpen } from "@/services/contextAwarenessService";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  MobileRenderer,
  type MobileRendererHandle,
} from "@/components/DocumentViewer/MobileRenderer";
import {
  PdfTextLayerView,
  type PdfTextLayerHandle,
  type PdfTextLayerSelection,
} from "@/components/DocumentViewer/PdfTextLayerView";
import { PDFTextExtractor } from "@/components/DocumentViewer/PDFTextExtractor";
import { SelectionToolbar } from "@/components/DocumentViewer/SelectionToolbar";
import { ThreeDotsMenu } from "@/components/DocumentViewer/ThreeDotsMenu";
import { AnalyzeSheet } from "@/components/ai/AnalyzeSheet";
import { ViewModeToggle } from "@/components/DocumentViewer/ViewModeToggle";
import { PageJumpModal } from "@/components/pdf/PageJumpModal";
import { ThumbnailGrid } from "@/components/pdf/ThumbnailGrid";
import {
  PdfRecoveryAction,
  PdfRecoveryScreen,
} from "@/components/PdfRecoveryScreen";
import { ReadAloudController } from "@/components/ReadAloudController";
import type { Highlight, Strikethrough, Underline, ViewMode } from "@/src/types/document-viewer.types";
import {
  getHighlights,
  getStrikethroughs,
  getUnderlines,
  saveHighlight,
  saveStrikethrough,
  saveUnderline,
  removeHighlight,
  removeStrikethrough,
  removeUnderline,
} from "@/services/viewerStorageService";
import {
  getReadingProgress,
  setReadingProgressFromPages,
} from "@/services/readingProgressService";

import { API_BASE_URL } from "@/config/api";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import {
  DarkTheme,
  LightTheme,
  Palette,
  PdfViewer,
  Spacing,
  Typography,
  normalizePdfUri,
  openWithSystemApp,
  showOpenFailedAlert,
} from "@/services/document-manager";
import { reflowPDF } from "@/services/documentReflowService";
import {
  isFavorite as checkIsFavorite,
  deleteFileReference,
  getAllFiles,
  toggleFavorite,
} from "@/services/fileService";
import {
  fetchPdfAsHtml,
  generatePdfEditorHtml,
  savePdfFromHtml,
} from "@/services/pdfEditService";
import { repairPdfViaBackend } from "@/services/pdfRepairClient";
import { validatePdfFile } from "@/services/pdfValidationService";
import { recycleFile } from "@/services/recycleBinService";
import { bumpReadingTime } from "@/services/workspaceInsightsService";
import { WebView } from "react-native-webview";
import type { WebView as WebViewType } from "react-native-webview";

// ============================================================================
// TYPES
// ============================================================================
type ReadingMode = "continuous" | "facing";

interface ViewerState {
  normalizedUri: string | null;
  loading: boolean;
  error: string | null;
  errorDetails?: string;
  pageInfo: { current: number; total: number };
  passwordRequired: boolean;
  showRecovery: boolean;
  repairing: boolean;
  retrying: boolean;
  fullscreen: boolean;
  fitPolicy: 0 | 1 | 2;
  showGoToPage: boolean;
  readingMode: ReadingMode;
  showThumbnails: boolean;
  // ── Mobile view ──
  viewMode: ViewMode;
  mobileHtml: string | null;
  mobileLoading: boolean;
  mobileError: string | null;
  // ── Menu & overlays ──
  showMenu: boolean;
  showSearch: boolean;
  searchQuery: string;
  /** Pages (1-indexed) that contain the search query — original view only */
  searchMatchPages: number[];
  /** Index into searchMatchPages for the currently-highlighted page */
  searchPageIndex: number;
  /** True while PDFTextExtractor is extracting text on behalf of a search request */
  searchExtracting: boolean;
  /** Match count from MobileRenderer WebView (mobile view) */
  searchMobileCount: number;
  /** Current match index (1-based) from MobileRenderer WebView (mobile view) */
  searchMobileCurrent: number;
  // ── Read Aloud ──
  readAloudActive: boolean;
  /** Per-page text array populated by PDFTextExtractor — independent of mobile view */
  readAloudPageTexts: string[];
  /**
   * True while we silently pre-extract text in the background (shortly after
   * the PDF opens) so Read Aloud / Search start instantly when tapped. Mounts
   * the same hidden extractor; cleared once extraction completes.
   */
  prewarmExtract: boolean;
  // ── Star ──
  isStarred: boolean;
  fileId: string | null;
  // ── Text selection toolbar ──
  selectionVisible: boolean;
  selectionText: string;
  selectionRect: { x: number; y: number; width: number; height: number } | null;
  selectionOffsets: { startOffset: number; endOffset: number } | null;
  /** Page index (0-based) the current selection lives on — page (text-layer) view only. */
  selectionPageIndex: number | null;
  // ── In-place selectable page view (pdf.js canvas + text layer) ──
  /** True once the text-layer WebView reports a fatal error — falls back to native render. */
  pageViewFailed: boolean;
  /** Byte size of the PDF (when known) — gates the in-WebView renderer for huge files. */
  fileSize: number | null;
  // ── Inline editor (in-place edit mode) ──
  editMode: boolean;
  editorHtml: string | null;
  editLoading: boolean;
  editSaving: boolean;
  editLoadingStartedAt: number | null;
  editLoadingElapsed: number;
}

// ============================================================================
// SAF URI HELPERS
// ============================================================================

/**
 * Re-encode a SAF document URI whose tree-ID / document-ID segments may contain
 * unescaped characters (literal ':', '/', spaces).  A decoded '/' inside the
 * document-ID is treated by Android's ContentResolver as a path separator,
 * causing it to resolve a directory instead of a file → EISDIR.
 *
 * decode-then-reencode is idempotent: already-correct URIs are unchanged.
 */
function reEncodeSafDocumentUri(uri: string): string {
  if (!uri.startsWith("content://")) return uri;
  const treeIdx = uri.indexOf("/tree/");
  const docIdx  = uri.indexOf("/document/");
  if (treeIdx === -1 || docIdx === -1 || docIdx <= treeIdx) return uri;
  const authority = uri.slice(0, treeIdx);
  const treeId    = uri.slice(treeIdx + 6, docIdx);
  const docId     = uri.slice(docIdx + 10);
  try {
    return (
      `${authority}/tree/${encodeURIComponent(decodeURIComponent(treeId))}` +
      `/document/${encodeURIComponent(decodeURIComponent(docId))}`
    );
  } catch {
    return uri;
  }
}

// ============================================================================
// READING MODE CONFIG
// ============================================================================
function getReadingModeConfig(mode: ReadingMode) {
  switch (mode) {
    case "continuous":
      return { enablePaging: false, horizontal: false, spacing: 0 };
    case "facing":
      return { enablePaging: true, horizontal: true, spacing: 10 };
  }
}

// ============================================================================
// COMPONENT
// ============================================================================
export default function PdfViewerScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const theme = colorScheme === "dark" ? DarkTheme : LightTheme;

  // Callers in library.tsx wrap the URI in encodeURIComponent before pushing
  // to compensate for expo-router's net 1-decode behavior, which strips a
  // layer of URI-encoding from SAF tree-document URIs and produces EISDIR
  // when the resulting URI is opened. The wrap+native-decode round-trip
  // restores the original URI here without any extra work.
  const { uri, name } = useLocalSearchParams<{ uri: string; name: string }>();

  // SECONDARY (additive): note this document open for context-awareness. Uses
  // the same canonical key as reading-progress so it aligns with the library.
  useEffect(() => {
    if (!uri) return;
    recordDocumentOpen({
      uri: reEncodeSafDocumentUri(uri),
      name: name || "Document",
      type: "pdf",
    });
  }, [uri, name]);

  const [state, setState] = useState<ViewerState>({
    normalizedUri: null,
    loading: true,
    error: null,
    errorDetails: undefined,
    pageInfo: { current: 1, total: 0 },
    passwordRequired: false,
    showRecovery: false,
    repairing: false,
    retrying: false,
    fullscreen: false,
    fitPolicy: 0,
    showGoToPage: false,
    readingMode: "continuous",
    showThumbnails: false,
    viewMode: "original",
    mobileHtml: null,
    mobileLoading: false,
    mobileError: null,
    showMenu: false,
    showSearch: false,
    searchQuery: "",
    searchMatchPages: [],
    searchPageIndex: 0,
    searchExtracting: false,
    searchMobileCount: 0,
    searchMobileCurrent: 0,
    readAloudActive: false,
    readAloudPageTexts: [],
    prewarmExtract: false,
    isStarred: false,
    fileId: null,
    selectionVisible: false,
    selectionText: "",
    selectionRect: null,
    selectionOffsets: null,
    selectionPageIndex: null,
    pageViewFailed: false,
    fileSize: null,
    editMode: false,
    editorHtml: null,
    editLoading: false,
    editSaving: false,
    editLoadingStartedAt: null,
    editLoadingElapsed: 0,
  });

  const [passwordInput, setPasswordInput] = useState("");
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);
  const [showFullscreenIndicator, setShowFullscreenIndicator] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const isMountedRef = useRef(true);
  const mobileRendererRef = useRef<MobileRendererHandle>(null);
  const pageViewRef = useRef<PdfTextLayerHandle>(null);
  const editorWebViewRef = useRef<WebViewType>(null);
  const editAbortRef = useRef<AbortController | null>(null);
  /** Holds a search query that arrived before text extraction completed. */
  const pendingSearchQueryRef = useRef<string | null>(null);
  /** Whether we've already attempted to restore the saved page on this open. */
  const restoredPageRef = useRef(false);
  /** Whether background text pre-extraction has been kicked off for this open. */
  const prewarmStartedRef = useRef(false);

  // ── Lifecycle ────────────────────────────────────────────────────
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Reading-time heartbeat → WorkSpace Progress dashboard ──
  // Credits time only while the screen is mounted and the app is foregrounded.
  React.useEffect(() => {
    const BEAT_MS = 20000;
    const id = setInterval(() => {
      if (AppState.currentState === "active") bumpReadingTime(BEAT_MS);
    }, BEAT_MS);
    return () => clearInterval(id);
  }, []);

  // Normalize URI + check star on mount
  React.useEffect(() => {
    if (!uri) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "No PDF file specified",
      }));
      return;
    }
    restoredPageRef.current = false;
    setTargetPage(undefined);
    prewarmStartedRef.current = false;
    normalizeUri();
    checkStarStatus();
  }, [uri]);

  // ── Background pre-extraction (speed) ────────────────────────────
  // Once the PDF is validated and on disk, quietly extract its text in the
  // background so Read Aloud (and Search) start INSTANTLY when tapped instead
  // of waiting for a cold extraction. Uses the same hidden PDFTextExtractor and
  // identical message contract; we simply mount it ahead of the user's tap.
  //
  // Guards: file:// only (content:// can't be inlined), not while loading/in
  // error/recovery, skipped for very large files (the extractor inlines bytes
  // as base64), and only once per open. A short delay keeps first paint snappy.
  React.useEffect(() => {
    const PREWARM_MAX_BYTES = 25 * 1024 * 1024; // mirror the text-layer ceiling
    const canPrewarm =
      !!state.normalizedUri &&
      !state.normalizedUri.startsWith("content://") &&
      !state.loading &&
      !state.error &&
      !state.showRecovery &&
      !state.editMode &&
      state.readAloudPageTexts.length === 0 &&
      !state.readAloudActive &&
      !state.searchExtracting &&
      !prewarmStartedRef.current &&
      (state.fileSize == null || state.fileSize <= PREWARM_MAX_BYTES);

    if (!canPrewarm) return;

    prewarmStartedRef.current = true;
    const timer = setTimeout(() => {
      if (!isMountedRef.current) return;
      setState((prev) =>
        // Re-check inside the setter in case the user already triggered things.
        prev.readAloudPageTexts.length > 0 ||
        prev.readAloudActive ||
        prev.searchExtracting
          ? prev
          : { ...prev, prewarmExtract: true },
      );
    }, 600);

    return () => clearTimeout(timer);
  }, [
    state.normalizedUri,
    state.loading,
    state.error,
    state.showRecovery,
    state.editMode,
    state.fileSize,
    state.readAloudPageTexts.length,
    state.readAloudActive,
    state.searchExtracting,
  ]);

  // ── Star status ──────────────────────────────────────────────────
  const checkStarStatus = useCallback(async () => {
    try {
      const allFiles = await getAllFiles();
      const match = allFiles.find((f) => f.uri === uri);
      if (match) {
        const starred = await checkIsFavorite(match.id);
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            isStarred: starred,
            fileId: match.id,
          }));
        }
      }
    } catch {
      // non-critical
    }
  }, [uri]);

  // ── URI normalisation + validation ───────────────────────────────
  const normalizeUri = async () => {
    try {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        errorDetails: undefined,
        showRecovery: false,
        // Reset the in-place selectable renderer for the new file.
        pageViewFailed: false,
        fileSize: null,
        selectionVisible: false,
        selectionText: "",
        selectionRect: null,
        selectionOffsets: null,
        selectionPageIndex: null,
      }));

      if (__DEV__) console.log("[PdfViewer] normalizeUri start:", uri);
      // SAF document URIs may arrive decoded (literal ':' and '/' inside the
      // document-ID segment). Re-encode them so Android's ContentResolver parses
      // the document ID correctly instead of resolving a partial path (→ EISDIR).
      const fixedUri = reEncodeSafDocumentUri(uri);
      if (__DEV__ && fixedUri !== uri) console.log("[PdfViewer] re-encoded SAF URI:", fixedUri);
      const normalized = await normalizePdfUri(fixedUri);
      if (__DEV__) console.log("[PdfViewer] normalized:", normalized);
      if (!isMountedRef.current) return;

      // If we couldn't mirror to a file:// URI, skip byte-level validation —
      // it would fail with the same EISDIR. Let react-native-pdf load via
      // ContentResolver.openInputStream and surface any genuine corruption
      // through onError → recovery screen.
      const stillContentUri = normalized.startsWith("content://");
      if (stillContentUri) {
        if (__DEV__)
          console.log("[PdfViewer] passing content:// directly, skipping validation");
        setState((prev) => ({
          ...prev,
          normalizedUri: normalized,
          loading: false,
        }));
        return;
      }

      const validation = await validatePdfFile(normalized);
      if (__DEV__)
        console.log("[PdfViewer] validation:", JSON.stringify(validation));
      if (!isMountedRef.current) return;

      if (!validation.valid) {
        setState((prev) => ({
          ...prev,
          normalizedUri: normalized,
          loading: false,
          error:
            validation.error ??
            "This file isn't a valid PDF. It may be a web page or an incomplete download.",
          errorDetails: validation.details,
          showRecovery: true,
        }));
        return;
      }

      // Capture byte size so the in-WebView renderer can be skipped for very
      // large files (it inlines the bytes as base64). Best-effort only.
      let size: number | null = null;
      try {
        const finfo = await FileSystem.getInfoAsync(normalized, { size: true } as any);
        if (finfo.exists && typeof (finfo as any).size === "number") {
          size = (finfo as any).size;
        }
      } catch {
        // ignore — size guard simply won't apply
      }

      setState((prev) => ({
        ...prev,
        normalizedUri: normalized,
        loading: false,
        fileSize: size,
      }));
    } catch (error) {
      if (__DEV__) console.warn("[PdfViewer] normalizeUri error:", error);
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load PDF",
      }));
    }
  };

  // ── Navigation ───────────────────────────────────────────────────
  const handleClose = useCallback(() => router.back(), []);

  const handleOpenWithSystem = useCallback(async () => {
    if (!uri) return;
    const result = await openWithSystemApp({
      uri,
      displayName: name || "document.pdf",
      mimeType: "application/pdf",
    });
    if (!result.success) showOpenFailedAlert(name || "PDF", result.error);
  }, [uri, name]);

  // ── PDF callbacks ────────────────────────────────────────────────
  const handlePdfLoadComplete = useCallback(
    (numberOfPages: number) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        pageInfo: { ...prev.pageInfo, total: numberOfPages },
      }));

      // Restore last-read page exactly once per open.
      // - If user reached the final page previously: start fresh at page 1.
      // - Otherwise: jump to the last page they were on.
      if (restoredPageRef.current || !uri || numberOfPages <= 0) return;
      restoredPageRef.current = true;

      getReadingProgress(reEncodeSafDocumentUri(uri))
        .then((entry) => {
          if (!isMountedRef.current || !entry) return;
          const saved = entry.currentPage;
          if (typeof saved !== "number" || saved <= 1) return;
          // Treat "finished" as having reached the last page (or progress >= 1).
          const finished =
            (typeof entry.progress === "number" && entry.progress >= 0.999) ||
            saved >= numberOfPages;
          if (finished) return;
          const target = Math.min(saved, numberOfPages);
          if (target > 1) setTargetPage(target);
        })
        .catch(() => {});
    },
    [uri],
  );

  const handlePageChanged = useCallback(
    (page: number, numberOfPages: number) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        pageInfo: { current: page, total: numberOfPages },
      }));
      if (uri && numberOfPages > 0) {
        // Always save under the canonical encoded form so lookups in library
        // and home screen (which use file.uri from the DB) find the entry.
        const progressKey = reEncodeSafDocumentUri(uri);
        setReadingProgressFromPages(progressKey, page, numberOfPages).catch(() => {});
      }
    },
    [uri],
  );

  const handlePdfError = useCallback((error: string) => {
    if (!isMountedRef.current) return;
    const errorLower = (error || "").toLowerCase();
    if (
      errorLower.includes("password") ||
      errorLower.includes("encrypted") ||
      errorLower.includes("decrypt") ||
      errorLower.includes("protected") ||
      errorLower.includes("security")
    ) {
      setState((prev) => ({ ...prev, passwordRequired: true, error: null }));
    } else {
      setState((prev) => ({
        ...prev,
        error: error || "The PDF viewer could not render this file.",
        showRecovery: true,
      }));
    }
  }, []);

  const handlePasswordSubmit = useCallback(async () => {
    const pwd = passwordInput.trim();
    if (!pwd) {
      Alert.alert("Error", "Please enter a password.");
      return;
    }

    const fileUri = state.normalizedUri ?? uri;
    if (!fileUri) return;

    setState((prev) => ({ ...prev, loading: true, passwordRequired: false }));

    try {
      const formData = new FormData();
      formData.append("file", {
        uri: fileUri,
        type: "application/pdf",
        name: name || "document.pdf",
      } as any);
      formData.append("password", pwd);

      const response = await fetch(`${API_BASE_URL}/pdf/unlock`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Wrong password or failed to unlock PDF.");
      }

      const blob = await response.blob();
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const r = reader.result as string;
          resolve(r.includes(",") ? r.split(",")[1] : r);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const decryptedUri = `${FileSystem.cacheDirectory}unlocked_${Date.now()}.pdf`;
      await FileSystem.writeAsStringAsync(decryptedUri, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        normalizedUri: decryptedUri,
        loading: false,
        passwordRequired: false,
        error: null,
      }));
    } catch (error) {
      if (!isMountedRef.current) return;
      setState((prev) => ({ ...prev, loading: false, passwordRequired: true }));
      Alert.alert(
        "Unlock Failed",
        error instanceof Error ? error.message : "Could not unlock PDF. Please check the password.",
      );
    }
  }, [passwordInput, state.normalizedUri, uri, name]);

  const handleRetry = useCallback(() => {
    normalizeUri();
  }, [uri]);

  // ── View mode toggle (Mobile ↔ Normal) ──────────────────────────
  /** @param silent When true (e.g. auto-switch on long press), suppress alerts on failure. */
  const handleViewModeChange = useCallback(
    async (newMode: ViewMode, silent = false) => {
      // Switching back to original — immediate, cancel any pending load
      if (newMode === "original") {
        setState((prev) => ({
          ...prev,
          viewMode: "original",
          mobileLoading: false,
        }));
        return;
      }

      // Android 8/9 ship Chrome-backed WebView that crashes the process on
      // init when running a recent Chrome build. Android 10+ decouples
      // WebView from Chrome, so the crash can't happen there.
      if (Platform.OS === "android" && (Platform.Version as number) < 29) {
        if (!silent) {
          Alert.alert(
            "Mobile View Unavailable",
            "Mobile View requires Android 10 or newer. Your device will continue to work in Normal View.",
          );
        }
        return;
      }

      // Already have mobile HTML cached
      if (state.mobileHtml) {
        setState((prev) => ({ ...prev, viewMode: "mobile" }));
        return;
      }

      if (!state.normalizedUri) return;
      setState((prev) => ({ ...prev, mobileLoading: true, mobileError: null }));

      try {
        const result = await reflowPDF(state.normalizedUri, {
          fontSize: 17,
          lineHeight: 1.6,
          theme: colorScheme === "dark" ? "dark" : "light",
          fontFamily: "system-ui",
        });

        if (!isMountedRef.current) return;
        if (result.success && result.html) {
          setState((prev) => ({
            ...prev,
            viewMode: "mobile",
            mobileHtml: result.html!,
            mobileLoading: false,
          }));
        } else {
          if (!silent) {
            Alert.alert(
              "Mobile View",
              result.message || "Mobile View not available for this PDF.",
            );
          }
          setState((prev) => ({ ...prev, mobileLoading: false }));
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        if (!silent) {
          Alert.alert("Mobile View", "Failed to generate Mobile View.");
        }
        setState((prev) => ({ ...prev, mobileLoading: false }));
      }
    },
    [state.mobileHtml, state.normalizedUri, colorScheme],
  );

  // ── Reading mode toggle (Continuous ↔ Facing) ───────────────────
  const toggleReadingMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      readingMode: prev.readingMode === "continuous" ? "facing" : "continuous",
    }));
  }, []);

  // ── Fullscreen ───────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    setState((prev) => {
      if (!prev.fullscreen) setShowFullscreenIndicator(true);
      return { ...prev, fullscreen: !prev.fullscreen };
    });
  }, []);

  const handleShowFullscreenIndicator = useCallback(() => {
    if (state.fullscreen) setShowFullscreenIndicator(true);
  }, [state.fullscreen]);

  React.useEffect(() => {
    if (showFullscreenIndicator && state.fullscreen) {
      const timer = setTimeout(() => setShowFullscreenIndicator(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showFullscreenIndicator, state.fullscreen]);

  // ── Page jump ────────────────────────────────────────────────────
  const handleGoToPage = useCallback((page: number) => {
    setTargetPage(page);
  }, []);

  // ── Share ────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!uri) return;
    try {
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: name || "Share PDF",
      });
    } catch {
      Alert.alert("Share Error", "Unable to share this file.");
    }
  }, [uri, name]);

  // ── Search ───────────────────────────────────────────────────────
  // Search is fully independent of Mobile View.
  // • Original view: extracts per-page text via PDFTextExtractor, then
  //   navigates to matching pages with page-jump.
  // • Mobile view: delegates to the MobileRenderer WebView's JS search.

  const handleOpenSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      showSearch: true,
      searchQuery: "",
      searchMatchPages: [],
      searchPageIndex: 0,
      searchExtracting: false,
      searchMobileCount: 0,
      searchMobileCurrent: 0,
    }));
  }, []);

  const handleSearchQuery = useCallback(
    (query: string) => {
      setState((prev) => ({ ...prev, searchQuery: query }));

      if (state.viewMode === "mobile") {
        mobileRendererRef.current?.search(query);
        return;
      }

      // ── Original view: page-text search ──────────────────────────
      if (!query.trim()) {
        setState((prev) => ({
          ...prev,
          searchMatchPages: [],
          searchPageIndex: 0,
          searchExtracting: false,
        }));
        return;
      }

      if (state.readAloudPageTexts.length > 0) {
        // Text already available — search immediately
        const q = query.toLowerCase();
        const matchPages = state.readAloudPageTexts.reduce<number[]>(
          (acc, text, i) => {
            if (text.toLowerCase().includes(q)) acc.push(i + 1);
            return acc;
          },
          [],
        );
        setState((prev) => ({
          ...prev,
          searchMatchPages: matchPages,
          searchPageIndex: 0,
          searchExtracting: false,
        }));
        if (matchPages.length > 0) setTargetPage(matchPages[0]);
      } else {
        // Trigger PDFTextExtractor; result handled in onPageTexts callback
        pendingSearchQueryRef.current = query;
        setState((prev) => ({
          ...prev,
          searchMatchPages: [],
          searchPageIndex: 0,
          searchExtracting: true,
        }));
      }
    },
    [state.viewMode, state.readAloudPageTexts],
  );

  const handleCloseSearch = useCallback(() => {
    pendingSearchQueryRef.current = null;
    setState((prev) => ({
      ...prev,
      showSearch: false,
      searchQuery: "",
      searchMatchPages: [],
      searchPageIndex: 0,
      searchExtracting: false,
      searchMobileCount: 0,
      searchMobileCurrent: 0,
    }));
    mobileRendererRef.current?.clearSearch();
  }, []);

  const handleSearchNext = useCallback(() => {
    if (state.viewMode === "mobile") {
      mobileRendererRef.current?.searchNext();
      return;
    }
    if (state.searchMatchPages.length === 0) return;
    const next = (state.searchPageIndex + 1) % state.searchMatchPages.length;
    setState((prev) => ({ ...prev, searchPageIndex: next }));
    setTargetPage(state.searchMatchPages[next]);
  }, [state.viewMode, state.searchMatchPages, state.searchPageIndex]);

  const handleSearchPrev = useCallback(() => {
    if (state.viewMode === "mobile") {
      mobileRendererRef.current?.searchPrev();
      return;
    }
    if (state.searchMatchPages.length === 0) return;
    const prev =
      (state.searchPageIndex - 1 + state.searchMatchPages.length) %
      state.searchMatchPages.length;
    setState((p) => ({ ...p, searchPageIndex: prev }));
    setTargetPage(state.searchMatchPages[prev]);
  }, [state.viewMode, state.searchMatchPages, state.searchPageIndex]);

  // ── Read Aloud ───────────────────────────────────────────────────
  // Read Aloud is fully decoupled from Mobile View.
  // PDFTextExtractor (hidden WebView) handles text extraction independently.
  const handleReadAloud = useCallback(() => {
    setState((prev) => ({ ...prev, readAloudActive: true }));
  }, []);

  // ── Chat with File ───────────────────────────────────────────────
  const handleChatWithFile = useCallback(() => {
    router.push({
      pathname: "/chat-with-document",
      params: { uri, name },
    });
  }, [uri, name]);

  const handleAnalyze = useCallback(() => setShowAnalyze(true), []);

  // ── Lock File ────────────────────────────────────────────────────
  const handleLockFile = useCallback(() => {
    router.push({
      pathname: "/tool-processor",
      params: {
        tool: "protect",
        fileUri: uri,
        file: name,
        fileMimeType: "application/pdf",
      },
    });
  }, [uri, name]);

  // ── Edit File (inline) ───────────────────────────────────────────
  // Enter edit mode: convert PDF → HTML on the backend, then host a
  // contentEditable WebView so the user can type/cursor directly. Save flips
  // the HTML back through /convert/html-to-pdf and replaces the file shown.
  const enterEditMode = useCallback(async () => {
    const fileUri = state.normalizedUri || (uri as string);
    if (!fileUri) {
      Alert.alert("Cannot edit", "The PDF is not ready yet.");
      return;
    }

    // 90s ceiling — beyond this the user is better off retrying or using a tool.
    const controller = new AbortController();
    editAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    setState((prev) => ({
      ...prev,
      editLoading: true,
      editLoadingStartedAt: Date.now(),
      editLoadingElapsed: 0,
    }));

    try {
      const html = await fetchPdfAsHtml(
        fileUri,
        name || "document.pdf",
        controller.signal,
      );
      const editorHtml = generatePdfEditorHtml(html);
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        editMode: true,
        editorHtml,
        editLoading: false,
        editLoadingStartedAt: null,
        showMenu: false,
        showSearch: false,
        showThumbnails: false,
        showGoToPage: false,
        readAloudActive: false,
      }));
    } catch (err) {
      if (!isMountedRef.current) return;
      const aborted =
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError");
      setState((prev) => ({
        ...prev,
        editLoading: false,
        editLoadingStartedAt: null,
      }));
      if (aborted) return; // user cancelled; don't show an alert
      Alert.alert(
        "Editing failed",
        err instanceof Error
          ? err.message
          : "The backend could not convert this PDF to an editable form.",
      );
    } finally {
      clearTimeout(timeoutId);
      if (editAbortRef.current === controller) editAbortRef.current = null;
    }
  }, [state.normalizedUri, uri, name]);

  const cancelEditLoading = useCallback(() => {
    editAbortRef.current?.abort();
  }, []);

  // Tick the elapsed-time display while the conversion is running.
  React.useEffect(() => {
    if (!state.editLoading || state.editLoadingStartedAt == null) return;
    const startedAt = state.editLoadingStartedAt;
    const id = setInterval(() => {
      setState((prev) =>
        prev.editLoading
          ? { ...prev, editLoadingElapsed: Math.floor((Date.now() - startedAt) / 1000) }
          : prev,
      );
    }, 500);
    return () => clearInterval(id);
  }, [state.editLoading, state.editLoadingStartedAt]);

  const handleEditFile = useCallback(() => {
    Alert.alert("Edit PDF", "Open this PDF for editing?", [
      { text: "Cancel", style: "cancel" },
      { text: "Edit", onPress: enterEditMode },
    ]);
  }, [enterEditMode]);

  const exitEditMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      editMode: false,
      editorHtml: null,
      editSaving: false,
    }));
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editorWebViewRef.current) return;
    setState((prev) => ({ ...prev, editSaving: true }));
    // Ask the editor for its current innerHTML; reply lands in onMessage below.
    editorWebViewRef.current.injectJavaScript(`
      (function() {
        try {
          var content = window.getEditorContent ? window.getEditorContent() : '';
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pdf-save-content', content: content }));
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pdf-save-error', message: String(e) }));
        }
      })(); true;
    `);
  }, []);

  const handleEditorMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      let data: any;
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (data?.type === "pdf-save-content") {
        try {
          const newUri = await savePdfFromHtml(
            data.content || "",
            name || "document.pdf",
          );
          if (!isMountedRef.current) return;
          setState((prev) => ({
            ...prev,
            editSaving: false,
            editMode: false,
            editorHtml: null,
            // Swap the displayed PDF over to the saved copy so the viewer
            // immediately reflects the edits without re-navigation.
            normalizedUri: newUri,
            loading: false,
          }));
          Alert.alert(
            "PDF Saved",
            "Your edits have been saved as a new PDF.",
            [{ text: "OK" }],
          );
        } catch (err) {
          if (!isMountedRef.current) return;
          setState((prev) => ({ ...prev, editSaving: false }));
          Alert.alert(
            "Save failed",
            err instanceof Error ? err.message : "Could not save the edited PDF.",
          );
        }
      } else if (data?.type === "pdf-save-error") {
        setState((prev) => ({ ...prev, editSaving: false }));
        Alert.alert("Save failed", data.message || "Editor reported an error.");
      }
    },
    [name],
  );

  // ── Delete ───────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    Alert.alert(
      "Delete File",
      `Move "${name || "this file"}" to the recycle bin?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const allFiles = await getAllFiles();
              const match = allFiles.find((f) => f.uri === uri);
              if (match) {
                await recycleFile({
                  id: match.id,
                  name: match.name,
                  uri: match.uri,
                  size: match.size,
                  type: match.type,
                  mimeType: match.mimeType,
                  source: match.source,
                });
                await deleteFileReference(match.id);
              }
              router.back();
            } catch {
              Alert.alert("Error", "Failed to delete file.");
            }
          },
        },
      ],
    );
  }, [uri, name]);

  // ── Star / Favourite ─────────────────────────────────────────────
  const handleStar = useCallback(async () => {
    if (!state.fileId) {
      Alert.alert("Info", "This file is not in your library.");
      return;
    }
    try {
      const nowStarred = await toggleFavorite(state.fileId);
      setState((prev) => ({ ...prev, isStarred: nowStarred }));
    } catch {
      Alert.alert("Error", "Failed to update favourite status.");
    }
  }, [state.fileId]);

  // ── Mobile renderer messages ─────────────────────────────────────
  const handleMobileMessage = useCallback((msg: any) => {
    if (msg.type === "selection" && msg.text) {
      setState((prev) => ({
        ...prev,
        selectionVisible: true,
        selectionText: msg.text,
        // Rect is viewport-relative inside the WebView container — no offset needed
        selectionRect: msg.rect ?? null,
        selectionOffsets: {
          startOffset: msg.startOffset,
          endOffset: msg.endOffset,
        },
      }));
    } else if (msg.type === "selection_clear") {
      setState((prev) => ({
        ...prev,
        selectionVisible: false,
        selectionText: "",
        selectionRect: null,
        selectionOffsets: null,
      }));
    } else if (msg.type === "search-count") {
      setState((prev) => ({
        ...prev,
        searchMobileCount: msg.count ?? 0,
        searchMobileCurrent: msg.current ?? 0,
      }));
    } else if (msg.type === "annotation_applied" && !msg.success && msg.id && uri) {
      // Bridge failed to apply — remove from storage
      if (msg.kind === "highlight") removeHighlight(uri, msg.id);
      else if (msg.kind === "underline") removeUnderline(uri, msg.id);
      else if (msg.kind === "strikethrough") removeStrikethrough(uri, msg.id);
    }
  }, [uri]);

  // ── Reapply saved annotations when MobileRenderer is ready ──────
  const handleMobileReady = useCallback(async () => {
    if (!uri) return;
    try {
      const [highlights, underlines, strikethroughs] = await Promise.all([
        getHighlights(uri),
        getUnderlines(uri),
        getStrikethroughs(uri),
      ]);
      if (highlights.length || underlines.length || strikethroughs.length) {
        mobileRendererRef.current?.bridgeReapplyAnnotations(
          highlights,
          underlines,
          strikethroughs,
        );
      }
    } catch {
      // non-critical
    }
  }, [uri]);

  // ── Selection toolbar actions ────────────────────────────────────
  // Annotations made in the in-place page (text-layer) view are stored under a
  // separate key so their page-relative offsets never collide with the reflow
  // view's whole-document offsets.
  const pageAnnotKey = uri ? `pageview::${uri}` : uri;

  const handleSelectionHighlight = useCallback(
    (colorHex: string) => {
      const { selectionOffsets, selectionText, selectionPageIndex } = state;
      if (!selectionOffsets || !uri) return;
      const id = `hl_${Date.now()}`;
      if (selectionPageIndex !== null) {
        // In-place page view
        pageViewRef.current?.highlight(
          id,
          selectionPageIndex,
          selectionOffsets.startOffset,
          selectionOffsets.endOffset,
          colorHex,
        );
        saveHighlight({
          id,
          fileUri: pageAnnotKey!,
          pageNumber: selectionPageIndex,
          startOffset: selectionOffsets.startOffset,
          endOffset: selectionOffsets.endOffset,
          text: selectionText,
          color: colorHex,
          createdAt: Date.now(),
        });
        return;
      }
      mobileRendererRef.current?.bridgeHighlight(
        id,
        selectionOffsets.startOffset,
        selectionOffsets.endOffset,
        colorHex,
      );
      saveHighlight({
        id,
        fileUri: uri,
        startOffset: selectionOffsets.startOffset,
        endOffset: selectionOffsets.endOffset,
        text: selectionText,
        color: colorHex,
        createdAt: Date.now(),
      });
    },
    [state.selectionOffsets, state.selectionText, state.selectionPageIndex, uri, pageAnnotKey],
  );

  const handleSelectionUnderline = useCallback(() => {
    const { selectionOffsets, selectionText, selectionPageIndex } = state;
    if (!selectionOffsets || !uri) return;
    const id = `ul_${Date.now()}`;
    if (selectionPageIndex !== null) {
      pageViewRef.current?.underline(
        id,
        selectionPageIndex,
        selectionOffsets.startOffset,
        selectionOffsets.endOffset,
      );
      saveUnderline({
        id,
        fileUri: pageAnnotKey!,
        pageNumber: selectionPageIndex,
        startOffset: selectionOffsets.startOffset,
        endOffset: selectionOffsets.endOffset,
        text: selectionText,
        createdAt: Date.now(),
      });
      return;
    }
    mobileRendererRef.current?.bridgeUnderline(
      id,
      selectionOffsets.startOffset,
      selectionOffsets.endOffset,
    );
    saveUnderline({
      id,
      fileUri: uri,
      startOffset: selectionOffsets.startOffset,
      endOffset: selectionOffsets.endOffset,
      text: selectionText,
      createdAt: Date.now(),
    });
  }, [state.selectionOffsets, state.selectionText, state.selectionPageIndex, uri, pageAnnotKey]);

  const handleSelectionStrikethrough = useCallback(() => {
    const { selectionOffsets, selectionText, selectionPageIndex } = state;
    if (!selectionOffsets || !uri) return;
    const id = `st_${Date.now()}`;
    if (selectionPageIndex !== null) {
      pageViewRef.current?.strikethrough(
        id,
        selectionPageIndex,
        selectionOffsets.startOffset,
        selectionOffsets.endOffset,
      );
      saveStrikethrough({
        id,
        fileUri: pageAnnotKey!,
        pageNumber: selectionPageIndex,
        startOffset: selectionOffsets.startOffset,
        endOffset: selectionOffsets.endOffset,
        text: selectionText,
        createdAt: Date.now(),
      });
      return;
    }
    mobileRendererRef.current?.bridgeStrikethrough(
      id,
      selectionOffsets.startOffset,
      selectionOffsets.endOffset,
    );
    saveStrikethrough({
      id,
      fileUri: uri,
      startOffset: selectionOffsets.startOffset,
      endOffset: selectionOffsets.endOffset,
      text: selectionText,
      createdAt: Date.now(),
    });
  }, [state.selectionOffsets, state.selectionText, state.selectionPageIndex, uri, pageAnnotKey]);

  const handleSelectionCopy = useCallback(() => {
    if (state.selectionPageIndex !== null) {
      // Page (text-layer) view: copy via RN clipboard for reliability.
      if (state.selectionText) Clipboard.setStringAsync(state.selectionText).catch(() => {});
      pageViewRef.current?.clearSelection();
      return;
    }
    mobileRendererRef.current?.bridgeCopySelection();
  }, [state.selectionPageIndex, state.selectionText]);

  const handleSelectionAskAthemi = useCallback(() => {
    if (!state.selectionText) return;
    router.push({ pathname: "/gozlin", params: { prompt: state.selectionText } });
    setState((prev) => ({ ...prev, selectionVisible: false }));
  }, [state.selectionText]);

  const handleSelectionDismiss = useCallback(() => {
    mobileRendererRef.current?.bridgeClearSelection();
    pageViewRef.current?.clearSelection();
    setState((prev) => ({
      ...prev,
      selectionVisible: false,
      selectionText: "",
      selectionRect: null,
      selectionOffsets: null,
      selectionPageIndex: null,
    }));
  }, []);

  // ── In-place page (text-layer) view callbacks ───────────────────
  const handlePageSelection = useCallback((sel: PdfTextLayerSelection) => {
    setState((prev) => ({
      ...prev,
      selectionVisible: true,
      selectionText: sel.text,
      selectionRect: sel.rect,
      selectionOffsets: {
        startOffset: sel.startOffset,
        endOffset: sel.endOffset,
      },
      selectionPageIndex: sel.pageIndex,
    }));
  }, []);

  const handlePageSelectionClear = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectionVisible: false,
      selectionText: "",
      selectionRect: null,
      selectionOffsets: null,
      selectionPageIndex: null,
    }));
  }, []);

  const handlePageViewError = useCallback((msg: string) => {
    if (__DEV__) console.warn("[PdfViewer] text-layer view error → native fallback:", msg);
    // Gracefully fall back to the native renderer; nothing else changes.
    if (isMountedRef.current) {
      setState((prev) => ({ ...prev, pageViewFailed: true }));
    }
  }, []);

  const handlePageViewAnnotationFailed = useCallback(
    (id: string, kind: "highlight" | "underline" | "strikethrough") => {
      if (!pageAnnotKey) return;
      if (kind === "highlight") removeHighlight(pageAnnotKey, id);
      else if (kind === "underline") removeUnderline(pageAnnotKey, id);
      else if (kind === "strikethrough") removeStrikethrough(pageAnnotKey, id);
    },
    [pageAnnotKey],
  );

  // Reapply saved page-view annotations once the document is laid out.
  const reapplyPageAnnotations = useCallback(async () => {
    if (!pageAnnotKey) return;
    try {
      const [highlights, underlines, strikethroughs] = await Promise.all([
        getHighlights(pageAnnotKey),
        getUnderlines(pageAnnotKey),
        getStrikethroughs(pageAnnotKey),
      ]);
      const annotations = [
        ...highlights.map((h) => ({
          id: h.id,
          pageIndex: h.pageNumber ?? 0,
          startOffset: h.startOffset ?? 0,
          endOffset: h.endOffset ?? 0,
          kind: "highlight" as const,
          color: h.color,
        })),
        ...underlines.map((u) => ({
          id: u.id,
          pageIndex: u.pageNumber ?? 0,
          startOffset: u.startOffset,
          endOffset: u.endOffset,
          kind: "underline" as const,
        })),
        ...strikethroughs.map((s) => ({
          id: s.id,
          pageIndex: s.pageNumber ?? 0,
          startOffset: s.startOffset,
          endOffset: s.endOffset,
          kind: "strikethrough" as const,
        })),
      ];
      if (annotations.length) pageViewRef.current?.reapply(annotations);
    } catch {
      // non-critical
    }
  }, [pageAnnotKey]);

  const handlePageViewLoadComplete = useCallback(
    (numberOfPages: number) => {
      handlePdfLoadComplete(numberOfPages);
      reapplyPageAnnotations();
    },
    [handlePdfLoadComplete, reapplyPageAnnotations],
  );

  // ── Recovery actions ─────────────────────────────────────────────
  const handleRecoveryAction = useCallback(
    async (action: PdfRecoveryAction) => {
      switch (action.type) {
        case "retry":
          setState((prev) => ({ ...prev, retrying: true }));
          await normalizeUri();
          setState((prev) => ({ ...prev, retrying: false }));
          break;
        case "repair": {
          if (!state.normalizedUri) return;
          setState((prev) => ({ ...prev, repairing: true }));
          try {
            const result = await repairPdfViaBackend(state.normalizedUri);
            if (result.success && result.repairedUri) {
              const validation = await validatePdfFile(result.repairedUri);
              if (validation.valid) {
                setState((prev) => ({
                  ...prev,
                  normalizedUri: result.repairedUri!,
                  error: null,
                  errorDetails: undefined,
                  showRecovery: false,
                  repairing: false,
                }));
              } else {
                setState((prev) => ({
                  ...prev,
                  repairing: false,
                  error: "Repair completed but the file is still invalid.",
                  errorDetails: validation.details,
                }));
              }
            } else {
              setState((prev) => ({
                ...prev,
                repairing: false,
                error: result.error ?? "Repair failed.",
              }));
            }
          } catch (err) {
            setState((prev) => ({
              ...prev,
              repairing: false,
              error:
                err instanceof Error
                  ? err.message
                  : "Repair service unavailable.",
            }));
          }
          break;
        }
        case "external":
        case "report":
          break;
      }
    },
    [state.normalizedUri, uri],
  );

  // ── Fit mode toggle ──────────────────────────────────────────────
  const toggleFitMode = useCallback(() => {
    setState((prev) => ({ ...prev, fitPolicy: prev.fitPolicy === 0 ? 2 : 0 }));
  }, []);

  // ====================================================================
  // RENDER — Loading
  // ====================================================================
  if (state.loading && !state.normalizedUri) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <Header
          name={name || "PDF"}
          theme={theme}
          onClose={handleClose}
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChange}
          readingMode={state.readingMode}
          onToggleReadingMode={toggleReadingMode}
          onMenuPress={() => {}}
          mobileLoading={state.mobileLoading}
        />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Palette.primary[500]} />
          <Text style={[styles.loadingText, { color: theme.text.secondary }]}>
            Preparing PDF...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ====================================================================
  // RENDER — Password required
  // ====================================================================
  if (state.passwordRequired) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <Header
          name={name || "PDF"}
          theme={theme}
          onClose={handleClose}
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChange}
          readingMode={state.readingMode}
          onToggleReadingMode={toggleReadingMode}
          onMenuPress={() => {}}
          mobileLoading={state.mobileLoading}
        />
        <View style={styles.centerContent}>
          <MaterialIcons name="lock" size={64} color={Palette.primary[500]} />
          <Text style={[styles.errorTitle, { color: theme.text.primary }]}>
            Password Required
          </Text>
          <Text style={[styles.errorMessage, { color: theme.text.secondary }]}>
            This PDF is password protected. Enter the password to view it.
          </Text>
          <TextInput
            value={passwordInput}
            onChangeText={setPasswordInput}
            placeholder="Enter password..."
            placeholderTextColor={theme.text.secondary}
            secureTextEntry
            style={[
              styles.passwordInput,
              {
                backgroundColor: theme.surface.primary,
                color: theme.text.primary,
                borderColor: theme.border.default,
              },
            ]}
            onSubmitEditing={handlePasswordSubmit}
          />
          <View style={styles.errorActions}>
            <Pressable
              style={[
                styles.retryButton,
                { backgroundColor: Palette.primary[500] },
              ]}
              onPress={handlePasswordSubmit}
            >
              <MaterialIcons
                name="lock-open"
                size={20}
                color={Palette.white}
                style={{ marginRight: Spacing.sm }}
              />
              <Text style={styles.retryButtonText}>Unlock</Text>
            </Pressable>
            <Pressable
              style={[
                styles.externalButton,
                { borderColor: theme.border.default },
              ]}
              onPress={handleOpenWithSystem}
            >
              <MaterialIcons
                name="open-in-new"
                size={20}
                color={theme.text.primary}
                style={{ marginRight: Spacing.sm }}
              />
              <Text
                style={[
                  styles.externalButtonText,
                  { color: theme.text.primary },
                ]}
              >
                Open Externally
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ====================================================================
  // RENDER — Error / Recovery
  // ====================================================================
  if (state.error) {
    if (state.showRecovery) {
      return (
        <SafeAreaView
          style={[
            styles.container,
            { backgroundColor: theme.background.primary },
          ]}
        >
          <Header
            name={name || "PDF"}
            theme={theme}
            onClose={handleClose}
            viewMode={state.viewMode}
            onViewModeChange={handleViewModeChange}
            readingMode={state.readingMode}
            onToggleReadingMode={toggleReadingMode}
            onMenuPress={() => {}}
            mobileLoading={state.mobileLoading}
          />
          <PdfRecoveryScreen
            error={state.error}
            details={state.errorDetails}
            fileUri={state.normalizedUri ?? uri}
            fileName={name}
            theme={theme}
            onAction={handleRecoveryAction}
            repairing={state.repairing}
            retrying={state.retrying}
          />
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: theme.background.primary },
        ]}
      >
        <Header
          name={name || "PDF"}
          theme={theme}
          onClose={handleClose}
          viewMode={state.viewMode}
          onViewModeChange={handleViewModeChange}
          readingMode={state.readingMode}
          onToggleReadingMode={toggleReadingMode}
          onMenuPress={() => {}}
          mobileLoading={state.mobileLoading}
        />
        <View style={styles.centerContent}>
          <MaterialIcons
            name="error-outline"
            size={64}
            color={Palette.error.main}
          />
          <Text style={[styles.errorTitle, { color: theme.text.primary }]}>
            Failed to load PDF
          </Text>
          <Text style={[styles.errorMessage, { color: theme.text.secondary }]}>
            {state.error}
          </Text>
          <View style={styles.errorActions}>
            <Pressable
              style={[
                styles.retryButton,
                { backgroundColor: Palette.primary[500] },
              ]}
              onPress={handleRetry}
            >
              <MaterialIcons
                name="refresh"
                size={20}
                color={Palette.white}
                style={{ marginRight: Spacing.sm }}
              />
              <Text style={styles.retryButtonText}>Try Again</Text>
            </Pressable>
            <Pressable
              style={[
                styles.externalButton,
                { borderColor: theme.border.default },
              ]}
              onPress={handleOpenWithSystem}
            >
              <MaterialIcons
                name="open-in-new"
                size={20}
                color={theme.text.primary}
                style={{ marginRight: Spacing.sm }}
              />
              <Text
                style={[
                  styles.externalButtonText,
                  { color: theme.text.primary },
                ]}
              >
                Open Externally
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ====================================================================
  // RENDER — Main viewer
  // ====================================================================
  const readingConfig = getReadingModeConfig(state.readingMode);
  const isMobileView = state.viewMode === "mobile";

  // ── In-place selectable renderer (pdf.js canvas + text layer) ──
  // DISABLED by default. Mounting it on every PDF open inlined the whole file
  // (+ pdf.js + worker) into one giant WebView HTML string, which froze/crashed
  // the WebView on open. The native renderer is the safe default. The feature
  // stays in the codebase to be re-enabled once it loads the PDF from a cache
  // file instead of a multi-MB inline string.
  const ENABLE_INPLACE_PDF_SELECTION = false;
  const MAX_TEXTLAYER_BYTES = 25 * 1024 * 1024; // 25 MB ceiling when enabled
  const canReadBytes =
    !!state.normalizedUri && !state.normalizedUri.startsWith("content://");
  const usePageView =
    ENABLE_INPLACE_PDF_SELECTION &&
    !isMobileView &&
    state.readingMode === "continuous" &&
    !state.pageViewFailed &&
    canReadBytes &&
    (state.fileSize == null || state.fileSize <= MAX_TEXTLAYER_BYTES);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background.primary }]}
      edges={state.fullscreen ? [] : ["top"]}
    >
      {/* ── Header (hidden in fullscreen) ──────────────────────── */}
      {!state.fullscreen && (
        <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <Header
            name={name || "PDF"}
            theme={theme}
            onClose={handleClose}
            pageInfo={state.pageInfo.total > 0 ? state.pageInfo : undefined}
            onPagePress={() =>
              setState((prev) => ({ ...prev, showGoToPage: true }))
            }
            viewMode={state.viewMode}
            onViewModeChange={handleViewModeChange}
            readingMode={state.readingMode}
            onToggleReadingMode={toggleReadingMode}
            onMenuPress={() => setState((prev) => ({ ...prev, showMenu: true }))}
            mobileLoading={state.mobileLoading}
          />
        </View>
      )}

      {/* ── Search bar — works in both original and mobile view ─── */}
      {state.showSearch && (
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.surface.primary,
              borderBottomColor: theme.border.light,
            },
          ]}
        >
          {state.searchExtracting ? (
            <ActivityIndicator
              size="small"
              color={Palette.primary[500]}
              style={{ marginRight: 4 }}
            />
          ) : (
            <MaterialIcons name="search" size={20} color={theme.text.secondary} />
          )}
          <TextInput
            value={state.searchQuery}
            onChangeText={handleSearchQuery}
            placeholder={
              state.searchExtracting
                ? "Extracting text…"
                : "Search in document..."
            }
            placeholderTextColor={theme.text.secondary}
            autoFocus
            style={[styles.searchInput, { color: theme.text.primary }]}
            returnKeyType="search"
            blurOnSubmit={false}
          />
          {/* Match indicator */}
          {state.searchQuery.length > 0 && !state.searchExtracting && (
            <Text style={[styles.searchCount, { color: theme.text.secondary }]}>
              {isMobileView
                ? state.searchMobileCount > 0
                  ? `${state.searchMobileCurrent}/${state.searchMobileCount}`
                  : "0 results"
                : state.searchMatchPages.length > 0
                  ? `${state.searchPageIndex + 1}/${state.searchMatchPages.length} pg`
                  : "0 results"}
            </Text>
          )}
          {/* Navigation arrows */}
          {state.searchQuery.length > 0 && !state.searchExtracting && (
            (isMobileView
              ? state.searchMobileCount > 1
              : state.searchMatchPages.length > 1) && (
              <>
                <Pressable
                  onPress={handleSearchPrev}
                  style={styles.searchClose}
                  hitSlop={8}
                >
                  <MaterialIcons
                    name="keyboard-arrow-up"
                    size={22}
                    color={theme.text.primary}
                  />
                </Pressable>
                <Pressable
                  onPress={handleSearchNext}
                  style={styles.searchClose}
                  hitSlop={8}
                >
                  <MaterialIcons
                    name="keyboard-arrow-down"
                    size={22}
                    color={theme.text.primary}
                  />
                </Pressable>
              </>
            )
          )}
          <Pressable onPress={handleCloseSearch} style={styles.searchClose}>
            <MaterialIcons
              name="close"
              size={20}
              color={theme.text.secondary}
            />
          </Pressable>
        </View>
      )}

      {/* ── Search results panel (original view) — shows text excerpts
           with matched words highlighted in yellow ────────────────── */}
      {state.showSearch &&
        !isMobileView &&
        state.searchQuery.trim().length > 0 &&
        !state.searchExtracting &&
        state.searchMatchPages.length > 0 && (
          <View
            style={[
              styles.searchResultsPanel,
              {
                backgroundColor: theme.surface.primary,
                borderBottomColor: theme.border.light,
              },
            ]}
          >
            <ScrollView
              style={styles.searchResultsScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {state.searchMatchPages.map((pageNum, idx) => {
                const pageText = state.readAloudPageTexts[pageNum - 1] || "";
                const q = state.searchQuery.toLowerCase();
                const lowerText = pageText.toLowerCase();
                const matchIdx = lowerText.indexOf(q);
                if (matchIdx === -1) return null;

                // Extract a snippet around the first match
                const snippetStart = Math.max(0, matchIdx - 40);
                const snippetEnd = Math.min(
                  pageText.length,
                  matchIdx + state.searchQuery.length + 40,
                );
                const before = pageText.substring(snippetStart, matchIdx);
                const match = pageText.substring(
                  matchIdx,
                  matchIdx + state.searchQuery.length,
                );
                const after = pageText.substring(
                  matchIdx + state.searchQuery.length,
                  snippetEnd,
                );

                const isActive = idx === state.searchPageIndex;
                return (
                  <Pressable
                    key={`sr-${pageNum}`}
                    style={[
                      styles.searchResultItem,
                      {
                        backgroundColor: isActive
                          ? (colorScheme === "dark"
                              ? "rgba(255,214,0,0.10)"
                              : "rgba(255,214,0,0.12)")
                          : "transparent",
                      },
                    ]}
                    onPress={() => {
                      setState((prev) => ({
                        ...prev,
                        searchPageIndex: idx,
                      }));
                      setTargetPage(pageNum);
                    }}
                  >
                    <Text
                      style={[
                        styles.searchResultPage,
                        { color: Palette.primary[500] },
                      ]}
                    >
                      Page {pageNum}
                    </Text>
                    <Text
                      style={[
                        styles.searchResultSnippet,
                        { color: theme.text.secondary },
                      ]}
                      numberOfLines={2}
                    >
                      {snippetStart > 0 ? "…" : ""}
                      {before}
                      <Text style={styles.searchResultMatch}>{match}</Text>
                      {after}
                      {snippetEnd < pageText.length ? "…" : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

      {/* ── Document content ───────────────────────────────────── */}
      {state.normalizedUri && (
        <View style={{ flex: 1 }}>
          {state.editMode && state.editorHtml ? (
            <View style={{ flex: 1, backgroundColor: theme.background.primary }}>
              {/* Editor toolbar — Cancel / Save */}
              <View style={styles.editorToolbar}>
                <Pressable
                  onPress={exitEditMode}
                  style={styles.editorCancelBtn}
                  disabled={state.editSaving}
                >
                  <Text style={styles.editorCancelText}>Cancel</Text>
                </Pressable>
                <View style={styles.editorTitleWrap}>
                  <MaterialIcons name="edit" size={16} color="#2563eb" />
                  <Text style={styles.editorTitle}>Editing</Text>
                </View>
                <Pressable
                  onPress={handleSaveEdit}
                  style={[
                    styles.editorSaveBtn,
                    state.editSaving && styles.editorSaveBtnDisabled,
                  ]}
                  disabled={state.editSaving}
                >
                  {state.editSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.editorSaveText}>Save</Text>
                  )}
                </Pressable>
              </View>
              <WebView
                ref={editorWebViewRef}
                source={{ html: state.editorHtml }}
                originWhitelist={["*"]}
                style={{ flex: 1, backgroundColor: "#fff" }}
                javaScriptEnabled
                domStorageEnabled
                hideKeyboardAccessoryView={false}
                keyboardDisplayRequiresUserAction={false}
                onMessage={handleEditorMessage}
              />
            </View>
          ) : isMobileView ? (
            <MobileRenderer
              ref={mobileRendererRef}
              html={state.mobileHtml}
              loading={state.mobileLoading}
              error={state.mobileError}
              onMessage={handleMobileMessage}
              onReady={handleMobileReady}
            />
          ) : usePageView ? (
            <>
              {/* In-place selectable renderer — looks identical to the PDF,
                  long-press selects real text on the page (WPS-style). */}
              <PdfTextLayerView
                ref={pageViewRef}
                uri={state.normalizedUri}
                colorScheme={colorScheme}
                page={targetPage}
                onLoadComplete={handlePageViewLoadComplete}
                onPageChanged={handlePageChanged}
                onError={handlePageViewError}
                onSelection={handlePageSelection}
                onSelectionClear={handlePageSelectionClear}
                onAnnotationFailed={handlePageViewAnnotationFailed}
              />
              {state.fullscreen && (
                <Pressable
                  style={styles.fullscreenTapArea}
                  onPress={handleShowFullscreenIndicator}
                />
              )}
              {state.mobileLoading && (
                <View style={styles.mobileLoadingOverlay}>
                  <ActivityIndicator size="large" color={Palette.white} />
                  <Text style={styles.mobileLoadingText}>
                    Generating Mobile View…
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              <PdfViewer
                uri={state.normalizedUri}
                colorScheme={colorScheme}
                fitPolicy={
                  state.fullscreen
                    ? 0
                    : state.readingMode === "facing"
                      ? 2
                      : state.fitPolicy
                }
                minScale={1.0}
                page={targetPage}
                enablePaging={readingConfig.enablePaging}
                horizontal={readingConfig.horizontal}
                spacing={readingConfig.spacing}
                onLoadComplete={handlePdfLoadComplete}
                onPageChanged={handlePageChanged}
                onError={handlePdfError}
              />
              {state.fullscreen && (
                <Pressable
                  style={styles.fullscreenTapArea}
                  onPress={handleShowFullscreenIndicator}
                />
              )}
              {/* Loading overlay while generating mobile view */}
              {state.mobileLoading && (
                <View style={styles.mobileLoadingOverlay}>
                  <ActivityIndicator size="large" color={Palette.white} />
                  <Text style={styles.mobileLoadingText}>
                    Generating Mobile View…
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* ── Inline edit-mode entry overlay ───────────────────────── */}
      {state.editLoading && (
        <View style={styles.editLoadingOverlay}>
          <ActivityIndicator size="large" color={Palette.white} />
          <Text style={styles.editLoadingText}>
            {state.editLoadingElapsed < 3
              ? "Uploading PDF…"
              : state.editLoadingElapsed < 15
                ? "Extracting text…"
                : state.editLoadingElapsed < 45
                  ? "Still working…"
                  : "Almost there…"}
          </Text>
          <Text style={styles.editLoadingElapsed}>
            {state.editLoadingElapsed}s
          </Text>
          <Pressable
            onPress={cancelEditLoading}
            style={styles.editCancelLoadingBtn}
          >
            <Text style={styles.editCancelLoadingText}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {/* ── Selection toolbar — rendered at SafeAreaView level so it always
           appears above the WebView on Android (avoids z-index layer issues).
           Rect y is offset by headerHeight because the toolbar is positioned
           relative to the SafeAreaView, but the rect is relative to the WebView
           container (which starts below the header). */}
      <SelectionToolbar
        visible={state.selectionVisible && (isMobileView || usePageView) && !state.editMode}
        selectedText={state.selectionText}
        rect={
          state.selectionRect
            ? { ...state.selectionRect, y: state.selectionRect.y + headerHeight }
            : null
        }
        onHighlight={handleSelectionHighlight}
        onUnderline={handleSelectionUnderline}
        onStrikethrough={handleSelectionStrikethrough}
        onCopy={handleSelectionCopy}
        onSearch={handleSelectionAskAthemi}
        onDismiss={handleSelectionDismiss}
      />

      {/* ── Fullscreen exit hint ───────────────────────────────── */}
      {state.fullscreen && showFullscreenIndicator && (
        <Pressable style={styles.fullscreenExitHint} onPress={toggleFullscreen}>
          <View style={styles.fullscreenExitPill}>
            <MaterialIcons name="fullscreen-exit" size={18} color="#fff" />
            <Text style={styles.fullscreenExitText}>
              Page {state.pageInfo.current}/{state.pageInfo.total}
            </Text>
          </View>
        </Pressable>
      )}

      {/* ── Page jump modal ────────────────────────────────────── */}
      <PageJumpModal
        visible={state.showGoToPage}
        currentPage={state.pageInfo.current}
        totalPages={state.pageInfo.total || 1}
        theme={theme}
        onClose={() => setState((prev) => ({ ...prev, showGoToPage: false }))}
        onJumpToPage={handleGoToPage}
      />

      {/* ── Thumbnail grid ─────────────────────────────────────── */}
      {state.normalizedUri && (
        <ThumbnailGrid
          visible={state.showThumbnails}
          source={{ uri: state.normalizedUri, cache: true }}
          totalPages={state.pageInfo.total || 1}
          currentPage={state.pageInfo.current}
          theme={theme}
          onClose={() =>
            setState((prev) => ({ ...prev, showThumbnails: false }))
          }
          onSelectPage={handleGoToPage}
        />
      )}

      {/* ── Three dots menu ────────────────────────────────────── */}
      <ThreeDotsMenu
        visible={state.showMenu}
        onClose={() => setState((prev) => ({ ...prev, showMenu: false }))}
        theme={theme}
        fileType="pdf"
        onShare={handleShare}
        onSearchText={handleOpenSearch}
        onReadAloud={handleReadAloud}
        onChatWithFile={handleChatWithFile}
        onAnalyze={handleAnalyze}
        onLockFile={handleLockFile}
        onEditFile={handleEditFile}
        onDelete={handleDelete}
        onStar={handleStar}
        isStarred={state.isStarred}
      />

      <AnalyzeSheet
        visible={showAnalyze}
        onClose={() => setShowAnalyze(false)}
        file={uri ? { uri, name: name || "Document.pdf", mimeType: "application/pdf" } : null}
      />

      {/* ── PDF Text Extractor (hidden) — feeds Read Aloud AND Search,
           fully independent of Mobile View. Activates when either feature
           needs text; extracted texts are cached for reuse. */}
      <PDFTextExtractor
        uri={state.normalizedUri ?? null}
        active={
          // Read Aloud only needs the extractor if text isn't cached yet
          // (a completed pre-warm leaves it populated → no re-extraction).
          (state.readAloudActive && state.readAloudPageTexts.length === 0) ||
          state.searchExtracting ||
          state.prewarmExtract
        }
        onProgress={(pageTexts) => {
          // Stream pages into Read Aloud as they extract so playback can start
          // on page 1 without waiting for the whole document. During a silent
          // pre-warm (no UI open yet) we ALSO accumulate, so that text is ready
          // the instant the user taps Read Aloud. Search still waits for the
          // final onPageTexts aggregate below.
          if (!state.readAloudActive && !state.prewarmExtract) return;
          setState((prev) => ({ ...prev, readAloudPageTexts: pageTexts }));
        }}
        onPageTexts={(pageTexts) => {
          // Resolve any pending search that triggered this extraction
          const pending = pendingSearchQueryRef.current;
          pendingSearchQueryRef.current = null;

          let matchPages: number[] = [];
          if (pending && pending.trim()) {
            const q = pending.toLowerCase();
            matchPages = pageTexts.reduce<number[]>((acc, text, i) => {
              if (text.toLowerCase().includes(q)) acc.push(i + 1);
              return acc;
            }, []);
          }

          setState((prev) => ({
            ...prev,
            readAloudPageTexts: pageTexts,
            searchExtracting: false,
            // Pre-warm done: unmount the hidden extractor to free memory. The
            // extracted text stays cached in readAloudPageTexts for instant use.
            prewarmExtract: false,
            ...(pending != null
              ? { searchMatchPages: matchPages, searchPageIndex: 0 }
              : {}),
          }));

          if (matchPages.length > 0) setTargetPage(matchPages[0]);
        }}
        onError={(msg) => {
          if (__DEV__) console.warn("[PDFTextExtractor]", msg);
          // Clear extraction state so the UI doesn't stay in loading forever.
          // A failed pre-warm is silent — the user can still tap Read Aloud,
          // which re-tries extraction with its own visible "Preparing…" state.
          pendingSearchQueryRef.current = null;
          setState((prev) => ({
            ...prev,
            searchExtracting: false,
            prewarmExtract: false,
          }));
        }}
      />

      {/* ── Read Aloud controller ──────────────────────────────── */}
      <ReadAloudController
        pageTexts={
          state.readAloudPageTexts.length > 0
            ? state.readAloudPageTexts
            : undefined
        }
        colorScheme={colorScheme}
        active={state.readAloudActive}
        onRequestClose={() =>
          setState((prev) => ({
            ...prev,
            readAloudActive: false,
            readAloudPageTexts: [],
          }))
        }
        documentId={uri}
        documentName={name}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// HEADER COMPONENT
// ============================================================================
interface HeaderProps {
  name: string;
  theme: typeof LightTheme;
  onClose: () => void;
  pageInfo?: { current: number; total: number };
  onPagePress?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  readingMode: ReadingMode;
  onToggleReadingMode: () => void;
  onMenuPress: () => void;
  mobileLoading: boolean;
}

function Header({
  name,
  theme,
  onClose,
  pageInfo,
  onPagePress,
  viewMode,
  onViewModeChange,
  readingMode,
  onToggleReadingMode,
  onMenuPress,
  mobileLoading,
}: HeaderProps) {
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: theme.surface.primary,
          borderBottomColor: theme.border.light,
        },
      ]}
    >
      {/* ── Left: Back / Close ──────────────────────────────────── */}
      <Pressable onPress={onClose} style={styles.headerButton} hitSlop={6}>
        <MaterialIcons name="close" size={26} color={theme.text.primary} />
      </Pressable>

      {/* ── Center: Filename + page indicator ──────────────────── */}
      <Pressable
        style={styles.headerCenter}
        onPress={pageInfo ? onPagePress : undefined}
      >
        <Text
          style={[styles.headerTitle, { color: theme.text.primary }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {name}
          {pageInfo ? (
            <Text
              style={{
                color: theme.text.secondary,
                fontWeight: Typography.weight.regular,
              }}
            >
              {" "}
              · Page {pageInfo.current}/{pageInfo.total}
            </Text>
          ) : null}
        </Text>
        {pageInfo && (
          <Text
            style={[styles.headerPageHint, { color: Palette.primary[500] }]}
          >
            Tap to jump ▾
          </Text>
        )}
      </Pressable>

      {/* ── Right: View toggle + reading mode + menu ───────────── */}
      <View style={styles.headerActions}>
        {/* Mobile / Normal view toggle */}
        <ViewModeToggle
          mode={viewMode}
          onModeChange={onViewModeChange}
          disabled={mobileLoading}
        />

        {/* Continuous / Facing toggle */}
        <Pressable
          onPress={onToggleReadingMode}
          style={styles.headerButton}
          hitSlop={6}
        >
          <MaterialIcons
            name={readingMode === "continuous" ? "view-day" : "view-carousel"}
            size={22}
            color={theme.text.primary}
          />
        </Pressable>

        {/* Three dots menu */}
        <Pressable
          onPress={onMenuPress}
          style={styles.headerButton}
          hitSlop={6}
        >
          <MaterialIcons
            name="more-vert"
            size={24}
            color={theme.text.primary}
          />
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  mobileLoadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  editorToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  editorTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  editorTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2563eb",
  },
  editorCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editorCancelText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
  },
  editorSaveBtn: {
    minWidth: 72,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
  },
  editorSaveBtnDisabled: {
    opacity: 0.6,
  },
  editorSaveText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  editLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 200,
  },
  editLoadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#fff",
    fontWeight: "600",
  },
  editLoadingElapsed: {
    marginTop: 4,
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "500",
  },
  editCancelLoadingBtn: {
    marginTop: 20,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
  },
  editCancelLoadingText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.xs,
  },
  headerTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    textAlign: "center",
  },
  headerPageHint: {
    fontSize: 10,
    fontWeight: Typography.weight.medium,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  loadingText: {
    fontSize: Typography.size.base,
    marginTop: Spacing.md,
  },
  errorTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    fontSize: Typography.size.base,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  passwordInput: {
    width: "80%",
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: Typography.size.base,
    marginBottom: Spacing.lg,
    textAlign: "center",
  },
  errorActions: {
    gap: Spacing.md,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 12,
  },
  retryButtonText: {
    color: Palette.white,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  externalButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 12,
    borderWidth: 1,
  },
  externalButtonText: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
  },
  fullscreenExitHint: {
    position: "absolute",
    top: 48,
    alignSelf: "center",
    zIndex: 10,
  },
  fullscreenExitPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  fullscreenExitText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500" as const,
    letterSpacing: 0.3,
  },
  fullscreenTapArea: {
    position: "absolute",
    top: "30%",
    bottom: "30%",
    left: "20%",
    right: "20%",
  },
  // ── Search bar ──
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  searchClose: {
    padding: 4,
  },
  searchCount: {
    fontSize: 12,
    marginHorizontal: 4,
  },
  // ── Search results panel ──
  searchResultsPanel: {
    maxHeight: 180,
    borderBottomWidth: 1,
  },
  searchResultsScroll: {
    flex: 1,
  },
  searchResultItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  searchResultPage: {
    fontSize: 11,
    fontWeight: "600" as const,
    marginBottom: 2,
  },
  searchResultSnippet: {
    fontSize: 13,
    lineHeight: 18,
  },
  searchResultMatch: {
    backgroundColor: "#FFD600",
    color: "#000",
    borderRadius: 2,
  },
});
