/**
 * One bookmarked page.
 *
 * THIS is what opening a bookmark does. A bookmark is a PAGE, not a pointer
 * into a file, so tapping one lands here — on the page that was saved — and
 * never in the document viewer. Nothing on this screen reads the source file,
 * the file index or the network. It therefore looks exactly the same whether
 * the file is still in the app, was deleted from the app, or was deleted from
 * the device — which is the promise the feature makes.
 *
 * THREE WAYS A PAGE COMES BACK, best first:
 *   1. PICTURE  — a rasterised PDF page (services/savedPageImageStore.ts).
 *   2. MARKUP   — the page's own HTML for reflow formats, re-rendered here by
 *                 the same engine that drew it, so fonts, tables and lists
 *                 survive (utils/pageHtmlCapture.ts).
 *   3. TEXT     — always captured, and the fallback when neither exists.
 * The text is kept under all three regardless, because copy, share and search
 * need words, and a picture cannot provide them.
 *
 * Opening the whole document is still available, as a clearly secondary action
 * and only while the file resolves. It is a different request ("take me back
 * into the book"), not the default one.
 *
 * Typography follows the reader's own settings (services/readerSettingsService)
 * so a saved page reads like the reader it came from rather than like a dialog.
 *
 * Gated by SAVED_PAGES, like every other surface of this feature.
 */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileWarning,
  Search,
  Share2,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { AppHeaderContainer } from "@/components/AppHeaderContainer";
import { GradientView } from "@/components/GradientView";
import { SAVED_PAGES } from "@/constants/featureFlags";
import { colors } from "@/constants/theme";
import { resolveIdentityToLiveUri } from "@/services/fileIdentity";
import { openSavedPage, pickAndRelink } from "@/services/savedPageNavigator";
import {
  getSavedPage,
  getSavedPageHtml,
  getSavedPageText,
  removeSavedPage,
  savedPageLocationLabel,
  subscribeSavedPages,
  updateNote,
  type SavedPage,
} from "@/services/savedPagesService";
import { buildSnapshotDocument } from "@/utils/pageHtmlCapture";
import { getSavedReaderSettings } from "@/services/readerSettingsService";
import { useTheme } from "@/services/ThemeProvider";
import { DEFAULT_READER_SETTINGS } from "@/src/types/document-viewer.types";

