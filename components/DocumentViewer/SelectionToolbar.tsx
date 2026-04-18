/**
 * SelectionToolbar — WPS Office-style floating action bar that appears when
 * the user selects text in the document WebView.
 *
 * Layout (horizontal, scrollable):
 *   "Highlight" label → 5 colour circles | Underline | Ask athemi |
 *   Cross Out | Copy | Share | Cancel
 *
 * Positions itself above the selection when there is room, otherwise below.
 * Falls back to a safe bottom position when no rect is provided.
 *
 * Based on /sleek/SelectionToolbar.js.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ── Highlight colour palette (5 colours, matching /sleek) ─────────────────────
const HIGHLIGHT_COLORS = [
  { id: "yellow", color: "#FFD600", label: "Yellow" },
  { id: "green", color: "#00C853", label: "Green" },
  { id: "blue", color: "#2979FF", label: "Blue" },
  { id: "pink", color: "#FF4081", label: "Pink" },
  { id: "orange", color: "#FF6D00", label: "Orange" },
] as const;

// ── Props ──────────────────────────────────────────────────────────────────────
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  selectedText: string;
  /** Viewport-relative rect of the selection (with header offset applied). */
  rect?: SelectionRect | null;
  onHighlight: (colorHex: string) => void;
  onUnderline: () => void;
  onStrikethrough: () => void;
  onCopy: () => void;
  onSearch: () => void;
  onDismiss: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function SelectionToolbar({
  visible,
  selectedText,
  rect,
  onHighlight,
  onUnderline,
  onStrikethrough,
  onCopy,
  onSearch,
  onDismiss,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  // ── Scroll-indicator state ──────────────────────────────────────────
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true); // assume scrollable initially

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      setCanScrollLeft(contentOffset.x > 4);
      setCanScrollRight(
        contentOffset.x < contentSize.width - layoutMeasurement.width - 4,
      );
    },
    [],
  );

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 8,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  // ── Positioning ──────────────────────────────────────────────────────────────
  const TOOLBAR_HEIGHT = 56;
  const TOOLBAR_WIDTH = Math.min(SCREEN_WIDTH - 24, 380);
  const { height: SCREEN_HEIGHT } = Dimensions.get("window");

  let toolbarX: number;
  let toolbarY: number;
  let showAbove = false;

  if (rect) {
    const selectionMidX = rect.x + rect.width / 2;

    toolbarX = selectionMidX - TOOLBAR_WIDTH / 2;
    toolbarX = Math.max(
      12,
      Math.min(toolbarX, SCREEN_WIDTH - TOOLBAR_WIDTH - 12),
    );

    const spaceAbove = rect.y - 12;
    showAbove = spaceAbove > TOOLBAR_HEIGHT + 4;

    toolbarY = showAbove
      ? rect.y - TOOLBAR_HEIGHT - 8
      : rect.y + rect.height + 8;
  } else {
    // Fallback: float above the keyboard area at bottom of screen
    toolbarX = (SCREEN_WIDTH - TOOLBAR_WIDTH) / 2;
    toolbarY = SCREEN_HEIGHT - TOOLBAR_HEIGHT - 120;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          left: toolbarX,
          top: toolbarY,
          width: TOOLBAR_WIDTH,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.toolbar,
          showAbove ? styles.toolbarAbove : styles.toolbarBelow,
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="always"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_w, _h) => {
            // Re-check if content is wider than the container on mount
            setCanScrollRight(_w > TOOLBAR_WIDTH);
          }}
        >
          {/* ── "Highlight" label + 5 colour circles ── */}
          <View style={styles.sectionLabel}>
            <Text style={styles.sectionLabelText}>Highlight</Text>
          </View>

          {HIGHLIGHT_COLORS.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => {
                onHighlight(c.color);
                onDismiss();
              }}
              style={styles.colorBtn}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              accessibilityLabel={`Highlight ${c.label}`}
            >
              <View
                style={[styles.colorCircle, { backgroundColor: c.color }]}
              />
            </TouchableOpacity>
          ))}

          <View style={styles.divider} />

          {/* ── Underline ── */}
          <TouchableOpacity
            onPress={() => {
              onUnderline();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Underline"
          >
            <Text style={styles.actionIcon}>U̲</Text>
            <Text style={styles.actionLabel}>Underline</Text>
          </TouchableOpacity>

          {/* ── Copy ── */}
          <TouchableOpacity
            onPress={() => {
              onCopy();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Copy"
          >
            <Text style={styles.actionIcon}>⎘</Text>
            <Text style={styles.actionLabel}>Copy</Text>
          </TouchableOpacity>

          {/* ── Cross Out (strikethrough) ── */}
          <TouchableOpacity
            onPress={() => {
              onStrikethrough();
              onDismiss();
            }}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Cross out"
          >
            <Text style={styles.actionIcon}>S̶</Text>
            <Text style={styles.actionLabel}>Cross Out</Text>
          </TouchableOpacity>

          {/* ── Search (opens AI chat for selected text) ── */}
          <TouchableOpacity
            onPress={onSearch}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Search"
          >
            <Text style={[styles.actionIcon, { color: "#A78BFA" }]}>⌕</Text>
            <Text style={styles.actionLabel}>Search</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* ── Cancel / Dismiss ── */}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.actionIcon, { color: "#FF4444" }]}>✕</Text>
            <Text style={styles.actionLabel}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ── Scroll-fade indicators ── */}
        {canScrollLeft && (
          <LinearGradient
            colors={["#1E1E2E", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.fadeLeft}
            pointerEvents="none"
          />
        )}
        {canScrollRight && (
          <LinearGradient
            colors={["transparent", "#1E1E2E"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.fadeRight}
            pointerEvents="none"
          />
        )}
      </View>
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    zIndex: 9999,
    elevation: 20,
  },
  toolbar: {
    backgroundColor: "#1E1E2E",
    borderRadius: 12,
    height: 56,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 12,
    overflow: "hidden",
  },
  toolbarAbove: { marginBottom: 0 },
  toolbarBelow: { marginTop: 0 },

  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 56,
  },

  // "Highlight" label
  sectionLabel: {
    justifyContent: "center",
    paddingRight: 4,
  },
  sectionLabelText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "500",
  },

  // Colour circle button
  colorBtn: {
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 4,
    width: 28,
    height: 56,
  },
  colorCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.15)",
  },

  // Vertical separator
  divider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 6,
  },

  // Text action button
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    height: 56,
    minWidth: 44,
  },
  actionIcon: {
    fontSize: 18,
    color: "#FFFFFF",
    lineHeight: 22,
  },
  actionLabel: {
    fontSize: 9,
    color: "rgba(255,255,255,0.55)",
    marginTop: 1,
  },

  // Scroll-fade gradient overlays
  fadeLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 24,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    zIndex: 2,
  },
  fadeRight: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 24,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    zIndex: 2,
  },

});
