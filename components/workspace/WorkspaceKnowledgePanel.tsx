// ============================================
// WorkspaceKnowledgePanel — the WorkSpace "Discover" tab.
// ============================================
// A single read-only surface that brings the secondary intelligence services
// together, so the workspace feels aware of what you're doing:
//   • Continue — context-awareness: your in-focus topic + related material
//   • Review again — knowledge decay: studied-but-fading documents
//   • You might open next — predictive ranking
//   • Topics in your library — automatic topic discovery
//
// SECONDARY / additive: pure consumer of the new services. Renders nothing
// disruptive, opens documents through the same routes the rest of the app uses,
// and degrades to a friendly empty state when there's no activity yet.
// ============================================

import { useRouter } from "expo-router";
import {
  BookMarked,
  Clock,
  Compass,
  FileText,
  History,
  Image as ImageIcon,
  Sparkles,
  StickyNote,
  TrendingUp,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  getActiveContext,
  subscribeContext,
  type SurfacedContext,
} from "@/services/contextAwarenessService";
import {
  getResurfacedDocuments,
  type DecayItem,
} from "@/services/knowledgeDecayService";
import {
  discoverTopics,
  type DiscoveredTopic,
} from "@/services/knowledgeGraphService";
import {
  getPredictedDocuments,
  type RankedDocument,
} from "@/services/predictiveRankingService";
import {
  getAllReadingProgress,
  subscribeReadingProgress,
} from "@/services/readingProgressService";
import {
  estimateReadingMinutesFromPages,
  formatReadingTime,
} from "@/utils/readingTime";
import { stripExtension } from "@/utils/keywords";

const ACCENT = "#9333EA";

interface DocLike {
  uri: string;
  name: string;
  type: string;
}

interface PanelData {
  context: SurfacedContext;
  review: DecayItem[];
  predicted: RankedDocument[];
  topics: DiscoveredTopic[];
  /** uri → estimated reading minutes (only when page count is known). */
  readMins: Record<string, number>;
}

const EMPTY: PanelData = {
  context: { focus: null, relatedDocuments: [], relatedNotes: [], relatedImages: [] },
  review: [],
  predicted: [],
  topics: [],
  readMins: {},
};

