// ============================================
// HighlightRenderer — Interactive key-points view for the Highlights feature.
// - Filters (importance + category + view mode)
// - Meta summary panel (bullets + themes)
// - Per-highlight cards with action bar (jump-to-source, convert-to-task,
//   add-to-notes, explain, copy)
// - Highlight map: page density + click-to-jump
// - Timeline view for date-like highlights
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import {
  copyToClipboard,
  summarizeHighlights,
} from "@/services/ai/ai.service";
import type {
  HighlightData,
  HighlightItem,
  HighlightMeta,
  HighlightImportance,
} from "@/services/ai/ai.types";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Copy,
  FileText,
  Filter,
  LayoutList,
  Lightbulb,
  ListChecks,
  MapPin,
  Rows3,
  Sparkles,
  StickyNote,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ── Importance palette ──────────────────────────────────────────────────────

const IMPORTANCE_META: Record<
  HighlightImportance,
  { label: string; color: string; dot: string; bg: string }
> = {
  critical: { label: "Critical", color: "#DC2626", dot: "🔴", bg: "#FEE2E2" },
  high: { label: "High", color: "#EA580C", dot: "🟠", bg: "#FFEDD5" },
  medium: { label: "Medium", color: "#CA8A04", dot: "🟡", bg: "#FEF3C7" },
};

const DATE_CATEGORY_KEYS = new Set([
  "important_date",
  "due_date",
  "deadline",
  "date",
]);

type ViewMode = "list" | "grouped" | "timeline";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCategory(raw: string | undefined): string {
  if (!raw) return "Uncategorized";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function importanceRank(i: HighlightImportance): number {
  return i === "critical" ? 0 : i === "high" ? 1 : 2;
}

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  data: HighlightData;
  documentName?: string;
  onJumpToSource?: (highlight: HighlightItem) => void;
  onConvertToTask?: (highlight: HighlightItem) => void;
  onAddToNotes?: (highlight: HighlightItem) => void;
  onExplain?: (highlight: HighlightItem) => void;
  onGenerateQuiz?: (highlights: HighlightItem[]) => void;
  onConvertToFlashcards?: (highlights: HighlightItem[]) => void;
  onExport?: (highlights: HighlightItem[]) => void;
}

