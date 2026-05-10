/**
 * DocLib FileCard — list / grid / recent-card variants for SAF-indexed files.
 *
 * Theme-aware: pulls colors from the app's ThemeProvider, falls back to the
 * type-specific accent colors defined in constants/theme. Progress is
 * visualised with the shared ProgressRing component (library/grid) and a
 * lightweight inline bar (list).
 */

import React, { memo } from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { File, FileText, Presentation, Sheet } from "lucide-react-native";
import { ProgressRing } from "@/components/ProgressRing";
import { colors as appColors } from "@/constants/theme";
import { useTheme } from "@/services/ThemeProvider";
import type { DocumentRecord } from "@/services/doclib/database";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

// ─── Type config ──────────────────────────────────────────────────────────────

type IconCmp = typeof File;

const TYPE_CONFIG: Record<
  DocumentRecord["type"],
  { label: string; color: string; bg: string; Icon: IconCmp }
> = {
  pdf: { label: "PDF", color: appColors.pdf, bg: "#FEE2E2", Icon: File },
  docx: { label: "WORD", color: appColors.word, bg: "#DBEAFE", Icon: FileText },
  pptx: {
    label: "PPT",
    color: appColors.ppt,
    bg: "#FFEDD5",
    Icon: Presentation,
  },
  xlsx: { label: "EXCEL", color: appColors.excel, bg: "#D1FAE5", Icon: Sheet },
  unknown: {
    label: "FILE",
    color: appColors.primary,
    bg: "#EEF2FF",
    Icon: FileText,
  },
};

// ─── List/Grid card ───────────────────────────────────────────────────────────

interface FileCardProps {
  document: DocumentRecord;
  onPress: (doc: DocumentRecord) => void;
  showProgress?: boolean;
  mode?: "list" | "grid";
}

export const FileCard = memo(function FileCard({
  document,
  onPress,
  showProgress = false,
  mode = "list",
}: FileCardProps) {
  const { colors: t } = useTheme();
  const config = TYPE_CONFIG[document.type] ?? TYPE_CONFIG.unknown;
  const hasProgress = document.readingProgress > 0;
  const Icon = config.Icon;

  if (mode === "grid") {
    return (
      <TouchableOpacity
        style={[
          styles.gridCard,
          { backgroundColor: t.card, borderTopColor: config.color },
        ]}
        onPress={() => onPress(document)}
        activeOpacity={0.8}
      >
        <View style={[styles.gridIconBadge, { backgroundColor: config.bg }]}>
          <Icon color={config.color} size={22} strokeWidth={2} />
        </View>
        <Text
          style={[styles.gridTitle, { color: t.text }]}
          numberOfLines={2}
        >
          {document.name.replace(/\.[^.]+$/, "")}
        </Text>
        <View style={styles.gridMeta}>
          <View style={[styles.typePill, { backgroundColor: config.bg }]}>
            <Text style={[styles.typePillText, { color: config.color }]}>
              {config.label}
            </Text>
          </View>
          {showProgress && hasProgress && (
            <ProgressRing
              progress={document.readingProgress}
              size={28}
              strokeWidth={3}
              color={config.color}
              trackColor={t.borderLight ?? "#E2E8F0"}
              textColor={config.color}
            />
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.listCard, { backgroundColor: t.card }]}
      onPress={() => onPress(document)}
      activeOpacity={0.8}
    >
      <View style={[styles.iconBox, { backgroundColor: config.bg }]}>
        <Icon color={config.color} size={22} strokeWidth={2} />
        <View style={[styles.typeTag, { backgroundColor: config.color }]}>
          <Text style={styles.typeTagText}>{config.label}</Text>
        </View>
      </View>

      <View style={styles.listContent}>
        <Text
          style={[styles.docName, { color: t.text }]}
          numberOfLines={2}
        >
          {document.name.replace(/\.[^.]+$/, "")}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: t.textSecondary }]}>
            {formatBytes(document.size)}
          </Text>
          <View style={styles.metaDot} />
          <Text style={[styles.metaText, { color: t.textSecondary }]}>
            {formatDate(document.lastModified)}
          </Text>
          {document.folder ? (
            <>
              <View style={styles.metaDot} />
              <Text
                style={[styles.metaText, { color: t.textSecondary, flex: 1 }]}
                numberOfLines={1}
              >
                {document.folder}
              </Text>
            </>
          ) : null}
        </View>
        {showProgress && hasProgress && (
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: t.borderLight ?? "#EDF2F7" },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(2, Math.min(100, document.readingProgress * 100))}%`,
                  backgroundColor: config.color,
                },
              ]}
            />
          </View>
        )}
      </View>

      {showProgress && hasProgress && (
        <ProgressRing
          progress={document.readingProgress}
          size={32}
          strokeWidth={3}
          color={config.color}
          trackColor={t.borderLight ?? "#E2E8F0"}
          textColor={config.color}
        />
      )}
    </TouchableOpacity>
  );
});

// ─── Recent card (horizontal scroll variant) ──────────────────────────────────

export const RecentCard = memo(function RecentCard({
  document,
  onPress,
}: {
  document: DocumentRecord;
  onPress: (doc: DocumentRecord) => void;
}) {
  const { colors: t } = useTheme();
  const config = TYPE_CONFIG[document.type] ?? TYPE_CONFIG.unknown;
  const Icon = config.Icon;

  return (
    <TouchableOpacity
      style={[styles.recentCard, { backgroundColor: t.card }]}
      onPress={() => onPress(document)}
      activeOpacity={0.8}
    >
      <View style={[styles.recentHeader, { backgroundColor: config.bg }]}>
        <Icon color={config.color} size={28} strokeWidth={2} />
        <View
          style={[styles.recentTypeBadge, { backgroundColor: config.color }]}
        >
          <Text style={styles.recentTypeText}>{config.label}</Text>
        </View>
      </View>
      <View style={styles.recentBody}>
        <Text
          style={[styles.recentTitle, { color: t.text }]}
          numberOfLines={2}
        >
          {document.name.replace(/\.[^.]+$/, "")}
        </Text>
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: t.borderLight ?? "#EDF2F7" },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.max(2, Math.min(100, document.readingProgress * 100))}%`,
                backgroundColor: config.color,
              },
            ]}
          />
        </View>
        <Text style={[styles.recentDate, { color: t.textTertiary }]}>
          {document.lastOpened
            ? formatDate(document.lastOpened)
            : "Not opened yet"}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // List
  listCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 5,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  typeTag: {
    position: "absolute",
    bottom: -4,
    right: -4,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  typeTagText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  listContent: {
    flex: 1,
    gap: 4,
  },
  docName: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    fontWeight: "500",
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#CBD5E0",
  },

  // Progress
  progressTrack: {
    height: 3,
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
  },

  // Grid
  gridCard: {
    width: (SCREEN_WIDTH - 48) / 2,
    borderRadius: 14,
    padding: 14,
    margin: 6,
    borderTopWidth: 3,
    gap: 8,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  gridIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  gridMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  typePill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typePillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // Recent
  recentCard: {
    width: 160,
    borderRadius: 14,
    overflow: "hidden",
    marginRight: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  recentHeader: {
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  recentTypeBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  recentTypeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  recentBody: {
    padding: 10,
    gap: 6,
  },
  recentTitle: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  recentDate: {
    fontSize: 11,
  },
});
