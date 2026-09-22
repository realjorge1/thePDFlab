/**
 * ContinueReadingCard — "You spent 40 minutes reading X on Friday."
 *
 * THE COPY IS THE FEATURE. A number the user does not recognise destroys
 * trust in everything else the app claims about their reading, so:
 *   • the minutes come only from time the R2.3 activity guard actually
 *     earned — never from a viewer simply being open;
 *   • whole minutes only, never seconds;
 *   • under two minutes reads "a few minutes" rather than "1 minute";
 *   • the weekday name within the last 7 days, then "last week", then a date.
 *
 * Lives at the top of Gozlin WorkSpace → Progress, which is inside
 * <PremiumGate>, so it is a premium surface by construction. Hideable
 * through settings.hideContinueReading. Gated by READING_SESSIONS: with the
 * flag off it renders nothing and reads nothing.
 */
import { router } from "expo-router";
import { BookOpen, ChevronRight } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { READING_SESSIONS } from "@/constants/featureFlags";
import { useTheme } from "@/services/ThemeProvider";
import { cancelReminderFor } from "@/services/readingReminderService";
import {
  getResumeCandidate,
  localDayStart,
  subscribeReadingSessions,
  type ResumeCandidate,
} from "@/services/readingSessionService";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Whole minutes; "a few minutes" under two. Never seconds. */
export function formatReadingMinutes(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 2) return "a few minutes";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? "an hour" : `${hours} hours`;
  return `${hours}h ${rest}m`;
}

/**
 * "today" / "yesterday" / a weekday name within the last 7 days / "last week"
 * / a date. Built from the LOCAL day key the session was filed under, so it
 * agrees with the bucket rather than re-deriving a day from a timestamp.
 */
export function formatReadingDay(day: string, now: number = Date.now()): string {
  const start = localDayStart(day);
  if (!start) return "recently";

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((todayStart.getTime() - start) / 86_400_000);

  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 7) return `on ${WEEKDAYS[new Date(start).getDay()]}`;
  if (daysAgo < 14) return "last week";
  return `on ${new Date(start).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}

function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

interface Props {
  /** settings.hideContinueReading */
  hidden?: boolean;
}

export function ContinueReadingCard({ hidden = false }: Props) {
  const { colors: t } = useTheme();
  const [candidate, setCandidate] = useState<ResumeCandidate | null>(null);

  const refresh = useCallback(async () => {
    if (!READING_SESSIONS) return;
    const next = await getResumeCandidate();
    setCandidate(next);
  }, []);

  useEffect(() => {
    if (!READING_SESSIONS) return;
    void refresh();
    return subscribeReadingSessions(() => {
      void refresh();
    });
  }, [refresh]);

  const handlePress = useCallback(() => {
    if (!candidate) return;
    // Opening the file cancels any pending nudge about it.
    void cancelReminderFor(candidate.identityKey);

    const ext = candidate.fileExt.toLowerCase();
    const path =
      ext === "pdf"
        ? "/pdf-viewer"
        : ext === "epub"
          ? "/epub-viewer"
          : ext === "docx" || ext === "doc"
            ? "/docx-viewer"
            : ext === "pptx" || ext === "ppt"
              ? "/ppt-viewer"
              : null;
    if (!path) return;

    // No second restore path: the viewers already restore the stored position
    // from readingProgressService on open. Only uri/name are passed.
    router.push({
      pathname: path as never,
      params: {
        uri: encodeURIComponent(candidate.uri),
        name: candidate.fileName,
      },
    });
  }, [candidate]);

  if (!READING_SESSIONS || hidden || !candidate) return null;

  const title = stripExtension(candidate.fileName);
  const where = candidate.lastPageLabel ? ` · ${candidate.lastPageLabel}` : "";

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Continue reading ${title}`}
      >
        <View style={[styles.iconBox, { backgroundColor: t.backgroundSecondary }]}>
          <BookOpen size={20} color={t.primary} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.line, { color: t.textSecondary }]} numberOfLines={2}>
            You spent {formatReadingMinutes(candidate.ms)} reading{" "}
            <Text style={{ color: t.text, fontWeight: "700" }}>{title}</Text>{" "}
            {formatReadingDay(candidate.day)}
          </Text>
          <Text style={[styles.cta, { color: t.primary }]}>
            Continue where you left off{where}
          </Text>
        </View>
        <ChevronRight size={18} color={t.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  line: { fontSize: 13, lineHeight: 18 },
  cta: { fontSize: 12, fontWeight: "700", marginTop: 4 },
});