export function HighlightRenderer({
  data,
  documentName,
  onJumpToSource,
  onConvertToTask,
  onAddToNotes,
  onExplain,
  onGenerateQuiz,
  onConvertToFlashcards,
  onExport,
}: Props) {
  const { colors: t, mode } = useTheme();

  const [importanceFilter, setImportanceFilter] = useState<
    HighlightImportance | "all"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [localMeta, setLocalMeta] = useState<HighlightMeta | undefined>(
    data.meta,
  );

  useEffect(() => {
    setLocalMeta(data.meta);
  }, [data.meta]);

  // ── Derived: available categories from the highlights ────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const h of data.highlights) set.add(h.category);
    return Array.from(set);
  }, [data.highlights]);

  // ── Derived: filtered highlights ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return data.highlights.filter((h) => {
      if (importanceFilter !== "all" && h.importance !== importanceFilter) return false;
      if (categoryFilter !== "all" && h.category !== categoryFilter) return false;
      return true;
    });
  }, [data.highlights, importanceFilter, categoryFilter]);

  // ── Derived: counts for filter pills ─────────────────────────────────────
  const counts = useMemo(() => {
    const byImportance: Record<string, number> = {
      all: data.highlights.length,
      critical: 0,
      high: 0,
      medium: 0,
    };
    for (const h of data.highlights) {
      byImportance[h.importance] = (byImportance[h.importance] || 0) + 1;
    }
    return byImportance;
  }, [data.highlights]);

  // ── Meta summary on demand ──────────────────────────────────────────────
  const handleToggleSummary = useCallback(async () => {
    setShowSummary((prev) => !prev);
    // If we already have summary data, nothing to fetch
    if (localMeta?.summary && localMeta.summary.length > 0) return;
    if (summaryLoading) return;
    setSummaryLoading(true);
    try {
      const result = await summarizeHighlights(data.highlights, documentName);
      setLocalMeta((prev) => ({
        ...(prev || {}),
        summary: result.summary,
        keyThemes: result.keyThemes,
      }));
    } catch {
      // surfaced via alert only if user had it open
    } finally {
      setSummaryLoading(false);
    }
  }, [data.highlights, documentName, localMeta, summaryLoading]);

  const cardBg = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };
  const mutedBg = mode === "dark" ? "#1E293B" : "#F1F5F9";
  const mutedBorder = mode === "dark" ? "#334155" : "#E2E8F0";

  // ── Grouping for "grouped" view ─────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<string, HighlightItem[]>();
    for (const h of filtered) {
      if (!map.has(h.category)) map.set(h.category, []);
      map.get(h.category)!.push(h);
    }
    return Array.from(map.entries()).sort((a, b) => {
      // Sort by highest-priority item per group
      const aMin = Math.min(...a[1].map((h) => importanceRank(h.importance)));
      const bMin = Math.min(...b[1].map((h) => importanceRank(h.importance)));
      return aMin - bMin;
    });
  }, [filtered]);

  // ── Timeline items (category looks like a date) ──────────────────────────
  const timelineItems = useMemo(() => {
    return filtered
      .filter((h) => DATE_CATEGORY_KEYS.has(h.category))
      .map((h) => h);
  }, [filtered]);

  return (
    <View style={styles.wrap}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={[styles.card, cardBg]}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>
              Highlights
              {documentName ? ` · ${documentName}` : ""}
            </Text>
            <Text style={[styles.subtitle, { color: t.textSecondary }]}>
              {data.highlights.length} key point
              {data.highlights.length === 1 ? "" : "s"}
              {localMeta?.documentType && localMeta.documentType !== "other"
                ? ` · ${formatCategory(localMeta.documentType)}`
                : ""}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleToggleSummary}
            activeOpacity={0.8}
            style={[styles.summaryBtn, { backgroundColor: "#9333EA" }]}
          >
            <Sparkles size={13} color="#FFF" />
            <Text style={styles.summaryBtnText}>
              {showSummary ? "Hide Summary" : "Summarize"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Meta summary panel ─────────────────────────────────────── */}
      {showSummary ? (
        <View
          style={[
            styles.card,
            cardBg,
            { borderLeftWidth: 3, borderLeftColor: "#9333EA" },
          ]}
        >
          <View style={styles.rowHeader}>
            <Sparkles size={14} color="#9333EA" />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Summary</Text>
          </View>
          {summaryLoading ? (
            <View style={{ paddingVertical: 12, alignItems: "center" }}>
              <ActivityIndicator color="#9333EA" />
            </View>
          ) : localMeta?.summary && localMeta.summary.length > 0 ? (
            <View style={{ gap: 4, marginTop: 4 }}>
              {localMeta.summary.map((s, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, { color: "#9333EA" }]}>•</Text>
                  <Text style={[styles.bulletText, { color: t.text }]}>{s}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.body, { color: t.textSecondary }]}>
              No summary available.
            </Text>
          )}

          {localMeta?.keyThemes && localMeta.keyThemes.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[styles.miniLabel, { color: t.textSecondary }]}>
                Key themes
              </Text>
              <View style={styles.chipWrap}>
                {localMeta.keyThemes.map((theme, i) => (
                  <View
                    key={i}
                    style={[
                      styles.themeChip,
                      {
                        backgroundColor: mutedBg,
                        borderColor: mutedBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.themeChipText, { color: t.textSecondary }]}
                    >
                      {theme}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── Highlight map ──────────────────────────────────────────── */}
      {localMeta?.pageDensity && localMeta.pageDensity.length > 0 ? (
        <View style={[styles.card, cardBg]}>
          <View style={styles.rowHeader}>
            <MapPin size={14} color="#2563EB" />
            <Text style={[styles.sectionTitle, { color: t.text }]}>
              Highlight Map
            </Text>
            <Text
              style={[styles.miniLabel, { color: t.textTertiary, marginLeft: 4 }]}
            >
              ({localMeta.pageDensity.length} page
              {localMeta.pageDensity.length === 1 ? "" : "s"})
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
          >
            {localMeta.pageDensity.map((pd) => {
              const max = Math.max(
                ...localMeta.pageDensity!.map((p) => p.count),
              );
              const intensity = max > 0 ? pd.count / max : 0;
              return (
                <TouchableOpacity
                  key={pd.page}
                  onPress={() => {
                    const first = filtered.find(
                      (h) => h.sourceReference?.page === pd.page,
                    );
                    if (first && onJumpToSource) onJumpToSource(first);
                    else
                      Alert.alert(
                        `Page ${pd.page}`,
                        `${pd.count} highlight${pd.count === 1 ? "" : "s"} on this page.`,
                      );
                  }}
                  activeOpacity={0.75}
                  style={[
                    styles.pageTile,
                    {
                      backgroundColor: mode === "dark"
                        ? `rgba(37,99,235,${0.25 + intensity * 0.55})`
                        : `rgba(37,99,235,${0.1 + intensity * 0.4})`,
                      borderColor: "#2563EB",
                    },
                  ]}
                >
                  <Text style={[styles.pageTileNum, { color: t.text }]}>
                    p. {pd.page}
                  </Text>
                  <Text
                    style={[styles.pageTileCount, { color: t.textSecondary }]}
                  >
                    {pd.count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ── Filters ────────────────────────────────────────────────── */}
      <View style={[styles.card, cardBg]}>
        <View style={styles.rowHeader}>
          <Filter size={14} color={t.textSecondary} />
          <Text style={[styles.sectionTitle, { color: t.text }]}>Filters</Text>
        </View>

        {/* Importance filter */}
        <Text style={[styles.miniLabel, { color: t.textSecondary, marginTop: 6 }]}>
          Importance
        </Text>
        <View style={styles.chipWrap}>
          {(
            ["all", "critical", "high", "medium"] as (
              | "all"
              | HighlightImportance
            )[]
          ).map((key) => {
            const active = importanceFilter === key;
            const meta =
              key === "all" ? null : IMPORTANCE_META[key as HighlightImportance];
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setImportanceFilter(key)}
                activeOpacity={0.75}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active
                      ? meta
                        ? meta.color
                        : "#9333EA"
                      : mutedBg,
                    borderColor: active
                      ? meta
                        ? meta.color
                        : "#9333EA"
                      : mutedBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? "#FFF" : t.textSecondary },
                  ]}
                >
                  {key === "all" ? "All" : meta?.label}
                  <Text style={{ opacity: 0.8 }}>
                    {"  "}
                    {counts[key] ?? 0}
                  </Text>
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Category filter */}
        {allCategories.length > 1 ? (
          <>
            <Text
              style={[styles.miniLabel, { color: t.textSecondary, marginTop: 8 }]}
            >
              Category
            </Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                onPress={() => setCategoryFilter("all")}
                activeOpacity={0.75}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor:
                      categoryFilter === "all" ? "#9333EA" : mutedBg,
                    borderColor:
                      categoryFilter === "all" ? "#9333EA" : mutedBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color: categoryFilter === "all" ? "#FFF" : t.textSecondary,
                    },
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
              {allCategories.map((c) => {
                const active = categoryFilter === c;
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setCategoryFilter(c)}
                    activeOpacity={0.75}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? "#9333EA" : mutedBg,
                        borderColor: active ? "#9333EA" : mutedBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: active ? "#FFF" : t.textSecondary },
                      ]}
                    >
                      {formatCategory(c)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        {/* View mode */}
        <Text
          style={[styles.miniLabel, { color: t.textSecondary, marginTop: 8 }]}
        >
          View
        </Text>
        <View style={styles.chipWrap}>
          {(
            [
              { key: "list", label: "List", Icon: LayoutList },
              { key: "grouped", label: "Grouped", Icon: Rows3 },
              { key: "timeline", label: "Timeline", Icon: CalendarDays },
            ] as { key: ViewMode; label: string; Icon: any }[]
          ).map(({ key, label, Icon }) => {
            const active = viewMode === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setViewMode(key)}
                activeOpacity={0.75}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? "#9333EA" : mutedBg,
                    borderColor: active ? "#9333EA" : mutedBorder,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  },
                ]}
              >
                <Icon size={11} color={active ? "#FFF" : t.textSecondary} />
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? "#FFF" : t.textSecondary },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Highlights body ───────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <View style={[styles.card, cardBg, { alignItems: "center" }]}>
          <Text style={[styles.body, { color: t.textSecondary }]}>
            No highlights match the current filters.
          </Text>
        </View>
      ) : viewMode === "grouped" ? (
        grouped.map(([cat, items]) => (
          <View key={cat} style={styles.group}>
            <Text style={[styles.groupHeading, { color: t.textSecondary }]}>
              {formatCategory(cat)} · {items.length}
            </Text>
            {items.map((h, idx) => (
              <HighlightCard
                key={`${cat}-${idx}`}
                highlight={h}
                onJumpToSource={onJumpToSource}
                onConvertToTask={onConvertToTask}
                onAddToNotes={onAddToNotes}
                onExplain={onExplain}
              />
            ))}
          </View>
        ))
      ) : viewMode === "timeline" ? (
        timelineItems.length === 0 ? (
          <View style={[styles.card, cardBg, { alignItems: "center" }]}>
            <Text style={[styles.body, { color: t.textSecondary }]}>
              No date-related highlights found. Try the List view.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            {timelineItems.map((h, idx) => (
              <View key={idx} style={[styles.timelineRow]}>
                <View style={styles.timelineMarker}>
                  <CalendarDays size={14} color="#9333EA" />
                </View>
                <View style={{ flex: 1 }}>
                  <HighlightCard
                    highlight={h}
                    onJumpToSource={onJumpToSource}
                    onConvertToTask={onConvertToTask}
                    onAddToNotes={onAddToNotes}
                    onExplain={onExplain}
                  />
                </View>
              </View>
            ))}
          </View>
        )
      ) : (
        filtered.map((h, idx) => (
          <HighlightCard
            key={idx}
            highlight={h}
            onJumpToSource={onJumpToSource}
            onConvertToTask={onConvertToTask}
            onAddToNotes={onAddToNotes}
            onExplain={onExplain}
          />
        ))
      )}

      {/* ── Feature integration bar ────────────────────────────────── */}
      {filtered.length > 0 ? (
        <View style={[styles.card, cardBg]}>
          <Text
            style={[styles.miniLabel, { color: t.textSecondary, marginBottom: 6 }]}
          >
            Do more with these highlights
          </Text>
          <View style={styles.chipWrap}>
            {onGenerateQuiz ? (
              <TouchableOpacity
                onPress={() => onGenerateQuiz(filtered)}
                activeOpacity={0.8}
                style={[styles.actionCta, { backgroundColor: "#A855F7" }]}
              >
                <Sparkles size={12} color="#FFF" />
                <Text style={styles.actionCtaText}>Generate Quiz</Text>
              </TouchableOpacity>
            ) : null}
            {onConvertToFlashcards ? (
              <TouchableOpacity
                onPress={() => onConvertToFlashcards(filtered)}
                activeOpacity={0.8}
                style={[styles.actionCta, { backgroundColor: "#2563EB" }]}
              >
                <FileText size={12} color="#FFF" />
                <Text style={styles.actionCtaText}>Flashcards</Text>
              </TouchableOpacity>
            ) : null}
            {onExport ? (
              <TouchableOpacity
                onPress={() => onExport(filtered)}
                activeOpacity={0.8}
                style={[styles.actionCta, { backgroundColor: "#0EA5E9" }]}
              >
                <FileText size={12} color="#FFF" />
                <Text style={styles.actionCtaText}>Export</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ── Individual highlight card ───────────────────────────────────────────────

interface CardProps {
  highlight: HighlightItem;
  onJumpToSource?: (h: HighlightItem) => void;
  onConvertToTask?: (h: HighlightItem) => void;
  onAddToNotes?: (h: HighlightItem) => void;
  onExplain?: (h: HighlightItem) => void;
}

function HighlightCard({
  highlight,
  onJumpToSource,
  onConvertToTask,
  onAddToNotes,
  onExplain,
}: CardProps) {
  const { colors: t, mode } = useTheme();
  const meta = IMPORTANCE_META[highlight.importance] || IMPORTANCE_META.medium;
  const [copied, setCopied] = useState(false);
  const [taskDone, setTaskDone] = useState(false);
  const [notesDone, setNotesDone] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(highlight.text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [highlight.text]);

  const handleTask = useCallback(() => {
    if (!onConvertToTask) {
      Alert.alert("Convert to Task", "Task integration is not wired up yet.");
      return;
    }
    onConvertToTask(highlight);
    setTaskDone(true);
    setTimeout(() => setTaskDone(false), 1800);
  }, [highlight, onConvertToTask]);

  const handleNotes = useCallback(() => {
    if (!onAddToNotes) {
      Alert.alert("Add to Notes", "Notes integration is not wired up yet.");
      return;
    }
    onAddToNotes(highlight);
    setNotesDone(true);
    setTimeout(() => setNotesDone(false), 1800);
  }, [highlight, onAddToNotes]);

  const cardBg = {
    backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
    borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
  };

  const ref = highlight.sourceReference;
  const refLabel = ref
    ? [
        typeof ref.page === "number" ? `p. ${ref.page}` : null,
        ref.section ? ref.section : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <View style={[styles.card, cardBg, { borderLeftWidth: 3, borderLeftColor: meta.color }]}>
      {/* Badge row */}
      <View style={styles.badgeRow}>
        <View style={[styles.importanceBadge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.importanceText, { color: meta.color }]}>
            {meta.dot} {meta.label}
          </Text>
        </View>
        <View
          style={[
            styles.categoryBadge,
            {
              backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9",
              borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
        >
          <Text style={[styles.categoryText, { color: t.textSecondary }]}>
            {formatCategory(highlight.category)}
          </Text>
        </View>
        {typeof highlight.confidence === "number" ? (
          <View
            style={[
              styles.confidenceBadge,
              {
                backgroundColor:
                  mode === "dark"
                    ? "rgba(148,163,184,0.15)"
                    : "rgba(148,163,184,0.2)",
              },
            ]}
          >
            <Text style={[styles.confidenceText, { color: t.textTertiary }]}>
              {highlight.confidence}% confident
            </Text>
          </View>
        ) : null}
      </View>

      {/* Highlighted text */}
      <Text style={[styles.highlightText, { color: t.text }]}>
        "{highlight.text}"
      </Text>

      {/* Reason */}
      {highlight.reason ? (
        <Text style={[styles.reasonText, { color: t.textSecondary }]}>
          {highlight.reason}
        </Text>
      ) : null}

      {/* Source ref label */}
      {refLabel ? (
        <View style={[styles.sourceRefRow]}>
          <MapPin size={11} color={t.textTertiary} />
          <Text style={[styles.sourceRefText, { color: t.textTertiary }]}>
            {refLabel}
          </Text>
        </View>
      ) : null}

      {/* Action bar */}
      <View style={styles.actionBar}>
        {ref && (ref.page || ref.section || ref.snippet) ? (
          <TouchableOpacity
            onPress={() =>
              onJumpToSource
                ? onJumpToSource(highlight)
                : Alert.alert("Jump to Source", "Viewer not wired up yet.")
            }
            activeOpacity={0.75}
            style={[styles.actionBtn, { backgroundColor: "#2563EB" }]}
          >
            <MapPin size={11} color="#FFF" />
            <Text style={styles.actionBtnText}>Jump to Source</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={handleNotes}
          activeOpacity={0.75}
          style={[
            styles.actionBtnGhost,
            {
              borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
        >
          {notesDone ? (
            <CheckCircle2 size={11} color="#10B981" />
          ) : (
            <StickyNote size={11} color={t.textSecondary} />
          )}
          <Text style={[styles.actionBtnGhostText, { color: t.textSecondary }]}>
            {notesDone ? "Added" : "Add to Notes"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleTask}
          activeOpacity={0.75}
          style={[
            styles.actionBtnGhost,
            {
              borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
        >
          {taskDone ? (
            <CheckCircle2 size={11} color="#10B981" />
          ) : (
            <ListChecks size={11} color={t.textSecondary} />
          )}
          <Text style={[styles.actionBtnGhostText, { color: t.textSecondary }]}>
            {taskDone ? "Task" : "To Task"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() =>
            onExplain
              ? onExplain(highlight)
              : Alert.alert("Explain", "Explain service not wired up yet.")
          }
          activeOpacity={0.75}
          style={[
            styles.actionBtnGhost,
            {
              borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
        >
          <Lightbulb size={11} color="#22D3EE" />
          <Text style={[styles.actionBtnGhostText, { color: t.textSecondary }]}>
            Explain
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleCopy}
          activeOpacity={0.75}
          style={[
            styles.actionBtnGhost,
            {
              borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
        >
          {copied ? (
            <CheckCircle2 size={11} color="#10B981" />
          ) : (
            <Copy size={11} color={t.textSecondary} />
          )}
          <Text style={[styles.actionBtnGhostText, { color: t.textSecondary }]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: { fontSize: 14, fontWeight: "700" },
  subtitle: { fontSize: 11.5, marginTop: 2 },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 19 },
  miniLabel: { fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  summaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  summaryBtnText: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "700" },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  bulletDot: { fontWeight: "700", marginTop: 1 },
  bulletText: { fontSize: 13, lineHeight: 19, flex: 1 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  themeChip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeChipText: { fontSize: 11, fontWeight: "600" },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 11, fontWeight: "600" },
  pageTile: {
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  pageTileNum: { fontSize: 11.5, fontWeight: "700" },
  pageTileCount: { fontSize: 10, marginTop: 1 },
  group: { gap: 6 },
  groupHeading: {
    fontSize: 10.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 2,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  timelineMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(147,51,234,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  importanceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  importanceText: { fontSize: 10.5, fontWeight: "700" },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryText: { fontSize: 10.5, fontWeight: "600" },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  confidenceText: { fontSize: 10.5, fontWeight: "600" },
  highlightText: {
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 6,
    fontStyle: "italic",
  },
  reasonText: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  sourceRefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  sourceRefText: { fontSize: 11, fontWeight: "500" },
  actionBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  actionBtnText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  actionBtnGhost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionBtnGhostText: { fontSize: 11, fontWeight: "600" },
  actionCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  actionCtaText: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "700" },
});
