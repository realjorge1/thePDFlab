/**
 * BookmarkToast — the confirmation shown after Bookmark / Remove Bookmark.
 *
 * The action itself lives in each reader's three-dots menu, which closes on
 * tap, so without this the user gets no acknowledgement that anything
 * happened. Purely presentational: the reader owns the message state and
 * clears it on a timer.
 */
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export interface BookmarkToastProps {
  /** null hides the toast. */
  message: string | null;
  /** Failures get the error colour and icon. */
  ok?: boolean;
  /** Lifts the pill clear of the Read Aloud bar when it is up. */
  bottomOffset?: number;
}

export function BookmarkToast({
  message,
  ok = true,
  bottomOffset = 0,
}: BookmarkToastProps) {
  if (!message) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { bottom: 88 + bottomOffset }]}
    >
      <View style={[styles.pill, !ok && styles.pillError]}>
        <MaterialIcons
          name={ok ? "bookmark" : "error-outline"}
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.label} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "88%",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: "rgba(17,24,39,0.94)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  pillError: {
    backgroundColor: "rgba(185,28,28,0.96)",
  },
  label: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
});
