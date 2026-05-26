import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { FolderOpen, Grid3x3, List, Search } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PINGate } from "@/components/PINGate";
import { ProgressRing } from "@/components/ProgressRing";
import { colors } from "@/constants/theme";
import { useFileIndex } from "@/hooks/useFileIndex";
import { useReadingProgressFor } from "@/hooks/useReadingProgress";
import { upsertFileRecord } from "@/services/fileIndexService";
import {
  useDocuments as useDocLibDocuments,
  useFolders as useDocLibFolders,
  useIndexingStatus as useDocLibIndexingStatus,
} from "@/hooks/useDocLib";
import docLibDb from "@/services/doclib/database";
import docLibIndexer from "@/services/doclib/fileIndexer";
import {
  SUPPORTED_FILE_TYPES,
  fileMatchesSearch,
  formatFileSize,
  formatRelativeTime,
  getFileTypeConfig,
  openWithSystemApp,
  pickFilesWithResult,
  showOpenFailedAlert,
  useQuickAccess,
  type QuickAccessFile,
} from "@/services/document-manager";
import { getPinnedFileIds } from "@/services/filePinService";
import {
  addToFavorites,
  getFavorites,
  removeFromFavorites,
} from "@/services/fileService";
import {
  getAllFolders,
  moveFileToFolder,
  removeFileFromAllFolders,
  type Folder,
} from "@/services/folderService";
import { recycleFile } from "@/services/recycleBinService";
import { cleanFileName, syncSafFoldersToAppFolders } from "@/services/safFolderSync";
import { useTheme } from "@/services/ThemeProvider";

const VIEW_MODE_KEY = "@wordsinscribed_library_view_mode";
const SORT_BY_KEY = "@wordsinscribed_library_sort_by";

type SortBy = "size" | "dateAdded" | "dateModified" | "name" | "recentlyOpened";

const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: "size", label: "Size (largest first)" },
  { key: "dateAdded", label: "Date added (newest)" },
  { key: "dateModified", label: "Date modified (newest)" },
  { key: "recentlyOpened", label: "Recently opened" },
  { key: "name", label: "Name (A → Z)" },
];