export default function WorkspaceKnowledgePanel({
  mode,
  t,
  onOpenNote,
}: {
  mode: "light" | "dark";
  t: any;
  onOpenNote?: (noteId: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [context, review, predicted, topics, progress] = await Promise.all([
        getActiveContext().catch(() => EMPTY.context),
        getResurfacedDocuments({ limit: 5 }).catch(() => []),
        getPredictedDocuments(6).catch(() => []),
        discoverTopics(2, 10).catch(() => []),
        getAllReadingProgress().catch(() => ({})),
      ]);

      const readMins: Record<string, number> = {};
      for (const [uri, entry] of Object.entries(progress)) {
        if (entry?.totalPages && entry.totalPages > 0) {
          readMins[uri] = estimateReadingMinutesFromPages(entry.totalPages);
        }
      }

      setData({ context, review, predicted, topics, readMins });
    } catch {
      setData(EMPTY);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubCtx = subscribeContext(refresh);
    const unsubProg = subscribeReadingProgress(refresh);
    return () => {
      unsubCtx();
      unsubProg();
    };
  }, [refresh]);

  const surface = mode === "dark" ? "#0F172A" : "#FFFFFF";
  const border = mode === "dark" ? "#334155" : "#E2E8F0";
  const subtle = mode === "dark" ? "#1E293B" : "#F1F5F9";

  const openDoc = useCallback(
    (d: DocLike) => {
      const pathname =
        d.type === "epub"
          ? "/epub-viewer"
          : d.type === "docx"
            ? "/docx-viewer"
            : "/pdf-viewer";
      router.push({ pathname: pathname as any, params: { uri: d.uri, name: d.name } });
    },
    [router],
  );

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  const { context, review, predicted, topics, readMins } = data;
  const hasContext =
    !!context.focus ||
    context.relatedDocuments.length > 0 ||
    context.relatedNotes.length > 0;
  const isEmpty =
    !hasContext && review.length === 0 && predicted.length === 0 && topics.length === 0;

  // ── Shared row renderer for a document ────────────────────────────────────
  const docRow = (
    d: DocLike,
    opts?: { trailing?: string; Icon?: any; iconColor?: string },
  ) => {
    const Icon = opts?.Icon ?? FileText;
    const mins = readMins[d.uri];
    return (
      <TouchableOpacity
        key={d.uri}
        activeOpacity={0.7}
        onPress={() => openDoc(d)}
        style={[styles.row, { backgroundColor: surface, borderColor: border }]}
      >
        <Icon size={17} color={opts?.iconColor ?? t.textTertiary} strokeWidth={2.1} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: t.text }]} numberOfLines={1}>
            {stripExtension(d.name)}
          </Text>
          {mins ? (
            <Text style={[styles.rowMeta, { color: t.textTertiary }]} numberOfLines={1}>
              {formatReadingTime(mins)}
            </Text>
          ) : null}
        </View>
        {opts?.trailing ? (
          <Text style={[styles.rowTrailing, { color: t.textSecondary }]}>{opts.trailing}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      {isEmpty ? (
        <View style={[styles.emptyCard, { backgroundColor: surface, borderColor: border }]}>
          <Compass size={26} color={ACCENT} strokeWidth={2} />
          <Text style={[styles.emptyTitle, { color: t.text }]}>Your knowledge, connected</Text>
          <Text style={[styles.emptyText, { color: t.textTertiary }]}>
            As you read and take notes, this space surfaces related documents,
            things worth reviewing, and the topics running through your library —
            automatically.
          </Text>
        </View>
      ) : null}

      {/* ── Continue / context-awareness ───────────────────────────────── */}
      {context.focus ? (
        <>
          <SectionTitle t={t} Icon={History} label="Continue" />
          <View style={[styles.focusCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.cardAccent, { backgroundColor: ACCENT }]} />
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() =>
                openDoc({
                  uri: context.focus!.uri,
                  name: context.focus!.name,
                  type: context.focus!.type,
                })
              }
            >
              <Text style={[styles.focusEyebrow, { color: ACCENT }]}>YOU'VE BEEN ON</Text>
              <Text style={[styles.focusTitle, { color: t.text }]} numberOfLines={2}>
                {stripExtension(context.focus.name)}
              </Text>
            </TouchableOpacity>

            {context.relatedDocuments.length > 0 ? (
              <View style={styles.focusGroup}>
                <Text style={[styles.focusGroupLabel, { color: t.textTertiary }]}>
                  Related documents
                </Text>
                {context.relatedDocuments.slice(0, 4).map((d) =>
                  docRow(d, { Icon: BookMarked, iconColor: "#2563EB" }),
                )}
              </View>
            ) : null}

            {context.relatedNotes.length > 0 ? (
              <View style={styles.focusGroup}>
                <Text style={[styles.focusGroupLabel, { color: t.textTertiary }]}>
                  Related notes
                </Text>
                {context.relatedNotes.slice(0, 4).map((n) => (
                  <TouchableOpacity
                    key={n.id}
                    activeOpacity={onOpenNote ? 0.7 : 1}
                    onPress={() => onOpenNote?.(n.id)}
                    style={[styles.row, { backgroundColor: subtle, borderColor: border }]}
                  >
                    <StickyNote size={16} color="#6366F1" strokeWidth={2.1} />
                    <Text style={[styles.rowTitle, { color: t.textSecondary, flex: 1 }]} numberOfLines={1}>
                      {n.text || "Note"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {context.relatedImages.length > 0 ? (
              <View style={styles.focusGroup}>
                <Text style={[styles.focusGroupLabel, { color: t.textTertiary }]}>
                  Saved images
                </Text>
                {context.relatedImages.slice(0, 3).map((img) => (
                  <View
                    key={img.uri}
                    style={[styles.row, { backgroundColor: subtle, borderColor: border }]}
                  >
                    <ImageIcon size={16} color="#10B981" strokeWidth={2.1} />
                    <Text style={[styles.rowTitle, { color: t.textSecondary, flex: 1 }]} numberOfLines={1}>
                      {stripExtension(img.name)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {/* ── Review again / knowledge decay ─────────────────────────────── */}
      {review.length > 0 ? (
        <>
          <SectionTitle t={t} Icon={Clock} label="Review again" style={{ marginTop: 22 }} />
          <Text style={[styles.sectionHint, { color: t.textTertiary }]}>
            You studied these a while ago — a quick revisit keeps them fresh.
          </Text>
          {review.map((d) =>
            docRow(d, {
              Icon: BookMarked,
              iconColor: "#F59E0B",
              trailing: `${Math.round(d.retention * 100)}% recall`,
            }),
          )}
        </>
      ) : null}

      {/* ── Predicted next / predictive ranking ────────────────────────── */}
      {predicted.length > 0 ? (
        <>
          <SectionTitle t={t} Icon={TrendingUp} label="You might open next" style={{ marginTop: 22 }} />
          {predicted.slice(0, 5).map((d) => docRow(d, { Icon: FileText, iconColor: ACCENT }))}
        </>
      ) : null}

      {/* ── Topics / automatic discovery ───────────────────────────────── */}
      {topics.length > 0 ? (
        <>
          <SectionTitle t={t} Icon={Sparkles} label="Topics in your library" style={{ marginTop: 22 }} />
          <View style={styles.chipWrap}>
            {topics.map((topic) => (
              <View
                key={topic.concept}
                style={[styles.chip, { backgroundColor: subtle, borderColor: border }]}
              >
                <Text style={[styles.chipText, { color: t.textSecondary }]}>{topic.concept}</Text>
                <Text style={[styles.chipCount, { color: ACCENT }]}>{topic.docs.length}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={{ height: 28 }} />
    </ScrollView>
  );
}

function SectionTitle({
  t,
  Icon,
  label,
  style,
}: {
  t: any;
  Icon: any;
  label: string;
  style?: any;
}) {
  return (
    <View style={[styles.sectionTitleRow, style]}>
      <Icon size={15} color={ACCENT} strokeWidth={2.3} />
      <Text style={[styles.sectionTitle, { color: t.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { paddingVertical: 14 },

  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  sectionHint: { fontSize: 12, lineHeight: 17, marginTop: -4, marginBottom: 10 },

  // Thin solid colour rail (no glow / dashed — matches ProgressDashboard).
  cardAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },

  focusCard: { borderWidth: 1, borderRadius: 16, padding: 16, overflow: "hidden" },
  focusEyebrow: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6 },
  focusTitle: { fontSize: 17, fontWeight: "800", letterSpacing: -0.4, marginTop: 4 },
  focusGroup: { marginTop: 14, gap: 7 },
  focusGroupLabel: { fontSize: 11.5, fontWeight: "700", marginBottom: 2 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  rowTitle: { fontSize: 13.5, fontWeight: "600" },
  rowMeta: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  rowTrailing: { fontSize: 11.5, fontWeight: "700" },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  chipText: { fontSize: 12.5, fontWeight: "600" },
  chipCount: { fontSize: 12, fontWeight: "800" },

  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 20, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 15.5, fontWeight: "800", letterSpacing: -0.2 },
  emptyText: { fontSize: 12.5, lineHeight: 19, textAlign: "center" },
});
