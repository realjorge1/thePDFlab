/**
 * DocLib Library
 *
 * SAF-backed document hub: lets the user grant folder access once, then keeps
 * a live SQLite-indexed list of every PDF / DOCX / PPTX / XLSX inside.
 *
 * Three panels share the screen via segmented tabs:
 *   • Library — recent + filtered list (All / PDF / Word / Excel / PowerPoint)
 *   • Search  — debounced LIKE search across indexed names
 *   • Folders — manage watched folders, see counts
 *
 * Opens are routed to the app's existing in-app viewers when possible
 * (PDF / DOCX / EPUB / image), and fall back to the Android chooser otherwise.
 */

import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { PINGate } from "@/components/PINGate";
import { FileCard, RecentCard } from "@/components/doclib/FileCard";
import { colors as appColors } from "@/constants/theme";
import {
  useDocumentCounts,
  useDocumentOpener,
  useDocuments,
  useFolders,
  useIndexingStatus,
  useRecentDocuments,
  useSearch,
} from "@/hooks/useDocLib";
import type { DocumentRecord } from "@/services/doclib/database";
import fileIndexer from "@/services/doclib/fileIndexer";
import { useTheme } from "@/services/ThemeProvider";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useNavigation } from "expo-router";
import {
  Archive,
  ChevronLeft,
  FolderOpen,
  FolderPlus,
  Library,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Panel = "library" | "search" | "folders";

const TYPE_TABS = [
  { key: "all", label: "All" },
  { key: "pdf", label: "PDF" },
  { key: "docx", label: "Word" },
  { key: "xlsx", label: "Excel" },
  { key: "pptx", label: "PowerPoint" },
] as const;

type TabKey = (typeof TYPE_TABS)[number]["key"];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Try to route a SAF-indexed file to one of the app's in-app viewers when the
 * type is supported. Falls back to the Android chooser via openSystem().
 */
function dispatchOpen(
  doc: DocumentRecord,
  openSystem: (d: DocumentRecord) => Promise<void>,
): void {
  // Pre-encode the URI: expo-router applies a net 1-decode to params, which
  // mangles SAF tree-document URIs whose document IDs contain literal ':' or
  // '/' (Android then resolves the URI as a directory → EISDIR).
  const params = { uri: encodeURIComponent(doc.uri), name: doc.name };
  switch (doc.type) {
    case "pdf":
      router.push({ pathname: "/pdf-viewer", params });
      return;
    case "docx":
      router.push({ pathname: "/docx-viewer", params });
      return;
    default:
      openSystem(doc).catch((e) => {
        const msg =
          e?.code === "PLATFORM_NOT_SUPPORTED"
            ? "This feature is only available on Android."
            : "No app available to open this file.";
        Alert.alert("Open failed", msg);
      });
  }
}

// ============================================================================
// Status banner
// ============================================================================

function IndexBanner() {
  const status = useIndexingStatus();
  if (status.phase === "idle" || status.phase === "done") return null;

  let message = "";
  let isError = false;
  if (status.phase === "scanning") {
    message = `Scanning ${status.folder}… ${status.found} found`;
  } else if (status.phase === "saving") {
    message = `Saving ${status.total} documents…`;
  } else if (status.phase === "error") {
    message = status.message;
    isError = true;
  }

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: isError ? "#EF4444" : appColors.primary },
      ]}
    >
      {!isError && (
        <ActivityIndicator
          size="small"
          color="#FFFFFF"
          style={{ marginRight: 8 }}
        />
      )}
      <Text style={styles.bannerText} numberOfLines={1}>
        {message}
      </Text>
    </View>
  );
}

// ============================================================================
// Library panel
// ============================================================================

