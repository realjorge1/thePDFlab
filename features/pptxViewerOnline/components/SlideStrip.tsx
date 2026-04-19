// ============================================================================
// SlideStrip — horizontal scrollable page indicator. Lets the user jump to
// any slide by tapping. Pure JS (no native thumbnail rendering) so it stays
// lightweight and avoids spinning up N Pdf instances.
// ============================================================================

import React, { useEffect, useRef } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const ACCENT = "#6366F1";
const ITEM_WIDTH = 44;
const ITEM_GAP = 8;

interface Props {
  totalPages: number;
  currentPage: number;
  onJump: (page: number) => void;
}

export function SlideStrip({ totalPages, currentPage, onJump }: Props) {
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!scrollRef.current || totalPages <= 1) return;
    const x = Math.max(
      0,
      (currentPage - 1) * (ITEM_WIDTH + ITEM_GAP) - ITEM_WIDTH,
    );
    scrollRef.current.scrollTo({ x, animated: true });
  }, [currentPage, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
          const active = page === currentPage;
          return (
            <TouchableOpacity
              key={page}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => onJump(page)}
              hitSlop={4}
            >
              <Text style={[styles.label, active && styles.labelActive]}>
                {page}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(0,0,0,0.6)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  content: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: ITEM_GAP,
  },
  item: {
    width: ITEM_WIDTH,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  itemActive: { backgroundColor: ACCENT },
  label: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "600",
  },
  labelActive: { color: "#FFFFFF" },
});
