/**
 * Bookmarks (saved pages)
 *
 * The pages a reader kept, browsable as PAGES rather than as files, ranked by
 * how often they go back to them — and still here after the source file is
 * gone from the app and from the device.
 *
 * A tap opens /saved-page: the ONE page that was bookmarked, rendered from the
 * snapshot stored with it. It deliberately does NOT open the source document —
 * a bookmark is a page, not a pointer into a file, and the page has to open the
 * same way whether or not the file still exists. Opening the whole document is
 * offered there, as a secondary action, while the file is still around.
 *
 * Structure follows app/favorites.tsx (AppHeaderContainer + GradientView
 * header + useTheme + FlatList + search field). Grouped by file, because a
 * flat list of 200 page cards is unreadable and the reader's mental model is
 * "the book I keep going back to, and the pages inside it".
 *
 * Gated by SAVED_PAGES. With the flag off nothing routes here.
 */
import { router } from "expo-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileWarning,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { colors } from "@/constants/theme";
import { SAVED_PAGES } from "@/constants/featureFlags";
import { useTheme } from "@/services/ThemeProvider";
import { resolveIdentityToLiveUri } from "@/services/fileIdentity";
import {
  getSavedPage,
  getSavedPageGroups,
  recordOpen,
  removeSavedPage,
  savedPageLocationLabel,
  subscribeSavedPages,
  updateNote,
  type SavedPage,
  type SavedPageGroup,
  type SavedPagesSort,
} from "@/services/savedPagesService";
import { pickAndRelink } from "@/services/savedPageNavigator";

// ── Sort options shown to the user ───────────────────────────────────────────
// All three are visible: the blend is the default, never the only choice.
const SORTS: { id: SavedPagesSort; label: string }[] = [
  { id: "frequent", label: "Most visited" },
  { id: "recent", label: "Recently used" },
  { id: "added", label: "Recently added" },
];