function savedOn(at: number): string {
  try {
    return new Date(at).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function SavedPageScreen() {
  const { colors: t } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  // The sheet's inner width: screen, less the scroll padding and the sheet's
  // own horizontal padding and border.
  const pageWidth = Math.max(160, screenWidth - 32 - 36 - 2);
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [page, setPage] = useState<SavedPage | null>(null);
  const [body, setBody] = useState("");
  /** False when the record predates snapshots, or capture failed at save time. */
  const [isFullPage, setIsFullPage] = useState(false);
  /** The page's own markup, for reflow formats. Null for PDFs and old records. */
  const [snapshotHtml, setSnapshotHtml] = useState<{
    html: string;
    css: string;
  } | null>(null);
  /** Rendered height reported by the markup WebView, so it sizes to content. */
  const [htmlHeight, setHtmlHeight] = useState(320);
  /** True once the page image fails to load — a deleted or corrupt file. */
  const [imageBroken, setImageBroken] = useState(false);
  /** Whether the page's text is expanded under a picture or markup view. */
  const [textOpen, setTextOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  /** null while unknown — the badge must not flicker "gone" before the check. */
  const [fileLive, setFileLive] = useState<boolean | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reader typography, so a saved page reads the way the reader reads.
  const [fontSize, setFontSize] = useState(DEFAULT_READER_SETTINGS.fontSize);
  const [lineHeightRatio, setLineHeightRatio] = useState(
    DEFAULT_READER_SETTINGS.lineHeight,
  );
  useEffect(() => {
    void (async () => {
      const settings = await getSavedReaderSettings();
      if (!settings || !mounted.current) return;
      setFontSize(settings.fontSize);
      setLineHeightRatio(settings.lineHeight);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    const record = await getSavedPage(id);
    if (!mounted.current) return;
    if (!record) {
      // Removed from another surface while this screen was open.
      setPage(null);
      setLoading(false);
      return;
    }
    const [{ text, full }, markup] = await Promise.all([
      getSavedPageText(id),
      getSavedPageHtml(id),
    ]);
    if (!mounted.current) return;
    setPage(record);
    setBody(text);
    setIsFullPage(full);
    setSnapshotHtml(markup);
    setImageBroken(false);
    setNoteDraft((prev) => (prev ? prev : (record.note ?? "")));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    return subscribeSavedPages(() => {
      void load();
    });
  }, [load]);

  // Whether the source file still exists decides ONE thing: whether the
  // secondary "Open in document" action is offered. The page above it renders
  // either way, so this is never on the critical path.
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    void (async () => {
      const uri = await resolveIdentityToLiveUri(page.identityKey);
      if (!cancelled && mounted.current) setFileLive(uri !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const paragraphs = useMemo(
    () => body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [body],
  );

  /** The picture of the page, when there is one and it still loads. */
  const imageUri =
    page?.thumbPath && !imageBroken ? page.thumbPath : null;

  /** The re-renderable document, built fresh so theme changes apply. */
  const snapshotDoc = useMemo(() => {
    if (!snapshotHtml?.html) return null;
    return buildSnapshotDocument({
      html: snapshotHtml.html,
      css: snapshotHtml.css,
      textColor: t.text,
      backgroundColor: t.card,
    });
  }, [snapshotHtml, t.text, t.card]);

  /**
   * Which form of the page is on screen. Picture beats markup beats text:
   * each is a closer likeness of what the reader saw than the next.
   */
  const shownAs: "image" | "html" | "text" = imageUri
    ? "image"
    : snapshotDoc
      ? "html"
      : "text";

  const handleCopy = useCallback(async () => {
    if (!body) return;
    await Clipboard.setStringAsync(body);
    setCopied(true);
    setTimeout(() => {
      if (mounted.current) setCopied(false);
    }, 1800);
  }, [body]);

  const handleShare = useCallback(async () => {
    if (!page) return;
    const header = `${savedPageLocationLabel(page)} — ${page.fileName}`;
    try {
      await Share.share({
        title: header,
        message: body ? `${header}\n\n${body}` : header,
      });
    } catch {
      // Dismissed, or no share target. Nothing to report.
    }
  }, [page, body]);

  const handleSaveNote = useCallback(async () => {
    if (!page) return;
    await updateNote(page.id, noteDraft);
    if (!mounted.current) return;
    setNoteSaved(true);
    setTimeout(() => {
      if (mounted.current) setNoteSaved(false);
    }, 1800);
  }, [page, noteDraft]);

  const handleRemove = useCallback(() => {
    if (!page) return;
    Alert.alert(
      "Remove bookmark",
      `Remove ${savedPageLocationLabel(page)} of ${page.fileName}? The saved page goes with it, and this cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await removeSavedPage(page.id);
              router.back();
            })();
          },
        },
      ],
    );
  }, [page]);

  /** Secondary: the whole document, at this page. Only offered when it exists. */
  const handleOpenDocument = useCallback(async () => {
    if (!page) return;
    const result = await openSavedPage(page);
    if (!result.opened && mounted.current) {
      setFileLive(false);
      Alert.alert(
        "Cannot open the document",
        result.reason === "no-viewer"
          ? "This app has no reader for that file type. The saved page is still here."
          : "That file is no longer on this device. The saved page is still here.",
      );
    }
  }, [page]);

  /** Point the record back at a file the reader has found again. */
  const handleFindFile = useCallback(async () => {
    if (!page) return;
    setRelinking(true);
    try {
      const outcome = await pickAndRelink(page);
      if (outcome.status === "cancelled") return;
      if (outcome.status === "failed") {
        Alert.alert(
          "Could not re-link",
          "That file could not be linked to this bookmark. The saved page is unchanged.",
        );
        return;
      }
      await load();
      if (mounted.current) setFileLive(true);
      Alert.alert("Re-linked", `This bookmark now points at "${outcome.fileName}".`);
    } finally {
      if (mounted.current) setRelinking(false);
    }
  }, [page, load]);

  const backgroundColor = t.background;

  if (!SAVED_PAGES) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={["top"]}>
        <View style={styles.centered}>
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

  const locationLabel = page ? savedPageLocationLabel(page) : "Saved page";

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
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {locationLabel}
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {page ? page.fileName : "Bookmark"}
                </Text>
              </View>
              {page && (
                <TouchableOpacity
                  onPress={() => void handleShare()}
                  hitSlop={12}
                  style={styles.backBtn}
                  accessibilityLabel="Share this page"
                >
                  <Share2 size={20} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>
          </GradientView>
        </View>
      </AppHeaderContainer>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      ) : !page ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, { color: t.text }]}>
            This bookmark is gone
          </Text>
          <Text style={[styles.emptyBody, { color: t.textSecondary }]}>
            It was removed from another screen.
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
            <Text style={{ color: t.primary, fontWeight: "700" }}>
              Back to bookmarks
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── The page ──────────────────────────────────────────── */}
          <View
            style={[
              styles.pageSheet,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <View style={styles.pageSheetTop}>
              <Text style={[styles.pageSheetLocation, { color: t.primary }]}>
                {locationLabel}
                {page.totalPages ? ` of ${page.totalPages}` : ""}
              </Text>
              <Text style={[styles.pageSheetDate, { color: t.textTertiary }]}>
                Saved {savedOn(page.createdAt)}
              </Text>
            </View>

            {/* The page, as close to what the reader saw as was capturable. */}
            {shownAs === "image" ? (
              <Image
                source={{ uri: imageUri! }}
                style={[
                  styles.pageImage,
                  { width: pageWidth, height: pageWidth * 1.414 },
                ]}
                resizeMode="contain"
                onError={() => setImageBroken(true)}
                accessibilityLabel={`Page image of ${locationLabel}`}
              />
            ) : shownAs === "html" ? (
              <View style={{ height: htmlHeight }}>
                <WebView
                  originWhitelist={[]}
                  source={{ html: snapshotDoc! }}
                  style={{ backgroundColor: t.card }}
                  scrollEnabled={false}
                  // The stored markup had its scripts stripped at capture
                  // time; the only script here is the shell's height
                  // reporter, which is what sizes this view to the page.
                  javaScriptEnabled
                  // Nothing may be loaded or navigated to. A saved page is a
                  // record of something already read, not a live document.
                  onShouldStartLoadWithRequest={(req) =>
                    req.url === "about:blank" || req.url.startsWith("data:")
                  }
                  onMessage={(e) => {
                    try {
                      const msg = JSON.parse(e.nativeEvent.data);
                      if (msg.type === "height" && msg.height > 0) {
                        // Bounded: a runaway report must not create a
                        // multi-screen view inside a scroll view.
                        setHtmlHeight(Math.min(Math.ceil(msg.height) + 8, 4000));
                      }
                    } catch {
                      // Not our message — ignore.
                    }
                  }}
                />
              </View>
            ) : paragraphs.length > 0 ? (
              paragraphs.map((paragraph, i) => (
                <Text
                  key={i}
                  selectable
                  style={[
                    styles.pageText,
                    {
                      color: t.text,
                      fontSize,
                      lineHeight: fontSize * lineHeightRatio,
                    },
                  ]}
                >
                  {paragraph}
                </Text>
              ))
            ) : (
              <Text style={[styles.pageEmpty, { color: t.textTertiary }]}>
                Nothing was captured for this page. The bookmark still knows
                where it is, so it can be opened in the document when the file
                is available.
              </Text>
            )}

            {/* Honest about what is being shown: a record saved before page
                snapshots existed has only its list preview, and saying so
                beats letting a 600-char stub pass for the page. */}
            {shownAs === "text" && paragraphs.length > 0 && !isFullPage && (
              <Text style={[styles.partialNote, { color: t.textTertiary }]}>
                This bookmark was saved before whole pages were kept, so only
                the preview above is stored. Bookmark it again while the file is
                open to keep the full page.
              </Text>
            )}
          </View>

          {/* The words behind the picture. A rasterised page cannot be read
              aloud, searched or quoted, so the text stays available under
              it — collapsed, because the picture is the point. */}
          {shownAs !== "text" && paragraphs.length > 0 && (
            <View
              style={[
                styles.textPanel,
                { backgroundColor: t.card, borderColor: t.border },
              ]}
            >
              <TouchableOpacity
                style={styles.textPanelHeader}
                onPress={() => setTextOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: textOpen }}
              >
                {textOpen ? (
                  <ChevronDown size={16} color={t.textSecondary} />
                ) : (
                  <ChevronRight size={16} color={t.textSecondary} />
                )}
                <Text style={[styles.textPanelTitle, { color: t.textSecondary }]}>
                  Page text
                </Text>
              </TouchableOpacity>
              {textOpen &&
                paragraphs.map((paragraph, i) => (
                  <Text
                    key={i}
                    selectable
                    style={[
                      styles.pageText,
                      {
                        color: t.text,
                        fontSize,
                        lineHeight: fontSize * lineHeightRatio,
                      },
                    ]}
                  >
                    {paragraph}
                  </Text>
                ))}
            </View>
          )}

          {/* ── Actions on the page itself ────────────────────────── */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[
                styles.action,
                { backgroundColor: t.card, borderColor: t.border },
              ]}
              onPress={() => void handleCopy()}
              disabled={!body}
            >
              {copied ? (
                <Check size={16} color={t.success} />
              ) : (
                <Copy size={16} color={body ? t.primary : t.textTertiary} />
              )}
              <Text
                style={[
                  styles.actionText,
                  { color: body ? t.text : t.textTertiary },
                ]}
              >
                {copied ? "Copied" : "Copy text"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.action,
                { backgroundColor: t.card, borderColor: t.border },
              ]}
              onPress={handleRemove}
            >
              <Trash2 size={16} color={t.error} />
              <Text style={[styles.actionText, { color: t.error }]}>Remove</Text>
            </TouchableOpacity>
          </View>

          {/* ── The note ──────────────────────────────────────────── */}
          <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>
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
              styles.noteInput,
              { color: t.text, borderColor: t.border, backgroundColor: t.card },
            ]}
          />
          <TouchableOpacity
            style={[styles.noteSaveBtn, { backgroundColor: t.primary }]}
            onPress={() => void handleSaveNote()}
          >
            <Text style={styles.noteSaveText}>
              {noteSaved ? "Note saved" : "Save note"}
            </Text>
          </TouchableOpacity>

          {/* ── The source file, as a secondary matter ────────────── */}
          <Text style={[styles.sectionLabel, { color: t.textSecondary }]}>
            Source file
          </Text>
          <View
            style={[
              styles.sourceCard,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <Text style={[styles.sourceName, { color: t.text }]} numberOfLines={2}>
              {page.fileName}
            </Text>

            {fileLive === false ? (
              <>
                <View style={styles.sourceGoneRow}>
                  <FileWarning size={14} color={t.warning} />
                  <Text style={[styles.sourceGoneText, { color: t.textSecondary }]}>
                    No longer on this device. The page above is unaffected.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.sourceBtn, { borderColor: t.primary }]}
                  onPress={() => void handleFindFile()}
                  disabled={relinking}
                >
                  {relinking ? (
                    <ActivityIndicator size="small" color={t.primary} />
                  ) : (
                    <Search size={16} color={t.primary} />
                  )}
                  <Text style={[styles.sourceBtnText, { color: t.primary }]}>
                    Find this file
                  </Text>
                </TouchableOpacity>
              </>
            ) : fileLive === true ? (
              <TouchableOpacity
                style={[styles.sourceBtn, { borderColor: t.border }]}
                onPress={() => void handleOpenDocument()}
              >
                <BookOpen size={16} color={t.textSecondary} />
                <Text style={[styles.sourceBtnText, { color: t.textSecondary }]}>
                  Open the whole document here
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.sourceChecking, { color: t.textTertiary }]}>
                Checking…
              </Text>
            )}
          </View>

          {page.openCount > 0 && (
            <Text style={[styles.footNote, { color: t.textTertiary }]}>
              Opened {page.openCount} {page.openCount === 1 ? "time" : "times"}
            </Text>
          )}
        </ScrollView>
      )}
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
  headerTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  headerSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 2,
  },

  scrollContent: { padding: 16, paddingBottom: 48 },

  pageSheet: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  pageSheetTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    flexWrap: "wrap",
    gap: 6,
  },
  pageSheetLocation: { fontSize: 13, fontWeight: "800" },
  pageSheetDate: { fontSize: 11 },
  pageImage: { alignSelf: "center", borderRadius: 4 },
  textPanel: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingBottom: 4,
    marginTop: 12,
  },
  textPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 12,
  },
  textPanelTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pageText: { marginBottom: 14 },
  pageEmpty: { fontSize: 14, lineHeight: 21, fontStyle: "italic" },
  partialNote: { fontSize: 11, lineHeight: 16, marginTop: 6, fontStyle: "italic" },

  actionRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  actionText: { fontSize: 13, fontWeight: "700" },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 26,
    marginBottom: 8,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    minHeight: 76,
    textAlignVertical: "top",
  },
  noteSaveBtn: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  noteSaveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  sourceCard: { borderWidth: 1, borderRadius: 12, padding: 14 },
  sourceName: { fontSize: 14, fontWeight: "700" },
  sourceGoneRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 8,
  },
  sourceGoneText: { flex: 1, fontSize: 12, lineHeight: 17 },
  sourceChecking: { fontSize: 12, marginTop: 8 },
  sourceBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 12,
  },
  sourceBtnText: { fontSize: 13, fontWeight: "700" },

  footNote: { fontSize: 11, textAlign: "center", marginTop: 22 },

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyBtn: { marginTop: 8, padding: 8 },
});