function LibraryPanel({
  onOpen,
}: {
  onOpen: (doc: DocumentRecord) => void;
}) {
  const { colors: t } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [refreshing, setRefreshing] = useState(false);

  const { documents, loading, refetch: refetchDocs } = useDocuments(activeTab);
  const { documents: recentDocs, refetch: refetchRecent } =
    useRecentDocuments(10);
  const { counts, refetch: refetchCounts } = useDocumentCounts();
  const { addFolder } = useFolders();

  // Refresh on focus so opens in viewers reflect immediately.
  useFocusEffect(
    useCallback(() => {
      refetchDocs();
      refetchRecent();
      refetchCounts();
    }, [refetchDocs, refetchRecent, refetchCounts]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fileIndexer.runFullScan();
    } finally {
      await Promise.all([refetchDocs(), refetchRecent(), refetchCounts()]);
      setRefreshing(false);
    }
  }, [refetchDocs, refetchRecent, refetchCounts]);

  const handleAddFolder = useCallback(async () => {
    try {
      const result = await addFolder();
      if (result) {
        await Promise.all([refetchDocs(), refetchRecent(), refetchCounts()]);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not add folder.");
    }
  }, [addFolder, refetchDocs, refetchRecent, refetchCounts]);

  const renderHeader = () => (
    <>
      <IndexBanner />

      {recentDocs.length > 0 && (
        <View style={styles.recentSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>
              Continue Reading
            </Text>
            <Text style={[styles.sectionCount, { color: t.textSecondary }]}>
              {recentDocs.length}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentScroll}
          >
            {recentDocs.map((doc) => (
              <RecentCard key={doc.uri} document={doc} onPress={onOpen} />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.tabsSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: t.text }]}>
            All Documents
          </Text>
          <Text style={[styles.sectionCount, { color: t.textSecondary }]}>
            {counts.all}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsScroll}
        >
          {TYPE_TABS.map((tab) => {
            const count = counts[tab.key] ?? 0;
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.typeTab,
                  {
                    backgroundColor: active
                      ? appColors.primary
                      : t.backgroundSecondary,
                  },
                ]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.typeTabLabel,
                    { color: active ? "#FFFFFF" : t.textSecondary },
                  ]}
                >
                  {tab.label}
                </Text>
                {count > 0 && (
                  <View
                    style={[
                      styles.typeTabBadge,
                      {
                        backgroundColor: active
                          ? "rgba(255,255,255,0.25)"
                          : t.borderLight,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.typeTabBadgeText,
                        { color: active ? "#FFFFFF" : t.textSecondary },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </>
  );

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <View style={[styles.emptyIconBox, { backgroundColor: appColors.primaryLight + "20" }]}>
          <Library color={appColors.primary} size={36} strokeWidth={1.5} />
        </View>
        <Text style={[styles.emptyTitle, { color: t.text }]}>
          No documents yet
        </Text>
        <Text style={[styles.emptyDesc, { color: t.textSecondary }]}>
          Grant access to a folder and we&apos;ll automatically index every PDF,
          Word, Excel and PowerPoint file inside.
        </Text>
        <TouchableOpacity
          style={[styles.emptyBtn, { backgroundColor: appColors.primary }]}
          onPress={handleAddFolder}
          activeOpacity={0.8}
        >
          <FolderPlus color="white" size={18} strokeWidth={2.5} />
          <Text style={styles.emptyBtnText}>Add Folder</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading && documents.length === 0 && recentDocs.length === 0) {
    return (
      <View style={styles.loadingCenter}>
        <ActivityIndicator size="large" color={appColors.primary} />
        <Text style={[styles.loadingText, { color: t.textSecondary }]}>
          Loading library…
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={documents}
      keyExtractor={(item) => item.uri}
      renderItem={({ item }) => (
        <FileCard
          document={item}
          onPress={onOpen}
          showProgress
          mode="list"
        />
      )}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={appColors.primary}
          colors={[appColors.primary]}
        />
      }
      showsVerticalScrollIndicator={false}
      removeClippedSubviews
      maxToRenderPerBatch={20}
      windowSize={10}
    />
  );
}

// ============================================================================
// Search panel
// ============================================================================

function SearchPanel({
  onOpen,
}: {
  onOpen: (doc: DocumentRecord) => void;
}) {
  const { colors: t } = useTheme();
  const { query, setQuery, results, loading } = useSearch();

  const renderEmpty = () => {
    if (loading) return null;
    if (!query.trim()) {
      return (
        <View style={styles.searchHint}>
          <SearchIcon
            color={t.textTertiary}
            size={36}
            strokeWidth={1.5}
          />
          <Text style={[styles.searchHintText, { color: t.textSecondary }]}>
            Search across every indexed document by name.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.searchHint}>
        <Text style={[styles.searchHintText, { color: t.textSecondary }]}>
          No documents match &quot;{query}&quot;
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.panelRoot}>
      <View
        style={[
          styles.searchBar,
          { backgroundColor: t.card, borderColor: t.borderLight },
        ]}
      >
        <SearchIcon color={appColors.primary} size={18} strokeWidth={2.5} />
        <TextInput
          style={[styles.searchInput, { color: t.text }]}
          placeholder="Search documents…"
          placeholderTextColor={t.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {loading ? (
          <ActivityIndicator size="small" color={appColors.primary} />
        ) : query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery("")}>
            <Ionicons
              name="close-circle"
              size={20}
              color={t.textTertiary}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {results.length > 0 && (
        <Text style={[styles.resultCount, { color: t.textSecondary }]}>
          {results.length} result{results.length !== 1 ? "s" : ""}
        </Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.uri}
        renderItem={({ item }) => (
          <FileCard
            document={item}
            onPress={onOpen}
            showProgress
            mode="list"
          />
        )}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

// ============================================================================
// Folders panel
// ============================================================================

function FoldersPanel() {
  const { colors: t } = useTheme();
  const { folders, addFolder, removeFolder, refetch } = useFolders();
  const { counts, refetch: refetchCounts } = useDocumentCounts();
  const [busy, setBusy] = useState(false);

  const handleAdd = useCallback(async () => {
    try {
      setBusy(true);
      const result = await addFolder();
      if (result) await refetchCounts();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not add folder.");
    } finally {
      setBusy(false);
    }
  }, [addFolder, refetchCounts]);

  const handleRemove = useCallback(
    (uri: string, name: string) => {
      Alert.alert(
        "Remove folder?",
        `"${name}" will be removed from your library along with every indexed document inside it.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await removeFolder(uri);
              await refetchCounts();
            },
          },
        ],
      );
    },
    [removeFolder, refetchCounts],
  );

  const stats: { label: string; count: number }[] = [
    { label: "Total", count: counts.all },
    { label: "PDF", count: counts.pdf },
    { label: "Word", count: counts.docx },
    { label: "Excel", count: counts.xlsx },
    { label: "PPT", count: counts.pptx },
  ];

  return (
    <FlatList
      data={folders}
      keyExtractor={(item) => item.uri}
      renderItem={({ item }) => (
        <View style={[styles.folderCard, { backgroundColor: t.card }]}>
          <View
            style={[
              styles.folderIconWrap,
              { backgroundColor: appColors.primaryLight + "20" },
            ]}
          >
            <FolderOpen
              color={appColors.primary}
              size={22}
              strokeWidth={2}
            />
          </View>
          <View style={styles.folderInfo}>
            <Text
              style={[styles.folderName, { color: t.text }]}
              numberOfLines={1}
            >
              {item.displayName}
            </Text>
            <Text
              style={[styles.folderDate, { color: t.textTertiary }]}
            >
              Added{" "}
              {new Date(item.addedAt).toLocaleDateString("en", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.folderRemoveBtn}
            onPress={() => handleRemove(item.uri, item.displayName)}
            activeOpacity={0.8}
          >
            <Trash2 color="#EF4444" size={18} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      )}
      ListHeaderComponent={
        <View>
          <View style={styles.statsRow}>
            {stats.map((s) => (
              <View
                key={s.label}
                style={[
                  styles.statCard,
                  { backgroundColor: t.card, borderColor: t.borderLight },
                ]}
              >
                <Text style={[styles.statCount, { color: t.text }]}>
                  {s.count}
                </Text>
                <Text style={[styles.statLabel, { color: t.textTertiary }]}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={[styles.foldersSectionLabel, { color: t.textSecondary }]}
          >
            Watched Folders
          </Text>

          {folders.length === 0 && (
            <View style={styles.emptyFolders}>
              <Text
                style={[
                  styles.emptyFoldersText,
                  { color: t.textSecondary },
                ]}
              >
                No folders added yet. Grant access below.
              </Text>
            </View>
          )}
        </View>
      }
      ListFooterComponent={
        <View>
          <TouchableOpacity
            style={[
              styles.addFolderBtn,
              { backgroundColor: appColors.primary, opacity: busy ? 0.6 : 1 },
            ]}
            onPress={handleAdd}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <FolderPlus color="white" size={18} strokeWidth={2.5} />
                <Text style={styles.addFolderBtnText}>Add Folder</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.importedFilesLink}
            onPress={() => router.push("/library" as any)}
            activeOpacity={0.8}
          >
            <Archive color={appColors.primary} size={16} strokeWidth={2} />
            <Text style={[styles.importedFilesText, { color: appColors.primary }]}>
              View individually imported files
            </Text>
          </TouchableOpacity>
        </View>
      }
      contentContainerStyle={styles.foldersContent}
      onRefresh={refetch}
      refreshing={false}
    />
  );
}

// ============================================================================
// Root screen
// ============================================================================

export default function DocLibLibrary() {
  const { colors: t } = useTheme();
  const [panel, setPanel] = useState<Panel>("library");
  const { open } = useDocumentOpener();
  const navigation = useNavigation();
  const canGoBack = navigation.canGoBack();

  const handleOpen = useCallback(
    (doc: DocumentRecord) => {
      dispatchOpen(doc, open);
    },
    [open],
  );

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: t.background }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar barStyle="light-content" />

      <AppHeaderContainer>
        <GradientView
          colors={[
            appColors.gradientStart,
            appColors.gradientMid,
            appColors.gradientEnd,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerTop}>
            {canGoBack ? (
              <TouchableOpacity
                style={styles.headerBackBtn}
                onPress={() => router.back()}
                activeOpacity={0.85}
              >
                <ChevronLeft color="white" size={22} strokeWidth={2.5} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40 }} />
            )}
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Document Library</Text>
              <Text style={styles.headerSubtitle}>
                Auto-indexed from your folders
              </Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.segmentedControl}>
            {(
              [
                { key: "library", label: "Library", Icon: Library },
                { key: "search", label: "Search", Icon: SearchIcon },
                { key: "folders", label: "Folders", Icon: SettingsIcon },
              ] as const
            ).map(({ key, label, Icon }) => {
              const active = panel === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.segment,
                    active && styles.segmentActive,
                  ]}
                  onPress={() => setPanel(key)}
                  activeOpacity={0.85}
                >
                  <Icon
                    color={active ? appColors.primary : "white"}
                    size={16}
                    strokeWidth={2.5}
                  />
                  <Text
                    style={[
                      styles.segmentLabel,
                      { color: active ? appColors.primary : "white" },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </GradientView>
      </AppHeaderContainer>

      <PINGate screen="library">
        <View style={styles.body}>
          {panel === "library" && <LibraryPanel onOpen={handleOpen} />}
          {panel === "search" && <SearchPanel onOpen={handleOpen} />}
          {panel === "folders" && <FoldersPanel />}
        </View>
      </PINGate>
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 14,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 1,
  },

  // Segmented control
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 9,
  },
  segmentActive: {
    backgroundColor: "white",
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // Banner
  banner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },

  // Section
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: "600",
  },

  // Recent
  recentSection: {
    marginTop: 10,
  },
  recentScroll: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },

  // Type tabs
  tabsSection: {
    marginTop: 18,
    marginBottom: 4,
  },
  tabsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  typeTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  typeTabLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  typeTabBadge: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  typeTabBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },

  // Lists
  listContent: {
    paddingTop: 8,
    paddingBottom: 32,
    flexGrow: 1,
  },

  // Loading
  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },

  // Empty
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 14,
  },
  emptyIconBox: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 6,
  },
  emptyBtnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
  },

  // Search panel
  panelRoot: {
    flex: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  resultCount: {
    fontSize: 12,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  searchHint: {
    flex: 1,
    alignItems: "center",
    paddingTop: 64,
    gap: 12,
    paddingHorizontal: 32,
  },
  searchHintText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },

  // Folders panel
  foldersContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 0,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 22,
  },
  statCard: {
    minWidth: 64,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
  },
  statCount: {
    fontSize: 20,
    fontWeight: "800",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  foldersSectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  emptyFolders: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyFoldersText: {
    fontSize: 13,
  },
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 12,
    gap: 12,
    marginBottom: 10,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  folderIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  folderInfo: {
    flex: 1,
    gap: 2,
  },
  folderName: {
    fontSize: 15,
    fontWeight: "600",
  },
  folderDate: {
    fontSize: 12,
  },
  folderRemoveBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
  addFolderBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 16,
  },
  addFolderBtnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
  },
  importedFilesLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
    paddingVertical: 10,
  },
  importedFilesText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