function relativeDate(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

export default function SavedPagesScreen() {
  const { colors: t, mode } = useTheme();
  const [groups, setGroups] = useState<SavedPageGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SavedPagesSort>("frequent");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** identityKey → whether the file still resolves. */
  const [liveByKey, setLiveByKey] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<SavedPage | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [relinking, setRelinking] = useState(false);

  const load = useCallback(async () => {
    const next = await getSavedPageGroups(sort);
    setGroups(next);
    setLoading(false);
  }, [sort]);

  useEffect(() => {
    void load();
    return subscribeSavedPages(() => {
      void load();
    });
  }, [load]);

  // Availability is checked once per file, not per page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries: Record<string, boolean> = {};
      for (const group of groups) {
        const uri = await resolveIdentityToLiveUri(group.identityKey);
        entries[group.identityKey] = uri !== null;
      }
      if (!cancelled) setLiveByKey(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => ({
        ...group,
        pages: group.pages.filter((p) =>
          [p.fileName, p.excerpt, p.note ?? "", p.chapterLabel ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        ),
      }))
      .filter(
        (group) =>
          group.pages.length > 0 || group.fileName.toLowerCase().includes(q),
      );
  }, [groups, query]);

  const totalPages = useMemo(
    () => groups.reduce((n, g) => n + g.pages.length, 0),
    [groups],
  );

  /**
   * Open the bookmarked PAGE.
   *
   * /saved-page renders the stored snapshot and touches no file, so this can
   * never fail and never dead-ends on a deleted file — which is why there is no
   * longer a fallback branch here. Opening the source document is a separate,
   * secondary action offered on that screen.
   */
  const handleOpen = useCallback(async (page: SavedPage) => {
    // Count the visit FIRST, so ranking updates even if navigation is dropped.
    await recordOpen(page.id);
    router.push({ pathname: "/saved-page" as never, params: { id: page.id } });
  }, []);

  const handleRemove = useCallback((page: SavedPage) => {
    Alert.alert(
      "Remove bookmark",
      `Remove ${savedPageLocationLabel(page)} of ${page.fileName}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void removeSavedPage(page.id);
            setDetail(null);
          },
        },
      ],
    );
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!detail) return;
    await updateNote(detail.id, noteDraft);
    setDetail(null);
  }, [detail, noteDraft]);

  /**
   * "Find this file" — the user points at the file again and the record is
   * re-linked to it. Only the pointer moves: the excerpt, note and location
   * they saved are theirs and are never rewritten.
   */
  const handleFindFile = useCallback(async () => {
    if (!detail) return;
    setRelinking(true);
    try {
      const outcome = await pickAndRelink(detail);
      if (outcome.status === "cancelled") return; // say nothing
      if (outcome.status === "failed") {
        Alert.alert(
          "Could not re-link",
          "That file could not be linked to this bookmark. The saved page is unchanged.",
        );
        return;
      }

      // Re-check availability so the badge clears without a manual refresh.
      const fresh = await getSavedPage(detail.id);
      if (fresh) {
        const live = await resolveIdentityToLiveUri(fresh.identityKey);
        setLiveByKey((prev) => ({ ...prev, [fresh.identityKey]: live !== null }));
        setDetail(fresh);
      }
      Alert.alert("Re-linked", `This bookmark now points at "${outcome.fileName}".`);
    } finally {
      setRelinking(false);
    }
  }, [detail]);

  const backgroundColor = t.background;

  // The flag is a kill switch: with it off this route shows nothing and
  // offers a way back, rather than rendering a half-feature.
  if (!SAVED_PAGES) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={["top"]}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: t.text }]}>
            Bookmarks is not available
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
            <Text style={{ color: t.primary, fontWeight: "700" }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={["top"]}>
      <AppHeaderContainer>
        <View style={styles.headerContainer}>
          <GradientView
            colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.headerContent}>
              <TouchableOpacity
                onPress={() => router.back()}
                hitSlop={12}
                style={styles.backBtn}
                accessibilityLabel="Go back"
              >
                <ArrowLeft size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.headerTitleSection}>
                <Text style={styles.headerTitle}>Bookmarks</Text>
                <Text style={styles.headerSubtitle}>
                  {totalPages === 0
                    ? "Pages you save stay here, even after the file is gone"
                    : `${totalPages} page${totalPages === 1 ? "" : "s"} across ${groups.length} file${groups.length === 1 ? "" : "s"}`}
                </Text>
              </View>
            </View>
          </GradientView>
        </View>
      </AppHeaderContainer>

      {/* Search */}
      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: t.card, borderColor: t.border },
          ]}
        >
          <Search color={t.primary} size={18} strokeWidth={2.5} />
          <TextInput
            placeholder="Search pages, notes and files..."
            placeholderTextColor={t.textTertiary}
            style={[styles.searchInput, { color: t.text }]}
            value={query}
            onChangeText={setQuery}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
              <X size={18} color={t.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sort — all three options visible */}
      <View style={styles.sortRow}>
        {SORTS.map((option) => {
          const active = option.id === sort;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => setSort(option.id)}
              style={[
                styles.sortChip,
                {
                  backgroundColor: active
                    ? t.primary
                    : mode === "dark"
                      ? "#334155"
                      : "#F1F5F9",
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.sortChipText,
                  { color: active ? "#FFFFFF" : t.textSecondary },
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: t.text }]}>
            {query ? "Nothing matches that search" : "No bookmarks yet"}
          </Text>
          <Text style={[styles.emptyBody, { color: t.textSecondary }]}>
            {query
              ? "Try a different word."
              : "While reading, use Bookmark in the three-dots menu to keep the page you are on. Bookmarks stay here even if you delete the file."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(group) => group.identityKey}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: group }) => {
            const isCollapsed = collapsed[group.identityKey] === true;
            const available = liveByKey[group.identityKey] !== false;
            return (
              <View
                style={[
                  styles.group,
                  { backgroundColor: t.card, borderColor: t.border },
                ]}
              >
                <TouchableOpacity
                  style={styles.groupHeader}
                  onPress={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [group.identityKey]: !isCollapsed,
                    }))
                  }
                  activeOpacity={0.7}
                >
                  {isCollapsed ? (
                    <ChevronRight size={18} color={t.textSecondary} />
                  ) : (
                    <ChevronDown size={18} color={t.textSecondary} />
                  )}
                  <View style={styles.groupTitleWrap}>
                    <Text
                      style={[styles.groupTitle, { color: t.text }]}
                      numberOfLines={1}
                    >
                      {group.fileName}
                    </Text>
                    <Text style={[styles.groupMeta, { color: t.textTertiary }]}>
                      {group.pages.length} saved
                    </Text>
                  </View>
                  {!available && (
                    <View
                      style={[styles.badge, { backgroundColor: t.backgroundSecondary }]}
                    >
                      <FileWarning size={12} color={t.warning} />
                      <Text style={[styles.badgeText, { color: t.warning }]}>
                        File no longer available
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                {!isCollapsed &&
                  group.pages.map((page) => (
                    <TouchableOpacity
                      key={page.id}
                      style={[styles.pageRow, { borderTopColor: t.borderLight }]}
                      onPress={() => void handleOpen(page)}
                      onLongPress={() => {
                        setDetail(page);
                        setNoteDraft(page.note ?? "");
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.pageTop}>
                        <Text style={[styles.pageLocation, { color: t.primary }]}>
                          {savedPageLocationLabel(page)}
                        </Text>
                        <Text style={[styles.pageDate, { color: t.textTertiary }]}>
                          {relativeDate(page.createdAt)}
                        </Text>
                      </View>

                      {/* A saved page that was rasterised shows itself. The
                          excerpt sits beside it rather than under it, so a
                          row stays one glance regardless of which it has. */}
                      <View style={styles.pageBody}>
                        {!!page.thumbPath && (
                          <Image
                            source={{ uri: page.thumbPath }}
                            style={[
                              styles.pageThumb,
                              { borderColor: t.borderLight },
                            ]}
                            resizeMode="cover"
                            accessibilityLabel={`Page image of ${page.fileName}`}
                          />
                        )}
                        <Text
                          style={[
                            styles.pageExcerpt,
                            {
                              flex: 1,
                              color: page.excerpt ? t.textSecondary : t.textTertiary,
                              fontStyle: page.excerpt ? "normal" : "italic",
                            },
                          ]}
                          numberOfLines={page.thumbPath ? 4 : 3}
                        >
                          {page.excerpt || "No text captured"}
                        </Text>
                      </View>

                      {!!page.note && (
                        <Text
                          style={[styles.pageNote, { color: t.text, borderLeftColor: t.primary }]}
                          numberOfLines={2}
                        >
                          {page.note}
                        </Text>
                      )}

                      {page.openCount > 0 && (
                        <View style={styles.pageBottom}>
                          <RotateCcw size={12} color={t.textTertiary} />
                          <Text style={[styles.pageReturns, { color: t.textTertiary }]}>
                            Opened {page.openCount}{" "}
                            {page.openCount === 1 ? "time" : "times"}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
              </View>
            );
          }}
        />
      )}

      {/* Snapshot detail — what a bookmark looks like when the file is gone */}
      <Modal
        visible={detail !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDetail(null)}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={() => {}}
          >
            {detail && (
              <>
                <Text style={[styles.modalLocation, { color: t.primary }]}>
                  {savedPageLocationLabel(detail)}
                </Text>
                <Text style={[styles.modalFile, { color: t.text }]} numberOfLines={2}>
                  {detail.fileName}
                </Text>
                <Text style={[styles.modalDate, { color: t.textTertiary }]}>
                  Saved {relativeDate(detail.createdAt)}
                  {detail.openCount > 0
                    ? ` · opened ${detail.openCount} ${detail.openCount === 1 ? "time" : "times"}`
                    : ""}
                </Text>

                {liveByKey[detail.identityKey] === false && (
                  <>
                    <View
                      style={[
                        styles.modalWarning,
                        { backgroundColor: t.backgroundSecondary },
                      ]}
                    >
                      <FileWarning size={14} color={t.warning} />
                      <Text style={[styles.modalWarningText, { color: t.textSecondary }]}>
                        This file is no longer on the device. Everything you
                        saved is still here.
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.findBtn, { borderColor: t.primary }]}
                      onPress={() => void handleFindFile()}
                      disabled={relinking}
                    >
                      {relinking ? (
                        <ActivityIndicator size="small" color={t.primary} />
                      ) : (
                        <Search size={16} color={t.primary} />
                      )}
                      <Text style={[styles.findBtnText, { color: t.primary }]}>
                        Find this file
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                <Text
                  style={[
                    styles.modalExcerpt,
                    {
                      color: detail.excerpt ? t.textSecondary : t.textTertiary,
                      borderColor: t.borderLight,
                      fontStyle: detail.excerpt ? "normal" : "italic",
                    },
                  ]}
                >
                  {detail.excerpt || "No text captured"}
                </Text>

                <Text style={[styles.modalLabel, { color: t.textSecondary }]}>
                  Your note
                </Text>
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Why did you save this?"
                  placeholderTextColor={t.textTertiary}
                  multiline
                  maxLength={500}
                  style={[
                    styles.modalNoteInput,
                    { color: t.text, borderColor: t.border, backgroundColor: t.background },
                  ]}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: t.primary }]}
                    onPress={() => void handleSaveNote()}
                  >
                    <Text style={styles.modalBtnText}>Save note</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: t.backgroundSecondary }]}
                    onPress={() => handleRemove(detail)}
                  >
                    <Trash2 size={16} color={t.error} />
                    <Text style={[styles.modalBtnText, { color: t.error }]}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  headerContainer: { overflow: "hidden" },
  header: { paddingHorizontal: 16, paddingVertical: 14 },
  headerContent: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { padding: 4 },
  headerTitleSection: { flex: 1 },
  headerTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  headerSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 2,
  },

  searchRow: { paddingHorizontal: 16, paddingTop: 12 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },

  sortRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  sortChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  sortChipText: { fontSize: 12, fontWeight: "700" },

  listContent: { padding: 16, gap: 12 },
  group: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  groupTitleWrap: { flex: 1 },
  groupTitle: { fontSize: 15, fontWeight: "700" },
  groupMeta: { fontSize: 11, marginTop: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    maxWidth: 140,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },

  pageRow: { paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1 },
  pageTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageLocation: { fontSize: 13, fontWeight: "800" },
  pageDate: { fontSize: 11 },
  pageBody: { flexDirection: "row", gap: 10, marginTop: 6 },
  pageThumb: {
    width: 48,
    height: 68,
    borderRadius: 4,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
  },
  pageExcerpt: { fontSize: 13, lineHeight: 19 },
  pageNote: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
  },
  pageBottom: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  pageReturns: { fontSize: 11, fontWeight: "600" },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyBtn: { marginTop: 8, padding: 8 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { width: "100%", maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 18 },
  modalLocation: { fontSize: 13, fontWeight: "800" },
  modalFile: { fontSize: 17, fontWeight: "700", marginTop: 2 },
  modalDate: { fontSize: 11, marginTop: 4 },
  modalWarning: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  modalWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  findBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 10,
  },
  findBtnText: { fontSize: 13, fontWeight: "700" },
  modalExcerpt: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  modalLabel: { fontSize: 12, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  modalNoteInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    minHeight: 64,
    textAlignVertical: "top",
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  modalBtnText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
});