function getTypeBgColor(color: string): string {
  if (color === colors.pdf) return "#FEE2E2";
  if (color === colors.word) return "#DBEAFE";
  if (color === colors.excel) return "#D1FAE5";
  if (color === colors.ppt) return "#FFEDD5";
  if (color === colors.image) return "#F3E8FF";
  if (color === colors.epub) return "#EDE9FE";
  return "#EEF2FF";
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ============================================================================
// FILTER TYPES
// ============================================================================
type TypeFilter = "all" | "pdf" | "docx" | "ppt" | "epub";
type SourceFilter =
  | "all"
  | "created"
  | "imported"
  | "downloaded"
  | "shared"
  | "favorites";
type ViewMode = "list" | "grid";

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function LibraryScreen() {
  const { colors: t, mode } = useTheme();
  const colorScheme = mode;
  const backgroundColor = t.background;
  const textColor = t.text;
  const primaryColor = t.primary;

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // ── Mark mode (multi-select) ───────────────────────────────────────────────
  const [markMode, setMarkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Long-press action sheet ────────────────────────────────────────────────
  const [actionFile, setActionFile] = useState<QuickAccessFile | null>(null);

  // ── Toast notification ─────────────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // longPressTimerRef removed — using Pressable onLongPress instead

  // ── Pinned file IDs ────────────────────────────────────────────────────────
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  // ── Favorites ─────────────────────────────────────────────────────────────
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  // ── Grid / List view ──────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // ── Sort by ───────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<SortBy>("size");
  const [showSortMenu, setShowSortMenu] = useState(false);

  // ── Folder picker for "Move to Folder" ────────────────────────────────────
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderPickerFile, setFolderPickerFile] =
    useState<QuickAccessFile | null>(null);
  const [availableFolders, setAvailableFolders] = useState<Folder[]>([]);

  // ── Navigation params ─────────────────────────────────────────────────────
  const { sourceFilter: sourceFilterParam } = useLocalSearchParams<{
    sourceFilter?: string;
  }>();
  // Track the last param value we applied so navigating back without a param
  // does NOT reset a filter the user manually selected.
  const appliedSourceFilterParam = useRef<string | undefined>(undefined);

  // Library hook (legacy)
  const {
    files: legacyFiles,
    isLoading: legacyLoading,
    addFile,
    removeFile,
    updateLastOpened,
    refresh: refreshLegacy,
  } = useQuickAccess();

  // Unified file index hook
  const {
    files: indexFiles,
    isLoading: indexLoading,
    refresh: refreshIndex,
    updateLastOpened: updateIndexLastOpened,
    removeFile: removeIndexFile,
    clearAllIncludingDownloads,
    clearAllExceptDownloads,
  } = useFileIndex();

  // ── DocLib (SAF folder-indexed documents) ────────────────────────────────
  const { documents: doclibDocs, refetch: refetchDoclib } = useDocLibDocuments();
  const { folders: doclibFolders, addFolder: addDoclibFolder } =
    useDocLibFolders();
  const indexingStatus = useDocLibIndexingStatus();

  // Combine files from all sources (deduplicated by URI)
  const files = useMemo(() => {
    const uriMap = new Map<string, QuickAccessFile>();

    // Add legacy files first
    for (const file of legacyFiles) {
      uriMap.set(file.uri, file);
    }

    // Add unified index files (may override or add new ones)
    for (const indexFile of indexFiles) {
      if (!uriMap.has(indexFile.uri)) {
        // Convert UnifiedFileRecord to QuickAccessFile format
        const converted: QuickAccessFile = {
          id: indexFile.id,
          uri: indexFile.uri,
          originalUri: indexFile.originalUri || indexFile.uri,
          displayName: indexFile.name,
          extension: indexFile.extension,
          mimeType: indexFile.mimeType,
          size: indexFile.size,
          lastOpenedAt: indexFile.lastOpenedAt,
          dateAdded: indexFile.createdAt,
          source: indexFile.source === "created" ? "created" : "picked",
          isSafUri: indexFile.isSafUri || false,
          cacheValid: indexFile.cacheValid,
          // Store source tags for filtering
          _sourceTags: indexFile.sourceTags,
          _type: indexFile.type,
        } as QuickAccessFile & { _sourceTags?: string[]; _type?: string };
        uriMap.set(indexFile.uri, converted);
      }
    }

    // Add doclib (SAF folder-scanned) documents
    for (const doc of doclibDocs) {
      if (!uriMap.has(doc.uri)) {
        const cleanName = cleanFileName(doc.name);
        const ext =
          cleanName.includes(".")
            ? cleanName.split(".").pop()?.toLowerCase() ?? ""
            : doc.type;
        const converted: QuickAccessFile = {
          id: `saf:${doc.uri}`,
          uri: doc.uri,
          originalUri: doc.uri,
          displayName: cleanName,
          extension: ext,
          mimeType: doc.mimeType,
          size: doc.size,
          lastOpenedAt: doc.lastOpened ?? doc.lastModified,
          dateAdded: doc.lastModified,
          source: "picked",
          isSafUri: true,
          cacheValid: true,
          _sourceTags: ["imported"],
          _type: doc.type,
          _isSaf: true,
          _lastModified: doc.lastModified,
        } as QuickAccessFile & {
          _sourceTags?: string[];
          _type?: string;
          _isSaf?: boolean;
          _lastModified?: number;
        };
        uriMap.set(doc.uri, converted);
      }
    }

    // Sort by lastOpenedAt
    return Array.from(uriMap.values()).sort(
      (a, b) => b.lastOpenedAt - a.lastOpenedAt,
    );
  }, [legacyFiles, indexFiles, doclibDocs]);

  const isLoading = legacyLoading || indexLoading;

  // Refresh all sources
  const refresh = useCallback(async () => {
    await Promise.all([refreshLegacy(), refreshIndex(), refetchDoclib()]);
  }, [refreshLegacy, refreshIndex, refetchDoclib]);

  // Refresh on focus + sync SAF folders → app folders
  useFocusEffect(
    useCallback(() => {
      refresh();
      getFavorites().then(setFavoriteIds);
      // Idempotent: creates/updates app folders for every SAF-watched folder
      syncSafFoldersToAppFolders().catch(console.warn);
    }, [refresh]),
  );

  // ── Load pins, favorites, view mode on mount ────────────────────────────
  useEffect(() => {
    getPinnedFileIds().then(setPinnedIds);
    getFavorites().then(setFavoriteIds);
    AsyncStorage.getItem(VIEW_MODE_KEY).then((v) => {
      if (v === "grid" || v === "list") setViewMode(v);
    });
    AsyncStorage.getItem(SORT_BY_KEY).then((v) => {
      if (
        v === "size" ||
        v === "dateAdded" ||
        v === "dateModified" ||
        v === "name" ||
        v === "recentlyOpened"
      ) {
        setSortBy(v);
      }
    });
  }, []);

  // ── Apply sourceFilter navigation param ──────────────────────────────────
  // Fires whenever the param changes (e.g. navigated here via Downloads button).
  // Uses a ref to avoid overriding a user-selected filter when re-visiting via
  // the Library tab icon (which carries no param).
  useEffect(() => {
    if (!sourceFilterParam) return;
    if (sourceFilterParam === appliedSourceFilterParam.current) return;
    const valid: SourceFilter[] = [
      "all",
      "created",
      "imported",
      "downloaded",
      "shared",
      "favorites",
    ];
    if (valid.includes(sourceFilterParam as SourceFilter)) {
      appliedSourceFilterParam.current = sourceFilterParam;
      setSourceFilter(sourceFilterParam as SourceFilter);
    }
  }, [sourceFilterParam]);

  // ── Auto-dismiss toast after 2.5 s ───────────────────────────────────────
  useEffect(() => {
    if (!toastMsg) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2500);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toastMsg]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleImportFile = useCallback(async () => {
    // Use the improved file picker with detailed result
    const result = await pickFilesWithResult({
      types: [
        ...SUPPORTED_FILE_TYPES.ALL_DOCUMENTS,
        ...SUPPORTED_FILE_TYPES.ALL_IMAGES,
      ],
      multiple: false,
      copyToCacheDirectory: true,
      showAlerts: true,
    });

    // Handle cancellation
    if (result.cancelled) {
      return;
    }

    // Handle errors
    if (!result.success || result.files.length === 0) {
      console.log("[Library] File import failed or no files selected");
      return;
    }

    // Add the picked file to library
    const picked = result.files[0];
    const addResult = await addFile({
      uri: picked.uri,
      displayName: picked.name,
      mimeType: picked.mimeType,
      size: picked.size,
      source: "picked",
    });

    if (!addResult.success) {
      Alert.alert(
        "Import Error",
        addResult.error || "Failed to import file. Please try again.",
        [{ text: "OK" }],
      );
    }
  }, [addFile]);

  const handleAccessFolder = useCallback(async () => {
    try {
      const result = await addDoclibFolder();
      if (result) {
        await refetchDoclib();
        setToastMsg(`Connected ${result.displayName}`);
        // Create matching app folder and map its files immediately
        syncSafFoldersToAppFolders().catch(console.warn);
      }
    } catch (e: any) {
      Alert.alert(
        "Folder Access Failed",
        e?.message ?? "Could not access the selected folder.",
      );
    }
  }, [addDoclibFolder, refetchDoclib]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Re-scan SAF folders before refreshing the merged list
      if (doclibFolders.length > 0) {
        await docLibIndexer.runFullScan();
      }
    } catch (e) {
      console.warn("[Library] doclib scan failed:", e);
    }
    await refresh();
    setRefreshing(false);
  }, [refresh, doclibFolders.length]);

  const handleFilePress = useCallback(
    async (file: QuickAccessFile) => {
      // Check if this is a viewable file type
      const extension = file.extension?.toLowerCase();
      const isImage = ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(
        extension,
      );
      const isPdf = extension === "pdf";
      const isDocx = extension === "docx" || extension === "doc";
      const isEpub = extension === "epub";

      // Update last opened timestamp in both systems
      await updateLastOpened(file.id);

      // SAF doclib files live in their own store and aren't in the unified
      // index until first tap. Upsert here so progress + recent tracking
      // work; upsertFileRecord already bumps lastOpenedAt for existing rows.
      const isSafDoclib =
        (file as any)._isSaf === true || file.id.startsWith("saf:");
      if (isSafDoclib) {
        upsertFileRecord({
          uri: file.uri,
          name: file.displayName,
          extension: file.extension,
          mimeType: file.mimeType,
          size: file.size,
          isSafUri: true,
          sourceTags: ["imported"],
        }).catch(console.error);
      } else {
        updateIndexLastOpened(file.id).catch(console.error);
      }

      // expo-router decodes URI-encoded params on read, which corrupts SAF
      // tree-document URIs whose document IDs contain literal '/' (the slash
      // gets interpreted as a path separator → Android resolves the URI as a
      // directory → EISDIR). Wrap with encodeURIComponent before push so the
      // viewer's decodeURIComponent yields the original encoded URI.
      const safeUri = encodeURIComponent(file.uri);

      if (isImage) {
        // Navigate to image viewer
        router.push({
          pathname: "/image-viewer",
          params: {
            uri: safeUri,
            name: file.displayName,
            type: file.mimeType || "image/jpeg",
          },
        });
      } else if (isPdf) {
        // Navigate to in-app PDF viewer
        router.push({
          pathname: "/pdf-viewer",
          params: {
            uri: safeUri,
            name: file.displayName,
          },
        });
      } else if (isDocx) {
        // Navigate to in-app DOCX viewer
        (router as any).push({
          pathname: "/docx-viewer",
          params: {
            uri: safeUri,
            name: file.displayName,
          },
        });
      } else if (isEpub) {
        // Navigate to in-app EPUB viewer
        router.push({
          pathname: "/epub-viewer",
          params: {
            uri: safeUri,
            name: file.displayName,
          },
        });
      } else if (extension === "pptx" || extension === "ppt") {
        // Navigate to in-app PPT viewer
        router.push({
          pathname: "/ppt-viewer",
          params: {
            uri: safeUri,
            name: file.displayName,
          },
        });
      } else if (extension === "pdflab") {
        // Legacy encrypted .pdflab file — offer to decrypt
        Alert.alert(
          "Encrypted File",
          "This file uses a legacy encryption format. Decrypt it to view as a standard PDF.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Decrypt",
              onPress: () =>
                router.push({
                  pathname: "/tool-processor",
                  params: {
                    tool: "decrypt",
                    file: file.displayName,
                    fileUri: file.uri,
                    fileMimeType: "application/octet-stream",
                  },
                }),
            },
          ],
        );
      } else {
        // For other file types, use system app
        const result = await openWithSystemApp({
          uri: file.uri,
          mimeType: file.mimeType,
          displayName: file.displayName,
        });

        if (!result.success) {
          showOpenFailedAlert(file.displayName, result.error);
        }
      }
    },
    [updateLastOpened, updateIndexLastOpened],
  );

  // Long-press enters selection mode directly (standard behavior)
  const handleFileLongPress = useCallback(
    (file: QuickAccessFile) => {
      if (!markMode) {
        setMarkMode(true);
        setSelectedIds(new Set([file.id]));
      }
    },
    [markMode],
  );

  const handleClearAll = useCallback(() => {
    if (files.length === 0) return;

    Alert.alert(
      "Clear All Files",
      "Permanently delete ALL files from Library, Downloads, Folders, and device storage? This cannot be undone and files will NOT be sent to the Recycle Bin.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            await clearAllIncludingDownloads();
            await Promise.all([refreshLegacy(), refreshIndex()]);
            setFavoriteIds(new Set());
          },
        },
      ],
    );
  }, [files.length, clearAllIncludingDownloads, refreshLegacy, refreshIndex]);

  // ── Mark-mode / multi-select handlers ───────────────────────────────────────

  const handleExitMarkMode = useCallback(() => {
    setMarkMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    const msg = count === 1 ? "Delete this file?" : `Delete ${count} files?`;
    Alert.alert("Confirm Delete", msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const snapshot = Array.from(selectedIds);
          let failed = 0;
          let removedSaf = false;
          for (const id of snapshot) {
            const file = files.find((f) => f.id === id);
            if (!file) continue;
            try {
              if ((file as any)._isSaf) {
                // SAF-indexed file: just drop from doclib index (we don't own it)
                await docLibDb.removeDocument(file.uri);
                removedSaf = true;
              } else {
                await recycleFile({
                  id: file.id,
                  name: file.displayName,
                  uri: file.uri,
                  size: file.size || 0,
                  type: (file as any)._type || file.extension || "unknown",
                  mimeType: file.mimeType || "application/octet-stream",
                  source: file.source,
                });
                removeFile(file.id);
                await removeIndexFile(file.id);
                await removeFileFromAllFolders(file.id).catch(console.error);
              }
            } catch {
              failed++;
            }
          }
          if (removedSaf) await refetchDoclib();
          setMarkMode(false);
          setSelectedIds(new Set());
          if (failed > 0) {
            setToastMsg(
              `${failed} file${failed > 1 ? "s" : ""} could not be deleted.`,
            );
          }
        },
      },
    ]);
  }, [selectedIds, files, removeFile, removeIndexFile, refetchDoclib]);

  const handleBulkShare = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const file = files.find((f) => f.id === ids[0]);
    if (!file) return;
    try {
      const Sharing = await import("expo-sharing");
      const mod = (Sharing as any).default ?? Sharing;
      await mod.shareAsync(file.uri, {
        mimeType: file.mimeType || "application/octet-stream",
        dialogTitle: `Share ${file.displayName}`,
      });
      setMarkMode(false);
      setSelectedIds(new Set());
    } catch {
      setToastMsg("Failed to share file.");
    }
  }, [selectedIds, files]);

  // ── Sort selection ───────────────────────────────────────────────────────
  const handleSelectSort = useCallback((value: SortBy) => {
    setSortBy(value);
    setShowSortMenu(false);
    AsyncStorage.setItem(SORT_BY_KEY, value).catch(console.error);
  }, []);

  // ── View mode toggle ─────────────────────────────────────────────────────
  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "list" ? "grid" : "list";
      AsyncStorage.setItem(VIEW_MODE_KEY, next).catch(console.error);
      return next;
    });
  }, []);

  // ── Favorite toggle ─────────────────────────────────────────────────────
  const handleToggleFavorite = useCallback(
    async (file: QuickAccessFile) => {
      setActionFile(null);
      const isFav = favoriteIds.has(file.id);
      try {
        if (isFav) {
          await removeFromFavorites(file.id);
          setToastMsg(`Removed from favorites`);
        } else {
          await addToFavorites(file.id);
          setToastMsg(`Added to favorites`);
        }
        const updated = await getFavorites();
        setFavoriteIds(updated);
      } catch {
        setToastMsg("Failed to update favorite");
      }
    },
    [favoriteIds],
  );

  // ── Move to Folder ──────────────────────────────────────────────────────
  const handleMoveToFolder = useCallback(async (file: QuickAccessFile) => {
    setActionFile(null);
    try {
      const folders = await getAllFolders();
      setAvailableFolders(folders);
      setFolderPickerFile(file);
      setShowFolderPicker(true);
    } catch {
      setToastMsg("Failed to load folders");
    }
  }, []);

  const handleSelectFolder = useCallback(
    async (folderId: string | null) => {
      if (!folderPickerFile) return;
      try {
        await moveFileToFolder(folderPickerFile.id, folderId);
        setShowFolderPicker(false);
        setFolderPickerFile(null);
        setToastMsg(folderId ? `Moved to folder` : `Removed from folder`);
      } catch {
        setToastMsg("Failed to move file");
      }
    },
    [folderPickerFile],
  );

  // ── Rename file ─────────────────────────────────────────────────────────
  const handleRenameFile = useCallback((file: QuickAccessFile) => {
    setActionFile(null);
    Alert.prompt?.(
      "Rename File",
      "Enter a new name:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rename",
          onPress: async (newName?: string) => {
            if (!newName?.trim()) return;
            // Note: Renaming in the unified index would need additional implementation
            // For now, show toast indicating the limitation
            setToastMsg("Rename coming soon");
          },
        },
      ],
      "plain-text",
      file.displayName,
    ) ??
      // Android fallback — Alert.prompt is iOS-only
      setToastMsg("Rename is available via File Info");
  }, []);

  // ── Action-sheet item handlers ───────────────────────────────────────────

  const handleActionShare = useCallback(async (file: QuickAccessFile) => {
    setActionFile(null);
    try {
      const Sharing = await import("expo-sharing");
      const mod = (Sharing as any).default ?? Sharing;
      await mod.shareAsync(file.uri, {
        mimeType: file.mimeType || "application/octet-stream",
        dialogTitle: `Share ${file.displayName}`,
      });
    } catch {
      setToastMsg("Failed to share file.");
    }
  }, []);

  const handleActionDelete = useCallback(
    (file: QuickAccessFile) => {
      setActionFile(null);
      const isSaf = (file as any)._isSaf === true;
      const message = isSaf
        ? `Remove "${file.displayName}" from your library? The original file on your device will not be deleted.`
        : `Delete "${file.displayName}"? It will be moved to the Recycle Bin and removed from all folders.`;
      Alert.alert(isSaf ? "Remove From Library" : "Delete File", message, [
        { text: "Cancel", style: "cancel" },
        {
          text: isSaf ? "Remove" : "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (isSaf) {
                await docLibDb.removeDocument(file.uri);
                await refetchDoclib();
              } else {
                await recycleFile({
                  id: file.id,
                  name: file.displayName,
                  uri: file.uri,
                  size: file.size || 0,
                  type: (file as any)._type || file.extension || "unknown",
                  mimeType: file.mimeType || "application/octet-stream",
                  source: file.source,
                });
                removeFile(file.id);
                await removeIndexFile(file.id);
                await removeFileFromAllFolders(file.id).catch(console.error);
              }
            } catch (err: any) {
              setToastMsg(
                `Delete failed${err?.message ? `: ${err.message}` : "."}`,
              );
            }
          },
        },
      ]);
    },
    [removeFile, removeIndexFile, refetchDoclib],
  );

  // ============================================================================
  // FILTERED DATA
  // ============================================================================
  const filteredFiles = useMemo(() => {
    let result = files;

    // Apply search filter
    if (searchQuery.trim()) {
      result = result.filter((f) =>
        fileMatchesSearch(f.displayName, searchQuery),
      );
    }

    // Apply type filter
    if (typeFilter !== "all") {
      result = result.filter((f) => {
        const ext = f.extension?.toLowerCase();
        const fileType = (f as any)._type;

        switch (typeFilter) {
          case "pdf":
            return ext === "pdf" || fileType === "pdf";
          case "docx":
            return ext === "docx" || ext === "doc" || fileType === "docx";
          case "ppt":
            return ext === "pptx" || ext === "ppt" || fileType === "ppt";
          case "epub":
            return ext === "epub" || fileType === "epub";
          default:
            return true;
        }
      });
    }

    // Apply source filter
    if (sourceFilter !== "all") {
      result = result.filter((f) => {
        // Favorites is a special filter — check favoriteIds set
        if (sourceFilter === "favorites") {
          return favoriteIds.has(f.id);
        }

        const sourceTags = (f as any)._sourceTags as string[] | undefined;
        const source = f.source;

        if (sourceTags && sourceTags.length > 0) {
          return sourceTags.includes(sourceFilter);
        }

        // Fallback to legacy source field
        switch (sourceFilter) {
          case "created":
            return source === "created";
          case "imported":
            return source === "picked" || !source;
          case "downloaded":
            return false; // Legacy doesn't track downloads separately
          case "shared":
            return false; // Legacy doesn't track shares
          default:
            return true;
        }
      });
    }

    // Apply user-selected sort to the unpinned set; pinned stays in pin order.
    const sortFn = (a: QuickAccessFile, b: QuickAccessFile): number => {
      switch (sortBy) {
        case "size":
          return (b.size || 0) - (a.size || 0);
        case "dateAdded":
          return (b.dateAdded || 0) - (a.dateAdded || 0);
        case "dateModified": {
          const am = (a as any)._lastModified ?? a.dateAdded ?? 0;
          const bm = (b as any)._lastModified ?? b.dateAdded ?? 0;
          return bm - am;
        }
        case "recentlyOpened":
          return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
        case "name":
          return a.displayName.localeCompare(b.displayName, undefined, {
            sensitivity: "base",
          });
        default:
          return 0;
      }
    };

    if (pinnedIds.length > 0) {
      const pinned = result
        .filter((f) => pinnedIds.includes(f.id))
        .sort((a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id));
      const unpinned = result.filter((f) => !pinnedIds.includes(f.id)).sort(sortFn);
      return [...pinned, ...unpinned];
    }

    return [...result].sort(sortFn);
  }, [files, searchQuery, typeFilter, sourceFilter, pinnedIds, favoriteIds, sortBy]);

  // Check if any filters are active
  const hasActiveFilters = typeFilter !== "all" || sourceFilter !== "all";

  // Determine if import button should be shown
  // Hide on CREATED, DOWNLOADED, and SHARED categories since importing doesn't make sense there
  const showImportButton =
    sourceFilter === "all" || sourceFilter === "imported";

  // Reset all filters
  const resetFilters = useCallback(() => {
    setTypeFilter("all");
    setSourceFilter("all");
  }, []);

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  const ITEM_HEIGHT = 72; // Fixed row height for getItemLayout
  const keyExtractor = useCallback((item: QuickAccessFile) => item.id, []);
  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    [],
  );

  const renderFileItem = useCallback(
    ({ item }: { item: QuickAccessFile }) => {
      const typeConfig = getFileTypeConfig(item.displayName);
      const metaParts: string[] = [];
      if (item.size) metaParts.push(formatFileSize(item.size));
      metaParts.push(typeConfig.label);
      if (item.lastOpenedAt)
        metaParts.push(formatRelativeTime(item.lastOpenedAt));
      const metaText = metaParts.join(" • ");

      const isSelected = markMode && selectedIds.has(item.id);
      const isPinned = pinnedIds.includes(item.id);

      return (
        <Pressable
          style={({ pressed }) => [
            styles.flatFileRow,
            isSelected && { backgroundColor: t.primary + "18" },
            pressed && !isSelected && { opacity: 0.7 },
          ]}
          onPress={() =>
            markMode ? handleToggleSelect(item.id) : handleFilePress(item)
          }
          onLongPress={() => handleFileLongPress(item)}
          delayLongPress={500}
          android_ripple={{ color: t.primary + "20" }}
        >
          {/* Icon */}
          <View
            style={[
              styles.iconContainer,
              {
                backgroundColor:
                  item.cacheValid === false
                    ? colors.errorLight
                    : getTypeBgColor(typeConfig.color),
              },
            ]}
          >
            <MaterialIcons
              name={typeConfig.icon as keyof typeof MaterialIcons.glyphMap}
              size={22}
              color={
                item.cacheValid === false ? colors.error : typeConfig.color
              }
            />
          </View>

          {/* Content */}
          <View style={styles.fileContent}>
            <Text
              style={[styles.fileName, { color: textColor }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {item.displayName}
            </Text>

            <View style={styles.metaRow}>
              {item.cacheValid === false ? (
                <Text style={[styles.expiredText, { color: colors.error }]}>
                  File unavailable — tap to re-import
                </Text>
              ) : (
                <Text style={[styles.fileMeta, { color: t.textSecondary }]}>
                  {metaText}
                </Text>
              )}
            </View>
          </View>

          {/* Right side: star + pin + checkbox or 3-dot menu */}
          {markMode ? (
            <View
              style={[
                styles.checkbox,
                isSelected && {
                  backgroundColor: t.primary,
                  borderColor: t.primary,
                },
              ]}
            >
              {isSelected && (
                <Ionicons name="checkmark" size={14} color="#fff" />
              )}
            </View>
          ) : (
            <View style={styles.chevronRow}>
              {favoriteIds.has(item.id) && (
                <MaterialIcons
                  name="star"
                  size={16}
                  color="#F59E0B"
                  style={{ marginRight: 4 }}
                />
              )}
              {isPinned && (
                <MaterialIcons
                  name="push-pin"
                  size={14}
                  color={t.primary}
                  style={styles.pinIndicator}
                />
              )}
              <TouchableOpacity
                onPress={() => setActionFile(item)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialIcons
                  name="more-vert"
                  size={22}
                  color={t.textTertiary}
                />
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      );
    },
    [
      textColor,
      markMode,
      selectedIds,
      pinnedIds,
      favoriteIds,
      handleFilePress,
      handleFileLongPress,
      handleToggleSelect,
    ],
  );

  // ── Grid item renderer ───────────────────────────────────────────────────
  const renderGridItem = useCallback(
    ({ item }: { item: QuickAccessFile }) => {
      const typeConfig = getFileTypeConfig(item.displayName);
      const isSelected = markMode && selectedIds.has(item.id);
      const isFav = favoriteIds.has(item.id);

      return (
        <Pressable
          style={({ pressed }) => [
            styles.gridCard,
            {
              backgroundColor: isSelected
                ? t.primary + "18"
                : pressed
                  ? t.card + "CC"
                  : t.card,
              borderColor: isSelected ? t.primary : t.borderLight,
              borderWidth: isSelected ? 2 : 1,
            },
          ]}
          onPress={() =>
            markMode ? handleToggleSelect(item.id) : handleFilePress(item)
          }
          onLongPress={() => handleFileLongPress(item)}
          delayLongPress={500}
        >
          {/* File icon area */}
          <View
            style={[
              styles.gridIconArea,
              { backgroundColor: getTypeBgColor(typeConfig.color) },
            ]}
          >
            <MaterialIcons
              name={typeConfig.icon as keyof typeof MaterialIcons.glyphMap}
              size={20}
              color={typeConfig.color}
            />
            {markMode && (
              <View
                style={[
                  styles.gridCheckbox,
                  isSelected && {
                    backgroundColor: t.primary,
                    borderColor: t.primary,
                  },
                ]}
              >
                {isSelected && (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                )}
              </View>
            )}
            {!markMode && isFav && (
              <MaterialIcons
                name="star"
                size={14}
                color="#F59E0B"
                style={styles.gridFavStar}
              />
            )}
          </View>
          {/* File name */}
          <Text
            style={[styles.gridFileName, { color: t.text }]}
            numberOfLines={2}
            ellipsizeMode="middle"
          >
            {item.displayName}
          </Text>
          <Text
            style={[styles.gridFileMeta, { color: t.textSecondary }]}
            numberOfLines={1}
          >
            {item.size ? formatFileSize(item.size) : typeConfig.label}
          </Text>
          {/* 3-dot */}
          {!markMode && (
            <TouchableOpacity
              style={styles.gridMoreBtn}
              onPress={() => setActionFile(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons
                name="more-vert"
                size={20}
                color={t.textTertiary}
              />
            </TouchableOpacity>
          )}
        </Pressable>
      );
    },
    [
      t,
      markMode,
      selectedIds,
      favoriteIds,
      handleFilePress,
      handleFileLongPress,
      handleToggleSelect,
    ],
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <GradientView
        colors={
          mode === "dark" ? ["#1E293B", "#0F172A"] : ["#EEF2FF", "#F8FAFC"]
        }
        style={styles.emptyIconContainer}
      >
        <FolderOpen color={t.primary} size={38} strokeWidth={1.5} />
      </GradientView>

      <Text style={[styles.emptyDescription, { color: t.textSecondary }]}>
        Access a folder on your device and we&apos;ll bring every PDF, Word,
        Excel and PowerPoint file inside straight into your library.
      </Text>
      <TouchableOpacity
        style={styles.emptyButton}
        onPress={handleAccessFolder}
        activeOpacity={0.8}
      >
        <GradientView
          colors={[colors.gradientStart, colors.gradientMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.emptyButtonGradient}
        >
          <FolderOpen color="white" size={20} strokeWidth={2.5} />
          <Text style={styles.emptyButtonText}>Access Folder</Text>
        </GradientView>
      </TouchableOpacity>
    </View>
  );

  const renderNoResults = () => (
    <View style={styles.emptyContainer}>
      <GradientView
        colors={
          mode === "dark" ? ["#1E293B", "#0F172A"] : ["#FEF2F2", "#F8FAFC"]
        }
        style={styles.emptyIconContainer}
      >
        <Search color={t.textSecondary} size={40} strokeWidth={1.5} />
      </GradientView>
      <Text style={[styles.emptyDescription, { color: t.textSecondary }]}>
        {hasActiveFilters
          ? "No files match the selected filters"
          : `No files matching "${searchQuery}"`}
      </Text>
      {hasActiveFilters && (
        <TouchableOpacity
          style={styles.emptyButton}
          onPress={resetFilters}
          activeOpacity={0.8}
        >
          <GradientView
            colors={[colors.gradientStart, colors.gradientMid]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.emptyButtonGradient}
          >
            <Ionicons name="refresh" size={20} color="white" />
            <Text style={styles.emptyButtonText}>Clear Filters</Text>
          </GradientView>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderSkeletons = () => (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.flatFileRow}>
          <View
            style={[
              styles.skeletonIcon,
              { backgroundColor: colors.backgroundTertiary },
            ]}
          />
          <View style={styles.fileContent}>
            <View
              style={[
                styles.skeletonName,
                { backgroundColor: colors.backgroundTertiary },
              ]}
            />
            <View
              style={[
                styles.skeletonMeta,
                { backgroundColor: colors.backgroundTertiary },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <PINGate screen="library">
      <SafeAreaView style={[styles.container, { backgroundColor }]}>
        {/* Fixed Header - Always visible */}
        <AppHeaderContainer>
        <View style={styles.headerContainer}>
          <GradientView
            colors={[
              colors.gradientStart,
              colors.gradientMid,
              colors.gradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.headerTop}>
              {/* Left: back button (fixed width for centering) */}
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
              >
                <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Center: title */}
              <View style={styles.headerTitleContainer}>
                <Text style={styles.headerTitle}>Library</Text>
              </View>

              {/* Right: view toggle + import button */}
              <TouchableOpacity
                style={styles.headerViewToggle}
                onPress={toggleViewMode}
                activeOpacity={0.8}
              >
                {viewMode === "list" ? (
                  <Grid3x3 color="#FFFFFF" size={18} strokeWidth={2.5} />
                ) : (
                  <List color="#FFFFFF" size={18} strokeWidth={2.5} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerImportBtn}
                onPress={handleAccessFolder}
                activeOpacity={0.8}
              >
                <Text style={styles.headerImportBtnText}>Files</Text>
              </TouchableOpacity>
            </View>
          </GradientView>
        </View>
        </AppHeaderContainer>

        {/* Sticky Filter Chips - Always accessible below header */}
        <View style={[styles.filterSection, { backgroundColor, zIndex: 20 }]}>
          {/* Search Bar (shown when search button is pressed) */}
          {showSearchBar && (
            <View style={styles.searchBarRow}>
              <View
                style={[styles.searchBarExpanded, { backgroundColor: t.card }]}
              >
                <Search color={t.primary} size={20} strokeWidth={2.5} />
                <TextInput
                  placeholder="Search files..."
                  placeholderTextColor={t.textTertiary}
                  style={[styles.searchInput, { color: t.text }]}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoFocus
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery("")}>
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color={t.textTertiary}
                    />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShowSearchBar(false);
                  setSearchQuery("");
                }}
                style={styles.searchCloseButton}
              >
                <Text style={{ color: t.primary, fontWeight: "600" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Filter Row with Search Button + Scrollable Categories */}
          <View style={styles.filterRow}>
            {/* Static Search Button */}
            <TouchableOpacity
              style={[
                styles.searchButton,
                (showSearchBar || searchQuery.length > 0) &&
                  styles.searchButtonActive,
                {
                  backgroundColor:
                    showSearchBar || searchQuery.length > 0
                      ? t.primary
                      : colorScheme === "dark"
                        ? "#334155"
                        : "#F1F5F9",
                },
              ]}
              onPress={() => setShowSearchBar(!showSearchBar)}
            >
              <Search
                color={
                  showSearchBar || searchQuery.length > 0
                    ? "#FFFFFF"
                    : t.primary
                }
                size={18}
                strokeWidth={2.5}
              />
            </TouchableOpacity>

            {/* Type Filters - Scrollable */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsContainer}
            >
              {/* All Types */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  typeFilter === "all" && styles.filterChipActive,
                  {
                    backgroundColor:
                      typeFilter === "all"
                        ? t.primary
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#F1F5F9",
                    borderColor:
                      typeFilter === "all" ? t.primary : "transparent",
                  },
                ]}
                onPress={() => {
                  setTypeFilter("all");
                  setSourceFilter("all");
                }}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color: typeFilter === "all" ? "#FFFFFF" : t.textSecondary,
                    },
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>

              {/* PDF */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  typeFilter === "pdf" && styles.filterChipActive,
                  {
                    backgroundColor:
                      typeFilter === "pdf"
                        ? colors.pdf
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#FEE2E2",
                    borderColor:
                      typeFilter === "pdf" ? colors.pdf : "transparent",
                  },
                ]}
                onPress={() => {
                  setTypeFilter("pdf");
                  setSourceFilter("all");
                }}
              >
                <MaterialIcons
                  name="picture-as-pdf"
                  size={14}
                  color={typeFilter === "pdf" ? "#FFFFFF" : colors.pdf}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    { color: typeFilter === "pdf" ? "#FFFFFF" : colors.pdf },
                  ]}
                >
                  PDF
                </Text>
              </TouchableOpacity>

              {/* DOCX */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  typeFilter === "docx" && styles.filterChipActive,
                  {
                    backgroundColor:
                      typeFilter === "docx"
                        ? colors.word
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#DBEAFE",
                    borderColor:
                      typeFilter === "docx" ? colors.word : "transparent",
                  },
                ]}
                onPress={() => {
                  setTypeFilter("docx");
                  setSourceFilter("all");
                }}
              >
                <MaterialIcons
                  name="description"
                  size={14}
                  color={typeFilter === "docx" ? "#FFFFFF" : colors.word}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    { color: typeFilter === "docx" ? "#FFFFFF" : colors.word },
                  ]}
                >
                  DOCX
                </Text>
              </TouchableOpacity>

              {/* PPT */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  typeFilter === "ppt" && styles.filterChipActive,
                  {
                    backgroundColor:
                      typeFilter === "ppt"
                        ? colors.ppt
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#FFEDD5",
                    borderColor:
                      typeFilter === "ppt" ? colors.ppt : "transparent",
                  },
                ]}
                onPress={() => {
                  setTypeFilter("ppt");
                  setSourceFilter("all");
                }}
              >
                <MaterialIcons
                  name="slideshow"
                  size={14}
                  color={typeFilter === "ppt" ? "#FFFFFF" : colors.ppt}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    { color: typeFilter === "ppt" ? "#FFFFFF" : colors.ppt },
                  ]}
                >
                  PPT
                </Text>
              </TouchableOpacity>

              {/* EPUB */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  typeFilter === "epub" && styles.filterChipActive,
                  {
                    backgroundColor:
                      typeFilter === "epub"
                        ? colors.epub
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#EDE9FE",
                    borderColor:
                      typeFilter === "epub" ? colors.epub : "transparent",
                  },
                ]}
                onPress={() => {
                  setTypeFilter("epub");
                  setSourceFilter("all");
                }}
              >
                <MaterialIcons
                  name="menu-book"
                  size={14}
                  color={typeFilter === "epub" ? "#FFFFFF" : colors.epub}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    { color: typeFilter === "epub" ? "#FFFFFF" : colors.epub },
                  ]}
                >
                  EPUB
                </Text>
              </TouchableOpacity>

              {/* Favorites */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  sourceFilter === "favorites" && styles.filterChipActive,
                  {
                    backgroundColor:
                      sourceFilter === "favorites"
                        ? "#F59E0B"
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#FEF3C7",
                    borderColor:
                      sourceFilter === "favorites" ? "#F59E0B" : "transparent",
                  },
                ]}
                onPress={() => {
                  setSourceFilter(
                    sourceFilter === "favorites" ? "all" : "favorites",
                  );
                  setTypeFilter("all");
                }}
              >
                <MaterialIcons
                  name="star"
                  size={14}
                  color={sourceFilter === "favorites" ? "#FFFFFF" : "#F59E0B"}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color:
                        sourceFilter === "favorites" ? "#FFFFFF" : "#F59E0B",
                    },
                  ]}
                >
                  Favorites
                </Text>
              </TouchableOpacity>

              {/* Source: Created */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  sourceFilter === "created" && styles.filterChipActive,
                  {
                    backgroundColor:
                      sourceFilter === "created"
                        ? "#10B981"
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#D1FAE5",
                    borderColor:
                      sourceFilter === "created" ? "#10B981" : "transparent",
                  },
                ]}
                onPress={() => {
                  setSourceFilter(
                    sourceFilter === "created" ? "all" : "created",
                  );
                  setTypeFilter("all");
                }}
              >
                <MaterialIcons
                  name="add-circle"
                  size={14}
                  color={sourceFilter === "created" ? "#FFFFFF" : "#10B981"}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color: sourceFilter === "created" ? "#FFFFFF" : "#10B981",
                    },
                  ]}
                >
                  Created
                </Text>
              </TouchableOpacity>

              {/* Source: Downloaded */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  sourceFilter === "downloaded" && styles.filterChipActive,
                  {
                    backgroundColor:
                      sourceFilter === "downloaded"
                        ? "#8B5CF6"
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#EDE9FE",
                    borderColor:
                      sourceFilter === "downloaded" ? "#8B5CF6" : "transparent",
                  },
                ]}
                onPress={() => {
                  setSourceFilter(
                    sourceFilter === "downloaded" ? "all" : "downloaded",
                  );
                  setTypeFilter("all");
                }}
              >
                <MaterialIcons
                  name="download"
                  size={14}
                  color={sourceFilter === "downloaded" ? "#FFFFFF" : "#8B5CF6"}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color:
                        sourceFilter === "downloaded" ? "#FFFFFF" : "#8B5CF6",
                    },
                  ]}
                >
                  Downloaded
                </Text>
              </TouchableOpacity>

              {/* Source: Shared */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  sourceFilter === "shared" && styles.filterChipActive,
                  {
                    backgroundColor:
                      sourceFilter === "shared"
                        ? "#F59E0B"
                        : colorScheme === "dark"
                          ? "#334155"
                          : "#FEF3C7",
                    borderColor:
                      sourceFilter === "shared" ? "#F59E0B" : "transparent",
                  },
                ]}
                onPress={() => {
                  setSourceFilter(sourceFilter === "shared" ? "all" : "shared");
                  setTypeFilter("all");
                }}
              >
                <MaterialIcons
                  name="share"
                  size={14}
                  color={sourceFilter === "shared" ? "#FFFFFF" : "#F59E0B"}
                />
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color: sourceFilter === "shared" ? "#FFFFFF" : "#F59E0B",
                    },
                  ]}
                >
                  Shared
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <TouchableOpacity
              style={styles.clearFiltersButton}
              onPress={resetFilters}
            >
              <Ionicons name="close-circle" size={16} color={t.error} />
              <Text style={[styles.clearFiltersText, { color: t.error }]}>
                Clear
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Indexing status banner (folder scan in progress / error) */}
        {indexingStatus.phase !== "idle" &&
          indexingStatus.phase !== "done" && (
            <View
              style={[
                styles.indexBanner,
                {
                  backgroundColor:
                    indexingStatus.phase === "error"
                      ? colors.error
                      : t.primary,
                },
              ]}
            >
              <Text style={styles.indexBannerText} numberOfLines={1}>
                {indexingStatus.phase === "scanning"
                  ? `Scanning ${indexingStatus.folder}… ${indexingStatus.found} found`
                  : indexingStatus.phase === "saving"
                    ? `Saving ${indexingStatus.total} documents…`
                    : indexingStatus.message}
              </Text>
            </View>
          )}

        {/* Mark Mode Toolbar */}
        {markMode && (
          <View
            style={[
              styles.markToolbar,
              { backgroundColor: t.card, borderBottomColor: t.border },
            ]}
          >
            <TouchableOpacity
              onPress={handleExitMarkMode}
              style={styles.markToolbarBtn}
            >
              <Ionicons name="close" size={20} color={t.text} />
              <Text style={[styles.markToolbarText, { color: t.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <Text style={[styles.markCount, { color: t.text }]}>
              {selectedIds.size} selected
            </Text>
            <View style={styles.markToolbarRight}>
              <TouchableOpacity
                onPress={handleBulkShare}
                disabled={selectedIds.size === 0}
                style={[
                  styles.markToolbarBtn,
                  { opacity: selectedIds.size === 0 ? 0.4 : 1 },
                ]}
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={t.primary}
                />
                <Text style={[styles.markToolbarText, { color: t.primary }]}>
                  Share
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBulkDelete}
                disabled={selectedIds.size === 0}
                style={[
                  styles.markToolbarBtn,
                  { opacity: selectedIds.size === 0 ? 0.4 : 1 },
                ]}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={colors.error}
                />
                <Text
                  style={[styles.markToolbarText, { color: colors.error }]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Content */}
        {isLoading ? (
          renderSkeletons()
        ) : filteredFiles.length === 0 ? (
          <View style={{ flex: 1 }}>
            {searchQuery || hasActiveFilters
              ? renderNoResults()
              : renderEmptyState()}
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              key={viewMode} // Force re-mount when switching layout
              data={filteredFiles}
              keyExtractor={keyExtractor}
              renderItem={viewMode === "grid" ? renderGridItem : renderFileItem}
              {...(viewMode === "list"
                ? { getItemLayout }
                : { numColumns: 3, columnWrapperStyle: styles.gridRow })}
              initialNumToRender={12}
              maxToRenderPerBatch={8}
              windowSize={5}
              removeClippedSubviews={true}
              contentContainerStyle={
                viewMode === "grid" ? styles.gridContent : styles.listContent
              }
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                />
              }
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View style={styles.listHeaderContainer}>
                  {/* Files Count & Sort By + Clear All */}
                  {files.length > 0 && !searchQuery && !hasActiveFilters && (
                    <View style={styles.filesHeader}>
                      <Text
                        style={[styles.filesCount, { color: t.textSecondary }]}
                      >
                        {filteredFiles.length} file
                        {filteredFiles.length !== 1 ? "s" : ""}
                      </Text>
                      <View style={styles.headerActionsRow}>
                        <TouchableOpacity
                          onPress={() => setShowSortMenu(true)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Text
                            style={[styles.sortByText, { color: t.primary }]}
                          >
                            Sort by
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleClearAll}>
                          <Text
                            style={[styles.clearAllText, { color: t.error }]}
                          >
                            Clear All
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* Show filtered count when filters are active */}
                  {hasActiveFilters && (
                    <View style={styles.filesHeader}>
                      <Text
                        style={[styles.filesCount, { color: t.textSecondary }]}
                      >
                        {filteredFiles.length} of {files.length} file
                        {files.length !== 1 ? "s" : ""}
                      </Text>
                    </View>
                  )}
                </View>
              }
            />
          </View>
        )}
        {/* ── Action Sheet Modal ───────────────────────────────────────────── */}
        <FileActionSheetModal
          file={actionFile}
          theme={t}
          isFavorite={
            actionFile ? favoriteIds.has(actionFile.id) : false
          }
          onClose={() => setActionFile(null)}
          onOpen={() => {
            const f = actionFile;
            if (!f) return;
            setActionFile(null);
            handleFilePress(f);
          }}
          onShare={() => actionFile && handleActionShare(actionFile)}
          onToggleFavorite={() =>
            actionFile && handleToggleFavorite(actionFile)
          }
          onMoveToFolder={() =>
            actionFile && handleMoveToFolder(actionFile)
          }
          onRename={() => actionFile && handleRenameFile(actionFile)}
          onDelete={() => actionFile && handleActionDelete(actionFile)}
        />

        {/* ── Sort By Modal ────────────────────────────────────────────────── */}
        <Modal
          visible={showSortMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSortMenu(false)}
        >
          <TouchableOpacity
            style={[styles.modalOverlay, { justifyContent: "center" }]}
            onPress={() => setShowSortMenu(false)}
            activeOpacity={1}
          >
            <View
              style={[styles.sortMenuModal, { backgroundColor: t.card }]}
              onStartShouldSetResponder={() => true}
            >
              <Text style={[styles.sortMenuTitle, { color: t.text }]}>
                Sort by
              </Text>
              {SORT_OPTIONS.map((opt) => {
                const active = sortBy === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.sortMenuItem,
                      active && { backgroundColor: t.primary + "15" },
                    ]}
                    onPress={() => handleSelectSort(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.sortMenuItemText,
                        {
                          color: active ? t.primary : t.text,
                          fontWeight: active ? "700" : "500",
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {active && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={t.primary}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── Folder Picker Modal ─────────────────────────────────────────── */}
        <Modal
          visible={showFolderPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowFolderPicker(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            onPress={() => setShowFolderPicker(false)}
            activeOpacity={1}
          >
            <View
              style={[styles.folderPickerModal, { backgroundColor: t.card }]}
              onStartShouldSetResponder={() => true}
            >
              <Text style={[styles.folderPickerTitle, { color: t.text }]}>
                Move to Folder
              </Text>

              <ScrollView style={styles.folderPickerList}>
                {availableFolders.length === 0 ? (
                  <TouchableOpacity
                    style={styles.folderPickerEmptyBtn}
                    onPress={() => {
                      setShowFolderPicker(false);
                      router.push("/folders");
                    }}
                  >
                    <Text
                      style={[
                        styles.folderPickerEmpty,
                        { color: t.textSecondary },
                      ]}
                    >
                      No created folders.{" "}
                      <Text style={{ color: t.primary, fontWeight: "700" }}>
                        Create folder?
                      </Text>
                    </Text>
                  </TouchableOpacity>
                ) : (
                  availableFolders.map((folder) => (
                    <TouchableOpacity
                      key={folder.id}
                      style={[
                        styles.folderPickerItem,
                        { borderBottomColor: t.borderLight },
                      ]}
                      onPress={() => handleSelectFolder(folder.id)}
                    >
                      <Ionicons
                        name={(folder.icon as any) || "folder"}
                        size={20}
                        color={folder.color}
                      />
                      <Text
                        style={[
                          styles.folderPickerItemText,
                          { color: t.text },
                        ]}
                        numberOfLines={1}
                      >
                        {folder.name}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.folderPickerCancel,
                  { backgroundColor: mode === "dark" ? "#334155" : "#F1F5F9" },
                ]}
                onPress={() => setShowFolderPicker(false)}
              >
                <Text
                  style={[styles.folderPickerCancelText, { color: t.text }]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── Toast ─────────────────────────────────────────────────────── */}
        {toastMsg ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toastMsg}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </PINGate>
  );
}

// ============================================================================
// FILE ACTION SHEET MODAL (with reading progress ring + slide-down dismiss)
// ============================================================================
interface FileActionSheetModalProps {
  file: QuickAccessFile | null;
  theme: any;
  isFavorite: boolean;
  onClose: () => void;
  onOpen: () => void;
  onShare: () => void;
  onToggleFavorite: () => void;
  onMoveToFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const SHEET_DISMISS_DISTANCE = 110;

const FileActionSheetModal: React.FC<FileActionSheetModalProps> = ({
  file,
  theme,
  isFavorite,
  onClose,
  onOpen,
  onShare,
  onToggleFavorite,
  onMoveToFolder,
  onRename,
  onDelete,
}) => {
  const visible = file !== null;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  const dismiss = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 600,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  }, [translateY, onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy > 0) {
          translateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > SHEET_DISMISS_DISTANCE || gesture.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: 600,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
    }),
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        onPress={dismiss}
        activeOpacity={1}
      >
        <Animated.View
          style={[
            styles.actionSheet,
            { backgroundColor: theme.card, transform: [{ translateY }] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View
            style={styles.actionSheetGrabArea}
            {...panResponder.panHandlers}
          >
            <TouchableOpacity
              style={styles.actionSheetCloseBtn}
              onPress={dismiss}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name="keyboard-arrow-down"
                size={28}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
          </View>
          {file && (
            <FileActionSheetBody
              file={file}
              theme={theme}
              isFavorite={isFavorite}
              onOpen={onOpen}
              onShare={onShare}
              onToggleFavorite={onToggleFavorite}
              onMoveToFolder={onMoveToFolder}
              onRename={onRename}
              onDelete={onDelete}
            />
          )}
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
};

interface FileActionSheetBodyProps {
  file: QuickAccessFile;
  theme: any;
  isFavorite: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggleFavorite: () => void;
  onMoveToFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

const FileActionSheetBody: React.FC<FileActionSheetBodyProps> = ({
  file,
  theme,
  isFavorite,
  onOpen,
  onShare,
  onToggleFavorite,
  onMoveToFolder,
  onRename,
  onDelete,
}) => {
  const progressEntry = useReadingProgressFor(file.uri);
  const progress = progressEntry?.progress ?? 0;
  const subtitleParts: string[] = [];
  if (progressEntry?.currentPage && progressEntry?.totalPages) {
    subtitleParts.push(
      `Page ${progressEntry.currentPage} of ${progressEntry.totalPages}`,
    );
  } else if (progress > 0) {
    subtitleParts.push("Reading progress");
  } else {
    subtitleParts.push("Not started");
  }

  const actions: {
    key: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    label: string;
    color: string;
    onPress: () => void;
  }[] = [
    { key: "open", icon: "open-in-new", label: "Open", color: theme.text, onPress: onOpen },
    { key: "send", icon: "send", label: "Send", color: theme.text, onPress: onShare },
    {
      key: "fav",
      icon: isFavorite ? "star" : "star-outline",
      label: isFavorite ? "Unfavorite" : "Favorite",
      color: "#F59E0B",
      onPress: onToggleFavorite,
    },
    {
      key: "move",
      icon: "folder",
      label: "Move",
      color: theme.text,
      onPress: onMoveToFolder,
    },
    {
      key: "rename",
      icon: "edit",
      label: "Rename",
      color: theme.text,
      onPress: onRename,
    },
    {
      key: "delete",
      icon: "delete-outline",
      label: "Delete",
      color: colors.error,
      onPress: onDelete,
    },
  ];

  return (
    <View>
      <Text
        style={[styles.actionSheetFileName, { color: theme.text }]}
        numberOfLines={2}
      >
        {file.displayName}
      </Text>

      <View style={styles.actionSheetRingWrap}>
        <ProgressRing
          progress={progress}
          size={108}
          strokeWidth={8}
          color={theme.primary}
          trackColor={theme.borderLight}
          textColor={theme.text}
          emptyLabel="0%"
        />
        <Text
          style={[styles.actionSheetRingSubtitle, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {subtitleParts.join(" · ")}
        </Text>
      </View>

      <View style={styles.actionSheetGrid}>
        {actions.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={styles.actionSheetGridItem}
            onPress={a.onPress}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.actionSheetGridIconBg,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <MaterialIcons name={a.icon} size={20} color={a.color} />
            </View>
            <Text
              style={[styles.actionSheetGridLabel, { color: a.color }]}
              numberOfLines={1}
            >
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerContainer: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "android" ? 20 : 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 48,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 4,
  },
  headerImportBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    justifyContent: "center",
  },
  headerImportBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFF",
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.85)",
    fontWeight: "600",
    // marginTop: 2,
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 16,
    paddingHorizontal: 18,
    height: 48,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    fontWeight: "500",
  },
  importContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  importButton: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  importButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 18,
    gap: 10,
  },
  importButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  filesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  filesCount: {
    fontSize: 14,
    fontWeight: "600",
  },
  clearAllText: {
    fontSize: 14,
    fontWeight: "700",
  },
  headerActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  sortByText: {
    fontSize: 14,
    fontWeight: "700",
  },
  sortMenuModal: {
    borderRadius: 18,
    padding: 12,
    width: SCREEN_WIDTH * 0.82,
    maxWidth: 380,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 16,
  },
  sortMenuTitle: {
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 8,
  },
  sortMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 10,
  },
  sortMenuItemText: {
    fontSize: 15,
    fontWeight: "500",
  },
  listContent: {
    paddingHorizontal: 0,
    paddingBottom: 150,
  },
  flatFileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    height: 72,
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  expiredBorder: {
    borderWidth: 2,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  fileContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 6,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  fileMeta: {
    fontSize: 12,
    fontWeight: "500",
  },
  expiredText: {
    fontSize: 12,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    marginTop: -120,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  emptyDescription: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
  },
  emptyButton: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  skeletonContainer: {
    paddingHorizontal: 10,
    paddingVertical: 20,
  },
  skeletonIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
  },
  skeletonName: {
    width: "70%",
    height: 18,
    borderRadius: 6,
  },
  skeletonMeta: {
    width: "50%",
    height: 14,
    borderRadius: 6,
    marginTop: 10,
  },
  // Filter styles
  filterSection: {
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  collapsibleContainer: {
    overflow: "hidden",
    paddingTop: 12,
  },
  animatedImportContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  listHeaderContainer: {
    // Container for file count headers (no extra padding needed)
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  filterChipsContainer: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 20,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
  },
  filterChipActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  clearFiltersButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  clearFiltersText: {
    fontSize: 13,
    fontWeight: "600",
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  searchButtonActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  searchBarRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  searchBarExpanded: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  searchCloseButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  // ── Index banner ─────────────────────────────────────────────────────────
  indexBanner: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 10,
  },
  indexBannerText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },

  // ── Mark toolbar ─────────────────────────────────────────────────────────
  markToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  markToolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  markToolbarText: {
    fontSize: 14,
    fontWeight: "600",
  },
  markCount: {
    fontSize: 14,
    fontWeight: "700",
  },
  markToolbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  // ── Checkbox (mark mode) ──────────────────────────────────────────────────
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },

  // ── Pin indicator ─────────────────────────────────────────────────────────
  pinIndicator: {
    marginRight: 2,
  },
  chevronRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  // ── Action sheet ─────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  actionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 20,
    paddingTop: 4,
    paddingHorizontal: 18,
    width: "100%",
    maxWidth: 440,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 14,
  },
  actionSheetGrabArea: {
    paddingTop: 6,
    paddingBottom: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSheetCloseBtn: {
    width: 36,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSheetFileName: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 28,
    marginTop: 4,
    marginBottom: 2,
  },
  actionSheetRingWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    marginBottom: 16,
    gap: 6,
  },
  actionSheetRingSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  actionSheetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  actionSheetGridItem: {
    width: "31%",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  actionSheetGridIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionSheetGridLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
  },

  // ── Header view toggle ──────────────────────────────────────────────────
  headerViewToggle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  // ── Grid view styles ──────────────────────────────────────────────────
  gridContent: {
    paddingHorizontal: 16,
    paddingBottom: 150,
  },
  gridRow: {
    justifyContent: "flex-start",
    paddingHorizontal: 0,
    gap: 12,
  },
  gridCard: {
    width: (SCREEN_WIDTH - 56) / 3,
    borderRadius: 8,
    marginBottom: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    paddingBottom: 6,
  },
  gridIconArea: {
    width: "100%",
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  gridCheckbox: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  gridFavStar: {
    position: "absolute",
    top: 4,
    left: 4,
  },
  gridFileName: {
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 6,
    marginTop: 4,
  },
  gridFileMeta: {
    fontSize: 9,
    fontWeight: "500",
    paddingHorizontal: 6,
    marginTop: 1,
  },
  gridMoreBtn: {
    position: "absolute",
    bottom: 4,
    right: 4,
    padding: 3,
  },

  // ── Folder picker modal ───────────────────────────────────────────────
  folderPickerModal: {
    borderRadius: 20,
    padding: 20,
    width: SCREEN_WIDTH * 0.85,
    maxWidth: 400,
    maxHeight: "60%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  folderPickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  folderPickerList: {
    maxHeight: 300,
  },
  folderPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderPickerItemText: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  folderPickerEmpty: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
    lineHeight: 22,
  },
  folderPickerEmptyBtn: {
    paddingVertical: 20,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  folderPickerCancel: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  folderPickerCancelText: {
    fontSize: 16,
    fontWeight: "600",
  },

  // ── Toast ───────────────────────────────────────────────────────────────
  toast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    backgroundColor: "rgba(15,23,42,0.92)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    maxWidth: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
