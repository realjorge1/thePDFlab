/**
 * ShelfCard.tsx
 * A cover-first card for the Library's shelf mode, plus the "Continue
 * reading" banner that sits above it.
 *
 * Kept out of app/library.tsx deliberately. That file is already three
 * thousand lines and carries the list and grid modes the shelf must not
 * disturb; adding a third renderer inline would make the safe change look
 * like a risky one.
 *
 * Covers resolve lazily — the card asks for one when it mounts, which means
 * only the rows a reader has actually scrolled to do any work.
 */

import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { PressableScale } from "@/components/ui/PressableScale";
import {
  getCoverSync,
  loadCover,
  placeholderInitials,
  placeholderTint,
  subscribeCovers,
} from "@/services/bookCoverService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShelfTheme {
  card: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
}

export interface ShelfBook {
  id: string;
  uri: string;
  title: string;
  author?: string;
  extension: string;
  /** 0..1, from the reading-progress service. */
  progress: number;
  /** Page N of M, when the format tracks pages. */
  currentPage?: number;
  totalPages?: number;
  /** False once the underlying file is known to be gone. */
  available: boolean;
}

// ---------------------------------------------------------------------------
// Cover art
// ---------------------------------------------------------------------------

/**
 * The cover image, or a generated stand-in.
 *
 * The stand-in is derived from the title, so it is stable across launches —
 * a shelf whose colours reshuffle on every load reads as broken, and the
 * colour is part of how someone recognises a book at a glance.
 */
const Cover: React.FC<{ book: ShelfBook; theme: ShelfTheme }> = ({
  book,
  theme,
}) => {
  const [path, setPath] = useState<string | null | undefined>(() =>
    getCoverSync(book.uri),
  );

  useEffect(() => {
    let cancelled = false;

    if (getCoverSync(book.uri) === undefined) {
      loadCover(book.uri, book.extension).catch(() => {});
    }

    const unsubscribe = subscribeCovers(() => {
      if (!cancelled) setPath(getCoverSync(book.uri));
    });
    setPath(getCoverSync(book.uri));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [book.uri, book.extension]);

  if (path) {
    return (
      <Image
        source={{ uri: path }}
        style={styles.coverImage}
        contentFit="cover"
        transition={160}
        accessibilityLabel={`Cover of ${book.title}`}
      />
    );
  }

  const tint = placeholderTint(book.title);
  return (
    <View style={[styles.coverImage, styles.placeholder, { backgroundColor: tint }]}>
      <Text style={styles.placeholderInitials} numberOfLines={1}>
        {placeholderInitials(book.title)}
      </Text>
      <Text style={styles.placeholderTitle} numberOfLines={3}>
        {book.title}
      </Text>
      {!!book.author && (
        <Text style={styles.placeholderAuthor} numberOfLines={1}>
          {book.author}
        </Text>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** A slim bar rather than a ring: it reads at cover size and costs no SVG. */
const ProgressBar: React.FC<{ progress: number; theme: ShelfTheme }> = ({
  progress,
  theme,
}) => {
  const pct = Math.max(0, Math.min(1, progress));
  if (pct <= 0) return null;

  return (
    <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
      <View
        style={[
          styles.progressFill,
          { width: `${pct * 100}%`, backgroundColor: theme.primary },
        ]}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface ShelfCardProps {
  book: ShelfBook;
  theme: ShelfTheme;
  onPress: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
}

export const ShelfCard: React.FC<ShelfCardProps> = ({
  book,
  theme,
  onPress,
  onLongPress,
  style,
}) => {
  const pct = Math.round(Math.max(0, Math.min(1, book.progress)) * 100);

  const status = !book.available
    ? "Unavailable"
    : book.currentPage && book.totalPages
      ? `Page ${book.currentPage} of ${book.totalPages}`
      : pct > 0
        ? `${pct}%`
        : "Not started";

  return (
    <PressableScale
      scaleTo={0.97}
      style={[styles.card, style]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      accessibilityRole="button"
      accessibilityLabel={`${book.title}${book.author ? `, ${book.author}` : ""}, ${status}`}
    >
      <View style={[styles.coverWrap, !book.available && styles.dimmed]}>
        <Cover book={book} theme={theme} />
        {!book.available && (
          <View style={styles.unavailableBadge}>
            <Text style={styles.unavailableText}>Missing</Text>
          </View>
        )}
      </View>

      <ProgressBar progress={book.progress} theme={theme} />

      <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
        {book.title}
      </Text>
      <Text
        style={[styles.subtitle, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {book.author || status}
      </Text>
    </PressableScale>
  );
};

// ---------------------------------------------------------------------------
// Continue reading
// ---------------------------------------------------------------------------

interface ContinueReadingProps {
  book: ShelfBook;
  theme: ShelfTheme;
  onPress: () => void;
}

/**
 * The most recent unfinished book, given its own row.
 *
 * This is most of the shelf's value: it turns "where was I" into one tap,
 * which is the thing a reader does far more often than browsing.
 */
export const ContinueReading: React.FC<ContinueReadingProps> = ({
  book,
  theme,
  onPress,
}) => {
  const pct = Math.round(Math.max(0, Math.min(1, book.progress)) * 100);

  return (
    <PressableScale
      scaleTo={0.98}
      onPress={onPress}
      style={[
        styles.continueCard,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Continue reading ${book.title}, ${pct} percent through`}
    >
      <View style={styles.continueCover}>
        <Cover book={book} theme={theme} />
      </View>

      <View style={styles.continueInfo}>
        <Text style={[styles.continueEyebrow, { color: theme.primary }]}>
          CONTINUE READING
        </Text>
        <Text
          style={[styles.continueTitle, { color: theme.text }]}
          numberOfLines={2}
        >
          {book.title}
        </Text>
        {!!book.author && (
          <Text
            style={[styles.continueAuthor, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {book.author}
          </Text>
        )}

        <View style={styles.continueProgressRow}>
          <View
            style={[styles.progressTrack, { backgroundColor: theme.border }]}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${pct}%`, backgroundColor: theme.primary },
              ]}
            />
          </View>
          <Text style={[styles.continuePct, { color: theme.textSecondary }]}>
            {book.currentPage && book.totalPages
              ? `${book.currentPage}/${book.totalPages}`
              : `${pct}%`}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** Roughly the 2:3 of a printed cover. */
const COVER_ASPECT = 0.66;

const styles = StyleSheet.create({
  card: { flex: 1, marginBottom: 18 },
  coverWrap: {
    width: "100%",
    aspectRatio: COVER_ASPECT,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.06)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  dimmed: { opacity: 0.45 },
  coverImage: { width: "100%", height: "100%" },
  placeholder: { padding: 10, justifyContent: "space-between" },
  placeholderInitials: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 1,
  },
  placeholderTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  placeholderAuthor: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    marginTop: 2,
  },
  unavailableBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  unavailableText: { color: "#fff", fontSize: 9, fontWeight: "700" },

  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginTop: 7,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },

  title: { fontSize: 12, fontWeight: "600", marginTop: 6, lineHeight: 16 },
  subtitle: { fontSize: 10, marginTop: 1 },

  continueCard: {
    flexDirection: "row",
    gap: 14,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  continueCover: {
    width: 74,
    aspectRatio: COVER_ASPECT,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  continueInfo: { flex: 1, justifyContent: "center" },
  continueEyebrow: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  continueTitle: { fontSize: 15, fontWeight: "700", lineHeight: 19 },
  continueAuthor: { fontSize: 12, marginTop: 2 },
  continueProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  continuePct: { fontSize: 11, fontWeight: "600" },
});
