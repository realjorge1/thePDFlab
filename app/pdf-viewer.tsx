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
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
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
import { PDFTextExtractor } from "@/components/DocumentViewer/PDFTextExtractor";
import { SelectionToolbar } from "@/components/DocumentViewer/SelectionToolbar";
import { ThreeDotsMenu } from "@/components/DocumentViewer/ThreeDotsMenu";
import { ViewModeToggle } from "@/components/DocumentViewer/ViewModeToggle";
import { PageJumpModal } from "@/components/pdf/PageJumpModal";
import { ThumbnailGrid } from "@/components/pdf/ThumbnailGrid";
import {
  PdfRecoveryAction,
  PdfRecoveryScreen,
} from "@/components/PdfRecoveryScreen";
import { ReadAloudController } from "@/components/ReadAloudController";
import type { ViewMode } from "@/src/types/document-viewer.types";

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
import { repairPdfViaBackend } from "@/services/pdfRepairClient";
import { validatePdfFile } from "@/services/pdfValidationService";
import { recycleFile } from "@/services/recycleBinService";

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
  // ── Star ──
  isStarred: boolean;
  fileId: string | null;
  // ── Text selection toolbar ──
  selectionVisible: boolean;
  selectionText: string;
  selectionRect: { x: number; y: number; width: number; height: number } | null;
  selectionOffsets: { startOffset: number; endOffset: number } | null;
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

  const { uri, name } = useLocalSearchParams<{ uri: string; name: string }>();

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
    isStarred: false,
    fileId: null,
    selectionVisible: false,
    selectionText: "",
    selectionRect: null,
    selectionOffsets: null,
  });

  const [passwordInput, setPasswordInput] = useState("");
  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);
  const [showFullscreenIndicator, setShowFullscreenIndicator] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const isMountedRef = useRef(true);
  const mobileRendererRef = useRef<MobileRendererHandle>(null);
  /** Holds a search query that arrived before text extraction completed. */
  const pendingSearchQueryRef = useRef<string | null>(null);

  // ── Lifecycle ────────────────────────────────────────────────────
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
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
    normalizeUri();
    checkStarStatus();
  }, [uri]);

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
      }));

      const normalized = await normalizePdfUri(uri);
      if (!isMountedRef.current) return;

      const validation = await validatePdfFile(normalized);
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

      setState((prev) => ({
        ...prev,
        normalizedUri: normalized,
        loading: false,
      }));
    } catch (error) {
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
  const handlePdfLoadComplete = useCallback((numberOfPages: number) => {
    if (!isMountedRef.current) return;
    setState((prev) => ({
      ...prev,
      pageInfo: { ...prev.pageInfo, total: numberOfPages },
    }));
  }, []);

  const handlePageChanged = useCallback(
    (page: number, numberOfPages: number) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        pageInfo: { current: page, total: numberOfPages },
      }));
    },
    [],
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

  const handlePasswordSubmit = useCallback(() => {
    if (!passwordInput.trim()) {
      Alert.alert("Error", "Please enter a password.");
      return;
    }
    Alert.alert(
      "Password Protected",
      "This PDF is password protected. Please use an external PDF viewer to open this file.",
      [
        { text: "Cancel", style: "cancel", onPress: () => router.back() },
        { text: "Open Externally", onPress: () => handleOpenWithSystem() },
      ],
    );
  }, [passwordInput, handleOpenWithSystem]);

  const handleRetry = useCallback(() => {
    normalizeUri();
  }, [uri]);

  // ── View mode toggle (Mobile ↔ Normal) ──────────────────────────
  const handleViewModeChange = useCallback(
    async (newMode: ViewMode) => {
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
        Alert.alert(
          "Mobile View Unavailable",
          "Mobile View requires Android 10 or newer. Your device will continue to work in Normal View.",
        );
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
          Alert.alert(
            "Mobile View",
            result.message || "Mobile View not available for this PDF.",
          );
          setState((prev) => ({ ...prev, mobileLoading: false }));
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        Alert.alert("Mobile View", "Failed to generate Mobile View.");
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

  // ── Edit File ────────────────────────────────────────────────────
  const handleEditFile = useCallback(() => {
    router.push({
      pathname: "/tool-processor",
      params: {
        tool: "edit",
        fileUri: uri,
        file: name,
        fileMimeType: "application/pdf",
      },
    });
  }, [uri, name]);

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
    }
  }, []);

  // ── Selection toolbar actions ────────────────────────────────────
  const handleSelectionHighlight = useCallback(
    (colorHex: string) => {
      const { selectionOffsets, selectionText } = state;
      if (!selectionOffsets) return;
      const id = `hl_${Date.now()}`;
      mobileRendererRef.current?.bridgeHighlight(
        id,
        selectionOffsets.startOffset,
        selectionOffsets.endOffset,
        colorHex,
      );
    },
    [state.selectionOffsets, state.selectionText],
  );

  const handleSelectionUnderline = useCallback(() => {
    const { selectionOffsets } = state;
    if (!selectionOffsets) return;
    const id = `ul_${Date.now()}`;
    mobileRendererRef.current?.bridgeUnderline(
      id,
      selectionOffsets.startOffset,
      selectionOffsets.endOffset,
    );
  }, [state.selectionOffsets]);

  const handleSelectionStrikethrough = useCallback(() => {
    const { selectionOffsets } = state;
    if (!selectionOffsets) return;
    const id = `st_${Date.now()}`;
    mobileRendererRef.current?.bridgeStrikethrough(
      id,
      selectionOffsets.startOffset,
      selectionOffsets.endOffset,
    );
  }, [state.selectionOffsets]);

  const handleSelectionCopy = useCallback(() => {
    mobileRendererRef.current?.bridgeCopySelection();
  }, []);

  const handleSelectionShare = useCallback(async () => {
    if (!state.selectionText) return;
    try {
      const { Share } = await import("react-native");
      await Share.share({ message: state.selectionText });
    } catch {
      /* non-critical */
    }
  }, [state.selectionText]);

  const handleSelectionAskAthemi = useCallback(() => {
    if (!state.selectionText) return;
    router.push({ pathname: "/ai", params: { prompt: state.selectionText } });
    setState((prev) => ({ ...prev, selectionVisible: false }));
  }, [state.selectionText]);

  const handleSelectionDismiss = useCallback(() => {
    mobileRendererRef.current?.bridgeClearSelection();
    setState((prev) => ({
      ...prev,
      selectionVisible: false,
      selectionText: "",
      selectionRect: null,
      selectionOffsets: null,
    }));
  }, []);

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

      {/* ── Document content ───────────────────────────────────── */}
      {state.normalizedUri && (
        <View style={{ flex: 1 }}>
          {isMobileView ? (
            <MobileRenderer
              ref={mobileRendererRef}
              html={state.mobileHtml}
              loading={state.mobileLoading}
              error={state.mobileError}
              onMessage={handleMobileMessage}
            />
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

      {/* ── Selection toolbar — rendered at SafeAreaView level so it always
           appears above the WebView on Android (avoids z-index layer issues).
           Rect y is offset by headerHeight because the toolbar is positioned
           relative to the SafeAreaView, but the rect is relative to the WebView
           container (which starts below the header). */}
      <SelectionToolbar
        visible={state.selectionVisible && isMobileView}
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
        onShare={handleSelectionShare}
        onAskAthemi={handleSelectionAskAthemi}
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
        onLockFile={handleLockFile}
        onEditFile={handleEditFile}
        onDelete={handleDelete}
        onStar={handleStar}
        isStarred={state.isStarred}
      />

      {/* ── PDF Text Extractor (hidden) — feeds Read Aloud AND Search,
           fully independent of Mobile View. Activates when either feature
           needs text; extracted texts are cached for reuse. */}
      <PDFTextExtractor
        uri={state.normalizedUri ?? null}
        active={state.readAloudActive || state.searchExtracting}
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
            ...(pending != null
              ? { searchMatchPages: matchPages, searchPageIndex: 0 }
              : {}),
          }));

          if (matchPages.length > 0) setTargetPage(matchPages[0]);
        }}
        onError={(msg) => {
          if (__DEV__) console.warn("[PDFTextExtractor]", msg);
          // Clear extraction state so the UI doesn't stay in loading forever
          pendingSearchQueryRef.current = null;
          setState((prev) => ({ ...prev, searchExtracting: false }));
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
});
